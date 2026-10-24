# zigbee_pairing.be -- a panel adds a node to its house: "Add to this house". Every pairing is entering the house: a panel that
# writes the list finds the nodes whose window is open (a bridge's button, a panel's own window), the one picked identifies itself, the user says Yes,
# and the two pair over ESP-NOW as a guest's exchange (xdrv_98_espnow_direct.ino, EspNowPairWith <id>,guest): neither side writes a record, and the link
# of the exchange lives in RAM for as long as it lasts. Over that link the node says who it is, the panel gives it the welcome of the house (house_link.be:
# the number, the key and the list), and a new bridge is offered this panel's Wi-Fi, or offers its own, and takes the room's Zigbee channel this panel
# chose. Then the exchange ends: the node is in the house, and everything else goes over the mesh.
#
# The pairing, as the driver reports it to the rules:
#   {"EspNowPair":{"Heard":{"Id","Mac","Rssi","Channel","Version","Name","Zigbee","Network","Busy","Guest","Display"}}}
#   {"EspNowPair":{"Scan":"Sweeping"}}, {"EspNowPair":{"Scan":"Done","Count":<n>}}
#   {"EspNowPair":{"Blinking":<mac>}}: the node picked identifies itself, and the glass asks
#   {"EspNowPair":{"Paired":<mac>,"Epoch":<n>,"Guest":1}}, {"EspNowPair":{"Guest":"Ended"}}
#   {"EspNowPair":{"Failed":<why>}}, {"EspNowPair":{"Ended":"Timeout"}}
# Then, over the link of the exchange, as events:
#   panel -> node   {"ZbPair":"guest","house":<1 or 2>,"zigbee":<channel>,"radio":<channel>}: whether this panel is in a house, the room's Zigbee channel,
#                   and the house's channel (house_channel.be), where the mesh is: a node with no network keeps its radio there (EspNowMeshChannel), until
#                   the list the welcome gives it says the same
#   node -> panel   {"ZbPair":"guest","name","ip","house","ssid","up"}: who it is, whether it can take a welcome (1) or is in a house (2), and its network
#   either way, `houseAsk`, `houseId`, `housePiece`, `houseAck`, `houseDone` and `houseNo`: the welcome (house_link.be)
#   panel -> bridge {"ZbPair":"wifiAsk"}: Use, and the bridge gives its network (EspNowGiveWifi)
#   panel -> bridge EspNowGiveWifi: Give, this panel's network, which the bridge joins
#   bridge -> panel {"ZbPair":"wifiResult","state":"Refused","reason":"Button"}: its network goes only after its button
#   panel -> node   {"ZbPair":"done"}: the exchange is over, and the node's window closes
# The passwords of the Wi-Fi go only through the driver, over the encrypted link, and after a touch on the glass: never through this file.
#
# The factory reset and the web password of a bridge are words of any panel of the house over the mesh (panel_house_view.be).
#
# Loaded with load(), after zigbee_bridge.be.

