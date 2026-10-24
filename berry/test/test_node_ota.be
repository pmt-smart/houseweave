# A node's OTA (node_ota.be): the server's index looked at, what it has for this image, and the upgrade through the safeboot image; and its screen
# in the node's Wireless settings (node_wireless.be)
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

# Tasmota's commands, as the test answers them
class CmdStub : TasmotaStub
    var said
    var answer
    def cmd(c)
        self.said = c
        return type(self.answer) == "function" ? self.answer(c) : self.answer
    end
end
tasmota = CmdStub()
tasmota.timers = []
def run_timers()
    var t = tasmota.timers
    tasmota.timers = []
    for x: t  x[1]() end
end

# the HTTP client, panel_http.be's, answered by the test
class FakeHttp
    var asked
    var done
    def busy() return self.done != nil end
    def request(method, host, port, path, body, done, headers)
        if self.done != nil return false end
        self.asked = [method, host, port, path]
        self.done = done
        return true
    end
    def reply(code, body)
        var d = self.done
        self.done = nil
        d(code, body)
    end
end

PanelBuild.COMMIT = "a91d8b13/319cddad"
PanelBuild.IMAGE = "tasmota32-houseweave-living-room-us"
var http = FakeHttp()
var server = nil
var told = 0
var ota = NodeOta(http, / -> server, def () told += 1 end)
var index = '{"v": 1, "images": {"tasmota32-houseweave-living-room-us": {"path": "tasmota32-houseweave-living-room-us.ota", "build": "b0000002/319cddad", ' +
            '"size": 2057024, "date": "2026-10-21T01:00"}, "tasmota32-houseweave-bridge": {"path": "tasmota32-houseweave-bridge.ota", ' +
            '"build": "a91d8b13/319cddad", "size": 1726464, "date": "2026-10-20T23:21"}}, "safeboot": {"path": "houseweave-safeboot.bin", "build": "a91d8b13/319cddad"}}'

# no server in the house: nothing to ask
var s = ota.state()
check("no server: none, and nothing stale to look at", [s["server"], s["build"], s["image"], s["stale"], s["seen"]],
      ["", "a91d8b13/319cddad", "tasmota32-houseweave-living-room-us", false, nil])
ota.run("look", [])
check("a look with no server says so, and asks nothing", [ota.result, http.asked, told], ["No server", nil, 1])

# the server paired: its index asked, and what it has for this image kept
server = {"host": "192.168.2.108", "port": 8099, "name": "Home Assistant"}
ota.result = ""
check("the server, by its name; stale before a look", [ota.state()["server"], ota.state()["name"], ota.state()["stale"]], ["192.168.2.108:8099", "Home Assistant", true])
ota.run("look", [])
check("its index, asked", [http.asked, ota.busy], [["GET", "192.168.2.108", 8099, "/ota/index.json"], "looking"])
ota.run("look", [])
check("one look at a time", http.busy(), true)
http.reply(200, index)
check("what it has for this image, and the safeboot image's file", [ota.busy, ota.seen, ota.state()["stale"]],
      ["", {"build": "b0000002/319cddad", "date": "2026-10-21T01:00", "size": 2057024, "path": "tasmota32-houseweave-living-room-us.ota",
            "safeboot": "houseweave-safeboot.bin"}, false])
check("a build as the screens say it", [NodeOta.short("b0000002/319cddad"), NodeOta.short("dev")], ["b0000002", "dev"])

# the upgrade: a moment after the touch, the command with the release's and the safeboot's addresses
tasmota.answer = {"EspNowOtaUpgrade": {"Image": "c8ff7b7e", "Size": 2057024, "Safeboot": "Kept"}}
ota.run("upgrade", [])
check("upgrading, said before it runs", [ota.busy, tasmota.said, size(tasmota.timers)], ["upgrading", nil, 1])
run_timers()
check("the command, with the release's folder and the safeboot image",
      tasmota.said, "EspNowOtaUpgrade http://192.168.2.108:8099/ota/tasmota32-houseweave-living-room-us.ota http://192.168.2.108:8099/ota/houseweave-safeboot.bin")
check("and it stays upgrading: the node restarts", [ota.busy, ota.result], ["upgrading", ""])

