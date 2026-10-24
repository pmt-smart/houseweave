# berry/node_backup.be with berry/bridge_backup.be, a bridge's configuration kept on the house's server, against requests the test
# answers: what goes (its devices' names, the alarm, the drivers, the discovery) and what never does, the fingerprint the round compares (the bridge
# says nothing of its changes), and the restore, which puts the backup's whole in place of what the bridge has.

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
def fields(m) return [m.find("at"), m.find("zones"), m.find("devices"), m.find("by"), m.find("server")] end

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

class BridgeTasmota : TasmotaStub
    var timers, cmds, commands, resp, group
    def init() self.timers = TimerBook(self) self.cmds = [] self.commands = {} self.group = 4 end
    def wifi() return {"up": true, "mac": "B0:B0:B0:00:00:05", "ip": "192.168.2.115"} end
    def memory() return {"heap_free": 100} end
    # the mesh driver's status, with the version of the house's key; any other command, run
    def cmd(c, mute)
        if c == "_EspNowMeshStatus" return {"EspNowMeshStatus": {"GroupVersion": self.group}} end
        self.cmds.push(c)
    end
    def add_cmd(name, f) self.commands[name] = f end
    def resp_cmnd(s) self.resp = s end
end
tasmota = BridgeTasmota()
tasmota.utc_now = 1790000000

var K = bytes("463c97311c85ec6df2640aeefc4be01b89b330283b2fb200af9ff9bc1e7dd238")
var SERVER_PUB = bytes("b0d08f35b4683381489afb32825e59152d47d19bc9e050d6d5a954984c9d1e2c")
global.espnow_mesh_pair_key = def (pub) return pub == SERVER_PUB ? K : false end
class FakeList
    var me, rev
    def init() self.me = 5 self.rev = 0 end
end
class FakeHouse
    var up, list, srv
    def init() self.up = true self.list = FakeList() end
    def server() return self.srv end
end
var house = FakeHouse()

var NAME = "b0b0b0000005"
persist.store["zb_relay_names"] = {"0x1234": "Lamp", "0x5678": "Door"}
persist.store["zb_alarm_cfg"] = {"entry": 30}
persist.store["zb_relay_drivers"] = {"0x1234": "twokey"}
persist.store["zb_bridge_peer"] = {"mac": "AA:AA:AA:00:00:01", "webpw": "k7m3q9t2wx"}
persist.store["house_key"] = "0123456789abcdef"
var http = FakeHttp()
var hellos = FakeHttp()
var b = nil
var link = ServerLink(/ -> house, hellos, / -> {"role": "bridge", "backup": b.brief()}, nil)
b = NodeBackup(BridgeBackup(), http, link)

var nonces = 0
def server_says(verb)
    nonces += 1
    var nonce = "n" + str(nonces)
    var t = tasmota.utc_now
    return link.answer(json.dump({"v": 1, "verb": verb, "t": t, "nonce": nonce, "mac": ServerLink.hmac(K, "houseweave-do|" + verb + "|" + str(t) + "|5|" + nonce)}))
end
def hello()
    if !hellos.busy() return nil end
    var said = json.load(hellos.reqs[-1][4])
    hellos.answer(200, "")
    return said
end

# --- the server, and nothing on it -----------------------------------------------------------------
house.srv = {"id": 8, "host": "192.168.2.10", "port": 8099, "name": "Home Assistant", "key": SERVER_PUB}
b.every_second()
check("the server looked at first, by the bridge's number", [http.reqs[-1][0 .. 3], http.reqs[-1][5]["X-HouseWeave-Node"]], [["GET", "192.168.2.10", 8099, "/api/backup"], "5"])
http.answer(404, "not found\n")
check("none there: the bridge's to go, at the round", [b.state()["pending"], size(http.reqs)], [true, 1])

# --- the round -------------------------------------------------------------------------------------
var a = server_says("round")
var sent = json.load(http.reqs[-1][4])
check("the round: the backup goes", [a["backup"], http.reqs[-1][0], http.reqs[-1][3]], ["Saving", "PUT", "/api/backup"])
check("the backup: the format, the bridge, who and when", [sent["v"], sent["bridge"], sent["from"], sent["at"]], [1, NAME, "B0:B0:B0:00:00:05", 1790000000])
check("with the names, the alarm and the drivers it has, and nothing else",
      sent["keys"], {"zb_relay_names": {"0x1234": "Lamp", "0x5678": "Door"}, "zb_alarm_cfg": {"entry": 30}, "zb_relay_drivers": {"0x1234": "twokey"}})
