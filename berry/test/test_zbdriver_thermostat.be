# berry/zbdriver_thermostat.be, the thermostats' driver of the bridge, in the
# host and the relay it runs in, with a Zigbee network the test fills: which devices it
# has (a Tuya maker it knows, a thermostat by its interview, a device by its own report),
# the description it gives, the state it normalizes from a ZCL thermostat's reports and a
# Moes ZHT-SR's datapoints, the commands it writes to Z2T and how it reads them back, and
# the settings' schema and their writes. Each part is a function: the script's own top
# level is far past the 256 constants a function may name.

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

var TH_A = "0x00124B0000B00001"   # a Moes ZHT-SR: a Tuya TS0601 of the maker the driver knows
var TH_B = "0x00124B0000B00002"   # a ZCL thermostat
var TH_C = "0x00124B0000B00003"   # a Tuya TS0601 of another maker: not a thermostat the driver knows
var TH_D = "0x00124B0000B00004"   # a ZCL thermostat the network had before its interview was heard
var TH_E = "0x00124B0000B00005"   # a ZHT-SR the network had before the driver
var TH_F = "0x00124B0000B00006"   # a ZHT-SR the driver has had no word from yet: no datapoint type learned
var LAMP = "0x90FD9FFFFE000001"

var net = FakeNet()
natives.zigbee = net
net.devices.push(FakeZ(TH_A, 0x1001, "_TZE204_lpedvtvr", "TS0601"))
net.devices.push(FakeZ(TH_B, 0x1002, "Acme", "ZCLTH"))
net.devices.push(FakeZ(TH_C, 0x1003, "_TZE200_other", "TS0601"))
net.devices.push(FakeZ(LAMP, 0x2001, "IKEA of Sweden", "TRADFRI bulb"))

var told = []
natives.espnow_send = def (msg, as_event) told.push(json.load(msg)) return true end
natives.ZbBridgeDrivers = ZbBridgeDrivers
natives.ZbDriverThermostat = ZbDriverThermostat
var r = ZbBridgeRelay.start()
# what it says to the panels, over the mesh
listen_to(r, told)
var host = r.drivers
var thermostat = size(host.drivers) > 0 ? host.drivers[0] : nil

# the next message the host holds back goes, as its timer comes: whether there was one
def next_frame()
    return tasmota.timers.fire("zbbridge_drivers_frames")
end

# the time all of them take to go
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

# the commands to Z2T sent so far, in order, as the text after the command's name
def zb_cmds()
    var out = []
    for c: tasmota.cmds
        var at = string.find(c, "ZbSend ")
        if at >= 0 out.push(c) end
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
    settle()
end
def report(short, attrs)
    attrs["Device"] = string.format("0x%04X", short)
    host.on_received({string.format("0x%04X", short): attrs})
    fire("zbbridge_drivers_send")
end

