# berry/zbbridge_alarm_mesh.be and the replica's side of berry/zbbridge_alarm.be: the way the alarm's
# replica travels over the mesh and the state the bridge shows follows from it. The mesh's natives are a FakeMesh the test drives, as the driver gives them:
# the clock and its timeline, the heartbeat's bytes the replica hands it, the frames it sends, the neighbours it says, and the rules'
# events (a frame, a timeline taken). What is NOT here is the radio and the clocks of several bridges: libs/nspanel-sim/vm/test/alarm-house.test.mjs runs the
# repo's Berry on a house of bridges over the mesh core. A bridge with no replica is test_zbbridge_alarm.be's, whose 254 checks run it as before.

import json
import persist
import string

var failures = 0
var checks = 0


# the ids of the parts the mesh's dispatcher hands a kind of event to (mesh_events.be), and whether a part of this id is there; neither
# makes the dispatcher
def mesh_ids(kind)
    import global
    var out = []
    if !global.contains("mesh_events") || global.mesh_events == nil return out end
    for h: global.mesh_events.kinds.find(kind, []) out.push(h[0]) end
    return out
end
def mesh_has(id)
    import global
    return global.contains("mesh_events") && global.mesh_events != nil && global.mesh_events.has(id)
end
# the dispatcher goes with the rules a test wipes: the next one is made with its rule again
def mesh_reset()
    import global
    global.mesh_events = nil
end

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
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

tasmota.utc_now = 1790000000

var DOOR = "0x00124B0000AA0001"
var PIR = "0x00124B0000AA0002"
var SIREN = "0x00124B0000AA0009"

# --- the mesh, as the driver's natives give it ---------------------------------------------------------------------------

# one node of the mesh: its clock (ticks of 100 ms, the timeline, the timelines taken), the bytes the heartbeat carries, the frames it sent and the
# neighbours it hears
class FakeMesh
    var on, ticks, synced, tl, taken, info, infos, sent, hood, accept, send_ok, epoch, id, ready
    def init()
        self.on = true
        self.ticks = 100000
        self.synced = true
        self.id = 1
        self.epoch = 7
        self.taken = 0
        self.accept = true
        self.send_ok = true
        self.ready = false
        self.info = nil
        self.infos = 0
        self.sent = []
        self.hood = []
        self.make_tl()
    end
    def make_tl()
        var t = bytes()
        t.add(self.id, 1)
        t.add(self.epoch, -4)
        self.tl = t
    end
    def clock()
        if !self.on return false end
        return {"synced": self.synced, "adopted": self.taken > 0, "ticks10": self.ticks * 10, "ticks100": self.ticks, "tag": 1, "timeline": self.tl.tohex(),
                "taken": self.taken, "lo": self.ticks * 100, "hi": 0}
    end
    def set_info(b)
        self.ready = true
        if !self.on || !self.accept return false end
        if size(b) > 32 return false end
        self.info = b.copy()
        self.infos += 1
        return true
    end
    def send(dest, kind, ack, data)
        if !self.on || !self.send_ok return false end
        self.sent.push({"dest": dest, "type": kind, "ack": ack, "data": data.copy()})
        return size(self.sent)
    end
    def neighbors()
        if !self.on return false end
        return self.hood
    end
    # the mesh restarts: a new timeline whose clock begins at 0, no event, the heartbeat's bytes gone
    def restart()
        self.epoch += 1
        self.make_tl()
        self.ticks = 0
        self.taken = 0
        self.info = nil
    end
    # the mesh takes the timeline of an older node, now in `to` and moved by `by` ticks: the clock is already there; the event is the rules'
    def adopt(to, by)
        var old = self.tl
        self.tl = to
        self.ticks += by
        self.taken += 1
        return {"Old": old.tohex(), "New": to.tohex(), "Ticks": by, "Delta": str(by * 100), "Synced": 1}
    end
end

var mesh = FakeMesh()
var said = []
var logged = []

def wipe(m)
    for k: m.keys()  m.remove(k) end
end
def empty(l)
    while size(l) > 0  l.pop() end
end

# the natives of the driver, in the global table where the module looks for them; and no mesh at all
def natives_on()
    import global as natives
    # the device's heartbeat buffer is the mesh's, and a fresh mesh has none
    natives.mesh_beat_shared = nil
    natives.espnow_mesh_clock = / -> mesh.clock()
    natives.espnow_mesh_info = / b -> mesh.set_info(b)
    natives.espnow_mesh_send = / dest, kind, ack, data -> mesh.send(dest, kind, ack, data)
    natives.espnow_mesh_neighbors = / -> mesh.neighbors()
end
def natives_off()
    import global as natives
    for k: ["espnow_mesh_clock", "espnow_mesh_info", "espnow_mesh_send", "espnow_mesh_neighbors"]
        if natives.contains(k)  natives.store.remove(k) end
    end
end

# an alarm on a bridge of the mesh: the mesh fresh, the flash empty, its messages kept
def fresh(replies)
    persist.zero()
    tasmota.timers.clear()
    empty(tasmota.cmds)
    wipe(tasmota.rules)
    wipe(tasmota.rule_lists)
    mesh_reset()
    wipe(tasmota.replies)
    if replies != nil
        for k: replies.keys()  tasmota.replies[k] = replies[k] end
    end
    empty(said)
    mesh = FakeMesh()
    natives_on()
    var a = ZbBridgeAlarm(nil)
    a.emit = def (m) said.push(m["ZbAlarm"]) end
    a.seen_fn = / ieee -> nil
    a.resolve_fn = / key -> key
    return a
end

# the alarm's sensors and its siren, as the bridge keeps them
def house(a)
    a.cmd({"do": "sensor", "id": DOOR, "role": "perimeter", "entry": true, "notify": "house"})
    a.cmd({"do": "sensor", "id": PIR, "role": "interior"})
    a.cmd({"do": "siren", "id": SIREN})
    a.cmd({"do": "times", "exit": 30, "entry": 30, "siren": 300})
    empty(a.events)
    empty(said)
    empty(tasmota.cmds)
    return a
end

# time passes: the bridge's counter and the mesh's, in step, and the timers that fall due run
def pass(ms)
    tasmota.timers.advance(ms)
    mesh.ticks += ms / 100
end

# the second Tasmota calls every_second, with the time of it passing
def sec(a, n)
    for i: 1 .. n
        pass(1000)
        a.every_second()
    end
end

# an alarm with its replica up: the mesh runs, the bridge is alarm `slot`, and the second that builds it has passed
def up(slot)
    var a = fresh({"_EspNowMeshId": {"EspNowMeshId": slot}})
    house(a)
    a.every_second()
    return a
end

def types(a)
    var out = []
    for e: a.events out.push(e["y"]) end
    return out
