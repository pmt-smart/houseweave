# berry/house_mesh.be, berry/house_key.be and berry/mesh_beat.be: the house's list and key on the mesh, against a mesh that is a fake: the frames
# the node sends and what it makes of the frames it is given. The two sides, in many nodes on the firmware's own core and cipher, are in libs/nspanel-sim/vm/test/house-mesh.test.mjs and
# house-key.test.mjs; this is what can be said without them: the heartbeat's bytes, what is answered to an ask and how fast, which frames of entries are taken and which are not, the
# frames the mesh did not take, the nodes given to the driver, the numbers of the key's versions, and the rules by which a key is taken.

import persist
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

# the mesh: what was sent (dest, type, ack, data, previous), what the driver was told of the heartbeat, who the neighbours are, and whether the mesh takes a frame
var sent = []
var infos = []
var nbrs = []
var takes = true
var routes = {}     # espnow_mesh_route: a node -> [the next hop, how]

def empty(l)
    while size(l) > 0 l.pop() end
end

def natives_on()
    import global as natives
    natives.mesh_beat_shared = nil
    natives.espnow_mesh_send = def (dest, kind, ack, data, prev)
        if !takes return false end
        sent.push([dest, kind, ack, data, prev])
        return size(sent)
    end
    natives.espnow_mesh_info = def (b) infos.push(b) return true end
    natives.espnow_mesh_neighbors = def () return nbrs end
    natives.espnow_mesh_route = def (n) return routes.find(n, [0, 0]) end
end

def string_hex(n)
    var h = bytes(-1)
    h[0] = n
    return h.tohex()[0 .. 1]
end
def key(n)
    var b = bytes(-32)
    b[0] = n
    b[1] = 255 - n
    return b
end
def mac(n)
    return bytes("a0b7650000" + string_hex(n))
end
def wipe(m)
    for k: m.keys() m.remove(k) end
end

# a node 4 that is a panel with a number, the house founded; `cmds` of the driver answered
def fresh(role, id)
    persist.zero()
    empty(sent)
    empty(infos)
    empty(nbrs)
    wipe(routes)
    takes = true
    empty(tasmota.cmds)
    wipe(tasmota.replies)
    wipe(tasmota.rule_lists)
    wipe(tasmota.rules)
    mesh_reset()
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": id}
    tasmota.replies["_EspNowMeshPublic"] = {"EspNowMeshPublic": {"Id": id, "Mac": "A0:B7:65:00:00:" + string_hex(id), "Public": key(id).tohex()}}
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 1, "PrevVersion": 0}}
    tasmota.replies["_EspNowMeshNode"] = {"EspNowMeshNode": []}
    natives_on()
    var hm = HouseMesh(role)
    hm.every_second()
    return hm
end

# a frame as the rule gets it
def frame(from, dest, data)
    return {"From": from, "Dest": dest, "Type": 6, "Flags": 0, "Data": data.tohex()}
end

def entries_frame(author, last, upto, es)
    var b = bytes()
    b.add(HouseMesh.MSG_ENTRIES, 1)
    b.add(HouseMesh.WIRE, 1)
    b.add(author, 1)
    b.add(last, 1)
    b.add(upto, -2)
    for e: es b .. e end
    return b
end

def section_start()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    check("the node has its number once the driver says it", hm.list.me, 4)
    check("and is attached: the rules are in", hm.up, true)
    var h2 = HouseMesh(HouseList.ROLE_PANEL)
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    # a panel that waits at its window for a house to take it founds none of its own (section_own)
    h2.hold = / -> true
    h2.every_second()
    check("a node with no number of its own waits", [h2.up, h2.list.me], [false, 0])
    check("nothing was said of the heartbeat before", size(infos) > 0, true)
end

def section_found()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    check("the first panel founds the house", hm.found("Cottage"), true)
    check("with itself in it", hm.list.ids(false), [4])
    check("and its name", hm.list.name(), "Cottage")
    check("a house that has nodes is not founded again", hm.found("Another"), false)
    var d = hm.list.digest()
    var b = MeshBeat.shared().buf
    check("the digest is in the bytes 25 to 27 of the heartbeat", [b[25], b[26], b[27]], [(d >> 16) & 255, (d >> 8) & 255, d & 255])
    check("and the two first bytes of the key in the bytes 23 and 24", [b[23], b[24]], [4, 251])
    check("the driver took it", infos[size(infos) - 1] == b, true)
    var n = size(infos)
    hm.publish()
    check("the same bytes are not given to the driver again", size(infos), n)
    # a panel adds a node: the next number never used, and for a bridge the alarm number
    check("a bridge is added", hm.add_node(HouseList.ROLE_BRIDGE, key(9), mac(9), bytes("c0a80009"), "Living room", nil), 1)
    check("with the first alarm number", hm.list.node(1)["slot"], 1)
    check("and the name and the address", [hm.list.node(1)["name"], hm.list.node(1)["ip"].tohex()], ["Living room", "C0A80009"])
    check("the next is given the next number", hm.add_node(HouseList.ROLE_BRIDGE, key(10), mac(10), nil, nil, nil), 2)
    check("and the alarm number after", hm.list.node(2)["slot"], 2)
    check("a number that is taken is refused", hm.add_node(HouseList.ROLE_BRIDGE, key(11), mac(11), nil, nil, 2), 0)
    check("a number that is asked for, free, is given", hm.add_node(HouseList.ROLE_PANEL, key(12), mac(12), nil, "Den panel", 7), 7)
    check("a panel has no alarm number", hm.list.node(7)["slot"], 0)
    check("the list was written to the flash", persist.find("house", nil) != nil, true)
    # the number of the panel's own bridge, by the address of its pairing
    check("a bridge's number by its address as the pairing keeps it", [hm.number_of("A0:B7:65:00:00:0A", HouseList.ROLE_BRIDGE), hm.number_of("A0:B7:65:00:00:09", HouseList.ROLE_BRIDGE)], [2, 1])
    check("a panel by its own address and role", hm.number_of("A0:B7:65:00:00:0C", HouseList.ROLE_PANEL), 7)
    check("a panel's address is no bridge's, and an address nobody has, none", [hm.number_of("A0:B7:65:00:00:0C", HouseList.ROLE_BRIDGE), hm.number_of("A0:B7:65:00:00:63", HouseList.ROLE_BRIDGE)], [0, 0])
    check("nor is what is not an address", [hm.number_of(nil, HouseList.ROLE_BRIDGE), hm.number_of("A0B765000009", HouseList.ROLE_BRIDGE)], [0, 0])
    hm.list.author(HouseList.K_REVOKE, 2, bytes())
    check("the answer follows the list: a bridge struck off is nobody's", hm.number_of("A0:B7:65:00:00:0A", HouseList.ROLE_BRIDGE), 0)
end

def section_answers()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    # node 9 holds nothing: it asks with an empty vector
    var ask = bytes()
    ask.add(HouseMesh.MSG_ASK, 1)
    ask.add(HouseMesh.WIRE, 1)
    empty(sent)
    hm.on_frame(frame(5, 4, ask))
    check("an ask with an empty vector is answered with the entries of this panel, whole", size(sent) >= 1 && sent[0][3][0] == HouseMesh.MSG_ENTRIES, true)
    check("to the one that asked, to it alone, of the mesh's membership type, with no answer asked", [sent[0][0], sent[0][1], sent[0][2]], [5, 6, false])
    var last = nil
    for s: sent if s[3][0] == HouseMesh.MSG_ENTRIES last = s[3] end end
    check("the last frame of entries says it is the last, and the seq the entries go up to", [last[3], last.get(4, -2)], [1, hm.list.mine])
    var vec = false
    for s: sent if s[3][0] == HouseMesh.MSG_VEC vec = true end end
    check("and the vector too: the asker's was not this node's", vec, true)
    # the same ask a second later: not answered again
    var n = size(sent)
    hm.on_frame(frame(5, 4, ask))
    check("an ask again within the gap is not answered", size(sent), n)
    tasmota.timers.advance(HouseMesh.ANSWER_GAP_MS + 10)
    hm.on_frame(frame(5, 4, ask))
    check("a second later it is", size(sent) > n, true)
    # an ask with this node's own vector: nothing to say
    tasmota.timers.advance(HouseMesh.ANSWER_GAP_MS + 10)
    empty(sent)
    var same = bytes()
    same.add(HouseMesh.MSG_ASK, 1)
    same.add(HouseMesh.WIRE, 1)
    same .. hm.list.vector()
    hm.on_frame(frame(5, 4, same))
    check("an ask by one that has what this node has is not answered", size(sent), 0)
    # frames that are not the house's, or not for this node, or the mesh's repeat of one
    hm.on_frame({"From": 5, "Dest": 4, "Type": 3, "Flags": 0, "Data": ask.tohex()})
    hm.on_frame({"From": 5, "Dest": 9, "Type": 6, "Flags": 0, "Data": ask.tohex()})
    hm.on_frame({"From": 5, "Dest": 4, "Type": 6, "Flags": 2, "Data": ask.tohex()})
    hm.on_frame(frame(5, 255, ask))
    hm.on_frame("a string")
    check("a frame of another type, for another node, a repeat, or for all is not answered", size(sent), 0)
    # a bridge does not write: it answers with the vector only
    var br = fresh(HouseList.ROLE_BRIDGE, 6)
    br.adopt(hm.list.to_map())
    empty(sent)
    tasmota.timers.advance(HouseMesh.ANSWER_GAP_MS + 10)
    br.on_frame(frame(5, 6, ask))
    check("a bridge has no entries of its own to give: the vector is all it says", [size(sent), size(sent) > 0 ? sent[0][3][0] : 0], [1, HouseMesh.MSG_VEC])
end

def section_take()
    var panel = fresh(HouseList.ROLE_PANEL, 4)
    panel.found("Cottage")
    panel.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    panel.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Garage", 6)
    var es = panel.list.entries_of(4, 0)
    # a bridge that holds the first state, and is told of the rest
    var br = fresh(HouseList.ROLE_BRIDGE, 6)
    br.list.apply(4, 1, 1, HouseList.K_IDENT, 4, bytes("02") + key(4) + mac(4))
    br.list.apply(4, 2, 2, HouseList.K_NAME, 0, bytes().fromstring("Cottage"))
    br.list.apply(4, 3, 3, HouseList.K_IDENT, 5, bytes("02") + key(5) + mac(5))
    br.list.take_upto(4, 3)
    var before = br.list.digest()
    # from a node that is not the author: not taken
    br.on_frame(frame(5, 6, entries_frame(4, 1, 6, es)))
    check("entries of the author 4 from the node 5 are not taken", br.list.digest(), before)
    # from the author, but with a seq above the one it says it goes up to: not taken
    br.on_frame(frame(4, 6, entries_frame(4, 1, 3, es)))
    check("entries above the seq the frame says they go up to are not taken", br.list.digest(), before)
    # from a bridge: not a panel
    br.on_frame(frame(7, 6, entries_frame(7, 1, 6, es)))
    check("entries from a node that is not a panel of the list are not taken", br.list.digest(), before)
    # from the author, not the last frame: the fields are taken, and the vector does not move
    br.on_frame(frame(4, 6, entries_frame(4, 0, 6, es)))
    check("a frame that is not the last gives the fields and does not move the vector", [br.list.v[4], br.list.node(6) != nil], [3, true])
    # and the last
    br.on_frame(frame(4, 6, entries_frame(4, 1, 6, es)))
    check("the last moves the vector up to the seq it says", br.list.v[4], panel.list.mine)
    check("and the list is the author's", br.list.digest(), panel.list.digest())
    # a short frame, and a cut one
    br.on_frame(frame(4, 6, bytes("2101")))
    br.on_frame(frame(4, 6, entries_frame(4, 1, 6, []) + bytes("0101")))
    check("a frame too short, or with a cut entry, changes nothing", br.list.digest(), panel.list.digest())
end

def section_out()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    empty(sent)
    takes = false
    var b = bytes("2201")
    check("a frame is kept when the mesh does not take it", [hm.send(7, b, nil), size(hm.out)], [true, 1])
    takes = true
    hm.every_100ms()
    check("and goes when it does", [size(hm.out), size(sent), sent[0][0]], [0, 1, 7])
    check("without the previous key's tag when this node holds none", sent[0][4], false)
    # refused too many times: let go
    takes = false
    hm.send(8, b, nil)
    for i: 1 .. HouseMesh.TRIES hm.every_100ms() end
    check("a frame the mesh will not take is let go after the tries", size(hm.out), 0)
    # the outbox has a ceiling
    empty(hm.out)
    for i: 1 .. HouseMesh.OUT_MAX hm.out.push([9, b, 0, false]) end
    check("the outbox is not past its ceiling", [size(hm.out), hm.send(9, b, nil)], [HouseMesh.OUT_MAX, false])
    takes = true
    empty(hm.out)
    # the tag: with a previous key held, a node that does not say it has the key in use is sent the previous key's
    hm.key.holds = true
    hm.key.version = 2
    hm.peer_ver[5] = 2
    hm.peer_ver[6] = 1
    hm.send(5, b, nil)
    hm.send(6, b, nil)
    hm.send(7, b, nil)
    hm.send(8, b, false)
    check("tags: the node at the key in use gets it, the one at another, and one not known, get the previous; false says so", [sent[size(sent) - 4][4], sent[size(sent) - 3][4], sent[size(sent) - 2][4], sent[size(sent) - 1][4]], [false, true, true, false])
end

def section_driver()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_BRIDGE, key(9), mac(9), bytes("c0a80009"), "Living room", 1)
    hm.add_node(HouseList.ROLE_BRIDGE, key(10), mac(10), nil, nil, 2)
    hm.add_node(HouseList.ROLE_BRIDGE, key(11), mac(11), nil, nil, 3)
    hm.add_node(HouseList.ROLE_BRIDGE, key(12), mac(12), nil, nil, 5)
    hm.add_node(HouseList.ROLE_BRIDGE, key(13), mac(13), nil, nil, 6)
    empty(tasmota.cmds)
    hm.every_second()
    var lines = []
    for c: tasmota.cmds if size(c) > 15 && c[0 .. 14] == "EspNowMeshNode " lines.push(c) end end
    check("the driver is given a few nodes to a turn", size(lines), HouseMesh.PUSH_PER_TURN)
    check("in the words of EspNowMeshNode, with the address when there is one", lines[0], "EspNowMeshNode 1,A0:B7:65:00:00:" + string_hex(9) + "," + key(9).tohex() + ",192.168.0.9")
    check("and without it when there is not", lines[1], "EspNowMeshNode 2,A0:B7:65:00:00:" + string_hex(10) + "," + key(10).tohex())
    hm.every_second()
    hm.every_second()
    var all = 0
    for c: tasmota.cmds if size(c) > 15 && c[0 .. 14] == "EspNowMeshNode " all += 1 end end
    check("the others in the next turns, none twice", all, 5)
    # struck off: taken out
    hm.revoke(2)
    empty(tasmota.cmds)
    hm.every_second()
    var out = []
    for c: tasmota.cmds if size(c) > 15 && c[0 .. 14] == "EspNowMeshNode " out.push(c) end end
    check("a node struck off is taken out of the driver", out, ["EspNowMeshNode 2,0"])
    # a start: what the driver has already is not given again
    var again = fresh(HouseList.ROLE_PANEL, 4)
    again.list.from_map(hm.list.to_map())
    again.driver_seen = false
    again.pushed = {}
    tasmota.replies["_EspNowMeshNode"] = {"EspNowMeshNode": [{"Id": 1, "Mac": "A0:B7:65:00:00:" + string_hex(9), "Ip": "192.168.0.9"}, {"Id": 3, "Mac": "A0:B7:65:00:00:" + string_hex(11), "Ip": "0.0.0.0"}]}
    empty(tasmota.cmds)
    again.push_due = true
    again.list.me = 4
    again.every_second()
    var given = []
    for c: tasmota.cmds if size(c) > 15 && c[0 .. 14] == "EspNowMeshNode " given.push(c) end end
    check("a node the driver has with the same address is not given again, and one struck off that it does not have is not taken out", [size(given), given[0][0 .. 16]], [2, "EspNowMeshNode 5,"])
end

