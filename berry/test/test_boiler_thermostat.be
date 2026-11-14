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
    var said, lists, again, warned
    def init() self.said = [] self.lists = [] self.again = 0 self.warned = [] end
    def warn(kind, on) self.warned.push([kind, on]) end
    def say(section, fields) self.said.push([section, fields]) end
    def described() self.again += 1 end
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
    # what its boot commanded of the relay is box_checks' to look at
    tasmota.powered = []
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
    check("and the lowest and the highest a target is set to", t.limits(), [30, 70])
    check("the day has those two windows, and the ones it may come to have are there with no hours",
          [t.cfg["wn"], BoilerThermostat.COUNT[4], t.hours_of(3), t.hours_of(4), t.cfg["w3t"], t.cfg["w4t"]], [2, 4, [0, 0], [0, 0], 50, 50])
    var d = t.describe()
    check("what a panel registers it with: a target and a mode, the range the two limits, 30 to 70 degrees by one, off and heat, no floor probe, and what it measures",
          [d["caps"], d["min"], d["max"], d["step"], d["modes"], d["floor"], d["ep"], d["measure"]], [48, 300, 700, 10, ["off", "heat"], false, 1, "Water"])
    check("before its first second: the relay open, no reading, no exception", [t.relay, t.water, t.exception], [false, nil, false])
    check("the calibration is Tasmota's temperature offset, set at the boot", tasmota.cmds, ["TempOffset", "TempOffset 0"])
    tasmota.replies["TempOffset"] = {"TempOffset": 0.0}
    tasmota.cmds.clear()
    BoilerThermostat(FakeNode())
    check("and left alone when it is the one kept", tasmota.cmds, ["TempOffset"])
    tasmota.replies.remove("TempOffset")
    tasmota.power = true
    tasmota.powered = []
    var found_on = BoilerThermostat(FakeNode())
    check("a boot opens the relay, one Tasmota has as closed", [tasmota.powered, tasmota.power, found_on.relay], [[[0, false]], false, false])
    tasmota.powered = []
    var found_off = BoilerThermostat(FakeNode())
    check("and one it has as open, which a crash may have left closed: the latching relay says nothing of where it is",
          [tasmota.powered, found_off.relay], [[[0, false]], false])
    tasmota.powered = []
    tasmota.cmds.clear()
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
    # as many windows as the count says
    t = fresh(40.0)
    t.cfg["w3s"] = 12
    t.cfg["w3e"] = 14
    check("a window past the count is none of the day's", [t.window_in(13), t.window_at(10)], [nil, 1])
    t.cfg["wn"] = 3
    check("a third window, in force in its hours and the next to begin before them", [t.window_in(13), t.window_at(13), t.window_at(10), t.window_at(15), t.window_at(22)],
          [3, 3, 3, 1, 2])
    t.cfg["w4s"] = 12
    t.cfg["w4e"] = 13
    t.cfg["wn"] = 4
    check("of two that begin at the same hour, the first", [t.window_in(12), t.window_at(10)], [3, 3])
    t.cfg["wn"] = 1
    check("with one window, only it", [t.window_in(18), t.window_in(6), t.window_at(6), t.window_at(22)], [1, nil, 1, 1])
    t.cfg["wn"] = 0
    check("with none, no hour is in a window, and the first target is the one seen", [t.window_in(18), t.window_in(6), t.window_at(18), t.window_at(nil)], [nil, nil, 1, 1])
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
          [size(x), x[0], t.values()["held"]], [19, {"k": "held", "l": "No clock: holding", "t": "n", "min": 30, "max": 70, "u": "°", "w": 0}, 60])
    check("the telemetry says it", t.telemetry(), ",\"Boiler\":{\"Mode\":\"heat\",\"Target\":60,\"Heating\":1,\"NoClock\":1,\"Alert\":\"\"}")
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
          [size(t.host.lists), size(t.host.lists[-1][1]), t.host.lists[-1][1][0]["k"], t.values().contains("held")], [lists + 1, 18, "hist", false])
    check("and the telemetry", t.telemetry(), ",\"Boiler\":{\"Mode\":\"heat\",\"Target\":60,\"Heating\":0,\"NoClock\":0,\"Alert\":\"\"}")
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
    check("only one the table has: not the mode, not the row that is only read, not a key nobody knows, not a window the day does not have",
          [t.command({"do": "setting", "k": "mode", "v": "heat"}), t.command({"do": "setting", "k": "held", "v": 50}), t.command({"do": "setting", "k": "x", "v": 1}),
           t.command({"do": "setting", "v": 1}), t.command({"do": "setting", "k": "w3s", "v": 12}), t.cfg["w3s"]], [false, false, false, false, false, 0])
    tasmota.cmds.clear()
    check("the calibration goes to Tasmota's temperature offset", [t.command({"do": "setting", "k": "calib", "v": -2}), tasmota.cmds], [true, ["TempOffset", "TempOffset -2"]])
    t.command({"do": "mode", "v": "heat"})
    check("a setting acts at once: a window that ends now turns the heater off", [tasmota.power, t.command({"do": "setting", "k": "w1e", "v": 18}), tasmota.power], [true, true, false])
    t.host.lists.clear()
    t.host.said.clear()
    check("the settings: the schema as a list, and the values", [t.command({"do": "settings"}), t.host.lists[0][0], size(t.host.lists[0][1]), t.host.last("v")],
          [true, "x", 18, {"wn": 2, "w1s": 17, "w1e": 18, "w1t": 55, "w2s": 5, "w2e": 7, "w2t": 48, "lmin": 30, "lmax": 70, "hyst": 5, "ceil": 75, "calib": -2,
                           "power": 3000, "chks": 0, "chke": 5, "chkd": 1, "nht": 120}])
    check("a setting as a panel lists it: the row that opens the history, which is no setting, how many windows, each window's, and the rest",
          [t.host.lists[0][1][0], t.host.lists[0][1][1], t.host.lists[0][1][2], t.host.lists[0][1][6], t.host.lists[0][1][12], t.host.lists[0][1][13]],
          [{"k": "hist", "l": "History", "t": "h"}, {"k": "wn", "l": "Windows", "t": "r", "min": 0, "max": 4, "u": ""}, {"k": "w1s", "l": "Window 1 from", "t": "r", "min": 0, "max": 23, "u": ":00"},
           {"k": "w2e", "l": "Window 2 to", "t": "r", "min": 0, "max": 24, "u": ":00"}, {"k": "calib", "l": "Calibration", "t": "r", "min": -5, "max": 5, "u": "°"},
           {"k": "power", "l": "Heater power", "t": "n", "min": 500, "max": 9000, "u": " W"}])
    check("the two limits under a Zigbee thermostat's keys and words, and a window's target between them as they are set",
          [t.host.lists[0][1][8], t.host.lists[0][1][9], t.host.lists[0][1][4]],
          [{"k": "lmin", "l": "Operating min", "t": "n", "min": 20, "max": 45, "u": "°"}, {"k": "lmax", "l": "Operating max", "t": "n", "min": 50, "max": 75, "u": "°"},
           {"k": "w1t", "l": "Window 1 target", "t": "n", "min": 30, "max": 70, "u": "°"}])
    t.host.said.clear()
    check("a read says the state", [t.command({"do": "read"}), t.host.last("s") != nil], [true, true])
    check("what is no verb of it is not taken", [t.command({"do": "open"}), t.command({})], [false, false])
