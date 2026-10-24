# panel_alarm_view.be -- the alarm's screens on the glass: the Alarm screen and the Notifications
# screen, each a row at the end of Screens drawn on the plan's page as the calendar is (PanelAlarmDraw, PanelAlarmCanvas); the
# notice that takes the glass; the alarm's settings, which are views of the generic list; and the rows a device's options
# get: a sensor's Alarm, Entry, Notify, Sound and When, and any device's Panic burst, Siren and On panic.
#
# A provider of views for PanelUi (panel_ui.be, `providers`), as PanelScheduleView is: its views, its taps (the verb "alarm"),
# its keyboard (the target "alarm"). PanelUi holds it as `alarm` for the rows it adds to Screens and to a device's options.
# What it knows of the alarm is PanelAlarm's (panel_alarm.be); what it changes goes to the bridge as `["alarm", {...}]`
# effects, and is shown here at once, as the bridge will say it.
#
# Disarming asks for this panel's pattern every time: the lock first, which carries the disarm out when the
# right pattern is drawn. A panel with no pattern does not disarm, and its Alarm screen says so. Setting the alarm up asks for it
# too, as the Wi-Fi's Forget does (PanelUi.sensitive, and guards here for the Remove of a sensor or a siren): the pattern drawn a
# moment ago stands for the next words.
#
# With the link to the bridge down the Alarm screen says No link in the state's place, and its buttons do nothing (PanelAlarm.linked).
#
# A notification touched opens on a page of its own, its words whole and where and when, with Delete; and the foot of the list deletes all of
# the tab on show, after a question. Both pages are the dialog's.

