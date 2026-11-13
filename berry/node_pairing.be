# node_pairing.be -- how a node with no screen enters the house: what the ESP-NOW driver reports of its window, and what the panel that adds it says
# over the link of the pairing. On a bridge and on an appliance alike, beside NodeHost (node_host.be), whose window it serves.
#
# Every pairing is entering the house: there is no pair of a panel and a node, and nothing of one is kept on either side. The node opens the window
# when the button is held 5 s, or at a boot with no network saved (NodeHost.open_window), and the ESP-NOW driver (xdrv_98_espnow_direct.ino) announces the
# node, answers the panel that asks, and runs the key exchange as a guest's: neither side writes a record, and the link of the exchange lives in RAM for
# as long as the exchange lasts. What this side does is hear what the driver reports and answer what the panel says over that link:
#   panel -> node {"ZbPair":"guest","house":<1 or 2>,"zigbee":<channel>,"radio":<channel>}: the panel's word, whether it is in a house, the Zigbee channel it
#                   chose for the room, which is a bridge's to take (the node's guest_said), and the Wi-Fi channel of the panel's network, where the
#                   house's mesh is: this node's radio goes there while it is on no network (EspNowMeshChannel)
#   node -> panel {"ZbPair":"guest","name","ip","house","ssid","up"}: who this node is, whether it can take a welcome (1) or is in a house (2), and its network
#   either way, `houseAsk`, `houseId`, `housePiece`, `houseAck`, `houseDone` and `houseNo` (house_link.be): the panel of the house gives this node the
#                   welcome, and this node is in the house
#   panel -> node {"ZbPair":"wifiAsk"}: this node's network, given by the driver, only in a window the button opened
#   the panel's network, offered by its driver (EspNowGiveWifi): joined, and how it went in the log
#   panel -> node {"ZbPair":"done"}: the window closes, and the link of the exchange with it
#
# The house is the only bond: the commands and the events go over the mesh, and the factory reset and the web password are words of any panel of the
# house over it (NodeHost.admin).
#
# Compiled into the firmware: one class, nothing at the top, every module imported where it is used. It never names the node's class: the node is
# handed to it (init), and it comes after NodeHost, which it names.

