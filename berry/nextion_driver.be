# nextion_driver.be — Nextion transport layer (Tasmota Berry)
#
# Ported from joBr99's driver (tasmota/autoexec.be, ~v9):
# https://raw.githubusercontent.com/joBr99/nspanel-lovelace-ui/main/tasmota/autoexec.be
# Reference copy studied in reference/joBr99/autoexec.be
#
# Single responsibility: speaking the serial protocol with the TFT (custom
# 55 BB framing, native Nextion protocol, and the .tft flash flow). Knows
# NOTHING about pages, entities or smart-home logic — that is brain.be's job.
#
# Key difference from the original: instead of publishing every received event
# over MQTT (tasmota.publish_result), this driver invokes a local callback
# `self.on_event(kind, payload)`. That removes the MQTT/broker round trip: the
# brain runs in the same Berry process and reacts directly.

#@ solidify:Nextion
class Nextion : Driver

    static header = bytes('55BB')
    static flash_block_size = 4096

    var flash_mode
    var flash_start_millis
    var flash_size
    var flash_written
    var flash_buff
    var flash_offset
    var flash_proto_version
    var flash_proto_baud
    var awaiting_offset
    var tcp
    var file      # the .tft being flashed from the filesystem, or nil when it comes over HTTP
    var file_left # its bytes not read yet
    var flash_done  # told how a flash from the file ended, true when the display took it all, or nil
    var ser
    var last_per
    var url
    # The flash as a state machine run from every_50ms, never a loop that waits:
    # "handshake" until the display's comok, then "upload" once it was told
    # whmi-wris. What the display answers piles up in flash_rx and is read as a
    # stream, since an ack and an offset can arrive split or together.
    var flash_phase
    var flash_rx
    # the display asked for the next block and has not had it: the HTTP stream
    # is still behind, and every tick tries again
    var block_pending
    # when the flash gives up: set at every step that expects an answer, and
    # checked with tasmota.time_reached, which survives millis() wrapping
    var flash_deadline
    # what the display sent that is not a whole message yet, and since when
    var rx_buf
    var rx_since
    var seen_ready   # the display said it came up, since this boot

    # What the panel said about itself in the `comok` reply of the flash
    # handshake: `comok touch,fw,model,editor,mcu,serial,flash`. Kept so
    # the .tft header can be checked against the real device instead of
    # an assumption, and logged so a field report carries the model and
    # firmware without anyone having to ask.
    var device_touch
    var device_model
    var device_fw
    var device_flash

    # Header checks run right before `whmi-wris` (see preflight_ok).
    # Default on. Turn off from the console — `Br nextion.strict_preflight = false`
    # — only to flash a file whose header is known to be unusual on
    # purpose; a failed check then logs and continues instead of aborting.
    var strict_preflight

    # Per panel model: [model seed at 0x2E-0x31, header byte 0x33]. Values
    # read from three independent production .tft files known to load on
    # this exact hardware (joBr99 lui-release, Blackymas nspanel_eu,
    # lovejoy777 Thermo_01). A model not
    # listed here is logged and let through; a known model with a
    # mismatching SEED is stopped; a mismatching 0x33 only warns.
    static expected_models = {
        "NX4832F035_011C": [0x1CE47603, 0xFF]
    }

    # Whether the TFT on the glass reads what the ESP32 sends itself, in the
    # Nextion's Protocol Reparse mode (`recmod=1`): joBr99's does, framed in
    # 55 BB. A generated project's pages take native instructions instead, and
    # in that mode the Nextion would hold every one of them as data -- measured
    # in the Editor's debugger, where `page home` sent after
    # `recmod=1` did nothing. PanelBoot turns it off for a generated project.
    var reparse

    # callback(kind:string, payload:string) — set by whoever consumes the events.
    # kind == "customrecv" -> payload is the string inside the 55BB frame (joBr99/TFT protocol)
    # kind == "nextion"    -> payload is an event in the native Nextion protocol (raw)
    var on_event

    def split_55(b)
        var ret = []
        var s = size(b)
        var i = s - 2
        while i > 0
            if b[i] == 0x55 && b[i+1] == 0xBB
                ret.push(b[i..s-1])
                b = b[(0..i-1)]
            end
            i -= 1
        end
        ret.push(b)
        return ret
    end

    def crc16(data, poly)
        if !poly poly = 0xA001 end
        var crc = 0xFFFF
        for i:0..size(data)-1
            crc = crc ^ data[i]
            for j:0..7
                if crc & 1
                    crc = (crc >> 1) ^ poly
                else
                    crc = crc >> 1
                end
            end
        end
        return crc
    end

    # joBr99's custom protocol: 55 BB [len low] [len high] [payload] [crc low] [crc high]
    def encode(payload)
        var b = bytes()
        b += self.header
        b.add(size(payload), 2)
        b += bytes().fromstring(payload)
        var msg_crc = self.crc16(b)
        b.add(msg_crc, 2)
        return b
    end

    # native Nextion protocol: text payload + FF FF FF terminator
    def encodenx(payload)
        var b = bytes().fromstring(payload)
        b += bytes('FFFFFF')
        return b
    end

    # Everything the rest of the Berry writes goes through here, and none of it
    # while a .tft is being sent: an instruction written between two blocks is
    # part of the file the display receives, which then fails its whole-file
    # check ("Data Error") and leaves the display stuck until it is powered off.
    # The clock writes every minute, so a flash would almost always be hit.
    def sendnx(payload)
        if self.flash_mode == 1
            log("NXP: dropped while flashing: " + str(payload), 3)
            return
        end
        self.ser.write(self.encodenx(payload))
        if tasmota.loglevel(3) log("NXP: Nextion command sent = " + str(payload), 3) end
    end

    # What the display sends, taken as a stream. A read comes every 50 ms and
    # can end in the middle of a frame: taken as it came, the first half lost its
    # last two bytes as if they were the CRC (a brightness of 100 arrived as 1,
    # a name as "Living Ro"), and a ready message split in two was never seen. A
    # 55 BB frame is taken by its length, a native reply by its FF FF FF, and a
    # piece that has waited a second for the rest is let go before anything new
    # is put behind it (poll): the display sends a whole frame in a few ms.
    def take_frames()
        while size(self.rx_buf) > 0
            var b = self.rx_buf
            var i55 = Nextion.find_bytes(b, Nextion.header, 0)
            var iff = Nextion.find_bytes(b, bytes('FFFFFF'), 0)
            if i55 == 0
                if size(b) < 4 break end
                var n = b.get(2, 2)
                if n > 512
                    # no frame of ours or joBr99's is that long: the header was noise
                    log("NXP: dropped a 55 BB header that announced " + str(n) + " bytes", 2)
                    self.rx_buf = b[2 ..]
                    continue
                end
                if size(b) < n + 6 break end
                var frame = b[0 .. n + 5]
                self.rx_buf = size(b) > n + 6 ? b[n + 6 ..] : bytes()
                # CRC-16/MODBUS over everything before it, as encode() and the
                # pages compute it. Logged and not refused until a panel has shown
                # that the frames the glass builds at run time (a slider's value,
                # the keyboard's line) carry it right
                if self.crc16(frame[0 .. n + 3]) != frame.get(n + 4, 2)
                    log("NXP: a frame's CRC does not match, taken anyway: " + frame.tohex(), 2)
                end
                if self.on_event != nil self.on_event("customrecv", n > 0 ? frame[4 .. n + 3].asstring() : "") end
            elif b[0] == 0x07 && iff != 1
                # joBr99's pages ring the buzzer with a lone 07
                self.rx_buf = size(b) > 1 ? b[1 ..] : bytes()
                tasmota.cmd("buzzer 1,1")
            elif iff >= 0 && (i55 < 0 || iff < i55)
                var m = b[0 .. iff + 2]
                self.rx_buf = size(b) > iff + 3 ? b[iff + 3 ..] : bytes()
                self.native_reply(m)
            elif i55 > 0
                log("NXP: dropped " + b[0 .. i55 - 1].tohex() + " before a frame", 3)
                self.rx_buf = b[i55 ..]
            else
                break
            end
            self.rx_since = tasmota.millis()
        end
    end

    # a native reply, FF FF FF included: the ready of a display that came up, or
    # whatever else it answers, for whoever consumes the events
    def native_reply(m)
        var body = size(m) > 3 ? m[0 .. -4] : bytes()
        if size(body) == 1 && body[0] == 0x88
            self.seen_ready = true
            self.screeninit()
            # the display is up and on its page 0: whoever draws on it is told,
            # since a generated project's pages say nothing of their own at power on
            if self.on_event != nil self.on_event("ready", "") end
        elif size(body) == 3 && body[0] == 0 && body[1] == 0 && body[2] == 0
            # the display's start, right before its ready
        elif size(body) == 1 && body[0] == 0x07
            tasmota.cmd("buzzer 1,1")
        elif self.on_event != nil
            self.on_event("nextion", str(body))
        end
    end

    # At boot with the display already running, when only the ESP32 restarted
    # (a restart from the Web UI, a crash), no ready comes, and nothing would be
    # drawn: the display keeps whatever it showed, and taps land on views the
    # Berry does not know are there. A boot that heard no ready takes the display
    # back to its page 0 and draws it as if it had just come up, as joBr99's own
    # backend does on its restart. PanelBoot asks a few seconds after boot.
    def assume_ready()
        if self.seen_ready || self.flash_mode == 1 return end
        log("NXP: no ready from the display since boot: taking it back to its page 0", 2)
        self.seen_ready = true
        # joBr99's stack leaves the display in Protocol Reparse (recmod=1), where
        # it takes every byte as data: a display that kept running through the
        # switch to a generated project would ignore all that follows. The
        # reserved string takes it out, as the flash handshake does; a display
        # not in it refuses the string, which costs nothing.
        if !self.reparse
            self.sendnx("DRAKJHSUYDGBNCJHGJKSHBDN")
            self.sendnx("recmod=0")
        end
        self.sendnx("page 0")
        self.screeninit()
        if self.on_event != nil self.on_event("ready", "") end
    end

    # the flash's own instructions: the handshake runs with the rest muted
    def flash_send(payload)
        self.ser.write(self.encodenx(payload))
        log("FLH: sent " + str(payload), 3)
    end

    def send(payload)
        if self.flash_mode == 1
            log("NXP: skipped command because still flashing", 3)
        else
            var payload_bin = self.encode(payload)
            self.ser.write(payload_bin)
            log("NXP: payload sent = " + str(payload_bin), 3)
        end
    end

    def write_to_nextion(b)
        if self.flash_mode == 1 return end
        self.ser.write(b)
    end

    def screeninit()
        log("NXP: Screen Initialized")
        if self.reparse self.sendnx("recmod=1") end
    end

    # How long each wait of the flash may last before it gives up: the display
    # answers the handshake and every block in milliseconds, and the HTTP
    # stream moves or it has stopped.
    static FLASH_HANDSHAKE_MS = 5000   # comok, after connect
    static FLASH_FIRST_ACK_MS = 15000  # the first 05 or 08, after whmi-wris
    static FLASH_ACK_MS = 10000        # the next 05, after a block
    static FLASH_STREAM_MS = 30000     # new bytes from the server, while a block waits for them

    def reopen(baud)
        self.ser.deinit()
        self.ser = serial(17, 16, baud, serial.SERIAL_8N1)
    end

    # where `pat` starts in `b` from `from`, or -1: the flash reads what the
    # display sent as bytes, since a NUL in them (a 55 BB frame's length, a
    # touch, a refusal) would end any string search early
    static def find_bytes(b, pat, from)
        var n = size(pat)
        var i = from != nil ? from : 0
        while i + n <= size(b)
            var j = 0
            while j < n && b[i + j] == pat[j] j += 1 end
            if j == n return i end
            i += 1
        end
        return -1
    end

    # The .tft's stream: a file of the filesystem, or the HTTP answer. What is
    # there to read now, the next bytes, and whether more can still come.
    def src_available()
        if self.file != nil return self.file_left end
        return self.tcp != nil ? self.tcp.available() : 0
    end

    def src_read(n)
        if self.file != nil
            var b = self.file.readbytes(n < self.file_left ? n : self.file_left)
            self.file_left -= size(b)
            if size(b) == 0 self.file_left = 0 end
            return b
        end
        return self.tcp.readbytes(n)
    end

    def src_open()
        if self.file != nil return self.file_left > 0 end
        return self.tcp != nil && self.tcp.connected()
    end

    # The display asked for the next block. It goes out when the HTTP stream has
    # it; until then every tick tries again, and the flash's deadline is what
    # bounds the wait, so the ESP32's loop never stops for a slow server.
    def pump_block()
        import string
        while self.src_available() > 0 && size(self.flash_buff) < self.flash_block_size
            self.flash_buff += self.src_read(4096)
            self.flash_deadline = tasmota.millis(Nextion.FLASH_STREAM_MS)
        end
        var remaining = self.flash_size - self.flash_written
        if remaining <= 0
            # an offset at the end: the display holds the whole file already
            log("FLH: Flashing complete - the display had the whole file", 2)
            self.note_flashed()
            self.end_flash()
            return
        end
        var need = remaining < Nextion.flash_block_size ? remaining : Nextion.flash_block_size
        if size(self.flash_buff) < need
            if !self.src_open() && self.src_available() == 0
                self.abort_flash(string.format(self.file != nil ? "the file ended at %d of %d bytes" : "the server closed the stream at %d of %d bytes",
                                               self.flash_written + size(self.flash_buff), self.flash_size))
            end
            return
        end
        var to_write = self.flash_buff[0 .. need - 1]
        self.flash_buff = size(self.flash_buff) > need ? self.flash_buff[need ..] : bytes()
        self.block_pending = false
        self.ser.write(to_write)
        self.flash_written += need
        self.flash_deadline = tasmota.millis(Nextion.FLASH_ACK_MS)
        var per = (self.flash_written * 100) / self.flash_size
        if self.last_per != per
            self.last_per = per
            tasmota.publish_result(string.format("{\"Flashing\":{\"complete\": %d, \"time_elapsed\": %d}}", per, (tasmota.millis() - self.flash_start_millis) / 1000), "RESULT")
        end
        if self.flash_written >= self.flash_size
            log(string.format("FLH: Flashing complete - %d bytes in %d s", self.flash_written, (tasmota.millis() - self.flash_start_millis) / 1000), 2)
            self.note_flashed()
            self.end_flash()
            self.flash_finished(true)
        end
    end

    # The caller of a flash from the file, told how it ended, once
    def flash_finished(ok)
        var done = self.flash_done
        self.flash_done = nil
        if done != nil  done(ok) end
    end

    # a flash that finished, and when: Main settings' Info says it
    def note_flashed()
        import persist
        persist.setmember("panel_tft_flashed", tasmota.strftime("%d/%m %H:%M", tasmota.rtc()["local"]))
        # a note the Info shows: a save that falls over is a line in the log and not an exception in the end of a flash, which
        # still has its caller to tell. It goes at once, as it did (this file loads before the panel's own save, PanelStore.safe_save)
        try
            persist.save()
        except .. as e, m
            log("NXP: saving the flash's note failed (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # the flash is over, done or not: the rest of the Berry may write again, at the rate it speaks
    def end_flash()
        self.flash_mode = 0
        self.flash_phase = nil
        self.block_pending = false
        self.awaiting_offset = 0
        self.flash_rx = bytes()
        self.flash_buff = bytes()
        self.rx_buf = bytes()
        if self.tcp != nil self.tcp.close() self.tcp = nil end
        if self.file != nil self.file.close() self.file = nil end
        self.reopen(115200)
    end

    # Every tick of a flash: what the display answered, the block it waits for,
    # and the deadline.
    def flash_tick()
        if self.ser.available() > 0 self.flash_rx += self.ser.read() end
        if self.flash_phase == "handshake"
            self.handshake_rx()
        elif self.flash_phase == "upload"
            self.upload_rx()
        end
        if self.flash_mode == 1 && self.block_pending self.pump_block() end
        if self.flash_mode == 1 && tasmota.time_reached(self.flash_deadline)
            self.abort_flash(self.flash_phase == "handshake" ? "the display did not answer the handshake" :
                             self.block_pending ? "the server stopped sending the file" : "the display stopped asking for blocks")
        end
    end

    # The comok, wherever it is in what arrived and once its FF FF FF is in.
    def handshake_rx()
        import string
        var i = Nextion.find_bytes(self.flash_rx, bytes().fromstring("comok"), 0)
        if i < 0 return end
        var e = Nextion.find_bytes(self.flash_rx, bytes('FFFFFF'), i)
        if e < 0 return end
        var strv = self.flash_rx[i .. e - 1].asstring()
        self.flash_rx = bytes()
        # The panel has identified itself. Before asking it to erase anything,
        # make sure the file we are about to stream is for it: a rejected upload
        # is harmless, but a wrong file that passes the panel's own gate is how a
        # display ends up refusing every further upload (Blackymas #166).
        self.parse_comok(strv)
        if !self.preflight_ok()
            self.abort_flash("the preflight refused the file")
            return
        end
        log("FLH: Send (High Speed) flash start")
        self.flash_start_millis = tasmota.millis()
        if self.flash_proto_version == 0
            self.flash_send(string.format("whmi-wri %d,%d,res0", self.flash_size, self.flash_proto_baud))
        else
            self.flash_send(string.format("whmi-wris %d,%d,res0", self.flash_size, self.flash_proto_baud))
        end
        self.flash_phase = "upload"
        self.flash_deadline = tasmota.millis(Nextion.FLASH_FIRST_ACK_MS)
        if self.flash_proto_baud != 115200
            # the instruction has to be out at 115200 before the rate changes,
            # and the display answers at the new rate: flush() waits for the
            # last byte, and the switch comes right after it
            self.ser.flush()
            self.reopen(self.flash_proto_baud)
        end
    end

    # After whmi-wris the display speaks one byte at a time: 05 for the next
    # block, or 08 and a 4-byte offset to go on from.
    def upload_rx()
        import string
        var i = 0
        var n = size(self.flash_rx)
        while i < n && self.flash_mode == 1
            if self.awaiting_offset == 1
                if n - i < 4 break end
                var offset = self.flash_rx.get(i, 4)
                i += 4
                self.awaiting_offset = 0
                self.resume_at(offset)
            elif self.flash_rx[i] == 0x05
                i += 1
                self.block_pending = true
                # the display asked: the server has the stream's time to deliver it
                self.flash_deadline = tasmota.millis(Nextion.FLASH_STREAM_MS)
            elif self.flash_rx[i] == 0x08
                i += 1
                self.awaiting_offset = 1
                log("FLH: Waiting offset...", 3)
            else
                log(string.format("FLH: unexpected byte 0x%02X from the display during the upload", self.flash_rx[i]), 2)
                i += 1
            end
        end
        if self.flash_mode != 1 return end
        self.flash_rx = i < n ? self.flash_rx[i ..] : bytes()
    end

    # The display already holds the file up to `offset` (the same fonts and
    # pictures as the installed one): the stream starts again there. A server
    # that does not answer the range exactly would put the wrong bytes at that
    # place in the display's flash, so anything else stops the flash.
    def resume_at(offset)
        import string
        log("FLH: Flash offset marker " + str(offset), 3)
        if offset < 0 || offset > self.flash_size
            self.abort_flash(string.format("the display asked for offset %d of a %d-byte file", offset, self.flash_size))
            return
        end
        if offset != 0
            if self.file != nil
                # the same file, from that byte
                self.file.seek(offset)
                self.file_left = self.flash_size - offset
                self.flash_buff = bytes()
            elif self.open_url_at(self.url, offset) == -1
                self.abort_flash("the server did not serve the file from byte " + str(offset))
                return
            end
            self.flash_written = offset
        end
        self.block_pending = true
    end

    # A flash reads the display's answers every 50 ms, and nothing else does meanwhile; the rest of
    # the time the same tick reads what the display sent: at 100 ms a touch or a swipe would wait up to
    # 100 ms (50 on average) before any code of ours saw it
    def every_50ms()
        if self.flash_mode == 1 self.flash_tick() else self.poll() end
    end

    def poll()
        import string
        if self.ser.available() > 0
            # telemetry: stamps the instant the byte actually arrived on the
            # UART — the closest point to the physical touch that can be
            # measured (reading only happens here, every 50ms, not in
            # fast_loop; up to ~50ms of polling wait BEFORE any processing of
            # ours starts). Stored in Berry's
            # `global` (shared between files loaded via `load()`)
            # for `light.be` to read without
            # direct coupling — see `handle_event()` there. Do NOT use
            # `tasmota.global` here: it is a native object with a fixed
            # schema (`ctypes_bytes_dyn`), it does not accept a new
            # attribute — it throws `attribute_error` on every call, which
            # breaks the whole serial read.
            global.touch_rx_ms = tasmota.millis()
            var msg = self.ser.read()
            if size(msg) > 0
                # tohex(), not str(): str(bytes) stops at 32 bytes and appends
                # "...", which hid the numeric payload of every slider event.
                # The hex dump is complete.
                log(string.format("NXP: Received Raw = bytes('%s')", msg.tohex()), 3)
                # a piece left from long ago would take the new bytes as its own
                if size(self.rx_buf) > 0 && tasmota.millis() - self.rx_since > 1000
                    log("NXP: dropped an incomplete message: " + self.rx_buf.tohex(), 2)
                    self.rx_buf = bytes()
                end
                if size(self.rx_buf) == 0 self.rx_since = tasmota.millis() end
                self.rx_buf += msg
            end
        end
        self.take_frames()
    end

    # `comok touch,fw,model,editor,mcu,serial,flash`, e.g.
    # `comok 2,37671-0,NX4832F035_011C,99,61489,E46720857602B29,16777216`.
    # Split on commas by hand: this Berry's string.split() takes a
    # position, not a separator.
    def parse_comok(strv)
        import string
        var i = string.find(strv, "comok")
        if i < 0 return end
        var rest = strv[i+6..]
        var fields = []
        var start = 0
        var j = string.find(rest, ",", start)
        while j >= 0
            fields.push(rest[start..j-1])
            start = j + 1
            j = string.find(rest, ",", start)
        end
        fields.push(rest[start..])
        if size(fields) >= 7
            self.device_touch = fields[0]
            self.device_fw = fields[1]
            self.device_model = fields[2]
            self.device_flash = fields[6]
        end
        log(string.format("FLH: panel reports model=%s fw=%s touch=%s flash=%s",
            str(self.device_model), str(self.device_fw), str(self.device_touch), str(self.device_flash)), 1)
        if self.device_touch != nil && self.device_touch != "2" && self.device_touch != "3"
            log("FLH: panel touch type is not capacitive (2/3) — unexpected for an NSPanel", 2)
        end
    end

    # Checks the .tft header (first 0x48 bytes of the HTTP stream) against
    # the panel that just answered `comok`. Mirrors the panel's own
    # "Model does not match" gate locally, plus what that gate does not
    # cover: the size field, the vendor byte and header byte 0x33.
    # Returns true to proceed. Nothing has been sent to the panel yet
    # when this runs, so a false here costs nothing.
    def preflight_ok()
        import string
        var tries = 0
        while size(self.flash_buff) < 0x48 && self.src_open() && tries < 20
            if self.src_available() > 0
                self.flash_buff += self.src_read(4096)
            else
                tasmota.delay(50)
            end
            tries += 1
        end
        if size(self.flash_buff) < 0x48
            log("FLH: preflight FAIL: could not read the .tft header from the HTTP stream", 2)
            return false
        end
        var hdr = self.flash_buff
        if hdr[0 .. 3].asstring() == TftPack.MAGIC
            # a server's file is sent as it comes, and a packed one would be written
            # to the display as it is, whatever strict_preflight says
            log("FLH: preflight FAIL: a packed .tft, which only the file system takes: UrlFetch it, then FlashNextionFile", 2)
            return false
        end
        var vendor = hdr[0x03]
        var res_x = hdr.get(0x0C, 2)
        var res_y = hdr.get(0x0E, 2)
        var orient = hdr[0x14]
        var seed = hdr.get(0x2E, 4)
        var flag = hdr[0x33]
        var declared = hdr.get(0x3C, 4)
        log(string.format("FLH: .tft header: vendor=%s %dx%d orient=%d seed=0x%08X flag=0x%02X size=%d (HTTP Content-Length %d)",
            hdr[0x03..0x03].asstring(), res_x, res_y, orient, seed, flag, declared, self.flash_size), 1)

        var ok = true
        if vendor != 0x4E   # 'N'
            log("FLH: preflight FAIL: vendor byte at 0x03 is not Nextion ('N')", 2)
            ok = false
        end
        if declared != self.flash_size
            log(string.format("FLH: preflight FAIL: header size field %d != Content-Length %d — truncated or wrong file", declared, self.flash_size), 2)
            ok = false
        end
        var expected = self.device_model != nil ? self.expected_models.find(self.device_model) : nil
        if expected == nil
            log("FLH: preflight: no expectation recorded for model " + str(self.device_model) + " — seed/0x33 not checked", 2)
        else
            if seed != expected[0]
                log(string.format("FLH: preflight FAIL: model seed 0x%08X, but %s expects 0x%08X — the panel would answer 'Model does not match'", seed, self.device_model, expected[0]), 2)
                ok = false
            end
            # Warning only. 0x33 separates production NSPanel files (0xFF)
            # from dev-board compiles (0x00) in every file seen, but a
            # 2023 report on an Intelligent-series panel shows a `_011`
            # compile loading on a `_011C` device — the letter may not be
            # a gate. Being wrong here costs a rejected upload, nothing
            # more, so it is not worth blocking a flash over.
            if flag != expected[1]
                log(string.format("FLH: preflight WARN: header byte 0x33 is 0x%02X; every production .tft for %s has 0x%02X (dev-board compiles have 0x00) — the panel may answer 'Model does not match'", flag, self.device_model, expected[1]), 2)
            end
        end
        if !ok && !self.strict_preflight
            log("FLH: preflight failed, but strict_preflight is off — continuing anyway", 2)
            return true
        end
        return ok
    end

    # The flash stops, for `reason`. Before whmi-wris the display was asked for
    # nothing and goes on as it was: back into Protocol Reparse for joBr99's TFT.
    # After it, the display holds part of a file and waits for the rest; the
    # ESP32 goes back to 115200 with the rest of the Berry unmuted, and
    # FlashNextion can start again.
    def abort_flash(reason)
        var told = self.flash_phase == "upload"
        if told
            log("FLH: flash STOPPED: " + str(reason) + ". The display holds part of the file: run FlashNextion again, and if it does not answer, power the panel off and on first", 1)
        else
            log("FLH: flash ABORTED: " + (reason != nil ? str(reason) : "by preflight") + " — the panel was not asked to write anything", 2)
        end
        self.end_flash()
        if !told && self.reparse self.sendnx("recmod=1") end
        self.flash_finished(false)
    end

    def begin_nextion_flash()
        self.flash_written = 0
        self.awaiting_offset = 0
        self.flash_offset = 0
        self.last_per = nil
        self.block_pending = false
        self.flash_rx = bytes()
        self.rx_buf = bytes()
        # the rest of the Berry is muted from here on (sendnx)
        self.flash_mode = 1
        self.flash_phase = "handshake"
        self.flash_deadline = tasmota.millis(Nextion.FLASH_HANDSHAKE_MS)
        self.flash_send('DRAKJHSUYDGBNCJHGJKSHBDN')
        self.flash_send('recmod=0')
        self.flash_send('recmod=0')
        self.flash_send("connect")
    end

    # A GET of the file from byte `pos`, and what came after the headers as the
    # start of flash_buff. Returns -1 when anything is off: no answer, no header
    # block, a status other than 200 or 206, no size at the first byte, and, from
    # any other byte, anything but a 206 whose range starts at it (a 200 there
    # would be the file from its start, written at `pos`).
    def open_url_at(url, pos)
        self.url = url
        import string
        self.flash_buff = bytes()
        if self.tcp != nil self.tcp.close() self.tcp = nil end
        var host
        var port
        var s1 = string.split(url, 7)[1]
        var i = string.find(s1, ":")
        var sa
        if i < 0
            port = 80
            i = string.find(s1, "/")
            sa = string.split(s1, i)
            host = sa[0]
        else
            sa = string.split(s1, i)
            host = sa[0]
            s1 = string.split(sa[1], 1)[1]
            i = string.find(s1, "/")
            sa = string.split(s1, i)
            port = int(sa[0])
        end
        var get = sa[1]
        log(string.format("FLH: host: %s, port: %s, get: %s", host, port, get))
        self.tcp = tcpclient()
        self.tcp.connect(host, port)
        log("FLH: Connected:" + str(self.tcp.connected()), 3)
        var get_req = "GET " + get + " HTTP/1.0\r\n"
        get_req += string.format("Range: bytes=%d-\r\n", pos)
        get_req += string.format("HOST: %s:%s\r\n\r\n", host, port)
        self.tcp.write(get_req)
        # the header block, within about 3 s, over as many reads as it takes
        var b = bytes()
        var e = -1
        var tries = 0
        while e < 0 && tries < 30
            if self.tcp.available() > 0
                b += self.tcp.readbytes()
                e = Nextion.find_bytes(b, bytes().fromstring("\r\n\r\n"), 0)
            else
                tasmota.delay(100)
                tries += 1
            end
        end
        if e < 0
            log("FLH: no HTTP answer from " + str(host) + ":" + str(port), 2)
            self.tcp.close()
            self.tcp = nil
            return -1
        end
        var headers = b[0 .. e + 3].asstring()
        self.flash_buff = size(b) > e + 4 ? b[e + 4 ..] : bytes()
        var lower = string.tolower(headers)
        var sp = string.find(headers, " ")
        var code = sp > 0 && size(headers) >= sp + 4 ? int(headers[sp + 1 .. sp + 3]) : 0
        var ok = code == 200 || code == 206
        if ok && pos > 0
            ok = code == 206 && string.find(lower, "content-range: bytes " + str(pos) + "-") >= 0
        end
        if ok && pos == 0
            var tag = "content-length:"
            var at = string.find(lower, tag)
            var size_text = ""
            if at >= 0
                var j = at + size(tag)
                var eol = string.find(headers, "\r\n", j)
                while j < eol && headers[j] == " " j += 1 end
                size_text = headers[j .. eol - 1]
            end
            self.flash_size = size(size_text) > 0 ? int(size_text) : 0
            ok = self.flash_size > 0
            log("FLH: Flash file size: " + str(self.flash_size), 3)
        end
        if !ok
            var eol1 = string.find(headers, "\r\n")
            log("FLH: the server's answer cannot be flashed from byte " + str(pos) + ": " + (eol1 > 0 ? headers[0 .. eol1 - 1] : headers), 2)
            self.flash_buff = bytes()
            self.tcp.close()
            self.tcp = nil
            return -1
        end
        return 0
    end

    # Starts a flash from a file of the filesystem: the .tft the
    # factory image carries, packed or as the Editor wrote it. The same flow as
    # from a server, the file as the stream, and its size as the Content-Length
    # the preflight checks the header against. A packed file reads as the .tft it
    # stands for (tft_pack.be). `done`, when given, is told how the
    # flash ended: true when the display took the whole file, false when it stopped.
    def flash_file(path, done)
        if self.flash_mode == 1
            log("FLH: a flash is already running; " + str(path) + " refused", 1)
            return false
        end
        if self.tcp != nil self.tcp.close() self.tcp = nil end
        var f = nil
        try
            f = open(path, "rb")
        except .. as e, m
            log("FLH: flash not started: " + str(path) + " cannot be read - " + str(e) + ": " + str(m), 1)
            return false
        end
        f = TftPack.wrap(f)
        if f == nil
            log("FLH: flash not started: " + str(path) + " is a packed .tft this panel cannot read", 1)
            return false
        end
        self.file = f
        self.flash_size = f.size()
        self.file_left = self.flash_size
        self.flash_buff = bytes()
        self.url = path
        if self.flash_size <= 0
            log("FLH: flash not started: " + str(path) + " is empty", 1)
            f.close()
            self.file = nil
            return false
        end
        log("FLH: flashing " + str(path) + ", " + str(self.flash_size) + " bytes", 2)
        self.flash_done = done
        self.begin_nextion_flash()
        return true
    end

    # Starts a flash from `url`, unless one is running: a second handshake would
    # be written into the upload that is.
    def flash_nextion(url)
        if self.flash_mode == 1
            log("FLH: a flash is already running; FlashNextion " + str(url) + " refused", 1)
            return false
        end
        self.flash_size = 0
        self.flash_done = nil
        if self.file != nil self.file.close() self.file = nil end
        if self.open_url_at(url, 0) == -1
            log("FLH: flash not started: the file could not be read from " + str(url), 1)
            return false
        end
        self.begin_nextion_flash()
        return true
    end

    def init()
        log("NXP: Initializing Driver")
        self.ser = serial(17, 16, 115200, serial.SERIAL_8N1)
        self.file = nil
        self.file_left = 0
        self.flash_mode = 0
        self.flash_proto_version = 1
        self.flash_proto_baud = 921600
        self.flash_buff = bytes()
        self.flash_rx = bytes()
        self.block_pending = false
        self.awaiting_offset = 0
        self.rx_buf = bytes()
        self.rx_since = 0
        self.seen_ready = false
        self.strict_preflight = true
        self.reparse = true
        self.on_event = nil
    end

    # The driver on this panel: its one instance, given to Tasmota as a driver,
    # and the console commands that reach it. The file declares the class and
    # nothing else, so that the class can be compiled into the firmware;
    # PanelBoot (panel_boot.be) starts it.
    static def start()
        var nextion = Nextion()
        tasmota.add_driver(nextion)
        tasmota.add_cmd('GetDriverVersion', def (cmd, idx, payload, payload_json)
            import string
            var jm = string.format("{\"nlui_driver_version\":\"%s\"}", "brain-local-1")
            tasmota.publish_result(jm, "RESULT")
        end)
        tasmota.add_cmd('Nextion', def (cmd, idx, payload, payload_json)
            nextion.sendnx(payload)
            tasmota.resp_cmnd_done()
        end)
        tasmota.add_cmd('CustomSend', def (cmd, idx, payload, payload_json)
            nextion.send(payload)
            tasmota.resp_cmnd_done()
        end)
        # the .tft from a file of the filesystem, as the factory image carries it
        tasmota.add_cmd('FlashNextionFile', def (cmd, idx, payload, payload_json)
            if nextion.flash_mode == 1
                tasmota.resp_cmnd_str("a flash is already running")
                return
            end
            tasmota.set_timer(0, def ()
                nextion.flash_proto_version = 1
                nextion.flash_proto_baud = 921600
                nextion.flash_file(payload)
            end)
            tasmota.resp_cmnd_done()
        end)
        tasmota.add_cmd('FlashNextion', def (cmd, idx, payload, payload_json)
            if nextion.flash_mode == 1
                tasmota.resp_cmnd_str("a flash is already running")
                return
            end
            tasmota.set_timer(0, def ()
                nextion.flash_proto_version = 1
                nextion.flash_proto_baud = 921600
                nextion.flash_nextion(payload)
            end)
            tasmota.resp_cmnd_done()
        end)
        return nextion
    end
end
