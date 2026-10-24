# berry/panel_driver_view.be: the driver of a switch of two channels as the panel chooses it. The tap on the
# switch found in the search opens its screen, the Type and the Driver; an application joins the channels, once the
# one in a zone is confirmed to leave it, and assigns the bridge's driver; the description keeps what it moves, and a
# blind's ventilation; Mode and Sensor go to the driver's configuration; without the description the rows do not open;
# None splits the channels back. Each part is a function, as a script's top level holds 256 constants at most.

import json

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if json.dump(got) != json.dump(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + json.dump(got))
        print("  want " + json.dump(want))
    end
end

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

var living_room_text = read_text("berry/test/fixtures/living-room.json")
var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard"},
             "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5}

class FakePlan
    var live
    def init() self.live = {} end
    def on_report(id, state) self.live[id] = state end
    def on_color(id, c) end
    def on_answered(id) return true end
end

var SW = "0x00124B0000AB0001"
var DOOR = "0x00124B0000AB0009"

def fixture()
    var f = {}
    f["store"] = PanelStore(json.load(living_room_text))
    var ui = PanelUi(f["store"], shape, / -> [], nil)
    f["ui"] = ui
    ui.providers.push(PanelAddView(ui))
    f["dv"] = PanelDriverView(ui)
    ui.providers.push(f["dv"])
    ui.now_fn = / -> 0
    ui.prefs["editing"] = true
    f["plan"] = FakePlan()
    ui.live = f["plan"].live
    f["effects"] = []
    var fx = f["effects"]
    f["zb"] = PanelZigbee(f["store"], ui, f["plan"], def (e) for x: e fx.push(x) end end, def (c) end)
    ui.open_card("z:hall", "home")
    ui.action()
    ui.list_row(0, 0, false)
    f["zb"].on_event({"ZbState": {"Status": 30, "IEEEAddr": SW, "ShortAddr": "0x5A01", "PowerSource": true, "ReceiveWhenIdle": true, "Security": false}})
    f["zb"].on_event({"ZbState": {"Status": 33, "Device": "0x5A01", "Endpoint": "0x01", "ProfileId": "0x0104", "DeviceId": "0x0100", "InClusters": ["0x0006"]}})
    f["zb"].on_event({"ZbState": {"Status": 33, "Device": "0x5A01", "Endpoint": "0x02", "ProfileId": "0x0104", "DeviceId": "0x0100", "InClusters": ["0x0006"]}})
    return f
end

def rows(ui)
    var out = []
    for r: ui.list_view(ui.top()["view"])[2]  out.push([r[2], r[3], r[5]]) end
    return out
end

def drives(effects)
    var out = []
    for e: effects
        if e[0] == "drive" out.push(e) end
    end
    return out
end