end
def siren_cmd(on) return 'ZbSend {"Device":"' + SIREN + '","Send":{"Power":' + (on ? '1' : '0') + '}}' end
def sirens()
    var out = []
    for c: tasmota.cmds
        if c == siren_cmd(true)  out.push("on") elif c == siren_cmd(false)  out.push("off") end
    end
    return out
end
def last_said(key)
    var i = size(said) - 1
    while i >= 0
        if said[i].contains(key) return said[i] end
        i -= 1
    end
    return nil
end

# what another bridge's record is: its alarm number, its counter, its state, its mark in the timeline given, the version vector with that and `seen`
def remote(st, node, ctr, mark, tl, seen)
    var v = ZbAlarmMerge.zeros()
    v[node - 1] = ctr
    if seen != nil
        for k: seen.keys()  v[k - 1] = seen[k] end
    end
    return ZbAlarmMerge.make(st, ZbAlarmMerge.dot(node, ctr), v, tl, mark, true, 0)
end

# a frame of the mesh for the application, as the driver tells the rules, and what the rule makes of it
def frame(src, kind, data, flags)
    tasmota.rules["EspNowMesh"]({"From": src, "Type": kind, "Dest": 1, "Counter": 1, "Epoch": 1, "Rssi": -50, "Flags": flags != nil ? flags : 0, "Part": 0,
                                 "Joins": 0, "Behind": 0, "Data": data.tohex()})
end
def records(src, kind, recs)
    var b = bytes()
    b.add(0x10, 1)
    b.add(1, 1)
    b.add(size(recs), 1)
    for r: recs  b .. r end
    frame(src, kind, b, nil)
end
def timeline_event(ev)
    tasmota.rules["EspNowMesh"]({"Timeline": ev})
end

# the frames this bridge sent, as [dest, type, message, count of records]
def wire()
    var out = []
    for s: mesh.sent
        out.push([s["dest"], s["type"], s["data"][0], size(s["data"]) > 2 ? s["data"][2] : nil, size(s["data"])])
    end
    return out
end

# --- no replica: one bridge, one alarm -------------------------------------------------------------------------------------------

def none_checks()
    natives_off()
    persist.zero()
    var a = ZbBridgeAlarm(nil)
    a.emit = def (m) said.push(m["ZbAlarm"]) end
    a.every_second()
    check("an image with no mesh driver has no replica, and does not look again", [a.mesh, a.nomesh], [nil, true])
    check("the alarm is the bridge's own: it arms", [a.arm("away", "panel"), a.st], [true, "arming"])
    check("and nothing of the replica is kept in the flash", [persist.contains("zb_alarm_heads"), persist.contains("zb_alarm_ctr")], [false, false])
    # the mesh is in the image and is off: the replica waits for it
    natives_on()
    mesh = FakeMesh()
    mesh.on = false
    var b = ZbBridgeAlarm(nil)
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 3}
    b.every_second()
    b.every_second()
    check("with the mesh off the replica is not built, and it is looked for again", [b.mesh, b.nomesh], [nil, false])
    mesh.on = true
    b.every_second()
    check("the second the mesh runs it is built, as the bridge's mesh number", [b.mesh != nil, b.mesh.rep.id], [true, 3])
    # a mesh number that is not an alarm number builds none, until the key says one
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 20}
    var c = ZbBridgeAlarm(nil)
    c.every_second()
    check("a mesh number past 15 is no alarm number: no replica", [c.mesh, c.nomesh], [nil, true])
    tasmota.handlers["ZbAlarmSlot"](nil, nil, "4")
    c.every_second()
    check("ZbAlarmSlot 4 gives it one, and the replica is built the next second", [persist.find("zb_alarm_slot"), c.mesh != nil ? c.mesh.rep.id : nil], [4, 4])
    var d = ZbBridgeAlarm(nil)
    d.every_second()
    check("the key is the number over the mesh's, at the next boot", [d.mesh != nil ? d.mesh.rep.id : nil], [4])
    tasmota.handlers["ZbAlarmSlot"](nil, nil, "0")
    check("0 clears the key", persist.contains("zb_alarm_slot"), false)
    tasmota.handlers["ZbAlarmSlot"](nil, nil, "16")
    check("16 is refused, and the key stays cleared", [persist.contains("zb_alarm_slot"), tasmota.answers[-1]], [false, "failed"])
    tasmota.handlers["ZbAlarmSlot"](nil, nil, "x")
    check("so is a word", tasmota.answers[-1], "failed")
end
none_checks()

# --- the replica is born -------------------------------------------------------------------------------------------------------

def birth_checks()
    var a = up(2)
    check("the replica is up as the alarm number, over the mesh's own timeline", [a.mesh != nil, a.mesh.rep.id, a.mesh.rep.tl == mesh.tl, a.mesh.tl == mesh.tl], [true, 2, true, true])
    check("the mesh's number is not the alarm's: the timeline is [1, epoch], not [2, epoch]", [mesh.tl[0], a.mesh.rep.tl[0]], [1, 1])
    check("the timeline is the mesh's, always trusted", a.mesh.rep.trusted, true)
    var info = mesh.info
    check("the heartbeat's bytes are 32, the layout first", [size(info), info[0]], [32, 1])
    check("bytes 1 to 19 are the replica's hello, the digest of no heads at 12 to 15", [info[1 .. 19] == a.mesh.rep.hello(0, 0, 0), info.get(12, -4) == ZbAlarmMerge.digest_of([])], [true, true])
    check("and nothing after them: the house layer's bytes are zeros", info[20 .. 31], bytes("000000000000000000000000"))
    check("the application is told it is ready by the first bytes", mesh.ready, true)
    check("it takes the frames, the timeline and the sync, from the one rule of the dispatcher", [mesh_ids("frame").find(ZbAlarmMesh.T_RULE) != nil, mesh_ids("Timeline").find(ZbAlarmMesh.T_RULE) != nil, mesh_ids("Synced").find(ZbAlarmMesh.T_RULE) != nil, tasmota.rules.contains("EspNowMesh")], [true, true, true, true])
    check("a replica of no heads is a disarmed alarm, and nothing was said of it", [a.st, a.mode, types(a), said], ["disarmed", nil, [], []])
    check("a bridge with no neighbours says nothing", mesh.sent, [])
    tasmota.rules["EspNowMesh"]({"Synced": {"Value": 0, "Timeline": mesh.tl.tohex(), "Tag": 1}})
    check("a Synced event is kept, and the heartbeat's bytes are given again", [a.mesh.sync, mesh.infos], [false, 2])
    # the life starts on the timeline the core named (start_on): its number is the MESH's (12), the alarm's is 5, and the epoch has its top bit set
    var b = fresh({"_EspNowMeshId": {"EspNowMeshId": 5}})
    mesh.id = 12
    mesh.epoch = 0x80000003
    mesh.make_tl()
    house(b)
    b.every_second()
    check("the replica starts on the core's timeline [12, epoch], not on [5, epoch], whatever the top bit of the epoch, and trusted",
          [b.mesh.rep.id, b.mesh.rep.tl[0], b.mesh.rep.tl.tohex() == mesh.tl.tohex(), b.mesh.tl.tohex() == mesh.tl.tohex(), b.mesh.rep.trusted], [5, 12, true, true, true])
    var made = b.mesh.rep.act("armed_away", 0)
    check("and what it makes is in that timeline, trusted", [ZbAlarmMerge.tl_is(made, mesh.tl), ZbAlarmMerge.trusted_of(made)], [true, true])
    b.mesh.tl.set(0, 99, 1)
    check("the replica keeps a timeline of its own: the glue's bytes are not shared with it", [b.mesh.rep.tl[0], b.mesh.rep.tl.tohex() == mesh.tl.tohex()], [12, true])
