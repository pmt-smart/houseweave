# berry/boiler_history.be, what a water heater's thermostat measured: the slots of five minutes and the days, the slots filled with no clock, and
# the file that keeps them.

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

var logged = []
log = def (msg, level) logged.push([msg, level]) end

# a history kept in the test's own directory, and `n` seconds of the thermostat from the local time `t` on: the water and whether the heater is on
def fresh(name) return BoilerHistory(TEST_TMP + "/" + name) end
def run_for(h, t, n, water, heating)
    var i = 0
    while i < n
        h.tick(t != nil ? t + i : nil, water, heating)
        i += 1
    end
    return t != nil ? t + n : nil
end

# a Monday at midnight, local time, a whole number of days and of slots
var DAY0 = 20000 * 86400
var S = BoilerHistory.SLOT_S

def slot_checks()
    var h = fresh("a.bin")
    check("out of its box it holds nothing", [h.last, h.day, h.slot_at(DAY0 / S), h.day_at(20000), size(h.slots), size(h.days)],
          [nil, nil, nil, nil, BoilerHistory.SLOTS * 2, BoilerHistory.DAYS * 4])
    check("a temperature in tenths as half degrees, to the nearest, within 0 to 127 degrees, and NONE for none",
          [BoilerHistory.half(580), BoilerHistory.half(582), BoilerHistory.half(583), BoilerHistory.half(-30), BoilerHistory.half(2000), BoilerHistory.half(nil)],
          [116, 116, 117, 0, 254, 255])
    # the first slot: the water at 55.0 and the heater on for three minutes of it
    var t = run_for(h, DAY0, 180, 550, true)
    t = run_for(h, t, 120, 562, false)
    check("a slot is written only when it is over", [h.last, h.slot_at(DAY0 / S)], [nil, nil])
    h.tick(t, nil, false)
    check("at the first second of the next: the water it ended with, and the minutes the heater was on",
          [h.last, h.slot_at(DAY0 / S)], [DAY0 / S, [112, 3, false]])
    check("and its day has it", h.day_at(20000), [112, 112, 3])
    # the second slot with no reading at all, the third with the heater on all of it
    t = run_for(h, t + 1, S - 1, nil, false)
    t = run_for(h, t, S, 600, true)
    h.tick(t, 600, true)
    check("a slot with no reading says so, and a slot with the heater on all of it is five minutes",
          [h.slot_at(DAY0 / S + 1), h.slot_at(DAY0 / S + 2)], [[255, 0, false], [120, 5, false]])
    check("the day: the lowest and the highest water, and the minutes on", h.day_at(20000), [112, 120, 8])
    check("a slot not written yet and one a week before are not there, and one of the week that nothing filled has no reading",
          [h.slot_at(DAY0 / S + 3), h.slot_at(DAY0 / S + 2 - BoilerHistory.SLOTS), h.slot_at(DAY0 / S - 1)], [nil, nil, [255, 0, false]])
end
slot_checks()

def gap_checks()
    var h = fresh("b.bin")
    var t = run_for(h, DAY0, S, 500, false)
    h.tick(t, 500, false)
    # the node off for an hour: the slots between are nobody's
    var later = DAY0 + 13 * S
    h.tick(later, 510, false)
    check("a jump of the clock closes the slot that was being filled", h.slot_at(DAY0 / S + 1), [100, 0, false])
    t = run_for(h, later + 1, S - 1, 510, false)
    h.tick(t, 510, false)
    check("the slots nothing filled are with no reading, and the one after them is written",
          [h.slot_at(DAY0 / S + 2), h.slot_at(DAY0 / S + 12), h.slot_at(DAY0 / S + 13)], [[255, 0, false], [255, 0, false], [102, 0, false]])
    # a week and more off: the whole ring is past
    var far = DAY0 + (BoilerHistory.SLOTS + 50) * S
    h.tick(far, 520, true)
    t = run_for(h, far + 1, S - 1, 520, true)
    h.tick(t, 520, true)
    check("past a week off, nothing of before is in the ring", [h.slot_at(DAY0 / S), h.slot_at(DAY0 / S + 13), h.slot_at(far / S)], [nil, nil, [104, 5, false]])
    check("and the days of before stay, with the days between them empty",
          [h.day_at(20000), h.day_at(20003), h.day_at(far / 86400)], [[100, 102, 0], [255, 255, 0], [104, 104, 5]])
    # a clock set back writes over what is there, and moves nothing
    h.put(far / S - 5, 90, 2)
    check("a slot numbered before the newest is written over, and the newest stays", [h.slot_at(far / S - 5), h.last], [[90, 2, false], far / S])
    # a year and more: the days' ring starts over
    h.put((20000 + 500) * BoilerHistory.DAY_SLOTS, 80, 1)
    check("past a year, the days of before are gone", [h.day_at(20000), h.day_at(20500)], [nil, [80, 80, 1]])