def section_poll()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    var mine = hm.list.digest()
    var info = bytes(-32)
    info[0] = 1
    info[25] = (mine >> 16) & 255
    info[26] = (mine >> 8) & 255
    info[27] = mine & 255
    tasmota.timers.advance(10000)
    nbrs.push({"id": 5, "state": 0, "info": info.tohex(), "beat": 100, "key": 1})
    empty(sent)
    hm.poll()
    check("a neighbour with the same digest is not asked", size(sent), 0)
    info[27] = (mine + 1) & 255
    nbrs[0]["info"] = info.tohex()
    hm.poll()
    check("one with another is asked, with the vector", [size(sent), sent[0][0], sent[0][3][0], sent[0][3][2 ..] == hm.list.vector()], [1, 5, HouseMesh.MSG_ASK, true])
    hm.poll()
    check("and not again within the gap", size(sent), 1)
    tasmota.timers.advance(HouseMesh.ASK_GAP_MS + 10)
    nbrs[0]["beat"] = 100
    hm.poll()
    check("after it, again", size(sent), 2)
    # one with a digest of nothing: it asks this node
    info[25] = 0
    info[26] = 0
    info[27] = 0
    nbrs[0]["info"] = info.tohex()
    tasmota.timers.advance(HouseMesh.ASK_GAP_MS + 10)
    hm.poll()
    check("a neighbour that holds nothing is not asked", size(sent), 2)
    # silent, or older than this node's last change
    info[27] = 7
    nbrs[0]["info"] = info.tohex()
    nbrs[0]["state"] = 2
    hm.poll()
    check("a silent neighbour is not asked", size(sent), 2)
    nbrs[0]["state"] = 0
    nbrs[0]["beat"] = 1000000
    hm.poll()
    check("one whose heartbeat is from before this node's last change says nothing of what it holds now", size(sent), 2)
    check("and the version of the key the neighbour says is kept", hm.peer_ver[5], 1)
end

def section_key_rules()
    check("the number after 1 is 2, after 255 it is 1", [HouseKey.next_of(1), HouseKey.next_of(255)], [2, 1])
    check("a version above is newer", [HouseKey.newer(2, 1), HouseKey.newer(3, 1), HouseKey.newer(128, 1)], [true, true, true])
    check("the same is not, nor one below", [HouseKey.newer(1, 1), HouseKey.newer(1, 2), HouseKey.newer(1, 100)], [false, false, false])
    check("the numbers go round: 1 is above 255", [HouseKey.newer(1, 255), HouseKey.newer(3, 254)], [true, true])
    check("a number that is not one is not", [HouseKey.newer(0, 1), HouseKey.newer(256, 1)], [false, false])
    check("more than half the numbers away is below", HouseKey.newer(129, 1), false)

    var hm = fresh(HouseList.ROLE_BRIDGE, 6)
    hm.list.apply(4, 1, 1, HouseList.K_IDENT, 4, bytes("02") + key(4) + mac(4))
    hm.list.apply(4, 2, 2, HouseList.K_IDENT, 7, bytes("01") + key(7) + mac(7))
    hm.list.take_upto(4, 2)
    var k = bytes()
    k.add(HouseKey.MSG_KEY, 1)
    k.add(HouseKey.WIRE, 1)
    k.add(2, 1)
    k .. key(77)
    # from a bridge: no
    empty(tasmota.cmds)
    empty(sent)
    hm.on_frame(frame(7, 6, k))
    check("a key from a bridge is not taken", [hm.key.version, size(sent)], [1, 0])
    var gave = 0
    for c: tasmota.cmds if size(c) > 18 && c[0 .. 17] == "EspNowMeshGroupKey" gave += 1 end end
    check("nor given to the driver", gave, 0)
    tasmota.replies["EspNowMeshGroupKey " + key(77).tohex() + ",2,1"] = {"EspNowMeshGroupKey": {"Set": 1, "Version": 2, "Previous": 1}}
    # from a panel, of the right version, of the right size: taken, given to the driver (with the flag that lets it over a change not closed), and said
    hm.on_frame(frame(4, 6, k))
    check("a key from a panel, above, is taken", [hm.key.version, hm.key.holds], [2, true])
    var cmd = tasmota.cmds[size(tasmota.cmds) - 1]
    check("and given to the driver with the version, over a change that is not closed", cmd, "EspNowMeshGroupKey " + key(77).tohex() + ",2,1")
    check("and said to the panel: an ack, of the version, not closed, with the tag of the key it has", [size(sent), sent[0][0], sent[0][3].tohex(), sent[0][4]], [1, 4, "24010200", false])
    # the same again: told again, not given again
    empty(sent)
    var n = size(tasmota.cmds)
    hm.on_frame(frame(4, 6, k))
    check("the key it already has is not given to the driver again, and it is told it has it", [size(tasmota.cmds), size(sent), sent[0][3].tohex()], [n, 1, "24010200"])
    # an old one: not taken
    var old = bytes()
    old.add(HouseKey.MSG_KEY, 1)
    old.add(HouseKey.WIRE, 1)
    old.add(1, 1)
    old .. key(88)
    empty(sent)
    hm.on_frame(frame(4, 6, old))
    check("a key of a version below the one in use is not taken", [hm.key.version, size(sent)], [2, 0])
    # a key of the wrong size
    var odd = k.copy()
    odd .. bytes("00")
    hm.on_frame(frame(4, 6, odd))
    check("a frame of the wrong size is not taken", hm.key.version, 2)
    # a close: from a bridge, no; from a panel, for the version it has, yes
    var c = bytes()
    c.add(HouseKey.MSG_CLOSE, 1)
    c.add(HouseKey.WIRE, 1)
    c.add(2, 1)
    empty(tasmota.cmds)
    hm.on_frame(frame(7, 6, c))
    check("a close from a bridge is not heard", [hm.key.holds, size(tasmota.cmds)], [true, 0])
    var wrong = bytes()
    wrong.add(HouseKey.MSG_CLOSE, 1)
    wrong.add(HouseKey.WIRE, 1)
    wrong.add(3, 1)
    hm.on_frame(frame(4, 6, wrong))
    check("nor one for another version", hm.key.holds, true)
    empty(sent)
    hm.on_frame(frame(4, 6, c))
    check("one from a panel, for the version in use, closes: the driver is told and the panel hears it closed", [hm.key.holds, tasmota.cmds[0], sent[0][3].tohex()], [false, "EspNowMeshKeyClose", "24010201"])
end

def section_rotate()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    hm.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, nil, 6)
    check("a node that is not in the house cannot be struck off", hm.revoke(9), false)
    check("a bridge cannot change the key", fresh(HouseList.ROLE_BRIDGE, 6).key.rotate(), false)
    hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    hm.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, nil, 6)
    # the driver answers the command by its line, whose key is drawn: the stub gives no answer, so the driver took no key and the change is not made
    check("when the driver takes no key the change is not made", [hm.key.rotate(), hm.key.pend], [false, nil])
    check("and nothing is kept of it", persist.find("house_key", nil), nil)
    check("the node was struck off in the list all the same", [hm.revoke(6), hm.list.revoked(6)], [true, true])
end

# the commands that changed something in the driver, in order (the reads, which begin with an underscore, left out)
def driver_writes()
    var out = []
    for c: tasmota.cmds
        if size(c) > 0 && c[0] != "_" out.push(c) end
    end
    return out
end

# what a panel gives a node that comes into the house, and what the node does with it
def section_welcome()
    check("a bridge gives none", fresh(HouseList.ROLE_BRIDGE, 6).welcome(5), nil)
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, "Den panel", 5)
    hm.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), bytes("c0a80006"), "Living room", 6)
    check("a panel that does not hold the key in use has no welcome to give", hm.welcome(5), nil)
    hm.key.keep_cur(1, key(77).tohex())
    check("the key it keeps is the version and the key it was given", [hm.key.cur()[0], hm.key.cur()[1].tohex()], [1, key(77).tohex()])
    check("a node that is not in the list is given none", hm.welcome(9), nil)
    var w = hm.welcome(6)
    var w5 = hm.welcome(5)
    var digest = hm.list.digest()
    var ids = hm.list.ids(false)
    check("a node of the list is given a welcome, in pieces", isinstance(w, list) && size(w) >= 2, true)
    var whole = 0
    var okay = true
    for i: 0 .. size(w) - 1
        whole += size(w[i]) - 2
        okay = okay && w[i][0] == i && w[i][1] == size(w) && size(w[i]) <= HouseMesh.PIECE + 2
    end
    check("each piece says its place and how many there are, and fits a frame of the pairing", okay, true)
    check("the pieces make the welcome: the wire, the number, the key's version, the key, the vector, the fields and the sum", [w[0][2], w[0][3], w[0][4], w[0][5 .. 36].tohex()], [HouseMesh.WELCOME_WIRE, 6, 1, key(77).tohex()])
    # the same welcome, twice: the same pieces (it says nothing of the time)
    check("the same welcome is made again as it was", hm.welcome(6)[0] == w[0], true)

    # the node that comes in: no key, no number, nothing in its list
    var nw = fresh(HouseList.ROLE_BRIDGE, 0)
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 0, "PrevVersion": 0}}
    tasmota.replies["EspNowMeshGroupKey " + key(77).tohex() + ",1,1"] = {"EspNowMeshGroupKey": {"Set": 1, "Version": 1, "Previous": 0}}
    check("a piece missing is not a welcome", nw.accept(w[1 .. ]), false)
    var bad = []
    for p: w bad.push(p.copy()) end
    bad[size(bad) - 1][size(bad[size(bad) - 1]) - 1] ^= 1
    check("a piece changed is not a welcome: the sum says what was made", nw.accept(bad), false)
    var other = []
    for p: w other.push(p.copy()) end
    other[0][1] = size(w) + 1
    check("pieces that say another count are not a welcome", nw.accept(other), false)
    check("nothing is not", [nw.accept([]), nw.accept(nil), nw.accept(["x"])], [false, false, false])
    check("nothing was changed by the ones that were refused: no number, no key, no list", [nw.list.me, nw.up, size(nw.list.ids(true)), size(driver_writes())], [0, false, 0, 0])
    var scrambled = []
    for i: 0 .. size(w) - 1 scrambled.push(w[size(w) - 1 - i]) end
    scrambled.push(w[0])
    empty(tasmota.cmds)
    check("the whole welcome, in any order, one piece twice, is taken", nw.accept(scrambled), true)
    check("the driver was given the number, the key with its version, and the mesh was turned on, in that order", driver_writes(), ["EspNowMeshId 6", "EspNowMeshGroupKey " + key(77).tohex() + ",1,1", "EspNowMeshEnable 1"])
    check("the node has the number, and the rules are in", [nw.list.me, nw.up], [6, true])
    check("and the list of the panel: the same nodes and the same digest", [nw.list.ids(false), nw.list.digest(), nw.list.name()], [ids, digest, "Cottage"])
    check("with the alarm number the bridge was given", nw.list.node(6)["slot"], 1)
    check("a bridge keeps no key of its own to give", nw.key.cur(), nil)
    # a node that is in a house is given no other
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 1, "PrevVersion": 0}}
    empty(tasmota.cmds)
    check("a node that has a key is given no other welcome", nw.accept(w), false)
    check("and the driver was told nothing", size(driver_writes()), 0)
    # a panel that is welcomed keeps the key for the nodes it will bring in
    var pw = fresh(HouseList.ROLE_PANEL, 0)
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 0, "PrevVersion": 0}}
    tasmota.replies["EspNowMeshGroupKey " + key(77).tohex() + ",1,1"] = {"EspNowMeshGroupKey": {"Set": 1, "Version": 1, "Previous": 0}}
    check("a panel takes a welcome too", pw.accept(w5), true)
    check("and keeps the key and the version for the nodes it will bring in", [pw.key.cur()[0], pw.key.cur()[1].tohex(), pw.writes()], [1, key(77).tohex(), true])
    # a node struck off is given none (the flash was made new above: the panel keeps its key again)
    hm.key.keep_cur(1, key(77).tohex())
    check("the panel has a welcome for the node again", hm.welcome(5) != nil, true)
    hm.list.author(HouseList.K_REVOKE, 5, bytes())
    check("a node that was struck off is given none", hm.welcome(5), nil)
end

# the state of the devices of other rooms: the marks a panel puts, the floods of the bridge that owns them, and what a panel does when it lost some
var lamp1 = "0x00124B0000AA0001"
var lamp2 = "0x00124B0000AA0002"

# a heartbeat of a node, as the mesh lists it: 32 bytes, the number of the state's last frame in 20 and 21
def beat_of(id, seq)
    var b = bytes(-32)
    b[0] = 1
    b[20] = seq & 255
    b[21] = (seq >> 8) & 255
    return {"id": id, "info": b.tohex(), "state": 0, "key": 1}
end

def state_frame(from, seq, body, kind)
    var b = bytes()
    b.add(HouseState.MSG_STATE, 1)
    b.add(HouseState.WIRE, 1)
    b.add(seq, 2)
    b .. bytes().fromstring(body)
    return {"From": from, "Dest": kind == 3 ? 255 : 4, "Type": kind, "Flags": 0, "Data": b.tohex()}
end

# a node of the house of the panel 4, with the panel 5 and the bridges 6 and 7: the list as the first panel wrote it
def a_house(role, me)
    var first = fresh(HouseList.ROLE_PANEL, 4)
    first.found("Cottage")
    first.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    first.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, nil, 6)
    first.add_node(HouseList.ROLE_BRIDGE, key(7), mac(7), nil, nil, 7)
    if me == 4 return first end
    var hm = fresh(role, me)
    hm.adopt(first.list.to_map())
    return hm
end

def section_state_panel()
    var hm = a_house(HouseList.ROLE_PANEL, 4)
    var wanted = {6: [lamp1, lamp2]}
    var got = []
    hm.state.wanted = / -> wanted
    hm.state.deliver = / r -> got.push(r)
    empty(sent)
    empty(nbrs)
    hm.state.tick()
    check("before the bridge 6 is heard nothing is said to it, and no try is counted (the bench, 2026-10-18)", [size(sent), hm.state.sent.contains(6)], [0, false])
    nbrs.push({"id": 6, "state": 0})
    hm.state.tick()
    check("a panel that shows two devices of the bridge 6 marks them: one frame to that bridge alone, of the house's type", [size(sent), sent[0][0], sent[0][1], sent[0][2]], [1, 6, 6, false])
    var m = sent[0][3]
    check("MARK, wire 1, the first and the last of the set, two IEEEs of 8 bytes", [m[0], m[1], m[2], m[3], size(m), m[4 .. 11].tohex(), m[12 .. 19].tohex()], [HouseState.MSG_MARK, 1, 3, 2, 20, "00124B0000AA0001", "00124B0000AA0002"])
    # not answered: said again, every 5 s, six times at most
    empty(sent)
    tasmota.timers.advance(4000)
    hm.state.tick()
    check("the mark is not said again before the retry time", size(sent), 0)
    tasmota.timers.advance(1500)
    hm.state.tick()
    check("and is, when the bridge has not answered", size(sent), 1)
    for i: 1 .. 6
        tasmota.timers.advance(5100)
        hm.state.tick()
    end
    check("six times at most", hm.state.sent[6][2], HouseState.MARK_TRIES)
    # the owner's answer: a frame of state, which says it was heard
    empty(sent)
    hm.on_frame(state_frame(6, 1, "{}", 6))
    check("a frame of state from the bridge says the mark was heard", hm.state.sent[6][3], true)
    tasmota.timers.advance(5100)
    hm.state.tick()
    check("and it is not said again until MARK_MS", size(sent), 0)
    wanted = {6: [lamp1]}
    hm.state.tick()
    check("a set that changed is said at once", [size(sent), sent[0][3][3]], [1, 1])
    # the state: the report of a device of ours, of the bridge it is of, comes through; another's does not
    empty(got)
    hm.on_frame(state_frame(6, 2, '{"' + lamp1 + '":{"Power":1},"' + lamp2 + '":{"Power":0}}', 3))
    check("a flood of the bridge 6 hands the panel what it shows of it, and not the rest", got, [{lamp1: {"Power": 1}}])
    hm.on_frame(state_frame(7, 3, '{"' + lamp1 + '":{"Power":0}}', 3))
    check("the same device, said by another bridge, is not taken", size(got), 1)
    hm.on_frame(state_frame(5, 3, '{"' + lamp1 + '":{"Power":0}}', 3))
    check("nor is one said by a panel", size(got), 1)
    hm.on_frame(state_frame(6, 4, '{"' + lamp1 + '/2":{"Power":1,"Endpoint":2}}', 3))
    check("a channel of the device is the device's", got[1], {lamp1 + "/2": {"Power": 1, "Endpoint": 2}})
    hm.on_frame(state_frame(6, 5, "not json", 3))
    hm.on_frame(state_frame(6, 6, "[1]", 3))
    var short = state_frame(6, 7, "{}", 3)
    short["Data"] = "3001"
    hm.on_frame(short)
    check("what is not a report is let go", size(got), 2)
    check("the number heard is the last frame's", hm.state.seen[6], 6)
    # the loss: the bridge's heartbeat says a number that was not heard
    empty(nbrs)
    nbrs.push(beat_of(6, 6))
    empty(sent)
    hm.state.tick()
    check("a heartbeat with the number heard asks nothing", size(sent), 0)
    empty(nbrs)
    nbrs.push(beat_of(6, 5))
    hm.state.tick()
    tasmota.timers.advance(HouseState.BEHIND_MS + 500)
    hm.state.tick()
    check("one with a number behind the one heard, not caught up with the flood yet, asks nothing either", [size(sent), hm.state.behind.contains(6)], [0, false])
    empty(nbrs)
    nbrs.push(beat_of(6, 6))
    nbrs[0] = beat_of(6, 9)
    hm.state.tick()
    check("one with another number is waited for: the frame may be on its way", size(sent), 0)
    tasmota.timers.advance(3000)
    hm.state.tick()
    check("for BEHIND_MS", size(sent), 0)
    tasmota.timers.advance(3500)
    hm.state.tick()
    check("then the panel asks, to the bridge alone, with the last number it heard", [size(sent), sent[0][0], sent[0][3].tohex()], [1, 6, "31010600"])
    tasmota.timers.advance(2000)
    empty(sent)
    hm.state.tick()
    check("no oftener than ASK_GAP_MS", size(sent), 0)
    tasmota.timers.advance(9000)
    hm.state.tick()
    check("and again when the gap has gone and it is still behind", size(sent), 1)
    # a panel that never heard the bridge asks as soon as it hears the heartbeat
    var new_hm = a_house(HouseList.ROLE_PANEL, 4)
    new_hm.state.wanted = / -> {6: [lamp1]}
    new_hm.state.deliver = / r -> nil
    empty(nbrs)
    nbrs.push(beat_of(6, 3))
    empty(sent)
    new_hm.state.tick()
    var asked = 0
    for s: sent if s[3][0] == HouseState.MSG_ASK asked += 1 end end
    check("a panel that has heard nothing of the bridge asks at once", asked, 1)
    # no longer shown: the bridge is told so, once
    wanted = {}
    empty(sent)
    hm.state.tick()
    check("a panel that shows nothing of a bridge any more clears its marks there, once", [size(sent), sent[0][3][2], sent[0][3][3]], [1, 3, 0])
    empty(sent)
    hm.state.tick()
    check("and says nothing after", size(sent), 0)
    # a frame of state from a node that is not a bridge of the house, or struck off
    wanted = {6: [lamp1], 5: [lamp1]}
    empty(got)
    hm.on_frame(state_frame(5, 1, '{"' + lamp1 + '":{"Power":1}}', 3))
    check("a panel is no owner of a device", size(got), 0)
    hm.list.author(HouseList.K_REVOKE, 6, bytes())
    hm.on_frame(state_frame(6, 8, '{"' + lamp1 + '":{"Power":1}}', 3))
    check("nor is a bridge that was struck off", size(got), 0)
