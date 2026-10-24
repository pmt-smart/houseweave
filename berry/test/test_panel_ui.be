# berry/panel_ui.be against berry/test/vectors/ui.json: every scenario replayed
# on a fresh Living room, and every effect of every step compared.
#
# The vectors are this suite's own. A scenario is its steps, written by hand;
# what each step must give is what the views gave when the change was meant:
# `node berry/test/run.mjs --update-vectors` writes it (UPDATE_VECTORS), and
# the diff of the file is the review of the change. The simulator runs this
# file too.

import json
import string
import global

var failures = 0
var checks = 0

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

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

var v = json.load(read_text("berry/test/vectors/ui.json"))
var living_room_text = read_text("berry/test/fixtures/living-room.json")

# Wireless settings' Wi-Fi and Zigbee (panel_wifi.be), as a scenario sets them:
# a panel with nothing saved and Zigbee off, and what the steps change
class FakeWireless
    var st
    def init(fields)
        self.st = {"saved": "", "ssid": "", "up": false, "ip": "", "quality": nil, "mac": "24:0A:C4:3E:51:A7",
                   "off": false, "web": false, "ap": "tasmota-3E51A7-6960", "search": false, "reason": "",
                   "scanning": false, "networks": nil, "join": nil, "zigbee": "off"}
        self.set(fields)
    end
    def set(fields) for k: fields.keys() self.st[k] = fields[k] end end
    def state() return self.st end
    def zigbee_mode() return self.st["zigbee"] end
end

# the Zigbee of Wireless settings (zigbee_pairing.be's state), as a scenario sets it
class FakeZigbee
    var st
    def init(fields)
        self.st = {"mode": "off", "peer": nil, "link": false, "searching": false, "sweeping": false,
                   "found": [], "asking": nil, "chosen": nil, "result": nil, "offer": nil, "wifi": nil, "taken": false,
                   "peer_version": nil}
        self.set(fields)
    end
    def set(fields) for k: fields.keys() self.st[k] = fields[k] end end
    def state() return self.st end
end

# the MQTT of Wireless settings (panel_mqtt.be's state), as a scenario sets it
class FakeMqtt
    var st
    def init(fields)
        self.st = {"host": "", "port": 1883, "user": "", "password": false, "discovery": true, "connected": false}
        self.set(fields)
    end
    def set(fields) for k: fields.keys() self.st[k] = fields[k] end end
    def state() return self.st end
end

# the backup of Wireless settings (panel_backup.be's state), as a scenario sets it
class FakeBackup
    var st
    def init(fields)
        self.st = {"server": "", "pending": false, "last": nil, "result": "", "busy": "", "other": false, "found": nil, "restore": ""}
        self.set(fields)
    end
    def set(fields) for k: fields.keys() self.st[k] = fields[k] end end
    def state() return self.st end
end

# the house as house_mesh.be has it, for what the views ask of it, as a scenario sets it: in step, and written by this panel
class VectorHouse
    var up, can
    def init(fields) self.up = fields.find("up", true) self.can = fields.find("writes", true) end
    def writes() return self.can end
end

