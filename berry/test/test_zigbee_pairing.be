# berry/zigbee_pairing.be, "Add to this house": the search the driver runs for the windows of the nodes, the one picked asked to identify
# itself, the pairing as a guest's exchange, the welcome of the house over its link, a bridge's Wi-Fi and the room's Zigbee channel, and what did not
# pair. The driver's reports are the ones xdrv_98_espnow_direct.ino writes.

import persist
import json
import string

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

# the driver's native: what goes over the link of the exchange
var told = []
def espnow_send(msg, as_event) told.push(json.load(msg)) return true end

persist.store = {}
var bridge = ZigbeeBridge()
var p = ZigbeePairing(bridge)
# a word of the driver's: the pairing takes them all in one rule, EspNowPair, each a key of the map (zigbee_pairing.be, said)
def rule(trigger, value, payload)
    import string
    if string.find(trigger, "EspNowPair#") == 0
        var v = isinstance(payload, map) && payload.contains("EspNowPair") ? payload["EspNowPair"] : {trigger[11 ..]: value}
        return tasmota.rules["EspNowPair"](v, "EspNowPair", payload)
    end
    tasmota.rules[trigger](value, trigger, payload)
end
var changes = [0]
p.on_change = def () changes[0] += 1 end
def heard_entry(id, mac, rssi, version, name)
    return {"Id": id, "Mac": mac, "Rssi": rssi, "Channel": 6, "Version": version, "Name": name, "Zigbee": 15, "Network": 1, "Busy": 0, "Guest": 1, "Display": 0}
end

# the house layer's link, as a stand-in that notes what it was asked (berry/house_link.be has its own tests in test_house_mesh.be): the glue of the pairing to it
class FakeLink
    var flagv, is_bound, said, ended, events, gives, give_ok, step, role, unbinds
    def init(flag)
        self.flagv = flag
        self.is_bound = false
        self.events = []
        self.gives = []
        self.give_ok = true
        self.step = nil
        self.role = nil
        self.unbinds = 0
    end
    def flag() return self.flagv end
    def bind(say, ended) self.is_bound = true self.said = say self.ended = ended end
    def unbind() self.is_bound = false self.unbinds += 1 end
    def reset() self.role = nil self.step = nil end
    def bound() return self.is_bound end
    def busy() return self.role != nil end
    def event(kind, m) self.events.push(kind) end
    def give(kind, name, ip) self.gives.push([kind, name, ip]) if self.give_ok self.role = "give" self.step = "asking" end return self.give_ok end
end
class FakeIds
    var n
    def init() self.n = [1] end
    def ids(all) return self.n end
end
# the house's layer: its link, its list's numbers, and its channel (house_channel.be), which the pairing reads and writes
class FakeHouse
    var link
    var up
    var list
    var ch          # the house's channel, as its list has it, or nil
    var set         # what set_channel was last given, [channel, delay], or nil
    def init(l) self.link = l self.up = true self.list = FakeIds() end
    def channel_setting() return self.ch != nil ? {"channel": self.ch, "at": nil} : nil end
    def set_channel(c, d) self.set = [c, d] return true end
end
# the house's roles, as HouseList has them: the pairing reads them by the global name
class HouseList
    static ROLE_BRIDGE = 1
    static ROLE_PANEL = 2
end
global.HouseList = HouseList

# --- the search ----------------------------------------------------------------------------------
tasmota.replies["EspNowPairScan"] = {"EspNowPairScan": "Started"}
tasmota.replies["Status 11"] = {"StatusSTS": {"Wifi": {"AP": 1, "SSId": "Cottage", "Channel": 6}}}
p.discover()
check("a search is the driver's", tasmota.cmds[-1], "EspNowPairScan")
check("the channel of this panel's network kept first, as the radio will leave it", p.home_channel, 6)
check("and runs", p.state()["searching"], true)
rule("EspNowPair#Heard", heard_entry(1, "B0:B0:B0:00:00:01", -60, 2, "zbbridge-living"), nil)
rule("EspNowPair#Heard", heard_entry(1, "B0:B0:B0:00:00:01", -58, 2, "zbbridge-living"), nil)
var panel = heard_entry(2, "B0:B0:B0:00:00:02", -40, 2, "Den panel bedroom")
panel["Display"] = 1
panel["Zigbee"] = 0
rule("EspNowPair#Heard", panel, nil)
check("each node once, as it is heard, a panel's window said so", [size(p.found), p.found[1]["display"], p.found[0]["display"]], [2, true, false])
check("each one draws the view again", changes[0] >= 2, true)
rule("EspNowPair#Scan", "Sweeping", nil)
check("the sweep, with the Wi-Fi paused, said", p.state()["sweeping"], true)
# a node of the list tapped while the search still listens: the driver takes the request only once the search is over, and the tap waits for it
tasmota.replies["EspNowPairBlink 1"] = {"EspNowPairBlink": "Scanning"}
p.blink(1)
check("a node tapped while the search listens: the glass asks it, and the request waits, by its address",
      [p.asking, p.pending, p.chosen["name"]], ["blink", "B0:B0:B0:00:00:01", "zbbridge-living"])
