# berry/panel_clock.be, the panel's own clock and the house's place: what is typed as a time, a date or a
# coordinate, the days of the calendar, the sun, the preferences, what goes to Tasmota, what the screens say, the
# touches and the keyboard; and PanelUi handing Main settings' rows, the views, the verb and the keyboard to it. Each
# part is a function, as a script's top level runs out of constants.

import json

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if json.dump(got) != json.dump(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + json.dump(got))
        print("  want " + json.dump(want))
    end
end

# Tasmota's clock: the commands sent, and a Time from 2016 on setting it, as RtcSetTime does. RtcRetain is the fork's
# driver (USE_RTC_RETAIN): nil is a firmware without it, which answers no such command. The time zone is Tasmota's
# setting, which Timezone says and sets; its rtc says it only once the clock is set, and 0 before (support_rtc.ino)
class ClockTasmota : TasmotaStub
    var sent
    var retained
    var timers
    var zone
    def init() self.sent = [] self.timers = [] self.zone = "-03:00" end
    def set_timer(ms, f, id) self.timers.push([ms, f, id]) end
    def rtc()
        var u = self.utc_now != nil ? self.utc_now : 0
        var z = u > 1451606400 ? int(self.zone[0 .. 2]) * 60 : 0
        return {"local": u + z * 60, "utc": u, "timezone": z}
    end
    def cmd(c)
        import string
        if c == "RtcRetain" return self.retained != nil ? {"RtcRetain": {"Restored": self.retained, "Gap": 3}} : {"Command": "Unknown"} end
        if c == "Timezone" return {"Timezone": self.zone} end
        self.sent.push(c)
        if string.find(c, "Timezone ") == 0  self.zone = string.format("%+03d:00", int(c[9 ..])) end
        if string.find(c, "Time ") == 0
            var n = int(c[5 ..])
            if n >= 1451602800  self.utc_now = n end
        end
    end
end
tasmota = ClockTasmota()

# What PanelClock asks of PanelUi, each answer an effect that says it
class FakeUi
    var entry
    def init() self.entry = {"page": 0} end
    def show() return [["shown"]] end
    def back() return [["back"]] end
    def open_keyboard(a) return [["keyboard", a[2]]] end
    def top() return self.entry end
    def rows_for(v) return 3 end
end

# 2026-10-07, a Wednesday, at 09:30 in Brasília: 20733 days since 1970, and 12:30 UTC
var WED = 20733
def at_brasilia(days, minutes) tasmota.utc_now = days * 86400 + minutes * 60 + 3 * 3600 end

def typing()
    var t = [["6", 360], ["06", 360], ["630", 390], ["0630", 390], ["6:30", 390], ["06:30", 390], ["6.30", 390], [" 7 ", 420],
             ["23:59", 1439], ["0", 0], ["24", nil], ["2400", nil], ["1260", nil], [":30", nil], ["6:3", nil], ["6:", nil],
             ["abc", nil], ["", nil], ["12345", nil], ["6:300", nil], ["-6", nil]]
    for c: t  check("the time " + json.dump(c[0]), PanelClock.parse_time(c[0]), c[1]) end
    var d = [["2412", [24, 12, nil]], ["24/12", [24, 12, nil]], ["24.12.2026", [24, 12, 2026]], ["24-12-2026", [24, 12, 2026]],
             ["07102026", [7, 10, 2026]], ["7/10", [7, 10, nil]], ["31/04", nil], ["29/02/2027", nil], ["29/02/2028", [29, 2, 2028]],
             ["29/02", [29, 2, nil]], ["00/10", nil], ["32/01", nil], ["1/13", nil], ["24/12/26", nil], ["241", nil],
             ["24/12/2015", nil], ["24/12/2100", nil], ["24/12/20a6", nil], ["/12", nil], ["24//2026", nil], ["", nil], ["1/2/3/4", nil]]
    for c: d  check("the date " + json.dump(c[0]), PanelClock.parse_date(c[0]), c[1]) end
    var p = [["-23.5505", 90, -235505], ["23.5505 S", 90, -235505], ["23,5505s", 90, -235505], ["46.6333 W", 180, -466333],
             ["46.6333 E", 180, 466333], ["12", 90, 120000], ["12.3", 90, 123000], ["12.34567", 90, 123456], [".5", 90, 5000],
             ["91", 90, nil], ["90", 90, 900000], ["180.0001", 180, nil], ["-", 90, nil], ["S", 90, nil], ["1.2.3", 90, nil],
             ["abc", 90, nil], ["12 N", 180, nil], ["12 E", 90, nil], ["", 90, nil], ["-12 S", 90, nil]]
    for c: p  check("the coordinate " + json.dump(c[0]) + " of " + str(c[1]), PanelClock.parse_coord(c[0], c[1]), c[2]) end
    check("ten-thousandths as a decimal", [PanelClock.decimal(-235505), PanelClock.decimal(5), PanelClock.decimal(900000)],
          ["-23.5505", "0.0005", "90.0000"])
    check("a coordinate as the screen says it", [PanelClock.coord_text(-235505, true), PanelClock.coord_text(466333, false),
          PanelClock.coord_text(-466333, false), PanelClock.coord_text(0, true), PanelClock.coord_text(nil, true)],
          ["23.5505 S", "46.6333 E", "46.6333 W", "0.0000 N", "Not set"])
