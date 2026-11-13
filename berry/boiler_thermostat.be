# boiler_thermostat.be -- a water heater's thermostat, on the appliance that switches its heater (appliance_node.be): a probe in the water, a relay
# on the heater, and the hours of the day the heater may work. The logic runs here, on the appliance, with every panel off and the mesh down.
#
# WHAT A PANEL SEES is the thermostat it knows (panel_thermostat.be), in tenths of a degree:
#   cur    the water, from the probe
#   set    the target of the window in force, or of the next one to begin
#   mode   "off", the heater never works, or "heat", it follows the windows
#   dem    100 with the heater on, 0 with it off
#   up     false with no reading of the probe
#   note   "No probe", "No clock", or "" for neither
# and its description names what it measures ("measure": "Water"). A target set on the page is that window's from then on.
#
# THE LOGIC, every second. The heater comes on with the water at or below the target less the hysteresis, and goes off at the target. Each of the two
# windows of the day has its hours and its target; outside both the heater is off. It is off, whatever else, in the mode off, with no reading of the
# probe (before its first one at a boot, and once it stopped), with the water at the ceiling, and when the node is about to restart: the relay is
# bistable and would stay as it is through a restart.
#
# WITH NO CLOCK AT ALL the windows cannot be told, and the thermostat holds the first window's target, with the same hysteresis, ceiling and safety:
# an exceptional mode, said in the state's note, in a row of the settings, in the node's LED and in what the node says of itself to the MQTT, and
# left by itself when the clock comes.
#
# THE RELAY IS THE LOGIC'S. One switched by another hand (the Web UI, the MQTT, the console) is the mode that was asked for, on for "heat" and off
# for "off", and the logic decides the relay from it at the next second.
#
# THE SETTINGS are kept in the flash (persist), with the mode. The calibration is Tasmota's own temperature offset, so the display and the MQTT say the
# water the logic reads.
#
# Compiled into the appliance's firmware: one class, nothing at the top, every module imported where it is used. It comes after ClockLink, PairSign and
# BoilerHistory, which it names; the node is handed to it (init).

