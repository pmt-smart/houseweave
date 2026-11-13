# appliance_node.be -- runs ONLY on an appliance: a node of the house that is itself one device of it, with no Zigbee network and no screen. The
# panels put its device in their zones and drive it over the mesh as they do a bridge's (HouseList.ROLE_DEVICE): the same commands, the same events.
#
# What an appliance is to the house as any node with no screen is (the house's layer, the panels that hear it, its Wi-Fi, its OTA, the house's MQTT,
# the screens a panel shows of it, the window of entering the house, the button, the clock) is NodeHost's (node_host.be), over this object: the
# fields are here. What is an appliance's own is here: the one device it is, what a panel asks of it, and what it says back.
#
# THE DEVICE is an object of the image's own class (BoilerThermostat, boiler_thermostat.be), handed this node, with
#   statics    ID, KIND, MODEL and NAME: the driver's name, the kind a panel gives it, its model, and what it is called before a panel names it
#   methods    describe(), a new map, what a panel registers it with; state(), its whole state; command(cmd), a panel's command, true when taken;
#              tick(), every second; stop(), the node is about to restart; rows(), its rows of the node's Main settings; signal(), whether the
#              node's LED is to blink slowly; telemetry(), what Tasmota's telemetry says of it
# and it says what changes through this node: say(section, fields) and send_list(section, entries).
#
# ITS ADDRESS is shaped as a Zigbee device's, for everything on a panel that reads one: the EUI-64 of the node's radio address, its first three
# bytes, FFFE, and its last three.
#
# WHAT IT TAKES from a panel, over the mesh (MeshCmd, which hands each line to `run`): ZbRelayDrive, a command to the device; ZbPing, answered; ZbSend
# with an Identify, which blinks the LED; ZbRelayName, the name the house gave the device; and the words every node takes (node_host.be).
#
# WHAT IT SAYS is the drivers' event of a bridge, ZbDriver (zbbridge_drivers.be): "s" the state and "v" the settings' values, the fields the panels
# were not told; "x" the settings' schema, in numbered frames; "e" a command refused. To the panels that hear it, one frame at a time. The
# description, "d", goes only to the panels that show the device, each alone, with the whole state: when one marks it (house_state.be), and after a
# boot. A panel registers a device a description names, and one that does not show the device has no use for it.
#
# Compiled into the appliance's firmware: one class, nothing at the top, every module imported where it is used. `ApplianceNode.start()` is the whole of
# the appliance's autoexec.be. It comes after NodeHost, NodePairing, PairSign and the device's class, which it names.

