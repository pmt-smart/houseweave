# berry/zbbridge_alarm_merge.be against berry/test/vectors/alarm_merge.json: the Berry side of the alarm-state order rule
# which libs/nspanel-sim/vm/test/alarm-merge-ref.mjs specifies and
# whose output the vectors are. Every section of the vectors that is the replica's own is replayed and must answer the same,
# byte for byte: the dots, the 52-byte records, the heartbeat's 19 bytes, the digests of the heads, the pairwise rule (the
# hand-written cases and the 150 seeded random pairs), the twelve situations and the findings' scripts, the heads, the epoch
# and the trust bit. Then what is the Berry side's own: the persisted form (what a power cut leaves, a save that fails), the
# 15 heads and the 780 bytes, a record that is not one, and that no clock of any wall is ever read.
#
# What the vectors say of the C side of the mesh is stood in for here by MeshClock and the world below: the mesh time, the
# adoption of a timeline (the 20 ms band, the follow of a larger time) and the "adopted, translate N ticks" event it hands the
# replica. What is NOT replayed: the sections reconcile, reach, headline, freshness and stamp (the bridge's own repeat of an order
# is the sirens' ladder, not the reference's; the window of a command and its stamp are the mesh's), and the "old" half of the hazards,
# a control that is not to be ported.
#
# Not every number of the vectors is a Berry int: the interpreter that runs this reads a JSON number past 32 bits by wrapping it
# (the vendored one) or by failing (the WebAssembly one), so the file is read with every number of 10 digits or more written as
# the signed int with the same 32 bits (marks and epochs are uint32 and are held so), and the 48-bit mesh time of the hello as
# [high 16 bits, low 32 bits]. TEST_ROOT is the repository root, written by run.mjs.

import json
import persist
import string

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

# --- the vectors, read ---------------------------------------------------------------------------------------------------

# the digits of text[i .. j - 1] as the unsigned number they write, mod 2^32, held as the signed int with those bits
def wrap32(text, i, j)
    var v = 0
    for k: i .. j - 1
        v = v * 10 + int(text[k])
    end
    return v
end

# the same number in 16-bit limbs, as [the bits 32 to 47, the low 32 bits]
def split48(text, i, j)
    var a = 0
    var b = 0
    var c = 0
    for k: i .. j - 1
        a = a * 10 + int(text[k])
        b = b * 10 + (a >> 16)
        c = c * 10 + (b >> 16)
        a = a & 0xFFFF
        b = b & 0xFFFF
        c = c & 0xFFFF
    end
    return [c, (b << 16) | a]
end

# the text of the vectors with every number of 10 digits or more (outside the strings) in a form this VM reads
def fix_numbers(text)
    var n = size(text)
    var out = []
    var i = 0
    var from = 0
    while i < n
        var c = text[i]
        if c == '"'
            i += 1
            while i < n && text[i] != '"'
                if text[i] == '\\' i += 1 end
                i += 1
            end
            i += 1
        elif c >= "0" && c <= "9"
            var j = i
            while j < n && text[j] >= "0" && text[j] <= "9"
                j += 1
            end
            if j - i >= 10
                out.push(text[from .. i - 1])
                if i >= 8 && text[i - 8 .. i - 1] == '"mesh": '
                    var p = split48(text, i, j)
                    out.push("[" + str(p[0]) + ", " + str(p[1]) + "]")
                else
                    out.push(str(wrap32(text, i, j)))
                end
                from = j
            end
            i = j
        else
            i += 1
        end
    end
    out.push(text[from ..])
    return out.concat()
end

def read_vectors()
    var f = open(TEST_ROOT + "/berry/test/vectors/alarm_merge.json")
    var text = f.read()
    f.close()
    return json.load(fix_numbers(text))
end

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

# --- records, as the vectors write them ------------------------------------------------------------------------------------

def parse_dot(s)
    var p = string.split(s, ":")
    return ZbAlarmMerge.dot(int(p[0]), int(p[1]))
end
def dot_text(d) return str(d >> 20) + ":" + str(d & 0xFFFFF) end
def hexs(b) return string.tolower(b.tohex()) end
def tl_bytes(n, e)
    var t = bytes(5)
    t.add(n, 1)
    t.add(e, -4)
    return t
end
# the unsigned decimal of a signed int that holds a uint32
def u32s(x)
    if x >= 0 return str(x) end
    var q = ((x >> 1) & 0x7FFFFFFF) / 5
    return str(q) + str(x - q * 10)
end
def spec_vv(m)
    var v = ZbAlarmMerge.zeros()
    for k: m.keys()
        v[int(k) - 1] = m[k]
    end
    return v
end
def spec_record(s)
    return ZbAlarmMerge.make(ZbAlarmMerge.STATES.find(s["state"]), parse_dot(s["dot"]), spec_vv(s["vv"]),
                             tl_bytes(s["timeline"][0], s["timeline"][1]), s["mark"], s["trusted"], s["lost"])
end
def sparse_vv(r)
    var m = {}
    for i: 0 .. 14
        var c = ZbAlarmMerge.vv_at(r, i)
        if c > 0 m[str(i + 1)] = c end
    end
    return m
end
def tl_pair(r)
    var t = ZbAlarmMerge.tl_of(r)
    return [t[0], t.get(1, -4)]
end
# a record as a vector writes it
def record_spec(r)
    return {"state": ZbAlarmMerge.STATES[ZbAlarmMerge.st_of(r)], "dot": dot_text(ZbAlarmMerge.dot_of(r)), "vv": sparse_vv(r),
            "timeline": tl_pair(r), "mark": ZbAlarmMerge.mark_of(r), "trusted": ZbAlarmMerge.trusted_of(r), "lost": ZbAlarmMerge.lost_of(r)}
end
# the heads of a replica, by their dots
def head_dots(rep)
    var out = []
    for h: rep.heads
        out.push(dot_text(ZbAlarmMerge.dot_of(h)))
    end
    return out
end
# what the vectors record of a replica: the state it shows and the record it comes from
def describe(rep)
    var r = rep.record()
    var t = tl_pair(r)
    return {"state": rep.state(), "dot": dot_text(ZbAlarmMerge.dot_of(r)), "timeline": str(t[0]) + "." + u32s(t[1]),
            "mark": ZbAlarmMerge.mark_of(r), "trusted": ZbAlarmMerge.trusted_of(r), "lost": ZbAlarmMerge.lost_of(r),
            "vv": sparse_vv(r), "heads": head_dots(rep), "wire": hexs(r)}
end

# which of a and b a pairwise answer is, as the vectors say it ("a" or "b"): by content, and a pair of equal records is either
def label_of(win, a, b, want)
    if a == b return want end
    return win == a ? "a" : "b"
end

# --- the persist stub, one flash a node ----------------------------------------------------------------------------------------
# the stub's `persist` is one module, and a house is several bridges: each node has its own flash, which is put in the stub for
# the time of what is done to that node

class Flash
    var store, written, pending, bad, marked, plan
    def init()
        self.store = {}
        self.written = nil
        self.pending = nil
        self.bad = nil
        self.marked = false
        self.plan = nil
    end
    def enter()
        import persist
        persist.store = self.store
        persist.written = self.written
        persist.pending = self.pending
        persist.bad = self.bad
        persist.marked = self.marked
        persist.plan = self.plan
    end
    def leave()
        import persist
        self.store = persist.store
        self.written = persist.written
        self.pending = persist.pending
        self.bad = persist.bad
        self.marked = persist.marked
        self.plan = persist.plan
    end
end

# --- the mesh's clock, and what the C side does with a heartbeat ------------------------------------------------------------------
# the uptime of the node in ms and the offset the mesh added to it: the mesh time. The marks are floor(mesh / 100)

class MeshClock
    var up, off, adopted
    def init()
        self.up = 0
        self.off = 0
        self.adopted = false
    end
    def mesh() return self.up + self.off end
    def ticks() return self.mesh() / 100 end
    def synced() return self.adopted || self.up >= 10000 end
end

# the unsigned order of two 5-byte timeline ids (the node, then the epoch big-endian): the sign of the first byte that differs
def tl5_cmp(a, b)
    for i: 0 .. 4
        if a[i] != b[i] return a[i] - b[i] end
    end
    return 0
end

# The timeline rule of the C side (the reference's TimelineNode.hear): a heartbeat of timeline h_tl with mesh time h_mesh (ms) is
# heard by a node whose clock stands at its uptime. Inside the same timeline a larger time is followed (up to an hour: more is not a
# drift); of two timelines the one up longer is the timeline of both, with a band of 20 ms inside which the smaller id wins. The
# adoption is handed to the replica as the event it gets, with the difference in ticks. Returns whether it adopted
def mesh_hear(rep, clock, h_tl, h_mesh)
    var d = h_mesh - clock.mesh()
    if h_tl == rep.tl
        if d > 0 && d <= 3600000 clock.off += d end
        return false
    end
    if d > 20 || (d >= -20 && tl5_cmp(h_tl, rep.tl) < 0)
        clock.off += d
        clock.adopted = true
        rep.adopted(h_tl, (d + 50) / 100)
        return true
    end
    return false
