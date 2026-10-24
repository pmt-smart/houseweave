# berry/zbdriver_cover.be, the blinds' driver of the bridge, in the host and the relay
# it runs in, with a Zigbee network the test fills: which devices it has (the Tuya makers it knows, a
# blind by its interview, a device by its own report), the description it gives, the state it normalizes
# from a ZCL blind's reports and a Moes switch's datapoints, the motion it says from its commands and how
# a move ends, and the commands it writes to Z2T. Each part is a function: the script's own top level is
# far past the 256 constants a function may name.

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

# the same, as maps compare: a map parsed from JSON keeps its keys in another order
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

# the IEEE as the zigbee module has it: 8 bytes, least significant first
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

var CV_A = "0x00124B0000C10001"   # a Moes ZTS-EUR-C: a Tuya TS0601 whose position counts 0 for open
var CV_B = "0x00124B0000C10002"   # a Moes Star Ring: a Tuya TS0601 whose position counts 100 for open
var CV_C = "0x00124B0000C10003"   # a Tuya TS130F: a ZCL blind that counts 100 for open and says its motion
var CV_D = "0x00124B0000C10004"   # a ZCL blind of another maker, as the cluster counts: 0 for open
var LAMP = "0x90FD9FFFFE000001"

var net = FakeNet()
natives.zigbee = net
net.devices.push(FakeZ(CV_A, 0x1101, "_TZE200_nhyj64w2", "TS0601"))
net.devices.push(FakeZ(CV_B, 0x1102, "_TZE204_srmahpwl", "TS0601"))
net.devices.push(FakeZ(CV_C, 0x1103, "_TZ3000_1dd0d5yi", "TS130F"))
net.devices.push(FakeZ(CV_D, 0x1104, "Acme", "ZCLCV"))
net.devices.push(FakeZ(LAMP, 0x2001, "IKEA of Sweden", "TRADFRI bulb"))

var told = []
natives.espnow_send = def (msg, as_event) told.push(json.load(msg)) return true end
natives.ZbBridgeDrivers = ZbBridgeDrivers
natives.ZbDriverCover = ZbDriverCover
var r = ZbBridgeRelay.start()
# what it says to the panels, over the mesh
listen_to(r, told)
var host = r.drivers
var cover = size(host.drivers) > 0 ? host.drivers[0] : nil

# the next message the host holds back goes, as its timer comes: whether there was one
def next_frame()
    return tasmota.timers.fire("zbbridge_drivers_frames")
end

def settle()
    var n = 0
    while n < 100 && next_frame()
        n += 1
    end
end

# a timer runs, and what it made the host say goes with the time that takes
def fire(id)
    var ran = tasmota.timers.fire(id)
    settle()
    return ran
end

# what a device was told in a section over all the events sent, as one map
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

def frames_fit()
    for ev: told
        if size(json.dump(ev)) > 233 return false end
    end
    return true
end

def zb_cmds()
    var out = []
    for c: tasmota.cmds
        if string.find(c, "ZbSend ") >= 0 out.push(c) end
    end
    return out
end
def zb_body(c)
    return json.load(c[string.find(c, "{") ..])
end
def last_zb()
    var l = zb_cmds()
    return size(l) > 0 ? zb_body(l[-1]) : nil
end

def interview(short, device_id, clusters)
    r.forward_state(nil, nil, {"ZbState": {"Status": 33, "Device": string.format("0x%04X", short), "Endpoint": 1,
                                              "ProfileId": "0x0104", "DeviceId": device_id, "InClusters": clusters}})
    settle()
end
def drive(ieee, body)
    body["id"] = ieee
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, json.dump(body))
    fire("zbbridge_drivers_send")
end
def report(short, attrs)
    attrs["Device"] = string.format("0x%04X", short)
    host.on_received({string.format("0x%04X", short): attrs})
    fire("zbbridge_drivers_send")
end
# the state a device was told in the last event about it
def last_state(ieee)
    var i = size(told) - 1
    while i >= 0
        var z = told[i].find("ZbDriver")
        var d = z != nil ? z.find(ieee) : nil
        if d != nil && d.contains("s") return d["s"] end
        i -= 1
    end
    return nil
end

