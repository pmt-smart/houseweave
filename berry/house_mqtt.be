# house_mqtt.be -- the house's MQTT, one setting for every node: the broker Home Assistant listens on, its port, the user and the password, whether
# the nodes announce themselves to Home Assistant (the discovery), and the hours after which Home Assistant marks a battery sensor unavailable. A panel that writes the
# list writes it, once, as a field of the list (HouseList.K_MQTT, the house's number 0), and the mesh carries it to every node, bridges and panels, in frames to one node
# that the mesh seals with the key of the two; each node gives it to its own Tasmota, which restarts on it. Home Assistant then talks to each node over MQTT on the
# house's network, as before: it does not go through the mesh.
#
# What this does is the node's side: the field of the list against what this node applied last (the persist key KEY, the field's bytes as hex), and, when they
# differ, the setting handed to the node's own way of taking it (`apply`: the panel's PanelMqtt.apply, the bridge's ZbBridgeRelay.apply_mqtt). The key is written
# before the setting is applied: Tasmota restarts a moment after, and the node does not apply it again at the next boot.
#
# The password is in the list, and so in the flash of every node of the house, as Tasmota keeps it in each anyway (the risk that was taken).

#@ solidify:HouseMqtt
class HouseMqtt
    static KEY = "house_mqtt"
    static WAIT_MS = 500

    var host      # the HouseMesh
    var apply     # f(m) -> nothing: the setting, as a map {"host", "port", "user", "password", "discovery", "expire"}, given to this node's Tasmota

    def init(host, apply)
        self.host = host
        self.apply = apply
    end

    # the list changed, or the node came up: looked at a moment later, once, with whatever else changed meanwhile
    def later()
        tasmota.set_timer(HouseMqtt.WAIT_MS, / -> self.check(), "house_mqtt")
    end

    # The list's setting against the one applied: applied when it is another. True when it was
    def check()
        import persist
        var h = self.host
        if h == nil || !h.up || self.apply == nil return false end
        var f = h.list.field(HouseList.K_MQTT, 0)
        if f == nil return false end
        var hex = f[2].tohex()
        if persist.find(HouseMqtt.KEY, nil) == hex return false end
        var m = HouseList.mqtt_of(f[2])
        if m == nil return false end
        persist.setmember(HouseMqtt.KEY, hex)
        try
            persist.save()
        except .. as e, msg
            log("HOUSE: the house's MQTT applied was not saved (" + str(e) + ": " + str(msg) + ")", 1)
        end
        log("HOUSE: the house's MQTT, on " + (m["host"] != "" ? m["host"] : "no broker") + ", taken by this node", 2)
        self.apply(m)
        return true
    end
end
