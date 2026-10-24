# berry/light.be, the joBr99 stack's Light entity (the one the panel with no project of ours runs), where it saves what a bulb reported: a save that
# falls over (the heap runs out, the flash is full) is a line in the log and not an exception that unwinds whoever delivered the report.
# It was the last raw persist.save() in the Berry of the repository. The flash is the persist stub's (stub_persist.be), which fails as the
# fork's persist.be does: fail_next() makes the next write that happens raise, and the file is as it was.

import json
import persist

var failures = 0
var checks = 0

def check(name, got, want)
    checks += 1
    if got != want
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# what the Light needs of the bridge (zigbee_bridge.be): a place to hang the event handler on, and a way to send
class FakeBridge
    var on_event, sent
    def init() self.sent = [] end
    def send(cmd) self.sent.push(cmd) end
end

# a Zigbee report of one bulb, as the bridge hands it over (already a map)
def report(addr, attrs)
    return {"ZbReceived": {addr: attrs}}
end

# what the file holds of the bulb: its map, as the last save left it
def on_file()
    return persist.written == nil ? nil : json.load(persist.written)["light_L1"]
end

# the call, with whatever it raises caught: nil when it raised nothing
def deliver(light, payload)
    try
        light.on_zigbee_event(payload)
    except .. as e, m
        return e + ": " + m
    end
    return nil
end

def run_checks()
    var bridge = FakeBridge()
    var light = Light(nil, bridge)
    var told = []
    light.on_change = def (id, detail) told.push([id, detail]) end
    light.add("L1", "0x1234", "Lamp")
    check("the light hangs its handler on the bridge", bridge.on_event != nil, true)

    # the control: a report that changes the state is kept, and written once
    check("a report that changes the state raises nothing", deliver(light, report("0x1234", {"Power": 1, "Dimmer": 200})), nil)
    check("the state is updated, the screen told, and the flash has it", [light.devices["L1"]["power"], light.devices["L1"]["bri"], size(told) > 0, persist.saves],
          [1, 200, true, 1])
    check("what the file holds is the state", [on_file()["power"], on_file()["bri"]], [1, 200])

    # a save that falls over: the report is still taken, the screen told, and the caller sees no exception
    var shown = size(told)
    persist.fail_next()
    check("a save that falls over does not raise into whoever delivered the report", deliver(light, report("0x1234", {"Power": 0})), nil)
    check("the write did fall over", persist.failures, 1)
    check("and the report was taken all the same: the state is in memory, and the screen was told before the save", [light.devices["L1"]["power"], size(told) > shown], [0, true])
    check("the file is as it was, the last whole one", [on_file()["power"], on_file()["bri"]], [1, 200])

    # the map in memory is whole and still marked, so the next report that saves writes it all back
    check("the next report saves what it says and what the one before said", deliver(light, report("0x1234", {"Dimmer": 100})), nil)
    check("the file has both: the power that was lost and the brightness that came after", [on_file()["power"], on_file()["bri"], persist.failures], [0, 100, 1])

    # a report that changes nothing writes nothing, and a report from a device that is not ours is left alone
    var saves = persist.saves
    check("the same report again changes nothing and saves nothing", [deliver(light, report("0x1234", {"Power": 0, "Dimmer": 100})), persist.saves], [nil, saves])
    check("a report of another device is not ours", [deliver(light, report("0x9999", {"Power": 1})), persist.saves], [nil, saves])
    persist.fail_next()
    check("a report of another device does not use the failure that was waiting", [deliver(light, report("0x9999", {"Power": 1})), persist.failures], [nil, 1])
end

run_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
