# berry/zbbridge_alarm.be, the house alarm of one bridge: the sensors' roles, the states and their
# times, the bypass, the notifications by grade and a numeric condition's margin, the tamper, the quiet sensor, the panic and
# its actions, the events, what is said to the panel, what the flash keeps, and the relay that hands it the reports and the
# panel's commands. The Zigbee radio, the clock's source and Home Assistant are the bench's.

import json
import persist
import string

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if str(got) != str(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

var DOOR = "0x00124B0000AA0001"
var PIR = "0x00124B0000AA0002"
var SMOKE = "0x00124B0000AA0003"
var HUM = "0x00124B0000AA0004"
var SIREN = "0x00124B0000AA0009"
var LAMP = "0x00124B0000AA000A"
var BTN = "0x00124B0000AA0020"
var DOOR2 = "0x00124B0000AA0030"
var PIR2 = "0x00124B0000AA0031"

tasmota.utc_now = 1790000000

# an alarm with no relay, its messages kept, its silence and its addresses given by the test
var said = []
var quiet_for = {}
def wipe(m)
    for k: m.keys()  m.remove(k) end
end
def empty(l)
    while size(l) > 0  l.pop() end
end
def fresh()
    persist.zero()
    wipe(tasmota.timers)
    empty(tasmota.cmds)
    empty(said)
    wipe(quiet_for)
    var a = ZbBridgeAlarm(nil)
    a.emit = def (m) said.push(m["ZbAlarm"]) end
    a.seen_fn = / ieee -> quiet_for.find(ieee)
    a.resolve_fn = / key -> key
    return a
end

# Z2T, the coordinator's driver, as global.zigbee: up or not, as the test says, and where the alarm looks for it
class FakeZ2t
    var up
    def init() self.up = false end
    def started() return self.up end
end

# a relay with a discovery that is on or off, for what Home Assistant is told
class FakeDiscovery
    var flag
    def init(flag) self.flag = flag end
    def on() return self.flag end
end
class FakeRelay
    var discovery
    var drivers
    def init(flag) self.discovery = FakeDiscovery(flag) end
    def send_event(e) end
end

# the timer of an id, run and gone, as Tasmota would at its time
def fire(id)
    return tasmota.timers.fire(id)
end

def set(a, m) return a.cmd(m) end
def types(a)
    var out = []
    for e: a.events out.push(e["y"]) end
    return out
end
# the events of setting the alarm up out of its list, for a test of something else that sets it up in the middle
def drop_config(a)
    var i = 0
    while i < size(a.events)
        if a.events[i]["y"] == "config"  a.events.remove(i) else i += 1 end
    end
end
# the last message said with a key
def last(key)
    var i = size(said) - 1
    while i >= 0
        if said[i].contains(key) return said[i] end
        i -= 1
    end
    return nil
end

# the sensors of a house: a door one comes in by, a motion sensor inside, smoke, a bathroom's humidity, and a siren
def house()
    var a = fresh()
    set(a, {"do": "sensor", "id": DOOR, "role": "perimeter", "entry": true, "notify": "house", "sound": true})
    set(a, {"do": "sensor", "id": PIR, "role": "interior"})
    set(a, {"do": "sensor", "id": SMOKE, "role": "24h", "notify": "alert"})
    set(a, {"do": "sensor", "id": HUM, "notify": "local", "key": "Humidity", "way": "above", "limit": 70})
    set(a, {"do": "siren", "id": SIREN})
    set(a, {"do": "times", "exit": 30, "entry": 30, "siren": 300})
    # the setting up is not what the test is of: its events and its messages are not in the lists
    empty(a.events)
    empty(said)
    return a
end

# what the alarm sends the siren to turn it on or off
def siren_cmd(on) return 'ZbSend {"Device":"' + SIREN + '","Send":{"Power":' + (on ? '1' : '0') + '}}' end
def door(a, on) a.report(DOOR, {"Contact": on ? 1 : 0, "ZoneStatus": on ? 1 : 0}) end
def motion(a, on) a.report(PIR, {"Occupancy": on ? 1 : 0}) end

# --- the record ------------------------------------------------------------------------------------
def record_checks()
    var a = house()
    check("a sensor's record is kept, its address in capitals", a.cfg["sensors"][DOOR], {"role": "perimeter", "entry": true, "notify": "house", "sound": true})
    check("and in the flash", persist.store["zb_alarm_cfg"]["sensors"].contains(PIR), true)
    check("a numeric one has its condition", a.cfg["sensors"][HUM]["cond"], {"k": "Humidity", "w": "above", "x": 70})
    check("a sensor named in lower case is the same one", set(a, {"do": "sensor", "id": "0x00124b0000aa0002", "entry": false}), true)
    check("and still one record", size(a.cfg["sensors"]), 4)
    check("a role that is not one is refused", set(a, {"do": "sensor", "id": DOOR, "role": "guard"}), false)
    check("and a grade that is not one", set(a, {"do": "sensor", "id": DOOR, "notify": "loud"}), false)
    check("and the record is as it was", a.cfg["sensors"][DOOR]["role"], "perimeter")
    set(a, {"do": "sensor", "id": PIR, "role": "off"})
    check("a sensor with no role, no notification and no condition is out of the alarm", a.cfg["sensors"].contains(PIR), false)
    check("the times", a.times(), [30, 30, 300])
    check("a time past 15 minutes is refused", set(a, {"do": "times", "siren": 901}), false)
    check("the siren is a device on the list", a.cfg["sirens"], [SIREN])
    set(a, {"do": "siren", "id": SIREN, "on": false})
    check("and off it", a.cfg["sirens"], [])
    var b = ZbBridgeAlarm(nil)
    check("a new alarm reads the flash: the sensors and the times", [size(b.cfg["sensors"]), b.times()], [3, [30, 30, 300]])
end
record_checks()

# --- setting the alarm up is an event ------------------------------------------------------------------------
# Siren time 0, a sensor taken out, the siren taken off the list: nothing of it left a trace
def config_event_checks()
    var a = fresh()
    var n = size(a.events)
    check("a sensor taken into the alarm is an event of the house: of the panel, about its sensor setting",
          [set(a, {"do": "sensor", "id": DOOR, "role": "perimeter"}), a.events[-1]["y"], a.events[-1]["d"], a.events[-1]["v"], a.events[-1]["g"]], [true, "config", "panel", "sensor", "house"])
    check("and said to the panel, as every event is", said[-1]["ev"][2], "config")
    check("the siren time, the siren list and the panic's settings too", [set(a, {"do": "times", "siren": 0}), set(a, {"do": "siren", "id": SIREN}), set(a, {"do": "panic_cfg", "alarm": true}),
          size(a.events) - n, a.events[-3]["v"], a.events[-2]["v"], a.events[-1]["v"]], [true, true, true, 4, "times", "siren", "panic"])
    n = size(a.events)
    set(a, {"do": "sensor", "id": DOOR, "entry": true, "sound": true, "news": 2})
    set(a, {"do": "sensor", "id": HUM, "key": "Humidity", "way": "above", "limit": 70})
    set(a, {"do": "burst", "id": BTN, "on": false})
    check("a sensor's entry door, sound and condition, and a device left out of the burst are not", size(a.events), n)
    check("a word that is refused is not one either", [set(a, {"do": "sensor", "id": DOOR, "role": "guard"}), set(a, {"do": "times", "exit": 901}), size(a.events)], [false, false, n])
    set(a, {"do": "sensor", "id": DOOR, "role": "off"})
    check("the sensor's role taken off is, the sensor going out of the alarm", [a.events[-1]["y"], a.events[-1]["v"], a.cfg["sensors"].contains(DOOR)], ["config", "sensor", false])
    set(a, {"do": "times", "exit": 10, "by": "ha"})
    check("who it was is in the event when the word says", a.events[-1]["d"], "ha")
    check("the flash's log, of the changes of state, does not keep it", ZbBridgeAlarm.STATE_EVENTS.find("config"), nil)
    check("and Home Assistant's event entity knows the type", ZbBridgeAlarm.EVENT_TYPES.find("config") != nil, true)
end
config_event_checks()

# --- arming, the exit time, the entry time -------------------------------------------------------------
def arm_checks()
    var a = house()
    check("it starts disarmed", [a.st, a.mode], ["disarmed", nil])
    check("an arm that is not home or away is refused", a.cmd({"do": "arm", "mode": "night"}), false)
    check("armed away: the exit time first", [a.cmd({"do": "arm", "mode": "away"}), a.st], [true, "arming"])
    check("the state is said, with its mode", said[-1], {"st": "arming", "v": 1, "md": "away"})
    check("an event of the arm, with who and the mode", [a.events[-1]["y"], a.events[-1]["d"], a.events[-1]["v"]], ["arm", "panel", "away"])
    check("the exit time is a timer", tasmota.timers.contains("zb_alarm_exit"), true)
    door(a, true)
    check("a sensor that opens in the exit time does not trigger it", a.st, "arming")
    door(a, false)
    check("the timer ends the exit", [fire("zb_alarm_exit"), a.st], [true, "armed_away"])
    check("and the flash keeps the state and its mode", [persist.store["zb_alarm_state"]["s"], persist.store["zb_alarm_state"]["m"]], ["armed_away", "away"])
    check("the entry door opens: the entry time, with its cause", [door(a, true), a.st, a.cause], [nil, "pending", [DOOR, "open"]])
    check("the entry time is a timer", tasmota.timers.contains("zb_alarm_entry"), true)
    check("disarmed in time: no trigger, no siren", [a.cmd({"do": "disarm"}), a.st, a.mode, tasmota.timers.contains("zb_alarm_entry")], [true, "disarmed", nil, false])
    check("disarming a disarmed alarm changes nothing", a.cmd({"do": "disarm"}), false)
    check("an exit of no seconds arms at once", [set(a, {"do": "times", "exit": 0}), a.cmd({"do": "arm", "mode": "home"}), a.st], [true, true, "armed_home"])
    door(a, false)
end
arm_checks()

# --- the roles, in each mode -----------------------------------------------------------------------------
def role_checks()
    var a = house()
    set(a, {"do": "times", "exit": 0})
    a.cmd({"do": "arm", "mode": "home"})
    motion(a, true)
    check("an interior sensor does not watch at home", a.st, "armed_home")
    motion(a, false)
    door(a, true)
    check("a perimeter one does, and the entry door gives the entry time", a.st, "pending")
    fire("zb_alarm_entry")
    check("the entry time ends in the trigger", [a.st, a.cause], ["triggered", [DOOR, "open"]])
    check("the trigger is an event of the alarm's grade, with the cause", [a.events[-1]["y"], a.events[-1]["g"], a.events[-1]["v"]], ["trigger", "alarm", "open"])
    check("the siren is turned on", tasmota.cmds[-1], 'ZbSend {"Device":"' + SIREN + '","Send":{"Power":1}}')
    check("the siren has its time", tasmota.timers.contains("zb_alarm_siren"), true)
    fire("zb_alarm_siren")
    check("the siren time ends: the siren off, and the alarm back to armed", [a.st, tasmota.cmds[-1]], ["armed_home", 'ZbSend {"Device":"' + SIREN + '","Send":{"Power":0}}'])
    check("with the end of the siren as an event", a.events[-1]["y"], "siren_off")
    a.cmd({"do": "disarm"})
    door(a, false)
    a.cmd({"do": "arm", "mode": "away"})
    motion(a, true)
    check("an interior sensor triggers an alarm armed away, at once", [a.st, a.cause], ["triggered", [PIR, "motion"]])
    a.cmd({"do": "disarm"})
    check("disarmed from a trigger: the siren off, nothing armed", [a.st, a.mode, tasmota.cmds[-1]], ["disarmed", nil, 'ZbSend {"Device":"' + SIREN + '","Send":{"Power":0}}'])
    motion(a, false)
    a.cmd({"do": "arm", "mode": "away"})
    door(a, true)
    check("the entry door gives time in away too", a.st, "pending")
    motion(a, true)
    check("and an interior sensor in the entry time is let go: someone coming in", a.st, "pending")
    set(a, {"do": "sensor", "id": "0x00124B0000AA0010", "role": "perimeter"})
    a.report("0x00124B0000AA0010", {"Contact": 1})
    check("another perimeter sensor in the entry time triggers at once", a.st, "triggered")
    check("a trigger when one is in progress adds nothing", [a.trigger("x", "open"), types(a)[-1] == "trigger"], [nil, true])
    a.cmd({"do": "disarm"})
    door(a, false)
    motion(a, false)
    a.report("0x00124B0000AA0010", {"Contact": 0})
    # a 24 h sensor triggers a disarmed alarm, and the siren time sends it back disarmed
    a.report(SMOKE, {"Fire": 1})
    check("a 24 h sensor triggers a disarmed alarm", [a.st, a.cause], ["triggered", [SMOKE, "smoke"]])
    fire("zb_alarm_siren")
    check("and the siren time sends it back disarmed", [a.st, a.mode], ["disarmed", nil])
    a.report(SMOKE, {"Fire": 0})
    check("armed again, in the home mode", [a.cmd({"do": "arm", "mode": "home"}), a.st], [true, "armed_home"])
    a.report(SMOKE, {"Fire": 1})
    fire("zb_alarm_siren")
    check("armed home, back to armed home", a.st, "armed_home")
end
role_checks()

# --- the bypass --------------------------------------------------------------------------------------------
def bypass_checks()
    var a = house()
    door(a, true)
    check("a door open while disarmed is a notification of the house", types(a), ["open"])
    a.cmd({"do": "arm", "mode": "away"})
    check("armed with it open: left out, with an event", [types(a)[-2], a.events[-2]["d"], a.bypassed.contains(DOOR)], ["bypass", DOOR, true])
    fire("zb_alarm_exit")
    door(a, true)
    door(a, false)
    check("it open and closed again does not trigger what it was left out of", a.st, "armed_away")
    door(a, true)
    check("and back in, it does: closing took it back in", a.st, "pending")
    a.cmd({"do": "disarm"})
    door(a, false)
end
bypass_checks()

# --- what opens in the exit time, and what a restart loses --------------------------------------------------
def exit_checks()
    var a = house()
    a.cmd({"do": "arm", "mode": "away"})
    door(a, true)
    check("a door that opens in the exit time does not trigger it", [a.st, types(a)], ["arming", ["arm", "open"]])
    fire("zb_alarm_exit")
    check("and is left out when the exit time ends, with an event, as one open at the arm is", [a.st, types(a)[-1], a.bypassed.contains(DOOR)], ["armed_away", "bypass", true])
    check("the event is of the door, and was before the state was said", [a.events[-1]["d"], last("st")["st"]], [DOOR, "armed_away"])
    door(a, true)
    door(a, false)
    door(a, true)
    check("and it is back in once it closed: opened again it triggers, by the entry time", a.st, "pending")
    a.cmd({"do": "disarm"})
    door(a, false)
    # one that opened and closed in the exit time is no bypass
    a.cmd({"do": "arm", "mode": "away"})
    door(a, true)
    door(a, false)
    var n = size(a.events)
    fire("zb_alarm_exit")
    check("a door that opened and closed again in the exit time is not left out", [a.bypassed.contains(DOOR), size(a.events), a.st], [false, n, "armed_away"])
    a.cmd({"do": "disarm"})
    # an interior sensor is not left out of an arm at home, which it does not watch
    a.cmd({"do": "arm", "mode": "home"})
    motion(a, true)
    n = size(a.events)
    fire("zb_alarm_exit")
    check("an interior sensor on at the end of an exit at home is no bypass, it does not watch there", [a.bypassed.contains(PIR), size(a.events), a.st], [false, n, "armed_home"])
    a.cmd({"do": "disarm"})
    motion(a, false)
    # an exit time of 0: the arm's loop does it, and the end of the exit does not say it again
    set(a, {"do": "times", "exit": 0})
    door(a, true)
    a.cmd({"do": "arm", "mode": "away"})
    check("with no exit time, the bypass is said once", [a.st, types(a)[-2 ..]], ["armed_away", ["bypass", "arm"]])
end
exit_checks()

def seed_checks()
    import global as natives
    var z2t = FakeZ2t()
    natives.zigbee = z2t
    var a = house()
    # a restart: the alarm knows no zone, and Z2T's record says the door is open and the motion sensor is not
    a.zones_fn = def () return {DOOR: {"Contact": 1, "ZoneStatus": 1}, PIR: {"Occupancy": 0}, HUM: {"Humidity": 50}} end
    a.every_second()
    check("with Z2T not up there is nothing to seed from", a.cur, {})
    z2t.up = true
    a.every_second()
    check("the first second it is up, the zones are where Z2T says: the open one open, a sensor with no zone nothing", [a.cur.find(DOOR), a.cur.find(PIR), a.cur.contains(HUM)], [true, false, false])
    check("seeding is no notification: nothing said, nothing triggered", [a.events, a.st], [[], "disarmed"])
    a.cur[PIR] = true
    a.every_second()
    check("once", a.cur.find(PIR), true)
    # a window open on purpose, its first report after the restart says what the seed did: it is nothing, not the trigger
    var b = house()
    b.zones_fn = def () return {DOOR: {"Contact": 1}} end
    b.cmd({"do": "times", "exit": 0})
    b.boot = true
    b.every_second()
    b.cmd({"do": "arm", "mode": "away"})
    check("armed over a door that Z2T says is open: left out, with its event", [b.st, types(b)[-2 ..]], ["armed_away", ["bypass", "arm"]])
    door(b, true)
    check("and the door's report of the same, after the restart, is nothing", b.st, "armed_away")
    # a sensor the seed has closed, which opens: it is what it is
    var c = house()
    c.zones_fn = def () return {DOOR: {"Contact": 0}} end
    c.cmd({"do": "times", "exit": 0})
    c.boot = true
    c.every_second()
    c.cmd({"do": "arm", "mode": "away"})
    door(c, true)
    check("a door the seed has closed, and that reports open, is the entry time", c.st, "pending")
    # the seed does not take the place of a report that came first
    var d = house()
    d.zones_fn = def () return {DOOR: {"Contact": 1}} end
    door(d, false)
    d.boot = true
    d.every_second()
    check("a zone the alarm has heard since is not seeded over", d.cur.find(DOOR), false)
    z2t.up = false
end
seed_checks()

# --- the notifications, by grade -----------------------------------------------------------------------------
def notify_checks()
    var a = house()
    door(a, true)
    check("a door with a notification raises it, at its grade, asking for the beep",
          [a.events[0]["y"], a.events[0]["g"], a.events[0]["s"], a.events[0]["d"]], ["open", "house", true, DOOR])
    check("said to the panel, packed", said[0]["ev"], [a.events[0]["i"], 1790000000, "open", DOOR, "house", nil, 1])
    door(a, true)
    check("the same state again is no new event", size(a.events), 1)
    door(a, false)
    check("a house notification stays when the door closes: it is seen, or it stays", a.seen.contains(a.events[0]["i"]), false)
    a.report(HUM, {"Humidity": 65})
    check("a numeric sensor below its limit says nothing", size(a.events), 1)
    a.report(HUM, {"Humidity": 71})
    check("above it, it raises its notification, with the value", [a.events[-1]["y"], a.events[-1]["g"], a.events[-1]["v"]], ["above", "local", 71])
    a.report(HUM, {"Humidity": 75})
    check("staying above says nothing more", size(a.events), 2)
    a.report(HUM, {"Humidity": 69})
    check("a little under the limit is still crossed: the margin is 2", a.seen.contains(a.events[-1]["i"]), false)
    a.report(HUM, {"Humidity": 68})
    check("2 under it clears it, and the local notice goes by itself", [a.seen.contains(a.events[-1]["i"]), last("clr")], [true, {"clr": HUM}])
    a.report(HUM, {"Humidity": 72})
    check("and it can cross again", [size(a.events), a.events[-1]["y"]], [3, "above"])
    set(a, {"do": "sensor", "id": HUM, "key": "Temperature", "way": "below", "limit": 5})
    a.report(HUM, {"Temperature": 4})
    check("a limit below, on another key", [a.events[-1]["y"], a.events[-1]["v"]], ["below", 4])
    a.report(HUM, {"Temperature": 6})
    check("it clears 2 above the limit, not 1", a.seen.contains(a.events[-1]["i"]), false)
    a.report(HUM, {"Temperature": 7})
    check("at 2 above", a.seen.contains(a.events[-1]["i"]), true)
    check("a sensor the alarm does not know says nothing", [a.report("0x00124B0000AA00FF", {"Contact": 1}), size(a.events)], [nil, 4])
    # acknowledged
    check("an event acknowledged", [a.cmd({"do": "ack", "id": a.events[0]["i"]}), a.seen.contains(a.events[0]["i"]), said[-1]], [true, true, {"ack": a.events[0]["i"]}])
    check("all of them", [a.cmd({"do": "ack"}), a.seen.contains(a.events[-1]["i"]), said[-1]], [true, true, {"ack": "all"}])
    # deleted on a panel: out of the list, and the panels told
    var gone = a.events[0]["i"]
    var n = size(a.events)
    check("events deleted on a panel leave the list, and the panels are told", [a.cmd({"do": "del", "ids": [gone]}), size(a.events), a.seen.contains(gone), said[-1]],
          [true, n - 1, false, {"del": [gone]}])
    check("a word with no numbers is let go", a.cmd({"do": "del"}), false)
end
notify_checks()

# --- the tamper, the battery, the zone status ----------------------------------------------------------------------
def tamper_checks()
    var a = house()
    a.report(DOOR, {"ZoneStatus": 4, "Tamper": 1})
    check("a tamper while disarmed is a warning of the house, not a trigger", [a.st, a.events[-1]["y"], a.events[-1]["g"]], ["disarmed", "tamper", "house"])
    check("the zone status alone, with no alarm bit, is a zone that is off", a.cur[DOOR], false)
    a.report(DOOR, {"ZoneStatus": 4, "Tamper": 1})
    check("said again, it is the same tamper", size(a.events), 1)
    a.report(DOOR, {"ZoneStatus": 0})
    a.cmd({"do": "times", "exit": 0})
    a.cmd({"do": "arm", "mode": "home"})
    a.report(DOOR, {"ZoneStatus": 4, "Tamper": 1})
    check("a tamper while armed triggers it", [a.st, a.cause], ["triggered", [DOOR, "tamper"]])
    a.cmd({"do": "disarm"})
    a.report(PIR, {"ZoneStatus": 8, "BatteryLow": 1})
    check("a low battery is a warning of the house, once", [types(a)[-1], a.lows[PIR]], ["battery", true])
    a.report(PIR, {"ZoneStatus": 8, "BatteryLow": 1})
    check("said again, no new event", types(a)[-1], "battery")
    var n = size(a.events)
    a.report(PIR, {"ZoneStatus": 0})
    a.report(PIR, {"ZoneStatus": 8, "BatteryLow": 1})
    check("a status without it clears it, and it can be said again", [size(a.events), types(a)[-1]], [n + 1, "battery"])
    a.report(DOOR, {"ZoneStatus": 1})
    check("the two alarm bits of the raw status: on", a.cur[DOOR], true)
    a.report(DOOR, {"ZoneStatus": 2})
    check("the second bit too", a.cur[DOOR], true)
end
tamper_checks()

# --- the silence --------------------------------------------------------------------------------------------------
def silence_checks()
    var a = house()
    quiet_for[DOOR] = 3600
    a.supervise()
    check("an hour of silence is nothing", size(a.events), 0)
    quiet_for[DOOR] = 5 * 3600
    quiet_for[SMOKE] = 5 * 3600
    quiet_for[HUM] = 5 * 3600
    a.supervise()
    var by = {}
    for e: a.events  by[e["d"]] = e["g"] end
    check("past its hours, a sensor is reported quiet at its grade, and no lower than the house's",
          [types(a), by[DOOR], by[SMOKE], by[HUM]], [["nonews", "nonews", "nonews"], "house", "alert", "house"])
    a.supervise()
    check("once", size(a.events), 3)
    check("it is a warning and not an alarm", a.st, "disarmed")
    a.report(DOOR, {"Contact": 0})
    quiet_for[DOOR] = 5 * 3600
    a.supervise()
    check("a word from it, and then silence again, is reported again", size(a.events), 4)
    set(a, {"do": "sensor", "id": DOOR, "news": 8})
    a.report(DOOR, {"Contact": 0})
    a.supervise()
    check("its hours are its own", size(a.events), 4)
    check("a sensor nothing says anything of is left alone", [quiet_for.contains(PIR), a.silence_of(PIR)], [false, nil])
    check("the supervision comes back by itself", tasmota.timers.contains("zb_alarm_check"), true)
end
silence_checks()

# --- what was lost, and not found again ---------------------------------------------------------------
def loss_checks()
    var a = house()
    # a sensor quiet past its hours is an open loss: kept, in the flash, said as a list, until a word from it
    quiet_for[DOOR] = 5 * 3600
    a.supervise()
    check("a sensor quiet is an open loss, of its kind, at the notice's grade", a.lostset[DOOR], ["sensor", "house"])
    check("kept in the flash, so that a restart does not forget it", persist.store["zb_alarm_lost"][DOOR], ["sensor", "house"])
    check("and the list is said to the panels", last("lo")["lo"], [[DOOR, "sensor", "house"]])
    var b = ZbBridgeAlarm(nil)
    check("a restart has it still", b.lostset[DOOR], ["sensor", "house"])
    a.ack(nil)
    check("a touch on seen does not close it", a.lostset.contains(DOOR), true)
    empty(said)
    a.report(DOOR, {"Contact": 0})
    check("a word from the sensor closes it, and the list and the clearing are said", [a.lostset.contains(DOOR), last("clr")["clr"], last("lo")["lo"]], [false, DOOR, []])
    # armed, what watches is an alert, and what watches nothing stays the house's
    var c = house()
    c.arm("away", "panel")
    quiet_for[DOOR] = 5 * 3600
    quiet_for[HUM] = 5 * 3600
    c.supervise()
    check("armed, a perimeter sensor lost is an alert, and a humidity sensor that guards nothing is the house's", [c.lostset[DOOR][1], c.lostset[HUM][1]], ["alert", "house"])
    # a siren that did not confirm by the fifth order is a loss; its Power closes it
    var d = house()
    d.trigger("x", "open")
    for i: 1 .. 3  fire("zb_alarm_again") end
    check("by the fourth order it is not yet a loss", d.lostset.contains(SIREN), false)
    fire("zb_alarm_again")
    check("by the fifth, a siren that has not confirmed is a loss, an alert while the alarm sounds, with its event", [d.lostset[SIREN], types(d)[-1]], [["siren", "alert"], "unreach"])
    d.heard(SIREN, {"Power": 1})
    check("the siren saying its Power closes it", d.lostset.contains(SIREN), false)
    # a bridge silent on the mesh: one notice, by its number; heard again, found
    var e = house()
    e.bridges([3], [])
    check("a bridge silent on the mesh is lost, once, by its number", [e.lostset["bridge 3"], types(e), e.events[-1]["d"]], [["bridge", "house"], ["unreach"], "bridge 3"])
    e.bridges([3], [])
    check("and not again", size(e.events), 1)
    e.bridges([], [3])
    check("heard again, it is found, and the clearing is said", [e.lostset.contains("bridge 3"), last("clr")["clr"]], [false, "bridge 3"])
    # the house forgets a bridge (house_mesh.be, sweep()): lost, it is no loss of this alarm's any more, and the clearing is said
    e.bridges([3, 5], [])
    e.sweep({1: true, 5: true})
    check("a bridge the house forgot is no loss of the alarm's, and one of the house stays one",
          [e.lostset.contains("bridge 3"), e.lostset.contains("bridge 5"), last("clr")["clr"]], [false, true, "bridge 3"])
    # how many devices an arm would leave unprotected
    var f = house()
    quiet_for[DOOR] = 5 * 3600
    quiet_for[PIR] = 5 * 3600
    quiet_for[HUM] = 5 * 3600
    f.supervise()
    f.bridges([4], [])
    check("lost: the perimeter sensor, the interior one, a humidity sensor that guards nothing, and a bridge", size(f.lostset), 4)
    check("at home an arm leaves the door and the bridge unprotected: the interior sensor does not watch at home", f.unprotected("home"), 2)
    check("away it leaves the interior one too", f.unprotected("away"), 3)
    f.arm("away", "panel")
    check("the arm says how many it left unprotected, and the siren's unreach is not among the sirens lost", last("st")["l"], 3)
    f.disarm("panel")
    check("a disarm says nothing of it", last("st").contains("l"), false)
    # a sensor taken out of the alarm is not lost any more
    set(f, {"do": "sensor", "id": DOOR, "role": "off", "notify": "off"})
    check("taken out of the alarm, a sensor is found", f.lostset.contains(DOOR), false)
end
loss_checks()

# the silence counts from the air time: a sensor that has said nothing since the alarm started is quiet after its hours from the start, with no wall clock
def air_silence_checks()
    var a = house()
    a.seen_fn = nil
    tasmota.at_ms = 1000
    a.boot_ms = 1000
    tasmota.at_ms = 1000 + 3 * 3600 * 1000
    check("a sensor that has not spoken since the start is silent for the time since it", a.silence_of(DOOR), 3 * 3600)
    a.supervise()
    check("three hours is not past the four", size(a.events), 0)
    tasmota.at_ms = 1000 + 5 * 3600 * 1000
    a.supervise()
    check("five hours is: every sensor of the alarm reported quiet, with no wall clock in it", [types(a), a.lostset.contains(DOOR)], [["nonews", "nonews", "nonews", "nonews"], true])
    a.report(DOOR, {"Contact": 0})
    check("a word is silence from then", a.silence_of(DOOR), 0)
    tasmota.at_ms += 7200 * 1000
    check("and counts from it", a.silence_of(DOOR), 7200)
end
air_silence_checks()

# --- the panic ----------------------------------------------------------------------------------------------------
def panic_checks()
    var a = house()
    a.cmd({"do": "panic", "by": "panel"})
    check("the panic by default is an event of the house, and nothing else", [a.st, a.events[-1]["y"], a.events[-1]["g"], tasmota.cmds], ["disarmed", "panic", "house", []])
    set(a, {"do": "panic_cfg", "panels": true})
    a.cmd({"do": "panic"})
    check("with the panels on, an alert", a.events[-1]["g"], "alert")
    set(a, {"do": "panic_cfg", "devices": [[LAMP, "on"]]})
    check("its devices are a list of address and act", a.cfg["panic"]["devices"], [[LAMP, "on"]])
    a.cmd({"do": "panic"})
    check("a device it runs is turned on", tasmota.cmds[-1], 'ZbSend {"Device":"' + LAMP + '","Send":{"Power":1}}')
    check("a device list that is not one is refused", set(a, {"do": "panic_cfg", "devices": [[LAMP]]}), false)
    set(a, {"do": "panic_cfg", "alarm": true, "devices": []})
    a.cmd({"do": "panic"})
    check("with the alarm on, it triggers the house, the siren and all", [a.st, a.cause, tasmota.cmds[-1]], ["triggered", ["panel", "panic"], 'ZbSend {"Device":"' + SIREN + '","Send":{"Power":1}}'])
    check("as an event of the alarm's grade, and then the trigger", [types(a)[-2], a.events[-2]["g"], types(a)[-1]], ["panic", "alarm", "trigger"])
    check("the panic is a change of state, and the flash keeps it", persist.find("zb_alarm_log", nil)[-1][2], "trigger")
end
panic_checks()

# --- the settings said whole, in frames -----------------------------------------------------------------
# an address with a number to it, as a device's: 0x00124B0000CC0010 and on
def addr(i) return "0x00124B0000CC" + string.format("%04X", 16 + i) end
# the frames of one key, put together as the panel does: the first, then each at its place
def put_back(key)
    var out = nil
    for m: said
        if m.contains(key)
            if !m.contains("at")  out = m[key].copy() elif out != nil && m["at"] == size(out)  for e: m[key] out.push(e) end end
        end
    end
    return out
end
def config_frames_checks()
    var a = house()
    var pd = []
    var np = []
    var sirens = [SIREN]
    for i: 0 .. 13  pd.push([addr(i), ["on", "off", "open", "close"][i % 4]]) end
    set(a, {"do": "panic_cfg", "devices": pd})
    for i: 0 .. 12  set(a, {"do": "burst", "id": addr(i), "on": false}) np.push(addr(i)) end
    for i: 20 .. 27  set(a, {"do": "siren", "id": addr(i)}) sirens.push(addr(i)) end
    check("the alarm keeps the 14 devices of the panic, the 13 left out of the burst and its 9 sirens", [size(a.cfg["panic"]["devices"]), size(a.cfg["nopanic"]), size(a.cfg["sirens"])], [14, 13, 9])
    empty(said)
    check("the panel asks for the settings", set(a, {"do": "config"}), true)
    var wide = 0
    for m: said
        var n = size(json.dump({"ZbAlarm": m}))
        if n > wide  wide = n end
    end
    check("every message of them fits a frame of the link", wide <= 233, true)
    check("the panic's devices are said whole, 14 of them", put_back("pd"), a.cfg["panic"]["devices"])
    check("so are the ones left out of the burst", put_back("np"), a.cfg["nopanic"])
    var s = said[0]["cfg"]["s"].copy()
    for m: said  if m.contains("sr") && m["at"] == size(s)  for e: m["sr"] s.push(e) end end end
    check("and the sirens: the first six in the cfg message and the rest after them", s, a.cfg["sirens"])
    check("a list is a message of at most six entries, with its place when it is not the first", [size(said[0]["cfg"]["s"]), said[1]["sr"][0], said[1]["at"]], [6, addr(25), 6])
    # a list of one frame is the message it always was, and one with nothing in it is a message too: the panel empties its own
    var b = house()
    empty(said)
    set(b, {"do": "config"})
    check("a short list is one message with no place", [said[0]["cfg"]["s"], said[1], said[2]], [[SIREN], {"np": []}, {"pd": []}])
end
config_frames_checks()

# --- a burst on any device is the panic --------------------------------------------
def press(a, ieee, p) a.heard(ieee, {"Power": p}) end
def burst_checks()
    var a = house()
    tasmota.at_ms = 10000
    for i: 1 .. 7
        press(a, BTN, 2)
        tasmota.at_ms += 300
    end
    check("seven toggles of a button are not the panic", types(a), [])
    press(a, BTN, 2)
    check("the eighth within 3 s is: a panic event, the device its origin, quiet by default",
          [types(a), a.events[-1]["d"], a.events[-1]["g"], a.st], [["panic"], BTN, "house", "disarmed"])
    for i: 1 .. 7
        tasmota.at_ms += 300
        press(a, BTN, 2)
    end
    check("after it the count starts again: seven more are not another", size(a.events), 1)
    tasmota.at_ms += 300
    press(a, BTN, 2)
    check("and the eighth is", size(a.events), 2)
    # too slow: eight in 4.2 s is at most six in a window of 3 s
    var b = house()
    tasmota.at_ms = 50000
    for i: 1 .. 8
        press(b, BTN, 2)
        tasmota.at_ms += 600
    end
    check("eight presses in four seconds are not a frenzy", types(b), [])
    # a switch that changes: its first report is only where it stands
    var c = house()
    tasmota.at_ms = 60000
    for i: 1 .. 8
        press(c, LAMP, i % 2)
        tasmota.at_ms += 200
    end
    check("a switch alternated: the first report is a baseline, and seven changes are not eight", types(c), [])
    press(c, LAMP, 1)
    check("the eighth change is", types(c), ["panic"])
    # a zone: only its turning on counts, and the closing does not
    var d = house()
    tasmota.at_ms = 70000
    for i: 1 .. 7
        d.heard(DOOR2, {"Contact": 1})
        d.heard(DOOR2, {"Contact": 0})
        tasmota.at_ms += 200
    end
    check("a zone turned on seven times is not the panic", types(d), [])
    d.heard(DOOR2, {"Contact": 1})
    check("the eighth is", types(d), ["panic"])
    d.heard(DOOR2, {"Contact": 1})
    check("a zone said on twice in a row is one turning on", size(d.events), 1)
    # a presence sensor retriggers by itself
    var e = house()
    tasmota.at_ms = 80000
    for i: 1 .. 20
        e.heard(PIR2, {"Occupancy": 1})
        e.heard(PIR2, {"Occupancy": 0})
        tasmota.at_ms += 50
    end
    check("a presence sensor is never a burst", types(e), [])
    # the echo of a command of ours
    var f = house()
    tasmota.at_ms = 90000
    f.heard(LAMP, {"Power": 0})
    f.commanded('ZbSend {"Device":"' + LAMP + '","Send":{"Power":1}}')
    for i: 1 .. 12
        tasmota.at_ms += 100
        press(f, LAMP, i % 2)
    end
    check("the reports of a device that follow our command are its echo", types(f), [])
    tasmota.at_ms += 2500
    for i: 1 .. 9
        tasmota.at_ms += 100
        press(f, LAMP, i % 2)
    end
    check("and after the echo they count again", types(f), ["panic"])
    # the channels of a switch of several: each keeps its own last Power, and its own count
    var ch = house()
    tasmota.at_ms = 105000
    for i: 1 .. 14
        tasmota.at_ms += 100
        ch.heard(LAMP, {"Power": 0, "Endpoint": 1})
        ch.heard(LAMP, {"Power": 1, "Endpoint": 2})
    end
    check("two channels that each stay as they were are no toggles, whatever the order of their reports", types(ch), [])
    for i: 1 .. 9
        tasmota.at_ms += 200
        ch.heard(LAMP, {"Power": i % 2, "Endpoint": 2})
    end
    check("the eighth change of a channel is the panic, and its origin is the channel", [types(ch), ch.events[-1]["d"]], [["panic"], LAMP + "/2"])
    var cn = house()
    tasmota.at_ms = 120000
    set(cn, {"do": "burst", "id": LAMP + "/2", "on": false})
    check("a channel is left out of the burst by its own id", cn.cfg["nopanic"], [LAMP + "/2"])
    for i: 1 .. 12
        tasmota.at_ms += 100
        cn.heard(LAMP, {"Power": i % 2, "Endpoint": 2})
    end
    check("and its toggles are not the panic", types(cn), [])
    var hue = house()
    tasmota.at_ms = 130000
    for i: 1 .. 9
        tasmota.at_ms += 100
        hue.heard(LAMP, {"Power": i % 2, "Endpoint": 11})
    end
    check("a lamp's endpoint 11 is the device: its origin is the IEEE", [types(hue), hue.events[-1]["d"]], [["panic"], LAMP])
    var g = house()
    tasmota.at_ms = 100000
    g.heard(LAMP, {"Power": 0})
    g.commanded('ZbSend {"Group":256,"Send":{"Power":1}}')
    for i: 1 .. 12
        tasmota.at_ms += 100
        press(g, LAMP, i % 2)
    end
    check("a group command is the echo of every device", types(g), [])
    g.siren(true)
    check("a siren turned on is the echo of itself", g.echoed(SIREN), true)
    # only a switch's Power 0 or 1 is an echo: a zone turning on, or a button's toggle, in the second after a group command
    # is a hand on the device
    var m = house()
    tasmota.at_ms = 105000
    m.commanded('ZbSend {"Group":256,"Send":{"Power":1}}')
    for i: 1 .. 8
        m.heard(DOOR2, {"Contact": 1})
        m.heard(DOOR2, {"Contact": 0})
        tasmota.at_ms += 100
    end
    check("a zone that turns on eight times in the echo of a group command is the burst: the echo is of a switch's Power", types(m), ["panic"])
    var n = house()
    tasmota.at_ms = 106000
    n.commanded('ZbSend {"Group":256,"Send":{"Power":1}}')
    for i: 1 .. 8
        press(n, BTN, 2)
        tasmota.at_ms += 100
    end
    check("and so is a button's toggle", types(n), ["panic"])
    # a device left out, the count turned off, another count
    var h = house()
    tasmota.at_ms = 110000
    check("a device is left out of the burst", [set(h, {"do": "burst", "id": BTN, "on": false}), h.cfg["nopanic"]], [true, [BTN]])
    for i: 1 .. 10
        press(h, BTN, 2)
        tasmota.at_ms += 100
    end
    check("and ten presses of it are nothing", types(h), [])
    set(h, {"do": "burst", "id": BTN, "on": true})
    for i: 1 .. 8
        press(h, BTN, 2)
        tasmota.at_ms += 100
    end
    check("put back, it counts", types(h), ["panic"])
    check("a count out of range is refused", [set(h, {"do": "panic_cfg", "burst": [100, 3]}), set(h, {"do": "panic_cfg", "burst": [8, 0]})], [false, false])
    set(h, {"do": "panic_cfg", "burst": [5, 2]})
    drop_config(h)
    check("the count and the seconds are the settings'", h.cfg["panic"]["burst"], [5, 2])
    for i: 1 .. 5
        press(h, LAMP, 2)
        tasmota.at_ms += 100
    end
    check("five in two seconds, then", types(h), ["panic", "panic"])
    set(h, {"do": "panic_cfg", "burst": [0, 3]})
    drop_config(h)
    for i: 1 .. 30
        press(h, LAMP, 2)
        tasmota.at_ms += 50
    end
    check("a count of 0 turns the burst off", size(h.events), 2)
    # the panic it makes does what the settings say
    var k = house()
    tasmota.at_ms = 130000
    set(k, {"do": "panic_cfg", "alarm": true})
    for i: 1 .. 8
        press(k, BTN, 2)
        tasmota.at_ms += 100
    end
    check("with the alarm on, a device's burst triggers the house", [k.st, k.cause], ["triggered", [BTN, "panic"]])
end
burst_checks()

# --- Home Assistant: the entities, the commands, the events ---------------------------------------------
import mqtt
def ha_checks()
    var a = house()
    empty(mqtt.published)
    mqtt.up = true
    a.every_second()
    var topics = []
    for p: mqtt.published topics.push(p[0]) end
    check("on the broker, the two entities are announced and the state said",
          topics, ["homeassistant/alarm_control_panel/zbalarm_zbbridge-living/config", "homeassistant/event/zbalarm_zbbridge-living_event/config", "zigbee/alarm/zbalarm_zbbridge-living/state"])
    check("all of it retained", [mqtt.published[0][2], mqtt.published[1][2], mqtt.published[2][2]], [true, true, true])
    var cfg = json.load(mqtt.published[0][1])
    check("the alarm panel arms home and away, with no code to arm or to disarm",
          [cfg["supported_features"], cfg["code_arm_required"], cfg["code_disarm_required"], cfg["command_topic"]],
          [["arm_home", "arm_away"], false, false, "zigbee/alarm/zbalarm_zbbridge-living/set"])
    check("and the event entity has the event types", json.load(mqtt.published[1][1])["event_types"][2], "trigger")
    check("the state said is Home Assistant's own word", mqtt.published[2][1], "disarmed")
    check("the command topic is subscribed once", size(mqtt.subs), 1)
    a.every_second()
    check("and the entities are not announced again while it stays up", size(mqtt.published), 3)
    # a command of Home Assistant
    var closure = mqtt.subs[0][1]
    # the broker hands back the retained commands as the connection opens: one of an hour ago is not now's
    tasmota.at_ms = 300000
    a.every_second()
    mqtt.up = false
    a.every_second()
    mqtt.up = true
    a.every_second()
    closure("zigbee/alarm/zbalarm_zbbridge-living/set", 0, "ARM_AWAY", nil)
    check("a command in the 3 s after the broker connected is a retained one, and is not taken", [a.st, tasmota.timers.contains("zb_alarm_exit")], ["disarmed", false])
    tasmota.at_ms += 3100
    closure("zigbee/alarm/zbalarm_other-bridge/set", 0, "ARM_AWAY", nil)
    check("one on another bridge's topic is not this alarm's, whenever it comes", a.st, "disarmed")
    a.cmd({"do": "arm", "mode": "home"})
    closure("zigbee/alarm/zbalarm_other-bridge/set", 0, "DISARM", nil)
    check("and a DISARM on another's does not disarm this one", a.st, "arming")
    a.cmd({"do": "disarm"})
    # a command before the second that saw the connection, with the broker down at the last second, is a retained one too
    mqtt.up = false
    a.every_second()
    closure("zigbee/alarm/zbalarm_zbbridge-living/set", 0, "ARM_AWAY", nil)
    check("and one that comes while the alarm still has the broker down", a.st, "disarmed")
    mqtt.up = true
    a.every_second()
    tasmota.at_ms += 3100
    empty(mqtt.published)
    closure("zigbee/alarm/zbalarm_zbbridge-living/set", 0, "ARM_AWAY", nil)
    check("ARM_AWAY arms away, with Home Assistant as who", [a.st, a.mode, a.events[-1]["d"]], ["arming", "away", "ha"])
    var out = []
    for p: mqtt.published out.push(p[0] + "=" + str(p[2])) end
    check("the state is said at once, retained, and the event of the arm not", out[-1], "zigbee/alarm/zbalarm_zbbridge-living/state=true")
    check("the state said is arming", mqtt.published[-1][1], "arming")
    var events = []
    for p: mqtt.published if p[0] == "zigbee/alarm/zbalarm_zbbridge-living/event" events.push(json.load(p[1])) end end
    check("an event to the event entity, with its type, who and grade, not retained", [size(events), events[0]["event_type"], events[0]["who"], events[0]["grade"]], [1, "arm", "ha", "house"])
    check("and not retained", [mqtt.published[0][0], mqtt.published[0][2]], ["zigbee/alarm/zbalarm_zbbridge-living/event", false])
    fire("zb_alarm_exit")
    closure("zigbee/alarm/zbalarm_zbbridge-living/set", 0, "ARM_HOME", nil)
    check("ARM_HOME arms home", [a.st, a.mode], ["arming", "home"])
    closure("zigbee/alarm/zbalarm_zbbridge-living/set", 0, "DISARM", nil)
    check("DISARM disarms, with no code", [a.st, a.events[-1]["d"]], ["disarmed", "ha"])
    closure("zigbee/alarm/zbalarm_zbbridge-living/set", 0, "ARM_NIGHT", nil)
    closure("zigbee/alarm/zbalarm_zbbridge-living/set", 0, "nonsense", nil)
    check("a command it does not have, or does not know, does nothing", a.st, "disarmed")
    # a panic reaches Home Assistant unless the settings say it does not
    empty(mqtt.published)
    a.cmd({"do": "panic"})
    check("a panic is an event for Home Assistant", [mqtt.published[-1][0], json.load(mqtt.published[-1][1])["event_type"]], ["zigbee/alarm/zbalarm_zbbridge-living/event", "panic"])
    set(a, {"do": "panic_cfg", "ha": false})
    empty(mqtt.published)
    a.cmd({"do": "panic"})
    check("with Send to HA off, it does not", size(mqtt.published), 0)
    # the broker back: announced again
    mqtt.up = false
    a.every_second()
    empty(mqtt.published)
    mqtt.up = true
    a.every_second()
    check("a broker that comes back has the entities again", size(mqtt.published), 3)
    # the discovery off: nothing is announced, and nothing said
    var b = ZbBridgeAlarm(FakeRelay(false))
    b.emit = def (m) end
    mqtt.up = false
    b.every_second()
    empty(mqtt.published)
    mqtt.up = true
    b.every_second()
    check("with the panel's Discovery off, nothing is announced", size(mqtt.published), 0)
    b.arm("away", "panel")
    check("and nothing is said", size(mqtt.published), 0)
    mqtt.up = false
end
ha_checks()

# --- the link, the log, the flash -----------------------------------------------------------------------------------
def link_checks()
    var a = house()
    a.say_state()
    check("the state said at the link's coming up", said[-1], {"st": "disarmed", "v": 0})
    a.cmd({"do": "arm", "mode": "home"})
    fire("zb_alarm_exit")
    check("armed, with its mode", said[-1], {"st": "armed_home", "v": 2, "md": "home"})
    for i: 1 .. 7  a.event("open", DOOR, "house", nil, false) end
    empty(said)
    a.cmd({"do": "log", "n": 5})
    check("the log: the last five in messages of three, with where they stand", [size(said), size(said[0]["log"]), said[0]["at"], said[0]["of"], size(said[1]["log"]), said[1]["at"]], [2, 3, 0, 5, 2, 3])
    check("an event is a list of seven fields", size(said[0]["log"][0]), 7)
    # the event numbers do not repeat after a restart
    var last_id = a.events[-1]["i"]
    a.cmd({"do": "disarm"})
    var b = ZbBridgeAlarm(nil)
    check("a new alarm after a restart is disarmed, as the flash left it", [b.st, b.mode], ["disarmed", nil])
    check("and its numbers start well above the last saved", b.eid > last_id - 1 && b.eid >= persist.store["zb_alarm_state"]["e"], true)
    a.cmd({"do": "arm", "mode": "away"})
    fire("zb_alarm_exit")
    var c = ZbBridgeAlarm(nil)
    check("armed, it comes back armed", [c.st, c.mode], ["armed_away", "away"])
    a.report(DOOR, {"Contact": 1})
    fire("zb_alarm_entry")
    var d = ZbBridgeAlarm(nil)
    check("a restart in a trigger leaves it armed, and the siren off", [d.st, d.mode], ["armed_away", "away"])
    check("the flash's log keeps only the changes of state", size(persist.find("zb_alarm_log", nil)) <= 16, true)
    var many = house()
    for i: 1 .. 70  many.event("open", DOOR, "house", nil, false) end
    check("the events kept in RAM are 64", size(many.events), 64)
    check("and the oldest go first", many.events[0]["i"], many.eid - 63)
    check("the log of a command that is not one is refused", many.cmd({"do": "dance"}), false)
end
link_checks()

# --- the event numbers never repeat ---------------------------------------------------------------------------
# The number was saved only with a change of state, and a restart added 1000 to it: two restarts between two changes of state
# started at the same place, and the panel threw away the events of the second life as repeats of the first's
def eid_checks()
    var a = house()
    for i: 1 .. 5  a.event("open", DOOR, "house", nil, false) end
    var b = ZbBridgeAlarm(nil)
    b.emit = def (m) end
    check("a restart with no change of state saved since starts above the events before it", b.eid > a.eid, true)
    for i: 1 .. 3  b.event("open", DOOR, "house", nil, false) end
    var c = ZbBridgeAlarm(nil)
    check("and a second restart, before any change of state, above the first's", c.eid > b.eid, true)
    check("each boot saves its start", persist.store["zb_alarm_state"]["e"], c.eid)
    var d = ZbBridgeAlarm(nil)
    check("and a third", d.eid, c.eid + ZbBridgeAlarm.EID_GAP)
    # a long life with no change of state: the number is saved every 100 events, under the gap
    var many = house()
    for i: 1 .. 250  many.event("open", DOOR, "house", nil, false) end
    check("250 events: the flash has the last hundred's", [persist.store["zb_alarm_state"]["e"], many.eid - persist.store["zb_alarm_state"]["e"] < ZbBridgeAlarm.EID_GAP], [200, true])
    var e = ZbBridgeAlarm(nil)
    check("and a restart starts above all of them", e.eid > many.eid, true)
end
eid_checks()

# --- a word that changes nothing is answered with the state -----------------------------------------------------
# a panel's Arm or Disarm goes out and nothing comes back but the state, when it changes: one that lost the last word of the bridge
# stays wrong until the next change, unless the bridge says what it has
def answer_checks()
    var a = house()
    empty(said)
    check("a disarm of a disarmed alarm is false, and says the state", [a.cmd({"do": "disarm"}), last("st")], [false, {"st": "disarmed", "v": 0}])
    a.cmd({"do": "arm", "mode": "away"})
    empty(said)
    check("an arm of the same mode, in its exit time, changes nothing and says the state", [a.cmd({"do": "arm", "mode": "away"}), last("st")], [true, {"st": "arming", "v": 1, "md": "away"}])
    check("no second exit time, no second event of the arm", [tasmota.timers.count("zb_alarm_exit"), types(a)], [1, ["arm"]])
    fire("zb_alarm_exit")
    empty(said)
    check("and armed, the same", [a.cmd({"do": "arm", "mode": "away"}), last("st")["st"], a.st], [true, "armed_away", "armed_away"])
    check("another mode is a change: ARM_HOME of an armed-away alarm re-arms it", [a.cmd({"do": "arm", "mode": "home"}), a.st, a.mode], [true, "arming", "home"])
    fire("zb_alarm_exit")
    a.report(DOOR, {"Contact": 1})
    fire("zb_alarm_entry")
    check("triggered", a.st, "triggered")
    empty(said)
    check("an arm in a trigger is refused, and says the state", [a.cmd({"do": "arm", "mode": "away"}), last("st")["st"]], [false, "triggered"])
    a.cmd({"do": "disarm"})
    door(a, false)
    a.cmd({"do": "arm", "mode": "away"})
    fire("zb_alarm_exit")
    door(a, true)
    check("an arm in the entry time is refused as well: the entry time stays, and the open door is not left out",
          [a.cmd({"do": "arm", "mode": "away"}), a.cmd({"do": "arm", "mode": "home"}), a.st, tasmota.timers.contains("zb_alarm_entry"), a.bypassed.contains(DOOR)], [false, false, "pending", true, false])
    check("and says the state", last("st")["st"], "pending")
    a.cmd({"do": "disarm"})
    door(a, false)
    set(a, {"do": "times", "exit": 0})
    a.cmd({"do": "arm", "mode": "home"})
    check("armed at home, ARM_AWAY is a change, a transition that is legitimate", [a.cmd({"do": "arm", "mode": "away"}), a.st, a.mode], [true, "armed_away", "away"])
    a.cmd({"do": "disarm"})
    set(a, {"do": "times", "exit": 30})
    a.cmd({"do": "arm", "mode": "away"})
    fire("zb_alarm_exit")
    a.report(DOOR, {"Contact": 1})
    fire("zb_alarm_entry")
    empty(said)
    check("an arm that is not a mode is refused, and says the state too", [a.cmd({"do": "arm", "mode": "night"}), last("st")["st"]], [false, "triggered"])
    a.cmd({"do": "disarm"})
    empty(said)
    check("a disarm that disarms says its state once", [a.cmd({"do": "disarm"}), size(said)], [false, 1])
end
answer_checks()

# --- the siren is told again, and watched ------------------------------------------------------------
# a driver that has a device, and the host that holds it, for a siren a driver acts for
class FakeDriver
    var told, ids
    def init() self.told = [] self.ids = [] end
    def command(info, m) self.told.push(m["do"]) self.ids.push(m["id"]) end
end
class FakeHost
    var claimed
    def init() self.claimed = {} end
    def info_for(ieee) return {} end
end
def count_of(line)
    var n = 0
    for c: tasmota.cmds if c == line  n += 1 end end
    return n
end
def read_cmd() return 'ZbSend {"Device":"' + SIREN + '","Read":{"Power":true}}' end
def siren_repeat_checks()
    var a = house()
    a.trigger("x", "open")
    check("a trigger turns the siren on, and the ladder's first wait is 1 s", [tasmota.cmds, tasmota.timers.delay_of("zb_alarm_again")], [[siren_cmd(true)], 1000])
    # the ladder: each firing is one more order with a Read of the Power, and the waits are 1, 2, 4 and 8 s, then 15 s
    var waits = []
    for i: 1 .. 7
        tasmota.timers.fire("zb_alarm_again")
        waits.push(tasmota.timers.delay_of("zb_alarm_again"))
    end
    check("the waits after the orders: 2, 4 and 8 s, then every 15 s", waits, [2000, 4000, 8000, 15000, 15000, 15000, 15000])
    check("each repeat is the order and a Read of the Power: eight orders, seven Reads, and none of them a toggle", [count_of(siren_cmd(true)), count_of(read_cmd())], [8, 7])
    check("a siren that has not confirmed by the fifth order has no confirmation", a.unconfirmed(), [SIREN])
    # a confirmation ends the ladder
    a.heard(SIREN, {"Power": 1})
    check("the siren saying it is on ends the ladder, and it has a confirmation", [tasmota.timers.contains("zb_alarm_again"), a.unconfirmed(), a.sirens_confirmed()], [false, [], true])
    # one that confirmed and then stops on its own with the alarm sounding starts the ladder again, the ON at once
    var before = count_of(siren_cmd(true))
    a.heard(SIREN, {"Power": 0})
    check("a siren that stopped on its own while the alarm sounds is told ON at once, and the ladder starts again at 1 s", [count_of(siren_cmd(true)) - before, tasmota.timers.delay_of("zb_alarm_again")], [1, 1000])
    # a report that contradicts before the order was ever confirmed is a state that has not caught up: nothing starts again
    var again_sent = count_of(siren_cmd(true))
    a.heard(SIREN, {"Power": 0})
    check("a contradicting report from a siren that has not confirmed is not a new order", [count_of(siren_cmd(true)), tasmota.timers.delay_of("zb_alarm_again")], [again_sent, 1000])
    # a disarm: OFF at once and a ladder of its own; the siren saying it is off ends it
    a.cmd({"do": "disarm"})
    check("a disarm sends OFF at once, cuts the ON ladder, and starts the OFF's at 1 s", [tasmota.cmds[-1], tasmota.timers.count("zb_alarm_again"), tasmota.timers.delay_of("zb_alarm_again")], [siren_cmd(false), 1, 1000])
    a.heard(SIREN, {"Power": 0})
    check("and the siren saying it is off ends it", [tasmota.timers.contains("zb_alarm_again"), a.sirens_confirmed()], [false, true])
    # the report of the answer to our own order is a confirmation, not a hand on the device
    check("a siren that answers the order is not a hand on the device: nothing in the burst", size(a.rings), 0)
    # ten minutes with no confirmation: the wait is 60 s, and the order stands
    var slow = house()
    tasmota.at_ms = 1000
    slow.trigger("x", "open")
    for i: 1 .. 5  tasmota.timers.fire("zb_alarm_again") end
    tasmota.at_ms += 600000
    tasmota.timers.fire("zb_alarm_again")
    check("after ten minutes with no confirmation the wait is 60 s, and the order stands", [tasmota.timers.delay_of("zb_alarm_again"), slow.unconfirmed()], [60000, [SIREN]])
    # a trigger in the middle of the OFFs: the ON is the last word, and none of the OFFs follows it
    var c0 = house()
    c0.trigger("x", "open")
    c0.cmd({"do": "disarm"})
    c0.trigger("y", "open")
    empty(tasmota.cmds)
    tasmota.timers.fire("zb_alarm_again")
    check("an OFF still to come after a new trigger does not turn the siren off: only the ON is told again", [count_of(siren_cmd(false)), tasmota.cmds[0], tasmota.timers.count("zb_alarm_again")], [0, siren_cmd(true), 1])
    # the siren's time ending is the order OFF, and the ON stops for good
    empty(tasmota.cmds)
    fire("zb_alarm_siren")
    check("the siren time ending sends OFF at once, and the ladder is the OFF's", [tasmota.cmds, c0.st, tasmota.timers.delay_of("zb_alarm_again")], [[siren_cmd(false)], "disarmed", 1000])
    # no siren, no timer
    var b = fresh()
    b.trigger("x", "open")
    check("with no siren, nothing is told and no timer is set", [tasmota.cmds, tasmota.timers.contains("zb_alarm_again")], [[], false])
    # a siren a driver acts for is told once: a pulse would act again
    var r = FakeRelay(true)
    var host = FakeHost()
    var driver = FakeDriver()
    host.claimed[SIREN] = driver
    r.drivers = host
    persist.zero()
    var c = ZbBridgeAlarm(r)
    c.emit = def (m) end
    c.cfg["sirens"] = [SIREN, LAMP]
    empty(tasmota.cmds)
    c.trigger("x", "open")
    tasmota.timers.fire("zb_alarm_again")
    tasmota.timers.fire("zb_alarm_again")
    check("a siren with a driver is told ON once, by its driver; the one with none is told again", [driver.told, count_of('ZbSend {"Device":"' + LAMP + '","Send":{"Power":1}}')], [["on"], 3])
    c.cmd({"do": "disarm"})
    tasmota.timers.fire_all("zb_alarm_again")
    tasmota.timers.fire_all("zb_alarm_again")
    check("and OFF once by its driver, three times by Z2T", [driver.told, count_of('ZbSend {"Device":"' + LAMP + '","Send":{"Power":0}}')], [["on", "off"], 3])
end
siren_repeat_checks()

def siren_watch_checks()

# --- a siren that is a channel after the first of a switch of several: the command goes to its endpoint ----------------
# the panel keys a channel as the IEEE, a "/" and the endpoint, "0x00124B0000AA000A/2"; without the endpoint a ZbSend reaches the first channel
def siren_channel_checks()
    var ch2 = LAMP + "/2"
    var ch3 = LAMP + "/3"
    var a = house()
    check("a channel is a siren by its own id, in capitals, and the device with it", [set(a, {"do": "siren", "id": "0x00124b0000aa000a/2"}), a.cfg["sirens"]], [true, [SIREN, ch2]])
    check("the id is split as the IEEE and the endpoint; a device and its first channel have no endpoint", [ZbBridgeAlarm.split(ch2), ZbBridgeAlarm.split(LAMP), ZbBridgeAlarm.split(LAMP + "/240")], [[LAMP, 2], [LAMP, nil], [LAMP, 240]])
    var bad = []
    for id: [LAMP + "/", LAMP + "/0", LAMP + "/x", LAMP + "/02", LAMP + "/2x", LAMP + "/241", LAMP + "/-1", "/2"]
        bad.push([ZbBridgeAlarm.split(id), set(a, {"do": "siren", "id": id})])
    end
    check("a '/' that is no endpoint is not a channel, and is refused: the command would go to the first channel", bad,
          [[nil, false], [nil, false], [nil, false], [nil, false], [nil, false], [nil, false], [nil, false], [nil, false]])
    check("and the list is as it was", a.cfg["sirens"], [SIREN, ch2])
    check("a siren on the list twice is one", [set(a, {"do": "siren", "id": ch2}), a.cfg["sirens"]], [true, [SIREN, ch2]])
    a.trigger("x", "open")
    check("a trigger sends the plain siren as it did, and the channel to its endpoint, the device's IEEE as the Device", tasmota.cmds,
          [siren_cmd(true), 'ZbSend {"Device":"' + LAMP + '","Endpoint":2,"Send":{"Power":1}}'])
    check("and no ZbSend names the channel's id as a Device", count_of('ZbSend {"Device":"' + ch2 + '","Send":{"Power":1}}'), 0)
    check("its reports are the echo of the command, which the alarm keys by the device's IEEE", [a.echoed(LAMP), a.echoed(SIREN)], [true, true])
    tasmota.timers.fire("zb_alarm_again")
    check("told again with the others, to the same endpoint", [count_of('ZbSend {"Device":"' + LAMP + '","Endpoint":2,"Send":{"Power":1}}'), count_of(siren_cmd(true))], [2, 2])
    a.cmd({"do": "disarm"})
    tasmota.timers.fire_all("zb_alarm_again")
    tasmota.timers.fire_all("zb_alarm_again")
    check("a disarm sends OFF to the endpoint, three times as for every siren", [count_of('ZbSend {"Device":"' + LAMP + '","Endpoint":2,"Send":{"Power":0}}'), count_of(siren_cmd(false)), a.st], [3, 3, "disarmed"])
    # a channel taken off the list, and another one
    check("a channel is taken off the list by its id", [set(a, {"do": "siren", "id": ch2, "on": false}), set(a, {"do": "siren", "id": ch3}), a.cfg["sirens"]], [true, true, [SIREN, ch3]])
    # whether Z2T reaches the siren is the device's: a siren that is a channel is lost when its device is
    var reach = {}
    var b = house()
    set(b, {"do": "siren", "id": ch2})
    drop_config(b)
    b.reach_fn = / ieee -> reach.find(ieee)
    reach[SIREN] = true
    reach[LAMP] = false
    b.supervise()
    check("a channel's siren is lost when its device cannot be reached (the reach is asked by the IEEE), said by the channel's id", [types(b), b.events[-1]["d"]], [["unreach"], ch2])
    reach[LAMP] = true
    b.supervise()
    reach[LAMP] = false
    b.supervise()
    check("and again when it came back and went", types(b), ["unreach", "unreach"])
    # a device a driver acts for is the driver's, by its IEEE, whatever channel of it is the siren
    var r = FakeRelay(true)
    var host = FakeHost()
    var driver = FakeDriver()
    host.claimed[LAMP] = driver
    r.drivers = host
    persist.zero()
    empty(tasmota.cmds)
    var c = ZbBridgeAlarm(r)
    c.emit = def (m) end
    set(c, {"do": "siren", "id": ch2})
    c.trigger("x", "open")
    tasmota.timers.fire("zb_alarm_again")
    check("a channel of a device with a driver is told by the driver, once, with the device's IEEE, and nothing goes by Z2T", [driver.told, driver.ids, tasmota.cmds], [["on"], [LAMP], []])
end
siren_channel_checks()
    var a = house()
    var reach = {}
    a.reach_fn = / ieee -> reach.find(ieee)
    a.supervise()
    check("a siren Z2T says nothing of is not lost", types(a), [])
    reach[SIREN] = true
    a.supervise()
    check("one that is reachable is not either", types(a), [])
    reach[SIREN] = false
    a.supervise()
    check("a siren Z2T cannot reach is an event of the house while the alarm is disarmed, of the siren", [types(a), a.events[-1]["d"], a.events[-1]["g"]], [["unreach"], SIREN, "house"])
    a.supervise()
    check("once", types(a), ["unreach"])
    reach[SIREN] = true
    a.supervise()
    reach[SIREN] = false
    a.supervise()
    check("and again when it came back and went", types(a), ["unreach", "unreach"])
    # at the arm it is said again, as an alert: the alarm that is armed has no siren to sound
    a.cmd({"do": "arm", "mode": "away"})
    check("an arm with a siren that is lost says it again, an alert, after the arm", [types(a)[-2 ..], a.events[-1]["g"], a.events[-1]["d"]], [["arm", "unreach"], "alert", SIREN])
    a.supervise()
    check("armed, no more while it stays lost", size(types(a)), 4)
    reach[SIREN] = true
    a.cmd({"do": "disarm"})
    a.cmd({"do": "arm", "mode": "away"})
    check("a siren that answers is not said at the arm", types(a)[-1], "arm")
    reach[SIREN] = false
    a.supervise()
    check("armed, one that is lost is an alert", [types(a)[-1], a.events[-1]["g"]], ["unreach", "alert"])
    check("Home Assistant's event entity knows the type", ZbBridgeAlarm.EVENT_TYPES.find("unreach") != nil, true)
    check("the lost siren is not a sensor's silence: the sensors have their own", a.quiet.find(DOOR), nil)
end
siren_watch_checks()

# --- the siren a restart leaves on ----------------------------------------------------------------------------
def siren_boot_checks()
    import mqtt
    mqtt.up = false
    var z2t = FakeZ2t()
    import global as natives
    natives.zigbee = z2t
    var a = house()
    check("a trigger turns the siren on", [a.trigger("x", "open"), tasmota.cmds[-1]], [nil, siren_cmd(true)])
    # the bridge restarts with the siren on: the flash says triggered, and the alarm comes back armed or disarmed, never loud
    var b = ZbBridgeAlarm(nil)
    empty(tasmota.cmds)
    b.every_second()
    check("a restarted alarm sends nothing while Z2T is not up: a ZbSend would fail without a word", tasmota.cmds, [])
    z2t.up = true
    b.every_second()
    check("and the siren off, the first second it is", tasmota.cmds, [siren_cmd(false)])
    b.every_second()
    b.every_second()
    check("once", size(tasmota.cmds), 1)
    # a Disarm that finds it disarmed still sends the siren off: nothing else would cut a siren the restart left on
    empty(tasmota.cmds)
    check("a disarm of a disarmed alarm changes nothing, and is false", [b.cmd({"do": "disarm"}), b.st], [false, "disarmed"])
    check("but cuts the siren", tasmota.cmds[-1], siren_cmd(false))
    # an alarm with no siren sends nothing
    persist.zero()
    var c = ZbBridgeAlarm(nil)
    empty(tasmota.cmds)
    c.every_second()
    check("with no siren, nothing", tasmota.cmds, [])
    z2t.up = false
end
siren_boot_checks()

# --- the flash falls over in a save --------------------------------------------------------------
# A persist.save() that wrote in place would leave the file as {} when its write failed: a boot before the next save that worked
# would read the factory's house, no sensors, no pattern, and the alarm that was armed would be disarmed. The fork's persist.be writes the new file
# aside and moves it over the old, so a save that fails leaves the file as it was and a boot in between has the alarm it had. The
# alarm's own saves go through flush(), which does not let the exception go up out of the report, the trigger or the arm that made
# it, and tries again a few seconds later.
def parsed_file()
    return json.load(persist.written)
end
def failing_save_checks()
    var a = house()
    a.cmd({"do": "arm", "mode": "away"})
    fire("zb_alarm_exit")
    check("armed away, and the flash has it", [a.st, persist.store["zb_alarm_state"]["s"], parsed_file()["zb_alarm_state"]["s"]], ["armed_away", "armed_away", "armed_away"])
    check("with its sensors", size(parsed_file()["zb_alarm_cfg"]["sensors"]) > 0, true)
    # the door opens: the entry time starts, a change of state, and its save falls over
    var kept = persist.written
    persist.fail_next()
    var err = nil
    try
        a.report(DOOR, {"Contact": 1})
    except .. as e
        err = e
    end
    check("a failed save is not an exception out of the report that caused it", err, nil)
    check("and it is the entry time all the same, with its timer", [a.st, tasmota.timers.contains("zb_alarm_entry")], ["pending", true])
    check("and the file is as it was: the sensors, the state, all of it (O01/C04)", persist.written, kept)
    check("the alarm in memory is whole, and still dirty: a save that works writes it back", [persist.store.contains("zb_alarm_cfg"), persist.marked], [true, true])
    # a boot in between
    persist.reboot()
    var b = ZbBridgeAlarm(nil)
    check("a bridge that boots in between is armed, with its sensors: the armed alarm is remembered (O02)", [b.st, b.mode, size(b.cfg["sensors"])], ["armed_away", "away", 4])
    # a save that works first heals the file, which is why the window is what it is: from the failure to the next save
    persist.store = {}
    persist.marked = false
    # the alarm tries again by itself, a few seconds after (every_second), and writes it all back from the memory
    var c = house()
    c.cmd({"do": "arm", "mode": "away"})
    fire("zb_alarm_exit")
    tasmota.at_ms = 400000
    var kept_c = persist.written
    persist.fail_next()
    c.report(DOOR, {"Contact": 1})
    check("a save that fell over leaves the file as it was", persist.written, kept_c)
    c.every_second()
    check("it is not tried again at once", persist.written, kept_c)
    tasmota.at_ms += 5100
    c.every_second()
    check("a few seconds later it is, and the file is the alarm as it stands", [parsed_file()["zb_alarm_state"]["s"], size(parsed_file()["zb_alarm_cfg"]["sensors"]) > 0], ["pending", true])
    c.every_second()
    var saves = persist.saves
    c.every_second()
    check("and no more after", persist.saves, saves)
    # a trigger whose save falls over still sounds the siren: the event's save does not raise before it
    var d = house()
    d.cmd({"do": "arm", "mode": "away"})
    fire("zb_alarm_exit")
    empty(tasmota.cmds)
    persist.fail_next()
    d.report(SMOKE, {"Fire": 1})
    check("a trigger whose first save falls over: triggered, the siren on, its time running",
          [d.st, tasmota.cmds, tasmota.timers.contains("zb_alarm_siren")], ["triggered", [siren_cmd(true)], true])
    check("and the trigger's event and its state were said all the same", [types(d)[-1], last("st")["st"]], ["trigger", "triggered"])
    persist.store = {}
    persist.marked = false
end
failing_save_checks()

# --- the relay: the reports it hands over, and the command the panel sends --------------------------------------------------
# --- a device taken off the network ---------------------------------------------------------
def forget_checks()
    var a = house()
    # a switch of two channels: the first is a sensor, the second a siren, and it is left out of the burst; a lamp is a panic's device; a loss is open of the sensor
    set(a, {"do": "sensor", "id": DOOR2, "role": "perimeter", "notify": "house"})
    set(a, {"do": "siren", "id": DOOR2 + "/2"})
    set(a, {"do": "burst", "id": DOOR2, "on": false})
    set(a, {"do": "burst", "id": PIR2, "on": false})
    set(a, {"do": "panic_cfg", "devices": [[DOOR2, "on"], [LAMP, "on"]]})
    a.cur[DOOR2] = true
    a.crossed[DOOR2] = true
    a.heard_at[DOOR2] = 1000
    a.told[DOOR2 + "/2"] = true
    a.lose(DOOR2, "sensor", "house")
    a.lose(DOOR, "sensor", "house")
    empty(said)
    a.forget_device("0x00124b0000aa0030")
    check("the sensor goes, in whatever case the address came, and the others stay", [a.cfg["sensors"].contains(DOOR2), size(a.cfg["sensors"])], [false, 4])
    check("its channel as a siren goes, and the siren of another device stays", [a.cfg["sirens"].find(DOOR2 + "/2"), a.cfg["sirens"]], [nil, [SIREN]])
    check("it is no longer left out of the burst, and another device is", a.cfg["nopanic"], [PIR2])
    check("a panic's device of it goes, another stays", a.cfg["panic"]["devices"], [[LAMP, "on"]])
    check("what the alarm knew of its zone goes", [a.cur.contains(DOOR2), a.crossed.contains(DOOR2), a.heard_at.contains(DOOR2), a.told.contains(DOOR2 + "/2")], [false, false, false, false])
    check("its loss is over, with the panel told, and the loss of another stays", [a.lostset.contains(DOOR2), a.lostset.contains(DOOR), said[0]], [false, true, {"clr": DOOR2}])
    check("it is in the flash: a restart does not bring it back",
          [persist.store["zb_alarm_cfg"]["sensors"].contains(DOOR2), persist.store["zb_alarm_cfg"]["sirens"], persist.store["zb_alarm_lost"].contains(DOOR2)], [false, [SIREN], false])
    # a device the alarm has nothing of is nothing to it, and a word that is no address is none either
    var before = json.dump(a.cfg)
    a.forget_device(BTN)
    a.forget_device("0x1A2B")
    a.forget_device("")
    check("a device the alarm has no record of, a short address and nothing: nothing changes", json.dump(a.cfg) == before, true)
    check("and the panic's lamp stays", a.cfg["panic"]["devices"], [[LAMP, "on"]])
    # the device taken off is then forgotten once more, as the panel does after a leave: nothing to do the second time
    a.forget_device(DOOR2)
    check("again, nothing to do", json.dump(a.cfg) == before, true)
    # a device paired again comes with no role
    check("a device paired again has no role", a.cfg["sensors"].find(DOOR2), nil)
end

def relay_checks()
    persist.zero()
    wipe(tasmota.timers)
    empty(tasmota.cmds)
    var r = ZbBridgeRelay.start()
    check("the relay has the alarm", isinstance(r.alarm, ZbBridgeAlarm), true)
    r.alarm.resolve_fn = / key -> key == "0x1234" ? DOOR : (key == "0x5555" ? BTN : nil)
    var told = []
    r.alarm.emit = def (m) told.push(m["ZbAlarm"]) end
    tasmota.handlers["ZbRelayAlarm"](nil, nil, json.dump({"do": "sensor", "id": DOOR, "role": "perimeter", "notify": "house"}))
    check("the panel's command sets a sensor up, and the console is told it is done", [r.alarm.cfg["sensors"].contains(DOOR), tasmota.answers[-1]], [true, "done"])
    tasmota.handlers["ZbRelayAlarm"](nil, nil, '{"do": "dance"}')
    check("a command it does not know is refused", tasmota.answers[-1], "failed")
    tasmota.handlers["ZbRelayAlarm"](nil, nil, "not json")
    check("and so is one that is not JSON", tasmota.answers[-1], "failed")
    # a report of the door, by its short address, as Z2T publishes it
    r.forward(nil, nil, {"ZbReceived": {"0x1234": {"Device": "0x1234", "Contact": 1, "ZoneStatus": 1, "LinkQuality": 80}}})
    check("the alarm hears the report of its sensor", [r.alarm.cur.find(DOOR), r.alarm.events[-1]["y"]], [true, "open"])
    # a humidity reading has none of the keys the panel's pages read, and the alarm hears it all the same
    var n = size(r.alarm.events)
    r.forward(nil, nil, {"ZbReceived": {"0x9999": {"Device": "0x9999", "Humidity": 80}}})
    check("a device the alarm has no record of is nothing to it", size(r.alarm.events), n)
    # a command of the panel to a device marks its echo, and a burst of a button through the relay is the panic
    r.run('ZbSend {"Device":"' + LAMP + '","Send":{"Power":1}}', "ESP-NOW")
    check("a ZbSend of the panel is the echo of its device", r.alarm.echoed(LAMP), true)
    tasmota.at_ms = 200000
    for i: 1 .. 8
        r.forward(nil, nil, {"ZbReceived": {"0x5555": {"Device": "0x5555", "Power": 2}}})
        tasmota.at_ms += 100
    end
    check("eight toggles of a button through the relay are the panic", r.alarm.events[-1]["y"], "panic")
    check("ZbRelayAlarm is a command the panel may send", ZbBridgeRelay.ALLOWED.find("ZBRELAYALARM") != nil, true)
    empty(told)
    r.run('ZbRelayAlarm {"do": "arm", "mode": "away"}', "ESP-NOW")
    check("the panel's command over the link runs the console's", tasmota.cmds[-1], 'ZbRelayAlarm {"do": "arm", "mode": "away"}')
    tasmota.handlers["ZbRelayAlarm"](nil, nil, '{"do": "arm", "mode": "away"}')
    r.alarm.say_state()
    check("and the alarm says its state to the panel's link", told[-1]["st"], "arming")
    # a device the panel takes off the network is out of the alarm's setup: the ZbForget runs, and then the alarm forgets it
    check("the door is a sensor of the alarm", r.alarm.cfg["sensors"].contains(DOOR), true)
    r.run("ZbForget " + DOOR, "ESP-NOW")
    check("the panel's ZbForget runs, and the alarm drops the device with it", [tasmota.cmds[-1], r.alarm.cfg["sensors"].contains(DOOR)], ["ZbForget " + DOOR, false])
    r.run("ZbForget", "ESP-NOW")
    check("a ZbForget with no device is the command's to refuse, and the alarm leaves it", tasmota.cmds[-1], "ZbForget")
end
# --- the house's configuration, taken whole ---------------------------------------------------------
def take_cfg_checks()
    var a = house()
    set(a, {"do": "siren", "id": SIREN})
    a.lose(SMOKE, "sensor", "alert")
    a.lose(SIREN, "siren", "house")
    a.crossed[HUM] = true
    drop_config(a)
    empty(said)
    # the house's: the door as it was, the motion sensor out, the humidity's limit changed, a new door, no siren, and the times longer
    var c = {"sensors": {DOOR: {"role": "perimeter", "notify": "house", "entry": true, "sound": true},
                         SMOKE: {"role": "24h", "notify": "alert"},
                         HUM: {"role": "off", "notify": "local", "cond": {"k": "Humidity", "w": "above", "x": 80}},
                         DOOR2: {"role": "perimeter", "notify": "off"}},
             "times": [60, 30, 300], "sirens": [], "nopanic": [PIR2],
             "panic": {"ha": true, "panels": false, "alarm": false, "burst": [8, 3], "devices": []}}
    a.take_cfg(c)
    check("the house's configuration takes the place of the bridge's", [a.cfg["sensors"].contains(PIR), a.cfg["sensors"].contains(DOOR2), a.cfg["times"], a.cfg["sirens"]],
          [false, true, [60, 30, 300], []])
    check("a siren that left the alarm is lost no more, with the panel told; a sensor still in it is", [a.lostset.contains(SIREN), a.lostset.contains(SMOKE), last("clr") != nil && last("clr")["clr"] == SIREN],
          [false, true, true])
    check("a condition that changed starts from not holding", a.crossed[HUM], false)
    check("how the house is guarded changed: an event of each part, the sensors, the times and the sirens, and the panic's is the same",
          types(a)[-3 ..], ["config", "config", "config"])
    check("and what each says", [a.events[-3]["v"], a.events[-2]["v"], a.events[-1]["v"]], ["sensor", "times", "siren"])
    check("it is in the flash", persist.store["zb_alarm_cfg"]["times"], [60, 30, 300])
    # the same again, its lists in another order: nothing to say
    var n = size(a.events)
    a.take_cfg({"sensors": c["sensors"], "times": [60, 30, 300], "sirens": [], "nopanic": [PIR2],
                "panic": {"devices": [], "burst": [8, 3], "alarm": false, "panels": false, "ha": true}})
    check("the same configuration says nothing", size(a.events), n)
    a.take_cfg({"sensors": c["sensors"], "times": [60, 30, 300], "sirens": [], "nopanic": [],
                "panic": {"ha": true, "panels": true, "alarm": false, "burst": [8, 3], "devices": [[LAMP, "on"]]}})
    check("the panic's: one event; a device out of the burst, none", [size(a.events) - n, a.events[-1]["v"]], [1, "panic"])
end

# a house whose list has the alarm's configuration, as the relay asks it
class AlarmHouse
    var up
    def init() self.up = false end
    def alarm_setting() return {"times": [30, 30, 300]} end
end

def house_relay_checks()
    persist.zero()
    wipe(tasmota.timers)
    var r = ZbBridgeRelay.start()
    r.house = AlarmHouse()
    tasmota.handlers["ZbRelayAlarm"](nil, nil, json.dump({"do": "sensor", "id": DOOR, "role": "perimeter"}))
    check("in a house that keeps the alarm's configuration, a word that sets it here is refused", [tasmota.answers[-1], r.alarm.cfg["sensors"].contains(DOOR)], ["failed", false])
    tasmota.handlers["ZbRelayAlarm"](nil, nil, json.dump({"do": "panic_act", "id": LAMP, "act": "on"}))
    check("and so is a device's action in the panic", [tasmota.answers[-1], r.alarm.cfg["panic"]["devices"]], ["failed", []])
    tasmota.handlers["ZbRelayAlarm"](nil, nil, json.dump({"do": "arm", "mode": "away"}))
    check("the arm is the bridge's, as ever", [tasmota.answers[-1], r.alarm.st], ["done", "arming"])
end

relay_checks()
forget_checks()
take_cfg_checks()
house_relay_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
