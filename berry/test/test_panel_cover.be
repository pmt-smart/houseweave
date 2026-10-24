# berry/panel_cover.be, the blinds as the panel knows them, and what PanelZigbee and PanelUi do
# with what the bridge's driver says (ZbDriver): a description registers a blind in the pairing, its state is told
# to the plan (the open glyph while it is not all the way down, the accent while it moves, green at the top), and a
# tap on its row, its zone's counter or a zone of blinds only runs the cycle, up, stop, down, stop. The driver's own
# side is test_zbdriver_cover.be; this is the panel's. Each part is a function, as the script's own top level is far
# past the 256 constants a function may name.

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

class FakePlan
    var reports, live, answered, moving, covers
    def init() self.reports = [] self.live = {} self.answered = [] self.moving = [] self.covers = [] end
    def on_report(id, state) self.reports.push([id, state]) self.live[id] = state end
    def on_color(id, c) end
    def on_answered(id) self.answered.push(id) return true end
    def on_temps(id, pair) end
    def on_heating(id, on) end
    # what the plan was told of a blind: whether it moves, [id, true or false], and where it is, [id, position or nil]
    def on_moving(id, on) self.moving.push([id, on]) end
    def on_cover(id, pos) self.covers.push([id, pos]) end
end

var CV = "0x00124B0000C10001"
var CV2 = "0x00124B0000C10002"
var CV3 = "0x00124B0000C10003"

def description()
    return {"caps": 64, "ep": 1, "kind": "cover", "drv": "cover", "model": "TS0601"}
end

def fixture()
    var f = {}
    f["store"] = PanelStore(json.load(living_room_text))
    f["ui"] = PanelUi(f["store"], shape, / -> [], nil)
    f["ui"].providers.push(PanelAddView(f["ui"]))
    f["plan"] = FakePlan()
    f["ui"].live = f["plan"].live
    f["effects"] = []
    var fx = f["effects"]
    f["zb"] = PanelZigbee(f["store"], f["ui"], f["plan"], def (e) for x: e fx.push(x) end end, / c -> nil)
    f["cover"] = PanelCover(f["zb"])
    f["zb"].cover = f["cover"]
    f["ui"].network = f["zb"]
    return f
end

def driver_says(f, id, secs)
    f["zb"].on_event({"ZbDriver": {id: secs}})
end

# a blind paired by the + of the Hall, as the search registers one the driver describes
def pair_as(f, id, d)
    var ui = f["ui"]
    ui.open_card("z:hall", "home")
    ui.action()
    ui.list_row(0, 0, false)
    ui.pair_announced(id)
    driver_says(f, id, {"d": d})
    ui.back()
    ui.back()
end
def pair(f, id)
    pair_as(f, id, description())
end

def state_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    var plan = f["plan"]
    pair(f, CV)
    var d = store.find_device(CV)
    check("its description registers a blind, named by its kind, with its position's capability", [d[1], d[2], d[3], store.zone_of(CV)["id"]],
          ["Cover 1", "cover", 64, "hall"])
    check("with nothing said, its row is the closed glyph, unlit", ui.device_look(CV), ["unknown", "coverOff", "icon-off"])

    driver_says(f, CV, {"s": {"pos": 40, "mov": "up"}})
    check("going up from 40: the plan is told it moves, where it is, and that it is open", [plan.moving[-1], plan.covers[-1], plan.reports[-1]],
          [[CV, true], [CV, 40], [CV, "on"]])
    check("its row: the open glyph in the accent, while it moves", ui.device_look(CV), ["on", "coverOn", "accent-blue"])
    driver_says(f, CV, {"s": {"mov": "stop"}})
    check("standing part of the way: the open glyph, unlit", [plan.moving[-1], ui.device_look(CV)], [[CV, false], ["on", "coverOn", "icon-off"]])
    driver_says(f, CV, {"s": {"pos": 100}})
    check("all the way up: green", ui.device_look(CV), ["on", "coverOn", "icon-open"])
    driver_says(f, CV, {"s": {"pos": 0}})
    check("all the way down: the closed glyph, unlit", [plan.reports[-1], ui.device_look(CV)], [[CV, "off"], ["off", "coverOff", "icon-off"]])
    driver_says(f, CV, {"s": {"up": false}})
    check("one that stopped answering: the plan is told, and its row has the blind with the question", [plan.reports[-1], ui.device_look(CV)[0 .. 1]],
          [[CV, "noanswer"], ["noanswer", "coverNoAnswer"]])
    driver_says(f, CV, {"s": {"up": true}})
    check("and its answer is told too", plan.answered[-1], CV)

    # a command the bridge refused is the "?", the no communication of a device that does not answer, until a word of it says otherwise
    f["zb"].to_refresh = {}
    driver_says(f, CV, {"e": "refused"})
    check("a refusal: the plan is told no answer, and the page is drawn again", [plan.reports[-1], f["zb"].to_refresh.contains(CV)], [[CV, "noanswer"], true])
    driver_says(f, CV, {"s": {"pos": 40}})
    check("and its next position takes it away", plan.reports[-1], [CV, "on"])
    var told = size(plan.reports)
    driver_says(f, "0x00124B0000C1FFFF", {"e": "nodriver"})
    driver_says(f, "0x00124B0000E00001", {"e": "refused"})
    check("a refusal for a device the panel does not have, or one that is no blind, is let go", size(plan.reports), told)

    # a state for a device that is no blind, or no device, is let go
    plan.covers.clear()
    driver_says(f, "0x00124B0000C1FFFF", {"s": {"pos": 30}})
    check("a state of a device the panel does not have is let go", plan.covers, [])
