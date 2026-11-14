# boiler_thermostat.be -- a water heater's thermostat, on the appliance that switches its heater (appliance_node.be): a probe in the water, a relay
# on the heater, and the hours of the day the heater may work. The logic runs here, on the appliance, with every panel off and the mesh down.
#
# WHAT A PANEL SEES is the thermostat it knows (panel_thermostat.be), in tenths of a degree:
#   cur    the water, from the probe
#   set    the target of the window in force, or of the next one to begin; with no window, the one target there is
#   mode   "off", the heater never works, or "heat", it follows the windows
#   dem    100 with the heater on, 0 with it off
#   up     false with no reading of the probe
#   note   "No probe", a warning ("Relay stuck?", "Not heating"), "No clock", or "" for none
# and its description names what it measures ("measure": "Water"). A target set on the page is that window's from then on.
#
# THE LOGIC, every second. The heater comes on with the water at or below the target less the hysteresis, and goes off at the target. A day has as
# many windows as a setting says, from none to the most its range allows, each with its hours and its target; outside them all the heater is off.
# It is off, whatever else, in the mode off, with no reading of the probe (before its first one at a boot, and once it stopped), with the water at
# the ceiling, and when the node is about to restart: the relay is bistable and would stay as it is through a restart.
#
# WITH NO WINDOW the day is not divided: one target holds at every hour, as on a thermostat that has no hours. It is the first window's, so the
# rule is one: with no window to follow, the first target holds.
#
# WITH NO CLOCK AT ALL the windows cannot be told, and the thermostat holds the first window's target, with the same hysteresis, ceiling and safety:
# an exceptional mode, said in the state's note, in a row of the settings, in the node's LED and in what the node says of itself to the MQTT, and
# left by itself when the clock comes.
#
# THE RELAY IS THE LOGIC'S. One switched by another hand (the Web UI, the MQTT, the console) is the mode that was asked for, on for "heat" and off
# for "off", and the logic decides the relay from it at the next second. At a boot it is opened, whatever Tasmota believes it is: it is a latching
# relay, which stays where a crash or a power cut left it and says nothing of where that is. The image's own configuration opens it too, at every
# boot and with no Berry running (firmware/overrides/user_config_override.h).
#
# THE RELAY IS CHECKED WITH NO METER, by what the water does, since the board measures no current and the relay says nothing of itself:
#   - while the logic has it open, it is opened again every REOPEN_S: a pulse that did not take would leave the heater on with nothing here
#     to say so, and this bounds that to a minute;
#   - a contact stuck closed: in the hours a setting names, which have no sun, the water of a heater that is off can only fall. With the logic
#     having kept the heater off the whole time, a warning is raised when the water rose RISE above the lowest it was in those hours, at once,
#     and when at their end it fell less than a setting says. A night the logic had the heater on, or the probe gave no reading, is not judged,
#     and one judged fine ends the warning;
#   - a heater that does not heat: on for the minutes a setting says with the water never rising, it is warned of. Hot water drawn takes more
#     heat than the heater gives, so the water may fall with the heater on: only no rise at all, for long, is the sign. A rise ends the warning.
# A warning is in the state's note, in the node's telemetry, and told to the house through the node (host.warn), which says it to every panel.
# Nothing here opens a contact that is stuck: the heater's own thermostat is what is left then.
#
# THE SETTINGS are kept in the flash (persist), with the mode. The calibration is Tasmota's own temperature offset, so the display and the MQTT say the
# water the logic reads. Two of them are the lowest and the highest a target is set to: they are the range a panel is told the thermostat has, a
# window's target is kept within them, and when one moves the node describes the thermostat again to the panels that show it.
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
    # the target's step, in tenths of a degree. Its range is two settings, the lowest and the highest a target is set to (lmin, lmax)
    static STEP = 10
    # the water is said to the panels when it moved this many tenths from what they were told, or every CUR_AGAIN_S while it differs
    static CUR_STEP = 3
    static CUR_AGAIN_S = 60
    # a panel that asked for the settings this long ago at most hears them again when the exceptional mode comes or goes
    static ASKED_MS = 600000
    # the settings are saved this long after the last change
    static SAVE_MS = 3000
    # the relay is opened again this often, in seconds, while the logic has it open
    static REOPEN_S = 60
    # the water rose: this many tenths of a degree above the lowest it was
    static RISE = 10
    # the warnings it raises, as the node tells the house: a contact that may be stuck closed, and a heater that does not heat
    static WARNINGS = ["stuck", "noheat"]
    # A setting is [key, label, how it is edited, min, max, unit]: "r" is chosen from the list its range makes and "n" typed
    # (panel_thermostat_settings.be). A panel lists how many windows the day has, the settings of each of those, and the rest (table).
    #
    # How many windows the day has: its range's end is the most there are
    static COUNT = ["wn", "Windows", "r", 0, 4, ""]
    # A window's three settings, each [the last letter of its key, the end of its label, how it is edited, min, max, unit, what a window nobody set
    # has]. The key is "w", the window's number and the letter, and the label "Window", the number and the end. A window is from an hour up to
    # another, past midnight when the second comes first, and has no hours when the two are the same. Its target is between the two limits as they
    # are set, which the ends here only bound
    static WINDOW = [["s", " from", "r", 0, 23, ":00", 0], ["e", " to", "r", 0, 24, ":00", 0], ["t", " target", "n", 20, 75, "°", 50]]
    # The rest. The two limits are the range the thermostat is described with, under the keys and the words a Zigbee thermostat's have
    # (zbdriver_thermostat.be)
    static SETTINGS = [
        ["lmin", "Operating min", "n", 20, 45, "°"],
        ["lmax", "Operating max", "n", 50, 75, "°"],
        ["hyst", "Hysteresis", "r", 1, 10, "°"],
        ["ceil", "Ceiling", "n", 50, 80, "°"],
        ["calib", "Calibration", "r", -5, 5, "°"],
        ["power", "Heater power", "n", 500, 9000, " W"],
        ["chks", "Stuck check from", "r", 0, 23, ":00"],
        ["chke", "Stuck check to", "r", 0, 24, ":00"],
        ["chkd", "Stuck min drop", "r", 1, 10, "°"],
        ["nht", "No-heat alert", "n", 0, 600, " min"]
    ]
    # what a thermostat out of its box has: off, until someone turns it on, and two windows
    static DEFAULTS = [["mode", "off"], ["wn", 2], ["w1s", 17], ["w1e", 21], ["w1t", 60], ["w2s", 5], ["w2e", 7], ["w2t", 50], ["lmin", 30], ["lmax", 70],
                       ["hyst", 3], ["ceil", 75], ["calib", 0], ["power", 3000], ["chks", 0], ["chke", 5], ["chkd", 1], ["nht", 120]]

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
    var alerts     # warning -> whether it holds: "stuck" and "noheat"
    var chk        # the stuck contact's check of the hours now: [the water at their start, the lowest, the last, whether it rose], false for
                   # hours that are not judged, nil outside them
    var on_low     # the lowest the water was since the heater came on, or since it last rose, or nil with the heater off
    var on_secs    # the seconds the heater has been on with no rise

    def init(host)
        import persist
        self.host = host
        self.cfg = {}
        var i = 1
        while i <= BoilerThermostat.COUNT[4]
            for p: BoilerThermostat.WINDOW  self.cfg[BoilerThermostat.key(i, p[0])] = p[6] end
            i += 1
        end
        for e: BoilerThermostat.DEFAULTS  self.cfg[e[0]] = e[1] end
        var kept = persist.find(BoilerThermostat.KEEP, nil)
        if isinstance(kept, map)
            for k: kept.keys()
                if BoilerThermostat.fair(k, kept[k])  self.cfg[k] = kept[k] end
            end
        end
        self.fit()
        # The relay is a latching one, which does not say where it is, and what Tasmota believes of it after a restart is not where a crash or a
        # power cut left it: it is opened here, whatever Tasmota believes, and the logic closes it from a state it knows. Without this, a relay
        # left closed that Tasmota takes for open would never be opened by a logic that has nothing to turn off
        tasmota.set_power(0, false)
        self.relay = false
        self.stopped = false
        self.exception = false
        self.secs = 0
        self.alerts = {}
        for k: BoilerThermostat.WARNINGS  self.alerts[k] = false end
        self.on_secs = 0
        self.history = BoilerHistory()
        self.history.load()
        self.calibrate()
    end

    # --- the settings ---------------------------------------------------------------------------

    # the key of a window's setting: "w", the window's number and the setting's letter
    static def key(i, letter)
        return "w" + str(i) + letter
    end

    # a window's setting as a row, from its part of WINDOW
    static def window_row(i, p)
        return [BoilerThermostat.key(i, p[0]), "Window " + str(i) + p[1], p[2], p[3], p[4], p[5]]
    end

    # the row of a setting, of whatever window, or nil for a key that is none
    static def row_of(k)
        if k == BoilerThermostat.COUNT[0] return BoilerThermostat.COUNT end
        for e: BoilerThermostat.SETTINGS
            if e[0] == k return e end
        end
        var i = 1
        while i <= BoilerThermostat.COUNT[4]
            for p: BoilerThermostat.WINDOW
                if BoilerThermostat.key(i, p[0]) == k return BoilerThermostat.window_row(i, p) end
            end
            i += 1
        end
        return nil
    end

    # whether `v` is a value the key `k` takes: a mode, or a whole number in a setting's range
    static def fair(k, v)
        if k == "mode" return v == "off" || v == "heat" end
        var e = BoilerThermostat.row_of(k)
        return e != nil && type(v) == "int" && v >= e[3] && v <= e[4]
    end

    # the range a target is set in, [lowest, highest] in degrees: the two limits as they are set
    def limits()
        return [self.cfg["lmin"], self.cfg["lmax"]]
    end

    # The settings as they stand, in the order a panel lists them: how many windows, the three of each, and the rest. With no window, the one
    # target, which is the first window's, is where they would be. A target's ends are the limits as they are set
    def table()
        var r = self.limits()
        var n = self.cfg["wn"]
        var out = [BoilerThermostat.COUNT]
        if n == 0
            var t = BoilerThermostat.WINDOW[2]
            out.push([BoilerThermostat.key(1, t[0]), "Target", t[2], r[0], r[1], t[5]])
        end
        var i = 1
        while i <= n
            for p: BoilerThermostat.WINDOW
                var e = BoilerThermostat.window_row(i, p)
                if p[0] == "t"
                    e[3] = r[0]
                    e[4] = r[1]
                end
                out.push(e)
            end
            i += 1
        end
        for e: BoilerThermostat.SETTINGS  out.push(e) end
        return out
    end

    # every window's target within the limits, the windows the day does not have too: one a limit left outside goes to that limit
    def fit()
        var r = self.limits()
        var i = 1
        while i <= BoilerThermostat.COUNT[4]
            var k = BoilerThermostat.key(i, "t")
            if self.cfg[k] < r[0]  self.cfg[k] = r[0] end
            if self.cfg[k] > r[1]  self.cfg[k] = r[1] end
            i += 1
        end
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

    # whether the first target is held for want of a clock: there are windows, and no clock to tell them by
    def holding()
        return self.exception && self.cfg["wn"] > 0
    end

    # The settings' schema: while the first target is held for want of a clock, a first row that is only read and says it; then the settings
    def schema()
        var out = []
        var r = self.limits()
        if self.holding()  out.push({"k": "held", "l": "No clock: holding", "t": "n", "min": r[0], "max": r[1], "u": "°", "w": 0}) end
        for e: self.table()  out.push(BoilerThermostat.wire(e)) end
        return out
    end

    # the values of the settings a panel lists, by key
    def values()
        var v = {}
        for e: self.table()  v[e[0]] = self.cfg[e[0]] end
        if self.holding()  v["held"] = self.target_of(1) end
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

    # the hours of a window, [from, to]
    def hours_of(w)
        return [self.cfg[BoilerThermostat.key(w, "s")], self.cfg[BoilerThermostat.key(w, "e")]]
    end

    # the window whose target holds at the hour `h`, the first of them when more than one does; nil outside them all
    def window_in(h)
        var w = 1
        while w <= self.cfg["wn"]
            var o = self.hours_of(w)
            if BoilerThermostat.within(h, o[0], o[1]) return w end
            w += 1
        end
        return nil
    end

    # The window whose target a panel sees and sets at the hour `h`: the one in force, or the next to begin, the first of them when more than
    # one begins then. With no clock (h nil), and with no window that has hours, the first
    def window_at(h)
        if h == nil return 1 end
        var at = self.window_in(h)
        if at != nil return at end
        at = 1
        var wait = 24
        var w = 1
        while w <= self.cfg["wn"]
            var o = self.hours_of(w)
            var d = (o[0] - h + 24) % 24
            if o[0] != o[1] && d < wait
                wait = d
                at = w
            end
            w += 1
        end
        return at
    end

    # the target of a window, in degrees
    def target_of(w)
        return self.cfg[BoilerThermostat.key(w, "t")]
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
    # or with the water at the ceiling; else on at or below the target less the hysteresis, and off at the target. The target is the window's in
    # force, and none outside the windows; with no window, and with no clock, the first
    def wants(h)
        var c = self.cfg
        if self.stopped || c["mode"] != "heat" || self.water == nil || self.water >= c["ceil"] * 10 return false end
        var w = h == nil || c["wn"] == 0 ? 1 : self.window_in(h)
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
        if !self.relay && !self.stopped && self.secs % BoilerThermostat.REOPEN_S == 0  tasmota.set_power(0, false) end
        self.check_stuck(h)
        self.check_heating()
        self.history.tick(h == nil ? nil : tasmota.rtc()["local"], self.water, self.relay)
        if was != self.exception  self.exception_changed() end
        self.say_state()
    end

    # A warning comes or goes: said in the log, in the state's note from the next word, and told to the house through the node
    def alert(kind, on)
        if self.alerts[kind] == on return end
        self.alerts[kind] = on
        var what = kind == "stuck" ? "the relay may be stuck closed" : "the heater is on and the water does not rise"
        log(BoilerThermostat.TAG + ": " + what + (on ? "" : ": over"), 2)
        self.host.warn(kind, on)
    end

    # the warnings and whether each holds, for the node to tell the house again
    def warnings()
        return self.alerts
    end

    # The stuck contact's check at the hour `h` (nil with no clock), every second. Its hours are a setting, and none when the two are the same
    def check_stuck(h)
        var c = self.cfg
        if c["chks"] == c["chke"]
            # no check: what its hours had gathered goes, and a warning it raised with them
            self.chk = nil
            self.alert("stuck", false)
            return
        end
        if h == nil || !BoilerThermostat.within(h, c["chks"], c["chke"])
            # the hours over: judged by how far the water fell, unless it rose in them, which the warning already says
            var k = self.chk
            if isinstance(k, list)  self.alert("stuck", k[3] || k[0] - k[2] < c["chkd"] * 10) end
            self.chk = nil
            return
        end
        if self.chk == false return end
        if self.relay || self.water == nil
            self.chk = false
            return
        end
        if self.chk == nil
            self.chk = [self.water, self.water, self.water, false]
            return
        end
        var k = self.chk
        k[2] = self.water
        if self.water < k[1]  k[1] = self.water end
        if self.water - k[1] >= BoilerThermostat.RISE
            k[3] = true
            self.alert("stuck", true)
        end
    end

    # The heater's check, every second: on with the water never as much as a rise above the lowest it was, for the minutes the setting says
    # (0 for no warning). What counts as a rise is RISE, or half the hysteresis when that is less: the heater goes off a hysteresis above
    # where it came on
    def check_heating()
        var c = self.cfg
        if c["nht"] == 0  self.alert("noheat", false) end
        if !self.relay || self.water == nil
            self.on_low = nil
            self.on_secs = 0
            return
        end
        if self.on_low == nil || self.water < self.on_low  self.on_low = self.water end
        var rise = c["hyst"] * 5 < BoilerThermostat.RISE ? c["hyst"] * 5 : BoilerThermostat.RISE
        if self.water - self.on_low >= rise
            self.alert("noheat", false)
            self.on_low = self.water
            self.on_secs = 0
            return
        end
        self.on_secs += 1
        if c["nht"] > 0 && self.on_secs >= c["nht"] * 60  self.alert("noheat", true) end
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
    # of a degree, the range the two limits as they are set, and "measure" is what the page calls the temperature it shows
    def describe()
        var r = self.limits()
        return {"caps": 48, "min": r[0] * 10, "max": r[1] * 10, "step": BoilerThermostat.STEP,
                "modes": ["off", "heat"], "floor": false, "ep": 1, "measure": "Water"}
    end

    # the few words the page shows beside the water
    def note()
        if self.water == nil return "No probe" end
        if self.alerts["stuck"] return "Relay stuck?" end
        if self.alerts["noheat"] return "Not heating" end
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

    # the target, in tenths of a degree, within the limits and a step of it: the target of the window in force, or of the next to begin
    def set_target(v)
        var r = self.limits()
        if type(v) != "int" || v < r[0] * 10 || v > r[1] * 10 || v % BoilerThermostat.STEP != 0 return false end
        self.cfg[BoilerThermostat.key(self.window_at(BoilerThermostat.hour_now()), "t")] = v / 10
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

    # A setting, by its key: only one the table has as it stands, so of a window the day has, and a whole number between its ends, which for a
    # target are the limits. A limit that moves takes the windows' targets with it, and the thermostat is another to the panels: its range is
    # the limits. A limit that moves, and another count of windows, make the table another: a panel with the settings on show hears them again
    def set_setting(k, v)
        var e = nil
        for row: self.table()
            if row[0] == k  e = row end
        end
        if e == nil || type(v) != "int" || v < e[3] || v > e[4] return false end
        var moved = self.cfg[k] != v
        var limit = moved && (k == "lmin" || k == "lmax")
        self.cfg[k] = v
        if limit  self.fit() end
        self.keep()
        if k == "calib"  self.calibrate() end
        if limit || (moved && k == BoilerThermostat.COUNT[0])  self.send_settings() end
        if limit  self.host.described() end
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
        return string.format(",\"Boiler\":{\"Mode\":\"%s\",\"Target\":%d,\"Heating\":%d,\"NoClock\":%d,\"Alert\":\"%s\"}", self.cfg["mode"],
                             self.target_of(self.window_at(BoilerThermostat.hour_now())), self.relay ? 1 : 0, self.exception ? 1 : 0,
                             self.alerts["stuck"] ? "stuck" : (self.alerts["noheat"] ? "noheat" : ""))
    end
end
