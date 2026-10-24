# zbbridge_alarm_merge.be -- the replica of the house alarm's state on ONE bridge, and the rule that says which copy
# wins when the copies of the bridges meet. It is the
# Berry side of libs/nspanel-sim/vm/test/alarm-merge-ref.mjs, the reference implementation, and answers the vectors in
# berry/test/vectors/alarm_merge.json bit by bit. Pure logic: it reads no clock of its own, and above all no wall clock
# (no tasmota.rtc, no os or time module: the date and the NTP are for the glass and the schedule, never for the alarm).
#
# THE STATE is a set of HEADS, not one copy: every record that nothing the replica has seen descends from (usually one,
# a few while a conflict is open, never more than 15, one per bridge). ONLY CAUSALITY DISCARDS a copy. The state the
# replica shows and acts on is the rule of three layers folded, pair by pair, over the heads in the order of their dots:
#   1. causality: a record that DESCENDS from another (its version vector has gone past the other's counter, vv[node of x]
#      >= counter of x: exact, no window) replaces it, with no clock at all;
#   2. a relative clock: inside ONE timeline, between two trusted marks, the later mark wins (equal marks: the safe side);
#   3. the safe side: what cannot be placed (two timelines, an untrusted mark) falls to the disarmed.
# Two replicas that hold the same heads show the same state, in whatever order the copies reached them.
#
# A RECORD is 52 bytes, always, kept and sent as they are (a `bytes`, never changed in place, here or by the caller):
#   byte 0       flags: bits 0-1 the state (0 disarmed, 1 armed_home, 2 armed_away, 3 triggered), bit 2 trust, 3-7 zero
#   bytes 1-3    the dot, big-endian: node (1..15) << 20 | counter (1..1 048 575). It names ONE action, forever
#   bytes 4-8    the timeline id: the node that began it (1 byte) and the mesh epoch of that node's life (4 bytes, big-endian)
#   bytes 9-12   the mark: the time of the action inside the timeline, in ticks of 100 ms, a uint32 that wraps. A Berry int
#                is 32 bits and signed, so it is held as the signed int with the same bits and two marks are compared by
#                their difference (right while less than 6.8 years apart)
#   byte 13      the number of devices the alarm could not protect when this ARM was made; 0 in any other action
#   bytes 14-51  the version vector: 15 counters of 20 bits, MSB first (counter i is node i+1's; the last 4 bits are zero)
# The trust bit says "the timeline id of this record is certainly unique": 0 for a life whose epoch could not be written to
# the flash before it was used (a random one was taken), and such a record is never ordered by its mark.
#
# WHAT THE C SIDE OF THE MESH KEEPS, AND WHAT THIS CLASS NEEDS FROM IT (a `clock` the bridge gives it):
#   clock.ticks()    the mesh time now, in ticks of 100 ms, a uint32 held as a signed Berry int (floor(mesh ms / 100))
#   clock.synced()   the node adopted a timeline, or listened long enough to conclude it is alone
# and an EVENT, when the mesh adopts the timeline of a node that has been up longer (the 20 ms band of two timelines of
# the same age, the follow of a larger mesh time inside a timeline, and the 48-bit mesh time are all the C side's):
#   adopted(new_tl, ticks)   new_tl: the 5 bytes of the timeline id; ticks: the difference of the two mesh times, in ticks
#                            of 100 ms, rounded (what the heads made in the timeline just left are moved by)
# The timeline id itself is this class's own (it is derived from the epoch the class persists, boot(), or given to
# start_life(epoch, ok): [this node's number, the epoch]), or the C side's (start_on(tl, ok), when the mesh driver owns the
# timeline: [the mesh's number, the epoch]): either way timeline() is what the heartbeat carries.
#
# WHAT IT PERSISTS (the keys of the persist map; the order of the writes is the point):
#   zb_alarm_ctr     the dot counter, written BEFORE the action it names exists (a dot that came twice would be ONE action to
#                    everybody): act() refuses with nil when the write fails, and the number is skipped
#   zb_alarm_epoch   the boot epoch, written before it is used; when the write fails the life takes a random 32-bit epoch,
#                    the saved counter is left alone (the next boot counts from it) and the trust bit stays clear
#   zb_alarm_heads   the heads, as hex, one record after the other (at most 15 x 104 characters), written whenever they change
# At a boot the version vector of the node is rebuilt: the join of the heads' vectors and the node's own counter, which is
# never below what any copy has seen of it.
#
# THE OPERATIONS, in the order the bridge calls them (what comes before the persist is lost in a power cut):
#   boot / start_life   at start: read the persisted heads and counter, take the epoch, own timeline [id, epoch]
#   start_on(tl, ok)    the same life on a timeline the caller names (the mesh's: [mesh number, epoch])
#   hear(copies)        copies of another bridge arrive (the answer to a difference of digests): the union of my heads and
#                       theirs, whatever one of them descends from goes, persist the heads, join the vectors
#   adopted(tl, ticks)  the C side adopted a timeline: what this node did in the old one moves with it
#   act(kind, lost)     a person arms or disarms, a sensor trips: counter, persist, THEN the record, which descends from every
#                       head and is the only head, persisted
#   state() / record()  the state shown: the pairwise rule folded over the heads
#   digest() / hello()  what the heartbeat says of the heads: the FNV-1a of each head's dot, timeline and mark; a neighbour
#                       whose digest differs asks for the heads (offer())
#   flush()             a save of the heads that fell over is tried again (the action stands in RAM meanwhile)
#
# WHERE IT PARTS FROM THE REFERENCE, ON PURPOSE: a copy that carries a counter of THIS node above its own (the flash lost it) lifts
# the counter, so the next dot is above what any copy has seen. (What is a record is the reference's too: a dot of node 1..15 and
# counter 1 or more, as the section "invalid" of the vectors says, byte by byte.) AND WHAT IT ASSUMES, like the reference: that the
# vector of a record is the join of its past, which every honest bridge's is (hear() joins the vector of every copy, even one that
# loses). The heads are then a function of the set of copies and no order of arrival changes them; a record that breaks it can make
# the order matter (berry/test/test_zbbridge_alarm_merge.be shows it).
#
# Loaded with load() before zbbridge_alarm.be on the bridge, where the firmware compiles it in.

