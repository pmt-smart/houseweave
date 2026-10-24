# panel_schedule.be -- the house's schedule, with its start and end: events that put a device,
# or a zone's devices of one kind on one relay, as their own screen would at a moment, and, when the event has an end,
# as it says from then on. The panel keeps and checks them, whoever
# made them: the glass, or Home Assistant over MQTT. This holds the model, the rules, the operations and the engine that
# runs them, every second from the brain (tick), by the commands the screens send. It comes after PanelUi, whose sliders'
# measures it takes.
#
# An event is a positional list in the store's document (doc["events"]), as a device is, because a list costs the heap
# less than a map:
#
#   [uid, for, day, from, to, rule, skip, start, end]
#
#   uid     its name, which never changes: "e" and the document's seq
#   for     a device id, or [zone id, kind, relay]: the zone's devices of that kind its relay powers, as its joint page
#   day     the day of an event that does not repeat, and the first of one that does, in days since 1970-01-01, local.
#           It is always an occurrence: a weekly event that would start on a day it does not take starts on the next one
#   from    when an occurrence starts and ends: a minute of the day, 0 to 1439, or the sun with an offset, SUNRISE + m or
#   to      SUNSET + m, m from -120 to 120 in steps of 15. A `to` at or before `from` is the next day's. A `to` of nil is
#           an event with no end, an instant: it acts at its start and no more
#   rule    nil for an event that does not repeat, or [freq, interval, days, until]: freq 1 daily, 2 weekly, 3 monthly on
#           the first day's day of the month, 4 yearly on its date; every `interval` of them; the weekdays of a weekly
#           one, a bit each from Monday's 1; and the last day it may start on, 0 for none. It is the piece of iCalendar's
#           RRULE the panel runs (rrule, parse_rrule)
#   skip    the days whose occurrence was deleted, iCalendar's EXDATE
#   start   what the devices do at the start, in their screen's measures (the During it was): "off" for
#           any kind; a thermostat's target in tenths of a degree, heating; a lamp's [brightness, white, color], each nil
#           or a percentage, the white or the color and never both, or nil for on; a blind's position, 0 closed to 100
#           open, or "vent", its ventilation; nil for what only turns on
#   end     what they do from the end on, the same way; nil for an event with no end. A document from before has no
#           field here, which is "off", as its events did at their end
#
# The devices whose schedule is switched off are doc["scheduleOff"]. A document from before has neither field, which is
# none, and an older Berry keeps both as they are: the document's version stays.
#
# No device has two events at once: an event that overlaps another of one of its devices within the two years ahead is
# refused (clash). The store drops an event with what it acts on: a removed device's own, and a zone's it was the last
# of; a deleted zone's (PanelStore.drop_events).