end

def section_state_bridge()
    var br = a_house(HouseList.ROLE_BRIDGE, 6)
    var primed = []
    var table = {"0x5A00": lamp1, "0x5A01": lamp2}
    br.state.resolve = / k -> table.find(k)
    br.state.prime = / i -> primed.push(i)
    var mark = def (src, flags, ieees)
        var b = bytes()
        b.add(HouseState.MSG_MARK, 1)
        b.add(HouseState.WIRE, 1)
        b.add(flags, 1)
        b.add(size(ieees), 1)
        for i: ieees b .. bytes(i[2 ..]) end
        return {"From": src, "Dest": 6, "Type": 6, "Flags": 0, "Data": b.tohex()}
    end
    empty(sent)
    br.state.flood({"0x5A00": {"Power": 1}})
    check("with no mark nothing of the reports is said", size(sent), 0)
    br.on_frame(mark(5, 3, [lamp1]))
    check("a mark from a panel is kept, and the device is read: it has said nothing", [br.state.marks[5]["s"].contains(lamp1), primed], [true, [lamp1]])
    check("and answered with a frame of state, to the panel alone, with nothing in it: it was heard", [size(sent), sent[0][0], sent[0][1], sent[0][3][0], sent[0][3][4 ..].asstring()], [1, 5, 6, HouseState.MSG_STATE, "{}"])
    empty(sent)
    br.on_frame(mark(7, 3, [lamp2]))
    check("a mark from a bridge is not taken", [br.state.marks.contains(7), size(sent)], [false, 0])
    # a room marked whole is read PRIME_STEP devices at once, and as many again each second
    var room = []
    for i: 1 .. 6 room.push("0x00124B0000CC000" + str(i)) end
    primed.clear()
    br.on_frame(mark(4, 3, room))
    check("six devices marked: four are read at once", primed, room[0 .. 3])
    br.state.cache[room[5]] = {"Power": 1}
    br.state.tick()
    check("and the rest at the next second, but one that spoke since", primed, room[0 .. 4])
    br.state.tick()
    check("and nothing more", size(primed), 5)
    br.state.marks.remove(4)
    br.state.cache.remove(room[5])
    # a device that cannot be read yet (the bridge's Zigbee starting) keeps its place, and is read at the next second
    var up = [false]
    br.state.prime = def (i) if !up[0] return false end primed.push(i) end
    primed.clear()
    br.on_frame(mark(4, 3, ["0x00124B0000DD0001"]))
    check("the bridge's Zigbee not started: nothing read, the device kept to be read", [size(primed), size(br.state.priming)], [0, 1])
    up[0] = true
    br.state.tick()
    check("started: read at the next second", primed, ["0x00124B0000DD0001"])
    br.state.marks.remove(4)
    br.state.prime = / i -> primed.push(i)
    # a report of the marked device is said to everyone, once, as its IEEE says it; one of a device nobody marks is not
    empty(sent)
    br.state.flood({"0x5A00": {"Power": 1, "Device": "0x5A00"}, "0x5A01": {"Power": 1}})
    check("a report of a marked device is flooded: to everyone, of the application's type, one frame", [size(sent), sent[0][0], sent[0][1], sent[0][2]], [1, 255, 3, false])
    check("with the number 1, and the IEEE's report, without the short address", [sent[0][3][0], sent[0][3].get(2, 2), sent[0][3][4 ..].asstring()], [HouseState.MSG_STATE, 1, '{"' + lamp1 + '":{"Power":1}}'])
    var b = MeshBeat.shared().buf
    check("the number is in the bytes 20 and 21 of the heartbeat", [b[20], b[21]], [1, 0])
    br.state.flood({"0x5A00": {"Power": 0}})
    check("the next report is the next number", [MeshBeat.shared().buf[20], br.state.seq], [2, 2])
    # a channel of a device of several keeps its endpoint
    empty(sent)
    br.state.flood({"0x5A00/2": {"Power": 1, "Device": "0x5A00", "Endpoint": 2}})
    check("a channel is said by the device's IEEE and its endpoint", sent[0][3][4 ..].asstring(), '{"' + lamp1 + '/2":{"Endpoint":2,"Power":1}}')
    # what the panel did not hear, it asks, and the bridge says the state it has of its devices
    empty(sent)
    tasmota.timers.advance(2100)
    var ask = bytes()
    ask.add(HouseState.MSG_ASK, 1)
    ask.add(HouseState.WIRE, 1)
    ask.add(0, 2)
    br.on_frame({"From": 5, "Dest": 6, "Type": 6, "Flags": 0, "Data": ask.tohex()})
    check("an ask is answered with the state of the panel's devices, to it alone", [size(sent), sent[0][0], sent[0][3][0]], [1, 5, HouseState.MSG_STATE])
    var said = json.load(sent[0][3][4 ..].asstring())
    check("merged as they were said", [said[lamp1], said[lamp1 + "/2"]], [{"Power": 0}, {"Endpoint": 2, "Power": 1}])
    empty(sent)
    br.on_frame({"From": 5, "Dest": 6, "Type": 6, "Flags": 0, "Data": ask.tohex()})
    check("no oftener than ANSWER_GAP_MS", size(sent), 0)
    br.on_frame({"From": 4, "Dest": 6, "Type": 6, "Flags": 0, "Data": ask.tohex()})
    check("a panel that has no mark is answered nothing", size(sent), 0)
    # the marks are kept in the flash, and not for ever
    br.state.keep()
    check("the marks are in the flash, by the panel", persist.find(HouseState.KEEP, nil), {"5": [lamp1]})
    var again = HouseMesh(HouseList.ROLE_BRIDGE)
    again.state.load()
    check("and a bridge that starts has them, as told now", [again.state.marks.contains(5), again.state.marks[5]["s"].contains(lamp1)], [true, true])
    tasmota.timers.advance(HouseState.MARK_TTL_MS + 1000)
    br.state.tick()
    check("a mark not told again for the TTL goes, and what was kept of its devices with it", [size(br.state.marks), size(br.state.cache)], [0, 0])
    br.state.tick()
    br.state.keep()
    check("and the flash forgets it", persist.find(HouseState.KEEP, nil), nil)
    # more IEEEs than a frame holds
    var many = []
    for i: 0 .. 19 many.push("0x00124B0000BB00" + (i < 10 ? "0" : "") + str(i)) end
    var hm = a_house(HouseList.ROLE_PANEL, 4)
    hm.state.wanted = / -> {6: many}
    hm.state.deliver = / r -> nil
    nbrs.push({"id": 6, "state": 0})
    empty(sent)
    hm.state.tick()
    check("twenty devices are two frames: the first begins the set, the last ends it", [size(sent), sent[0][3][2], sent[0][3][3], sent[1][3][2], sent[1][3][3]], [2, 1, 16, 2, 4])
end

# the devices of a bridge, for a panel of another room to pick from
def list_frame(src, dest, first)
    var b = bytes()
    b.add(HouseDevices.MSG_LIST, 1)
    b.add(HouseDevices.WIRE, 1)
    b.add(first, 1)
    return {"From": src, "Dest": dest, "Type": 6, "Flags": 0, "Data": b.tohex()}
end

def item_frame(src, index, total, body)
    var b = bytes()
    b.add(HouseDevices.MSG_ITEM, 1)
    b.add(HouseDevices.WIRE, 1)
    b.add(index, 1)
    b.add(total, 1)
    b .. bytes().fromstring(body)
    return {"From": src, "Dest": 4, "Type": 6, "Flags": 0, "Data": b.tohex()}
end

def section_devices_bridge()
    var br = a_house(HouseList.ROLE_BRIDGE, 6)
    var z2t = []
    var names = {"0x00124B0000AA0003": "Living room"}
    br.devices.ask_info = / -> z2t.push(1)
    br.devices.name_of = / i -> names.find(i)
    empty(sent)
    br.on_frame(list_frame(4, 6, 0))
    check("a bridge that has said nothing of its devices asks Z2T for the map, and answers nothing yet", [size(z2t), size(sent)], [1, 0])
    br.on_frame(list_frame(5, 6, 0))
    check("a second ask in the same moment does not ask Z2T again", size(z2t), 1)
    # the map comes, device by device
    for i: 1 .. 7
        br.devices.heard({"IEEEAddr": "0x00124B0000AA000" + str(i), "ModelId": "M" + str(i), "Config": ["L01." + str(i % 6)]})
    end
    tasmota.timers.advance(HouseDevices.SETTLE_MS + 200)
    br.devices.tick()
    var mine = []
    var other = 0
    for s: sent
        if s[0] == 4 mine.push(s) elif s[0] == 5 other += 1 end
    end
    check("when the map has had its time, both panels are answered: five items, to each of them", [size(sent), size(mine), other], [10, 5, 5])
    var first = json.load(mine[0][3][4 ..].asstring())
    check("an item says the IEEE, the model, the Config and the name the panels gave it", first, {"i": "0x00124B0000AA0001", "m": "M1", "c": ["L01.1"], "n": ""})
    check("with the place and how many there are", [mine[0][3][0], mine[0][3][2], mine[0][3][3]], [HouseDevices.MSG_ITEM, 0, 7])
    check("the devices in order of their IEEE, the name where the panels gave one", [json.load(mine[2][3][4 ..].asstring())["n"], mine[4][3][2]], ["Living room", 4])
    # the next page, from the fresh map
    empty(sent)
    br.on_frame(list_frame(4, 6, 5))
    check("the next page is the two that are left, now: the map is fresh", [size(sent), sent[0][3][2], sent[1][3][2]], [2, 5, 6])
    empty(sent)
    br.on_frame(list_frame(4, 6, 7))
    check("one past the end is the end: a frame with no device", [size(sent), sent[0][3][2], sent[0][3][3]], [1, HouseDevices.END, 7])
    # who may ask
    empty(sent)
    br.on_frame(list_frame(7, 6, 0))
    check("a bridge's ask is not answered: the list is for panels", size(sent), 0)
    # a map that is old is asked for again
    tasmota.timers.advance(HouseDevices.FRESH_MS + 1000)
    br.on_frame(list_frame(4, 6, 0))
    check("a map older than FRESH_MS is asked of Z2T again", [size(z2t), size(sent)], [2, 0])
end

def section_devices_panel()
    var hm = a_house(HouseList.ROLE_PANEL, 4)
    var told = []
    hm.devices.on_page = / -> told.push(1)
    check("with nothing asked there is no page", hm.devices.current(), nil)
    empty(sent)
    hm.devices.ask(6, 0)
    check("a panel asks a bridge for a page: one frame, to it alone, from the place", [size(sent), sent[0][0], sent[0][3].tohex()], [1, 6, "330100"])
    var body = def (n) return '{"i":"0x00124B0000AA000' + str(n) + '","m":"M' + str(n) + '","c":["L01.5"],"n":"Dev' + str(n) + '"}' end
    hm.on_frame(item_frame(6, 0, 7, body(1)))
    hm.on_frame(item_frame(6, 1, 7, body(2)))
    check("the items come one a frame, and the view is told at each", [size(told), hm.devices.whole()], [2, false])
    hm.on_frame(item_frame(7, 2, 7, body(3)))
    check("an item from another bridge is not the page's", [size(told), size(hm.devices.current()[0])], [2, 2])
    hm.on_frame(item_frame(5, 2, 7, body(3)))
    check("nor one from a panel", size(told), 2)
    hm.on_frame(item_frame(6, 2, 7, "not json"))
    check("what is not a device is let go, though the page's total is known", [hm.devices.current()[2], size(hm.devices.current()[0])], [7, 2])
    for n: 3 .. 5 hm.on_frame(item_frame(6, n - 1, 7, body(n))) end
    var cur = hm.devices.current()
    check("the page, whole: the five devices in their places, the place of the first and the total", [size(cur[0]), cur[0][0], cur[0][4][1], cur[1], cur[2], hm.devices.whole()], [5, ["0x00124B0000AA0001", "M1", ["L01.5"], "Dev1"], "M5", 0, 7, true])
    # a page that did not come is asked for again, three times at most
    hm.devices.ask(6, 5)
    empty(sent)
    tasmota.timers.advance(HouseDevices.RETRY_MS + 100)
    hm.devices.tick()
    check("a page that has not come is asked again after RETRY_MS", [size(sent), sent[0][3].tohex()], [1, "330105"])
    tasmota.timers.advance(HouseDevices.RETRY_MS + 100)
    hm.devices.tick()
    tasmota.timers.advance(HouseDevices.RETRY_MS + 100)
    hm.devices.tick()
    check("three tries at most: the ask, and two more", size(sent), 2)
    # the end of the list: no device, and the total
    hm.devices.ask(6, 7)
    hm.on_frame(item_frame(6, HouseDevices.END, 7, "{}"))
    check("a page past the end has no device, and says how many there are", [size(hm.devices.current()[0]), hm.devices.current()[2], hm.devices.whole()], [0, 7, true])
end

# the house by the console
def say(name, payload)
    empty(tasmota.said)
    empty(tasmota.answers)
    tasmota.handlers[name](name, 0, payload)
    return [size(tasmota.said) > 0 ? tasmota.said[0] : nil, size(tasmota.answers) > 0 ? tasmota.answers[0] : nil]
end

