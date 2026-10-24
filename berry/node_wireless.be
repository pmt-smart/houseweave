# node_wireless.be -- a node's Wireless settings as another panel of the house shows them: the same screens on a
# panel and on a bridge, drawn by the node from what its own Wi-Fi says (panel_wifi.be, PanelWifi.state), and what a touch there does here. The panel that
# asks keeps the way through them; the node does what the touch asked (a search, a join, the hotspot, a backup) and answers with the screen that follows.
#
# A row is [label, value, kind, colour, target, do]: the first five go to the panel that asks (house_mesh.be, send_view), and `do` stays here. The kinds:
# A row's colour: 0 the theme's, 2 its label in the colour of what changes much, 11 to 13 its value in the colour of a signal (tone).
#   0  a fact, no touch
#   1  another of the node's screens, `target`, asked of it (a screen's "o" effects run as it is first asked: the search, the backup's look)
#   2  a change made here; `do` is [effects, the screen that follows, nil for this one, "back" to close it]
#   3  the asking panel's own screen `target`, with the node's number (the house's channel, the node's web password)
#   4  a text the asking panel types, `target` [title, most characters, value], put in place of "$t" in `do`
#   5  asked first on the asking panel, `target` [question, line, answer], then `do`
#   6  an action the asking panel runs itself, `target` (the house's MQTT, which is one setting for every node)
# A screen is [title, rows, extras]: "o" the effects to run as it is first asked, "a" the time in ms after which a screen that changes by itself (a search,
# a join, the hotspot) is asked again, and "q" the hotspot's [name, password, address, devices], for the QR the asking panel draws.
#
# The state (`s`): {"wifi": PanelWifi.state(), "radio": HouseChannel.mine() or nil, "house_ch": the house's channel or 0, "alone": the house has no other
# node, "mqtt": the MQTT's word, "backup": PanelBackup.state() or nil, "ota": NodeOta.state() or nil}. A network on another channel than the house's takes no touch: joined, it would take
# the node off the mesh (xdrv_98_3), by which it is reached.