check("neither the pair's record nor the house's key", [string.find(http.reqs[-1][4], "k7m3q9t2wx"), string.find(http.reqs[-1][4], "0123456789abcdef")], [-1, -1])
http.answer(204, "")
var said = hello()
check("saved: what it carried, who asked and where, and the fingerprint of what it held",
      [fields(persist.store["bridge_backup"]["last"]), persist.store["bridge_backup"]["fp"], size(persist.store["bridge_backup"]["fp"])],
      [[1790000000, 0, 2, "round", "Home Assistant"], b.part.fingerprint(), 64])
check("and the server told, by a bridge", [said["role"], said["kind"], said["node"], said["backup"]], ["bridge", "backup", 5, {"at": 1790000000, "dirty": false}])
var n = size(http.reqs)
check("a round with nothing changed: nothing goes", [server_says("round")["backup"], size(http.reqs)], ["Up to date", n])

# --- a change the bridge says nothing of ----------------------------------------------------------
persist.store["zb_relay_names"]["0x1234"] = "Ceiling"
check("a device renamed: the bridge says nothing, and the screen knows nothing yet", b.state()["pending"], false)
check("the round compares the fingerprint, and the change goes", server_says("round")["backup"], "Saving")
check("with the new name", json.load(http.reqs[-1][4])["keys"]["zb_relay_names"]["0x1234"], "Ceiling")
http.answer(204, "")
hello()
persist.store["zb_relay_expire"] = {"0x5678": 3600}
b.run("now", [])
check("Back up now, from a panel's touch on the bridge's Wireless settings: the change found, at once", [http.reqs[-1][0], json.load(http.reqs[-1][4])["keys"].contains("zb_relay_expire")],
      ["PUT", true])
http.answer(204, "")
hello()
check("asked on the glass", persist.store["bridge_backup"]["last"]["by"], "glass")
n = size(http.reqs)
b.run("now", [])
check("and again with nothing changed: nothing", size(http.reqs), n)

# --- the restore -----------------------------------------------------------------------------------
def backup_of(at, extra)
    var doc = {"v": 1, "bridge": NAME, "from": "B0:B0:B0:00:00:05", "at": at,
               "keys": {"zb_relay_names": {"0x1234": "Old lamp"}, "zb_alarm_cfg": {"entry": 45}}}
    if extra != nil  for k: extra.keys() doc[k] = extra[k] end end
    return json.dump(doc)
end
check("another bridge's", b.part.check(backup_of(1, {"bridge": "aabbccddeeff"})), "Another bridge's")
check("another format", b.part.check(backup_of(1, {"v": 2})), "Not a backup")
check("not JSON", b.part.check("<html>"), "Not a backup")
check("a key the backup never carries", b.part.check(json.dump({"v": 1, "bridge": NAME, "keys": {"house_key": "x"}})), "Not a backup")
b.run("look", [])
http.answer(200, backup_of(1789000000, nil))
check("the server's backup looked at: one device named", [b.state()["found"]["devices"], b.state()["found"]["zones"]], [1, 0])
b.run("restore", [])
http.answer(200, backup_of(1789000000, nil))
check("restored: the backup's whole, and what it had not taken out",
      [persist.store["zb_relay_names"], persist.store["zb_alarm_cfg"], persist.find("zb_relay_drivers"), persist.find("zb_relay_expire")],
      [{"0x1234": "Old lamp"}, {"entry": 45}, nil, nil])
check("the rest of the bridge untouched", [persist.store["zb_bridge_peer"]["mac"], persist.store["house_key"]], ["AA:AA:AA:00:00:01", "0123456789abcdef"])
check("and the bridge restarts", tasmota.cmds, ["Restart 1"])
check("the last one the one restored, and its fingerprint the restored one's",
      [fields(persist.store["bridge_backup"]["last"]), persist.store["bridge_backup"]["fp"]], [[1789000000, 0, 1, "restore", "Home Assistant"], b.part.fingerprint()])
n = size(http.reqs)
check("so the round after it finds no change", [server_says("round")["backup"], size(http.reqs)], ["Up to date", n])

# --- the Tasmota settings (node_settings.be) ------------------------------------------------------------------------
# the mesh driver's sealing, as the test stands for it: the bytes turned (xor 0x5A) under the version of the house's key in use, and opened only under
# the label and a version the node holds (the one in use, or the previous one)
var held = [4]
def turned(b)
    var out = bytes()
    for i: 0 .. size(b) - 1  out.add(b[i] ^ 0x5A, 1) end
    return out
end
global.espnow_mesh_group_seal = def (label, data) return [tasmota.group, turned(data)] end
global.espnow_mesh_group_open = def (label, v, sealed) return label == "tasmota-settings" && held.find(v) != nil ? turned(sealed) : false end
# a settings block of Tasmota's size, its header 0x5A 0x5A
def block(fill)
    var b = bytes()
    b.resize(4096)
    b[0] = 0x5A
    b[1] = 0x5A
    for i: 2 .. 4095  b[i] = fill end
    return b
end
def write_block(b)
    var f = open(TEST_TMP + "/settings.bin", "wb")
    f.write(b)
    f.close()
