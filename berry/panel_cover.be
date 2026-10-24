# panel_cover.be -- the blinds as the panel knows them: what the bridge's driver says of
# each one, kept as it says it, and the cycle a tap on one runs. The panel never sees an attribute or a
# datapoint of a blind: the driver (zbdriver_cover.be, on the bridge) turns them into a state,
#   pos   where it is, 0 closed to 100 open
#   mov   "up", "down" or "stop"
#   up    whether the device answers
# which comes in ZbDriver, the message PanelZigbee hands over with the device it is about.
#
# What the icons show comes from here: the open glyph while the blind is not all the way
# down, which is the "on" of the lamps' on and off, told to the plan through PanelZigbee.tell; and the tone,
# the theme's accent while it moves and green when it is all the way up, told to the plan as a lamp's
# colour is, by what it is doing and where it is.
#
# THE CYCLE: a tap stops a blind that moves, and sends one that stands the
# other way from the last it went: up, stop, down, stop, up. At the top it goes down, at the bottom up,
# and with nothing known it goes up. Several blinds, on a zone's counter or card, go together and
# the same way: any one moving stops them all, and standing they go the other way from the one
# that moved last. A key pressed on the wall is a move like any other, and the glass goes on from it. A gate of two keys
# has no stop (its driver says so in its description, and refuses one): a tap on it while it moves turns it back, up,
# down, up, with no stop between.