# --- the driver in the relay, and the devices it has --------------------------------------------
def claim_checks()
    check("the relay's start adds the blinds' driver to the host", [size(host.drivers), cover != nil ? cover.ID : nil], [1, "cover"])
    check("a driver of the Tuya makers it knows", [cover.claims({"Manufacturer": "_TZE200_nhyj64w2"}), cover.claims({"Manufacturer": "_TZE204_srmahpwl"}),
                                                  cover.claims({"Manufacturer": "_TZE284_upt8lzi0"}), cover.claims({"Manufacturer": "_TZE200_other"})],
          [true, true, true, false])
    # the Moes ZRS-USC-WH: its profile, its position 100 for open, and its six settings
    var zr = {"Manufacturer": "_TZE284_b7kbnl6q"}
    var keys = []
    for s: ZbDriverCover.settings_of(zr)  keys.push([s[0], s[3]]) end
    check("the Moes ZRS-USC-WH: claimed, its profile, upright, and its settings by datapoint",
          [cover.claims(zr), ZbDriverCover.profile(zr), ZbDriverCover.TUYA_INVERTED.find("zrsusc"), keys],
          [true, "zrsusc", nil, [["calib", 3], ["time", 10], ["light", 7], ["reverse", 8], ["led", 14], ["lock", 103]]])
    check("a blind by its interview: a window covering device or a shade, with the cluster",
          [cover.claims({"DeviceId": 0x0202, "InClusters": [0x0000, 0x0102]}), cover.claims({"DeviceId": 0x0200, "InClusters": [0x0102]}),
           cover.claims({"DeviceId": 0x0202, "InClusters": [0x0000]}), cover.claims({"DeviceId": 0x0100, "InClusters": [0x0102]})],
          [true, true, false, false])
    check("a device by what it reports: the cluster's position, or a TS130F's motion",
          [cover.claims({"report": {"CurrentPositionLiftPercentage": 40}}), cover.claims({"report": {"TuyaMovingState": 1}}),
           cover.claims({"report": {"Power": 1, "Dimmer": 50}})], [true, true, false])

    told.clear()
    tasmota.cmds.clear()
    interview(0x1101, "0x0051", ["0x0000", "0xEF00"])
    check_same("a ZTS-EUR-C's interview: described in its place, a blind the NSPanel registers with 64, its position",
               collect(CV_A, "d"), {"caps": 64, "ep": 1, "kind": "cover", "drv": "cover", "model": "TS0601"})
    check("and asked for all its datapoints", string.find(zb_cmds()[0], "\"TuyaQuery\":null") > 0, true)
    told.clear()
    tasmota.cmds.clear()
    interview(0x1103, "0x0202", ["0x0000", "0x0006", "0x0102"])
    check("a TS130F by its interview, and asked for its position", [collect(CV_C, "d")["caps"], last_zb()["Read"].contains("CurrentPositionLiftPercentage")], [64, true])
    interview(0x1102, "0x0051", ["0x0000", "0xEF00"])
    interview(0x1104, "0x0202", ["0x0000", "0x0102"])
    check("each in a frame", frames_fit(), true)
end
claim_checks()

# --- what the devices say -----------------------------------------------------------------------
def report_checks()
    told.clear()
    tasmota.at_ms = 100000
    report(0x1101, {"EF00/0202": 30})
    check_same("a ZTS-EUR-C counts 0 for open: 30 is 70% open", collect(CV_A, "s"), {"pos": 70})
    told.clear()
    report(0x1101, {"EF00/0401": 2})
    check_same("its key Close pressed on the wall: it goes down", last_state(CV_A), {"mov": "down"})
    told.clear()
    report(0x1101, {"EF00/0202": 100})
    check_same("and at the bottom it has stopped", last_state(CV_A), {"pos": 0, "mov": "stop"})
    check("and a moment later it is asked where it is, for the last word of it", tasmota.timers.contains("zbdriver_cover_" + CV_A), true)

    told.clear()
    report(0x1102, {"EF00/0202": 105})
    check_same("a Star Ring past the top is at the top", collect(CV_B, "s"), {"pos": 100})
    told.clear()
    report(0x1102, {"EF00/0202": 255})
    check_same("and wrapped below 0, at the bottom", collect(CV_B, "s"), {"pos": 0})

    told.clear()
    report(0x1103, {"CurrentPositionLiftPercentage": 40, "TuyaMovingState": 0})
    check_same("a TS130F counts 100 for open, and says it goes up", collect(CV_C, "s"), {"pos": 40, "mov": "up"})
    told.clear()
    report(0x1103, {"TuyaMovingState": 1})
    check_same("and that it stopped", last_state(CV_C), {"mov": "stop"})

    told.clear()
    report(0x1104, {"CurrentPositionLiftPercentage": 30})
    check_same("a ZCL blind of another maker counts as the cluster: 30 closed is 70 open", collect(CV_D, "s"), {"pos": 70})

    # the answer to a query says the last control again: no key was pressed
    told.clear()
    tasmota.cmds.clear()
    drive(CV_A, {"do": "read"})
    report(0x1101, {"EF00/0401": 0, "EF00/0202": 100})
    check_same("a query's answer gives the position, and its control is no motion", collect(CV_A, "s"), {"pos": 0})
    tasmota.at_ms = 103000
    told.clear()
    report(0x1101, {"EF00/0401": 0})
    check_same("past the answer's moment, the control is a key pressed: it goes up", last_state(CV_A), {"mov": "up"})
    report(0x1101, {"EF00/0401": 1})
    check("each in a frame", frames_fit(), true)