end

def calendar()
    check("1970-01-01 is day 0, a Thursday", [PanelClock.days_of(1970, 1, 1), PanelClock.DAYS[PanelClock.weekday(0)]], [0, "Thu"])
    check("2026-10-07 is day 20733, a Wednesday", [PanelClock.days_of(2026, 10, 7), PanelClock.weekday(WED)], [WED, 2])
    check("and the days the other sums gave", [PanelClock.days_of(2026, 12, 24), PanelClock.days_of(2028, 2, 29), PanelClock.days_of(2016, 1, 1),
          PanelClock.days_of(2099, 12, 31)], [20811, 21243, 16801, 47481])
    check("a day before 1970 is still a weekday", PanelClock.DAYS[PanelClock.weekday(-1)], "Wed")
    var bad = nil
    var day = PanelClock.days_of(2016, 1, 1)
    while day <= PanelClock.days_of(2100, 3, 1)
        var ymd = PanelClock.date_of(day)
        if PanelClock.days_of(ymd[0], ymd[1], ymd[2]) != day || ymd[2] > PanelClock.month_days(ymd[0], ymd[1])  bad = day break end
        day += 13
    end
    check("every 13th day from 2016 to 2100 goes to its date and back", bad, nil)
    check("the leap days", [PanelClock.month_days(2028, 2), PanelClock.month_days(2027, 2), PanelClock.month_days(2100, 2),
          PanelClock.month_days(2000, 2), PanelClock.month_days(2026, 4), PanelClock.month_days(2026, 12)], [29, 28, 28, 29, 30, 31])
    check("minutes as a time", [PanelClock.hhmm(0), PanelClock.hhmm(395), PanelClock.hhmm(1439)], ["00:00", "06:35", "23:59"])
    check("a day as the screens say it", [PanelClock.day_text(20811, false), PanelClock.day_text(20811, true), PanelClock.day_text(WED, true)],
          ["Thu 24/12", "Thu 24/12/2026", "Wed 07/10/2026"])
end

# within 4 minutes of SunCalc's sums (Agafonkin), worked out apart from this file
def near(name, got, want)
    var ok = got != nil && size(got) == 2
    if ok
        for i: 0 .. 1
            var d = got[i] - want[i]
            if d < -4 || d > 4  ok = false end
        end
    end
    check(name, ok ? want : got, want)
end

def sun()
    var sp = [-235505, -466333]
    near("São Paulo at the December solstice", PanelClock.sun(PanelClock.days_of(2026, 12, 21), sp[0], sp[1], -3), [318, 1133])
    near("São Paulo at the June solstice", PanelClock.sun(PanelClock.days_of(2026, 6, 21), sp[0], sp[1], -3), [409, 1050])
    near("the Living room's day", PanelClock.sun(WED, sp[0], sp[1], -3), [342, 1088])
    near("London in June, in UTC", PanelClock.sun(PanelClock.days_of(2026, 6, 21), 515074, -1278, 0), [224, 1222])
    near("the equator at the equinox", PanelClock.sun(PanelClock.days_of(2026, 3, 20), 0, 0, 0), [365, 1092])
    check("no sunset at 80 north in June", PanelClock.sun(PanelClock.days_of(2026, 6, 21), 800000, 0, 0), nil)
    check("no sunrise at 80 north in December", PanelClock.sun(PanelClock.days_of(2026, 12, 21), 800000, 0, 0), nil)
    check("a minute out of the day comes back into it", [PanelClock.minute_of(-10.4), PanelClock.minute_of(1445.6), PanelClock.minute_of(59.5)],
          [1430, 6, 60])