ota.busy = ""
tasmota.answer = {"EspNowOtaUpgrade": "the release is not signed by a key of this build"}
ota.run("upgrade", [])
run_timers()
check("an upgrade refused says why, and the screen can ask again", [ota.busy, ota.result], ["", "the release is not signed by a key of this build"])
tasmota.answer = {"Command": "Unknown"}
ota.run("upgrade", [])
run_timers()
check("a firmware without the command says so", ota.result, "Not in this firmware")

# a server that does not answer, or has no index, or none for this image
ota.run("look", [])
http.reply(0, "No answer")
check("no answer", [ota.busy, ota.result], ["", "No answer"])
ota.run("look", [])
http.reply(404, "")
check("no releases on it, and not stale: the screen does not ask again at each redraw", [ota.result, ota.state()["stale"]], ["No releases", false])
ota.run("look", [])
http.reply(200, '{"v": 1, "images": {}}')
check("none for this image: an empty entry", [ota.seen, ota.result], [{}, ""])

# --- through a neighbour (the case 3) ----------------------------------------------------------------------------------------------------------
# a house: the nodes this one hears on the Wi-Fi, the frames it sends, the parts' hooks, and the neighbours heard in their safeboot image
class FakeHouse
    static MSG_OTA_ASK = 0x35
    static MSG_OTA_GO = 0x36
    static MSG_OTA_NO = 0x37
    static WIRE = 1
    var up, hooks, sent, wifi, safeboot
    def init() self.up = true self.hooks = {} self.sent = [] self.wifi = [] self.safeboot = {} end
    def hook(msg, f) self.hooks[msg] = f end
    def send(dest, b) self.sent.push([dest, b]) return true end
    def wifi_neighbours() return self.wifi.copy() end
    def frame(src, msg, m)
        import json
        var b = bytes()
        b.add(msg, 1)
        b.add(1, 1)
        b .. bytes().fromstring(json.dump(m))
        self.hooks[msg](src, b)
    end
end
def body_of(b)
    import json
    return json.load(b[2 ..].asstring())
end
var home = FakeHouse()
var far = NodeOta(FakeHttp(), / -> server, nil, / -> home)
far.every_second()
check("the house's frames of this part come to it", [type(home.hooks.find(0x35)), type(home.hooks.find(0x36)), type(home.hooks.find(0x37))],
      ["function", "function", "function"])
# the server's Upgrade, relayed to a node whose own look does not reach the server: the neighbours on the Wi-Fi, asked in turn
home.wifi = [5, 6]
check("the server's Upgrade: a look first", far.upgrade_asked(), "Looking")
far.http.reply(0, "No answer")
check("the look does not reach the server: the neighbour on the Wi-Fi with the best signal asked for this image's release",
      [size(home.sent), home.sent[0][0], home.sent[0][1][0], body_of(home.sent[0][1]), far.result],
      [1, 5, 0x35, {"i": "tasmota32-houseweave-living-room-us", "b": "a91d8b13/319cddad"}, "Asking node 5"])
home.frame(6, 0x37, {"r": "Busy"})
check("an answer from a node not asked is not taken", [size(home.sent), far.asked[0]], [1, 5])
home.frame(5, 0x37, {"r": "No answer"})
check("it cannot fetch it either: the next one", [size(home.sent), home.sent[1][0], far.result], [2, 6, "Asking node 6"])
tasmota.at_ms = tasmota.millis() + NodeOta.ASK_MS + 1
far.every_second()
check("one that does not answer: the next, and with none left, said", [size(home.sent), far.asked, far.result], [2, nil, "No neighbour on the Wi-Fi"])
tasmota.at_ms = nil
# asked again: told GO, into the safeboot image, only when the command goes
far.upgrade_asked()
far.http.reply(0, "No network")
tasmota.answer = {"EspNowOtaArm": "Done"}
home.frame(5, 0x36, {"b": "b0000002/319cddad"})
check("told GO: this node goes into its safeboot image, to take the image over the mesh", [tasmota.said, far.result, far.asked],
      ["EspNowOtaArm", "Waiting for node 5", nil])
far.upgrade_asked()
far.http.reply(0, "No network")
tasmota.answer = {"EspNowOtaArm": "the safeboot image is not one known to take an image over ESP-NOW"}
home.frame(5, 0x36, {"b": "b0000002/319cddad"})
check("a safeboot image not known to take one: it does not go, and says why", far.result, "the safeboot image is not one known to take an image over ESP-NOW")
far.upgrade_asked()
far.http.reply(0, "No network")
home.frame(5, 0x37, {"r": "Up to date"})
check("up to date: nothing more asked", [far.result, far.asked, size(far.helpers)], ["Up to date", nil, 0])
check("an answer when nothing was asked is not taken", [home.frame(5, 0x36, {"b": "x"}), far.result], [nil, "Up to date"])
far.upgrade_asked()
far.http.reply(404, "")
check("a server that answers is no case for a neighbour", [far.result, far.asked], ["No releases", nil])