# --- the driver in the relay, and the devices it has --------------------------------------------
def claim_checks()
    check("the relay's start adds the thermostats' driver to the host", [size(host.drivers), thermostat != nil ? thermostat.ID : nil], [1, "thermostat"])
    check("a driver of a maker it knows", thermostat.claims({"IEEEAddr": TH_A, "Manufacturer": "_TZE204_lpedvtvr"}), true)
    check("and of no other Tuya maker", thermostat.claims({"IEEEAddr": TH_C, "Manufacturer": "_TZE200_other"}), false)
    check("a thermostat by its interview: the DeviceId and the cluster",
          thermostat.claims({"IEEEAddr": TH_B, "Manufacturer": "Acme", "DeviceId": 0x0301, "InClusters": [0x0000, 0x0201]}), true)
    check("a DeviceId alone, or the cluster alone, is not one",
          [thermostat.claims({"IEEEAddr": TH_B, "DeviceId": 0x0301, "InClusters": [0x0000]}), thermostat.claims({"IEEEAddr": TH_B, "DeviceId": 0x0100, "InClusters": [0x0201]})],
          [false, false])
    check("a device by what it reports: an attribute of the cluster", thermostat.claims({"IEEEAddr": TH_D, "report": {"LocalTemperature": 20.5}}), true)
    check("and a lamp's report is not", thermostat.claims({"IEEEAddr": LAMP, "report": {"Power": 1, "Dimmer": 50}}), false)

    # a ZHT-SR's interview: described in its place, and asked for all its datapoints
    told.clear()
    tasmota.cmds.clear()
    interview(0x1001, "0x0051", ["0x0000", "0xEF00"])
    check("the interview of a ZHT-SR goes to the driver: one event, and no raw interview", [size(told), told[0].contains("ZbDriver"), told[0].contains("ZbState")], [1, true, false])
    check_same("its description: a thermostat the NSPanel registers with 48 (setpoint and mode), 5 to 35 degrees in 0.5 steps, a floor probe",
               collect(TH_A, "d"), {"caps": 48, "min": 50, "max": 350, "step": 5, "modes": ["off", "heat"], "floor": true, "ep": 1,
                                     "kind": "thermostat", "drv": "thermostat", "model": "TS0601"})
    check("in a frame", frames_fit(), true)
    var q = zb_cmds()
    check("and the device asked for all its datapoints, by the console's own command", [size(q), q[0][0 .. 6], string.find(q[0], "\"TuyaQuery\":null") > 0], [1, "ZbSend ", true])
    check("addressed by its IEEE, which a rejoin does not change", zb_body(q[0])["Device"], TH_A)

    # a ZCL thermostat's: the attributes the state is made of
    told.clear()
    tasmota.cmds.clear()
    interview(0x1002, "0x0301", ["0x0000", "0x0201"])
    check_same("a ZCL thermostat is 5 to 30 degrees, and has no probe to show", [collect(TH_B, "d")["max"], collect(TH_B, "d")["floor"], collect(TH_B, "d")["model"]], [300, false, "ZCLTH"])
    var rd = last_zb()
    check_same("and it is asked for what its state is made of", [rd["Device"], rd["Read"].contains("LocalTemperature"), rd["Read"].contains("OccupiedHeatingSetpoint"),
                                                                rd["Read"].contains("SystemMode"), rd["Read"].contains("PIHeatingDemand")], [TH_B, true, true, true, true])

    # a Tuya device of another maker is not a thermostat this driver knows: the interview goes as it did
    told.clear()
    interview(0x1003, "0x0051", ["0x0000", "0xEF00"])
    check("a Tuya TS0601 of another maker goes as it always did, the raw interview to the NSPanel", [size(told), told[0].contains("ZbState"), host.claimed.contains(TH_C)],
          [1, true, false])
end
claim_checks()

# --- what a ZHT-SR says ------------------------------------------------------------------------------
def tuya_report_checks()
    host.last = {}
    told.clear()
    # a TuyaQuery's answer: every datapoint the table has, in the keys Z2T gives them
    report(0x1001, {"EF00/0101": 1, "EF00/0402": 2, "EF00/0210": 213, "EF00/0212": 50, "EF00/0420": 0, "EF00/0222": 350, "EF00/0127": 0,
                    "EF00/042F": 0, "EF00/0230": 80, "EF00/0232": 210, "EF00/0265": 254, "EF00/026D": 271, "EF00/026E": 20,
                    "EF00/026F": 700, "EF00/0270": 50, "EF00/0271": 200, "EF00/0472": 2, "EF00/0173": 1, "EF00/0999": 7, "LinkQuality": 80})
    check_same("the state, normalized: on, 21.3 now, 21.0 asked, heating, 27.1 on the floor",
               collect(TH_A, "s"), {"mode": "heat", "cur": 213, "set": 210, "dem": 100, "floor": 271})
    check_same("and the settings' values: choices by their index, flags, whole numbers",
               collect(TH_A, "v"), {"preset": 2, "lock": false, "calib": -2, "dead": 3, "lmin": 5, "lmax": 35, "phi": 70, "plo": 5, "eco": 20,
                                     "bl": 80, "scr": 2, "ring": true, "sensor": 0})
    check("each in a frame", frames_fit(), true)

    told.clear()
    report(0x1001, {"EF00/0232": 210, "EF00/0210": 213})
    check("what the NSPanel has is not said again", size(told), 0)
    report(0x1001, {"EF00/0232": 215, "EF00/042F": 1})
    check_same("a datapoint that changed is: the target, and the heating that stopped", collect(TH_A, "s"), {"set": 215, "dem": 0})
    told.clear()
    report(0x1001, {"EF00/0101": 0})
    check_same("off", collect(TH_A, "s"), {"mode": "off"})
    told.clear()
    report(0x1001, {"EF00/0127": 1})
    check_same("a setting that changed, on the dial's own menu: its value", [collect(TH_A, "v"), size(collect(TH_A, "s"))], [{"lock": true}, 0])
    told.clear()
    report(0x1001, {"Temperature": 21.3})
    check("a report with none of the datapoints says nothing", size(told), 0)

    # a Tuya device that does not answer says up false, from the host
    told.clear()
    host.on_received({"0x1001": {"Device": "0x1001", "Reachable": false}})
    fire("zbbridge_drivers_send")
    check_same("a device that stopped answering is said so", collect(TH_A, "s"), {"up": false})
