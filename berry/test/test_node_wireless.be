# A node's Wireless settings as another panel shows them (node_wireless.be): the screens, what each touch does on the node, and what the
# panel that asks gets
var checks = 0
var failures = 0
def check(name, got, want)
    checks += 1
    if got != want
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# a node's state, as PanelWifi.state() and the house give it, and the effects a touch ran
def wifi_state()
    return {"saved": "", "ssid": "", "up": false, "ip": "", "quality": nil, "mac": "B0:B0:B0:00:00:01", "off": false, "web": false, "ap": "",
            "search": true, "reason": "", "scanning": false, "networks": nil, "join": nil, "hotspot": nil, "zigbee": "off"}
end
var st = {"wifi": wifi_state(), "radio": {"mesh": 11, "ap": 0, "off": 0, "why": 201}, "house_ch": 11, "alone": false, "mqtt": "Not connected", "backup": nil}
var ran = []
var sfn = / -> st
var run = def (e) for x: e ran.push(x) end end
def labels(r)
    var out = []
    for x: r[2]  out.push([x[0], x[1], x[2]]) end
    return out
end
def ask(view, k, x) return NodeWireless.answer(view, k, x, sfn, run) end

# Wireless settings
var r = ask(["wireless"], nil, nil)
check("Wireless settings: the Wi-Fi, the channel under it, the MQTT (the house's, opened on the panel that asks) and the web password",
      [r[1], labels(r), r[2][2][4], r[2][3][4]], ["Wireless settings", [["Wi-Fi", "None", 1], ["Channel", "11", 0], ["MQTT", "Not connected", 6], ["Web password", "", 3]],
      ["mqttOpen"], ["houseWebpw"]])
check("no `do` goes to the panel that asks: four parts a row, five with a target", [size(r[2][1]), size(r[2][0])], [4, 5])
st["radio"] = {"mesh": 3, "ap": 0, "off": 6, "why": 0}
r = ask(["wireless"], nil, nil)
check("a channel not the house's in the colour of what is wrong, and the access point off it, which opens the house's channel on the panel",
      [r[2][1][3], r[2][2][0 .. 2], r[2][2][3], r[2][2][4]], [2, ["Access point", "On channel 6", 3], 2, ["houseChannel"]])
st["radio"] = {"mesh": 11, "ap": 11, "off": 0, "why": 0}
st["backup"] = {"server": "", "busy": "", "pending": false, "last": nil, "found": nil}
check("a panel's backup is in its Wireless settings", labels(ask(["wireless"], nil, nil))[3], ["Backup", "No server", 1])
st["backup"] = nil

# the Wi-Fi, a network saved that is not found
st["wifi"]["saved"] = "Cottage"
st["wifi"]["reason"] = "NotFound"
r = ask(["wifi"], nil, nil)
check("a network saved that is not found: why, a new password, Connect, the hotspot, Forget, and its MAC", labels(r),
      [["Cottage", "Not found", 0], ["Change password", "", 4], ["Connect", "", 1], ["Hotspot", "", 2], ["Forget network", "", 5], ["MAC", "B0:B0:B0:00:00:01", 0]])
check("in the Wireless settings' row too", labels(ask(["wireless"], nil, nil))[0], ["Wi-Fi", "Not found", 1])
check("a touch that is a fact, or a screen to ask, is no touch here", [ask(["wifi"], 0, nil), ask(["wifi"], 2, nil)], [nil, nil])
check("a password not typed is no touch", ask(["wifi"], 1, nil), nil)
ran = []
r = ask(["wifi"], 1, {"t": "p4ssp4ss00"})
check("a new password typed on the panel: the node joins its network with it, and the join is the screen that follows", [ran, r[0], r[5].find("g")],
      [[["wifi", "join", "Cottage", "p4ssp4ss00", 0, ""]], ["wifiJoin"], 1])
ran = []
check("Forget, not asked first on the panel, does nothing", [ask(["wifi"], 4, nil), ask(["wifi"], 4, {"y": 0}), ran], [nil, nil, []])
r = ask(["wifi"], 4, {"y": 1})
check("asked first, it forgets the network, and the Wi-Fi is drawn again", [ran, r[0], r[5].find("g")], [[["wifi", "forget"]], ["wifi"], nil])
check("what Forget asks first, said on the panel", r[2][4][4], ["Forget the network?", "The Wi-Fi turns off. It stays on the mesh.", "Forget"])

