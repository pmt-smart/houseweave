# house_list.be -- the list of the house: who is in it, as the panels wrote it.
# The model only: no mesh, no clock, no flash but the one key it persists. house_mesh.be carries it between the nodes, and the panels' screens read it.
#
# WHAT IT IS. A house is a list that only the panels write. Each write is an ENTRY of one panel (its author), numbered by that panel, 1, 2, 3 ... (seq):
#   IDENT   the number of a node and what it is: its role (bridge or panel), its public key (32 bytes) and its radio address (6); or of the house's SERVER,
#           the one that keeps the backups and the releases, which a panel pairs with: a member of the list with a number, no node of the mesh (it has no
#           radio, and its radio address is six zeros); its address is its ADDR and its PORT, and its public key is its credential
#   NAME    a node's name (Garage), or, for the number 0, the house's
#   REVOKE  the node is struck off: the house forgets it, every field of it goes, and the mark alone stays, so that its number is never used again and a panel
#           that was off forgets it too (a node removed is forgotten whole)
#   SLOT    the number of the alarm a bridge has (1 to 15), the replica's counter
#   ADDR    a node's address on the dedicated network, 4 bytes
#   MQTT    for the number 0, the house's MQTT: the broker, the port, the user, the password, the discovery and the battery timeout (house_mqtt.be);
#           or, in place of the password, the word that each node keeps the one it has: a first setting saved with none typed, on the broker the panel was on
#   ALARM   for the number 0, the house's part of the alarm's configuration: the exit, entry and siren times, what the panic does, and its burst
#   CHANNEL for the number 0, the house's channel: the Wi-Fi channel the mesh is on, and the instant the house moves to it (house_channel.be)
#   PORT    the port a server listens on
#   APAGE   for the number of a bridge, its devices in the alarm, in up to APAGES pages (the kinds K_APAGE to K_APAGE + APAGES - 1): each device's role,
#           notification, entry, sound, silence, condition, whether it is a siren or out of the panic, and its action in the panic (house_alarm.be)
# The state is made of FIELDS, one for each (kind, node): the entry of a field that wins is the one with the greater TIME, and, with the same time, of the panel with
# the lower number. The time (lc) is a Lamport clock: a panel that writes gives its entry a time above every time it has seen, so what it writes after reading another's entry
# wins over it, whatever the number of entries each has written (the seq counts a panel's own entries and says nothing of when). A REVOKE is for good (nothing un-revokes a node). The one exception is IDENT: two panels that give the same number to two new nodes at the same
# time are two identities for one number, and the lower public key stays; the panel whose node lost it finds it in `lost` and gives the node another number.
#
# WHAT EACH NODE HOLDS. The fields, and the VECTOR: for each author the highest seq whose entries this node has taken, all of them: an author's entries are taken
# in order, or all at once (a snapshot, see entries_of), so that a vector says what the node has of that author, whole. The digest is the vector in three bytes
# (FNV-1a over the authors and their seqs, in order of author): the heartbeat carries it, and a node that sees another's digest is not the same asks for the vector.
# A snapshot of an author is the fields it wrote that are still its own, newest of each: an older entry of a field that the same author wrote again is gone, since
# nothing it said can win against what the same author said later, so a node does not need the history to be where the others are.
#
# WHAT IS NOT KNOWN. An entry of a kind this build does not know, or an identity of a role it does not know, is kept and carried on as it came, and means nothing
# here: a list that grows does not stop at a node that runs an older build (an older build that refuses it is updated before a
# server is paired). The nodes of the mesh are the bridges and the panels alone (ids). A node that skipped what it did
# not know, and starts with a build that knows it, has the author's entries again: the list keeps the FORMAT it was saved by, and one saved by an older format
# forgets its vector (not its fields) as it is read, so every author's entries are asked for again, and what was skipped is taken.
#
# WHO MAY WRITE is checked by whoever carries the entries (house_mesh.be): an entry is taken only from its author, in a frame the mesh sealed for this node with the key
# of the pair, and only from a node that is a panel in this list. This class does not know the mesh and takes what it is given; it checks the shape of an entry.
#
# THE WIRE. An entry is [kind, node, seq (2 bytes, big-endian), time (2), length, data...]: 7 bytes and the data.
#   IDENT   data: role (1), public key (32), radio address (6): 39 bytes
#   NAME    data: the text, up to 20 bytes
#   REVOKE  data: nothing
#   SLOT    data: one byte, 1 to 15
#   ADDR    data: 4 bytes
#   PORT    data: 2 bytes, big-endian
#   MQTT    data: version (1, the value 1), port (2, big-endian), flags (1: 1 the discovery), the battery timeout in hours (2), and the host, the user and the password,
#           each a length (1) and the text: up to 40, 32 and 48 bytes
#   ALARM   data: version (1, the value 1), the exit, entry and siren times in seconds (2 each), flags (1: 1 Home Assistant, 2 the panels, 4 the alarm), the burst's
#           activations and its seconds (1 each): 10 bytes
#   CHANNEL data: version (1, the value 1), the channel (1, 1 to 13), the instant every node moves to it, a stamp of the mesh clock (6: its timeline's tag, 2
#           bytes, and the time in ticks of 10 ms, 4, most significant first), or 6 zeros for at once: 8 bytes
#   APAGE   data: version (1, the value 1), then the devices, each: the IEEE (8), the endpoint (1, 0 for none), flags (1: the role in bits 0-1, the
#           notification in 2-3, 16 the entry, 32 the sound, 64 a siren, 128 out of the panic), the silence in hours (1, 0 for the default), and more (1: 1 a
#           condition, the key's length and text, 0 above or 1 below, the limit in tenths, 2 bytes signed; 2 an action in the panic, its length and text):
#           APAGE_MAX bytes at most
# THE FLASH. One persist key, `house`: {"v": the vector as hex (author, seq 2 bytes) ..., "f": the fields as hex (author, kind, node, seq 2, time 2, length, data ...), "m": the
# seq of this node's last entry, "a": the number it had when it wrote it, "k": the FORMAT it was written by}. It is written whole, and read back as far as it makes sense: what does not is left out.