def join_checks()
    var f = fixture()
    var ui = f["ui"]
    var store = f["store"]
    check("the switch found opens its driver's screen", ui.found_tap(SW + "/2"), ["open", "driver", SW])
    var found = rows(ui)
    check("and says so in both its channels' rows: No driver", [found[0][0], found[0][1], found[1][0], found[1][1]],
          ["Switch 1", "No driver", "Switch 2", "No driver"])
    ui.pair_model(SW, "TS0002")
    check("its model, said after the second channel came, is both channels'", [store.find_device(SW)[6], store.find_device(SW + "/2")[6]], ["TS0002", "TS0002"])
    ui.act(ui.found_tap(SW))
    check("its screen: the Type and the Driver, none", [ui.list_view(ui.top()["view"])[0], rows(ui)],
          ["Switch 1", [["Type", "Switch", ["open", "type", SW]], ["Driver", "None", ["open", "driverApp", SW]]]])
    ui.act(["open", "driverApp", SW])
    check("the applications, and None chosen", rows(ui), [["None", "", nil], ["Blind", "", ["driver", "app", SW, "blind"]],
          ["Window", "", ["driver", "app", SW, "window"]], ["Gate", "", ["driver", "app", SW, "gate"]], ["Other", "", ["driver", "app", SW, "other"]]])
    ui.act(["driver", "app", SW, "window"])
    check("its second channel in the Hall: asked first", [ui.top()["view"], rows(ui)[0]], [["driverJoin", SW, "window"], ["Join", "Switch 2 leaves Hall", ["driver", "join", SW, "window"]]])
    f["effects"].clear()
    var out = ui.act(["driver", "join", SW, "window"])
    var d = store.find_device(SW)
    check("joined: one device, a blind that is a window, the second channel gone", [d[2], d[3], d[5], store.find_device(SW + "/2"), store.zone_of(SW)["id"]],
          ["cover", 64, 1, nil, "hall"])
    check("its icon is a window's, in a row and on the plan's glyph table", [ui.device_look(SW)[1], PanelStore.look_of(d)], ["windowOff", "window"])
    # its group, on the zone's counter and on its card, by the look its devices share: the window's, and the blind's beside a blind
    var counter = nil
    for e: ui.render_zone({"view": ["zone", "hall"], "page": 0})
        if e[0] == "set" && (e[2] == "windowOff" || e[2] == "coverOff") counter = e[2] end
    end
    check("the Hall's counter of blinds has the window's icon, its one blind a window", counter, "windowOff")
    var BLIND = "0x00124B0000AB0002"
    store.register_device([BLIND, "Blind 1", "cover", 64, 0, 0, "", 1, 0, 0])
    check("a group of windows is drawn as one, and beside a blind as the blinds", [store.group_look([SW], "cover"), store.group_look([SW, BLIND], "cover"), store.group_look([], "cover")],
          ["window", "cover", "cover"])
    var style = {"glyphs": {"cover": ["c0", "c1", "c2", "c3"], "window": ["w0", "w1", "w2", "w3"], "light": ["l0", "l1", "l2", "l3"]},
                 "colors": {"iconOn": 1, "iconOff": 2, "pending": 3}}
    var plan = {"live": {}, "relayOn": [true, true]}
    check("and so on the plan's card", [PanelDraw.group_icon(store, [SW], "cover", plan, style, false)[0][0], PanelDraw.group_icon(store, [SW, BLIND], "cover", plan, style, false)[0][0]],
          ["w", "c"])
    store.remove_device(BLIND)
    check("the bridge's driver assigned it, by a motor and no sensor until told otherwise", drives(out),
          [["drive", SW, "assign", {"drv": "twokey", "app": "window", "mode": "motor", "sensor": ""}]])
    check("back on its screen: the Driver, the Mode and the Sensor", [ui.top()["view"], rows(ui)],
          [["driver", SW], [["Driver", "Window", ["open", "driverApp", SW]], ["Mode", "Motor", ["open", "driverMode", SW]], ["Sensor", "None", ["open", "driverSensor", SW]]]])
    # what the bridge says: a gate, on a pulse
    store.find_device(SW)[4] = 30
    f["zb"].on_event({"ZbDriver": {SW: {"d": {"caps": 64, "ep": 1, "app": "gate", "mode": "pulse", "sensor": "", "kind": "cover", "drv": "twokey", "model": "TS0002"}}}})
    check("its description: what it moves from the bridge, and the blind's ventilation kept", [store.find_device(SW)[5], store.find_device(SW)[4], rows(ui)[1][1]],
          [2, 30, "Pulse"])
    out = ui.act(["driver", "mode", SW, "motor"])
    check("a mode: to the driver's configuration", drives(out), [["drive", SW, "assign", {"mode": "motor"}]])
    store.register_device([DOOR, "Sensor 1", "sensor", 0, 0, 0, "TS0203", 1, 0, 0])
    ui.act(["open", "driverSensor", SW])
    check("the sensors to choose from", rows(ui), [["None", "", nil], ["Sensor 1", "", ["driver", "sensor", SW, DOOR]]])
    out = ui.act(["driver", "sensor", SW, DOOR])
    check("one chosen: to the driver, and the screen says it", [drives(out), rows(ui)[2][1]], [[["drive", SW, "assign", {"sensor": DOOR}]], "Sensor 1"])
    ui.open(["deviceOptions", SW])
    var opt = nil
    for r: rows(ui)
        if r[0] == "Driver" opt = r end
    end
    check("the device's options have its Driver, under the Type", opt, ["Driver", "Gate", ["open", "driver", SW]])
    # with no word of the bridge yet, as after a boot with the link down: its rows say what the panel keeps, and do not open
    var fresh = PanelDriverView(ui)
    ui.providers.remove(ui.providers.find(f["dv"]))
    ui.providers.push(fresh)
    ui.open(["driver", SW])
    check("with no description: the Driver says the gate, and nothing opens", rows(ui),
          [["Driver", "Gate", nil], ["Mode", "", nil], ["Sensor", "", nil]])
    ui.providers.remove(ui.providers.find(fresh))
    ui.providers.push(f["dv"])
    ui.open(["driver", SW])
    out = ui.act(["driver", "release", SW])
    d = store.find_device(SW)
    check("None: a switch again, its second channel back in the Hall, the driver given back",
          [d[2], d[3], store.find_device(SW + "/2") != nil, store.zone_of(SW + "/2")["id"], drives(out)], ["switch", 1, true, "hall", [["drive", SW, "release"]]])
    var c = []
    var cmds = PanelPlanCommands(def (x) c.push(x) end, nil)
    cmds.drive(SW, "assign", nil, {"drv": "twokey"})
    check("a driver assigned, as the bridge takes it", c, ['ZbRelayDrive {"id":"' + SW + '","do":"assign","v":{"drv":"twokey"}}'])
