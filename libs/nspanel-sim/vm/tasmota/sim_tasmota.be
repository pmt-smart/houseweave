# sim_tasmota.be -- the Tasmota the panel's Berry runs on, in the simulator.
#
# The panel's files run here as they run on the ESP32, over Tasmota's own
# Berry library: the rules, the timers, the drivers, load() and persist are the
# firmware's (firmware/tasmota/lib/libesp32/berry_tasmota/src/embedded:
# driver_class.be, trigger_class.be, rule_matcher.be, tasmota_class.be,
# persist.be), loaded before this file. What is C there -- the natives
# be_tasmota_lib.c and xdrv_52_3_berry_tasmota.ino give the class, the serial
# port, the zigbee module -- is written below, over the one native of this VM,
# `_host(op, arg)`: the page answers it with the relays, the clock, the
# Nextion's UART and the Zigbee network (vm/src/panel.ts).
#
# At the end, the boot as xdrv_52_7_berry_embedded.ino writes it: `import
# global`, `tasmota = Tasmota()`, `log()` and `load()`, and `import zigbee` where the image has it.
# autoexec.be is loaded by the page at the first loop, as FUNC_LOOP does.

import global
import string
import json

# TasmotaGlobal: the fields of it the Berry side reads (tasmota.global)
class SimTasmotaGlobal
    var maxlog_level
    var deferred_ready
    var fast_loop_enabled
    var devices_present
    def init()
        self.maxlog_level = 4
        self.deferred_ready = 0
        self.fast_loop_enabled = 0
        self.devices_present = 2
    end
end

# Settings: the field of it the Berry side reads (tasmota.settings), Tasmota's
# count of boots, as the boot reads it: 0 on a configuration that is new
class SimTasmotaSettings
    var bootcount
    def init() self.bootcount = int(_host("bootcount")) end
end

# the rule matcher is Tasmota's own (rule_matcher.be), a member of the class as in the firmware
var _sim_rule_matcher = Rule_Matcher

