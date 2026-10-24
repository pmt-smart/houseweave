# berry/panel_tap_view.be and the Tap in panel_store.be: what a tap on a zone's card turns on. The zone's choice,
# kept and given back to Auto when its group or device leaves; the part of the zone a tap reaches, and its plan; All, which
# turns the blinds and the thermostats too; a button that follows the choice of its zones; a card's tap on the
# glass; and the screens, from the zone's options and the group's page's Settings, with the Help of each choice on a
# hold. Each part is a function, as a script's top level holds 256 constants at most.

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
var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard",
                       "thermostat": "thermostat", "cover": "cover"},
             "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5, "thermostatLines": 1, "thermostatModes": 2}

var BLIND = "0x00124B00000B0001"
var HEAT = "0x00124B00000B0002"
var PLUG = "0x00124B00000B0003"
# a lamp of the Corridor's, one the living_room() leaves there
var LAMP = "0x00124B0000C00002"

# the Living room, with three of the Corridor's lamps gone for a blind, a thermostat and a plug on its relay: four groups there
def living_room()
    var s = PanelStore(json.load(living_room_text))
    var c = s.find_zone("corridor")
    var ids = PanelStore.member_ids(c["members"])
    for i: 5 .. 7  s.remove_device(ids[i]) end
    s.register_device([BLIND, "Blind 1", "cover", 64, 0, 0, "", 1, 0, 0])
    s.register_device([HEAT, "Thermostat 1", "thermostat", 48, 50, 350, "", 1, 0, 0])
    s.register_device([PLUG, "Plug 1", "plug", 1, 0, 0, "", 1, 0, 2])
    s.add_to_zone("corridor", BLIND)
    s.add_to_zone("corridor", HEAT)
    s.add_to_zone("corridor", PLUG)
    return s
end

def store_checks()
    var s = living_room()
    var c = s.find_zone("corridor")
    var plug = PLUG
    var lamp = LAMP
    check("a zone's Tap is Auto when it has none, and the tap reaches the zone itself", [s.tap_of(c), s.tap_part(c) == c], [["auto"], true])
    var kinds = []
    for g: s.tap_groups(c) kinds.push([g[0], g[1]]) end
    check("the Corridor's groups, as its counters: lamps and the plug on relay 2, the blind and the thermostat", kinds,
          [["light", 2], ["cover", 0], ["thermostat", 0], ["plug", 2]])
    check("a group the zone has", s.set_tap("corridor", ["group", "plug", 2])["ok"], true)
    var part = s.tap_part(c)
    check("its part: the plug alone, and no zone group, as it is not all the zone's Zigbee", [PanelStore.member_ids(part["members"]), part["zid"]], [[plug], 0])
    check("a group it has not is refused", s.set_tap("corridor", ["group", "fan", 0])["refusal"], "tap_unknown")
    check("a device of another zone too", s.set_tap("corridor", ["device", PanelStore.member_ids(s.find_zone("middle")["members"])[0]])["refusal"], "tap_unknown")
    check("a sensor's or a remote's is no choice: what a tap does not reach", s.tap_reaches(BLIND) && s.tap_reaches(HEAT) && !s.tap_reaches("0xNONE"), true)
    s.set_kind(plug, "light")
    check("the plug a lamp again: its group gone, the Tap back to Auto", [s.tap_of(c), c.contains("tap")], [["auto"], false])
    s.set_tap("corridor", ["device", lamp])
    check("a device", [s.tap_of(c), PanelStore.member_ids(s.tap_part(c)["members"])], [["device", lamp], [lamp]])
    s.remove_device(PanelStore.member_ids(s.find_zone("middle")["members"])[0])
    s.move_to_zone(lamp, "middle")
    check("moved away, back to Auto", c.contains("tap"), false)
    s.set_tap("corridor", ["device", plug])
    var r = s.replace_device(plug, ["0x00124B0000C0FFEE", "", "light", 1, 0, 0, "", 1, 0, 0])
    check("replaced, the new one is the choice", [r["ok"], s.tap_of(c)], [true, ["device", "0x00124B0000C0FFEE"]])
    s.remove_device("0x00124B0000C0FFEE")
    check("removed, back to Auto", c.contains("tap"), false)
    s.set_tap("corridor", ["all"])
    check("All: the zone, marked", [s.tap_part(c)["all"], s.tap_part(c)["zid"]], [true, c["zid"]])
    check("and Auto again takes the field away", [s.set_tap("corridor", ["auto"])["ok"], c.contains("tap")], [true, false])
