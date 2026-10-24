# panel_cover_view.be -- a blind's own page: what it says of the blind, or of a zone's blinds that one relay feeds,
# made from what the bridge's driver said of them (PanelCover). A class of static helpers, as PanelThermostatView is: the page is a
# template of the .tft whose words the panel writes (`$cover.*`), and PanelUi, which has no constants left to spare, only dispatches
# to it. It comes before PanelUi, which names it, and so names no PanelUi.
#
# A page is about one blind, ["cover", "d", id], or about the blinds of one relay in a zone, ["cover", "t", zone, relay], which go
# together. On it: the position now, in big type, and what the blind is doing under it; the switch's three keys in a
# column, up, stop and down, as on the wall; the slider, the lists' own scrollbar, 100% at the top and 0% at the bottom in
# steps of 5, whose pointer is where the blind is and whose release sends it there; and the ventilation, a position almost closed
# that one touch sends it to.

#@ solidify:PanelCoverView
class PanelCoverView
    # a key's tone, and the accent of the key whose way the blind is going
    static TONE = "text-primary"
    static GOING = "accent-blue"
    # the stop key's tone when no blind of the page has a stop
    static DIM = "icon-off"
    # the slider's step, in percent: 21 places, 0 at the top (open) and 20 at the bottom (closed)
    static STEP = 5
    # the ventilation a blind has until it is set: 15% open
    static VENT = 15

    # the blinds a view is about, as the store has them: one, or a zone's of one relay
    static def members(store, view)
        var out = []
        if view[1] == "d"
            var d = store.find_device(view[2])
            if d != nil && d[2] == "cover"  out.push(d) end
            return out
        end
        var zone = store.find_zone(view[2])
        if zone == nil return out end
        for id: PanelStore.member_ids(zone["members"])
            var d = store.find_device(id)
            if d != nil && d[2] == "cover" && d[9] == view[3]  out.push(d) end
        end
        return out
    end

    # the title: the blind's name, or the zone's and how many of them: "Living room · 2 blinds"
    static def title(store, view, members)
        if view[1] == "d" return members[0][1] end
        var zone = store.find_zone(view[2])
        var n = size(members)
        return (zone != nil ? zone["name"] : "") + " · " + str(n) + " " + (n == 1 ? "blind" : "blinds")
    end

    # where the blinds are: the mean of the positions they said, to the nearest whole; nil for none said
    static def position(cover, members)
        var sum = 0
        var n = 0
        for d: members
            var p = cover.get(d[0], "pos", nil)
            if p != nil
                sum += p
                n += 1
            end
        end
        return n > 0 ? (sum * 2 + n) / (2 * n) : nil
    end

    # the way the first of them that moves goes, "up" or "down", or nil when they stand
    static def going(cover, members)
        for d: members
            var m = cover.get(d[0], "mov", "stop")
            if m == "up" || m == "down" return m end
        end
        return nil
    end

    # the ventilation of these blinds: the first one's, set in its settings, or the start. It is kept in the device's record,
    # in the field a thermostat keeps its target's lowest in, which a blind has no other use for
    static def ventilation(members)
        if size(members) == 0 || members[0][4] <= 0 || members[0][4] >= 100 return PanelCoverView.VENT end
        return members[0][4]
    end

    # what the blinds are doing, in a word, under the position
    static def state(pos, way)
        if way == "up" return "Opening" end
        if way == "down" return "Closing" end
        if pos == nil return "" end
        if pos >= 100 return "Open" end
        if pos <= 0 return "Closed" end
        return "Stopped"
    end

    # the slider's place of a position, the nearest step: 100% is 0, at the top
    static def place(pos)
        return (100 - pos + PanelCoverView.STEP / 2) / PanelCoverView.STEP
    end

    # the position of a slider's place, 0 to 100
    static def position_of(place)
        var p = 100 - place * PanelCoverView.STEP
        return p < 0 ? 0 : (p > 100 ? 100 : p)
    end

    # the ones of these blinds that have a stop, as their drivers say: a gate of two keys has none, and refuses one. A
    # page of a gate alone has none, and its stop key is dim and does nothing; a page of several sends its stop to the ones that have it
    static def stoppable(cover, ids)
        var out = []
        for id: ids
            if !cover.nostop.contains(id)  out.push(id) end
        end
        return out
    end

    # the verb of a key, by its counter's subject: "$cover.up.count" opens
    static def key(subject)
        if subject == "$cover.up.count" return "open" end
        if subject == "$cover.stop.count" return "stop" end
        if subject == "$cover.down.count" return "close" end
        return nil
    end

    # What the page says: its title, the position and what the blinds are doing, the keys with the one of the way they go lit, the
    # slider where they are, and the ventilation, lit when they are there
    static def page(cover, store, view, members)
        var pos = PanelCoverView.position(cover, members)
        var way = PanelCoverView.going(cover, members)
        var vent = PanelCoverView.ventilation(members)
        var ids = []
        for d: members  ids.push(d[0]) end
        var out = [["set", "$cover.name", PanelCoverView.title(store, view, members)],
                   ["set", "$cover.position", pos != nil ? str(pos) + "%" : "--"],
                   ["set", "$cover.state", PanelCoverView.state(pos, way)],
                   ["set", "$cover.up.icon", "coverUp"], ["set", "$cover.stop.icon", "coverStop"], ["set", "$cover.down.icon", "coverDown"],
                   ["set", "$cover.up.iconColor", way == "up" ? PanelCoverView.GOING : PanelCoverView.TONE],
                   ["set", "$cover.stop.iconColor", size(PanelCoverView.stoppable(cover, ids)) > 0 ? PanelCoverView.TONE : PanelCoverView.DIM],
                   ["set", "$cover.down.iconColor", way == "down" ? PanelCoverView.GOING : PanelCoverView.TONE],
                   ["set", "$cover.vent.label", "Ventilation " + str(vent) + "%"],
                   ["set", "$cover.vent.on", pos == vent && way == nil ? 1 : 0]]
        if pos != nil  out.push(["set", "$cover.page", PanelCoverView.place(pos)]) end
        return out
    end
end
