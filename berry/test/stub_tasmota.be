# Minimal stand-ins for the pieces nextion_driver.be expects from the
# Tasmota Berry runtime (the `tasmota` module, the `Driver` base class,
# `serial`/`tcpclient`, and `log()`) so it can be exercised by the
# standalone `berry` interpreter that ships vendored in
# firmware/tasmota/lib/libesp32/berry/berry.exe — real Berry, not a
# reimplementation, just missing the native bindings that only exist
# inside the compiled firmware.
#
# `load()` and `global` are themselves Tasmota-native additions, not
# part of standalone Berry (confirmed empirically: both are
# 'undeclared' in the vendored berry.exe run alone) — see run.mjs for
# how the driver file is brought in without them.

def log(msg, level)
    import string
    if level == nil level = 0 end
    print(string.format("[log L%d] %s", level, msg))
end

# Tasmota's timers as tasmota_class.be keeps them, for a stub whose tests care about the ids: a LIST of timers in the
# order they were set, each [due, f, id], which set_timer pushes onto and nothing replaces. A second set_timer with an id a
# timer already has STACKS a second one (both fire), and remove_timer(id) takes out EVERY timer of the id, as the
# firmware's does (set_timer, remove_timer and run_timers there). A stub that kept the timers in a map by id
# (timers[id] = f) replaced the first with the second and hid the defect of any code that sets a timer again without
# removing the one before it.
#
# What a test asks of it, by the id:
#   contains(id), count(id)   whether one is pending, and how many
#   find(id), delay_of(id)    the OLDEST pending one's function, and the delay it was set with
#   fire(id)                  runs the oldest pending one, gone first as run_timers has it: false when none
#   fire_all(id)              runs those pending now, oldest first
#   remove(id)                what remove_timer(id) does; how many went
#   timers[id]                the oldest pending one, as a function that fires it (and raises when none is there)
#   advance(ms), run_due()    the clock moved on and the timers whose time came run, as run_timers does
#   run_all()                 every timer pending now, whatever its time, oldest first
class TimerBook
    var items, clock, seq
    def init(clock) self.items = [] self.clock = clock self.seq = 0 end
    # tasmota.set_timer(delay, f, id); the last of an entry is its own number, which says which one it is
    def push(delay, f, id)
        self.seq += 1
        self.items.push([self.clock.millis(delay), f, id, self.seq])
    end
    # tasmota.remove_timer(id): every timer of the id
    def remove(id)
        var n = 0
        var i = 0
        while i < size(self.items)
            if self.items[i][2] == id  self.items.remove(i) n += 1 else i += 1 end
        end
        return n
    end
    def clear() self.items = [] end
    def size() return size(self.items) end
    def count(id)
        var n = 0
        for t: self.items
            if t[2] == id  n += 1 end
        end
        return n
    end
    def contains(id) return self.count(id) > 0 end
    # the ids pending, each once, in the order they were first set
    def keys()
        var out = []
        for t: self.items
            if out.find(t[2]) == nil  out.push(t[2]) end
        end
        return out
    end
    def at_of(id)
        for i: 0 .. size(self.items) - 1
            if self.items[i][2] == id  return i end
        end
        return nil
    end
    def find(id)
        var i = self.at_of(id)
        return i != nil ? self.items[i][1] : nil
    end
    def delay_of(id)
        var i = self.at_of(id)
        return i != nil ? self.items[i][0] - self.clock.millis() : nil
    end
    def fire(id)
        var i = self.at_of(id)
        if i == nil  return false end
        var f = self.items[i][1]
        self.items.remove(i)
        f()
        return true
    end
    def fire_all(id)
        var n = self.count(id)
        while n > 0 && self.fire(id)  n -= 1 end
    end
    def item(id)
        var book = self
        return def ()
            if !book.fire(id)  raise "timer_error", "no timer pending for " + str(id) end
        end
    end
    # run_timers: those whose time came, in the order they were set, one shot; the ones set meanwhile too, if theirs came
    def run_due()
        var i = 0
        while i < size(self.items)
            var t = self.items[i]
            if self.clock.time_reached(t[0])
                self.items.remove(i)
                t[1]()
            else
                i += 1
            end
        end
    end
    def advance(ms)
        self.clock.at_ms = self.clock.millis() + ms
        self.run_due()
    end
    # every timer pending now, whatever its time, in the order they were set: those set while they run wait for the next
    # call, and one a callback removes does not run
    def run_all()
        var now = self.items.copy()
        for t: now
            var i = 0
            while i < size(self.items) && self.items[i][3] != t[3]  i += 1 end
            if i < size(self.items)
                self.items.remove(i)
                t[1]()
            end
        end
    end
