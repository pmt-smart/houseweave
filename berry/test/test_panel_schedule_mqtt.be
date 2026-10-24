# berry/panel_schedule_mqtt.be: the schedule on the house's MQTT, the retained messages Home Assistant's
# calendars read and the Schedule command they edit it with, on the Living room's store with a thermostat in the Hall.

import json
import mqtt
import string

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

# Tasmota: the timers, run by the test; the commands registered and their answers; the settings a command answers
class ScheduleTasmota : TasmotaStub
    var timers, commands, resp, answers, drivers
    def init()
        self.timers = []
        self.commands = {}
        self.drivers = []
        self.answers = {"Topic": "tasmota_3E51A7", "FullTopic": "%prefix%/%topic%/", "Prefix1": "cmnd", "Prefix2": "stat", "Prefix3": "tele"}
    end
    def set_timer(ms, f, id) self.timers.push([ms, f, id]) end
    def add_cmd(name, f) self.commands[name] = f end
    def add_driver(d) self.drivers.push(d) end
    def resp_cmnd(s) self.resp = s end
    def cmd(c) return self.answers.contains(c) ? {c: self.answers[c]} : nil end
    def wifi() return {"up": true, "mac": "24:0A:C4:3E:51:A7", "ip": "192.168.2.70"} end
    def hostname() return "nspanel-living" end
    # every timer due, and the ones they set, as the loop would run them
    def run_timers()
        var n = 0
        while size(self.timers) > 0 && n < 500
            var t = self.timers[0]
            self.timers.remove(0)
            t[1]()
            n += 1
        end
    end
    # a command as MQTT runs it: what it answered
    def run_cmd(name, payload)
        self.resp = nil
        self.commands[name](name, 1, payload, nil)
        return json.load(self.resp)
    end
end
tasmota = ScheduleTasmota()

class FakeClock
    var lat, lon, tz, now
    def init() self.lat = -235505 self.lon = -466333 self.tz = -3 self.now = [20733, 570] end
    def today() return self.now end
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
    store.register_device(["0x00124B0000A00001", "Sensor 1", "sensor", 0, 0, 0, "", 1, 0, 0])
    store.add_to_zone("hall", "0x00124B0000A00001")
    var sched = PanelSchedule(store, FakeClock())
    var told = PanelScheduleMqtt(sched, PanelScheduleView(sched))
    return [store, sched, told]
end

def words()
    var M = PanelScheduleMqtt
    check("days", [M.day_text(WED), M.parse_day("2026-10-07"), M.parse_day("2026-02-29"), M.parse_day("2026-10-7"), M.parse_day(nil), M.parse_day("2026/10/07")],
          ["2026-10-07", WED, nil, nil, nil, nil])
    var times = []
    for t: [1080, PanelSchedule.SUNSET, PanelSchedule.SUNSET - 30, PanelSchedule.SUNRISE + 15, 0]  times.push(M.time_word(t)) end
    check("times", times, ["18:00", "sunset", "sunset-30", "sunrise+15", "00:00"])
    var back = []
    for w: times  back.push(M.parse_time_word(w)) end
    check("and back", back, [1080, PanelSchedule.SUNSET, PanelSchedule.SUNSET - 30, PanelSchedule.SUNRISE + 15, 0])
    var bad = []
    for w: ["25:00", "18:5", "1800", "sunset-31", "sunset+135", "sunset30", "noon", "Sunset-30", nil]  bad.push(M.parse_time_word(w)) end
    check("what is not a time, and the sun in any case", bad, [nil, nil, nil, nil, nil, nil, nil, PanelSchedule.SUNSET - 30, nil])
    var t = []
    for w: ["21°C", "heat 21.5", "21,5", "Hall: 21°C", "21°C [sunset-30]", "21c", "21.55", "hot", "21 22", ""]  t.push(M.parse_during("thermostat", w)) end
    check("a thermostat's titles", t, [[210], [215], [215], [210], [210], [210], nil, nil, nil, nil])
    var l = []
    for w: ["60% Blue", "warm", "on", "", "60% blue warm", "Purple", "Hall: 40% neutral [sunset]", "60", "0% red", "On 30% cool"]  l.push(M.parse_during("light", w)) end
    check("a lamp's", l, [[[60, nil, 66]], [[nil, 100, nil]], [nil], [nil], nil, [[nil, nil, 76]], [[40, 50, nil]], nil, nil, [[30, 0, nil]]])
    check("and a plug's, off any kind's", [M.parse_during("plug", "On"), M.parse_during("plug", ""), M.parse_during("plug", "off"), M.parse_during("plug", nil)],
          [[nil], [nil], ["off"], nil])
    check("a blind's: up, down, its ventilation or a place, and not past 100 nor on", [M.parse_during("cover", "Open"), M.parse_during("cover", "closed"),
          M.parse_during("cover", "Ventilation"), M.parse_during("cover", "70%"), M.parse_during("cover", "Off"), M.parse_during("cover", "120%"),
          M.parse_during("cover", "on")], [[100], [0], ["vent"], [70], ["off"], nil, nil])
