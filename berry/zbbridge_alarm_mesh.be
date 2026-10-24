# zbbridge_alarm_mesh.be -- the way the alarm's replica (zbbridge_alarm_merge.be, ZbAlarmMerge) travels between bridges over the ESP-NOW
# mesh. One of these is the replica of one bridge, the
# clock it reads, the three rules it listens to, and what it says of itself in the heartbeat and in frames. zbbridge_alarm.be (ZbBridgeAlarm)
# owns one when this bridge has an alarm number and the mesh is running, and the state its devices and its glass use is the replica's.
#
# THE ALARM NUMBER. The replica has 15 counters, one per bridge, so a bridge is "alarm 1 to 15", and the mesh's own number goes to 48
# and is never reused. A bridge that is in a house has the number the list of the house gives it (house_mesh.be, the SLOT of its entry); one that is in no house has
# the interim, which is, in this order: the flash key zb_alarm_slot, which the console command ZbAlarmSlot <n> (1 to 15) sets (0 clears it); and, with no key, the
# bridge's mesh number when that is 1 to 15. A bridge with neither, or with no mesh driver in its image, or with the mesh off, has no replica, and the
# alarm is what it was for one bridge (zbbridge_alarm.be). ZbAlarmMesh.slot() is the one place the house list gives it.
#
# THE BOOT ORDER. The replica needs the timeline the mesh is in, which exists once the mesh task runs (a few seconds after the boot, when the Wi-Fi is up),
# so it is built then, by ZbBridgeAlarm every second until it is: begin() restores the heads and the dot counter from the flash, starts a life on the
# clock's timeline (start_on, so the timeline is the clock's own: start_life would make it from the alarm number and the epoch, the core's
# is the MESH number and the epoch, and a record in a timeline the others do not name could not be ordered by its mark) and hands the heartbeat its
# bytes, which also tells the driver the application is ready for frames.
#
# THE LIFE AND THE CLOCK. The clock is read in ONE espnow_mesh_clock() call whenever a mark is made: the timeline and the mark of a record are from the same
# reading. A timeline the clock has and the life does not is one of two things: the mesh restarted, which is a new timeline, the clock
# at 0, `taken` back at 0 and NO event, or the mesh took a timeline whose Timeline event is still on its way (the clock is in the new timeline before the
# event reaches the rules; `taken` is more than the events seen). The first starts a new life at once; the second is waited for, and an action made
# meanwhile is refused (it is tried again a few seconds later by the alarm), and when two looks pass without the event it was lost (the core's queue of 8,
# the driver's of 16) and the life starts over: what the old life made stays in a timeline nobody places, and falls to the safe side.
#
# WHAT GOES ON THE AIR. A payload is [message, version, ...], and a house layer that comes later keeps the messages 0x10 to 0x1F for the alarm:
#   0x10 records  version 1, the number of records (1 to 4), then the records, 52 bytes each (up to 211 bytes of the 220 a frame to a node holds)
#   0x11 ask      version 1, the digest of the asker's heads (4 bytes, big-endian): "send me yours", unless they are the same
# in a mesh frame of type 3 (event: priority 1, by radio and network) to everyone, right after this bridge acted, and of type 2 (state) to one neighbour,
# in answer to a heartbeat that says its heads are not ours (they are offered, up to 4 to a frame) or to an ask. No frame asks for an acknowledgement: the
# repetition is the heartbeat's own digest, every 5 s, until the two agree, and a copy that arrives twice changes nothing (hear() is idempotent).
#
# THE HEARTBEAT. The 32 bytes of the application, passed whole to espnow_mesh_info each time something changes: byte 0 the layout (1), then the
# 19 bytes of ZbAlarmMerge.hello() as bytes 1 to 19, and the rest are the house layer's (house_mesh.be: the identity, the digest of the list; the others are not written
# yet). The buffer is the device's (mesh_beat.be, MeshBeat.shared()), which both write into. The core writes over bytes 0 to 11 (layout, timeline, mesh time) and bit 0 of byte 19 (synced) itself, so what
# hello() puts there is not read: the digest (12 to 15), the applied point (16 to 18, zero until the reach is counted) and the number of heads (bits 1 to 4
# of byte 19) are the replica's. Every neighbour's bytes come back from espnow_mesh_neighbors(), and a digest that is not ours is what is answered.
# The buffer goes away with a mesh restart, so it is sent again when a new life starts, when the heads change and when a timeline is taken. A neighbour's
# digest is read only from a heartbeat that came after our own last change (what its heartbeat said before was made of what it held before: its next one, in 5 s,
# says what it holds now), so that an arm everyone has is not answered by every bridge offering its heads to every other.
#
# Loaded with load() after mesh_beat.be and zbbridge_alarm_merge.be and before zbbridge_alarm.be on the bridge, where the firmware compiles it in. The
# natives are reached by `global`, not by name: an image without the mesh driver has none of them, and names the build does not know do not compile.

