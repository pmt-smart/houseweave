"""HouseWeave: the house's panels in Home Assistant.

A calendar for each device the panels' schedule turns on and off, from what they say on the house's MQTT, the one Home
Assistant already has. Home Assistant sees and asks; the panels keep the schedule and run it, with or without it. The
add-on that serves the panels' releases and keeps their backups brings this integration and keeps it at its version.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .const import DOMAIN
from .hub import Hub

PLATFORMS = [Platform.CALENDAR]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hub = Hub(hass)
    await hub.start()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = hub
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop(entry.entry_id).stop()
    return unloaded