#@ solidify:BoilerThermostat
class BoilerThermostat
    static ID = "boiler"
    static KIND = "thermostat"
    static MODEL = "THR320D"
    static NAME = "Boiler"
    static TAG = "BOILER"
    # what the flash keeps the settings under, and the sensor Tasmota reads the probe as
    static KEEP = "boiler"
    static PROBE = "WTS01"
    # the target's range, in tenths of a degree, and its step
    static RANGE = [300, 700]
    static STEP = 10
    # the water is said to the panels when it moved this many tenths from what they were told, or every CUR_AGAIN_S while it differs
    static CUR_STEP = 3
    static CUR_AGAIN_S = 60
    # a panel that asked for the settings this long ago at most hears them again when the exceptional mode comes or goes
    static ASKED_MS = 600000
    # the settings are saved this long after the last change
    static SAVE_MS = 3000
    # The settings, in the order a panel lists them: [key, label, how it is edited, min, max, unit]. "r" is chosen from the list its range makes and
    # "n" typed (panel_thermostat_settings.be). A window is from an hour up to another, past midnight when the second comes first, and none when the
    # two are the same
    static SETTINGS = [
        ["w1s", "Window 1 from", "r", 0, 23, ":00"],
        ["w1e", "Window 1 to", "r", 0, 24, ":00"],
        ["w1t", "Window 1 target", "n", 30, 70, "°"],
        ["w2s", "Window 2 from", "r", 0, 23, ":00"],
        ["w2e", "Window 2 to", "r", 0, 24, ":00"],
        ["w2t", "Window 2 target", "n", 30, 70, "°"],
        ["hyst", "Hysteresis", "r", 1, 10, "°"],
        ["ceil", "Ceiling", "n", 50, 80, "°"],
        ["calib", "Calibration", "r", -5, 5, "°"],
        ["power", "Heater power", "n", 500, 9000, " W"]
    ]
    # what a thermostat out of its box has: off, until someone turns it on
    static DEFAULTS = [["mode", "off"], ["w1s", 17], ["w1e", 21], ["w1t", 60], ["w2s", 5], ["w2e", 7], ["w2t", 50], ["hyst", 3], ["ceil", 75],
                       ["calib", 0], ["power", 3000]]

    var host       # the appliance's node: what this says of itself goes through it (say, send_list)
    var history    # what it measured, kept (boiler_history.be)
    var cfg        # the mode and the settings, as the flash keeps them
    var water      # the probe's reading, in tenths of a degree, or nil with none
    var relay      # the heater's relay, as this side last set it or found it
    var stopped    # the node is about to restart: the heater stays off
    var exception  # there is no clock: the first window's target is held
    var secs       # the seconds counted since the boot
    var said_cur   # the water the panels were last told, and the second it was
    var said_at
    var asked_at   # millis when a panel last asked for the settings, or nil

    def init(host)
        import persist
        self.host = host
        self.cfg = {}
        for e: BoilerThermostat.DEFAULTS  self.cfg[e[0]] = e[1] end
        var kept = persist.find(BoilerThermostat.KEEP, nil)
        if isinstance(kept, map)
            for k: kept.keys()
                if BoilerThermostat.fair(k, kept[k])  self.cfg[k] = kept[k] end
            end
        end
        var p = tasmota.get_power()
        self.relay = size(p) > 0 && p[0] == true
        self.stopped = false
        self.exception = false
        self.secs = 0
        self.history = BoilerHistory()
        self.history.load()
        self.calibrate()
    end

    # --- the settings ---------------------------------------------------------------------------

    # whether `v` is a value the key `k` takes: a mode, or a whole number in a setting's range
    static def fair(k, v)
        if k == "mode" return v == "off" || v == "heat" end
        for e: BoilerThermostat.SETTINGS
            if e[0] == k return type(v) == "int" && v >= e[3] && v <= e[4] end
        end
        return false
    end

    # the mode and the settings to the flash, a moment after the last change
    def keep()
        import persist
        persist.setmember(BoilerThermostat.KEEP, self.cfg)
        tasmota.remove_timer("boiler_save")
        tasmota.set_timer(BoilerThermostat.SAVE_MS, / -> PairSign.safe_save(BoilerThermostat.TAG), "boiler_save")
    end

    # the probe's calibration is Tasmota's temperature offset: set when it is another
    def calibrate()
        var r = tasmota.cmd("TempOffset", true)
        var now = isinstance(r, map) ? r.find("TempOffset") : nil
        if (type(now) == "real" || type(now) == "int") && int(now) == self.cfg["calib"] && now == int(now) return end
        tasmota.cmd("TempOffset " + str(self.cfg["calib"]), true)
    end

    # a setting as a panel's list has it
    static def wire(e)
        return {"k": e[0], "l": e[1], "t": e[2], "min": e[3], "max": e[4], "u": e[5]}
    end

    # The settings' schema: with no clock, a first row that is only read and says the target held; then the settings
    def schema()
        var out = []
        if self.exception  out.push({"k": "held", "l": "No clock: holding", "t": "n", "min": 30, "max": 70, "u": "°", "w": 0}) end
        for e: BoilerThermostat.SETTINGS  out.push(BoilerThermostat.wire(e)) end
        return out
    end

    # the settings' values, by key
    def values()
        var v = {}
        for e: BoilerThermostat.SETTINGS  v[e[0]] = self.cfg[e[0]] end
        if self.exception  v["held"] = self.cfg["w1t"] end
        return v
    end

    # --- the windows ----------------------------------------------------------------------------

    # whether the hour `h` is in the window from `s` to `e`: from s up to e, past midnight when e comes before s; none when they are the same
    static def within(h, s, e)
        if s == e return false end
        if s < e return h >= s && h < e end
        return h >= s || h < e
    end

    # the hour of the day now, or nil with no clock
    static def hour_now()
        var r = tasmota.rtc()
        if r["utc"] < ClockLink.VALID return nil end
        return (r["local"] / 3600) % 24
    end

    # the window whose target holds at the hour `h`, 1 or 2, the first when both do; nil outside both
    def window_in(h)
        var c = self.cfg
        if BoilerThermostat.within(h, c["w1s"], c["w1e"]) return 1 end
        if BoilerThermostat.within(h, c["w2s"], c["w2e"]) return 2 end
        return nil
    end

    # The window whose target a panel sees and sets at the hour `h`: the one in force, or the next to begin. With no clock (h nil), and with no
    # window at all, the first
    def window_at(h)
        if h == nil return 1 end
        var w = self.window_in(h)
        if w != nil return w end
        var c = self.cfg
        var d1 = c["w1s"] == c["w1e"] ? 99 : (c["w1s"] - h + 24) % 24
        var d2 = c["w2s"] == c["w2e"] ? 99 : (c["w2s"] - h + 24) % 24
        return d2 < d1 ? 2 : 1
    end

    # the target of a window, in degrees
    def target_of(w)
        return self.cfg[w == 2 ? "w2t" : "w1t"]
    end

    # --- the logic ------------------------------------------------------------------------------

    # the probe's reading, in tenths of a degree, or nil when Tasmota has none of it: before its first one at a boot, and once the probe stopped
    static def read_probe()
        import json
        var s = tasmota.read_sensors()
        var m = type(s) == "string" ? json.load(s) : nil
        var p = isinstance(m, map) ? m.find(BoilerThermostat.PROBE) : nil
        var t = isinstance(p, map) ? p.find("Temperature") : nil
        if type(t) != "real" && type(t) != "int" return nil end
        return int(t * 10 + (t < 0 ? -0.5 : 0.5))
    end

    # Whether the heater is to be on at the hour `h` (nil with no clock): never while the node is about to restart, in the mode off, with no reading,
    # or with the water at the ceiling; else on at or below the target less the hysteresis, and off at the target
    def wants(h)
        var c = self.cfg
        if self.stopped || c["mode"] != "heat" || self.water == nil || self.water >= c["ceil"] * 10 return false end
        var w = h == nil ? 1 : self.window_in(h)
        if w == nil return false end
        var t = self.target_of(w)
        if self.relay return self.water < t * 10 end
        return self.water <= (t - c["hyst"]) * 10
    end

    # the relay as the logic wants it
    def set_relay(want)
        if want == self.relay return end
        self.relay = want
        tasmota.set_power(0, want)
        log(BoilerThermostat.TAG + ": the heater " + (want ? "on" : "off") + ", the water at " + BoilerThermostat.degrees(self.water), 2)
    end

    # The relay found as this side did not leave it: another hand switched it, and that is the mode asked for
    def outside(on)
        self.relay = on
        var mode = on ? "heat" : "off"
        log(BoilerThermostat.TAG + ": the relay switched from outside: the mode is " + mode, 2)
        if self.cfg["mode"] != mode
            self.cfg["mode"] = mode
            self.keep()
        end
    end

    # One second: the probe read, a relay another hand switched taken as the mode, the heater as the logic wants it, the history, and what changed
    # said to the panels
    def tick()
        self.secs += 1
        var p = tasmota.get_power()
        var on = size(p) > 0 && p[0] == true
        if on != self.relay && !self.stopped  self.outside(on) end
        self.water = BoilerThermostat.read_probe()
        var h = BoilerThermostat.hour_now()
        var was = self.exception
        self.exception = h == nil
        self.set_relay(self.wants(h))
        self.history.tick(h == nil ? nil : tasmota.rtc()["local"], self.water, self.relay)
        if was != self.exception  self.exception_changed() end
        self.say_state()
    end

    # The exceptional mode came or went: said in the log, and a panel that has the settings on show hears them again, with or without their first row
    def exception_changed()
        log(BoilerThermostat.TAG + (self.exception ? ": no clock: the first window's target is held until there is one" : ": the clock is set: the windows hold again"), 2)
        if self.asked_at != nil && tasmota.millis() - self.asked_at < BoilerThermostat.ASKED_MS  self.send_settings() end
    end

    # the node is about to restart: the heater off, and what the flash is to keep written now
    def stop()
        self.stopped = true
        self.set_relay(false)
        self.history.save()
        tasmota.remove_timer("boiler_save")
        PairSign.safe_save(BoilerThermostat.TAG)
    end

    # --- what a panel hears ---------------------------------------------------------------------

    # what a panel registers the thermostat with: 48 is the store's CAP_SETPOINT and CAP_MODE, the range and the step are the target's, in tenths
    # of a degree, and "measure" is what the page calls the temperature it shows
    def describe()
        return {"caps": 48, "min": BoilerThermostat.RANGE[0], "max": BoilerThermostat.RANGE[1], "step": BoilerThermostat.STEP,
                "modes": ["off", "heat"], "floor": false, "ep": 1, "measure": "Water"}
    end

    # the few words the page shows beside the water
    def note()
        if self.water == nil return "No probe" end
        return self.exception ? "No clock" : ""
    end

    # the whole state, as a panel keeps it
    def state()
        var s = {"set": self.target_of(self.window_at(BoilerThermostat.hour_now())) * 10, "mode": self.cfg["mode"],
                 "dem": self.relay ? 100 : 0, "up": self.water != nil, "note": self.note()}
        if self.water != nil  s["cur"] = self.water end
        return s
    end

    # The state to the node, which says what the panels were not told. The water moves by tenths every few seconds: it is said when it is CUR_STEP
    # from what they have, or CUR_AGAIN_S after it was last said
    def say_state()
        var s = self.state()
        if s.contains("cur") && self.said_cur != nil
            var d = s["cur"] - self.said_cur
            if d < 0  d = -d end
            if d < BoilerThermostat.CUR_STEP && self.secs - self.said_at < BoilerThermostat.CUR_AGAIN_S  s["cur"] = self.said_cur end
        end
        if s.contains("cur") && s["cur"] != self.said_cur
            self.said_cur = s["cur"]
            self.said_at = self.secs
        end
        self.host.say("s", s)
    end

    # the settings' schema, in its numbered frames, and their values
    def send_settings()
        self.asked_at = tasmota.millis()
        self.host.send_list("x", self.schema())
        self.host.say("v", self.values())
        return true
    end

    # the target, in tenths of a degree, in the range and a step of it: the target of the window in force, or of the next to begin
    def set_target(v)
        if type(v) != "int" || v < BoilerThermostat.RANGE[0] || v > BoilerThermostat.RANGE[1] || v % BoilerThermostat.STEP != 0 return false end
        var w = self.window_at(BoilerThermostat.hour_now())
        self.cfg[w == 2 ? "w2t" : "w1t"] = v / 10
        self.keep()
        return true
    end

    # the mode: "off" or "heat", and no other
    def set_mode(v)
        if v != "off" && v != "heat" return false end
        self.cfg["mode"] = v
        self.keep()
        return true
    end

    # a setting, by its key: only one the table has, and a value it takes
    def set_setting(k, v)
        if k == "mode" || !BoilerThermostat.fair(k, v) return false end
        self.cfg[k] = v
        self.keep()
        if k == "calib"  self.calibrate() end
        return true
    end

    # A panel's command, {"do": the verb, ...}: true when taken. What changed is acted on at once, and the state and the values are said after it
    def command(cmd)
        var verb = cmd.find("do")
        var taken = false
        if verb == "target"
            taken = self.set_target(cmd.find("v"))
        elif verb == "mode"
            taken = self.set_mode(cmd.find("v"))
        elif verb == "setting"
            taken = self.set_setting(cmd.find("k"), cmd.find("v"))
        elif verb == "settings"
            taken = self.send_settings()
        elif verb == "read"
            taken = true
        end
        if !taken return false end
        self.set_relay(self.wants(BoilerThermostat.hour_now()))
        self.say_state()
        if verb == "target" || verb == "setting"  self.host.say("v", self.values()) end
        return true
    end

    # --- what the node shows and says of it -----------------------------------------------------

    # a temperature in tenths of a degree as text, "58.0°"; "?" for none
    static def degrees(tenths)
        import string
        if tenths == nil return "?" end
        return string.format("%s%d.%d°", tenths < 0 ? "-" : "", (tenths < 0 ? -tenths : tenths) / 10, (tenths < 0 ? -tenths : tenths) % 10)
    end

    # the rows of the node's Main settings that are the thermostat's: the water and the heater
    def rows()
        return [["Water", self.water != nil ? BoilerThermostat.degrees(self.water) : "No probe", 0, 0], ["Heater", self.relay ? "On" : "Off", 0, 0]]
    end

    # whether the node's LED is to say the exceptional mode
    def signal()
        return self.exception
    end

    # what the node adds of the thermostat to Tasmota's telemetry, which goes to the house's MQTT
    def telemetry()
        import string
        return string.format(",\"Boiler\":{\"Mode\":\"%s\",\"Target\":%d,\"Heating\":%d,\"NoClock\":%d}", self.cfg["mode"],
                             self.target_of(self.window_at(BoilerThermostat.hour_now())), self.relay ? 1 : 0, self.exception ? 1 : 0)
    end
end
