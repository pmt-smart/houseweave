# berry/zbbridge_relay.be, the ZBBridge Pro's side of the house, as the classes the bridge's firmware compiles (ZbBridgeRelay, ZbBridgeRelayPairing): how a
# burst of reports is merged and split to fit a frame, the panels its events go to over the mesh and what a panel runs here,
# the window of entering the house, the button, the radio at boot, the Zigbee channel and key, the time, the queue and the house's words. The radio is the
# bench's.

import json
import string
import persist

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if str(got) != str(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# the relay, started as the bridge's autoexec.be starts it (zbbridge_autoexec.be)
var r = ZbBridgeRelay.start()

def report(addr, attrs)
    return {"ZbReceived": {addr: attrs}}
end

# --- the merge within the debounce window -----------------------------------------------
r.pending = nil
r.forward(nil, nil, report("0x1111", {"Device": "0x1111", "Power": 1, "LinkQuality": 80}))
r.forward(nil, nil, report("0x1111", {"Device": "0x1111", "Dimmer": 50}))
r.forward(nil, nil, report("0x2222", {"Power": 0}))
check("a Dimmer after a Power keeps the Power: merged by attribute",
      [r.pending["0x1111"].find("Power"), r.pending["0x1111"].find("Dimmer")], [1, 50])
check("and only what the pages read", r.pending["0x1111"].contains("LinkQuality"), false)
check("each device on its own key", r.pending["0x2222"]["Power"], 0)
check("the send waits for the window", tasmota.timers.contains("zbbridge_relay_send"), true)
r.forward(nil, nil, report("0x3333", {"FC11": 7}))
check("a report with nothing the pages read adds nothing", r.pending.contains("0x3333"), false)
# a lamp's settings, read for its screen on the panel
r.forward(nil, nil, report("0x4444", {"Device": "0x4444", "StartUpOnOff": 255, "OnOffTransitionTime": 5, "LinkQuality": 90}))
check("a lamp's power-on state and its transition time go to the panel", [r.pending["0x4444"].find("StartUpOnOff"), r.pending["0x4444"].find("OnOffTransitionTime")], [255, 5])
# a switch of several: each endpoint's report its own, with what the panel finds its channel by
r.forward(nil, nil, report("0x5555", {"Device": "0x5555", "Endpoint": 1, "Power": 1, "LinkQuality": 70}))
r.forward(nil, nil, report("0x5555", {"Device": "0x5555", "Endpoint": 2, "Power": 0, "LinkQuality": 70}))
r.forward(nil, nil, report("0x6666", {"Device": "0x6666", "Endpoint": 11, "Power": 1}))
check("a channel's endpoint, 2, under its own key, with its address and endpoint; the first as a lamp's, and a Hue's 11 too",
      [r.pending["0x5555"], r.pending["0x5555/2"], r.pending["0x6666"]], [{"Power": 1}, {"Power": 0, "Device": "0x5555", "Endpoint": 2}, {"Power": 1}])
# a sensor's state, for the alarm
r.forward(nil, nil, report("0x7777", {"Device": "0x7777", "Contact": 1, "ZoneStatus": 1, "LinkQuality": 50}))
check("a door's alarm and its raw zone status go to the panel", r.pending["0x7777"], {"Contact": 1, "ZoneStatus": 1})
r.forward(nil, nil, report("0x8888", {"Device": "0x8888", "Occupancy": 0, "Tamper": 1, "BatteryLow": 1, "BatteryPercentage": 40}))
check("and a motion sensor's occupancy, its tamper and its battery", r.pending["0x8888"], {"Occupancy": 0, "Tamper": 1, "BatteryLow": 1, "BatteryPercentage": 40})

# --- a burst split to fit a line, or a frame --------------------------------------------------
var burst = {}
for i: 0 .. 39
    burst[string.format("0x%04X", 0x1000 + i)] = {"Power": 1, "Dimmer": 100, "Hue": 10, "Sat": 200, "CT": 300}
end
def sent_with(budget)
    var out = []
    ZbBridgeRelay.send_batched(burst, budget, / m -> out.push(m))
    return out
end
def all_fit(msgs, budget)
    for m: msgs if size(m) > budget return false end end
    return true
end
def devices_in(msgs)
    var n = {}
    for m: msgs
        for a: json.load(m)["ZbReceived"].keys()
            n[a] = n.find(a, 0) + 1
        end
    end
    return n
end
var whole = json.dump({"ZbReceived": burst})
check("40 lamps in one message pass a frame many times over", size(whole) > 233 * 10, true)
var frames = sent_with(233)
check("split, each within a frame", all_fit(frames, 233), true)
check("several lamps a frame, not one a frame", size(frames) < 40, true)
var seen = devices_in(frames)
var once = true
for a: burst.keys() if seen.find(a) != 1 once = false end end
check("and every lamp in exactly one", [size(seen), once], [40, true])
var few = {"0x1000": {"Power": 1}}
var one = []
ZbBridgeRelay.send_batched(few, 233, / m -> one.push(m))
check("one lamp is one message, whole", one, ['{"ZbReceived":{"0x1000":{"Power":1}}}'])

# --- the panels: over the mesh only ---------------------------------------------------
# what the relay says to the panels goes over the mesh, to each panel that hears it: here a house whose panel 4 marks a device of the bridge, and whose frames
# land in `told` (stub_relay.be, listen_to)
import global as natives
var told = []
natives.espnow_send = def (msg, as_event) told.push(json.load(msg)) return true end
listen_to(r, told)
check("no pair, no link: nothing is switched on at boot, and no ZbRelayMode nor ZbRelayForget is a command",
      [tasmota.cmds.find("EspNowEnable 1"), tasmota.handlers.contains("ZbRelayMode"), tasmota.handlers.contains("ZbRelayForget"), tasmota.handlers.contains("ZbRelayMqtt")],
      [nil, false, false, false])
check("the bridge says it takes a panel's report as the confirmation of a command, by itself", tasmota.cmds.find("SetOption116 1") != nil, true)

# --- an interview that fits a frame -----------------------------------------------
settle_frames(r)
told.clear()
var many = []
for c: [0x0000, 0x0003, 0x0004, 0x0005, 0x0006, 0x0008, 0x0300, 0x0B05, 0x1000, 0xFC57, 0xFC11, 0x0702, 0x0B04, 0xEF00, 0x0019]
    many.push(string.format("0x%04X", c))
end
r.forward_state(nil, nil, {"ZbState": {"Status": 33, "Device": "0x5ADF", "Endpoint": 1, "ProfileId": "0x0104",
                                                    "DeviceId": "0x010D", "InClusters": many}})
check("a device with 15 clusters is interviewed in one frame, to the panels", [size(told), size(json.dump(told[-1])) <= 233], [1, true])
check("with the clusters the pages read, and no more", told[-1]["ZbState"]["InClusters"], ["0x0006", "0x0008", "0x0300"])
# a sensor's interview keeps its IAS zone and occupancy clusters, which the pages tell a sensor by
settle_frames(r)
r.forward_state(nil, nil, {"ZbState": {"Status": 33, "Device": "0x7777", "Endpoint": 1, "ProfileId": "0x0104",
                                                    "DeviceId": "0x0402", "InClusters": ["0x0000", "0x0001", "0x0003", "0x0500", "0x0406", "0x0020"]}})
check("a sensor's interview keeps its zone and occupancy clusters", told[-1]["ZbState"]["InClusters"], ["0x0500", "0x0406"])

# --- what a panel runs here, over the mesh ----------------------------------
tasmota.cmds.clear()
for line: ["ZbSend {\"Device\":\"0x1234\",\"Send\":{\"Power\":1}}", "zbping 0x1234", "SetOption116 1", "ZbPermitJoin 1", "ZbInfo 0x00124B0000E00001",
           "ZbRelayMode3 direct", "ZbRelayForget", "ZbRelayMqtt {}", "ZbRelayMode2 tcp", "ZbRelayRadio 1", "ZbReset 1", "Backlog Restart 1", "WebPassword x",
           "Br load(\"x.be\")", "ZbZNPSend 2400", "ZbSend{\"Device\":\"0x1\"}", "Restart 1"]
    r.run(line, "mesh", 4)
end
check("the commands a panel sends run, and nothing else: until 2026-09-29 every line was run as the console would; the pair's words are nobody's now",
      tasmota.cmds, ["ZbSend {\"Device\":\"0x1234\",\"Send\":{\"Power\":1}}", "zbping 0x1234", "SetOption116 1", "ZbPermitJoin 1", "ZbInfo 0x00124B0000E00001"])
check("and no ESP-NOW command is taken: nothing comes over a link of the panel's own", tasmota.rules.contains("EspNowDirect#Command"), false)

# the house layer's link, as a stand-in that notes what it was asked (berry/house_link.be has its own tests in test_house_mesh.be): the glue of the pairing to it
class FakeLink
    var flagv, is_bound, said, ended, events, step, role, resets, unbinds
    def init(flag)
        self.flagv = flag
        self.is_bound = false
        self.events = []
        self.step = nil
        self.role = nil
        self.resets = 0
        self.unbinds = 0
    end
    def flag() return self.flagv end
    def bind(say, ended) self.is_bound = true self.said = say self.ended = ended end
    def unbind() self.is_bound = false self.unbinds += 1 end
    def bound() return self.is_bound end
    def reset() self.resets += 1 self.step = nil self.role = nil end
    def busy() return self.role != nil end
    def event(kind, m) self.events.push(kind) end
end
# the house's list as the relay asks it: which numbers are panels
class FakeHouseList
    var panels
    def init() self.panels = [] end
    def is_panel(n) return self.panels.find(n) != nil end
end
class FakeHouseState
    var marks, forgot, came
    def init() self.marks = {} self.forgot = [] self.came = [] end
    # the devices removed from the house
    def forgotten(ieee) self.forgot.push(ieee) end
    def back(ieee) self.came.push(ieee) end
    def flood(pending) end
end
class FakeDevices
    def heard(d) end
end
class FakeHouse
    var link, sent, room, up, list, state, went, devices
    def init(l) self.link = l self.sent = [] self.room = 0 self.up = true self.list = FakeHouseList() self.state = FakeHouseState() self.went = 0 self.devices = FakeDevices() end
    # this bridge leaving by itself: the panels told, and what was to follow after
    def go(then)
        self.went += 1
        if then != nil  then() end
        return true
    end
    # the events to the panels over the mesh: what a frame to one carries, and one sent
    def node_room(n) return n > 0 ? self.room : 0 end
    def event_node(n, text) self.sent.push([n, text]) return self.room > 0 end
end

# The panels that hear this bridge: those that commanded it a while ago, the ones that keep it as the bridge of the house's words,
# and those that show its devices, in frames that fit each
def mesh_event_checks()
    var h = FakeHouse(FakeLink(1))
    h.room = 233
    h.list.panels = [4, 5, 6]
    r.house = h
    r.heard_from = {}
    var ev = '{"ZbPing":{"Device":"0x1001"}}'
    r.send_text(ev)
    check("a bridge no panel commanded, kept or marks says nothing", h.sent, [])
    tasmota.at_ms = 1000
    r.run('ZbSend {"Device":"0x1001","Send":{"Power":1}}', "mesh", 5)
    r.run('ZbSend {"Device":"0x1001","Send":{"Power":1}}', "mesh", 9)
    r.run("ZbRelayListen", "mesh", 4)
    h.state.marks[6] = {"u": 0, "s": {}}
    r.send_text(ev)
    var to = {}
    for x: h.sent  to[x[0]] = x[1] end
    check("one that commanded it, one that keeps it, one that shows its devices: a node that is not a panel is none",
          [size(h.sent), to.find(4) == ev, to.find(5) == ev, to.find(6) == ev, to.contains(9)], [3, true, true, true, false])
    h.room = 120
    check("what a frame carries: the least of the panels' rooms", r.frame_budget(), 120)
    h.room = 400
    check("and never more than a frame of ESP-NOW", r.frame_budget(), 233)
    tasmota.at_ms = 1000 + ZbBridgeRelay.LISTEN_MS
    h.sent.clear()
    r.send_text(ev)
    check("one that said nothing for LISTEN_MS no more", h.sent, [[6, ev]])
    h.state.marks = {}
    tasmota.at_ms = nil
    r.heard_from = {}
    listen_to(r, told)
end
mesh_event_checks()

# A panel keeps this bridge as the bridge of the house's words: ZbRelayListen, and its first, with a 1, has the bridge say again what it may have missed
def listen_checks()
    class Said
        var said
        def init() self.said = 0 end
        def say_state() self.said += 1 end
        def link_up() self.said += 1 end
    end
    var a = r.alarm
    var d = r.drivers
    var alarm = Said()
    var drivers = Said()
    r.alarm = alarm
    r.drivers = drivers
    check("the first word: the drivers and the alarm say again", [r.listen("1", 4), drivers.said, alarm.said], [true, 1, 1])
    check("the next ones keep it a listener, and say nothing again", [r.listen("", 4), drivers.said, alarm.said], [true, 1, 1])
    check("a word with no panel is nobody's", r.listen("1", nil), false)
    # after a boot, once the bridge is in its house and in step: everything said again, once, to the panels that hear it (their marks, kept in the flash)
    import global
    var had_stamp = global.contains("espnow_mesh_stamp") ? global.espnow_mesh_stamp : nil
    var in_step = [false]
    global.espnow_mesh_stamp = / -> in_step[0] ? bytes("000100000001") : false
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    # the look the relay's own boot left pending, out of the way
    tasmota.timers.remove("zbbridge_relay_again")
    drivers.said = 0
    r.again_after_boot(ZbBridgeRelay.AGAIN_TRIES)
    check("a bridge in no house at its boot has nobody to tell: nothing said, and nothing looked at again", [drivers.said, alarm.said, tasmota.timers.contains("zbbridge_relay_again")], [0, 1, false])
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 2}
    r.again_after_boot(ZbBridgeRelay.AGAIN_TRIES)
    check("in a house, and not in step yet: nothing said, and it looks again", [drivers.said, tasmota.timers.contains("zbbridge_relay_again")], [0, true])
    in_step[0] = true
    tasmota.timers.fire("zbbridge_relay_again")
    check("in step: everything said again, once", [drivers.said, alarm.said, tasmota.timers.contains("zbbridge_relay_again")], [1, 2, false])
    global.espnow_mesh_stamp = had_stamp
    tasmota.replies.remove("_EspNowMeshId")
    r.alarm = a
    r.drivers = d
