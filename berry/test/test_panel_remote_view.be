# berry/panel_remote_view.be and PanelStore.add_remote_device: the + of a zone in a house of more than one bridge. Pair new device or
# Existing device; the bridges of the house but the panel's own; a page of a bridge's devices, which the panel asks of the house layer (here a fake that has the page it is
# given); and the device taken, in the zone, owned by that bridge. Each part is a function, as a script's top level holds 256 constants at most.

import json
import global

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if json.dump(got) != json.dump(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + json.dump(got))
        print("  want " + json.dump(want))
    end
end

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

var living_room_text = read_text("berry/test/fixtures/living-room.json")
var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard"},
             "listRows": 5, "zoneRows": 2, "counters": 3, "helpLines": 5}

# the house layer, as far as the screens read it: the list, whether it is up, and the page of devices
class FakeDevices
    var asked, page
    def init() self.asked = [] self.page = nil end
    def ask(owner, first)
        self.asked.push([owner, first])
        self.page = nil
    end
    # the bridge's answer, as HouseDevices.current gives it: [the items of the page, the place of the first, how many there are]
    def given(items, first, total) self.page = [items, first, total] end
    def current() return self.page end
end

class FakeHouse
    def neighbors() import global return global.contains("espnow_mesh_neighbors") ? global.espnow_mesh_neighbors() : [] end
    def heard_by(id) for n: self.neighbors() if isinstance(n, map) && n.find("id") == id return n end end return nil end
    var up, list, devices, fav
    def init(l) self.up = true self.list = l self.devices = FakeDevices() self.fav = 0 end
    def favorite() return self.fav end
end

# the Wi-Fi's view of the panel, as far as Zigbee: a panel with no bridge of its own has it off
class FakeWireless
    def zigbee_mode() return "off" end
end

class FakeLink
    var mac
    def init(mac) self.mac = mac end
    def peer() return self.mac == nil ? nil : {"mac": self.mac, "ip": "192.168.0.61", "name": "zbbridge-living"} end
end

def key_of(n)
    var b = bytes(-32)
    b[0] = n
    return b
end

def mac_of(n)
    var b = bytes("A0B7650000")
    b.add(n, 1)
    return b
end

# the list of the house: the panel 4, and the bridges 6 (Kitchen), 7 (Garage) and 8 (struck off)
def house_list()
    var l = HouseList(4)
    for n: [4, 6, 7, 8]
        var d = bytes()
        d.add(n == 4 ? HouseList.ROLE_PANEL : HouseList.ROLE_BRIDGE, 1)
        d .. key_of(n)
        d .. mac_of(n)
        l.author(HouseList.K_IDENT, n, d)
    end
    l.author(HouseList.K_NAME, 6, bytes().fromstring("Kitchen"))
    l.author(HouseList.K_NAME, 7, bytes().fromstring("Garage"))
    l.author(HouseList.K_REVOKE, 8, bytes())
    return l
end

def fixture(link_mac, blank)
    var f = {}
    global.house = FakeHouse(house_list())
    global.zb_bridge = FakeLink(link_mac)
    f["store"] = blank ? PanelStore(nil) : PanelStore(json.load(living_room_text))
    var ui = PanelUi(f["store"], shape, / -> [], nil)
    f["ui"] = ui
    ui.providers.push(PanelAddView(ui))
    ui.providers.push(PanelRemoteView(ui))
    ui.now_fn = / -> 0
    ui.prefs["editing"] = true
    return f
end

def rows(ui)
    var out = []
    for r: ui.list_view(ui.top()["view"])[2]  out.push([r[2], r[3], r[5] != nil]) end
    return out
end

