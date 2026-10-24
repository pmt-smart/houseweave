# berry/zigbee_pairing.be, across the day 24.8 of uptime: the Berry of Tasmota has 32-bit
# integers, so tasmota.millis() goes from 2^31-1 to -2^31 there, and a deadline compared with a plain `>=`
# is over (or not yet) by the sign, for a few seconds, whatever the clock says. What the glass waits for from
# the node being added, and the word said again until it answers, are held until their own deadline, on either side of the wrap.
#
# The wrap needs the integers of the device. The vendored interpreter built with 64-bit integers has no
# such day, and the test says so and ends there: the suites that run on it and in the simulator's VM
# (--vm=wasm) are the ones with 32-bit integers.

import persist
import json
import string

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

var told = []
def espnow_send(msg, as_event) told.push(json.load(msg)) return true end
def run_wrap()
    var edge = 0x7FFFFFFF
    if edge + 1 > 0
        print("skip - this Berry has integers wider than 32 bits: the wrap of millis() is the device's")
        return
    end

    persist.store = {}
    var bridge = ZigbeeBridge()
    var p = ZigbeePairing(bridge)

    # --- the Wi-Fi handed over and never answered: the glass says it does not know ---
    tasmota.at_ms = edge - 500
    p.wifi = {"state": "asking", "kind": "give", "until": tasmota.millis(2000)}
    p.every_100ms()
    check("a Wi-Fi given 500 ms before the wrap, 2 s to answer: asking", p.wifi["state"], "asking")
    tasmota.at_ms = edge + 1000
    p.every_100ms()
    check("1 s after the wrap, 500 ms left: asking", p.wifi["state"], "asking")
    tasmota.at_ms = edge + 1500
    p.every_100ms()
    check("at the deadline: it does not know", p.wifi["state"], "unknown")
    p.wifi = nil

    # --- this panel's word to the node, again until the node's comes ---
    p.asking = "hello"
    p.guesting = true
    tasmota.at_ms = edge - 500
    p.hello_at = tasmota.millis(1000)
    told.clear()
    p.every_100ms()
    check("a word planned 1 s ahead, across the wrap: not yet said", size(told), 0)
    tasmota.at_ms = edge + 600
    p.every_100ms()
    check("past it: said again", size(told) > 0 ? told[-1]["ZbPair"] : nil, "guest")
    p.asking = nil
    p.guesting = false
    tasmota.at_ms = nil
end

run_wrap()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