end

# --- a bridge of the house, and the house -----------------------------------------------------------------------------------------

class AlarmNode
    var id, name, rep, clock, flash, boot_ms
    # a node of a house that has been up together: the persisted state is the initial record (made at true second 80), the
    # counter (1 for node 1), the epoch 1; the timeline is the house's, [1, 1], adopted, and the node has been up 10 000 s
    def init(id, name, base_hex)
        self.id = id
        self.name = name
        self.clock = MeshClock()
        self.flash = Flash()
        self.boot_ms = -10000000
        self.enter()
        persist.setmember(ZbAlarmMerge.HEADS_KEY, base_hex)
        persist.setmember(ZbAlarmMerge.CTR_KEY, id == 1 ? 1 : 0)
        persist.setmember(ZbAlarmMerge.EPOCH_KEY, 1)
        persist.save()
        self.rep = ZbAlarmMerge(id, self.clock)
        self.rep.restore()
        self.rep.start_on(tl_bytes(1, 1), true)
        self.clock.adopted = true
        self.leave()
    end
    def enter() self.flash.enter() end
    def leave() self.flash.leave() end
    # the uptime at true time t (ms)
    def sync(t)
        var u = t - self.boot_ms
        self.clock.up = u < 0 ? 0 : u
    end
end

class AlarmWorld
    var names, nodes
    def init(names, base)
        self.names = names
        self.nodes = []
        var rec = ZbAlarmMerge.make(ZbAlarmMerge.STATES.find(base), ZbAlarmMerge.dot(1, 1), spec_vv({"1": 1}), tl_bytes(1, 1), 100800, true, 0)
        for i: 0 .. size(names) - 1
            self.nodes.push(AlarmNode(i + 1, names[i], rec.tohex()))
        end
    end
    def idx(x)
        if type(x) == "int" return x end
        return self.names.find(x)
    end
    # a power cut and a boot: the uptime restarts, the file is read again, the heads stay
    def boot(i, t)
        var n = self.nodes[self.idx(i)]
        n.boot_ms = t
        n.clock.off = 0
        n.clock.adopted = false
        n.sync(t)
        n.enter()
        persist.reboot()
        n.rep = ZbAlarmMerge(n.id, n.clock)
        n.rep.boot(nil)
        n.leave()
    end
    # a person (or a sensor, for a trigger) acts at the node; a sensor only trips an armed alarm
    def act(i, kind, t)
        var n = self.nodes[self.idx(i)]
        n.sync(t)
        n.enter()
        if kind == "triggered" && n.rep.state() == "disarmed"
            n.leave()
            return nil
        end
        var r = n.rep.act(kind, 0)
        n.leave()
        return r
    end
    def sig()
        var parts = []
        for n: self.nodes
            for h: n.rep.heads
                parts.push(h.tohex())
            end
            parts.push("|")
        end
        return parts.concat()
    end
    # i takes j's heartbeat (the timeline rule) and then j's copies
    def hear(i, j, t)
        var ni = self.nodes[self.idx(i)]
        var nj = self.nodes[self.idx(j)]
        ni.sync(t)
        nj.sync(t)
        var h_tl = nj.rep.tl.copy()
        var h_mesh = nj.clock.mesh()
        ni.enter()
        mesh_hear(ni.rep, ni.clock, h_tl, h_mesh)
        ni.rep.hear(nj.rep.offer())
        ni.leave()
    end
    # both heartbeats first, then both sets of copies (each one takes what the other had AFTER the timeline step)
    def meet(i, j, t)
        var ni = self.nodes[self.idx(i)]
        var nj = self.nodes[self.idx(j)]
        ni.sync(t)
        nj.sync(t)
        var ti = ni.rep.tl.copy()
        var mi = ni.clock.mesh()
        var tj = nj.rep.tl.copy()
        var mj = nj.clock.mesh()
        ni.enter()
        mesh_hear(ni.rep, ni.clock, tj, mj)
        ni.leave()
        nj.enter()
        mesh_hear(nj.rep, nj.clock, ti, mi)
        nj.leave()
        var ri = ni.rep.offer()
        var rj = nj.rep.offer()
        ni.enter()
        ni.rep.hear(rj)
        ni.leave()
        nj.enter()
        nj.rep.hear(ri)
        nj.leave()
    end
    # every pair meets, round after round (5 s apart), until a whole round changes nothing
    def settle(t)
        var rounds = 0
        while rounds < 40
            var before = self.sig()
            for a: 0 .. size(self.nodes) - 1
                for b: a + 1 .. size(self.nodes) - 1
                    self.meet(a, b, t + rounds * 5000)
                end
            end
            if self.sig() == before break end
            rounds += 1
        end
        return rounds
    end
    # one step of a script: ["boot", n, s], ["act", n, kind, s], ["hear", a, b, s], ["meet", a, b, s], ["meetAll", s]
    def step(s)
        var op = s[0]
        if op == "boot"
            self.boot(s[1], s[2] * 1000)
        elif op == "act"
            self.act(s[1], s[2], s[3] * 1000)
        elif op == "hear"
            self.hear(s[1], s[2], s[3] * 1000)
        elif op == "meet"
            self.meet(s[1], s[2], s[3] * 1000)
        elif op == "meetAll"
            self.settle(s[1] * 1000)
        else
            raise "test_error", "unknown step " + str(op)
        end
    end
    def run(steps)
        for s: steps
            self.step(s)
        end
    end
    def states()
        var out = []
        for n: self.nodes
            out.push(n.rep.state())
        end
        return out
    end
end

# --- the bytes: dots, records, the heartbeat's part, the digest ---------------------------------------------------------------------

def section_dots_and_records(v)
    var k = v["constants"]
    check("the sizes the class says", [ZbAlarmMerge.RECORD_BYTES, ZbAlarmMerge.HELLO_BYTES, ZbAlarmMerge.MAX_NODE, ZbAlarmMerge.MAX_COUNTER],
          [k["RECORD_BYTES"], k["HEARTBEAT_BYTES"], k["MAX_NODE"], k["MAX_COUNTER"]])
    check("52 bytes of record are 14 fixed and a vector of 38", [k["RECORD_BYTES"], k["VV_BYTES"], 15 * k["RECORD_BYTES"]], [52, 38, k["HEADS_MAX_BYTES"]])
    for d: v["dots"]
        check("dot " + d[0] + " is node << 20 | counter", parse_dot(d[0]), d[1])
        check("dot " + d[0] + " reads back", [dot_text(d[1]), d[1] >> 20, d[1] & ZbAlarmMerge.MAX_COUNTER], [d[0], int(string.split(d[0], ":")[0]), int(string.split(d[0], ":")[1])])
    end
    for c: v["records"]
        var r = spec_record(c["record"])
        check("record bytes: " + c["name"], hexs(r), c["wire"])
        check("a record is 52 bytes and a record: " + c["name"], [size(r), ZbAlarmMerge.valid(r)], [52, true])
        var back = bytes(c["wire"])
        check("record from its bytes: " + c["name"], [ZbAlarmMerge.valid(back), record_spec(back)], [true, c["record"]])
    end
end

