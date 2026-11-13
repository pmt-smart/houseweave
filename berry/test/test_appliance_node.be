# berry/appliance_node.be, an appliance as a node of the house, over the water heater's thermostat as its device: its address, its boot, what a panel
# asks of the device and what the node says back, the page of its devices, the panels that mark it, its window, its LED and its way out.

import json
import string
import persist
import gpio
# the VM's own globals, which the node reads the image's classes from
import global as natives

var failures = 0
var checks = 0
# two values that say the same: a map's keys in any order
def same(a, b)
    if isinstance(a, map) && isinstance(b, map)
        if size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !same(a[k], b[k]) return false end
        end
        return true
    end
    if isinstance(a, list) && isinstance(b, list)
        if size(a) != size(b) return false end
        var i = 0
        while i < size(a)
            if !same(a[i], b[i]) return false end
            i += 1
        end
        return true
    end
    return str(a) == str(b)
end
def check(name, got, want)
    checks += 1
    if !same(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

var logged = []
log = def (msg, level) logged.push([msg, level]) end

# Tasmota as the device reads it: the probe in the sensors' JSON, the relay, and what a driver adds to the telemetry
class ApplianceTasmota : RelayTasmota
    var water, power, powered, appended
    def init()
        super(self).init()
        self.power = false
        self.powered = []
        self.appended = []
    end
    def read_sensors()
        var m = {"Time": "2026-11-13T10:00:00", "TempUnit": "C"}
        if self.water != nil  m["WTS01"] = {"Temperature": self.water} end
        return json.dump(m)
    end
    def get_power() return [self.power] end
    def set_power(i, on)
        self.power = on
        self.powered.push([i, on])
    end
    def response_append(s) self.appended.push(s) end
end
tasmota = ApplianceTasmota()

# the node's own address: the EUI-64 of the radio address the stub gives it, B0:B0:B0:00:00:01
var IEEE = "0xB0B0B0FFFE000001"
var DAY0 = 20000 * 86400
def at_hour(h) tasmota.utc_now = DAY0 + h * 3600 + 120 end

# a house of the panels 4 and 5 and the bridge 9, this node its number 7: the panel 4 shows the device
class FakeList
    static ROLE_DEVICE = 4
    var me
    def init() self.me = 7 end
    def is_panel(n) return n == 4 || n == 5 end
    def is_owner(n) return n == 9 || n == 7 end
    def revoked(n) return false end
    def ids(all) return [4, 5, 7, 9] end
end
class FakeState
    var marks, prime
    def init() self.marks = {4: {"u": 0, "s": {"0xB0B0B0FFFE000001": true}}} end
end
class FakeDevices
    var own
end
class FakeHouse
    var role, up, list, state, devices, sent, room, on_move, forgets, view_fn, events, link, mqtt, went, then_fn, leaving
    def init(role)
        self.role = role
        self.up = true
        self.list = FakeList()
        self.state = FakeState()
        self.devices = FakeDevices()
        self.sent = []
        self.room = 218
        self.forgets = []
        self.went = 0
    end
    def node_room(n) return self.room end
    def event_node(n, text)
        if size(text) > self.room return false end
        self.sent.push([n, json.load(text)])
        return true
    end
    def go(then)
        self.went += 1
        self.then_fn = then
        return true
    end
    def leave() end
    def server() return "192.168.2.10" end
    # the messages that went to a panel, and what they said of the device in a section
    def to(n)
        var out = []
        for x: self.sent  if x[0] == n  out.push(x[1]) end end
        return out
    end
end
class FakeCmd
    var host, sent
    def init(host) self.host = host self.sent = [] end
    def send(dest, line, answer)
        self.sent.push([dest, line])
        return 1
    end
end
# an image with none of the house's classes: the node still has its device, and drives it from the console
def bare_checks()
    persist.zero()
    tasmota.water = 50.0
    var alone = ApplianceNode.start()
    check("an image with no house layer still has its device", [alone.house, alone.meshcmd, classname(alone.device)], [nil, nil, "BoilerThermostat"])
    alone.device.history = BoilerHistory(TEST_TMP + "/bare.bin")
    alone.every_second()
    check("which says what it says to nobody, and raises nothing", [alone.told["s"]["cur"], alone.pumping], [500, true])
    alone.say_all()
    check("and has nobody to tell again", alone.told, {})
end
bare_checks()

natives.MeshCmd = FakeCmd
natives.HouseMesh = FakeHouse
natives.HouseList = FakeList

# every frame waiting behind the first goes: the node paces them FRAME_GAP_MS apart
def settle(a)
    var n = 0
    while a.pumping && n < 200
        tasmota.timers.fire("appliance_frames")
        n += 1
    end
end
# what the device said in a section, of the messages that went to the panel `n`, the fields of the later ones over the earlier
def section(h, n, name)
    var out = {}
    for m: h.to(n)
        var d = m.find("ZbDriver")
        var s = d != nil && d.contains(IEEE) ? d[IEEE].find(name) : nil
        if isinstance(s, map)
            for k: s.keys()  out[k] = s[k] end
        end
    end
    return out
end

# a node started as its autoexec.be starts it, its history in the test's own directory
def boot(water)
    persist.zero()
    tasmota.water = water
    tasmota.power = false
    tasmota.powered = []
    tasmota.cmds.clear()
    tasmota.timers.clear()
    tasmota.rule_lists = {}
    tasmota.rules = {}
    tasmota.replies["SSId"] = {"SSId1": "Cottage-2G", "SSId2": ""}
    logged.clear()
    var a = ApplianceNode.start()
    a.device.history = BoilerHistory(TEST_TMP + "/history.bin")
    return a
end

def address_checks()
    check("the device's address is the EUI-64 of the node's radio address, as a panel writes one",
          [ApplianceNode.eui64("A0:B7:65:5D:02:E9"), ApplianceNode.eui64("a0:b7:65:5d:02:e9"), ApplianceNode.eui64(""), ApplianceNode.eui64("A0:B7")],
          ["0xA0B765FFFE5D02E9", "0xA0B765FFFE5D02E9", "0x0000000000000000", "0x0000000000000000"])
    check("an address in any case is the one address", [ApplianceNode.norm("0xb0b0b0fffe000001"), ApplianceNode.norm("0XB0B0B0FFFE000001"), ApplianceNode.norm(nil)],
          [IEEE, IEEE, "NIL"])
end
address_checks()

def boot_checks()
    at_hour(12)
    var a = boot(50.0)
    var h = a.house
    check("at its boot: its device, its address, and the node kept for the console", [classname(a.device), a.ieee, natives.appliance_node == a], ["BoilerThermostat", IEEE, true])
    check("the house's layer under an appliance's role, the mesh's commands its own to run", [h.role, a.meshcmd.host == a], [4, true])
    check("a panel that marks the device and the page of its devices are answered by it", [h.state.prime != nil, h.devices.own != nil], [true, true])
    check("the console drives the device too", tasmota.handlers.contains("ZbRelayDrive"), true)
    check("the button: the hold opens the window, and the short press is taken and does nothing",
          [tasmota.rule_lists["Button1#State=3"][0][0], tasmota.rule_lists["Button1#State=2"][0][0], tasmota.rules["Button1#State=2"](2, nil, nil)],
          ["appliance_button", "appliance_button", nil])
    check("its clock, and everything said again once it is in step", [tasmota.rule_lists["Time#Set"][0][0], tasmota.timers.contains("appliance_time_ask"),
          tasmota.timers.delay_of("appliance_again")], ["appliance_time", true, NodeHost.AGAIN_MS])
    check("said in the log", logged[-1], ["APPLIANCE: a Boiler, " + IEEE + ", for the panels of the house over the mesh", 2])
    check("what NodeHost asks of a node: no Zigbee channel and the kind of a device in its announcement, nothing of its own at the window's end or in a guest's word",
          [a.announce(), a.window_closed(), a.guest_said({"zigbee": 20}), a.listen("1", 4), ApplianceNode.LED, ApplianceNode.ROLE], ["0,2", nil, nil, true, 1, "device"])
    # the page of its devices: the one device, with what it is
    var o = h.devices.own()
    check("the page of its devices is the one device it is, with its model, no name yet, and what a panel classifies it by",
          [o[0], o[1], o[2], o[3]], [IEEE, "THR320D", "", {"kind": "thermostat", "caps": 48, "min": 300, "max": 700, "ep": 1}])
    var item = json.dump({"i": o[0], "m": o[1], "n": "A name as long as a panel lets one be", "d": o[3]})
    check("and its item, with a long name, fits a frame of the mesh to one node behind its head of 4 bytes", size(item) <= 216, true)
end
boot_checks()

def drive_checks()
    at_hour(18)
    var a = boot(50.0)
    var h = a.house
    a.every_second()
    settle(a)
    h.sent.clear()
    # a read: the whole state, to the panel that shows the device
    a.run("ZbRelayDrive {\"id\":\"" + IEEE + "\",\"do\":\"read\"}", "mesh", 4)
    settle(a)
    check("a read is answered with the whole state", section(h, 4, "s"), {"cur": 500, "set": 600, "mode": "off", "dem": 0, "up": true, "note": ""})
    check("to the panels that hear the node, and no other", [size(h.to(4)) > 0, size(h.to(5))], [true, 0])
    h.sent.clear()
    a.every_second()
    settle(a)
    check("a second with nothing changed says nothing", h.sent, [])
    a.run("ZbRelayDrive {\"id\":\"0xb0b0b0fffe000001\",\"do\":\"mode\",\"v\":\"heat\"}", "mesh", 5)
    settle(a)
    check("a command is taken in any case of the address, acts at once, and its answer goes whole",
          [tasmota.power, section(h, 4, "s"), a.heard_from.contains(5)], [true, {"cur": 500, "set": 600, "mode": "heat", "dem": 100, "up": true, "note": ""}, true])
    check("the panel that commanded hears it too", section(h, 5, "s")["mode"], "heat")
    h.sent.clear()
    a.run("ZbRelayDrive {\"id\":\"" + IEEE + "\",\"do\":\"target\",\"v\":550}", "mesh", 4)
    settle(a)
    check("a target: the state and the settings' values after it", [section(h, 4, "s")["set"], section(h, 4, "v")["w1t"]], [550, 55])
    h.sent.clear()
    a.run("ZbRelayDrive {\"id\":\"" + IEEE + "\",\"do\":\"target\",\"v\":999}", "mesh", 4)
    settle(a)
    check("a command the device does not take is said refused", h.to(4), [{"ZbDriver": {IEEE: {"e": "refused"}}}])
    h.sent.clear()
    a.run("ZbRelayDrive {\"id\":\"0x00124B0000B00001\",\"do\":\"read\"}", "mesh", 4)
    settle(a)
    check("a command for a device that is not this node's finds no driver", h.to(4), [{"ZbDriver": {"0x00124B0000B00001": {"e": "nodriver"}}}])
    h.sent.clear()
    check("what is no command is nothing", [a.drive("not json"), a.drive("{\"do\":\"read\"}"), a.drive("{\"id\":\"" + IEEE + "\"}"), h.sent], [false, false, false, []])
    tasmota.answers.clear()
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, "{\"id\":\"" + IEEE + "\",\"do\":\"mode\",\"v\":\"off\"}")
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, "{\"id\":\"" + IEEE + "\",\"do\":\"dance\"}")
    settle(a)
    check("the console's command says how it went", [tasmota.answers, tasmota.power], [["done", "failed"], false])
    # the other words
    h.sent.clear()
    a.run("ZbPing " + IEEE, "mesh", 4)
    a.run("ZbPing 0x00124B0000B00001", "mesh", 4)
    settle(a)
    check("a ping of the device is answered, and one of another is not", h.to(4), [{"ZbPing": {"Device": IEEE, "IEEEAddr": IEEE}}])
    a.run("ZbRelayName {\"IEEE\":\"" + IEEE + "\",\"Name\":\"Boiler\"}", "mesh", 4)
    a.run("ZbRelayName {\"IEEE\":\"0x00124B0000B00001\",\"Name\":\"Lamp\"}", "mesh", 4)
    check("the name a panel gave the device is kept, for the page of its devices", [a.name, persist.find("appliance_name"), h.devices.own()[2]], ["Boiler", "Boiler", "Boiler"])
    gpio.levels[13] = 1
    var before = tasmota.timers.size()
    a.run("ZbSend {\"Device\":\"" + IEEE + "\",\"Send\":{\"Identify\":3}}", "mesh", 4)
    check("an Identify blinks its LED", tasmota.timers.size() - before, 2 * ApplianceNode.IDENTIFY_BLINKS)
    a.run("ZbSend {\"Device\":\"" + IEEE + "\",\"Send\":{\"Power\":1}}", "mesh", 4)
    check("and no other word of a Zigbee device does anything", [tasmota.timers.size() - before, tasmota.power], [2 * ApplianceNode.IDENTIFY_BLINKS, false])
    logged.clear()
    a.run("ZbLeave " + IEEE, "mesh", 4)
    a.run("Restart 1", "mesh", 4)
    check("a word that is no command of a panel to an appliance is refused, and said at level 1",
          [logged, tasmota.cmds.find("Restart 1")], [[["APPLIANCE: refused from the mesh, not a command a panel sends an appliance: ZBLEAVE", 1],
          ["APPLIANCE: refused from the mesh, not a command a panel sends an appliance: RESTART", 1]], nil])
    a.heard_from = {}
    a.run("ZbRelayListen 1", "mesh", 5)
    check("the words every node takes are the node's", a.heard_from.contains(5), true)
