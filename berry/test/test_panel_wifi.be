# berry/panel_wifi.be, the Wi-Fi of Wireless settings, against a
# Tasmota that answers the commands it sends as the firmware does: what the
# boot turns off, what each operation sends, and what the views are given to
# draw. What the radio then does is the device's, and the bench's.

import persist
import json
import string

# the commands the Wi-Fi sends, and the answers of a panel with `networks` saved,
# and, with `station`, the station driver's
class WifiTasmota : TasmotaStub
    var cmds, networks, config, up, station, reason, hotspot
    def init() self.cmds = [] self.networks = ["", ""] self.config = "4 (Retry)" self.up = false self.station = false self.reason = "" self.hotspot = nil end
    def cmd(c)
        self.cmds.push(c)
        if c == "StaState"
            return self.station ? {"StaState": {"State": "Idle", "Hold": 0, "Radio": 0, "Reason": self.reason, "Code": 0}} : {"Command": "Unknown"}
        end
        if c == "StaScan" return {"StaScan": "Started"} end
        if string.find(c, "StaJoin ") == 0 return {"StaJoin": "Joining"} end
        if c == "SSId" return {"SSId1": self.networks[0], "SSId2": self.networks[1]} end
        if c == "SSId1" return {"SSId1": self.networks[0]} end
        if c == "WifiConfig" return {"WifiConfig": self.config} end
        # the station driver's hotspot, as a test has it answer
        if string.find(c, "StaHotspot {") == 0 return self.hotspot end
        if c == "StaHotspot 0" return {"StaHotspot": {"State": "Off"}} end
        return nil
    end
    def wifi()
        if !self.up return {"mac": "24:0A:C4:3E:51:A7", "up": false} end
        return {"mac": "24:0A:C4:3E:51:A7", "up": true, "ip": "192.168.2.110", "rssi": -58, "quality": 84, "ssid": self.networks[0]}
    end
    def hostname() return "tasmota-3E51A7-6960" end
end

class FakeBridge
    var mode
    def init(m) self.mode = m end
end

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

# a fresh panel: the persist emptied, and a Tasmota with these networks saved,
# with the station driver or without it. What the Wi-Fi asks of the firmware to
# know which it has is not what the checks look at.
def fresh(networks, station)
    persist.store = {}
    tasmota = WifiTasmota()
    tasmota.networks = networks
    tasmota.station = station == true
    var w = PanelWifi(FakeBridge("off"))
    tasmota.cmds.clear()
    return w
end

def boot_checks()
    # --- the boot ------------------------------------------------------------------
    var w = fresh(["", ""])
    w.at_boot()
    check("with no network saved the radio stays off", tasmota.cmds, ["SSId", "Wifi 0"])
    w = fresh(["Cottage", ""])
    w.at_boot()
    check("with one saved, Tasmota goes to it", tasmota.cmds, ["SSId"])
    check("and the glass knows its name", w.saved, "Cottage")
    w = fresh(["", "Hotspot"])
    w.at_boot()
    check("Ssid2 alone is a network too: the glass leaves it to Tasmota", tasmota.cmds, ["SSId"])
    w = fresh(["", ""])
    w.zb = FakeBridge("mesh")
    w.at_boot()
    check("with no network but the Zigbee of the house's bridges, the radio stays on for the mesh", tasmota.cmds, ["SSId"])
    w = fresh(["Cottage", ""])
    persist.setmember("panel_wifi", {"off": true})
    w.at_boot()
    check("turned off on the glass, it stays off after a reboot", tasmota.cmds, ["SSId", "Wifi 0"])
    # a network saved since the Disconnect, on Tasmota's page, ends it
    w = fresh(["Cottage", ""])
    persist.setmember("panel_wifi", {"off": true, "offSsid": "Cottage"})
    w.at_boot()
    check("with the same network saved, it stays off", [tasmota.cmds, persist.find("panel_wifi")["off"]], [["SSId", "Wifi 0"], true])
    w = fresh(["Neighbour", ""])
    persist.setmember("panel_wifi", {"off": true, "offSsid": "Cottage"})
    w.at_boot()
    check("with another saved since, the radio stays on for it", [tasmota.cmds, persist.find("panel_wifi")], [["SSId"], {"off": false}])
    w = fresh(["Cottage", ""])
    persist.setmember("panel_wifi", {"config": 5})
    w.at_boot()
    check("a web setup's restart gives Tasmota's tool back, first", tasmota.cmds, ["WifiConfig 5", "SSId"])
    check("once", persist.find("panel_wifi"), {})
    # the way back when the glass cannot reach the panel
    w = fresh(["", ""])
    w.at_boot()
    tasmota.cmds.clear()
    w.rescue()
    check("the rescue gives the radio back to Tasmota: the console reaches the panel", tasmota.cmds, ["StaHold 0", "Wifi 1"])
    check("and keeps nothing of it", persist.find("panel_wifi", {}), {})
