# berry/panel_zigbee.be against what Zigbee2Tasmota writes: synthetic events in
# the shapes its own source prints (see the head of panel_zigbee.be), on a real
# store of the Living room and real views. What the views do with them is held to the
# TypeScript by test_panel_ui.be; this is the reading of the network.

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
    var reports
    var live
    var answered
    var colors
    var doubt
    def init() self.reports = [] self.live = {} self.answered = [] self.colors = [] self.doubt = {} end
    def on_report(id, state) self.reports.push([id, state]) self.live[id] = state end
    def on_color(id, c) self.colors.push([id, c]) end
    def on_answered(id) self.answered.push(id) return true end
end

var MIDDLE1 = "0x00124B0000E00001"
var store = PanelStore(json.load(living_room_text))
var ui = PanelUi(store, shape, / -> [], nil)
# the +'s screens, as the boot gives them
ui.providers.push(PanelAddView(ui))
var clock = [0]
ui.now_fn = / -> clock[0]
var plan = FakePlan()
ui.live = plan.live
var effects = []
var sent = []
var zb = PanelZigbee(store, ui, plan, / e -> effects.push(e), / c -> sent.push(c))

# --- what Z2T knows: the addresses, and a device new to the panel -----------------
zb.on_event({"ZbInfo": {"0x1001": {"Device": "0x1001", "IEEEAddr": MIDDLE1, "ModelId": "TS0505B",
                                   "Endpoints": [1], "Config": ["L01.5"], "Power": 1, "Reachable": true}}})
check("ZbInfo teaches the short address of a lamp of ours", zb.ieee_of[0x1001], MIDDLE1)
# the maps key a short address by its number, the zigbee module's, not Z2T's text of it
check("a short address as Z2T writes it is its number", [PanelZigbee.short("0x5ADF"), PanelZigbee.short("0x5adf"), PanelZigbee.short(0x5ADF)], [0x5ADF, 0x5ADF, 0x5ADF])
check("and a friendly name is none", PanelZigbee.short("Lamp1"), nil)
check("and its last state reaches the plan", plan.reports[-1], [MIDDLE1, "on"])
# Z2T starts every device as not reachable until it hears from it: at boot that
# is not the lamp saying nothing, and the lamp is not marked as not answering
var reports_before = size(plan.reports)
zb.on_event({"ZbInfo": {"0x1001": {"Device": "0x1001", "IEEEAddr": MIDDLE1, "ModelId": "TS0505B", "Power": 1, "Reachable": false}}})
check("ZbInfo's Reachable false at boot does not mark the lamp as not answering",
      plan.reports[-1] != [MIDDLE1, "noanswer"] && size(plan.reports) >= reports_before, true)
zb.on_event({"ZbInfo": {"0x2002": {"Device": "0x2002", "IEEEAddr": "0x00158d00aabbccdd", "ModelId": "LED1545G12",
                                   "Config": ["L01.2"], "Reachable": true}}})
# a bridge's network is the house's: a device comes to a panel from its own + or the Existing device, never from a ZbInfo
check("a device the network has and the panel does not is not registered", [store.find_device("0x00158D00AABBCCDD"), zb.ieee_of.find(0x2002)], [nil, nil])
zb.on_event({"ZbInfo": "Done"})
check("the end of the list is not a device", size(store.doc["devices"]) > 0, true)

# --- reports --------------------------------------------------------------------------
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Power": 0, "Endpoint": 1, "LinkQuality": 80}}})
check("a report by short address is the lamp's, by IEEE", plan.reports[-1], [MIDDLE1, "off"])
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Reachable": false}}})
check("an unanswered ping is no answer", plan.reports[-1], [MIDDLE1, "noanswer"])
var n = size(plan.reports)
zb.on_event({"ZbReceived": {"0x9999": {"Device": "0x9999", "Power": 1}}})
check("an address the panel has not learned is let go", size(plan.reports), n)
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Dimmer": 120}}})
check("a report with no state in it changes nothing", size(plan.reports), n)
# but its brightness is where the detail's slider stands: it stood where this panel last put it, and at 50 for a lamp it never set
check("a lamp this panel never set, said to be at Dimmer 120: its slider stands at 46", ui.levels.find(MIDDLE1), [46, 50, 50])
ui.levels[MIDDLE1] = [33, 12, 80]
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Dimmer": PanelUi.level_for("bri", 33, 0, 0)[1]}}})
check("what the lamp says of what this panel sent is no news: the slider stays where the finger put it", ui.levels[MIDDLE1], [33, 12, 80])
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Dimmer": 254}}})
check("another level, from a button or another panel, moves the slider, and only its brightness", ui.levels[MIDDLE1], [100, 12, 80])
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Dimmer": 0}}})
check("a lamp at its dimmest is at 0", ui.levels[MIDDLE1][0], 0)
check("the inverse of what a slider sends, at every position", [PanelZigbee.bri_pct(PanelUi.level_for("bri", 0, 0, 0)[1]), PanelZigbee.bri_pct(PanelUi.level_for("bri", 50, 0, 0)[1]), PanelZigbee.bri_pct(PanelUi.level_for("bri", 100, 0, 0)[1])], [0, 50, 100])
var worst = 0
for p: 0 .. 100
    var back = PanelZigbee.bri_pct(PanelUi.level_for("bri", p, 0, 0)[1])
    var gap = back > p ? back - p : p - back
    if gap > worst worst = gap end
