# berry/panel_gate.be: the buttons of a device of another room are not there while its bridge is not ready, against a mesh that is a
# list of neighbours the test writes and a store that says whose a device is: unavailable at once when the bridge is not heard, silent, or not in step; available only after two
# heartbeats in a row that say it is; no flicker on a suspect bridge; the panel's own devices never; the devices that stop being another room's lifted.

import json
import global

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if json.dump(got) != json.dump(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + json.dump(got))
        print("  want " + json.dump(want))
    end
end

var nbrs = []
global.espnow_mesh_neighbors = def () return nbrs end

var FAR = "0x00124B0000F30001"
var FAR2 = "0x00124B0000F30002"
var NEAR = "0x00124B0000F30003"

# a neighbour as the mesh lists it: its state (0 alive, 1 suspect, 2 mute), the time since its last heartbeat, and whether its heartbeat says it is in step
def nb(id, state, beat, synced)
    var b = bytes(-32)
    b[19] = synced ? 1 : 0
    return {"id": id, "state": state, "beat": beat, "info": b.tohex()}
end

def fixture()
    var store = PanelStore(nil)
    var z = store.create_zone("home", "Room", [0, 0], [3, 3])["value"]
    for id: [FAR, FAR2, NEAR]
        store.register_device([id, "Lamp " + id[-1 ..], "light", 3, 0, 0, "", 1, 0, 0])
        store.add_to_zone(z, id)
    end
    store.set_owner(FAR, 6)
    store.set_owner(FAR2, 7)
    var told = []
    var gate = PanelGate(store, def (id, off) told.push([id, off]) end)
    return [gate, told, store]
end

def section_hysteresis()
    var f = fixture()
    var gate = f[0]
    var told = f[1]
    nbrs.clear()
    gate.tick()
    check("a bridge that is not heard: its devices are gated, at the first look", [told, gate.available(FAR), gate.reason(FAR)], [[[FAR, true], [FAR2, true]], false, "Bridge not heard"])
    check("the panel's own device is never gated", [gate.available(NEAR), gate.reason(NEAR)], [true, nil])
    told.clear()
    gate.tick()
    check("and is not told again", told, [])
    # the bridge 6 comes: in step, a heartbeat
    nbrs.push(nb(6, 0, 700, true))
    nbrs.push(nb(7, 0, 700, false))
    gate.tick()
    check("the first heartbeat in step is not enough", [told, gate.available(FAR), gate.reason(FAR)], [[], false, "Bridge starting"])
    nbrs[0] = nb(6, 0, 3700, true)
    gate.tick()
    check("the same heartbeat, seen again, is not a second", gate.available(FAR), false)
    nbrs[0] = nb(6, 0, 400, true)
    gate.tick()
    check("the second, in a row, is: the bridge is available, and the panel lifts its devices", [gate.available(FAR), gate.reason(FAR), told], [true, nil, [[FAR, false]]])
    check("the other bridge, which says it is not in step, stays gated, with its reason", [gate.available(FAR2), gate.reason(FAR2)], [false, "Bridge syncing"])
    # a suspect bridge changes nothing: it is the mesh's doubt, not a no
    told.clear()
    nbrs[0] = nb(6, 1, 16000, true)
    gate.tick()
    check("a bridge the mesh suspects is still available", [gate.available(FAR), told], [true, []])
    # silent: at once
    nbrs[0] = nb(6, 2, 26000, true)
    gate.tick()
    check("a bridge that is silent is gated at once", [gate.available(FAR), gate.reason(FAR), told], [false, "Bridge off", [[FAR, true]]])
    # back: it needs two heartbeats again
    told.clear()
    nbrs[0] = nb(6, 0, 200, true)
    gate.tick()
    check("one heartbeat after being silent is not enough", [gate.available(FAR), told], [false, []])
    nbrs[0] = nb(6, 0, 4000, true)
    gate.tick()
    nbrs[0] = nb(6, 0, 300, true)
    gate.tick()
    check("two are", [gate.available(FAR), told], [true, [[FAR, false]]])
    # in step, then not: at once
    told.clear()
    nbrs[0] = nb(6, 0, 1000, false)
    gate.tick()
    check("a bridge that says it is not in step is gated at once", [gate.available(FAR), gate.reason(FAR), told], [false, "Bridge syncing", [[FAR, true]]])
    # the other bridge gets in step
    told.clear()
    nbrs[1] = nb(7, 0, 100, true)
    gate.tick()
    nbrs[1] = nb(7, 0, 2000, true)
    gate.tick()
    nbrs[1] = nb(7, 0, 50, true)
    gate.tick()
    check("each bridge by itself: the other, in step for two heartbeats, is available while the first is not", [gate.available(FAR2), gate.available(FAR), told], [true, false, [[FAR2, false]]])
    # no heartbeat has been heard yet (beat -1)
    var g2 = fixture()[0]
    nbrs.clear()
    nbrs.push(nb(6, 0, -1, true))
    g2.tick()
    g2.tick()
    check("a neighbour with no heartbeat counts none", g2.available(FAR), false)
end