class SimTasmota : Tasmota
    static var Rule_Matcher = _sim_rule_matcher
    var _resp         # what the Berry command being run answered (resp_cmnd)
    var _cmd_name     # its name, as it was registered (resolvecmnd)
    var _rules_busy   # a rule runs: a result inside it is only recorded (callBerryRule)

    # Tasmota's init maps TasmotaGlobal and Settings over their C structs; here
    # there are none, and what the Berry side reads of them is answered
    def init()
        self.global = SimTasmotaGlobal()
        self.settings = SimTasmotaSettings()
        self.wd = ""
        self._debug_present = false
        self._rules_busy = false
    end

    # --- time: the page's clock, which may run faster than the wall's -----------------------

    def millis(delay)
        var now = int(_host("millis"))
        return delay != nil ? now + delay : now
    end
    def micros() return self.millis() * 1000 end
    # TimeReached(): the difference taken in 32 bits, so it holds across the wrap
    def time_reached(t) return self.millis() - t >= 0 end
    def delay(ms) _host("delay", str(ms)) end
    def delay_microseconds(us) end
    def yield() end
    def rtc(key)
        var r = json.load(_host("rtc"))
        return key != nil ? r.find(key) : r
    end
    def rtc_utc() return self.rtc("utc") end
    def strftime(fmt, t) return _host("strftime", json.dump([fmt, t])) end
    def time_dump(t) return json.load(_host("time_dump", str(t))) end

    # --- the device ----------------------------------------------------------------------------

    static def arch() return "esp32" end
    def hostname() return _host("hostname") end
    def locale() return "en-GB" end
    # the free heap is what the device says (SimDevice.heapFreeKb, 128 KB unless a test lowers it), and the
    # largest block the same less what fragmentation takes
    def get_free_heap() return int(_host("heap")) * 1024 end
    static def memory(key)
        var free = int(_host("heap"))
        var m = {"heap_free": free, "heap_max": free > 18 ? free - 18 : 0, "frag": 14, "program": 1850, "program_free": 1216}
        return key != nil ? m.find(key) : m
    end
    static def wifi(key)
        var w = json.load(_host("wifi"))
        return key != nil ? w.find(key) : w
    end
    static def eth(key)
        var e = {"up": false}
        return key != nil ? e.find(key) : e
    end
    def get_option(n)
        var v = _host("option", str(n))
        return v != nil ? int(v) : 0
    end
    def read_sensors() return "{}" end

    # A rule's string operators (xdrv_52_3_berry_tasmota.ino, tasm_apply_str_op), in
    # any case: 1 equals, 2 does not, 3 starts with, 4 ends with, 5 contains, 6
    # does not contain. Anything but two strings is false
    def _apply_str_op(op, a, b)
        if type(a) != "string" || type(b) != "string" return false end
        var x = string.tolower(a)
        var y = string.tolower(b)
        if op == 1 return x == y end
        if op == 2 return x != y end
        if op == 3 return string.find(x, y) == 0 end
        if op == 4 return size(y) <= size(x) && (size(y) == 0 || x[size(x) - size(y) ..] == y) end
        if op == 5 return string.find(x, y) >= 0 end
        if op == 6 return string.find(x, y) < 0 end
        return false
    end

    # the relays: ExecuteCommandPower, as l_setpower calls it
    def get_power(idx)
        var p = json.load(_host("power"))
        if idx == nil return p end
        return (idx >= 0 && idx < size(p)) ? p[idx] : nil
    end
    def set_power(idx, on)
        _host("power_set", str(idx) + "," + (on ? "1" : "0"))
        return on
    end

    # --- the log, MQTT, the web page -----------------------------------------------------------

    def log(msg, level)
        if level == nil level = 2 end
        _host("log", str(level) + " " + str(msg))
    end
    def loglevel(l) return l <= self.global.maxlog_level end
    def publish(topic, payload, retain) _host("publish", json.dump([str(topic), str(payload)])) end
    def publish_result(payload, subtopic)
        _host("publish", json.dump(["stat/nspanel-sim/" + str(subtopic), str(payload)]))
        self._rule(payload)
    end
    def publish_rule(payload) return self._rule(payload) end
    def web_send(s) _host("web_send", str(s)) end
    def web_send_decimal(s) _host("web_send", str(s)) end

    # --- commands --------------------------------------------------------------------------------

    # What tasmota.cmd() runs: the page's commands first -- Tasmota's own, the
    # button driver's, Z2T's -- then the ones Berry registered (add_cmd).
    # Tasmota asks its drivers by their number, Berry's (xdrv_52) before the
    # button and radio drivers (xdrv_96 to 98): no name is in both, so the
    # answers are the same. The result goes through the
    # rules, which is how tasmota.cmd() gets it back (cmd_res).
    def _cmd(line)
        var r = _host("cmd", line)
        if r == nil r = self._berry_cmd(line) end
        # what the command published inside it, as Z2T publishes a ZbInfo (CmndZbInfo): the rules get it before the
        # command's answer, and in this context, so that inside a rule they run none of theirs (callBerryRule)
        var pub = _host("cmd_published")
        if pub != nil
            for p: json.load(pub) self._rule(p) end
        end
        if r != nil self._rule(r) end
    end

    # a Berry command, split as CommandHandler splits one: the name, the index
    # at its end, and the rest of the line
    def _berry_cmd(line)
        var sp = string.find(line, " ")
        var head = sp >= 0 ? line[0 .. sp - 1] : line
        var payload = sp >= 0 ? line[sp + 1 ..] : ""
        var n = size(head)
        while n > 1 && head[n - 1] >= "0" && head[n - 1] <= "9" n -= 1 end
        var name = n < size(head) ? head[0 .. n - 1] : head
        var idx = n < size(head) ? int(head[n ..]) : 1
        self._resp = nil
        self._cmd_name = name
        if !self.exec_cmd(name, idx, payload) return '{"Command":"Unknown"}' end
        return self._resp
    end

    def resolvecmnd(name) self._cmd_name = name end
    def resp_cmnd(s) self._resp = s end
    def resp_cmnd_str(s) self._resp = json.dump({str(self._cmd_name): s}) end
    def resp_cmnd_done() self.resp_cmnd_str("Done") end
    def resp_cmnd_error() self.resp_cmnd_str("Error") end
    def resp_cmnd_failed() self.resp_cmnd_str("Failed") end
    def response_append(s) self._resp = (self._resp != nil ? self._resp : "") + str(s) end

    # a rules process (callBerryRule): run, unless a rule is running already --
    # then only recorded, which is how a command inside a rule gets its result
    def _rule(payload)
        var busy = self._rules_busy
        self._rules_busy = true
        var r = false
        try
            r = self.event("rule", nil, !busy, str(payload))
        except .. as e, m
            print(format("BRY: Exception> '%s' - %s", e, m))
        end
        self._rules_busy = busy
        return r
    end

    # tasm_find_op (xdrv_52_3_berry_tasmota.ino): where the operator of a rule
    # is, the start in the low 16 bits and the end in the high ones, or -1
    def _find_op(c)
        var n = size(c)
        var i = 0
        while i < n
            var ch = c[i]
            var nx = i + 1 < n ? c[i + 1] : ""
            if ch == "=" || ch == "<" || ch == ">"
                return ((nx == "=" ? i + 2 : i + 1) << 16) | i
            elif ch == "!"
                if nx == "="
                    return (((i + 2 < n && c[i + 2] == "=") ? i + 3 : i + 2) << 16) | i
                end
            elif ch == "$"
                if nx == "<" || nx == ">" || nx == "!" || nx == "|" || nx == "^"
                    return ((i + 2) << 16) | i
                end
            elif ch == "|"
                return ((i + 1) << 16) | i
            end
            i += 1
        end
        return -1
    end

    # tasm_match_keys (xdrv_52_3_berry_tasmota.ino): a value walked down a list of key names, each looked up among the keys of a map
    # case insensitively, a key written as the name taking precedence over one in another case; nil when a level is not a map or has
    # no such key. A key that is neither a string nor an integer is never matched
    def _match_keys(val, names)
        import string
        for name: names
            if !isinstance(val, map) || type(name) != "string" return nil end
            var nu = string.toupper(name)
            var hit = nil
            var have = false
            for k: val.keys()
                if type(k) != "string" && type(k) != "int" continue end
                var ks = str(k)
                if string.toupper(ks) == nu
                    if ks == name
                        hit = k
                        have = true
                        break
                    end
                    if !have
                        hit = k
                        have = true
                    end
                end
            end
            if !have return nil end
            val = val[hit]
        end
        return val
    end
