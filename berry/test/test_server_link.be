# A node and the house's server (server_link.be): the key of their pair, the requests to the server signed with it, the server's
# requests checked and answered, and the node presenting itself. The signatures are pinned to the server's Node (libs/nspanel-sim/vm/test/house-fleet.test.mjs
# pins the same values)
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
import json
# the key of the pair, as the driver derives it for the pinned secrets (the node's 0x3C..., the server's 0x5A...)
var K = bytes("463c97311c85ec6df2640aeefc4be01b89b330283b2fb200af9ff9bc1e7dd238")
var SERVER_PUB = bytes("b0d08f35b4683381489afb32825e59152d47d19bc9e050d6d5a954984c9d1e2c")
var derived = []
global.espnow_mesh_pair_key = def (pub) derived.push(pub) return pub == SERVER_PUB ? K : false end

class FakeList
    var me, rev
    def init() self.me = 1 self.rev = 0 end
    def node(n) return n >= 1 && n <= 3 ? {"role": 2} : nil end
end
class FakeHouse
    static MSG_DO = 0x2E
    static MSG_DONE = 0x2F
    static WIRE = 1
    var up, list, srv, hooks, sent
    def init() self.up = true self.list = FakeList() self.srv = nil self.sent = [] self.hooks = {} end
    def server() return self.srv end
    def send(dest, b) self.sent.push([dest, b]) return true end
    def hook(msg, f) self.hooks[msg] = f end
    def on_link(src, d) self.hooks[d[0]](src, d) end
end
class FakeHttp
    var asked
    var done
    def busy() return self.done != nil end
    def request(method, host, port, path, body, done, headers)
        if self.done != nil return false end
        self.asked = [method, host, port, path, body, headers]
        self.done = done
        return true
    end
    def reply(code, body)
        var d = self.done
        self.done = nil
        d(code, body)
    end
end

tasmota.wifi_up = true
var house = FakeHouse()
var http = FakeHttp()
var link = ServerLink(/ -> house, http, / -> {"build": "a91d8b13/319cddad", "backup": {"dirty": false}}, / -> [[1, 2, "P-Desk", "192.168.2.113", "aa", "bb"]])
tasmota.utc_now = 1760000000

check("HMAC-SHA256 as RFC 4231 says it, under a text and under bytes", [ServerLink.hmac("Jefe", "what do ya want for nothing?"),
      ServerLink.hmac(bytes().fromstring("Jefe"), "what do ya want for nothing?")],
      ["5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843", "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"])
check("no server in the house: no key, no headers, no request", [link.key(), link.headers("PUT", "/api/backup", "{}"), link.request(http, "PUT", "/api/backup", "{}", nil)],
      [nil, nil, false])

house.srv = {"id": 8, "host": "192.168.2.108", "port": 8099, "name": "Home Assistant", "key": SERVER_PUB}
check("the key of the pair, from the driver, for the server's key, and kept", [link.key(), link.key(), size(derived)], [K, K, 1])
check("a request signed as the server checks it", link.headers("PUT", "/api/backup", '{"v":1}'),
      {"X-HouseWeave-Node": "1", "X-HouseWeave-Time": "1760000000", "X-HouseWeave-Mac": "b188046ab010fb3aa6224f1319961b4bab6ee0ffe7fe921fe2c4b880ef8261ee"})
check("and sent to it", [link.request(http, "PUT", "/api/backup", '{"v":1}', / c, t -> nil), http.asked[0 .. 4]],
      [true, ["PUT", "192.168.2.108", 8099, "/api/backup", '{"v":1}']])
http.reply(200, "")

# the node presents itself: its state, and a panel the nodes of the house; with the network only
tasmota.wifi_up = false
link.hello("boot")
check("a hello with the Wi-Fi not up yet waits for it", [link.hello_due, http.busy()], ["boot", false])
tasmota.wifi_up = true
link.every_second()
var said = json.load(http.asked[4])
check("the hello: to the server, signed, with the node's state, the event and the house's nodes",
      [http.asked[3], http.asked[5].contains("X-HouseWeave-Mac"), said["node"], said["kind"], said["build"], said["nodes"]],
      ["/api/hello", true, 1, "boot", "a91d8b13/319cddad", [[1, 2, "P-Desk", "192.168.2.113", "aa", "bb"]]])
