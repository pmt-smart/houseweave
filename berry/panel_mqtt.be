# panel_mqtt.be -- the panel's MQTT as Wireless settings shows it and saves it:
# Tasmota's own client, with its host, port, user and password,
# and the discovery for Home Assistant's Tasmota integration. Saving restarts
# the panel, as Tasmota does for each of them: the four go in the same second,
# for one restart.
#
# Tasmota never answers the password (asterisks): whether one is set is kept in
# persist when the glass saves it. The discovery is SetOption19, 0 on, which
# Tasmota turns on at every boot (TasDiscoverInit, xdrv_12_discovery.ino): the
# choice made here is set again at the boot (at_boot).
#
# In a house the MQTT is the house's: Save writes it into the
# list, which the mesh carries to every node, bridges and panels, and each
# gives it to its own Tasmota (house_mqtt.be); this panel takes it the same way
# (apply). The bridges' discovery is the one of their Zigbee devices
# (zbbridge_discovery.be), with the hours after which Home Assistant marks
# their battery sensors unavailable, 0 for never. The password
# typed goes into the list: Tasmota keeps it and never gives it back. A panel
# with no house (no mesh in its image) saves its own.
#
# The views never call this: they return ["mqtt", op, ...] effects
# (panel_ui.be), and brain.be carries them out here.

#@ solidify:PanelMqtt
class PanelMqtt
    static PERSIST_KEY = "panel_mqtt"   # {"password": one was set from the glass, "discovery": on, "expire": hours}
    static PORT = 1883
    static EXPIRE_MAX = 999             # the hours the glass takes, three digits

    var zb          # the Zigbee transport (zigbee_bridge.be), or nil

    def init(zb)
        self.zb = zb
    end

    # the house of this panel, when it writes the list, or nil
    static def house()
        import global
        var h = global.contains("house") ? global.house : nil
        return h != nil && h.up && h.writes() ? h : nil
    end

    # A text field of a command's answer, or "" when it has none
    static def field(r, key)
        if !isinstance(r, map) return "" end
        var v = r.find(key)
        return v != nil ? str(v) : ""
    end

    def kept()
        import persist
        var k = persist.find(PanelMqtt.PERSIST_KEY, nil)
        return isinstance(k, map) ? k : {}
    end

    # the discovery as the glass chose it, set again at every boot, where
    # Tasmota turns it on
    def at_boot()
        if self.kept().find("discovery", true) == false  tasmota.cmd("SetOption19 1") end
    end

    # What the views draw:
    #   host, port, user   Tasmota's MqttHost, MqttPort and MqttUser
    #   password           one was set from the glass
    #   discovery          Home Assistant's Tasmota integration hears the panel
    #   expire             the bridge's battery sensors go unavailable after these hours with no word, 0 never
    #   connected          the client is on the broker
    # Read at every draw of a view that shows it, so read quietly: the leading _
    # keeps each answer off MQTT, and mute off the log
    def state()
        import mqtt
        var k = self.kept()
        var host = PanelMqtt.field(tasmota.cmd("_MqttHost", true), "MqttHost")
        var port = int(PanelMqtt.field(tasmota.cmd("_MqttPort", true), "MqttPort"))
        return {"host": host, "port": port > 0 ? port : PanelMqtt.PORT, "user": PanelMqtt.field(tasmota.cmd("_MqttUser", true), "MqttUser"),
                "password": k.find("password", false) == true, "discovery": k.find("discovery", true) != false,
                "expire": PanelMqtt.hours(k.find("expire", 0)), "connected": host != "" && mqtt.connected() == true}
    end

    # hours as the glass takes them: a whole number, 0 to EXPIRE_MAX
    static def hours(v)
        var h = int(v)
        if h < 0 return 0 end
        return h > PanelMqtt.EXPIRE_MAX ? PanelMqtt.EXPIRE_MAX : h
    end

    # What a view asked for (panel_ui.be's ["mqtt", op, ...])
    def run(op, args)
        if op == "save"  self.save(args[0]) end
    end

    # Save: in a house, the house's setting, which every node takes (house_mqtt.be), this panel too. The password typed goes with it;
    # none typed keeps the house's for the same host, and another host with none typed has none: it belongs to its broker
    def save(s)
        var h = PanelMqtt.house()
        if h != nil
            var was = h.mqtt_setting()
            var host = str(s.find("host", ""))
            var m = {"host": host, "port": int(s.find("port", PanelMqtt.PORT)), "user": str(s.find("user", "")), "password": "",
                     "discovery": s.find("discovery", true) != false, "expire": PanelMqtt.hours(s.find("expire", 0))}
            if s.contains("password")
                m["password"] = str(s["password"])
            elif was != nil && was["host"] == host
                # the house's, as it has it: its password, or its word that each node keeps its own
                m["password"] = was["password"]
                if was.find("keep") == true  m["keep"] = true end
            elif was == nil && host != "" && host == PanelMqtt.field(tasmota.cmd("MqttHost"), "MqttHost")
                # the house's first setting, on the broker this panel is on, with no password typed: Tasmota never says the one it has, and each node
                # keeps its own
                m["keep"] = true
            end
            if h.set_mqtt(m)
                log("MQTT: saved as the house's, on " + host + ": every node takes it", 2)
                return
            end
        end
        self.save_here(s)
    end

    # The house's setting, as this panel takes it (HouseMqtt): as a Save of its own, with the password the house has, or, when the house keeps none, as one
    # with no password typed: the one this panel has stays, on the same broker
    def apply(m)
        var s = {"host": m["host"], "port": m["port"], "user": m["user"], "discovery": m["discovery"], "expire": m["expire"]}
        if m.find("keep") != true  s["password"] = m["password"] end
        self.save_here(s)
    end

    # This panel's settings, each alone: a Backlog would cut a password at a ";". Tasmota restarts once, a moment after the last. A password is set only
    # when one is given; it belongs to its broker, and another host with none given clears it
    def save_here(s)
        import persist
        var k = self.kept()
        var host = str(s.find("host", ""))
        var cleared = !s.contains("password") && host != PanelMqtt.field(tasmota.cmd("MqttHost"), "MqttHost")
        k["discovery"] = s.find("discovery", true) != false
        k["expire"] = PanelMqtt.hours(s.find("expire", 0))
        if s.contains("password")  k["password"] = str(s["password"]) != "" end
        if cleared  k["password"] = false end
        persist.setmember(PanelMqtt.PERSIST_KEY, k)
        # now, and not after a wait for heap: Tasmota restarts a moment after the commands below
        PanelStore.safe_save(PanelStore.SAVE_TRIES)
        tasmota.cmd("SetOption19 " + (k["discovery"] ? "0" : "1"))
        tasmota.cmd("MqttHost " + PanelMqtt.text(host))
        tasmota.cmd("MqttPort " + str(int(s.find("port", PanelMqtt.PORT))))
        tasmota.cmd("MqttUser " + PanelMqtt.text(s.find("user", "")))
        if s.contains("password")  tasmota.cmd("MqttPassword2 " + PanelMqtt.text(s["password"])) end
        if cleared  tasmota.cmd("MqttPassword2 " + PanelMqtt.text("")) end
        log("MQTT: saved, on " + host + ": Tasmota restarts", 2)
    end

    # a text for Tasmota's command, where "" is a quote, which clears the setting
    static def text(v)
        var s = str(v)
        return s == "" ? "\"" : s
    end

end