#@ solidify:ZbAlarmMerge
class ZbAlarmMerge
    static HEADS_KEY = "zb_alarm_heads"
    static CTR_KEY = "zb_alarm_ctr"
    static EPOCH_KEY = "zb_alarm_epoch"
    static MAX_NODE = 15
    static MAX_COUNTER = 0xFFFFF
    static RECORD_BYTES = 52
    static HELLO_BYTES = 19
    static STATES = ["disarmed", "armed_home", "armed_away", "triggered"]

    var id         # this bridge's number in the mesh, 1..15
    var clock      # ticks() and synced(), from the mesh
    var tl         # the timeline of this life, 5 bytes: the node and the epoch (or the one the mesh adopted)
    var trusted    # the epoch of this life was written to the flash before use
    var ctr        # the dot counter: the last one used (or skipped)
    var vv         # the version vector of the node, 15 counters
    var heads      # the heads, records of 52 bytes, sorted by dot
    var shown      # the state of the heads, resolved, or nil until asked
    var unsaved    # the heads changed in RAM and the flash does not have them yet

    def init(id, clock)
        if id < 1 || id > ZbAlarmMerge.MAX_NODE
            raise "value_error", "an alarm replica is node 1 to 15, not " + str(id)
        end
        self.id = id
        self.clock = clock
        self.tl = bytes(-5)
        self.trusted = false
        self.ctr = 0
        self.vv = ZbAlarmMerge.zeros()
        self.heads = []
        self.shown = nil
        self.unsaved = false
    end

    # --- the record: its fields, its bytes -------------------------------------------------------------------------

    static def zeros() return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] end
    # a dot: the node and its counter
    static def dot(node, counter) return (node << 20) | counter end
    static def st_of(r) return r[0] & 3 end
    static def trusted_of(r) return (r[0] & 4) != 0 end
    static def dot_of(r) return (r[1] << 16) | (r[2] << 8) | r[3] end
    static def tl_of(r) return r[4 .. 8] end
    static def mark_of(r) return r.get(9, -4) end
    static def lost_of(r) return r[13] end

    # the counter i (0 to 14) of the record's version vector: node i+1's
    static def vv_at(r, i)
        var o = 14 + (i >> 1) * 5
        if (i & 1) == 0
            return (r[o] << 12) | (r[o + 1] << 4) | (r[o + 2] >> 4)
        end
        return ((r[o + 2] & 15) << 16) | (r[o + 3] << 8) | r[o + 4]
    end

    # the 38 bytes of a version vector (15 counters of 20 bits), added to out
    static def pack_vv(out, v)
        var k = 0
        while k < 14
            var a = v[k]
            var c = v[k + 1]
            out.add(a >> 12, 1)
            out.add((a >> 4) & 255, 1)
            out.add(((a & 15) << 4) | (c >> 16), 1)
            out.add((c >> 8) & 255, 1)
            out.add(c & 255, 1)
            k += 2
        end
        var z = v[14]
        out.add(z >> 12, 1)
        out.add((z >> 4) & 255, 1)
        out.add((z & 15) << 4, 1)
    end

    # a record: st 0 to 3, the dot, the 15 counters of its version vector (which must hold its own dot), the 5 bytes of the
    # timeline id, the mark, whether the timeline id is trusted, and how many devices it left unprotected
    static def make(st, dot, v, tl, mark, trusted, lost)
        var b = bytes(52)
        b.add((st & 3) | (trusted ? 4 : 0), 1)
        b.add(dot >> 16, 1)
        b.add((dot >> 8) & 255, 1)
        b.add(dot & 255, 1)
        b .. tl
        b.add(mark, -4)
        b.add(lost & 255, 1)
        ZbAlarmMerge.pack_vv(b, v)
        return b
    end

    # whether b is a record: 52 bytes, the zero bits zero, a dot of node 1..15 and counter 1 or more, and a vector that
    # holds the record's own dot. (Node 0 and counter 0 are not dots: a record of counter 0 would be below every other. The reference
    # refuses them too, in mkRecord, and the section "invalid" of the vectors has the bytes.)
    static def valid(b)
        if !isinstance(b, bytes) || size(b) != 52 return false end
        if (b[0] & 0xF8) != 0 || (b[51] & 15) != 0 return false end
        var d = ZbAlarmMerge.dot_of(b)
        var node = d >> 20
        var n = d & 0xFFFFF
        if node < 1 || node > 15 || n < 1 return false end
        return ZbAlarmMerge.vv_at(b, node - 1) >= n
    end

    # the counters of r's vector, each raised in v to r's where r's is higher
    static def join(v, r)
        for i: 0 .. 14
            var c = ZbAlarmMerge.vv_at(r, i)
            if c > v[i] v[i] = c end
        end
    end

    # --- the order rule: which of two records wins ------------------------------------------------------------------

    # y descends from x: x is in y's past (another action, and a counter of x's node that y's vector has reached)
    static def descends(y, x)
        var dx = ZbAlarmMerge.dot_of(x)
        if ZbAlarmMerge.dot_of(y) == dx return false end
        return ZbAlarmMerge.vv_at(y, (dx >> 20) - 1) >= (dx & 0xFFFFF)
    end

    # a total order on the timeline ids of two records, used only to break a tie nobody can break by age: the sign of the
    # first byte that differs (the node, then the epoch big-endian, which is the unsigned order)
    static def tl_cmp(a, b)
        for i: 4 .. 8
            if a[i] != b[i] return a[i] - b[i] end
        end
        return 0
    end

    # whether the timeline id of r is tl (5 bytes)
    static def tl_is(r, tl)
        for i: 0 .. 4
            if r[4 + i] != tl[i] return false end
        end
        return true
    end

    # the SAME action in two forms (a node translated it into an older timeline and another has not yet, or two nodes
    # translated it with an error of a few ms): the larger mark, which is the older timeline's, and with equal marks the
    # smaller timeline id
    static def same_pick(a, b)
        var c = ZbAlarmMerge.mark_of(a) - ZbAlarmMerge.mark_of(b)
        if c != 0
            if c > 0 return a end
            return b
        end
        if ZbAlarmMerge.tl_cmp(a, b) <= 0 return a end
        return b
    end

    # the safe side, where a pair cannot be placed in time: a disarmed copy beats an armed one; between two of the same class
    # it matters only for being the same everywhere, the more severe and then the larger dot
    static def safe_side(a, b)
        var sa = a[0] & 3
        var sb = b[0] & 3
        if (sa == 0) != (sb == 0)
            if sa == 0 return a end
            return b
        end
        if sa != sb
            if sa > sb return a end
            return b
        end
        if ZbAlarmMerge.dot_of(a) >= ZbAlarmMerge.dot_of(b) return a end
        return b
    end

    # the pairwise rule: [the winner, the layer that decided it]. The layers are "same" (one action twice), "descent"
    # (layer 1), "clock" (layer 2), "tie" (layer 2 with equal marks: the safe side) and "safe" (layer 3). It is
    # symmetric and idempotent and it is NOT associative, which is why a replica never uses it to discard (only layer 1
    # discards) but to fold the heads on reading
    static def merge(a, b)
        if ZbAlarmMerge.dot_of(a) == ZbAlarmMerge.dot_of(b) return [ZbAlarmMerge.same_pick(a, b), "same"] end
        if ZbAlarmMerge.descends(b, a) return [b, "descent"] end
        if ZbAlarmMerge.descends(a, b) return [a, "descent"] end
        if ZbAlarmMerge.tl_cmp(a, b) == 0 && ZbAlarmMerge.trusted_of(a) && ZbAlarmMerge.trusted_of(b)
            var c = ZbAlarmMerge.mark_of(a) - ZbAlarmMerge.mark_of(b)
            if c > 0 return [a, "clock"] end
            if c < 0 return [b, "clock"] end
            return [ZbAlarmMerge.safe_side(a, b), "tie"]
        end
        return [ZbAlarmMerge.safe_side(a, b), "safe"]
    end

    # the state of a set of heads: the rule folded in the order of the dots, or nil for none
    static def resolve(hs)
        if size(hs) == 0 return nil end
        var acc = hs[0]
        for i: 1 .. size(hs) - 1
            acc = ZbAlarmMerge.merge(acc, hs[i])[0]
        end
        return acc
    end

    # the heads of a set of records, by dot: the same action in two forms keeps one, and whatever another record descends
    # from goes. Valid records have at most one head per node (a node's later action descends its earlier ones), so there
    # are never more than 15; two records that each descend from the other (not a history) can leave none
    static def heads_of(records)
        var uniq = []
        for r: records
            var d = ZbAlarmMerge.dot_of(r)
            var at = -1
            for i: 0 .. size(uniq) - 1
                if ZbAlarmMerge.dot_of(uniq[i]) == d at = i end
            end
            if at < 0
                uniq.push(r)
            else
                uniq[at] = ZbAlarmMerge.same_pick(uniq[at], r)
            end
        end
        var out = []
        for h: uniq
            var covered = false
            for g: uniq
                if ZbAlarmMerge.descends(g, h) covered = true end
            end
            if !covered out.push(h) end
        end
        var i = 1
        while i < size(out)
            var x = out[i]
            var d = ZbAlarmMerge.dot_of(x)
            var j = i - 1
            while j >= 0 && ZbAlarmMerge.dot_of(out[j]) > d
                out[j + 1] = out[j]
                j -= 1
            end
            out[j + 1] = x
            i += 1
        end
        return out
    end

    # whether two lists of heads are the same records
    static def same_heads(a, b)
        if size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if a[i] != b[i] return false end
        end
        return true
    end

    # --- the digest and the heartbeat's part -------------------------------------------------------------------------

    # the digest of a set of heads (in the order of their dots): the FNV-1a of 32 bits over the dot (3 bytes), the timeline
    # id (5) and the mark (4) of each, which are the bytes 1 to 12 of the record. A signed Berry int with the same bits
    static def digest_of(hs)
        var h = 0x811C9DC5
        for r: hs
            for i: 1 .. 12
                h = (h ^ r[i]) * 0x01000193
            end
        end
        return h
    end

    # the heartbeat's part of the alarm, 19 bytes: the timeline id (5), the mesh time (48 bits, as the high 16 and the low
    # 32 bits, since a Berry int has 32), the digest of the heads (4), the dot applied in every device of this bridge (3,
    # 0 for none) and a byte of signs: bit 0 synced, bits 1 to 4 the number of heads
    static def encode_hello(tl, hi, lo, digest, applied, synced, count)
        var b = bytes(19)
        b .. tl
        b.add(hi, -2)
        b.add(lo, -4)
        b.add(digest, -4)
        b.add(applied >> 16, 1)
        b.add((applied >> 8) & 255, 1)
        b.add(applied & 255, 1)
        b.add((synced ? 1 : 0) | ((count & 15) << 1), 1)
        return b
    end

    static def decode_hello(b)
        if !isinstance(b, bytes) || size(b) != 19 return nil end
        return {"tl": b[0 .. 4], "hi": b.get(5, -2), "lo": b.get(7, -4), "digest": b.get(11, -4),
                "applied": (b[15] << 16) | (b[16] << 8) | b[17], "synced": (b[18] & 1) != 0, "count": (b[18] >> 1) & 15}
    end

    # --- the replica -------------------------------------------------------------------------------------------------

    # the version vector of the node: what its heads have in their past, and its own counter, which is never below the
    # highest of its own dots any copy has seen
    def rebuild()
        var v = ZbAlarmMerge.zeros()
        for h: self.heads
            ZbAlarmMerge.join(v, h)
        end
        if self.ctr > v[self.id - 1]
            v[self.id - 1] = self.ctr
        else
            self.ctr = v[self.id - 1]
        end
        self.vv = v
    end

    def set_heads(hs)
        self.heads = hs
        self.shown = nil
    end

    # reads the persisted heads and dot counter (what is not a record, or not a whole number of records, is left out)
    def restore()
        import persist
        var n = persist.find(ZbAlarmMerge.CTR_KEY, 0)
        self.ctr = type(n) == "int" ? n : 0
        var text = persist.find(ZbAlarmMerge.HEADS_KEY, "")
        var found = []
        if type(text) == "string" && size(text) % 104 == 0
            var all = bytes(text)
            for i: 0 .. size(all) / 52 - 1
                var r = all[i * 52 .. i * 52 + 51]
                if ZbAlarmMerge.valid(r) found.push(r) end
            end
        end
        self.set_heads(ZbAlarmMerge.heads_of(found))
    end

    # a life begins on the timeline tl (5 bytes: the node that began it and its epoch, big-endian): ok is whether that timeline id is
    # certainly unique (the trust bit of what this life makes). The timeline is kept as a copy, so the caller's bytes may be changed
    # later, and the vector is rebuilt from the heads. This is how a life starts when the mesh's C side owns the timeline: its id is
    # [the MESH number, the epoch], which is not [this replica's alarm number, the epoch] that start_life() makes
    def start_on(tl, ok)
        if !isinstance(tl, bytes) || size(tl) != 5
            raise "value_error", "a timeline id is 5 bytes"
        end
        self.tl = tl.copy()
        self.trusted = ok
        self.rebuild()
    end

    # a life begins with this epoch: ok is whether it was written to the flash before use (a life with a random epoch is
    # not trusted). The timeline is the node's own, [id, epoch] (the standalone replica, boot() and the tests; a replica on the
    # mesh starts on the mesh's timeline with start_on())
    def start_life(epoch, ok)
        var t = bytes(5)
        t.add(self.id, 1)
        t.add(epoch, -4)
        self.start_on(t, ok)
    end

    # persist.save(), whose failure does not go up out of what asked for it: true when written
    def save(what)
        import persist
        try
            persist.save()
            return true
        except .. as e, m
            log("ZBALARM: saving the " + what + " failed (" + str(e) + ": " + str(m) + ")", 1)
            return false
        end
    end

    # the heads to the flash: true when written. When not, they stay in RAM and flush() tries again
    def keep()
        import persist
        var all = bytes(780)
        for h: self.heads
            all .. h
        end
        persist.setmember(ZbAlarmMerge.HEADS_KEY, all.tohex())
        self.unsaved = !self.save("heads")
        return !self.unsaved
    end

    # a save of the heads that fell over is tried again: true when the flash has them
    def flush()
        if self.unsaved self.keep() end
        return !self.unsaved
    end

    # A BOOT: the persisted heads and counter, the epoch counted from the saved one and WRITTEN before use. When the write
    # fails the life takes a random 32-bit epoch for itself alone (random_epoch, or crypto.random when none is given),
    # leaves the saved epoch as it is (the next boot counts from it) and is not trusted: a random id is unique with
    # probability 1 - 2^-32, not for certain, and reusing the old epoch would give the new life the id of the old one, whose
    # timeline the others may still be in. True when the epoch was saved
    def boot(random_epoch)
        import persist
        self.restore()
        var saved = persist.find(ZbAlarmMerge.EPOCH_KEY, 0)
        persist.setmember(ZbAlarmMerge.EPOCH_KEY, saved + 1)
        if self.save("epoch")
            self.start_life(saved + 1, true)
            return true
        end
        persist.setmember(ZbAlarmMerge.EPOCH_KEY, saved)
        if random_epoch == nil
            import crypto
            random_epoch = crypto.random(4).get(0, -4)
        end
        self.start_life(random_epoch, false)
        return false
    end

    # the timeline of this life, the 5 bytes the heartbeat carries
    def timeline() return self.tl end

    # the records this replica sends a neighbour whose digest differs from its own
    def offer() return self.heads.copy() end
    def digest() return ZbAlarmMerge.digest_of(self.heads) end

    # the record that is the state of the heads, or nil with none
    def record()
        if self.shown == nil && size(self.heads) > 0
            self.shown = ZbAlarmMerge.resolve(self.heads)
        end
        return self.shown
    end

    # the name of the state the heads show; the safe one with none
    def state()
        var r = self.record()
        if r == nil return "disarmed" end
        return ZbAlarmMerge.STATES[r[0] & 3]
    end

    # COPIES of another bridge arrive: one record or a list of them. What is not a record is left out and counted. The union of
    # the heads and the copies is reduced to its heads, the vectors are joined, and the heads are persisted when they
    # changed. {"changed": the heads are not the ones there were, "bad": the copies left out, "heads": how many now}
    def hear(copies)
        if isinstance(copies, bytes) copies = [copies] end
        var take = []
        var bad = 0
        for c: copies
            if ZbAlarmMerge.valid(c) take.push(c) else bad += 1 end
        end
        var all = self.heads.copy()
        for c: take
            all.push(c)
        end
        var hs = ZbAlarmMerge.heads_of(all)
        if size(take) == 0 || size(hs) == 0
            return {"changed": false, "bad": bad, "heads": size(self.heads)}
        end
        for c: take
            ZbAlarmMerge.join(self.vv, c)
        end
        if self.vv[self.id - 1] > self.ctr
            self.ctr = self.vv[self.id - 1]
        end
        var changed = !ZbAlarmMerge.same_heads(hs, self.heads)
        if changed
            self.set_heads(hs)
            self.keep()
        end
        return {"changed": changed, "bad": bad, "heads": size(hs)}
    end

    # THE MESH ADOPTED A TIMELINE (new_tl, 5 bytes) that has been up longer: what this node did in the one it leaves moves with
    # it, its marks by ticks (the difference of the two mesh times, in ticks of 100 ms). A record of another timeline is not
    # touched: it was made in one that is over, and nothing places it. The heads are persisted again. How many moved
    def adopted(new_tl, ticks)
        if new_tl == self.tl return 0 end
        var out = []
        var moved = 0
        for h: self.heads
            if ZbAlarmMerge.tl_is(h, self.tl)
                var g = h.copy()
                g.setbytes(4, new_tl)
                g.set(9, g.get(9, -4) + ticks, -4)
                out.push(g)
                moved += 1
            else
                out.push(h)
            end
        end
        self.tl = new_tl.copy()
        if moved > 0
            self.set_heads(out)
            self.keep()
        end
        return moved
    end

    # AN ACTION here: a person arms or disarms, a sensor trips. kind is the name of the state or its number, lost the devices
    # an arm left unprotected. The counter goes up and is written FIRST, and when that write fails there is no record
    # (nil: nothing was done, the number is skipped); then the record is built, which descends from every head this node
    # holds (its vector is the node's), is the only head, and is persisted (when that fails it stands in RAM and flush()
    # tries again). Returns the record
    def act(kind, lost)
        import persist
        var st = type(kind) == "int" ? kind : ZbAlarmMerge.STATES.find(kind)
        if st == nil || st < 0 || st > 3
            raise "value_error", "unknown alarm action " + str(kind)
        end
        if self.ctr >= ZbAlarmMerge.MAX_COUNTER
            raise "value_error", "the dot counter of the alarm is exhausted"
        end
        self.ctr += 1
        persist.setmember(ZbAlarmMerge.CTR_KEY, self.ctr)
        if !self.save("dot counter") return nil end
        self.vv[self.id - 1] = self.ctr
        var r = ZbAlarmMerge.make(st, ZbAlarmMerge.dot(self.id, self.ctr), self.vv, self.tl, self.clock.ticks(), self.trusted, lost == nil ? 0 : lost)
        self.set_heads([r])
        self.keep()
        return r
    end

    # the heartbeat's part of the alarm: this node's timeline, the mesh time the C side gives (its 16 high and 32 low bits),
    # the digest of its heads, the dot it applied in all its devices (0 for none) and whether it is synced
    def hello(hi, lo, applied)
        return ZbAlarmMerge.encode_hello(self.tl, hi, lo, self.digest(), applied, self.clock.synced(), size(self.heads))
    end
end
