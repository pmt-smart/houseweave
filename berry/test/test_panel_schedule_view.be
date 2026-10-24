# berry/panel_schedule_view.be: the schedule's screens, through the real PanelUi on the Living room's store with
# a thermostat in the Hall, a clock at 09:30 on Wednesday 2026-10-07 in São Paulo, and a fake thermostat driver.

import json

var failures = 0
var checks = 0

def deep_eq(a, b)
    if a == nil || b == nil return a == nil && b == nil end
    if isinstance(a, list)
        if !isinstance(b, list) || size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if !deep_eq(a[i], b[i]) return false end
        end
        return true
    end
    if isinstance(a, map)
        if !isinstance(b, map) || size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !deep_eq(a[k], b[k]) return false end
        end
        return true
    end
    return a == b
end

def check(name, got, want)
    checks += 1
    if !deep_eq(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + json.dump(got))
        print("  want " + json.dump(want))
    end
end

class FakeClock
    var lat, lon, tz, now
    def init() self.lat = -235505 self.lon = -466333 self.tz = -3 end
    def today() return self.now end
end

# what the thermostat's driver said: its step, its modes, its target
class FakeThermostat
    var shape, schema
    def init() self.shape = {"0x00124B0000B00001": {"step": 5, "modes": ["off", "heat"]}} self.schema = {} end
    def get(id, field, missing) return field == "set" ? 205 : missing end
end
class FakeNetwork
    var thermostat, cover
    def init() self.thermostat = FakeThermostat() end
end

var WED = 20733
var T = "0x00124B0000B00001"
var LAMP = "0x00124B0000C00001"

