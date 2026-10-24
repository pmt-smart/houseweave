# panel_driver_view.be -- the driver of a switch of two channels, as the panel chooses it: a screen like the
# relay device's, with the device's Type and, under it, the Driver when the type takes one, and with a driver its Mode,
# Motor or Pulse, and its Sensor, a door sensor that says when it is closed. The tap on a switch found in the
# search opens it, and the device's options have the same rows. The driver lives on the bridge (zbdriver_twokey.be), which
# keeps its configuration: the panel keeps only what it moves, for the icon, and hears the rest in the driver's
# description, without which its rows do not open.
#
# A provider of views for PanelUi (panel_ui.be, `providers`): it comes after PanelUi, whose rows it makes. Choosing a driver
# joins the switch's channels in one device (PanelStore.join_channels) and assigns the bridge's driver; None splits them
# back and releases it.

#@ solidify:PanelDriverView
class PanelDriverView
    static VIEWS = ["driver", "driverApp", "driverMode", "driverSensor", "driverJoin"]
    # the driver's ID on the bridge
    static DRIVER = "twokey"
    # the applications as the rows say them, by PanelStore.APPS
    static APP_WORDS = ["Blind", "Window", "Gate", "Other"]
    static MODES = [["motor", "Motor"], ["pulse", "Pulse"]]
    # an assignment the bridge has not said back in this long is asked again, this many times at most
    static CONFIRM_MS = 3000
    static TRIES = 3

    var ui
    var desc     # IEEE -> what the driver's description said: {"app", "mode", "sensor"}
    var owed     # IEEE -> [the configuration asked, or nil for a release, the times asked again]

    def init(ui)
        self.ui = ui
        self.desc = {}
        self.owed = {}
    end

    # What is asked of the bridge is said back, or asked again. A command goes over the direct link and is not confirmed,
    # and a frame of it can be lost: a gate chosen on the glass that never reached the bridge would have its next link put
    # the window back. An assignment waits for the description the bridge sends after it; a release, which has none,
    # is sent once more, unless something was chosen after it
    def owe(id, cfg)
        # what is still owed of an assignment goes with the next, a mode chosen right after the application
        var o = self.owed.find(id)
        var c = {}
        if cfg != nil && o != nil && o[0] != nil
            for k: o[0].keys()  c[k] = o[0][k] end
        end
        if cfg != nil
            for k: cfg.keys()  c[k] = cfg[k] end
        end
        self.owed[id] = [cfg != nil ? c : nil, 0]
        tasmota.remove_timer("driver_owed_" + id)
        tasmota.set_timer(PanelDriverView.CONFIRM_MS, / -> self.overdue(id), "driver_owed_" + id)
    end

    def overdue(id)
        var o = self.owed.find(id)
        if o == nil return end
        var net = self.ui.network
        if o[0] == nil
            self.owed.remove(id)
            if net != nil  net.emit([["drive", id, "release"]]) end
            return
        end
        if o[1] >= PanelDriverView.TRIES
            self.owed.remove(id)
            log("DRIVER: the bridge never said back " + id + "'s driver; its next link says what it has", 2)
            return
        end
        o[1] += 1
        log("DRIVER: " + id + "'s driver asked of the bridge again, " + str(o[1]) + " of " + str(PanelDriverView.TRIES), 2)
        if net != nil  net.emit([["drive", id, "assign", o[0]]]) end
        tasmota.set_timer(PanelDriverView.CONFIRM_MS, / -> self.overdue(id), "driver_owed_" + id)
    end

    # whether a description says what was asked: each field asked, the driver's name aside
    static def says(cfg, d)
        for k: cfg.keys()
            if k != "drv" && str(d.find(k, "")) != str(cfg[k]) return false end
        end
        return true
    end

    def shows(kind) return PanelDriverView.VIEWS.find(kind) != nil end
    def hint(key) return nil end

    # A driver's description, as the bridge says it with every link (PanelZigbee.on_driver): the ones of this driver are kept
    def described(id, d)
        if !isinstance(d, map) || d.find("drv") != PanelDriverView.DRIVER return end
        self.desc[id] = {"app": d.find("app", "blind"), "mode": d.find("mode", "motor"), "sensor": d.find("sensor", "")}
        # what was asked, said back: nothing to ask again
        var o = self.owed.find(id)
        if o != nil && o[0] != nil && PanelDriverView.says(o[0], d)
            self.owed.remove(id)
            tasmota.remove_timer("driver_owed_" + id)
        end
    end

    # whether a device takes a driver: a switch of two channels or more, or one joined already
    def takes(id)
        var store = self.ui.store
        var d = store.find_device(id)
        if d == nil || PanelStore.is_relay_id(id) return false end
        return (d[2] == "switch" && size(store.channels_of(id)) > 1) || (d[2] == "cover" && self.desc.contains(id))
    end

    # whether one has the driver: joined, by what the panel keeps; whether it is known comes with the bridge's description
    def driven(id)
        var d = self.ui.store.find_device(id)
        return d != nil && d[2] == "cover" && self.desc.contains(id)
    end

    static def app_word(i) return i >= 0 && i < size(PanelDriverView.APP_WORDS) ? PanelDriverView.APP_WORDS[i] : "Blind" end

    # The Driver row of a device's options, or nil for one that takes none
    def row(id, ed)
        if !self.takes(id) return nil end
        var d = self.ui.store.find_device(id)
        return PanelUi.row(nil, "Driver", d[2] == "cover" ? PanelDriverView.app_word(d[5]) : "None", false, ed ? ["open", "driver", id] : nil, nil)
    end

    # the name of a device, or "None"
    def name_of(id)
        var d = id != "" ? self.ui.store.find_device(id) : nil
        return d != nil ? d[1] : "None"
    end

    def view(view, ed)
        var store = self.ui.store
        var id = view[1]
        var d = store.find_device(id)
        if d == nil return ["Driver", "", []] end
        var rows = []
        var c = self.desc.find(id)
        if view[0] == "driver"
            var joined = d[2] == "cover"
            if !joined  rows.push(PanelUi.row(nil, "Type", PanelUi.capital(PanelStore.KIND_NAME.find(d[2], d[2])), false, ed ? ["open", "type", id] : nil, nil)) end
            # a switch's own type takes the driver: a switch; one turned into a light keeps its channels as lamps
            if joined || d[2] == "switch"
                var can = ed && (!joined || c != nil)
                rows.push(PanelUi.row(nil, "Driver", joined ? PanelDriverView.app_word(d[5]) : "None", false, can ? ["open", "driverApp", id] : nil, nil))
            end
            if joined
                var on = ed && c != nil
                var mode = c != nil ? c["mode"] : ""
                rows.push(PanelUi.row(nil, "Mode", mode == "pulse" ? "Pulse" : mode == "motor" ? "Motor" : "", false, on ? ["open", "driverMode", id] : nil, nil))
                rows.push(PanelUi.row(nil, "Sensor", c != nil ? self.name_of(c["sensor"]) : "", false, on ? ["open", "driverSensor", id] : nil, nil))
            end
            return [d[1], "confirm", rows]
        end
        if view[0] == "driverApp"
            var at = d[2] == "cover" ? d[5] : -1
            rows.push(PanelUi.row(PanelUi.chosen(at < 0), "None", "", false, at < 0 ? nil : ["driver", "release", id], nil))
            for i: 0 .. size(PanelStore.APPS) - 1
                rows.push(PanelUi.row(PanelUi.chosen(at == i), PanelDriverView.APP_WORDS[i], "", false, at == i ? nil : ["driver", "app", id, PanelStore.APPS[i]], nil))
            end
            return ["Driver", "", rows]
        end
        if view[0] == "driverMode"
            for m: PanelDriverView.MODES
                var on = c != nil && c["mode"] == m[0]
                rows.push(PanelUi.row(PanelUi.chosen(on), m[1], "", false, on ? nil : ["driver", "mode", id, m[0]], nil))
            end
            return ["Mode", "", rows]
        end
        if view[0] == "driverSensor"
            var s = c != nil ? c["sensor"] : ""
            rows.push(PanelUi.row(PanelUi.chosen(s == ""), "None", "", false, s == "" ? nil : ["driver", "sensor", id, ""], nil))
            for x: store.doc["devices"]
                if x[2] != "sensor" continue end
                rows.push(PanelUi.row(PanelUi.chosen(s == x[0]), x[1], "", false, s == x[0] ? nil : ["driver", "sensor", id, x[0]], nil))
            end
            return ["Sensor", "", rows]
        end
        # the confirmation of a join that takes a channel out of its zone
        var other = nil
        for x: store.channels_of(id)
            if x != id && store.zone_of(x) != nil  other = x end
        end
        var z = other != nil ? store.zone_of(other) : nil
        rows.push(PanelUi.row(nil, "Join", z != nil ? store.find_device(other)[1] + " leaves " + z["name"] : "", false, ["driver", "join", id, view[2]], nil))
        rows.push(PanelUi.row(nil, "Cancel", "", false, ["driver", "cancel"], nil))
        return ["Join channels?", "", rows]
    end

    def opened(ui, view) end
    def acts(verb) return verb == "driver" end

    # the check of the driver's screen: back where it was opened from, the search or the options
    def header(ui)
        var top = ui.top()["view"]
        return top[0] == "driver" ? ui.back() : []
    end

    # back on the driver's screen from a list of it, the confirmation's two views as one
    static def back_to_driver(ui, out)
        while size(ui.stack) > 1 && ui.top()["view"][0] != "driver"  ui.stack.remove(size(ui.stack) - 1) end
        for e: ui.show() out.push(e) end
        return out
    end

    # A choice: an application, which joins the channels and assigns the bridge's driver, once a channel in a zone is
    # confirmed to leave it; None, which splits them back and gives the driver back; a mode, or a sensor, which the driver's
    # configuration takes. The panel shows what it asked, until the description says it
    def act(ui, a)
        var verb = a[1]
        var store = ui.store
        if verb == "cancel" return ui.back() end
        var id = a[2]
        var out = [["save"]]
        if verb == "app" || verb == "join"
            var d = store.find_device(id)
            if d == nil return [] end
            if d[2] != "cover" && verb == "app"
                for x: store.channels_of(id)
                    if x != id && store.zone_of(x) != nil return ui.open(["driverJoin", id, a[3]]) end
                end
            end
            var was = self.desc.find(id, {"mode": "motor", "sensor": ""})
            if !store.join_channels(id, a[3])["ok"] return [] end
            self.desc[id] = {"app": a[3], "mode": was["mode"], "sensor": was["sensor"]}
            var asked = {"drv": PanelDriverView.DRIVER, "app": a[3], "mode": was["mode"], "sensor": was["sensor"]}
            out.push(["drive", id, "assign", asked])
            self.owe(id, asked)
            return PanelDriverView.back_to_driver(ui, out)
        end
        if verb == "release"
            if !store.split_channels(id)["ok"] return [] end
            self.desc.remove(id)
            out.push(["drive", id, "release"])
            self.owe(id, nil)
            return PanelDriverView.back_to_driver(ui, out)
        end
        var c = self.desc.find(id)
        if c == nil return [] end
        var key = verb == "mode" ? "mode" : "sensor"
        c[key] = a[3]
        var cfg = {}
        cfg[key] = a[3]
        self.owe(id, cfg)
        return PanelDriverView.back_to_driver(ui, [["drive", id, "assign", cfg]])
    end
end
