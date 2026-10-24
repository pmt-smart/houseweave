# berry/panel_store.be against berry/test/vectors/store.json: every case of
# the store, written by hand with what it must answer. The simulator runs
# panel_store.be too.
#
# TEST_ROOT is the repository root, written by run.mjs; the standalone
# interpreter reads the vectors and the Living room fixture straight from disk.

import json

var failures = 0
var checks = 0

def deep_eq(a, b)
    if a == nil || b == nil return a == nil && b == nil end
    if isinstance(a, list)
        if !isinstance(b, list) || size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if !deep_eq(a[i], b[i]) return false end
        end
        return true
    end
    if isinstance(a, map)
        if !isinstance(b, map) || size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !deep_eq(a[k], b[k]) return false end
        end
        return true
    end
    return a == b
end

def check(name, got, want)
    checks += 1
    if !deep_eq(got, want)
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

var vectors = json.load(read_text("berry/test/vectors/store.json"))
var living_room_text = read_text("berry/test/fixtures/living-room.json")
var living_room_us_text = read_text("berry/test/fixtures/living-room-us.json")

# --- text -------------------------------------------------------------------------
for c: vectors["parsePlaces"] check("parsePlaces " + json.dump(c[0]), PanelText.parse_places(c[0]), c[1]) end
for c: vectors["parseSize"] check("parseSize " + json.dump(c[0]), PanelText.parse_size(c[0]), c[1]) end
for c: vectors["formatPlace"] check("formatPlace " + json.dump(c[0]), PanelText.format_place(c[0]), c[1]) end
for c: vectors["formatSize"] check("formatSize " + json.dump(c[0]), PanelText.format_size(c[0]), c[1]) end
# a zone's slot is the screen's place, and back
var places_store = PanelStore(json.load(living_room_text))
for c: vectors["slotPlace"] check("slotPlace " + json.dump(c), places_store.slot_place(places_store.find_zone(c[0]), c[1]), c[2]) end
for c: vectors["placeSlot"] check("placeSlot " + json.dump(c), places_store.place_slot(places_store.find_zone(c[0]), c[1]), c[2]) end
for c: vectors["toggleIntent"] check("toggleIntent " + json.dump(c[0]), PanelStore.toggle_intent(c[0]), c[1]) end
for c: vectors["deviceProfile"] check("deviceProfile " + json.dump(c[0]), PanelStore.device_profile(c[0][0], c[0][1], c[0][2]), c[1]) end
for c: vectors["autoName"] check("autoName " + c[0], PanelStore(json.load(living_room_text)).auto_name(c[0]), c[1]) end

# an older document as this version has it: a version 3 relay device on several
# places is one relay device a place, a version 4 member's list
# of one place is its place, and a version 5 zone's members are a map, and its
# grid, like the plan's matrix, the slot of its last cell
for c: vectors["upgrade"]
    var doc = json.load(json.dump(c[0]))
    PanelStore.upgrade(doc)
    check("upgrade to version " + str(PanelStore.FORMAT) + " from " + str(c[0]["v"]), doc, c[1])
end
# a device with no place, which only a document made elsewhere has, has none to swap
var bare = PanelStore(json.load(living_room_text))
bare.find_zone("hall")["members"]["relay:1"] = 0
check("a device with no place is refused the swap", bare.set_slot("hall", "relay:1", 201, true), {"ok": false, "refusal": "no_swap", "detail": "relay:2"})
check("and the other keeps its place", bare.find_zone("hall")["members"]["relay:2"], 201)
# the document keeps a grid as the slot of its last cell; the operations speak [rows, cols]
check("a grid, as the operations give it", PanelStore.grid_of(bare.find_zone("middle")), [3, 4])
check("and the matrix, as PanelPlan takes it", bare.matrix(), [8, 5])
for c: vectors["configProfile"] check("configProfile " + json.dump(c[0]), PanelStore.config_profile(c[0]), c[1]) end

# --- placement: the Living room lands where the croqui has it, cell by cell ------------
var pl = vectors["placement"]
var m = pl["matrix"]
var blocks = []
for i: 0 .. size(pl["sequence"]) - 1
    var step = pl["sequence"][i]
    if i == 4
        var g = pl["ghostAfterFour"]
        check("the dashed card before the Kitchen", PanelPlan.ghost_start(blocks, m), g)
        for n: pl["nextAfterFour"]
            check("next after " + json.dump(n[1]), PanelPlan.next_place_for(blocks, m, n[0][0], n[0][1], n[1][0], n[1][1]), n[2])
        end
    end
    check("card " + str(i + 1), PanelPlan.place_for(blocks, m, step[0][0], step[0][1]), step[1])
    blocks.push([step[1][0], step[1][1], step[0][0], step[0][1]])
end

# on the US, the Living room built tall ones first lands as the turned croqui
# --- shapes: a card takes the free cells of its grid, in one piece or in
# several, and a grid typed is cut at the plan's edge
for sh: [vectors["shapes"], vectors["shapesAtTheEdge"]]
    for c: sh.find("holesAt", [])
        var b = c[0]
        check("holesAt " + json.dump(b), PanelPlan.holes_at(sh["blocks"], sh["matrix"], b[0], b[1], b[2], b[3]), c[1])
    end
    for c: sh.find("ghostTo", [])
        check("ghostTo " + json.dump(c[0]), PanelPlan.ghost_to(sh["blocks"], sh["matrix"], c[0], c[1][0], c[1][1]), c[2])
    end
    for c: sh.find("ghostResized", [])
        check("ghostResized " + json.dump(c[0]), PanelPlan.ghost_resized(sh["blocks"], sh["matrix"], c[0], c[1][0], c[1][1]), c[2])
    end