def section_invalid_records(v)
    var full = spec_record(v["records"][1]["record"])
    check("the sample is the arm with the wide vector", [hexs(full)], [v["records"][1]["wire"]])
    check("its 15th counter ends on a nibble", [full[49], full[51]], [0xFF, 0xF0])
    check("counter 1 is 20 bits, then counter 2 begins", [full[14], full[15], full[16] >> 4], [0xFF, 0xFF, 0xF])
    check("a record that is cut is not a record", ZbAlarmMerge.valid(full[0 .. 50]), false)
    var longer = full.copy()
    longer.add(0, 1)
    check("nor one with a byte too many", ZbAlarmMerge.valid(longer), false)
    check("nor the empty one, nor a text", [ZbAlarmMerge.valid(bytes()), ZbAlarmMerge.valid("x"), ZbAlarmMerge.valid(nil)], [false, false, false])
    var flag = full.copy()
    flag[0] = flag[0] | 0x08
    check("bits 3 to 7 of the flags are zero", ZbAlarmMerge.valid(flag), false)
    var pad = full.copy()
    pad[51] = pad[51] | 1
    check("so are the 4 bits of padding", ZbAlarmMerge.valid(pad), false)
    var own = full.copy()
    own[1] = 0x20
    own[2] = 0
    own[3] = 0x0F
    check("a vector that does not hold the record's own dot (2:15 with 3 in the 2nd counter) is not a record", ZbAlarmMerge.valid(own), false)
    var node0 = full.copy()
    node0[1] = 0
    node0[3] = 1
    check("a dot of node 0 is not a dot", ZbAlarmMerge.valid(node0), false)
    var ctr0 = full.copy()
    ctr0[1] = 0x20
    ctr0[2] = 0
    ctr0[3] = 0
    check("nor a dot of counter 0", ZbAlarmMerge.valid(ctr0), false)
    var node15 = spec_record({"state": "triggered", "dot": "15:1048575", "vv": {"15": 1048575}, "timeline": [15, 1], "mark": 7, "trusted": false, "lost": 0})
    check("the last dot of the last node is a record", ZbAlarmMerge.valid(node15), true)
    # the bytes the reference decides on (vectors, "invalid"): the same answer for each, node 0 and counter 0 included
    check("the vectors have the cases of a dot of node 0 and of counter 0", size(v["invalid"]) >= 15, true)
    for c: v["invalid"]
        check("the reference's answer on the bytes: " + c["name"], ZbAlarmMerge.valid(bytes(c["wire"])), c["valid"])
    end
    var all_states = []
    for s: 0 .. 3
        all_states.push(ZbAlarmMerge.st_of(ZbAlarmMerge.make(s, ZbAlarmMerge.dot(3, 4), spec_vv({"3": 4}), tl_bytes(3, 9), 1, true, 0)))
    end
    check("the four states are the two low bits of the flags", all_states, [0, 1, 2, 3])
end

# an unsigned counter of 20 bits in any of the 15 slots, and the dot's node and counter, through the 52 bytes
def section_vector_packing(v)
    var all = true
    for n: 1 .. 15
        for c: [1, 7, 0x12345, 0xFFFFF]
            var vec = ZbAlarmMerge.zeros()
            vec[n - 1] = c
            var r = ZbAlarmMerge.make(2, ZbAlarmMerge.dot(n, c), vec, tl_bytes(n, 0x7FFFFFFF), 0x12345678, true, 5)
            var good = ZbAlarmMerge.valid(r) && ZbAlarmMerge.vv_at(r, n - 1) == c && ZbAlarmMerge.dot_of(r) == ((n << 20) | c)
            for i: 0 .. 14
                if i != n - 1 && ZbAlarmMerge.vv_at(r, i) != 0 good = false end
            end
            if !good all = false end
        end
    end
    check("a counter of 20 bits in each of the 15 slots, with its neighbours untouched", all, true)
    var wide = ZbAlarmMerge.zeros()
    for i: 0 .. 14
        wide[i] = (i + 1) * 60001
    end
    var r = ZbAlarmMerge.make(1, ZbAlarmMerge.dot(15, 1), wide, tl_bytes(15, 1), 5, true, 0)
    var back = []
    for i: 0 .. 14
        back.push(ZbAlarmMerge.vv_at(r, i))
    end
    check("a vector of 15 different counters comes back as it went", back, wide)
    var joined = ZbAlarmMerge.zeros()
    joined[0] = 99
    joined[1] = 1000000
    ZbAlarmMerge.join(joined, r)
    check("the join of a vector takes the higher of each", [joined[0], joined[1], joined[14], joined[3]], [60001, 1000000, 15 * 60001, 4 * 60001])
end

def section_hello(v)
    for c: v["hello"]
        var h = c["hello"]
        var m = h["mesh"]
        var hi = isinstance(m, list) ? m[0] : 0
        var lo = isinstance(m, list) ? m[1] : m
        var tl = tl_bytes(h["timeline"][0], h["timeline"][1])
        var applied = parse_dot(c["applied"])
        var wire = ZbAlarmMerge.encode_hello(tl, hi, lo, h["digest"], applied, h["synced"], h["heads"])
        check("hello bytes: " + c["wire"], [size(wire), hexs(wire)], [19, c["wire"]])
        var back = ZbAlarmMerge.decode_hello(bytes(c["wire"]))
        check("hello from its bytes: " + c["wire"], [back["tl"] == tl, back["hi"], back["lo"], back["digest"], back["applied"], back["synced"], back["count"]],
              [true, hi, lo, h["digest"], applied, h["synced"], h["heads"]])
    end
    check("the second hello is the last mesh time there is, 48 bits of ones", [v["hello"][1]["hello"]["mesh"]], [[0xFFFF, -1]])
    check("a part of another size is not a heartbeat's", [ZbAlarmMerge.decode_hello(bytes(18)), ZbAlarmMerge.decode_hello(bytes(20)), ZbAlarmMerge.decode_hello(nil)], [nil, nil, nil])
    var tl = tl_bytes(7, 0xDEADBEEF)
    var back = ZbAlarmMerge.decode_hello(ZbAlarmMerge.encode_hello(tl, 0xABCD, 0x12345678, 0x0F0F0F0F, 0xABCDEF, true, 15))
    check("every field of the part is its own bits", [back["tl"] == tl, back["hi"], back["lo"], back["digest"], back["applied"], back["synced"], back["count"]],
          [true, 0xABCD, 0x12345678, 0x0F0F0F0F, 0xABCDEF, true, 15])
end

def section_digest(v)
    for c: v["digest"]
        var hs = []
        for s: c["heads"]
            hs.push(spec_record(s))
        end
        var b = bytes(4)
        b.add(ZbAlarmMerge.digest_of(hs), -4)
        check("digest of " + str(size(hs)) + " heads", hexs(b), c["digest"])
    end
    check("no heads: the FNV-1a offset basis", ZbAlarmMerge.digest_of([]), 0x811C9DC5)
    var a = spec_record({"state": "armed_away", "dot": "2:1", "vv": {"2": 1}, "timeline": [2, 2], "mark": 500, "trusted": true, "lost": 0})
    var b = spec_record({"state": "disarmed", "dot": "3:1", "vv": {"3": 1}, "timeline": [1, 1], "mark": 9000, "trusted": true, "lost": 0})
    var d = ZbAlarmMerge.digest_of([a, b])
    check("the same copies, the same digest", ZbAlarmMerge.digest_of([a, b]), d)
    check("the order of the dots is part of it", ZbAlarmMerge.digest_of([b, a]) != d, true)
    check("and so is the number of heads", ZbAlarmMerge.digest_of([a]) != d, true)
    for other: [{"state": "armed_away", "dot": "2:2", "vv": {"2": 2}, "timeline": [2, 2], "mark": 500, "trusted": true, "lost": 0},
                {"state": "armed_away", "dot": "2:1", "vv": {"2": 1}, "timeline": [2, 3], "mark": 500, "trusted": true, "lost": 0},
                {"state": "armed_away", "dot": "2:1", "vv": {"2": 1}, "timeline": [2, 2], "mark": 501, "trusted": true, "lost": 0}]
        check("a dot, a timeline or a mark that differs changes it", ZbAlarmMerge.digest_of([spec_record(other), b]) != d, true)
    end
    var same = spec_record({"state": "disarmed", "dot": "2:1", "vv": {"1": 5, "2": 1}, "timeline": [2, 2], "mark": 500, "trusted": false, "lost": 3})
    check("the state, the trust, the lost and the vector are not in it: the same action in the same timeline and mark is the same copy", ZbAlarmMerge.digest_of([same, b]), d)
    var x1 = spec_record({"state": "armed_away", "dot": "2:1", "vv": {"2": 1}, "timeline": [2, 2], "mark": 500, "trusted": true, "lost": 0})
    var x2 = spec_record({"state": "armed_away", "dot": "2:1", "vv": {"2": 1}, "timeline": [1, 1], "mark": 900500, "trusted": true, "lost": 0})
    check("the same action in two timelines still shows that the replicas differ", ZbAlarmMerge.digest_of([x1]) != ZbAlarmMerge.digest_of([x2]), true)
end

# --- the pairwise rule -----------------------------------------------------------------------------------------------------------

def section_merge(v)
    for c: v["merge"]
        var a = spec_record(c["a"])
        var b = spec_record(c["b"])
        var x = ZbAlarmMerge.merge(a, b)
        var y = ZbAlarmMerge.merge(b, a)
        check("merge: " + c["name"], [label_of(x[0], a, b, c["win"]), x[1]], [c["win"], c["layer"]])
        check("merge, the copies the other way round: " + c["name"], [label_of(y[0], a, b, c["win"]), y[1]], [c["win"], c["layer"]])
    end
end

def count_keys(m)
    var n = 0
    for k: m.keys()
        n += 1
    end
    return n
end

