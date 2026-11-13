# berry/node_host.be, what a node with no screen is to the house, over a node that is no bridge: an appliance's stand-in, with the fields, the constants
# and the methods NodeHost asks of a node. What a bridge does with the same functions is in test_zbbridge_relay.be, whose relay hands over to them.

import json
import string
# the VM's own globals, which NodeHost reads the image's classes from: a class put there stays for the rest of the test, so the checks come in the
# order of what the image has
import global as natives

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if str(got) != str(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# what the log said, kept: a node's lines begin with its own tag
var logged = []
log = def (msg, level) logged.push([msg, level]) end

# the node: no Zigbee, one row of its own in its Main settings
class Appliance
    static TAG = "APPLIANCE"
    static ID = "appliance"
    static ROLE = "device"
    static MAIN_ROWS = 1
    static LED = 1
    var house, meshcmd, wifi, ota, link, backup, heard_from, budget
    var pairing, window_until, by_button, identify_until, blink_pin, blink_rest, hold, clock_src, clock_at, clock_expect
    var ran, listened, wiped, mqtt_seen, asked, closed, said_all
    def init()
        self.heard_from = {}
        self.budget = 233
        self.by_button = false
        self.blink_pin = -1
        self.ran = []
        self.listened = []
        self.wiped = 0
        self.mqtt_seen = []
        self.asked = []
        self.closed = 0
        self.said_all = 0
    end
    def announce() return "0,2" end
    def window_closed() self.closed += 1 end
    def guest_said(m) end
    def say_all() self.said_all += 1 end
    def run(line, via, from)
        if NodeHost.run(self, line, via, from) return end
        self.ran.push(line)
    end
    def listen(payload, from) self.listened.push([payload, from]) end
    def wipe() self.wiped += 1 end
    def settings_rows() return [["Water", "58.0", 0, 0]] end
    def apply_mqtt(m)
        self.mqtt_seen.push(m["host"])
        NodeHost.apply_mqtt(self, m)
    end
    def render_for(view, k, x)
        self.asked.push(view)
        return NodeHost.render_for(self, view, k, x)
    end
end

# a house of the panels 4, 5 and 6 (and 20 to 39) and the bridge 9, this node its number 2
class HostList
    var me
    def init() self.me = 2 end
    def is_panel(n) return n == 4 || n == 5 || n == 6 || (n >= 20 && n < 40) end
    def is_owner(n) return n == 2 || n == 9 || n == 12 end
    def revoked(n) return n == 12 && self.struck == true end
    var struck
    def ids(all) return [2, 4, 5, 6, 9] end
end
class HostState
    var marks
    def init() self.marks = {} end
end
class HostChannel
    def mine() return 6 end
end
class HostHouse
    var up, list, state, room, sent, refuse, channel, leaving, left, went, go_takes
    def init()
        self.up = true
        self.list = HostList()
        self.state = HostState()
        self.room = 233
        self.sent = []
        self.refuse = false
        self.channel = HostChannel()
        self.leaving = false
        self.left = 0
        self.went = 0
        self.go_takes = true
    end
    def node_room(n) return self.room end
    def event_node(n, text)
        if self.refuse return false end
        self.sent.push([n, text])
        return true
    end
    def channel_setting() return {"channel": 6} end
    def go(then)
        self.went += 1
        return self.go_takes
    end
    def leave() self.left += 1 end
end

# stand-ins of the classes an image carries, which NodeHost.start builds the house on the node with
class HostCmd
    var host, sent
    def init(host) self.host = host self.sent = [] end
    def send(dest, line, answer)
        self.sent.push([dest, line])
        return 1
    end
end
class HostMesh
    var role, mqtt, view_fn, forgets, events
    def init(role) self.role = role self.forgets = [] end
    def server() return "192.168.2.10" end
    static def build_rows() return [["Build", "dev", 0, 0]] end
end
class HostCommands
    var house
    def init(house) self.house = house end
end
class HostMqtt
    var house, apply
    def init(house, apply) self.house = house self.apply = apply end
end
class HostWifi
    var station, off, said, ran
    def init(x) self.station = true self.off = 0 self.said = [] self.ran = [] end
    def kept() return {"off": true} end
    def radio_off() self.off += 1 end
    def scanned(v) self.said.push(["scan", v]) end
    def joined(v) self.said.push(["join", v]) end
    def hotspot_said(v) self.said.push(["spot", v]) end
    def state() return "home" end
    def run(verb, rest) self.ran.push([verb, rest]) end
end
class HostHttp
end
class HostOta
    var server_fn, house_fn, mesh, ran
    def init(http, server_fn, x, house_fn) self.server_fn = server_fn self.house_fn = house_fn self.ran = [] end
    def upgrade_asked() return true end
    def state() return "newer" end
    def run(verb, rest) self.ran.push([verb, rest]) end
end
class HostLink
    var house_fn, state_fn, mesh, handlers, said
    def init(house_fn, http, state_fn, x) self.house_fn = house_fn self.state_fn = state_fn self.handlers = {} self.said = [] end
    def on(word, f) self.handlers[word] = f end
    def hello(why) self.said.push(why) end
    def server() return "192.168.2.10:8099" end
end
class HostMeshHttp
    var house_fn, server_fn
    def init(house_fn, http, server_fn) self.house_fn = house_fn self.server_fn = server_fn end
end
class HostBackup
    var part, link, ran
    def init(part, http, link) self.part = part self.link = link self.ran = [] end
    def state() return "kept" end
    def brief() return 7 end
    def run(verb, rest) self.ran.push([verb, rest]) end
end
class AppliancePart
end
class HostBuild
    static IMAGE = "tasmota32-houseweave-thr320d"
    static COMMIT = "abc1234/def56789"
    static DATE = "2026-11-12T10:00"
end

def word_checks()
    check("a line's word is what comes before its first space, in capitals", NodeHost.word("ZbSend {\"Device\":\"0x1\"}"), "ZBSEND")
    check("and the whole of a line with none", NodeHost.word("zbrelaylisten"), "ZBRELAYLISTEN")
end
word_checks()

# the lines a panel sends: who is noted as hearing the node, the words every node takes, and what is left to the node
def run_checks()
    var a = Appliance()
    var h = HostHouse()
    a.house = h
    tasmota.at_ms = 5000
    a.run("ZbRelayDrive {\"id\":\"0x1\",\"do\":\"read\"}", "mesh", 4)
    check("a line that is the node's own is the node's to run", a.ran, ["ZbRelayDrive {\"id\":\"0x1\",\"do\":\"read\"}"])
    check("and the panel that sent it is one that hears the node", a.heard_from, {4: 5000})
    a.run("ZbPing 0x1", "mesh", 9)
    check("a node of the house that is no panel is not", a.heard_from.contains(9), false)
    a.run("ZbRelayListen 1", "mesh", 5)
    check("ZbRelayListen is every node's: the node's listen, with what follows the word", [a.listened, size(a.ran)], [[["1", 5]], 2])
    a.run("ZbRelayListen", "mesh", 5)
    check("nothing after the word is an empty payload", a.listened[1], ["", 5])
    h.up = false
    a.heard_from = {}
    a.run("ZbPing 0x1", "mesh", 4)
    check("in a house that is not up nobody is noted", a.heard_from, {})
    a.house = nil
    check("with no house the node's own lines are still its own", [NodeHost.run(a, "ZbPing 0x1", "mesh", 4), a.heard_from], [false, {}])
    tasmota.at_ms = nil
end
run_checks()

# the panels the node's events go to
def listener_checks()
    var a = Appliance()
    var h = HostHouse()
    check("a node in no house is heard by nobody", [NodeHost.listeners(a), NodeHost.frame_budget(a)], [[], 233])
    a.house = h
    tasmota.at_ms = 1000
    a.heard_from[5] = 1000
    a.heard_from[9] = 1000
    h.state.marks[6] = 1
    h.state.marks[5] = 1
    var l = NodeHost.listeners(a)
    check("the panels that commanded it and those that show its devices, each once, and no node that is not a panel",
          [size(l), l.find(5) != nil, l.find(6) != nil, l.find(9) != nil], [2, true, true, false])
    NodeHost.send_event(a, {"ZbDriver": {"0x1": {"s": {"cur": 580}}}})
    var to = {}
    for x: h.sent  to[x[0]] = json.load(x[1]) end
    check("an event goes to each of them, as JSON", [size(h.sent), to[5]["ZbDriver"]["0x1"]["s"]["cur"], to.contains(6)], [2, 580, true])
    h.room = 120
    check("what a frame carries: the least of their rooms", NodeHost.frame_budget(a), 120)
    h.room = 400
    check("and never more than the node's own budget", NodeHost.frame_budget(a), 233)
    h.room = 0
    check("a room nobody knows changes nothing", NodeHost.frame_budget(a), 233)
    logged.clear()
    h.sent.clear()
    h.refuse = true
    NodeHost.send_text(a, "{}")
    check("an event the mesh did not take is said in the log, under the node's tag, at the level of what is not shown",
          [size(logged), string.find(logged[0][0], "APPLIANCE: an event of 2 bytes did not go to the panel ") == 0, logged[0][1]], [2, true, 3])
    h.refuse = false
    tasmota.at_ms = 1000 + NodeHost.LISTEN_MS
    l = NodeHost.listeners(a)
    check("a panel that said nothing for LISTEN_MS hears no more, unless it shows the node's devices",
          [size(l), l.find(5) != nil, l.find(6) != nil, a.heard_from.contains(5), a.heard_from.contains(9)], [2, true, true, false, false])
    h.state.marks = {}
    check("and with no device of the node on show either, nobody hears it", NodeHost.listeners(a), [])
    tasmota.at_ms = 2000
    for n: 20 .. 31  a.heard_from[n] = 2000 end
    check("at most LISTENERS_MAX of them", size(NodeHost.listeners(a)), NodeHost.LISTENERS_MAX)
    h.up = false
    check("and none while the house is not up", NodeHost.listeners(a), [])
    NodeHost.forget(a, {20: true, 31: true})
    check("the panels the house forgot are forgotten here", [size(a.heard_from), a.heard_from.contains(20), a.heard_from.contains(21)], [2, true, false])
    tasmota.at_ms = nil
end
listener_checks()

# the factory reset and the web password, a panel's words
def admin_checks()
    var a = Appliance()
    var h = HostHouse()
    a.house = h
    logged.clear()
    tasmota.cmds.clear()
    check("refused from the console", NodeHost.admin(a, "{\"do\":\"unlock\",\"n\":\"7\"}", "console", 4), false)
    check("from a node that is no panel", NodeHost.admin(a, "{\"do\":\"unlock\",\"n\":\"7\"}", "mesh", 9), false)
    h.up = false
    check("and in a house that is not up", NodeHost.admin(a, "{\"do\":\"unlock\",\"n\":\"7\"}", "mesh", 4), false)
    h.up = true
    check("each said in the log under the node's tag, and nothing run",
          [size(logged), logged[0][0], tasmota.cmds, h.sent], [3, "APPLIANCE: an admin word refused: not from a panel of the house over the mesh", [], []])
    check("a password a command line would cut is refused", NodeHost.admin(a, "{\"do\":\"lock\",\"pw\":\"abc;defgh\",\"n\":\"7\"}", "mesh", 4), false)
    check("as is what is no word of the admin's", NodeHost.admin(a, "{\"do\":\"dance\",\"n\":\"7\"}", "mesh", 4), false)
    check("and what is no JSON", [NodeHost.admin(a, "lock", "mesh", 4), tasmota.cmds, h.sent], [false, [], []])
    check("a fair password is set", NodeHost.admin(a, "{\"do\":\"lock\",\"pw\":\"s3cret-pass\",\"n\":\"7\"}", "mesh", 4), true)
    var told = json.load(h.sent[-1][1])["ZbRelayAdmin"]
    check("by WebPassword2, and the panel told, by its word", [tasmota.cmds[-1], h.sent[-1][0], told["did"], told["n"]], ["WebPassword2 s3cret-pass", 4, "lock", "7"])
    check("and removed", [NodeHost.admin(a, "{\"do\":\"unlock\",\"n\":\"8\"}", "mesh", 4), tasmota.cmds[-1], json.load(h.sent[-1][1])["ZbRelayAdmin"]["did"]],
          [true, "WebPassword2 \"", "unlock"])
    a.run("ZbRelayAdmin {\"do\":\"factory\",\"n\":\"9\"}", "mesh", 4)
    told = json.load(h.sent[-1][1])["ZbRelayAdmin"]
    check("a factory reset, as a line of the mesh: the panel told first, the node's own wipe a moment later, under the node's timer",
          [told["did"], told["n"], a.wiped, tasmota.timers.delay_of("appliance_wipe"), size(a.ran)], ["factory", "9", 0, NodeHost.FORGET_WORD_MS, 0])
    tasmota.timers.fire("appliance_wipe")
    check("which is the node's", a.wiped, 1)
    check("a fair password: 8 to 32 printable characters, with no space, quote, semicolon or backslash",
          [NodeHost.fair_password("12345678"), NodeHost.fair_password("1234567"), NodeHost.fair_password("12345678901234567890123456789012"),
           NodeHost.fair_password("123456789012345678901234567890123"), NodeHost.fair_password("1234 5678"), NodeHost.fair_password("1234\"5678"),
           NodeHost.fair_password("1234\\5678")], [true, false, true, false, false, false, false])
end
admin_checks()

# the house on the node, at its boot, over the stand-ins: first with none of the house's classes in the image, then with each
def start_checks()
    var a = Appliance()
    NodeHost.start(a, 4, AppliancePart)
    check("an image with none of the house's classes starts nothing", [a.meshcmd, a.house, a.wifi, a.ota, a.link, a.backup], [nil, nil, nil, nil, nil, nil])
    natives.MeshCmd = HostCmd
    NodeHost.start(a, 4, AppliancePart)
    check("the commands of the mesh, whose host is the node, even with no house layer", [a.meshcmd.host == a, a.house], [true, nil])
    natives.HouseMesh = HostMesh
    a = Appliance()
    NodeHost.start(a, 4, AppliancePart)
    check("the house's layer alone: under the node's role, its screens the node's to give, and nothing of what the image has not",
          [a.house.role, a.house.view_fn != nil, size(a.house.forgets), a.house.mqtt, a.wifi, a.ota, a.link, a.backup], [4, true, 1, nil, nil, nil, nil, nil])
    natives.HouseCommands = HostCommands
    natives.HouseMqtt = HostMqtt
    natives.PanelWifi = HostWifi
    natives.PanelHttp = HostHttp
    natives.NodeOta = HostOta
    a = Appliance()
    NodeHost.start(a, 4, nil)
    check("a node that keeps no backup has its OTA, and no word with the server", [classname(a.ota), a.link, a.backup, a.ota.mesh], ["HostOta", nil, nil, nil])
    natives.ServerLink = HostLink
    natives.MeshHttp = HostMeshHttp
    natives.NodeBackup = HostBackup
    a = Appliance()
    tasmota.rule_lists = {}
    tasmota.rules = {}
    NodeHost.start(a, 4, AppliancePart)
    var h = a.house
    h.mqtt.apply({"host": "192.168.2.10", "port": 1883, "user": "u", "keep": true})
    check("the house's MQTT is applied by the node, which has its own part of it", [h.mqtt.house == h, a.mqtt_seen], [true, ["192.168.2.10"]])
    check("its Wi-Fi, with a Disconnect kept across the restart", [classname(a.wifi), a.wifi.off], ["HostWifi", 1])
    check("the station driver's reports under the node's rule", [tasmota.rule_lists["StaScan"][0][0], tasmota.rule_lists["StaJoin"][0][0], tasmota.rule_lists["StaHotspot"][0][0]],
          ["appliance_wifi", "appliance_wifi", "appliance_wifi"])
    tasmota.rules["StaScan"]({"n": 1}, nil, nil)
    tasmota.rules["StaJoin"]({"State": "Connected"}, nil, nil)
    tasmota.rules["StaHotspot"]({"Phones": 1}, nil, nil)
    tasmota.rules["StaScan"]("Started", nil, nil)
    check("each to its Wi-Fi, and a command's own answer, a word, to nothing",
          a.wifi.said, [["scan", {"n": 1}], ["join", {"State": "Connected"}], ["spot", {"Phones": 1}]])
    check("its OTA, from the house's server", [a.ota.server_fn(), a.ota.house_fn() == h], ["192.168.2.10", true])
    check("the house's server, told what the node is", [a.link.house_fn() == h, a.link.state_fn()["role"], a.link.said], [true, "device", ["boot"]])
    check("with the way through the mesh, for its requests and for its safeboot image", [a.link.mesh.server_fn(), a.ota.mesh == a.link.mesh], ["192.168.2.10:8099", true])
    check("its backup, of the part that is the node's", [classname(a.backup.part), a.backup.link == a.link], ["AppliancePart", true])
    check("the server's words it answers", [a.link.handlers["upgrade"](), a.link.handlers["state"]()], [{"upgrade": true}, {}])
    a.asked.clear()
    h.view_fn(["settings"], nil, nil)
    check("its screens are the node's to give", a.asked, [["settings"]])
    a.heard_from = {4: 1, 5: 1}
    for f: h.forgets  f({4: true}, {5: true}) end
    check("and of the nodes the house forgets, the panels that commanded it", [size(h.forgets), a.heard_from], [1, {4: 1}])
end
start_checks()

# the node's screens on a panel
def view_checks()
    var a = Appliance()
    a.house = HostHouse()
    var m = NodeHost.render_for(a, ["settings"], nil, nil)
    check("its Main settings: the rows that are its own, then its Info and the restart",
          [m[0], m[1], m[2], m[3], m[4]], [["settings"], "Main settings", [["Water", "58.0", 0, 0], ["Info", "", 1, 0, ["info"]], ["Restart", "", 2, 2]], false, []])
    tasmota.cmds.clear()
    logged.clear()
    var t = NodeHost.render_for(a, ["settings"], 2, nil)
    check("the restart is the row after its own and Info: said on the screen, and Restart 1 a moment after the answer, under the node's timer and tag",
          [t[2][2][1], tasmota.timers.delay_of("appliance_restart"), tasmota.cmds.find("Restart 1"), logged[0][0]],
          ["Restarting", NodeHost.RESTART_MS, nil, "APPLIANCE: a restart asked by a panel of the house"])
    tasmota.timers.fire("appliance_restart")
    check("by Restart 1", tasmota.cmds[-1], "Restart 1")
    check("a touch on any other row is nothing", [NodeHost.render_for(a, ["settings"], 0, nil), NodeHost.render_for(a, ["settings"], 3, nil)], [nil, nil])
    check("its Info is the house layer's rows", NodeHost.render_for(a, ["info"], nil, nil), [["info"], "Info", [["Build", "dev", 0, 0]], false, []])
    check("which takes no touch", NodeHost.render_for(a, ["info"], 0, nil), nil)
    check("a screen it has not is nil, and so is what is no screen", [NodeHost.render_for(a, ["dance"], nil, nil), NodeHost.render_for(a, nil, nil, nil),
          NodeHost.render_for(a, [], nil, nil)], [nil, nil, nil])
end
view_checks()

# what it says of its network and of itself
def state_checks()
    import mqtt
    var a = Appliance()
    a.wifi = HostWifi(nil)
    mqtt.up = false
    var s = NodeHost.node_state(a)
    check("with no house: its Wi-Fi, alone, the MQTT's word",
          [s["wifi"], s["radio"], s["house_ch"], s["alone"], s["mqtt"], s["ota"], s["backup"], size(s)], ["home", nil, 0, true, "Not connected", nil, nil, 7])
    a.house = HostHouse()
    a.ota = HostOta(nil, nil, nil, nil)
    a.backup = HostBackup(nil, nil, nil)
    mqtt.up = true
    s = NodeHost.node_state(a)
    check("in a house of more than itself: its radio's channel and the house's, its OTA and its backup",
          [s["wifi"], s["radio"], s["house_ch"], s["alone"], s["mqtt"], s["ota"], s["backup"]], ["home", 6, 6, false, "Connected", "newer", "kept"])
    mqtt.up = false
    s = NodeHost.server_state(a)
    check("to the house's server, with no build's stamp: what it is, under the node's role",
          [s["role"], s["image"], s["build"], s["date"], s["backup"], size(s)], ["device", "", "dev", "", 7, 5])
    natives.PanelBuild = HostBuild
    a.backup = nil
    s = NodeHost.server_state(a)
    check("and what it runs", [s["role"], s["image"], s["build"], s["date"], s["backup"]],
          ["device", "tasmota32-houseweave-thr320d", "abc1234/def56789", "2026-11-12T10:00", nil])
    a.backup = HostBackup(nil, nil, nil)
    NodeHost.run_wifi(a, [["wifi", "search", 1], ["ota", "check"], ["backup", "now", 2, 3], ["other", "x"]])
    check("a touch on its Wireless settings goes to its Wi-Fi, its OTA or its backup, with what it carries",
          [a.wifi.ran, a.ota.ran, a.backup.ran], [[["search", [1]]], [["check", []]], [["now", [2, 3]]]])
    a.ota = nil
    NodeHost.run_wifi(a, [["ota", "check"]])
    check("and to nothing where the node has none", a.wifi.ran, [["search", [1]]])
end
state_checks()

# the house's MQTT
def mqtt_checks()
    var a = Appliance()
    logged.clear()
    tasmota.cmds.clear()
    tasmota.replies["MqttHost"] = {"MqttHost": "192.168.2.9"}
    NodeHost.apply_mqtt(a, {"host": "192.168.2.10", "port": 1883, "user": "", "password": "p;w", "discovery": true, "expire": 25})
    check("each setting alone, an empty one as Tasmota's quote, and the password whole",
          tasmota.cmds, ["MqttHost", "MqttHost 192.168.2.10", "MqttPort 1883", "MqttUser \"", "MqttPassword2 p;w"])
    check("said under the node's tag", logged[-1], ["APPLIANCE: the house's MQTT, on 192.168.2.10: Tasmota restarts", 2])
    tasmota.cmds.clear()
    tasmota.replies["MqttHost"] = {"MqttHost": "192.168.2.10"}
    NodeHost.apply_mqtt(a, {"host": "192.168.2.10", "port": 1883, "user": "u", "keep": true})
    check("a house that keeps no password leaves the node's own, on the same broker", tasmota.cmds, ["MqttHost", "MqttHost 192.168.2.10", "MqttPort 1883", "MqttUser u"])
    tasmota.cmds.clear()
    tasmota.replies["MqttHost"] = {"MqttHost": "192.168.2.9"}
    NodeHost.apply_mqtt(a, {"host": "192.168.2.10", "port": 1883, "user": "u", "keep": true})
    check("and clears another broker's", tasmota.cmds[-1], "MqttPassword2 \"")
    tasmota.replies.remove("MqttHost")
end
mqtt_checks()

# out of the house
def leave_checks()
    var a = Appliance()
    var h = HostHouse()
    var after = [0]
    def then() after[0] += 1 end
    tasmota.cmds.clear()
    NodeHost.leave_house(a, then)
    check("with no house layer, the driver's leave alone, and then what follows", [tasmota.cmds, tasmota.muted[-1], after[0]], [["EspNowMeshLeave 1"], "EspNowMeshLeave 1", 1])
    a.house = h
    NodeHost.leave_house(a, then)
    check("in a house that is up, the house's own way out, which calls what follows itself", [h.went, h.left, after[0]], [1, 0, 1])
    h.go_takes = false
    NodeHost.leave_house(a, then)
    check("and what follows at once when the house does not take it", [h.went, h.left, after[0]], [2, 0, 2])
    h.up = false
    NodeHost.leave_house(a, nil)
    check("in a house that is not up, the house layer's leave, with nothing to follow", [h.went, h.left, h.leaving, after[0]], [2, 1, true, 2])
end
leave_checks()

# what a node says, cut to the frames of the mesh
def cut_checks()
    var wrap = / m -> {"E": {"0x1": {"s": m}}}
    var fields = {"cur": 580, "set": 600, "mode": "heat", "dem": 100, "up": true, "note": "No clock"}
    var chunks = NodeHost.pack(fields, wrap, 60, "TAG")
    var fits = true
    var all = {}
    for c: chunks
        if size(json.dump(wrap(c))) > 60  fits = false end
        for k: c.keys()  all[k] = c[k] end
    end
    check("fields in as few maps as fit a frame with their message around them: none cut, none lost",
          [size(chunks) > 1, fits, size(all), all["cur"], all["note"]], [true, true, 6, 580, "No clock"])
    check("what fits one frame is one map", size(NodeHost.pack(fields, wrap, 233, "TAG")), 1)
    logged.clear()
    chunks = NodeHost.pack({"a": 1, "big": "0123456789012345678901234567890123456789", "z": 2}, wrap, 50, "TAG")
    var kept = {}
    for c: chunks  for k: c.keys()  kept[k] = c[k] end end
    check("a field that alone fits no frame is dropped, said in the log under the tag, and the others go",
          [kept.contains("big"), kept.find("a"), kept.find("z"), size(logged), string.find(logged[0][0], "TAG: big is ") == 0, logged[0][1]], [false, 1, 2, 1, true, 2])
    # a list in numbered frames
    var lwrap = / f -> {"E": {"0x1": {"x": f}}}
    var entries = []
    for i: 0 .. 6  entries.push({"k": "key" + str(i), "l": "A label"}) end
    var frames = NodeHost.list_frames(entries, lwrap, 100, "TAG")
    var got = []
    var ok = true
    for f: frames
        var x = f["E"]["0x1"]["x"]
        if size(json.dump(f)) > 100 || x["at"] != size(got) || x["of"] != 7  ok = false end
        for e: x["l"]  got.push(e["k"]) end
    end
    check("a list in frames numbered by where each starts, each within the room, the entries all there in order",
          [size(frames) > 1, ok, got], [true, true, ["key0", "key1", "key2", "key3", "key4", "key5", "key6"]])
    check("an empty list is one frame that says so", NodeHost.list_frames([], lwrap, 100, "TAG"), [{"E": {"0x1": {"x": {"at": 0, "of": 0, "l": []}}}}])
    logged.clear()
    entries.push({"k": "huge", "l": "0123456789012345678901234567890123456789012345678901234567890123456789"})
    check("an entry that fits no frame stops the list: nothing goes, and the log says which, under the tag",
          [NodeHost.list_frames(entries, lwrap, 100, "TAG"), logged[0]], [nil, ["TAG: entry 7 of a list does not fit a frame of 100 bytes, the list is not sent", 2]])
end
cut_checks()

# the window of entering the house, over a node that is no bridge: what it announces, the LED that is its own, and what it does when the window closes
def window_checks()
    import gpio
    var a = Appliance()
    var h = HostHouse()
    a.house = h
    tasmota.cmds.clear()
    tasmota.timers.clear()
    logged.clear()
    gpio.levels[13] = 1
    NodeHost.open_window(a)
    check("a pairing the driver does not open leaves no window", [tasmota.cmds, NodeHost.window_open(a), logged[0][0]],
          [["EspNowPairOpen 120,0,2"], false, "APPLIANCE: the pairing did not open: nil"])
    tasmota.replies["EspNowPairOpen 120,0,2"] = {"EspNowPairOpen": "Open"}
    tasmota.replies["EspNowPairOpen 300,0,2"] = {"EspNowPairOpen": "Open"}
    tasmota.cmds.clear()
    logged.clear()
    NodeHost.open_window(a)
    check("the window opens for 2 minutes, with what the node says of itself after the seconds, as the button's",
          [tasmota.cmds, NodeHost.window_open(a), a.by_button, logged[-1][0]], [["EspNowPairOpen 120,0,2"], true, true, "APPLIANCE: the button opened the pairing for 120 s"])
    check("the node's own LED blinks, under the node's timers, with a net under the driver's word",
          [a.blink_pin, a.blink_rest, gpio.levels[13], tasmota.timers.delay_of("appliance_blink"), tasmota.timers.delay_of("appliance_window")],
          [13, 1, 0, NodeHost.BLINK_MS, NodeHost.WINDOW_MS + 70000])
    NodeHost.identify(a)
    tasmota.timers.fire("appliance_blink")
    check("asked to identify itself, it blinks faster", [tasmota.timers.delay_of("appliance_blink"), logged[-1][0]],
          [NodeHost.IDENTIFY_MS, "APPLIANCE: a panel asks this node to identify itself"])
    tasmota.cmds.clear()
    NodeHost.close_window(a)
    check("closed: the driver's window too, the LED as it was, the timers gone, and the node does what is its own to do",
          [tasmota.cmds, NodeHost.window_open(a), gpio.levels[13], tasmota.timers.contains("appliance_blink"), tasmota.timers.contains("appliance_window"), a.closed, a.blink_rest],
          [["EspNowPairStop"], false, 1, false, false, 1, nil])
    tasmota.cmds.clear()
    NodeHost.close_window(a, true)
    check("a window that is not open, or that the driver closed, is not closed at the driver again", [tasmota.cmds, a.closed], [[], 2])
    NodeHost.identify(a)
    check("and nothing is identified with no window", a.identify_until, nil)
    # the button
    gpio.levels[4] = 0
    tasmota.at_ms = 50000
    NodeHost.button_held(a)
    check("the button held 5 s opens the window, and is watched from there", [NodeHost.window_open(a), a.hold, tasmota.timers.delay_of("appliance_hold")],
          [true, [4, 0, 50000], NodeHost.HOLD_STEP_MS])
    tasmota.at_ms = 50000 + NodeHost.LEAVE_HOLD_MS - NodeHost.HOLD_AT_MS - 1
    tasmota.timers.fire("appliance_hold")
    check("still held, a moment short of 20 s: nothing yet", [h.went, a.hold != nil], [0, true])
    tasmota.at_ms += 1
    logged.clear()
    tasmota.timers.fire("appliance_hold")
    check("held 20 s: the window closes and the node leaves the house", [NodeHost.window_open(a), h.went, a.hold, logged[0]],
          [false, 1, nil, ["APPLIANCE: the button held 20 s: this node leaves the house", 1]])
    NodeHost.button_held(a)
    gpio.levels[4] = 1
    tasmota.timers.fire("appliance_hold")
    check("let go before that, the hold is over and nothing more is watched", [a.hold, tasmota.timers.contains("appliance_hold")], [nil, false])
    NodeHost.close_window(a)
    tasmota.at_ms = nil
    # a boot with no network saved
    tasmota.replies["SSId"] = {"SSId1": "Cottage-2G", "SSId2": ""}
    tasmota.cmds.clear()
    NodeHost.radio_at_boot(a)
    check("a node with a network saved boots as it is", [NodeHost.no_network(), tasmota.cmds, NodeHost.window_open(a)], [false, ["SSId", "SSId"], false])
    tasmota.replies["SSId"] = {"SSId1": "", "SSId2": ""}
    tasmota.replies["StaState"] = {"StaState": {"State": "Idle"}}
    tasmota.cmds.clear()
    NodeHost.radio_at_boot(a)
    check("with none: the radio held with no network and no access point, and the window open for 5 minutes, not the button's",
          [tasmota.cmds, NodeHost.window_open(a), a.by_button], [["SSId", "StaState", "Wifi 0", "StaHold 1", "EspNowPairOpen 300,0,2"], true, false])
    NodeHost.close_window(a)
    tasmota.replies.remove("StaState")
    tasmota.cmds.clear()
    logged.clear()
    NodeHost.radio_at_boot(a)
    check("with no station driver to hold the radio, nothing is touched, and the log says so",
          [tasmota.cmds, logged[0][0]], [["SSId", "StaState"], "APPLIANCE: no network saved, and no station driver to hold the radio: Tasmota opens its AP"])
    tasmota.replies.remove("SSId")
    tasmota.replies.remove("EspNowPairOpen 120,0,2")
    tasmota.replies.remove("EspNowPairOpen 300,0,2")
end
window_checks()

# the clock: a node with none asks the house, and one that is asked answers the one that asked
def clock_checks()
    def times() var t = [] for c: tasmota.cmds if c[0 .. 4] == "Time " t.push(c) end end return t end
    var a = Appliance()
    var h = HostHouse()
    a.house = h
    a.meshcmd = HostCmd(a)
    tasmota.utc_now = 0
    tasmota.replies.remove("RtcRetain")
    tasmota.rule_lists = {}
    tasmota.rules = {}
    tasmota.timers.clear()
    NodeHost.clock(a)
    check("at a boot with no clock: none to say, the console's word, the rule of its own clock, and the house asked in a while",
          [a.clock_src, a.clock_at, tasmota.handlers.contains("ZbRelayTime"), tasmota.rule_lists["Time#Set"][0][0], tasmota.timers.delay_of("appliance_time_ask")],
          [nil, 0, true, "appliance_time", NodeHost.TIME_ASK_FIRST_MS])
    tasmota.timers.fire("appliance_time_ask")
    check("it asks an owner of the house for the time, with its own word, which says it has none, and will ask again",
          [size(a.meshcmd.sent), a.meshcmd.sent[0][0], string.find(a.meshcmd.sent[0][1], "ZbRelayTime ") == 0, json.load(a.meshcmd.sent[0][1][12 ..])["utc"],
           tasmota.timers.count("appliance_time_ask"), tasmota.timers.delay_of("appliance_time_ask")], [1, 9, true, 0, 1, NodeHost.TIME_ASK_MS])
    # two owners: each in its turn
    class TwoOwners : HostList
        def ids(all) return [2, 4, 9, 12] end
    end
    h.list = TwoOwners()
    tasmota.timers.fire("appliance_time_ask")
    tasmota.timers.fire("appliance_time_ask")
    check("with more than one owner, each in its turn, and never itself or a panel", [a.meshcmd.sent[1][0], a.meshcmd.sent[2][0]], [12, 9])
    h.up = false
    tasmota.timers.fire("appliance_time_ask")
    check("in a house that is not up it asks nobody, and tries again later", [size(a.meshcmd.sent), tasmota.timers.count("appliance_time_ask")], [3, 1])
    h.up = true
    # the answer
    tasmota.cmds.clear()
    NodeHost.heard(a, 4, {"ZbTime": {"utc": 1791376200, "src": "you", "at": 1791376100}})
    h.list.struck = true
    NodeHost.heard(a, 12, {"ZbTime": {"utc": 1791376200, "src": "internet", "at": 1791376100}})
    h.list.struck = false
    NodeHost.heard(a, 9, {"ZbDriver": {}})
    check("a time said by a panel, by a node struck off, or what is no time, is not taken", [times(), a.clock_src], [[], nil])
    NodeHost.heard(a, 9, {"ZbTime": {"utc": 1791376200, "src": "internet", "at": 1791376100}})
    check("the word of the owner it asked is taken: the clock set, given back to the NTP, and the house's from then on",
          [times(), a.clock_src, a.clock_at, a.clock_expect], [["Time 1791376200", "Time 0"], "house", 1791376100, "house"])
    tasmota.rules["Time#Set"](nil, nil, nil)
    check("its Time#Set is the house's", [a.clock_src, a.clock_at, a.clock_expect], ["house", 1791376100, nil])
    var asked = size(a.meshcmd.sent)
    tasmota.timers.fire("appliance_time_ask")
    check("with a clock it asks no more", [size(a.meshcmd.sent), tasmota.timers.contains("appliance_time_ask")], [asked, false])
    tasmota.utc_now = 1791376300
    tasmota.rules["Time#Set"](nil, nil, nil)
    check("the next Time#Set is the internet's, the freshest", [a.clock_src, a.clock_at], ["internet", 1791376300])
    # this node asked: by a node with no screen, by a panel, at the console
    h.state.marks[5] = 1
    h.sent.clear()
    tasmota.cmds.clear()
    a.run("ZbRelayTime {\"utc\":0,\"src\":null,\"at\":0}", "mesh", 9)
    check("a node with no screen that asks is answered alone, with this node's word, and its own word, which says nothing, is not taken",
          [size(h.sent), h.sent[0][0], json.load(h.sent[0][1])["ZbTime"], times(), size(a.ran)], [1, 9, {"utc": 1791376300, "src": "internet", "at": 1791376300}, [], 0])
    h.sent.clear()
    a.run("ZbRelayTime {\"utc\":1791376400,\"src\":\"you\",\"at\":1791376390}", "mesh", 4)
    var said = {}
    for x: h.sent  said[x[0]] = json.load(x[1])["ZbTime"] end
    check("a panel's word, set later and further apart, is taken, and the panels that hear this node are told its own",
          [times(), a.clock_src, size(h.sent), said.contains(4), said[5]["src"], said[5]["at"]], [["Time 1791376400", "Time 0"], "panel", 2, true, "panel", 1791376390])
    tasmota.rules["Time#Set"](nil, nil, nil)
    h.sent.clear()
    tasmota.answers.clear()
    tasmota.handlers["ZbRelayTime"]("ZbRelayTime", 1, "not json")
    check("the console's word is answered to the panels too, and the command is done", [size(h.sent) > 0, tasmota.answers], [true, ["done"]])
    h.sent.clear()
    a.run("ZbRelayTime {\"utc\":1791376500,\"src\":\"internet\",\"at\":1791376495}", "mesh", 12)
    check("an owner's own time, set later, is taken as the house's", [a.clock_src, h.sent[0][0]], ["house", 12])
    # a boot whose time was kept across the restart
    tasmota.replies["RtcRetain"] = {"RtcRetain": {"Restored": 1, "Gap": 4}}
    NodeHost.time_boot(a)
    check("a time kept across a restart is said so, and not known fresh", [a.clock_src, a.clock_at], ["restart", 0])
    tasmota.replies.remove("RtcRetain")
    NodeHost.time_boot(a)
    check("and one set at this boot is the internet's", a.clock_src, "internet")
    tasmota.utc_now = nil
    tasmota.timers.clear()
end
clock_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