end
check("and within two percents of it anywhere", worst <= 2, true)
store.register_device(["0x00124B00BB000001", "Plug 9", "plug", 1, 0, 0, "", 1, 0, 0])
zb.learn(0x1009, "0x00124B00BB000001")
zb.on_event({"ZbReceived": {"0x1009": {"Device": "0x1009", "Dimmer": 120}}})
check("a device with no levels has no slider position", ui.levels.contains("0x00124B00BB000001"), false)
ui.levels.remove(MIDDLE1)
# the colour a lamp says, for its icon lit
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Power": 1, "Hue": 0, "Sat": 254}}})
check("a lamp's report of its colour reaches the plan", plan.colors, [[MIDDLE1, 0xF800]])
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Power": 0}}})
check("one with nothing of colour does not", size(plan.colors), 1)
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "CT": 370}}})
check("and a white, alone, gives the icon back to the theme", plan.colors[-1], [MIDDLE1, nil])

# --- a device of another room: its reports come from the house, by IEEE ----------------------
var FAR = "0x00124B00CC000001"
store.register_device([FAR, "Far lamp", "light", 3, 0, 0, "", 1, 0, 0])
var before_far = size(plan.reports)
zb.on_remote({FAR: {"Power": 1, "ModelId": "X"}})
check("a device of the panel's own, by its bridge's flood once it is marked there: its state, and nothing else", [plan.reports[-1], size(plan.reports) - before_far], [[FAR, "on"], 1])
store.set_owner(FAR, 3)
zb.on_remote({FAR: {"Power": 1}})
check("a device of another room: the report by its IEEE is its state, as a lamp's is", plan.reports[-1], [FAR, "on"])
zb.on_remote({FAR: {"Power": 0, "Dimmer": 120}})
check("off, and its brightness is where the slider stands", [plan.reports[-1], ui.levels.find(FAR) != nil], [[FAR, "off"], true])
zb.on_remote({FAR: {"Reachable": false}})
check("a device that does not answer, as a lamp that does not", plan.reports[-1], [FAR, "noanswer"])
var n_far = size(plan.reports)
var n_fx = size(effects)
zb.on_remote({FAR: {"StartUpOnOff": 1, "ModelId": "X", "AddGroupStatus": 0}})
check("what is its own bridge's to read, the settings, the model, the groups, is not this panel's", [size(plan.reports), size(effects)], [n_far, n_fx])
zb.on_remote({"0x00124B00CC00FFFF": {"Power": 1}})
check("a device the panel does not have is let go", plan.reports[-1], [FAR, "noanswer"])
store.register_device([FAR + "x", "x", "light", 3, 0, 0, "", 1, 0, 0])
store.remove_device(FAR + "x")
zb.on_remote({FAR + "/2": {"Power": 1, "Endpoint": 2}})
check("a channel that is not one of the device's is the device's", plan.reports[-1], [FAR, "on"])
zb.gate(FAR, true)
check("a device of another room held by the gate is marked in the plan's doubt, as gated", plan.doubt.find(FAR), "gated")
zb.gate(FAR, false)
check("and lifted", plan.doubt.contains(FAR), false)
plan.doubt[FAR] = true
zb.gate(FAR, false)
check("what the gate did not hold is left as it is", plan.doubt.find(FAR), true)
plan.doubt.remove(FAR)
zb.on_remote("not a map")
zb.on_remote({FAR: "not a map"})
check("what is not a report is let go", plan.reports[-1], [FAR, "on"])
# the session with the bridge of the house up: its events say its devices whole, and the flood's word of them is not taken twice
class SessionBridge
    var house_bridge
    def init(n) self.house_bridge = / -> n end
    def link_state() return true end
end
do
    import global
    var had = global.contains("zb_bridge") ? global.zb_bridge : nil
    var NEAR = "0x00124B00CC000002"
    store.register_device([NEAR, "Near lamp", "light", 3, 0, 0, "", 1, 0, 0])
    global.zb_bridge = SessionBridge(3)
    var n0 = size(plan.reports)
    zb.on_remote({NEAR: {"Power": 1}, FAR: {"Power": 0}})
    check("with the session up, a device of none and one of the bridge of the house are its events', and the flood's word is not taken", size(plan.reports), n0)
    global.zb_bridge = SessionBridge(5)
    zb.on_remote({FAR: {"Power": 0}})
    check("one of another bridge is the flood's", plan.reports[-1], [FAR, "off"])
    global.zb_bridge = had
    zb.on_remote({NEAR: {"Power": 1}})
    check("and with no session, the flood is the way", plan.reports[-1], [NEAR, "on"])
    store.remove_device(NEAR)
end

