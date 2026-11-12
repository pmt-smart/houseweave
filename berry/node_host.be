# node_host.be -- what a node of the house with no screen is to the house, whatever it is besides: a bridge, with its Zigbee network, or an appliance.
# The house's layer on it (house_mesh.be) and what goes with it: the commands that come over the mesh, the panels that hear it, its Wi-Fi, its OTA, the
# house's server and its backup, the house's MQTT, the screens a panel of the house shows of it, and its way out of the house.
#
# A class of static functions over the NODE, the object of the node's own class (ZbBridgeRelay, zbbridge_relay.be), which keeps the state and is asked for
# what is its own. They are not the methods of a class the node's extends: the firmware's build runs the files in the order of their names, with every
# class of ours declared empty until its own file has run (firmware/overrides/_brain_prelude.be), so a class could only extend one of ours whose file's
# name happened to come before its own.
#
# THE NODE has
#   fields     house (HouseMesh), meshcmd (MeshCmd), wifi (PanelWifi), ota (NodeOta), link (ServerLink) and backup (NodeBackup), each nil where the image has
#              none; heard_from, a map, a panel's number -> millis when it last commanded the node; budget, the most bytes one event carries
#   constants  TAG, what its log lines begin with; ID, what the names of its timers and rules begin with; ROLE, what it tells the house's server it is;
#              MAIN_ROWS, how many rows of its Main settings are its own
#   methods    run(line, via, from), a command line of a panel (MeshCmd's host), which hands NodeHost.run the line first; listen(payload, from), a panel
#              keeps it as the node it says the house's words to; wipe(), back to its image; settings_rows(), the rows of its Main settings that are its
#              own, a new list; apply_mqtt(m), the house's MQTT, with what is its own of it; render_for(view, k, x), its screens
#
# Compiled into the firmware: one class, nothing at the top, every module imported where it is used. It comes before the node's class, which names it, and
# reaches every other class through `global`.

