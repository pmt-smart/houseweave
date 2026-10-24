# berry/zbbridge_drivers.be, the host of the bridge's drivers, against a
# driver the test makes and a Zigbee network it fills: who has which device and for
# how long, the description that goes in the place of an interview, the reports that
# reach a driver and the state that comes back normalized (merged, left out when the
# panel has it, split to fit a frame), the schema's numbered frames, the panel's
# commands, a link that comes up, and a device that leaves. Each part is a function:
# the script's own top level is far past the 256 constants a function may name.

import global as natives
import json
import string
import persist

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

# the same, as maps compare: a map parsed from JSON keeps its keys in another order
def same(a, b)
    if isinstance(a, map)
        if !isinstance(b, map) || size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !same(a[k], b[k]) return false end
        end
        return true
    end
    if isinstance(a, list)
        if !isinstance(b, list) || size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if !same(a[i], b[i]) return false end
        end
        return true
    end
    return a == b
end
def check_same(name, got, want)
    checks += 1
    if !same(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# the IEEE as the zigbee module has it: 8 bytes, least significant first
def le_bytes(ieee)
    var h = ieee[2 ..]
    var s = ""
    var i = size(h) - 2
    while i >= 0
        s += h[i .. i + 1]
        i -= 2
    end
    return bytes(s)
end

# a device of the network, as the zigbee module lists it (be_zigbee.c)
class FakeZ
    var longaddr, shortaddr, name, model, manufacturer
    def init(ieee, short, manufacturer, model)
        self.longaddr = le_bytes(ieee)
        self.shortaddr = short
        self.manufacturer = manufacturer
        self.model = model
        self.name = ""
    end
end

# the module: whether Z2T is up, the devices, one found by "0x5ADF" or by its IEEE
class FakeNet
    var devices, up, finds
    def init() self.devices = [] self.up = true self.finds = 0 end
    def started() return self.up end
    def iter() return self.devices.iter() end
    def size() return size(self.devices) end
    def find(key)
        self.finds += 1
        var k = string.toupper(str(key))
        for z: self.devices
            var ieee = "0X"
            var i = size(z.longaddr) - 1
            while i >= 0
                ieee += string.format("%02X", z.longaddr[i])
                i -= 1
            end
            if k == string.format("0X%04X", z.shortaddr) || k == ieee return z end
        end
        return nil
    end
end

# a driver that has what the test says: a maker, a thermostat's interview, or a report of its own
class FakeDriver
    static ID = "fake"
    static VERSION = 1
    static KIND = "thermostat"
    static KEYS = ["FakeTemp"]
    var host, seen, cmds, seeded, forgot, described, fails
    def init(host)
        self.host = host
        self.seen = []
        self.cmds = []
        self.seeded = []
        self.forgot = []
        self.described = []
        self.fails = false
    end
    def claims(info)
        if self.fails raise "driver_error", "claims" end
        if info.find("Manufacturer", "") == "FakeCo" return true end
        if info.contains("report") && info["report"].contains("FakeTemp") return true end
        var clusters = info.find("InClusters", [])
        return info.find("DeviceId") == 0x0301 && clusters.find(0x0201) != nil
    end
    def describe(info)
        self.described.push(info["IEEEAddr"])
        return {"caps": 48, "min": 50, "max": 350}
    end
    def on_report(info, attrs)
        if self.fails raise "driver_error", "on_report" end
        self.seen.push([info["IEEEAddr"], attrs])
        if attrs.contains("FakeTemp")
            self.host.say(info["IEEEAddr"], "s", {"cur": int(attrs["FakeTemp"] * 10)})
        end
    end
    def command(info, cmd)
        self.cmds.push(cmd)
        return cmd.find("do") != "bad"
    end
    def seed(info) self.seeded.push(info["IEEEAddr"]) end
    def forget(info) self.forgot.push(info["IEEEAddr"]) end
end

# a second driver with the same ID and a greater version
class FakeDriverNext : FakeDriver
    static VERSION = 2
end

var TH_A = "0x00124B0000B00001"
var TH_B = "0x00124B0000B00002"
var TH_C = "0x00124B0000B00003"
var TH_D = "0x00124B0000B00004"
var LAMP = "0x90FD9FFFFE000001"

var net = FakeNet()
natives.zigbee = net
net.devices.push(FakeZ(TH_A, 0x1001, "FakeCo", "TS0601"))
net.devices.push(FakeZ(TH_B, 0x1002, "Acme", "ZCLTH"))
net.devices.push(FakeZ(LAMP, 0x2001, "IKEA of Sweden", "TRADFRI bulb"))
net.devices.push(FakeZ(TH_C, 0x1003, "Other", "T3"))

# what goes over the link, as the driver of the ESP-NOW link takes it
var told = []
natives.espnow_send = def (msg, as_event) told.push(json.load(msg)) return true end
# the host is a class of the firmware: a global of the bridge, which the relay starts
natives.ZbBridgeDrivers = ZbBridgeDrivers
var r = ZbBridgeRelay.start()
# what it says to the panels, over the mesh
listen_to(r, told)
var host = r.drivers
var fake = FakeDriver(host)

# the next message the host holds back goes, as its timer comes: whether there was one
def next_frame()
    return tasmota.timers.fire("zbbridge_drivers_frames")
end

# the time all of them take to go
def settle()
    var n = 0
    while n < 100 && next_frame()
        n += 1
    end
end

# a timer runs, and what it made the host say goes with the time that takes
def fire(id)
    var ran = tasmota.timers.fire(id)
    settle()
    return ran
end

# what the last event says of a device in a section, or nil
def said(ieee, sec)
    if size(told) == 0 return nil end
    var z = told[-1].find("ZbDriver")
    var d = z != nil ? z.find(ieee) : nil
    return d != nil ? d.find(sec) : nil
end

# a string of one piece, n times (Berry has no `*` for it)
def rep(s, n)
    var out = ""
    for i: 1 .. n out += s end
    return out
end

# the first key of a map
def first_key(m)
    for k: m.keys() return k end
    return nil
end

def interview(short, device_id, clusters)
    r.forward_state(nil, nil, {"ZbState": {"Status": 33, "Device": string.format("0x%04X", short), "Endpoint": 1,
                                              "ProfileId": "0x0104", "DeviceId": device_id, "InClusters": clusters}})
    settle()
end

# --- the host in the relay ------------------------------------------------------------------------
def relay_checks()
    check("the relay starts the host, as it starts the discovery", isinstance(host, ZbBridgeDrivers), true)
    check("ZbRelayDrive is a command the panel sends", ZbBridgeRelay.ALLOWED.find("ZBRELAYDRIVE") != nil, true)
    check("and the relay registered it", tasmota.handlers.contains("ZbRelayDrive"), true)
    check("a frame of the link is what the driver says", r.frame_budget(), 233)
end
relay_checks()

# --- who has a device -------------------------------------------------------------------------------
def claim_checks()
    check("a host with no driver takes no interview", host.interview({"Device": "0x1001"}), false)
    check("a driver in", [host.add(fake), size(host.drivers)], [true, 1])
    var old = fake
    var next = FakeDriverNext(host)
    check("the same ID and a smaller or equal version is turned away", host.add(FakeDriver(host)), false)
    check("a greater one takes the place of the one the firmware carries", [host.add(next), host.drivers[0] == next], [true, true])
    fake = next

    # a lamp's interview is nobody's, and goes as it always did
    told.clear()
    interview(0x2001, "0x0101", ["0x0000", "0x0006", "0x0008"])
    check("a lamp's interview goes to the panel as it is", [size(told), told[0].contains("ZbState"), told[0]["ZbState"]["Status"]], [1, true, 33])
    check("with the clusters the pages read, as always", told[0]["ZbState"]["InClusters"], ["0x0006", "0x0008"])
    check("and no driver has it", host.claimed.contains(LAMP), false)

    # a thermostat: Z2T knows its maker by the interview, and the driver has it by that
    told.clear()
    interview(0x1001, "0x0051", ["0x0000", "0xEF00"])
    check("the description goes in the interview's place: one event, and it is the driver's", [size(told), told[0].contains("ZbDriver"), told[0].contains("ZbState")],
          [1, true, false])
    check_same("with the driver's words and the host's: kind, driver, model", said(TH_A, "d"),
               {"caps": 48, "min": 50, "max": 350, "kind": "thermostat", "drv": "fake", "model": "TS0601"})
    check("the driver is asked for the state after it", [fake.seeded, fake.described], [[TH_A], [TH_A]])
    check("the device is the driver's, kept in the flash", [host.claimed[TH_A] == fake, host.kept[TH_A], persist.store["zb_relay_drivers"][TH_A]],
          [true, "fake", "fake"])
    check("saved a moment after it stops changing", tasmota.timers.contains("zbbridge_drivers_save"), true)
    fire("zbbridge_drivers_save")
    check("and the flash has it", persist.written != nil && string.find(persist.written, "zb_relay_drivers") >= 0, true)

    # a ZCL thermostat, by the clusters of its interview: what a restart could not tell again
    told.clear()
    interview(0x1002, "0x0301", ["0x0000", "0x0201"])
    check("a thermostat's endpoint is the driver's by its clusters", [host.claimed.contains(TH_B), said(TH_B, "d") != nil], [true, true])
    var plug = {"IEEEAddr": "0x1", "DeviceId": 0x0051, "InClusters": [0x0006]}
    check("a device the driver does not claim by them: an on/off plug is not", host.claim(plug), nil)

    # a second endpoint, or an interview again: described again
    told.clear()
    interview(0x1001, "0x0051", ["0x0000", "0xEF00"])
    check("an interview of a device it has describes it again", [size(told), said(TH_A, "d") != nil, size(host.kept)], [1, true, 2])

    # a restart: the claims come back from the flash, for the drivers added
    var again = ZbBridgeDrivers(r)
    check("a host that starts keeps what the flash says, and no driver yet", [size(again.kept), size(again.claimed)], [2, 0])
    var f2 = FakeDriver(again)
    again.add(f2)
    check("a driver of that ID added takes its devices", [again.claimed[TH_A] == f2, again.claimed[TH_B] == f2, size(again.claimed)], [true, true, 2])

    # a driver that raises on a claim does not stop the interview, nor the next driver
    fake.fails = true
    told.clear()
    interview(0x1003, "0x0051", ["0x0000", "0xEF00"])
    check("a driver that fails on a claim: the interview goes as it always did", [size(told), told[0].contains("ZbState"), host.claimed.contains(TH_C)],
          [1, true, false])
    fake.fails = false
end
claim_checks()

# --- what the devices report ------------------------------------------------------------------------
def report_checks()
    host.last = {}
    fake.seen.clear()
    told.clear()
    host.on_received({"0x1001": {"Device": "0x1001", "FakeTemp": 21.5, "LinkQuality": 80}})
    check("a report of a device of the driver's reaches it, whole", [size(fake.seen), fake.seen[0][0], fake.seen[0][1]["FakeTemp"]], [1, TH_A, 21.5])
    check("and what it says is not sent yet: it waits for more", [size(told), tasmota.timers.contains("zbbridge_drivers_send")], [0, true])
    fire("zbbridge_drivers_send")
    check_same("then it goes as the normalized state", said(TH_A, "s"), {"cur": 215})

    told.clear()
    host.on_received({"0x1001": {"Device": "0x1001", "FakeTemp": 21.5}})
    fire("zbbridge_drivers_send")
    check("the same value again: the panel has it, nothing goes", size(told), 0)
    host.on_received({"0x1001": {"Device": "0x1001", "FakeTemp": 21.0}})
    fire("zbbridge_drivers_send")
    check_same("a changed one goes", said(TH_A, "s"), {"cur": 210})

    # the host says whether the device answers
    told.clear()
    host.on_received({"0x1001": {"Device": "0x1001", "Reachable": false}})
    fire("zbbridge_drivers_send")
    check_same("a device that stopped answering: up false, from the host", said(TH_A, "s"), {"up": false})
    host.on_received({"0x1001": {"Device": "0x1001", "Reachable": true}})
    fire("zbbridge_drivers_send")
    check_same("and answering again", said(TH_A, "s"), {"up": true})

    # a lamp's reports are nobody's, and cost no lookup
    fake.seen.clear()
    var known = size(host.shorts)
    var looked = net.finds
    host.on_received({"0x2001": {"Device": "0x2001", "Power": 1, "Dimmer": 50, "LinkQuality": 90}})
    check("a lamp's report goes to no driver, and the host learns nothing of it", [size(fake.seen), size(host.shorts)], [0, known])
    check("and it costs the zigbee module no lookup", net.finds, looked)
    host.on_received({"0x9999": {"Device": "0x9999", "FakeTemp": 20.0}})
    check("a report of a device the network does not have: nobody's", size(fake.seen), 0)
    host.on_received({"somename": {"FakeTemp": 20.0}})
    host.on_received({"0x1001": 7})
    check("a name with no address, and one that is no map, are let go", size(fake.seen), 0)

    # a device nothing has yet, whose own report says it is a thermostat
    told.clear()
    host.on_received({"0x1003": {"Device": "0x1003", "FakeTemp": 19.0}})
    check("a report of a driver's KEYS claims a device nothing had", [host.claimed.contains(TH_C), size(fake.seen), host.shorts[0x1003]], [true, 1, TH_C])
    check("and the report is the driver's at once", fake.seen[0][1]["FakeTemp"], 19.0)
    check("described to the NSPanel first, as an interview's is, for it has no thermostat until then, or has one it took for something else",
          [size(told), told[0]["ZbDriver"].contains(TH_C), told[0]["ZbDriver"][TH_C].contains("d"), host.queue.find(TH_C)], [1, true, true, nil])
    fire("zbbridge_drivers_send")
    check("then its state", [size(told), told[0]["ZbDriver"][TH_C].contains("d"), told[1]["ZbDriver"][TH_C].contains("s")], [2, true, true])
    check_same("with its words", said(TH_C, "s"), {"cur": 190})

    # a report that brings the maker: the driver may claim by it
    fake.seen.clear()
    var d = FakeZ(TH_D, 0x1004, "FakeCo", "TS0601")
    net.devices.push(d)
    host.on_received({"0x1004": {"Device": "0x1004", "ModelId": "TS0601", "Manufacturer": "FakeCo"}})
    check("a report with a model and a maker is looked at, and the maker is the driver's", [host.claimed.contains(TH_D), size(fake.seen)], [true, 1])

    # a driver that raises on a report does not stop the others
    fake.fails = true
    host.on_received({"0x1001": {"Device": "0x1001", "FakeTemp": 25.0}, "0x1002": {"Device": "0x1002", "FakeTemp": 24.0}})
    check("a driver that fails on a report: the host goes on", true, true)
    fake.fails = false
end
report_checks()

# --- what the drivers say, in the frame the link has ---------------------------------------------------
def say_checks()
    host.last = {}
    host.pending = {}
    told.clear()
    host.say(TH_A, "s", {"cur": 200})
    host.say(TH_A, "s", {"set": 215})
    host.say(TH_B, "s", {"cur": 180})
    fire("zbbridge_drivers_send")
    check("what is said within a moment is one message a device", [size(told), told[0]["ZbDriver"].contains(TH_A) || told[1]["ZbDriver"].contains(TH_A)], [2, true])
    var both = nil
    for ev: told
        if ev["ZbDriver"].contains(TH_A) both = ev["ZbDriver"][TH_A]["s"] end
    end
    check_same("the device's words merged", both, {"cur": 200, "set": 215})

    told.clear()
    host.say(TH_A, "s", {"cur": 200, "set": 220})
    fire("zbbridge_drivers_send")
    check_same("only what changed since the panel heard", said(TH_A, "s"), {"set": 220})
    host.say(TH_A, "v", {"lock": false})
    host.say(TH_A, "s", {"cur": 200})
    told.clear()
    fire("zbbridge_drivers_send")
    check_same("a section of its own, and a field the panel has is left out", [size(told), said(TH_A, "v")], [1, {"lock": false}])

    told.clear()
    host.say(LAMP, "s", {"cur": 1})
    host.say("0x00124B00009999FF", "s", {"cur": 1})
    fire("zbbridge_drivers_send")
    check("a device nobody has says nothing", size(told), 0)

    # more than a frame holds: split by field, none cut
    host.last = {}
    var many = {}
    for i: 0 .. 29
        many[string.format("field%02d", i)] = "value number " + str(i)
    end
    told.clear()
    host.say(TH_A, "s", many)
    fire("zbbridge_drivers_send")
    var total = 0
    var fits = true
    var seen = {}
    for ev: told
        var f = ev["ZbDriver"][TH_A]["s"]
        total += size(f)
        for k: f.keys() seen[k] = f[k] end
        if size(json.dump(ev)) > 233 fits = false end
    end
    check("30 fields do not fit a frame: several, each within it", [size(told) > 1, fits], [true, true])
    check_same("and every field once, as it was", seen, many)
    check("none twice", total, 30)


    # a field that alone does not fit
    told.clear()
    host.last = {}
    host.say(TH_A, "s", {"big": rep("x", 400), "small": 1})
    fire("zbbridge_drivers_send")
    check_same("a field past the frame is dropped and the others go", said(TH_A, "s"), {"small": 1})
end
say_checks()

# --- a list, in numbered frames --------------------------------------------------------------------
def list_checks()
    var schema = []
    for i: 0 .. 10
        schema.push({"k": "setting" + str(i), "t": "num", "l": "Setting number " + str(i), "min": 0, "max": 100, "s": 1})
    end
    told.clear()
    check("a list goes", host.send_list(TH_A, "x", schema), true)
    var frames = size(told) + size(host.outbox)
    check("in several frames: the first at once, and the others wait their turn", [frames > 1, size(told), size(host.outbox)], [true, 1, frames - 1])
    check("with a timer for the next", tasmota.timers.contains("zbbridge_drivers_frames"), true)
    next_frame()
    check("the next goes when the timer comes, and only that one", [size(told), size(host.outbox)], [2, frames - 2])
    settle()
    check("and so on until all have gone, and the host is idle again", [size(told), size(host.outbox), host.pumping, tasmota.timers.contains("zbbridge_drivers_frames")],
          [frames, 0, false, false])
    check("each within the direct frame", (def ()
        for ev: told if size(json.dump(ev)) > 233 return false end end
        return true
    end)(), true)
    var got = []
    var at_ok = true
    var of_ok = true
    for ev: told
        var f = ev["ZbDriver"][TH_A]["x"]
        if f["at"] != size(got) at_ok = false end
        if f["of"] != 11 of_ok = false end
        for e: f["l"] got.push(e) end
    end
    check("each frame says where it starts, and they follow each other", at_ok, true)
    check("and how many there are in all", of_ok, true)
    check_same("and the entries come out as they went in", got, schema)

    told.clear()
    check("an empty list is one frame that says there are none", [host.send_list(TH_A, "x", []), size(told), told[0]["ZbDriver"][TH_A]["x"]["of"]], [true, 1, 0])
    settle()
    told.clear()
    var wide = [{"k": "a"}, {"k": "b", "l": rep("y", 300)}]
    check("an entry that fits no frame: nothing is sent, and it says so", [host.send_list(TH_A, "x", wide), size(told)], [false, 0])
    check("a list of a device nobody has is nothing", host.send_list(LAMP, "x", schema), false)
end
list_checks()

# --- the messages go one at a time ------------------------------------------------------------------
def pacing_checks()
    settle()
    told.clear()
    var m = def (n) return {"ZbDriver": {TH_A: {"s": {"cur": n}}}} end
    host.emit(m(1))
    host.emit(m(2))
    host.emit(m(3))
    check("a message goes at once when none is on its way, and the others wait", [size(told), size(host.outbox), host.pumping], [1, 2, true])
    next_frame()
    check("one at each turn of the timer", [size(told), size(host.outbox)], [2, 1])
    next_frame()
    next_frame()
    check("in the order they were said, and the host idle after the last", [(def ()
        var order = []
        for ev: told order.push(ev["ZbDriver"][TH_A]["s"]["cur"]) end
        return order
    end)(), size(host.outbox), host.pumping], [[1, 2, 3], 0, false])

    # one said after the host went idle goes at once again
    host.emit(m(4))
    check("and the next one after that goes at once", [size(told), size(host.outbox)], [4, 0])
    settle()

    # a link that comes up says everything again: what waited for the old one is not said
    told.clear()
    host.emit(m(5))
    host.emit(m(6))
    host.emit(m(7))
    host.link_up()
    check("a link that comes up drops what waited for the old one", [size(told), size(host.outbox)], [1, 0])
    settle()
    tasmota.timers.remove("zbbridge_drivers_announce")
    host.queue = []
    host.announcing = false
    check("and nothing of it goes later", size(told), 1)
end
pacing_checks()

# --- the panel's commands ---------------------------------------------------------------------------
def drive_checks()
    tasmota.answers.clear()
    fake.cmds.clear()
    told.clear()
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124b0000b00001","do":"target","v":215}')
    check_same("a command reaches the driver that has the device, whole", fake.cmds, [{"id": "0x00124b0000b00001", "do": "target", "v": 215}])
    check("and the console is told it was taken", [tasmota.answers, size(told)], [["done"], 0])

    tasmota.answers.clear()
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B00009999FF","do":"target","v":215}')
    check("a device nobody has: refused, and the panel is told", [tasmota.answers, said("0x00124B00009999FF", "e")], [["failed"], "nodriver"])
    settle()
    tasmota.answers.clear()
    told.clear()
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B0000B00001","do":"bad"}')
    check("a driver that will not take it: refused too", [tasmota.answers, said(TH_A, "e")], [["failed"], "refused"])
    settle()
    tasmota.answers.clear()
    told.clear()
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, "not json")
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B0000B00001"}')
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"do":"target"}')
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, "[1,2]")
    check("what is no command: failed, and nothing said to the panel", [tasmota.answers, size(told)], [["failed", "failed", "failed", "failed"], 0])

    # a driver that raises is refused, not a crash
    fake.fails = false
    tasmota.answers.clear()

    # the whole of a state, asked for: heard again, changed or not
    host.last = {}
    host.say(TH_A, "s", {"cur": 210})
    fire("zbbridge_drivers_send")
    told.clear()
    host.say(TH_A, "s", {"cur": 210})
    fire("zbbridge_drivers_send")
    check("a value the panel has: nothing", size(told), 0)
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B0000B00001","do":"read"}')
    host.say(TH_A, "s", {"cur": 210})
    fire("zbbridge_drivers_send")
    check_same("after a read asked for, the same value goes again", said(TH_A, "s"), {"cur": 210})
    told.clear()
    host.say(TH_A, "v", {"lock": true})
    fire("zbbridge_drivers_send")
    told.clear()
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B0000B00001","do":"settings"}')
    host.say(TH_A, "v", {"lock": true})
    fire("zbbridge_drivers_send")
    check_same("and so the settings", said(TH_A, "v"), {"lock": true})

    # the answer to any command is the whole of what the driver says of it: a frame lost leaves the NSPanel with the last word it did
    # not hear, and a tap that finds nothing changed to say would leave it there
    host.last = {}
    host.say(TH_A, "s", {"cur": 210, "set": 215})
    fire("zbbridge_drivers_send")
    told.clear()
    host.say(TH_A, "s", {"cur": 210, "set": 215})
    fire("zbbridge_drivers_send")
    check("a state the NSPanel was sent, said again: nothing", size(told), 0)
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B0000B00001","do":"target","v":215}')
    host.say(TH_A, "s", {"cur": 210, "set": 215})
    fire("zbbridge_drivers_send")
    check_same("after a command that is neither a read nor the settings: the same state goes again, whole", said(TH_A, "s"), {"cur": 210, "set": 215})
    told.clear()
    host.say(TH_A, "s", {"cur": 210, "set": 215})
    fire("zbbridge_drivers_send")
    check("and what is said with no command in between is as it was: nothing", size(told), 0)
    host.last = {"0x00124B0000B00002": {"s": {"cur": 1}}}
    tasmota.handlers["ZbRelayDrive"]("ZbRelayDrive", 1, '{"id":"0x00124B0000B00001","do":"bad"}')
    check("a command the driver refuses clears it too, and the other devices' words are left", [size(host.last.find(TH_A, {})), size(host.last.find(TH_B, {}))], [0, 1])
    settle()

    # over the link, by the relay: a command of the panel's runs, and one that is not is refused
    tasmota.cmds.clear()
    r.run('ZbRelayDrive {"id":"0x00124B0000B00001","do":"mode","v":"heat"}', "ESP-NOW")
    check("the relay runs it as it runs the panel's others", tasmota.cmds, ['ZbRelayDrive {"id":"0x00124B0000B00001","do":"mode","v":"heat"}'])