end
tuya_report_checks()

# --- what the NSPanel asks of a ZHT-SR -------------------------------------------------------------
def tuya_command_checks()
    tasmota.cmds.clear()
    told.clear()
    tasmota.answers.clear()
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B0000B00001","do":"target","v":215}')
    var c = last_zb()
    check_same("a target is written as the datapoint, in tenths of a degree", [c["Device"], c["Write"], tasmota.answers], [TH_A, {"EF00/0232": 215}, ["done"]])
    check("the write is read back if the device says nothing: a timer", tasmota.timers.contains("zbdriver_thermostat_" + TH_A), true)
    check("and shown in the log, as an action of the NSPanel's", [tasmota.muted, size(zb_cmds()[0]) > 0 && zb_cmds()[0][0 .. 6] == "ZbSend "], [[], true])

    var before = size(zb_cmds())
    fire("zbdriver_thermostat_" + TH_A)
    check("no echo in time: the device is asked for all its datapoints, quietly", [size(zb_cmds()) - before, size(tasmota.muted), string.find(tasmota.muted[0], "TuyaQuery") > 0, tasmota.muted[0][0 .. 7]],
          [1, 1, true, "_ZbSend "])

    # a device that echoes the datapoint is not asked
    tasmota.muted.clear()
    drive(TH_A, {"do": "target", "v": 220})
    report(0x1001, {"EF00/0232": 220})
    before = size(zb_cmds())
    fire("zbdriver_thermostat_" + TH_A)
    check("an echo within the time: nothing is asked, and the NSPanel has the state", [size(zb_cmds()) - before, collect(TH_A, "s").find("set")], [0, 220])

    # a target the device cannot take is refused to the NSPanel, and nothing is written
    told.clear()
    before = size(zb_cmds())
    var refused = []
    for v: [355, 45, 212, "21", nil, 215.5]
        drive(TH_A, {"do": "target", "v": v})
        refused.push(told[-1]["ZbDriver"][TH_A].find("e"))
    end
    check("out of the range, off the step, or no number: refused, and nothing is written", [refused, size(zb_cmds()) - before], [["refused", "refused", "refused", "refused", "refused", "refused"], 0])

    # the mode
    tasmota.cmds.clear()
    drive(TH_A, {"do": "mode", "v": "heat"})
    check_same("heat is the on/off datapoint on", last_zb()["Write"], {"EF00/0101": 1})
    drive(TH_A, {"do": "mode", "v": "off"})
    check_same("and off", last_zb()["Write"], {"EF00/0101": 0})
    told.clear()
    before = size(zb_cmds())
    drive(TH_A, {"do": "mode", "v": "auto"})
    check("auto is no mode of a thermostat for heating (the ZHT-SR's is a preset): refused", [told[-1]["ZbDriver"][TH_A].find("e"), size(zb_cmds()) - before], ["refused", 0])

    # the type of a datapoint is the one the device used for it, when it has said one
    report(0x1001, {"EF00/0432": 215})
    tasmota.cmds.clear()
    drive(TH_A, {"do": "target", "v": 225})
    check_same("a datapoint the device says with another type is written with it", last_zb()["Write"], {"EF00/0432": 225})
    report(0x1001, {"EF00/0232": 225})
    tasmota.cmds.clear()
    drive(TH_A, {"do": "target", "v": 230})
    check_same("and with the first again, when it says that", last_zb()["Write"], {"EF00/0232": 230})

    # read asks for everything, quietly
    tasmota.cmds.clear()
    tasmota.muted.clear()
    drive(TH_A, {"do": "read"})
    check("a read is a TuyaQuery, quiet", [size(zb_cmds()), size(tasmota.muted)], [1, 1])
end
tuya_command_checks()