end
listen_checks()

# --- entering the house: the window's side ----------------------------------------------
def rule(trigger, value, payload) tasmota.rules[trigger](value, trigger, payload) end
def pair_checks()
    var link = FakeLink(1)
    var h = FakeHouse(link)
    r.house = h
    tasmota.replies["EspNowPairOpen 120,0"] = {"EspNowPairOpen": "Open"}
    tasmota.replies["SSId1"] = {"SSId1": "Cottage"}
    r.open_window(120000, true)
    check("the window is open, by the button", r.window_until != nil, true)
    tasmota.cmds.clear()
    rule("EspNowPair#Paired", "CC:CC:CC:00:00:09", {"EspNowPair": {"Paired": "CC:CC:CC:00:00:09", "Epoch": 1, "Guest": 1}})
    check("a panel pairs it, as a guest: nothing is kept, and the house's link starts from nothing", [r.pairing.guesting, link.resets >= 1, tasmota.cmds], [true, true, []])
    told.clear()
    var tells = []
    natives.espnow_send = def (msg, as_event) tells.push(json.load(msg)) return true end
    tasmota.cmds.clear()
    rule("ZbPair", "guest", {"ZbPair": "guest", "house": 2, "zigbee": 20, "radio": 6})
    check("the panel's word: the bridge answers who it is, its network, and whether it can take a welcome, and is bound for the pieces",
          [tells[-1]["ZbPair"], tells[-1]["name"], tells[-1]["house"], tells[-1]["ssid"], tells[-1]["up"], link.is_bound], ["guest", "zbbridge-living", 1, "Cottage", true, true])
    check("and keeps the house's radio channel for the time it is on no network", tasmota.cmds.find("EspNowMeshChannel 6") != nil, true)
    tasmota.cmds.clear()
    rule("ZbPair", "guest", {"ZbPair": "guest", "house": 2, "zigbee": 20, "radio": 40})
    check("a channel there is none of is not taken", tasmota.cmds.find("EspNowMeshChannel 40"), nil)
    rule("ZbPair", "houseAsk", {"ZbPair": "houseAsk"})
    check("the events of the house are the link's", link.events[-1], "houseAsk")
    tasmota.cmds.clear()
    rule("ZbPair", "wifiAsk", {"ZbPair": "wifiAsk"})
    check("the panel asks for this bridge's network, in the button's window: the driver gives it", tasmota.cmds, ["EspNowGiveWifi"])
    tasmota.cmds.clear()
    rule("ZbPair", "done", {"ZbPair": "done"})
    check("the panel is done: the window closes, and the exchange ends", [r.window_until, tasmota.cmds.find("EspNowPairStop") != nil, r.pairing.guesting], [nil, true, false])
    # a pairing of record, from a panel of an image from before: nothing of it is kept
    r.open_window(120000, true)
    tasmota.cmds.clear()
    rule("EspNowPair#Paired", "CC:CC:CC:00:00:08", {"EspNowPair": {"Paired": "CC:CC:CC:00:00:08", "Epoch": 1}})
    check("a pairing of record: the driver's record dropped at once, and the exchange goes on", [tasmota.cmds, r.pairing.guesting], [["EspNowPeerMac 00:00:00:00:00:00", "EspNowSecret2 0"], true])
    rule("ZbPair", "done", {"ZbPair": "done"})
    # a window opened again while an exchange is up starts over: a panel may have left it with its last word lost on the way
    r.open_window(120000, true)
    rule("EspNowPair#Paired", "CC:CC:CC:00:00:07", {"EspNowPair": {"Paired": "CC:CC:CC:00:00:07", "Epoch": 1, "Guest": 1}})
    tasmota.cmds.clear()
    r.open_window(120000, true)
    check("a window opened again ends the exchange that was up, first", [tasmota.cmds[0], r.pairing.guesting, r.window_open()], ["EspNowPairStop", false, true])
    r.close_window()
    # a window a boot opened gives no network
    tasmota.replies["EspNowPairOpen 300,0"] = {"EspNowPairOpen": "Open"}
    r.open_window(r.BOOT_WINDOW_MS, false)
    rule("EspNowPair#Paired", "CC:CC:CC:00:00:09", {"EspNowPair": {"Paired": "CC:CC:CC:00:00:09", "Epoch": 1, "Guest": 1}})
    tasmota.cmds.clear()
    tells.clear()
    rule("ZbPair", "wifiAsk", {"ZbPair": "wifiAsk"})
    check("a window a boot opened gives no network: refused, said to the panel", [tasmota.cmds, tells[-1]["ZbPair"], tells[-1]["state"]], [[], "wifiResult", "Refused"])
    rule("ZbPair", "done", {"ZbPair": "done"})
    # nothing of the panel's over the link outside an exchange
    rule("ZbPair", "guest", {"ZbPair": "guest", "house": 2})
    check("with no exchange, what comes over the link is nobody's", size(tells), 1)
    natives.espnow_send = def (msg, as_event) told.push(json.load(msg)) return true end
    tasmota.replies.remove("EspNowPairOpen 120,0")
    tasmota.replies.remove("EspNowPairOpen 300,0")
    tasmota.replies.remove("SSId1")
    listen_to(r, told)
end
pair_checks()

# --- the pairing's window: the button, or a boot with no network ------------------
import gpio
tasmota.at_ms = 500000
tasmota.cmds.clear()
var led_was = gpio.levels[17]
r.open_window()
check("the driver does not open it (the radio busy): nothing blinks", [tasmota.cmds, r.window_open(), gpio.levels[17]],
      [["EspNowPairOpen 120,0"], false, led_was])
