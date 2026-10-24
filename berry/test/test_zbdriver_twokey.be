# berry/zbdriver_twokey.be, the bridge's driver of a switch of two channels that opens and closes, in the host
# and the relay it runs in: nothing of it until the panel assigns it, the configuration kept, the description, both channels
# written to come back off, the raw state no longer the panel's; a motor that runs one channel for its travel, reckons its
# place by the time, stops before it goes the other way, and turns both off when both are on; its settings; a gate's pulse,
# its door sensor, and no state without one; and the device given back. Each part is a function: a script's top level holds
# 256 constants at most.

import global as natives
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

def same(a, b)
    if isinstance(a, map)
        if !isinstance(b, map) || size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !same(a[k], b[k]) return false end
        end
        return true
    end
    if isinstance(a, list)
        if !isinstance(b, list) || size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if !same(a[i], b[i]) return false end
        end
        return true
    end
    return a == b
end
def check_same(name, got, want)
    checks += 1
    if !same(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

def le_bytes(ieee)
    var h = ieee[2 ..]
    var s = ""
    var i = size(h) - 2
    while i >= 0
        s += h[i .. i + 1]
        i -= 2
    end
    return bytes(s)
end

class FakeZ
    var longaddr, shortaddr, name, model, manufacturer
    def init(ieee, short, manufacturer, model)
        self.longaddr = le_bytes(ieee)
        self.shortaddr = short
        self.manufacturer = manufacturer
        self.model = model
        self.name = ""
    end
end

class FakeNet
    var devices, up
    def init() self.devices = [] self.up = true end
    def started() return self.up end
    def iter() return self.devices.iter() end
    def size() return size(self.devices) end
    def find(key)
        var k = string.toupper(str(key))
        for z: self.devices
            var ieee = "0X"
            var i = size(z.longaddr) - 1
            while i >= 0
                ieee += string.format("%02X", z.longaddr[i])
                i -= 1
            end
            if k == string.format("0X%04X", z.shortaddr) || k == ieee return z end
        end
        return nil
    end
end

var SW = "0x00124B0000D10001"     # a Tuya TS0002, two channels
var DOOR = "0x00124B0000D10002"   # a door sensor on the gate

var net = FakeNet()
natives.zigbee = net
net.devices.push(FakeZ(SW, 0x1201, "_TZ3000_sim2ch", "TS0002"))
net.devices.push(FakeZ(DOOR, 0x1301, "_TZ3000_door", "TS0203"))

var told = []
natives.espnow_send = def (msg, as_event) told.push(json.load(msg)) return true end
natives.ZbBridgeDrivers = ZbBridgeDrivers
natives.ZbDriverTwoKey = ZbDriverTwoKey
var r = ZbBridgeRelay.start()
# what it says to the panels, over the mesh
listen_to(r, told)
var host = r.drivers
var drv = nil
for d: host.drivers
    if d.ID == "twokey" drv = d end
end

# the discovery of the relay (zbbridge_discovery.be), as far as the host speaks to it: it is told when a device is described again, or given back
class FakeDiscovery
    var calls, fail
    def init() self.calls = [] self.fail = false end
    def refresh(ieee)
        self.calls.push(ieee)
        if self.fail  raise "test_error", "the discovery fell over" end
    end
end
var fd = FakeDiscovery()
r.discovery = fd

def next_frame()
    return tasmota.timers.fire("zbbridge_drivers_frames")
end
def settle()
    var n = 0
    while n < 100 && next_frame() n += 1 end
end
def fire_send()
    tasmota.timers.fire("zbbridge_drivers_send")
    settle()
end
def fire(id)
    var ran = tasmota.timers.fire(id)
    fire_send()
    return ran
end
def collect(ieee, sec)
    var out = {}
    for ev: told
        var z = ev.find("ZbDriver")
        var d = z != nil ? z.find(ieee) : nil
        var m = d != nil ? d.find(sec) : nil
        if isinstance(m, map)
            for k: m.keys() out[k] = m[k] end
        end
    end
    return out
end
# what the last event about the device said of its state
def last_s(ieee)
    var i = size(told) - 1
    while i >= 0
        var z = told[i].find("ZbDriver")
        var d = z != nil ? z.find(ieee) : nil
        if d != nil && d.contains("s") return d["s"] end
        i -= 1
    end
    return nil
end
def zb_sends()
    var out = []
    for c: tasmota.cmds
        if string.find(c, "ZbSend ") == 0 out.push(json.load(c[7 ..])) end
    end
    return out
end
def drive(body)
    body["id"] = SW
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, json.dump(body))
    fire_send()
