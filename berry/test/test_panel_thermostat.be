# berry/panel_thermostat.be, the thermostats as the panel knows them, and what
# PanelZigbee and PanelUi do with what the bridge's drivers say (ZbDriver): a
# description takes the place of an interview in the pairing, the state is told to the
# plan as a lamp's on and off is, and a device nobody has is let go. The driver's own side
# is test_zbdriver_thermostat.be; this is the panel's. Each part is a function, as the script's
# own top level is far past the 256 constants a function may name.

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
                       "thermostat": "thermostat"},
             "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5, "thermostatLines": 1, "thermostatModes": 2}

class FakePlan
    var reports, live, answered, temps, heating
    def init() self.reports = [] self.live = {} self.answered = [] self.temps = [] self.heating = [] end
    def on_report(id, state) self.reports.push([id, state]) self.live[id] = state end
    def on_color(id, c) end
    def on_answered(id) self.answered.push(id) return true end
    # what the plan was told of a thermostat's temperatures, in order: [id, [room, floor] or nil]
    def on_temps(id, pair) self.temps.push([id, pair]) end
    # and whether it heats: [id, true or false]
    def on_heating(id, on) self.heating.push([id, on]) end
end

var TH = "0x00124B0000B00001"
var TH2 = "0x00124B0000B00002"
var TH3 = "0x00124B0000B00003"
var LAMP = "0x00124B0000E00001"

# what the ZHT-SR's driver describes: a thermostat with a setpoint and a mode, 5 to 35 degrees
def description(extra)
    var d = {"caps": 48, "min": 50, "max": 350, "step": 5, "modes": ["off", "heat"], "floor": true, "ep": 1,
             "kind": "thermostat", "drv": "thermostat", "model": "TS0601"}
    if extra != nil
        for k: extra.keys() d[k] = extra[k] end
    end
    return d
end

# the panel's side of the network, on a store of the Living room, with the pages of a layout
def fixture_in(pages)
    var f = {}
    f["store"] = PanelStore(json.load(living_room_text))
    f["ui"] = PanelUi(f["store"], pages, / -> [], nil)
    f["ui"].providers.push(PanelAddView(f["ui"]))
    f["plan"] = FakePlan()
    f["ui"].live = f["plan"].live
    f["effects"] = []
    var fx = f["effects"]
    # what the views asked for, flat: the effects of every call, in order
    f["zb"] = PanelZigbee(f["store"], f["ui"], f["plan"], def (e) for x: e fx.push(x) end end, / c -> nil)
    f["thermostat"] = PanelThermostat(f["zb"])
    f["zb"].thermostat = f["thermostat"]
    f["ui"].network = f["zb"]
    return f
end
def fixture()
    return fixture_in(shape)
end

def has_effect(effects, verb)
    for e: effects
        if e[0] == verb return true end
    end
    return false
end

def driver_says(f, id, secs)
    f["zb"].on_event({"ZbDriver": {id: secs}})
end