def step(ui, s)
    var m = s[0]
    if m == "house" global.house = s[1] != nil ? VectorHouse(s[1]) : nil return [] end
    if m == "wireless" ui.wireless = FakeWireless(s[1]) return [] end
    if m == "zigbee" ui.zigbee = FakeZigbee(s[1]) return [] end
    if m == "zigbeeSet" ui.zigbee.set(s[1]) return [] end
    if m == "mqtt" ui.mqtt = FakeMqtt(s[1]) return [] end
    if m == "backup" ui.backup = FakeBackup(s[1]) return [] end
    if m == "backupSet" ui.backup.set(s[1]) return [] end
    # the backup's state changed, as brain hands it over (the step before sets it)
    if m == "backupChanged" return ui.backup_changed() end
    # the pairing heard a bridge, or the mode switched, as brain hands it over
    if m == "zigbeeChanged" return ui.zigbee_changed() end
    if m == "wifi" ui.wireless.set(s[1]) return [] end
    if m == "openWireless" return ui.open_wireless() end
    # a tap whose view the vectors do not draw: the mesh's Add to this house (panel_house_view.be), by its verb
    if m == "act" return ui.act(s[1]) end
    # what brain does with ["show"]: the view on top, drawn after the effects ran
    if m == "show" return ui.show() end
    # Tasmota's Wifi#Connected or Wifi#Disconnected, as brain hands it over
    if m == "wirelessChanged" return ui.wireless_changed() end
    # the station driver's StaHotspot report, once the Wi-Fi took it in (the step before sets it)
    if m == "hotspotChanged" return ui.hotspot_changed() end
    # the station driver's answer, "scan" or "join", once the Wi-Fi took it in
    # (the step before sets what it took in)
    if m == "wifiAnswer" return ui.wifi_answer(s[1]) end
    if m == "live" ui.live[s[1]] = s[2] return [] end
    if m == "relay" ui.relay_on[s[1] - 1] = s[2] return [] end
    if m == "openCard" return ui.open_card(s[1], s[2]) end
    if m == "openScreens" return ui.open_screens(s[1]) end
    if m == "shown" return ui.shown(s[1]) end
    if m == "listRow" return ui.list_row(s[1], s[2], s[3]) end
    if m == "zoneRow" return ui.zone_row(s[1], s[2], s[3]) end
    if m == "setPage" return ui.set_page(s[1]) end
    if m == "swipe" return ui.swipe(s[1]) end
    if m == "close" return ui.close() end
    if m == "action" return ui.action() end
    if m == "commit" return ui.commit(s[1]) end
    if m == "cancel" return ui.cancel() end
    if m == "renameTop" return ui.rename_top() end
    if m == "level" return ui.level(s[1], s[2]) end
    if m == "lockTry" return ui.lock_try(s[1]) end
    if m == "sleep" return ui.sleep() end
    if m == "pairTick" return ui.pair_tick() end
    if m == "pairAnnounced" return ui.pair_announced(s[1]) end
    if m == "pairInterviewed" return ui.pair_interviewed(s[1], s[2], s[3], s[4], s[5]) end
    if m == "pairModel" return ui.pair_model(s[1], s[2]) end
    if m == "startupResult" return ui.startup_result(s[1], s[2]) end
    if m == "refreshFor" return ui.refresh_for(s[1]) end
    if m == "refreshRelay" return ui.refresh_relay(s[1]) end
    if m == "pickColor" return ui.pick_color(s[1]) end
    raise "unknown_step", m
end

for si: 0 .. size(v["scenarios"]) - 1
    var sc = v["scenarios"][si]
    # no house unless the scenario says one
    global.house = nil
    # the pages of the EU landscape unless the scenario names another layout's
    var shape = sc.find("shape") != nil ? v["shapes"][sc["shape"]] : v["shape"]
    var ui = PanelUi(PanelStore(json.load(living_room_text)), shape, / -> v["items"], json.load(json.dump(v["prefs"])))
    # the +'s screens, as the boot gives them
    ui.providers.push(PanelAddView(ui))
    # the lock's clock, salt and hash, as the vectors' generator gives them
    var clock = [0]
    var salts = [0]
    ui.now_fn = / -> clock[0]
    ui.salt_fn = def () salts[0] += 1 return "salt" + str(salts[0]) end
    ui.hash_fn = / salt, pattern -> salt + ":" + pattern
    ui.info_fn = / -> [["Tasmota", "15.6.0"], ["Firmware", "abc1234"], ["Screen", "def5678"]]
    for i: 0 .. size(sc["steps"]) - 1
        if sc["steps"][i][0] == "clock" clock[0] = sc["steps"][i][1] end
        var got = sc["steps"][i][0] == "clock" ? [] : step(ui, sc["steps"][i])
        checks += 1
        if UPDATE_VECTORS
            print("VECTOR " + json.dump(["scenarios", si, "expect", i]) + " " + json.dump(got))
            continue
        end
        var want = sc["expect"][i]
        if !deep_eq(got, want)
            failures += 1
            print("FAIL " + sc["name"] + ": step " + str(i + 1) + " " + json.dump(sc["steps"][i]))
            # the first effect that differs, so a long list says where
            var n = size(got) < size(want) ? size(got) : size(want)
            var j = 0
            while j < n && deep_eq(got[j], want[j]) j += 1 end
            print("  at effect " + str(j) + " of " + str(size(want)) + " (got " + str(size(got)) + ")")
            print("  got  " + (j < size(got) ? json.dump(got[j]) : "(none)"))
            print("  want " + (j < size(want) ? json.dump(want[j]) : "(none)"))
        end
    end
end

global.house = nil

