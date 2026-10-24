# house_mesh.be -- the list of the house (house_list.be, HouseList) on the ESP-NOW mesh: how it is said in the heartbeat, how a node that has less than another gets what it
# lacks, what the panels write, and what the driver is told of it.
#
# THE HEARTBEAT. The digest of the list is the bytes 25 to 27 of the application's 32, and the two first bytes of the node's public key are the 23 and 24 (a
# number two nodes have shows in them). The buffer is the device's, MeshBeat.shared(), the alarm's replica writes the rest of it. A node that sees a
# neighbour whose digest is not its own asks it, with its vector, and asks no one oftener than every ASK_GAP_MS.
#
# THE FRAMES are of the mesh's type 6 (the membership), to one node, never to all and never asking for an answer: the repetition is the heartbeat's own digest, as the
# alarm's is. The first byte is the message, the second the version of the wire (1). Messages 0x20 to 0x2F are the house's:
#   0x20 ask      the asker's vector (author, seq of 2 bytes)...: "tell me what you have that I do not"
#   0x21 entries  the author (1), 1 if this is the last frame of the answer, the seq the author's entries go up to (2), and entries (house_list.be, 7 bytes and the data each): up to what a frame holds. Only
#                 the author sends its own entries, and a node takes them only when the frame is from the author itself (the mesh sealed it with the key of the pair, so no other node
#                 could have made it) and the author is a panel of this node's list
#   0x22 vector   the sender's vector: what it holds of every author. A node that is behind an author it was not talking to asks that author
#   0x29 leave    "leave the house": taken only from a panel of this node's list, not struck off; the node leaves (leave())
#   0x2C move     "join another house": taken only from a panel of this node's list, not struck off; the node goes as if by itself (go(), so
#                 the panels strike it off and let its devices go), and then opens its window for a panel of the other house to add it (on_move)
#   0x26 view?    "show me this screen of yours", JSON {"v": the view}: a node answers only a panel of its list, not struck off, with 0x27
#   0x27 view     a piece of the node's screen, JSON {"w": the answer's number, "p": the piece, "of": how many, "v": the view, "t": its title, "b": 1 when a touch
#                 closed it, "r": rows}, each row [label, value, what a touch does (0 nothing, 1 it opens the screen that follows, 2 it changes a setting
#                 there, 3 it opens this panel's own screen that follows), its colour (2 for what changes much), the screen]; the panel keeps the whole by the
#                 node's number (ask_view)
#   0x28 touch    "touch this row of that screen", JSON {"v": the view, "k": the row}: the node changes the setting and answers with 0x27
# A panel answers an ask with its own entries that the asker lacks, and any node with its vector when it differs; the answers are no oftener than ANSWER_GAP_MS to a node.
#
# WHAT THE PANELS WRITE. found() makes the house; add_node(), rename(), set_ip(), set_house_name() and revoke() are the entries a person's act becomes. A bridge writes nothing.
# A panel always has a house: it founds its own whenever its driver runs with no number (found_own()), at its first boot and as soon as it has
# left a house, "House-" and a code of its radio address, but while it waits at its window for another house to take it (hold). It keeps whether the house it
# is in is the one it founded (own_house()): the mesh's screen offers to join another house from its own, and to leave one that is not.
# A node that gives a number to another is not done: the node has to be told it (the pairing of the panel and the new node, which this file does not do).
#
# A NODE COMES IN by the welcome (welcome() and accept()), which the link of the pairing carries (house_link.be) or, on the bench, the console (house_commands.be).
# A NODE GOES OUT by leave(): the list, the keys and the number go, here and in the driver (EspNowMeshLeave), and the node is a new one to a house. A panel removes
# another (remove(): the word to leave, and the node struck off with a change of the key), a panel leaves by itself (leave_house(), with its bridge or without), and a node that
# finds itself struck off leaves.
#
# THE DRIVER'S TABLE is the nodes the list has, with their public keys: every identity of the list that is not this node and is not struck off is given to the driver with
# EspNowMeshNode, and one that is struck off is taken out (EspNowMeshNode <id>,0), a few to a turn (each is a write of the driver's record in the flash), and not the ones the driver
# already has with the same address.
#
# The natives are reached by `global`, as zbbridge_alarm_mesh.be does: an image without the driver has none, and the class does nothing there. Loaded with load() after
# house_list.be, house_key.be and mesh_beat.be.