def section_commands()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    var hc = HouseCommands(hm)
    check("a panel founds the house by the console, with the name it is given", [say("HouseFound", "Sample House"), hm.list.name()], [['{"HouseFound":"Done"}', nil], "Sample House"])
    check("a house that is founded is not founded again", say("HouseFound", "Another"), [nil, "failed"])
    var pub = key(9).tohex()
    var mac = "A0:B7:65:00:00:09"
    check("a bridge is written into the list: its role, the number it is to have, the public key and the address as the driver says them, and its name", [say("HouseAdd", "bridge,0," + pub + "," + mac + ",Living room"), hm.list.node(1)["name"], hm.list.node(1)["role"]], [['{"HouseAdd":{"Id":1}}', nil], "Living room", HouseList.ROLE_BRIDGE])
    check("the address with no colons is the same", say("HouseAdd", "panel,7," + pub + ",A0B765000010,Den panel")[0], '{"HouseAdd":{"Id":7}}')
    check("a number that is taken is refused", say("HouseAdd", "bridge,7," + pub + "," + mac), [nil, "failed"])
    check("and what is not a node: a role, a key, an address", [say("HouseAdd", "radio,0," + pub + "," + mac)[1], say("HouseAdd", "bridge,0,00ff," + mac)[1], say("HouseAdd", "bridge,0," + pub + ",A0B7")[1], say("HouseAdd", "bridge")[1]], ["failed", "failed", "failed", "failed"])
    # the welcome, a piece at a time: it carries the key, and the window of the bench is shut until a person opens it
    hm.key.keep_cur(1, key(77).tohex())
    check("the window is shut: the welcome is not given", say("HouseWelcome", "1"), [nil, "failed"])
    check("a person opens it", say("HouseBench", ""), ['{"HouseBench":"Open"}', nil])
    check("and shuts it", [say("HouseBench", "0")[0], say("HouseWelcome", "1")[1]], ['{"HouseBench":"Closed"}', "failed"])
    say("HouseBench", "1")
    var first = json.load(say("HouseWelcome", "1")[0])["HouseWelcome"]
    check("a welcome is asked a piece at a time, from the first: it says its place and how many there are", [first["Id"], first["Index"], first["Of"] >= 2, size(first["Piece"]) > 100], [1, 0, true, true])
    var pieces = []
    for i: 0 .. first["Of"] - 1 pieces.push(json.load(say("HouseWelcome", "1," + str(i))[0])["HouseWelcome"]["Piece"]) end
    check("a piece past the last, and a node that is not in the list, have none", [say("HouseWelcome", "1,9")[1], say("HouseWelcome", "30")[1]], ["failed", "failed"])
    # the node that is given it
    var nw = fresh(HouseList.ROLE_BRIDGE, 0)
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 0, "PrevVersion": 0}}
    tasmota.replies["EspNowMeshGroupKey " + key(77).tohex() + ",1,1"] = {"EspNowMeshGroupKey": {"Set": 1, "Version": 1, "Previous": 0}}
    var nc = HouseCommands(nw)
    check("the node that is given it has the window shut too: what it is given carries the key", say("HouseAccept", pieces[0]), [nil, "failed"])
    nc.until = tasmota.millis(600000)
    var ans = []
    for i: 0 .. size(pieces) - 1
        ans.push(say("HouseAccept", pieces[size(pieces) - 1 - i])[0])
    end
    tasmota.timers.advance(HouseCommands.BENCH_MS + 1000)
    check("and the window shuts by itself, ten minutes after", say("HouseWelcome", "1"), [nil, "failed"])
    check("the pieces, in the opposite order: it says how many it has until the last, which it takes", [ans[0], ans[size(ans) - 1], nw.list.me, nw.list.name()], ['{"HouseAccept":{"Have":1,"Of":' + str(size(pieces)) + '}}', '{"HouseAccept":"Done"}', 1, "Sample House"])
    check("what is not a piece is refused", [say("HouseAccept", "")[1], say("HouseAccept", "00")[1]], ["failed", "failed"])
    # the status
    var st = json.load(say("HouseStatus", "")[0])["HouseStatus"]
    check("the status says the node, the name, the key and the nodes", [st["Me"], st["Name"], st["Key"], size(st["Nodes"]), st["Nodes"][0]["Role"], st["Nodes"][0]["Name"]], [1, "Sample House", 0, 3, "Bridge", "Living room"])
    # a bridge writes nothing
    var br = fresh(HouseList.ROLE_BRIDGE, 6)
    var bc = HouseCommands(br)
    check("a bridge founds nothing and writes nothing", [say("HouseFound", "Cottage")[1], say("HouseAdd", "bridge,0," + pub + "," + mac)[1]], ["failed", "failed"])
end

# a node comes into the house over the link of the pairing: the welcome in the events of the link, a piece at a time, and what a bridge does to bring a panel in
def last_of(l) return l[size(l) - 1] end

def link_pair(hm, said, ended)
    hm.link.bind(def (msg) said.push(msg) return true end, def (ok, why) ended.push([ok, why]) end)
end

def count_of(l, kind)
    var n = 0
    for m: l
        if m["ZbPair"] == kind n += 1 end
    end
    return n
end

# a panel of the house that writes, with the key it keeps, and a bridge it gives a welcome to over the link: the events the link carried, in order
def given_to_a_bridge(carried)
    var p = fresh(HouseList.ROLE_PANEL, 4)
    p.found("Cottage")
    p.key.keep_cur(1, key(77).tohex())
    var said = []
    var ended = []
    link_pair(p, said, ended)
    tasmota.at_ms = 1000
    check("a panel that writes gives the bridge at the other end of the link", p.link.give(HouseList.ROLE_BRIDGE, "Garage of the farmhouse", "192.168.0.61"), true)
    check("it asks who the bridge is, and is busy", [said, p.link.step, p.link.busy()], [[{"ZbPair": "houseAsk"}], "asking", true])
    check("it is not given another while it is busy", p.link.give(HouseList.ROLE_BRIDGE, "Another", "192.168.0.62"), false)
    tasmota.at_ms = 3100
    p.link.tick()
    check("it asks again after the gap", count_of(said, "houseAsk"), 2)
    p.link.event("houseId", {"pub": "00ff", "mac": "01"})
    check("an answer that is not an identity ends it: nothing was written", [ended, size(p.list.ids(true))], [[[false, "refused"]], 1])
    # the bridge says who it is
    empty(ended)
    p.link.event("houseId", {"pub": key(9).tohex(), "mac": mac(9).tohex()})
    check("a panel that is not busy does not take an identity nobody asked for", size(p.list.ids(true)), 1)
    check("and is given again", p.link.give(HouseList.ROLE_BRIDGE, "Garage of the farmhouse", "192.168.0.61"), true)
    p.link.event("houseId", {"pub": key(9).tohex(), "mac": mac(9).tohex()})
    var id = p.list.find_key(key(9))
    var n = p.list.node(id)
    check("the bridge is written into the list: the number, the role, the name (cut to what the list holds), the address and the alarm number", [id, n["role"], n["name"], n["ip"] == bytes("c0a8003d"), n["slot"]], [1, HouseList.ROLE_BRIDGE, "Garage of the farmho", true, 1])
    check("the first piece goes, and fits an event of the pairing's link", [p.link.step, last_of(said)["ZbPair"], size(last_of(said)["d"]) <= 180], ["giving", "housePiece", true])
    var total = size(p.link.out)
    check("the welcome is in pieces of the link's size", [total >= 2, size(p.link.out[0]) <= HouseLink.PIECE + 2], [true, true])
    for i: 0 .. total - 1
        var m = last_of(said)
        check("the piece " + str(i) + " is the one the link is on, until it is answered", m["d"] == p.link.out[i].tohex(), true)
        carried.push(m["d"])
        # an answer to another piece moves nothing
        if i == 0 p.link.event("houseAck", {"i": 5}) check("an ack of another piece is not one", count_of(said, "housePiece"), 1) end
        p.link.event("houseAck", {"i": i})
    end
    check("every piece was carried once", [size(carried), count_of(said, "housePiece")], [total, total])
    tasmota.at_ms += 1600
    p.link.tick()
    check("the last piece goes again while the word that it was taken has not come", [count_of(said, "housePiece"), last_of(said)["d"] == carried[total - 1]], [total + 1, true])
    p.link.event("houseDone", {})
    check("and the bridge's word ends it", [ended, p.link.step, p.link.busy()], [[[true, ""]], "done", false])
    return p
end

def section_link()
    # what a node says of itself in its hello
    var t = fresh(HouseList.ROLE_BRIDGE, 0)
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 0, "PrevVersion": 0}}
    var free = t.link.flag()
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 2, "PrevVersion": 0}}
    var in_house = t.link.flag()
    tasmota.replies["_EspNowMeshStatus"] = {}
    check("a node with no key says 1, one in a house 2, and one with no mesh driver 0", [free, in_house, t.link.flag()], [1, 2, 0])
    check("an address is the 4 bytes of the list, or nothing", [HouseLink.ip_bytes("192.168.0.61") == bytes("c0a8003d"), HouseLink.ip_bytes("192.168.0"), HouseLink.ip_bytes(""), HouseLink.ip_bytes("1.2.3.400")], [true, nil, nil, nil])

    # a panel of the house gives a bridge the welcome
    var carried = []
    var p = given_to_a_bridge(carried)

    # the same bridge again is the same number: nothing more is written; and a bridge that was struck off is forgotten, and comes back as a new node
    var said = []
    var ended = []
    link_pair(p, said, ended)
    p.link.give(HouseList.ROLE_BRIDGE, "Garage", "192.168.0.61")
    p.link.event("houseId", {"pub": key(9).tohex(), "mac": mac(9).tohex()})
    check("the same key is the same node: no second entry, the welcome goes again", [p.list.ids(false), last_of(said)["ZbPair"]], [[1, 4], "housePiece"])
    p.link.finish(false, "x")
    p.list.author(HouseList.K_REVOKE, 1, bytes())
    empty(said)
    empty(ended)
    p.link.give(HouseList.ROLE_BRIDGE, "Garage", "192.168.0.61")
    p.link.event("houseId", {"pub": key(9).tohex(), "mac": mac(9).tohex()})
    check("a node struck off is forgotten: its key comes back as a new node, under another number, and is welcomed",
          [ended, count_of(said, "housePiece") > 0, p.list.find_key(key(9)), p.list.revoked(1)], [[], true, 2, true])

    # the bridge that does not answer: every piece is tried TRIES times, and it ends silent
    var q = fresh(HouseList.ROLE_PANEL, 4)
    q.found("Cottage")
    q.key.keep_cur(1, key(77).tohex())
    var qsaid = []
    var qended = []
    link_pair(q, qsaid, qended)
    tasmota.at_ms = 100000
    q.link.give(HouseList.ROLE_BRIDGE, "Living room", "192.168.0.62")
    q.link.event("houseId", {"pub": key(10).tohex(), "mac": mac(10).tohex()})
    for i: 1 .. HouseLink.TRIES + 1
        tasmota.at_ms += HouseLink.RESEND_MS + 10
        q.link.tick()
    end
    check("a piece nobody answers is tried TRIES times and the welcome ends silent", [count_of(qsaid, "housePiece"), qended], [HouseLink.TRIES, [[false, "silent"]]])
    # a bridge that never says who it is
    empty(qsaid)
    empty(qended)
    tasmota.at_ms = 200000
    q.link.give(HouseList.ROLE_BRIDGE, "Living room", "192.168.0.62")
    for i: 1 .. HouseLink.ASK_TRIES + 1
        tasmota.at_ms += HouseLink.ASK_MS + 10
        q.link.tick()
    end
    check("a bridge that does not say who it is is asked ASK_TRIES times, and the pairing goes on without the house", [count_of(qsaid, "houseAsk"), qended], [HouseLink.ASK_TRIES, [[false, "silent"]]])
    # a panel that does not write gives nothing: one that is in no house, waiting at its window (it founds none of its own meanwhile, section_own)
    persist.zero()
    var nw = HouseMesh(HouseList.ROLE_PANEL)
    nw.hold = / -> true
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    nw.every_second()
    link_pair(nw, [], [])
    check("a node that is not in a house gives none", nw.link.give(HouseList.ROLE_BRIDGE, "Living room", "192.168.0.62"), false)

    # the node that is given the welcome
    var nb = fresh(HouseList.ROLE_BRIDGE, 0)
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 0, "PrevVersion": 0}}
    tasmota.replies["EspNowMeshGroupKey " + key(77).tohex() + ",1,1"] = {"EspNowMeshGroupKey": {"Set": 1, "Version": 1, "Previous": 0}}
    var tsaid = []
    var tended = []
    link_pair(nb, tsaid, tended)
    nb.link.event("houseAsk", {})
    check("a node with no key says who it is: its public key and its address, as the driver says them", [tsaid[0]["ZbPair"], tsaid[0]["pub"] == key(0).tohex(), size(tsaid[0]["mac"])], ["houseId", true, 12])
    check("it holds a place for the welcome, and the glass says it is taking it", [nb.link.step, nb.link.busy()], ["taking", true])
    var pieces = []
    for d: carried pieces.push(d) end
    var order = []
    for i: 0 .. size(pieces) - 1 order.push(pieces[size(pieces) - 1 - i]) end
    var acks = []
    for d: order
        empty(tsaid)
        nb.link.event("housePiece", {"d": d})
        acks.push(tsaid[0]["ZbPair"] + str(tsaid[0].find("i", "")))
    end
    check("each piece is answered with its place, in any order, and the last with the word that it was taken", [acks[0], size(acks), last_of(tsaid)["ZbPair"]], ["houseAck" + str(size(pieces) - 1), size(pieces), "houseDone"])
    check("the node has the number, the key and the list it was given", [nb.list.me, nb.list.name(), nb.list.ids(false), tended], [1, "Cottage", [1, 4], [[true, ""]]])
    empty(tsaid)
    nb.link.event("housePiece", {"d": pieces[0]})
    check("a piece that comes again after it was taken is answered with the same word", [size(tsaid), tsaid[0]["ZbPair"]], [1, "houseDone"])
    # a welcome that is not whole is refused and nothing changes; and one that is asked for again starts from nothing
    var nr = fresh(HouseList.ROLE_BRIDGE, 0)
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 0, "PrevVersion": 0}}
    var rsaid = []
    var rended = []
    link_pair(nr, rsaid, rended)
    nr.link.event("houseAsk", {})
    var damaged = pieces[size(pieces) - 1]
    damaged = damaged[0 .. size(damaged) - 3] + (damaged[size(damaged) - 2 .. ] == "00" ? "01" : "00")
    for i: 0 .. size(pieces) - 2 nr.link.event("housePiece", {"d": pieces[i]}) end
    nr.link.event("housePiece", {"d": damaged})
    check("a welcome that was changed is refused, the node is as it was", [last_of(rsaid), rended, nr.list.me, nr.up], [{"ZbPair": "houseNo", "why": "refused"}, [[false, "refused"]], 0, false])
    tasmota.replies["EspNowMeshGroupKey " + key(77).tohex() + ",1,1"] = {"EspNowMeshGroupKey": {"Set": 1, "Version": 1, "Previous": 0}}
    nr.link.event("houseAsk", {})
    for d: pieces nr.link.event("housePiece", {"d": d}) end
    check("asked again, it starts from nothing and takes the right one", [last_of(rsaid), nr.list.me], [{"ZbPair": "houseDone"}, 1])
    # who is not asked
    var ni = fresh(HouseList.ROLE_BRIDGE, 3)
    tasmota.replies["_EspNowMeshStatus"] = {"EspNowMeshStatus": {"GroupVersion": 4, "PrevVersion": 0}}
    var isaid = []
    link_pair(ni, isaid, [])
    ni.link.event("houseAsk", {})
    tasmota.replies["_EspNowMeshStatus"] = {}
    ni.link.event("houseAsk", {})
    check("a node that is in a house, and one that has no mesh driver, say why they cannot", [isaid[0], isaid[1]], [{"ZbPair": "houseNo", "why": "in"}, {"ZbPair": "houseNo", "why": "none"}])
    var nobind = fresh(HouseList.ROLE_BRIDGE, 0)
    nobind.link.event("houseAsk", {})
    check("with no link bound it says nothing and is not bound", [nobind.link.bound(), nobind.link.step], [false, nil])
    tasmota.at_ms = nil
end

# leaving the house: the node itself, the word to leave, a node that finds itself struck off, a panel that removes another, and a panel that leaves with its
# bridge or without it
def leave_word()
    var b = bytes()
    b.add(HouseMesh.MSG_LEAVE, 1)
    b.add(HouseMesh.WIRE, 1)
    return b
end

