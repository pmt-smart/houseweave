# Exercises the .tft flash of nextion_driver.be end to end, standalone: a
# scripted display on the serial, a scripted HTTP server behind tcpclient, and a
# clock that only moves when the driver waits or a test lets time pass. Every
# case is a way a real flash can go wrong: the answers split or merged, the rest
# of the Berry writing into the upload, a server that stops or lies about a
# range, a display that goes quiet. The driver must never wait in a loop, must
# give up by its deadlines, and must always end at 115200 with the rest of the
# Berry unmuted.

import string
import json

var nextion = Nextion.start()

# --- a clock ------------------------------------------------------------------------------------
class ClockTasmota
    var now, published
    def init() self.now = 1000 self.published = [] end
    def delay(ms) self.now += ms end
    def yield() end
    def millis(d) return d != nil ? self.now + d : self.now end
    def time_reached(t) return self.now - t >= 0 end
    def loglevel(l) return false end
    def add_driver(d) end
    def add_cmd(name, f) end
    def cmd(c) end
    def publish_result(a, b) self.published.push(a) end
    def set_timer(ms, f) f() end
    def resp_cmnd_done() end
    def resp_cmnd_str(s) end
    # the clock a finished flash is noted by (note_flashed)
    def rtc() return {"local": self.now, "utc": self.now} end
    def strftime(f, t) return f end
end
tasmota = ClockTasmota()

# --- the display's side of the wire -------------------------------------------------------------
var WIRE = []      # [baud, bytes] for every write, whichever serial made it
var RX = []        # what the display "sent", one entry per read the driver does
class serial
    static SERIAL_8N1 = 0
    var baud
    def init(rx, tx, baud, cfg) self.baud = baud end
    def available() return size(RX) > 0 ? size(RX[0]) : 0 end
    def read() if size(RX) == 0 return bytes() end var c = RX[0] RX.remove(0) return c end
    def write(b) WIRE.push([self.baud, b.copy()]) end
    def flush() end
    def deinit() end
end
def written(from)
    var out = []
    for i: from .. size(WIRE) - 1 out.push(WIRE[i]) end
    return out
end
def text_of(w) return w[1].asstring() end

# --- the server -------------------------------------------------------------------------------
var SERVER = []    # one script per connection: {"chunks": [bytes], "stall": bool}
var REQUESTS = []
class FakeTcp
    var chunks, stall, closed
    def init()
        var s = size(SERVER) > 0 ? SERVER[0] : {"chunks": [], "stall": false}
        if size(SERVER) > 0 SERVER.remove(0) end
        self.chunks = s["chunks"]
        self.stall = s.find("stall", false)
        self.closed = false
    end
    def connect(h, p) return true end
    # a stalled server keeps the connection and sends nothing more
    def connected() return !self.closed && (size(self.chunks) > 0 || self.stall) end
    def available() return size(self.chunks) > 0 ? size(self.chunks[0]) : 0 end
    def readbytes(n)
        if size(self.chunks) == 0 return bytes() end
        var c = self.chunks[0]
        if n != nil && size(c) > n
            self.chunks[0] = c[n ..]
            return c[0 .. n - 1]
        end
        self.chunks.remove(0)
        return c
    end
    def write(s) REQUESTS.push(s) end
    def close() self.closed = true end
end
def tcpclient() return FakeTcp() end

# --- a file the preflight takes ----------------------------------------------------------------
var SEED = 0x1CE47603
def tft(n)
    var b = bytes()
    b.resize(n)
    b.set(0x03, 0x4E, 1)
    b.set(0x14, 3, 1)
    b.set(0x2E, SEED, 4)
    b.set(0x33, 0xFF, 1)
    b.set(0x3C, n, 4)
    for i: 0x48 .. n - 1 b[i] = i & 0xFF end
    return b
end
def http(code, body, extra)
    var reason = code == 200 ? "OK" : code == 206 ? "Partial Content" : "Not Found"
    var h = string.format("HTTP/1.1 %d %s\r\n", code, reason) + (extra != nil ? extra : "") + "\r\n"
    return bytes().fromstring(h) + body
end
def chunks_of(b, n)
    var out = []
    var i = 0
    while i < size(b)
        var e = i + n < size(b) ? i + n : size(b)
        out.push(b[i .. e - 1])
        i = e
    end
    return out
end
var COMOK = bytes().fromstring("comok 2,37671-0,NX4832F035_011C,99,61489,E46720857602B29,16777216") + bytes("FFFFFF")

# a fresh driver state for each case
def reset()
    WIRE.clear()
    RX.clear()
    SERVER.clear()
    REQUESTS.clear()
    nextion.ser = serial(17, 16, 115200, 0)
    nextion.flash_mode = 0
    nextion.flash_phase = nil
    nextion.tcp = nil
    nextion.reparse = false
    nextion.strict_preflight = true
    nextion.device_model = nil
    nextion.flash_proto_version = 1
    nextion.flash_proto_baud = 921600
