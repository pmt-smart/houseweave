# panel_store.be -- the panel's configuration: plans, zones, devices, and the
# rules that keep them.
#
# The only implementation of the store: the simulator runs this file too, on
# Tasmota's Berry VM (libs/nspanel-sim/vm). berry/test/vectors/store.json holds
# its operations, refusals and upgrades (berry/test/test_panel_store.be).
#
# The document is the JSON persist keeps. Devices and cards are positional lists
# (`[id, name, kind, caps, ctMin, ctMax, model, ep, startup]` and
# `[ref, col, row]`): the ESP32 has no PSRAM, and a map costs well over twice a
# list of the same fields. Zones and screens are maps, because there are few. A
# zone's members are a map, device id -> its slot, 0 for none.
#
# A plan is a matrix of fixed cells, the same size on every panel: 11 x 5 of
# them on the EU and 8 x 8 on the US. A zone is a sub-matrix of it: its grid is
# its size, so a card only says which cell its top-left corner sits on.
# A configuration takes the panel's matrix when its cards fit in it
# (fit_matrix). The document keeps a grid, and the matrix, as the slot of its
# last cell, rows * 100 + cols: one number where a list of two costs the heap a
# list. The operations take and give them as [rows, cols], and
# the matrix as [cols, rows], as PanelPlan has it (matrix).
#
# autoexec.be loads it, after panel_text.be (what the keyboard types) and
# panel_plan.be (where a card goes), with the views that draw what it keeps
#.
#
# Every operation checks first and changes second, so a refusal leaves the
# document as it was. A result is a map: {"ok": true, "value": v, "actions": a}
# or {"ok": false, "refusal": code, "detail": d}.