# the frames to `dest` whose first byte is `msg`
def frames_to(dest, msg)
    var out = []
    for s: sent
        if s[0] == dest && size(s[3]) > 0 && s[3][0] == msg out.push(s[3]) end
    end
    return out
end

# the last of a list, or nil
def last_of(l) return size(l) > 0 ? l[-1] : nil end

# the rules of a trigger that are left
def rules_of(trigger)
    var l = tasmota.rule_lists.find(trigger)
    return l == nil ? 0 : size(l)
end

# a bridge 6 that holds the house of the panel 4: it was given the panel's entries, as the mesh gives them
def bridge_of_house()
    var p = fresh(HouseList.ROLE_PANEL, 4)
    p.found("Cottage")
    p.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    empty(sent)
    p.send_entries(6, 0)
    var frames = []
    for s: sent frames.push(s[3]) end
    var br = fresh(HouseList.ROLE_BRIDGE, 6)
    # the panel's identity first, as a welcome gives it (section_take), then the rest by the frames
    br.list.apply(4, 1, 1, HouseList.K_IDENT, 4, bytes("02") + key(4) + mac(4))
    br.list.take_upto(4, 1)
    for d: frames br.on_frame(frame(4, 6, d)) end
    return [p, br]
end

# the events of a bridge to its panel over the mesh, beside their link
def section_events()
    var two = bridge_of_house()
    var p = two[0]
    var br = two[1]
    empty(sent)
    var ev = '{"ZbPing":{"Device":"0x5A00","IEEEAddr":"0x00124B0000AA0001"}}'
    check("an event to a panel by its number: a frame of the house, to it", [br.event_node(4, ev), size(sent), sent[0][0], sent[0][1]], [true, 1, 4, HouseMesh.T_MEMBER])
    check("with the event as text after its head", [sent[0][3][0], sent[0][3][1], sent[0][3][2 ..].asstring()], [HouseMesh.MSG_EVENT, HouseMesh.WIRE, ev])
    check("no number, nothing sent", [br.event_node(0, ev), size(sent)], [false, 1])
    var room = br.node_room(4)
    check("what a frame to it carries, past the head", room > 100, true)
    var long = "x"
    while size(long) <= room long += "x" end
    check("an event that does not fit is not sent", [br.event_node(4, long), size(sent)], [false, 1])
    check("nor has no number any room", br.node_room(0), 0)
    # the panel takes it, with the node that said it
    var got = []
    p.events = def (src, m) got.push([src, m]) end
    p.on_frame(frame(6, 4, sent[0][3]))
    check("the panel is handed the event as its text, and who said it", got, [[6, ev]])
    var bad = bytes()
    bad.add(HouseMesh.MSG_EVENT, 1)
    bad.add(HouseMesh.WIRE, 1)
    bad .. bytes().fromstring("not json")
    p.on_frame(frame(6, 4, bad))
    check("what is not an event is let go", size(got), 1)
    p.events = nil
    p.on_frame(frame(6, 4, sent[0][3]))
    check("and with nobody to take them, nothing is", size(got), 1)
end

# whether a node is in step on the mesh now, by its heartbeats
def section_in_step()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    var beat = def (id, state, synced)
        var b = bytes(-32)
        b[19] = synced ? 1 : 0
        return {"id": id, "state": state, "beat": 300, "info": b.tohex()}
    end
    empty(nbrs)
    check("a node not heard is not", hm.in_step(6), false)
    nbrs.push(beat(6, 0, true))
    check("heard, alive, and its heartbeat says it is synced: it is", hm.in_step(6), true)
    nbrs[0] = beat(6, 1, true)
    check("the mesh's suspicion changes nothing", hm.in_step(6), true)
    nbrs[0] = beat(6, 0, false)
    check("not synced: it is not", hm.in_step(6), false)
    nbrs[0] = beat(6, 2, true)
    check("silent: it is not", hm.in_step(6), false)
    check("nor is the number 0", hm.in_step(0), false)
    empty(nbrs)
end

# a node two hops away is heard by the neighbour whose heartbeat lists it, as espnow_mesh_route says; the way back, as old as the node's last frame, is not
# taken for it
def section_two_hops()
    var hm = a_house(HouseList.ROLE_PANEL, 4)
    var beat = def (id, state, synced)
        var b = bytes(-32)
        b[19] = synced ? 1 : 0
        return {"id": id, "state": state, "beat": 300, "info": b.tohex()}
    end
    empty(nbrs)
    nbrs.push(beat(7, 0, true))
    check("the bridge 6, not a neighbour, no way known: not heard", [hm.hears(6), hm.in_step(6), hm.heard_by(6)], [false, false, nil])
    routes[6] = [7, 3]
    check("by the way back alone: not heard", hm.hears(6), false)
    routes[6] = [7, 2]
    check("listed by the heartbeat of the neighbour 7: heard by 7, and in step as 7 is", [hm.hears(6), hm.heard_by(6)["id"], hm.in_step(6)], [true, 7, true])
    nbrs[0] = beat(7, 0, false)
    check("7 not in step: nor is 6, as seen from here", hm.in_step(6), false)
    nbrs[0] = beat(7, 2, true)
    check("7 silent: 6 is not heard", hm.hears(6), false)
    nbrs[0] = beat(7, 0, true)
    nbrs.push(beat(6, 2, true))
    check("6 a neighbour gone silent, and listed by 7: heard by 7", [hm.hears(6), hm.heard_by(6)["id"]], [true, 7])
    routes[6] = [0, 0]
    check("and with no way, its own silent entry", [hm.hears(6), hm.heard_by(6)["state"]], [false, 2])
    # the marks wait for the mesh to be up here, and not for the owner: one three hops away is heard by no heartbeat, and the mark reaches it by the flood
    hm.state.wanted = / -> {6: [lamp1]}
    hm.state.deliver = / r -> nil
    empty(nbrs)
    wipe(routes)
    empty(sent)
    hm.state.tick()
    check("no node of the house heard: no mark", size(sent), 0)
    nbrs.push(beat(7, 0, true))
    hm.state.tick()
    check("a node of the house heard and the owner not, no way known: the mark goes to 6 all the same (the adversarial review of 2026-10-18)", [size(sent), sent[0][0]], [1, 6])
    wipe(routes)
    empty(nbrs)
end

# the loss of a flood of an owner two hops away, whose heartbeat is not heard here: a number skipped says it
def section_two_hops_loss()
    var hm = a_house(HouseList.ROLE_PANEL, 4)
    hm.state.wanted = / -> {6: [lamp1]}
    hm.state.deliver = / r -> nil
    var b = bytes(-32)
    b[19] = 1
    empty(nbrs)
    nbrs.push({"id": 7, "state": 0, "beat": 300, "info": b.tohex()})
    routes[6] = [7, 2]
    var asks = def ()
        var n = 0
        for x: sent
            if x[0] == 6 && x[1] == 6 && x[3][0] == HouseState.MSG_ASK  n += 1 end
        end
        return n
    end
    var on = '{"' + lamp1 + '":{"Power":1}}'
    hm.state.tick()
    hm.on_frame(state_frame(6, 1, "{}", 6))
    hm.on_frame(state_frame(6, 2, on, 3))
    hm.on_frame(state_frame(6, 3, on, 3))
    empty(sent)
    hm.state.tick()
    check("floods in a row from an owner two hops away: nothing asked", asks(), 0)
    hm.on_frame(state_frame(6, 5, on, 3))
    hm.state.tick()
    check("a number skipped: the panel asks the owner", [asks(), sent[-1][3].get(2, 2)], [1, 5])
    empty(sent)
    tasmota.timers.advance(HouseState.ASK_GAP_MS + 100)
    hm.state.tick()
    check("once", asks(), 0)
    hm.on_frame(state_frame(6, 9, "{}", 6))
    tasmota.timers.advance(HouseState.ASK_GAP_MS + 100)
    hm.state.tick()
    check("an answer that jumps carries the state whole: nothing asked", asks(), 0)
    hm.on_frame(state_frame(6, 8, on, 3))
    hm.on_frame(state_frame(6, 9, on, 3))
    tasmota.timers.advance(HouseState.ASK_GAP_MS + 100)
    hm.state.tick()
    check("an older number, and the next after it, are no loss", asks(), 0)
    wipe(routes)
    empty(nbrs)
end

# the presence: every node of a house of more than one floods its heartbeat's bytes every period, and a node that hears no
# heartbeat of it knows it by that, fresh for 2.5 periods; a neighbour whose heartbeats stopped, which the probes keep alive, is not heard
def section_presence()
    import global as natives
    var br = a_house(HouseList.ROLE_BRIDGE, 6)
    natives.espnow_mesh_clock = def () return {"synced": true} end
    var heres = def ()
        var l = []
        for x: sent
            if x[0] == 255 && x[1] == HouseState.T_FLOOD && x[3][0] == HouseMesh.MSG_HERE  l.push(x[3]) end
        end
        return l
    end
    empty(sent)
    for i: 1 .. 11
        tasmota.timers.advance(1000)
        br.every_second()
    end
    var h = heres()
    check("a bridge says its presence within its period, once", size(h), 1)
    check("with its period and its heartbeat's 32 bytes, the bit synced on, and how it is tied: none heard on the radio, and on the Wi-Fi with no signal said",
          [h[0][1], h[0][2], size(h[0]) - 3, h[0][3 + 19] & 1, h[0][35 ..]], [HouseMesh.WIRE, HouseMesh.HERE_BRIDGE_S, 35, 1, bytes("000001")])
    nbrs.push({"id": 4, "state": 0, "beat": 300, "rssi": -71, "info": bytes(-32).tohex()})
    nbrs.push({"id": 5, "state": 0, "beat": 300, "rssi": -58, "info": bytes(-32).tohex()})
    nbrs.push({"id": 7, "state": 2, "beat": 300, "rssi": -40, "info": bytes(-32).tohex()})
    nbrs.push({"id": 8, "state": 0, "beat": 40000, "rssi": -45, "info": bytes(-32).tohex()})
    natives.espnow_mesh_health = def () return {"neighbors": 1, "weak": 1} end
    tasmota.wifi_rssi = -67
    check("how it is tied: the nodes the core hears on the radio, the best signal of the ones not silent and with fresh heartbeats, and its Wi-Fi's signal",
          br.tie(), [2, -58, -67])
    tasmota.wifi_rssi = nil
    natives.espnow_mesh_health = def () return {"neighbors": 0, "weak": 0} end
    check("none heard on the radio: no signal of any, though the network brings some", br.tie()[0 .. 1], [0, 0])
    tasmota.up = false
    check("off the Wi-Fi: 0", br.tie()[2], 0)
    tasmota.up = nil
    natives.espnow_mesh_health = def () return nil end
    empty(nbrs)
    empty(sent)
    for i: 1 .. 10
        tasmota.timers.advance(1000)
        br.every_second()
    end
    check("and again after its period", size(heres()), 1)
    natives.espnow_mesh_clock = def () return nil end
    # the panel 4 hears the bridge 6's presence and no heartbeat of it
    var hm = a_house(HouseList.ROLE_PANEL, 4)
    var info = bytes(-32)
    info[0] = 1
    info[19] = 1
    info[20] = 9
    var here = def (from, period, b)
        var d = bytes()
        d.add(HouseMesh.MSG_HERE, 1)
        d.add(HouseMesh.WIRE, 1)
        d.add(period, 1)
        d .. b
        return {"From": from, "Dest": 255, "Type": HouseState.T_FLOOD, "Flags": 0, "Data": d.tohex()}
    end
    empty(nbrs)
    nbrs.push({"id": 7, "state": 0, "beat": 300, "info": bytes(-32).tohex()})
    check("never heard: not heard", [hm.hears(6), hm.heard_by(6)], [false, nil])
    hm.on_frame(here(6, 10, info))
    var x = hm.heard_by(6)
    check("its presence: heard, by itself, far, in step as it says, and its sequence", [hm.hears(6), x["id"], x["far"], hm.in_step(6), hm.state.beat_seq(6, nil)], [true, 6, true, true, 9])
    check("a presence of an older image, without how it is tied: none said", hm.tie_of(6), nil)
    var tied = info.copy()
    tied.add(3, 1)
    tied.add(-62 & 0xFF, 1)
    tied.add(-70 & 0xFF, 1)
    hm.on_frame(here(6, 10, tied))
    check("with it: the nodes it hears, its best signal and its Wi-Fi's, and its heartbeat's bytes as they were", [hm.tie_of(6), hm.in_step(6), hm.state.beat_seq(6, nil), size(hm.far[6][2])], [[3, -62, -70], true, 9, 32])
    hm.on_frame(here(6, 10, info))
    hm.on_frame(here(9, 10, info))
    hm.on_frame(here(4, 10, info))
    check("a presence of a node out of the house, or of this one, is not kept", [hm.far.contains(9), hm.far.contains(4)], [false, false])
    check("every node it knows of: the neighbour and the far one", size(hm.heard_all(nil)), 2)
    hm.on_frame(here(6, 10, tied))
    tasmota.timers.advance(24000)
    check("fresh for 2.5 of its periods, and how it is tied with it", [hm.hears(6), hm.tie_of(6)], [true, [3, -62, -70]])
    tasmota.timers.advance(2000)
    check("then not said", hm.tie_of(6), nil)
    check("then silent: not heard, no sequence, and silent among all it knows of", [hm.hears(6), hm.heard_by(6)["state"], hm.state.beat_seq(6, nil), hm.heard_all(nil)[1]["state"]], [false, 2, nil, 2])
    # a neighbour whose heartbeats stopped, kept alive by the probes through the others: its presence, fresh, is what is heard of it
    hm.on_frame(here(6, 10, info))
    empty(nbrs)
    var old = bytes(-32)
    old[20] = 3
    nbrs.push({"id": 6, "state": 0, "beat": 40000, "info": old.tohex()})
    check("a neighbour with no fresh heartbeat: its presence, and the sequence it says", [hm.heard_by(6)["far"], hm.state.beat_seq(6, nil)], [true, 9])
    hm.far.remove(6)
    check("with no presence: its own entry, alive, but no sequence from an old heartbeat", [hm.hears(6), hm.state.beat_seq(6, nil)], [true, nil])
    # a node struck off: its presence goes, and none is taken
    hm.on_frame(here(6, 10, info))
    hm.list.author(HouseList.K_REVOKE, 6, bytes())
    hm.sweep(nil)
    hm.on_frame(here(6, 10, info))
    check("the presence of a node struck off goes, and is not taken again", hm.far.contains(6), false)
    empty(nbrs)
end

# a panel's favourite bridge
def section_favorite()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    check("no bridge in the house: no favourite", hm.favorite(), 0)
    hm.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    check("the first bridge the panel adds is its favourite, and it is kept", [hm.favorite(), persist.find(HouseMesh.FAV, nil)], [6, 6])
    hm.add_node(HouseList.ROLE_BRIDGE, key(7), mac(7), nil, "Kitchen", 7)
    check("the next is not", hm.favorite(), 6)
    check("one is chosen", [hm.set_favorite(7), hm.favorite(), persist.find(HouseMesh.FAV, nil)], [true, 7, 7])
    hm.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, "Den panel", 5)
    check("a panel, a number nobody has or this panel is no favourite", [hm.set_favorite(5), hm.set_favorite(9), hm.set_favorite(4), hm.favorite()], [false, false, false, 7])
    hm.list.author(HouseList.K_REVOKE, 7, bytes())
    empty(nbrs)
    var b = bytes(-32)
    b[19] = 1
    nbrs.push({"id": 6, "state": 0, "beat": 300, "info": b.tohex()})
    check("the favourite struck off: the first bridge in step", hm.favorite(), 6)
    empty(nbrs)
    var again = HouseMesh(HouseList.ROLE_PANEL)
    again.every_second()
    check("a panel that starts has its choice from the flash", again.fav, 7)
    var br = fresh(HouseList.ROLE_BRIDGE, 6)
    check("a bridge has no favourite to keep", br.set_favorite(6), false)
end