def section_fuzz(v)
    var layers = {}
    var bad = 0
    var n = 0
    for c: v["mergeFuzz"]
        var a = spec_record(c["a"])
        var b = spec_record(c["b"])
        var x = ZbAlarmMerge.merge(a, b)
        var y = ZbAlarmMerge.merge(b, a)
        layers[c["layer"]] = true
        var good = label_of(x[0], a, b, c["win"]) == c["win"] && x[1] == c["layer"]
        good = good && y[0] == x[0] && y[1] == x[1]
        good = good && ZbAlarmMerge.merge(a, a)[0] == a
        if !good
            bad += 1
            print("FAIL mergeFuzz " + str(n) + " " + str(c["a"]) + " " + str(c["b"]) + " want " + c["win"] + "/" + c["layer"] + " got " + x[1])
        end
        n += 1
    end
    check("the 150 random pairs: the winner and the layer of the reference, symmetric and idempotent", [n, bad, count_keys(layers)], [150, 0, 5])
end

# --- the heads ---------------------------------------------------------------------------------------------------------------------

def permutations(n)
    if n <= 1
        var row = []
        for i: 0 .. n - 1
            row.push(i)
        end
        return [row]
    end
    var out = []
    for p: permutations(n - 1)
        for k: 0 .. n - 1
            var q = []
            for x: 0 .. k - 1
                q.push(p[x])
            end
            q.push(n - 1)
            for x: k .. n - 2
                q.push(p[x])
            end
            out.push(q)
        end
    end
    return out
end

# the heads of a list of specs, in the flash of a replica of this node (one in the house's timeline, adopted, with the counter ctr)
def steady_replica(id, ctr, specs, flash)
    flash.enter()
    var all = bytes(780)
    for s: specs
        all .. spec_record(s)
    end
    persist.setmember(ZbAlarmMerge.HEADS_KEY, all.tohex())
    persist.setmember(ZbAlarmMerge.CTR_KEY, ctr)
    persist.setmember(ZbAlarmMerge.EPOCH_KEY, 1)
    persist.save()
    var clock = MeshClock()
    var rep = ZbAlarmMerge(id, clock)
    rep.restore()
    rep.start_on(tl_bytes(1, 1), true)
    clock.adopted = true
    return rep
end

def run_heads_case(c, order)
    var fl = Flash()
    var rep = steady_replica(c["node"]["id"], c["node"]["ctr"], c["node"]["heads"], fl)
    var before = []
    for h: rep.heads
        before.push(h)
    end
    for i: order
        var batch = []
        for s: c["takes"][i]
            batch.push(spec_record(s))
        end
        rep.hear(batch)
    end
    if c.contains("act")
        rep.clock.up = c["act"]["up"]
        rep.act(c["act"]["kind"], 0)
    end
    var r = rep.record()
    var b = bytes(4)
    b.add(rep.digest(), -4)
    var got = {"heads": head_dots(rep), "state": rep.state(), "dot": dot_text(ZbAlarmMerge.dot_of(r)), "timeline": tl_pair(r),
               "mark": ZbAlarmMerge.mark_of(r), "vv": sparse_vv(r), "digest": hexs(b), "changed": !ZbAlarmMerge.same_heads(rep.heads, before)}
    fl.leave()
    return got
end

def section_heads(v)
    for c: v["heads"]
        var order = []
        for i: 0 .. size(c["takes"]) - 1
            order.push(i)
        end
        var got = run_heads_case(c, order)
        check("heads: " + c["name"], got, c["want"])
        if c["anyOrder"]
            for p: permutations(size(c["takes"]))
                check("heads in the order " + str(p) + ": " + c["name"], run_heads_case(c, p), got)
            end
        end
    end
end

# --- the epoch and the trust bit -----------------------------------------------------------------------------------------------------

def section_epoch(v)
    for c: v["epoch"]
        var fl = Flash()
        fl.enter()
        persist.setmember(ZbAlarmMerge.HEADS_KEY, spec_record({"state": "armed_away", "dot": "1:1", "vv": {"1": 1}, "timeline": [1, 1], "mark": 100800, "trusted": true, "lost": 0}).tohex())
        persist.setmember(ZbAlarmMerge.EPOCH_KEY, c["node"]["epoch"])
        persist.save()
        var got = []
        for b: c["boots"]
            persist.reboot()
            if !b["epochOk"] persist.fail_next() end
            var rep = ZbAlarmMerge(c["node"]["id"], MeshClock())
            var ok = rep.boot(b.find("epoch"))
            got.push({"timeline": [rep.tl[0], rep.tl.get(1, -4)], "saved": json.load(persist.written)[ZbAlarmMerge.EPOCH_KEY], "trusted": rep.trusted})
            check("boot says whether the epoch was saved: " + c["name"], ok, b["epochOk"])
        end
        check("epoch: " + c["name"], got, c["want"])
        fl.leave()
    end
end

# --- the timeline: the replica's side of an adoption ---------------------------------------------------------------------------------------

def section_timeline(v)
    for c: v["timeline"]
        var fl = Flash()
        fl.enter()
        var n = c["node"]
        persist.setmember(ZbAlarmMerge.HEADS_KEY, spec_record(n["record"]).tohex())
        persist.setmember(ZbAlarmMerge.CTR_KEY, 0)
        persist.setmember(ZbAlarmMerge.EPOCH_KEY, n["epoch"])
        persist.save()
        var clock = MeshClock()
        var rep = ZbAlarmMerge(n["id"], clock)
        rep.restore()
        if n.contains("tl")
            rep.start_on(tl_bytes(n["tl"][0], n["tl"][1]), true)
            clock.off = n["off"]
            clock.adopted = true
        else
            rep.start_life(n["epoch"], true)
        end
        clock.up = c["up"]
        var d = c["hello"]["mesh"] - clock.mesh()
        var adopted = mesh_hear(rep, clock, tl_bytes(c["hello"]["tl"][0], c["hello"]["tl"][1]), c["hello"]["mesh"])
        var r = rep.record()
        check("timeline: " + c["name"], {"adopted": adopted, "delta": adopted ? d : 0, "timeline": [rep.tl[0], rep.tl.get(1, -4)], "off": clock.off,
                                       "record": {"timeline": tl_pair(r), "mark": ZbAlarmMerge.mark_of(r)}}, c["want"])
        check("the heads are persisted as they were moved: " + c["name"], hexs(r) == string.tolower(json.load(persist.written)[ZbAlarmMerge.HEADS_KEY]), true)
        fl.leave()
    end
end

# --- the twelve situations and the findings' scripts -------------------------------------------------------------------------------------------

# what a power cut leaves: a replica made from the flash alone shows the same heads and the same state
def reread(n)
    n.enter()
    persist.reboot()
    var again = ZbAlarmMerge(n.id, n.clock)
    again.restore()
    n.leave()
    return again
end

def play(c, snapshot_key)
    var w = AlarmWorld(c["nodes"], c["base"])
    w.run(c["steps"])
    var want = c[snapshot_key]
    var got = []
    for n: w.nodes
        var d = describe(n.rep)
        d["node"] = n.name
        got.push(d)
        var again = reread(n)
        check(c["id"] + ": the flash of " + n.name + " holds the heads and the state it shows", [head_dots(again), again.state()], [head_dots(n.rep), n.rep.state()])
    end
    check(c["id"] + ": every replica's record, and the heads, as the reference has them", got, want)
    return w
end

def section_situations(v)
    for c: v["situations"]
        var w = play(c, "final")
        var states = w.states()
        var all = true
        for s: states
            if s != c["want"] all = false end
        end
        check(c["id"] + " " + c["title"] + ": every bridge ends " + c["want"], [all, states], [true, states])
    end
end

def section_hazards(v)
    for c: v["hazards"]
        var w = play(c, "decided")
        var states = w.states()
        var all = true
        for s: states
            if s != c["want"]["decided"] all = false end
        end
        check(c["id"] + ": the decided rule ends the house " + c["want"]["decided"], [all, states], [true, states])
    end
end

# --- what is the Berry side's own ------------------------------------------------------------------------------------------------------

# a record, its vector holding its own dot as the vectors always do
def rec_of(state, dot, vv, tl, mark)
    var d = parse_dot(dot)
    var own = str(d >> 20)
    var v = {}
    for k: vv.keys()
        v[k] = vv[k]
    end
    if !v.contains(own) || v[own] < (d & 0xFFFFF)
        v[own] = d & 0xFFFFF
    end
    return spec_record({"state": state, "dot": dot, "vv": v, "timeline": tl, "mark": mark, "trusted": true, "lost": 0})
end
# the initial record of the house, armed_away: dot 1:1, in the house's timeline [1, 1]
def base_spec()
    return {"state": "armed_away", "dot": "1:1", "vv": {"1": 1}, "timeline": [1, 1], "mark": 100800, "trusted": true, "lost": 0}
end
def flash_ctr() return json.load(persist.written)[ZbAlarmMerge.CTR_KEY] end
def flash_heads() return string.tolower(json.load(persist.written)[ZbAlarmMerge.HEADS_KEY]) end
def hex_of(records)
    var s = ""
    for h: records
        s += hexs(h)
    end
    return s