link.hello("backup")
check("a hello while the client is busy waits for it", [link.hello_due, http.busy()], ["backup", true])
http.reply(200, "")
link.every_second()
check("and goes when it is free", [link.hello_due, json.load(http.asked[4])["kind"]], [nil, "backup"])
http.reply(200, "")
var asked = http.asked
link.every_second()
check("the house's list as it was: nothing more said", http.asked, asked)
house.list.rev += 1
link.every_second()
link.every_second()
check("the list changed (a node added, one gone, an address): the panel says its nodes again", [json.load(http.asked[4])["kind"], link.said_rev], ["nodes", 1])
http.reply(200, "")
asked = http.asked
link.every_second()
check("once", http.asked, asked)

# a hello the server does not take (it does not know this node yet, or it is not there) is said again 10 minutes later, until it is taken
link.hello("boot")
http.reply(401, "a node of the house's\n")
asked = http.asked
link.every_second()
check("refused: kept, and not said again at once", [link.hello_due, http.asked], ["boot", asked])
tasmota.at_ms = ServerLink.AGAIN_MS - 1
link.every_second()
check("nor before 10 minutes", http.asked, asked)
tasmota.at_ms = ServerLink.AGAIN_MS
link.every_second()
check("then said again", [json.load(http.asked[4])["kind"], link.hello_due], ["boot", nil])
# one that did not reach the server (no answer, or a neighbour that could not carry it over the mesh) is said again 30 s later, then 60 s, and so on
# up to the 10 minutes of a server that is down
var waits = []
for code: [0, 503, 0, 0, 0, 0, 0]
    http.reply(code, "No answer")
    asked = http.asked
    var from = tasmota.millis()
    var w = link.hello_after - from
    tasmota.at_ms = from + w - 1
    link.every_second()
    if http.asked != asked  waits.push("early") end
    tasmota.at_ms = from + w
    link.every_second()
    waits.push(http.asked != asked ? w : "not said")
end
check("a hello that did not reach the server: again at 30 s, 60, 120, and up to 10 minutes", waits,
      [30000, 60000, 120000, 240000, 480000, 600000, 600000])
http.reply(204, "")
check("taken: the wait starts over", link.soon, nil)
link.hello("boot")
tasmota.at_ms = ServerLink.AGAIN_MS
http.reply(0, "No answer")
link.hello("backup")
check("an event's hello goes at once, whatever the wait", json.load(http.asked[4])["kind"], "backup")
http.reply(204, "")
asked = http.asked
tasmota.at_ms = 2 * ServerLink.AGAIN_MS + 1
link.every_second()
check("taken: nothing more", [http.asked, link.hello_due, link.hello_after], [asked, nil, nil])
tasmota.at_ms = nil

# the server's requests
var did = []
link.on("backup", def () did.push("backup") return {"started": true} end)
def request(verb, t, nonce, mac)
    return json.dump({"v": 1, "verb": verb, "t": t, "nonce": nonce, "mac": mac != nil ? mac : ServerLink.hmac(K, "houseweave-do|" + verb + "|" + str(t) + "|1|" + nonce)})
end
check("the server's request as its Node signs it", ServerLink.hmac(K, "houseweave-do|backup|1760000000|1|00112233aabbccdd"),
      "f8ed022f190a5ac856320104599ce8a1a99f739340654de60f054b216794f015")
var a = link.answer(request("backup", 1760000000, "00112233aabbccdd", nil))
check("taken: the verb's handler, its word and the node's state", [did, a["node"], a["verb"], a["started"], a["state"]["build"]],
      [["backup"], 1, "backup", true, "a91d8b13/319cddad"])
check("the same request again is refused: once", link.answer(request("backup", 1760000000, "00112233aabbccdd", nil)), {"v": 1, "error": "again"})
check("a request not signed by the server's key", link.answer(request("backup", 1760000000, "0011223344556677", "0000000000000000000000000000000000000000000000000000000000000000")), {"v": 1, "error": "mac"})
check("one from more than 10 minutes ago, or ahead", [link.answer(request("backup", 1760000000 - 601, "1111111111111111", nil)),
      link.answer(request("backup", 1760000000 + 601, "2222222222222222", nil))], [{"v": 1, "error": "time"}, {"v": 1, "error": "time"}])
check("a verb this node does not have", link.answer(request("dance", 1760000000, "3333333333333333", nil)), {"v": 1, "error": "verb"})
check("what is not a request", [link.answer("nonsense"), link.answer('{"v": 1}')], [{"v": 1, "error": "request"}, {"v": 1, "error": "request"}])
for i: 1 .. 20  link.answer(request("backup", 1760000000, "a" + str(i), nil)) end
check("the nonces kept are the last 16", size(link.nonces), 16)

