# house_state.be -- the state of a device of one room shown in another: the marks a panel puts on the devices it shows, the
# state the bridge that owns them floods, and the way a panel that lost some asks for it again.
#
# THE MARKS. A panel that shows a device of another bridge (PanelStore.remote_by_owner) tells that bridge so: a MARK frame, to one node, with the IEEEs of its devices at
# that bridge, 16 to a frame, the first with bit 0 and the last with bit 1 of its flags. The owner keeps, for each panel, the set and the time it was told, and a set not told
# again for MARK_TTL_MS goes; the panel says its set again every MARK_MS, and at once when it changes, and again every MARK_RETRY_MS until the owner has answered (MARK_TRIES
# times at most). The marks are SOFT: a bridge that restarts has them back from its flash (the time they were told is the time it started), and a panel that was off for
# a day is a panel whose marks expired and were said again. The owner answers the last frame of a mark with the state it has of the panel's devices, which is also the
# word that it was heard.
#
# THE STATE. A report of a device that some panel marks is sent to everyone, on the group's key, in one or a few frames of type 3 whose data are
#   [0x30, wire, sequence (2, little-endian), {"<ieee>": {attributes}, ...} as text]
# the same attributes the link to the panel carries (Power, Dimmer, ...), keyed by the IEEE and, for a channel of a device of several, "<ieee>/<endpoint>". A node that does not
# show the device lets the frame go. The owner counts the frames, and says the number in the bytes 20 and 21 of its heartbeat.
#
# THE LOSS. A panel that hears a heartbeat of an owner with a sequence it has not heard a state frame of, for BEHIND_MS, asks (ASK, to one node, with the last it had), and the
# owner answers with the state it has of that panel's devices, as it does to a mark: the same frame of type 0x30, to one node. A panel that never heard the owner asks as soon
# as it hears it. Asking is at most every ASK_GAP_MS. An owner two hops away (house_mesh.be, heard_by) is not heard by its heartbeat, which is not repeated: there a flood whose
# number skips one is the word that one was lost, and the panel asks the same way; an answer, which carries the state whole, and an older number are not.
#
# The bridge keeps, for the devices that are marked, the last state it said (cache), no more than the marks ask for: the heap. A device marked that has none is
# read (prime), and what it says comes back as any report does: PRIME_STEP of them at once and as many again each second, since a panel marks the devices of its own
# room at its own bridge too, and a room read in one burst is a burst on the Zigbee network.
#
# THE DEVICE REMOVED FROM THE HOUSE. A panel's "Remove from the house" tells the bridge that owns the device to have it leave its network
# and forget it (ZbLeave, ZbForget). The bridge keeps its IEEE as removed, for GONE_DAYS (a tombstone: up to GONE_MAX, in the flash), says it to the house now with
# the flood, {"<ieee>": {"Gone": 1}}, and in every answer to a mark of it, so that a panel that was off removes it when it comes back. Not "what the bridge does not
# have": a bridge that has just restarted has not heard its whole network yet. The device that comes back to the network (its announce) is no longer removed.
#
# It is one of HouseMesh's parts (house_mesh.be): it sends over the host, which keeps the frames the driver did not take, and the host gives it the frames of the house that
# are not the list's or the key's.

