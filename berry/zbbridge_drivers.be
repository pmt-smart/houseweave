# zbbridge_drivers.be -- the host of the drivers of the ZBBridge Pro's devices:
# what is specific to one kind of device lives here, on the side that owns the
# Zigbee coordinator, and the NSPanel only ever sees a normalized model of the kind (a
# thermostat's target and mode, never a datapoint or an attribute). A device no driver
# has goes the way it always did, through the relay (zbbridge_relay.be), which hands the
# host what it hears and the host's link out.
#
# A DRIVER is a class of the bridge's firmware, one class a file, that the
# relay's start adds to the host. Its contract, every method required:
#   static ID       a short name: the one a claim is kept by, in the flash
#   static VERSION  a number: of two drivers of one ID, the greater runs, so a driver
#                   delivered later takes the place of the one the firmware carries
#   static KIND     the kind the NSPanel gives its devices ("thermostat")
#   static KEYS     the attributes of a report that say a device may be the driver's, for
#                   a device nothing has yet: a thermostat's LocalTemperature ([] for none)
#   def init(host)
#   def claims(info)            true for a device that is the driver's, by `info`; it
#                               changes nothing and does not raise
#   def describe(info)          a new map: what the NSPanel needs to register the device
#   def on_report(info, attrs)  a raw report of one of its devices: it says what changed
#                               to the host, normalized (host.say)
#   def command(info, cmd)      a command of the NSPanel, {"id", "do", ...}: true when taken
#   def seed(info)              ask the device for its state: the link came up, or it is new
#   def forget(info)            the device left the network
# `info` is a plain map, in the words of Z2T:
#   "IEEEAddr"  the device's address as the NSPanel keys it ("0x00124B0000B00001")
#   "Device"    its short address, a number
#   "Manufacturer", "ModelId", "Name"   what Z2T has read of it, "" for what it has not
#   "Endpoint", "ProfileId", "DeviceId", "InClusters"   the interview of an endpoint, numbers:
#               only when the claim is made by one (Z2T's ZbState 33)
#   "report"    the attributes of a report: only when the claim is made by one
#
# THE LINK is two messages, and nothing of a device's own attributes crosses it.
#   ZbDriver, to the NSPanel, one key a device, each a section of what is said of it:
#     "d"  the description, in the place of the interview (ZbState 33) it replaces: the
#          driver's own words, and "kind", "drv" (the driver's ID) and "model"
#     "s"  the state: the fields that changed since the NSPanel last heard, "up" (false
#          for a device that stopped answering) among them
#     "v"  the values of the settings, as "s"
#     "x"  the settings' schema, a list, in numbered frames: {"at", "of", "l"}, the entries
#          from `at`, `of` of them in all
#     "e"  a command refused: "nodriver" (nothing has the device) or "refused"
#   ZbRelayDrive, from the NSPanel, a command of the relay: {"id": the device, "do": the
#     verb, ...what it takes}, which goes to the driver that has the device. The host
#     itself knows two verbs: "read" and "settings" ask for the whole of a state and the
#     whole of the values, and the NSPanel hears them all again, changed or not.
# Every message fits the frame of the link that is up (a line in tcp, 233 bytes in
# direct): what does not is split by field, and a list in numbered frames. And they go one at a
# time, FRAME_GAP_MS apart, the first at once: the ESP-NOW driver of the NSPanel keeps four frames
# for its main loop, busy with the one before, and drops the oldest of a longer burst.
#
# A DRIVER THE NSPANEL ASSIGNS has no device by itself: a switch of two channels is the same model on a lamp
# and on a motor. ZbRelayDrive {"id", "do": "assign", "v": {"drv": its ID, ...}} gives it the device with a configuration,
# which the host keeps in the flash and the driver reads (config), and {"do": "release"} takes it back.
# A configuration's "sensor", a door sensor's IEEE, sends the sensor's reports to the driver too (on_sensor).
#
# WHO HAS A DEVICE is kept in the flash: a claim made at the interview, where the
# clusters tell a thermostat's endpoint, is not one a restart can make again. A device
# the network already had is claimed by what the zigbee module says of it, at boot and
# whenever a link comes up, and one of a driver's KEYS in a report claims it too.