end
command_checks()

# The lowest and the highest a target is set to are two settings, and the range the thermostat is described with: a target is taken within them,
# a limit that moves takes the windows' targets inside it, and the node is told the thermostat is another to the panels
def limit_checks()
    at_hour(18)
    var t = fresh(50.0)
    second(t, 50.0)
    t.host.lists.clear()
    check("the highest lowered to 65: taken, the range a panel is told goes with it, and the targets under it stay",
          [t.command({"do": "setting", "k": "lmax", "v": 65}), t.limits(), t.describe()["min"], t.describe()["max"], t.cfg["w1t"], t.cfg["w2t"]],
          [true, [30, 65], 300, 650, 60, 50])
    check("the node is told the thermostat is another, once, and a panel with the settings on show hears their new ends",
          [t.host.again, size(t.host.lists), t.host.lists[-1][1][4]["max"], t.host.last("v")["lmax"]], [1, 1, 65, 65])
    check("to 55: the first window's target, above it, comes down to it, and the state says it",
          [t.command({"do": "setting", "k": "lmax", "v": 55}), t.cfg["w1t"], t.cfg["w2t"], t.host.last("s")["set"], t.host.last("v")["w1t"], t.host.again],
          [true, 55, 50, 550, 55, 2])
    check("a target past the limit is refused, on the page and in the settings, and one at it taken",
          [t.command({"do": "target", "v": 560}), t.command({"do": "setting", "k": "w2t", "v": 56}), t.command({"do": "target", "v": 550}),
           t.command({"do": "setting", "k": "w2t", "v": 55}), t.cfg["w1t"], t.cfg["w2t"]], [false, false, true, true, 55, 55])
    check("the lowest raised to 45: nothing under it, and a target under it is refused from then on",
          [t.command({"do": "setting", "k": "lmin", "v": 45}), t.cfg["w1t"], t.command({"do": "target", "v": 440}), t.command({"do": "setting", "k": "w2t", "v": 44}),
           t.describe()["min"]], [true, 55, false, false, 450])
    check("a limit takes what its own row does: the lowest 20 to 45, the highest 50 to 75",
          [t.command({"do": "setting", "k": "lmin", "v": 46}), t.command({"do": "setting", "k": "lmin", "v": 19}), t.command({"do": "setting", "k": "lmax", "v": 49}),
           t.command({"do": "setting", "k": "lmax", "v": 76}), t.limits()], [false, false, false, false, [45, 55]])
    var told = t.host.again
    check("the limit it has, set again, describes nothing again", [t.command({"do": "setting", "k": "lmax", "v": 55}), t.host.again], [true, told])
    check("nor does a setting that is no limit", [t.command({"do": "setting", "k": "hyst", "v": 4}), t.host.again], [true, told])
    persist.setmember("boiler", {"lmin": 40, "lmax": 50, "w1t": 60, "w2t": 30})
    var kept = BoilerThermostat(FakeNode())
    check("at a boot, a target the flash keeps outside the limits it keeps is brought to them", [kept.limits(), kept.cfg["w1t"], kept.cfg["w2t"]], [[40, 50], 50, 40])
    persist.setmember("boiler", {"lmin": 45, "lmax": 70, "wn": 0})
    kept = BoilerThermostat(FakeNode())
    check("and the target of a window the day does not have", [kept.cfg["wn"], kept.cfg["w3t"], kept.cfg["w4t"], kept.cfg["w2t"]], [0, 50, 50, 50])
    persist.setmember("boiler", {"lmin": 30, "lmax": 50, "w4t": 60})
    kept = BoilerThermostat(FakeNode())
    check("above the highest as below the lowest", kept.cfg["w4t"], 50)
    persist.zero()
