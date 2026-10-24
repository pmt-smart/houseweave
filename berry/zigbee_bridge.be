# zigbee_bridge.be -- the panel's Zigbee, which is the house's bridges: the rest of the brain sends a command with `bridge.post(cmd)`
# and hears the events with `bridge.listen(f)`, without knowing which bridge or which way.
#
# There is no bridge of the panel's own. A command about a device goes to the bridge that owns it, and the house's words (the alarm, the time,
# the names for Home Assistant, the map of a network) to THE BRIDGE OF THE HOUSE: this panel's favourite, when it is in step on the mesh, or else another
# bridge of the house in step. The boot's route (panel_route.be) picks the way (`via`), and the boot's gate (panel_gate.be) says
# whether the bridge of the house is in step (`mesh_session`): that is the room's session, whose rise every consumer waits for (on_link), as a link that
# came up was before. The events of the bridges come by the mesh (house_mesh.be's events, which the boot hands to the rules) and reach the consumers
# through the rules this sets (EVENTS).
#
# The mode says whether the house has a bridge: `mesh` with one, and `off` with none, a panel that works on its relays.


#@ solidify:ZigbeeBridge
class ZigbeeBridge : Driver
    # `off`: no bridge in the house, and a command goes nowhere. What a panel with no bridge is in: it works on its relays
    static MODE_OFF = "off"
    # `mesh`: the house has a bridge, and the panel's Zigbee is the house's
    static MODE_MESH = "mesh"
    static MODE_CMD = "ZbBridgeMode"         # the console's command that says the mode
    # how often the bridge of the house hears from this panel, to keep it among the panels its events go to (zbbridge_relay.be, LISTEN_MS)
    static LISTEN_EVERY_MS = 240000

    # What the network says besides reports: the announce and the interview (ZbState), the answers to writes (ZbResponse), what Z2T knows of each device
    # (ZbInfo) and a ping answered (ZbPing). Pairing and the short-to-IEEE map need them, and a lamp with no communication its ping's.
    # And what the drivers of the bridge say of the devices that are theirs, the bridge's time, its answer to the panel's,
    # and the alarm's
    static EVENTS = ["ZbReceived", "ZbState", "ZbResponse", "ZbInfo", "ZbPing", "ZbDriver", "ZbTime", "ZbAlarm"]

    var mode
    var on_event      # callback: def(payload_string) -- set by whoever uses the bridge
    var listeners     # more callbacks of the same shape: our pages' Zigbee (panel_zigbee.be)
    var via           # a closure line -> whether it left: the boot's route (panel_route.be); nil before the boot sets it
    var house_bridge  # a closure -> the number of the bridge of the house, or 0 (the boot's)
    var bridge_info   # a closure number -> {"mac", "name", "ip", "id"} of a bridge of the house, or nil (the boot's)
    var bridges       # a closure -> how many bridges the house has (the boot's)
    var link_listeners # who waits for the session's rise (on_link): what the network has is asked for once a command reaches it (panel_zigbee.be)
    var on_change     # f(): the mode switched, or the session came up or went down, for a view that shows it
    var last_link     # the bridge of the house reachable, as the view last saw it: a change draws it again
    var mesh_up       # the boot's gate says the bridge of the house is in step on the mesh
    var session       # the bridge reachable since the consumers were last told
    var listened_at   # when this panel last told the bridge of the house it hears it, or nil

    def init()
        self.mode = self.MODE_OFF
        self.on_event = nil
        self.listeners = []
        self.link_listeners = []
        self.last_link = false
        self.mesh_up = false
        self.session = false
        self.listened_at = nil
        self.on_change = nil
        tasmota.add_cmd(self.MODE_CMD, / cmd, idx, payload -> tasmota.resp_cmnd('{"' + ZigbeeBridge.MODE_CMD + '":"' + self.mode + '"}'))
        tasmota.add_driver(self)
        # the events of the bridges, by the mesh (panel_boot.be), reach the consumers through these rules: set once, here, in the panel's one rule
        # (panel_rules.be) where the boot made it
        import global
        var rules = global.contains("panel_rules") && global.panel_rules != nil ? global.panel_rules : tasmota
        for ev: self.EVENTS
            rules.add_rule(ev, / value, trigger, payload -> self.deliver(payload), "zbbridge_local")
        end
        # the ESP-NOW driver's own link is a pairing's alone now (zigbee_pairing.be): off, as the driver starts
        tasmota.cmd("EspNowEnable 0")
        log("ZBBRIDGE: the Zigbee is the house's bridges", 2)
    end

    # A view of the mode drawn again: one that raises must not stop the switch
    def changed()
        if self.on_change == nil return end
        try
            self.on_change()
        except .. as e, msg
            log("ZBBRIDGE: a view failed on a change - " + str(e) + ": " + str(msg), 2)
        end
    end

    # The bridge of the house, {"mac", "name", "ip", "id"}, or nil with none: what the views show of the panel's Zigbee
    def peer()
        var n = self.house_bridge != nil ? self.house_bridge() : 0
        return n > 0 && self.bridge_info != nil ? self.bridge_info(n) : nil
    end

    # the bridge of the house reached over the mesh, in step
    def link_state()
        return self.mesh_up == true
    end

    # another consumer of every event, beside `on_event`
    def listen(f)
        self.listeners.push(f)
    end

    # another consumer of the session coming up
    def on_link(f)
        self.link_listeners.push(f)
    end

    # The boot's gate on the bridge of the house over the mesh: in step, or not. In step with no session up, the session rises, the bridge is told that this
    # panel hears it (with the 1 that has it say again what this panel may have missed), and every consumer is told
    def mesh_session(up)
        self.mesh_up = up == true
        if !self.mesh_up || self.session return end
        log("ZBBRIDGE: the bridge of the house reached over the mesh", 3)
        self.listened_at = tasmota.millis()
        self.post("ZbRelayListen 1")
        self.rise()
        self.every_second()
    end

    # the session up: every consumer, once until it goes down again
    def rise()
        if self.session return end
        self.session = true
        for f: self.link_listeners
            try
                f()
            except .. as e, m
                log("ZBBRIDGE: a link listener failed - " + str(e) + ": " + str(m), 2)
            end
        end
    end

    # an event to every consumer, the one `on_event` names first; every consumer on its own: one that raises on a message it did not expect must not hide
    # that message from the others
    def deliver(payload)
        if self.on_event != nil
            try
                self.on_event(payload)
            except .. as e, m
                log("ZBBRIDGE: a consumer failed on " + str(payload) + " - " + str(e) + ": " + str(m), 2)
            end
        end
        for f: self.listeners
            try
                f(payload)
            except .. as e, m
                log("ZBBRIDGE: a listener failed on " + str(payload) + " - " + str(e) + ": " + str(m), 2)
            end
        end
    end

    # The mode, as the house says it; the session down when the bridge of the house is not in step; the bridge told again that this panel hears it; and a
    # view drawn again on a change
    def every_second()
        var mode = self.bridges != nil && self.bridges() > 0 ? self.MODE_MESH : self.MODE_OFF
        var link = self.mesh_up == true
        if !link  self.session = false end
        if link && (self.listened_at == nil || tasmota.millis() - self.listened_at >= self.LISTEN_EVERY_MS)
            self.listened_at = tasmota.millis()
            self.post("ZbRelayListen")
        end
        if mode != self.mode || link != self.last_link
            self.mode = mode
            self.last_link = link
            self.changed()
        end
    end

    # A line to the bridges, by the way the panel's lines go: the route the boot gives, which takes a device's line to its bridge and the
    # house's words to the bridge of the house. True when it left: the transport's word, and not the bridge's. With no route, nothing
    def post(cmd)
        if self.via == nil
            log("ZBBRIDGE: no route yet, command dropped: " + cmd, 3)
            return false
        end
        return self.via(cmd)
    end

    # the same, by its older name
    def send(cmd)
        return self.post(cmd)
    end
end