end

def plan_checks()
    var s = living_room()
    var c = s.find_zone("corridor")
    var lamp = LAMP
    var live = {}
    for id: PanelStore.member_ids(c["members"]) live[id] = "off" end
    var relay_on = [true, true]
    # Auto: the lamps and the plug, and neither the blind nor the thermostat on the way on
    var part = s.tap_part(c)
    var plan = s.plan([part], relay_on, nil)
    var tap = s.tap_intent([part], plan, live, relay_on, {}, {})
    check("Auto: on, by the zone's group, and no blind or thermostat", [tap[0], plan["zids"], plan.find("thermostat"), plan.find("cover")],
          ["on", [c["zid"]], nil, nil])
    # All: the blind opens and the heating goes on with them
    s.set_tap("corridor", ["all"])
    part = s.tap_part(c)
    plan = s.plan([part], relay_on, nil)
    tap = s.tap_intent([part], plan, live, relay_on, {}, {})
    check("All: on, the thermostat to heat and the blind open", [tap[0], plan["thermostat"], plan["cover"], tap[1].find(HEAT) != nil],
          ["on", [HEAT], [BLIND], true])
    live[BLIND] = "on"
    plan = s.plan([part], relay_on, nil)
    tap = s.tap_intent([part], plan, live, relay_on, {}, {})
    check("All with the blind open: off, which closes it", [tap[0], plan["cover"], plan.find("thermostat")], ["off", [BLIND], nil])
    # a device: that lamp alone, direct
    s.set_tap("corridor", ["device", lamp])
    part = s.tap_part(c)
    plan = s.plan([part], relay_on, nil)
    check("a device: that lamp alone, direct", [plan["zids"], plan["unicast"]], [[], [lamp]])
    # a group of thermostats: theirs, both ways, as a row's icon
    s.set_tap("corridor", ["group", "thermostat", 0])
    part = s.tap_part(c)
    plan = s.plan([part], relay_on, nil)
    tap = s.tap_intent([part], plan, live, relay_on, {}, {})
    check("the thermostats' group: on, as the zone of them alone", [tap[0], plan["thermostat"]], ["on", [HEAT]])
    # a group of blinds: their cycle
    s.set_tap("corridor", ["group", "cover", 0])
    check("the blinds' group: their cycle", s.blinds_only([s.tap_part(c)]), [BLIND])
end

def button_checks()
    var s = living_room()
    var c = s.find_zone("corridor")
    var lamp = LAMP
    s.sync_button_groups()
    var relay_on = [true, true]
    var whole = s.button_plan(2, relay_on)
    s.set_tap("corridor", ["device", lamp])
    var part = s.button_plan(2, relay_on)
    check("a button's zones as their Taps say: the Corridor's lamp alone, and no button group while a zone is a part",
          [part["unicast"].find(lamp) != nil, size(part["unicast"]) < size(whole["unicast"]) + 8, part["unicast"].find(PanelStore.member_ids(c["members"])[2]) == nil],
          [true, true, true])
    var middle = s.find_zone("middle")
    check("the other zones whole: the Middle by its group", part["zids"].find(middle["zid"]) != nil, true)
end

def commands_checks()
    var out = []
    var cmds = PanelPlanCommands(def (c) out.push(c) end, nil)
    cmds.run({"zids": [], "unicast": [], "relays": [], "skipped": [], "cover": [BLIND]}, "on")
    cmds.run({"zids": [], "unicast": [], "relays": [], "skipped": [], "cover": [BLIND]}, "off")
    check("All's blinds: open on, close off, to their driver", out,
          ['ZbRelayDrive {"id":"' + BLIND + '","do":"open"}', 'ZbRelayDrive {"id":"' + BLIND + '","do":"close"}'])
end