# --- a ping answered: the lamp is there -------------------------------
zb.on_event({"ZbPing": "Done"})
check("the command's own answer is not a ping answered", plan.answered, [])
zb.on_event({"ZbPing": {"Device": "0x1003", "IEEEAddr": "0x00124b0000e00001"}})
check("a ping answered, in Z2T's shape, is the lamp's, by IEEE", plan.answered, [MIDDLE1])
check("and teaches its short address", zb.ieee_of.find(0x1003), MIDDLE1)
# what it last said is the state from before a command whose report may have been lost: the lamp is READ, and what the
# report says is what the card shows. A read changes nothing on the lamp: it is no command sent again
check("a lamp that had no communication and answers its ping is read, for its Power", sent[-1], 'ZbSend {"Device":"0x00124B0000E00001","Read":{"Power":true}}')
var reads = size(sent)
zb.on_event({"ZbPing": {"Device": "0x7777", "IEEEAddr": "0x00AA00AA00AA00AA"}})
check("a device the panel does not have is let go", [plan.answered, size(sent)], [[MIDDLE1], reads])
zb.on_event({"ZbReceived": {"0x1003": {"Device": "0x1003", "Power": 1, "Endpoint": 1}}})
check("and the report the read brings is the state, which the card takes in place of the last said", plan.reports[-1], [MIDDLE1, "on"])
zb.learn(0x1001, MIDDLE1)
# with no plan, the views' own doubt: no communication, what the lamp last said kept
do
    var ui2 = PanelUi(PanelStore(json.load(living_room_text)), shape, / -> [], nil)
    var zb2 = PanelZigbee(ui2.store, ui2, nil, / e -> nil, / c -> nil)
    zb2.learn(0x1001, MIDDLE1)
    zb2.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Power": 1}}})
    zb2.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Reachable": false}}})
    check("with no plan, Z2T not reaching a lamp is no communication, its last state kept",
          [ui2.doubt.contains(MIDDLE1), ui2.live.find(MIDDLE1)], [true, "on"])
    zb2.on_event({"ZbPing": {"Device": "0x1001", "IEEEAddr": MIDDLE1}})
    check("with no plan, a ping answered takes the lamp out of the views' doubt", ui2.doubt.contains(MIDDLE1), false)
    # a ping answered by one that had its communication reads nothing: the read is for the one whose last word may be old
    var asked2 = []
    var zb4 = PanelZigbee(ui2.store, ui2, nil, / e -> nil, / c -> asked2.push(c))
    zb4.learn(0x1001, MIDDLE1)
    zb4.on_event({"ZbPing": {"Device": "0x1001", "IEEEAddr": MIDDLE1}})
    check("a ping answered by a device that had its communication reads nothing", asked2, [])
    ui2.doubt[MIDDLE1] = true
    zb4.on_event({"ZbPing": {"Device": "0x1001", "IEEEAddr": MIDDLE1}})
    check("one that had none is read, with no plan too", asked2, ['ZbSend {"Device":"0x00124B0000E00001","Read":{"Power":true}}'])
end
ui.open_card("z:middle", "home")
effects.clear()
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Power": 1}}})
# the reports of a moment make one redraw, when the timer fires
check("the redraw waits for the moment's other reports", size(effects), 0)
zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Power": 1}}})
zb.refresh_now()
check("a zone's screen that lists the lamp draws again, once for both reports", size(effects) == 1 && size(effects[0]) > 0, true)
def wrote(effects, path)
    var v = nil
    for e: effects if e[0] == "set" && e[1] == path v = e[2] end end
    return v
end
check("with the lamp lit", wrote(effects[0], "$zone.rows.0.icon"), "lightOn")

# --- a rejoin: the old short address goes ----------------------------------------------
zb.on_event({"ZbState": {"Status": 30, "IEEEAddr": MIDDLE1, "ShortAddr": "0x3003", "PowerSource": true,
                         "ReceiveWhenIdle": true, "Security": false}})
check("the announce teaches the new address", zb.ieee_of[0x3003], MIDDLE1)
check("and forgets the old one", zb.ieee_of.find(0x1001), nil)

# --- a search in the Hall --------------------------------------------------------------
ui.close()
ui.open_card("z:hall", "home")
effects.clear()
var opened = ui.action()
check("the + opens its list, with the network closed", opened[0], ["page", "settings"])
var searched = ui.list_row(0, 0, false)
check("its first row, Zigbee device, opens the network", searched[0], ["pair", "hall"])
var NEW = "0x00124B0000AA0001"
zb.on_event({"ZbState": {"Status": 30, "IEEEAddr": NEW, "ShortAddr": "0x4004", "PowerSource": true,
                         "ReceiveWhenIdle": true, "Security": false}})
check("the announce gives the new lamp a row", effects[-1][5], ["set", "$list.rows.0.label", "New device"])
check("that says it is being configured", effects[-1][6], ["set", "$list.rows.0.hint", "configuring"])
effects.clear()
zb.on_event({"ZbState": {"Status": 33, "Device": "0x4004", "Endpoint": "0xF2", "ProfileId": "0xA1E0", "DeviceId": "0x0061",
                         "DeviceVersion": 0, "InClusters": [], "OutClusters": ["0x0021"]}})
check("the Green Power endpoint is not the lamp's own", size(effects), 0)
zb.on_event({"ZbState": {"Status": 33, "Device": "0x4004", "Endpoint": "0x01", "ProfileId": "0x0104", "DeviceId": "0x010D",
                         "DeviceVersion": 1, "InClusters": ["0x0000", "0x0003", "0x0004", "0x0005", "0x0006", "0x0008", "0x0300"],
                         "OutClusters": ["0x0019"]}})
var lamp = store.find_device(NEW)
check("its interview makes it an extended colour light", [lamp[1], lamp[2], lamp[3], lamp[7]], ["Light 1", "light", 15, 1])
check("in the Hall", store.zone_of(NEW)["id"], "hall")
var first = effects[0]
check("saved, made to blink, told how to come back from a power cut, asked its model",
      [first[0], first[1], first[2], first[3]], [["save"], ["identify", NEW], ["startup", NEW], ["query", NEW]])
zb.expect_startup(NEW)
effects.clear()
zb.on_event({"ZbResponse": {"Device": "0x4004", "Command": "0006_04", "Status": 134, "StatusMessage": "UNSUPPORTED_ATTRIBUTE",
                            "Endpoint": 1, "LinkQuality": 90}})
check("a lamp without StartUpOnOff refuses, and that is kept", lamp[8], 2)
check("and saved", effects[-1], [["save"]])
zb.on_event({"ZbResponse": {"Device": "0x4004", "Command": "0006_04", "Status": 0}})
check("an answer nobody waits for changes nothing", lamp[8], 2)
effects.clear()
zb.on_event({"ZbInfo": {"0x4004": {"Device": "0x4004", "IEEEAddr": NEW, "ModelId": "TS0505B", "Config": ["L01"], "Power": 0}}})
check("the model its ZbInfo gives goes to its row", lamp[6], "TS0505B")