end
birth_checks()

# a clock that names a timeline of another length than 5 bytes (the driver never does): no life begins on it, nothing raises, and an action waits
def bad_timeline_checks()
    var a = fresh({"_EspNowMeshId": {"EspNowMeshId": 1}})
    house(a)
    a.every_second()
    var was = a.mesh.rep.tl.tohex()
    mesh.restart()
    mesh.tl = bytes("0102")
    var err = nil
    try
        a.every_second()
    except .. as e
        err = e
    end
    check("a timeline that is not 5 bytes: nothing raises, and the replica keeps the timeline it had", [err, a.mesh.rep.tl.tohex()], [nil, was])
    check("and an action waits for a clock that makes sense: the replica makes no record", a.mesh.act("armed_away", 0), nil)
end
bad_timeline_checks()

# --- an action of this bridge ------------------------------------------------------------------------------------------------------

def act_checks()
    var a = up(1)
    var t0 = mesh.ticks
    check("an arm is taken by the replica", a.arm("away", "panel"), true)
    var rep = a.mesh.rep
    var r = rep.heads[0]
    check("one head, the dot 1:1, armed away, in the mesh's timeline, marked with its time", [size(rep.heads), ZbAlarmMerge.dot_of(r), ZbAlarmMerge.st_of(r), ZbAlarmMerge.tl_is(r, mesh.tl), ZbAlarmMerge.mark_of(r)], [1, ZbAlarmMerge.dot(1, 1), 2, true, t0])
    check("the counter was written first, and the heads after it", [persist.find("zb_alarm_ctr"), size(persist.find("zb_alarm_heads"))], [1, 104])
    check("the alarm is arming, and the exit time is the whole 30 s from the mark", [a.st, a.mode, tasmota.timers.delay_of("zb_alarm_exit")], ["arming", "away", 30000])
    check("the arm is an event of this bridge's, by whoever asked", [types(a), a.events[0]["d"]], [["arm"], "panel"])
    check("one frame, to everyone, as an event, with the one record", wire(), [[255, 3, 0x10, 1, 55]])
    check("its payload is the message, the version, the count and the record", mesh.sent[0]["data"] == bytes("100101") + r, true)
    check("the heartbeat's bytes follow it: the digest and one head", [mesh.info.get(12, -4) == rep.digest(), (mesh.info[19] >> 1) & 15], [true, 1])
    pass(30000)
    check("the exit time ends: armed", [a.st, a.mode], ["armed_away", "away"])
    check("and the panel was told", [last_said("st")["st"], a.ver >= 2], ["armed_away", true])
    check("a disarm is taken: a record that descends from the arm", [a.disarm("ha"), size(rep.heads), ZbAlarmMerge.dot_of(rep.heads[0]), ZbAlarmMerge.st_of(rep.heads[0])], [true, 1, ZbAlarmMerge.dot(1, 2), 0])
    check("disarmed, the siren sent off once, and an event", [a.st, a.mode, sirens(), types(a)[-1]], ["disarmed", nil, ["off"], "disarm"])
    check("and said to everyone as well", [wire()[-1], size(mesh.sent)], [[255, 3, 0x10, 1, 55], 2])
    check("a disarm of a disarmed alarm is no action: no record, the siren sent off again", [a.disarm("ha"), size(mesh.sent), persist.find("zb_alarm_ctr"), sirens()], [false, 2, 2, ["off", "off"]])
    # arming over an arming alarm of the same mode changes nothing, and in another mode is a new arm
    a.arm("home", "panel")
    check("an arm in another mode while arming is a new arm, with a new exit time", [a.arm("away", "ha"), a.st, a.mode, ZbAlarmMerge.st_of(rep.heads[0]), tasmota.timers.delay_of("zb_alarm_exit")], [true, "arming", "away", 2, 30000])
    check("the same arm again is nothing: no record", [a.arm("away", "ha"), persist.find("zb_alarm_ctr")], [true, 4])
end
act_checks()

def trigger_checks()
    var a = up(1)
    a.arm("away", "panel")
    pass(30000)
    check("armed", a.st, "armed_away")
    a.report(PIR, {"Occupancy": 1})
    check("a motion sensor inside an armed-away alarm triggers it through the replica: the record is a trigger", [a.st, ZbAlarmMerge.st_of(a.mesh.rep.heads[0]), size(a.mesh.rep.heads)], ["triggered", 3, 1])
    check("the siren is on, and its time runs from the mark: 300 s", [sirens(), a.sounding, tasmota.timers.delay_of("zb_alarm_siren")], [["on"], true, 300000])
    check("the cause is the sensor's, the event is the trigger's", [a.cause, types(a)[-1]], [[PIR, "motion"], "trigger"])
    check("and the trigger is said to everyone", wire()[-1], [255, 3, 0x10, 1, 55])
    check("the state the panel is told is triggered, by the sensor", [last_said("st")["st"], last_said("st")["c"]], ["triggered", [PIR, "motion"]])
    pass(300000)
    check("the siren's time ends: the siren off, and the record stays triggered until a disarm", [a.st, a.sounding, sirens()[-1], types(a)[-1]], ["triggered", false, "off", "siren_off"])
    check("with the siren's time gone, the sensors are judged as before the trigger", a.guard_state(), "armed_away")
    a.report(PIR, {"Occupancy": 0})
    a.report(PIR, {"Occupancy": 1})
    check("and a new trip is a new trigger: a new record, the siren again", [ZbAlarmMerge.dot_of(a.mesh.rep.heads[0]), a.sounding, sirens()[-1]], [ZbAlarmMerge.dot(1, 3), true, "on"])
    a.disarm("panel")
    check("a disarm cuts the siren and clears the trigger", [a.st, a.sounding, sirens()[-1], a.cause, a.mode], ["disarmed", false, "off", nil, nil])
    # the entry time is this bridge's own: pending is no record
    var b = up(1)
    b.arm("home", "panel")
    pass(30000)
    var n = size(mesh.sent)
    b.report(DOOR, {"Contact": 1, "ZoneStatus": 1})
    check("the door one comes in by opens: pending, and no record or frame for it", [b.st, size(mesh.sent), size(b.mesh.rep.heads), ZbAlarmMerge.st_of(b.mesh.rep.heads[0])], ["pending", n, 1, 1])
    tasmota.timers.fire("zb_alarm_entry")
    check("the entry time ends: the trigger, a record of the replica's", [b.st, ZbAlarmMerge.st_of(b.mesh.rep.heads[0]), sirens()[-1], size(mesh.sent) - n], ["triggered", 3, "on", 1])
    # a trip in the exit time does not trigger
    var c = up(1)
    c.arm("away", "panel")
    c.report(PIR, {"Occupancy": 1})
    check("a sensor that trips while the exit time runs does not trigger", [c.st, ZbAlarmMerge.st_of(c.mesh.rep.heads[0])], ["arming", 2])
