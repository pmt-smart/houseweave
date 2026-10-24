# zbdriver_twokey.be -- the driver of a switch of two channels that opens and closes, for the host in
# zbbridge_drivers.be. No device is this driver's by itself: the NSPanel assigns it one, a Tuya TS0002 or any switch of
# two on/off endpoints, with a configuration the host keeps in the flash:
#   "app"     what it moves, "window", "blind", "gate" or "other": the icon on the NSPanel, and nothing here
#   "mode"    "motor": the channels feed a motor, one way each; or "pulse": a channel is the key of a gate's controller
#   "sensor"  the IEEE of a door sensor that says when it is closed, or ""
#   "open", "close"   a motor's travel up and down, in seconds
#   "swap"    true when the second channel opens
#   "pulse"   a pulse's length, an index of PULSES
#   "inputs"  a controller's keys: 0 two, one to open and one to close; 1 one, which opens, stops and closes in turn
#   "travel"  how long a gate takes, in seconds: how long it is shown moving after a pulse
# The NSPanel hears it as it hears a blind (zbdriver_cover.be): "pos", 0 closed to 100 open, or nil while not known, and
# "mov", "up", "down" or "stop".
#
# A MOTOR runs one channel for the travel and turns it off, never both channels on: a move the other way stops first and
# waits DEAD_MS. Where it is comes from the time it ran, a step a second, and is right again at each end; a sensor's
# closed puts it at 0. A report of both channels on, a key on the module pressed, turns both off. The channels are
# written to come back off after a power cut when the driver is assigned.
# A PULSE turns a channel on for the pulse's length. Without a sensor the gate's state is not known, and it is shown
# moving for its travel and then as nothing; with one, closed is 0 and open is 100, as the sensor says. A gate of two keys
# has no stop: the driver refuses one, and says so in its description ("stop": false), so the NSPanel's cycle goes without it;
# one with a single key stops by pressing it again, while it is shown moving.

