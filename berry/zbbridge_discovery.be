# zbbridge_discovery.be -- every device of the bridge's Zigbee network in Home
# Assistant, by its MQTT discovery: Tasmota's own coordinator
# (Z2T) has none, and Home Assistant's Tasmota integration does not make its
# devices.
#
# Each device is what Z2T knows of it, its "Config" and what it decoded: a
# light, with the level, the white and the colour its type has; an on/off
# device on the mains, a switch; the sensors Z2T decodes (temperature,
# humidity, pressure, battery) and its alarms (occupancy, door, water, smoke,
# CO); a cover; and a button's or a remote's actions, as triggers. One
# announcement a part, retained, at
#   homeassistant/<component>/<IEEE>/<part>/config
# with the device's topics under zigbee/<IEEE>:
#   state          all Z2T knows of it, retained, at every report
#   set            Home Assistant's commands, in JSON, which go out as ZbSend
#   availability   online while Z2T reaches it
#   action         a button's or a remote's action, as it happens
# and the bridge's own LWT beside the availability: a bridge gone takes its
# devices with it.
#
# The names are the panel's (panel_names.be, over ZbRelayName), kept here for
# the boots with no panel; a device without one goes by its model and address.
# The house's Discovery turns this off (house_mqtt.be), and the announcements go
# with it, and Home Assistant's commands are no longer obeyed. What the bridge
# relays to the panel is untouched: this listens to Z2T on its own.
#
# A device that sleeps on a battery is never asked anything by Z2T, and one
# that died would stay in Home Assistant with its last value. The panel's
# glass sets the hours after which its sensors go unavailable with no word of
# it, Home Assistant's expire_after, and 0 keeps the last value.
# Any report of the device renews them all:
# its state goes in one topic.
#
# A device that leaves Z2T's list goes from Home Assistant too:
# removed on the panel's glass, which sends
# ZbLeave and ZbForget, or forgotten on the console. One with no power, or out
# of reach, stays in the list and is unavailable, and Z2T ignores a device's
# own word that it leaves, so such a device stays unavailable until it is
# removed. The bridge keeps the list of what it announced in its flash, and
# looks at the list at every connection, every minute, and a moment after a
# ZbForget from the panel. It clears only an announcement it made, by the
# origin each carries: another bridge may announce the same device now, which
# moved rooms.
#
# A switch a driver opens and closes is a cover, and what its driver says of it
# (a gate of two keys has no stop) is in the announcement: the host
# (zbbridge_drivers.be) tells refresh() when it describes the device again, or
# gives it back, and the device is announced again when that changed what the
# driver puts in its announcement, a part that is no longer there cleared.
#
# The heap: a device's announcement is built when its turn comes, a moment
# after the one before, and only the names and what was announced stay.

