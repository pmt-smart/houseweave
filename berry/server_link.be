# server_link.be -- a node and the house's server: the key of their pair, each request to the server signed with it, the server's
# requests to the node checked and answered, and the node presenting itself. A panel's and a bridge's alike.
#
# THE KEY. The node's identity is the mesh driver's X25519 pair, and the server's public key is its credential in the house's list (HouseMesh.server):
# espnow_mesh_pair_key gives the 32 bytes the two share (HKDF-SHA256 over the X25519 of the two), which the server derives the same from its secret and
# the node's public key. A server paired again, with another key, is another pair.
#
# TO THE SERVER, every request carries X-HouseWeave-Node (this node's number), X-HouseWeave-Time (the Unix time) and X-HouseWeave-Mac, the HMAC-SHA256 under the key of
# "method|path|time|the SHA-256 of the body in hex"; the server takes it within TIME_S of its own clock. Nothing is signed before the clock has the
# time (CLOCK_FROM): a node that starts after a power cut has none until the network gives it, and the server would refuse its first hello, said again
# only 10 min later.
# FROM THE SERVER, POST /houseweave/do with JSON {"v": 1, "verb", "t", "nonce", "mac": the HMAC of "houseweave-do|verb|t|node|nonce"}: taken within TIME_S, and once
# (the last NONCES nonces are kept), from the server of the list alone, and answered with what the verb's handler says and this node's state. The verbs
# are the node's: "backup", "upgrade", "round" (the night's: the state, and a backup when something changed), "restore" (the server's backup, this
# node's own or, in a hardware swap, the one of the node it replaces) and "state".
# THE NODE PRESENTS ITSELF to the server (POST /api/hello) on events: at its start, after a backup, after an upgrade; the server calls it at night. A
# panel adds the nodes of the house, with their keys and addresses, so the server knows every node it may hear from, and says them again when the
# house's list changed since (a node added, one gone, an address). A hello the server does not take (it is not there, or it does not know this
# node yet: a node it learns from a panel's hello later) is said again AGAIN_MS later, until it is taken: the server learns a node's address from
# its hello, and a bridge's is in no list.
# THE RELAY (the second stage): a node the server cannot call (behind another router, or with no Wi-Fi) gets its request through another node,
# one the server reaches. The server posts that node the verb "relay", signed for it, with "to" (the node) and "req" (the node's own request, signed
# for it, with the same nonce); the relaying node sends "req" over the mesh (HouseMesh.MSG_DO) and says "Sent". The node answers it as one that came
# to /houseweave/do, and sends the answer back in pieces (HouseMesh.MSG_DONE: seq, piece, pieces, then the text "nonce|mac|answer", the mac the HMAC under
# its own key of "houseweave-done|nonce|answer"), and the relaying node posts it to the server (POST /api/relayed, signed as its own requests, JSON {"to",
# "nonce", "mac", "answer"}): the server checks the node's signature, so the node in between can neither make an answer up nor change one. Only a
# node that was relayed a request is taken an answer from, and one frame goes on the air only when the server asks.
#@ solidify:ServerLink
class ServerLink
    static TIME_S = 600
    static NONCES = 16
    static KEY = "server_nonces"            # the nonces, kept before a verb that restarts the node: the server sends a request it lost the answer of again
    static RESTARTING = ["restore", "upgrade"]  # through another neighbour, with its nonce, and a restart must not forget that it ran
    static DO = "/houseweave/do"
    static HELLO = "/api/hello"
    static AGAIN_MS = 600000
    static SOON_MS = 30000        # a hello that did not reach the server: no answer, or a neighbour that could not carry it
    static CLOCK_FROM = 1700000000    # a clock before this (2023-11-14) does not have the time yet
    static RELAYED = "/api/relayed"
    static RELAYS = 4             # the requests relayed and waiting for their answers, at most
    static RELAY_MS = 60000       # and how long one waits

    var house_fn    # -> the house (HouseMesh), or nil
    var http        # the HTTP client (panel_http.be), for the node's hello
    var handlers    # verb -> f(): a map to answer with, or nil
    var state_fn    # -> this node's state, a map, for the answers and the hello
    var nodes_fn    # -> the nodes of the house to tell the server, or nil (a bridge's)
    var nonces      # the last nonces of the server's requests taken
    var cached      # [the server's public key, the key of the pair]
    var hello_due   # the kind of hello to say when the HTTP client is free, or nil
    var said_rev    # the house's list, by its rev, as a panel's last hello said its nodes, or nil
    var hello_after # after a hello the server did not take, no other before this moment (millis), or nil
    var soon        # the wait after a hello that did not reach the server: SOON_MS, twice that after another, up to AGAIN_MS; nil after one that did
    var carried     # the last hello the server took went over the mesh, through a neighbour: said again over the Wi-Fi once it is up
    var mesh        # the way to the server through a neighbour on the Wi-Fi, for this node when it has none (mesh_http.be), or nil
    var relays      # the server's requests this node relayed, waiting for their answers: [node, nonce, millis]
    var pieces      # node -> [seq, pieces, {piece: bytes}]: an answer coming over the mesh
    var outbox      # the answers relayed, as the bodies of their posts to the server, waiting for the HTTP client
    var seq         # the last answer this node sent over the mesh, 0 to 255

    def init(house_fn, http, state_fn, nodes_fn)
        self.house_fn = house_fn
        self.http = http
        self.state_fn = state_fn
        self.nodes_fn = nodes_fn
        self.handlers = {}
        self.nonces = ServerLink.kept_nonces()
        self.relays = []
        self.pieces = {}
        self.outbox = []
        self.seq = 0
        tasmota.add_driver(self)
    end

    # what the server's verb does here: f() -> a map, which goes back in the answer
    def on(verb, f) self.handlers[verb] = f end

    # the house's server ({"id", "host", "port", "name", "key"}), or nil
    def server()
        var h = self.house_fn != nil ? self.house_fn() : nil
        return h != nil && h.up && h.list.me >= 1 ? h.server() : nil
    end

    def me()
        var h = self.house_fn != nil ? self.house_fn() : nil
        return h != nil ? h.list.me : 0
    end

    # the key of this node's pair with the server, or nil (no server, or a driver without the pair's key)
    def key()
        import global
        var s = self.server()
        if s == nil || !isinstance(s.find("key"), bytes) || !global.contains("espnow_mesh_pair_key") return nil end
        if self.cached != nil && self.cached[0] == s["key"] return self.cached[1] end
        var k = global.espnow_mesh_pair_key(s["key"])
        if !isinstance(k, bytes) return nil end
        self.cached = [s["key"].copy(), k]
        return k
    end

    # the Unix time, as the clock says it
    static def now() return tasmota.rtc()["utc"] end

    # HMAC-SHA256 (RFC 2104) of the text `msg` under `key`, bytes or a text, with the firmware's SHA-256: as hex, in lower case
    static def hmac(key, msg)
        import crypto
        import string
        var k = isinstance(key, bytes) ? key : bytes().fromstring(str(key))
        if size(k) > 64
            var h = crypto.SHA256()
            h.update(k)
            k = h.out()
        end
        var ipad = bytes()
        var opad = bytes()
        for i: 0 .. 63
            var b = i < size(k) ? k[i] : 0
            ipad.add(b ^ 0x36, 1)
            opad.add(b ^ 0x5C, 1)
        end
        var inner = crypto.SHA256()
        inner.update(ipad)
        inner.update(bytes().fromstring(msg))
        var outer = crypto.SHA256()
        outer.update(opad)
        outer.update(inner.out())
        return string.tolower(outer.out().tohex())
    end

    # the SHA-256 of a text, as hex in lower case
    static def digest(text)
        import crypto
        import string
        var h = crypto.SHA256()
        h.update(bytes().fromstring(str(text)))
        return string.tolower(h.out().tohex())
    end

    # two texts compared whole, whatever they differ in
    static def same(a, b)
        import string
        if size(a) != size(b) return false end
        var d = 0
        for i: 0 .. size(a) - 1  d |= string.byte(a[i]) ^ string.byte(b[i]) end
        return d == 0
    end

    # why a request to the server cannot be signed now: "No clock" before the clock has the time, "No pair" without the pair's key; or nil
    def unsigned()
        if ServerLink.now() < ServerLink.CLOCK_FROM return "No clock" end
        return self.key() == nil ? "No pair" : nil
    end

    # the headers that sign a request to the server, or nil when there is no pair or no time
    def headers(method, path, body)
        var k = self.key()
        var t = ServerLink.now()
        if k == nil || t < ServerLink.CLOCK_FROM return nil end
        var mac = ServerLink.hmac(k, method + "|" + path + "|" + str(t) + "|" + ServerLink.digest(body != nil ? body : ""))
        return {"X-HouseWeave-Node": str(self.me()), "X-HouseWeave-Time": str(t), "X-HouseWeave-Mac": mac}
    end

    # A request to the server, signed: false when there is no server or no pair, or the client is busy. A node with no Wi-Fi sends it through a
    # neighbour that has one (the case 3), signed the same
    def request(http, method, path, body, done)
        var s = self.server()
        var hd = self.headers(method, path, body)
        if s == nil || hd == nil return false end
        if !tasmota.wifi().find("up", false) && self.mesh != nil  http = self.mesh end
        return http.request(method, s["host"], s["port"], path, body, done, hd)
    end

    # whether a request can go to the server: over this node's Wi-Fi, or through a neighbour on one
    def reachable()
        return tasmota.wifi().find("up", false) || (self.mesh != nil && self.mesh.can())
    end

    # why a request did not go: no time on the clock, no pair, no way to the server, or a client busy
    def why_not()
        var u = self.unsigned()
        if u != nil return u end
        return self.reachable() ? "Busy" : "No network"
    end

    # The nodes of the mesh, as the server is told of them (the pairing's answer, a panel's hello): [number, role, name, address, public key, radio
    # address], the address "" when the list has none
    static def nodes_of(h)
        var out = []
        for n: h.list.ids(false)
            var d = h.list.node(n)
            var a = d["ip"]
            out.push([n, d["role"], h.list.label(n), a != nil ? str(a[0]) + "." + str(a[1]) + "." + str(a[2]) + "." + str(a[3]) : "", d["key"].tohex(), d["mac"].tohex()])
        end
        return out
    end

    # --- the node presents itself ----------------------------------------------------------------------------------------------------------------

    # Said to the server on an event ("boot", "backup", "upgrade"), when the client is free: a hello waiting for it is said by every_second
    def hello(kind)
        self.hello_due = kind
        self.hello_after = nil
        self.say_hello()
    end

    def say_hello()
        import json
        # with the network up only (panel_http.be): a hello due at the start waits for the Wi-Fi, or for a neighbour on one to carry it
        if self.hello_due == nil || self.http == nil || self.http.busy() || !self.reachable() || self.unsigned() != nil return end
        if self.hello_after != nil && !tasmota.time_reached(self.hello_after) return end
        var kind = self.hello_due
        var m = self.state_fn != nil ? self.state_fn() : {}
        m["node"] = self.me()
        m["kind"] = self.hello_due
        var h = self.house_fn != nil ? self.house_fn() : nil
        if self.nodes_fn != nil  m["nodes"] = self.nodes_fn() end
        var by_mesh = !tasmota.wifi().find("up", false) && self.mesh != nil
        if self.request(self.http, "POST", ServerLink.HELLO, json.dump(m), / code, text -> self.hello_said(kind, code, by_mesh))
            self.hello_due = nil
            if self.nodes_fn != nil && h != nil  self.said_rev = h.list.rev end
        end
    end

    # the server's answer to a hello: one it did not take is said again AGAIN_MS later, unless an event says one first; one that did not reach it (no
    # answer, code 0, or a neighbour that could not carry it, 5xx) SOON_MS later, and twice as long after each other up to AGAIN_MS, for a server that is
    # down (a node with no Wi-Fi would lose its boot hello for 10 minutes at one failed carry)
    def hello_said(kind, code, by_mesh)
        if code >= 200 && code <= 299
            self.hello_after = nil
            self.soon = nil
            self.carried = by_mesh == true
            return
        end
        if self.hello_due == nil  self.hello_due = kind end
        var wait = ServerLink.AGAIN_MS
        if code <= 0 || code >= 500
            self.soon = self.soon == nil ? ServerLink.SOON_MS : (self.soon * 2 < ServerLink.AGAIN_MS ? self.soon * 2 : ServerLink.AGAIN_MS)
            wait = self.soon
        end
        self.hello_after = tasmota.millis(wait)
    end

    def every_second()
        self.say_hello()
        self.hook()
        self.post_relayed()
        while size(self.relays) > 0 && tasmota.millis() - self.relays[0][2] > ServerLink.RELAY_MS  self.relays.remove(0) end
        # a hello the server took through a neighbour (the mesh comes up at a start before the Wi-Fi does) is said again over the Wi-Fi, once it is
        # up: the server took no address for this node from the carried one (house-fleet.mjs), and asks it through another until a hello of its own
        if self.carried && self.hello_due == nil && tasmota.wifi().find("up", false)
            self.carried = false
            self.hello("wifi")
        end
        # a panel says the house's nodes again when its list changed since it said them
        if self.said_rev != nil && self.hello_due == nil
            var h = self.house_fn != nil ? self.house_fn() : nil
            if h != nil && h.up && h.list.rev != self.said_rev  self.hello("nodes") end
        end
    end

    # --- the server's requests ----------------------------------------------------------------------------------------------------------------

    def web_add_handler()
        import webserver
        webserver.on(ServerLink.DO, / -> self.post(), webserver.HTTP_POST)
    end

    def post()
        import webserver
        import json
        webserver.content_response(json.dump(self.answer(webserver.arg("plain"))))
    end

    # the nonces kept by the last verb that restarted the node, or none
    static def kept_nonces()
        import persist
        var l = persist.find(ServerLink.KEY, nil)
        var out = []
        if isinstance(l, list)
            for n: l
                if type(n) == "string"  out.push(n) end
            end
        end
        return out
    end

    def keep_nonces()
        import persist
        persist.setmember(ServerLink.KEY, self.nonces.copy())
        try
            persist.save()
        except .. as e, m
            log("HOUSE: the server's nonces were not saved (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # The server's request, as its body came: the answer, as a map
    def answer(text)
        import json
        var m = json.load(str(text))
        var k = self.key()
        if k == nil return {"v": 1, "error": "unpaired"} end
        if !isinstance(m, map) || m.find("v") != 1 || type(m.find("verb")) != "string" || type(m.find("t")) != "int" || type(m.find("nonce")) != "string" ||
           type(m.find("mac")) != "string"
            return {"v": 1, "error": "request"}
        end
        var want = ServerLink.hmac(k, "houseweave-do|" + m["verb"] + "|" + str(m["t"]) + "|" + str(self.me()) + "|" + m["nonce"])
        if !ServerLink.same(want, m["mac"]) return {"v": 1, "error": "mac"} end
        var off = ServerLink.now() - m["t"]
        if off > ServerLink.TIME_S || off < -ServerLink.TIME_S return {"v": 1, "error": "time"} end
        if self.nonces.find(m["nonce"]) != nil return {"v": 1, "error": "again"} end
        self.nonces.push(m["nonce"])
        if size(self.nonces) > ServerLink.NONCES  self.nonces.remove(0) end
        if ServerLink.RESTARTING.find(m["verb"]) != nil  self.keep_nonces() end
        var f = m["verb"] == "relay" ? / x -> self.relay(x) : self.handlers.find(m["verb"])
        if f == nil return {"v": 1, "error": "verb"} end
        var out = {"v": 1, "node": self.me(), "verb": m["verb"]}
        var said = f(m)
        if isinstance(said, map)
            for x: said.keys()  out[x] = said[x] end
        end
        out["state"] = self.state_fn != nil ? self.state_fn() : {}
        return out
    end

    # --- the relay --------------------------------------------------------------------------------------------------------------------------------

    # the house's frames for the server's link come here: the house takes the closure when there is one
    def hook()
        var h = self.house_fn != nil ? self.house_fn() : nil
        if h == nil || h.hooks.contains(h.MSG_DO) return end
        var f = / src, d -> self.from_mesh(src, d)
        h.hook(h.MSG_DO, f)
        h.hook(h.MSG_DONE, f)
    end

    # The server's request for another node: sent to it over the mesh, the word for the server "Sent" (or why not)
    def relay(m)
        import json
        var h = self.house_fn != nil ? self.house_fn() : nil
        var to = m.find("to")
        var r = m.find("req")
        if type(to) != "int" || to == self.me() || !isinstance(r, map) || r.find("nonce") != m["nonce"] return {"relay": "Request"} end
        if h == nil || !h.up || h.list.node(to) == nil return {"relay": "No such node"} end
        var b = bytes()
        b.add(h.MSG_DO, 1)
        b.add(h.WIRE, 1)
        b .. bytes().fromstring(json.dump(r))
        if !h.send(to, b) return {"relay": "Busy"} end
        self.relays.push([to, m["nonce"], tasmota.millis()])
        if size(self.relays) > ServerLink.RELAYS  self.relays.remove(0) end
        return {"relay": "Sent"}
    end

    # a frame of the house's for the link
    def from_mesh(src, d)
        if size(d) < 3 return end
        var h = self.house_fn != nil ? self.house_fn() : nil
        if h == nil return end
        if d[0] == h.MSG_DO
            self.relayed_do(h, src, d)
        elif d[0] == h.MSG_DONE
            self.relayed_done(src, d)
        end
    end

    # The server's request, relayed by the node `src`: answered as one that came to /houseweave/do, and the answer, signed under this node's key, back to it
    def relayed_do(h, src, d)
        import json
        import global
        var text = d[2 ..].asstring()
        var m = json.load(text)
        if !isinstance(m, map) || type(m.find("nonce")) != "string" return end
        var body = json.dump(self.answer(text))
        var k = self.key()
        var all = bytes().fromstring(m["nonce"] + "|" + (k != nil ? ServerLink.hmac(k, "houseweave-done|" + m["nonce"] + "|" + body) : "") + "|" + body)
        var room = (global.contains("espnow_mesh_max_payload") ? global.espnow_mesh_max_payload(src) : 200) - 5
        var of = (size(all) + room - 1) / room
        self.seq = (self.seq + 1) % 256
        for p: 0 .. of - 1
            var b = bytes()
            b.add(h.MSG_DONE, 1)
            b.add(h.WIRE, 1)
            b.add(self.seq, 1)
            b.add(p, 1)
            b.add(of, 1)
            b .. all[p * room .. p * room + room - 1]
            h.send(src, b)
        end
    end

    # A piece of an answer to a request this node relayed: kept until the answer is whole, and then posted to the server
    def relayed_done(src, d)
        import json
        import string
        if size(d) < 6 || d[4] < 1 return end
        var mine = false
        for r: self.relays
            if r[0] == src  mine = true end
        end
        if !mine return end
        var a = self.pieces.find(src)
        if a == nil || a[0] != d[2]
            a = [d[2], d[4], {}]
            self.pieces[src] = a
        end
        a[2][d[3]] = d[5 ..]
        if size(a[2]) < a[1] return end
        self.pieces.remove(src)
        var all = bytes()
        for i: 0 .. a[1] - 1
            if !a[2].contains(i) return end
            all .. a[2][i]
        end
        var text = all.asstring()
        var i1 = string.find(text, "|")
        var i2 = i1 > 0 ? string.find(text, "|", i1 + 1) : -1
        if i2 < 0 return end
        var nonce = text[0 .. i1 - 1]
        var at = -1
        for i: 0 .. size(self.relays) - 1
            if self.relays[i][0] == src && self.relays[i][1] == nonce  at = i end
        end
        if at < 0 return end
        self.relays.remove(at)
        self.outbox.push(json.dump({"to": src, "nonce": nonce, "mac": text[i1 + 1 .. i2 - 1], "answer": text[i2 + 1 ..]}))
        if size(self.outbox) > ServerLink.RELAYS  self.outbox.remove(0) end
        self.post_relayed()
    end

    # the next answer relayed, to the server, when the HTTP client is free
    def post_relayed()
        if size(self.outbox) == 0 || self.http == nil || self.http.busy() || !tasmota.wifi().find("up", false) return end
        if self.request(self.http, "POST", ServerLink.RELAYED, self.outbox[0], / code, text -> nil)  self.outbox.remove(0) end
    end
end
