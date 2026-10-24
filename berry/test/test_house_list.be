# berry/house_list.be: the list of the house as the panels write it. The shape of an entry, the rules that make two
# fields one (the greater seq, the lower author, the lower key of two identities for one number, a revoke for good), what a node holds and says of it (the vector, its
# digest, what an author's snapshot is), the questions the house asks of it (the number of a new node, the alarm number of a new bridge, who is a panel), the flash,
# and the property that matters: nodes that are given the same entries, in any order and more than once, and then the snapshots of one another, hold the same list.

import persist

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

# a public key made of a number, 32 bytes
def key(n)
    var b = bytes(-32)
    b[0] = n
    b[31] = 255 - n
    return b
end

# the data of an identity: the role, the key made of `k`, a radio address of 6 bytes
def ident(role, k)
    var d = bytes()
    d.add(role, 1)
    d .. key(k)
    d .. bytes("0a0b0c0d0e0f")
    return d
end

def text(s)
    return bytes().fromstring(s)
end

# the fields of a list, in a form that does not depend on the order of the map: for the replicas to be compared
def canon(h)
    var keys = []
    for k: h.f.keys() keys.push(k) end
    var i = 1
    while i < size(keys)
        var j = i
        while j > 0 && keys[j - 1] > keys[j]
            var t = keys[j - 1]
            keys[j - 1] = keys[j]
            keys[j] = t
            j -= 1
        end
        i += 1
    end
    var out = []
    for k: keys
        var x = h.f[k]
        out.push(str(k) + ":" + str(x[0]) + ":" + str(x[1]) + ":" + x[2].tohex())
    end
    return out
end

def section_shape()
    var e = HouseList.encode(HouseList.K_NAME, 0, 7, 9, text("Cottage"))
    check("a name of the house is 7 bytes and the text", e.tohex(), "020000070009" + "07" + "436F7474616765")
    var back = HouseList.decode(e, 0)
    check("it reads back", [size(back), back[0][0], back[0][1], back[0][2], back[0][3], back[0][4].asstring()], [1, 2, 0, 7, 9, "Cottage"])
    # two entries in a row, and a third that is cut short
    var two = HouseList.encode(HouseList.K_REVOKE, 9, 1, 1, bytes())
    var run = e + two
    check("two entries in a row are two", size(HouseList.decode(run, 0)), 2)
    check("a cut one is not read", size(HouseList.decode(run + bytes("0301"), 0)), 2)
    check("an entry of a kind that is not known is none", HouseList.encode(9, 1, 1, 1, bytes()), nil)
    check("a node of 0 is the house's, and only for a name", [HouseList.encode(HouseList.K_REVOKE, 0, 1, 1, bytes()), HouseList.encode(HouseList.K_NAME, 0, 1, 1, bytes())], [nil, bytes("020000010001" + "00")])
    check("a node of 255 is none", HouseList.encode(HouseList.K_REVOKE, 255, 1, 1, bytes()), nil)
    check("a seq of 0 is none", HouseList.encode(HouseList.K_REVOKE, 3, 0, 1, bytes()), nil)
    check("a seq of 65536 is none", HouseList.encode(HouseList.K_REVOKE, 3, 65536, 1, bytes()), nil)
    check("a time of 0 is none", HouseList.encode(HouseList.K_REVOKE, 3, 1, 0, bytes()), nil)
    check("a name of 21 bytes is none", HouseList.encode(HouseList.K_NAME, 3, 1, 1, bytes(-21)), nil)
    check("a name of 20 is one", size(HouseList.encode(HouseList.K_NAME, 3, 1, 1, bytes(-20))), 27)
    check("an identity of 38 bytes is none", HouseList.encode(HouseList.K_IDENT, 3, 1, 1, bytes(-38)), nil)
    check("an identity whose role is neither is none", HouseList.shape(HouseList.K_IDENT, 3, bytes(-39)), false)
    check("an identity of a panel is one", HouseList.shape(HouseList.K_IDENT, 3, ident(HouseList.ROLE_PANEL, 3)), true)
    check("an alarm number of 16 is none", HouseList.shape(HouseList.K_SLOT, 3, bytes("10")), false)
    check("of 0 is none", HouseList.shape(HouseList.K_SLOT, 3, bytes("00")), false)
    check("of 15 is one", HouseList.shape(HouseList.K_SLOT, 3, bytes("0f")), true)
    check("an address is 4 bytes", [HouseList.shape(HouseList.K_ADDR, 3, bytes(-4)), HouseList.shape(HouseList.K_ADDR, 3, bytes(-5))], [true, false])
    check("a revoke carries nothing", [HouseList.shape(HouseList.K_REVOKE, 3, bytes()), HouseList.shape(HouseList.K_REVOKE, 3, bytes("00"))], [true, false])
    check("what is not bytes is not a datum", HouseList.shape(HouseList.K_NAME, 3, "text"), false)