end

def preferences()
    tasmota.utc_now = 0
    var c = PanelClock()
    check("a panel never set: Brasília, the internet's time, no place, no clock", [c.tz, c.ntp, c.lat, c.lon, c.source, c.valid()],
          [-3, true, nil, nil, nil, false])
    c.load({"tz": 2, "ntp": false, "lat": -235505, "lon": -466333})
    check("the preferences kept", c.kept(), {"tz": 2, "ntp": false, "lat": -235505, "lon": -466333})
    c.load({"tz": 15, "ntp": "no", "lat": 900001, "lon": -1800001})
    check("what is no preference is left as it was", c.kept(), {"tz": 2, "ntp": false, "lat": -235505, "lon": -466333})
    c.load(nil)
    c.load([1])
    check("and nothing kept is nothing changed", c.kept()["tz"], 2)
    at_brasilia(WED, 570)
    check("a clock set at the boot was the internet's", PanelClock().source, "internet")
end

def to_tasmota()
    at_brasilia(WED, 570)
    var c = PanelClock()
    tasmota.sent = []
    c.apply()
    check("the boot leaves Tasmota's own time zone, and sends no place before one is typed", tasmota.sent, [])
    c.tz = 2
    tasmota.sent = []
    c.apply()
    check("and gives it the one chosen", tasmota.sent, ["Timezone 2"])
    # Tasmota back at Brasília's, as the panel's
    tasmota.zone = "-03:00"
    c.tz = -3
    c.lat = -235505
    c.lon = -466333
    tasmota.sent = []
    c.apply()
    check("and the place once it was", tasmota.sent, ["Latitude -23.5505", "Longitude -46.6333"])
    c.ntp = false
    tasmota.sent = []
    c.apply()
    check("with the internet's time off a clock that is set is held", tasmota.sent[-1], "Time " + str(tasmota.utc_now))
    c.time_set()
    check("and stays the internet's", c.source, "internet")

    c = PanelClock()
    tasmota.sent = []
    c.set_local(20811, 1140)
    check("the time typed is the user's at once, before its Time#Set", c.source, "you")
    check("a day and a time of Brasília are UTC three hours later, and the internet asked again", tasmota.sent,
          ["Time " + str(20811 * 86400 + 1140 * 60 + 3 * 3600), "Time 0"])
    c.time_set()
    check("the Time#Set after it is the user's", c.source, "you")
    c.time_set()
    check("and the next is the internet's", c.source, "internet")
    c.ntp = false
    tasmota.sent = []
    c.set_local(20811, 600)
    check("with the internet's time off it is not asked again", size(tasmota.sent), 1)

    c = PanelClock()
    c.ntp = false
    tasmota.sent = []
    c.time_set()
    check("the internet's time off: its first time is held", [c.source, tasmota.sent], ["internet", ["Time " + str(tasmota.utc_now)]])
    tasmota.sent = []
    c.time_set()
    check("and the Time#Set of that is the internet's still, held once", [c.source, tasmota.sent], ["internet", []])

    c = PanelClock()
    tasmota.sent = []
    c.run(["clock", "ntp", false])
    check("the internet's time off holds the clock", [c.ntp, tasmota.sent], [false, ["Time " + str(tasmota.utc_now)]])
    tasmota.sent = []
    c.run(["clock", "ntp", true])
    check("and on gives it back", [c.ntp, tasmota.sent], [true, ["Time 0"]])
    tasmota.sent = []
    c.run(["clock", "zone", -5])
    c.run(["clock", "place"])
    c.lat = 10000
    c.run(["clock", "place"])
    check("a time zone, and a place of only a latitude", [c.tz, tasmota.sent], [-5, ["Timezone -5", "Latitude 1.0000"]])
    tasmota.sent = []
    c.run(["clock", "set", 20811, 0])
    check("a day set", tasmota.sent[0], "Time " + str(20811 * 86400 + 5 * 3600))
    tasmota.utc_now = 0
    c = PanelClock()
    tasmota.sent = []
    c.set_ntp(false)
    check("the internet's time off with no clock holds nothing", tasmota.sent, [])
    check("and no clock has no today", c.today(), nil)
    tasmota.zone = "-03:00"
end