end

# What is asked of the bridge is said back, or asked again (a gate chosen on the glass that never reached the bridge would
# have its next link put the window back): an assignment waits for the description, and a release is sent once more
def owed_checks()
    var f = fixture()
    var ui = f["ui"]
    var dv = f["dv"]
    ui.network = f["zb"]
    tasmota.timers = []
    ui.act(["driver", "join", SW, "window"])
    check("an assignment waits to be said back", [dv.owed.contains(SW), size(tasmota.timers)], [true, 1])
    f["effects"].clear()
    tasmota.timers[-1][1]()
    var again = drives(f["effects"])
    check("not said back in time: asked again", size(again) == 1 ? [again[0][1], again[0][2], again[0][3]["drv"], again[0][3]["app"], again[0][3]["mode"]] : again,
          [SW, "assign", "twokey", "window", "motor"])
    # the bridge's link puts what it had before it took the new: still owed
    f["zb"].on_event({"ZbDriver": {SW: {"d": {"caps": 64, "ep": 1, "app": "blind", "mode": "motor", "sensor": "", "kind": "cover", "drv": "twokey"}}}})
    check("a description of something else does not pay it", dv.owed.contains(SW), true)
    f["zb"].on_event({"ZbDriver": {SW: {"d": {"caps": 64, "ep": 1, "app": "window", "mode": "motor", "sensor": "", "kind": "cover", "drv": "twokey"}}}})
    check("said back: nothing owed, and the window kept", [dv.owed.contains(SW), ui.store.find_device(SW)[5]], [false, 1])
    # a gate, then its mode right after: asked together until the bridge says both
    ui.act(["driver", "app", SW, "gate"])
    ui.act(["driver", "mode", SW, "pulse"])
    var o = dv.owed[SW][0]
    check("a mode right after the application: owed with it", [o["drv"], o["app"], o["mode"], o["sensor"]], ["twokey", "gate", "pulse", ""])
    for i: 1 .. PanelDriverView.TRIES  tasmota.timers[-1][1]() end
    check("asked again three times", dv.owed[SW][1], PanelDriverView.TRIES)
    tasmota.timers[-1][1]()
    check("and then let go, for the next link to say what the bridge has", dv.owed.contains(SW), false)
    # a release, which nothing says back: once more
    ui.open(["driver", SW])
    ui.act(["driver", "release", SW])
    f["effects"].clear()
    tasmota.timers[-1][1]()
    check("a release sent once more, and nothing owed after it", [drives(f["effects"]), dv.owed.contains(SW)], [[["drive", SW, "release"]], false])
    tasmota.timers = nil
end

join_checks()
owed_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
