# berry/panel_house_view.be: the house as the glass shows it: the row of the Wireless settings, the nodes of the house with their state, a node's page and its
# removal from the house with its question, the panel that leaves the house with its bridge or without it, the last panel that takes the bridges along and the panel that joins
# another house, the change of the key that is not closed and its end, a panel that founds a house, and the house's page: its icons, its title and the name's keyboard.
# The house layer is a fake that does what it is told and says it did; the real one is held to its own tests (test_house_mesh.be, house-key.test.mjs).

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
             "listRows": 6, "zoneRows": 2, "counters": 3, "helpLines": 5}

class FakeKey
    var pend, wait, finished
    def init() self.pend = nil self.wait = [] self.finished = 0 end
    def waiting() return self.wait end
    def finish()
        if self.pend == nil return false end
        self.pend = nil
        self.finished += 1
        return true
    end
end

class FakeHouse
    def neighbors() import global return global.contains("espnow_mesh_neighbors") ? global.espnow_mesh_neighbors() : [] end
    # how a node is heard (house_mesh.be, heard_by): its own entry, not silent, or the one of the neighbour the test says it is heard by (vias)
    var vias
    def fresh(x) var b = x.find("beat") return b == nil || (b >= 0 && b < 15000) end
    var far_of
    # how a node says it is tied to the mesh, by its presence (house_mesh.be, tie_of): the test's
    var ties
    def tie_of(id) return self.ties != nil ? self.ties.find(id) : nil end
    # the neighbours heard in their safeboot image (house_mesh.be, safeboot_of): the test's
    var safeboot
    def safeboot_of(id) return self.safeboot != nil ? self.safeboot.find(id) : nil end
    # this panel's own (house_mesh.be, tie): the nodes not silent it hears, the best signal of them, and the test's Wi-Fi (off unless it says)
    var wifi_sig
    def tie()
        var n = 0
        var best = 0
        for x: self.neighbors()
            if !isinstance(x, map) || x.find("state", 2) == 2 continue end
            n += 1
            var r = x.find("rssi", 0)
            if r != 0 && (best == 0 || r > best)  best = r end
        end
        return [n, best, self.wifi_sig != nil ? self.wifi_sig : 0]
    end
    def heard_by(id)
        var own = nil
        for n: self.neighbors()
            if isinstance(n, map) && n.find("id") == id  own = n end
        end
        if own != nil && own.find("state", 2) != 2 && self.fresh(own) return own end
        if self.far_of != nil && self.far_of.contains(id) return self.far_of[id] end
        var v = self.vias != nil ? self.vias.find(id) : nil
        for n: self.neighbors()
            if v != nil && isinstance(n, map) && n.find("id") == v return n end
        end
        return own
    end
    var up, list, key, can, struck, founded, own
    def own_house() return self.own == true end
    def init(l) self.up = true self.list = l self.key = FakeKey() self.can = true self.struck = [] self.founded = [] self.channel = HouseChannel(self) self.remote = {} self.view_asked = [] end
    # what each node said it runs (house_mesh.be, ask_info), and the nodes asked
    # another node's screens as they came (house_mesh.be, ask_view), and the words asking for them
    var remote, view_asked
    var view_x
    def ask_view(id, view, k, x) self.view_asked.push([id, view, k]) self.view_x = x return true end
    # the house's channel (house_channel.be): its part, with no driver (its radio is what a test gives it), the list's field, and what set_channel was given
    var channel, moved
    # the nodes this panel added, by the millis it did (house_mesh.be): the screens say they are starting until they are heard
    var added
    def channel_setting()
        var f = self.list.field(HouseList.K_CHANNEL, 0)
        return f != nil ? HouseList.channel_of(f[2]) : nil
    end
    # the nodes told to join another house (house_mesh.be, move)
    var moved_nodes
    def move(id)
        if self.moved_nodes == nil self.moved_nodes = [] end
        self.moved_nodes.push(id)
        return true
    end
    def set_channel(c, d)
        if self.moved == nil self.moved = [] end
        self.moved.push([c, d])
        self.list.author(HouseList.K_CHANNEL, 0, HouseList.channel_bytes(c, nil))
        return true
    end
    def writes() return self.can end
    var numbers
    def found(name, id)
        self.founded.push(name)
        if self.numbers == nil self.numbers = [] end
        if id != nil self.numbers.push(id) end
        return true
    end
    def remove(id)
        self.struck.push(id)
        self.list.author(HouseList.K_REVOKE, id, bytes())
        return true
    end
    var left
    def leave_house(bridge)
        if self.left == nil self.left = [] end
        self.left.push(bridge)
        return true
    end
    def bridges()
        var out = []
        for id: self.list.ids(false)
            if id != self.list.me && self.list.role(id) == HouseList.ROLE_BRIDGE out.push(id) end
        end
        return out
    end
    def set_house_name(n)
        self.list.author(HouseList.K_NAME, 0, bytes().fromstring(n))
        return true
    end
    def rename(id, n)
        self.list.author(HouseList.K_NAME, id, bytes().fromstring(n))
        return true
    end
    var role, fav
    def favorite() return self.fav != nil ? self.fav : 6 end
    def set_favorite(id)
        if self.list.role(id) != HouseList.ROLE_BRIDGE return false end
        self.fav = id
        return true
    end
    # the house's server (house_mesh.be, add_server, server, revoke), on the list as the house writes it
    var revoked
    def add_server(key, ip, port, name)
        var id = self.list.next_id()
        var d = bytes()
        d.add(HouseList.ROLE_SERVER, 1)
        d .. key
        d .. bytes("000000000000")
        self.list.author(HouseList.K_IDENT, id, d)
        self.list.author(HouseList.K_ADDR, id, ip)
        var p = bytes()
        p.add(port, -2)
        self.list.author(HouseList.K_PORT, id, p)
        self.list.author(HouseList.K_NAME, id, bytes().fromstring(name))
        return id
    end
    def server()
        for id: self.list.servers()
            var n = self.list.node(id)
            return {"id": id, "host": str(n["ip"][0]) + "." + str(n["ip"][1]) + "." + str(n["ip"][2]) + "." + str(n["ip"][3]), "port": n["port"], "name": n["name"]}
        end
        return nil
    end
    def revoke(id)
        if self.revoked == nil self.revoked = [] end
        self.revoked.push(id)
        self.list.author(HouseList.K_REVOKE, id, bytes())
        return true
    end
    # this panel's own node screens, as the boot wires them (panel_boot.be): answered by the view, the effects kept
    var view_fn, on_view
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

# the house: the panel 4 (this one), the panel 5, the bridges 6 (Kitchen) and 7
def house_list(with_nodes)
    var l = HouseList(4)
    if !with_nodes return l end
    for n: [4, 5, 6, 7]
        var d = bytes()
        d.add(n <= 5 ? HouseList.ROLE_PANEL : HouseList.ROLE_BRIDGE, 1)
        d .. key_of(n)
        d .. mac_of(n)
        l.author(HouseList.K_IDENT, n, d)
    end
    l.author(HouseList.K_NAME, 6, bytes().fromstring("Kitchen"))
    l.author(HouseList.K_NAME, 0, bytes().fromstring("Sample House"))
    return l
end

def fixture(with_nodes, editing)
    var f = {}
    global.house = FakeHouse(house_list(with_nodes))
    global.house.role = HouseList.ROLE_PANEL
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0}, {"id": 5, "state": 2}] end
    f["store"] = PanelStore(json.load(living_room_text))
    var ui = PanelUi(f["store"], shape, / -> [], nil)
    f["ui"] = ui
    f["pv"] = PanelHouseView(ui)
    ui.providers.push(f["pv"])
    ui.now_fn = / -> 0
    ui.prefs["editing"] = editing
    return f
end

def rows(ui)
    var out = []
    for r: ui.list_view(ui.top()["view"])[2]  out.push([r[2], r[3], r[5] != nil]) end
    return out
end

# the screen of a house, opened, as the rows say it
def ui_rows(ui, fresh)
    ui.open(["house"])
    var r = rows(ui)
    ui.back()
    return r
end

def section_summary()
    var f = fixture(true, false)
    var pv = f["pv"]
    check("the row of the Wireless settings says the house's name", pv.summary(), "Sample House")
    global.house.key.pend = {"v": 2}
    check("or that a change of the key is open", pv.summary(), "Key change")
    global.house.key.pend = nil
    global.house.list = house_list(false)
    check("a mesh with a node and no house: not set up", pv.summary(), "Not set up")
    global.house.up = false
    check("a node with no number and no driver in the image: none", pv.summary(), "No mesh")
    global.espnow_mesh_send = / -> false
    check("with the driver in the image it is a node that has no house yet", pv.summary(), "Not set up")
    check("and its screen shows the panel itself, by its role and the end of its radio address, with how it hears the mesh, its row opening its page",
          [ui_rows(f["ui"], true)], [[["Panel 5D02E9 *", "Mesh Heard(1), Wi-Fi no", true]]])
    global.espnow_mesh_send = nil
    global.house.up = true
    global.house = nil
    check("an image without the layer: none", pv.summary(), "No mesh")
    var ui = f["ui"]
    ui.open(["house"])
    check("and the screen says so", rows(ui), [["No mesh", "", false]])