end
drive_checks()

def say_checks()
    at_hour(18)
    var a = boot(50.0)
    var h = a.house
    a.every_second()
    settle(a)
    h.sent.clear()
    a.say("s", {"cur": 500, "set": 600})
    check("what the panels were told is not said again", h.sent, [])
    a.say("s", {"cur": 510, "set": 600})
    check("only the fields that changed go", h.to(4), [{"ZbDriver": {IEEE: {"s": {"cur": 510}}}}])
    settle(a)
    # more than a frame carries: cut by field, and paced
    h.sent.clear()
    h.room = 90
    a.told = {}
    a.say("s", a.device.state())
    check("the first message goes at once, and the rest wait their turn", [size(h.sent), a.pumping, tasmota.timers.delay_of("appliance_frames")], [1, true, ApplianceNode.FRAME_GAP_MS])
    settle(a)
    var whole = true
    for m: h.to(4)  if size(json.dump(m)) > 90  whole = false end end
    check("each within the room of a frame, and the fields all there", [size(h.sent) > 1, whole, section(h, 4, "s")],
          [true, true, {"cur": 500, "set": 600, "mode": "off", "dem": 0, "up": true, "note": ""}])
    # the settings: the schema in numbered frames, and the values
    h.sent.clear()
    h.room = 218
    a.run("ZbRelayDrive {\"id\":\"" + IEEE + "\",\"do\":\"settings\"}", "mesh", 4)
    settle(a)
    var got = []
    var of = nil
    var fits = true
    for m: h.to(4)
        if size(json.dump(m)) > 218  fits = false end
        var x = m["ZbDriver"][IEEE].find("x")
        if x == nil continue end
        check("a frame of the schema starts where the one before ended", x["at"], size(got))
        of = x["of"]
        for e: x["l"]  got.push(e) end
    end
    check("the settings' schema comes whole, in frames a panel puts together", [of, size(got), got[0]["k"], got[-1]["k"], fits], [16, 16, "w1s", "nht", true])
    check("and the values with it", section(h, 4, "v"), {"w1s": 17, "w1e": 21, "w1t": 60, "w2s": 5, "w2e": 7, "w2t": 50, "lmin": 30, "lmax": 70, "hyst": 3, "ceil": 75,
                                                           "calib": 0, "power": 3000, "chks": 0, "chke": 5, "chkd": 1, "nht": 120})
    # a queue that grows with nobody to take it does not grow for ever
    a.outbox = []
    a.pumping = true
    var i = 0
    while i < ApplianceNode.OUT_MAX + 5
        a.emit({"n": i})
        i += 1
    end
    check("no more than OUT_MAX messages wait, the oldest dropped", [size(a.outbox), a.outbox[0]["n"]], [ApplianceNode.OUT_MAX, 5])
    a.outbox = []
    a.pumping = false