end

# a house founded by the panel 1: its own identity, the bridge 2 with its alarm number and its address, and the name
def founded()
    var h = HouseList(1)
    check("the first entry is seq 1", h.author(HouseList.K_IDENT, 1, ident(HouseList.ROLE_PANEL, 1)) != nil, true)
    h.author(HouseList.K_NAME, 0, text("Sample House"))
    h.author(HouseList.K_IDENT, 2, ident(HouseList.ROLE_BRIDGE, 2))
    h.author(HouseList.K_SLOT, 2, bytes("01"))
    h.author(HouseList.K_ADDR, 2, bytes("c0a8003d"))
    h.author(HouseList.K_NAME, 2, text("Living room"))
    return h
end

def section_authoring()
    var h = founded()
    check("the seqs of an author count from 1", [h.mine, h.v[1]], [6, 6])
    check("the house is named", h.name(), "Sample House")
    check("the nodes of the house", h.ids(false), [1, 2])
    var n = h.node(2)
    check("a node: its role, its alarm number, its name, its address", [n["role"], n["slot"], n["name"], n["ip"].tohex(), n["by"]], [HouseList.ROLE_BRIDGE, 1, "Living room", "C0A8003D", 1])
    check("its key and its radio address", [n["key"] == key(2), n["mac"].tohex()], [true, "0A0B0C0D0E0F"])
    check("a number nobody has", h.node(7), nil)
    check("a panel", [h.is_panel(1), h.is_panel(2), h.is_panel(7)], [true, false, false])
    check("the next number is the lowest never used", h.next_id(), 3)
    check("the alarm number of the next bridge is the lowest free", h.free_slot(), 2)
    check("a key is found", [h.find_key(key(2)), h.find_key(key(9))], [2, 0])
    # a panel's own bridge, by the address of its pairing: the panel 1 has the same address in this house, and is no bridge
    check("a bridge is found by its radio address", h.by_mac(bytes("0a0b0c0d0e0f"), HouseList.ROLE_BRIDGE), 2)
    check("and a panel by its own", h.by_mac(bytes("0a0b0c0d0e0f"), HouseList.ROLE_PANEL), 1)
    check("an address nobody has, none, and one that is not 6 bytes",
          [h.by_mac(bytes("0a0b0c0d0e00"), HouseList.ROLE_BRIDGE), h.by_mac(nil, HouseList.ROLE_BRIDGE), h.by_mac(bytes("0a0b"), HouseList.ROLE_BRIDGE)], [0, 0, 0])
    var gone = founded()
    gone.author(HouseList.K_REVOKE, 2, bytes())
    check("a bridge struck off is nobody's", gone.by_mac(bytes("0a0b0c0d0e0f"), HouseList.ROLE_BRIDGE), 0)
    # a node without a number of its own writes nothing
    var lone = HouseList(0)
    check("no number, no entry", lone.author(HouseList.K_NAME, 0, text("x")), nil)
    check("a datum that is not well made is not written, and no seq is used", [h.author(HouseList.K_SLOT, 2, bytes("20")), h.mine], [nil, 6])