end
gap_checks()

def no_clock_checks()
    var h = fresh("c.bin")
    # three slots and a half with no clock, the heater on in the second
    run_for(h, nil, S, 400, false)
    run_for(h, nil, S, 420, true)
    run_for(h, nil, S, 440, false)
    run_for(h, nil, 100, 450, false)
    check("with no clock the slots have no place: they are kept in order", [h.last, h.pending], [nil, [[80, 0], [84, 5], [88, 0]]])
    # the clock comes in the middle of a slot
    var now = DAY0 + 40 * S + 100
    h.tick(now, 451, false)
    var n = now / S
    check("when the clock comes they are the slots just before it, marked as filled with no clock",
          [h.slot_at(n - 3), h.slot_at(n - 2), h.slot_at(n - 1), h.pending, h.slot], [[80, 0, true], [84, 5, true], [88, 0, true], [], n])
    var t = run_for(h, now + 1, S - 101, 452, false)
    h.tick(t, 452, false)
    check("and the slot it came in is marked too", h.slot_at(n), [90, 0, true])
    t = run_for(h, t + 1, S - 1, 453, false)
    h.tick(t, 453, false)
    check("the next is a slot as any other", h.slot_at(n + 1), [91, 0, false])
    # more than a day with no clock: the oldest go
    var g = fresh("d.bin")
    var i = 0
    while i < BoilerHistory.PENDING_MAX + 3
        g.water = i * 2
        g.ticks = S
        g.tick(nil, nil, false)
        i += 1
    end
    check("a day of them at most is kept, the oldest dropped",
          [size(g.pending), g.pending[0][0], g.pending[-1][0]], [BoilerHistory.PENDING_MAX, BoilerHistory.half(6), BoilerHistory.half((BoilerHistory.PENDING_MAX + 2) * 2)])
end
no_clock_checks()

def file_checks()
    import path
    var h = fresh("e.bin")
    var t = run_for(h, DAY0, S, 500, true)
    h.tick(t, 500, true)
    var img = h.image()
    check("the file is a head, the slots and the days", size(img), BoilerHistory.HEAD + BoilerHistory.SLOTS * 2 + BoilerHistory.DAYS * 4)
    var g = fresh("f.bin")
    check("what a file kept is taken whole", [g.take(img), g.last, g.day, g.slot_at(DAY0 / S), g.day_at(20000)], [true, DAY0 / S, 20000, [100, 5, false], [100, 100, 5]])
    var bad = img.copy()
    bad[0] = 0
    check("what is no file of it is refused, and nothing changes",
          [g.take(bad), g.take(img[0 .. 100]), g.take(nil), g.take("x"), g.last], [false, false, false, false, DAY0 / S])
    check("a history with nothing in it is one too", [fresh("g.bin").take(fresh("h.bin").image()), fresh("i.bin").load()], [true, false])
    # the save: beside the file, then over it
    check("a save writes the file, and a second with nothing changed writes nothing",
          [h.dirty, h.save(), h.dirty, size(path.renamed), h.save(), size(path.renamed)], [true, true, false, 1, true, 1])
    var k = fresh("e.bin")
    check("and a boot reads it back", [k.load(), k.last, k.slot_at(DAY0 / S)], [true, DAY0 / S, [100, 5, false]])
    # the save every hour: the slot that ends on the hour
    path.renamed.clear()
    var s = fresh("j.bin")
    t = run_for(s, DAY0 + 3600 - S, S, 500, false)
    check("nothing is saved inside the hour", size(path.renamed), 0)
    s.tick(t, 500, false)
    check("the slot that ends on the hour is saved with the rest", [size(path.renamed), fresh("j.bin").load()], [1, true])
    # a save that fails does not raise
    logged.clear()
    var bad_dir = BoilerHistory(TEST_TMP + "/no/such/dir/x.bin")
    bad_dir.put(DAY0 / S, 100, 1)
    check("a save that cannot write raises nothing, says so, and keeps what it has to save",
          [bad_dir.save(), bad_dir.dirty, size(logged) > 0 && logged[-1][1] == 1], [false, true, true])
    # back to its image
    k.erase()
    check("erased, it holds nothing, and its files are removed",
          [k.last, k.day, path.removed.find(TEST_TMP + "/e.bin") != nil, path.removed.find(TEST_TMP + "/e.bin.new") != nil], [nil, nil, true, true])
end
file_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