# the devices removed from the house: a bridge's tombstones
def section_gone()
    var br = a_house(HouseList.ROLE_BRIDGE, 6)
    var mark = def (src, ieees)
        var b = bytes()
        b.add(HouseState.MSG_MARK, 1)
        b.add(HouseState.WIRE, 1)
        b.add(3, 1)
        b.add(size(ieees), 1)
        for i: ieees b .. bytes(i[2 ..]) end
        return {"From": src, "Dest": 6, "Type": 6, "Flags": 0, "Data": b.tohex()}
    end
    br.on_frame(mark(5, [lamp1]))
    empty(sent)
    tasmota.utc_now = 1700000000
    br.state.forgotten("0x00124b0000aa0001")
    check("a device removed from the house: its tombstone, by its IEEE in capitals, and the house told now by the flood",
          [br.state.gone.find(lamp1), size(sent), sent[0][0], sent[0][3][4 ..].asstring()], [1700000000, 1, 255, '{"' + lamp1 + '":{"Gone":1}}'])
    check("kept in the flash", persist.find(HouseState.GONE, nil), {lamp1: 1700000000})
    tasmota.timers.advance(HouseState.ANSWER_GAP_MS + 100)
    empty(sent)
    br.on_frame(mark(5, [lamp1]))
    check("and said in the answer to a mark of it, for a panel that was off", json.load(sent[size(sent) - 1][3][4 ..].asstring()), {lamp1: {"Gone": 1}})
    empty(sent)
    br.state.forgotten(lamp2)
    check("one nobody marks is not flooded", size(sent), 0)
    br.state.back(lamp1)
    check("a device back on the network is not removed any more", [br.state.gone.contains(lamp1), persist.find(HouseState.GONE, nil)], [false, {lamp2: 1700000000}])
    var again = HouseMesh(HouseList.ROLE_BRIDGE)
    again.state.load()
    check("a bridge that starts has them from the flash", again.state.gone, {lamp2: 1700000000})
    tasmota.utc_now = 1700000000 + HouseState.GONE_DAYS * 86400 + 1
    br.state.expire_gone()
    check("after GONE_DAYS they go", [size(br.state.gone), persist.find(HouseState.GONE, nil)], [0, nil])
    for i: 1 .. HouseState.GONE_MAX + 2
        tasmota.utc_now = 1800000000 + i
        br.state.forgotten("0x00124B0000DD" + (i < 10 ? "000" : i < 100 ? "00" : "0") + str(i))
    end
    check("no more than GONE_MAX, the oldest going first", [size(br.state.gone), br.state.gone.contains("0x00124B0000DD0001"), br.state.gone.contains("0x00124B0000DD0003")], [HouseState.GONE_MAX, false, true])
    tasmota.utc_now = nil
    br.state.gone = {}
    br.state.keep_gone()
end

# a node that leaves by itself says so to the panels first, and a panel strikes it off
def section_going()
    var two = bridge_of_house()
    var p = two[0]
    var br = two[1]
    empty(sent)
    var done = [0]
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    check("a bridge that leaves by itself tells every panel of the house first", [br.go(def () done[0] += 1 end), size(sent), sent[0][0], sent[0][3][0]], [true, 1, 4, HouseMesh.MSG_GOING])
    var said = sent[0][3]
    check("and is in the house until GOING_MS", [br.up, done[0], br.go(nil)], [true, 0, false])
    tasmota.timers.advance(HouseMesh.GOING_MS)
    check("then it leaves, and what was to follow does", [br.up, done[0]], [false, 1])
    p.on_frame(frame(6, 4, said))
    check("the panel that writes, the first of the house, strikes it off at once", p.list.revoked(6), true)
    p.on_frame(frame(6, 4, said))
    check("once", p.list.revoked(6), true)
    # a second panel waits for the first
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_PANEL, key(3), mac(3), nil, "Den panel 3", 3)
    hm.add_node(HouseList.ROLE_BRIDGE, key(7), mac(7), nil, "Living room", 7)
    hm.on_frame(frame(7, 4, said))
    check("a panel with one of a lower number before it waits", hm.list.revoked(7), false)
    tasmota.timers.advance(HouseMesh.GOING_STEP_MS)
    check("and strikes it off GOING_STEP_MS later, when that one has not", hm.list.revoked(7), true)
    hm.add_node(HouseList.ROLE_BRIDGE, key(8), mac(8), nil, "Bedroom", 8)
    hm.on_frame(frame(8, 4, said))
    hm.key.version += 1
    tasmota.timers.advance(HouseMesh.GOING_STEP_MS)
    check("nor when the key changed meanwhile: the one before it did, and its entry is on the way", hm.list.revoked(8), false)
    hm.on_frame(frame(9, 4, said))
    check("a node the house does not have is let go", hm.list.field(HouseList.K_IDENT, 9), nil)
end

# the house's MQTT: a panel writes it, every node takes it once, and a bridge writes nothing
def section_mqtt()
    import persist
    var two = bridge_of_house()
    var p = two[0]
    var br = two[1]
    var taken = []
    p.mqtt = HouseMqtt(p, / m -> taken.push(["panel", m["host"]]))
    br.mqtt = HouseMqtt(br, / m -> taken.push(["bridge", m["host"]]))
    persist.remove(HouseMqtt.KEY)
    empty(sent)
    check("a bridge does not write it", br.set_mqtt({"host": "10.0.0.5"}), false)
    check("a panel that writes the list does", [p.set_mqtt({"host": "10.0.0.5", "user": "ha", "password": "secret123"}), p.mqtt_setting()["user"]], [true, "ha"])
    tasmota.timers.advance(HouseMqtt.WAIT_MS + 10)
    check("and takes it itself, a moment later", taken, [["panel", "10.0.0.5"]])
    check("once: the same setting is not taken again", p.mqtt.check(), false)
    # the bridge takes the entry as the panel's list goes to it
    empty(sent)
    p.send_entries(6, 0)
    var frames = []
    for s: sent  frames.push(s[3]) end
    for d: frames  br.on_frame(frame(4, 6, d)) end
    persist.remove(HouseMqtt.KEY)
    tasmota.timers.advance(HouseMqtt.WAIT_MS + 10)
    check("a node that has it in its list takes it", [br.mqtt_setting() != nil, taken[-1]], [true, ["bridge", "10.0.0.5"]])
    persist.remove(HouseMqtt.KEY)
end

# The alarm's configuration as a setting of the house: a panel writes it, each bridge takes the part that is its own
def section_alarm()
    import persist
    var two = bridge_of_house()
    var p = two[0]
    var br = two[1]
    var taken = []
    br.alarm = HouseAlarm(br, / c -> taken.push(c))
    persist.remove(HouseAlarm.KEY)
    var LAMP = "0x00124B0000F00001"
    var DOOR = "0x00124B0000AA0001"
    var SIREN = "0x00124B0000BB0001/2"
    var owner = / id -> 6
    check("a house with no alarm in its list: every bridge keeps its own", [p.alarm_setting(), br.alarm.check()], [nil, false])
    check("a bridge does not write it", HouseAlarm.edit(br, {"do": "times", "exit": 10}, owner, nil), false)
    # the first word of a panel, in a house that had an alarm on its bridge: what the screens had of it, and the word on top
    var seed = {"t": [45, 20, 120], "p": [1, 1, 0], "b": [6, 2], "s": [SIREN], "np": [], "pd": [[LAMP, "on"]],
                "sensors": {DOOR: ["perimeter", 1, "house", 0, "", "", 0, 4]}}
    check("a panel's first word starts from what the bridge of the house had", HouseAlarm.edit(p, {"do": "times", "exit": 10}, owner, seed), true)
    check("the house's part: the word on top of what it had", p.alarm_setting(), {"times": [10, 20, 120], "ha": true, "panels": true, "alarm": false, "burst": [6, 2]})
    var devs = {}
    for it: p.alarm_devices(6)  devs[it[0]] = it[1] end
    check("and the bridge's devices, under its number: the door, the siren on its channel, the lamp's action in the panic",
          [devs[DOOR]["role"], devs[DOOR]["entry"], devs[DOOR]["notify"], devs[SIREN]["siren"], devs[LAMP]["act"]], [1, true, 2, true, "on"])
    # the screens' model, of every bridge
    var cfg = HouseAlarm.panel_cfg(p)
    check("the screens' model: the times, the panic, the sirens and the sensors, as a bridge says its own",
          [cfg["t"], cfg["p"], cfg["b"], cfg["s"], cfg["pd"], cfg["sensors"][DOOR]], [[10, 20, 120], [1, 1, 0], [6, 2], [SIREN], [[LAMP, "on"]], ["perimeter", 1, "house", 0, "", "", 0, 4]])
    # the words of the screens
    check("a sensor's word", HouseAlarm.edit(p, {"do": "sensor", "id": DOOR, "role": "24h", "key": "Temperature", "way": "above", "limit": 40.5}, owner, nil), true)
    var row = HouseAlarm.panel_cfg(p)["sensors"][DOOR]
    check("its role and its condition, the rest as it was", [row[0], row[1], row[4], row[5], row[6]], ["24h", 1, "Temperature", "above", 40.5])
    HouseAlarm.edit(p, {"do": "siren", "id": SIREN, "on": false}, owner, nil)
    HouseAlarm.edit(p, {"do": "burst", "id": LAMP, "on": false}, owner, nil)
    cfg = HouseAlarm.panel_cfg(p)
    check("a siren off the list, and a device out of the burst", [cfg["s"], cfg["np"]], [[], [LAMP]])
    HouseAlarm.edit(p, {"do": "panic_cfg", "devices": [], "alarm": true}, owner, nil)
    cfg = HouseAlarm.panel_cfg(p)
    check("the panic's devices all gone, and the alarm in the panic", [cfg["pd"], cfg["p"]], [[], [1, 1, 1]])
    check("a word out of range is no word", HouseAlarm.edit(p, {"do": "times", "siren": 5000}, owner, nil), false)
    # a sensor with nothing left goes from the list
    HouseAlarm.edit(p, {"do": "sensor", "id": DOOR, "role": "off", "notify": "off", "cond": false}, owner, nil)
    check("a sensor with no role, notification or condition goes", HouseAlarm.panel_cfg(p)["sensors"].contains(DOOR), false)
    HouseAlarm.edit(p, {"do": "sensor", "id": DOOR, "role": "perimeter", "entry": true}, owner, nil)
    # the bridge takes its part as the list goes to it
    empty(sent)
    p.send_entries(6, 0)
    var frames = []
    for s: sent  frames.push(s[3]) end
    for d: frames  br.on_frame(frame(4, 6, d)) end
    tasmota.timers.advance(HouseAlarm.WAIT_MS + 10)
    check("the bridge takes the house's configuration as its own alarm's", size(taken), 1)
    var c = taken[-1]
    check("its sensors, its times, its panic, its sirens and the devices out of the burst",
          [c["sensors"][DOOR], c["times"], c["panic"]["alarm"], c["panic"]["burst"], c["sirens"], c["nopanic"]],
          [{"role": "perimeter", "notify": "off", "entry": true}, [10, 20, 120], true, [6, 2], [], [LAMP]])
    check("once: the same setting is not taken again", br.alarm.check(), false)
    # a panel's screens are made again from the list each time it changed, and nothing is kept
    var made = []
    p.alarm = HouseAlarm(p, / c -> made.push(c))
    check("a panel makes its screens' model again each time, with nothing kept", [p.alarm.check(), p.alarm.check(), made], [true, true, [nil, nil]])
    # a device that leaves the network leaves the alarm of the house
    check("a device that left the network is out of the alarm's list", [HouseAlarm.forget(p, DOOR), HouseAlarm.panel_cfg(p)["sensors"].contains(DOOR)], [true, false])
    check("and one the list does not have, nothing", HouseAlarm.forget(p, "0x00124B00FFFF0001"), false)
    persist.remove(HouseAlarm.KEY)
end

# The house's channel: the field of the list, the panel on a network that gives the house its first one, every node that
# gives it to its driver once, a change at its instant on the mesh clock, the heartbeat's bytes of the radio, and a panel alone that follows its network
def station_says(state, ch, ap, off, why)
    tasmota.replies["_EspNowMeshStation"] = {"EspNowMeshStation": {"State": state, "Channel": ch, "Ap": ap, "OffChannel": off, "Reason": why}}
end
def section_channel()
    import persist
    import global
    # the field
    check("the field's data and back", HouseList.channel_of(HouseList.channel_bytes(11, nil)), {"channel": 11, "at": nil})
    check("with its instant", HouseList.channel_of(HouseList.channel_bytes(3, bytes("0102000003E8")))["at"], bytes("0102000003E8"))
    check("a channel out of 1 to 13 is none", [HouseList.channel_bytes(0, nil), HouseList.channel_bytes(14, nil)], [nil, nil])
    check("the house's alone, 8 bytes", [HouseList.shape(HouseList.K_CHANNEL, 0, HouseList.channel_bytes(1, nil)), HouseList.shape(HouseList.K_CHANNEL, 2, HouseList.channel_bytes(1, nil)),
          HouseList.shape(HouseList.K_CHANNEL, 0, bytes("010B00"))], [true, false, false])
    # the mesh clock: ticks of 10 ms on a timeline whose tag is 0102, from the test's clock
    var base = 100000
    global.espnow_mesh_stamp = def ()
        var b = bytes("0102")
        b.add((base + tasmota.millis()) / 10, -4)
        return b
    end
    global.espnow_mesh_age = def (b)
        return {"age": base + tasmota.millis() - b.get(2, -4) * 10, "tag": b[0 .. 1] == bytes("0102"), "synced": true}
    end
    var two = bridge_of_house()
    var p = two[0]
    var br = two[1]
    persist.remove(HouseChannel.KEY)
    check("every node has its part", [p.channel != nil, br.channel != nil, p.channel_setting()], [true, true, nil])
    # the panel on a network gives the house its network's channel, at once (the panel that founded the house)
    station_says("Watch", 0, 10, 0, 0)
    empty(tasmota.cmds)
    p.channel.poll()
    check("the panel on a network gives the house its channel", p.channel_setting(), {"channel": 10, "at": nil})
    tasmota.timers.advance(HouseChannel.WAIT_MS + 10)
    check("and gives it to its own driver", tasmota.cmds.find("_EspNowMeshChannel 10") != nil, true)
    check("once", [p.channel.check(nil), persist.find(HouseChannel.KEY)], [false, HouseList.channel_bytes(10, nil).tohex()])
    # the bridge takes it as the list goes to it
    empty(sent)
    p.send_entries(6, 0)
    var frames = []
    for s: sent  frames.push(s[3]) end
    persist.remove(HouseChannel.KEY)
    empty(tasmota.cmds)
    for d: frames  br.on_frame(frame(4, 6, d)) end
    tasmota.timers.advance(HouseChannel.WAIT_MS + 10)
    check("a bridge takes it from its list", [br.channel_setting()["channel"], tasmota.cmds.find("_EspNowMeshChannel 10") != nil], [10, true])
    # a field applied is never given again: the driver's search may have moved the channel since
    empty(tasmota.cmds)
    br.channel.check(nil)
    check("a field applied is not given again", tasmota.cmds.find("_EspNowMeshChannel 10"), nil)
    # a change: a bridge cannot, a panel can, and it carries its instant, a minute on the mesh clock
    check("a bridge does not write it", br.set_channel(6, nil), false)
    var stamp = global.espnow_mesh_stamp()
    check("a panel does", p.set_channel(6, nil), true)
    var m = p.channel_setting()
    check("the change is in a minute: MOVE_S on the mesh clock", [m["channel"], m["at"][0 .. 1], m["at"].get(2, -4) - stamp.get(2, -4)], [6, bytes("0102"), 6000])
    empty(tasmota.cmds)
    tasmota.timers.advance(HouseChannel.WAIT_MS + 10)
    check("not before its instant", tasmota.cmds.find("_EspNowMeshChannel 6"), nil)
    tasmota.timers.advance(30000)
    check("nor half way", tasmota.cmds.find("_EspNowMeshChannel 6"), nil)
    tasmota.timers.advance(30000)
    check("at its instant the panel moves", tasmota.cmds.find("_EspNowMeshChannel 6") != nil, true)
    # a change whose instant has come, and one of another timeline, are taken at once
    br.list.apply(4, 99, 999, HouseList.K_CHANNEL, 0, HouseList.channel_bytes(3, global.espnow_mesh_stamp()))
    empty(tasmota.cmds)
    br.channel.check(nil)
    check("a change whose instant has come is taken at once", tasmota.cmds.find("_EspNowMeshChannel 3") != nil, true)
    var other = bytes("0909")
    other.add(1, -4)
    br.list.apply(4, 100, 1000, HouseList.K_CHANNEL, 0, HouseList.channel_bytes(2, other))
    empty(tasmota.cmds)
    br.channel.check(nil)
    check("and one of another timeline, too: nothing can say when it is", tasmota.cmds.find("_EspNowMeshChannel 2") != nil, true)
    # the heartbeat's bytes of the radio
    station_says("Parked", 11, 0, 6, 201)
    br.channel.poll()
    var b = MeshBeat.shared().buf
    check("the heartbeat says the radio: the mesh's channel, no access point, one off the channel, and why", [b[28], b[29], b[30], b[31]], [11, 0, 6, 201])
    check("this node's own", br.channel.mine(), {"mesh": 11, "ap": 0, "off": 6, "why": 201})
    check("and a neighbour's, from its heartbeat", HouseChannel.of_info(b.tohex()), {"mesh": 11, "ap": 0, "off": 6, "why": 201})
    check("a heartbeat of fewer bytes says nothing", HouseChannel.of_info("01020304"), nil)
    station_says("Watch", 11, 11, 0, 201)
    br.channel.poll()
    b = MeshBeat.shared().buf
    check("on its access point, no failure said", [b[28], b[29], b[30], b[31]], [11, 11, 0, 0])
    # a panel alone in its house follows its network; one with other nodes does not
    var lone = fresh(HouseList.ROLE_PANEL, 4)
    lone.found("Cottage")
    persist.remove(HouseChannel.KEY)
    station_says("Watch", 0, 6, 0, 0)
    lone.channel.poll()
    check("a panel alone gives its house its network's channel", lone.channel_setting(), {"channel": 6, "at": nil})
    station_says("Watch", 6, 1, 0, 0)
    lone.channel.poll()
    check("and follows it to another, at once", lone.channel_setting(), {"channel": 1, "at": nil})
    lone.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    station_says("Watch", 1, 11, 0, 0)
    lone.channel.poll()
    check("a panel with another node does not follow its network", lone.channel_setting()["channel"], 1)
    tasmota.replies.remove("_EspNowMeshStation")
    global.espnow_mesh_stamp = def () return false end
    global.espnow_mesh_age = def (b) return false end
    persist.remove(HouseChannel.KEY)
