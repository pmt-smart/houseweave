# house_alarm.be -- the alarm's configuration as a setting of the house: what each device does in the alarm (its role, its notification, the entry,
# the sound, the hours of silence, a numeric condition, a siren, out of the panic, its action in the panic) and what the whole house does (the exit, entry
# and siren times, what the panic does, its burst). Any panel that writes the list edits it, the mesh carries it to every node, and each bridge applies
# the part that is its own: the devices of its Zigbee network, which the list keeps in pages under the bridge's number (HouseList.K_APAGE), and the
# house's part (HouseList.K_ALARM). The state of the alarm is not here: it is the replica's, and the events go out as they did.
#
# THREE SIDES, one class:
#   a bridge    check(): the list's setting against what this bridge applied last (the persist key KEY, the fields' bytes as hex), and, when they differ,
#               the bridge's configuration made from it (cfg_of) and given to its alarm (`apply`: ZbBridgeAlarm.take_cfg). A house whose list has no
#               ALARM yet is not the alarm's house yet: each bridge keeps the configuration it has
#   a panel     panel_cfg(): the model the alarm's screens read (panel_alarm.be's cfg), of every bridge of the house at once, made again (`apply`, with nil)
#               each time the list changed, once the list has an ALARM
#   a panel     edit(): a word of the screens (ZbBridgeAlarm.SETS: sensor, times, panic_cfg, siren, burst) written into the list. The first one, in a house
#               whose list has no ALARM yet, starts from what this panel's screens had of the bridge of the house (`seed`, its model then), so that a
#               house that had an alarm keeps what that bridge had
#
# A record (HouseList.page_bytes): {"role": 0-3, "notify": 0-3, "entry", "sound", "siren", "nopanic", "news": hours or 0, "cond": {"k", "w", "x"}, "act": text}

