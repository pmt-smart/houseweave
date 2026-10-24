# zbbridge_alarm.be -- the house alarm of one bridge: the sensors' roles, the states of the alarm,
# the notifications by grade, the panic, the events, the supervision of a sensor that goes quiet and of a siren that cannot
# be reached (a siren is told again, with a ladder, until it confirms), what a restart leaves on or loses, and what is said of all of it to the panel
# on the link and, through the listeners, to Home Assistant.
#
# It lives on the bridge, which owns the Zigbee network and hears every report. Until the house mesh
# exists the bridge is the leader of its own alarm: one alarm, one room.
#
# A SENSOR enters it by its record, kept in the flash (zb_alarm_cfg), which a panel writes over the link (ZbRelayAlarm):
#   role    "off" (not in the alarm), "perimeter" (watches armed at home or away), "interior" (away only), "24h" (always)
#   entry   a perimeter sensor that grants the entry time: the door one comes in by
#   notify  "off", "local", "house" or "alert": the grade of the notification it raises on its own
#   sound   it asks for the beep
#   cond    a numeric sensor's condition, {"k": the key a report says it by, "w": "above" or "below", "x": the limit}: a
#           notification is raised on crossing, and clears 2 units back
#   news    the hours of silence after which it is reported quiet, 4 by default
#
# THE STATES are Home Assistant's alarm_control_panel states: disarmed, arming (the exit time),
# armed_home, armed_away, pending (the entry time), triggered. A 24 h sensor or the panic triggers it from any state;
# when the siren time ends, it goes back to what it was. Disarming is from any state, and the one that wins.
#
# WITH A REPLICA (zbbridge_alarm_merge.be, zbbridge_alarm_mesh.be): a bridge that has an alarm number and a running mesh keeps the
# alarm's STATE in a replica that the bridges of the house share, and what it shows and acts on is what the replica says. A person or a sensor that
# arms, disarms or triggers does it through the replica (act), and the state follows from it (look, shift): the exit time and the siren's time are counted
# from the mark of the replica's record, and not from the moment this bridge learned of it, so that a bridge that hears of an arm late, or of a trigger
# that is over, does not start them again. The entry time is this bridge's own, as pending is: no record says it. The record carries the state and the
# time and nothing of who or why, so a change that came from another bridge is told here as made by "bridge N" (its alarm number), with no sensor
# as the cause; and the siren's time ending silences the siren and leaves the state triggered until a disarm, where one bridge alone goes
# back to what it was. A bridge with no alarm number, no mesh driver in its image or the mesh off has no replica, and all of this is as it was: until the
# replica is up, which is a few seconds after the boot, the alarm is that bridge's own, and what it did meanwhile goes into the replica as its first action.
# The alarm number is the interim of zbbridge_alarm_mesh.be: the console command ZbAlarmSlot <n>, or the mesh number when that is 1 to 15.
#
# HOME ASSISTANT sees one alarm_control_panel, in the states above, which arms away and home and disarms with no code (the pattern is the glass's, and Home Assistant commands everything),
# and one event entity that carries
# every event, with its grade, for the automations. Both are announced when the broker connects, as the Zigbee devices'
# discovery does (zbbridge_discovery.be), and not at all while the panel has that discovery off.
#
# THE LINK is one message, ZbAlarm, to the panel: {"st", "md", "v", "c"} the state, its mode, its version and its cause
# ([sensor, kind]); {"ev": [id, time, type, who or sensor, grade, value, sound]} an event; {"clr": sensor} a notice that
# went away by itself; {"ack": id or "all"}; {"del": [ids]} events deleted; and {"log": [events], "at", "of"} the last events, asked for; and the settings it is asked
# for, {"cfg"} and the lists {"np"}, {"pd"} and {"sr"}, a few entries to a message, each after the first with the "at" of its place
# in the list. The panel speaks to it with ZbRelayAlarm {"do": ...}: arm, disarm, panic, ack, del, state, log, config, sensor, times,
# panic_cfg, siren, burst, and panic_act, which the relay takes (zbbridge_relay.be).