# the neighbour's side: a node asks this one, which reaches the server, for its release
var near = NodeOta(FakeHttp(), / -> server, nil, / -> home)
home.hooks = {}
home.sent = []
near.every_second()
home.frame(7, 0x35, {"i": "tasmota32-houseweave-bridge", "b": "0000aaaa/319cddad"})
check("asked: what the server has for that image, looked at", near.http.asked, ["GET", "192.168.2.108", 8099, "/ota/index.json"])
home.frame(4, 0x35, {"i": "tasmota32-houseweave-living-room-us", "b": "x"})
check("another while it looks: busy", [home.sent[0][0], body_of(home.sent[0][1])], [4, {"r": "Busy"}])
near.http.reply(200, index)
check("a newer build: GO, and the node kept to send to", [home.sent[1][0], home.sent[1][1][0], body_of(home.sent[1][1]), near.sending["url"]],
      [7, 0x36, {"b": "a91d8b13/319cddad"}, "http://192.168.2.108:8099/ota/tasmota32-houseweave-bridge.ota"])
var said = []
tasmota.answer = def (c) said.push(c) return c == "EspNowOtaSend" ? {"EspNowOtaSend": {"State": 0}} : {"EspNowOtaSend": "Started"} end
near.every_second()
check("the node not heard in its safeboot image yet: nothing sent", said, [])
home.safeboot[7] = [1, 3, 30]
near.every_second()
check("heard taking an image: nothing sent", said, [])
home.safeboot[7] = [0, 0, 0]
near.every_second()
check("heard waiting: the send, when none is under way", said, ["EspNowOtaSend", "EspNowOtaSend 7 http://192.168.2.108:8099/ota/tasmota32-houseweave-bridge.ota"])
near.every_second()
check("not again at once", size(said), 2)
tasmota.at_ms = NodeOta.SEND_AGAIN_MS + 1
near.every_second()
check("a send that ended, the node still waiting: again after SEND_AGAIN_MS", size(said), 4)
tasmota.at_ms = 2 * NodeOta.SEND_AGAIN_MS + 2
tasmota.answer = def (c) said.push(c) return {"EspNowOtaSend": {"State": 2}} end
near.every_second()
check("not while a send is under way", size(said), 5)
home.safeboot.remove(7)
near.every_second()
check("the node out of its safeboot image: forgotten", near.sending, nil)
home.frame(7, 0x35, {"i": "tasmota32-houseweave-bridge", "b": "a91d8b13/319cddad"})
near.http.reply(200, index)
check("the same build: up to date", body_of(home.sent[size(home.sent) - 1][1]), {"r": "Up to date"})
home.frame(7, 0x35, {"i": "tasmota32-houseweave-eu", "b": "x"})
near.http.reply(200, index)
check("an image the server has nothing for", body_of(home.sent[size(home.sent) - 1][1]), {"r": "No releases"})
home.frame(7, 0x35, {"i": "tasmota32-houseweave-bridge", "b": "x"})
near.http.reply(0, "No answer")
check("a server this node does not reach either: why", body_of(home.sent[size(home.sent) - 1][1]), {"r": "No answer"})
home.frame(7, 0x35, {"i": "tasmota32-houseweave-bridge", "b": "x"})
near.http.reply(200, index)
tasmota.at_ms = 3 * NodeOta.SEND_AGAIN_MS + NodeOta.SEND_MS
near.every_second()
check("kept SEND_MS at most", near.sending, nil)
tasmota.at_ms = nil
tasmota.answer = nil
server = nil
home.frame(7, 0x35, {"i": "tasmota32-houseweave-bridge", "b": "x"})
check("no server in the house: said", body_of(home.sent[size(home.sent) - 1][1]), {"r": "No server"})
server = {"host": "192.168.2.108", "port": 8099, "name": "Home Assistant"}