end

# The UART (be_serial_lib.c): the Nextion's, on the page. What the panel
# writes goes out as hex, and what the glass sent waits there to be read.
class serial
    static var SERIAL_8N1 = 134217756
    var rx
    var tx
    var baud
    def init(rx, tx, baud, mode)
        self.rx = rx
        self.tx = tx
        self.baud = baud
        _host("uart_open", str(tx) + "," + str(baud))
    end
    def write(b)
        if type(b) == "int" b = bytes().add(b, 1) end
        if type(b) == "string" b = bytes().fromstring(b) end
        _host("uart_write", b.tohex())
        return size(b)
    end
    def available()
        var n = _host("uart_available")
        return n != nil ? int(n) : 0
    end
    def read()
        var h = _host("uart_read")
        return h != nil ? bytes(h) : bytes()
    end
    def flush() end
    def deinit() end
end

# TCP clients (be_tcpclient_lib.c, be_tcpclientasync_lib.c), over the house's
# network (vm/src/house.ts): a device alone has nobody to connect to. An end is
# the page's, by its number. The images have no Berry tcpserver
# (USE_BERRY_TCPSERVER off, with IPv6): nothing here listens.
class tcpclient
    var _n
    def init(n) self._n = n end
    # the synchronous client, which the devices do not use: a connection by it goes nowhere
    def connect(address, port, timeout) return false end
    def connected() return self._n != nil && _host("tcp_state", str(self._n)) == "up" end
    def available() return self._n != nil ? int(_host("tcp_available", str(self._n))) : 0 end
    def read() return self._n != nil ? _host("tcp_read", str(self._n)) : "" end
    def readbytes() return bytes().fromstring(self.read()) end
    def write(b)
        if self._n == nil return 0 end
        return int(_host("tcp_write", json.dump([self._n, isinstance(b, bytes) ? b.asstring() : str(b)])))
    end
    def close()
        if self._n != nil _host("tcp_close", str(self._n)) end
        self._n = nil
    end
    def info() return self._n != nil ? json.load(_host("tcp_info", str(self._n))) : {} end
end

# the bridge's client: connect() starts a connection, and connected() is nil
# while it is being made, true once it is up, false once it is refused or over
class tcpclientasync : tcpclient
    def init() self._n = nil end
    def connect(address, port)
        var n = int(_host("tcp_connect", json.dump([str(address), int(port)])))
        self._n = n != 0 ? n : nil
        return self._n != nil
    end
    def connected()
        if self._n == nil return false end
        var st = _host("tcp_state", str(self._n))
        return st == "up" ? true : st == "connecting" ? nil : false
    end
    def set_nowait(on) end