# --- the pairing: a description takes an interview's place -------------------------------------------
def pairing_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    # the + of a zone, searching: the device announces itself, and waits to say what it is
    ui.open_card("z:hall", "home")
    ui.action()
    ui.list_row(0, 0, false)
    ui.pair_announced(TH)
    check("an announce while the search runs: the device is configuring", [ui.pairing["found"][0][0], ui.pairing["found"][0][1]], [TH, "configuring"])

    driver_says(f, TH, {"d": description(nil)})
    var d = store.find_device(TH)
    check("its description registers it: a thermostat with the capabilities and the target's range, named by its kind",
          d, [TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    check("in the zone the search was for", store.zone_of(TH)["id"], "hall")
    check("the search says it is ready", ui.pairing["found"][0][1], "ready")
    check("saved, and nothing asked of it: the driver has it read already",
          [has_effect(f["effects"], "save"), has_effect(f["effects"], "identify"), has_effect(f["effects"], "query"), has_effect(f["effects"], "startup")],
          [true, false, false, false])

    # described again, with every link: nothing changed, nothing to save
    f["effects"].clear()
    driver_says(f, TH, {"d": description(nil)})
    check("the same description again is nothing", f["effects"], [])
    driver_says(f, TH, {"d": description({"min": 40, "model": "TS0601 v2"})})
    d = store.find_device(TH)
    check("a changed one is kept: the range, the model", [d[4], d[6], has_effect(f["effects"], "save")], [40, "TS0601 v2", true])
    check("and the zone is where it was", store.zone_of(TH)["id"], "hall")

    # what the network had before the panel: registered in no zone, as the ZbInfo of a lamp is
    f["effects"].clear()
    driver_says(f, TH2, {"d": description(nil)})
    check("a device the network had and the panel did not is registered in no zone, and saved",
          [store.find_device(TH2) != nil, store.zone_of(TH2), f["effects"]], [true, nil, [["save"]]])
    check("named by its kind and the first number free", store.find_device(TH2)[1], "Thermostat 2")

    # a device whose search ended before its description came: it goes to the zone it was found for
    f["effects"].clear()
    ui.late[TH3] = ["hall", 0]
    driver_says(f, TH3, {"d": description(nil)})
    check("one whose search ended first goes to its zone, and the late list lets it go", [store.zone_of(TH3) != nil ? store.zone_of(TH3)["id"] : nil, ui.late.contains(TH3)], ["hall", false])
    check("with nothing asked of it either", [has_effect(f["effects"], "identify"), has_effect(f["effects"], "query")], [false, false])

    # a description the panel cannot take
    var n = size(store.doc["devices"])
    driver_says(f, "0x00124B0000B00009", {"d": description({"kind": "frobnicator"})})
    driver_says(f, "0x00124B0000B0000A", {"d": "not a map"})
    driver_says(f, "0x00124B0000B0000B", "not a map either")
    check("a kind the panel has not, and what is no description, are let go", size(store.doc["devices"]), n)
end
pairing_checks()

# --- a Replace: the thermostat takes the old device's place ------------------------------------------
def replace_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    var old = "0x00124B0000E00001"
    var zone = store.zone_of(old)
    var name = store.find_device(old)[1]
    ui.act(["replace", old])
    ui.act(["pairSearch"])
    ui.pair_announced(TH)
    var out = ui.pair_described(TH, description(nil))
    check("a Replace's search takes the first device in: the old one's name and zone, the old one leaves",
          [store.find_device(TH)[1], store.zone_of(TH)["id"], store.find_device(old) == nil, has_effect(out, "leave")], [name, zone["id"], true, true])
    check("the search ends, and nothing is asked of the new one", [has_effect(out, "pairStop"), has_effect(out, "identify"), has_effect(out, "query")], [true, false, false])
end
replace_checks()

# --- what the panel guessed gives way to what the driver says ---------------------------------------------
def conversion_checks()
    var f = fixture()
    var store = f["store"]
    # a thermostat the network had, which Z2T's Config made a sensor of when the panel read it
    store.register_device([TH, "Sensor 1", "sensor", 0, 0, 0, "SIMTHERM", 1, 0, 0])
    store.add_to_zone("hall", TH)
    f["effects"].clear()
    driver_says(f, TH, {"d": description(nil)})
    check("the description makes it the thermostat it is: the kind, the capabilities, the range, in the zone it was in, and the name the kind gave",
          [store.find_device(TH), store.zone_of(TH)["id"]], [[TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0], "hall"])
    check("saved", has_effect(f["effects"], "save"), true)
    driver_says(f, TH, {"s": {"mode": "heat", "cur": 213}})
    check("and its state is taken, which a sensor's was not", f["thermostat"].get(TH, "cur", nil), 213)

    # a name the owner gave stays
    store.register_device([TH2, "Cozy", "sensor", 0, 0, 0, "", 1, 0, 0])
    driver_says(f, TH2, {"d": description(nil)})
    check("a name of the owner's is kept when the kind changes", [store.find_device(TH2)[1], store.find_device(TH2)[2]], ["Cozy", "thermostat"])

    # a device the panel could not take at its pairing: the driver was not there yet
    store.register_device([TH3, store.auto_name("unsupported"), "unsupported", 0, 0, 0, "", 1, 0, 0])
    var was = store.find_device(TH3)[1]
    driver_says(f, TH3, {"d": description(nil)})
    check("an unsupported device becomes the thermostat the driver says, renamed from the generic name", [was, store.find_device(TH3)[1], store.find_device(TH3)[2]],
          ["Device 1", "Thermostat 2", "thermostat"])

    # a light is not one: the panel's record stands against a description of another kind
    f["effects"].clear()
    var lamp = store.find_device(LAMP)
    var before = json.dump(lamp)
    driver_says(f, LAMP, {"d": description(nil)})
    check("a lamp described as a thermostat is left as it is", [json.dump(store.find_device(LAMP)), f["effects"]], [before, []])
    check("the automatic names the panel gives: the kind's word and a number, and nothing else",
          [PanelStore.auto_named("sensor", "Sensor 12"), PanelStore.auto_named("sensor", "Sensor"), PanelStore.auto_named("sensor", "Sensor A"), PanelStore.auto_named("sensor", "Sensor 1b"),
           PanelStore.auto_named("unsupported", "Device 3"), PanelStore.auto_named("sensor", "Cozy")], [true, false, false, false, true, false])
end
conversion_checks()

# --- the state ----------------------------------------------------------------------------------------
def state_checks()
    var f = fixture()
    var store = f["store"]
    var plan = f["plan"]
    var zb = f["zb"]
    var thermostat = f["thermostat"]
    driver_says(f, TH, {"d": description(nil)})
    check("a description of a thermostat the panel does not know: registered, and the driver's words kept for the screens",
          [store.find_device(TH) != nil, thermostat.shape[TH]["step"], thermostat.shape[TH]["modes"]], [true, 5, ["off", "heat"]])

    driver_says(f, TH, {"s": {"mode": "heat", "cur": 213, "set": 210, "dem": 100}})
    check("the state is kept, as the driver said it", [thermostat.get(TH, "cur", nil), thermostat.get(TH, "set", nil), thermostat.get(TH, "mode", nil), thermostat.get(TH, "dem", nil)],
          [213, 210, "heat", 100])
    check("the mode is told to the plan as a lamp's on: that is what a command waits for", plan.reports[-1], [TH, "on"])
    check("a heating thermostat is one that is on and has demand", thermostat.heating(TH), true)
    check("and what it shows is drawn again, in a moment", zb.to_refresh.contains(TH), true)

    zb.to_refresh = {}
    driver_says(f, TH, {"s": {"cur": 215}})
    check("a temperature alone changes nothing a view draws, and the plan hears nothing", [plan.reports[-1], zb.to_refresh.contains(TH), thermostat.get(TH, "cur", nil)], [[TH, "on"], false, 215])
    driver_says(f, TH, {"s": {"dem": 0}})
    check("the demand stopped: not heating, still on, drawn again", [thermostat.heating(TH), plan.reports[-1], zb.to_refresh.contains(TH)], [false, [TH, "on"], true])
    driver_says(f, TH, {"s": {"mode": "off"}})
    check("off is the lamp's off", [plan.reports[-1], thermostat.heating(TH)], [[TH, "off"], false])
    driver_says(f, TH, {"s": {"mode": "heat", "dem": 40}})
    check("heat with a demand is on, and heating", [plan.reports[-1], thermostat.heating(TH)], [[TH, "on"], true])
    driver_says(f, TH, {"s": {"mode": "off", "dem": 100}})
    check("a thermostat that is off does not heat, whatever its last demand said", [plan.reports[-1], thermostat.heating(TH)], [[TH, "off"], false])
    driver_says(f, TH, {"s": {"mode": "heat"}})
    check("a mode that is the one it had is told again: a command waits for it", plan.reports[-1], [TH, "on"])

    # no communication, and back
    driver_says(f, TH, {"s": {"up": false}})
    check("a device that stopped answering is the plan's no communication", plan.reports[-1], [TH, "noanswer"])
    driver_says(f, TH, {"s": {"up": true}})
    check("and one that answers again is the plan's answered", plan.answered, [TH])

    # what is not ours
    var reports = size(plan.reports)
    driver_says(f, "0x00124B0000B000EE", {"s": {"mode": "heat"}})
    driver_says(f, LAMP, {"s": {"mode": "heat"}})
    check("the state of a device the panel does not have, or one that is no thermostat, is let go", [size(plan.reports), thermostat.state.contains(LAMP)], [reports, false])
    driver_says(f, TH, {"s": "not a map"})
    zb.to_refresh = {}
    driver_says(f, TH, {"e": "refused"})
    check("a refusal is the no communication the glass has, the \"?\", and the page is drawn again; its state is as it was", [plan.reports[-1], size(plan.reports), zb.to_refresh.contains(TH), thermostat.get(TH, "mode", nil)],
          [[TH, "noanswer"], reports + 1, true, "heat"])
    driver_says(f, TH, {"s": {"mode": "heat"}})
    check("a word of the device that follows takes it away", plan.reports[-1], [TH, "on"])
    zb.to_refresh = {}
    driver_says(f, TH, {"e": "nodriver"})
    check("a bridge with no driver for it says the same", [plan.reports[-1], zb.to_refresh.contains(TH)], [[TH, "noanswer"], true])
    reports = size(plan.reports)
    driver_says(f, "0x00124B0000B000EE", {"e": "nodriver"})
    driver_says(f, LAMP, {"e": "refused"})
    check("a refusal for a device the panel does not have, or one that is no thermostat, is let go", [size(plan.reports), thermostat.state.contains(LAMP)], [reports, false])

    thermostat.forget(TH)
    check("a device that left is forgotten", [thermostat.state.contains(TH), thermostat.shape.contains(TH), thermostat.heating(TH)], [false, false, false])
end
state_checks()

# --- a touch on thermostats: a row's icon, a counter, a zone's own toggle ------------------------
def touch_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    var lamp = "0x00124B0000E00001"
    store.register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "", 1, 0, 0])
    store.register_device([TH2, "Thermostat 2", "thermostat", 48, 50, 350, "", 1, 0, 0])
    # the Hall's relays leave it: it holds the thermostats alone
    store.find_zone("hall")["members"] = {}
    store.add_to_zone("hall", TH)
    store.add_to_zone("hall", TH2)
    # a command is the one effect, with its plan, its intent and what waits
    var cmd = def (out) return size(out) == 1 && out[0][0] == "command" ? [out[0][1]["thermostat"], out[0][2], out[0][3]] : out end

    ui.live[TH] = "off"
    check("a row's icon: a thermostat that is off goes to heat, and waits for it", cmd(ui.act(["toggleDevice", TH])), [[TH], "on", [TH]])
    ui.live[TH] = "on"
    check("and one that is on goes off", cmd(ui.act(["toggleDevice", TH])), [[TH], "off", [TH]])
    ui.live.remove(TH)
    check("one that has not said is tried, with heat", cmd(ui.act(["toggleDevice", TH])), [[TH], "on", [TH]])
    ui.doubt[TH] = true
    ui.live[TH] = "on"
    check("one with no communication is tried too, whatever it last said", cmd(ui.act(["toggleDevice", TH])), [[TH], "on", [TH]])
    ui.doubt.remove(TH)
    ui.unconfirmed[TH] = ["on", 1]
    ui.live[TH] = "off"
    check("a tap in the time of a command not confirmed turns back what it asked", cmd(ui.act(["toggleDevice", TH])), [[TH], "off", [TH]])
    ui.unconfirmed.remove(TH)
    store.find_device(TH)[9] = 1
    ui.relay_on = [false, true]
    check("one behind a relay held open has no power: the tap does nothing", ui.act(["toggleDevice", TH]), [])
    ui.relay_on = [true, true]
    store.find_device(TH)[9] = 0

    # the counter of the thermostats: the group, as the lamps' is
    ui.live[TH] = "on"
    ui.live[TH2] = "off"
    check("a counter: with one on, all go off", cmd(ui.act(["toggleGroup", "hall", "thermostat", 0])), [[TH, TH2], "off", [TH, TH2]])
    ui.live[TH] = "off"
    check("with none on, all go to heat", cmd(ui.act(["toggleGroup", "hall", "thermostat", 0])), [[TH, TH2], "on", [TH, TH2]])

    # the zone's own toggle, with only thermostats in it: off for one that is on, and on when none is (revised)
    ui.live[TH] = "on"
    ui.live[TH2] = "off"
    check("the zone's toggle turns off the thermostat that is on, and not the other", cmd(ui.act(["toggleZone", "hall"])), [[TH], "off", [TH]])
    ui.live[TH] = "off"
    check("and with none on, both to Heat", cmd(ui.act(["toggleZone", "hall"])), [[TH, TH2], "on", [TH, TH2]])

    # thermostats of different relays asked together: only the ones with power are commanded
    store.find_device(TH)[9] = 1
    ui.relay_on = [false, true]
    ui.live[TH] = "on"
    ui.live[TH2] = "off"
    check("one with no power is left out of a touch on both", cmd(ui.thermostat_touch([TH, TH2])), [[TH2], "on", [TH2]])
    ui.relay_on = [true, true]
    store.find_device(TH)[9] = 0

    # a lamp's row and counter go as they always did: their plan has no thermostat
    var out = ui.act(["toggleDevice", lamp])
    check("a lamp's icon is the lamp's command: no thermostat in it", [out[0][0], out[0][1].contains("thermostat")], ["command", false])