end
def report(short, attrs)
    attrs["Device"] = string.format("0x%04X", short)
    host.on_received({string.format("0x%04X", short): attrs})
    fire_send()
end
# the channels' on and off sent since, [endpoint, power] each
def powers()
    var out = []
    for b: zb_sends()
        var s = b.find("Send")
        if s != nil && s.contains("Power") out.push([b["Endpoint"], s["Power"]]) end
    end
    return out
end
var TIMER = "zbdriver_twokey_" + SW

def unassigned_checks()
    check("the driver is in the host", drv != nil, true)
    host.on_received({"0x1201": {"Device": "0x1201", "Power": 1, "Endpoint": 1}})
    check("a switch of two is nobody's by itself: no driver claims it", host.claimed.contains(SW), false)
    r.pending = nil
    r.forward(nil, nil, {"ZbReceived": {"0x1201": {"Device": "0x1201", "Power": 1, "Endpoint": 1}}})
    check("and its raw state goes to the panel as a switch's", r.pending["0x1201"].find("Power"), 1)
end

# the alarm of the relay, as far as a driver sees it: what it is told of the commands the bridge sends
class FakeAlarm
    var told
    def init() self.told = [] end
    def commanded(line) self.told.push(line) end
end

def assign_checks()
    tasmota.cmds.clear()
    tasmota.answers.clear()
    var alarm = FakeAlarm()
    r.alarm = alarm
    drive({"do": "assign", "v": {"drv": "twokey", "app": "window", "mode": "motor", "open": 10, "close": 12}})
    r.alarm = nil
    var lines = []
    for c: tasmota.cmds
        if string.find(c, "ZbSend ") == 0  lines.push(c) end
    end
    check("the driver's commands are told to the alarm first, whole and in order: the echo of a command is not a hand on the device", [size(lines) > 0, alarm.told], [true, lines])
    check("assigned: done, and the device is the driver's", [tasmota.answers, host.claimed.find(SW) == drv], [["done"], true])
    check_same("its configuration in the flash", persist.find("zb_relay_assigned")[SW], {"drv": "twokey", "app": "window", "mode": "motor", "open": 10, "close": 12})
    check_same("described as a blind that is a window, by a motor", collect(SW, "d"),
               {"caps": 64, "ep": 1, "app": "window", "mode": "motor", "sensor": "", "kind": "cover", "drv": "twokey", "model": "TS0002"})
    var writes = []
    for b: zb_sends()
        if b.contains("Write") writes.push([b["Endpoint"], b["Write"]]) end
    end
    check_same("both channels written to come back off after a power cut", writes, [[1, {"StartUpOnOff": 0}], [2, {"StartUpOnOff": 0}]])
    r.pending = nil
    r.forward(nil, nil, {"ZbReceived": {"0x1201": {"Device": "0x1201", "Power": 1, "Endpoint": 1}}})
    check("its raw on and off are the driver's now, not sent to the panel", r.pending == nil || !r.pending.contains("0x1201"), true)
end

