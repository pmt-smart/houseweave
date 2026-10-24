# berry/panel_route.be: where a line goes, against a store that says whose a device is and a MeshCmd that is a fake: the
# device read from the line as the panel writes it, the bridge that owns it, the bridge of the house for the house's words, a group's to every bridge that holds it,
# and the reasons a line did not leave. There is no link of the panel's own.

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
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

class FakeStore
    var owners
    def init() self.owners = {"0x00124B0000F00002": 2, "0x00124B0000F00003": 7} end
    def owner_of(dev)
        var i = 0
        var ieee = dev
        while i < size(dev)
            if dev[i] == "/" ieee = dev[0 .. i - 1] break end
            i += 1
        end
        return self.owners.find(ieee, 0)
    end
    def group_bridges(zid) return [] end
end

class FakeGate
    var says
    def init(says) self.says = says end
    def available(dev) return self.says[0] end
end

class FakeCmd
    var sent, why, ok
    def init() self.sent = [] self.why = "" self.ok = true end
    def send(node, line, answer)
        if !self.ok
            self.why = "not synced"
            return false
        end
        self.sent.push([node, line])
        return size(self.sent)
    end
end

var near = "0x00124B0000F00001"
var far = "0x00124B0000F00002"
var far7 = "0x00124B0000F00003"

def section_device()
    check("the Device of a ZbSend", PanelRoute.device_of('ZbSend {"Device":"' + far + '","Send":{"Power":1}}'), far)
    check("with an endpoint after it", PanelRoute.device_of('ZbSend {"Device":"' + far + '","Endpoint":2,"Send":{"Power":0}}'), far)
    check("the IEEE of a name", PanelRoute.device_of('ZbRelayName {"IEEE":"' + far + '","Name":"Lamp"}'), far)
    check("the address of a ping", PanelRoute.device_of("ZbPing " + far), far)
    check("the id of a driver's word: to the bridge whose driver has the device", PanelRoute.device_of('ZbRelayDrive {"id":"' + far + '","do":"move","v":"up"}'), far)
    check("a group's command names no device", PanelRoute.device_of('ZbSend {"Group":4660,"Send":{"Power":1}}'), nil)
    check("nor does the map of the network", PanelRoute.device_of("ZbInfo"), nil)
    check("nor a setting of the radio", PanelRoute.device_of("SetOption116 1"), nil)
    check("a ping of nothing", PanelRoute.device_of("ZbPing"), nil)
    check("the address of a leave and of a forget", [PanelRoute.device_of("ZbLeave " + far), PanelRoute.device_of("ZbForget " + far)], [far, far])
    check("a Device that is not closed", PanelRoute.device_of('ZbSend {"Device":"' + far), nil)
    check("the word, in capitals", [PanelRoute.word("ZbSend {}"), PanelRoute.word("zbping 0x1"), PanelRoute.word("ZbInfo")], ["ZBSEND", "ZBPING", "ZBINFO"])
end

def section_send()
    var cmd = FakeCmd()
    var r = PanelRoute(FakeStore(), cmd)
    var own = 'ZbSend {"Device":"' + near + '","Send":{"Power":1}}'
    check("a line about a device of no bridge numbered, with no bridge of the house: it does not leave, and why is counted (no link)",
          [r.send(own), size(cmd.sent), r.refused.find("no bridge of the house", 0)], [false, 0, 1])
    var other = 'ZbSend {"Device":"' + far + '","Send":{"Power":1}}'
    check("a line about another room's device goes over the mesh, to the bridge that owns it", [r.send(other), cmd.sent], [true, [[2, other]]])
    var seven = 'ZbSend {"Device":"' + far7 + '","Endpoint":2,"Send":{"Power":0}}'
    check("another bridge, another number; a channel is the device's", [r.send(seven), cmd.sent[1]], [true, [7, seven]])
    check("a ping and a name cross as well", [r.send("ZbPing " + far), r.send('ZbRelayName {"IEEE":"' + far7 + '","Name":"x"}')], [true, true])
    check("and are counted", [r.sent, size(cmd.sent)], [4, 4])
    check("the channel of a device of another room is that room's too", PanelRoute(FakeStore(), cmd).send('ZbSend {"Device":"' + far + '/2","Send":{"Power":1}}'), true)
    # any word to the bridge that owns the device: a forget of it too, and a ZbInfo of it
    var before = size(cmd.sent)
    var leave = 'ZbForget {"Device":"' + far + '"}'
    check("a forget of it goes to the bridge that owns it", [r.send(leave), cmd.sent[size(cmd.sent) - 1], size(cmd.sent) - before], [true, [2, leave], 1])
    check("and a ZbInfo of it", [r.send("ZbInfo " + far7), cmd.sent[-1]], [true, [7, "ZbInfo " + far7]])
    # the gate: a bridge that is not ready to act is not sent to
    var says = [true]
    r.gate = FakeGate(says)
    var n = size(cmd.sent)
    check("a device whose bridge the gate says is ready is sent to", [r.send(other), r.refused.find("bridge not ready", 0), size(cmd.sent)], [true, 0, n + 1])
    says[0] = false
    var held = size(cmd.sent)
    check("the gate says not, and the line is not sent: false, counted", [r.send(other), r.refused.find("bridge not ready", 0), size(cmd.sent)], [false, 1, held])
    r.gate = nil
    # a mesh that does not send
    cmd.ok = false
    check("a node that is not synced sends nothing, and says so", [r.send(other), r.refused.find("not synced", 0)], [false, 1])
    cmd.ok = true
    # an image without the mesh
    var bare = PanelRoute(FakeStore(), nil)
    check("with no mesh, another room's device is not reached", [bare.send(other), bare.refused], [false, {"no mesh": 1}])
    # the mesh found later, as the boot gives it
    bare.cmd = FakeCmd()
    check("and is, when the boot gives it the mesh", bare.send(other), true)