end
say_checks()

def mark_checks()
    at_hour(18)
    var a = boot(50.0)
    var h = a.house
    a.every_second()
    settle(a)
    a.heard_from[5] = tasmota.millis()
    h.sent.clear()
    tasmota.at_ms = 100000
    check("a panel marks the device: there is nothing to wait for", h.state.prime(IEEE), true)
    var said = h.to(4)
    check("the panel that shows it is told what it is, and its whole state, in two messages",
          [size(said), said[0]["ZbDriver"][IEEE]["d"], said[1]["ZbDriver"][IEEE]["s"]],
          [2, {"caps": 48, "min": 300, "max": 700, "step": 10, "modes": ["off", "heat"], "floor": false, "ep": 1, "measure": "Water", "kind": "thermostat", "drv": "boiler",
               "model": "THR320D"}, {"cur": 500, "set": 600, "mode": "off", "dem": 0, "up": true, "note": ""}])
    check("the description fits a frame of the mesh", size(json.dump(said[0])) <= 218, true)
    check("a panel that commanded the node and does not show the device is not told what it is", h.to(5), [])
    h.sent.clear()
    tasmota.at_ms = 100000 + ApplianceNode.TELL_GAP_MS - 1
    h.state.prime(IEEE)
    check("marked again within a moment, it is not told twice", h.sent, [])
    tasmota.at_ms = 100000 + ApplianceNode.TELL_GAP_MS
    h.state.marks[5] = {"u": 0, "s": {IEEE: true}}
    h.state.prime(IEEE)
    check("a second panel that shows it: both are told, each alone", [size(h.to(4)), size(h.to(5))], [2, 2])
    h.sent.clear()
    # the highest the range a description says: the description a panel was sent last, or nil for none
    var range_told = def (n)
        var top = nil
        for m: h.to(n)
            var z = m.find("ZbDriver")
            var d = z != nil && z.contains(IEEE) ? z[IEEE].find("d") : nil
            if d != nil  top = d["max"] end
        end
        return top
    end
    check("a limit of the target set from a panel: the panels that show the device hear what it is again, with its new range",
          [a.drive(json.dump({"id": IEEE, "do": "setting", "k": "lmax", "v": 65})), range_told(4), range_told(5), a.brief()["max"]], [true, 650, 650, 650])
    settle(a)
    h.sent.clear()
    check("and a setting that is no limit describes nothing again", [a.drive(json.dump({"id": IEEE, "do": "setting", "k": "hyst", "v": 4})), range_told(4)], [true, nil])
    settle(a)
    h.sent.clear()
    tasmota.at_ms += ApplianceNode.TELL_GAP_MS
    check("the mark of a device that is not this node's says nothing", [h.state.prime("0x00124B0000B00001"), h.sent], [true, []])
    h.state.marks[9] = {"u": 0, "s": {IEEE: true}}
    a.say_all()
    # what the device is and its state, two messages, and its two warnings as they stand, one each
    check("after a boot, in step: everything again to the panels that show it, and to no node that is no panel", [size(h.to(4)), size(h.to(5)), size(h.to(9))], [4, 4, 0])
    h.sent.clear()
    h.up = false
    a.say_all()
    check("and nothing while the house is not up", h.sent, [])
    h.up = true
    tasmota.at_ms = nil
    # the boot's own wait
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 7}
    natives.espnow_mesh_stamp = / -> bytes("010200000001")
    h.sent.clear()
    NodeHost.again_after_boot(a, NodeHost.AGAIN_TRIES)
    check("which is what the boot does once the node is in its house and in step", size(h.to(4)), 4)
    tasmota.replies.remove("_EspNowMeshId")
