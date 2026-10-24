"""The integration's pure part (custom_components/houseweave/schedule.py), with no Home Assistant: the panels'
messages, the occurrences a calendar shows, and what a change on Home Assistant's screen asks of the panel.

    .tools/pio-venv/Scripts/python.exe -m unittest discover -s ha/houseweave/tests

Any Python 3.11 or later runs it; the repo's own is the one the firmware's build installs.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib
import sys
import unittest
from datetime import date, datetime, timedelta, timezone

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("schedule", HERE.parent / "custom_components" / "houseweave" / "schedule.py")
schedule = importlib.util.module_from_spec(_spec)
# known to sys.modules first, as an import would make it: its dataclasses look themselves up there
sys.modules["schedule"] = schedule
_spec.loader.exec_module(schedule)

T = "0x00124B0000B00001"
LAMP = "0x00124B0000C00001"
BRT = timezone(timedelta(hours=-3))
WED = schedule.days_of(date(2026, 10, 7))


def panel() -> schedule.Panel:
    """the Living room's panel, as its MQTT says it: São Paulo, a thermostat in the Hall, a lamp of the Corridor, and two events"""
    p = schedule.Panel("240ac43e51a7")
    p.heard("panel", json.dumps({"command": "cmnd/tasmota_3E51A7/Schedule", "result": "stat/tasmota_3E51A7/RESULT",
                                 "place": {"lat": -235505, "lon": -466333, "tz": -3}}))
    p.heard("device/" + T, json.dumps({"name": "Thermostat 1", "kind": "thermostat", "zone": "hall", "zoneName": "Hall", "relay": 0, "off": False}))
    p.heard("device/" + LAMP, json.dumps({"name": "Corridor 1", "kind": "light", "zone": "corridor", "zoneName": "Corridor", "relay": 2, "off": False}))
    p.heard("event/e1", json.dumps({"uid": "e1", "for": T, "devices": [T], "kind": "thermostat", "day": "2026-10-05", "from": "18:00", "to": "23:00",
                                    "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "rule": {"freq": 2, "every": 1, "days": 31, "until": None},
                                    "exdates": ["2026-10-07"], "during": "21.0°C"}))
    p.heard("event/e2", json.dumps({"uid": "e2", "for": ["corridor", "light", 2], "devices": [LAMP], "kind": "light", "day": "2026-10-07",
                                    "from": "sunset-30", "to": "23:00", "rrule": None, "rule": None, "exdates": [], "during": "60% Blue"}))
    return p


class TheSun(unittest.TestCase):
    def test_the_panels_sum(self):
        # the panel's own, from berry/panel_clock.be on the vendored interpreter
        want = {20733: (341, 1087), 20734: (340, 1087), 20800: (314, 1128), 20900: (371, 1096), 21000: (409, 1051), 20454: (323, 1136)}
        # the same to the minute, as the interpreter's doubles have it; the panel's single floats may differ by one, rarely
        for day, both in want.items():
            self.assertEqual(schedule.sun(day, -235505, -466333, -3), both, day)
        self.assertEqual(schedule.sun(20733, 785000, 155000, 1), (433, 978))
        self.assertIsNone(schedule.sun(20733, None, -466333, -3))
        self.assertIsNone(schedule.sun(schedule.days_of(date(2026, 12, 21)), 850000, 0, 0), "the polar night")

    def test_a_time_on_a_day(self):
        p = panel()
        rise, fall = schedule.sun(WED, -235505, -466333, -3)
        self.assertEqual([schedule.time_minute(w, WED, p.place) for w in ["18:00", "sunset", "sunset-30", "sunrise+15", "Sunrise", "nope", "6:00"]],
                         [1080, fall, fall - 30, rise + 15, rise, None, 360])