end

def section_rules()
    var h = HouseList(1)
    check("an entry is taken", h.apply(2, 3, 3, HouseList.K_NAME, 5, text("Bedroom")), 1)
    check("the same entry again changes nothing", h.apply(2, 3, 3, HouseList.K_NAME, 5, text("Bedroom")), 0)
    check("one with a lower seq does not win", h.apply(3, 2, 2, HouseList.K_NAME, 5, text("Living room")), 0)
    check("one with a greater seq does", h.apply(3, 4, 4, HouseList.K_NAME, 5, text("Living room")), 1)
    check("the name is the later", h.node(5) == nil && h.field(HouseList.K_NAME, 5)[2].asstring() == "Living room", true)
    check("of the same seq, the lower author wins", [h.apply(4, 4, 4, HouseList.K_NAME, 5, text("Another")), h.field(HouseList.K_NAME, 5)[0]], [0, 3])
    check("and a lower author of the same seq takes it", [h.apply(2, 4, 4, HouseList.K_NAME, 5, text("Two")), h.field(HouseList.K_NAME, 5)[2].asstring()], [1, "Two"])
    check("an entry that is not well made is -1", [h.apply(2, 1, 1, HouseList.K_SLOT, 5, bytes("99")), h.apply(0, 1, 1, HouseList.K_NAME, 5, text("x")), h.apply(2, 0, 0, HouseList.K_NAME, 5, text("x")), h.apply(255, 1, 1, HouseList.K_NAME, 5, text("x"))], [-1, -1, -1, -1])
    # two identities for one number: the lower key stays, whatever the seq says
    var a = HouseList(1)
    a.apply(3, 9, 9, HouseList.K_IDENT, 6, ident(HouseList.ROLE_BRIDGE, 40))
    check("the first identity of a number", a.node(6)["key"] == key(40), true)
    check("a lower key of an earlier entry takes the number", a.apply(2, 1, 1, HouseList.K_IDENT, 6, ident(HouseList.ROLE_BRIDGE, 30)), 1)
    check("and a greater key of a later one does not", [a.apply(2, 50, 50, HouseList.K_IDENT, 6, ident(HouseList.ROLE_BRIDGE, 60)), a.node(6)["key"] == key(30)], [0, true])
    check("the identity written again (the same key) follows the seq", [a.apply(2, 60, 60, HouseList.K_IDENT, 6, ident(HouseList.ROLE_PANEL, 30)), a.node(6)["role"]], [1, HouseList.ROLE_PANEL])
    check("it was not this node's own, so nothing is lost", a.lost, [])
    # the identity this node wrote that lost the number: the panel is told, to give the node another
    var b = HouseList(1)
    b.author(HouseList.K_IDENT, 6, ident(HouseList.ROLE_BRIDGE, 40))
    b.apply(2, 1, 1, HouseList.K_IDENT, 6, ident(HouseList.ROLE_BRIDGE, 30))
    check("the identity of this node's that lost is kept, whole", [size(b.lost), b.lost[0][0], b.lost[0][1] == ident(HouseList.ROLE_BRIDGE, 40)], [1, 6, true])
    # a revoke is for good, and the node is forgotten whole: the mark alone stays
    var c = founded()
    c.author(HouseList.K_REVOKE, 2, bytes())
    check("a node struck off is not in the house, and its number is the mark alone", [c.ids(false), c.ids(true), c.revoked(2), c.is_panel(2), c.node(2)], [[1], [1, 2], true, false, nil])
    var left = []
    for k: c.f.keys()
        if (k & 255) == 2  left.push(k >> 8) end
    end
    check("every field of it is gone, its identity, alarm number, address and name: the mark stays", left, [HouseList.K_REVOKE])
    check("its name is kept for the house's sweep, which takes it", c.forgot, {2: "Living room"})
    check("its number is not given again", c.next_id(), 3)
    check("and its alarm number is free", c.free_slot(), 1)
    check("nothing writes it back: an identity written later is not taken", [c.apply(1, 99, 99, HouseList.K_IDENT, 2, ident(HouseList.ROLE_BRIDGE, 2)), c.revoked(2), c.node(2)], [0, true, nil])
    check("nor a name, nor anything of it", [c.apply(1, 100, 100, HouseList.K_NAME, 2, text("Living room")), c.label(2)], [0, nil])
    check("its key is no node's: it would come back as a new one", c.find_key(key(2)), 0)
    # a list saved before this, with the node and its mark, forgets it when read
    var old = founded()
    old.f[HouseList.K_REVOKE * 256 + 2] = [1, 7, bytes(), 7]
    var d = HouseList(1)
    d.from_map(old.to_map())
    check("a list read from the flash with the fields of a node struck off keeps the mark alone", [d.ids(true), d.node(2), d.revoked(2), d.forgot], [[1, 2], nil, true, {2: "Living room"}])