end
trigger_checks()

# --- what another bridge says --------------------------------------------------------------------------------------------------

def remote_checks()
    var a = up(1)
    var tl = mesh.tl
    records(2, 3, [remote(2, 2, 1, mesh.ticks - 20, tl, nil)])
    check("a record from another bridge arms this one: arming, away, and no cause", [a.st, a.mode, a.cause], ["arming", "away", nil])
    check("told as that bridge's arm, and no record of its own was made, nothing sent", [a.events[-1]["d"], types(a), a.mesh.rep.ctr, size(mesh.sent)], ["bridge 2", ["arm"], 0, 0])
    check("the exit time is what is left of the 30 s from the other bridge's mark: 28 s", tasmota.timers.delay_of("zb_alarm_exit"), 28000)
    check("the replica holds it, persisted, and the heartbeat's digest is the new one", [size(a.mesh.rep.heads), size(persist.find("zb_alarm_heads")), mesh.info.get(12, -4) == a.mesh.rep.digest()], [1, 104, true])
    pass(28000)
    check("then armed", a.st, "armed_away")
    records(3, 3, [remote(0, 3, 1, mesh.ticks, tl, {2: 1})])
    check("a disarm that descends from the arm disarms it, by bridge 3", [a.st, a.events[-1]["d"], types(a)[-1], size(a.mesh.rep.heads)], ["disarmed", "bridge 3", "disarm", 1])
    # an arm of bridge 2 that never saw the disarm and is older than it: the disarm stays
    records(2, 3, [remote(2, 2, 2, mesh.ticks - 600, tl, nil)])
    check("a concurrent arm that is older than the disarm leaves it disarmed, and both are heads", [a.st, size(a.mesh.rep.heads)], ["disarmed", 2])
    # and one that is later wins
    records(2, 3, [remote(1, 2, 3, mesh.ticks + 10, tl, nil)])
    check("a later arm of bridge 2, that descends its own earlier one, is concurrent with the disarm and later: armed home", [a.st, a.mode], ["arming", "home"])
    # an arm older than the exit time is armed at once
    var b = up(1)
    records(2, 3, [remote(2, 2, 1, mesh.ticks - 400, mesh.tl, nil)])
    check("an arm made 40 s ago is armed, with no exit time to run", [b.st, tasmota.timers.contains("zb_alarm_exit")], ["armed_away", false])
    # a trigger from another bridge, a few seconds old
    var c = up(1)
    c.arm("away", "panel")
    pass(30000)
    empty(tasmota.cmds)
    records(2, 3, [remote(3, 2, 1, mesh.ticks - 50, mesh.tl, {1: 1})])
    check("a trigger of another bridge triggers this one: the siren on for what is left of its time from that mark, 295 s", [c.st, sirens(), tasmota.timers.delay_of("zb_alarm_siren"), c.mode], ["triggered", ["on"], 295000, "away"])
    check("by that bridge, and no sensor", [c.cause, c.events[-1]["y"], c.events[-1]["d"]], [["bridge 2", "alarm"], "trigger", "bridge 2"])
    pass(295000)
    check("its siren's time is over when the other's is", [c.st, c.sounding, sirens()[-1]], ["triggered", false, "off"])
    # a trigger older than the siren's time, and one of a timeline this life does not place: the state, and no siren
    var d = up(1)
    records(2, 3, [remote(3, 2, 1, mesh.ticks - 4000, mesh.tl, nil)])
    check("a trigger older than the siren's time is the state and no siren", [d.st, sirens(), d.sounding], ["triggered", [], false])
    var e = up(1)
    records(2, 3, [remote(3, 2, 1, mesh.ticks, bytes("0900000009"), nil)])
    check("a trigger in a timeline nothing places has no age: the state, no siren", [e.st, sirens(), e.sounding], ["triggered", [], false])
    # four records in a frame, one of each of four bridges: the heads are four, and the state is their fold
    var f = up(1)
    var tl4 = mesh.tl
    records(2, 3, [remote(1, 2, 1, mesh.ticks - 40, tl4, nil), remote(2, 3, 1, mesh.ticks - 30, tl4, nil), remote(1, 4, 1, mesh.ticks - 20, tl4, nil), remote(0, 5, 1, mesh.ticks - 10, tl4, nil)])
    check("four records to a frame, four bridges' own: four heads, the later disarm last", [size(f.mesh.rep.heads), f.st], [4, "disarmed"])
    check("and the flash holds the four", size(persist.find("zb_alarm_heads")), 416)
end
remote_checks()

def frame_checks()
    var a = up(1)
    var r = remote(2, 2, 1, mesh.ticks, mesh.tl, nil)
    var good = bytes("100101") + r
    frame(2, 0, good, nil)
    check("a frame of the command type is not the alarm's", a.st, "disarmed")
    frame(2, 3, good, 2)
    check("nor a repeat of one already handed over", a.st, "disarmed")
    frame(2, 3, bytes("100201") + r, nil)
    frame(2, 3, bytes("100102") + r, nil)
    frame(2, 3, bytes("1001"), nil)
    frame(2, 3, bytes("100100") + r, nil)
    frame(2, 3, bytes("1101") + r, nil)
    frame(2, 3, bytes("2001") + r, nil)
    var bad = r.copy()
    bad[0] = 0xFF
    frame(2, 3, bytes("100101") + bad, nil)
    tasmota.rules["EspNowMesh"]({"Outcome": {"Counter": 5, "Ok": 1}})
    tasmota.rules["EspNowMesh"]({"From": 2, "Type": 3, "Data": "10"})
    check("a version that is not 1, a count that is not the bytes', a short frame, another message and a copy that is no record change nothing", [a.st, size(a.mesh.rep.heads)], ["disarmed", 0])
    frame(2, 2, good, nil)
    check("a state frame is as good as an event's", [a.st, a.mode], ["arming", "away"])
    frame(2, 2, good, nil)
    check("the same copy again changes nothing, and does not say it again", [types(a), size(a.mesh.rep.heads)], [["arm"], 1])
end
frame_checks()

# --- the mesh's clock ---------------------------------------------------------------------------------------------------------