# A node its safeboot image left waiting for the mesh: a neighbour on the Wi-Fi that hears it stalled sends it the release whose image it
# waits for, found in the index by the image's SHA-256
var index2 = '{"v": 1, "images": {"tasmota32-houseweave-living-room-us": {"path": "tasmota32-houseweave-living-room-us.ota", "build": "c0000003/319cddad", ' +
             '"sha256": "8bcef245aea2d83eb3169c0fb02341a7"}, "tasmota32-houseweave-bridge": {"path": "tasmota32-houseweave-bridge.ota", ' +
             '"build": "c0000003/319cddad", "sha256": "0f88761c78c7aa00"}}}'
var helper = NodeOta(FakeHttp(), / -> server, nil, / -> home)
home.safeboot = {}
tasmota.wifi_up = true
tasmota.at_ms = 1000
home.safeboot[1] = [1, 0, 33, "8BCEF245", -12, 1000]
helper.every_second()
check("a node heard taking an image: nothing looked at", helper.http.asked, nil)
tasmota.at_ms = 1000 + NodeOta.STUCK_MS + 12 * NodeOta.RANK_MS - 1
helper.every_second()
check("not before STUCK_MS, and RANK_MS for each dB of its signal", helper.http.asked, nil)
tasmota.at_ms += 1
helper.every_second()
check("stalled that long: the index looked at", helper.http.asked, ["GET", "192.168.2.108", 8099, "/ota/index.json"])
helper.http.reply(200, index2)
check("the release whose image it waits for, whatever the case of the hex, kept to send to it",
      [helper.sending["node"], helper.sending["url"], helper.sending["stuck"]], [1, "http://192.168.2.108:8099/ota/tasmota32-houseweave-living-room-us.ota", true])
said = []
tasmota.answer = def (c) said.push(c) return c == "EspNowOtaSend" ? {"EspNowOtaSend": {"State": 0}} : {"EspNowOtaSend": "Started"} end
helper.every_second()
check("sent, though it says it takes an image: it stalled there", said,
      ["EspNowOtaSend", "EspNowOtaSend 1 http://192.168.2.108:8099/ota/tasmota32-houseweave-living-room-us.ota"])
home.safeboot[1] = [1, 1, 33, "8BCEF245", -12, tasmota.millis()]
tasmota.at_ms += NodeOta.SEND_AGAIN_MS + 1
helper.every_second()
check("moving again: not sent again", size(said), 2)
home.safeboot.remove(1)
helper.every_second()
check("out of its safeboot image: forgotten", helper.sending, nil)
# the one that hears it worse waits longer, and does not start once the node moves
var worse = NodeOta(FakeHttp(), / -> server, nil, / -> home)
tasmota.at_ms = 100000
home.safeboot[1] = [1, 4, 33, "8bcef245", -80, 100000]
tasmota.at_ms = 100000 + NodeOta.STUCK_MS + 12 * NodeOta.RANK_MS
worse.every_second()
check("at -80 dBm, not yet when one at -12 starts", worse.http.asked, nil)
home.safeboot[1] = [1, 5, 33, "8bcef245", -80, tasmota.millis()]
tasmota.at_ms += 80 * NodeOta.RANK_MS
worse.every_second()
check("and the node moved meanwhile: nothing", worse.http.asked, nil)
# the node moves while the index is fetched: nothing sent
tasmota.at_ms += NodeOta.STUCK_MS + 80 * NodeOta.RANK_MS
worse.every_second()
check("stalled again: looked at", worse.http.asked, ["GET", "192.168.2.108", 8099, "/ota/index.json"])
home.safeboot[1] = [1, 6, 33, "8bcef245", -80, tasmota.millis()]
worse.http.reply(200, index2)
check("it moved while the index was fetched: nothing kept", worse.sending, nil)
# an image the server has no release of: said, and the node not looked for again before RESCUE_AGAIN_MS
var lost = NodeOta(FakeHttp(), / -> server, nil, / -> home)
home.safeboot[2] = [1, 0, 28, "deadbeef", -50, tasmota.millis()]
home.safeboot.remove(1)
tasmota.at_ms += NodeOta.STUCK_MS + 50 * NodeOta.RANK_MS
lost.every_second()
lost.http.reply(200, index2)
check("no release with its image: nothing kept", lost.sending, nil)
lost.http.asked = nil
tasmota.at_ms += NodeOta.RESCUE_AGAIN_MS - 1
lost.every_second()
check("and not looked for again before RESCUE_AGAIN_MS", lost.http.asked, nil)
tasmota.at_ms += 1
lost.every_second()
check("then again", lost.http.asked, ["GET", "192.168.2.108", 8099, "/ota/index.json"])
lost.http.reply(0, "No answer")
lost.http.asked = nil
tasmota.at_ms += NodeOta.INDEX_AGAIN_MS - 1
lost.every_second()
check("an index that could not be read: not again before INDEX_AGAIN_MS", lost.http.asked, nil)
tasmota.at_ms += 1
lost.every_second()
check("then again, sooner than after a release not found", lost.http.asked, ["GET", "192.168.2.108", 8099, "/ota/index.json"])
lost.http.reply(0, "No answer")
# an HTTP client busy at that second: nothing asked, and the node not counted as looked for
var busy_http = FakeHttp()
var held = NodeOta(busy_http, / -> server, nil, / -> home)
busy_http.done = def (c, b) end
tasmota.at_ms += NodeOta.RESCUE_AGAIN_MS
held.every_second()
check("the client busy: nothing asked", [busy_http.asked, held.tried.contains(2)], [nil, false])
busy_http.done = nil
held.every_second()
check("free the next second: asked", busy_http.asked, ["GET", "192.168.2.108", 8099, "/ota/index.json"])
busy_http.reply(0, "No answer")
# nothing from a node off its Wi-Fi, for a node with no image begun, or one that checks or has its image whole
var quiet = NodeOta(FakeHttp(), / -> server, nil, / -> home)
home.safeboot = {3: [0, 0, 0, "", -40, 0], 4: [2, 28, 28, "0f88761c", -40, 0], 5: [3, 28, 28, "0f88761c", -40, 0]}
tasmota.at_ms += NodeOta.RESCUE_AGAIN_MS + NodeOta.STUCK_MS + 100 * NodeOta.RANK_MS
quiet.every_second()
check("none of them is a node left waiting", quiet.http.asked, nil)
home.safeboot[6] = [4, 3, 28, "0f88761c", -40, 0]
tasmota.wifi_up = false
quiet.every_second()
check("a node that failed and waits is one, but not for a node off its Wi-Fi", quiet.http.asked, nil)
tasmota.wifi_up = true
quiet.every_second()
check("with its Wi-Fi: looked at", quiet.http.asked, ["GET", "192.168.2.108", 8099, "/ota/index.json"])
quiet.http.reply(200, index2)
check("and sent the bridge's release", quiet.sending["url"], "http://192.168.2.108:8099/ota/tasmota32-houseweave-bridge.ota")
home.safeboot = {}
tasmota.at_ms = nil
tasmota.answer = nil