end
# the driver's ticks, with time passing between them as on the device
def ticks(n)
    for i: 1 .. n
        tasmota.now += 50
        nextion.every_50ms()
    end
end
def blocks_written(from)
    var n = 0
    for w: written(from) if w[0] == 921600 n += size(w[1]) end end
    return n
end

var N = 10000      # two full blocks and a short one

# --- 1. a whole flash: the offset and its 4 bytes in one read, then an ack per block ----------
reset()
var file = tft(N)
SERVER.push({"chunks": chunks_of(http(200, file, "Content-Length: " + str(N) + "\r\n"), 3000)})
assert(nextion.flash_nextion("http://192.168.0.2:8000/p1.tft") == true)
assert(nextion.flash_mode == 1 && nextion.flash_phase == "handshake")
var hs = written(0)
assert(size(hs) == 4 && text_of(hs[0]) == "DRAKJHSUYDGBNCJHGJKSHBDN\xFF\xFF\xFF" && string.find(text_of(hs[3]), "connect") == 0, "the handshake")
RX.push(COMOK)
ticks(1)
assert(nextion.flash_phase == "upload" && nextion.ser.baud == 921600, "whmi-wris sent and the rate switched")
assert(string.find(text_of(WIRE[4]), "whmi-wris 10000,921600,res0") == 0 && WIRE[4][0] == 115200, "whmi-wris went out at 115200")
var mark = size(WIRE)
RX.push(bytes("0800000000"))
ticks(1)
assert(blocks_written(mark) == 4096, "the first block after the offset")
# the Berry writes while the upload runs: nothing of it may reach the display
nextion.sendnx("screensaver.tTime0.txt=\"20:46\"")
nextion.write_to_nextion(bytes("414243"))
nextion.send("time~20:46")
assert(blocks_written(mark) == 4096 && size(written(mark)) == 1, "nothing but the file during the upload")
RX.push(bytes("05"))
ticks(1)
RX.push(bytes("05"))
ticks(1)
assert(blocks_written(mark) == N, "the whole file, the last block short")
assert(nextion.flash_mode == 0 && nextion.ser.baud == 115200, "done, and back at 115200")
var sent = bytes()
for w: written(mark) sent += w[1] end
assert(sent == file, "the display got the file byte for byte")
nextion.sendnx("page 0")
assert(text_of(WIRE[-1]) == "page 0\xFF\xFF\xFF", "the Berry speaks again")

# --- 2. a second FlashNextion while one runs is refused, and writes nothing ---------------------
reset()
SERVER.push({"chunks": [http(200, tft(N), "Content-Length: " + str(N) + "\r\n")]})
assert(nextion.flash_nextion("http://192.168.0.2:8000/p1.tft") == true)
mark = size(WIRE)
assert(nextion.flash_nextion("http://192.168.0.2:8000/other.tft") == false)
assert(size(WIRE) == mark && nextion.flash_mode == 1, "the running flash is left alone")
tasmota.now += 6000
ticks(1)
assert(nextion.flash_mode == 0, "the handshake gave up")

# --- 3. the display never answers the handshake -----------------------------------------------
reset()
SERVER.push({"chunks": [http(200, tft(N), "Content-Length: " + str(N) + "\r\n")]})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
ticks(99)
assert(nextion.flash_mode == 1, "5 s are given")
ticks(2)
assert(nextion.flash_mode == 0 && nextion.ser.baud == 115200 && nextion.tcp == nil, "given up, the stream closed")

# --- 4. the server stalls mid-file: the loop never waits, and the deadline stops it -----------
reset()
file = tft(N)
var head = http(200, file[0 .. 5999], "Content-Length: " + str(N) + "\r\n")
SERVER.push({"chunks": [head], "stall": true})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
RX.push(COMOK)
ticks(1)
RX.push(bytes("0800000000"))
ticks(1)
RX.push(bytes("05"))
var before = tasmota.now
ticks(1)
assert(tasmota.now - before == 50, "a tick waits for nothing")
assert(nextion.block_pending == true && nextion.flash_mode == 1, "the block waits for the server")
ticks(600)
assert(nextion.flash_mode == 0 && nextion.ser.baud == 115200, "the stalled server stopped the flash at its deadline")

# --- 5. the server closes the stream early ---------------------------------------------------
reset()
file = tft(N)
SERVER.push({"chunks": [http(200, file[0 .. 5999], "Content-Length: " + str(N) + "\r\n")]})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
RX.push(COMOK)
ticks(1)
RX.push(bytes("08"))
ticks(1)
RX.push(bytes("00000000"))
ticks(1)
assert(nextion.flash_written == 4096, "the offset split 1 + 4 is still an offset")
RX.push(bytes("05"))
ticks(2)
assert(nextion.flash_mode == 0, "a stream that ends before the file does stops the flash")

