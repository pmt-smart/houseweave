"""A calendar for each device the panels' schedule turns on and off: its events, and its changes."""

from __future__ import annotations

from datetime import datetime, timedelta

from homeassistant.components.calendar import CalendarEntity, CalendarEntityFeature, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import DOMAIN
from .hub import Hub
from .schedule import Occurrence, Panel, ScheduleError


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    hub: Hub = hass.data[DOMAIN][entry.entry_id]
    known: dict[tuple[str, str], DeviceCalendar] = {}

    @callback
    def changed(name: str, what: str) -> None:
        panel = hub.panels[name]
        new = []
        for device in panel.devices:
            if (name, device) not in known:
                known[(name, device)] = DeviceCalendar(hub, name, device)
                new.append(known[(name, device)])
        if new:
            async_add_entities(new)
        for (p, device), entity in known.items():
            if p == name and (what in ("*", device)) and entity.hass is not None:
                entity.async_write_ha_state()

    hub.listeners.append(changed)
    for name in list(hub.panels):
        changed(name, "*")


def as_event(o: Occurrence) -> CalendarEvent:
    return CalendarEvent(start=o.start, end=o.end, summary=o.summary, uid=o.uid, recurrence_id=o.recurrence_id, rrule=o.rrule)


class DeviceCalendar(CalendarEntity):
    """A device's events, as its panel says them; a change goes to the panel, which checks it and keeps it"""

    _attr_supported_features = (CalendarEntityFeature.CREATE_EVENT | CalendarEntityFeature.UPDATE_EVENT
                                | CalendarEntityFeature.DELETE_EVENT)

    def __init__(self, hub: Hub, panel: str, device: str) -> None:
        self.hub = hub
        self.panel_name = panel
        self.device = device
        self._attr_unique_id = f"{panel}_{device}"

    @property
    def panel(self) -> Panel | None:
        return self.hub.panels.get(self.panel_name)

    @property
    def name(self) -> str:
        p = self.panel
        d = p.devices.get(self.device) if p else None
        return d.name if d else self.device

    @property
    def available(self) -> bool:
        p = self.panel
        return p is not None and self.device in p.devices

    @property
    def event(self) -> CalendarEvent | None:
        p = self.panel
        if p is None:
            return None
        now = dt_util.now()
        found = p.occurrences(self.device, now, now + timedelta(days=7))
        return as_event(found[0]) if found else None

    async def async_get_events(self, hass: HomeAssistant, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        p = self.panel
        return [as_event(o) for o in p.occurrences(self.device, start_date, end_date)] if p else []

    async def async_create_event(self, **kwargs) -> None:
        await self._ask(lambda p: {"op": "put", "event": p.put(self.device, kwargs)})

    async def async_update_event(self, uid: str, event: dict, recurrence_id: str | None = None,
                                 recurrence_range: str | None = None) -> None:
        if recurrence_id:
            raise HomeAssistantError("The panel changes a whole event: change all of them, or delete this one.")
        await self._ask(lambda p: {"op": "put", "event": p.put(self.device, event, uid)})

    async def async_delete_event(self, uid: str, recurrence_id: str | None = None, recurrence_range: str | None = None) -> None:
        await self._ask(lambda p: p.remove(uid, recurrence_id, recurrence_range))

    async def _ask(self, make) -> None:
        p = self.panel
        if p is None:
            raise HomeAssistantError("The panel is not on the house's MQTT.")
        try:
            await self.hub.ask(p, make(p))
        except ScheduleError as err:
            raise HomeAssistantError(str(err)) from err