tasmota.replies["EspNowPairBlink 1"] = {"EspNowPairBlink": "Started"}
tasmota.replies["EspNowPairHeard"] = {"EspNowPairHeard": [panel, heard_entry(1, "B0:B0:B0:00:00:01", -58, 2, "zbbridge-living")]}
rule("EspNowPair#Scan", "Done", nil)
check("the search over: the list as the driver sorts it, strongest first",
      [p.state()["searching"], p.state()["sweeping"], p.found[0]["id"], p.found[1]["id"], p.found[1]["rssi"]], [false, false, 2, 1, -58])
check("and the node tapped meanwhile asked to identify itself, once", [tasmota.cmds[-1], p.asking, p.pending], ["EspNowPairBlink 1", "blink", nil])
rule("EspNowPair#Heard", heard_entry(3, "B0:B0:B0:00:00:03", -30, 2, "late"), nil)
check("a node after it is not listed", size(p.found), 2)
tasmota.replies["EspNowPairScan"] = {"EspNowPairScan": "Busy", "Owner": "Join"}
p.discover()
check("a search while a join has the radio waits for it, and says who has it",
      [p.state()["searching"], p.state()["result"], p.state()["holder"]], [false, "radio", "Join"])
var old = heard_entry(3, "B0:B0:B0:00:00:03", -40, 1, "zbbridge-old")
p.found = [ZigbeePairing.entry(old), ZigbeePairing.entry(heard_entry(1, "B0:B0:B0:00:00:01", -58, 2, "zbbridge-living"))]

# --- the node picked, asked to identify itself -------------------------------------------------------------
tasmota.replies["EspNowPairBlink 3"] = {"EspNowPairBlink": "Version"}
p.blink(3)
check("one of another version is not asked, and the glass says it needs an update", [p.asking, p.result], [nil, "version"])
tasmota.replies["EspNowPairBlink 1"] = {"EspNowPairBlink": "Not scanning"}
p.blink(1)
check("the search gone meanwhile, as a session left alone ends: too late", [p.asking, p.chosen, p.result], [nil, nil, "timeout"])
tasmota.replies["EspNowPairBlink 1"] = {"EspNowPairBlink": "Started"}
p.blink(1)
check("the node picked is asked to identify itself", [tasmota.cmds[-1], p.asking, p.chosen["name"]], ["EspNowPairBlink 1", "blink", "zbbridge-living"])
rule("EspNowPair#Blinking", "B0:B0:B0:00:00:01", nil)
check("it says it does: the glass asks", p.asking, "blinking")
p.not_blinking()
check("not that one: back to the list, and nothing asked", [p.asking, p.chosen], [nil, nil])

# --- the room's Zigbee channel: of 15, 20, 25 and 26, the farthest in MHz from this panel's Wi-Fi and from the other bridges heard
check("away from the other bridge heard, on 15, with no Wi-Fi known: 26", ZigbeePairing.zigbee_channel(0, [15]), 26)
check("Wi-Fi on 6, nobody else: 26, 43 MHz from it", ZigbeePairing.zigbee_channel(6, []), 26)
check("Wi-Fi on 11: 15, below it", ZigbeePairing.zigbee_channel(11, []), 15)
check("Wi-Fi on 6 and a room on 26: 20, between the two", ZigbeePairing.zigbee_channel(6, [26]), 20)
check("nothing known: 25, the first of a tie", ZigbeePairing.zigbee_channel(0, []), 25)
check("a bridge that announced no network is no room to keep away from", ZigbeePairing.zigbee_channel(6, [0]), 26)