tasmota.replies["EspNowPairOpen 120,0"] = {"EspNowPairOpen": "Open"}
r.open_window()
check("the button held 5 s: the driver's window, for 2 minutes, with no Zigbee channel up", r.window_open(), true)
check("the button's", r.by_button, true)
check("and the LED blinks", gpio.levels[17] != led_was, true)
tasmota.timers["zbbridge_relay_blink"]()
check("on and off", gpio.levels[17], led_was)
# the button held on to 20 s: the bridge leaves the house; let go before, it does not. The level the pin has at the hold is the pressed one.
# With no house layer here, by the driver alone
var house_was = r.house
r.house = nil
tasmota.cmds.clear()
gpio.levels[4] = 0
r.button_held()
check("the hold opens the window and watches the button", [r.window_open(), r.hold != nil], [true, true])
gpio.levels[4] = 1
tasmota.timers.advance(ZbBridgeRelay.HOLD_STEP_MS + 10)
check("let go before 20 s: nothing more", [r.hold, tasmota.cmds.find("EspNowMeshLeave 1")], [nil, nil])
gpio.levels[4] = 0
r.button_held()
for i: 1 .. (ZbBridgeRelay.LEAVE_HOLD_MS - ZbBridgeRelay.HOLD_AT_MS) / ZbBridgeRelay.HOLD_STEP_MS - 1  tasmota.timers.advance(ZbBridgeRelay.HOLD_STEP_MS) end
check("held on, short of 20 s: still in the house", tasmota.cmds.find("EspNowMeshLeave 1"), nil)
tasmota.timers.advance(ZbBridgeRelay.HOLD_STEP_MS + 10)
check("held on to 20 s: the window closes, and the bridge leaves the house", [r.window_open(), tasmota.cmds.find("EspNowMeshLeave 1") != nil, r.hold], [false, true, nil])
gpio.levels[4] = 1
# the LED says it left, a few blinks, and is left as it was
tasmota.timers.advance(2 * ZbBridgeRelay.LEFT_BLINKS * ZbBridgeRelay.LEFT_BLINK_MS + 100)
check("the LED blinked and is as it was", gpio.levels[17], led_was)
r.house = house_was
r.open_window()
rule("EspNowPair#Blink", "AA:AA:AA:00:00:03", nil)
check("a panel asks it to identify itself: it blinks faster a while", r.identify_until != nil, true)
# what a panel asks over the mesh, its map of the lamps: the answers go back the same way
settle_frames(r)
told.clear()
r.send_event({"ZbInfo": {"0x5A01": {"Device": "0x5A01"}}})
check("an event goes to the panels", told, [{"ZbInfo": {"0x5A01": {"Device": "0x5A01"}}}])
# what Z2T keeps of a sensor goes with its ZbInfo: the zone's type and last status, and the battery; not its LastSeen
settle_frames(r)
r.forward_info(nil, nil, {"ZbInfo": {"0x7777": {"Device": "0x7777", "IEEEAddr": "0x00124B00AAAA0001", "ModelId": "TS0203", "Config": ["A01"],
                                                "ZoneType": 21, "ZoneStatus": 1, "BatteryPercentage": 90, "LastSeen": 12, "Reachable": true}}})
var info = told[-1]["ZbInfo"]["0x00124B00AAAA0001"]
check("a sensor's ZbInfo carries its zone type, its zone status and its battery, and not its LastSeen",
      [info.find("ZoneType"), info.find("ZoneStatus"), info.find("BatteryPercentage"), info.contains("LastSeen")], [21, 1, 90, false])
check("and names it by its IEEE, the same on every bridge's network", [size(told[-1]["ZbInfo"]), info["Device"]], [1, "0x00124B00AAAA0001"])
# a ping a panel sent, answered: to the panels, cut to its two addresses; the command's own answer reaches the rule too, and is not one
settle_frames(r)
var said_before = size(told)
rule("ZbPing", "Done", {"ZbPing": "Done"})
check("the ping command's own answer is not sent", size(told), said_before)
rule("ZbPing", nil, {"ZbPing": {"Device": "0x5A01", "IEEEAddr": "0x00124B0000E00001", "Name": "Lamp"}})
check("a ping answered goes to the panels, named by its IEEE", told[-1], {"ZbPing": {"Device": "0x00124B0000E00001", "IEEEAddr": "0x00124B0000E00001"}})
r.close_window()
tasmota.cmds.clear()
r.open_window()
tasmota.cmds.clear()
rule("EspNowPair#Window", "Closed", nil)
check("the driver closed it on time: nothing to tell it", [tasmota.cmds, r.window_open(), gpio.levels[17]], [[], false, led_was])

# the panel's network, offered over the link: joined
tasmota.cmds.clear()
tasmota.replies["EspNowTakeWifi"] = {"EspNowTakeWifi": "Joining"}
rule("EspNowDirect#WifiOffered", "Cottage-2G", nil)
check("the panel's network: joined by the station driver", [tasmota.cmds, r.pairing.joining], [["EspNowTakeWifi"], "Cottage-2G"])
rule("StaJoin#State", "Connected", {"StaJoin": {"State": "Connected", "SSId": "Cottage-2G", "IP": "192.168.2.61"}})
check("and the join over", r.pairing.joining, nil)
tasmota.replies["EspNowTakeWifi"] = {"EspNowTakeWifi": "Busy"}
tasmota.cmds.clear()
rule("EspNowDirect#WifiOffered", "Cottage-2G", nil)
tasmota.replies["EspNowTakeWifi"] = {"EspNowTakeWifi": "Joining"}
tasmota.timers["zbbridge_relay_join"]()
check("the radio busy: once more a moment later", [tasmota.cmds, r.pairing.joining], [["EspNowTakeWifi", "EspNowTakeWifi"], "Cottage-2G"])
r.pairing.joining = nil
tasmota.replies.remove("EspNowTakeWifi")

# --- the radio with no network saved ------------------------------------
tasmota.cmds.clear()
tasmota.replies = {"SSId": {"SSId1": "", "SSId2": ""}, "StaState": {"StaState": "idle"}, "EspNowPairOpen 300,0": {"EspNowPairOpen": "Open"}}
r.radio_at_boot()
check("no network saved: the radio held with no network and no AP, for ESP-NOW, and the pairing open 5 minutes",
      tasmota.cmds, ["SSId", "StaState", "Wifi 0", "StaHold 1", "EspNowPairOpen 300,0"])
check("a boot's window, not the button's", r.by_button, false)
r.close_window()
tasmota.cmds.clear()
tasmota.replies = {"SSId": {"SSId1": "Cottage", "SSId2": ""}}
r.radio_at_boot()
check("a network saved: Tasmota's Wi-Fi as it is", tasmota.cmds, ["SSId"])
tasmota.cmds.clear()
tasmota.replies = {"SSId": {"SSId1": "", "SSId2": ""}}
r.radio_at_boot()
check("with no station driver to hold the radio, nothing is turned off", tasmota.cmds, ["SSId", "StaState"])
tasmota.replies = {}

# --- the room's Zigbee channel, which the panel that adds this bridge chose --------------------------------
# the zigbee module (be_zigbee.c): the coordinator up, and how many devices its network has
class ZbCoordinator
    var devices
    def init(n) self.devices = n end
    def started() return true end
    def size() return self.devices end
end
natives.zigbee = ZbCoordinator(0)
tasmota.replies["_ZbConfig"] = {"ZbConfig": {"Channel": 11, "PanID": "0x1A63"}}
r.plan_channel(25)
check("a network with no device yet takes the panel's channel, once the pairing is over", r.next_channel, 25)
tasmota.replies["EspNowPairOpen 120,0"] = {"EspNowPairOpen": "Open"}
r.open_window()
rule("EspNowPair#Paired", "CC:CC:CC:00:00:09", {"EspNowPair": {"Paired": "CC:CC:CC:00:00:09", "Epoch": 1, "Guest": 1}})
rule("ZbPair", "guest", {"ZbPair": "guest", "house": 2, "zigbee": 20})
check("the panel's word plans its channel", r.next_channel, 20)
tasmota.cmds.clear()
rule("ZbPair", "done", {"ZbPair": "done"})
check("the window closed: the channel a moment later", [r.next_channel, tasmota.timers.contains("zbbridge_relay_channel")], [20, true])
r.plan_channel(11)
check("the channel it is on already: nothing to do", r.next_channel, nil)
r.plan_channel(9)
check("no Zigbee channel: nothing", r.next_channel, nil)
natives.zigbee = ZbCoordinator(3)
r.plan_channel(25)
check("a network with devices keeps its channel: moved, they would be orphaned", r.next_channel, nil)
natives.zigbee = ZbCoordinator(0)
r.plan_channel(25)
r.pairing.joining = "Cottage"
tasmota.cmds.clear()
tasmota.timers.remove("zbbridge_relay_channel")
r.apply_channel()
check("a join of the panel's network running: the channel waits for it",
      [tasmota.cmds, tasmota.timers.contains("zbbridge_relay_channel"), r.next_channel], [[], true, 25])
r.pairing.joining = nil
tasmota.timers["zbbridge_relay_channel"]()
check("then ZbConfig, which saves the channel and restarts the bridge: the network forms on it, with the key it has (read first)",
      tasmota.cmds, ["_ZbConfig", "_ZbConfig {\"Channel\":25}"])
check("once", r.next_channel, nil)
tasmota.timers.remove("zbbridge_relay_channel")

# the channel's restart takes a key made of the chip's address along, when the network has no device
tasmota.replies["_ZbConfig"] = {"ZbConfig": {"Channel": 11, "KeyL": "0x6F0000AA01020304L", "KeyH": "0x6F0000AA01020304L"}}
r.next_channel = 25
tasmota.cmds.clear()
r.apply_channel()
check("a key made of the address, no device: the channel's ZbConfig takes a random key in the same restart",
      tasmota.cmds, ["_ZbConfig", "_ZbConfig {\"Channel\":25,\"KeyL\":0,\"KeyH\":0}"])