class TheRules(unittest.TestCase):
    def ev(self, day, rule=None, skip=()):
        return schedule.Event("e", T, [T], "thermostat", schedule.days_of(day), "10:00", "11:00", None, rule, [schedule.days_of(d) for d in skip], "21.0°C")

    def test_weekly(self):
        e = self.ev(date(2026, 10, 5), {"freq": 2, "every": 1, "days": 31, "until": "2026-10-14"}, [date(2026, 10, 7)])
        days = [d for d in range(WED - 3, WED + 14) if e.occurs(d)]
        self.assertEqual([schedule.date_of(d).isoformat() for d in days],
                         ["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"])

    def test_every_other_week(self):
        e = self.ev(date(2026, 10, 7), {"freq": 2, "every": 2, "days": 5, "until": None})
        self.assertEqual([e.occurs(WED + k) for k in (0, 5, 7, 12, 14)], [True, False, False, True, True])

    def test_monthly_and_yearly(self):
        m = self.ev(date(2026, 1, 31), {"freq": 3, "every": 1, "days": 0, "until": None})
        self.assertEqual([m.occurs(schedule.days_of(date(2026, k, d))) for k, d in ((2, 28), (3, 31), (4, 30))], [False, True, False])
        y = self.ev(date(2028, 2, 29), {"freq": 4, "every": 1, "days": 0, "until": None})
        self.assertEqual([y.occurs(schedule.days_of(date(2029, 2, 28))), y.occurs(schedule.days_of(date(2032, 2, 29)))], [False, True])
        d = self.ev(date(2026, 10, 7), {"freq": 1, "every": 3, "days": 0, "until": None})
        self.assertEqual([d.occurs(WED + k) for k in range(7)], [True, False, False, True, False, False, True])

    def test_once(self):
        e = self.ev(date(2026, 10, 7))
        self.assertEqual([e.occurs(WED - 1), e.occurs(WED), e.occurs(WED + 7)], [False, True, False])