end

# UDP (be_udp_lib.c), what a panel and its bridge sign over the house's network
# once paired (pair_sign.be): to the devices of the house listening on the port
class udp
    var remote_ip
    var remote_port
    def begin(host, port) return _host("udp_begin", str(port)) == "1" end
    def send(ip, port, b) return _host("udp_send", json.dump([ip, port, b.asstring()])) == "1" end
    def read()
        var h = _host("udp_read")
        if h == nil return nil end
        var p = json.load(h)
        self.remote_ip = p[1]
        self.remote_port = p[2]
        return bytes().fromstring(p[0])
    end
    def close() end
end

# The zigbee module (be_zigbee.c), for what the panel and the bridge ask of it:
# whether Z2T runs, and the devices it knows, each with its addresses, model,
# whether it routes, and its info, what Z2T knows of it (ZbInfo), as a map where
# the firmware gives a zcl_attribute_list
class SimZigbeeDevice
    var longaddr
    var shortaddr
    var name
    var model
    var manufacturer
    var router
    var _info
    def info() return self._info end
end

class SimZigbee
    def started() return _host("zb_started") == "1" end
    def iter()
        var devices = []
        for d: json.load(_host("zb_devices"))
            var z = SimZigbeeDevice()
            z.longaddr = bytes(d["longaddr"])
            z.shortaddr = d["shortaddr"]
            z.name = d.find("name")
            z.model = d.find("model")
            z.manufacturer = d.find("manufacturer")
            z.router = d.find("router") == true
            z._info = d.find("info")
            devices.push(z)
        end
        return devices.iter()
    end
    def size() return size(json.load(_host("zb_devices"))) end
    # a device by its short address ("0x5ADF"), its IEEE or its name, as
    # parseDeviceFromName finds it; nil for none
    def find(key)
        import string
        var k = string.toupper(str(key))
        for d: self.iter()
            var ieee = "0X"
            var i = size(d.longaddr) - 1
            while i >= 0
                ieee += string.format("%02X", d.longaddr[i])
                i -= 1
            end
            if k == string.format("0X%04X", d.shortaddr) || k == ieee || (d.name != nil && str(key) == d.name) return d end
        end
        return nil
    end
end

# --- the boot (xdrv_52_7_berry_embedded.ino) ---------------------------------------------------

tasmota = SimTasmota()
def log(m, l) tasmota.log(m, l) end
def load(f) return tasmota.load(f) end
# only where the image has Z2T (USE_ZIGBEE): the bridge's; the panel's has none
if _host("zb_image") == "1"  global.zigbee = SimZigbee() end

# --- what the page calls: the loop, the rules, the console ------------------------------------

# an exception in an event is printed and the loop goes on, as callBerryEventDispatcher does
def _sim_guard(f)
    try
        f()
    except .. as e, m
        print(format("BRY: Exception> '%s' - %s", e, m))
    end
end

# One turn of Tasmota's loop: the deferred functions and the fast loop
# (FUNC_LOOP), then the periodic events that fell due, as a JSON list
# ("every_50ms", "every_100ms", "every_250ms", "every_second").
def sim_tick(due)
    _sim_guard(/ -> tasmota.run_deferred())
    _sim_guard(/ -> tasmota.fast_loop())
    if size(due) > 0
        for ev: json.load(due)
            _sim_guard(/ -> tasmota.event(ev))
        end
    end
end

# FUNC_LOOP's first turn: the autoexec event, then autoexec.be
def sim_autoexec()
    _sim_guard(/ -> tasmota.event("autoexec"))
    return load("autoexec.be") ? "1" : "0"
end

# a rules process from Tasmota's core: a relay's state, a button, Z2T
def sim_rule(payload) tasmota._rule(payload) end

# a line of the console: the command's answer, as JSON
def sim_cmd(line)
    var r = tasmota.cmd(line)
    return r != nil ? json.dump(r) : nil
end

# a request to the web server: the page's output (webserver.be). Tasmota asks each driver for its pages when its web server starts
# (FUNC_WEB_ADD_HANDLER, the web_add_handler event): here at the first request the page makes of it
var _sim_web_up = false
def sim_web(request)
    import webserver
    if !_sim_web_up
        _sim_web_up = true
        _sim_guard(/ -> tasmota.event("web_add_handler"))
    end
    return webserver._serve(json.load(request))
end
