# zbdriver_thermostat.be -- the driver of the ZBBridge Pro's thermostats, for
# the host in zbbridge_drivers.be, which hands it the reports of its devices and what the
# NSPanel asks of them, and carries what it says back. The NSPanel never sees an attribute or
# a datapoint: it hears a normalized state, in tenths of a degree,
#   "cur"    the room's temperature, from the device's own sensor
#   "set"    the target
#   "mode"   "off" or "heat": these are thermostats for heating, and nothing else
#   "dem"    how much the heating works, 0 to 100: a Tuya device that heats says 100
#   "floor"  the temperature of the floor probe, for a device that has one
# in the host's section "s", and the settings' values in "v" and their schema in "x".
#
# A device has one of two PROFILES:
#   zcl     the Zigbee Cluster Library's thermostat (cluster 0x0201): any maker's, by its
#           DeviceId and clusters or by what it reports. Z2T reads and writes its attributes
#           by name, in degrees, and the SystemMode raw (0 off, 4 heat: a mode of cooling or of
#           changing over has no name here and is not said). It reports
#           the target and the temperature, never the mode a write set, and nothing reads the
#           device back after a write (the panel sets SetOption116): the driver reads it back
#           itself, a moment after.
#   zhtsr   the Moes ZHT-SR "Star Ring" electric heating thermostat, a Tuya TS0601 that
#           speaks in datapoints, which Z2T reads and writes by raw keys with no plugin:
#           "EF00/<type><dp>", the type a byte (01 bool, 02 value, 04 enum) and the dp its number.
#           The table is Zigbee2MQTT's for _TZE204_lpedvtvr (zigbee-herdsman-converters,
#           moes.ts), to CONFIRM on the bench with a TuyaQuery before it is trusted:
#           the datapoints' types are learned from what the device says, and used to write.
#           A Tuya device echoes a datapoint it was set; when it does not, it is asked for all.

