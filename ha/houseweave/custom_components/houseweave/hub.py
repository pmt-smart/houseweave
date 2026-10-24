"""The house's MQTT, for the integration: what the panels say of their schedules, and their Schedule command.

It listens to everything under houseweave/schedule/, retained, and keeps one Panel of each (schedule.py); a change
is told to the calendars. A request goes to the panel's command topic with a number of its own, and its answer is the
one in the panel's RESULT with that number.

A panel on the firmware before HouseWeave's says its schedule under casainteligente/schedule/ (FORMER_TOPIC): it is
taken from there until the panel says it under the current topic, and then what the former topic kept of it, retained,
is cleared.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import logging
from collections.abc import Callable

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, callback

from .schedule import FORMER_TOPIC, TOPIC, Panel, ScheduleError, answer_of

_LOGGER = logging.getLogger(__name__)

# how long a panel's answer is waited for
ANSWER_S = 10


class Hub:
    """the panels the house's MQTT has, and the way to ask them"""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.panels: dict[str, Panel] = {}
        # listener(panel, what): "*" for every calendar of the panel, or a device's id
        self.listeners: list[Callable[[str, str], None]] = []
        self._unsubscribe: list[Callable[[], None]] = []
        self._results: set[str] = set()
        self._waiting: dict[int, asyncio.Future] = {}
        self._numbers = itertools.count(1)
        # the panels heard under the current topic, and the former topics the others said things under
        self._moved: set[str] = set()
        self._former: dict[str, set[str]] = {}

    async def start(self) -> None:
        self._unsubscribe.append(await mqtt.async_subscribe(self.hass, TOPIC + "/#", self._message))
        self._unsubscribe.append(await mqtt.async_subscribe(self.hass, FORMER_TOPIC + "/#", self._former_message))

    def stop(self) -> None:
        for unsubscribe in self._unsubscribe:
            unsubscribe()
        self._unsubscribe.clear()

    @callback
    def _message(self, msg) -> None:
        name = msg.topic[len(TOPIC) + 1:].partition("/")[0]
        if name and name not in self._moved:
            self._moved.add(name)
            # the panel runs the current firmware: its schedule is what it says here, and the former topic's goes
            if self.panels.pop(name, None) is not None:
                for listener in list(self.listeners):
                    listener(name, "*")
            for topic in self._former.pop(name, set()):
                self.hass.async_create_task(mqtt.async_publish(self.hass, topic, "", retain=True))
        self._heard(msg.topic[len(TOPIC) + 1:], msg)

    @callback
    def _former_message(self, msg) -> None:
        rest = msg.topic[len(FORMER_TOPIC) + 1:]
        name = rest.partition("/")[0]
        if not name:
            return
        if name in self._moved:
            if msg.payload:
                self.hass.async_create_task(mqtt.async_publish(self.hass, msg.topic, "", retain=True))
            return
        self._former.setdefault(name, set()).add(msg.topic)
        self._heard(rest, msg)

    def _heard(self, rest: str, msg) -> None:
        """a message of a panel's, by what follows the topic's prefix: its name, then what it says"""
        name, _, rest = rest.partition("/")
        if not name:
            return
        panel = self.panels.setdefault(name, Panel(name))
        try:
            changed = panel.heard(rest, msg.payload)
        except ValueError:
            _LOGGER.warning("%s: not JSON on %s", name, msg.topic)
            return
        if changed is None:
            return
        if panel.result and panel.result not in self._results:
            self._results.add(panel.result)
            self.hass.async_create_task(self._listen(panel.result))
        for listener in list(self.listeners):
            listener(name, changed)

    async def _listen(self, topic: str) -> None:
        self._unsubscribe.append(await mqtt.async_subscribe(self.hass, topic, self._result))

    @callback
    def _result(self, msg) -> None:
        answer = answer_of(msg.payload)
        if answer is None:
            return
        waiting = self._waiting.pop(answer.get("n"), None)
        if waiting is not None and not waiting.done():
            waiting.set_result(answer)

    async def ask(self, panel: Panel, request: dict) -> dict:
        """A request to a panel's Schedule command, and its answer; a refusal is a ScheduleError with the panel's words"""
        if not panel.command:
            raise ScheduleError("The panel has not said where its schedule is changed yet.")
        n = next(self._numbers)
        waiting = self.hass.loop.create_future()
        self._waiting[n] = waiting
        await mqtt.async_publish(self.hass, panel.command, json.dumps({"n": n, **request}), qos=1)
        try:
            answer = await asyncio.wait_for(waiting, ANSWER_S)
        except asyncio.TimeoutError as err:
            self._waiting.pop(n, None)
            raise ScheduleError("The panel did not answer.") from err
        if not answer.get("ok"):
            raise ScheduleError(str(answer.get("message") or answer.get("error") or "The panel refused it."))
        return answer