end
def heads_hex(rep) return hex_of(rep.heads) end
# the replica a boot builds from the flash as it is (a power cut, then a boot that saves its epoch)
def powered_again(id)
    persist.reboot()
    var rep = ZbAlarmMerge(id, MeshClock())
    rep.boot(nil)
    return rep
end

# a clock that looks at the flash at the instant the record is being built: after the counter was written, before the heads
class ProbeClock
    var seen_ctr, seen_heads
    def init()
        self.seen_ctr = nil
        self.seen_heads = nil
    end
    def ticks()
        var f = json.load(persist.written)
        self.seen_ctr = f[ZbAlarmMerge.CTR_KEY]
        self.seen_heads = string.tolower(f[ZbAlarmMerge.HEADS_KEY])
        return 777
    end
    def synced() return true end
end

# a clock that makes the next save, which is the heads', fail: the counter's has been written by then
class FailHeadsClock
    def ticks()
        persist.fail_next()
        return 888
    end
    def synced() return true end
end

def section_write_ahead()
    var fl = Flash()
    var rep = steady_replica(2, 0, [base_spec()], fl)
    var probe = ProbeClock()
    rep.clock = probe
    var before = flash_heads()
    var r = rep.act("armed_away", 2)
    check("the record is built after its counter is on the flash and before the heads are", [probe.seen_ctr, probe.seen_heads == before], [1, true])
    check("then the flash has the record, its counter and the heads", [flash_ctr(), flash_heads(), dot_text(ZbAlarmMerge.dot_of(r)), ZbAlarmMerge.lost_of(r), probe.seen_ctr], [1, hexs(r), "2:1", 2, 1])
    check("the record is the only head, at the mark the clock gave, in the life's timeline and trusted", [head_dots(rep), ZbAlarmMerge.mark_of(r), tl_pair(r), ZbAlarmMerge.trusted_of(r)], [["2:1"], 777, [1, 1], true])
    check("its vector is the join of the heads and its own counter", sparse_vv(r), {"1": 1, "2": 1})
    fl.leave()
end

def section_counter_fails()
    var fl = Flash()
    var rep = steady_replica(2, 0, [base_spec()], fl)
    var before = flash_heads()
    persist.fail_next()
    var r = rep.act("disarmed", nil)
    check("a counter that cannot be written makes no action: nil, the state, the heads and the flash as they were",
          [r, rep.state(), head_dots(rep), flash_ctr(), flash_heads() == before, rep.unsaved], [nil, "armed_away", ["1:1"], 0, true, false])
    var again = rep.act("disarmed", nil)
    check("the number was skipped, and the next action is 2:2 and writes it", [dot_text(ZbAlarmMerge.dot_of(again)), flash_ctr(), rep.state(), sparse_vv(again)], ["2:2", 2, "disarmed", {"1": 1, "2": 2}])
    fl.leave()
end

def section_heads_fail()
    var fl = Flash()
    var rep = steady_replica(2, 0, [base_spec()], fl)
    var before = flash_heads()
    rep.clock = FailHeadsClock()
    var r = rep.act("armed_home", 0)
    check("heads that cannot be written: the action stands in RAM, the counter is on the flash, the heads are not",
          [rep.state(), rep.unsaved, flash_ctr(), flash_heads() == before], ["armed_home", true, 1, true])
    var lost = powered_again(2)
    check("a power cut then loses the action and not its number: the next action is 2:2, above it",
          [lost.state(), lost.ctr, sparse_vv(lost.record()).find("2"), lost.vv[1]], ["armed_away", 1, nil, 1])
    var next = lost.act("armed_away", 0)
    check("and so the dot is not reused", dot_text(ZbAlarmMerge.dot_of(next)), "2:2")
    # the same RAM, flushed
    fl.leave()
    var fl2 = Flash()
    var rep2 = steady_replica(2, 0, [base_spec()], fl2)
    rep2.clock = FailHeadsClock()
    var r2 = rep2.act("armed_home", 0)
    persist.fail_next()
    check("a flush that fails says so, and keeps the heads in RAM", [rep2.flush(), rep2.unsaved], [false, true])
    check("a flush that works writes them, and clears the mark", [rep2.flush(), rep2.unsaved, flash_heads()], [true, false, hexs(r2)])
    check("and a power cut now keeps the action", [powered_again(2).state()], ["armed_home"])
    fl2.leave()
end

def section_hear_and_adopt_fail()
    var fl = Flash()
    var rep = steady_replica(2, 0, [base_spec()], fl)
    var before = flash_heads()
    var other = rec_of("disarmed", "3:1", {}, [1, 1], 120000)
    persist.fail_next()
    var res = rep.hear([other])
    check("copies taken whose heads cannot be written: taken, marked, and the flash is as it was",
          [res["changed"], res["heads"], head_dots(rep), rep.unsaved, flash_heads() == before], [true, 2, ["1:1", "3:1"], true, true])
    check("a flush writes them", [rep.flush(), flash_heads() == heads_hex(rep)], [true, true])
    var mine = rep.act("armed_away", 0)
    check("(the action that follows)", head_dots(rep), ["2:1"])
    var foreign = rec_of("armed_home", "5:1", {}, [9, 9], 50)
    rep.hear([foreign])
    var offered = rep.offer()
    var snapshot = heads_hex(rep)
    persist.fail_next()
    var moved = rep.adopted(tl_bytes(7, 7), 100)
    check("an adoption whose heads cannot be written moves what is in the old timeline, and marks the save",
          [moved, rep.unsaved, tl_pair(rep.heads[0]), tl_pair(rep.heads[1])], [1, true, [7, 7], [9, 9]])
    check("the copies offered before are not changed in place", heads_hex(rep) != snapshot && hexs(offered[0]) + hexs(offered[1]) == snapshot, true)
    check("a flush writes the moved heads", [rep.flush(), flash_heads() == heads_hex(rep)], [true, true])
    fl.leave()
end

def section_epoch_fails()
    var fl = Flash()
    fl.enter()
    persist.setmember(ZbAlarmMerge.EPOCH_KEY, 6)
    persist.save()
    persist.reboot()
    persist.fail_next()
    import crypto
    var d = crypto.drawn
    var rep = ZbAlarmMerge(4, MeshClock())
    var ok = rep.boot(nil)
    var want = (d << 24) | ((d + 1) << 16) | ((d + 2) << 8) | (d + 3)
    check("no epoch given and the write refused: the life draws a random one of 32 bits, is not trusted, and the flash keeps 6",
          [ok, rep.tl[0], rep.tl.get(1, -4), rep.trusted, json.load(persist.written)[ZbAlarmMerge.EPOCH_KEY], persist.find(ZbAlarmMerge.EPOCH_KEY)], [false, 4, want, false, 6, 6])
    # a record of such a life is never ordered by its mark (the finding F3)
    var mine = rep.act("armed_away", 0)
    var rival = ZbAlarmMerge.make(0, ZbAlarmMerge.dot(5, 1), spec_vv({"5": 1}), rep.tl, 0, true, 0)
    var m = ZbAlarmMerge.merge(mine, rival)
    check("it carries the trust bit clear, so a disarm of the same timeline that is OLDER by the mark still wins: the safe side", [ZbAlarmMerge.trusted_of(mine), m[1], ZbAlarmMerge.st_of(m[0])], [false, "safe", 0])
    # a boot after that counts from the saved epoch, and is trusted again
    var next = powered_again(4)
    check("the next boot counts from the saved epoch (7) and is trusted", [next.tl.get(1, -4), next.trusted, persist.find(ZbAlarmMerge.EPOCH_KEY)], [7, true, 7])
    fl.leave()
end