#@ solidify:ZbDriverThermostat
class ZbDriverThermostat
    static ID = "thermostat"
    static VERSION = 1
    static KIND = "thermostat"
    # a thermostat's own words in a report: the cluster's attributes
    static KEYS = ["LocalTemperature", "OccupiedHeatingSetpoint", "PIHeatingDemand", "SystemMode"]
    static CLUSTER = 0x0201
    static DEVICE_ID = 0x0301
    # the makers of Tuya TS0601 devices whose datapoints are known here, and the profile of each
    static TUYA = {"_TZE204_lpedvtvr": "zhtsr"}
    # the target's range, in tenths of a degree, and its step
    static RANGE_ZCL = [50, 300]
    static RANGE_ZHTSR = [50, 350]
    static STEP = 5
    # a write is read back this long after it: a ZCL device is asked, a Tuya one asked if it said nothing
    static ZCL_BACK_MS = 700
    static TUYA_BACK_MS = 1500
    # The ZHT-SR's datapoints in the state: [dp, the state's field]. The room's temperature, the target
    # and the floor's are tenths of a degree already; 1 is on or off; 47 says 0 for heating, 1 for resting
    static ZHTSR_STATE = [[1, "mode"], [16, "cur"], [50, "set"], [47, "dem"], [109, "floor"]]
    # The ZHT-SR's settings, in the order the NSPanel lists them, each
    #   [key, label, kind, dp, dp type, mul, base, wrap, min, max, unit, options, writable]
    # kind "b" is on or off, "e" a choice of the options, by their index, "n" a whole number between min and max,
    # typed, and "r" one chosen from the list the NSPanel makes of the range, for what may be below zero (the keypad has
    # no sign, and the options would not fit a frame). The datapoint holds (value + base) * mul, and a number below zero
    # is stored past `wrap` (256 for the calibration). The sensor is read and not written: Zigbee2MQTT only reads it
    static ZHTSR_SETTINGS = [
        ["preset", "Preset", "e", 2, "04", 1, 0, 0, 0, 0, "", ["Manual", "Temporary", "Program", "Eco"], 1],
        ["lock", "Child lock", "b", 39, "01", 1, 0, 0, 0, 0, "", [], 1],
        ["calib", "Calibration", "r", 101, "02", 1, 0, 256, -10, 10, "°", [], 1],
        ["dead", "Deadzone", "e", 110, "02", 5, 1, 0, 0, 0, "", ["0.5°", "1.0°", "1.5°", "2.0°", "2.5°", "3.0°", "3.5°", "4.0°", "4.5°", "5.0°"], 1],
        ["lmin", "Min limit", "n", 18, "02", 10, 0, 0, 1, 15, "°", [], 1],
        ["lmax", "Max limit", "n", 34, "02", 10, 0, 0, 35, 45, "°", [], 1],
        ["phi", "High protect", "n", 111, "02", 10, 0, 0, 10, 70, "°", [], 1],
        ["plo", "Low protect", "n", 112, "02", 10, 0, 0, 0, 10, "°", [], 1],
        ["eco", "Eco temp", "n", 113, "02", 10, 0, 0, 10, 30, "°", [], 1],
        ["bl", "Backlight", "n", 48, "02", 1, 0, 0, 0, 100, "%", [], 1],
        ["scr", "Screen time", "e", 114, "04", 1, 0, 0, 0, 0, "", ["10 s", "20 s", "30 s", "40 s", "50 s", "60 s"], 1],
        ["ring", "Ring light", "b", 115, "01", 1, 0, 0, 0, 0, "", [], 1],
        ["sensor", "Sensor", "e", 32, "04", 1, 0, 0, 0, 0, "", ["Internal", "Both", "External"], 0]
    ]

    var host      # the host (zbbridge_drivers.be): what this driver says goes through it
    var types     # IEEE -> {dp -> the type byte the device used for it}
    var waiting   # IEEE -> a write of a Tuya device that nothing has answered yet

    def init(host)
        self.host = host
        self.types = {}
        self.waiting = {}
    end

    # --- what a device is -------------------------------------------------------------------

    # the profile of a device: its maker's, for a Tuya one this driver knows, and a ZCL thermostat otherwise
    static def profile(info)
        return ZbDriverThermostat.TUYA.find(info.find("Manufacturer", ""), "zcl")
    end

    static def range(info)
        return ZbDriverThermostat.profile(info) == "zcl" ? ZbDriverThermostat.RANGE_ZCL : ZbDriverThermostat.RANGE_ZHTSR
    end

    # A device is this driver's when its maker is a Tuya one it has the datapoints of, when it is a thermostat
    # by its interview (its DeviceId and the cluster), or when what it reports is one's
    def claims(info)
        if ZbDriverThermostat.TUYA.contains(info.find("Manufacturer", "")) return true end
        var rep = info.find("report")
        if isinstance(rep, map)
            for k: ZbDriverThermostat.KEYS
                if rep.contains(k) return true end
            end
        end
        var clusters = info.find("InClusters")
        return info.find("DeviceId") == ZbDriverThermostat.DEVICE_ID && isinstance(clusters, list) &&
               clusters.find(ZbDriverThermostat.CLUSTER) != nil
    end

    # What the NSPanel registers a thermostat with: 48 is the store's CAP_SETPOINT and CAP_MODE (16 and 32), the
    # range and the step are the target's, in tenths of a degree, and "floor" says there is a probe to show
    def describe(info)
        var r = ZbDriverThermostat.range(info)
        var ep = info.find("Endpoint")
        return {
            "caps": 48,
            "min": r[0],
            "max": r[1],
            "step": ZbDriverThermostat.STEP,
            "modes": ["off", "heat"],
            "floor": ZbDriverThermostat.profile(info) != "zcl",
            "ep": (ep == nil || ep == 0) ? 1 : ep
        }
    end

    # --- what the device says ---------------------------------------------------------------

    # a temperature in degrees, as tenths of one
    static def tenths(deg)
        return int(deg * 10 + (deg < 0 ? -0.5 : 0.5))
    end

    # a datapoint's boolean: Z2T says a bool as a number
    static def truth(v)
        return v == true || v == 1
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

    # A ZCL thermostat's report, as the state: the attributes it has
    static def zcl_report(attrs, s)
        if attrs.contains("LocalTemperature")  s["cur"] = ZbDriverThermostat.tenths(attrs["LocalTemperature"]) end
        if attrs.contains("OccupiedHeatingSetpoint")  s["set"] = ZbDriverThermostat.tenths(attrs["OccupiedHeatingSetpoint"]) end
        if attrs.contains("PIHeatingDemand")  s["dem"] = int(attrs["PIHeatingDemand"]) end
        if attrs.contains("SystemMode")
            var m = int(attrs["SystemMode"])
            if m == 0
                s["mode"] = "off"
            elif m == 4
                s["mode"] = "heat"
            end
        end
    end

    # a ZHT-SR's datapoint in the state, by the field the table says it is
    static def state_field(field, raw, s)
        if field == "mode"
            s["mode"] = ZbDriverThermostat.truth(raw) ? "heat" : "off"
        elif field == "dem"
            s["dem"] = raw == 0 ? 100 : 0
        else
            s[field] = int(raw)
        end
    end

    # a setting's value from its datapoint's raw one: a flag, the index of a choice, or a whole number
    static def setting_value(e, raw)
        if e[2] == "b"  return ZbDriverThermostat.truth(raw) end
        if e[2] == "e"  return int(raw) / e[5] - e[6] end
        var v = int(raw)
        if e[7] != 0 && v > 200  v -= e[7] end
        return v / e[5]
    end

    # the datapoint's raw value of a setting's value, which has been checked
    static def raw_of(e, v)
        if e[2] == "b"  return ZbDriverThermostat.truth(v) ? 1 : 0 end
        if e[2] == "e"  return (v + e[6]) * e[5] end
        var raw = v * e[5]
        if raw < 0 && e[7] != 0  raw += e[7] end
        return raw
    end

    # Whether a value is one the setting takes: a flag, an index of its options, or a number in its range
    static def valid(e, v)
        if e[2] == "b"  return type(v) == "bool" || v == 0 || v == 1 end
        if type(v) != "int" return false end
        if e[2] == "e"  return v >= 0 && v < size(e[11]) end
        return v >= e[8] && v <= e[9]
    end

    # The report of one of this driver's devices, as the state it says to the host: the normalized
    # fields that the report has, and the settings' values it has
    def on_report(info, attrs)
        var ieee = info["IEEEAddr"]
        var s = {}
        var v = {}
        if ZbDriverThermostat.profile(info) == "zcl"
            ZbDriverThermostat.zcl_report(attrs, s)
        else
            self.tuya_report(ieee, attrs, s, v)
        end
        if size(s) > 0  self.host.say(ieee, "s", s) end
        if size(v) > 0  self.host.say(ieee, "v", v) end
    end

    def tuya_report(ieee, attrs, s, v)
        var dps = ZbDriverThermostat.datapoints(attrs)
        if size(dps) == 0 return end
        # something came from the device: a write of ours was heard
        self.waiting.remove(ieee)
        var seen = self.types.find(ieee)
        if seen == nil
            seen = {}
            self.types[ieee] = seen
        end
        for dp: dps.keys()
            var raw = dps[dp][1]
            seen[dp] = dps[dp][0]
            for e: ZbDriverThermostat.ZHTSR_STATE
                if e[0] == dp  ZbDriverThermostat.state_field(e[1], raw, s) end
            end
            for e: ZbDriverThermostat.ZHTSR_SETTINGS
                if e[3] == dp  v[e[0]] = ZbDriverThermostat.setting_value(e, raw) end
            end
        end
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

    # Ask the device for its state: a ZCL one for the attributes the state is made of, a Tuya one for all its
    # datapoints (TuyaQuery), the settings' among them
    def seed(info, quiet)
        if ZbDriverThermostat.profile(info) == "zcl"
            self.send(info, {"Read": {"LocalTemperature": true, "OccupiedHeatingSetpoint": true, "SystemMode": true,
                                      "PIHeatingDemand": true}}, quiet)
        else
            self.send(info, {"Send": {"TuyaQuery": nil}}, quiet)
        end
    end

    # A write's read-back: a ZCL device never says what it was set, and a Tuya one says it by
    # itself and is asked only when it did not
    def back_later(info)
        var ieee = info["IEEEAddr"]
        var zcl = ZbDriverThermostat.profile(info) == "zcl"
        if !zcl  self.waiting[ieee] = true end
        tasmota.remove_timer("zbdriver_thermostat_" + ieee)
        tasmota.set_timer(zcl ? ZbDriverThermostat.ZCL_BACK_MS : ZbDriverThermostat.TUYA_BACK_MS, / -> self.back(info),
                          "zbdriver_thermostat_" + ieee)
    end

    def back(info)
        var ieee = info["IEEEAddr"]
        if ZbDriverThermostat.profile(info) == "zcl"
            self.seed(info, true)
        elif self.waiting.contains(ieee)
            self.waiting.remove(ieee)
            self.seed(info, true)
        end
    end

    # the target, in tenths of a degree, in the range and a step of the profile's
    def set_target(info, v)
        var r = ZbDriverThermostat.range(info)
        if type(v) != "int" || v < r[0] || v > r[1] || v % ZbDriverThermostat.STEP != 0 return false end
        if ZbDriverThermostat.profile(info) == "zcl"
            self.send(info, {"Write": {"OccupiedHeatingSetpoint": v / 10.0}}, false)
        else
            self.send(info, {"Write": {self.tuya_key(info["IEEEAddr"], 50, "02"): v}}, false)
        end
        self.back_later(info)
        return true
    end

    # the mode: "off" or "heat", and no other: it is a thermostat for heating
    def set_mode(info, v)
        if v != "off" && v != "heat" return false end
        if ZbDriverThermostat.profile(info) == "zcl"
            self.send(info, {"Write": {"SystemMode": v == "heat" ? 4 : 0}}, false)
        else
            self.send(info, {"Write": {self.tuya_key(info["IEEEAddr"], 1, "01"): v == "heat" ? 1 : 0}}, false)
        end
        self.back_later(info)
        return true
    end

    # a setting of the ZHT-SR, by its key: only one the table has, that is not read-only, and a value it takes
    def set_setting(info, key, v)
        if ZbDriverThermostat.profile(info) == "zcl" return false end
        for e: ZbDriverThermostat.ZHTSR_SETTINGS
            if e[0] == key
                if e[12] == 0 || !ZbDriverThermostat.valid(e, v) return false end
                self.send(info, {"Write": {self.tuya_key(info["IEEEAddr"], e[3], e[4]): ZbDriverThermostat.raw_of(e, v)}}, false)
                self.back_later(info)
                return true
            end
        end
        return false
    end

    # A setting as the NSPanel's list has it: its key, its label, how it is edited and what it takes
    static def wire(e)
        var m = {"k": e[0], "l": e[1], "t": e[2]}
        if e[2] == "e"  m["o"] = e[11] end
        if e[2] == "n" || e[2] == "r"
            m["min"] = e[8]
            m["max"] = e[9]
            m["u"] = e[10]
        end
        if e[12] == 0  m["w"] = 0 end
        return m
    end

    # The settings' schema to the NSPanel, in its numbered frames, and the device asked for what they are: the
    # values come as its answer, all of them, for the host has forgotten what it said before
    def send_settings(info)
        var entries = []
        if ZbDriverThermostat.profile(info) != "zcl"
            for e: ZbDriverThermostat.ZHTSR_SETTINGS  entries.push(ZbDriverThermostat.wire(e)) end
        end
        self.host.send_list(info["IEEEAddr"], "x", entries)
        self.seed(info, true)
        return true
    end

    # The NSPanel's command: the verb says what it is, and the host has taken the two that ask for a whole state
    def command(info, cmd)
        var verb = cmd.find("do")
        if verb == "target"  return self.set_target(info, cmd.find("v")) end
        if verb == "mode"  return self.set_mode(info, cmd.find("v")) end
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
        self.waiting.remove(ieee)
        tasmota.remove_timer("zbdriver_thermostat_" + ieee)
    end
end