# --- a bridge of the house names a device by its IEEE: as by its short address, with no map ----
zb.expect_startup(NEW)
effects.clear()
zb.on_event({"ZbResponse": {"Device": NEW, "Command": "0006_04", "Status": 0, "Endpoint": 1}})
check("the answer to a write, by the IEEE, is the lamp's", [lamp[8], effects[-1]], [1, [["save"]]])
zb.on_event({"ZbReceived": {NEW: {"Device": NEW, "Power": 1}}})
check("a report by the IEEE is the lamp's state", plan.reports[-1], [NEW, "on"])
var asked_before = size(zb.asked_short)
zb.on_event({"ZbReceived": {"0x00124B0000F0F0F0": {"Power": 1}}})
check("one of a device the panel does not have is let go, and asks for nothing", [plan.reports[-1], size(zb.asked_short) - asked_before], [[NEW, "on"], 0])
zb.on_event({"ZbInfo": {NEW: {"Device": NEW, "IEEEAddr": NEW, "ModelId": "TS0505B", "Config": ["L01"]}}})
check("the map counts a device named by its IEEE, under it", [zb.short_of(NEW), zb.ieee_by(NEW)], [NEW, NEW])

# --- the network at boot: each device the panel has, asked of its bridge, which runs Z2T -------------
var store2 = PanelStore(json.load(living_room_text))
var asked = []
var zb3 = PanelZigbee(store2, nil, nil, / e -> nil, / c -> asked.push(c))
zb3.seed()
var lacking3 = zb3.lacking()
check("ZbInfo is asked of each device the panel has, by its IEEE, the first at once and the others queued, never the whole network's",
      [asked, size(zb3.asks), size(lacking3) > 1], [["ZbInfo " + lacking3[0]], size(lacking3) - 1, true])

# --- the link coming up (zigbee_bridge.be's on_link) ------------------------
# the map asked for when a command reaches the network, and the groups started once
tasmota.at_ms = 1000
zb3.linked()
check("the link up: the map is asked for, and the groups start", [zb3.seeded_at, zb3.grouping], [1000, true])
tasmota.at_ms = 60000
zb3.linked()
check("a link back within 5 min asks nothing again", zb3.seeded_at, 1000)
tasmota.at_ms = 1000 + PanelZigbee.SEED_MS
zb3.linked()
check("later, it asks again: the lamps' Power while it was down", zb3.seeded_at, 1000 + PanelZigbee.SEED_MS)
tasmota.at_ms = nil
import global as natives

# --- the groups: one command at a time, the answers, the silences -----------------------
class ClockTasmota
    var t
    var timers
    def init() self.t = 0 self.timers = [] end
    def millis() return self.t end
    # [how long it was set for, what it does, when it falls due]
    def set_timer(ms, f) self.timers.push([ms, f, self.t + ms]) end
end
var real_tasmota = tasmota
tasmota = ClockTasmota()
var D1 = "0x00124B0000D00001"
var D2 = "0x00124B0000D00002"
var gstore = PanelStore(json.load(living_room_text))
var gui = PanelUi(gstore, shape, / -> [], nil)
gui.providers.push(PanelAddView(gui))
var gsent = []
var geff = []
var gz = PanelZigbee(gstore, gui, nil, / e -> geff.push(e), / c -> gsent.push(c))
gz.learn("0xD001", D1)
gstore.move_to_zone(D1, "hall")
gz.group_step()
check("a member moved out is taken out of its zone's group first", gsent[-1], 'ZbSend {"Device":"' + D1 + '","Send":{"RemoveGroup":2}}')
gz.group_step()
check("and nothing else goes while it waits for the answer", size(gsent), 1)
gz.on_event({"ZbReceived": {"0xD001": {"Device": "0xD001", "0004?03": "00020000", "RemoveGroup": 2, "RemoveGroupStatus": 0,
                                       "RemoveGroupStatusMsg": "SUCCESS", "Endpoint": 1, "LinkQuality": 60}}})
check("the answer takes it out of the zone's standing", gstore.find_zone("wall")["zstate"].find(D1), nil)
check("and is saved", geff[-1], [["save"]])
gz.group_step()
check("then the button's group", gsent[-1], 'ZbSend {"Device":"' + D1 + '","Send":{"RemoveGroup":5}}')
# silence: three times, and the button's group moves to a new address
for i: 1 .. 3
    tasmota.t += 9000
    gz.group_step()
