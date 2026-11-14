# node_host.be -- what a node of the house with no screen is to the house, whatever it is besides: a bridge, with its Zigbee network, or an appliance.
# The house's layer on it (house_mesh.be) and what goes with it: the commands that come over the mesh, the panels that hear it, its Wi-Fi, its OTA, the
# house's server and its backup, the house's MQTT, the screens a panel of the house shows of it, its way into the house (the window its button opens, and
# its LED) and out of it, its clock, and how what it says is cut to the frames of the mesh.
#
# A class of static functions over the NODE, the object of the node's own class (ZbBridgeRelay, zbbridge_relay.be; ApplianceNode, appliance_node.be),
# which keeps the state and is asked for what is its own. They are not the methods of a class the node's extends: the firmware's build runs the files in
# the order of their names, with every class of ours declared empty until its own file has run (firmware/overrides/_brain_prelude.be), so a class could
# only extend one of ours whose file's name happened to come before its own.
#
# THE NODE has
#   fields     house (HouseMesh), meshcmd (MeshCmd), wifi (PanelWifi), ota (NodeOta), link (ServerLink) and backup (NodeBackup), each nil where the image has
#              none; heard_from, a map, a panel's number -> millis when it last commanded the node; budget, the most bytes one event carries;
#              pairing (NodePairing, node_pairing.be), what a panel says to it while it enters the house;
#              window_until, by_button, identify_until, blink_pin, blink_rest and hold, the window's own (open_window, button_held);
#              clock_src, clock_at and clock_expect, the clock's own (clock)
#   constants  TAG, what its log lines begin with; ID, what the names of its timers and rules begin with; ROLE, what it tells the house's server it is;
#              MAIN_ROWS, how many rows of its Main settings are its own; LED, which of the board's LEDs its window blinks, from 0
#   methods    run(line, via, from), a command line of a panel (MeshCmd's host), which hands NodeHost.run the line first; listen(payload, from), a panel
#              keeps it as the node it says the house's words to; wipe(), back to its image; settings_rows(), the rows of its Main settings that are its
#              own, a new list; apply_mqtt(m), the house's MQTT, with what is its own of it; render_for(view, k, x), its screens; announce(), what its
#              window's announcement says after its seconds (EspNowPairOpen); window_closed(), what is its own to do once its window closed;
#              guest_said(m), what is its own in the first word of the panel that adds it; say_all(), everything it says of its devices, again
#
# Compiled into the firmware: one class, nothing at the top, every module imported where it is used. It comes before the node's class and NodePairing,
# which name it, after ClockLink, which it names, and reaches every other class through `global`.

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
    # The button's window: held 5 s (SetOption32 50 in the node's template), the button opens 2 minutes in which a panel may add this node to its
    # house, the LED blinking all the while
    static WINDOW_MS = 120000
    static BLINK_MS = 250
    # a node with no network saved opens it alone for 5 minutes at every boot: being plugged in is the gesture there
    static BOOT_WINDOW_MS = 300000
    # asked to identify itself, it blinks this fast for a while
    static IDENTIFY_MS = 80
    static IDENTIFY_FOR_MS = 10000
    # the button held: the hold comes at HOLD_AT_MS, and held on to LEAVE_HOLD_MS the node leaves the house; the pin is read every HOLD_STEP_MS, and the
    # LED says it left with LEFT_BLINKS blinks of LEFT_BLINK_MS
    static HOLD_AT_MS = 5000
    static LEAVE_HOLD_MS = 20000
    static HOLD_STEP_MS = 500
    static LEFT_BLINKS = 6
    static LEFT_BLINK_MS = 150
    # after a boot, the house looked at every AGAIN_MS, AGAIN_TRIES times at most, for this node to say everything again once it is in step
    static AGAIN_MS = 1000
    static AGAIN_TRIES = 180
    # a node with no clock asks the house for the time this long after its boot, and again this often until it has one
    static TIME_ASK_FIRST_MS = 20000
    static TIME_ASK_MS = 60000

    # The house on the node, at its boot: the commands of the mesh, the house's list with its console commands and its MQTT, the node's Wi-Fi, its OTA, the
    # house's server with the node's backup, its screens, and the panels it forgets. `role` is the node's in the house (HouseList.ROLE_...), and `part` what
    # makes the object of what goes in its backup, called with nothing (KeysBackup), or nil for a node that keeps none. Each piece only where the image has its class
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
        # and what a node of the house says to this one: the time, of the one it asked (time_ask)
        house.events = / src, text, m -> NodeHost.heard(node, src, m)
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

    # A command line from a node of the house, over the mesh (`from`, its number, MeshCmd): a panel is noted as one that hears this node, and the words
    # every node takes are run, ZbRelayListen (the node's listen), ZbRelayTime (time_cmd) and ZbRelayAdmin (admin). True for one of them; false for a line
    # that is the node's own to run or refuse
    static def run(node, line, via, from)
        import string
        var h = node.house
        # a panel of the house that commands this node over the mesh hears its events for a while
        if from != nil && from > 0 && h != nil && h.up && h.list.is_panel(from)  node.heard_from[from] = tasmota.millis() end
        var w = NodeHost.word(line)
        if w != "ZBRELAYLISTEN" && w != "ZBRELAYADMIN" && w != "ZBRELAYTIME" return false end
        var i = string.find(line, " ")
        var payload = i < 0 ? "" : line[i + 1 ..]
        if w == "ZBRELAYLISTEN"
            # a panel that keeps this node as the one of the house's words: it hears its events, and, with a 1, what it says again
            node.listen(payload, from)
        elif w == "ZBRELAYTIME"
            # the time of the one that says it, answered with this node's own: to it too, when it is a node with no screen that asks
            NodeHost.time_cmd(node, payload, from)
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

    # After a boot, once this node is in its house and in step on the mesh, everything said again to the panels that show its devices (their marks, which
    # the flash kept): a restart quicker than the mesh's heartbeats is no session a panel saw go down, and what the node says of its devices begins again here
    static def again_after_boot(node, tries)
        import global
        var h = node.house
        if h == nil || tries <= 0 return end
        # a node in no house at its boot has nobody to tell: the panel that adds it asks for everything itself
        if tries == NodeHost.AGAIN_TRIES
            var r = tasmota.cmd("_EspNowMeshId", true)
            if !isinstance(r, map) || int(r.find("EspNowMeshId", 0)) < 1 return end
        end
        if h.up && global.contains("espnow_mesh_stamp") && global.espnow_mesh_stamp() != false
            log(node.TAG + ": in the house and in step after the boot: everything said again to the panels that hear this node", 2)
            node.say_all()
            return
        end
        tasmota.set_timer(NodeHost.AGAIN_MS, / -> NodeHost.again_after_boot(node, tries - 1), node.ID + "_again")
    end

    # --- what the node says, cut to the frames of the mesh --------------------------------------

    # `fields` {name: value}, in as few maps as fit `budget` once `wrap` has put each in its message: a field is never cut. One that alone does not fit
    # is dropped, and the log says which, under `tag`
    static def pack(fields, wrap, budget, tag)
        import json
        var out = []
        var cur = {}
        for k: fields.keys()
            cur[k] = fields[k]
            if size(json.dump(wrap(cur))) <= budget continue end
            if size(cur) > 1
                cur.remove(k)
                out.push(cur)
                cur = {}
                cur[k] = fields[k]
                if size(json.dump(wrap(cur))) <= budget continue end
            end
            log(tag + ": " + str(k) + " is " + str(size(json.dump(wrap(cur)))) + " bytes with its message, and does not fit in " +
                str(budget) + ", dropped", 2)
            cur = {}
        end
        if size(cur) > 0  out.push(cur) end
        return out
    end

    # A list the other side needs whole, as the messages `wrap` makes of its numbered frames, each {"at": where it starts, "of": how many entries there
    # are, "l": these}, none past `budget`. Nil when an entry fits no frame, which the log says under `tag`: a list with a hole is worse than none
    static def list_frames(entries, wrap, budget, tag)
        import json
        var total = size(entries)
        var frames = []
        var at = 0
        var cur = []
        var i = 0
        while i < total
            cur.push(entries[i])
            if size(json.dump(wrap({"at": at, "of": total, "l": cur}))) > budget
                if size(cur) == 1
                    log(tag + ": entry " + str(i) + " of a list does not fit a frame of " + str(budget) + " bytes, the list is not sent", 2)
                    return nil
                end
                cur.remove(size(cur) - 1)
                frames.push(wrap({"at": at, "of": total, "l": cur}))
                at = i
                cur = []
            else
                i += 1
            end
        end
        if size(cur) > 0 || total == 0  frames.push(wrap({"at": at, "of": total, "l": cur})) end
        return frames
    end

    # --- the window of entering the house -------------------------------------------------------

    # open, from the button or a boot with no network, until the driver says it closed: a session begun before its time still completes
    static def window_open(node)
        return node.window_until != nil
    end

    # The button held: at the hold, HOLD_AT_MS, the pairing's window opens; held on to LEAVE_HOLD_MS, the node leaves the house. The pin is read at the
    # hold and every HOLD_STEP_MS after: the level it has at the hold is the pressed one, whatever the board's wiring and the template's inversion
    static def button_held(node)
        import gpio
        NodeHost.open_window(node)
        var pin = gpio.pin(gpio.KEY1, 0)
        if pin < 0 return end
        node.hold = [pin, gpio.digital_read(pin), tasmota.millis()]
        tasmota.remove_timer(node.ID + "_hold")
        tasmota.set_timer(NodeHost.HOLD_STEP_MS, / -> NodeHost.hold_step(node), node.ID + "_hold")
    end

    static def hold_step(node)
        import gpio
        var h = node.hold
        if h == nil return end
        if gpio.digital_read(h[0]) != h[1]
            node.hold = nil
            return
        end
        if tasmota.millis() - h[2] >= NodeHost.LEAVE_HOLD_MS - NodeHost.HOLD_AT_MS
            node.hold = nil
            log(node.TAG + ": the button held " + str(NodeHost.LEAVE_HOLD_MS / 1000) + " s: this node leaves the house", 1)
            NodeHost.close_window(node)
            NodeHost.leave_house(node)
            NodeHost.flash_led(node, NodeHost.LEFT_BLINKS)
            return
        end
        tasmota.set_timer(NodeHost.HOLD_STEP_MS, / -> NodeHost.hold_step(node), node.ID + "_hold")
    end

    # the LED blinks `n` times fast, and is left as it was: what the node says when it has left the house
    static def flash_led(node, n)
        import gpio
        var pin = gpio.pin(gpio.LED1, node.LED)
        if pin < 0 || n <= 0 return end
        var rest = gpio.digital_read(pin)
        for i: 0 .. 2 * n - 1
            NodeHost.led_at(pin, (i % 2 == 0) ? 1 - rest : rest, i * NodeHost.LEFT_BLINK_MS)
        end
    end

    static def led_at(pin, level, ms)
        import gpio
        tasmota.set_timer(ms, / -> gpio.digital_write(pin, level))
    end

    # The window opens: `ms` in which a panel may add this node to its house (WINDOW_MS when not said), from the button (`by_button`, true when not said)
    # or by itself. The LED blinks while it is open; opened again, its time starts over. The ESP-NOW driver announces the node meanwhile, with what
    # the node says of itself (announce): the pairing is the driver's, over the radio
    static def open_window(node, ms, by_button)
        import gpio
        if ms == nil  ms = NodeHost.WINDOW_MS end
        if by_button == nil  by_button = true end
        # a window opened again while an exchange is up starts over: the old one, which a panel may have left with its last word lost on the way, ends first
        if node.pairing != nil && node.pairing.guesting
            tasmota.cmd("EspNowPairStop")
            node.pairing.guest_ended()
        end
        var r = tasmota.cmd("EspNowPairOpen " + str(ms / 1000) + "," + node.announce())
        if !isinstance(r, map) || r.find("EspNowPairOpen") != "Open"
            log(node.TAG + ": the pairing did not open: " + str(r), 2)
            return
        end
        node.window_until = tasmota.millis(ms)
        node.by_button = by_button
        if node.blink_rest == nil
            var pin = gpio.pin(gpio.LED1, node.LED)
            node.blink_pin = pin
            node.blink_rest = pin >= 0 ? gpio.digital_read(pin) : 0
        end
        tasmota.remove_timer(node.ID + "_blink")
        NodeHost.blink(node)
        tasmota.remove_timer(node.ID + "_window")
        # the driver says when the window closed (EspNowPair#Window), after a session begun before its end: this is only the net under it, 60 s later
        tasmota.set_timer(ms + 70000, / -> NodeHost.close_window(node), node.ID + "_window")
        log(node.TAG + ": " + (by_button ? "the button" : "a boot with no network") + " opened the pairing for " + str(ms / 1000) + " s", 2)
    end

    # A panel asked this node to identify itself (EspNowPair#Blink): the LED blinks faster, for the user to see which node answers
    static def identify(node)
        if !NodeHost.window_open(node) return end
        node.identify_until = tasmota.millis(NodeHost.IDENTIFY_FOR_MS)
        log(node.TAG + ": a panel asks this node to identify itself", 2)
    end

    # the LED's other level, and again in BLINK_MS while the window is open, or in IDENTIFY_MS while a panel's request to identify goes
    static def blink(node)
        import gpio
        if !NodeHost.window_open(node) return end
        if node.blink_pin >= 0 gpio.digital_write(node.blink_pin, 1 - gpio.digital_read(node.blink_pin)) end
        var fast = node.identify_until != nil && !tasmota.time_reached(node.identify_until)
        tasmota.set_timer(fast ? NodeHost.IDENTIFY_MS : NodeHost.BLINK_MS, / -> NodeHost.blink(node), node.ID + "_blink")
    end

    # Closed: the node was added, or the window's time is over. The LED back as it was. The driver's window closes too, unless it said it had closed
    # (`driver_closed`), and the node does what is its own to do then (window_closed)
    static def close_window(node, driver_closed)
        import gpio
        var was = node.window_until != nil
        if was && driver_closed != true  tasmota.cmd("EspNowPairStop") end
        node.window_until = nil
        node.by_button = false
        node.identify_until = nil
        node.window_closed()
        tasmota.remove_timer(node.ID + "_blink")
        tasmota.remove_timer(node.ID + "_window")
        if node.blink_rest != nil && node.blink_pin >= 0  gpio.digital_write(node.blink_pin, node.blink_rest) end
        node.blink_rest = nil
        if was log(node.TAG + ": the pairing's window closed", 2) end
    end

    # no network saved, SSId1 or SSId2
    static def no_network()
        var names = tasmota.cmd("SSId")
        return !isinstance(names, map) || (str(names.find("SSId1", "")) == "" && str(names.find("SSId2", "")) == "")
    end

    # A node with no network saved opens no access point: Tasmota's is open, on channel 1, and it would break the ESP-NOW with a panel on another
    # channel. The radio stays in station mode with no network, for ESP-NOW, when the firmware's station driver can hold it (StaHold); the way to a
    # phone is the rescue, three short boots (USE_BOOT_RESCUE). And its window opens for a panel: being plugged in is the gesture here
    static def radio_at_boot(node)
        if !NodeHost.no_network() return end
        var st = tasmota.cmd("StaState")
        if !isinstance(st, map) || !st.contains("StaState")
            log(node.TAG + ": no network saved, and no station driver to hold the radio: Tasmota opens its AP", 2)
            return
        end
        tasmota.cmd("Wifi 0")
        tasmota.cmd("StaHold 1")
        log(node.TAG + ": no network saved, the radio held with no network and no AP, for ESP-NOW", 2)
        NodeHost.open_window(node, NodeHost.BOOT_WINDOW_MS, false)
    end

    # --- the clock ------------------------------------------------------------------------------

    # The node's clock at the boot: kept across a restart (the fork's RtcRetain), or none yet, which the internet, a panel or the house sets. Its time
    # is not known fresh: the link's rule takes it as the oldest
    static def time_boot(node)
        node.clock_at = 0
        node.clock_src = nil
        if tasmota.rtc()["utc"] >= ClockLink.VALID
            node.clock_src = ClockLink.kept_across() ? "restart" : "internet"
        end
    end

    # The clock on the node, at its boot: what it starts with, the console's word, the rule that says who set it, and the house asked for the time
    # while it has none
    static def clock(node)
        NodeHost.time_boot(node)
        tasmota.add_cmd("ZbRelayTime", def (cmd, idx, payload)
            NodeHost.time_cmd(node, payload, nil)
            tasmota.resp_cmnd_done()
        end)
        tasmota.add_rule("Time#Set", / -> NodeHost.time_set(node), node.ID + "_time")
        tasmota.set_timer(NodeHost.TIME_ASK_FIRST_MS, / -> NodeHost.time_ask(node, 0), node.ID + "_time_ask")
    end

    # A word on a clock taken (ClockLink), when the rule says so: the clock is set to it, as `src`'s, and given back to the NTP, for the node's
    # internet, when it has one, to correct it. True when it was taken
    static def time_take(node, peer, src)
        if !ClockLink.takes(tasmota.rtc()["utc"] >= ClockLink.VALID, node.clock_at, peer) return false end
        node.clock_src = src
        node.clock_expect = src
        node.clock_at = peer["at"]
        tasmota.cmd("Time " + str(peer["utc"]))
        tasmota.cmd("Time 0")
        return true
    end

    # ZbRelayTime: the word of a panel on its time, or of a node with no screen that has none and asks (time_ask). This node takes it when the rule
    # says so, and answers with its own: to the panels that hear it, or, when a node with no screen said it, to that node alone. `from` is the number
    # of the one that said it over the mesh, nil at the console
    static def time_cmd(node, payload, from)
        import json
        var h = node.house
        var asker = from != nil && from > 0 && h != nil && h.up && h.list.is_owner(from) && !h.list.revoked(from)
        NodeHost.time_take(node, json.load(str(payload)), asker ? "house" : "panel")
        var word = {"ZbTime": ClockLink.word(node.clock_src, node.clock_at)}
        if asker
            h.event_node(from, json.dump(word))
        else
            NodeHost.send_event(node, word)
        end
    end

    # Time#Set: a time this node took from another, or the internet's
    static def time_set(node)
        var by = node.clock_expect
        node.clock_expect = nil
        if by == nil
            node.clock_src = "internet"
            node.clock_at = tasmota.rtc()["utc"]
        end
    end

    # A node with no clock asks the house for the time: its own word, which says it has none, to the nodes of the house that take commands, a bridge
    # or an appliance, each in its turn, every TIME_ASK_MS until it has one. The one asked answers with its word (time_cmd), which `heard` takes.
    # A node with a network has the internet's first; this is for the one with none
    static def time_ask(node, turn)
        import json
        if tasmota.rtc()["utc"] >= ClockLink.VALID return end
        tasmota.remove_timer(node.ID + "_time_ask")
        tasmota.set_timer(NodeHost.TIME_ASK_MS, / -> NodeHost.time_ask(node, turn + 1), node.ID + "_time_ask")
        var h = node.house
        if h == nil || !h.up || node.meshcmd == nil return end
        var owners = []
        for id: h.list.ids(false)
            if id != h.list.me && h.list.is_owner(id)  owners.push(id) end
        end
        if size(owners) == 0 return end
        node.meshcmd.send(owners[turn % size(owners)], "ZbRelayTime " + json.dump(ClockLink.word(node.clock_src, node.clock_at)), nil)
    end

    # What a node of the house says to this one over the mesh, as an event: the time of an owner this node asked. Any other event is a panel's to hear
    static def heard(node, src, m)
        var h = node.house
        if h == nil || !h.list.is_owner(src) || h.list.revoked(src) return end
        if m.contains("ZbTime")  NodeHost.time_take(node, m["ZbTime"], "house") end
    end
end