end

# the time is a Lamport clock: what a panel writes after it read another's entry wins over it, whatever the number of entries each has written
def section_time()
    var a = HouseList(4)
    for i: 1 .. 9
        a.author(HouseList.K_NAME, i, text("n"))
    end
    a.author(HouseList.K_NAME, 7, text("from four"))
    var b = HouseList(5)
    for e: a.entries_of(4, 0)
        var r = HouseList.decode(e, 0)[0]
        b.apply(4, r[2], r[3], r[0], r[1], r[4])
    end
    b.take_upto(4, a.v[4])
    check("the panel that wrote ten entries has the clock at ten", [a.clock, b.clock], [10, 10])
    check("the panel 5 has written none", b.mine, 0)
    b.author(HouseList.K_NAME, 7, text("from five"))
    check("what it writes after it read them wins, though its seq is 1 and theirs 10", [b.node(7) == nil, b.field(HouseList.K_NAME, 7)[2].asstring(), b.field(HouseList.K_NAME, 7)[1], b.field(HouseList.K_NAME, 7)[3]], [true, "from five", 1, 11])
    # and what the other panel gets of it
    var got = a.apply(5, 1, 11, HouseList.K_NAME, 7, text("from five"))
    check("the panel 4 takes it", [got, a.field(HouseList.K_NAME, 7)[2].asstring(), a.clock], [1, "from five", 11])
    # a write at the same time by both: the lower author
    var c = HouseList(4)
    var d = HouseList(5)
    c.author(HouseList.K_NAME, 3, text("quatro"))
    d.author(HouseList.K_NAME, 3, text("cinco"))
    c.apply(5, 1, 1, HouseList.K_NAME, 3, text("cinco"))
    d.apply(4, 1, 1, HouseList.K_NAME, 3, text("quatro"))
    check("the same time: the lower author, on both", [c.field(HouseList.K_NAME, 3)[2].asstring(), d.field(HouseList.K_NAME, 3)[2].asstring()], ["quatro", "quatro"])
    # the clock is kept in the flash and read back
    persist.remove("house")
    a.save()
    var e = HouseList(4)
    e.load()
    check("the clock is read back", [e.clock, e.mine], [11, 10])
    persist.remove("house")
end

