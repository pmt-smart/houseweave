# What berry/zigbee_pairing.be uses beyond stub_tasmota.be: the Wi-Fi's state and
# MAC, commands by name and what a test has them answer, the rules and the timers,
# and the panel's Zigbee, as a stand-in that notes what it was asked.

class PairTasmota : TasmotaStub
    var cmds, up, replies, rules, timers, muted
    def init() self.cmds = [] self.up = true self.replies = {} self.rules = {} self.timers = TimerBook(self) self.muted = [] end
    # the answer to the line, or to its command's word: a JSON payload is written in
    # no order a test can name. One asked muted, out of the log, is noted in muted
    # too, and one with a leading _, kept off MQTT, answers as Tasmota answers it
    def cmd(c, mute)
        import string
        self.cmds.push(c)
        if mute  self.muted.push(c) end
        if size(c) > 1 && c[0] == "_"  c = c[1 ..] end
        var r = self.replies.find(c)
        var sp = string.find(c, " ")
        if r == nil && sp > 0  r = self.replies.find(c[0 .. sp - 1]) end
        return r
    end
    def add_rule(trigger, f, id) self.rules[trigger] = f end
    # the timers set so far, run: they stack, and remove_timer(id) takes out every one of the id (a TimerBook)
    def run_timers() self.timers.run_all() end
    def wifi() return {"up": self.up, "mac": "AA:AA:AA:00:00:01", "ip": "192.168.2.50"} end
end
tasmota = PairTasmota()

# the panel's Zigbee (zigbee_bridge.be): the house's bridges, the one of the house's words, and whether it is in step, as a test says
class ZigbeeBridge
    static MODE_OFF = "off"
    static MODE_MESH = "mesh"
    var mode, sent, info
    var linked      # the bridge of the house in step, as a test says
    def init() self.mode = "mesh" self.sent = [] end
    def peer() return self.info end
    def send(c) self.sent.push(c) return true end
    def post(c) self.sent.push(c) return true end
    def link_state() return self.linked == true end
end

class PairGlobal : GlobalStub
    def contains(k) return self.store.contains(k) end
end
global = PairGlobal()