# --- the screen ---------------------------------------------------------------------------------------------------------------------------------------
def wifi_state()
    return {"saved": "", "ssid": "", "up": false, "ip": "", "mac": "B0:B0:B0:00:00:01", "off": false, "reason": "", "scanning": false, "networks": nil,
            "join": nil, "hotspot": nil}
end
var st = {"wifi": wifi_state(), "radio": nil, "house_ch": 0, "alone": false, "mqtt": "Off", "backup": nil, "ota": nil}
var ran = []
var run = def (e) for x: e ran.push(x) end end
def ask(view, k, x) return NodeWireless.answer(view, k, x, / -> st, run) end
def labels(r)
    var out = []
    for x: r[2]  out.push([x[0], x[1], x[2]]) end
    return out
end

var r = ask(["wireless"], nil, nil)
check("a node without the OTA's state keeps no OTA row", labels(r), [["Wi-Fi", "None", 1], ["MQTT", "Off", 6], ["Web password", "", 3]])
st["backup"] = {"server": "", "busy": "", "pending": false, "last": nil}
r = ask(["wireless"], nil, nil)
check("nor does it lose its backup", labels(r)[2], ["Backup", "No server", 1])

st["ota"] = {"server": "", "name": "", "build": "a91d8b13/319cddad", "seen": nil, "busy": "", "result": "", "stale": false}
r = ask(["wireless"], nil, nil)
check("the OTA row in the backup's place: no server paired", [labels(r)[2], r[2][2][4]], [["OTA", "Not paired", 1], ["ota"]])
r = ask(["ota"], nil, nil)
check("the OTA screen: the server not paired, the backup in it, and the firmware", [r[1], labels(r)],
      ["OTA", [["Server", "Not paired", 0], ["Backup", "No server", 1], ["Firmware", "a91d8b13", 0]]])