#@ solidify:NodeWireless
class NodeWireless
    static VIEWS = ["wireless", "wifi", "wifiConnect", "wifiSearch", "wifiAsk", "wifiJoin", "wifiHotspot", "backup", "ota"]
    # the security of a network the station driver cannot join (as PanelUi.WIFI_UNSUPPORTED)
    static UNSUPPORTED = [5, 10, 13, 14, 15, 16]
    static ASK_MS = 1500
    static SPOT_MS = 3000

    # What the asking panel gets for the screen `view`, touched on its row `k` (nil: asked) with `x` ({"t": a text typed, "y": 1 once asked first}):
    # [the screen, its title, its rows, closed, [], extras] (house_mesh.be, send_view), or nil for a screen or a touch it may not have. `sfn()` reads the
    # node's state, and `run(effects)` does what the touch asked, before the screen that follows is drawn
    static def answer(view, k, x, sfn, run)
        var r = NodeWireless.render(view, sfn())
        if r == nil return nil end
        var next = view
        var closed = false
        if k == nil
            r = NodeWireless.opened(view, r, sfn, run)
        else
            var rows = r[1]
            if type(k) != "int" || k < 0 || k >= size(rows) return nil end
            var row = rows[k]
            var kind = row[2]
            if (kind != 2 && kind != 4 && kind != 5) || size(row) < 6 return nil end
            var t = isinstance(x, map) ? x.find("t") : nil
            if kind == 4 && type(t) != "string" return nil end
            if kind == 5 && (!isinstance(x, map) || x.find("y") != 1) return nil end
            var d = row[5]
            var eff = NodeWireless.fill(d[0], t)
            if size(eff) > 0  run(eff) end
            if d[1] == "back"
                closed = true
            elif d[1] != nil
                next = NodeWireless.fill([d[1]], t)[0]
            end
            r = NodeWireless.render(next, sfn())
            if r == nil return nil end
            if next != view  r = NodeWireless.opened(next, r, sfn, run) end
        end
        var out = []
        for row: r[1]
            var o = row[0 .. 3]
            if size(row) > 4 && row[4] != nil  o.push(row[4]) end
            out.push(o)
        end
        var ex = {}
        var e = size(r) > 2 ? r[2] : nil
        if isinstance(e, map)
            if e.contains("a")  ex["a"] = e["a"] end
            if e.contains("q")  ex["q"] = e["q"] end
        end
        if next != view  ex["g"] = 1 end
        return [next, r[0], out, closed, [], ex]
    end

    # a screen first asked: what it runs as it opens, and the screen again after it
    static def opened(view, r, sfn, run)
        var e = size(r) > 2 ? r[2] : nil
        var o = isinstance(e, map) ? e.find("o") : nil
        if o == nil || size(o) == 0 return r end
        run(o)
        var again = NodeWireless.render(view, sfn())
        return again != nil ? again : r
    end

    # the effects, or a screen, with the text typed in place of "$t"
    static def fill(l, t)
        var out = []
        for e: l
            if isinstance(e, list)
                var c = []
                for v: e  c.push(v == "$t" ? t : v) end
                out.push(c)
            else
                out.push(e == "$t" ? t : e)
            end
        end
        return out
    end

    # the screen `view` of the state `s`, or nil
    static def render(view, s)
        if !isinstance(view, list) || size(view) == 0 || !isinstance(s, map) || !isinstance(s.find("wifi"), map) return nil end
        var w = view[0]
        if w == "wireless" return NodeWireless.wireless(s) end
        if w == "wifi" return NodeWireless.wifi(s) end
        if w == "wifiConnect"
            return ["Connect", [["Search networks", "", 1, 0, ["wifiSearch"]],
                                ["Web setup", "", 2, 0, nil, [[["wifi", "hotspot", "web"]], ["wifiHotspot"]]]]]
        end
        if w == "wifiSearch" return NodeWireless.search(s) end
        if w == "wifiAsk" && size(view) > 1 return NodeWireless.ask(str(view[1])) end
        if w == "wifiJoin" return NodeWireless.joining(s) end
        if w == "wifiHotspot" return NodeWireless.spot(s) end
        if w == "backup" return NodeWireless.backup(s) end
        if w == "ota" return NodeWireless.ota(s) end
        return nil
    end

    # Wireless settings: the Wi-Fi, the radio's channel under it, in the colour of what is wrong when it is not the house's, and the access point seen off
    # the channel, which opens the house's channel; the address, the MQTT, the OTA (a panel's backup in it), and the web password
    static def wireless(s)
        var w = s["wifi"]
        var rows = [["Wi-Fi", NodeWireless.wifi_word(w), 1, 0, ["wifi"]]]
        var r = s.find("radio")
        if isinstance(r, map)
            var hc = s.find("house_ch", 0)
            rows.push(["Channel", r["mesh"] > 0 ? str(r["mesh"]) : "None", 0, hc > 0 && r["mesh"] != hc ? 2 : 0])
            if r["off"] > 0  rows.push(["Access point", "On channel " + str(r["off"]), 3, 2, ["houseChannel"]]) end
        end
        if w.find("up", false)  rows.push(["IP address", str(w.find("ip", "")), 0, 0]) end
        rows.push(["MQTT", str(s.find("mqtt", "Off")), 6, 0, ["mqttOpen"]])
        var o = s.find("ota")
        if isinstance(o, map)
            rows.push(["OTA", NodeWireless.ota_word(o), 1, 0, ["ota"]])
        elif isinstance(s.find("backup"), map)
            rows.push(["Backup", NodeWireless.backup_word(s["backup"]), 1, 0, ["backup"]])
        end
        rows.push(["Web password", "", 3, 0, ["houseWebpw"]])
        return ["Wireless settings", rows]
    end

    # the Wi-Fi in a word: its network, off, why it does not come up, or none
    static def wifi_word(w)
        var h = w.find("hotspot")
        if isinstance(h, map) && h.find("state") == "up" return h.find("kind") == "web" ? "Web setup" : "Hotspot" end
        if w.find("up", false) return str(w.find("ssid", "")) end
        var saved = str(w.find("saved", ""))
        if saved == "" return "None" end
        if w.find("off", false) return "Off" end
        return w.find("reason", "") != "" ? NodeWireless.reason(w["reason"]) : "Connecting"
    end

    # The Wi-Fi, as the panel's own (panel_ui.be, wifi_view): connected, off, a network saved that does not come up, or none
    static def wifi(s)
        var w = s["wifi"]
        var rows = []
        var saved = str(w.find("saved", ""))
        var h = w.find("hotspot")
        var spot = isinstance(h, map) && h.find("state") == "up" ? ["Hotspot", "on", 1, 0, ["wifiHotspot"]]
                                                                 : ["Hotspot", "", 2, 0, nil, [[["wifi", "hotspot", "hotspot"]], ["wifiHotspot"]]]
        var forget = ["Forget network", "", 5, 2, ["Forget the network?", "The Wi-Fi turns off. It stays on the mesh.", "Forget"], [[["wifi", "forget"]], nil]]
        if w.find("up", false)
            rows.push([str(w.find("ssid", "")), "Connected", 0, 0])
            rows.push(["Signal", NodeWireless.dbm(w.find("rssi")), 0, NodeWireless.toned(w.find("rssi"))])
            rows.push(["IP address", str(w.find("ip", "")), 0, 0])
            rows.push(["Connect to another", "", 1, 0, ["wifiConnect"]])
            rows.push(["Disconnect", "", 5, 0, ["Disconnect Wi-Fi?", "The web page and Home Assistant stop until you reconnect. It stays on the mesh.", "Disconnect"],
                       [[["wifi", "off"]], nil]])
            rows.push(spot)
            rows.push(forget)
        elif saved != "" && w.find("off", false)
            rows.push([saved, "Off", 0, 0])
            rows.push(["Reconnect", "", 2, 0, nil, [[["wifi", "on"]], nil]])
            rows.push(spot)
            rows.push(forget)
        elif saved != ""
            rows.push([saved, w.find("reason", "") != "" ? NodeWireless.reason(w["reason"]) : "Connecting", 0, 0])
            rows.push(["Change password", "", 4, 0, [saved, 63, ""], [[["wifi", "join", saved, "$t", 0, ""]], ["wifiJoin"]]])
            rows.push(["Connect", "", 1, 0, ["wifiConnect"]])
            rows.push(spot)
            rows.push(forget)
        else
            rows.push(["Network", "None", 0, 0])
            rows.push(["Connect", "", 1, 0, ["wifiConnect"]])
            rows.push(spot)
        end
        rows.push(["MAC", str(w.find("mac", "")), 0, 0])
        return ["Wi-Fi", rows]
    end

    # The networks the node sees, from where it is: searched as the screen is first asked, and again by a touch. One on another channel than the house's
    # is said so and takes no touch
    static def search(s)
        var w = s["wifi"]
        var rows = []
        var ex = {}
        var nets = w.find("networks")
        var busy = w.find("scanning", false)
        if nets == nil && !busy  ex["o"] = [["wifi", "scan"]] end
        if busy || nets == nil
            rows.push(["Searching", "", 0, 0])
            ex["a"] = NodeWireless.ASK_MS
        else
            if size(nets) == 0  rows.push(["No networks found", "", 0, 0]) end
            var hc = s.find("house_ch", 0)
            var alone = s.find("alone", false)
            for n: nets
                var name = str(n[0])
                var auth = n[2]
                var ch = int(n[3])
                if NodeWireless.UNSUPPORTED.find(auth) != nil
                    rows.push([name, "Not supported", 0, 0])
                elif hc > 0 && !alone && ch > 0 && ch != hc
                    rows.push([name, "Channel " + str(ch), 0, 0])
                elif auth == 0
                    rows.push([name, NodeWireless.dbm(n[1]) + ", open", 2, NodeWireless.toned(n[1]), nil, [[["wifi", "join", name, "", ch, n[4]]], ["wifiJoin"]]])
                else
                    rows.push([name, NodeWireless.dbm(n[1]) + (name == str(w.find("saved", "")) ? ", saved" : ""), 4, NodeWireless.toned(n[1]), [name, 63, ""],
                               [[["wifi", "join", name, "$t", ch, n[4]]], ["wifiJoin"]]])
                end
            end
            rows.push(["Search again", "", 2, 0, nil, [[["wifi", "scan"]], nil]])
        end
        rows.push(["Other network", "", 4, 0, ["Network name", 32, ""], [[], ["wifiAsk", "$t"]]])
        return ["Networks", rows, ex]
    end

    # a network typed by its name: its password, or none
    static def ask(name)
        return [name, [["Password", "", 4, 0, [name, 63, ""], [[["wifi", "join", name, "$t", 0, ""]], ["wifiJoin"]]],
                       ["No password", "", 2, 0, nil, [[["wifi", "join", name, "", 0, ""]], ["wifiJoin"]]]]]
    end

    # A join: the seconds left, connected, or why it did not, with Try again
    static def joining(s)
        var w = s["wifi"]
        var j = w.find("join")
        if !isinstance(j, map)
            if w.find("up", false) return [str(w.find("ssid", "")), [["Connected", "", 0, 0], ["Done", "", 6, 0, ["back"]]]] end
            return ["Wi-Fi", [["Not joining", "", 0, 0], ["Back", "", 6, 0, ["back"]]]]
        end
        var ssid = str(j.find("ssid", ""))
        if j.find("state") == "joining"
            var left = j.find("until")
            var secs = type(left) == "int" ? (left - tasmota.millis()) / 1000 : nil
            return [ssid, [["Connecting", secs != nil && secs > 0 ? str(secs) + " s" : "", 0, 0]], {"a": 1000}]
        end
        var why = str(j.find("reason", ""))
        return [ssid, [[NodeWireless.reason(why), why == "TooShort" ? "8 or more" : "", 0, 0],
                       ["Try again", "", 4, 0, [ssid, 63, ""], [[["wifi", "join", ssid, "$t", j.find("channel", 0), j.find("bssid", "")]], nil]],
                       ["Back", "", 6, 0, ["back"]]]]
    end

    # The hotspot, or the web setup, which is the hotspot on Tasmota's Wi-Fi page: its network, its password and where a phone goes, for the QR the
    # asking panel draws; or why it is not up
    static def spot(s)
        var h = s["wifi"].find("hotspot")
        var web = isinstance(h, map) && h.find("kind") == "web"
        var title = web ? "Web setup" : "Hotspot"
        if !isinstance(h, map) || h.find("state") != "up"
            var r = isinstance(h, map) ? h.find("reason") : nil
            var why = !isinstance(h, map) ? "Not open" : r == "Idle" ? "Closed after 15 min" : r == "Busy" ? "The Wi-Fi Manager is open" :
                      r == "Stop" ? "Closed" : r == "Lost" ? "It lost the radio" : "It did not open"
            return [title, [[why, "", 0, 0], ["Back", "", 6, 0, ["back"]]]]
        end
        var address = web ? "http://192.168.4.1/wi" : "http://192.168.4.1"
        var who = h.find("clients", 0) == 0 ? "Waiting for a device" : str(h["clients"]) + (h["clients"] == 1 ? " device on it" : " devices on it")
        return [title, [["Network", str(h.find("ssid", "")), 0, 0], ["Password", str(h.find("password", "")), 0, 0], ["Address", address, 0, 0],
                        ["Devices", who, 0, 0], [web ? "Stop web setup" : "Stop hotspot", "", 2, 2, nil, [[["wifi", "stopHotspot"]], "back"]]],
                {"a": NodeWireless.SPOT_MS, "q": [str(h.find("ssid", "")), str(h.find("password", "")), address, who]}]
    end

    # A panel's backup, as its own (panel_ui.be, backup_view): Back up now while a change has none, the last one, the server's to restore, asked first
    static def backup(s)
        var b = s.find("backup")
        if !isinstance(b, map) return nil end
        var rows = []
        var ex = {}
        var on = b.find("server", "") != ""
        var busy = b.find("busy", "")
        if on && b.find("found") == nil && busy == ""  ex["o"] = [["backup", "look"]] end
        if busy != ""  ex["a"] = NodeWireless.ASK_MS end
        if b.find("pending", false)
            var hint = busy == "saving" ? "Saving" : b.find("result", "") != "" ? str(b["result"]) : "Not saved"
            rows.push(["Back up now", hint, 2, 0, nil, [[["backup", "now"]], nil]])
        end
        var l = b.find("last")
        rows.push(["Last backup", l == nil ? "None" : l.find("when") != nil ? str(l["when"]) : "Saved", 0, 0])
        if on
            var f = b.find("found")
            var hint = busy == "looking" ? "Looking" : busy == "restoring" ? "Restoring" : b.find("restore", "") != "" ? str(b["restore"]) :
                       f == nil ? "None" : l != nil && f.find("at") == l.find("at") ? "" : f.find("when") != nil ? str(f["when"]) : "Found"
            if f != nil
                var from = f.find("when") != nil ? "From " + str(f["when"]) + ": " : ""
                # a bridge's has no zones: its devices' names and its alarm
                var zones = f.find("zones", 0)
                rows.push(["Restore", hint, 5, 0, ["Restore the backup?", from + (zones > 0 ? NodeWireless.plural(zones, "zone", "zones") + ", " : "") +
                           NodeWireless.plural(f.find("devices", 0), "device", "devices") + " and the settings, in place of the ones it has. It restarts.", "Restore"],
                           [[["backup", "restore"]], nil]])
            else
                rows.push(["Restore", hint, 2, 0, nil, [[["backup", "look"]], nil]])
            end
        end
        rows.push(["Server", on ? str(b["server"]) : "Not found", 0, 0])
        return ["Backup", rows, ex]
    end

    # The OTA: the house's server (paired on a panel), a panel's backup, the firmware this node runs, and what the server has for it: a look
    # at it as the screen is first asked, when the last is old; Up to date, or the upgrade to its build, asked first; and why a look or an upgrade did not go
    static def ota(s)
        var o = s.find("ota")
        if !isinstance(o, map) return nil end
        var rows = []
        var ex = {}
        var on = o.find("server", "") != ""
        rows.push(["Server", on ? (o.find("name", "") != "" ? str(o["name"]) : str(o["server"])) : "Not paired", 0, 0])
        var b = s.find("backup")
        if isinstance(b, map)  rows.push(["Backup", NodeWireless.backup_word(b), 1, 0, ["backup"]]) end
        rows.push(["Firmware", NodeOta.short(o.find("build", "")), 0, 0])
        var busy = o.find("busy", "")
        var e = o.find("seen")
        if busy == "upgrading"
            rows.push(["Upgrading", "Restarting", 0, 0])
        elif busy == "looking"
            rows.push(["Release", "Looking", 0, 0])
            ex["a"] = NodeWireless.ASK_MS
        elif on
            if o.find("stale", false)  ex["o"] = [["ota", "look"]] end
            var why = str(o.find("result", ""))
            if !isinstance(e, map) || why != ""
                rows.push(["Release", why != "" ? why : "Not looked at", 2, why != "" ? 2 : 0, nil, [[["ota", "look"]], nil]])
            elif e.find("build", "") == ""
                rows.push(["Release", "None for it", 2, 0, nil, [[["ota", "look"]], nil]])
            elif e["build"] == o.find("build", "")
                rows.push(["Release", "Up to date", 2, 0, nil, [[["ota", "look"]], nil]])
            else
                var to = NodeOta.short(e["build"])
                rows.push(["Upgrade", "to " + to, 5, 2, ["Upgrade the firmware?", "It restarts into its safeboot, takes " + to + " from the server and restarts again, " +
                           "in a few minutes. Keep the power on.", "Upgrade"], [[["ota", "upgrade"]], nil]])
            end
        end
        return ["OTA", rows, ex]
    end

    # the OTA in a word, as its row of Wireless settings says it
    static def ota_word(o)
        if o.find("server", "") == "" return "Not paired" end
        if o.find("busy", "") == "upgrading" return "Upgrading" end
        var e = o.find("seen")
        if !isinstance(e, map) || e.find("build", "") == "" return NodeOta.short(o.find("build", "")) end
        return e["build"] == o.find("build", "") ? "Up to date" : "Upgrade"
    end

    # a backup in a word, as the panel's own row (PanelUi.backup_hint)
    static def backup_word(b)
        if b.find("server", "") == "" return "No server" end
        if b.find("busy", "") == "saving" return "Saving" end
        if b.find("pending", false) return "Not saved" end
        var l = b.find("last")
        return l != nil && l.find("when") != nil ? str(l["when"]) : "Not yet"
    end

    # why a join failed, as the driver says it (as PanelUi.wifi_reason)
    static def reason(r)
        return r == "WrongPassword" ? "Wrong password" : r == "NotFound" ? "Not found" : r == "NoAddress" ? "No IP address" : r == "TooShort" ? "Too short" : "No answer"
    end

    # A signal, the Wi-Fi's or the mesh's, everywhere the panels say one: its number, "-76 dBm", and its colour by its
    # band, green from -67 dBm, yellow down to -80, red below: tone 1, 2 or 3, 0 for none known, and its theme's colour
    static GOOD_DBM = -67
    static FAIR_DBM = -80
    static TONES = ["", "signal-good", "signal-fair", "signal-poor"]
    static def tone(rssi)
        if type(rssi) != "int" || rssi >= 0 return 0 end
        return rssi >= NodeWireless.GOOD_DBM ? 1 : rssi >= NodeWireless.FAIR_DBM ? 2 : 3
    end
    static def tone_of(rssi) return NodeWireless.TONES[NodeWireless.tone(rssi)] end
    static def dbm(rssi) return type(rssi) == "int" && rssi < 0 ? str(rssi) + " dBm" : "" end
    # a row's colour for the signal of its value: 11 to 13, or 0
    static def toned(rssi)
        var t = NodeWireless.tone(rssi)
        return t > 0 ? 10 + t : 0
    end

    static def plural(n, one, many) return str(n) + " " + (n == 1 ? one : many) end
end