# A panel that boots before its clock is set: Tasmota's rtc says the zone 0 until then, and the zone is its setting.
# Taking that 0 into its preferences, a panel would give Timezone 0 back at a boot whose clock was kept across the
# restart, and from then on show UTC
def zone_at_boot()
    tasmota.utc_now = 0
    check("Tasmota's rtc says the zone 0 before the clock is set", tasmota.rtc()["timezone"], 0)
    var c = PanelClock()
    check("a panel that boots with no clock takes the setting, not the rtc's 0", [c.tz, c.kept()["tz"]], [-3, -3])
    at_brasilia(WED, 570)
    tasmota.sent = []
    c.apply()
    check("and gives Tasmota no zone once the clock is set", tasmota.sent, [])
    tasmota.utc_now = 0
    tasmota.zone = "+05:30"
    check("a zone with minutes is its hours", PanelClock().tz, 5)
    tasmota.zone = "-03:00"
end

def screens()
    tasmota.utc_now = 0
    var c = PanelClock()
    check("Main settings' rows with no clock and no place", [c.hint("clock"), c.hint("location"), c.hint("screensaver")],
          ["Not set", "Not set", nil])
    var v = c.view(["clock"], true)
    check("Date & time with no clock", [v[0], v[2][0][3], v[2][1][3], v[2][2][3], v[2][3][3], v[2][4][3]],
          ["Date & time", "--:--", "Not set", "UTC-3", "On", "Not set"])
    check("its taps", [v[2][0][5], v[2][1][5], v[2][2][5], v[2][3][5], v[2][4][5]],
          [["keyboard", "clock", "time"], ["keyboard", "clock", "date"], ["open", "clockZone"], ["clock", "ntp"], nil])
    at_brasilia(WED, 570)
    c = PanelClock()
    c.lat = -235505
    c.lon = -466333
    check("and with both", [c.hint("clock"), c.hint("location")], ["Wed 09:30", "23.5505 S"])
    v = c.view(["clock"], true)
    check("Date & time on the Living room's day, each value in what a US row holds", [v[2][0][3], v[2][1][3], v[2][4][2], v[2][4][3]],
          ["Wed 09:30", "07/10/2026", "Time from", "Internet"])
    v = c.view(["location"], true)
    var rise = PanelClock.sun(WED, -235505, -466333, -3)
    check("Location", [v[0], v[2][0][3], v[2][1][3], v[2][2][3], v[2][3][3], v[2][2][5], v[2][0][5]],
          ["Location", "23.5505 S", "46.6333 W", PanelClock.hhmm(rise[0]), PanelClock.hhmm(rise[1]), nil, ["keyboard", "clock", "lat"]])
    c.lon = nil
    check("Location with no longitude has no sun", c.view(["location"], true)[2][2][3], "--")
    v = c.view(["clockZone"], true)
    check("the time zones, from UTC-12 to UTC+14", [size(v[2]), v[2][0][2], v[2][12][2], v[2][26][2], v[2][9][0], v[2][9][5], v[2][10][5]],
          [27, "UTC-12", "UTC", "UTC+14", "dotOn", nil, ["clock", "zone", -2]])
    var ui = FakeUi()
    c.opened(ui, ["clockZone"])
    check("opened on the page of the panel's", ui.entry["page"], 3)
    ui.entry["page"] = 0
    c.opened(ui, ["clock"])
    check("and the other views where they start", ui.entry["page"], 0)
    check("the kinds it shows and the verb it answers", [c.shows("clock"), c.shows("location"), c.shows("clockZone"), c.shows("saver"),
          c.acts("clock"), c.acts("open")], [true, true, true, false, true, false])
end

