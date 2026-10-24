# panel_remote_view.be -- what a zone's + asks of a Zigbee device in a house of more than one bridge: Pair new device, or Existing device, which
# is a bridge of the house and a page of its devices, one a tap. A device taken is the panel's own configuration's, owned by that bridge (PanelStore.add_remote_device): its
# commands go over the mesh and its state comes the same way.
#
# A provider of views for PanelUi (panel_ui.be, `providers`), as PanelAddView is: it comes after PanelUi, whose rows it makes and whose stack it works on. The pages of devices are
# the house layer's (house_devices.be, `global.house.devices`): the one page on the glass and nothing of the rest, as the +'s list pages.
#
# In a house of one bridge, or with no mesh in the image, the + goes to the pairing as it did (PanelAddView.act): this screen is not there.
#
# PAIR NEW DEVICE ON A BRIDGE OF THE HOUSE: with more than one bridge to pair on, it asks which, this panel's favourite first
# (HouseMesh.favorite), and the search opens that bridge's network over the mesh; the device found is that bridge's (PanelUi.pair_place). With one, it is that one.
# EXISTING DEVICE asks the same way: with one bridge, its devices at once. With none, the + offers no Zigbee device (PanelUi.can_add_zigbee).

#@ solidify:PanelRemoteView
class PanelRemoteView
    static VIEWS = ["addZigbee", "addBridges", "addDevices", "addPairOn"]

    var ui

    def init(ui)
        self.ui = ui
    end

    def shows(kind) return PanelRemoteView.VIEWS.find(kind) != nil end

    # no row of Main settings is the +'s
    def hint(key) return nil end

    def acts(verb) return verb == "remote" end

    def opened(ui, view) end

    def header(ui) return [] end

    # --- what the house has ---------------------------------------------------------------------------------------------

    # the house layer of this panel, or nil where the image has none
    static def house()
        import global
        return global.contains("house") ? global.house : nil
    end


    # the bridges of the house whose devices this panel can take: all of them, not struck off (no bridge is the panel's own)
    static def others(house)
        var out = []
        for id: house.list.ids(false)
            if house.list.role(id) == HouseList.ROLE_BRIDGE  out.push(id) end
        end
        return out
    end

    # the bridges a new device may be paired on, the favourite first and then the rest by their numbers
    static def pair_bridges(house)
        var fav = house.favorite()
        var out = fav > 0 ? [fav] : []
        for id: house.list.ids(false)
            if id != fav && house.list.role(id) == HouseList.ROLE_BRIDGE  out.push(id) end
        end
        return out
    end

    # a bridge's name, as the house has it
    static def name_of(house, id)
        var s = house.list.label(id)
        return s != nil ? s : "Unknown bridge"
    end

    # whether a + has a choice to make: a house with a bridge that is not this panel's own
    static def offers()
        var h = PanelRemoteView.house()
        return h != nil && h.up && h.list.me >= 1 && size(PanelRemoteView.others(h)) > 0
    end

    # whether a bridge is heard on the mesh now, as a neighbour or two hops away (house_mesh.be, heard_by): alive, not suspect
    static def heard(id)
        var h = PanelRemoteView.house()
        if h == nil return false end
        var n = h.heard_by(id)
        return n != nil && n.find("state", 1) == 0
    end

    # --- the views --------------------------------------------------------------------------------------------------------

    # [title, header action, rows]
    def view(view, ed)
        var rows = []
        var zone = self.ui.store.find_zone(view[1])
        var title = zone != nil ? "Add to " + zone["name"] : "Add"
        var h = PanelRemoteView.house()
        if zone == nil || h == nil return [title, "", rows] end
        if view[0] == "addZigbee"
            rows.push(PanelUi.row(nil, "Pair new device", "", false, ["remote", "pair", view[1]], nil))
            rows.push(PanelUi.row(nil, "Existing device", "", false, ["remote", "existing", view[1]], nil))
            return [title, "", rows]
        end
        if view[0] == "addBridges"
            for id: PanelRemoteView.others(h)
                rows.push(PanelUi.row(nil, PanelRemoteView.name_of(h, id), PanelRemoteView.heard(id) ? "" : "No signal", false, ["remote", "bridge", view[1], id], nil))
            end
            return ["Bridge", "", rows]
        end
        if view[0] == "addPairOn"
            # where the new device is paired: a bridge heard on the mesh, the favourite first and said so
            var fav = h.favorite()
            for id: PanelRemoteView.pair_bridges(h)
                var on = PanelRemoteView.heard(id)
                rows.push(PanelUi.row(nil, PanelRemoteView.name_of(h, id), !on ? "No signal" : id == fav ? "Favorite" : "", false, on ? ["remote", "pair", view[1], id] : nil, nil))
            end
            return ["Pair on", "", rows]
        end
        # addDevices: the page of the bridge's devices
        var owner = view[2]
        var cur = h.devices.current()
        if cur == nil || cur[2] == nil
            rows.push(PanelUi.row(nil, "Asking the bridge", "", false, nil, nil))
            return ["Devices", "", rows]
        end
        var items = cur[0]
        var first = cur[1]
        var total = cur[2]
        if total == 0
            rows.push(PanelUi.row(nil, "No devices", "", false, nil, nil))
            return ["Devices", "", rows]
        end
        var i = 0
        for it: items
            var kind = PanelStore.config_profile(it[2])
            var have = self.ui.store.find_device(it[0]) != nil
            var label = it[3] != "" ? it[3] : (it[1] != "" ? it[1] : it[0])
            var hint = have ? "Added" : (kind == nil ? "Not supported" : PanelUi.capital(kind[0]))
            rows.push(PanelUi.row(nil, label, hint, false, have || kind == nil ? nil : ["remote", "device", view[1], owner, i], nil))
            i += 1
        end
        if size(items) < HouseDevices.PAGE && first + size(items) < total
            rows.push(PanelUi.row(nil, "Asking the bridge", "", false, nil, nil))
        end
        if first > 0 rows.push(PanelUi.row(nil, "Previous", "", false, ["remote", "page", view[1], owner, first - HouseDevices.PAGE], nil)) end
        if first + HouseDevices.PAGE < total rows.push(PanelUi.row(nil, "Next", "", false, ["remote", "page", view[1], owner, first + HouseDevices.PAGE], nil)) end
        return ["Devices", "", rows]
    end

    # --- a touch -----------------------------------------------------------------------------------------------------------

    # ["remote", "pair"|"existing"|"bridge"|"page"|"device", zone, ...]
    def act(ui, a)
        var what = a[1]
        var zone = a[2]
        var h = PanelRemoteView.house()
        if h == nil return what == "pair" ? ui.begin_pairing(zone, 0) : [] end
        if what == "pair"
            # on the bridge chosen, or on the only one there is; with more than one, the choice first
            if size(a) > 3 return ui.begin_pairing(zone, a[3]) end
            var on = PanelRemoteView.pair_bridges(h)
            if size(on) > 1
                ui.stack.remove(size(ui.stack) - 1)
                return ui.open(["addPairOn", zone])
            end
            return ui.begin_pairing(zone, size(on) == 1 ? on[0] : 0)
        end
        if what == "existing"
            ui.stack.remove(size(ui.stack) - 1)
            # with one bridge, its page of devices at once; with more, which bridge first
            var b = PanelRemoteView.others(h)
            if size(b) == 1
                h.devices.ask(b[0], 0)
                return ui.open(["addDevices", zone, b[0]])
            end
            return ui.open(["addBridges", zone])
        end
        if what == "bridge"
            h.devices.ask(a[3], 0)
            return ui.open(["addDevices", zone, a[3]])
        end
        if what == "page"
            h.devices.ask(a[3], a[4] < 0 ? 0 : a[4])
            return ui.show()
        end
        # a device of the page: the zone takes it, as its bridge's, and the screens go back to the zone's
        var cur = h.devices.current()
        if cur == nil || a[4] >= size(cur[0]) return [] end
        var r = ui.store.add_remote_device(zone, a[3], cur[0][a[4]])
        if !r["ok"] return [] end
        var out = [["save"]]
        ui.stack.remove(size(ui.stack) - 1)
        for e: ui.back() out.push(e) end
        return out
    end
end