def motor_checks()
    tasmota.cmds.clear()
    tasmota.at_ms = 0
    drive({"do": "open"})
    check_same("open: the close channel off, the open one on", powers(), [[2, 0], [1, 1]])
    check("moving up, its place not known yet", [last_s(SW).find("mov"), last_s(SW).find("pos")], ["up", nil])
    tasmota.cmds.clear()
    fire(TIMER)
    check_same("at its end: both off, and open", [powers(), last_s(SW)], [[[1, 0], [2, 0]], {"pos": 100, "mov": "stop"}])
    tasmota.cmds.clear()
    tasmota.at_ms = 100000
    drive({"do": "goto", "v": 30})
    check_same("to 30: down", powers(), [[1, 0], [2, 1]])
    tasmota.at_ms = 100000 + 4200
    fire("zbdriver_twokey_step_" + SW)
    check("its place as it runs, by the time: 12 s down, 4.2 of them", last_s(SW).find("pos"), 65)
    tasmota.cmds.clear()
    fire(TIMER)
    check_same("there: both off, at 30", [powers(), last_s(SW)], [[[1, 0], [2, 0]], {"pos": 30, "mov": "stop"}])
    # the other way while it runs: a stop, the pause, and then up
    tasmota.at_ms = 200000
    drive({"do": "close"})
    tasmota.cmds.clear()
    tasmota.at_ms = 200000 + 1200
    drive({"do": "open"})
    check_same("sent up while going down: both off first, and nothing on yet", powers(), [[1, 0], [2, 0]])
    check("it stopped where it was", last_s(SW).find("pos"), 20)
    tasmota.cmds.clear()
    fire(TIMER)
    check_same("after the pause, up", powers(), [[2, 0], [1, 1]])
    # a key on the module against the motor: both off
    tasmota.cmds.clear()
    report(0x1201, {"Endpoint": 1, "Power": 1})
    report(0x1201, {"Endpoint": 2, "Power": 1})
    check_same("both channels on: both off", powers(), [[1, 0], [2, 0]])
end

# Tasmota stacks the timers of one id (a stub that replaced them would show none of this), and remove_timer takes
# every one out. A move sent while another of the same way runs would leave the timer of the first, which would stop the
# motor early and say the place the SECOND one was sent to: every move takes the timer of the one before
# out, so one timer of the id is pending, and it is the last move's.
def stacked_motor_checks()
    tasmota.cmds.clear()
    tasmota.at_ms = 400000
    drive({"do": "open"})
    fire(TIMER)
    check_same("a motor open, at 100", last_s(SW), {"pos": 100, "mov": "stop"})
    # the slider let go at 50, and a second later at 20: both ways down, 12 s all the way
    tasmota.at_ms = 500000
    drive({"do": "goto", "v": 50})
    check("the first move: one timer to its place, at 6 s", [tasmota.timers.count(TIMER), tasmota.timers.delay_of(TIMER)], [1, 6000])
    tasmota.at_ms = 501000
    drive({"do": "goto", "v": 20})
    # it was at 92 after 1 s, and 20 is 72 of the 12 s: 8.64 s from now
    check("the second move cancels the first one's timer: one of the id, to the second's place", [tasmota.timers.count(TIMER), tasmota.timers.delay_of(TIMER)], [1, 8640])
    check("and one timer of the steps, not a loop of them for each move", tasmota.timers.count("zbdriver_twokey_step_" + SW), 1)
    # the first would have been due at 506000, 5 s into its 6, with the motor at about 51: it is still running
    tasmota.cmds.clear()
    tasmota.at_ms = 506000
    tasmota.timers.run_due()
    check_same("5 s into the first move's time: the motor runs on, and nothing stopped it at 51", powers(), [])
    check("it is at 51, on its way to 20", drv.where(SW), 51)
    tasmota.at_ms = 509640
    fire(TIMER)
    check_same("at its place: both off, and the glass is told 20, where it was sent", [powers(), last_s(SW)], [[[1, 0], [2, 0]], {"pos": 20, "mov": "stop"}])
    check("nothing is left of the id", [tasmota.timers.count(TIMER), tasmota.timers.count("zbdriver_twokey_step_" + SW)], [0, 0])
    # sent the same way again to the end, while it runs to a place: the motor goes all the way, and says 100, where it ran to
    tasmota.cmds.clear()
    tasmota.at_ms = 600000
    drive({"do": "goto", "v": 0})
    fire(TIMER)
    tasmota.at_ms = 700000
    drive({"do": "goto", "v": 50})
    check("0 to 50 of 10 s all the way: 5 s", tasmota.timers.delay_of(TIMER), 5000)
    tasmota.at_ms = 701000
    drive({"do": "open"})
    check("open, the same way, a second later: its own timer, the 10 s less the 10% it ran, and the 2 s past the end", [tasmota.timers.count(TIMER), tasmota.timers.delay_of(TIMER)], [1, 11000])
    tasmota.cmds.clear()
    tasmota.at_ms = 705500
    tasmota.timers.run_due()
    check_same("past the 5 s of the first: the motor is not stopped at 50", powers(), [])
    tasmota.at_ms = 712000
    fire(TIMER)
    check_same("and it ends at 100, where it ran to, and says so", [powers(), last_s(SW)], [[[1, 0], [2, 0]], {"pos": 100, "mov": "stop"}])
