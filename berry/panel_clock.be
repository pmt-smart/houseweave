# panel_clock.be -- the panel's own clock and the house's place: the time, the date, the time zone and the
# coordinates, set from Main settings, and the internet that only corrects the clock.
#
# The clock is Tasmota's. `Time <epoch>` sets it and holds it as the user's, so its NTP asks no more until the next
# boot, and `Time 0` gives it back to the NTP, asking at once (support_rtc.ino, RtcSetTime; support_wifi.ino,
# WifiPollNtp). Every time the clock is set Tasmota raises Time#Set (xdrv_10_system_events.ino), which says where the
# time came from: a Time of ours just sent is the user's, any other the internet's. With the internet's time off, a
# clock that is set is held against the NTP; one that was never set takes the internet's first time, which is better
# than none, and is held from then on. A restart that is not a power cycle keeps the time (the fork's RtcRetain driver, USE_RTC_RETAIN),
# the user's still held, and raises no Time#Set: the boot asks it.
#
# And the panel and its bridge tell each other their time over the link (ClockLink, clock_link.be):
# the panel when the link comes up, when the time is set by hand, and every six hours, and the bridge answers. A side
# with no clock takes the other's, and between two set clocks the one set last by the user or the internet wins.
#
# The time zone (whole hours, Tasmota's Timezone), whether the internet corrects the clock, and the coordinates
# (Tasmota's Latitude and Longitude, in ten-thousandths of a degree here) are the panel's preferences, which the backup
# takes (panel_prefs, brain.be): the boot gives them back to Tasmota, which saves its settings only when a value
# changes. The sun of any day is worked out here, by NOAA's sums, as Tasmota's own are for today only.
#
# It is also a provider of views for PanelUi (panel_ui.be, `providers`): Main settings' Date & time and Location rows
# and their screens, its taps (the verb "clock") and its keyboard (the target "clock"). A view's rows are made as
# PanelUi.row makes them; it comes before PanelUi, which it does not name, and works on the PanelUi it is handed.

