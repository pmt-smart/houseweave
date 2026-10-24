# berry/node_backup.be with berry/panel_backup.be, the panel's configuration kept on the house's server, against requests
# the test answers: the server the house's list has, every request signed with the key of the pair (server_link.be), what goes and what never does,
# when it goes (a change waits for the night's round, or for someone to ask), who asked for it, the server's own requests, and the restore with the
# checks it makes first.

import persist
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
def check(name, got, want)
    checks += 1
    if !deep_eq(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end
# a last backup's fields, in one order: a map's own is none
def fields(m) return [m.find("at"), m.find("zones"), m.find("devices"), m.find("by"), m.find("server")] end

# the requests, answered by the test: one at a time, as panel_http.be takes them
class FakeHttp
    var reqs, pending
    def init() self.reqs = [] end
    def busy() return self.pending != nil end
    def request(method, host, port, path, body, done, headers)
        if self.pending != nil return false end
        self.reqs.push([method, host, port, path, body, headers])
        self.pending = done
        return true
    end
    def answer(code, body)
        var d = self.pending
        self.pending = nil
        d(code, body)
    end
end

# Tasmota: named timers the test fires (a TimerBook: they stack, and remove_timer takes out every one of the id), the Wi-Fi, the heap, the commands
# run, the ones Berry registered, and the settings a command answers
class BackupTasmota : TasmotaStub
    var timers, cmds, heap, mac, commands, resp, answers, up
    def init()
        self.timers = TimerBook(self) self.cmds = [] self.heap = 100 self.mac = "24:0A:C4:3E:51:A7" self.commands = {} self.up = true
        self.answers = {"Topic": "tasmota_3E51A7", "FullTopic": "%prefix%/%topic%/", "Prefix1": "cmnd", "Prefix3": "tele", "DeviceName": "NSPanel"}
    end
    def fire(id) return self.timers.fire(id) end
    def wifi() return {"up": self.up, "mac": self.mac, "ip": "192.168.2.70"} end
    def memory() return {"heap_free": self.heap} end
    def cmd(c)
        if self.answers.contains(c) return {c: self.answers[c]} end
        self.cmds.push(c)
    end
    def add_cmd(name, f) self.commands[name] = f end
    def resp_cmnd(s) self.resp = s end
    def hostname() return "nspanel-living" end
    # a command as the console runs it: what it answered
    def run_cmd(name, payload)
        self.resp = nil
        self.commands[name](name, 1, payload, nil)
        return self.resp
    end
end
tasmota = BackupTasmota()
tasmota.utc_now = 1790000000

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

# the house, with the server its list has, and the key of the pair as the driver derives it for the pinned secrets (test_server_link.be)
var K = bytes("463c97311c85ec6df2640aeefc4be01b89b330283b2fb200af9ff9bc1e7dd238")
var SERVER_PUB = bytes("b0d08f35b4683381489afb32825e59152d47d19bc9e050d6d5a954984c9d1e2c")
global.espnow_mesh_pair_key = def (pub) return pub == SERVER_PUB ? K : false end
class FakeList
    var me, rev
    def init() self.me = 1 self.rev = 0 end
end
class FakeHouse
    var up, list, srv
    def init() self.up = true self.list = FakeList() end
    def server() return self.srv end
end
var house = FakeHouse()
def server_at(host, port) return {"id": 8, "host": host, "port": port, "name": "Home Assistant", "key": SERVER_PUB} end

var PROJECT = "p1-living-room-eu-landscape"
# the panel's name on the server: its MAC in lower-case hex
var NAME = "240ac43e51a7"
var store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
persist.store["panel_config"] = store.doc
persist.store["panel_texts"] = {"page1.t0": "Living room"}
persist.store["panel_prefs"] = {"editing": true, "pattern": ["salt1", "hash1"], "screensaver": [60, 300]}
persist.store["zb_bridge_peer"] = {"mac": "B0:B0:B0:00:00:01", "webpw": "k7m3q9t2wx"}
persist.store["panel_webpw"] = "a1b2c3d4"
var http = FakeHttp()
var hellos = FakeHttp()
var b = nil
var link = ServerLink(/ -> house, hellos, / -> {"role": "panel", "backup": b.brief()}, / -> [])
b = NodeBackup(PanelBackup(PROJECT, store), http, link)
var told = 0
b.said = def () told += 1 end

# a request to the server, signed as it checks it: the node, the time, and the HMAC under the pair's key of "method|path|time|digest of the body"
def signed(r)
    var h = r[5]
    return h["X-HouseWeave-Node"] == "1" && h["X-HouseWeave-Time"] == str(tasmota.utc_now) &&
           h["X-HouseWeave-Mac"] == ServerLink.hmac(K, r[0] + "|" + r[3] + "|" + h["X-HouseWeave-Time"] + "|" + ServerLink.digest(r[4] != nil ? r[4] : ""))
end
# the server's request to the panel, signed by it, as /houseweave/do takes it: the answer
var nonces = 0
def server_says(verb)
    nonces += 1
    var nonce = "n" + str(nonces)
    var t = tasmota.utc_now
    return link.answer(json.dump({"v": 1, "verb": verb, "t": t, "nonce": nonce, "mac": ServerLink.hmac(K, "houseweave-do|" + verb + "|" + str(t) + "|1|" + nonce)}))
end
# the hello the panel says after a backup: what it said, and the client free again
def hello()
    if !hellos.busy() return nil end
    var said = json.load(hellos.reqs[-1][4])
    hellos.answer(200, "")
    return said
end

# --- no server: nothing ------------------------------------------------------------------------------
check("BackupNow a command", tasmota.commands.contains("BackupNow"), true)
check("and the server's verbs, the backup and the round", [link.handlers.contains("backup"), link.handlers.contains("round")], [true, true])
b.changed()
b.every_second()
check("no server: a change asks nothing", [http.reqs, persist.find("panel_backup")], [[], nil])
check("and the view says No server", PanelUi.backup_hint(b.state()), "No server")
check("BackupNow says so, and asks nothing", [tasmota.run_cmd("BackupNow", ""), http.reqs], ['{"BackupNow":"No server"}', []])

# --- the house's server, and nothing on it ---------------------------------------------------------
house.srv = server_at("192.168.2.10", 8099)
tasmota.up = false
b.every_second()
check("a server known before the Wi-Fi is up: nothing asked of it, nor taken as seen", [size(http.reqs), persist.find("panel_backup")], [0, nil])
tasmota.up = true
b.every_second()
var ID = SERVER_PUB.tohex() + "@192.168.2.10:8099"
check("the server kept, all of the panel to go, and the server looked at first, signed",
      [persist.store["panel_backup"]["server"], persist.store["panel_backup"]["dirty"], http.reqs[-1][0 .. 4], signed(http.reqs[-1])],
      [ID, true, ["GET", "192.168.2.10", 8099, "/api/backup", nil], true])
check("the view says it looks, with a backup to make, on the server by its name", [b.state()["busy"], b.state()["pending"], b.state()["server"], told > 0],
      ["looking", true, "Home Assistant", true])
b.every_second()
check("the same server at the next second: nothing new", size(http.reqs), 1)
http.answer(404, "not found\n")
check("none there: the server looked at, and nothing goes by itself -- the change waits for the round",
      [persist.store["panel_backup"]["fresh"], persist.store["panel_backup"]["dirty"], b.state()["busy"], size(http.reqs), tasmota.timers.size()],
      [false, true, "", 1, 0])
check("the view: not saved", PanelUi.backup_hint(b.state()), "Not saved")

# --- Back up now -------------------------------------------------------------------------------------
b.run("now", [])
var put = http.reqs[-1]
var sent = json.load(put[4])
check("Back up now: the backup at once, signed", [put[0], put[1], put[2], put[3], signed(put)], ["PUT", "192.168.2.10", 8099, "/api/backup", true])
check("the backup: the format, the panel, the room, who and when", [sent["v"], sent["panel"], sent["project"], sent["from"], sent["at"]],
      [1, NAME, PROJECT, "24:0A:C4:3E:51:A7", 1790000000])
check("with the configuration, the texts and the preferences, and nothing else",
      [sent["keys"].contains("panel_config"), sent["keys"].contains("panel_texts"), sent["keys"].contains("panel_prefs"), size(sent["keys"])],
      [true, true, true, 3])
check("the pattern never goes, the rest of the preferences do", [sent["keys"]["panel_prefs"].contains("pattern"), sent["keys"]["panel_prefs"]["screensaver"]], [false, [60, 300]])
check("nor the pair's record, nor the web password", [string.find(put[4], "k7m3q9t2wx"), string.find(put[4], "a1b2c3d4")], [-1, -1])
check("the configuration whole", size(sent["keys"]["panel_config"]["zones"]), size(store.doc["zones"]))
check("and the pattern still on the panel", persist.store["panel_prefs"]["pattern"], ["salt1", "hash1"])
http.answer(204, "")
var st = b.state()
var ZONES = size(store.doc["zones"])
var DEVICES = size(store.doc["devices"])
check("saved: nothing to go, and the last backup kept, with what it carried, who asked and where",
      [persist.store["panel_backup"]["dirty"], st["pending"], st["result"], fields(persist.store["panel_backup"]["last"])],
      [false, false, "", [1790000000, ZONES, DEVICES, "glass", "Home Assistant"]])
check("the view's hint: when it went", [PanelUi.backup_hint(st), st["last"]["when"]], ["%d/%m %H:%M", "%d/%m %H:%M"])
check("and the server's backup is this one", [st["found"]["zones"], st["found"]["devices"], st["found"]["at"]], [ZONES, DEVICES, 1790000000])
var said = hello()
check("and the panel says so to the server: a hello, signed, with its backup", [hellos.reqs[-1][3], signed(hellos.reqs[-1]), said["kind"], said["node"], said["backup"]],
      ["/api/hello", true, "backup", 1, {"at": 1790000000, "dirty": false}])

# --- a change: not saved until the round -----------------------------------------------------------
var saves = persist.saves
var n = size(http.reqs)
b.changed()
check("a change: marked, with the save that called it, and nothing sent or scheduled",
      [persist.store["panel_backup"]["dirty"], persist.saves, size(http.reqs), tasmota.timers.size(), b.state()["pending"]], [true, saves, n, 0, true])
b.changed()
check("what the server is told of it", b.brief(), {"at": 1790000000, "dirty": true})
var a = server_says("round")
check("the night's round: the change goes, and the answer has the panel's state", [a["verb"], a["backup"], a["state"]["backup"]["dirty"], http.reqs[-1][0], signed(http.reqs[-1])],
      ["round", "Saving", true, "PUT", true])
http.answer(204, "")
hello()
check("by the round", [b.state()["last"]["by"], b.state()["pending"]], ["round", false])
n = size(http.reqs)
check("a round with nothing changed: nothing goes", [server_says("round")["backup"], size(http.reqs)], ["Up to date", n])

# --- the server's Backup, and the console ------------------------------------------------------------
b.changed()
check("the server's Backup: at once", server_says("backup")["backup"], "Saving")
http.answer(204, "")
hello()
check("asked by the server", b.state()["last"]["by"], "server")
check("the server's Backup with nothing to save", server_says("backup")["backup"], "Up to date")
check("BackupNow with nothing to save", tasmota.run_cmd("BackupNow", ""), '{"BackupNow":"Up to date"}')
b.changed()
check("with a change: at once", tasmota.run_cmd("BackupNow", ""), '{"BackupNow":"Saving"}')
http.answer(204, "")
hello()
check("asked on the console", b.state()["last"]["by"], "console")

# --- what does not go -------------------------------------------------------------------------------
b.changed()
b.run("now", [])
http.answer(0, "No answer")
check("no answer: said, still to go, and nothing tried by itself", [b.state()["result"], b.state()["pending"], PanelUi.backup_hint(b.state()), tasmota.timers.size()],
      ["No answer", true, "Not saved", 0])
tasmota.heap = 20
n = size(http.reqs)
b.run("now", [])
check("short of heap: not sent, and said", [size(http.reqs), b.state()["result"]], [n, "Low memory"])
tasmota.heap = 100
var texts = persist.store["panel_texts"]
var big = "0123456789"
for i: 1 .. 12  big += big end
persist.store["panel_texts"] = {"page1.t0": big}
b.run("now", [])
check("one the restore could not read back: not sent, and said", [size(http.reqs), b.state()["result"]], [n, "Too large"])
persist.store["panel_texts"] = texts
b.run("now", [])
http.answer(401, "the pair's signature\n")
check("one the server refused: said", b.state()["result"], "HTTP 401")
b.run("now", [])
http.answer(204, "")
hello()
check("then it goes: the word cleared, and whoever asked last", [b.state()["result"], b.state()["pending"], b.state()["last"]["by"]], ["", false, "glass"])
# a change made while a backup is on its way is not in it: still to go when it lands
b.changed()
b.run("now", [])
check("a backup on its way", [http.reqs[-1][0], http.busy(), b.state()["busy"]], ["PUT", true, "saving"])
b.changed()
http.answer(204, "")
hello()
check("a change made while it went: still to go", [persist.store["panel_backup"]["dirty"], b.state()["pending"]], [true, true])
# the client busy with another request: the backup waits a second for it
http.pending = def (code, text) end
check("asked while the client is busy: it waits", [b.now("glass"), tasmota.timers.contains("node_backup")], ["Waiting", true])
http.pending = nil
n = size(http.reqs)
tasmota.fire("node_backup")
check("and goes when it is free", [size(http.reqs), http.reqs[-1][0]], [n + 1, "PUT"])
http.answer(204, "")
hello()
check("then nothing is left to go", [persist.store["panel_backup"]["dirty"], b.state()["pending"]], [false, false])

# --- the server lost it --------------------------------------------------------------------------
b.run("look", [])
http.answer(404, "not found\n")
check("a look that finds none: this panel's has no backup, and it waits for the round", [b.state()["pending"], b.state()["busy"], http.busy()], [true, "", false])
b.run("now", [])
http.answer(204, "")
hello()

# --- this panel's own backup, on a server not looked at yet -----------------------------------------
# As a panel flashed again finds it: kept until a change on the glass, and offered to restore
# a configuration the store can run: two zones on the Home, and a lamp (what a restore has to take)
def config_of()
    var doc = PanelStore.empty([8, 5])
    doc["devices"] = [["relay:1", "Lamp", "light", 1, 0, 0, "", 0, 0, 1]]
    doc["zones"] = [{"id": "z1", "name": "One", "screen": "home", "grid": 101, "members": {"relay:1": 101}, "buttons": [], "zid": 0, "zstate": {}},
                    {"id": "z2", "name": "Two", "screen": "home", "grid": 101, "members": {}, "buttons": [], "zid": 0, "zstate": {}}]
    doc["screens"][0]["cards"] = [["z:z1", 0, 0], ["z:z2", 1, 0]]
    return doc
end
def backup_of(at, extra)
    var keys = {"panel_config": config_of(),
                "panel_prefs": {"editing": false, "screensaver": [30, 120], "buttons": ["relay", "panel"]}}
    var doc = {"v": 1, "panel": NAME, "project": PROJECT, "from": "24:0A:C4:3E:51:A7", "at": at, "keys": keys}
    if extra != nil  for k: extra.keys() doc[k] = extra[k] end end
    return json.dump(doc)
end
house.srv = server_at("192.168.2.20", 8099)
b.every_second()
check("the server at another address: looked at", [http.reqs[-1][0], http.reqs[-1][1], http.reqs[-1][3]], ["GET", "192.168.2.20", "/api/backup"])
n = size(http.reqs)
http.answer(200, backup_of(1789000000, nil))
st = b.state()
check("this panel's own there: found, and kept -- nothing goes over it", [st["pending"], st["found"]["zones"], st["found"]["devices"], size(http.reqs), http.busy()], [false, 2, 1, n, false])
check("nor the server's Backup, with nothing to save", [server_says("backup")["backup"], size(http.reqs)], ["Up to date", n])

# --- the restore ------------------------------------------------------------------------------------
b.run("restore", [])
check("Restore: the backup fetched again, signed", [http.reqs[-1][0], signed(http.reqs[-1]), b.state()["busy"]], ["GET", true, "restoring"])
http.answer(200, backup_of(1789500000, nil))
check("one written since the owner saw it: not restored, and the new one shown", [b.state()["restore"], tasmota.cmds, b.state()["found"]["when"] != nil], ["Changed", [], true])
b.run("restore", [])
http.answer(200, backup_of(1789500000, nil))
check("the one seen: written in place of this panel's", [size(persist.store["panel_config"]["zones"]), persist.store["panel_prefs"]["editing"]], [2, false])
check("this panel's pattern kept", persist.store["panel_prefs"]["pattern"], ["salt1", "hash1"])
check("the texts it has not, left as they are", persist.store["panel_texts"], {"page1.t0": "Living room"})
check("the pair untouched", persist.store["zb_bridge_peer"]["mac"], "B0:B0:B0:00:00:01")
check("the configuration in memory kept from saving over it, the backup's buttons given to the driver, and the panel restarts",
      [store.readonly, tasmota.cmds], [true, ["ButtonDecoupleEnable 1", "ButtonDecouple1 0", "ButtonDecouple2 1", "Restart 1"]])
check("nothing to save after it, and the last one the one restored",
      [persist.store["panel_backup"]["fresh"], persist.store["panel_backup"]["dirty"], fields(persist.store["panel_backup"]["last"])],
      [false, false, [1789500000, 2, 1, "restore", "Home Assistant"]])
store.readonly = false
tasmota.cmds.clear()
persist.store["panel_config"] = store.doc
b.changed()
b.run("now", [])
check("a change on the glass then goes over its own", [http.reqs[-1][0], http.reqs[-1][1], http.reqs[-1][3]], ["PUT", "192.168.2.20", "/api/backup"])
http.answer(204, "")
hello()

# --- the server's Restore, and a hardware swap ------------------------------------------------
store.readonly = false
tasmota.cmds.clear()
persist.store["panel_config"] = store.doc
check("another panel's backup, for this one by name: taken (a hardware swap)", isinstance(b.part.check(backup_of(1, {"panel": "aabbccddeeff", "for": NAME})), map), true)
check("for another: not", b.part.check(backup_of(1, {"panel": "aabbccddeeff", "for": "aabbccddeeff"})), "Another panel's")
var asked = server_says("restore")
check("the server's Restore: the server's backup looked at first", [asked["restore"], http.reqs[-1][0], http.reqs[-1][3]], ["Looking", "GET", "/api/backup"])
http.answer(200, backup_of(1789700000, {"panel": "aabbccddeeff", "from": "AA:BB:CC:DD:EE:FF", "for": NAME}))
check("then fetched again, to restore", [http.reqs[-1][0], b.state()["busy"]], ["GET", "restoring"])
http.answer(200, backup_of(1789700000, {"panel": "aabbccddeeff", "from": "AA:BB:CC:DD:EE:FF", "for": NAME}))
check("the old panel's configuration in place of this one's, and the panel restarts", [size(persist.store["panel_config"]["zones"]), tasmota.cmds[-1]], [2, "Restart 1"])
check("and this one's own not saved until its first backup, which ends the swap", [persist.store["panel_backup"]["dirty"], persist.store["panel_backup"]["last"]["by"]], [true, "restore"])
store.readonly = false
tasmota.cmds.clear()
persist.store["panel_config"] = store.doc
b.run("now", [])
check("its own backup, by its own name", json.load(http.reqs[-1][4])["panel"], NAME)
http.answer(204, "")
hello()

# --- what is not restored ----------------------------------------------------------------------------
check("another panel's", b.part.check(backup_of(1, {"panel": "aabbccddeeff"})), "Another panel's")
check("another room's", b.part.check(backup_of(1, {"project": "p1-kitchen-eu-landscape"})), "Another room's")
check("the room's under its former name, a panel's flashed with the firmware before HouseWeave's", isinstance(b.part.check(backup_of(1, {"project": "p1-casa-sala-eu-landscape"})), map), true)
check("one room under either name, both ways, and nothing else", [PanelBackup.same_room("p1-casa-sala-us-portrait", "p1-living-room-us-portrait"),
      PanelBackup.same_room("p1-living-room-us-portrait", "p1-casa-sala-us-portrait"), PanelBackup.same_room("p1-casa-sala-us-portrait", "p1-living-room-eu-landscape"),
      PanelBackup.same_room(nil, "p1-living-room-eu-landscape"), PanelBackup.same_room(nil, nil)], [true, true, false, false, true])
check("another format", b.part.check(backup_of(1, {"v": 2})), "Not a backup")
check("not JSON", b.part.check("<html>"), "Not a backup")
check("a key the backup never carries", b.part.check(json.dump({"v": 1, "panel": NAME, "project": PROJECT, "keys": {"zb_bridge_peer": {"mac": "x"}}})), "Not a backup")
check("a configuration of a newer version", b.part.check(json.dump({"v": 1, "panel": NAME, "project": PROJECT, "keys": {"panel_config": {"v": 99}}})), "Newer version")
house.srv = server_at("192.168.2.30", 8080)
b.every_second()
n = size(http.reqs)
http.answer(200, backup_of(1, {"project": "p1-kitchen-eu-landscape"}))
check("one there the panel cannot read: said, and not written over until a change", [b.state()["result"], b.state()["pending"], size(http.reqs), http.busy()],
      ["Another room's", false, n, false])
b.run("restore", [])
check("nor restored", http.busy(), false)

# --- another server, with a key the driver makes no pair of ------------------------------------------
house.srv = {"id": 9, "host": "192.168.2.40", "port": 8099, "name": "Server 2", "key": bytes("1111111111111111111111111111111111111111111111111111111111111111")}
n = size(http.reqs)
b.every_second()
check("another server: no pair, so nothing asked of it", [size(http.reqs), b.state()["server"], b.state()["pending"]], [n, "Server 2", true])
b.run("now", [])
check("and Back up now says so", [size(http.reqs), b.state()["result"]], [n, "No pair"])
# back on the server, with this panel's own backup found there and kept
house.srv = server_at("192.168.2.30", 8080)
b.every_second()
http.answer(200, backup_of(1790000000, nil))

# --- a backup that would leave the panel dead is not one to restore -------------------------------------------
# the checks the restore makes go past the version: the configuration has to be one the store runs, and the preferences the types
# the boot reads them as. A backup of a panel that had such a configuration is "Damaged", and nothing is written
def damaged_checks()
    var with = def (config, prefs)
        var keys = {}
        if config != nil  keys["panel_config"] = config end
        if prefs != nil  keys["panel_prefs"] = prefs end
        return json.dump({"v": 1, "panel": NAME, "project": PROJECT, "from": "24:0A:C4:3E:51:A7", "at": 1790000000, "keys": keys})
    end
    var sound = config_of()
    check("a configuration the store runs, and preferences of the types the boot reads: a backup", isinstance(b.part.check(with(sound, {"editing": true, "buttons": ["panel", "relay"],
          "screensaver": [60, 300], "keyboard_kind": "qwerty", "live_slider_update": false, "flags": {}, "clock": {"tz": -3}, "alarm_sounds": "off"})), map), true)
    check("a backup of a version of the document that is old, upgraded as the store would", isinstance(b.part.check(with({"v": 6, "matrix": 508, "devices": [], "screens": [{"id": "home", "title": "Home", "cards": []}],
          "zones": [], "buttonGroups": [], "nextZid": 1, "seq": 1}, nil)), map), true)
    var bad = []
    var damaged = def (name, config, prefs)
        var got = b.part.check(with(config, prefs))
        if got != "Damaged"  bad.push(name + ": " + str(got)) end
    end
    damaged("only a version", {"v": 7}, nil)
    var no_screens = config_of()
    no_screens["screens"] = []
    damaged("no screens", no_screens, nil)
    var text_grid = config_of()
    text_grid["zones"][0]["grid"] = "3x4"
    damaged("a grid in text", text_grid, nil)
    var no_zones = config_of()
    no_zones["zones"] = "z"
    damaged("zones in text", no_zones, nil)
    var short_device = config_of()
    short_device["devices"] = [["d1", "Lamp"]]
    damaged("a device of two fields", short_device, nil)
    var events = config_of()
    events["events"] = "x"
    damaged("events in text", events, nil)
    damaged("buttons in text", sound, {"buttons": "relay"})
    damaged("buttons of three", sound, {"buttons": ["relay", "relay", "panel"]})
    damaged("a button that is neither", sound, {"buttons": ["relay", "mine"]})
    damaged("editing in text", sound, {"editing": "yes"})
    damaged("a screensaver of one time", sound, {"screensaver": [30]})
    damaged("a screensaver in text", sound, {"screensaver": "30"})
    damaged("flags in a list", sound, {"flags": [1]})
    damaged("a keyboard that is a number", sound, {"keyboard_kind": 3})
    damaged("a pattern in text", sound, {"pattern": "ab"})
    check("every one of them damaged, and said so", bad, [])
end
damaged_checks()

# --- a restore the file could not take: said, and the panel does not restart -------------------------------------
def unwritten_restore_checks()
    var config = persist.store["panel_config"]
    var prefs = persist.store["panel_prefs"]
    store.readonly = false
    tasmota.cmds.clear()
    b.run("look", [])
    http.answer(200, backup_of(1790000000, nil))
    b.run("restore", [])
    persist.fail_next()
    var fails = persist.failures
    http.answer(200, backup_of(1790000000, nil))
    check("a restore whose write fails: said so", [persist.failures, b.state()["restore"], b.state()["busy"]], [fails + 1, "Not saved", ""])
    check("the panel does not restart, and the buttons are not given to the driver", tasmota.cmds, [])
    check("and the configuration in memory is still kept from saving over the backup's", store.readonly, true)
    # a store that is readonly saves nothing of its own, which is the point: the pending save would write the old document over it
    var saved = persist.saves
    store.save_now()
    check("so a save of the store's is refused", persist.saves, saved)
    # the owner tries again: the file takes it, and the panel restarts
    store.readonly = false
    b.run("restore", [])
    http.answer(200, backup_of(1790000000, nil))
    check("the next try, with a file that works: restored, and restarted", [b.state()["restore"], tasmota.cmds[-1]], ["", "Restart 1"])
    store.readonly = false
    tasmota.cmds.clear()
    persist.store["panel_config"] = config
    persist.store["panel_prefs"] = prefs
    persist.written = nil
end
unwritten_restore_checks()

# a panel on a configuration it did not take has none of its own to back up: the one in the file would go over the server's
# good one
def readonly_checks()
    persist.store["panel_backup"]["fresh"] = false
    persist.store["panel_backup"]["dirty"] = true
    var reqs = size(http.reqs)
    store.readonly = true
    check("a readonly store: no backup is begun", [b.put(), b.state()["busy"], size(http.reqs)], [false, "", reqs])
    store.readonly = false
    check("and one that is not goes, as it did", [b.put(), size(http.reqs)], [true, reqs + 1])
    http.answer(204, "")
    hello()
end
readonly_checks()

# --- a failure said again is written once -------------------------------------------------------------------------
def repeated_failure_checks()
    persist.store["panel_backup"]["result"] = ""
    b.failed("No answer")
    var saves = persist.saves
    b.failed("No answer")
    b.failed("No answer")
    check("the same word at every try: the file is not written for it", [persist.saves, b.state()["result"]], [saves, "No answer"])
    b.failed("Low memory")
    check("a different word is a change, and is written", [persist.saves, b.state()["result"]], [saves + 1, "Low memory"])
    # the server that does not answer, looked at again and again
    persist.store["panel_backup"]["result"] = ""
    b.run("look", [])
    http.answer(503, "down\n")
    saves = persist.saves
    b.run("look", [])
    http.answer(503, "down\n")
    check("a look that is refused again: the same word, not written", [b.state()["result"], persist.saves], ["HTTP 503", saves])
    persist.store["panel_backup"]["result"] = ""
end
repeated_failure_checks()

# --- the topic of the panel's own, for the schedule's word on the house's MQTT (panel_schedule_mqtt.be) --------------------------
check("a topic as Tasmota's FullTopic makes it", PanelBackup.own_topic("Prefix1", "Schedule"), "cmnd/tasmota_3E51A7/Schedule")
tasmota.answers["FullTopic"] = "%prefix%/%hostname%/%topic%/%id%/"
check("a FullTopic of Tasmota's other tokens", PanelBackup.own_topic("Prefix1", "Schedule"), "cmnd/nspanel-living/tasmota_3E51A7/240AC43E51A7/Schedule")
tasmota.answers["FullTopic"] = "%prefix%/%topic%/"

# --- the boot ----------------------------------------------------------------------------------------
persist.store["panel_backup"]["dirty"] = true
tasmota.timers.clear()
n = size(http.reqs)
var again = NodeBackup(PanelBackup(PROJECT, store), http, link)
check("a change the last boot had no time to back up waits for the round: nothing asked, nothing scheduled",
      [size(http.reqs), tasmota.timers.size(), again.state()["pending"]], [n, 0, true])
house.srv = nil
again.every_second()
check("no server: nothing to go", [persist.store["panel_backup"]["server"], persist.store["panel_backup"]["dirty"], again.state()["server"]], ["", false, ""])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