# connected
st["wifi"]["up"] = true
st["wifi"]["ssid"] = "Cottage"
st["wifi"]["ip"] = "192.168.2.116"
st["wifi"]["quality"] = 62
st["wifi"]["rssi"] = -70
st["wifi"]["reason"] = ""
r = ask(["wifi"], nil, nil)
check("connected: the network, the signal, the address, another, Disconnect asked first, the hotspot, Forget", labels(r)[0 .. 6],
      [["Cottage", "Connected", 0], ["Signal", "-70 dBm", 0], ["IP address", "192.168.2.116", 0], ["Connect to another", "", 1], ["Disconnect", "", 5],
       ["Hotspot", "", 2], ["Forget network", "", 5]])
check("the signal in dBm, in the colour of its band: -70 is yellow", r[2][1][3], 12)
ran = []
ask(["wifi"], 4, {"y": 1})
check("Disconnect, asked first", ran, [["wifi", "off"]])
check("the address in the Wireless settings while connected", labels(ask(["wireless"], nil, nil))[0 .. 2], [["Wi-Fi", "Cottage", 1], ["Channel", "11", 0], ["IP address", "192.168.2.116", 0]])
st["wifi"]["up"] = false
st["wifi"]["off"] = true
r = ask(["wifi"], nil, nil)
check("off: Reconnect, which turns it on", [labels(r)[0 .. 1], (def () ran = [] ask(["wifi"], 1, nil) return ran end)()], [[["Cottage", "Off", 0], ["Reconnect", "", 2]], [["wifi", "on"]]])
st["wifi"]["off"] = false

# the search: the networks the node sees, searched as the screen is first asked
ran = []
r = ask(["wifiSearch"], nil, nil)
check("the networks' screen first asked: the node searches, and it says so, asked again in a moment", [ran, labels(r)[0], r[5].find("a")],
      [[["wifi", "scan"]], ["Searching", "", 0], NodeWireless.ASK_MS])
st["wifi"]["scanning"] = true
ran = []
ask(["wifiSearch"], nil, nil)
check("asked again while it searches: no search more", ran, [])
st["wifi"]["scanning"] = false
st["wifi"]["networks"] = [["Cottage", -55, 3, 11, "AA:00:00:00:00:01"], ["Neighbour", -70, 3, 6, "AA:00:00:00:00:02"], ["Lobby", -80, 0, 11, "AA:00:00:00:00:03"],
                          ["Office", -60, 5, 11, "AA:00:00:00:00:04"]]
r = ask(["wifiSearch"], nil, nil)
check("found: each with its signal; one on another channel than the house's takes no touch; an open one joins at a touch; one it cannot join is said so",
      [labels(r), r[5].find("a")], [[["Cottage", "-55 dBm, saved", 4], ["Neighbour", "Channel 6", 0], ["Lobby", "-80 dBm, open", 2], ["Office", "Not supported", 0],
       ["Search again", "", 2], ["Other network", "", 4]], nil])
ran = []
r = ask(["wifiSearch"], 0, {"t": "p4ssp4ss00"})
check("a network picked and its password typed: joined on its channel and access point", [ran, r[0]], [[["wifi", "join", "Cottage", "p4ssp4ss00", 11, "AA:00:00:00:00:01"]], ["wifiJoin"]])
st["alone"] = true
check("a node alone in its house follows any network", labels(ask(["wifiSearch"], nil, nil))[1], ["Neighbour", "-70 dBm", 4])
st["alone"] = false
var nets = ask(["wifiSearch"], nil, nil)
check("each network's signal in the colour of its band, and none for one that takes no touch", [nets[2][0][3], nets[2][1][3], nets[2][2][3]], [11, 0, 12])
r = ask(["wifiSearch"], 5, {"t": "Hidden"})
check("another network by its name: its password, or none, is asked next", [r[0], r[1], labels(r)], [["wifiAsk", "Hidden"], "Hidden", [["Password", "", 4], ["No password", "", 2]]])
ran = []
ask(["wifiAsk", "Hidden"], 1, nil)
check("with no password", ran, [["wifi", "join", "Hidden", "", 0, ""]])

