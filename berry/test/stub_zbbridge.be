# What berry/zigbee_bridge.be uses of Tasmota beyond stub_tasmota.be: rules and
# commands by name, and the Wi-Fi's state.

class BridgeTasmota : TasmotaStub
    var cmds, rules, up, timers, espnow, muted, replies
    def init() self.cmds = [] self.rules = {} self.up = true self.timers = TimerBook(self) self.muted = [] self.replies = {} end
    # the timers set so far, run: they stack, and remove_timer(id) takes out every one of the id (a TimerBook)
    def run_timers() self.timers.run_all() end
    def add_rule(trigger, f, id) self.rules[trigger] = f end
    def remove_rule(trigger, id) self.rules.remove(trigger) end
    # EspNowStatus answers what a test says of the ESP-NOW link (espnow), and the
    # mode the driver's record keeps (EspNowPeerMode) is read and written; nothing
    # else answers. A command asked muted, out of the log, is noted in muted too,
    # and one with a leading _, kept off MQTT, answers as Tasmota answers it
    var peer_mode
    def cmd(c, mute)
        self.cmds.push(c)
        if mute  self.muted.push(c) end
        if size(c) > 1 && c[0] == "_"  c = c[1 ..] end
        if c == "EspNowPeerMode" return {"EspNowPeerMode": self.peer_mode != nil ? self.peer_mode : 0} end
        if size(c) > 15 && c[0 .. 14] == "EspNowPeerMode "
            self.peer_mode = int(c[15 ..])
            return {"EspNowPeerMode": self.peer_mode}
        end
        # what a test says a command answers (the driver's "sent" to an EspNowSend, say)
        if self.replies.contains(c) return self.replies[c] end
        return c == "EspNowStatus" ? self.espnow : nil
    end
    def wifi() return {"up": self.up, "mac": "A0:A0:A0:00:00:01"} end
end
tasmota = BridgeTasmota()

class BridgeGlobal : GlobalStub
    def contains(k) return self.store.contains(k) end
end
global = BridgeGlobal()