#@ solidify:PanelAlarmView
class PanelAlarmView
    static VIEWS = ["alarm", "notifs", "alarmSettings", "alarmChoice", "alarmWhen", "alarmArm", "alarmEvent", "alarmClear"]
    # what Delete all says it takes, by the tab
    static CLEARS = ["Every notification not seen yet", "Every notification of the last day", "Every notification"]
    # what the Alarm screen lists: the alarm's own events; the rest are the Notifications'
    static ALARM_TYPES = ["arm", "disarm", "trigger", "panic", "bypass", "siren_off", "tamper", "config", "unreach"]
    static TITLES = {"trigger": "ALARM", "panic": "PANIC", "water": "WATER", "smoke": "SMOKE", "co": "CO ALARM"}
    static SOUNDS = [["off", "Off"], ["home", "Home"], ["always", "Always"]]
    static ROLES = [["off", "Off"], ["perimeter", "Perimeter"], ["interior", "Interior"], ["24h", "24 h"]]
    static GRADES = [["off", "Off"], ["local", "Local"], ["house", "House"], ["alert", "Alert"]]
    static MEASURES = [["Temperature", "Temperature"], ["Humidity", "Humidity"], ["BatteryPercentage", "Battery"]]
    static BURSTS = [[0, 3, "Off"], [6, 3, "6 in 3 s"], [8, 3, "8 in 3 s"], [10, 4, "10 in 4 s"]]
    static PANIC_ACTS = [["none", "None"], ["on", "Turn on"], ["off", "Turn off"], ["open", "Open"], ["close", "Close"]]
    # the devices the bridge lets the panic run (ZbBridgeRelay.PANIC_MAX)
    static PANIC_MAX = 32
    static DEFAULT = ["off", 0, "off", 0, "", "", 0, 4]

    var alarm      # PanelAlarm
    var ui         # PanelUi
    var tab        # the Notifications' filter: 0 Now, 1 Today, 2 All
    var canvases   # "alarm", "notifs", "notice" -> PanelAlarmCanvas
    var target     # the sensor whose When is open, for its keyboard
    var shown_key  # what the plan's stripe last drew, so a change is what redraws it

    def init(alarm, ui)
        self.alarm = alarm
        self.ui = ui
        self.tab = 0
        self.canvases = {}
        for m: ["alarm", "notifs", "notice"]  self.canvases[m] = PanelAlarmCanvas(self, m) end
        self.shown_key = ""
    end

    # --- the provider's contract -------------------------------------------------------------------------

    def shows(kind) return PanelAlarmView.VIEWS.find(kind) != nil end
    def hint(key) return nil end
    def acts(verb) return verb == "alarm" end
    def header(ui) return [] end
    def opened(ui, view) end

    # Whether what is asked on the glass is the Remove of a sensor or of a siren: it takes the device out of the alarm's reach, and is
    # asked through the pattern as the alarm's settings are (PanelUi.sensitive)
    def guards(action)
        if size(action) < 4 || action[0] != "open" || action[1] != "confirm" || action[2] != "removeDevice" return false end
        var d = self.ui.store.find_device(action[3])
        var l = self.alarm.cfg.find("s")
        return (d != nil && d[2] == "sensor") || (isinstance(l, list) && l.find(action[3]) != nil)
    end

    # the canvas of a view that is drawn on the plan's page, or nil
    def canvas(kind) return self.canvases.find(kind) end

    # whether a canvas on the plan is one of the alarm's
    def owns(cv)
        for m: self.canvases.keys()  if self.canvases[m] == cv return true end end
        return false
    end

    # the rows at the end of Screens that open the alarm's screens
    def screen_rows()
        var w = self.alarm.warnings()
        return [PanelUi.row(nil, "Alarm", self.alarm.state_word(), false, ["alarm", "open", "alarm"], nil),
                PanelUi.row(nil, "Notifications", w > 0 ? str(w) : "", false, ["alarm", "open", "notifs"], nil)]
    end

    # --- the canvases --------------------------------------------------------------------------------------

    def title_of(mode)
        if mode == "alarm" return "Alarm" end
        if mode == "notifs" return "Notifications" end
        var n = self.alarm.notice
        if n == nil || n["kind"] == "brief" return "Panic" end
        return PanelAlarmView.TITLES.find(n["e"][2], "ALERT")
    end

    def has_pattern() return size(self.ui.prefs["pattern"]) == 2 end

    # what the Alarm screen is made of now
    def state_data()
        var a = self.alarm
        var buttons = []
        var cause = a.cause_text()
        if a.st == "disarmed"
            buttons = [["Arm away", "arm"], ["Arm home", "arm"]]
            var w = a.warnings()
            cause = w > 0 ? str(w) + (w == 1 ? " warning" : " warnings") : ""
            # an alarm that would trigger in silence, said above the Arm buttons, which stay as they are: no siren on the
            # list the bridge says, and no beep of this panel either
            var sirens = a.cfg.find("s")
            if isinstance(sirens, list) && size(sirens) == 0
                var quiet = self.ui.prefs.find("alarmSounds", "off") == "off" ? "No siren, sounds off" : "No siren set"
                cause = cause == "" ? quiet : cause + ", " + quiet
            end
        else
            buttons = [["Disarm", self.has_pattern() ? "disarm" : "off"]]
            if !self.has_pattern()  cause = "Draw a pattern in Settings to disarm" end
            if cause == "" && a.mode != nil  cause = "Armed " + str(a.mode) end
        end
        var lines = []
        var i = size(a.events) - 1
        while i >= 0 && size(lines) < 12
            if PanelAlarmView.ALARM_TYPES.find(a.events[i][2]) != nil  lines.push(a.line_of(a.events[i])) end
            i -= 1
        end
        # with the bridge out of reach the state is not known: its place says No link, the buttons stand and do nothing
        var linked = a.linked()
        if !linked
            cause = "The bridge is out of reach"
            for b: buttons  b[1] = "off" end
        end
        return {"st": linked ? a.st : "nolink", "word": a.state_word(), "cause": cause, "buttons": buttons, "lines": lines}
    end

    # the rows of the tab on show, newest first: [words, grade, unseen, event id]
    def list_rows() return self.rows_of(self.tab) end

    # the rows of a tab, newest first
    def rows_of(tab)
        var a = self.alarm
        var out = []
        var now = tasmota.rtc()["utc"]
        var i = size(a.events) - 1
        while i >= 0
            var e = a.events[i]
            var unseen = !a.seen.contains(e[0])
            var keep = PanelAlarm.INFO.find(e[2]) == nil
            if keep && tab == 0  keep = unseen end
            if keep && tab == 1 && e[1] > 0 && now - e[1] > 86400  keep = false end
            if keep  out.push([a.line_of(e), e[4], unseen, e[0]]) end
            i -= 1
        end
        return out
    end

    def ops_of(mode, style)
        var a = self.alarm
        if mode == "alarm" return PanelAlarmDraw.state(style, self.state_data()) end
        if mode == "notifs"
            var rows = self.list_rows()
            var foot = PanelAlarmDraw.foot(style, self.tab == 0, size(rows) > 0)
            var room = PanelAlarmDraw.room(style, foot)
            var shown = []
            for i: 0 .. (size(rows) < room ? size(rows) : room) - 1  shown.push(rows[i]) end
            return PanelAlarmDraw.list(style, {"tab": self.tab, "rows": shown, "more": size(rows) - size(shown), "foot": foot})
        end
        return self.notice_ops(style)
    end

    def notice_ops(style)
        var a = self.alarm
        var n = a.notice
        var c = style["colors"]
        if n == nil return PanelAlarmDraw.notice(style, "", [], c["page"], "") end
        if n["kind"] == "brief"
            if n.find("fail") == true return PanelAlarmDraw.notice(style, "Panic not sent", ["Try again"], PanelAlarmDraw.RED, "") end
            var lines = []
            if n["e"] != nil  lines.push(a.name_of(n["e"][3])) end
            return PanelAlarmDraw.notice(style, "Panic activated", lines, c["pending"], "")
        end
        var e = n["e"]
        var who = e[3] == nil ? "" : str(e[3])
        var lines = [a.line_of(e)[6 ..]]
        var room = size(who) > 2 && who[0 .. 1] == "0x" ? a.room_of(who) : ""
        lines.push((room != "" ? room + "  " : "") + PanelAlarm.hhmm(e[1]))
        return PanelAlarmDraw.notice(style, PanelAlarmView.TITLES.find(e[2], "ALERT"), lines,
                                     e[4] == "alarm" ? PanelAlarmDraw.RED : PanelAlarmDraw.ORANGE, "Tap to dismiss")
    end

    # A touch on a canvas, x * 1000 + y
    def tap_of(mode, n, style)
        var a = self.alarm
        if mode == "notice" return a.dismiss() end
        var x = n / 1000
        var y = n % 1000
        if mode == "alarm"
            var d = self.state_data()
            var h = PanelAlarmDraw.state_hit(style, x, y, size(d["buttons"]))
            if h == nil return [] end
            if h[0] == "settings" return self.ui.act(["alarm", "settings"]) end
            var b = d["buttons"][h[1]]
            if b[1] == "arm" return self.ui.act(["alarm", "arm", b[0] == "Arm home" ? "home" : "away"]) end
            if b[1] == "disarm" return self.ui.act(["alarm", "disarm"]) end
            return []
        end
        var rows = self.list_rows()
        var foot = PanelAlarmDraw.foot(style, self.tab == 0, size(rows) > 0)
        var h = PanelAlarmDraw.list_hit(style, x, y, foot)
        if h == nil return [] end
        if h[0] == "tab"
            self.tab = h[1]
            return [["calendar", self.canvases["notifs"]]]
        end
        if h[0] == "ack" return a.ack(nil) end
        if h[0] == "del" return self.ui.open(["alarmClear", self.tab]) end
        if h[1] < size(rows) && h[1] < PanelAlarmDraw.room(style, foot) return self.open_event(rows[h[1]]) end
        return []
    end

    # a notification touched: its page, and seen, as the touch on it always made it
    def open_event(r)
        var out = self.ui.open(["alarmEvent", r[3]])
        if r[2]
            for e: self.alarm.ack(r[3]) out.push(e) end
        end
        return out
    end

    # on the Notifications screen a swipe goes to the next tab and the one before
    def swipe_of(mode, dir)
        if mode != "notifs" || (dir != "left" && dir != "right") return [] end
        self.tab = (self.tab + (dir == "left" ? 1 : 2)) % 3
        return [["calendar", self.canvases["notifs"]]]
    end

    # --- the plan's stripe and dots ------------------------------------------------------------------------

    # What the plan draws over its cards: a stripe along the top in the state's colour while the alarm is not disarmed, and a dot
    # for each warning not seen, up to five. A word to say what changed it since it was drawn, for the brain to draw again
    def overlay_key()
        return self.alarm.st + str(self.alarm.warnings() < 5 ? self.alarm.warnings() : 5)
    end

    def overlay(style)
        var a = self.alarm
        var o = style["origin"]
        var ops = []
        if a.st != "disarmed"
            ops.push(["fill", o[0], o[1], style["area"][0], 3, PanelAlarmDraw.state_color(a.st)])
        end
        var w = a.warnings()
        if w > 5  w = 5 end
        for i: 0 .. w - 1  ops.push(["cirs", o[0] + 6 + i * 10, o[1] + 6, 3, PanelAlarmDraw.ORANGE]) end
        self.shown_key = self.overlay_key()
        return ops
    end

    # whether the stripe on show is not what the alarm says now
    def stale() return self.shown_key != self.overlay_key() end

    # --- the views of the list -------------------------------------------------------------------------------

    static def dot_row(on, label, tap)
        return [on ? "dotOn" : "dotOff", "icon-off", label, "", false, on ? nil : tap, nil]
    end

    static def secs_text(s) return str(s) + " s" end

    def cfg_times()
        var t = self.alarm.cfg.find("t")
        return isinstance(t, list) && size(t) == 3 ? t : [30, 30, 300]
    end

    def cfg_panic()
        var p = self.alarm.cfg.find("p")
        return isinstance(p, list) && size(p) == 3 ? p : [1, 0, 0]
    end

    def cfg_burst()
        var b = self.alarm.cfg.find("b")
        return isinstance(b, list) && size(b) == 2 ? b : [8, 3]
    end

    # A sensor's record, as the bridge keeps it, or the default for one it has none of
    def record(id)
        var r = self.alarm.cfg["sensors"].find(id)
        return r != nil ? r : PanelAlarmView.DEFAULT
    end

    def word(pairs, key)
        for p: pairs if p[0] == key return p[1] end end
        return str(key)
    end

    def burst_word()
        var b = self.cfg_burst()
        for p: PanelAlarmView.BURSTS if p[0] == b[0] && p[1] == b[1] return p[2] end end
        return b[0] == 0 ? "Off" : str(b[0]) + " in " + str(b[1]) + " s"
    end

    def view(view, ed)
        var kind = view[0]
        if kind == "alarmArm"
            var names = self.alarm.unprotected_names(view[1])
            var line = ""
            for n: names
                var next = line == "" ? n : line + ", " + n
                if size(next) > 60  line += ", ..." break end
                line = next
            end
            return self.ui.dialog(PanelUi.plural(size(names), "device", "devices") + " lost", line + (line == "" ? "" : ". ") + "They do not protect this arm.", "Arm anyway", ["alarm", "armAnyway", view[1]])
        end
        if kind == "alarmEvent" || kind == "alarmClear" return self.notif_view(view) end
        if kind == "alarmSettings"
            var t = self.cfg_times()
            var p = self.cfg_panic()
            var pref = self.ui.prefs.find("alarmSounds", "off")
            return ["Alarm settings", "", [
                PanelUi.row(nil, "Exit time", PanelAlarmView.secs_text(t[0]), false, ["keyboard", "alarm", "exit"], nil),
                PanelUi.row(nil, "Entry time", PanelAlarmView.secs_text(t[1]), false, ["keyboard", "alarm", "entry"], nil),
                PanelUi.row(nil, "Siren time", PanelAlarmView.secs_text(t[2]), false, ["keyboard", "alarm", "siren"], nil),
                PanelUi.row(nil, "Alarm sounds", self.word(PanelAlarmView.SOUNDS, pref), false, ["alarm", "sounds"], nil),
                PanelUi.row(nil, "Panic burst", self.burst_word(), false, ["open", "alarmChoice", "burst", ""], nil),
                PanelUi.row(nil, "Panic: Send to HA", PanelUi.on_off(p[0] == 1), false, ["alarm", "panic", "ha"], nil),
                PanelUi.row(nil, "Panic: Notify all panels", PanelUi.on_off(p[1] == 1), false, ["alarm", "panic", "panels"], nil),
                PanelUi.row(nil, "Panic: Trigger the alarm", PanelUi.on_off(p[2] == 1), false, ["alarm", "panic", "alarm"], nil)]]
        end
        if kind == "alarmWhen"
            var r = self.record(view[1])
            return ["When", "", [
                PanelUi.row(nil, "Measure", r[4] != "" ? self.word(PanelAlarmView.MEASURES, r[4]) : "None", false, ["alarm", "measure", view[1]], nil),
                PanelUi.row(nil, "Rule", r[5] == "below" ? "Below" : "Above", false, ["alarm", "way", view[1]], nil),
                PanelUi.row(nil, "Limit", str(r[6]), false, ["keyboard", "alarm", "limit"], nil)]]
        end
        # a choice: the sort of it, and the device it is of
        var rows = []
        var sort = view[1]
        var id = size(view) > 2 ? view[2] : ""
        if sort == "role"
            var cur = self.record(id)[0]
            for p: PanelAlarmView.ROLES  rows.push(PanelAlarmView.dot_row(p[0] == cur, p[1], ["alarm", "pick", "role", id, p[0]])) end
            return ["Alarm", "", rows]
        end
        if sort == "notify"
            var cur = self.record(id)[2]
            for p: PanelAlarmView.GRADES  rows.push(PanelAlarmView.dot_row(p[0] == cur, p[1], ["alarm", "pick", "notify", id, p[0]])) end
            return ["Notify", "", rows]
        end
        if sort == "burst"
            var b = self.cfg_burst()
            for p: PanelAlarmView.BURSTS  rows.push(PanelAlarmView.dot_row(p[0] == b[0] && p[1] == b[1], p[2], ["alarm", "burst", p[0], p[1]])) end
            return ["Panic burst", "", rows]
        end
        var cur = self.panic_act(id)
        for p: PanelAlarmView.PANIC_ACTS  rows.push(PanelAlarmView.dot_row(p[0] == cur, p[1], ["alarm", "pick", "pact", id, p[0]])) end
        return ["On panic", "", rows]
    end

    # A notification's page, its words whole and Delete; or the question of Delete all, for the tab it was asked on
    def notif_view(view)
        var back = PanelUi.row(nil, "Back", "", false, ["back"], nil)
        if view[0] == "alarmEvent"
            var e = self.alarm.event_of(view[1])
            if e == nil return self.ui.notice("Notification", "It was deleted.", [back]) end
            return self.ui.notice("Notification", self.alarm.full_of(e), [PanelUi.row(nil, "Delete", "", 2, ["alarm", "del", view[1]], nil), back])
        end
        var n = size(self.rows_of(view[1]))
        return self.ui.dialog("Delete " + PanelUi.plural(n, "notification", "notifications") + "?",
                              PanelAlarmView.CLEARS[view[1]] + " leaves this panel and the others of its bridge.", "Delete", ["alarm", "delAll", view[1]])
    end

    # what a device does when the panic runs, as the bridge says, or "none"
    def panic_act(id)
        var l = self.alarm.cfg.find("pd")
        if isinstance(l, list)
            for pair: l if isinstance(pair, list) && size(pair) == 2 && pair[0] == id return pair[1] end end
        end
        return "none"
    end

    # --- the rows of a device's options -----------------------------------------------------------------

    def device_rows(id, ed)
        var out = []
        if !ed || PanelStore.is_relay_id(id) return out end
        var d = self.ui.store.find_device(id)
        if d == nil return out end
        var kind = d[2]
        var r = self.record(id)
        if kind == "sensor"
            out.push(PanelUi.row(nil, "Alarm", self.word(PanelAlarmView.ROLES, r[0]), false, ["open", "alarmChoice", "role", id], nil))
            if r[0] == "perimeter"  out.push(PanelUi.row(nil, "Entry door", PanelUi.on_off(r[1] == 1), false, ["alarm", "entry", id], nil)) end
            out.push(PanelUi.row(nil, "Notify", self.word(PanelAlarmView.GRADES, r[2]), false, ["open", "alarmChoice", "notify", id], nil))
            out.push(PanelUi.row(nil, "Sound", PanelUi.on_off(r[3] == 1), false, ["alarm", "sound", id], nil))
            if !self.alarm.zoned.contains(id)
                var when = r[4] != "" ? self.word(PanelAlarmView.MEASURES, r[4]) + (r[5] == "below" ? " < " : " > ") + str(r[6]) : "Off"
                out.push(PanelUi.row(nil, "When", when, false, ["alarm", "when", id], nil))
            end
        elif kind != "remote" && kind != "unsupported"
            var sirens = self.alarm.cfg.find("s")
            var on = isinstance(sirens, list) && sirens.find(id) != nil
            out.push(PanelUi.row(nil, "Siren", PanelUi.on_off(on), false, ["alarm", "siren", id], nil))
            # what a device does on the panic is kept by the bridge by IEEE address, and a word for a channel after the first
            # ("0x...1/2") it refuses: the row is the device's, and not the channel's, so that the copy here cannot hold a choice
            # the bridge never took
            if PanelStore.ieee_part(id) == id
                out.push(PanelUi.row(nil, "On panic", self.word(PanelAlarmView.PANIC_ACTS, self.panic_act(id)), false, ["open", "alarmChoice", "pact", id], nil))
            end
        end
        if kind != "unsupported"
            var np = self.alarm.cfg.find("np")
            var quiet = isinstance(np, list) && np.find(id) != nil
            out.push(PanelUi.row(nil, "Panic burst", PanelUi.on_off(!quiet), false, ["alarm", "burstdev", id], nil))
        end
        return out
    end

    # --- what a touch does ------------------------------------------------------------------------------------

    # a record written here at once, as the bridge will say it: field i of the sensor's
    def put(id, i, v)
        var r = self.alarm.cfg["sensors"].find(id)
        if r == nil  r = PanelAlarmView.DEFAULT.copy() else r = r.copy() end
        r[i] = v
        self.alarm.cfg["sensors"][id] = r
    end

    def send(m) return [["alarm", m]] end

    def act(ui, a)
        var verb = a[1]
        var al = self.alarm
        if verb == "open"
            var out = ui.open([a[2]])
            for e: self.asks(a[2] == "alarm" || a[2] == "notifs" ? "log" : "config") out.push(e) end
            return out
        end
        if verb == "arm"
            # an arm that would leave devices unprotected asks first, once, with a simple confirmation and no pattern
            if al.unprotected(a[2]) > 0 return ui.open(["alarmArm", a[2]]) end
            var out = al.arm(a[2])
            for e: ui.show() out.push(e) end
            return out
        end
        if verb == "armAnyway"
            var out = al.arm(a[2])
            for e: ui.back() out.push(e) end
            return out
        end
        if verb == "disarm"
            if !self.has_pattern() return [] end
            return ui.open(["lock", "enter", ["alarm", "doDisarm"]])
        end
        if verb == "doDisarm"
            var out = al.disarm()
            for e: ui.show() out.push(e) end
            return out
        end
        if verb == "settings"
            var out = ui.open(["alarmSettings"])
            for e: self.asks("config") out.push(e) end
            return out
        end
        if verb == "sounds"
            var cur = ui.prefs.find("alarmSounds", "off")
            var next = "off"
            for i: 0 .. size(PanelAlarmView.SOUNDS) - 1
                if PanelAlarmView.SOUNDS[i][0] == cur  next = PanelAlarmView.SOUNDS[(i + 1) % size(PanelAlarmView.SOUNDS)][0] end
            end
            ui.prefs["alarmSounds"] = next
            var out = [["prefs"]]
            for e: ui.show() out.push(e) end
            return out
        end
        if verb == "panic"
            var p = self.cfg_panic()
            var i = a[2] == "ha" ? 0 : (a[2] == "panels" ? 1 : 2)
            var on = p[i] != 1
            al.cfg["p"] = [p[0], p[1], p[2]]
            al.cfg["p"][i] = on ? 1 : 0
            var out = self.send({"do": "panic_cfg", a[2]: on})
            for e: ui.show() out.push(e) end
            return out
        end
        if verb == "burst"
            al.cfg["b"] = [a[2], a[3]]
            var out = self.send({"do": "panic_cfg", "burst": [a[2], a[3]]})
            for e: ui.back() out.push(e) end
            return out
        end
        if verb == "ack"
            return a[2] == nil ? al.ack(nil) : al.ack(a[2])
        end
        # a notification deleted from its page, or all of a tab, and back to the list
        if verb == "del" || verb == "delAll"
            var ids = []
            if verb == "del"
                ids.push(a[2])
            else
                for r: self.rows_of(a[2])  ids.push(r[3]) end
            end
            var out = al.drop(ids)
            for e: ui.back() out.push(e) end
            return out
        end
        return self.act_device(ui, a)
    end

    # the touches of a device's rows and their choices
    def act_device(ui, a)
        var verb = a[1]
        var id = a[2]
        var al = self.alarm
        var out = []
        if verb == "entry"
            var on = self.record(id)[1] != 1
            self.put(id, 1, on ? 1 : 0)
            out = self.send({"do": "sensor", "id": id, "entry": on})
        elif verb == "sound"
            var on = self.record(id)[3] != 1
            self.put(id, 3, on ? 1 : 0)
            out = self.send({"do": "sensor", "id": id, "sound": on})
        elif verb == "when"
            self.target = id
            return ui.open(["alarmWhen", id])
        elif verb == "measure"
            var cur = self.record(id)[4]
            var next = PanelAlarmView.MEASURES[0][0]
            for i: 0 .. size(PanelAlarmView.MEASURES) - 1
                if PanelAlarmView.MEASURES[i][0] == cur  next = PanelAlarmView.MEASURES[(i + 1) % size(PanelAlarmView.MEASURES)][0] end
            end
            self.put(id, 4, next)
            if self.record(id)[5] == ""  self.put(id, 5, "above") end
            out = self.send({"do": "sensor", "id": id, "key": next, "way": self.record(id)[5], "limit": self.record(id)[6]})
        elif verb == "way"
            var way = self.record(id)[5] == "below" ? "above" : "below"
            self.put(id, 5, way)
            if self.record(id)[4] != ""  out = self.send({"do": "sensor", "id": id, "key": self.record(id)[4], "way": way, "limit": self.record(id)[6]}) end
        elif verb == "siren"
            var l = al.cfg.find("s")
            var sirens = isinstance(l, list) ? l.copy() : []
            var at = sirens.find(id)
            var on = at == nil
            if on  sirens.push(id) else  sirens.remove(at) end
            al.cfg["s"] = sirens
            out = self.send({"do": "siren", "id": id, "on": on})
        elif verb == "burstdev"
            var l = al.cfg.find("np")
            var np = isinstance(l, list) ? l.copy() : []
            var at = np.find(id)
            var on = at != nil
            if on  np.remove(at) else  np.push(id) end
            al.cfg["np"] = np
            out = self.send({"do": "burst", "id": id, "on": on})
        elif verb == "pick"
            out = self.pick(a)
            for e: ui.back() out.push(e) end
            return out
        else
            return []
        end
        for e: ui.show() out.push(e) end
        return out
    end

    # a choice made: ["alarm", "pick", sort, id, value]
    def pick(a)
        var sort = a[2]
        var id = a[3]
        var v = a[4]
        if sort == "role"
            self.put(id, 0, v)
            return self.send({"do": "sensor", "id": id, "role": v})
        end
        if sort == "notify"
            self.put(id, 2, v)
            return self.send({"do": "sensor", "id": id, "notify": v})
        end
        # what a device does when the panic runs: the list the bridge keeps, with this device's act changed here at once, and said as
        # the one word of that device, panic_act, where the whole list passed a frame with seven. The bridge keeps
        # PANIC_MAX of them: a device that is not in the list of that many is not put in it
        var l = self.alarm.cfg.find("pd")
        var devs = []
        if isinstance(l, list)
            for pair: l if isinstance(pair, list) && size(pair) == 2 && pair[0] != id  devs.push(pair) end end
        end
        if v != "none"
            if size(devs) >= PanelAlarmView.PANIC_MAX return [] end
            devs.push([id, v])
        end
        self.alarm.cfg["pd"] = devs
        return self.send({"do": "panic_act", "id": id, "act": v})
    end

    # what is asked of the bridge to fill a screen: its log, or its settings
    def asks(what)
        if what == "log" return [["alarm", {"do": "log", "n": 20}]] end
        return [["alarm", {"do": "config"}]]
    end

    # --- the keyboard ---------------------------------------------------------------------------------------

    def keyboard(field)
        if field == "limit" return [str(self.record(self.target)[6]), 6] end
        return ["", 3]
    end

    def commit(ui, field, text)
        var v = nil
        if size(text) > 0
            import string
            var neg = text[0] == "-"
            var digits = neg ? text[1 ..] : text
            var ok = size(digits) > 0
            for i: 0 .. size(digits) - 1  if string.byte(digits[i]) < 48 || string.byte(digits[i]) > 57  ok = false end end
            if ok  v = (neg ? -1 : 1) * int(digits) end
        end
        if v == nil return ui.show() end
        var out = []
        if field == "limit"
            var id = self.target
            self.put(id, 6, v)
            if self.record(id)[4] != ""  out = self.send({"do": "sensor", "id": id, "key": self.record(id)[4], "way": self.record(id)[5], "limit": v}) end
            for e: ui.show() out.push(e) end
            return out
        end
        if v < 0 || v > 900 return ui.show() end
        var t = self.cfg_times()
        var keys = ["exit", "entry", "siren"]
        var times = [t[0], t[1], t[2]]
        for i: 0 .. 2  if keys[i] == field  times[i] = v end end
        self.alarm.cfg["t"] = times
        out = self.send({"do": "times", field: v})
        for e: ui.show() out.push(e) end
        return out
    end
end