end

class TasmotaStub
    def delay(ms) end
    def yield() end
    # the clock stands at 0 unless a test moves it (at_ms): millis(d) is a
    # deadline d ms ahead, reached when the clock gets there
    var at_ms
    def millis(d) var t = self.at_ms != nil ? self.at_ms : 0 return d != nil ? t + d : t end
    def time_reached(t) return (self.at_ms != nil ? self.at_ms : 0) - t >= 0 end
    def loglevel(l) return false end
    # 15.6.0, as the firmware's native says it
    def version() return 0x0F060000 end
    # the device's name on the network, as a fresh panel has it
    def hostname() return "nspanel-living" end
    # its Wi-Fi, as a panel fresh from its box has it: no network unless a test says so (wifi_up), and its radio address
    var wifi_up
    def wifi() return {"up": self.wifi_up == true, "mac": "A0:B7:65:5D:02:E9"} end
    def resp_cmnd_str(s) end
    # no relays unless a test gives some
    def get_power() return [] end
    # autoexec.be's heap floor: plenty, unless a test says otherwise
    var heap_free_kb
    def memory() return {"heap_free": self.heap_free_kb != nil ? self.heap_free_kb : 128} end
    # Tasmota's own: a collection, and what is left after it
    def gc() import gc gc.collect() return gc.allocated() end
    def add_driver(d) end
    def add_cmd(name, f) end
    def cmd(c) end
    def publish_result(a, b) end
    # timers run nowhere, unless a test gives them a place to land in (`timers`), and runs them itself: a list, [ms, f, id]
    # each, or a TimerBook. Either way they stack, and remove_timer(id) takes out every one of the id, as Tasmota's does
    var timers
    def set_timer(ms, f, id)
        self.check_not_method(f)
        if self.timers == nil  return end
        if isinstance(self.timers, list)  self.timers.push([ms, f, id]) else self.timers.push(ms, f, id) end
    end
    # what tasmota_class.be asks of a function it is given to run later: a closure, and no bound method
    def check_not_method(f)
        import introspect
        if type(f) != "function"  raise "type_error", "BRY: argument must be a function" end
        if introspect.ismethod(f) == true
            raise "type_error", "BRY: method not allowed, use a closure like '/ args -> obj.func(args)'"
        end
    end
    def remove_timer(id)
        var t = self.timers
        if t == nil  return end
        if !isinstance(t, list)  t.remove(id) return end
        var i = 0
        while i < size(t)
            if size(t[i]) > 2 && t[i][2] == id  t.remove(i) else i += 1 end
        end
    end
    # tasmota.defer (tasmota_class.be): run at the next turn of the loop, out of the rule or the command that defers. A test
    # turns the loop itself (run_deferred), which runs only those present at first, as Tasmota's does
    var deferred
    def defer(f)
        self.check_not_method(f)
        if self.deferred == nil  self.deferred = [] end
        self.deferred.push(f)
    end
    def run_deferred()
        if self.deferred == nil  return end
        var n = size(self.deferred)
        while n > 0
            var f = self.deferred[0]
            self.deferred.remove(0)
            n -= 1
            f()
        end
    end
    def resp_cmnd_done() end
    def resp_cmnd_failed() end
    # autoexec.be wires the boot-time bulb ping through these two
    def when_network_up(f) end
    def add_rule(trigger, f) end
    def resp_cmnd(s) end
    # the clock the screensaver shows (brain.be update_clock)
    # at 0 until a test gives the network's time
    var utc_now
    def rtc() var u = self.utc_now != nil ? self.utc_now : 0  return {"local": u, "utc": u} end
    def strftime(fmt, t) return fmt end
end
tasmota = TasmotaStub()

class Driver
end

class serial
    static SERIAL_8N1 = 0
    def init(rx, tx, baud, cfg) end
    def available() return 0 end
    def read() return bytes() end
    def write(b) end
    def deinit() end
end

class TcpStub
    def connect(h, p) end
    def connected() return false end
    def available() return 0 end
    def readbytes(n) return bytes() end
    def write(s) end
    def close() end
end
def tcpclient()
    return TcpStub()
end

# `global` is Tasmota's shared cross-file table
# — a native addition, not standalone Berry. Reproduced with
# member()/setmember() so `global.touch_rx_ms = ...` in the driver
# (unrelated to what this test exercises) resolves instead of failing
# to compile.
class GlobalStub
    var store
    def init() self.store = {} end
    def member(k) return self.store.find(k) end
    def setmember(k, v) self.store[k] = v end
end
global = GlobalStub()
