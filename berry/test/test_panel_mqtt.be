# berry/panel_mqtt.be, the MQTT of Wireless settings, against a
# Tasmota that answers its commands as the firmware does: what the views are
# given to draw, what a save sends and in which order, the house's setting that
# a save writes and the panel takes as every node does, and the
# discovery set again at boot.

import persist
import json
import mqtt

# the commands the MQTT sends, and Tasmota's answers: the settings as they are,
# taken at once as Tasmota takes them (the client uses them after the restart),
# a quote clearing, and the password never read back. One asked muted, out of the
# log, is noted in muted, and one with a leading _, kept off MQTT, answers as
# Tasmota answers it
class MqttTasmota : TasmotaStub
    var cmds, host, port, user, muted
    def init() self.cmds = [] self.host = "" self.port = 1883 self.user = "" self.muted = [] end
    def cmd(c, mute)
        import string
        if mute  self.muted.push(c) end
        if size(c) > 1 && c[0] == "_"  c = c[1 ..] end
        self.cmds.push(c)
        if c == "MqttHost" return {"MqttHost": self.host} end
        if c == "MqttPort" return {"MqttPort": self.port} end
        if c == "MqttUser" return {"MqttUser": self.user} end
        var v = size(c) > 9 ? c[9 ..] : ""
        if v == "\"" v = "" end
        if string.find(c, "MqttHost ") == 0  self.host = v end
        if string.find(c, "MqttUser ") == 0  self.user = v end
        if string.find(c, "MqttPort ") == 0  self.port = int(v) end
        return nil
    end
end
tasmota = MqttTasmota()

# the transport, which nothing of the MQTT reaches: what went over it
class FakeBridge
    var paired, linked, sent
    def init() self.paired = true self.linked = true self.sent = [] end
    def peer() return self.paired ? {"mac": "B0:B0:B0:00:00:01"} : nil end
    def link_state() return self.linked end
    def send(c) self.sent.push(c) end
    def post(c) self.sent.push(c) return true end
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

# --- what the views draw ------------------------------------------------------------------------
var bridge = FakeBridge()
var m = PanelMqtt(bridge)
check("nothing set: no broker, the port Tasmota's, the discovery on, and no battery timeout", m.state(),
      {"host": "", "port": 1883, "user": "", "password": false, "discovery": true, "expire": 0, "connected": false})
check("read at every draw, so quietly: off MQTT (_) and off the log (muted), three lines a draw no more",
      tasmota.muted, ["_MqttHost", "_MqttPort", "_MqttUser"])
tasmota.host = "192.168.2.10"
tasmota.user = "home"
mqtt.up = true
check("a broker, and the client on it", [m.state()["host"], m.state()["user"], m.state()["connected"]], ["192.168.2.10", "home", true])
mqtt.up = false
check("and not on it", m.state()["connected"], false)

# --- the save, with no house: its own -------------------------------------------------------------------------
import global
global.house = nil
tasmota.cmds.clear()
m.run("save", [{"host": "192.168.2.20", "port": 1884, "user": "panel", "password": "a;b c", "discovery": false, "expire": 25}])
check("with no house, this panel's own, each alone: a ; in the password stays in it, and it is never read back",
      tasmota.cmds, ["SetOption19 1", "MqttHost 192.168.2.20", "MqttPort 1884", "MqttUser panel", "MqttPassword2 a;b c"])
check("nothing goes to a bridge: the house carries the MQTT", bridge.sent, [])
check("the battery timeout kept here, for the glass", [persist.store["panel_mqtt"]["expire"], m.state()["expire"]], [25, 25])
check("hours as the glass takes them: 0 to 999", [PanelMqtt.hours(1500), PanelMqtt.hours(-3), PanelMqtt.hours("48")], [999, 0, 48])
check("the password set and the discovery off, kept", [persist.store["panel_mqtt"]["password"], persist.store["panel_mqtt"]["discovery"]], [true, false])
check("and said so to the views", [m.state()["password"], m.state()["discovery"]], [true, false])
# a save with no password typed keeps the one Tasmota has
tasmota.cmds.clear()
m.run("save", [{"host": "192.168.2.20", "port": 1883, "user": "", "discovery": true}])
check("no password typed, the same host: none sent, and an empty user cleared with a quote",
      tasmota.cmds, ["MqttHost", "SetOption19 0", "MqttHost 192.168.2.20", "MqttPort 1883", "MqttUser \""])
check("and the one set still said to be", m.state()["password"], true)
check("a save with no timeout in it: 0, off", m.state()["expire"], 0)
# another host, no password typed: the one set was the old broker's
tasmota.cmds.clear()
m.run("save", [{"host": "192.168.2.21", "port": 1883, "user": "", "discovery": true}])
check("another host with no password typed: the old broker's cleared, never offered to the new one",
      [tasmota.cmds[-1], persist.store["panel_mqtt"]["password"], m.state()["password"]], ["MqttPassword2 \"", false, false])
# the broker cleared: MQTT off
tasmota.cmds.clear()
m.run("save", [{"host": "", "port": 1883, "user": "", "password": "", "discovery": true}])
check("no host: cleared, and the password with it", [tasmota.cmds[1], tasmota.cmds[4], persist.store["panel_mqtt"]["password"]],
      ["MqttHost \"", "MqttPassword2 \"", false])