# --- the datapoints' types before the device has said any: the table's -------------------------------------
def default_checks()
    net.devices.push(FakeZ(TH_F, 0x1006, "_TZE204_lpedvtvr", "TS0601"))
    host.link_up()
    var n = 0
    while fire("zbbridge_drivers_announce") && n < 10
        n += 1
    end
    check("a ZHT-SR the driver has not heard yet: no type learned", thermostat.types.contains(TH_F), false)
    var cases = [["target", nil, 215, "EF00/0232", 215], ["mode", nil, "heat", "EF00/0101", 1], ["mode", nil, "off", "EF00/0101", 0],
                 ["setting", "preset", 3, "EF00/0402", 3], ["setting", "lock", true, "EF00/0127", 1], ["setting", "calib", -1, "EF00/0265", 255],
                 ["setting", "dead", 1, "EF00/026E", 10], ["setting", "lmin", 2, "EF00/0212", 20], ["setting", "lmax", 36, "EF00/0222", 360],
                 ["setting", "phi", 65, "EF00/026F", 650], ["setting", "plo", 4, "EF00/0270", 40], ["setting", "eco", 19, "EF00/0271", 190],
                 ["setting", "bl", 60, "EF00/0230", 60], ["setting", "scr", 1, "EF00/0472", 1], ["setting", "ring", false, "EF00/0173", 0]]
    var got = []
    var want = []
    for c: cases
        tasmota.cmds.clear()
        var body = {"do": c[0], "v": c[2]}
        if c[1] != nil body["k"] = c[1] end
        drive(TH_F, body)
        var w = last_zb()
        got.push(w != nil && w["Write"].contains(c[3]) ? w["Write"][c[3]] : "wrong key")
        want.push(c[4])
    end
    check("with nothing learned, every write is to the table's datapoint, in the table's type", got, want)
end
default_checks()

# --- the settings -----------------------------------------------------------------------------------
def settings_checks()
    host.last = {}
    told.clear()
    tasmota.cmds.clear()
    tasmota.muted.clear()
    drive(TH_A, {"do": "settings"})
    var entries = []
    var at_ok = true
    var of_ok = true
    var n = 0
    for ev: told
        var f = ev["ZbDriver"][TH_A].find("x")
        if f == nil continue end
        n += 1
        if f["at"] != size(entries) at_ok = false end
        if f["of"] != 13 of_ok = false end
        for e: f["l"] entries.push(e) end
    end
    check("the schema goes in several frames, numbered, each within the link's", [n > 1, at_ok, of_ok, frames_fit()], [true, true, true, true])
    var keys = []
    for e: entries keys.push(e["k"]) end
    check("the ZHT-SR's thirteen settings, in the order the NSPanel lists them", keys, ["preset", "lock", "calib", "dead", "lmin", "lmax", "phi", "plo", "eco", "bl", "scr", "ring", "sensor"])
    var by = {}
    for e: entries by[e["k"]] = e end
    check_same("a choice has its options", by["preset"], {"k": "preset", "l": "Preset", "t": "e", "o": ["Manual", "Temporary", "Program", "Eco"]})
    check_same("a flag has none", by["lock"], {"k": "lock", "l": "Child lock", "t": "b"})
    check_same("a number has its range and its unit", by["lmin"], {"k": "lmin", "l": "Min limit", "t": "n", "min": 1, "max": 15, "u": "°"})
    check_same("and one that may be below zero is a range, chosen from a list the NSPanel makes", by["calib"], {"k": "calib", "l": "Calibration", "t": "r", "min": -10, "max": 10, "u": "°"})
    check("the deadzone is a choice of ten", [by["dead"]["t"], size(by["dead"]["o"])], ["e", 10])
    check("the sensor is read, and not written", by["sensor"].find("w"), 0)
    check("and the others are not marked", [by["lock"].contains("w"), by["bl"].contains("w")], [false, false])
    check("the device is asked for its datapoints, quietly: the values come as its answer", [size(tasmota.muted), size(zb_cmds())], [1, 1])

    # the values come as the device's own answer, all of them: the host forgot what it said before
    told.clear()
    report(0x1001, {"EF00/0265": 254, "EF00/0127": 1, "EF00/0402": 2})
    check_same("and are all said, though the NSPanel had them", collect(TH_A, "v"), {"calib": -2, "lock": true, "preset": 2})

    # the writes: each setting's datapoint, with the type and the raw value its table says
    var cases = [["lock", true, "EF00/0127", 1], ["lock", false, "EF00/0127", 0], ["dead", 3, "EF00/026E", 20], ["calib", -2, "EF00/0265", 254],
                 ["calib", 3, "EF00/0265", 3], ["lmin", 5, "EF00/0212", 50], ["lmax", 40, "EF00/0222", 400], ["phi", 70, "EF00/026F", 700],
                 ["plo", 0, "EF00/0270", 0], ["eco", 18, "EF00/0271", 180], ["bl", 80, "EF00/0230", 80], ["scr", 5, "EF00/0472", 5],
                 ["preset", 3, "EF00/0402", 3], ["ring", true, "EF00/0173", 1]]
    var written = []
    for c: cases
        tasmota.cmds.clear()
        drive(TH_A, {"do": "setting", "k": c[0], "v": c[1]})
        var w = last_zb()
        written.push(w != nil ? [c[0], w["Write"].contains(c[2]) ? w["Write"][c[2]] : "wrong key"] : [c[0], "nothing"])
    end
    var want = []
    for c: cases want.push([c[0], c[3]]) end
    check("each setting is written to its datapoint, in the raw value it is kept in", written, want)

    # what is refused: the sensor, a value out of range or of another kind, and a key the table has not
    told.clear()
    tasmota.cmds.clear()
    var bad = [["sensor", 1], ["lmax", 50], ["lmax", 34], ["dead", 10], ["dead", -1], ["lock", "yes"], ["calib", 11], ["preset", 4], ["bl", 101],
               ["foo", 1], ["bl", 50.5]]
    var answered = []
    for c: bad
        drive(TH_A, {"do": "setting", "k": c[0], "v": c[1]})
        answered.push(told[-1]["ZbDriver"][TH_A].find("e"))
    end
    var all_refused = true
    for a: answered if a != "refused" all_refused = false end end
    check("what the setting does not take is refused, and nothing is written", [all_refused, size(answered), size(zb_cmds())], [true, 11, 0])
    told.clear()
    drive(TH_A, {"do": "setting", "k": "lock"})
    drive(TH_A, {"do": "frobnicate"})
    check("a setting with no value, and a verb the driver does not have, are refused", [told[0]["ZbDriver"][TH_A].find("e"), told[1]["ZbDriver"][TH_A].find("e")], ["refused", "refused"])