def section_lifted()
    var f = fixture()
    var gate = f[0]
    var told = f[1]
    var store = f[2]
    nbrs.clear()
    gate.tick()
    told.clear()
    store.set_owner(FAR, 0)
    gate.tick()
    check("a device that is no longer another room's is lifted, and not gated again", [told, gate.available(FAR)], [[[FAR, false]], true])
    told.clear()
    store.set_owner(FAR2, 0)
    gate.tick()
    check("with none of a bridge's left the gate forgets it", [told, size(gate.ready), size(gate.why)], [[[FAR2, false]], 0, 0])
    check("and has no mesh to look at on an image without one", [gate.available(NEAR), PanelGate.in_step({"info": 3}), PanelGate.in_step({})], [true, false, false])
end

def section_plan()
    # the tap of a zone whose only device is gated does nothing, and one whose device is only in doubt is tried
    var store = PanelStore(nil)
    var z = store.create_zone("home", "Room", [0, 0], [3, 3])["value"]
    store.register_device([FAR, "Far", "light", 3, 0, 0, "", 1, 0, 0])
    store.add_to_zone(z, FAR)
    var live = {FAR: "off"}
    var doubt = {}
    check("a lamp that says off is turned on by a tap", PanelStore.toggle_intent(store.target_states([store.find_zone(z)], live, [true, true], doubt, nil)), "on")
    doubt[FAR] = true
    check("one in doubt, with no communication, is tried: the tap goes", PanelStore.toggle_intent(store.target_states([store.find_zone(z)], live, [true, true], doubt, nil)), "on")
    doubt[FAR] = "gated"
    check("one the gate holds is not: the tap has nothing to act on", PanelStore.toggle_intent(store.target_states([store.find_zone(z)], live, [true, true], doubt, nil)), nil)
end

# the own bridge: looked at as the others, its devices never held, and its readiness told when it changes
def section_own()
    var f = fixture()
    var gate = f[0]
    var told = f[1]
    var said = []
    var given = [0]
    gate.own = / -> given[0]
    gate.on_own = def (r) said.push(r) end
    nbrs.clear()
    gate.tick()
    check("with no number for it, the own bridge is not ready, said once", said, [false])
    given[0] = 9
    nbrs.push(nb(9, 0, 700, true))
    gate.tick()
    check("one heartbeat in step is not enough, and nothing more is said", said, [false])
    nbrs[0] = nb(9, 0, 300, true)
    gate.tick()
    check("the second is: it is ready, and said so", said, [false, true])
    gate.tick()
    check("and not said again", said, [false, true])
    check("the own bridge's look holds none of the panel's devices", gate.available(NEAR), true)
    nbrs[0] = nb(9, 2, 26000, true)
    gate.tick()
    check("silent: not ready, said at once", said, [false, true, false])
    given[0] = 0
    gate.tick()
    check("its number gone: forgotten, and nothing more said", [said, gate.ready.contains(9)], [[false, true, false], false])
end

section_hysteresis()
section_lifted()
section_plan()
section_own()

# the house forgets a bridge (house_mesh.be, sweep()): what the gate kept of it goes, and the marks of its devices
def section_sweep()
    var f = fixture()
    var gate = f[0]
    nbrs.clear()
    gate.tick()
    check("before: the gate keeps both bridges, and marks their devices", [gate.ready.contains(6), gate.ready.contains(7), gate.held.contains(FAR2)], [true, true, true])
    gate.sweep({6: true})
    check("the bridge 7 forgotten: nothing of it is kept, nor the mark of its device", [gate.ready.contains(7), gate.why.contains(7), gate.held.contains(FAR2), gate.ready.contains(6)],
          [false, false, false, true])
end
section_sweep()

# every bridge of the house is looked at, so that a search may open one with no device on this panel yet
do
    var store = PanelStore(nil)
    var g = PanelGate(store, nil)
    g.others = / -> [9]
    for i: 1 .. PanelGate.NEED + 1
        var n = nb(9, 0, 10 - i, true)
        global.espnow_mesh_neighbors = / -> [n]
        g.tick()
    end
    check("a bridge of the house with no device here is ready once in step", g.ready.find(9, false), true)
    g.others = / -> []
    g.tick()
    check("and forgotten once it is not one any more", g.ready.contains(9), false)
end

# the house layer, as far as the gate reads it: how the bridge 9 is heard, `by`
class GateHouse
    var by
    def heard_by(node) return node == 9 ? self.by : nil end
    def neighbors() return [] end
end

# a bridge two hops away: the house says how it is heard (house_mesh.be, heard_by), by the heartbeat of the neighbour that lists it, and the gate counts that
# one's heartbeats (else the devices of a bridge not heard directly would be held although its frames get there)
do
    var store = PanelStore(nil)
    var g = PanelGate(store, nil)
    g.others = / -> [9]
    var gh = GateHouse()
    global.house = gh
    global.espnow_mesh_neighbors = / -> []
    g.tick()
    check("not a neighbour, and no neighbour lists it: not heard", [g.ready.find(9, false), g.why.find(9)], [false, "Bridge not heard"])
    for i: 1 .. PanelGate.NEED + 1
        gh.by = nb(5, 0, 10 - i, true)
        g.tick()
    end
    check("heard by the neighbour 5, in step, for two of its heartbeats: ready", g.ready.find(9, false), true)
    gh.by = nb(5, 0, 20, false)
    g.tick()
    check("the neighbour not in step: not ready", [g.ready.find(9, false), g.why.find(9)], [false, "Bridge syncing"])
    global.house = nil
end

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