end

# The pause between two ways is a timer of the same id too. A word given in it runs when the pause ends, and the last word
# wins, and the pause's timer is not left beside the arrival of the way asked last, which would run the way before it
# against the motor
def stacked_reversal_checks()
    tasmota.cmds.clear()
    tasmota.at_ms = 800000
    drive({"do": "goto", "v": 20})
    fire(TIMER)
    tasmota.at_ms = 900000
    drive({"do": "close"})
    tasmota.at_ms = 901000
    drive({"do": "open"})
    check_same("open sent while it goes down: both off, and the pause is a timer of the id", [powers()[-2 ..], tasmota.timers.count(TIMER)], [[[1, 0], [2, 0]], 1])
    # the last word is close: nothing runs in the pause, which is not cut short, and what runs when it ends is the close
    tasmota.cmds.clear()
    tasmota.at_ms = 901200
    drive({"do": "close"})
    check_same("close, in the pause: nothing sent yet, and the pause is the one timer", [powers(), tasmota.timers.count(TIMER), tasmota.timers.delay_of(TIMER)], [[], 1, 300])
    check_same("the glass says it stands where it was left", last_s(SW), {"pos": 12, "mov": "stop"})
    tasmota.at_ms = 901500
    fire(TIMER)
    check_same("the pause ends: the close runs, down, the opposite channel off first", powers(), [[1, 0], [2, 1]])
    check("with its arrival timer the only one of the id", [tasmota.timers.count(TIMER), tasmota.timers.delay_of(TIMER)], [1, 3440])
    check("and it is shown going down", last_s(SW).find("mov"), "down")
    tasmota.cmds.clear()
    tasmota.at_ms = 901500 + 3440
    fire(TIMER)
    check_same("it runs to its end: both off, and closed", [powers(), last_s(SW)], [[[1, 0], [2, 0]], {"pos": 0, "mov": "stop"}])
    # three words in a row against a motor going up: the last is the one that runs
    tasmota.at_ms = 1000000
    drive({"do": "open"})
    tasmota.at_ms = 1001000
    drive({"do": "close"})
    tasmota.at_ms = 1001100
    drive({"do": "open"})
    tasmota.at_ms = 1001200
    drive({"do": "close"})
    check("up, close, open, close: one timer, the pause's", tasmota.timers.count(TIMER), 1)
    tasmota.cmds.clear()
    tasmota.at_ms = 1001500
    fire(TIMER)
    check_same("when the pause ends it goes down, the last word", [powers(), last_s(SW).find("mov")], [[[1, 0], [2, 1]], "down"])
    tasmota.timers.fire(TIMER)
    # a stop in the pause takes the word with it
    tasmota.at_ms = 1100000
    drive({"do": "open"})
    tasmota.at_ms = 1101000
    drive({"do": "close"})
    tasmota.cmds.clear()
    drive({"do": "stop"})
    check_same("a stop in the pause: both off, the pause's timer gone, and nothing is left to run", [powers(), tasmota.timers.count(TIMER), last_s(SW).find("mov")], [[[1, 0], [2, 0]], 0, "stop"])
    # sent to where it stands, in the pause: that is a stop too
    tasmota.at_ms = 1200000
    drive({"do": "goto", "v": 0})
    fire(TIMER)
    drive({"do": "goto", "v": 60})
    tasmota.at_ms = 1203000
    drive({"do": "goto", "v": 0})
    var at = drv.where(SW)
    tasmota.cmds.clear()
    drive({"do": "goto", "v": at})
    check_same("sent to the place it stands at, in the pause: a stop", [at, powers(), tasmota.timers.count(TIMER), last_s(SW).find("mov")], [30, [[1, 0], [2, 0]], 0, "stop"])
    # and while it goes: a motor sent to where it is on its way stops there
    tasmota.at_ms = 1300000
    drive({"do": "goto", "v": 60})
    tasmota.at_ms = 1301000
    at = drv.where(SW)
    tasmota.cmds.clear()
    drive({"do": "goto", "v": at})
    check_same("sent to the place it is passing: a stop", [at, powers(), tasmota.timers.count(TIMER), last_s(SW).find("mov")], [40, [[1, 0], [2, 0]], 0, "stop"])
    # a key on the module against the motor, as the checks before ended: both off, and stopped where it is
    report(0x1201, {"Endpoint": 1, "Power": 1})
    report(0x1201, {"Endpoint": 2, "Power": 1})
    check("and stopped, with nothing of its own left to run", [tasmota.timers.count(TIMER), tasmota.timers.count("zbdriver_twokey_step_" + SW)], [0, 0])