# a pairing got to the node's word: the search heard it, it identified itself, the keys were agreed as a guest's
def to_guest(entry)
    tasmota.replies["EspNowPairWith " + str(entry["Id"]) + ",guest"] = {"EspNowPairWith": "Started"}
    tasmota.replies["SSId1"] = {"SSId1": "Cottage"}
    p.run("endPair", [])
    p.found = [ZigbeePairing.entry(entry)]
    p.chosen = p.found[0]
    p.asking = "blinking"
    p.result = nil
    p.pair()
    rule("EspNowPair#Paired", entry["Mac"], {"EspNowPair": {"Paired": entry["Mac"], "Epoch": 1, "Guest": 1}})
    p.every_100ms()
end

# --- the pairing: a guest's exchange, the welcome of the house, the Wi-Fi --------------------------------------------
def pair_checks()
    import global
    var fake = FakeLink(2)
    global.house = FakeHouse(fake)
    told.clear()
    var living_room = heard_entry(1, "B0:B0:B0:00:00:01", -58, 2, "zbbridge-living")
    to_guest(living_room)
    check("it identifies itself, the user said: the keys, as a guest's, the driver's", tasmota.cmds.find("EspNowPairWith 1,guest") != nil, true)
    check("paired: nothing kept here, and this panel's word goes: in a house, with the room's Zigbee channel, and its network's channel, where the mesh is",
          [p.guesting, p.asking, persist.store.contains("zb_bridge_peer"), told[-1]["ZbPair"], told[-1]["house"], told[-1]["zigbee"], told[-1]["radio"]], [true, "hello", false, "guest", 2, 26, 6])
    tasmota.at_ms = 1000 + ZigbeePairing.HELLO_MS
    p.every_100ms()
    check("again, until the node's comes", size(told), 2)
    tasmota.at_ms = nil
    # a bridge with no house, on no network: this panel gives it the welcome, and then its Wi-Fi
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "", "house": 1, "ssid": "", "up": false})
    check("a bridge that can take a welcome is given one by this panel: as a bridge, its name and address, and the pairing waits",
          [fake.gives[-1], p.asking, p.state()["house_role"], fake.is_bound], [[1, "Living room", ""], "house", "give", true])
    told.clear()
    fake.said({"ZbPair": "houseAsk"})
    check("what the link says goes over the exchange's link", told, [{"ZbPair": "houseAsk"}])
    rule("ZbPair", "houseId", {"ZbPair": "houseId", "pub": "00", "mac": "00"})
    check("the events of the house are the link's", fake.events, ["houseId"])
    fake.ended(true, "")
    check("the welcome taken: a bridge with no Wi-Fi is offered this panel's", [p.asking, p.offer, p.state()["house"]], ["offer", {"kind": "give", "ssid": "Cottage"}, "in"])
    tasmota.cmds.clear()
    tasmota.replies["EspNowGiveWifi"] = {"EspNowGiveWifi": "sent"}
    p.answer_offer("give")
    check("Give: the driver sends this panel's network, and the exchange ends to let the bridge join; its join is not heard here, and the glass says it does not know",
          [tasmota.cmds[0], told[-1], p.wifi["state"]], ["EspNowGiveWifi", {"ZbPair": "done"}, "unknown"])
    tasmota.run_timers()
    check("the radio back once the frame is out", tasmota.cmds[-1], "EspNowPairStop")
    p.run("done", [])
    # a bridge on a network this panel is not on: its Wi-Fi offered
    to_guest(living_room)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "192.168.2.61", "house": 1, "ssid": "Cottage-2G", "up": true})
    fake.ended(true, "")
    check("its network offered, a different one", [p.asking, p.offer], ["offer", {"kind": "use", "ssid": "Cottage-2G"}])
    p.answer_offer("use")
    check("Use: the bridge asked for its network", [told[-1], p.wifi["state"]], [{"ZbPair": "wifiAsk"}, "asking"])
    rule("ZbPair", "wifiResult", {"ZbPair": "wifiResult", "state": "Refused", "reason": "Button"})
    check("refused by the bridge, its window not the button's: failed at once, and why", [p.wifi["state"], p.wifi["reason"]], ["failed", "Button"])
    p.wifi["state"] = "asking"
    tasmota.cmds.clear()
    tasmota.replies["EspNowTakeWifi"] = {"EspNowTakeWifi": "Joining"}
    rule("EspNowDirect#WifiOffered", "Cottage-2G", nil)
    check("its network, as the driver took it: the exchange done first, then joined",
          [tasmota.cmds, told[-1], p.wifi["state"]], [["EspNowPairStop", "EspNowTakeWifi"], {"ZbPair": "done"}, "joining"])
    rule("StaJoin#State", "Connected", {"StaJoin": {"State": "Connected", "SSId": "Cottage-2G", "IP": "192.168.2.51"}})
    check("and joined", p.wifi["state"], "connected")
    p.run("done", [])
    tasmota.cmds.clear()
    rule("EspNowDirect#WifiOffered", "Elsewhere", nil)
    check("a network the panel did not ask for is dropped", tasmota.cmds, ["EspNowTakeWifi 0"])
    # the same network on both: nothing offered, and the exchange is over
    to_guest(living_room)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "192.168.2.61", "house": 1, "ssid": "Cottage", "up": true})
    told.clear()
    fake.ended(true, "")
    check("the same network: nothing offered, and the exchange is over", [p.offer, p.asking, p.result, told[-1]], [nil, nil, "paired", {"ZbPair": "done"}])
    tasmota.run_timers()
    # a panel's window: added as a panel, and no Wi-Fi offered
    var bedroom = heard_entry(2, "B0:B0:B0:00:00:02", -40, 2, "Den panel bedroom")
    bedroom["Display"] = 1
    to_guest(bedroom)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Den panel bedroom", "ip": "192.168.2.70", "house": 1, "ssid": "", "up": false})
    check("a panel's window: given the welcome as a panel", [fake.gives[-1], p.asking], [[2, "Den panel bedroom", "192.168.2.70"], "house"])
    told.clear()
    fake.ended(true, "")
    check("and no Wi-Fi offered to a panel: the exchange is over", [p.offer, p.asking, p.result, told[-1]], [nil, nil, "paired", {"ZbPair": "done"}])
    tasmota.run_timers()
    # a node in a house already, one with no mesh driver, a panel that cannot give, and a welcome that did not get through
    var reasons = []
    for said: [[2, 2, true], [0, 2, true], [1, 1, true], [1, 2, false]]
        var l = FakeLink(said[1])
        l.give_ok = said[2]
        global.house = FakeHouse(l)
        to_guest(living_room)
        rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "192.168.2.61", "house": said[0], "ssid": "Cottage", "up": true})
        reasons.push([p.state()["house"], p.asking, p.result])
        rule("EspNowPair#Guest", "Ended", nil)
        tasmota.run_timers()
    end
    check("a node in a house already, one with no driver, a panel that has no house, or one that cannot give: not added, and why, the exchange over",
          reasons, [["already", nil, "paired"], ["none", nil, "paired"], ["nokey", nil, "paired"], ["nokey", nil, "paired"]])
    global.house = FakeHouse(fake)
    to_guest(living_room)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "", "house": 1, "ssid": "Cottage", "up": true})
    fake.ended(false, "silent")
    check("a welcome that did not get through ends the house and not the exchange: paired, with the reason for the glass", [p.asking, p.result, p.state()["house"]], [nil, "paired", "silent"])
    tasmota.run_timers()
    # the exchange's time up, with the node not heard
    to_guest(living_room)
    rule("EspNowPair#Ended", "Timeout", nil)
    check("an exchange that ends before the node speaks: nothing was changed, and the glass says it did not answer",
          [p.guesting, p.asking, p.state()["house"], p.result], [false, nil, "silent", "paired"])
    # with no exchange, what comes over the link is nobody's
    told.clear()
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "house": 1})
    check("with no exchange on, a word over the link is nobody's", [told, p.asking], [[], nil])
    global.house = nil