def section_vector()
    var h = founded()
    check("the vector of one author", h.vector().tohex(), "010006")
    check("the digest is of 24 bits and is not 0", h.digest() > 0 && h.digest() <= 0xFFFFFF, true)
    check("a node that holds nothing says 0", HouseList(7).digest(), 0)
    var d1 = h.digest()
    h.author(HouseList.K_NAME, 2, text("Kitchen"))
    check("an entry moves the digest", h.digest() != d1, true)
    # the order the authors come in does not matter
    var x = HouseList(7)
    var y = HouseList(7)
    x.take_upto(2, 5)
    x.take_upto(9, 1)
    y.take_upto(9, 1)
    y.take_upto(2, 5)
    check("the vector is in order of author, whatever the order they came in", [x.vector().tohex(), y.vector().tohex(), x.digest() == y.digest()], ["0200050900" + "01", "0200050900" + "01", true])
    check("the vector never goes back", [x.take_upto(2, 3), x.v[2], x.take_upto(2, 9), x.v[2]], [false, 5, true, 9])
    # the digest is kept at its rev: after every kind of change it is the one the vector gives
    def fnv(l)
        var v = l.vector()
        if size(v) == 0 return 0 end
        var hh = 0x811C9DC5
        for i: 0 .. size(v) - 1 hh = (hh ^ v[i]) * 0x01000193 end
        return hh & 0xFFFFFF
    end
    var c = HouseList(7)
    var seen = [c.digest() == fnv(c)]
    c.take_upto(3, 2)
    seen.push(c.digest() == fnv(c))
    c.take_upto(3, 4)
    seen.push(c.digest() == fnv(c))
    var z = HouseList(7)
    z.digest()
    z.from_map(c.to_map())
    seen.push(z.digest() == fnv(z) && z.digest() != 0)
    z.take_upto(5, 1)
    seen.push(z.digest() == fnv(z))
    check("the digest kept at its rev is the vector's after every kind of change", seen, [true, true, true, true, true])
    var theirs = HouseList.parse_vector(bytes("010009" + "030002"), 0)
    var mine_v = HouseList(7)
    mine_v.take_upto(1, 4)
    mine_v.take_upto(3, 2)
    mine_v.take_upto(5, 1)
    check("what a vector holds that this node does not: the authors and what this node has of each", mine_v.behind(theirs), [[1, 4]])
    check("a vector that is not whole is none", [HouseList.parse_vector(bytes("0100"), 0), HouseList.parse_vector(bytes(), 0)], [nil, {}])
end

def section_snapshot()
    var a = founded()
    a.author(HouseList.K_NAME, 2, text("Kitchen"))            # the name of the bridge, written again
    var all = a.entries_of(1, 0)
    check("an author's snapshot has the fields that are still its own, newest of each: 6 fields of the 7 entries", size(all), 6)
    var seqs = []
    for e: all seqs.push((e[2] << 8) | e[3]) end
    check("in order of seq, without the entry the same author wrote over (the name of 2 at seq 6)", seqs, [1, 2, 3, 4, 5, 7])
    var b = HouseList(5)
    for e: all
        var r = HouseList.decode(e, 0)[0]
        b.apply(1, r[2], r[3], r[0], r[1], r[4])
    end
    b.take_upto(1, a.v[1])
    check("a node that took the snapshot has the same fields and the same vector", [canon(b), b.digest()], [canon(a), a.digest()])
    check("and the name is the last", b.node(2)["name"], "Kitchen")
    var more = a.entries_of(1, 5)
    check("what is above a seq: the entries after it", size(more), 1)
    check("nothing above the last", size(a.entries_of(1, 7)), 0)
    check("nothing of an author that wrote none", size(a.entries_of(9, 0)), 0)
end

