# mesh_http.be -- the house's server reached through a neighbour, for a node with no Wi-Fi (the case 3): its requests to the server, signed by
# it (server_link.be), carried whole over the mesh to a neighbour on a Wi-Fi access point, which makes them as they are and brings the answer back the
# same way. The server takes a request on the node's own signature, so the neighbour can change nothing of it; the neighbour adds X-HouseWeave-Via, its
# number, so that the server does not take its address for the node's.
#
# The same as panel_http.be's client to the one that asks: request(method, host, port, path, body, done, headers), busy(), and done(code, body), code 0
# and the reason for a failure; the server's address is the neighbour's to know. A request, "method path\n", the headers as JSON, "\n" and the body,
# goes in pieces (HouseMesh.MSG_HTTP_REQ), and its answer, "code\n" and the body, comes back in pieces (MSG_HTTP_ANS). A piece is [msg, wire, transfer,
# piece (2 bytes), pieces (2 bytes)] and its bytes, PER_TICK of them every 100 ms while the house's queue is short. The end that takes a transfer and
# hears nothing of it for GAP_MS asks for the pieces it lacks (MSG_HTTP_MISS: [msg, wire, transfer, the transfer's msg, each piece in 2 bytes]),
# TRIES times; the one that sends keeps the pieces KEEP_MS after the last. A request with no answer in WAIT_MS ends with code 0 and "No answer". One
# request at a time each way: a neighbour that carries another's, or has no server or no room for it, answers 503 and why.
#@ solidify:MeshHttp
class MeshHttp
    static HEAD = 7
    static PER_TICK = 2
    static QUEUE = 8          # the house's frames waiting for the mesh, past which no piece is queued
    static GAP_MS = 1500
    static TRIES = 4
    static WAIT_MS = 60000
    static KEEP_MS = 20000
    static MISS_MAX = 40
    static MAX = 36864        # the most a transfer carries: panel_http.be's 32 000 of a body, and the request's head
    static HEAP_KB = 40       # the free heap a neighbour keeps when it takes a request to carry

    var house_fn    # -> the house (HouseMesh), or nil
    var http        # the neighbour's own client, for the requests it carries (panel_http.be)
    var server_fn   # -> the house's server {"host", "port"}, or nil
    var sends       # the transfers this node sends: {"to", "msg", "id", "data", "of", "room", "next", "again", "at"}
    var takes       # the ones it takes, by "src/msg/id": {"src", "msg", "id", "of", "got", "at", "tries"}
    var asked       # this node's request on its way: {"id", "to", "done", "at"}, or nil
    var carrying    # the request this node carries for a neighbour: [src, id], or nil
    var seq

    def init(house_fn, http, server_fn)
        self.house_fn = house_fn
        self.http = http
        self.server_fn = server_fn
        self.sends = []
        self.takes = {}
        self.seq = 0
        tasmota.add_driver(self)
    end

    def house()
        var h = self.house_fn != nil ? self.house_fn() : nil
        return h != nil && h.up ? h : nil
    end

    def busy() return self.asked != nil end

    # whether a neighbour on the Wi-Fi is there to carry a request
    def can()
        var h = self.house()
        return h != nil && size(h.wifi_neighbours()) > 0
    end

    # A request to the server through the neighbour on the Wi-Fi with the best signal: false, and nothing sent, while another is on its way, or with
    # no neighbour to carry it
    def request(method, host, port, path, body, done, headers)
        import json
        var h = self.house()
        if h == nil || self.asked != nil return false end
        var to = h.wifi_neighbours()
        if size(to) == 0 return false end
        var data = bytes().fromstring(method + " " + path + "\n" + json.dump(headers != nil ? headers : {}) + "\n")
        if body != nil  data .. bytes().fromstring(str(body)) end
        if size(data) > MeshHttp.MAX return false end
        self.seq = (self.seq + 1) % 256
        self.asked = {"id": self.seq, "to": to[0], "done": done, "at": tasmota.millis()}
        self.send_whole(to[0], h.MSG_HTTP_REQ, self.seq, data)
        return true
    end

    # a transfer to `to`, sent a few pieces at a time (every_100ms)
    def send_whole(to, msg, id, data)
        import global
        var room = (global.contains("espnow_mesh_max_payload") ? global.espnow_mesh_max_payload(to) : 200) - MeshHttp.HEAD
        var i = 0
        while i < size(self.sends)
            var x = self.sends[i]
            if x["to"] == to && x["msg"] == msg && x["id"] == id
                self.sends.remove(i)
            else
                i += 1
            end
        end
        self.sends.push({"to": to, "msg": msg, "id": id, "data": data, "of": (size(data) + room - 1) / room, "room": room, "next": 0, "again": [],
                         "at": tasmota.millis()})
    end

    def piece(h, x, p)
        var b = bytes()
        b.add(x["msg"], 1)
        b.add(h.WIRE, 1)
        b.add(x["id"], 1)
        b.add(p, 2)
        b.add(x["of"], 2)
        b .. x["data"][p * x["room"] .. p * x["room"] + x["room"] - 1]
        return b
    end

    def every_100ms()
        var h = self.house()
        if h == nil || size(self.sends) == 0 || size(h.out) >= MeshHttp.QUEUE return end
        var count = MeshHttp.PER_TICK
        for x: self.sends
            while count > 0 && (size(x["again"]) > 0 || x["next"] < x["of"])
                var again = size(x["again"]) > 0
                var p = again ? x["again"][0] : x["next"]
                if !h.send(x["to"], self.piece(h, x, p)) return end
                if again
                    x["again"].remove(0)
                else
                    x["next"] += 1
                end
                x["at"] = tasmota.millis()
                count -= 1
            end
            if count == 0 return end
        end
    end

    def every_second()
        var h = self.house()
        if h == nil return end
        if !h.hooks.contains(h.MSG_HTTP_REQ)
            var f = / src, d -> self.from_mesh(src, d)
            h.hook(h.MSG_HTTP_REQ, f)
            h.hook(h.MSG_HTTP_ANS, f)
            h.hook(h.MSG_HTTP_MISS, f)
        end
        var now = tasmota.millis()
        # the pieces sent, kept a while for the other end to ask again
        var i = 0
        while i < size(self.sends)
            var x = self.sends[i]
            if x["next"] >= x["of"] && size(x["again"]) == 0 && now - x["at"] > MeshHttp.KEEP_MS
                self.sends.remove(i)
            else
                i += 1
            end
        end
        # a transfer that went quiet: the pieces it lacks asked for again, or let go
        for k: self.takes.keys()
            var t = self.takes[k]
            if now - t["at"] <= MeshHttp.GAP_MS continue end
            if t["tries"] >= MeshHttp.TRIES
                self.takes.remove(k)
                if self.carrying != nil && self.carrying[0] == t["src"] && self.carrying[1] == t["id"] && t["msg"] == h.MSG_HTTP_REQ  self.carrying = nil end
                break
            end
            t["tries"] += 1
            t["at"] = now
            var b = bytes()
            b.add(h.MSG_HTTP_MISS, 1)
            b.add(h.WIRE, 1)
            b.add(t["id"], 1)
            b.add(t["msg"], 1)
            var n = 0
            for p: 0 .. t["of"] - 1
                if n >= MeshHttp.MISS_MAX break end
                if !t["got"].contains(p)
                    b.add(p, 2)
                    n += 1
                end
            end
            h.send(t["src"], b)
        end
        # this node's request with no answer
        if self.asked != nil && now - self.asked["at"] > MeshHttp.WAIT_MS
            var done = self.asked["done"]
            self.asked = nil
            if done != nil  done(0, "No answer") end
        end
    end

    # The house's frames of this part: a piece of a request or of an answer, and a transfer's missing pieces asked for again
    def from_mesh(src, d)
        var h = self.house()
        if h == nil || size(d) < 4 return end
        if d[0] == h.MSG_HTTP_MISS
            for x: self.sends
                if x["to"] == src && x["id"] == d[2] && x["msg"] == d[3]
                    var o = 4
                    while o + 1 < size(d)
                        var p = d.get(o, 2)
                        if p < x["of"] && x["again"].find(p) == nil  x["again"].push(p) end
                        o += 2
                    end
                end
            end
            return
        end
        if size(d) < MeshHttp.HEAD return end
        var id = d[2]
        var p = d.get(3, 2)
        var of = d.get(5, 2)
        if of == 0 || p >= of return end
        if d[0] == h.MSG_HTTP_ANS && (self.asked == nil || self.asked["id"] != id || self.asked["to"] != src) return end
        var k = str(src) + "/" + str(d[0]) + "/" + str(id)
        var t = self.takes.find(k)
        if t == nil
            if d[0] == h.MSG_HTTP_REQ
                var why = self.refused(src, id, of)
                if why != nil
                    self.send_whole(src, h.MSG_HTTP_ANS, id, bytes().fromstring("503\n" + why))
                    return
                end
                self.carrying = [src, id]
            end
            t = {"src": src, "msg": d[0], "id": id, "of": of, "got": {}, "at": 0, "tries": 0}
            self.takes[k] = t
        end
        t["got"][p] = d[MeshHttp.HEAD ..]
        t["at"] = tasmota.millis()
        if size(t["got"]) < t["of"] return end
        self.takes.remove(k)
        var all = bytes()
        for i: 0 .. t["of"] - 1  all .. t["got"][i] end
        if d[0] == h.MSG_HTTP_REQ
            self.carry(src, id, all.asstring())
        else
            self.answered(all.asstring())
        end
    end

    # why a neighbour's request is not carried, or nil: another under way, no server, or no room for it
    def refused(src, id, of)
        if self.carrying != nil && (self.carrying[0] != src || self.carrying[1] != id) return "Busy" end
        if self.server_fn == nil || self.server_fn() == nil return "No server" end
        if self.http == nil || self.http.busy() return "Busy" end
        # the free heap, in KB as Tasmota says it: what it keeps, and the request twice (its pieces, then whole)
        if tasmota.memory()["heap_free"] < MeshHttp.HEAP_KB + (2 * of * 200) / 1024 return "Low memory" end
        return nil
    end

    # A neighbour's request, whole: made to the server as it came, with this node's number beside its signature, and the answer sent back
    def carry(src, id, text)
        import json
        import string
        var h = self.house()
        var s = self.server_fn != nil ? self.server_fn() : nil
        var i1 = string.find(text, "\n")
        var i2 = i1 > 0 ? string.find(text, "\n", i1 + 1) : -1
        var sp = i1 > 0 ? string.find(text[0 .. i1 - 1], " ") : -1
        var head = i2 > 0 ? json.load(text[i1 + 1 .. i2 - 1]) : nil
        var back = def (code, body)
            self.carrying = nil
            self.send_whole(src, h.MSG_HTTP_ANS, id, bytes().fromstring(str(code) + "\n" + str(body)))
        end
        if h == nil || s == nil || sp <= 0 || !isinstance(head, map)
            back(503, s == nil ? "No server" : "Not a request")
            return
        end
        head["X-HouseWeave-Via"] = str(h.list.me)
        var body = size(text) > i2 + 1 ? text[i2 + 1 ..] : nil
        if !self.http.request(text[0 .. sp - 1], s["host"], s["port"], text[sp + 1 .. i1 - 1], body, back, head)  back(503, "Busy") end
    end

    # this node's request answered: its code and body to the one that asked
    def answered(text)
        import string
        var done = self.asked != nil ? self.asked["done"] : nil
        self.asked = nil
        var i = string.find(text, "\n")
        var code = i > 0 ? int(text[0 .. i - 1]) : 0
        if done != nil  done(code, i > 0 ? text[i + 1 ..] : "Not an answer") end
    end
end