def section_restore_garbage()
    var good = spec_record(base_spec()).tohex()
    var junk = ""
    for i: 1 .. 104
        junk += "0"
    end
    var flag = spec_record(base_spec())
    flag[0] = flag[0] | 0x10
    var zz = ""
    for i: 1 .. 104
        zz += "Z"
    end
    var cases = [["nothing at all", nil, nil], ["a number", 5, "x"], ["a text of another size", "ABC", 7], ["a text that is not hex", zz, 7],
                 ["zeros", junk, 7], ["a record with a bit set that is zero", flag.tohex(), 7]]
    for c: cases
        var fl = Flash()
        fl.enter()
        if c[1] != nil persist.setmember(ZbAlarmMerge.HEADS_KEY, c[1]) end
        if c[2] != nil persist.setmember(ZbAlarmMerge.CTR_KEY, c[2]) end
        var rep = ZbAlarmMerge(3, MeshClock())
        rep.restore()
        check("what is not a record is not kept (" + c[0] + "): no heads, the safe state, the digest of nothing",
              [size(rep.heads), rep.state(), rep.record(), rep.digest(), rep.ctr], [0, "disarmed", nil, 0x811C9DC5, c[2] == 7 ? 7 : 0])
        fl.leave()
    end
    var fl = Flash()
    fl.enter()
    persist.setmember(ZbAlarmMerge.HEADS_KEY, good + junk)
    var rep = ZbAlarmMerge(3, MeshClock())
    rep.restore()
    check("a good record followed by junk keeps the good one", [head_dots(rep), rep.state()], [["1:1"], "armed_away"])
    persist.setmember(ZbAlarmMerge.HEADS_KEY, good + good)
    rep.restore()
    check("the same record twice is one head", head_dots(rep), ["1:1"])
    fl.leave()
    var fl_empty = Flash()
    fl_empty.enter()
    var empty = ZbAlarmMerge(3, MeshClock())
    empty.boot(nil)
    check("a first boot, with an empty flash: no heads, epoch 1, counter 0, and it writes the epoch",
          [size(empty.heads), empty.tl.get(1, -4), empty.ctr, empty.trusted, json.load(persist.written)[ZbAlarmMerge.EPOCH_KEY]], [0, 1, 0, true, 1])
    check("and an act on it is its first action, over a vector of its own counter alone", [dot_text(ZbAlarmMerge.dot_of(empty.act("armed_home", 0))), empty.state(), sparse_vv(empty.record())], ["3:1", "armed_home", {"3": 1}])
    fl_empty.leave()
end

def section_fifteen_heads()
    var fl = Flash()
    var rep = steady_replica(1, 1, [base_spec()], fl)
    var recs = []
    for n: 2 .. 15
        recs.push(rec_of(n % 2 == 0 ? "armed_away" : "disarmed", str(n) + ":1", {}, [n, 1], n * 100))
    end
    var res = rep.hear(recs)
    check("fifteen bridges that never met: fifteen heads, one each", [res["changed"], res["heads"], size(rep.heads), res["bad"]], [true, 15, 15, 0])
    var text = json.load(persist.written)[ZbAlarmMerge.HEADS_KEY]
    check("the worst case in the flash: 15 x 52 = 780 bytes, as hex 1560 characters, and in RAM 780 bytes of records",
          [size(text), size(bytes(text)), 15 * size(rep.heads[0])], [1560, 780, 780])
    var hello = ZbAlarmMerge.decode_hello(rep.hello(0, 0, 0))
    check("the heartbeat says 15 heads and the digest of them", [hello["count"], hello["digest"] == rep.digest()], [15, true])
    var state = rep.state()
    var digest = rep.digest()
    # the same fifteen, offered in another order and in pieces, to another replica (which holds one of them)
    fl.leave()
    var other_fl = Flash()
    var other = steady_replica(9, 0, [{"state": "disarmed", "dot": "9:1", "vv": {"9": 1}, "timeline": [9, 1], "mark": 900, "trusted": true, "lost": 0}], other_fl)
    var back = []
    for i: 0 .. size(rep.heads) - 1
        back.push(rep.heads[size(rep.heads) - 1 - i])
    end
    other.hear(back[0 .. 3])
    other.hear(back[4 .. 14])
    check("another replica that takes them in another order, in two pieces, shows the same state and the same digest", [other.state(), other.digest(), size(other.heads)], [state, digest, 15])
    other_fl.leave()
    # the heads survive a power cut whole
    fl.enter()
    persist.reboot()
    var again = ZbAlarmMerge(1, MeshClock())
    again.restore()
    check("fifteen heads come back from the flash, and the state with them", [heads_hex(again) == heads_hex(rep), again.state(), again.digest()], [true, state, digest])
    # two records of every node: the later descends the earlier, so there are still fifteen heads
    var seconds = []
    for n: 1 .. 15
        seconds.push(rec_of("armed_home", str(n) + ":2", {}, [n, 1], n * 100 + 50))
    end
    again.hear(seconds)
    check("a node's later action descends its earlier ones, so thirty records are fifteen heads", [size(again.heads), ZbAlarmMerge.vv_at(again.heads[0], 0)], [15, 2])
    # an action here descends every head (the copies said node 1 did 1:2, so its next action is 1:3)
    var act = again.act("disarmed", 0)
    check("an action descends all fifteen: one head, and its vector holds every counter",
          [size(again.heads), dot_text(ZbAlarmMerge.dot_of(act)), ZbAlarmMerge.vv_at(act, 0), ZbAlarmMerge.vv_at(act, 14), ZbAlarmMerge.vv_at(act, 7)], [1, "1:3", 3, 2, 2])
    check("the flash is back to one record", size(json.load(persist.written)[ZbAlarmMerge.HEADS_KEY]), 104)
    fl.leave()
    # copies that are not records, or that are not a history, change nothing
    var fl3 = Flash()
    var rep3 = steady_replica(2, 0, [base_spec()], fl3)
    var saves = persist.saves
    var ring_a = rec_of("armed_away", "1:5", {"2": 3}, [1, 1], 5)
    var ring_b = rec_of("disarmed", "2:3", {"1": 5}, [1, 1], 6)
    check("two records that each have the other in their past are not a history", [ZbAlarmMerge.descends(ring_a, ring_b), ZbAlarmMerge.descends(ring_b, ring_a), size(ZbAlarmMerge.heads_of([ring_a, ring_b]))], [true, true, 0])
    var cut = ring_a[0 .. 50]
    var res3 = rep3.hear([ring_a, ring_b, cut])
    check("a loop in the pasts is left out whole, the cut one counts as bad, and nothing is written",
          [res3["changed"], res3["bad"], head_dots(rep3), persist.saves == saves, rep3.state()], [false, 1, ["1:1"], true, "armed_away"])
    var res4 = rep3.hear([cut, bytes()])
    check("copies none of which is a record change nothing", [res4["changed"], res4["bad"], res4["heads"]], [false, 2, 1])
    var res5 = rep3.hear(rec_of("armed_away", "1:1", {"1": 1}, [1, 1], 100800))
    check("a single record, not in a list, is taken as one: the same copy again is no change and writes nothing", [res5["changed"], res5["bad"], persist.saves == saves], [false, 0, true])
    fl3.leave()
end

def section_own_counter_ahead()
    var fl = Flash()
    var rep = steady_replica(2, 0, [base_spec()], fl)
    var future = rec_of("armed_away", "2:9", {"1": 1}, [1, 1], 120000)
    rep.hear([future])
    check("a copy that says node 2 did nine actions, when the flash says none, lifts the counter", [rep.ctr, rep.vv[1]], [9, 9])
    var next = rep.act("disarmed", 0)
    check("and the next dot is above it", dot_text(ZbAlarmMerge.dot_of(next)), "2:10")
    var cold = steady_replica(2, 0, [base_spec(), {"state": "armed_away", "dot": "2:4", "vv": {"2": 4}, "timeline": [1, 1], "mark": 100900, "trusted": true, "lost": 0}], Flash())
    check("a boot whose flash lost the counter but kept a head of its own: the counter is not below what the heads say", [cold.ctr, cold.vv[1]], [4, 4])
    var again = cold.act("armed_home", 0)
    check("the next dot is 2:5", dot_text(ZbAlarmMerge.dot_of(again)), "2:5")
    fl.leave()
end

def section_act_checks()
    var fl = Flash()
    var rep = steady_replica(2, 0, [base_spec()], fl)
    var raised = []
    for bad: ["explode", 4, -1, nil]
        try
            rep.act(bad, 0)
            raised.push("did not raise")
        except .. as e, m
            raised.push(e)
        end
    end
    check("an action that is not one of the four states raises, and changes nothing", [raised, rep.ctr, head_dots(rep)], [["value_error", "value_error", "value_error", "value_error"], 0, ["1:1"]])
    var by_number = rep.act(3, 0)
    check("a state may be named by its number: 3 is triggered", [rep.state(), ZbAlarmMerge.st_of(by_number)], ["triggered", 3])
    rep.ctr = ZbAlarmMerge.MAX_COUNTER
    var err = nil
    try
        rep.act("disarmed", 0)
    except .. as e, m
        err = e
    end
    check("a counter of 20 bits that is used up raises, and the state is as it was", [err, rep.state()], ["value_error", "triggered"])
    var odd = []
    for n: [0, 16, -3]
        try
            ZbAlarmMerge(n, MeshClock())
            odd.push("made")
        except .. as e, m
            odd.push(e)
        end
    end
    check("a replica is node 1 to 15", odd, ["value_error", "value_error", "value_error"])
    fl.leave()
end