end
# the pieces a card makes: a ring is one, and a row taken out of three leaves two
check("a ring is one piece", PanelPlan.pieces(3, 3, def (c, r) return !(c == 1 && r == 1) end),
      [[[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]])
check("a row taken out leaves two", PanelPlan.pieces(3, 3, def (c, r) return r != 1 end),
      [[[0, 0], [1, 0], [2, 0]], [[0, 2], [1, 2], [2, 2]]])

var pu = vectors["placementUS"]
var bu = []
for i: 0 .. size(pu["sequence"]) - 1
    var step = pu["sequence"][i]
    check("US card " + str(i + 1), PanelPlan.place_for(bu, pu["matrix"], step[0][0], step[0][1]), step[1])
    bu.push([step[1][0], step[1][1], step[0][0], step[0][1]])
end

# --- the turn: the Living room of the EU, a quarter clockwise, is the Living room of the US ---
var turning = PanelStore(json.load(living_room_text))
turning.turn_plan(true)
check("the Living room turned is the US fixture", turning.doc, json.load(living_room_us_text))
turning.turn_plan(false)
check("and back", turning.doc, json.load(living_room_text))
check("the US fixture is valid", PanelStore(json.load(living_room_us_text)).validate(), [])
for f: vectors["turn"]["fit"]
    var st = PanelStore(json.load(living_room_text))
    var got = st.fit_matrix(f[0])
    if type(f[1]) == "string"
        check("fit to " + json.dump(f[0]) + " refused", got["refusal"], f[1])
        check("a refused fit changes nothing", st.doc, json.load(living_room_text))
    else
        check("fit to " + json.dump(f[0]), got["value"], f[1])
    end
end
var us_store = PanelStore(json.load(living_room_us_text))
check("back into the EU is counterclockwise", us_store.fit_matrix([8, 5])["value"], -1)
check("and is the EU fixture", us_store.doc, json.load(living_room_text))

# --- scenarios, on a fresh Living room each ----------------------------------------------
def run_op(store, name, a)
    if name == "registerDevice" return store.register_device(a[0]) end
    if name == "addToZone" return store.add_to_zone(a[0], a[1]) end
    if name == "setSlot" return store.set_slot(a[0], a[1], a[2], a[3]) end
    if name == "moveToZone" return store.move_to_zone(a[0], a[1]) end
    if name == "removeDevice" return store.remove_device(a[0]) end
    if name == "replaceDevice" return store.replace_device(a[0], a[1]) end
    # the schedule's events and switches, as panel_schedule.be leaves them in the document
    if name == "setEvents"
        store.doc["events"] = a[0]
        store.doc["scheduleOff"] = a[1]
        return {"ok": true}
    end
    if name == "deleteZone" return store.delete_zone(a[0]) end
    if name == "createZone" return store.create_zone(a[0], a[1], a[2], a[3]) end
    if name == "resizeZone" return store.resize_zone(a[0], a[1]) end
    if name == "addScreen" return store.add_screen(a[0]) end
    if name == "renameScreen" return store.rename_screen(a[0], a[1]) end
    if name == "renameZone" return store.rename_zone(a[0], a[1]) end
    if name == "setDisplay" return store.set_display(a[0], a[1]) end
    if name == "setColor" return store.set_color(a[0], a[1]) end
    if name == "renameDevice" return store.rename_device(a[0], a[1]) end
    if name == "setKind" return store.set_kind(a[0], a[1]) end
    if name == "moveScreen" return store.move_screen(a[0], a[1]) end
    if name == "reorganizeScreen" return store.reorganize_screen(a[0]) end
    if name == "groupPlan" return {"ok": true, "value": store.group_plan(a[0], a[1], a[2], a[3])} end
    if name == "devicePlan" return {"ok": true, "value": store.device_plan(a[0], a[1])} end
    if name == "deleteScreen" return store.delete_screen(a[0]) end
    if name == "setMark" return store.set_mark(a[0], a[1], a[2], a[3]) end
    if name == "clearButtonMarks" return store.clear_button_marks(a[0]) end
    if name == "setRelay" return store.set_relay(a[0], a[1]) end
    if name == "addRelayDevice" return store.add_relay_device(a[0], a[1]) end
    if name == "zonePlan" return {"ok": true, "value": store.zone_plan(a[0], a[1])} end
    if name == "groupWork" return {"ok": true, "value": store.group_work()} end
    if name == "groupAnswer" return store.group_answer(a[0], a[1], a[2], a[3]) end
    if name == "moveGroup" return store.move_group(a[0]) end
    if name == "reconcile" return store.reconcile(a[0], a[1]) end
    if name == "retryFailed" return store.retry_failed() end
    if name == "buttonPlan" return {"ok": true, "value": store.button_plan(a[0], a[1])} end
    if name == "toggle"
        var zones = []
        for id: a[0] zones.push(store.find_zone(id)) end
        return {"ok": true, "value": PanelStore.toggle_intent(store.target_states(zones, a[1], a[2]))}
    end
    raise "unknown_op", name
end

def probe(store, name, a)
    var doc = store.doc
    # a member's one place, 0 for none
    if name == "slot" return store.find_zone(a[0])["members"].find(a[1]) end
    if name == "zstate" return store.find_zone(a[0])["zstate"].find(a[1]) end
    if name == "zid" return store.find_zone(a[0])["zid"] end
    if name == "buttonState"
        for g: doc["buttonGroups"]
            if g["button"] == a[0] return g["zstate"].find(a[1]) end
        end
        return nil
    end
    if name == "members" return size(store.find_zone(a[0])["members"]) end
    if name == "devices" return size(doc["devices"]) end
    if name == "cards" return size(store.find_screen(a[0])["cards"]) end
    if name == "zone" return store.find_zone(a[0]) != nil end
    if name == "screens" return size(doc["screens"]) end
    if name == "title" return store.find_screen(a[0])["title"] end
    if name == "zoneName" return store.find_zone(a[0])["name"] end
    if name == "display" return store.find_zone(a[0]).find("display") end
    if name == "color" return store.find_zone(a[0]).find("color") end
    if name == "holes" return store.find_zone(a[0]).find("holes") end
    if name == "deviceName" return store.find_device(a[0])[1] end
    if name == "kind" return store.find_device(a[0])[2] end
    if name == "screenOrder"
        var ids = []
        for s: doc["screens"] ids.push(s["id"]) end
        return ids
    end
    if name == "card"
        for c: store.find_screen(a[0])["cards"]
            if c[0] == a[1] return [c[1], c[2]] end
        end
        return nil
    end
    if name == "nextZid" return doc["nextZid"] end
    if name == "relay"
        var d = store.find_device(a[0])
        return d != nil ? d[9] : nil
    end
    if name == "buttons" return store.find_zone(a[0])["buttons"] end
    if name == "stale" return doc["stale"] end
    # each event's uid and what it is for
    if name == "events"
        var out = []
        for e: doc.find("events", []) out.push([e[0], e[1]]) end
        return out
    end
    if name == "scheduleOff" return doc.find("scheduleOff") end
    raise "unknown_probe", name
end

for sc: vectors["scenarios"]
    var store = PanelStore(json.load(living_room_text))
    var label = sc["name"]
    for i: 0 .. size(sc["ops"]) - 1
        var op = sc["ops"][i]
        var name = op[0]
        var args = op[1 .. size(op) - 1]
        var got = run_op(store, name, args)
        var want = sc["expect"][i]
        var where = label + ": " + name + " #" + str(i + 1)
        if want.contains("refusal")
            check(where + " refused", got["ok"], false)
            check(where + " refusal", got.find("refusal"), want["refusal"])
            if want.contains("detail") check(where + " detail", got.find("detail"), want["detail"]) end
        else
            check(where + " accepted", got["ok"], true)
            if !got["ok"] print("  refused with " + str(got["refusal"])) end
            if want.contains("value") check(where + " value", got.find("value"), want["value"]) end
            if want.contains("actions") check(where + " actions", got.find("actions"), want["actions"]) end
        end
    end
    for p: sc.find("probes", [])
        var want = p[size(p) - 1]
        var args = p[1 .. size(p) - 2]
        check(label + ": probe " + p[0] + " " + json.dump(args), probe(store, p[0], args), want)
    end
    check(label + ": still valid", store.validate(), [])
end

# --- Berry only: a refusal changes nothing, and the document survives persist -----
var store = PanelStore(json.load(living_room_text))
var before = json.dump(store.doc)
store.create_zone("home", "X", [2, 4], [1, 1])
store.add_to_zone("middle", "relay:2")
store.delete_screen("home")
check("a refused operation leaves the document as it was", json.dump(store.doc), before)

var broken = PanelStore(json.load(living_room_text))
broken.doc["zones"][3]["members"]["0x00124B0000E00002"] = 101
broken.doc["screens"][0]["cards"][4][2] = 3
broken.doc["zones"][0]["display"] = "wide"
# a shortcut, from before there were none: the Middle again, and a lamp
broken.doc["screens"].push({"id": "s9", "title": "Old", "cards": [["z:middle", 0, 0], ["d:0x00124B0000E00001", 5, 0]]})
var codes = []
for issue: broken.validate() codes.push(issue[0]) end
check("validate finds the doubled slot", codes.find("slot_twice") != nil, true)
check("validate finds the overlapping card", codes.find("card_place") != nil, true)
check("validate finds a display no panel draws", codes.find("display_unknown") != nil, true)
check("validate finds a zone's card on another screen", codes.find("card_elsewhere") != nil, true)
check("validate finds a card that is not a zone's", codes.find("card_ref") != nil, true)

check("the empty config is valid", PanelStore(nil).validate(), [])

store.save_now()
var reloaded = PanelStore(nil)
reloaded.load()
check("the configuration survives persist", json.dump(reloaded.doc), before)

# a configuration from a newer Berry, rolled back: kept as it is, and not saved over
do
    import persist
    var newer = {"v": PanelStore.FORMAT + 1, "zones": [{"id": "z1"}], "screens": [], "devices": []}
    persist.setmember("panel_config", newer)
    var rolled = PanelStore(nil)
    rolled.load()
    check("a configuration this Berry cannot read is not taken", rolled.readonly, true)
    check("and the panel runs on an empty one", size(rolled.doc["zones"]), 0)
    rolled.save_now()
    check("which is never saved over it", persist.find("panel_config")["v"], PanelStore.FORMAT + 1)
    persist.setmember("panel_config", json.load(before))
end

# --- the group numbers start at a drawn base ---------------
def zid_base_checks()
    # a panel flashed today: its first group draws where its numbers start
    var fresh = PanelStore(nil)
    var zone = fresh.create_zone("home", "Room", [0, 0], [2, 2])["value"]
    var lamps = []
    for i: 1 .. 4
        var id = "0x00124B0000F0000" + str(i)
        fresh.register_device([id, "Light " + str(i), "light", 1, 0, 0, "", 1, 0, 0])
        fresh.add_to_zone(zone, id)
        lamps.push(id)
    end
    var z = fresh.find_zone(zone)["zid"]
    check("a fresh panel's first group is not group 1", z != 1 && z != 0, true)
    check("it is where the drawn base is", fresh.doc["zidBase"], z)
    check("inside the range", z >= PanelStore.ZID_FIRST && z < PanelStore.ZID_FIRST + PanelStore.ZID_SPAN, true)
    check("the next number follows it", fresh.take_zid(), z + 1)
    check("and the panel is still valid", fresh.validate(), [])
    # another panel draws its own
    check("another panel draws another base", PanelStore(nil).take_zid() != z, true)
    # a lamp in a number below the base is in another panel's group: not this one's to clear
    fresh.reconcile(lamps[0], [3, z])
    check("another panel's number is left alone", fresh.doc["stale"], [])
    fresh.reconcile(lamps[0], [z, z + 1])
    check("one of this panel's, unexpected, is to be cleared", fresh.doc["stale"], [[lamps[0], z + 1]])
    fresh.find_zone(zone)["zid"] = z - 1
    var codes = []
    for issue: fresh.validate() codes.push(issue[0]) end
    check("a group below the base is an issue", codes.find("zid_behind") != nil, true)
    # a panel with groups from before counts on from them, and writes no base
    var legacy = PanelStore(json.load(living_room_text))
    var next = legacy.doc["nextZid"]
    check("a panel with groups from before counts on from them", legacy.take_zid(), next)
    check("with no base written", legacy.doc.contains("zidBase"), false)
end
zid_base_checks()

# --- the thermostat's kind -------------------------------------------
# a kind that has a target and a mode and no on/off cluster: counted second, right after
# the lamp, its only kind is itself, and nothing that sends Power reaches it
def thermostat_checks()
    var store = PanelStore(json.load(living_room_text))
    var thermo = ["0x00124B0000B00001", "Thermostat 1", "thermostat", PanelStore.CAP_SETPOINT | PanelStore.CAP_MODE, 50, 350, "", 1, 0, 0]
    store.register_device(thermo)
    check("a thermostat's caps are a target and a mode, with no on/off", thermo[3], 48)
    check("its only kind is itself, as a cover's or a sensor's", PanelStore.kinds_for(thermo), ["thermostat"])
    check("the kinds a zone lists, the blind second and the thermostat third", PanelStore.KIND_ORDER,
          ["light", "cover", "thermostat", "plug", "switch", "fan", "sensor", "remote", "generic"])
    var kinds = []
    for g: store.groups_of(["0x00124B0000E00001", thermo[0], "relay:1"]) kinds.push([g[0], g[1]]) end
    check("a zone's groups put it after the lamps' groups, relay 1's and relay 2's", kinds, [["light", 1], ["light", 2], ["thermostat", 0]])
    check("a thermostat is no actuator: no group and no Power plan reach it", store.is_zigbee_actuator(store.find_device(thermo[0])), false)
    var refused = store.set_kind(thermo[0], "light")
    check("the Type of a thermostat is refused to the others", [refused["ok"], refused["refusal"], refused["detail"]], [false, "kind_incompatible", ["thermostat"]])
    check("its name comes after the kind", store.auto_name("thermostat"), "Thermostat 2")
end
thermostat_checks()

# What a tap on a zone does to the thermostats in it: they go off with a zone that goes off, are left
# as they are when it goes on, and a zone with nothing but them has a tap that switches them, on and off
def tap_checks()
    var store = PanelStore(json.load(living_room_text))
    var lamp = "0x00124B0000A00001"
    var th = "0x00124B0000B00001"
    var th2 = "0x00124B0000B00002"
    store.register_device([lamp, "Lamp", "light", 3, 0, 0, "", 1, 0, 0])
    store.register_device([th, "Thermostat 1", "thermostat", 48, 50, 350, "", 1, 0, 0])
    store.register_device([th2, "Thermostat 2", "thermostat", 48, 50, 350, "", 1, 0, 0])
    var up = [true, true]
    # a zone by hand: the lamp and the two thermostats, and a part with the thermostats alone
    var both = {"id": "bedroom", "members": {lamp: 101, th: 102, th2: 103}, "zid": 0, "zstate": {}}
    var alone = {"id": "living_room", "members": {th: 101, th2: 102}, "zid": 0, "zstate": {}}

    # the toggle rule's word for one device
    check("what it last said", store.toggle_state(th, {th: "on"}, up, {}, {}), "on")
    check("unknown when it said nothing", store.toggle_state(th, {}, up, {}, {}), "unknown")
    check("what was asked of it and is not confirmed yet", store.toggle_state(th, {th: "on"}, up, {}, {th: ["off", 1]}), "off")
    check("unknown with no communication, whatever it said", store.toggle_state(th, {th: "on"}, up, {th: true}, {}), "unknown")
    store.find_device(th2)[9] = 1
    check("no power behind a relay held open", store.toggle_state(th2, {th2: "on"}, [false, true], {}, {}), "nopower")
    store.find_device(th2)[9] = 0

    # the zone has lamps: they say which way the tap goes
    var plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    var live = {lamp: "on", th: "on", th2: "off"}
    var tap = store.tap_intent([both], plan, live, up, {}, {})
    check("a lamp on: the tap turns the zone off", tap[0], "off")
    check("with the thermostat that is on, and not the one that is off", plan["thermostat"], [th])
    check("which waits for it as the lamp does", tap[1], [lamp, th])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    live = {lamp: "off", th: "on", th2: "on"}
    tap = store.tap_intent([both], plan, live, up, {}, {})
    check("the lamp off: the tap turns the zone on, and the thermostats stay as they are", [tap[0], plan.contains("thermostat"), tap[1]], ["on", false, [lamp]])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    live = {lamp: "on", th: "off", th2: "off"}
    tap = store.tap_intent([both], plan, live, up, {}, {})
    check("the zone goes off with the thermostats already off: none is told", [tap[0], plan.contains("thermostat"), tap[1]], ["off", false, [lamp]])

    # the zone has nothing but thermostats: the tap switches them as a row's icon does, all off if
    # one is on and all to Heat if none is, each that has power and is not there already
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    tap = store.tap_intent([alone], plan, {th: "on", th2: "off"}, up, {}, {})
    check("one is on: the tap turns it off, and the one already off is left", [tap[0], plan["thermostat"], tap[1]], ["off", [th], [th]])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    tap = store.tap_intent([alone], plan, {th: "off", th2: "off"}, up, {}, {})
    check("all are off: the tap turns them all on, which wait for it", [tap[0], plan["thermostat"], tap[1]], ["on", [th, th2], [th, th2]])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    tap = store.tap_intent([alone], plan, {}, up, {}, {})
    check("none said anything: the tap tries them, on", [tap[0], plan["thermostat"]], ["on", [th, th2]])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    tap = store.tap_intent([alone], plan, {th: "on", th2: "off"}, up, {th2: true}, {})
    check("one on and one with no communication: off, and the silent one is tried too", [tap[0], plan["thermostat"]], ["off", [th, th2]])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    tap = store.tap_intent([alone], plan, {th: "off", th2: "off"}, up, {}, {th: ["on", 1], th2: ["on", 1]})
    check("a tap in the pending time of one that turned them on turns them back off", [tap[0], plan["thermostat"]], ["off", [th, th2]])
    store.find_device(th)[9] = 1
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    tap = store.tap_intent([alone], plan, {th: "on", th2: "on"}, [false, true], {}, {})
    check("one behind a relay held open has no power: only the other is turned off", [tap[0], plan["thermostat"]], ["off", [th2]])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    tap = store.tap_intent([alone], plan, {th: "off", th2: "off"}, [false, true], {}, {})
    check("and only the other is turned on", [tap[0], plan["thermostat"]], ["on", [th2]])
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    var dark = {"id": "dark", "members": {th: 101}, "zid": 0, "zstate": {}}
    check("a zone whose thermostats have no power: the tap does nothing", store.tap_intent([dark], plan, {th: "off"}, [false, true], {}, {}), nil)
    store.find_device(th)[9] = 0
    check("a zone with nothing a tap reaches: nothing", store.tap_intent([{"id": "e", "members": {}, "zid": 0, "zstate": {}}], plan, {}, up, {}, {}), nil)

    # the sensors and the like count for nothing: a zone of one and a thermostat is a zone of thermostats
    store.register_device(["0x00124B0000A00009", "Sensor", "sensor", 0, 0, 0, "", 1, 0, 0])
    var mixed = {"id": "mixed", "members": {"0x00124B0000A00009": 101, th: 102}, "zid": 0, "zstate": {}}
    plan = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    var plan2 = {"zids": [], "unicast": [], "relays": [], "skipped": []}
    check("a sensor with a thermostat: the same, off and on, and the sensor is in no command", [store.tap_intent([mixed], plan, {th: "on"}, up, {}, {})[0], plan["thermostat"],
          store.tap_intent([mixed], plan2, {th: "off"}, up, {}, {})[0], plan2["thermostat"]], ["off", [th], "on", [th]])
end
tap_checks()

# --- the flash falls over in the store's save -------------------------------------------------------
# A persist.save() that wrote in place would leave _persist.json as {} when its write failed midway (the heap runs out, the file
# system is full): the house would be gone from the file until the retry worked, for a boot in the 2 s. The fork's persist.be (a save
# writes _persist.tmp and moves it over the file) leaves the file as it was, so these checks say that: the file is whole
# at every moment, and a boot in the 2 s of the retry has the house it had.
def failing_save_checks()
    import persist
    var s = PanelStore(json.load(living_room_text))
    s.save_now()
    var whole = persist.written
    check("the house is in the file", json.load(whole)["panel_config"]["zones"] != nil, true)
    tasmota.timers = []
    persist.fail_next()
    s.doc["zones"][0]["name"] = "Changed"
    s.save_now()
    check("a save that falls over leaves the file as it was: the house, and everything else of it", persist.written, whole)
    check("and the store tries again in 2 s", [size(tasmota.timers), tasmota.timers[0][0]], [1, 2000])
    # a boot in those 2 s
    var snapshot = persist.store
    persist.reboot()
    var booted = PanelStore(nil)
    booted.load()
    check("a panel that boots in them has the house it had: the Living room's zones, not the one empty screen of a panel from its box", [size(booted.doc["zones"]), size(booted.doc["screens"]), size(booted.doc["devices"]), booted.doc["zones"][0]["name"]], [5, 1, 34, "Hall"])
    # the retry, with the memory whole, writes it all back
    persist.store = snapshot
    persist.marked = true
    tasmota.timers[0][1]()
    check("the retry writes the house back", json.load(persist.written)["panel_config"]["zones"][0]["name"], "Changed")
    # and a save that fails with the retries used up leaves the file as it was, until something saves again
    tasmota.timers = []
    var kept = persist.written
    var n = 0
    while n < 7
        persist.fail_next()
        if n == 0  s.save_now() elif size(tasmota.timers) > 0  tasmota.timers[0][1]() tasmota.timers.remove(0) end
        n += 1
    end
    check("five retries that fail: the file stays as it was, and nothing tries again", [persist.written, size(tasmota.timers)], [kept, 0])
    tasmota.timers = nil
    persist.zero()
    persist.written = nil
end
failing_save_checks()

# --- a configuration that is saved and is not one the store can run ---------------------------------------------
# readable() says the version, and a document of the right version that is the wrong shape (a text where a list goes, a field
# gone) would trip load() and validate() at every boot, with the glass dead. It is a configuration that is kept as it
# is and not run, as a newer version's is: the panel boots on an empty one, readonly, and nothing is saved over it
def hostile_documents()
    var out = []
    var add = def (name, f) out.push([name, f]) end
    add("only a version", def (d) return {"v": 7} end)
    add("no screens at all", def (d) d["screens"] = [] return d end)
    add("screens as a text", def (d) d["screens"] = "home" return d end)
    add("screens as a map", def (d) d["screens"] = {"id": "home"} return d end)
    add("a screen with no cards", def (d) d["screens"][0].remove("cards") return d end)
    add("cards as a text", def (d) d["screens"][0]["cards"] = "z" return d end)
    add("a card that is no list", def (d) d["screens"][0]["cards"] = [1] return d end)
    add("a grid as a text", def (d) d["zones"][0]["grid"] = "3x4" return d end)
    add("a grid as a list", def (d) d["zones"][0]["grid"] = [3, 4] return d end)
    add("devices as a text", def (d) d["devices"] = "x" return d end)
    add("devices as a number", def (d) d["devices"] = 5 return d end)
    add("a device with two fields", def (d) d["devices"] = [["a", "b"]] return d end)
    add("a device that is no list", def (d) d["devices"] = ["a"] return d end)
    add("a device whose caps are a text", def (d) d["devices"][0][3] = "1" return d end)
    add("a matrix as a text", def (d) d["matrix"] = "8x5" return d end)
    add("no matrix", def (d) d.remove("matrix") return d end)
    add("zones that are no maps", def (d) d["zones"] = [1, 2] return d end)
    add("zones as a text", def (d) d["zones"] = "z" return d end)
    add("members as a list", def (d) d["zones"][0]["members"] = ["a"] return d end)
    add("members as a text", def (d) d["zones"][0]["members"] = "a" return d end)
    add("a member whose place is a text", def (d) d["zones"][0]["members"]["relay:1"] = "102" return d end)
    add("buttons as a text", def (d) d["zones"][0]["buttons"] = "a" return d end)
    add("a zone with no buttons", def (d) d["zones"][0].remove("buttons") return d end)
    add("a group number as a text", def (d) d["zones"][0]["zid"] = "x" return d end)
    add("no next group number", def (d) d.remove("nextZid") return d end)
    add("no sequence", def (d) d.remove("seq") return d end)
    add("button groups as a text", def (d) d["buttonGroups"] = "x" return d end)
    add("no button groups", def (d) d.remove("buttonGroups") return d end)
    add("the stale ones as a text", def (d) d["stale"] = "x" return d end)
    add("events as a text", def (d) d["events"] = "x" return d end)
    add("events as a number", def (d) d["events"] = 3 return d end)
    add("a version 2 with nothing in it", def (d) return {"v": 2} end)
    add("a version 3 whose zone has members as a text", def (d) return {"v": 3, "devices": [], "zones": [{"members": "x"}]} end)
    add("a version 6 whose zones are a text", def (d) return {"v": 6, "zones": "x"} end)
    return out
end

def hostile_checks()
    import persist
    var living_room = def () return json.load(living_room_text) end
    var docs = hostile_documents()
    check("at least twenty documents of the catalog", size(docs) >= 20, true)
    var alive = 0
    var kept = 0
    var unwritten = 0
    for c: docs
        var raw = c[1](living_room())
        var before = json.dump(raw)
        persist.zero()
        persist.setmember("panel_config", raw)
        var s = PanelStore(nil)
        var err = nil
        try
            s.load()
        except .. as e, m
            err = c[0] + ": " + str(e) + ": " + str(m)
            print("FAIL load raised for " + err)
        end
        # alive: an empty configuration the rest of the panel runs on, a valid one
        if err == nil && s.readonly && size(s.doc["screens"]) == 1 && size(s.doc["zones"]) == 0 && size(s.validate()) == 0
            alive += 1
        else
            print("FAIL not alive: " + c[0])
        end
        # kept: what is saved is what it was, byte for byte
        if json.dump(persist.find("panel_config")) == before
            kept += 1
        else
            print("FAIL changed: " + c[0])
        end
        # and nothing is saved over it
        var saves = persist.saves
        s.save_now()
        if persist.saves == saves
            unwritten += 1
        else
            print("FAIL written over: " + c[0])
        end
    end
    check("every hostile document: the panel boots on an empty configuration, readonly", alive, size(docs))
    check("and the one saved stays as it was", kept, size(docs))
    check("and a save of the panel's own does not take its place", unwritten, size(docs))
    persist.zero()
    persist.written = nil
end
hostile_checks()

# what is not hostile is not turned away: the Living room, its US twin, an old version upgraded, one with the optional fields, and the events the
# schedule is the one to look at (a rule that is no rule: the schedule drops it, panel_schedule.be)
def sound_checks()
    import persist
    for t: [["the Living room", living_room_text], ["the Living room of the US", living_room_us_text]]
        persist.zero()
        persist.setmember("panel_config", json.load(t[1]))
        var s = PanelStore(nil)
        s.load()
        check(t[0] + " is loaded and runs", [s.readonly, size(s.doc["zones"]) > 0, s.validate()], [false, true, []])
    end
    var old = json.load(living_room_text)
    old["v"] = 6
    persist.zero()
    persist.setmember("panel_config", old)
    var s6 = PanelStore(nil)
    s6.load()
    check("a version 6, upgraded", [s6.readonly, s6.doc["v"]], [false, PanelStore.FORMAT])
    var rich = json.load(living_room_text)
    rich["events"] = [["e1", "relay:1", 20000, 100, 200, "x", [], nil, nil]]
    rich["scheduleOff"] = []
    rich["zidBase"] = 300
    persist.zero()
    persist.setmember("panel_config", rich)
    var s7 = PanelStore(nil)
    s7.load()
    check("one with events and the optional fields: loaded, the events the schedule's to look at", [s7.readonly, size(s7.doc["events"])], [false, 1])
    check("a stale list a store gives the one with none", PanelStore(json.load(living_room_text)).doc.contains("stale"), true)
    persist.zero()
    persist.written = nil
end
sound_checks()

# --- the one save of the panel's sites -------------------------------------------------------------------------
def safe_save_checks()
    import persist
    persist.zero()
    persist.written = nil
    # no save planned to fail: the test before it left its last one standing
    persist.plan = nil
    tasmota.timers = []
    persist.setmember("k", 1)
    var saves = persist.saves
    check("a save with the heap to spare: written now, said so", [PanelStore.safe_save(0), persist.saves, size(tasmota.timers)], [true, saves + 1, 0])
    persist.setmember("k", 2)
    check("with no number of tries, the same", [PanelStore.safe_save(), persist.saves, size(tasmota.timers)], [true, saves + 2, 0])
    # the heap short: it waits, and the wait is tried again in 2 s
    tasmota.heap_free_kb = 10
    persist.setmember("k", 3)
    check("with the heap short of 30 KB it waits: not written, and again in 2 s", [PanelStore.safe_save(0), persist.saves, size(tasmota.timers), tasmota.timers[0][0]],
          [false, saves + 2, 1, 2000])
    tasmota.heap_free_kb = 128
    tasmota.timers[0][1]()
    check("the heap back, the wait ends with the write", [persist.saves, persist.written != nil && json.load(persist.written)["k"] == 3], [saves + 3, true])
    # the last try does not wait, whatever the heap
    tasmota.timers = []
    tasmota.heap_free_kb = 10
    persist.setmember("k", 4)
    check("the last try writes at once, with the heap short, and is not tried again", [PanelStore.safe_save(PanelStore.SAVE_TRIES), persist.saves, size(tasmota.timers)],
          [true, saves + 4, 0])
    tasmota.heap_free_kb = nil
    # a save that fails: no exception, a word in the log, and the next try in 2 s
    var before = persist.written
    persist.setmember("k", 5)
    persist.fail_next()
    var raised = false
    var said = nil
    try
        said = PanelStore.safe_save(0)
    except .. as e, m
        raised = true
    end
    check("a save that fails raises nothing: not written, tried again in 2 s", [raised, said, size(tasmota.timers), tasmota.timers[0][0]], [false, false, 1, 2000])
    check("the file is as it was, as persist leaves it", persist.written, before)
    tasmota.timers[0][1]()
    check("and the try that works writes it all back", json.load(persist.written)["k"], 5)
    # the tries run out
    tasmota.timers = []
    persist.setmember("k", 6)
    persist.fail_next()
    check("the last try that fails: said, and not tried again", [PanelStore.safe_save(PanelStore.SAVE_TRIES), size(tasmota.timers)], [false, 0])
    persist.zero()
    persist.written = nil
    tasmota.timers = nil
end
safe_save_checks()

# what follows a save is told before the write, and one that fails costs the write nothing: the glass said it saved, and
# the edit was in RAM only
def listener_checks()
    import persist
    persist.zero()
    persist.written = nil
    tasmota.timers = nil
    var s = PanelStore(json.load(living_room_text))
    var told = 0
    s.on_saved = def ()
        told += 1
        persist.setmember("heard", told)
        raise "boom_error", "a listener that fails"
    end
    s.doc["zones"][0]["name"] = "Changed"
    var raised = false
    try
        s.save_now()
    except .. as e, m
        raised = true
    end
    var file = json.load(persist.written)
    check("a listener that raises: the save is made, and raises nothing", [raised, told, file["panel_config"]["zones"][0]["name"]], [false, 1, "Changed"])
    check("and what it kept went in the same write", file["heard"], 1)
    persist.zero()
    persist.written = nil
end
listener_checks()

# --- the devices of other bridges ---------------
def remote_checks()
    var s = PanelStore(nil)
    var zone = s.create_zone("home", "Room", [0, 0], [3, 3])["value"]
    var near = "0x00124B0000F00001"
    var far = "0x00124B0000F00002"
    var far2 = "0x00124B0000F00003"
    for id: [near, far, far2]
        s.register_device([id, "Lamp " + id[-1 ..], "light", 3, 0, 0, "", 1, 0, 0])
        s.add_to_zone(zone, id)
    end
    check("a device is the panel's own: no owner", [s.owner_of(near), s.is_remote(near), s.doc.contains("remote")], [0, false, false])
    # a lamp already in a group of this network stays where it is
    s.find_zone(zone)["zid"] = s.take_zid()
    s.find_zone(zone)["zstate"][far] = "in"
    check("a device in a group is given to a bridge, and stays in the group: it is on every bridge that holds members",
          [s.set_owner(far, 2)["ok"], s.find_zone(zone)["zstate"].find(far)], [true, "in"])
    s.set_owner(far, 0)
    s.find_zone(zone)["zstate"].remove(far)
    check("an unknown device is refused", s.set_owner("0x00124B0000F0FFFF", 2)["refusal"], "no_such_device")
    check("a number that is not a bridge's is refused", [s.set_owner(far, 255)["refusal"], s.set_owner(far, -1)["refusal"], s.set_owner(far, "2")["refusal"]], ["bad_owner", "bad_owner", "bad_owner"])
    check("a relay is the panel's", s.set_owner("relay:1", 2)["refusal"], "relay_device")
    check("a device is given to a bridge", [s.set_owner(far, 2)["ok"], s.set_owner(far2, 3)["ok"]], [true, true])
    check("and says whose it is", [s.owner_of(far), s.owner_of(far2), s.is_remote(far), s.owner_of(near)], [2, 3, true, 0])
    check("by its channel as well: the owner is the device's", s.owner_of(far + "/2"), 2)
    check("the owners and their devices, in order, for the marks", s.remote_by_owner(), {2: [far], 3: [far2]})
    # the panel's own, for the marks at its own bridge: none of another room, a device of several channels once
    s.register_device([near + "/2", "Lamp 2", "light", 3, 0, 0, "", 2, 0, 0])
    check("the panel's own devices, by IEEE, once each", s.own_ieees(), [near])
    check("the document is still valid", s.validate(), [])
    # a zone's group is on every bridge that holds members of it
    var grown = PanelStore(nil)
    var z = grown.create_zone("home", "Room", [0, 0], [3, 3])["value"]
    var ids = []
    for i: 1 .. 5
        var id = "0x00124B0000E0000" + str(i)
        grown.register_device([id, "Light " + str(i), "light", 1, 0, 0, "", 1, 0, 0])
        ids.push(id)
    end
    grown.set_owner(ids[3], 7)
    grown.set_owner(ids[4], 7)
    for id: ids grown.add_to_zone(z, id) end
    var zid = grown.find_zone(z)["zid"]
    check("three lamps of the own bridge and two of the bridge 7 make one group, all of them in it", [zid != 0, size(grown.zigbee_members(grown.find_zone(z))), grown.find_zone(z)["zstate"].find(ids[4])], [true, 5, "joining"])
    check("held by both bridges: the own and the 7", grown.group_bridges(zid), [0, 7])
    check("a number nobody's group has, none", grown.group_bridges(zid + 99), [])
    # the bridge the panel is paired with numbered by the house: its devices are its (adopt_owner), and the panel's groups move to its own range (zid_space)
    check("the own bridge's devices take its number", [grown.adopt_owner(3), grown.owner_of(ids[0]), grown.owner_of(ids[3]), grown.adopt_owner(3)], [true, 3, 7, false])
    check("a number that is no bridge's is none", [grown.adopt_owner(0), grown.adopt_owner(255)], [false, false])
    check("held now by the bridges 3 and 7", grown.group_bridges(zid), [3, 7])
    grown.find_zone(z)["zstate"][ids[0]] = "in"
    grown.find_zone(z)["zstate"][ids[1]] = "leaving"
    check("the panel numbered 4: its groups move to its range", [grown.zid_space(4), grown.find_zone(z)["zid"], grown.doc["zidBase"]], [true, PanelStore.node_zid_base(4), PanelStore.node_zid_base(4)])
    check("each member joins the new number, one leaving does not, and every one leaves the old",
          [grown.find_zone(z)["zstate"].find(ids[0]), grown.find_zone(z)["zstate"].contains(ids[1]), grown.find_zone(z)["zstate"].find(ids[4]), size(grown.doc["stale"]), grown.doc["stale"][0][1]],
          ["joining", false, "joining", 5, zid])
    check("once", grown.zid_space(4), false)
    check("and a new group takes the next number of its range", grown.take_zid(), PanelStore.node_zid_base(4) + 1)
    check("the document is valid", grown.validate(), [])
    var fresh_doc = PanelStore(nil)
    check("a panel with no group takes its range first, and its first group the first of it", [fresh_doc.zid_space(9), fresh_doc.take_zid()], [true, PanelStore.node_zid_base(9)])
    # what leaves with the house: the devices of a bridge struck off, and all the bridges' when the panel leaves
    var drop = PanelStore(nil)
    for i: 1 .. 3 drop.register_device(["0x00124B0000D0000" + str(i), "L" + str(i), "light", 1, 0, 0, "", 1, 0, 0]) end
    drop.set_owner("0x00124B0000D00001", 2)
    drop.set_owner("0x00124B0000D00002", 3)
    check("a bridge struck off: its devices go", [drop.drop_bridge(2), drop.find_device("0x00124B0000D00001"), drop.find_device("0x00124B0000D00002") != nil], [1, nil, true])
    check("the panel left the house: the bridges' devices go, the one of no bridge numbered stays", [drop.drop_owned(), drop.find_device("0x00124B0000D00002"), drop.find_device("0x00124B0000D00003") != nil], [1, nil, true])
    check("the ranges of two panels do not meet, and the last fits Zigbee's", [PanelStore.node_zid_base(5) + PanelStore.ZID_PER_NODE <= PanelStore.node_zid_base(6), PanelStore.node_zid_base(254) + PanelStore.ZID_PER_NODE - 1 <= 0xFFF7], [true, true])
    # taking it off the panel is no leave of a network that is not this one's
    var removed = s.remove_device(far)
    check("a remote device taken off goes with no leave: the network is another bridge's", [removed["ok"], removed["actions"]], [true, []])
    check("and the owner is forgotten, the other kept", [s.owner_of(far), s.owner_of(far2), s.doc["remote"]], [0, 3, {"0x00124B0000F00003": 3}])
    check("a device of the panel's own is told to leave, as it was", s.remove_device(near)["actions"], [["leave", near]])
    s.remove_device(far2)
    check("the last one out: the document has no remote map", s.doc.contains("remote"), false)
    # the document's own checks
    var bad = PanelStore(nil)
    bad.register_device([near, "Lamp", "light", 3, 0, 0, "", 1, 0, 0])
    bad.doc["remote"] = {"0x00124B0000F0DEAD": 2, "0x00124B0000F00001": 300}
    var issues = bad.validate()
    check("a remote entry of no device, and a number out of the house's, are named", [issues.find(["remote_unknown", "0x00124B0000F0DEAD"]) != nil, issues.find(["remote_owner", near]) != nil], [true, true])
    check("a configuration whose remote is not a map of numbers is turned away", [PanelStore.shaped({"remote": 3}), PanelStore.shaped(json.load(living_room_text))], ["matrix", nil])
    var odd = json.load(living_room_text)
    odd["remote"] = {"0x00124B0000C00001": "two"}
    check("or whose numbers are not numbers", PanelStore.shaped(odd), "remote")
    var fine = json.load(living_room_text)
    fine["remote"] = {"0x00124B0000C00001": 2}
    check("one that is a map of numbers is taken, and kept by the store", [PanelStore.shaped(fine), PanelStore(fine).owner_of("0x00124B0000C00001")], [nil, 2])
end
remote_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