end

def section_nodes()
    var f = fixture(true, false)
    var ui = f["ui"]
    ui.open(["house"])
    check("the mesh's settings first, on a layout with no house's page, then the nodes: this panel and how many it hears, another, the bridges, as the mesh hears them",
          rows(ui), [["", "", true], ["Panel 000004 *", "Mesh Heard(1), Wi-Fi no", true], ["Panel 000005", "No signal", true], ["Kitchen", "Heard", true], ["Bridge 000007", "No signal", true]])
    check("the mesh's settings are its cog alone, not a word", ui.list_view(ui.top()["view"])[2][0][0 .. 1], ["settings", PanelHouseView.TONE])
    check("the mesh's screen is titled so: the house's name is its page's title, and the mesh is ESP-NOW's", ui.list_view(ui.top()["view"])[0], "ESP-NOW Mesh")
    # how a node is heard: the signal here, in a word, and how many nodes it hears
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "rssi": -60, "hears": 3}, {"id": 5, "state": 0, "rssi": -80, "hears": 1},
                                                 {"id": 7, "state": 0, "rssi": -90, "hears": 2}] end
    global.house.wifi_sig = -58
    check("strong, weak and poor, each with its links; this panel's own Wi-Fi, and none said of the others'", [rows(ui)[1][1], rows(ui)[2][1], rows(ui)[3][1], rows(ui)[4][1]],
          ["Mesh -60dBm(3), Wi-Fi -58dBm", "Mesh -80dBm(1)", "Mesh -60dBm(3)", "Mesh -90dBm(2)"])
    # on the mesh's own page: the Wi-Fi at the right of the name, the mesh under it, each in the colour of its signal, and the colours written only
    # where a row has one, or had one
    ui.shape["pages"]["mesh"] = "mesh"
    ui.shape["meshRows"] = 6
    global.house.wifi_sig = -58
    var mr = ui.list_view(ui.top()["view"])[2]
    check("on the mesh's page: this panel's Wi-Fi at the right of its name, in its colour, and the mesh's under it, in its",
          [mr[0][2], mr[0][3], mr[0][7], mr[0][8], mr[0][9]], ["Panel 000004 *", "Mesh -60dBm(3)", "signal-good", "Wi-Fi -58dBm", "signal-good"])
    check("a fair signal yellow, a poor one red, and no Wi-Fi said, no tail", [mr[1][3], mr[1][7], mr[3][3], mr[3][7], mr[1][8]],
          ["Mesh -80dBm(1)", "signal-fair", "Mesh -90dBm(2)", "signal-poor", ""])
    var drawn = ui.show()
    var said = {}
    for e: drawn  if e[0] == "set"  said[e[1]] = e[2] end end
    check("drawn: each colour of its own written", [said.find("$list.rows.0.hintColor"), said.find("$list.rows.0.tailColor"), said.find("$list.rows.0.tail"),
          said.find("$list.rows.1.hintColor"), said.contains("$list.rows.1.tailColor")], ["signal-good", "signal-good", "Wi-Fi -58dBm", "signal-fair", false])
    global.espnow_mesh_neighbors = def () return [] end
    global.house.wifi_sig = nil
    drawn = ui.show()
    said = {}
    for e: drawn  if e[0] == "set"  said[e[1]] = e[2] end end
    check("and the theme's quiet colour written back once where a row had one", [said.find("$list.rows.0.tailColor"), said.find("$list.rows.1.hintColor")],
          ["text-secondary", "signal-poor"])
    drawn = ui.show()
    said = {}
    for e: drawn  if e[0] == "set"  said[e[1]] = e[2] end end
    check("and not again", said.contains("$list.rows.0.tailColor"), false)
    ui.shape["pages"].remove("mesh")
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "rssi": -60, "hears": 3}, {"id": 5, "state": 0, "rssi": -80, "hears": 1},
                                                 {"id": 7, "state": 0, "rssi": -90, "hears": 2}] end
    global.house.wifi_sig = nil
    check("and good, a Wi-Fi with no signal said, and one off", [PanelHouseView.tie_word([4, -70, -80]), PanelHouseView.tie_word([4, -70, 1]), PanelHouseView.tie_word([4, -70, 0])],
          ["Mesh -70dBm(4), Wi-Fi -80dBm", "Mesh -70dBm(4), Wi-Fi yes", "Mesh -70dBm(4), Wi-Fi no"])
    check("the bands: green from -67 dBm, yellow down to -80, red below", [NodeWireless.tone(-67), NodeWireless.tone(-68), NodeWireless.tone(-80), NodeWireless.tone(-81),
          NodeWireless.tone(0)], [1, 2, 2, 3, 0])
    check("a node that hears none on the radio, or hears some with no signal said", [PanelHouseView.tie_word([0, 0, -60]), PanelHouseView.tie_word([2, 0, 0])],
          ["Mesh None(0), Wi-Fi -60dBm", "Mesh Heard(2), Wi-Fi no"])
    var on_ap = bytes(-32)
    on_ap[29] = 11
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "rssi": -60, "hears": 3, "info": on_ap.tohex()}] end
    check("a neighbour whose presence does not say it: whether it is on the Wi-Fi, by its heartbeat's radio", rows(ui)[3], ["Kitchen", "Mesh -60dBm(3), Wi-Fi yes", true])
    # how well a node is tied to the mesh, as its presence says it, and never the way to it ("Via" said the path, not the strength)
    global.house.ties = {6: [5, -55, -72]}
    check("a neighbour that says how it is tied: its best link and its links, not how this panel hears it, and its Wi-Fi", rows(ui)[3], ["Kitchen", "Mesh -55dBm(5), Wi-Fi -72dBm", true])
    # a node in its safeboot image, as the OTA driver hears its beacon: what it is doing there, and not the mesh it has not
    global.house.safeboot = {6: [1, 15, 31]}
    check("a node taking an image in its safeboot image: how far, by its blocks", rows(ui)[3], ["Kitchen", "Safeboot 48%", true])
    global.house.safeboot = {6: [0, 0, 0], 7: [4, 3, 31]}
    check("one waiting there, and one whose image failed", [rows(ui)[3], rows(ui)[4]], [["Kitchen", "Safeboot", true], ["Bridge 000007", "Safeboot, failed", true]])
    check("in a fair signal's colour, and the failure in a poor one's; written whole, at 100% at most",
          [PanelHouseView.safeboot_parts([1, 15, 31])[1], PanelHouseView.safeboot_parts([4, 0, 0])[1], PanelHouseView.safeboot_parts([3, 31, 31])[0],
           PanelHouseView.safeboot_parts([1, 40, 31])[0], PanelHouseView.safeboot_parts([1, 0, 0])[0]],
          ["signal-fair", "signal-poor", "Safeboot 100%", "Safeboot 100%", "Safeboot 0%"])
    global.house.safeboot = nil
    global.house.ties = nil
    # two hops away: heard, never "No signal", and never the neighbour it is heard by
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "rssi": -60, "hears": 3}] end
    global.house.vias = {7: 6}
    check("a node two hops away that does not say how it is tied: heard, not via its neighbour", rows(ui)[4], ["Bridge 000007", "Heard", true])
    global.house.ties = {7: [2, -78, 0]}
    check("and that says it: its best link and its links, off the Wi-Fi", rows(ui)[4], ["Bridge 000007", "Mesh -78dBm(2), Wi-Fi no", true])
    global.house.ties = nil
    global.house.vias = nil
    # three hops away or more, by its presence
    global.house.far_of = {7: {"id": 7, "state": 0, "beat": 4000, "far": true}}
    check("a node three hops away: heard", rows(ui)[4], ["Bridge 000007", "Heard", true])
    global.house.ties = {7: [3, -70, 1]}
    check("and how it is tied, as it says it", rows(ui)[4], ["Bridge 000007", "Mesh -70dBm(3), Wi-Fi yes", true])
    global.house.ties = nil
    global.house.far_of = nil
    # a neighbour kept alive by the others, whose heartbeats stopped: heard, and no word of its old signal
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "rssi": -60, "hears": 3, "beat": 40000}] end
    check("a neighbour whose heartbeats stopped, alive by the others: Heard", rows(ui)[3], ["Kitchen", "Heard", true])
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "rssi": 0, "hears": 2}] end
    check("a neighbour heard by the network alone, with no signal, is heard", rows(ui)[3], ["Kitchen", "Heard", true])
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0}, {"id": 5, "state": 2}] end
    ui.list_row(0, 0, false)
    check("the settings: the house's channel", [ui.top()["view"], ui.list_view(ui.top()["view"])[0], rows(ui)], [["houseSettings"], "Mesh settings", [["Channel", "None", true]]])
    ui.back()
    ui.list_row(3, 0, false)
    check("a node's page: its Main settings and its Wireless settings, as this panel's, and for a bridge whether it is the favourite; nothing to do without Editing",
          [ui.top()["view"], rows(ui)], [["houseNode", 6], [["Main settings", "", true], ["Wireless settings", "", true], ["Favorite", "Yes", false]]])
    ui.back()
    ui.prefs["editing"] = true
    check("with Editing on, the + of the title adds a node", ui.list_view(ui.top()["view"])[1], "add")
    ui.list_row(4, 0, false)
    check("a bridge's page with Editing on: its two settings, the favourite, then Join another house and Remove from house, in the colour of what changes much", rows(ui),
          [["Main settings", "", true], ["Wireless settings", "", true], ["Favorite", "No", true], ["Join another house", "", true], ["Remove from house", "", true]])
    ui.back()
    ui.list_row(2, 0, false)
    check("another panel's page: Join another house and Remove from house", rows(ui)[-2 ..], [["Join another house", "", true], ["Remove from house", "", true]])
    ui.back()
    ui.list_row(1, 0, false)
    check("this panel's page: Join another house, and, in another's house, Leave this house", rows(ui)[-2 ..], [["Join another house", "", true], ["Leave this house", "", true]])
    global.house.own = true
    check("in its own house, Join another house alone", [rows(ui)[-1], size(rows(ui))], [["Join another house", "", true], 3])
    global.house.own = nil
    ui.back()
    global.house.can = false
    check("a panel that does not write adds nobody, and has no +", ui.list_view(ui.top()["view"])[1], "")
    ui.list_row(3, 0, false)
    check("nor joins another node to another house or removes it", rows(ui)[-1], ["Favorite", "Yes", false])
    ui.back()
    ui.list_row(1, 0, false)
    check("and can still take itself to another house", rows(ui)[-2 ..], [["Join another house", "", true], ["Leave this house", "", true]])
    ui.back()
    global.house.can = true