end
check("a member that does not leave in three tries moves its group", gstore.doc["buttonGroups"][0]["zid"], 6)
check("the silent one stays behind, alone", gstore.doc["buttonGroups"][0]["zstate"].find(D1), nil)
check("and the others leave the old address", size(gstore.doc["stale"]), 29)
# a join that goes unanswered fails, and waits for a retry
gstore.doc["stale"] = []
for k: gz.store.member_ids(gstore.doc["buttonGroups"][0]["zstate"]) gstore.doc["buttonGroups"][0]["zstate"][k] = "in" end
gstore.find_zone("wall")["zstate"][D2] = "joining"
gz.inflight = nil
gz.group_step()
check("a member joining is added", gsent[-1], 'ZbSend {"Device":"' + D2 + '","Send":{"AddGroup":2}}')
var saves0 = size(geff)
tasmota.t += 9000
gz.group_step()
check("an add with no answer failed", gstore.find_zone("wall")["zstate"][D2], "failed")
check("and nothing is written for it: the failed join is the state in the air", size(geff), saves0)
# nothing to do: the failed are tried again, and one device is asked its groups
tasmota.t = 700000
var n0 = size(gsent)
gz.group_step()
check("a retry makes the failed join again", gstore.find_zone("wall")["zstate"][D2], "joining")
check("and writes nothing either", size(geff), saves0)
gz.group_step()
check("which goes out", gsent[-1], 'ZbSend {"Device":"' + D2 + '","Send":{"AddGroup":2}}')
gz.on_event({"ZbReceived": {"0xD002": {"Device": "0xD002", "AddGroup": 2, "AddGroupStatus": 138}}})
check("an answer from an address not yet learned is let go", gstore.find_zone("wall")["zstate"][D2], "joining")
gz.learn("0xD002", D2)
gz.on_event({"ZbReceived": {"0xD002": {"Device": "0xD002", "AddGroup": 2, "AddGroupStatus": 138}}})
check("DUPLICATE_EXISTS is a member already", gstore.find_zone("wall")["zstate"][D2], "in")
gz.group_step()
check("idle, one device is asked its groups", gsent[-1], 'ZbSend {"Device":"0x00124B0000C00001","Send":{"GetAllGroups":true}}')
gz.learn("0xC001", "0x00124B0000C00001")
gz.on_event({"ZbReceived": {"0xC001": {"Device": "0xC001", "GetGroupCapacity": 12, "GetGroupCount": 1, "GetGroup": [5]}}})
check("a device that lost its zone's group joins it again", gstore.find_zone("corridor")["zstate"]["0x00124B0000C00001"], "joining")
check("and the question is answered", gz.inflight, nil)
# a search is on: the network is the pairing's
gui.open_card("z:hall", "home")
gui.action()
gui.list_row(0, 0, false)
var n1 = size(gsent)
gz.group_step()
check("nothing goes while a search runs", size(gsent), n1)
# its view left open, a search whose window is over holds nothing: the network
# took what it would, and the groups' work goes on
tasmota.t += PanelUi.PAIR_MS + 1000
gz.group_step()
check("a search whose window is over no longer holds the groups", gsent[-1], 'ZbSend {"Device":"0x00124B0000C00001","Send":{"RemoveGroup":5}}')
# the link down: nothing goes, and the leave waited for is let go with no try counted,
# to go again once the link is back
class LinkBridge
    var up
    def init() self.up = false end
    def peer() return nil end
    def link_state() return self.up end
end
natives.zb_bridge = LinkBridge()
var n2 = size(gsent)
for i: 1 .. 3
    tasmota.t += 9000
    gz.group_step()
end
check("with the link down, the groups send nothing", size(gsent), n2)
check("and count no try for what never left", gz.tries.find("remove 0x00124B0000C00001 5", 0), 0)
natives.zb_bridge.up = true
gz.group_step()
check("the link back: the leave goes again", gsent[-1], 'ZbSend {"Device":"0x00124B0000C00001","Send":{"RemoveGroup":5}}')
natives.zb_bridge = nil

# --- an open relay: the groups wait for it -------------------
# The Living room's 30 lamps hang on relay 2. With it open, a join waits, no lamp behind it
# is asked its groups, and a join in flight when it opens is let go with no failure
# counted; the relay closed, the join goes.
class RelayPlan
    var relay_on
    def init() self.relay_on = [true, false] end
    def on_report(id, state) end
    def on_color(id, c) end
    def on_answered(id) return true end
end
def relay_checks()
    var rstore = PanelStore(json.load(living_room_text))
    var rui = PanelUi(rstore, shape, / -> [], nil)
    var rplan = RelayPlan()
    var rsent = []
    var rz = PanelZigbee(rstore, rui, rplan, / e -> nil, / c -> rsent.push(c))
    rstore.doc["stale"] = []
    for o: rstore.group_owners()
        for k: PanelStore.member_ids(o["zstate"]) o["zstate"][k] = "in" end
    end
    rstore.find_zone("wall")["zstate"][D2] = "joining"
    rz.group_step()
    check("with relay 2 open, its lamp's join does not go", size(rsent), 0)
    tasmota.t += PanelZigbee.RECONCILE_MS + 1000
    rz.group_step()
    check("and no lamp behind it is asked its groups", size(rsent), 0)
    rplan.relay_on[1] = true
    rz.group_step()
    check("the relay closed, the join goes", rsent[-1], 'ZbSend {"Device":"' + D2 + '","Send":{"AddGroup":2}}')
    rplan.relay_on[1] = false
    tasmota.t += 9000
    rz.group_step()
    check("a join in flight when the relay opens is let go", rz.inflight, nil)
    check("with no failure counted", rstore.find_zone("wall")["zstate"][D2], "joining")
    check("and nothing goes in its place", size(rsent), 1)
end
relay_checks()
# pings, spaced
var psent = []
var pz = PanelZigbee(gstore, nil, nil, / e -> nil, / c -> psent.push(c))
tasmota.timers.clear()
pz.ping(["0xA", "0xB"])
check("the first ping goes at once", psent, ["ZbPing 0xA"])
check("the next one waits its gap", tasmota.timers[-1][0], PanelZigbee.PING_GAP_MS)
tasmota.timers[-1][1]()
check("and then goes", psent, ["ZbPing 0xA", "ZbPing 0xB"])
# the group clock: a step that raises loses its tick, not the clock
tasmota.timers.clear()
gz.start_groups()
check("the group clock is armed", size(tasmota.timers), 1)
gz.inflight = ["broken"]
tasmota.timers[0][1]()
check("a step that raises re-arms the clock all the same", size(tasmota.timers), 2)
gz.inflight = nil