# --- the save, in a house: the house's setting -------------------------------------------------------------
class FakeHouse
    var up, writing, said, has
    def init() self.up = true self.writing = true self.said = [] self.has = nil end
    def writes() return self.writing end
    def set_mqtt(s) self.said.push(s) self.has = s return true end
    def mqtt_setting() return self.has end
end
def house_checks()
    import string
    var h = FakeHouse()
    global.house = h
    var mq = PanelMqtt(bridge)
    tasmota.cmds.clear()
    mq.run("save", [{"host": "10.0.0.5", "port": 1883, "user": "ha", "password": "secret123", "discovery": true, "expire": 24}])
    check("in a house that it writes, a save is the house's setting, and this panel's Tasmota is not touched yet: it takes it as every node does",
          [h.said[-1], tasmota.cmds],
          [{"host": "10.0.0.5", "port": 1883, "user": "ha", "password": "secret123", "discovery": true, "expire": 24}, []])
    mq.run("save", [{"host": "10.0.0.5", "port": 1883, "user": "ha", "discovery": false, "expire": 24}])
    check("no password typed, the same host: the house's kept", [h.said[-1]["password"], h.said[-1]["discovery"]], ["secret123", false])
    mq.run("save", [{"host": "10.0.0.6", "port": 1883, "user": "ha", "discovery": true, "expire": 0}])
    check("another host, none typed: none", h.said[-1]["password"], "")
    # the house's setting, as this panel takes it
    tasmota.cmds.clear()
    mq.apply({"host": "10.0.0.5", "port": 1885, "user": "ha", "password": "secret123", "discovery": false, "expire": 12})
    check("taken: this panel's Tasmota, the password with it, and what the glass shows kept",
          [tasmota.cmds, persist.store["panel_mqtt"]["expire"], persist.store["panel_mqtt"]["password"]],
          [["SetOption19 1", "MqttHost 10.0.0.5", "MqttPort 1885", "MqttUser ha", "MqttPassword2 secret123"], 12, true])
    # the house's first setting, with no password typed, on the broker this panel is on: Tasmota never says the password it has, and each node keeps its own
    h.has = nil
    mq.run("save", [{"host": "10.0.0.5", "port": 1883, "user": "ha", "discovery": true, "expire": 0}])
    check("the house's first setting, none typed, on this panel's broker: each node keeps its own password", [h.said[-1].find("keep"), h.said[-1]["password"]], [true, ""])
    mq.run("save", [{"host": "10.0.0.5", "port": 1883, "user": "hb", "discovery": true, "expire": 0}])
    check("saved again, none typed: still each its own", h.said[-1].find("keep"), true)
    mq.run("save", [{"host": "10.0.0.5", "port": 1883, "user": "hb", "password": "novo", "discovery": true, "expire": 0}])
    check("one typed: the house's, for every node", [h.said[-1].find("keep"), h.said[-1]["password"]], [nil, "novo"])
    h.has = nil
    mq.run("save", [{"host": "10.0.0.8", "port": 1883, "user": "hb", "discovery": true, "expire": 0}])
    check("a first setting on another broker, none typed: none, the old broker's is not offered", [h.said[-1].find("keep"), h.said[-1]["password"]], [nil, ""])
    tasmota.cmds.clear()
    mq.apply({"host": "10.0.0.5", "port": 1883, "user": "hb", "password": "", "discovery": true, "expire": 0, "keep": true})
    var pw_sent = false
    for c: tasmota.cmds if string.find(c, "MqttPassword2") == 0  pw_sent = true end end
    check("taken with the word, on the same broker: no password sent, the one this panel has stays", [pw_sent, tasmota.cmds[-1]], [false, "MqttUser hb"])
    h.writing = false
    tasmota.cmds.clear()
    mq.run("save", [{"host": "10.0.0.7", "port": 1883, "user": "", "discovery": true}])
    check("a panel that does not write the list saves its own", tasmota.cmds[2], "MqttHost 10.0.0.7")
    global.house = nil
end
house_checks()

# --- the boot -----------------------------------------------------------------------------------------
persist.store["panel_mqtt"] = {"discovery": false}
tasmota.cmds.clear()
PanelMqtt(bridge).at_boot()
check("the discovery off, set again at boot, where Tasmota turns it on", tasmota.cmds, ["SetOption19 1"])
persist.store["panel_mqtt"] = {"discovery": true}
tasmota.cmds.clear()
PanelMqtt(bridge).at_boot()
check("on: nothing to do", tasmota.cmds, [])
persist.store.remove("panel_mqtt")

# --- a save the file cannot take: said in the log, and not an exception in the touch; the commands that
# follow it are still sent, as Tasmota's own settings, and what the glass chose is in memory for the next save
def unsaved_checks()
    var mq = PanelMqtt(FakeBridge())
    tasmota.cmds.clear()
    persist.plan = nil
    persist.fail_next()
    var raised = false
    try
        mq.save({"host": "192.168.2.10", "port": 1883, "user": "home", "discovery": false})
    except .. as e, m
        raised = true
    end
    check("a save whose write fails raises nothing, and the settings go to Tasmota all the same", [raised, tasmota.cmds[0], persist.find("panel_mqtt")["discovery"]],
          [false, "MqttHost", false])
    persist.store.remove("panel_mqtt")
    persist.written = nil
end
unsaved_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