# the join
st["wifi"]["join"] = {"ssid": "Cottage", "password": "x", "channel": 11, "bssid": "", "state": "joining", "reason": "", "until": tasmota.millis() + 20500}
r = ask(["wifiJoin"], nil, nil)
check("joining: the seconds left, asked again each second", [r[1], labels(r), r[5].find("a")], ["Cottage", [["Connecting", "20 s", 0]], 1000])
st["wifi"]["join"] = {"ssid": "Cottage", "password": "x", "channel": 11, "bssid": "", "state": "failed", "reason": "WrongPassword", "until": 0}
r = ask(["wifiJoin"], nil, nil)
check("failed: why, Try again with another password, and Back", labels(r), [["Wrong password", "", 0], ["Try again", "", 4], ["Back", "", 6]])
st["wifi"]["join"] = nil
st["wifi"]["up"] = true
check("joined: connected, and Done", labels(ask(["wifiJoin"], nil, nil)), [["Connected", "", 0], ["Done", "", 6]])
st["wifi"]["up"] = false

# the hotspot, with its QR for the panel that asks
ran = []
r = ask(["wifi"], 3, nil)
check("the hotspot opened at a touch, its screen the one that follows", [ran, r[0]], [[["wifi", "hotspot", "hotspot"]], ["wifiHotspot"]])
st["wifi"]["hotspot"] = {"kind": "hotspot", "ssid": "tasmota-4A7E21", "password": "abcdefgh23", "clients": 0, "state": "up", "reason": ""}
r = ask(["wifiHotspot"], nil, nil)
check("up: its network, its password, where a phone goes, and Stop, with the QR's words for the panel, asked again while up",
      [labels(r), r[5]["q"], r[5]["a"]], [[["Network", "tasmota-4A7E21", 0], ["Password", "abcdefgh23", 0], ["Address", "http://192.168.4.1", 0],
       ["Devices", "Waiting for a device", 0], ["Stop hotspot", "", 2]], ["tasmota-4A7E21", "abcdefgh23", "http://192.168.4.1", "Waiting for a device"], NodeWireless.SPOT_MS])
ran = []
r = ask(["wifiHotspot"], 4, nil)
check("Stop closes it, and its screen", [ran, r[3]], [[["wifi", "stopHotspot"]], true])
check("the Wireless settings say it", labels(ask(["wireless"], nil, nil))[0], ["Wi-Fi", "Hotspot", 1])
st["wifi"]["hotspot"] = nil
r = ask(["wifiConnect"], 1, nil)
check("the web setup, from Connect: the hotspot on Tasmota's Wi-Fi page", [ran[-1], r[0]], [["wifi", "hotspot", "web"], ["wifiHotspot"]])

# a panel's backup
st["backup"] = {"server": "nas", "busy": "", "pending": true, "result": "", "last": {"when": "19/10 09:00", "at": 1}, "found": nil}
ran = []
r = ask(["backup"], nil, nil)
check("its backup first asked: the server's is looked for; Back up now while a change has none", [ran, labels(r)[0 .. 1]],
      [[["backup", "look"]], [["Back up now", "Not saved", 2], ["Last backup", "19/10 09:00", 0]]])
st["backup"]["found"] = {"when": "18/10 22:00", "at": 0, "zones": 3, "devices": 9}
r = ask(["backup"], nil, nil)
check("a backup on the server: Restore, asked first, with what it brings", [labels(r)[2], r[2][2][4]],
      [["Restore", "18/10 22:00", 5], ["Restore the backup?", "From 18/10 22:00: 3 zones, 9 devices and the settings, in place of the ones it has. It restarts.", "Restore"]])
ran = []
ask(["backup"], 2, {"y": 1})
check("and restored", ran, [["backup", "restore"]])
ran = []
ask(["backup"], 0, nil)
check("Back up now", ran, [["backup", "now"]])
# a bridge's: its devices' names and its alarm, and no zones
st["backup"]["found"] = {"when": "18/10 22:00", "at": 0, "zones": 0, "devices": 4}
r = ask(["backup"], nil, nil)
check("a bridge's backup: no zones said", r[2][2][4][1], "From 18/10 22:00: 4 devices and the settings, in place of the ones it has. It restarts.")
st["backup"] = nil
check("a node of an image without the backup has none", ask(["backup"], nil, nil), nil)

# what is not a screen of a node's network
check("a screen of no node's network, or a touch past its rows", [ask(["settings"], nil, nil), ask(["wifi"], 99, nil)], [nil, nil])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    assert(false)
end