end

# The screens told when a node starts or stops being heard, and the node a panel adds remembered for them to say it is starting
def section_heard()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    var id = hm.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    check("a node this panel adds is remembered, for the screens to say it is starting", hm.added.contains(id), true)
    var told = []
    hm.on_heard = / -> told.push(1)
    empty(nbrs)
    hm.poll()
    var first = size(told)
    hm.poll()
    check("nothing changed: the screens are not told again", size(told), first)
    nbrs.push({"id": 9, "state": 0, "info": "", "beat": -1})
    hm.poll()
    check("a neighbour that is no node of the house is not heard (house_mesh.be, neighbors())", [size(told), size(hm.neighbors())], [first, 0])
    nbrs.push({"id": id, "state": 0, "info": "", "beat": -1})
    hm.poll()
    check("a node heard: told", [size(told), size(hm.neighbors())], [first + 1, 1])
    nbrs[1]["state"] = 2
    hm.poll()
    check("and silent: told", size(told), first + 2)
    hm.poll()
    var n = size(told)
    tasmota.timers.advance(HouseMesh.ADDED_MS + 200)
    hm.poll()
    check("once its time to start is over, the screens are told again", size(told), n + 1)
end

# A neighbour in its safeboot image: the OTA driver's events, kept for the mesh's page, which draws again
def section_ota()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    var told = []
    hm.on_heard = / -> told.push(1)
    tasmota.at_ms = 1000
    MeshEvents.get().call("Ota", {"Node": 7, "State": 1, "Image": "3a91f0c2", "Block": 2, "Blocks": 31, "Rssi": -61})
    check("a neighbour heard in its safeboot image is kept, and the screens told", [hm.safeboot_of(7)[0 .. 2], size(told)], [[1, 2, 31], 1])
    check("with its image, its signal and when it said it, for a neighbour that sends it the image when it stalls", hm.safeboot_of(7)[3 ..],
          ["3a91f0c2", -61, 1000])
    tasmota.at_ms = 5000
    MeshEvents.get().call("Ota", {"Node": 7, "State": 1, "Image": "00000000", "Block": 3, "Blocks": 31, "Rssi": -64})
    check("what it says next, kept over it", [hm.safeboot_of(7)[0 .. 2], size(told)], [[1, 3, 31], 2])
    check("an image of no manifest yet is none, and the change's time is its last progress", hm.safeboot_of(7)[3 ..], ["", -64, 5000])
    tasmota.at_ms = nil
    MeshEvents.get().call("Ota", {"Node": 7, "Gone": 1})
    check("and forgotten when the driver says it is gone", [hm.safeboot_of(7), size(told)], [nil, 3])
    MeshEvents.get().call("Ota", {"Node": 8, "Gone": 1})
    check("a node never heard, gone, tells the screens nothing", size(told), 3)
    MeshEvents.get().call("Ota", "x")
    MeshEvents.get().call("Ota", {"State": 1})
    check("and what is not a map with a node is not taken", [size(told), size(hm.safeboot)], [3, 0])
end

# The whole house knows a node in its safeboot image: its hearers say it in their presence, and a panel out of its reach shows it
def section_ota_house()
    import global as natives
    var heres = def ()
        var l = []
        for x: sent
            if x[0] == 255 && x[1] == HouseState.T_FLOOD && x[3][0] == HouseMesh.MSG_HERE  l.push(x[3]) end
        end
        return l
    end
    # the bridge 6 hears the bridge 7 in its safeboot image
    var br = a_house(HouseList.ROLE_BRIDGE, 6)
    empty(sent)
    for i: 1 .. 11
        tasmota.timers.advance(1000)
        br.every_second()
    end
    check("a presence with no node in its safeboot image ends with how the node is tied, as before", size(heres()[0]), 3 + 32 + 3)
    empty(sent)
    MeshEvents.get().call("Ota", {"Node": 7, "State": 1, "Block": 16, "Blocks": 32})
    tasmota.timers.advance(1000)
    br.every_second()
    var h = heres()
    check("a node heard going into its safeboot image: its hearer says its presence in the next second", size(h), 1)
    check("with the node, its state and the percent of its image written", h[0][38 ..], bytes("01070132"))
    var said = h[0].copy()
    # the panel 4, out of the bridge 7's reach, hears the bridge 6's presence
    var hm = a_house(HouseList.ROLE_PANEL, 4)
    var told = []
    hm.on_heard = / -> told.push(1)
    var frame = def (from, d) return {"From": from, "Dest": 255, "Type": HouseState.T_FLOOD, "Flags": 0, "Data": d.tohex()} end
    check("never heard in its safeboot image", hm.safeboot_of(7), nil)
    hm.on_frame(frame(6, said))
    check("said in the bridge 6's presence: the panel knows the bridge 7 is in its safeboot image, 50%, and the screens are told",
          [hm.safeboot_of(7), size(told)], [[1, 50, 100], 1])
    hm.on_frame(frame(6, said))
    check("the same again tells the screens nothing new", size(told), 1)
    tasmota.timers.advance(24000)
    check("fresh for 2.5 of the sayer's periods", hm.safeboot_of(7), [1, 50, 100])
    tasmota.timers.advance(2000)
    check("then not said", hm.safeboot_of(7), nil)
    hm.poll()
    check("and the next poll forgets it and tells the screens", [hm.far_sb.contains(7), size(told)], [false, 2])
    hm.on_frame(frame(6, said))
    check("said again: told", size(told), 3)
    var more = said.copy()
    more[41] = 75
    hm.on_frame(frame(6, more))
    check("its percent changed: kept, and told", [hm.safeboot_of(7), size(told)], [[1, 75, 100], 4])
    var own = said[0 .. 37]
    hm.on_frame(frame(7, own))
    check("the node's own presence again: out of its safeboot image", [hm.safeboot_of(7), size(told)], [nil, 5])
    var me = said[0 .. 37]
    me .. bytes("01040132")
    hm.on_frame(frame(6, me))
    check("a presence that says this node is in its safeboot image is not taken", hm.safeboot_of(4), nil)
    var cut = said[0 .. 37]
    cut .. bytes("020701")
    hm.on_frame(frame(6, cut))
    check("nor what a frame cut short does not hold", hm.far_sb.contains(7), false)
    # a node heard there, by this panel itself, is what it says
    MeshEvents.get().call("Ota", {"Node": 7, "State": 1, "Block": 3, "Blocks": 32})
    hm.on_frame(frame(6, said))
    check("heard by itself, it is the panel's own", hm.safeboot_of(7)[0 .. 2], [1, 3, 32])
    MeshEvents.get().call("Ota", {"Node": 7, "Gone": 1})
    # the server's requests relayed over the mesh and their answers: to the server's link (server_link.be)
    var got = []
    var member = def (from, d) return {"From": from, "Dest": 4, "Type": HouseMesh.T_MEMBER, "Flags": 0, "Data": d.tohex()} end
    hm.on_frame(member(6, bytes("2E017B7D")))
    check("with no hook, a relayed request is let be", size(got), 0)
    var f = / src, d -> got.push([src, d])
    hm.hook(HouseMesh.MSG_DO, f)
    hm.hook(HouseMesh.MSG_DONE, f)
    hm.on_frame(member(6, bytes("2E017B7D")))
    hm.on_frame(member(6, bytes("2F0101000141")))
    hm.on_frame(member(6, bytes("3501")))
    check("the server's request relayed, and an answer to one, to the part that hooked them, and nothing else", got,
          [[6, bytes("2E017B7D")], [6, bytes("2F0101000141")]])
    # the neighbours on a Wi-Fi access point, the best signal first: the ones that may fetch from the server for this node (node_ota.be)
    var radio = def (ap)
        var b = bytes()
        for i: 0 .. 31  b.add(0, 1) end
        b[29] = ap
        return b.tohex()
    end
    empty(nbrs)
    nbrs.push({"id": 5, "state": 0, "rssi": -70, "info": radio(10)})
    nbrs.push({"id": 6, "state": 0, "rssi": -50, "info": radio(10)})
    nbrs.push({"id": 7, "state": 0, "rssi": -40, "info": radio(0)})
    nbrs.push({"id": 9, "state": 0, "rssi": -30, "info": radio(10)})
    check("on the Wi-Fi, the best signal first; one off it, and one of no house of this one's, left out", hm.wifi_neighbours(), [6, 5])
    nbrs[1]["state"] = 2
    nbrs[0]["beat"] = HouseMesh.BEAT_FRESH_MS + 1
    check("nor one silent, or whose heartbeat is old", hm.wifi_neighbours(), [])
    empty(nbrs)
end

def sent_move()
    var b = bytes()
    b.add(HouseMesh.MSG_MOVE, 1)
    b.add(HouseMesh.WIRE, 1)
    return b
end
# The word to join another house: a panel says it to a node, twice; the node goes as if by itself, the panels told first, and opens its window
def section_move()
    var two = bridge_of_house()
    var p = two[0]
    var br = two[1]
    var opened = []
    br.on_move = / -> opened.push(1)
    check("a bridge does not move another node", br.move(4), false)
    empty(sent)
    check("a panel does, and says it to the node", [p.move(6), size(sent), sent[0][0], sent[0][3][0]], [true, 1, 6, HouseMesh.MSG_MOVE])
    tasmota.timers.advance(HouseMesh.LEAVE_AGAIN_MS + 10)
    check("twice", [size(sent), sent[-1][3][0]], [2, HouseMesh.MSG_MOVE])
    check("not this panel itself, nor a node struck off", [p.move(4), p.move(99)], [false, false])
    # the bridge takes it from a panel of its list: it goes, the panels told first, and its window opens once it is out
    empty(sent)
    br.on_frame(frame(4, 6, sent_move()))
    check("the node told goes: the panels are told first", [br.leaving, size(sent) > 0 && sent[0][3][0] == HouseMesh.MSG_GOING], [true, true])
    tasmota.timers.advance(HouseMesh.GOING_MS + 10)
    check("and once out, its window opens", [br.up, opened], [false, [1]])
    # a word from a node that is not a panel of the house is let go
    var two2 = bridge_of_house()
    var br2 = two2[1]
    var opened2 = []
    br2.on_move = / -> opened2.push(1)
    br2.on_frame(frame(6, 6, sent_move()))
    check("a word from a node that is not a panel of the list is let go", [br2.leaving, opened2], [false, []])
end

def sent_view(msg, m)
    var b = bytes()
    b.add(msg, 1)
    b.add(HouseMesh.WIRE, 1)
    b .. bytes().fromstring(json.dump(m))
    return b
end
# Another node's screens: a panel asks a node of its house for one, and the node answers a panel of its list with the rows its image
# draws, in as many frames as they take; a touch on a row goes to the node, which answers with the screen again
def section_view()
    var two = bridge_of_house()
    var p = two[0]
    var br = two[1]
    check("a bridge asks no node", br.ask_view(4, ["settings"], nil), false)
    empty(sent)
    check("a panel asks a node of its house for a screen", [p.ask_view(6, ["settings"], nil), size(sent), sent[0][0], sent[0][3][0], json.load(sent[0][3][2 ..].asstring())],
          [true, 1, 6, HouseMesh.MSG_VIEW_ASK, {"v": ["settings"]}])
    check("not itself, nor a number of no node", [p.ask_view(4, ["settings"], nil), p.ask_view(99, ["settings"], nil)], [false, false])
    empty(sent)
    p.ask_view(6, ["settings"], 2)
    check("a touch on a row is another word, with the row", [sent[0][3][0], json.load(sent[0][3][2 ..].asstring())], [HouseMesh.MSG_VIEW_TAP, {"v": ["settings"], "k": 2}])
    # the bridge answers with what its image draws
    var asked = []
    br.view_fn = def (v, k)
        asked.push([v, k])
        return [v, "Main settings", [["Zigbee channel", "11", 0, 0], ["Info", "", 1, 0, ["info"]]], false, []]
    end
    empty(sent)
    br.on_frame(frame(4, 6, sent_view(HouseMesh.MSG_VIEW_ASK, {"v": ["settings"]})))
    check("the node draws the screen asked, no touch, and answers the panel that asked in a frame", [asked, size(sent), sent[0][0], sent[0][3][0]],
          [[[["settings"], nil]], 1, 4, HouseMesh.MSG_VIEW])
    var told = []
    p.on_view = / n -> told.push(n)
    p.on_frame(frame(6, 4, sent[0][3]))
    check("the panel keeps the screen by the node's number, and tells the screens", [p.remote[6][1 ..], told],
          [[["settings"], "Main settings", [["Zigbee channel", "11", 0, 0], ["Info", "", 1, 0, ["info"]]], false, {}], [6]])
    empty(sent)
    br.on_frame(frame(4, 6, sent_view(HouseMesh.MSG_VIEW_TAP, {"v": ["settings"], "k": 1})))
    check("a touch: the node is given the row", asked[-1], [["settings"], 1])
    # a screen longer than a frame goes in pieces, and the panel waits for the last
    var many = []
    for i: 0 .. 11  many.push(["A row of a long screen " + str(i), "a value of it " + str(i), 0, 0]) end
    br.view_fn = / v, k -> [v, "Info", many, true, []]
    empty(sent)
    br.on_frame(frame(4, 6, sent_view(HouseMesh.MSG_VIEW_ASK, {"v": ["info"]})))
    var fits = true
    for x: sent  if size(x[3]) > HouseMesh.room_to(4) fits = false end end
    check("a long screen goes in more frames, each one fitting", [size(sent) > 1, fits], [true, true])
    told = []
    for i: 0 .. size(sent) - 2  p.on_frame(frame(6, 4, sent[i][3])) end
    check("until the last piece the panel keeps the screen it had", [p.remote[6][1], told], [["settings"], []])
    p.on_frame(frame(6, 4, sent[-1][3]))
    check("whole, the rows in their order, and the screen closed as the node said", [size(p.remote[6][3]), p.remote[6][3][11][0], p.remote[6][4], told],
          [12, "A row of a long screen 11", true, [6]])
    # what a touch carries: a text typed on the panel, the answer to its question; and what the screen carries back
    empty(sent)
    p.ask_view(6, ["wifi"], 1, {"t": "p4ssp4ss00"})
    p.ask_view(6, ["wifi"], 4, {"y": 1})
    check("a touch with a text typed, and one asked first, carry them", [json.load(sent[0][3][2 ..].asstring()), json.load(sent[1][3][2 ..].asstring())],
          [{"v": ["wifi"], "k": 1, "t": "p4ssp4ss00"}, {"v": ["wifi"], "k": 4, "y": 1}])
    var tapped = sent[0][3]
    var given = []
    br.view_fn = def (v, k, x)
        given.push([v, k, x])
        return [["wifiJoin"], "Cottage", [["Connecting", "20 s", 0, 0]], false, [], {"g": 1, "a": 1000}]
    end
    empty(sent)
    br.on_frame(frame(4, 6, tapped))
    var answer = sent[0][3]
    br.on_frame(frame(4, 6, sent_view(HouseMesh.MSG_VIEW_ASK, {"v": ["wifi"]})))
    check("the node is given them, and nothing for a screen asked", given, [[["wifi"], 1, {"t": "p4ssp4ss00"}], [["wifi"], nil, nil]])
    told = []
    p.on_frame(frame(6, 4, answer))
    check("the screen that follows, and the time to ask it again, kept with it", [p.remote[6][1], p.remote[6][5], told], [["wifiJoin"], {"g": 1, "a": 1000}, [6]])
    # an ask from a node that is not a panel of the house is let go
    empty(sent)
    br.on_frame(frame(6, 6, sent_view(HouseMesh.MSG_VIEW_ASK, {"v": ["settings"]})))
    check("an ask from a node that is not a panel of the list is let go", size(sent), 0)
    # a screen the image does not draw, or one that fails, answers nothing
    br.view_fn = / v, k -> nil
    br.on_frame(frame(4, 6, sent_view(HouseMesh.MSG_VIEW_ASK, {"v": ["wifi"]})))
    br.view_fn = def (v, k) raise "boom", "view" end
    br.on_frame(frame(4, 6, sent_view(HouseMesh.MSG_VIEW_ASK, {"v": ["settings"]})))
    check("a screen the image does not draw, or one that fails, answers nothing", size(sent), 0)
