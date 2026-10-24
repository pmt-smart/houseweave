# MeshCmd (mesh_cmd.be): a command over the mesh to the bridge that owns the device, with the stamp of the mesh's clock.
# The sender (the stamp, the token, the mesh's word on it), and the owner's admission, in its order: repeat, behind, short, sync, stale, obsolete.
# What is NOT here is the mesh itself: libs/nspanel-sim/vm/test/ runs it in a house of several nodes.

import json

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
def check(name, got, want)
    checks += 1
    if !same(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# the natives of the mesh driver that the class uses, as a test sets them
class FakeMesh
    var synced, tag, age, sent, next_token, accept, max, clock_up
    def init()
        self.synced = true
        self.tag = true
        self.age = 10
        self.sent = []
        self.next_token = 1
        self.accept = true
        self.max = 220
        self.clock_up = true
    end
    def stamp()
        if !self.synced return false end
        return bytes("0001000000FF")
    end
    def age_of(st)
        if size(st) != 6 return false end
        return {"age": self.age, "tag": self.tag, "synced": self.synced}
    end
    def send(dest, kind, ack, data)
        if !self.accept return false end
        self.sent.push({"dest": dest, "type": kind, "ack": ack, "data": data.copy()})
        var t = self.next_token
        self.next_token += 1
        return t
    end
    def clock()
        return self.clock_up ? {"synced": self.synced} : false
    end
end
var mesh = FakeMesh()
def natives_on()
    import global as natives
    natives.espnow_mesh_stamp = / -> mesh.stamp()
    natives.espnow_mesh_age = / st -> mesh.age_of(st)
    natives.espnow_mesh_send = / dest, kind, ack, data -> mesh.send(dest, kind, ack, data)
    natives.espnow_mesh_max_payload = / dest -> mesh.max
    natives.espnow_mesh_clock = / -> mesh.clock()
end

# what the owner ran
var ran = []
def made()
    var c = MeshCmd(nil)
    c.run_fn = def (line) ran.push(line) end
    while size(ran) > 0  ran.pop() end
    return c
end

# a frame of the mesh for the application, as the driver's rule has it: a command with its stamp and its line
def frame(from, line, behind, flags, epoch, counter)
    var d = bytes("0001000000FF")
    d .. bytes().fromstring(line)
    return {"From": from, "Type": 0, "Dest": 1, "Counter": counter != nil ? counter : 100, "Epoch": epoch != nil ? epoch : 7, "Rssi": -50,
            "Flags": flags != nil ? flags : 0, "Behind": behind != nil ? behind : 0, "Data": d.tohex()}
end
def lamp(on) return 'ZbSend {"Device":"0x00124B0000AA000A","Send":{"Power":' + (on ? "1" : "0") + '}}' end

# --- an image with no mesh driver: nothing, and it says so (before any native is set) -----------------------------------------------

def no_driver_checks()
    var c = made()
    c.every_second()
    check("with no driver nothing starts, and no rule goes in", [MeshCmd.here(), c.up, mesh_has(MeshCmd.T_RULE)], [false, false, false])
    check("a send says there is no mesh", [c.send(3, "ZbPing", nil), c.why], [false, "no mesh"])
end
no_driver_checks()

# --- the sender -----------------------------------------------------------------------------------------------------------------

def sender_checks()
    natives_on()
    mesh = FakeMesh()
    var c = made()
    var line = lamp(true)
    var told = []
    var t = c.send(3, line, def (ok) told.push(ok) end)
    check("a command goes to the node that owns the device: a frame of type 0 to it, asking for the answer, with the stamp then the line", [t, size(mesh.sent), mesh.sent[0]["dest"], mesh.sent[0]["type"], mesh.sent[0]["ack"]], [1, 1, 3, 0, true])
    check("its data are the six bytes of the stamp and the line", [mesh.sent[0]["data"][0 .. 5].tohex(), mesh.sent[0]["data"][6 ..].asstring()], ["0001000000FF", line])
    check("the token is kept", c.last_token, 1)
    c.on_outcome({"Counter": 1, "Frame": 40, "Dest": 3, "Ok": 1, "Attempts": 1})
    check("the mesh's word on the send is told, true when it was confirmed", told, [true])
    c.on_outcome({"Counter": 1, "Ok": 1})
    check("and once", told, [true])
    c.send(3, line, def (ok) told.push(ok) end)
    c.on_outcome({"Counter": 2, "Dest": 3, "Ok": 0, "Attempts": 3})
    check("a send the mesh gave up is told false", told, [true, false])
    check("an Outcome of a send nobody asked about is nothing", [c.on_outcome({"Counter": 99, "Ok": 1}), size(c.tokens)], [nil, 0])
    # not synced: no stamp, nothing is sent
    mesh.synced = false
    var n = size(mesh.sent)
    check("not synced: nothing is sent, and the reason is said", [c.send(3, line, nil), c.why, size(mesh.sent)], [false, "not synced", n])
    mesh.synced = true
    mesh.max = 20
    check("a line too long for the frame is not sent", [c.send(3, line, nil), c.why, size(mesh.sent)], [false, "too long", n])
    mesh.max = 220
    mesh.accept = false
    check("a send the mesh refuses (the queue is full) is not sent, and the reason is said", [c.send(3, line, nil), c.why], [false, "refused"])
    mesh.accept = true
    check("sent again, it goes and clears the reason", [c.send(3, line, nil) != false, c.why], [true, ""])
end
sender_checks()

# --- the owner's admission --------------------------------------------------------------------------------------------------------

def admission_checks()
    natives_on()
    mesh = FakeMesh()
    var c = made()
    c.on_frame(frame(2, lamp(true)))
    check("a fresh command of a node of the house is run, as the owner's own", [ran, c.executed], [[lamp(true)], 1])
    # the type
    c.on_frame({"From": 2, "Type": 2, "Data": bytes("0001000000FF").tohex(), "Behind": 0, "Flags": 0})
    check("a frame of another type is not a command", size(ran), 1)
    # a repeat of a number the mesh handed over
    c.on_frame(frame(2, lamp(false), 0, 2, 7, 101))
    check("the resend of a number already handed over is not run again", [size(ran), c.refused["repeat"]], [1, 1])
    # behind
    c.on_frame(frame(2, lamp(false), 17, 0, 7, 102))
    check("a command that came more than 16 numbers behind is obsolete, and not run", [size(ran), c.refused["behind"]], [1, 1])
    c.on_frame(frame(2, lamp(false), 16, 0, 7, 103))
    check("16 behind is the limit and is accepted", [size(ran), ran[-1]], [2, lamp(false)])
    # short
    c.on_frame({"From": 2, "Type": 0, "Data": bytes("0001000000FF").tohex(), "Behind": 0, "Flags": 0, "Epoch": 7, "Counter": 104})
    c.on_frame({"From": 2, "Type": 0, "Data": "0001", "Behind": 0, "Flags": 0, "Epoch": 7, "Counter": 105})
    check("a stamp with no line, or less than a stamp, is nothing", [size(ran), c.refused["short"]], [2, 2])
    # sync and tag
    mesh.synced = false
    c.on_frame(frame(2, lamp(true), 0, 0, 7, 106))
    check("this node is not synced: nothing is run", [size(ran), c.refused["sync"]], [2, 1])
    mesh.synced = true
    mesh.tag = false
    c.on_frame(frame(2, lamp(true), 0, 0, 7, 107))
    check("a stamp of another timeline: nothing is run", [size(ran), c.refused["sync"]], [2, 2])
    mesh.tag = true
    # the window
    mesh.age = 3000
    c.on_frame(frame(2, lamp(true), 0, 0, 7, 108))
    check("3 s old is the edge of the window and is run", size(ran), 3)
    mesh.age = 3001
    c.on_frame(frame(2, lamp(false), 0, 0, 7, 109))
    check("a command older than the window is not run", [size(ran), c.refused["stale"]], [3, 1])
    mesh.age = -250
    c.on_frame(frame(2, lamp(false), 0, 0, 7, 110))
    check("250 ms in the future is the clocks' error and is run", size(ran), 4)
    mesh.age = -251
    c.on_frame(frame(2, lamp(true), 0, 0, 7, 111))
    check("from further in the future is not run", [size(ran), c.refused["stale"]], [4, 2])
    # the sensitive ones have a second
    mesh.age = 1001
    c.on_frame(frame(2, 'ZbRelayAlarm {"do":"disarm"}', 0, 0, 7, 112))
    check("an alarm word has a window of a second: 1001 ms is refused", [size(ran), c.refused["stale"]], [4, 3])
    mesh.age = 1000
    c.on_frame(frame(2, 'ZbRelayAlarm {"do":"disarm"}', 0, 0, 7, 113))
    check("and 1000 ms is run", [size(ran), ran[-1]], [5, 'ZbRelayAlarm {"do":"disarm"}'])
    c.sensitive_fn = / line -> true
    mesh.age = 2000
    c.on_frame(frame(2, lamp(true), 0, 0, 7, 114))
    check("what the owner marks as sensitive takes the short window too", [size(ran), c.refused["stale"]], [5, 4])
    c.sensitive_fn = nil
end
admission_checks()

# --- rule A: the order of the commands to one device ----------------------------------------------------------------

def string_hex(n)
    var b = bytes()
    b.add(n, 1)
    return b.tohex()
end
def order_checks()
    natives_on()
    mesh = FakeMesh()
    var c = made()
    tasmota.at_ms = 1000
    c.on_frame(frame(2, lamp(true), 0, 0, 7, 200))
    c.on_frame(frame(2, lamp(false), 0, 0, 7, 199))
    check("a command numbered below one already run for the same device of the same origin is obsolete", [ran, c.refused["obsolete"]], [[lamp(true)], 1])
    c.on_frame(frame(2, lamp(false), 0, 0, 7, 200))
    check("the same number is no newer", [size(ran), c.refused["obsolete"]], [1, 2])
    c.on_frame(frame(2, lamp(false), 0, 0, 7, 201))
    check("a newer one is run", [size(ran), ran[-1]], [2, lamp(false)])
    # another origin, another device, another channel of the device
    c.on_frame(frame(4, lamp(true), 0, 0, 7, 5))
    check("another origin has its own order", size(ran), 3)
    c.on_frame(frame(2, 'ZbSend {"Device":"0x00124B0000BB0001","Send":{"Power":1}}', 0, 0, 7, 3))
    check("another device has its own order", size(ran), 4)
    c.on_frame(frame(2, 'ZbSend {"Device":"0x00124B0000AA000A","Endpoint":2,"Send":{"Power":1}}', 0, 0, 7, 3))
    check("and another channel of the same device: the key is the IEEE and the endpoint", size(ran), 5)
    # the epoch: a greater one is newer whatever the counter, a smaller one is older
    c.on_frame(frame(2, lamp(true), 0, 0, 8, 1))
    check("a greater epoch is newer, whatever the counter", size(ran), 6)
    c.on_frame(frame(2, lamp(false), 0, 0, 7, 900))
    check("a smaller epoch is older, whatever the counter", [size(ran), c.refused["obsolete"]], [6, 3])
    # the ring forgets after 3 s
    tasmota.at_ms += 3000
    c.on_frame(frame(2, lamp(false), 0, 0, 7, 50))
    check("after the ring's time an old number is not known to be old: the window of the age is what judges it", [size(ran), size(c.ring)], [7, 1])
    # the ring has a ceiling
    for i: 1 .. 20
        c.on_frame(frame(2, 'ZbSend {"Device":"0x00124B0000CC00' + string_hex(i) + '","Send":{"Power":1}}', 0, 0, 7, 1))
    end
    check("the ring is a ring of 16, not a map with no ceiling", size(c.ring), 16)
end
order_checks()

# --- the key of a line -----------------------------------------------------------------------------------------------------------

def key_checks()
    check("a ZbSend's key is the IEEE", MeshCmd.key_of(lamp(true)), "0x00124B0000AA000A")
    check("with the endpoint, a channel's", MeshCmd.key_of('ZbSend {"Device":"0x00124B0000AA000A","Endpoint":3,"Send":{"Power":1}}'), "0x00124B0000AA000A/3")
    check("any other command's key is its word, in capitals", MeshCmd.key_of('ZbRelayAlarm {"do":"arm"}'), "ZBRELAYALARM")
    check("a bare word", MeshCmd.key_of("ZbPing"), "ZBPING")
end
key_checks()

# --- it starts by itself, when the mesh runs --------------------------------------------------------------------------------------

def wipe_rules()
    for k: tasmota.rules.keys()  tasmota.rules.remove(k) end
end
def start_checks()
    wipe_rules()
    natives_on()
    mesh = FakeMesh()
    var c = made()
    mesh.clock_up = false
    c.every_second()
    check("with the mesh not running nothing starts", [c.up, mesh_has(MeshCmd.T_RULE)], [false, false])
    mesh.clock_up = true
    c.every_second()
    check("when the clock answers it takes the frames and the Outcome, from the one rule of the dispatcher", [c.up, mesh_ids("frame").find(MeshCmd.T_RULE) != nil, mesh_ids("Outcome").find(MeshCmd.T_RULE) != nil, tasmota.rules.contains("EspNowMesh")], [true, true, true, true])
    var rules = size(tasmota.rules)
    c.every_second()
    check("and once", size(tasmota.rules), rules)
    # a frame through the rule runs the line
    tasmota.rules["EspNowMesh"](frame(2, lamp(true), 0, 0, 7, 77))
    check("a frame through the rule is admitted and run", ran, [lamp(true)])
end
start_checks()

# who sent it, with the line: a panel that commands a bridge hears its events for a while
do
    var c = MeshCmd(nil)
    var who = []
    c.run_fn = def (line, from) who.push([line, from]) end
    c.on_frame(frame(5, lamp(true), nil, nil, 9, 300))
    check("the line run, with the node that sent it", who, [[lamp(true), 5]])
end

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