end

# what the broker got since the last look, by topic
def published()
    var out = {}
    for p: mqtt.published  out[p[0]] = p[2] ? p[1] : "NOT RETAINED" end
    mqtt.published.clear()
    return out
end

def telling()
    var h = house()
    var store = h[0]
    var sched = h[1]
    var told = h[2]
    var e1 = sched.put([nil, T, WED - 2, 1080, 1380, [2, 1, 31, 0], [WED], 210])["value"]
    var e2 = sched.put([nil, ["corridor", "light", 2], WED, PanelSchedule.SUNSET - 30, 1380, nil, [], [60, nil, 66]])["value"]
    sched.set_off(T, true)
    mqtt.up = false
    told.every_second()
    check("off the broker, nothing is said", [mqtt.published, size(tasmota.timers)], [[], 0])
    mqtt.up = true
    told.every_second()
    told.every_second()
    check("on it, everything a moment after, once", size(tasmota.timers), 1)
    tasmota.run_timers()
    var said = published()
    var b = "houseweave/schedule/240ac43e51a7/"
    check("where the command goes and its answers, and the place", json.load(said[b + "panel"]),
          {"command": "cmnd/tasmota_3E51A7/Schedule", "result": "stat/tasmota_3E51A7/RESULT", "place": {"lat": -235505, "lon": -466333, "tz": -3}})
    check("each device the schedule turns on and off, retained", [json.load(said[b + "device/" + T]), json.load(said[b + "device/relay:1"])],
          [{"name": "Thermostat 1", "kind": "thermostat", "zone": "hall", "zoneName": "Hall", "relay": 0, "off": true},
           {"name": "Hall 1", "kind": "light", "zone": "hall", "zoneName": "Hall", "relay": 1, "off": false}])
    var n = 0
    for t: said.keys()
        if string.find(t, b + "device/") == 0  n += 1 end
    end
    check("all 35 of the Living room's, and not its sensor", [n, said.contains(b + "device/0x00124B0000A00001")], [35, false])
    check("each event", [json.load(said[b + "event/" + e1]), json.load(said[b + "event/" + e2])],
          [{"uid": e1, "for": T, "devices": [T], "kind": "thermostat", "day": "2026-10-05", "from": "18:00", "to": "23:00",
            "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "rule": {"freq": 2, "every": 1, "days": 31, "until": nil}, "exdates": ["2026-10-07"],
            "start": "21.0°C", "end": "Off", "during": "21.0°C"},
           {"uid": e2, "for": ["corridor", "light", 2], "devices": store.group_of(["corridor", "light", 2]), "kind": "light", "day": "2026-10-07",
            "from": "sunset-30", "to": "23:00", "rrule": nil, "rule": nil, "exdates": [], "start": "60% Blue", "end": "Off", "during": "60% Blue"}])
    check("a rule with its end", PanelScheduleMqtt.rule_said([1, 2, 0, WED]), {"freq": 1, "every": 2, "days": 0, "until": "2026-10-07"})
    sched.delete(e2)
    store.remove_device(LAMP)
    told.later()
    tasmota.run_timers()
    said = published()
    check("what is gone, emptied", [said.find(b + "event/" + e2), said.find(b + "device/" + LAMP), said.contains(b + "event/" + e1)], ["", "", true])
    told.later()
    told.later()
    check("a burst of saves is one telling", size(tasmota.timers), 2)
    tasmota.timers[0][1]()
    check("the older moment does nothing", mqtt.published, [])
    tasmota.run_timers()
    published()