#@ solidify:ZbDriverTwoKey
class ZbDriverTwoKey
    static ID = "twokey"
    static VERSION = 1
    static KIND = "cover"
    static KEYS = []
    # the pause before a motor goes the other way
    static DEAD_MS = 500
    # a motor's position said again while it runs
    static STEP_MS = 1000
    # a move all the way runs this much past its travel, for the end stop
    static OVER_MS = 2000
    # a pulse's lengths, by the index the configuration keeps
    static PULSES = [500, 1000, 2000]
    # a configuration's defaults
    static DEFAULTS = {"app": "blind", "mode": "motor", "sensor": "", "open": 20, "close": 20, "swap": false, "pulse": 1, "inputs": 0, "travel": 20}
    # The settings, in the order the NSPanel lists them, each [key, label, kind, min, max, unit, options, the mode it is for]: kind "n"
    # a whole number typed, "b" on or off, "e" a choice by index
    static SETTINGS = [
        ["open", "Open time", "n", 3, 180, " s", [], "motor"],
        ["close", "Close time", "n", 3, 180, " s", [], "motor"],
        ["swap", "Swap", "b", 0, 0, "", [], nil],
        ["pulse", "Pulse time", "e", 0, 0, "", ["0.5 s", "1 s", "2 s"], "pulse"],
        ["inputs", "Inputs", "e", 0, 0, "", ["Two", "One"], "pulse"],
        ["travel", "Travel time", "n", 3, 180, " s", [], "pulse"]]

    var host
    var pos       # IEEE -> where it is, 0 to 100, while known
    var moving    # IEEE -> [way "up" or "down", millis it began, where it was, where it goes or nil for the end, its number]
    var power     # IEEE -> {endpoint -> 0 or 1}: what each channel last said
    var dead      # IEEE -> [way, where it goes or nil]: the last word given in the pause before a motor turns, which runs when it ends
    var count     # the number of the last move or press: the timers of the one before cannot end the one after
    var pulsing   # IEEE -> the channel of the pulse of ours that is pending: a gate's key held, which a report of it on may be

    def init(host)
        self.host = host
        self.pos = {}
        self.moving = {}
        self.power = {}
        self.dead = {}
        self.count = 0
        self.pulsing = {}
    end

    # --- the configuration ----------------------------------------------------------------------

    # a device's configuration, each field the NSPanel or a setting gave it, or its default
    def cfg(ieee, key)
        var c = self.host.config(ieee)
        return c.contains(key) ? c[key] : ZbDriverTwoKey.DEFAULTS[key]
    end

    # the channel a way runs on: the first opens, unless swapped
    def ep_of(ieee, way)
        var up = self.cfg(ieee, "swap") ? 2 : 1
        return way == "up" ? up : 3 - up
    end

    # --- what a device is ----------------------------------------------------------------------

    # only the devices the NSPanel assigned it
    def claims(info) return self.host.config(info["IEEEAddr"]).find("drv") == ZbDriverTwoKey.ID end

    # What the NSPanel keeps of it: a blind's capability (64), and what it moves, how, and its sensor; and "stop" false for a gate of
    # two keys, which has none, so its cycle there goes without one
    def describe(info)
        var ieee = info["IEEEAddr"]
        var d = {"caps": 64, "ep": 1, "app": self.cfg(ieee, "app"), "mode": self.cfg(ieee, "mode"), "sensor": self.cfg(ieee, "sensor")}
        if d["mode"] == "pulse" && int(self.cfg(ieee, "inputs")) != 1  d["stop"] = false end
        return d
    end

    # --- what goes to the device -------------------------------------------------------------------

    def send(info, ep, body)
        import json
        body["Device"] = info["IEEEAddr"]
        body["Endpoint"] = ep
        self.host.zb_send("ZbSend " + json.dump(body), false)
    end

    def turn(info, ep, on)
        self.send(info, ep, {"Send": {"Power": on ? 1 : 0}})
        var p = self.power.find(info["IEEEAddr"])
        if p == nil
            p = {}
            self.power[info["IEEEAddr"]] = p
        end
        p[ep] = on ? 1 : 0
    end

    # Assigned: both channels come back off after a power cut, and are asked what they are
    def assigned(info)
        for ep: [1, 2]  self.send(info, ep, {"Write": {"StartUpOnOff": 0}}) end
        self.seed(info)
    end

    # what it is doing, to the NSPanel: its place, known or not, and its motion
    def tell(ieee)
        var m = self.moving.find(ieee)
        self.host.say(ieee, "s", {"pos": self.pos.find(ieee), "mov": m != nil ? m[0] : "stop"})
    end

    def seed(info)
        var ieee = info["IEEEAddr"]
        for ep: [1, 2]  self.send(info, ep, {"Read": {"Power": true}}) end
        # A gate's channels are keys, held for a pulse and let go: one that is not known to be off and has no pulse of ours is let go
        # now, for a restart in the pulse, or an off that was lost, leaves the controller's key pressed
        if self.cfg(ieee, "mode") != "motor"
            var p = self.power.find(ieee)
            for ep: [1, 2]
                if self.pulsing.find(ieee) != ep && (p == nil || p.find(ep) != 0)  self.turn(info, ep, false) end
            end
        end
        self.tell(ieee)
    end

    # --- a motor -----------------------------------------------------------------------------------

    # how long a way takes all the way, in ms
    def full_ms(ieee, way)
        return int(self.cfg(ieee, way == "up" ? "open" : "close")) * 1000
    end

    # where a moving motor is now, by the time it ran
    def where(ieee)
        var m = self.moving.find(ieee)
        var p = self.pos.find(ieee)
        if m == nil || m[2] == nil return p end
        var run = tasmota.millis() - m[1]
        var d = run * 100 / self.full_ms(ieee, m[0])
        var at = m[0] == "up" ? m[2] + d : m[2] - d
        return at < 0 ? 0 : at > 100 ? 100 : at
    end

    # Stopped: both channels off, where it is reckoned, and the NSPanel told. The pause before a motor turns, if one runs, is over
    def halt(info, send)
        var ieee = info["IEEEAddr"]
        var m = self.moving.find(ieee)
        tasmota.remove_timer("zbdriver_twokey_" + ieee)
        tasmota.remove_timer("zbdriver_twokey_step_" + ieee)
        self.dead.remove(ieee)
        if send
            for ep: [1, 2]  self.turn(info, ep, false) end
        end
        if m != nil
            var p = self.where(ieee)
            if p != nil  self.pos[ieee] = p end
            self.moving.remove(ieee)
        end
        self.tell(ieee)
    end

    # A motor sent one way, to a place or to the end (`to` nil). Tasmota stacks the timers of one id and takes them all out by it, so
    # this timer is the only one of the id: the one of a move before would stop this one early, and say where THIS one was sent.
    # One going the other way stops first and waits DEAD_MS, and a word given in that pause is the one that runs
    # when it ends: the last word wins
    def run_motor(info, way, to)
        var ieee = info["IEEEAddr"]
        if self.dead.contains(ieee)
            self.dead[ieee] = [way, to]
            return
        end
        tasmota.remove_timer("zbdriver_twokey_" + ieee)
        var m = self.moving.find(ieee)
        if m != nil && m[0] != way
            self.halt(info, true)
            self.dead[ieee] = [way, to]
            tasmota.set_timer(ZbDriverTwoKey.DEAD_MS, / -> self.turned(info), "zbdriver_twokey_" + ieee)
            return
        end
        var p = self.where(ieee)
        var full = self.full_ms(ieee, way)
        var ms = full + ZbDriverTwoKey.OVER_MS
        if to != nil && p != nil
            ms = (way == "up" ? to - p : p - to) * full / 100
        elif p != nil
            ms = (way == "up" ? 100 - p : p) * full / 100 + ZbDriverTwoKey.OVER_MS
        end
        if ms <= 0
            # nothing left to run: a motor that runs, with its timer gone, is stopped where it is
            if m != nil  self.halt(info, true) end
            return
        end
        self.turn(info, self.ep_of(ieee, way == "up" ? "down" : "up"), false)
        self.turn(info, self.ep_of(ieee, way), true)
        self.count += 1
        var n = self.count
        self.moving[ieee] = [way, tasmota.millis(), p, to, n]
        tasmota.set_timer(ms, / -> self.arrived(info, n), "zbdriver_twokey_" + ieee)
        self.step(info)
    end

    # the pause before a motor turns is over: the last word given in it runs
    def turned(info)
        var ieee = info["IEEEAddr"]
        var w = self.dead.find(ieee)
        if w == nil return end
        self.dead.remove(ieee)
        self.run_motor(info, w[0], w[1])
    end

    # the end of the move numbered `n`: off, and where it was sent, or at the end it ran to
    def arrived(info, n)
        var ieee = info["IEEEAddr"]
        var m = self.moving.find(ieee)
        if m == nil || m[4] != n return end
        self.halt(info, true)
        self.pos[ieee] = m[3] != nil ? m[3] : (m[0] == "up" ? 100 : 0)
        self.tell(ieee)
    end

    # its place said while it runs, a step a second, the one timer of its id
    def step(info)
        var ieee = info["IEEEAddr"]
        tasmota.remove_timer("zbdriver_twokey_step_" + ieee)
        if !self.moving.contains(ieee) return end
        var p = self.where(ieee)
        if p != nil  self.host.say(ieee, "s", {"pos": p, "mov": self.moving[ieee][0]}) else self.tell(ieee) end
        tasmota.set_timer(ZbDriverTwoKey.STEP_MS, / -> self.step(info), "zbdriver_twokey_step_" + ieee)
    end

    # --- a gate's pulse ------------------------------------------------------------------------------

    # A key pressed. One key at a time, whatever the controller does with two: the other is let go first, with its pulse, and a key
    # pressed again within its pulse starts the pulse over. It was two channels on 300 ms after an open and a close
    def pulse(info, ep)
        var ieee = info["IEEEAddr"]
        var id = "zbdriver_twokey_pulse_" + ieee + "_"
        tasmota.remove_timer(id + str(3 - ep))
        tasmota.remove_timer(id + str(ep))
        var p = self.power.find(ieee)
        if p == nil || p.find(3 - ep) != 0  self.turn(info, 3 - ep, false) end
        self.turn(info, ep, true)
        self.pulsing[ieee] = ep
        var ms = ZbDriverTwoKey.PULSES[int(self.cfg(ieee, "pulse")) % size(ZbDriverTwoKey.PULSES)]
        tasmota.set_timer(ms, / -> self.unpulse(info, ep), id + str(ep))
    end

    # a pulse is over: its key is let go
    def unpulse(info, ep)
        var ieee = info["IEEEAddr"]
        if self.pulsing.find(ieee) == ep  self.pulsing.remove(ieee) end
        self.turn(info, ep, false)
    end

    # A gate sent: its key pressed, and shown moving for its travel; then what its sensor says, or nothing. The timer of the travel
    # is the only one of its id, as a motor's is: the one of the press before would end this one's travel early
    # A stop is the one key pressed again, and a gate with one key has a stop only while it is shown moving: that key would start
    # one that stands. A gate of two keys has none. The false is what the host tells the NSPanel as refused
    def run_pulse(info, verb)
        var ieee = info["IEEEAddr"]
        var one = int(self.cfg(ieee, "inputs")) == 1
        var m = self.moving.find(ieee)
        if verb == "stop" && (!one || m == nil) return false end
        tasmota.remove_timer("zbdriver_twokey_" + ieee)
        self.pulse(info, one ? self.ep_of(ieee, "up") : self.ep_of(ieee, verb == "close" ? "down" : "up"))
        if verb == "stop"
            # pressed to stop it: it is not moving any more, and where it stands is what its sensor says, or not known
            self.gate_still(info, m[4])
            return true
        end
        var way = verb == "close" ? "down" : "up"
        self.count += 1
        var n = self.count
        self.moving[ieee] = [way, tasmota.millis(), nil, nil, n]
        self.tell(ieee)
        tasmota.set_timer(int(self.cfg(ieee, "travel")) * 1000, / -> self.gate_still(info, n), "zbdriver_twokey_" + ieee)
        return true
    end

    # the travel of the press numbered `n` over with no word of the sensor: what the sensor said, or not known
    def gate_still(info, n)
        var ieee = info["IEEEAddr"]
        var m = self.moving.find(ieee)
        if m == nil || m[4] != n return end
        self.moving.remove(ieee)
        if self.cfg(ieee, "sensor") == ""  self.pos.remove(ieee) end
        self.tell(ieee)
    end

    # --- what the device and its sensor say --------------------------------------------------------------

    # A channel's report: what it says it is. Both on is a key pressed against the motor: both off. A motor's channel on
    # with no move of ours is a key: it runs, and its place is reckoned; one of ours that went off is a key that stopped it
    def on_report(info, attrs)
        var ieee = info["IEEEAddr"]
        if !attrs.contains("Power") return end
        var ep = int(attrs.find("Endpoint", 1))
        var on = attrs["Power"] == 1 || attrs["Power"] == true
        var p = self.power.find(ieee)
        if p == nil
            p = {}
            self.power[ieee] = p
        end
        p[ep] = on ? 1 : 0
        if self.cfg(ieee, "mode") != "motor"
            # a gate's channel on with no pulse of ours pending is a key held, by a restart in the pulse, an off that was lost, or a
            # hand on the module: let go
            if on && self.pulsing.find(ieee) != ep
                log("ZBDRIVER_TWOKEY: " + ieee + " had channel " + str(ep) + " on with no pulse of ours: off", 2)
                self.turn(info, ep, false)
            end
            return
        end
        if p.find(1) == 1 && p.find(2) == 1
            log("ZBDRIVER_TWOKEY: " + ieee + " had both channels on: both off", 2)
            self.halt(info, true)
            return
        end
        var m = self.moving.find(ieee)
        var way = ep == self.ep_of(ieee, "up") ? "up" : "down"
        # in the pause before a motor turns both channels are off by our word: a report of one on is the echo of the one before it,
        # or a key, and either way what runs when the pause ends turns the channels as it should
        if on && m == nil && !self.dead.contains(ieee)
            tasmota.remove_timer("zbdriver_twokey_" + ieee)
            self.count += 1
            var n = self.count
            self.moving[ieee] = [way, tasmota.millis(), self.pos.find(ieee), nil, n]
            tasmota.set_timer(self.full_ms(ieee, way) + ZbDriverTwoKey.OVER_MS, / -> self.arrived(info, n), "zbdriver_twokey_" + ieee)
            self.step(info)
        elif !on && m != nil && m[0] == way
            self.halt(info, false)
        end
    end

    # Its sensor's report (the host hands it over): Contact 0 is closed, at 0, and anything else open; a gate's at 100
    def on_sensor(info, attrs)
        var ieee = info["IEEEAddr"]
        if !attrs.contains("Contact") return end
        var closed = int(attrs["Contact"]) == 0
        if self.cfg(ieee, "mode") == "motor"
            if !closed return end
            if self.moving.contains(ieee) && self.moving[ieee][0] == "down"  self.halt(info, true) end
            self.pos[ieee] = 0
            self.tell(ieee)
            return
        end
        tasmota.remove_timer("zbdriver_twokey_" + ieee)
        self.moving.remove(ieee)
        self.pos[ieee] = closed ? 0 : 100
        self.tell(ieee)
    end

    # --- the NSPanel's commands ----------------------------------------------------------------------

    # A setting as the NSPanel's list has it
    static def wire(e)
        var m = {"k": e[0], "l": e[1], "t": e[2]}
        if e[2] == "e"  m["o"] = e[6] end
        if e[2] == "n"
            m["min"] = e[3]
            m["max"] = e[4]
            m["u"] = e[5]
        end
        return m
    end

    # the settings of its mode, and their values
    def send_settings(info)
        var ieee = info["IEEEAddr"]
        var mode = self.cfg(ieee, "mode")
        var entries = []
        var v = {}
        for e: ZbDriverTwoKey.SETTINGS
            if e[7] != nil && e[7] != mode continue end
            entries.push(ZbDriverTwoKey.wire(e))
            var x = self.cfg(ieee, e[0])
            v[e[0]] = e[2] == "b" ? x == true : int(x)
        end
        self.host.send_list(ieee, "x", entries)
        self.host.say(ieee, "v", v)
        return true
    end

    # a setting, by its key, kept in the configuration: a number in its range, a flag, or an index of its options
    def set_setting(info, key, v)
        var ieee = info["IEEEAddr"]
        for e: ZbDriverTwoKey.SETTINGS
            if e[0] != key continue end
            if e[2] == "b"
                v = v == true || v == 1
            elif type(v) != "int" || (e[2] == "n" && (v < e[3] || v > e[4])) || (e[2] == "e" && (v < 0 || v >= size(e[6])))
                return false
            end
            self.host.configure(ieee, key, v)
            var said = {}
            said[key] = e[2] == "b" ? v : int(v)
            self.host.say(ieee, "v", said)
            # the keys a gate has say whether it has a stop: the NSPanel hears its description again
            if key == "inputs"  self.host.announce(ieee) end
            return true
        end
        return false
    end

    def command(info, cmd)
        var ieee = info["IEEEAddr"]
        var verb = cmd.find("do")
        var motor = self.cfg(ieee, "mode") == "motor"
        if verb == "assigned"
            self.assigned(info)
            return true
        end
        if verb == "open" || verb == "close"
            if !motor return self.run_pulse(info, verb) end
            self.run_motor(info, verb == "open" ? "up" : "down", nil)
            return true
        end
        if verb == "stop"
            if !motor return self.run_pulse(info, "stop") end
            self.halt(info, true)
            return true
        end
        if verb == "goto"
            var v = cmd.find("v")
            if type(v) != "int" || v < 0 || v > 100 return false end
            if !motor return self.run_pulse(info, v > 0 ? "open" : "close") end
            # from a place not known, to the nearer end, which makes it known; to an end, all the way
            var p = self.where(ieee)
            if p == nil
                self.run_motor(info, v >= 50 ? "up" : "down", nil)
            elif v == 0 || v == 100
                self.run_motor(info, v == 100 ? "up" : "down", nil)
            elif v != p
                self.run_motor(info, v > p ? "up" : "down", v)
            elif self.moving.contains(ieee) || self.dead.contains(ieee)
                # sent to where it is: a motor on its way there, or in the pause before another way, stops
                self.halt(info, true)
            end
            return true
        end
        if verb == "settings" return self.send_settings(info) end
        if verb == "setting" return self.set_setting(info, cmd.find("k"), cmd.find("v")) end
        if verb == "read"
            self.seed(info)
            return true
        end
        return false
    end

    # a device that left the network, or was released
    def forget(info)
        var ieee = info["IEEEAddr"]
        # a motor that runs when its driver goes is turned off first: with the timers gone nothing of ours is left to do it
        if self.moving.contains(ieee) && self.cfg(ieee, "mode") == "motor"  self.halt(info, true) end
        tasmota.remove_timer("zbdriver_twokey_" + ieee)
        tasmota.remove_timer("zbdriver_twokey_step_" + ieee)
        self.pos.remove(ieee)
        self.moving.remove(ieee)
        self.power.remove(ieee)
        self.dead.remove(ieee)
        self.pulsing.remove(ieee)
    end
end