def timeline_checks()
    var a = up(1)
    a.arm("home", "panel")
    var m0 = ZbAlarmMerge.mark_of(a.mesh.rep.heads[0])
    var to = bytes("0200000004")
    var sent0 = size(mesh.sent)
    var infos0 = mesh.infos
    timeline_event(mesh.adopt(to, 500))
    var h = a.mesh.rep.heads[0]
    check("the mesh took another timeline: the arm moves with it, its mark by the ticks", [ZbAlarmMerge.tl_is(h, to), ZbAlarmMerge.mark_of(h) - m0, a.mesh.rep.tl == to, a.mesh.tl == to], [true, 500, true, true])
    check("one event seen, the digest told again, the heads offered to everyone as a state", [a.mesh.processed, mesh.infos - infos0, wire()[sent0]], [1, 1, [255, 2, 0x10, 1, 55]])
    check("and the flash holds the moved head", persist.find("zb_alarm_heads"), h.tohex())
    check("the alarm is as it was: arming still, its exit time not started again", [a.st, tasmota.timers.count("zb_alarm_exit")], ["arming", 1])
    # an event whose Old is not the life's timeline: the mesh restarted, and then took another
    var b = up(1)
    b.arm("home", "panel")
    mesh.restart()
    timeline_event(mesh.adopt(bytes("0200000004"), 900))
    check("an event that is not of this life's timeline starts a new life on the clock's", [b.mesh.rep.tl == mesh.tl, b.mesh.processed == mesh.taken, ZbAlarmMerge.tl_is(b.mesh.rep.heads[0], mesh.tl)], [true, true, false])
end
timeline_checks()

def restart_checks()
    var a = up(1)
    a.arm("away", "panel")
    pass(30000)
    var old = mesh.tl
    var infos0 = mesh.infos
    mesh.restart()
    check("before the replica looks, nothing has changed in it", a.mesh.tl == old, true)
    sec(a, 1)
    check("the mesh restarted (a new timeline, the clock at 0, no event): the next second starts a new life on it", [a.mesh.tl == mesh.tl, a.mesh.rep.tl == mesh.tl, a.mesh.processed], [true, true, 0])
    check("the heartbeat's bytes went with the restart and are given again", [mesh.info != nil, mesh.infos > infos0], [true, true])
    check("what the old life made is in a timeline nothing places, and the alarm stays as the heads say: armed, no new exit time", [a.st, ZbAlarmMerge.tl_is(a.mesh.rep.heads[0], mesh.tl), tasmota.timers.contains("zb_alarm_exit")], ["armed_away", false, false])
    a.disarm("panel")
    check("a disarm in the new life descends from the old arm, whatever the timelines", [ZbAlarmMerge.dot_of(a.mesh.rep.heads[0]), size(a.mesh.rep.heads), ZbAlarmMerge.tl_is(a.mesh.rep.heads[0], mesh.tl)], [ZbAlarmMerge.dot(1, 2), 1, true])
    # the mesh stops: the marks go on by the bridge's own counter, in the life's timeline
    mesh.on = false
    pass(5000)
    a.arm("home", "panel")
    check("with the task stopped an action is still taken, in the life's timeline, marked by the counter's time", [a.want, ZbAlarmMerge.tl_is(a.mesh.rep.heads[0], a.mesh.tl)], [nil, true])
    var m = ZbAlarmMerge.mark_of(a.mesh.rep.heads[0])
    check("and the mark is the last reading and the 5 s since, in ticks", m - a.mesh.at_ticks, 50)
end
restart_checks()

def lag_checks()
    var a = up(1)
    var to = bytes("0200000004")
    var ev = mesh.adopt(to, 300)
    sec(a, 1)
    check("a timeline taken whose event has not come is waited for: the life is the old one's", [a.mesh.tl == to, a.mesh.lag], [false, 1])
    check("an arm made meanwhile is not recorded: it is wanted, and the alarm shows it", [a.arm("home", "panel"), a.want != nil, a.st, size(a.mesh.rep.heads)], [true, true, "arming", 0])
    check("no frame went", mesh.sent, [])
    timeline_event(ev)
    check("the event comes: the life is the new timeline's, what was wanted still waits", [a.mesh.tl == to, a.mesh.processed, a.want != nil], [true, 1, true])
    sec(a, 5)
    check("and is recorded when it is tried again, in the new timeline", [a.want, size(a.mesh.rep.heads), ZbAlarmMerge.tl_is(a.mesh.rep.heads[0], to)], [nil, 1, true])
    check("the record was said to everyone", wire()[-1], [255, 3, 0x10, 1, 55])
    # the event never comes
    var b = up(1)
    mesh.adopt(to, 300)
    sec(b, 2)
    check("two looks wait for it", [b.mesh.tl == to, b.mesh.lag], [false, 2])
    sec(b, 1)
    check("and then it is lost: a new life on the clock's timeline", [b.mesh.tl == to, b.mesh.rep.tl == to, b.mesh.processed == mesh.taken, b.mesh.lag], [true, true, true, 0])
end
lag_checks()

def save_checks()
    var a = up(1)
    persist.fail_next()
    check("an arm whose counter will not write: nothing is recorded, and the alarm shows what was asked", [a.arm("away", "panel"), a.st, size(a.mesh.rep.heads), a.want != nil], [true, "arming", 0, true])
    check("no frame went, and the number is skipped", [mesh.sent, a.mesh.rep.ctr], [[], 1])
    check("the exit time is the whole, nothing is counted from a mark that is not there", tasmota.timers.delay_of("zb_alarm_exit"), 30000)
    sec(a, 4)
    check("not yet tried again", a.want != nil, true)
    sec(a, 1)
    check("tried again in 5 s: the record is made, with the next number", [a.want, size(a.mesh.rep.heads), ZbAlarmMerge.dot_of(a.mesh.rep.heads[0])], [nil, 1, ZbAlarmMerge.dot(1, 2)])
    check("and said", wire()[-1], [255, 3, 0x10, 1, 55])
    # a disarm from the house while it was wanted: what was wanted is no longer the newest
    var b = up(1)
    persist.fail_next()
    b.arm("away", "panel")
    records(2, 3, [remote(0, 2, 1, mesh.ticks + 5, mesh.tl, nil)])
    check("a copy from another bridge ends what was wanted and not recorded", [b.want, b.st], [nil, "disarmed"])
    # a siren that must sound does, whether the record is made or not
    var c = up(1)
    c.arm("away", "panel")
    pass(30000)
    persist.fail_next()
    c.report(PIR, {"Occupancy": 1})
    check("a trigger whose counter will not write still sounds, and is wanted", [c.st, sirens(), c.want != nil], ["triggered", ["on"], true])
end
save_checks()

# --- the neighbours -------------------------------------------------------------------------------------------------------------