end
limit_checks()

# The day has as many windows as a setting says, from none to four. Their settings are the ones a panel lists; more of them is a window with no
# hours until it is given some, fewer is the last ones not followed and kept as they were. With none, one target holds at every hour
def count_checks()
    at_hour(12)
    var t = fresh(40.0)
    t.command({"do": "mode", "v": "heat"})
    check("at noon, outside the two windows, the heater is off with the water cold", [second(t, 40.0), t.state()["set"]], [false, 600])
    t.host.lists.clear()
    t.host.said.clear()
    check("no window: taken, and the heater comes on at once, at an hour no window had", [t.command({"do": "setting", "k": "wn", "v": 0}), tasmota.power, t.cfg["wn"]],
          [true, true, 0])
    var x = t.host.lists[-1][1]
    check("a panel with the settings on show hears them again: the count, the one target where the windows were, and the rest",
          [size(t.host.lists), size(x), x[1]["k"], x[2], x[3]["k"]], [1, 13, "wn", {"k": "w1t", "l": "Target", "t": "n", "min": 30, "max": 70, "u": "°"}, "lmin"])
    check("and their values, with no window's hours among them", [t.host.last("v")["wn"], t.host.last("v")["w1t"], t.host.last("v").contains("w1s"), size(t.host.last("v"))],
          [0, 60, false, 12])
    check("the target holds at every hour, with the hysteresis as ever", [second(t, 59.9), second(t, 60.0), second(t, 57.1), second(t, 57.0)], [true, false, false, true])
    at_hour(3)
    check("in the small hours as at noon", [second(t, 57.0), second(t, 60.0), second(t, 57.0)], [true, false, true])
    check("the target set on the page is that one", [t.command({"do": "target", "v": 550}), t.cfg["w1t"], t.state()["set"], tasmota.power], [true, 55, 550, false])
    check("the ceiling, the probe and the mode off hold as ever", [second(t, 40.0), second(t, 76.0), second(t, 40.0), second(t, nil), second(t, 40.0),
          t.command({"do": "mode", "v": "off"}), tasmota.power], [true, false, true, false, true, true, false])
    t.command({"do": "mode", "v": "heat"})
    no_clock()
    check("with no clock it holds the same, and there is no row of a target held for want of one: the target's own row says it",
          [second(t, 40.0), t.exception, t.schema()[1]["k"], t.values().contains("held")], [true, true, "wn", false])
    # one window
    at_hour(6)
    second(t, 40.0)
    t.host.lists.clear()
    check("one window: the first, as it was left", [t.command({"do": "setting", "k": "wn", "v": 1}), size(t.host.lists[-1][1]), t.host.lists[-1][1][4]["l"],
          t.host.lists[-1][1][5]["k"]], [true, 15, "Window 1 target", "lmin"])
    check("in the second one's hours the heater is off", [second(t, 30.0), t.state()["set"]], [false, 550])
    at_hour(18)
    check("and on in its own", second(t, 30.0), true)
    # more windows
    at_hour(13)
    t.host.lists.clear()
    check("three windows: the third is listed, with no hours yet, and changes nothing",
          [t.command({"do": "setting", "k": "wn", "v": 3}), size(t.host.lists[-1][1]), t.host.lists[-1][1][8], t.host.last("v")["w3s"], t.host.last("v")["w3e"],
           t.host.last("v")["w3t"], second(t, 30.0)],
          [true, 21, {"k": "w3s", "l": "Window 3 from", "t": "r", "min": 0, "max": 23, "u": ":00"}, 0, 0, 50, false])
    check("given hours and a target, it is followed", [t.command({"do": "setting", "k": "w3s", "v": 12}), t.command({"do": "setting", "k": "w3e", "v": 14}),
          t.command({"do": "setting", "k": "w3t", "v": 45}), tasmota.power, t.state()["set"], second(t, 44.9), second(t, 45.0)], [true, true, true, true, 450, true, false])
    check("the target set on the page in its hours is its own", [t.command({"do": "target", "v": 460}), t.cfg["w3t"], t.cfg["w1t"]], [true, 46, 55])
    var lists = size(t.host.lists)
    check("the count it has, set again, sends no list", [t.command({"do": "setting", "k": "wn", "v": 3}), size(t.host.lists)], [true, lists])
    check("back to two: the third is not followed, nor set", [t.command({"do": "setting", "k": "wn", "v": 2}), second(t, 30.0), t.command({"do": "setting", "k": "w3s", "v": 9}),
          size(t.host.lists[-1][1])], [true, false, false, 18])
    check("and is there as it was left when the day has three again", [t.command({"do": "setting", "k": "wn", "v": 3}), t.host.last("v")["w3s"], t.host.last("v")["w3t"],
          second(t, 30.0)], [true, 12, 46, true])
    check("four at the most", [t.command({"do": "setting", "k": "wn", "v": 4}), size(t.host.lists[-1][1]), t.command({"do": "setting", "k": "wn", "v": 5}),
          t.command({"do": "setting", "k": "wn", "v": -1}), t.cfg["wn"]], [true, 24, false, false, 4])
    check("the count goes to the flash with the rest", persist.find("boiler")["wn"], 4)
    # the stuck contact's check with no window: a night the heater worked in is not judged
    t = fresh(50.0)
    t.cfg["mode"] = "heat"
    t.cfg["wn"] = 0
    at_hour(1)
    check("with no window the heater may work in the check's hours, and those are not judged", [second(t, 50.0), t.chk], [true, false])