def section_adopted()
    var fl = Flash()
    fl.enter()
    # a node that booted alone (epoch 2: timeline [2, 2]) holds its own record, 5 ticks before the mark counter wraps, and a foreign one
    var mine = rec_of("disarmed", "2:1", {"2": 1}, [2, 2], -5)
    var foreign = rec_of("armed_away", "3:1", {"3": 1}, [9, 9], 5000)
    persist.setmember(ZbAlarmMerge.HEADS_KEY, mine.tohex() + foreign.tohex())
    persist.setmember(ZbAlarmMerge.CTR_KEY, 1)
    persist.setmember(ZbAlarmMerge.EPOCH_KEY, 2)
    persist.save()
    var rep = ZbAlarmMerge(2, MeshClock())
    rep.restore()
    rep.start_life(2, true)
    var digest = rep.digest()
    var older = rep.offer()
    check("a node's own timeline is [its number, its epoch]", tl_pair(rep.heads[0]), [2, 2])
    check("adopting the timeline it already has changes nothing", [rep.adopted(tl_bytes(2, 2), 77), rep.digest() == digest], [0, true])
    var moved = rep.adopted(tl_bytes(1, 1), 10)
    var h = rep.heads
    check("the head made in the timeline it leaves moves to the new one, its mark 10 ticks on, across the wrap (-5 + 10 = 5); the foreign head, made in a timeline that is over, is not touched",
          [moved, rep.tl == tl_bytes(1, 1), tl_pair(h[0]), ZbAlarmMerge.mark_of(h[0]), tl_pair(h[1]), ZbAlarmMerge.mark_of(h[1])], [1, true, [1, 1], 5, [9, 9], 5000])
    check("what moved is the same action: the dot, the state, the vector and the trust are as they were",
          [ZbAlarmMerge.dot_of(h[0]), ZbAlarmMerge.st_of(h[0]), sparse_vv(h[0]), ZbAlarmMerge.trusted_of(h[0])], [ZbAlarmMerge.dot(2, 1), 0, {"2": 1}, true])
    check("the digest changes (the timeline and the mark are in it), and the old copies are as they were", [rep.digest() != digest, hexs(older[0]) == hexs(mine), tl_pair(older[0])], [true, true, [2, 2]])
    check("the flash has the moved heads", flash_heads() == heads_hex(rep), true)
    var moved_again = rep.adopted(tl_bytes(1, 1), 99)
    check("hearing the same timeline again is no adoption", [moved_again, ZbAlarmMerge.mark_of(rep.heads[0])], [0, 5])
    check("a new action is made in the timeline adopted, at the clock's mark", tl_pair(rep.act("armed_home", 0)), [1, 1])
    fl.leave()
end

# a life on a timeline the caller names (the mesh's: [the mesh's number, the epoch]), which a replica on the mesh uses instead of
# assigning the timeline from outside after start_life() made [the alarm number, the epoch]
def section_start_on()
    var fl = Flash()
    fl.enter()
    var mine = rec_of("armed_away", "2:3", {"2": 3}, [2, 2], 400)
    persist.setmember(ZbAlarmMerge.HEADS_KEY, mine.tohex())
    persist.setmember(ZbAlarmMerge.CTR_KEY, 1)
    persist.save()
    var rep = ZbAlarmMerge(2, MeshClock())
    rep.restore()
    var t = tl_bytes(7, 0x80000005)
    rep.start_on(t, true)
    check("a life on the mesh's timeline: it is that one ([7, epoch]) and not [the alarm number, the epoch], and it is trusted",
          [rep.tl == tl_bytes(7, 0x80000005), rep.tl[0], rep.timeline() == rep.tl, rep.trusted], [true, 7, true, true])
    check("the vector is rebuilt from the heads as start_life does: the counter is not below the head's own", [rep.ctr, rep.vv[1]], [3, 3])
    t.set(0, 9, 1)
    check("the timeline is kept as a copy: the caller's bytes may change", [rep.tl == tl_bytes(7, 0x80000005), t[0]], [true, 9])
    var made = rep.act("disarmed", 0)
    check("an action after it is in that timeline, trusted, and the head made in the timeline the life began in is not moved",
          [ZbAlarmMerge.tl_is(made, tl_bytes(7, 0x80000005)), ZbAlarmMerge.trusted_of(made), dot_text(ZbAlarmMerge.dot_of(made)), head_dots(rep)], [true, true, "2:4", ["2:4"]])
    rep.start_on(tl_bytes(7, 6), false)
    var loose = rep.act("armed_home", 0)
    check("a life that is not trusted makes records with the trust bit clear, in the timeline it was given",
          [ZbAlarmMerge.tl_is(loose, tl_bytes(7, 6)), ZbAlarmMerge.trusted_of(loose), rep.trusted], [true, false, false])
    var seen = []
    for bad: [bytes(-4), bytes(-6), bytes(), "0700000005", nil, [7, 0, 0, 0, 5]]
        try
            rep.start_on(bad, true)
            seen.push("did not raise")
        except .. as e, m
            seen.push(e)
        end
    end
    check("what is not 5 bytes is refused, and the life is as it was", [seen, rep.tl == tl_bytes(7, 6), rep.trusted],
          [["value_error", "value_error", "value_error", "value_error", "value_error", "value_error"], true, false])
    var a = ZbAlarmMerge(3, MeshClock())
    a.start_life(9, true)
    var b = ZbAlarmMerge(3, MeshClock())
    b.start_on(tl_bytes(3, 9), true)
    check("start_life(epoch) is start_on([the node's number, the epoch]), and keeps a trust of false", [a.tl == b.tl, a.trusted == b.trusted, a.tl == tl_bytes(3, 9)], [true, true, true])
    a.start_life(0xFFFFFFFE, false)
    check("an epoch with the top bit set is written as its 4 bytes, and the trust it was given is kept", [hexs(a.tl), a.trusted], ["03fffffffe", false])
    fl.leave()
end

def section_hello_of_replica()
    var fl = Flash()
    var rep = steady_replica(3, 0, [base_spec()], fl)
    rep.clock.up = 20000
    var h = ZbAlarmMerge.decode_hello(rep.hello(0x1234, 0x56789ABC, ZbAlarmMerge.dot(3, 7)))
    check("the heartbeat's part: the timeline, the mesh time the C side gave, the digest of the heads, the applied dot and the sign of synced",
          [h["tl"] == rep.tl, h["hi"], h["lo"], h["digest"] == rep.digest(), dot_text(h["applied"]), h["synced"], h["count"]], [true, 0x1234, 0x56789ABC, true, "3:7", true, 1])
    rep.clock.up = 100
    rep.clock.adopted = false
    var h2 = ZbAlarmMerge.decode_hello(rep.hello(0, 0, 0))
    check("a node that has not adopted a timeline and has not listened long enough says it is not synced", [h2["synced"], h2["applied"]], [false, 0])
    check("a replica with no heads says none, and the digest of none", [ZbAlarmMerge.decode_hello(ZbAlarmMerge(5, MeshClock()).hello(0, 0, 0))["count"], ZbAlarmMerge(5, MeshClock()).digest()], [0, 0x811C9DC5])
    fl.leave()
end

def section_unsigned_timelines()
    # epochs of 32 bits are compared as unsigned, whatever a Berry int does with the top bit
    var low = ZbAlarmMerge.make(0, ZbAlarmMerge.dot(2, 1), spec_vv({"2": 1}), tl_bytes(1, 1), 500, true, 0)
    var high = ZbAlarmMerge.make(0, ZbAlarmMerge.dot(2, 1), spec_vv({"2": 1}), tl_bytes(1, 0x80000000), 500, true, 0)
    var top = ZbAlarmMerge.make(0, ZbAlarmMerge.dot(2, 1), spec_vv({"2": 1}), tl_bytes(1, 0xFFFFFFFF), 500, true, 0)
    check("the same action, equal marks: the smaller timeline id, by the unsigned epoch", [ZbAlarmMerge.merge(low, high)[0] == low, ZbAlarmMerge.merge(high, low)[0] == low, ZbAlarmMerge.merge(top, high)[0] == high, ZbAlarmMerge.merge(top, low)[0] == low], [true, true, true, true])
    check("the timeline order is the node first, then the epoch", [ZbAlarmMerge.tl_cmp(low, high) < 0, ZbAlarmMerge.tl_cmp(high, top) < 0, ZbAlarmMerge.tl_cmp(top, low) > 0, ZbAlarmMerge.tl_cmp(low, low)], [true, true, true, 0])
    var node2 = ZbAlarmMerge.make(0, ZbAlarmMerge.dot(2, 1), spec_vv({"2": 1}), tl_bytes(2, 0), 500, true, 0)
    check("a larger node outranks any epoch", ZbAlarmMerge.tl_cmp(node2, top) > 0, true)
end

def section_records_are_values()
    var fl = Flash()
    var rep = steady_replica(2, 0, [base_spec()], fl)
    var copy = rec_of("disarmed", "3:1", {}, [1, 1], 120000)
    var wire = hexs(copy)
    rep.hear([copy])
    var offered = rep.offer()
    offered.push(copy)
    offered.remove(0)
    check("the list offered is a copy: changing it does not change the replica", [size(rep.heads), size(offered)], [2, 2])
    check("a record taken is not changed by the replica", hexs(copy), wire)
    fl.leave()
