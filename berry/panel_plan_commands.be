# panel_plan_commands.be -- a command plan as Tasmota commands: a group command
# for each of its groups, a direct one for each device no group reaches, and the
# panel's own relays.
#
# The plan's taps (panel_plan_view.be) and the views' effects (brain.be's run)
# both go out through the one instance autoexec.be builds.

#@ solidify:PanelPlanCommands
class PanelPlanCommands
    var send_at     # a closure (node, line) -> whether it left: a line to one bridge of the house by its number (panel_route.be), or nil
    # A relay that feeds lamps is not switched again within this of its last
    # change, whoever changed it: bulbs reset themselves to factory after a few
    # quick power cycles, and six taps on a card in five seconds made three. The
    # button driver keeps the same guard between two holds.
    static RELAY_GUARD_MS = 15000
    # The lines of a run go to the bridge in their turn: the link takes a few frames of a burst, and
    # a plan of five lines, or a zone of twelve lamps that leave, is one. The first BURST lines of a run go at once, as a tap's own
    # always did, and each of the rest GAP_MS after the one before, in the order they were made: the zone's groups first, and the
    # lamps no group reaches after them. The lines waiting are held up to OUTBOX_MAX, and one that finds no room goes as it would have
    static var GAP_MS = 80
    static var BURST = 3
    static var OUTBOX_MAX = 96

    var zigbee   # f(command): the Zigbee bridge's send, in whatever mode it runs
    var feeds    # f(n) -> bool: relay n powers lamps (the store's relay_powers); nil, none does
    var changed_at   # relay number -> tasmota.millis() of its last change
    # f(dev) -> how a command names a device, the store's zb_address: a channel of a device of several by its endpoint;
    # nil, by its id alone
    var address
    var outbox       # the lines waiting for their turn, in order
    var armed        # the timer that gives the next one its turn is on its way
    var sent_at      # tasmota.millis() of the last line that went, or nil
    var run_len      # the lines that went in the run now: one that ends when none goes for GAP_MS

    def init(zigbee, feeds)
        self.zigbee = zigbee
        self.feeds = feeds
        self.changed_at = {}
        self.outbox = []
        self.armed = false
        self.sent_at = nil
        self.run_len = 0
    end

    # a line to the bridge, in its turn
    def post(line)
        var now = tasmota.millis()
        var since = self.sent_at != nil ? now - self.sent_at : PanelPlanCommands.GAP_MS
        # a run ends when nothing went for a gap (and a clock that wrapped is a gap)
        if since < 0 || since >= PanelPlanCommands.GAP_MS
            self.run_len = 0
            since = PanelPlanCommands.GAP_MS
        end
        if size(self.outbox) == 0 && self.run_len < PanelPlanCommands.BURST
            self.go(line, now)
        elif size(self.outbox) >= PanelPlanCommands.OUTBOX_MAX
            self.go(line, now)
        else
            self.outbox.push(line)
            self.arm(PanelPlanCommands.GAP_MS - since)
        end
    end

    def go(line, now)
        self.sent_at = now
        self.run_len += 1
        self.zigbee(line)
    end

    def arm(ms)
        if self.armed return end
        self.armed = true
        tasmota.set_timer(ms, / -> self.next_line())
    end

    # the next line's turn. The timer for the one after is set first: a send that raises loses its line and not the rest
    # (a Tasmota timer that raises is not called again)
    def next_line()
        self.armed = false
        if size(self.outbox) == 0 return end
        var line = self.outbox[0]
        self.outbox.remove(0)
        if size(self.outbox) > 0 self.arm(PanelPlanCommands.GAP_MS) end
        self.go(line, tasmota.millis())
    end

    # relay n changed, from here or from anywhere else (autoexec.be's Power<n>#state rule)
    def relay_changed(n)
        self.changed_at[n] = tasmota.millis()
    end

    # Whether relay n must rest. Bounded on both sides: a change 25 days old
    # reads as a recent one once tasmota.millis() has wrapped.
    def relay_resting(n)
        var at = self.changed_at.find(n)
        if at == nil || self.feeds == nil || !self.feeds(n) return false end
        var d = tasmota.millis() - at
        return d >= 0 && d < PanelPlanCommands.RELAY_GUARD_MS
    end

    # what goes in a ZbSend for a device: its address, as the store says it
    def at(dev)
        return self.address != nil ? self.address(dev) : '"Device":"' + dev + '"'
    end

    def run(plan, intent)
        import string
        var v = intent == "on" ? 1 : 0
        for zid: plan["zids"]
            self.post(string.format('ZbSend {"Group":%d,"Send":{"Power":%d}}', zid, v))
        end
        for dev: plan["unicast"]
            self.post('ZbSend {' + self.at(dev) + ',"Send":{"Power":' + str(v) + '}}')
        end
        # the thermostats the command turns, which the caller put there: its zone's off, or the ones it is
        # aimed at, as the driver of each says it
        for dev: plan.find("thermostat", [])
            self.drive(dev, "mode", nil, v == 1 ? "heat" : "off")
        end
        # the blinds of a zone whose Tap is All: on opens them, off closes them
        for dev: plan.find("cover", [])
            self.drive(dev, v == 1 ? "open" : "close", nil, nil)
        end
        var power = tasmota.get_power()
        for n: plan["relays"]
            # a relay already where it is asked to be is left alone: no cycle for nothing
            if n <= size(power) && power[n - 1] == (v == 1) continue end
            if self.relay_resting(n)
                log(string.format("PLAN: relay %d feeds lamps and changed less than %d s ago: left as it is", n, PanelPlanCommands.RELAY_GUARD_MS / 1000), 2)
                continue
            end
            tasmota.set_power(n - 1, v == 1)
            self.relay_changed(n)
        end
    end

    # a level to a target: by group where the plan says, and directly otherwise
    def level(plan, key, value)
        import string
        for zid: plan["zids"]
            self.post(string.format('ZbSend {"Group":%d,"Send":{"%s":%d}}', zid, key, value))
        end
        for dev: plan["unicast"]
            self.post(string.format('ZbSend {%s,"Send":{"%s":%d}}', self.at(dev), key, value))
        end
    end

    # A command to a device's driver on the bridge: {"id": the device, "do": the verb,
    # "k": a setting's key, "v": the value}, which the bridge hands to the driver that has the device
    # a word to the alarm on the bridge: arm, disarm, panic, acknowledge, ask for its log or its settings, set it up
    def alarm(m)
        import json
        return self.zigbee("ZbRelayAlarm " + json.dump(m))
    end

    def drive(dev, verb, key, value)
        import json
        var s = "ZbRelayDrive {\"id\":" + json.dump(dev) + ",\"do\":" + json.dump(verb)
        if key != nil  s += ",\"k\":" + json.dump(key) end
        if value != nil  s += ",\"v\":" + json.dump(value) end
        self.post(s + "}")
    end

    # a device blinks for 3 s, for whoever is looking for it; a channel's, the whole device
    def identify(dev)
        import string
        self.post(string.format('ZbSend {"Device":"%s","Send":{"Identify":3}}', PanelStore.ieee_part(dev)))
    end

    # a group's devices blink for 3 s together: by group where the plan says, and directly otherwise; a relay has no
    # Identify
    def identify_plan(plan)
        import string
        for zid: plan["zids"]
            self.post(string.format('ZbSend {"Group":%d,"Send":{"Identify":3}}', zid))
        end
        for dev: plan["unicast"]  self.identify(dev) end
    end

    # a new lamp comes back off after a power cut; a device
    # without the attribute refuses, and that is tolerated
    def startup(dev)
        import string
        self.post('ZbSend {' + self.at(dev) + ',"Write":{"StartUpOnOff":0}}')
    end

    # what the coordinator knows of a device: its model, among the rest
    def query(dev)
        self.post("ZbInfo " + PanelStore.ieee_part(dev))
    end

    # A device of the bridge `node` leaves its network, and the bridge forgets it: said to that bridge by its number, since the panel no
    # longer has the device to find it by
    def leave_at(dev, node)
        if self.send_at == nil return self.leave(dev) end
        var ieee = PanelStore.ieee_part(dev)
        self.send_at(node, "ZbLeave " + ieee)
        self.send_at(node, "ZbForget " + ieee)
    end

    # a device leaves the network, and the coordinator forgets it
    def leave(dev)
        var ieee = PanelStore.ieee_part(dev)
        self.post("ZbLeave " + ieee)
        self.post("ZbForget " + ieee)
    end

    # the network opens to a new device for 60 s, or closes: the bridge `node`'s, by its number in the house, or the panel's own
    def permit(on, node)
        var line = on ? "ZbPermitJoin 1" : "ZbPermitJoin 0"
        if node != nil && node > 0 && self.send_at != nil  return self.send_at(node, line) end
        self.zigbee(line)
    end

    # Where a button's tap goes is the button driver's, on this
    # device whichever side of the bridge the Zigbee is: the driver takes the
    # buttons, and that one's tap is the relay's or a report for the panel.
    def button(n, mode)
        import string
        tasmota.cmd("ButtonDecoupleEnable 1")
        tasmota.cmd(string.format("ButtonDecouple%d %d", n, mode == "panel" ? 1 : 0))
    end
end
