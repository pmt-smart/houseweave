# panel_alarm.be -- the house alarm as the panel keeps it: the state the bridge says (ZbAlarm, over the
# link), the events it says, which of them are seen, the notification that takes the screen, the beeps, and the panic touch
# on the glass. What it shows is panel_alarm_view.be's; what it sends is `["alarm", {...}]` effects, which the brain turns into
# ZbRelayAlarm on the link (PanelPlanCommands.alarm).
#
# It is the panel's window on the alarm and owns none of it: the state and the events are the bridge's (zbbridge_alarm.be), and a
# panel only arms, disarms, acknowledges, deletes and asks. A restart of the panel asks for them again when the link comes up.
#
# A NOTIFICATION DELETED leaves this panel's list at once and goes to the bridge, which takes it out of its own and tells
# its other panels ({"del": [ids]}); a word of the house kept here, numbered below zero, is only this panel's.
#
# THE NOTICE: an event of the alert or the alarm grade takes the glass, over whatever is on it, until a touch
# or an acknowledgement; a panic given on this glass shows "Panic activated" for BRIEF_MS and goes by itself, a touch does not take
# it off ("Panic not sent" when the word did not leave). The warnings, the local and house events, stay on the lists and as dots
# on the plan.
#
# THE BEEPS are this panel's, when its Alarm sounds allows them (Off, Home or Always) and the event or the state asks: a
# trigger beeps until it ends, an exit time every 2 s, an entry time every second, an alert three at a time every 10 s, a
# sensor that asked for it once.
#
# THE PANIC TOUCH: TAPS touches within TAP_WINDOW_MS, each at least TAP_GAP_MS after the one before, on
# any page but the keyboards, the lock and the pages of + and - (the thermostat, the blind and the lamp), are the panic.
#
# THE LINK: the bridge is where the alarm lives, and a panel that lost it does not know the state: with its link down the state is
# "No link", Arm and Disarm send nothing, and a panic is not announced.
#
# THE HOUSE: in a house whose list has the alarm's configuration, the settings are the house's (house_alarm.be). The screens' model is made
# from the list, of every bridge at once, and a word of the settings is written there, under the bridge that owns the device; what a bridge says of its
# own settings is not this panel's model then, and only its losses ("lo") are taken. The state and the events stay the bridge's.