end
state_checks()

def cycle_checks()
    var f = fixture()
    var ui = f["ui"]
    pair(f, CV)
    check("the first tap, with nothing known: up", ui.act(["toggleDevice", CV]), [["cover", [CV], "open"]])
    driver_says(f, CV, {"s": {"pos": 30, "mov": "up"}})
    check("going up: the tap stops it", ui.act(["toggleDevice", CV]), [["cover", [CV], "stop"]])
    driver_says(f, CV, {"s": {"mov": "stop"}})
    check("standing after going up: down", ui.act(["toggleDevice", CV]), [["cover", [CV], "close"]])
    check("a second tap before the driver's word reverses the first: the way is noted at once", ui.act(["toggleDevice", CV]), [["cover", [CV], "open"]])
    driver_says(f, CV, {"s": {"mov": "down"}})
    driver_says(f, CV, {"s": {"mov": "stop", "pos": 20}})
    check("a key pressed on the wall is a move too: after it went down, up", ui.act(["toggleDevice", CV]), [["cover", [CV], "open"]])
    driver_says(f, CV, {"s": {"pos": 100}})
    check("at the top, whatever it last did: down", ui.act(["toggleDevice", CV]), [["cover", [CV], "close"]])
    driver_says(f, CV, {"s": {"pos": 0, "mov": "stop"}})
    check("at the bottom: up", ui.act(["toggleDevice", CV]), [["cover", [CV], "open"]])
end
cycle_checks()

# A gate of two keys has no stop: its description says so, and a tap on it while it moves turns it back, where a
# blind's stops it; a gate of one key, whose description has no word of it, stops
def gate_cycle_checks()

# The page of a gate of two keys: its stop key is dim and does nothing, where the driver refuses a stop; a page of
# the gate and a blind sends its stop to the blind alone; a gate of one key, whose description has no word of a stop, has it
def stop_key_checks()
    var f = fixture()
    var ui = f["ui"]
    var gate = description()
    gate["model"] = "TS0002"
    gate["drv"] = "twokey"
    gate["app"] = "gate"
    gate["mode"] = "pulse"
    gate["sensor"] = ""
    gate["stop"] = false
    pair_as(f, CV, gate)
    pair(f, CV2)
    def said_of(ops)
        var said = {}
        for e: ops
            if e[0] == "set"  said[e[1]] = e[2] end
        end
        return said
    end
    ui.open(["cover", "d", CV])
    var said = said_of(ui.render(ui.top()))
    check("a gate's page: the stop key is dim, and the up and down keys are as any", [said["$cover.stop.iconColor"], said["$cover.up.iconColor"], said["$cover.down.iconColor"]],
          ["icon-off", "text-primary", "text-primary"])
    check("and a touch on it sends nothing", ui.cover_key("$cover.stop.count"), [])
    check("the other keys go as they did", [ui.cover_key("$cover.up.count"), ui.cover_key("$cover.down.count")], [[["cover", [CV], "open"]], [["cover", [CV], "close"]]])
    ui.back()
    ui.open(["cover", "d", CV2])
    said = said_of(ui.render(ui.top()))
    check("a blind's page: its stop key is as any, and sends its stop", [said["$cover.stop.iconColor"], ui.cover_key("$cover.stop.count")], ["text-primary", [["cover", [CV2], "stop"]]])
    ui.back()
    # the two of one relay, as the page of a zone's blinds has them
    var relay = f["store"].find_device(CV)[9]
    f["store"].find_device(CV2)[9] = relay
    ui.open(["cover", "t", "hall", relay])
    said = said_of(ui.render(ui.top()))
    check("a page of the gate and a blind: the stop key is lit, and the stop goes to the blind alone", [said["$cover.stop.iconColor"], ui.cover_key("$cover.stop.count")],
          ["text-primary", [["cover", [CV2], "stop"]]])
    ui.back()
    gate.remove("stop")
    driver_says(f, CV, {"d": gate})
    ui.open(["cover", "d", CV])
    said = said_of(ui.render(ui.top()))
    check("a gate of one key: its stop key is lit, and sends its stop", [said["$cover.stop.iconColor"], ui.cover_key("$cover.stop.count")], ["text-primary", [["cover", [CV], "stop"]]])
