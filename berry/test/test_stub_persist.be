# The persist stub (stub_persist.be), held to the real one: firmware/tasmota/lib/libesp32/berry_tasmota/src/embedded/persist.be,
# read from the submodule, its open() pointed at a file system that fails when the test says, and run through the same
# cases as the stub. What the real code does when a save falls over is what the stub has to do, and what the repo's tests
# of the brain see of persist: the file is as it was, the caller gets the exception, the map in memory is whole and still
# dirty, and a boot in between reads the file that was there.
#
# The real save writes _persist.tmp, closes it, takes _persist.json away and moves the tmp over its place; a boot that finds
# no file and a tmp finishes the move, and a file that is no map is put aside as _persist.bad.
#
# The file system commits at close(), as LittleFS does: what open("w") truncates is not written
# until the close, and a close after a write that failed does not commit. path.rename wants the '/' in front of both names,
# and open(), exists() and remove() take them without it (the same as the Matter code of Tasmota that moves its file this
# way). That is a reading of the sources, and the bench's power cuts to confirm.

import json
import string
import path
import persist

var failures = 0
var checks = 0
def same(a, b)
    if isinstance(a, map)
        if !isinstance(b, map) || size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !same(a[k], b[k]) return false end
        end
        return true
    end
    if isinstance(a, list)
        if !isinstance(b, list) || size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if !same(a[i], b[i]) return false end
        end
        return true
    end
    return a == b