check("both muted", [tasmota.muted.find("_ZbConfig") != nil, tasmota.muted.find("_ZbConfig {\"Channel\":25,\"KeyL\":0,\"KeyH\":0}") != nil], [true, true])
tasmota.replies["_ZbConfig"] = {"ZbConfig": {"Channel": 11, "KeyL": "0x0F0D0B0907050301L", "KeyH": "0x0D0C0A0806040200L"}}
r.next_channel = 25
tasmota.cmds.clear()
r.apply_channel()
check("a key that is random already: the channel only", tasmota.cmds, ["_ZbConfig", "_ZbConfig {\"Channel\":25}"])
tasmota.replies["_ZbConfig"] = {"ZbConfig": {"Channel": 11, "KeyL": "0x6F0000AA01020304L", "KeyH": "0x6F0000AA01020304L"}}
natives.zigbee = ZbCoordinator(2)
r.next_channel = 25
tasmota.cmds.clear()
r.apply_channel()
check("a key made of the address and devices on the network: it keeps it, a new one would leave them orphaned",
      tasmota.cmds, ["_ZbConfig", "_ZbConfig {\"Channel\":25}"])
natives.zigbee = ZbCoordinator(0)

# --- the Zigbee network's key, once after boot (secure_network) ------------------------------------
var derived = {"ZbConfig": {"Channel": 11, "KeyL": "0x6F0000AA01020304L", "KeyH": "0x6F0000AA01020304L"}}
var random_key = {"ZbConfig": {"Channel": 11, "KeyL": "0x0F0D0B0907050301L", "KeyH": "0x0D0C0A0806040200L"}}
class ZbDown
    def started() return false end
    def size() return 0 end
end
def key_run(reply, coordinator, tries)
    tasmota.replies["_ZbConfig"] = reply
    natives.zigbee = coordinator
    tasmota.cmds.clear()
    tasmota.muted.clear()
    tasmota.remove_timer("zbbridge_relay_key")
    r.secure_network(tries)
    return tasmota.cmds
end
r.window_until = nil
r.next_channel = nil
r.pairing.joining = nil
check("a network with no device and a key made of the address: a random key, ZbConfig restarting the bridge",
      key_run(derived, ZbCoordinator(0), 0), ["_ZbConfig", "_ZbConfig {\"KeyL\":0,\"KeyH\":0}"])
check("and every ZbConfig of it muted: the answer carries the key, which the log and MQTT never see",
      tasmota.muted, ["_ZbConfig", "_ZbConfig {\"KeyL\":0,\"KeyH\":0}"])
check("a random key already: nothing", key_run(random_key, ZbCoordinator(0), 0), ["_ZbConfig"])
check("devices on the network: the key stays, with the address's in it", key_run(derived, ZbCoordinator(4), 0), ["_ZbConfig"])
check("no key in the answer (a Z2T that says none): nothing", key_run({"ZbConfig": {"Channel": 11}}, ZbCoordinator(0), 0), ["_ZbConfig"])
check("the coordinator not up: nothing asked, and looked at again", [key_run(derived, ZbDown(), 0), tasmota.timers.contains("zbbridge_relay_key")], [[], true])
check("and up to the last of the tries, and no more",
      [key_run(derived, ZbDown(), ZbBridgeRelay.KEY_TRIES - 1), tasmota.timers.contains("zbbridge_relay_key"),
       key_run(derived, ZbDown(), ZbBridgeRelay.KEY_TRIES), tasmota.timers.contains("zbbridge_relay_key")],
      [[], true, [], false])
r.window_until = tasmota.millis(100000)
check("the pairing's window open: the bridge is the pairing's first, and the key is looked at again",
      [key_run(derived, ZbCoordinator(0), 0), tasmota.timers.contains("zbbridge_relay_key")], [[], true])
r.window_until = nil
r.pairing.joining = "Cottage"
check("a join of the panel's network running: the same", [key_run(derived, ZbCoordinator(0), 0), tasmota.timers.contains("zbbridge_relay_key")], [[], true])
r.pairing.joining = nil
r.next_channel = 25
check("the panel's channel waiting to be taken: it takes the key with it, and this waits",
      [key_run(derived, ZbCoordinator(0), 0), tasmota.timers.contains("zbbridge_relay_key")], [[], true])
r.next_channel = nil
tasmota.remove_timer("zbbridge_relay_key")
check("boot looks at the key once, a while after", [r.boot(), tasmota.timers.contains("zbbridge_relay_key")], [nil, true])
tasmota.remove_timer("zbbridge_relay_key")
tasmota.replies.remove("_ZbConfig")

# --- the house's MQTT, as this bridge takes it -----------------------------
check("ZbRelayMqtt is no command: the house carries the MQTT", ZbBridgeRelay.ALLOWED.find("ZBRELAYMQTT") != nil, false)
# each setting alone, and the discovery's switch and its battery timeout to the discovery
class FakeDiscovery
    var said
    def init() self.said = [] end
    def set_on(on) self.said.push(["on", on]) end
    def set_expire(h) self.said.push(["expire", h]) end
end
var had = r.discovery
r.discovery = FakeDiscovery()
tasmota.cmds.clear()
r.apply_mqtt({"host": "192.168.2.10", "port": 1884, "user": "home", "password": "a;b c", "discovery": true, "expire": 25})
check("the house's broker: each setting alone, the password silent and whole, a ; and a space in it",
      tasmota.cmds, ["MqttHost", "MqttHost 192.168.2.10", "MqttPort 1884", "MqttUser home", "MqttPassword2 a;b c"])
check("the house's discovery and battery timeout, to the Zigbee devices' discovery", r.discovery.said, [["on", true], ["expire", 25]])
tasmota.cmds.clear()
r.apply_mqtt({"host": "", "port": 1883, "user": "", "password": "", "discovery": false, "expire": 0})
check("the house's MQTT off: the host, the user and the password cleared",
      tasmota.cmds, ["MqttHost", "MqttHost \"", "MqttPort 1883", "MqttUser \"", "MqttPassword2 \""])
# a house that keeps no password: the one this bridge has stays on the same broker, and another broker's is cleared
tasmota.cmds.clear()
tasmota.replies["MqttHost"] = {"MqttHost": "192.168.2.10"}
r.apply_mqtt({"host": "192.168.2.10", "port": 1883, "user": "home", "password": "", "discovery": true, "expire": 0, "keep": true})
check("each node its own password: on the same broker, none sent", tasmota.cmds, ["MqttHost", "MqttHost 192.168.2.10", "MqttPort 1883", "MqttUser home"])
tasmota.cmds.clear()
tasmota.replies["MqttHost"] = {"MqttHost": "192.168.2.99"}
r.apply_mqtt({"host": "192.168.2.10", "port": 1883, "user": "home", "password": "", "discovery": true, "expire": 0, "keep": true})
check("on another broker, its password cleared: it was that one's", tasmota.cmds[-1], "MqttPassword2 \"")
tasmota.replies.remove("MqttHost")
r.discovery = had

# --- the time: the panel's word, and the bridge's answer with its own
def time_checks()
    def said_time(payload)
        told.clear()
        tasmota.cmds.clear()
        tasmota.handlers["ZbRelayTime"]("ZbRelayTime", 1, payload)
        var said = size(told) > 0 ? told[-1] : nil
        return said != nil ? said.find("ZbTime") : nil
    end
    def times() var t = [] for c: tasmota.cmds if c[0 .. 4] == "Time " t.push(c) end end return t end
    check("the panel's word is a command the relay knows, and lets through the mesh",
          [tasmota.handlers.contains("ZbRelayTime"), ZbBridgeRelay.ALLOWED.find("ZBRELAYTIME") != nil], [true, true])
    check("and the bridge hears its own clock set", tasmota.rule_lists["Time#Set"][0][0], "zbbridge_relay_time")

    # a boot with no clock: the panel's time is taken, and the NTP gets the clock back
    tasmota.utc_now = 0
    tasmota.replies.remove("RtcRetain")
    r.time_boot()
    check("a boot with no clock has none to say", [r.clock_src, r.clock_at], [nil, 0])
    var word = said_time('{"utc":1791376200,"src":"you","at":1791376100}')
    check("a bridge with no clock takes the panel's, and gives it back to the NTP", times(), ["Time 1791376200", "Time 0"])
    check("and answers with it: from the panel, as fresh as the panel's", word, {"utc": 1791376200, "src": "panel", "at": 1791376100})
    check("the console hears the command done", tasmota.answers[-1], "done")
    rule("Time#Set", nil, {"Time": {"Set": 1791376200}})
    check("its Time#Set is the panel's", [r.clock_src, r.clock_at, r.clock_expect], ["panel", 1791376100, nil])
    tasmota.utc_now = 1791376300
    rule("Time#Set", nil, {"Time": {"Set": 1791376300}})
    check("the next is the internet's, the freshest", [r.clock_src, r.clock_at], ["internet", 1791376300])

    # between two set clocks, the one set last wins, and only when the two are apart
    word = said_time('{"utc":1791376400,"src":"internet","at":1791376200}')
    check("a word set before the bridge's own is not taken, and the bridge says its own",
          [times(), word], [[], {"utc": 1791376300, "src": "internet", "at": 1791376300}])
    word = said_time('{"utc":1791376302,"src":"you","at":1791376301}')
    check("a fresher word within two seconds changes nothing", [times(), r.clock_src], [[], "internet"])
    word = said_time('{"utc":1791376360,"src":"you","at":1791376301}')
    check("a fresher word further apart is taken", [times(), word["src"], word["at"]], [["Time 1791376360", "Time 0"], "panel", 1791376301])
    rule("Time#Set", nil, {"Time": {"Set": 1791376360}})

    # what is not a word is not taken, and still answered
    for p: ["not json", "[1,2]", '{"utc":0,"src":"you","at":1791379999}', '{"utc":1791379999,"at":"x"}', '{"src":"you"}', ""]
        word = said_time(p)
        check("not a word, so not taken: " + p, [times(), word != nil, tasmota.answers[-1]], [[], true, "done"])
    end
    check("and the answer fits a frame", size(json.dump({"ZbTime": word})) <= 233, true)

    # a boot whose time was kept across the restart, by the fork's RtcRetain
    tasmota.replies["RtcRetain"] = {"RtcRetain": {"Restored": 1, "Gap": 4}}
    r.time_boot()
    check("a time kept across a restart is said so, and not known fresh", [r.clock_src, r.clock_at], ["restart", 0])
    tasmota.replies["RtcRetain"] = {"RtcRetain": {"Restored": 0, "Gap": 0}}
    r.time_boot()
    check("one that was not: the internet's", r.clock_src, "internet")
    tasmota.replies.remove("RtcRetain")
    tasmota.utc_now = 0
    r.time_boot()