#@ solidify:ZbBridgeDiscovery
class ZbBridgeDiscovery
    static PREFIX = "homeassistant"
    static BASE = "zigbee"
    static NAMES_KEY = "zb_relay_names"     # IEEE -> the name the panel gave it
    static ON_KEY = "zb_relay_discovery"    # false: the panel turned it off
    static EVER_KEY = "zb_relay_announced"  # the IEEEs this bridge announced, until cleared
    static EXPIRE_KEY = "zb_relay_expire"   # hours a battery device's sensors wait for word, 0 never
    static CLEAR_MS = 3000    # how long a device's retained announcements are waited for, to clear them
    static GAP_MS = 100       # between two devices' announcements
    static SAVE_MS = 5000     # the names and the list saved once they stop changing
    static SWEEP_S = 60       # how often Z2T's reach is looked at
    static HOLD_MS = 5000     # Home Assistant's commands are not obeyed this long after the connection: the retained ones come then
    # what Z2T decodes, as Home Assistant's entities: [attribute, component, part, class, unit]
    static SENSORS = [
        ["Temperature", "sensor", "temperature", "temperature", "°C"],
        ["Humidity", "sensor", "humidity", "humidity", "%"],
        ["Pressure", "sensor", "pressure", "pressure", "hPa"],
        ["BatteryPercentage", "sensor", "battery", "battery", "%"],
        ["Occupancy", "binary_sensor", "occupancy", "occupancy", nil],
        ["Contact", "binary_sensor", "contact", "door", nil],
        ["Water", "binary_sensor", "water", "moisture", nil],
        ["Fire", "binary_sensor", "smoke", "smoke", nil],
        ["CO", "binary_sensor", "co", "carbon_monoxide", nil],
    ]
    # what a report says that ZbInfo does not keep, kept here from the reports: a cover's position
    static KEEP = ["CurrentPositionLiftPercentage"]
    # what a report carries that is no button's action
    static NOT_ACTIONS = ["Device", "Name", "Endpoint", "LinkQuality", "Group", "Reachable", "ModelId", "Manufacturer",
                          "ZoneStatus", "ZoneType", "BatteryVoltage", "Tamper", "BatteryLow", "LastSeen", "LastSeenEpoch",
                          "Illuminance", "CurrentPositionLiftPercentage"]

    var names       # IEEE -> name, as the panel said them
    var announced   # IEEE -> the parts announced, on this connection
    var shaped      # IEEE -> what its driver put in that announcement (shape()), on this connection
    var triggers    # IEEE -> the actions announced, on this connection
    var reach       # IEEE -> the availability last said
    var extra       # IEEE -> what its reports said that ZbInfo does not keep (KEEP)
    var todo        # the IEEEs waiting for their announcement
    var sending     # the next announcement is on its way
    var up          # MQTT was connected at the last second
    var subscribed  # the commands' topic was subscribed to
    var since       # the millis until which Home Assistant's commands are not obeyed, from the connection, or nil
    var sweep       # seconds to the next look at Z2T's reach
    var lwt         # the bridge's LWT topic, as Tasmota has it
    var origin      # the announcements' origin, this bridge's Topic, which marks them its own
    var ever        # the IEEEs this bridge announced, kept in its flash (EVER_KEY)
    var gone        # the IEEEs whose announcements wait to be cleared, one at a time
    var clearing    # the IEEE being cleared, or nil

    def init()
        import persist
        var n = persist.find(ZbBridgeDiscovery.NAMES_KEY, nil)
        self.names = isinstance(n, map) ? n : {}
        var e = persist.find(ZbBridgeDiscovery.EVER_KEY, nil)
        self.ever = isinstance(e, list) ? e : []
        self.gone = []
        self.announced = {}
        self.shaped = {}
        self.triggers = {}
        self.reach = {}
        self.extra = {}
        self.todo = []
        self.sending = false
        self.up = false
        self.subscribed = false
        self.sweep = ZbBridgeDiscovery.SWEEP_S
        tasmota.add_driver(self)
        tasmota.add_rule("ZbReceived", / value, trigger, payload -> self.received(payload), "zbbridge_discovery")
        # the bridge's own Tasmota discovery follows, set again at every boot, where Tasmota turns it on
        if !self.on()  tasmota.cmd("SetOption19 1") end
    end

    def on()
        import persist
        return persist.find(ZbBridgeDiscovery.ON_KEY, true) != false
    end

    def every_second()
        import mqtt
        var up = mqtt.connected() == true
        if up && !self.up  self.connected() end
        self.up = up
        if !up || !self.on() return end
        self.sweep -= 1
        if self.sweep <= 0
            self.sweep = ZbBridgeDiscovery.SWEEP_S
            self.look_reach()
            self.check_left()
        end
    end

    # On the broker: the commands' topic, and every device announced again, as
    # the broker may be a new one
    def connected()
        import mqtt
        self.announced = {}
        self.shaped = {}
        self.triggers = {}
        self.reach = {}
        self.lwt = ZbBridgeDiscovery.lwt_topic()
        self.origin = ZbBridgeDiscovery.topic()
        self.since = tasmota.millis(ZbBridgeDiscovery.HOLD_MS)
        if !self.subscribed
            # once: Tasmota subscribes again at every connection by itself
            self.subscribed = true
            mqtt.subscribe(ZbBridgeDiscovery.BASE + "/+/set", / topic, idx, payload_s, payload_b -> self.command(topic, payload_s))
        end
        # a clearing the connection's end cut short, taken up again
        self.clearing = nil
        if self.on()
            self.announce_all()
            self.check_left()
        else
            # off: what the list in the flash still has goes, at every connection
            # until it is empty. The Save on the glass that turns this off restarts
            # the bridge on its way, in the middle of the clearing
            for ieee: self.ever  self.forget_device(ieee) end
        end
        self.next_gone()
    end

    # the hours a battery device's sensors wait for word, as the panel set them; 0 never
    def expire()
        import persist
        var h = int(persist.find(ZbBridgeDiscovery.EXPIRE_KEY, 0))
        return h > 0 ? h : 0
    end

    # The house's battery timeout (house_mqtt.be): kept, and every device announced
    # again with it, or without it at 0
    def set_expire(hours)
        import persist
        var h = int(hours)
        if h < 0  h = 0 end
        if h == self.expire() return end
        persist.setmember(ZbBridgeDiscovery.EXPIRE_KEY, h)
        PairSign.safe_save("ZBBRIDGE_DISCOVERY")
        log("ZBBRIDGE_DISCOVERY: battery sensors " + (h > 0 ? "unavailable after " + str(h) + " h with no word" : "keep their last value"), 2)
        if self.up && self.on()  self.announce_all() end
    end

    # the house's Discovery (house_mqtt.be): off, and what was announced goes
    def set_on(on)
        import persist
        if on == self.on() return end
        persist.setmember(ZbBridgeDiscovery.ON_KEY, on)
        PairSign.safe_save("ZBBRIDGE_DISCOVERY")
        tasmota.cmd("SetOption19 " + (on ? "0" : "1"))
        log("ZBBRIDGE_DISCOVERY: " + (on ? "on" : "off, the announcements cleared"), 2)
        if on
            if self.up  self.announce_all() end
        else
            self.todo = []
            for ieee: self.ever  self.forget_device(ieee) end
        end
    end

    # --- the devices -----------------------------------------------------------------------------

    static def coordinator()
        import global
        var z = global.contains("zigbee") ? global.zigbee : nil
        return z != nil && z.started() == true ? z : nil
    end

    # the IEEE of a device of Z2T's, "0x00124B0000E00001", from its long address, little-endian
    static def ieee(d)
        import string
        var b = d.longaddr
        var s = "0x"
        var i = size(b) - 1
        while i >= 0
            s += string.format("%02X", b[i])
            i -= 1
        end
        return s
    end

    # what Z2T knows of a device, as a map (its info(), a zcl_attribute_list on
    # the device), an alarm's state under the name a report gives it: ZbInfo
    # keeps it as its zone's type and status
    static def about(d)
        import json
        var i = d.info()
        if i != nil && !isinstance(i, map)  i = json.load(str(i)) end
        if !isinstance(i, map) return {} end
        var zt = i.find("ZoneType")
        var zs = i.find("ZoneStatus")
        if zt != nil && zs != nil
            var n = ZbBridgeDiscovery.zone_name(int(zt))
            if n != nil && !i.contains(n)  i[n] = int(zs) & 1 end
        end
        return i
    end

    # an IAS zone's type, as Z2T names its alarm (xdrv_23_zigbee_2_devices.ino)
    static def zone_name(t)
        if t == 0x0015 return "Contact" end
        if t == 0x002A return "Water" end
        if t == 0x0028 return "Fire" end
        if t == 0x002B return "CO" end
        if t == 0x000D return "Occupancy" end
        return nil
    end

    # a device on the mains, which routes: a switch, where one on batteries is a button
    static def router(d)
        var r = d.router
        return r == true
    end

    def announce_all()
        var z = ZbBridgeDiscovery.coordinator()
        if z == nil return end
        for d: z
            var ieee = ZbBridgeDiscovery.ieee(d)
            if self.todo.find(ieee) == nil  self.todo.push(ieee) end
        end
        self.next_later(0)
    end

    def next_later(ms)
        if self.sending || size(self.todo) == 0 return end
        self.sending = true
        tasmota.set_timer(ms, / -> self.next())
    end

    # the next device's announcement, and the one after a moment later
    def next()
        import mqtt
        self.sending = false
        if size(self.todo) == 0 || mqtt.connected() != true || !self.on() return end
        var ieee = self.todo[0]
        self.todo.remove(0)
        var z = ZbBridgeDiscovery.coordinator()
        var d = z != nil ? z.find(ieee) : nil
        if d != nil  self.announce(ieee, d) end
        self.next_later(ZbBridgeDiscovery.GAP_MS)
    end

    # The host (zbbridge_drivers.be) describes a device again to the panel, or gives it back: when what its driver puts in the announcement (a
    # gate's stop, its cover) is not what was announced on this connection, the device is announced again, in its turn. A device not announced yet
    # takes the driver as it is then
    def refresh(ieee)
        if !self.up || !self.on() || !self.announced.contains(ieee) return end
        if self.shaped.find(ieee, "") == ZbBridgeDiscovery.shape(ieee) return end
        if self.todo.find(ieee) == nil  self.todo.push(ieee) end
        self.next_later(0)
    end

    # what Z2T knows of a device, and what its reports said that ZbInfo does not keep
    def known(ieee, d)
        var i = ZbBridgeDiscovery.about(d)
        var e = self.extra.find(ieee)
        if e != nil
            for k: e.keys()
                if !i.contains(k)  i[k] = e[k] end
            end
        end
        return i
    end

    # The driver that opens and closes a switch of two channels, which the panel assigned it, or nil: Home
    # Assistant sees a cover, and its commands go to the driver, as the switch's channels on their own would pass its
    # interlock by
    static def driven(ieee)
        import global
        var r = global.contains("zbbridge_relay") ? global.zbbridge_relay : nil
        var d = r != nil && r.drivers != nil ? r.drivers.claimed.find(ieee) : nil
        return d != nil && d.ID == "twokey" ? d : nil
    end

    # whether the driver of a switch it opens and closes says the device has a stop: a gate of two keys does not ("stop": false)
    static def has_stop(dr, ieee)
        import global
        return dr.describe(global.zbbridge_relay.drivers.info_for(ieee)).find("stop") != false
    end

    # What the driver puts in a device's announcement, as a short text: "" for a device no driver of that kind has, and for a driven switch the cover
    # with or without its stop. The announcement stays as it is while this does
    static def shape(ieee)
        var dr = ZbBridgeDiscovery.driven(ieee)
        if dr == nil return "" end
        return ZbBridgeDiscovery.has_stop(dr, ieee) ? "cover+stop" : "cover"
    end

    # a device's parts: a driven switch's, the cover; any other's by what Z2T knows of it. A gate of two keys has no stop, and its driver
    # says so in its description ("stop": false): Home Assistant is offered none (a null payload_stop), where it would offer a stop that
    # the driver refuses
    static def parts_for(ieee, info, router)
        import json
        var dr = ZbBridgeDiscovery.driven(ieee)
        if dr == nil return ZbBridgeDiscovery.parts_of(info, router) end
        var stop = ZbBridgeDiscovery.has_stop(dr, ieee) ? json.dump({"cover": "STOP"}) : nil
        return [["cover", "cover", {"name": nil, "cmd_t": "~/set", "pl_open": json.dump({"cover": "OPEN"}), "pl_cls": json.dump({"cover": "CLOSE"}),
                                   "pl_stop": stop, "set_pos_t": "~/set", "set_pos_tpl": '{"position": {{ position }}}',
                                   "optimistic": true}]]
    end

    # One device: each of its parts, then its state and its availability
    def announce(ieee, d)
        import json
        import mqtt
        import string
        var info = self.known(ieee, d)
        var router = ZbBridgeDiscovery.router(d)
        var parts = ZbBridgeDiscovery.parts_for(ieee, info, router)
        var dev = self.device(ieee, d, info)
        var was = self.announced.find(ieee)
        # a device that sleeps on a battery: its sensors go unavailable after the panel's hours with no word
        var ttl = router ? 0 : self.expire() * 3600
        var done = []
        for p: parts
            var c = p[2]
            c["~"] = ZbBridgeDiscovery.BASE + "/" + ieee
            c["uniq_id"] = ieee + "_" + p[1]
            c["avty"] = self.availability()
            c["avty_mode"] = "all"
            if ttl > 0 && (p[0] == "sensor" || p[0] == "binary_sensor")  c["exp_aft"] = ttl end
            c["dev"] = dev
            if self.origin != nil  c["o"] = {"name": self.origin} end
            mqtt.publish(ZbBridgeDiscovery.config_topic(p[0], ieee, p[1]), json.dump(c), true)
            done.push(p[0] + "/" + p[1])
        end
        self.announced[ieee] = done
        self.shaped[ieee] = ZbBridgeDiscovery.shape(ieee)
        # a part this connection announced that the device no longer has (a switch of two channels that a driver made a cover of, or that was given
        # back) is cleared, with an empty retained message, or Home Assistant would keep an entity nothing answers for
        if was != nil
            for old: was
                if done.find(old) == nil
                    var at = string.find(old, "/")
                    mqtt.publish(ZbBridgeDiscovery.config_topic(old[0 .. at - 1], ieee, old[at + 1 ..]), "", true)
                end
            end
        end
        # A restart forgets what this connection announced, and the broker keeps what was retained before it: the parts a driver's taking changes
        # (the switch's channels the driver replaced with a cover, the cover it gave back to the switch) are cleared by their topics when the device
        # is announced for the first time on a connection. A device with no switch and no driver has nothing to clear
        if was == nil
            var gone = []
            if ZbBridgeDiscovery.driven(ieee) != nil
                gone = ZbBridgeDiscovery.parts_of(info, router)
            else
                for p: parts
                    if p[0] == "switch"  gone = [["cover", "cover"]] end
                end
            end
            for p: gone
                if done.find(p[0] + "/" + p[1]) == nil
                    mqtt.publish(ZbBridgeDiscovery.config_topic(p[0], ieee, p[1]), "", true)
                end
            end
        end
        if self.ever.find(ieee) == nil
            self.ever.push(ieee)
            self.save_later()
        end
        self.publish_state(ieee, info)
        self.say_reach(ieee, info.find("Reachable", true) != false)
    end

    static def config_topic(component, ieee, part)
        return ZbBridgeDiscovery.PREFIX + "/" + component + "/" + ieee + "/" + part + "/config"
    end

    # the device's own availability, and the bridge's LWT: both must be up
    def availability()
        var a = [{"t": "~/availability"}]
        if self.lwt != nil  a.push({"t": self.lwt, "pl_avail": "Online", "pl_not_avail": "Offline"}) end
        return a
    end

    # the device in Home Assistant: its name, the panel's, or its model and address
    def device(ieee, d, info)
        var name = self.names.find(ieee)
        var model = str(info.find("ModelId", d.model != nil ? d.model : ""))
        if name == nil || name == ""
            name = (model != "" ? model + " " : "Zigbee ") + ieee[-4 ..]
        end
        var dev = {"ids": ["zigbee_" + ieee], "name": name}
        var mf = info.find("Manufacturer", d.manufacturer)
        if mf != nil && mf != ""  dev["mf"] = str(mf) end
        if model != ""  dev["mdl"] = model end
        return dev
    end

    # Its parts, [component, part, config]: a light by its type in Z2T's Config
    # ("L01.5": a light on endpoint 1, of type 5), a switch on the mains, a
    # cover, and each sensor Z2T decoded
    static def parts_of(info, router)
        import json
        var out = []
        var light = -1
        var onoff = false
        var eps = []
        for c: info.find("Config", [])
            var k = str(c)
            if size(k) > 0 && k[0] == "L"  light = size(k) >= 5 ? int(k[4]) : 0 end
            if size(k) >= 3 && (k[0] == "O" || k[0] == "P")
                onoff = true
                var ep = int("0x" + k[1 .. 2])
                if eps.find(ep) == nil  eps.push(ep) end
            end
        end
        if light >= 0
            out.push(["light", "light", ZbBridgeDiscovery.light_config(light)])
        elif onoff && router
            # a switch of several: one switch a channel, the first as a switch of one, each other one by its
            # endpoint, "state_2"
            for i: 0 .. size(eps) - 1
                var st = i == 0 ? "state" : "state_" + str(eps[i])
                var on = {}
                var off = {}
                on[st] = "ON"
                off[st] = "OFF"
                out.push(["switch", i == 0 ? "switch" : "switch_" + str(eps[i]), {"name": i == 0 ? nil : "Channel " + str(eps[i]),
                                           "stat_t": "~/state", "val_tpl": "{{ value_json." + st + " }}", "cmd_t": "~/set",
                                           "pl_on": json.dump(on), "pl_off": json.dump(off), "stat_on": "ON", "stat_off": "OFF"}])
            end
        end
        if info.contains("CurrentPositionLiftPercentage")
            out.push(["cover", "cover", {"name": nil, "cmd_t": "~/set", "pl_open": json.dump({"cover": "OPEN"}), "pl_cls": json.dump({"cover": "CLOSE"}),
                                         "pl_stop": json.dump({"cover": "STOP"}), "pos_t": "~/state", "pos_tpl": "{{ value_json.position }}",
                                         "set_pos_t": "~/set", "set_pos_tpl": '{"position": {{ position }}}'}])
        end
        for e: ZbBridgeDiscovery.SENSORS
            if info.contains(e[0])
                var c = {"stat_t": "~/state", "val_tpl": "{{ value_json." + e[2] + " }}", "dev_cla": e[3]}
                if e[4] != nil
                    c["unit_of_meas"] = e[4]
                    c["stat_cla"] = "measurement"
                end
                out.push([e[1], e[2], c])
            end
        end
        return out
    end

    # a light's announcement by its type: 0 on/off, 1 level, 2 white, 3 and 4 colour, 5 colour and white
    static def light_config(t)
        var modes = t == 0 ? ["onoff"] : t == 1 ? ["brightness"] : t == 2 ? ["color_temp"] : t == 5 ? ["hs", "color_temp"] : ["hs"]
        var c = {"name": nil, "schema": "json", "stat_t": "~/state", "cmd_t": "~/set", "sup_clrm": modes}
        if t >= 1
            c["brightness"] = true
            c["bri_scl"] = 254
        end
        if t == 2 || t == 5
            c["min_mirs"] = 153
            c["max_mirs"] = 500
        end
        return c
    end

    # What Home Assistant reads from the state topic: the light's in its JSON
    # schema, the switch's state, the cover's position, each sensor by its part
    static def state_of(info)
        var s = {}
        # the first endpoint's, as its own report said it, which a channel's report on another does not change
        var p = info.find("Power1", info.find("Power"))
        if p != nil  s["state"] = int(p) != 0 ? "ON" : "OFF" end
        for e: 2 .. 8
            var c = info.find("Power" + str(e))
            if c != nil  s["state_" + str(e)] = int(c) != 0 ? "ON" : "OFF" end
        end
        var dim = info.find("Dimmer")
        if dim != nil  s["brightness"] = int(dim) end
        var ct = info.find("CT")
        if ct != nil  s["color_temp"] = int(ct) end
        var hue = info.find("Hue")
        var sat = info.find("Sat")
        if hue != nil && sat != nil  s["color"] = {"h": real(hue) * 360 / 254, "s": real(sat) * 100 / 254} end
        # the white or the colour, when it has both: Z2T's ColorMode, 2 the white
        var mode = info.find("ColorMode")
        if ct != nil && (hue == nil || mode == 2)
            s["color_mode"] = "color_temp"
        elif hue != nil
            s["color_mode"] = "hs"
        elif dim != nil
            s["color_mode"] = "brightness"
        elif p != nil
            s["color_mode"] = "onoff"
        end
        var lift = info.find("CurrentPositionLiftPercentage")
        if lift != nil  s["position"] = 100 - int(lift) end
        for e: ZbBridgeDiscovery.SENSORS
            var v = info.find(e[0])
            if v != nil  s[e[2]] = e[1] == "binary_sensor" ? (int(v) != 0 ? "ON" : "OFF") : v end
        end
        return s
    end

    def publish_state(ieee, info)
        import json
        import mqtt
        mqtt.publish(ZbBridgeDiscovery.BASE + "/" + ieee + "/state", json.dump(ZbBridgeDiscovery.state_of(info)), true)
    end

    def say_reach(ieee, reachable)
        import mqtt
        var v = reachable ? "online" : "offline"
        if self.reach.find(ieee) == v return end
        self.reach[ieee] = v
        mqtt.publish(ZbBridgeDiscovery.BASE + "/" + ieee + "/availability", v, true)
    end

    # Z2T's reach of each device, looked at now and then: a lamp whose power
    # went, unanswered, is unavailable in Home Assistant too
    def look_reach()
        var z = ZbBridgeDiscovery.coordinator()
        if z == nil return end
        for d: z
            var ieee = ZbBridgeDiscovery.ieee(d)
            if self.announced.contains(ieee)  self.say_reach(ieee, ZbBridgeDiscovery.about(d).find("Reachable", true) != false) end
        end
    end

    # --- what left the network ---------------------------------------------------------------

    # What this bridge announced and Z2T no longer has: removed on the glass,
    # or forgotten on the console. A device with no power is still in the list
    def check_left()
        var z = ZbBridgeDiscovery.coordinator()
        if z == nil return end
        var here = {}
        for d: z  here[ZbBridgeDiscovery.ieee(d)] = true end
        for ieee: self.ever
            if !here.contains(ieee)  self.forget_device(ieee) end
        end
    end

    # a moment after a ZbForget, for the list to have it (zbbridge_relay.be)
    def check_later(ms)
        tasmota.remove_timer("zbbridge_discovery_left")
        tasmota.set_timer(ms, / -> self.check_left(), "zbbridge_discovery_left")
    end

    def forget_device(ieee)
        if ieee != self.clearing && self.gone.find(ieee) == nil  self.gone.push(ieee) end
        self.next_gone()
    end

    # One device's announcements at a time: its config topics subscribed to,
    # the broker's retained ones looked at as they come, and those with this
    # bridge's origin cleared with an empty retained message
    def next_gone()
        import mqtt
        if self.clearing != nil || size(self.gone) == 0 || mqtt.connected() != true return end
        var ieee = self.gone[0]
        self.gone.remove(0)
        self.clearing = ieee
        var pattern = ZbBridgeDiscovery.PREFIX + "/+/" + ieee + "/+/config"
        mqtt.subscribe(pattern, / topic, idx, payload_s, payload_b -> self.clear_if_own(topic, payload_s))
        tasmota.set_timer(ZbBridgeDiscovery.CLEAR_MS, / -> self.cleared(ieee, pattern), "zbbridge_discovery_clear")
    end

    def clear_if_own(topic, payload)
        import json
        import mqtt
        if payload == nil || size(payload) == 0 || self.origin == nil return end
        var c = json.load(str(payload))
        var o = isinstance(c, map) ? c.find("o") : nil
        if isinstance(o, map) && o.find("name") == self.origin  mqtt.publish(topic, "", true) end
    end

    def cleared(ieee, pattern)
        import mqtt
        mqtt.unsubscribe(pattern)
        self.clearing = nil
        var i = self.ever.find(ieee)
        if i != nil
            self.ever.remove(i)
            self.save_later()
        end
        for m: [self.announced, self.shaped, self.triggers, self.reach, self.extra]
            if m.contains(ieee)  m.remove(ieee) end
        end
        log("ZBBRIDGE_DISCOVERY: " + ieee + " left the network, its announcements cleared", 2)
        self.next_gone()
    end

    # --- what Z2T hears ----------------------------------------------------------------------

    # A report: its device's state, announced first if it is not yet, or again
    # with a part it did not have; and a button's action, as it happened
    def received(payload)
        if !self.up || !self.on() return end
        var recv = isinstance(payload, map) ? payload.find("ZbReceived") : nil
        var z = ZbBridgeDiscovery.coordinator()
        if !isinstance(recv, map) || z == nil return end
        for key: recv.keys()
            var d = z.find(key)
            if d == nil continue end
            var ieee = ZbBridgeDiscovery.ieee(d)
            var attrs = recv[key]
            if isinstance(attrs, map)
                for k: ZbBridgeDiscovery.KEEP
                    if attrs.contains(k)
                        if !self.extra.contains(ieee)  self.extra[ieee] = {} end
                        self.extra[ieee][k] = attrs[k]
                    end
                end
                # each endpoint's power, as Z2T keeps one for the device: a channel's state of its own
                if attrs.contains("Power") && attrs.contains("Endpoint")
                    if !self.extra.contains(ieee)  self.extra[ieee] = {} end
                    self.extra[ieee]["Power" + str(int(attrs["Endpoint"]))] = attrs["Power"]
                end
            end
            var info = self.known(ieee, d)
            var parts = ZbBridgeDiscovery.parts_for(ieee, info, ZbBridgeDiscovery.router(d))
            if !self.announced.contains(ieee) || size(self.announced[ieee]) != size(parts)
                self.announce(ieee, d)
            else
                self.publish_state(ieee, info)
                self.say_reach(ieee, info.find("Reachable", true) != false)
            end
            if !ZbBridgeDiscovery.router(d) && isinstance(attrs, map)  self.actions(ieee, d, info, attrs) end
        end
    end

    # A button's or a remote's report: each attribute that is no sensor's, an
    # action, "Power_2" for a toggle; a trigger announced the first time it is seen
    def actions(ieee, d, info, attrs)
        import json
        import mqtt
        var sensors = []
        for e: ZbBridgeDiscovery.SENSORS  sensors.push(e[0]) end
        for k: attrs.keys()
            if ZbBridgeDiscovery.NOT_ACTIONS.find(k) != nil || sensors.find(k) != nil continue end
            var v = attrs[k]
            var action = isinstance(v, map) || isinstance(v, list) || v == nil || v == "" ? k : k + "_" + str(v)
            var seen = self.triggers.find(ieee)
            if seen == nil
                seen = []
                self.triggers[ieee] = seen
            end
            if seen.find(action) == nil
                seen.push(action)
                var t = {"atype": "trigger", "t": ZbBridgeDiscovery.BASE + "/" + ieee + "/action", "pl": action,
                         "type": "button_short_press", "stype": action, "dev": self.device(ieee, d, info)}
                if self.origin != nil  t["o"] = {"name": self.origin} end
                mqtt.publish(ZbBridgeDiscovery.config_topic("device_automation", ieee, action), json.dump(t), true)
            end
            mqtt.publish(ZbBridgeDiscovery.BASE + "/" + ieee + "/action", action, false)
        end
    end

    # Home Assistant's command, as its JSON has it, to a device of this network:
    # ZbSend; with the discovery off, Home Assistant has no say in this network
    def command(topic, payload)
        import json
        import string
        import global
        if !self.on() return end
        # Not in the first seconds of a connection, which is when the broker hands back every retained command: a ZbSend OFF of the day
        # before, that Home Assistant published with the retain flag the Berry API does not show, is not the command of now. And not
        # before the second that saw the connection (up is not yet true) either, which is as early as they come
        if !self.up || (self.since != nil && !tasmota.time_reached(self.since)) return end
        var t = string.split(str(topic), "/")
        var z = ZbBridgeDiscovery.coordinator()
        if size(t) != 3 || z == nil || z.find(t[1]) == nil return end
        var c = json.load(str(payload))
        if !isinstance(c, map) return end
        # a switch a driver opens and closes: its cover's command, to the driver
        var dr = ZbBridgeDiscovery.driven(ZbBridgeDiscovery.ieee(z.find(t[1])))
        if dr != nil
            var cv = c.find("cover")
            var cmd = cv == "OPEN" ? {"do": "open"} : cv == "CLOSE" ? {"do": "close"} : cv == "STOP" ? {"do": "stop"} : nil
            if c.find("position") != nil  cmd = {"do": "goto", "v": ZbBridgeDiscovery.clamp(int(c["position"]), 0, 100)} end
            if cmd != nil  dr.command(global.zbbridge_relay.drivers.info_for(ZbBridgeDiscovery.ieee(z.find(t[1]))), cmd) end
            return
        end
        var send = {}
        var st = c.find("state")
        if st == "ON"  send["Power"] = 1 elif st == "OFF"  send["Power"] = 0 elif st == "TOGGLE"  send["Power"] = 2 end
        var b = c.find("brightness")
        if b != nil  send["Dimmer"] = ZbBridgeDiscovery.clamp(int(b), 0, 254) end
        var ct = c.find("color_temp")
        if ct != nil  send["CT"] = ZbBridgeDiscovery.clamp(int(ct), 153, 500) end
        var col = c.find("color")
        if isinstance(col, map) && col.contains("h") && col.contains("s")
            var h = ZbBridgeDiscovery.clamp(int(real(col["h"]) * 254 / 360 + 0.5), 0, 254)
            var s = ZbBridgeDiscovery.clamp(int(real(col["s"]) * 254 / 100 + 0.5), 0, 254)
            send["HueSat"] = str(h) + "," + str(s)
        end
        var cover = c.find("cover")
        if cover == "OPEN"  send["ShutterOpen"] = true elif cover == "CLOSE"  send["ShutterClose"] = true elif cover == "STOP"  send["ShutterStop"] = true end
        var pos = c.find("position")
        if pos != nil  send["ShutterLift"] = 100 - ZbBridgeDiscovery.clamp(int(pos), 0, 100) end
        # a channel's, "state_2", to its endpoint
        for k: c.keys()
            if string.find(k, "state_") == 0
                var v = c[k]
                var pw = v == "ON" ? 1 : v == "OFF" ? 0 : v == "TOGGLE" ? 2 : nil
                if pw != nil  self.zb_send("ZbSend " + json.dump({"Device": t[1], "Endpoint": int(k[6 ..]), "Send": {"Power": pw}})) end
            end
        end
        if size(send) == 0 return end
        self.zb_send("ZbSend " + json.dump({"Device": t[1], "Send": send}))
    end

    # A ZbSend of Home Assistant's: the alarm is told first, for the reports that answer it for a moment are the device's echo and not a
    # hand on it. Nine flips of a lamp in two seconds, by a scene, were taken for the burst and made the panic. The ones
    # a driver sends are the drivers' own to tell it
    def zb_send(line)
        import global
        var r = global.contains("zbbridge_relay") ? global.zbbridge_relay : nil
        if r != nil && r.alarm != nil  r.alarm.commanded(line) end
        tasmota.cmd(line)
    end

    static def clamp(v, lo, hi) return v < lo ? lo : v > hi ? hi : v end

    # --- the names, the panel's ---------------------------------------------------------------

    # ZbRelayName {"IEEE","Name"}: a device's name, "" to forget it; its
    # announcement again with it, and the names saved once they stop coming
    def name_cmd(payload)
        import json
        import string
        var m = json.load(str(payload))
        var ieee = isinstance(m, map) ? str(m.find("IEEE", "")) : ""
        var name = isinstance(m, map) ? str(m.find("Name", "")) : ""
        if size(ieee) != 18 || !string.startswith(ieee, "0x") || size(name) > 64
            tasmota.resp_cmnd_failed()
            return
        end
        if name == ""
            if self.names.contains(ieee)  self.names.remove(ieee) end
        else
            self.names[ieee] = name
        end
        self.save_later()
        if self.announced.contains(ieee) && self.todo.find(ieee) == nil
            self.todo.push(ieee)
            self.next_later(0)
        end
        tasmota.resp_cmnd_done()
    end

    # the names and the list of what was announced, saved once they stop changing
    def save_later()
        tasmota.remove_timer("zbbridge_discovery_save")
        tasmota.set_timer(ZbBridgeDiscovery.SAVE_MS, / -> self.save(), "zbbridge_discovery_save")
    end

    def save()
        import persist
        persist.setmember(ZbBridgeDiscovery.NAMES_KEY, self.names)
        persist.setmember(ZbBridgeDiscovery.EVER_KEY, self.ever)
        PairSign.safe_save("ZBBRIDGE_DISCOVERY")
    end

    # this bridge's Topic, as Tasmota has it, or nil
    static def topic()
        var t = tasmota.cmd("Topic")
        return isinstance(t, map) ? t.find("Topic") : nil
    end

    # the bridge's LWT, where Tasmota publishes Online and its broker Offline:
    # its FullTopic with the prefix of telemetry and its topic, and LWT
    static def lwt_topic()
        import string
        var t = tasmota.cmd("Topic")
        var f = tasmota.cmd("FullTopic")
        var p = tasmota.cmd("Prefix3")
        t = isinstance(t, map) ? t.find("Topic") : nil
        f = isinstance(f, map) ? f.find("FullTopic") : nil
        p = isinstance(p, map) ? p.find("Prefix3") : nil
        if t == nil || f == nil || p == nil return nil end
        return string.replace(string.replace(str(f), "%prefix%", str(p)), "%topic%", str(t)) + "LWT"
    end
end