# A member that never answers, a lamp switched off at the wall, for an hour: its join goes out, is not answered, fails, and is tried
# again ten minutes later, over and over, and none of it is written (it was nineteen saves an hour, each with a backup to the
# server, the names and the schedule republished, and the file rewritten)
def silent_member_checks()
    var s = PanelStore(json.load(living_room_text))
    var ui_s = PanelUi(s, shape, / -> [], nil)
    var out = []
    var eff = []
    var z = PanelZigbee(s, ui_s, nil, / e -> eff.push(e), / c -> out.push(c))
    var add = 'ZbSend {"Device":"' + D2 + '","Send":{"AddGroup":2}}'
    z.learn("0xD002", D2)
    s.find_zone("wall")["zstate"][D2] = "joining"
    var start = tasmota.t
    var failed = 0
    var was = ""
    var hour = start + 3600000
    while tasmota.t < hour
        tasmota.t += PanelZigbee.GROUP_TICK_MS
        z.group_step()
        var now_state = s.find_zone("wall")["zstate"][D2]
        if now_state == "failed" && was != "failed"  failed += 1 end
        was = now_state
    end
    var adds = 0
    for c: out if c == add  adds += 1 end end
    check("the join went out, was not answered, and failed, again and again, for the hour", failed >= 6, true)
    check("the retry sent it about every ten minutes", adds >= 6 && adds <= 9, true)
    var saves = 0
    for e: eff if e == [["save"]]  saves += 1 end end
    check("and in that hour nothing asked for a save", saves, 0)
    # the same lamp, once it answers (the wall switch is on): in, and that is written
    z.group_step()
    z.inflight = nil
    s.find_zone("wall")["zstate"][D2] = "joining"
    z.on_event({"ZbReceived": {"0xD002": {"Device": "0xD002", "AddGroup": 2, "AddGroupStatus": 0}}})
    check("a join it answers is a membership, and that is written", [s.find_zone("wall")["zstate"][D2], eff[-1]], ["in", [["save"]]])
    # a join the device refuses (no room in its table) is the transient state as well
    var before = size(eff)
    s.find_zone("wall")["zstate"][D2] = "joining"
    z.on_event({"ZbReceived": {"0xD002": {"Device": "0xD002", "AddGroup": 2, "AddGroupStatus": 137}}})
    check("a join the device refuses, for want of room, is kept in memory and not written", [s.find_zone("wall")["zstate"][D2], size(eff)], ["failed", before])
end
silent_member_checks()

# The map of the panel's devices, asked device by device of the bridge that has each: the bridge's queue held four
# frames of the burst Z2T made of a whole ZbInfo, and what came back of the Living room's 30 lamps was a handful; and the house's network is not this panel's
# to list
class SeedBridge
    var up
    def init() self.up = true end
    def link_state() return self.up end
end
def seed_repeat_checks()
    var s = PanelStore(json.load(living_room_text))
    var ids = []
    for d: s.doc["devices"] if !PanelStore.is_relay_id(d[0]) ids.push(d[0]) end end
    var n = size(ids)
    var asked = []
    var z = PanelZigbee(s, PanelUi(s, shape, / -> [], nil), nil, / e -> nil, / c -> asked.push(c))
    var bridge = SeedBridge()
    natives.zb_bridge = bridge
    z.grouping = true
    # the timer that falls due first runs, at its time
    var turn = def ()
        var k = 0
        for i: 0 .. size(tasmota.timers) - 1
            if tasmota.timers[i][2] < tasmota.timers[k][2] k = i end
        end
        var t = tasmota.timers[k]
        tasmota.timers.remove(k)
        if t[2] > tasmota.t tasmota.t = t[2] end
        t[1]()
        return t[0]
    end
    tasmota.timers.clear()
    z.linked()
    check("the link up: the seed is on its way", [size(tasmota.timers), tasmota.timers[0][0]], [1, PanelZigbee.SEED_DELAY_MS])
    # four of the thirty said themselves before it
    for i: 0 .. 3 z.learn(0x1001 + i, ids[i]) end
    turn()
    check("the seed asks for every device the panel has, the ones the map has too, for their state: the first at once, by its IEEE", asked, ["ZbInfo " + ids[0]])
    # the others one at a time, each its gap after the one before; one that answered meanwhile is asked all the same, for its state
    z.learn(0x1010, ids[7])
    var gaps = []
    while z.asking
        gaps.push(turn())
    end
    var want = []
    for i: 0 .. n - 1 want.push("ZbInfo " + ids[i]) end
    check("then each of the others, in the order the panel has them", asked, want)
    check("a gap apart", [gaps[0], gaps[1], gaps[2]], [PanelZigbee.SEED_GAP_MS, PanelZigbee.SEED_GAP_MS, PanelZigbee.SEED_GAP_MS])
    check("and the map is looked at when the answers to the last have had their time", size(tasmota.timers), 1)
    # their answers come
    for i: 4 .. n - 1 z.learn(0x1001 + i, ids[i]) end
    check("the map is whole", z.lacking(), [])
    asked.clear()
    # the check, which finds the map whole and asks nothing, and arms nothing
    while size(tasmota.timers) > 0 turn() end
    check("a whole map is asked no more, and nothing is armed", [asked, size(tasmota.timers), z.asking], [[], 0, false])
    # the session back within SEED_MS: only what the map lacks, a map whose answers were lost while it was down
    z.linked()
    while size(tasmota.timers) > 0 turn() end
    check("the session back soon, with the map whole: nothing is asked", asked, [])
    z.ieee_of.remove(0x1001 + 5)
    z.linked()
    while size(tasmota.timers) > 0 turn() end
    var only = true
    for c: asked if c != "ZbInfo " + ids[5] only = false end end
    check("and with a device the map lost: that one alone, in the seed and in its rounds, as it never answers", [only, size(asked)], [true, PanelZigbee.SEED_ROUNDS + 1])
    asked.clear()

    # a network whose devices never come back: the rounds end, and the link's next seed asks again
    var z2 = PanelZigbee(s, PanelUi(s, shape, / -> [], nil), nil, / e -> nil, / c -> asked.push(c))
    asked.clear()
    tasmota.timers.clear()
    z2.grouping = true
    z2.linked()
    var guard = 0
    while size(tasmota.timers) > 0 && guard < 2000
        turn()
        guard += 1
    end
    check("a map that stays empty is asked each of its devices in the seed and in each of the rounds, and the rounds end",
          [size(asked), guard < 2000, z2.seed_round], [(PanelZigbee.SEED_ROUNDS + 1) * n, true, PanelZigbee.SEED_ROUNDS])
    check("never the whole network's", asked.find("ZbInfo"), nil)

    # a report from an address the map does not have asks for that device, once in a while
    var z4 = PanelZigbee(s, PanelUi(s, shape, / -> [], nil), nil, / e -> nil, / c -> asked.push(c))
    asked.clear()
    tasmota.timers.clear()
    z4.on_event({"ZbReceived": {"0x9999": {"Device": "0x9999", "Power": 1}}})
    check("a report from a short address the map lacks asks for its device", asked, ["ZbInfo 0x9999"])
    z4.on_event({"ZbReceived": {"0x9999": {"Device": "0x9999", "Power": 0}}})
    check("and not again at once", asked, ["ZbInfo 0x9999"])
    while size(tasmota.timers) > 0 turn() end
    tasmota.t += PanelZigbee.SHORT_ASK_MS + 1
    z4.on_event({"ZbReceived": {"0x9999": {"Device": "0x9999", "Power": 0}}})
    check("but again after a while: the answer may have been lost as well", asked, ["ZbInfo 0x9999", "ZbInfo 0x9999"])
    while size(tasmota.timers) > 0 turn() end
    asked.clear()
    z4.on_event({"ZbReceived": {"Lamp1": {"Device": "Lamp1", "Power": 0}}})
    check("a friendly name is no address", asked, [])
    bridge.up = false
    tasmota.t += PanelZigbee.SHORT_ASK_MS + 1
    z4.on_event({"ZbReceived": {"0x9999": {"Device": "0x9999", "Power": 0}}})
    check("with the link down nothing reaches the network, and nothing is asked", asked, [])
    natives.zb_bridge = nil