end

# A motor given back while it runs has its timers taken with the driver's state: nothing of ours is left to turn it off, so it is
# turned off first
def release_motor_checks()
    tasmota.cmds.clear()
    tasmota.at_ms = 1400000
    drive({"do": "open"})
    check("a motor running up", [drv.moving.contains(SW), tasmota.timers.count(TIMER)], [true, 1])
    tasmota.cmds.clear()
    drive({"do": "release"})
    check_same("given back while it runs: both channels off, and no timer of it left", [powers(), tasmota.timers.count(TIMER), tasmota.timers.count("zbdriver_twokey_step_" + SW)],
               [[[1, 0], [2, 0]], 0, 0])
    drive({"do": "assign", "v": {"drv": "twokey", "app": "window", "mode": "motor", "open": 10, "close": 12}})
end

# The frame with the last "stop" of a move lost: the host marked it as heard, and the card stays "moving" for as long as nothing says it
# again. The tap on it sends a stop, and the answer to a command is the whole state
def lost_frame_checks()
    tasmota.at_ms = 1500000
    drive({"do": "open"})
    fire(TIMER)
    check_same("a motor open, at 100, and stopped: said", last_s(SW), {"pos": 100, "mov": "stop"})
    told.clear()
    drive({"do": "stop"})
    check_same("its frame lost, the tap on the card that shows it moving sends a stop: the answer says the whole state", last_s(SW), {"pos": 100, "mov": "stop"})
end

def settings_checks()
    told.clear()
    drive({"do": "settings"})
    var x = collect(SW, "x")
    var keys = []
    for e: x.find("l", []) keys.push(e["k"]) end
    check_same("a motor's settings: its times and the swap", keys, ["open", "close", "swap"])
    check_same("and their values", collect(SW, "v"), {"open": 10, "close": 12, "swap": false})
    drive({"do": "setting", "k": "open", "v": 25})
    check("a time set: kept in the flash", persist.find("zb_relay_assigned")[SW]["open"], 25)
    tasmota.answers.clear()
    drive({"do": "setting", "k": "open", "v": 999})
    check("one past its range is refused", tasmota.answers, ["failed"])
