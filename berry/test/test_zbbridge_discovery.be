# berry/zbbridge_discovery.be, the bridge's Zigbee devices in Home Assistant,
# against a coordinator the test fills: what each kind of
# device is announced as, its state, Home Assistant's commands as ZbSend, a
# button's actions as triggers, the panel's names, a device that left the
# network cleared from Home Assistant, and the discovery off.

import global
import json
import string
import mqtt
import persist

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

# the same, as maps compare: a map parsed from JSON keeps its keys in another order
def same(a, b)
    if isinstance(a, map)
        if !isinstance(b, map) || size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !same(a[k], b[k]) return false end
        end
        return true
    end
    if isinstance(a, list)
        if !isinstance(b, list) || size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if !same(a[i], b[i]) return false end
        end
        return true
    end
    return a == b
end
def check_same(name, got, want)
    checks += 1
    if !same(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# Tasmota: the commands and their answers, named timers the test fires, the rules
class DiscoveryTasmota : TasmotaStub
    var cmds, timers, rules
    def init() self.cmds = [] self.timers = [] self.rules = {} end
    def cmd(c)
        self.cmds.push(c)
        if c == "Topic" return {"Topic": "tasmota_77AB01"} end
        if c == "FullTopic" return {"FullTopic": "%prefix%/%topic%/"} end
        if c == "Prefix3" return {"Prefix3": "tele"} end
        return nil
    end
    def set_timer(ms, f, id) self.timers.push([id, f]) end
    def remove_timer(id)
        var i = 0
        while i < size(self.timers)
            if self.timers[i][0] == id  self.timers.remove(i) else i += 1 end
        end
    end
    def run()
        while size(self.timers) > 0
            var t = self.timers[0]
            self.timers.remove(0)
            t[1]()
        end
    end
    def fire(id)
        var i = 0
        while i < size(self.timers)
            if self.timers[i][0] == id
                var t = self.timers[i]
                self.timers.remove(i)
                t[1]()
                return true
            end
            i += 1
        end
        return false
    end
    def add_rule(trigger, f, id) self.rules[trigger] = f end
    def add_driver(d) end
    def resp_cmnd_failed() self.cmds.push("FAILED") end
    def resp_cmnd_done() end
end
tasmota = DiscoveryTasmota()

# Z2T's devices: their addresses, whether they route, and what Z2T knows of them
class FakeDevice
    var longaddr, shortaddr, name, model, manufacturer, router, _info
    def init(ieee, short, router, info)
        self.longaddr = bytes(ieee[2 ..]).reverse()
        self.shortaddr = short
        self.router = router
        self.model = info.find("ModelId")
        self.manufacturer = info.find("Manufacturer")
        self._info = info
    end
    def info() return self._info end
end
class FakeCoordinator
    var devices
    def init() self.devices = [] end
    def started() return true end
    def size() return size(self.devices) end
    def iter() return self.devices.iter() end
    def find(key)
        for d: self.devices
            if string.toupper(str(key)) == string.format("0X%04X", d.shortaddr) || str(key) == ZbBridgeDiscovery.ieee(d) return d end
        end
        return nil
    end
end
var LIGHT = "0x00124B0000E00001"
var PLUG = "0x00124B0000E00002"
var SENSOR = "0x00158D0000A00003"
var DOOR = "0x00158D0000A00004"
var REMOTE = "0x00158D0000A00005"
var LEAK = "0x00158D0000A00006"
var BLIND = "0x00158D0000A00007"
var z = FakeCoordinator()
var light = FakeDevice(LIGHT, 0x1111, true, {"ModelId": "TRADFRI bulb", "Manufacturer": "IKEA", "Config": ["L01.5"], "Power": 1, "Dimmer": 127,
                                             "CT": 300, "Hue": 127, "Sat": 254, "Reachable": true})
var plug = FakeDevice(PLUG, 0x2222, true, {"ModelId": "Plug", "Config": ["O01"], "Power": 0})
var sensor = FakeDevice(SENSOR, 0x3333, false, {"ModelId": "TH01", "Config": ["T01"], "Temperature": 21.5, "Humidity": 55.2, "BatteryPercentage": 90})
var door = FakeDevice(DOOR, 0x4444, false, {"ModelId": "DS01", "Config": ["A01.2"], "Contact": 1})
var remote = FakeDevice(REMOTE, 0x5555, false, {"ModelId": "Remote", "Config": ["O01"]})
var leak = FakeDevice(LEAK, 0x6666, false, {"ModelId": "WL01", "Config": ["A01.4"], "ZoneType": 42, "ZoneStatus": 1, "BatteryPercentage": 80})
var blind = FakeDevice(BLIND, 0x7777, true, {"ModelId": "Blind", "Config": []})
z.devices = [light, plug, sensor, door, remote, leak, blind]
global.zigbee = z

def published(topic)
    for m: mqtt.published
        if m[0] == topic return m end
    end
    return nil
end
def config(component, ieee, part)
    var m = published("homeassistant/" + component + "/" + ieee + "/" + part + "/config")
    return m != nil && m[1] != "" ? json.load(m[1]) : nil
end

# what the broker keeps, a retained message a topic, as the bridge's publishes leave it
var kept = {}
var stub_publish = mqtt.publish
mqtt.publish = def (topic, payload, retain)
    if retain
        if payload == ""
            if kept.contains(topic)  kept.remove(topic) end
        else
            kept[topic] = payload
        end
    end
    return stub_publish(topic, payload, retain)
end
# the bridge's subscription to a device's announcements, while it clears them, or nil
def clearing_sub()
    for sub: mqtt.subs
        if string.find(sub[0], "homeassistant/+/") == 0 return sub end
    end
    return nil
end
# The clearings, as a broker plays them: the retained announcements of the
# device each subscription names delivered, and its time up
def run_clearing()
    var sub = clearing_sub()
    while sub != nil
        var ieee = string.split(sub[0], "/")[2]
        var topics = []
        for t: kept.keys()  topics.push(t) end
        for t: topics
            if string.split(t, "/")[2] == ieee && string.find(t, "homeassistant/") == 0  sub[1](t, 0, kept[t], nil) end
        end
        tasmota.fire("zbbridge_discovery_clear")
        sub = clearing_sub()
    end
end

persist.store["zb_relay_names"] = {LIGHT: "Desk light"}
var d = ZbBridgeDiscovery()

# --- off the broker: nothing ------------------------------------------------------------------
d.every_second()
tasmota.run()
check("off the broker: nothing published, nothing subscribed", [mqtt.published, mqtt.subs], [[], []])

# --- on it: every device -----------------------------------------------------------------------
mqtt.up = true
d.every_second()
check("on the broker: Home Assistant's commands subscribed to", mqtt.subs[0][0], "zigbee/+/set")
tasmota.run()
var c = config("light", LIGHT, "light")
check("the light: its type's colour and white, the level at Z2T's scale", [c["schema"], c["sup_clrm"], c["bri_scl"], c["min_mirs"], c["max_mirs"]],
      ["json", ["hs", "color_temp"], 254, 153, 500])
check("its topics under its IEEE", [c["~"], c["stat_t"], c["cmd_t"], c["uniq_id"]], ["zigbee/" + LIGHT, "~/state", "~/set", LIGHT + "_light"])
check_same("its availability, and the bridge's LWT beside it", [c["avty"], c["avty_mode"]],
      [[{"t": "~/availability"}, {"t": "tele/tasmota_77AB01/LWT", "pl_avail": "Online", "pl_not_avail": "Offline"}], "all"])
check_same("the device, by the panel's name", c["dev"], {"ids": ["zigbee_" + LIGHT], "name": "Desk light", "mf": "IKEA", "mdl": "TRADFRI bulb"})
check("with the device's name for the entity's", c.contains("name") && c["name"] == nil, true)
check("retained", published("homeassistant/light/" + LIGHT + "/light/config")[2], true)
var s = json.load(published("zigbee/" + LIGHT + "/state")[1])
check("its state in the JSON schema: the colour, as Home Assistant counts it",
      [s["state"], s["brightness"], s["color_temp"], s["color_mode"], int(s["color"]["h"] + 0.5), int(s["color"]["s"] + 0.5)], ["ON", 127, 300, "hs", 180, 100])
check("and it is online", published("zigbee/" + LIGHT + "/availability")[1], "online")
c = config("switch", PLUG, "switch")
check("an on/off device on the mains: a switch", [c["val_tpl"], json.load(c["pl_on"]), c["stat_on"]], ["{{ value_json.state }}", {"state": "ON"}, "ON"])
check("a switch announced for the first time on a connection clears the cover a driver may have left retained before a restart; a lamp clears nothing",
      [published("homeassistant/cover/" + PLUG + "/cover/config"), published("homeassistant/cover/" + LIGHT + "/cover/config")],
      [["homeassistant/cover/" + PLUG + "/cover/config", "", true], nil])
check("with no name from the panel: its model and address", c["dev"]["name"], "Plug 0002")
c = config("sensor", SENSOR, "temperature")
check("a sensor: each value Z2T decodes, with its class and unit", [c["dev_cla"], c["unit_of_meas"], c["stat_cla"], c["val_tpl"]],
      ["temperature", "°C", "measurement", "{{ value_json.temperature }}"])
check("the humidity and the battery too", [config("sensor", SENSOR, "humidity")["unit_of_meas"], config("sensor", SENSOR, "battery")["dev_cla"]], ["%", "battery"])
check("and no switch for a device on batteries", config("switch", SENSOR, "switch"), nil)
check_same("its state", json.load(published("zigbee/" + SENSOR + "/state")[1]), {"temperature": 21.5, "humidity": 55.2, "battery": 90})
check("a door: a binary sensor, open ON", [config("binary_sensor", DOOR, "contact")["dev_cla"], json.load(published("zigbee/" + DOOR + "/state")[1])["contact"]],
      ["door", "ON"])
check("a remote: no entity until it acts", [config("switch", REMOTE, "switch"), config("light", REMOTE, "light")], [nil, nil])
check("a leak sensor, which ZbInfo keeps as its zone's type and status: water, wet ON",
      [config("binary_sensor", LEAK, "water")["dev_cla"], json.load(published("zigbee/" + LEAK + "/state")[1])["water"]], ["moisture", "ON"])
check("with the battery timeout at 0, a battery device's sensors keep their last value", config("sensor", SENSOR, "temperature").find("exp_aft"), nil)

# --- the battery timeout: the panel's hours ---------------------------------------
mqtt.published.clear()
d.set_expire(25)
tasmota.run()
check("a timeout from the panel, kept", persist.store["zb_relay_expire"], 25)
check("every device announced again: a battery device's sensors expire after it, in seconds",
      [config("sensor", SENSOR, "temperature")["exp_aft"], config("sensor", SENSOR, "battery")["exp_aft"], config("binary_sensor", DOOR, "contact")["exp_aft"]],
      [90000, 90000, 90000])
check("a device on the mains, never", [config("switch", PLUG, "switch").find("exp_aft"), config("light", LIGHT, "light").find("exp_aft")], [nil, nil])
mqtt.published.clear()
d.set_expire(25)
tasmota.run()
check("the same timeout again: nothing announced", config("sensor", SENSOR, "temperature"), nil)
d.set_expire(0)
tasmota.run()
check("0: announced again with no timeout, the last value kept", config("sensor", SENSOR, "temperature").find("exp_aft"), nil)

# the alarm of the bridge, as far as the discovery speaks to it: the commands it is told of, for their echo not to be taken for a hand on
# the device
class FakeAlarm
    var lines
    def init() self.lines = [] end
    def commanded(l) self.lines.push(l) end
end
class FakeHostRelay
    var alarm, drivers
    def init() self.alarm = FakeAlarm() end
end
var host = FakeHostRelay()
global.zbbridge_relay = host

# --- Home Assistant's commands ------------------------------------------------------------------
tasmota.cmds.clear()
# in the first seconds of a connection the commands that come are the retained ones the broker hands back, and none is obeyed: a
# switch OFF of yesterday that Home Assistant published retained is not the command of now
mqtt.subs[0][1]("zigbee/" + LIGHT + "/set", 0, "{\"state\":\"OFF\"}", nil)
check("a command in the first seconds of the connection is a retained one: not obeyed", tasmota.cmds, [])
tasmota.at_ms = 10000
mqtt.subs[0][1]("zigbee/" + LIGHT + "/set", 0, "{\"state\":\"ON\",\"brightness\":200,\"color\":{\"h\":90,\"s\":50}}", nil)
check_same("a light's: ZbSend, the colour at Z2T's scale",
      json.load(tasmota.cmds[-1][size("ZbSend ") ..]), {"Device": LIGHT, "Send": {"Power": 1, "Dimmer": 200, "HueSat": "64,127"}})
mqtt.subs[0][1]("zigbee/" + LIGHT + "/set", 0, "{\"color_temp\":350}", nil)
check("the white", json.load(tasmota.cmds[-1][size("ZbSend ") ..])["Send"], {"CT": 350})
mqtt.subs[0][1]("zigbee/" + PLUG + "/set", 0, "{\"state\":\"OFF\"}", nil)
check_same("a switch's", json.load(tasmota.cmds[-1][size("ZbSend ") ..]), {"Device": PLUG, "Send": {"Power": 0}})
# a switch of several: a switch a channel, each with its state, and a command to its endpoint
var two = ZbBridgeDiscovery.parts_of({"Config": ["O01", "O02"]}, true)
check("two channels, two switches: the first as a switch of one, the second by its endpoint",
      [size(two), two[0][1], two[1][1], two[1][2]["val_tpl"], two[1][2]["name"]], [2, "switch", "switch_2", "{{ value_json.state_2 }}", "Channel 2"])
check_same("their state: each endpoint's power", ZbBridgeDiscovery.state_of({"Power": 1, "Power1": 0, "Power2": 1}), {"state": "OFF", "state_2": "ON", "color_mode": "onoff"})
mqtt.subs[0][1]("zigbee/" + PLUG + "/set", 0, "{\"state_2\":\"ON\"}", nil)
check_same("a channel's command: to its endpoint", json.load(tasmota.cmds[-1][size("ZbSend ") ..]), {"Device": PLUG, "Endpoint": 2, "Send": {"Power": 1}})
tasmota.cmds.clear()
mqtt.subs[0][1]("zigbee/0x0000000000000000/set", 0, "{\"state\":\"ON\"}", nil)
mqtt.subs[0][1]("zigbee/" + LIGHT + "/set", 0, "not json", nil)
mqtt.subs[0][1]("zigbee/" + LIGHT + "/set", 0, "{\"effect\":\"colorloop\"}", nil)
check("to a device not of this network, not JSON, or nothing it knows: nothing", tasmota.cmds, [])
check("what Home Assistant sent was told to the alarm, each line as it went to Z2T, the channel's too",
      [size(host.alarm.lines) == 4, host.alarm.lines[0] == "ZbSend " + json.dump({"Device": LIGHT, "Send": {"Power": 1, "Dimmer": 200, "HueSat": "64,127"}}),
       string.find(host.alarm.lines[3], "\"Endpoint\":2") > 0], [true, true, true])
check("and nothing that was not sent", host.alarm.lines.find("ZbSend {}"), nil)

# a switch of two channels that a driver opens and closes is a cover for Home Assistant, which is offered a stop only when the device has
# one: a gate of two keys has none, and says so in its description
class FakeTwoKey
    var ID, stop
    def init(stop) self.ID = "twokey" self.stop = stop end
    def describe(info)
        var d = {"caps": 64, "ep": 1}
        if !self.stop  d["stop"] = false end
        return d
    end
end
class FakeDrivers
    var claimed
    def init() self.claimed = {} end
    def info_for(ieee) return {"IEEEAddr": ieee} end
end
host.drivers = FakeDrivers()
host.drivers.claimed[PLUG] = FakeTwoKey(false)
host.drivers.claimed[LIGHT] = FakeTwoKey(true)
var gate = ZbBridgeDiscovery.parts_for(PLUG, {}, true)
var blind = ZbBridgeDiscovery.parts_for(LIGHT, {}, true)
check("a gate of two keys is a cover with no stop for Home Assistant: a payload_stop that is null", [size(gate), gate[0][1], gate[0][2].contains("pl_stop"), json.dump(gate[0][2]["pl_stop"])], [1, "cover", true, "null"])
check("it keeps its open, close and position", [gate[0][2]["pl_open"], gate[0][2]["pl_cls"], gate[0][2]["set_pos_t"]], [json.dump({"cover": "OPEN"}), json.dump({"cover": "CLOSE"}), "~/set"])
check("a gate of one key, or a motor, has its stop", json.load(blind[0][2]["pl_stop"]), {"cover": "STOP"})

# What the driver says of a device changes after it was announced, and the host tells refresh() (zbbridge_drivers.be: when it describes the device
# again, and when it gives it back): a gate's inputs make its stop, and the announcement was made without it. The plug is announced as a switch
# above, before a driver had it (no shape), and the host's driver of two keys takes it: the cover, and the switch it was cleared
def refresh_checks()
    check("announced before a driver had it, a device has no shape; and the shape of a gate with no stop, and with one", [d.shaped[PLUG], ZbBridgeDiscovery.shape(PLUG), ZbBridgeDiscovery.shape(LIGHT), ZbBridgeDiscovery.shape(SENSOR)],
          ["", "cover", "cover+stop", ""])
    tasmota.run()
    mqtt.published.clear()
    d.refresh("0x00124B0000FFFF01")
    check("a device not announced is nothing to refresh: it takes the driver as it is when its turn comes", [d.todo, tasmota.timers], [[], []])
    d.refresh(PLUG)
    check("a device whose shape changed is queued, and announced in its turn", [d.todo, size(tasmota.timers) > 0], [[PLUG], true])
    tasmota.run()
    var cv = config("cover", PLUG, "cover")
    check("the gate a driver took is the cover, with no stop (a payload_stop that is null), its shape kept", [cv != nil, json.dump(cv["pl_stop"]), d.shaped[PLUG], d.announced[PLUG]], [true, "null", "cover", ["cover/cover"]])
    check("and the switch it was is cleared: an empty retained message, and the broker has it no more",
          [published("homeassistant/switch/" + PLUG + "/switch/config")[1], kept.contains("homeassistant/switch/" + PLUG + "/switch/config"), kept.contains("homeassistant/cover/" + PLUG + "/cover/config")], ["", false, true])
    # its inputs are set to one key: the driver's description has a stop now
    mqtt.published.clear()
    host.drivers.claimed[PLUG].stop = true
    d.refresh(PLUG)
    tasmota.run()
    check("the description changed (a stop): announced again with it", json.load(config("cover", PLUG, "cover")["pl_stop"]), {"cover": "STOP"})
    check("its shape is the new one, and nothing was cleared, for no part went", [d.shaped[PLUG], d.announced[PLUG], published(ZbBridgeDiscovery.config_topic("switch", PLUG, "switch"))], ["cover+stop", ["cover/cover"], nil])
    # the same description again, as at every link of the panel's: nothing is announced
    mqtt.published.clear()
    d.refresh(PLUG)
    tasmota.run()
    check("the same description again: nothing announced, nothing queued", [mqtt.published, d.todo, tasmota.timers], [[], [], []])
    # and back to two keys
    host.drivers.claimed[PLUG].stop = false
    d.refresh(PLUG)
    tasmota.run()
    check("back to two keys: announced again, with no stop", [json.dump(config("cover", PLUG, "cover")["pl_stop"]), d.shaped[PLUG]], ["null", "cover"])
    # off the broker, or with the discovery off: nothing is queued (the connection announces every device as the driver is then)
    host.drivers.claimed[PLUG].stop = true
    mqtt.published.clear()
    d.up = false
    d.refresh(PLUG)
    d.up = true
    check("off the broker: nothing queued", [d.todo, mqtt.published], [[], []])
    persist.store["zb_relay_discovery"] = false
    d.refresh(PLUG)
    persist.store.remove("zb_relay_discovery")
    check("with the discovery off: nothing queued", [d.todo, mqtt.published], [[], []])
    d.refresh(PLUG)
    tasmota.run()
    check("and with it on, the change that waited is announced", json.load(config("cover", PLUG, "cover")["pl_stop"]), {"cover": "STOP"})
    # given back: the cover goes, and the device is a switch again
    mqtt.published.clear()
    host.drivers.claimed.remove(PLUG)
    d.refresh(PLUG)
    tasmota.run()
    check("a device the host gave back is announced again as what Z2T says it is, and its cover cleared",
          [config("switch", PLUG, "switch") != nil, published("homeassistant/cover/" + PLUG + "/cover/config")[1], kept.contains("homeassistant/cover/" + PLUG + "/cover/config"), d.shaped[PLUG], d.announced[PLUG]],
          [true, "", false, "", ["switch/switch"]])
    check("nothing of a driver's is left for the device", ZbBridgeDiscovery.driven(PLUG), nil)
    host.drivers.claimed[PLUG] = FakeTwoKey(false)
    # a restart of the bridge forgets what it announced, and the broker still holds the switch the driver replaced: the first announcement of the
    # driven device on the new connection clears it
    mqtt.published.clear()
    d.announced.remove(PLUG)
    d.shaped.remove(PLUG)
    kept["homeassistant/switch/" + PLUG + "/switch/config"] = "{}"
    d.announce(PLUG, plug)
    check("a driven device announced for the first time on a connection clears the switch it was, retained before the restart",
          [config("cover", PLUG, "cover") != nil, kept.contains("homeassistant/switch/" + PLUG + "/switch/config"), published("homeassistant/switch/" + PLUG + "/switch/config")[1]],
          [true, false, ""])
end
refresh_checks()
host.drivers.claimed.remove(PLUG)
host.drivers = nil
global.zbbridge_relay = nil

# --- what Z2T hears ----------------------------------------------------------------------------
mqtt.published.clear()
light._info["Power"] = 0
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x1111": {"Device": "0x1111", "Power": 0, "Endpoint": 1, "LinkQuality": 90}}})
check("a report: the device's state, whole, retained", [json.load(published("zigbee/" + LIGHT + "/state")[1])["state"], published("zigbee/" + LIGHT + "/state")[2]],
      ["OFF", true])
check("and nothing announced again", config("light", LIGHT, "light"), nil)
sensor._info["Pressure"] = 1012
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x3333": {"Device": "0x3333", "Pressure": 1012}}})
check("a value it had not decoded before: announced again, with it", config("sensor", SENSOR, "pressure")["unit_of_meas"], "hPa")
mqtt.published.clear()
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x5555": {"Device": "0x5555", "Power": 2, "Endpoint": 1, "LinkQuality": 80}}})
var t = config("device_automation", REMOTE, "Power_2")
check("a remote's toggle: a trigger, the first time", [t["atype"], t["t"], t["pl"], t["type"], t["stype"]],
      ["trigger", "zigbee/" + REMOTE + "/action", "Power_2", "button_short_press", "Power_2"])
check("and the action, not retained", published("zigbee/" + REMOTE + "/action"), ["zigbee/" + REMOTE + "/action", "Power_2", false])
mqtt.published.clear()
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x5555": {"Device": "0x5555", "Power": 2}}})
check("the second time: the action alone", [config("device_automation", REMOTE, "Power_2"), published("zigbee/" + REMOTE + "/action")[1]], [nil, "Power_2"])

check("a cover before it says where it is: nothing, as ZbInfo keeps no position", config("cover", BLIND, "cover"), nil)
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x7777": {"Device": "0x7777", "CurrentPositionLiftPercentage": 30}}})
c = config("cover", BLIND, "cover")
check("its position in a report: a cover, open 70 as Home Assistant counts it, 30 closed as Zigbee does",
      [c != nil, json.load(published("zigbee/" + BLIND + "/state")[1])["position"]], [true, 70])
tasmota.cmds.clear()
mqtt.subs[0][1]("zigbee/" + BLIND + "/set", 0, "{\"position\":25}", nil)
mqtt.subs[0][1]("zigbee/" + BLIND + "/set", 0, c["pl_open"], nil)
check("Home Assistant's position and open, as Z2T's lift and open",
      [json.load(tasmota.cmds[0][size("ZbSend ") ..])["Send"], json.load(tasmota.cmds[1][size("ZbSend ") ..])["Send"]], [{"ShutterLift": 75}, {"ShutterOpen": true}])
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x7777": {"Device": "0x7777", "LinkQuality": 60}}})
check("and a report that does not say it keeps the last", json.load(published("zigbee/" + BLIND + "/state")[1])["position"], 70)

# --- the reach ----------------------------------------------------------------------------------
mqtt.published.clear()
light._info["Reachable"] = false
d.sweep = 1
d.every_second()
check("a lamp Z2T no longer reaches: offline", published("zigbee/" + LIGHT + "/availability")[1], "offline")
mqtt.published.clear()
d.sweep = 1
d.every_second()
check("said once", published("zigbee/" + LIGHT + "/availability"), nil)
light._info["Reachable"] = true

# --- the panel's names ------------------------------------------------------------------------------
mqtt.published.clear()
tasmota.cmds.clear()
d.name_cmd("{\"IEEE\":\"" + PLUG + "\",\"Name\":\"Café table plug\"}")
tasmota.run()
check("a name from the panel: the device announced again with it", config("switch", PLUG, "switch")["dev"]["name"], "Café table plug")
check("and the names saved, once they stop coming", persist.store["zb_relay_names"][PLUG], "Café table plug")
d.name_cmd("{\"IEEE\":\"" + LIGHT + "\",\"Name\":\"\"}")
tasmota.run()
check("no name: forgotten, back to its model", [persist.store["zb_relay_names"].contains(LIGHT), config("light", LIGHT, "light")["dev"]["name"]],
      [false, "TRADFRI bulb 0001"])
d.name_cmd("{\"IEEE\":\"0x12\",\"Name\":\"x\"}")
check("an address that is no IEEE: refused", tasmota.cmds[-1], "FAILED")

# --- what left the network ----------------------------------------------------------------------------
tasmota.run()
check("each device announced, and kept in the flash", persist.store["zb_relay_announced"].find(PLUG) != nil, true)
check("each announcement marked with this bridge's origin", config("switch", PLUG, "switch")["o"], {"name": "tasmota_77AB01"})
light._info["Reachable"] = false
d.check_left()
check("a lamp with no power: still in Z2T's list, nothing cleared",
      [clearing_sub(), kept.contains("homeassistant/light/" + LIGHT + "/light/config")], [nil, true])
light._info["Reachable"] = true
z.devices.remove(z.devices.find(plug))
d.check_later(1000)
check("a ZbForget: the list looked at a moment later", tasmota.timers[-1][0], "zbbridge_discovery_left")
tasmota.fire("zbbridge_discovery_left")
check("a device out of Z2T's list: its announcements looked for", clearing_sub()[0], "homeassistant/+/" + PLUG + "/+/config")
run_clearing()
check("and cleared: out of Home Assistant", kept.contains("homeassistant/switch/" + PLUG + "/switch/config"), false)
tasmota.run()
check("and out of the list in the flash", persist.store["zb_relay_announced"].find(PLUG), nil)
check("its subscription let go", clearing_sub(), nil)
# the door moved rooms: another bridge announces it now, and the announcement is that bridge's
kept["homeassistant/binary_sensor/" + DOOR + "/contact/config"] = json.dump({"o": {"name": "tasmota_99CD02"}, "stat_t": "~/state"})
z.devices.remove(z.devices.find(door))
d.sweep = 1
d.every_second()
run_clearing()
check("every minute too, and another bridge's announcement is left alone",
      [kept.contains("homeassistant/binary_sensor/" + DOOR + "/contact/config"), d.ever.find(DOOR)], [true, nil])

# --- the discovery off, and on ----------------------------------------------------------------------
mqtt.published.clear()
tasmota.cmds.clear()
d.set_on(false)
check("off: kept, and Tasmota's own discovery off with it", [persist.store["zb_relay_discovery"], tasmota.cmds], [false, ["SetOption19 1"]])
run_clearing()
check("the announcements cleared, an empty retained message each",
      [published("homeassistant/light/" + LIGHT + "/light/config"), published("homeassistant/device_automation/" + REMOTE + "/Power_2/config")],
      [["homeassistant/light/" + LIGHT + "/light/config", "", true], ["homeassistant/device_automation/" + REMOTE + "/Power_2/config", "", true]])
mqtt.published.clear()
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x1111": {"Device": "0x1111", "Power": 1}}})
check("and nothing more", mqtt.published, [])
d.set_on(true)
tasmota.run()
check("on again: every device announced", config("light", LIGHT, "light") != nil && config("sensor", SENSOR, "temperature") != nil, true)

# --- a new connection: all again, and one subscription ----------------------------------------------
mqtt.up = false
d.every_second()
mqtt.up = true
mqtt.published.clear()
d.every_second()
tasmota.run()
check("a new connection: all announced again, and the commands' topic subscribed to once", [config("light", LIGHT, "light") != nil, size(mqtt.subs)], [true, 1])
check("the LWT: Tasmota's FullTopic, with the telemetry's prefix and its topic", ZbBridgeDiscovery.lwt_topic(), "tele/tasmota_77AB01/LWT")
# --- after a restart: a device forgotten while the bridge was off ---------------------------------
tasmota.run()
z.devices.remove(z.devices.find(sensor))
var d2 = ZbBridgeDiscovery()
mqtt.up = true
d2.every_second()
run_clearing()
check("the list in the flash, looked at on the broker again: the sensor forgotten meanwhile, cleared",
      [kept.contains("homeassistant/sensor/" + SENSOR + "/temperature/config"), kept.contains("homeassistant/light/" + LIGHT + "/light/config")], [false, true])
persist.store["zb_relay_discovery"] = false
tasmota.cmds.clear()
ZbBridgeDiscovery()
check("off, at boot: Tasmota's own discovery off again, where Tasmota turns it on", tasmota.cmds, ["SetOption19 1"])

# --- off, and the bridge restarted before the clearing ended, as the Save on the glass makes
# it: the next connection clears what the flash still lists, and Home Assistant's commands
# are not obeyed -------------------------------------------------------------
check("the light still in Home Assistant", kept.contains("homeassistant/light/" + LIGHT + "/light/config"), true)
persist.store["zb_relay_announced"] = [LIGHT]
var d3 = ZbBridgeDiscovery()
mqtt.up = true
d3.every_second()
check("the connection, off: the list in the flash taken up", clearing_sub() != nil ? clearing_sub()[0] : nil,
      "homeassistant/+/" + LIGHT + "/+/config")
run_clearing()
check("and cleared: out of Home Assistant", kept.contains("homeassistant/light/" + LIGHT + "/light/config"), false)
tasmota.cmds.clear()
d3.command("zigbee/" + LIGHT + "/set", '{"state":"ON"}')
check("Home Assistant's command, with the discovery off: not obeyed", tasmota.cmds, [])

# --- a save that falls over is not an exception out of the panel's word or the names' save ----------------------------
def failing_save_checks()
    var x = ZbBridgeDiscovery()
    var err = nil
    persist.plan = nil
    persist.failures = 0
    persist.fail_next()
    try
        x.set_expire(9)
    except .. as e
        err = e
    end
    check("a battery timeout whose save falls over is the timeout all the same", [err, x.expire(), persist.failures], [nil, 9, 1])
    persist.fail_next()
    try
        x.set_on(true)
        x.set_on(false)
    except .. as e
        err = e
    end
    check("the discovery turned off, its save falling over: it is off", [err, x.on(), persist.failures], [nil, false, 2])
    persist.fail_next()
    try
        x.save()
    except .. as e
        err = e
    end
    check("and the names' save raises nothing", [err, persist.failures], [nil, 3])
    persist.plan = nil
end
failing_save_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