#@ solidify:ZigbeePairing
class ZigbeePairing : Driver
    static HELLO_MS = 1500      # the panel's word goes again until the node's comes
    static WINDOW_S = 300       # this panel's own window, for a panel of a house to add it
    static IDENTIFY_MS = 10000  # how long its screen says it is the one, once the other panel asked
    static LEAVE_WAIT_MS = 15000 # a window asked for while this panel is still leaving its house waits this long for the leave
    static WIFI_MS = 45000      # how long the bridge's network asked for (Use) waits for its answer
    static WIFI_SCAN_MS = 10000 # the most the networks' search before the nodes' may take
    static STRONG_RSSI = -75    # a network around this strong is a neighbour the room's Zigbee keeps away from
    # the Zigbee channels between Wi-Fi's 1, 6 and 11, in the order a tie takes them: 26 last, whose power some countries hold down
    static ZIGBEE_CHANNELS = [25, 15, 20, 26]
    # the driver's reasons, as the views read them
    static FAILED = {"Busy": "busy", "NoAnswer": "noanswer", "Proof": "proof", "NotConfirmed": "notconfirmed",
                     "Timeout": "timeout", "Key": "key", "Radio": "radio", "Memory": "memory"}

    var bridge      # the ZigbeeBridge
    var found       # the nodes the search heard, strongest first:
                    # [{"id", "mac", "name", "rssi", "channel", "version", "network", "busy", "zigbee", "guest", "display"}]
    var searching   # the search runs
    var sweeping    # and listens on every channel, with the Wi-Fi paused
    var asking      # the step: nil, "blink", "blinking", "pairing", "hello", "house", "offer" or "wifi"
    var chosen      # the node of the pairing, its entry of found
    var pending     # the MAC of a node tapped while the search still listened, asked to identify itself once it is over
    var result      # how the last pairing ended: "paired", "busy", "noanswer", "proof", "notconfirmed", "timeout", "key", "radio", "version",
                    # "noguest", or nil
    var holder      # who had the radio when it was "radio", as the driver says it: "WifiManager", "Join", "Scan" or "Hotspot", or nil
    var offer       # the Wi-Fi the glass offers: {"kind": "use" or "give", "ssid"}, or nil
    var wifi        # the Wi-Fi handed over: {"kind", "ssid", "state", "reason", "until"}, or nil; state "asking", "joining", "connected", "failed" or "unknown"
    var hello_at    # when the panel's word goes again, while the node's has not come
    var hello_ssid  # what the node said of its network, kept for the Wi-Fi's offer that comes after the house
    var hello_up
    var guesting    # the driver paired this panel with the node, and the link is the exchange's until it says it ended
    var window      # this panel's own window, for a panel of a house to add it: nil, or {"state", "until", "why"}, the state "leaving" (it waits
                    # for this panel to be out of its house), "open", "asked" (a panel picked this one, and the screen says so), "joining", "in", "no" or "closed"
    var wguest      # the window's exchange is up
    var house_result # how the house went at the last pairing: nil, "in" or why not (house_link.be: silent, refused, none, struck, full, nokey, nobody; and
                     # "already", a node in a house already, which the link's word says "in")
    var home_channel # the Wi-Fi channel of this panel's network before the search left it, or 0
    var around      # the Wi-Fi channels of the strong networks around, from the networks' search
    var prescan_until # the networks' search, before the nodes', runs until then; nil when it does not
    var on_change   # f(): something a view of the pairing shows changed

    def init(bridge)
        self.bridge = bridge
        self.found = []
        self.searching = false
        self.sweeping = false
        self.asking = nil
        self.chosen = nil
        self.pending = nil
        self.result = nil
        self.offer = nil
        self.wifi = nil
        self.hello_at = nil
        self.guesting = false
        self.hello_ssid = ""
        self.hello_up = false
        self.house_result = nil
        self.window = nil
        self.wguest = false
        self.home_channel = 0
        self.around = []
        self.prescan_until = nil
        self.on_change = nil
        # what the driver says of the pairing, in one rule: every word of it is a key of {"EspNowPair": {...}}, and a rule a word would keep one entry of
        # Tasmota's in the heap for each
        # and in the panel's one rule (panel_rules.be) where the boot made it
        import global
        var rules = global.contains("panel_rules") && global.panel_rules != nil ? global.panel_rules : tasmota
        rules.add_rule("EspNowPair", / v, t, m -> self.said(v, m), "zb_pairing")
        rules.add_rule("EspNowDirect#WifiOffered", / v -> self.wifi_offered(str(v)), "zb_pairing")
        rules.add_rule("StaJoin#State", / v, t, m -> self.wifi_joined(m), "zb_pairing")
        rules.add_rule("StaScan", / v -> self.wifi_scanned(v), "zb_pairing")
        # what the node says over the link
        rules.add_rule("ZbPair", / v, t, m -> self.from_link(m), "zb_pairing")
        tasmota.add_driver(self)
    end

    # The driver's words: the nodes heard and the end of a search; the node picked blinking; paired, as a guest, and the exchange over (the Paired event of a
    # guest has a "Guest" of 1 beside it, and the end a "Guest" of "Ended"); a pairing that failed or was left; and, at this panel's own window, picked by a
    # panel of a house, and closed
    def said(v, m)
        if !isinstance(v, map) return end
        for k: v.keys()
            var x = v[k]
            if k == "Heard"
                self.heard(x)
            elif k == "Scan"
                self.scanned(x)
            elif k == "Blinking"
                self.blinking()
            elif k == "Paired"
                self.paired(str(x), m)
            elif k == "Guest" && x == "Ended"
                self.guest_ended()
            elif k == "Failed"
                self.failed(str(x))
            elif k == "Ended"
                self.ended()
            elif k == "Blink"
                self.identify()
            elif k == "Window"
                self.window_closed()
            end
        end
    end

    # the network this panel has saved, by name, or "": the pairing may have its Wi-Fi paused, and the network is the same
    static def own_network()
        var r = tasmota.cmd("SSId1")
        return isinstance(r, map) ? str(r.find("SSId1", "")) : ""
    end

    # a command's own answer, the value under its name, or nil
    static def answer(r, name)
        return isinstance(r, map) ? r.find(name) : nil
    end

    # an event to the node, over the link of the exchange: true when it went to the radio
    static def tell(msg)
        import global
        import json
        return global.contains("espnow_send") && global.espnow_send(json.dump(msg), true) == true
    end

    # the link of the house layer on this panel (house_link.be), or nil where the image has none
    static def house_link()
        import global
        return global.contains("house") && global.house != nil ? global.house.link : nil
    end

    # whether this panel gives the welcome ("give") or takes it ("wait") at the pairing in place, or nil
    static def house_role()
        var l = ZigbeePairing.house_link()
        return l != nil ? l.role : nil
    end

    # what this panel says of the house: 0 no mesh driver, 1 it can take a welcome, 2 it is in a house
    static def house_flag()
        var l = ZigbeePairing.house_link()
        return l != nil ? l.flag() : 0
    end

    # --- the search --------------------------------------------------------------------------

    # A search: the driver listens on this channel, then on every one, for the nodes with their window open
    def discover()
        self.found = []
        self.sweeping = false
        self.asking = nil
        self.chosen = nil
        self.pending = nil
        self.result = nil
        self.holder = nil
        self.offer = nil
        self.wifi = nil
        self.house_result = nil
        self.home_channel = ZigbeePairing.station_channel()
        self.around = []
        # the networks around first, for the room's Zigbee channel: the nodes' search holds the radio on their
        # channels, and the networks' passes under any owner but that one
        if ZigbeePairing.answer(tasmota.cmd("StaScan"), "StaScan") == "Started"
            self.searching = true
            self.prescan_until = tasmota.millis() + ZigbeePairing.WIFI_SCAN_MS
            return
        end
        self.scan_nodes()
    end

    # the nodes' search, the pairing's own
    def scan_nodes()
        self.prescan_until = nil
        var res = tasmota.cmd("EspNowPairScan")
        var r = ZigbeePairing.answer(res, "EspNowPairScan")
        self.searching = r == "Started"
        # the WiFi Manager, a join or a scan has the radio: the search waits for them, and the glass says which
        if r == "Busy"
            self.result = "radio"
            self.holder = ZigbeePairing.answer(res, "Owner")
        end
    end

    # The networks around, as the station driver reports them, each [ssid, rssi, auth, channel, bssid]: the channels of the strong ones kept for the room's
    # Zigbee, and the nodes' search starts. The command's own answer reaches the rule too, as it is sent: only the report is a map
    def wifi_scanned(v)
        if self.prescan_until == nil || !isinstance(v, map) return end
        var nets = v.find("Networks")
        if isinstance(nets, list)
            for n: nets
                if isinstance(n, list) && size(n) >= 4 && int(n[1]) >= ZigbeePairing.STRONG_RSSI
                    var ch = int(n[3])
                    if ch >= 1 && ch <= 13 && self.around.find(ch) == nil  self.around.push(ch) end
                end
            end
        end
        self.scan_nodes()
        self.changed()
    end

    # the channel of the network this panel is on, which the search is about to leave, as Tasmota's state says it (Status 11), or 0 with no network
    # the channel the mesh keeps for this panel's radio when it is on no network (EspNowMeshChannel), or 0: none yet
    static def mesh_channel()
        var r = ZigbeePairing.answer(tasmota.cmd("EspNowMeshChannel", true), "EspNowMeshChannel")
        return type(r) == "int" ? r : 0
    end

    # the house's channel, as its list has it (house_channel.be), or 0 while the house has none
    static def house_channel()
        import global
        var h = global.contains("house") ? global.house : nil
        var m = h != nil && h.up ? h.channel_setting() : nil
        return m != nil ? m["channel"] : 0
    end

    static def station_channel()
        if tasmota.wifi().find("up", false) != true return 0 end
        var sts = ZigbeePairing.answer(tasmota.cmd("Status 11"), "StatusSTS")
        var w = isinstance(sts, map) ? sts.find("Wifi") : nil
        return isinstance(w, map) ? int(w.find("Channel", 0)) : 0
    end

    # The room's Zigbee channel: of the four between Wi-Fi's channels 1, 6 and 11, the one farthest, in MHz, from this panel's
    # Wi-Fi, from the strong networks around (`around`, their Wi-Fi channels) and from the Zigbee of the other bridges the search
    # heard. A new bridge takes it only while its network has no device yet
    static def zigbee_channel(wifi, others, around)
        var wifis = around != nil ? around.copy() : []
        if wifi >= 1 && wifi <= 13  wifis.push(wifi) end
        var best = ZigbeePairing.ZIGBEE_CHANNELS[0]
        var best_gap = -1
        for c: ZigbeePairing.ZIGBEE_CHANNELS
            var f = 2405 + 5 * (c - 11)
            var gap = 1000
            for w: wifis
                if w >= 1 && w <= 13
                    var dw = f - (2407 + 5 * w)
                    if dw < 0 dw = -dw end
                    if dw < gap gap = dw end
                end
            end
            for o: others
                if o >= 11 && o <= 26
                    var d = f - (2405 + 5 * (o - 11))
                    if d < 0 d = -d end
                    if d < gap gap = d end
                end
            end
            if gap > best_gap
                best_gap = gap
                best = c
            end
        end
        return best
    end

    # the channel proposed to the node being added
    def room_zigbee()
        var others = []
        for f: self.found
            if self.chosen == nil || f["id"] != self.chosen["id"]  others.push(f["zigbee"]) end
        end
        return ZigbeePairing.zigbee_channel(self.home_channel, others, self.around)
    end

    # A node heard, as the search goes. The driver keeps the strongest: one that takes the weakest's place comes with its id, and
    # takes its row
    def heard(v)
        if !isinstance(v, map) || !self.searching return end
        var e = ZigbeePairing.entry(v)
        var i = 0
        while i < size(self.found)
            if self.found[i]["id"] == e["id"]
                if self.found[i]["mac"] == e["mac"] return end
                self.found[i] = e
                self.changed()
                return
            end
            i += 1
        end
        self.found.push(e)
        self.changed()
    end

    static def entry(v)
        return {"id": int(v.find("Id", 0)), "mac": str(v.find("Mac", "")), "name": str(v.find("Name", "")),
                "rssi": int(v.find("Rssi", -100)), "channel": int(v.find("Channel", 0)), "version": int(v.find("Version", 0)),
                "network": v.find("Network") == 1, "busy": v.find("Busy") == 1, "zigbee": int(v.find("Zigbee", 0)), "guest": v.find("Guest") == 1,
                "display": v.find("Display") == 1}
    end

    # the sweep began, with the Wi-Fi paused, or the search is over: the list, as the driver sorts it, strongest first, and the node tapped meanwhile asked
    def scanned(v)
        if !self.searching return end
        if v == "Sweeping"
            self.sweeping = true
        elif v == "Done"
            self.searching = false
            self.sweeping = false
            var sorted = ZigbeePairing.answer(tasmota.cmd("EspNowPairHeard"), "EspNowPairHeard")
            if isinstance(sorted, list)
                self.found = []
                for h: sorted self.found.push(ZigbeePairing.entry(h)) end
            end
            if self.pending != nil
                # by its address: one whose place a stronger took is gone, and the glass goes back to the list
                var mac = self.pending
                var id = nil
                self.pending = nil
                for f: self.found
                    if f["mac"] == mac  id = f["id"] end
                end
                if id != nil
                    self.blink(id)
                else
                    self.asking = nil
                    self.chosen = nil
                end
            end
        end
        self.changed()
    end

    # --- the pairing ---------------------------------------------------------------------------

    # A node of the list, tapped: it is asked to identify itself, and the glass asks whether it does. One of another version is not asked. The list shows
    # what is heard as the search goes, and the driver takes the request only once the search is over: one tapped before is asked then (scanned)
    def blink(id)
        var b = nil
        for f: self.found if f["id"] == id b = f end end
        if b == nil return end
        self.chosen = b
        self.result = nil
        var r = ZigbeePairing.answer(tasmota.cmd("EspNowPairBlink " + str(id)), "EspNowPairBlink")
        if r == "Started"
            self.asking = "blink"
        elif r == "Scanning"
            self.asking = "blink"
            self.pending = b["mac"]
        elif r == "Version"
            self.asking = nil
            self.result = "version"
        else
            self.asking = nil
            self.chosen = nil
            self.result = "timeout"
            self.changed()
        end
    end

    def blinking()
        if self.asking == "blink"
            self.asking = "blinking"
            self.changed()
        end
    end

    # It identifies itself, the user said: the keys, with a proof from each side, as a guest's exchange
    def pair()
        if self.chosen == nil || (self.asking != "blink" && self.asking != "blinking") return end
        var said = ZigbeePairing.answer(tasmota.cmd("EspNowPairWith " + str(self.chosen["id"]) + ",guest"), "EspNowPairWith")
        if said == "Started"
            self.asking = "pairing"
        elif said == "No guest"
            # a window of a build that does not take a guest: nothing was sent
            self.asking = nil
            self.result = "noguest"
            self.changed()
        end
    end

    # It does not identify itself: not the right one, back to the list. Its session there ends on its own
    def not_blinking()
        self.asking = nil
        self.chosen = nil
        self.pending = nil
        self.changed()
    end

    # The driver paired this panel with the node, as a guest: nothing is saved, here or in the driver, and this panel's word goes until the node's comes.
    # Paired at its own window, by a panel that adds it, the exchange is the window's
    def paired(mac, m)
        if self.asking != "pairing"
            if self.window != nil  self.window_paired(mac) end
            return
        end
        self.guesting = true
        self.house_result = nil
        self.asking = "hello"
        self.hello_at = tasmota.millis()
        log("ZBPAIR: paired with " + mac + " to add it to the house", 2)
        self.changed()
    end

    def failed(why)
        if self.asking == nil && !self.searching return end
        self.asking = nil
        self.pending = nil
        self.searching = false
        self.sweeping = false
        self.result = ZigbeePairing.FAILED.find(why, "noanswer")
        # the driver ends a pairing for the radio only when the WiFi Manager takes it
        self.holder = why == "Radio" ? "WifiManager" : nil
        self.changed()
    end

    # the driver ended a pairing left alone: the radio is the Wi-Fi's again
    def ended()
        if self.window != nil  self.window_closed() end
        self.searching = false
        self.sweeping = false
        self.pending = nil
        if self.guesting && (self.asking == "hello" || self.asking == "house")
            # the exchange's time is up with the node not heard: nothing was changed, and nothing is undone
            self.guest_ended()
            return
        end
        if self.asking != nil && self.asking != "wifi"  self.asking = nil end
        self.changed()
    end

    # This panel's word to the node it is paired with: whether it is in a house, the room's Zigbee channel, and the house's radio channel, again until the
    # node's comes. The house's radio is the house's channel (house_channel.be); with none yet, this panel's network's channel, or, on no network, the one its
    # mesh keeps (EspNowMeshChannel), where the nodes of the house with no network are; none of them, and the node's is the house's (house_over)
    def say_guest()
        var msg = {"ZbPair": "guest", "zigbee": self.room_zigbee()}
        var radio = ZigbeePairing.house_channel()
        if radio == 0  radio = self.home_channel > 0 ? self.home_channel : ZigbeePairing.mesh_channel() end
        if radio > 0  msg["radio"] = radio end
        var house = ZigbeePairing.house_flag()
        if house > 0  msg["house"] = house end
        ZigbeePairing.tell(msg)
        self.hello_at = tasmota.millis() + ZigbeePairing.HELLO_MS
    end

    # The node says who it is: a panel that is in the house and writes adds it to the list, as a panel when its window said it has a display
    # and as a bridge otherwise, and gives it the welcome. Anything else has nothing to do, and the glass says why
    def guest_step(m)
        self.hello_at = nil
        self.house_result = nil
        self.hello_ssid = str(m.find("ssid", ""))
        self.hello_up = m.find("up") == true
        var theirs = int(m.find("house", 0))
        var l = ZigbeePairing.house_link()
        var mine = l != nil ? l.flag() : 0
        if l != nil && mine == 2 && theirs == 1
            l.bind(/ msg -> ZigbeePairing.tell(msg), / ok, why -> self.house_over(ok, why))
            var name = str(m.find("name", self.chosen != nil ? self.chosen["name"] : ""))
            import global
            var kind = self.chosen != nil && self.chosen.find("display") == true ? global.HouseList.ROLE_PANEL : global.HouseList.ROLE_BRIDGE
            if l.give(kind, name, str(m.find("ip", "")))
                self.asking = "house"
                self.changed()
                return
            end
        end
        self.house_result = theirs == 2 ? "already" : (theirs == 0 || mine == 0 ? "none" : "nokey")
        self.go_on()
    end

    # the house is done, or was not: the pairing goes on to the Wi-Fi's offer, and the glass says what came of it
    def house_over(ok, why)
        self.house_result = ok ? "in" : (why == "in" ? "already" : why)
        # A house with no channel yet, on a panel on no network, gets one: the channel of the node's network, which it keeps to; with the node on no
        # network too, the one this panel's mesh keeps, or, with none, the one the two were paired on. Every node takes it from the list, at its instant, this
        # panel too. A house that has one gave it to the node (say_guest)
        if ok && self.home_channel == 0 && self.chosen != nil && ZigbeePairing.house_channel() == 0
            import global
            var ch = int(self.chosen.find("channel", 0))
            if self.chosen.find("network") != true && ZigbeePairing.mesh_channel() > 0  ch = ZigbeePairing.mesh_channel() end
            var h = global.contains("house") ? global.house : nil
            if ch > 0 && h != nil  h.set_channel(ch, size(h.list.ids(false)) > 2 ? nil : 0) end
        end
        if self.asking != "house" return end
        self.asking = "hello"
        self.changed()
        self.go_on()
    end

    # The node is in the house, or was not taken: a bridge is offered the Wi-Fi, and otherwise the exchange is over
    def go_on()
        var bridge = self.chosen == nil || self.chosen.find("display") != true
        self.offer = bridge ? self.wifi_offer(self.hello_ssid, self.hello_up) : nil
        if self.offer != nil
            self.asking = "offer"
            self.changed()
        else
            self.finish()
        end
    end

    # The Wi-Fi the glass offers: the bridge's to this panel, when the bridge is on a network and this panel on none or another; this panel's
    # to the bridge, when the bridge is on none
    def wifi_offer(ssid, up)
        var own = ZigbeePairing.own_network()
        if up && ssid != "" && ssid != own return {"kind": "use", "ssid": ssid} end
        if !up && own != "" return {"kind": "give", "ssid": own} end
        return nil
    end

    # The answer to the offer. Use: the bridge is asked for its network, which the driver takes (wifi_offered). Give: this panel's goes to the bridge, and
    # the exchange is over
    def answer_offer(kind)
        if self.asking != "offer" || self.offer == nil return end
        if kind == "use"
            self.wifi = {"kind": "use", "ssid": self.offer["ssid"], "state": "asking", "reason": "",
                         "until": tasmota.millis() + ZigbeePairing.WIFI_MS}
            self.asking = "wifi"
            ZigbeePairing.tell({"ZbPair": "wifiAsk"})
        elif kind == "give"
            # the exchange ends with it, and no word of the join comes back: the glass says it does not know, and the node's address shows in the
            # house once it is on the network
            var sent = ZigbeePairing.answer(tasmota.cmd("EspNowGiveWifi"), "EspNowGiveWifi") == "sent"
            self.wifi = {"kind": "give", "ssid": self.offer["ssid"], "state": sent ? "unknown" : "failed", "reason": sent ? "" : "NotSent", "until": 0}
            self.asking = "wifi"
            ZigbeePairing.tell({"ZbPair": "done"})
            tasmota.set_timer(300, / -> tasmota.cmd("EspNowPairStop"))
        else
            self.finish()
            return
        end
        self.offer = nil
        self.changed()
    end

    # The bridge's network, as the driver took it over the link: joined only when this panel asked for it (Use), with the exchange done first, since a join
    # and a pairing do not share the radio. Anything else is dropped
    def wifi_offered(ssid)
        if self.wifi == nil || self.wifi["kind"] != "use" || self.wifi["state"] != "asking"
            tasmota.cmd("EspNowTakeWifi 0")
            return
        end
        ZigbeePairing.tell({"ZbPair": "done"})
        tasmota.cmd("EspNowPairStop")
        var r = ZigbeePairing.answer(tasmota.cmd("EspNowTakeWifi"), "EspNowTakeWifi")
        self.wifi["state"] = r == "Joining" ? "joining" : "failed"
        if r != "Joining"  self.wifi["reason"] = str(r) end
        self.changed()
    end

    # the join of the bridge's network ended (the station driver's report)
    def wifi_joined(m)
        var j = isinstance(m, map) ? m.find("StaJoin") : nil
        if !isinstance(j, map) return end
        if self.wifi == nil || self.wifi["kind"] != "use" || self.wifi["state"] != "joining" return end
        self.wifi["state"] = j.find("State") == "Connected" ? "connected" : "failed"
        self.wifi["reason"] = str(j.find("Reason", ""))
        self.changed()
    end

    # The exchange is over for this side: the node is told, its window closes, and the radio is the Wi-Fi's
    def finish()
        if self.guesting  ZigbeePairing.tell({"ZbPair": "done"}) end
        self.asking = nil
        self.offer = nil
        self.hello_at = nil
        self.result = "paired"
        tasmota.set_timer(300, / -> tasmota.cmd("EspNowPairStop"), "zb_pairing_done")
        self.changed()
    end

    # The driver ended the exchange. One that was still waiting for the node did not get through
    def guest_ended()
        if self.wguest return self.window_guest_ended() end
        self.guesting = false
        var hl = ZigbeePairing.house_link()
        if hl != nil  hl.unbind() end
        if self.asking == "hello" || self.asking == "house"
            self.asking = nil
            self.hello_at = nil
            self.house_result = "silent"
            self.result = "paired"
        end
        self.changed()
    end

    # What the node says over the link of the exchange
    def from_link(m)
        if !isinstance(m, map) return end
        if self.wguest return self.window_link(m) end
        if !self.guesting return end
        var kind = m.find("ZbPair")
        if type(kind) == "string" && size(kind) > 5 && kind[0 .. 4] == "house"
            var gl = ZigbeePairing.house_link()
            if gl != nil  gl.event(kind, m) end
        elif kind == "guest" && self.asking == "hello"
            self.guest_step(m)
        elif kind == "wifiResult" && self.wifi != nil && self.wifi["kind"] == "use" && self.wifi["state"] == "asking"
            # the bridge refused its network to Use: its window is not the button's; the glass says so at once
            if str(m.find("state", "")) == "Refused"
                self.wifi["state"] = "failed"
                self.wifi["reason"] = str(m.find("reason", "Refused"))
                self.changed()
            end
        end
    end

    def every_100ms()
        # the networks' search said nothing in time: the nodes' starts without it
        if self.prescan_until != nil && tasmota.time_reached(self.prescan_until)
            self.scan_nodes()
            self.changed()
        end
        # this panel's word again, until the node's comes: a frame of it may be lost
        if self.asking == "hello" && self.guesting && self.hello_at != nil && tasmota.time_reached(self.hello_at)  self.say_guest() end
        # this panel's own window: open once it is out of its house, and the screen back from "this one" once its time is up
        var w = self.window
        if w != nil && w["state"] == "leaving"
            if tasmota.time_reached(w["until"])
                w["state"] = "no"
                w["why"] = "leaving"
                self.changed()
            else
                self.window_try()
            end
        elif w != nil && w["state"] == "asked" && tasmota.time_reached(w["shown"])
            w["state"] = "open"
            self.changed()
        end
        # the Wi-Fi handed over and never answered: the glass says it does not know
        if self.wifi != nil && (self.wifi["state"] == "asking" || self.wifi["state"] == "joining") && tasmota.time_reached(self.wifi["until"])
            self.wifi["state"] = self.wifi["kind"] == "give" ? "unknown" : "failed"
            if self.wifi["kind"] == "use"  self.wifi["reason"] = "NoAnswer" end
            self.changed()
        end
    end

    def changed()
        if self.on_change != nil  self.on_change() end
    end

    # What Wireless settings draws of the Zigbee and of a pairing on show, read when a view is drawn:
    #   mode       off with no bridge in the house, mesh with one (zigbee_bridge.be)
    #   peer       the bridge of the house, {"mac", "ip", "name", "id"}, or nil
    #   link       it is in step on the mesh now
    #   searching, sweeping, found, asking, chosen, result, holder, offer, wifi, house, house_role
    #              the search and the pairing on show
    #   window     this panel's own window, or nil
    def state()
        var b = self.bridge
        var p = b != nil ? b.peer() : nil
        return {"mode": b != nil ? b.mode : "off", "peer": p, "link": b != nil && b.link_state(),
                "searching": self.searching, "sweeping": self.sweeping, "found": self.found,
                "asking": self.asking, "chosen": self.chosen, "result": self.result, "holder": self.holder,
                "house": self.house_result, "house_role": ZigbeePairing.house_role(),
                "offer": self.offer, "wifi": self.wifi, "window": self.window}
    end

    # --- this panel's own window: a panel of a house adds it ----------------------------------------

    # The window, for a panel of a house to find this one and add it: once this panel is out of a house (it left, or has no number), as a device with a
    # display, which the other's search says. While it is still leaving its house, as soon as it is out
    def open_window()
        if self.searching || self.asking != nil || ZigbeePairing.house_link() == nil return false end
        self.window = {"state": "leaving", "until": tasmota.millis() + ZigbeePairing.LEAVE_WAIT_MS, "why": ""}
        self.window_try()
        self.changed()
        return true
    end

    # the driver's window, once this panel holds no house's key
    def window_try()
        var w = self.window
        var l = ZigbeePairing.house_link()
        if w == nil || w["state"] != "leaving" || l == nil || l.flag() != 1 return end
        if ZigbeePairing.answer(tasmota.cmd("EspNowPairOpen " + str(ZigbeePairing.WINDOW_S) + ",0,1"), "EspNowPairOpen") == "Open"
            w["state"] = "open"
            w["until"] = tasmota.millis() + ZigbeePairing.WINDOW_S * 1000
            log("ZBPAIR: this panel's window is open, for a panel of a house to add it", 2)
        else
            w["state"] = "no"
            w["why"] = "radio"
        end
        self.changed()
    end

    # whether this panel waits at its own window for a house to take it: out of its own house on the way, open, picked or joining; it founds no house of
    # its own meanwhile (house_mesh.be, hold)
    def waits()
        var w = self.window
        return w != nil && ["leaving", "open", "asked", "joining"].find(w["state"]) != nil
    end

    # the window closed by a touch: the driver's window ends, and the exchange with it
    def close_window()
        var w = self.window
        if w == nil return end
        if w["state"] != "in" && w["state"] != "no"  tasmota.cmd("EspNowPairStop") end
        self.window = nil
        self.wguest = false
        var hl = ZigbeePairing.house_link()
        if hl != nil  hl.unbind() end
        self.changed()
    end

    # a panel of a house picked this one: the screen says it is the one, for the person there to answer Yes
    def identify()
        var w = self.window
        if w == nil || (w["state"] != "open" && w["state"] != "asked") return end
        w["state"] = "asked"
        w["shown"] = tasmota.millis() + ZigbeePairing.IDENTIFY_MS
        self.changed()
    end

    # the driver closed the window: its time was up
    def window_closed()
        var w = self.window
        if w == nil || (w["state"] != "open" && w["state"] != "asked") return end
        w["state"] = "closed"
        self.changed()
    end

    # the panel that adds this one paired with its window, as a guest
    def window_paired(mac)
        self.wguest = true
        self.window["state"] = "joining"
        var gl = ZigbeePairing.house_link()
        if gl != nil  gl.reset() end
        log("ZBPAIR: paired with " + mac + " at this panel's window, to enter its house", 2)
        self.changed()
    end

    # What the panel that adds this one says over the link of the exchange, as a bridge's window answers it (zbbridge_relay_pairing.be): its word, which
    # this panel answers with who it is, the welcome of the house, and the end
    def window_link(m)
        var kind = m.find("ZbPair")
        var gl = ZigbeePairing.house_link()
        if type(kind) == "string" && size(kind) > 5 && kind[0 .. 4] == "house"
            if gl != nil && gl.bound()  gl.event(kind, m) end
        elif kind == "guest"
            if gl != nil && !gl.bound()  gl.bind(/ msg -> ZigbeePairing.tell(msg), / ok, why -> self.window_over(ok, why)) end
            # the house's radio channel, for the time this panel is on no network: a network's own channel goes before it
            var radio = int(m.find("radio", 0))
            if radio > 0 && radio <= 13  tasmota.cmd("EspNowMeshChannel " + str(radio), true) end
            var reply = {"ZbPair": "guest", "name": tasmota.hostname(), "ip": str(tasmota.wifi().find("ip", "")),
                         "ssid": ZigbeePairing.own_network(), "up": tasmota.wifi().find("up", false) == true}
            var house = gl != nil ? gl.flag() : 0
            if house > 0  reply["house"] = house end
            ZigbeePairing.tell(reply)
        elif kind == "done"
            # the panel that added this one is done: the window ends, and the exchange with it. The driver says so too, but what it says while a rule
            # runs, as this one, Berry does not run: this side ends it itself
            tasmota.cmd("EspNowPairStop")
            self.window_guest_ended()
        end
    end

    # the welcome taken, or not
    def window_over(ok, why)
        var w = self.window
        if w == nil return end
        w["state"] = ok ? "in" : "no"
        w["why"] = ok ? "" : (why == "in" ? "already" : str(why))
        log("ZBPAIR: " + (ok ? "this panel came into the house over the link" : "this panel did not come into the house (" + str(why) + ")"), 2)
        self.changed()
    end

    # the window's exchange is over: one that had not brought this panel in did not get through
    def window_guest_ended()
        self.wguest = false
        var gl = ZigbeePairing.house_link()
        if gl != nil  gl.unbind() end
        var w = self.window
        if w != nil && w["state"] == "joining"
            w["state"] = "no"
            w["why"] = "silent"
        end
        self.changed()
    end

    # What a view asked for (panel_ui.be's ["zigbee", op, ...])
    def run(op, args)
        if op == "discover"
            self.discover()
        elif op == "blink"
            self.blink(args[0])
        elif op == "pair"
            self.pair()
        elif op == "notBlinking"
            self.not_blinking()
        elif op == "offer"
            self.answer_offer(args[0])
        elif op == "done"
            self.finish()
        elif op == "window"
            self.open_window()
        elif op == "closeWindow"
            self.close_window()
        elif op == "endPair"
            # the pairing's view closed: what it found goes with it, and a pairing half done gives the radio back
            if self.asking != nil && self.asking != "wifi"  tasmota.cmd("EspNowPairStop") end
            if self.searching && self.prescan_until == nil  tasmota.cmd("EspNowPairStop") end
            self.prescan_until = nil
            self.found = []
            self.searching = false
            self.sweeping = false
            self.asking = nil
            self.chosen = nil
            self.pending = nil
            self.result = nil
            self.offer = nil
            self.wifi = nil
        end
    end
end