end
stop_key_checks()
    var f = fixture()
    var ui = f["ui"]
    var gate = description()
    gate["model"] = "TS0002"
    gate["drv"] = "twokey"
    gate["app"] = "gate"
    gate["mode"] = "pulse"
    gate["sensor"] = ""
    gate["stop"] = false
    pair_as(f, CV, gate)
    pair(f, CV2)
    check("a gate of two keys, with nothing known: up, as any", ui.act(["toggleDevice", CV]), [["cover", [CV], "open"]])
    driver_says(f, CV, {"s": {"mov": "up"}})
    check("shown moving up: the tap turns it back, down, with no stop", ui.act(["toggleDevice", CV]), [["cover", [CV], "close"]])
    driver_says(f, CV, {"s": {"mov": "down"}})
    check("shown moving down: up", ui.act(["toggleDevice", CV]), [["cover", [CV], "open"]])
    driver_says(f, CV, {"s": {"mov": "stop"}})
    check("standing after going down, which the last tap sent up: down", ui.act(["toggleDevice", CV]), [["cover", [CV], "close"]])
    driver_says(f, CV2, {"s": {"mov": "up"}})
    check("a blind moving beside it still has its stop", ui.act(["toggleDevice", CV2]), [["cover", [CV2], "stop"]])
    driver_says(f, CV, {"s": {"mov": "up"}})
    check("a group of the gate and a blind that move: the stop of the one that has one, which the gate will refuse", [f["cover"].next_verb([CV, CV2]), f["cover"].nostop.contains(CV), f["cover"].nostop.contains(CV2)], ["stop", true, false])
    driver_says(f, CV2, {"s": {"mov": "stop"}})
    check("with only the gate moving up: it is turned back, for both", f["cover"].next_verb([CV, CV2]), "close")
    driver_says(f, CV, {"s": {"mov": "stop"}})
    # one key said: its description has no stop false, and the cycle has its stop again
    gate.remove("stop")
    driver_says(f, CV, {"d": gate})
    driver_says(f, CV, {"s": {"mov": "up"}})
    check("a gate whose inputs are one key now: its description has no word of a stop, and a tap on it moving stops it", ui.act(["toggleDevice", CV]), [["cover", [CV], "stop"]])
    gate["stop"] = false
    driver_says(f, CV, {"d": gate})
    f["cover"].forget(CV)
    check("a device that left is forgotten, the stop it lacked too", f["cover"].nostop.contains(CV), false)
end
gate_cycle_checks()