end

def section_leave()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    hm.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    hm.key.keep_cur(1, key(77).tohex())
    persist.setmember("house_marks", {"5": {"u": 1, "s": {}}})
    persist.setmember("house_key", {"v": 2})
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    check("the house takes the mesh's frames, its timeline and its sync while it is up, from the one rule of the dispatcher", [mesh_ids("frame").find(HouseMesh.T_RULE) != nil, mesh_ids("Timeline").find(HouseMesh.T_RULE) != nil, mesh_ids("Synced").find(HouseMesh.T_RULE) != nil, rules_of("EspNowMesh")], [true, true, true, 1])
    empty(tasmota.cmds)
    hm.leaving = true
    hm.leave()
    check("a node that leaves: the list, the key it kept, the change it carried out and the marks go from the flash",
          [persist.find("house", nil), persist.find("house_cur", nil), persist.find("house_key", nil), persist.find("house_marks", nil)], [nil, nil, nil, nil])
    check("and from here: no number, no node, not up, and no longer leaving", [hm.list.me, size(hm.list.ids(true)), hm.up, hm.leaving], [0, 0, false, false])
    check("its own bridge is no number of a house any more", hm.number_of("A0:B7:65:00:00:06", HouseList.ROLE_BRIDGE), 0)
    check("the driver is told to forget its number, its keys and its nodes", driver_writes(), ["EspNowMeshLeave 1"])
    check("and the house takes none of them any more", mesh_has(HouseMesh.T_RULE), false)
    check("the key is none", [hm.key.version, hm.key.pend, hm.key.cur()], [0, nil, nil])
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    hm.every_second()
    check("and at the next second the panel founds a house of its own, a new one: a panel always has a house",
          [hm.up, hm.list.me, size(hm.list.ids(true)), hm.list.name() != "Cottage", hm.own_house()], [true, 1, 1, true, true])

    # the word to leave: only from a panel of the house
    var two = bridge_of_house()
    var br = two[1]
    check("the bridge holds the house: the panel 4 is a panel of its list", [br.up, br.list.is_panel(4)], [true, true])
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    br.on_frame(frame(9, 6, leave_word()))
    tasmota.timers.advance(10)
    check("the word to leave from a node that is not a panel of the house is let go", br.up, true)
    br.on_frame(frame(4, 6, leave_word()))
    tasmota.timers.advance(10)
    check("from a panel of the house the node leaves", [br.up, br.list.me, last_of(driver_writes())], [false, 0, "EspNowMeshLeave 1"])

    # a node that finds itself struck off leaves
    two = bridge_of_house()
    var p = two[0]
    br = two[1]
    var above = p.list.mine
    p.revoke(6)
    empty(sent)
    p.send_entries(6, above)
    var frames = []
    for s: sent frames.push(s[3]) end
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    for d: frames br.on_frame(frame(4, 6, d)) end
    tasmota.timers.advance(10)
    check("a node that takes the entry that strikes it off leaves the house", [br.up, br.list.me], [false, 0])

    # a panel removes another node: the word goes at once and again a moment later, and the node is struck off after it
    var rp = fresh(HouseList.ROLE_PANEL, 4)
    rp.found("Cottage")
    rp.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    check("a panel cannot remove itself, nor a node that is not in the house", [rp.remove(4), rp.remove(9)], [false, false])
    empty(sent)
    check("a panel removes a bridge", rp.remove(6), true)
    rp.flush_out()
    check("the word to leave goes to it at once", size(frames_to(6, HouseMesh.MSG_LEAVE)), 1)
    check("and it is not struck off yet: the word goes before the driver forgets it", rp.list.revoked(6), false)
    tasmota.timers.advance(HouseMesh.LEAVE_AGAIN_MS + 10)
    rp.flush_out()
    check("the word goes again", size(frames_to(6, HouseMesh.MSG_LEAVE)), 2)
    tasmota.timers.advance(HouseMesh.REMOVE_MS)
    check("then the node is struck off", rp.list.revoked(6), true)
    check("and a bridge removes nothing: it writes nothing", fresh(HouseList.ROLE_BRIDGE, 6).remove(4), false)

    # a panel leaves with its bridge: the bridge is told, both are struck off in the list, the entries go to the node that stays, and the panel leaves LEAVE_MS later
    var lp = fresh(HouseList.ROLE_PANEL, 4)
    lp.found("Cottage")
    lp.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    lp.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    empty(sent)
    empty(tasmota.cmds)
    check("a panel leaves with its bridge", lp.leave_house(6), true)
    lp.flush_out()
    check("the bridge is told to leave", size(frames_to(6, HouseMesh.MSG_LEAVE)), 1)
    check("the list says the bridge and the panel are out of the house", [lp.list.revoked(6), lp.list.revoked(4)], [true, true])
    check("the panel that stays is given those entries, and the bridge none", [size(frames_to(5, HouseMesh.MSG_ENTRIES)) > 0, size(frames_to(6, HouseMesh.MSG_ENTRIES))], [true, 0])
    check("and no key changes: the panel does not stay to carry a change out", lp.key.pend, nil)
    check("the panel is still in the house a moment, for the frames to go", lp.up, true)
    check("and does not leave twice", lp.leave_house(6), false)
    tasmota.timers.advance(HouseMesh.LEAVE_MS + 10)
    check("then it leaves", [lp.up, last_of(driver_writes())], [false, "EspNowMeshLeave 1"])

    # a panel leaves alone: its bridge stays in the house, and is given the entry that says the panel left
    var ap = fresh(HouseList.ROLE_PANEL, 4)
    ap.found("Cottage")
    ap.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    empty(sent)
    ap.leave_house(0)
    ap.flush_out()
    check("a panel that leaves alone: its bridge is not told to leave, and is not struck off", [size(frames_to(6, HouseMesh.MSG_LEAVE)), ap.list.revoked(6)], [0, false])
    check("it is given the entry that says the panel left", [size(frames_to(6, HouseMesh.MSG_ENTRIES)) > 0, ap.list.revoked(4)], [true, true])

    # the last panel of a house takes its bridges along: every bridge is told to leave and struck off
    var lastp = fresh(HouseList.ROLE_PANEL, 4)
    lastp.found("Cottage")
    lastp.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", 6)
    lastp.add_node(HouseList.ROLE_BRIDGE, key(7), mac(7), nil, "Bedroom", 7)
    lastp.add_node(HouseList.ROLE_PANEL, key(5), mac(5), nil, nil, 5)
    lastp.revoke(5)
    check("the house's bridges, not the panels nor the struck off", lastp.bridges(), [6, 7])
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    empty(sent)
    check("the last panel leaves with every bridge", lastp.leave_house(-1), true)
    lastp.flush_out()
    check("each bridge is told to leave, and each is struck off with the panel",
          [size(frames_to(6, HouseMesh.MSG_LEAVE)), size(frames_to(7, HouseMesh.MSG_LEAVE)), lastp.list.revoked(6), lastp.list.revoked(7), lastp.list.revoked(4)], [1, 1, true, true, true])

    # the console's HouseLeave
    var cp = fresh(HouseList.ROLE_PANEL, 4)
    cp.found("Cottage")
    HouseCommands(cp)
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    check("the console asks for a 1", say("HouseLeave", ""), ['{"HouseLeave":"1 to leave"}', nil])
    check("and with it the node leaves", [say("HouseLeave", "1"), cp.up], [['{"HouseLeave":"Done"}', nil], false])
end

# a panel founds its own house whenever its driver runs with no number, named by its radio address: at its first boot and
# as soon as it has left a house, but while it waits at its window for another to take it; and it keeps whether the house it is in is its own
def section_own()
    check("the name is House- and six letters of Crockford's base 32 from the low 30 bits of the radio address",
          [HouseMesh.own_name(bytes("a0b7656c3f10")), HouseMesh.own_name(bytes("000000000000")), HouseMesh.own_name(bytes("ffffffffffff"))],
          ["House-jprfrg", "House-000000", "House-zzzzzz"])
    var hm = fresh(HouseList.ROLE_PANEL, 0)
    check("a panel with no number founds its own house at the driver's first second: number 1, itself in it, named by its address",
          [hm.up, hm.list.me, hm.list.ids(false), hm.list.name()], [true, 1, [1], "House-" + HouseMesh.own_name(mac(0))[6 ..]])
    check("and it is its own house, which the flash says", [hm.own_house(), persist.find(HouseMesh.OWN)], [true, true])
    var br = fresh(HouseList.ROLE_BRIDGE, 0)
    check("a bridge founds nothing: it waits for a house", [br.up, br.list.me], [false, 0])
    # a panel that leaves its house founds its own again, at once: a panel always has a house
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    hm.leaving = true
    hm.leave()
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    check("out of it, the panel has no number for a moment", [hm.up, hm.list.me], [false, 0])
    hm.every_second()
    check("and the next second founds its own house again, by the same name", [hm.up, hm.list.me, hm.list.name(), hm.own_house()], [true, 1, HouseMesh.own_name(mac(0)), true])
    # but not while it waits at its window for another house to take it
    hm.leaving = true
    hm.leave()
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    var waits = true
    hm.hold = / -> waits
    hm.every_second()
    check("a panel that waits at its window founds none", [hm.up, hm.list.me, persist.find(HouseMesh.OWN)], [false, 0, nil])
    waits = false
    hm.every_second()
    check("and when the window ends with no house to take it, it founds its own", [hm.up, hm.own_house()], [true, true])
    hm.hold = nil
    # a panel in a house it was welcomed into is in another's, and leaving it is back in its own
    persist.zero()
    var other = fresh(HouseList.ROLE_PANEL, 4)
    check("a panel in a house it did not found is not in its own", other.own_house(), false)
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    other.leaving = true
    other.leave()
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    other.every_second()
    check("leaving it, it founds its own", [other.up, other.list.me, other.own_house()], [true, 1, true])
    # the driver with no identity yet: the next second tries again
    var late = fresh(HouseList.ROLE_PANEL, 0)
    check("a panel whose driver already gave it a house, in the second the test made it", late.up, true)
    persist.zero()
    var wait = HouseMesh(HouseList.ROLE_PANEL)
    tasmota.replies["_EspNowMeshId"] = {"EspNowMeshId": 0}
    tasmota.replies.remove("_EspNowMeshPublic")
    wait.every_second()
    check("with no identity from the driver yet, nothing is founded", [wait.up, persist.find(HouseMesh.OWN)], [false, nil])
    tasmota.replies["_EspNowMeshPublic"] = {"EspNowMeshPublic": {"Id": 0, "Mac": "A0:B7:65:00:00:07", "Public": key(7).tohex()}}
    wait.every_second()
    check("and the next second founds it", [wait.up, wait.list.me, wait.list.name()], [true, 1, HouseMesh.own_name(mac(7))])
end

# The nodes of the house in one place ("a node removed from the house has to be completely removed and forgotten", and the access to them
# centralised, so that no part keeps one): the list forgets a node struck off, the sweep tells every part the house's numbers and the names it forgot, and the
# neighbours every part reads are the house's
def section_sweep()
    var hm = fresh(HouseList.ROLE_PANEL, 4)
    hm.found("Cottage")
    var b = hm.add_node(HouseList.ROLE_BRIDGE, key(6), mac(6), nil, "Living room", nil)
    var p = hm.add_node(HouseList.ROLE_PANEL, key(7), mac(7), nil, "Bedroom", nil)
    var told = []
    hm.forgets.push(def (m, forgot) told.push([m, forgot]) end)
    hm.set_favorite(b)
    hm.asked[b] = 1
    hm.peer_ver[b] = 2
    hm.added[b] = 3
    hm.key.pend = {"v": 2, "k": key(77).tohex(), "to": [b, p], "got": {p: 1}}
    hm.key.sent[b] = 1
    hm.devices.waiting[p] = 0
    hm.list.author(HouseList.K_REVOKE, b, bytes())
    hm.touched()
    check("every part is told the house's numbers and the name of the node forgotten", told, [[{4: true, p: true}, {b: "Living room"}]])
    check("this node's own forget it: the favourite, what it asked, the key it heard, that it added it", [hm.fav, hm.asked.contains(b), hm.peer_ver.contains(b), hm.added.contains(b)],
          [0, false, false, false])
    check("and the favourite goes from the flash", persist.find(HouseMesh.FAV, nil), nil)
    check("the change of the key waits for it no more", [hm.key.pend["to"], hm.key.sent.contains(b), persist.find("house_key", {}).find("to")], [[p], false, [p]])
    hm.touched()
    check("nothing changed: the parts are not told again", size(told), 1)
    # the neighbours: the house's alone
    empty(nbrs)
    nbrs.push({"id": b, "state": 0})
    nbrs.push({"id": p, "state": 0})
    nbrs.push({"id": 30, "state": 0})
    var ids = []
    for n: hm.neighbors()  ids.push(n["id"]) end
    check("the neighbours every part reads are the nodes of the house: not one struck off, nor one of no house", ids, [p])
    # a panel struck off: the bridge's marks of it go, from the flash too
    var two = bridge_of_house()
    var br = two[1]
    br.state.marks[4] = {"u": 1, "s": {"0x00124B0000000001": true}}
    br.state.marks[9] = {"u": 1, "s": {"0x00124B0000000002": true}}
    br.state.keep()
    br.sweep({4: true, 6: true})
    check("a bridge forgets the marks of a panel that is no more, from the flash too", [br.state.marks.contains(9), persist.find("house_marks", {}).contains("9")], [false, false])
    # a node with no list, the bench's mesh numbered by hand, is told nothing and takes its neighbours as they are
    var bench = fresh(HouseList.ROLE_BRIDGE, 7)
    var bt = []
    bench.forgets.push(def (m, forgot) bt.push(1) end)
    bench.sweep(nil)
    empty(nbrs)
    nbrs.push({"id": 9, "state": 0})
    check("a node with no list is told nothing, and takes the neighbours as they are", [size(bt), size(bench.neighbors())], [0, 1])
    # a node that leaves the house: every part forgets every node of it
    var lv = fresh(HouseList.ROLE_PANEL, 4)
    lv.found("Cottage")
    var lt = []
    lv.forgets.push(def (m, forgot) lt.push(m) end)
    tasmota.replies["EspNowMeshLeave 1"] = {"EspNowMeshLeave": "Done"}
    lv.leaving = true
    lv.leave()
    check("a node that leaves tells every part that no node is the house's", lt[-1], {})
end

def run_all()
    section_own()
    section_start()
    section_found()
    section_answers()
    section_take()
    section_out()
    section_driver()
    section_poll()
    section_key_rules()
    section_rotate()
    section_welcome()
    section_state_panel()
    section_state_bridge()
    section_devices_bridge()
    section_devices_panel()
    section_commands()
    section_link()
    section_events()
    section_in_step()
    section_two_hops()
    section_two_hops_loss()
    section_presence()
    section_favorite()
    section_gone()
    section_going()
    section_mqtt()
    section_alarm()
    section_channel()
    section_heard()
    section_ota()
    section_ota_house()
    section_move()
    section_view()
    section_leave()
    section_sweep()
end
run_all()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