end

def run_checks()
    # --- what the views ask for --------------------------------------------------------
    var w = fresh(["Cottage", ""])
    w.at_boot()
    tasmota.cmds.clear()
    w.run("off")
    check("Disconnect: the radio off", tasmota.cmds, ["Wifi 0"])
    check("and kept for the next boot, with the network's name", [persist.find("panel_wifi")["off"], persist.find("panel_wifi")["offSsid"]], [true, "Cottage"])
    tasmota.cmds.clear()
    w.run("on")
    check("Reconnect: the radio on, to the network saved", tasmota.cmds, ["Wifi 1"])
    check("and no longer off", persist.find("panel_wifi"), {"off": false})
    tasmota.cmds.clear()
    w.run("forget")
    check("Forget: the radio off, and the network emptied (Tasmota restarts for it)", tasmota.cmds, ["Wifi 0", 'Backlog0 Password1 "; SSId1 "'])
    check("the glass has no network", w.saved, "")
    check("and nothing turned off to remember", persist.find("panel_wifi")["off"], false)

    w = fresh(["", ""])
    w.at_boot()
    tasmota.cmds.clear()
    w.run("web")
    check("Web setup: the tool read, the radio on and the Wi-Fi Manager", tasmota.cmds, ["WifiConfig", "Wifi 1", "WifiConfig 2"])
    check("the tool it replaces is kept for the boot after", persist.find("panel_wifi")["config"], 4)
    check("and the views know it is up", w.web, true)
    tasmota.cmds.clear()
    w.run("stopWeb")
    check("its way out is a restart", tasmota.cmds, ["Restart 1"])
    # a Disconnect stays through a web setup that saves nothing
    w = fresh(["Cottage", ""])
    w.at_boot()
    w.run("off")
    w.run("web")
    check("a web setup opened after a Disconnect does not end it", persist.find("panel_wifi")["off"], true)

    check("a WifiConfig that cannot be read is Tasmota's default", PanelWifi.config_of(nil), 4)
    check("and one that can, its number", PanelWifi.config_of({"WifiConfig": "5 (Wait)"}), 5)
end

def state_checks()
    # --- what the views draw -------------------------------------------------------------
    var w = fresh(["Cottage", ""])
    w.at_boot()
    var st = w.state()
    check("off the network: the name saved, and down", [st["saved"], st["up"], st["off"], st["web"]], ["Cottage", false, false, false])
    check("the MAC, and the network the web setup would open", [st["mac"], st["ap"]], ["24:0A:C4:3E:51:A7", "tasmota-3E51A7-6960"])
    check("no search in this firmware", st["search"], false)
    check("and the Zigbee's mode", st["zigbee"], "off")
    tasmota.up = true
    st = w.state()
    check("on it: the address and the signal", [st["up"], st["ssid"], st["ip"], st["quality"]], [true, "Cottage", "192.168.2.110", 84])
    check("a panel without the transport has Zigbee off", PanelWifi(nil).zigbee_mode(), "off")
end