end
report_checks()

# --- what the NSPanel asks -----------------------------------------------------------------------
def command_checks()

# the alarm of the relay, as far as a driver sees it: what it is told of the commands the bridge sends
class FakeAlarm
    var told
    def init() self.told = [] end
    def commanded(line) self.told.push(line) end
end

# the alarm hears what the driver sends a blind, a read that goes quiet excepted: a read is no command and has no echo
def alarm_told_checks()
    var alarm = FakeAlarm()
    r.alarm = alarm
    tasmota.cmds.clear()
    tasmota.muted.clear()
    drive(CV_A, {"do": "stop"})
    drive(CV_C, {"do": "open"})
    var lines = zb_cmds()
    check("each command of the driver is told to the alarm before it goes, whole and in order", [size(lines), alarm.told], [2, lines])
    alarm.told.clear()
    tasmota.cmds.clear()
    cover.seed(host.info_for(CV_C), true)
    check("a read that runs in a loop is quiet and is not told", [size(zb_cmds()) > 0, size(tasmota.muted) > 0, alarm.told], [true, true, []])
    r.alarm = nil
end
alarm_told_checks()
    # a ZCL blind: by name, with the motion said at once
    told.clear()
    tasmota.cmds.clear()
    drive(CV_D, {"do": "open"})
    check_same("open, on a ZCL blind: ShutterOpen by its name, to its IEEE", [last_zb()["Device"], last_zb()["Send"]], [CV_D, {"ShutterOpen": ""}])
    check_same("and it goes up, said at once", last_state(CV_D), {"mov": "up"})
    check("a move has its longest travel to end in", tasmota.timers.contains("zbdriver_cover_" + CV_D), true)
    told.clear()
    report(0x1104, {"CurrentPositionLiftPercentage": 0})
    check_same("at the top it has stopped", last_state(CV_D), {"pos": 100, "mov": "stop"})
    told.clear()
    tasmota.cmds.clear()
    drive(CV_D, {"do": "open"})
    check("one already at the top is sent up, and not said to move", [size(zb_cmds()), size(told)], [1, 0])

    told.clear()
    tasmota.cmds.clear()
    drive(CV_D, {"do": "goto", "v": 40})
    check_same("a position, on a ZCL blind: ShutterLift, in the cluster's count", last_zb()["Send"], {"ShutterLift": 60})
    check_same("down from the top", last_state(CV_D), {"mov": "down"})
    told.clear()
    report(0x1104, {"CurrentPositionLiftPercentage": 60})
    check_same("there, it has stopped", last_state(CV_D), {"pos": 40, "mov": "stop"})

    told.clear()
    drive(CV_D, {"do": "close"})
    check_same("close goes down", [last_zb()["Send"], last_state(CV_D)], [{"ShutterClose": ""}, {"mov": "down"}])
    # Tasmota stacks the timers of one id: a move sent on a move takes the one before out, so the travel of the first cannot end the second
    drive(CV_D, {"do": "open"})
    check("a move sent on another: one timer of the id, the second's", tasmota.timers.count("zbdriver_cover_" + CV_D), 1)
    told.clear()
    drive(CV_D, {"do": "stop"})
    check_same("and stop stops it", [last_zb()["Send"], last_state(CV_D)], [{"ShutterStop": ""}, {"mov": "stop"}])
    tasmota.cmds.clear()
    check("and a moment later it is asked where it stopped", [fire("zbdriver_cover_" + CV_D), last_zb()["Read"].contains("CurrentPositionLiftPercentage")], [true, true])

    # a move nothing said had ended ends after the longest travel
    told.clear()
    drive(CV_D, {"do": "close"})
    told.clear()
    fire("zbdriver_cover_" + CV_D)
    fire("zbbridge_drivers_send")
    check_same("a move nothing said had ended has, after the longest travel", last_state(CV_D), {"mov": "stop"})

    # a Tuya switch: the control datapoint, and the position in its own count
    told.clear()
    tasmota.cmds.clear()
    drive(CV_A, {"do": "close"})
    check_same("close, on a ZTS-EUR-C: its control datapoint, the type it said", last_zb()["Write"], {"EF00/0401": 2})
    drive(CV_A, {"do": "stop"})
    check_same("stop", last_zb()["Write"], {"EF00/0401": 1})
    drive(CV_A, {"do": "goto", "v": 35})
    check_same("a position in its count: 35 open is 65", last_zb()["Write"], {"EF00/0202": 65})
    drive(CV_B, {"do": "goto", "v": 35})
    check_same("and in the Star Ring's, as it is", last_zb()["Write"], {"EF00/0202": 35})

    tasmota.cmds.clear()
    check("a position out of 0 to 100, or not a number, is refused", [cover.command({"IEEEAddr": CV_D}, {"do": "goto", "v": 101}),
                                                                      cover.command({"IEEEAddr": CV_D}, {"do": "goto", "v": "50"}),
                                                                      cover.command({"IEEEAddr": CV_D}, {"do": "dance"}), size(zb_cmds())],
          [false, false, false, 0])
    check("each in a frame", frames_fit(), true)