end

def gate_checks()
    tasmota.cmds.clear()
    drive({"do": "assign", "v": {"drv": "twokey", "app": "gate", "mode": "pulse", "sensor": DOOR, "travel": 15}})
    check("a gate on a pulse, with its door sensor: the sensor heard for it", host.watched.find(0x1301), SW)
    check("described so", [collect(SW, "d")["app"], collect(SW, "d")["mode"], collect(SW, "d")["sensor"]], ["gate", "pulse", DOOR])
    tasmota.cmds.clear()
    drive({"do": "open"})
    check_same("open: its key pressed, the open channel on", powers(), [[1, 1]])
    check("moving up", last_s(SW).find("mov"), "up")
    tasmota.cmds.clear()
    fire("zbdriver_twokey_pulse_" + SW + "_1")
    check_same("and let go, a pulse later", powers(), [[1, 0]])
    report(0x1301, {"Contact": 1})
    check_same("its sensor: open, at 100, stopped", last_s(SW), {"pos": 100, "mov": "stop"})
    tasmota.cmds.clear()
    drive({"do": "close"})
    check_same("close: the close channel's key", powers(), [[2, 1]])
    report(0x1301, {"Contact": 0})
    check_same("its sensor: closed, at 0", last_s(SW), {"pos": 0, "mov": "stop"})
    # with no sensor, no state but its travel
    drive({"do": "assign", "v": {"sensor": ""}})
    drive({"do": "open"})
    check("with no sensor, moving for its travel", last_s(SW).find("mov"), "up")
    fire(TIMER)
    check_same("and then nothing known", last_s(SW), {"pos": nil, "mov": "stop"})
end

# A gate sent again while its travel runs has the same: the travel's timer of the first press must not end the second's.
# One travel's timer is pending, the last press's
def stacked_gate_checks()
    tasmota.cmds.clear()
    tasmota.at_ms = 600000
    drive({"do": "open"})
    tasmota.at_ms = 610000
    drive({"do": "close"})
    check("two presses of the gate: the travel's timer of the first is gone, and the second's is the one", [tasmota.timers.count(TIMER), tasmota.timers.delay_of(TIMER)], [1, 15000])
    check("the gate is shown going down, for the second press", last_s(SW).find("mov"), "down")
    tasmota.at_ms = 615000
    tasmota.timers.run_due()
    check("5 s into the second's 15: it is still shown going down", last_s(SW).find("mov"), "down")
    tasmota.at_ms = 625000
    tasmota.timers.run_due()
    fire_send()
    check_same("and when its own 15 s are over, it stands", last_s(SW), {"mov": "stop"})
    check("with nothing of the id left", tasmota.timers.count(TIMER), 0)
end

# What the last event said of a device in a section that is no map (a refusal is a word)
def last_word(ieee, sec)
    var i = size(told) - 1
    while i >= 0
        var z = told[i].find("ZbDriver")
        var d = z != nil ? z.find(ieee) : nil
        if d != nil && d.contains(sec) return d[sec] end
        i -= 1
    end
    return nil
end