def group_checks()
    var f = fixture()
    var ui = f["ui"]
    var store = f["store"]
    pair(f, CV)
    pair(f, CV2)
    var hall = store.find_zone("hall")
    check("two blinds in the Hall: one group of them", store.groups_of([CV, CV2])[0][0 .. 1], ["cover", 0])
    driver_says(f, CV, {"s": {"pos": 50, "mov": "stop"}})
    driver_says(f, CV2, {"s": {"pos": 50, "mov": "up"}})
    check("one moving: the counter's tap stops them all", ui.act(["toggleGroup", "hall", "cover", 0]), [["cover", [CV, CV2], "stop"]])
    driver_says(f, CV2, {"s": {"mov": "stop"}})
    check("standing, the other way from the one that moved last, all together", ui.act(["toggleGroup", "hall", "cover", 0]), [["cover", [CV, CV2], "close"]])
    check("one at the top and one part of the way: not all at the top, so the way they last went", f["cover"].next_verb([CV, CV2]), "open")

    # the counter's colour: the accent while one moves, green with one at the top
    driver_says(f, CV, {"s": {"mov": "down"}})
    check("the counter in the accent while one moves", f["ui"].cover_color([CV, CV2], true), "accent-blue")
    driver_says(f, CV, {"s": {"mov": "stop", "pos": 100}})
    check("green with one at the top", f["ui"].cover_color([CV, CV2], true), "icon-open")

    # a zone of blinds only, for a tap on its card or its button
    check("the Hall has lamps: its card is the lamps', and not the blinds' cycle", store.blinds_only([hall]), nil)
    var only = {"id": "x", "members": {}}
    only["members"][CV] = 0
    only["members"][CV2] = 0
    check("a zone of blinds only: its card's tap is their cycle", store.blinds_only([only]), [CV, CV2])
    check("and a zone with no blind has none", store.blinds_only([{"id": "y", "members": {}}]), nil)
end
group_checks()

# the page: opened by a hold, what it says, its keys, its slider, its ventilation, and its name
def page_checks()
    var f = fixture()
    var ui = f["ui"]
    var store = f["store"]
    pair(f, CV)
    driver_says(f, CV, {"s": {"pos": 70, "mov": "stop"}})
    ui.open_card("z:hall", "home")
    var order = PanelUi.members_in_order(store.find_zone("hall"))
    var at = order.find(CV)
    var per = shape["zoneRows"]
    ui.top()["page"] = at / per
    var out = ui.zone_row("$zone.rows." + str(at % per) + ".label", at / per, "iconHold")
    var said = {}
    for e: out
        if e[0] == "set"  said[e[1]] = e[2] end
    end
    check("the hold on its row's icon opens its page", ui.top()["view"], ["cover", "d", CV])
    check("which says its name, where it is, and that it stands", [said["$cover.name"], said["$cover.position"], said["$cover.state"]], ["Cover 1", "70%", "Stopped"])
    check("the slider where it is: 70% is the 7th place from the top, 0 at the top", said["$cover.page"], 6)
    check("the keys' icons, none lit while it stands", [said["$cover.up.icon"], said["$cover.stop.icon"], said["$cover.down.icon"], said["$cover.up.iconColor"], said["$cover.down.iconColor"]],
          ["coverUp", "coverStop", "coverDown", "text-primary", "text-primary"])
    check("the ventilation, the start's 15%, not lit where it is not", [said["$cover.vent.label"], said["$cover.vent.on"]], ["Ventilation 15%", 0])
    check("the up key opens it", ui.cover_key("$cover.up.count"), [["cover", [CV], "open"]])
    check("stop and down", [ui.cover_key("$cover.stop.count"), ui.cover_key("$cover.down.count")], [[["cover", [CV], "stop"]], [["cover", [CV], "close"]]])
    check("the slider let go at the top, at the bottom, and a step above the bottom", [ui.set_page(0), ui.set_page(20), ui.set_page(19)],
          [[["cover", [CV], "goto", 100]], [["cover", [CV], "goto", 0]], [["cover", [CV], "goto", 5]]])
    check("the ventilation sends it to its position", ui.cover_vent(), [["cover", [CV], "goto", 15]])
    store.find_device(CV)[4] = 20
    check("one set in its settings is that one", ui.cover_vent(), [["cover", [CV], "goto", 20]])
    driver_says(f, CV, {"s": {"mov": "down"}})
    check("a state said while the page shows draws it again", ui.refresh_for(CV) != [], true)
    said = {}
    for e: ui.render(ui.top())
        if e[0] == "set"  said[e[1]] = e[2] end
    end
    check("going down: its word, and the down key lit", [said["$cover.state"], said["$cover.down.iconColor"], said["$cover.up.iconColor"]], ["Closing", "accent-blue", "text-primary"])
    driver_says(f, CV, {"s": {"mov": "stop", "pos": 20}})
    said = {}
    for e: ui.render(ui.top())
        if e[0] == "set"  said[e[1]] = e[2] end
    end
    check("standing at its ventilation: the ventilation lit", said["$cover.vent.on"], 1)
    ui.prefs["editing"] = true
    check("a hold on the title renames it", ui.rename_top()[0], ["set", "$keyboard.value", "Cover 1"])
    ui.back()
    ui.back()

    # the joint page of the Hall's blinds, by the hold on their counter
    pair(f, CV2)
    ui.open_card("z:hall", "home")
    var k = -1
    var groups = ui.zone_groups(store.find_zone("hall"))
    for i: 0 .. size(groups) - 1
        if groups[i][0] == "cover"  k = i end
    end
    ui.zone_row("$zone.counts." + str(k) + ".count", 0, "hold")
    check("the hold on their counter opens their joint page", ui.top()["view"], ["cover", "t", "hall", 0])
    said = {}
    for e: ui.render(ui.top())
        if e[0] == "set"  said[e[1]] = e[2] end
    end
    check("titled by the zone and how many, at the mean of where they said they are", [said["$cover.name"], said["$cover.position"]], ["Hall · 2 blinds", "20%"])
    check("its keys move them all", ui.cover_key("$cover.up.count"), [["cover", [CV, CV2], "open"]])

    # a layout made before the page: no page to open, and the hold does nothing
    var old = fixture()
    old["ui"].shape["pages"].remove("cover")
    pair(old, CV3)
    check("a layout with no blind's page: the hold opens nothing", old["ui"].cover_open(["d", CV3]), [])
    # the shape is every fixture's: the page goes back for the checks after this one
    old["ui"].shape["pages"]["cover"] = "cover"