#@ solidify:PanelAlarm
class PanelAlarm
    static EVENT_MAX = 40
    # the numbers of the events deleted that go to the bridge in one word
    static DEL_CHUNK = 12
    static BRIEF_MS = 5000
    static TAPS = 8
    static TAP_WINDOW_MS = 3000
    static TAP_GAP_MS = 80
    static SOUNDS = ["off", "home", "always"]
    static EXIT_BEEP_S = 2
    static ALERT_BEEP_S = 10
    static STATE_WORDS = {"disarmed": "Disarmed", "arming": "Arming", "armed_home": "Armed home", "armed_away": "Armed away",
                          "pending": "Disarm now", "triggered": "TRIGGERED"}
    static EVENT_WORDS = {"arm": "armed", "disarm": "disarmed", "trigger": "triggered", "panic": "panic", "bypass": "left out",
                          "siren_off": "siren off", "open": "opened", "motion": "motion", "water": "water", "smoke": "smoke",
                          "co": "CO", "above": "high", "below": "low", "tamper": "tampered", "battery": "battery low",
                          "nonews": "no news", "alarm": "alarm", "config": "settings changed", "unreach": "unreachable"}
    # what is said of the house, and not a warning about a sensor
    static INFO = ["arm", "disarm", "siren_off", "config"]
    # the events of the alarm itself, which the screensaver's alarm sign says while they are not seen; the rest are the house's
    static OF_ALARM = ["trigger", "panic", "tamper", "bypass", "unreach"]
    # the colours of the two signs, RGB565: red for a trigger or a panic, orange for what only warns, yellow for the house's own
    static RED = 0xF800
    static ORANGE = 0xFD20
    static YELLOW = 0xFFE0

    var zb         # PanelZigbee: the link, the store and the views
    var st         # the alarm's state, as the bridge says it
    var mode       # "home", "away" or nil
    var ver        # the state's version
    var cause      # [sensor, kind] of the trigger, or nil
    var reach      # how far the state reached, [the bridges that applied it, of how many, 1 while it is applying], or nil: one bridge, nothing to say
    var lost       # how many devices the arm that holds left unprotected, or 0
    var events     # the events, newest last, each [id, time, type, who or sensor, grade, value, sound]
    var seen       # event id -> true
    var notice     # the notification on the glass: {"kind": "event" or "brief", "e": the event}, or nil
    var brief_at   # when this glass gave a panic, ms, or nil: its own "Panic activated" is shown, and the bridge's word is not another
    var cfg        # what the bridge says of the settings: {"t", "p", "b", "s", "sensors": {id: [...]}}
    var zoned      # sensor -> true: it has an IAS zone, so no numeric condition
    var taps       # the times of the last touches, ms
    var buzzing    # a continuous beep is on
    var beep_at    # when the next beep of the state on, ms
    var cmd_fn     # a closure that takes a Tasmota command, for a test; nil runs it
    var own_id     # the number of the last word of the house kept here (house_word), below zero
    var house      # the house's mesh (house_mesh.be) on a panel that has one, or nil
    var owner      # f(id) -> the number of the bridge that owns a device, the bridge of the house for one of no bridge numbered; the boot's

    def init(zb)
        self.zb = zb
        self.st = "disarmed"
        self.mode = nil
        self.ver = 0
        self.cause = nil
        self.reach = nil
        self.lost = 0
        self.events = []
        self.seen = {}
        self.notice = nil
        self.brief_at = nil
        self.cfg = {"sensors": {}}
        self.zoned = {}
        self.taps = []
        self.buzzing = false
        self.beep_at = nil
        self.own_id = 0
    end

    # --- the words ------------------------------------------------------------------------------------

    # a time of an event, UTC seconds, as the hour and minute of this panel's clock, or "--:--" with none
    static def hhmm(t)
        if t == nil || t <= 0 return "--:--" end
        var r = tasmota.rtc()
        return PanelClock.hhmm(((t + r["local"] - r["utc"]) % 86400) / 60)
    end

    # a device's name, as the panel has it, or the end of its address
    def name_of(id)
        var d = self.zb != nil ? self.zb.store.find_device(id) : nil
        if d != nil return d[1] end
        var s = str(id)
        return size(s) > 4 ? s[-4 ..] : s
    end

    # A bridge as the alarm keys it, "bridge 3", by its number on the mesh (zbbridge_alarm.be), by its name on the glass, which does not show the
    # number; anything else as it is. With no house to ask, as it is too
    static def bridge_name(who)
        import global
        if size(who) < 8 || who[0 .. 6] != "bridge " return who end
        var h = global.contains("house") ? global.house : nil
        if h == nil return who end
        var s = h.list.label(int(who[7 ..]))
        return s != nil ? s : "A bridge"
    end

    # the zone a device is in, or ""
    def room_of(id)
        var z = self.zb != nil ? self.zb.store.zone_of(id) : nil
        return z != nil ? z["name"] : ""
    end

    # what an event says, as a line of a list: "22:14 Front door opened"
    def line_of(e)
        var w = PanelAlarm.EVENT_WORDS.find(e[2], e[2])
        var who = e[3] == nil ? "" : str(e[3])
        var is_device = size(who) > 2 && who[0 .. 1] == "0x"
        var subject = is_device ? self.name_of(who) : ((e[2] == "unreach" || e[2] == "nonews") ? PanelAlarm.bridge_name(who) : "")
        var s = PanelAlarm.hhmm(e[1]) + " "
        if e[2] == "arm" return s + "Armed " + str(e[5]) + (is_device ? "" : " by " + who) end
        if e[2] == "disarm" return s + "Disarmed" + (who != "" ? " by " + who : "") end
        if e[2] == "trigger" return s + "TRIGGERED" + (e[5] != nil ? ": " + str(e[5]) : "") + (is_device ? " " + subject : "") end
        if e[2] == "panic" return s + "PANIC" + (is_device ? " " + subject : "") end
        if e[2] == "config" return s + "Settings changed: " + str(e[5]) + (who != "" && who != "panel" ? " by " + who : "") end
        if e[2] == "above" || e[2] == "below" return s + subject + " " + w + " " + str(e[5]) end
        if e[2] == "left" return s + who + " left the house: " + PanelUi.plural(int(e[5]), "device", "devices") + " removed" end
        return s + (subject != "" ? subject + " " : "") + w
    end

    # What an event says, whole, for its own screen: its words, where, and when. "Front door opened. Kitchen. Yesterday at 22:14."
    def full_of(e)
        var s = self.line_of(e)[6 ..] + "."
        var who = e[3] == nil ? "" : str(e[3])
        var room = size(who) > 2 && who[0 .. 1] == "0x" ? self.room_of(who) : ""
        if room != ""  s += " " + room + "." end
        return s + " " + PanelAlarm.day_of(e[1]) + "."
    end

    # the day and the hour of an event by this panel's clock: "Today at 22:14", "Yesterday at 07:02", "3 days ago at 10:00"
    static def day_of(t)
        if t == nil || t <= 0 return "At a time not known" end
        var r = tasmota.rtc()
        var off = r["local"] - r["utc"]
        var days = (r["utc"] + off) / 86400 - (t + off) / 86400
        var d = days <= 0 ? "Today" : days == 1 ? "Yesterday" : str(days) + " days ago"
        return d + " at " + PanelAlarm.hhmm(t)
    end

    # an event kept here, by its number, or nil
    def event_of(id)
        for e: self.events if e[0] == id return e end end
        return nil
    end

    # the state in words, or "No link" while the bridge is out of reach: what the panel kept of it may be a state long gone
    def state_word()
        if !self.linked() return "No link" end
        return self.headline()
    end

    # What the glass says of the state: the word; how many bridges applied it ("Disarmed · 12 of 12") once it is counted, which the bridge
    # leaves out for the first seconds of a change; "Armed away only here" when some did not (an arm that did not reach them leaves them unarmed, the
    # dangerous side), and "Disarmed here · 3 out of reach" for the rest; and, for an arm, how many devices it left unprotected
    def headline()
        var w = PanelAlarm.STATE_WORDS.find(self.st, self.st)
        var lost = self.lost > 0 && self.st != "disarmed" ? " · " + str(self.lost) + " unprotected" : ""
        var r = self.reach
        if !isinstance(r, list) || size(r) < 3 || r[2] == 1 || r[1] < 2 return w + lost end
        if r[0] >= r[1] return w + " · " + str(r[0]) + " of " + str(r[1]) + lost end
        if self.st == "armed_home" || self.st == "armed_away" return w + " only here" + lost end
        return w + " here · " + str(r[1] - r[0]) + " out of reach" + lost
    end

    # Whether the link to the bridge is up, as the Zigbee bridge last saw it (a second old at most); with none to ask, as in a test
    # of the views, it is
    def linked()
        import global
        var b = global.contains("zb_bridge") ? global.zb_bridge : nil
        return b == nil || b.last_link == true
    end

    # what caused the trigger or the entry time, as words: "Front door opened"
    def cause_text()
        if self.cause == nil || size(self.cause) < 2 return "" end
        var who = str(self.cause[0])
        var w = PanelAlarm.EVENT_WORDS.find(self.cause[1], str(self.cause[1]))
        var is_device = size(who) > 2 && who[0 .. 1] == "0x"
        return (is_device ? self.name_of(who) + " " : "") + w
    end

    # --- what the bridge says ------------------------------------------------------------------------

    # A ZbAlarm message: its parts, in any order; what the screens and the notice have to do comes back as effects
    def on_message(m)
        var out = []
        if !isinstance(m, map) return out end
        if m.contains("st") self.take_state(m, out) end
        if m.contains("ev") self.take_event(m["ev"], out) end
        if m.contains("clr") self.clear(m["clr"], out) end
        if m.contains("ack") self.take_ack(m["ack"], out) end
        if m.contains("del") self.take_drop(m["del"], out) end
        if m.contains("log") self.take_log(m["log"]) end
        # in a house that keeps the alarm's configuration, the bridge's word of its own settings is not the screens' model: only its losses are
        var own = !self.of_house()
        if own && m.contains("cfg") self.take_cfg(m["cfg"]) end
        if own && m.contains("sc") self.take_sensor(m["sc"]) end
        for k: ["np", "pd", "sr", "lo"]
            if m.contains(k) && (own || k == "lo") self.take_list(k, m[k], m.find("at", 0)) end
        end
        if size(out) == 0 && (m.contains("st") || m.contains("log") || m.contains("cfg") || m.contains("sc")) out.push(["alarmShow"]) end
        return out
    end

    def take_state(m, out)
        self.st = str(m["st"])
        self.mode = m.find("md")
        self.ver = int(m.find("v", self.ver))
        self.cause = m.find("c")
        self.reach = m.find("r")
        self.lost = int(m.find("l", 0))
        # a state that is not the trigger ends its beep, and the notice of an alarm over (the glass keeps what it shows
        # until it is touched: the person looking at it may not have seen it yet)
        if self.st != "triggered" && self.buzzing  self.stop_beep() end
        if self.st == "triggered" && self.sound_ok() && !self.buzzing
            self.buzzing = true
            self.run_cmd("Buzzer -1,2,2")
        end
        self.beep_at = nil
        out.push(["alarmShow"])
    end

    def take_event(p, out)
        if !isinstance(p, list) || size(p) < 7 return end
        for e: self.events if e[0] == p[0] return end end
        self.events.push(p)
        while size(self.events) > PanelAlarm.EVENT_MAX
            var old = self.events[0][0]
            if self.seen.contains(old)  self.seen.remove(old) end
            self.events.remove(0)
        end
        var g = p[4]
        # this glass gave a panic a moment ago and showed its own screen: the bridge's word of it is not another
        var own = p[2] == "panic" && self.brief_at != nil && tasmota.millis() - self.brief_at < PanelAlarm.BRIEF_MS * 2
        if own
            self.brief_at = nil
        elif g == "alert" || g == "alarm"
            self.notice = {"kind": "event", "e": p}
            out.push(["alarmNotice"])
        elif p[2] == "panic" && size(str(p[3])) > 2 && str(p[3])[0 .. 1] == "0x"
            # a panic given by a device: the screen of the panels of its bridge says so, for a moment
            self.notice = {"kind": "brief", "e": p, "until": tasmota.millis(PanelAlarm.BRIEF_MS)}
            out.push(["alarmNotice"])
        end
        # a sensor that asks for it beeps, once, on a panel whose sounds allow it
        if p[6] == 1 && p[2] != "trigger" && self.sound_ok()  self.run_cmd(g == "alert" || g == "alarm" ? "Buzzer 3,1,1" : "Buzzer 1,1,1") end
        out.push(["alarmShow"])
    end

    # A word of the house that this panel keeps: a bridge that left the house, and how many devices left this panel with it. It is a
    # warning of the house's in the Notifications until it is seen, numbered below zero so that no event of the bridge's has its number. The effects
    def house_word(kind, who, value)
        self.own_id -= 1
        var out = []
        self.take_event([self.own_id, tasmota.rtc()["utc"], kind, who, "local", value, 0], out)
        return out
    end

    # a local notice that went away by itself: seen
    def clear(ieee, out)
        for e: self.events
            # a local notice that went away by itself, and a device that was lost and is found again
            if e[3] == ieee && (e[4] == "local" || e[2] == "unreach" || e[2] == "nonews")  self.seen[e[0]] = true end
        end
        out.push(["alarmShow"])
    end

    def take_ack(id, out)
        if id == "all"
            for e: self.events  self.seen[e[0]] = true end
        elif type(id) == "int"
            self.seen[id] = true
        end
        if self.notice != nil && self.notice["kind"] == "event" && self.seen.contains(self.notice["e"][0])
            self.notice = nil
            out.push(["alarmDismiss"])
        end
        out.push(["alarmShow"])
    end

    # events deleted, here: out of the list and of the seen, and the notice of one of them off the glass
    def take_drop(ids, out)
        if !isinstance(ids, list) return end
        var i = size(self.events) - 1
        while i >= 0
            var id = self.events[i][0]
            if ids.find(id) != nil
                self.events.remove(i)
                if self.seen.contains(id)  self.seen.remove(id) end
            end
            i -= 1
        end
        if self.notice != nil && self.notice["kind"] == "event" && ids.find(self.notice["e"][0]) != nil
            self.notice = nil
            out.push(["alarmDismiss"])
        end
        out.push(["alarmShow"])
    end

    # the log the bridge sent when asked: the events not here yet, in their order
    def take_log(chunk)
        if !isinstance(chunk, list) return end
        for p: chunk
            if !isinstance(p, list) || size(p) < 7 continue end
            var have = false
            for e: self.events if e[0] == p[0] have = true end end
            if !have
                var i = size(self.events)
                while i > 0 && self.events[i - 1][0] > p[0]  i -= 1 end
                self.events.insert(i, p)
            end
        end
        while size(self.events) > PanelAlarm.EVENT_MAX  self.events.remove(0) end
    end

    # the settings the bridge says: times, panic actions and burst, sirens; and a sensor's record at a time
    def take_cfg(c)
        if !isinstance(c, map) return end
        for k: c.keys()  self.cfg[k] = c[k] end
    end

    # A list the bridge says in messages of a few entries each: the first has no "at" and is the list, and the others
    # say where they stand in it, "at", and go after what is here. The sirens are "s" in the cfg message, and "sr" for their rest.
    # A message that does not follow what is here, one before it lost, is let go: what the panel keeps is the head of the bridge's
    # list, and not a list with a hole in it
    def take_list(key, chunk, at)
        if !isinstance(chunk, list) return end
        var k = key == "sr" ? "s" : key
        if type(at) != "int" || at <= 0
            self.cfg[k] = chunk
            return
        end
        var have = self.cfg.find(k)
        if !isinstance(have, list) || at > size(have) return end
        var out = have[0 .. at - 1]
        for e: chunk  out.push(e) end
        self.cfg[k] = out
    end

    def take_sensor(r)
        if !isinstance(r, list) || size(r) < 9 return end
        self.cfg["sensors"][r[0]] = r[1 ..]
    end

    # --- the house's settings ------------------------------------------------------------

    # whether the alarm's configuration is the house's: this panel in a house whose list has one
    def of_house()
        var h = self.house
        return h != nil && h.list.me >= 1 && h.alarm_setting() != nil
    end

    # The screens' model made from the house's list (HouseAlarm.panel_cfg), with the losses the bridge said kept. False when the configuration is no house's
    def from_house()
        import global
        if !self.of_house() return false end
        var lo = self.cfg.find("lo")
        self.cfg = global.HouseAlarm.panel_cfg(self.house)
        if lo != nil  self.cfg["lo"] = lo end
        return true
    end

    # A word of the screens to the alarm, kept by the house when this panel is in one (HouseAlarm.edit): true when the house has it, and no bridge is told.
    # The first word starts from what the screens had of the bridge of the house. A device's action in the panic (panic_act) is the whole list the screens
    # have, which the view changed. A word the house did not take, in a house that keeps the alarm, goes to no bridge either: the screens show the house's
    def to_house(m)
        import global
        var h = self.house
        if h == nil || h.list.me < 1 || self.owner == nil return false end
        if m.find("do") == "panic_act"  m = {"do": "panic_cfg", "devices": self.cfg.find("pd", [])} end
        if ["sensor", "times", "panic_cfg", "siren", "burst"].find(m.find("do")) == nil return false end
        var ok = global.HouseAlarm.edit(h, m, self.owner, self.cfg)
        return self.from_house() || ok
    end

    # a device that left the network leaves the house's alarm too
    def left(dev)
        import global
        if self.of_house() && global.HouseAlarm.forget(self.house, global.HouseAlarm.norm(PanelStore.ieee_part(dev)))  self.from_house() end
    end

    # The link came up: the state, the log and the settings asked of the bridge, a moment apart, for the ESP-NOW driver keeps four
    # frames for its loop
    def link_up()
        if self.zb == nil return end
        self.ask_later(1200, {"do": "state"})
        self.ask_later(1600, {"do": "log", "n": 20})
        self.ask_later(2000, {"do": "config"})
    end

    def ask_later(ms, m)
        tasmota.set_timer(ms, / -> self.zb.emit([["alarm", m]]))
    end

    # --- what an arm would leave unprotected -------------------------------------------

    # whether a sensor of this role watches in the mode of an arm
    static def watches(role, mode)
        return role == "perimeter" || role == "24h" || (role == "interior" && mode == "away")
    end

    # The names of what is lost and an arm in this mode would leave unprotected, from the list the bridge says: the sensors that watch in the mode, the sirens
    # and the bridges
    def unprotected_names(mode)
        var out = []
        var lo = self.cfg.find("lo")
        if !isinstance(lo, list) return out end
        for it: lo
            if !isinstance(it, list) || size(it) < 3 continue end
            if it[1] == "sensor"
                var r = self.cfg["sensors"].find(it[0])
                if r == nil || !PanelAlarm.watches(r[0], mode) continue end
            end
            out.push(it[1] == "bridge" ? PanelAlarm.bridge_name(str(it[0])) : self.name_of(it[0]))
        end
        return out
    end

    def unprotected(mode) return size(self.unprotected_names(mode)) end

    # --- what a person did ------------------------------------------------------------------------------

    # Arm and Disarm are words to the bridge, and with its link down there is none to say them to: the screen says No link
    def arm(mode) return self.linked() ? [["alarm", {"do": "arm", "mode": mode, "by": "panel"}]] : [] end
    def disarm() return self.linked() ? [["alarm", {"do": "disarm", "by": "panel"}]] : [] end

    # an event, or all of them, taken as seen: here at once, and on the bridge
    def ack(id)
        var out = []
        self.take_ack(id == nil ? "all" : id, out)
        out.push(["alarm", id == nil ? {"do": "ack"} : {"do": "ack", "id": id}])
        return out
    end

    # Events deleted: here at once, and on the bridge, DEL_CHUNK numbers a word; the house's words kept here are only this panel's
    def drop(ids)
        var out = []
        self.take_drop(ids, out)
        var theirs = []
        for id: ids if id >= 0  theirs.push(id) end end
        var i = 0
        while i < size(theirs)
            var chunk = []
            var k = i
            while k < size(theirs) && k < i + PanelAlarm.DEL_CHUNK
                chunk.push(theirs[k])
                k += 1
            end
            out.push(["alarm", {"do": "del", "ids": chunk}])
            i = k
        end
        return out
    end

    # The notification touched: it leaves this glass, and what it was of stays to be acknowledged. Not a brief one, the panic's own word:
    # the release of the touch that gave it would take it off at once, and it goes by its time (tick)
    def dismiss()
        if self.notice != nil && self.notice["kind"] == "brief" return [] end
        self.notice = nil
        self.stop_beep_if_notice()
        return [["alarmDismiss"]]
    end

    # The panic, from this glass: the word to the bridge, and its own screen. The screen says "Panic activated" only for a word that
    # left: with the link down it says "Panic not sent" (a "fail" notice), and so does one the send said it could not (unsent)
    def panic()
        var ok = self.linked()
        self.brief_at = ok ? tasmota.millis() : nil
        self.notice = {"kind": "brief", "e": nil, "until": tasmota.millis(PanelAlarm.BRIEF_MS), "fail": !ok}
        return [["alarm", {"do": "panic", "by": "panel"}], ["alarmNotice"]]
    end

    # A word to the bridge that did not leave (the send said so, `false`): a panic's screen says it was not sent
    def unsent(m)
        if m.find("do") == "panic" && self.notice != nil && self.notice["kind"] == "brief" && self.notice["e"] == nil
            self.notice["fail"] = true
            self.brief_at = nil
        end
    end

    # --- the sounds -------------------------------------------------------------------------------------

    # Whether this panel's Alarm sounds allows a beep now: Off never, Home with the house armed home, Always always
    def sound_ok()
        var pref = self.zb != nil && self.zb.ui != nil ? self.zb.ui.prefs.find("alarmSounds", "off") : "off"
        if pref == "always" return true end
        return pref == "home" && self.mode == "home"
    end

    def run_cmd(c)
        if self.cmd_fn != nil
            self.cmd_fn(c)
        else
            tasmota.cmd(c)
        end
    end

    def stop_beep()
        self.buzzing = false
        self.run_cmd("Buzzer 0")
    end

    def stop_beep_if_notice()
        if self.buzzing && self.st != "triggered"  self.stop_beep() end
    end

    # Once a second: the beeps of the state, and a brief notice's end. The effects it returns end a notice that ran out
    def tick()
        var out = []
        if self.notice != nil && self.notice["kind"] == "brief" && tasmota.time_reached(self.notice["until"])
            self.notice = nil
            out.push(["alarmDismiss"])
        end
        if !self.sound_ok() return out end
        var now = tasmota.millis()
        if self.st == "arming" || self.st == "pending"
            if self.beep_at == nil || tasmota.time_reached(self.beep_at)
                self.run_cmd("Buzzer 1,1,1")
                self.beep_at = tasmota.millis((self.st == "pending" ? 1 : PanelAlarm.EXIT_BEEP_S) * 1000)
            end
        elif self.notice != nil && self.notice["kind"] == "event" && self.notice["e"][4] == "alert"
            if self.beep_at == nil || tasmota.time_reached(self.beep_at)
                self.run_cmd("Buzzer 3,1,1")
                self.beep_at = tasmota.millis(PanelAlarm.ALERT_BEEP_S * 1000)
            end
        end
        return out
    end

    # --- the panic touch ---------------------------------------------------------------------------------

    # A touch on the glass, by the page it landed on. The keyboards and the lock take many; a notice on the glass takes the touch to
    # leave it. True, with the panic's effects, when this is the one that completes the run
    def touch(page)
        var out = []
        if self.notice != nil return out end
        var pages = self.zb != nil && self.zb.ui != nil ? self.zb.ui.shape["pages"] : {}
        # the pages whose touches are many on purpose: the keyboards and the lock, and the ones a finger taps again and again, the
        # thermostat's + and -, the blind's and the lamp's detail
        for k: ["keyboard", "keypad", "lock", "thermostat", "cover", "detail"]
            if pages.find(k) != nil && str(pages[k]) == str(page) return out end
        end
        var now = tasmota.millis()
        var n = size(self.taps)
        if n > 0 && now - self.taps[n - 1] < PanelAlarm.TAP_GAP_MS return out end
        self.taps.push(now)
        while size(self.taps) > 0 && now - self.taps[0] > PanelAlarm.TAP_WINDOW_MS  self.taps.remove(0) end
        if size(self.taps) >= PanelAlarm.TAPS
            self.taps = []
            return self.panic()
        end
        return out
    end

    # --- what a list wants -------------------------------------------------------------------------------

    # the events not seen, of the grades a list asks for, newest last
    def unseen(grades)
        var out = []
        for e: self.events
            if !self.seen.contains(e[0]) && grades.find(e[4]) != nil  out.push(e) end
        end
        return out
    end

    # The screensaver's two signs, [alarm, notice], each a colour or nil for hidden: the alarm's while an event of its own is not seen (a
    # trigger or a panic in red, a tamper or a bypass in orange), the house's while a notification is
    def signals()
        var alarm = nil
        var notice = nil
        for e: self.events
            if self.seen.contains(e[0]) || PanelAlarm.INFO.find(e[2]) != nil continue end
            if PanelAlarm.OF_ALARM.find(e[2]) != nil
                if e[2] == "trigger" || e[2] == "panic"
                    alarm = PanelAlarm.RED
                elif alarm == nil
                    alarm = PanelAlarm.ORANGE
                end
            elif e[4] == "house" || e[4] == "local" || e[4] == "alert"
                notice = PanelAlarm.YELLOW
            end
        end
        return [alarm, notice]
    end

    # the warnings the plan shows as dots: house and local events about a sensor, not seen
    def warnings()
        var n = 0
        for e: self.events
            if !self.seen.contains(e[0]) && (e[4] == "house" || e[4] == "local") && PanelAlarm.INFO.find(e[2]) == nil  n += 1 end
        end
        return n
    end
end