# a neighbour as espnow_mesh_neighbors() says it: its 32 bytes with the replica's 19 at 1, a digest and a number of heads
def neighbour(id, digest, count, state)
    var b = bytes(-32)
    b[0] = 1
    b.setbytes(1, ZbAlarmMerge.encode_hello(bytes("0100000007"), 0, 0, digest, 0, true, count))
    return {"id": id, "state": state != nil ? state : 0, "rssi": -50, "age": 100, "beat": 100, "info": b.tohex(), "seen": 2, "skew": 0}
end

# a neighbour that also says the dot of the record it applied
def neighbour_with(id, digest, count, state, applied, broker)
    var b = bytes(-32)
    b[0] = 1
    b.setbytes(1, ZbAlarmMerge.encode_hello(bytes("0100000007"), 0, 0, digest, applied, true, count))
    if broker == true  b[19] = b[19] | 0x80 end
    return {"id": id, "state": state, "rssi": -50, "age": 100, "beat": 100, "info": b.tohex(), "seen": 2, "skew": 0}
end

# the reach: this bridge says it applied the record when its state follows it and its sirens are as ordered, and counts the bridges that say so
def reach_checks()
    var a = up(1)
    a.siren(false)
    a.heard(SIREN, {"Power": 0})
    check("the sirens' order was confirmed", a.sirens_confirmed(), true)
    a.arm("away", "panel")
    sec(a, 1)
    var cur = ZbAlarmMerge.dot_of(a.mesh.rep.record())
    check("this bridge says it applied the record: its dot is bytes 16 to 18 of the heartbeat", [a.mesh.applied == cur, ZbAlarmMerge.decode_hello(mesh.info[1 .. 19])["applied"] == cur], [true, true])
    check("alone, the reach is 1 of 1, and the state says nothing of it", [a.mesh.reach(), last_said("st").contains("r")], [[1, 1, false], false])
    # the neighbours: one that applied it, one that did not, and one that did and is silent (heard no more: not counted as having)
    var d = a.mesh.rep.digest()
    mesh.hood = [neighbour_with(2, d, 1, 0, cur), neighbour_with(3, d, 1, 0, 0), neighbour_with(4, d, 1, 2, cur)]
    empty(said)
    sec(a, 2)
    check("the reach: the bridges that applied it, this one too, of the ones with a replica, a silent one counted as not", a.mesh.reach(), [2, 4, true])
    var m = last_said("r")
    check("the glass is told, applying while the change is young", m["r"], [2, 4, 1])
    sec(a, 4)
    check("and, when the first moments are over, the reach itself", last_said("r")["r"], [2, 4, 0])
    # the others apply it
    mesh.hood = [neighbour_with(2, d, 1, 0, cur), neighbour_with(3, d, 1, 0, cur), neighbour_with(4, d, 1, 0, cur)]
    sec(a, 2)
    check("all of them: complete", [a.mesh.reach(), last_said("r")["r"]], [[4, 4, true], [4, 4, 0]])
    # a node with no replica is no bridge of the alarm
    var bare = neighbour_with(5, 0, 0, 0, 0)
    mesh.hood = [neighbour_with(2, d, 1, 0, cur), bare]
    sec(a, 2)
    check("a node with no replica is not counted", a.mesh.reach(), [2, 2, true])
    # a new record is nobody's yet: not counted until a poll
    a.cmd({"do": "disarm"})
    check("a record not counted is told as applying, whatever the old count was", [a.mesh.reach()[2], last_said("r")["r"][2]], [false, 1])
    # a siren that did not confirm keeps the bridge from saying it applied: the reach stays with the old dot
    a.siren(true)
    a.mesh.applied = 0
    check("a bridge whose sirens have not confirmed does not apply", [a.sirens_confirmed()], [false])
end
reach_checks()

# the door to Home Assistant: one bridge answers for the house's alarm, chosen by rank by the bridges that are alive, synced and with the broker
def door_checks()
    import mqtt
    var a = up(3)
    mqtt.up = true
    empty(mqtt.published)
    var d = a.mesh.rep.digest()
    mesh.hood = [neighbour_with(2, d, 1, 0, 0, true)]
    sec(a, 4)
    check("with a bridge of a lower number that is fit, this one is not the door, and says nothing of the alarm to Home Assistant",
          [a.mesh.door_id, a.is_door(), size(mqtt.published)], [2, false, 0])
    check("the heartbeat says this bridge has the broker: bit 7 of byte 19", (mesh.info[19] & 0x80) != 0, true)
    check("the alarm is the house's, the same unique id on every bridge", a.uid, "zbalarm_house")
    mqtt.subs[0][1]("zigbee/alarm/zbalarm_house/set", 0, "ARM_AWAY", nil)
    check("a command of Home Assistant to a bridge that is not the door is nobody's", a.st, "disarmed")
    # the door goes silent: this bridge is the door, announces it, and takes the commands
    mesh.hood = [neighbour_with(2, d, 1, 2, 0, true)]
    sec(a, 4)
    var topics = []
    for pub: mqtt.published topics.push(pub[0]) end
    check("the door silent: this bridge is it, and announces the alarm and its state, retained",
          [a.is_door(), a.mesh.door_id, topics.find("homeassistant/alarm_control_panel/zbalarm_house/config") != nil, topics.find("zigbee/alarm/zbalarm_house/state") != nil], [true, 3, true, true])
    sec(a, 4)
    mqtt.subs[0][1]("zigbee/alarm/zbalarm_house/set", 0, "ARM_AWAY", nil)
    check("a command of Home Assistant is the door's: it arms", a.st != "disarmed", true)
    # a neighbour with no broker is not fit
    mesh.hood = [neighbour_with(2, d, 1, 0, 0, false)]
    sec(a, 4)
    check("a bridge with no broker is not fit for the door", [a.mesh.door_id, a.is_door()], [3, true])
    # the door in office stays while it is fit, though a lower number comes
    mesh.hood = [neighbour_with(1, d, 1, 0, 0, true)]
    sec(a, 4)
    check("a lower number that comes back does not take the door while this one holds it", [a.mesh.door_id, a.is_door()], [3, true])
    # the preferred one takes it back only after 30 s of being fit
    persist.setmember("zb_alarm_door", 5)
    mesh.hood = [neighbour_with(5, d, 1, 0, 0, true)]
    sec(a, 10)
    check("the preferred bridge is not the door at once", [a.mesh.door_id, a.is_door()], [3, true])
    sec(a, 30)
    check("after 30 s alive, synced and with the broker it is", [a.mesh.door_id, a.is_door()], [5, false])
    persist.remove("zb_alarm_door")
    mqtt.up = false
    empty(mqtt.published)
    empty(mqtt.subs)
end
door_checks()

