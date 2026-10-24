# berry/zbbridge_relay.be, across the day 24.8 of uptime: the Berry of Tasmota has 32-bit integers, so tasmota.millis() goes from
# 2^31-1 to -2^31 there, and a deadline compared with a plain `<` is over (or not yet) by the sign, for a few seconds, whatever the clock says. A
# panel that commanded the bridge hears it LISTEN_MS, and a request to identify it lasts its time, on either side of the wrap.
#
# The wrap needs the integers of the device. The vendored interpreter built with 64-bit integers has no
# such day, and the test says so and ends there: the suites that run on it and in the simulator's VM
# (--vm=wasm) are the ones with 32-bit integers.

import json
import string
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

def run_wrap()
    var edge = 0x7FFFFFFF
    if edge + 1 > 0
        print("skip - this Berry has integers wider than 32 bits: the wrap of millis() is the device's")
        return
    end

    var r = ZbBridgeRelay.start()
    import global as natives
    var told = []
    natives.espnow_send = def (msg, as_event) told.push(json.load(msg)) return true end
    listen_to(r, told)

    # --- a panel that commanded this bridge hears its events LISTEN_MS, on either side of the wrap ---
    var h = r.house
    h.state.marks = {}
    r.heard_from = {}
    tasmota.at_ms = edge - 500
    r.run("ZbRelayListen", "mesh", 4)
    told.clear()
    r.send_text('{"ZbPing":{"Device":"0x1"}}')
    check("500 ms before the wrap: the panel that said it keeps this bridge hears it", size(told), 1)
    tasmota.at_ms = edge + 1000
    check("1 s after the wrap, the clock is negative", tasmota.millis() < 0, true)
    told.clear()
    r.send_text('{"ZbPing":{"Device":"0x1"}}')
    check("1.5 s later, across the wrap: it still does", size(told), 1)
    tasmota.at_ms = edge - 500 + ZbBridgeRelay.LISTEN_MS
    told.clear()
    r.send_text('{"ZbPing":{"Device":"0x1"}}')
    check("LISTEN_MS after its word: no more", [size(told), r.heard_from.contains(4)], [0, false])

    # --- a panel's request to identify the bridge lasts IDENTIFY_FOR_MS, on either side of the wrap ---
    tasmota.replies["EspNowPairOpen 120,0"] = {"EspNowPairOpen": "Open"}
    tasmota.at_ms = edge - 500
    r.open_window()
    r.identify()
    check("asked to identify itself 500 ms before the wrap: its deadline is on the other side", r.identify_until < 0, true)
    tasmota.at_ms = edge + 1000
    check("1.5 s later, across the wrap: it still blinks fast", tasmota.time_reached(r.identify_until), false)
    tasmota.at_ms = edge - 500 + ZbBridgeRelay.IDENTIFY_FOR_MS
    check("IDENTIFY_FOR_MS after: it is over", tasmota.time_reached(r.identify_until), true)
    r.close_window()
    tasmota.at_ms = nil
end

run_wrap()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