st["ota"] = {"server": "192.168.2.108:8099", "name": "Home Assistant", "build": "a91d8b13/319cddad", "seen": nil, "busy": "", "result": "", "stale": true}
ran = []
r = ask(["ota"], nil, nil)
check("opened with a look asked of the server, when the last is old", [ran, labels(r)[0]], [[["ota", "look"]], ["Server", "Home Assistant", 0]])
st["ota"]["busy"] = "looking"
st["ota"]["stale"] = false
r = ask(["ota"], nil, nil)
check("looking: asked again in a moment", [labels(r)[3], r[5].find("a")], [["Release", "Looking", 0], NodeWireless.ASK_MS])
st["ota"]["busy"] = ""
st["ota"]["seen"] = {"build": "a91d8b13/319cddad", "path": "x.ota", "safeboot": "houseweave-safeboot.bin"}
r = ask(["ota"], nil, nil)
check("the same build: up to date, and a touch looks again", [labels(r)[3], labels(ask(["wireless"], nil, nil))[2]], [["Release", "Up to date", 2], ["OTA", "Up to date", 1]])
ran = []
ask(["ota"], 3, nil)
check("the touch: a look", ran, [["ota", "look"]])
st["ota"]["seen"] = {"build": "b0000002/319cddad", "path": "x.ota", "safeboot": "houseweave-safeboot.bin"}
r = ask(["ota"], nil, nil)
check("another build: the upgrade to it, asked first, in the colour of what changes much", [labels(r)[3], r[2][3][3], r[2][3][4][2], labels(ask(["wireless"], nil, nil))[2]],
      [["Upgrade", "to b0000002", 5], 2, "Upgrade", ["OTA", "Upgrade", 1]])
ran = []
check("not until it is asked", ask(["ota"], 3, nil), nil)
ask(["ota"], 3, {"y": 1})
check("asked: the upgrade", ran, [["ota", "upgrade"]])
st["ota"]["seen"] = {}
check("no release for this image", labels(ask(["ota"], nil, nil))[3], ["Release", "None for it", 2])
st["ota"]["result"] = "No answer"
r = ask(["ota"], nil, nil)
check("a look that did not go says why, in the colour of what is wrong", [labels(r)[3], r[2][3][3]], [["Release", "No answer", 2], 2])
st["ota"]["busy"] = "upgrading"
check("upgrading", [labels(ask(["ota"], nil, nil))[3], labels(ask(["wireless"], nil, nil))[2]], [["Upgrading", "Restarting", 0], ["OTA", "Upgrading", 1]])

# --- the safeboot image through a neighbour ----------------------------------------------------------------------------------------------------
# the firmware's writer (xdrv_98_7), as the test answers it, and the way to the server through a neighbour (mesh_http.be)
import global
var sb_calls = []
var sb_begin = "Begun"
var sb_finish = "Written"
var sb_unfinished = false
var sb_written = 0             # the bytes given since the write began: the first ones erase the partition, as the firmware's writer does
var sb_spoilt = false          # the first piece is not an image's: refused before anything is erased
global.espnow_ota_safeboot_begin = def (r, s) sb_calls.push(["begin", r.tohex(), size(s)]) sb_written = 0 return sb_begin end
global.espnow_ota_safeboot_write = def (at, b)
    sb_calls.push(["write", at, size(b)])
    if at == 0 && sb_spoilt return false end
    if at == 0  sb_unfinished = true end
    sb_written = at + size(b)
    return true
end
global.espnow_ota_safeboot_finish = def ()
    sb_calls.push(["finish"])
    var a = sb_written == 10000 ? sb_finish : "the image is not whole"
    if sb_written > 0  sb_unfinished = a != "Written" end
    sb_written = 0
    return a
end
global.espnow_ota_safeboot_unfinished = def () return sb_unfinished end
class FakeMesh
    var asked, full, way
    def init() self.asked = [] self.full = false self.way = true end
    def can() return self.way end
    def busy() return self.full end
    def request(method, host, port, path, body, done, headers, raw)
        if self.full || !self.way return false end
        self.asked.push([method, path, headers, raw == true, done])
        return true
    end
    def what() var a = self.asked[-1] return [a[0], a[1], a[2], a[3]] end
    def reply(code, body) self.asked[-1][4](code, body) end