def section_offers()
    fixture(nil)
    check("a house with bridges, and a panel that has none of its own, offers the choice", PanelRemoteView.offers(), true)
    check("all the bridges but the one struck off", PanelRemoteView.others(global.house), [6, 7])
    var h = FakeHouse(house_list())
    global.house = h
    check("still a choice", PanelRemoteView.offers(), true)
    # a house of one bridge, or no mesh
    var one = HouseList(4)
    var d = bytes()
    d.add(HouseList.ROLE_BRIDGE, 1)
    d .. key_of(6)
    d .. mac_of(6)
    one.author(HouseList.K_IDENT, 6, d)
    h.list = one
    check("a house of one bridge: it is any panel's, and offered (no bridge is a panel's own)", [PanelRemoteView.offers(), PanelRemoteView.others(h)], [true, [6]])
    h.list = HouseList(4)
    check("a house with no bridge offers none", PanelRemoteView.offers(), false)
    h.list = one
    h.up = false
    check("nor a mesh that is not up", PanelRemoteView.offers(), false)
    global.house = nil
    check("nor an image without the house layer", PanelRemoteView.offers(), false)
    global.house = FakeHouse(house_list())
    global.house.list.me = 0
    check("nor a node with no number of its own", PanelRemoteView.offers(), false)
end

def section_screens()
    var f = fixture("A0:B7:65:00:00:06")
    var ui = f["ui"]
    ui.open(["add", "hall"])
    ui.list_row(0, 0, false)
    check("the + asks Pair new device or Existing device when there is a choice", ui.top()["view"], ["addZigbee", "hall"])
    check("two rows, both to touch", rows(ui), [["Pair new device", "", true], ["Existing device", "", true]])
    ui.list_row(1, 0, false)
    check("Existing device lists the bridges of the house, any panel's, not the one struck off, with the signal", [ui.top()["view"], rows(ui)],
          [["addBridges", "hall"], [["Kitchen", "No signal", true], ["Garage", "No signal", true]]])
    ui.list_row(1, 0, false)
    check("a bridge's devices are asked of it, from the first", [ui.top()["view"], global.house.devices.asked], [["addDevices", "hall", 7], [[7, 0]]])
    check("and the screen says it is asking while the page has not come", rows(ui), [["Asking the bridge", "", false]])
    var lamp = ["0x00124B0000CC0001", "TS0505B", ["L01.5"], "Bedroom"]
    var plug = ["0x00124B0000CC0002", "TS011F", ["P01"], ""]
    var odd = ["0x00124B0000CC0003", "XYZ", [], ""]
    var have = [json.load(living_room_text)["devices"][0][0], "M", ["L01.1"], "Mine"]
    global.house.devices.given([lamp, plug, odd, have], 0, 12)
    var r = rows(ui)
    check("a page: a device with its name, one named by its model, one that is not supported, one the panel has", [r[0], r[2], r[3]], [["Bedroom", "Light", true], ["XYZ", "Not supported", false], ["Mine", "Added", false]])
    check("and Next, there being more", r[size(r) - 1], ["Next", "", true])
    var n = size(r)
    ui.list_row(n - 1, 0, false)
    check("Next asks the bridge for the page that follows", [global.house.devices.asked[-1], ui.top()["view"]], [[7, 5], ["addDevices", "hall", 7]])
    global.house.devices.given([lamp, plug, odd, have, lamp], 5, 12)
    r = rows(ui)
    check("a page after the first has Previous and Next", [r[size(r) - 2], r[size(r) - 1]], [["Previous", "", true], ["Next", "", true]])
    ui.list_row(size(r) - 2, 0, false)
    check("Previous asks for the one before", global.house.devices.asked[-1], [7, 0])
    global.house.devices.given([], 0, 0)
    check("a bridge with no devices says so", [ui.top()["view"][0], rows(ui)], ["addDevices", [["No devices", "", false]]])
end

