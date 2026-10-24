# panel_page_buttons.be -- the row of buttons under the title of a page of advanced options: a lamp's
# detail, a thermostat's page and a blind's, of one device or of a zone's group. On the left, icons: Identify, an
# exclamation, for the kinds that blink; Settings, a cog, on a device's page, and on a group's,
# where it opens what a tap on the zone's card turns on; and Schedule, for the
# kinds the schedule runs, lit while it is on. On the right, the card's name in words, which opens the zone's
# screen. Each page has the icons' places it can use, and the runtime puts the icons it has against the card and
# hides the rest. A class of static helpers, as the pages' views are: PanelUi, which has no constants left to spare,
# writes the row and dispatches its touches with it. It comes before PanelUi, which names it, and so names no PanelUi;
# the schedule it reaches through the ui's instance of PanelScheduleView, which comes after.

#@ solidify:PanelPageButtons
class PanelPageButtons
    # the icons' places of each page, as its template has them (layout/src/screenTemplates.ts): a lamp's three, a
    # thermostat's and a blind's two, which have no Identify
    static PLACES = {"$light": 3, "$thermostat": 2, "$cover": 2}
    # the kinds whose devices blink when asked to identify themselves: a thermostat's and a blind's Tuya switch
    # have no Identify, and a panel's relay would have to switch its load
    static BLINK = ["light", "plug", "switch", "fan", "generic"]
    # the kinds a device's page has settings for: the driver's of a thermostat and a blind, and a lamp's own
    static SETTINGS = ["thermostat", "cover", "light"]
    # an icon's colour, and the Schedule's while the schedule is on
    static TONE = "text-primary"
    static LIT = "accent-blue"

    # what a view is about: [kind, the device of a device's page or nil]
    static def subject(store, view)
        if view[1] == "d"
            var d = store.find_device(view[2])
            return d != nil ? [d[2], d[0]] : [nil, nil]
        end
        return [view[0] == "detail" ? view[3] : view[0], nil]
    end

    # the zone a view's card is: the device's, or the group's
    static def zone_of(store, view)
        return view[1] == "d" ? store.zone_of(view[2]) : store.find_zone(view[2])
    end

    # The icons of a page's row, in their order, which are their roles too: "identify", "settings" and "schedule". None
    # on a page that sets what an event does, which is the event's and not the device's
    static def icons(ui, view)
        var out = []
        if view[size(view) - 1] == "during" return out end
        var s = PanelPageButtons.subject(ui.store, view)
        if s[0] == nil return out end
        var device = s[1] != nil && !PanelStore.is_relay_id(s[1])
        if PanelPageButtons.BLINK.find(s[0]) != nil && (s[1] == nil || device) out.push("identify") end
        # a group's page has the Settings too: what a tap on its zone's card turns on
        if (device && PanelPageButtons.SETTINGS.find(s[0]) != nil) || s[1] == nil out.push("settings") end
        if ui.schedule != nil && ui.schedule.takes(s[0]) out.push("schedule") end
        return out
    end

    # The row on the page whose paths start with `page` ("$light", "$thermostat", "$cover"): the icons against the
    # card, the places before them hidden; the Schedule lit while a device of the page, `ids`, has an event and its
    # schedule on; and the card's name
    static def effects(ui, page, view, ids)
        var b = PanelPageButtons.icons(ui, view)
        var n = PanelPageButtons.PLACES[page]
        var first = n - size(b)
        var out = []
        for k: 0 .. n - 1
            var p = page + ".icons." + str(k)
            if k < first
                out.push(["set", p + ".shown", 0])
                continue
            end
            var w = b[k - first]
            out.push(["set", p + ".icon", w])
            out.push(["set", p + ".iconColor", w == "schedule" && ui.schedule.lit(ids) ? PanelPageButtons.LIT : PanelPageButtons.TONE])
            out.push(["set", p + ".shown", 1])
        end
        var zone = view[size(view) - 1] != "during" ? PanelPageButtons.zone_of(ui.store, view) : nil
        if zone == nil
            out.push(["set", page + ".card.shown", 0])
        else
            out.push(["set", page + ".card.label", zone["name"]])
            out.push(["set", page + ".card.shown", 1])
        end
        return out
    end

    # the row hidden, on a page that sets what an event does
    static def none(page)
        var out = []
        for k: 0 .. PanelPageButtons.PLACES[page] - 1  out.push(["set", page + ".icons." + str(k) + ".shown", 0]) end
        out.push(["set", page + ".card.shown", 0])
        return out
    end

    # What a touch on the row was, from its path: "$light.icons.2.count" is the icon of place 2, ["icon", 2], and
    # "$light.card.label" the card, ["card"]; any other path, nil
    static def touched(subject)
        import string
        var parts = string.split(subject, ".")
        if size(parts) == 4 && parts[1] == "icons" return ["icon", int(parts[2])] end
        if size(parts) == 3 && parts[1] == "card" return ["card"] end
        return nil
    end

    # the icon a place holds on the page `view` is of, or nil for a hidden one
    static def icon_at(ui, page, view, k)
        if !PanelPageButtons.PLACES.contains(page) return nil end
        var b = PanelPageButtons.icons(ui, view)
        var i = k - (PanelPageButtons.PLACES[page] - size(b))
        return i >= 0 && i < size(b) ? b[i] : nil
    end
end