#@ solidify:HouseState
class HouseState
    static MSG_STATE = 0x30
    static MSG_ASK = 0x31
    static MSG_MARK = 0x32
    static WIRE = 1
    static T_FLOOD = 3
    static SEQ_AT = 20
    static MARK_MS = 300000
    static MARK_RETRY_MS = 5000
    static MARK_TRIES = 6
    static MARK_TTL_MS = 1200000
    static ASK_GAP_MS = 10000
    static BEHIND_MS = 6000
    static PER_FRAME = 16
    static ANSWER_GAP_MS = 2000
    static SAVE_MS = 5000
    static KEEP = "house_marks"
    static GONE = "house_gone"
    static GONE_MAX = 64
    static GONE_DAYS = 30
    static PRIME_STEP = 4
    static HEAD = 4

    var host         # the HouseMesh
    var wanted       # a closure () -> {owner: [ieee, ...]}, the devices this panel shows of other bridges, or nil
    var deliver      # a closure (reports) -> nothing, the reports of a device of another room, as {ieee: attributes}; the panel's
    var resolve      # a closure (key) -> the IEEE of a report's key, or nil; the bridge's
    var prime        # a closure (ieee) -> false when it could not ask yet (its Zigbee is starting), else anything: asks a device for its state; the bridge's
    var seq          # the owner's: the number of the last frame of state it flooded (16 bits)
    var cache        # the owner's: key -> the last attributes said of it
    var marks        # the owner's: panel -> {"u": millis it was told, "s": {ieee: true}}
    var answered     # the owner's: panel -> millis it was last answered
    var dirty        # the owner's: the marks changed since they were saved, or 0
    var gone         # the owner's: the IEEE of a device removed from the house -> the UTC second it was (0 with no time), kept in the flash
    var priming      # the owner's: the devices marked that have said nothing, to be read
    var seen         # the panel's: owner -> the number of the last frame of state heard from it
    var sent         # the panel's: owner -> [the set said, millis, tries, answered]
    var asked        # the panel's: owner -> millis of the last ask
    var behind       # the panel's: owner -> since when the heartbeat said a number it has not heard
    var gap          # the panel's: owner -> true, a flood of it skipped a number: state lost, which its heartbeat, two hops away, does not say here
    var heard        # the panel's: how many frames of state were taken
    var let_go       # the panel's: how many were not for it
    var flooded      # the owner's: how many frames of state it sent

    def init(host)
        self.host = host
        self.seq = 0
        self.cache = {}
        self.marks = {}
        self.answered = {}
        self.dirty = 0
        self.priming = []
        self.gone = {}
        self.seen = {}
        self.sent = {}
        self.asked = {}
        self.behind = {}
        self.gap = {}
        self.heard = 0
        self.let_go = 0
        self.flooded = 0
    end

    # the node left the house (house_mesh.be, leave()): what it held of the marks, the frames and the asks goes; the closures stay
    # the house's numbers, m (number -> true; house_mesh.be, sweep()): what this node keeps of a node that is no more goes, the marks of a panel from the flash too
    def sweep(m)
        var cut = 0
        for t: [self.marks, self.answered, self.seen, self.sent, self.asked, self.behind, self.gap]
            var drop = []
            for k: t.keys()
                if !m.contains(k)  drop.push(k) end
            end
            for k: drop  t.remove(k) end
            cut += size(drop)
        end
        if cut > 0  self.keep() end
    end

    def forget()
        self.seq = 0
        self.cache = {}
        self.marks = {}
        self.answered = {}
        self.dirty = 0
        self.priming = []
        self.gone = {}
        self.seen = {}
        self.sent = {}
        self.asked = {}
        self.behind = {}
        self.gap = {}
    end

    # --- what the natives give ---------------------------------------------------------------------------------------

    # what a frame to `dest` carries, past the head
    static def room(dest)
        import global
        var n = global.contains("espnow_mesh_max_payload") ? global.espnow_mesh_max_payload(dest) : 200
        if n > 190 n = 190 end
        return n - HouseState.HEAD
    end

    # an IEEE as 8 bytes, "0x00124B0000AA000A" -> its bytes
    static def ieee_bytes(ieee)
        return bytes(ieee[2 ..])
    end

    static def ieee_text(b)
        return "0x" + b.tohex()
    end

    # --- the clock of every second ------------------------------------------------------------------------------------

    def tick()
        if self.host.role == HouseList.ROLE_PANEL
            self.tick_panel()
        else
            self.tick_bridge()
        end
    end

    # --- the panel: the marks ------------------------------------------------------------------------------------------

    def tick_panel()
        if self.wanted == nil return end
        var now = tasmota.millis()
        var w = self.wanted()
        # the neighbours read once for all the owners: each read is a list of maps, on the heap
        var l = size(w) > 0 ? self.host.neighbors() : []
        for owner: w.keys()
            self.say_marks(owner, w[owner], now, l)
            self.look_behind(owner, now, l)
        end
        # an owner this panel shows nothing of any more: told so, once
        var gone = []
        for owner: self.sent.keys()
            if !w.contains(owner) gone.push(owner) end
        end
        for owner: gone
            if size(self.sent[owner][0]) > 0 self.send_marks(owner, [], false) end
            self.sent.remove(owner)
            self.seen.remove(owner)
            self.asked.remove(owner)
            self.behind.remove(owner)
            self.gap.remove(owner)
        end
    end

    static def sig_of(ieees)
        var s = ""
        for i: ieees s += i + "," end
        return s
    end

    # the set said when it is new or changed, again until the owner has answered, and again every MARK_MS
    def say_marks(owner, ieees, now, l)
        var sig = HouseState.sig_of(ieees)
        var s = self.sent.find(owner)
        var due = s == nil || s[0] != sig
        if !due && !s[3] && s[2] < HouseState.MARK_TRIES && now - s[1] >= HouseState.MARK_RETRY_MS due = true end
        if !due && now - s[1] >= HouseState.MARK_MS due = true end
        if !due return end
        # not before the mesh is up here, some node of the house heard: a try before would be the air's for nothing, and count against the MARK_TRIES.
        # Not until the owner is heard: one three hops away is heard by no heartbeat here, and the mark reaches it by the flood (waiting for the
        # owner, a panel three hops away would never mark, and have no state)
        if !self.host.mesh_up(l) return end
        var tries = s != nil && s[0] == sig && !s[3] ? s[2] + 1 : 1
        self.sent[owner] = [sig, now, tries, false]
        self.send_marks(owner, ieees, true)
    end

    # the frames of a mark: the first says the set begins, the last that it ends
    def send_marks(owner, ieees, said)
        var n = size(ieees)
        var at = 0
        var first = true
        while first || at < n
            var count = n - at
            if count > HouseState.PER_FRAME count = HouseState.PER_FRAME end
            var b = bytes()
            b.add(HouseState.MSG_MARK, 1)
            b.add(HouseState.WIRE, 1)
            b.add((first ? 1 : 0) | (at + count >= n ? 2 : 0), 1)
            b.add(count, 1)
            for i: at .. at + count - 1
                b .. HouseState.ieee_bytes(ieees[i])
            end
            self.host.send(owner, b, nil)
            at += count
            first = false
        end
    end

    # --- the panel: the state ------------------------------------------------------------------------------------------

    # a frame of state, from the flood (type 3) or from an owner's answer (type 6): the reports of the devices this panel shows of that owner are handed to the panel
    def take_state(src, d, kind)
        if size(d) < HouseState.HEAD + 2 || d[1] != HouseState.WIRE return end
        if self.wanted == nil || self.deliver == nil return end
        var w = self.wanted()
        # the owner of a device is a bridge of the house: a frame of state from any other is let go
        var from = self.host.list.node(src)
        if !w.contains(src) || from == nil || from["role"] != HouseList.ROLE_BRIDGE
            self.let_go += 1
            return
        end
        var s = self.sent.find(src)
        if s != nil s[3] = true end
        # a flood whose number is more than one past the last heard: one was lost between them; an answer carries the state whole
        var n = d.get(2, 2)
        var was = self.seen.find(src)
        var ahead = was != nil ? (n - was) & 0xFFFF : 0
        if kind != HouseState.T_FLOOD
            self.gap.remove(src)
        elif ahead > 1 && ahead < 0x8000
            self.gap[src] = true
        end
        self.seen[src] = n
        self.behind.remove(src)
        import json
        var m = json.load(d[HouseState.HEAD ..].asstring())
        if !isinstance(m, map) return end
        var mine = {}
        for ieee: m.keys()
            var base = ieee
            var i = 0
            while i < size(ieee)
                if ieee[i] == "/" base = ieee[0 .. i - 1] break end
                i += 1
            end
            if w[src].find(base) != nil && isinstance(m[ieee], map) mine[ieee] = m[ieee] end
        end
        if size(mine) == 0 return end
        self.heard += 1
        self.deliver(mine)
    end

    # the sequence an owner says, or nil when it is not heard: its heartbeat, fresh, or, further away, its presence (house_mesh.be, heard_by); not the old
    # heartbeat of a neighbour the others keep alive, nor what a neighbour two hops from it says
    def beat_seq(owner, l)
        var n = self.host.heard_by(owner, l)
        if !isinstance(n, map) || n.find("id") != owner || n.find("state", 2) == 2 || type(n.find("info")) != "string" return nil end
        if !n.find("far", false) && !self.host.fresh(n) return nil end
        var b = bytes(n["info"])
        return size(b) > HouseState.SEQ_AT + 1 ? b.get(HouseState.SEQ_AT, 2) : nil
    end

    # whether the number an owner says is not ahead of the last heard: the same, or behind it (16 bits)
    static def not_ahead(said, mine)
        var d = (said - mine) & 0xFFFF
        return d == 0 || d >= 0x8000
    end

    # a heartbeat that says more than the state heard, for a while, is state lost: ask. With no heartbeat of the owner heard here (two hops away), a
    # flood that skipped a number is the word of it
    def look_behind(owner, now, l)
        var said = self.beat_seq(owner, l)
        var mine = self.seen.find(owner)
        if said == nil
            if !self.gap.contains(owner) return end
        elif mine != nil && HouseState.not_ahead(said, mine)
            # the owner says the number heard, or one behind it: a heartbeat or a presence that has not caught up with the flood yet, and no loss (a
            # presence comes every 10 s, and a panel would ask for every flood it had heard before it)
            self.behind.remove(owner)
            return
        elif mine != nil
            var since = self.behind.find(owner)
            if since == nil
                self.behind[owner] = now
                return
            end
            if now - since < HouseState.BEHIND_MS return end
        end
        if now - self.asked.find(owner, now - HouseState.ASK_GAP_MS) < HouseState.ASK_GAP_MS return end
        self.asked[owner] = now
        self.gap.remove(owner)
        var b = bytes()
        b.add(HouseState.MSG_ASK, 1)
        b.add(HouseState.WIRE, 1)
        b.add(mine == nil ? 0 : mine, 2)
        self.host.send(owner, b, nil)
    end

    # --- the bridge: the marks -------------------------------------------------------------------------------------------

    # the set of a panel, in frames: the first replaces what the bridge had, the others add. The last is answered with the state the bridge has of them
    def take_mark(src, d)
        if size(d) < 4 || d[1] != HouseState.WIRE || !self.host.list.is_panel(src) return end
        var flags = d[2]
        var count = d[3]
        if size(d) != 4 + count * 8 return end
        var now = tasmota.millis()
        var m = self.marks.find(src)
        if (flags & 1) != 0 || m == nil
            if m != nil && size(m["s"]) > 0 self.dirty = now end
            m = {"u": now, "s": {}}
            self.marks[src] = m
        end
        m["u"] = now
        for i: 0 .. count - 1
            var ieee = HouseState.ieee_text(d[4 + i * 8 .. 11 + i * 8])
            if !m["s"].contains(ieee)
                m["s"][ieee] = true
                self.dirty = now
                if !self.cache.contains(ieee) && self.prime != nil && self.priming.find(ieee) == nil  self.priming.push(ieee) end
            end
        end
        self.prime_some()
        if (flags & 2) != 0
            if size(m["s"]) == 0
                self.marks.remove(src)
                self.dirty = now
                self.drop_unmarked()
            end
            self.answer(src)
        end
    end

    # what the panel asked, and what it did not hear: the state of its devices, to it alone
    def take_ask(src, d)
        if size(d) < 4 || d[1] != HouseState.WIRE || !self.marks.contains(src) return end
        self.answer(src)
    end

    # the state of a panel's marked devices, in frames to it: one frame says nothing when there is none, which is the word that its mark was heard
    def answer(src)
        var now = tasmota.millis()
        if now - self.answered.find(src, now - HouseState.ANSWER_GAP_MS) < HouseState.ANSWER_GAP_MS return end
        self.answered[src] = now
        var m = self.marks.find(src)
        var out = {}
        if m != nil
            for ieee: m["s"].keys()
                for k: self.cache.keys()
                    if k == ieee || (size(k) > size(ieee) && k[0 .. size(ieee) - 1] == ieee && k[size(ieee)] == "/") out[k] = self.cache[k] end
                end
                # one the house had removed: said so, for the panel to remove it too
                if self.gone.contains(ieee)  out[ieee] = {"Gone": 1} end
            end
        end
        self.pack(out, src)
    end

    # --- the owner: the devices removed from the house --------------------------------------------------

    static def norm(ieee)
        import string
        var s = str(ieee)
        return size(s) > 2 ? "0x" + string.toupper(s[2 ..]) : s
    end

    # a device of this bridge removed from the house: its tombstone, its state gone, and the house told now
    def forgotten(ieee)
        var id = HouseState.norm(ieee)
        var t = 0
        try t = tasmota.rtc()["utc"] except .. end
        self.gone[id] = t
        while size(self.gone) > HouseState.GONE_MAX
            var oldest = nil
            for k: self.gone.keys()
                if oldest == nil || self.gone[k] < self.gone[oldest]  oldest = k end
            end
            self.gone.remove(oldest)
        end
        var drop = []
        for k: self.cache.keys()
            if k == id || (size(k) > size(id) && k[0 .. size(id) - 1] == id && k[size(id)] == "/") drop.push(k) end
        end
        for k: drop  self.cache.remove(k) end
        self.keep_gone()
        if self.marked(id)
            var out = {}
            out[id] = {"Gone": 1}
            self.pack(out, 255)
        end
    end

    # a device that came back to this bridge's network: it is no longer removed
    def back(ieee)
        var id = HouseState.norm(ieee)
        if !self.gone.contains(id) return end
        self.gone.remove(id)
        self.keep_gone()
    end

    # the tombstones older than GONE_DAYS go, once the clock has the time
    def expire_gone()
        var now = 0
        try now = tasmota.rtc()["utc"] except .. end
        if now < 1451602800 return end
        var old = []
        for k: self.gone.keys()
            var t = self.gone[k]
            if t > 0 && now - t > HouseState.GONE_DAYS * 86400  old.push(k) end
        end
        if size(old) == 0 return end
        for k: old  self.gone.remove(k) end
        self.keep_gone()
    end

    def keep_gone()
        import persist
        if size(self.gone) == 0 persist.remove(HouseState.GONE) else persist.setmember(HouseState.GONE, self.gone) end
        try
            persist.save()
        except .. as e, msg
            log("HOUSE: the devices removed from the house were not saved (" + str(e) + ": " + str(msg) + ")", 1)
        end
    end

    # reports in as few frames as fit: to a node (type 6) or to everyone (type 3)
    def pack(reports, dest)
        import json
        var room = HouseState.room(dest)
        var batch = {}
        var used = 2
        for k: reports.keys()
            var need = size(json.dump({k: reports[k]}))
            if size(batch) > 0 && used + need > room
                self.put(batch, dest)
                batch = {}
                used = 2
            end
            if used + need > room
                log("HOUSE: the state of " + k + " is " + str(need) + " bytes and does not fit in a frame, dropped", 2)
                continue
            end
            batch[k] = reports[k]
            used += need
        end
        if size(batch) > 0 || (dest != 255 && size(reports) == 0) self.put(batch, dest) end
    end

    # one frame of state: a flood is numbered, an answer carries the number the flood has reached
    def put(batch, dest)
        import json
        import global
        var flood = dest == 255
        if flood
            self.seq = (self.seq + 1) & 0xFFFF
            self.publish()
        end
        var b = bytes()
        b.add(HouseState.MSG_STATE, 1)
        b.add(HouseState.WIRE, 1)
        b.add(self.seq, 2)
        b .. bytes().fromstring(json.dump(batch))
        if flood
            if global.contains("espnow_mesh_send") && global.espnow_mesh_send(255, HouseState.T_FLOOD, false, b) != false self.flooded += 1 end
        else
            self.host.send(dest, b, nil)
        end
    end

    # the number the heartbeat says
    def publish()
        var beat = MeshBeat.shared()
        var b = bytes(-2)
        b[0] = self.seq & 255
        b[1] = (self.seq >> 8) & 255
        beat.put(HouseState.SEQ_AT, b)
        beat.flush()
    end

    # --- the bridge: the reports ---------------------------------------------------------------------------------------

    # whether any panel marks a device (by its IEEE; a channel is its device's)
    def marked(ieee)
        for p: self.marks.keys()
            if self.marks[p]["s"].contains(ieee) return true end
        end
        return false
    end

    # What the relay is about to send to its own panel, {key: attributes} as Z2T keyed them: what some panel of another room marks is said to everyone. The key is the IEEE,
    # and, for a channel of a device of several, the IEEE and its endpoint
    def flood(pending)
        if size(self.marks) == 0 || self.resolve == nil return end
        var out = {}
        for key: pending.keys()
            var attrs = pending[key]
            if !isinstance(attrs, map) continue end
            var short = key
            var i = 0
            while i < size(key)
                if key[i] == "/" short = key[0 .. i - 1] break end
                i += 1
            end
            var ieee = self.resolve(attrs.find("Device", short))
            if ieee == nil || !self.marked(ieee) continue end
            var ep = attrs.find("Endpoint")
            var id = ep != nil && int(ep) >= 2 ? ieee + "/" + str(int(ep)) : ieee
            var into = self.cache.find(id)
            if into == nil
                into = {}
                self.cache[id] = into
            end
            for k: attrs.keys()
                if k != "Device" into[k] = attrs[k] end
            end
            var said = {}
            for k: attrs.keys()
                if k != "Device" said[k] = attrs[k] end
            end
            out[id] = said
        end
        if size(out) > 0 self.pack(out, 255) end
    end

    # what is cached of a device no panel marks any more goes
    def drop_unmarked()
        var gone = []
        for k: self.cache.keys()
            var ieee = k
            var i = 0
            while i < size(k)
                if k[i] == "/" ieee = k[0 .. i - 1] break end
                i += 1
            end
            if !self.marked(ieee) gone.push(k) end
        end
        for k: gone self.cache.remove(k) end
    end

    # --- the bridge: the clock, and the flash -----------------------------------------------------------------------------

    def tick_bridge()
        var now = tasmota.millis()
        var gone = []
        for p: self.marks.keys()
            if now - self.marks[p]["u"] >= HouseState.MARK_TTL_MS gone.push(p) end
        end
        if size(gone) > 0
            for p: gone self.marks.remove(p) end
            self.drop_unmarked()
            self.dirty = now
        end
        if self.dirty != 0 && now - self.dirty >= HouseState.SAVE_MS self.keep() end
        self.prime_some()
        self.expire_gone()
    end

    # the next devices to read, of those marked that have said nothing: a device that spoke since is not read
    def prime_some()
        var n = 0
        while size(self.priming) > 0 && n < HouseState.PRIME_STEP
            var ieee = self.priming[0]
            if !self.cache.contains(ieee) && self.prime != nil
                # one that could not be asked yet keeps its place for the next second
                if self.prime(ieee) == false return end
                n += 1
            end
            self.priming.remove(0)
        end
    end

    def keep()
        import persist
        var m = {}
        for p: self.marks.keys()
            var l = []
            for ieee: self.marks[p]["s"].keys() l.push(ieee) end
            m[str(p)] = l
        end
        self.dirty = 0
        if size(m) == 0
            persist.remove(HouseState.KEEP)
        else
            persist.setmember(HouseState.KEEP, m)
        end
        try
            persist.save()
        except .. as e, msg
            log("HOUSE: the marks were not saved (" + str(e) + ": " + str(msg) + ")", 1)
        end
    end

    # the marks from the flash: they are said to have been told now
    def load()
        import persist
        var g = persist.find(HouseState.GONE, nil)
        if isinstance(g, map)  self.gone = g end
        var m = persist.find(HouseState.KEEP, nil)
        if !isinstance(m, map) return end
        var now = tasmota.millis()
        for p: m.keys()
            if !isinstance(m[p], list) continue end
            var s = {}
            for ieee: m[p] if type(ieee) == "string" s[ieee] = true end end
            self.marks[int(p)] = {"u": now, "s": s}
        end
    end

    # --- the frames the host hands over ----------------------------------------------------------------------------------

    # `d` is the data of a frame of the house's, whose first byte is one of ours: the host looked
    def on_frame(src, kind, d)
        var w = d[0]
        if w == HouseState.MSG_STATE
            self.take_state(src, d, kind)
        elif w == HouseState.MSG_ASK && kind == 6
            self.take_ask(src, d)
        elif w == HouseState.MSG_MARK && kind == 6
            self.take_mark(src, d)
        end
    end
end