#@ solidify:HouseList
class HouseList
    static KEY = "house"
    static ROLE_BRIDGE = 1
    static ROLE_PANEL = 2
    static ROLE_SERVER = 3
    static MAX_ROLE = 15
    static K_IDENT = 1
    static K_NAME = 2
    static K_REVOKE = 3
    static K_SLOT = 4
    static K_ADDR = 5
    static K_MQTT = 6
    static K_ALARM = 7
    static K_CHANNEL = 8
    static K_PORT = 9
    static K_APAGE = 16
    static APAGES = 8
    static ALARM_LEN = 10
    static CHANNEL_LEN = 8
    static MAX_CHANNEL = 13
    static APAGE_MAX = 180
    static MAX_NODE = 254
    static MAX_NODES = 48
    static MAX_NAME = 20
    static MAX_SLOT = 15
    static MAX_SEQ = 65535
    static IDENT_LEN = 39
    static OTHER_MAX = 64     # the most bytes of an entry of a kind this build does not know
    static FORMAT = 1         # the kinds and roles this build knows: 1, the server's; a list saved by a lower one is asked for again
    static HEAD = 7
    static MQTT_HOST = 40
    static MQTT_USER = 32
    static MQTT_PASS = 48
    static MQTT_MIN = 9

    var me        # this node's number on the mesh, 0 when it has none
    var v         # author -> the highest seq of it this node has taken
    var f         # (kind * 256 + node) -> [author, seq, data, time]
    var clock     # the greatest time of any entry this node has taken or written
    var mine      # the seq of this node's last entry
    var rev       # counts the changes of the fields and the vector: a caller that saved at one rev has to save at another
    var lost      # the identities this node wrote that another took the number of: [node, the identity's data as it was written]
    var dig       # [rev, digest]: the digest of the vector at a rev, kept until the next change (the heartbeat and the poll read it often)
    var forgot    # the nodes this list has just forgotten, number -> its name as the screens said it, until the house's sweep takes them (house_mesh.be); never saved
    var reading   # the fields are being read from the flash: the nodes struck off are forgotten once all are in (from_map)

    def init(me)
        self.me = me
        self.v = {}
        self.f = {}
        self.mine = 0
        self.clock = 0
        self.rev = 0
        self.lost = []
        self.forgot = {}
    end

    # --- entries ----------------------------------------------------------------------------------------------------

    # the entry as bytes: nil when it is not one that can be (a kind that is not known, a number out of range, a datum of the wrong size)
    static def encode(kind, node, seq, lc, data)
        if !HouseList.shape(kind, node, data) || seq < 1 || seq > HouseList.MAX_SEQ || lc < 1 || lc > HouseList.MAX_SEQ return nil end
        var b = bytes()
        b.add(kind, 1)
        b.add(node, 1)
        b.add(seq, -2)
        b.add(lc, -2)
        b.add(size(data), 1)
        b .. data
        return b
    end

    # whether an entry of this kind is well made: the number of the node and the size of what it carries
    static def shape(kind, node, data)
        if type(node) != "int" || !isinstance(data, bytes) return false end
        var n = size(data)
        if kind == HouseList.K_NAME
            return node >= 0 && node <= HouseList.MAX_NODE && n <= HouseList.MAX_NAME
        end
        if kind == HouseList.K_MQTT
            return node == 0 && n >= HouseList.MQTT_MIN && n <= HouseList.MQTT_MIN + HouseList.MQTT_HOST + HouseList.MQTT_USER + HouseList.MQTT_PASS && data[0] == 1
        end
        if kind == HouseList.K_ALARM
            return node == 0 && n == HouseList.ALARM_LEN && data[0] == 1
        end
        if kind == HouseList.K_CHANNEL
            return node == 0 && n == HouseList.CHANNEL_LEN && data[0] == 1 && data[1] >= 1 && data[1] <= HouseList.MAX_CHANNEL
        end
        if kind >= HouseList.K_APAGE && kind < HouseList.K_APAGE + HouseList.APAGES
            return node >= 1 && node <= HouseList.MAX_NODE && n >= 1 && n <= HouseList.APAGE_MAX && data[0] == 1 && HouseList.page_of(data) != nil
        end
        # a kind this build does not know, of the house's number or a node's: kept and carried on
        if type(kind) == "int" && kind >= 1 && kind <= 255 && !HouseList.known(kind)
            return node >= 0 && node <= HouseList.MAX_NODE && n <= HouseList.OTHER_MAX
        end
        if node < 1 || node > HouseList.MAX_NODE return false end
        if kind == HouseList.K_IDENT
            return n == HouseList.IDENT_LEN && data[0] >= 1 && data[0] <= HouseList.MAX_ROLE
        elif kind == HouseList.K_REVOKE
            return n == 0
        elif kind == HouseList.K_SLOT
            return n == 1 && data[0] >= 1 && data[0] <= HouseList.MAX_SLOT
        elif kind == HouseList.K_ADDR
            return n == 4
        elif kind == HouseList.K_PORT
            return n == 2 && ((data[0] << 8) | data[1]) > 0
        end
        return false
    end

    # whether this build knows what the entries of this kind say
    static def known(kind)
        return (kind >= HouseList.K_IDENT && kind <= HouseList.K_PORT) || (kind >= HouseList.K_APAGE && kind < HouseList.K_APAGE + HouseList.APAGES)
    end

    # The house's MQTT as the field's data: nil when a text is too long for it
    static def mqtt_bytes(m)
        var host = bytes().fromstring(str(m.find("host", "")))
        var user = bytes().fromstring(str(m.find("user", "")))
        var keep = m.find("keep") == true
        var pw = bytes().fromstring(keep ? "" : str(m.find("password", "")))
        if size(host) > HouseList.MQTT_HOST || size(user) > HouseList.MQTT_USER || size(pw) > HouseList.MQTT_PASS return nil end
        var port = int(m.find("port", 1883))
        var expire = int(m.find("expire", 0))
        if port < 1 || port > 65535 || expire < 0 || expire > 65535 return nil end
        var b = bytes()
        b.add(1, 1)
        b.add(port, -2)
        b.add((m.find("discovery", true) != false ? 1 : 0) | (keep ? 2 : 0), 1)
        b.add(expire, -2)
        for t: [host, user, pw]
            b.add(size(t), 1)
            b .. t
        end
        return b
    end

    # The house's part of the alarm as the field's data: {"times": [exit, entry, siren], "ha", "panels", "alarm", "burst": [activations, seconds]}; nil out of range
    static def alarm_bytes(m)
        var t = m.find("times", [30, 30, 300])
        var b = m.find("burst", [8, 3])
        if !isinstance(t, list) || size(t) != 3 || !isinstance(b, list) || size(b) != 2 return nil end
        var d = bytes()
        d.add(1, 1)
        for v: t
            if int(v) < 0 || int(v) > 900 return nil end
            d.add(int(v), -2)
        end
        d.add((m.find("ha", true) == true ? 1 : 0) | (m.find("panels") == true ? 2 : 0) | (m.find("alarm") == true ? 4 : 0), 1)
        if int(b[0]) < 0 || int(b[0]) > 50 || int(b[1]) < 1 || int(b[1]) > 30 return nil end
        d.add(int(b[0]), 1)
        d.add(int(b[1]), 1)
        return d
    end

    # and back, or nil for data that is not one
    static def alarm_of(d)
        if !isinstance(d, bytes) || size(d) != HouseList.ALARM_LEN || d[0] != 1 return nil end
        return {"times": [d.get(1, -2), d.get(3, -2), d.get(5, -2)], "ha": (d[7] & 1) != 0, "panels": (d[7] & 2) != 0, "alarm": (d[7] & 4) != 0,
                "burst": [d[8], d[9]]}
    end

    # The house's channel as the field's data: the channel, and the instant the house moves to it (a stamp of the mesh clock, 6 bytes), or nil for at once; nil for a
    # channel out of range
    static def channel_bytes(ch, at)
        if type(ch) != "int" || ch < 1 || ch > HouseList.MAX_CHANNEL return nil end
        var d = bytes()
        d.add(1, 1)
        d.add(ch, 1)
        if isinstance(at, bytes) && size(at) == 6
            d .. at
        else
            for i: 1 .. 6  d.add(0, 1) end
        end
        return d
    end

    # and back: {"channel", "at"}, "at" nil for at once, or nil for data that is not one
    static def channel_of(d)
        if !isinstance(d, bytes) || size(d) != HouseList.CHANNEL_LEN || d[0] != 1 || d[1] < 1 || d[1] > HouseList.MAX_CHANNEL return nil end
        var at = d[2 .. 7]
        var none = true
        for i: 0 .. 5
            if at[i] != 0  none = false end
        end
        return {"channel": d[1], "at": none ? nil : at}
    end

    # A page of a bridge's devices in the alarm as the field's data: [[id, record], ...], each record as house_alarm.be keeps it; nil when one is not a
    # device's or the page passes APAGE_MAX
    static def page_bytes(items)
        import string
        var d = bytes()
        d.add(1, 1)
        for it: items
            var id = str(it[0])
            var r = it[1]
            var cut = string.find(id, "/")
            var ieee = cut < 0 ? id : id[0 .. cut - 1]
            var ep = cut < 0 ? 0 : int(id[cut + 1 ..])
            if size(ieee) != 18 || ieee[0 .. 1] != "0x" || ep < 0 || ep > 240 return nil end
            d .. bytes(ieee[2 ..])
            d.add(ep, 1)
            d.add(int(r.find("role", 0)) | (int(r.find("notify", 0)) << 2) | (r.find("entry") == true ? 16 : 0) | (r.find("sound") == true ? 32 : 0) |
                  (r.find("siren") == true ? 64 : 0) | (r.find("nopanic") == true ? 128 : 0), 1)
            d.add(int(r.find("news", 0)), 1)
            var c = r.find("cond")
            var a = r.find("act")
            d.add((c != nil ? 1 : 0) | (a != nil ? 2 : 0), 1)
            if c != nil
                var k = bytes().fromstring(str(c["k"]))
                if size(k) > 32 return nil end
                d.add(size(k), 1)
                d .. k
                d.add(c["w"] == "below" ? 1 : 0, 1)
                d.add(int(real(c["x"]) * 10 + (real(c["x"]) < 0 ? -0.5 : 0.5)), -2)
            end
            if a != nil
                var t = bytes().fromstring(str(a))
                if size(t) > 16 return nil end
                d.add(size(t), 1)
                d .. t
            end
        end
        return size(d) <= HouseList.APAGE_MAX ? d : nil
    end

    # and back: [[id, record], ...], or nil for data that is not one
    static def page_of(d)
        if !isinstance(d, bytes) || size(d) < 1 || d[0] != 1 return nil end
        var out = []
        var at = 1
        while at < size(d)
            if at + 12 > size(d) return nil end
            var id = "0x" + d[at .. at + 7].tohex()
            var ep = d[at + 8]
            if ep > 0  id += "/" + str(ep) end
            var f = d[at + 9]
            var r = {"role": f & 3, "notify": (f >> 2) & 3, "entry": (f & 16) != 0, "sound": (f & 32) != 0, "siren": (f & 64) != 0, "nopanic": (f & 128) != 0,
                     "news": d[at + 10]}
            var more = d[at + 11]
            at += 12
            if (more & 1) != 0
                if at >= size(d) return nil end
                var n = d[at]
                if at + 1 + n + 3 > size(d) return nil end
                var x = d.geti(at + 2 + n, -2)
                r["cond"] = {"k": n > 0 ? d[at + 1 .. at + n].asstring() : "", "w": d[at + 1 + n] == 1 ? "below" : "above", "x": x / 10.0}
                at += 1 + n + 3
            end
            if (more & 2) != 0
                if at >= size(d) return nil end
                var n = d[at]
                if at + 1 + n > size(d) return nil end
                r["act"] = n > 0 ? d[at + 1 .. at + n].asstring() : ""
                at += 1 + n
            end
            out.push([id, r])
        end
        return out
    end

    # and back: {"host", "port", "user", "password", "discovery", "expire"}, with "keep" when each node keeps its own password, or nil for data that is not one
    static def mqtt_of(d)
        if !isinstance(d, bytes) || size(d) < HouseList.MQTT_MIN || d[0] != 1 return nil end
        var m = {"port": d.get(1, -2), "discovery": (d[3] & 1) != 0, "expire": d.get(4, -2)}
        if (d[3] & 2) != 0  m["keep"] = true end
        var at = 6
        for k: ["host", "user", "password"]
            if at >= size(d) return nil end
            var n = d[at]
            if at + 1 + n > size(d) return nil end
            m[k] = n > 0 ? d[at + 1 .. at + n].asstring() : ""
            at += 1 + n
        end
        return at == size(d) ? m : nil
    end

    # the entries in a run of bytes, as [kind, node, seq, time, data]; what comes after a short or badly made one is not read. Returns the list read
    static def decode(b, at)
        var out = []
        var i = at
        while i + HouseList.HEAD <= size(b)
            var n = b[i + 6]
            if i + HouseList.HEAD + n > size(b) break end
            var data = bytes()
            if n > 0 data = b[i + HouseList.HEAD .. i + HouseList.HEAD + n - 1] end
            if !HouseList.shape(b[i], b[i + 1], data) break end
            out.push([b[i], b[i + 1], (b[i + 2] << 8) | b[i + 3], (b[i + 4] << 8) | b[i + 5], data])
            i += HouseList.HEAD + n
        end
        return out
    end

    # --- the fields -------------------------------------------------------------------------------------------------

    # whether the entry (author, time, kind, data) replaces the one held, [author, seq, data, time]: the greater time, and with the same time the lower author; but, of two
    # identities for one number, the lower public key (and the same identity written again follows the rule of the time)
    static def beats(kind, author, lc, data, old)
        if kind == HouseList.K_IDENT && data[1 .. 32] != old[2][1 .. 32]
            return data[1 .. 32].tohex() < old[2][1 .. 32].tohex()
        end
        if lc != old[3] return lc > old[3] end
        return author < old[0]
    end

    # takes an entry of `author`: 1 when the state changed, 0 when it did not (the entry held is as good or better), -1 when it is not an entry. The vector is not
    # moved: that is take_upto, when the author's entries up to a seq are all here
    def apply(author, seq, lc, kind, node, data)
        if type(author) != "int" || author < 1 || author > HouseList.MAX_NODE || type(seq) != "int" || seq < 1 || seq > HouseList.MAX_SEQ return -1 end
        if type(lc) != "int" || lc < 1 || lc > HouseList.MAX_SEQ || !HouseList.shape(kind, node, data) return -1 end
        if lc > self.clock self.clock = lc end
        var key = kind * 256 + node
        # a number struck off is the mark alone: what comes of it after is not taken
        if !self.reading && kind != HouseList.K_REVOKE && node > 0 && self.f.contains(HouseList.K_REVOKE * 256 + node) return 0 end
        var old = self.f.find(key)
        if old != nil && !HouseList.beats(kind, author, lc, data, old) return 0 end
        if old != nil && kind == HouseList.K_IDENT && old[0] == self.me && old[2][1 .. 32] != data[1 .. 32]
            self.lost.push([node, old[2]])
        end
        self.f[key] = [author, seq, data.copy(), lc]
        self.rev += 1
        if kind == HouseList.K_REVOKE && !self.reading  self.forget(node) end
        return 1
    end

    # A node struck off is forgotten: every field of it goes, its identity, its name, its address, its alarm's number and its pages, and the mark stays. Its name
    # as the screens said it is kept for the house's sweep, which tells the parts that keep something of it (house_mesh.be)
    def forget(node)
        var drop = []
        for key: self.f.keys()
            if (key & 255) == node && (key >> 8) != HouseList.K_REVOKE  drop.push(key) end
        end
        if size(drop) == 0 return end
        var name = self.label(node)
        if name != nil  self.forgot[node] = name end
        for key: drop  self.f.remove(key) end
        var i = 0
        while i < size(self.lost)
            if self.lost[i][0] == node  self.lost.remove(i) else i += 1 end
        end
        self.rev += 1
    end

    # this node's own entry: the next seq, taken into the fields and the vector. The entry as bytes, or nil when it is not one
    def author(kind, node, data)
        var seq = self.mine + 1
        var lc = self.clock + 1
        var e = HouseList.encode(kind, node, seq, lc, data)
        if e == nil || self.me < 1 return nil end
        self.apply(self.me, seq, lc, kind, node, data)
        self.mine = seq
        self.v[self.me] = seq
        self.rev += 1
        return e
    end

    # the author's entries up to `seq` are all here: the vector moves up to it (it never moves back)
    def take_upto(author, seq)
        var cur = self.v.find(author)
        if cur != nil && cur >= seq return false end
        self.v[author] = seq
        self.rev += 1
        return true
    end

    # the fields of `author` that the one that asks, whose vector holds `above` of it, has not: the entries, in order of seq, each as bytes
    def entries_of(author, above)
        var items = []
        for key: self.f.keys()
            var x = self.f[key]
            if x[0] == author && x[1] > above items.push([x[1], key]) end
        end
        # in order of seq: an insertion sort, the lists are short (a node's entries are few)
        var i = 1
        while i < size(items)
            var j = i
            while j > 0 && items[j - 1][0] > items[j][0]
                var t = items[j - 1]
                items[j - 1] = items[j]
                items[j] = t
                j -= 1
            end
            i += 1
        end
        var out = []
        for it: items
            var x = self.f[it[1]]
            out.push(HouseList.encode(it[1] >> 8, it[1] & 255, x[1], x[3], x[2]))
        end
        return out
    end

    # --- the vector and the digest ----------------------------------------------------------------------------------

    # the authors the vector has, in order
    def authors()
        var a = []
        for k: self.v.keys() a.push(k) end
        var i = 1
        while i < size(a)
            var j = i
            while j > 0 && a[j - 1] > a[j]
                var t = a[j - 1]
                a[j - 1] = a[j]
                a[j] = t
                j -= 1
            end
            i += 1
        end
        return a
    end

    # the vector as bytes: (author, seq of 2) for each author in order
    def vector()
        var b = bytes()
        for a: self.authors()
            b.add(a, 1)
            b.add(self.v[a], -2)
        end
        return b
    end

    # the vector in 24 bits, for the heartbeat (bytes 25 to 27): FNV-1a over the bytes of the vector. 0 for a node that holds nothing.
    # Kept at its rev: every change of the vector moves the rev, and the poll and the heartbeat ask for it every few seconds
    def digest()
        if self.dig != nil && self.dig[0] == self.rev return self.dig[1] end
        var vec = self.vector()
        var h = 0
        if size(vec) > 0
            h = 0x811C9DC5
            for i: 0 .. size(vec) - 1
                h = (h ^ vec[i]) * 0x01000193
            end
            h = h & 0xFFFFFF
        end
        self.dig = [self.rev, h]
        return h
    end

    # what a vector in bytes says: a map author -> seq, and nil when it is not a whole number of pairs
    static def parse_vector(b, at)
        if (size(b) - at) % 3 != 0 return nil end
        var out = {}
        var i = at
        while i < size(b)
            out[b[i]] = (b[i + 1] << 8) | b[i + 2]
            i += 3
        end
        return out
    end

    # the authors of whom `theirs` (a vector as parse_vector gives it) holds more than this node does, each with what this node holds of it
    def behind(theirs)
        var out = []
        for a: theirs.keys()
            var mine_of = self.v.find(a)
            if mine_of == nil mine_of = 0 end
            if theirs[a] > mine_of out.push([a, mine_of]) end
        end
        return out
    end

    # --- what the list says ------------------------------------------------------------------------------------------

    def field(kind, node)
        return self.f.find(kind * 256 + node)
    end

    # the identity of a node as a map, or nil for a number no node of the house has (a number struck off is one): role, key (32 bytes), mac (6), ip (4 bytes, or nil),
    # name, slot (0 for none)
    def node(id)
        var x = self.field(HouseList.K_IDENT, id)
        if x == nil return nil end
        var d = x[2]
        var ip = self.field(HouseList.K_ADDR, id)
        var nm = self.field(HouseList.K_NAME, id)
        var sl = self.field(HouseList.K_SLOT, id)
        var pt = self.field(HouseList.K_PORT, id)
        return {"role": d[0], "key": d[1 .. 32], "mac": d[33 .. 38], "ip": ip == nil ? nil : ip[2],
                "name": nm == nil ? "" : nm[2].asstring(), "slot": sl == nil ? 0 : sl[2][0], "by": x[0], "port": pt == nil ? 0 : (pt[2][0] << 8) | pt[2][1]}
    end

    # the numbers of the nodes of the house, the bridges and the panels, in order; with `all` the numbers struck off too, of which the list keeps the mark alone.
    # A server, or a member of a role this build does not know, is no node of the mesh, and is not here
    def ids(all)
        var out = []
        for i: 1 .. HouseList.MAX_NODE
            var x = self.field(HouseList.K_IDENT, i)
            if (x != nil && (x[2][0] == HouseList.ROLE_BRIDGE || x[2][0] == HouseList.ROLE_PANEL)) || (all && self.field(HouseList.K_REVOKE, i) != nil) out.push(i) end
        end
        return out
    end

    # the numbers of the house's servers, not struck off, in order
    def servers()
        var out = []
        for i: 1 .. HouseList.MAX_NODE
            var x = self.field(HouseList.K_IDENT, i)
            if x != nil && x[2][0] == HouseList.ROLE_SERVER out.push(i) end
        end
        return out
    end

    def role(id)
        var x = self.field(HouseList.K_IDENT, id)
        return x == nil ? 0 : x[2][0]
    end

    def revoked(id) return self.field(HouseList.K_REVOKE, id) != nil end

    # a node's name as the screens say it: its own, or its role and the end of its radio address, as Tasmota's host name has it (tasmota-0D5E5F-...);
    # nil for a number nobody has. The number is the mesh's, and the screens do not show it, and Tasmota's own host name is no name anyone gave the
    # node: "Bridge 4A7E21", as "Panel 5D02E9"
    def label(id)
        import string
        var n = self.node(id)
        if n == nil return nil end
        if n["name"] != "" && string.find(n["name"], "tasmota-") != 0 return n["name"] end
        if n["role"] == HouseList.ROLE_SERVER return "Server" end
        return (n["role"] == HouseList.ROLE_BRIDGE ? "Bridge " : "Panel ") + n["mac"][3 .. 5].tohex()
    end

    # whether this number is a panel of the house, that has not been struck off
    def is_panel(id)
        return self.role(id) == HouseList.ROLE_PANEL
    end

    # the number of the node of the house with this radio address (6 bytes) and this role, not struck off, or 0: a panel's own bridge, and a bridge's panel, which
    # each knows by their pairing
    def by_mac(mac, role)
        if mac == nil || size(mac) != 6 return 0 end
        var want = mac.tohex()
        for i: self.ids(false)
            var d = self.field(HouseList.K_IDENT, i)[2]
            if d[0] == role && d[33 .. 38].tohex() == want return i end
        end
        return 0
    end

    def name()
        var x = self.field(HouseList.K_NAME, 0)
        return x == nil ? "" : x[2].asstring()
    end

    # the number a new node is given: the lowest that is no node's and was not struck off (a number is never reused); 0 when there is none
    def next_id()
        for i: 1 .. HouseList.MAX_NODE
            if self.field(HouseList.K_IDENT, i) == nil && self.field(HouseList.K_REVOKE, i) == nil return i end
        end
        return 0
    end

    # the number of the alarm a new bridge is given: the lowest of 1 to 15 that no bridge of the house has; 0 when all are taken. The number of a bridge that was
    # struck off is free again
    def free_slot()
        var taken = {}
        for i: self.ids(false)
            var s = self.field(HouseList.K_SLOT, i)
            if s != nil taken[s[2][0]] = true end
        end
        for n: 1 .. HouseList.MAX_SLOT
            if !taken.contains(n) return n end
        end
        return 0
    end

    # the node of the house that has this public key (as 32 bytes), or 0: a node struck off has none, and comes back as a new one
    def find_key(key)
        for i: self.ids(false)
            if self.field(HouseList.K_IDENT, i)[2][1 .. 32] == key return i end
        end
        return 0
    end

    # --- the flash --------------------------------------------------------------------------------------------------

    # what is saved, as the persist key holds it
    def to_map()
        var vb = bytes()
        for a: self.authors()
            vb.add(a, 1)
            vb.add(self.v[a], -2)
        end
        var fb = bytes()
        for key: self.f.keys()
            var x = self.f[key]
            fb.add(x[0], 1)
            fb.add(key >> 8, 1)
            fb.add(key & 255, 1)
            fb.add(x[1], -2)
            fb.add(x[3], -2)
            fb.add(size(x[2]), 1)
            fb .. x[2]
        end
        return {"v": vb.tohex(), "f": fb.tohex(), "m": self.mine, "a": self.me, "k": HouseList.FORMAT}
    end

    # the state of a saved map; what is not whole is left out, and an empty list is what is left when nothing is
    def from_map(m)
        self.v = {}
        self.f = {}
        self.mine = 0
        self.clock = 0
        self.forgot = {}
        if !isinstance(m, map) return end
        var vb = type(m.find("v")) == "string" ? bytes(m["v"]) : bytes()
        var vec = HouseList.parse_vector(vb, 0)
        if vec != nil self.v = vec end
        var fb = type(m.find("f")) == "string" ? bytes(m["f"]) : bytes()
        var i = 0
        self.reading = true
        while i + 8 <= size(fb)
            var n = fb[i + 7]
            if i + 8 + n > size(fb) break end
            var data = n == 0 ? bytes() : fb[i + 8 .. i + 7 + n]
            if self.apply(fb[i], (fb[i + 3] << 8) | fb[i + 4], (fb[i + 5] << 8) | fb[i + 6], fb[i + 1], fb[i + 2], data) < 0 break end
            i += 8 + n
        end
        self.reading = false
        for id: self.ids(true)
            if self.revoked(id)  self.forget(id) end
        end
        # the seq of this node's last entry is of the node it was saved by: a node that has another number now has written nothing under it
        # saved by a build that knew less: what it skipped is asked for again, with every author's entries
        if m.find("k") != HouseList.FORMAT  self.v = {} end
        var mn = m.find("m")
        self.mine = type(mn) == "int" && mn >= 0 && mn <= HouseList.MAX_SEQ && m.find("a") == self.me ? mn : 0
        if self.mine > 0 && (self.v.find(self.me) == nil || self.v[self.me] < self.mine) self.v[self.me] = self.mine end
        self.lost = []
        self.rev += 1
    end

    def save()
        import persist
        persist.setmember(HouseList.KEY, self.to_map())
        persist.save()
    end

    def load()
        import persist
        self.from_map(persist.find(HouseList.KEY, nil))
    end
end