def house()
    var f = open(TEST_ROOT + "/berry/test/fixtures/living-room.json")
    var store = PanelStore(json.load(f.read()))
    f.close()
    store.register_device([T, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    store.add_to_zone("hall", T)
    # the US portrait's list, the value under the name, as its only one, with two rows a page here
    var shape = {"pages": {"plan": "home", "list": "tall", "zone": "zone", "help": "help", "keyboard": "editboard", "dialog": "dialog",
                           "thermostat": "thermostat", "detail": "lightdetail"},
                 "listRows": 2, "zoneRows": 2, "counters": 3, "helpLines": 5, "thermostatLines": 1, "thermostatModes": 3}
    var ui = PanelUi(store, shape, / -> [], nil)
    ui.prefs["editing"] = true
    ui.network = FakeNetwork()
    var clock = FakeClock()
    clock.now = [WED, 570]
    var sched = PanelSchedule(store, clock)
    sched.ui = ui
    var screens = PanelScheduleView(sched)
    ui.schedule = screens
    ui.providers.push(screens)
    return [ui, sched, screens, clock]
end

# what a list's screen writes, as {path: value}
def said(out)
    var m = {}
    for e: out
        if e[0] == "set"  m[e[1]] = e[2] end
        if e[0] == "page"  m["page"] = e[1] end
        if e[0] == "wrap"  m["line"] = e[2] end
    end
    return m
end

# a list view's rows, as [label, value, tap]
def rows(ui)
    var out = []
    for r: ui.list_view(ui.top()["view"])[2]  out.push([r[2], r[3], r[5]]) end
    return out
end

def rows_of(ui)
    var out = []
    for r: ui.list_view(ui.top()["view"])[2]  out.push([r[2], r[3], r[5]]) end
    return out
end

def words()
    var V = PanelScheduleView
    var S = PanelSchedule
    check("times", [V.time_text(360), V.time_text(S.SUNSET), V.time_text(S.SUNSET - 30), V.time_text(S.SUNRISE + 15), V.time_text(S.SUNRISE - 120)],
          ["06:00", "Sunset", "-30 Sunset", "+15 Sunrise", "-120 Sunrise"])
    check("from and to", [V.span_text([nil, T, WED, 360, 480, nil, [], nil]), V.span_text([nil, T, WED, S.SUNSET - 30, 1380, nil, [], nil])],
          ["06:00-08:00", "-30 Sunset to 23:00"])
    var d = / r -> V.days_text([nil, T, WED, 0, 60, r, [], nil])
    check("the days", [d(nil), d([1, 1, 0, 0]), d([1, 3, 0, 0]), d([2, 1, 31, 0]), d([2, 1, 96, 0]), d([2, 1, 127, 0]), d([2, 1, 5, 0]), d([2, 1, 4, 0]),
          d([2, 1, 21, 0]), d([2, 2, 31, 0]), d([3, 1, 0, 0]), d([4, 1, 0, 0])],
          ["Wed 07/10", "Daily", "Every 3 days", "Mon-Fri", "Sat-Sun", "Daily", "Mon,Wed", "Wed", "3 days", "Every 2 wk", "Monthly", "Yearly"])
    check("the Repeat a rule is, and none for Home Assistant's", [V.repeat_of(nil), V.repeat_of([1, 1, 0, 0]), V.repeat_of([2, 1, 31, 0]),
          V.repeat_of([2, 1, 96, 0]), V.repeat_of([2, 1, 5, 0]), V.repeat_of([1, 2, 0, 0]), V.repeat_of([2, 1, 31, WED]), V.repeat_of([3, 1, 0, 0])],
          [0, 1, 2, 3, 4, nil, nil, nil])
    check("the During in the screen's words", [V.during_text("thermostat", 215), V.during_text("light", [60, nil, 66]), V.during_text("light", [40, 90, nil]),
          V.during_text("light", [nil, nil, 0]), V.during_text("light", nil), V.during_text("plug", nil), V.during_text("light", [100, 50, nil]), V.during_text("light", [nil, 10, nil])],
          ["21.5°C", "60% Blue", "40% Warm", "Red", "On", "On", "100% Neutral", "Cool"])
    check("the colours by the wheel", [V.hue_word(8), V.hue_word(17), V.hue_word(33), V.hue_word(50), V.hue_word(76), V.hue_word(89), V.hue_word(98)],
          ["Orange", "Yellow", "Green", "Cyan", "Purple", "Pink", "Red"])
end

def a_thermostats_evening()
    var h = house()
    var ui = h[0]
    var sched = h[1]
    var found = []
    for r: ui.list_view(["deviceOptions", LAMP])[2] + ui.list_view(["deviceOptions", T])[2] + ui.list_view(["thermostatSettings", T])[2]
        if r[2] == "Schedule"  found.push(r) end
    end
    check("no Schedule row in a device's options, nor in a thermostat's settings", found, [])
    var s = said(ui.act(["schedule", "open", T]))
    check("its screen, on the tall list: no events yet, and the + to make one", [s["page"], s["$list.title"], s["$list.actionIcon"], s["$list.rows.0.label"]],
          ["tall", "Schedule", "add", "No events"])
    s = said(ui.action())
    check("the + is a new event: this thermostat, today, at the next full hour with no end, at the thermostat's target",
          [s["$list.title"], s["$list.actionIcon"], rows(ui)], ["New event", "confirm", [["For", "This one", ["open", "eventFor"]],
          ["Repeat", "Never", ["open", "eventRepeat"]], ["Day", "Wed 07/10", ["keyboard", "schedule", "day"]], ["Start", "10:00", ["open", "eventTime", "from"]],
          ["Action", "20.5°C", ["schedule", "action", 7]], ["End", "None", ["open", "eventTime", "to"]]]])
    ui.act(["open", "eventRepeat"])
    check("the Repeat's choices, a dot on the one it has", rows(ui), [["Never", "", nil], ["Every day", "", ["schedule", "repeat", 1]],
          ["Weekdays", "", ["schedule", "repeat", 2]], ["Weekends", "", ["schedule", "repeat", 3]], ["Custom", "", ["schedule", "repeat", 4]]])
    ui.act(["schedule", "repeat", 2])
    check("Weekdays, and the day goes: it repeats", [ui.top()["view"], rows(ui)[1], rows(ui)[2][0]], [["event"], ["Repeat", "Weekdays", ["open", "eventRepeat"]], "Start"])
    ui.act(["open", "eventTime", "from"])
    check("From is a time or the sun, and the time marked still opens its keyboard", rows(ui), [["Time", "10:00", ["keyboard", "schedule", "from"]],
          ["Sunrise", "", ["open", "eventSun", "from", PanelSchedule.SUNRISE]], ["Sunset", "", ["open", "eventSun", "from", PanelSchedule.SUNSET]]])
    var kb = ui.act(rows(ui)[0][2])
    check("the keyboard, empty: the time on the row would fill its five places, and the glass would take no key",
          [kb[0], kb[1], ui.editing], [["set", "$keyboard.value", ""], ["set", "$keyboard.max", 5], ["keyboard", "schedule", "from"]])
    ui.commit("1800")
    check("typed, and back on the event", [ui.top()["view"], rows(ui)[2][1]], [["event"], "18:00"])
    ui.act(["open", "eventTime", "to"])
    check("End is none, a time or the sun", rows(ui)[0 .. 1], [["None", "", nil], ["Time", "", ["keyboard", "schedule", "to"]]])
    ui.back()
    ui.open_keyboard(["keyboard", "schedule", "to"])
    ui.commit("23")
    check("an end at 23:00 comes with the start's opposite, off", rows(ui)[4 .. 5], [["End", "23:00", ["open", "eventTime", "to"]], ["At end", "Off", ["schedule", "action", 8]]])
    ui.open_keyboard(["keyboard", "schedule", "to"])
    ui.commit("25:00")
    check("a time that is not one is as if none was typed", rows(ui)[4][1], "23:00")
    s = said(ui.act(["schedule", "action", 7]))
    check("Action is the thermostat's page for the event's start", [ui.top()["view"], s["page"], s["$thermostat.name"], s["$thermostat.target"]],
          [["thermostat", "d", T, "during"], "thermostat", "Start · 18:00", "20.5°C"])
    s = said(ui.thermostat_step("$thermostat.plus.count"))
    check("its + changes the event, and sends nothing", [s, h[2].draft[7]], [{"$thermostat.target": "21.0°C", "$thermostat.minus.iconColor": "text-primary",
          "$thermostat.plus.iconColor": "text-primary"}, 210])
    h[2].draft[7] = 207
    ui.thermostat_step("$thermostat.minus.count")
    check("from off the thermostat's grid, to its next point", h[2].draft[7], 205)
    ui.thermostat_step("$thermostat.plus.count")
    check("a hold on the title does nothing for the event", ui.rename_top(), [])
    ui.thermostat_mode("$thermostat.modes.0.label")
    check("its Off is the event's: off at the start", h[2].draft[7], "off")
    ui.thermostat_mode("$thermostat.modes.1.label")
    check("and its Heat, at the target it shows", h[2].draft[7], 205)
    ui.thermostat_step("$thermostat.plus.count")
    ui.close()
    check("its title goes back, and the event has the target", rows(ui)[3][1], "21.0°C")
    var out = ui.action()
    check("the check saves it, and the list has it, under the switch of its schedule, which is on", [out[0], rows(ui)],
          [["save"], [["Schedule", "On", ["schedule", "toggle"]], ["18:00-23:00", "Mon-Fri", ["schedule", "edit", "e" + str(ui.store.doc["seq"] - 1)]]]])
    var uid = sched.events()[0][0]
    check("in the document, as the screens made it", sched.events(), [[uid, T, WED, 1080, 1380, [2, 1, 31, 0], [], 210, "off"]])

    # another at the same time on a Saturday overlaps
    ui.action()
    ui.act(["open", "eventRepeat"])
    ui.act(["schedule", "repeat", 4])
    check("Custom opens the days, the event's day's marked", [ui.top()["view"], rows(ui)[2], ui.list_view(["eventDays"])[2][2][0], ui.list_view(["eventDays"])[2][1][0]],
          [["eventDays"], ["Wednesday", "", ["schedule", "day", 2]], "dotOn", "dotOff"])
    ui.act(["schedule", "day", 2])
    check("the only day stays: never none", rows(ui)[2][0 .. 1], ["Wednesday", ""])
    check("and is marked", ui.list_view(["eventDays"])[2][2][0], "dotOn")
    ui.act(["schedule", "day", 5])
    ui.back()
    ui.open_keyboard(["keyboard", "schedule", "from"])
    ui.commit("2000")
    ui.open_keyboard(["keyboard", "schedule", "to"])
    ui.commit("2100")
    s = said(ui.action())
    check("Wednesdays and Saturdays at 20:00 overlap the thermostat's evenings: not saved, and why", [ui.top()["view"], s["page"], s["$list.title"], s["line"]],
          [["eventRefused"], "dialog", "Not saved", "Thermostat 1 already has an event on Mon-Fri 18:00-23:00."])
    ui.back()
    check("OK goes back to the event, as it was", [ui.top()["view"], rows(ui)[1][1], size(sched.events())], [["event"], "Custom", 1])
    ui.back()

    # changed, then deleted
    ui.act(["schedule", "edit", uid])
    check("an event opened has its device's name and its Delete", [ui.list_view(["event"])[0], rows(ui)[6]], ["Thermostat 1", ["Delete", "", ["open", "eventDelete"]]])
    s = said(ui.act(["schedule", "action", 8]))
    check("At end is the thermostat's page for the end, Off lit", [s["$thermostat.name"], s["$thermostat.modes.0.on"], s["$thermostat.modes.1.on"]], ["At end · 23:00", 1, 0])
    ui.thermostat_mode("$thermostat.modes.1.label")
    ui.close()
    check("its Heat makes the end the target the thermostat has, from then on", rows(ui)[5], ["At end", "20.5°C", ["schedule", "action", 8]])
    ui.act(["open", "eventTime", "to"])
    ui.act(["schedule", "noend"])
    check("and None takes the end and its action away", [rows(ui)[4], size(rows(ui)), h[2].draft[4], h[2].draft[8]], [["End", "None", ["open", "eventTime", "to"]], 6, nil, nil])
    ui.act(["open", "eventFor"])
    ui.act(["schedule", "for", 1])
    check("For the zone: the Hall's thermostats", [rows(ui)[0][1], h[2].draft[1]], ["Zone", ["hall", "thermostat", 0]])
    s = said(ui.act(["open", "eventDelete"]))
    check("Delete asks, on the dialog's page", [s["page"], s["$list.title"], s["line"]], ["dialog", "Delete this event?", "It goes from the panel and from Home Assistant."])
    out = ui.act(["schedule", "delete"])
    check("and the event goes, back on the list", [out[0], sched.events(), ui.top()["view"], rows(ui)], [["save"], [], ["schedule", T], [["No events", "", nil]]])
end

def the_sun_and_the_day()
    var h = house()
    var ui = h[0]
    ui.act(["schedule", "open", T])
    ui.action()
    ui.act(["open", "eventTime", "from"])
    ui.act(["open", "eventSun", "from", PanelSchedule.SUNRISE])
    check("the sunrise's offsets open on the page of the sunrise itself: two rows a page on the tall list", [ui.top()["page"], ui.list_view(ui.top()["view"])[2][8][2]], [4, "Sunrise"])
    ui.act(["schedule", "sun", "from", PanelSchedule.SUNRISE - 30])
    check("half an hour before it, and back on the event", [ui.top()["view"], rows(ui)[3][1], rows(ui)[5][1]], [["event"], "-30 Sunrise", "None"])
    ui.act(["open", "eventTime", "from"])
    check("the sunrise marked still opens its minutes, and the time its keyboard", [rows(ui)[0], rows(ui)[1]],
          [["Time", "", ["keyboard", "schedule", "from"]], ["Sunrise", "", ["open", "eventSun", "from", PanelSchedule.SUNRISE]]])
    ui.back()
    ui.act(["open", "eventTime", "to"])
    ui.act(["open", "eventSun", "to", PanelSchedule.SUNSET])
    ui.act(["schedule", "sun", "to", PanelSchedule.SUNSET + 15])
    check("and to a quarter after the sunset", [rows(ui)[3][1], rows(ui)[5][1]], ["-30 Sunrise", "+15 Sunset"])
    ui.open_keyboard(["keyboard", "schedule", "to"])
    ui.commit("1100")
    h[3].lat = nil
    ui.act(["open", "eventTime", "to"])
    check("with no place the sun is not on offer", rows(ui)[2], ["Sunrise", "No location", nil])
    ui.back()
    ui.open_keyboard(["keyboard", "schedule", "day"])
    ui.commit("2412")
    check("a day typed: Christmas this year", rows(ui)[2][1], "Thu 24/12")
    ui.open_keyboard(["keyboard", "schedule", "day"])
    ui.commit("05/10")
    check("a date gone this year is next year's", h[2].draft[2], PanelClock.days_of(2027, 10, 5))
    ui.open_keyboard(["keyboard", "schedule", "day"])
    ui.commit("3002")
    check("and one that is not a date is as if none was typed", h[2].draft[2], PanelClock.days_of(2027, 10, 5))
    ui.open_keyboard(["keyboard", "schedule", "day"])
    ui.commit("2902")
    check("nor a 29th of February the next one has not", h[2].draft[2], PanelClock.days_of(2027, 10, 5))
    h[3].lat = -235505
    var s = said(ui.action())
    check("a sun with the place saves", [ui.top()["view"], s["$list.rows.1.label"], s["$list.rows.1.hint"]], [["schedule", T], "-30 Sunrise to 11:00", "Tue 05/10"])
end

def a_lamps_levels()
    var h = house()
    var ui = h[0]
    ui.act(["schedule", "open", LAMP])
    ui.action()
    check("a new lamp's event turns it on", rows(ui)[4], ["Action", "On", ["schedule", "action", 7]])
    ui.act(["schedule", "action", 7])
    check("its action, a choice: on, off, or its levels", [ui.top()["view"], rows(ui)], [["eventAction"], [["On", "", nil], ["Off", "", ["schedule", "set", "off"]],
          ["Levels", "", ["schedule", "levels"]]]])
    var s = said(ui.act(["schedule", "levels"]))
    check("its levels on its detail for the event", [ui.top()["view"], s["page"], s["$light.name"]], [["detail", "d", LAMP, "during"], "lightdetail", "Start · 10:00"])
    check("a slider changes the event, and sends nothing", [ui.level("bri", 60.2), ui.level("ct", 90), ui.level("hue", 66)], [[], [], []])
    check("the white or the colour, the one moved last", h[2].draft[7], [60, nil, 66])
    ui.level("ct", 20)
    ui.level("bri", 0)
    check("the white moved after the colour, and a brightness that is never off", h[2].draft[7], [1, 20, nil])
    ui.level("bri", 60)
    ui.level("hue", 66)
    s = said(ui.show())
    check("the detail shows the event's levels", [s["$light.brightnessPct"], s["$light.huePct"]], [60, 66])
    ui.close()
    check("and the event says them, the choice gone from under the page", [ui.top()["view"], rows(ui)[4][1]], [["event"], "60% Blue"])
    ui.act(["schedule", "action", 7])
    ui.act(["schedule", "set", "off"])
    check("off chosen, the lamp goes out at the start", [h[2].draft[7], rows(ui)[4][1]], ["off", "Off"])
    ui.act(["schedule", "open", "relay:1"])
    ui.action()
    ui.act(["schedule", "action", 7])
    check("a relay's lamp: on or off, and no levels", rows(ui), [["On", "", nil], ["Off", "", ["schedule", "set", "off"]]])
end

# a blind's event: it opens; its Action is its page for the event, whose keys, slider and ventilation set
# the action and command no blind; and an end set closes it
def a_blinds_event()
    var h = house()
    var ui = h[0]
    var sched = h[1]
    var CV = "0x00124B0000C10001"
    ui.store.register_device([CV, "Cover 1", "cover", 64, 30, 0, "TS0601", 1, 0, 0])
    ui.store.add_to_zone("hall", CV)
    ui.network.cover = FakeThermostat()
    ui.shape["pages"]["cover"] = "cover"
    ui.act(["schedule", "open", CV])
    ui.action()
    check("a blind's new event opens it", rows(ui)[4], ["Action", "Open", ["schedule", "action", 7]])
    var s = said(ui.act(["schedule", "action", 7]))
    check("its Action is its page for the event, the slider at the top and no row under the title",
          [ui.top()["view"], s["$cover.name"], s["$cover.position"], s["$cover.page"], s["$cover.card.shown"]],
          [["cover", "d", CV, "during"], "Start · 10:00", "Open", 0, 0])
    check("its down key closes it, and commands no blind", [ui.cover_key("$cover.down.count")[0], h[2].draft[7]], [["set", "$cover.name", "Start · 10:00"], 0])
    ui.cover_slide(6)
    check("the slider let go at 70%", h[2].draft[7], 70)
    s = said(ui.cover_vent())
    check("its ventilation, the blind's own, lit", [h[2].draft[7], s["$cover.vent.on"], s["$cover.position"]], ["vent", 1, "Ventilation"])
    check("and the stop key sets nothing", ui.cover_key("$cover.stop.count"), [])
    ui.close()
    ui.open_keyboard(["keyboard", "schedule", "to"])
    ui.commit("1900")
    check("an end at 19:00 closes it, the opposite", rows(ui)[5 .. 6], [["End", "19:00", ["open", "eventTime", "to"]], ["At end", "Closed", ["schedule", "action", 8]]])
    var out = ui.action()
    check("saved, the ventilation from 10:00 and closed from 19:00", [out[0], sched.events()[0][7], sched.events()[0][8]], [["save"], "vent", 0])
end

def no_clock_and_no_editing()
    var h = house()
    var ui = h[0]
    h[3].now = nil
    var s = said(ui.act(["schedule", "open", T]))
    check("with no clock the list says so, and has no +", [s["$list.rows.0.label"], s["$list.actionIcon"], ui.action()], ["No clock yet", "", []])
    h[3].now = [WED, 570]
    h[1].put([nil, T, WED, 600, 660, nil, [], 210])
    ui.prefs["editing"] = false
    s = said(ui.show())
    check("with Editing off the events are only shown, and the schedule still switches on and off", [s["$list.actionIcon"], rows(ui)[1][2], rows(ui)[0][2], ui.action()],
          ["", nil, ["schedule", "toggle"], []])
    h[1].put([nil, T, WED, 360, 420, nil, [], 210])
    var labels = []
    for r: ui.list_view(["schedule", T])[2]  labels.push(r[2]) end
    check("the list in the order of the day, not the order made", labels, ["Schedule", "06:00-07:00", "10:00-11:00"])
    ui.store.register_device(["0x00124B0000A00009", "Plug 9", "plug", 1, 0, 0, "", 1, 0, 0])
    h[2].dev = "0x00124B0000A00009"
    h[2].draft = [nil, "0x00124B0000A00009", WED, 600, 660, nil, [], nil]
    check("a device in no zone has no zone to be for", h[2].view(["event"], true)[2][0][5], nil)
end

# the plan's style as the generator writes it, with every character 10 px wide
def calendar_style(wide)
    var adv = bytes()
    for i: 0 .. 223  adv.add(10, 1) end
    return {"origin": [0, 86], "area": wide ? [450, 234] : [320, 394], "radius": 8,
            "colors": {"page": 1, "card": 2, "label": 3, "iconOff": 4, "iconOn": 5, "pending": 6, "heating": 7, "secondary": 8},
            "fonts": {"icon": 3, "iconLarge": 4, "body": 0}, "advances": adv}
end

# the texts a drawing writes, and how many dots it has
def texts_of(ops)
    var out = []
    for o: ops
        if o[0] == "xstr"  out.push(o[11]) end
    end
    return out
end
def dots_of(ops)
    var n = 0
    for o: ops
        if o[0] == "cirs"  n += 1 end
    end
    return n
end

# the house's calendar
def the_calendar()
    var h = house()
    var ui = h[0]
    var sched = h[1]
    var screens = h[2]
    var rows = ui.list_view(["screens", "home"])[2]
    check("Screens ends with the house's calendar", [rows[size(rows) - 1][2], rows[size(rows) - 1][5]], ["Calendar", ["schedule", "calendar"]])
    var evening = sched.put([nil, T, WED - 2, 1080, 1380, [2, 1, 31, 0], [], 210])["value"]
    sched.put([nil, LAMP, WED, 420, 480, nil, [], [60, nil, 66]])
    var out = ui.act(["schedule", "calendar"])
    check("it opens on the plan's page, as the calendar, on this month", [ui.top()["view"], out[size(out) - 1], screens.title(), screens.action()],
          [["calendar"], ["calendar", screens], "October 2026", "add"])
    var st = calendar_style(true)
    var ops = screens.ops(st)
    var texts = texts_of(ops)
    check("the weekdays, the month's days, the day chosen and its events, in the order of the day",
          [texts[0 .. 6], texts[7], texts[37], texts[38 ..]],
          [["M", "T", "W", "T", "F", "S", "S"], "1", "31", ["Wed 07/10", "07:00 Corridor 1", "18:00 Thermostat 1"]])
    check("a dot for each kind on each day: the thermostat's 20 weekdays, and the lamp's on the 7th", dots_of(ops), 21)
    check("the day chosen filled, today itself", ops.find(["fill", 73, 148, 29, 29, 6]) != nil, true)
    # Friday the 9th: Thursday is the 1st, so the 9th is the second week's fifth day
    var L = PanelCalendarDraw.layout(st)
    check("the month beside its day's list on the EU", L, [0, 86, 35, 35, 257, 86, 193, 234])
    var fri = (L[0] + 4 * L[2] + 10) * 1000 + L[1] + 24 + L[3] + 10
    check("a day touched is chosen, and drawn again", [screens.tap(fri, st), screens.chosen], [[["calendar", screens]], WED + 2])
    check("today in its ring", size(texts_of(screens.ops(st))) > 0 && screens.ops(st).find(["fill", 71, 146, 33, 2, 6]) != nil, true)
    check("a touch on no day, before the 1st, is nothing", screens.tap((L[0] + 10) * 1000 + L[1] + 24 + 10, st), [])
    screens.tap((L[4] + 5) * 1000 + L[5] + 30 + 5, st)
    check("an event of the day touched opens", [ui.top()["view"], screens.draft[0]], [["event"], evening])
    ui.back()
    check("and its title goes back to the calendar", ui.top()["view"], ["calendar"])
    screens.swipe("left")
    check("a swipe to the left is the next month, from its first", [screens.title(), screens.chosen], ["November 2026", PanelClock.days_of(2026, 11, 1)])
    screens.swipe("right")
    check("to the right, back to this one, on today", [screens.title(), screens.chosen], ["October 2026", WED])
    for i: 1 .. 10  screens.swipe("right") end
    check("and over the year", screens.title(), "December 2025")
    check("a swipe up or down is not the calendar's", screens.swipe("up"), [])
    for i: 1 .. 3  screens.swipe("left") end
    check("and into the next", screens.title(), "March 2026")
    for i: 1 .. 7  screens.swipe("left") end
    for i: 1 .. 3  screens.swipe("left") end
    check("a December's next is January", screens.title(), "January 2027")
    for i: 1 .. 3  screens.swipe("right") end

    # the dots, three at most, in the kinds' tones; and a day with none says so
    var four = PanelCalendarDraw.month(st, 2026, 10, WED, WED, {1: ["thermostat", "light", "plug", "fan"]}, "Thu 01/10", [])
    var tones = []
    for o: four
        if o[0] == "cirs"  tones.push(o[4]) end
    end
    check("three dots at most, a thermostat warm, a lamp lit, the rest unlit", [tones, texts_of(four)[size(texts_of(four)) - 1]], [[7, 5, 4], "No events"])
    ui.prefs["editing"] = false
    check("with Editing off there is no +", screens.action(), "")
    ui.prefs["editing"] = true
    # the + asks who for: the zones, then the zone's groups and devices; a day other than today chosen first
    screens.tap(fri, st)
    for id: ui.store.find_zone("wall")["members"].keys()  ui.store.remove_device(id) end
    ui.action()
    var zones = rows_of(ui)
    var names = []
    for z: zones  names.push(z[0]) end
    check("the + asks which zone, of the ones with a device to schedule", [ui.top()["view"], zones[0], names.find("Wall")],
          [["calendarFor"], ["Hall", "5 devices", ["open", "calendarForZone", "hall"]], nil])
    ui.act(["open", "calendarForZone", "hall"])
    var who = rows_of(ui)
    check("its lamps as a group, then each device by its name", [who[0], who[1][0], who[5]],
          [["All lamps", "Zone", ["schedule", "pick", ["hall", "light", 1]]], "Hall 1", ["Thermostat 1", "", ["schedule", "pick", T]]])
    ui.act(["schedule", "pick", ["hall", "light", 1]])
    check("a new event for them, on the day chosen, over the calendar", [size(ui.stack), ui.top()["view"], screens.draft[1], screens.draft[2]],
          [2, ["event"], ["hall", "light", 1], WED + 2])
    out = ui.action()
    check("saved, back on the calendar", [out[0], ui.top()["view"], size(sched.events())], [["save"], ["calendar"], 3])
    check("which has it, on its day", texts_of(screens.ops(st))[38 ..], ["Fri 09/10", "10:00 Hall lamps", "18:00 Thermostat 1"])
    screens.tap((L[0] + 2 * L[2] + 10) * 1000 + L[1] + 24 + L[3] + 10, st)

    # the US: the list under the month, and a day with more events than it holds
    var us = calendar_style(false)
    check("the month over its day's list on the US", PanelCalendarDraw.layout(us), [0, 86, 45, 36, 15, 332, 290, 148])
    for i: 2 .. 5  sched.put([nil, "0x00124B0000C0000" + str(i), WED, 420, 480, nil, [], nil]) end
    texts = texts_of(screens.ops(us))
    check("what does not fit says how many more", texts[38 ..], ["Wed 07/10", "07:00 Corridor 1", "07:00 Corridor 2", "+4 more"])
    check("and a touch on it opens none", screens.tap(20 * 1000 + 332 + 90 + 5, us), [])
    h[3].now = nil
    check("with no clock, it says so, and has no +", [texts_of(screens.ops(st)), screens.title(), screens.action(), screens.tap(fri, st), ui.action()],
          [["No clock yet"], "Calendar", "", [], []])
end

# the Schedule of a thermostat's page, an icon of the row under its title
def the_row()
    var h = house()
    var ui = h[0]
    var sched = h[1]
    var s = said(ui.open(["thermostat", "d", T]))
    check("a thermostat's page: the Settings and the Schedule icons and its card, the Schedule unlit with no event, and no clock in the header",
          [s["page"], s["$thermostat.icons.0.icon"], s["$thermostat.icons.1.icon"], s["$thermostat.icons.1.iconColor"], s["$thermostat.card.label"],
           s.contains("$thermostat.actionIcon")],
          ["thermostat", "settings", "schedule", "text-primary", "Hall", false])
    s = said(ui.page_icon(1))
    check("its Schedule opens the thermostat's schedule, with no On or Off while it has no event",
          [ui.top()["view"], s["$list.title"], s["$list.actionIcon"], rows(ui)[0][0]], [["schedule", T], "Schedule", "add", "No events"])
    ui.back()
    sched.put([nil, T, WED, 1080, 1380, [2, 1, 31, 0], [], 210])
    s = said(ui.show())
    check("with one, the Schedule lit: its schedule is on", s["$thermostat.icons.1.iconColor"], "accent-blue")
    ui.page_icon(1)
    check("its list's first row says so, and its touch is the switch", rows(ui)[0], ["Schedule", "On", ["schedule", "toggle"]])
    var out = ui.act(["schedule", "toggle"])
    check("a touch turns its schedule off, saved, and the row says it", [out[0], sched.is_off(T), rows(ui)[0][1]], [["save"], true, "Off"])
    check("its mode is not touched", size(ui.unconfirmed), 0)
    ui.back()
    s = said(ui.show())
    check("and the page's Schedule is unlit", s["$thermostat.icons.1.iconColor"], "text-primary")
    ui.page_icon(1)
    ui.act(["schedule", "toggle"])
    check("and on again", sched.is_off(T), false)
    ui.back()
    ui.back()
    s = said(ui.open(["thermostat", "t", "hall", 0]))
    check("the Hall's joint page: the Settings, which is the zone's Tap, and the Schedule, lit, against its card",
          [s["$thermostat.icons.0.icon"], s["$thermostat.icons.1.icon"], s["$thermostat.icons.1.iconColor"], s["$thermostat.card.label"]], ["settings", "schedule", "accent-blue", "Hall"])
    s = said(ui.page_icon(1))
    check("its Schedule opens the group's, where the thermostat's own evening is not", [ui.top()["view"], s["$list.rows.1.label"]],
          [["schedule", ["hall", "thermostat", 0]], "No events"])
    ui.action()
    check("and its + makes an event for the group, which For says and does not change", [h[2].draft[1], rows(ui)[0]],
          [["hall", "thermostat", 0], ["For", "Zone", nil]])
    ui.back()
    ui.back()
    ui.back()
    ui.act(["schedule", "open", T])
    ui.act(["schedule", "edit", sched.events()[0][0]])
    s = said(ui.act(["schedule", "action", 7]))
    check("the page for an event has no row", [s["$thermostat.icons.0.shown"], s["$thermostat.icons.1.shown"], s["$thermostat.card.shown"]], [0, 0, 0])
    ui.schedule = nil
    ui.back()
    ui.back()
    ui.back()
    s = said(ui.open(["thermostat", "d", T]))
    check("with no schedule at all, the row has no Schedule", [s["$thermostat.icons.0.shown"], s["$thermostat.icons.1.icon"], s["$thermostat.card.label"]],
          [0, "settings", "Hall"])
end

# and on the lamp's detail, alone and of a zone's group
def the_lamps_row()
    var h = house()
    var ui = h[0]
    var sched = h[1]
    var s = said(ui.open(["detail", "d", LAMP]))
    check("a lamp's detail: the Identify, the Settings and the Schedule icons against its card, the Schedule unlit with no event",
          [s["page"], s["$light.icons.0.icon"], s["$light.icons.1.icon"], s["$light.icons.2.icon"], s["$light.icons.2.iconColor"], s["$light.card.label"]],
          ["lightdetail", "identify", "settings", "schedule", "text-primary", "Corridor"])
    ui.page_icon(2)
    check("its Schedule opens the lamp's schedule", ui.top()["view"], ["schedule", LAMP])
    ui.action()
    ui.action()
    ui.back()
    s = said(ui.show())
    check("an event made there lights it", [size(sched.events_of(LAMP)), s["$light.icons.2.iconColor"]], [1, "accent-blue"])
    ui.page_icon(2)
    ui.act(["schedule", "toggle"])
    check("its list's first row switches the lamp's schedule off", sched.is_off(LAMP), true)
    ui.back()
    ui.back()
    s = said(ui.open(["detail", "t", "corridor", "light", 2]))
    check("the Corridor's joint detail: Identify, Settings, the Schedule unlit, its one lamp with an event having its schedule off, and the card",
          [s["$light.icons.0.icon"], s["$light.icons.1.icon"], s["$light.icons.2.iconColor"], s["$light.card.label"]], ["identify", "settings", "text-primary", "Corridor"])
    ui.page_icon(2)
    check("its Schedule opens the Corridor's lamps' schedule", ui.top()["view"], ["schedule", ["corridor", "light", 2]])
    ui.act(["schedule", "toggle"])
    check("whose first row turns on every one with an event", sched.is_off(LAMP), false)
    ui.back()
    ui.back()
    ui.act(["schedule", "open", LAMP])
    ui.act(["schedule", "edit", sched.events_of(LAMP)[0][0]])
    ui.act(["schedule", "action", 7])
    s = said(ui.act(["schedule", "levels"]))
    check("the detail for an event has no row", [s["$light.icons.2.shown"], s["$light.card.shown"]], [0, 0])
end

# A Replace of a lamp by a thermostat, from the glass: the lamp's events go to the thermostat with the levels of a lamp, which are no target
# for it, and what the engine could not run is taken out with the Replace, with the thermostat's own staying
def a_replace_that_changes_the_kind()
    var h = house()
    var ui = h[0]
    var sched = h[1]
    var lamp_event = sched.put([nil, LAMP, WED + 1, 600, 660, nil, nil, [60, nil, 66], nil])["value"]
    var own = sched.put([nil, T, WED + 1, 800, 860, nil, nil, 210, "off"])["value"]
    var other = sched.put([nil, "0x00124B0000C00002", WED + 1, 600, 660, nil, nil, [60, nil, 66], nil])["value"]
    var fresh = "0x00124B0000B00009"
    ui.act(["replace", LAMP])
    ui.list_row(0, 0, false)
    ui.pair_announced(fresh)
    var out = ui.pair_described(fresh, {"kind": "thermostat", "caps": 48, "min": 50, "max": 350, "model": "TS0601", "ep": 1})
    var kept = []
    for e: sched.events()  kept.push(e[0]) end
    check("the thermostat took the lamp's place, and the lamp's event did not come with it: the thermostat's own and another lamp's stay",
          [ui.store.find_device(LAMP), ui.store.find_device(fresh)[2], kept], [nil, "thermostat", [own, other]])
    check("and the save is among what the Replace asks for", out[0], ["save"])
    check("what is left is sound", [sched.sweep(), ui.store.validate()], [false, []])

    # a lamp replaced by a lamp keeps its events, now the new one's
    var again = sched.put([nil, "0x00124B0000C00002", WED + 3, 600, 660, nil, nil, [40, nil, nil], nil])["value"]
    var twin = "0x00124B0000C0AAAA"
    ui.act(["replace", "0x00124B0000C00002"])
    ui.list_row(0, 0, false)
    ui.pair_announced(twin)
    ui.pair_described(twin, {"kind": "light", "caps": 15, "min": 153, "max": 500, "model": "CK-BL702-AL-01", "ep": 1})
    check("a lamp for a lamp: its events are the new one's, both", [sched.find(other)[1], sched.find(again)[1]], [twin, twin])
end

words()
a_thermostats_evening()
the_sun_and_the_day()
a_lamps_levels()
a_blinds_event()
no_clock_and_no_editing()
the_calendar()
the_row()
the_lamps_row()
a_replace_that_changes_the_kind()

if failures > 0
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
else
    print("ok - " + str(checks) + " checks")
end