#@ solidify:HouseMesh
class HouseMesh
    static MSG_ASK = 0x20
    static MSG_ENTRIES = 0x21
    static MSG_VEC = 0x22
    static WIRE = 1
    # the mesh's type for the house's frames, and what a frame to one node holds
    static T_MEMBER = 6
    static FRAME = 220
    static HEAD = 6
    static POLL_S = 2
    static ASK_GAP_MS = 6000
    static ANSWER_GAP_MS = 2000
    static PUSH_PER_TURN = 3
    # the frames waiting for the mesh, and how many the mesh may refuse a frame before it is let go
    static OUT_MAX = 48
    static TRIES = 20
    static WELCOME_WIRE = 1
    static PIECE = 180
    static ID_AT = 23
    static DIGEST_AT = 25
    static T_RULE = "house_mesh"
    static MSG_LEAVE = 0x29
    static MSG_EVENT = 0x2A
    static MSG_GOING = 0x2B       # a node leaves the house by itself: said to the panels first
    static MSG_MOVE = 0x2C        # a node told to join another house
    # THE PRESENCE. A heartbeat is not repeated, so a node sees by its heartbeat only its neighbours, and by theirs the nodes
    # two hops away. Every node of a house of more than one floods, every HERE_BRIDGE_S (a bridge) or HERE_PANEL_S (a panel), [MSG_HERE, WIRE, its period
    # in s, its heartbeat's 32 bytes of the application], with the bit "synced" of the byte 19 its clock says (the core writes that bit only on the air):
    # what a node three hops away or more needs to know it is there and in step, and the sequence of its state, the digest of its alarm and its radio. It
    # is fresh for 2.5 of its periods. Its flood also teaches every node the way back to it. After the 32 bytes, three more (the mesh's
    # screen says how well each node is tied to the mesh and to the Wi-Fi, and not the way to it): how many nodes of the house it hears on the radio now, the
    # signal of the best of them, and its Wi-Fi's signal, the two in dBm as signed bytes (tie). A presence without them, from an older image, is taken as it was.
    # After them (the whole house): the nodes it hears in their safeboot image, which have no mesh and say nothing of themselves but the OTA's
    # beacon to their neighbours: their count, then the node, its state and the percent of its image written, each (at most SB_MAX); a node that is in one
    # or out of it has its hearers say their presence in the next second. Every node keeps what the presences say for 2.5 of the sayer's periods, so the
    # mesh's page of a panel out of the node's reach shows it too
    static MSG_HERE = 0x2D
    static SB_MAX = 8
    static MSG_VIEW_ASK = 0x26    # a panel asks a node for one of its screens
    static MSG_VIEW = 0x27        # a piece of the node's screen, as JSON
    static MSG_VIEW_TAP = 0x28    # a panel touches a row of a node's screen that changes a setting
    static MSG_DO = 0x2E          # the house's server's request, relayed to a node it cannot reach (server_link.be, a hook)
    static MSG_DONE = 0x2F        # that node's answer, in pieces, to the node that relayed it
    static MSG_OTA_ASK = 0x35     # a node out of the server's reach asks a neighbour on the Wi-Fi for its release (node_ota.be, a hook)
    static MSG_OTA_GO = 0x36      # the neighbour has a newer one, and sends it once the node is in its safeboot image
    static MSG_OTA_NO = 0x37      # or it does not, and why
    static MSG_HTTP_REQ = 0x38    # a node with no Wi-Fi's request to the house's server, in pieces, to a neighbour that carries it (mesh_http.be, a hook)
    static MSG_HTTP_ANS = 0x39    # the server's answer, in pieces, back to it
    static MSG_HTTP_MISS = 0x3A   # the pieces a transfer lacks, asked for again
    static HERE_BRIDGE_S = 10
    static HERE_PANEL_S = 30
    # a neighbour whose last heartbeat is older than this is not heard now, though the probes through the others keep it alive (three heartbeats)
    static BEAT_FRESH_MS = 15000
    static GOING_MS = 800         # and it leaves this long after, the word gone out
    static GOING_STEP_MS = 3000   # the panels strike it off one at a time: each waits this much more than the one before it
    static LEAVE_MS = 3000        # a panel that leaves is there this long after it said so: the frames it queued go out
    static REMOVE_MS = 1500       # the node told to leave is struck off this long after: the word goes before the driver forgets the node
    static LEAVE_AGAIN_MS = 700   # the word goes twice, no frame of the house asking for an answer
    # the persist key that says the house this panel is in is the one it founded; and the letters of its own house's code
    static OWN = "house_own"
    static FAV = "house_fav"      # a panel's favourite bridge, its number: the first offered when it adds a Zigbee device
    static CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz"
    # how long a house this panel founded gives its paired bridge, which has none, the welcome by their link
    static GIFT_MS = 120000
    # how long the screens say a node this panel added is starting, until it is heard (PanelHouseView.STARTING_MS): once it is over, they draw again
    static ADDED_MS = 120000

    var list        # the HouseList
    var role        # the role this node has in the house: HouseList.ROLE_PANEL or ROLE_BRIDGE
    var asked       # node -> millis when it was last asked
    var answered    # node -> millis when it was last answered
    var count       # the seconds, for the poll
    var pushed      # node -> what the driver was last given of it
    var push_due    # the driver's table is to be looked at again
    var driver_seen # the table of the driver was read once
    var saved       # the rev of the list that was saved
    var changed     # millis of the last change of the list: a neighbour's heartbeat from before it says nothing of what it holds now
    var key         # the change of the network's key (house_key.be, HouseKey)
    var state       # the state of the devices of other rooms: the marks and the floods (house_state.be, HouseState)
    var devices     # the devices of a bridge, for a panel of another room to pick from (house_devices.be, HouseDevices)
    var link        # a node coming in over the link of the pairing (house_link.be, HouseLink)
    var peer_ver    # node -> the version of the network's key its heartbeat says it has
    var out         # the frames the mesh has not taken yet: [node, bytes, refusals, with the previous key's tag]
    var up          # the rules are in and the list is this node's
    var on_change   # a closure list -> nothing, called when the list changed, or nil
    var revoked_me  # the list says this node was struck off
    var leaving     # this node is on its way out of the house: it does not leave twice
    var gift        # until when the house this panel founded gives its paired bridge, which has none, the welcome by their link (zigbee_pairing.be), or nil
    var own         # [the list's rev, a radio address, a role, the number of the node with them]: number_of's answer, kept
    var fav         # the panel's: the favourite bridge it chose, or 0 (favorite())
    var on_left     # the panel's: a closure () -> nothing, called when this node has left the house (its devices go, panel_boot.be), or nil
    var mqtt        # the house's MQTT as this node takes it (house_mqtt.be), or nil
    var alarm       # the house's configuration of the alarm as this bridge takes it (house_alarm.be), or nil
    var channel     # the house's channel as this node takes it, and the heartbeat's bytes of its radio (house_channel.be), or nil where the image has none
    var events      # the panel's: a closure (node, text, event) -> nothing, an event a bridge said over the mesh, or nil
    var hold        # the panel's: a closure () -> bool, true while it waits at its window for another house to take it, and founds none of its own; the boot's
    var added       # the panel's: node -> millis this panel added it, so that the screens say it is starting until it is heard
    var heard       # the nodes heard on the mesh at the last poll, as one text, to tell when they changed
    var on_heard    # the panel's: a closure () -> nothing, called when a node starts or stops being heard (the screens draw again), or nil
    var on_move     # a closure () -> nothing: this node, out of the house by the word to join another, opens its window there (the panel's boot, the bridge's relay), or nil
    var forgets     # the parts outside this class that keep something by a node's number: closures (members, forgot) -> nothing, which sweep() calls
    var far         # node -> [millis its presence came, its period in ms, its heartbeat's bytes, its tie or nil]: the presence of the nodes of the house (MSG_HERE)
    var here_at     # millis this node last said its presence, or nil before the first
    var far_sb      # node -> [millis, the sayer's period in ms, state, percent, the sayer]: a node in its safeboot image as another's presence says it
    var swept       # the house's numbers as the last sweep saw them, as text, or nil before the first
    var views       # the panel's: node -> {"w": the answer's number, "of": its pieces, "got": piece -> map}, the screen of a node coming in
    var remote      # the panel's: node -> [millis, view, title, rows, closed], the node's screen as it last came (ask_view)
    var on_view     # the panel's: a closure (node) -> nothing, called when a node's screen came (the screens draw again), or nil
    var view_fn     # a closure (view, row or nil) -> [view, title, rows, closed, effects] or nil: this node's screen, as its image draws it, and a touch on it
    var hooks       # message -> a closure (src, frame): the house's frames that another part takes (server_link.be's relay, node_ota.be's neighbour)
    var view_seq    # the number of this node's last answer of a screen
    var safeboot    # the neighbours heard in their safeboot image: node -> [state, block, blocks, image, rssi, millis of the last change], as the OTA driver says it

    def init(role)
        self.role = role
        self.list = HouseList(0)
        self.out = []
        self.key = HouseKey(self)
        self.state = HouseState(self)
        self.devices = HouseDevices(self)
        self.link = HouseLink(self)
        self.peer_ver = {}
        self.asked = {}
        self.answered = {}
        self.count = 0
        self.pushed = {}
        self.push_due = false
        self.driver_seen = false
        self.saved = 0
        self.changed = tasmota.millis()
        self.up = false
        self.on_change = nil
        self.revoked_me = false
        self.leaving = false
        self.fav = 0
        self.added = {}
        self.forgets = []
        self.far = {}
        self.here_at = nil
        self.views = {}
        self.remote = {}
        self.view_seq = 0
        self.safeboot = {}
        self.far_sb = {}
        self.hooks = {}
        import global
        self.channel = global.contains("HouseChannel") ? global.HouseChannel(self) : nil
        tasmota.add_driver(self)
    end

    # --- what the mesh has -------------------------------------------------------------------------------------------

    # whether this image has the driver's functions
    static def here()
        import global
        return global.contains("espnow_mesh_send") && global.contains("espnow_mesh_neighbors") && global.contains("espnow_mesh_info")
    end

    # this node's number on the mesh, or 0 (the driver's, asked muted: it is a read)
    static def mesh_id()
        var r = tasmota.cmd("_EspNowMeshId", true)
        var n = isinstance(r, map) ? r.find("EspNowMeshId") : nil
        return type(n) == "int" ? n : 0
    end

    # this node's public key (32 bytes) and radio address (6), from the driver, or nil
    static def identity()
        var r = tasmota.cmd("_EspNowMeshPublic", true)
        var p = isinstance(r, map) ? r.find("EspNowMeshPublic") : nil
        if !isinstance(p, map) || type(p.find("Public")) != "string" || type(p.find("Mac")) != "string" return nil end
        var key = bytes(p["Public"])
        var mac = bytes(HouseMesh.string_of(p["Mac"]))
        return size(key) == 32 && size(mac) == 6 ? [key, mac] : nil
    end

    # "A0:B7:65:00:00:01" as the hex it is spelled with and no colons
    static def string_of(mac)
        var out = ""
        for i: 0 .. size(mac) - 1
            if mac[i] != ":" out += mac[i] end
        end
        return out
    end

    # The number the house gives the node with this radio address ("A0:B7:65:00:00:01") and this role, or 0: a panel's own bridge, and a bridge's panel, by their
    # pairing. Asked at every line and every event they say, so the answer is kept until the list, the address or the role changes
    def number_of(mac, role)
        if !self.up || self.revoked_me || type(mac) != "string" || size(mac) != 17 return 0 end
        if self.own == nil || self.own[0] != self.list.rev || self.own[1] != mac || self.own[2] != role
            self.own = [self.list.rev, mac, role, self.list.by_mac(bytes(HouseMesh.string_of(mac)), role)]
        end
        return self.own[3]
    end

    # the number the house gives the panel with this radio address, or 0: a bridge's own panel, by their pairing
    def panel_number(mac)
        return self.number_of(mac, HouseList.ROLE_PANEL)
    end

    # --- the nodes of the house, in one place ---------------------------------------------------------------------------
    # The nodes of the house are the list's (a node removed is forgotten whole, and what the parts know of the others comes from here, so
    # that none keeps one the house has not). neighbors() is the mesh's neighbours as every part reads them, and sweep() tells every part that keeps something
    # by a node's number which numbers are the house's, once the list is here and each time it changes: the part drops the rest

    # The mesh's neighbours that are nodes of the house, each as espnow_mesh_neighbors() gives it: a number struck off, of another house on the channel, or not
    # welcomed yet is not there. A node with no list takes them as they are: the bench's mesh, numbered by hand
    def neighbors()
        import global
        if !global.contains("espnow_mesh_neighbors") return [] end
        var l = global.espnow_mesh_neighbors()
        if !isinstance(l, list) return [] end
        if size(self.list.f) == 0 return l end
        var out = []
        for n: l
            if isinstance(n, map) && type(n.find("id")) == "int" && self.list.field(HouseList.K_IDENT, n["id"]) != nil  out.push(n) end
        end
        return out
    end

    # Every part told the house's numbers, `m` (number -> true), or the list's when nil; with the list empty and no `m`, nothing is told: the bench's mesh,
    # numbered by hand, has no list to follow. The names of the nodes the list has just forgotten go with it, once
    def sweep(m)
        if m == nil
            if size(self.list.f) == 0 return end
            var ids = self.list.ids(false)
            if str(ids) == self.swept && size(self.list.forgot) == 0 return end
            self.swept = str(ids)
            m = {}
            for id: ids  m[id] = true end
        end
        var forgot = self.list.forgot
        self.list.forgot = {}
        # this node's own: what it asked, answered and added of each, the key each said, the driver's table past the numbers struck off, and the favourite
        for t: [self.asked, self.answered, self.peer_ver, self.added, self.far, self.views, self.remote]  HouseMesh.prune(t, m) end
        var drop = []
        for k: self.pushed.keys()
            if !m.contains(k) && !self.list.revoked(k)  drop.push(k) end
        end
        for k: drop  self.pushed.remove(k) end
        if self.fav > 0 && !m.contains(self.fav)
            import persist
            self.fav = 0
            persist.remove(HouseMesh.FAV)
            try
                persist.save()
            except .. as e, msg
                log("HOUSE: the favourite bridge's end was not saved (" + str(e) + ": " + str(msg) + ")", 1)
            end
        end
        self.key.sweep(m)
        self.state.sweep(m)
        self.devices.sweep(m)
        for f: self.forgets
            try
                f(m, forgot)
            except .. as e, msg
                log("HOUSE: a part did not forget the nodes gone (" + str(e) + ": " + str(msg) + ")", 1)
            end
        end
    end

    # the entries of a map by number whose number is not in `m`, taken out: true when one was
    static def prune(t, m)
        var drop = []
        for k: t.keys()
            if !m.contains(k)  drop.push(k) end
        end
        for k: drop  t.remove(k) end
        return size(drop) > 0
    end

    # How a node of the house is heard on the mesh now, as an entry of neighbors() (`l`, or the neighbours read now): its own, when it is a neighbour not
    # silent whose heartbeat is fresh; else its presence, fresh (far_entry); else, two hops away, the entry of the neighbour whose heartbeat lists it, which
    # espnow_mesh_route says. A heartbeat is not repeated, so a node beyond the neighbours is seen by its presence, or by the one that hears it (else a
    # node two hops away would be as absent as one switched off). A neighbour whose heartbeats stopped and that the probes keep alive through the
    # others is not heard here. The way back the mesh may keep to a node further away is as old as the last frame that
    # came from it, and says nothing of it now: then its own entry, or its presence gone old (silent), or nil
    def heard_by(node, l)
        import global
        if l == nil  l = self.neighbors() end
        var own = nil
        for x: l
            if isinstance(x, map) && x.find("id") == node  own = x end
        end
        if own != nil && own.find("state", 2) != 2 && HouseMesh.beat_fresh(own) return own end
        var p = self.far_entry(node, tasmota.millis())
        if p != nil && p["state"] == 0 return p end
        if global.contains("espnow_mesh_route")
            var r = global.espnow_mesh_route(node)
            if isinstance(r, list) && size(r) > 1 && r[1] == 2
                for x: l
                    if isinstance(x, map) && x.find("id") == r[0] return x end
                end
            end
        end
        return own != nil ? own : p
    end

    # whether an entry's heartbeat is fresh: one whose "beat" is not said (a test's) is
    static def beat_fresh(x)
        var b = x.find("beat")
        return b == nil || (b >= 0 && b < HouseMesh.BEAT_FRESH_MS)
    end
    # the same, for the parts that hold this house and not its class (house_state.be, panel_house_view.be)
    def fresh(x) return HouseMesh.beat_fresh(x) end

    # whether a node of the house is heard on the mesh now (heard_by): a neighbour, its presence, or a neighbour's, not silent
    def hears(node, l)
        var x = self.heard_by(node, l)
        return x != nil && x.find("state", 2) != 2
    end

    # whether this node hears any node of the house now (`l`, or the neighbours read now): the mesh is up here
    def mesh_up(l)
        if l == nil  l = self.neighbors() end
        for x: l
            if isinstance(x, map) && x.find("state", 2) != 2 return true end
        end
        return false
    end

    # A node's presence as an entry of neighbors(): fresh (state 0) while it is younger than 2.5 of its periods, then silent (2), with "far"; nil when it never
    # said it
    def far_entry(node, now)
        var p = self.far.find(node)
        if p == nil return nil end
        var age = now - p[0]
        return {"id": node, "state": age < p[1] * 5 / 2 ? 0 : 2, "beat": age, "age": age, "info": p[2].tohex(), "far": true}
    end

    # The neighbours (`l`, or the neighbours read now) and, for a node of the house no heartbeat brings here, its presence (far_entry): every node of the house
    # this one knows of, for what counts them all (the alarm's replica)
    def heard_all(l)
        if l == nil  l = self.neighbors() end
        if size(self.far) == 0 return l end
        var out = []
        var seen = {}
        for x: l
            out.push(x)
            if isinstance(x, map)  seen[x.find("id")] = true end
        end
        var now = tasmota.millis()
        for n: self.far.keys()
            if !seen.contains(n)  out.push(self.far_entry(n, now)) end
        end
        return out
    end

    # The presence, said every period: a node of a house of more than one, once its mesh runs. The first a moment after the start, by its number, so that the
    # nodes of a house started together do not all say it at once
    def say_here()
        import global
        if !self.up || self.leaving || size(self.list.ids(false)) < 2 || !global.contains("espnow_mesh_send") return end
        var s = self.role == HouseList.ROLE_BRIDGE ? HouseMesh.HERE_BRIDGE_S : HouseMesh.HERE_PANEL_S
        var period = s * 1000
        var now = tasmota.millis()
        if self.here_at == nil  self.here_at = now - period + 1000 + (self.list.me * 1300) % period end
        if now - self.here_at < period return end
        self.here_at = now
        var info = MeshBeat.shared().buf.copy()
        var c = global.contains("espnow_mesh_clock") ? global.espnow_mesh_clock() : nil
        if isinstance(c, map) && c.find("synced", false) == true  info[19] = info[19] | 1 end
        var b = bytes()
        b.add(HouseMesh.MSG_HERE, 1)
        b.add(HouseMesh.WIRE, 1)
        b.add(s, 1)
        b .. info
        for v: self.tie()  b.add(v & 0xFF, 1) end
        b .. self.safeboot_said()
        global.espnow_mesh_send(255, HouseState.T_FLOOD, false, b)
    end

    # The nodes this node hears in their safeboot image, as its presence says them: their count, then [node, state, the percent of its image written]
    # each; nothing when it hears none
    def safeboot_said()
        var b = bytes()
        var ns = []
        for n: self.safeboot.keys()
            if size(ns) < HouseMesh.SB_MAX  ns.push(n) end
        end
        if size(ns) == 0 return b end
        b.add(size(ns), 1)
        for n: ns
            var s = self.safeboot[n]
            var pct = s[2] > 0 ? s[1] * 100 / s[2] : 0
            b.add(n & 0xFF, 1)
            b.add(s[0] & 0xFF, 1)
            b.add(pct > 100 ? 100 : pct, 1)
        end
        return b
    end

    # its presence said in the next second: a node it hears went into its safeboot image or came out of it
    def here_soon()
        if self.here_at == nil return end
        var s = self.role == HouseList.ROLE_BRIDGE ? HouseMesh.HERE_BRIDGE_S : HouseMesh.HERE_PANEL_S
        self.here_at = tasmota.millis() - s * 1000
    end

    # How this node is tied to the mesh and to the Wi-Fi, for its presence and its own row of the mesh's screen: [how many nodes of the house it hears on the
    # radio now (the core's count: the neighbours it counts on and the ones it hears and does not, espnow_mesh_health), the signal of the best of them (0 for
    # none), its Wi-Fi's signal (0 off the Wi-Fi, 1 on it with no signal said)]
    def tie()
        import global
        var hl = global.contains("espnow_mesh_health") ? global.espnow_mesh_health() : nil
        var n = isinstance(hl, map) ? hl.find("neighbors", 0) + hl.find("weak", 0) : 0
        var best = 0
        if n > 0
            for x: self.neighbors()
                if !isinstance(x, map) || x.find("state", 2) == 2 || !HouseMesh.beat_fresh(x) continue end
                var r = x.find("rssi", 0)
                if type(r) == "int" && r != 0 && (best == 0 || r > best)  best = r end
            end
        end
        var wf = tasmota.wifi()
        var w = 0
        if isinstance(wf, map) && wf.find("up", false)
            var r = wf.find("rssi", 0)
            w = type(r) == "int" && r < 0 ? r : 1
        end
        return [n < 255 ? n : 255, best, w]
    end

    # a node's presence: kept, of a node of the house that is not this one, with how it says it is tied to the mesh when it says it
    def take_here(src, d)
        if size(d) < 3 + 20 || d[1] != HouseMesh.WIRE || src == self.list.me || self.list.field(HouseList.K_IDENT, src) == nil || self.list.revoked(src) return end
        var info = d[3 ..]
        var t = nil
        if size(d) >= 3 + MeshBeat.SIZE + 3
            info = d[3 .. 2 + MeshBeat.SIZE]
            var r = d[4 + MeshBeat.SIZE]
            var w = d[5 + MeshBeat.SIZE]
            t = [d[3 + MeshBeat.SIZE], r > 127 ? r - 256 : r, w > 127 ? w - 256 : w]
        end
        var now = tasmota.millis()
        var period = (d[2] > 0 ? d[2] : HouseMesh.HERE_PANEL_S) * 1000
        self.far[src] = [now, period, info, t]
        # the nodes it hears in their safeboot image; and the sayer itself, in its presence again, is out of its own
        var told = self.far_sb.contains(src)
        if told  self.far_sb.remove(src) end
        var at = 6 + MeshBeat.SIZE
        if size(d) > at
            for i: 0 .. d[at] - 1
                var o = at + 1 + 3 * i
                if o + 2 >= size(d) break end
                var n = d[o]
                if n == self.list.me continue end
                var f = self.far_sb.find(n)
                if f == nil || HouseMesh.sb_stale(f, now) || f[2] != d[o + 1] || f[3] != d[o + 2]  told = true end
                self.far_sb[n] = [now, period, d[o + 1], d[o + 2], src]
            end
        end
        if told  self.heard_now() end
    end

    # the screens told a node was heard, or no longer is
    def heard_now()
        if self.on_heard == nil return end
        try
            self.on_heard()
        except .. as e, m
            log("HOUSE: a listener of the nodes heard failed (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # how a node of the house says it is tied to the mesh and to the Wi-Fi, by its presence while that is fresh (tie), or nil
    def tie_of(node)
        var p = self.far.find(node)
        if p == nil || size(p) < 4 || p[3] == nil || tasmota.millis() - p[0] >= p[1] * 5 / 2 return nil end
        return p[3]
    end

    # Whether a node is in step on the mesh now, by the heartbeats it is heard by (heard_by): heard, not silent, and with the bit "synced" of the byte 19 of
    # the heartbeat on, which the mesh's core writes for every node. Two hops away, it is the bit of the neighbour that hears it: the node's own is not heard
    # here, and a bridge that is not in step refuses what it is sent (mesh_cmd.be). What each side of a pair looks at to keep its direct link off,
    # and how a panel chooses the bridge of the house (favorite)
    def in_step(node, l)
        if node <= 0 return false end
        var x = self.heard_by(node, l)
        if x == nil return false end
        var info = x.find("info")
        if x.find("state", 2) == 2 || type(info) != "string" return false end
        var b = bytes(info)
        return size(b) > 19 && (b[19] & 1) != 0
    end

    # --- the events of a bridge to the panels -----------------------------------
    # What the relay says to the panels goes over the mesh to each panel that hears that bridge, by its number, a frame of the house [MSG_EVENT, WIRE, the event as
    # text]: the panel paired with it takes it while their link is down, and the others always

    # what an event to the node `dest` carries over the mesh, past its head, or 0 for no node
    def node_room(dest)
        return dest > 0 ? HouseMesh.room_to(dest) - 2 : 0
    end

    # what a frame of the house to `dest` carries, its head with it
    static def room_to(dest)
        import global
        return global.contains("espnow_mesh_max_payload") ? global.espnow_mesh_max_payload(dest) : 200
    end

    # an event to the node `dest`: false for no node, or an event that does not fit a frame to it
    def event_node(dest, text)
        if dest <= 0 || size(text) + 2 > HouseMesh.room_to(dest) return false end
        var b = bytes()
        b.add(HouseMesh.MSG_EVENT, 1)
        b.add(HouseMesh.WIRE, 1)
        b .. bytes().fromstring(text)
        return self.send(dest, b, nil)
    end

    # an event of a node, as its text, to whom takes them: the panel's boot, which hands those of its own bridge to the rules. What is not an event is let go
    def take_event(src, d)
        if self.events == nil || size(d) <= 2 return end
        import json
        var text = d[2 ..].asstring()
        var m = json.load(text)
        if isinstance(m, map)  self.events(src, text, m) end
    end

    # --- start -------------------------------------------------------------------------------------------------------

    # the node has a number: the list is its own, read from the flash, and the rules are in
    def attach(id)
        self.list.me = id
        self.list.load()
        self.saved = self.list.rev
        self.revoked_me = self.list.revoked(id)
        self.key.attach()
        if self.role == HouseList.ROLE_BRIDGE self.state.load() end
        if self.role == HouseList.ROLE_PANEL
            import persist
            var f = persist.find(HouseMesh.FAV, 0)
            self.fav = type(f) == "int" ? f : 0
        end
        var ev = MeshEvents.get()
        ev.add("frame", / v -> self.on_frame(v), HouseMesh.T_RULE)
        ev.add("Timeline", / v -> self.mesh_changed(), HouseMesh.T_RULE)
        ev.add("Synced", / v -> self.mesh_changed(), HouseMesh.T_RULE)
        ev.add("Ota", / v -> self.on_ota(v), HouseMesh.T_RULE)
        self.up = true
        self.push_due = true
        self.publish()
        # the house's MQTT, when the list has one this node has not applied, and the alarm's configuration
        if self.mqtt != nil  self.mqtt.later() end
        if self.alarm != nil  self.alarm.later() end
        if self.channel != nil  self.channel.later() end
        self.swept = nil
        self.sweep(nil)
    end

    # --- the heartbeat -----------------------------------------------------------------------------------------------

    # the mesh took a timeline or started again: the driver may have lost the heartbeat's bytes, and they are given again
    def mesh_changed()
        MeshBeat.shared().forget()
        self.publish()
    end

    # the digest and the identity prefix, in the buffer, and the buffer given to the driver. True when the driver took it
    def publish()
        var beat = MeshBeat.shared()
        var me = self.list.node(self.list.me)
        var prefix = bytes(-2)
        if me != nil
            prefix[0] = me["key"][0]
            prefix[1] = me["key"][1]
        end
        beat.put(HouseMesh.ID_AT, prefix)
        var d = self.list.digest()
        var b = bytes(-3)
        b[0] = (d >> 16) & 255
        b[1] = (d >> 8) & 255
        b[2] = d & 255
        beat.put(HouseMesh.DIGEST_AT, b)
        return beat.flush()
    end

    # --- the list changed ---------------------------------------------------------------------------------------------

    def touched()
        self.changed = tasmota.millis()
        self.push_due = true
        self.revoked_me = self.list.me >= 1 && self.list.revoked(self.list.me)
        # a node that finds itself struck off leaves the house: a panel that removed it may also have told it (told_leave)
        if self.revoked_me && !self.leaving
            self.leaving = true
            log("HOUSE: this node was struck off the house, and leaves it", 1)
            tasmota.set_timer(0, / -> self.leave())
            return
        end
        self.publish()
        self.settle_lost()
        if self.mqtt != nil  self.mqtt.later() end
        if self.alarm != nil  self.alarm.later() end
        if self.channel != nil  self.channel.later() end
        if self.on_change != nil
            try
                self.on_change(self.list)
            except .. as e, m
                log("HOUSE: a listener of the list failed (" + str(e) + ": " + str(m) + ")", 1)
            end
        end
        self.sweep(nil)
    end

    # an identity of this node's that another took the number of: it is given another, and the node has to be told the number
    def settle_lost()
        while size(self.list.lost) > 0
            var x = self.list.lost.pop()
            if !self.list.is_panel(self.list.me) continue end
            var id = self.list.next_id()
            if id == 0 continue end
            self.list.author(HouseList.K_IDENT, id, x[1])
            self.touched_quiet()
            log("HOUSE: the number " + str(x[0]) + " was taken by another identity: the node that had it is " + str(id) + " now, and has to be told (EspNowMeshId " + str(id) + ")", 1)
        end
    end

    def touched_quiet()
        self.push_due = true
        self.publish()
    end

    # --- the frames --------------------------------------------------------------------------------------------------

    # a frame to a node: kept until the mesh takes it. The mesh takes a few at a time (the driver's queue holds 4), so a snapshot of several frames goes out over some turns.
    # `prev`: with the tag of the previous key of the network (true, for the node that has not taken a change of the key) or the key in use (false); nil lets this node choose
    def send(dest, b, prev)
        if size(self.out) >= HouseMesh.OUT_MAX return false end
        self.out.push([dest, b, 0, prev == nil ? self.use_previous(dest) : prev])
        self.flush_out()
        return true
    end

    # while this node holds a previous key, a node that does not say it has the key in use is sent frames the previous key can check, and the others the ones the key in use does
    def use_previous(dest)
        return self.key.holds && self.peer_ver.find(dest) != self.key.version
    end

    def flush_out()
        import global
        if size(self.out) == 0 || !global.contains("espnow_mesh_send") return end
        while size(self.out) > 0
            var x = self.out[0]
            if global.espnow_mesh_send(x[0], HouseMesh.T_MEMBER, false, x[1], x[3]) != false
                self.out.remove(0)
            else
                x[2] += 1
                if x[2] >= HouseMesh.TRIES
                    log("HOUSE: the mesh took no frame for " + str(x[0]), 3)
                    self.out.remove(0)
                end
                return
            end
        end
    end

    def every_100ms()
        if size(self.out) > 0 self.flush_out() end
        if self.link.role != nil self.link.tick() end
    end

    # a frame for this node: of the house's three messages, to this node alone, and not the mesh's repeat of one it handed over before
    def on_frame(f)
        if !isinstance(f, map) || !f.contains('Data') return end
        # the state of a device, to everyone (house_state.be)
        if f.find('Type') == HouseState.T_FLOOD
            var s = bytes(f['Data'])
            if size(s) > 1 && s[0] == HouseState.MSG_STATE self.state.on_frame(f.find('From', 0), HouseState.T_FLOOD, s) end
            if size(s) > 1 && s[0] == HouseMesh.MSG_HERE self.take_here(f.find('From', 0), s) end
            return
        end
        if f.find('Type') != HouseMesh.T_MEMBER return end
        if (f.find('Flags', 0) & 2) != 0 || f.find('Dest', 0) != self.list.me return end
        var d = bytes(f['Data'])
        if size(d) < 2 || d[1] != HouseMesh.WIRE return end
        var src = f.find('From', 0)
        if d[0] == HouseMesh.MSG_ASK
            self.answer(src, d)
        elif d[0] == HouseMesh.MSG_ENTRIES
            self.take(src, d)
        elif d[0] == HouseMesh.MSG_VEC
            self.heard_vector(src, d)
        elif d[0] == HouseKey.MSG_KEY
            self.key.take_key(src, d)
        elif d[0] == HouseKey.MSG_ACK
            self.key.take_ack(src, d)
        elif d[0] == HouseKey.MSG_CLOSE
            self.key.take_close(src, d)
        elif d[0] == HouseState.MSG_STATE || d[0] == HouseState.MSG_ASK || d[0] == HouseState.MSG_MARK
            self.state.on_frame(src, HouseMesh.T_MEMBER, d)
        elif d[0] == HouseDevices.MSG_LIST || d[0] == HouseDevices.MSG_ITEM
            self.devices.on_frame(src, d)
        elif d[0] == HouseMesh.MSG_LEAVE
            self.told_leave(src)
        elif d[0] == HouseMesh.MSG_EVENT
            self.take_event(src, d)
        elif d[0] == HouseMesh.MSG_GOING
            self.told_going(src)
        elif d[0] == HouseMesh.MSG_MOVE
            self.told_move(src)
        elif d[0] == HouseMesh.MSG_VIEW_ASK || d[0] == HouseMesh.MSG_VIEW_TAP
            self.told_view(src, d, d[0] == HouseMesh.MSG_VIEW_TAP)
        elif d[0] == HouseMesh.MSG_VIEW
            self.take_view(src, d)
        elif self.hooks.contains(d[0])
            self.hooks[d[0]](src, d)
        end
    end

    # a part's own frames of the house, to its closure (src, frame)
    def hook(msg, f) self.hooks[msg] = f end

    # The nodes of the house this node hears on the radio now whose heartbeat says they are on a Wi-Fi access point, the best signal first: the ones
    # that may fetch from the server for it (node_ota.be)
    def wifi_neighbours()
        var l = []
        for x: self.neighbors()
            if !isinstance(x, map) || x.find("state", 2) == 2 || !HouseMesh.beat_fresh(x) continue end
            var radio = HouseChannel.of_info(x.find("info"))
            if radio == nil || radio["ap"] == 0 continue end
            var r = x.find("rssi", 0)
            var e = [type(r) == "int" && r != 0 ? r : -127, x["id"]]
            var i = 0
            while i < size(l) && l[i][0] >= e[0]  i += 1 end
            l.insert(i, e)
        end
        var out = []
        for e: l  out.push(e[1]) end
        return out
    end

    # the vector to a node, asking: no oftener than ASK_GAP_MS
    def ask(dest, now)
        var was = self.asked.find(dest)
        if was != nil && now - was < HouseMesh.ASK_GAP_MS return false end
        self.asked[dest] = now
        var b = bytes()
        b.add(HouseMesh.MSG_ASK, 1)
        b.add(HouseMesh.WIRE, 1)
        b .. self.list.vector()
        return self.send(dest, b)
    end

    def send_vector(dest)
        var b = bytes()
        b.add(HouseMesh.MSG_VEC, 1)
        b.add(HouseMesh.WIRE, 1)
        b .. self.list.vector()
        return self.send(dest, b)
    end

    # what this panel wrote that the asker has not, in as many frames as it takes; the last says the author's seq
    def send_entries(dest, above)
        var es = self.list.entries_of(self.list.me, above)
        var upto = self.list.mine
        var i = 0
        var more = true
        while more
            var b = bytes()
            b.add(HouseMesh.MSG_ENTRIES, 1)
            b.add(HouseMesh.WIRE, 1)
            b.add(self.list.me, 1)
            b.add(0, 1)
            b.add(upto, -2)
            var start = i
            while i < size(es) && size(b) + size(es[i]) <= HouseMesh.FRAME
                b .. es[i]
                i += 1
            end
            more = i < size(es)
            if !more b[3] = 1 end
            self.send(dest, b)
            if more && i == start break end
        end
    end

    # an ask: this panel's entries the asker lacks, and the vector when it is not the asker's
    def answer(src, d)
        var theirs = HouseList.parse_vector(d, 2)
        if theirs == nil return end
        var now = tasmota.millis()
        var last = self.answered.find(src)
        if last != nil && now - last < HouseMesh.ANSWER_GAP_MS return end
        self.answered[src] = now
        var me = self.list.me
        if me >= 1 && self.list.is_panel(me)
            var above = theirs.find(me)
            if above == nil above = 0 end
            if self.list.mine > above self.send_entries(src, above) end
        end
        var mine_v = self.list.vector()
        if (size(d) > 2 ? d[2 ..] : bytes()) != mine_v self.send_vector(src) end
    end

    # entries: from their author alone, who is a panel of the list
    def take(src, d)
        if size(d) < HouseMesh.HEAD return end
        var author = d[2]
        var upto = d.get(4, -2)
        if author != src || !self.list.is_panel(src) return end
        var es = HouseList.decode(d, HouseMesh.HEAD)
        var changed = false
        for e: es
            if e[2] > upto return end
        end
        for e: es
            if self.list.apply(author, e[2], e[3], e[0], e[1], e[4]) > 0 changed = true end
        end
        if d[3] == 1 && self.list.take_upto(author, upto) changed = true end
        if changed self.touched() end
    end

    # another's vector: the panels it is ahead of this node in are asked, each for its own entries
    def heard_vector(src, d)
        var theirs = HouseList.parse_vector(d, 2)
        if theirs == nil return end
        var now = tasmota.millis()
        for x: self.list.behind(theirs)
            if x[0] != self.list.me && self.list.is_panel(x[0]) self.ask(x[0], now) end
        end
    end

    # --- every second ------------------------------------------------------------------------------------------------

    def every_second()
        if !self.up
            if !HouseMesh.here() return end
            var id = HouseMesh.mesh_id()
            if id < 1
                if self.role == HouseList.ROLE_PANEL && !self.leaving && (self.hold == nil || !self.hold()) self.found_own() end
                return
            end
            self.attach(id)
        end
        self.count += 1
        if self.list.rev != self.saved self.keep() end
        if MeshBeat.shared().sent == nil self.publish() end
        if self.push_due self.push() end
        self.key.tick()
        self.state.tick()
        self.say_here()
        self.devices.tick()
        if self.count % HouseMesh.POLL_S == 0 self.poll() end
        if self.channel != nil && self.count % HouseChannel.POLL_S == 0  self.channel.poll() end
    end

    # the list in the flash
    def keep()
        var rev = self.list.rev
        try
            self.list.save()
            self.saved = rev
        except .. as e, m
            log("HOUSE: the list was not saved (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # A neighbour in its safeboot image, as the OTA driver hears its beacon (xdrv_98_7: {"Node", "State", "Block", "Blocks"}, or {"Node", "Gone"} when it
    # has not been heard for a while): kept for the mesh's page, which draws again. A node in its safeboot image has no mesh, so this is what says it is there
    def on_ota(v)
        if !isinstance(v, map) || type(v.find("Node")) != "int" return end
        var n = v["Node"]
        if v.find("Gone", 0)
            if !self.safeboot.contains(n) return end
            self.safeboot.remove(n)
            self.here_soon()
        else
            if !self.safeboot.contains(n)  self.here_soon() end
            # and, for a neighbour that sends it its image when it stalls (node_ota.be), the image's SHA-256 prefix ("" before its manifest), the
            # signal, and when what it says last changed: the driver tells only a change, so that is its last progress
            var image = v.find("Image", "")
            self.safeboot[n] = [v.find("State", 0), v.find("Block", 0), v.find("Blocks", 0), image == "00000000" ? "" : str(image),
                                v.find("Rssi", 0), tasmota.millis()]
        end
        self.heard_now()
    end

    # [state, block, blocks] of a node in its safeboot image: heard by this node, or said in another's presence while that is fresh (its percent, of 100);
    # or nil
    def safeboot_of(n)
        var s = self.safeboot.find(n)
        if s != nil return s end
        var f = self.far_sb.find(n)
        if f == nil || HouseMesh.sb_stale(f, tasmota.millis()) return nil end
        return [f[2], f[3], 100]
    end

    # a node in its safeboot image as another's presence said it, said longer ago than 2.5 of the sayer's periods
    static def sb_stale(f, now) return now - f[0] >= f[1] * 5 / 2 end

    # The neighbours' heartbeats: one whose digest is not this node's is asked for its vector, unless it holds nothing (it asks this node), is silent, or sent the heartbeat
    # before the last change of this node's list
    def poll()
        var l = self.neighbors()
        var mine = self.list.digest()
        var now = tasmota.millis()
        var heard = ""
        for n: l
            if n.find('state', 2) > 1 continue end
            heard += str(n['id']) + ","
            self.peer_ver[n['id']] = n.find('key', 0)
            var info = bytes(n.find('info', ''))
            if size(info) < HouseMesh.DIGEST_AT + 3 || info[0] != 1 continue end
            var theirs = (info[HouseMesh.DIGEST_AT] << 16) | (info[HouseMesh.DIGEST_AT + 1] << 8) | info[HouseMesh.DIGEST_AT + 2]
            if theirs == mine || theirs == 0 continue end
            var beat = n.find('beat', -1)
            if beat < 0 || (now - beat) - self.changed < 0 continue end
            self.ask(n['id'], now)
        end
        # a node another's presence said in its safeboot image, no longer said: forgotten
        var old = []
        for n: self.far_sb.keys()
            if HouseMesh.sb_stale(self.far_sb[n], now)  old.push(n) end
        end
        for n: old  self.far_sb.remove(n) end
        # a node that starts or stops being heard changes what the screens say of it: they are drawn again (the mesh's list showed "No signal"
        # until something else redrew it)
        if heard != self.heard || size(old) > 0
            self.heard = heard
            self.heard_now()
        end
    end

    # the next poll tells the screens, as if the nodes heard had changed
    def forget_heard()
        self.heard = nil
    end

    # --- the driver's table --------------------------------------------------------------------------------------------

    # what the driver is told of a node of the list: the identity and the address, in the words of EspNowMeshNode; or nil for a number struck off, which has none
    static def line_of(id, n)
        if n == nil return nil end
        var out = "EspNowMeshNode " + str(id) + "," + HouseMesh.mac_text(n["mac"]) + "," + n["key"].tohex()
        if n["ip"] != nil && n["ip"].tohex() != "00000000" out += "," + HouseMesh.ip_text(n["ip"]) end
        return out
    end

    # 6 bytes as "A0:B7:65:00:00:01", and 4 as "192.168.0.61": the driver's words
    static def mac_text(mac)
        var h = mac.tohex()
        var text = ""
        for i: 0 .. 5
            if i > 0 text += ":" end
            text += h[i * 2 .. i * 2 + 1]
        end
        return text
    end

    static def ip_text(ip)
        return str(ip[0]) + "." + str(ip[1]) + "." + str(ip[2]) + "." + str(ip[3])
    end

    # the nodes the driver has, as id -> "mac,ip": what a start of this node finds in its flash, so that it is not written there again
    def read_driver()
        var r = tasmota.cmd("_EspNowMeshNode", true)
        var l = isinstance(r, map) ? r.find("EspNowMeshNode") : nil
        if !isinstance(l, list) return {} end
        var out = {}
        for x: l
            if isinstance(x, map) && type(x.find("Id")) == "int" out[x["Id"]] = str(x.find("Mac", "")) + "," + str(x.find("Ip", "")) end
        end
        return out
    end

    # a few nodes of the list given to the driver, and the struck off taken out
    def push()
        var had = self.driver_seen ? nil : self.read_driver()
        self.driver_seen = true
        var todo = []
        for id: self.list.ids(true)
            if id == self.list.me continue end
            var n = self.list.node(id)
            var sig = n == nil ? "r" : (n["key"].tohex() + n["mac"].tohex() + (n["ip"] == nil ? "" : n["ip"].tohex()))
            if self.pushed.find(id) == sig continue end
            if had != nil
                # the driver kept what it was given before: a node it has with the same address is taken to have the same key, and one it does not have is already out
                var h = had.find(id)
                if n == nil && h == nil
                    self.pushed[id] = sig
                    continue
                end
                if n != nil && h != nil && h == HouseMesh.mac_text(n["mac"]) + "," + (n["ip"] == nil ? "0.0.0.0" : HouseMesh.ip_text(n["ip"]))
                    self.pushed[id] = sig
                    continue
                end
            end
            todo.push([id, sig, n])
        end
        var done = 0
        for x: todo
            if done >= HouseMesh.PUSH_PER_TURN break end
            var line = HouseMesh.line_of(x[0], x[2])
            if line == nil line = "EspNowMeshNode " + str(x[0]) + ",0" end
            tasmota.cmd(line, true)
            self.pushed[x[0]] = x[1]
            done += 1
        end
        self.push_due = size(todo) > done
    end

    # the list as the pairing of this node gives it: the first copy, from the panel that took the node into the house. What the node held before is gone
    def adopt(m)
        if !isinstance(m, map) return false end
        # a live panel's list, of now: not one a build that knew less saved (house_list.be, FORMAT)
        if !m.contains("k")  m["k"] = HouseList.FORMAT end
        self.list.from_map(m)
        self.wrote()
        return true
    end

    # --- what a person's act writes ----------------------------------------------------------------------------------

    # whether this node may write: a panel that is in the list, not struck off
    def writes()
        return self.list.me >= 1 && self.list.is_panel(self.list.me)
    end

    # the entries written, kept and said
    def wrote()
        self.touched()
        self.keep()
    end

    # The house is made by the first panel: the key of the network is drawn (a panel that has one in its driver keeps it), the panel's own identity and the name are the list.
    # `id` is the number the panel is to have when it has none. False when the house already has nodes, or this node has no number, or no identity, or the driver took no key
    def found(name, id)
        # a house is founded by a panel: a bridge writes nothing into the list
        if self.role != HouseList.ROLE_PANEL return false end
        if self.list.me < 1
            if id == nil || id < 1 || id > HouseList.MAX_NODE return false end
            tasmota.cmd("EspNowMeshId " + str(id), true)
            if HouseMesh.mesh_id() != id return false end
        end
        if size(self.list.ids(true)) > 0 return false end
        var who = HouseMesh.identity()
        if who == nil return false end
        var s = HouseKey.status()
        if s == nil return false end
        if s[0] == 0
            import crypto
            var k = crypto.random(32).tohex()
            if !HouseKey.give(k, 1) return false end
            self.key.keep_cur(1, k)
            self.key.version = 1
        end
        if !self.up self.attach(HouseMesh.mesh_id()) end
        var d = bytes()
        d.add(HouseList.ROLE_PANEL, 1)
        d .. who[0]
        d .. who[1]
        if self.list.author(HouseList.K_IDENT, self.list.me, d) == nil return false end
        self.list.author(HouseList.K_NAME, 0, bytes().fromstring(name))
        tasmota.cmd("EspNowMeshEnable 1", true)
        self.wrote()
        HouseMesh.mark_own(true)
        self.gift = tasmota.millis() + HouseMesh.GIFT_MS
        return true
    end

    # A panel's own house: whenever the driver runs with no number, the panel founds a house of one, named "House-" and the code of its radio
    # address (own_name): at its first boot, and as soon as it has left a house. False while the driver has no identity yet: the next second tries again
    def found_own()
        var who = HouseMesh.identity()
        if who == nil return false end
        if !self.found(HouseMesh.own_name(who[1]), 1) return false end
        log("HOUSE: this panel founded its own house, " + self.list.name(), 2)
        return true
    end

    # "House-" and six letters of Crockford's base 32, in lower case, of the low 30 bits of a radio address: the part of it the maker numbers
    static def own_name(mac)
        var v = ((mac[2] & 0x3F) << 24) | (mac[3] << 16) | (mac[4] << 8) | mac[5]
        var out = "House-"
        for i: 0 .. 5
            out += HouseMesh.CROCKFORD[(v >> (5 * (5 - i))) & 31]
        end
        return out
    end

    # whether the house this panel is in is the one it founded
    def own_house()
        import persist
        return persist.find(HouseMesh.OWN) == true
    end

    # the house this panel is in is the one it founded (`yes`), or another's, which it came into by a welcome
    static def mark_own(yes)
        import persist
        if (persist.find(HouseMesh.OWN) == true) == yes return end
        if yes persist.setmember(HouseMesh.OWN, true) else persist.remove(HouseMesh.OWN) end
        try
            persist.save()
        except .. as e, m
            log("HOUSE: the flash was not saved (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # --- a node comes into the house ---------------------------------------------------------------------------------------

    # a sum of bytes that says the pieces of a welcome were put together as they were made: FNV-1a, 32 bits, as 4 bytes
    static def sum_of(b)
        var h = 0x811C9DC5
        for i: 0 .. size(b) - 1
            h = (h ^ b[i]) * 0x01000193
        end
        var out = bytes()
        out.add(h, -4)
        return out
    end

    # What a panel gives a node that is coming into the house, for the pairing to carry (the signed, sealed link of the pairing, this does not say how): the number
    # the node is to have, the key of the network and its version, and the list as this panel holds it, in pieces of up to `width` bytes of data (PIECE when nil), each [index,
    # how many, data]. nil when this node is not a panel of the house, the node is not in the list or was struck off, or this panel does not have the key (the driver never says it)
    def welcome(id, width)
        if !self.writes() return nil end
        var n = self.list.node(id)
        var c = self.key.cur()
        if n == nil || c == nil return nil end
        var m = self.list.to_map()
        var vb = bytes(m["v"])
        var fb = bytes(m["f"])
        var b = bytes()
        b.add(HouseMesh.WELCOME_WIRE, 1)
        b.add(id, 1)
        b.add(c[0], 1)
        b .. c[1]
        b.add(size(vb), -2)
        b .. vb
        b .. fb
        b .. HouseMesh.sum_of(b)
        var w = width == nil ? HouseMesh.PIECE : width
        var total = (size(b) + w - 1) / w
        var out = []
        for i: 0 .. total - 1
            var p = bytes()
            p.add(i, 1)
            p.add(total, 1)
            var from = i * w
            var to = from + w - 1
            if to >= size(b) to = size(b) - 1 end
            p .. b[from .. to]
            out.push(p)
        end
        return out
    end

    # what a node that is coming into the house is given: the pieces of a welcome, in any order, some more than once. The node takes the number, the key and the list, and starts the
    # mesh. False, and nothing changed, when the pieces are not a whole welcome that was made as it is, or when the node is in a house already (it takes the button to leave one)
    def accept(pieces)
        if !isinstance(pieces, list) return false end
        var total = 0
        var got = {}
        for p: pieces
            if !isinstance(p, bytes) || size(p) < 3 || p[1] < 1 || p[0] >= p[1] return false end
            if total == 0 total = p[1] end
            if p[1] != total return false end
            got[p[0]] = p[2 ..]
        end
        if total == 0 || size(got) != total return false end
        var b = bytes()
        for i: 0 .. total - 1
            b .. got[i]
        end
        if size(b) < 41 || b[0] != HouseMesh.WELCOME_WIRE return false end
        if HouseMesh.sum_of(b[0 .. size(b) - 5]) != b[size(b) - 4 ..] return false end
        var s = HouseKey.status()
        if s == nil || s[0] != 0
            log("HOUSE: a node that is in a house is not given another", 1)
            return false
        end
        var id = b[1]
        var ver = b[2]
        var vlen = b.get(35, -2)
        if id < 1 || id > HouseList.MAX_NODE || ver < 1 || 37 + vlen > size(b) - 4 return false end
        var m = {"v": vlen > 0 ? b[37 .. 36 + vlen].tohex() : "", "f": 37 + vlen < size(b) - 4 ? b[37 + vlen .. size(b) - 5].tohex() : "", "m": 0, "a": 0}
        var key_hex = b[3 .. 34].tohex()
        tasmota.cmd("EspNowMeshId " + str(id), true)
        if !HouseKey.give(key_hex, ver) return false end
        if !self.up
            self.attach(id)
        else
            self.list.me = id
            self.key.attach()
        end
        self.key.keep_cur(ver, key_hex)
        self.adopt(m)
        tasmota.cmd("EspNowMeshEnable 1", true)
        # a house this panel came into is another's: its own is the one it founds when it leaves this
        if self.role == HouseList.ROLE_PANEL HouseMesh.mark_own(false) end
        return true
    end

    # a node given a number: its identity, and its address and its name when there are, and, for a bridge, the alarm number. `want` is the number the node already has (the
    # bench numbers its nodes by hand); without it the next number never used. The number, or 0 when there is none, or this node cannot write
    def add_node(role, key, mac, ip, name, want)
        if !self.writes() return 0 end
        var id = want == nil ? self.list.next_id() : want
        if id < 1 || id > HouseList.MAX_NODE || self.list.field(HouseList.K_IDENT, id) != nil return 0 end
        var d = bytes()
        d.add(role, 1)
        d .. key
        d .. mac
        if self.list.author(HouseList.K_IDENT, id, d) == nil return 0 end
        if ip != nil self.list.author(HouseList.K_ADDR, id, ip) end
        if name != nil && name != "" self.list.author(HouseList.K_NAME, id, bytes().fromstring(name)) end
        if role == HouseList.ROLE_BRIDGE
            var s = self.list.free_slot()
            if s > 0
                var sb = bytes()
                sb.add(s, 1)
                self.list.author(HouseList.K_SLOT, id, sb)
            end
        end
        self.wrote()
        self.added[id] = tasmota.millis()
        # once the time to start is over, the next poll draws the screens again, whether the node was heard or not
        tasmota.set_timer(HouseMesh.ADDED_MS + 100, / -> self.forget_heard())
        # the first bridge a panel adds is its favourite, until it chooses another
        if role == HouseList.ROLE_BRIDGE && self.fav == 0  self.set_favorite(id) end
        return id
    end

    # --- the favourite bridge of a panel ----------------------------------------------------------
    # A panel's own preference, kept on it and not in the list: only it uses it. The first bridge offered when it adds a Zigbee device, and the one it says the house's
    # things to (the alarm, the time) while that bridge is in step. Chosen on a bridge's page; the first bridge the panel adds; and with none chosen, or the one chosen gone,
    # the first bridge in step on the mesh, or the first of the list

    # the favourite bridge's number, or 0 with no bridge in the house
    def favorite()
        if self.fav > 0 && self.list.role(self.fav) == HouseList.ROLE_BRIDGE && !self.list.revoked(self.fav) return self.fav end
        var first = 0
        for id: self.bridges()
            if self.in_step(id) return id end
            if first == 0  first = id end
        end
        return first
    end

    # a bridge of the house as this panel's favourite: false for what is not one, and on a bridge
    def set_favorite(id)
        import persist
        if self.role != HouseList.ROLE_PANEL || self.list.role(id) != HouseList.ROLE_BRIDGE || self.list.revoked(id) return false end
        self.fav = id
        persist.setmember(HouseMesh.FAV, id)
        try
            persist.save()
        except .. as e, m
            log("HOUSE: the favourite bridge was not saved (" + str(e) + ": " + str(m) + ")", 1)
        end
        return true
    end

    def rename(id, name)
        if !self.writes() || self.list.field(HouseList.K_IDENT, id) == nil return false end
        if self.list.author(HouseList.K_NAME, id, bytes().fromstring(name)) == nil return false end
        self.wrote()
        return true
    end

    # The house's MQTT, written by a panel that writes the list, for every node: `m` as HouseList.mqtt_bytes takes it. False when it cannot be
    def set_mqtt(m)
        if !self.writes() return false end
        var d = HouseList.mqtt_bytes(m)
        if d == nil || self.list.author(HouseList.K_MQTT, 0, d) == nil return false end
        self.wrote()
        if self.mqtt != nil  self.mqtt.later() end
        return true
    end

    # the house's MQTT as the list has it, or nil
    def mqtt_setting()
        var f = self.list.field(HouseList.K_MQTT, 0)
        return f != nil ? HouseList.mqtt_of(f[2]) : nil
    end

    # The house's part of the alarm's configuration: the times, what the panic does and its burst, as HouseList.alarm_bytes takes it, written by
    # a panel that writes the list. False when it cannot be
    def set_alarm(m)
        if !self.writes() return false end
        var d = HouseList.alarm_bytes(m)
        if d == nil || self.list.author(HouseList.K_ALARM, 0, d) == nil return false end
        self.wrote()
        return true
    end

    # the house's part of the alarm as the list has it, or nil while the alarm is no house's yet
    def alarm_setting()
        var f = self.list.field(HouseList.K_ALARM, 0)
        return f != nil ? HouseList.alarm_of(f[2]) : nil
    end

    # The house's channel, written by a panel that writes the list: every node moves to it `delay_s` seconds from now on the mesh clock, or at once
    # for 0; nil is the house's own time, HouseChannel.MOVE_S, and at once for a house of this panel alone (house_channel.be). False when it cannot be
    def set_channel(ch, delay_s)
        if !self.writes() return false end
        if delay_s == nil  delay_s = HouseChannel.alone(self) ? 0 : HouseChannel.MOVE_S end
        var d = HouseList.channel_bytes(ch, delay_s > 0 ? HouseChannel.stamp_in(delay_s) : nil)
        if d == nil || self.list.author(HouseList.K_CHANNEL, 0, d) == nil return false end
        self.wrote()
        return true
    end

    # the house's channel as the list has it, {"channel", "at"}, or nil while the house has none
    def channel_setting()
        var f = self.list.field(HouseList.K_CHANNEL, 0)
        return f != nil ? HouseList.channel_of(f[2]) : nil
    end

    # the devices of the bridge numbered `bridge` in the alarm, as the list has them: [[id, record], ...], page after page
    def alarm_devices(bridge)
        var out = []
        for k: 0 .. HouseList.APAGES - 1
            var f = self.list.field(HouseList.K_APAGE + k, bridge)
            var items = f != nil ? HouseList.page_of(f[2]) : nil
            if items != nil  for it: items out.push(it) end end
        end
        return out
    end

    # The devices of a bridge in the alarm written again, [[id, record], ...]: packed into pages, the first that takes each, and only the pages that changed
    # written; a page left with none written empty. False when they do not fit, or the list cannot be written
    def set_alarm_devices(bridge, items)
        if !self.writes() || bridge < 1 || bridge > HouseList.MAX_NODE return false end
        var pages = []
        var cur = []
        for it: items
            var d = HouseList.page_bytes(cur + [it])
            if d == nil
                if size(cur) == 0 return false end
                pages.push(cur)
                cur = [it]
                if HouseList.page_bytes(cur) == nil return false end
            else
                cur.push(it)
            end
        end
        if size(cur) > 0  pages.push(cur) end
        if size(pages) > HouseList.APAGES return false end
        var changed = false
        for k: 0 .. HouseList.APAGES - 1
            var d = HouseList.page_bytes(k < size(pages) ? pages[k] : [])
            var f = self.list.field(HouseList.K_APAGE + k, bridge)
            if (f == nil && size(d) == 1) || (f != nil && f[2] == d) continue end
            if self.list.author(HouseList.K_APAGE + k, bridge, d) == nil return false end
            changed = true
        end
        if changed  self.wrote() end
        return true
    end

    def set_house_name(name)
        if !self.writes() return false end
        if self.list.author(HouseList.K_NAME, 0, bytes().fromstring(name)) == nil return false end
        self.wrote()
        return true
    end

    def set_ip(id, ip)
        if !self.writes() || self.list.field(HouseList.K_IDENT, id) == nil return false end
        if self.list.author(HouseList.K_ADDR, id, ip) == nil return false end
        self.wrote()
        return true
    end

    # --- leaving the house -------------------------------------------------------------------------------

    # This node leaves the house, here: the list, the key it kept, the change it carried out and the marks go, from the flash too, and the driver forgets its number, the
    # network's keys and its nodes, and stops (EspNowMeshLeave). The node is a new one to a house, which can welcome it again. Its Zigbee, its Wi-Fi and the pair of the panel
    # and its bridge stay, and so do the closures the relay and the boot hung on the state and the devices
    def leave()
        import persist
        var ev = MeshEvents.get()
        for k: ["frame", "Timeline", "Synced", "Ota"] ev.remove(k, HouseMesh.T_RULE) end
        for k: [HouseList.KEY, HouseKey.CUR, HouseKey.KEY, HouseState.KEEP, HouseState.GONE, HouseMesh.FAV, HouseMesh.OWN, "house_mqtt", "house_alarm", "house_auto", "house_channel"]
            persist.remove(k)
        end
        self.fav = 0
        try
            persist.save()
        except .. as e, m
            log("HOUSE: the flash was not saved on leaving the house (" + str(e) + ": " + str(m) + ")", 1)
        end
        self.list = HouseList(0)
        self.saved = self.list.rev
        self.own = nil
        self.out = []
        self.peer_ver = {}
        self.asked = {}
        self.answered = {}
        self.pushed = {}
        self.push_due = false
        self.key.forget()
        self.state.forget()
        self.devices.waiting = {}
        # and every part that keeps something by a node's number forgets the house's nodes, all of them
        self.sweep({})
        self.swept = nil
        self.up = false
        self.revoked_me = false
        # what the panel had of the house's devices goes with it
        if self.on_left != nil
            try
                self.on_left()
            except .. as e, m
                log("HOUSE: what was to go with the house did not (" + str(e) + ": " + str(m) + ")", 2)
            end
        end
        var r = tasmota.cmd("EspNowMeshLeave 1", true)
        self.leaving = false
        # an image with no mesh driver has no keys to forget, and says Unknown
        var w = isinstance(r, map) ? r.find("EspNowMeshLeave") : nil
        log("HOUSE: this node left the house" + (w != nil && w != "Done" ? ", and the driver said: " + str(w) : ""), 1)
        if self.on_change != nil
            try
                self.on_change(self.list)
            except .. as e, m
                log("HOUSE: a listener of the list failed (" + str(e) + ": " + str(m) + ")", 1)
            end
        end
    end

    # the word to leave, to one node
    def tell_leave(id)
        var b = bytes()
        b.add(HouseMesh.MSG_LEAVE, 1)
        b.add(HouseMesh.WIRE, 1)
        return self.send(id, b)
    end

    # a node was told to leave: taken from a panel of this node's list, not struck off
    def told_leave(src)
        if self.leaving || !self.up return end
        if !self.list.is_panel(src) || self.list.revoked(src)
            log("HOUSE: the word to leave from node " + str(src) + ", which is not a panel of the house, is let go", 2)
            return
        end
        self.leaving = true
        log("HOUSE: panel " + str(src) + " told this node to leave the house", 1)
        tasmota.set_timer(0, / -> self.leave())
    end

    # --- a node's screens on another panel -----------------------------------------------------------
    # A panel shows another node's Main settings and Wireless settings as that node draws them: it asks the node for a screen, named as the node's own
    # screens name it, and the node answers with its rows, in as many frames as they take. A touch that opens another screen is the panel's to ask for;
    # one that changes a setting goes to the node, which changes it and answers with the screen again. Only a panel asks, and a node answers only a panel
    # of its list that is not struck off

    # the word to the node `id`, asking for the screen `view`, or touching its row `k`, with `x` what the touch carries ({"t": a text typed here, "y": 1
    # once asked first here}): false when this node may not, or the mesh refused the frame. The mesh seals a frame to one node with the key of
    # the two (espnow_mesh_core.h, Secrecy): a password typed here is read by that node alone
    def ask_view(id, view, k, x)
        import json
        if !self.up || self.role != HouseList.ROLE_PANEL || id == self.list.me || self.list.field(HouseList.K_IDENT, id) == nil || self.list.revoked(id) return false end
        var m = {"v": view}
        if k != nil  m["k"] = k end
        if isinstance(x, map)
            if x.contains("t")  m["t"] = x["t"] end
            if x.contains("y")  m["y"] = x["y"] end
        end
        var b = bytes()
        b.add(k != nil ? HouseMesh.MSG_VIEW_TAP : HouseMesh.MSG_VIEW_ASK, 1)
        b.add(HouseMesh.WIRE, 1)
        b .. bytes().fromstring(json.dump(m))
        return self.send(id, b)
    end

    # asked by a panel of the house for a screen of this node's, or touching it: the screen, as the image draws it (view_fn), to it
    def told_view(src, d, tap)
        import json
        if !self.up || !self.list.is_panel(src) || self.list.revoked(src) || self.view_fn == nil || size(d) <= 2 return end
        var m = json.load(d[2 ..].asstring())
        if !isinstance(m, map) || !isinstance(m.find("v"), list) return end
        var r = nil
        try
            r = self.view_fn(m["v"], tap ? m.find("k") : nil, tap ? HouseMesh.carried(m) : nil)
        except .. as e, msg
            log("HOUSE: the screen panel " + str(src) + " asked for failed (" + str(e) + ": " + str(msg) + ")", 2)
        end
        if r != nil  self.send_view(src, r) end
    end

    # what a touch carries, as it came: a text typed on the panel ("t"), the answer to its question ("y")
    static def carried(m)
        var x = {}
        for key: ["t", "y"]
            if m.contains(key)  x[key] = m[key] end
        end
        return x
    end

    # the screen `r` to the panel `dest`: its rows in pieces, as many to a frame as it holds
    def send_view(dest, r)
        import json
        var room = HouseMesh.room_to(dest) - 2
        self.view_seq = (self.view_seq + 1) % 1000
        # what the first piece carries besides the rows: a screen asked again after "a" ms, one that follows the touch ("g"), the hotspot's QR ("q")
        var ex = size(r) > 5 && isinstance(r[5], map) ? r[5] : {}
        var head = {"w": self.view_seq, "p": 99, "of": 99, "v": r[0], "t": r[1], "b": 1}
        for key: ex.keys()  head[key] = ex[key] end
        var pieces = []
        var cur = []
        for row: r[2]
            cur.push(row)
            head["r"] = cur
            if size(json.dump(head)) > room
                cur.pop()
                if size(cur) > 0  pieces.push(cur) end
                cur = [row]
            end
        end
        pieces.push(cur)
        for p: 0 .. size(pieces) - 1
            var m = {"w": self.view_seq, "p": p, "of": size(pieces), "v": r[0], "r": pieces[p]}
            if p == 0
                m["t"] = r[1]
                for key: ex.keys()  m[key] = ex[key] end
                if size(r) > 3 && r[3]  m["b"] = 1 end
            end
            var b = bytes()
            b.add(HouseMesh.MSG_VIEW, 1)
            b.add(HouseMesh.WIRE, 1)
            b .. bytes().fromstring(json.dump(m))
            self.send(dest, b)
        end
    end

    # a piece of a node's screen: kept until the answer is whole, and then the screen is the node's last, and the screens are told
    def take_view(src, d)
        import json
        if size(d) <= 2 || self.list.field(HouseList.K_IDENT, src) == nil return end
        var m = json.load(d[2 ..].asstring())
        if !isinstance(m, map) return end
        var w = m.find("w", 0)
        var a = self.views.find(src)
        if a == nil || a["w"] != w
            a = {"w": w, "of": m.find("of", 1), "got": {}}
            self.views[src] = a
        end
        a["got"][m.find("p", 0)] = m
        if size(a["got"]) < a["of"] return end
        var rows = []
        for i: 0 .. a["of"] - 1
            var piece = a["got"].find(i)
            if piece == nil return end
            for x: piece.find("r", [])  rows.push(x) end
        end
        var first = a["got"][0]
        var ex = {}
        for key: ["a", "g", "q"]
            if first.contains(key)  ex[key] = first[key] end
        end
        self.remote[src] = [tasmota.millis(), first.find("v"), str(first.find("t", "")), rows, first.find("b", 0) == 1, ex]
        self.views.remove(src)
        if self.on_view != nil  self.on_view(src) end
    end

    # What this node runs, as the rows of its Info: Tasmota's version, the build of the firmware and its date (an image without the stamp says neither) and the
    # time since it started; a bridge's screen (the panel's own Info has its own)
    static def build_rows()
        import global
        import introspect
        import string
        var rows = []
        if introspect.get(tasmota, "version") != nil
            var v = tasmota.version()
            rows.push(["Tasmota", string.format("%d.%d.%d", (v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF), 0, 0])
        end
        if global.contains("PanelBuild")
            rows.push(["Firmware", str(global.PanelBuild.COMMIT), 0, 0])
            rows.push(["Built", HouseMesh.date_word(str(global.PanelBuild.DATE)), 0, 0])
        end
        var r = tasmota.rtc()
        var utc = r.find("utc", 0)
        var start = r.find("restart", 0)
        rows.push(["Up", HouseMesh.up_word(start > 1451602800 && utc >= start ? utc - start : tasmota.millis() / 1000), 0, 0])
        return rows
    end

    # a build date as the panel's own Info writes it: 19/10 09:46
    static def date_word(s)
        if size(s) < 16 || s[4] != "-" return s != "" ? s : "unknown" end
        return s[8 .. 9] + "/" + s[5 .. 6] + " " + s[11 .. 15]
    end

    # a time up, in days, hours and minutes
    static def up_word(s)
        if s < 60 return str(s) + " s" end
        var d = s / 86400
        var hr = (s % 86400) / 3600
        var mn = (s % 3600) / 60
        if d > 0 return str(d) + " d " + str(hr) + " h" end
        if hr > 0 return str(hr) + " h " + str(mn) + " min" end
        return str(mn) + " min"
    end

    # A panel moves another node to another house: the word, twice, no frame of the house asking for an answer. The node goes by itself, which the
    # panels take as its leaving; one that did not hear it stays in the house, and the screen offers the word again. False when this panel may not
    def move(id)
        if !self.writes() || id == self.list.me || self.list.field(HouseList.K_IDENT, id) == nil || self.list.revoked(id) return false end
        self.tell_move(id)
        tasmota.set_timer(HouseMesh.LEAVE_AGAIN_MS, / -> self.tell_move(id))
        return true
    end

    def tell_move(id)
        var b = bytes()
        b.add(HouseMesh.MSG_MOVE, 1)
        b.add(HouseMesh.WIRE, 1)
        return self.send(id, b)
    end

    # a node was told to join another house: taken from a panel of this node's list, not struck off; it goes, and opens its window once it is out
    def told_move(src)
        if self.leaving || !self.up return end
        if !self.list.is_panel(src) || self.list.revoked(src)
            log("HOUSE: the word to join another house from node " + str(src) + ", which is not a panel of the house, is let go", 2)
            return
        end
        log("HOUSE: panel " + str(src) + " told this node to join another house", 1)
        var after = self.on_move
        self.go(def ()
            if after != nil
                try
                    after()
                except .. as e, m
                    log("HOUSE: the window to join another house did not open (" + str(e) + ": " + str(m) + ")", 1)
                end
            end
        end)
    end

    # This node leaves the house by itself (a bridge's factory reset, its button held): every panel of the house is told first, so that one strikes
    # it off and every panel lets its devices go, and GOING_MS later it leaves, `then` after that. False when it is leaving already
    def go(then)
        if self.leaving return false end
        self.leaving = true
        var b = bytes()
        b.add(HouseMesh.MSG_GOING, 1)
        b.add(HouseMesh.WIRE, 1)
        for id: self.list.ids(false)
            if id != self.list.me && self.list.is_panel(id)  self.send(id, b) end
        end
        tasmota.set_timer(HouseMesh.GOING_MS, def ()
            self.leave()
            if then != nil  then() end
        end, "house_going")
        return true
    end

    # A node of the house says it leaves by itself: a panel that writes the list strikes it off, as if it had removed it. One at a time: the panel of the lowest number at
    # once, and each other one GOING_STEP_MS later than the one before it, if the node is not struck off by then and the key has not changed since (the new key
    # comes before the list's entry that says who struck the node off), so that two changes of the key do not cross
    def told_going(src)
        if !self.up || !self.writes() || src == self.list.me || self.list.field(HouseList.K_IDENT, src) == nil || self.list.revoked(src) return end
        var rank = 0
        for id: self.list.ids(false)
            if id < self.list.me && self.list.is_panel(id)  rank += 1 end
        end
        log("HOUSE: node " + str(src) + " leaves the house by itself", 2)
        if rank == 0
            self.revoke(src)
        else
            var was = self.key.version
            tasmota.set_timer(rank * HouseMesh.GOING_STEP_MS, def ()
                if !self.list.revoked(src) && self.key.version == was  self.revoke(src) end
            end)
        end
    end

    # A panel removes another node from the house: the node is told to leave, twice, and REMOVE_MS later struck off, with the change of the key (revoke), so that a node
    # that did not hear it is out of the house all the same. False when this panel may not, or the node is not one of the house's
    def remove(id)
        if !self.writes() || id == self.list.me || self.list.field(HouseList.K_IDENT, id) == nil || self.list.revoked(id) return false end
        self.tell_leave(id)
        tasmota.set_timer(HouseMesh.LEAVE_AGAIN_MS, / -> self.tell_leave(id))
        tasmota.set_timer(HouseMesh.REMOVE_MS, / -> self.revoke(id))
        return true
    end

    # A panel leaves the house by itself, with its bridge when `bridge` is that bridge's number (0: the bridge stays in the house), or with every bridge of the house when it is -1:
    # the last panel's, since a house always has a panel. The bridges taken are told to leave, the list says that they and this panel are out of the house, and those
    # entries are given to every node that stays, from here, since this panel will not be there to answer an ask; LEAVE_MS later this panel leaves. No key changes: a node that
    # leaves wipes its own. A bridge leaves by leave() alone: it writes nothing
    def leave_house(bridge)
        if self.leaving || !self.up || self.list.me < 1 return false end
        if !self.writes()
            self.leaving = true
            tasmota.set_timer(0, / -> self.leave())
            return true
        end
        self.leaving = true
        var above = self.list.mine
        var taken = bridge == -1 ? self.bridges() : (bridge > 0 && bridge != self.list.me && self.list.field(HouseList.K_IDENT, bridge) != nil && !self.list.revoked(bridge) ? [bridge] : [])
        for b: taken
            self.tell_leave(b)
            tasmota.set_timer(HouseMesh.LEAVE_AGAIN_MS, / -> self.tell_leave(b))
            self.list.author(HouseList.K_REVOKE, b, bytes())
        end
        self.list.author(HouseList.K_REVOKE, self.list.me, bytes())
        self.wrote()
        for id: self.list.ids(false)
            if id != self.list.me && taken.find(id) == nil self.send_entries(id, above) end
        end
        tasmota.set_timer(HouseMesh.LEAVE_MS, / -> self.leave())
        return true
    end

    # the bridges of the house that are not struck off
    def bridges()
        var out = []
        for id: self.list.ids(false)
            if id != self.list.me && self.list.role(id) == HouseList.ROLE_BRIDGE out.push(id) end
        end
        return out
    end

    # a node struck off: the list says it, and the key of the network changes, so that the node is out of the house for good (house_key.be). A server, which never
    # had the key, is out with its credential struck off: the key stays
    def revoke(id)
        if !self.writes() || id == self.list.me || self.list.field(HouseList.K_IDENT, id) == nil || self.list.revoked(id) return false end
        var server = self.list.role(id) == HouseList.ROLE_SERVER
        if self.list.author(HouseList.K_REVOKE, id, bytes()) == nil return false end
        self.wrote()
        if !server  self.key.rotate() end
        return true
    end

    # The house's server, as the list has it: {"id", "host", "port", "name", "key": its X25519 public key, 32 bytes}, the first that has
    # an address and a port; nil while the house has none
    def server()
        for id: self.list.servers()
            var n = self.list.node(id)
            var ip = n["ip"]
            if ip != nil && n["port"] > 0
                return {"id": id, "host": str(ip[0]) + "." + str(ip[1]) + "." + str(ip[2]) + "." + str(ip[3]), "port": n["port"], "name": n["name"], "key": n["key"]}
            end
        end
        return nil
    end

    # A server paired on this panel: its credential (its public key, 32 bytes), its address (4 bytes), its port and its name, written into the list under a
    # number of its own, which every node of the house then knows; the number, or 0 when it cannot be. A server of the house with that key keeps its number, and its
    # address, port and name are written again
    def add_server(key, ip, port, name)
        if !self.writes() || !isinstance(key, bytes) || size(key) != 32 || !isinstance(ip, bytes) || size(ip) != 4 || type(port) != "int" || port < 1 || port > 65535
            return 0
        end
        var id = 0
        for s: self.list.servers()
            if self.list.field(HouseList.K_IDENT, s)[2][1 .. 32] == key  id = s end
        end
        if id == 0
            id = self.list.next_id()
            var d = bytes()
            d.add(HouseList.ROLE_SERVER, 1)
            d .. key
            d .. bytes("000000000000")
            if id == 0 || self.list.author(HouseList.K_IDENT, id, d) == nil return 0 end
        end
        var p = bytes()
        p.add(port, -2)
        self.list.author(HouseList.K_ADDR, id, ip)
        self.list.author(HouseList.K_PORT, id, p)
        var nm = bytes().fromstring(str(name))
        if size(nm) > HouseList.MAX_NAME  nm = nm[0 .. HouseList.MAX_NAME - 1] end
        if size(nm) > 0  self.list.author(HouseList.K_NAME, id, nm) end
        self.wrote()
        return id
    end
end