end
def check(name, got, want)
    checks += 1
    if !same(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

# --- a file system that fails ------------------------------------------------------------------------

class FakeFs
    var files       # name -> what the close committed
    var budget      # bytes the next writes may take before one fails, once; nil for no end
    var refuse      # after how many open("w") the next one fails, once; nil for none
    var cut         # the power goes with the next write, and nothing is committed after it
    var cut_op      # "remove" or "rename": the power goes before the next one of them runs
    var no_move     # the next rename answers false and moves nothing
    var frozen      # the power went
    def init() self.files = {} self.budget = nil self.refuse = nil self.cut = false self.cut_op = nil self.no_move = false self.frozen = false end
end
var fs = FakeFs()

class FakeFile
    var name, mode, buf, dead
    def init(name, mode)
        self.name = name
        self.mode = mode
        self.buf = ""
        self.dead = false
        if mode == "w" && fs.refuse != nil
            if fs.refuse == 0
                fs.refuse = nil
                raise "io_error", "open: no memory"
            end
            fs.refuse -= 1
        elif mode != "w" && !fs.files.contains(name)
            raise "io_error", "no such file"
        end
    end
    def read() return fs.files[self.name] end
    def write(s)
        if fs.cut
            fs.frozen = true
            fs.cut = false
        end
        if fs.frozen  raise "power_cut", "gone" end
        if fs.budget != nil && size(s) > fs.budget
            fs.budget = nil
            self.dead = true
            raise "io_error", "write: no space"
        end
        if fs.budget != nil  fs.budget -= size(s) end
        self.buf += s
        return size(s)
    end
    def close()
        if self.mode == "w" && !self.dead && !fs.frozen  fs.files[self.name] = self.buf end
    end
end
def fopen(name, mode) return FakeFile(name, mode) end

# the path module over the same file system: exists and remove take a name with or without the '/', rename wants it on both
def bare(p) return size(p) > 0 && p[0] == '/' ? p[1 ..] : p end
def gate(op)
    if fs.frozen  raise "power_cut", "gone" end
    if fs.cut_op == op
        fs.cut_op = nil
        fs.frozen = true
        raise "power_cut", "gone"
    end
end
path.exists = def (p) return fs.files.contains(bare(p)) end
path.remove = def (p)
    gate("remove")
    var n = bare(p)
    if !fs.files.contains(n) return false end
    fs.files.remove(n)
    return true
end
path.rename = def (a, b)
    gate("rename")
    if size(a) == 0 || a[0] != '/' || size(b) == 0 || b[0] != '/' return false end
    if fs.no_move return false end
    var from = bare(a)
    if !fs.files.contains(from) return false end
    fs.files[bare(b)] = fs.files[from]
    fs.files.remove(from)
    return true
end

# the real persist.be, its open() the fake one's, its instance made as an import makes it (module.init)
def real_persist()
    var src = string.replace(read_text("firmware/tasmota/lib/libesp32/berry_tasmota/src/embedded/persist.be"), "open(", "fopen(")
    var mod = compile(src)()
    return mod.init(mod)
end

# both start with no file, and the stub with nothing in it
def fresh()
    fs = FakeFs()
    persist.store = {}
    persist.written = nil
    persist.pending = nil
    persist.bad = nil
    persist.marked = false
    persist.plan = nil
    persist.saves = 0
    persist.failures = 0
    return real_persist()
end

# the power is back: the file system is as the close left it, and writes work again
def power_back() fs.frozen = false fs.cut = false fs.cut_op = nil end

# the same thing to both: the real one as its users set a key (persist.key = value), the stub as it is set
def put(r, key, value)
    r.setmember(key, value)
    persist.setmember(key, value)
end

# what a file holds, parsed; "none" when there is none, and "garbage:" and the text when it is not JSON
def parsed(t)
    return t == nil ? "none" : (json.load(t) == nil ? "garbage:" + t : json.load(t))
end
def real_file() return parsed(fs.files.find("_persist.json")) end
def stub_file() return parsed(persist.written) end
def raised(f)
    try
        f()
    except .. as e
        return e
    end
    return nil
end

# --- the cases, on both ----------------------------------------------------------------------------

def normal_checks()
    var r = fresh()
    check("a new real persist writes nothing it was not asked to: no file", [raised(/ -> r.save()), real_file()], [nil, "none"])
    put(r, "house", {"zones": [1, 2], "name": "home"})
    put(r, "armed", true)
    var all = {"house": {"zones": [1, 2], "name": "home"}, "armed": true}
    check("set, and then saved: the file has it all", [raised(/ -> r.save()), real_file()], [nil, all])
    check("the stub, the same", [raised(/ -> persist.save()), stub_file()], [nil, all])
    check("a save leaves no temporary file behind, and the real one is not dirty", [fs.files.contains("_persist.tmp"), r._dirty], [false, false])
    # nothing changed since: save writes nothing, in both, which a test counts as `saves`
    fs.files["_persist.json"] = "{}"
    persist.written = "{}"
    r.save()
    persist.save()
    check("not dirty: no write, in either", [real_file(), stub_file()], [{}, {}])
    r.save(true)
    persist.save(true)
    check("forced: written, in either", [real_file(), stub_file()], [all, all])
    # a save over a file that is there: the new one takes its place whole
    put(r, "armed", false)
    r.save()
    persist.save()
    var then = {"house": {"zones": [1, 2], "name": "home"}, "armed": false}
    check("a save over a file: the new one is in its place, in both", [real_file(), stub_file(), fs.files.contains("_persist.tmp")], [then, then, false])
end

# the save that falls over: the file stays as it was, the exception reaches the caller, the map in memory is whole and
# still dirty, and the next save that works writes it all back
def failing_checks()
    var r = fresh()
    put(r, "house", {"zones": [1, 2]})
    put(r, "pattern", "1234")
    r.save()
    persist.save()
    var was = {"house": {"zones": [1, 2]}, "pattern": "1234"}
    check("before: both files whole", [real_file(), stub_file()], [was, was])
    # the heap runs out while it writes
    put(r, "armed", true)
    fs.budget = 12
    persist.fail_next()
    var errors = [raised(/ -> r.save()), raised(/ -> persist.save())]
    check("the real save raises, and so does the stub's", errors, ["io_error", "io_error"])
    check("and the file of both is as it was: the house and the pattern are kept (O01/C04)", [real_file(), stub_file()], [was, was])
    check("the temporary file is not left", fs.files.contains("_persist.tmp"), false)
    var whole = {"house": {"zones": [1, 2]}, "pattern": "1234", "armed": true}
    check("the map in memory is whole, and still dirty, in both", [r._p, persist.store, r._dirty, persist.marked], [whole, whole, true, true])
    # the next save that works writes it all back, from the map in memory
    r.save()
    persist.save()
    check("the next save that works writes it all back, in both", [real_file(), stub_file()], [whole, whole])
    # or a boot comes first, and reads the file that was there
    put(r, "armed", false)
    fs.budget = 12
    persist.fail_next()
    raised(/ -> r.save())
    raised(/ -> persist.save())
    var boot = real_persist()
    persist.reboot()
    check("a boot in between: what was kept is kept, in either", [boot._p, persist.store], [whole, whole])
end

# the open is refused, or the move over the file does not happen
def open_and_move_checks()
    var r = fresh()
    put(r, "a", 1)
    r.save()
    persist.save()
    put(r, "b", 2)
    fs.refuse = 0
    persist.fail_next()
    check("the temporary file cannot be opened: both raise", [raised(/ -> r.save()), raised(/ -> persist.save())], ["io_error", "io_error"])
    check("and the file is as it was, in both", [real_file(), stub_file(), fs.files.contains("_persist.tmp")], [{"a": 1}, {"a": 1}, false])
    # the new file is whole in the temp file and the move does not happen (only the real one has it: the old file was taken
    # away, and the new one is there to be found by the next boot)
    fs.no_move = true
    check("the move over the file fails: the save raises", raised(/ -> r.save()), "io_error")
    check("the old file is gone and the new one is whole in the temp file", [real_file(), parsed(fs.files.find("_persist.tmp")), r._dirty], ["none", {"a": 1, "b": 2}, true])
    fs.no_move = false
    var boot = real_persist()
    check("a boot finds the new one in the temp file, and finishes the move", [boot._p, real_file(), fs.files.contains("_persist.tmp")], [{"a": 1, "b": 2}, {"a": 1, "b": 2}, false])
end

# the power goes: before the move the file is as it was; between the old file taken away and the move, the boot finds the
# new one whole in the temp file
def power_checks()
    var r = fresh()
    put(r, "a", 1)
    r.save()
    persist.save()
    put(r, "b", 2)
    fs.cut = true
    persist.lose_next()
    check("the power goes while it writes: the real one's caller never sees it again", raised(/ -> r.save()), "power_cut")
    persist.save()
    check("the file is as it was, in both", [real_file(), stub_file()], [{"a": 1}, {"a": 1}])
    power_back()
    var boot = real_persist()
    persist.reboot()
    check("and a boot reads it, in both", [boot._p, persist.store], [{"a": 1}, {"a": 1}])
    # the power goes at the removal of the old file: the file is as it was, and the temp file, whole, is left behind
    r = fresh()
    put(r, "a", 1)
    r.save()
    persist.save()
    put(r, "b", 2)
    fs.cut_op = "remove"
    persist.lose_next()
    check("the power goes before the old file is taken away", raised(/ -> r.save()), "power_cut")
    persist.save()
    check("the file is as it was, in both", [real_file(), stub_file()], [{"a": 1}, {"a": 1}])
    power_back()
    boot = real_persist()
    persist.reboot()
    check("a boot reads it, and the leftover temp file does not count", [boot._p, persist.store], [{"a": 1}, {"a": 1}])
    # the power goes between the old file taken away and the move
    r = fresh()
    put(r, "a", 1)
    r.save()
    persist.save()
    put(r, "b", 2)
    fs.cut_op = "rename"
    persist.lose_next(true)
    check("the power goes after the old file is taken away", raised(/ -> r.save()), "power_cut")
    persist.save()
    check("there is no file, and the new one is whole in the temp file", [real_file(), stub_file(), parsed(fs.files.find("_persist.tmp"))], ["none", "none", {"a": 1, "b": 2}])
    power_back()
    boot = real_persist()
    persist.reboot()
    check("a boot finds it and finishes the save, in both", [boot._p, persist.store, real_file(), fs.files.contains("_persist.tmp")], [{"a": 1, "b": 2}, {"a": 1, "b": 2}, {"a": 1, "b": 2}, false])
end

# a boot: a file that is not a map is a persist with nothing in it, and the file is put aside, not covered
def load_checks()
    fresh()
    var cutoff = '{"a":1,"b":[1,2'
    fs.files["_persist.json"] = cutoff
    persist.written = cutoff
    var boot = real_persist()
    persist.reboot()
    check("a file cut off: nothing is read, in either", [boot._p, persist.store], [{}, {}])
    check("and it is kept aside, and no file is left to be covered, in both", [fs.files.find("_persist.bad"), persist.bad, fs.files.contains("_persist.json"), persist.written], [cutoff, cutoff, false, nil])
    fresh()
    fs.files["_persist.json"] = '[1,2]'
    persist.written = '[1,2]'
    boot = real_persist()
    persist.reboot()
    check("a file that is not a map: nothing, in either", [boot._p, persist.store], [{}, {}])
    check("and neither is dirty: the next save writes nothing until something is set", [boot._dirty, persist.marked], [false, false])
    check("it is kept aside, in both", [fs.files.find("_persist.bad"), persist.bad], ['[1,2]', '[1,2]'])
    # the next one put aside takes the place of the one that was
    fs.files["_persist.json"] = 'second'
    persist.written = 'second'
    boot = real_persist()
    persist.reboot()
    check("a second one put aside takes the place of the first", [fs.files.find("_persist.bad"), persist.bad], ['second', 'second'])
    fresh()
    fs.files["_persist.json"] = '{"a":1,"b":{"c":[1,2]}}'
    persist.written = '{"a":1,"b":{"c":[1,2]}}'
    boot = real_persist()
    persist.reboot()
    var good = {"a": 1, "b": {"c": [1, 2]}}
    check("a good one is read", [boot._p, persist.store], [good, good])
    check("and it is not put aside", [fs.files.contains("_persist.bad"), persist.bad], [false, nil])
end

normal_checks()
failing_checks()
open_and_move_checks()
power_checks()
load_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