#@ solidify:NodePairing
class NodePairing : Driver
    var node         # the node this pairing serves: a bridge's relay, an appliance
    var joining      # the panel's network is being joined, by name, for the log
    var guesting     # the driver paired this node with a panel, and the link of the exchange is up until it says it ended

    def init(node)
        self.node = node
        self.joining = nil
        self.guesting = false
        var id = node.ID + "_pair"
        tasmota.add_rule("EspNowPair#Blink", / -> NodeHost.identify(node), id)
        tasmota.add_rule("EspNowPair#Paired", / v, t, m -> self.paired(str(v), m), id)
        tasmota.add_rule("EspNowPair#Guest", / v -> v == "Ended" ? self.guest_ended() : nil, id)
        tasmota.add_rule("EspNowPair#Window", / -> NodeHost.close_window(node, true), id)
        tasmota.add_rule("EspNowPair#Failed", / v -> log(node.TAG + ": a pairing failed, " + str(v), 2), id)
        tasmota.add_rule("ZbPair", / v, t, m -> self.from_link(m), id)
        tasmota.add_rule("EspNowDirect#WifiOffered", / v -> self.wifi_offered(str(v)), id)
        tasmota.add_rule("StaJoin#State", / v, t, m -> self.joined(m), id)
        tasmota.add_driver(self)
    end

    # the link of the house layer on this node (house_link.be), or nil where the image has none
    def house_link()
        var h = self.node.house
        return h != nil ? h.link : nil
    end

    # an event to the panel, over the link of the exchange
    static def tell(msg)
        import global
        import json
        return global.contains("espnow_send") && global.espnow_send(json.dump(msg), true) == true
    end

    # The driver paired this node with a panel. A guest's, as every panel asks for; a panel of an older image, which asks for a pairing of record,
    # leaves a record in the driver that nothing here keeps: it is dropped, and the exchange goes on as a guest's
    def paired(mac, m)
        var said = isinstance(m, map) ? m.find("EspNowPair") : nil
        if !isinstance(said, map) || said.find("Guest") != 1
            tasmota.cmd("EspNowPeerMac 00:00:00:00:00:00")
            tasmota.cmd("EspNowSecret2 0")
            log(self.node.TAG + ": a pairing of record from the NSPanel " + mac + ", which this node keeps none of: dropped", 2)
        end
        self.guesting = true
        var gl = self.house_link()
        if gl != nil  gl.reset() end
        log(self.node.TAG + ": paired with the NSPanel " + mac + ", to enter the house", 2)
    end

    # The driver ended the exchange: the link is gone
    def guest_ended()
        self.guesting = false
        var gl = self.house_link()
        if gl != nil  gl.reset() end
        log(self.node.TAG + ": the exchange with the NSPanel is over", 2)
    end

    # What the panel says over the link of the exchange
    def from_link(m)
        if !isinstance(m, map) || !self.guesting return end
        var kind = m.find("ZbPair")
        var gl = self.house_link()
        if type(kind) == "string" && size(kind) > 5 && kind[0 .. 4] == "house"
            if gl != nil && gl.bound()  gl.event(kind, m) end
        elif kind == "guest"
            if gl != nil && !gl.bound()  gl.bind(/ msg -> NodePairing.tell(msg), / ok, why -> self.house_over(ok, why)) end
            # what is the node's own in the panel's word: a bridge's Zigbee channel
            self.node.guest_said(m)
            # the house's radio channel, for the time this node is on no network: a network's own channel goes before it
            var radio = int(m.find("radio", 0))
            if radio > 0 && radio <= 13  tasmota.cmd("EspNowMeshChannel " + str(radio), true) end
            var names = tasmota.cmd("SSId1")
            var reply = {"ZbPair": "guest", "name": tasmota.hostname(), "ip": str(tasmota.wifi().find("ip", "")),
                         "ssid": isinstance(names, map) ? str(names.find("SSId1", "")) : "", "up": tasmota.wifi().find("up", false) == true}
            var house = gl != nil ? gl.flag() : 0
            if house > 0  reply["house"] = house end
            NodePairing.tell(reply)
        elif kind == "wifiAsk"
            # its network goes to the panel only in a window the button opened: being plugged in opens one too,
            # and a node with no network has none to give anyway
            if NodeHost.window_open(self.node) && self.node.by_button
                tasmota.cmd("EspNowGiveWifi")
            else
                NodePairing.tell({"ZbPair": "wifiResult", "state": "Refused", "reason": "Button"})
            end
        elif kind == "done"
            # the panel is done: the window closes, which ends the exchange. The driver says it ended too, but what it reports while a rule runs, as this
            # one, is not run by Berry: this side knows it ended, and says so to itself
            NodeHost.close_window(self.node)
            tasmota.cmd("EspNowPairStop")
            self.guest_ended()
        end
    end

    def house_over(ok, why)
        log(self.node.TAG + ": " + (ok ? "this node came into the house over the link" : "this node did not come into the house (" + why + ")"), 2)
    end

    # The panel's network, offered over the link: the window gives the radio back, and the station driver joins it, which saves it only once it works
    def wifi_offered(ssid)
        NodeHost.close_window(self.node)
        var r = tasmota.cmd("EspNowTakeWifi")
        var state = isinstance(r, map) ? r.find("EspNowTakeWifi") : nil
        if state == "Joining"
            self.joining = ssid
            log(self.node.TAG + ": joining the NSPanel's network " + ssid, 2)
        elif state == "Busy"
            # the radio is not free yet: once more in a moment
            tasmota.set_timer(1000, / -> self.retry_join(ssid), self.node.ID + "_join")
        else
            log(self.node.TAG + ": the NSPanel's network " + ssid + " not joined: " + str(state), 2)
        end
    end

    def retry_join(ssid)
        var r = tasmota.cmd("EspNowTakeWifi")
        var state = isinstance(r, map) ? r.find("EspNowTakeWifi") : nil
        if state == "Joining"
            self.joining = ssid
        else
            log(self.node.TAG + ": the NSPanel's network " + ssid + " not joined: " + str(state), 2)
        end
    end

    def joined(m)
        if self.joining == nil return end
        var j = isinstance(m, map) ? m.find("StaJoin") : nil
        if !isinstance(j, map) return end
        log(self.node.TAG + ": the NSPanel's network " + self.joining + ": " + str(j.find("State", "")) + " " + str(j.find("Reason", "")), 2)
        self.joining = nil
    end
end
