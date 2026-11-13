# berry/boiler_thermostat.be, a water heater's thermostat on the appliance that switches its heater: the hysteresis, the windows of the day, the
# safety, the probe that goes, a relay switched by another hand, the stop before a restart, and the exceptional mode with no clock, in and out.

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

var logged = []
log = def (msg, level) logged.push([msg, level]) end

# Tasmota as the thermostat reads it: the probe in the sensors' JSON, absent while it has no reading, and the relay
class BoilerTasmota : RelayTasmota
    var water, power, powered
    def init()
        super(self).init()
        self.power = false
        self.powered = []
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
end
tasmota = BoilerTasmota()

# the node the thermostat says itself through
class FakeNode
    var said, lists
    def init() self.said = [] self.lists = [] end
    def say(section, fields) self.said.push([section, fields]) end
    def send_list(section, entries)
        self.lists.push([section, entries])
        return true
    end
    def last(section)
        var i = size(self.said) - 1
        while i >= 0
            if self.said[i][0] == section return self.said[i][1] end
            i -= 1
        end
        return nil
    end
end

# a day at midnight, and the clock at an hour of it; 0 is no clock
var DAY0 = 20000 * 86400
def at_hour(h) tasmota.utc_now = DAY0 + h * 3600 + 120 end
def no_clock() tasmota.utc_now = 0 end

# a thermostat out of its box, its history in the test's own directory, the water as given (degrees, nil for no probe) and the relay off
def fresh(water)
    persist.zero()
    tasmota.water = water
    tasmota.power = false
    tasmota.powered = []
    tasmota.cmds.clear()
    var n = FakeNode()
    var t = BoilerThermostat(n)
    t.history = BoilerHistory(TEST_TMP + "/history.bin")
    return t
end
# one second with the water at `deg`: what the relay is after it
def second(t, deg)
    tasmota.water = deg
    t.tick()
    return tasmota.power
end

def box_checks()
    at_hour(12)
    var t = fresh(nil)
    check("out of its box: off, the two windows, the hysteresis, the ceiling and the heater's power",
          [t.cfg["mode"], t.cfg["w1s"], t.cfg["w1e"], t.cfg["w1t"], t.cfg["w2s"], t.cfg["w2e"], t.cfg["w2t"], t.cfg["hyst"], t.cfg["ceil"], t.cfg["calib"], t.cfg["power"]],
          ["off", 17, 21, 60, 5, 7, 50, 3, 75, 0, 3000])
    var d = t.describe()
    check("what a panel registers it with: a target and a mode, 30 to 70 degrees by one, off and heat, no floor probe, and what it measures",
          [d["caps"], d["min"], d["max"], d["step"], d["modes"], d["floor"], d["ep"], d["measure"]], [48, 300, 700, 10, ["off", "heat"], false, 1, "Water"])
    check("before its first second: the relay as Tasmota has it, no reading, no exception", [t.relay, t.water, t.exception], [false, nil, false])
    check("the calibration is Tasmota's temperature offset, set at the boot", tasmota.cmds, ["TempOffset", "TempOffset 0"])
    tasmota.replies["TempOffset"] = {"TempOffset": 0.0}
    tasmota.cmds.clear()
    BoilerThermostat(FakeNode())
    check("and left alone when it is the one kept", tasmota.cmds, ["TempOffset"])
    tasmota.replies.remove("TempOffset")
end
box_checks()

