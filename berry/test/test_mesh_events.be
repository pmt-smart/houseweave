# berry/mesh_events.be: the mesh driver's events taken by one rule and handed to the parts that take them: a frame (the event
# that has Data) to the parts that take frames, a Timeline, a Synced and an Outcome to the parts that take that, each kind in the order the
# parts were added; one of the same id and kind is replaced; a part taken out is not called again, and one taken out while the event goes
# round is not called for it, as with the rules.
import global

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if str(got) != str(want)
        print("FAIL " + name + ": got " + str(got) + ", want " + str(want))
        failures += 1
    end
end

def fresh()
    global.mesh_events = nil
    for k: tasmota.rule_lists.keys() tasmota.rule_lists.remove(k) end
    for k: tasmota.rules.keys() tasmota.rules.remove(k) end
    return MeshEvents.get()
end

def section_one_rule()
    var ev = fresh()
    check("the dispatcher is made once, and puts one rule on the mesh driver's events and one on the OTA driver's",
          [MeshEvents.get() == ev, size(tasmota.rule_lists.find("EspNowMesh", [])), size(tasmota.rule_lists.find("EspNowOta", [])), size(tasmota.rule_lists)], [true, 1, 1, 2])
    var got = []
    ev.add("Ota", / v -> got.push(v), "test")
    tasmota.rule_lists["EspNowOta"][0][1]({"Node": 7, "State": 1})
    check("an OTA driver's event goes to the parts of the kind Ota", got, [{"Node": 7, "State": 1}])
end

def section_kinds()
    var ev = fresh()
    var got = []
    ev.add("frame", / v -> got.push(["house", v["From"]]), "house")
    ev.add("frame", / v -> got.push(["alarm", v["From"]]), "alarm")
    ev.add("Outcome", / v -> got.push(["cmd", v["Counter"]]), "cmd")
    ev.add("Timeline", / v -> got.push(["tl", v["Ticks"]]), "house")
    ev.add("Synced", / v -> got.push(["sy", v["Value"]]), "house")
    tasmota.rules["EspNowMesh"]({"From": 3, "Type": 0, "Data": "01"})
    check("a frame goes to the parts that take frames, in the order they were added", got, [["house", 3], ["alarm", 3]])
    got.clear()
    tasmota.rules["EspNowMesh"]({"Outcome": {"Counter": 9, "Ok": 1}})
    check("an Outcome goes to the parts that take it, with the map under the key", got, [["cmd", 9]])
    got.clear()
    tasmota.rules["EspNowMesh"]({"Timeline": {"Ticks": 4}})
    tasmota.rules["EspNowMesh"]({"Synced": {"Value": 1}})
    check("a Timeline and a Synced the same", got, [["tl", 4], ["sy", 1]])
    got.clear()
    tasmota.rules["EspNowMesh"]({"Notice": {"Kind": "Silent"}})
    tasmota.rules["EspNowMesh"]("not a map")
    check("a kind nobody takes, and what is not a map, go nowhere", got, [])
end

def section_ids()
    var ev = fresh()
    var got = []
    ev.add("frame", / v -> got.push("first"), "house")
    ev.add("frame", / v -> got.push("cmd"), "cmd")
    ev.add("frame", / v -> got.push("second"), "house")
    tasmota.rules["EspNowMesh"]({"Data": "01"})
    check("one of the same id and kind is replaced, and goes to the end, as add_rule does", got, ["cmd", "second"])
    check("has says whether a part of an id is there", [ev.has("house"), ev.has("cmd"), ev.has("nobody")], [true, true, false])
    ev.remove("frame", "house")
    got.clear()
    tasmota.rules["EspNowMesh"]({"Data": "01"})
    check("a part taken out is not called again", [got, ev.has("house")], [["cmd"], false])
end

def section_out_while_going()
    var ev = fresh()
    var got = []
    ev.add("frame", def (v) got.push("leaving") ev.remove("frame", "leaving") end, "leaving")
    ev.add("frame", / v -> got.push("next"), "next")
    ev.add("frame", / v -> got.push("last"), "last")
    tasmota.rules["EspNowMesh"]({"Data": "01"})
    check("a part that takes itself out while the event goes round: the one after it is not called for this event, as with the rules", got, ["leaving", "last"])
    got.clear()
    tasmota.rules["EspNowMesh"]({"Data": "01"})
    check("and the next event goes to the ones left", got, ["next", "last"])
end

section_one_rule()
section_kinds()
section_ids()
section_out_while_going()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