# a verb that restarts the node keeps the nonces before it runs: the server sends a request it lost the answer of again, through another
# neighbour, and the node, restarted, knows it ran it
import persist
var saves = persist.saves
check("a backup keeps nothing", [persist.saves, persist.find(ServerLink.KEY, nil)], [saves, nil])
var restored = []
link.on("restore", def () restored.push(1) return {"restore": "Looking"} end)
link.answer(request("restore", 1760000000, "7777777777777777", nil))
var kept = persist.find(ServerLink.KEY, [])
check("a restore keeps them, its own the last, before it runs", [persist.saves > saves, size(kept), kept[size(kept) - 1], restored],
      [true, 16, "7777777777777777", [1]])
var after = ServerLink(/ -> house, FakeHttp(), / -> {"build": "a91d8b13/319cddad"}, nil)
after.on("restore", def () restored.push(2) return {"restore": "Looking"} end)
check("restarted, the node answers the same restore again as one it ran, and does not run it", [after.answer(request("restore", 1760000000,
      "7777777777777777", nil)), restored], [{"v": 1, "error": "again"}, [1]])
persist.setmember(ServerLink.KEY, ["8888888888888888", 7, nil])
check("what the file holds that is not a nonce is left out", ServerLink.kept_nonces(), ["8888888888888888"])
persist.remove(ServerLink.KEY)
house.srv = nil
check("with no server in the house, nothing is taken", link.answer(request("backup", 1760000000, "4444444444444444", nil)), {"v": 1, "error": "unpaired"})

import webserver
link.web_add_handler()
check("the route the server posts to", webserver.routes[size(webserver.routes) - 1], ["/houseweave/do", webserver.HTTP_POST])

# THE RELAY (the second stage): the server's request for node 2, which it cannot reach, through this node (1), over the mesh
house.srv = {"id": 8, "host": "192.168.2.108", "port": 8099, "name": "Home Assistant", "key": SERVER_PUB}
link.every_second()
check("the house's frames for the link come to it", [type(house.hooks.find(0x2E)), type(house.hooks.find(0x2F))], ["function", "function"])
def relay_of(to, nonce, inner_nonce)
    var t = 1760000000
    var inner = {"v": 1, "verb": "state", "t": t, "nonce": inner_nonce, "mac": ServerLink.hmac(K, "houseweave-do|state|" + str(t) + "|" + str(to) + "|" + inner_nonce)}
    return json.dump({"v": 1, "verb": "relay", "t": t, "nonce": nonce, "mac": ServerLink.hmac(K, "houseweave-do|relay|" + str(t) + "|1|" + nonce), "to": to, "req": inner})
end
check("for itself, for another nonce than its own, or for no node of the house: not relayed",
      [link.answer(relay_of(1, "r1", "r1"))["relay"], link.answer(relay_of(2, "r2", "rx"))["relay"], link.answer(relay_of(9, "r3", "r3"))["relay"], size(house.sent)],
      ["Request", "Request", "No such node", 0])
a = link.answer(relay_of(2, "5555555555555555", "5555555555555555"))
check("the server's request for node 2: sent to it over the mesh, the word for the server Sent, with this node's state",
      [a["relay"], a["node"], a["state"]["build"], size(house.sent), house.sent[0][0], house.sent[0][1][0 .. 1]], ["Sent", 1, "a91d8b13/319cddad", 1, 2, bytes("2E01")])
check("the node's own request, as the server signed it", json.load(house.sent[0][1][2 ..].asstring())["nonce"], "5555555555555555")
# node 2: a link of its own, the same pair's key (the stub derives one for every node)
class FakeList2
    var me, rev
    def init() self.me = 2 self.rev = 0 end
    def node(n) return {"role": 1} end
end
var house2 = FakeHouse()
house2.list = FakeList2()
house2.srv = house.srv
var link2 = ServerLink(/ -> house2, FakeHttp(), / -> {"build": "295db989/aa", "backup": {"dirty": true}}, nil)
var asked2 = []
link2.on("state", def () asked2.push(1) return {} end)
link2.every_second()
global.espnow_mesh_max_payload = def (dest) return 60 end
house2.on_link(1, house.sent[0][1])
check("node 2 answers it as one that came to /houseweave/do, and back to the node that relayed it, in pieces as the mesh takes them",
      [size(asked2), size(house2.sent) > 1, house2.sent[0][0], house2.sent[0][1][0 .. 1], size(house2.sent[0][1]) <= 60], [1, true, 1, bytes("2F01"), true])
var pieces = house2.sent
house2.sent = []
house2.on_link(1, house.sent[0][1])
check("the same request again: its answer says so", json.load(house2.sent[size(house2.sent) - 1][1][5 ..].asstring()) == nil, true)
house.on_link(3, pieces[0][1])
check("a piece from a node this one relayed nothing to is not taken", size(link.pieces), 0)
http.done = def (c, t) end
for i: 0 .. size(pieces) - 1
    house.on_link(2, pieces[size(pieces) - 1 - i][1])