#@ solidify:ZbAlarmMesh
class ZbAlarmMesh
    static SLOT_KEY = "zb_alarm_slot"
    # the door to Home Assistant: the number of the bridge the owner prefers, and how long it must have been alive, synced and with the broker to take the
    # door back
    static DOOR_KEY = "zb_alarm_door"
    static DOOR_HOLD_MS = 30000
    # the messages of the alarm, and the version of their payloads
    static MSG_RECORDS = 0x10
    static MSG_ASK = 0x11
    static WIRE = 1
    # the mesh's frame types: a change goes as an event (priority 1, both ways), the rest as a state
    static T_NOW = 3
    static T_STATE = 2
    static ALL = 255
    # records to a frame: 3 bytes and 4 x 52 are 211, of the 220 a frame for one node holds
    static PER_FRAME = 4
    # the neighbours are looked at this often (s); the same heads are offered to a neighbour no oftener than OFFER_GAP_MS (a heartbeat and its
    # jitter, so that its answer is read before they are offered again), and asked of it no oftener than ASK_GAP_MS
    static POLL_S = 2
    static OFFER_GAP_MS = 6000
    static ASK_GAP_MS = 15000
    # the looks a timeline that was taken is waited for, with its event, before the event is given for lost
    static LAG = 2
    static T_RULE = "zb_alarm_mesh"

    var alarm      # the ZbBridgeAlarm this is the replica of, told when what is held changed
    var rep        # the replica, ZbAlarmMerge
    var tl         # the timeline of this life, 5 bytes: the clock's
    var at_ticks   # the mesh time at the last reading, in ticks of 100 ms
    var at_ms      # tasmota.millis() then
    var sync       # the clock said it was synced at the last reading
    var processed  # the Timeline events this life has seen, to be compared with `taken`
    var lag        # the looks a timeline has been waited for
    var offered    # neighbour -> millis when the heads were last sent it
    var asked      # neighbour -> millis when it was last asked
    var count      # the seconds, for the poll
    var dirty      # the heartbeat's bytes were not taken and are to be given again
    var changed    # millis when the heartbeat's bytes last changed: what a neighbour's heartbeat from before says of its heads is not what it holds now
    var applied    # the dot (24 bits) of the record this bridge applied whole, in its devices too, or 0: the heartbeat's bytes 16 to 18
    var reach_c    # how many bridges (this one too) say they applied the record this one shows, as of the last poll
    var reach_t    # of how many have a replica, silent ones counted
    var reach_dot  # the dot that count is of
    var door_id    # the mesh number of the bridge that is the door to Home Assistant, as the last poll chose it, or 0
    var elig       # mesh number -> the millis since it has been alive, synced and with the broker
    var mesh_no    # this bridge's number on the mesh
    var mqtt_bit   # the heartbeat says this bridge has the broker

    def init(alarm, slot)
        self.alarm = alarm
        self.rep = ZbAlarmMerge(slot, self)
        self.tl = bytes(-5)
        self.at_ticks = 0
        self.at_ms = tasmota.millis()
        self.sync = false
        self.processed = 0
        self.lag = 0
        self.offered = {}
        self.asked = {}
        self.count = 0
        self.dirty = false
        self.changed = tasmota.millis()
        self.applied = 0
        self.reach_c = 1
        self.reach_t = 1
        self.reach_dot = 0
        self.door_id = 0
        self.elig = {}
        self.mesh_no = 0
        self.mqtt_bit = false
    end

    # --- what the mesh has -------------------------------------------------------------------------------------------

    # whether this image has the mesh driver's functions (an image of today's product has none)
    static def here()
        import global
        return global.contains("espnow_mesh_clock") && global.contains("espnow_mesh_info") && global.contains("espnow_mesh_send") && global.contains("espnow_mesh_neighbors")
    end

    # the clock as a map, or nil when the task is not running
    static def clock()
        import global
        if !global.contains("espnow_mesh_clock") return nil end
        var c = global.espnow_mesh_clock()
        return isinstance(c, map) ? c : nil
    end

    # the bridge's number in the mesh, or 0 (the driver's, asked muted: it is a read)
    static def mesh_id()
        var r = tasmota.cmd("_EspNowMeshId", true)
        var n = isinstance(r, map) ? r.find("EspNowMeshId") : nil
        return type(n) == "int" ? n : 0
    end

    # this bridge's alarm number, 1 to 15, or nil for none (see the header). A bridge that is in a house has the number the list gives it: the lowest free
    # when it came in, and none for a 16th bridge or one that was struck off. A bridge that is in no house has the interim's
    static def slot()
        import persist
        import global
        var r = global.contains("zbbridge_relay") ? global.zbbridge_relay : nil
        var hm = r != nil ? r.house : nil
        if hm != nil && hm.up
            if hm.list.revoked(hm.list.me) return nil end
            var n = hm.list.node(hm.list.me)
            if n != nil return n["slot"] < 1 ? nil : n["slot"] end
        end
        var s = persist.find(ZbAlarmMesh.SLOT_KEY, nil)
        if type(s) == "int" && s >= 1 && s <= ZbAlarmMerge.MAX_NODE return s end
        var n = ZbAlarmMesh.mesh_id()
        return n >= 1 && n <= ZbAlarmMerge.MAX_NODE ? n : nil
    end

    # --- the clock the replica reads ---------------------------------------------------------------------------------

    # the mesh time now in ticks of 100 ms: the last reading and the time the bridge's own counter has run since, so that a mesh that stopped
    # does not stop the marks
    def ticks()
        return self.at_ticks + (tasmota.millis() - self.at_ms) / 100
    end

    def synced() return self.sync end

    # the clock, read once: the map, or nil when the task is not running
    def read()
        var c = ZbAlarmMesh.clock()
        if c == nil return nil end
        self.at_ticks = c['ticks100']
        self.at_ms = tasmota.millis()
        self.sync = c['synced'] == true
        return c
    end

    # --- a life --------------------------------------------------------------------------------------------------------

    # A life begins on the clock's timeline: the replica starts on it (start_on: its timeline is the mesh's, [the mesh number, the epoch], and not the
    # [alarm number, epoch] start_life would make), the vector is rebuilt from the heads, and the heartbeat's bytes, which the mesh restart took, are to be
    # given again. What was made in a timeline before is not translated: nothing places it
    # False when the clock names a timeline that is not 5 bytes (the driver gives 10 hex digits, always): no life begins on it, and nothing raises
    def life(c)
        var t = bytes(c['timeline'])
        if size(t) != 5
            log("ZBALARM: the mesh clock gave a timeline of " + str(size(t)) + " bytes, not 5: no life begins on it", 1)
            return false
        end
        self.rep.start_on(t, true)
        MeshBeat.shared().forget()
        self.tl = t
        self.processed = c['taken']
        self.lag = 0
        self.dirty = true
        return true
    end

    # The replica is in step with the mesh's clock: the clock's map; false for a timeline taken whose event is not here yet (nothing is made now); nil with no
    # clock (the task is stopped: the marks go on by the bridge's own counter and the timeline is the life's)
    def step()
        var c = self.read()
        if c == nil return nil end
        if bytes(c['timeline']) == self.tl
            self.lag = 0
            return c
        end
        if c['taken'] > self.processed && self.lag < ZbAlarmMesh.LAG
            self.lag += 1
            return false
        end
        log("ZBALARM: the mesh is in another timeline than the replica's (" + (c['taken'] > self.processed ? "its event was lost" : "the mesh restarted") + "): a new life", 2)
        if !self.life(c) return false end
        self.publish()
        return c
    end

    def begin()
        self.rep.restore()
        var c = self.read()
        if c != nil self.life(c) end
        var ev = MeshEvents.get()
        ev.add("frame", / v -> self.on_frame(v), ZbAlarmMesh.T_RULE)
        ev.add("Timeline", / v -> self.on_timeline(v), ZbAlarmMesh.T_RULE)
        ev.add("Synced", / v -> self.on_synced(v), ZbAlarmMesh.T_RULE)
        self.publish()
    end

    # --- what this bridge says ----------------------------------------------------------------------------------------

    # an action of this bridge (kind: 0 disarmed, 1 armed home, 2 armed away, 3 triggered; lost: the devices an arm left unprotected): the record, or nil when
    # there was none made (the counter would not write, or the mesh's timeline is changing: the alarm tries again), and said to everyone when there was
    def act(kind, lost)
        if self.step() == false
            log("ZBALARM: a timeline was taken and its event has not come: the action waits", 2)
            return nil
        end
        var r = nil
        try
            r = self.rep.act(kind, lost)
        except .. as e, m
            log("ZBALARM: the replica refused the action (" + str(e) + ": " + str(m) + ")", 1)
        end
        if r != nil
            self.publish()
            self.send_heads(ZbAlarmMesh.ALL, ZbAlarmMesh.T_NOW, self.rep.offer())
        end
        return r
    end

    # the replica's 19 bytes in the device's heartbeat buffer (mesh_beat.be, MeshBeat: the house layer writes the rest of the 32), and the buffer given to the mesh. True
    # when the mesh took it; when not, the poll gives it again
    def publish()
        self.changed = tasmota.millis()
        var beat = MeshBeat.shared()
        beat.put(1, self.rep.hello(0, 0, self.applied))
        # bit 7 of byte 19: this bridge has the broker, and is fit to be the door to Home Assistant
        self.mqtt_bit = self.alarm.up == true && self.alarm.ha_on()
        beat.bit(19, 0x80, self.mqtt_bit)
        var ok = beat.flush()
        self.dirty = !ok
        return ok
    end

    # This bridge applied the record whose dot this is, whole: its state follows it, and its sirens are as ordered. The heartbeat says so (the neighbours
    # count the bridges that did), and the count is made again at once
    def set_applied(dot)
        if dot == self.applied return false end
        self.applied = dot
        self.publish()
        return true
    end

    # What the bridges applied of the record this one shows: [the bridges that did, this one included, of how many have a replica], as of the last poll (the
    # neighbours' heartbeats, by radio and by the network). [1, 1] for a bridge alone. A record that was not counted yet is counted by nobody
    def reach()
        var r = self.rep.record()
        var cur = r == nil ? 0 : ZbAlarmMerge.dot_of(r)
        if cur != self.reach_dot
            return [self.applied == cur ? 1 : 0, self.reach_t, false]
        end
        return [self.reach_c, self.reach_t, true]
    end

    # records to a neighbour or to all, up to PER_FRAME to a frame; the mesh's refusal (the task's queue is full, or it is not running) is the poll's to
    # mend, a heartbeat later
    def send_heads(dest, kind, hs)
        import global
        var at = 0
        while at < size(hs)
            var n = size(hs) - at
            if n > ZbAlarmMesh.PER_FRAME  n = ZbAlarmMesh.PER_FRAME end
            var b = bytes()
            b.add(ZbAlarmMesh.MSG_RECORDS, 1)
            b.add(ZbAlarmMesh.WIRE, 1)
            b.add(n, 1)
            for i: at .. at + n - 1
                b .. hs[i]
            end
            if global.espnow_mesh_send(dest, kind, false, b) == false
                log("ZBALARM: the mesh took no records for " + str(dest), 3)
            end
            at += n
        end
    end

    # the digest of the heads, to a neighbour that may hold others
    def ask(dest)
        import global
        var b = bytes()
        b.add(ZbAlarmMesh.MSG_ASK, 1)
        b.add(ZbAlarmMesh.WIRE, 1)
        b.add(self.rep.digest(), -4)
        global.espnow_mesh_send(dest, ZbAlarmMesh.T_STATE, false, b)
    end

    # --- what the mesh says to this bridge (the rules) ----------------------------------------------------------------

    # a frame: of the alarm's two messages, of the type of the mesh they ride, and not a repeat of one handed over before
    def on_frame(f)
        if !isinstance(f, map) || !f.contains('Data') return end
        var kind = f.find('Type')
        if (kind != ZbAlarmMesh.T_STATE && kind != ZbAlarmMesh.T_NOW) || (f.find('Flags', 0) & 2) != 0 return end
        var d = bytes(f['Data'])
        if size(d) < 2 || d[1] != ZbAlarmMesh.WIRE return end
        var src = f.find('From', 255)
        if d[0] == ZbAlarmMesh.MSG_RECORDS
            self.take(d, src)
        elif d[0] == ZbAlarmMesh.MSG_ASK && size(d) == 6
            self.answer(d, src)
        end
    end

    # records: what the replica did not hold changes it, and the alarm shows what the heads say
    def take(d, src)
        var n = size(d) > 2 ? d[2] : 0
        if n < 1 || n > ZbAlarmMesh.PER_FRAME || size(d) != 3 + n * ZbAlarmMerge.RECORD_BYTES return end
        var copies = []
        for i: 0 .. n - 1
            var o = 3 + i * ZbAlarmMerge.RECORD_BYTES
            copies.push(d[o .. o + ZbAlarmMerge.RECORD_BYTES - 1])
        end
        var heard = self.rep.hear(copies)
        if heard['changed']
            self.publish()
            self.alarm.heard_copies(src)
        end
    end

    # an ask: the heads, unless the asker's are the same, and no oftener than a second
    def answer(d, src)
        if d.get(2, -4) == self.rep.digest() return end
        var now = tasmota.millis()
        var last = self.offered.find(src)
        if last != nil && now - last < 1000 return end
        self.offered[src] = now
        self.send_heads(src, ZbAlarmMesh.T_STATE, self.rep.offer())
    end

    # the mesh took the timeline of an older node: what this bridge did in the one it left moves with it, and the heads are offered again (their
    # digest is another now)
    def on_timeline(v)
        if !isinstance(v, map) return end
        var to = bytes(v['New'])
        if bytes(v['Old']) == self.tl
            self.rep.adopted(to, v['Ticks'])
            self.tl = to
            self.processed += 1
            self.lag = 0
        else
            var c = self.read()
            if c != nil self.life(c) end
        end
        self.read()
        self.publish()
        self.send_heads(ZbAlarmMesh.ALL, ZbAlarmMesh.T_STATE, self.rep.offer())
        self.alarm.heard_copies(nil)
    end

    def on_synced(v)
        if !isinstance(v, map) return end
        self.sync = v.find('Value', 0) == 1
        self.publish()
    end

    # --- every second ------------------------------------------------------------------------------------------------

    def every_second()
        self.step()
        self.rep.flush()
        self.count += 1
        if self.dirty || (self.alarm.up == true && self.alarm.ha_on()) != self.mqtt_bit  self.publish() end
        if self.count % ZbAlarmMesh.POLL_S == 0  self.poll() end
    end

    # the house's numbers, m (number -> true; house_mesh.be, sweep()): what this replica kept of a bridge that is no more, its looks and its turn at the door, goes
    def sweep(m)
        for t: [self.offered, self.asked, self.elig]
            var drop = []
            for k: t.keys()
                if !m.contains(k)  drop.push(k) end
            end
            for k: drop  t.remove(k) end
        end
    end

    # The neighbours' heartbeats, with what each says of its heads: a neighbour whose digest is not ours is sent ours and asked for its own (no
    # oftener than the gaps), unless it has no replica (no heads and a digest of nothing)
    def poll()
        import global
        # the neighbours that are nodes of the house (house_mesh.be, neighbors()): a bridge struck off is no replica of this alarm's
        var relay = global.contains("zbbridge_relay") ? global.zbbridge_relay : nil
        var hm = relay != nil ? relay.house : nil
        # with the presence of the bridges no heartbeat brings here (house_mesh.be, heard_all): every replica of the house counts
        var l = hm != nil ? hm.heard_all(nil) : global.espnow_mesh_neighbors()
        if !isinstance(l, list) return end
        var mine = self.rep.digest()
        var now = tasmota.millis()
        var r = self.rep.record()
        var cur = r == nil ? 0 : ZbAlarmMerge.dot_of(r)
        var c = self.applied == cur ? 1 : 0
        var t = 1
        var gone = []
        var back = []
        var fit = []
        for n: l
            var info = bytes(n.find('info', ''))
            if size(info) < 20 || info[0] != 1 continue end
            var h = ZbAlarmMerge.decode_hello(info[1 .. 19])
            if h == nil || (h['digest'] == 0 && h['count'] == 0) continue end
            # a bridge that has a replica counts, silent or not; it applied the record only if it is heard and says so
            t += 1
            var state = n.find('state', 2)
            if state <= 1 && h['applied'] == cur  c += 1 end
            if state <= 1 && h['synced'] && (info[19] & 0x80) != 0  fit.push(n['id']) end
            if state > 1
                gone.push(n['id'])
                continue
            end
            if state == 0  back.push(n['id']) end
            # a heartbeat that came before the last change of our own heads was made of what they were: it is waited for again
            var beat = n.find('beat', -1)
            if beat < 0 || (now - beat) - self.changed < 0 continue end
            if h['digest'] != mine  self.differ(n['id'], now) end
        end
        self.alarm.bridges(gone, back)
        # this bridge's number on the mesh, asked once (a read of the driver)
        if self.mesh_no == 0  self.mesh_no = ZbAlarmMesh.mesh_id() end
        if self.sync && self.mqtt_bit && self.mesh_no > 0  fit.push(self.mesh_no) end
        self.elect(fit)
        if c != self.reach_c || t != self.reach_t || cur != self.reach_dot
            self.reach_c = c
            self.reach_t = t
            self.reach_dot = cur
            self.alarm.reach_changed()
        end
    end

    # The door to Home Assistant, by rank, from the bridges that are alive, synced and have the broker: the preferred one when it has been so
    # for DOOR_HOLD_MS (it does not take the door back at once), else the door in office while it is fit, else the lowest number. No messages: each bridge
    # reads the same heartbeats
    def elect(fit)
        import persist
        var now = tasmota.millis()
        for k: self.elig.keys()
            if fit.find(k) == nil  self.elig.remove(k) end
        end
        for id: fit
            if !self.elig.contains(id)  self.elig[id] = now end
        end
        var pref = persist.find(ZbAlarmMesh.DOOR_KEY, 0)
        var best = 0
        if size(fit) > 0
            if pref != 0 && self.elig.contains(pref) && now - self.elig[pref] >= ZbAlarmMesh.DOOR_HOLD_MS
                best = pref
            elif fit.find(self.door_id) != nil
                best = self.door_id
            else
                best = fit[0]
                for id: fit  if id < best  best = id end end
            end
        end
        self.door_id = best
        self.alarm.door = best != 0 && best == self.mesh_no
    end

    def differ(id, now)
        var last = self.offered.find(id)
        var hs = self.rep.offer()
        if size(hs) > 0 && (last == nil || now - last >= ZbAlarmMesh.OFFER_GAP_MS)
            self.offered[id] = now
            self.send_heads(id, ZbAlarmMesh.T_STATE, hs)
        end
        var was = self.asked.find(id)
        if was == nil || now - was >= ZbAlarmMesh.ASK_GAP_MS
            self.asked[id] = now
            self.ask(id)
        end
    end
end