def window_checks()
    check("a window is from an hour up to another", [BoilerThermostat.within(17, 17, 21), BoilerThermostat.within(20, 17, 21), BoilerThermostat.within(21, 17, 21),
          BoilerThermostat.within(16, 17, 21)], [true, true, false, false])
    check("past midnight when the second comes first", [BoilerThermostat.within(23, 22, 6), BoilerThermostat.within(0, 22, 6), BoilerThermostat.within(5, 22, 6),
          BoilerThermostat.within(6, 22, 6), BoilerThermostat.within(12, 22, 6)], [true, true, true, false, false])
    check("the whole day from 0 to 24, and none when the two are the same", [BoilerThermostat.within(0, 0, 24), BoilerThermostat.within(23, 0, 24),
          BoilerThermostat.within(9, 9, 9), BoilerThermostat.within(0, 0, 0)], [true, true, false, false])
    at_hour(12)
    var t = fresh(40.0)
    check("the window in force, the first when both hold, and none outside both", [t.window_in(18), t.window_in(6), t.window_in(12), t.window_in(21)], [1, 2, nil, nil])
    check("the window a panel sees and sets: the one in force, or the next to begin", [t.window_at(18), t.window_at(6), t.window_at(12), t.window_at(22), t.window_at(2)],
          [1, 2, 1, 2, 2])
    t.cfg["w2e"] = 5
    check("a window that is none never begins", [t.window_in(6), t.window_at(22), t.window_at(2)], [nil, 1, 1])
    t.cfg["w1e"] = 17
    check("with no window at all, the first is the one seen", [t.window_at(12), t.window_at(nil)], [1, 1])
    t.cfg["w2s"] = 0
    t.cfg["w2e"] = 24
    t.cfg["w1e"] = 21
    check("where both hold, the first one's target is the one", [t.window_in(18), t.window_in(3)], [1, 2])
end
window_checks()

def logic_checks()
    at_hour(18)
    var t = fresh(58.0)
    check("in the mode off the heater stays off, however cold the water", [second(t, 58.0), second(t, 20.0), tasmota.powered], [false, false, []])
    t.cfg["mode"] = "heat"
    check("in a window, above the target less the hysteresis: off", second(t, 57.1), false)
    check("at the target less the hysteresis: on", [second(t, 57.0), tasmota.powered], [true, [[0, true]]])
    check("it stays on up to the target", [second(t, 58.5), second(t, 59.9)], [true, true])
    check("and goes off at it", [second(t, 60.0), tasmota.powered[-1]], [false, [0, false]])
    check("it stays off down to the target less the hysteresis", [second(t, 59.0), second(t, 57.1), size(tasmota.powered)], [false, false, 2])
    check("and comes on again there", second(t, 56.9), true)
    # the hours
    at_hour(21)
    check("the window over: off, whatever the water", [second(t, 30.0), second(t, 30.0)], [false, false])
    at_hour(12)
    check("outside both windows: off", second(t, 30.0), false)
    at_hour(6)
    check("the second window has its own target", [second(t, 47.1), second(t, 47.0), second(t, 49.9), second(t, 50.0)], [false, true, true, false])
    # the safety
    at_hour(18)
    check("with no reading of the probe the heater is off", [second(t, 40.0), second(t, nil), t.state()["up"], t.state()["note"]], [true, false, false, "No probe"])
    check("the probe back: on again, by the same rule", [second(t, 40.0), t.state()["up"], t.state()["note"]], [true, true, ""])
    t.cfg["ceil"] = 55
    check("at the ceiling the heater is off, below the target as it may be", [second(t, 54.9), second(t, 55.0), second(t, 56.0)], [true, false, false])
    t.cfg["ceil"] = 75
    var cold = fresh(nil)
    cold.cfg["mode"] = "heat"
    tasmota.power = true
    cold.relay = true
    check("a boot that finds the relay on with no reading yet turns it off", [second(cold, nil), tasmota.powered], [false, [[0, false]]])
    check("the probe's reading is in tenths of a degree, to the nearest, and nil for what is no number",
          [second(t, 57.04), t.water, second(t, 56.96), t.water, second(t, -1.26), t.water], [true, 570, true, 570, true, -13])
end
logic_checks()