end
count_checks()

# The relay is a latching one and the board measures no current: what is known of it is what the water does. It is opened again every minute
# while the logic has it open; a contact stuck closed is told from the water in the hours with no sun; and a heater that does not heat from the
# water that never rises. Each is a warning: in the note, in the telemetry, and told to the house through the node
def relay_checks()
    at_hour(12)
    var t = fresh(50.0)
    var i = 0
    while i < BoilerThermostat.REOPEN_S - 1
        second(t, 50.0)
        i += 1
    end
    check("the relay is left alone between two of its minutes", tasmota.powered, [])
    second(t, 50.0)
    check("and opened again every minute while the logic has it open, as it is", [tasmota.powered, tasmota.power], [[[0, false]], false])
    t.cfg["mode"] = "heat"
    at_hour(18)
    tasmota.powered = []
    i = 0
    while i < BoilerThermostat.REOPEN_S + 5
        second(t, 50.0)
        i += 1
    end
    check("with the heater on, nothing opens it", [tasmota.powered, tasmota.power], [[[0, true]], true])
    check("the settings of the checks, out of the box: the hours with no sun, a degree, two hours",
          [t.cfg["chks"], t.cfg["chke"], t.cfg["chkd"], t.cfg["nht"]], [0, 5, 1, 120])

    # a contact stuck closed, by the water that does not fall in the hours with no sun
    t = fresh(60.0)
    at_hour(23)
    second(t, 60.0)
    check("outside its hours nothing is being checked", [t.chk, t.alerts["stuck"]], [nil, false])
    at_hour(0)
    second(t, 60.0)
    second(t, 59.8)
    check("in them, with the heater off: the water at their start, the lowest and the last", t.chk, [600, 598, 598, false])
    at_hour(4)
    second(t, 58.5)
    at_hour(5)
    second(t, 58.5)
    check("a night the water fell a degree and a half: nothing to say", [t.chk, t.alerts["stuck"], t.host.warned, t.state()["note"]], [nil, false, [], ""])
    at_hour(0)
    second(t, 58.5)
    at_hour(4)
    second(t, 58.0)
    at_hour(5)
    logged.clear()
    second(t, 58.0)
    check("a night it fell half a degree, less than the setting says: the relay may be stuck, told to the house and in the note",
          [t.alerts["stuck"], t.host.warned, t.state()["note"], logged.find(["BOILER: the relay may be stuck closed", 2]) != nil], [true, [["stuck", true]], "Relay stuck?", true])
    check("and in the telemetry, with the target of the window that begins at that hour", t.telemetry(),
          ",\"Boiler\":{\"Mode\":\"off\",\"Target\":50,\"Heating\":0,\"NoClock\":0,\"Alert\":\"stuck\"}")
    second(t, 58.0)
    check("said once", t.host.warned, [["stuck", true]])
    at_hour(0)
    second(t, 58.0)
    at_hour(4)
    second(t, 55.0)
    at_hour(5)
    second(t, 55.0)
    check("the next night it falls as it should: the warning is over, and the house is told", [t.alerts["stuck"], t.host.warned[-1], t.state()["note"]], [false, ["stuck", false], ""])
    # the water that rises in those hours, with the heater off: only the heater does that
    t = fresh(50.0)
    at_hour(1)
    second(t, 50.0)
    second(t, 49.5)
    second(t, 50.4)
    check("a rise of less than a degree from the lowest is no sign", t.alerts["stuck"], false)
    second(t, 50.5)
    check("a degree above the lowest it was, in those hours: warned of at once", [t.alerts["stuck"], t.host.warned], [true, [["stuck", true]]])
    at_hour(5)
    second(t, 45.0)
    check("and the hours' end does not take it back, however far the water fell after", [t.alerts["stuck"], t.chk], [true, nil])
    # hours that are not judged
    t = fresh(50.0)
    t.cfg["mode"] = "heat"
    t.cfg["w2s"] = 3
    at_hour(2)
    second(t, 40.0)
    at_hour(3)
    check("a window of the logic's in the check's hours: the heater on, and those hours are not judged", [second(t, 40.0), t.chk], [true, false])
    at_hour(4)
    second(t, 55.0)
    at_hour(5)
    second(t, 55.0)
    check("whatever the water did in them", [t.alerts["stuck"], t.chk], [false, nil])
    t = fresh(nil)
    at_hour(1)
    second(t, nil)
    check("nor are hours with no reading of the probe", t.chk, false)
    no_clock()
    t = fresh(50.0)
    second(t, 50.0)
    check("nor is anything checked with no clock", t.chk, nil)
    t = fresh(50.0)
    at_hour(1)
    second(t, 50.0)
    second(t, 51.0)
    check("a warning held", t.alerts["stuck"], true)
    t.command({"do": "setting", "k": "chke", "v": 0})
    second(t, 51.0)
    check("goes with the check, when its two hours are made the same: no check", [t.alerts["stuck"], t.host.warned[-1]], [false, ["stuck", false]])

    # a heater that does not heat
    at_hour(18)
    t = fresh(40.0)
    t.cfg["mode"] = "heat"
    t.cfg["nht"] = 2
    check("the heater on, the water where it was", [second(t, 40.0), t.on_low, t.on_secs], [true, 400, 1])
    i = 0
    while i < 118
        second(t, 39.5)
        i += 1
    end
    check("the water falling with the heater on is hot water drawn, and no sign yet", [t.alerts["noheat"], t.on_low, t.on_secs], [false, 395, 119])
    logged.clear()
    second(t, 39.9)
    check("two minutes on with no rise of a degree from the lowest: it is not heating, told to the house and in the note",
          [t.alerts["noheat"], t.host.warned, t.state()["note"], logged.find(["BOILER: the heater is on and the water does not rise", 2]) != nil],
          [true, [["noheat", true]], "Not heating", true])
    second(t, 40.5)
    check("a degree above the lowest: it heats, the warning is over, and the count starts again from there",
          [t.alerts["noheat"], t.host.warned[-1], t.on_low, t.on_secs], [false, ["noheat", false], 405, 0])
    t.cfg["mode"] = "off"
    second(t, 40.5)
    check("with the heater off nothing is counted", [t.on_low, t.on_secs], [nil, 0])
    t = fresh(40.0)
    t.cfg["mode"] = "heat"
    t.cfg["nht"] = 1
    i = 0
    while i < 60
        second(t, 40.0)
        i += 1
    end
    check("a warning that holds when the heater goes off stays: it has not heated yet", t.alerts["noheat"], true)
    t.cfg["mode"] = "off"
    second(t, 40.0)
    check("until it does", t.alerts["noheat"], true)
    t.command({"do": "setting", "k": "nht", "v": 0})
    second(t, 40.0)
    check("or until the setting is 0, which is no warning", [t.alerts["noheat"], t.host.warned[-1]], [false, ["noheat", false]])
    t = fresh(58.6)
    t.cfg["mode"] = "heat"
    t.cfg["hyst"] = 1
    t.cfg["nht"] = 1
    second(t, 58.6)
    i = 0
    while i < 60
        second(t, 58.6)
        i += 1
    end
    check("with a hysteresis of a degree the heater goes off a degree above where it came on", t.alerts["noheat"], true)
    second(t, 59.1)
    check("so half of it is a rise", t.alerts["noheat"], false)
    check("the warnings and whether each holds, for the node to tell again", t.warnings(), {"stuck": false, "noheat": false})