end

# a bridge's web password and its factory reset, over the mesh
def section_admin()
    import persist
    var f = fixture(true, true)
    var ui = f["ui"]
    var pv = f["pv"]
    persist.remove(PanelHouseView.WEBPW)
    var kept = tasmota.timers
    tasmota.timers = TimerBook(tasmota)
    ui.open(["houseWebpw", 7])
    check("its web password: none yet, and Generate", rows(ui), [["Password", "None", false], ["Generate", "", true]])
    var out = ui.list_row(1, 0, false)
    var said = out[0]
    var m = json.load(said[2][13 ..])
    check("Generate sends the word to the bridge by its number, with a password drawn here", [said[0], said[1], said[2][0 .. 12], m["do"], size(m["pw"]), size(m["n"])],
          ["sendAt", 7, "ZbRelayAdmin ", "lock", PanelHouseView.PW_LEN, PanelHouseView.PW_LEN])
    check("and the screen says it asks", rows(ui)[0], ["Asking", "", false])
    pv.answered({"did": "lock", "n": "other"})
    check("an answer to another word changes nothing", [pv.asked[7]["state"], PanelHouseView.password_of(7)], ["asking", nil])
    pv.answered({"did": "lock", "n": m["n"]})
    check("the bridge's answer: the password kept here, by its number, and shown", [PanelHouseView.password_of(7), rows(ui)], [m["pw"], [["Password", m["pw"], false], ["Generate another", "", true], ["Remove", "", true]]])
    out = ui.list_row(2, 0, false)
    var n2 = json.load(out[0][2][13 ..])["n"]
    tasmota.timers.advance(PanelHouseView.ADMIN_MS + 10)
    check("no answer in time says so, and keeps the password", [rows(ui)[0], PanelHouseView.password_of(7)], [["No answer", "", false], m["pw"]])
    out = ui.list_row(3, 0, false)
    pv.answered({"did": "unlock", "n": json.load(out[0][2][13 ..])["n"]})
    check("a removal answered forgets it", PanelHouseView.password_of(7), nil)
    # the house forgets a bridge (house_mesh.be, sweep()): the password drawn for it goes from the flash, and the word waited from it
    PanelHouseView.keep_password(7, "abc")
    PanelHouseView.keep_password(6, "def")
    pv.asked[7] = {"state": "asking"}
    pv.sweep({4: true, 5: true, 6: true})
    check("a bridge the house forgot: its web password and the word waited from it go, and another's stays",
          [PanelHouseView.password_of(7), PanelHouseView.password_of(6), pv.asked.contains(7)], [nil, "def", false])
    # not with Editing off
    var g = fixture(true, false)
    g["ui"].open(["houseWebpw", 7])
    var drawn = []
    for x: rows(g["ui"])  drawn.push(x[0]) end
    check("with Editing off the web password's screen draws none", drawn.find("Generate"), nil)
    check("and a touch that would send a word does nothing", g["pv"].act(g["ui"], ["house", "admin", 7, "lock"]), [])
    tasmota.timers = kept
end

def section_strike()
    var f = fixture(true, true)
    var ui = f["ui"]
    var kept = tasmota.timers
    tasmota.timers = TimerBook(tasmota)
    ui.open(["house"])
    # the bridge 7, under the mesh's settings, which are a row on a layout with no house's page; Remove from house under its two settings and the favourite
    ui.list_row(4, 0, false)
    ui.list_row(4, 0, false)
    check("the question first: a bridge removed goes back to its factory settings, its devices with it, and the way out", [ui.top()["view"], rows(ui)],
          [["houseStrike", 7], [["Back to its factory settings", "", false], ["Its Wi-Fi and Zigbee erased", "", false], ["Devices here", "0", false], ["Remove", "Bridge 000007", true], ["Cancel", "", true]]])
    ui.list_row(4, 0, false)
    check("Cancel leaves it as it was", [global.house.struck, ui.top()["view"]], [[], ["houseNode", 7]])
    ui.list_row(4, 0, false)
    var out = ui.list_row(3, 0, false)
    check("Remove sends the bridge the word of its factory reset, and the screens go back to the house", [out[0][0], out[0][1], json.load(out[0][2][13 ..])["do"], ui.top()["view"][0]],
          ["sendAt", 7, "factory", "house"])
    check("it is struck off when it says it goes, not before", global.house.struck, [])
    tasmota.timers.advance(PanelHouseView.ADMIN_MS + 10)
    check("and, saying nothing in time, it is struck off all the same", global.house.struck, [7])
    tasmota.timers = kept
    var labels = []
    for r: rows(ui)  labels.push(r[0]) end
    check("the house has the node no more", labels, ["", "Panel 000004 *", "Panel 000005", "Kitchen"])
    # a panel removed is told to leave, and struck off: no factory settings
    ui.open(["houseNode", 5])
    ui.open(["houseStrike", 5])
    check("a panel's question: it leaves, and the key changes", rows(ui)[0], ["It leaves, and the key changes", "", false])
    ui.list_row(1, 0, false)
    check("Remove strikes the panel off at once", global.house.struck, [7, 5])
    global.house.list = house_list(true)
    global.house.list.author(HouseList.K_REVOKE, 7, bytes())
    # the same bridge back under another number is one node on the screen (it read as a node twice)
    var d = bytes()
    d.add(HouseList.ROLE_BRIDGE, 1)
    d .. key_of(8)
    d .. mac_of(7)
    global.house.list.author(HouseList.K_IDENT, 8, d)
    labels = []
    for r: rows(ui)  labels.push(r[0]) end
    check("the bridge added again is there once, under its new number", labels, ["", "Panel 000004 *", "Panel 000005", "Kitchen", "Bridge 000007"])
    # Join another house: what it costs, and the word
    ui.open(["houseNode", 6])
    ui.open(["houseMove", 6])
    check("another node to another house asks first: a bridge keeps its Wi-Fi and its devices, which leave this house", [ui.list_view(ui.top()["view"])[0], rows(ui)],
          ["Join another house?", [["It leaves this house", "", false], ["Its Wi-Fi and devices stay on it", "", false], ["Devices here", "0", false],
                                   ["A panel of the other adds it", "", false], ["Join another house", "Kitchen", true], ["Cancel", "", true]]])
    ui.list_row(4, 0, false)
    check("and the word goes to it", [global.house.moved_nodes, ui.top()["view"][0]], [[6], "house"])
    # not with Editing off
    var g = fixture(true, false)
    g["ui"].open(["house"])
    check("with Editing off a touch that would strike a node off does nothing", [g["pv"].act(g["ui"], ["house", "strike", 7]), global.house.struck], [[], []])
end

# a panel leaves the house: alone, since no bridge is its own; the last panel takes the house's bridges along, told of the alarm's devices
class FakeAlarm
    var cfg
    def init(c) self.cfg = c end
end
class FakeNet
    var alarm
    def init(a) self.alarm = a end