end

# The bridge of the house: the house's words, and the lines of a device of no bridge numbered, go to it over the mesh, while it is
# in step; there is no link to take what the mesh does not
def section_own()
    var cmd = FakeCmd()
    var r = PanelRoute(FakeStore(), cmd)
    var given = [0]
    r.own = / -> given[0]
    var own = 'ZbSend {"Device":"' + near + '","Send":{"Power":1}}'
    check("with no bridge of the house: nothing leaves", [r.send(own), size(cmd.sent)], [false, 0])
    given[0] = 5
    check("with one, over the mesh to it", [r.send(own), cmd.sent], [true, [[5, own]]])
    var group = 'ZbSend {"Group":4660,"Send":{"Power":0}}'
    check("a group nobody else holds too", [r.send(group), cmd.sent[1]], [true, [5, group]])
    check("the house's words: the alarm's, the time, the map, the bridge's word that this panel hears it",
          [r.send('ZbRelayAlarm {"do":"arm"}'), r.send('ZbRelayTime {}'), r.send("ZbInfo"), r.send("ZbRelayListen 1"), size(cmd.sent)],
          [true, true, true, true, 6])
    var other = 'ZbSend {"Device":"' + far + '","Send":{"Power":1}}'
    check("another room's device still goes to the bridge that owns it", [r.send(other), cmd.sent[-1]], [true, [2, other]])
    cmd.ok = false
    check("what the mesh does not send is false, and the reason counted", [r.send(own), r.refused.find("not synced", 0)], [false, 1])
    cmd.ok = true
    # the bridge of the house not in step: nothing leaves
    var in_step = [false]
    r.ready = / -> in_step[0]
    var sent_before = size(cmd.sent)
    check("the bridge of the house not in step on the mesh: nothing leaves", [r.send(own), size(cmd.sent)], [false, sent_before])
    in_step[0] = true
    check("in step again: by the mesh", [r.send(own), size(cmd.sent)], [true, sent_before + 1])
    var bare = PanelRoute(FakeStore(), nil)
    bare.own = / -> 5
    check("an image without the mesh reaches nothing", [bare.send(own), bare.refused], [false, {"no bridge of the house": 1}])
end

# a group's command, to every bridge that holds members of the group
# a gate that says which bridges are ready
class ReadyGate
    var ready
    def init(r) self.ready = r end
    def available(d) return true end
end
class GroupStore : FakeStore
    var groups
    def init() super(self).init() self.groups = {} end
    def group_bridges(zid) return self.groups.find(zid, []) end
end
def section_group()
    var cmd = FakeCmd()
    var st = GroupStore()
    var r = PanelRoute(st, cmd)
    r.own = / -> 5
    var g = 'ZbSend {"Group":4660,"Send":{"Power":1}}'
    check("the group of a line", [PanelRoute.group_of(g), PanelRoute.group_of("ZbInfo"), PanelRoute.group_of('ZbSend {"Group":x}')], [4660, nil, nil])
    check("a group nobody holds goes to the bridge of the house", [r.send(g), cmd.sent], [true, [[5, g]]])
    st.groups[4660] = [2, 7]
    cmd.sent.clear()
    check("held by two bridges: to each, over the mesh", [r.send(g), cmd.sent], [true, [[2, g], [7, g]]])
    var says = {2: true}
    r.gate = ReadyGate(says)
    cmd.sent.clear()
    check("a bridge the gate holds is not sent to, the other is", [r.send(g), cmd.sent, r.refused.find("bridge not ready", 0)], [true, [[2, g]], 1])
    says[2] = false
    check("none ready: the line did not leave", r.send(g), false)
end

section_device()
section_send()
section_own()
section_group()

# a line to one bridge by its number: a device's leave from the house, which the panel does not have, a search's window, an admin's word
do
    var cmd = FakeCmd()
    var r = PanelRoute(FakeStore(), cmd)
    r.own = / -> 2
    check("to a bridge of the house, over the mesh", [r.send_at(7, "ZbLeave 0x00124B0000F0F0F0"), cmd.sent], [true, [[7, "ZbLeave 0x00124B0000F0F0F0"]]])
    check("to the bridge of the house by its number, or by 0, its way", [r.send_at(2, "ZbPermitJoin 1"), r.send_at(0, "ZbPermitJoin 0"), cmd.sent[1], cmd.sent[2]],
          [true, true, [2, "ZbPermitJoin 1"], [2, "ZbPermitJoin 0"]])
    r.ready = / -> false
    check("the bridge of the house not in step: nothing", r.send_at(2, "ZbPermitJoin 1"), false)
end

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