def section_flash()
    persist.remove("house")
    var a = founded()
    a.apply(2, 4, 4, HouseList.K_NAME, 0, text("Another"))
    a.save()
    var b = HouseList(1)
    b.load()
    check("a list is read as it was saved", [canon(b), b.digest(), b.mine], [canon(a), a.digest(), a.mine])
    check("its own seq goes on from where it was", b.author(HouseList.K_NAME, 1, text("Study")) != nil && b.mine == 7, true)
    var c = HouseList(9)
    c.load()
    check("a node that is not the author of those has the vector and no entry of its own", [c.mine, c.v.find(1), c.v.find(9)], [0, 6, nil])
    # nothing saved, and what is not whole
    persist.remove("house")
    var d = HouseList(1)
    d.load()
    check("nothing saved is an empty list", [size(d.f), size(d.v), d.mine, d.digest()], [0, 0, 0, 0])
    var g = HouseList(1)
    g.from_map({"v": "010006", "f": "010101000127", "m": 6})
    check("a field that is cut short is left out", size(g.f), 0)
    g.from_map({"v": "0100", "f": "zz", "m": -3})
    check("a vector that is not whole, hex that is not hex and a seq below 0 are left out", [size(g.v), size(g.f), g.mine], [0, 0, 0])
    g.from_map("garbage")
    check("a thing that is not a map is an empty list", size(g.f), 0)
    persist.remove("house")
end

# the property: three panels write, in their way; every node is given every entry in any order, some of them twice, then the snapshots of the others, and they all hold the
# same fields and the same digest
def next_rand(s)
    return (s * 1103515245 + 12345) & 0x7fffffff
end

def one_byte(n)
    var b = bytes()
    b.add(n, 1)
    return b
end

def section_convergence()
    var rounds = 0
    for seed: 1 .. 12
        var s = seed * 7919
        var panels = []
        for p: 1 .. 3 panels.push(HouseList(p)) end
        var reps = []
        for r: 1 .. 3 reps.push(HouseList(10 + r)) end
        var log = []          # [author, seq, kind, node, data]
        for step: 1 .. 30
            s = next_rand(s)
            var who = s % 3
            s = next_rand(s)
            var pick = (s >> 8) % 5
            s = next_rand(s)
            var node = 1 + ((s >> 8) % 6)
            var kind = nil
            var data = nil
            if pick == 0
                kind = HouseList.K_NAME
                data = text("n" + str((s >> 4) % 100))
            elif pick == 1
                kind = HouseList.K_IDENT
                data = ident(HouseList.ROLE_BRIDGE, (s >> 4) % 200)
            elif pick == 2
                kind = HouseList.K_SLOT
                data = one_byte(1 + (s >> 4) % 15)
            elif pick == 3
                kind = HouseList.K_ADDR
                data = bytes("c0a800")
                data.add((s >> 4) % 256, 1)
            else
                kind = (s >> 4) % 9 == 0 ? HouseList.K_REVOKE : HouseList.K_NAME
                data = kind == HouseList.K_NAME ? text("m") : bytes()
            end
            var e = panels[who].author(kind, node, data)
            var d = HouseList.decode(e, 0)[0]
            log.push([who + 1, d[2], d[3], kind, node, data])
        end
        # each node takes the log in an order of its own, with repeats
        var nodes = []
        for p: panels nodes.push(p) end
        for r: reps nodes.push(r) end
        for nd: nodes
            var order = []
            for i: 0 .. size(log) - 1 order.push(i) end
            # a shuffle
            var i = size(order) - 1
            while i > 0
                s = next_rand(s)
                var j = (s >> 8) % (i + 1)
                var t = order[i]
                order[i] = order[j]
                order[j] = t
                i -= 1
            end
            for idx: order
                var l = log[idx]
                if l[0] != nd.me nd.apply(l[0], l[1], l[2], l[3], l[4], l[5]) end
                s = next_rand(s)
                if (s >> 8) % 4 == 0 && l[0] != nd.me nd.apply(l[0], l[1], l[2], l[3], l[4], l[5]) end
            end
        end
        # the snapshots: every node is given the others' snapshots of each author, whole
        for nd: nodes
            for a: panels
                var snap = a.entries_of(a.me, 0)
                for e: snap
                    var r = HouseList.decode(e, 0)[0]
                    if a.me != nd.me nd.apply(a.me, r[2], r[3], r[0], r[1], r[4]) end
                end
                if a.me != nd.me nd.take_upto(a.me, a.v[a.me]) end
            end
        end
        var first = canon(nodes[0])
        var same = true
        var dig = true
        for nd: nodes
            if canon(nd) != first same = false end
            if nd.digest() != nodes[0].digest() dig = false end
        end
        check("round " + str(seed) + ": all six hold the same fields", same, true)
        check("round " + str(seed) + ": and the same digest", dig, true)
        rounds += 1
    end
    check("the rounds ran", rounds, 12)