end
check("the pieces, in any order: the answer whole, waiting for the HTTP client", [size(link.relays), size(link.outbox), size(link.pieces)], [0, 1, 0])
http.done = nil
link.every_second()
var m = json.load(http.asked[4])
var ans = json.load(m["answer"])
check("then posted to the server, signed by this node", [http.asked[0], http.asked[3], http.asked[5]["X-HouseWeave-Node"], m["to"], m["nonce"]],
      ["POST", "/api/relayed", "1", 2, "5555555555555555"])
check("with node 2's answer as it said it, and its state", [ans["node"], ans["verb"], ans["state"]["build"]], [2, "state", "295db989/aa"])
check("signed under node 2's key, so the node in between can change nothing", m["mac"], ServerLink.hmac(K, "houseweave-done|5555555555555555|" + m["answer"]))
http.reply(204, "")
for i: 0 .. size(pieces) - 1  house.on_link(2, pieces[i][1]) end
check("the same answer again: no request waits for it", size(link.outbox), 0)
link.answer(relay_of(2, "6666666666666666", "6666666666666666"))
tasmota.at_ms = tasmota.millis() + ServerLink.RELAY_MS + 1000
link.every_second()
check("a request relayed with no answer for a minute is let go", size(link.relays), 0)
tasmota.at_ms = nil
global.espnow_mesh_max_payload = nil

# a node that starts after a power cut has no time until the network gives it: nothing is signed, and its hello waits for the time (else
# the server would refuse the first hello of every node, and each would be said again 10 min later)
tasmota.utc_now = 30
check("no time yet: no headers, and why", [link.headers("GET", "/api/backup", nil), link.unsigned(), link.request(http, "GET", "/api/backup", nil, nil)],
      [nil, "No clock", false])
asked = http.asked
link.hello("boot")
link.every_second()
check("the hello waits for the time", [link.hello_due, http.asked], ["boot", asked])
tasmota.utc_now = 1760000000
link.every_second()
check("and goes when the clock has it", [link.hello_due, http.asked[3], link.unsigned()], [nil, "/api/hello", nil])
http.reply(204, "")

# a node with no Wi-Fi: its requests through a neighbour that has one (mesh_http.be, the case 3), signed the same
class FakeMesh
    var asked, ok, done
    def can() return self.ok == true end
    def busy() return false end
    def request(method, host, port, path, body, done, headers) self.asked = [method, path, headers["X-HouseWeave-Node"]] self.done = done return true end
end
var fm = FakeMesh()
tasmota.wifi_up = false
check("no Wi-Fi and no way through a neighbour: not reachable, and why", [link.reachable(), link.why_not()], [false, "No network"])
link.mesh = fm
check("a way through a neighbour, but none on the Wi-Fi now: still not", link.reachable(), false)
fm.ok = true
check("a neighbour on the Wi-Fi: reachable", link.reachable(), true)
asked = http.asked
check("a request goes through it, signed the same, and not over the Wi-Fi", [link.request(http, "GET", "/api/backup", nil, nil), fm.asked, http.asked],
      [true, ["GET", "/api/backup", "1"], asked])
link.hello("backup")
check("and so does a hello", fm.asked, ["POST", "/api/hello", "1"])
tasmota.wifi_up = true
fm.asked = nil
check("with the Wi-Fi up, over it again", [link.request(http, "GET", "/api/backup", nil, / code, text -> nil), fm.asked, http.asked[3]], [true, nil, "/api/backup"])
http.reply(404, "")
# a hello the server took through a neighbour, at a start where the mesh came up before the Wi-Fi: said again over the Wi-Fi
# once it is up, for the server to take this node's address, which it takes from no carried hello
tasmota.wifi_up = false
link.hello("boot")
check("over the mesh", fm.asked, ["POST", "/api/hello", "1"])
fm.done(204, "")
link.every_second()
check("taken through a neighbour: nothing more while the Wi-Fi is down", [link.carried, link.hello_due], [true, nil])
tasmota.wifi_up = true
link.every_second()
check("the Wi-Fi up: said again over it", [link.carried, http.asked[3], json.load(http.asked[4])["kind"]], [false, "/api/hello", "wifi"])
http.reply(204, "")
asked = http.asked
link.every_second()
check("taken over the Wi-Fi: once", [link.carried, http.asked], [false, asked])
link.mesh = nil

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
end
