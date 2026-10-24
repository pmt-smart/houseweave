# berry/zigbee_bridge.be, the panel's Zigbee, which is the house's bridges: the mode as the house says it, the bridge of the house
# the views show, the session the boot's gate raises and lowers, the panel's word that keeps it a listener of that bridge, the events given to every
# consumer, and a command by the boot's route. There is no pair and no link of the panel's own.

import json

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

var b = ZigbeeBridge()

# --- the start: no pair, no link -----------------------------------------------------------------------
check("it starts off, with no bridge in a house it does not know yet", b.mode, "off")
check("the ESP-NOW driver's own link off: a pairing's alone", tasmota.cmds.find("EspNowEnable 0") != nil, true)
check("the events of the bridges reach the consumers through their rules", [tasmota.rules.contains("ZbReceived"), tasmota.rules.contains("ZbAlarm"), tasmota.rules.contains("ZbTime")], [true, true, true])
check("no bridge of the house: no peer, no link", [b.peer(), b.link_state()], [nil, false])
check("and a command with no route goes nowhere", b.post("ZbInfo"), false)

# --- the house's bridges, as the boot gives them -------------------------------------------------------------
var n = [0]
var given = [7]
var lines = []
b.bridges = / -> n[0]
b.house_bridge = / -> given[0]
b.bridge_info = / id -> id == 7 ? {"mac": "A0:B7:65:77:00:07", "name": "Living room", "ip": "192.168.2.61", "id": 7} : nil
b.via = def (c) lines.push(c) return true end
var changes = [0]
b.on_change = def () changes[0] += 1 end
b.every_second()
check("a house with no bridge: off", [b.mode, changes[0]], ["off", 0])
n[0] = 2
b.every_second()
check("a bridge in the house: the Zigbee is the house's, and a view of it drawn again", [b.mode, changes[0]], ["mesh", 1])
check("the bridge of the house is what the views show", b.peer(), {"mac": "A0:B7:65:77:00:07", "name": "Living room", "ip": "192.168.2.61", "id": 7})
check("a command goes by the boot's route", [b.post("ZbSend {}"), lines[-1]], [true, "ZbSend {}"])
check("and by its older name too", [b.send("ZbInfo"), lines[-1]], [true, "ZbInfo"])

# --- the session: the gate on the bridge of the house ----------------------------------------------------------
var risen = [0]
b.on_link(def () risen[0] += 1 end)
lines.clear()
b.mesh_session(true)
check("in step: the session rises once, and the bridge is told this panel hears it, with the 1 that has it say again what it missed",
      [risen[0], lines, b.link_state()], [1, ["ZbRelayListen 1"], true])
b.mesh_session(true)
check("again in step: nothing more", [risen[0], size(lines)], [1, 1])
check("and a view of the link drawn again", changes[0] >= 2, true)
# the bridge of the house hears from this panel every LISTEN_EVERY_MS, to keep it among its listeners
tasmota.at_ms = 10000
b.listened_at = 10000
b.every_second()
check("before LISTEN_EVERY_MS: nothing", size(lines), 1)
tasmota.at_ms = 10000 + ZigbeeBridge.LISTEN_EVERY_MS
b.every_second()
check("then the word that keeps it a listener, with no 1", lines[-1], "ZbRelayListen")
b.mesh_session(false)
b.every_second()
check("out of step: the session down, and the link with it", [b.session, b.link_state()], [false, false])
b.mesh_session(true)
check("in step again: the session rises again, and the consumers are told", risen[0], 2)
tasmota.at_ms = nil

# --- the events, to every consumer ---------------------------------------------------------------------
var got = []
b.on_event = def (p) got.push(["first", p]) end
b.listen(def (p) raise "value_error", "a consumer that fails" end)
b.listen(def (p) got.push(["second", p]) end)
tasmota.rules["ZbReceived"](nil, "ZbReceived", {"ZbReceived": {"0x00124B0000E00001": {"Power": 1}}})
check("an event reaches every consumer, the one on_event names first, and one that raises hides it from no other",
      [size(got), got[0][0], got[1][0]], [2, "first", "second"])

# --- the console's command says the mode ---------------------------------------------------------------
check("ZbBridgeMode is the console's command that says the mode", [b.mode, ZigbeeBridge.MODE_CMD], ["mesh", "ZbBridgeMode"])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