end
pair_checks()

# --- what did not pair ---------------------------------------------------------------------------------
p.found = [ZigbeePairing.entry(heard_entry(1, "B0:B0:B0:00:00:01", -58, 2, "zbbridge-living"))]
p.blink(1)
rule("EspNowPair#Failed", "Busy", nil)
check("busy: said so", [p.asking, p.result], [nil, "busy"])
p.blink(1)
rule("EspNowPair#Blinking", "B0:B0:B0:00:00:01", nil)
p.pair()
rule("EspNowPair#Failed", "NotConfirmed", nil)
check("not confirmed: said so", p.result, "notconfirmed")
p.blink(1)
rule("EspNowPair#Failed", "Radio", nil)
check("the WiFi Manager took the radio: said who", [p.result, p.state()["holder"]], ["radio", "WifiManager"])
# a window of an earlier build: nothing was sent, and the glass says so
tasmota.replies["EspNowPairWith 1,guest"] = {"EspNowPairWith": "No guest"}
p.blink(1)
rule("EspNowPair#Blinking", "B0:B0:B0:00:00:01", nil)
p.pair()
check("a window that does not take a guest is not asked, and the glass says it needs an update", [p.asking, p.result, p.guesting], [nil, "noguest", false])
p.run("endPair", [])
check("the pairing's view closed: what it found goes", [size(p.found), p.result, p.chosen], [0, nil, nil])

