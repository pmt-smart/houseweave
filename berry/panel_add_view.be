# panel_add_view.be -- what a zone's + adds: its first screen asks for a Zigbee device or a relay
# device, and shows only the one the panel can add now; a Zigbee device is the search, which starts as its screen
# opens (PanelUi.begin_pairing); a relay device is born on a relay, of the kind chosen, a Light, a Switch or Other.
#
# A provider of views for PanelUi (panel_ui.be, `providers`), as the clock's and the Tap's are: it comes after PanelUi,
# whose rows it makes and whose stack it works on, and keeps the relay device being made until its check.

#@ solidify:PanelAddView
class PanelAddView
    static VIEWS = ["add", "addRelay", "addRelayPick", "addKind"]
    # a relay device's kinds as its Type says them
    static KINDS = [["light", "Light"], ["switch", "Switch"], ["generic", "Other"]]

    var ui
    var draft      # the relay device being made: {"zone", "relay", "kind"}, or nil

    def init(ui)
        self.ui = ui
    end

    def shows(kind) return PanelAddView.VIEWS.find(kind) != nil end

    # no row of Main settings is the +'s
    def hint(key) return nil end

    static def kind_word(kind)
        for k: PanelAddView.KINDS
            if k[0] == kind return k[1] end
        end
        return PanelUi.capital(kind)
    end

    # The relay a new relay device takes: one that already switches relay devices, or else the first that powers no
    # Zigbee device; 0 for none
    def first_relay()
        var store = self.ui.store
        for n: [1, 2]
            if store.relay_switches(n) return n end
        end
        for n: [1, 2]
            if !store.relay_powers(n) return n end
        end
        return 0
    end

    # The +'s screens: [title, header action, rows]
    def view(view, ed)
        var store = self.ui.store
        var zone = store.find_zone(view[1])
        if zone == nil return ["Add", "", []] end
        var id = zone["id"]
        var title = "Add to " + zone["name"]
        var rows = []
        if view[0] == "add"
            # a row the panel cannot add now is not there: Zigbee off or no link, or both relays feeding Zigbee
            if self.ui.can_add_zigbee() rows.push(PanelUi.row(nil, "Zigbee device", "", false, ["add", "zigbee", id], nil)) end
            if self.ui.can_add_relay() rows.push(PanelUi.row(nil, "Relay device", "", false, ["add", "relay", id], nil)) end
            return [title, "", rows]
        end
        var d = self.draft
        if d == nil || d["zone"] != id return [title, "", rows] end
        if view[0] == "addRelay"
            rows.push(PanelUi.row(nil, "Relay", "Relay " + str(d["relay"]), false, ["open", "addRelayPick", id], nil))
            rows.push(PanelUi.row(nil, "Type", PanelAddView.kind_word(d["kind"]), false, ["open", "addKind", id], nil))
            return [title, "confirm", rows]
        end
        if view[0] == "addRelayPick"
            for n: [1, 2]
                var on = d["relay"] == n
                # one that powers Zigbee devices takes no relay device
                var can = !store.relay_powers(n)
                rows.push(PanelUi.row(PanelUi.chosen(on), "Relay " + str(n), can ? "" : "Zigbee only", false, can && !on ? ["add", "pick", n] : nil, nil))
            end
            return ["Relay", "", rows]
        end
        for k: PanelAddView.KINDS
            var on = d["kind"] == k[0]
            rows.push(PanelUi.row(PanelUi.chosen(on), k[1], "", false, on ? nil : ["add", "kind", k[0]], nil))
        end
        return ["Type", "", rows]
    end

    def opened(ui, view) end

    def acts(verb) return verb == "add" end

    # The check of the relay device's screen: the device, on its relay and of its kind, in the zone's next place, and back
    # to the zone. The first screen has none
    def header(ui)
        var top = ui.top()["view"]
        var d = self.draft
        if top[0] != "addRelay" || d == nil return [] end
        var r = ui.store.add_relay_device(d["zone"], d["relay"], d["kind"])
        if !r["ok"] return [] end
        self.draft = nil
        var out = [["save"]]
        for e: ui.back() out.push(e) end
        return out
    end

    # A touch: the first screen's choice, in its place; or a relay or a kind chosen, back on the relay device's screen
    def act(ui, a)
        var verb = a[1]
        if verb == "zigbee"
            # in a house with another bridge the + asks Pair new device or Existing device (panel_remote_view.be); with none, it is the pairing
            import global
            if global.contains("PanelRemoteView") && global.PanelRemoteView.offers()
                ui.stack.remove(size(ui.stack) - 1)
                return ui.open(["addZigbee", a[2]])
            end
            return ui.begin_pairing(a[2])
        end
        if verb == "relay"
            self.draft = {"zone": a[2], "relay": self.first_relay(), "kind": "light"}
            ui.stack.remove(size(ui.stack) - 1)
            return ui.open(["addRelay", a[2]])
        end
        if self.draft == nil return [] end
        if verb == "pick" self.draft["relay"] = a[2] end
        if verb == "kind" self.draft["kind"] = a[2] end
        return ui.back()
    end
end