def outside_checks()
    at_hour(18)
    var t = fresh(40.0)
    second(t, 40.0)
    logged.clear()
    tasmota.power = true
    check("a relay another hand turned on is the mode heat: it stays on with the water cold", [second(t, 40.0), t.cfg["mode"], tasmota.powered], [true, "heat", []])
    check("said in the log", logged[0], ["BOILER: the relay switched from outside: the mode is heat", 2])
    tasmota.power = false
    check("and one turned off is the mode off", [second(t, 40.0), t.cfg["mode"], tasmota.powered], [false, "off", []])
    tasmota.power = true
    check("turned on with the water at the target: the mode is heat, and the logic turns the relay off again",
          [second(t, 61.0), t.cfg["mode"], tasmota.powered], [false, "heat", [[0, false]]])
    check("the mode goes to the flash", persist.find("boiler")["mode"], "heat")
end
outside_checks()

def stop_checks()
    import path
    at_hour(18)
    var t = fresh(40.0)
    t.cfg["mode"] = "heat"
    check("heating", second(t, 40.0), true)
    path.renamed.clear()
    t.history.put(DAY0 / 300, 80, 1)
    tasmota.timers.clear()
    t.keep()
    t.stop()
    check("the node is about to restart: the heater off", [tasmota.power, tasmota.powered[-1], t.stopped], [false, [0, false], true])
    check("the history written, and the settings with no wait", [size(path.renamed), tasmota.timers.contains("boiler_save")], [1, false])
    check("and it stays off, cold as the water is", [second(t, 30.0), second(t, 30.0)], [false, false])
    tasmota.power = true
    check("a relay another hand turns on then is no mode asked for", [second(t, 30.0), t.cfg["mode"]], [true, "heat"])
    tasmota.power = false
end
stop_checks()

def exception_checks()
    no_clock()
    var t = fresh(50.0)
    t.cfg["mode"] = "heat"
    logged.clear()
    check("with no clock the first window's target is held: on below it less the hysteresis", [second(t, 57.0), t.exception, t.signal()], [true, true, true])
    check("said in the log, once", [logged.find(["BOILER: no clock: the first window's target is held until there is one", 2]) != nil, size(logged)], [true, 2])
    check("with the same hysteresis", [second(t, 60.0), second(t, 58.0), second(t, 57.0)], [false, false, true])
    var s = t.state()
    check("the state says it in its note, and shows the first window's target", [s["note"], s["set"], s["mode"], s["dem"]], ["No clock", 600, "heat", 100])
    var x = t.schema()
    check("the settings have a first row that is only read and says the target held",
          [size(x), x[0], t.values()["held"]], [11, {"k": "held", "l": "No clock: holding", "t": "n", "min": 30, "max": 70, "u": "°", "w": 0}, 60])
    check("the telemetry says it", t.telemetry(), ",\"Boiler\":{\"Mode\":\"heat\",\"Target\":60,\"Heating\":1,\"NoClock\":1}")
    check("the ceiling and the probe hold as ever", [second(t, 76.0), second(t, nil), second(t, 50.0)], [false, false, true])
    t.cfg["mode"] = "off"
    check("and the mode off", second(t, 50.0), false)
    t.cfg["mode"] = "heat"
    second(t, 50.0)
    # a panel has the settings on show when the clock comes
    t.command({"do": "settings"})
    var lists = size(t.host.lists)
    logged.clear()
    at_hour(12)
    check("the clock comes, outside the windows: the heater off, the mode left by itself", [second(t, 50.0), t.exception, t.signal(), t.state()["note"]], [false, false, false, ""])
    check("said in the log", logged.find(["BOILER: the clock is set: the windows hold again", 2]) != nil, true)
    check("the panel that has the settings on show hears them again, with no first row",
          [size(t.host.lists), size(t.host.lists[-1][1]), t.host.lists[-1][1][0]["k"], t.values().contains("held")], [lists + 1, 10, "w1s", false])
    check("and the telemetry", t.telemetry(), ",\"Boiler\":{\"Mode\":\"heat\",\"Target\":60,\"Heating\":0,\"NoClock\":0}")
    # one that asked long ago hears nothing
    tasmota.at_ms = BoilerThermostat.ASKED_MS + 5
    no_clock()
    lists = size(t.host.lists)
    second(t, 50.0)
    check("a panel that asked long ago is not told", size(t.host.lists), lists)
    tasmota.at_ms = nil
    # the history has the time with no clock
    var h = fresh(50.0)
    no_clock()
    var i = 0
    while i < 301
        second(h, 50.0)
        i += 1
    end
    check("the history keeps the slots of the time with no clock, to place when the clock comes", [size(h.history.pending), h.history.last], [1, nil])
