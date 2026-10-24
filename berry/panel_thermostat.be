# panel_thermostat.be -- the thermostats as the panel knows them: what the
# bridge's driver says of each one, kept as it says it. The panel never sees an attribute or
# a datapoint of a thermostat: the driver (zbdriver_thermostat.be, on the bridge) turns them into
# a state in tenths of a degree,
#   cur    the room's temperature, from the device's own sensor
#   set    the target
#   mode   "off" or "heat": a thermostat for heating, and nothing else
#   dem    how much the heating works, 0 to 100
#   floor  the temperature of the floor probe, for a device that has one
#   up     whether the device answers
# and, for the settings screen (panel_thermostat_settings.be), the device's settings: the schema, a list the driver says in
# numbered frames, and the values by key. The state is said only when it changed, and this keeps the last word of each.
# The message that carries it
# is ZbDriver, which PanelZigbee hands over with the device it is about (zigbee_bridge.be's
# EVENTS has it for the panel's transport, zbbridge_drivers.be makes it on the bridge).
#
# What the zone's icon shows comes from here: the mode is the on of the lamps' on and off, told
# to the plan through PanelZigbee.tell, which is what confirms a command the panel waits for.

#@ solidify:PanelThermostat
class PanelThermostat
    var zb        # the PanelZigbee this serves: its store, and what it tells the plan and the views
    var state     # IEEE -> {field -> value}, the last the driver said
    var shape     # IEEE -> the driver's last description of it: the step of its target, its modes, its probe
    var schema    # IEEE -> the settings' schema, a list of entries, once whole: the device whose settings are on show only
    var parts     # IEEE -> the entries of a schema being gathered from its frames
    var values    # IEEE -> {key -> the value the driver said of the setting}

    def init(zb)
        self.zb = zb
        self.state = {}
        self.shape = {}
        self.schema = {}
        self.parts = {}
        self.values = {}
    end

    # What the driver said of a device in one message: {section -> ...}. Its description is
    # the pairing's (PanelZigbee.on_driver has taken it by now) and is kept for what the
    # screens need of it; its state is told to the views and the plan
    def on_driver(id, secs)
        if secs.contains("d") && isinstance(secs["d"], map) && secs["d"].find("kind") == "thermostat"
            self.shape[id] = secs["d"]
        end
        if secs.contains("s") && isinstance(secs["s"], map)  self.on_state(id, secs["s"]) end
        if self.settings(id, secs)  self.zb.emit(self.zb.ui.thermostat_changed(id)) end
        if secs.contains("e")
            # its command found no driver, or the driver would not take it: the plan's own wait ends in the "?" and a ping, which is
            # true, and a target or a setting set on the page has no such wait, so the "?" is told here, until a word of the
            # device says otherwise
            log("THERMOSTAT: the bridge refused a command for " + id + ": " + str(secs["e"]), 2)
            var dev = self.zb.store.find_device(id)
            if dev != nil && dev[2] == "thermostat"
                self.zb.tell(id, "noanswer")
                self.zb.refresh_later(id)
            end
        end
    end

    # A thermostat's state, the fields that changed
    def on_state(id, s)
        var d = self.zb.store.find_device(id)
        if d == nil || d[2] != "thermostat" return end
        var st = self.state.find(id)
        if st == nil
            st = {}
            self.state[id] = st
        end
        for k: s.keys()  st[k] = s[k] end
        # what a summed-up card shows: the temperatures, which the plan draws again when their whole degrees change
        if (s.contains("cur") || s.contains("floor")) && self.zb.plan != nil  self.zb.plan.on_temps(id, PanelThermostat.temps_of(st)) end
        # the page of a thermostat on show follows the temperatures too, and a target the device says is the one the finger set is the
        # device's now
        if s.contains("set") && self.zb.ui != nil  self.zb.ui.thermostat_said(id, s["set"]) end
        if (s.contains("cur") || s.contains("floor") || s.contains("set")) && self.zb.ui != nil && self.zb.ui.thermostat_shows(id)  self.zb.refresh_later(id) end
        # and whether it heats, which turns its icon warm
        if (s.contains("mode") || s.contains("dem")) && self.zb.plan != nil  self.zb.plan.on_heating(id, self.heating(id)) end
        # the mode is the lit and unlit of a lamp: told to the plan even when it is the one it
        # had, since it is also what a command is waiting for
        if s.contains("mode")  self.zb.tell(id, s["mode"] != "off" ? "on" : "off") end
        if s.contains("up")
            if s["up"] == false
                self.zb.tell(id, "noanswer")
            else
                self.zb.reachable(id)
            end
        end
        # what an icon shows: on, off, heating, no communication
        if s.contains("mode") || s.contains("dem") || s.contains("up")  self.zb.refresh_later(id) end
    end

    # The settings of a thermostat, said in a message: the schema's frames and the values (PanelThermostatSettings.take, which a
    # blind's model shares). True when the screen of them is to be drawn again
    def settings(id, secs)
        var d = self.zb.store.find_device(id)
        if d == nil || d[2] != "thermostat" return false end
        return PanelThermostatSettings.take(self, id, secs)
    end

    # A frame of the schema, {"at": where it starts, "of": how many entries there are, "l": these}, which follow each other. One that
    # starts past what was gathered is a frame lost: nothing is kept, and the screen asks again when it is opened. True when the
    # last one came. Only one device's schema is kept, as only one screen of settings is open at a time
    def on_schema(id, f)
        return PanelThermostatSettings.frame(self, id, f)
    end

    # the settings screen of a device left: its schema goes, which is heap; the values are small and stay
    def release(id)
        self.schema.remove(id)
        self.parts.remove(id)
    end

    # A temperature in tenths of a degree as whole degrees, by the weather's rule (roundTempC, layout/src/format.ts): the tenth
    # decides on magnitude, .0 to .5 keeps the degree and .6 goes to the next, the same below zero, and never "-0". nil for no number
    static def degrees(tenths)
        if type(tenths) == "real" tenths = int(tenths) end
        if type(tenths) != "int" return nil end
        var whole = ((tenths < 0 ? -tenths : tenths) + 4) / 10
        return tenths < 0 ? -whole : whole
    end

    # what a summed-up card shows of a thermostat: [room, floor] in whole degrees, the floor nil for none, or nil until it says the room's
    static def temps_of(st)
        var room = PanelThermostat.degrees(st.find("cur"))
        return room == nil ? nil : [room, PanelThermostat.degrees(st.find("floor"))]
    end

    # a field of a thermostat's state, or `missing`
    def get(id, field, missing)
        var st = self.state.find(id)
        return st != nil ? st.find(field, missing) : missing
    end

    # whether a thermostat heats now: it is on and its demand is above 0. Until the driver has said, it does not
    def heating(id)
        return self.get(id, "mode", "off") != "off" && self.get(id, "dem", 0) > 0
    end

    # a device that left the panel: what was known of it goes
    def forget(id)
        if self.zb.plan != nil
            self.zb.plan.on_temps(id, nil)
            self.zb.plan.on_heating(id, false)
        end
        self.state.remove(id)
        self.shape.remove(id)
        self.values.remove(id)
        self.release(id)
    end
end