end
page_checks()

# the settings: the ventilation first, the panel's, then the driver's, on the thermostat's screen
def settings_checks()
    var f = fixture()
    var ui = f["ui"]
    var store = f["store"]
    pair(f, CV)
    ui.prefs["editing"] = true
    var opts = []
    for r: ui.list_view(["deviceOptions", CV])[2]  opts.push(r[2]) end
    check("a blind's options have no Settings and no Identify: they are its page's", [opts.find("Settings"), opts.find("Identify")], [nil, nil])
    ui.cover_open(["d", CV])
    var said = {}
    for e: ui.render_cover(ui.top()["view"])
        if e[0] == "set"  said[e[1]] = e[2] end
    end
    check("its page's row: the Settings icon against its card, the Hall; no Identify, which a blind has not, and no Schedule without one",
          [said["$cover.icons.0.shown"], said["$cover.icons.1.icon"], said["$cover.icons.1.shown"], said["$cover.card.label"], said["$cover.card.shown"]],
          [0, "settings", 1, "Hall", 1])
    var out = ui.page_icon(1)
    check("opening them asks the driver for the schema and the values", [out[0], ui.top()["view"]], [["thermostat", [CV], "settings", nil], ["thermostatSettings", CV]])
    var rows = def () var o = [] for r: ui.list_view(ui.top()["view"])[2] o.push([r[2], r[3], r[5]]) end return o end
    check("until they come, the device is being read", rows(), [["Reading the device", "", nil]])
    driver_says(f, CV, {"x": {"at": 0, "of": 1, "l": [{"k": "reverse", "l": "Motor reversed", "t": "b"}]}, "v": {"reverse": false}})
    check("the ventilation first, at the start's 15%, then the driver's", rows(),
          [["Ventilation", "15%", ["thermostat", "pick", CV, "vent"]], ["Motor reversed", "Off", ["thermostat", "toggle", CV, "reverse"]]])
    check("a flag goes to the driver", ui.act(["thermostat", "toggle", CV, "reverse"]), [["thermostat", [CV], "setting", true, "reverse"]])
    ui.act(["thermostat", "pick", CV, "vent"])
    var choices = ui.list_view(ui.top()["view"])[2]
    check("the ventilation's choices: 5% to 95% in steps of 5, a dot on the one it has", [size(choices), choices[0][2], choices[18][2], choices[2][0]],
          [19, "5%", "95%", "dotOn"])
    out = ui.act(["thermostat", "choose", CV, "vent", 30])
    check("one chosen is the panel's: kept in its record, saved, and back on the settings", [out[0], store.find_device(CV)[4], ui.top()["view"]],
          [["save"], 30, ["thermostatSettings", CV]])
    check("which says it", rows()[0][1], "30%")
    check("and the page's ventilation is that one", PanelCoverView.ventilation([store.find_device(CV)]), 30)
    check("a ventilation out of 5 to 95 is nothing", [ui.cover_vent_set(CV, 100), ui.cover_vent_set(CV, 0), store.find_device(CV)[4]], [[], [], 30])
    # Editing off: the Settings is still there, and its screen only to be seen
    ui.prefs["editing"] = false
    ui.back()
    check("back on the blind's page", ui.top()["view"], ["cover", "d", CV])
    ui.page_icon(1)
    var touched = false
    for r: ui.list_view(ui.top()["view"])[2]
        if r[5] != nil  touched = true end
    end
    check("Editing off: the Settings opens, and no row takes a touch", [ui.top()["view"], touched], [["thermostatSettings", CV], false])