end
def zeros(n) var b = bytes() b.resize(n) return b end
def rep(s, n) var o = "" for i: 1 .. n  o += s end return o end
server = {"host": "192.168.2.108", "port": 8099}
tasmota.timers = []
tasmota.at_ms = nil
tasmota.wifi_up = false
var near = FakeHouse()
near.wifi = [5]
var lone = NodeOta(FakeHttp(), / -> server, nil, / -> near)
lone.mesh = FakeMesh()
lone.every_second()
# a safeboot image of 10 000 bytes: three pieces, the last one shorter
var record = "10270000" + "000000" + rep("AB", 32)
var sig = '{"file": "houseweave-safeboot.bin", "record": "' + record + '", "signature": "' + rep("CD", 64) + '"}'
var idx = '{"v": 1, "images": {}, "safeboot": {"path": "houseweave-safeboot.bin", "build": "77e6933/ea07370f", "size": 10000}}'

check("the server's Upgrade, with no Wi-Fi: a look first", lone.upgrade_asked(), "Looking")
lone.http.reply(0, "No network")
check("the look does not reach the server: the server's safeboot image first, its index asked through a neighbour",
      [lone.mesh.what(), lone.result, size(near.sent)], [["GET", "/ota/index.json", {}, false], "Safeboot: looking", 0])
check("the Upgrade asked again meanwhile: said", lone.upgrade_asked(), "Writing the safeboot image")
lone.mesh.reply(200, idx)
check("the index's safeboot image: its signed record asked", lone.mesh.what(), ["GET", "/ota/houseweave-safeboot.bin.sig.json", {}, false])
lone.mesh.reply(200, sig)
check("the record to the firmware's writer, which begins: the first piece asked, as bytes",
      [sb_calls, lone.mesh.what()], [[["begin", record, 64]], ["GET", "/ota/houseweave-safeboot.bin", {"Range": "bytes=0-4095"}, true]])
lone.mesh.reply(206, zeros(4096))
check("a piece written where it goes, and the next one asked after a moment", [sb_calls[-1], lone.result, size(tasmota.timers)],
      [["write", 0, 4096], "Safeboot 40%", 1])
run_timers()
check("the next piece", lone.mesh.what()[2], {"Range": "bytes=4096-8191"})
lone.mesh.reply(0, "No answer")
check("a piece not had: nothing written, and asked again after a while", [size(sb_calls), size(tasmota.timers)], [2, 1])
run_timers()
check("the same piece asked again", lone.mesh.what()[2], {"Range": "bytes=4096-8191"})
lone.mesh.reply(206, zeros(100))
check("a piece of another size is not the piece", [size(sb_calls), lone.sb["tries"]], [2, 2])
run_timers()
lone.mesh.reply(206, zeros(4096))
run_timers()
check("the last piece, shorter", lone.mesh.what()[2], {"Range": "bytes=8192-9999"})
lone.mesh.reply(206, zeros(1808))
check("the image whole: finished, and then the release asked of a neighbour",
      [sb_calls[-2], sb_calls[-1], lone.sb, size(near.sent), near.sent[0][0], near.sent[0][1][0], lone.result],
      [["write", 8192, 1808], ["finish"], nil, 1, 5, 0x35, "Asking node 5"])

# a partition that holds the server's image already: kept, and the release asked at once
sb_calls = []
near.sent = []
sb_begin = "Kept"
lone.upgrade_asked()
lone.http.reply(0, "No network")
lone.mesh.reply(200, idx)
lone.mesh.reply(200, sig)
check("kept: nothing written, and the release asked", [sb_calls, size(near.sent), lone.result], [[["begin", record, 64]], 1, "Asking node 5"])

# no safeboot image on the server: nothing begun, the partition as it was, and the release asked all the same
sb_calls = []
near.sent = []
lone.upgrade_asked()
lone.http.reply(0, "No network")
lone.mesh.reply(404, "")
check("no safeboot image on the server: nothing begun, and the release asked all the same", [sb_calls, size(near.sent), lone.sb_due], [[], 1, nil])

# a write that erased the partition and did not end: no release asked, since the partition holds no safeboot image; tried again later
sb_calls = []
near.sent = []
sb_begin = "Begun"
sb_finish = "the image written is not the one signed"
lone.upgrade_asked()
lone.http.reply(0, "No network")
lone.mesh.reply(200, idx)
lone.mesh.reply(200, sig)
for i: 1 .. 2
    lone.mesh.reply(206, zeros(4096))
    run_timers()
end
lone.mesh.reply(206, zeros(1808))
check("an image that does not check: no release asked, and the write tried again later",
      [sb_calls[-1], size(near.sent), lone.result, lone.sb_due != nil], [["finish"], 0, "Safeboot: the image written is not the one signed", true])
