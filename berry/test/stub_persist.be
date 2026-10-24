# Tasmota's `persist` module, as a file the standalone interpreter can import.
#
# `import` is the one thing a stub cannot fake with a global: it looks the name
# up in the module table and in `sys.path`, and never at what happens to be
# defined. So this is a real module in a real file, dropped next to the combined
# script and reached by pushing that directory onto the path (test/run.mjs).
#
# It keeps what it is given in memory, which is the whole of what a test needs:
# the flash is not what is under test, the code that decides WHAT to keep is,
# and how often it writes (`saves`).
#
# And what a save would leave in the file (`written`, as JSON): Tasmota's
# persist.be writes only when something was set, removed or zeroed since the
# last save (its _dirty), so a map changed in place, and saved without being set
# again, stays in RAM until a boot takes it back.
#
# A save can FAIL, as the firmware's can. The fork's persist.be
# writes the new file whole in _persist.tmp, and only when that is closed takes the old
# file away and moves the new one over its place. So a save that fails (the heap runs out,
# the file system is full, the open is refused) removes the temp file, raises what it
# caught and leaves the file as it was, the last whole one. The map in memory is whole and
# still dirty, the next save that works writes it all back, and a boot in between reads
# the file that was there. The test says what the NEXT save that writes will do:
#
#   fail_next()       it raises, and the file is as it was
#   lose_next()       the power goes before the new file is moved over the old: the file is as it was, and nothing is
#                     raised or run after
#   lose_next(true)   the power goes after the old file was taken away and before the new one is moved over its place:
#                     the new one is whole in the temp file, and the boot finishes the move (it reads the new map)
#
# and `reboot()` is the boot after it: the map is read as persist.be's load() reads it. A file
# that is no map, or no JSON, leaves an empty one and is put aside (`bad`, as _persist.bad)
# so that the next save does not cover it. test_stub_persist.be holds this to the real
# persist.be, run over a file system that fails.
var m = module("persist")
m.store = {}
m.saves = 0
m.failures = 0
m.written = nil
m.pending = nil
m.bad = nil
m.marked = false
m.plan = nil
m.find = def (key, missing) return m.store.find(key, missing) end
m.setmember = def (key, value) m.store[key] = value m.marked = true end
m.save = def (force)
    import json
    m.saves += 1
    if !(m.marked || force) return end
    var text = json.dump(m.store)
    var plan = m.plan
    m.plan = nil
    if plan == nil
        m.written = text
        m.marked = false
        return
    end
    if plan[0] == "lose"
        if plan[1]
            m.pending = text
            m.written = nil
        end
        return
    end
    # the write fell over: the file is as it was, and the exception goes on to the caller, the dirty flag still up
    m.failures += 1
    raise "io_error", "persist: the write failed"
end
m.fail_next = def () m.plan = ["fail"] end
m.lose_next = def (after) m.plan = ["lose", after == true] end
# a boot: persist.be's load(). A new file left whole in the temp file by a save that was cut off is the file; one
# that is not a map leaves an empty persist, and is kept aside
m.reboot = def ()
    import json
    if m.written == nil && m.pending != nil
        m.written = m.pending
    end
    m.pending = nil
    var v = m.written != nil ? json.load(m.written) : nil
    if isinstance(v, map)
        m.store = v
    else
        m.store = {}
        if m.written != nil
            m.bad = m.written
            m.written = nil
            print("BRY: failed to load _persist.json, kept as _persist.bad")
        end
    end
    m.marked = false
    m.plan = nil
end
m.remove = def (key) m.store.remove(key) m.marked = true end
m.contains = def (key) return m.store.contains(key) end
m.zero = def () m.store = {} m.marked = true end
m.dirty = def () m.marked = true end
return m
