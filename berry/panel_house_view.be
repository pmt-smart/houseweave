# panel_house_view.be -- the house as the glass shows it.
#
# THE HOUSE'S PAGE is the Screens: the house's screens, the groups of the plan's carousel, under a row of icons (Main settings, Wireless settings, the calendar, the
# alarm, the notifications and the mesh), with the house's name for a title, which a long press renames. PanelUi draws the list; the icons, the title and the name are here.
#
# THE MESH, the last icon: the nodes of the house, each with how it is heard (the signal this panel hears it at, and how many nodes it hears: "Strong, 3 links"), a
# node's page, the change of the network's key that is not closed, and the + of its title, which brings a node into this panel's house (every pairing is entering the
# house). Its first row is the cog alone, the mesh's settings (the house's channel), and the nodes are right under it.
# A NODE'S PAGE is its Main settings and its Wireless settings: this panel's are its own screens, and another node's are that node's own,
# as it draws them, asked of it over the mesh (house_mesh.be, ask_view) and drawn here row for row: another panel's are its Main settings and its Wireless settings and
# the screens they open (its Info, a button's mode, the screensaver's times), and a bridge's are what a bridge has (its Zigbee, its Info, its Wi-Fi, its MQTT). A touch
# that opens a screen of the node's asks for it; one that changes a setting there (on and off, a button's mode, a time of the screensaver, a bridge's pairing and
# restart) goes to the node with Editing on, which changes it and answers with the screen again. What needs the node's own glass (its pattern, its clock, its Wi-Fi's
# search) is shown and not touched. Under the two, with Editing on, what a person does to the node, each asked first with what it costs:
#   - this panel: "Join another house", which leaves it and waits at its window to be added by a panel of the other, and, in another's
#     house, "Leave this house", which goes back to one of its own (house_mesh.be, found_own). The last panel of a house takes its bridges along, since a house always
#     has a panel, and the question says how many devices of the alarm go with this panel;
#   - another node: "Join another house", the same for it, by a word over the mesh (house_mesh.be, move): a bridge keeps its Wi-Fi and its Zigbee devices, which leave
#     every panel of this house, and opens its window for a panel of the other house to add it; and "Remove from house": a panel leaves and the key changes, and a
#     BRIDGE GOES BACK TO ITS FACTORY SETTINGS (its Wi-Fi, its Zigbee network and its devices erased), by the word of its factory reset over the mesh, and is struck
#     off when it says it goes, or after ADMIN_MS when it says nothing.
#
# A NODE'S NAME is its page's title, which a long press renames with Editing on, on any panel that writes the list, as the house's name is;
# the list carries it to every node. A BRIDGE'S PAGE says whether it is this panel's favourite, the first offered when it adds a Zigbee device, and a touch makes it so.
#
# THE HOUSE'S CHANNEL: the mesh's list has a row of it, and a row for each channel the nodes saw an access point of the house's
# network on, off the house's channel (house_channel.be, the heartbeat's bytes 28 to 31); a node's page says its own channel, its Wi-Fi and the access point
# it saw off the channel, or why its station does not connect. With Editing on, a panel that writes the list changes the house's channel: every node
# moves at the same instant on the mesh clock, a minute later, and the access points are moved after. A network on another channel picked in the Wi-Fi's
# search is said to be off the house's (houseOffNet), and the way to it is moving the house, not this panel alone, which would leave the mesh.
#
# A BRIDGE'S WEB PASSWORD AND ITS FACTORY RESET are words to it over the mesh (ZbRelayAdmin, sealed with the two nodes' key), with Editing on, on
# any panel that writes, which it takes only from a panel of the house, and says it was done. A password is drawn here and kept here, by the bridge's number, to be read
# on its page; the reset is its Remove from house, the bridge leaving the house by itself, and its devices with it.
#
# The house layer (house_mesh.be) does it all; this is its face. What changes the house (found, strike off, finish a key change) is only there with Editing on, as every row that
# changes the configuration is, and only for a panel that is in the list (HouseMesh.writes): a bridge writes nothing. Adding a bridge is the pairing's screens, and not these.
#
# THE HOUSE'S SERVER, the one that keeps the backups and the releases: the + of the mesh's page has Add server, whose screen opens the window of
# its pairing (house_server.be), with its code and this panel's address, for the owner to type on the server; the server added is in the mesh's list under its
# name, with its address, and its page removes it, with Editing on (no key changes: it never had the key). THIS PANEL'S OTA is a node's screen of its own,
# drawn as another panel would see it (node_wireless.be, node_ota.be): the row of its Wireless settings opens it, answered here with no mesh in between.
#
# A provider of views for PanelUi (panel_ui.be, `providers`), as PanelAddView is, whose rows it makes and whose stack it works on.