end
command_checks()

# the settings: each profile's schema, the values the device says, and their writes
def schema_of(ieee)
    var l = nil
    for ev: told
        var z = ev.find("ZbDriver")
        var d = z != nil ? z.find(ieee) : nil
        var x = d != nil ? d.find("x") : nil
        if isinstance(x, map)  l = x["l"] end
    end
    if l == nil return nil end
    var keys = []
    for e: l keys.push(e["k"]) end
    return keys
end

def settings_checks()
    told.clear()
    tasmota.cmds.clear()
    drive(CV_A, {"do": "settings"})
    check("a ZTS-EUR-C's settings: the calibration, the backlight and the motor's way", schema_of(CV_A), ["calib", "light", "reverse"])
    check("and the device asked for them all", string.find(zb_cmds()[-1], "TuyaQuery") > 0, true)
    told.clear()
    tasmota.at_ms = 200000
    report(0x1101, {"EF00/0403": 1, "EF00/0107": 1, "EF00/0408": 0})
    check_same("their values, as the device holds them", collect(CV_A, "v"), {"calib": 1, "light": true, "reverse": false})
    tasmota.cmds.clear()
    drive(CV_A, {"do": "setting", "k": "reverse", "v": true})
    check_same("the motor reversed: its datapoint, the type it said", last_zb()["Write"], {"EF00/0408": 1})
    drive(CV_A, {"do": "setting", "k": "calib", "v": 0})
    check_same("the calibration on", last_zb()["Write"], {"EF00/0403": 0})
    tasmota.cmds.clear()
    check("a setting the profile has not, or a value it does not take, is refused",
          [cover.command({"IEEEAddr": CV_A, "Manufacturer": "_TZE200_nhyj64w2"}, {"do": "setting", "k": "time", "v": 30}),
           cover.command({"IEEEAddr": CV_A, "Manufacturer": "_TZE200_nhyj64w2"}, {"do": "setting", "k": "calib", "v": 2}), size(zb_cmds())], [false, false, 0])

    told.clear()
    tasmota.cmds.clear()
    drive(CV_C, {"do": "settings"})
    check("a TS130F's: the calibration, its travel time and the motor's way", schema_of(CV_C), ["calib", "time", "reverse"])
    var rd = last_zb()
    check("and its attributes read", [rd["Read"].contains("TuyaCalibration"), rd["Read"].contains("TuyaCalibrationTime"), rd["Read"].contains("TuyaMotorReversal")], [true, true, true])
    told.clear()
    report(0x1103, {"TuyaCalibrationTime": 450, "TuyaMotorReversal": 1})
    check_same("the travel time in seconds, from its tenths", collect(CV_C, "v"), {"time": 45, "reverse": true})
    tasmota.cmds.clear()
    drive(CV_C, {"do": "setting", "k": "time", "v": 60})
    check_same("a travel time written in tenths, by the attribute's name", last_zb()["Write"], {"TuyaCalibrationTime": 600})
    check("and read a moment after", [fire("zbdriver_cover_set_" + CV_C), last_zb()["Read"].contains("TuyaCalibrationTime")], [true, true])

    told.clear()
    drive(CV_D, {"do": "settings"})
    check("a ZCL blind of another maker has none", schema_of(CV_D), [])
    check("each in a frame", frames_fit(), true)
end
settings_checks()

def network_checks()
    net.devices.remove(net.devices.find(net.find(CV_D)))
    r.run("ZbForget 0x1104", "ESP-NOW")
    fire("zbbridge_drivers_check")
    check("a device that left: what the driver knew of it goes", [host.claimed.contains(CV_D), cover.pos.contains(CV_D), cover.moving.contains(CV_D),
                                                                  tasmota.timers.contains("zbdriver_cover_" + CV_D)], [false, false, false, false])
end
network_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
