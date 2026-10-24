# mesh_cmd.be -- a command from one node of the house to the bridge that owns the device, over the ESP-NOW mesh.
# The house layer's commands: a line of the bridge's own vocabulary (the ZbSend, the ZbRelayAlarm, what the panel's link carries, so that the owner runs it as it
# runs the link's: ZbBridgeRelay.run), with the stamp of the mesh's clock in front of it.
#
# THE FRAME. A mesh frame of type 0 (command), to one node, asking for the confirmation the mesh gives, whose data are the 6 bytes of the stamp
# (espnow_mesh_stamp(): the 2-byte tag of the timeline of the sender, and the mesh time in 10 ms ticks) and the line, text. A node that is not synced has no stamp:
# it sends nothing, and says so (a button shows "?": the sync gate).
#
# THE OWNER'S ADMISSION, in this order, each refusal counted in `refused`:
#   repeat  a frame the mesh says is the resend of a number it handed over before (Flags bit 1): the first was executed or refused, once
#   behind  the frame came more than K = 16 numbers of its origin behind the newest heard: obsolete; the mesh already answered "received"
#   short   too little in it for a stamp and a word
#   sync    this node is not synced, or the stamp is of another timeline (a bridge that does not know the time executes nothing from the network)
#   stale   the age at the moment of executing, by the mesh's clock, is more than the window or more than 250 ms in the future: 3 s, and 1 s for the sensitive
#           (the alarm's words, and what the owner marks: sensitive_fn)
#   obsolete  rule A: of the same origin and device, a frame numbered below one already executed in the last 3 s: a ring of 16
# and then the line is run by the relay. The ring is a ring and not a map without a ceiling: the heap.
#
# THE SENDER sends with send(dest, line, answer): the answer, a closure, is called with the mesh's word on that send (true when the destination answered, false
# when it gave up or the mesh refused: the Outcome of the token), and the token is in `last_token`; a refusal to send (not synced, too long, the queue full) is
# `false` and the reason is in `why`.
#
# The natives are reached by `global`, as zbbridge_alarm_mesh.be does: an image without the driver has none, and the class does nothing there. It starts by itself
# the first second the mesh's clock answers. Loaded with load() on the bridge, before zbbridge_relay.be.

