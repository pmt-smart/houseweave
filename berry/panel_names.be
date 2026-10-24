# panel_names.be -- the names of the Zigbee devices, told to the bridge for
# Home Assistant: the bridge announces every device of its
# network there, and the names live here, on the glass. Home Assistant gets
# "Desk light", and not an address.
#
# What goes is what changed since the bridge last heard: each save of the
# configuration looks, and a link that comes up sends it all again, since the
# bridge may be new, or restarted with its own saved. One name at a time, a
# moment apart, as the link carries a line at a time (ZbRelayName, one of the
# bridge's closed list, zbbridge_relay.be); a device gone goes with no name,
# for the bridge to forget it.

#@ solidify:PanelNames
class PanelNames
    static GAP_MS = 150   # between two names on the link

    var store       # the configuration (panel_store.be)
    var send        # f(command): the transport's send
    var told        # IEEE -> the name the bridge last heard, as far as this panel knows
    var queue       # [IEEE, name] waiting for the link
    var sending     # the next one is on its way

    def init(store, send)
        self.store = store
        self.send = send
        self.told = {}
        self.queue = []
        self.sending = false
    end

    # the link came up: the bridge hears every name again
    def linked()
        self.told = {}
        self.changed()
    end

    # a save of the configuration: what differs goes
    def changed()
        var now = self.names()
        self.queue = []
        for ieee: now.keys()
            if self.told.find(ieee) != now[ieee]  self.queue.push([ieee, now[ieee]]) end
        end
        for ieee: self.told.keys()
            if !now.contains(ieee)  self.queue.push([ieee, ""]) end
        end
        if size(self.queue) > 0 && !self.sending
            self.sending = true
            tasmota.set_timer(0, / -> self.next())
        end
    end

    # the Zigbee devices of the configuration, by IEEE: the panel's relays are not
    def names()
        var out = {}
        for d: self.store.doc["devices"]
            if !PanelStore.is_relay_id(d[0])  out[str(d[0])] = str(d[1]) end
        end
        return out
    end

    # One name, and the next a moment later. With the link down it waits for
    # the next one, which sends them all again
    def next()
        import json
        self.sending = false
        if size(self.queue) == 0 || !PanelNames.bridge_up() return end
        var n = self.queue[0]
        self.queue.remove(0)
        self.send("ZbRelayName " + json.dump({"IEEE": n[0], "Name": n[1]}))
        if n[1] != ""  self.told[n[0]] = n[1] elif self.told.contains(n[0])  self.told.remove(n[0]) end
        if size(self.queue) > 0
            self.sending = true
            tasmota.set_timer(PanelNames.GAP_MS, / -> self.next())
        end
    end

    # the bridge of the house, in step on the mesh
    static def bridge_up()
        import global
        var b = global.contains("zb_bridge") ? global.zb_bridge : nil
        if b == nil || b.peer() == nil return false end
        return b.link_state() == true
    end
end
