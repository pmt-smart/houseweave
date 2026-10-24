# panel_schedule_view.be -- the schedule's screens on the glass: a device's events, one event and the
# choices it is made of, and the device's own page "for the event", where the During is set. They are views of the
# generic list, with no byte of .tft, and open only with Editing on, as a device's options do.
#
# A provider of views for PanelUi (panel_ui.be, `providers`), as PanelClock is: its views, its taps (the verb
# "schedule"), its keyboard (the target "schedule") and the header's + and check. It comes after PanelSchedule, whose
# operations save what it edits, and after PanelUi, whose rows and sliders' measures it takes. PanelUi holds it as
# `schedule` for what a provider's hooks do not reach: the schedule's clock in the header of a lamp's detail and of a
# thermostat's page, alone or of a zone's group, whose tap switches the schedule and whose hold opens it,
# and those pages "for the event", the views of theirs that end in "during".
#
# The event being edited is a draft here: a new one exists only once the header's check saves it, and leaving without
# the check leaves the event as it was.
#
# And the house's calendar, from the Calendar row at the end of Screens: a view drawn on the plan's page,
# as the zone's colour picker is (PanelCalendarDraw), whose canvas this is to PanelPlanView: its title, its drawing,
# its touches and its swipes. A day touched is chosen, an event touched opens, a swipe changes the month, and the +
# asks who a new event on the day chosen is for.