def touches()
    at_brasilia(WED, 570)
    var c = PanelClock()
    var ui = FakeUi()
    check("the internet's time toggled: off now, Tasmota told, kept, drawn", [c.act(ui, ["clock", "ntp"]), c.ntp],
          [[["clock", "ntp", false], ["prefs"], ["show"]], false])
    check("a time zone chosen, and back", [c.act(ui, ["clock", "zone", 5]), c.tz], [[["clock", "zone", 5], ["prefs"], ["back"]], 5])
    check("one out of the list is nothing", [c.act(ui, ["clock", "zone", 20]), c.act(ui, ["clock", "zone", "x"]), c.act(ui, ["clock", "x"]), c.tz],
          [[], [], [], 5])
    c.tz = -3
    check("the time and the date open empty, or the glass would take no key into their full fields; a place not set too",
          [c.keyboard("time"), c.keyboard("date"), c.keyboard("lat"), c.keyboard("lon")], [["", 5], ["", 10], ["", 11], ["", 11]])
    c.lat = -235505
    check("a place typed before opens with it", c.keyboard("lat"), ["23.5505 S", 11])
    check("a time typed sets today at it", c.commit(ui, "time", "1415"), [["clock", "set", WED, 855], ["show"]])
    check("a time that is none is nothing", c.commit(ui, "time", "25"), [["shown"]])
    check("a date typed keeps the time, this year", c.commit(ui, "date", "24/12"), [["clock", "set", 20811, 570], ["show"]])
    check("a date with its year", c.commit(ui, "date", "01012027")[0], ["clock", "set", PanelClock.days_of(2027, 1, 1), 570])
    check("a date that is none is nothing", c.commit(ui, "date", "31/02"), [["shown"]])
    check("a latitude typed", [c.commit(ui, "lat", "22.9 s"), c.lat], [[["clock", "place"], ["prefs"], ["show"]], -229000])
    check("a longitude typed", [c.commit(ui, "lon", "-43.2"), c.lon], [[["clock", "place"], ["prefs"], ["show"]], -432000])
    check("a place that is none is nothing, and the place stays", [c.commit(ui, "lon", "200"), c.lon], [[["shown"]], -432000])

    tasmota.utc_now = 0
    c = PanelClock()
    check("no clock: a time waits for its date, whose keyboard opens", [c.commit(ui, "time", "0730"), c.draft], [[["keyboard", "date"]], 450])
    check("a date with no year is no date with no clock", c.commit(ui, "date", "24/12"), [["shown"]])
    check("and the date with its year sets both", [c.commit(ui, "date", "07/10/2026"), c.draft], [[["clock", "set", WED, 450], ["show"]], nil])
    check("a date alone sets its midnight", c.commit(ui, "date", "07102026"), [["clock", "set", WED, 0], ["show"]])
end

# PanelUi with the clock as a provider: Main settings' rows, the views, the verb and the keyboard
def through_the_ui()
    var f = open(TEST_ROOT + "/berry/test/fixtures/living-room.json")
    var doc = json.load(f.read())
    f.close()
    var store = PanelStore(doc)
    var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "keyboard": "editboard"},
                 "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5}
    var items = [["Screensaver", "screensaver", []], ["Date & time", "clock", ["help"]], ["Location", "location", []], ["Info", "info", []]]
    var ui = PanelUi(store, shape, / -> items, nil)
    at_brasilia(WED, 570)
    var c = PanelClock()
    ui.providers.push(c)
    var rows = ui.list_view(["settings"])[2]
    check("Main settings: the clock's rows say the time and the place, and open their screens",
          [rows[1][2], rows[1][3], rows[1][5], rows[2][3], rows[2][5]], ["Date & time", "Wed 09:30", ["open", "clock"], "Not set", ["open", "location"]])
    var out = ui.act(["open", "clock"])
    var said = {}
    for e: out
        if e[0] == "set"  said[e[1]] = e[2] end
    end
    check("the screen opens on the list", [said.find("$list.title"), said.find("$list.rows.0.label"), said.find("$list.rows.0.hint"),
          said.find("$list.pageCount")], ["Date & time", "Time", "Wed 09:30", 2])
    check("the verb is the clock's", ui.act(["clock", "ntp"]), [["clock", "ntp", false], ["prefs"], ["show"]])
    out = ui.act(["open", "clockZone"])
    check("the time zones open on the page of the panel's", ui.top()["page"], 3)
    out = ui.act(["keyboard", "clock", "time"])
    check("the keyboard opens empty, the time on the row", [out[0], out[1], out[2]], [["set", "$keyboard.value", ""], ["set", "$keyboard.max", 5],
          ["page", "editboard"]])
    check("and its OK goes to the clock", [ui.commit("1415"), ui.editing, ui.page], [[["clock", "set", WED, 855], ["show"]], nil, ""])
end

# a restart that is not a power cycle keeps the time, which the clock says
def kept_across()
    at_brasilia(WED, 570)
    tasmota.retained = 1
    var c = PanelClock()
    check("a time kept across the restart is said so", [c.source, c.view(["clock"], true)[2][4][3]], ["restart", "Restart"])
    tasmota.retained = 0
    check("a boot whose time was not kept: the internet's", PanelClock().source, "internet")
    tasmota.retained = nil
    check("and a firmware with no RtcRetain the same", PanelClock().source, "internet")
    tasmota.retained = 1
    tasmota.utc_now = 0
    check("no clock is no clock, kept or not", PanelClock().source, nil)
    tasmota.retained = nil
    at_brasilia(WED, 570)
    tasmota.retained = 1
    c = PanelClock()
    c.set_local(WED, 600)
    c.time_set()
    check("the user's time after it is the user's", c.source, "you")
    tasmota.retained = nil