# --- the networks around, for the room's Zigbee channel
# --- a panel on no network adds a node on none: the two end on one radio channel ----------------------------------
def no_network_checks()
    import global
    var fake = FakeLink(2)
    global.house = FakeHouse(fake)
    var far = heard_entry(1, "B0:B0:B0:00:00:01", -58, 2, "zbbridge-living")
    far["Channel"] = 11
    far["Network"] = 0
    # a house with no radio channel yet: the panel takes the node's
    tasmota.replies["EspNowMeshChannel"] = {"EspNowMeshChannel": 0}
    p.home_channel = 0
    told.clear()
    to_guest(far)
    check("on no network and no channel kept, this panel's word gives the node no radio channel", told[-1].contains("radio"), false)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "", "house": 1, "ssid": "", "up": false})
    tasmota.cmds.clear()
    fake.ended(true, "")
    check("the welcome taken: the house's channel is the one they were paired on, at once for a house of two", global.house.set, [11, 0])
    check("which every node takes from the list, this panel too: no channel of its own", tasmota.cmds.find("EspNowMeshChannel 11"), nil)
    p.run("done", [])
    # this panel's mesh has a channel, and the house none: the node is given it, and it is the house's
    tasmota.replies["EspNowMeshChannel"] = {"EspNowMeshChannel": 3}
    global.house.set = nil
    p.home_channel = 0
    told.clear()
    to_guest(far)
    check("on no network, the channel its mesh keeps, and the node is given it", told[-1]["radio"], 3)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "", "house": 1, "ssid": "", "up": false})
    tasmota.cmds.clear()
    fake.ended(true, "")
    check("and the house's channel is that one: this panel does not move", [global.house.set, tasmota.cmds.find("EspNowMeshChannel 11")], [[3, 0], nil])
    p.run("done", [])
    # a house with its channel: the node is given it, before this panel's network's, and nothing is written
    global.house.ch = 9
    global.house.set = nil
    p.home_channel = 6
    told.clear()
    to_guest(far)
    check("a house with its channel gives it to the node, before this panel's network's", told[-1]["radio"], 9)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "", "house": 1, "ssid": "", "up": false})
    fake.ended(true, "")
    check("and writes no channel", global.house.set, nil)
    p.run("done", [])
    # a house with no channel, three nodes and more: the change waits for the house's own time (nil), for every node to have it
    global.house.ch = nil
    global.house.list.n = [1, 2, 3]
    tasmota.replies["EspNowMeshChannel"] = {"EspNowMeshChannel": 0}
    p.home_channel = 0
    to_guest(far)
    rule("ZbPair", "guest", {"ZbPair": "guest", "name": "Living room", "ip": "", "house": 1, "ssid": "", "up": false})
    fake.ended(true, "")
    check("a house of more than two takes the channel at the house's own time", global.house.set, [11, nil])
    p.run("done", [])
    global.house.list.n = [1]
    tasmota.replies.remove("EspNowMeshChannel")
end