sb_calls = []
sb_finish = "Written"
tasmota.at_ms = tasmota.millis() + NodeOta.SB_AGAIN_MS + 1
lone.every_second()
check("SB_AGAIN_MS later, with no Wi-Fi: the write again, from the index", [lone.mesh.what(), lone.result], [["GET", "/ota/index.json", {}, false], "Safeboot: looking"])
lone.mesh.reply(200, idx)
lone.mesh.reply(200, sig)
for i: 1 .. 2
    lone.mesh.reply(206, zeros(4096))
    run_timers()
end
lone.mesh.reply(206, zeros(1808))
check("written: no longer unfinished, and nothing follows a write tried again by itself", [sb_calls[-1], lone.sb_due, size(near.sent), lone.result],
      [["finish"], nil, 0, ""])

# the way busy, with another of this node's requests or at a neighbour busy or short of memory: waited for, with no try spent
sb_calls = []
near.sent = []
lone.upgrade_asked()
lone.http.reply(0, "No network")
lone.mesh.reply(200, idx)
lone.mesh.reply(200, sig)
lone.mesh.reply(206, zeros(4096))
lone.mesh.full = true
run_timers()
check("the way busy with another request of this node's: waited for, no try spent",
      [lone.sb["tries"], size(tasmota.timers), lone.mesh.what()[2]], [0, 1, {"Range": "bytes=0-4095"}])
lone.mesh.full = false
run_timers()
check("free again: the next piece", lone.mesh.what()[2], {"Range": "bytes=4096-8191"})
lone.mesh.reply(503, bytes().fromstring("Low memory"))
check("a neighbour short of memory: waited for too, no try spent", [lone.sb["tries"], size(tasmota.timers)], [0, 1])
run_timers()
check("and the same piece asked again", lone.mesh.what()[2], {"Range": "bytes=4096-8191"})
tasmota.at_ms = tasmota.millis() + NodeOta.SB_BUSY_MS + 1
lone.mesh.reply(503, bytes().fromstring("Busy"))
check("busy past SB_BUSY_MS with nothing had: the write ends, the partition with no image, and is tried again later, the release not asked",
      [lone.sb, lone.result, lone.sb_again, sb_unfinished, size(near.sent)], [nil, "Safeboot: Busy", NodeOta.SB_AGAIN_MS, true, 0])

# the next try with no neighbour on the Wi-Fi: the one after it twice as late
lone.mesh.way = false
tasmota.at_ms = tasmota.millis() + NodeOta.SB_AGAIN_MS + 1
lone.every_second()
check("no neighbour at the try: the next one twice as late", [lone.sb, lone.sb_again], [nil, 2 * NodeOta.SB_AGAIN_MS])
lone.mesh.way = true

# the Wi-Fi back: the server's safeboot image over it, at the address the index gives
tasmota.wifi_up = true
tasmota.answer = def (c) sb_unfinished = false return {"EspNowOtaSafeboot": {"Written": 10000, "Sha256": "ABABABABABABABAB"}} end
tasmota.at_ms = tasmota.millis() + 2 * NodeOta.SB_AGAIN_MS + 1
lone.every_second()
check("with the Wi-Fi back: the index over it", [lone.http.asked, lone.busy], [["GET", "192.168.2.108", 8099, "/ota/index.json"], "looking"])
lone.http.reply(200, idx)
check("and the safeboot image written over HTTP, at the index's address; no try left", [tasmota.said, lone.busy, lone.sb_due, lone.sb_again],
      ["EspNowOtaSafeboot http://192.168.2.108:8099/ota/houseweave-safeboot.bin", "", nil, nil])
tasmota.wifi_up = false

# a neighbour that spoils binary files: the first piece is not an image's, and is refused before anything is erased. The image the partition holds is
# kept, and the release asked all the same
sb_calls = []
near.sent = []
sb_spoilt = true
lone.upgrade_asked()
lone.http.reply(0, "No network")
lone.mesh.reply(200, idx)
lone.mesh.reply(200, sig)
for i: 1 .. NodeOta.SB_TRIES
    lone.mesh.reply(206, zeros(4096))
    run_timers()
end
check("the first piece spoilt each time: nothing erased, and the release asked all the same",
      [sb_unfinished, lone.sb, size(near.sent), lone.sb_due, lone.result], [false, nil, 1, nil, "Asking node 5"])
sb_spoilt = false
tasmota.at_ms = nil

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
end