end
touch_checks()

# --- the settings screen --------------------------------------------------------------------
# the ZHT-SR's schema, in part: a choice, a flag, a range that goes below zero, a number, and a setting only read
def schema_entries()
    return [{"k": "preset", "l": "Preset", "t": "e", "o": ["Manual", "Temporary", "Program", "Eco"]},
            {"k": "lock", "l": "Child lock", "t": "b"},
            {"k": "calib", "l": "Calibration", "t": "r", "min": -10, "max": 10, "u": "°"},
            {"k": "lmax", "l": "Max limit", "t": "n", "min": 35, "max": 45, "u": "°"},
            {"k": "sensor", "l": "Sensor", "t": "e", "o": ["Internal", "Both", "External"], "w": 0}]
end

# the schema as the driver says it: numbered frames, `per` entries to a frame
def say_schema(f, id, entries, per)
    var at = 0
    while at < size(entries) || (at == 0 && size(entries) == 0)
        var part = []
        var i = at
        while i < size(entries) && i < at + per
            part.push(entries[i])
            i += 1
        end
        driver_says(f, id, {"x": {"at": at, "of": size(entries), "l": part}})
        at += per
        if size(entries) == 0 break end
    end
end

def rows_of(f, id)
    return f["ui"].list_view(["thermostatSettings", id])[2]
end

