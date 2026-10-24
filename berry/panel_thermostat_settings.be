# panel_thermostat_settings.be -- the rows of a thermostat's settings screen, made from what its
# driver on the bridge said: the schema, a list of entries, and the values by key (PanelThermostat). A class of
# static helpers, as PanelText is: the screen is a view of the list's page, so it costs no byte of .tft, and
# PanelUi, which has no constants left to spare, only dispatches to it. It comes before PanelUi, which names it, and so
# names no PanelUi: the rows are made here as PanelUi.row makes them.
#
# The same screen is a blind's: the model passed is the one that keeps the device's settings, PanelThermostat or
# PanelCover, which gather the driver's frames the same way (take).
#
# An entry of the schema is {"k": the key, "l": the label, "t": how it is edited, ...}:
#   "b"  a flag: a row the touch toggles, whose value says On or Off
#   "e"  a choice of the options ("o"), by their index: a list the touch opens, with a dot on the one it has
#   "n"  a whole number between "min" and "max", in "u"nits: the keypad, which has digits and no sign
#   "r"  the same, chosen from the list its range makes, for what may be below zero, in steps of "s" (1 when it says none)
# and "w": 0 for what is only read. A value the driver has not said is "?". Editing off, the rows are facts.

#@ solidify:PanelThermostatSettings
class PanelThermostatSettings
    # What the driver said of a device's settings in a message, kept in `model` (schema, parts, values): the schema's frames and the
    # values. True when the screen of them is to be drawn again
    static def take(model, id, secs)
        var shown = false
        if secs.contains("x") && isinstance(secs["x"], map) && PanelThermostatSettings.frame(model, id, secs["x"])  shown = true end
        if secs.contains("v") && isinstance(secs["v"], map)
            var m = model.values.find(id)
            if m == nil
                m = {}
                model.values[id] = m
            end
            for k: secs["v"].keys()  m[k] = secs["v"][k] end
            shown = true
        end
        return shown
    end

    # A frame of the schema, {"at": where it starts, "of": how many entries there are, "l": these}, which follow each other. One that
    # starts past what was gathered is a frame lost: nothing is kept, and the screen asks again when it is opened. True when the
    # last one came. Only one device's schema is kept, as only one screen of settings is open at a time
    static def frame(model, id, f)
        var l = f.find("l")
        if !isinstance(l, list) return false end
        var at = f.find("at", 0)
        var got = model.parts.find(id)
        if at == 0 || got == nil
            model.parts = {}
            got = []
            model.parts[id] = got
        end
        if at > size(got)
            model.parts.remove(id)
            return false
        end
        # what overlaps what is there is the same list said again
        var i = size(got) - at
        while i < size(l)
            got.push(l[i])
            i += 1
        end
        if size(got) < f.find("of", 0) return false end
        model.parts.remove(id)
        model.schema = {}
        model.schema[id] = got
        return true
    end

    # a row of a list view, as PanelUi.row makes it: the glyph and its colour, if any, the label, the value, the tap
    static def row(glyph, label, hint, tap)
        return [glyph != nil ? glyph[0] : "", glyph != nil ? glyph[1] : "", label, hint, false, tap, nil]
    end

    # the glyph of a choice's row, as PanelUi.chosen makes it
    static def dot(on)
        return [on ? "dotOn" : "dotOff", "icon-off"]
    end

    # the entry of a setting in a thermostat's schema, or nil
    static def entry(thermostat, id, key)
        var s = thermostat != nil ? thermostat.schema.find(id) : nil
        if s == nil return nil end
        for e: s
            if e.find("k") == key return e end
        end
        return nil
    end

    # the value the driver said of a setting, or nil
    static def value(thermostat, id, key)
        var m = thermostat != nil ? thermostat.values.find(id) : nil
        return m != nil ? m.find(key) : nil
    end

    # a whole number with its unit, and a sign when the range goes below zero: "+2°", "0°", "-3°"
    static def number(e, v)
        return (e.find("min", 0) < 0 && v > 0 ? "+" : "") + str(v) + e.find("u", "")
    end

    # a value as its row says it
    static def text(e, v)
        if v == nil return "?" end
        # a lamp's setting it refused to be written
        if v == "unsupported" return "Not supported" end
        var t = e.find("t")
        if t == "b" return v == true ? "On" : "Off" end
        if t == "e"
            var o = e.find("o", [])
            return type(v) == "int" && v >= 0 && v < size(o) ? str(o[v]) : "?"
        end
        return type(v) == "int" ? PanelThermostatSettings.number(e, v) : "?"
    end

    # The choices of a setting, [value, label] each: a list's are its options by index, a range's its whole numbers
    static def options(e)
        var out = []
        if e.find("t") == "e"
            var i = 0
            for o: e.find("o", [])
                out.push([i, str(o)])
                i += 1
            end
        else
            var v = e.find("min", 0)
            var step = e.find("s", 1)
            while v <= e.find("max", 0)
                out.push([v, PanelThermostatSettings.number(e, v)])
                v += step
            end
        end
        return out
    end

    # where the choice with this value is among the choices, 0 for none
    static def index_of(e, now)
        var i = 0
        for o: PanelThermostatSettings.options(e)
            if o[0] == now return i end
            i += 1
        end
        return 0
    end

    # The screen: its rows, or the list one setting is chosen from. `view` is ["thermostatSettings", id] or
    # ["thermostatChoice", id, key]; `ed` is Editing, with which the rows take a touch
    static def view(thermostat, view, ed)
        var id = view[1]
        if view[0] == "thermostatChoice" return PanelThermostatSettings.choice(thermostat, id, view[2]) end
        var s = thermostat != nil ? thermostat.schema.find(id) : nil
        if s == nil return ["Settings", "", [PanelThermostatSettings.row(nil, "Reading the device", "", nil)]] end
        if size(s) == 0 return ["Settings", "", [PanelThermostatSettings.row(nil, "No settings", "", nil)]] end
        var rows = []
        for e: s
            var key = e.find("k")
            var t = e.find("t")
            var tap = nil
            if ed && e.find("w", 1) != 0
                if t == "b"
                    tap = ["thermostat", "toggle", id, key]
                elif t == "e" || t == "r"
                    tap = ["thermostat", "pick", id, key]
                else
                    tap = ["keyboard", "thermostatNumber", id, key]
                end
            end
            rows.push(PanelThermostatSettings.row(nil, e.find("l", key), PanelThermostatSettings.text(e, PanelThermostatSettings.value(thermostat, id, key)), tap))
        end
        return ["Settings", "", rows]
    end

    # the list a choice is made from: a dot on the one the device has, and a touch on another takes it
    static def choice(thermostat, id, key)
        var e = PanelThermostatSettings.entry(thermostat, id, key)
        if e == nil return ["Settings", "", []] end
        var now = PanelThermostatSettings.value(thermostat, id, key)
        var rows = []
        for o: PanelThermostatSettings.options(e)
            rows.push(PanelThermostatSettings.row(PanelThermostatSettings.dot(o[0] == now), o[1], "", o[0] == now ? nil : ["thermostat", "choose", id, key, o[0]]))
        end
        return [e.find("l", key), "", rows]
    end
end