end

# the time over the link with the bridge, by ClockLink's rule
def over_the_link()
    var said = []
    def words() var w = [] for l: said w.push(json.load(l[12 ..])) end said.clear() return w end
    at_brasilia(WED, 570)
    var now = tasmota.utc_now
    var c = PanelClock()
    c.link = / l -> said.push(l)
    tasmota.timers.clear()
    c.link_up()
    check("the link up: the panel's word, as a command to the bridge", [size(said) > 0 ? said[0][0 .. 11] : nil, words()],
          ["ZbRelayTime ", [{"utc": now, "src": "internet", "at": 0}]])
    c.link_up()
    check("said again at every link up, and again every six hours, on one timer", [size(words()), size(tasmota.timers), tasmota.timers[0][0]],
          [1, 1, 21600000])
    tasmota.timers[0][1]()
    check("the timer says it, and sets itself again", [size(words()), size(tasmota.timers)], [1, 2])

    c.set_local(WED, 600)
    var set = now + 30 * 60
    check("a time set by hand goes to the bridge at once, as fresh as it gets", words(), [{"utc": set, "src": "you", "at": set}])
    c.time_set()

    # the bridge's answer: taken only when it was set after the panel's, and the two are apart
    tasmota.sent.clear()
    c.on_event({"ZbTime": {"utc": set + 100, "src": "internet", "at": set - 1}})
    check("a bridge's time set before the panel's is not taken", [tasmota.sent, c.source], [[], "you"])
    c.on_event({"ZbTime": {"utc": set + 2, "src": "internet", "at": set + 1}})
    check("a fresher one within two seconds changes nothing", tasmota.sent, [])
    c.on_event({"ZbTime": {"utc": set + 100, "src": "internet", "at": set + 50}})
    check("a fresher one further apart is taken, and the NTP gets the clock back", [tasmota.sent, c.source, c.at],
          [["Time " + str(set + 100), "Time 0"], "bridge", set + 50])
    c.time_set()
    check("its Time#Set is the bridge's, and the screen says so", [c.source, c.view(["clock"], true)[2][4][3]], ["bridge", "Bridge"])
    tasmota.sent.clear()
    c.on_event({"ZbTime": {"utc": set + 200, "src": "panel", "at": set + 50}})
    check("the word it took comes back the same, and is not taken twice", tasmota.sent, [])
    c.link_up()
    check("and the panel's next word carries how fresh it was", words()[0]["at"], set + 50)

    # what is not the bridge's time
    for e: [{"ZbTime": {"utc": 0, "src": nil, "at": 0}}, {"ZbTime": {"utc": set + 900, "at": nil}}, {"ZbTime": "x"},
            {"ZbInfo": {}}, "ZbTime", nil]
        c.on_event(e)
    end
    check("a bridge with no clock, or not a word, is not taken", tasmota.sent, [])

    # with Internet time off the bridge's time is the user's: the NTP is not given the clock
    c.ntp = false
    c.on_event({"ZbTime": {"utc": set + 900, "src": "panel", "at": set + 800}})
    check("with Internet time off the bridge's time is held as the user's", tasmota.sent, ["Time " + str(set + 900)])

    # a panel with no clock takes any time the bridge has
    tasmota.utc_now = 0
    c = PanelClock()
    tasmota.sent.clear()
    c.on_event({"ZbTime": {"utc": now, "src": "restart", "at": 0}})
    check("a panel with no clock takes the bridge's, however old", [tasmota.sent, c.source], [["Time " + str(now), "Time 0"], "bridge"])
    c.link = nil
    c.say()
    check("and with no link there is no one to tell", said, [])
    tasmota.utc_now = 0
    check("a clock with no time says so", ClockLink.word("you", nil), {"utc": 0, "src": "you", "at": 0})
end

typing()
calendar()
kept_across()
over_the_link()
sun()
preferences()
zone_at_boot()
to_tasmota()
screens()
touches()
through_the_ui()

if failures > 0
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
else
    print("ok - " + str(checks) + " checks")
end