#@ solidify:PanelCover
class PanelCover
    var zb        # the PanelZigbee this serves: its store, and what it tells the plan and the views
    var state     # IEEE -> {field -> value}, the last the driver said
    var last      # IEEE -> [the way it last went, "up" or "down", the move's number]: what the next tap reverses
    var moves     # counts the moves, so the last of several blinds is known
    var schema    # IEEE -> the settings' schema, a list of entries, once whole: the device whose settings are on show only
    var parts     # IEEE -> the entries of a schema being gathered from its frames
    var values    # IEEE -> {key -> the value of the setting}: the driver's, and the ventilation, the panel's own
    var nostop    # IEEE -> true for a device whose driver says it has no stop (a gate of two keys): the cycle goes without one

    # the panel's own setting, first on a blind's settings: the ventilation, 5% to 95% open in steps of 5
    static VENT = {"k": "vent", "l": "Ventilation", "t": "r", "min": 5, "max": 95, "s": 5, "u": "%"}

    def init(zb)
        self.zb = zb
        self.state = {}
        self.last = {}
        self.moves = 0
        self.schema = {}
        self.parts = {}
        self.values = {}
        self.nostop = {}
    end

    # What the driver said of a device in one message: {section -> ...}. Its description is the pairing's
    # (PanelZigbee.on_driver has taken it by now); its state is told to the views and the plan
    def on_driver(id, secs)
        # a gate of two keys has no stop, and its description says so: what a tap does goes without one
        var d = secs.find("d")
        if isinstance(d, map)
            if d.find("stop") == false  self.nostop[id] = true else self.nostop.remove(id) end
        end
        if secs.contains("s") && isinstance(secs["s"], map)  self.on_state(id, secs["s"]) end
        if self.settings(id, secs)  self.zb.emit(self.zb.ui.thermostat_changed(id)) end
        if secs.contains("e")
            log("COVER: the bridge refused a command for " + id + ": " + str(secs["e"]), 2)
            # a command nobody took is the "?" a device that does not answer has, until a word of the device says otherwise
            var dev = self.zb.store.find_device(id)
            if dev != nil && dev[2] == "cover"
                self.zb.tell(id, "noanswer")
                self.zb.refresh_later(id)
            end
        end
    end

    # A blind's state, the fields that changed
    def on_state(id, s)
        var d = self.zb.store.find_device(id)
        if d == nil || d[2] != "cover" return end
        var st = self.state.find(id)
        if st == nil
            st = {}
            self.state[id] = st
        end
        for k: s.keys()  st[k] = s[k] end
        var m = s.find("mov")
        if m == "up" || m == "down"  self.went(id, m) end
        var plan = self.zb.plan
        if plan != nil
            if s.contains("mov")  plan.on_moving(id, m == "up" || m == "down") end
            if s.contains("pos")  plan.on_cover(id, s["pos"]) end
        end
        # the open glyph while it is not all the way down: told even when it is the one it had, as a lamp's state is
        # a place not known, a gate's with no sensor, is as a closed one's: nothing lit
        if s.contains("pos")  self.zb.tell(id, s["pos"] != nil && s["pos"] > 0 ? "on" : "off") end
        if s.contains("up")
            if s["up"] == false
                self.zb.tell(id, "noanswer")
            else
                self.zb.reachable(id)
            end
        end
        if s.contains("pos") || s.contains("mov") || s.contains("up")  self.zb.refresh_later(id) end
    end

    # a blind went one way: the next tap that finds it standing sends it the other
    def went(id, way)
        self.moves += 1
        self.last[id] = [way, self.moves]
    end

    # a field of a blind's state, or `missing`
    def get(id, field, missing)
        var st = self.state.find(id)
        return st != nil ? st.find(field, missing) : missing
    end

    def moving(id)
        var m = self.get(id, "mov", "stop")
        return m == "up" || m == "down"
    end

    # What a tap on these blinds does: "stop" when one moves, and otherwise "open" or "close", all of them the same way. A device with
    # no stop (a gate of two keys) that moves is turned back instead, the other way from the one it goes, when none that can stop moves
    def next_verb(ids)
        var known = false
        var top = true
        var bottom = true
        var way = nil
        var at = -1
        var back = nil
        for id: ids
            if self.moving(id)
                if !self.nostop.contains(id) return "stop" end
                back = self.get(id, "mov", "stop") == "up" ? "close" : "open"
                continue
            end
            var p = self.get(id, "pos", nil)
            if p == nil
                top = false
                bottom = false
            else
                known = true
                if p != 100  top = false end
                if p != 0  bottom = false end
            end
            var l = self.last.find(id)
            if l != nil && l[1] > at
                way = l[0]
                at = l[1]
            end
        end
        if back != nil return back end
        if known && top return "close" end
        if known && bottom return "open" end
        if way == "up" return "close" end
        return "open"
    end

    # A tap's command: the effect that sends it, and the way it goes noted at once, before the driver's word, so a tap
    # that follows fast reverses it
    def cycle(ids)
        if size(ids) == 0 return [] end
        var verb = self.next_verb(ids)
        if verb != "stop"
            for id: ids  self.went(id, verb == "open" ? "up" : "down") end
        end
        return [["cover", ids, verb]]
    end

    # what a summed-up card shows of a blind: its position, or nil until it says one
    def position(id)
        return self.get(id, "pos", nil)
    end

    # The settings of a blind, said in a message, gathered as a thermostat's are (PanelThermostatSettings.take): the driver's, after
    # the ventilation, which is the panel's and is on every blind. True when the screen of them is to be drawn again
    def settings(id, secs)
        var d = self.zb.store.find_device(id)
        if d == nil || d[2] != "cover" return false end
        var shown = PanelThermostatSettings.take(self, id, secs)
        var s = self.schema.find(id)
        if s != nil && (size(s) == 0 || s[0].find("k") != "vent")  s.insert(0, PanelCover.VENT) end
        self.vent_said(id, PanelCoverView.ventilation([d]))
        return shown
    end

    # the ventilation a blind has, as its settings show it
    def vent_said(id, v)
        var m = self.values.find(id)
        if m == nil
            m = {}
            self.values[id] = m
        end
        m["vent"] = v
    end

    # the settings screen of a device left: its schema goes, which is heap; the values are small and stay
    def release(id)
        self.schema.remove(id)
        self.parts.remove(id)
    end

    # a device that left the panel: what was known of it goes
    def forget(id)
        if self.zb.plan != nil
            self.zb.plan.on_moving(id, false)
            self.zb.plan.on_cover(id, nil)
        end
        self.state.remove(id)
        self.last.remove(id)
        self.values.remove(id)
        self.nostop.remove(id)
        self.release(id)
    end
end
