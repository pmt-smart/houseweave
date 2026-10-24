# panel_tap_view.be -- what a tap on a zone's card turns on: the zone's Tap, chosen on a screen of the
# list's that its options' Tap row and its group's page's Settings open. Auto, today's rule, is the default;
# All, a Group of the zone's or one Device of it are the others, and the physical buttons follow the choice of
# each zone they are marked in. A hold on each choice opens the Help that says what it does.
#
# A provider of views for PanelUi (panel_ui.be, `providers`), as the clock's and the schedule's are: it comes after
# PanelUi, whose rows and words it uses. The store keeps the choice and runs it (PanelStore.tap_of, tap_part).

#@ solidify:PanelTapView
class PanelTapView
    static VIEWS = ["tap", "tapGroup", "tapDevice"]
    # what each choice does, said on the Help page by a hold on its row: a paragraph, which the panel breaks over the page's
    # lines, at the width of each panel
    static HELP = {
        "auto": ["Auto", "The house's rule: lights, plugs and switches toggle together, blinds only in a zone of blinds, and the heating only goes off."],
        "all": ["All", "Everything in the zone, together: on opens the blinds and turns the heating on, and off closes them and turns it off."],
        "group": ["Group", "Only one group of the zone, as its counters show. The others stay as they are."],
        "device": ["Device", "Only one device of the zone. The others stay as they are."]}

    var store

    def init(store)
        self.store = store
    end

    def shows(kind) return PanelTapView.VIEWS.find(kind) != nil end

    # no row of Main settings is the Tap's
    def hint(key) return nil end

    # a group as its row says it: the kind, and the relay that switches or powers it
    static def group_word(kind, relay)
        return PanelUi.capital(PanelUi.kind_words(kind)[1]) + (relay != 0 ? " · Relay " + str(relay) : "")
    end

    # A zone's Tap in a word, as its options' row says it: Auto, All, the group's or the device's name
    def word(zone)
        var t = self.store.tap_of(zone)
        if t[0] == "group" return PanelTapView.group_word(t[1], t[2]) end
        if t[0] == "device" return self.store.find_device(t[1])[1] end
        return PanelUi.capital(t[0])
    end

    # the hold on a choice's row: its Help
    static def help_of(key)
        var h = PanelTapView.HELP[key]
        return ["open", "helpText", h[0], h[1]]
    end

    # A choice's row: chosen or not, and the touch that chooses it, only with Editing on (as the other Settings);
    # the hold opens its Help
    static def choice(on, label, tap, key, ed)
        return PanelUi.row(PanelUi.chosen(on), label, "", false, ed && !on ? tap : nil, PanelTapView.help_of(key))
    end

    # The Tap and its two lists, a group's and a device's: [title, header action, rows]
    def view(view, ed)
        var zone = self.store.find_zone(view[1])
        if zone == nil return ["Card tap", "", []] end
        var id = zone["id"]
        var t = self.store.tap_of(zone)
        var groups = self.store.tap_groups(zone)
        var rows = []
        if view[0] == "tap"
            rows.push(PanelTapView.choice(t[0] == "auto", "Auto", ["tap", id, ["auto"]], "auto", ed))
            rows.push(PanelTapView.choice(t[0] == "all", "All", ["tap", id, ["all"]], "all", ed))
            # a group and a device open their lists, chosen or not, and say the one chosen. A zone of one group has it as
            # the whole zone, which All is
            if size(groups) > 1
                var g = t[0] == "group" ? PanelTapView.group_word(t[1], t[2]) : ""
                rows.push(PanelUi.row(PanelUi.chosen(t[0] == "group"), "Group", g, false, ed ? ["open", "tapGroup", id] : nil, PanelTapView.help_of("group")))
            end
            var d = t[0] == "device" ? self.store.find_device(t[1])[1] : ""
            rows.push(PanelUi.row(PanelUi.chosen(t[0] == "device"), "Device", d, false, ed ? ["open", "tapDevice", id] : nil, PanelTapView.help_of("device")))
            return ["Card tap", "", rows]
        end
        if view[0] == "tapGroup"
            for g: groups
                var on = t[0] == "group" && t[1] == g[0] && t[2] == g[1]
                rows.push(PanelUi.row(PanelUi.chosen(on), PanelTapView.group_word(g[0], g[1]), "", false, on ? nil : ["tap", id, ["group", g[0], g[1]]], nil))
            end
            return ["Group", "", rows]
        end
        for dev: PanelStore.member_ids(zone["members"])
            if !self.store.tap_reaches(dev) continue end
            var on = t[0] == "device" && t[1] == dev
            rows.push(PanelUi.row(PanelUi.chosen(on), self.store.find_device(dev)[1], "", false, on ? nil : ["tap", id, ["device", dev]], nil))
        end
        return ["Device", "", rows]
    end

    def opened(ui, view) end

    def acts(verb) return verb == "tap" end

    # its views have nothing in the header
    def header(ui) return [] end

    # A choice taken: ["tap", zone, choice]. The store keeps it, and the Tap's screen shows it, from a group's or a device's
    # list too
    def act(ui, a)
        var r = self.store.set_tap(a[1], a[2])
        if !r["ok"] return [] end
        var out = [["save"]]
        if ui.top()["view"][0] != "tap"
            for e: ui.back() out.push(e) end
            return out
        end
        for e: ui.show() out.push(e) end
        return out
    end
end
