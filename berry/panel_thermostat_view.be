# panel_thermostat_view.be -- a thermostat's own page: what it says of the device, or of a zone's thermostats that one
# relay feeds, made from what the bridge's driver said of them (PanelThermostat). A class of static helpers, as PanelThermostatSettings
# is: the page is a template of the .tft whose words the panel writes (`$thermostat.*`), and PanelUi, which has no constants left to
# spare, only dispatches to it. It comes before PanelUi, which names it, and so names no PanelUi.
#
# A page is about one thermostat, ["thermostat", "d", id], or about the thermostats of one relay in a zone, ["thermostat", "t", zone,
# relay]: the joint mode. The target and the mode it sets are every one's, the target it shows is the median of theirs,
# and the room's temperature the mean of theirs.

#@ solidify:PanelThermostatView
class PanelThermostatView
    # the modes' words on the page, which are two: it is a thermostat for heating
    static MODES = {"off": "Off", "heat": "Heat"}
    # a button's tone: the plain text one, and the dim one of a button that can go no further
    static TONE = "text-primary"
    static DIM = "icon-off"

    # tenths of a degree as degrees to a decimal: 215 is "21.5", and -35 "-3.5"
    static def degrees(tenths)
        var t = tenths < 0 ? -tenths : tenths
        return (tenths < 0 ? "-" : "") + str(t / 10) + "." + str(t % 10)
    end

    # the thermostats a view is about, as the store has them: one, or a zone's of one relay
    static def members(store, view)
        var out = []
        if view[1] == "d"
            var d = store.find_device(view[2])
            if d != nil && d[2] == "thermostat"  out.push(d) end
            return out
        end
        var zone = store.find_zone(view[2])
        if zone == nil return out end
        for id: PanelStore.member_ids(zone["members"])
            var d = store.find_device(id)
            if d != nil && d[2] == "thermostat" && d[9] == view[3]  out.push(d) end
        end
        return out
    end

    # the title: the thermostat's name, or the zone's and how many of them: "Hall · 2 thermostats"
    static def title(store, view, members)
        if view[1] == "d" return members[0][1] end
        var zone = store.find_zone(view[2])
        var n = size(members)
        return (zone != nil ? zone["name"] : "") + " · " + str(n) + " " + (n == 1 ? "thermostat" : "thermostats")
    end

    # the middle of some numbers, the lower one of two, as the lamps' sliders show theirs; nil for none
    static def median(values)
        if size(values) == 0 return nil end
        var sorted = PanelStore.sorted(values)
        return sorted[(size(sorted) - 1) / 2]
    end

    # the mean of whole numbers, to the nearest; nil for none
    static def mean(values)
        var n = size(values)
        if n == 0 return nil end
        var sum = 0
        for v: values  sum += v end
        return (sum * 2 + (sum < 0 ? -n : n)) / (2 * n)
    end

    # the target the page shows: the median of the members', where one that the finger has set (`drafts`, id -> tenths) is that, and nil
    # with none said
    static def target(thermostat, members, drafts)
        var values = []
        for d: members
            var v = drafts.find(d[0])
            if v == nil  v = thermostat.get(d[0], "set", nil) end
            if v != nil  values.push(v) end
        end
        return PanelThermostatView.median(values)
    end

    # how far the target goes: [the lowest every member takes, the highest every one does, the step], in tenths
    static def span(thermostat, members)
        var lo = 0
        var hi = 1000
        var step = 5
        for d: members
            if d[4] > lo  lo = d[4] end
            if d[5] < hi  hi = d[5] end
            var s = thermostat.shape.find(d[0])
            if s != nil  step = s.find("step", step) end
        end
        return [lo, hi, step]
    end

    # the target in words, and the buttons' tones: the - dims at the lowest the members take, and the + at the highest
    static def target_effects(thermostat, members, drafts)
        var t = PanelThermostatView.target(thermostat, members, drafts)
        var r = PanelThermostatView.span(thermostat, members)
        return [["set", "$thermostat.target", t != nil ? PanelThermostatView.degrees(t) + "°C" : "--"],
                ["set", "$thermostat.minus.iconColor", t != nil && t <= r[0] ? PanelThermostatView.DIM : PanelThermostatView.TONE],
                ["set", "$thermostat.plus.iconColor", t != nil && t >= r[1] ? PanelThermostatView.DIM : PanelThermostatView.TONE]]
    end

    # the line of words under the target: the room's temperature, and the floor's when a member has a probe, by the mean of what they
    # said. What they are doing is the lit mode's to say: the line that said it in a word left the page
    static def lines(thermostat, members)
        var rooms = []
        var floors = []
        for d: members
            var cur = thermostat.get(d[0], "cur", nil)
            var floor = thermostat.get(d[0], "floor", nil)
            if cur != nil  rooms.push(cur) end
            if floor != nil  floors.push(floor) end
        end
        var room = PanelThermostatView.mean(rooms)
        var first = "Room " + (room != nil ? PanelThermostatView.degrees(room) + "°" : "--")
        if size(floors) > 0  first += "  Floor " + PanelThermostatView.degrees(PanelThermostatView.mean(floors)) + "°" end
        return [first]
    end

    # the modes' slots: the word of each mode the first thermostat has, lit when the members are in it (on, if any one is on)
    static def modes(thermostat, members, looks, slots)
        var names = []
        if size(members) > 0
            var s = thermostat.shape.find(members[0][0])
            if s != nil  names = s.find("modes", []) end
        end
        var any_on = false
        var any_off = false
        for w: looks
            if w == "on"
                any_on = true
            elif w == "off"
                any_off = true
            end
        end
        var out = []
        for k: 0 .. slots - 1
            var name = k < size(names) ? names[k] : nil
            # spelled out: a ternary with a local in one branch and another ternary in the other answered the local's register (Berry 1.1)
            var lit = false
            if name == "heat"
                lit = any_on
            elif name == "off"
                lit = !any_on && any_off
            end
            out.push(["set", "$thermostat.modes." + str(k) + ".label", name != nil ? PanelThermostatView.MODES.find(name, name) : ""])
            out.push(["set", "$thermostat.modes." + str(k) + ".on", lit ? 1 : 0])
        end
        return out
    end

    # What the page says: its title, its buttons, its target, its lines of words and its modes. `looks` are the members' words in
    # the zone's rows (PanelUi.device_look), `drafts` the targets the finger set that the devices have not answered, and `lines` and
    # `slots` how many lines and modes the page has
    static def page(thermostat, store, view, members, looks, drafts, lines, slots)
        var out = [["set", "$thermostat.name", PanelThermostatView.title(store, view, members)],
                   ["set", "$thermostat.minus.icon", "minus"], ["set", "$thermostat.plus.icon", "add"]]
        for e: PanelThermostatView.target_effects(thermostat, members, drafts)  out.push(e) end
        var words = PanelThermostatView.lines(thermostat, members)
        for k: 0 .. lines - 1
            out.push(["set", "$thermostat.lines." + str(k), k < size(words) ? words[k] : ""])
        end
        for e: PanelThermostatView.modes(thermostat, members, looks, slots)  out.push(e) end
        return out
    end
end
