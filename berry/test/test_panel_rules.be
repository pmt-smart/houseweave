# berry/panel_rules.be: the panel's Tasmota rules taken by one of Tasmota's ("?"), and each event handed to the parts whose pattern it has, as the rules
# were: the keys in any case, each key's parts in the order they were added, f(value, pattern, event); one of the same pattern and id is replaced; a
# part taken out while the event goes round is not called for it; a part that fails does not keep the others from the event; and a pattern that is
# not one of keys is refused.
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
    global.panel_rules = nil
    for k: tasmota.rule_lists.keys() tasmota.rule_lists.remove(k) end
    for k: tasmota.rules.keys() tasmota.rules.remove(k) end
    return PanelRules.start()
end

# an event as Tasmota hands it to its rules: the one rule of any key, with the event whole
def fire(ev) tasmota.rules["?"](nil, "?", ev) end

def section_one_rule()
    global.panel_rules = nil
    check("with none made, they are Tasmota's", PanelRules.of() == tasmota, true)
    var r = fresh()
    check("the boot makes it once, and it sets one rule of Tasmota's, of any key", [PanelRules.start() == r, PanelRules.of() == r, size(tasmota.rule_lists.find("?", [])), size(tasmota.rule_lists)], [true, true, 1, 1])
end

def section_keys()
    var r = fresh()
    var got = []
    r.add_rule("Power1#state", / v, t, m -> got.push(["plan", v, t]))
    r.add_rule("Power1#state", / v, t, m -> got.push(["cmd", v]))
    r.add_rule("StaScan", / v -> got.push(["scan", v]))
    r.add_rule("Wifi#Connected", / -> got.push(["wifi"]))
    fire({"Power1": {"State": 1}})
    check("an event to the parts of its key whose other keys it has, in the order they were added, with the value and the pattern", got, [["plan", 1, "Power1#state"], ["cmd", 1]])
    got.clear()
    fire({"POWER1": {"state": 0}})
    check("the keys in any case, as Tasmota matches them", got, [["plan", 0, "Power1#state"], ["cmd", 0]])
    got.clear()
    fire({"Power1": {"Boot": 1}})
    fire({"Power2": {"State": 1}})
    check("an event that lacks a key of the pattern, and one of another key: nothing", got, [])
    fire({"StaScan": [["Cottage", -60]], "Wifi": {"Connected": 1}})
    check("a pattern of one key takes its value whole; an event of two keys goes to the parts of both", got, [["scan", [["Cottage", -60]]], ["wifi"]])
    got.clear()
    fire("not json")
    fire({})
    check("an event that is no map, or an empty one: nothing", got, [])
end

def section_ids()
    var r = fresh()
    var got = []
    r.add_rule("ZbPair", / v -> got.push("first"), "pairing")
    r.add_rule("ZbPair", / v -> got.push("second"), "pairing")
    r.add_rule("ZbPair", / v -> got.push("other"), "view")
    fire({"ZbPair": {"Node": 3}})
    check("one of the same pattern and id is replaced, and another id stays", got, ["second", "other"])
    got.clear()
    r.remove_rule("ZbPair", "pairing")
    fire({"ZbPair": {"Node": 3}})
    check("one taken out is not called again", got, ["other"])
    got.clear()
    # a part that takes another out while the event goes round: that one is not called for it; and a part that takes itself out
    r = fresh()
    r.add_rule("ZbInfo", def (v) got.push("a") r.remove_rule("ZbInfo", "b") end, "a")
    r.add_rule("ZbInfo", / v -> got.push("b"), "b")
    r.add_rule("ZbInfo", def (v) got.push("c") r.remove_rule("ZbInfo", "c") end, "c")
    r.add_rule("ZbInfo", / v -> got.push("d"), "d")
    fire({"ZbInfo": {}})
    fire({"ZbInfo": {}})
    check("a part taken out while the event goes round is not called for it, and one that takes itself out is called that once", got, ["a", "c", "d", "a", "d"])
end

def section_failure()
    var r = fresh()
    var got = []
    r.add_rule("ZbReceived", def (v) raise "boom_error", "a part that fails" end)
    r.add_rule("ZbReceived", / v -> got.push("after"))
    fire({"ZbReceived": {"0x1234": {"Power": 1}}})
    check("a part that fails is logged, and the parts after it have the event all the same", got, ["after"])
end

def section_refused()
    var r = fresh()
    var refused = []
    for p: ["Dimmer>50", "Power1#State==1", "A#?#B", "Arr[1]", "", nil]
        try
            r.add_rule(p, / v -> nil)
        except "value_error"
            refused.push(p)
        end
    end
    check("a pattern with an operator, a wildcard or an index, and no pattern, is refused: it is a rule of Tasmota's", size(refused), 6)
    check("and nothing was added", size(r.keys), 0)
end

section_one_rule()
section_keys()
section_ids()
section_failure()
section_refused()
global.panel_rules = nil

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
