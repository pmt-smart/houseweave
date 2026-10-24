# The house's server reached through a neighbour (mesh_http.be, the case 3): a node with no Wi-Fi's request carried whole over the mesh to a
# neighbour on one, made by it as it came, and the answer brought back; pieces lost and asked for again, a neighbour busy or with no server, and no answer
var checks = 0
var failures = 0
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

import global
global.espnow_mesh_max_payload = def (dest) return 47 end      # 40 bytes of a transfer in a piece: a short request goes in a few

# the mesh between the houses of the test: each frame a house sends is the other's, unless the test drops it
class FakeList
    var me
    def init(me) self.me = me end
end
class FakeHouse
    static MSG_HTTP_REQ = 0x38
    static MSG_HTTP_ANS = 0x39
    static MSG_HTTP_MISS = 0x3A
    static WIRE = 1
    var up, list, hooks, out, sent, wifi, peers, drop
    def init(me) self.up = true self.list = FakeList(me) self.hooks = {} self.out = [] self.sent = [] self.wifi = [] self.peers = {} self.drop = nil end
    def hook(msg, f) self.hooks[msg] = f end
    def wifi_neighbours() return self.wifi.copy() end
    def send(dest, b)
        self.sent.push([dest, b])
        var to = self.peers.find(dest)
        if to != nil && (self.drop == nil || !self.drop(b))  to.hooks[b[0]](self.list.me, b) end
        return true
    end
end
# the neighbour's own client to the server: what it was asked, answered by the test
class FakeHttp
    var asked, done, raw
    def busy() return self.done != nil end
    def request(method, host, port, path, body, done, headers, raw)
        if self.done != nil return false end
        self.asked = [method, host, port, path, body, headers]
        self.raw = raw
        self.done = done
        return true
    end
    def reply(code, body)
        var d = self.done
        self.done = nil
        d(code, body)
    end
end

var far = FakeHouse(7)
var near = FakeHouse(4)
far.peers[4] = near
near.peers[7] = far
var server = {"host": "192.168.2.108", "port": 8099}
var http = FakeHttp()
var node = MeshHttp(/ -> far, nil, / -> nil)
var helper = MeshHttp(/ -> near, http, / -> server)
def tick(n)
    for i: 1 .. n
        node.every_100ms()
        helper.every_100ms()
    end
end
def second()
    node.every_second()
    helper.every_second()
end
second()
check("the house's frames of this part come to it", [type(far.hooks.find(0x38)), type(far.hooks.find(0x39)), type(far.hooks.find(0x3A))],
      ["function", "function", "function"])

# no neighbour on the Wi-Fi: nothing to carry the request
var got = []
var done = def (code, body) got.push([code, body]) end
check("no neighbour on the Wi-Fi: no way, and nothing sent", [node.can(), node.request("GET", "h", 1, "/api/backup", nil, done, {}), size(far.sent)],
      [false, false, 0])

# a request carried: in pieces, a few every 100 ms, made by the neighbour as it came, with its number beside the node's signature
far.wifi = [4]
var signed = {"X-HouseWeave-Node": "7", "X-HouseWeave-Time": "1760000000", "X-HouseWeave-Mac": "ab12"}
var body = '{"v": 1, "bridge": "a0b7654a7e22", "keys": {"zb_names": {"0x811A": "Desk"}}}'
check("a neighbour on the Wi-Fi: a way", node.can(), true)
check("the request taken", [node.request("PUT", "ignored", 0, "/api/backup", body, done, signed), node.busy()], [true, true])
check("one at a time", node.request("GET", "h", 1, "/api/backup", nil, done, signed), false)
tick(1)
check("two pieces in the first 100 ms", size(far.sent), 2)
tick(20)
check("made by the neighbour to its server, as the node signed it, with the number of the node that carried it",
      [http.asked[0], http.asked[1], http.asked[2], http.asked[3], http.asked[4], http.asked[5]],
      ["PUT", "192.168.2.108", 8099, "/api/backup", body, {"X-HouseWeave-Node": "7", "X-HouseWeave-Time": "1760000000", "X-HouseWeave-Mac": "ab12", "X-HouseWeave-Via": "4"}])
http.reply(204, "")
tick(5)
check("the answer back to the node: its code and its body", [got, node.busy(), helper.carrying], [[[204, ""]], false, nil])

