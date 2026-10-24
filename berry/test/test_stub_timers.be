# The timers of the test stubs (TimerBook, in stub_tasmota.be), held to Tasmota's: a timer is one shot, set_timer pushes
# one and nothing replaces another of the same id, remove_timer(id) takes out every one of the id, and run_timers fires
# those whose time came in the order they were set (tasmota_class.be). A stub that keeps them by id replaces the first
# with the second, and the defect of any code that sets a timer again without removing the one before it vanishes from
# the suite. libs/nspanel-sim/vm/test/fidelity.test.mjs asks the real class, on the simulator's VM, the
# same questions.

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

var ran = []
def tag(s) return / -> ran.push(s) end

def stacking_checks()
    var t = TimerBook(tasmota)
    t.push(100, tag("a"), "x")
    t.push(300, tag("b"), "x")
    check("two timers of one id are two", [t.count("x"), t.size()], [2, 2])
    check("the oldest answers find, and the delay it was set with", [t.find("x") != nil, t.delay_of("x")], [true, 100])
    ran.clear()
    check("a fire runs the oldest, and only it", [t.fire("x"), ran, t.count("x")], [true, ["a"], 1])
    check("and a one shot is gone once it ran", [t.fire("x"), t.fire("x"), ran], [true, false, ["a", "b"]])
    t.push(100, tag("c"), "x")
    t.push(100, tag("d"), "y")
    t.push(100, tag("e"), "x")
    check("remove_timer takes out every one of the id, and says how many", [t.remove("x"), t.count("x"), t.keys()], [2, 0, ["y"]])
    check("an id nobody has: nothing, and nothing to fire", [t.remove("z"), t.fire("z"), t.find("z"), t.delay_of("z")], [0, false, nil, nil])
    t.clear()
    t.push(0, tag("f"), nil)
    t.push(0, tag("g"), nil)
    check("timers with no id stack too, and are one id, which nobody names", t.count(nil), 2)
    t.clear()
    ran.clear()
    t.push(0, tag("h"), "k")
    t.push(0, tag("i"), "k")
    t.push(0, tag("j"), "k")
    t.fire_all("k")
    check("fire_all runs those pending, oldest first", ran, ["h", "i", "j"])
    var f = t.item("w")
    var raised = false
    try
        f()
    except .. as e
        raised = true
    end
    check("timers[id]() with none pending is an error, not a quiet nothing", raised, true)
    t.push(0, tag("l"), "w")
    ran.clear()
    t.item("w")()
    check("and with one it fires it", [ran, t.count("w")], [["l"], 0])
end

def clock_checks()
    tasmota.at_ms = 1000
    var t = TimerBook(tasmota)
    ran.clear()
    t.push(500, tag("late"), "late")
    t.push(100, tag("soon"), "soon")
    t.push(100, tag("soon2"), "soon")
    t.run_due()
    check("nothing is due before its time", ran, [])
    t.advance(100)
    check("run_timers fires what came due, in the order they were set", ran, ["soon", "soon2"])
    t.advance(399)
    check("and not what has a millisecond to go", [ran, t.count("late")], [["soon", "soon2"], 1])
    t.advance(1)
    check("then it does", [ran, t.size()], [["soon", "soon2", "late"], 0])
    # a timer set while the others run, and due, runs in the same pass; one not due waits
    ran.clear()
    t.push(0, def () ran.push("first") t.push(0, tag("again"), "n") t.push(50, tag("later"), "n") end, "m")
    t.advance(0)
    check("a timer set by a timer that runs, and due, runs in the same pass", ran, ["first", "again"])
    check("and one that is not due waits", t.count("n"), 1)
    # run_all, which a stub's tests use to run what is pending whatever its time: what a timer sets waits, and what a
    # timer removes does not run
    t.clear()
    ran.clear()
    t.push(900, def () ran.push("one") t.remove("two") t.push(0, tag("new"), "four") end, "one")
    t.push(900, tag("two"), "two")
    t.push(900, tag("three"), "three")
    t.run_all()
    check("run_all: what a timer removed did not run, and what it set waits for the next", [ran, t.keys()], [["one", "three"], ["four"]])
    tasmota.at_ms = nil
end

def base_checks()
    # the base stub, with a list to land in: [ms, f, id] entries, which stack and which remove_timer clears by id
    var s = TasmotaStub()
    s.timers = []
    s.set_timer(10, tag("p"), "id")
    s.set_timer(20, tag("q"), "id")
    s.set_timer(30, tag("r"), "other")
    check("a list takes them as they come", size(s.timers), 3)
    s.remove_timer("id")
    check("remove_timer takes out both of the id and no other", [size(s.timers), s.timers[0][2]], [1, "other"])
    # and a TimerBook, given to it as the place to land in
    var s2 = TasmotaStub()
    s2.timers = TimerBook(s2)
    s2.set_timer(10, tag("p"), "id")
    s2.set_timer(20, tag("q"), "id")
    check("a TimerBook takes them stacked", s2.timers.count("id"), 2)
    s2.remove_timer("id")
    check("and remove_timer clears it", s2.timers.size(), 0)
    # tasmota_class.be refuses a method where it wants a closure: set_timer(ms, self.method)
    var refused = ""
    class Holder
        def go() end
        def method() return self.go end
    end
    try
        s.set_timer(10, Holder().method())
    except .. as e, m
        refused = e
    end
    check("a bound method is no function for set_timer, as in the firmware", refused, "type_error")
    s.set_timer(10, / -> Holder().go())
    check("a closure is", size(s.timers), 2)
end

stacking_checks()
clock_checks()
base_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
