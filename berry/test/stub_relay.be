# What berry/zbbridge_relay.be uses of Tasmota beyond stub_tasmota.be: the fast
# loop, named timers, rules and commands, all
# recorded so the test can look at them.
#
# The timers are a TimerBook (stub_tasmota.be): they stack as the firmware's do, and remove_timer(id) takes out
# every one of the id. `timers[id]()` fires the oldest pending one of the id, and `timers.fire(id)` does the same
# for a helper; a test that wants to see what a second set_timer did to the first reads `timers.count(id)`.

class RelayTasmota : TasmotaStub
    # what a command answers, when a test gives it an answer: SSId, StaState
    var cmds, timers, replies, rules, rule_lists, peer_mode, up, answers, muted, said
    def init() self.said = [] self.cmds = [] self.timers = TimerBook(self) self.replies = {} self.rules = {} self.rule_lists = {} self.peer_mode = 0 self.answers = [] self.muted = [] end
    # how a command of ours ended, as the console is told
    def resp_cmnd(s) self.said.push(s) end
    def resp_cmnd_done() self.answers.push("done") end
    def resp_cmnd_failed() self.answers.push("failed") end
    def add_fast_loop(f) end
    # the commands registered (add_cmd), by name, for a test to run as the console would
    var handlers
    def add_cmd(name, f)
        if self.handlers == nil  self.handlers = {} end
        self.handlers[name] = f
    end
    # every rule of a trigger, in the order registered, one an id, as Tasmota keeps
    # them: rules[trigger] runs them all
    def add_rule(trigger, f, id)
        var l = self.rule_lists.find(trigger)
        if l == nil
            l = []
            self.rule_lists[trigger] = l
            self.rules[trigger] = def (v, t, m) for e: l e[1](v, t, m) end end
        end
        var i = 0
        while i < size(l)
            if id != nil && l[i][0] == id
                l[i] = [id, f]
                return
            end
            i += 1
        end
        l.push([id, f])
    end
    # the rules of a trigger with an id go, as Tasmota's remove_rule takes them out
    def remove_rule(trigger, id)
        var l = self.rule_lists.find(trigger)
        if l == nil return end
        var i = 0
        while i < size(l)
            if l[i][0] == id  l.remove(i) else i += 1 end
        end
    end
    # a command asked muted, out of the log, is noted in muted too
    def cmd(c, mute)
        self.cmds.push(c)
        if mute  self.muted.push(c) end
        # the mode the ESP-NOW driver's record keeps (EspNowPeerMode), read and written
        if c == "EspNowPeerMode" return {"EspNowPeerMode": self.peer_mode} end
        # Time <epoch> sets the clock from 2016 on, as RtcSetTime does; Time 0 gives it back to the NTP
        if size(c) > 5 && c[0 .. 4] == "Time " && int(c[5 ..]) >= 1451602800  self.utc_now = int(c[5 ..]) end
        if size(c) > 15 && c[0 .. 14] == "EspNowPeerMode "
            self.peer_mode = int(c[15 ..])
            return {"EspNowPeerMode": self.peer_mode}
        end
        # the mesh's number, set and then read back, as the driver keeps it, where a test answers its reading
        if size(c) > 13 && c[0 .. 12] == "EspNowMeshId " && self.replies.contains("_EspNowMeshId")
            self.replies["_EspNowMeshId"] = {"EspNowMeshId": int(c[13 ..])}
        end
        return self.replies.find(c)
    end
    # on the network unless a test says it is not (up false)
    # the signal of the Wi-Fi, when a test says one
    var wifi_rssi, wifi_ssid
    def wifi()
        var m = {"up": self.up != false, "mac": "B0:B0:B0:00:00:01", "ip": "192.168.2.61"}
        if self.wifi_rssi != nil  m["rssi"] = self.wifi_rssi end
        if self.wifi_ssid != nil  m["ssid"] = self.wifi_ssid end
        return m
    end
    def hostname() return "zbbridge-living" end
end
tasmota = RelayTasmota()

# the pairing's socket (be_udp_lib.c): what it sent, and what a test hands it to read
class udp
    var sent, inbox, remote_ip, remote_port
    def init() self.sent = [] self.inbox = [] end
    def begin(host, port) return true end
    def send(ip, port, b) self.sent.push([ip, b.asstring()]) return true end
    def read()
        if size(self.inbox) == 0 return nil end
        var p = self.inbox[0]
        self.inbox.remove(0)
        self.remote_ip = p[1]
        return bytes().fromstring(p[0])
    end
    def close() end
end

class RelayGlobal : GlobalStub
    def contains(k) return self.store.contains(k) end
end
global = RelayGlobal()

# The frames the relay says to the NSPanel go through a queue that lets two go at once and the rest 80 ms apart (zbbridge_relay.be,
# emit): a test that is not about the queue, and wants its frame to go, lets the queue come back to rest first -- every timer that
# gives a credit back, run -- and returns how many it took. The queue's own tests run that timer by hand, and look at what each
# one lets go.
def settle_frames(r)
    var n = 0
    while r.gap_timer && n < 500
        tasmota.timers.fire("zbbridge_relay_frames")
        n += 1
    end
    return n
end

# A house of the panels a bridge's events go to, for a test that reads them as they leave (the mesh is the only way out of a bridge): the panel 4
# marks a device of the bridge, so it is among the listeners (ZbBridgeRelay.listeners), and every event to it lands in `told`, as the link's frames did
class ListeningList
    def is_panel(n) return n == 4 end
    def role(n) return n == 4 ? 2 : 0 end
    def revoked(n) return false end
end
class ListeningState
    var marks
    def init() self.marks = {4: {"s": {}}} end
    def forgotten(ieee) end
    def back(ieee) end
    def flood(pending) end
end
class ListeningDevices
    def heard(d) end
end
class ListeningHouse
    var up, list, state, devices, told, room, link
    def init(told) self.up = true self.list = ListeningList() self.state = ListeningState() self.devices = ListeningDevices() self.told = told self.room = 233 end
    def node_room(n) return self.room end
    def alarm_setting() return nil end
    def event_node(n, text)
        import json
        self.told.push(json.load(text))
        return true
    end
end
def listen_to(r, told) r.house = ListeningHouse(told) end