def section_take()
    var f = fixture("A0:B7:65:00:00:06", true)
    var ui = f["ui"]
    var store = f["store"]
    var room = store.create_zone("home", "Room", [0, 0], [3, 3])["value"]
    ui.open(["add", room])
    ui.list_row(0, 0, false)
    ui.list_row(1, 0, false)
    ui.list_row(1, 0, false)
    var lamp = ["0x00124B0000CC0001", "TS0505B", ["L01.5"], "Bedroom"]
    global.house.devices.given([lamp], 0, 1)
    var fx = ui.list_row(0, 0, false)
    var saved = false
    for e: fx if e == ["save"] saved = true end end
    check("a device taken is in the zone, and saved", [store.zone_of("0x00124B0000CC0001")["id"], saved], [room, true])
    var d = store.find_device("0x00124B0000CC0001")
    check("named as the bridge's panels named it, of the kind its Config says, and with the model", [d[1], d[2], d[6]], ["Bedroom", "light", "TS0505B"])
    check("the bridge's, which says it is remote, and it is no member of a group of this network", [store.owner_of(d[0]), store.is_remote(d[0]), store.zone_of(d[0])["zstate"].contains(d[0])], [7, true, false])
    check("the screens went back to where the + was opened: none of the bridges' are left", size(ui.stack), 0)
    check("the document is valid", store.validate(), [])
    check("a device that is the panel's has no owner", store.owner_of(json.load(living_room_text)["devices"][0][0]), 0)
end

class FakeWhy
    var says
    def init(says) self.says = says end
    def reason(dev) return self.says end
end

def section_status()
    var f = fixture("A0:B7:65:00:00:06", true)
    var ui = f["ui"]
    var store = f["store"]
    var room = store.create_zone("home", "Room", [0, 0], [3, 3])["value"]
    store.add_remote_device(room, 7, ["0x00124B0000CC0001", "TS0505B", ["L01.5"], "Bedroom"])
    ui.prefs["editing"] = false
    ui.open(["deviceOptions", "0x00124B0000CC0001"])
    check("a device of another room whose bridge is ready has no status row", rows(ui), [["Info", "", true]])
    ui.gate = FakeWhy("Bridge off")
    check("one whose bridge is not says why on its page, and the row is not to touch", rows(ui), [["Status", "Bridge off", false], ["Info", "", true]])
    ui.gate = FakeWhy(nil)
    check("a gate that has no reason adds nothing", rows(ui), [["Info", "", true]])
end

def section_store()
    var s = PanelStore(nil)
    var zone = s.create_zone("home", "Room", [0, 0], [3, 3])["value"]
    var item = ["0x00124b0000dd0001", "M", ["L01.2"], ""]
    var r = s.add_remote_device(zone, 7, item)
    check("the IEEE is written in capitals, as the panel keeps them", [r["ok"], r["value"]], [true, "0x00124B0000DD0001"])
    check("a device with no name is named as a new one is", s.find_device(r["value"])[1], "Light 1")
    check("one of temperature has its range", [s.find_device(r["value"])[4], s.find_device(r["value"])[5]], [153, 500])
    check("the same again is refused", s.add_remote_device(zone, 7, item)["refusal"], "device_exists")
    check("a zone that is not there", s.add_remote_device("nowhere", 7, ["0x00124B0000DD0002", "M", ["L01.2"], ""])["refusal"], "no_such_zone")
    check("a device the Config does not say what is", s.add_remote_device(zone, 7, ["0x00124B0000DD0002", "M", [], ""])["refusal"], "unsupported")
    check("what is not a device", [s.add_remote_device(zone, 7, nil)["refusal"], s.add_remote_device(zone, 7, [1, 2])["refusal"], s.add_remote_device(zone, 7, ["0x12", "M", ["L01.2"], ""])["refusal"]], ["bad_device", "bad_device", "bad_device"])
    check("a bridge that is not one", s.add_remote_device(zone, 0, ["0x00124B0000DD0003", "M", ["L01.2"], ""])["refusal"], "bad_owner")
    check("and what was refused left nothing behind", [s.find_device("0x00124B0000DD0002"), s.find_device("0x00124B0000DD0003"), s.validate()], [nil, nil, []])
    # a zone with no room
    var tiny = PanelStore(nil)
    var z = tiny.create_zone("home", "Room", [0, 0], [2, 2])["value"]
    for i: 1 .. 4 tiny.add_remote_device(z, 7, ["0x00124B0000DD000" + str(i), "M", ["L01.2"], ""]) end
    check("a full zone refuses, and the device does not stay in the panel's list", [tiny.add_remote_device(z, 7, ["0x00124B0000DD0009", "M", ["L01.2"], ""])["refusal"], tiny.find_device("0x00124B0000DD0009"), tiny.owner_of("0x00124B0000DD0009")], ["full", nil, 0])
