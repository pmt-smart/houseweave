# berry/panel_names.be, the devices' names told to the bridge for Home
# Assistant: all of them when the link comes up, what a save
# changed, a moment apart, and nothing with no bridge's link to carry them.

import global
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

# the transport: its mode, the bridge paired, and its link
class FakeBridge
    var mode, linked, paired
    def init() self.mode = "mesh" self.linked = true self.paired = true end
    def peer() return self.paired ? {"mac": "B0:B0:B0:00:00:01"} : nil end
    def link_state() return self.linked end
end
global.zb_bridge = FakeBridge()

# the timers, run by the test in their order, with their delays kept
class NamesTasmota : TasmotaStub
    var timers, delays
    def init() self.timers = [] self.delays = [] end
    def set_timer(ms, f, id) self.timers.push(f) self.delays.push(ms) end
    def run()
        while size(self.timers) > 0
            var f = self.timers[0]
            self.timers.remove(0)
            f()
        end
    end
end
tasmota = NamesTasmota()

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

var store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
var sent = []
var names = PanelNames(store, / c -> sent.push(c))
def told(i) return json.load(sent[i][size("ZbRelayName ") ..]) end
var zigbee = 0
for d: store.doc["devices"]
    if !PanelStore.is_relay_id(d[0]) zigbee += 1 end
end

# --- the link comes up: every name -------------------------------------------------------------
names.linked()
tasmota.run()
check("the link up: every Zigbee device's name, and none of the relays'", size(sent), zigbee)
var first = nil
for d: store.doc["devices"]
    if first == nil && !PanelStore.is_relay_id(d[0]) first = d end
end
var found = nil
for i: 0 .. size(sent) - 1
    if told(i)["IEEE"] == first[0] found = told(i) end
end
check("each by its IEEE, with its name", found, {"IEEE": first[0], "Name": first[1]})
check("a moment apart", tasmota.delays[1 ..].find(0), nil)

# --- a save: what changed --------------------------------------------------------------------------
sent.clear()
names.changed()
tasmota.run()
check("a save that changed no name: nothing", sent, [])
first[1] = "Desk light"
names.changed()
tasmota.run()
check("a name changed: that one", [size(sent), told(0)], [1, {"IEEE": first[0], "Name": "Desk light"}])
sent.clear()
var gone = store.doc["devices"][-1]
store.doc["devices"].remove(size(store.doc["devices"]) - 1)
names.changed()
tasmota.run()
check("a device gone: with no name, for the bridge to forget it", [size(sent), told(0)], [1, {"IEEE": gone[0], "Name": ""}])

# --- no link to carry them ---------------------------------------------------------------------------
sent.clear()
global.zb_bridge.linked = false
first[1] = "Desk"
names.changed()
tasmota.run()
check("the link down: nothing sent", sent, [])
global.zb_bridge.linked = true
names.linked()
tasmota.run()
check("up again: all of them, the one renamed while it was down with its new name",
      [size(sent), sent[0] != nil], [zigbee - 1, true])
var mesa = false
for i: 0 .. size(sent) - 1
    if told(i)["IEEE"] == first[0] && told(i)["Name"] == "Desk" mesa = true end
end
check("", mesa, true)
sent.clear()
global.zb_bridge.linked = false
names.linked()
tasmota.run()
check("the bridge of the house not in step on the mesh: none told", sent, [])
global.zb_bridge.linked = true
global.zb_bridge.paired = false
names.linked()
tasmota.run()
check("no bridge in the house: nothing", sent, [])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