#@ solidify:ApplianceNode
class ApplianceNode : Driver
    # what NodeHost reads of the node it serves (node_host.be): what its log lines and the names of its timers and rules begin with, what it tells the
    # house's server it is, how many rows of its Main settings are its own, and the LED its window blinks: the second, which follows no relay
    static TAG = "APPLIANCE"
    static ID = "appliance"
    static ROLE = "device"
    static MAIN_ROWS = 2
    static LED = 1
    # a message to the panels waits this long behind the one before, and no more than OUT_MAX wait
    static FRAME_GAP_MS = 80
    static OUT_MAX = 32
    # the panels that show the device are told what it is and its whole state at most this often
    static TELL_GAP_MS = 2000
    # what the flash keeps the name a panel gave the device under
    static NAME_KEY = "appliance_name"
    # an Identify blinks the LED this many times
    static IDENTIFY_BLINKS = 6

    var house, meshcmd, wifi, ota, link, backup, heard_from, budget, pairing
    var window_until, by_button, identify_until, blink_pin, blink_rest, hold
    var clock_src, clock_at, clock_expect
    var device     # the device this appliance is
    var ieee       # its address, as a panel keys it
    var told       # section -> {field -> value}: what the panels that hear this node were told of the device
    var outbox     # the messages waiting to go to them, in order
    var pumping    # the timer that sends the next of them is on its way
    var name       # the name a panel gave the device, or "" for none
    var told_at    # millis when the panels that show the device were last told all of it, or nil
    var led_rest   # the LED's level before the device's signal blinked it, or nil with none going
    var led_lit    # the signal's blink is in its lit second

    def init()
        import persist
        self.heard_from = {}
        # what an ESP-NOW frame carries; the mesh's room to each panel is less (NodeHost.frame_budget)
        self.budget = 233
        self.by_button = false
        self.blink_pin = -1
        self.told = {}
        self.outbox = []
        self.pumping = false
        self.ieee = ApplianceNode.eui64(str(tasmota.wifi().find("mac", "")))
        self.name = str(persist.find(ApplianceNode.NAME_KEY, ""))
        self.pairing = NodePairing(self)
    end

    # The node, with its device, its commands and its rules at boot: the whole of the appliance's autoexec.be. Returns it
    static def start()
        import global
        var a = ApplianceNode()
        global.appliance_node = a
        a.device = BoilerThermostat(a)
        tasmota.add_cmd("ZbRelayDrive", def (cmd, idx, payload)
            if a.drive(payload)  tasmota.resp_cmnd_done() else tasmota.resp_cmnd_failed() end
        end)
        # the house on this node, as on every node with no screen (node_host.be)
        NodeHost.start(a, global.contains("HouseList") ? global.HouseList.ROLE_DEVICE : 0, nil)
        if a.house != nil
            # told to join another house: out of this one, its window opens for a panel of the other
            a.house.on_move = / -> NodeHost.open_window(a, NodeHost.BOOT_WINDOW_MS, false)
            # a panel that marks the device is told what it is and its whole state
            a.house.state.prime = / ieee -> a.marked(ieee)
            # and the page of its devices a panel asks for is the one device it is
            a.house.devices.own = / -> [a.ieee, a.device.MODEL, a.name, a.brief()]
        end
        NodeHost.clock(a)
        # the button held 5 s opens the window. A short press is taken here and does nothing: with no rule for it Tasmota would toggle the relay,
        # which is the device's own to switch
        tasmota.add_rule("Button1#State=3", / -> NodeHost.button_held(a), "appliance_button")
        tasmota.add_rule("Button1#State=2", / -> nil, "appliance_button")
        NodeHost.radio_at_boot(a)
        tasmota.set_timer(NodeHost.AGAIN_MS, / -> NodeHost.again_after_boot(a, NodeHost.AGAIN_TRIES), "appliance_again")
        tasmota.add_driver(a)
        log("APPLIANCE: a " + a.device.NAME + ", " + a.ieee + ", for the panels of the house over the mesh", 2)
        return a
    end

    # --- the words of the address ---------------------------------------------------------------

    # the EUI-64 of a radio address, "A0:B7:65:5D:02:E9", as a panel writes a device's: "0xA0B765FFFE5D02E9"
    static def eui64(mac)
        import string
        var h = string.toupper(string.replace(mac, ":", ""))
        if size(h) != 12 return "0x0000000000000000" end
        return "0x" + h[0 .. 5] + "FFFE" + h[6 .. 11]
    end

    # "0xa0b7..." and "0xA0B7..." are one address
    static def norm(a)
        import string
        a = str(a)
        if size(a) > 2 && (a[0 .. 1] == "0x" || a[0 .. 1] == "0X") return "0x" + string.toupper(a[2 ..]) end
        return string.toupper(a)
    end

    # --- what NodeHost asks of the node ---------------------------------------------------------

    # what the window's announcement says of an appliance after its seconds: no Zigbee channel, and the kind of a device of the house
    def announce()
        return "0,2"
    end

    def window_closed() end

    def guest_said(m) end

    # a panel keeps a bridge as the node of the house's words, never an appliance: nothing to say again
    def listen(payload, from)
        return true
    end

    # everything said again to the panels that show the device: what it is, and its whole state
    def say_all()
        self.told = {}
        self.tell_marking()
    end

    # the rows of its Main settings that are its own: the device's
    def settings_rows()
        return self.device.rows()
    end

    def apply_mqtt(m)
        NodeHost.apply_mqtt(self, m)
    end

    def render_for(view, k, x)
        return NodeHost.render_for(self, view, k, x)
    end

    # The appliance as its image left it: the device stopped, out of the house, and then nothing persist keeps, the driver's pairing, what the device
    # kept and Tasmota's settings, its Wi-Fi with them. Reset 1 then restarts it
    def wipe()
        self.device.stop()
        NodeHost.leave_house(self, / -> self.wipe_rest())
    end

    def wipe_rest()
        import persist
        persist.zero()
        PairSign.safe_save(ApplianceNode.TAG)
        self.device.history.erase()
        tasmota.cmd("EspNowEnable 0")
        tasmota.cmd("EspNowPeerMac 00:00:00:00:00:00")
        tasmota.cmd("EspNowSecret2 0")
        log("APPLIANCE: back to its image: the settings erased, restarting", 2)
        tasmota.cmd("Reset 1")
    end

    # --- what a panel asks ----------------------------------------------------------------------

    # A command line from a panel of the house, over the mesh (`from`, its number, MeshCmd): the words every node takes are NodeHost's, and of the
    # rest the ones a panel says of a device are run; any other is refused and logged
    def run(line, via, from)
        import string
        if NodeHost.run(self, line, via, from) return end
        var w = NodeHost.word(line)
        var i = string.find(line, " ")
        var payload = i < 0 ? "" : line[i + 1 ..]
        if w == "ZBRELAYDRIVE"
            self.drive(payload)
        elif w == "ZBPING"
            self.ping(payload)
        elif w == "ZBSEND"
            # the one word of a Zigbee device an appliance has an answer for: it shows which it is
            if string.find(payload, "\"Identify\"") >= 0  NodeHost.flash_led(self, ApplianceNode.IDENTIFY_BLINKS) end
        elif w == "ZBRELAYNAME"
            self.named(payload)
        else
            # at 1: a panel newer than this node says a word it does not know, and the vocabulary has no version
            log("APPLIANCE: refused from the " + str(via) + ", not a command a panel sends an appliance: " + w, 1)
        end
    end

    # ZbRelayDrive: {"id": the device, "do": the verb, ...}, to the device. What a command says back goes whole: what the panels were told is told
    # again, changed or not, since a word of before may have been lost on the way. False, and the panels told, for a device that is not this one's
    # and for a command the device does not take
    def drive(payload)
        import json
        var m = json.load(str(payload))
        var id = isinstance(m, map) ? m.find("id") : nil
        if type(id) != "string" || type(m.find("do")) != "string" return false end
        var ieee = ApplianceNode.norm(id)
        if ieee != self.ieee
            self.emit({"ZbDriver": {ieee: {"e": "nodriver"}}})
            return false
        end
        self.told = {}
        var taken = false
        try
            taken = self.device.command(m) == true
        except .. as e, msg
            log("APPLIANCE: the device failed on " + str(m["do"]) + " - " + str(e) + ": " + str(msg), 2)
        end
        if !taken  self.emit({"ZbDriver": {ieee: {"e": "refused"}}}) end
        return taken
    end

    # a ping a panel sent, answered as a bridge answers one of its devices: the device is there
    def ping(payload)
        if ApplianceNode.norm(payload) != self.ieee return end
        self.emit({"ZbPing": {"Device": self.ieee, "IEEEAddr": self.ieee}})
    end

    # ZbRelayName {"IEEE","Name"}: the name a panel gave the device, kept for the page of its devices another panel asks for
    def named(payload)
        import json
        import persist
        var m = json.load(str(payload))
        if !isinstance(m, map) || ApplianceNode.norm(m.find("IEEE", "")) != self.ieee return end
        var n = str(m.find("Name", ""))
        if n == self.name return end
        self.name = n
        persist.setmember(ApplianceNode.NAME_KEY, n)
        PairSign.safe_save(ApplianceNode.TAG)
    end

    # --- what it says ---------------------------------------------------------------------------

    # what a panel registers the device with: the device's own words, and its kind, its driver's name and its model
    def describe()
        var d = self.device.describe()
        d["kind"] = self.device.KIND
        d["drv"] = self.device.ID
        d["model"] = self.device.MODEL
        return d
    end

    # What a panel classifies the device by when it picks it from the page of this node's devices (PanelStore.item_profile): its kind, what it can
    # do, its endpoint and the range of its target. The item is one frame with the device's name in it, and the rest of the description goes to
    # the panel once it shows the device (tell_marking)
    def brief()
        var d = self.device.describe()
        return {"kind": self.device.KIND, "caps": d.find("caps", 0), "min": d.find("min", 0), "max": d.find("max", 0), "ep": d.find("ep", 1)}
    end

    # What the device says of itself, {field: value} in a section ("s" the state, "v" the settings' values): the fields the panels that hear this
    # node were not told go to them, in as few messages as fit a frame
    def say(section, fields)
        var known = self.told.find(section)
        if known == nil
            known = {}
            self.told[section] = known
        end
        var delta = {}
        for k: fields.keys()
            if !known.contains(k) || known[k] != fields[k]
                known[k] = fields[k]
                delta[k] = fields[k]
            end
        end
        if size(delta) == 0 return end
        var ieee = self.ieee
        var wrap = / m -> {"ZbDriver": {ieee: {section: m}}}
        for chunk: NodeHost.pack(delta, wrap, NodeHost.frame_budget(self), ApplianceNode.TAG)  self.emit(wrap(chunk)) end
    end

    # a list a panel needs whole (the settings' schema), in the numbered frames the mesh carries: false when an entry fits none, and nothing goes
    def send_list(section, entries)
        var ieee = self.ieee
        var frames = NodeHost.list_frames(entries, / f -> {"ZbDriver": {ieee: {section: f}}}, NodeHost.frame_budget(self), ApplianceNode.TAG)
        if frames == nil return false end
        for f: frames  self.emit(f) end
        return true
    end

    # A message to the panels that hear this node: at once when none is on its way, and else after the ones before it, FRAME_GAP_MS apart. A panel's
    # ESP-NOW driver keeps four frames for its main loop, and drops the oldest of a longer burst
    def emit(msg)
        self.outbox.push(msg)
        while size(self.outbox) > ApplianceNode.OUT_MAX  self.outbox.remove(0) end
        if !self.pumping  self.pump() end
    end

    def pump()
        if size(self.outbox) == 0
            self.pumping = false
            return
        end
        self.pumping = true
        var msg = self.outbox[0]
        self.outbox.remove(0)
        NodeHost.send_event(self, msg)
        tasmota.set_timer(ApplianceNode.FRAME_GAP_MS, / -> self.pump(), "appliance_frames")
    end

    # A panel marked a device of this node (house_state.be): when it is the device, the panels that show it are told all of it. True: there is
    # nothing to wait for before it can be told
    def marked(ieee)
        if ApplianceNode.norm(ieee) != self.ieee return true end
        var now = tasmota.millis()
        if self.told_at != nil && now - self.told_at >= 0 && now - self.told_at < ApplianceNode.TELL_GAP_MS return true end
        self.told_at = now
        self.tell_marking()
        return true
    end

    # What the device is and its whole state, to each panel that shows it, alone: a panel keeps no description across a restart, and one that does
    # not show the device would register it by the description
    def tell_marking()
        import json
        var h = self.house
        if h == nil || !h.up return end
        var d = json.dump({"ZbDriver": {self.ieee: {"d": self.describe()}}})
        var s = json.dump({"ZbDriver": {self.ieee: {"s": self.device.state()}}})
        for p: h.state.marks.keys()
            if !h.list.is_panel(p) || !h.state.marks[p]["s"].contains(self.ieee) continue end
            if !h.event_node(p, d) || !h.event_node(p, s)
                log("APPLIANCE: what the device is did not go to the panel " + str(p), 3)
            end
        end
    end

    # --- Tasmota's own turns --------------------------------------------------------------------

    # every second: the device's logic, and the LED
    def every_second()
        try
            self.device.tick()
        except .. as e, m
            log("APPLIANCE: the device's second failed - " + str(e) + ": " + str(m), 2)
        end
        self.signal()
    end

    # The LED says what the device asks it to, a second on and a second off, and is left as it was after. The window's own blink goes first: the
    # levels written here are told from the one the LED had at rest, so a window that closed on the wrong one is put right at the next second
    def signal()
        import gpio
        if NodeHost.window_open(self) return end
        var pin = gpio.pin(gpio.LED1, ApplianceNode.LED)
        if pin < 0 return end
        if self.device.signal()
            if self.led_rest == nil
                self.led_rest = gpio.digital_read(pin)
                self.led_lit = false
            end
            self.led_lit = !self.led_lit
            gpio.digital_write(pin, self.led_lit ? 1 - self.led_rest : self.led_rest)
        elif self.led_rest != nil
            gpio.digital_write(pin, self.led_rest)
            self.led_rest = nil
        end
    end

    # Tasmota is about to restart, for a command, an OTA or a reset: the device first
    def save_before_restart()
        self.device.stop()
    end

    # what Tasmota's telemetry says of the device, which the house's MQTT carries
    def json_append()
        tasmota.response_append(self.device.telemetry())
    end
end