end
time_checks()

# --- what Z2T says goes to the NSPanel through a queue: two at once, the rest 80 ms apart ----
# The NSPanel's ESP-NOW driver keeps four frames for its loop and drops the oldest of a longer burst: the answer to a ZbInfo of 30
# devices was 30 frames in the same instant, and the Living room's map came out with 4 of them. A tap's single report goes at once.
def pace_checks()
    r.window_until = nil
    r.budget = 233
    r.out = []
    r.queued = {}
    settle_frames(r)
    var info = {}
    var addrs = []
    for i: 0 .. 29
        var a = string.format("0x%04X", 0x5A00 + i)
        addrs.push(a)
        info[a] = {"Device": a, "IEEEAddr": string.format("0x00124B00%08X", i), "ModelId": "TS0505B", "Config": ["01000A"], "Power": 1, "Reachable": true, "LastSeen": 7}
    end
    def keys_of(frames)
        var out = []
        for f: frames
            if f.contains("ZbInfo")
                for k: f["ZbInfo"].keys()  out.push(k) end
            end
        end
        return out
    end
    def power_of(frames, a)
        for f: frames
            if f.contains("ZbInfo") && f["ZbInfo"].contains(a)  return f["ZbInfo"][a]["Power"] end
        end
        return nil
    end
    # the whole network in one rule event, as Z2T has it
    told.clear()
    r.forward_info(nil, nil, {"ZbInfo": info})
    check("30 devices in one ZbInfo: two frames at once, 28 waiting, and a timer for the rest", [size(told), size(r.out), tasmota.timers.contains("zbbridge_relay_frames")], [2, 28, true])
    check("the two that went are the first two", size(keys_of(told)), 2)
    tasmota.timers.fire("zbbridge_relay_frames")
    check("80 ms later one more, and the timer for the next", [size(told), size(r.out), tasmota.timers.contains("zbbridge_relay_frames")], [3, 27, true])
    var took = settle_frames(r)
    check("27 more, a frame to a timer, and then the two credits back", [size(told), size(r.out), took], [30, 0, 27 + 2])
    # the order of the map the rule gave, which a Berry map keeps as it likes
    var said = []
    for a: info.keys()  said.push(info[a]["IEEEAddr"]) end
    check("every device once, in the order the rule's map gave them, by its IEEE", keys_of(told), said)
    check("each cut to what the pages read: no LastSeen", string.find(json.dump(told[0]), "LastSeen") >= 0, false)
    # the same, as the simulator has Z2T say it: a rule event a device
    told.clear()
    for a: addrs  r.forward_info(nil, nil, {"ZbInfo": {a: info[a]}}) end
    check("or 30 events of one device each: the same, two at once", [size(told), size(r.out)], [2, 28])
    settle_frames(r)
    check("and all of them in the end", size(keys_of(told)), 30)
    # one or two devices, a ZbInfo of one device the panel asked for: at once, no queue
    told.clear()
    r.forward_info(nil, nil, {"ZbInfo": {"0x5A00": info["0x5A00"], "0x5A01": info["0x5A01"]}})
    check("two devices: both at once, nothing waiting", [size(told), size(r.out)], [2, 0])
    settle_frames(r)
    # the panel asks again while the first answer waits (its map is short): a device waiting is not queued twice, and says what Z2T knows now
    told.clear()
    r.forward_info(nil, nil, {"ZbInfo": info})
    var again = {}
    for a: addrs  again[a] = {"Device": a, "IEEEAddr": info[a]["IEEEAddr"], "Power": a == "0x5A05" ? 0 : 1, "Reachable": true} end
    r.forward_info(nil, nil, {"ZbInfo": again})
    check("the same asked again with 28 waiting: the 28 are not twice, the 2 that went are said again", [size(told), size(r.out), size(r.queued)], [2, 30, 30])
    settle_frames(r)
    check("each device once, but the two that had gone: 32 frames in all", [size(told), size(keys_of(told))], [32, 32])
    check("and the one that waited says what it was told last", [power_of(told, info["0x5A05"]["IEEEAddr"]), power_of(told, info["0x5A04"]["IEEEAddr"])], [0, 1])
    # the queue is in order: a report that comes while the map waits goes behind it
    told.clear()
    r.forward_info(nil, nil, {"ZbInfo": info})
    r.pending = nil
    r.forward(nil, nil, report("0x5A00", {"Device": "0x5A00", "Power": 0}))
    tasmota.timers.fire("zbbridge_relay_send")
    check("a report meanwhile waits its turn, behind the map: a lamp's last state is never taken back by an older ZbInfo", [size(told), size(r.out), r.out[-1][0]], [2, 29, nil])
    settle_frames(r)
    check("and goes last", [size(told), told[-1].contains("ZbReceived")], [31, true])
    # a tap's own report: at once, as it always went
    told.clear()
    r.forward(nil, nil, report("0x5A02", {"Device": "0x5A02", "Power": 1}))
    tasmota.timers.fire("zbbridge_relay_send")
    check("one report: at once", [size(told), size(r.out)], [1, 0])
    # a burst of reports, as a group of 12 lamps answers: the batches in order, two at once
    var many = {}
    for i: 0 .. 39  many[string.format("0x%04X", 0x6000 + i)] = {"Power": 1, "Dimmer": 100, "Hue": 10, "Sat": 200, "CT": 300} end
    settle_frames(r)
    told.clear()
    r.pending = many
    r.send_now()
    var batches = size(told) + size(r.out)
    check("40 lamps' reports are more than two frames of 233 bytes: the first two at once, the rest paced", [batches > 3, size(told), size(r.out) > 0], [true, 2, true])
    settle_frames(r)
    var texts = []
    for f: told  texts.push(json.dump(f)) end
    check("and every lamp comes, once", size(devices_in(texts)), 40)
    # what the pairing, the alarm and the drivers say does not wait behind it
    told.clear()
    r.forward_info(nil, nil, {"ZbInfo": info})
    r.send_event({"ZbAlarm": {"st": "disarmed", "v": 3}})
    check("an event of the alarm goes at once, with the map waiting", [size(told), told[-1].contains("ZbAlarm"), size(r.out)], [3, true, 28])
    settle_frames(r)
    # more than OUT_MAX frames waiting: the oldest go
    told.clear()
    r.out = []
    r.queued = {}
    for i: 1 .. 70  r.emit(nil, {"ZbPing": {"Device": string.format("0x%04X", i), "IEEEAddr": "0x1"}}) end
    check("70 frames at once: two went, and the queue holds 64", [size(told), size(r.out)], [2, ZbBridgeRelay.OUT_MAX])
    settle_frames(r)
    check("the oldest of the waiting were dropped, the first two had gone", [size(told), told[2]["ZbPing"]["Device"], told[-1]["ZbPing"]["Device"]], [66, "0x0007", "0x0046"])
    told.clear()
end
pace_checks()


# --- a word this bridge does not know is said at level 1 ----------------------------------------------------------
# The vocabulary the panel sends has no version: a panel newer than its bridge says words the bridge refuses, and the panel's
# "Sending" has only this line to be told by. The log's level 2 is the console's WebLog 2, which the bridge does not run at.
def refused_checks()
    var logged = []
    var shown = log
    log = def (msg, level) logged.push([level, msg]) shown(msg, level) end
    tasmota.cmds.clear()
    r.run("ZbRelayPanicAct {}", "mesh", 4)
    r.run("ZbReset 1", "mesh", 4)
    log = shown
    check("a word the bridge does not send is not run", tasmota.cmds, [])
    check("and the log says it at level 1, with the word and the way it came",
          logged, [[1, "ZBBRIDGE_RELAY: refused from the mesh, not a command a panel sends: ZBRELAYPANICACT"],
                   [1, "ZBBRIDGE_RELAY: refused from the mesh, not a command a panel sends: ZBRESET"]])
end
refused_checks()

# --- what each device does on the panic is a word of its own ------------------------------------------------
# panic_cfg took the whole list [[ieee, act], ...] in one line: seven devices are over the 233 bytes of an ESP-NOW frame, and the
# link dropped it. The relay takes panic_act, one device's pair, and gives the alarm the list it keeps with that pair changed.
# A double stands for the alarm here (its own tests are test_zbbridge_alarm.be's): what it keeps and what it was given.
class AlarmDouble
    var cfg, given, words
    def init() self.cfg = {"panic": {"ha": true, "devices": []}} self.given = [] self.words = [] end
    def set_panic(m)
        self.given.push(m)
        self.cfg["panic"]["devices"] = m["devices"]
        return true
    end
    def cmd_payload(payload) self.words.push(payload) end