end

# a small generator, so the random sets are the same on every run and on both VMs
class Rng
    var s
    def init(seed) self.s = seed end
    def next(n)
        self.s = (self.s * 1103515245 + 12345) & 0x7FFFFFFF
        return (self.s >> 8) % n
    end
end

# a history of count actions of 4 nodes, as honest bridges make them: each action's vector is the join of what its node had seen, which is its
# own previous action and a random few others, and its own counter. Marks near zero and near the wrap, two timelines, trust mostly set
def random_history(rng, count)
    var recs = []
    var last = {}
    var counters = [0, 0, 0, 0]
    for i: 1 .. count
        var node = 1 + rng.next(4)
        counters[node - 1] += 1
        var vec = ZbAlarmMerge.zeros()
        if last.contains(node) ZbAlarmMerge.join(vec, recs[last[node]]) end
        for r: recs
            if rng.next(10) < 3 ZbAlarmMerge.join(vec, r) end
        end
        vec[node - 1] = counters[node - 1]
        var mark = [100, 100, 5, -6][rng.next(4)] + 50 * rng.next(2)
        recs.push(ZbAlarmMerge.make(rng.next(4), ZbAlarmMerge.dot(node, counters[node - 1]), vec, tl_bytes(1 + rng.next(2), 1), mark, rng.next(100) < 85, 0))
        last[node] = size(recs) - 1
    end
    return recs
end

# copies in any order and in any pieces: the same heads, the same state, the same digest (the finding F2: the pairwise winner is not an
# order, so only causality may discard). The records are honest ones: a vector that is the join of its past is what makes "descends"
# transitive, and so makes the heads a function of the set that no order of arrival can change (a record whose vector is not closed
# could be dropped by one that was itself dropped, and come back: not a history, and not a thing bridges that save their counters make)
def section_order_independence()
    var fl = Flash()
    fl.enter()
    var rng = Rng(2026)
    var used = 0
    var multi = 0
    var bad = 0
    for iter: 1 .. 150
        var history = random_history(rng, 3 + rng.next(6))
        var recs = []
        for r: history
            if rng.next(10) < 7 recs.push(r) end
        end
        if size(recs) < 2 continue end
        used += 1
        var by_rule = ZbAlarmMerge.heads_of(recs)
        if size(by_rule) > 1 multi += 1 end
        var one = ZbAlarmMerge(1, MeshClock())
        one.hear(recs)
        var two = ZbAlarmMerge(1, MeshClock())
        var order = []
        for i: 0 .. size(recs) - 1
            order.push(i)
        end
        var shuffled = []
        while size(order) > 0
            shuffled.push(order.pop(rng.next(size(order))))
        end
        var at = 0
        while at < size(shuffled)
            var take = 1 + rng.next(3)
            var piece = []
            for k: at .. at + take - 1
                if k < size(shuffled) piece.push(recs[shuffled[k]]) end
            end
            two.hear(piece)
            at += take
        end
        var same = heads_hex(one) == heads_hex(two) && heads_hex(one) == hex_of(by_rule)
        same = same && one.state() == two.state() && one.digest() == two.digest() && ZbAlarmMerge.resolve(by_rule) == one.record()
        for h: one.heads
            for g: one.heads
                if ZbAlarmMerge.descends(g, h) same = false end
            end
        end
        if !same
            bad += 1
            print("FAIL order " + str(iter) + ": " + heads_hex(one) + " against " + heads_hex(two))
        end
    end
    check("150 random sets of honest copies, in a shuffled order and in pieces: the same heads, state and digest as the one rule, and no head descends from another", [bad, used > 120, multi > 30], [0, true, true])
    fl.leave()
end

# the same sets, with a record whose vector is NOT the join of its past: what the replica does is the reference's (only causality discards), and
# the order of arrival can then matter. Written down so that it is known, not to be relied on: the three records are Y, X (which descends Y) and Z
# (which descends X and does not say it has seen Y)
def section_open_vector()
    var fl = Flash()
    fl.enter()
    var y = rec_of("armed_away", "1:1", {}, [1, 1], 100)
    var x = rec_of("disarmed", "2:1", {"1": 1}, [1, 1], 200)
    var z = rec_of("armed_home", "3:1", {"2": 1}, [1, 1], 300)
    var all_at_once = ZbAlarmMerge(4, MeshClock())
    all_at_once.hear([y, x, z])
    var by_steps = ZbAlarmMerge(4, MeshClock())
    by_steps.hear([x])
    by_steps.hear([z])
    by_steps.hear([y])
    check("a vector that does not hold its past (Z descends X, which descends Y, and Z does not descend Y): all at once Y is below X, one by one it is a head again",
          [head_dots(all_at_once), head_dots(by_steps)], [["3:1"], ["1:1", "3:1"]])
    fl.leave()
end

# no wall clock is read: the class names none in its code, and runs a whole life with `tasmota` a stand-in that raises on any use
class Forbidden
    def member(k)
        raise "wall_clock", "the alarm used tasmota." + k
    end
end

def code_of(src)
    var out = []
    for line: string.split(src, "\n")
        var p = string.find(line, "#")
        if p == 0
            line = ""
        elif p > 0
            line = line[0 .. p - 1]
        end
        out.push(line)
    end
    return out.concat("\n")
end

def section_no_wall_clock()
    var code = code_of(read_text("berry/zbbridge_alarm_merge.be"))
    var named = []
    for token: ["tasmota", "rtc", "utc", "millis", "strftime", "strptime", "time_dump", "import os", "import time", "os.", "time.", "date"]
        if string.find(code, token) >= 0 named.push(token) end
    end
    check("the class's code names no wall clock, no uptime and no module of time", named, [])
    var kept = tasmota
    tasmota = Forbidden()
    var fl = Flash()
    var err = nil
    var state = nil
    try
        var rep = steady_replica(2, 0, [base_spec()], fl)
        rep.boot(nil)
        rep.act("armed_home", 1)
        rep.hear([rec_of("disarmed", "3:1", {}, [9, 9], 5)])
        rep.adopted(tl_bytes(1, 5), 40)
        rep.hello(0, 0, 0)
        rep.digest()
        rep.flush()
        rep.state()
        persist.fail_next()
        rep.boot(nil)
        state = rep.state()
    except .. as e, m
        err = e + ": " + m
    end
    tasmota = kept
    check("a whole life (boot, act, hear, an adoption, the heartbeat, a boot that cannot save) never touches tasmota", [err, state != nil], [nil, true])
    fl.leave()
end

# what a replica of 15 heads costs in RAM, in bytes allocated. The number is the VM's (the WebAssembly one is 32-bit as the ESP32 is, the
# vendored one is 64-bit, and the two outputs are compared line by line), so it is not printed: it is held under a ceiling.
# Measured: 15 heads 2 178 bytes on the WebAssembly VM (the object alone 453, one head 568), 3 442 on the vendored one
def section_heap()
    var fl = Flash()
    var rep = steady_replica(1, 1, [base_spec()], fl)
    var recs = []
    for n: 2 .. 15
        recs.push(rec_of("armed_away", str(n) + ":1", {}, [n, 1], n * 100))
    end
    rep.hear(recs)
    var before = tasmota.gc()
    var one = ZbAlarmMerge(1, MeshClock())
    one.restore()
    one.start_life(3, true)
    var after = tasmota.gc()
    check("a replica of 15 heads holds less than 4 KB (780 bytes of records and what an object costs), on either VM", after - before < 4096, true)
    var fl1 = Flash()
    var solo = steady_replica(2, 0, [base_spec()], fl1)
    var before1 = tasmota.gc()
    var solo2 = ZbAlarmMerge(2, MeshClock())
    solo2.restore()
    solo2.start_life(3, true)
    var after1 = tasmota.gc()
    check("and one head is less than that", after1 - before1 < after - before, true)
    fl1.leave()
    fl.leave()
end

def run_all()
    var v = read_vectors()
    section_dots_and_records(v)
    section_invalid_records(v)
    section_vector_packing(v)
    section_hello(v)
    section_digest(v)
    section_merge(v)
    section_fuzz(v)
    section_heads(v)
    section_epoch(v)
    section_timeline(v)
    section_situations(v)
    section_hazards(v)
    section_write_ahead()
    section_counter_fails()
    section_heads_fail()
    section_hear_and_adopt_fail()
    section_epoch_fails()
    section_restore_garbage()
    section_fifteen_heads()
    section_own_counter_ahead()
    section_act_checks()
    section_adopted()
    section_start_on()
    section_hello_of_replica()
    section_unsigned_timelines()
    section_records_are_values()
    section_order_independence()
    section_open_vector()
    section_no_wall_clock()
    section_heap()
end
run_all()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
