"""The panels' schedule as their MQTT says it, for Home Assistant's calendars.

What a device's calendar shows, and what a change on Home Assistant's screen asks of the panel. Pure Python, with
nothing of Home Assistant in it, so it is tested alone (ha/houseweave/tests); calendar.py and hub.py make it
entities. It keeps nothing and decides nothing: the panel checks every change, keeps it and runs it, and this only
shows what the panel says and carries what the user asks.

The occurrences are expanded here by the panel's own rules, the ones berry/panel_schedule.be runs: the panel says each
event's rule as it keeps it, and the sun is the same NOAA sum the panel's clock does (berry/panel_clock.be), with the
place and the time zone the panel says. A time is a minute of the day in the panel's time zone.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

TOPIC = "houseweave/schedule"
EPOCH = date(1970, 1, 1)


class ScheduleError(Exception):
    """A change the panel would refuse, or that the screens cannot ask: its message is what Home Assistant shows."""


# --- days, times and the sun -----------------------------------------------------------------------------------------


def days_of(d: date) -> int:
    return (d - EPOCH).days


def date_of(n: int) -> date:
    return EPOCH + timedelta(days=n)


def parse_day(s: str | None) -> int | None:
    try:
        return days_of(date.fromisoformat(str(s)))
    except ValueError:
        return None


def minute_of(m: float) -> int:
    """a real minute of the day, rounded and brought into the day, as the panel rounds it"""
    r = int(m + (-0.5 if m < 0 else 0.5))
    return r % 1440


def sun(day: int, lat: int | None, lon: int | None, tz: int) -> tuple[int, int] | None:
    """The sunrise and the sunset of a day, in minutes of the day in the time zone, or None where the sun neither rises
    nor sets, or with no place. The coordinates are in ten-thousandths of a degree, as the panel keeps them"""
    if lat is None or lon is None:
        return None
    d = date_of(day)
    doy = (d - date(d.year, 1, 1)).days
    g = 2 * math.pi / 365 * doy
    eqtime = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g)
                       - 0.040849 * math.sin(2 * g))
    decl = (0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g)
            + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g))
    phi = lat / 10000 * math.pi / 180
    c = math.cos(90.833 * math.pi / 180) / (math.cos(phi) * math.cos(decl)) - math.tan(phi) * math.tan(decl)
    if c < -1 or c > 1:
        return None
    ha = math.degrees(math.acos(c))
    lng = lon / 10000
    rise = 720 - 4 * (lng + ha) - eqtime + tz * 60
    fall = 720 - 4 * (lng - ha) - eqtime + tz * 60
    return minute_of(rise), minute_of(fall)


def time_minute(word: str, day: int, place: Place) -> int | None:
    """A time as the wire says it, "18:00", "sunset", "sunset-30", "sunrise+15", as a minute of that day; None for the
    sun with no place, or for a word that is not a time"""
    w = word.lower()
    for name, i in (("sunrise", 0), ("sunset", 1)):
        if w.startswith(name):
            rest = w[len(name):]
            offset = int(rest) if rest else 0
            s = sun(day, place.lat, place.lon, place.tz)
            return None if s is None else max(0, min(1439, s[i] + offset))
    h, _, m = w.partition(":")
    if not (h.isdigit() and m.isdigit() and len(m) == 2):
        return None
    return int(h) * 60 + int(m)


def is_sun(word: str) -> bool:
    return word.lower().startswith("sun")


# --- the panel, its devices and its events ---------------------------------------------------------------------------


@dataclass
class Place:
    lat: int | None = None
    lon: int | None = None
    tz: int = 0

    def zone(self) -> timezone:
        return timezone(timedelta(hours=self.tz))


@dataclass
class Event:
    uid: str
    target: str | list
    devices: list[str]
    kind: str
    day: int
    start: str
    end: str | None
    rrule: str | None
    rule: dict | None
    skip: list[int]
    during: str
    then: str | None = None
    """the start's words are `during`; the end's, what the devices do from the end on, `then`, None with no end"""

    @staticmethod
    def from_wire(m: dict) -> Event | None:
        day = parse_day(m.get("day"))
        if day is None or not isinstance(m.get("uid"), str):
            return None
        to = m.get("to")
        then = m.get("end")
        return Event(m["uid"], m.get("for"), list(m.get("devices") or []), str(m.get("kind")), day, str(m.get("from")),
                     str(to) if to not in (None, "") else None, m.get("rrule"), m.get("rule"),
                     [d for d in map(parse_day, m.get("exdates") or []) if d is not None],
                     str(m.get("start", m.get("during", ""))), str(then) if then is not None else None)

    def is_zone(self) -> bool:
        return isinstance(self.target, list)

    def occurs(self, day: int) -> bool:
        """whether an occurrence starts on a day: the panel's PanelSchedule.occurs"""
        if day < self.day or day in self.skip:
            return False
        r = self.rule
        if r is None:
            return day == self.day
        until = parse_day(r.get("until")) if r.get("until") else None
        if until is not None and day > until:
            return False
        freq, every = r.get("freq"), max(1, int(r.get("every", 1)))
        if freq == 1:
            return (day - self.day) % every == 0
        if freq == 2:
            wd = date_of(day).weekday()
            if not (int(r.get("days", 0)) >> wd) & 1:
                return False
            return ((day - wd - self.day + date_of(self.day).weekday()) // 7) % every == 0
        a, b = date_of(self.day), date_of(day)
        if a.day != b.day:
            return False
        if freq == 3:
            return ((b.year - a.year) * 12 + b.month - a.month) % every == 0
        return a.month == b.month and (b.year - a.year) % every == 0

    def span(self, day: int, place: Place) -> tuple[int, int] | None:
        """an occurrence's start and end in minutes from its day's midnight, the end past 1440 the next day's. One with no
        end is its start's minute, as the panel's overlap check has it"""
        s = time_minute(self.start, day, place)
        if self.end is None:
            return (s, s + 1) if s is not None else None
        e = time_minute(self.end, day, place)
        if s is None or e is None:
            return None
        if e <= s:
            e = time_minute(self.end, day + 1, place)
            if e is None:
                return None
            e += 1440
        return s, e


@dataclass
class Device:
    id: str
    name: str
    kind: str
    zone: str | None
    zone_name: str | None
    off: bool


@dataclass
class Occurrence:
    start: datetime
    end: datetime
    summary: str
    uid: str
    recurrence_id: str | None
    rrule: str | None


@dataclass
class Panel:
    """what one panel says: where its command goes and its answers, its place, its devices and its events"""

    name: str
    command: str | None = None
    result: str | None = None
    place: Place = field(default_factory=Place)
    devices: dict[str, Device] = field(default_factory=dict)
    events: dict[str, Event] = field(default_factory=dict)

    def heard(self, rest: str, payload: str) -> str | None:
        """A retained message of the panel's, by what follows its name in the topic: the device whose calendar it
        changes, "*" for every one, or None"""
        kind, _, key = rest.partition("/")
        m = json.loads(payload) if payload else None
        if kind == "panel" and isinstance(m, dict):
            self.command, self.result = m.get("command"), m.get("result")
            p = m.get("place") or {}
            self.place = Place(p.get("lat"), p.get("lon"), int(p.get("tz") or 0))
            return "*"
        if kind == "device" and key:
            if isinstance(m, dict):
                self.devices[key] = Device(key, str(m.get("name", key)), str(m.get("kind")), m.get("zone"), m.get("zoneName"), bool(m.get("off")))
            else:
                self.devices.pop(key, None)
            return key
        if kind == "event" and key:
            was = self.events.pop(key, None)
            ev = Event.from_wire(m) if isinstance(m, dict) else None
            if ev is not None:
                self.events[key] = ev
            return "*"
        return None

    def events_of(self, device: str) -> list[Event]:
        return [e for e in self.events.values() if device in e.devices]

    def summary(self, ev: Event) -> str:
        """an event's title: what it does at its start, and from its end on after an arrow when that is not off; a zone's
        name before it, and the sun after it in brackets"""
        text = ev.during
        if ev.then is not None and ev.then.lower() != "off":
            text += f" -> {ev.then}"
        if ev.is_zone():
            zone = next((d.zone_name for d in self.devices.values() if d.zone == ev.target[0] and d.zone_name), None)
            text = f"{zone or ev.target[0]}: {text}"
        if is_sun(ev.start) or (ev.end is not None and is_sun(ev.end)):
            text += f" [{ev.start} to {ev.end}]" if ev.end is not None else f" [{ev.start}]"
        return text

    def occurrences(self, device: str, start: datetime, end: datetime) -> list[Occurrence]:
        """the occurrences of a device's events that meet [start, end), in the order they start"""
        tz = self.place.zone()
        first = days_of(start.astimezone(tz).date()) - 1
        last = days_of(end.astimezone(tz).date())
        out = []
        for ev in self.events_of(device):
            for day in range(first, last + 1):
                if not ev.occurs(day):
                    continue
                s = ev.span(day, self.place)
                if s is None:
                    continue
                midnight = datetime.combine(date_of(day), datetime.min.time(), tz)
                a, b = midnight + timedelta(minutes=s[0]), midnight + timedelta(minutes=s[1])
                if a < end and b > start:
                    out.append(Occurrence(a, b, self.summary(ev), ev.uid, date_of(day).strftime("%Y%m%d") if ev.rule else None, ev.rrule))
        out.sort(key=lambda o: o.start)
        return out

    # --- what Home Assistant's screen asks ---------------------------------------------------------------------------

    def put(self, device: str, fields: dict, uid: str | None = None) -> dict:
        """The Schedule command's event for a new event on a device's calendar, or a whole event changed. A change keeps
        a sun the event follows when its occurrence's time is left as it was, and keeps the days it had deleted. An event
        of one minute is one with no end, an instant: it is how the calendar shows one"""
        was = self.events.get(uid) if uid else None
        if uid and was is None:
            raise ScheduleError("The event is not on the panel any more.")
        start, end = fields.get("dtstart"), fields.get("dtend")
        if not isinstance(start, datetime) or not isinstance(end, datetime):
            raise ScheduleError("The panel runs events with a start time and an end time, not all-day ones.")
        tz = self.place.zone()
        a, b = start.astimezone(tz), end.astimezone(tz)
        if b <= a or b - a >= timedelta(days=1):
            raise ScheduleError("An event ends after it starts, and in less than a day.")
        day = days_of(a.date())
        words = [f"{a.hour:02d}:{a.minute:02d}", f"{b.hour:02d}:{b.minute:02d}"]
        if was is not None:
            # the sun the event follows, when the occurrence's minute is the sun's that day
            span = was.span(day, self.place)
            mins = [a.hour * 60 + a.minute, b.hour * 60 + b.minute]
            for i, word in enumerate((was.start, was.end)):
                if word is not None and is_sun(word) and span is not None and span[i] % 1440 == mins[i]:
                    words[i] = word
        if b - a <= timedelta(minutes=1):
            words[1] = None
        rrule = fields.get("rrule") or ""
        if rrule.upper().startswith("RRULE:"):
            rrule = rrule[6:]
        summary = str(fields.get("summary") or "")
        return {"uid": uid, "for": was.target if was is not None else device, "day": a.date().isoformat(), "from": words[0],
                "to": words[1], "rrule": rrule or None, "exdates": [date_of(d).isoformat() for d in was.skip] if was is not None else [],
                "during": summary}

    def remove(self, uid: str, recurrence_id: str | None, recurrence_range: str | None) -> dict:
        """The Schedule command for a delete: the whole event, one occurrence, or that one and the ones after"""
        if not recurrence_id:
            return {"op": "delete", "uid": uid}
        day = recurrence_day(recurrence_id)
        if day is None:
            raise ScheduleError("The occurrence is not one the panel knows.")
        return {"op": "end" if recurrence_range == "THISANDFUTURE" else "skip", "uid": uid, "day": date_of(day).isoformat()}


def recurrence_day(recurrence_id: str) -> int | None:
    """the day of an occurrence, from the recurrence id this module gave it, "20261007" (or a time after it)"""
    s = recurrence_id[:8]
    if len(s) != 8 or not s.isdigit():
        return None
    return parse_day(f"{s[:4]}-{s[4:6]}-{s[6:]}")


def answer_of(payload: str) -> dict | None:
    """the Schedule command's answer in a panel's RESULT, or None for another command's"""
    try:
        m = json.loads(payload)
    except ValueError:
        return None
    a = m.get("Schedule") if isinstance(m, dict) else None
    return a if isinstance(a, dict) and "ok" in a else None