# A gate of two keys has no stop, and answering done while pressing nothing would leave the gate shown moving. It
# says so in its description, which is what the NSPanel's cycle goes by, and refuses a stop. One key stops by pressing it again,
# while it is shown moving: a key pressed on a gate that stands would start it
def gate_stop_checks()
    tasmota.cmds.clear()
    tasmota.at_ms = 2000000
    drive({"do": "open"})
    check("a gate of two keys, open sent: shown moving, and its travel timer is there", [last_s(SW).find("mov"), tasmota.timers.count(TIMER)], ["up", 1])
    tasmota.answers.clear()
    tasmota.cmds.clear()
    told.clear()
    drive({"do": "stop"})
    check_same("its stop: refused, to the console and to the panel, and no key pressed", [tasmota.answers, last_word(SW, "e"), powers()], [["failed"], "refused", []])
    check("and the gate is as it was: moving up, its travel to run, nothing said of it", [drv.moving.find(SW)[0], tasmota.timers.count(TIMER), last_s(SW)], ["up", 1, nil])
    told.clear()
    fd.calls.clear()
    drive({"do": "assign", "v": {"mode": "pulse"}})
    check("described to the panel without a stop, for its cycle to go without one", collect(SW, "d").find("stop", true), false)
    check("and the discovery is told the device was described again: Home Assistant's cover follows its driver's description (a mode, a stop)", fd.calls, [SW])
    # one key: the description has no word of it, and the same key stops what is moving
    told.clear()
    fd.calls.clear()
    drive({"do": "setting", "k": "inputs", "v": 1})
    check("the inputs set to one key: the description is said again, and it has a stop (no word of it)", [collect(SW, "d").contains("mode"), collect(SW, "d").contains("stop")], [true, false])
    check("and the discovery is told, for the cover's stop", fd.calls, [SW])
    fd.calls.clear()
    drive({"do": "setting", "k": "travel", "v": 12})
    check("a setting that is not in the description (the travel time) says nothing to the discovery", fd.calls, [])
    tasmota.cmds.clear()
    tasmota.answers.clear()
    drive({"do": "stop"})
    check_same("a gate of one key, moving: its stop presses the key, and is taken", [powers()[-1 ..], tasmota.answers], [[[1, 1]], ["done"]])
    check_same("it is not shown moving any more, with no travel timer left", [last_s(SW).find("mov"), tasmota.timers.count(TIMER)], ["stop", 0])
    tasmota.cmds.clear()
    tasmota.answers.clear()
    told.clear()
    drive({"do": "stop"})
    check_same("a stop of a gate that is not shown moving: refused, and no key pressed, for it would start it", [powers(), tasmota.answers, last_word(SW, "e")], [[], ["failed"], "refused"])
    told.clear()
    fd.calls.clear()
    drive({"do": "setting", "k": "inputs", "v": 0})
    check("back to two keys: described without a stop again", collect(SW, "d").find("stop", true), false)
    check("and the discovery is told again", fd.calls, [SW])
    # a discovery that falls over does not stop the host: the setting is taken, the panel told
    fd.fail = true
    tasmota.answers.clear()
    told.clear()
    drive({"do": "setting", "k": "inputs", "v": 1})
    fd.fail = false
    check("a discovery that raises is the host's log and no more: the setting is taken and the description said", [tasmota.answers, collect(SW, "d").contains("mode"), host.config(SW)["inputs"]], [["done"], true, 1])
    drive({"do": "setting", "k": "inputs", "v": 0})
end