# --- 6. an offset: the rest from there, over a range the server answers exactly -------------
reset()
file = tft(N)
SERVER.push({"chunks": [http(200, file[0 .. 999], "Content-Length: " + str(N) + "\r\n")], "stall": true})
SERVER.push({"chunks": [http(206, file[8192 ..], "Content-Range: bytes 8192-9999/10000\r\nContent-Length: 1808\r\n")]})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
RX.push(COMOK)
ticks(1)
mark = size(WIRE)
RX.push(bytes("08"))
ticks(1)
RX.push(bytes("00200000"))
ticks(1)
assert(string.find(REQUESTS[-1], "Range: bytes=8192-") >= 0, "the second GET asks from the offset")
assert(nextion.flash_mode == 0 && blocks_written(mark) == N - 8192, "the tail, and done")
sent = bytes()
for w: written(mark) if w[0] == 921600 sent += w[1] end end
assert(sent == file[8192 ..], "the tail is the file's own")

# --- 7. a server that answers a range with the whole file: stopped, nothing written there -----
reset()
file = tft(N)
SERVER.push({"chunks": [http(200, file[0 .. 999], "Content-Length: " + str(N) + "\r\n")], "stall": true})
SERVER.push({"chunks": [http(200, file, "Content-Length: " + str(N) + "\r\n")]})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
RX.push(COMOK)
ticks(1)
mark = size(WIRE)
RX.push(bytes("0800200000"))
ticks(1)
assert(nextion.flash_mode == 0 && blocks_written(mark) == 0, "a 200 to a range is not the file from there")

# --- 8. the display goes quiet after a block -------------------------------------------------
reset()
SERVER.push({"chunks": [http(200, tft(N), "Content-Length: " + str(N) + "\r\n")]})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
RX.push(COMOK)
ticks(1)
RX.push(bytes("0800000000"))
ticks(1)
assert(nextion.flash_written == 4096)
ticks(199)
assert(nextion.flash_mode == 1, "10 s for the next ack")
ticks(2)
assert(nextion.flash_mode == 0 && nextion.ser.baud == 115200, "a display that stops asking stops the flash")

# --- 9. answers that cannot start a flash ---------------------------------------------------
reset()
assert(nextion.flash_nextion("http://192.168.0.2:8000/p1.tft") == false && nextion.flash_mode == 0, "no answer")
reset()
SERVER.push({"chunks": [http(404, bytes(), "")]})
assert(nextion.flash_nextion("http://192.168.0.2:8000/p1.tft") == false && nextion.flash_mode == 0, "404")
reset()
SERVER.push({"chunks": [http(200, tft(N), "")]})
assert(nextion.flash_nextion("http://192.168.0.2:8000/p1.tft") == false && nextion.flash_mode == 0, "no Content-Length")
reset()
SERVER.push({"chunks": [bytes().fromstring("HTTP/1.1 200 OK\r\ncontent-length: 10000\r\n\r\n") + tft(N)]})
assert(nextion.flash_nextion("http://192.168.0.2:8000/p1.tft") == true, "the header name in any case")
assert(nextion.flash_size == N)
nextion.end_flash()

# --- 10. the preflight refuses a file for another model, and the display was asked nothing ----
reset()
SEED = 0xDEADBEEF
SERVER.push({"chunks": [http(200, tft(N), "Content-Length: " + str(N) + "\r\n")]})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
mark = size(WIRE)
RX.push(COMOK)
ticks(1)
assert(nextion.flash_mode == 0 && size(written(mark)) == 0 && nextion.ser.baud == 115200, "refused before whmi-wris")
SEED = 0x1CE47603

# --- 11. from a file of the filesystem: the same flow, the file as the stream --
reset()
var tft_path = TEST_TMP + "/p1-image.tft"
var whole = tft(N)
var fw = open(tft_path, "wb")
fw.write(whole)
fw.close()
var ended = []
assert(nextion.flash_file(tft_path, / ok -> ended.push(ok)) == true, "a flash from the file starts")
assert(nextion.flash_size == N && nextion.flash_phase == "handshake", "its size is the file's")
RX.push(COMOK)
ticks(1)
assert(nextion.flash_phase == "upload", "the preflight took the file's header")
mark = size(WIRE)
RX.push(bytes("0800000000"))
ticks(1)
RX.push(bytes("05"))
ticks(1)
RX.push(bytes("05"))
ticks(1)
assert(blocks_written(mark) == N, "the whole file")
sent = bytes()
for w: written(mark) sent += w[1] end
assert(sent == whole, "the display got the file byte for byte")
assert(nextion.file == nil && nextion.flash_mode == 0 && nextion.ser.baud == 115200, "the file closed, and done")
assert(size(ended) == 1 && ended[0] == true, "and the caller is told it went through, once")

