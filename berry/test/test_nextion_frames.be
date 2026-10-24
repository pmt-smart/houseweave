# What the display sends, read as a stream (nextion_driver.be take_frames): a
# read every 100 ms can end anywhere, and the halves must come out as the frame
# they were, never as two wrong ones. A scripted serial hands the driver one
# chunk per read, and a clock only moves when the test says so.

import string

var nextion = Nextion.start()

class FrameTasmota
    var now, cmds
    def init() self.now = 1000 self.cmds = [] end
    def millis(d) return d != nil ? self.now + d : self.now end
    def time_reached(t) return self.now - t >= 0 end
    def loglevel(l) return false end
    def cmd(c) self.cmds.push(c) end
    def delay(ms) end
    def yield() end
    def add_driver(d) end
    def add_cmd(n, f) end
    def publish_result(a, b) end
    def set_timer(ms, f) end
    def resp_cmnd_done() end
    def resp_cmnd_str(s) end
end
tasmota = FrameTasmota()

var READS = []
var WRITES = []
class ReadSerial
    def available() return size(READS) > 0 ? size(READS[0]) : 0 end
    def read() if size(READS) == 0 return bytes() end var c = READS[0] READS.remove(0) return c end
    def write(b) WRITES.push(b) end
    def flush() end
    def deinit() end
end

var events = []
nextion.ser = ReadSerial()
nextion.reparse = false
nextion.flash_mode = 0
nextion.rx_buf = bytes()
nextion.on_event = def (kind, payload) events.push([kind, payload]) end

# a frame as our pages and joBr99's send it: 55 BB, length, payload, CRC-16/MODBUS
def frame(payload)
    var b = bytes('55BB')
    b.add(size(payload), 2)
    b += bytes().fromstring(payload)
    b.add(nextion.crc16(b), 2)
    return b
end
def read(b) READS.push(b) nextion.every_50ms() end

var n = 0
def check(what, got, want)
    n += 1
    if got != want
        print("FAIL " + what + ": got " + str(got) + ", want " + str(want))
        raise "assert_failed", what
    end
end

# --- a frame split before its CRC: one event, the whole payload -----------------------
var f = frame("ev,lightdetail,h1,change,100")
read(f[0 .. size(f) - 3])
check("half a frame is not an event", size(events), 0)
read(f[size(f) - 2 ..])
check("the rest makes it the frame it was", events, [["customrecv", "ev,lightdetail,h1,change,100"]])

# --- split anywhere, even inside the length ----------------------------------------------
events.clear()
f = frame("ev,editboard,kbOK,text,Living Room")
read(f[0 .. 2])
read(f[3 .. 20])
read(f[21 ..])
check("three pieces, one frame", events, [["customrecv", "ev,editboard,kbOK,text,Living Room"]])

# --- two frames and a native reply in one read ------------------------------------------
events.clear()
read(frame("ev,home,page,show") + bytes('1AFFFFFF') + frame("ev,home,mTitle0,tap"))
check("each message on its own, in order", events,
      [["customrecv", "ev,home,page,show"], ["nextion", "bytes('1A')"], ["customrecv", "ev,home,mTitle0,tap"]])

# --- the ready message, split, and behind a refusal ------------------------------------
events.clear()
read(bytes('000000FFFF'))
read(bytes('FF88FFFFFF'))
check("a ready split in two is still the ready", events, [["ready", ""]])
events.clear()
read(bytes('1AFFFFFF000000FFFFFF88FFFFFF'))
check("a ready behind a refusal is still the ready", events, [["nextion", "bytes('1A')"], ["ready", ""]])

# --- joBr99's buzzer, a lone 07 ------------------------------------------------------------
tasmota.cmds.clear()
read(bytes('07'))
check("a lone 07 rings the buzzer", tasmota.cmds, ["buzzer 1,1"])

# --- a piece that never ends is let go, and the next frame is read right ---------------
events.clear()
read(bytes('55BB1400657632'))
tasmota.now += 1200
read(frame("ev,home,page,show"))
check("the stale piece is dropped, the frame after it read", events[-1], ["customrecv", "ev,home,page,show"])

# --- noise before a frame, and a header announcing too much -----------------------------
events.clear()
read(bytes('0102') + frame("ev,zone,mRow2,tap"))
check("bytes before a frame are not part of it", events, [["customrecv", "ev,zone,mRow2,tap"]])
events.clear()
read(bytes('55BBFFFF') + frame("ev,zone,mRow3,tap"))
check("a header that announces 65535 bytes is noise", events, [["customrecv", "ev,zone,mRow3,tap"]])

# --- a CRC that does not match is logged, and the frame taken ---------------------------
events.clear()
f = frame("ev,lock,pad1,change,1236")
f[size(f) - 1] = f[size(f) - 1] ^ 0xFF
read(f)
check("taken until a panel shows the glass's CRCs are right", events, [["customrecv", "ev,lock,pad1,change,1236"]])

# --- a boot that heard no ready takes the display back to its page 0 -------------------
# (the ESP32 restarted alone, and the display kept running: no ready comes)
nextion.seen_ready = false
events.clear()
WRITES.clear()
nextion.assume_ready()
check("no ready heard: the display is taken out of Protocol Reparse", size(WRITES) == 3 && WRITES[0] == nextion.encodenx("DRAKJHSUYDGBNCJHGJKSHBDN") && WRITES[1] == nextion.encodenx("recmod=0"), true)
check("and sent to its page 0", WRITES[-1] == nextion.encodenx("page 0"), true)
check("and whoever draws is told it is up", events, [["ready", ""]])
events.clear()
nextion.assume_ready()
check("only once", events, [])
nextion.seen_ready = false
read(bytes('000000FFFFFF88FFFFFF'))
events.clear()
WRITES.clear()
nextion.assume_ready()
check("after the display's own ready, nothing is sent", size(WRITES), 0)
check("nor drawn again", events, [])
nextion.seen_ready = false
nextion.flash_mode = 1
nextion.assume_ready()
check("a flash is not interrupted by it", [size(WRITES), size(events)], [0, 0])
nextion.flash_mode = 0

print("test_nextion_frames: " + str(n) + " checks passed")