# pieces lost each way: the end that takes a transfer asks for the ones it lacks, and the other sends them again
got = []
var n = 0
far.drop = def (b) n += 1 return b[0] == 0x38 && (n % 3) == 0 end
near.drop = def (b) return b[0] == 0x39 && b.get(3, 2) == 1 end
node.request("GET", "", 0, "/api/backup", nil, done, signed)
tick(20)
check("a piece in three of the request lost: not whole yet", http.asked[3] == "/api/backup" && http.done == nil, true)
tasmota.at_ms = tasmota.millis() + MeshHttp.GAP_MS + 1
far.drop = nil
second()
tick(10)
check("asked again for the pieces it lacks, it is whole, and made", http.busy(), true)
var backup = '{"v": 1, "bridge": "a0b7654a7e22", "at": 1792625555, "keys": {"zb_alarm": {"armed": false}}, "settings": {"v": 1, "kv": 3, "d": "AAAA"}}'
http.reply(200, backup)
tick(10)
check("the answer's second piece lost: not back yet", size(got), 0)
near.drop = nil
tasmota.at_ms = tasmota.millis() + MeshHttp.GAP_MS + 1
second()
tick(10)
check("asked again, the answer whole", got, [[200, backup]])

# a neighbour that carries another's request, or has no server: 503 and why, at once
got = []
var other = FakeHouse(9)
other.peers[4] = near
near.peers[9] = other
other.wifi = [4]
var third = MeshHttp(/ -> other, nil, / -> nil)
third.every_second()
node.request("GET", "", 0, "/api/backup", nil, done, signed)
tick(5)
var got3 = []
third.request("GET", "", 0, "/api/backup", nil, def (code, body) got3.push([code, body]) end, {})
for i: 1 .. 5
    third.every_100ms()
    helper.every_100ms()
end
check("a neighbour carrying another's request: busy, at once", got3, [[503, "Busy"]])
http.reply(404, "no backup of this node")
tick(5)
check("and the first one's answer", got, [[404, "no backup of this node"]])
server = nil
got3 = []
third.request("GET", "", 0, "/api/backup", nil, def (code, body) got3.push([code, body]) end, {})
for i: 1 .. 5
    third.every_100ms()
    helper.every_100ms()
end
check("a neighbour with no server: said", got3, [[503, "No server"]])
server = {"host": "192.168.2.108", "port": 8099}
tasmota.heap_free_kb = 30
got3 = []
third.request("GET", "", 0, "/api/backup", nil, def (code, body) got3.push([code, body]) end, {})
for i: 1 .. 5
    third.every_100ms()
    helper.every_100ms()
end
check("nor one with no room for it", got3, [[503, "Low memory"]])
tasmota.heap_free_kb = nil

# a binary answer: to a request that asked for bytes, its body whole, through the neighbour's client and back
got = []
node.request("GET", "", 0, "/ota/houseweave-safeboot.bin", nil, done, {"Range": "bytes=0-9"}, true)
tick(10)
check("the request carried with its Range, and the neighbour's client asked for bytes",
      [http.asked[5], http.raw], [{"Range": "bytes=0-9", "X-HouseWeave-Via": "4"}, true])
http.reply(206, bytes("E9060002000020656E64"))
tick(10)
check("the answer's body as bytes, every byte of it", got, [[206, bytes("E9060002000020656E64")]])

# a request nobody answers: the node is told, after WAIT_MS
got = []
far.drop = def (b) return true end
node.request("GET", "", 0, "/api/backup", nil, done, signed)
tick(10)
tasmota.at_ms = tasmota.millis() + MeshHttp.WAIT_MS + 1
second()
check("no answer in WAIT_MS: code 0, and the node free again", [got, node.busy()], [[[0, "No answer"]], false])
far.drop = nil

# what the end that sends keeps, and lets go
tasmota.at_ms = tasmota.millis() + MeshHttp.KEEP_MS + 1
second()
check("the pieces sent kept KEEP_MS after the last, for the other end to ask again; then let go", [size(node.sends), size(helper.sends)], [0, 0])
check("an answer from a node not asked is not taken", [far.hooks[0x39](9, bytes("390101000001414141")), node.busy()], [nil, false])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
end