end
def section_leave()
    var f = fixture(true, true)
    var ui = f["ui"]
    ui.network = FakeNet(FakeAlarm({"sensors": {"0x1": [1], "0x2": [1]}, "s": ["0x3"]}))
    ui.open(["houseLeave"])
    check("another panel is in the house: the panel leaves alone, and no bridge is asked about", rows(ui), [["It founds one of its own", "", false], ["Leave", "", true], ["Cancel", "", true]])
    # a warning when devices of this panel are in the house's alarm: they go from this panel
    var mine = nil
    for d: f["store"].doc["devices"]  if mine == nil && size(d[0]) > 2 && d[0][0 .. 1] == "0x"  mine = d[0] end end
    ui.network = FakeNet(FakeAlarm({"sensors": {mine: [1]}, "s": [], "pd": []}))
    ui.open(["houseLeave"])
    check("devices of this panel in the house's alarm: a warning before it leaves", rows(ui), [["It founds one of its own", "", false], ["In the alarm", "1 device", false], ["Leave", "", true], ["Cancel", "", true]])
    ui.network = FakeNet(FakeAlarm({"sensors": {}, "s": [mine], "pd": [[mine, "on"]]}))
    check("a siren or a device of the panic counts once", rows(ui)[1], ["In the alarm", "1 device", false])
    ui.network = FakeNet(FakeAlarm({"sensors": {"0x1": [1], "0x2": [1]}, "s": ["0x3"]}))
    # a choice taken
    ui.open(["house"])
    ui.open(["houseNode", 4])
    ui.open(["houseLeave"])
    ui.list_row(1, 0, false)
    check("Leave asks the house, and the screens go back", [global.house.left, ui.top()["view"][0]], [[0], "house"])
    # the last panel of the house takes the house's bridges along, since a house always has a panel, and the question says how many
    global.house.list.author(HouseList.K_REVOKE, 5, bytes())
    ui.network = nil
    ui.open(["houseLeave"])
    check("the last panel of the house is told so, and that the bridges go with it", rows(ui), [["It founds one of its own", "", false], ["The last panel", "", false], ["Leave with 2 bridges", "", true], ["Cancel", "", true]])
    ui.list_row(2, 0, false)
    check("and leaving asks the house to take every bridge", global.house.left, [0, -1])
    ui.network = FakeNet(FakeAlarm({"sensors": {"0x1": [1]}, "s": []}))
    ui.open(["houseLeave"])
    check("with the alarm's devices in the house, a warning says how many go with it", rows(ui)[2], ["In the alarm", "1 device", false])
    var g = fixture(true, false)
    check("with Editing off a touch that would leave does nothing", [g["pv"].act(g["ui"], ["house", "leave", 0]), global.house.left], [[], nil])
end

def section_key()
    var f = fixture(true, true)
    var ui = f["ui"]
    ui.open(["house"])
    check("with no change open the house has no row for it: the nodes start under the settings' row", rows(ui)[1][0], "Panel 000004 *")
    global.house.key.pend = {"v": 2}
    global.house.key.wait = [5, 7]
    ui.open(["house"])
    check("a change that is not closed is the first row under the settings', and says how many nodes are waited for", rows(ui)[1], ["Key change", "2 waiting", true])
    ui.list_row(1, 0, false)
    check("its page: the nodes waited for, and the way to end it", [ui.top()["view"], rows(ui)], [["houseKey"], [["Panel 000005", "Waiting", false], ["Bridge 000007", "Waiting", false], ["Finish key change", "", true]]])
    ui.list_row(2, 0, false)
    check("ending it asks first", [ui.top()["view"], rows(ui)], [["houseFinish"], [["The ones that did not answer stay as they are", "", false], ["Finish", "", true], ["Cancel", "", true]]])
    ui.list_row(1, 0, false)
    check("Finish ends the change, and the screens go back", [global.house.key.finished, global.house.key.pend, ui.top()["view"][0]], [1, nil, "house"])
    global.house.key.pend = {"v": 3}
    global.house.key.wait = []
    ui.open(["houseKey"])
    check("a change every node has taken says so", rows(ui)[0], ["Every node has it", "", false])
end

# the pairing's own screens for the house: the step while the welcome goes, and the word when a bridge or a panel was paired and did not come in
class FakeZb
    var st
    def init(st) self.st = st end
    def state() return self.st end
end

def zb_state(fields)
    var st = {"mode": "direct", "local_ok": false, "peer": nil, "link": false, "searching": false, "sweeping": false, "found": [], "asking": nil,
              "chosen": {"name": "Garage", "mac": "B0:B0:B0:00:00:01"}, "result": nil, "offer": nil, "wifi": nil, "taken": false, "peer_version": nil,
              "house": nil, "house_role": nil}
    for k: fields.keys() st[k] = fields[k] end
    return st
end

def section_found()
    var f = fixture(false, true)
    var ui = f["ui"]
    ui.open(["house"])
    check("a panel with no number is shown as itself, by its role and the end of its radio address, with how it hears the mesh",
          rows(ui), [["Panel 5D02E9 *", "Mesh Heard(1), Wi-Fi no", true]])
    ui.list_row(0, 0, false)
    check("its page: its role, its state, and with Editing on the way into a house", [ui.top()["view"], rows(ui)],
          [["houseNode", 0], [["Role", "Panel", false], ["State", "Mesh Heard(1), Wi-Fi no", false], ["Join a house", "", true]]])
    ui.list_row(2, 0, false)
    check("which opens its window, where a panel of the house adds it", ui.top()["view"], ["houseWindow"])
    ui.open(["house"])
    ui.zigbee = FakeZb(zb_state({"window": {"state": "open", "until": 0, "why": ""}}))
    check("and while it waits at its window for a house to take it, the row opens the window's screen", rows(ui), [["Joining a house", "", true]])
    ui.list_row(0, 0, false)
    check("which it does", ui.top()["view"], ["houseWindow"])
    check("nobody founds a house from here", global.house.founded, [])
end

def section_pairing()
    var f = fixture(true, true)
    var ui = f["ui"]
    ui.zigbee = FakeZb(zb_state({"asking": "house", "house_role": "give"}))
    check("while the welcome goes, this panel says it adds the node", ui.list_view(["zigbeePairBlink"])[0], "Adding Garage to the house")
    # added, and in the house: back to the house's screen, where the adding started
    ui.zigbee = FakeZb(zb_state({"asking": "hello"}))
    ui.stack = []
    ui.open(["house"])
    ui.open(["zigbeePair"])
    ui.open(["zigbeePairBlink"])
    ui.zigbee = FakeZb(zb_state({"result": "paired", "house": "in"}))
    ui.zigbee_changed()
    check("a node added and in the house goes back to the house, where it started", ui.top()["view"][0], "house")
    # added, and not in the house: it says why first
    ui.open(["zigbeePair"])
    ui.open(["zigbeePairBlink"])
    ui.zigbee = FakeZb(zb_state({"result": "paired", "house": "silent"}))
    ui.zigbee_changed()
    check("a node that did not come into the house says so", [ui.top()["view"][0], rows(ui)], ["houseResult", [["Not added to the house", "", false], ["It did not answer in time.", "", false], ["Done", "", true]]])
    ui.back()
    check("and Done goes back to the house", ui.top()["view"][0], "house")
    var said = []
    for why: ["silent", "refused", "already", "full", "nokey", "nobody", "none"]
        ui.zigbee = FakeZb(zb_state({"house": why}))
        said.push(ui.list_view(["houseResult"])[2][1][2])
    end
    check("each reason in a line", said, ["It did not answer in time.", "It did not take what was given.", "It is in a house already.", "The house has no number left.",
          "This panel does not hold the house's key.", "No panel of the house answered.", "It cannot join a house."])
end

# Add to this house: every pairing is entering the house, a guest's exchange; the nodes with a window, a panel said so
def window(guest)
    return {"id": 1, "mac": "B0:B0:B0:00:00:02", "name": "Bedroom", "rssi": -50, "channel": 6, "version": 2, "network": true, "busy": false, "zigbee": 15, "guest": guest, "display": false}
end

def section_guest()
    var f = fixture(true, true)
    var ui = f["ui"]
    ui.zigbee = FakeZb(zb_state({}))
    var adds = / -> ui.list_view(["house"])[1] == "add"
    check("a panel that is in the house and writes has, on the mesh's title, the + that adds a node to it", adds(), true)
    ui.stack = []
    ui.open(["house"])
    var plus = ui.action()
    var searches = false
    for e: plus  if e[0] == "zigbee" && e[1] == "discover"  searches = true end end
    check("the + is the search", [searches, ui.top()["view"][0]], [true, "zigbeePair"])
    ui.stack = []
    global.house.can = false
    check("a panel that does not write has none", adds(), false)
    global.house.can = true
    global.house.up = false
    check("nor one whose mesh is not up", adds(), false)
    global.house.up = true
    global.house = nil
    check("nor an image with no house layer", adds(), false)
    global.house = FakeHouse(house_list(true))
    # the verb: the search
    var out = ui.act(["zigbeeAdd"])
    var discover = false
    for e: out  if e[0] == "zigbee" && e[1] == "discover"  discover = true end end
    check("Add to this house searches", [discover, ui.top()["view"][0]], [true, "zigbeePair"])
    var panel = window(true)
    panel["id"] = 3
    panel["name"] = "Den panel bedroom"
    panel["display"] = true
    ui.zigbee = FakeZb(zb_state({"found": [window(true), {"id": 2, "mac": "B0:B0:B0:00:00:03", "name": "Old", "rssi": -60, "channel": 6, "version": 2, "network": true, "busy": false, "zigbee": 15, "guest": false}, panel]}))
    var rows = []
    for r: ui.list_view(["zigbeePair"])[2] rows.push([r[2], r[3], r[5] != nil]) end
    check("the search is titled for the house, a window that takes no guest is not tappable and says to update it, and a panel says so",
          [ui.list_view(["zigbeePair"])[0], rows[-4], rows[-3], rows[-2]], ["Add to this house", ["Bedroom", "nearest", true], ["Old", "update it", false], ["Den panel bedroom", "panel", true]])
    check("and under the nodes the house's server, by a code", rows[-1], ["Add server", "by a code", true])
    var picked = ui.act(["zigbeePairWith", 1])
    var blinks = false
    for e: picked if e[0] == "zigbee" && e[1] == "blink" blinks = true end end
    check("a node picked is asked to identify itself, with nothing to forget", blinks, true)
    # a panel's question is its screen's, a bridge's its light's
    ui.zigbee = FakeZb(zb_state({"asking": "blinking", "chosen": panel}))
    check("a panel picked: does its screen show it", ui.list_view(["zigbeePairBlink"])[0], "Does Den panel bedroom show it?")
    ui.zigbee = FakeZb(zb_state({"asking": "blinking", "chosen": window(true)}))
    check("a bridge picked: is it blinking", ui.list_view(["zigbeePairBlink"])[0], "Is Bedroom blinking?")