def station_checks()
    # --- with the station driver -------------------------------------------
    var w = fresh(["", ""], true)
    check("the driver is found", w.station, true)
    check("and the views know they can search", w.state()["search"], true)
    tasmota.cmds.clear()
    w.at_boot()
    check("with no network the radio stays off", tasmota.cmds, ["SSId", "Wifi 0"])
    w = fresh(["", ""], true)
    w.zb = FakeBridge("mesh")
    w.at_boot()
    check("with no network and a bridge in the house, the radio is held on, with no network, for the mesh", tasmota.cmds, ["SSId", "Wifi 0", "StaHold 1"])
    w = fresh(["Cottage", ""], true)
    w.zb = FakeBridge("mesh")
    persist.setmember("panel_wifi", {"off": true})
    w.at_boot()
    check("turned off with a bridge in the house: held too", tasmota.cmds, ["SSId", "Wifi 0", "StaHold 1"])
    tasmota.cmds.clear()
    w.run("forget", [])
    check("Forget with the driver: no restart, and the radio held for the mesh", tasmota.cmds, ["StaForget", "StaHold 1"])
    check("the glass has no network", w.saved, "")

    w = fresh(["Cottage", ""], true)
    w.at_boot()
    tasmota.cmds.clear()
    w.run("off", [])
    check("Disconnect with no bridge in the house: the radio off, and nothing held", tasmota.cmds, ["Wifi 0"])
    w.run("on", [])
    tasmota.cmds.clear()
    w.run("scan", [])
    check("the search", [tasmota.cmds, w.scanning], [["StaScan"], true])
    w.scanned({"Networks": [["Cottage", -58, 3, 6, "AA:BB:CC:DD:EE:01"], ["broken"]]})
    check("what it found, and nothing malformed", w.networks, [["Cottage", -58, 3, 6, "AA:BB:CC:DD:EE:01"]])
    check("and it is over", w.scanning, false)
    w.run("endSearch", [])
    check("the networks' view closed: what the search found goes with it", w.networks, nil)
    w.scanned({"Networks": [["Late", -60, 3, 1, "AA:BB:CC:DD:EE:09"]]})
    check("and a report still on its way is not kept", w.networks, nil)

    tasmota.cmds.clear()
    w.run("join", ["Cottage", "secret123", 6, "AA:BB:CC:DD:EE:01"])
    check("the join, one command", size(tasmota.cmds), 1)
    var q = json.load(tasmota.cmds[0][8 ..])
    check("with the network, the password and the access point found", [q["SSId"], q["Password"], q["Channel"], q["BSSId"]],
          ["Cottage", "secret123", 6, "AA:BB:CC:DD:EE:01"])
    check("joining", w.join["state"], "joining")
    w.joined({"State": "Failed", "SSId": "Cottage", "Reason": "WrongPassword", "Code": 15})
    check("a failure says why, and keeps what was typed for Try again", [w.join["state"], w.join["reason"], w.join["password"]],
          ["failed", "WrongPassword", "secret123"])
    w.joined({"State": "Connected", "SSId": "Cottage", "IP": "192.168.2.110"})
    check("a join that works: the network saved, and the join over", [w.saved, w.join], ["Cottage", nil])
    check("and the radio no longer off", persist.find("panel_wifi")["off"], false)

    tasmota.cmds.clear()
    w.run("join", ["Cottage", "abc", 0, ""])
    check("a password shorter than 8 is refused before any command", [tasmota.cmds, w.join["reason"]], [[], "TooShort"])
    w.run("join", ["Cafe", "", 1, ""])
    q = json.load(tasmota.cmds[0][8 ..])
    check("an open network goes with no password, and no access point without its address",
          [q["SSId"], q["Password"], q.contains("Channel"), q.contains("BSSId")], ["Cafe", "", false, false])
    w.run("endJoin", [])
    check("the join's view closed: nothing typed kept", w.join, nil)
    tasmota.reason = "WrongPassword"
    check("why the network saved does not come up", w.state()["reason"], "WrongPassword")
    tasmota.up = true
    check("and nothing to say once it is up", w.state()["reason"], "")
end