end
mark_checks()

# A warning of the device's goes to every panel of the house, each alone, whether it shows the device or not: as it comes, as it goes, and all
# of them again after a boot and every so often
def warning_checks()
    at_hour(12)
    var a = boot(50.0)
    var h = a.house
    a.every_second()
    settle(a)
    h.sent.clear()
    a.device.alert("stuck", true)
    var w = {"ZbDriver": {IEEE: {"w": {"k": "stuck", "on": true, "n": "Boiler"}}}}
    check("a warning comes: every panel of the house hears it, the one that shows the device and the one that does not, and no other node",
          [h.to(4), h.to(5), h.to(7), h.to(9)], [[w], [w], [], []])
    check("in a frame of the mesh", size(json.dump(w)) <= 218, true)
    h.sent.clear()
    a.run("ZbRelayName " + json.dump({"IEEE": IEEE, "Name": "Water heater"}), "mesh", 4)
    a.device.alert("stuck", false)
    check("and when it goes, by the name the house gave the device", h.to(5), [{"ZbDriver": {IEEE: {"w": {"k": "stuck", "on": false, "n": "Water heater"}}}}])
    h.sent.clear()
    a.device.alert("noheat", true)
    h.sent.clear()
    var i = 0
    while i < ApplianceNode.WARN_AGAIN_S - 2
        a.every_second()
        i += 1
    end
    settle(a)
    var told = def (n)
        var out = {}
        for m: h.to(n)
            var z = m.find("ZbDriver")
            var s = z != nil && z.contains(IEEE) ? z[IEEE].find("w") : nil
            if s != nil  out[s["k"]] = s["on"] end
        end
        return out
    end
    check("nothing is said again before its time", told(5), {})
    a.every_second()
    a.every_second()
    settle(a)
    check("every half hour, all of them as they stand, held or not: a panel that restarted has lost its list, and one that was off has one open",
          [told(4), told(5)], [{"stuck": false, "noheat": true}, {"stuck": false, "noheat": true}])
    h.sent.clear()
    h.up = false
    a.device.alert("noheat", false)
    check("and nothing while the house is not up", h.sent, [])
    h.up = true
