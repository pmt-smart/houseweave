# zbdriver_cover.be -- the driver of the ZBBridge Pro's blinds, for the host in
# zbbridge_drivers.be, which hands it the reports of its devices and what the NSPanel asks of them,
# and carries what it says back. The NSPanel never sees an attribute or a datapoint: it hears a
# normalized state,
#   "pos"   where the blind is, 0 closed to 100 open, as Home Assistant shows a cover
#   "mov"   "up", "down" or "stop": what it is doing
# in the host's section "s", and the settings' values in "v" and their schema in "x".
#
# The switches are wall switches with three keys, open, stop and close, and a relay pair for the
# motor. None has a sensor: the position is the switch's estimate from the time the motor runs,
# against a travel time it learned in a calibration or was told. A device has one of these
# PROFILES:
#   zcl          the Zigbee Cluster Library's Window Covering (cluster 0x0102): any maker's, by its
#                DeviceId and clusters or by what it reports. Z2T sends ShutterOpen, ShutterClose,
#                ShutterStop and ShutterLift by name, and reports CurrentPositionLiftPercentage, which
#                the cluster counts 0 for open; a Tuya TS130F counts 100 for open (ZCL_UPRIGHT), and
#                says what it does in TuyaMovingState (0 up, 1 stop, 2 down).
#   ztseurc      the Moes ZTS-EUR-C glass switch, a Tuya TS0601: datapoint 1 the control (0 open,
#                1 stop, 2 close), 2 the position, which it counts 0 for open.
#   starring     the Moes ZS-SR-EUC "Star Ring", the same two datapoints, its position 100 for open,
#                and past 100 (or wrapped below 0) at the ends.
#   starfeather  the Moes ZS-SF-EUC "Star Feather", as the Star Ring.
#   zrsusc       the Moes ZRS-USC-WH curtain switch (Zigbee2MQTT's TS0601_cover_5), the same two datapoints, its position 100 for
#                open; its settings the calibration (3), the travel time from 1 to 120 s (10), the backlight (7), the motor's
#                direction (8) and the indicator (14), the datapoints it says when it joins, and the child
#                lock (103), which Zigbee2MQTT gives this maker and the device has not said yet.
# The Tuya tables are Zigbee2MQTT's (zigbee-herdsman-converters, moes.ts and legacy.ts), to CONFIRM on
# the bench with a TuyaQuery before they are trusted: the datapoints' types are learned
# from what the device says, and used to write.
#
# What it is doing comes from the device where the device says it (TuyaMovingState, or a control
# datapoint heard), and otherwise from the commands: a blind sent up is moving up until it reaches
# the top, the position it was sent to, a stop, or the longest travel a switch takes.