#@ solidify:PanelClock
class PanelClock
    static VALID = 1451602800      # 2016-01-01, Tasmota's START_VALID_TIME: a clock before it was never set
    static ZONE_MIN = -12
    static ZONE_MAX = 14
    static DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    static VIEWS = ["clock", "location", "clockZone"]
    # where the time came from, in a word: a US list row's value takes about nine letters
    static FROM = {"you": "You", "internet": "Internet", "restart": "Restart", "bridge": "Bridge"}

    var tz          # the time zone, whole hours east of UTC: -3 is Brasília's, the images' own (APP_TIMEZONE)
    var ntp         # whether the internet corrects the clock
    var lat         # the house's latitude and longitude, in ten-thousandths of a degree, or nil
    var lon
    var source      # where the time came from: "you", "internet", "restart" or "bridge", or nil while it was never set
    var expect      # what the next Time#Set is, after a Time of ours: "you", "bridge", or the source being kept
    var draft       # a time of day typed while there was no date to go with it, in minutes, or nil
    var at          # when the clock was last set by the user or the internet, UTC, or 0: how fresh the time is, for the link
    var link        # f(line): a command to the bridge over the link (zigbee_bridge.be's send), or nil without one
    var timed       # the word said again every ClockLink.AGAIN_MS: its timer runs

    def init()
        # the image's own time zone until one is chosen: Brasília's, APP_TIMEZONE -3, on every image of ours
        self.tz = PanelClock.tasmota_zone()
        self.ntp = true
        # a clock set at the boot was kept across the restart (the fork's RtcRetain), or set by the internet:
        # Tasmota starts every boot from 0
        self.source = nil
        if self.valid()  self.source = ClockLink.kept_across() ? "restart" : "internet" end
        # a time kept or set at the boot is not known fresh: the link's rule takes it as the oldest
        self.at = 0
    end

    # --- the preferences -----------------------------------------------------------------------------------------

    # as panel_prefs keeps them, or nil
    def load(m)
        if !isinstance(m, map) return end
        var tz = m.find("tz")
        if type(tz) == "int" && tz >= PanelClock.ZONE_MIN && tz <= PanelClock.ZONE_MAX  self.tz = tz end
        if type(m.find("ntp")) == "bool"  self.ntp = m["ntp"] end
        var lat = m.find("lat")
        var lon = m.find("lon")
        if type(lat) == "int" && lat >= -900000 && lat <= 900000  self.lat = lat end
        if type(lon) == "int" && lon >= -1800000 && lon <= 1800000  self.lon = lon end
    end

    # what the preferences kept, read at the boot
    def load_saved()
        import persist
        var p = persist.find("panel_prefs", nil)
        self.load(isinstance(p, map) ? p.find("clock") : nil)
    end

    def kept()
        return {"tz": self.tz, "ntp": self.ntp, "lat": self.lat, "lon": self.lon}
    end

    # --- Tasmota's clock -----------------------------------------------------------------------------------------

    def valid() return tasmota.rtc()["utc"] >= PanelClock.VALID end

    # Tasmota's time zone, in whole hours: its setting, as the Timezone command says it ("-03:00"). Not the rtc's:
    # Tasmota works that one out only once the clock is set, and says 0 before (support_rtc.ino, RtcSecond), which a
    # panel that boots with no time took as the zone, kept in its preferences and gave back to Tasmota at a later boot.
    # The rules of a zone with summer time (Timezone 99) are not whole hours: the rtc's, then
    static def tasmota_zone()
        var r = tasmota.cmd("Timezone")
        var z = isinstance(r, map) ? r.find("Timezone") : nil
        if type(z) == "string" && size(z) >= 3 return int(z[0 .. 2]) end
        return tasmota.rtc().find("timezone", -180) / 60
    end

    # The preferences, given back to Tasmota at the boot: the time zone when it is another than Tasmota's, the place,
    # and the clock held with the internet's time off
    def apply()
        if self.tz != PanelClock.tasmota_zone()  tasmota.cmd("Timezone " + str(self.tz)) end
        self.send_place()
        if !self.ntp && self.valid()  self.hold(self.source) end
    end

    # each of them, once it was typed
    def send_place()
        if self.lat != nil  tasmota.cmd("Latitude " + PanelClock.decimal(self.lat)) end
        if self.lon != nil  tasmota.cmd("Longitude " + PanelClock.decimal(self.lon)) end
    end

    # the clock as it is, held against the NTP: a Time of ours, which Tasmota keeps as the user's
    def hold(source)
        self.expect = source
        tasmota.cmd("Time " + str(tasmota.rtc()["utc"]))
    end

    # Time#Set: a Time of ours, or the internet. With the internet's time off, the internet's first time is held
    def time_set()
        var by = self.expect
        self.expect = nil
        self.source = by != nil ? by : "internet"
        if by == nil
            # the internet's: as fresh as it gets
            self.at = tasmota.rtc()["utc"]
            if !self.ntp  self.hold("internet") end
        end
    end

    # A day and a time of it, the panel's own: what Tasmota is set to, in UTC, and the internet asked again
    # straight after when it corrects the clock
    def set_local(days, minutes)
        # the user's from now, and the screen drawn after this says so; its Time#Set comes a tick later
        self.source = "you"
        self.expect = "you"
        self.at = days * 86400 + minutes * 60 - self.tz * 3600
        tasmota.cmd("Time " + str(self.at))
        if self.ntp  tasmota.cmd("Time 0") end
        # the bridge learns it now: a time set by hand is the freshest there is
        self.say()
    end

    # --- the time over the link ---------------------------------------------------------------

    # the panel's word to the bridge, which answers with its own
    def say()
        import json
        if self.link != nil  self.link("ZbRelayTime " + json.dump(ClockLink.word(self.source, self.at))) end
    end

    # the link came up: the word now, and again every so often while the panel runs
    def link_up()
        self.say()
        if !self.timed
            self.timed = true
            tasmota.set_timer(ClockLink.AGAIN_MS, / -> self.again())
        end
    end

    def again()
        self.say()
        tasmota.set_timer(ClockLink.AGAIN_MS, / -> self.again())
    end

    # what the bridge said, among the link's events: its word, taken when the rule says so
    def on_event(payload)
        if isinstance(payload, map) && payload.contains("ZbTime")  self.heard(payload["ZbTime"]) end
    end

    def heard(peer)
        if !ClockLink.takes(self.valid(), self.at, peer) return end
        self.source = "bridge"
        self.expect = "bridge"
        self.at = peer["at"]
        tasmota.cmd("Time " + str(peer["utc"]))
        if self.ntp  tasmota.cmd("Time 0") end
    end

    def set_ntp(on)
        self.ntp = on
        if on
            tasmota.cmd("Time 0")
        elif self.valid()
            self.hold(self.source)
        end
    end

    def set_zone(hours)
        self.tz = hours
        tasmota.cmd("Timezone " + str(hours))
    end

    # What a view asked for (brain.be runs it): ["clock", "set", days, minutes], ["clock", "ntp", on],
    # ["clock", "zone", hours] or ["clock", "place"]
    def run(e)
        var op = e[1]
        if op == "set"
            self.set_local(e[2], e[3])
        elif op == "ntp"
            self.set_ntp(e[2])
        elif op == "zone"
            self.set_zone(e[2])
        elif op == "place"
            self.send_place()
        end
    end

    # the local day and minute: [days since 1970-01-01, minutes since midnight], or nil without a clock
    def today()
        if !self.valid() return nil end
        var local = tasmota.rtc()["utc"] + self.tz * 3600
        return [local / 86400, (local % 86400) / 60]
    end

    # --- days, times and places, as typed and as shown -----------------------------------------------------------

    # days since 1970-01-01 of a date, and back (Howard Hinnant's civil calendar)
    static def days_of(y, m, d)
        if m <= 2  y -= 1 end
        var era = (y >= 0 ? y : y - 399) / 400
        var yoe = y - era * 400
        var doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1
        var doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    end

    static def date_of(days)
        var z = days + 719468
        var era = (z >= 0 ? z : z - 146096) / 146097
        var doe = z - era * 146097
        var yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        var doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        var mp = (5 * doy + 2) / 153
        var d = doy - (153 * mp + 2) / 5 + 1
        var m = mp < 10 ? mp + 3 : mp - 9
        return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d]
    end

    # 0 is Monday: 1970-01-01 was a Thursday
    static def weekday(days) return (days % 7 + 10) % 7 end

    static def month_days(y, m)
        if m == 2 return (y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)) ? 29 : 28 end
        return [4, 6, 9, 11].find(m) != nil ? 30 : 31
    end

    static def two(n) return (n < 10 ? "0" : "") + str(n) end

    # minutes as "06:30"
    static def hhmm(minutes) return PanelClock.two(minutes / 60) + ":" + PanelClock.two(minutes % 60) end

    # now, with its weekday, which is how a date typed wrong shows: "Wed 09:30"
    static def now_text(t) return PanelClock.DAYS[PanelClock.weekday(t[0])] + " " + PanelClock.hhmm(t[1]) end

    # a date whole: "07/10/2026"
    static def date_text(days)
        var ymd = PanelClock.date_of(days)
        return PanelClock.two(ymd[2]) + "/" + PanelClock.two(ymd[1]) + "/" + str(ymd[0])
    end

    # a day as "Wed 07/10/2026", or "Wed 07/10" without the year
    static def day_text(days, year)
        var ymd = PanelClock.date_of(days)
        return PanelClock.DAYS[PanelClock.weekday(days)] + " " + PanelClock.two(ymd[2]) + "/" + PanelClock.two(ymd[1]) +
               (year ? "/" + str(ymd[0]) : "")
    end

    # digits only, or nil
    static def digits(s)
        if size(s) == 0 return nil end
        for i: 0 .. size(s) - 1
            var c = s[i]
            if c < "0" || c > "9" return nil end
        end
        return s
    end

    # A time of day as typed, in minutes, or nil: "6", "06", "630", "0630", "6:30", "06:30", or "6.30" from the T9
    # keypad, which has no colon
    static def parse_time(text)
        import string
        var s = string.tr(string.tr(text, " ", ""), ".", ":")
        var h = nil
        var m = nil
        var colon = string.find(s, ":")
        # a colon first is no time: its digits are not all digits, below
        if colon > 0
            var a = PanelClock.digits(s[0 .. colon - 1])
            var b = colon + 1 < size(s) ? PanelClock.digits(s[colon + 1 ..]) : nil
            if a == nil || b == nil || size(a) > 2 || size(b) != 2 return nil end
            h = int(a)
            m = int(b)
        else
            if PanelClock.digits(s) == nil || size(s) > 4 return nil end
            if size(s) <= 2
                h = int(s)
                m = 0
            else
                h = int(s[0 .. size(s) - 3])
                m = int(s[size(s) - 2 ..])
            end
        end
        if h > 23 || m > 59 return nil end
        return h * 60 + m
    end

    # A date as typed: [day, month, year], the year nil when it was not typed, or nil. "2412", "24122026", "24/12",
    # "24/12/2026", and with "." or "-" for the "/" the T9 keypad does not have
    static def parse_date(text)
        import string
        var s = string.tr(string.tr(string.tr(text, " ", ""), ".", "/"), "-", "/")
        var parts = string.split(s, "/")
        var d = nil
        var m = nil
        var y = nil
        if size(parts) == 1
            if PanelClock.digits(s) == nil || (size(s) != 4 && size(s) != 8) return nil end
            d = int(s[0 .. 1])
            m = int(s[2 .. 3])
            if size(s) == 8  y = int(s[4 .. 7]) end
        elif size(parts) == 2 || size(parts) == 3
            # the day and the month, one or two digits each, and a year of four
            if PanelClock.digits(parts[0]) == nil || PanelClock.digits(parts[1]) == nil return nil end
            if size(parts[0]) > 2 || size(parts[1]) > 2 return nil end
            d = int(parts[0])
            m = int(parts[1])
            if size(parts) == 3
                if PanelClock.digits(parts[2]) == nil || size(parts[2]) != 4 return nil end
                y = int(parts[2])
            end
        else
            return nil
        end
        if m < 1 || m > 12 || d < 1 return nil end
        if d > PanelClock.month_days(y != nil ? y : 2024, m) return nil end
        if y != nil && (y < 2016 || y > 2099) return nil end
        return [d, m, y]
    end

    # A coordinate as typed, in ten-thousandths of a degree, or nil: "-23.5505", "23.5505 S", "46,6333 W" (the T9
    # keypad has the comma and the letters, and no minus). `limit` is 90 for a latitude and 180 for a longitude
    static def parse_coord(text, limit)
        import string
        var s = string.toupper(string.tr(string.tr(text, " ", ""), ",", "."))
        if size(s) == 0 return nil end
        var sign = 1
        var tail = s[size(s) - 1]
        var neg = limit == 90 ? "S" : "W"
        var pos = limit == 90 ? "N" : "E"
        if tail == neg || tail == pos
            if tail == neg  sign = -1 end
            s = size(s) > 1 ? s[0 .. size(s) - 2] : ""
        elif s[0] == "-"
            sign = -1
            s = size(s) > 1 ? s[1 ..] : ""
        end
        var dot = string.find(s, ".")
        var whole = dot >= 0 ? (dot > 0 ? s[0 .. dot - 1] : "") : s
        var frac = dot >= 0 && dot + 1 < size(s) ? s[dot + 1 ..] : ""
        # ".5" is half a degree; "." alone, or nothing, is no number
        if size(whole) == 0 && size(frac) == 0 return nil end
        if (size(whole) > 0 && PanelClock.digits(whole) == nil) || (size(frac) > 0 && PanelClock.digits(frac) == nil) return nil end
        while size(frac) < 4  frac += "0" end
        var v = (size(whole) > 0 ? int(whole) : 0) * 10000 + int(frac[0 .. 3])
        if v > limit * 10000 return nil end
        return sign * v
    end

    # ten-thousandths of a degree as a decimal: -235505 is "-23.5505"
    static def decimal(v)
        var a = v < 0 ? -v : v
        var f = str(a % 10000)
        while size(f) < 4  f = "0" + f end
        return (v < 0 ? "-" : "") + str(a / 10000) + "." + f
    end

    # a coordinate as the screen says it: "23.5505 S", "46.6333 W"
    static def coord_text(v, lat)
        if v == nil return "Not set" end
        var letter = lat ? (v < 0 ? " S" : " N") : (v < 0 ? " W" : " E")
        return PanelClock.decimal(v < 0 ? -v : v) + letter
    end

    # The sunrise and the sunset of a day, in minutes of the day in the time zone, or nil where the sun neither rises
    # nor sets that day. NOAA's general solar position, at noon of the day: within a minute or two, as Tasmota's own
    static def sun(days, lat, lon, tz)
        import math
        var ymd = PanelClock.date_of(days)
        var doy = days - PanelClock.days_of(ymd[0], 1, 1)
        var g = 2 * math.pi / 365 * doy
        var eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) -
                               0.040849 * math.sin(2 * g))
        var decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) +
                   0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
        var phi = real(lat) / 10000 * math.pi / 180
        var c = math.cos(90.833 * math.pi / 180) / (math.cos(phi) * math.cos(decl)) - math.tan(phi) * math.tan(decl)
        if c < -1 || c > 1 return nil end
        var ha = math.acos(c) * 180 / math.pi
        var lng = real(lon) / 10000
        var rise = 720 - 4 * (lng + ha) - eqtime + tz * 60
        var fall = 720 - 4 * (lng - ha) - eqtime + tz * 60
        return [PanelClock.minute_of(rise), PanelClock.minute_of(fall)]
    end

    # a real minute of the day, rounded and brought into the day
    static def minute_of(m)
        var r = int(m + (m < 0 ? -0.5 : 0.5))
        return (r % 1440 + 1440) % 1440
    end

    # --- the views ----------------------------------------------------------------------------------------------

    static def row(label, hint, tap)
        return ["", "", label, hint, false, tap, nil]
    end

    static def dot_row(on, label, tap)
        return [on ? "dotOn" : "dotOff", "icon-off", label, "", false, on ? nil : tap, nil]
    end

    static def zone_text(h) return "UTC" + (h > 0 ? "+" : "") + (h != 0 ? str(h) : "") end

    def shows(kind) return PanelClock.VIEWS.find(kind) != nil end

    # what Main settings' row of a key says, or nil for a key that is not the clock's
    def hint(key)
        if key == "clock"
            var t = self.today()
            return t != nil ? PanelClock.now_text(t) : "Not set"
        end
        if key == "location" return self.lat != nil ? PanelClock.coord_text(self.lat, true) : "Not set" end
        return nil
    end

    # Date & time, Location and the time zones: [title, header action, rows]
    def view(view, ed)
        var kind = view[0]
        var t = self.today()
        if kind == "clock"
            return ["Date & time", "", [
                PanelClock.row("Time", t != nil ? PanelClock.now_text(t) : "--:--", ["keyboard", "clock", "time"]),
                PanelClock.row("Date", t != nil ? PanelClock.date_text(t[0]) : "Not set", ["keyboard", "clock", "date"]),
                PanelClock.row("Time zone", PanelClock.zone_text(self.tz), ["open", "clockZone"]),
                PanelClock.row("Internet time", self.ntp ? "On" : "Off", ["clock", "ntp"]),
                PanelClock.row("Time from", self.source != nil && t != nil ? PanelClock.FROM[self.source] : "Not set", nil)]]
        end
        if kind == "location"
            var s = nil
            if self.lat != nil && self.lon != nil && t != nil  s = PanelClock.sun(t[0], self.lat, self.lon, self.tz) end
            return ["Location", "", [
                PanelClock.row("Latitude", PanelClock.coord_text(self.lat, true), ["keyboard", "clock", "lat"]),
                PanelClock.row("Longitude", PanelClock.coord_text(self.lon, false), ["keyboard", "clock", "lon"]),
                PanelClock.row("Sunrise", s != nil ? PanelClock.hhmm(s[0]) : "--", nil),
                PanelClock.row("Sunset", s != nil ? PanelClock.hhmm(s[1]) : "--", nil)]]
        end
        var rows = []
        for h: PanelClock.ZONE_MIN .. PanelClock.ZONE_MAX
            rows.push(PanelClock.dot_row(h == self.tz, PanelClock.zone_text(h), ["clock", "zone", h]))
        end
        return ["Time zone", "", rows]
    end

    # where a view opens: the time zones on the page of the one the panel has
    def opened(ui, view)
        if view[0] == "clockZone"  ui.top()["page"] = (self.tz - PanelClock.ZONE_MIN) / ui.rows_for(view) end
    end

    def acts(verb) return verb == "clock" end

    # its views have nothing in the header
    def header(ui) return [] end

    # A touch: the internet's time on or off, a time zone chosen. The preference changes now, so the screen drawn
    # says it, and Tasmota's when the effect runs
    def act(ui, a)
        if a[1] == "ntp"
            self.ntp = !self.ntp
            return [["clock", "ntp", self.ntp], ["prefs"], ["show"]]
        end
        if a[1] == "zone" && type(a[2]) == "int" && a[2] >= PanelClock.ZONE_MIN && a[2] <= PanelClock.ZONE_MAX
            self.tz = a[2]
            var out = [["clock", "zone", a[2]], ["prefs"]]
            for e: ui.back() out.push(e) end
            return out
        end
        return []
    end

    # the keyboard of a field: [what it opens with, how long it may be]. The time and the date open empty: written, they
    # would fill the field, and the glass takes no key into a full one. What they are now is on the row that was tapped
    def keyboard(field)
        if field == "time" return ["", 5] end
        if field == "date" return ["", 10] end
        var v = field == "lat" ? self.lat : self.lon
        return [v != nil ? PanelClock.coord_text(v, field == "lat") : "", 11]
    end

    # OK on the keyboard. A time with no date to go with it waits for one: the date's keyboard opens. What is not a
    # time, a date or a place is as if nothing was typed
    def commit(ui, field, text)
        var t = self.today()
        if field == "time"
            var m = PanelClock.parse_time(text)
            if m == nil return ui.show() end
            if t != nil return [["clock", "set", t[0], m], ["show"]] end
            self.draft = m
            return ui.open_keyboard(["keyboard", "clock", "date"])
        end
        if field == "date"
            var d = PanelClock.parse_date(text)
            if d == nil return ui.show() end
            var y = d[2]
            if y == nil
                if t == nil return ui.show() end
                y = PanelClock.date_of(t[0])[0]
            end
            var minutes = t != nil ? t[1] : (self.draft != nil ? self.draft : 0)
            self.draft = nil
            return [["clock", "set", PanelClock.days_of(y, d[1], d[0]), minutes], ["show"]]
        end
        var v = PanelClock.parse_coord(text, field == "lat" ? 90 : 180)
        if v == nil return ui.show() end
        if field == "lat"
            self.lat = v
        else
            self.lon = v
        end
        return [["clock", "place"], ["prefs"], ["show"]]
    end
end