end
def panic_act_checks()
    var was = r.alarm
    var a = AlarmDouble()
    r.alarm = a
    var h = tasmota.handlers["ZbRelayAlarm"]
    tasmota.answers.clear()
    h(nil, nil, '{"do":"panic_act","id":"0x00124B0000AAAA01","act":"on"}')
    check("a device's act: the list the alarm keeps has its pair, and the console is told it is done", [a.cfg["panic"]["devices"], tasmota.answers[-1]], [[["0x00124B0000AAAA01", "on"]], "done"])
    h(nil, nil, '{"do":"panic_act","id":"0x00124b0000aaaa02","act":"open"}')
    check("another's: both, the address as the alarm names it, in capitals", a.cfg["panic"]["devices"], [["0x00124B0000AAAA01", "on"], ["0x00124B0000AAAA02", "open"]])
    h(nil, nil, '{"do":"panic_act","id":"00124B0000AAAA01","act":"off"}')
    check("a device again: its pair changed, and put last, as the glass has done", a.cfg["panic"]["devices"], [["0x00124B0000AAAA02", "open"], ["0x00124B0000AAAA01", "off"]])
    h(nil, nil, '{"do":"panic_act","id":"0x00124B0000AAAA02","act":"none"}')
    check("none takes its pair out", a.cfg["panic"]["devices"], [["0x00124B0000AAAA01", "off"]])
    h(nil, nil, '{"do":"panic_act","id":"0x00124B0000AAAA09","act":"none"}')
    check("none for a device with no pair changes nothing, and is done", [a.cfg["panic"]["devices"], tasmota.answers[-1]], [[["0x00124B0000AAAA01", "off"]], "done"])
    check("every word reached the alarm's own set_panic, which saves", size(a.given), 5)
    # a frame a device: each of them is a short line
    var line = '{"do":"panic_act","id":"0x00124B0000AAAA01","act":"close"}'
    check("and a line of it is a fifth of what a frame carries", size(line) < 233 / 3, true)
    # what is not a word of it
    var before = json.dump(a.cfg["panic"]["devices"])
    for bad: ['{"do":"panic_act","id":"0x1","act":"on"}', '{"do":"panic_act","id":7,"act":"on"}', '{"do":"panic_act","id":"0x00124B0000AAAA05"}',
              '{"do":"panic_act","id":"0x00124B0000AAAA05","act":""}', '{"do":"panic_act","id":"0x00124B0000AAAA05","act":"turn on the lights and the siren"}']
        h(nil, nil, bad)
        check("refused: " + bad, [tasmota.answers[-1], json.dump(a.cfg["panic"]["devices"]) == before], ["failed", true])
    end
    # a list past the most: the 33rd is refused, and one already there still changes
    a.cfg["panic"]["devices"] = []
    for i: 0 .. ZbBridgeRelay.PANIC_MAX - 1
        h(nil, nil, string.format('{"do":"panic_act","id":"0x00124B0000BB%04X","act":"on"}', i))
    end
    check("the most the list holds", size(a.cfg["panic"]["devices"]), ZbBridgeRelay.PANIC_MAX)
    h(nil, nil, '{"do":"panic_act","id":"0x00124B0000CC0001","act":"on"}')
    check("one more is refused", [tasmota.answers[-1], size(a.cfg["panic"]["devices"])], ["failed", ZbBridgeRelay.PANIC_MAX])
    h(nil, nil, '{"do":"panic_act","id":"0x00124B0000BB0003","act":"off"}')
    check("and one already in it still changes", [tasmota.answers[-1], a.cfg["panic"]["devices"][-1]], ["done", ["0x00124B0000BB0003", "off"]])
    # the other words go to the alarm as they did
    h(nil, nil, '{"do":"panic_cfg","ha":true}')
    h(nil, nil, '{"do":"siren","id":"0x1","on":true}')
    h(nil, nil, '{"do":"state","note":"mentions panic_act"}')
    check("the alarm's other words are its own: all three reached it, as the console's command", size(a.words), 3)
    r.alarm = nil
    tasmota.answers.clear()
    h(nil, nil, '{"do":"panic_act","id":"0x00124B0000AAAA01","act":"on"}')
    check("with no alarm on this bridge: failed, as before", tasmota.answers[-1], "failed")
    r.alarm = was
end
panic_act_checks()

# --- the flash falls over in the factory reset's save -----------------------------------------------
def failing_save_checks()
    persist.plan = nil
    persist.failures = 0
    persist.setmember("zb_marker", 1)
    var house_was = r.house
    r.house = nil
    var err = nil
    tasmota.cmds.clear()
    persist.fail_next()
    try
        r.wipe()
    except .. as e
        err = e
    end
    check("a factory reset whose save falls over goes on: out of the house first (with no house layer here, by the driver alone), the network and the settings are erased all the same, and nothing is raised",
          [err, persist.failures, tasmota.cmds], [nil, 1, ["EspNowMeshLeave 1", "EspNowEnable 0", "EspNowPeerMac 00:00:00:00:00:00", "EspNowSecret2 0", "ZbReset 1", "Reset 1"]])
    persist.plan = nil
    persist.zero()
    persist.written = nil
    r.house = house_was
end
failing_save_checks()

# A device removed from the house: the bridge's ZbForget leaves its tombstone, and an announce of it lifts it
class OnNet
    var known
    def init(l) self.known = l end
    def started() return true end
    def size() return size(self.known) end
    def find(a) return self.known.find(a) != nil ? a : nil end
end
do
    var h = FakeHouse(FakeLink(1))
    r.house = h
    var was = natives.zigbee
    natives.zigbee = OnNet(["0x00124B0000AA0001"])
    r.run("ZbForget 0x00124B0000BB0002", "mesh", nil)
    check("a forget of a device this bridge does not have leaves no tombstone (the bench, 2026-10-18)", h.state.forgot, [])
    r.run("ZbForget 0x00124B0000AA0001", "mesh", nil)
    check("a forget, from a panel of the house, is a device the house removed", h.state.forgot, ["0x00124B0000AA0001"])
    natives.zigbee = OnNet(["0x00124B0000CC0003"])
    r.run("ZbLeave 0x00124B0000CC0003", "mesh", nil)
    natives.zigbee = OnNet([])
    r.run("ZbForget 0x00124B0000CC0003", "mesh", nil)
    check("the forget after the leave that took the device out of the network: removed all the same", h.state.forgot, ["0x00124B0000AA0001", "0x00124B0000CC0003"])
    check("and nothing kept of the leave", size(r.leaving), 0)
    natives.zigbee = was
    r.forward_state(nil, nil, {"ZbState": {"Status": 30, "IEEEAddr": "0x00124B0000AA0001", "ShortAddr": "0x1234", "PowerSource": true}})
    check("its announce, back on the network, is not", h.state.came, ["0x00124B0000AA0001"])
    r.house = nil
end

# A bridge that leaves the house by itself says so to the panels first: its button held, its factory reset
do
    var h = FakeHouse(FakeLink(1))
    r.house = h
    var after = [0]
    r.leave_house(def () after[0] += 1 end)
    check("in a house, the panels told first, and what follows once it has left", [h.went, after[0]], [1, 1])
    h.up = false
    var was = h.went
    tasmota.cmds.clear()
    r.house = nil
    r.leave_house(def () after[0] += 1 end)
    check("with no house layer, the driver's leave at once, and what follows", [tasmota.cmds.find("EspNowMeshLeave 1") != nil, after[0]], [true, 2])
end

# A bridge's web password and its factory reset, from any panel of the house over the mesh
do
    import json
    var h = FakeHouse(FakeLink(1))
    h.room = 200
    h.list.panels = [4, 5]
    r.house = h
    tasmota.cmds.clear()
    check("a password from a panel of the house over the mesh: set, and the panel told by its word",
          [r.admin('{"do":"lock","pw":"Ab3dEf6hJk","n":"x1"}', "mesh", 5), tasmota.cmds.find("WebPassword2 Ab3dEf6hJk") != nil, h.sent[-1]],
          [true, true, [5, '{"ZbRelayAdmin":{"did":"lock","n":"x1"}}']])
    tasmota.cmds.clear()
    check("not by the link", [r.admin('{"do":"lock","pw":"Ab3dEf6hJk","n":"x2"}', "direct", 5), size(tasmota.cmds)], [false, 0])
    check("nor from a node that is not a panel of the house", r.admin('{"do":"unlock","n":"x3"}', "mesh", 9), false)
    check("nor a password that is too short, or has a quote or a space",
          [r.admin('{"do":"lock","pw":"short","n":"x4"}', "mesh", 5), r.admin('{"do":"lock","pw":"abc\\"defgh","n":"x5"}', "mesh", 5), r.admin('{"do":"lock","pw":"abcd efgh","n":"x6"}', "mesh", 5)],
          [false, false, false])
    check("its removal", [r.admin('{"do":"unlock","n":"x7"}', "mesh", 4), tasmota.cmds.find('WebPassword2 "') != nil, h.sent[-1][0]], [true, true, 4])
    check("a word it does not know", r.admin('{"do":"format","n":"x8"}', "mesh", 4), false)
    # the word by the command line, as the mesh's MeshCmd runs it
    tasmota.cmds.clear()
    r.run('ZbRelayAdmin {"do":"lock","pw":"Zz9yYx8wWv","n":"x9"}', "mesh", 4)
    check("the command line from the mesh takes it", tasmota.cmds.find("WebPassword2 Zz9yYx8wWv") != nil, true)
    r.house = nil
end