end
settings_checks()

# A hold on a zone's card: a zone of the panel's relays, or of relays with Zigbee devices, opens its
# screen as before; a zone of Zigbee devices in one group, the group's page; a zone of one device, that device's page,
# or its screen when the device has none
def hold_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    var top = / -> ui.top()["view"]
    ui.hold_card("z:hall", "home")
    check("Hall, the panel's four relays: its screen", top(), ["zone", "hall"])
    ui.back()
    ui.hold_card("z:corridor", "home")
    check("Corridor, eight Zigbee lamps behind relay 2: their joint page", top(), ["detail", "t", "corridor", "light", 2])
    ui.back()
    pair(f, CV)
    ui.hold_card("z:hall", "home")
    check("the relays and a blind, two kinds: its screen", top(), ["zone", "hall"])
    ui.back()
    var sid = store.add_screen("Two")["value"]
    var one = store.create_zone(sid, "Bedroom", [0, 0], [2, 2])["value"]
    store.move_to_zone(CV, one)
    ui.hold_card("z:" + one, sid)
    check("a zone of one blind: its page", top(), ["cover", "d", CV])
    ui.back()
    var lamp = PanelStore.member_ids(store.find_zone("corridor")["members"])[0]
    store.move_to_zone(lamp, one)
    ui.hold_card("z:" + one, sid)
    check("a blind and a lamp: its screen", top(), ["zone", one])
    ui.back()
    store.move_to_zone(CV, "hall")
    ui.hold_card("z:" + one, sid)
    check("a zone of one lamp with levels: the lamp's page", top(), ["detail", "d", lamp])
    ui.back()
    store.move_to_zone(lamp, "corridor")
    store.move_to_zone("relay:1", one)
    ui.hold_card("z:" + one, sid)
    check("a zone of one relay, which has no page: its screen", top(), ["zone", one])
    ui.back()
    check("a card of no zone: nothing", ui.hold_card("z:nowhere", "home"), [])
    # the card's button, the last of the row: the zone's screen in the page's place, so the title goes back where the page
    # was opened from; from the zone itself, back to it
    store.move_to_zone("relay:1", "hall")
    ui.hold_card("z:corridor", "home")
    check("the lamps' joint page: the Identify and the Settings, which is the zone's Tap, and no Schedule without one",
          PanelPageButtons.icons(ui, top()), ["identify", "settings"])
    check("its Identify, against the Settings, asks the group's", ui.page_icon(1)[0][0], "identifyGroup")
    check("a place it does not use does nothing", ui.page_icon(0), [])
    ui.page_card()
    check("its card: the zone's screen in its place", [top(), size(ui.stack)], [["zone", "corridor"], 1])
    ui.open(["detail", "d", lamp])
    check("a lamp's page: the Identify and the Settings icons", PanelPageButtons.icons(ui, top()), ["identify", "settings"])
    check("its Identify, the lamp's", ui.page_icon(1), [["identify", lamp]])
    ui.page_card()
    check("opened from the zone, its card goes back to it", [top(), size(ui.stack)], [["zone", "corridor"], 1])
    check("a page for an event has no row", [PanelPageButtons.icons(ui, ["detail", "d", lamp, "during"]), PanelPageButtons.none("$light")[2], PanelPageButtons.none("$light")[3]],
          [[], ["set", "$light.icons.2.shown", 0], ["set", "$light.card.shown", 0]])
    check("what a touch was, from its path", [PanelPageButtons.touched("$cover.icons.1.count"), PanelPageButtons.touched("$cover.card.label"), PanelPageButtons.touched("$cover.vent.label")],
          [["icon", 1], ["card"], nil])
end
hold_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