end
warning_checks()

def window_checks()
    at_hour(12)
    var a = boot(50.0)
    tasmota.cmds.clear()
    tasmota.replies["EspNowPairOpen 120,0,2"] = {"EspNowPairOpen": "Open"}
    gpio.levels[13] = 1
    tasmota.rules["Button1#State=3"](3, nil, nil)
    check("the button held opens the window, announced as a device of the house with no Zigbee channel", [tasmota.cmds[0], NodeHost.window_open(a), a.by_button], ["EspNowPairOpen 120,0,2", true, true])
    check("and blinks the appliance's second LED", [a.blink_pin, gpio.levels[13], tasmota.timers.contains("appliance_blink")], [13, 0, true])
    # the device's own signal waits for the window
    tasmota.utc_now = 0
    a.every_second()
    check("with the window open, the device's signal leaves the LED to it", [a.device.signal(), a.led_rest, gpio.levels[13]], [true, nil, 0])
    tasmota.rules["EspNowPair#Window"](nil, nil, nil)
    check("the driver says the window closed: the LED as it was", [NodeHost.window_open(a), gpio.levels[13], tasmota.timers.contains("appliance_blink")], [false, 1, false])
    # with no clock, the LED blinks slowly
    a.every_second()
    check("with no clock the LED is lit a second", [a.led_rest, gpio.levels[13]], [1, 0])
    a.every_second()
    check("and dark a second", gpio.levels[13], 1)
    a.every_second()
    at_hour(12)
    a.every_second()
    check("the clock comes: the LED as it was, and left alone", [gpio.levels[13], a.led_rest], [1, nil])
    gpio.levels[13] = 0
    a.every_second()
    check("after that the LED is nobody's", gpio.levels[13], 0)
    gpio.levels[13] = 1
    tasmota.replies.remove("EspNowPairOpen 120,0,2")
