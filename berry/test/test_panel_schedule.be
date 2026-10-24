# berry/panel_schedule.be: the schedule's model, rules and operations, on the Living room's store with a
# thermostat in the Hall, and the house's place, São Paulo, for the sun.

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

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

# the clock's place and time zone, as PanelClock keeps them: São Paulo, in Brasília's time
class FakeClock
    var lat, lon, tz, now
    def init() self.lat = -235505 self.lon = -466333 self.tz = -3 end
    def today() return self.now end
end

# the week of 2026-10-05, a Monday: 20731 days since 1970
var MON = 20731
var WED = MON + 2
var SAT = MON + 5
var WEEKDAYS = 31
var WEEKENDS = 96
var T = "0x00124B0000B00001"
var LAMP = "0x00124B0000C00001"
var RISE = PanelSchedule.SUNRISE
var SET = PanelSchedule.SUNSET

def living_room()
    var store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    store.register_device([T, "Thermostat 1", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    store.register_device(["0x00124B0000A00001", "Sensor 1", "sensor", 0, 0, 0, "", 1, 0, 0])
    store.add_to_zone("hall", T)
    store.add_to_zone("hall", "0x00124B0000A00001")
    return store
end

# an event as the screens make one: new, nothing deleted
def ev(f, day, from, to, rule, during) return [nil, f, day, from, to, rule, nil, during] end

def times()
    var ok = []
    for t: [0, 1439, 1440, -1, RISE, RISE - 120, RISE + 120, RISE - 135, RISE + 5, SET, SET - 120, SET + 120, SET + 135, 3000, "6", nil]
        ok.push(PanelSchedule.time_ok(t))
    end
    check("the times an event takes: a minute of the day, or the sun within two hours in steps of 15 minutes", ok,
          [true, true, false, false, true, true, true, false, false, true, true, true, false, false, false, false])
end

def repeating()
    var r = PanelSchedule.ruled
    check("every other day", [r([1, 2, 0, 0], MON, MON), r([1, 2, 0, 0], MON, MON + 1), r([1, 2, 0, 0], MON, MON + 2)], [true, false, true])
    check("on weekdays", [r([2, 1, WEEKDAYS, 0], MON, SAT), r([2, 1, WEEKDAYS, 0], MON, MON + 7), r([2, 1, WEEKDAYS, 0], MON, WED)],
          [false, true, true])
    var two = [2, 2, 5, 0]
    check("Mondays and Wednesdays every other week, the weeks counted from the first's",
          [r(two, WED, WED), r(two, WED, MON + 7), r(two, WED, WED + 7), r(two, WED, MON + 14), r(two, WED, WED + 14)],
          [true, false, false, true, true])
    var jan31 = PanelClock.days_of(2026, 1, 31)
    check("monthly on the 31st skips the months without one", [r([3, 1, 0, 0], jan31, PanelClock.days_of(2026, 2, 28)),
          r([3, 1, 0, 0], jan31, PanelClock.days_of(2026, 3, 31)), r([3, 1, 0, 0], jan31, PanelClock.days_of(2026, 4, 30))], [false, true, false])
    var leap = PanelClock.days_of(2028, 2, 29)
    check("yearly on the 29th of February, in leap years only", [r([4, 1, 0, 0], leap, PanelClock.days_of(2029, 2, 28)),
          r([4, 1, 0, 0], leap, PanelClock.days_of(2032, 2, 29))], [false, true])
    check("up to its last day", [r([1, 1, 0, MON + 3], MON, MON + 3), r([1, 1, 0, MON + 3], MON, MON + 4)], [true, false])
    var e = [nil, T, MON, 600, 660, [1, 1, 0, 0], [WED], 210]
    check("an occurrence deleted is not one, and none before the first", [PanelSchedule.occurs(e, WED), PanelSchedule.occurs(e, MON + 3),
          PanelSchedule.occurs(e, MON - 1)], [false, true, false])
    check("one that does not repeat is its day", [PanelSchedule.occurs([nil, T, WED, 600, 660, nil, [], 210], WED),
          PanelSchedule.occurs([nil, T, WED, 600, 660, nil, [], 210], WED + 7)], [true, false])
end

def normals()
    var n = PanelSchedule.normal([nil, T, SAT, 600, 660, [2, 1, WEEKDAYS, 0], [SAT, MON + 8, MON + 8, MON + 7], 210])
    check("a weekday event saved on a Saturday starts on Monday, with the days deleted from it on, once each", [n[2], n[6]],
          [MON + 7, [MON + 8, MON + 7]])
    check("a weekly one that names no day takes its first's", PanelSchedule.normal(ev(T, WED, 600, 660, [2, 1, 0, 0], 210))[5], [2, 1, 4, 0])
    check("and one with no occurrence before its end is none", PanelSchedule.normal(ev(T, SAT, 600, 660, [2, 1, WEEKDAYS, SAT + 1], 210)), nil)
    var given = ev(LAMP, WED, 600, 660, [1, 1, 0, 0], [60, nil, 66])
    var kept = PanelSchedule.normal(given)
    kept[5][3] = WED
    kept[7][0] = 10
    check("the document keeps a copy", [given[5][3], given[7][0]], [0, 60])
end

def spans()
    var s = PanelSchedule(living_room(), FakeClock())
    var sun = PanelClock.sun(WED, -235505, -466333, -3)
    var next = PanelClock.sun(WED + 1, -235505, -466333, -3)
    check("a fixed time that ends before it starts ends the next day", s.span(ev(T, WED, 1320, 360, nil, 210), WED), [1320, 1800])
    check("half an hour before the sunset to 23:00", s.span(ev(T, WED, SET - 30, 1380, nil, 210), WED), [sun[1] - 30, 1380])
    check("from the sunset to the next day's sunrise", s.span(ev(T, WED, SET, RISE, nil, 210), WED), [sun[1], next[0] + 1440])
    check("to the minute the sun sets that day: a whole day, to the next day's", s.span(ev(T, WED, SET, sun[1], nil, 210), WED),
          [sun[1], sun[1] + 1440])
    check("São Paulo's sun that day, as the clock works it out", [sun[0] > 300 && sun[0] < 360, sun[1] > 1080 && sun[1] < 1140], [true, true])
    s.clock.lat = nil
    s.suns = nil
    check("and no sun without the place", s.span(ev(T, WED, SET, 1380, nil, 210), WED), nil)
end

def saving()
    var store = living_room()
    var s = PanelSchedule(store, FakeClock())
    var seq = store.doc["seq"]
    var r = s.put(ev(T, MON, 1080, 1380, [2, 1, WEEKDAYS, 0], 210))
    check("a thermostat's evenings on weekdays, saved", r, {"ok": true, "value": "e" + str(seq), "actions": []})
    var e1 = r["value"]
    check("in the document, its end off as an event of eight fields is", store.doc["events"], [[e1, T, MON, 1080, 1380, [2, 1, WEEKDAYS, 0], [], 210, "off"]])
    var refused = []
    for e: [ev("0x00124B0000FFFFFF", MON, 600, 660, nil, nil), ev(["nowhere", "light", 2], MON, 600, 660, nil, nil),
            ev("0x00124B0000A00001", MON, 600, 660, nil, nil), ev(["hall", "thermostat", 2], MON, 600, 660, nil, 210),
            ev(T, MON, 600, 1440, nil, 210), ev(T, MON, 600, 600, nil, 210), ev(T, MON, 600, 660, [5, 1, 0, 0], 210),
            ev(T, MON, 600, 660, [1, 1, 3, 0], 210), ev(T, MON, 600, 660, [1, 100, 0, 0], 210), ev(T, MON, 600, 660, nil, nil), ev(T, MON, 600, 660, nil, 20),
            ev(LAMP, MON, 600, 660, nil, [50, 30, 40]), ev(LAMP, MON, 600, 660, nil, [0, nil, nil]), ev("relay:1", MON, 600, 660, nil, 210),
            ev(T, MON, 600, 660, nil, "21"), [nil, T, MON], [nil, T, "today", 600, 660, nil, nil, 210],
            [nil, T, MON, 600, 660, nil, ["x"], 210], ["e999", T, MON, 600, 660, nil, nil, 210]]
        refused.push(s.put(e).find("refusal", "accepted"))
    end
    check("what an event cannot be", refused, ["no_such_device", "no_such_zone", "no_schedule", "no_devices", "bad_time", "same_time",
          "bad_rule", "bad_rule", "bad_rule", "bad_during", "bad_during", "bad_during", "bad_during", "bad_during", "bad_during", "bad_event",
          "bad_event", "bad_skip", "no_such_event"])
    check("none of it saved", size(store.doc["events"]), 1)
    s.clock.lat = nil
    check("the sun needs the house's place", s.put(ev(T, MON, SET, 1380, nil, 210))["refusal"], "no_location")
    s.clock.lat = -235505

    # no device with two events at once
    r = s.put(ev(["hall", "thermostat", 0], MON, 1080, 1380, [2, 1, WEEKENDS, 0], 200))
    check("the Hall's thermostats on weekend evenings: the same hours, other days", r["ok"], true)
    var e2 = r["value"]
    check("an evening of one Saturday overlaps the Hall's", s.put(ev(T, SAT + 7, 1200, 1260, nil, 215)),
          {"ok": false, "refusal": "overlap", "detail": [e2, T, SAT + 7]})
    r = s.put(ev(T, MON, 1380, 360, [1, 1, 0, 0], 180))
    check("the nights from 23:00, as the evenings end, overlap nothing", r["ok"], true)
    var e3 = r["value"]
    check("an early morning overlaps the night before", s.put(ev(T, WED + 7, 300, 420, nil, 215))["detail"], [e3, T, WED + 7])
    check("so does an evening that runs on past 23:00", s.put([e1, T, MON, 1080, 1410, [2, 1, WEEKDAYS, 0], nil, 210])["detail"], [e3, T, MON])
    check("an event changed overlaps no one by itself", s.put([e1, T, MON, 1050, 1380, [2, 1, WEEKDAYS, 0], nil, 215])["ok"], true)
    check("on a day of the night's deleted, the morning is free", s.skip(e3, WED + 6)["ok"] && s.put(ev(T, WED + 7, 300, 420, nil, 215))["ok"], true)
    r = s.put(ev(["corridor", "light", 2], MON, SET - 30, 1380, [1, 1, 0, 0], [60, nil, 66]))
    check("the Corridor's lamps from half an hour before the sunset", r["ok"], true)
    check("one of them overlaps it at 22:00", s.put(ev(LAMP, WED, 1320, 1410, nil, [100, 20, nil]))["detail"], [r["value"], LAMP, WED])
    check("and from 23:00, as the zone's evening ends", s.put(ev(LAMP, WED, 1380, 1410, nil, nil))["ok"], true)
    check("and is free in the morning", s.put(ev(LAMP, WED, 420, 480, nil, nil))["ok"], true)
    check("the devices an event is for, the zone's as its joint page", s.devices_of(["hall", "thermostat", 0]), [T])
    var uids = []
    for e: s.events_of(T) uids.push(e[0]) end
    check("and the events of one, its own and its zone's", uids, [e1, e2, e3, store.doc["events"][3][0]])

    # at most 32
    var n = size(store.doc["events"])
    var last = nil
    while n <= PanelSchedule.MAX
        last = s.put(ev("relay:2", MON + 100 + n, 600, 660, nil, nil))
        n += 1
    end
    check("the 33rd event is refused", [last["refusal"], size(store.doc["events"])], ["too_many", PanelSchedule.MAX])
    check("and the store still holds the document valid", store.validate(), [])
end

def operations()
    var store = living_room()
    var s = PanelSchedule(store, FakeClock())
    var e1 = s.put(ev(T, MON, 1080, 1380, [2, 1, WEEKDAYS, 0], 210))["value"]
    var e2 = s.put(ev(LAMP, WED, 600, 660, nil, nil))["value"]
    check("an occurrence deleted", [s.skip(e1, WED)["ok"], s.find(e1)[6]], [true, [WED]])
    check("only an occurrence can be", s.skip(e1, SAT)["refusal"], "no_occurrence")
    check("the only one of an event deletes it", [s.skip(e2, WED)["ok"], s.find(e2)], [true, nil])
    s.skip(e1, WED + 9)
    check("this one and the ones after it: the rule ends the day before", [s.end_before(e1, WED + 7)["ok"], s.find(e1)[5], s.find(e1)[6]],
          [true, [2, 1, WEEKDAYS, WED + 6], [WED]])
    check("from the first, all of them", [s.end_before(e1, MON)["ok"], s.find(e1)], [true, nil])
    check("an event that is not", [s.delete("e1")["refusal"], s.skip("e1", MON)["refusal"], s.end_before("e1", MON)["refusal"]],
          ["no_such_event", "no_such_event", "no_such_event"])
    check("a device's schedule switched off, and on", [s.set_off(T, true)["ok"], s.is_off(T), s.set_off(T, true)["ok"],
          store.doc["scheduleOff"], s.set_off(T, false)["ok"], s.is_off(T)], [true, true, true, [T], true, false])
    check("of a device there is", s.set_off("0x00124B0000FFFFFF", true)["refusal"], "no_such_device")
end

# what the store does with the events of what it changes
def with_the_store()
    var store = living_room()
    var s = PanelSchedule(store, FakeClock())
    var own = s.put(ev(T, MON, 1080, 1380, [2, 1, WEEKDAYS, 0], 210))["value"]
    var zone = s.put(ev(["hall", "thermostat", 0], MON, 600, 660, [1, 1, 0, 0], 200))["value"]
    var lamp = s.put(ev(LAMP, WED, 600, 660, nil, nil))["value"]
    var lamps = s.put(ev(["corridor", "light", 2], WED, 1200, 1260, nil, [40, nil, nil]))["value"]
    s.set_off(T, true)
    s.set_off(LAMP, true)
    var NEW = "0x00124B0000C00009"
    store.replace_device(LAMP, [NEW, "", "light", 15, 153, 500, "CK-BL702-AL-01", 1, 1, 0])
    check("a lamp replaced: its events and its switch are the new one's", [s.find(lamp)[1], store.doc["scheduleOff"]], [NEW, [T, NEW]])
    store.set_relay(T, 2)
    check("a thermostat put on a relay: the Hall's thermostats with none keep their event, for none", [s.find(zone) != nil, s.devices_of(["hall", "thermostat", 0])],
          [true, []])
    store.set_relay(T, 0)
    store.remove_device("relay:2")
    check("another device removed leaves it be", s.find(zone) != nil, true)
    store.remove_device(T)
    check("removed: its own event goes, and the Hall's left with no thermostat", [s.find(own), s.find(zone), store.doc["scheduleOff"]],
          [nil, nil, [NEW]])
    store.delete_zone("corridor")
    check("the Corridor deleted: its lamps' events go with it", [s.find(lamp), s.find(lamps), store.doc["scheduleOff"], store.doc["events"]],
          [nil, nil, [], []])
    check("and the document is valid", store.validate(), [])
    store.doc["events"] = [["e1", T, MON, 600, 660, nil, [], 210], ["e1", ["gone", "light", 1], MON, 600, 660, nil, [], nil], ["e3"]]
    check("validate sees an event for nothing, one twice, and one that is not", store.validate(),
          [["event_for", "e1"], ["event_bad", "['e1', ['gone', 'light', 1], 20731, 600, 660, nil, [], nil]"], ["event_bad", "['e3']"]])
end

def icalendar()
    check("weekdays as an RRULE", PanelSchedule.rrule([2, 1, WEEKDAYS, 0], -3), "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")
    var dec31 = PanelClock.days_of(2026, 12, 31)
    check("every other day to the last second of the 31st of December in Brasília, in UTC",
          PanelSchedule.rrule([1, 2, 0, dec31], -3), "FREQ=DAILY;INTERVAL=2;UNTIL=20270101T025959Z")
    check("and nothing for an event that does not repeat", PanelSchedule.rrule(nil, -3), nil)
    var p = / t -> PanelSchedule.parse_rrule(t, MON, 1080, -3)
    check("the RRULEs Home Assistant's event screen writes", [p("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"), p("FREQ=WEEKLY;INTERVAL=2;BYDAY=SA,SU;WKST=MO"),
          p("FREQ=DAILY"), p("freq=yearly"), p("FREQ=MONTHLY;BYMONTHDAY=5"), p("FREQ=WEEKLY")],
          [[2, 1, WEEKDAYS, 0], [2, 2, WEEKENDS, 0], [1, 1, 0, 0], [4, 1, 0, 0], [3, 1, 0, 0], [2, 1, 1, 0]])
    check("a COUNT is the day it reaches", [p("FREQ=DAILY;COUNT=3"), p("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3"), p("FREQ=YEARLY;COUNT=2")],
          [[1, 1, 0, MON + 2], [2, 1, 5, MON + 7], [4, 1, 0, PanelClock.days_of(2027, 10, 5)]])
    check("an UNTIL is the last day an occurrence starts on", [p("FREQ=DAILY;UNTIL=20261231"), p("FREQ=DAILY;UNTIL=20261231T200000Z"),
          p("FREQ=DAILY;UNTIL=20261231T235959Z"), p("FREQ=DAILY;UNTIL=20270101T010000Z"), p("FREQ=DAILY;UNTIL=20261231T180000")],
          [[1, 1, 0, dec31], [1, 1, 0, dec31 - 1], [1, 1, 0, dec31], [1, 1, 0, dec31], [1, 1, 0, dec31]])
    var none = []
    for t: ["FREQ=MONTHLY;BYDAY=1MO", "FREQ=HOURLY", "FREQ=DAILY;COUNT=2;UNTIL=20261231", "FREQ=WEEKLY;BYSETPOS=1", "", "FREQ=DAILY;INTERVAL=0",
            "FREQ=MONTHLY;BYMONTHDAY=6", "FREQ=DAILY;BYDAY=MO", "FREQ=DAILY;UNTIL=2026123", "FREQ=DAILY;UNTIL=20261331", "FREQ=WEEKLY;WKST=SU",
            "FREQ=DAILY;COUNT=0", "INTERVAL=2", "FREQ=DAILY;UNTIL=20261231X200000Z", nil]
        none.push(p(t))
    end
    check("and what the panel does not run", none, [nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil])
    var r = [2, 3, 6, dec31]
    check("one back and forth", PanelSchedule.parse_rrule(PanelSchedule.rrule(r, -3), MON, 1080, -3), r)
    check("iCalendar's time", PanelSchedule.stamp(0), "19700101T000000Z")
end

# what the engine reads of the screens: the devices' word and the relays
class FakeUi
    var live, doubt, unconfirmed, relay_on
    def init() self.live = {} self.doubt = {} self.unconfirmed = {} self.relay_on = [true, true] end
end

# the minute that turns, the starts and the ends, by the screens' commands
def engine()
    var store = living_room()
    var clock = FakeClock()
    var s = PanelSchedule(store, clock)
    var ui = FakeUi()
    s.ui = ui
    var at = def (day, minute) clock.now = [day, minute] return s.tick() end
    check("no clock, nothing", [s.tick(), s.last], [[], nil])
    var evening = s.put(ev(T, MON, 1080, 1380, [2, 1, WEEKDAYS, 0], 210))["value"]
    var night = s.put(ev(T, MON, 1380, 360, [1, 1, 0, 0], 180))["value"]
    check("the first minute is the one the clock is at", [at(WED, 1078), s.last], [[], WED * 1440 + 1078])
    var heat = [["thermostat", [T], "mode", "heat"], ["thermostat", [T], "target", 210]]
    check("18:00 on a Wednesday: the evening starts, as the thermostat's page would put it", at(WED, 1080), heat)
    check("once a minute", at(WED, 1080), [])
    check("with no word from the thermostat, tried again the next minute", at(WED, 1081), heat)
    ui.live[T] = "on"
    check("and not once it says it heats", [at(WED, 1082), s.wants.contains(T)], [[], false])
    check("23:00: the evening ends, and then the night starts", at(WED, 1380),
          [["thermostat", [T], "mode", "off"], ["thermostat", [T], "mode", "heat"], ["thermostat", [T], "target", 180]])
    ui.live[T] = "on"
    check("06:00 the next day: the night ends", at(WED + 1, 360), [["thermostat", [T], "mode", "off"]])
    ui.live[T] = "off"
    check("a target beyond the thermostat's range goes to its end", s.effects(ev(T, WED, 600, 660, nil, 400), [T], 400, false)[1], ["thermostat", [T], "target", 350])

    # a lamp, to the levels of its sliders
    var lamp = s.put(ev(LAMP, WED + 1, 362, 420, nil, [60, nil, 66]))["value"]
    var r = ui.relay_on
    var on = [["command", store.device_plan(LAMP, r), "on", [LAMP]], ["level", store.cap_plan(LAMP, "", 0, PanelStore.CAP_LEVEL, r), "Dimmer", 149, "now"],
              ["level", store.cap_plan(LAMP, "", 0, PanelStore.CAP_COLOR, r), "Hue", 167, "now"]]
    check("a late minute makes up the ones it missed: the lamp on at 60% and blue", at(WED + 1, 364), on)
    s.touched([LAMP])
    check("another's command to it is the last word: no try again", at(WED + 1, 365), [])
    ui.relay_on[1] = false
    check("behind a relay held open, it is left out", [at(WED + 1, 420), s.wants.contains(LAMP)], [[], false])
    ui.relay_on[1] = true

    # the clock that jumps
    s.put(ev(LAMP, WED + 2, 600, 660, nil, nil))
    at(WED + 2, 590)
    check("a clock that jumps past a start, more than five minutes, does not fire it", at(WED + 2, 606), [])
    check("one set back fires nothing", [at(WED + 2, 590), s.last], [[], (WED + 2) * 1440 + 590])
    at(WED + 2, 599)
    check("and the minute comes again", size(at(WED + 2, 600)), 1)
    ui.live[LAMP] = "off"
    var tries = 0
    for m: 601 .. 640
        tries += size(at(WED + 2, m))
    end
    check("tried again for 15 minutes, no more", tries, 15)
    ui.live[LAMP] = "on"
    var said = s.state(LAMP)
    ui.doubt[LAMP] = true
    check("a lamp that says it is on is, and with no communication it is not known", [said, s.state(LAMP)], [true, nil])

    # a zone's devices: by its group, and each by itself when one has its schedule off
    var zone = s.put(ev(["corridor", "light", 2], WED + 3, 1200, 1260, nil, [40, nil, nil]))["value"]
    var ids = store.group_of(["corridor", "light", 2])
    check("the Corridor's lamps by their group", at(WED + 3, 1200), [["command", store.group_plan("corridor", "light", 2, r), "on", ids],
          ["level", store.cap_plan("corridor", "light", 2, PanelStore.CAP_LEVEL, r), "Dimmer", 104, "now"]])
    s.set_off(LAMP, true)
    var out = at(WED + 3, 1260)
    var told = []
    for x: out told.push(x[3]) end
    check("one with its schedule off: the others each by itself, and not it", [size(out), told.find([LAMP]), told[0]], [7, nil, [ids[1]]])
    s.set_off(LAMP, false)
    check("a relay device by its relay, as its row", s.effects(ev("relay:2", WED, 600, 660, nil, nil), ["relay:2"], nil, false),
          [["command", store.device_plan("relay:2", r), "on", []]])
    check("its relay, which only the Hall's lamps hang on, and on", [store.device_plan("relay:2", r)["relays"], s.state("relay:2")], [[1], true])
    store.find_device(ids[0])[4] = 400
    store.find_device(ids[1])[5] = 300
    check("a white the lamps share no range of is not sent", s.effects(ev(["corridor", "light", 2], WED, 600, 660, nil, [nil, 50, nil]), ids, [nil, 50, nil], true),
          [["command", store.group_plan("corridor", "light", 2, r), "on", ids]])
    check("a white is the lamps' own range", s.effects(ev(LAMP, WED, 600, 660, nil, [nil, 100, nil]), [LAMP], [nil, 100, nil], false)[1],
          ["level", store.cap_plan(LAMP, "", 0, PanelStore.CAP_CT, r), "CT", 500, "now"])
end

# The start and the end, each with its action: an event with no end acts at its start and no more; an
# end does what it says from then on, the start's opposite when it was set; off is an action, at the start too; a blind
# goes to its place or its ventilation; and nothing of a device overlaps another of its own, an instant included
def starts_and_ends()
    var store = living_room()
    var clock = FakeClock()
    var s = PanelSchedule(store, clock)
    var ui = FakeUi()
    s.ui = ui
    var at = def (day, minute) clock.now = [day, minute] return s.tick() end
    var instant = [nil, T, WED, 360, nil, nil, nil, 215, nil]
    var r = s.put(instant)
    check("an event with no end, kept with none", [r["ok"], store.doc["events"][0][4], store.doc["events"][0][8]], [true, nil, nil])
    at(WED, 358)
    check("06:00: it heats to 21.5", at(WED, 360), [["thermostat", [T], "mode", "heat"], ["thermostat", [T], "target", 215]])
    ui.live[T] = "on"
    var later = []
    for m: 361 .. 365  later += at(WED, m) end
    check("and nothing after it, no end", later, [])
    # overlaps: an instant inside an event with an end, at its start, and two instants at one minute; one at the end is not
    var morning = s.put([nil, T, WED + 1, 360, 480, nil, nil, 215, 170])["value"]
    check("an instant at 07:00 inside 06:00 to 08:00 is refused", s.put([nil, T, WED + 1, 420, nil, nil, nil, 200, nil])["refusal"], "overlap")
    check("and one at 06:00, the start's minute", s.put([nil, T, WED + 1, 360, nil, nil, nil, 200, nil])["refusal"], "overlap")
    check("one at 08:00, as the event ends, is not", s.put([nil, T, WED + 1, 480, nil, nil, nil, "off", nil])["ok"], true)
    check("nor is another at 06:00 on another day, but two at one minute are", [s.put([nil, T, WED + 2, 360, nil, nil, nil, 200, nil])["ok"],
          s.put([nil, T, WED, 360, nil, nil, nil, 200, nil])["refusal"]], [true, "overlap"])
    # an end with its own action: 17.0 from 08:00, and not off
    ui.live[T] = "off"
    at(WED + 1, 358)
    at(WED + 1, 360)
    ui.live[T] = "on"
    at(WED + 1, 478)
    check("08:00: the end's 17.0, then the instant's off at the same minute, ends first and starts after", at(WED + 1, 480),
          [["thermostat", [T], "mode", "heat"], ["thermostat", [T], "target", 170], ["thermostat", [T], "mode", "off"]])
    # off at the start: the lamps out at midnight
    s.put([nil, LAMP, WED + 3, 0, nil, nil, nil, "off", nil])
    ui.live[LAMP] = "on"
    at(WED + 2, 1438)
    check("00:00: a lamp off, an event's start", at(WED + 3, 0), [["command", store.device_plan(LAMP, ui.relay_on), "off", [LAMP]]])
    # what an end comes as, and the bad ones
    check("the opposite of on is off, of off on, a thermostat at its target, a blind up or down",
          [PanelSchedule.opposite("light", nil, nil), PanelSchedule.opposite("light", "off", nil), PanelSchedule.opposite("thermostat", "off", 210),
           PanelSchedule.opposite("thermostat", 210, 210), PanelSchedule.opposite("cover", 100, nil), PanelSchedule.opposite("cover", "vent", nil),
           PanelSchedule.opposite("cover", 0, nil)], ["off", nil, 210, "off", 0, 0, 100])
    check("an end a kind's screen could not make is refused", s.put([nil, LAMP, WED + 5, 600, 660, nil, nil, nil, 20])["refusal"], "bad_during")
    # an event of eight fields, from before: it ends off
    store.doc["events"].push(["e99", LAMP, WED + 6, 600, 660, nil, [], nil])
    at(WED + 6, 598)
    at(WED + 6, 600)
    ui.live[LAMP] = "on"
    check("an event from before ends off, as it did", at(WED + 6, 660), [["command", store.device_plan(LAMP, ui.relay_on), "off", [LAMP]]])
end

# a blind, by its schedule: its place, all the way up or down, and its ventilation, each blind its own
def blinds()
    var store = living_room()
    var s = PanelSchedule(store, FakeClock())
    s.ui = FakeUi()
    var CV = "0x00124B0000C10001"
    var CV2 = "0x00124B0000C10002"
    store.register_device([CV, "Cover 1", "cover", 64, 30, 0, "TS0601", 1, 0, 0])
    store.register_device([CV2, "Cover 2", "cover", 64, 0, 0, "TS0601", 1, 0, 0])
    store.add_to_zone("hall", CV)
    store.add_to_zone("hall", CV2)
    check("a blind open from 07:00, with no end", s.put([nil, CV, WED, 420, nil, nil, nil, 100, nil])["ok"], true)
    check("and its actions: a place, the ventilation, off; not a place past 100", [PanelSchedule.during_ok("cover", 70), PanelSchedule.during_ok("cover", "vent"),
          PanelSchedule.during_ok("cover", "off"), PanelSchedule.during_ok("cover", 120), PanelSchedule.during_ok("cover", nil)], [true, true, true, false, false])
    check("up, as the page's slider sends it", s.effects([nil, CV, WED, 420, nil, nil, [], 100, nil], [CV], 100, false), [["cover", [CV], "goto", 100]])
    check("their ventilation, each its own: 30% and the 15% of one never set", s.effects([nil, ["hall", "cover", 0], WED, 420, nil, nil, [], "vent", nil], [CV, CV2], "vent", true),
          [["cover", [CV2], "goto", 15], ["cover", [CV], "goto", 30]])
    check("off is all the way down", s.effects([nil, CV, WED, 420, nil, nil, [], "off", nil], [CV], "off", false), [["cover", [CV], "goto", 0]])
end

# An event the engine cannot run is said and left, and the others' minute is theirs. They are in the document by a
# way put does not take: a restore, a hand, a version before, a Replace that gave an event to a device of another kind
def a_bad_event_is_no_end_of_the_others()
    var store = living_room()
    var clock = FakeClock()
    var s = PanelSchedule(store, clock)
    var ui = FakeUi()
    s.ui = ui
    var at = def (day, minute) clock.now = [day, minute] return s.tick() end
    var good = s.put(ev(T, MON, 1080, 1380, [2, 1, WEEKDAYS, 0], 210))["value"]
    var heat = [["thermostat", [T], "mode", "heat"], ["thermostat", [T], "target", 210]]
    # all before the good one, at its own minute: a rule that is no rule, a lamp's levels given to a thermostat (what a Replace of a lamp
    # by a thermostat leaves), a day that is a text, and a skip list that is one
    var bad = [["ebad1", T, WED, 1080, 1100, "x", [], 210, 0], ["ebad2", T, WED, 1080, 1100, nil, [], [60, nil, 66], nil],
               ["ebad3", T, "x", 1080, 1100, nil, [], 210, 0], ["ebad4", T, WED, 1080, 1100, nil, "x", 210, 0]]
    store.doc["events"] = bad + store.doc["events"]
    at(WED, 1078)
    var out = nil
    var raised = nil
    try
        out = at(WED, 1080)
    except .. as e, m
        raised = str(e) + ": " + str(m)
    end
    check("a tick over bad events raises nothing", raised, nil)
    check("and the good event's minute is its own: the thermostat heats to 21.5", out, heat)
    check("the next minutes too, and the retry of what it asked", [at(WED, 1081), s.wants.contains(T)], [heat, true])
    ui.live[T] = "on"
    check("and its end, at 23:00", at(WED, 1380), [["thermostat", [T], "mode", "off"]])
    check("the document was left as it was, for the sweep to look at", size(store.doc["events"]), 5)
end

# What the engine cannot run is taken out of the document at the boot (the constructor), and after a Replace
def the_sweep()
    var store = living_room()
    var clock = FakeClock()
    var good = [nil, T, MON, 1080, 1380, nil, nil, 210, "off"]
    var first = PanelSchedule(store, clock)
    var made = first.put(good)
    check("an event of the schedule's own", made["ok"], true)
    var kept = store.doc["events"][0]
    check("a document that is sound loses nothing, and saves nothing", [first.sweep(), size(store.doc["events"])], [false, 1])
    store.doc["events"] = [["ebad1", T, WED, 1080, 1100, "x", [], 210, 0], kept, 5,
                           ["ebad2", T, WED, 1080, 1100, nil, [], [60, nil, 66], nil],
                           ["ebad3", T, WED, 1080, 1100, [1, 1, 0, 0], [], 210, 0, 1],
                           ["ebad4", T, WED, 1100, 1100, nil, [], 210, 0],
                           ["ebad5", ["hall", "thermostat"], WED, 1080, 1100, nil, [], 210, 0],
                           ["ebad6", T, WED, 1080, 1100, nil, [], nil, 0],
                           ["ebad7", T, WED, 1080, 1100, nil, nil, 210, 0],
                           ["ebad8", T, WED, 5000, 1100, nil, [], 210, 0],
                           ["ebad9", "0x00124B0000A00001", WED, 1080, 1100, nil, [], nil, nil]]
    tasmota.timers = []
    var second = PanelSchedule(store, clock)
    check("a document with events the engine cannot run loses them at the boot, the good one stays", [size(store.doc["events"]), store.doc["events"][0][0]], [1, kept[0]])
    check("and the store is told to save", size(tasmota.timers), 1)
    tasmota.timers = nil
    check("an event of a device that is gone, or of a zone with no one in it, is not a bad one: it waits", [second.sound([nil, "0x00124B0000FFFFFF", WED, 600, 660, nil, [], nil, nil]),
          second.sound([nil, ["middle", "light", 9], WED, 600, 660, nil, [], [60, nil, nil], nil]), second.sound([nil, T, WED, 600, 660, nil, [], 210, "off"])], [true, true, true])
    store.doc["events"] = "x"
    check("events that are no list go", [second.sweep(), store.doc["events"]], [true, []])
    store.doc.remove("events")
    check("and none at all is none", [second.sweep(), store.doc.contains("events")], [false, false])

    # a Replace of a lamp by a thermostat: the lamp's levels are no target, and the thermostat's own event stays
    var s = PanelSchedule(living_room(), FakeClock())
    var lamp_event = s.put(ev(LAMP, WED, 600, 660, nil, [60, nil, 66]))["value"]
    var own = s.put(ev(T, WED, 800, 860, nil, 210))["value"]
    var fresh = "0x00124B0000B00009"
    s.store.replace_device(LAMP, [fresh, "", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    check("a Replace gives the lamp's event to the thermostat", [s.find(lamp_event)[1], s.sound(s.find(lamp_event))], [fresh, false])
    check("the sweep after it takes that one out", [s.sweep(), s.find(lamp_event), s.find(own) != nil], [true, nil, true])
    # a lamp for a lamp is nothing to drop
    var t = PanelSchedule(living_room(), FakeClock())
    var keep = t.put(ev(LAMP, WED, 600, 660, nil, [60, nil, 66]))["value"]
    t.store.replace_device(LAMP, ["0x00124B0000C0FFFF", "", "light", 15, 153, 500, "CK-BL702-AL-01", 1, 1, 0])
    check("a lamp replaced by a lamp keeps its event, with the new device's name for it", [t.sweep(), t.find(keep)[1]], [false, "0x00124B0000C0FFFF"])
end

# A clock set back a little does not run the minutes again: the mark stays where it was until the clock goes past it
def a_clock_set_back_a_little()
    var store = living_room()
    var clock = FakeClock()
    var s = PanelSchedule(store, clock)
    var ui = FakeUi()
    s.ui = ui
    var at = def (day, minute) clock.now = [day, minute] return s.tick() end
    s.put(ev(LAMP, WED, 600, 660, nil, nil))
    at(WED, 598)
    check("the minute of the start fires", size(at(WED, 600)), 1)
    ui.live[LAMP] = "on"
    check("the internet's time puts the clock back a second over the minute: nothing again", [at(WED, 599), s.last], [[], WED * 1440 + 600])
    check("and when it comes to the minute again: still nothing", at(WED, 600), [])
    check("the minute after is the minute after", [at(WED, 601), s.last], [[], WED * 1440 + 601])
    at(WED, 605)
    check("five minutes back is a little", [at(WED, 600), s.last], [[], WED * 1440 + 605])
    check("six minutes back is another time: the mark goes with it", [at(WED, 599), s.last], [[], WED * 1440 + 599])
    check("and the minute then comes again, as it did", size(at(WED, 600)), 1)
end

# A pair of events with the sun in one looks at two years of days, in Berry: it gives the VM a yield every 64 of them
class YieldTasmota : TasmotaStub
    var yields
    def init() self.yields = 0 end
    def yield() self.yields += 1 end
end
def the_clash_gives_the_vm_a_breath()
    var s = PanelSchedule(living_room(), FakeClock())
    s.put(ev(T, WED, 360, 420, [1, 1, 0, 0], 210))
    var before = tasmota.yields
    var r = s.put(ev(T, WED, SET - 30, 1380, [1, 1, 0, 0], 180))
    check("a second event of a thermostat, with the sunset in it: taken", r["ok"], true)
    var n = tasmota.yields - before
    check("two years of days, a yield every 64: a dozen of them", [n >= 10, n <= 13], [true, true])
    s.put(ev(LAMP, WED, 540, 600, [1, 1, 0, 0], nil))
    before = tasmota.yields
    s.put(ev(LAMP, WED, 700, 760, [1, 1, 0, 0], nil))
    check("two events at fixed hours that never meet look at no day: no yield", tasmota.yields, before)
end

times()
repeating()
normals()
spans()
saving()
operations()
with_the_store()
icalendar()
engine()
starts_and_ends()
blinds()
a_bad_event_is_no_end_of_the_others()
the_sweep()
a_clock_set_back_a_little()
tasmota = YieldTasmota()
the_clash_gives_the_vm_a_breath()
tasmota = TasmotaStub()

if failures > 0
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
else
    print("ok - " + str(checks) + " checks")
end