#@ solidify:PanelHouseView
class PanelHouseView
    static VIEWS = ["house", "houseNode", "houseStrike", "houseLeave", "houseKey", "houseFinish", "houseResult", "houseWebpw", "houseWindow",
                    "houseChannel", "houseChannelPick", "houseChannelGo", "houseOffNet", "houseSettings", "houseMove", "houseRemote", "houseRemoteAsk", "houseServer"]
    # the screens of this panel's another panel may show, and the touches it may make on them, over the mesh; its Wireless
    # settings are a node's own (node_wireless.be)
    static REMOTE_VIEWS = ["settings", "panelInfo", "choice", "saver", "saverTime"]
    static REMOTE_EDITS = ["setting", "saverTime", "buttonMode"]
    # where the web passwords drawn for the bridges are kept, by number, and how long a word to a bridge waits for its answer
    static WEBPW = "house_webpw"
    static ADMIN_MS = 10000
    static PW_LEN = 10
    static PW_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    static NAME = "Home"
    # the icons of the house's page, in their order, and the theme's role of each: the alarm's and the notifications' are the screensaver's signs
    static ICONS = ["settings", "wifi", "calendar", "alarm", "notifs", "mesh"]
    static ROLES = {"settings": "settings", "wifi": "wifi", "calendar": "schedule", "alarm": "alarmSignal", "notifs": "noticeSignal", "mesh": "mesh"}
    static TONE = "text-primary"
    # how long a node this panel added says "Starting", until it is heard: a bridge's restart and its mesh's first heartbeats
    static STARTING_MS = 120000
    static LIT = "accent-blue"

    var ui
    var asked       # the words to the bridges that wait for their answer: number -> {"do", "n", "pw", "until", "state"}; state "asking", "done" or "silent"
    var on_change   # f(): an answer came, or did not, and the screens on show draw again; the boot's
    var view_at     # node -> millis this panel last asked it for a screen
    var ota         # this panel's OTA (node_ota.be), or nil; the boot's
    var server      # the pairing of the house's server (house_server.be), or nil; the boot's

    def init(ui)
        self.ui = ui
        self.asked = {}
        self.view_at = {}
        import global
        var rules = global.contains("panel_rules") && global.panel_rules != nil ? global.panel_rules : tasmota
        rules.add_rule("ZbRelayAdmin", / v -> self.answered(v), "panel_house_view")
    end

    def shows(kind) return PanelHouseView.VIEWS.find(kind) != nil end

    # no row of Main settings is the house's: it is a row of the Wireless settings
    def hint(key) return nil end

    def acts(verb) return verb == "house" end

    # a node's screen, opened: the node is asked for it
    def opened(ui, view)
        if view[0] == "houseRemote" && size(view) > 2 && !self.fresh_remote(view[1], view[2])  self.ask_remote(view[1], view[2], nil, nil) end
    end

    # a touch sent to another node: its screen comes back from its first page, as this panel's own does after a change (another list, it may be)
    static def first_page(ui)
        var t = ui.top()
        if t != nil  t["page"] = 0 end
    end

    # a node's screen that came a moment ago as the one that follows a touch: opened on it, it is not asked again
    def fresh_remote(id, rv)
        import json
        var h = PanelHouseView.house()
        var got = h != nil ? h.remote.find(id) : nil
        return got != nil && json.dump(got[1]) == rv && tasmota.millis() - got[0] < 1000
    end

    # The word to the node over the mesh, asking for its screen `rv` (as JSON) or touching its row `k` with `x` (a text typed here, or the answer to its
    # question), and the screen drawn again when its time is over with no answer
    def ask_remote(id, rv, k, x)
        import json
        var h = PanelHouseView.house()
        if h == nil return end
        # this panel's own (its OTA): answered here as another node answers over the mesh, and said a moment after, as one that came
        if id == h.list.me
            var r = h.view_fn != nil ? h.view_fn(json.load(rv), k, x) : nil
            if r == nil return end
            h.remote[id] = [tasmota.millis(), r[0], r[1], r[2], r[3], size(r) > 5 && isinstance(r[5], map) ? r[5] : {}]
            self.view_at[id] = h.remote[id][0]
            var on = h.on_view
            if on != nil  tasmota.set_timer(0, / -> on(id), "panel_house_self") end
            return
        end
        h.ask_view(id, json.load(rv), k, x)
        var at = tasmota.millis()
        self.view_at[id] = at
        tasmota.set_timer(PanelHouseView.ADMIN_MS, def ()
            if self.view_at.find(id) == at  self.changed() end
        end, "panel_house_view")
    end

    # the house layer of this panel, or nil where the image has none
    static def house()
        import global
        return global.contains("house") ? global.house : nil
    end

    # whether the image has the mesh driver: a panel that has it and has no number of its own yet is a panel that has no house, and can found one
    static def mesh_here()
        import global
        return global.contains("espnow_mesh_send")
    end

    # whether the node is in the mesh with a number of its own
    static def numbered(h)
        return h != nil && h.up && h.list.me >= 1
    end

    # what the Wireless settings' row says: the house's name, or that there is none; no mesh in the image is none
    def summary()
        var h = PanelHouseView.house()
        if h == nil return "No mesh" end
        if !PanelHouseView.numbered(h) return PanelHouseView.mesh_here() ? "Not set up" : "No mesh" end
        if size(h.list.ids(true)) == 0 return "Not set up" end
        if h.key.pend != nil return "Key change" end
        var n = h.list.name()
        return n != "" ? n : PanelHouseView.NAME
    end

    # whether the Wireless settings have the house's row: only where the layout has no house's page, whose icon opens the mesh
    def in_wireless()
        return self.ui.shape["pages"].find("house") == nil && self.summary() != "No mesh"
    end

    # how many of the alarm's devices this panel's bridge has, as its alarm's settings say them: the sensors and the sirens
    def alarm_devices()
        var z = self.ui.network
        var a = z != nil ? z.alarm : nil
        if a == nil || !isinstance(a.cfg, map) return 0 end
        var s = a.cfg.find("sensors")
        var r = a.cfg.find("s")
        return (isinstance(s, map) ? size(s) : 0) + (isinstance(r, list) ? size(r) : 0)
    end

    # The devices of the alarm that leaving takes from this panel: this panel's devices that the house's alarm has; or, for the last panel,
    # which takes the bridges along, every device of the alarm
    def alarm_leaving(h)
        import string
        var z = self.ui.network
        var a = z != nil ? z.alarm : nil
        if a == nil || !isinstance(a.cfg, map) return 0 end
        if h.writes() && PanelHouseView.last_panel(h) return self.alarm_devices() end
        var norm = def (id)
            var s = str(id)
            return size(s) > 2 ? "0x" + string.toupper(s[2 ..]) : s
        end
        var ids = {}
        var s = a.cfg.find("sensors")
        if isinstance(s, map)  for id: s.keys() ids[norm(id)] = true end end
        for id: a.cfg.find("s", [])  ids[norm(id)] = true end
        for p: a.cfg.find("pd", [])  if isinstance(p, list) && size(p) > 0 ids[norm(p[0])] = true end end
        var n = 0
        for d: self.ui.store.doc["devices"]
            if ids.contains(norm(d[0])) n += 1 end
        end
        return n
    end

    # whether this is the only panel of the house left
    static def last_panel(h)
        for id: h.list.ids(false)
            if id != h.list.me && h.list.is_panel(id) return false end
        end
        return true
    end

    static def role_word(n)
        return n["role"] == HouseList.ROLE_BRIDGE ? "Bridge" : "Panel"
    end

    # a node's name as the screens say it: its own, or its role and the end of its radio address (HouseList.label)
    static def label(h, id)
        var s = h.list.label(id)
        return s != nil ? s : "Unknown node"
    end

    # A node's state, in a few words: how well it is tied to the mesh and to the Wi-Fi, and never the way to it:
    # [the mesh's, its tone, the Wi-Fi's, its tone] (tie_parts). This panel's own, as it is now (house_mesh.be, tie); another node heard
    # (house_mesh.be, heard_by), at any distance, as its presence says it (house_mesh.be, tie_of); a neighbour whose presence does not say it (an older image,
    # or none yet), how strong this panel hears it, how many nodes its heartbeat lists, and whether its heartbeat's radio says it is on the Wi-Fi; else
    # "Heard", and not "No signal" of a node that works. Not heard: "No signal", in the colour of a poor signal. A node this panel
    # added a moment ago and has not heard yet is starting: a bridge restarts once it has been added, to form its Zigbee network on the room's channel, and
    # its mesh needs some seconds after that
    static def state_parts(h, id)
        if id == h.list.me return PanelHouseView.tie_parts(h.tie()) end
        var sb = h.safeboot_of(id)
        if sb != nil return PanelHouseView.safeboot_parts(sb) end
        var x = h.heard_by(id)
        if isinstance(x, map) && x.find("state", 2) != 2
            var t = h.tie_of(id)
            if t != nil return PanelHouseView.tie_parts(t) end
            # a neighbour kept alive by the others, whose own heartbeats stopped, a node further away, or one heard by the network alone: heard
            var r = x.find("rssi", 0)
            if x.find("id") != id || x.find("far", false) || !h.fresh(x) || type(r) != "int" || r == 0 return ["Heard", "", "", ""] end
            var radio = HouseChannel.of_info(x.find("info"))
            return PanelHouseView.tie_parts([x.find("hears", 0), r, radio == nil ? nil : (radio["ap"] > 0 ? 1 : 0)])
        end
        var at = h.added != nil ? h.added.find(id) : nil
        return at != nil && tasmota.millis() - at < PanelHouseView.STARTING_MS ? ["Starting", "", "", ""] : ["No signal", NodeWireless.TONES[3], "", ""]
    end

    # A node in its safeboot image, as a neighbour hears its beacon or another node's presence says it, from [state, block, blocks]: "Safeboot 47%" while it takes an image, by
    # its blocks written, "Safeboot" waiting for one, in the colour of a fair signal; "Safeboot, failed" in a poor one's
    static def safeboot_parts(s)
        if s[0] == 4 return ["Safeboot, failed", NodeWireless.TONES[3], "", ""] end
        if s[0] == 0 return ["Safeboot", NodeWireless.TONES[2], "", ""] end
        var pct = s[2] > 0 ? s[1] * 100 / s[2] : 0
        return ["Safeboot " + str(pct > 100 ? 100 : pct) + "%", NodeWireless.TONES[2], "", ""]
    end

    # How a node is tied, from [nodes it hears on the radio, the signal of the best of them, its Wi-Fi's signal]: the mesh's,
    # "Mesh -55dBm(4)", "Mesh None(0)" for no node heard on the radio, in the colour of a poor signal, "Mesh Heard(2)" for nodes heard with no signal said;
    # and the Wi-Fi's, "Wi-Fi -76dBm", "Wi-Fi no" off it, "yes" on it with no signal said, "" when it is not known; each with its colour (NodeWireless.tone_of)
    static def tie_parts(t)
        var n = t[0]
        var r = t[1]
        var mesh = n > 0 ? (type(r) == "int" && r < 0 ? str(r) + "dBm(" + str(n) + ")" : "Heard(" + str(n) + ")") : "None(0)"
        var w = size(t) > 2 ? t[2] : nil
        var wifi = w == nil ? "" : "Wi-Fi " + (w == 0 ? "no" : (w > 0 ? "yes" : str(w) + "dBm"))
        return ["Mesh " + mesh, n > 0 ? NodeWireless.tone_of(r) : NodeWireless.TONES[3], wifi, w != nil && w < 0 ? NodeWireless.tone_of(w) : ""]
    end

    # the same in one line, for a page that says it in one: "Mesh -55dBm(4), Wi-Fi -76dBm"
    static def tie_word(t)
        var p = PanelHouseView.tie_parts(t)
        return p[0] + (p[2] != "" ? ", " + p[2] : "")
    end

    # A node's row on the mesh's page: its name, with a * for this panel; on the mesh's own page its Wi-Fi at the right of the name and the mesh's under
    # it, each in the colour of its signal; on a layout with no such page (an older screen), the two under the name, in the mesh's colour
    def node_row(label, p, tap)
        var split = self.ui.shape["pages"].find("mesh") != nil
        var r = PanelUi.toned(PanelUi.row(nil, label, split || p[2] == "" ? p[0] : p[0] + ", " + p[2], false, tap, nil), p[1])
        return split ? PanelUi.tailed(r, p[2], p[3]) : r
    end

    # --- the house's channel ---------------------------------------------------------------------------

    # What each node's radio is, by its number, as its heartbeat says it (house_channel.be): {"mesh", "ap", "off", "why"}, this panel's own from its last poll,
    # and only the nodes heard
    static def radios(h)
        import global
        var out = {}
        if h.channel != nil && h.channel.mine() != nil  out[h.list.me] = h.channel.mine() end
        for x: h.neighbors()
            if !isinstance(x, map) || x.find("state", 2) == 2 continue end
            var r = HouseChannel.of_info(x.find("info"))
            if r != nil  out[x.find("id")] = r end
        end
        return out
    end

    # the channels an access point of the house's network was seen on, off the house's, and by how many nodes each: channel -> count
    static def off_channels(h)
        var out = {}
        var rs = PanelHouseView.radios(h)
        for id: rs.keys()
            var c = rs[id]["off"]
            if c > 0  out[c] = out.find(c, 0) + 1 end
        end
        return out
    end

    # the house's channel in a word: the channel, and the one it moves to while a change waits for its instant
    static def channel_word(h)
        var m = h.channel_setting()
        if m == nil return "None" end
        var wait = HouseChannel.wait_of(m["at"])
        return wait > 0 ? str(m["channel"]) + " in " + str(wait / 1000 + 1) + " s" : str(m["channel"])
    end

    # Whether a network on the channel `ch` is off the house's: a panel in a house with other nodes, whose channel is another. Joined, it would take this
    # panel off the mesh, and its station leaves it (xdrv_98_3). A panel alone follows its network, and nothing is off
    def off_channel(ch)
        var h = PanelHouseView.house()
        if !PanelHouseView.numbered(h) || HouseChannel.alone(h) return false end
        var m = h.channel_setting()
        return m != nil && int(ch) > 0 && int(ch) != m["channel"]
    end

    # This panel's channel, for its own Wireless settings, under the Wi-Fi (a node's page said it twice): its radio's channel,
    # in the colour of what is wrong when it is not the house's, and the access point it saw off the channel, which opens the house's channel
    def wireless_rows()
        var h = PanelHouseView.house()
        var r = h != nil && h.channel != nil ? h.channel.mine() : nil
        if r == nil return [] end
        var m = h.channel_setting()
        var hc = m != nil ? m["channel"] : 0
        var rows = [PanelUi.row(nil, "Channel", r["mesh"] > 0 ? str(r["mesh"]) : "None", hc > 0 && r["mesh"] != hc ? 2 : false, nil, nil)]
        if r["off"] > 0  rows.push(PanelUi.row(nil, "Access point", "On channel " + str(r["off"]), 2, ["open", "houseChannel"], nil)) end
        return rows
    end

    # The views of the channel: the house's, the list to pick another, the question before moving, and a network of the Wi-Fi's search off the house's
    def channel_view(h, kind, view, ed)
        var rows = []
        var m = h.channel_setting()
        var cur = m != nil ? m["channel"] : 0
        var w = ed && h.writes()
        if kind == "houseChannel"
            rows.push(PanelUi.row(nil, "The house", PanelHouseView.channel_word(h), false, nil, nil))
            var off = PanelHouseView.off_channels(h)
            for c: off.keys()
                rows.push(PanelUi.row(nil, "Access points on " + str(c), PanelUi.plural(off[c], "node", "nodes"), 2, w ? ["open", "houseChannelGo", c] : nil, nil))
            end
            if w  rows.push(PanelUi.row(nil, "Change", "", false, ["open", "houseChannelPick"], nil)) end
            return ["Channel", "", rows]
        end
        if kind == "houseChannelPick"
            for c: 1 .. HouseList.MAX_CHANNEL
                rows.push(PanelUi.row(PanelUi.chosen(c == cur), "Channel " + str(c), "", false, c == cur || !w ? nil : ["open", "houseChannelGo", c], nil))
            end
            return ["Channel", "", rows]
        end
        if kind == "houseChannelGo"
            var c = view[1]
            var alone = HouseChannel.alone(h)
            rows.push(PanelUi.row(nil, "To channel", str(c), false, nil, nil))
            if !alone
                rows.push(PanelUi.row(nil, "Every node moves in a minute", "", false, nil, nil))
                rows.push(PanelUi.row(nil, "Then the access points to " + str(c), "", false, nil, nil))
            end
            if w  rows.push(PanelUi.row(nil, "Move", "", 2, ["house", "channel", c], nil)) end
            rows.push(PanelUi.row(nil, "Cancel", "", false, ["back"], nil))
            return ["Move the house?", "", rows]
        end
        # houseOffNet: the network's name and channel
        var c = view[2]
        rows.push(PanelUi.row(nil, "On channel", str(c), 2, nil, nil))
        rows.push(PanelUi.row(nil, "The house's mesh", cur > 0 ? "Channel " + str(cur) : "None", false, nil, nil))
        rows.push(PanelUi.row(nil, "This panel would leave it", "", false, nil, nil))
        if w  rows.push(PanelUi.row(nil, "Move the house to " + str(c), "", false, ["open", "houseChannelGo", c], nil)) end
        rows.push(PanelUi.row(nil, "Cancel", "", false, ["back"], nil))
        return [str(view[1]), "", rows]
    end

    # This panel with no house, no number on the mesh: its name and how it hears the mesh, and, with Editing on, the way into a house,
    # its window, where a panel of the house adds it
    def self_view(h, ed)
        var rows = []
        rows.push(PanelUi.row(nil, "Role", "Panel", false, nil, nil))
        rows.push(PanelUi.row(nil, "State", PanelHouseView.tie_word(h.tie()), false, nil, nil))
        if ed  rows.push(PanelUi.row(nil, "Join a house", "", 2, ["house", "window"], nil)) end
        return [PanelHouseView.own_label(), "", rows]
    end

    # this panel's name with no house to say it: its role and the end of its radio address, as a node with no name of a house is called (HouseList.label)
    static def own_label()
        import string
        var mac = string.split(str(tasmota.wifi().find("mac", "")), ":")
        return size(mac) == 6 ? "Panel " + mac[3] + mac[4] + mac[5] : "This panel"
    end

    # A node's page, its two questions (Remove from house, Join another house) and the mesh's settings
    def node_view(h, kind, view, ed)
        var rows = []
        var w = ed && h.writes()
        if kind == "houseSettings"
            rows.push(PanelUi.row(nil, "Channel", PanelHouseView.channel_word(h), false, ["open", "houseChannel"], nil))
            return ["Mesh settings", "", rows]
        end
        var id = view[1]
        var n = h.list.node(id)
        if n == nil return ["Node", "", rows] end
        var bridge = n["role"] == HouseList.ROLE_BRIDGE
        var server = n["role"] == HouseList.ROLE_SERVER
        if kind == "houseStrike"
            if server
                rows.push(PanelUi.row(nil, "It is out of the house", "", false, nil, nil))
                rows.push(PanelUi.row(nil, "Pair it again to have it back", "", false, nil, nil))
            elif bridge
                # a bridge removed goes back to its factory settings: its word over the mesh, and its devices leave every panel
                rows.push(PanelUi.row(nil, "Back to its factory settings", "", false, nil, nil))
                rows.push(PanelUi.row(nil, "Its Wi-Fi and Zigbee erased", "", false, nil, nil))
                rows.push(PanelUi.row(nil, "Devices here", str(size(self.ui.store.remote_by_owner().find(id, []))), false, nil, nil))
            else
                rows.push(PanelUi.row(nil, "It leaves, and the key changes", "", false, nil, nil))
            end
            rows.push(PanelUi.row(nil, "Remove", PanelHouseView.label(h, id), 2, ["house", "strike", id], nil))
            rows.push(PanelUi.row(nil, "Cancel", "", false, ["back"], nil))
            return ["Remove from house?", "", rows]
        end
        if kind == "houseMove"
            rows.push(PanelUi.row(nil, "It leaves this house", "", false, nil, nil))
            if bridge
                rows.push(PanelUi.row(nil, "Its Wi-Fi and devices stay on it", "", false, nil, nil))
                rows.push(PanelUi.row(nil, "Devices here", str(size(self.ui.store.remote_by_owner().find(id, []))), false, nil, nil))
            end
            rows.push(PanelUi.row(nil, "A panel of the other adds it", "", false, nil, nil))
            rows.push(PanelUi.row(nil, "Join another house", PanelHouseView.label(h, id), 2, ["house", "move", id], nil))
            rows.push(PanelUi.row(nil, "Cancel", "", false, ["back"], nil))
            return ["Join another house?", "", rows]
        end
        # the house's server: where it is, and its removal
        if server
            var ip = n["ip"]
            rows.push(PanelUi.row(nil, "Address", ip != nil ? str(ip[0]) + "." + str(ip[1]) + "." + str(ip[2]) + "." + str(ip[3]) + ":" + str(n["port"]) : "", false, nil, nil))
            if w  rows.push(PanelUi.row(nil, "Remove from house", "", 2, ["open", "houseStrike", id], nil)) end
            return [PanelHouseView.label(h, id), "", rows]
        end
        # its Main settings and its Wireless settings: this panel's own screens, or another node's as the house knows it
        if id == h.list.me
            rows.push(PanelUi.row(nil, "Main settings", "", false, ["house", "own", "settings"], nil))
            rows.push(PanelUi.row(nil, "Wireless settings", "", false, ["house", "own", "wireless"], nil))
        else
            rows.push(PanelUi.row(nil, "Main settings", "", false, ["open", "houseRemote", id, '["settings"]'], nil))
            rows.push(PanelUi.row(nil, "Wireless settings", "", false, ["open", "houseRemote", id, '["wireless"]'], nil))
        end
        # a bridge: whether it is this panel's favourite, this panel's choice and not the bridge's, and a touch makes it so
        if bridge && h.role == HouseList.ROLE_PANEL
            var yes = h.favorite() == id
            rows.push(PanelUi.row(nil, "Favorite", yes ? "Yes" : "No", false, ed && !yes ? ["house", "favorite", id] : nil, nil))
        end
        # what is done to the node, with Editing on: this panel joins another house or goes back to its own; another node joins another house or is removed
        if id == h.list.me && ed
            rows.push(PanelUi.row(nil, "Join another house", "", 2, ["open", "houseLeave", "join"], nil))
            if !h.own_house()  rows.push(PanelUi.row(nil, "Leave this house", "", 2, ["open", "houseLeave"], nil)) end
        elif w && id != h.list.me
            rows.push(PanelUi.row(nil, "Join another house", "", 2, ["open", "houseMove", id], nil))
            rows.push(PanelUi.row(nil, "Remove from house", "", 2, ["open", "houseStrike", id], nil))
        end
        return [PanelHouseView.label(h, id), "", rows]
    end

    # The window of the server's pairing: its code and this panel's address, for the owner to type on the server's OTA tab, and the time left; the server it
    # added; or how it closed
    def server_view(h)
        var rows = []
        var st = self.server != nil ? self.server.state() : {}
        if st.find("code") != nil
            var c = st["code"]
            rows.push(PanelUi.row(nil, "Code", c[0 .. 2] + " " + c[3 .. 5], false, nil, nil))
            rows.push(PanelUi.row(nil, "This panel", str(self.ui.wireless_state().find("ip", "")), false, nil, nil))
            rows.push(PanelUi.row(nil, "On the server", "OTA, Pair", false, nil, nil))
            var left = st["left"]
            rows.push(PanelUi.row(nil, "Closes in", str(left / 60) + ":" + (left % 60 < 10 ? "0" : "") + str(left % 60), false, nil, nil))
            rows.push(PanelUi.row(nil, "Cancel", "", false, ["house", "serverClose"], nil))
            return ["Add server", "", rows]
        end
        if st.find("added") != nil
            rows.push(PanelUi.row(nil, "Added", str(st["added"]), false, nil, nil))
            rows.push(PanelUi.row(nil, "Done", "", false, ["back"], nil))
            return ["Server added", "", rows]
        end
        var why = st.find("why")
        rows.push(PanelUi.row(nil, why == "tries" ? "Three wrong codes" : why == "time" ? "Two minutes went by" : "Closed", "", false, nil, nil))
        rows.push(PanelUi.row(nil, "Open it again", "", false, ["house", "serverWindow"], nil))
        rows.push(PanelUi.row(nil, "Done", "", false, ["back"], nil))
        return ["The window closed", "", rows]
    end

    # Another node's screen, as the node drew it, asked of it over the mesh: its rows as it sent them, each touch as the node said
    # (open its screen that follows, change a setting there, or open this panel's own screen that follows, a bridge's web password), and above them that this
    # panel asks, or that the node did not answer, with the way to ask again
    def remote_view(h, view)
        import json
        var id = view[1]
        var rv = view[2]
        var rows = []
        var title = ""
        var got = h.remote.find(id)
        var same = got != nil && json.dump(got[1]) == rv
        if same
            title = got[2]
            for k: 0 .. size(got[3]) - 1
                var r = got[3][k]
                var tap = nil
                # a screen that follows; this panel's own backup, its own screen
                if r[2] == 1 && size(r) > 4  tap = id == h.list.me && r[4][0] == "backup" ? ["backupOpen"] : ["open", "houseRemote", id, json.dump(r[4])]
                elif r[2] == 2  tap = ["house", "remote", id, rv, k]
                elif r[2] == 3 && size(r) > 4  tap = ["open", r[4][0], id]
                elif r[2] == 4  tap = ["house", "remoteText", id, rv, k]
                elif r[2] == 5  tap = ["house", "remoteAsk", id, rv, k]
                elif r[2] == 6 && size(r) > 4  tap = r[4]
                end
                var row = PanelUi.row(nil, str(r[0]), str(r[1]), r[3] == 2 ? 2 : false, tap, nil)
                # a value in the colour of its signal (node_wireless.be)
                if r[3] >= 11 && r[3] <= 13  PanelUi.toned(row, NodeWireless.TONES[r[3] - 10]) end
                rows.push(row)
            end
            # the node's hotspot: its QR on this panel's page for it, with the touches, for a phone to join it on its way to the node
            var q = size(got) > 5 ? got[5].find("q") : nil
            var ui = self.ui
            if isinstance(q, list) && size(q) > 3 && ui.shape["pages"].find("qr") != nil
                var taps = []
                for r: rows  if r[5] != nil taps.push(r) end end
                taps.push(PanelUi.row(nil, "Back", "", false, ["back"], nil))
                return [title, "", taps, nil, {"code": PanelUi.wifi_qr(q[0], q[1], ui.shape["qrMax"]), "lines": [q[0], "Password " + q[1], q[2], q[3]]}]
            end
        end
        var at = self.view_at.find(id)
        if at != nil && (!same || got[0] < at)
            if tasmota.millis() - at < PanelHouseView.ADMIN_MS
                rows.insert(0, PanelUi.row(nil, "Asking", "", false, nil, nil))
            else
                rows.insert(0, PanelUi.row(nil, "Ask again", "", false, ["house", "again", id, rv], nil))
                rows.insert(0, PanelUi.row(nil, "No answer", "", 2, nil, nil))
            end
        end
        if title == ""
            var w = json.load(rv)
            title = isinstance(w, list) && size(w) > 0 && w[0] == "wireless" ? "Wireless settings" : (w[0] == "settings" ? "Main settings" : "")
        end
        return [title, "", rows]
    end

    # A node's screen came: when the touch closed the screen it was on, as this panel's own does (a button's mode, a time of the screensaver), that screen goes
    # and the one under it is asked again; else the screens on show draw again
    def view_came(id)
        import json
        var h = PanelHouseView.house()
        var ui = self.ui
        var got = h != nil ? h.remote.find(id) : nil
        var top = ui.top()
        var on = got != nil && top != nil && top["view"][0] == "houseRemote" && top["view"][1] == id
        if on && got[4] && top["view"][2] == json.dump(got[1])
            ui.stack.remove(size(ui.stack) - 1)
            var under = ui.top()
            if under != nil && under["view"][0] == "houseRemote" && under["view"][1] == id  self.ask_remote(id, under["view"][2], nil, nil) end
            return ui.show()
        end
        var ex = on && size(got) > 5 ? got[5] : {}
        # the screen that follows the touch (a network picked, its join): on top of the one touched
        var out = nil
        if ex.find("g") == 1 && top["view"][2] != json.dump(got[1])
            out = ui.open(["houseRemote", id, json.dump(got[1])])
            top = ui.top()
        end
        # a screen that changes by itself (a search, a join, the hotspot): asked again while it is on show
        if ex.contains("a") && top["view"][2] == json.dump(got[1])
            var rv = top["view"][2]
            tasmota.remove_timer("house_remote_again")
            tasmota.set_timer(ex["a"], def ()
                var t = self.ui.top()
                if t != nil && t["view"][0] == "houseRemote" && t["view"][1] == id && t["view"][2] == rv  self.ask_remote(id, rv, nil, nil) end
            end, "house_remote_again")
        end
        return out != nil ? out : self.redraw()
    end

    # --- this panel's screens on another panel -----------------------------------------------------------------
    # Another panel of the house asks for a screen of this one's, or touches a row of it (house_mesh.be, told_view): the screen as this panel's own list draws it,
    # each row with what a touch does there. A touch that changes a setting is made here, as this panel's own touch would make it, and the screen goes back with
    # the setting changed; one that closes the screen it is on (a button's mode, a time of the screensaver) says so. Returns [view, title, rows, closed, the
    # effects for this panel's own glass], or nil for a screen or a touch another panel may not have
    def render_for(view, k, x, run)
        import global
        var ui = self.ui
        if !isinstance(view, list) || size(view) == 0 return nil end
        # its Wireless settings, as every node's (node_wireless.be): `run` does here what the touch asked, before the screen that follows is drawn
        if global.contains("NodeWireless") && global.NodeWireless.VIEWS.find(view[0]) != nil
            var go = run != nil ? run : / e -> nil
            if view[0] == "wifiSearch"  self.end_search_later(go) end
            return global.NodeWireless.answer(view, k, x, / -> self.node_state(), go)
        end
        if PanelHouseView.REMOTE_VIEWS.find(view[0]) == nil return nil end
        var closed = false
        var effects = []
        if k != nil
            var rows = ui.list_view(view)[2]
            if k < 0 || k >= size(rows) return nil end
            effects = self.apply_remote(rows[k][5])
            if effects == nil return nil end
            closed = rows[k][5][0] != "setting"
        end
        var out = []
        for r: ui.list_view(view)[2]
            var a = r[5]
            var row = [r[2], r[3], 0, r[4] == 2 ? 2 : 0]
            if a != nil && a[0] == "open" && size(a) > 1 && PanelHouseView.REMOTE_VIEWS.find(a[1]) != nil
                row[2] = 1
                row.push(a[1 ..])
            elif a != nil && PanelHouseView.REMOTE_EDITS.find(a[0]) != nil
                row[2] = 2
            end
            out.push(row)
        end
        return [view, ui.list_view(view)[0], out, closed, effects]
    end

    # What this panel's network is, for its Wireless settings on another panel (node_wireless.be): its Wi-Fi, its radio's channel and the house's, its MQTT and
    # its backup
    def node_state()
        var ui = self.ui
        var h = PanelHouseView.house()
        var m = h != nil ? h.channel_setting() : nil
        return {"wifi": ui.wireless_state(), "radio": h != nil && h.channel != nil ? h.channel.mine() : nil, "house_ch": m != nil ? m["channel"] : 0,
                "alone": h == nil || HouseChannel.alone(h), "mqtt": ui.mqtt != nil ? PanelUi.mqtt_hint(ui.mqtt.state()) : "Off",
                "backup": ui.backup != nil ? ui.backup.state() : nil, "ota": self.ota != nil ? self.ota.state() : nil}
    end

    # The OTA row of this panel's Wireless settings: its own OTA screen, opened as a node's, once it has a number in the house; nil before, and the Backup
    # row is there in its place
    def ota_row()
        var h = PanelHouseView.house()
        if self.ota == nil || !PanelHouseView.numbered(h) return nil end
        return PanelUi.row(nil, "OTA", NodeWireless.ota_word(self.ota.state()), false, ["open", "houseRemote", h.list.me, '["ota"]'], nil)
    end

    # The OTA or the server's pairing changed: this panel's own screen of it asked again, and the screens on show drawn again
    def ota_changed()
        import json
        var h = PanelHouseView.house()
        var top = self.ui.top()
        if h != nil && top != nil && top["view"][0] == "houseRemote" && top["view"][1] == h.list.me  self.ask_remote(h.list.me, top["view"][2], nil, nil) end
        return self.redraw()
    end

    # what a search another panel asked for found goes 2 min after, unless this panel's own glass shows it (the heap)
    def end_search_later(go)
        tasmota.remove_timer("house_remote_search")
        tasmota.set_timer(120000, def ()
            var t = self.ui.top()
            if t == nil || t["view"][0] != "wifiSearch"  go([["wifi", "endSearch"]]) end
        end, "house_remote_search")
    end

    # what another panel's touch does here: a setting turned (PanelUi.toggle_setting), a time of the screensaver or a button's mode chosen; the effects for this
    # panel's glass and flash, or nil for a touch another panel may not make
    def apply_remote(a)
        var ui = self.ui
        if a == nil || PanelHouseView.REMOTE_EDITS.find(a[0]) == nil return nil end
        var out = []
        if a[0] == "setting"
            out = ui.toggle_setting(a[1])
        elif a[0] == "saverTime"
            ui.prefs["screensaver"][a[1]] = a[2]
            out = [["prefs"]]
        else
            ui.prefs["buttons"][a[1] - 1] = a[2]
            out = [["prefs"], ["button", a[1], a[2]]]
        end
        for e: ui.show() out.push(e) end
        return out
    end

    # --- the house's page ------------------------------------------------------------------------------------------

    # the icons this image has, in their order: the calendar with the schedule, the alarm and the notifications with the alarm, the mesh with the house's layer
    def icons()
        var ui = self.ui
        var out = []
        for w: PanelHouseView.ICONS
            if w == "calendar" && ui.schedule == nil continue end
            if (w == "alarm" || w == "notifs") && ui.alarm == nil continue end
            if w == "mesh"
                var h = PanelHouseView.house()
                if h == nil || (!PanelHouseView.numbered(h) && !PanelHouseView.mesh_here()) continue end
            end
            out.push(w)
        end
        return out
    end

    # whether an icon is lit, in the theme's accent: the alarm while it is not disarmed, the notifications while some are not seen
    def lit(w)
        var a = self.ui.alarm != nil ? self.ui.alarm.alarm : nil
        if a == nil return false end
        if w == "alarm" return a.st != "disarmed" end
        if w == "notifs" return a.warnings() > 0 end
        return false
    end

    # The icons on the house's page, which has `places` for them: the first `n` of the ones this image has from the first place, and the places
    # left over hidden
    def icon_effects(n, places)
        var b = self.icons()
        if n < size(b)  b = n > 0 ? b[0 .. n - 1] : [] end
        var out = []
        for k: 0 .. places - 1
            var p = "$house.icons." + str(k)
            if k >= size(b)
                out.push(["set", p + ".shown", 0])
                continue
            end
            out.push(["set", p + ".icon", PanelHouseView.ROLES[b[k]]])
            out.push(["set", p + ".iconColor", self.lit(b[k]) ? PanelHouseView.LIT : PanelHouseView.TONE])
            out.push(["set", p + ".shown", 1])
        end
        return out
    end

    # A touch on an icon, by its path ("$house.icons.2.count"): what it opens. Main settings and Wireless settings through the pattern, as the swipes on a plan open them
    def icon_tap(subject)
        import string
        var parts = string.split(str(subject), ".")
        if size(parts) != 4 || parts[1] != "icons" return [] end
        var ui = self.ui
        var b = self.icons()
        var k = int(parts[2])
        if k < 0 || k >= size(b) return [] end
        var w = b[k]
        if w == "settings" return ui.open_settings() end
        if w == "wifi" return ui.open_wireless() end
        if w == "calendar" return ui.act(["schedule", "calendar"]) end
        if w == "alarm" || w == "notifs" return ui.act(["alarm", "open", w]) end
        return ui.open(["house"])
    end

    # whether the mesh's + is there: a node added to this panel's house, on a panel that writes it with the mesh up, with Editing on
    static def adds(h, ed)
        return ed == true && h != nil && h.up && h.writes() && PanelHouseView.numbered(h)
    end


    # the header's +, on the mesh: the search for a node to add to this house
    def header(ui)
        var top = ui.top()
        if top == nil || top["view"][0] != "house" || !PanelHouseView.adds(PanelHouseView.house(), ui.prefs["editing"]) return [] end
        return ui.act(["zigbeeAdd"])
    end

    # the page's title: the house's name, or Home where there is no house
    def title()
        var h = PanelHouseView.house()
        var n = PanelHouseView.numbered(h) ? h.list.name() : ""
        return n != "" ? n : PanelHouseView.NAME
    end

    # the title's long press, with Editing on: the house's name, on a panel that writes the list
    def rename(ui)
        var h = PanelHouseView.house()
        if !PanelHouseView.numbered(h) || !h.writes() return [] end
        return ui.open_keyboard(["keyboard", "house", "name"])
    end

    # a node's page's title, long pressed with Editing on: its name, on a panel that writes the list, for a node of the house
    def rename_node(ui, id)
        var h = PanelHouseView.house()
        if !PanelHouseView.numbered(h) || !h.writes() || h.list.node(id) == nil return [] end
        return ui.open_keyboard(["keyboard", "house", id])
    end

    # the house's name, or a node's (by its number), as the keyboard opens on it; or the text a row of another node's screen asks to type
    def keyboard(field)
        if isinstance(field, list)
            var spec = self.remote_spec(field[1], field[2], field[3])
            return spec != nil ? [str(spec[2]), spec[1]] : ["", 63]
        end
        if field == "name" return [self.title(), 20] end
        var h = PanelHouseView.house()
        return [h != nil ? PanelHouseView.label(h, field) : "", HouseList.MAX_NAME]
    end

    # what a row of another node's screen carries for this panel to do (node_wireless.be): [title, most characters, value] to type, or [question, line,
    # answer] to ask first; nil when the screen on show is not the one that came
    def remote_spec(id, rv, k)
        import json
        var h = PanelHouseView.house()
        var got = h != nil ? h.remote.find(id) : nil
        if got == nil || json.dump(got[1]) != rv || k >= size(got[3]) return nil end
        var r = got[3][k]
        return size(r) > 4 && isinstance(r[4], list) ? r[4] : nil
    end

    # OK on the keyboard: the house's new name, or a node's, which the list carries to every node; or a text for another node's row, which goes to it
    def commit(ui, field, text)
        if isinstance(field, list)
            PanelHouseView.first_page(ui)
            self.ask_remote(field[1], field[2], field[3], {"t": text})
            return ui.show()
        end
        var h = PanelHouseView.house()
        if PanelHouseView.numbered(h)
            if field == "name"  h.set_house_name(text) else h.rename(field, text) end
        end
        return ui.show()
    end

    # --- the views -------------------------------------------------------------------------------------------------------

    # why a node did not come into the house at the pairing, in a line (house_link.be's reasons)
    static def why_not(why)
        if why == "silent" return "It did not answer in time." end
        if why == "refused" return "It did not take what was given." end
        if why == "already" return "It is in a house already." end
        if why == "full" return "The house has no number left." end
        if why == "nokey" return "This panel does not hold the house's key." end
        if why == "nobody" return "No panel of the house answered." end
        if why == "leaving" return "This panel did not leave its house in time." end
        if why == "radio" return "The radio is busy: try again." end
        return "It cannot join a house."
    end

    def view(view, ed)
        var h = PanelHouseView.house()
        var rows = []
        if view[0] == "houseResult"
            var st = self.ui.zigbee_state()
            rows.push(PanelUi.row(nil, "Not added to the house", "", false, nil, nil))
            rows.push(PanelUi.row(nil, PanelHouseView.why_not(str(st.find("house", ""))), "", false, nil, nil))
            rows.push(PanelUi.row(nil, "Done", "", false, ["back"], nil))
            return ["House", "", rows]
        end
        if h == nil || (!PanelHouseView.numbered(h) && !PanelHouseView.mesh_here())
            rows.push(PanelUi.row(nil, "No mesh", "", false, nil, nil))
            return ["House", "", rows]
        end
        var kind = view[0]
        if kind == "house"
            # the nodes of the house: one struck off is forgotten, and the list keeps its number alone, never to give it again. Shown, it read
            # as a node that did not leave, and as a node twice once the same bridge came back under another number
            var ids = PanelHouseView.numbered(h) ? h.list.ids(false) : []
            if size(ids) == 0
                # a panel always has a house: with no number, it is the moment it founds its own, or after it left one, or it waits at its window for a
                # house to take it, whose screen the row opens. Else it is itself, with how it hears the mesh, and its page has the way into a house ("Starting this house" said nothing, and a panel fresh from its box had no way in)
                if self.ui.zigbee_state().find("window") != nil
                    rows.push(PanelUi.row(nil, "Joining a house", "", false, ["open", "houseWindow"], nil))
                else
                    rows.push(self.node_row(PanelHouseView.own_label() + " *", PanelHouseView.tie_parts(h.tie()), ["open", "houseNode", 0]))
                end
                return ["ESP-NOW Mesh", "", rows]
            end
            # the mesh's settings: the cog in the row of buttons over its nodes, on its own page, and on a layout that has no
            # such page, the first row, the cog alone. The + of the title adds a node
            if self.ui.shape["pages"].find("mesh") == nil  rows.push(PanelUi.row(["settings", PanelHouseView.TONE], "", "", false, ["open", "houseSettings"], nil)) end
            if h.key.pend != nil
                rows.push(PanelUi.row(nil, "Key change", str(size(h.key.waiting())) + " waiting", false, ["open", "houseKey"], nil))
            end
            # the access points of the house's network seen off its channel, first, in the colour of what is wrong
            var off = PanelHouseView.off_channels(h)
            for c: off.keys()
                rows.push(PanelUi.row(nil, "Wi-Fi on channel " + str(c), PanelUi.plural(off[c], "node", "nodes"), 2, ["open", "houseChannel"], nil))
            end
            for id: ids
                # this panel with a * by its name (it said "This panel")
                rows.push(self.node_row(PanelHouseView.label(h, id) + (id == h.list.me ? " *" : ""), PanelHouseView.state_parts(h, id), ["open", "houseNode", id]))
            end
            # the house's server: no node of the mesh, reached over the network
            for id: h.list.servers()
                rows.push(PanelUi.row(nil, PanelHouseView.label(h, id), "Server", false, ["open", "houseNode", id], nil))
            end
            return ["ESP-NOW Mesh", PanelHouseView.adds(h, ed) ? "add" : "", rows]
        end
        if kind == "houseWindow" return self.window_view(h) end
        if kind == "houseNode" && view[1] == 0 return self.self_view(h, ed) end
        if !PanelHouseView.numbered(h) return ["House", "", rows] end
        if kind == "houseChannel" || kind == "houseChannelPick" || kind == "houseChannelGo" || kind == "houseOffNet" return self.channel_view(h, kind, view, ed) end
        if kind == "houseNode" || kind == "houseStrike" || kind == "houseMove" || kind == "houseSettings" return self.node_view(h, kind, view, ed) end
        if kind == "houseRemote" return self.remote_view(h, view) end
        if kind == "houseServer" return self.server_view(h) end
        # the question a row of another node's screen asks first, on this panel's dialog
        if kind == "houseRemoteAsk"
            var spec = self.remote_spec(view[1], view[2], view[3])
            if spec == nil || size(spec) < 3 return ["", "", [PanelUi.row(nil, "Back", "", false, ["back"], nil)]] end
            return self.ui.dialog(str(spec[0]), str(spec[1]), str(spec[2]), ["house", "remoteYes", view[1], view[2], view[3]])
        end
        if kind == "houseWebpw" return self.admin_view(h, kind, view[1], ed) end
        if kind == "houseLeave"
            # out of its own house to join another, or out of another's, back to its own: the title says which
            var join = size(view) > 1 && view[1] == "join"
            var tail = join ? ["join"] : []
            # where it goes, first: to another house's panel, which adds it, or back to one of its own
            rows.push(PanelUi.row(nil, join ? "A panel of the other adds it" : "It founds one of its own", "", false, nil, nil))
            # the devices of the alarm that go with this panel, a warning
            var a = self.alarm_leaving(h)
            if h.writes() && PanelHouseView.last_panel(h)
                # the last panel takes the house's bridges along: a house always has a panel
                var n = size(h.bridges())
                rows.push(PanelUi.row(nil, "The last panel", "", false, nil, nil))
                if a > 0 rows.push(PanelUi.row(nil, "In the alarm", PanelUi.plural(a, "device", "devices"), 2, nil, nil)) end
                rows.push(PanelUi.row(nil, n > 0 ? "Leave with " + PanelUi.plural(n, "bridge", "bridges") : "Leave", "", 2, ["house", "leave", n > 0 ? -1 : 0] + tail, nil))
            else
                if a > 0 rows.push(PanelUi.row(nil, "In the alarm", PanelUi.plural(a, "device", "devices"), 2, nil, nil)) end
                rows.push(PanelUi.row(nil, "Leave", "", 2, ["house", "leave", 0] + tail, nil))
            end
            rows.push(PanelUi.row(nil, "Cancel", "", false, ["back"], nil))
            return [join ? "Join another house?" : "Back to its own house?", "", rows]
        end
        if kind == "houseKey"
            var w = h.key.waiting()
            for id: w rows.push(PanelUi.row(nil, PanelHouseView.label(h, id), "Waiting", false, nil, nil)) end
            if size(w) == 0 rows.push(PanelUi.row(nil, "Every node has it", "", false, nil, nil)) end
            if ed && h.writes() && h.key.pend != nil
                rows.push(PanelUi.row(nil, "Finish key change", "", 2, ["open", "houseFinish"], nil))
            end
            return ["Key change", "", rows]
        end
        rows.push(PanelUi.row(nil, "The ones that did not answer stay as they are", "", false, nil, nil))
        rows.push(PanelUi.row(nil, "Finish", "", 2, ["house", "finish"], nil))
        rows.push(PanelUi.row(nil, "Cancel", "", false, ["back"], nil))
        return ["Finish it?", "", rows]
    end

    # the window asked of the pairing, and its view on top
    static def window_open(ui)
        var top = ui.top()
        var out = top != nil && top["view"][0] == "houseWindow" ? [] : ui.push_view(["houseWindow"])
        out.push(["zigbee", "window"])
        out.push(["show"])
        return out
    end

    # This panel's own window, as zigbee_pairing.be's state says it: waiting for this panel to be out of its house, open for a panel
    # of a house to find it, picked (its screen says it is the one), joining, and how it ended
    def window_view(h)
        var w = self.ui.zigbee_state().find("window")
        var st = w != nil ? w["state"] : "closed"
        var rows = []
        var cancel = PanelUi.row(nil, "Cancel", "", false, ["house", "closeWindow"], nil)
        var done = PanelUi.row(nil, "Done", "", false, ["house", "closeWindow"], nil)
        if st == "leaving"
            rows.push(PanelUi.row(nil, "Leaving this house", "", false, nil, nil))
            rows.push(cancel)
            return ["Join a house", "", rows]
        elif st == "open"
            rows.push(PanelUi.row(nil, "On a panel of the house", "Add to this house", false, nil, nil))
            rows.push(PanelUi.row(nil, "This panel", PanelHouseView.own_label(), false, nil, nil))
            rows.push(cancel)
            return ["Waiting to be added", "", rows]
        elif st == "asked"
            rows.push(PanelUi.row(nil, "This is the panel", PanelHouseView.own_label(), false, nil, nil))
            rows.push(PanelUi.row(nil, "Yes there adds it", "", false, nil, nil))
            rows.push(cancel)
            return ["This one", "", rows]
        elif st == "joining"
            rows.push(PanelUi.row(nil, "A few seconds", "", false, nil, nil))
            return ["Joining the house", "", rows]
        elif st == "in"
            rows.push(PanelUi.row(nil, "House", h.up ? h.list.name() : "", false, nil, nil))
            rows.push(done)
            return ["Added to the house", "", rows]
        elif st == "no"
            rows.push(PanelUi.row(nil, PanelHouseView.why_not(w["why"]), "", false, nil, nil))
            rows.push(done)
            return ["Not added", "", rows]
        end
        rows.push(PanelUi.row(nil, "Open it again", "", false, ["house", "window"], nil))
        rows.push(done)
        return ["The window closed", "", rows]
    end

    # --- a bridge's web password and its factory reset ----------------------------------------------------------------------------

    # The house's numbers, m (number -> true; house_mesh.be, sweep()): the web passwords this panel drew for bridges that are no more, and the words it waits
    # the answer of from them, go
    def sweep(m)
        import persist
        var drop = []
        for k: self.asked.keys()
            if !m.contains(k)  drop.push(k) end
        end
        for k: drop  self.asked.remove(k) end
        var pw = persist.find(PanelHouseView.WEBPW, nil)
        if !isinstance(pw, map) return end
        drop = []
        for k: pw.keys()
            if !m.contains(int(k))  drop.push(k) end
        end
        if size(drop) == 0 return end
        for k: drop  pw.remove(k) end
        persist.setmember(PanelHouseView.WEBPW, pw)
        try
            persist.save()
        except .. as e, msg
            log("HOUSE: the web passwords of the bridges gone were not taken from the flash (" + str(e) + ": " + str(msg) + ")", 2)
        end
    end

    # the web password drawn for the bridge numbered `id`, as this panel keeps it, or nil
    static def password_of(id)
        import persist
        var m = persist.find(PanelHouseView.WEBPW, nil)
        return isinstance(m, map) ? m.find(str(id)) : nil
    end

    static def keep_password(id, pw)
        import persist
        var m = persist.find(PanelHouseView.WEBPW, nil)
        if !isinstance(m, map)  m = {} end
        if pw == nil
            if m.contains(str(id))  m.remove(str(id)) end
        else
            m[str(id)] = pw
        end
        persist.setmember(PanelHouseView.WEBPW, m)
        try
            persist.save()
        except .. as e, msg
            log("HOUSE: the bridge's web password was not saved (" + str(e) + ": " + str(msg) + ")", 2)
        end
    end

    # a password of PW_LEN letters and digits that cannot be mistaken for each other
    static def draw_password()
        import crypto
        var r = crypto.random(PanelHouseView.PW_LEN)
        var chars = PanelHouseView.PW_CHARS
        var out = ""
        for i: 0 .. PanelHouseView.PW_LEN - 1  out += chars[r[i] % size(chars)] end
        return out
    end

    # what the bridge was last asked, as the screen says it: "Asking", "No answer", or nil
    def asked_word(id)
        var a = self.asked.find(id)
        if a == nil return nil end
        if a["state"] == "asking" return "Asking" end
        if a["state"] == "silent" return "No answer" end
        return nil
    end

    def admin_view(h, kind, id, ed)
        var rows = []
        var word = self.asked_word(id)
        var pw = PanelHouseView.password_of(id)
        if word != nil  rows.push(PanelUi.row(nil, word, "", false, nil, nil)) end
        rows.push(PanelUi.row(nil, "Password", pw != nil ? pw : "None", false, nil, nil))
        if ed && h.writes()
            rows.push(PanelUi.row(nil, pw != nil ? "Generate another" : "Generate", "", false, ["house", "admin", id, "lock"], nil))
            if pw != nil  rows.push(PanelUi.row(nil, "Remove", "", 2, ["house", "admin", id, "unlock"], nil)) end
        end
        return [PanelHouseView.label(h, id), "", rows]
    end

    # the word to the bridge, over the mesh: the effect that sends it, and the screen that waits for its answer
    def admin(ui, h, id, what)
        var out = self.admin_word(h, id, what)
        if size(out) == 0 return out end
        for e: ui.show() out.push(e) end
        return out
    end

    # The word alone: the effect that sends it, and its answer awaited. A factory reset (a bridge's Remove from house) not answered strikes the bridge off all
    # the same, ADMIN_MS later (silent); answered, the bridge goes by itself, and says so to the panels (house_mesh.be, go)
    def admin_word(h, id, what)
        import json
        if !h.writes() || h.list.role(id) != HouseList.ROLE_BRIDGE || h.list.revoked(id) return [] end
        var n = PanelHouseView.draw_password()
        var m = {"do": what, "n": n}
        var pw = nil
        if what == "lock"
            pw = PanelHouseView.draw_password()
            m["pw"] = pw
        end
        self.asked[id] = {"do": what, "n": n, "pw": pw, "until": tasmota.millis(PanelHouseView.ADMIN_MS), "state": "asking"}
        tasmota.set_timer(PanelHouseView.ADMIN_MS, / -> self.silent(id, n), "panel_house_admin")
        return [["sendAt", id, "ZbRelayAdmin " + json.dump(m)]]
    end

    # the time of a word went by with no answer
    def silent(id, n)
        var a = self.asked.find(id)
        if a == nil || a["n"] != n || a["state"] != "asking" return end
        a["state"] = "silent"
        # a bridge removed that did not answer is struck off anyway: told to leave, and the key changes (house_mesh.be, remove)
        if a["do"] == "factory"
            var h = PanelHouseView.house()
            if h != nil && !h.list.revoked(id)  h.remove(id) end
        end
        self.changed()
    end

    # The bridge's answer, over the mesh, by the word it answers: the password kept, or forgotten, and the screen told
    def answered(v)
        if !isinstance(v, map) return end
        var n = str(v.find("n", ""))
        for id: self.asked.keys()
            var a = self.asked[id]
            if a["n"] == n && a["state"] == "asking"
                a["state"] = "done"
                if a["do"] == "lock"  PanelHouseView.keep_password(id, a["pw"]) end
                if a["do"] == "unlock" || a["do"] == "factory"  PanelHouseView.keep_password(id, nil) end
                self.changed()
                return
            end
        end
    end

    def changed()
        if self.on_change != nil  self.on_change() end
    end

    # the effects that draw a screen of the house again, when one is on show
    def redraw()
        var top = self.ui.top()
        if top == nil || !self.shows(top["view"][0]) return [] end
        return self.ui.show()
    end

    # --- a touch -------------------------------------------------------------------------------------------------------------

    def act(ui, a)
        var h = PanelHouseView.house()
        if h == nil return [] end
        var what = a[1]
        # this panel's window closed, or done with: a touch that changes nothing of a house, with Editing off too
        if what == "closeWindow"
            var out = [["zigbee", "closeWindow"]]
            for e: ui.back() out.push(e) end
            return out
        end
        # this panel's own Main settings and Wireless settings, from its page on the mesh
        if what == "own" return a[2] == "wireless" ? ui.open_wireless() : ui.open_settings() end
        # the window of the server's pairing: opened with its screen, and closed by its Cancel
        if what == "serverWindow" || what == "serverClose"
            if self.server == nil || !h.writes() || (what == "serverWindow" && !ui.prefs.find("editing", false)) return [] end
            if what == "serverClose"
                self.server.close(nil)
                return ui.back()
            end
            self.server.open()
            var t = ui.top()
            return t != nil && t["view"][0] == "houseServer" ? ui.show() : ui.open(["houseServer"])
        end
        # a node's screen asked again, once it did not answer
        if what == "again"
            self.ask_remote(a[2], a[3], nil, nil)
            return ui.show()
        end
        if !ui.prefs.find("editing", false) return [] end
        # a row of another node's screen that changes a setting there: the touch goes to the node, which answers with the screen again
        if what == "remote"
            PanelHouseView.first_page(ui)
            self.ask_remote(a[2], a[3], a[4], nil)
            return ui.show()
        end
        # one that asks for a text, typed here (a network's password, its name), or asks first (Forget the network?), and then goes to the node
        if what == "remoteText" return ui.open_keyboard(["keyboard", "house", ["text", a[2], a[3], a[4]]]) end
        if what == "remoteAsk" return ui.open(["houseRemoteAsk", a[2], a[3], a[4]]) end
        if what == "remoteYes"
            ui.stack.remove(size(ui.stack) - 1)
            PanelHouseView.first_page(ui)
            self.ask_remote(a[2], a[3], a[4], {"y": 1})
            return ui.show()
        end
        # the window again, once it closed with no house taking this panel (Open it again): out of the house of its own it has founded meanwhile, and the
        # window
        if what == "window"
            if h.up && PanelHouseView.numbered(h)  h.leave_house(0) end
            return PanelHouseView.window_open(ui)
        end
        if what == "strike"
            # a bridge goes back to its factory settings, by its word (and is struck off when it goes, or when it says nothing); a panel is told to leave, and struck off;
            # the server, which hears no word of the mesh, struck off at once
            var out = []
            if h.list.role(a[2]) == HouseList.ROLE_SERVER
                if !h.revoke(a[2]) return [] end
            elif h.list.role(a[2]) == HouseList.ROLE_BRIDGE
                out = self.admin_word(h, a[2], "factory")
                if size(out) == 0 return [] end
            elif !h.remove(a[2])
                return []
            end
            ui.stack.remove(size(ui.stack) - 1)
            for e: ui.back() out.push(e) end
            return out
        end
        if what == "move"
            # another node to another house: the word, and it goes by itself (house_mesh.be, move)
            if !h.move(a[2]) return [] end
            ui.stack.remove(size(ui.stack) - 1)
            return ui.back()
        end
        if what == "leave"
            if !h.leave_house(a[2]) return [] end
            ui.stack.remove(size(ui.stack) - 1)
            # to join another house: this panel's window, where it waits, once it is out of this one, to be added; out of another's, back
            # on the mesh, which shows its own house once it is founded
            if size(a) > 3 && a[3] == "join" return PanelHouseView.window_open(ui) end
            return ui.back()
        end
        if what == "favorite"
            if !h.set_favorite(a[2]) return [] end
            return ui.show()
        end
        if what == "admin" return self.admin(ui, h, a[2], a[3]) end
        if what == "channel"
            # the house moves: the question and the list it came from go, and the channel's view, where there is one, says when
            if !h.set_channel(a[2], nil) return [] end
            ui.stack.remove(size(ui.stack) - 1)
            var top = ui.top()
            if top != nil && top["view"][0] == "houseChannelPick"  ui.stack.remove(size(ui.stack) - 1) end
            top = ui.top()
            if top != nil && top["view"][0] == "houseOffNet"
                ui.stack.remove(size(ui.stack) - 1)
                return ui.open(["houseChannel"])
            end
            return ui.show()
        end
        if what == "finish"
            if !h.key.finish() return [] end
            ui.stack.remove(size(ui.stack) - 1)
            return ui.back()
        end
        return []
    end
end