def around_checks()
    check("the house on 11 and a strong neighbour on 1: 26, away from both",
          ZigbeePairing.zigbee_channel(11, [], [1]), 26)
    check("a neighbour on the house's own channel changes nothing", ZigbeePairing.zigbee_channel(11, [], [11]), 15)
    p.run("endPair", [])
    tasmota.cmds.clear()
    tasmota.replies["StaScan"] = {"StaScan": "Started"}
    tasmota.replies["EspNowPairScan"] = {"EspNowPairScan": "Started"}
    p.discover()
    check("the networks' search goes first, and the nodes' waits for it",
          [tasmota.cmds.find("StaScan") != nil, tasmota.cmds.find("EspNowPairScan"), p.state()["searching"]], [true, nil, true])
    rule("StaScan", {"Networks": [["Neighbour", -60, 3, 1, "AA:AA:AA:AA:AA:01"], ["Faraway", -88, 3, 6, "AA:AA:AA:AA:AA:02"],
                                  ["Cottage", -50, 3, 11, "AA:AA:AA:AA:AA:03"]]}, nil)
    check("the strong networks around are kept, the weak one is not", p.around, [1, 11])
    check("and the nodes' search starts", tasmota.cmds.find("EspNowPairScan") != nil, true)
    p.home_channel = 11
    check("the room's channel keeps away from them all: 26", p.room_zigbee(), 26)
    # one that says nothing in time does not hold the nodes' up
    p.run("endPair", [])
    tasmota.cmds.clear()
    tasmota.at_ms = 50000
    p.discover()
    tasmota.at_ms = 50000 + ZigbeePairing.WIFI_SCAN_MS
    p.every_100ms()
    check("a networks' search that says nothing in time does not hold the nodes' up", tasmota.cmds.find("EspNowPairScan") != nil, true)
    p.run("endPair", [])
    tasmota.replies.remove("StaScan")
    tasmota.at_ms = nil
end
around_checks()

# --- the driver keeps the strongest nodes heard: one in the weakest's place comes with its id and takes its row, and a tap
# waiting for the end of the search, on one whose place a nearer one took, asks none, and the glass goes back to the list
def strongest_checks()
    tasmota.replies["StaScan"] = {"StaScan": "Busy"}
    tasmota.replies["EspNowPairScan"] = {"EspNowPairScan": "Started"}
    p.discover()
    rule("EspNowPair#Heard", heard_entry(1, "B0:B0:B0:00:00:01", -70, 2, "far"), nil)
    rule("EspNowPair#Heard", heard_entry(2, "B0:B0:B0:00:00:02", -60, 2, "mid"), nil)
    tasmota.replies["EspNowPairBlink 1"] = {"EspNowPairBlink": "Scanning"}
    p.blink(1)
    rule("EspNowPair#Heard", heard_entry(1, "B0:B0:B0:00:00:07", -45, 2, "near"), nil)
    check("one in the weakest's place takes its row", [size(p.found), p.found[0]["mac"], p.found[0]["name"]],
          [2, "B0:B0:B0:00:00:07", "near"])
    tasmota.replies["EspNowPairHeard"] = {"EspNowPairHeard": [heard_entry(1, "B0:B0:B0:00:00:07", -45, 2, "near"),
                                                              heard_entry(2, "B0:B0:B0:00:00:02", -60, 2, "mid")]}
    tasmota.cmds = []
    rule("EspNowPair#Scan", "Done", nil)
    check("the tap on the one gone asks none, and the glass goes back to the list",
          [tasmota.cmds, p.asking, p.chosen, p.pending], [["EspNowPairHeard"], nil, nil, nil])
    tasmota.replies.remove("StaScan")
end
strongest_checks()

