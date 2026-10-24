# The house's server paired on a panel (house_server.be): the window and its code, the HMAC that proves the code, the server's request
# answered with what it needs of the house, and the server written into the list (house_mesh.be, add_server)
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

# HMAC-SHA256 as RFC 4231 says it (its test cases 2 and 6: a short key, and a key longer than the block), which the server's Node computes the same
check("HMAC-SHA256, RFC 4231 case 2", HouseServer.hmac("Jefe", "what do ya want for nothing?"), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843")
var long = ""
for i: 1 .. 131  long += "\xaa" end
check("and case 6, a key past the block", HouseServer.hmac(long, "Test Using Larger Than Block-Size Key - Hash Key First"),
      "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54")
# and the server's request as the server's Node makes it (ha/houseweave/server/house-pairing.mjs, whose test pins the same value)
check("the pairing's HMAC, the same on the server", HouseServer.hmac("123456", "houseweave-pair-1|9a968a150000000000000000000000000000000000000000000000000000fd5f|" +
      "192.168.2.108|8099|Home Assistant|0011223344556677"), "d3390a5fcc3546613c19927edbb7a3ce02986118c90a48f47fc3dd589b8b6782")
check("an IPv4 address in dots, and what is not one", [HouseServer.ipv4("192.168.2.108"), HouseServer.ipv4("192.168.2"), HouseServer.ipv4("192.168.2.256"),
      HouseServer.ipv4("a.b.c.d"), HouseServer.ipv4(nil)], [bytes("C0A8026C"), nil, nil, nil, nil])

# a house of a panel (1) and a bridge (2), the panel writing the list: add_server is HouseMesh's, on its list
class FakeHouse
    var list
    var wrote_n
    def init()
        self.list = HouseList(1)
        self.list.author(HouseList.K_IDENT, 1, bytes("02") + bytes(-32) + bytes("0A0B0C0D0E01"))
        self.list.author(HouseList.K_NAME, 0, bytes().fromstring("Cottage"))
        self.list.author(HouseList.K_IDENT, 2, bytes("01") + bytes(-32) + bytes("0A0B0C0D0E02"))
        self.list.author(HouseList.K_ADDR, 2, bytes("C0A80273"))
        self.list.author(HouseList.K_NAME, 2, bytes().fromstring("B-PC"))
        self.wrote_n = 0
    end
    def writes() return true end
    def wrote() self.wrote_n += 1 end
    def add_server(key, ip, port, name) return HouseMesh.add_server(self, key, ip, port, name) end
    def server() return HouseMesh.server(self) end
end
var house = FakeHouse()
var told = 0
tasmota.timers = []
var hs = HouseServer(/ -> house, def () told += 1 end)
var key = "9a968a150000000000000000000000000000000000000000000000000000fd5f"

# a request as the server makes it, with the code it was told
def request(code, k, host, port, name, nonce)
    import json
    return json.dump({"v": 1, "key": k, "host": host, "port": port, "name": name, "nonce": nonce,
                      "mac": HouseServer.hmac(code, "houseweave-pair-1|" + k + "|" + host + "|" + str(port) + "|" + name + "|" + nonce)})
end

check("closed: a request is refused", hs.answer(request("123456", key, "192.168.2.108", 8099, "Home Assistant", "0011223344556677")), {"v": 1, "error": "closed"})
hs.open()
var code = hs.code
check("opened: a code of six digits, for two minutes", [size(code), code[0] >= "0" && code[0] <= "9", hs.state()["left"], told], [6, true, 120, 1])
import string
var wrong = code == "000000" ? "000001" : "000000"
check("a request with another code is refused, and counts", [hs.answer(request(wrong, key, "192.168.2.108", 8099, "Home Assistant", "0011223344556677")), hs.tries, hs.code != nil],
      [{"v": 1, "error": "code"}, 1, true])
check("one that is not a request", [hs.answer("{}"), hs.answer("nonsense"), hs.answer(request(code, "abc", "192.168.2.108", 8099, "HA", "0011223344556677")),
      hs.answer(request(code, key, "server.local", 8099, "HA", "0011223344556677"))], [{"v": 1, "error": "request"}, {"v": 1, "error": "request"},
      {"v": 1, "error": "request"}, {"v": 1, "error": "request"}])
var a = hs.answer(request(code, key, "192.168.2.108", 8099, "Home Assistant", "0011223344556677"))
check("the server's request, with the code: its number, the house, the nodes of the mesh with their keys and radio addresses, and the answer proved by the code",
      [a["node"], a["house"], a["panel"], a["nodes"], a["mac"] == HouseServer.hmac(code, "houseweave-pair-2|0011223344556677|3|Cottage")],
      [3, "Cottage", 1, [[1, 2, "Panel 0D0E01", "", "0000000000000000000000000000000000000000000000000000000000000000", "0A0B0C0D0E01"], [2, 1, "B-PC", "192.168.2.115", "0000000000000000000000000000000000000000000000000000000000000000", "0A0B0C0D0E02"]], true])
check("written into the list as the house's server: no node of the mesh", [house.list.servers(), house.list.ids(false), house.server()],
      [[3], [1, 2], {"id": 3, "host": "192.168.2.108", "port": 8099, "name": "Home Assistant", "key": bytes(key)}])
check("the window closed, saying what it added", [hs.code, hs.state()["added"]], [nil, "Home Assistant"])
check("a code serves once", hs.answer(request(code, key, "192.168.2.108", 8099, "Home Assistant", "8899aabbccddeeff")), {"v": 1, "error": "closed"})

# the same server paired again: its number kept, its address and port written again
hs.open()
a = hs.answer(request(hs.code, key, "192.168.2.120", 8123, "Home Assistant", "0011223344556677"))
check("the same server again: its number kept, its new address", [a["node"], house.server()["host"], house.server()["port"], house.list.servers()],
      [3, "192.168.2.120", 8123, [3]])

# three wrong codes close the window, and so does its time
hs.open()
code = hs.code
wrong = code == "000000" ? "000001" : "000000"
for i: 1 .. 3  hs.answer(request(wrong, key, "192.168.2.108", 8099, "HA", "0011223344556677")) end
check("three wrong codes close the window", [hs.code, hs.state()["why"]], [nil, "tries"])
hs.open()
tasmota.at_ms = tasmota.millis(HouseServer.WINDOW_MS)
hs.every_second()
check("and so does its time", [hs.code, hs.state()["why"]], [nil, "time"])

# the route, on the web server
import webserver
hs.web_add_handler()
check("the route the server posts to", webserver.routes[size(webserver.routes) - 1], ["/houseweave/pair", webserver.HTTP_POST])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
end
