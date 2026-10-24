# Exercises Nextion.parse_comok()/preflight_ok() (nextion_driver.be)
# against synthetic .tft headers, standalone — no Tasmota firmware, no
# panel. Run via run.mjs, which concatenates stub_tasmota.be + the real
# ../nextion_driver.be + this file and feeds it to the vendored
# standalone `berry` interpreter (see run.mjs for why it can't just
# `load()` the driver the way autoexec.be does on-device).
#
# `nextion` is the driver instance, started as autoexec.be starts it
# (Nextion.start()).

var nextion = Nextion.start()

def make_header(seed, flag, declared_size, vendor)
    var b = bytes()
    b.resize(0x48)
    b.set(0x03, vendor, 1)
    b.set(0x14, 3, 1)
    b.set(0x2E, seed, 4)
    b.set(0x33, flag, 1)
    b.set(0x3C, declared_size, 4)
    return b
end

var GOOD_SEED = 0x1CE47603
var GOOD_FLAG = 0xFF

nextion.parse_comok("comok 2,37671-0,NX4832F035_011C,99,61489,E46720857602B29,16777216")
assert(nextion.device_model == "NX4832F035_011C")
assert(nextion.device_touch == "2")
assert(nextion.device_fw == "37671-0")
assert(nextion.device_flash == "16777216")

nextion.flash_size = 999999
nextion.strict_preflight = true

nextion.flash_buff = make_header(GOOD_SEED, GOOD_FLAG, 999999, 0x4E)
assert(nextion.preflight_ok() == true)

nextion.flash_buff = make_header(0xDEADBEEF, GOOD_FLAG, 999999, 0x4E)
assert(nextion.preflight_ok() == false)

# 0x33 mismatch is a warning, not a block (its meaning is unconfirmed —
# a `_011` compile has been seen loading on a `_011C` Intelligent panel).
# Must still pass.
nextion.flash_buff = make_header(GOOD_SEED, 0x00, 999999, 0x4E)
assert(nextion.preflight_ok() == true)

nextion.flash_buff = make_header(GOOD_SEED, GOOD_FLAG, 123, 0x4E)
assert(nextion.preflight_ok() == false)

nextion.flash_buff = make_header(GOOD_SEED, GOOD_FLAG, 999999, 0x00)
assert(nextion.preflight_ok() == false)

nextion.strict_preflight = false
nextion.flash_buff = make_header(0xDEADBEEF, 0x00, 999999, 0x4E)
assert(nextion.preflight_ok() == true)

# --- Protocol Reparse: joBr99's TFT reads the ESP32 in it, our pages cannot ---
# In recmod=1 the Nextion holds what arrives as data (measured in the Editor's
# debugger), so the driver enters it only for a TFT that parses it
# itself, and a generated project turns that off (autoexec.be).
class CaptureSerial
    var sent
    def init() self.sent = [] end
    def write(b) self.sent.push(b.asstring()) end
    def available() return 0 end
    def flush() end
    def deinit() end
end
import string
def sent_as(wire, i, text) return size(wire.sent) > i && string.find(wire.sent[i], text) == 0 end

var wire = CaptureSerial()
nextion.ser = wire
assert(nextion.reparse == true)
nextion.screeninit()
assert(size(wire.sent) == 1 && sent_as(wire, 0, "recmod=1"))

wire.sent = []
nextion.reparse = false
nextion.screeninit()
assert(size(wire.sent) == 0)
nextion.ser = wire
nextion.abort_flash()
assert(size(wire.sent) == 0)

# --- The flash handshake on a display outside Protocol Reparse ---
# begin_nextion_flash sends the string that leaves the mode, in case the display
# is in it. One that is not refuses it as a variable, 1A FF FF FF (measured in
# the Editor's debugger), and the refusal lands in the same read as
# the comok that follows: the comok is still found behind it. So is a comok
# behind anything with a NUL in it, a refusal as 00 FF FF FF or a 55 BB frame
# whose length's high byte is 0: the flash reads the answer as bytes.
class OneRead
    var data, sent
    def init(data) self.data = data self.sent = [] end
    def available() return size(self.data) end
    def read() var d = self.data self.data = bytes() return d end
    def write(b) self.sent.push(b.asstring()) end
    def flush() end
    def deinit() end
end
var COMOK = "comok 2,37671-0,NX4832F035_011C,99,61489,E46720857602B29,16777216"
for refused: ["", "1AFFFFFF", "00FFFFFF", "55BB0B0065762C686F6D652C7461709C3A"]
    nextion.device_model = nil
    nextion.flash_mode = 1
    nextion.flash_phase = "handshake"
    nextion.flash_rx = bytes()
    nextion.flash_deadline = tasmota.millis(5000)
    nextion.flash_proto_version = 1
    nextion.flash_proto_baud = 115200
    nextion.flash_size = 999999
    nextion.strict_preflight = true
    nextion.flash_buff = make_header(GOOD_SEED, GOOD_FLAG, 999999, 0x4E)
    var link = OneRead(bytes(refused) + bytes().fromstring(COMOK) + bytes("FFFFFF"))
    nextion.ser = link
    nextion.every_50ms()
    assert(nextion.device_model == "NX4832F035_011C", "the comok after " + refused)
    assert(size(link.sent) == 1 && sent_as(link, 0, "whmi-wris 999999,115200,res0"), "the upload asked for after " + refused)
end
nextion.flash_mode = 0
nextion.flash_phase = nil

print("test_nextion_preflight: all assertions passed")