end
relay_checks()

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
          {"Mode": "heat", "Target": 60, "Heating": 0, "NoClock": 0, "Alert": ""})
end
show_checks()

# What it measured, said for the chart a panel draws: a list the node sends in its frames, what the series is and then its bytes
def history_checks()
    at_hour(12)
    var t = fresh(50.0)
    t.cfg["power"] = 4500
    var now = tasmota.rtc()["local"]
    t.history.put(now / 300 - 1, 110, 4)
    t.host.lists.clear()
    check("the last day, asked for: taken", t.command({"do": "history", "v": "d"}), true)
    var l = t.host.lists[-1]
    check("a list of its own section: what the series is, with the heater's power, and its bytes in base64, 48 an entry",
          [l[0], size(l[1]), l[1][0], size(bytes().fromb64(l[1][1])), size(bytes().fromb64(l[1][4]))], ["h", 5, {"p": "d", "t": now, "w": 4500}, 48, 48])
    var b = bytes()
    for i: 1 .. 4  b .. bytes().fromb64(l[1][i]) end
    check("the series whole: the step before the one the time is in has the slot the history wrote", [size(b), b[94 * 2], b[94 * 2 + 1]], [192, 110, 4])
    check("the last month: thirty days in three entries, the last the rest",
          [t.command({"do": "history", "v": "m"}), size(t.host.lists[-1][1]), t.host.lists[-1][1][0]["p"], size(bytes().fromb64(t.host.lists[-1][1][3]))], [true, 4, "m", 24])
    var lists = size(t.host.lists)
    check("no other period, and none with no word of it", [t.command({"do": "history", "v": "y"}), t.command({"do": "history"}), size(t.host.lists)], [false, false, lists])
    no_clock()
    check("with no clock the history has no place for what it holds: the list says so, and carries no series",
          [t.command({"do": "history", "v": "d"}), t.host.lists[-1][1]], [true, [{"p": "d", "t": nil, "w": 4500}]])
    check("the row that opens the history is in the settings' list, and is no setting to set",
          [t.schema()[0]["t"], t.values().contains("hist"), t.command({"do": "setting", "k": "hist", "v": 1})], ["h", false, false])
end
history_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