end

# Join another house: the leave, said so; the panel then waits to be added by a panel of the other house
def section_join()
    var f = fixture(true, true)
    var ui = f["ui"]
    ui.network = FakeNet(FakeAlarm({"sensors": {}, "s": []}))
    ui.zigbee = FakeZb(zb_state({}))
    # no bridge is a panel's own: no node's page says one
    ui.open(["houseNode", 4])
    var said = []
    for r: rows(ui)  said.push(r[0]) end
    check("this panel's page says no bridge of its own", said.find("Direct bridge"), nil)
    ui.stack = []
    ui.open(["house"])
    ui.open(["houseNode", 4])
    ui.list_row(size(rows(ui)) - 1, 0, false)
    check("in another's house, Leave this house asks first, titled back to its own", [ui.top()["view"], ui.list_view(ui.top()["view"])[0], rows(ui)],
          [["houseLeave"], "Back to its own house?", [["It founds one of its own", "", false], ["Leave", "", true], ["Cancel", "", true]]])
    var out = ui.list_row(1, 0, false)
    var asked = false
    for e: out if e[0] == "zigbee" && e[1] == "window" asked = true end end
    check("the panel leaves alone, and opens no window: it founds its own house by itself", [global.house.left, asked], [[0], false])
    # in its own house: Join another house, the leave and then this panel's window
    global.house.own = true
    ui.stack = []
    ui.open(["house"])
    ui.open(["houseNode", 4])
    ui.list_row(size(rows(ui)) - 1, 0, false)
    check("in its own house, Join another house asks first, titled for it, and says where it goes", [ui.top()["view"], ui.list_view(ui.top()["view"])[0], rows(ui)[0]],
          [["houseLeave", "join"], "Join another house?", ["A panel of the other adds it", "", false]])
    out = ui.list_row(1, 0, false)
    asked = false
    for e: out if e[0] == "zigbee" && e[1] == "window" asked = true end end
    check("the panel leaves, its own window is asked for, and its screen is the window's",
          [global.house.left, asked, ui.top()["view"][0]], [[0, 0], true, "houseWindow"])
end

# Another node's screens, as the node draws them, asked of it over the mesh, and this panel's own from its page
def section_remote()
    var f = fixture(true, false)
    var ui = f["ui"]
    var h = global.house
    var kept = tasmota.timers
    tasmota.timers = TimerBook(tasmota)
    ui.open(["house"])
    ui.list_row(1, 0, false)
    ui.list_row(0, 0, false)
    check("this panel's page: its Main settings are its own", ui.top()["view"], ["settings"])
    ui.back()
    ui.list_row(1, 0, false)
    check("and so are its Wireless settings", ui.top()["view"], ["wireless"])
    ui.back()
    ui.back()
    # the bridge 7: its Main settings are asked of it
    ui.list_row(4, 0, false)
    ui.list_row(0, 0, false)
    check("another node's Main settings are asked of it over the mesh, and the screen says it asks", [h.view_asked, ui.top()["view"], rows(ui)],
          [[[7, ["settings"], nil]], ["houseRemote", 7, '["settings"]'], [["Asking", "", false]]])
    h.remote[7] = [tasmota.millis(), ["settings"], "Main settings", [["Zigbee channel", "11", 0, 0], ["Info", "", 1, 0, ["info"]], ["Restart", "", 2, 2]], false]
    check("its answer, row for row, the restart in the colour of what changes much", [ui.list_view(ui.top()["view"])[0], rows(ui), ui.list_view(ui.top()["view"])[2][2][4]],
          ["Main settings", [["Zigbee channel", "11", false], ["Info", "", true], ["Restart", "", true]], 2])
    ui.list_row(1, 0, false)
    check("a row that opens a screen of the node's asks for it", [ui.top()["view"], h.view_asked[-1]], [["houseRemote", 7, '["info"]'], [7, ["info"], nil]])
    ui.back()
    ui.list_row(2, 0, false)
    check("a row that changes a setting there does nothing with Editing off", size(h.view_asked), 2)
    ui.prefs["editing"] = true
    ui.list_row(2, 0, false)
    check("and with Editing on the touch goes to the node", h.view_asked[-1], [7, ["settings"], 2])
    ui.prefs["editing"] = false
    # a row of this panel's own screen: the bridge's web password
    ui.open(["houseRemote", 7, '["wireless"]'])
    h.remote[7] = [tasmota.millis(), ["wireless"], "Wireless settings", [["Wi-Fi", "Cottage, -55 dBm", 0, 0], ["Web password", "", 3, 0, ["houseWebpw"]]], false]
    ui.list_row(1, 0, false)
    check("a row of this panel's own screen opens it here", ui.top()["view"], ["houseWebpw", 7])
    ui.back()
    ui.back()
    # an answer that does not come is said so, with the way to ask again
    h.remote = {}
    ui.open(["houseRemote", 7, '["settings"]'])
    tasmota.timers.advance(PanelHouseView.ADMIN_MS + 10)
    check("no answer in time says so, and offers to ask again", rows(ui), [["No answer", "", false], ["Ask again", "", true]])
    ui.list_row(1, 0, false)
    check("which asks it again, with Editing off too", [h.view_asked[-1], rows(ui)], [[7, ["settings"], nil], [["Asking", "", false]]])
    # a touch that closed the screen it was on, as this panel's own does: it goes, and the one under it is asked again
    ui.open(["houseRemote", 7, '["saverTime",0]'])
    h.remote[7] = [tasmota.millis(), ["saverTime", 0], "Starts after", [["1 min", "", 2, 0]], true]
    var n = size(h.view_asked)
    f["pv"].view_came(7)
    check("a touch that closed its screen: back to the one under it, asked again", [ui.top()["view"], size(h.view_asked) - n, h.view_asked[-1]],
          [["houseRemote", 7, '["settings"]'], 1, [7, ["settings"], nil]])
    tasmota.timers = kept
end

# This panel's screens for another panel: what a touch on each row does there, and what one changes here
def section_render()
    var f = fixture(true, false)
    var ui = f["ui"]
    var pv = f["pv"]
    ui.items = / -> [["Editing", "editing"], ["Screensaver", "screensaver"], ["Info", "info"], ["Pattern", "pattern"]]
    var r = pv.render_for(["settings"], nil)
    var at = {}
    for i: 0 .. size(r[2]) - 1  at[r[2][i][0]] = i end
    var row = / label -> r[2][at[label]]
    check("its Main settings, titled as here", [r[0], r[1], r[3]], [["settings"], "Main settings", false])
    check("a setting on or off changes there, the screensaver and the Info open a screen of this one's, and the pattern is this glass's alone",
          [row("Editing")[2], row("Screensaver")[2 ..], row("Info")[2 ..], row("Pattern")[2]], [2, [1, 0, ["saver"]], [1, 0, ["panelInfo"]], 0])
    var was = ui.prefs["editing"]
    var t = pv.render_for(["settings"], at["Editing"])
    check("a touch on Editing turns it here, saved, and the screen goes back with it turned, not closed", [ui.prefs["editing"], t[3], t[4][0]], [!was, false, ["prefs"]])
    var st = pv.render_for(["saverTime", 0], 0)
    check("a time of the screensaver chosen here, and the list it was on closed", [ui.prefs["screensaver"][0] == PanelUi.SAVER_TIMES[0][0], st[3]], [true, true])
    check("a screen another panel may not have, nor a touch it may not make, is nothing", [pv.render_for(["zigbeePair"], nil), pv.render_for(["settings"], at["Pattern"])], [nil, nil])
end