#@ solidify:MeshCmd
class MeshCmd
    static TYPE = 0
    static K = 16
    static WINDOW_MS = 3000
    static SENSITIVE_MS = 1000
    static FUTURE_MS = 250
    static RING = 16
    static RING_TTL_MS = 3000
    static STAMP = 6
    static T_RULE = "mesh_cmd"

    var host         # the relay: run(line, via), or nil in a test that sets run_fn
    var run_fn       # a closure line -> nothing, for a test
    var ring         # the last commands of each (origin, device): [key, epoch, counter, millis]
    var refused      # the reasons and how many were refused for each
    var executed     # how many were run
    var tokens       # the token of a send -> the closure that is told the answer
    var why          # why the last send was refused, or ""
    var last_token   # the token of the last send
    var up           # the rules are in
    var sensitive_fn # a closure line -> whether it takes the short window, or nil for the default (the alarm's words)

    def init(host)
        self.host = host
        self.ring = []
        self.refused = {"repeat": 0, "behind": 0, "short": 0, "sync": 0, "stale": 0, "obsolete": 0}
        self.executed = 0
        self.tokens = {}
        self.why = ""
        self.last_token = 0
        self.up = false
        tasmota.add_driver(self)
    end

    # whether this image has what the commands need of the mesh driver
    static def here()
        import global
        return global.contains("espnow_mesh_stamp") && global.contains("espnow_mesh_age") && global.contains("espnow_mesh_send") && global.contains("espnow_mesh_clock")
    end

    # the rules go in once the mesh runs (the clock answers)
    def every_second()
        if self.up || !MeshCmd.here() return end
        import global
        if !isinstance(global.espnow_mesh_clock(), map) return end
        self.up = true
        var ev = MeshEvents.get()
        ev.add("frame", / v -> self.on_frame(v), MeshCmd.T_RULE)
        ev.add("Outcome", / v -> self.on_outcome(v), MeshCmd.T_RULE)
    end

    # --- the sender -----------------------------------------------------------------------------------------------

    # A command to the node that owns the device: false when it was not sent (self.why says why), else the token. `answer` is told, when the mesh gives it up or the
    # destination confirms: true or false
    def send(dest, line, answer)
        import global
        self.why = ""
        if !MeshCmd.here()
            self.why = "no mesh"
            return false
        end
        var stamp = global.espnow_mesh_stamp()
        if stamp == false
            self.why = "not synced"
            return false
        end
        var body = bytes()
        body .. stamp
        body .. bytes().fromstring(str(line))
        var room = global.contains("espnow_mesh_max_payload") ? global.espnow_mesh_max_payload(dest) : 220
        if size(body) > room
            self.why = "too long"
            return false
        end
        var token = global.espnow_mesh_send(dest, MeshCmd.TYPE, true, body)
        if token == false
            self.why = "refused"
            return false
        end
        self.last_token = token
        if answer != nil  self.tokens[token] = answer end
        return token
    end

    # the mesh's word on a send: its Outcome
    def on_outcome(v)
        if !isinstance(v, map) return end
        var f = self.tokens.find(v.find('Counter', -1))
        if f == nil return end
        self.tokens.remove(v['Counter'])
        f(v.find('Ok', 0) == 1)
    end

    # --- the owner -------------------------------------------------------------------------------------------------

    # A frame from the mesh: of the commands' type, and past the admission, the line is run
    def on_frame(f)
        # a node that has nothing to run them with (a panel: it sends commands and is sent none) takes none
        if self.host == nil && self.run_fn == nil return end
        if !isinstance(f, map) || f.find('Type') != MeshCmd.TYPE || !f.contains('Data') return end
        if (f.find('Flags', 0) & 2) != 0
            self.refused["repeat"] += 1
            return
        end
        if f.find('Behind', 0) > MeshCmd.K
            self.refused["behind"] += 1
            return
        end
        var d = bytes(f['Data'])
        if size(d) <= MeshCmd.STAMP
            self.refused["short"] += 1
            return
        end
        var line = d[MeshCmd.STAMP ..].asstring()
        # the age is read now, when the command is about to be executed, and not when the frame came: the wait inside this node is part of what is measured
        import global
        var a = global.espnow_mesh_age(d[0 .. MeshCmd.STAMP - 1])
        if a == false || a['synced'] != true || a['tag'] != true
            self.refused["sync"] += 1
            return
        end
        var window = self.sensitive(line) ? MeshCmd.SENSITIVE_MS : MeshCmd.WINDOW_MS
        if a['age'] > window || a['age'] < -MeshCmd.FUTURE_MS
            self.refused["stale"] += 1
            return
        end
        if !self.fresh(f, line)
            self.refused["obsolete"] += 1
            return
        end
        self.executed += 1
        # and who sent it: a panel that commands a bridge hears the bridge's events for a while (zbbridge_relay.be)
        var from = f.find('From', 0)
        if self.run_fn != nil
            self.run_fn(line, from)
        elif self.host != nil
            # at the next turn of the loop, out of the rule of the frame: what the command publishes reaches the rules only
            # there (Tasmota runs no rule inside a rule; a ZbInfo's answer is published inside its command)
            var host = self.host
            tasmota.defer(/ -> host.run(line, "mesh", from))
        end
    end

    # whether a line takes the short window: the alarm's words, and what the owner marks
    def sensitive(line)
        import string
        if self.sensitive_fn != nil return self.sensitive_fn(line) end
        return size(line) >= 12 && string.toupper(line[0 .. 11]) == "ZBRELAYALARM"
    end

    # The device a line is for, as its order is kept: the IEEE and the endpoint of a ZbSend, or the word of any other
    static def key_of(line)
        import string
        var i = string.find(line, '"Device":"')
        if i < 0
            var j = string.find(line, " ")
            return string.toupper(j < 0 ? line : line[0 .. j - 1])
        end
        var rest = line[i + 10 ..]
        var j = string.find(rest, '"')
        var key = j < 0 ? rest : rest[0 .. j - 1]
        var e = string.find(line, '"Endpoint":')
        if e >= 0
            var tail = line[e + 11 ..]
            var k = 0
            while k < size(tail) && tail[k] >= '0' && tail[k] <= '9'  k += 1 end
            if k > 0  key += "/" + tail[0 .. k - 1] end
        end
        return key
    end

    # Rule A: a command of the same origin and device numbered below one executed in the last RING_TTL_MS is obsolete. The comparison is the signed
    # 32-bit difference of the epoch and then of the counter
    def fresh(f, line)
        var key = str(f.find('From', 0)) + ":" + MeshCmd.key_of(line)
        var epoch = f.find('Epoch', 0)
        var ctr = f.find('Counter', 0)
        var now = tasmota.millis()
        var i = 0
        while i < size(self.ring)
            if now - self.ring[i][3] >= MeshCmd.RING_TTL_MS  self.ring.remove(i) else i += 1 end
        end
        for e: self.ring
            if e[0] == key
                var de = epoch - e[1]
                var dc = ctr - e[2]
                if de < 0 || (de == 0 && dc <= 0) return false end
                e[1] = epoch
                e[2] = ctr
                e[3] = now
                return true
            end
        end
        self.ring.push([key, epoch, ctr, now])
        while size(self.ring) > MeshCmd.RING  self.ring.remove(0) end
        return true
    end
end