# --- the network's identity: the PAN IDs drawn with the key, the abort, the channel kept -----------------------
# Two bridges out of their boxes, both 0x0001 / 0xCCCCCCCC00000000 on channel 11 (the radio held at
# their first boot, the MAC read as zero), and the second could not form its network ("try changing PanID")
def identity_checks()
    import crypto
    import string
    var zero_mac = {"Channel": 11, "PanID": "0x0001", "ExtPanID": "0xCCCCCCCC00000000", "KeyL": "0x0000000000000000L", "KeyH": "0x0000000000000000L"}
    var batch = {"Channel": 11, "PanID": "0x1880", "ExtPanID": "0xCCCCCCCC99D8CBB0", "KeyL": "0x0F0D0B0907050301L", "KeyH": "0x0D0C0A0806040200L"}
    var drawn = {"Channel": 11, "PanID": "0x2B17", "ExtPanID": "0x5A1C0F3377E2D901", "KeyL": "0x0F0D0B0907050301L", "KeyH": "0x0D0C0A0806040200L"}
    var f = ZbBridgeRelay.fresh_identity(zero_mac)
    check("the identity of a radio held at the first boot: a PAN ID, an extended one and a key, all drawn",
          [string.find(f, "\"PanID\":\"0x") == 0, string.find(f, "\"ExtPanID\":\"0x") > 0, string.find(f, "\"KeyL\":0,\"KeyH\":0") > 0], [true, true, true])
    f = ZbBridgeRelay.fresh_identity(batch)
    check("a random key and the extended PAN ID of the batch's MAC: the PAN IDs only", [string.find(f, "PanID") >= 0, string.find(f, "KeyL") >= 0], [true, false])
    check("an identity drawn already: nothing", ZbBridgeRelay.fresh_identity(drawn), "")
    check("no ZbConfig: nothing", ZbBridgeRelay.fresh_identity(nil), "")
    var pans_ok = true
    var exts_ok = true
    for i: 0 .. 255
        crypto.drawn = i
        var s = ZbBridgeRelay.fresh_identity(zero_mac)
        var a = string.find(s, "\"PanID\":\"") + 9
        var pan = int(s[a .. a + 5])
        if pan < 1 || pan > 0x3FFE  pans_ok = false end
        var e = string.find(s, "\"ExtPanID\":\"0x") + 14
        var ext = s[e .. e + 15]
        if size(ext) != 16 || ext[0 .. 7] == "CCCCCCCC" || ext == "0000000000000000" || ext == "FFFFFFFFFFFFFFFF"  exts_ok = false end
    end
    check("the PAN ID drawn is 0x0001 to 0x3FFE whatever the generator gives: never 0x0000, 0x3FFF or 0xFFFF", pans_ok, true)
    check("and the extended one 16 digits, never a derived one, all zeros or all ones", exts_ok, true)

    r.window_until = nil
    r.next_channel = nil
    r.pairing.joining = nil
    r.coord_due = false
    r.zb_aborted = false
    var cmds = key_run({"ZbConfig": zero_mac}, ZbCoordinator(0), 0)
    check("secure_network at a first boot's identity: one ZbConfig with the PAN IDs and the zero key, and every one muted",
          [size(cmds), string.find(cmds[1], "_ZbConfig {\"PanID\":\"0x") == 0, string.find(cmds[1], "\"KeyL\":0,\"KeyH\":0}") > 0, tasmota.muted == cmds],
          [2, true, true, true])
    check("the batch's PAN IDs with devices on the network: nothing", key_run({"ZbConfig": batch}, ZbCoordinator(3), 0), ["_ZbConfig"])
    r.coord_due = true
    check("the coordinator's flash due: the identity waits for it",
          [key_run({"ZbConfig": zero_mac}, ZbCoordinator(0), 0), tasmota.timers.contains("zbbridge_relay_key")], [[], true])
    r.coord_due = false

    # the coordinator Z2T gave up on, with the image's Z-Stack in it: it takes no command, ZbConfig included
    var unknown = {"Command": "Unknown", "Input": "ZBCONFIG"}
    r.coord_rev = ZbBridgeRelay.COORD_REVISION
    r.forward_state(nil, nil, {"ZbState": {"Status": 99, "Message": "Abort"}})
    check("Z2T gave up on a coordinator with the image's Z-Stack: marked", r.zb_aborted, true)
    r.boot_fix = ZbBridgeRelay.fresh_identity(zero_mac)
    persist.remove("zb_identity_restart")
    tasmota.remove_timer("zbbridge_relay_identity_restart")
    cmds = key_run(unknown, ZbDown(), 0)
    check("its ZbConfig Unknown, a derived PAN ID seen at this boot: a restart, once, for the next boot to draw it before the coordinator starts",
          [cmds, tasmota.timers.contains("zbbridge_relay_identity_restart"), persist.find("zb_identity_restart")], [["_ZbConfig"], true, true])
    tasmota.remove_timer("zbbridge_relay_identity_restart")
    key_run(unknown, ZbDown(), 0)
    check("and not twice: a restart for it is behind, and Z2T gave up again", tasmota.timers.contains("zbbridge_relay_identity_restart"), false)
    r.forward_state(nil, nil, {"ZbState": {"Status": 0, "Message": "Started"}})
    check("a coordinator that starts puts that behind", persist.contains("zb_identity_restart"), false)
    r.boot_fix = ""
    key_run(unknown, ZbDown(), 0)
    check("a drawn identity Z2T gave up on: no restart, the PAN ID is not the cause", tasmota.timers.contains("zbbridge_relay_identity_restart"), false)
    r.boot_fix = ZbBridgeRelay.fresh_identity(zero_mac)
    key_run(unknown, ZbCoordinator(2), 0)
    check("devices on the network: no restart", tasmota.timers.contains("zbbridge_relay_identity_restart"), false)
    r.boot_fix = nil

    # the identity drawn when the ZNP says the image's Z-Stack, before the coordinator starts (identity_at_boot)
    var image = {"ZbState": {"Status": 50, "MajorRel": 2, "MinorRel": 7, "MaintRel": 1, "Revision": 20220219}}
    tasmota.replies["_ZbConfig"] = {"ZbConfig": zero_mac}
    natives.zigbee = ZbDown()
    tasmota.cmds.clear()
    r.forward_state(nil, nil, image)
    check("the ZNP says the image's Z-Stack, the identity derived, no device: one ZbConfig with the PAN IDs and the key, there and then",
          [size(tasmota.cmds), string.find(tasmota.cmds[-1], "_ZbConfig {\"PanID\":\"0x") == 0, r.boot_fix != ""], [2, true, true])
    r.window_until = tasmota.millis(100000)
    tasmota.cmds.clear()
    r.forward_state(nil, nil, image)
    check("an open window that no panel has used does not hold it: the restart opens it again", size(tasmota.cmds), 2)
    r.window_until = nil
    r.pairing.joining = "Cottage"
    tasmota.cmds.clear()
    r.forward_state(nil, nil, image)
    check("a join of the panel's network holds it, and what was derived is noted", [tasmota.cmds, r.boot_fix != ""], [["_ZbConfig"], true])
    r.pairing.joining = nil
    natives.zigbee = ZbCoordinator(3)
    tasmota.cmds.clear()
    r.forward_state(nil, nil, image)
    check("devices on the network: nothing", tasmota.cmds, ["_ZbConfig"])
    tasmota.replies["_ZbConfig"] = {"ZbConfig": drawn}
    natives.zigbee = ZbDown()
    tasmota.cmds.clear()
    r.forward_state(nil, nil, image)
    check("an identity drawn already: nothing", [tasmota.cmds, r.boot_fix], [["_ZbConfig"], ""])
    r.boot_fix = nil
    r.zb_aborted = false
    r.coord_rev = 0
    r.forward_state(nil, nil, {"ZbState": {"Status": 99, "Message": "Abort"}})
    check("an abort with Sonoff's Z-Stack in the chip is not that: the flash comes first", r.zb_aborted, false)
    r.coord_rev = nil

    # the panel's channel at a first boot's identity, in the pairing: the channel, the PAN IDs and the key in one restart
    tasmota.replies["_ZbConfig"] = {"ZbConfig": zero_mac}
    natives.zigbee = ZbCoordinator(0)
    r.next_channel = 25
    tasmota.cmds.clear()
    r.apply_channel()
    check("the channel the panel chose takes the identity along",
          [string.find(tasmota.cmds[1], "_ZbConfig {\"Channel\":25,\"PanID\":\"0x") == 0, string.find(tasmota.cmds[1], "\"KeyL\":0,\"KeyH\":0}") > 0], [true, true])

    # the channel a panel chose while the coordinator was not up, its flash due: kept, and taken with the identity after it
    r.coord_due = true
    natives.zigbee = ZbDown()
    r.plan_channel(20)
    check("a panel's channel with the coordinator not up and its flash due: kept in persist", [persist.find("zb_channel_wanted"), r.next_channel], [20, nil])
    r.coord_due = false
    cmds = key_run({"ZbConfig": zero_mac}, ZbCoordinator(0), 0)
    check("after the flash: one ZbConfig with the channel, the PAN IDs and the key, and the channel kept no more",
          [string.find(cmds[1], "_ZbConfig {\"Channel\":20,\"PanID\":\"0x") == 0, string.find(cmds[1], "\"KeyL\":0,\"KeyH\":0}") > 0, persist.contains("zb_channel_wanted")],
          [true, true, false])
    persist.setmember("zb_channel_wanted", 11)
    check("a channel kept that the network is on already, with an identity drawn: nothing, and the channel kept goes",
          [key_run({"ZbConfig": drawn}, ZbCoordinator(0), 0), persist.contains("zb_channel_wanted")], [["_ZbConfig"], false])
    persist.setmember("zb_channel_wanted", 25)
    check("only the channel to take", key_run({"ZbConfig": drawn}, ZbCoordinator(0), 0), ["_ZbConfig", "_ZbConfig {\"Channel\":25}"])
    persist.setmember("zb_channel_wanted", 25)
    check("devices on the network: the channel kept is dropped", [key_run({"ZbConfig": drawn}, ZbCoordinator(2), 0), persist.contains("zb_channel_wanted")], [["_ZbConfig"], false])
    natives.zigbee = ZbDown()
    r.plan_channel(20)
    check("with no flash due, a coordinator not up keeps no channel", persist.contains("zb_channel_wanted"), false)
    natives.zigbee = ZbCoordinator(0)
    tasmota.remove_timer("zbbridge_relay_key")
    tasmota.replies.remove("_ZbConfig")
end
identity_checks()