# a display that never answers: the caller is told it stopped
reset()
ended = []
nextion.flash_file(tft_path, / ok -> ended.push(ok))
tasmota.now += 60000
ticks(1)
assert(nextion.flash_mode == 0 && size(ended) == 1 && ended[0] == false, "a flash that stops tells the caller so")

# the display holds the start: the file goes on from its offset
reset()
nextion.flash_file(tft_path)
RX.push(COMOK)
ticks(1)
mark = size(WIRE)
RX.push(bytes("0800100000"))
ticks(1)
RX.push(bytes("05"))
ticks(1)
assert(blocks_written(mark) == N - 4096, "from byte 4096 on")
sent = bytes()
for w: written(mark) sent += w[1] end
assert(sent == whole[4096 ..], "the bytes after the offset")
assert(nextion.flash_mode == 0, "done")

# --- 12. the file packed, as the image and a release carry it: the display gets the .tft --
# The same file, packed by libs/nspanel-sim/export/src/tftPack.ts (berry/test/vectors/tft_pack.json)
import json
var vf = open(TEST_ROOT + "/berry/test/vectors/tft_pack.json")
var vectors = json.load(vf.read())
vf.close()
var packed = nil
for c: vectors["cases"]
    if c["size"] == N && string.find(c["name"], "flash test") >= 0  packed = bytes(c["packed"]) end
end
assert(packed != nil && size(packed) < N / 4, "the vectors carry this test's file, packed")
var packed_path = TEST_TMP + "/p1-packed.tft"
fw = open(packed_path, "wb")
fw.write(packed)
fw.close()
reset()
ended = []
assert(nextion.flash_file(packed_path, / ok -> ended.push(ok)) == true, "a flash from the packed file starts")
assert(nextion.flash_size == N, "its size is the .tft's, not the packed file's")
RX.push(COMOK)
ticks(1)
assert(nextion.flash_phase == "upload", "the preflight took the .tft's header out of it")
mark = size(WIRE)
RX.push(bytes("0800000000"))
ticks(1)
RX.push(bytes("05"))
ticks(1)
RX.push(bytes("05"))
ticks(1)
sent = bytes()
for w: written(mark) sent += w[1] end
assert(sent == whole, "the display got the .tft byte for byte")
assert(nextion.file == nil && nextion.flash_mode == 0 && size(ended) == 1 && ended[0] == true, "closed, done, and told")

# the display holds the start: the packed file goes on from that byte of the .tft
reset()
nextion.flash_file(packed_path)
RX.push(COMOK)
ticks(1)
mark = size(WIRE)
RX.push(bytes("0800100000"))
ticks(1)
RX.push(bytes("05"))
ticks(1)
sent = bytes()
for w: written(mark) sent += w[1] end
assert(sent == whole[4096 ..], "from byte 4096 of the .tft on")
assert(nextion.flash_mode == 0, "done")

# a packed file cut short, as a download stopped: nothing starts
fw = open(TEST_TMP + "/p1-cut.tft", "wb")
fw.write(packed[0 .. size(packed) - 10])
fw.close()
reset()
assert(nextion.flash_file(TEST_TMP + "/p1-cut.tft") == false && nextion.flash_mode == 0, "a packed file that is not whole starts nothing")

# a packed file from a server would be written to the display as it is: refused, whatever strict_preflight says
reset()
nextion.strict_preflight = false
SERVER.push({"chunks": [http(200, packed, "Content-Length: " + str(size(packed)) + "\r\n")]})
nextion.flash_nextion("http://192.168.0.2:8000/p1.tft")
mark = size(WIRE)
RX.push(COMOK)
ticks(1)
assert(nextion.flash_mode == 0 && size(written(mark)) == 0, "a packed file over HTTP is refused before whmi-wris")

# a file that is not there starts nothing
reset()
assert(nextion.flash_file(TEST_TMP + "/none.tft") == false && nextion.flash_mode == 0, "no file, no flash")

# the note of a flash that finished, whose save falls over: a line in the log and not an exception out of the end of the flash
import persist
persist.failures = 0
persist.fail_next()
nextion.note_flashed()
assert(persist.failures == 1 && persist.find("panel_tft_flashed") != nil, "a note whose save fails raises nothing, and is in memory for the next save")
nextion.note_flashed()
assert(persist.failures == 1 && json.load(persist.written).contains("panel_tft_flashed"), "and the next one writes it")

print("test_nextion_flash: all assertions passed")
