# house_server.be -- the house's server paired on a panel: the window the panel opens, with a code of 6 digits that the owner types on the server,
# and the server's request, which comes over HTTP and which the code proves, answered with what the server needs of the house.
#
# THE WINDOW. The mesh page's + opens it, on the screen Add server, for WINDOW_MS: the code, drawn at random, and the panel's address. The code never goes on the
# network: it is the key of an HMAC-SHA256 that each side puts on what it says. A request whose HMAC does not check counts, and TRIES of them close the window;
# the one that checks closes it too, so a code serves once.
#
# THE REQUEST, the server to the panel: POST /houseweave/pair, JSON {"v": 1, "key": the server's X25519 public key (64 hex), "host": its IPv4 address, "port": its HTTP
# port, "name": what the house calls it, "nonce": 16 hex, "mac": the HMAC of "houseweave-pair-1|key|host|port|name|nonce", 64 hex}. The server is written into the
# list (HouseMesh.add_server), and every node of the house knows it from there.
# THE ANSWER: {"v": 1, "node": its number, "house": the house's name, "panel": this panel's number, "nodes": [[number, role, name, address, public key, radio
# address], ...] of the nodes of the mesh (the server checks each node's requests by its key), "mac": the HMAC of "houseweave-pair-2|nonce|node|house"}; or {"v": 1, "error": "closed" | "code" | "request" | "house"}.
#
# What the code does not stop: someone on the house's network in those two minutes who takes the request on its way, finds the code from its HMAC (a million
# tries) and answers in the panel's place, or sends its own first. The window is short and opened by hand, and the panel says the name of what it added.
#@ solidify:HouseServer
class HouseServer
    static WINDOW_MS = 120000
    static TRIES = 3
    static PATH = "/houseweave/pair"

    var house_fn    # -> the house (HouseMesh), or nil
    var changed     # called when the window opens or closes, or a server is added, or nil
    var code        # the window's code, 6 digits, or nil when it is closed
    var until       # when it closes
    var tries       # requests that did not check
    var added       # the name of the server the last window added, or nil
    var why         # why the last window closed with none added: "time", "tries", or nil

    def init(house_fn, changed)
        self.house_fn = house_fn
        self.changed = changed
        tasmota.add_driver(self)
    end

    def say()
        if self.changed != nil  self.changed() end
    end

    # the window, opened with a code of its own
    def open()
        import crypto
        import string
        var r = crypto.random(4)
        var n = ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) & 0x7FFFFFFF
        self.code = string.format("%06d", n % 1000000)
        self.until = tasmota.millis(HouseServer.WINDOW_MS)
        self.tries = 0
        self.added = nil
        self.why = nil
        self.say()
    end

    def close(why)
        if self.code == nil return end
        self.code = nil
        self.why = why
        self.say()
    end

    # what the screen shows: {"code", "left" in seconds, "added", "why"}
    def state()
        var left = self.code != nil ? (self.until - tasmota.millis()) / 1000 : 0
        return {"code": self.code, "left": left > 0 ? left : 0, "added": self.added, "why": self.why}
    end

    def every_second()
        if self.code == nil return end
        if tasmota.time_reached(self.until) return self.close("time") end
        self.say()
    end

    def web_add_handler()
        import webserver
        webserver.on(HouseServer.PATH, / -> self.post(), webserver.HTTP_POST)
    end

    def post()
        import webserver
        import json
        webserver.content_response(json.dump(self.answer(webserver.arg("plain"))))
    end

    # HMAC-SHA256 of the text `msg` under the text `key`, as hex in lower case: the server link's (server_link.be)
    static def hmac(key, msg) return ServerLink.hmac(key, msg) end

    # two texts compared whole, whatever they differ in
    static def same(a, b) return ServerLink.same(a, b) end

    # an IPv4 address in dots as 4 bytes, or nil
    static def ipv4(s)
        import string
        var p = string.split(str(s), ".")
        if size(p) != 4 return nil end
        var b = bytes()
        for x: p
            if size(x) == 0 || size(x) > 3 return nil end
            for i: 0 .. size(x) - 1
                if x[i] < "0" || x[i] > "9" return nil end
            end
            var n = int(x)
            if n > 255 return nil end
            b.add(n, 1)
        end
        return b
    end

    # The server's request, as its body came: the answer, as a map
    def answer(text)
        import json
        import string
        if self.code == nil || tasmota.time_reached(self.until)
            self.close("time")
            return {"v": 1, "error": "closed"}
        end
        var m = json.load(str(text))
        var key = isinstance(m, map) ? str(m.find("key", "")) : ""
        var ip = isinstance(m, map) ? HouseServer.ipv4(m.find("host")) : nil
        var port = isinstance(m, map) ? m.find("port") : nil
        var name = isinstance(m, map) ? str(m.find("name", "")) : ""
        var nonce = isinstance(m, map) ? str(m.find("nonce", "")) : ""
        var mac = isinstance(m, map) ? string.tolower(str(m.find("mac", ""))) : ""
        if m == nil || m.find("v") != 1 || size(key) != 64 || ip == nil || type(port) != "int" || port < 1 || port > 65535 || size(name) > 40 || size(nonce) != 16
            return {"v": 1, "error": "request"}
        end
        var want = HouseServer.hmac(self.code, "houseweave-pair-1|" + key + "|" + str(m["host"]) + "|" + str(port) + "|" + name + "|" + nonce)
        if !HouseServer.same(want, mac)
            self.tries += 1
            if self.tries >= HouseServer.TRIES  self.close("tries") end
            return {"v": 1, "error": "code"}
        end
        var kb = nil
        try
            kb = bytes(key)
        except ..
        end
        var h = self.house_fn != nil ? self.house_fn() : nil
        var id = h != nil && kb != nil && size(kb) == 32 ? h.add_server(kb, ip, port, name != "" ? name : "Server") : 0
        var code = self.code
        if id == 0
            self.close(nil)
            return {"v": 1, "error": "house"}
        end
        var nodes = ServerLink.nodes_of(h)
        var house = h.list.name()
        self.added = name != "" ? name : "Server"
        self.code = nil
        self.why = nil
        log("HOUSE: the server " + self.added + " at " + str(m["host"]) + ":" + str(port) + " is in the house, as node " + str(id), 2)
        self.say()
        return {"v": 1, "node": id, "house": house, "panel": h.list.me, "nodes": nodes,
                "mac": HouseServer.hmac(code, "houseweave-pair-2|" + nonce + "|" + str(id) + "|" + house)}
    end
end