#@ solidify:ZbBridgeAlarm
class ZbBridgeAlarm
    static CFG_KEY = "zb_alarm_cfg"
    static STATE_KEY = "zb_alarm_state"
    static LOG_KEY = "zb_alarm_log"
    static LOST_KEY = "zb_alarm_lost"
    # the events kept in RAM, and the changes of state kept in the flash
    static EVENT_MAX = 64
    static LOG_MAX = 16
    # a numeric condition clears this far back from its limit
    static MARGIN = 2
    # the sensors are looked at for silence this often, and are quiet after NEWS_H hours
    static CHECK_S = 60
    static NEWS_H = 4
    # the event numbers restart this far above the last saved, so that a restart does not repeat one; the number is saved at every boot
    # and at every EID_SAVE events, which is under the gap
    static EID_GAP = 1000
    static EID_SAVE = 100
    # a change of state is said to be "applying" for this long, whatever the reach: the sirens' orders go at 0, 1 and 3 s, and the glass does not
    # swing between complete and partial at each one
    static APPLYING_MS = 5000
    # a log message carries this many events
    static LOG_CHUNK = 3
    # a message of the settings carries this many of a list's entries: six pairs of a device and its action are 214 bytes of the 233
    # a frame holds, and six addresses fewer
    static LIST_CHUNK = 6
    # a save that fell over is tried again after this long
    static RETRY_MS = 5000
    # a message to the panel waits this long behind the one before: its ESP-NOW driver keeps four frames for its loop, busy with
    # the one before, and drops the oldest of a longer burst (zbbridge_drivers.be, FRAME_GAP_MS)
    static FRAME_GAP_MS = 80
    static T_OUT = "zb_alarm_out"
    # a burst of activations by one device is the panic: this many in this many seconds, and the reports of a device that
    # follow a command of ours by this long are its echo, not a hand on it
    static BURST = [8, 3]
    static ECHO_MS = 2000
    # what Z2T names an alarm's state by its zone type, and the occupancy cluster, and what each is
    static BINARY = ["Contact", "Occupancy", "Water", "Fire", "CO"]
    static KIND_OF = {"Contact": "open", "Occupancy": "motion", "Water": "water", "Fire": "smoke", "CO": "co"}
    static ROLES = ["off", "perimeter", "interior", "24h"]
    static GRADES = ["off", "local", "house", "alert"]
    # the events that are changes of state, which the flash keeps
    static STATE_EVENTS = ["arm", "disarm", "trigger", "panic"]
    # the words of the panel that set the alarm up
    static SETS = ["sensor", "times", "panic_cfg", "siren", "burst"]
    # a siren is told again, with a ladder, until it confirms: the waits after the first order, the wait after the ladder, and
    # the slower wait after SLOW_AFTER_MS with no confirmation. The fifth order with no word is a siren with no confirmation
    static LADDER = [1000, 2000, 4000, 8000]
    static TAIL_MS = 15000
    static SLOW_AFTER_MS = 600000
    static SLOW_MS = 60000
    # the ids of the timers
    static T_AGAIN = "zb_alarm_again"
    static T_EXIT = "zb_alarm_exit"
    static T_ENTRY = "zb_alarm_entry"
    static T_SIREN = "zb_alarm_siren"
    static T_CHECK = "zb_alarm_check"
    static T_APPLY = "zb_alarm_apply"
    # a bridge whose replica is not up yet leaves the alarm to Home Assistant's door to the others for this long, and then answers for it as a bridge alone does
    static DOOR_WAIT_MS = 120000
    # Home Assistant: where the alarm's topics are, and the events its event entity knows
    static BASE = "zigbee/alarm"
    # a command of Home Assistant is not taken for this long after the broker connects: the broker hands back the retained ones
    static HOLD_MS = 3000
    static EVENT_TYPES = ["arm", "disarm", "trigger", "panic", "bypass", "siren_off", "open", "motion", "water", "smoke", "co", "above",
                          "below", "tamper", "battery", "nonews", "config", "unreach"]

    var relay      # the relay: the link out, and the drivers (zbbridge_relay.be), or nil
    var cfg        # {"sensors", "times", "panic", "sirens"}, as the flash keeps it
    var st         # the state
    var mode       # "home" or "away" while armed, arming, pending or triggered from an armed state; nil otherwise
    var back       # the state a trigger goes back to when the siren time ends
    var ver        # the state's version, up at every change
    var cause      # [sensor, kind] of the trigger or the entry, or nil
    var eid        # the last event number
    var events     # the last events, maps
    var seen       # event number -> true: the ones a panel or Home Assistant took as seen
    var cur        # sensor -> true while its zone is on (open, motion, water...)
    var crossed    # sensor -> true while its numeric condition holds
    var lows       # sensor -> true while it says its battery is low
    var tam        # sensor -> true while it says it is tampered with
    var quiet      # sensor -> true while it is reported quiet
    var zone       # device -> true while its zone was last on, for the activations of a burst
    var power      # device -> the last Power it said, for the same
    var rings      # device -> the times (millis) of its last activations, within the burst's window
    var echo       # device -> the millis until which its reports are the echo of a command of ours
    var echo_all   # the millis until which every device's are, after a command to a group
    var bypassed   # sensor -> true: left out of this arming, because it was on when the alarm was armed
    var listeners  # closures f(kind, payload): "state" and "event", for Home Assistant
    var emit       # a closure that takes the message in place of the link, for a test; nil sends it to the panel
    var tap        # a closure that sees each message as it goes to the panel, for a test; nil sees none
    var outbox     # the messages waiting to go to the panel, in order
    var pumping    # the timer that sends the next of them is on its way
    var up         # the broker was connected at the last second
    var subscribed # the alarm's command topic was subscribed to
    var uid        # the alarm's id in Home Assistant, from this bridge's topic
    var seen_fn    # a closure sensor -> seconds since its last word, for a test; nil asks the zigbee module
    var resolve_fn # a closure key -> IEEE, for a test; nil asks the zigbee module
    var zones_fn   # a closure that gives the attributes Z2T has of each sensor, ieee -> map, for a test; nil asks the zigbee module
    var reach_fn   # a closure device -> whether Z2T has it reachable (true, false, or nil when nothing says), for a test; nil asks the zigbee module
    var want_on    # what the sirens are ordered to be, true or false, or nil before the first order
    var sent       # the orders after the first that were sent for this one
    var asked      # the millis of the order
    var told       # siren -> true once it said it is as ordered
    var lostset    # id -> [kind, grade]: what the alarm has lost and not found again, the kind "sensor", "siren" or "bridge"; kept in the flash
    var heard_at   # sensor -> the millis of its last word to this alarm: the silence counts from the air time, and not from a wall clock
    var boot_ms    # the millis of this alarm's start: a sensor that has said nothing since is silent from here
    var unprot     # how many devices the arm that holds left unprotected, with no replica to carry it
    var door       # this bridge is the door of the house's alarm to Home Assistant, as the mesh's election says
    var ha_done    # the alarm's entities were announced to Home Assistant on this connection, by the bridge that is the door
    var boot       # the siren is still to be sent off, once Z2T is up: a restart may have left it on
    var hold       # the millis until which Home Assistant's commands are not taken, after the broker connected, or nil
    var retry      # the millis at which a save of the flash that fell over is tried again, or nil
    var mesh       # the replica on the mesh (zbbridge_alarm_mesh.be), or nil while the bridge has none: one bridge, one alarm
    var nomesh     # the bridge has no replica to build (no driver, no alarm number): not looked at again
    var acted      # the alarm changed before the replica was up: what it was goes into the replica as its first action
    var want       # an action the replica has not taken, [class, lost, by], tried again at redo
    var redo       # the millis at which it is tried again, or nil
    var sounding   # the siren is on for the trigger that holds

    def init(relay)
        import persist
        self.relay = relay
        self.cfg = ZbBridgeAlarm.read_cfg()
        self.st = "disarmed"
        self.mode = nil
        self.back = "disarmed"
        self.ver = 0
        self.cause = nil
        self.eid = 0
        self.events = []
        self.seen = {}
        self.cur = {}
        self.crossed = {}
        self.lows = {}
        self.tam = {}
        self.quiet = {}
        self.zone = {}
        self.power = {}
        self.rings = {}
        self.echo = {}
        self.bypassed = {}
        self.listeners = []
        self.up = false
        self.subscribed = false
        self.outbox = []
        self.pumping = false
        self.boot = true
        self.mesh = nil
        self.nomesh = false
        self.acted = false
        self.want = nil
        self.sounding = false
        self.want_on = nil
        self.sent = 0
        self.asked = 0
        self.told = {}
        self.heard_at = {}
        self.boot_ms = tasmota.millis()
        self.unprot = 0
        self.door = false
        self.ha_done = false
        self.lostset = ZbBridgeAlarm.read_lost()
        tasmota.add_cmd("ZbAlarmSlot", / cmd, idx, payload -> self.slot_cmd(payload))
        tasmota.add_cmd("ZbAlarmDoor", / cmd, idx, payload -> self.door_cmd(payload))
        var s = persist.find(ZbBridgeAlarm.STATE_KEY, nil)
        if isinstance(s, map)
            self.ver = int(s.find("v", 0))
            self.eid = int(s.find("e", 0)) + ZbBridgeAlarm.EID_GAP
            # a restart in the middle of an exit, an entry or a siren leaves it armed as it was asked; the siren is sent off
            # once Z2T is up (every_second), for nothing else turns off one that was on
            var m = s.find("m")
            if m == "home" || m == "away"
                self.mode = m
                self.st = "armed_" + m
                self.back = self.st
            end
        end
        # the new start of the numbers is in the flash before one is used: a second restart before any change of state would start at the
        # same place, and the panel drops an event whose number it has as a repeat
        self.save_state()
        self.check_later()
        tasmota.add_driver(self)
    end

    # --- the record --------------------------------------------------------------------------------

    static def default_cfg()
        return {"sensors": {}, "times": [30, 30, 300], "panic": {"ha": true, "panels": false, "alarm": false, "devices": [], "burst": [8, 3]},
                "sirens": [], "nopanic": []}
    end

    static def read_cfg()
        import persist
        var c = ZbBridgeAlarm.default_cfg()
        var kept = persist.find(ZbBridgeAlarm.CFG_KEY, nil)
        if !isinstance(kept, map) return c end
        for k: c.keys()
            if !kept.contains(k) continue end
            var same = (isinstance(kept[k], map) && isinstance(c[k], map)) || (isinstance(kept[k], list) && isinstance(c[k], list))
            if same  c[k] = kept[k] end
        end
        return c
    end

    # what the alarm had lost when it was last saved: a restart does not forget it; each entry [kind, grade]
    static def read_lost()
        import persist
        var out = {}
        var kept = persist.find(ZbBridgeAlarm.LOST_KEY, nil)
        if !isinstance(kept, map) return out end
        for k: kept.keys()
            var v = kept[k]
            if isinstance(v, list) && size(v) == 2 && type(v[0]) == "string" && type(v[1]) == "string"  out[str(k)] = v end
        end
        return out
    end

    def save_cfg()
        import persist
        persist.setmember(ZbBridgeAlarm.CFG_KEY, self.cfg)
        self.flush()
    end

    def save_state()
        import persist
        var s = {"v": self.ver, "e": self.eid, "s": self.st}
        if self.mode != nil  s["m"] = self.mode end
        persist.setmember(ZbBridgeAlarm.STATE_KEY, s)
        self.flush()
    end

    # persist.save(), whose failure (the heap, the file system) does not go up out of what asked for it: a trigger or an arm whose save
    # fell over lost its siren and its message. It is tried again a few seconds later (every_second), and any other
    # save that works writes it all back, from the memory
    def flush()
        import persist
        try
            persist.save()
            self.retry = nil
        except .. as e, m
            log("ZBALARM: the flash did not take it, " + str(e) + ": " + str(m), 2)
            self.retry = tasmota.millis(ZbBridgeAlarm.RETRY_MS)
        end
    end

    # a sensor's address, as the panel keys it: "0x" and the digits in capitals
    static def norm(id)
        import string
        var s = str(id)
        if size(s) > 2 && (s[0 .. 1] == "0x" || s[0 .. 1] == "0X")  s = s[2 ..] end
        return "0x" + string.toupper(s)
    end

    # A device or one of its channels, by the id the panel keys it with: the IEEE for a device and for the first channel of one of several, and for each
    # other channel the IEEE, a "/" and the channel's endpoint in decimal, "0x00124B0000AA0001/2". [the IEEE, the endpoint or nil for
    # a device and its first channel], or nil for a "/" that is no endpoint, or has no address before it ("0x" and a digit at least)
    static def split(id)
        import string
        var s = str(id)
        var i = string.find(s, "/")
        if i < 0 return [s, nil] end
        var rest = s[i + 1 ..]
        var ep = int(rest)
        if i < 3 || ep < 1 || ep > 240 || str(ep) != rest return nil end
        return [s[0 .. i - 1], ep]
    end

    # The id a report's device goes by on the panel and in the burst: the IEEE, or, for a channel after the first of a switch of several (a report
    # from endpoint 2 to 8, as the relay keys them), the IEEE, a "/" and the endpoint. A lamp's endpoint 1 or 11 is the device
    static def channel_id(ieee, attrs)
        var ep = attrs.find("Endpoint")
        var e = ep != nil ? int(ep) : 1
        return (e >= 2 && e <= 8) ? ieee + "/" + str(e) : ieee
    end

    # the time of an event, UTC, or 0 while the bridge has no clock
    static def now()
        var t = int(tasmota.rtc()["utc"])
        return t >= 1451602800 ? t : 0
    end

    def times()
        var t = self.cfg["times"]
        return size(t) == 3 ? t : [30, 30, 300]
    end

    # whether a sensor of this record watches in a mode of the alarm
    static def guards(sc, mode)
        var role = sc.find("role", "off")
        if role == "perimeter" || role == "24h" return true end
        return role == "interior" && mode == "away"
    end

    # --- what is said of it ----------------------------------------------------------------------------

    # A message to the panel: at once when it is the first, and the rest one at a time, FRAME_GAP_MS apart
    def say(m)
        if self.emit != nil
            self.emit({"ZbAlarm": m})
        elif self.relay != nil
            self.outbox.push({"ZbAlarm": m})
            if !self.pumping  self.pump() end
        end
    end

    def pump()
        if size(self.outbox) == 0
            self.pumping = false
            return
        end
        var w = self.outbox[0]
        self.outbox.remove(0)
        if self.tap != nil  self.tap(w) end
        self.relay.send_event(w)
        self.pumping = true
        tasmota.set_timer(ZbBridgeAlarm.FRAME_GAP_MS, / -> self.pump(), ZbBridgeAlarm.T_OUT)
    end

    def tell(kind, payload)
        self.ha_tell(kind, payload)
        for f: self.listeners  f(kind, payload) end
    end

    # The state, with, when there is a replica, how far it reached ("r": the bridges that applied it, of how many have a replica, and 1 while that is not
    # told yet: the first seconds of a change, or a record not counted) and how many devices an arm left unprotected ("l")
    def say_state()
        var s = {"st": self.st, "v": self.ver}
        if self.mode != nil  s["md"] = self.mode end
        if self.cause != nil  s["c"] = self.cause end
        if self.mesh != nil
            var rec = self.mesh.rep.record()
            var r = self.mesh.reach()
            if r[1] > 1
                var age = self.age_of(rec)
                s["r"] = [r[0], r[1], !r[2] || (age != nil && age < ZbBridgeAlarm.APPLYING_MS) ? 1 : 0]
            end
            if rec != nil && ZbAlarmMerge.st_of(rec) != 0 && ZbAlarmMerge.lost_of(rec) > 0  s["l"] = ZbAlarmMerge.lost_of(rec) end
        elif self.unprot > 0 && self.st != "disarmed"
            s["l"] = self.unprot
        end
        self.say(s)
    end

    static def pack(e)
        return [e["i"], e["t"], e["y"], e["d"], e["g"], e["v"], e["s"] ? 1 : 0]
    end

    # An event: kept, said to the panel, told to the listeners; a change of state is kept in the flash too
    def event(y, who, grade, val, snd)
        import persist
        self.eid += 1
        var e = {"i": self.eid, "t": ZbBridgeAlarm.now(), "y": y, "d": who, "g": grade, "v": val, "s": snd == true}
        self.events.push(e)
        if self.eid % ZbBridgeAlarm.EID_SAVE == 0  self.save_state() end
        while size(self.events) > ZbBridgeAlarm.EVENT_MAX
            var old = self.events[0]["i"]
            if self.seen.contains(old)  self.seen.remove(old) end
            self.events.remove(0)
        end
        if ZbBridgeAlarm.STATE_EVENTS.find(y) != nil
            var l = persist.find(ZbBridgeAlarm.LOG_KEY, nil)
            if !isinstance(l, list)  l = [] end
            l.push(ZbBridgeAlarm.pack(e))
            while size(l) > ZbBridgeAlarm.LOG_MAX  l.remove(0) end
            persist.setmember(ZbBridgeAlarm.LOG_KEY, l)
            self.flush()
        end
        self.say({"ev": ZbBridgeAlarm.pack(e)})
        self.tell("event", e)
        return e
    end

    def change(st)
        self.st = st
        # the alarm of one bridge changed before its replica was up: what it was is the replica's first action (born)
        if self.mesh == nil  self.acted = true end
        self.ver += 1
        self.save_state()
        self.say_state()
        self.tell("state", nil)
        # the glass is told again when the first moments of a change (APPLYING_MS) are over, for its word of the reach waits for them
        if self.mesh != nil  tasmota.set_timer(ZbBridgeAlarm.APPLYING_MS + 200, / -> self.say_state(), ZbBridgeAlarm.T_APPLY) end
    end

    # --- the alarm -----------------------------------------------------------------------------------

    def cancel_timers()
        tasmota.remove_timer(ZbBridgeAlarm.T_EXIT)
        tasmota.remove_timer(ZbBridgeAlarm.T_ENTRY)
        tasmota.remove_timer(ZbBridgeAlarm.T_SIREN)
    end

    # Armed in a mode, "home" or "away": the exit time first, in which a sensor does not trigger it. A sensor that is
    # on now and would watch is left out of this arming, with an event, until it is off again
    def arm(mode, by)
        # An arm that is refused or changes nothing answers with the state, as a disarm that changes nothing does: a panel that
        # lost the last word has it again, and a replayed arm (a retained one) does not start the exit time again
        var same = self.mode == mode && (self.st == "arming" || self.st == "armed_" + str(mode))
        # in a trigger or in the entry time an arm is refused: it would cancel the entry time and leave the open door out of the arming, an
        # alarm armed with the door that is waiting for the code open; armed at home it is a change, ARM_AWAY of Home Assistant
        if (mode != "home" && mode != "away") || self.st == "triggered" || self.st == "pending" || same
            self.say_state()
            return same
        end
        if self.mesh != nil
            # the replica takes the arm, and the state follows from it
            var k = mode == "home" ? 1 : 2
            self.record(k, self.unprotected(mode), by)
            self.shift(k, by, false)
            return true
        end
        self.cancel_timers()
        self.unprot = self.unprotected(mode)
        self.mode = mode
        self.cause = nil
        self.back = "armed_" + mode
        self.bypassed = {}
        self.leave_out(mode)
        self.event("arm", by, "house", mode, false)
        self.lost_sirens(true)
        var exit = self.times()[0]
        if exit > 0
            self.change("arming")
            tasmota.set_timer(exit * 1000, / -> self.armed_now(), ZbBridgeAlarm.T_EXIT)
        else
            self.armed_now()
        end
        return true
    end

    # The sensors that are on and would watch in the mode are left out of this arming, with an event, until they are off again. At the
    # arm, and again when the exit time ends: a door that opened in it and stayed open would never trigger, nor be said to be left out
    def leave_out(mode)
        for ieee: self.cfg["sensors"].keys()
            if self.cur.find(ieee) == true && !self.bypassed.contains(ieee) && ZbBridgeAlarm.guards(self.cfg["sensors"][ieee], mode)
                self.bypassed[ieee] = true
                self.event("bypass", ieee, "house", nil, false)
            end
        end
    end

    def armed_now()
        if self.mode == nil return end
        self.leave_out(self.mode)
        self.change("armed_" + self.mode)
    end

    # Disarmed, from any state: the siren off, the timers gone, and the sensors left out back in. Every disarm sends the siren off,
    # the one that changes nothing too: a restart may have left it on, and no other word would cut it
    def disarm(by)
        self.cancel_timers()
        self.siren(false)
        if self.st == "disarmed"
            self.say_state()
            return false
        end
        if self.mesh != nil
            # the siren was sent off above; the replica takes the disarm, and the state follows from it
            self.sounding = false
            self.record(0, 0, by)
            self.shift(0, by, false)
            return true
        end
        self.bypassed = {}
        self.mode = nil
        self.cause = nil
        self.unprot = 0
        self.back = "disarmed"
        self.event("disarm", by, "house", nil, false)
        self.change("disarmed")
        return true
    end

    # Triggered, from any state but triggered: the siren on for its time, and then back to what it was. With a replica, the siren time that ran out is
    # over, and a sensor that trips after it triggers again
    def trigger(who, kind)
        if self.st == "triggered" && (self.mesh == nil || self.sounding) return end
        if self.mesh != nil
            self.cancel_timers()
            self.cause = [who, kind]
            self.record(3, 0, who)
            self.shift(3, who, false)
            return
        end
        self.cancel_timers()
        var armed = self.st == "armed_home" || self.st == "armed_away" || self.st == "pending" || self.st == "arming"
        self.back = armed && self.mode != nil ? "armed_" + self.mode : "disarmed"
        self.cause = [who, kind]
        # the siren, and the timer that ends it, first: whatever the event and the state's save do after cannot leave it silent
        self.siren(true)
        tasmota.set_timer(self.times()[2] * 1000, / -> self.siren_done(), ZbBridgeAlarm.T_SIREN)
        self.event("trigger", who, "alarm", kind, true)
        self.change("triggered")
    end

    def siren_done()
        self.siren(false)
        if self.st != "triggered" return end
        self.sounding = false
        self.event("siren_off", nil, "house", nil, false)
        # with a replica the record stays triggered until a disarm: the siren has had its time, and the state is the house's
        if self.mesh != nil return end
        self.cause = nil
        if self.back == "disarmed"  self.mode = nil end
        self.change(self.back)
    end

    # the entry time: a perimeter sensor that grants it opened, and the alarm waits for the code
    def pend(who, kind)
        if self.st == "pending" return end
        var entry = self.times()[1]
        if entry <= 0
            self.trigger(who, kind)
            return
        end
        self.cause = [who, kind]
        self.change("pending")
        tasmota.set_timer(entry * 1000, / -> self.entry_done(), ZbBridgeAlarm.T_ENTRY)
    end

    def entry_done()
        if self.st != "pending" || self.cause == nil return end
        self.trigger(self.cause[0], self.cause[1])
    end

    # --- the replica (zbbridge_alarm_mesh.be) ------------------------------------------------------------

    # The state a sensor is judged by: the siren's time that ran out leaves the replica's record triggered, and the alarm watches as it did before the trigger
    def guard_state()
        if self.st == "triggered" && self.mesh != nil && !self.sounding && self.mode != nil
            return "armed_" + self.mode
        end
        return self.st
    end

    # The class of what is shown, in the replica's words: 0 disarmed, 1 armed home, 2 armed away, 3 triggered (arming and pending are armed)
    def klass()
        if self.st == "triggered" return 3 end
        if self.st == "disarmed" || self.mode == nil return 0 end
        return self.mode == "home" ? 1 : 2
    end

    # The class the replica says: what was asked for and is not yet in it, or what its heads resolve to
    def base()
        if self.want != nil return self.want[0] end
        var r = self.mesh.rep.record()
        return r == nil ? 0 : ZbAlarmMerge.st_of(r)
    end

    # The bridge a record came from, by its dot: the alarm number of the bridge that made the action
    def who_of(r)
        return r == nil ? "mesh" : "bridge " + str(ZbAlarmMerge.dot_of(r) >> 20)
    end

    # How old a record is, in ms, by its mark against the mesh's time now, or nil when the mark is in no timeline this life places or is ahead of the clock
    def age_of(r)
        if r == nil || !ZbAlarmMerge.tl_is(r, self.mesh.rep.timeline()) return nil end
        var d = self.mesh.ticks() - ZbAlarmMerge.mark_of(r)
        if d < -50 return nil end
        if d < 0  d = 0 end
        if d > 100000  d = 100000 end
        return d * 100
    end

    # What is left of a span (the exit time, the siren's), in ms, counted from the record's mark: all of it for an action not yet in the replica, none for a
    # mark nothing places (a bridge that rebooted, a record of another timeline): a time that cannot be counted is a time that is over
    def left_of(r, span)
        if self.want != nil return span end
        var age = self.age_of(r)
        if age == nil || age >= span return 0 end
        return span - age
    end

    # An action through the replica: its record, or nil when it took none (the counter would not write, a timeline is being taken): the action is kept as
    # wanted and tried again in RETRY_MS (redo_act), as a save that fell over is
    def record(k, lost, by)
        var r = self.mesh.act(k, lost)
        if r != nil
            self.want = nil
            self.redo = nil
            return r
        end
        self.want = [k, lost, by]
        self.redo = tasmota.millis(ZbBridgeAlarm.RETRY_MS)
        log("ZBALARM: the replica took no record of the action: tried again in " + str(ZbBridgeAlarm.RETRY_MS / 1000) + " s", 2)
        return nil
    end

    def redo_act()
        if self.want == nil || self.mesh == nil || self.redo == nil || !tasmota.time_reached(self.redo) return end
        var w = self.want
        self.want = nil
        if self.record(w[0], w[1], w[2]) != nil
            self.look(w[2], true)
        end
    end

    # What the replica says is what the alarm shows
    def look(by, quiet)
        self.shift(self.base(), by, quiet)
    end

    # Copies from another bridge changed what the replica holds (src is its mesh number), or the marks moved with a timeline (nil): what was wanted and not
    # recorded is no longer the newest word, and what is shown follows the heads
    def heard_copies(src)
        if self.mesh == nil return end
        if src != nil  self.want = nil end
        self.look(nil, false)
    end

    # The alarm moves to a class, 0 to 3 as the replica has them: the sirens, the timers, the events, the state. by is who made it (a person, a sensor, nil for the
    # bridge a record came from). quiet is a boot or a birth: what the heads remember is not happening now, so there is no event and no siren. The exit time and
    # the siren's are what is left of them from the mark of the replica's record
    def shift(k, by, quiet)
        var was = self.klass()
        var r = self.mesh.rep.record()
        var span = self.times()[2] * 1000
        # a trigger that comes after the siren's time ran out sounds again; the same record seen again does not
        var fresh = k == 3 && was == 3 && !quiet && !self.sounding && self.left_of(r, span) > 0
        if k == was && !fresh return end
        var who = by != nil ? by : self.who_of(r)
        self.cancel_timers()
        if k == 0
            if self.sounding
                self.siren(false)
                self.sounding = false
            end
            self.bypassed = {}
            self.mode = nil
            self.cause = nil
            self.back = "disarmed"
            if !quiet  self.event("disarm", who, "house", nil, false) end
            self.change("disarmed")
        elif k == 3
            if !quiet && self.cause == nil  self.cause = [who, "alarm"] end
            var left = quiet ? 0 : self.left_of(r, span)
            # the siren and the timer that ends it first: whatever the event and the state's save do after cannot leave it silent
            if left > 0
                self.siren(true)
                self.sounding = true
                tasmota.set_timer(left, / -> self.siren_done(), ZbBridgeAlarm.T_SIREN)
            end
            if !quiet  self.event("trigger", self.cause[0], "alarm", self.cause[1], true) end
            self.change("triggered")
        else
            self.shift_armed(k, who, quiet, r)
        end
    end

    # An arm, in a mode: the exit time first, in which a sensor does not trigger it, counted from the record's mark
    def shift_armed(k, who, quiet, r)
        var m = k == 1 ? "home" : "away"
        if self.sounding
            self.siren(false)
            self.sounding = false
        end
        self.mode = m
        self.cause = nil
        self.back = "armed_" + m
        self.bypassed = {}
        if quiet
            self.change("armed_" + m)
            return
        end
        self.leave_out(m)
        self.event("arm", who, "house", m, false)
        self.lost_sirens(true)
        var left = self.left_of(r, self.times()[0] * 1000)
        if left > 0
            self.change("arming")
            tasmota.set_timer(left, / -> self.armed_now(), ZbBridgeAlarm.T_EXIT)
        else
            self.armed_now()
        end
    end

    # This bridge applied the record it shows, whole (the state follows it, and the sirens are as ordered): the heartbeat says so, and the neighbours count it
    def reach_tick()
        if self.mesh == nil return end
        var r = self.mesh.rep.record()
        var cur = r == nil ? 0 : ZbAlarmMerge.dot_of(r)
        if self.mesh.applied == cur return end
        if self.want == nil && self.klass() == self.base() && self.sirens_confirmed()  self.mesh.set_applied(cur) end
    end

    # The count of the bridges that applied the record changed: the glass and Home Assistant are told
    def reach_changed()
        self.say_state()
        self.ha_attr()
    end

    # The replica comes up once the mesh runs (its clock says the timeline the marks are in) and this bridge has an alarm number
    def attach()
        if !ZbAlarmMesh.here()
            self.nomesh = true
            return
        end
        if ZbAlarmMesh.clock() == nil return end
        var slot = ZbAlarmMesh.slot()
        if slot == nil
            self.nomesh = true
            return
        end
        # a replica that cannot be built leaves this bridge's alarm its own
        try
            self.mesh = ZbAlarmMesh(self, slot)
            self.mesh.begin()
            self.born()
        except .. as e, m
            log("ZBALARM: the house alarm's replica could not be built (" + str(e) + ": " + str(m) + "): this bridge's alarm stays its own", 1)
            self.mesh = nil
            self.nomesh = true
            return
        end
        log("ZBALARM: the house alarm's replica is up, as alarm " + str(slot), 2)
    end

    # The replica is up. What the alarm was before it, changed by a person or a sensor, or kept in the flash by a bridge that had no replica (an upgrade),
    # goes in as its first action; otherwise what the replica holds is what the alarm is, and nothing of it is told as new
    def born()
        var have = self.base()
        var was = self.klass()
        if (self.acted || size(self.mesh.rep.heads) == 0) && was != have
            self.record(was, 0, nil)
        end
        self.look(nil, true)
    end

    # ZbAlarmSlot [n]: this bridge's alarm number, 1 to 15; 0 clears it, and the mesh number is the number when it is 1 to 15. A bridge with no replica builds
    # one at once; one that has one keeps its number until it restarts
    def slot_cmd(payload)
        import persist
        import json
        var p = str(payload)
        if p != ""
            var n = int(p)
            if n < 0 || n > ZbAlarmMerge.MAX_NODE || (n == 0 && p != "0")
                tasmota.resp_cmnd_failed()
                return
            end
            if n == 0  persist.remove(ZbAlarmMesh.SLOT_KEY) else  persist.setmember(ZbAlarmMesh.SLOT_KEY, n) end
            self.flush()
            self.nomesh = false
        end
        var s = ZbAlarmMesh.slot()
        tasmota.resp_cmnd(json.dump({"ZbAlarmSlot": {"Slot": s != nil ? s : 0, "Up": self.mesh != nil ? self.mesh.rep.id : 0}}))
    end

    # ZbAlarmDoor [n]: the mesh number of the bridge the owner prefers for the door to Home Assistant; 0 clears it. The bridge, and the others, take the
    # door by rank: the preferred one once it has been alive, synced and with the broker for 30 s, and the others by number
    def door_cmd(payload)
        import persist
        import json
        var p = str(payload)
        if p != ""
            var n = int(p)
            if n < 0 || n > 254 || (n == 0 && p != "0")
                tasmota.resp_cmnd_failed()
                return
            end
            if n == 0  persist.remove(ZbAlarmMesh.DOOR_KEY) else  persist.setmember(ZbAlarmMesh.DOOR_KEY, n) end
            self.flush()
        end
        var d = persist.find(ZbAlarmMesh.DOOR_KEY, 0)
        tasmota.resp_cmnd(json.dump({"ZbAlarmDoor": {"Prefers": d, "Door": self.mesh != nil ? self.mesh.door_id : 0, "This": self.is_door() ? 1 : 0}}))
    end

    # Whether this bridge answers for the house's alarm toward Home Assistant: with a replica, the door the mesh's election gave; with none,
    # always (one bridge, one alarm); and a bridge whose replica is on its way waits for it a while, so that two do not announce one alarm
    def is_door()
        if self.mesh != nil return self.door end
        return self.nomesh || tasmota.millis() - self.boot_ms >= ZbBridgeAlarm.DOOR_WAIT_MS
    end

    # the door: the entities are announced when this bridge becomes it, and when it stops being it the next one does it
    def door_tick()
        if !self.up return end
        var d = self.is_door()
        if d && !self.ha_done  self.announce_ha() end
        if !d  self.ha_done = false end
    end

    # --- Home Assistant --------------------------------------------------------------------------------

    def every_second()
        import mqtt
        var on = mqtt.connected() == true
        if on && !self.up  self.connected() end
        self.up = on
        # the first second Z2T is up: a ZbSend before it fails without a word
        if self.boot && ZbBridgeAlarm.z2t_up()
            self.boot = false
            self.siren(false)
            self.seed()
        end
        if self.retry != nil && tasmota.time_reached(self.retry)
            self.retry = nil
            self.flush()
        end
        # the replica: built once the mesh runs, and then it listens to the neighbours and keeps the heartbeat's bytes
        if self.mesh != nil
            self.mesh.every_second()
        elif !self.nomesh
            self.attach()
        end
        self.redo_act()
        self.reach_tick()
        self.door_tick()
    end

    # What Z2T knows of each sensor's zone is where the sensor stands, the first second it is up: a restart loses the zones the alarm
    # heard, and a window open on purpose would trigger at its next report, one that is open at an arm would not be left out. Only the
    # state is seeded and never a bypass: the report that says what the seed says is nothing, and one that differs is
    # what it is
    def seed()
        var known = self.zones_fn != nil ? self.zones_fn() : self.zones()
        for ieee: self.cfg["sensors"].keys()
            var attrs = known.find(ieee)
            if isinstance(attrs, map) && !self.cur.contains(ieee)
                var on = ZbBridgeAlarm.binary_of(attrs)
                if on != nil  self.cur[ieee] = on end
            end
        end
    end

    # what Z2T keeps of the alarm's sensors, ZbInfo's, ieee -> map
    def zones()
        import global
        var out = {}
        var z = global.contains("ZbBridgeDiscovery") ? global.ZbBridgeDiscovery.coordinator() : nil
        if z == nil return out end
        for d: z
            var ieee = global.ZbBridgeDiscovery.ieee(d)
            if self.cfg["sensors"].contains(ieee)  out[ieee] = global.ZbBridgeDiscovery.about(d) end
        end
        return out
    end

    # whether Z2T, the coordinator's driver, is started
    static def z2t_up()
        import global
        var z = global.contains("zigbee") ? global.zigbee : nil
        return z != nil && z.started() == true
    end

    # whether the discovery is on: the panel's Discovery switch, which also takes the Zigbee devices out of Home Assistant
    def ha_on()
        return self.relay == nil || self.relay.discovery == nil || self.relay.discovery.on()
    end

    # this bridge's name for Home Assistant: its topic, as the discovery marks its announcements, or its hostname
    def own_id()
        import global
        var t = global.contains("ZbBridgeDiscovery") ? global.ZbBridgeDiscovery.topic() : nil
        return t != nil ? str(t) : str(tasmota.hostname())
    end

    # On the broker: the command topic subscribed once, and the two entities announced again, as the broker may be a new
    # one, with the state said
    def connected()
        import mqtt
        if !self.ha_on() return end
        self.uid = self.alarm_uid()
        if !self.subscribed
            self.subscribed = true
            mqtt.subscribe(ZbBridgeAlarm.BASE + "/+/set", / topic, idx, payload_s, payload_b -> self.ha_command(topic, payload_s))
        end
        self.hold = tasmota.millis(ZbBridgeAlarm.HOLD_MS)
        self.ha_done = false
        self.announce_ha()
    end

    # Home Assistant's one alarm: with a replica (a driver in the image and an alarm number) it is the house's, the same on every bridge, and one bridge
    # at a time, the door, answers for it; a bridge with none has its own
    def alarm_uid()
        if ZbAlarmMesh.here() && ZbAlarmMesh.slot() != nil return "zbalarm_house" end
        return "zbalarm_" + self.own_id()
    end

    # The entities announced, and the state said, by the bridge that is the door
    def announce_ha()
        import mqtt
        import json
        import global
        if !self.ha_on() || !self.is_door() || self.uid == nil return end
        self.ha_done = true
        var base = ZbBridgeAlarm.BASE + "/" + self.uid
        var prefix = global.contains("ZbBridgeDiscovery") ? global.ZbBridgeDiscovery.PREFIX : "homeassistant"
        var lwt = global.contains("ZbBridgeDiscovery") ? global.ZbBridgeDiscovery.lwt_topic() : nil
        var avty = lwt != nil ? [{"topic": lwt, "payload_available": "Online", "payload_not_available": "Offline"}] : []
        var dev = {"identifiers": [self.uid], "name": "House alarm", "model": "HouseWeave alarm"}
        var panel = {"name": nil, "unique_id": self.uid, "state_topic": base + "/state", "command_topic": base + "/set", "json_attributes_topic": base + "/attr",
                     "code_arm_required": false, "code_disarm_required": false, "supported_features": ["arm_home", "arm_away"],
                     "device": dev, "origin": {"name": self.own_id()}}
        var events = {"name": "Alarm events", "unique_id": self.uid + "_event", "state_topic": base + "/event",
                      "event_types": ZbBridgeAlarm.EVENT_TYPES, "device": dev, "origin": {"name": self.own_id()}}
        if size(avty) > 0
            panel["availability"] = avty
            panel["availability_mode"] = "all"
            events["availability"] = avty
            events["availability_mode"] = "all"
        end
        mqtt.publish(prefix + "/alarm_control_panel/" + self.uid + "/config", json.dump(panel), true)
        mqtt.publish(prefix + "/event/" + self.uid + "_event/config", json.dump(events), true)
        mqtt.publish(base + "/state", self.st, true)
        self.ha_attr()
    end

    # How far the state reached, as the alarm's attributes in Home Assistant: the bridges that applied it, of how many have a replica
    def ha_attr()
        import mqtt
        import json
        if !self.up || self.uid == nil || self.mesh == nil return end
        if !self.is_door() return end
        var r = self.mesh.reach()
        mqtt.publish(ZbBridgeAlarm.BASE + "/" + self.uid + "/attr", json.dump({"reach": r[0], "of": r[1], "counted": r[2]}), true)
    end

    # The alarm's state, and every event, to the broker: the state retained, the events not, a panic only when the
    # settings send it to Home Assistant
    def ha_tell(kind, payload)
        import mqtt
        import json
        if !self.up || self.uid == nil || !self.is_door() return end
        var base = ZbBridgeAlarm.BASE + "/" + self.uid
        if kind == "state"
            mqtt.publish(base + "/state", self.st, true)
        elif kind == "event"
            if payload["y"] == "panic" && self.cfg["panic"].find("ha", true) != true return end
            mqtt.publish(base + "/event", json.dump({"event_type": payload["y"], "who": payload["d"], "grade": payload["g"],
                                                     "value": payload["v"], "id": payload["i"], "time": payload["t"]}), false)
        end
    end

    # Home Assistant's command: arm home, arm away, disarm, as its alarm_control_panel says them. Only on this alarm's own topic: the
    # subscription is for every alarm's, and a DISARM on another bridge's is not this one's to take. And not in the first
    # seconds of a connection, which is when the broker hands back the retained commands, one of an hour ago that disarms now; one that
    # comes before the second that saw the connection (up is not yet true) is one of them as well
    def ha_command(topic, payload)
        import string
        if !self.up || self.uid == nil || !self.is_door() || str(topic) != ZbBridgeAlarm.BASE + "/" + self.uid + "/set" return end
        if self.hold != nil && !tasmota.time_reached(self.hold) return end
        var p = string.toupper(str(payload))
        if p == "ARM_HOME"
            self.arm("home", "ha")
        elif p == "ARM_AWAY"
            self.arm("away", "ha")
        elif p == "DISARM"
            self.disarm("ha")
        end
    end

    # --- the sirens, and the devices an action runs ----------------------------------------------------

    # The sirens on or off, and told again until each says it is as ordered. A ZbSend that a siren or a busy radio does not answer is
    # lost with no word, and a siren left on, or one that never sounded, is what an alarm is for. The order goes at once, and again
    # 1, 3, 7 and 15 s after it (the waits double: 1, 2, 4, 8 s), then every 15 s, and every 60 s after ten minutes with no confirmation; it never gives
    # up while the order stands, for an OFF that did not reach a siren with no power still counts when the power is back. Each repeat comes with a Read
    # of the siren's Power, and a siren confirms by saying its Power (confirm). It stops when every siren confirmed, and when the order changes: the
    # siren time ending is the order OFF. A siren with a driver is told once: its command, a pulse, would act again
    def siren(on)
        tasmota.remove_timer(ZbBridgeAlarm.T_AGAIN)
        self.want_on = on
        self.sent = 0
        self.asked = tasmota.millis()
        self.told = {}
        self.tell_sirens(false)
        self.next_ladder()
    end

    def tell_sirens(repeat)
        var act = self.want_on ? "on" : "off"
        for ieee: self.cfg["sirens"]
            if self.told.contains(ieee) continue end
            if self.driven(ZbBridgeAlarm.device_of(ieee))
                if !repeat
                    self.act_on(ieee, act)
                    self.told[ieee] = true
                end
                continue
            end
            self.act_on(ieee, act)
            if repeat  self.read_power(ieee) end
        end
    end

    # a Read of a siren's Power, which it answers with the Power it has: the confirmation of a siren that does not report on its own
    def read_power(id)
        var at = ZbBridgeAlarm.split(id)
        if at == nil return end
        tasmota.cmd('ZbSend {"Device":"' + at[0] + '"' + (at[1] != nil ? ',"Endpoint":' + str(at[1]) : "") + ',"Read":{"Power":true}}')
    end

    # whether every siren is as ordered (a siren with a driver was told once, and counts)
    def sirens_confirmed()
        for ieee: self.cfg["sirens"]
            if !self.told.contains(ieee) return false end
        end
        return true
    end

    # the sirens that did not confirm the order by its fifth try, the ones with no confirmation
    def unconfirmed()
        var out = []
        if self.want_on == nil || self.sent < size(ZbBridgeAlarm.LADDER) return out end
        for ieee: self.cfg["sirens"]
            if !self.told.contains(ieee)  out.push(ieee) end
        end
        return out
    end

    def next_ladder()
        if self.sirens_confirmed() return end
        var wait = self.sent < size(ZbBridgeAlarm.LADDER) ? ZbBridgeAlarm.LADDER[self.sent] : ZbBridgeAlarm.TAIL_MS
        if tasmota.millis() - self.asked >= ZbBridgeAlarm.SLOW_AFTER_MS  wait = ZbBridgeAlarm.SLOW_MS end
        tasmota.set_timer(wait, / -> self.siren_again(), ZbBridgeAlarm.T_AGAIN)
    end

    def siren_again()
        self.sent += 1
        self.tell_sirens(true)
        if self.sent == size(ZbBridgeAlarm.LADDER)  self.unconfirmed_notice() end
        self.next_ladder()
    end

    # What a siren says of its Power: as ordered, it is confirmed, and when all are the ladder stops; one that was confirmed and now contradicts the order
    # (a siren that stopped on its own with the alarm still sounding) starts the ladder again. A report that contradicts before the order was confirmed is
    # a state that has not caught up
    def confirm(ieee, attrs)
        var p = attrs.find("Power")
        if p == nil || self.want_on == nil || size(self.cfg["sirens"]) == 0 return end
        var id = ZbBridgeAlarm.channel_id(ieee, attrs)
        if self.cfg["sirens"].find(id) == nil return end
        if (p == 1) == self.want_on
            self.told[id] = true
            self.found(id)
            if self.sirens_confirmed()  tasmota.remove_timer(ZbBridgeAlarm.T_AGAIN) end
        elif self.told.contains(id)
            self.siren(self.want_on)
        end
    end

    # the IEEE address of a device or of a channel of one (an id that is no channel's is as it is)
    static def device_of(id)
        var at = ZbBridgeAlarm.split(id)
        return at != nil ? at[0] : id
    end

    # whether a device has a driver of the host's, which acts for it (a blind, a gate)
    def driven(ieee)
        return self.relay != nil && self.relay.drivers != nil && self.relay.drivers.claimed.find(ieee) != nil
    end

    # A device acted on: by its driver, when one has it (a blind opens, a gate closes), and otherwise on or off by Z2T. A channel after the first of a
    # device of several (id "0x...1/2") is the device's IEEE with its endpoint, which without it would reach the first channel; the driver, the reports'
    # echo and the reach are the device's, by its IEEE
    def act_on(id, act)
        var at = ZbBridgeAlarm.split(id)
        if at == nil  at = [id, nil] end
        var ieee = at[0]
        var d = nil
        if self.relay != nil && self.relay.drivers != nil  d = self.relay.drivers.claimed.find(ieee) end
        if d != nil
            d.command(self.relay.drivers.info_for(ieee), {"id": ieee, "do": act})
            return
        end
        if act == "on" || act == "off"
            self.echo[ieee] = tasmota.millis(ZbBridgeAlarm.ECHO_MS)
            var where = '"Device":"' + ieee + '"' + (at[1] != nil ? ',"Endpoint":' + str(at[1]) : "")
            tasmota.cmd('ZbSend {' + where + ',"Send":{"Power":' + (act == "on" ? "1" : "0") + '}}')
        end
    end

    # --- the sensors -------------------------------------------------------------------------------------

    # what a report says of a zone: true for on, false for off, nil when it says nothing: an alarm's name by its zone
    # type, the occupancy cluster, or the raw zone status under them (its two alarm bits)
    static def binary_of(attrs)
        for k: ZbBridgeAlarm.BINARY
            var v = attrs.find(k)
            if v != nil return v == 1 || v == true end
        end
        var zs = attrs.find("ZoneStatus")
        if zs == nil return nil end
        return (int(zs) & 3) != 0
    end

    static def kind_of(attrs)
        for k: ZbBridgeAlarm.BINARY
            if attrs.find(k) != nil return ZbBridgeAlarm.KIND_OF[k] end
        end
        return "alarm"
    end

    # the IEEE of a report's key, a short address or a name, by the zigbee module
    def ieee_of(key)
        if self.resolve_fn != nil return self.resolve_fn(key) end
        import global
        if !global.contains("ZbBridgeDiscovery") return nil end
        var z = global.ZbBridgeDiscovery.coordinator()
        if z == nil return nil end
        var d = z.find(key)
        return d != nil ? global.ZbBridgeDiscovery.ieee(d) : nil
    end

    # A device's report, by the key Z2T gives it: a hand on any device counts towards a burst, and what the alarm reads of it
    # is read, if it is one of its sensors
    def heard(key, attrs)
        if !isinstance(attrs, map) return end
        var ieee = self.ieee_of(key)
        if ieee == nil return end
        self.burst(ZbBridgeAlarm.channel_id(ieee, attrs), attrs)
        self.confirm(ieee, attrs)
        self.report(ieee, attrs)
    end

    # --- the burst: a device pressed in a frenzy is the panic -------------------------

    # A command of ours to a device or to a group: the reports that answer it for a moment are not a hand on the device
    def commanded(line)
        import string
        var until = tasmota.millis(ZbBridgeAlarm.ECHO_MS)
        var l = string.tolower(line)
        if string.find(l, '"group"') >= 0
            self.echo_all = until
            return
        end
        var i = string.find(l, '"device":"')
        if i < 0 return end
        var rest = line[i + 10 ..]
        var j = string.find(rest, '"')
        if j <= 0 return end
        var id = rest[0 .. j - 1]
        var ieee = size(id) > 6 ? ZbBridgeAlarm.norm(id) : self.ieee_of(id)
        if ieee != nil  self.echo[ieee] = until end
    end

    def echoed(ieee)
        if self.echo_all != nil && !tasmota.time_reached(self.echo_all) return true end
        var u = self.echo.find(ieee)
        return u != nil && !tasmota.time_reached(u)
    end

    # Whether a report is a hand on the device: a zone turning on (a door, water, smoke), a button's toggle, a switch
    # changing. A presence sensor retriggers by itself. Only a switch's Power 0 or 1 can be the echo of a command of ours, and is not one
    # then: a zone turning on or a button's toggle in the second after a group command is a hand on the device
    # The id is the device's, or a channel's after the first (channel_id): each channel of a switch keeps its own last Power, so that one channel's
    # report is never taken for the other's toggle, and a command's echo is marked by the device's IEEE
    def activation(id, attrs)
        if attrs.find("Occupancy") != nil return false end
        var hand = false
        var at = ZbBridgeAlarm.split(id)
        var ieee = at != nil ? at[0] : id
        var on = ZbBridgeAlarm.binary_of(attrs)
        if on != nil
            hand = on && !self.zone.find(id, false)
            self.zone[id] = on
        end
        var p = attrs.find("Power")
        if p != nil
            if p == 2
                hand = true
            else
                var was = self.power.find(id)
                if was != nil && was != p && !self.echoed(ieee)  hand = true end
                self.power[id] = p
            end
        end
        return hand
    end

    # a hand on a device or on one of its channels, by its id: the panel's burst row for a channel is a channel's (set_burst keeps that id)
    def burst(id, attrs)
        var b = self.cfg["panic"].find("burst", ZbBridgeAlarm.BURST)
        if !self.activation(id, attrs) return end
        if !isinstance(b, list) || size(b) != 2 || b[0] <= 0 return end
        if self.cfg["nopanic"].find(id) != nil return end
        var now = tasmota.millis()
        var r = self.rings.find(id)
        if r == nil
            r = []
            self.rings[id] = r
        end
        r.push(now)
        while size(r) > 0 && now - r[0] > b[1] * 1000  r.remove(0) end
        if size(r) >= b[0]
            self.rings.remove(id)
            self.panic(id)
        end
    end

    def report(ieee, attrs)
        var sc = self.cfg["sensors"].find(ieee)
        if sc == nil return end
        self.quiet[ieee] = false
        self.heard_at[ieee] = tasmota.millis()
        self.found(ieee)
        var on = ZbBridgeAlarm.binary_of(attrs)
        if on != nil
            self.binary(ieee, sc, ZbBridgeAlarm.kind_of(attrs), on)
            # a zone's status carries the tamper and the low battery only while they are set
            if attrs.find("Tamper") != 1  self.tam[ieee] = false end
            if attrs.find("BatteryLow") != 1  self.lows[ieee] = false end
        end
        if attrs.find("Tamper") == 1  self.tampered(ieee, sc) end
        if attrs.find("BatteryLow") == 1  self.low_battery(ieee) end
        self.numeric(ieee, sc, attrs)
    end

    # A zone changing: on raises the sensor's notification, and may trigger the alarm; off clears what went away by itself
    def binary(ieee, sc, kind, on)
        var was = self.cur.find(ieee)
        self.cur[ieee] = on
        if on == was return end
        if !on
            if self.bypassed.contains(ieee)  self.bypassed.remove(ieee) end
            self.resolve(ieee)
            return
        end
        var grade = sc.find("notify", "off")
        if grade != "off"  self.event(kind, ieee, grade, nil, sc.find("sound", false) == true) end
        self.sense(ieee, kind, sc)
    end

    # A sensor on, for the alarm: by its role and the state
    def sense(ieee, kind, sc)
        var role = sc.find("role", "off")
        if role == "off" || self.bypassed.contains(ieee) return end
        if role == "24h"
            self.trigger(ieee, kind)
            return
        end
        var s = self.guard_state()
        var away = s == "armed_away"
        if role == "interior"
            if away  self.trigger(ieee, kind) end
            return
        end
        var entry = sc.find("entry", false) == true
        if away || s == "armed_home"
            if entry  self.pend(ieee, kind) else  self.trigger(ieee, kind) end
        elif s == "pending" && !entry
            self.trigger(ieee, kind)
        end
    end

    # A numeric sensor's condition crossed, and cleared 2 units back: the cross is the event, the stay is not
    def numeric(ieee, sc, attrs)
        var c = sc.find("cond")
        if !isinstance(c, map) return end
        var v = attrs.find(c.find("k"))
        if v == nil return end
        var limit = c.find("x", 0)
        var above = c.find("w") == "above"
        var m = ZbBridgeAlarm.MARGIN
        if !self.crossed.find(ieee, false)
            if (above && v > limit) || (!above && v < limit)
                self.crossed[ieee] = true
                var grade = sc.find("notify", "off")
                if grade != "off"  self.event(above ? "above" : "below", ieee, grade, v, sc.find("sound", false) == true) end
            end
        elif (above && v <= limit - m) || (!above && v >= limit + m)
            self.crossed[ieee] = false
            self.resolve(ieee)
        end
    end

    # a tamper triggers an armed alarm, and only warns a disarmed one
    def tampered(ieee, sc)
        if self.tam.find(ieee, false) return end
        self.tam[ieee] = true
        var s = self.guard_state()
        if s == "armed_home" || s == "armed_away" || s == "pending"
            self.trigger(ieee, "tamper")
        else
            self.event("tamper", ieee, "house", nil, sc.find("sound", false) == true)
        end
    end

    def low_battery(ieee)
        if self.lows.find(ieee, false) return end
        self.lows[ieee] = true
        self.event("battery", ieee, "house", nil, false)
    end

    # What the zone's return clears: a local notice goes away by itself, and the panel is told to drop it
    def resolve(ieee)
        var any = false
        for e: self.events
            if e["d"] == ieee && e["g"] == "local" && !self.seen.contains(e["i"])
                self.seen[e["i"]] = true
                any = true
            end
        end
        if any  self.say({"clr": ieee}) end
    end

    # --- the silence, and the panic --------------------------------------------------------------------

    def check_later()
        tasmota.set_timer(ZbBridgeAlarm.CHECK_S * 1000, def ()
            self.supervise()
            self.check_later()
        end, ZbBridgeAlarm.T_CHECK)
    end

    # what Z2T keeps of a device, ZbInfo's, by its IEEE, or nil
    def info_of(ieee)
        import global
        if !global.contains("ZbBridgeDiscovery") return nil end
        var z = global.ZbBridgeDiscovery.coordinator()
        if z == nil return nil end
        for d: z
            if global.ZbBridgeDiscovery.ieee(d) == ieee return global.ZbBridgeDiscovery.about(d) end
        end
        return nil
    end

    # the seconds since a sensor's last word, by Z2T's record of it, or nil when nothing says
    def silence_of(ieee)
        if self.seen_fn != nil return self.seen_fn(ieee) end
        # the air time since its last word to this alarm, or since this alarm started when it has not spoken: no wall clock, which Z2T's
        # LastSeen needs and the bridge may not have after a power cut; Z2T's own word counts when it heard the sensor more lately
        var t = self.heard_at.find(ieee)
        var mine = (tasmota.millis() - (t != nil ? t : self.boot_ms)) / 1000
        var i = self.info_of(ieee)
        var s = i != nil ? i.find("LastSeen") : nil
        if s != nil && int(s) < mine return int(s) end
        return mine
    end

    # whether Z2T has a device reachable: false when it says it has not, and nil when nothing says
    def reach_of(ieee)
        if self.reach_fn != nil return self.reach_fn(ieee) end
        var i = self.info_of(ieee)
        var r = i != nil ? i.find("Reachable") : nil
        return r == nil ? nil : r == true
    end

    # A sensor in the alarm, or with a notification, that has said nothing for its hours is reported, once, at its own
    # grade and no lower than the house's; it is not an alarm, a battery sensor being quiet for hours
    def supervise()
        for ieee: self.cfg["sensors"].keys()
            var sc = self.cfg["sensors"][ieee]
            var grade = sc.find("notify", "off")
            if sc.find("role", "off") == "off" && grade == "off" continue end
            var s = self.silence_of(ieee)
            if s == nil continue end
            var silent = s > int(sc.find("news", ZbBridgeAlarm.NEWS_H)) * 3600
            if silent && !self.quiet.find(ieee, false)
                self.quiet[ieee] = true
                var g = self.loss_grade(grade == "off" || grade == "local" ? "house" : grade, ZbBridgeAlarm.guards(sc, self.mode))
                self.event("nonews", ieee, g, nil, false)
                self.lose(ieee, "sensor", g)
            elif !silent
                self.quiet[ieee] = false
                self.found(ieee)
            end
        end
        self.lost_sirens(false)
    end

    # --- what was lost, and not found again ---------------------------------------------------

    # House while the alarm is not armed; Alert when it is armed and what was lost watches the house: a sensor that watches in the mode, a siren, a bridge
    def loss_grade(base, watches)
        if self.st != "disarmed" && watches return "alert" end
        return base
    end

    # The house's numbers, m (number -> true; house_mesh.be, sweep()): a bridge that is no more is no loss of this alarm's, and the replica forgets it too
    def sweep(m)
        var drop = []
        for id: self.lostset.keys()
            if self.lostset[id][0] == "bridge" && size(id) > 7 && !m.contains(int(id[7 ..]))  drop.push(id) end
        end
        for id: drop
            self.lostset.remove(id)
            self.say({"clr": id})
        end
        if size(drop) > 0  self.lost_changed() end
        if self.mesh != nil  self.mesh.sweep(m) end
    end

    # A loss opens: it is kept until the device comes back or is taken out of the alarm (a touch on "seen" does not take it away), saved in the flash, and
    # the list is said to the panels
    def lose(id, kind, grade)
        if self.lostset.contains(id) return end
        self.lostset[id] = [kind, grade]
        self.lost_changed()
    end

    def found(id)
        if !self.lostset.contains(id) return end
        self.lostset.remove(id)
        self.say({"clr": id})
        self.lost_changed()
    end

    # whether an id of the alarm (a device's IEEE, or a channel's: the IEEE, a "/" and the endpoint) is a device of this address
    static def owned(id, ieee)
        var s = ZbBridgeAlarm.split(id)
        return s != nil && ZbBridgeAlarm.norm(s[0]) == ieee
    end

    # A device the panel took off the network (its ZbForget): out of the alarm's setup too, with what the alarm had lost of it and what it knew of its zone.
    # Otherwise a sensor taken away stays a sensor lost for ever, with the confirmation to arm that goes with it, and one paired again comes back
    # with the role it had. Every id of the device goes: its channels as well
    def forget_device(address)
        var ieee = ZbBridgeAlarm.norm(address)
        var changed = false
        var ids = []
        for id: self.cfg["sensors"].keys()  if ZbBridgeAlarm.owned(id, ieee)  ids.push(id) end end
        for id: ids  self.cfg["sensors"].remove(id) changed = true end
        for key: ["sirens", "nopanic"]
            var kept = []
            for id: self.cfg[key]  if !ZbBridgeAlarm.owned(id, ieee)  kept.push(id) end end
            if size(kept) != size(self.cfg[key])  self.cfg[key] = kept changed = true end
        end
        var p = self.cfg["panic"]
        var pairs = []
        for pair: p.find("devices", [])  if !ZbBridgeAlarm.owned(pair[0], ieee)  pairs.push(pair) end end
        if size(pairs) != size(p.find("devices", []))  p["devices"] = pairs changed = true end
        # what it knew of the device's zone, and the losses of it, with the panel told that they are over
        for m: [self.cur, self.crossed, self.lows, self.tam, self.quiet, self.zone, self.power, self.rings, self.echo, self.bypassed, self.heard_at, self.told]
            var gone = []
            for id: m.keys()  if ZbBridgeAlarm.owned(id, ieee)  gone.push(id) end end
            for id: gone  m.remove(id) end
        end
        var lost = []
        for id: self.lostset.keys()  if ZbBridgeAlarm.owned(id, ieee)  lost.push(id) end end
        for id: lost  self.found(id) end
        if changed  self.save_cfg() end
    end

    # The house's configuration of the alarm, given whole (house_alarm.be): it takes the place of this bridge's. What the alarm had lost of a
    # sensor or a siren that left it is over, a condition that is new starts from not holding, and how the house is guarded, when it changed, is an event
    # of its own, as a panel's word was (cmd)
    def take_cfg(c)
        import json
        var old = self.cfg
        var said = []
        var sensor = size(old["sensors"]) != size(c["sensors"])
        for id: old["sensors"].keys()
            if !c["sensors"].contains(id)  self.found(id) end
        end
        for id: c["sensors"].keys()
            var a = old["sensors"].find(id)
            var b = c["sensors"][id]
            if a == nil || a.find("role", "off") != b.find("role", "off") || a.find("notify", "off") != b.find("notify", "off")  sensor = true end
            if b.contains("cond") && (a == nil || json.dump(a.find("cond")) != json.dump(b["cond"]))  self.crossed[id] = false end
        end
        for id: old["sirens"]
            if c["sirens"].find(id) == nil  self.found(id) end
        end
        var p = old["panic"]
        var q = c["panic"]
        var panic = !ZbBridgeAlarm.same(p.find("devices", []), q["devices"]) || json.dump(p.find("burst", ZbBridgeAlarm.BURST)) != json.dump(q["burst"])
        for k: ["ha", "panels", "alarm"]
            if (p.find(k) == true) != (q[k] == true)  panic = true end
        end
        if sensor  said.push("sensor") end
        if json.dump(old["times"]) != json.dump(c["times"])  said.push("times") end
        if panic  said.push("panic") end
        if !ZbBridgeAlarm.same(old["sirens"], c["sirens"])  said.push("siren") end
        self.cfg = c
        self.save_cfg()
        for v: said  self.event("config", "panel", "house", v, false) end
    end

    # whether two lists have the same entries, in any order
    static def same(a, b)
        import json
        if size(a) != size(b) return false end
        var had = {}
        for x: a  had[json.dump(x)] = true end
        for x: b
            if !had.contains(json.dump(x)) return false end
        end
        return true
    end

    def lost_changed()
        import persist
        persist.setmember(ZbBridgeAlarm.LOST_KEY, self.lostset)
        self.flush()
        self.say_lost()
    end

    # the open losses to the panel, as the list "lo": [[id, kind, grade], ...]
    def say_lost()
        var l = []
        for id: self.lostset.keys()  l.push([id, self.lostset[id][0], self.lostset[id][1]]) end
        self.say_list("lo", l)
    end

    # How many devices an arm in this mode would leave unprotected: the sensors lost that watch in it, the sirens, the bridges
    def unprotected(mode)
        var n = 0
        for id: self.lostset.keys()
            if self.lostset[id][0] == "sensor"
                var sc = self.cfg["sensors"].find(id)
                if sc != nil && ZbBridgeAlarm.guards(sc, mode)  n += 1 end
            else
                n += 1
            end
        end
        return n
    end

    # The bridges of the house, as the mesh says them: the ones that are silent are lost, once each (one notice for a bridge, whatever it owns), and the ones
    # heard again are found. A bridge is "bridge N" by its number on the mesh
    def bridges(gone, back)
        for id: gone
            var key = "bridge " + str(id)
            if !self.lostset.contains(key)
                var g = self.loss_grade("house", true)
                self.event("unreach", key, g, nil, false)
                self.lose(key, "bridge", g)
            end
        end
        for id: back  self.found("bridge " + str(id)) end
    end

    # The sirens that did not confirm the order by its fifth try are a loss, once each (the grade is the house's, or the alert of an armed alarm)
    def unconfirmed_notice()
        for ieee: self.unconfirmed()
            if !self.lostset.contains(ieee)
                var g = self.loss_grade("house", true)
                self.event("unreach", ieee, g, nil, false)
                self.lose(ieee, "siren", g)
            end
        end
    end

    # The sirens Z2T says it cannot reach, once each until they answer again: a house alert when the alarm is armed, a house notice when it
    # is not. Said again at an arm, with `again`: a siren with no power is found out at the break-in otherwise
    def lost_sirens(again)
        for ieee: self.cfg["sirens"]
            var gone = self.reach_of(ZbBridgeAlarm.device_of(ieee)) == false
            if gone && (again || !self.quiet.find(ieee, false))
                self.quiet[ieee] = true
                var g = again || self.st != "disarmed" ? "alert" : "house"
                self.event("unreach", ieee, g, nil, false)
                self.lose(ieee, "siren", g)
            elif !gone && self.unconfirmed().find(ieee) == nil
                self.quiet[ieee] = false
                self.found(ieee)
            end
        end
    end

    # The panic: an event, and the actions the alarm settings have turned on. By default it only says
    # so, quietly; the siren and the panels' screens are the settings' to ask for
    def panic(by)
        var p = self.cfg["panic"]
        var loud = p.find("alarm", false) == true
        var grade = loud ? "alarm" : (p.find("panels", false) == true ? "alert" : "house")
        self.event("panic", by, grade, nil, false)
        if loud  self.trigger(by, "panic") end
        for pair: p.find("devices", [])
            if isinstance(pair, list) && size(pair) == 2  self.act_on(pair[0], pair[1]) end
        end
    end

    # --- the panel's and Home Assistant's words --------------------------------------------------------

    # Events taken as seen: one, or with no id all
    def ack(id)
        if id == nil
            for e: self.events  self.seen[e["i"]] = true end
        else
            self.seen[int(id)] = true
        end
        self.say({"ack": id == nil ? "all" : int(id)})
    end

    # Events deleted on a panel: out of the list kept in RAM, and the panels told, which take them out of theirs. The
    # changes of state kept in the flash stay: they are the alarm's record, not the panels' list
    def drop(ids)
        if !isinstance(ids, list) return false end
        var i = size(self.events) - 1
        while i >= 0
            var id = self.events[i]["i"]
            if ids.find(id) != nil
                self.events.remove(i)
                if self.seen.contains(id)  self.seen.remove(id) end
            end
            i -= 1
        end
        self.say({"del": ids})
        return true
    end

    # The last events, newest last, in messages of LOG_CHUNK
    def send_log(n)
        var total = size(self.events)
        var first = total - int(n)
        if first < 0  first = 0 end
        var at = first
        while at < total
            var chunk = []
            var i = at
            while i < total && i < at + ZbBridgeAlarm.LOG_CHUNK
                chunk.push(ZbBridgeAlarm.pack(self.events[i]))
                i += 1
            end
            self.say({"log": chunk, "at": at - first, "of": total - first})
            at = i
        end
        return true
    end

    # The settings, for the panel's screens: the times, the panic's actions and burst, the sirens, the devices left out of the
    # burst and the ones the panic runs, and each sensor's record in a message of its own. A list is said whole, LIST_CHUNK of its
    # entries to a frame: the first as it always was, the key and the list, and the others as the same key with
    # "at", where the first of them stands in the list, which the panel puts after what it has (PanelAlarm.take_list). The sirens'
    # first are in the cfg message, and the rest are "sr"
    def send_config()
        var p = self.cfg["panic"]
        var sirens = self.cfg["sirens"]
        self.say({"cfg": {"t": self.times(), "p": [p.find("ha", true) ? 1 : 0, p.find("panels", false) ? 1 : 0, p.find("alarm", false) ? 1 : 0],
                          "b": p.find("burst", ZbBridgeAlarm.BURST), "s": ZbBridgeAlarm.slice(sirens, 0)}})
        self.say_rest("sr", sirens)
        self.say_list("np", self.cfg["nopanic"])
        self.say_list("pd", p.find("devices", []))
        self.say_lost()
        for ieee: self.cfg["sensors"].keys()
            var sc = self.cfg["sensors"][ieee]
            var c = sc.find("cond")
            self.say({"sc": [ieee, sc.find("role", "off"), sc.find("entry", false) ? 1 : 0, sc.find("notify", "off"), sc.find("sound", false) ? 1 : 0,
                             c != nil ? c["k"] : "", c != nil ? c["w"] : "", c != nil ? c["x"] : 0, int(sc.find("news", ZbBridgeAlarm.NEWS_H))]})
        end
        return true
    end

    # up to LIST_CHUNK entries of a list, from `at`
    static def slice(items, at)
        var out = []
        var i = at
        while i < size(items) && size(out) < ZbBridgeAlarm.LIST_CHUNK
            out.push(items[i])
            i += 1
        end
        return out
    end

    # a list whole: its first LIST_CHUNK at once, as {key: [...]} even when it is empty (the panel empties its own), and the rest
    def say_list(key, items)
        self.say({key: ZbBridgeAlarm.slice(items, 0)})
        self.say_rest(key, items)
    end

    # what comes after the first LIST_CHUNK of a list: {key: [...], "at": n}, each LIST_CHUNK of them
    def say_rest(key, items)
        var at = ZbBridgeAlarm.LIST_CHUNK
        while at < size(items)
            self.say({key: ZbBridgeAlarm.slice(items, at), "at": at})
            at += ZbBridgeAlarm.LIST_CHUNK
        end
    end

    def cmd(m)
        var verb = m.find("do")
        if verb == "arm" return self.arm(m.find("mode"), m.find("by", "panel")) end
        if verb == "disarm" return self.disarm(m.find("by", "panel")) end
        if verb == "panic"
            self.panic(m.find("by", "panel"))
            return true
        end
        if verb == "ack"
            self.ack(m.find("id"))
            return true
        end
        if verb == "del" return self.drop(m.find("ids")) end
        if verb == "state"
            self.say_state()
            return true
        end
        if verb == "log" return self.send_log(m.find("n", 8)) end
        if verb == "config" return self.send_config() end
        if ZbBridgeAlarm.SETS.find(verb) != nil
            var ok = verb == "sensor" ? self.set_sensor(m) : verb == "times" ? self.set_times(m) : verb == "panic_cfg" ? self.set_panic(m) :
                     verb == "siren" ? self.set_siren(m) : self.set_burst(m)
            # how the house is guarded changed: an event of its own, with who asked. Of a sensor's record only what takes
            # it in or out of the alarm is one, the role and the notification; its entry door, sound and condition are not, nor is a
            # device's place in the burst
            if ok == true && verb != "burst" && (verb != "sensor" || m.contains("role") || m.contains("notify"))
                self.event("config", m.find("by", "panel"), "house", verb == "panic_cfg" ? "panic" : verb, false)
            end
            return ok
        end
        return false
    end

    # ZbRelayAlarm {...}: the panel's command, as the console takes it
    def cmd_payload(payload)
        import json
        var m = json.load(str(payload))
        if isinstance(m, map) && self.cmd(m) == true
            tasmota.resp_cmnd_done()
        else
            tasmota.resp_cmnd_failed()
        end
    end

    # --- the settings --------------------------------------------------------------------------------

    # A sensor's record, by the fields a command names: the others stay. A record with no role, no notification and no
    # condition is the sensor out of the alarm, and goes
    def set_sensor(m)
        var id = m.find("id")
        if type(id) != "string" return false end
        var ieee = ZbBridgeAlarm.norm(id)
        var sc = self.cfg["sensors"].find(ieee)
        if sc == nil  sc = {} end
        var role = m.find("role")
        if role != nil
            if ZbBridgeAlarm.ROLES.find(role) == nil return false end
            sc["role"] = role
        end
        var notify = m.find("notify")
        if notify != nil
            if ZbBridgeAlarm.GRADES.find(notify) == nil return false end
            sc["notify"] = notify
        end
        if m.contains("entry")  sc["entry"] = m["entry"] == true end
        if m.contains("sound")  sc["sound"] = m["sound"] == true end
        if m.contains("news")  sc["news"] = int(m["news"]) end
        if m.contains("key")
            var w = m.find("way")
            if (w != "above" && w != "below") || type(m["key"]) != "string" return false end
            sc["cond"] = {"k": m["key"], "w": w, "x": m.find("limit", 0)}
            # a new condition starts from not holding, whatever the old one did
            self.crossed[ieee] = false
        end
        if m.find("cond") == false  sc.remove("cond") end
        if sc.find("role", "off") == "off" && sc.find("notify", "off") == "off" && !sc.contains("cond")
            self.cfg["sensors"].remove(ieee)
            self.found(ieee)
        else
            self.cfg["sensors"][ieee] = sc
        end
        self.save_cfg()
        return true
    end

    def set_times(m)
        var t = self.times()
        var out = [t[0], t[1], t[2]]
        var keys = ["exit", "entry", "siren"]
        for i: 0 .. 2
            if m.contains(keys[i])
                var v = int(m[keys[i]])
                if v < 0 || v > 900 return false end
                out[i] = v
            end
        end
        self.cfg["times"] = out
        self.save_cfg()
        return true
    end

    # the panic's actions: ha, panels and alarm on or off, and its devices, [[ieee, act], ...]
    def set_panic(m)
        var p = self.cfg["panic"]
        for k: ["ha", "panels", "alarm"]
            if m.contains(k)  p[k] = m[k] == true end
        end
        if m.contains("burst")
            var b = m["burst"]
            if !isinstance(b, list) || size(b) != 2 return false end
            var n = int(b[0])
            var s = int(b[1])
            if n < 0 || n > 50 || s < 1 || s > 30 return false end
            p["burst"] = [n, s]
        end
        if m.contains("devices")
            if !isinstance(m["devices"], list) return false end
            var out = []
            for pair: m["devices"]
                if !isinstance(pair, list) || size(pair) != 2 return false end
                out.push([ZbBridgeAlarm.norm(pair[0]), str(pair[1])])
            end
            p["devices"] = out
        end
        self.save_cfg()
        return true
    end

    # a device left out of the burst, or put back in: one whose zone sticks, or flaps
    def set_burst(m)
        var id = m.find("id")
        if type(id) != "string" return false end
        var ieee = ZbBridgeAlarm.norm(id)
        var l = self.cfg["nopanic"]
        var at = l.find(ieee)
        if m.find("on", true) == true
            if at != nil  l.remove(at) end
        elif at == nil
            l.push(ieee)
        end
        self.save_cfg()
        return true
    end

    # a device that is a siren: put on the list, or taken off it. A channel after the first of a switch of several may be one (its id "0x...1/2": the
    # command goes to that endpoint); a "/" that is no endpoint is refused, since the command would go to the first channel
    def set_siren(m)
        var id = m.find("id")
        if type(id) != "string" return false end
        var ieee = ZbBridgeAlarm.norm(id)
        if ZbBridgeAlarm.split(ieee) == nil return false end
        var l = self.cfg["sirens"]
        var at = l.find(ieee)
        if m.find("on", true) == true
            if at == nil  l.push(ieee) end
        elif at != nil
            l.remove(at)
            self.found(ieee)
        end
        self.save_cfg()
        return true
    end
end