# --- this panel's own window, for a panel of a house to add it ------------------------------------------------------
def window_checks()
    import global
    var was = global.house
    p.run("endPair", [])
    # in a house: the window waits for this panel to be out of it
    var l = FakeLink(2)
    global.house = FakeHouse(l)
    tasmota.cmds.clear()
    tasmota.replies["EspNowPairOpen 300,0,1"] = {"EspNowPairOpen": "Open"}
    tasmota.at_ms = 1000
    p.run("window", [])
    check("asked while this panel is in a house: it waits for the leave, and the driver is asked nothing", [p.window["state"], tasmota.cmds.find("EspNowPairOpen 300,0,1")], ["leaving", nil])
    l.flagv = 1
    p.every_100ms()
    check("out of it: the driver's window, as a device with a display", [p.window["state"], tasmota.cmds.find("EspNowPairOpen 300,0,1") != nil, p.state()["window"]["state"]], ["open", true, "open"])
    # picked by a panel of the house: the screen says so, for a while
    rule("EspNowPair#Blink", 1, nil)
    check("picked: its screen says it is the one", p.window["state"], "asked")
    tasmota.at_ms = 1000 + ZigbeePairing.IDENTIFY_MS
    p.every_100ms()
    check("and back to waiting once that time is up", p.window["state"], "open")
    # the panel that adds it pairs with it, as a guest: the window's exchange, not the search's
    rule("EspNowPair#Paired", "CC:CC:CC:00:00:04", {"EspNowPair": {"Paired": "CC:CC:CC:00:00:04", "Epoch": 1, "Guest": 1}})
    check("paired at the window: joining, and the search does not take it", [p.window["state"], p.wguest, p.guesting], ["joining", true, false])
    told.clear()
    tasmota.cmds.clear()
    rule("ZbPair", "guest", {"ZbPair": "guest", "house": 2, "zigbee": 20, "radio": 6})
    check("the other's word: bound for the welcome, its radio channel kept, and who this panel is said back, a node that can take a welcome",
          [l.is_bound, tasmota.cmds.find("EspNowMeshChannel 6") != nil, told[-1]["ZbPair"], told[-1]["name"], told[-1]["house"]], [true, true, "guest", "nspanel-living", 1])
    rule("ZbPair", "houseAsk", {"ZbPair": "houseAsk"})
    check("the welcome's words are the link's", l.events[-1], "houseAsk")
    l.ended(true, "")
    check("taken: in", p.window["state"], "in")
    tasmota.cmds.clear()
    rule("ZbPair", "done", {"ZbPair": "done"})
    check("the other is done: the exchange ends here too", [tasmota.cmds.find("EspNowPairStop") != nil, p.wguest, l.is_bound, p.window["state"]], [true, false, false, "in"])
    p.run("closeWindow", [])
    check("Done: nothing of the window left", [p.window, p.state()["window"]], [nil, nil])
    # an exchange that ends before the welcome: not added, and why
    l = FakeLink(1)
    global.house = FakeHouse(l)
    p.run("window", [])
    rule("EspNowPair#Paired", "CC:CC:CC:00:00:04", {"EspNowPair": {"Paired": "CC:CC:CC:00:00:04", "Epoch": 1, "Guest": 1}})
    rule("EspNowPair#Guest", "Ended", nil)
    check("the exchange ended with no welcome: not added, silent", [p.window["state"], p.window["why"], p.wguest], ["no", "silent", false])
    p.run("closeWindow", [])
    # the driver's time up: closed
    p.run("window", [])
    rule("EspNowPair#Window", "Closed", nil)
    check("the window's time up: closed, for the screen to say so", p.window["state"], "closed")
    p.run("closeWindow", [])
    # a panel that does not get out of its house in time
    l.flagv = 2
    tasmota.at_ms = 50000
    p.run("window", [])
    tasmota.at_ms = 50000 + ZigbeePairing.LEAVE_WAIT_MS
    p.every_100ms()
    check("not out of its house in time: not opened, and why", [p.window["state"], p.window["why"]], ["no", "leaving"])
    p.run("closeWindow", [])
    # the window and the search are never at once: a window asked for during a search is not opened
    p.searching = true
    check("a window asked for during a search is not opened", [p.open_window(), p.window], [false, nil])
    p.searching = false
    tasmota.at_ms = nil
    tasmota.replies.remove("EspNowPairOpen 300,0,1")
    global.house = was
end
window_checks()

# --- what the views read of the Zigbee: the bridge of the house, and whether it is in step -----------------------------------
bridge.info = {"mac": "A0:B7:65:77:00:07", "name": "Living room", "ip": "192.168.2.61", "id": 7}
bridge.linked = true
check("the views' state: the mode, the bridge of the house and its link", [p.state()["mode"], p.state()["peer"]["name"], p.state()["link"]], ["mesh", "Living room", true])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