# Another node's Wireless settings on this panel: a text typed here, a question asked here first, an action of this panel's own,
# the screen that follows a touch, one asked again while it changes, and the node's hotspot with its QR
def section_wireless()
    import json
    var f = fixture(true, true)
    var ui = f["ui"]
    var pv = f["pv"]
    var h = global.house
    var kept = tasmota.timers
    tasmota.timers = TimerBook(tasmota)
    var rv = '["wifi"]'
    ui.open(["houseRemote", 7, rv])
    h.remote[7] = [tasmota.millis(), ["wifi"], "Wi-Fi", [["Cottage", "Not found", 0, 0], ["Change password", "", 4, 0, ["Cottage", 63, ""]], ["Forget network", "", 5, 2,
                   ["Forget the network?", "The Wi-Fi turns off. It stays on the mesh.", "Forget"]], ["MQTT", "Not connected", 6, 0, ["mqttOpen"]]], false, {}]
    ui.list_row(1, 0, false)
    check("a row that asks for a text opens this panel's keyboard on it", ui.editing, ["keyboard", "house", ["text", 7, rv, 1]])
    var n = size(h.view_asked)
    ui.commit("p4ssp4ss00")
    check("and OK sends the text to the node, on that row", [size(h.view_asked) - n, h.view_asked[-1], h.view_x], [1, [7, ["wifi"], 1], {"t": "p4ssp4ss00"}])
    ui.list_row(2, 0, false)
    check("a row that asks first: the question on this panel, its answer in the colour of what changes much",
          [ui.top()["view"], ui.list_view(ui.top()["view"])[0], rows(ui)[1]], [["houseRemoteAsk", 7, rv, 2], "Forget the network?", ["Forget", "", true]])
    ui.confirm_at = nil
    ui.list_row(1, 0, false)
    check("the answer goes to the node, and the question goes", [h.view_asked[-1], h.view_x, ui.top()["view"]], [[7, ["wifi"], 2], {"y": 1}, ["houseRemote", 7, rv]])
    ui.list_row(3, 0, false)
    check("a row of this panel's own: the house's MQTT, opened here", ui.top()["view"], ["mqtt"])
    ui.back()
    # the screen that follows a touch, on top of the one touched, and not asked again
    n = size(h.view_asked)
    h.remote[7] = [tasmota.millis(), ["wifiJoin"], "Cottage", [["Connecting", "20 s", 0, 0]], false, {"g": 1, "a": 1000}]
    pv.view_came(7)
    check("the screen that follows the touch comes on top, as it came", [ui.top()["view"], rows(ui), size(h.view_asked) - n], [["houseRemote", 7, '["wifiJoin"]'], [["Connecting", "20 s", false]], 0])
    pv.view_came(7)
    tasmota.timers.advance(1000)
    check("one that changes by itself is asked again while it is on show", [size(h.view_asked) - n, h.view_asked[-1]], [1, [7, ["wifiJoin"], nil]])
    pv.view_came(7)
    ui.back()
    tasmota.timers.advance(1000)
    check("and not once another screen is on show", size(h.view_asked) - n, 1)
    # the node's hotspot: its QR on this panel's page for it
    ui.shape["pages"]["qr"] = "qr"
    ui.shape["qrMax"] = 120
    ui.open(["houseRemote", 7, '["wifiHotspot"]'])
    h.remote[7] = [tasmota.millis(), ["wifiHotspot"], "Hotspot", [["Network", "tasmota-4A7E21", 0, 0], ["Password", "abcdefgh23", 0, 0], ["Stop hotspot", "", 2, 2]], false,
                   {"q": ["tasmota-4A7E21", "abcdefgh23", "http://192.168.4.1", "Waiting for a device"]}]
    var q = ui.list_view(ui.top()["view"])
    check("the node's hotspot: its QR here, with its words, and the touches: Stop and Back", [q[4]["code"] != nil, q[4]["lines"], size(q[2]), q[2][0][2], ui.page_of(ui.top()["view"], q)],
          [true, ["tasmota-4A7E21", "Password abcdefgh23", "http://192.168.4.1", "Waiting for a device"], 2, "Stop hotspot", "qr"])
    ui.shape["pages"].remove("qr")
    ui.back()
    # with Editing off, a text or a question goes nowhere
    ui.prefs["editing"] = false
    ui.open(["houseRemote", 7, rv])
    h.remote[7] = [tasmota.millis(), ["wifi"], "Wi-Fi", [["Cottage", "Not found", 0, 0], ["Change password", "", 4, 0, ["Cottage", 63, ""]]], false, {}]
    ui.list_row(1, 0, false)
    check("with Editing off, a row that asks for a text opens nothing", [ui.editing, ui.top()["view"]], [nil, ["houseRemote", 7, rv]])
    tasmota.timers = kept
end

# This panel's own window: what its screen says, from leaving its house to the end, and its touches
def section_window()
    var f = fixture(true, true)
    var ui = f["ui"]
    var says = def (w)
        ui.zigbee = FakeZb(zb_state({"window": w}))
        var v = ui.list_view(["houseWindow"])
        var labels = []
        for r: v[2] labels.push(r[2]) end
        return [v[0], labels]
    end
    check("leaving its house first", says({"state": "leaving"}), ["Join a house", ["Leaving this house", "Cancel"]])
    check("open: what to do on the other panel, and this panel's name", says({"state": "open"}), ["Waiting to be added", ["On a panel of the house", "This panel", "Cancel"]])
    check("picked: the screen says it is the one", says({"state": "asked"}), ["This one", ["This is the panel", "Yes there adds it", "Cancel"]])
    check("joining", says({"state": "joining"}), ["Joining the house", ["A few seconds"]])
    check("in: the house, by its name", says({"state": "in"}), ["Added to the house", ["House", "Done"]])
    check("not, and why", says({"state": "no", "why": "already"}), ["Not added", ["It is in a house already.", "Done"]])
    check("this panel that did not get out of its house in time", says({"state": "no", "why": "leaving"})[1][0], "This panel did not leave its house in time.")
    check("closed, its time up: open it again", says({"state": "closed"}), ["The window closed", ["Open it again", "Done"]])
    check("no window at all reads as closed", says(nil)[0], "The window closed")
    # its touches: Cancel and Done close it, with Editing off too, and back to the house; Open it again asks for it, on the same screen
    ui.stack = []
    ui.open(["house"])
    ui.open(["houseWindow"])
    ui.prefs["editing"] = false
    var out = ui.act(["house", "closeWindow"])
    check("Cancel closes the window, with Editing off too, and the screens go back", [out[0], ui.top()["view"][0]], [["zigbee", "closeWindow"], "house"])
    ui.prefs["editing"] = true
    ui.open(["houseWindow"])
    out = ui.act(["house", "window"])
    check("Open it again asks the pairing for the window, on the same screen", [out[0], out[-1], ui.top()["view"][0], size(ui.stack)], [["zigbee", "window"], ["show"], "houseWindow", 2])
    ui.stack = []
    ui.open(["house"])
    out = ui.act(["house", "window"])
    check("Open it again leaves the house of its own the panel founded meanwhile, and opens the window's screen",
          [global.house.left, ui.top()["view"][0], out[-2]], [[0, 0], "houseWindow", ["zigbee", "window"]])
end

# The house's page: the Screens under the house's icons, the house's name for a title, renamed by a long press
class FakeAlarmView
    var alarm
    def init(a) self.alarm = a end
end
class FakeAlarmState
    var st, w
    def init(st, w) self.st = st self.w = w end
    def warnings() return self.w end
end
class FakeSchedule
    def calendar_row() return PanelUi.row(nil, "Calendar", "", false, ["schedule", "calendar"], nil) end
end

def effects_of(out, start)
    var got = {}
    for e: out
        if e[0] == "set" && type(e[1]) == "string" && size(e[1]) >= size(start) && e[1][0 .. size(start) - 1] == start got[e[1]] = e[2] end
    end
    return got
end

