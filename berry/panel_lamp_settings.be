# panel_lamp_settings.be -- a lamp's settings: what it does when its power comes back, the
# StartUpOnOff of its On/Off cluster, and how long it takes to light and to go out, the OnOffTransitionTime of its Level
# Control cluster. Both are the lamp's own, written to it and read back over Zigbee by the panel itself, as no driver on
# the bridge has lamps. The model the settings' screen is made from, as PanelThermostat's and PanelCover's are
# (PanelThermostatSettings): the schema, the panel's here, and the values by key.
#
# The power-on choice is the lamp's record's too, in its startup field (d[8]), for the plan, which draws the lamps a
# relay feeds as they come back when it closes: 1 off, 3 on, 4 as they were; 2 is a lamp that refused
# the pairing's write, and 0 one never written.

#@ solidify:PanelLampSettings
class PanelLampSettings
    var zb        # the PanelZigbee this serves: its store, its sends and its views
    var schema    # IEEE -> the entries of the screen on show: the device whose settings are open only
    var parts     # unused: the schema is the panel's, whole, and no frames are gathered (PanelThermostatSettings.frame)
    var values    # IEEE -> {key -> the index of the choice the lamp has, or "unsupported"}
    var writes    # the lamp's IEEE -> [its id, key, index]: the writes whose answers are expected

    # the choices' values, by index: StartUpOnOff's Off, On and Previous, and OnOffTransitionTime's Instant, 0.5 s, 1 s
    # and 2 s, in tenths of a second
    static POWER = [0, 1, 255]
    static FADE = [0, 5, 10, 20]
    # the record's startup field for each power-on choice, which the plan reads
    static RECORD = [1, 3, 4]
    static SCHEMA = [{"k": "power", "l": "Power on", "t": "e", "o": ["Off", "On", "Previous"]},
                     {"k": "fade", "l": "Fade", "t": "e", "o": ["Instant", "0.5 s", "1 s", "2 s"]}]

    def init(zb)
        self.zb = zb
        self.schema = {}
        self.parts = {}
        self.values = {}
        self.writes = {}
    end

    # the Z2T attribute of a key, and the values its choices stand for
    static def attr(key) return key == "power" ? "StartUpOnOff" : "OnOffTransitionTime" end
    static def choices(key) return key == "power" ? PanelLampSettings.POWER : PanelLampSettings.FADE end

    # the screen opened: its schema, at once, and the values the lamp said before, until it says them again
    def open(id)
        self.schema = {}
        self.schema[id] = PanelLampSettings.SCHEMA
        if !self.values.contains(id)  self.values[id] = {} end
    end

    # the screen left: its schema goes, and the values with it
    def release(id)
        self.schema = {}
        if self.values.contains(id)  self.values.remove(id) end
    end

    def forget(id)
        self.release(id)
    end

    # A command of the views, ["lamp", id, "read"] or ["lamp", id, "write", key, index]: a read of each attribute, which
    # are of two clusters and so two reads; or the choice written, and its answer expected
    def run(e)
        import string
        var id = e[1]
        if e[2] == "read"
            for key: ["power", "fade"]
                self.zb.send(string.format('ZbSend {"Device":"%s","Read":{"%s":true}}', id, PanelLampSettings.attr(key)))
            end
            return
        end
        var key = e[3]
        var i = e[4]
        var c = PanelLampSettings.choices(key)
        if type(i) != "int" || i < 0 || i >= size(c) return end
        # its answer is awaited by the lamp's IEEE, which the bridge names it by, or the map of its short address does
        self.writes[PanelStore.ieee_part(id)] = [id, key, i]
        self.zb.send(string.format('ZbSend {"Device":"%s","Write":{"%s":%d}}', id, PanelLampSettings.attr(key), c[i]))
    end

    # the index of the choice nearest a value the lamp said, or nil for none of them (a toggle, 2, is no choice here)
    static def index(key, v)
        if type(v) != "int" return nil end
        var c = PanelLampSettings.choices(key)
        if key == "power" return c.find(v) end
        var best = 0
        for i: 1 .. size(c) - 1
            if (v - c[i]) * (v - c[i]) < (v - c[best]) * (v - c[best])  best = i end
        end
        return best
    end

    # A lamp said its attributes, a report or a read's answer: kept, and its screen drawn again when it is on show
    def said(id, attrs)
        var m = self.values.find(id)
        if m == nil return end
        for key: ["power", "fade"]
            var v = attrs.find(PanelLampSettings.attr(key))
            if v != nil  m[key] = PanelLampSettings.index(key, v) end
        end
        self.zb.emit(self.zb.ui.thermostat_changed(id))
    end

    # The answer to a write, from that short address: taken, the value is the one written, and a power-on choice goes
    # to the record, saved; refused, the setting is not one the lamp has. True when it was one of these
    def answer(ieee, r)
        var w = self.writes.find(ieee)
        if w == nil return false end
        self.writes.remove(ieee)
        var id = w[0]
        var ok = r.find("Status") == 0
        var m = self.values.find(id)
        if m != nil  m[w[1]] = ok ? w[2] : "unsupported" end
        var out = []
        var d = self.zb.store.find_device(id)
        if ok && w[1] == "power" && d != nil
            d[8] = PanelLampSettings.RECORD[w[2]]
            out.push(["save"])
        end
        for x: self.zb.ui.thermostat_changed(id)  out.push(x) end
        self.zb.emit(out)
        return true
    end
end