#@ solidify:PanelStore
class PanelStore
    # the numbers the plan is drawn with
    # one cell of the plan's matrix, the same on every panel so an icon and the
    # room around it are too: a 32 px icon, 8 px between icons across and 14
    # down. 40 is the widest with which the Living room's 8 columns fit the US's 320 px;
    # 46 is the 7 mm touch minimum
    static var CELL_W = 40
    static var CELL_H = 46
    static var ICON = 32
    static var GHOST_LINE = 24     # a line of the dashed card's texts, in the body font
    static var INSET = 2
    static var GRID_MAX = 99        # what a slot can say, row * 100 + col; the matrix stops a grid first
    static var GROUP_MIN = 4        # a zone gets a Zigbee group from this many actuators
    # where a panel's group numbers start, drawn in this range at its first group:
    # from 0x0100, with room above to count up
    static var ZID_FIRST = 0x0100
    static var ZID_SPAN = 0x7E00
    # a panel in a house numbers its groups in a range of its own, by its number, above the drawn ones: the panels share the bridges,
    # and two drawn ranges could meet on one, two zones' lamps in one group
    static var ZID_NODE_FIRST = 0x8000
    static var ZID_PER_NODE = 0x7F
    # the kinds in the order a zone lists them: its counters, and a card's groups summed up.
    # The blind counts second, right after the lamp, and the thermostat third:
    # the counters show three on the EU and two on the US, and the
    # blind, used every day, shows in a zone with a lamp
    static var KIND_ORDER = ["light", "cover", "thermostat", "plug", "switch", "fan", "sensor", "remote", "generic"]
    # how a zone's card is drawn; a zone without the field is "places"
    static var DISPLAYS = ["places", "adaptive", "uniform"]
    # what a device does, in bits
    static var CAP_ONOFF = 1
    static var CAP_LEVEL = 2
    static var CAP_CT = 4
    static var CAP_COLOR = 8
    # a thermostat's: a target temperature, and a mode. It has no on/off cluster, so no
    # CAP_ONOFF and no StartUpOnOff
    static var CAP_SETPOINT = 16
    static var CAP_MODE = 32
    # a blind's: a position, 0 closed to 100 open, that it goes to. It is no on/off
    # device either: no CAP_ONOFF, and no Power ever
    static var CAP_POSITION = 64
    # kinds that take on and off: a sensor or a remote sleeps, and a group cannot reach it; a
    # thermostat and a blind have commands of their own, and no plan of a zone, a button or a
    # group turns them on or off by mistake
    static var ACTUATORS = ["light", "plug", "switch", "fan", "generic"]
    # what a switch of two channels a driver opens and closes moves, by its index, which a blind's record
    # keeps in its [5]: the icon it has, and nothing else
    static var APPS = ["blind", "window", "gate", "other"]
    # the kinds a relay device is: a light, a switch, or other, which is the generic
    static var RELAY_KINDS = ["light", "switch", "generic"]
    # the version of the document this Berry writes, and the newest it reads
    static var FORMAT = 7

    var doc
    var readonly   # the configuration saved on the panel is one this Berry cannot read (load)
    var on_saved   # called as a save writes the configuration, before the flash: the backup's (panel_backup.be), or nil

    def init(doc)
        self.readonly = false
        self.doc = doc != nil ? doc : PanelStore.empty([8, 5])
        PanelStore.upgrade(self.doc)
        # written before the groups moved address: nothing to remove yet
        if !self.doc.contains("stale") self.doc["stale"] = [] end
    end

    # a panel just flashed: an empty plan, no devices, no zones. Its title is "Room", and not "Home", which read as the house
    static def empty(matrix)
        return {
            "v": PanelStore.FORMAT, "matrix": PanelStore.last_cell(matrix), "devices": [],
            "screens": [{"id": "home", "title": "Room", "cards": []}],
            "zones": [], "buttonGroups": [], "nextZid": 1, "seq": 1, "stale": []
        }
    end

    # A matrix, [cols, rows], as the document keeps it: the slot of its last cell
    static def last_cell(matrix)
        return PanelText.make_slot(matrix[1], matrix[0])
    end

    # The plan's matrix, [cols, rows], as PanelPlan takes it
    def matrix()
        var m = self.doc["matrix"]
        return [PanelText.slot_col(m), PanelText.slot_row(m)]
    end

    # An older document, as this version has it, changed in place: version 2
    # to 3, 3 to 4, 4 to 5, 5 to 6, then 6 to 7
    static def upgrade(doc)
        if doc.find("v") == 2 PanelStore.upgrade_v2(doc) end
        if doc.find("v") == 3 PanelStore.upgrade_v3(doc) end
        if doc.find("v") == 4 PanelStore.upgrade_v4(doc) end
        if doc.find("v") == 5 PanelStore.upgrade_v5(doc) end
        if doc.find("v") == 6 PanelStore.upgrade_v6(doc) end
    end

    # A version 6 document, as version 7 has it: a
    # card is drawn as its places, adaptive or uniform. The summary that summed
    # up at any size is gone, and it and auto, which summed up where it fit, are
    # adaptive: on a card of one piece, what auto was
    static def upgrade_v6(doc)
        for z: doc["zones"]
            var d = z.find("display")
            if d == "summary" || d == "auto" z["display"] = "adaptive" end
        end
        doc["v"] = 7
    end

    # A version 5 document, as version 6 has it: a
    # zone's members are a map, id -> slot, where they were a list of
    # [id, slot]; and a zone's grid, [rows, cols], and the plan's matrix,
    # [cols, rows], are the slot of their last cell. A list costs the ESP32 more
    # heap than what it holds. An id listed twice keeps its first
    # slot, and a grid or matrix no slot can say becomes 0, which validate names
    static def upgrade_v5(doc)
        var cell = def (rows, cols)
            var fine = type(rows) == "int" && type(cols) == "int" && rows >= 1 && cols >= 1 &&
                       rows <= PanelStore.GRID_MAX && cols <= PanelStore.GRID_MAX
            return fine ? PanelText.make_slot(rows, cols) : 0
        end
        for z: doc["zones"]
            var members = {}
            for m: z.find("members", [])
                if !members.contains(m[0]) members[m[0]] = m[1] end
            end
            z["members"] = members
            var g = z.find("grid")
            if isinstance(g, list) z["grid"] = size(g) == 2 ? cell(g[0], g[1]) : 0 end
        end
        var m = doc.find("matrix")
        if isinstance(m, list) doc["matrix"] = size(m) == 2 ? cell(m[1], m[0]) : 0 end
        doc["v"] = 6
    end

    # A version 4 document, as version 5 has it: a
    # member is [id, slot], its one place as a number, where it was
    # [id, [slot]]. A list of one costs the ESP32 more heap than the number it
    # holds. A member with no place, which only a document made
    # elsewhere has, keeps 0
    static def upgrade_v4(doc)
        for z: doc["zones"]
            for m: z.find("members", [])
                if isinstance(m[1], list) m[1] = size(m[1]) > 0 ? m[1][0] : 0 end
            end
        end
        doc["v"] = 5
    end

    # A version 3 document, as version 4 has it: a
    # device holds one place. A relay device on several becomes one relay device
    # a place, all on its relay, named as the + names one; a Zigbee device,
    # which is one lamp, keeps its first
    static def upgrade_v3(doc)
        var devices = doc["devices"]
        # an id is taken by a device, or by a member that names one this document lacks
        var taken_ids = {}
        for x: devices taken_ids[x[0]] = true end
        for z: doc["zones"]
            for m: z.find("members", []) taken_ids[m[0]] = true end
        end
        for z: doc["zones"]
            var members = []
            for m: z.find("members", [])
                members.push([m[0], size(m[1]) > 0 ? [m[1][0]] : []])
                if !PanelStore.is_relay_id(m[0]) continue end
                var d = nil
                # the first of an id listed twice, as the TypeScript twin reads it
                for x: devices if x[0] == m[0] d = x break end end
                if d == nil continue end
                var i = 1
                while i < size(m[1])
                    var k = 1
                    while taken_ids.contains("relay:" + str(k)) k += 1 end
                    var copy = d.copy()
                    copy[0] = "relay:" + str(k)
                    taken_ids[copy[0]] = true
                    copy[1] = PanelStore.auto_name_in(doc, d[2])
                    devices.push(copy)
                    members.push([copy[0], [m[1][i]]])
                    i += 1
                end
            end
            z["members"] = members
        end
        doc["v"] = 4
    end

    # A version 2 document, as version 3 has it: each relay had a
    # role, and a zone the marks of the relays that powered its lamps. Now a
    # device says the relay it hangs on. A relay device keeps its relay; one in
    # no zone was a relay waiting in the +, and goes; a zone's power mark goes to
    # its Zigbee devices
    static def upgrade_v2(doc)
        var zoned = {}
        for z: doc["zones"]
            for m: z["members"] zoned[m[0]] = true end
        end
        var devices = []
        for d: doc["devices"]
            var relay = PanelStore.is_relay_id(d[0])
            if relay && !zoned.contains(d[0]) continue end
            if size(d) == 9 d.push(relay ? int(d[0][6 ..]) : 0) end
            devices.push(d)
        end
        doc["devices"] = devices
        for z: doc["zones"]
            var power = z.find("power", [])
            var mark = size(power) > 0 ? power[0] : 0
            for m: z["members"]
                if mark != 0 && !PanelStore.is_relay_id(m[0])
                    for d: devices
                        if d[0] == m[0] && d[9] == 0 d[9] = mark end
                    end
                end
            end
            if z.contains("power") z.remove("power") end
        end
        if doc.contains("relays") doc.remove("relays") end
        doc["v"] = 3
    end

    # --- persistence: the configuration writes only on a user's action, and
    # never inside the touch that caused it (persist.save() blocks).
    # A configuration this Berry cannot read, from a newer one rolled back or
    # not ours at all, is kept as it is: the panel runs on an empty one and does
    # not write it over, or the Zigbee seed a few seconds later would have saved
    # the house away with no one touching anything.
    # a configuration this Berry can read: one of the versions it upgrades from, or its own
    static def readable(doc)
        var v = isinstance(doc, map) ? doc.find("v") : nil
        return v == 2 || v == 3 || v == 4 || v == 5 || v == 6 || v == PanelStore.FORMAT
    end

    # What a configuration holds that the rest of the store does not take as it is, as the name of the field, or nil. validate
    # reads a document as if it were shaped (a list where a list goes, a number where a number does), and a malformed one trips
    # it or, worse, passes it and trips whatever draws the plan, at every boot. Everything here is a field that
    # validate or the first draw reads, and that every document this store ever wrote has: a configuration that works is never
    # turned away by it. A version older than this one is upgraded first (vet)
    static def shaped(doc)
        if !isinstance(doc, map) return "document" end
        for k: ["matrix", "seq", "nextZid"]
            if type(doc.find(k)) != "int" return k end
        end
        for k: ["devices", "screens", "zones", "buttonGroups"]
            if !isinstance(doc.find(k), list) return k end
        end
        for k: ["stale", "events", "scheduleOff"]
            if doc.contains(k) && !isinstance(doc[k], list) return k end
        end
        if doc.contains("remote")
            if !isinstance(doc["remote"], map) return "remote" end
            for k: doc["remote"].keys()
                if type(doc["remote"][k]) != "int" return "remote" end
            end
        end
        for d: doc["devices"]
            if !isinstance(d, list) || size(d) < 10 || type(d[0]) != "string" || type(d[1]) != "string" || type(d[2]) != "string" return "devices" end
            for i: [3, 4, 5, 9]
                if type(d[i]) != "int" return "devices" end
            end
        end
        if size(doc["screens"]) == 0 return "screens" end
        for s: doc["screens"]
            if !isinstance(s, map) || type(s.find("id")) != "string" || type(s.find("title")) != "string" || !isinstance(s.find("cards"), list) return "screens" end
            for c: s["cards"]
                if !isinstance(c, list) || size(c) < 3 || type(c[0]) != "string" || type(c[1]) != "int" || type(c[2]) != "int" return "cards" end
            end
        end
        for z: doc["zones"]
            if !isinstance(z, map) || type(z.find("id")) != "string" || type(z.find("name")) != "string" || type(z.find("screen")) != "string" return "zones" end
            if type(z.find("grid")) != "int" || type(z.find("zid")) != "int" || !isinstance(z.find("buttons"), list) || !isinstance(z.find("zstate"), map) return "zones" end
            var members = z.find("members")
            if !isinstance(members, map) return "zones" end
            for id: members.keys()
                if type(members[id]) != "int" return "zones" end
            end
            if z.contains("holes") && !isinstance(z["holes"], list) return "zones" end
        end
        for g: doc["buttonGroups"]
            if !isinstance(g, map) || type(g.find("zid")) != "int" || !isinstance(g.find("zstate"), map) return "buttonGroups" end
        end
        return nil
    end

    # A configuration this Berry can run, or why not: the document upgraded in place to this version and checked, as [nil,
    # the issues validate finds], or [why, nil] when it is malformed, whichever way it shows (a field the wrong shape, or
    # whatever the upgrade or validate trips on). A document that is not is neither used nor written over (load, and the
    # backup's check before a restore)
    static def vet(doc)
        var out = nil
        try
            PanelStore.upgrade(doc)
            var bad = PanelStore.shaped(doc)
            # the store that is made of it gives it the field it has none of (stale), which a document that is not one is not given
            out = bad == nil ? [nil, PanelStore(doc).validate()] : ["malformed (" + bad + ")", nil]
        except .. as e, m
            out = ["malformed (" + str(e) + ": " + str(m) + ")", nil]
        end
        return out
    end

    def load()
        import persist
        var saved = persist.find("panel_config", nil)
        if saved == nil return end
        var v = isinstance(saved, map) ? saved.find("v") : nil
        var r = nil
        if PanelStore.readable(saved)
            r = PanelStore.vet(saved)
        elif v != nil
            r = ["version " + str(v), nil]
        else
            r = ["not one of ours", nil]
        end
        if r[0] == nil
            self.doc = saved
            if size(r[1]) > 0  log("PANEL: the configuration loaded with " + str(size(r[1])) + " issue(s): " + str(r[1]), 2) end
        else
            # the panel runs on an empty one, and what is saved stays as it is: the glass is alive, and a newer Berry, or a
            # repair, finds it whole
            self.readonly = true
            log("PANEL: the saved configuration is " + r[0] + ", which this Berry cannot run: it is kept, and nothing is saved over it", 1)
        end
    end

    def save_now()
        import persist
        if self.readonly
            log("PANEL: not saved: the configuration on the panel is one this Berry cannot read, and it is kept", 1)
            return
        end
        persist.setmember("panel_config", self.doc)
        # the ones who follow a save (the backup's flag, the names, the schedule's word) are told before the write, so what they
        # keep goes to the flash in the same one; and one that fails is no reason for the write not to be made, nor for the glass
        # to show a save that never happened
        if self.on_saved != nil
            try
                self.on_saved()
            except .. as e, m
                log("PANEL: a listener of the save failed (" + str(e) + ": " + str(m) + ")", 1)
            end
        end
        PanelStore.safe_save(0)
    end

    # persist.save() rewrites the whole _persist.json, and when it fails midway
    # (the heap runs out while it writes, the file system is full) it leaves the
    # file as {}: the house, the lock's pattern and the bridge's mode, gone at the
    # next boot. What it holds in memory is still whole, so a save that works
    # afterwards writes it all back: it waits for heap to spare, and a failed one
    # is tried again. It is the save of every site of the panel, and it never raises: a
    # failed one is a line in the log and not an exception in whoever asked. With `tries` at
    # SAVE_TRIES it is the last: it does not wait, and it is not tried again, for the site that goes on
    # to do what the save was for (a restart, a flash). It says whether the file was written now
    static SAVE_HEAP_KB = 30
    static SAVE_TRIES = 5
    static def safe_save(tries)
        import persist
        tries = tries != nil ? tries : 0
        if tries < PanelStore.SAVE_TRIES && tasmota.memory()["heap_free"] < PanelStore.SAVE_HEAP_KB
            tasmota.set_timer(2000, / -> PanelStore.safe_save(tries + 1))
            return false
        end
        var saved = false
        try
            persist.save()
            saved = true
        except .. as e, m
            log("PANEL: saving failed (" + str(e) + ": " + str(m) + ")" + (tries < PanelStore.SAVE_TRIES ? ", trying again" : ""), 1)
            if tries < PanelStore.SAVE_TRIES  tasmota.set_timer(2000, / -> PanelStore.safe_save(tries + 1)) end
        end
        return saved
    end

    def save()
        tasmota.set_timer(0, / -> self.save_now())
    end

    # --- results
    static def ok(value, actions)
        return {"ok": true, "value": value, "actions": actions != nil ? actions : []}
    end

    static def refuse(code, detail)
        return {"ok": false, "refusal": code, "detail": detail}
    end

    # --- lookups
    # a relay device: what one of the panel's relays switches; its relay is the tuple's last field
    static def is_relay_id(id)
        import string
        return string.find(id, "relay:") == 0
    end

    # a card's ref, "z:middle" -> ["z", "middle"]; anything else is not a card
    # --- the channels of a Zigbee device of several

    # A channel's id: the device's IEEE for its first channel, and the IEEE and the channel's endpoint for each other one,
    # "0x00124B0000AA0001/2". Its IEEE, for either
    static def ieee_part(id)
        import string
        var i = string.find(id, "/")
        return i > 0 ? id[0 .. i - 1] : id
    end

    # the ids of a device's channels, the first first; the one id of a device of one
    def channels_of(ieee)
        var out = []
        var lead = ieee + "/"
        var n = size(lead)
        for d: self.doc["devices"]
            if d[0] == ieee || (size(d[0]) > n && d[0][0 .. n - 1] == lead) out.push(d[0]) end
        end
        return out
    end

    # The kind a device is drawn as: a blind that is a window or a gate, by what its driver opens and closes, has the icons
    # of its own; any other device, its kind's
    static def look_of(d)
        if d == nil return "generic" end
        if d[2] == "cover" && size(d) > 5
            if d[5] == 1 return "window" end
            if d[5] == 2 return "gate" end
        end
        return d[2]
    end

    # The kind a group of devices is drawn as, on a zone's counter and its card: the look its devices share, a zone's windows
    # the window's icon, and the kind's own when they differ
    def group_look(devs, kind)
        var look = nil
        for dev: devs
            var l = PanelStore.look_of(self.find_device(dev))
            if look != nil && l != look return kind end
            look = l
        end
        return look != nil ? look : kind
    end

    # A switch of two channels made one device for the driver that opens and closes: its other channels
    # leave the store and their zones, and its first is a blind of the application, in its place, out of its zone's group,
    # whose on and off would run its motor. One already joined takes the application
    def join_channels(ieee, app)
        var first = self.find_device(ieee)
        var a = PanelStore.APPS.find(app)
        if first == nil || a == nil || PanelStore.is_relay_id(ieee) return PanelStore.refuse("no_such_device", nil) end
        if first[2] != "cover" && size(self.channels_of(ieee)) < 2 return PanelStore.refuse("no_channels", nil) end
        for id: self.channels_of(ieee)
            if id != ieee  self.remove_one(id) end
        end
        var zone = self.zone_of(ieee)
        if first[2] != "cover"
            if zone != nil  PanelStore.leave_group(zone, ieee) end
            if PanelStore.auto_named(first[2], first[1])  first[1] = self.auto_name("cover") end
            first[2] = "cover"
            first[3] = PanelStore.CAP_POSITION
            first[4] = 0
        end
        first[5] = a
        self.prune_tap(zone)
        self.sync_button_groups()
        return PanelStore.ok(nil, nil)
    end

    # The driver given back: a switch of two channels again, its second channel a device in the next free
    # place of the first's zone, or in no zone, and both in the zone's group as switches. Its id is the second channel's
    def split_channels(ieee)
        var first = self.find_device(ieee)
        if first == nil || first[2] != "cover" return PanelStore.refuse("not_joined", nil) end
        if PanelStore.auto_named("cover", first[1])  first[1] = self.auto_name("switch") end
        first[2] = "switch"
        first[3] = PanelStore.CAP_ONOFF
        first[4] = 0
        first[5] = 0
        var cid = ieee + "/2"
        if self.find_device(cid) == nil
            self.register_device([cid, self.auto_name("switch"), "switch", PanelStore.CAP_ONOFF, 0, 0, first[6], 2, 0, first[9]])
        end
        var zone = self.zone_of(ieee)
        if zone != nil
            self.join_group(zone, ieee)
            self.add_to_zone(zone["id"], cid)
        end
        self.prune_tap(zone)
        self.sync_button_groups()
        return PanelStore.ok(cid, nil)
    end

    # How a command names a Zigbee device: its IEEE, and with the endpoint for a channel of a device of several, which
    # without it would reach its first endpoint
    def zb_address(id)
        var ieee = PanelStore.ieee_part(id)
        var out = '"Device":"' + ieee + '"'
        if ieee != id || size(self.channels_of(ieee)) > 1
            var d = self.find_device(id)
            if d != nil out += ',"Endpoint":' + str(d[7]) end
        end
        return out
    end

    static def parse_ref(ref)
        import string
        var i = string.find(ref, ":")
        if i < 1 || ref[0 .. i - 1] != "z" return nil end
        return ["z", ref[i + 1 .. size(ref) - 1]]
    end

    def find_device(id)
        for d: self.doc["devices"] if d[0] == id return d end end
        return nil
    end

    def find_zone(id)
        for z: self.doc["zones"] if z["id"] == id return z end end
        return nil
    end

    def find_screen(id)
        for s: self.doc["screens"] if s["id"] == id return s end end
        return nil
    end

    def zone_of(dev)
        for z: self.doc["zones"]
            if z["members"].contains(dev) return z end
        end
        return nil
    end

    static def used_slots(zone)
        var used = []
        for s: zone["members"]
            if s != 0 used.push(s) end
        end
        return used
    end

    # the zone's free slots, in reading order
    static def free_slots(zone)
        var used = PanelStore.used_slots(zone)
        var free = []
        for r: 1 .. PanelText.slot_row(zone["grid"])
            for c: 1 .. PanelText.slot_col(zone["grid"])
                var sl = PanelText.make_slot(r, c)
                if used.find(sl) == nil && PanelStore.in_zone(zone, sl) free.push(sl) end
            end
        end
        return free
    end

    # whether a slot is the zone's: inside its grid, and not a hole
    static def in_zone(zone, slot)
        return PanelStore.slot_in_grid(slot, zone["grid"]) && zone.find("holes", []).find(slot) == nil
    end

    # how many places a zone has: its grid, less its holes
    static def capacity(zone)
        var g = zone["grid"]
        return PanelText.slot_row(g) * PanelText.slot_col(g) - size(zone.find("holes", []))
    end

    # whether a slot is inside a grid, the slot of the grid's last cell
    static def slot_in_grid(slot, grid)
        var r = PanelText.slot_row(slot)
        var c = PanelText.slot_col(slot)
        return r >= 1 && c >= 1 && r <= PanelText.slot_row(grid) && c <= PanelText.slot_col(grid)
    end

    # a zone's grid, [rows, cols]
    static def grid_of(zone)
        var g = zone["grid"]
        return [PanelText.slot_row(g), PanelText.slot_col(g)]
    end

    # where a zone's own card sits on its screen, [row, col] from 0; [0, 0] without one
    def card_corner(zone)
        var sc = self.find_screen(zone["screen"])
        if sc != nil
            for c: sc["cards"]
                if c[0] == "z:" + zone["id"] return [c[2], c[1]] end
            end
        end
        return [0, 0]
    end

    # a slot of a zone as the screen's own place, [row, col] from 1: what the views show
    def slot_place(zone, slot)
        var at = self.card_corner(zone)
        return [at[0] + PanelText.slot_row(slot), at[1] + PanelText.slot_col(slot)]
    end

    # the screen's place [row, col] as a slot of the zone, or nil outside its card
    def place_slot(zone, place)
        var at = self.card_corner(zone)
        var r = place[0] - at[0]
        var c = place[1] - at[1]
        if r < 1 || c < 1 || !PanelStore.in_zone(zone, PanelText.make_slot(r, c)) return nil end
        return PanelText.make_slot(r, c)
    end

    def is_zigbee_actuator(d)
        return d != nil && !PanelStore.is_relay_id(d[0]) && PanelStore.ACTUATORS.find(d[2]) != nil
    end

    # --- the devices of other bridges --------------------------------------------------
    # A device whose bridge is not the one this panel is paired with is remote: the document keeps, in `remote`, the number in the house of the bridge that owns it,
    # by the device's IEEE (its channels have one owner). A map beside the devices and not a field of their records: a panel with none has an empty map, and the
    # record's positions are what they were. A remote device is told what to do over the mesh, and its state comes the same way (panel_route.be, house_state.be);
    # it is never in a Zigbee group, which is a thing of one bridge's network

    # the bridge's number that owns the device, 0 for the panel's own
    def owner_of(dev)
        var r = self.doc.find("remote")
        return r != nil ? r.find(PanelStore.ieee_part(dev), 0) : 0
    end

    def is_remote(dev)
        return self.owner_of(dev) != 0
    end

    # the device is the bridge `node`'s (1 to 254), or the panel's own with 0. A device in a group stays in it: the group is on every bridge that has members of it
    def set_owner(dev, node)
        if PanelStore.is_relay_id(dev) return PanelStore.refuse("relay_device", nil) end
        if self.find_device(dev) == nil return PanelStore.refuse("no_such_device", nil) end
        if type(node) != "int" || node < 0 || node > 254 return PanelStore.refuse("bad_owner", str(node)) end
        var ieee = PanelStore.ieee_part(dev)
        if node != 0
            if !self.doc.contains("remote") self.doc["remote"] = {} end
            self.doc["remote"][ieee] = node
        else
            self.forget_remote(ieee)
        end
        return PanelStore.ok(nil, nil)
    end

    # the devices of each other bridge: owner -> the IEEEs, in order, for the marks the owners are told
    def remote_by_owner()
        var out = {}
        var r = self.doc.find("remote", {})
        for ieee: PanelStore.member_ids(r)
            var n = r[ieee]
            if !out.contains(n) out[n] = [] end
            out[n].push(ieee)
        end
        return out
    end

    # the IEEEs of the devices of the panel's own bridge, in order, a device of several channels once: what the panel marks at its own bridge
    # when the house gives that bridge a number, so that their state comes over the mesh as well
    def own_ieees()
        var out = []
        var seen = {}
        var r = self.doc.find("remote", {})
        for d: self.doc["devices"]
            if PanelStore.is_relay_id(d[0]) continue end
            var ieee = PanelStore.ieee_part(d[0])
            if r.contains(ieee) || seen.contains(ieee) continue end
            seen[ieee] = true
            out.push(ieee)
        end
        return out
    end

    # A device of another room's bridge, taken from what that bridge says of it (house_devices.be: [IEEE, model, Config, name]), into a zone: classified as a paired device
    # is (config_profile), named as the bridge's panels named it or, with no name, as a new device is, the bridge's (set_owner), and in the zone's next place. A refusal
    # leaves nothing: a device the panel has, a zone that is not there or is full, a Config that does not say what it is, a bridge that is not one
    def add_remote_device(zone_id, owner, info)
        import string
        if !isinstance(info, list) || size(info) < 4 || type(info[0]) != "string" || size(info[0]) != 18 || info[0][0 .. 1] != "0x"
            return PanelStore.refuse("bad_device", nil)
        end
        var ieee = "0x" + string.toupper(info[0][2 ..])
        if self.find_zone(zone_id) == nil return PanelStore.refuse("no_such_zone", nil) end
        if type(owner) != "int" || owner < 1 || owner > 254 return PanelStore.refuse("bad_owner", str(owner)) end
        if self.find_device(ieee) != nil return PanelStore.refuse("device_exists", nil) end
        var p = PanelStore.config_profile(info[2])
        if p == nil return PanelStore.refuse("unsupported", ieee) end
        var ct = (p[1] & PanelStore.CAP_CT) != 0 ? PanelStore.CT_DEFAULT : [0, 0]
        var name = size(str(info[3])) > 0 ? str(info[3]) : self.auto_name(p[0])
        self.register_device([ieee, name, p[0], p[1], ct[0], ct[1], str(info[1]), p[2], 0, 0])
        self.set_owner(ieee, owner)
        var r = self.add_to_zone(zone_id, ieee)
        if !r["ok"]
            self.forget_remote(ieee)
            var kept = []
            for d: self.doc["devices"] if d[0] != ieee kept.push(d) end end
            self.doc["devices"] = kept
            return r
        end
        return PanelStore.ok(ieee, nil)
    end

    # the device is no longer another bridge's; the document has no key while it has none
    def forget_remote(ieee)
        var r = self.doc.find("remote")
        if r == nil return end
        r.remove(ieee)
        if size(r) == 0 self.doc.remove("remote") end
    end

    # a device that can be in a zone's group: a Zigbee actuator, of whatever bridge, since the group is on every bridge that has members of it
    def is_group_actuator(d)
        return self.is_zigbee_actuator(d)
    end

    # The bridges that hold the members of the group `zid`, those in it or joining it, by their numbers, 0 for the panel's own, once each: where a group's
    # command goes (panel_route.be)
    def group_bridges(zid)
        var out = []
        for o: self.group_owners()
            if o["zid"] != zid continue end
            for dev: PanelStore.member_ids(o["zstate"])
                var st = o["zstate"][dev]
                if st == "in" || st == "joining"
                    var n = self.owner_of(dev)
                    if out.find(n) == nil  out.push(n) end
                end
            end
        end
        return out
    end

    # Every Zigbee device the panel has with no bridge numbered is the bridge `n`'s: the one it was paired with, once the house numbers it.
    # True when one changed
    def adopt_owner(n)
        if type(n) != "int" || n < 1 || n > 254 return false end
        var changed = false
        for d: self.doc["devices"]
            if PanelStore.is_relay_id(d[0]) continue end
            var ieee = PanelStore.ieee_part(d[0])
            if self.owner_of(ieee) == 0
                if !self.doc.contains("remote") self.doc["remote"] = {} end
                self.doc["remote"][ieee] = n
                changed = true
            end
        end
        return changed
    end

    # The panel left the house: the devices of its bridges go, which in another house would be other bridges' numbers; the relays and the
    # devices of no bridge numbered stay. How many went
    def drop_owned()
        var gone = []
        for d: self.doc["devices"]
            if !PanelStore.is_relay_id(d[0]) && self.owner_of(d[0]) != 0  gone.push(d[0]) end
        end
        for id: gone
            if self.find_device(id) != nil  self.remove_device(id) end
        end
        return size(gone)
    end

    # the devices of the bridge `node`, which left the house, go from this panel. How many went
    def drop_bridge(node)
        var ids = self.remote_by_owner().find(node, [])
        for id: ids
            if self.find_device(id) != nil  self.remove_device(id) end
        end
        return size(ids)
    end

    # where the group numbers of the panel numbered `node` in a house start
    static def node_zid_base(node)
        return PanelStore.ZID_NODE_FIRST + node * PanelStore.ZID_PER_NODE
    end

    # The panel numbered `node` in a house: its groups move to its own range, each member leaving the old number (the store's stale ones) and joining the new one,
    # which the group work does; a panel with no group yet only takes the range. True when something changed
    def zid_space(node)
        if type(node) != "int" || node < 1 || node > 254 return false end
        var base = PanelStore.node_zid_base(node)
        if self.doc.find("zidBase") == base return false end
        self.doc["zidBase"] = base
        self.doc["nextZid"] = base
        for o: self.group_owners()
            var old = o["zid"]
            o["zid"] = self.take_zid()
            for dev: PanelStore.member_ids(o["zstate"])
                self.doc["stale"].push([dev, old])
                if o["zstate"][dev] == "leaving"
                    o["zstate"].remove(dev)
                else
                    o["zstate"][dev] = "joining"
                end
            end
        end
        return true
    end

    def zigbee_members(zone)
        var ids = []
        for dev: PanelStore.member_ids(zone["members"])
            if self.is_group_actuator(self.find_device(dev)) ids.push(dev) end
        end
        return ids
    end

    # the grid a card shows, the slot of its last cell: its zone's
    def ref_grid(ref)
        var p = PanelStore.parse_ref(ref)
        if p == nil return nil end
        var z = self.find_zone(p[1])
        return z != nil ? z["grid"] : nil
    end

    # the cells a card covers, [col, row, cols, rows]: a zone's card is its grid
    def card_block(card)
        var grid = self.ref_grid(card[0])
        return grid != nil ? [card[1], card[2], PanelText.slot_col(grid), PanelText.slot_row(grid)] : nil
    end

    # The cells a card holds, as blocks: its grid whole, or, with holes, one
    # block for each run of its cells along a row
    def card_blocks(card)
        var block = self.card_block(card)
        if block == nil return [] end
        var zone = self.find_zone(PanelStore.parse_ref(card[0])[1])
        if size(zone.find("holes", [])) == 0 return [block] end
        var out = []
        for r: 1 .. block[3]
            var start = 0
            for c: 1 .. block[2] + 1
                var held = c <= block[2] && PanelStore.in_zone(zone, PanelText.make_slot(r, c))
                if held && start == 0 start = c end
                if !held && start != 0
                    out.push([block[0] + start - 1, block[1] + r - 1, c - start, 1])
                    start = 0
                end
            end
        end
        return out
    end

    def screen_blocks(screen, skip)
        var blocks = []
        for c: screen["cards"]
            if c[0] == skip continue end
            for b: self.card_blocks(c) blocks.push(b) end
        end
        return blocks
    end

    def next_id(prefix)
        var id = prefix + str(self.doc["seq"])
        self.doc["seq"] += 1
        return id
    end

    # a grid an operation is given, [rows, cols]: what a slot can say
    static def grid_ok(grid)
        return grid[0] >= 1 && grid[1] >= 1 && grid[0] <= PanelStore.GRID_MAX && grid[1] <= PanelStore.GRID_MAX
    end

    # --- the rules of a document; an empty list is a valid document
    def validate()
        var issues = []
        var doc = self.doc
        if doc["v"] != PanelStore.FORMAT issues.push(["version", str(doc["v"])]) end
        if size(doc["screens"]) == 0 || doc["screens"][0]["id"] != "home" issues.push(["home_first", ""]) end

        var ids = []
        for d: doc["devices"]
            if ids.find(d[0]) != nil issues.push(["device_twice", d[0]]) end
            ids.push(d[0])
            # a relay device is switched by relay 1 or 2; a Zigbee device is powered by one, or by none
            var r = size(d) > 9 ? d[9] : -1
            if (r != 0 && r != 1 && r != 2) || (PanelStore.is_relay_id(d[0]) && r == 0) issues.push(["device_relay", d[0]]) end
        end

        var remote = doc.find("remote", {})
        for ieee: remote.keys()
            if size(self.channels_of(ieee)) == 0 issues.push(["remote_unknown", ieee]) end
            if remote[ieee] < 1 || remote[ieee] > 254 issues.push(["remote_owner", ieee]) end
        end

        var owners = []
        for z: doc["zones"]
            var g = z["grid"]
            # a grid no slot can say holds no slot
            var grid_fine = type(g) == "int" && PanelStore.grid_ok([PanelText.slot_row(g), PanelText.slot_col(g)])
            var seen = []
            var members = z["members"]
            for dev: PanelStore.member_ids(members)
                if ids.find(dev) == nil issues.push(["member_unknown", z["id"] + ":" + dev]) end
                if owners.find(dev) != nil issues.push(["device_two_zones", dev]) end
                owners.push(dev)
                # one device, one place: its slot, or 0 for none
                var s = members[dev]
                if s == 0
                    issues.push(["member_no_slot", z["id"] + ":" + dev])
                else
                    if !grid_fine || !PanelStore.in_zone(z, s) issues.push(["slot_outside", z["id"] + ":" + str(s)]) end
                    if seen.find(s) != nil issues.push(["slot_twice", z["id"] + ":" + str(s)]) end
                    seen.push(s)
                end
            end
            if !grid_fine issues.push(["grid_bounds", z["id"]]) end
            # the holes: inside the grid, once each, and not all of it; what is
            # left may be in pieces
            var holes = z.find("holes", [])
            var bad_hole = false
            for i: 0 .. size(holes) - 1
                if holes.find(holes[i]) != i || !grid_fine || !PanelStore.slot_in_grid(holes[i], g) bad_hole = true end
            end
            if bad_hole || (size(holes) > 0 && size(holes) >= PanelText.slot_row(g) * PanelText.slot_col(g))
                issues.push(["card_holes", z["id"]])
            end
            if self.find_screen(z["screen"]) == nil issues.push(["zone_screen_unknown", z["id"]]) end
            for b: z["buttons"]
                if b != 1 && b != 2 issues.push(["mark_button", z["id"] + ":" + str(b)]) end
            end
            var display = z.find("display")
            if display != nil && PanelStore.DISPLAYS.find(display) == nil issues.push(["display_unknown", z["id"]]) end
            var color = z.find("color")
            if color != nil && !PanelStore.color_ok(color) issues.push(["color_unknown", z["id"]]) end
        end

        var zids = []
        for z: doc["zones"]
            var own = 0
            var screen = self.find_screen(z["screen"])
            if screen != nil
                for c: screen["cards"] if c[0] == "z:" + z["id"] own += 1 end end
            end
            if own != 1 issues.push(["zone_card", z["id"] + ":" + str(own)]) end
            if z["zid"] != 0
                if zids.find(z["zid"]) != nil issues.push(["zid_twice", str(z["zid"])]) end
                zids.push(z["zid"])
            end
        end
        for g: doc["buttonGroups"]
            if zids.find(g["zid"]) != nil issues.push(["zid_twice", str(g["zid"])]) end
            zids.push(g["zid"])
        end
        for zid: zids
            if zid >= doc["nextZid"] issues.push(["zid_ahead", str(zid)]) end
            if zid < PanelStore.zid_base(doc) issues.push(["zid_behind", str(zid)]) end
        end

        # the schedule's events: each once, and for a device or a zone there is
        var uids = []
        for e: doc.find("events", [])
            if !isinstance(e, list) || (size(e) != 8 && size(e) != 9) || uids.find(e[0]) != nil
                issues.push(["event_bad", str(e)])
            else
                uids.push(e[0])
                var f = e[1]
                var gone = false
                if isinstance(f, list)
                    gone = size(f) != 3 || self.find_zone(f[0]) == nil
                else
                    gone = self.find_device(f) == nil
                end
                if gone issues.push(["event_for", e[0]]) end
            end
        end

        var matrix = self.matrix()
        for s: doc["screens"]
            var blocks = []
            for c: s["cards"]
                var b = self.card_block(c)
                if b == nil
                    issues.push(["card_ref", s["id"] + ":" + c[0]])
                    continue
                end
                # a zone's card is on its own screen only: no shortcuts
                if self.find_zone(PanelStore.parse_ref(c[0])[1])["screen"] != s["id"]
                    issues.push(["card_elsewhere", s["id"] + ":" + c[0]])
                end
                var own = self.card_blocks(c)
                var placed = true
                for o: own
                    if !PanelPlan.fits_at(blocks, matrix, o[0], o[1], o[2], o[3]) placed = false end
                end
                if !placed issues.push(["card_place", s["id"] + ":" + c[0]]) end
                for o: own blocks.push(o) end
            end
        end
        return issues
    end

    # --- zones and cards

    # The shape a grid takes at cell `at` of the screen, ignoring the card
    # `skip`: its holes as slots, empty when the whole grid is
    # free; or the refusal
    def shape_at(screen, at, grid, skip)
        var h = PanelPlan.holes_at(self.screen_blocks(screen, skip), self.matrix(), at[0], at[1], grid[1], grid[0])
        if !isinstance(h, list) return PanelStore.refuse("no_room", nil) end
        var slots = []
        for x: h slots.push(PanelText.make_slot(x[1] + 1, x[0] + 1)) end
        return PanelStore.ok(slots, nil)
    end

    # the check of the dashed card: a new zone, its card at cell `at`
    def create_zone(screen_id, name, at, grid)
        var screen = self.find_screen(screen_id)
        if screen == nil return PanelStore.refuse("no_such_screen", nil) end
        if !PanelStore.grid_ok(grid) return PanelStore.refuse("grid_bounds", nil) end
        # what other cards hold inside the grid are its holes
        var shape = self.shape_at(screen, at, grid, nil)
        if !shape["ok"] return shape end
        var id = self.next_id("z")
        var zone = {"id": id, "name": name, "screen": screen_id, "grid": PanelText.make_slot(grid[0], grid[1]),
                    "members": {}, "buttons": [], "zid": 0, "zstate": {}}
        if size(shape["value"]) > 0 zone["holes"] = shape["value"] end
        self.doc["zones"].push(zone)
        screen["cards"].push(["z:" + id, at[0], at[1]])
        return PanelStore.ok(id, nil)
    end

    # Grid… on a zone: a new grid is a new size, with the card where it is,
    # cut at the plan's edge. What other cards hold inside it
    # are holes, and the holes it had stay as far as the new grid reaches;
    # what is left may be in pieces
    def resize_zone(zone_id, grid)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if !PanelStore.grid_ok(grid) return PanelStore.refuse("grid_bounds", nil) end
        var ref = "z:" + zone_id
        var screen = self.find_screen(zone["screen"])
        var card = nil
        if screen != nil
            for c: screen["cards"]
                if c[0] == ref card = c end
            end
        end
        if card != nil
            var m = self.matrix()
            if card[1] + grid[1] > m[0] grid = [grid[0], m[0] - card[1]] end
            if card[2] + grid[0] > m[1] grid = [m[1] - card[2], grid[1]] end
        end
        var last = PanelText.make_slot(grid[0], grid[1])
        var outside = []
        var members = zone["members"]
        for dev: PanelStore.member_ids(members)
            if members[dev] != 0 && !PanelStore.slot_in_grid(members[dev], last) outside.push(dev) end
        end
        if size(outside) > 0 return PanelStore.refuse("grid_drops_member", outside) end
        var holes = []
        for h: zone.find("holes", [])
            if PanelStore.slot_in_grid(h, last) holes.push(h) end
        end
        if card != nil
            var shape = self.shape_at(screen, [card[1], card[2]], grid, ref)
            if !shape["ok"] return shape end
            for h: shape["value"]
                if holes.find(h) == nil holes.push(h) end
            end
            holes = PanelStore.sorted(holes)
            if size(holes) >= grid[0] * grid[1] return PanelStore.refuse("no_room", nil) end
        end
        zone["grid"] = last
        if size(holes) > 0
            zone["holes"] = holes
        elif zone.contains("holes")
            zone.remove("holes")
        end
        return PanelStore.ok(nil, nil)
    end

    # --- devices in zones

    # pairing registered a device: it exists, and belongs to no zone yet
    def register_device(device)
        if self.find_device(device[0]) != nil return PanelStore.refuse("device_exists", nil) end
        self.doc["devices"].push(device)
        return PanelStore.ok(nil, nil)
    end

    # The next group number: the first one is drawn, so
    # two panels almost never share an address, and a member another panel left
    # behind does not obey this one; from there they count up, never reused
    def take_zid()
        if PanelStore.zid_base(self.doc) == 0
            import crypto
            var r = crypto.random(2)
            var base = PanelStore.ZID_FIRST + ((r[0] | (r[1] << 8)) % PanelStore.ZID_SPAN)
            self.doc["zidBase"] = base
            self.doc["nextZid"] = base
        end
        var zid = self.doc["nextZid"]
        self.doc["nextZid"] += 1
        return zid
    end

    # Where a document's group numbers start: drawn at its first group, or, in one
    # written before they were drawn, 1 when it has groups, which counted from 1,
    # and 0, to draw, when it has none yet
    static def zid_base(doc)
        return doc.find("zidBase", doc["nextZid"] > 1 ? 1 : 0)
    end

    # a Zigbee device's standing with the zone's group, if the zone has or needs one
    def join_group(zone, dev)
        if !self.is_group_actuator(self.find_device(dev)) return end
        if zone["zid"] == 0 && size(self.zigbee_members(zone)) >= PanelStore.GROUP_MIN
            # the zone just grew into a group: every Zigbee member joins it
            zone["zid"] = self.take_zid()
            for id: self.zigbee_members(zone) zone["zstate"][id] = "joining" end
        elif zone["zid"] != 0
            zone["zstate"][dev] = "joining"
        end
    end

    # the member leaves the zone's group, and stays as leaving until it confirms
    static def leave_group(zone, dev)
        var standing = zone["zstate"].find(dev)
        if standing == nil return end
        if standing == "in" || standing == "joining"
            zone["zstate"][dev] = "leaving"
        else
            zone["zstate"].remove(dev)
        end
    end

    static def drop_member(zone, dev)
        if zone["members"].contains(dev) zone["members"].remove(dev) end
    end

    # the + of a zone: the device goes to the next free slot
    def add_to_zone(zone_id, dev)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if self.find_device(dev) == nil return PanelStore.refuse("no_such_device", nil) end
        if self.zone_of(dev) != nil return PanelStore.refuse("in_zone", nil) end
        var free = PanelStore.free_slots(zone)
        if size(free) == 0 return PanelStore.refuse("full", nil) end
        zone["members"][dev] = free[0]
        self.join_group(zone, dev)
        self.sync_button_groups()
        return PanelStore.ok(free[0], nil)
    end

    # Editing a device's slot. A slot another device holds is a conflict, and the
    # two can swap: `swap` says the user chose Swap.
    def set_slot(zone_id, dev, slot, swap)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        var members = zone["members"]
        if !members.contains(dev) return PanelStore.refuse("not_member", nil) end
        if !PanelStore.in_zone(zone, slot) return PanelStore.refuse("slot_outside", slot) end
        var other = nil
        for id: PanelStore.member_ids(members)
            if other == nil && id != dev && members[id] == slot other = id end
        end
        if other == nil
            members[dev] = slot
            return PanelStore.ok(nil, nil)
        end
        # a device with no place of its own -- only a document made elsewhere has
        # one -- has none to give the other: no swap, only a refusal
        if members[dev] == 0 return PanelStore.refuse("no_swap", other) end
        if !swap return PanelStore.refuse("slot_taken", {"other": other, "swapTo": members[dev]}) end
        members[other] = members[dev]
        members[dev] = slot
        return PanelStore.ok(nil, nil)
    end

    # Move to zone…: the device takes the target's next free slot
    def move_to_zone(dev, zone_id)
        var from = self.zone_of(dev)
        if from == nil return PanelStore.refuse("not_member", nil) end
        var to = self.find_zone(zone_id)
        if to == nil return PanelStore.refuse("no_such_zone", nil) end
        if to == from return PanelStore.refuse("same_zone", nil) end
        var free = PanelStore.free_slots(to)
        if size(free) == 0 return PanelStore.refuse("full", nil) end
        PanelStore.drop_member(from, dev)
        PanelStore.leave_group(from, dev)
        self.prune_tap(from)
        to["members"][dev] = free[0]
        self.join_group(to, dev)
        self.sync_button_groups()
        return PanelStore.ok(free[0], nil)
    end

    # Remove from panel: out of its zone and the store, and a Zigbee device is
    # told to leave the network. A relay device only leaves the
    # store: the relay itself stays as it is
    def remove_device(dev)
        if self.find_device(dev) == nil return PanelStore.refuse("no_such_device", nil) end
        # a channel of a device of several goes with the device, all its channels
        var ieee = PanelStore.ieee_part(dev)
        if !PanelStore.is_relay_id(dev)
            var all = self.channels_of(ieee)
            if size(all) > 1
                for id: all
                    if id != ieee self.remove_one(id) end
                end
                if self.find_device(ieee) == nil return PanelStore.ok(nil, [["leave", ieee]]) end
                dev = ieee
            end
        end
        return self.remove_one(dev)
    end

    # one device, or one channel, out of its zone and the store; the leave is the device's
    def remove_one(dev)
        self.drop_events(dev, nil)
        var actions = []
        var zone = self.zone_of(dev)
        if zone != nil
            PanelStore.drop_member(zone, dev)
            # it is leaving the network, which takes it out of every group it had
            zone["zstate"].remove(dev)
            self.prune_tap(zone)
        end
        for g: self.doc["buttonGroups"] g["zstate"].remove(dev) end
        # and every old address: a device off the network is in no group at all
        var stale = []
        for s: self.doc["stale"] if s[0] != dev stale.push(s) end end
        self.doc["stale"] = stale
        var kept = []
        for d: self.doc["devices"] if d[0] != dev kept.push(d) end end
        self.doc["devices"] = kept
        # a device of another bridge is not told to leave a network that is not this one's: it goes off the panel's list, and the marks follow the list
        var gone_remote = self.is_remote(dev) && size(self.channels_of(PanelStore.ieee_part(dev))) == 0
        if gone_remote self.forget_remote(PanelStore.ieee_part(dev)) end
        if !PanelStore.is_relay_id(dev) && PanelStore.ieee_part(dev) == dev && !gone_remote && !self.is_remote(dev) actions.push(["leave", dev]) end
        self.sync_button_groups()
        return PanelStore.ok(nil, actions)
    end

    # A device in another's place (the Replace of the options):
    # the new one, given the old one's name and relay, in the old
    # one's zone and place, and the old one out, as a Remove takes it. The actions
    # are the old one's leave.
    def replace_device(old, device)
        var was = self.find_device(old)
        if was == nil return PanelStore.refuse("no_such_device", nil) end
        if self.find_device(device[0]) != nil return PanelStore.refuse("device_exists", nil) end
        var zone = self.zone_of(old)
        var slot = zone != nil ? zone["members"][old] : nil
        # the zone's Tap, when it was the old one: the new one's
        var tap = zone != nil ? zone.find("tap") : nil
        # its schedule too: kept from the remove, which would take it, and the old one's the new one's
        var events = self.doc.find("events")
        var off = self.doc.find("scheduleOff")
        var r = self.remove_device(old)
        if events != nil  self.doc["events"] = events end
        if off != nil  self.doc["scheduleOff"] = off end
        self.retarget_events(old, device[0])
        device[1] = was[1]
        device[9] = was[9]
        self.doc["devices"].push(device)
        if zone != nil
            zone["members"][device[0]] = slot
            self.join_group(zone, device[0])
            if tap != nil
                zone["tap"] = tap[0] == "device" && tap[1] == old ? ["device", device[0]] : tap
                self.prune_tap(zone)
            end
        end
        self.sync_button_groups()
        return PanelStore.ok(device[0], r["actions"])
    end

    # Delete zone: its devices go with it, and its card
    def delete_zone(zone_id)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        var actions = []
        for dev: PanelStore.member_ids(zone["members"])
            var r = self.remove_device(dev)
            for a: r["actions"] actions.push(a) end
        end
        var zones = []
        for z: self.doc["zones"] if z["id"] != zone_id zones.push(z) end end
        self.doc["zones"] = zones
        var ref = "z:" + zone_id
        var screen = self.find_screen(zone["screen"])
        if screen != nil
            var kept = []
            for c: screen["cards"] if c[0] != ref kept.push(c) end end
            screen["cards"] = kept
        end
        self.drop_events(nil, zone_id)
        self.sync_button_groups()
        return PanelStore.ok(nil, actions)
    end

    # --- the schedule's events (panel_schedule.be checks and runs them)

    # what a zone's event is for, [zone, kind, relay]: the zone's devices of the kind its relay powers, as the joint page
    def group_of(f)
        var out = []
        var z = self.find_zone(f[0])
        if z == nil return out end
        for id: PanelStore.member_ids(z["members"])
            var d = self.find_device(id)
            if d != nil && d[2] == f[1] && d[9] == f[2] out.push(id) end
        end
        return out
    end

    # The events that go with what they act on: a device being removed takes its own, the ones of a zone it is the
    # last of, and its schedule switch; a zone being deleted, its own. A zone's that a move or a relay left with no one
    # stays, for the one that comes back
    def drop_events(dev, zone_id)
        var events = self.doc.find("events")
        if events != nil
            var kept = []
            for e: events
                var f = e[1]
                var gone = false
                if isinstance(f, list)
                    var g = zone_id == nil ? self.group_of(f) : []
                    gone = f[0] == zone_id || (size(g) == 1 && g[0] == dev)
                else
                    gone = f == dev
                end
                if !gone kept.push(e) end
            end
            self.doc["events"] = kept
        end
        var off = self.doc.find("scheduleOff")
        if off != nil && dev != nil
            var on = []
            for d: off
                if d != dev on.push(d) end
            end
            self.doc["scheduleOff"] = on
        end
    end

    # a device in another's place takes the other's events and its schedule switch
    def retarget_events(old, new)
        for e: self.doc.find("events", [])
            if !isinstance(e[1], list) && e[1] == old  e[1] = new end
        end
        var off = self.doc.find("scheduleOff", [])
        for i: 0 .. size(off) - 1
            if off[i] == old  off[i] = new end
        end
    end

    # --- screens

    def add_screen(title)
        var id = self.next_id("s")
        self.doc["screens"].push({"id": id, "title": title, "cards": []})
        return PanelStore.ok(id, nil)
    end

    # A name of nothing but spaces, tabs, line ends and no-break spaces (UTF-8
    # C2 A0) is no name: the characters the TypeScript twin knows too
    static def blank(text)
        var i = 0
        while i < size(text)
            var c = text[i]
            if c == "\xC2" && i + 1 < size(text) && text[i + 1] == "\xA0"
                i += 2
            elif c == " " || c == "\t" || c == "\r" || c == "\n"
                i += 1
            else
                return false
            end
        end
        return true
    end

    # a zone's name: its screen's title, and a summary card's label
    def rename_zone(zone_id, name)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if PanelStore.blank(name) return PanelStore.refuse("no_name", nil) end
        zone["name"] = name
        return PanelStore.ok(nil, nil)
    end

    # a zone's colour: 5 hues (the theme's card colour first) at 3 levels, hue * 3 + level
    static def color_ok(c)
        return type(c) == "int" && c >= 0 && c < 15
    end

    # A zone's colour, from the picker. The theme's card
    # colour, whole, is what a zone without the field is, so choosing it drops it
    def set_color(zone_id, color)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if !PanelStore.color_ok(color) return PanelStore.refuse("no_such_color", nil) end
        if color == 0
            if zone.contains("color") zone.remove("color") end
        else
            zone["color"] = color
        end
        return PanelStore.ok(nil, nil)
    end

    # how a zone's card is drawn; Places is what a zone without
    # the field is, so choosing it drops the field and the document stays as it was
    def set_display(zone_id, mode)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if PanelStore.DISPLAYS.find(mode) == nil return PanelStore.refuse("no_such_display", nil) end
        if mode == "places"
            if zone.contains("display") zone.remove("display") end
        else
            zone["display"] = mode
        end
        return PanelStore.ok(nil, nil)
    end

    # a device's name, as its row in the zone shows it
    def rename_device(dev_id, name)
        var device = self.find_device(dev_id)
        if device == nil return PanelStore.refuse("no_such_device", nil) end
        if PanelStore.blank(name) return PanelStore.refuse("no_name", nil) end
        device[1] = name
        return PanelStore.ok(nil, nil)
    end

    # The kinds a device may be, by what it does (Type...): what the
    # interview is sure of stays, a lamp with colour is a light, a dimmer a light
    # or a fan, and a plain on/off anything that is switched.
    # --- what a paired device is ------------------------------------
    #
    # From the interview: the profile and device type of an endpoint (the Zigbee
    # HA and ZLL device ids) decide the kind, and the clusters it serves decide
    # the capabilities. Only a starting point: Type... corrects it.
    static var PROFILE_ZLL = 0xC05E
    static var CT_DEFAULT = [153, 500]
    static var KIND_NAME = {"light": "Light", "plug": "Plug", "switch": "Switch", "fan": "Fan",
                            "cover": "Cover", "thermostat": "Thermostat", "sensor": "Sensor", "remote": "Remote", "generic": "Device"}

    static def device_profile(profile, device_type, clusters)
        var has_color = clusters.find(0x0300) != nil
        var kind = "generic"
        var ct = true
        var color = true
        var t = device_type
        if profile == PanelStore.PROFILE_ZLL
            if t == 0x0000 || t == 0x0100 kind = "light" ct = false color = false
            elif t == 0x0200 kind = "light" ct = false
            elif t == 0x0210 kind = "light"
            elif t == 0x0220 kind = "light" color = false
            elif t == 0x0010 || t == 0x0110 kind = "plug"
            elif t >= 0x0800 && t <= 0x0840 kind = "remote"
            elif t == 0x0850 kind = "sensor"
            end
        else
            if t == 0x0100 || t == 0x0101 kind = "light" ct = false color = false
            elif t == 0x0102 || t == 0x010D kind = "light"
            elif t == 0x010C kind = "light" color = false
            elif [0x0009, 0x0051, 0x010A, 0x010B].find(t) != nil kind = "plug"
            elif t == 0x0002 || t == 0x0003 kind = "switch"
            elif t == 0x0200 || t == 0x0202 kind = "cover"
            elif [0x0000, 0x0001, 0x0006, 0x0103, 0x0104, 0x0105, 0x0203, 0x0800, 0x0810, 0x0820, 0x0830].find(t) != nil kind = "remote"
            elif [0x0106, 0x0107, 0x010E, 0x0302, 0x0402, 0x0850].find(t) != nil kind = "sensor"
            end
        end
        # a type we do not know, with a colour cluster: a lamp, by what it serves
        if kind == "generic" && has_color kind = "light" ct = true color = true end
        # what is served, not what is declared: a remote's clusters are its outputs
        if kind == "remote" || kind == "sensor" return [kind, 0] end
        var caps = (clusters.find(0x0006) != nil ? PanelStore.CAP_ONOFF : 0) | (clusters.find(0x0008) != nil ? PanelStore.CAP_LEVEL : 0)
        if kind == "light" && has_color
            caps = caps | (ct ? PanelStore.CAP_CT : 0) | (color ? PanelStore.CAP_COLOR : 0)
        end
        return [kind, caps]
    end

    # What a device the network already knew is, from Z2T's own record of it:
    # ZbInfo's "Config", entries like "L01.5" -- a letter, the endpoint in two
    # hex digits, and for a light its bulb type (0 on/off .. 5 RGBCW).
    # [kind, caps, ep], or nil when nothing says. A light with no bulb type dims.
    static var BULB_CAPS = [1, 3, 7, 11, 11, 15]
    static def config_profile(config)
        import string
        var found = {}
        for c: config
            if size(c) >= 3 && !found.contains(c[0]) found[c[0]] = c end
        end
        var ep = / c -> int("0x" + c[1 .. 2])
        if found.contains("L")
            var c = found["L"]
            var bulb = size(c) > 4 ? int("0x" + c[4 ..]) : -1
            return ["light", bulb >= 0 && bulb < size(PanelStore.BULB_CAPS) ? PanelStore.BULB_CAPS[bulb] : 3, ep(c)]
        end
        if found.contains("P") return ["plug", 1, ep(found["P"])] end
        if found.contains("O") return ["switch", 1, ep(found["O"])] end
        for k: ["I", "A", "T"]
            if found.contains(k) return ["sensor", 0, ep(found[k])] end
        end
        return nil
    end

    # The endpoints of the channels a device on the network has, by its Config: its on/off entries, "O" or
    # "P", when there are two or more and no light; [] for a device of one
    static def config_channels(config)
        var eps = []
        for c: config
            var e = str(c)
            if size(e) < 3 continue end
            if e[0] == "L" return [] end
            if e[0] == "O" || e[0] == "P"
                var ep = int("0x" + e[1 .. 2])
                if eps.find(ep) == nil eps.push(ep) end
            end
        end
        return size(eps) > 1 ? eps : []
    end

    # whether a name is the one the panel gave a device of the kind: the kind's word and a number
    static def auto_named(kind, name)
        var word = PanelStore.KIND_NAME.find(kind, "Device") + " "
        if size(name) <= size(word) || name[0 .. size(word) - 1] != word return false end
        var n = name[size(word) ..]
        return str(int(n)) == n
    end

    # a paired device's first name: its kind and the smallest number no device has with it
    def auto_name(kind)
        return PanelStore.auto_name_in(self.doc, kind)
    end

    # the same, for a document with no store yet (upgrade_v3)
    static def auto_name_in(doc, kind)
        var word = PanelStore.KIND_NAME.find(kind, "Device")
        var n = 1
        var taken = true
        while taken
            taken = false
            for d: doc["devices"]
                if d[1] == word + " " + str(n) taken = true break end
            end
            if taken n += 1 end
        end
        return word + " " + str(n)
    end

    static def kinds_for(device)
        var kind = device[2]
        var caps = device[3]
        if kind == "cover" || kind == "sensor" || kind == "remote" || kind == "thermostat" return [kind] end
        # a relay device: a light, a switch or other, and a plug or a fan it already is, until it changes
        if PanelStore.is_relay_id(device[0])
            var out = PanelStore.RELAY_KINDS.copy()
            if out.find(kind) == nil  out.push(kind) end
            return out
        end
        if caps & (PanelStore.CAP_CT | PanelStore.CAP_COLOR) return ["light"] end
        if caps & PanelStore.CAP_LEVEL return ["light", "fan", "generic"] end
        return ["light", "plug", "switch", "fan", "generic"]
    end

    def set_kind(dev_id, kind)
        var device = self.find_device(dev_id)
        if device == nil return PanelStore.refuse("no_such_device", nil) end
        var kinds = PanelStore.kinds_for(device)
        if kinds.find(kind) == nil return PanelStore.refuse("kind_incompatible", kinds) end
        device[2] = kind
        self.prune_tap(self.zone_of(dev_id))
        return PanelStore.ok(nil, nil)
    end

    # up and down the carousel; the Home is first and stays first
    def move_screen(screen_id, delta)
        var screens = self.doc["screens"]
        var i = 0
        while i < size(screens) && screens[i]["id"] != screen_id i += 1 end
        if i == size(screens) return PanelStore.refuse("no_such_screen", nil) end
        if screen_id == "home" return PanelStore.refuse("home_screen", nil) end
        var j = delta < 0 ? i - 1 : i + 1
        if j < 1 || j >= size(screens) return PanelStore.refuse("screen_end", nil) end
        var t = screens[i]
        screens[i] = screens[j]
        screens[j] = t
        return PanelStore.ok(nil, nil)
    end

    # Reorganize: every card placed again by the rule, in the order they were
    # made; all of them or none
    def reorganize_screen(screen_id)
        var screen = self.find_screen(screen_id)
        if screen == nil return PanelStore.refuse("no_such_screen", nil) end
        var placed = []
        var at = []
        var matrix = self.matrix()
        for c: screen["cards"]
            var b = self.card_block(c)
            if b == nil return PanelStore.refuse("no_such_ref", c[0]) end
            var p = PanelPlan.place_for(placed, matrix, b[2], b[3])
            if p == nil return PanelStore.refuse("no_room", c[0]) end
            placed.push([p[0], p[1], b[2], b[3]])
            at.push(p)
        end
        for i: 0 .. size(screen["cards"]) - 1
            screen["cards"][i][1] = at[i][0]
            screen["cards"][i][2] = at[i][1]
        end
        return PanelStore.ok(nil, nil)
    end

    # a plan's title, which its header shows; a name of only spaces is not a name
    def rename_screen(screen_id, title)
        var screen = self.find_screen(screen_id)
        if screen == nil return PanelStore.refuse("no_such_screen", nil) end
        if PanelStore.blank(title) return PanelStore.refuse("no_name", nil) end
        screen["title"] = title
        return PanelStore.ok(nil, nil)
    end

    # The Home never goes, and a screen that owns zones does not either: deleting
    # a zone deletes devices, and never in bulk from one touch
    def delete_screen(screen_id)
        if screen_id == "home" return PanelStore.refuse("home_screen", nil) end
        if self.find_screen(screen_id) == nil return PanelStore.refuse("no_such_screen", nil) end
        for z: self.doc["zones"]
            if z["screen"] == screen_id return PanelStore.refuse("screen_has_zones", nil) end
        end
        var kept = []
        for s: self.doc["screens"] if s["id"] != screen_id kept.push(s) end end
        self.doc["screens"] = kept
        return PanelStore.ok(nil, nil)
    end

    # --- buttons and relays

    # the Button N keys of a zone
    def set_mark(zone_id, kind, n, on)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if kind != "button" || (n != 1 && n != 2) return PanelStore.refuse("bad_mark", nil) end
        var marks = zone["buttons"]
        var i = marks.find(n)
        if on && i == nil marks.push(n) end
        if !on && i != nil marks.remove(i) end
        # two values at most: keep them in order the simple way
        if size(marks) == 2 && marks[0] > marks[1]
            marks[0] = 1
            marks[1] = 2
        end
        self.sync_button_groups()
        return PanelStore.ok(nil, nil)
    end

    # relinking a button puts everything back where it started: its marks go
    def clear_button_marks(n)
        for z: self.doc["zones"]
            var i = z["buttons"].find(n)
            if i != nil z["buttons"].remove(i) end
        end
        self.sync_button_groups()
        return PanelStore.ok(nil, nil)
    end

    # the relay a device hangs on: the one that switches a
    # relay device, 1 or 2, or the one that powers a Zigbee device, 0 for none
    def set_relay(dev, n)
        var d = self.find_device(dev)
        if d == nil return PanelStore.refuse("no_such_device", nil) end
        if (n != 0 && n != 1 && n != 2) || (PanelStore.is_relay_id(dev) && n == 0) return PanelStore.refuse("bad_relay", nil) end
        # a relay holds one kind of device: the relay devices it switches, or
        # the Zigbee devices it only powers, never both
        if n != 0 && n != d[9] && (PanelStore.is_relay_id(dev) ? self.relay_powers(n) : self.relay_switches(n))
            return PanelStore.refuse("mixed_relay", nil)
        end
        d[9] = n
        self.prune_tap(self.zone_of(dev))
        return PanelStore.ok(nil, nil)
    end

    # A relay device, from the + of a zone with only a relay marked:
    # what relay n switches, in the zone's next place, born a light and
    # named like a paired lamp. Its id is the first relay:k free; k is only a
    # name, the relay is the tuple's last field
    def add_relay_device(zone_id, n, kind)
        # its kind, from the relay device's screen of the +: a light when it says none
        if kind == nil kind = "light" end
        if PanelStore.RELAY_KINDS.find(kind) == nil return PanelStore.refuse("kind_incompatible", PanelStore.RELAY_KINDS) end
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if n != 1 && n != 2 return PanelStore.refuse("bad_relay", nil) end
        # one that powers Zigbee devices takes no relay device
        if self.relay_powers(n) return PanelStore.refuse("mixed_relay", nil) end
        if size(PanelStore.free_slots(zone)) == 0 return PanelStore.refuse("full", nil) end
        var k = 1
        while self.find_device("relay:" + str(k)) != nil k += 1 end
        var id = "relay:" + str(k)
        self.doc["devices"].push([id, self.auto_name(kind), kind, PanelStore.CAP_ONOFF, 0, 0, "", 0, 0, n])
        self.add_to_zone(zone_id, id)
        return PanelStore.ok(id, nil)
    end

    # every device that hangs on relay n: the relay devices it switches, and the
    # Zigbee devices it powers
    def relay_devices(n)
        var out = []
        for d: self.doc["devices"] if d[9] == n out.push(d) end end
        return out
    end

    # relay n powers Zigbee devices: switching it cuts them off
    def relay_powers(n)
        for d: self.relay_devices(n)
            if !PanelStore.is_relay_id(d[0]) return true end
        end
        return false
    end

    # relay n switches relay devices: a Zigbee device may not hang on it
    def relay_switches(n)
        for d: self.relay_devices(n)
            if PanelStore.is_relay_id(d[0]) return true end
        end
        return false
    end

    # The relay a Zigbee device being added hangs on: the one
    # marked, unless it switches relay devices, when it hangs on none
    def zigbee_relay(n)
        return n != 0 && self.relay_switches(n) ? 0 : n
    end

    # Whether a command over zones may switch relay n: only when
    # every device that hangs on it is in them
    def relay_free(n, zones)
        for d: self.relay_devices(n)
            var found = false
            for z: zones
                if z["members"].contains(d[0]) found = true end
            end
            if !found return false end
        end
        return true
    end

    # each button's Zigbee group equals the sum of the zones marked with it; a
    # member that joins is joining, one that no longer belongs is leaving
    def sync_button_groups()
        for n: 1 .. 2
            var wanted = []
            for z: self.doc["zones"]
                if z["buttons"].find(n) != nil
                    for id: self.zigbee_members(z) wanted.push(id) end
                end
            end
            var group = nil
            for g: self.doc["buttonGroups"] if g["button"] == n group = g end end
            if group == nil && size(wanted) == 0 continue end
            if group == nil
                group = {"button": n, "zid": self.take_zid(), "zstate": {}}
                self.doc["buttonGroups"].push(group)
            end
            var zstate = group["zstate"]
            for id: wanted
                var standing = zstate.find(id)
                if standing == nil || standing == "leaving" zstate[id] = "joining" end
            end
            var ids = []
            for id: zstate.keys() ids.push(id) end
            for id: ids
                if wanted.find(id) != nil continue end
                var standing = zstate[id]
                if standing == "in" || standing == "joining"
                    zstate[id] = "leaving"
                elif standing == "failed"
                    zstate.remove(id)
                end
            end
        end
    end

    # --- turning the plan: a quarter turn of every plan, 8 x 5 cells into 5 x 8,
    # for a configuration that only fits a panel turned
    # (fit_matrix). A turn and not a transpose, which would mirror the room.
    # Cards, grids and slots turn; zones, groups and marks stay. Slots come out
    # in reading order.
    static def sorted(xs)
        var out = []
        for x: xs
            var i = size(out)
            while i > 0 && out[i - 1] > x i -= 1 end
            out.insert(i, x)
        end
        return out
    end

    # --- the Zigbee groups under the zones and the buttons -------------

    static var ZCL_SUCCESS = 0
    static var ZCL_INSUFFICIENT_SPACE = 0x89
    static var ZCL_DUPLICATE_EXISTS = 0x8A
    static var ZCL_NOT_FOUND = 0x8B

    # every group the panel keeps: the zones' that have one, then the buttons'
    def group_owners()
        var out = []
        for z: self.doc["zones"] if z["zid"] != 0 out.push(z) end end
        for g: self.doc["buttonGroups"] out.push(g) end
        return out
    end

    # The device ids of a map keyed by them, a zone's members or a group's
    # zstate, sorted: an order that does not hang on the map's hashing
    static def member_ids(devices)
        var ks = []
        for k: devices.keys() ks.push(k) end
        return PanelStore.sorted(ks)
    end

    # what the groups need, in order: the members on their way out, the old
    # addresses, then the members joining; a failed join waits for retry_failed
    def group_work()
        var out = []
        var owners = self.group_owners()
        for o: owners
            for dev: PanelStore.member_ids(o["zstate"])
                if o["zstate"][dev] == "leaving" out.push(["remove", dev, o["zid"]]) end
            end
        end
        for s: self.doc["stale"] out.push(["remove", s[0], s[1]]) end
        for o: owners
            for dev: PanelStore.member_ids(o["zstate"])
                if o["zstate"][dev] == "joining" out.push(["add", dev, o["zid"]]) end
            end
        end
        return out
    end

    # a device answered a group command: joining, SUCCESS or a membership it
    # already had is in and anything else failed; leaving, SUCCESS or a group it
    # was not in is out, and anything else stays leaving for another try
    def group_answer(op, dev, zid, status)
        var changed = false
        var done = op == "add" ? (status == PanelStore.ZCL_SUCCESS || status == PanelStore.ZCL_DUPLICATE_EXISTS)
                               : (status == PanelStore.ZCL_SUCCESS || status == PanelStore.ZCL_NOT_FOUND)
        for o: self.group_owners()
            if o["zid"] != zid continue end
            var standing = o["zstate"].find(dev)
            if op == "add" && (standing == "joining" || standing == "failed")
                o["zstate"][dev] = done ? "in" : "failed"
                changed = true
            elif op == "remove" && standing == "leaving" && done
                o["zstate"].remove(dev)
                changed = true
            end
        end
        if op == "remove" && done
            var kept = []
            for s: self.doc["stale"]
                if s[0] != dev || s[1] != zid kept.push(s) end
            end
            if size(kept) != size(self.doc["stale"]) changed = true end
            self.doc["stale"] = kept
        end
        return PanelStore.ok(changed, nil)
    end

    # a member leaving does not answer: the group moves to a new address, the
    # members that stay join it and leave the old one, and the silent one is left
    # alone at an address no command uses again
    def move_group(zid)
        var owner = nil
        for o: self.group_owners() if o["zid"] == zid owner = o end end
        if owner == nil return PanelStore.refuse("no_such_group", nil) end
        var next = self.take_zid()
        for dev: PanelStore.member_ids(owner["zstate"])
            if owner["zstate"][dev] == "leaving"
                owner["zstate"].remove(dev)
            else
                self.doc["stale"].push([dev, zid])
                owner["zstate"][dev] = "joining"
            end
        end
        owner["zid"] = next
        return PanelStore.ok(next, nil)
    end

    # what a device says its groups are (GetAllGroups), against the store
    def reconcile(dev, groups)
        var changed = false
        var owners = self.group_owners()
        for o: owners
            var standing = o["zstate"].find(dev)
            var has = groups.find(o["zid"]) != nil
            if standing == "in" && !has
                o["zstate"][dev] = "joining"
                changed = true
            elif (standing == "joining" || standing == "failed") && has
                o["zstate"][dev] = "in"
                changed = true
            elif standing == "leaving" && !has
                o["zstate"].remove(dev)
                changed = true
            end
        end
        for zid: groups
            # this panel's numbers only: another panel's, or a remote's, are not its business
            if zid <= 0 || zid < PanelStore.zid_base(self.doc) || zid >= self.doc["nextZid"] continue end
            var expected = false
            for o: owners
                if o["zid"] == zid && o["zstate"].contains(dev) expected = true end
            end
            if expected continue end
            var known = false
            for s: self.doc["stale"]
                if s[0] == dev && s[1] == zid known = true end
            end
            if known continue end
            self.doc["stale"].push([dev, zid])
            changed = true
        end
        # an old address it is no longer in needs nothing more
        var kept = []
        for s: self.doc["stale"]
            if s[0] != dev || groups.find(s[1]) != nil kept.push(s) end
        end
        if size(kept) != size(self.doc["stale"]) changed = true end
        self.doc["stale"] = kept
        return PanelStore.ok(changed, nil)
    end

    # every failed join, tried again: a table that had no room may have some now
    def retry_failed()
        var n = 0
        for o: self.group_owners()
            for dev: PanelStore.member_ids(o["zstate"])
                if o["zstate"][dev] == "failed"
                    o["zstate"][dev] = "joining"
                    n += 1
                end
            end
        end
        return PanelStore.ok(n, nil)
    end

    def turn_plan(clockwise)
        var cols = PanelText.slot_col(self.doc["matrix"])
        var rows = PanelText.slot_row(self.doc["matrix"])
        # the cards first: where each lands depends on its grid before the turn
        for s: self.doc["screens"]
            for c: s["cards"]
                var b = self.card_block(c)
                if clockwise
                    c[1] = rows - b[1] - b[3]
                    c[2] = b[0]
                else
                    c[1] = b[1]
                    c[2] = cols - b[0] - b[2]
                end
            end
        end
        for z: self.doc["zones"]
            var gr = PanelText.slot_row(z["grid"])
            var gc = PanelText.slot_col(z["grid"])
            var turn = def (sl)
                var r = PanelText.slot_row(sl)
                var k = PanelText.slot_col(sl)
                return clockwise ? PanelText.make_slot(k, gr - r + 1) : PanelText.make_slot(gc - k + 1, r)
            end
            var members = z["members"]
            for dev: PanelStore.member_ids(members)
                if members[dev] != 0 members[dev] = turn(members[dev]) end
            end
            # the holes turn with the grid, and the shape with them
            if z.contains("holes")
                var turned = []
                for sl: z["holes"] turned.push(turn(sl)) end
                z["holes"] = PanelStore.sorted(turned)
            end
            z["grid"] = PanelText.make_slot(gc, gr)
        end
        self.doc["matrix"] = PanelText.make_slot(cols, rows)
    end

    # every card of every screen inside a matrix of this size
    def cards_fit(matrix)
        for s: self.doc["screens"]
            for b: self.screen_blocks(s, nil)
                if b[0] + b[2] > matrix[0] || b[1] + b[3] > matrix[1] return false end
            end
        end
        return true
    end

    # Fit the configuration to the panel it is on, whose matrix is `matrix`.
    # When its cards fit there, it takes that matrix and they stay where they
    # are: the Living room, made 8 x 5, sits on the EU's 11 x 5 and on the US's 8 x 8 as
    # it is. When they only fit turned a quarter -- clockwise into a portrait
    # matrix, counterclockwise into a landscape one -- the plan turns. Otherwise
    # it is refused, and nothing changes. The value is the turn: 1, -1 or 0.
    def fit_matrix(matrix)
        var cols = PanelText.slot_col(self.doc["matrix"])
        var rows = PanelText.slot_row(self.doc["matrix"])
        if cols == matrix[0] && rows == matrix[1] return PanelStore.ok(0, nil) end
        if self.cards_fit(matrix)
            self.doc["matrix"] = PanelStore.last_cell(matrix)
            return PanelStore.ok(0, nil)
        end
        var clockwise = matrix[1] > matrix[0]
        self.turn_plan(clockwise)
        if !self.cards_fit(matrix)
            # and back: a refusal leaves the document as it was
            self.turn_plan(!clockwise)
            return PanelStore.refuse("matrix_mismatch", [cols, rows])
        end
        self.doc["matrix"] = PanelStore.last_cell(matrix)
        return PanelStore.ok(clockwise ? 1 : -1, nil)
    end

    # --- commands

    # The toggle rule (D7): anything on turns everything off, nothing on turns
    # everything on. Unpowered targets do not count; nil when nothing is powered,
    # and then the touch does nothing.
    static def toggle_intent(states)
        var powered = 0
        for s: states
            if s == "on" return "off" end
            if s != "nopower" powered += 1 end
        end
        return powered > 0 ? "on" : nil
    end

    # The Zigbee devices of some zones a command can reach: the actuators with
    # power. The ones that wait for its confirmation.
    def powered_zigbee(zones, relay_on)
        var out = []
        for zone: zones
            for dev: PanelStore.member_ids(zone["members"])
                if self.is_zigbee_actuator(self.find_device(dev)) && !self.unpowered(dev, relay_on) && out.find(dev) == nil out.push(dev) end
            end
        end
        return out
    end

    # a Zigbee device is without power: the relay that powers it is open
    def unpowered(dev, relay_on)
        var d = self.find_device(dev)
        return d != nil && !PanelStore.is_relay_id(dev) && d[9] != 0 && !relay_on[d[9] - 1]
    end

    # the real zones behind a command's parts: a part is a zone with only some of its members
    def scope_of(parts)
        var out = []
        for p: parts
            var z = self.find_zone(p["id"])
            out.push(z != nil ? z : p)
        end
        return out
    end

    # a device's relay: the one it is, or the one that powers it; 0 for none
    def relay_of(dev)
        var d = self.find_device(dev)
        return d != nil ? d[9] : 0
    end

    # Some devices as the groups a zone's counters and a card summed up show:
    # a kind with the relay that switches or powers it, in the
    # kinds' order and then relay 1, relay 2 and none. [[kind, relay, [ids]], ...]
    def groups_of(devs)
        var by = {}
        for dev: devs
            var d = self.find_device(dev)
            var key = (d != nil ? d[2] : "generic") + ":" + str(d != nil ? d[9] : 0)
            if !by.contains(key) by[key] = [] end
            by[key].push(dev)
        end
        var out = []
        for k: PanelStore.KIND_ORDER
            for r: [1, 2, 0]
                var ids = by.find(k + ":" + str(r))
                if ids != nil out.push([k, r, ids]) end
            end
        end
        return out
    end

    # --- what a tap on a zone's card reaches

    # A zone's Tap, as it keeps it in "tap": none for Auto, today's rule; ["all"]; ["group", kind, relay]; or
    # ["device", id]. As a tap takes it: ["auto"] for none, and for one whose group or device the zone no longer has
    def tap_of(zone)
        var t = zone.find("tap")
        return t != nil && self.tap_valid(zone, t) ? t : ["auto"]
    end

    def tap_valid(zone, t)
        if !isinstance(t, list) || size(t) == 0 return false end
        if t[0] == "all" return size(t) == 1 end
        if t[0] == "device" return size(t) == 2 && zone["members"].contains(t[1]) && self.tap_reaches(t[1]) end
        if t[0] != "group" || size(t) != 3 return false end
        for g: self.tap_groups(zone)
            if g[0] == t[1] && g[1] == t[2] return true end
        end
        return false
    end

    # whether a tap drives a device: an actuator, a relay's, a blind or a thermostat; not a sensor or a remote
    def tap_reaches(id)
        var d = self.find_device(id)
        return d != nil && (PanelStore.is_relay_id(id) || PanelStore.ACTUATORS.find(d[2]) != nil || d[2] == "cover" || d[2] == "thermostat")
    end

    # the groups of a zone a Tap chooses from, as its counters have them: [[kind, relay, [ids]], ...]
    def tap_groups(zone)
        var ids = []
        for id: PanelStore.member_ids(zone["members"])
            if self.tap_reaches(id) ids.push(id) end
        end
        return self.groups_of(ids)
    end

    # The Tap of a zone's options, or of its group's page: nil or ["auto"] is Auto
    def set_tap(zone_id, t)
        var zone = self.find_zone(zone_id)
        if zone == nil return PanelStore.refuse("no_such_zone", nil) end
        if t == nil || (isinstance(t, list) && size(t) == 1 && t[0] == "auto")
            if zone.contains("tap") zone.remove("tap") end
            return PanelStore.ok(nil, nil)
        end
        if !self.tap_valid(zone, t) return PanelStore.refuse("tap_unknown", nil) end
        zone["tap"] = t
        return PanelStore.ok(nil, nil)
    end

    # a zone's Tap that lost its group or its device, by a move, a remove or a change of kind or relay, goes back to Auto
    def prune_tap(zone)
        if zone != nil && zone.contains("tap") && !self.tap_valid(zone, zone["tap"]) zone.remove("tap") end
    end

    # The part of a zone a tap on its card reaches, as a zone the plans take: the zone itself for Auto; for All, the
    # zone marked "all", whose blinds and thermostats go with it; for a group or a device, its members only, with the
    # zone's Zigbee group only when they are all its Zigbee members, as a counter's (group_plan)
    def tap_part(zone)
        var t = self.tap_of(zone)
        if t[0] == "auto" return zone end
        if t[0] == "all" return {"id": zone["id"], "members": zone["members"], "zid": zone["zid"], "zstate": zone["zstate"], "all": true} end
        var members = {}
        for id: PanelStore.member_ids(zone["members"])
            var d = self.find_device(id)
            var kept = t[0] == "device" ? id == t[1] : d != nil && d[2] == t[1] && d[9] == t[2]
            if kept  members[id] = zone["members"][id] end
        end
        var whole = true
        for id: self.zigbee_members(zone)
            if !members.contains(id) whole = false end
        end
        return {"id": zone["id"], "members": members, "zid": whole ? zone["zid"] : 0, "zstate": zone["zstate"]}
    end

    # the parts of the zones a button is marked in: each as its Tap says
    def button_parts(n)
        var parts = []
        for z: self.doc["zones"]
            if z["buttons"].find(n) != nil parts.push(self.tap_part(z)) end
        end
        return parts
    end

    # How one command reaches a set of devices: the button's group
    # (primary) for its confirmed members, the zone's group for the others it
    # reaches, a direct command for the rest, the relay for the panel's relays,
    # and nothing for whoever has no power.
    def plan(zones, relay_on, primary)
        var result = {"zids": [], "unicast": [], "relays": [], "skipped": []}
        var scope = self.scope_of(zones)
        var primary_used = false
        for zone: zones
            var zone_used = false
            for dev: PanelStore.member_ids(zone["members"])
                if PanelStore.is_relay_id(dev)
                    # the relay only when all it switches and powers is in the zones commanded
                    var n = self.relay_of(dev)
                    if n != 0 && self.relay_free(n, scope) && result["relays"].find(n) == nil result["relays"].push(n) end
                elif !self.is_zigbee_actuator(self.find_device(dev))
                    continue
                elif self.unpowered(dev, relay_on)
                    result["skipped"].push(dev)
                elif primary != nil && primary["zid"] != 0 && primary["zstate"].find(dev) == "in"
                    primary_used = true
                elif zone["zid"] != 0 && zone["zstate"].find(dev) == "in"
                    zone_used = true
                else
                    result["unicast"].push(dev)
                end
            end
            if zone_used result["zids"].push(zone["zid"]) end
        end
        if primary_used result["zids"].insert(0, primary["zid"]) end
        return result
    end

    def zone_plan(zone_id, relay_on)
        var zone = self.find_zone(zone_id)
        return zone != nil ? self.plan([zone], relay_on, nil) : nil
    end

    # A counter of the zone's screen: only the devices of one
    # group, a kind with the relay that switches or powers them, 0 for none.
    # The zone's group reaches them only when it holds nothing else.
    def group_plan(zone_id, kind, relay, relay_on)
        var zone = self.find_zone(zone_id)
        if zone == nil return nil end
        var members = {}
        for dev: zone["members"].keys()
            var d = self.find_device(dev)
            if d != nil && d[2] == kind && d[9] == relay members[dev] = zone["members"][dev] end
        end
        var only = true
        for dev: self.zigbee_members(zone)
            var d = self.find_device(dev)
            if d[2] != kind || d[9] != relay only = false end
        end
        var part = {"id": zone["id"], "members": members,
                    "zid": only ? zone["zid"] : 0, "zstate": zone["zstate"]}
        return self.plan([part], relay_on, nil)
    end

    # A level for a detail's target: a device, or the devices of one group of a
    # zone, a kind with its relay, that HAVE the capability. The zone's group
    # carries it only when every Zigbee member of the zone is in that group and
    # has it. kind "" is the device zone_id alone.
    def cap_plan(zone_id, kind, relay, cap, relay_on)
        if kind == ""
            var d = self.find_device(zone_id)
            if d == nil || (d[3] & cap) == 0 || PanelStore.is_relay_id(d[0]) return nil end
            return self.device_plan(zone_id, relay_on)
        end
        var zone = self.find_zone(zone_id)
        if zone == nil return nil end
        var members = {}
        for dev: zone["members"].keys()
            if self.has_cap(dev, kind, relay, cap) members[dev] = zone["members"][dev] end
        end
        var whole = true
        for dev: self.zigbee_members(zone)
            if !self.has_cap(dev, kind, relay, cap) whole = false end
        end
        var part = {"id": zone["id"], "members": members,
                    "zid": whole ? zone["zid"] : 0, "zstate": zone["zstate"]}
        return self.plan([part], relay_on, nil)
    end

    def has_cap(dev, kind, relay, cap)
        var d = self.find_device(dev)
        return d != nil && !PanelStore.is_relay_id(dev) && d[2] == kind && d[9] == relay && (d[3] & cap) != 0
    end

    # a device's own row: that device alone
    def device_plan(dev_id, relay_on)
        if self.find_device(dev_id) == nil return nil end
        var zone = self.zone_of(dev_id)
        var alone = {"id": zone != nil ? zone["id"] : "", "members": {dev_id: 0}, "zid": 0, "zstate": {}}
        return self.plan([alone], relay_on, nil)
    end

    # A button's command, to the parts of its zones: by the button's group only while each zone's Tap is the whole
    # zone, Auto or All, whose Zigbee members the group has
    def button_plan(n, relay_on)
        var whole = true
        for z: self.doc["zones"]
            var t = z["buttons"].find(n) != nil ? self.tap_of(z)[0] : "auto"
            if t != "auto" && t != "all" whole = false end
        end
        var group = nil
        if whole
            for g: self.doc["buttonGroups"] if g["button"] == n group = g end end
        end
        return self.plan(self.button_parts(n), relay_on, group)
    end

    # What the toggle rule looks at: live states, and a relay device's relay.
    # "nopower" is what the touch cannot change, left out of the rule: a Zigbee
    # device behind an open relay, and a relay the glass may not switch.
    # A device in `doubt`, with no communication, is "unknown",
    # whatever it last said: the glass shows it as neither on nor off, and a
    # tap tries it. With `unconfirmed`, a command not confirmed yet counts as
    # done: a tap in its pending time turns back what it asked.
    # Without it, what the devices said: whether a card is settled.
    def target_states(zones, live, relay_on, doubt, unconfirmed)
        var states = []
        var scope = self.scope_of(zones)
        for zone: zones
            for dev: zone["members"].keys()
                if PanelStore.is_relay_id(dev)
                    var n = self.relay_of(dev)
                    states.push(n != 0 && self.relay_free(n, scope) ? (relay_on[n - 1] ? "on" : "off") : "nopower")
                elif self.is_zigbee_actuator(self.find_device(dev)) || (zone.find("all", false) && self.whole_only(dev))
                    states.push(self.toggle_state(dev, live, relay_on, doubt, unconfirmed))
                end
            end
        end
        return states
    end

    # One Zigbee device's word for the toggle rule: "nopower", what it was asked and has not
    # confirmed, "unknown" for no communication, or what it last said
    def toggle_state(dev, live, relay_on, doubt, unconfirmed)
        var asked = unconfirmed != nil ? unconfirmed.find(dev) : nil
        if self.unpowered(dev, relay_on) return "nopower" end
        if asked != nil return asked[0] end
        # a device the gate holds (panel_gate.be: the bridge that owns it is not ready) has nothing to act on: the tap does nothing
        if doubt != nil && doubt.contains(dev) return doubt[dev] == "gated" ? "nopower" : "unknown" end
        return live.find(dev, "unknown")
    end

    # a blind or a thermostat: what only a zone whose Tap is All turns with its lamps
    def whole_only(dev)
        var d = self.find_device(dev)
        return d != nil && (d[2] == "cover" || d[2] == "thermostat")
    end

    # The blinds and the thermostats of the parts whose Tap is All that a tap going `intent` turns: each with power
    # and not there already. [thermostats, blinds]
    def all_turned(zones, intent, live, relay_on, doubt, unconfirmed)
        var th = []
        var bl = []
        for zone: zones
            if !zone.find("all", false) continue end
            for id: PanelStore.member_ids(zone["members"])
                if !self.whole_only(id) continue end
                var st = self.toggle_state(id, live, relay_on, doubt, unconfirmed)
                if st == "nopower" || st == intent continue end
                if self.find_device(id)[2] == "thermostat"
                    th.push(id)
                else
                    bl.push(id)
                end
            end
        end
        return [th, bl]
    end

    # The thermostats of some zones that are on and have power: the ones a tap that turns their zone
    # off turns off with it, as a tap never turns one on
    def thermostats_on(zones, live, relay_on)
        var out = []
        for zone: zones
            for dev: PanelStore.member_ids(zone["members"])
                var d = self.find_device(dev)
                if d != nil && d[2] == "thermostat" && live.find(dev) == "on" && !self.unpowered(dev, relay_on) && out.find(dev) == nil
                    out.push(dev)
                end
            end
        end
        return out
    end

    # What a tap on some zones does, the one on their card or on the button marked with them:
    # [its intent, the Zigbee devices that wait for it], or nil for nothing. The actuators and the
    # relays decide which way it goes. The thermostats go off with a zone that goes off, which `plan`, the
    # command's, is given to carry, and are left as they are with one that goes on. Zones with no
    # actuator are their thermostats' (revised): `thermostats_tap`.
    def tap_intent(zones, plan, live, relay_on, doubt, unconfirmed)
        var states = self.target_states(zones, live, relay_on, doubt, unconfirmed)
        if size(states) == 0 return self.thermostats_tap(zones, plan, live, relay_on, doubt, unconfirmed) end
        var intent = PanelStore.toggle_intent(states)
        if intent == nil return nil end
        var waits = self.powered_zigbee(zones, relay_on)
        # a part whose Tap is All turns its thermostats and blinds both ways; the others' thermostats only go off
        var turned = self.all_turned(zones, intent, live, relay_on, doubt, unconfirmed)
        var th = turned[0]
        if intent == "off"
            for id: self.thermostats_on(zones, live, relay_on)
                if th.find(id) == nil  th.push(id) end
            end
        end
        if size(th) > 0
            plan["thermostat"] = th
            for id: th
                if waits.find(id) == nil  waits.push(id) end
            end
        end
        if size(turned[1]) > 0  plan["cover"] = turned[1] end
        return [intent, waits]
    end

    # The blinds of zones that have nothing else a tap reaches: no lamp, plug, switch, fan or relay, and no thermostat.
    # A tap on their card, or their button, is the blinds' cycle; nil for zones with anything else, or
    # with no blind
    def blinds_only(zones)
        var ids = []
        for zone: zones
            for id: PanelStore.member_ids(zone["members"])
                var d = self.find_device(id)
                if d == nil continue end
                if d[2] == "cover"
                    ids.push(id)
                elif d[2] == "thermostat" || PanelStore.is_relay_id(id) || PanelStore.ACTUATORS.find(d[2]) != nil
                    return nil
                end
            end
        end
        return size(ids) > 0 ? ids : nil
    end

    # A tap on zones with no actuator, only thermostats and what a tap does not reach (a sensor): it
    # switches them as a row's icon does, all to Off if one is on and all to Heat if none is, each that
    # has power and is not there already. nil when
    # there is none, or none with power
    def thermostats_tap(zones, plan, live, relay_on, doubt, unconfirmed)
        var ids = []
        var states = []
        # a device is in one zone, and the parts of a zone share none: no thermostat comes twice
        for zone: zones
            for id: PanelStore.member_ids(zone["members"])
                var d = self.find_device(id)
                if d != nil && d[2] == "thermostat"
                    ids.push(id)
                    states.push(self.toggle_state(id, live, relay_on, doubt, unconfirmed))
                end
            end
        end
        var intent = PanelStore.toggle_intent(states)
        if intent == nil return nil end
        var turned = []
        for i: 0 .. size(ids) - 1
            if states[i] != "nopower" && states[i] != intent  turned.push(ids[i]) end
        end
        plan["thermostat"] = turned
        return [intent, turned]
    end
end