#@ solidify:PanelScheduleView
class PanelScheduleView
    static VIEWS = ["schedule", "event", "eventFor", "eventRepeat", "eventDays", "eventTime", "eventSun", "eventDelete", "eventRefused",
                    "eventAction", "calendar", "calendarFor", "calendarForZone"]
    static MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
                     "November", "December"]
    # the Repeat a glass event can have: never, every day, weekdays, weekends, and the days chosen
    static REPEATS = ["Never", "Every day", "Weekdays", "Weekends", "Custom"]
    static RULES = [nil, [1, 1, 0, 0], [2, 1, 31, 0], [2, 1, 96, 0]]
    static DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    # a hue's name, the nearest by the colour wheel's degrees: the slider's 0 to 100 is the wheel's 0 to 360
    static HUES = [[0, "Red"], [30, "Orange"], [60, "Yellow"], [120, "Green"], [180, "Cyan"], [240, "Blue"], [275, "Purple"], [320, "Pink"]]

    var sched      # the PanelSchedule
    var draft      # the event being edited, or nil
    var side       # which of its actions the screens set: 7 the start's, 8 the end's
    var dev        # the device whose schedule is open, or the first of the group's
    var target     # what the open schedule is of: a device's id, or a zone's group, [zone, kind, relay]
    var refused    # the last save's refusal, for its dialog
    var month      # the calendar's month on show, [year, month]
    var chosen     # and its day chosen, in days since 1970

    def init(sched)
        self.sched = sched
        self.side = 7
    end

    # --- the words -------------------------------------------------------------------------------------------------

    # a time as the screens say it: "06:00", "Sunset", "-30 Sunset", "+15 Sunrise"
    static def time_text(t)
        if t < 1440 return PanelClock.hhmm(t) end
        var rise = t < PanelSchedule.SUNSET - 1000
        var m = t - (rise ? PanelSchedule.SUNRISE : PanelSchedule.SUNSET)
        var word = rise ? "Sunrise" : "Sunset"
        if m == 0 return word end
        return (m > 0 ? "+" : "") + str(m) + " " + word
    end

    # from and to: "06:00-08:00", or with the sun "Sunset to 23:00"; with no end, the start alone
    static def span_text(e)
        if e[4] == nil return PanelScheduleView.time_text(e[3]) end
        if e[3] < 1440 && e[4] < 1440 return PanelClock.hhmm(e[3]) + "-" + PanelClock.hhmm(e[4]) end
        return PanelScheduleView.time_text(e[3]) + " to " + PanelScheduleView.time_text(e[4])
    end

    # the days of an event, as its row in the list says them: its day, or what repeats
    static def days_text(e)
        var r = e[5]
        if r == nil return PanelClock.day_text(e[2], false) end
        var n = r[1]
        if r[0] == 1 return n == 1 ? "Daily" : "Every " + str(n) + " days" end
        if r[0] == 3 return n == 1 ? "Monthly" : "Every " + str(n) + " mo" end
        if r[0] == 4 return n == 1 ? "Yearly" : "Every " + str(n) + " yr" end
        if n != 1 return "Every " + str(n) + " wk" end
        if r[2] == 127 return "Daily" end
        if r[2] == 31 return "Mon-Fri" end
        if r[2] == 96 return "Sat-Sun" end
        var names = []
        for i: 0 .. 6
            if r[2] & (1 << i)  names.push(PanelClock.DAYS[i]) end
        end
        return size(names) <= 2 ? names.concat(",") : str(size(names)) + " days"
    end

    # which of REPEATS a rule is, or nil for one only Home Assistant makes: every other, monthly, yearly, to an end
    static def repeat_of(r)
        if r == nil return 0 end
        if r[1] != 1 || r[3] != 0 return nil end
        if r[0] == 1 return 1 end
        if r[0] != 2 return nil end
        if r[2] == 31 return 2 end
        if r[2] == 96 return 3 end
        return 4
    end

    # a white's word: the slider's 0 is the coolest the lamps take, its 100 the warmest
    static def white_word(p)
        if p < 34 return "Cool" end
        if p > 66 return "Warm" end
        return "Neutral"
    end

    static def hue_word(p)
        var deg = p * 360 / 100
        var best = nil
        var gap = 999
        for h: PanelScheduleView.HUES
            var d = deg - h[0]
            if d < 0  d = -d end
            if 360 - d < d  d = 360 - d end
            if d < gap
                gap = d
                best = h[1]
            end
        end
        return best
    end

    # What an action of an event does, in its screen's words: "21.0°C", "60% Blue", "40% Warm", "On", "Off", and a
    # blind's "Open", "Closed", "Ventilation" or "70%"
    static def during_text(kind, w)
        if w == "off" return "Off" end
        if kind == "thermostat" return type(w) == "int" ? PanelThermostatView.degrees(w) + "°C" : "--" end
        if kind == "cover" return w == "vent" ? "Ventilation" : (w == 100 ? "Open" : (w == 0 ? "Closed" : str(w) + "%")) end
        if kind != "light" || w == nil return "On" end
        var parts = []
        if w[0] != nil  parts.push(str(w[0]) + "%") end
        if w[1] != nil  parts.push(PanelScheduleView.white_word(w[1])) end
        if w[2] != nil  parts.push(PanelScheduleView.hue_word(w[2])) end
        return size(parts) > 0 ? parts.concat(" ") : "On"
    end

    # --- the store's side --------------------------------------------------------------------------------------------

    def store() return self.sched.store end

    # what an event is for, its kind and its name: [kind, name]
    def subject(f)
        if isinstance(f, list)
            var z = self.store().find_zone(f[0])
            return [f[1], z != nil ? z["name"] : ""]
        end
        var d = self.store().find_device(f)
        return d != nil ? [d[2], d[1]] : [nil, ""]
    end

    def today()
        var c = self.sched.clock
        return c != nil ? c.today() : nil
    end

    # the events of an open schedule: a device's, its own and its zone's; a group's, the ones for the group itself
    def events_for(f)
        if !isinstance(f, list) return self.sched.events_of(f) end
        var out = []
        for e: self.sched.events()
            var g = e[1]
            if isinstance(g, list) && g[0] == f[0] && g[1] == f[1] && g[2] == f[2]  out.push(e) end
        end
        return out
    end

    # the zone's group a device is in, [zone, kind, relay], or nil out of a zone
    def group_of(id)
        var d = self.store().find_device(id)
        var z = self.store().zone_of(id)
        return d != nil && z != nil ? [z["id"], d[2], d[9]] : nil
    end

    # --- the provider ----------------------------------------------------------------------------------------------

    def shows(kind) return PanelScheduleView.VIEWS.find(kind) != nil end
    def hint(key) return nil end
    def acts(verb) return verb == "schedule" end

    static def dot(on, label, hint, tap)
        return [on ? "dotOn" : "dotOff", "icon-off", label, hint, false, on ? nil : tap, nil]
    end

    # [title, header action, rows] of a view, and the line of a dialog
    def view(view, ed)
        var kind = view[0]
        var e = self.draft
        if kind == "schedule"
            var rows = []
            var t = self.today()
            if t == nil
                rows.push(PanelUi.row(nil, "No clock yet", "", false, nil, nil))
                return ["Schedule", "", rows]
            end
            # on or off, while some of them have events: the touch that was the clock's
            var with = self.with_events(self.sched.devices_of(view[1]))
            if size(with) > 0  rows.push(PanelUi.row(nil, "Schedule", self.lit(with) ? "On" : "Off", false, ["schedule", "toggle"], nil)) end
            # in the order of the day
            var events = []
            for x: self.events_for(view[1])
                var m = self.sched.minute(x[3], t[0])
                events.push([m != nil ? m : x[3] % 1440, x])
            end
            var keys = []
            for x: events  keys.push(x[0] * 100 + size(keys)) end
            for k: PanelStore.sorted(keys)
                var x = events[k % 100][1]
                rows.push(PanelUi.row(nil, PanelScheduleView.span_text(x), PanelScheduleView.days_text(x), false, ed ? ["schedule", "edit", x[0]] : nil, nil))
            end
            if size(events) == 0  rows.push(PanelUi.row(nil, "No events", "", false, nil, nil)) end
            return ["Schedule", ed ? "add" : "", rows]
        end
        if kind == "calendarFor"
            # the zones that have a device the schedule turns on and off
            var rows = []
            for z: self.store().doc["zones"]
                var n = 0
                for id: z["members"].keys()
                    var d = self.store().find_device(id)
                    if d != nil && PanelSchedule.KINDS.find(d[2]) != nil  n += 1 end
                end
                if n > 0  rows.push(PanelUi.row(nil, z["name"], PanelUi.plural(n, "device", "devices"), false, ["open", "calendarForZone", z["id"]], nil)) end
            end
            return ["For", "", rows]
        end
        if kind == "calendarForZone"
            # its groups of two or more, as its joint pages, and then each device
            var z = self.store().find_zone(view[1])
            if z == nil return ["For", "", []] end
            import string
            var groups = []
            var singles = []
            var names = []
            for id: PanelStore.member_ids(z["members"])
                var d = self.store().find_device(id)
                if d != nil && PanelSchedule.KINDS.find(d[2]) != nil
                    names.push(d[1] + "\t" + str(size(singles)))
                    singles.push(PanelUi.row(nil, d[1], "", false, ["schedule", "pick", id], nil))
                    var f = [z["id"], d[2], d[9]]
                    if size(self.sched.devices_of(f)) > 1 && groups.find(f) == nil  groups.push(f) end
                end
            end
            var rows = []
            for f: groups
                rows.push(PanelUi.row(nil, "All " + PanelUi.kind_words(f[1])[1], "Zone", false, ["schedule", "pick", f], nil))
            end
            # the devices by their names
            for k: PanelStore.sorted(names)  rows.push(singles[int(string.split(k, "\t")[-1])]) end
            return [z["name"], "", rows]
        end
        if e == nil return ["Schedule", "", []] end
        var who = self.subject(e[1])
        if kind == "event"
            var rows = []
            var group = isinstance(self.target, list) ? nil : self.group_of(self.dev)
            rows.push(PanelUi.row(nil, "For", isinstance(e[1], list) ? "Zone" : "This one", false, group != nil ? ["open", "eventFor"] : nil, nil))
            var k = PanelScheduleView.repeat_of(e[5])
            rows.push(PanelUi.row(nil, "Repeat", k != nil ? PanelScheduleView.REPEATS[k] : "Custom (HA)", false, k != nil ? ["open", "eventRepeat"] : nil, nil))
            if e[5] == nil  rows.push(PanelUi.row(nil, "Day", PanelClock.day_text(e[2], false), false, ["keyboard", "schedule", "day"], nil)) end
            # its start and what it does then; its end, if it has one, and what it does from then on
            rows.push(PanelUi.row(nil, "Start", PanelScheduleView.time_text(e[3]), false, ["open", "eventTime", "from"], nil))
            rows.push(PanelUi.row(nil, "Action", PanelScheduleView.during_text(who[0], e[7]), false, ["schedule", "action", 7], nil))
            rows.push(PanelUi.row(nil, "End", e[4] != nil ? PanelScheduleView.time_text(e[4]) : "None", false, ["open", "eventTime", "to"], nil))
            if e[4] != nil  rows.push(PanelUi.row(nil, "At end", PanelScheduleView.during_text(who[0], PanelSchedule.end_of(e)), false, ["schedule", "action", 8], nil)) end
            if e[0] != nil  rows.push(PanelUi.row(nil, "Delete", "", 2, ["open", "eventDelete"], nil)) end
            return [e[0] != nil ? who[1] : "New event", "confirm", rows]
        end
        if kind == "eventAction"
            # what the devices do, for the kinds whose page has no Off: on, off, and a lamp's levels on its page
            var a = e[self.side]
            var rows = [PanelScheduleView.dot(a == nil, "On", "", ["schedule", "set", "on"]),
                        PanelScheduleView.dot(a == "off", "Off", "", ["schedule", "set", "off"])]
            if who[0] == "light" && self.levels(e[1])
                var lv = PanelScheduleView.dot(isinstance(a, list), "Levels", isinstance(a, list) ? PanelScheduleView.during_text("light", a) : "", ["schedule", "levels"])
                lv[5] = ["schedule", "levels"]
                rows.push(lv)
            end
            return [self.side == 8 ? "At end" : "Action", "", rows]
        end
        if kind == "eventFor"
            return ["For", "", [PanelScheduleView.dot(!isinstance(e[1], list), "This one", "", ["schedule", "for", 0]),
                                PanelScheduleView.dot(isinstance(e[1], list), "Zone", "", ["schedule", "for", 1])]]
        end
        if kind == "eventRepeat"
            var now = PanelScheduleView.repeat_of(e[5])
            var rows = []
            for i: 0 .. size(PanelScheduleView.REPEATS) - 1
                # Custom opens its days, chosen or not
                var tap = ["schedule", "repeat", i]
                var row = PanelScheduleView.dot(now == i, PanelScheduleView.REPEATS[i], "", tap)
                if i == 4  row[5] = tap end
                rows.push(row)
            end
            return ["Repeat", "", rows]
        end
        if kind == "eventDays"
            var rows = []
            var mask = e[5] != nil ? e[5][2] : 0
            for i: 0 .. 6
                var on = (mask & (1 << i)) != 0
                var row = PanelScheduleView.dot(on, PanelScheduleView.DAYS[i], "", ["schedule", "day", i])
                row[5] = ["schedule", "day", i]
                rows.push(row)
            end
            return ["Days", "", rows]
        end
        if kind == "eventTime"
            var field = view[1]
            var t = field == "from" ? e[3] : e[4]
            var c = self.sched.clock
            var place = c != nil && c.lat != nil && c.lon != nil
            var clock = t != nil && t < 1440
            var rise = t != nil && t >= 1440 && t < PanelSchedule.SUNSET - 1000
            var typed = ["keyboard", "schedule", field]
            var dawn = place ? ["open", "eventSun", field, PanelSchedule.SUNRISE] : nil
            var dusk = place ? ["open", "eventSun", field, PanelSchedule.SUNSET] : nil
            var rows = [PanelScheduleView.dot(clock, "Time", clock ? PanelClock.hhmm(t) : "", typed),
                        PanelScheduleView.dot(rise, "Sunrise", place ? "" : "No location", dawn),
                        PanelScheduleView.dot(t != nil && t >= PanelSchedule.SUNSET - 1000, "Sunset", place ? "" : "No location", dusk)]
            # the one marked is still the way to change it: the time's keyboard, the sun's minutes
            rows[0][5] = typed
            rows[1][5] = dawn
            rows[2][5] = dusk
            # an end is the event's to have or not
            if field == "to"  rows.insert(0, PanelScheduleView.dot(t == nil, "None", "", ["schedule", "noend"])) end
            return [field == "from" ? "Start" : "End", "", rows]
        end
        if kind == "eventSun"
            var now = view[1] == "from" ? e[3] : e[4]
            var rows = []
            var m = -PanelSchedule.SUN_SPAN
            while m <= PanelSchedule.SUN_SPAN
                var t = view[2] + m
                rows.push(PanelScheduleView.dot(t == now, PanelScheduleView.time_text(t), "", ["schedule", "sun", view[1], t]))
                m += 15
            end
            return [view[2] == PanelSchedule.SUNRISE ? "Sunrise" : "Sunset", "", rows]
        end
        if kind == "eventDelete"
            return ["Delete this event?", "", [PanelUi.row(nil, "Delete", "", 2, ["schedule", "delete"], nil),
                                               PanelUi.row(nil, "Cancel", "", false, ["back"], nil)],
                    "It goes from the panel and from Home Assistant."]
        end
        # a save refused: why, and back to the event
        return ["Not saved", "", [PanelUi.row(nil, "OK", "", false, ["back"], nil)], self.why()]
    end

    # whether a lamp, or a zone's lamps, have a level a During could set
    def levels(f)
        for id: self.sched.devices_of(f)
            var d = self.store().find_device(id)
            if d != nil && !PanelStore.is_relay_id(id) && (d[3] & (PanelStore.CAP_LEVEL | PanelStore.CAP_CT | PanelStore.CAP_COLOR)) != 0 return true end
        end
        return false
    end

    # the sentence of the last save's refusal
    def why() return self.message(self.refused) end

    # the sentence of a refusal, for the glass and for Home Assistant's screen
    def message(r)
        var code = r != nil ? r["refusal"] : nil
        if code == "overlap"
            var other = self.sched.find(r["detail"][0])
            var d = self.store().find_device(r["detail"][1])
            if other != nil && d != nil
                return d[1] + " already has an event on " + PanelScheduleView.days_text(other) + " " + PanelScheduleView.span_text(other) + "."
            end
        end
        if code == "same_time" return "From and To are the same time." end
        if code == "no_location" return "The sun needs the house's location, in Main settings." end
        if code == "too_many" return "The panel holds " + str(PanelSchedule.MAX) + " events at most." end
        if code == "no_occurrence" return "It happens on no day." end
        if code == "no_devices" return "The zone has none of its kind." end
        if code == "bad_during"
            var kind = r.find("detail")
            return "The title is not one the panel reads: try " + (kind == "thermostat" ? "21°C." : (kind == "light" ? "60% blue, warm or on." :
                   (kind == "cover" ? "open, closed, ventilation or 70%." : "on or off.")))
        end
        if code == "bad_rule" return "The repetition is not one the panel runs." end
        if code == "bad_time" || code == "bad_day" return "The time is not one the panel reads." end
        if code == "no_such_event" return "The event is not on the panel any more." end
        if code == "no_such_device" || code == "no_such_zone" return "The device is not on the panel any more." end
        if code == "no_schedule" return "The schedule does not turn this kind on and off." end
        return "It cannot be saved."
    end

    # where a view opens: the sun's offsets on the page of the one the event has, or of "at the sun"
    def opened(ui, view)
        if view[0] != "eventSun" || self.draft == nil return end
        var now = view[1] == "from" ? self.draft[3] : self.draft[4]
        var m = now != nil ? now - view[2] : 0
        if m < -PanelSchedule.SUN_SPAN || m > PanelSchedule.SUN_SPAN  m = 0 end
        ui.top()["page"] = ((m + PanelSchedule.SUN_SPAN) / 15) / ui.rows_for(view)
    end

    # The header's +, a new event, and its check, the event saved
    def header(ui)
        var top = ui.top()
        if top == nil || !ui.prefs["editing"] return [] end
        if top["view"][0] == "schedule"
            var t = self.today()
            if t == nil return [] end
            # today, at the next full hour, with no end, as a touch would leave the device
            var from = (t[1] / 60 + 1) * 60
            var day = t[0]
            if from >= 1440
                from -= 1440
                day += 1
            end
            var f = isinstance(self.target, list) ? self.target.copy() : self.dev
            self.draft = [nil, f, day, from, nil, nil, [], self.touch_during(self.dev), nil]
            return ui.open(["event"])
        end
        if top["view"][0] == "calendar" return self.today() != nil ? ui.open(["calendarFor"]) : [] end
        if top["view"][0] == "event" && self.draft != nil
            var r = self.sched.put(self.draft)
            if !r["ok"]
                self.refused = r
                return ui.open(["eventRefused"])
            end
            self.draft = nil
            return [["save"]] + ui.back()
        end
        return []
    end

    # how a touch leaves a device, as a new event's start: a thermostat heats to its target, a blind opens, and the rest
    # turn on
    def touch_during(id)
        var d = self.store().find_device(id)
        if d != nil && d[2] == "cover" return 100 end
        if d == nil || d[2] != "thermostat" return nil end
        var ui = self.sched.ui
        var t = ui != nil && ui.network != nil ? ui.network.thermostat : nil
        var v = t != nil ? t.get(id, "set", nil) : nil
        return v != nil ? v : 210
    end

    # a touch on a row of the schedule's screens
    def act(ui, a)
        var op = a[1]
        var e = self.draft
        if op == "open"
            # a device's schedule, or a group's
            var ids = self.sched.devices_of(a[2])
            self.target = a[2]
            self.dev = isinstance(a[2], list) ? (size(ids) > 0 ? ids[0] : nil) : a[2]
            return ui.open(["schedule", a[2]])
        end
        if op == "edit" return self.edit(ui, a[2]) end
        if op == "toggle" return self.target != nil ? self.toggle(ui, self.sched.devices_of(self.target)) : [] end
        if op == "calendar"
            var t = self.today()
            var ymd = PanelClock.date_of(t != nil ? t[0] : 0)
            self.month = [ymd[0], ymd[1]]
            self.chosen = t != nil ? t[0] : nil
            return ui.open(["calendar"])
        end
        if op == "pick"
            # a new event on the day chosen, for the device or the group picked; the questions go, and the event
            # is over the calendar
            var ids = self.sched.devices_of(a[2])
            var t = self.today()
            if size(ids) == 0 || self.chosen == nil || t == nil return [] end
            self.dev = ids[0]
            var from = (t[1] / 60 + 1) * 60 % 1440
            self.draft = [nil, isinstance(a[2], list) ? a[2].copy() : a[2], self.chosen, from, nil, nil, [], self.touch_during(ids[0]), nil]
            while ui.top() != nil && ui.top()["view"][0] != "calendar"  ui.stack.remove(size(ui.stack) - 1) end
            return ui.open(["event"])
        end
        if e == nil return [] end
        if op == "for"
            var g = self.group_of(self.dev)
            e[1] = a[2] == 1 && g != nil ? g : self.dev
            return ui.back()
        end
        if op == "repeat"
            var i = a[2]
            if i < 4
                var r = PanelScheduleView.RULES[i]
                e[5] = r != nil ? r.copy() : nil
                return ui.back()
            end
            # the days chosen: the event's own, or its day's
            var mask = e[5] != nil && e[5][0] == 2 ? e[5][2] : 1 << PanelClock.weekday(e[2])
            e[5] = [2, 1, mask, 0]
            ui.stack.remove(size(ui.stack) - 1)
            return ui.open(["eventDays"])
        end
        if op == "day"
            var bit = 1 << a[2]
            # never none
            if e[5] != nil && e[5][2] != bit  e[5][2] = e[5][2] ^ bit end
            return ui.show()
        end
        if op == "sun"
            if a[2] == "from"
                e[3] = a[3]
            else
                self.end_at(e, a[3])
            end
            ui.stack.remove(size(ui.stack) - 1)
            return ui.back()
        end
        if op == "noend"
            e[4] = nil
            e[8] = nil
            return ui.back()
        end
        if op == "action"
            # the start's or the end's: a thermostat's and a blind's on their page, which has their off; the rest a choice
            self.side = a[2]
            var kind = self.subject(e[1])[0]
            return kind == "thermostat" || kind == "cover" ? self.page(ui) : ui.open(["eventAction"])
        end
        if op == "set"
            e[self.side] = a[2] == "off" ? "off" : nil
            return ui.back()
        end
        if op == "levels"
            # a lamp's page in the choice's place, so its title goes back to the event
            ui.stack.remove(size(ui.stack) - 1)
            return self.page(ui)
        end
        if op == "delete"
            var r = self.sched.delete(e[0])
            self.draft = nil
            ui.stack.remove(size(ui.stack) - 1)
            return (r["ok"] ? [["save"]] : []) + ui.back()
        end
        return []
    end

    # the keyboard of a field: [what it opens with, how long it may be]. A day or a time opens empty: written, it would
    # fill the field, and the glass takes no key into a full one. What it is now is on the row that was tapped
    def keyboard(field)
        return ["", 5]
    end

    # OK on the keyboard: a day, the next one with that date that has not passed; a time, and back to the event. What
    # is not a date or a time is as if nothing was typed
    def commit(ui, field, text)
        var e = self.draft
        if e == nil return ui.show() end
        if field == "day"
            var d = PanelClock.parse_date(text)
            var t = self.today()
            if d == nil || t == nil return ui.show() end
            var y = d[2]
            if y == nil
                y = PanelClock.date_of(t[0])[0]
                if PanelClock.days_of(y, d[1], d[0]) < t[0]  y += 1 end
            end
            if d[0] > PanelClock.month_days(y, d[1]) return ui.show() end
            e[2] = PanelClock.days_of(y, d[1], d[0])
            return ui.show()
        end
        var m = PanelClock.parse_time(text)
        if m == nil return ui.show() end
        if field == "from"
            e[3] = m
        else
            self.end_at(e, m)
        end
        # from the Time of From or To: back on the event
        return ui.top() != nil && ui.top()["view"][0] == "eventTime" ? ui.back() : ui.show()
    end

    # An end set: an event that had none comes with the start's opposite from then on; one that had one keeps its
    # action
    def end_at(e, t)
        if e[4] == nil  e[8] = PanelSchedule.opposite(self.subject(e[1])[0], e[7], self.touch_during(self.dev)) end
        e[4] = t
    end

    # The device's page set for the event's action, the start's or the end's, as its group's or its own
    def page(ui)
        var e = self.draft
        var kind = self.subject(e[1])[0]
        var page = kind == "light" ? "detail" : kind
        if isinstance(e[1], list)
            return ui.open(page == "detail" ? [page, "t", e[1][0], e[1][1], e[1][2], "during"] : [page, "t", e[1][0], e[1][2], "during"])
        end
        return ui.open([page, "d", e[1], "during"])
    end

    # --- the Schedule of a device's page -------------------------------------------------------

    # the devices of these that have an event
    def with_events(ids)
        var out = []
        for id: ids
            if size(self.sched.events_of(id)) > 0  out.push(id) end
        end
        return out
    end

    # whether the schedule runs devices of this kind: a page shows its Schedule only then
    def takes(kind) return PanelSchedule.KINDS.find(kind) != nil end

    # The page's Schedule lit: while a device of the page, of `ids`, has an event and its schedule on
    def lit(ids)
        for id: self.with_events(ids)
            if !self.sched.is_off(id) return true end
        end
        return false
    end

    # Its touch: the schedule of the page's device, or of its zone's group. Its list opens with Editing off too,
    # only to be seen
    def open_for(ui, view)
        var f = nil
        if view[1] == "d"
            f = view[2]
        elif view[0] == "detail"
            f = [view[2], view[3], view[4]]
        else
            f = [view[2], view[0], view[3]]
        end
        return self.act(ui, ["schedule", "open", f])
    end

    # The first row of its list, while some of them have events: with any of them on, every one's schedule off; with
    # none on, every one's on. The mode is not touched
    def toggle(ui, ids)
        var with = self.with_events(ids)
        if size(with) == 0 return [] end
        var on = self.lit(with)
        for id: with  self.sched.set_off(id, on) end
        return [["save"]] + ui.show()
    end

    # --- the device's page for the event -----------------------------------------------------------------------------

    # the title of a page set for the event: which action, and when
    def during_title()
        var e = self.draft
        if e == nil return "" end
        return self.side == 8 ? "At end · " + PanelScheduleView.time_text(e[4]) : "Start · " + PanelScheduleView.time_text(e[3])
    end

    # A thermostat's page for the event: its target is the event's, the Heat it goes to lit, and the + and the - change
    # the event and not the device
    def render_thermostat(ui, view, t, members)
        var e = self.draft
        if e == nil return ui.back() end
        # off, the Off lit and the target the one a Heat would take
        var a = e[self.side]
        var heat = type(a) == "int"
        var drafts = {}
        var looks = []
        for d: members
            drafts[d[0]] = heat ? a : self.touch_during(self.dev)
            looks.push(heat ? "on" : "off")
        end
        var out = PanelThermostatView.page(t, self.store(), view, members, looks, drafts, ui.shape["thermostatLines"], ui.shape["thermostatModes"])
        out[0] = ["set", "$thermostat.name", self.during_title()]
        # for the event, the page's row is not there
        for x: PanelPageButtons.none("$thermostat")  out.push(x) end
        return out
    end

    def step(ui, dir, t, members)
        var e = self.draft
        if e == nil || dir == 0 return [] end
        var r = PanelThermostatView.span(t, members)
        var now = type(e[self.side]) == "int" ? e[self.side] : self.touch_during(self.dev)
        var base = dir > 0 ? (now / r[2]) * r[2] : ((now + r[2] - 1) / r[2]) * r[2]
        var next = base + dir * r[2]
        if next < r[0]  next = r[0] end
        if next > r[1]  next = r[1] end
        e[self.side] = next
        var drafts = {}
        for d: members  drafts[d[0]] = next end
        return PanelThermostatView.target_effects(t, members, drafts)
    end

    # A lamp's detail for the event: its sliders at the event's levels, the ones it does not set where the lamps are
    def render_detail(ui, view, members)
        var e = self.draft
        if e == nil return ui.back() end
        var out = ui.render_detail(view[0 .. size(view) - 2])
        out[0] = ["set", "$light.name", self.during_title()]
        for x: PanelPageButtons.none("$light")  out.push(x) end
        var w = e[self.side]
        var keys = ["$light.brightnessPct", "$light.colorTempPct", "$light.huePct"]
        for i: 0 .. 2
            if isinstance(w, list) && w[i] != nil  out[4 + i] = ["set", keys[i], w[i]] end
        end
        return out
    end

    # A thermostat's mode on its page for the event: Off, or Heat at the target it shows
    def mode(ui, k)
        var e = self.draft
        if e == nil return [] end
        var a = e[self.side]
        e[self.side] = k == 0 ? "off" : (type(a) == "int" ? a : self.touch_during(self.dev))
        return ui.show()
    end

    # A blind's page for the event: the action's position on the slider and in words, its ventilation lit
    # when it is that, and no row under its title
    def render_cover(ui, view, members)
        var e = self.draft
        if e == nil return ui.back() end
        var a = e[self.side]
        var vent = PanelCoverView.ventilation(members)
        var tone = PanelCoverView.TONE
        var out = [["set", "$cover.name", self.during_title()], ["set", "$cover.position", PanelScheduleView.during_text("cover", a)],
                   ["set", "$cover.state", ""], ["set", "$cover.up.icon", "coverUp"], ["set", "$cover.stop.icon", "coverStop"],
                   ["set", "$cover.down.icon", "coverDown"], ["set", "$cover.up.iconColor", tone], ["set", "$cover.stop.iconColor", tone],
                   ["set", "$cover.down.iconColor", tone], ["set", "$cover.vent.label", "Ventilation " + str(vent) + "%"],
                   ["set", "$cover.vent.on", a == "vent" ? 1 : 0],
                   ["set", "$cover.page", PanelCoverView.place(a == "vent" ? vent : (type(a) == "int" ? a : 0))]]
        for x: PanelPageButtons.none("$cover")  out.push(x) end
        return out
    end

    # A key, the slider or the ventilation on the blind's page for the event: the action set to it, all the way up or down,
    # the place or the ventilation, and the page again. The stop key sets nothing
    def cover_set(ui, a)
        var e = self.draft
        if e == nil || a == nil return [] end
        e[self.side] = a
        return ui.show()
    end

    # an event opened: a draft of it, for the device of it the screens are of
    def edit(ui, uid)
        var x = self.sched.find(uid)
        if x == nil return [] end
        var ids = self.sched.devices_of(x[1])
        if size(ids) > 0 && ids.find(self.dev) == nil  self.dev = ids[0] end
        self.draft = PanelSchedule.normal(x)
        self.draft[0] = x[0]
        return ui.open(["event"])
    end

    # --- the house's calendar ------------------------------------------------------------------------------------

    # the row at the end of Screens that opens it
    def calendar_row()
        return PanelUi.row(nil, "Calendar", "", false, ["schedule", "calendar"], nil)
    end

    # the kind of each event, by its uid, once for a drawing
    def kinds()
        var out = {}
        for e: self.sched.events()  out[e[0]] = self.subject(e[1])[0] end
        return out
    end

    # A day's occurrences, [start minute, uid, words], in the order of the day: a zone's are its name and its kind
    def day_entries(day)
        var found = []
        var keys = []
        for e: self.sched.events()
            if PanelSchedule.occurs(e, day)
                var s = self.sched.span(e, day)
                var who = self.subject(e[1])
                var name = isinstance(e[1], list) ? who[1] + " " + PanelUi.kind_words(e[1][1])[1] : who[1]
                var start = s != nil ? s[0] : e[3] % 1440
                keys.push(start * 100 + size(found))
                found.push([start, e[0], (s != nil ? PanelClock.hhmm(start) : PanelScheduleView.time_text(e[3])) + " " + name])
            end
        end
        var out = []
        for k: PanelStore.sorted(keys)  out.push(found[k % 100]) end
        return out
    end

    # the header's words: the month on show
    def title()
        if self.month == nil || self.today() == nil return "Calendar" end
        return PanelScheduleView.MONTHS[self.month[1] - 1] + " " + str(self.month[0])
    end

    # the header's action: the + of a new event, with a clock and Editing on
    def action()
        var ui = self.sched.ui
        return self.today() != nil && ui != nil && ui.prefs["editing"] ? "add" : ""
    end

    # what the canvas draws
    def ops(style)
        var t = self.today()
        if t == nil || self.month == nil return PanelCalendarDraw.message(style, "No clock yet") end
        var y = self.month[0]
        var m = self.month[1]
        var kinds = self.kinds()
        var dots = {}
        var first = PanelClock.days_of(y, m, 1)
        for d: 1 .. PanelClock.month_days(y, m)
            var seen = []
            for e: self.sched.events()
                if PanelSchedule.occurs(e, first + d - 1) && seen.find(kinds[e[0]]) == nil  seen.push(kinds[e[0]]) end
            end
            if size(seen) > 0  dots[d] = seen end
        end
        var lines = []
        if self.chosen == nil  self.chosen = t[0] end
        for x: self.day_entries(self.chosen)  lines.push(x[2]) end
        return PanelCalendarDraw.month(style, y, m, self.chosen, t[0], dots, PanelClock.day_text(self.chosen, false), lines)
    end

    # A touch on the canvas, x * 1000 + y: a day is chosen, and an event of the day chosen opens, with Editing on
    def tap(n, style)
        var ui = self.sched.ui
        if self.month == nil || self.today() == nil || ui == nil return [] end
        var h = PanelCalendarDraw.hit(style, n / 1000, n % 1000, self.month[0], self.month[1])
        if h == nil return [] end
        if h[0] == "day"
            self.chosen = h[1]
            return [["calendar", self]]
        end
        var entries = self.day_entries(self.chosen)
        var fit = PanelCalendarDraw.lines_fit(style)
        var shown = size(entries) > fit ? fit - 1 : size(entries)
        if h[1] >= shown || !ui.prefs["editing"] return [] end
        return self.edit(ui, entries[h[1]][1])
    end

    # a swipe to the left is the next month, to the right the one before; its day chosen is today, or its first
    def swipe(dir)
        var t = self.today()
        if self.month == nil || t == nil || (dir != "left" && dir != "right") return [] end
        var y = self.month[0]
        var m = self.month[1] + (dir == "left" ? 1 : -1)
        if m > 12
            m = 1
            y += 1
        end
        if m < 1
            m = 12
            y -= 1
        end
        self.month = [y, m]
        var ymd = PanelClock.date_of(t[0])
        self.chosen = ymd[0] == y && ymd[1] == m ? t[0] : PanelClock.days_of(y, m, 1)
        return [["calendar", self]]
    end

    # a slider of the detail for the event: the event takes the level; the white or the colour, the one moved last
    def level(dim, pct)
        var e = self.draft
        if e == nil return [] end
        var w = isinstance(e[self.side], list) ? e[self.side].copy() : [nil, nil, nil]
        var i = dim == "bri" ? 0 : (dim == "ct" ? 1 : 2)
        var p = int(pct + 0.5)
        if p < 0  p = 0 end
        if p > 100  p = 100 end
        if i == 0 && p == 0  p = 1 end
        w[i] = p
        if i == 1  w[2] = nil end
        if i == 2  w[1] = nil end
        e[self.side] = w
        return []
    end
end