end
b.settings = NodeSettings(TEST_TMP + "/settings.bin")
write_block(block(1))
check("the settings found: a change at the round", server_says("round")["backup"], "Saving")
var put = json.load(http.reqs[-1][4])
check("the backup carries them sealed, under the version of the house's key", [put["settings"]["v"], put["settings"]["kv"], turned(bytes().fromb64(put["settings"]["d"])) == block(1)],
      [1, 4, true])
check("and never in the clear", string.find(http.reqs[-1][4], block(1)[0 .. 63].tob64()), -1)
http.answer(204, "")
hello()
n = size(http.reqs)
var bumped = block(1)
bumped[0x00C] = 7
bumped[0xFF8] = 9
bumped[0x2E8] = 1
write_block(bumped)
check("what Tasmota changes by itself (the boot count, the time of a save, the relays): no change", [server_says("round")["backup"], size(http.reqs)], ["Up to date", n])
var owner = block(1)
owner[0x100] = 2
write_block(owner)
check("what the owner changed: at the round", server_says("round")["backup"], "Saving")
http.answer(204, "")
hello()
tasmota.group = 5
held = [4, 5]
check("the house's key changed: sealed again at the round", [server_says("round")["backup"], json.load(http.reqs[-1][4])["settings"]["kv"]], ["Saving", 5])
http.answer(204, "")
hello()
# the restore: the backup's settings written in place of these, and the restart that does not save over them
def sealed_backup(at, kv, b)
    var doc = json.load(backup_of(at, nil))
    doc["settings"] = {"v": 1, "kv": kv, "d": turned(b).tob64()}
    return json.dump(doc)
end
tasmota.cmds.clear()
b.run("look", [])
http.answer(200, sealed_backup(1789100000, 5, block(3)))
b.run("restore", [])
http.answer(200, sealed_backup(1789100000, 5, block(3)))
check("restored with its settings: written, and Restart 99, which does not save the ones in memory over them",
      [b.settings.read() == block(3), tasmota.cmds, persist.store["bridge_backup"]["last"]["settings"]], [true, ["Restart 99"], true])
check("and no change for the next round", server_says("round")["backup"], "Up to date")
# a backup whose settings were sealed under a key this node does not hold: the rest restored, these left as they are
tasmota.cmds.clear()
held = [5]
write_block(block(1))
b.run("look", [])
http.answer(200, sealed_backup(1789200000, 2, block(4)))
b.run("restore", [])
http.answer(200, sealed_backup(1789200000, 2, block(4)))
check("settings of a key gone: the rest restored, these as they were, and its own restart",
      [b.settings.read() == block(1), tasmota.cmds, persist.store["bridge_backup"]["last"]["settings"], persist.store["zb_relay_names"]], [true, ["Restart 1"], false, {"0x1234": "Old lamp"}])
check("what is no block of settings is not one to write", [b.settings.opened({"v": 1, "kv": 5, "d": turned(bytes("5A5A00")).tob64()}), b.settings.opened({"v": 2}),
      b.settings.opened({"v": 1, "kv": 5, "d": turned(block(1)).tob64()}) == block(1)], ["Not settings", "Not settings", true])
var other = block(1)
other[0] = 0x11
check("nor a block of another header", b.settings.opened({"v": 1, "kv": 5, "d": turned(other).tob64()}), "Not settings")
# a hardware swap: another bridge's backup, for this one by name, with this bridge's own Zigbee network kept
held = [5]
write_block(block(1))
var theirs = block(6)
for i: 0xF18 .. 0xF33  theirs[i] = 0x77 end
def swap_backup(at)
    var doc = json.load(backup_of(at, {"bridge": "aabbccddeeff", "for": NAME}))
    doc["settings"] = {"v": 1, "kv": 5, "d": turned(theirs).tob64()}
    return json.dump(doc)
end
tasmota.cmds.clear()
b.run("look", [])
http.answer(200, swap_backup(1789300000))
b.run("restore", [])
http.answer(200, swap_backup(1789300000))
var now = b.settings.read()
check("another bridge's settings, but its own Zigbee network: the PAN, the key, the channel and the radio's power",
      [now[0xF18 .. 0xF33] == block(1)[0xF18 .. 0xF33], now[0x100] == 6, now[0xF34] == 6, tasmota.cmds], [true, true, true, ["Restart 99"]])
check("and its own not saved until its first backup", persist.store["bridge_backup"]["dirty"], true)
n = size(http.reqs)

# --- the boot ----------------------------------------------------------------------------------------
persist.store["bridge_backup"]["dirty"] = true
tasmota.timers.clear()
var again = NodeBackup(BridgeBackup(), http, link)
check("a change not backed up before a restart waits for the round", [size(http.reqs), tasmota.timers.size(), again.state()["pending"]], [n, 0, true])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