end
settings_checks()

# --- a ZCL thermostat ---------------------------------------------------------------------------------
def zcl_checks()
    host.last = {}
    told.clear()
    report(0x1002, {"LocalTemperature": 21.4, "OccupiedHeatingSetpoint": 22, "SystemMode": 4, "PIHeatingDemand": 35, "LinkQuality": 90})
    check_same("a ZCL thermostat's state: degrees as tenths, the mode by name", collect(TH_B, "s"), {"cur": 214, "set": 220, "mode": "heat", "dem": 35})
    told.clear()
    report(0x1002, {"SystemMode": 1})
    check("auto is a mode of changing over, which a thermostat for heating has no name for: nothing is said", size(told), 0)
    told.clear()
    report(0x1002, {"SystemMode": 0, "LocalTemperature": 19.96})
    check_same("off, and 19.96 is 20.0", collect(TH_B, "s"), {"mode": "off", "cur": 200})
    told.clear()
    report(0x1002, {"SystemMode": 3})
    check("a mode the driver has no name for (cool) says nothing", size(told), 0)

    # the commands
    told.clear()
    tasmota.cmds.clear()
    drive(TH_B, {"do": "target", "v": 215})
    check_same("a target is written in degrees", last_zb()["Write"], {"OccupiedHeatingSetpoint": 21.5})
    check("and read back a moment after, as nothing else says what it was set to", tasmota.timers.contains("zbdriver_thermostat_" + TH_B), true)
    # Tasmota stacks the timers of one id: a second write before the first's read-back takes it out
    drive(TH_B, {"do": "target", "v": 220})
    check("a second write: one read-back of the id pending, not two", tasmota.timers.count("zbdriver_thermostat_" + TH_B), 1)
    tasmota.cmds.clear()
    tasmota.muted.clear()
    fire("zbdriver_thermostat_" + TH_B)
    var rd = last_zb()
    check_same("the read-back is a read of what the state is made of, quiet", [rd["Read"].contains("SystemMode"), rd["Read"].contains("OccupiedHeatingSetpoint"), size(tasmota.muted)], [true, true, 1])
    drive(TH_B, {"do": "mode", "v": "heat"})
    check_same("heat is SystemMode 4", last_zb()["Write"], {"SystemMode": 4})
    drive(TH_B, {"do": "mode", "v": "off"})
    check_same("and off is 0", last_zb()["Write"], {"SystemMode": 0})
    told.clear()
    var held = size(zb_cmds())
    drive(TH_B, {"do": "mode", "v": "auto"})
    check("auto is refused: a thermostat for heating has no changing over", [told[-1]["ZbDriver"][TH_B].find("e"), size(zb_cmds()) - held], ["refused", 0])
    told.clear()
    var before = size(zb_cmds())
    drive(TH_B, {"do": "mode", "v": "dry"})
    drive(TH_B, {"do": "target", "v": 305})
    drive(TH_B, {"do": "target", "v": 45})
    drive(TH_B, {"do": "setting", "k": "lock", "v": true})
    check("a mode it has not, a target past 30, and a setting a ZCL thermostat has none of: refused", [size(told), size(zb_cmds()) - before], [4, 0])

    # no settings: an empty schema, which says so
    told.clear()
    drive(TH_B, {"do": "settings"})
    check("a ZCL thermostat's schema is an empty list: the screen says it has none", [told[0]["ZbDriver"][TH_B]["x"]["of"], size(told[0]["ZbDriver"][TH_B]["x"]["l"])], [0, 0])