def section_page()
    var f = fixture(true, false)
    var ui = f["ui"]
    var with_house = {}
    for k: shape.keys() with_house[k] = shape[k] end
    with_house["pages"] = {}
    for k: shape["pages"].keys() with_house["pages"][k] = shape["pages"][k] end
    with_house["pages"]["house"] = "house"
    with_house["houseRows"] = 3
    with_house["houseIcons"] = 6
    ui.shape = with_house
    var out = ui.open_screens("home")
    var icons = effects_of(out, "$house.icons.")
    check("the Screens go to the house's page, titled with the house's name", [ui.page, effects_of(out, "$list.title")["$list.title"]], ["house", "Sample House"])
    check("with no schedule and no alarm: Main settings, Wireless settings and the mesh, from the first place, and the rest hidden",
          [icons["$house.icons.0.icon"], icons["$house.icons.1.icon"], icons["$house.icons.2.icon"], icons["$house.icons.2.shown"], icons["$house.icons.3.shown"], icons["$house.icons.5.shown"]],
          ["settings", "wifi", "mesh", 1, 0, 0])
    var labels = []
    for r: ui.list_view(ui.top()["view"])[2] labels.push(r[2]) end
    check("the list is the plans alone", labels.find("Calendar") == nil && size(labels) == size(f["store"].doc["screens"]), true)
    # the calendar, the alarm and the notifications, with the schedule and the alarm in the image
    ui.schedule = FakeSchedule()
    ui.alarm = FakeAlarmView(FakeAlarmState("armed_away", 2))
    icons = effects_of(ui.show(), "$house.icons.")
    check("the six, in their order, the alarm lit while armed and the notifications while some are not seen",
          [icons["$house.icons.2.icon"], icons["$house.icons.3.icon"], icons["$house.icons.3.iconColor"], icons["$house.icons.4.icon"], icons["$house.icons.4.iconColor"], icons["$house.icons.5.icon"], icons["$house.icons.5.shown"]],
          ["schedule", "alarmSignal", "accent-blue", "noticeSignal", "accent-blue", "mesh", 1])
    ui.alarm = FakeAlarmView(FakeAlarmState("disarmed", 0))
    icons = effects_of(ui.show(), "$house.icons.")
    check("and unlit when disarmed with nothing to see", [icons["$house.icons.3.iconColor"], icons["$house.icons.4.iconColor"]], ["text-primary", "text-primary"])
    ui.schedule = nil
    ui.alarm = nil
    # a touch on each icon
    ui.house_icon("$house.icons.0.count")
    check("the first opens Main settings, as the swipe down on a plan does", ui.top()["view"][0], "settings")
    ui.back()
    ui.house_icon("$house.icons.1.count")
    check("the second, Wireless settings", ui.top()["view"][0], "wireless")
    check("whose row of the house is gone: the mesh is the house's icon", ui.list_view(["wireless"])[2][-1][2] != "House", true)
    ui.back()
    ui.house_icon("$house.icons.2.count")
    check("the mesh's opens the mesh", ui.top()["view"][0], "house")
    # the mesh is a list, on the list's page: its settings the first row and the nodes right under them (on the house's page
    # they started a line of icons below its settings' icon)
    var fx = ui.show()
    check("the mesh is drawn on the list's page, with no icon of the house's", [ui.page, size(effects_of(fx, "$house.icons."))], [shape["pages"]["list"], 0])
    ui.prefs["editing"] = true
    var fx2 = ui.show()
    check("with Editing on, the + of its title", effects_of(fx2, "$list.actionIcon")["$list.actionIcon"], "add")
    labels = []
    for r: ui.list_view(ui.top()["view"])[2] labels.push(r[2]) end
    check("its settings' cog first, and the nodes under it", labels, ["", "Panel 000004 *", "Panel 000005", "Kitchen", "Bridge 000007"])
    ui.list_row(0, 0, false)
    check("the first row opens the mesh's settings", ui.top()["view"], ["houseSettings"])
    ui.back()
    # the mesh on a page of its own, under its cog: the cog in the row of buttons, and the nodes from the first row
    with_house["pages"]["mesh"] = "mesh"
    with_house["meshRows"] = 4
    fx = ui.show()
    var cog = effects_of(fx, "$mesh.cog.")
    check("with a page of its own, the mesh is drawn there, its cog in the row of buttons over its nodes",
          [ui.page, cog["$mesh.cog.icon"], cog["$mesh.cog.iconColor"]], ["mesh", "settings", "text-primary"])
    labels = []
    for r: ui.list_view(ui.top()["view"])[2] labels.push(r[2]) end
    check("and the nodes from the first row, four to a page", [labels, effects_of(fx, "$list.pageCount")["$list.pageCount"]],
          [["Panel 000004 *", "Panel 000005", "Kitchen", "Bridge 000007"], 1])
    ui.mesh_cog()
    check("a touch on the cog opens the mesh's settings", ui.top()["view"], ["houseSettings"])
    ui.back()
    with_house["pages"].remove("mesh")
    ui.prefs["editing"] = false
    ui.back()
    check("a place with no icon does nothing", [ui.house_icon("$house.icons.4.count"), ui.top()["view"][0]], [[], "screens"])
    # the title's long press: the house's name, with Editing on
    check("with Editing off the title is not renamed", ui.rename_top(), [])
    ui.prefs["editing"] = true
    var kb = ui.rename_top()
    check("with Editing on, the keyboard opens on the house's name", [kb[0], ui.editing], [["set", "$keyboard.value", "Sample House"], ["keyboard", "house", "name"]])
    ui.commit("New Cottage")
    check("and OK names the house, and the page's title says it", [global.house.list.name(), ui.top()["view"][0], ui.list_view(ui.top()["view"])[0]], ["New Cottage", "screens", "New Cottage"])
    global.house.can = false
    check("a panel that does not write the list does not rename the house", ui.rename_top(), [])
    global.house.can = true
    # without the house's page, the Screens are as they were
    ui.shape = shape
    ui.schedule = FakeSchedule()
    ui.open_screens("home")
    labels = []
    for r: ui.list_view(ui.top()["view"])[2] labels.push(r[2]) end
    check("a layout without the house's page keeps the Screens' title, and the calendar at the end", [ui.list_view(ui.top()["view"])[0], labels[-1], ui.page], ["Screens", "Calendar", "settings"])
    check("and the Wireless settings keep the house's row, before the web password's", [ui.list_view(["wireless"])[2][-2][2], ui.list_view(["wireless"])[2][-1][2]], ["House", "Web password"])
    ui.schedule = nil
end

# A node's name and the favourite bridge
def section_names()
    var f = fixture(true, false)
    var ui = f["ui"]
    ui.open(["house"])
    ui.list_row(4, 0, false)
    check("the bridge 7 is not the favourite, and with Editing off it is only said", rows(ui)[2], ["Favorite", "No", false])
    check("and its title is not renamed", ui.rename_top(), [])
    ui.prefs["editing"] = true
    check("with Editing on, a touch makes it the favourite", rows(ui)[2], ["Favorite", "No", true])
    ui.list_row(2, 0, false)
    check("and it is", [global.house.fav, rows(ui)[2]], [7, ["Favorite", "Yes", false]])
    var kb = ui.rename_top()
    check("the title's long press opens the keyboard on the node's name", [kb[0], ui.editing], [["set", "$keyboard.value", "Bridge 000007"], ["keyboard", "house", 7]])
    ui.commit("Garage")
    check("and OK names it, which the list carries: the page and the mesh say it", [global.house.list.node(7)["name"], ui.list_view(ui.top()["view"])[0]], ["Garage", "Garage"])
    ui.back()
    ui.list_row(2, 0, false)
    check("a panel's page has no favourite: its two settings, and what is done to it", [size(rows(ui)), rows(ui)[2][0]], [4, "Join another house"])
    kb = ui.rename_top()
    check("and is renamed the same way", ui.editing, ["keyboard", "house", 5])
    ui.commit("Kitchen")
    check("another panel's name", global.house.list.node(5)["name"], "Kitchen")
    global.house.can = false
    check("a panel that does not write the list renames no node", ui.rename_top(), [])
    global.house.can = true
end

# The house's channel on the mesh's screens: its row, the access points off it the nodes saw, a node's radio, the change with its
# question, and a network of the Wi-Fi's search off the house's channel
def info_of(mesh, ap, off, why)
    var b = bytes(-32)
    b[28] = mesh
    b[29] = ap
    b[30] = off
    b[31] = why
    return b.tohex()