end
seed_repeat_checks()
tasmota = real_tasmota

# --- out of the bridge's modes, its lamps do not answer -----------------
var mplan = FakePlan()
var mz = PanelZigbee(PanelStore(json.load(living_room_text)), ui, mplan, / e -> nil, / c -> nil)
var zigbee_ids = []
for d: mz.store.doc["devices"] if !PanelStore.is_relay_id(d[0]) zigbee_ids.push(d[0]) end end
mz.mode_is("mesh")
check("in the house's bridges nothing is marked", size(mplan.reports), 0)
mz.mode_is("off")
check("Zigbee off: every Zigbee device marked as not answering, and the relays not",
      [size(mplan.reports), mplan.live.find(zigbee_ids[0]), mplan.live.find("relay:1")], [size(zigbee_ids), "noanswer", nil])
mz.mode_is("off")
check("the same mode again marks nothing more", size(mplan.reports), size(zigbee_ids))

# --- the colour a lamp says, for its icon lit.
# The xy ones are Node's, by the same conversion done there on its own
def color_checks()
    check("red, by hue and saturation", PanelZigbee.color_of({"Hue": 0, "Sat": 254}), 0xF800)
    check("green", PanelZigbee.color_of({"Hue": 85, "Sat": 254}), 0x07E0)
    check("a colour this pale is a white, left to the theme", PanelZigbee.color_of({"Hue": 0, "Sat": 20}), nil)
    check("and so is a colour temperature", [PanelZigbee.color_of({"CT": 300}), PanelZigbee.color_of({"ColorMode": 2, "Hue": 0, "Sat": 254})], [nil, nil])
    check("red, by xy", PanelZigbee.color_of({"X": 45914, "Y": 19615}), 0xF800)
    check("blue, by xy", PanelZigbee.color_of({"X": 9830, "Y": 3932}), 12671)
    check("the white point, by xy", PanelZigbee.color_of({"X": 20493, "Y": 21561}), nil)
    check("a report with nothing of colour says nothing", PanelZigbee.color_of({"Power": 1}), false)
end
color_checks()

# --- a sensor's state, for its icon and the alarm ----------------
def sensor_checks()
    var DOOR = "0x00124B00AAAA0001"
    # a door sensor the panel has, from its + or the Existing device
    store.register_device([DOOR, "Door 1", "sensor", 0, 0, 0, "TS0203", 1, 0, 0])
    zb.on_event({"ZbInfo": {"0x3003": {"Device": "0x3003", "IEEEAddr": DOOR, "ModelId": "TS0203", "Config": ["A01"],
                                       "ZoneType": 21, "ZoneStatus": 1, "Reachable": true}}})
    check("the zone status Z2T kept of a door sensor the panel has is its state at boot: open is on", plan.reports[-1], [DOOR, "on"])
    zb.on_event({"ZbReceived": {"0x3003": {"Device": "0x3003", "Contact": 0, "ZoneStatus": 0, "Endpoint": 1, "LinkQuality": 60}}})
    check("closed is off", plan.reports[-1], [DOOR, "off"])
    zb.on_event({"ZbReceived": {"0x3003": {"Device": "0x3003", "Contact": 1, "ZoneStatus": 1}}})
    check("open again is on", plan.reports[-1], [DOOR, "on"])
    var before = size(plan.reports)
    zb.on_event({"ZbReceived": {"0x3003": {"Device": "0x3003", "BatteryPercentage": 80}}})
    check("its battery alone is no state", size(plan.reports), before)
    zb.on_event({"ZbReceived": {"0x3003": {"Device": "0x3003", "Occupancy": 1}}})
    check("motion, by the occupancy cluster, is on", plan.reports[-1], [DOOR, "on"])
    zb.on_event({"ZbReceived": {"0x3003": {"Device": "0x3003", "ZoneStatus": 2}}})
    check("the second alarm bit of the raw status, with no named alarm, is on too", plan.reports[-1], [DOOR, "on"])
    zb.on_event({"ZbReceived": {"0x3003": {"Device": "0x3003", "ZoneStatus": 8}}})
    check("a low battery in the raw status, with neither alarm bit, is off", plan.reports[-1], [DOOR, "off"])
    before = size(plan.reports)
    zb.on_event({"ZbReceived": {"0x1001": {"Device": "0x1001", "Contact": 1}}})
    check("a lamp saying Contact is nothing: only a sensor is read that way", size(plan.reports), before)
    var cmds = size(sent)
    zb.on_event({"ZbPing": {"Device": "0x3003", "IEEEAddr": DOOR}})
    check("a sensor whose ping is answered is read for no Power: it has none", size(sent), cmds)
    check("what a report says of a sensor, by itself", [PanelZigbee.sensor_state({"Water": true}), PanelZigbee.sensor_state({"Fire": 0}),
          PanelZigbee.sensor_state({"CO": 1, "ZoneStatus": 0}), PanelZigbee.sensor_state({"Tamper": 1})], ["on", "off", "on", nil])