#@ solidify:NodeHost
class NodeHost
    # a panel that commanded the node over the mesh hears its events this long, and so many panels at most hear them
    static LISTEN_MS = 600000
    static LISTENERS_MAX = 8
    # a factory reset's word to the panel goes out before everything does
    static FORGET_WORD_MS = 300
    # and a restart a panel asked for, after the screen that says so (render_for)
    static RESTART_MS = 1500
    # what a search of its Wi-Fi found goes this long after it was last asked for (the heap)
    static SEARCH_KEPT_MS = 120000

    # The house on the node, at its boot: the commands of the mesh, the house's list with its console commands and its MQTT, the node's Wi-Fi, its OTA, the
    # house's server with the node's backup, its screens, and the panels it forgets. `role` is the node's in the house (HouseList.ROLE_...), and `part` the
    # class of what goes in its backup (BridgeBackup), or nil for a node that keeps none. Each piece only where the image has its class
    static def start(node, role, part)
        import global
        # the commands the other nodes of the house send over the mesh to this node: the class waits for the mesh by itself
        if global.contains("MeshCmd")  node.meshcmd = global.MeshCmd(node) end
        # the house's list and the change of the network's key: the class waits for the mesh by itself, and holds nothing until it is in a house
        if !global.contains("HouseMesh") return end
        var house = global.HouseMesh(role)
        node.house = house
        # the console's way of building and reading a house: the commands keep it
        if global.contains("HouseCommands") global.HouseCommands(house) end
        # the house's MQTT, which this node takes as every node does
        if global.contains("HouseMqtt")  house.mqtt = global.HouseMqtt(house, / m -> node.apply_mqtt(m)) end
        # its Wi-Fi as a panel of the house asks for it in this node's Wireless settings (node_wireless.be): the station driver's search, join and
        # hotspot, as a panel's own, and a Disconnect asked there kept across a restart
        if global.contains("PanelWifi")
            node.wifi = global.PanelWifi(nil)
            if node.wifi.station && node.wifi.kept().find("off", false)  node.wifi.radio_off() end
            var rule = node.ID + "_wifi"
            tasmota.add_rule("StaScan", / v -> NodeHost.wifi_said(node, "scan", v), rule)
            tasmota.add_rule("StaJoin", / v -> NodeHost.wifi_said(node, "join", v), rule)
            tasmota.add_rule("StaHotspot", / v -> NodeHost.wifi_said(node, "spot", v), rule)
        end
        # its OTA, from the house's server the list has: a panel that shows it asks again while it changes
        if global.contains("NodeOta") && global.contains("PanelHttp")
            node.ota = global.NodeOta(global.PanelHttp(), / -> house.server(), nil, / -> house)
            # and the house's server's word to it: its backup, as every node's, its upgrade and its state; it says when it is up
            if global.contains("ServerLink") && global.contains("NodeBackup") && part != nil
                var link = global.ServerLink(/ -> house, global.PanelHttp(), / -> NodeHost.server_state(node), nil)
                node.link = link
                if global.contains("MeshHttp")
                    link.mesh = global.MeshHttp(/ -> house, global.PanelHttp(), / -> link.server())
                    # the same way to the server, for the safeboot image of a node with no Wi-Fi
                    node.ota.mesh = link.mesh
                end
                node.backup = global.NodeBackup(part(), global.PanelHttp(), link)
                var ota = node.ota
                link.on("upgrade", / -> {"upgrade": ota.upgrade_asked()})
                link.on("state", / -> {})
                link.hello("boot")
            end
        end
        # and this node's screens, which a panel of the house shows as its Main settings and Wireless settings (house_mesh.be, ask_view)
        house.view_fn = / v, k, x -> node.render_for(v, k, x)
        # and the nodes the house forgets (house_mesh.be, sweep()): the panels that commanded this node
        house.forgets.push(/ m, forgot -> NodeHost.forget(node, m))
    end

    # the panels the house forgot, out of those that commanded this node: `m` has the numbers the house still has
    static def forget(node, m)
        var drop = []
        for k: node.heard_from.keys()
            if !m.contains(k)  drop.push(k) end
        end
        for k: drop  node.heard_from.remove(k) end
    end

    # a line's command: what comes before its first space, in capitals
    static def word(line)
        import string
        var i = string.find(line, " ")
        return string.toupper(i < 0 ? line : line[0 .. i - 1])
    end

    # A command line from a panel of the house, over the mesh (`from`, its number, MeshCmd): the panel is noted as one that hears this node, and the words
    # every node takes are run, ZbRelayListen (the node's listen) and ZbRelayAdmin (admin). True for one of them; false for a line that is the node's own to
    # run or refuse
    static def run(node, line, via, from)
        import string
        var h = node.house
        # a panel of the house that commands this node over the mesh hears its events for a while
        if from != nil && from > 0 && h != nil && h.up && h.list.is_panel(from)  node.heard_from[from] = tasmota.millis() end
        var w = NodeHost.word(line)
        if w != "ZBRELAYLISTEN" && w != "ZBRELAYADMIN" return false end
        var i = string.find(line, " ")
        var payload = i < 0 ? "" : line[i + 1 ..]
        if w == "ZBRELAYLISTEN"
            # a panel that keeps this node as the one of the house's words: it hears its events, and, with a 1, what it says again
            node.listen(payload, from)
        else
            # the node's factory reset and its web password, from any panel of the house, over the mesh only
            NodeHost.admin(node, payload, via, from)
        end
        return true
    end

    # A panel of the house asks for this node's factory reset, or sets or removes its web password: `{"do": "factory", "unlock" or "lock",
    # "pw": the password, for a lock, "n": the panel's word}`. Taken over the mesh only, and only from a panel of the house's list that is not struck off: the frame is
    # sealed with the key of the two nodes, and its `From` is the mesh's own (MeshCmd), so a password can travel in it. The panel is told it was done, by its word, before
    # anything of a reset goes: the reset is this node leaving the house by itself, which the panels hear and strike it off for, and then everything goes
    static def admin(node, payload, via, from)
        import json
        var h = node.house
        if via != "mesh" || from == nil || h == nil || !h.up || !h.list.is_panel(from)
            log(node.TAG + ": an admin word refused: not from a panel of the house over the mesh", 1)
            return false
        end
        var m = json.load(str(payload))
        if !isinstance(m, map) return false end
        var what = str(m.find("do", ""))
        var said = str(m.find("n", ""))
        if what == "lock"
            var pw = str(m.find("pw", ""))
            if !NodeHost.fair_password(pw) return false end
            # WebPassword2 answers with asterisks: the log never has it
            tasmota.cmd("WebPassword2 " + pw)
            log(node.TAG + ": a web password set by the panel " + str(from), 2)
        elif what == "unlock"
            tasmota.cmd('WebPassword2 "')
            log(node.TAG + ": its web password removed by the panel " + str(from), 2)
        elif what == "factory"
            log(node.TAG + ": a factory reset from the panel " + str(from) + ": everything goes in a moment", 2)
            tasmota.set_timer(NodeHost.FORGET_WORD_MS, / -> node.wipe(), node.ID + "_wipe")
        else
            return false
        end
        h.event_node(from, json.dump({"ZbRelayAdmin": {"did": what, "n": said}}))
        return true
    end

    # a web password a panel may give: 8 to 32 printable characters, none that a command line or Tasmota's quoting would take for something else
    static def fair_password(pw)
        if size(pw) < 8 || size(pw) > 32 return false end
        for i: 0 .. size(pw) - 1
            var c = pw[i]
            if c <= " " || c > "~" || c == '"' || c == ";" || c == "\\" return false end
        end
        return true
    end

    # This node's screens, which a panel of the house shows as its Main settings and Wireless settings (house_mesh.be, ask_view):
    # [view, title, rows, closed, effects], each row [label, value, what a touch does (0 nothing, 1 the screen that follows, 2 a change here, 3 the panel's
    # own screen that follows), its colour, the screen]. Its Main settings: the rows that are its own (settings_rows), its Info and a restart, which comes a
    # moment after the answer. Its Wireless settings are every node's (node_wireless.be), with `x` what the touch carries. Nil for any other screen or touch
    static def render_for(node, view, k, x)
        import global
        var w = isinstance(view, list) && size(view) > 0 ? view[0] : nil
        if w != nil && global.contains("NodeWireless") && global.NodeWireless.VIEWS.find(w) != nil
            if node.wifi == nil return nil end
            # what a search found goes a while after it was last asked for (the heap)
            if w == "wifiSearch"
                var id = node.ID + "_wifi_end"
                tasmota.remove_timer(id)
                tasmota.set_timer(NodeHost.SEARCH_KEPT_MS, / -> node.wifi.run("endSearch", []), id)
            end
            return global.NodeWireless.answer(view, k, x, / -> NodeHost.node_state(node), / e -> NodeHost.run_wifi(node, e))
        end
        if w == "settings"
            # the restart's row: after the node's own and its Info
            var at = node.MAIN_ROWS + 1
            if k == at
                log(node.TAG + ": a restart asked by a panel of the house", 2)
                tasmota.set_timer(NodeHost.RESTART_MS, / -> tasmota.cmd("Restart 1"), node.ID + "_restart")
            elif k != nil
                return nil
            end
            var rows = node.settings_rows()
            rows.push(["Info", "", 1, 0, ["info"]])
            rows.push(["Restart", k == at ? "Restarting" : "", 2, 2])
            return [view, "Main settings", rows, false, []]
        end
        if k != nil return nil end
        if w == "info" return [view, "Info", global.HouseMesh.build_rows(), false, []] end
        return nil
    end

    # What this node's network is, for its Wireless settings on a panel (node_wireless.be): its Wi-Fi, its radio's channel and the house's, and its MQTT
    static def node_state(node)
        import mqtt
        var h = node.house
        var m = h != nil ? h.channel_setting() : nil
        var alone = true
        if h != nil
            for id: h.list.ids(false)
                if id != h.list.me  alone = false end
            end
        end
        return {"wifi": node.wifi.state(), "radio": h != nil && h.channel != nil ? h.channel.mine() : nil, "house_ch": m != nil ? m["channel"] : 0,
                "alone": alone, "mqtt": mqtt.connected() ? "Connected" : "Not connected", "ota": node.ota != nil ? node.ota.state() : nil,
                "backup": node.backup != nil ? node.backup.state() : nil}
    end

    # what this node says of itself to the house's server: what it is, what it runs, and its backup
    static def server_state(node)
        import global
        var b = global.contains("PanelBuild") ? global.PanelBuild : nil
        return {"role": node.ROLE, "image": b != nil ? b.IMAGE : "", "build": b != nil ? b.COMMIT : "dev", "date": b != nil ? b.DATE : "",
                "backup": node.backup != nil ? node.backup.brief() : nil}
    end

    # what a panel's touch on this node's Wireless settings asked for: its Wi-Fi's (panel_wifi.be, run), its OTA's (node_ota.be, run), or its backup's
    # (node_backup.be, run)
    static def run_wifi(node, effects)
        for e: effects
            if e[0] == "wifi" && node.wifi != nil  node.wifi.run(e[1], e[2 ..]) end
            if e[0] == "ota" && node.ota != nil  node.ota.run(e[1], e[2 ..]) end
            if e[0] == "backup" && node.backup != nil  node.backup.run(e[1], e[2 ..]) end
        end
    end

    # the station driver's report to this node's Wi-Fi: a search's networks, a join's end, the hotspot's phones (the command's own answer, a word, reaches
    # the same rule, and is not a report)
    static def wifi_said(node, kind, v)
        if node.wifi == nil || !isinstance(v, map) return end
        if kind == "scan"
            node.wifi.scanned(v)
        elif kind == "join"
            node.wifi.joined(v)
        else
            node.wifi.hotspot_said(v)
        end
    end

    # The house's MQTT, as every node takes it (house_mqtt.be): this node on the house's broker, with its own client and topic. Each
    # setting alone, a Backlog would cut a password at a ";"; Tasmota restarts once, after the last
    static def apply_mqtt(node, m)
        def text(v) var s = str(v) return s == "" ? "\"" : s end
        # a house that keeps no password (house_list.be): the one this node has stays, on the same broker, and another broker's is cleared
        var was = tasmota.cmd("MqttHost")
        var same = isinstance(was, map) && str(was.find("MqttHost", "")) == str(m["host"])
        tasmota.cmd("MqttHost " + text(m["host"]))
        tasmota.cmd("MqttPort " + str(int(m["port"])))
        tasmota.cmd("MqttUser " + text(m["user"]))
        if m.find("keep") != true || !same  tasmota.cmd("MqttPassword2 " + text(m.find("keep") == true ? "" : m["password"])) end
        log(node.TAG + ": the house's MQTT, on " + str(m["host"]) + ": Tasmota restarts", 2)
    end

    # The panels this node's events go to over the mesh, by their numbers: those that commanded it in the last LISTEN_MS, which
    # include the ones that keep it as the node of the house's words (listen), and those that show its devices (their marks); LISTENERS_MAX at most. A
    # panel that shows nothing of it and said nothing to it hears nothing
    static def listeners(node)
        var out = []
        var h = node.house
        if h == nil || !h.up return out end
        var now = tasmota.millis()
        var gone = []
        for p: node.heard_from.keys()
            if now - node.heard_from[p] >= NodeHost.LISTEN_MS
                gone.push(p)
            elif out.find(p) == nil && h.list.is_panel(p)
                out.push(p)
            end
        end
        for p: gone  node.heard_from.remove(p) end
        for p: h.state.marks.keys()
            if out.find(p) == nil && h.list.is_panel(p)  out.push(p) end
        end
        while size(out) > NodeHost.LISTENERS_MAX  out.pop() end
        return out
    end

    # One message to the panels that hear this node, now, over the mesh: a frame to each, which must fit its room
    static def send_text(node, msg)
        var h = node.house
        if h == nil return end
        for p: NodeHost.listeners(node)
            if !h.event_node(p, msg)
                log(node.TAG + ": an event of " + str(size(msg)) + " bytes did not go to the panel " + str(p), 3)
            end
        end
    end

    # an event, a map, to the panels that hear this node, at once
    static def send_event(node, event)
        import json
        NodeHost.send_text(node, json.dump(event))
    end

    # The most one event carries: an ESP-NOW frame's, and what a frame of the mesh to each panel that hears this node carries, when it is less
    static def frame_budget(node)
        var b = node.budget
        var h = node.house
        if h != nil
            for p: NodeHost.listeners(node)
                var room = h.node_room(p)
                if room > 0 && room < b  b = room end
            end
        end
        return b
    end

    # This node out of the house: in one, the panels told first that it goes, and it leaves a moment later; with no house, the house layer's
    # leave, or, with none in the image, the driver's alone. `then` once it has left
    static def leave_house(node, then)
        var h = node.house
        if h != nil && h.up
            if h.go(then) return end
            if then != nil  then() end
            return
        end
        if h != nil
            h.leaving = true
            h.leave()
        else
            tasmota.cmd("EspNowMeshLeave 1", true)
        end
        if then != nil  then() end
    end
end