end
zcl_checks()

# --- the devices the network had, and a device that leaves -----------------------------------------------------
def network_checks()
    # a thermostat of a maker nothing knows, whose own report says what it is
    net.devices.push(FakeZ(TH_D, 0x1004, "Zed", "T4"))
    told.clear()
    report(0x1004, {"LocalTemperature": 20.0})
    check("a device by its own report: the driver has it, and its state is said", [host.claimed.contains(TH_D), collect(TH_D, "s").find("cur"), host.kept[TH_D]], [true, 200, "thermostat"])
    check("kept in the flash for the restarts", persist.store["zb_relay_drivers"][TH_D], "thermostat")

    # a lamp's report is nobody's
    told.clear()
    host.on_received({"0x2001": {"Device": "0x2001", "Power": 1, "Dimmer": 50}})
    fire("zbbridge_drivers_send")
    check("a lamp's report says nothing to the driver", size(told), 0)

    # a ZHT-SR the network already had: the scan finds it by its maker, and the link that comes up describes it
    net.devices.push(FakeZ(TH_E, 0x1005, "_TZE204_lpedvtvr", "TS0601"))
    told.clear()
    tasmota.cmds.clear()
    host.link_up()
    check("a ZHT-SR the network had before the driver is the driver's, by its maker", host.claimed.contains(TH_E), true)
    var heard = {}
    var n = 0
    while fire("zbbridge_drivers_announce") && n < 10
        n += 1
    end
    for ev: told
        for k: ev["ZbDriver"].keys() heard[k] = true end
    end
    check("every thermostat is described to the NSPanel again by the link that came up (the fifth is the one the defaults checked), and asked for its state", [heard.contains(TH_A), heard.contains(TH_B), heard.contains(TH_D), heard.contains(TH_E), size(heard)],
          [true, true, true, true, 5])
    check("and one of Tuya's is asked with a TuyaQuery, a ZCL one with a read", [size(zb_cmds()) >= 4, string.find(zb_cmds()[0] + zb_cmds()[1] + zb_cmds()[2] + zb_cmds()[3], "Read") > 0], [true, true])

    # a device that left the network: the driver is told, and forgets what it knew
    check("the driver knew the types of a ZHT-SR's datapoints", thermostat.types.contains(TH_A), true)
    net.devices.remove(net.devices.find(net.find(TH_A)))
    r.run("ZbForget 0x1001", "ESP-NOW")
    fire("zbbridge_drivers_check")
    check("a device that left: its types and its read-back go with it", [host.claimed.contains(TH_A), thermostat.types.contains(TH_A), thermostat.waiting.contains(TH_A)], [false, false, false])
end
network_checks()

# the alarm of the relay, as far as a driver sees it: what it is told of the commands the bridge sends
class FakeAlarm
    var told
    def init() self.told = [] end
    def commanded(line) self.told.push(line) end
end

# the alarm hears what the driver sends a thermostat, a read that goes quiet excepted: a read is no command and has no echo
def alarm_told_checks()
    var alarm = FakeAlarm()
    r.alarm = alarm
    tasmota.cmds.clear()
    tasmota.muted.clear()
    drive(TH_A, {"do": "target", "v": 215})
    drive(TH_B, {"do": "mode", "v": "heat"})
    var lines = zb_cmds()
    check("each command of the driver is told to the alarm before it goes, whole and in order", [size(lines) > 0, alarm.told], [true, lines])
    alarm.told.clear()
    tasmota.cmds.clear()
    thermostat.seed(host.info_for(TH_B), true)
    check("a read that runs in a loop is quiet and is not told", [size(zb_cmds()) > 0, size(tasmota.muted) > 0, alarm.told], [true, true, []])
    r.alarm = nil
end
alarm_told_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