end

# Pair new device on a bridge of the house: the favourite first, the search on the one chosen, and what it finds that bridge's
def section_pair_on()
    var f = fixture("A0:B7:65:00:00:06")
    var ui = f["ui"]
    global.house.fav = 7
    global.espnow_mesh_neighbors = / -> [{"id": 6, "state": 0}, {"id": 7, "state": 0}]
    check("the bridges to pair on: the favourite first, then the rest by their numbers, the panel's own too, not the one struck off", PanelRemoteView.pair_bridges(global.house), [7, 6])
    ui.open(["add", "hall"])
    ui.list_row(0, 0, false)
    ui.list_row(0, 0, false)
    check("Pair new device asks on which bridge, when there is more than one", ui.top()["view"], ["addPairOn", "hall"])
    check("each bridge heard, the favourite said so", rows(ui), [["Garage", "Favorite", true], ["Kitchen", "", true]])
    var out = ui.list_row(1, 0, false)
    check("the one touched: the search, opened on that bridge's network, by its number", [ui.top()["view"], ui.pairing["bridge"], out[0]], [["pair", "hall"], 6, ["pair", "hall", 6]])
    var lamp = "0x00124B0000CC0009"
    ui.pair_announced(lamp)
    ui.pair_interviewed(lamp, 0x0104, 0x010D, [0x0000, 0x0006, 0x0008, 0x0300], 1)
    check("what the search finds is that bridge's", [f["store"].find_device(lamp) != nil, f["store"].owner_of(lamp)], [true, 6])
    check("and the search's end goes to it", ui.stop_pairing(), [["pairStop", 6]])
    # a bridge not heard is said so, and not touched
    global.espnow_mesh_neighbors = / -> [{"id": 6, "state": 0}]
    ui.open(["addPairOn", "hall"])
    check("a bridge the mesh does not hear: No signal, and no touch", rows(ui)[0], ["Garage", "No signal", false])
    # one bridge to pair on: no question
    var g = fixture(nil, true)
    var one = HouseList(4)
    var d = bytes()
    d.add(HouseList.ROLE_BRIDGE, 1)
    d .. key_of(6)
    d .. mac_of(6)
    one.author(HouseList.K_IDENT, 6, d)
    global.house.list = one
    var z = g["store"].create_zone("home", "Hall", [0, 0], [3, 3])["value"]
    var u = g["ui"]
    u.open(["addZigbee", z])
    out = u.list_row(0, 0, false)
    check("with one bridge in the house, Pair new device searches on it at once", [u.top()["view"][0], u.pairing["bridge"], out[0]], ["pair", 6, ["pair", z, 6]])
    # and Existing device goes to its page of devices at once
    u.pairing = nil
    u.stack = []
    u.open(["addZigbee", z])
    u.list_row(1, 0, false)
    check("with one bridge in the house, Existing device opens its devices at once, with no list of bridges", [u.top()["view"], global.house.devices.asked[-1]], [["addDevices", z, 6], [6, 0]])
    # a panel with no bridge of its own, its Zigbee off, pairs on a bridge of the house, and only there
    u.wireless = FakeWireless()
    check("a panel with Zigbee off adds Zigbee devices on the house's bridges", u.can_add_zigbee(), true)
    u.pairing = nil
    check("its search opens one of them", u.begin_pairing(z, 6)[0], ["pair", z, 6])
    u.pairing = nil
    check("and no search of its own, which it has not", u.start_pairing(z), [])
    global.house.up = false
    check("with no house to pair in, no Zigbee device", u.can_add_zigbee(), false)
    # nor in a house with no bridge: nothing to pair on, nothing to take
    global.house.up = true
    global.house.list = HouseList(4)
    check("nor in a house with no bridge", u.can_add_zigbee(), false)
    global.espnow_mesh_neighbors = / -> []
end

section_offers()
section_pair_on()
section_screens()
section_take()
section_status()
section_store()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