end
window_checks()

def restart_checks()
    at_hour(18)
    var a = boot(40.0)
    var h = a.house
    a.device.cfg["mode"] = "heat"
    a.every_second()
    check("heating", tasmota.power, true)
    a.json_append()
    check("Tasmota's telemetry has the device", tasmota.appended[-1], ",\"Boiler\":{\"Mode\":\"heat\",\"Target\":60,\"Heating\":1,\"NoClock\":0,\"Alert\":\"\"}")
    check("its rows of the Main settings are the device's, with the node's Info and Restart after them",
          a.render_for(["settings"], nil, nil)[2], [["Water", "40.0°", 0, 0], ["Heater", "On", 0, 0], ["Info", "", 1, 0, ["info"]], ["Restart", "", 2, 2]])
    a.save_before_restart()
    check("Tasmota is about to restart: the heater off, and it stays off", [tasmota.power, a.device.stopped], [false, true])
    a.every_second()
    check("through the seconds left", tasmota.power, false)
    # a device that raises takes nothing else with it
    class Broken
        def tick() raise "value_error", "broken" end
        def signal() return false end
    end
    var was = a.device
    a.device = Broken()
    logged.clear()
    a.every_second()
    check("a device whose second raises is said in the log, and the node goes on", logged[0], ["APPLIANCE: the device's second failed - value_error: broken", 2])
    a.device = was
    # back to its image
    a = boot(40.0)
    h = a.house
    a.device.cfg["mode"] = "heat"
    a.every_second()
    persist.setmember("appliance_name", "Boiler")
    tasmota.cmds.clear()
    a.run("ZbRelayAdmin {\"do\":\"factory\",\"n\":\"3\"}", "mesh", 4)
    tasmota.timers.fire("appliance_wipe")
    check("a factory reset from a panel: the heater off first, and the node out of the house", [tasmota.power, a.device.stopped, h.went, tasmota.cmds], [false, true, 1, []])
    h.then_fn()
    check("then nothing kept, the pairing's record cleared, and Tasmota's reset",
          [persist.find("appliance_name"), persist.find("boiler"), tasmota.cmds], [nil, nil, ["EspNowEnable 0", "EspNowPeerMac 00:00:00:00:00:00", "EspNowSecret2 0", "Reset 1"]])
end
restart_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