def view_checks()
    var s = living_room()
    var ui = PanelUi(s, shape, / -> [], nil)
    var tap = PanelTapView(s)
    ui.providers.push(tap)
    ui.prefs["editing"] = true
    var rows = def () var o = [] for r: ui.list_view(ui.top()["view"])[2] o.push([r[0], r[2], r[3], r[5]]) end return o end
    ui.open(["zoneOptions", "corridor"])
    var tr = nil
    for r: ui.list_view(ui.top()["view"])[2]
        if r[2] == "Tap" tr = [r[3], r[5]] end
    end
    check("the zone's options have the Tap, after the Color", tr, ["Auto", ["open", "tap", "corridor"]])
    ui.act(tr[1])
    check("its screen: Auto chosen, All, a Group and a Device to open", [ui.list_view(ui.top()["view"])[0], rows()],
          ["Card tap", [["dotOn", "Auto", "", nil], ["dotOff", "All", "", ["tap", "corridor", ["all"]]],
                        ["dotOff", "Group", "", ["open", "tapGroup", "corridor"]], ["dotOff", "Device", "", ["open", "tapDevice", "corridor"]]]])
    var hold = ui.list_view(ui.top()["view"])[2][0][6]
    check("a hold says what the choice does, a paragraph on the Help", [hold[0], hold[1], hold[2], hold[3][0 .. 16]], ["open", "helpText", "Auto", "The house's rule:"])
    var shown = ui.act(hold)
    var wrap = nil
    for e: shown
        if e[0] == "wrap" wrap = e end
    end
    check("which opens on the Help's page, the panel breaking it over its lines", [ui.top()["view"][0 .. 1], wrap != nil ? wrap[1] : nil], [["helpText", "Auto"], "$help.lines."])
    ui.back()
    var out = ui.act(["tap", "corridor", ["all"]])
    check("All chosen: saved, and the screen says it", [out[0], s.tap_of(s.find_zone("corridor")), rows()[1][0]], [["save"], ["all"], "dotOn"])
    ui.act(["open", "tapGroup", "corridor"])
    check("the groups, as the zone's counters", rows(), [["dotOff", "Lamps · Relay 2", "", ["tap", "corridor", ["group", "light", 2]]],
          ["dotOff", "Covers", "", ["tap", "corridor", ["group", "cover", 0]]], ["dotOff", "Thermostats", "", ["tap", "corridor", ["group", "thermostat", 0]]],
          ["dotOff", "Plugs · Relay 2", "", ["tap", "corridor", ["group", "plug", 2]]]])
    ui.act(["tap", "corridor", ["group", "light", 2]])
    check("a group chosen: back on the Tap, which names it", [ui.top()["view"], rows()[2][0], rows()[2][2]], [["tap", "corridor"], "dotOn", "Lamps · Relay 2"])
    ui.act(["open", "tapDevice", "corridor"])
    check("the devices a tap reaches, by name: its five lamps, the blind, the thermostat and the plug", size(rows()), 8)
    ui.act(["tap", "corridor", ["device", BLIND]])
    check("one chosen, and the zone's options say it", [rows()[3][2], tap.word(s.find_zone("corridor"))], ["Blind 1", "Blind 1"])
    ui.prefs["editing"] = false
    check("with Editing off it is only seen", [rows()[0][3], rows()[2][3], rows()[3][3]], [nil, nil, nil])
end

def page_checks()
    var s = PanelStore(json.load(living_room_text))
    var ui = PanelUi(s, shape, / -> [], nil)
    ui.providers.push(PanelTapView(s))
    ui.open(["detail", "t", "middle", "light", 2])
    check("a group's page has the Settings: Identify, Settings", PanelPageButtons.icons(ui, ui.top()["view"]), ["identify", "settings"])
    ui.page_icon(2)
    check("which opens the zone's Tap", ui.top()["view"], ["tap", "middle"])
    ui.back()
    ui.open(["detail", "d", PanelStore.member_ids(s.find_zone("middle")["members"])[0]])
    check("a lamp's own page keeps its Settings", PanelPageButtons.icons(ui, ui.top()["view"]), ["identify", "settings"])
end

def glass_checks()
    var v = json.load(read_text("berry/test/vectors/draw.json"))
    var s = PanelStore(json.load(living_room_text))
    s.fit_matrix(PanelPlanView.matrix_of(v["style"]))
    var runs = []
    var plan = PanelPlanView(s, v["style"], def (t) end, def (p, intent) runs.push([p, intent]) end, def (t) end, def (r) end)
    var middle = s.find_zone("middle")
    var lamp = PanelStore.member_ids(middle["members"])[3]
    plan.relay_on = [true, true]
    s.set_tap("middle", ["device", lamp])
    var intent = plan.on_tap(300 * 1000 + 140)
    check("a tap on the Middle's card with its Tap on one lamp: that lamp alone, on", [intent, runs[0][0]["unicast"], runs[0][0]["zids"]], ["on", [lamp], []])
end

store_checks()
plan_checks()
button_checks()
commands_checks()
view_checks()
page_checks()
glass_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