# a bridge of the alarm that goes silent on the mesh is a loss, once, and found when it is heard again
def bridge_loss_checks()
    var a = up(1)
    var d = a.mesh.rep.digest()
    mesh.hood = [neighbour_with(2, d, 1, 0, 0), neighbour_with(4, d, 1, 2, 0)]
    sec(a, 2)
    check("a bridge with a replica that is silent on the mesh is a loss, by its number; the live one is not", [a.lostset.contains("bridge 4"), a.lostset.contains("bridge 2"), size(a.lostset)], [true, false, 1])
    sec(a, 4)
    check("and once", [types(a), size(a.lostset)], [["unreach"], 1])
    mesh.hood = [neighbour_with(2, d, 1, 0, 0), neighbour_with(4, d, 1, 0, 0)]
    sec(a, 2)
    check("heard again, it is found", size(a.lostset), 0)
    mesh.hood = [neighbour_with(5, 0, 0, 2, 0)]
    sec(a, 2)
    check("a silent node with no replica is not a bridge of the alarm", size(a.lostset), 0)
end
bridge_loss_checks()

# a lost count in the state: an arm that left devices unprotected
def lost_state_checks()
    var a = up(1)
    a.mesh.act(2, 3)
    a.look(nil, false)
    check("an arm that left 3 devices unprotected says so in the state", last_said("st")["l"], 3)
    a.cmd({"do": "disarm"})
    check("a disarm says nothing of it", last_said("st").contains("l"), false)
end
lost_state_checks()

def poll_checks()
    var a = up(1)
    var mine = bytes()
    mine.add(a.mesh.rep.digest(), -4)
    mesh.hood = [neighbour(2, 0x12345678, 1, 0)]
    sec(a, 1)
    check("the neighbours are looked at every second second", mesh.sent, [])
    sec(a, 1)
    check("a neighbour whose digest is not ours: with no heads to offer, it is asked for its own", [size(mesh.sent), mesh.sent[0]["dest"], mesh.sent[0]["type"], mesh.sent[0]["ack"], mesh.sent[0]["data"]], [1, 2, 2, false, bytes("1101") + mine])
    a.arm("away", "panel")
    empty(mesh.sent)
    sec(a, 2)
    check("with a head, it is offered it, to that neighbour, as a state; not asked again so soon", [size(mesh.sent), mesh.sent[0]["dest"], mesh.sent[0]["type"], mesh.sent[0]["data"][0], size(mesh.sent[0]["data"])], [1, 2, 2, 0x10, 55])
    sec(a, 4)
    check("the same neighbour is not offered the same heads inside a heartbeat's time", size(mesh.sent), 1)
    sec(a, 2)
    check("after it, again", size(mesh.sent), 2)
    sec(a, 10)
    check("offered again after the next heartbeat, and asked again after 15 s from the first ask", [size(mesh.sent), mesh.sent[-1]["data"][0]], [4, 0x11])
    # a neighbour with the digest this bridge has: nothing is said
    empty(mesh.sent)
    mesh.hood = [neighbour(2, a.mesh.rep.digest(), 1, 0)]
    sec(a, 4)
    check("a neighbour with our digest is told nothing", mesh.sent, [])
    # not neighbours to talk to: no replica, silent, short bytes
    var fake = neighbour(3, 0, 0, 0)
    var gone = neighbour(4, 0x12345678, 1, 2)
    var short = neighbour(5, 0x12345678, 1, 0)
    short["info"] = bytes(-12).tohex()
    var other = neighbour(6, 0x12345678, 1, 0)
    other["info"] = "02" + other["info"][2 ..]
    mesh.hood = [fake, gone, short, other]
    sec(a, 4)
    check("a node with no replica (no digest, no heads), one given up as silent, one with short bytes and one of another layout are not talked to", mesh.sent, [])
    mesh.hood = [neighbour(2, 0x12345678, 1, 1)]
    sec(a, 2)
    check("a neighbour that is only suspected is still talked to", size(mesh.sent) >= 1, true)
    mesh.hood = false
    sec(a, 2)
    mesh.on = false
    sec(a, 2)
    check("a mesh with no answer to the neighbours' ask, or stopped, does not raise: the second goes on", a.mesh != nil, true)
    # a refused heartbeat's bytes are given again
    mesh.on = true
    mesh.accept = false
    a.arm("home", "ha")
    check("a refusal of the heartbeat's bytes is remembered", a.mesh.dirty, true)
    mesh.accept = true
    var n = mesh.infos
    sec(a, 1)
    check("and the second after, they are given again", [a.mesh.dirty, mesh.infos - n], [false, 1])
    # a refusal of the frames is nothing to be done now: the poll mends it a heartbeat later
    mesh.send_ok = false
    a.disarm("ha")
    check("a refused frame is no error: the alarm is what it was asked", [a.st, size(a.mesh.rep.heads)], ["disarmed", 1])
end
poll_checks()

def stale_checks()
    var a = up(1)
    sec(a, 6)
    a.arm("away", "panel")
    empty(mesh.sent)
    var n = neighbour(2, 0x12345678, 1, 0)
    n["beat"] = 3000
    mesh.hood = [n]
    sec(a, 2)
    check("a heartbeat that came before this bridge's last change says nothing of what the neighbour holds now: it is waited for", mesh.sent, [])
    n["beat"] = 500
    sec(a, 2)
    check("the next one is read: its digest is not ours, so the heads are offered and the neighbour asked", [size(mesh.sent), mesh.sent[0]["data"][0], mesh.sent[1]["data"][0]], [2, 0x10, 0x11])
    # a neighbour that never sent one (beat -1) is not read
    var m = neighbour(3, 0x12345678, 1, 0)
    m["beat"] = -1
    mesh.hood = [m]
    empty(mesh.sent)
    sec(a, 8)
    check("a neighbour with no heartbeat is not read", mesh.sent, [])
end
stale_checks()

def ask_checks()
    var a = up(1)
    a.arm("away", "panel")
    empty(mesh.sent)
    var theirs = bytes()
    theirs.add(0x12345678, -4)
    frame(2, 2, bytes("1101") + theirs, nil)
    check("an ask with another digest is answered with the heads, to its asker, as a state", [size(mesh.sent), mesh.sent[0]["dest"], mesh.sent[0]["type"], mesh.sent[0]["data"][0]], [1, 2, 2, 0x10])
    frame(2, 2, bytes("1101") + theirs, nil)
    check("not again within a second", size(mesh.sent), 1)
    pass(1100)
    frame(2, 2, bytes("1101") + theirs, nil)
    check("after it, again", size(mesh.sent), 2)
    pass(1100)
    var same = bytes()
    same.add(a.mesh.rep.digest(), -4)
    frame(2, 2, bytes("1101") + same, nil)
    check("and not to an asker whose digest is ours", size(mesh.sent), 2)
    frame(2, 2, bytes("1101"), nil)
    check("nor to a short one", size(mesh.sent), 2)
end
ask_checks()

# --- the replica comes up over what the alarm was --------------------------------------------------------------------------------