end
exception_checks()

def command_checks()
    at_hour(18)
    var t = fresh(50.0)
    second(t, 50.0)
    check("a target out of the range, off the step or no number is refused",
          [t.command({"do": "target", "v": 290}), t.command({"do": "target", "v": 710}), t.command({"do": "target", "v": 605}), t.command({"do": "target", "v": "600"}),
           t.command({"do": "target"}), t.cfg["w1t"]], [false, false, false, false, false, 60])
    t.host.said.clear()
    check("a target in a window is that window's from then on", [t.command({"do": "target", "v": 550}), t.cfg["w1t"], t.cfg["w2t"]], [true, 55, 50])
    check("the state and the values are said after it", [t.host.last("s")["set"], t.host.last("v")["w1t"]], [550, 55])
    at_hour(2)
    check("outside the windows it is the next one's", [t.command({"do": "target", "v": 480}), t.cfg["w1t"], t.cfg["w2t"], t.state()["set"]], [true, 55, 48, 480])
    at_hour(18)
    check("the mode: heat acts at once", [t.command({"do": "mode", "v": "heat"}), tasmota.power, t.host.last("s")["mode"], t.host.last("s")["dem"]], [true, true, "heat", 100])
    check("and off", [t.command({"do": "mode", "v": "off"}), tasmota.power, t.host.last("s")["dem"]], [true, false, 0])
    check("no other mode", [t.command({"do": "mode", "v": "cool"}), t.command({"do": "mode"}), t.cfg["mode"]], [false, false, "off"])
    check("a setting takes a whole number in its range",
          [t.command({"do": "setting", "k": "hyst", "v": 5}), t.cfg["hyst"], t.command({"do": "setting", "k": "hyst", "v": 0}), t.command({"do": "setting", "k": "hyst", "v": 11}),
           t.command({"do": "setting", "k": "hyst", "v": "5"}), t.command({"do": "setting", "k": "w1e", "v": 24}), t.cfg["w1e"], t.cfg["hyst"]],
          [true, 5, false, false, false, true, 24, 5])
    check("only one the table has: not the mode, not the row that is only read, not a key nobody knows",
          [t.command({"do": "setting", "k": "mode", "v": "heat"}), t.command({"do": "setting", "k": "held", "v": 50}), t.command({"do": "setting", "k": "x", "v": 1}),
           t.command({"do": "setting", "v": 1})], [false, false, false, false])
    tasmota.cmds.clear()
    check("the calibration goes to Tasmota's temperature offset", [t.command({"do": "setting", "k": "calib", "v": -2}), tasmota.cmds], [true, ["TempOffset", "TempOffset -2"]])
    t.command({"do": "mode", "v": "heat"})
    check("a setting acts at once: a window that ends now turns the heater off", [tasmota.power, t.command({"do": "setting", "k": "w1e", "v": 18}), tasmota.power], [true, true, false])
    t.host.lists.clear()
    t.host.said.clear()
    check("the settings: the schema as a list, and the values", [t.command({"do": "settings"}), t.host.lists[0][0], size(t.host.lists[0][1]), t.host.last("v")],
          [true, "x", 10, {"w1s": 17, "w1e": 18, "w1t": 55, "w2s": 5, "w2e": 7, "w2t": 48, "hyst": 5, "ceil": 75, "calib": -2, "power": 3000}])
    check("a setting as a panel lists it", [t.host.lists[0][1][0], t.host.lists[0][1][8], t.host.lists[0][1][9]],
          [{"k": "w1s", "l": "Window 1 from", "t": "r", "min": 0, "max": 23, "u": ":00"}, {"k": "calib", "l": "Calibration", "t": "r", "min": -5, "max": 5, "u": "°"},
           {"k": "power", "l": "Heater power", "t": "n", "min": 500, "max": 9000, "u": " W"}])
    t.host.said.clear()
    check("a read says the state", [t.command({"do": "read"}), t.host.last("s") != nil], [true, true])
    check("what is no verb of it is not taken", [t.command({"do": "open"}), t.command({})], [false, false])