#@ solidify:ZbBridgeDrivers
class ZbBridgeDrivers
    # IEEE -> the ID of the driver that has it
    static KEY = "zb_relay_drivers"
    # IEEE -> the configuration of a device the NSPanel assigned a driver
    static CFG_KEY = "zb_relay_assigned"
    # what a driver says within this is one message
    static FLUSH_MS = 50
    # a link that came up hears the devices one by one, this far apart, the first after FIRST_MS
    static GAP_MS = 150
    static FIRST_MS = 500
    # the claims saved once they stop changing
    static SAVE_MS = 5000
    # a message to the NSPanel waits this long behind the one before
    static FRAME_GAP_MS = 80
    # Z2T takes some seconds to start: at boot the network is looked at every BOOT_MS, BOOT_TRIES times
    static BOOT_MS = 10000
    static BOOT_TRIES = 30
    # a device that joined again is asked for its state this long after its announce
    static REJOIN_MS = 2000

    var relay      # the relay: the link out (zbbridge_relay.be)
    var drivers    # the drivers, in the order they were added
    var claimed    # IEEE -> the driver that has it
    var kept       # IEEE -> the ID of the driver, as the flash keeps it
    var infos      # IEEE -> its `info`, as last seen
    var shorts     # short address -> IEEE, for the devices that are claimed
    var pending    # IEEE -> {section -> {field -> value}}: said, and not sent yet
    var last       # IEEE -> {section -> {field -> value}}: what the NSPanel has been told
    var armed      # the message with what is pending is on its way
    var queue      # the IEEEs waiting to be described to the NSPanel, one at a time
    var announcing # the timer that describes the next of them is on its way
    var outbox     # the messages waiting to go to the NSPanel, in order
    var pumping    # the timer that sends the next of them is on its way
    var waited     # how many times the network was looked at for the first time and was not up
    var deferred   # a link came up before Z2T did: every device is described once it is (boot_scan)
    var assigned   # IEEE -> the configuration of a device a driver was assigned, as the flash keeps it
    var watched    # a sensor's short address -> the IEEE of the device whose driver hears it

    def init(relay)
        import persist
        self.relay = relay
        self.drivers = []
        self.claimed = {}
        var k = persist.find(ZbBridgeDrivers.KEY, nil)
        self.kept = isinstance(k, map) ? k : {}
        var c = persist.find(ZbBridgeDrivers.CFG_KEY, nil)
        self.assigned = isinstance(c, map) ? c : {}
        self.watched = {}
        self.infos = {}
        self.shorts = {}
        self.pending = {}
        self.last = {}
        self.armed = false
        self.queue = []
        self.announcing = false
        self.outbox = []
        self.pumping = false
        self.waited = 0
        self.deferred = false
    end

    # --- the words of the network -------------------------------------------------------

    # "0x5adf" and "0x5ADF" are one address
    static def norm(a)
        import string
        a = str(a)
        if size(a) > 2 && (a[0 .. 1] == "0x" || a[0 .. 1] == "0X") return "0x" + string.toupper(a[2 ..]) end
        return string.toupper(a)
    end

    # A short address, "0x010D" as Z2T writes one or a number: the number, nil for what is neither
    static def num(v)
        import string
        if type(v) == "int" return v end
        var s = str(v)
        if size(s) > 2 && string.tolower(s[0 .. 1]) == "0x" return int(s) end
        return nil
    end

    # the IEEE of 8 bytes, least significant first, as Z2T prints it
    static def ieee_hex(b)
        import string
        var s = "0x"
        var i = size(b) - 1
        while i >= 0
            s += string.format("%02X", b[i])
            i -= 1
        end
        return s
    end

    # what the zigbee module says of a device, as `info`: nothing else is asked of Z2T
    static def info_from(z)
        return {
            "IEEEAddr": ZbBridgeDrivers.ieee_hex(z.longaddr),
            "Device": z.shortaddr,
            "Manufacturer": z.manufacturer != nil ? z.manufacturer : "",
            "ModelId": z.model != nil ? z.model : "",
            "Name": z.name != nil ? z.name : ""
        }
    end

    # A device of the network by its address, as `info`, or nil: with Z2T not up, or
    # not knowing it. `key` is "0x5ADF", or an IEEE, as the zigbee module takes them
    def find_info(key)
        import global
        if !global.contains("zigbee") || global.zigbee.started() != true return nil end
        var z = global.zigbee.find(key)
        return z == nil ? nil : ZbBridgeDrivers.info_from(z)
    end

    def find_short(short)
        import string
        return self.find_info(string.format("0x%04X", short))
    end

    # --- the drivers and who has what ------------------------------------------------------

    # A driver in the host. Of two with one ID the greater VERSION runs; the devices the
    # flash keeps for its ID are its own
    def add(driver)
        var i = 0
        while i < size(self.drivers)
            var d = self.drivers[i]
            if d.ID == driver.ID
                if driver.VERSION <= d.VERSION return false end
                self.drivers[i] = driver
                self.bind(driver)
                return true
            end
            i += 1
        end
        self.drivers.push(driver)
        self.bind(driver)
        return true
    end

    # the devices of a driver's ID are the driver's, a new one's of the same ID included
    def bind(driver)
        for ieee: self.kept.keys()
            if self.kept[ieee] == driver.ID  self.claimed[ieee] = driver end
        end
    end

    # The driver that has a device, by what is known of it, or nil. Asked in order, and the
    # first to say yes keeps the device for good: in the flash
    def claim(info)
        var ieee = info["IEEEAddr"]
        var have = self.claimed.find(ieee)
        if have != nil return have end
        for d: self.drivers
            var yes = false
            try
                yes = d.claims(info) == true
            except .. as e, m
                ZbBridgeDrivers.fail(d.ID, "claims", e, m)
            end
            if yes
                self.claimed[ieee] = d
                if self.kept.find(ieee) != d.ID
                    self.kept[ieee] = d.ID
                    self.save_later()
                end
                log("ZBBRIDGE_DRIVERS: " + ieee + " is " + d.ID + "'s", 2)
                return d
            end
        end
        return nil
    end

    static def fail(id, what, e, m)
        log("ZBBRIDGE_DRIVERS: " + str(id) + " failed on " + what + " - " + str(e) + ": " + str(m), 2)
    end

    # a claimed device seen: its info, and the address its reports come from
    def enroll(info)
        var ieee = info["IEEEAddr"]
        var short = info.find("Device")
        self.infos[ieee] = info
        if short == nil return end
        var stale = []
        for s: self.shorts.keys()
            if self.shorts[s] == ieee && s != short  stale.push(s) end
        end
        for s: stale  self.shorts.remove(s) end
        self.shorts[short] = ieee
    end

    # The claims saved once they stop changing. The map goes through persist.setmember:
    # a map changed in place is not written by a save alone
    def save_later()
        import persist
        persist.setmember(ZbBridgeDrivers.KEY, self.kept)
        persist.setmember(ZbBridgeDrivers.CFG_KEY, self.assigned)
        tasmota.remove_timer("zbbridge_drivers_save")
        tasmota.set_timer(ZbBridgeDrivers.SAVE_MS, / -> self.save_now(), "zbbridge_drivers_save")
    end

    def save_now()
        PairSign.safe_save("ZBBRIDGE_DRIVERS")
    end

    # A claimed device's info: the one kept, or what the zigbee module says of it now, or only its address
    def info_for(ieee)
        var info = self.infos.find(ieee)
        if info != nil return info end
        info = self.find_info(ieee)
        if info == nil return {"IEEEAddr": ieee, "Manufacturer": "", "ModelId": "", "Name": ""} end
        self.enroll(info)
        return info
    end

    # --- what the relay hears ------------------------------------------------------------

    # The interview of an endpoint (Z2T's ZbState 33), handed over before the relay sends it
    # on: true when a driver has the device, and its description goes to the NSPanel where
    # the interview would have. A false is the interview going the way it always did
    def interview(s)
        if size(self.drivers) == 0 return false end
        try
            var info = self.find_info(str(s.find("Device")))
            if info == nil return false end
            info["Endpoint"] = ZbBridgeDrivers.num(s.find("Endpoint", 0))
            info["ProfileId"] = ZbBridgeDrivers.num(s.find("ProfileId", 0))
            info["DeviceId"] = ZbBridgeDrivers.num(s.find("DeviceId", 0))
            var clusters = []
            for c: s.find("InClusters", [])
                var n = ZbBridgeDrivers.num(c)
                if n != nil  clusters.push(n) end
            end
            info["InClusters"] = clusters
            if self.claim(info) == nil return false end
            self.enroll(info)
            self.announce(info["IEEEAddr"])
            return true
        except .. as e, m
            ZbBridgeDrivers.fail("host", "an interview", e, m)
        end
        return false
    end

    # A join, or a device back with its power (Z2T's ZbState 30): its address may be a new one,
    # and one of ours is asked for what it says a moment later, when it can answer
    def announced(s)
        var ieee = s.find("IEEEAddr")
        var short = ZbBridgeDrivers.num(s.find("ShortAddr"))
        if type(ieee) != "string" || short == nil return end
        ieee = ZbBridgeDrivers.norm(ieee)
        if !self.claimed.contains(ieee) return end
        var info = self.infos.find(ieee)
        if info == nil
            info = {"IEEEAddr": ieee, "Manufacturer": "", "ModelId": "", "Name": ""}
        end
        info["Device"] = short
        self.enroll(info)
        tasmota.set_timer(ZbBridgeDrivers.REJOIN_MS, / -> self.announce(ieee), "zbbridge_drivers_rejoin_" + ieee)
    end

    # What the network reported (ZbReceived, the relay's {address -> attributes}): each device's own
    # reports go to the driver that has it. Most are a lamp's, no driver's, and cost a lookup
    def on_received(recv)
        if size(self.drivers) == 0 return end
        try
            for key: recv.keys()
                var attrs = recv[key]
                if !isinstance(attrs, map) continue end
                var short = ZbBridgeDrivers.num(attrs.find("Device", key))
                if short == nil continue end
                var w = self.watched.find(short)
                if w != nil  self.sensed(w, attrs) end
                var ieee = self.shorts.find(short)
                if ieee == nil  ieee = self.late(short, attrs) end
                if ieee != nil  self.hear(ieee, attrs) end
            end
        except .. as e, m
            ZbBridgeDrivers.fail("host", "a report", e, m)
        end
    end

    # A report of an address nothing has: a device a driver may claim by this very report, or one
    # of ours that the address of is not known yet
    def late(short, attrs)
        if !self.worth(attrs) return nil end
        var info = self.find_short(short)
        if info == nil return nil end
        var ieee = info["IEEEAddr"]
        var fresh = false
        if !self.claimed.contains(ieee)
            info["report"] = attrs
            var d = self.claim(info)
            info.remove("report")
            if d == nil return nil end
            fresh = true
        end
        self.enroll(info)
        # a device the driver takes by its own report is described to the NSPanel before its words follow, as an
        # interview's is: without it the NSPanel has no thermostat, or has one it took for a sensor
        if fresh  self.announce(ieee) end
        return ieee
    end

    # a report that says a device may be a driver's: its model or maker, or an attribute a driver is after
    def worth(attrs)
        if attrs.contains("Manufacturer") || attrs.contains("ModelId") return true end
        for d: self.drivers
            for k: d.KEYS
                if attrs.contains(k) return true end
            end
        end
        return false
    end

    # a report of a device of ours: whether it answers, from the host; the rest, from its driver
    def hear(ieee, attrs)
        var d = self.claimed.find(ieee)
        if d == nil return end
        if attrs.contains("Reachable")  self.say(ieee, "s", {"up": attrs["Reachable"] != false}) end
        try
            d.on_report(self.info_for(ieee), attrs)
        except .. as e, m
            ZbBridgeDrivers.fail(d.ID, "a report", e, m)
        end
    end

    # a sensor's report, to the driver of the device it goes with
    def sensed(ieee, attrs)
        var d = self.claimed.find(ieee)
        if d == nil return end
        try
            d.on_sensor(self.info_for(ieee), attrs)
        except .. as e, m
            ZbBridgeDrivers.fail(d.ID, "a sensor's report", e, m)
        end
    end

    # --- the drivers the NSPanel assigns --------------------------------------

    # a device's configuration, {} for one with none
    def config(ieee) return self.assigned.find(ieee, {}) end

    # one field of it, from a setting: kept in the flash
    def configure(ieee, key, v)
        var c = self.assigned.find(ieee)
        if c == nil return end
        c[key] = v
        self.save_later()
        if key == "sensor"  self.rewatch() end
    end

    # The driver of an ID, given a device with its configuration: the device is its own, the configuration in the flash, the
    # driver told it has it, and the NSPanel told what it is. One assigned again keeps what it had where the new says nothing
    def assign(ieee, cfg)
        if !isinstance(cfg, map) return false end
        # a configuration that names no driver is for the one the device has
        var id = cfg.find("drv", self.kept.find(ieee))
        var d = nil
        for x: self.drivers
            if x.ID == id  d = x end
        end
        if d == nil return false end
        var have = self.claimed.find(ieee)
        if have != nil && have != d  self.release(ieee) end
        var c = self.assigned.find(ieee, {})
        for k: cfg.keys()  c[k] = cfg[k] end
        self.assigned[ieee] = c
        self.claimed[ieee] = d
        self.kept[ieee] = d.ID
        self.save_later()
        var info = self.find_info(ieee)
        if info != nil  self.enroll(info) end
        self.rewatch()
        self.last.remove(ieee)
        try
            d.command(self.info_for(ieee), {"do": "assigned"})
        except .. as e, m
            ZbBridgeDrivers.fail(d.ID, "assigned", e, m)
        end
        self.announce(ieee)
        log("ZBBRIDGE_DRIVERS: " + ieee + " assigned to " + d.ID, 2)
        return true
    end

    # A device given back: no driver has it, its configuration goes, and its reports go to the NSPanel as a switch's again
    def release(ieee)
        var d = self.claimed.find(ieee)
        if d != nil
            try
                d.forget(self.info_for(ieee))
            except .. as e, m
                ZbBridgeDrivers.fail(d.ID, "forget", e, m)
            end
        end
        self.claimed.remove(ieee)
        self.kept.remove(ieee)
        self.assigned.remove(ieee)
        self.pending.remove(ieee)
        self.last.remove(ieee)
        var stale = []
        for s: self.shorts.keys()
            if self.shorts[s] == ieee  stale.push(s) end
        end
        for s: stale  self.shorts.remove(s) end
        self.rewatch()
        self.save_later()
        self.refresh_discovery(ieee)
        log("ZBBRIDGE_DRIVERS: " + ieee + " released", 2)
        return true
    end

    # The sensors the configurations name, by their short address now: at an assignment, and with every link and scan, as a
    # sensor that joined again has another
    def rewatch()
        self.watched = {}
        for ieee: self.assigned.keys()
            var sensor = self.assigned[ieee].find("sensor", "")
            if type(sensor) != "string" || sensor == "" continue end
            var info = self.find_info(sensor)
            if info != nil && info.find("Device") != nil  self.watched[info["Device"]] = ieee end
        end
    end

    # whether a short address is a device a driver has: the relay sends its raw state no more, the driver speaking for it
    def owns(addr)
        var short = ZbBridgeDrivers.num(addr)
        return short != nil && self.shorts.contains(short)
    end

    # --- what the drivers do ---------------------------------------------------------------

    # A command of a driver to its device through Z2T, as the console would take it: the alarm is told first, for the reports that
    # answer it for a moment are the device's echo and not a hand on it, which eight toggles of a gate's relay in two seconds would
    # be for its burst detector. The commands of the panel and of Home Assistant are told by the relay and by
    # the discovery. A read does not change the device and has no echo: one that runs in a loop goes quiet, as the line it is said
    # in the log and the MQTT (`quiet`), and is not told
    def zb_send(line, quiet)
        if quiet
            tasmota.cmd("_" + line, true)
            return
        end
        var a = self.relay != nil ? self.relay.alarm : nil
        if a != nil  a.commanded(line) end
        tasmota.cmd(line)
    end

    # --- what the drivers say --------------------------------------------------------------

    # What a driver says of a device, {field: value} in a section ("s", "v"): what is said within
    # FLUSH_MS is one message, and what the NSPanel has already been told is left out
    def say(ieee, section, fields)
        if !self.claimed.contains(ieee) || !isinstance(fields, map) return end
        var p = self.pending.find(ieee)
        if p == nil
            p = {}
            self.pending[ieee] = p
        end
        var s = p.find(section)
        if s == nil
            s = {}
            p[section] = s
        end
        for k: fields.keys()  s[k] = fields[k] end
        if !self.armed
            self.armed = true
            tasmota.set_timer(ZbBridgeDrivers.FLUSH_MS, / -> self.flush(), "zbbridge_drivers_send")
        end
    end

    def flush()
        self.armed = false
        var pend = self.pending
        self.pending = {}
        for ieee: pend.keys()
            for section: pend[ieee].keys()
                var delta = self.changed(ieee, section, pend[ieee][section])
                if size(delta) > 0  self.send_fields(ieee, section, delta) end
            end
        end
    end

    # what of `fields` the NSPanel has not been told, which it now is
    def changed(ieee, section, fields)
        var l = self.last.find(ieee)
        if l == nil
            l = {}
            self.last[ieee] = l
        end
        var known = l.find(section)
        if known == nil
            known = {}
            l[section] = known
        end
        var delta = {}
        for k: fields.keys()
            if !known.contains(k) || known[k] != fields[k]
                known[k] = fields[k]
                delta[k] = fields[k]
            end
        end
        return delta
    end

    # `fields` {name: value}, in as few maps as fit `budget` once `wrap` has put each in its
    # message: a field is never cut. One that alone does not fit is dropped, and the log says which
    static def pack(fields, wrap, budget)
        import json
        var out = []
        var cur = {}
        for k: fields.keys()
            cur[k] = fields[k]
            if size(json.dump(wrap(cur))) <= budget continue end
            if size(cur) > 1
                cur.remove(k)
                out.push(cur)
                cur = {}
                cur[k] = fields[k]
                if size(json.dump(wrap(cur))) <= budget continue end
            end
            log("ZBBRIDGE_DRIVERS: " + str(k) + " is " + str(size(json.dump(wrap(cur)))) + " bytes with its message, and does not fit in " +
                str(budget) + ", dropped", 2)
            cur = {}
        end
        if size(cur) > 0  out.push(cur) end
        return out
    end

    # A message to the NSPanel: at once when none is on its way, and else after the ones before it, FRAME_GAP_MS apart
    def emit(msg)
        self.outbox.push(msg)
        if !self.pumping  self.pump() end
    end

    def pump()
        if size(self.outbox) == 0
            self.pumping = false
            return
        end
        self.pumping = true
        var msg = self.outbox[0]
        self.outbox.remove(0)
        self.relay.send_event(msg)
        tasmota.set_timer(ZbBridgeDrivers.FRAME_GAP_MS, / -> self.pump(), "zbbridge_drivers_frames")
    end

    def send_fields(ieee, section, fields)
        var wrap = / m -> {"ZbDriver": {ieee: {section: m}}}
        for chunk: ZbBridgeDrivers.pack(fields, wrap, self.relay.frame_budget())
            self.emit(wrap(chunk))
        end
    end

    # one frame of a list: where it starts, how many there are, and these
    static def list_frame(ieee, section, at, total, entries)
        return {"ZbDriver": {ieee: {section: {"at": at, "of": total, "l": entries}}}}
    end

    # A list the NSPanel needs whole (the settings' schema), in the frames the link carries, numbered by
    # where each starts. An entry that fits no frame stops it and nothing goes: a list with a hole is
    # worse than none, and the NSPanel asks again
    def send_list(ieee, section, entries)
        import json
        if !self.claimed.contains(ieee) || !isinstance(entries, list) return false end
        var budget = self.relay.frame_budget()
        var total = size(entries)
        var frames = []
        var at = 0
        var cur = []
        var i = 0
        while i < total
            cur.push(entries[i])
            if size(json.dump(ZbBridgeDrivers.list_frame(ieee, section, at, total, cur))) > budget
                if size(cur) == 1
                    log("ZBBRIDGE_DRIVERS: entry " + str(i) + " of " + section + " does not fit a frame of " + str(budget) +
                        " bytes, the list is not sent", 2)
                    return false
                end
                cur.remove(size(cur) - 1)
                frames.push(ZbBridgeDrivers.list_frame(ieee, section, at, total, cur))
                at = i
                cur = []
            else
                i += 1
            end
        end
        if size(cur) > 0 || total == 0  frames.push(ZbBridgeDrivers.list_frame(ieee, section, at, total, cur)) end
        for f: frames  self.emit(f) end
        return true
    end

    # --- what the NSPanel hears of a device, and when --------------------------------------------

    # The description of a device (section "d"), and then its state, which the driver is asked for. The
    # host adds the kind, the driver's ID and the model, and a driver that describes nothing has no device
    def announce(ieee)
        import json
        var d = self.claimed.find(ieee)
        if d == nil return end
        var info = self.find_info(ieee)
        if info != nil
            self.enroll(info)
        else
            info = self.infos.find(ieee, {"IEEEAddr": ieee})
        end
        var desc = nil
        try
            desc = d.describe(info)
        except .. as e, m
            ZbBridgeDrivers.fail(d.ID, "describe", e, m)
        end
        if !isinstance(desc, map) return end
        desc["kind"] = d.KIND
        desc["drv"] = d.ID
        if info.find("ModelId", "") != ""  desc["model"] = info["ModelId"] end
        var msg = {"ZbDriver": {ieee: {"d": desc}}}
        if size(json.dump(msg)) > self.relay.frame_budget()
            log("ZBBRIDGE_DRIVERS: the description of " + ieee + " is " + str(size(json.dump(msg))) + " bytes and does not fit a frame, dropped", 2)
            return
        end
        self.emit(msg)
        try
            d.seed(info)
        except .. as e, m
            ZbBridgeDrivers.fail(d.ID, "seed", e, m)
        end
        self.refresh_discovery(ieee)
    end

    # Home Assistant hears of a device what its driver says of it (zbbridge_discovery.be: a gate of two keys is a cover with no stop): the discovery is told
    # when the device is described again, and when it is given back, and it announces the device again only if what its driver puts in the announcement
    # changed. The mode and the inputs of a gate are the driver's, and the description says them
    def refresh_discovery(ieee)
        var dc = self.relay != nil ? self.relay.discovery : nil
        if dc == nil return end
        try
            dc.refresh(ieee)
        except .. as e, m
            ZbBridgeDrivers.fail("host", "the discovery", e, m)
        end
    end

    # A link came up: the NSPanel hears everything again, each device in its turn, and the network is
    # looked at for the devices a driver may have that the host does not know
    def link_up()
        import global
        if size(self.drivers) == 0 return end
        try
            self.last = {}
            self.pending = {}
            self.outbox = []
            self.queue = []
            self.announcing = false
            tasmota.remove_timer("zbbridge_drivers_announce")
            # before Z2T is up nothing of the network is known, and a device's seed would be answered "Zigbee not started": boot_scan describes
            # every device once it is, a claim the network does not have gone first
            if !global.contains("zigbee") || global.zigbee.started() != true
                self.deferred = true
                return
            end
            self.scan()
            self.rewatch()
            self.announce_soon(self.claimed.keys())
        except .. as e, m
            ZbBridgeDrivers.fail("host", "a link up", e, m)
        end
    end

    # Devices to describe to the NSPanel, each in its turn: the first FIRST_MS from now, for what the link has to
    # say first, the others GAP_MS apart. One already waiting is not put twice, and the timer that is on its way takes
    # what is added to the queue
    def announce_soon(ids)
        for ieee: ids
            if self.queue.find(ieee) == nil  self.queue.push(ieee) end
        end
        if size(self.queue) > 0 && !self.announcing
            self.announcing = true
            tasmota.set_timer(ZbBridgeDrivers.FIRST_MS, / -> self.announce_next(), "zbbridge_drivers_announce")
        end
    end

    def announce_next()
        if size(self.queue) == 0
            self.announcing = false
            return
        end
        var ieee = self.queue[0]
        self.queue.remove(0)
        self.announce(ieee)
        if size(self.queue) > 0
            tasmota.set_timer(ZbBridgeDrivers.GAP_MS, / -> self.announce_next(), "zbbridge_drivers_announce")
        else
            self.announcing = false
        end
    end

    # Every device the network has: the claimed ones known again, by address, and the others offered to
    # the drivers by what the module says of them. The IEEEs a driver took just now
    def scan()
        var fresh = []
        import global
        if size(self.drivers) == 0 || !global.contains("zigbee") || global.zigbee.started() != true return fresh end
        for z: global.zigbee
            var info = ZbBridgeDrivers.info_from(z)
            var ieee = info["IEEEAddr"]
            if self.claimed.contains(ieee)
                self.enroll(info)
            elif self.claim(info) != nil
                self.enroll(info)
                fresh.push(ieee)
            end
        end
        return fresh
    end

    # At boot, once Z2T is up: it takes a few seconds, so the network is looked at again until it is
    def boot()
        if size(self.drivers) == 0 return end
        tasmota.set_timer(ZbBridgeDrivers.BOOT_MS, / -> self.boot_scan(), "zbbridge_drivers_boot")
        # a device forgotten at the console, as from the NSPanel's glass (the relay's run): its claim goes once Z2T's list has changed
        tasmota.add_rule("ZbForget", / -> self.check_later(1000), "zbbridge_drivers_forget")
    end

    def boot_scan()
        import global
        if global.contains("zigbee") && global.zigbee.started() == true
            # what the flash kept of a device the network no longer has goes first: one forgotten while this bridge was off, or at its console
            # before the rule that hears it was there, is no device to describe to the panels nor to ask for its state (a
            # curtain moved to another bridge would still be described by the first one at every boot)
            # with a network that lists nothing, nothing is dropped: Z2T may not have loaded its list, and a driver's configuration would go with it
            if global.zigbee.size() > 0  self.check(true) end
            var fresh = self.scan()
            # a link up before Z2T was has had nothing: every device is described now; with none, what this finds, and a link still to come
            # hears all of it anyway
            self.announce_soon(self.deferred ? self.claimed.keys() : fresh)
            self.deferred = false
        elif self.waited < ZbBridgeDrivers.BOOT_TRIES
            self.waited += 1
            tasmota.set_timer(ZbBridgeDrivers.BOOT_MS, / -> self.boot_scan(), "zbbridge_drivers_boot")
        end
    end

    # --- the NSPanel's commands -------------------------------------------------------------------

    # A refusal, to the NSPanel: its command found no driver, or the driver would not take it
    def refuse(ieee, why)
        self.emit({"ZbDriver": {ieee: {"e": why}}})
    end

    # The relay's ZbRelayDrive: {"id": the device, "do": the verb, ...}, to the driver that has the device
    def drive(payload)
        import json
        var m = json.load(str(payload))
        var id = isinstance(m, map) ? m.find("id") : nil
        var verb = isinstance(m, map) ? m.find("do") : nil
        if type(id) != "string" || type(verb) != "string"
            tasmota.resp_cmnd_failed()
            return
        end
        var ieee = ZbBridgeDrivers.norm(id)
        # a driver the NSPanel assigns, or takes back
        if verb == "assign" || verb == "release"
            var ok = verb == "assign" ? self.assign(ieee, m.find("v")) : self.release(ieee)
            if ok
                tasmota.resp_cmnd_done()
            else
                self.refuse(ieee, "refused")
                tasmota.resp_cmnd_failed()
            end
            return
        end
        var d = self.claimed.find(ieee)
        if d == nil
            self.refuse(ieee, "nodriver")
            tasmota.resp_cmnd_failed()
            return
        end
        # What a command says back goes whole: what the NSPanel was told is told again, changed or not. A word is marked as heard when it
        # is sent and not when it arrives, and one lost (a blind's last "stop") left its card as it was, with a tap that said stop
        # and an answer with nothing changed to send. A read and the settings are only the commands that ask for exactly that
        self.last.remove(ieee)
        var taken = false
        try
            taken = d.command(self.info_for(ieee), m) == true
        except .. as e, msg
            ZbBridgeDrivers.fail(d.ID, verb, e, msg)
        end
        if taken
            tasmota.resp_cmnd_done()
        else
            self.refuse(ieee, "refused")
            tasmota.resp_cmnd_failed()
        end
    end

    # --- a device that left ------------------------------------------------------------------------

    # A device removed, from the NSPanel's glass or the console (ZbForget, ZbLeave): its claim goes a
    # moment later, once Z2T's list has changed
    def check_later(ms)
        tasmota.set_timer(ms, / -> self.check(), "zbbridge_drivers_check")
    end

    # the claims of a device the network no longer has, dropped. At boot (`boot`), only a claim a driver took by itself, which it takes again if the device
    # comes back: one the NSPanel assigned, with its configuration, goes only when the device is forgotten
    def check(boot)
        import global
        if !global.contains("zigbee") || global.zigbee.started() != true return end
        var present = {}
        for z: global.zigbee
            present[ZbBridgeDrivers.ieee_hex(z.longaddr)] = true
        end
        var gone = []
        for ieee: self.kept.keys()
            if !present.contains(ieee) && !(boot == true && self.assigned.contains(ieee))  gone.push(ieee) end
        end
        for ieee: gone  self.drop(ieee) end
    end

    def drop(ieee)
        var d = self.claimed.find(ieee)
        if d != nil
            try
                d.forget(self.infos.find(ieee, {"IEEEAddr": ieee}))
            except .. as e, m
                ZbBridgeDrivers.fail(d.ID, "forget", e, m)
            end
        end
        self.claimed.remove(ieee)
        self.kept.remove(ieee)
        self.assigned.remove(ieee)
        self.infos.remove(ieee)
        self.pending.remove(ieee)
        self.last.remove(ieee)
        var stale = []
        for s: self.shorts.keys()
            if self.shorts[s] == ieee  stale.push(s) end
        end
        for s: stale  self.shorts.remove(s) end
        self.save_later()
        log("ZBBRIDGE_DRIVERS: " + ieee + " left the network, no driver has it any more", 2)
    end
end