def schema_checks()
    var f = fixture()
    var c = f["thermostat"]
    f["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    f["store"].register_device([TH2, "Thermostat 2", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    var entries = schema_entries()
    # the frames, in order: the schema is whole with the last
    driver_says(f, TH, {"x": {"at": 0, "of": 5, "l": [entries[0], entries[1]]}})
    check("a schema is not whole till its last frame", [c.schema.contains(TH), size(c.parts[TH])], [false, 2])
    driver_says(f, TH, {"x": {"at": 2, "of": 5, "l": [entries[2], entries[3]]}})
    driver_says(f, TH, {"x": {"at": 4, "of": 5, "l": [entries[4]]}})
    check("the last frame makes it whole, in the order it was said", [size(c.schema[TH]), c.schema[TH][0]["k"], c.schema[TH][4]["k"], c.parts.contains(TH)], [5, "preset", "sensor", false])
    # said again: the same list, once
    say_schema(f, TH, entries, 2)
    check("the list said again is the same list, and not twice", size(c.schema[TH]), 5)
    # a frame that overlaps what is there is the same entries said again: each is once
    c.release(TH)
    driver_says(f, TH, {"x": {"at": 0, "of": 5, "l": [entries[0], entries[1]]}})
    driver_says(f, TH, {"x": {"at": 1, "of": 5, "l": [entries[1], entries[2]]}})
    driver_says(f, TH, {"x": {"at": 3, "of": 5, "l": [entries[3], entries[4]]}})
    var keys_of = def (l) var out = [] for e: l out.push(e["k"]) end return out end
    check("a frame that starts inside what was gathered adds only what is new", keys_of(c.schema[TH]), ["preset", "lock", "calib", "lmax", "sensor"])
    # another list said from its first frame, while one was being gathered: the first is dropped
    c.release(TH)
    driver_says(f, TH, {"x": {"at": 0, "of": 4, "l": [entries[0], entries[1]]}})
    driver_says(f, TH, {"x": {"at": 0, "of": 3, "l": [entries[2], entries[3]]}})
    driver_says(f, TH, {"x": {"at": 2, "of": 3, "l": [entries[4]]}})
    check("a list that starts again takes the place of the one half gathered", keys_of(c.schema[TH]), ["calib", "lmax", "sensor"])
    # a frame lost: nothing is kept
    c.release(TH)
    driver_says(f, TH, {"x": {"at": 0, "of": 5, "l": [entries[0], entries[1]]}})
    driver_says(f, TH, {"x": {"at": 4, "of": 5, "l": [entries[4]]}})
    check("a frame that starts past what was gathered is a frame lost: nothing is kept", [c.schema.contains(TH), c.parts.contains(TH)], [false, false])
    driver_says(f, TH, {"x": {"at": 2, "of": 5, "l": [entries[2], entries[3]]}})
    check("and a frame that comes without its first is nothing either", [c.schema.contains(TH), c.parts.contains(TH)], [false, false])
    # the list is empty: a ZCL thermostat has none
    say_schema(f, TH2, [], 2)
    check("an empty list is a schema of nothing, which the screen says", [c.schema[TH2], c.schema.contains(TH)], [[], false])
    check("and one device's schema at a time", size(c.schema), 1)
    # what is no thermostat's, and no list
    driver_says(f, LAMP, {"x": {"at": 0, "of": 1, "l": [entries[0]]}, "v": {"lock": true}})
    check("a device that is no thermostat has no settings", [c.schema.contains(LAMP), c.values.contains(LAMP)], [false, false])
    driver_says(f, TH, {"x": {"at": 0, "of": 1, "l": "not a list"}, "v": "not a map"})
    check("and what is no list, or no map, changes nothing", [c.schema.contains(TH), c.values.contains(TH)], [false, false])
    # the values merge, by key
    driver_says(f, TH, {"v": {"lock": false, "preset": 2}})
    driver_says(f, TH, {"v": {"lock": true}})
    check("the values are kept by key, the last word of each", c.values[TH], {"lock": true, "preset": 2})
    say_schema(f, TH, entries, 2)
    check("the schema of the device is there before it leaves", [c.values.contains(TH), c.schema.contains(TH)], [true, true])
    c.forget(TH)
    check("a device that left takes its settings", [c.values.contains(TH), c.schema.contains(TH)], [false, false])
end
schema_checks()

def screen_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    var c = f["thermostat"]
    store.register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    ui.prefs["editing"] = true
    var labels = def (rows) var out = [] for r: rows out.push([r[2], r[3]]) end return out end
    var taps = def (rows) var out = [] for r: rows out.push(r[5]) end return out end

    # nothing said yet: the screen says it is reading, and has nothing to touch
    check("before the schema, the screen reads the device", [labels(rows_of(f, TH)), taps(rows_of(f, TH))], [[["Reading the device", ""]], [nil]])
    say_schema(f, TH, schema_entries(), 2)
    check("a schema with no values: every row is a question mark", labels(rows_of(f, TH)),
          [["Preset", "?"], ["Child lock", "?"], ["Calibration", "?"], ["Max limit", "?"], ["Sensor", "?"]])
    driver_says(f, TH, {"v": {"preset": 2, "lock": false, "calib": -2, "lmax": 40, "sensor": 1}})
    check("the values as each kind says one: a choice by its label, a flag, a range with its sign and its unit, a number", labels(rows_of(f, TH)),
          [["Preset", "Program"], ["Child lock", "Off"], ["Calibration", "-2°"], ["Max limit", "40°"], ["Sensor", "Both"]])
    driver_says(f, TH, {"v": {"calib": 3, "lock": true}})
    check("a range above zero has its plus sign", [labels(rows_of(f, TH))[2], labels(rows_of(f, TH))[1]], [["Calibration", "+3°"], ["Child lock", "On"]])
    check("each kind has its touch: a choice and a range open their list, a flag toggles, a number the keypad, and what is only read, none", taps(rows_of(f, TH)),
          [["thermostat", "pick", TH, "preset"], ["thermostat", "toggle", TH, "lock"], ["thermostat", "pick", TH, "calib"],
           ["keyboard", "thermostatNumber", TH, "lmax"], nil])
    ui.prefs["editing"] = false
    check("with Editing off the rows are facts: no touch", taps(rows_of(f, TH)), [nil, nil, nil, nil, nil])
    ui.prefs["editing"] = true
    driver_says(f, TH, {"v": {"preset": 9}})
    check("a choice the options do not have is a question mark", labels(rows_of(f, TH))[0], ["Preset", "?"])
    driver_says(f, TH, {"v": {"preset": -1}})
    check("and one below the first is too, and not the last", labels(rows_of(f, TH))[0], ["Preset", "?"])
    driver_says(f, TH, {"v": {"preset": "Eco", "calib": "x", "lmax": true}})
    check("and what is no number, in a choice, a range or a number, is a question mark and not an error", [labels(rows_of(f, TH))[0], labels(rows_of(f, TH))[2], labels(rows_of(f, TH))[3]],
          [["Preset", "?"], ["Calibration", "?"], ["Max limit", "?"]])
    driver_says(f, TH, {"v": {"preset": 2, "calib": 3, "lmax": 40}})

    # the choice lists: the options of a list, the whole numbers of a range, a dot on the one the device has
    var pick = ui.list_view(["thermostatChoice", TH, "preset"])
    check("a choice's list: a title of the setting's, the options in order, the dot on the one it has, a touch on the others", [pick[0], labels(pick[2]), pick[2][2][0], pick[2][0][0], taps(pick[2])],
          ["Preset", [["Manual", ""], ["Temporary", ""], ["Program", ""], ["Eco", ""]], "dotOn", "dotOff",
           [["thermostat", "choose", TH, "preset", 0], ["thermostat", "choose", TH, "preset", 1], nil, ["thermostat", "choose", TH, "preset", 3]]])
    var span = ui.list_view(["thermostatChoice", TH, "calib"])[2]
    check("a range's list: every whole number, the sign shown, the dot on the one it has", [size(span), span[0][2], span[10][2], span[13][2], span[13][0]], [21, "-10°", "0°", "+3°", "dotOn"])
    check("and what a choice sends is the number itself", [span[0][5], span[20][5]], [["thermostat", "choose", TH, "calib", -10], ["thermostat", "choose", TH, "calib", 10]])
    check("a setting the schema has not: an empty list", ui.list_view(["thermostatChoice", TH, "nope"])[2], [])
    var calib = PanelThermostatSettings.entry(c, TH, "calib")
    check("the place of a value the list has not is the first, and of one it has, where it is", [PanelThermostatSettings.index_of(calib, 99), PanelThermostatSettings.index_of(calib, -10), PanelThermostatSettings.index_of(calib, 10)], [0, 0, 20])

    # a device with no settings: its schema is a list of nothing, which the screen says
    say_schema(f, TH, [], 2)
    check("an empty schema is a screen that says there are none", labels(rows_of(f, TH)), [["No settings", ""]])
end
screen_checks()

def touch_settings_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    store.register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    store.add_to_zone("hall", TH)
    ui.prefs["editing"] = true
    var rows = def (view) return ui.list_view(view)[2] end
    # a thermostat's options: no Settings and no Identify, which are its page's now
    var opt = def () var out = [] for r: ui.list_view(["deviceOptions", TH])[2] out.push(r[2]) end return out end
    check("a thermostat's options have neither Settings nor Identify", [opt().find("Settings"), opt().find("Identify")], [nil, nil])
    ui.prefs["editing"] = false
    check("with Editing off, only its Info", opt(), ["Info"])
    ui.prefs["editing"] = true
    check("its page's row: the Settings icon, and no Identify", PanelPageButtons.icons(ui, ["thermostat", "d", TH]), ["settings"])

    # open: the driver is asked for them, and the screen is on top, reading
    var out = ui.act(["thermostat", "open", TH])
    check("opening asks the driver for the schema and the values first, and the screen is on top", [out[0], ui.top()["view"], size(out) > 1], [["thermostat", [TH], "settings", nil], ["thermostatSettings", TH], true])
    check("drawn, as the list's page, reading the device", [has_effect(out, "set"), ui.page], [true, ui.page_of(["thermostatSettings", TH])])
    f["effects"].clear()
    say_schema(f, TH, schema_entries(), 2)
    driver_says(f, TH, {"v": {"preset": 2, "lock": false, "calib": -2, "lmax": 40, "sensor": 1}})
    f["effects"].clear()
    driver_says(f, TH, {"v": {"lock": true}})
    check("a value that comes while the screen is on show draws it again", has_effect(f["effects"], "set"), true)
    f["effects"].clear()
    store.register_device([TH2, "Thermostat 2", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    driver_says(f, TH2, {"v": {"lock": true}})
    check("and one of another device does not", f["effects"], [])
    # the keypad of a number is up: the screen under it is not written on
    ui.act(["keyboard", "thermostatNumber", TH, "lmax"])
    f["effects"].clear()
    driver_says(f, TH, {"v": {"lmax": 38}})
    check("a value that comes while the keypad is up draws nothing, and is kept for when it is left", [f["effects"], f["thermostat"].values[TH]["lmax"]], [[], 38])
    ui.commit("")
    f["effects"].clear()
    driver_says(f, TH, {"v": {"lmax": 40}})

    # a flag: toggled to what it is not, and the screen shows what the driver says
    check("a flag is turned over: on goes to off", ui.act(["thermostat", "toggle", TH, "lock"]), [["thermostat", [TH], "setting", false, "lock"]])
    driver_says(f, TH, {"v": {"lock": false}})
    check("and off goes to on", ui.act(["thermostat", "toggle", TH, "lock"]), [["thermostat", [TH], "setting", true, "lock"]])
    check("the screen shows what the driver said, and not what was asked", rows(["thermostatSettings", TH])[1][3], "Off")
    check("what is only read, and what the schema has not, is not touched", [ui.act(["thermostat", "toggle", TH, "sensor"]), ui.act(["thermostat", "toggle", TH, "nope"])], [[], []])
    ui.prefs["editing"] = false
    check("and with Editing off nothing is", ui.act(["thermostat", "toggle", TH, "lock"]), [])
    ui.prefs["editing"] = true

    # a choice: its list opens on the page of the one the device has, and a touch takes another and goes back
    ui.act(["thermostat", "pick", TH, "calib"])
    check("the list of a range opens on the page of the value the device has", [ui.top()["view"], ui.top()["page"]], [["thermostatChoice", TH, "calib"], 8 / 3])
    var chosen = ui.act(["thermostat", "choose", TH, "calib", 4])
    check("a choice goes to the driver and the list is left", [chosen[0], ui.top()["view"]], [["thermostat", [TH], "setting", 4, "calib"], ["thermostatSettings", TH]])
    check("the screen still shows the value the driver last said", rows(["thermostatSettings", TH])[2][3], "-2°")

    # a number: the keypad, in the range, and nothing otherwise
    var kb = ui.act(["keyboard", "thermostatNumber", TH, "lmax"])
    check("the keypad opens on the number the device has, as long as the biggest", [kb[0], kb[1], ui.editing], [["set", "$keyboard.value", "40"], ["set", "$keyboard.max", 3], ["keyboard", "thermostatNumber", TH, "lmax"]])
    check("a number in the range goes to the driver", ui.commit("42")[0], ["thermostat", [TH], "setting", 42, "lmax"])
    check("and the keypad is left", ui.editing, nil)
    var edges = []
    for text: ["35", "45"]
        ui.act(["keyboard", "thermostatNumber", TH, "lmax"])
        edges.push(ui.commit(text)[0])
    end
    check("the ends of the range are in it", edges, [["thermostat", [TH], "setting", 35, "lmax"], ["thermostat", [TH], "setting", 45, "lmax"]])
    var rejected = []
    for text: ["50", "34", "", "4a", "-5", "40a", "4.0", " 40"]
        ui.act(["keyboard", "thermostatNumber", TH, "lmax"])
        var r = ui.commit(text)
        rejected.push(has_effect(r, "thermostat"))
    end
    check("past the range, below it, empty and no number, or with more than digits: nothing goes", rejected, [false, false, false, false, false, false, false, false])

    # leaving the screen lets go of its schema
    check("the schema is there while the screen is", f["thermostat"].schema.contains(TH), true)
    ui.back()
    check("and goes when it is left", [f["thermostat"].schema.contains(TH), ui.top() == nil || ui.top()["view"][0] != "thermostatSettings"], [false, true])
end
touch_settings_checks()

# The one list: the row that says the device is being read, and the schema that comes, more rows or fewer, are drawn on
# the list's page, which the screen never leaves
def list_page_checks()
    var pages = {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail",
                 "keyboard": "editboard"}
    var f = fixture_in({"pages": pages, "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5})
    var ui = f["ui"]
    f["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    f["store"].add_to_zone("hall", TH)
    ui.prefs["editing"] = true
    var out = ui.act(["thermostat", "open", TH])
    check("opened, the screen reads the device on the list", [ui.page, out[1]], ["settings", ["page", "settings"]])
    f["effects"].clear()
    var entries = schema_entries()
    driver_says(f, TH, {"x": {"at": 0, "of": 5, "l": [entries[0], entries[1]]}})
    driver_says(f, TH, {"x": {"at": 2, "of": 5, "l": [entries[2], entries[3]]}})
    check("a schema not whole yet draws nothing", [f["effects"], ui.page], [[], "settings"])
    driver_says(f, TH, {"x": {"at": 4, "of": 5, "l": [entries[4]]}})
    check("the last frame: five rows, more than a page holds, are drawn on the same page", [ui.page, has_effect(f["effects"], "page"), has_effect(f["effects"], "set")],
          ["settings", false, true])
    f["effects"].clear()
    driver_says(f, TH, {"v": {"lock": true}})
    check("a value after that is drawn on the page it is on", [has_effect(f["effects"], "page"), has_effect(f["effects"], "set"), ui.page], [false, true, "settings"])

    # a page that is not a list's is not written on: the keypad, or another screen
    f["effects"].clear()
    ui.page = "editboard"
    driver_says(f, TH, {"v": {"lock": false}})
    check("under a page that is not a list, a value changes nothing on the glass", f["effects"], [])
    ui.page = "settings"

    # a schema of two rows, a ZCL thermostat's, which has none, is drawn there too
    f["effects"].clear()
    ui.back()
    ui.act(["thermostat", "open", TH])
    f["effects"].clear()
    driver_says(f, TH, {"x": {"at": 0, "of": 2, "l": [entries[1], entries[4]]}})
    check("two rows: no page change, and the rows are drawn", [ui.page, has_effect(f["effects"], "page"), has_effect(f["effects"], "set")], ["settings", false, true])
end
list_page_checks()

# --- the temperatures a summed-up plan card shows ---------------------------------------------
def temps_checks()
    var f = fixture()
    var plan = f["plan"]
    f["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    # the weather's rule on tenths (the layout package's table, nodes.test.mjs): .0 to .5 keeps the degree, .6 goes up, the same below zero
    var table = [[0, 0], [4, 0], [5, 0], [6, 1], [9, 1], [179, 18], [180, 18], [184, 18], [185, 18], [186, 19], [189, 19],
                 [-4, 0], [-5, 0], [-6, -1], [-184, -18], [-185, -18], [-186, -19], [-95, -9], [-96, -10], [-406, -41], [996, 100], [-1005, -100]]
    var got = []
    var want = []
    for t: table
        got.push(PanelThermostat.degrees(t[0]))
        want.push(t[1])
    end
    check("tenths of a degree rounded as the weather's are", got, want)
    check("what is no number is nothing, and a real is taken as the whole it is", [PanelThermostat.degrees(nil), PanelThermostat.degrees("21"), PanelThermostat.degrees(215.0)], [nil, nil, 21])
    check("a zero is never a negative one", str(PanelThermostat.degrees(-5)), "0")

    # told to the plan whenever the room's or the floor's come: whole degrees, which the plan compares
    driver_says(f, TH, {"s": {"cur": 213}})
    check("the room's alone: the room, and no floor", plan.temps, [[TH, [21, nil]]])
    driver_says(f, TH, {"s": {"floor": 271}})
    check("then the floor's: both", plan.temps[1], [TH, [21, 27]])
    driver_says(f, TH, {"s": {"cur": 216}})
    check("a new room: the new whole degrees, with the floor it had", plan.temps[2], [TH, [22, 27]])
    driver_says(f, TH, {"s": {"mode": "heat", "set": 220, "dem": 100}})
    check("a state with no temperature in it says nothing of them", size(plan.temps), 3)
    driver_says(f, TH, {"s": {"cur": 216}})
    check("the same room again is told, and the plan is who knows it did not change", plan.temps[3], [TH, [22, 27]])
    driver_says(f, LAMP, {"s": {"cur": 200}})
    check("a device that is no thermostat is not told", size(plan.temps), 4)

    # a device that left takes its temperatures from the card
    f["thermostat"].forget(TH)
    check("a thermostat that left: the plan is told it has none", plan.temps[4], [TH, nil])

    # no plan: nothing to tell, and nothing raised
    var bare = fixture()
    bare["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    bare["zb"].plan = nil
    driver_says(bare, TH, {"s": {"cur": 213, "floor": 271}})
    check("with no plan the state is kept and nothing is told", bare["thermostat"].get(TH, "cur", nil), 213)
end
temps_checks()

# --- the thermostat that is heating: told to the plan, and the colour of its rows and counters ----------------------
def heating_checks()
    var f = fixture()
    var plan = f["plan"]
    var store = f["store"]
    var ui = f["ui"]
    store.register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    store.add_to_zone("hall", TH)
    driver_says(f, TH, {"s": {"mode": "off", "dem": 0}})
    check("the plan is told, with each word of the mode or the demand: not heating", plan.heating[-1], [TH, false])
    driver_says(f, TH, {"s": {"mode": "heat", "dem": 100}})
    check("heat with a demand is heating", plan.heating[-1], [TH, true])
    driver_says(f, TH, {"s": {"dem": 0}})
    check("the demand stops: it is on and resting, and not heating", plan.heating[-1], [TH, false])
    driver_says(f, TH, {"s": {"dem": 60}})
    driver_says(f, TH, {"s": {"mode": "off"}})
    check("off is not heating, whatever the demand last said", plan.heating[-1], [TH, false])
    var told = size(plan.heating)
    driver_says(f, TH, {"s": {"cur": 205, "set": 215, "floor": 270, "up": true}})
    check("a state with no mode and no demand says nothing of heating", size(plan.heating), told)
    driver_says(f, LAMP, {"s": {"mode": "heat", "dem": 100}})
    check("a device that is no thermostat is not told", size(plan.heating), told)
    driver_says(f, TH, {"s": {"mode": "heat", "dem": 100}})
    var heats = size(plan.heating)
    f["thermostat"].forget(TH)
    check("a thermostat that left while it heated: the plan is told it does not heat", [size(plan.heating) - heats, plan.heating[-1]], [1, [TH, false]])
    var bare = fixture()
    bare["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    bare["zb"].plan = nil
    driver_says(bare, TH, {"s": {"mode": "heat", "dem": 100}})
    check("with no plan the state is kept and nothing is told", bare["thermostat"].heating(TH), true)

    # a zone's screen: the row and the counter of a thermostat in the warm tone only while it heats, and a command on its way over it
    var g = fixture()
    g["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    g["store"].add_to_zone("hall", TH)
    var rows = def (ui2)
        var out = {}
        for e: ui2.render_zone({"view": ["zone", "hall"], "page": 0})
            if e[0] == "set" out[e[1]] = e[2] end
        end
        return out
    end
    var tone = def (ui2, id)
        var sets = rows(ui2)
        # the thermostat is the hall's last device, and the zone's rows and counters say its colour
        for k: 0 .. 2
            if sets.find("$zone.counts." + str(k) + ".icon") == "thermostatOn" || sets.find("$zone.counts." + str(k) + ".icon") == "thermostatOff"
                return sets["$zone.counts." + str(k) + ".iconColor"]
            end
        end
        return nil
    end
    driver_says(g, TH, {"s": {"mode": "off", "dem": 0}})
    check("a thermostat that is off: its counter is the plain unlit tone", tone(g["ui"], TH), "icon-off")
    driver_says(g, TH, {"s": {"mode": "heat", "dem": 0}})
    check("on and resting: the lit tone, as a lamp's", tone(g["ui"], TH), "icon-low-sat")
    driver_says(g, TH, {"s": {"dem": 100}})
    check("heating: the warm tone", tone(g["ui"], TH), "icon-heating")
    check("and the device's own row too", g["ui"].device_look(TH), ["on", "thermostatOn", "icon-heating"])
    g["ui"].unconfirmed[TH] = ["off", 1]
    check("a command on its way is the accent tone, over the warm one", g["ui"].device_look(TH)[2], "accent-blue")
    g["ui"].unconfirmed.remove(TH)
    driver_says(g, TH, {"s": {"up": false}})
    check("no communication is the glyph of its own, and not the warm tone", g["ui"].device_look(TH), ["noanswer", "thermostatNoAnswer", "icon-off"])
    driver_says(g, TH, {"s": {"up": true}})
    # a lamp beside it is as it was: its relay is on, and its row the lit tone, whatever the thermostat does
    check("a lamp's row is the lit tone, and the thermostat does not touch it", g["ui"].device_look("relay:1"), ["on", "lightOn", "icon-low-sat"])
end
heating_checks()

# --- a thermostat's page ----------------------------------------------------------------------------
# what it says by the device's state, what its touches ask, the joint mode of a zone's, and what makes it follow the device
def sets_of(effects)
    var out = {}
    for e: effects
        if e[0] == "set"  out[e[1]] = e[2] end
    end
    return out
end

def page_fixture()
    var f = fixture()
    f["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    f["store"].add_to_zone("hall", TH)
    f["ui"].live[TH] = "on"
    driver_says(f, TH, {"d": description(nil), "s": {"cur": 208, "set": 215, "mode": "heat", "dem": 100, "floor": 275}})
    return f
end

def page_checks()
    var f = page_fixture()
    var ui = f["ui"]
    var out = ui.thermostat_open(["d", TH])
    check("a thermostat's page opens on top, and is drawn on its own page", [ui.top()["view"], out[0], ui.page], [["thermostat", "d", TH], ["page", "thermostat"], "thermostat"])
    var s = sets_of(out)
    check("its title is the thermostat's name", s["$thermostat.name"], "Thermostat 1")
    check("the target is a decimal and the unit, and the line says the room's and the floor's; what it does is the lit mode's",
          [s["$thermostat.target"], s["$thermostat.lines.0"], s.contains("$thermostat.lines.1")], ["21.5°C", "Room 20.8°  Floor 27.5°", false])
    check("the buttons say - and +, faces with no number, and none is dim", [s["$thermostat.minus.icon"], s["$thermostat.plus.icon"], s.contains("$thermostat.minus.count"),
          s.contains("$thermostat.plus.count"), s["$thermostat.minus.iconColor"], s["$thermostat.plus.iconColor"]], ["minus", "add", false, false, "text-primary", "text-primary"])
    check("the modes are Off and Heat, and the one it is in is lit", [s["$thermostat.modes.0.label"], s["$thermostat.modes.0.on"], s["$thermostat.modes.1.label"], s["$thermostat.modes.1.on"]],
          ["Off", 0, "Heat", 1])
    var say = def (state) driver_says(f, TH, {"s": state}) return sets_of(ui.render_thermostat(["thermostat", "d", TH])) end
    var rest = say({"dem": 0})
    check("on and with no demand it rests, and Heat is still the lit mode", [rest["$thermostat.modes.0.on"], rest["$thermostat.modes.1.on"]], [0, 1])
    var off = say({"mode": "off"})
    check("off lights Off", [off["$thermostat.modes.0.on"], off["$thermostat.modes.1.on"]], [1, 0])
    ui.live[TH] = "noanswer"
    var silent = sets_of(ui.render_thermostat(["thermostat", "d", TH]))
    check("a thermostat that does not answer lights no mode: what it last said is not what is there", [silent["$thermostat.modes.0.on"], silent["$thermostat.modes.1.on"]], [0, 0])
    ui.live[TH] = "on"
    driver_says(f, TH, {"s": {"mode": "heat", "dem": 100}})
    # the buttons that can go no further are dim
    var lo = say({"set": 50})
    check("at the lowest the - is dim, and the + is not", [lo["$thermostat.target"], lo["$thermostat.minus.iconColor"], lo["$thermostat.plus.iconColor"]], ["5.0°C", "icon-off", "text-primary"])
    var hi = say({"set": 350})
    check("at the highest the + is dim", [hi["$thermostat.target"], hi["$thermostat.minus.iconColor"], hi["$thermostat.plus.iconColor"]], ["35.0°C", "text-primary", "icon-off"])
    # nothing said yet: the words of nothing
    var g = page_fixture()
    g["thermostat"].state.remove(TH)
    var none = sets_of(g["ui"].thermostat_open(["d", TH]))
    check("a thermostat the driver has said nothing of: the target and the room are two hyphens", [none["$thermostat.target"], none["$thermostat.lines.0"]], ["--", "Room --"])
    # and a project whose page does not exist is no page at all
    var old = fixture_in({"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard"},
                          "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5})
    old["store"].register_device([TH, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    check("a project with no thermostat page opens none", old["ui"].thermostat_open(["d", TH]), [])
end
page_checks()

def touch_page_checks()
    var f = page_fixture()
    var ui = f["ui"]
    ui.thermostat_open(["d", TH])
    tasmota.at_ms = 10000
    var up = ui.thermostat_step("$thermostat.plus.count")
    var s = sets_of(up)
    check("the + takes the target a step on, at once: shown, and asked of the brain for a moment after", [s["$thermostat.target"], up[-1]], ["22.0°C", ["thermostatTarget", [TH], 220]])
    var again = ui.thermostat_step("$thermostat.plus.count")
    check("and another touch is from what the finger left, not from the device's: 22.5, and the last asked is that", [sets_of(again)["$thermostat.target"], again[-1]], ["22.5°C", ["thermostatTarget", [TH], 225]])
    var less = ui.thermostat_step("$thermostat.minus.count")
    check("the - goes back", [sets_of(less)["$thermostat.target"], less[-1][2]], ["22.0°C", 220])
    check("what is no button of the page's does nothing", [ui.thermostat_step("$thermostat.modes.0.label"), ui.thermostat_step("nonsense")], [[], []])
    # the device answers with what was asked: the draft is the device's word, and goes
    f["thermostat"].on_state(TH, {"set": 220})
    check("the device says the target the finger set: the draft goes", size(ui.thermostat_drafts()), 0)
    # what the device says over a draft that is not its own is shown when the time is up
    ui.thermostat_step("$thermostat.plus.count")
    f["thermostat"].on_state(TH, {"set": 215})
    check("another word of the device, while the finger's is fresh, leaves the finger's on the page", sets_of(ui.render_thermostat(["thermostat", "d", TH]))["$thermostat.target"], "22.5°C")
    tasmota.at_ms = 10000 + PanelUi.DRAFT_MS + 100
    check("and when the time is up, the device's word is the page's: a device that refused leaves its own", sets_of(ui.render_thermostat(["thermostat", "d", TH]))["$thermostat.target"], "21.5°C")
    # the limits of the range stop the steps, and a target off the step's grid goes to the grid's next point
    f["thermostat"].on_state(TH, {"set": 350})
    check("at the highest the + does nothing", ui.thermostat_step("$thermostat.plus.count"), [])
    f["thermostat"].on_state(TH, {"set": 50})
    check("and at the lowest the -", ui.thermostat_step("$thermostat.minus.count"), [])
    f["thermostat"].on_state(TH, {"set": 213})
    check("a target a ZCL thermostat left off the grid: the + goes to the grid's point above, and the - to the one below",
          [ui.thermostat_step("$thermostat.plus.count")[-1][2], ui.thermostat_step("$thermostat.minus.count")[-1][2]], [215, 210])
    tasmota.at_ms = nil
    # a mode: every thermostat of the page goes to it
    check("the second slot is Heat", ui.thermostat_mode("$thermostat.modes.1.label"), [["thermostat", [TH], "mode", "heat"]])
    check("and the first Off", ui.thermostat_mode("$thermostat.modes.0.label"), [["thermostat", [TH], "mode", "off"]])
    check("a slot with no mode, and no slot at all, ask for nothing", [ui.thermostat_mode("$thermostat.modes.2.label"), ui.thermostat_mode("$list.rows.0.label")], [[], []])
    ui.back()
    check("the touches of a page that is not on show ask for nothing", [ui.thermostat_step("$thermostat.plus.count"), ui.thermostat_mode("$thermostat.modes.1.label")], [[], []])
end
touch_page_checks()

def joint_checks()
    var f = page_fixture()
    var ui = f["ui"]
    f["store"].register_device([TH2, "Thermostat 2", "thermostat", 48, 50, 300, "ZCLTH", 1, 0, 0])
    f["store"].add_to_zone("hall", TH2)
    ui.live[TH2] = "off"
    driver_says(f, TH2, {"d": description({"max": 300, "floor": false}), "s": {"cur": 220, "set": 225, "mode": "off", "dem": 0}})
    var s = sets_of(ui.thermostat_open(["t", "hall", 0]))
    check("the joint page: the zone's name and how many", s["$thermostat.name"], "Hall · 2 thermostats")
    check("the target is the median of theirs (the lower of two), the room's the mean, the floor's the one that has a probe's", [s["$thermostat.target"], s["$thermostat.lines.0"]],
          ["21.5°C", "Room 21.4°  Floor 27.5°"])
    check("one is on: Heat is lit, and Off is not", [s["$thermostat.modes.1.on"], s["$thermostat.modes.0.on"]], [1, 0])
    var up = ui.thermostat_step("$thermostat.plus.count")
    check("a touch on the + sets every one of them, from the median", [up[-1], sets_of(up)["$thermostat.target"]], [["thermostatTarget", [TH, TH2], 220], "22.0°C"])
    check("the range is the narrowest of the members': the one that takes 30 stops the + at 30",
          PanelThermostatView.span(f["thermostat"], PanelThermostatView.members(f["store"], ["thermostat", "t", "hall", 0])), [50, 300, 5])
    check("a mode goes to every one", ui.thermostat_mode("$thermostat.modes.0.label"), [["thermostat", [TH, TH2], "mode", "off"]])
    # one thermostat alone is the page of its own
    f["store"].remove_device(TH2)
    ui.target_draft = {}
    ui.back()
    var one = sets_of(ui.thermostat_open(["t", "hall", 0]))
    check("a joint page of one is the page of that one, with the zone's name still the title", [one["$thermostat.name"], one["$thermostat.target"]], ["Hall · 1 thermostat", "21.5°C"])
    # the page of a zone that does not exist, or whose thermostats left, closes itself
    var gone = fixture()
    var back = gone["ui"].open(["thermostat", "d", "0xFFFF"])
    check("a page of nothing goes back", gone["ui"].top() == nil || gone["ui"].top()["view"][0] != "thermostat", true)
end
joint_checks()

# what a page is about: a zone's thermostats of the one relay, and nothing else of the zone; a device's page, a thermostat's only. And
# what each says of itself: its own step, and modes for the slots it has
def members_checks()
    var f = page_fixture()
    var store = f["store"]
    var V = PanelThermostatView
    # the Hall, the one zone of the Living room with room: beside the thermostat of the page, one the first relay feeds, one fed by none as
    # it is, and a lamp fed by none
    var lamp = "0x00124B0000E00099"
    store.register_device([TH2, "Thermostat 2", "thermostat", 48, 50, 300, "ZCLTH", 1, 0, 1])
    store.register_device([TH3, "Thermostat 3", "thermostat", 48, 50, 300, "ZCLTH", 1, 0, 0])
    store.register_device([lamp, "Lamp 9", "light", 3, 0, 0, "", 1, 0, 0])
    var added = []
    for id: [TH2, TH3, lamp]  added.push(store.add_to_zone("hall", id)["ok"]) end
    var ids = def (view)
        var out = []
        for d: V.members(store, view)  out.push(d[0]) end
        return out
    end
    check("a zone's thermostats of a relay: those it feeds, and not the lamp beside them, nor the one another relay feeds",
          [added, ids(["thermostat", "t", "hall", 0]), ids(["thermostat", "t", "hall", 1])], [[true, true, true], [TH, TH3], [TH2]])
    check("a device's page is a thermostat's: a lamp's is of nothing, and so is one the store does not have",
          [ids(["thermostat", "d", TH3]), ids(["thermostat", "d", lamp]), ids(["thermostat", "d", "0xFFFF"])], [[TH3], [], []])
    # a page made with more lines than the view has words, as an older one: the line left over is blank
    var two = sets_of(V.page(f["thermostat"], store, ["thermostat", "d", TH], V.members(store, ["thermostat", "d", TH]), ["on"], {}, 2, 2))
    check("a second line, on a page that has one, is blank", [two["$thermostat.lines.0"] != "", two["$thermostat.lines.1"]], [true, ""])
    # a page with more slots for modes than the thermostat has modes: the slot left over is empty, and dark
    var m = sets_of(V.modes(f["thermostat"], V.members(store, ["thermostat", "d", TH]), ["on"], 3))
    check("a slot with no mode of the thermostat's says nothing and is not lit", [m["$thermostat.modes.1.label"], m["$thermostat.modes.2.label"], m["$thermostat.modes.2.on"]], ["Heat", "", 0])
    # a thermostat that steps a whole degree: the step its driver says, and not the half degree of the ZHT-SR
    driver_says(f, TH, {"d": description({"step": 10}), "s": {"set": 210}})
    var ui = f["ui"]
    ui.thermostat_open(["d", TH])
    check("the step is the thermostat's own: a whole degree from 21 is 22", [V.span(f["thermostat"], V.members(store, ["thermostat", "d", TH])),
          ui.thermostat_step("$thermostat.plus.count")[-1]], [[50, 350, 10], ["thermostatTarget", [TH], 220]])
end
members_checks()

# the page's own small rules: how a number is written, how some are made one, and the word for what the thermostats are doing
def view_helper_checks()
    var V = PanelThermostatView
    check("tenths of a degree as degrees to a decimal, below zero too", [V.degrees(215), V.degrees(5), V.degrees(0), V.degrees(-35), V.degrees(-5)], ["21.5", "0.5", "0.0", "-3.5", "-0.5"])
    check("the mean to the nearest, half away from zero", [V.mean([215, 225]), V.mean([200, 201, 202]), V.mean([215, 216]), V.mean([-35, -36]), V.mean([7]), V.mean([])], [220, 201, 216, -36, 7, nil])
    check("the median, the lower one of two", [V.median([3, 1, 2]), V.median([4, 1]), V.median([9]), V.median([])], [2, 1, 9, nil])
end
view_helper_checks()

def follow_checks()
    var f = page_fixture()
    var ui = f["ui"]
    var zb = f["zb"]
    # a zone's screen opens the page by a hold on the thermostat's icon, and on its counter
    ui.open(["zone", "hall"])
    var counts = zb.ui.zone_groups(f["store"].find_zone("hall"))
    var th = 0
    for i: 0 .. size(counts) - 1
        if counts[i][0] == "thermostat" th = i end
    end
    ui.zone_row("$zone.counts." + str(th) + ".count", 0, "hold")
    check("a hold on the thermostats' counter opens their joint page", ui.top()["view"], ["thermostat", "t", "hall", 0])
    ui.back()
    var rows = PanelUi.members_in_order(f["store"].find_zone("hall"))
    var at = 0
    for i: 0 .. size(rows) - 1
        if rows[i] == TH at = i end
    end
    ui.zone_row("$zone.rows." + str(at % 2) + ".label", at / 2, "iconHold")
    check("a hold on its row's icon opens its own", ui.top()["view"], ["thermostat", "d", TH])
    # what makes the page follow the device
    ui.page = "thermostat"
    check("a device of the page that says something: the page is drawn again", size(ui.refresh_for(TH)) > 0, true)
    check("another device's word is not the page's", ui.refresh_for("0x00124B0000B00099"), [])
    ui.page = "zone"
    check("the page is not on the glass (a keyboard, say): nothing is written over it", ui.refresh_for(TH), [])
    ui.page = "thermostat"
    zb.to_refresh = {}
    f["thermostat"].on_state(TH, {"cur": 210})
    check("a temperature while the page is on show is drawn in a moment", zb.to_refresh.contains(TH), true)
    zb.to_refresh = {}
    f["thermostat"].on_state(TH, {"set": 230})
    check("and so is a target the dial set, which changes nothing else", zb.to_refresh.contains(TH), true)
    zb.to_refresh = {}
    ui.page = "zone"
    f["thermostat"].on_state(TH, {"cur": 211})
    check("and one with another page on the glass is not", zb.to_refresh.contains(TH), false)
    ui.page = "thermostat"
    ui.back()
    zb.to_refresh = {}
    f["thermostat"].on_state(TH, {"cur": 212})
    check("nor one with the page closed", zb.to_refresh.contains(TH), false)
    # the title is renamed by a hold, with Editing, as a lamp's detail is: the thermostat's name, and a joint page's zone's
    ui.prefs["editing"] = true
    ui.open(["thermostat", "d", TH])
    check("a hold on the title renames the thermostat", ui.rename_top()[0], ["set", "$keyboard.value", "Thermostat 1"])
    check("and the keyboard is the device's name", ui.editing, ["keyboard", "deviceName", TH])
    ui.cancel()
    ui.back()
    ui.open(["thermostat", "t", "hall", 0])
    ui.rename_top()
    check("a joint page's title is its zone's name", ui.editing, ["keyboard", "zoneName", "hall"])
    ui.cancel()
end
follow_checks()

# --- without the collaborator: the bridge's drivers say what the panel does not know yet -----------------
def bare_checks()
    var f = fixture()
    f["zb"].thermostat = nil
    driver_says(f, TH, {"d": description(nil), "s": {"mode": "heat"}})
    check("a panel with no thermostat state still pairs a description, and lets the state go", [f["store"].find_device(TH) != nil, size(f["plan"].reports)], [true, 0])
end
bare_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