#@ solidify:PanelSchedule
class PanelSchedule
    static MAX = 32
    static SUNRISE = 2000
    static SUNSET = 4000
    static SUN_SPAN = 120
    static HORIZON = 731         # the days the overlap check looks ahead: two years
    # the kinds a schedule acts on, the blind with them since it has its control
    static KINDS = ["thermostat", "light", "plug", "switch", "fan", "generic", "cover"]
    static CATCH_UP = 5          # the minutes a late turn of the minute makes up
    static RETRY = 15            # the minutes a command of an event that is not confirmed is tried again, once each
    static FREQS = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]
    static BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]

    var store
    var clock      # the panel's PanelClock: the house's place and time zone, for the sun
    var suns       # the sun of the last few days looked at, day -> [rise, set], or false where it neither rises nor sets
    var sun_place  # the place and the time zone the kept days are of
    var ui         # the PanelUi: what the devices say (live, doubt, unconfirmed) and the panel's relays
    var last       # the last local minute the engine ran, in minutes since 1970, or nil before the first
    var wants      # device -> [uid, start, minute]: an event's command not confirmed yet, its start's or its end's, and the minute it went

    def init(store, clock)
        self.store = store
        self.clock = clock
        self.wants = {}
        # a document with an event the engine cannot run, from a restore, a hand or a version before, loses it here
        if self.sweep()  store.save() end
    end

    # --- the document -----------------------------------------------------------------------------------------------

    def events() return self.store.doc.find("events", []) end

    def find(uid)
        for e: self.events()
            if e[0] == uid return e end
        end
        return nil
    end

    # the devices an event is for: its device, or its zone's of the kind on the relay
    def devices_of(f)
        if isinstance(f, list) return self.store.group_of(f) end
        return self.store.find_device(f) != nil ? [f] : []
    end

    # every event that acts on a device: its own, and its zone's
    def events_of(dev)
        var out = []
        for e: self.events()
            if self.devices_of(e[1]).find(dev) != nil out.push(e) end
        end
        return out
    end

    def is_off(dev) return self.store.doc.find("scheduleOff", []).find(dev) != nil end

    # what an event's devices do from its end on, or nil for one with no end: a document from before has no field, which
    # was their end then, off
    static def end_of(e)
        if e[4] == nil return nil end
        return size(e) > 8 ? e[8] : "off"
    end

    # whether an action leaves a device on, as its state says it: a blind is "on" while it is not all the way down
    static def lit(a) return a != "off" && a != 0 end

    # The opposite of an action, what the end comes as when it is set: off for anything on, a blind closed; and for
    # off, on: a lamp as it was, a thermostat heating to `target`, a blind all the way up
    static def opposite(kind, a, target)
        if kind == "cover" return a == 0 ? 100 : 0 end
        if a != "off" return "off" end
        return kind == "thermostat" ? target : nil
    end

    # --- times, days and the sun ------------------------------------------------------------------------------------

    static def time_ok(t)
        if type(t) != "int" return false end
        if t >= 0 && t < 1440 return true end
        var m = t - (t < PanelSchedule.SUNSET - 1000 ? PanelSchedule.SUNRISE : PanelSchedule.SUNSET)
        return m >= -PanelSchedule.SUN_SPAN && m <= PanelSchedule.SUN_SPAN && m % 15 == 0
    end

    # the sun of a day at the house: [rise, set] in minutes of the day, or nil without the place or where it neither
    # rises nor sets. A few days are kept, the ones an occurrence and its neighbours ask for
    def sun_of(day)
        var c = self.clock
        if c == nil || c.lat == nil || c.lon == nil return nil end
        var p = self.sun_place
        if p == nil || p[0] != c.lat || p[1] != c.lon || p[2] != c.tz
            self.suns = nil
            self.sun_place = [c.lat, c.lon, c.tz]
        end
        var s = self.suns != nil ? self.suns.find(day) : nil
        if s == nil
            if self.suns == nil || size(self.suns) >= 8  self.suns = {} end
            s = PanelClock.sun(day, c.lat, c.lon, c.tz)
            self.suns[day] = s != nil ? s : false
        end
        return s != false ? s : nil
    end

    # the minute of a day a time says, or nil when it is the sun's and the sun is not known
    def minute(t, day)
        if t < 1440 return t end
        var sun = self.sun_of(day)
        if sun == nil return nil end
        var m = t < PanelSchedule.SUNSET - 1000 ? sun[0] + t - PanelSchedule.SUNRISE : sun[1] + t - PanelSchedule.SUNSET
        if m < 0 return 0 end
        if m > 1439 return 1439 end
        return m
    end

    # An occurrence on a day: its start and its end in minutes from that day's midnight, the end past 1440 when it ends
    # the next day; or nil when the sun is not known. An event with no end is its start's minute, for the overlap check;
    # the engine fires no end for it
    def span(e, day)
        var s = self.minute(e[3], day)
        if e[4] == nil return s != nil ? [s, s + 1] : nil end
        var t = self.minute(e[4], day)
        if s == nil || t == nil return nil end
        if t <= s
            t = self.minute(e[4], day + 1)
            if t == nil return nil end
            t += 1440
        end
        return [s, t]
    end

    # whether an occurrence of an event starts on a day
    static def occurs(e, day)
        if day < e[2] || e[6].find(day) != nil return false end
        return PanelSchedule.ruled(e[5], e[2], day)
    end

    # whether a rule from a first day has an occurrence on a day at or after it, the deleted ones counted
    static def ruled(r, first, day)
        if r == nil return day == first end
        if r[3] != 0 && day > r[3] return false end
        var f = r[0]
        var n = r[1]
        if f == 1 return (day - first) % n == 0 end
        if f == 2
            if (r[2] & (1 << PanelClock.weekday(day))) == 0 return false end
            # weeks counted from the first day's, Monday to Sunday (iCalendar's WKST=MO)
            return ((day - PanelClock.weekday(day) - first + PanelClock.weekday(first)) / 7) % n == 0
        end
        var a = PanelClock.date_of(first)
        var b = PanelClock.date_of(day)
        if a[2] != b[2] return false end
        if f == 3 return ((b[0] - a[0]) * 12 + b[1] - a[1]) % n == 0 end
        return a[1] == b[1] && (b[0] - a[0]) % n == 0
    end

    # the last day an occurrence may start on, or nil for an event that repeats for good
    static def last_day(e)
        var r = e[5]
        if r == nil return e[2] end
        return r[3] != 0 ? r[3] : nil
    end

    # whether two spans of a day meet on the same day, or one a day before or after the other
    static def meet(sa, sb)
        for k: -1 .. 1
            if sa[0] < sb[1] + k * 1440 && sb[0] + k * 1440 < sa[1] return true end
        end
        return false
    end

    # The first day on which an occurrence of `a` overlaps one of `b`, within the HORIZON from the later of their first
    # days, or nil when they never meet. One that ends as the other starts does not overlap it
    def clash(a, b)
        var d = (a[2] > b[2] ? a[2] : b[2]) - 1
        var last = d + PanelSchedule.HORIZON
        for e: [a, b]
            var l = PanelSchedule.last_day(e)
            if l != nil && l + 1 < last  last = l + 1 end
        end
        # two events at fixed hours that never meet on any pair of days need no day looked at
        if a[3] < 1440 && (a[4] == nil || a[4] < 1440) && b[3] < 1440 && (b[4] == nil || b[4] < 1440) && !PanelSchedule.meet(self.span(a, 0), self.span(b, 0))
            return nil
        end
        while d <= last
            # two years of a day at a time, in Berry, is the longest thing the panel does in one go (0.4 s to 1.8 s in the simulator, ten
            # times that on the chip), and the VM's deadline is 4 s: a yield every 64 days starts it again, and feeds the watchdog
            if d % 64 == 0  tasmota.yield() end
            if PanelSchedule.occurs(a, d)
                var sa = self.span(a, d)
                for k: -1 .. 1
                    if sa != nil && PanelSchedule.occurs(b, d + k)
                        var sb = self.span(b, d + k)
                        if sb != nil && sa[0] < sb[1] + k * 1440 && sb[0] + k * 1440 < sa[1] return d end
                    end
                end
            end
            d += 1
        end
        return nil
    end

    # --- the checks -------------------------------------------------------------------------------------------------

    static def rule_ok(r)
        if r == nil return true end
        if !isinstance(r, list) || size(r) != 4 return false end
        for x: r
            if type(x) != "int" return false end
        end
        return r[0] >= 1 && r[0] <= 4 && r[1] >= 1 && r[1] <= 99 && r[2] >= 0 && r[2] < 128 && (r[2] == 0 || r[0] == 2) &&
               r[3] >= 0
    end

    static def days_ok(l)
        if !isinstance(l, list) return false end
        for x: l
            if type(x) != "int" return false end
        end
        return true
    end

    # an action the kind's screen could have made: off, for any kind, or how its page leaves it on
    static def during_ok(kind, d)
        if d == "off" return true end
        if kind == "thermostat" return type(d) == "int" && d >= 50 && d <= 450 end
        if kind == "cover" return d == "vent" || (type(d) == "int" && d >= 0 && d <= 100) end
        if kind != "light" return d == nil end
        if d == nil return true end
        if !isinstance(d, list) || size(d) != 3 || (d[1] != nil && d[2] != nil) || d[0] == 0 return false end
        for x: d
            if x != nil && (type(x) != "int" || x < 0 || x > 100) return false end
        end
        return true
    end

    # what is wrong with an event, as the store's refusal, or nil
    def check(e)
        if !isinstance(e, list) || (size(e) != 8 && size(e) != 9) || type(e[2]) != "int" return PanelStore.refuse("bad_event", nil) end
        var f = e[1]
        var kind = nil
        if isinstance(f, list)
            if size(f) != 3 || self.store.find_zone(f[0]) == nil return PanelStore.refuse("no_such_zone", nil) end
            kind = f[1]
        else
            var d = self.store.find_device(f)
            if d == nil return PanelStore.refuse("no_such_device", f) end
            kind = d[2]
        end
        if PanelSchedule.KINDS.find(kind) == nil return PanelStore.refuse("no_schedule", kind) end
        if size(self.devices_of(f)) == 0 return PanelStore.refuse("no_devices", nil) end
        if !PanelSchedule.time_ok(e[3]) || (e[4] != nil && !PanelSchedule.time_ok(e[4])) return PanelStore.refuse("bad_time", nil) end
        if e[3] == e[4] return PanelStore.refuse("same_time", nil) end
        if (e[3] >= 1440 || (e[4] != nil && e[4] >= 1440)) && (self.clock == nil || self.clock.lat == nil || self.clock.lon == nil)
            return PanelStore.refuse("no_location", nil)
        end
        if !PanelSchedule.rule_ok(e[5]) return PanelStore.refuse("bad_rule", nil) end
        if e[6] != nil && !PanelSchedule.days_ok(e[6]) return PanelStore.refuse("bad_skip", nil) end
        if !PanelSchedule.during_ok(kind, e[7]) || (e[4] != nil && !PanelSchedule.during_ok(kind, PanelSchedule.end_of(e)))
            return PanelStore.refuse("bad_during", nil)
        end
        return nil
    end

    # Whether an event is one the engine can run, whatever the house is like: its shape, its times, its rule, its deleted days and its
    # actions for the kind it acts on. What check refuses for what is not there (a device or a zone gone, no place for the sun) is not
    # asked: such an event waits for what it is for. One that is not sound trips every turn of the minute that looks at it
    def sound(e)
        var ok = false
        try
            ok = self.shaped_event(e)
        except .. as err, m
            ok = false
        end
        return ok
    end

    def shaped_event(e)
        if !isinstance(e, list) || (size(e) != 8 && size(e) != 9) || type(e[2]) != "int" return false end
        if !PanelSchedule.time_ok(e[3]) || (e[4] != nil && !PanelSchedule.time_ok(e[4])) || e[3] == e[4] return false end
        if !PanelSchedule.rule_ok(e[5]) || !PanelSchedule.days_ok(e[6]) return false end
        var f = e[1]
        var kind = nil
        if isinstance(f, list)
            if size(f) != 3 return false end
            kind = f[1]
        else
            var d = self.store.find_device(f)
            kind = d != nil ? d[2] : nil
        end
        # a device that is gone is what drop_events is for
        if kind == nil return true end
        if PanelSchedule.KINDS.find(kind) == nil return false end
        return PanelSchedule.during_ok(kind, e[7]) && (e[4] == nil || PanelSchedule.during_ok(kind, PanelSchedule.end_of(e)))
    end

    # The events the engine cannot run, out of the document, each said in the log: a bad one is no one's schedule, and the turn of
    # the minute that trips on it cannot run the others'. At the boot, and after a Replace, which gives an event to a device of
    # another kind. Whether any went (the caller saves)
    def sweep()
        var events = self.store.doc.find("events")
        if events == nil return false end
        var kept = []
        if isinstance(events, list)
            for e: events
                if self.sound(e)
                    kept.push(e)
                else
                    log("PANEL: the schedule drops an event it cannot run: " + str(e), 1)
                end
            end
            if size(kept) == size(events) return false end
        else
            log("PANEL: the schedule drops its events, which are not a list: " + str(events), 1)
        end
        self.store.doc["events"] = kept
        return true
    end

    # An event as the document keeps it: a copy, a weekly rule that names no day on its first day's weekday, its first
    # day its first occurrence, and only the deleted days from it on; nil when it has no occurrence at all
    static def normal(e)
        var f = e[1]
        var r = e[5] != nil ? e[5].copy() : nil
        var w = e[7]
        var ending = PanelSchedule.end_of(e)
        var ev = [e[0], isinstance(f, list) ? f.copy() : f, e[2], e[3], e[4], r, [], isinstance(w, list) ? w.copy() : w,
                  isinstance(ending, list) ? ending.copy() : ending]
        if r != nil && r[0] == 2 && r[2] == 0  r[2] = 1 << PanelClock.weekday(ev[2]) end
        var d = ev[2]
        while !PanelSchedule.ruled(r, ev[2], d)
            d += 1
            if d - ev[2] > 7 * 100 || (r != nil && r[3] != 0 && d > r[3]) return nil end
        end
        ev[2] = d
        for x: e[6] != nil ? e[6] : []
            if x >= d && ev[6].find(x) == nil ev[6].push(x) end
        end
        return ev
    end

    # --- the operations: each checks first and changes second, as the store's do, and the caller saves --------------

    # An event saved, checked whole: a new one when its uid is nil, or the one of its uid changed. The value is its uid
    def put(e)
        var bad = self.check(e)
        if bad != nil return bad end
        var events = self.events()
        var at = -1
        if e[0] != nil
            for i: 0 .. size(events) - 1
                if events[i][0] == e[0] at = i end
            end
            if at < 0 return PanelStore.refuse("no_such_event", e[0]) end
        elif size(events) >= PanelSchedule.MAX
            return PanelStore.refuse("too_many", PanelSchedule.MAX)
        end
        var ev = PanelSchedule.normal(e)
        if ev == nil return PanelStore.refuse("no_occurrence", nil) end
        # no device with two events at once
        var mine = self.devices_of(ev[1])
        for o: events
            if o[0] != ev[0]
                var shared = nil
                for dev: self.devices_of(o[1])
                    if shared == nil && mine.find(dev) != nil shared = dev end
                end
                var day = shared != nil ? self.clash(ev, o) : nil
                if day != nil return PanelStore.refuse("overlap", [o[0], shared, day]) end
            end
        end
        if at >= 0
            events[at] = ev
        else
            ev[0] = self.store.next_id("e")
            if !self.store.doc.contains("events") self.store.doc["events"] = events end
            events.push(ev)
        end
        return PanelStore.ok(ev[0], nil)
    end

    def delete(uid)
        var events = self.events()
        var kept = []
        for e: events
            if e[0] != uid kept.push(e) end
        end
        if size(kept) == size(events) return PanelStore.refuse("no_such_event", uid) end
        self.store.doc["events"] = kept
        return PanelStore.ok(nil, nil)
    end

    # One occurrence deleted, iCalendar's EXDATE; the only one of an event that does not repeat deletes it
    def skip(uid, day)
        var e = self.find(uid)
        if e == nil return PanelStore.refuse("no_such_event", uid) end
        if !PanelSchedule.occurs(e, day) return PanelStore.refuse("no_occurrence", day) end
        if e[5] == nil return self.delete(uid) end
        e[6].push(day)
        return PanelStore.ok(nil, nil)
    end

    # An occurrence and the ones after it deleted: the rule ends the day before, and from the first day it is all of them
    def end_before(uid, day)
        var e = self.find(uid)
        if e == nil return PanelStore.refuse("no_such_event", uid) end
        if !PanelSchedule.occurs(e, day) return PanelStore.refuse("no_occurrence", day) end
        if e[5] == nil || day <= e[2] return self.delete(uid) end
        e[5][3] = day - 1
        var kept = []
        for x: e[6]
            if x < day kept.push(x) end
        end
        e[6] = kept
        return PanelStore.ok(nil, nil)
    end

    # A device's schedule switched off or on (the clock of its page): its events act on it or not, and its
    # mode is not touched
    def set_off(dev, off)
        if self.store.find_device(dev) == nil return PanelStore.refuse("no_such_device", dev) end
        var kept = []
        for d: self.store.doc.find("scheduleOff", [])
            if d != dev kept.push(d) end
        end
        if off kept.push(dev) end
        self.store.doc["scheduleOff"] = kept
        return PanelStore.ok(nil, nil)
    end

    # --- the piece of iCalendar (RFC 5545) the panel runs ---------------------------------------------------------

    # a time as iCalendar writes one in UTC: 20261231T025959Z
    static def stamp(t)
        import string
        var ymd = PanelClock.date_of(t / 86400)
        var s = t % 86400
        return string.format("%04d%02d%02dT%02d%02d%02dZ", ymd[0], ymd[1], ymd[2], s / 3600, s / 60 % 60, s % 60)
    end

    # A rule as an RRULE, or nil for an event that does not repeat. Its end is the last second of its last day, in UTC
    # from the time zone `tz`, in hours
    static def rrule(r, tz)
        if r == nil return nil end
        var s = "FREQ=" + PanelSchedule.FREQS[r[0] - 1]
        if r[1] > 1  s += ";INTERVAL=" + str(r[1]) end
        if r[0] == 2
            var days = []
            for i: 0 .. 6
                if r[2] & (1 << i)  days.push(PanelSchedule.BYDAY[i]) end
            end
            s += ";BYDAY=" + days.concat(",")
        end
        if r[3] != 0  s += ";UNTIL=" + PanelSchedule.stamp((r[3] + 1) * 86400 - 1 - tz * 3600) end
        return s
    end

    # a number of digits only, or nil
    static def number(s)
        return PanelClock.digits(s) != nil ? int(s) : nil
    end

    # An RRULE's UNTIL as the last local day an occurrence starting at the minute `start` (0 for the sun's) may start on,
    # or nil: a date, a local time, or a time in UTC (with the Z)
    static def until_day(v, start, tz)
        var n = size(v)
        if n != 8 && n != 15 && n != 16 return nil end
        var y = PanelSchedule.number(v[0 .. 3])
        var m = PanelSchedule.number(v[4 .. 5])
        var d = PanelSchedule.number(v[6 .. 7])
        if y == nil || m == nil || d == nil || m < 1 || m > 12 || d < 1 || d > PanelClock.month_days(y, m) return nil end
        var day = PanelClock.days_of(y, m, d)
        if n == 8 return day end
        var hh = PanelSchedule.number(v[9 .. 10])
        var mm = PanelSchedule.number(v[11 .. 12])
        if v[8] != "T" || hh == nil || mm == nil || hh > 23 || mm > 59 || PanelSchedule.number(v[13 .. 14]) == nil return nil end
        var t = day * 1440 + hh * 60 + mm
        if n == 16
            if v[15] != "Z" return nil end
            t += tz * 60
        end
        day = t / 1440
        if t % 1440 < start  day -= 1 end
        return day
    end

    # An RRULE as a rule from a first day whose occurrences start at the minute `start` (0 for the sun's), or nil when
    # the panel does not run it. A COUNT becomes the last day it reaches, the deleted ones counted, as iCalendar has it
    static def parse_rrule(text, first, start, tz)
        import string
        var r = [0, 1, 0, 0]
        var count = 0
        var ymd = PanelClock.date_of(first)
        for part: string.split(string.toupper(str(text)), ";")
            var kv = string.split(part, "=")
            if size(kv) != 2 return nil end
            var k = kv[0]
            var v = kv[1]
            if k == "FREQ"
                var i = PanelSchedule.FREQS.find(v)
                if i == nil return nil end
                r[0] = i + 1
            elif k == "INTERVAL"
                r[1] = PanelSchedule.number(v)
            elif k == "BYDAY"
                for x: string.split(v, ",")
                    var i = PanelSchedule.BYDAY.find(x)
                    if i == nil return nil end
                    r[2] = r[2] | (1 << i)
                end
            elif k == "UNTIL"
                r[3] = PanelSchedule.until_day(v, start, tz)
                if r[3] == nil return nil end
            elif k == "COUNT"
                count = PanelSchedule.number(v)
                if count == nil || count < 1 return nil end
            elif k == "WKST"
                if v != "MO" return nil end
            elif k == "BYMONTHDAY"
                if PanelSchedule.number(v) != ymd[2] return nil end
            elif k == "BYMONTH"
                if PanelSchedule.number(v) != ymd[1] return nil end
            else
                return nil
            end
        end
        if r[0] == 0 || r[1] == nil || r[1] < 1 || r[1] > 99 || (r[2] != 0 && r[0] != 2) || (count > 0 && r[3] != 0)
            return nil
        end
        if r[0] == 2 && r[2] == 0  r[2] = 1 << PanelClock.weekday(first) end
        if count > 0
            var d = first
            var seen = 0
            while true
                if PanelSchedule.ruled(r, first, d) seen += 1 end
                if seen >= count break end
                d += 1
                if d - first > 36600 return nil end
            end
            r[3] = d
        end
        return r
    end
    # --- the engine ------------------------------------------------------------------------------------

    # Every second, from the brain: each minute turned since the last, its ends and then its starts. A late turn makes up
    # CATCH_UP minutes; a clock that jumps further, or that was never set, fires only the minute it is at, and one set
    # back fires nothing until it turns again, the minutes it ran not even then when it was set back CATCH_UP or less. Then
    # the commands not confirmed are tried again. The effects are the screens' own commands
    def tick()
        var t = self.clock != nil ? self.clock.today() : nil
        if t == nil || self.ui == nil return [] end
        var now = t[0] * 1440 + t[1]
        if self.last == nil || now - self.last > PanelSchedule.CATCH_UP  self.last = now - 1 end
        if now <= self.last
            # a clock set back a little (the internet's time, a second or two over a minute) does not run the minutes it ran again:
            # the mark stays where it was until the clock goes past it. One set back further starts over
            if self.last - now > PanelSchedule.CATCH_UP  self.last = now end
            return []
        end
        var out = []
        while self.last < now
            self.last += 1
            self.turned(self.last, false, now, out)
            self.turned(self.last, true, now, out)
        end
        self.retry(now, out)
        return out
    end

    # the starts, or the ends, at a minute: an occurrence that started the day before ends today. What they send waits
    # for its word from the minute the engine is at
    def turned(m, start, now, out)
        var day = m / 1440
        var events = self.events()
        if !isinstance(events, list) return end
        for e: events
            # an event the engine trips on is said and left: it does not take the others' minute with it, nor the commands the
            # ones before it made
            try
                for d: [day - 1, day]
                    var s = PanelSchedule.occurs(e, d) && (start || e[4] != nil) ? self.span(e, d) : nil
                    if s != nil && d * 1440 + s[start ? 0 : 1] == m  self.act(e, start, now, out) end
                end
            except .. as err, msg
                log("PANEL: the schedule skips an event it cannot run (" + str(err) + ": " + str(msg) + "): " + str(e), 1)
            end
        end
    end

    # An event's start or end on its devices, each with its own action: the ones whose schedule is on and that
    # have power, as a touch leaves out the ones behind a relay held open. Each waits for its word, and is tried again
    # without it
    def act(e, start, m, out)
        var all = self.devices_of(e[1])
        var ids = []
        var whole = isinstance(e[1], list)
        for dev: all
            if self.is_off(dev)
                whole = false
            elif !self.store.unpowered(dev, self.ui.relay_on)
                ids.push(dev)
            end
        end
        if size(ids) == 0 return end
        for x: self.effects(e, ids, start ? e[7] : PanelSchedule.end_of(e), whole) out.push(x) end
        for dev: ids  self.wants[dev] = [e[0], start, m] end
    end

    # The commands that put devices as an action of an event says, the ones their screens send: a zone's whole group by
    # its group, and each device by itself otherwise. Off turns them off. A lamp turns on, then takes the action's levels,
    # as the sliders give them; a thermostat goes to heat, and to the target within its own range; a blind goes to the
    # position, or to its own ventilation. The levels go at once, with no pacing
    def effects(e, ids, a, whole)
        var s = self.store
        var r = self.ui.relay_on
        var f = e[1]
        var kind = isinstance(f, list) ? f[1] : s.find_device(f)[2]
        var on = a != "off"
        if kind == "cover"
            # each blind where the action says, its ventilation its own, the ones going to one place together
            var by = {}
            for id: ids
                var v = a == "vent" ? PanelCoverView.ventilation([s.find_device(id)]) : (a == "off" ? 0 : a)
                if !by.contains(v)  by[v] = [] end
                by[v].push(id)
            end
            var out = []
            for v: PanelStore.sorted(by.keys())  out.push(["cover", by[v], "goto", v]) end
            return out
        end
        if kind == "thermostat"
            if !on return [["thermostat", ids, "mode", "off"]] end
            var out = [["thermostat", ids, "mode", "heat"]]
            var by = {}
            for id: ids
                var d = s.find_device(id)
                var v = a
                if d[5] > d[4] && v < d[4]  v = d[4] end
                if d[5] > d[4] && v > d[5]  v = d[5] end
                if !by.contains(v)  by[v] = [] end
                by[v].push(id)
            end
            for v: PanelStore.sorted(by.keys())  out.push(["thermostat", by[v], "target", v]) end
            return out
        end
        var out = []
        var intent = on ? "on" : "off"
        if whole
            var acting = []
            for id: ids
                if s.is_zigbee_actuator(s.find_device(id)) acting.push(id) end
            end
            out.push(["command", s.group_plan(f[0], f[1], f[2], r), intent, acting])
        else
            for id: ids
                out.push(["command", s.device_plan(id, r), intent, s.is_zigbee_actuator(s.find_device(id)) ? [id] : []])
            end
        end
        var w = a
        if !on || kind != "light" || w == nil return out end
        var caps = [PanelStore.CAP_LEVEL, PanelStore.CAP_CT, PanelStore.CAP_COLOR]
        var dims = ["bri", "ct", "hue"]
        for i: 0 .. 2
            if w[i] == nil continue end
            var members = []
            for id: ids
                var d = s.find_device(id)
                if (d[3] & caps[i]) != 0 && !PanelStore.is_relay_id(id) members.push(d) end
            end
            var plans = []
            if whole
                if size(members) > 0  plans.push([s.cap_plan(f[0], f[1], f[2], caps[i], r), members]) end
            else
                for d: members  plans.push([s.cap_plan(d[0], "", 0, caps[i], r), [d]]) end
            end
            for p: plans
                var ct = PanelUi.ct_range(p[1])
                if p[0] != nil && (i != 1 || ct[0] <= ct[1])
                    var lv = PanelUi.level_for(dims[i], w[i], ct[0], ct[1])
                    out.push(["level", p[0], lv[0], lv[1], "now"])
                end
            end
        end
        return out
    end

    # What a device is, as the screens know it: true on, false off, nil not known (no word, or a command on its way). A
    # relay device is its relay
    def state(dev)
        var ui = self.ui
        if PanelStore.is_relay_id(dev)
            var n = self.store.relay_of(dev)
            return n != 0 ? ui.relay_on[n - 1] : nil
        end
        var s = ui.live.find(dev)
        if ui.doubt.contains(dev) || ui.unconfirmed.contains(dev) || (s != "on" && s != "off") return nil end
        return s == "on"
    end

    # The commands of an event not confirmed: tried again each minute, up to RETRY minutes, while the device is not as
    # the event asked, still has power, and no one sent it another
    def retry(now, out)
        var keys = []
        for k: self.wants.keys() keys.push(k) end
        for dev: keys
            try
                var w = self.wants[dev]
                var e = self.find(w[0])
                var a = e != nil ? (w[1] ? e[7] : PanelSchedule.end_of(e)) : nil
                if e == nil || now > w[2] + PanelSchedule.RETRY || self.state(dev) == PanelSchedule.lit(a) || self.store.unpowered(dev, self.ui.relay_on)
                    self.wants.remove(dev)
                elif now > w[2]
                    for x: self.effects(e, [dev], a, false) out.push(x) end
                end
            except .. as err, msg
                # tried no more: what cannot be asked of it once is not asked of it every minute
                log("PANEL: the schedule gives up a command it cannot make (" + str(err) + ": " + str(msg) + ")", 1)
                self.wants.remove(dev)
            end
        end
    end

    # a command someone else sent to devices: theirs is the last word, and the schedule's waits no more
    def touched(ids)
        for id: ids  self.wants.remove(id) end
    end
end