# a bridge that boots with the flash it is given, its mesh not up yet
def boot(flash)
    persist.zero()
    for k: flash.keys()  persist.setmember(k, flash[k]) end
    tasmota.timers.clear()
    empty(tasmota.cmds)
    wipe(tasmota.rules)
    wipe(tasmota.rule_lists)
    mesh_reset()
    wipe(tasmota.replies)
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 1}
    empty(said)
    mesh = FakeMesh()
    mesh.on = false
    natives_on()
    var a = ZbBridgeAlarm(nil)
    a.emit = def (m) said.push(m["ZbAlarm"]) end
    a.seen_fn = / ieee -> nil
    a.resolve_fn = / key -> key
    return a
end

def born_checks()
    # an upgrade: armed in the flash as before the replica, no heads
    var a = boot({"zb_alarm_state": {"v": 3, "e": 5, "s": "armed_away", "m": "away"}})
    check("a bridge armed before the replica comes back armed", [a.st, a.mode], ["armed_away", "away"])
    a.every_second()
    check("with the mesh not up, there is no replica yet", a.mesh, nil)
    mesh.on = true
    a.every_second()
    check("the replica up, what the alarm was is its first action: armed away, a record of dot 1:1", [a.mesh != nil, size(a.mesh.rep.heads), ZbAlarmMerge.st_of(a.mesh.rep.heads[0]), ZbAlarmMerge.dot_of(a.mesh.rep.heads[0])], [true, 1, 2, ZbAlarmMerge.dot(1, 1)])
    check("and it is no new arm: no event, the state as it was, the record said to everyone", [a.st, types(a), wire()], ["armed_away", [], [[255, 3, 0x10, 1, 55]]])
    # a change before the replica was up goes in as well
    var b = boot({})
    b.arm("home", "panel")
    mesh.on = true
    b.every_second()
    check("an arm made before the replica was up is its first action, and the exit time the bridge's own goes on", [ZbAlarmMerge.st_of(b.mesh.rep.heads[0]), b.st, tasmota.timers.contains("zb_alarm_exit")], [1, "arming", true])
    tasmota.timers.fire("zb_alarm_exit")
    check("and ends in the state the replica says", [b.st, b.mode], ["armed_home", "home"])
    # heads in the flash are the state: the bridge was triggered, the old view of the flash says armed
    var tl = bytes("0100000001")
    var heads = remote(3, 1, 5, 123, tl, nil)
    var c = boot({"zb_alarm_heads": heads.tohex(), "zb_alarm_ctr": 5, "zb_alarm_state": {"v": 9, "e": 5, "s": "triggered", "m": "away"}})
    check("restored, the legacy view says armed", [c.st], ["armed_away"])
    mesh.on = true
    empty(said)
    c.every_second()
    check("the heads say triggered: it is what the alarm shows, quietly: no event, no siren, no message but the state", [c.st, types(c), tasmota.cmds, size(said), said[-1]["st"]], ["triggered", [], ["_EspNowMeshId"], 1, "triggered"])
    check("the counter is the flash's, and the next action is above it", [c.mesh.rep.ctr, c.arm("away", "panel") == false, c.disarm("panel"), ZbAlarmMerge.dot_of(c.mesh.rep.heads[0])], [5, true, true, ZbAlarmMerge.dot(1, 6)])
    # heads in the flash, and a change before the replica: the change is the newer word
    var d = boot({"zb_alarm_heads": remote(1, 1, 5, 123, tl, nil).tohex(), "zb_alarm_ctr": 5})
    d.arm("away", "ha")
    mesh.on = true
    d.every_second()
    check("an arm before the replica was up, over heads that said armed home: the arm descends from them", [d.mesh.rep.heads == [d.mesh.rep.heads[0]], ZbAlarmMerge.st_of(d.mesh.rep.heads[0]), ZbAlarmMerge.dot_of(d.mesh.rep.heads[0])], [true, 2, ZbAlarmMerge.dot(1, 6)])
    # heads that say armed home, and a legacy view that says nothing was done: the heads are the state
    var e = boot({"zb_alarm_heads": remote(1, 1, 5, 123, tl, nil).tohex(), "zb_alarm_ctr": 5})
    mesh.on = true
    e.every_second()
    check("armed home from the heads, with no event", [e.st, e.mode, types(e)], ["armed_home", "home", []])
end
born_checks()

# --- the alarm number from the house's list ------------------------------------------------------------------------------------------

# the relay's house as ZbAlarmMesh.slot() reads it: whether it is up, and its list
class FakeHouse
    var up, list
    def init(lst) self.up = true self.list = lst end
end
class FakeRelay
    var house
    def init(house) self.house = house end
end

def house_slot_checks()
    import global
    var ident = def (k)
        var d = bytes(-39)
        d[0] = 1
        d[1] = k
        return d
    end
    var l = HouseList(3)
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 3}
    persist.zero()
    global.zbbridge_relay = FakeRelay(FakeHouse(l))
    check("a bridge that is in no house has the interim: its mesh number", ZbAlarmMesh.slot(), 3)
    persist.setmember("zb_alarm_slot", 9)
    check("or the key of the flash", ZbAlarmMesh.slot(), 9)
    # in a house: the list's number, whatever the interim says
    l.apply(1, 1, 1, HouseList.K_IDENT, 3, ident(3))
    l.apply(1, 2, 2, HouseList.K_SLOT, 3, bytes("07"))
    check("a bridge that is in the house has the number the list gives it", ZbAlarmMesh.slot(), 7)
    persist.remove("zb_alarm_slot")
    check("and not its mesh number", ZbAlarmMesh.slot(), 7)
    # a 16th bridge has no number in the list: no replica
    var m = HouseList(3)
    m.apply(1, 1, 1, HouseList.K_IDENT, 3, ident(3))
    global.zbbridge_relay = FakeRelay(FakeHouse(m))
    check("a bridge of the house that has no alarm number has none, and not its mesh number", ZbAlarmMesh.slot(), nil)
    # struck off: none
    var n = HouseList(3)
    n.apply(1, 1, 1, HouseList.K_IDENT, 3, ident(3))
    n.apply(1, 2, 2, HouseList.K_SLOT, 3, bytes("07"))
    n.apply(1, 3, 3, HouseList.K_REVOKE, 3, bytes())
    global.zbbridge_relay = FakeRelay(FakeHouse(n))
    check("a bridge that was struck off has none", ZbAlarmMesh.slot(), nil)
    # a house that is not up (the node has no number yet): the interim
    var down = FakeHouse(l)
    down.up = false
    global.zbbridge_relay = FakeRelay(down)
    check("a house that is not up gives nothing: the interim", ZbAlarmMesh.slot(), 3)
    global.zbbridge_relay = FakeRelay(nil)
    check("no house at all: the interim", ZbAlarmMesh.slot(), 3)
    global.zbbridge_relay = nil
    check("no relay: the interim", ZbAlarmMesh.slot(), 3)
    persist.zero()
end
house_slot_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