# --- a screen with zones: its Delete says so and opens nothing.
# Not a vector: only the plan puts a zone on another screen, and the views have
# no step for it
def delete_screen_checks()
    var store = PanelStore(json.load(living_room_text))
    var id = store.add_screen("Bedroom")["value"]
    store.doc["zones"][0]["screen"] = id
    var ui = PanelUi(store, v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    ui.open(["screenOptions", id])
    var del = ui.list_view(ui.top()["view"])[2][-1]
    checks += 1
    if del[2] != "Delete" || del[3] != "has zones" || del[5] != nil
        failures += 1
        print("FAIL a screen with zones: its Delete says so and opens nothing: " + json.dump(del))
    end
    store.doc["zones"][0]["screen"] = "home"
    del = ui.list_view(ui.top()["view"])[2][-1]
    checks += 1
    if del[3] != "" || !deep_eq(del[5], ["open", "confirm", "deleteScreen", id])
        failures += 1
        print("FAIL a screen with no zones: its Delete asks first: " + json.dump(del))
    end
end
delete_screen_checks()

# --- a device the Zigbee cannot handle: kept, in no zone, and its options take it off the
# network, now or later. Not a vector: the vectors
# record what a view shows, and this is what its rows do
def unsupported_rows(ui, name)
    var mine = []
    for r: ui.list_view(ui.top()["view"])[2]
        if r[2] == name
            mine.push(r)
        end
    end
    return mine
end

def unsupported_checks()
    # what the Zigbee cannot handle is not kept (kept, an unsupported curtain came back in every search): the search says
    # so while it runs, and at its end the device leaves the network and the coordinator forgets it
    var store = PanelStore(json.load(living_room_text))
    var ui = PanelUi(store, v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    ui.providers.push(PanelAddView(ui))
    var odd = "0x00124B0000AA0003"
    ui.open_card("z:hall", "home")
    ui.action()
    ui.list_row(0, 0, false)
    ui.pair_announced(odd)
    var out = ui.pair_interviewed(odd, 260, 81, [0, 3, 4, 5, 61184], 1)
    checks += 1
    if store.find_device(odd) != nil || size(out) == 0 || out[0][0] == "save"
        failures += 1
        print("FAIL an unsupported device is not kept: " + json.dump([store.find_device(odd), out]))
    end
    var mine = unsupported_rows(ui, "New device")
    checks += 1
    if size(mine) != 1 || mine[0][3] != "unsupported"
        failures += 1
        print("FAIL its row in the search says it is unsupported, while the search runs: " + json.dump(mine))
    end
    # the search ends: it leaves the network, and nothing of it stays
    var end_out = ui.stop_pairing()
    checks += 1
    if !deep_eq(end_out[0], ["leave", odd]) || store.find_device(odd) != nil
        failures += 1
        print("FAIL at the search's end it leaves the network, and is not kept: " + json.dump(end_out))
    end
    ui.close()
    ui.action()
    ui.list_row(0, 0, false)
    checks += 1
    if size(unsupported_rows(ui, "New device")) != 0
        failures += 1
        print("FAIL the next search does not list it")
    end
    # a driver's description that comes while the search runs takes it: a Tuya switch whose maker the bridge's driver knows
    var store2 = PanelStore(json.load(living_room_text))
    var ui2 = PanelUi(store2, v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    ui2.providers.push(PanelAddView(ui2))
    ui2.open_card("z:hall", "home")
    ui2.action()
    ui2.list_row(0, 0, false)
    ui2.pair_announced(odd)
    ui2.pair_interviewed(odd, 260, 81, [0, 3, 4, 5, 61184], 1)
    ui2.pair_described(odd, {"kind": "cover", "caps": 64, "model": "TS0601", "ep": 1})
    var d2 = store2.find_device(odd)
    checks += 1
    if d2 == nil || d2[2] != "cover" || store2.zone_of(odd) == nil
        failures += 1
        print("FAIL a driver's description in the search takes the device it found unsupported: " + json.dump(d2))
    end
    var end2 = ui2.stop_pairing()
    checks += 1
    if size(end2) > 0 && end2[0][0] == "leave"
        failures += 1
        print("FAIL and the search's end does not make it leave")
    end
end
unsupported_checks()

# --- every kind that acts has its own "no answer" and "no power":
# a row's icon, and not the unlit one. The Living room's devices
# are all lamps, so the kinds are given to three of them
def state_icon_checks()
    var store = PanelStore(json.load(living_room_text))
    var ui = PanelUi(store, v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    var kinds = {"0x00124B0000E00001": "plug", "0x00124B0000E00002": "fan", "0x00124B0000E00003": "sensor"}
    for id: kinds.keys() store.find_device(id)[2] = kinds[id] end
    var looks = def ()
        var out = {}
        for id: kinds.keys() out[kinds[id]] = ui.device_look(id)[0 .. 1] end
        return out
    end
    ui.doubt = {"0x00124B0000E00001": true, "0x00124B0000E00002": true, "0x00124B0000E00003": true}
    var silent = looks()
    ui.doubt = {}
    ui.relay_on = [true, false]
    var dark = looks()
    checks += 1
    var want_silent = {"plug": ["noanswer", "plugNoAnswer"], "fan": ["noanswer", "fanNoAnswer"], "sensor": ["noanswer", "sensor"]}
    var want_dark = {"plug": ["nopower", "plugNoPower"], "fan": ["nopower", "fanNoPower"], "sensor": ["nopower", "sensor"]}
    if !deep_eq(silent, want_silent) || !deep_eq(dark, want_dark)
        failures += 1
        print("FAIL a plug and a fan show their own no answer and no power, a sensor its one icon: " + json.dump([silent, dark]))
    end
    checks += 1
    var all = []
    for k: ["light", "plug", "switch", "fan", "cover", "thermostat", "sensor", "remote", "generic"] all.push([PanelUi.state_icon(k, "noanswer"), PanelUi.state_icon(k, "nopower")]) end
    if !deep_eq(all, [["lightNoAnswer", "lightNoPower"], ["plugNoAnswer", "plugNoPower"], ["switchNoAnswer", "switchNoPower"],
                      ["fanNoAnswer", "fanNoPower"], ["coverNoAnswer", "coverNoPower"],
                      ["thermostatNoAnswer", "thermostatNoPower"], [nil, nil], [nil, nil], [nil, nil]])
        failures += 1
        print("FAIL the roles of each kind: " + json.dump(all))
    end
end
state_icon_checks()

# --- Replace, in a device's options: the first device in takes the old one's name, zone,
# place and relay, and the old one leaves the network
def replace_checks()
    var store = PanelStore(json.load(living_room_text))
    var ui = PanelUi(store, v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    var old = "0x00124B0000E00001"
    var fresh = "0x00124B0000AB0001"
    var zone = store.zone_of(old)
    var slot = zone["members"][old]
    var was = store.find_device(old)
    var name = was[1]
    var relay = was[9]
    ui.open(["deviceOptions", old])
    var rows = []
    for r: ui.list_view(ui.top()["view"])[2]
        rows.push([r[2], r[5]])
    end
    checks += 1
    if rows.find(["Replace", ["replace", old]]) == nil
        failures += 1
        print("FAIL a Zigbee device's options have Replace: " + json.dump(rows))
    end
    ui.act(["replace", old])
    var pair = ui.list_view(ui.top()["view"])
    var labels = []
    for r: pair[2]
        labels.push(r[2])
    end
    checks += 1
    if pair[0] != "Replace " + name || labels.find("Relay 1") != nil
        failures += 1
        print("FAIL Replace opens its zone's search, for it, with no relay to mark: " + json.dump([pair[0], labels]))
    end
    ui.list_row(0, 0, false)
    ui.pair_announced(fresh)
    var out = ui.pair_interviewed(fresh, 260, 269, [0, 3, 4, 5, 6, 8, 768], 1)
    var d = store.find_device(fresh)
    checks += 1
    if store.find_device(old) != nil || d == nil || d[1] != name || d[9] != relay || zone["members"].find(fresh) != slot
        failures += 1
        print("FAIL the new device takes the old one's name, relay, zone and place, and the old one goes: " + json.dump(d))
    end
    var leaves = false
    var stops = false
    for e: out
        if e[0] == "leave" && e[1] == old leaves = true end
        if e[0] == "pairStop" stops = true end
    end
    checks += 1
    if !leaves || !stops || zone["zstate"].find(fresh) != "joining" || ui.pairing.find("replace") != nil
        failures += 1
        print("FAIL the old one leaves the network, the new one joins the zone's group, and the search ends: " + json.dump(out))
    end
end
replace_checks()

# --- a Replace's search is for one device: a second that comes with it leaves the
# network, with a free place in the zone or not
def replace_one_checks()
    var store = PanelStore(json.load(living_room_text))
    var ui = PanelUi(store, v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    var old = "0x00124B0000E00001"
    var second = "0x00124B0000AB0002"
    store.remove_device("0x00124B0000E00002")
    var zone = store.zone_of(old)
    ui.open(["deviceOptions", old])
    ui.act(["replace", old])
    ui.list_row(0, 0, false)
    ui.pair_announced("0x00124B0000AB0001")
    var out = ui.pair_announced(second)
    var left = false
    for e: out
        if e[0] == "leave" && e[1] == second left = true end
    end
    checks += 1
    if size(PanelStore.free_slots(zone)) != 1 || !left || ui.pairing["found"][1][1] != "nofree"
        failures += 1
        print("FAIL a Replace's search takes one device, and a second leaves, a place free or not: " + json.dump(out))
    end
end
replace_one_checks()

# --- a search for nodes with the Hotspot up: the glass says it closes first, and Continue
# closes it for the search. Add to this house is a vector;
# these are the web setup's name, and the radio refused
def pair_hotspot_checks()
    var ui = PanelUi(PanelStore(json.load(living_room_text)), v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    ui.wireless = FakeWireless({"zigbee": "mesh", "search": true,
                                "hotspot": {"kind": "web", "ssid": "nspanel-living", "password": "k7m3q9t2ab", "clients": 0, "state": "up", "reason": ""}})
    ui.zigbee = FakeZigbee({"mode": "mesh"})
    ui.stack = [{"view": ["house"], "page": 0}]
    ui.act(["zigbeeAdd"])
    var d = ui.list_view(ui.top()["view"])
    checks += 1
    if d[0] != "Add to this house?" || d[2][0][2] != "The web setup closes to search for the nodes." || !deep_eq(ui.top()["view"], ["confirm", "pairHotspot"])
        failures += 1
        print("FAIL Add to this house, with the web setup up, asks first, by its name: " + json.dump(d))
    end
    var out = ui.act(d[2][1][5])
    var views = []
    for e: ui.stack
        views.push(e["view"][0])
    end
    checks += 1
    if !deep_eq(out, [["wifi", "stopHotspot"], ["zigbee", "discover"], ["show"]]) || !deep_eq(views, ["house", "zigbeePair"])
        failures += 1
        print("FAIL Continue closes it, for the search: " + json.dump([out, views]))
    end
    var said = [PanelUi.zigbee_pair_said("radio", "WifiManager"), PanelUi.zigbee_pair_said("radio", "Join"),
                PanelUi.zigbee_pair_said("radio", "Scan"), PanelUi.zigbee_pair_said("radio", nil)]
    checks += 1
    if !deep_eq(said, [["Wi-Fi Manager open", "try later"], ["Joining a network", "try again"], ["Searching networks", "try again"], ["Wi-Fi busy", "try again"]])
        failures += 1
        print("FAIL the radio refused says who has it: " + json.dump(said))
    end
end
pair_hotspot_checks()

# The factory reset: this panel's, asked first, with a bridge of the house or not; a bridge's is on its page in the house
def factory_menu_checks()
    var ui = PanelUi(PanelStore(json.load(living_room_text)), v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    var row_of = def (view, label)
        for r: ui.list_view(view)[2] if r[2] == label return r end end
        return nil
    end
    ui.zigbee = FakeZigbee({"mode": "mesh"})
    var lone = row_of(["settings"], "Factory reset")
    ui.zigbee.set({"peer": {"mac": "B0:B0:B0:00:00:01", "name": "zbbridge-living", "id": 6}})
    var one = row_of(["settings"], "Factory reset")
    checks += 1
    if lone == nil || !deep_eq(lone[5], ["open", "confirm", "factoryReset"]) || !deep_eq(one[5], ["open", "confirm", "factoryReset"]) || lone[4] != 2
        failures += 1
        print("FAIL Factory reset asks for this panel's at once, with a bridge of the house or not, in the colour of what destroys: " + json.dump([lone, one]))
    end
end
factory_menu_checks()

# A web password held off on the Info: asked first, behind a
# recent pattern, and it goes at once; a bridge's is on its page in the house
def password_checks()
    var ui = PanelUi(PanelStore(json.load(living_room_text)), v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    ui.zigbee = FakeZigbee({"mode": "mesh"})
    checks += 1
    if !PanelUi.sensitive(["open", "confirm", "webPasswordRemove"])
        failures += 1
        print("FAIL removing a password opens the panel: asked through a recent pattern")
    end
    var views = def ()
        var out = []
        for e: ui.stack out.push(e["view"][0]) end
        return out
    end
    ui.stack = [{"view": ["settings"], "page": 0}, {"view": ["panelInfo"], "page": 0}, {"view": ["confirm", "webPasswordRemove"], "page": 0}]
    var title = ui.list_view(["confirm", "webPasswordRemove"])[0]
    var out = ui.act(["do", "webPasswordRemove"])
    checks += 1
    if title != "Remove the web password?" || !deep_eq(out, [["webPasswordRemove"], ["show"]]) || !deep_eq(views(), ["settings", "panelInfo"])
        failures += 1
        print("FAIL the panel's: asked, removed by the brain, and back on the Info: " + json.dump([title, out, views()]))
    end
end
password_checks()

# A Remove of a device with no power: behind an open relay the leave does not reach it, the network still has it, and the next
# seed brings it back as a new device. The confirmation says so, once, and a list of what was removed is not kept
def remove_checks()
    var ui = PanelUi(PanelStore(json.load(living_room_text)), v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    var LAMP = "0x00124B0000E00001"
    var dialog = def () return ui.list_view(["confirm", "removeDevice", LAMP]) end
    var d = dialog()
    checks += 1
    if d[0] != "Remove Middle 1?" || d[2][0][2] != "It leaves the network."
        failures += 1
        print("FAIL a Remove of a lamp with power: it leaves the network: " + json.dump(d))
    end
    # relay 2 feeds the Living room's lamps, and is open
    ui.relay_on[1] = false
    d = dialog()
    checks += 1
    if d[0] != "Remove Middle 1?" || string.find(d[2][0][2], "no power") < 0 || string.find(d[2][0][2], "come back") < 0
        failures += 1
        print("FAIL a Remove of a lamp behind an open relay says it may come back: " + json.dump(d))
    end
    checks += 1
    if !deep_eq(d[2][1][5], ["do", "removeDevice", LAMP])
        failures += 1
        print("FAIL and it is still removed, when asked: " + json.dump(d[2]))
    end
    # a relay device is no network device: its sentence is its own
    ui.relay_on[0] = false
    d = ui.list_view(["confirm", "removeDevice", "relay:1"])
    checks += 1
    if d[2][0][2] != "The relay stays as it is."
        failures += 1
        print("FAIL a relay device stays as it is, open or not: " + json.dump(d))
    end
    # a device of a bridge of the house: off this panel only, or off the house, its bridge's network and every panel
    ui.relay_on[0] = true
    ui.relay_on[1] = true
    ui.store.set_owner(LAMP, 3)
    var labels = []
    for row: ui.remove_rows(LAMP) labels.push([row[2], row[5]]) end
    checks += 1
    if !deep_eq(labels, [["Remove from this panel", ["open", "confirm", "removeDevice", LAMP]], ["Remove from the house", ["open", "confirm", "removeHouse", LAMP]]])
        failures += 1
        print("FAIL a device of a bridge of the house leaves this panel, or the house: " + json.dump(labels))
    end
    d = dialog()
    checks += 1
    if d[2][0][2] != "It stays in the house."
        failures += 1
        print("FAIL off this panel only, it stays in the house: " + json.dump(d))
    end
    d = ui.list_view(["confirm", "removeHouse", LAMP])
    checks += 1
    if d[0] != "Remove Middle 1 from the house?" || d[2][0][2] != "It leaves its bridge, and every panel." || !deep_eq(d[2][1][5], ["do", "removeHouse", LAMP])
        failures += 1
        print("FAIL off the house, said so: " + json.dump(d))
    end
    ui.open(["deviceOptions", LAMP])
    ui.open(["confirm", "removeHouse", LAMP])
    var out = ui.act(["do", "removeHouse", LAMP])
    var leave = nil
    for e: out if e[0] == "leaveAt" leave = e end end
    checks += 1
    if ui.store.find_device(LAMP) != nil || !deep_eq(leave, ["leaveAt", LAMP, 3])
        failures += 1
        print("FAIL removed from the house: off this panel, and its bridge told by its number: " + json.dump(out))
    end
    # one another panel removed: off this one too, with no leave
    var ui2 = PanelUi(PanelStore(json.load(living_room_text)), v["shape"], / -> v["items"], json.load(json.dump(v["prefs"])))
    ui2.store.set_owner(LAMP, 3)
    var gone = ui2.device_gone(LAMP)
    checks += 1
    if ui2.store.find_device(LAMP) != nil || !deep_eq(gone, [["save"], ["show"]]) || ui2.device_gone(LAMP) != []
        failures += 1
        print("FAIL a device the house removed leaves this panel, once: " + json.dump(gone))
    end
end
remove_checks()

if failures == 0
    print("ok - " + str(checks) + " steps")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