end

def run_all()
    section_shape()
    section_authoring()
    section_rules()
    section_time()
    section_vector()
    section_snapshot()
    section_flash()
    section_convergence()
end
run_all()

# The alarm's configuration: the house's part and a page of a bridge's devices, as bytes and back
do
    var a = {"times": [45, 20, 120], "ha": false, "panels": true, "alarm": true, "burst": [6, 2]}
    var d = HouseList.alarm_bytes(a)
    check("the house's part of the alarm, and back", [HouseList.alarm_of(d), HouseList.shape(HouseList.K_ALARM, 0, d), HouseList.shape(HouseList.K_ALARM, 4, d)], [a, true, false])
    check("a time out of range is none", [HouseList.alarm_bytes({"times": [1000, 0, 0]}), HouseList.alarm_bytes({"burst": [1, 0]})], [nil, nil])
    var items = [["0x00124B0000AA0001", {"role": 1, "notify": 2, "entry": true, "sound": false, "siren": false, "nopanic": false, "news": 0}],
                 ["0x00124B0000BB0001/2", {"role": 0, "notify": 0, "entry": false, "sound": false, "siren": true, "nopanic": false, "news": 0}],
                 ["0x00124B0000CC0001", {"role": 3, "notify": 3, "entry": false, "sound": true, "siren": false, "nopanic": true, "news": 12,
                                         "cond": {"k": "Temperature", "w": "below", "x": -2.5}, "act": "on"}]]
    var page = HouseList.page_bytes(items)
    check("a page of a bridge's devices, and back: a channel, a condition below zero, an action", HouseList.page_of(page), items)
    check("its shape: a bridge's number, not the house's", [HouseList.shape(HouseList.K_APAGE, 6, page), HouseList.shape(HouseList.K_APAGE + 7, 6, page), HouseList.shape(HouseList.K_APAGE, 0, page)], [true, true, false])
    check("a kind past the pages is one this build does not know: kept when it is small, refused when it is not",
          [HouseList.known(HouseList.K_APAGE + 8), HouseList.shape(HouseList.K_APAGE + 8, 6, bytes("0102")), HouseList.shape(HouseList.K_APAGE + 8, 6, page + page)],
          [false, true, false])
    check("an empty page is a page", HouseList.page_of(HouseList.page_bytes([])), [])
    check("data that is not one: cut, another version", [HouseList.page_of(page[0 .. size(page) - 3]), HouseList.page_of(bytes("02") + page[1 ..])], [nil, nil])
    import string
    var many = []
    for i: 1 .. 20  many.push(["0x00124B0000DD00" + string.format("%02X", i), {"role": 1, "notify": 0, "entry": false, "sound": false, "siren": false, "nopanic": false, "news": 0}]) end
    check("a page has room for so many: the rest goes to the next", HouseList.page_bytes(many), nil)
end