end
command_checks()

def say_checks()
    at_hour(12)
    var t = fresh(50.0)
    second(t, 50.0)
    var s = t.host.last("s")
    check("the whole state every second, for the node to say what changed", [s["cur"], s["set"], s["mode"], s["dem"], s["up"], s["note"], size(s)], [500, 600, "off", 0, true, "", 6])
    second(t, 50.2)
    check("the water within a few tenths of what was said is said as it was", t.host.last("s")["cur"], 500)
    second(t, 50.3)
    check("three tenths away it is said", t.host.last("s")["cur"], 503)
    var i = 0
    while i < BoilerThermostat.CUR_AGAIN_S - 1
        second(t, 50.4)
        i += 1
    end
    check("a tenth away it waits", t.host.last("s")["cur"], 503)
    second(t, 50.4)
    check("and is said a minute after the last", t.host.last("s")["cur"], 504)
    second(t, nil)
    check("with no reading the state has no water, and says the probe is gone", [t.host.last("s").contains("cur"), t.host.last("s")["up"]], [false, false])
end
say_checks()

def keep_checks()
    at_hour(18)
    var t = fresh(50.0)
    tasmota.timers.clear()
    t.command({"do": "target", "v": 620})
    t.command({"do": "setting", "k": "power", "v": 4500})
    check("what changes goes to the flash a moment later, once", [persist.find("boiler")["w1t"], persist.find("boiler")["power"], tasmota.timers.count("boiler_save"),
          tasmota.timers.delay_of("boiler_save")], [62, 4500, 1, BoilerThermostat.SAVE_MS])
    tasmota.timers.fire("boiler_save")
    var again = BoilerThermostat(FakeNode())
    check("and a boot has it back", [again.cfg["w1t"], again.cfg["power"], again.cfg["mode"]], [62, 4500, "off"])
    persist.setmember("boiler", {"mode": "cool", "w1t": 95, "hyst": "x", "ceil": 70, "other": 1})
    var odd = BoilerThermostat(FakeNode())
    check("what the flash keeps that is no value of a setting is not taken", [odd.cfg["mode"], odd.cfg["w1t"], odd.cfg["hyst"], odd.cfg["ceil"], odd.cfg.contains("other")],
          ["off", 60, 3, 70, false])
    persist.setmember("boiler", "x")
    check("nor what is no map", BoilerThermostat(FakeNode()).cfg["w1t"], 60)
    persist.zero()
end
keep_checks()

def show_checks()
    at_hour(18)
    var t = fresh(58.0)
    second(t, 58.0)
    check("its rows of the node's Main settings: the water and the heater", t.rows(), [["Water", "58.0°", 0, 0], ["Heater", "Off", 0, 0]])
    t.cfg["mode"] = "heat"
    second(t, 40.0)
    second(t, nil)
    check("with no probe", t.rows(), [["Water", "No probe", 0, 0], ["Heater", "Off", 0, 0]])
    check("a temperature as text", [BoilerThermostat.degrees(580), BoilerThermostat.degrees(5), BoilerThermostat.degrees(-13), BoilerThermostat.degrees(nil)],
          ["58.0°", "0.5°", "-1.3°", "?"])
    check("the telemetry, as Tasmota's sensors' JSON takes it", json.load("{\"Time\":1" + t.telemetry() + "}")["Boiler"],
          {"Mode": "heat", "Target": 60, "Heating": 0, "NoClock": 0})
end
show_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