# --- the coordinator's Z-Stack, flashed by the relay at boot ------------------------------------------------
def coord_checks()
    import path
    import sonoff_zb_pro_flasher as cc
    var hex = ZbBridgeRelay.COORD_HEX
    var sonoff = {"ZbState": {"Status": 50, "MajorRel": 2, "MinorRel": 7, "MaintRel": 20, "Revision": 0}}
    persist.remove("zb_coord_auto")
    r.coord_due = false
    r.window_until = nil
    r.pairing.joining = nil
    tasmota.remove_timer("zbbridge_relay_coord")
    persist.setmember("zb_coord_tries", 2)
    r.forward_state(nil, nil, {"ZbState": {"Status": 50, "MajorRel": 2, "MinorRel": 7, "MaintRel": 1, "Revision": 20220219}})
    check("the ZNP says the image's Z-Stack: nothing flashed, and the count of tries goes",
          [r.coord_due, tasmota.timers.contains("zbbridge_relay_coord"), persist.contains("zb_coord_tries"), r.coord_rev], [false, false, false, 20220219])
    r.forward_state(nil, nil, sonoff)
    check("Sonoff's Z-Stack and no file of ours: nothing", [r.coord_due, tasmota.timers.contains("zbbridge_relay_coord")], [false, false])
    path.present.push(hex)
    r.forward_state(nil, nil, sonoff)
    check("Sonoff's Z-Stack with the file there: the flash is due, a moment later",
          [r.coord_due, tasmota.timers.count("zbbridge_relay_coord"), tasmota.timers.delay_of("zbbridge_relay_coord")], [true, 1, ZbBridgeRelay.COORD_AFTER_MS])
    r.forward_state(nil, nil, sonoff)
    check("said again in the same boot: still one", tasmota.timers.count("zbbridge_relay_coord"), 1)
    r.window_until = tasmota.millis(100000)
    cc.calls.clear()
    tasmota.timers.fire("zbbridge_relay_coord")
    check("the pairing's window open: the flash waits for it, and nothing is counted",
          [cc.calls, tasmota.timers.contains("zbbridge_relay_coord"), persist.contains("zb_coord_tries")], [[], true, false])
    r.window_until = nil
    r.pairing.joining = "Cottage"
    tasmota.timers.fire("zbbridge_relay_coord")
    check("a join of the panel's network: the same", [cc.calls, tasmota.timers.contains("zbbridge_relay_coord")], [[], true])
    r.pairing.joining = nil
    tasmota.cmds.clear()
    tasmota.timers.fire("zbbridge_relay_coord")
    check("then the flash, as the console's: load, check and flash, the try counted first",
          [cc.calls, persist.find("zb_coord_auto"), persist.find("zb_coord_tries")], [["load " + hex, "check", "flash"], hex, 1])
    check("and the bridge restarts on it", tasmota.timers.contains("zbbridge_relay_coord_restart"), true)
    tasmota.timers.fire("zbbridge_relay_coord_restart")
    check("by Restart 1", tasmota.cmds[-1], "Restart 1")

    # the next boot still on Sonoff's: the second try
    r.coord_due = false
    r.forward_state(nil, nil, sonoff)
    cc.fail = "flash"
    cc.calls.clear()
    tasmota.timers.fire("zbbridge_relay_coord")
    check("a flash that raised inside the flasher (its check dropped): counted, and a restart for the next try",
          [cc.calls, persist.find("zb_coord_tries"), tasmota.timers.contains("zbbridge_relay_coord_restart")], [["load " + hex, "check", "flash"], 2, true])
    tasmota.remove_timer("zbbridge_relay_coord_restart")
    cc.fail = "check"
    r.coord_due = false
    r.forward_state(nil, nil, sonoff)
    cc.calls.clear()
    tasmota.timers.fire("zbbridge_relay_coord")
    check("a file the flasher refuses: nothing raised, counted, and a restart for the next try",
          [cc.calls, persist.find("zb_coord_tries"), tasmota.timers.contains("zbbridge_relay_coord_restart")], [["load " + hex, "check"], 3, true])
    tasmota.remove_timer("zbbridge_relay_coord_restart")
    cc.fail = nil
    r.coord_due = false
    r.forward_state(nil, nil, sonoff)
    check("past the tries: no more flashes, and the console is told how", [r.coord_due, tasmota.timers.contains("zbbridge_relay_coord")], [false, false])

    # the count that cannot be saved: no flash without it
    persist.remove("zb_coord_tries")
    persist.remove("zb_coord_auto")
    r.forward_state(nil, nil, sonoff)
    persist.fail_next()
    cc.calls.clear()
    tasmota.timers.fire("zbbridge_relay_coord")
    check("the count of tries not saved: nothing flashed, nothing restarted",
          [cc.calls, tasmota.timers.contains("zbbridge_relay_coord_restart")], [[], false])

    path.present.remove(path.present.find(hex))
    persist.remove("zb_coord_tries")
    persist.remove("zb_coord_auto")
    r.coord_due = false
    r.coord_rev = nil
    tasmota.remove_timer("zbbridge_relay_coord")
end
coord_checks()

# This bridge's screens, as a panel of the house shows them for its Main settings and Wireless settings
def view_checks()
    import mqtt
    import string
    var was = natives.zigbee
    natives.zigbee = ZbCoordinator(3)
    tasmota.replies["_ZbConfig"] = {"ZbConfig": {"Channel": 15, "PanID": "0x1A63"}}
    var m = r.render_for(["settings"], nil)
    check("its Main settings: its Zigbee channel and devices, its Info and the restart, in the colour of what changes much",
          [m[0], m[1], m[2], m[3]], [["settings"], "Main settings",
          [["Zigbee channel", "15", 0, 0], ["Zigbee devices", "3", 0, 0], ["Info", "", 1, 0, ["info"]], ["Restart", "", 2, 2]], false])
    tasmota.cmds.clear()
    tasmota.timers.remove("zbbridge_relay_restart")
    var t = r.render_for(["settings"], 3)
    check("the restart touched: said on the screen, and Restart 1 a moment after the answer",
          [t[2][3][1], tasmota.timers.delay_of("zbbridge_relay_restart"), tasmota.cmds.find("Restart 1")], ["Restarting", ZbBridgeRelay.RESTART_MS, nil])
    tasmota.timers.fire("zbbridge_relay_restart")
    check("by Restart 1", tasmota.cmds[-1], "Restart 1")
    check("a touch on a row that changes nothing is nothing", r.render_for(["settings"], 0), nil)
    # its Wireless settings are every node's (node_wireless.be), over its own Wi-Fi (panel_wifi.be)
    var hw = r.house
    r.house = nil
    check("with no Wi-Fi of its own, no Wireless settings", r.render_for(["wireless"], nil, nil), nil)
    tasmota.replies["StaState"] = {"StaState": {"State": "Idle", "Reason": ""}}
    tasmota.replies["SSId1"] = {"SSId1": "Cottage"}
    r.wifi = PanelWifi(nil)
    mqtt.up = true
    tasmota.wifi_ssid = "Cottage"
    var w = r.render_for(["wireless"], nil, nil)
    check("its Wireless settings: its Wi-Fi, its address, its MQTT, the house's, opened on the panel, and its web password, the panel's screen",
          [w[1], w[2]], ["Wireless settings", [["Wi-Fi", "Cottage", 1, 0, ["wifi"]], ["IP address", "192.168.2.61", 0, 0], ["MQTT", "Connected", 6, 0, ["mqttOpen"]],
                                               ["Web password", "", 3, 0, ["houseWebpw"]]]])
    tasmota.wifi_ssid = nil
    mqtt.up = false
    tasmota.replies["StaScan"] = {"StaScan": "Started"}
    tasmota.cmds.clear()
    w = r.render_for(["wifiSearch"], nil, nil)
    check("its networks, asked for: the bridge searches, by its station driver, and says so; what it finds goes 2 min after",
          [tasmota.cmds.find("StaScan") != nil, w[2][0][0], tasmota.timers.contains("zbbridge_relay_wifi_end")], [true, "Searching", true])
    r.wifi_said("scan", {"Networks": [["Cottage", -55, 3, 11, "AA:00:00:00:00:01"]]})
    w = r.render_for(["wifiSearch"], nil, nil)
    check("what it found, from where it is, its signal in dBm and in the colour of its band", w[2][0], ["Cottage", "-55 dBm, saved", 4, 11, ["Cottage", 63, ""]])
    tasmota.cmds.clear()
    w = r.render_for(["wifiSearch"], 0, {"t": "p4ssp4ss00"})
    var joined = nil
    for c: tasmota.cmds  if size(c) > 8 && c[0 .. 7] == "StaJoin "  joined = c end end
    check("the password typed on the panel: the bridge joins that network with it, and the join is the screen that follows",
          [joined != nil && string.find(joined, "p4ssp4ss00") > 0, w[0]], [true, ["wifiJoin"]])
    # its OTA: the row of its Wireless settings, its screen from the house's server, and a touch on it carried out here
    class OtaSpy
        var verbs
        def init() self.verbs = [] end
        def state() return {"server": "192.168.2.108:8099", "name": "Home Assistant", "build": "a91d8b13/319cddad", "seen": {}, "busy": "", "result": "", "stale": false} end
        def run(v, a) self.verbs.push(v) end
    end
    r.ota = OtaSpy()
    w = r.render_for(["wireless"], nil, nil)
    var ota_row = nil
    for x: w[2]  if x[0] == "OTA"  ota_row = x end end
    check("the OTA row, in its Wireless settings", ota_row, ["OTA", "a91d8b13", 1, 0, ["ota"]])
    w = r.render_for(["ota"], nil, nil)
    check("its OTA screen: the house's server, its firmware, none for it on the server", [w[1], w[2][0][0 .. 1], w[2][1][0 .. 1], w[2][2][0 .. 1]],
          ["OTA", ["Server", "Home Assistant"], ["Firmware", "a91d8b13"], ["Release", "None for it"]])
    r.render_for(["ota"], 2, nil)
    check("a touch on it: a look at the server, here", r.ota.verbs, ["look"])
    r.ota = nil
    tasmota.replies.remove("StaState")
    tasmota.replies.remove("SSId1")
    tasmota.replies.remove("StaScan")
    r.wifi = nil
    r.house = hw
    check("a screen it does not draw is nothing", r.render_for(["saver"], nil, nil), nil)
    tasmota.replies.remove("_ZbConfig")
    natives.zigbee = was
end
view_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