# the hotspot: the driver's own access point, with a password drawn each time
def hotspot_checks()
    tasmota = WifiTasmota()
    tasmota.station = true
    tasmota.networks = ["Cottage", ""]
    tasmota.up = true
    var w = PanelWifi(nil)
    tasmota.hotspot = {"StaHotspot": {"State": "Up", "SSId": "tasmota-3E51A7-6960", "Channel": 6, "IP": "192.168.4.1", "Clients": 0}}
    w.run("hotspot", ["hotspot"])
    var q = json.load(tasmota.cmds[-1][size("StaHotspot ") ..])
    check("the hotspot opened, named after the panel, with a password of 10", [q["SSId"], size(q["Password"])], ["tasmota-3E51A7-6960", 10])
    var h = w.state()["hotspot"]
    check("and up, with the password for the glass to show", [h["kind"], h["state"], h["password"], h["clients"]], ["hotspot", "up", q["Password"], 0])
    w.run("hotspot", ["web"])
    var q2 = json.load(tasmota.cmds[-1][size("StaHotspot ") ..])
    check("drawn again each time it opens", q2["Password"] != q["Password"], true)
    check("the web setup is the same hotspot", w.state()["hotspot"]["kind"], "web")
    w.hotspot_said({"State": "Up", "SSId": "tasmota-3E51A7-6960", "Channel": 6, "IP": "192.168.4.1", "Clients": 2})
    check("the phones on it, as the driver says", w.state()["hotspot"]["clients"], 2)
    w.hotspot_said({"State": "Off", "Reason": "Idle"})
    check("closed by itself, after 15 min with nobody on it", [w.hotspot["state"], w.hotspot["reason"], w.hotspot["clients"]], ["off", "Idle", 0])
    w.hotspot_said({"State": "Up", "Clients": 1})
    check("a closed one is not opened again by a report", w.hotspot["state"], "off")
    tasmota.hotspot = {"StaHotspot": "Busy"}
    w.run("hotspot", ["hotspot"])
    check("the WiFi Manager up: it does not open, and says why", [w.hotspot["state"], w.hotspot["reason"], w.hotspot["password"]], ["off", "Busy", ""])
    tasmota.hotspot = {"StaHotspot": {"State": "Up", "SSId": "tasmota-3E51A7-6960", "Channel": 6, "IP": "192.168.4.1", "Clients": 0}}
    w.run("hotspot", ["hotspot"])
    tasmota.cmds.clear()
    w.run("stopHotspot", [])
    check("Stop closes it with no restart", [tasmota.cmds, w.hotspot], [["StaHotspot 0"], nil])
    var drawn = PanelWifi.draw(300)
    var odd = false
    for i: 0 .. size(drawn) - 1
        if string.find("abcdefghjkmnpqrstuvwxyz23456789", drawn[i]) < 0 odd = true end
    end
    check("a password read off the glass: none of 0, o, 1, l or i", [size(drawn), odd], [300, false])
end

# What the glass keeps of the Wi-Fi is saved by the panel's one save: a file that cannot take it is a line in the log, and not an exception in the
# touch; what it chose is still in memory, for the next save to write
def unsaved_checks()
    var w = fresh(["Cottage", ""])
    w.at_boot()
    tasmota.cmds.clear()
    persist.plan = nil
    persist.fail_next()
    var raised = false
    try
        w.run("off")
    except .. as e, m
        raised = true
    end
    check("a Disconnect whose write fails: raises nothing, the radio goes off, and it is kept in memory", [raised, tasmota.cmds, persist.find("panel_wifi")["off"]], [false, ["Wifi 0"], true])
    persist.written = nil
end

boot_checks()
# the house gets its first bridge after the boot, or loses its last one: the hold made again (a panel
# factory reset with no network added its bridge, kept its radio off, and the bridge stayed in "No signal")
def hold_checks()
    var w = fresh(["", ""], true)
    w.at_boot()
    tasmota.cmds.clear()
    w.mode_changed()
    check("the house still has no bridge: nothing", tasmota.cmds, ["SSId"])
    w.zb = FakeBridge("mesh")
    tasmota.cmds.clear()
    w.mode_changed()
    check("its first bridge: the radio held with no network, for the mesh", tasmota.cmds, ["SSId", "StaHold 1"])
    tasmota.cmds.clear()
    w.mode_changed()
    check("once: the session that comes and goes changes nothing", tasmota.cmds, ["SSId"])
    w.zb = FakeBridge("off")
    tasmota.cmds.clear()
    w.mode_changed()
    check("its last bridge gone: the radio let go", tasmota.cmds, ["SSId", "StaHold 0"])
    var n = fresh(["Cottage", ""], true)
    n.at_boot()
    n.zb = FakeBridge("mesh")
    tasmota.cmds.clear()
    n.mode_changed()
    check("a panel on a network has its radio on by itself: nothing held", tasmota.cmds, ["SSId"])
end

run_checks()
state_checks()
station_checks()
hold_checks()
hotspot_checks()
unsaved_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