end
drive_checks()

# --- the link, the network, and a device that leaves ----------------------------------------------------
def link_checks()
    host.queue = []
    host.last = {"0x00124B0000B00001": {"s": {"cur": 1}}}
    host.claimed.remove(TH_D)
    host.kept.remove(TH_D)
    host.claimed.remove(TH_C)
    host.kept.remove(TH_C)
    fake.seeded.clear()
    fake.described.clear()
    told.clear()
    host.link_up()
    check("a link that comes up: the panel hears everything again", size(host.last), 0)
    check("the first announce waits a moment, for the link's own words to go first", [size(told), tasmota.timers.contains("zbbridge_drivers_announce")], [0, true])
    check("every device of a driver in the queue, and the ones the network has that a driver has by what it knows", size(host.queue), 3)
    check("the maker's device the host did not have is found by the scan", host.claimed.contains(TH_D), true)
    var first = fire("zbbridge_drivers_announce")
    check("one device announced, and the next after a gap", [first, size(told), tasmota.timers.contains("zbbridge_drivers_announce")], [true, 1, true])
    check("with its description and the driver asked for the state", [said(first_key(told[0]["ZbDriver"]), "d") != nil, size(fake.seeded)], [true, 1])
    fire("zbbridge_drivers_announce")
    fire("zbbridge_drivers_announce")
    check("all of them, once each", [size(told), size(host.queue), size(fake.seeded)], [3, 0, 3])
    check("and no timer left to announce", tasmota.timers.contains("zbbridge_drivers_announce"), false)

    # a panel's session with this bridge comes up: its first word, ZbRelayListen 1
    host.queue = []
    tasmota.timers.remove("zbbridge_drivers_announce")
    r.run("ZbRelayListen 1", "mesh", 4)
    check("a panel whose session with this bridge came up: the devices of the drivers are heard again", [size(host.queue), tasmota.timers.contains("zbbridge_drivers_announce")], [3, true])
    tasmota.timers.remove("zbbridge_drivers_announce")
    host.queue = []
    host.announcing = false
    r.run("ZbRelayListen", "mesh", 4)
    check("and its word that keeps it a listener says nothing again", size(host.queue), 0)

    # a join, or a device back with its power: the address may be a new one
    told.clear()
    host.announced({"Status": 30, "IEEEAddr": "0x00124b0000b00002", "ShortAddr": "0x1FFF"})
    check("the announce of a device of the driver's: its address is the new one, and the old one is let go", [host.shorts.contains(0x1FFF), host.shorts.contains(0x1002), host.shorts.find(0x1FFF)],
          [true, false, TH_B])
    check("and it is asked for what it says a moment later", [size(told), tasmota.timers.contains("zbbridge_drivers_rejoin_" + TH_B)], [0, true])
    for z: net.devices
        if z.shortaddr == 0x1002 z.shortaddr = 0x1FFF end
    end
    fake.seeded.clear()
    fire("zbbridge_drivers_rejoin_" + TH_B)
    check("when it can answer: its description, and its state asked for", [said(TH_B, "d") != nil, fake.seeded], [true, [TH_B]])
    host.announced({"Status": 30, "IEEEAddr": LAMP, "ShortAddr": "0x2001"})
    check("a lamp's announce is none of the host's", tasmota.timers.contains("zbbridge_drivers_rejoin_" + LAMP), false)
    # the same through the relay's own rule, which still tells the panel
    told.clear()
    settle_frames(r)
    r.forward_state(nil, nil, {"ZbState": {"Status": 30, "IEEEAddr": TH_B, "ShortAddr": "0x1002"}})
    check("through the relay: the panel hears the announce as always, and the host the new address", [told[0]["ZbState"]["Status"], host.shorts.find(0x1002), host.shorts.contains(0x1FFF)], [30, TH_B, false])
    tasmota.timers.remove("zbbridge_drivers_rejoin_" + TH_B)

    # at boot, once Z2T is up
    host.waited = 0
    net.up = false
    host.boot()
    check("at boot the network is looked at after a few seconds", tasmota.timers.contains("zbbridge_drivers_boot"), true)
    fire("zbbridge_drivers_boot")
    check("Z2T not up yet: again, a try counted", [tasmota.timers.contains("zbbridge_drivers_boot"), host.waited], [true, 1])
    net.up = true
    host.claimed.remove(TH_D)
    host.kept.remove(TH_D)
    # a claim the flash kept of a device the network does not have (forgotten at the console)
    var GHOST = "0x00124B00DEAD0001"
    host.kept[GHOST] = fake.ID
    host.claimed[GHOST] = fake
    fake.forgot.clear()
    fire("zbbridge_drivers_boot")
    check("up: the scan, which finds the devices and stops looking", [host.claimed.contains(TH_D), tasmota.timers.contains("zbbridge_drivers_boot")], [true, false])
    check("and a claim of a device the network does not have goes first, its driver told", [host.claimed.contains(GHOST), host.kept.contains(GHOST), fake.forgot], [false, false, [GHOST]])
    # a device the NSPanel assigned a driver, with its configuration, absent at boot: kept until it is forgotten
    var MINE = "0x00124B00DEAD0002"
    host.kept[MINE] = fake.ID
    host.claimed[MINE] = fake
    host.assigned[MINE] = {"drv": fake.ID, "t": 30}
    host.waited = 0
    host.boot()
    fire("zbbridge_drivers_boot")
    check("an assigned device absent at boot keeps its claim and its configuration", [host.claimed.contains(MINE), host.assigned.contains(MINE)], [true, true])
    host.check()
    check("and goes when the network is looked at for a forget", [host.claimed.contains(MINE), host.assigned.contains(MINE)], [false, false])
    # a network that lists nothing at boot drops nothing: Z2T may not have its list yet
    var all = net.devices
    net.devices = []
    host.kept[GHOST] = fake.ID
    host.claimed[GHOST] = fake
    host.waited = 0
    host.boot()
    fire("zbbridge_drivers_boot")
    check("a network that lists nothing at boot drops no claim", host.claimed.contains(GHOST), true)
    net.devices = all
    host.drop(GHOST)
    told.clear()
    check("and describes what it found: the NSPanel may have been linked before Z2T was up", [tasmota.timers.contains("zbbridge_drivers_announce"), host.queue], [true, [TH_D]])
    fire("zbbridge_drivers_announce")
    check("its description goes, and the timer is done", [said(TH_D, "d") != nil, host.announcing, size(host.queue)], [true, false, 0])
    # a link up before Z2T: nothing described nor asked then, and every device once Z2T is up
    host.waited = 0
    net.up = false
    fake.seeded.clear()
    host.link_up()
    check("a link up before Z2T: nothing to describe yet, and no seed", [size(host.queue), fake.seeded], [0, []])
    host.boot()
    net.up = true
    fire("zbbridge_drivers_boot")
    check("once Z2T is up, every device the bridge has is described", size(host.queue), size(host.claimed))
    fire("zbbridge_drivers_announce")
    while tasmota.timers.contains("zbbridge_drivers_announce") fire("zbbridge_drivers_announce") end
    host.waited = ZbBridgeDrivers.BOOT_TRIES
    net.up = false
    host.boot()
    fire("zbbridge_drivers_boot")
    check("a bridge whose Z2T never comes up gives up looking", tasmota.timers.contains("zbbridge_drivers_boot"), false)
    net.up = true

    # a device removed: the claim goes once Z2T's list has changed
    var gone = nil
    for z: net.devices
        if z.shortaddr == 0x1001 gone = z end
    end
    net.devices.remove(net.devices.find(gone))
    fake.forgot.clear()
    tasmota.cmds.clear()
    r.run("ZbForget 0x1001", "ESP-NOW")
    check("a device the panel removed: the host looks a moment later, as the discovery does", [tasmota.cmds, tasmota.timers.contains("zbbridge_drivers_check")], [["ZbForget 0x1001"], true])
    fire("zbbridge_drivers_check")
    check("its claim goes, and its driver is told", [host.claimed.contains(TH_A), host.kept.contains(TH_A), fake.forgot, size(host.last.find(TH_A, {}))], [false, false, [TH_A], 0])
    check("the others stay", [host.claimed.contains(TH_B), host.kept.contains(TH_B)], [true, true])
    check("and the flash is written", tasmota.timers.contains("zbbridge_drivers_save"), true)
    # Z2T not up: nothing is dropped for a network that cannot be read
    net.up = false
    host.check()
    check("a network that cannot be read drops nothing", host.claimed.contains(TH_B), true)
    net.up = true