end
sensor_checks()
# --- a Replace whose search ended before the interview did -------------------------------------------------
# The search is left (the title, or the check) while the new device is still being interviewed: it is on the late list, with the old
# one it was to replace, and when its interview ends it takes the old one's place -- its name, its zone and its place -- and the old one
# leaves, rather than coming in as one more in the zone, or in no zone, with the old one staying
def late_replace_checks()
    var s = PanelStore(json.load(living_room_text))
    var u = PanelUi(s, shape, / -> [], nil)
    u.providers.push(PanelAddView(u))
    var eff = []
    var z = PanelZigbee(s, u, nil, / e -> eff.push(e), / c -> nil)
    var OLD = MIDDLE1
    var NEW = "0x00124B0000AA0099"
    var zone = s.zone_of(OLD)["id"]
    var slot = s.zone_of(OLD)["members"][OLD]
    var name = s.find_device(OLD)[1]
    var count = size(s.doc["devices"])
    u.act(["replace", OLD])
    u.act(["pairSearch"])
    z.on_event({"ZbState": {"Status": 30, "IEEEAddr": NEW, "ShortAddr": "0x4099", "PowerSource": true, "ReceiveWhenIdle": true, "Security": false}})
    check("the new device is found, and being configured", u.pairing["found"], [[NEW, "configuring"]])
    check("for the old one's place", u.pairing.find("replace"), OLD)
    u.stop_pairing()
    check("the search left before its interview: the device is late, with its zone, its relay and the one it replaces", u.late.find(NEW), [zone, 0, OLD])
    eff.clear()
    z.on_event({"ZbState": {"Status": 33, "Device": "0x4099", "Endpoint": "0x01", "ProfileId": "0x0104", "DeviceId": "0x010D", "InClusters": ["0x0000", "0x0003", "0x0004", "0x0005", "0x0006", "0x0008", "0x0300"]}})
    check("its interview takes the old one's place: its name, its zone and its slot", [s.find_device(NEW) != nil ? s.find_device(NEW)[1] : nil, s.zone_of(NEW) != nil ? s.zone_of(NEW)["id"] : nil,
          s.zone_of(NEW) != nil ? s.zone_of(NEW)["members"][NEW] : nil], [name, zone, slot])
    check("and the old one is gone, with no device added", [s.find_device(OLD), size(s.doc["devices"])], [nil, count])
    var leaving = []
    for e: eff for x: e if x[0] == "leave" leaving.push(x[1]) end end end
    check("the old one is told to leave the network, and the new one to blink, to come back off after a power cut, and say its model", [leaving, eff[0][0]], [[OLD], ["save"]])
    var kinds = []
    for x: eff[0] kinds.push(x[0]) end
    check("(its effects, in order)", kinds, ["save", "leave", "identify", "startup", "query"])
    check("and it is not late any more", u.late.contains(NEW), false)

    # a second device that was being interviewed when the old one was already replaced: no old one to take the place of, and it comes in as any other late device
    var NEW2 = "0x00124B0000AA0098"
    u.late[NEW2] = [zone, 0, OLD]
    eff.clear()
    z.on_event({"ZbState": {"Status": 30, "IEEEAddr": NEW2, "ShortAddr": "0x4098", "PowerSource": true, "ReceiveWhenIdle": true, "Security": false}})
    z.on_event({"ZbState": {"Status": 33, "Device": "0x4098", "Endpoint": "0x01", "ProfileId": "0x0104", "DeviceId": "0x010D", "InClusters": ["0x0000", "0x0006", "0x0008"]}})
    check("a late one whose old device is gone is registered as one more", s.find_device(NEW2) != nil, true)
    var left2 = []
    for e: eff for x: e if x[0] == "leave" left2.push(x[1]) end end end
    check("and nothing is told to leave", left2, [])
end
late_replace_checks()

# a device the house removed, by another panel: the flood says Gone, and it leaves this panel
do
    var GONE_ID = "0x00124B00CC00AB01"
    store.register_device([GONE_ID, "Gone lamp", "light", 3, 0, 0, "", 1, 0, 0])
    store.set_owner(GONE_ID, 3)
    var n_reports = size(plan.reports)
    effects.clear()
    zb.on_remote({GONE_ID: {"Gone": 1}})
    check("off this panel, saved and drawn again, and no state of it", [store.find_device(GONE_ID), effects[-1], size(plan.reports) - n_reports], [nil, [["save"], ["show"]], 0])
end

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