# A gate's channel is a key held for a pulse. Past a restart of the bridge in the pulse, or an off that was lost, it stays on:
# what the bridge finds on, with no pulse of its own pending, it turns off, when it asks at boot and with every report. And
# one key at a time: an open and, 300 ms later, a close must not leave both channels on
def pulse_checks()
    drive({"do": "assign", "v": {"mode": "pulse", "inputs": 0, "pulse": 1}})
    tasmota.at_ms = 3000000
    # the bridge boots: it knows of no channel, no pulse, no move. The link comes up, the device is asked, and both are let go
    drv.power = {}
    drv.pulsing = {}
    drv.moving = {}
    tasmota.cmds.clear()
    drive({"do": "read"})
    check_same("a gate asked for at boot: both keys let go, whatever they were", powers(), [[1, 0], [2, 0]])
    tasmota.cmds.clear()
    drive({"do": "read"})
    check_same("asked again, both known off: nothing to let go", powers(), [])
    # what it says is on, with no pulse of ours: a key held, let go
    tasmota.cmds.clear()
    report(0x1201, {"Endpoint": 1, "Power": 1})
    check_same("a report of a channel on, with no pulse of ours pending: off", powers(), [[1, 0]])
    tasmota.cmds.clear()
    report(0x1201, {"Endpoint": 2, "Power": 1})
    check_same("and of the other one", powers(), [[2, 0]])
    tasmota.cmds.clear()
    report(0x1201, {"Endpoint": 2, "Power": 0})
    check_same("a channel off is nothing to do", powers(), [])
    # a pulse of ours: its own echo is not let go before its time
    tasmota.cmds.clear()
    drive({"do": "open"})
    report(0x1201, {"Endpoint": 1, "Power": 1})
    check_same("a pulse of ours: the key on, and its own report of it on leaves it", powers(), [[1, 1]])
    fire("zbdriver_twokey_pulse_" + SW + "_1")
    check_same("the pulse ends: off", powers(), [[1, 1], [1, 0]])
    tasmota.cmds.clear()
    report(0x1201, {"Endpoint": 1, "Power": 1})
    check_same("an echo of the on that comes after the pulse is over is let go too, and does no harm", powers(), [[1, 0]])
    # an open and a close 300 ms apart: one key at a time
    tasmota.cmds.clear()
    tasmota.at_ms = 3100000
    drive({"do": "open"})
    tasmota.at_ms = 3100300
    drive({"do": "close"})
    check_same("an open and 300 ms later a close: the open's key is let go before the close's is pressed", powers(), [[1, 1], [1, 0], [2, 1]])
    check("and the open's pulse is gone, the close's pending, and the travel is the close's", [tasmota.timers.count("zbdriver_twokey_pulse_" + SW + "_1"),
          tasmota.timers.count("zbdriver_twokey_pulse_" + SW + "_2"), tasmota.timers.count(TIMER), last_s(SW).find("mov")], [0, 1, 1, "down"])
    tasmota.cmds.clear()
    report(0x1201, {"Endpoint": 1, "Power": 1})
    check_same("the open's echo, late: its pulse is over, so it is let go again", powers(), [[1, 0]])
    tasmota.cmds.clear()
    fire("zbdriver_twokey_pulse_" + SW + "_2")
    check_same("the close's pulse ends", powers(), [[2, 0]])
    # the same key twice within its pulse is one pulse, started over
    tasmota.cmds.clear()
    tasmota.at_ms = 3200000
    drive({"do": "close"})
    tasmota.at_ms = 3200300
    drive({"do": "close"})
    check("a key pressed again in its pulse: one pulse, from the last press", [tasmota.timers.count("zbdriver_twokey_pulse_" + SW + "_2"), tasmota.timers.delay_of("zbdriver_twokey_pulse_" + SW + "_2")], [1, 1000])
    fire("zbdriver_twokey_pulse_" + SW + "_2")
    check_same("and ends with one off", powers()[-1 ..], [[2, 0]])
    tasmota.timers.fire(TIMER)
end

def release_checks()
    tasmota.answers.clear()
    fd.calls.clear()
    drive({"do": "release"})
    check("released: done, nobody's, and no configuration", [tasmota.answers, host.claimed.contains(SW), host.assigned.contains(SW)], [["done"], false, false])
    check("and the discovery is told the device was given back: it is a switch for Home Assistant again", fd.calls, [SW])
    r.pending = nil
    r.forward(nil, nil, {"ZbReceived": {"0x1201": {"Device": "0x1201", "Power": 0, "Endpoint": 2}}})
    check("its raw state to the panel again, a channel's", r.pending["0x1201/2"].find("Power"), 0)
end

unassigned_checks()
assign_checks()
motor_checks()
stacked_motor_checks()
stacked_reversal_checks()
lost_frame_checks()
release_motor_checks()
settings_checks()
gate_checks()
stacked_gate_checks()
gate_stop_checks()
pulse_checks()
release_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