end

def commanding()
    var h = house()
    var sched = h[1]
    var a = tasmota.run_cmd("Schedule", json.dump({"n": 1, "op": "put", "event": {"uid": nil, "for": T, "day": "2026-10-05", "from": "18:00", "to": "23:00",
                                                    "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "exdates": [], "during": "Thermostat 1: 21°C"}}))
    var uid = sched.events()[0][0]
    check("Home Assistant's new event, taken", a, {"Schedule": {"n": 1, "ok": true, "uid": uid}})
    check("as the glass would make it, ending off as it always did", sched.events(), [[uid, T, WED - 2, 1080, 1380, [2, 1, 31, 0], [], 210, "off"]])
    a = tasmota.run_cmd("Schedule", json.dump({"n": 2, "op": "put", "event": {"for": ["hall", "thermostat", 0], "day": "2026-10-10", "from": "20:00",
                                                "to": "21:00", "during": "heat 20"}}))
    check("a Saturday overlaps no one", a["Schedule"]["ok"], true)
    a = tasmota.run_cmd("Schedule", json.dump({"n": 3, "op": "put", "event": {"for": T, "day": "2026-10-07", "from": "20:00", "to": "21:00", "during": "21"}}))
    check("a Wednesday evening does, and says why as the glass", a, {"Schedule": {"n": 3, "ok": false, "error": "overlap",
          "message": "Thermostat 1 already has an event on Mon-Fri 18:00-23:00."}})
    a = tasmota.run_cmd("Schedule", json.dump({"n": 4, "op": "put", "event": {"for": LAMP, "day": "2026-10-07", "from": "sunset-30", "to": "23:00",
                                                "during": "very bright"}}))
    check("a title the panel does not read", a["Schedule"], {"n": 4, "ok": false, "error": "bad_during", "message": "The title is not one the panel reads: try 60% blue, warm or on."})
    var refusals = []
    for q: [{"n": 5, "op": "put", "event": {"for": LAMP, "day": "2026-10-07", "from": "sunset-31", "to": "23:00", "during": "on"}},
            {"n": 6, "op": "put", "event": {"for": LAMP, "day": "2026-10-07", "from": "06:00", "to": "07:00", "rrule": "FREQ=MONTHLY;BYDAY=1MO", "during": "on"}},
            {"n": 7, "op": "put", "event": {"for": "0x00124B0000FFFFFF", "day": "2026-10-07", "from": "06:00", "to": "07:00", "during": "21°C"}},
            {"n": 8, "op": "put", "event": {"for": LAMP, "day": "2026-10-07", "from": "06:00", "to": "07:00", "exdates": ["7/10"], "during": "on"}},
            {"n": 9, "op": "fly"}, {"n": 10, "op": "skip", "uid": uid, "day": "tomorrow"}, {"n": 11, "op": "delete", "uid": "e999"},
            {"n": 12, "op": "put", "event": "x"}]
        refusals.push(tasmota.run_cmd("Schedule", json.dump(q))["Schedule"]["error"])
    end
    check("and what else the panel refuses", refusals, ["bad_time", "bad_rule", "no_such_device", "bad_skip", "bad_request", "bad_day", "no_such_event", "bad_event"])
    tasmota.run_cmd("Schedule", json.dump({"n": 16, "op": "put", "event": {"for": LAMP, "day": "2026-10-08", "from": "18:00", "to": "19:00",
                    "rrule": "FREQ=DAILY;UNTIL=20261010T200000Z", "during": "on"}}))
    check("an UNTIL before the start's hour ends the day before", sched.events()[size(sched.events()) - 1][5], [1, 1, 0, WED + 2])
    check("not a request at all", tasmota.run_cmd("Schedule", "not json"), {"Schedule": {"n": nil, "ok": false, "error": "bad_request", "message": "It cannot be saved."}})
    check("one occurrence deleted", [tasmota.run_cmd("Schedule", json.dump({"n": 13, "op": "skip", "uid": uid, "day": "2026-10-07"}))["Schedule"]["ok"], sched.find(uid)[6]],
          [true, [WED]])
    check("that one and the ones after", [tasmota.run_cmd("Schedule", json.dump({"n": 14, "op": "end", "uid": uid, "day": "2026-10-14"}))["Schedule"]["ok"],
          sched.find(uid)[5]], [true, [2, 1, 31, WED + 6]])
    check("and the event", [tasmota.run_cmd("Schedule", json.dump({"n": 15, "op": "delete", "uid": uid}))["Schedule"], size(sched.events())],
          [{"n": 15, "ok": true}, 2])
    var saved = 0
    for t: tasmota.timers
        if t[0] == 0  saved += 1 end
    end
    check("each change taken is saved", saved, 6)
    tasmota.timers.clear()
    # the start and the end: an event with no end, and one whose title says both, after an arrow, or in fields of their own
    a = tasmota.run_cmd("Schedule", json.dump({"n": 17, "op": "put", "event": {"for": LAMP, "day": "2026-10-09", "from": "00:00", "to": nil, "start": "off"}}))
    var last = sched.find(a["Schedule"]["uid"])
    check("off at midnight, with no end", [a["Schedule"]["ok"], last[4], last[7], last[8]], [true, nil, "off", nil])
    a = tasmota.run_cmd("Schedule", json.dump({"n": 18, "op": "put", "event": {"for": LAMP, "day": "2026-10-10", "from": "18:00", "to": "23:00", "during": "On -> 20%"}}))
    last = sched.find(a["Schedule"]["uid"])
    check("on at 18:00 and at 20% from 23:00, by a title's arrow", [last[7], last[8]], [nil, [20, nil, nil]])
    a = tasmota.run_cmd("Schedule", json.dump({"n": 19, "op": "put", "event": {"for": LAMP, "day": "2026-10-11", "from": "18:00", "to": "23:00", "start": "60% blue", "end": "off"}}))
    last = sched.find(a["Schedule"]["uid"])
    check("and by its fields", [last[7], last[8]], [[60, nil, 66], "off"])
    tasmota.timers.clear()
end

words()

# An event that cannot be said does not stop the schedule's word: the pump armed its next message after making this one, so
# one that raised left the queue with nothing to pump it, and tell() starts the pump only on an empty queue: nothing more was said, ever
def a_bad_event_is_no_end_of_the_telling()
    var h = house()
    var sched = h[1]
    var told = h[2]
    var b = "houseweave/schedule/240ac43e51a7/"
    var e1 = sched.put([nil, T, WED - 2, 1080, 1380, nil, [], 210])["value"]
    var e2 = sched.put([nil, ["corridor", "light", 2], WED, PanelSchedule.SUNSET - 30, 1380, nil, [], [60, nil, 66]])["value"]
    var e3 = sched.put([nil, "relay:1", WED, 600, 660, nil, [], nil])["value"]
    # what no message can be made of: the days that were deleted, as a number
    sched.find(e2)[6] = 5
    mqtt.published.clear()
    tasmota.timers.clear()
    mqtt.up = true
    told.every_second()
    tasmota.run_timers()
    var said = published()
    check("one that cannot be said is left, and the rest are said", [said.contains(b + "event/" + e1), said.contains(b + "event/" + e2), said.contains(b + "event/" + e3)],
          [true, false, true])
    check("and nothing waits in the queue, nor for a timer", [size(told.queue), size(tasmota.timers)], [0, 0])
    sched.find(e2)[6] = []
    told.later()
    tasmota.run_timers()
    said = published()
    check("the next telling, the event mended, says all of them", [said.contains(b + "event/" + e1), said.contains(b + "event/" + e2), said.contains(b + "event/" + e3)],
          [true, true, true])
    # a bad one first in the queue: the others still follow it, a moment apart
    sched.find(e1)[6] = 5
    told.later()
    tasmota.run_timers()
    said = published()
    check("a bad one first: the ones after it are said", [said.contains(b + "event/" + e1), said.contains(b + "event/" + e2), said.contains(b + "event/" + e3)], [false, true, true])
    tasmota.timers.clear()
    mqtt.published.clear()
end
telling()
commanding()
a_bad_event_is_no_end_of_the_telling()

if failures > 0
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
else
    print("ok - " + str(checks) + " checks")
end