#@ solidify:HouseAlarm
class HouseAlarm
    static KEY = "house_alarm"
    static WAIT_MS = 700
    static ROLES = ["off", "perimeter", "interior", "24h"]
    static GRADES = ["off", "local", "house", "alert"]
    static NEWS_H = 4

    var host      # the HouseMesh
    var apply     # f(cfg) -> nothing: a bridge's configuration, as zbbridge_alarm.be keeps it, given to its alarm; on a panel, f(nil), the screens' model made again

    def init(host, apply)
        self.host = host
        self.apply = apply
    end

    # --- a bridge: the setting of the house, applied ----------------------------------------------------------------------------

    # the list changed, or the node came up: looked at a moment later, once, with whatever else changed meanwhile
    def later()
        tasmota.set_timer(HouseAlarm.WAIT_MS, / -> self.check(), "house_alarm")
    end

    # The list's setting for this bridge against the one applied: applied when it is another. True when it was
    def check()
        import persist
        var h = self.host
        if h == nil || !h.up || self.apply == nil || h.list.me < 1 return false end
        var f = h.list.field(HouseList.K_ALARM, 0)
        if f == nil return false end
        # a panel's screens read every bridge's part, made again each time the list changed: nothing to keep
        if h.role != HouseList.ROLE_BRIDGE
            self.apply(nil)
            return true
        end
        var mark = f[2].tohex()
        for k: 0 .. HouseList.APAGES - 1
            var p = h.list.field(HouseList.K_APAGE + k, h.list.me)
            mark += "." + (p != nil ? p[2].tohex() : "")
        end
        if persist.find(HouseAlarm.KEY, nil) == mark return false end
        persist.setmember(HouseAlarm.KEY, mark)
        log("HOUSE: the house's configuration of the alarm, taken by this bridge", 2)
        self.apply(HouseAlarm.cfg_of(h, h.list.me))
        return true
    end

    # the house's part, or what a house has before any panel wrote one
    static def house_part(h)
        var a = h.alarm_setting()
        return a != nil ? a : {"times": [30, 30, 300], "ha": true, "panels": false, "alarm": false, "burst": [8, 3]}
    end

    # A bridge's configuration from the list, as zbbridge_alarm.be keeps it: {"sensors", "times", "panic", "sirens", "nopanic"}. A record is a sensor when it has
    # a role, a notification or a condition, as a sensor's record with none of them leaves the alarm there
    static def cfg_of(h, bridge)
        var a = HouseAlarm.house_part(h)
        var c = {"sensors": {}, "times": a["times"], "sirens": [], "nopanic": [],
                 "panic": {"ha": a["ha"], "panels": a["panels"], "alarm": a["alarm"], "burst": a["burst"], "devices": []}}
        for it: h.alarm_devices(bridge)
            var id = it[0]
            var r = it[1]
            if r["role"] != 0 || r["notify"] != 0 || r.contains("cond")
                var sc = {"role": HouseAlarm.ROLES[r["role"]], "notify": HouseAlarm.GRADES[r["notify"]]}
                if r["entry"]  sc["entry"] = true end
                if r["sound"]  sc["sound"] = true end
                if r["news"] > 0  sc["news"] = r["news"] end
                if r.contains("cond")  sc["cond"] = r["cond"] end
                c["sensors"][id] = sc
            end
            if r["siren"]  c["sirens"].push(id) end
            if r["nopanic"]  c["nopanic"].push(id) end
            if r.contains("act")  c["panic"]["devices"].push([id, r["act"]]) end
        end
        return c
    end

    # --- a panel: the screens' model -------------------------------------------------------------------------------------------

    # The model the alarm's screens read (panel_alarm.be's cfg), of every bridge of the house: {"t", "p", "b", "s", "np", "pd", "sensors": {id: [role, entry,
    # notify, sound, key, way, limit, news]}}, as a bridge says its own (ZbBridgeAlarm.send_config)
    static def panel_cfg(h)
        var a = HouseAlarm.house_part(h)
        var cfg = {"t": a["times"], "p": [a["ha"] ? 1 : 0, a["panels"] ? 1 : 0, a["alarm"] ? 1 : 0], "b": a["burst"], "s": [], "np": [], "pd": [], "sensors": {}}
        for b: h.bridges()
            for it: h.alarm_devices(b)
                var id = it[0]
                var r = it[1]
                if r["role"] != 0 || r["notify"] != 0 || r.contains("cond")
                    var c = r.find("cond")
                    cfg["sensors"][id] = [HouseAlarm.ROLES[r["role"]], r["entry"] ? 1 : 0, HouseAlarm.GRADES[r["notify"]], r["sound"] ? 1 : 0,
                                          c != nil ? c["k"] : "", c != nil ? c["w"] : "", c != nil ? c["x"] : 0, r["news"] > 0 ? r["news"] : HouseAlarm.NEWS_H]
                end
                if r["siren"]  cfg["s"].push(id) end
                if r["nopanic"]  cfg["np"].push(id) end
                if r.contains("act")  cfg["pd"].push([id, r["act"]]) end
            end
        end
        return cfg
    end

    # --- a panel: a word of the screens, into the list --------------------------------------------------------------------------

    # Every bridge's devices in the alarm, by bridge: {bridge: [[id, record], ...]}
    static def all_devices(h)
        var out = {}
        for b: h.bridges()  out[b] = h.alarm_devices(b) end
        return out
    end

    # A device's record and the bridge it is under: [bridge, record], or [owner, a new record] when no bridge has one
    static def find(all, id, owner)
        for b: all.keys()
            for it: all[b]
                if it[0] == id return [b, it[1]] end
            end
        end
        return [owner, {"role": 0, "notify": 0, "entry": false, "sound": false, "siren": false, "nopanic": false, "news": 0}]
    end

    # the bridge a record goes under: the one that owns the device now, or, with none known, the one it was under
    static def under(found, owner)
        return owner >= 1 ? owner : found[0]
    end

    # whether a record still says anything, or is to go
    static def empty(r)
        return r["role"] == 0 && r["notify"] == 0 && !r.contains("cond") && !r["siren"] && !r["nopanic"] && !r.contains("act")
    end

    # A device's record put under its bridge (the bridge that owns it now, `owner`), and out of any other's, in `all`; one that says nothing goes
    static def put(all, id, r, owner)
        for b: all.keys()
            var kept = []
            for it: all[b]  if it[0] != id kept.push(it) end end
            all[b] = kept
        end
        if HouseAlarm.empty(r) || owner < 1 return end
        if !all.contains(owner)  all[owner] = [] end
        all[owner].push([id, r])
    end

    # the panel's model of a bridge's configuration (panel_alarm.be's cfg) as the house's part and the records of that bridge, for the first word
    static def seed_from(model, all, owner)
        var t = model.find("t", [30, 30, 300])
        var p = model.find("p", [1, 0, 0])
        var a = {"times": t, "ha": p[0] == 1, "panels": p[1] == 1, "alarm": p[2] == 1, "burst": model.find("b", [8, 3])}
        var s = model.find("sensors", {})
        for id: s.keys()
            var row = s[id]
            var r = HouseAlarm.find(all, id, owner(id))[1]
            r["role"] = HouseAlarm.ROLES.find(row[0]) != nil ? HouseAlarm.ROLES.find(row[0]) : 0
            r["entry"] = row[1] == 1
            r["notify"] = HouseAlarm.GRADES.find(row[2]) != nil ? HouseAlarm.GRADES.find(row[2]) : 0
            r["sound"] = row[3] == 1
            if row[4] != ""  r["cond"] = {"k": row[4], "w": row[5], "x": row[6]} end
            if row[7] != HouseAlarm.NEWS_H  r["news"] = row[7] end
            HouseAlarm.put(all, id, r, owner(id))
        end
        for k: ["s", "np"]
            for id: model.find(k, [])
                var r = HouseAlarm.find(all, id, owner(id))[1]
                r[k == "s" ? "siren" : "nopanic"] = true
                HouseAlarm.put(all, id, r, owner(id))
            end
        end
        for pair: model.find("pd", [])
            var r = HouseAlarm.find(all, pair[0], owner(pair[0]))[1]
            r["act"] = str(pair[1])
            HouseAlarm.put(all, pair[0], r, owner(pair[0]))
        end
        return a
    end

    # A word of the alarm's screens (ZbBridgeAlarm.SETS), written into the list: the house's part, or the record of the device it names, under the bridge
    # `owner(id)` gives. `seed`, the screens' model of the bridge of the house, starts a house whose list has no alarm yet. True when it was written
    static def edit(h, m, owner, seed)
        import string
        var verb = m.find("do")
        if !h.writes() || ["sensor", "times", "panic_cfg", "siren", "burst"].find(verb) == nil return false end
        var all = HouseAlarm.all_devices(h)
        var a = h.alarm_setting()
        if a == nil  a = isinstance(seed, map) ? HouseAlarm.seed_from(seed, all, owner) : HouseAlarm.house_part(h) end
        if verb == "times"
            var keys = ["exit", "entry", "siren"]
            var t = [a["times"][0], a["times"][1], a["times"][2]]
            for i: 0 .. 2
                if m.contains(keys[i])
                    var v = int(m[keys[i]])
                    if v < 0 || v > 900 return false end
                    t[i] = v
                end
            end
            a["times"] = t
        elif verb == "panic_cfg"
            for k: ["ha", "panels", "alarm"]  if m.contains(k) a[k] = m[k] == true end end
            if m.contains("burst")
                var b = m["burst"]
                if !isinstance(b, list) || size(b) != 2 return false end
                a["burst"] = [int(b[0]), int(b[1])]
            end
            if m.contains("devices")
                if !isinstance(m["devices"], list) return false end
                var acts = {}
                for pair: m["devices"]
                    if !isinstance(pair, list) || size(pair) != 2 return false end
                    acts[HouseAlarm.norm(pair[0])] = str(pair[1])
                end
                # every device's action: the ones named, and none for the others
                var ids = []
                for b: all.keys()  for it: all[b] if it[1].contains("act") ids.push(it[0]) end end end
                for id: acts.keys()  if ids.find(id) == nil ids.push(id) end end
                for id: ids
                    var f = HouseAlarm.find(all, id, owner(id))
                    var r = f[1]
                    if acts.contains(id) r["act"] = acts[id] elif r.contains("act") r.remove("act") end
                    HouseAlarm.put(all, id, r, HouseAlarm.under(f, owner(id)))
                end
            end
        else
            var id = m.find("id")
            if type(id) != "string" return false end
            id = HouseAlarm.norm(id)
            var f = HouseAlarm.find(all, id, owner(id))
            var r = f[1]
            if verb == "siren"
                if string.find(id, "/") >= 0 && int(id[string.find(id, "/") + 1 ..]) < 1 return false end
                r["siren"] = m.find("on", true) == true
            elif verb == "burst"
                r["nopanic"] = m.find("on", true) != true
            else
                var role = m.find("role")
                if role != nil
                    if HouseAlarm.ROLES.find(role) == nil return false end
                    r["role"] = HouseAlarm.ROLES.find(role)
                end
                var notify = m.find("notify")
                if notify != nil
                    if HouseAlarm.GRADES.find(notify) == nil return false end
                    r["notify"] = HouseAlarm.GRADES.find(notify)
                end
                if m.contains("entry")  r["entry"] = m["entry"] == true end
                if m.contains("sound")  r["sound"] = m["sound"] == true end
                if m.contains("news")  r["news"] = int(m["news"]) end
                if m.contains("key")
                    var w = m.find("way")
                    if (w != "above" && w != "below") || type(m["key"]) != "string" return false end
                    r["cond"] = {"k": m["key"], "w": w, "x": m.find("limit", 0)}
                end
                if m.find("cond") == false && r.contains("cond")  r.remove("cond") end
            end
            HouseAlarm.put(all, id, r, HouseAlarm.under(f, owner(id)))
        end
        # the house's part, and every bridge's records that changed, each in its pages
        if !h.set_alarm(a) return false end
        for b: all.keys()
            if !h.set_alarm_devices(b, all[b]) return false end
        end
        return true
    end

    # A device that left the network, out of the alarm of the house too (ZbBridgeAlarm.forget's, on a bridge, for its own): true when the list had it
    static def forget(h, ieee)
        if !h.writes() || h.alarm_setting() == nil return false end
        var all = HouseAlarm.all_devices(h)
        var changed = false
        for b: all.keys()
            var kept = []
            for it: all[b]
                var n = HouseAlarm.norm(it[0])
                if n != ieee && !(size(n) > size(ieee) && n[0 .. size(ieee) - 1] == ieee && n[size(ieee)] == "/")  kept.push(it) end
            end
            if size(kept) != size(all[b])
                h.set_alarm_devices(b, kept)
                changed = true
            end
        end
        return changed
    end

    # an id as the alarm keys it: "0x" and the IEEE in capitals, and a channel's "/" and endpoint
    static def norm(id)
        import string
        var s = str(id)
        if size(s) > 2 && (s[0 .. 1] == "0x" || s[0 .. 1] == "0X")  s = s[2 ..] end
        return "0x" + string.toupper(s)
    end
end