#@ solidify:ZbDriverCover
class ZbDriverCover
    static ID = "cover"
    static VERSION = 1
    static KIND = "cover"
    # a blind's own words in a report: the cluster's position, and a TS130F's motion
    static KEYS = ["CurrentPositionLiftPercentage", "TuyaMovingState"]
    static CLUSTER = 0x0102
    # a window covering device, and a shade
    static DEVICE_IDS = [0x0202, 0x0200]
    # the makers of Tuya TS0601 switches whose datapoints are known here, and the profile of each
    static TUYA = {"_TZE200_nhyj64w2": "ztseurc", "_TZE200_127x7wnl": "ztseurc", "_TZE204_5slehgeo": "ztseurc",
                   "_TZE284_5slehgeo": "ztseurc", "_TZE204_srmahpwl": "starring", "_TZE284_upt8lzi0": "starfeather",
                   "_TZE28C1000000_i8sdouy0": "starfeather", "_TZE284_b7kbnl6q": "zrsusc"}
    # the Tuya profiles whose position datapoint counts 0 for open
    static TUYA_INVERTED = ["ztseurc"]
    # the ZCL models whose lift percentage counts 100 for open, against the cluster's own 0
    static ZCL_UPRIGHT = ["TS130F"]
    # the control datapoint, an enum (0 open, 1 stop, 2 close), and the position's, a value
    static DP_CONTROL = 1
    static DP_POSITION = 2
    # a move nothing said had ended is taken as ended this long after it began: the longest
    # travel a switch takes
    static TRAVEL_MS = 180000
    # the position is asked for this long after the blind stopped, for the last word of it
    static BACK_MS = 1500
    # a control datapoint heard this soon after the device was asked for all of them is its answer,
    # and not a key pressed
    static QUERY_MS = 2000
    # The settings of each profile, in the order the NSPanel lists them, each
    #   [key, label, kind, where, type, mul, min, max, unit, options]
    # kind "b" is on or off, "e" a choice of the options by their index, and "n" a whole number between min and max, typed. `where`
    # is a Tuya profile's datapoint and a ZCL one's attribute, by its name; `type` the datapoint's type byte; and the device holds the
    # value times `mul`. From Zigbee2MQTT's tables, which the bench confirms or cuts: the calibration teaches a switch the
    # travel the position is reckoned from, and a reversed motor makes up go down
    static SETTINGS = {
        "ztseurc": [["calib", "Calibration", "e", 3, "04", 1, 0, 0, "", ["On", "Off"]],
                    ["light", "Backlight", "b", 7, "01", 1, 0, 0, "", []],
                    ["reverse", "Motor reversed", "b", 8, "04", 1, 0, 0, "", []]],
        "starring": [["calib", "Calibration", "e", 3, "04", 1, 0, 0, "", ["Start", "End"]],
                     ["reverse", "Motor reversed", "b", 8, "04", 1, 0, 0, "", []]],
        "starfeather": [["calib", "Calibration", "e", 3, "04", 1, 0, 0, "", ["Start", "End"]],
                        ["time", "Travel time", "n", 10, "02", 1, 10, 180, " s", []],
                        ["light", "Backlight", "b", 7, "01", 1, 0, 0, "", []],
                        ["reverse", "Motor reversed", "b", 8, "04", 1, 0, 0, "", []]],
        "zrsusc": [["calib", "Calibration", "e", 3, "04", 1, 0, 0, "", ["Start", "End"]],
                   ["time", "Travel time", "n", 10, "02", 1, 1, 120, " s", []],
                   ["light", "Backlight", "b", 7, "01", 1, 0, 0, "", []],
                   ["reverse", "Motor reversed", "b", 8, "04", 1, 0, 0, "", []],
                   ["led", "Indicator", "e", 14, "04", 1, 0, 0, "", ["Relay", "Position", "Off"]],
                   ["lock", "Child lock", "b", 103, "01", 1, 0, 0, "", []]],
        "ts130f": [["calib", "Calibration", "e", "TuyaCalibration", nil, 1, 0, 0, "", ["On", "Off"]],
                   ["time", "Travel time", "n", "TuyaCalibrationTime", nil, 10, 1, 500, " s", []],
                   ["reverse", "Motor reversed", "b", "TuyaMotorReversal", nil, 1, 0, 0, "", []]]
    }

    var host      # the host (zbbridge_drivers.be): what this driver says goes through it
    var types     # IEEE -> {dp -> the type byte the device used for it}
    var moving    # IEEE -> "up" or "down": what a blind is doing, until it stops
    var target    # IEEE -> the position a blind was sent to, while it goes there
    var pos       # IEEE -> the last position it said
    var asked     # IEEE -> when it was last asked for all its datapoints

    def init(host)
        self.host = host
        self.types = {}
        self.moving = {}
        self.target = {}
        self.pos = {}
        self.asked = {}
    end

    # --- what a device is -------------------------------------------------------------------

    # the profile of a device: its maker's, for a Tuya one this driver knows, and a ZCL blind otherwise
    static def profile(info)
        return ZbDriverCover.TUYA.find(info.find("Manufacturer", ""), "zcl")
    end

    # the settings a device has: its Tuya profile's, a TS130F's, and none for a ZCL blind of another maker
    static def settings_of(info)
        var p = ZbDriverCover.profile(info)
        if p == "zcl"  p = ZbDriverCover.upright(info) ? "ts130f" : nil end
        return p != nil ? ZbDriverCover.SETTINGS.find(p, []) : []
    end

    # a setting's value from what the device holds: a flag, the index of a choice, or a whole number
    static def setting_value(e, raw)
        if e[2] == "b"  return raw == true || raw == 1 end
        if e[2] == "e"  return int(raw) end
        return int(raw) / e[5]
    end

    # Whether a value is one the setting takes: a flag, an index of its options, or a number in its range
    static def valid(e, v)
        if e[2] == "b"  return type(v) == "bool" || v == 0 || v == 1 end
        if type(v) != "int" return false end
        if e[2] == "e"  return v >= 0 && v < size(e[9]) end
        return v >= e[6] && v <= e[7]
    end

    # A setting as the NSPanel's list has it: its key, its label, how it is edited and what it takes
    static def wire(e)
        var m = {"k": e[0], "l": e[1], "t": e[2]}
        if e[2] == "e"  m["o"] = e[9] end
        if e[2] == "n"
            m["min"] = e[6]
            m["max"] = e[7]
            m["u"] = e[8]
        end
        return m
    end

    # whether the device counts 100 for open, as the NSPanel does
    static def upright(info)
        var p = ZbDriverCover.profile(info)
        if p == "zcl" return ZbDriverCover.ZCL_UPRIGHT.find(info.find("ModelId", "")) != nil end
        return ZbDriverCover.TUYA_INVERTED.find(p) == nil
    end

    # A device is this driver's when its maker is a Tuya one it has the datapoints of, when it is a blind by
    # its interview (its DeviceId and the cluster), or when what it reports is one's
    def claims(info)
        if ZbDriverCover.TUYA.contains(info.find("Manufacturer", "")) return true end
        var rep = info.find("report")
        if isinstance(rep, map)
            for k: ZbDriverCover.KEYS
                if rep.contains(k) return true end
            end
        end
        var clusters = info.find("InClusters")
        return ZbDriverCover.DEVICE_IDS.find(info.find("DeviceId")) != nil && isinstance(clusters, list) &&
               clusters.find(ZbDriverCover.CLUSTER) != nil
    end

    # What the NSPanel registers a blind with: 64 is the store's CAP_POSITION
    def describe(info)
        var ep = info.find("Endpoint")
        return {"caps": 64, "ep": (ep == nil || ep == 0) ? 1 : ep}
    end

    # --- what the device says ---------------------------------------------------------------

    # A position as the device said it, 0 closed to 100 open: one past 100 is the top it went past,
    # and one wrapped below 0 (200 and up) is the bottom
    static def position_of(raw, upright)
        var v = int(raw)
        if v > 100  v = v >= 200 ? 0 : 100 end
        if v < 0  v = 0 end
        return upright ? v : 100 - v
    end

    # The datapoints of a report, {dp -> [type, value]}: its keys "EF00/<type><dp>"
    static def datapoints(attrs)
        var out = {}
        for k: attrs.keys()
            if size(k) >= 9 && k[0 .. 4] == "EF00/"
                out[int("0x" + k[7 .. 8])] = [k[5 .. 6], attrs[k]]
            end
        end
        return out
    end

    # the motion of a control's code, or of TuyaMovingState's: 0 up, 1 stop, 2 down
    static def motion_of(code)
        var c = int(code)
        return c == 0 ? "up" : (c == 2 ? "down" : (c == 1 ? "stop" : nil))
    end

    # The report of one of this driver's devices, as the state it says to the host
    def on_report(info, attrs)
        var ieee = info["IEEEAddr"]
        var p = nil
        var m = nil
        if ZbDriverCover.profile(info) == "zcl"
            if attrs.contains("CurrentPositionLiftPercentage")
                p = ZbDriverCover.position_of(attrs["CurrentPositionLiftPercentage"], ZbDriverCover.upright(info))
            end
            if attrs.contains("TuyaMovingState")  m = ZbDriverCover.motion_of(attrs["TuyaMovingState"]) end
            var v = {}
            for e: ZbDriverCover.settings_of(info)
                if attrs.contains(e[3])  v[e[0]] = ZbDriverCover.setting_value(e, attrs[e[3]]) end
            end
            if size(v) > 0  self.host.say(ieee, "v", v) end
        else
            var dps = ZbDriverCover.datapoints(attrs)
            if size(dps) == 0 return end
            var seen = self.types.find(ieee)
            if seen == nil
                seen = {}
                self.types[ieee] = seen
            end
            for dp: dps.keys()  seen[dp] = dps[dp][0] end
            if dps.contains(ZbDriverCover.DP_POSITION)
                p = ZbDriverCover.position_of(dps[ZbDriverCover.DP_POSITION][1], ZbDriverCover.upright(info))
            end
            # a key pressed on the wall says the control; the answer to a query says the last one again
            if dps.contains(ZbDriverCover.DP_CONTROL) && !self.answering(ieee)
                m = ZbDriverCover.motion_of(dps[ZbDriverCover.DP_CONTROL][1])
            end
            var v = {}
            for e: ZbDriverCover.settings_of(info)
                if dps.contains(e[3])  v[e[0]] = ZbDriverCover.setting_value(e, dps[e[3]][1]) end
            end
            if size(v) > 0  self.host.say(ieee, "v", v) end
        end
        var s = {}
        self.heard(info, p, m, s)
        if size(s) > 0  self.host.say(ieee, "s", s) end
    end

    # whether a report comes as the answer to the query of all the datapoints
    def answering(ieee)
        var at = self.asked.find(ieee)
        if at == nil return false end
        var d = tasmota.millis() - at
        return d >= 0 && d < ZbDriverCover.QUERY_MS
    end

    # What a report, or a command, makes of the state: a motion, and a position, which ends a motion at the top,
    # at the bottom or where the blind was sent
    def heard(info, p, m, s)
        var ieee = info["IEEEAddr"]
        if m != nil  self.motion(info, m, s) end
        if p != nil
            self.pos[ieee] = p
            s["pos"] = p
            var mv = self.moving.find(ieee)
            var t = self.target.find(ieee)
            if mv != nil && ((mv == "up" && p >= 100) || (mv == "down" && p <= 0) || (t != nil && p == t))
                self.motion(info, "stop", s)
            end
        end
    end

    # A blind starts or stops: the state says it, a move is given its longest travel to end in, and a stop asks for the
    # position a moment later, the last word of it
    def motion(info, m, s)
        var ieee = info["IEEEAddr"]
        var timer = "zbdriver_cover_" + ieee
        tasmota.remove_timer(timer)
        if m == "stop"
            var was = self.moving.contains(ieee)
            self.moving.remove(ieee)
            self.target.remove(ieee)
            if was  tasmota.set_timer(ZbDriverCover.BACK_MS, / -> self.seed(info, true), timer) end
        else
            self.moving[ieee] = m
            tasmota.set_timer(ZbDriverCover.TRAVEL_MS, / -> self.ran_out(info), timer)
        end
        s["mov"] = m
    end

    # a move that nothing said had ended, after the longest travel: it has
    def ran_out(info)
        var s = {}
        self.motion(info, "stop", s)
        self.host.say(info["IEEEAddr"], "s", s)
    end

    # --- what the NSPanel asks ----------------------------------------------------------------

    # A command to the device through Z2T, as the console would take it. A Zigbee command is addressed by the
    # device's IEEE, which a rejoin does not change
    def send(info, body, quiet)
        import json
        body["Device"] = info["IEEEAddr"]
        var ep = info.find("Endpoint")
        if ep != nil && ep != 0  body["Endpoint"] = ep end
        var line = "ZbSend " + json.dump(body)
        # a read that runs in a loop goes quiet: it would fill the log, and the MQTT; a command is told to the alarm
        self.host.zb_send(line, quiet)
    end

    # The datapoint's key for Z2T: the type the device used for it when it has said one, the table's before
    def tuya_key(ieee, dp, ty)
        import string
        var seen = self.types.find(ieee)
        if seen != nil && seen.contains(dp)  ty = seen[dp] end
        return string.format("EF00/%s%02X", ty, dp)
    end

    # Ask the device where it is: a ZCL one for its position, a Tuya one for all its datapoints (TuyaQuery), whose
    # answer says the last control again, which is no key pressed
    def seed(info, quiet)
        if ZbDriverCover.profile(info) == "zcl"
            self.send(info, {"Read": {"CurrentPositionLiftPercentage": true}}, quiet)
        else
            self.asked[info["IEEEAddr"]] = tasmota.millis()
            self.send(info, {"Send": {"TuyaQuery": nil}}, quiet)
        end
    end

    # Open, close or stop, as the keys on the wall do. A blind already at the end it is sent to does not move, and is
    # not said to
    def move(info, verb)
        var ieee = info["IEEEAddr"]
        var code = verb == "open" ? 0 : (verb == "close" ? 2 : (verb == "stop" ? 1 : nil))
        if code == nil return false end
        if ZbDriverCover.profile(info) == "zcl"
            var names = {"open": "ShutterOpen", "close": "ShutterClose", "stop": "ShutterStop"}
            var body = {}
            body[names[verb]] = ""
            self.send(info, {"Send": body}, false)
        else
            var w = {}
            w[self.tuya_key(ieee, ZbDriverCover.DP_CONTROL, "04")] = code
            self.send(info, {"Write": w}, false)
        end
        var p = self.pos.find(ieee)
        var s = {}
        self.target.remove(ieee)
        if verb == "stop"
            self.motion(info, "stop", s)
        elif (verb == "open" && p != 100) || (verb == "close" && p != 0)
            self.motion(info, verb == "open" ? "up" : "down", s)
        end
        if size(s) > 0  self.host.say(ieee, "s", s) end
        return true
    end

    # To a position, 0 closed to 100 open. It moves up or down from where it said it was; from nowhere it said, the
    # device's reports say where it goes
    def goto(info, v)
        var ieee = info["IEEEAddr"]
        if type(v) != "int" || v < 0 || v > 100 return false end
        var raw = ZbDriverCover.upright(info) ? v : 100 - v
        if ZbDriverCover.profile(info) == "zcl"
            self.send(info, {"Send": {"ShutterLift": raw}}, false)
        else
            var w = {}
            w[self.tuya_key(ieee, ZbDriverCover.DP_POSITION, "02")] = raw
            self.send(info, {"Write": w}, false)
        end
        var p = self.pos.find(ieee)
        if p == nil || p == v return true end
        var s = {}
        self.motion(info, v > p ? "up" : "down", s)
        self.target[ieee] = v
        self.host.say(ieee, "s", s)
        return true
    end

    # A setting, by its key: only one the device's profile has, and a value it takes. A Tuya device says the datapoint again by
    # itself; a ZCL one is asked for the attribute a moment after
    def set_setting(info, key, v)
        var ieee = info["IEEEAddr"]
        for e: ZbDriverCover.settings_of(info)
            if e[0] == key
                if !ZbDriverCover.valid(e, v) return false end
                var raw = e[2] == "b" ? ((v == true || v == 1) ? 1 : 0) : v * e[5]
                var w = {}
                if type(e[3]) == "string"
                    w[e[3]] = raw
                    self.send(info, {"Write": w}, false)
                    var r = {}
                    r[e[3]] = true
                    tasmota.set_timer(ZbDriverCover.BACK_MS, / -> self.send(info, {"Read": r}, true), "zbdriver_cover_set_" + ieee)
                else
                    w[self.tuya_key(ieee, e[3], e[4])] = raw
                    self.send(info, {"Write": w}, false)
                end
                return true
            end
        end
        return false
    end

    # The settings' schema to the NSPanel, in its numbered frames, and the device asked for what they are: a Tuya one says them all
    # in its answer to the query, and a ZCL one is asked for its attributes
    def send_settings(info)
        var entries = []
        var attrs = {}
        for e: ZbDriverCover.settings_of(info)
            entries.push(ZbDriverCover.wire(e))
            if type(e[3]) == "string"  attrs[e[3]] = true end
        end
        self.host.send_list(info["IEEEAddr"], "x", entries)
        self.seed(info, true)
        if size(attrs) > 0  self.send(info, {"Read": attrs}, true) end
        return true
    end

    # The NSPanel's command: the verb says what it is
    def command(info, cmd)
        var verb = cmd.find("do")
        if verb == "open" || verb == "close" || verb == "stop"  return self.move(info, verb) end
        if verb == "goto"  return self.goto(info, cmd.find("v")) end
        if verb == "setting"  return self.set_setting(info, cmd.find("k"), cmd.find("v")) end
        if verb == "settings"  return self.send_settings(info) end
        if verb == "read"
            self.seed(info, true)
            return true
        end
        return false
    end

    # a device that left the network
    def forget(info)
        var ieee = info["IEEEAddr"]
        self.types.remove(ieee)
        self.moving.remove(ieee)
        self.target.remove(ieee)
        self.pos.remove(ieee)
        self.asked.remove(ieee)
        tasmota.remove_timer("zbdriver_cover_" + ieee)
        tasmota.remove_timer("zbdriver_cover_set_" + ieee)
    end
end