end
link_checks()

# --- a save that falls over is not an exception out of the claims' timer -------------------------------------------
def failing_save_checks()
    var err = nil
    persist.plan = nil
    persist.failures = 0
    host.save_later()
    persist.fail_next()
    try
        tasmota.timers.fire("zbbridge_drivers_save")
    except .. as e
        err = e
    end
    check("the claims' save falling over raises nothing in its timer, and the claims are in memory for the one that works", [err, persist.failures, persist.find(ZbBridgeDrivers.KEY, nil) != nil], [nil, 1, true])
    persist.plan = nil
end
failing_save_checks()

# --- Home Assistant follows what a driver says of a device (zbbridge_discovery.be, refresh): the host tells the relay's discovery when it describes a
# device again, and when it gives it back; a relay with no discovery, or one that raises, changes nothing of the rest ---------------------------------
class FakeDiscovery
    var calls, fail
    def init() self.calls = [] self.fail = false end
    def refresh(ieee)
        self.calls.push(ieee)
        if self.fail  raise "test_error", "the discovery fell over" end
    end
end
def discovery_checks()
    check("the relay of these tests has no discovery, and every check above ran with none", r.discovery, nil)
    check("two devices are the drivers' at this point", [host.claimed.contains(TH_B), host.claimed.contains(TH_D)], [true, true])
    var fd = FakeDiscovery()
    r.discovery = fd
    told.clear()
    host.announce(TH_D)
    check("a device described again is told to the discovery once, after the panel's frame went", [fd.calls, size(told) > 0], [[TH_D], true])
    fd.calls.clear()
    host.announce("0x00124B00009999FF")
    check("a device no driver has is not described, and says nothing to the discovery", fd.calls, [])
    settle()
    fd.fail = true
    told.clear()
    host.announce(TH_D)
    settle()
    fd.fail = false
    check("a discovery that raises costs the host nothing: the panel was told, and the driver seeded", [size(told) > 0, fake.seeded[-1]], [true, TH_D])
    fd.calls.clear()
    check("a device given back is told too", [host.release(TH_D), fd.calls], [true, [TH_D]])
    r.discovery = nil
    check("and with no discovery it is all as before", [host.announce(TH_B), host.release(TH_B)], [nil, true])
end
discovery_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