# The house's MQTT: a field of the house's number 0, as bytes and back
do
    var m = {"host": "192.168.2.10", "port": 1884, "user": "ha", "password": "a;b c", "discovery": false, "expire": 24}
    var d = HouseList.mqtt_bytes(m)
    check("the house's MQTT as the field's data, and back", HouseList.mqtt_of(d), m)
    var k = HouseList.mqtt_bytes({"host": "192.168.2.10", "user": "ha", "password": "not kept", "keep": true})
    check("each node its own password: the word, and no password in the data", [HouseList.mqtt_of(k)["keep"], HouseList.mqtt_of(k)["password"], HouseList.shape(HouseList.K_MQTT, 0, k)], [true, "", true])
    check("its shape: the house's number only", [HouseList.shape(HouseList.K_MQTT, 0, d), HouseList.shape(HouseList.K_MQTT, 4, d)], [true, false])
    var long = ""
    for i: 1 .. 41  long += "h" end
    check("a host too long is no setting", HouseList.mqtt_bytes({"host": long}), nil)
    check("none: an empty broker, the port Tasmota's, the discovery on", HouseList.mqtt_of(HouseList.mqtt_bytes({})), {"host": "", "port": 1883, "user": "", "password": "", "discovery": true, "expire": 0})
    check("data that is not one: short, another version, a length past its end", [HouseList.mqtt_of(bytes("01")), HouseList.mqtt_of(bytes("02") + d[1 ..]), HouseList.mqtt_of(d[0 .. size(d) - 2])], [nil, nil, nil])
    var l = HouseList(4)
    check("written into a list, as a field like the house's name", [l.author(HouseList.K_MQTT, 0, d) != nil, HouseList.mqtt_of(l.field(HouseList.K_MQTT, 0)[2])["host"]], [true, "192.168.2.10"])
end

# The house's server: a member of the list with a number, its address and its port, and no node of the mesh; and what a build does not know, carried
do
    var h = founded()
    var sv = bytes()
    sv.add(HouseList.ROLE_SERVER, 1)
    sv .. key(9)
    sv .. bytes("000000000000")
    var id = h.next_id()
    check("a server takes the next number", [id, h.author(HouseList.K_IDENT, id, sv) != nil, h.author(HouseList.K_ADDR, id, bytes("c0a8026c")) != nil,
          h.author(HouseList.K_PORT, id, bytes("1fa3")) != nil, h.author(HouseList.K_NAME, id, text("Home Assistant")) != nil], [3, true, true, true, true])
    check("it is no node of the mesh, and the servers are", [h.ids(false), h.ids(true), h.servers()], [[1, 2], [1, 2], [3]])
    var n = h.node(3)
    check("its address, its port and its name", [n["role"], n["ip"].tohex(), n["port"], n["name"], h.label(3)], [HouseList.ROLE_SERVER, "C0A8026C", 8099, "Home Assistant", "Home Assistant"])
    check("its number is taken: the next node has the next", h.next_id(), 4)
    check("a port of 0 is none", HouseList.shape(HouseList.K_PORT, 3, bytes("0000")), false)
    h.author(HouseList.K_REVOKE, 3, bytes())
    check("struck off, it is forgotten, and its number stays taken", [h.servers(), h.ids(true), h.next_id()], [[], [1, 2, 3], 4])
    var u = bytes()
    u.add(7, 1)
    u .. key(10)
    u .. bytes("000000000000")
    check("an identity of a role this build does not know is kept, and is no node nor server", [h.author(HouseList.K_IDENT, 4, u) != nil, h.ids(false), h.servers(), h.next_id()],
          [true, [1, 2], [], 5])
    check("an entry of a kind this build does not know is kept, and carried as it came",
          [h.author(12, 0, bytes("0102")) != nil, h.field(12, 0)[2].tohex(), HouseList.shape(12, 0, bytes(-65))], [true, "0102", false])
    var g = HouseList(2)
    g.from_map(h.to_map())
    check("and read back from the flash with the rest", [g.field(12, 0)[2].tohex(), g.role(4), g.ids(false)], ["0102", 7, [1, 2]])
    check("saved with its format, its vector is kept", [h.to_map()["k"], g.v.find(1) != nil], [HouseList.FORMAT, true])
    var old = h.to_map()
    old.remove("k")
    var o = HouseList(2)
    o.from_map(old)
    check("saved by a build that knew less: its fields kept, its vector forgotten, so every author's entries are asked for again (what it skipped is taken)",
          [o.ids(false), o.name(), o.v], [[1, 2], "Sample House", {}])
end

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