class TheCalendar(unittest.TestCase):
    def test_a_week_of_the_thermostat(self):
        p = panel()
        found = p.occurrences(T, datetime(2026, 10, 5, tzinfo=BRT), datetime(2026, 10, 12, tzinfo=BRT))
        self.assertEqual([o.start.isoformat() for o in found],
                         ["2026-10-05T18:00:00-03:00", "2026-10-06T18:00:00-03:00", "2026-10-08T18:00:00-03:00", "2026-10-09T18:00:00-03:00"])
        o = found[0]
        self.assertEqual([o.end.isoformat(), o.summary, o.uid, o.recurrence_id, o.rrule],
                         ["2026-10-05T23:00:00-03:00", "21.0°C", "e1", "20261005", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"])

    def test_the_range_in_another_time_zone(self):
        p = panel()
        found = p.occurrences(T, datetime(2026, 10, 6, 0, 0, tzinfo=timezone.utc), datetime(2026, 10, 6, 20, 0, tzinfo=timezone.utc))
        self.assertEqual([o.start.isoformat() for o in found], ["2026-10-05T18:00:00-03:00"], "Monday's evening ends at 02:00 UTC on Tuesday, and Tuesday's starts at 21:00 UTC")

    def test_a_zones_event_by_the_sun(self):
        p = panel()
        found = p.occurrences(LAMP, datetime(2026, 10, 7, tzinfo=BRT), datetime(2026, 10, 8, tzinfo=BRT))
        fall = schedule.sun(WED, -235505, -466333, -3)[1] - 30
        self.assertEqual([(o.start.hour * 60 + o.start.minute, o.summary, o.recurrence_id) for o in found],
                         [(fall, "Corridor: 60% Blue [sunset-30 to 23:00]", None)])
        self.assertEqual(p.occurrences(T, datetime(2026, 10, 7, tzinfo=BRT), datetime(2026, 10, 8, tzinfo=BRT)), [], "Wednesday deleted")

    def test_a_night_past_midnight(self):
        p = panel()
        p.heard("event/e3", json.dumps({"uid": "e3", "for": T, "devices": [T], "kind": "thermostat", "day": "2026-10-10", "from": "23:00", "to": "06:00",
                                        "rule": None, "exdates": [], "during": "18.0°C"}))
        found = p.occurrences(T, datetime(2026, 10, 11, 5, 0, tzinfo=BRT), datetime(2026, 10, 11, 7, 0, tzinfo=BRT))
        self.assertEqual([(o.start.isoformat(), o.end.isoformat()) for o in found], [("2026-10-10T23:00:00-03:00", "2026-10-11T06:00:00-03:00")])

    def test_an_occurrence_that_ends_as_the_range_starts(self):
        p = panel()
        found = p.occurrences(T, datetime(2026, 10, 5, 23, 0, tzinfo=BRT), datetime(2026, 10, 6, 12, 0, tzinfo=BRT))
        self.assertEqual(found, [], "Monday's evening ends at 23:00: it does not meet a range from 23:00")

    def test_to_the_minute_the_sun_sets(self):
        p = panel()
        fall = schedule.sun(WED, -235505, -466333, -3)[1]
        p.heard("event/e4", json.dumps({"uid": "e4", "for": T, "devices": [T], "kind": "thermostat", "day": "2026-10-07", "from": "sunset",
                                        "to": f"{fall // 60:02d}:{fall % 60:02d}", "rule": None, "exdates": [], "during": "20.0°C"}))
        self.assertEqual(p.events["e4"].span(WED, p.place), (fall, fall + 1440), "a whole day, to the next day's")

    def test_what_is_gone(self):
        p = panel()
        self.assertEqual([p.heard("event/e2", ""), "e2" in p.events, p.heard("device/" + LAMP, ""), LAMP in p.devices], ["*", False, LAMP, False])
        self.assertIsNone(p.heard("other/x", "{}"))
        with self.assertRaises(ValueError):
            p.heard("device/x", "not json")


class TheChanges(unittest.TestCase):
    def test_a_new_event(self):
        p = panel()
        e = p.put(LAMP, {"dtstart": datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc), "dtend": datetime(2026, 10, 20, 10, 30, tzinfo=timezone.utc),
                         "summary": "40% Warm", "rrule": "RRULE:FREQ=DAILY;COUNT=3"})
        self.assertEqual(e, {"uid": None, "for": LAMP, "day": "2026-10-20", "from": "06:00", "to": "07:30", "rrule": "FREQ=DAILY;COUNT=3",
                             "exdates": [], "during": "40% Warm"})

    def test_a_change_keeps_the_sun_and_the_days_deleted(self):
        p = panel()
        fall = schedule.sun(WED, -235505, -466333, -3)[1] - 30
        start = datetime.combine(date(2026, 10, 7), datetime.min.time(), BRT) + timedelta(minutes=fall)
        e = p.put(LAMP, {"dtstart": start, "dtend": datetime(2026, 10, 7, 23, 30, tzinfo=BRT), "summary": "Corridor: 60% Blue [sunset-30 to 23:00]"}, "e2")
        self.assertEqual([e["for"], e["from"], e["to"], e["during"]], [["corridor", "light", 2], "sunset-30", "23:30", "Corridor: 60% Blue [sunset-30 to 23:00]"])
        moved = p.put(LAMP, {"dtstart": start + timedelta(minutes=5), "dtend": datetime(2026, 10, 7, 23, 0, tzinfo=BRT), "summary": "60% blue"}, "e2")
        self.assertEqual([moved["from"], moved["to"]], [f"{(fall + 5) // 60:02d}:{(fall + 5) % 60:02d}", "23:00"], "moved, it is at a fixed time")
        e1 = p.put(T, {"dtstart": datetime(2026, 10, 5, 18, 0, tzinfo=BRT), "dtend": datetime(2026, 10, 5, 22, 0, tzinfo=BRT), "summary": "21°C",
                       "rrule": "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"}, "e1")
        self.assertEqual([e1["uid"], e1["exdates"], e1["to"]], ["e1", ["2026-10-07"], "22:00"])

    def test_what_the_panel_does_not_run(self):
        p = panel()
        for fields, words in [({"dtstart": date(2026, 10, 7), "dtend": date(2026, 10, 8)}, "all-day"),
                              ({"dtstart": datetime(2026, 10, 7, 10, tzinfo=BRT), "dtend": datetime(2026, 10, 8, 10, tzinfo=BRT)}, "less than a day"),
                              ({"dtstart": datetime(2026, 10, 7, 10, tzinfo=BRT), "dtend": datetime(2026, 10, 7, 9, tzinfo=BRT)}, "after it starts")]:
            with self.assertRaises(schedule.ScheduleError) as caught:
                p.put(T, fields)
            self.assertIn(words, str(caught.exception))
        with self.assertRaises(schedule.ScheduleError):
            p.put(T, {"dtstart": datetime(2026, 10, 7, 10, tzinfo=BRT), "dtend": datetime(2026, 10, 7, 11, tzinfo=BRT)}, "e9")

    def test_a_delete(self):
        p = panel()
        self.assertEqual([p.remove("e1", None, None), p.remove("e1", "20261009", None), p.remove("e1", "20261009T180000", "THISANDFUTURE")],
                         [{"op": "delete", "uid": "e1"}, {"op": "skip", "uid": "e1", "day": "2026-10-09"}, {"op": "end", "uid": "e1", "day": "2026-10-09"}])
        with self.assertRaises(schedule.ScheduleError):
            p.remove("e1", "tomorrow", None)

    def test_the_start_and_the_end(self):
        """an event with no end is an instant, a minute on the calendar, and one asked for of a minute is one; the end's
        action after an arrow in the title, when it is not off"""
        p = panel()
        p.heard("event/e5", json.dumps({"uid": "e5", "for": LAMP, "devices": [LAMP], "kind": "light", "day": "2026-10-08", "from": "00:00",
                                        "to": None, "rule": None, "exdates": [], "start": "Off", "end": None, "during": "Off"}))
        p.heard("event/e6", json.dumps({"uid": "e6", "for": LAMP, "devices": [LAMP], "kind": "light", "day": "2026-10-09", "from": "18:00",
                                        "to": "23:00", "rule": None, "exdates": [], "start": "On", "end": "20%", "during": "On"}))
        found = p.occurrences(LAMP, datetime(2026, 10, 8, 0, 0, tzinfo=BRT), datetime(2026, 10, 10, 0, 0, tzinfo=BRT))
        self.assertEqual([(o.uid, o.end - o.start, o.summary) for o in found],
                         [("e5", timedelta(minutes=1), "Off"), ("e6", timedelta(hours=5), "On -> 20%")])
        self.assertEqual(p.summary(p.events["e1"]), "21.0°C", "an end off, as every event's was, says nothing")
        e = p.put(LAMP, {"dtstart": datetime(2026, 10, 20, 7, 0, tzinfo=BRT), "dtend": datetime(2026, 10, 20, 7, 1, tzinfo=BRT), "summary": "On"})
        self.assertEqual([e["from"], e["to"], e["during"]], ["07:00", None, "On"])
        e = p.put(LAMP, {"dtstart": datetime(2026, 10, 9, 18, 0, tzinfo=BRT), "dtend": datetime(2026, 10, 9, 23, 0, tzinfo=BRT), "summary": "On -> 20%"}, "e6")
        self.assertEqual([e["to"], e["during"]], ["23:00", "On -> 20%"], "the title goes as it is, and the panel reads its arrow")

    def test_the_answers(self):
        self.assertEqual(schedule.answer_of('{"Schedule": {"n": 3, "ok": false, "error": "overlap", "message": "x"}}'),
                         {"n": 3, "ok": False, "error": "overlap", "message": "x"})
        self.assertEqual([schedule.answer_of('{"POWER1": "ON"}'), schedule.answer_of("nope"), schedule.answer_of('{"Schedule": "Done"}')], [None, None, None])


if __name__ == "__main__":
    unittest.main()