end
def section_channel()
    var f = fixture(true, false)
    var ui = f["ui"]
    var pv = f["pv"]
    var h = global.house
    h.list.author(HouseList.K_CHANNEL, 0, HouseList.channel_bytes(11, nil))
    # the bridge 6 parked, its access point seen on channel 6; the panel 5 heard, on the house's channel, on its access point
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "info": info_of(11, 0, 6, 201)}, {"id": 5, "state": 0, "info": info_of(11, 11, 0, 0)}] end
    ui.open(["house"])
    var r = rows(ui)
    check("an access point of the house's network off its channel comes first, under the settings, by how many nodes saw it", r[1], ["Wi-Fi on channel 6", "1 node", true])
    ui.open(["houseSettings"])
    check("and the house's channel is in the mesh's settings", rows(ui), [["Channel", "11", true]])
    ui.back()
    # a node's page says no channel (it said it twice): it is in each node's Wireless settings, under its Wi-Fi
    ui.open(["houseNode", 6])
    var said = []
    for x: rows(ui)  said.push(x[0]) end
    check("a node's page says no channel, no Wi-Fi and no access point of its radio", [said.find("Channel"), said.find("Wi-Fi"), said.find("Access point")], [nil, nil, nil])
    ui.back()
    h.channel.radio = bytes("0B000600")
    var wl = ui.list_view(["wireless"])[2]
    check("this panel's Wireless settings: its channel under its Wi-Fi, and the access point off the channel, in the colour of what is wrong, which opens the house's channel",
          [wl[0][2], wl[1][2 .. 4], wl[2][2 .. 5]], ["Wi-Fi", ["Channel", "11", false], ["Access point", "On channel 6", 2, ["open", "houseChannel"]]])
    h.channel.radio = bytes("03000000")
    check("a channel not the house's in the colour of what is wrong", ui.list_view(["wireless"])[2][1][2 .. 4], ["Channel", "3", 2])
    var kept = tasmota.timers
    tasmota.timers = TimerBook(tasmota)
    var ran = []
    var rw = pv.render_for(["wireless"], nil, nil, / e -> ran.push(e))
    check("and on another panel, as every node's (node_wireless.be): its Wi-Fi, its channel, its MQTT and its web password", [rw[1], rw[2]],
          ["Wireless settings", [["Wi-Fi", "None", 1, 0, ["wifi"]], ["Channel", "3", 0, 2], ["MQTT", "Off", 6, 0, ["mqttOpen"]], ["Web password", "", 3, 0, ["houseWebpw"]]]])
    rw = pv.render_for(["wifiSearch"], nil, nil, / e -> ran.push(e))
    check("a search asked by another panel runs here, and what it found goes 2 min after unless this panel's glass shows it",
          [ran, tasmota.timers.contains("house_remote_search")], [[[["wifi", "scan"]]], true])
    tasmota.timers = kept
    h.channel.radio = nil
    # the channel's page, without Editing: what it is, nothing to change
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0, "info": info_of(11, 0, 6, 201)}] end
    ui.open(["houseChannel"])
    check("the channel's page: the house's, and the access points off it", rows(ui), [["The house", "11", false], ["Access points on 6", "1 node", false]])
    ui.back()
    ui.prefs["editing"] = true
    ui.open(["houseChannel"])
    check("with Editing on, a panel that writes moves it: to the access points' channel, or to another", rows(ui),
          [["The house", "11", false], ["Access points on 6", "1 node", true], ["Change", "", true]])
    ui.list_row(2, 0, false)
    var pick = rows(ui)
    check("the thirteen channels, the house's marked and not to pick", [size(pick), pick[10], pick[5], ui.list_view(ui.top()["view"])[2][10][0]],
          [13, ["Channel 11", "", false], ["Channel 6", "", true], "dotOn"])
    ui.list_row(5, 0, false)
    check("the question: every node moves in a minute, then the access points", [ui.top()["view"], rows(ui)],
          [["houseChannelGo", 6], [["To channel", "6", false], ["Every node moves in a minute", "", false], ["Then the access points to 6", "", false], ["Move", "", true], ["Cancel", "", true]]])
    ui.list_row(3, 0, false)
    check("Move writes the house's channel, at the house's own time", [h.moved, h.channel_setting()["channel"]], [[[6, nil]], 6])
    check("and the channel's page is back, with the question and the list gone", ui.top()["view"], ["houseChannel"])
    ui.back()
    # a network of the Wi-Fi's search on another channel than the house's: said so, and joined only by moving the house
    check("a network on another channel is off the house's", [pv.off_channel(1), pv.off_channel(6), pv.off_channel(0)], [true, false, false])
    ui.pick_network(["wifiPick", "Neighbour", 3, 1, "AA:BB:CC:DD:EE:01"])
    check("picked, it is said to be off the house's channel, and the way is moving the house", [ui.top()["view"], rows(ui)],
          [["houseOffNet", "Neighbour", 1], [["On channel", "1", false], ["The house's mesh", "Channel 6", false], ["This panel would leave it", "", false],
                                           ["Move the house to 1", "", true], ["Cancel", "", true]]])
    ui.list_row(3, 0, false)
    ui.list_row(3, 0, false)
    check("moving the house from there ends on the channel's page", [h.moved[-1], ui.top()["view"]], [[1, nil], ["houseChannel"]])
    ui.back()
    # a panel alone in its house follows its network: nothing is off its channel
    var alone = HouseList(4)
    var d = bytes()
    d.add(HouseList.ROLE_PANEL, 1)
    d .. key_of(4)
    d .. mac_of(4)
    alone.author(HouseList.K_IDENT, 4, d)
    alone.author(HouseList.K_CHANNEL, 0, HouseList.channel_bytes(11, nil))
    h.list = alone
    check("a panel alone in its house: no network is off its channel", pv.off_channel(1), false)
    ui.prefs["editing"] = false
end

# A node this panel added a moment ago, not heard yet, is starting: a bridge restarts once added, to form its Zigbee network (where the screen said "No signal" for that while)
def section_starting()
    var f = fixture(true, false)
    var ui = f["ui"]
    tasmota.at_ms = 1000000
    global.house.added = {7: 1000000 - 5000}
    ui.open(["house"])
    var r = rows(ui)
    check("a bridge added 5 s ago and not heard: Starting", r[4], ["Bridge 000007", "Starting", true])
    check("a node not added here, not heard: No signal", r[2], ["Panel 000005", "No signal", true])
    tasmota.at_ms = 1000000 + PanelHouseView.STARTING_MS
    check("after its time to start, not heard: No signal", rows(ui)[4], ["Bridge 000007", "No signal", true])
    tasmota.at_ms = 1000000
    global.espnow_mesh_neighbors = def () return [{"id": 6, "state": 0}, {"id": 5, "state": 2}, {"id": 7, "state": 0}] end
    check("heard: Heard", rows(ui)[4], ["Bridge 000007", "Heard", true])
    ui.back()
    tasmota.at_ms = nil
end

section_summary()
section_starting()
section_channel()
section_nodes()
section_names()
section_remote()
section_render()
section_wireless()
section_page()
section_join()
section_window()
section_admin()
section_strike()
# The house's server paired on this panel, and this panel's own OTA screen
def section_server()
    var f = fixture(true, true)
    var ui = f["ui"]
    var pv = f["pv"]
    var h = global.house
    tasmota.timers = []
    pv.server = HouseServer(/ -> global.house, nil)
    ui.open(["house"])
    ui.act(["house", "serverWindow"])
    var code = pv.server.code
    check("Add server opens the window, with its code, this panel's address and the time left",
          [ui.top()["view"][0], ui.list_view(["houseServer"])[0], rows(ui)],
          ["houseServer", "Add server", [["Code", code[0 .. 2] + " " + code[3 .. 5], false], ["This panel", "", false], ["On the server", "OTA, Pair", false],
                                         ["Closes in", "2:00", false], ["Cancel", "", true]]])
    var key = "9a968a150000000000000000000000000000000000000000000000000000fd5f"
    var nonce = "0011223344556677"
    var req = {"v": 1, "key": key, "host": "192.168.2.108", "port": 8099, "name": "Home Assistant", "nonce": nonce,
               "mac": HouseServer.hmac(code, "houseweave-pair-1|" + key + "|192.168.2.108|8099|Home Assistant|" + nonce)}
    var a = pv.server.answer(json.dump(req))
    check("the server's request: it is in the house, and the screen says what it added", [a["node"], ui.list_view(["houseServer"])[0], rows(ui)],
          [1, "Server added", [["Added", "Home Assistant", false], ["Done", "", true]]])
    var page = []
    for r: ui.list_view(["house"])[2]  page.push([r[2], r[3]]) end
    check("the mesh's list has it, under the nodes", page[size(page) - 1], ["Home Assistant", "Server"])
    var node = []
    for r: ui.list_view(["houseNode", 1])[2]  node.push([r[2], r[3], r[5]]) end
    check("its page: its address and its removal", [ui.list_view(["houseNode", 1])[0], node],
          ["Home Assistant", [["Address", "192.168.2.108:8099", nil], ["Remove from house", "", ["open", "houseStrike", 1]]]])
    ui.open(["houseStrike", 1])
    ui.act(["house", "strike", 1])
    check("removed: struck off at once, no word over the mesh", [h.revoked, h.struck, h.list.servers()], [[1], [], []])
    ui.prefs["editing"] = false
    pv.server.close(nil)
    ui.act(["house", "serverWindow"])
    check("with Editing off, no window", pv.server.code, nil)

    # this panel's OTA: the row of its Wireless settings, and its screen, answered here as a node's
    ui.prefs["editing"] = true
    h.add_server(bytes(key), bytes("C0A8026C"), 8099, "Home Assistant")
    var ran = []
    h.view_fn = def (v, k, x)
        var r = pv.render_for(v, k, x, def (e) for x2: e ran.push(x2) end end)
        return r
    end
    var came = []
    h.on_view = / n -> came.push(n)
    check("no OTA row before the boot gives the OTA", pv.ota_row(), nil)
    pv.ota = NodeOta(nil, / -> h.server(), nil)
    var row = pv.ota_row()
    check("the OTA row: its screen, this panel's own, opened as a node's", [row[2], row[3], row[5]], ["OTA", "dev", ["open", "houseRemote", 4, '["ota"]']])
    ui.open(["houseRemote", 4, '["ota"]'])
    var shown = []
    for r: ui.list_view(ui.top()["view"])[2]  shown.push([r[2], r[3]]) end
    check("answered here, with no mesh: the server, the firmware, and a look asked of the server as it opens",
          [h.view_asked, ui.list_view(ui.top()["view"])[0], shown, ran],
          [[], "OTA", [["Server", "Home Assistant"], ["Firmware", "dev"], ["Release", "Not looked at"]], [["ota", "look"]]])
    for t: tasmota.timers  if t[2] == "panel_house_self"  t[1]() end end
    check("and said a moment after, as a node's screen that came", came, [4])
    # its backup, in its OTA: the panel's own screen of it, and not a node's
    class FakeBackup
        def state() return {"server": "192.168.2.108:8099", "busy": "", "pending": false, "last": nil, "result": "", "found": nil} end
    end
    ui.backup = FakeBackup()
    pv.ask_remote(4, '["ota"]', nil, nil)
    var taps = {}
    for r: ui.list_view(ui.top()["view"])[2]  taps[r[2]] = r[5] end
    check("the backup in this panel's OTA opens its own Backup screen", taps.find("Backup"), ["backupOpen"])
end

section_key()
section_found()
section_pairing()
section_guest()
section_leave()
section_server()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
