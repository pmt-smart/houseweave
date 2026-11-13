# zbbridge_relay.be -- runs ONLY on the ZBBridge Pro (not on the NSPanel), a bridge of the house: the Zigbee coordinator of its network is
# here, and the panels of the house drive it over the mesh (there is no panel of its own, and no pair).
#
# The panels' commands arrive over the mesh (MeshCmd, mesh_cmd.be), which hands each one to `run`, and this side runs the ones a panel sends (ALLOWED).
# And back, to the panels that hear this bridge (`listeners`: the ones that commanded it lately, that keep it as the bridge of the house's words, or that
# show its devices), goes every Zigbee event this side hears that the panel's pages read (`ZbReceived`, `ZbState`, `ZbResponse`, `ZbInfo`, `ZbPing`),
# filtered and merged to fit a frame of the mesh.
#
# What a bridge is to the house as any node with no screen is (the house's layer, the panels that hear it, its Wi-Fi, its OTA, the server and its backup,
# the house's MQTT, the screens a panel shows of it, the window of entering the house, the button, the clock) is NodeHost's (node_host.be), over this
# object: the fields are here, and the methods of those names hand over to it. What is a bridge's own is here: the Zigbee network and what it says,
# and the commands a panel sends it.
#
# COMPILED INTO THE BRIDGE'S FIRMWARE,
# for the bridge to update by OTA, which carries the app and not the file
# system: one class a file (this, NodeHost, NodePairing, ZbBridgeDiscovery,
# ZbBridgeDrivers, ZbDriverThermostat, ZbDriverCover and PairSign), nothing at the
# top, every module imported where it is used, the statics read only.
# `ZbBridgeRelay.start()` is the whole of the bridge's autoexec.be
# (zbbridge_autoexec.be).

#@ solidify:ZbBridgeRelay
class ZbBridgeRelay
    # the Zigbee network's key (secure_network): the look at it comes this long after boot, and again this often
    # while the coordinator is not up or a pairing has the bridge, for up to 90 times (15 minutes)
    static KEY_AFTER_MS = 20000
    static KEY_AGAIN_MS = 10000
    static KEY_TRIES = 90
    # the coordinator's Z-Stack: the file the image carries, its revision as the ZNP says it at boot (ZbState 50), how many
    # boots try it, and the wait for the pairing to be over before the flash, which keeps Tasmota mute for 5 to 8 minutes (coord_check)
    static COORD_HEX = "SonoffZBPro_coord_20220219.hex"
    static COORD_REVISION = 20220219
    static COORD_TRIES = 3
    static COORD_AFTER_MS = 5000
    static COORD_AGAIN_MS = 10000
    static COORD_WAIT_TRIES = 90
    # the keys of a report our pages read besides the state: the model, a lamp's
    # power-on state and on/off transition time, read for its settings, and the
    # answers of the group cluster (xdrv_23_zigbee_6_0_commands.ino)
    static EXTRA_KEYS = ["ModelId", "StartUpOnOff", "OnOffTransitionTime", "AddGroup", "AddGroupStatus", "RemoveGroup", "RemoveGroupStatus",
                         "GetGroup", "GetGroupCapacity", "GetGroupCount"]
    # What this side says to the NSPanel of what Z2T told it (the reports, the announces, the answers, ZbInfo) goes through
    # a queue that lets FRAME_BURST frames go at once and the rest FRAME_GAP_MS apart: the
    # ESP-NOW driver on the NSPanel keeps four frames for its loop, which comes round every 50 ms, and drops the oldest of
    # a longer burst. The bridge's answer to a ZbInfo of 30 devices was 30 frames in the same instant, and the NSPanel
    # mapped 4 of them. One frame, the tap's, goes at once as it always did; the alarm and the drivers keep the queues of
    # their own (zbbridge_alarm.be, zbbridge_drivers.be) and the same gap. A queue longer than OUT_MAX drops the oldest.
    static FRAME_GAP_MS = 80
    static FRAME_BURST = 2
    static OUT_MAX = 64
    # the devices an alarm's panic acts on, at most: one verb a device (alarm_cmd), and the list kept is not longer than this
    static PANIC_MAX = 32
    # the clusters of an endpoint the NSPanel's pages read to tell what a device is
    # (PanelStore.device_profile): on/off, level and colour; and a sensor's IAS zone
    # and occupancy, for the alarm
    static CLUSTERS = [0x0006, 0x0008, 0x0300, 0x0500, 0x0406]
    # what a sensor says, as Z2T names an IAS zone's alarm by its type
    # (Z_Data_Alarm::convertZoneStatus) and the occupancy cluster: the state the
    # panel lights its icon by, the raw zone status under it, and the tamper and
    # the battery the alarm reads
    static SENSOR_KEYS = ["Contact", "Occupancy", "Water", "Fire", "CO", "ZoneStatus", "Tamper", "BatteryLow", "BatteryPercentage"]
    # the last endpoint a switch's channel is looked for on: a module of four channels has them on 1 to 4, and 8 leaves
    # room below a Hue lamp's 11
    static CHANNEL_MAX = 8
    # The commands a panel sends over the mesh, and all this side runs of what arrives there: a line run as the console would
    # run it would give whoever held the link the bridge, ZbReset and the ZNP's raw frames included. By the command's
    # word, in any case. ZbRelayListen, ZbRelayTime and ZbRelayAdmin are every node's (node_host.be)
    static ALLOWED = ["ZBSEND", "ZBPING", "ZBINFO", "ZBLEAVE", "ZBFORGET", "ZBPERMITJOIN",
                      "SETOPTION116", "ZBRELAYNAME", "ZBRELAYDRIVE", "ZBRELAYALARM"]
    # what NodeHost reads of the node it serves (node_host.be): what its log lines and the names of its timers and rules begin with, what it tells the
    # house's server it is, how many rows of its Main settings are its own (settings_rows), and the LED its window blinks, the board's only one
    static TAG = "ZBBRIDGE_RELAY"
    static ID = "zbbridge_relay"
    static ROLE = "bridge"
    static MAIN_ROWS = 2
    static LED = 0

    var pending    # {address -> filtered attributes} accumulated, pending send (a map,
                   # serialised only when actually sending, send_now)
    var budget     # the most an event carries, before the mesh's room to each panel that hears it (frame_budget)
    var pairing    # what a panel says to it while it enters the house (node_pairing.be)
    var window_until  # when the pairing's window closes, or nil with none open
    var by_button     # the window was the button's: only then the bridge gives its Wi-Fi
    var identify_until # while a panel's request to identify goes, the blink is faster
    var next_channel   # the Zigbee channel the panel chose, for a network with no device yet, or nil
    var discovery  # the Zigbee devices in Home Assistant (zbbridge_discovery.be), or nil
    var drivers    # the host of the devices' drivers (zbbridge_drivers.be), or nil
    var alarm      # the house alarm (zbbridge_alarm.be), or nil
    var meshcmd    # the commands that come over the mesh (mesh_cmd.be), or nil
    var house      # the list of the house on the mesh (house_mesh.be), or nil
    var clock_src  # where the bridge's time came from: "internet", "restart", "panel", or nil with no clock
    var clock_at   # when it was last set by the user or the internet, UTC, or 0: how fresh it is
    var clock_expect # a Time of ours whose Time#Set is coming: the panel's
    var blink_pin  # the LED the window blinks, and its level before it (to restore)
    var blink_rest
    var out        # the frames waiting to go to the NSPanel, in order: [key, text], the key a ZbInfo's address or nil (emit)
    var queued     # key -> its frame in `out`: a ZbInfo said again before it went takes the place of the one waiting
    var credit     # the frames that may go at once now: FRAME_BURST, less one for each that went in the last FRAME_GAP_MS
    var gap_timer  # the timer that gives the next credit is on its way
    var hold       # the button held: [pin, the level it had at the hold, millis of the hold], or nil
    var heard_from # a panel's number -> millis when it last commanded this bridge over the mesh (listeners)
    var coord_rev  # the Z-Stack revision the ZNP said at this boot (ZbState 50), or nil before it says
    var coord_due  # the image's Z-Stack is to go into the coordinator at this boot (coord_check): the key, the channel and the pairing wait
    var zb_aborted # Z2T gave up on a coordinator that runs the image's Z-Stack (ZbState 99): it takes no command now, ZbConfig included
    var leaving    # the devices a panel had leave this bridge's network, which their forget then removes from the house: address -> true
    var boot_fix   # what of the network's identity was derived when the ZNP said its version at this boot (identity_at_boot), or nil
    var wifi       # its Wi-Fi as a panel of the house shows it and asks for it in this bridge's Wireless settings (panel_wifi.be), or nil
    var ota        # its OTA, from the house's server (node_ota.be), in those Wireless settings, or nil
    var link       # the house's server: the pair's key, its requests and this bridge's word to it (server_link.be), or nil
    var backup     # its configuration kept on the house's server (node_backup.be, bridge_backup.be), or nil

    def init()
        self.pending = nil
        # what an ESP-NOW frame carries; the mesh's room to each panel is less (frame_budget)
        self.budget = 233
        self.window_until = nil
        self.by_button = false
        self.identify_until = nil
        self.next_channel = nil
        self.blink_pin = -1
        self.blink_rest = nil
        self.out = []
        self.queued = {}
        self.credit = ZbBridgeRelay.FRAME_BURST
        self.gap_timer = false
        self.heard_from = {}
        self.coord_rev = nil
        self.coord_due = false
        self.zb_aborted = false
        self.leaving = {}
        self.boot_fix = nil
        self.pairing = NodePairing(self)
    end

    # The relay, with its commands, its rules and its link at boot: the whole of
    # the bridge's autoexec.be (zbbridge_autoexec.be). Returns it.
    static def start()
        import global
        var r = ZbBridgeRelay()
        global.zbbridge_relay = r
        # the Zigbee devices in Home Assistant, by the names the panel gives them
        if global.contains("ZbBridgeDiscovery")  r.discovery = global.ZbBridgeDiscovery() end
        tasmota.add_cmd("ZbRelayName", def (cmd, idx, payload)
            if r.discovery != nil  r.discovery.name_cmd(payload) else tasmota.resp_cmnd_failed() end
        end)
        # the drivers of the devices whose own words stay on this side, and the command
        # the panel drives them with
        if global.contains("ZbBridgeDrivers")  r.drivers = global.ZbBridgeDrivers(r) end
        # the drivers there are: the thermostats' (zbdriver_thermostat.be), the blinds' (zbdriver_cover.be), and the switches'
        # of two channels that open and close, which the panel assigns (zbdriver_twokey.be)
        if r.drivers != nil && global.contains("ZbDriverThermostat")  r.drivers.add(global.ZbDriverThermostat(r.drivers)) end
        if r.drivers != nil && global.contains("ZbDriverCover")  r.drivers.add(global.ZbDriverCover(r.drivers)) end
        if r.drivers != nil && global.contains("ZbDriverTwoKey")  r.drivers.add(global.ZbDriverTwoKey(r.drivers)) end
        tasmota.add_cmd("ZbRelayDrive", def (cmd, idx, payload)
            if r.drivers != nil  r.drivers.drive(payload) else tasmota.resp_cmnd_failed() end
        end)
        # the house alarm: it hears the sensors' reports, and the panel arms it, disarms it and sets it up with
        # this command
        if global.contains("ZbBridgeAlarm")  r.alarm = global.ZbBridgeAlarm(r) end
        tasmota.add_cmd("ZbRelayAlarm", / cmd, idx, payload -> r.alarm_cmd(payload))
        # the house on this bridge, as on every node with no screen (node_host.be): the commands of the mesh, the house's list and its MQTT, its Wi-Fi, its
        # OTA, the house's server with the bridge's backup, and its screens on a panel
        NodeHost.start(r, global.contains("HouseList") ? global.HouseList.ROLE_BRIDGE : 0, global.contains("BridgeBackup") ? global.BridgeBackup : nil)
        if r.house != nil
            # told to join another house: out of this one, its window opens for a panel of the other, with its Wi-Fi and its devices kept
            r.house.on_move = / -> r.open_window(NodeHost.BOOT_WINDOW_MS, false)
            # and of the nodes the house forgets (house_mesh.be, sweep()), the alarm's losses of a bridge that is no more
            r.house.forgets.push(/ m, forgot -> r.alarm != nil ? r.alarm.sweep(m) : nil)
            # and the alarm's configuration, which is the house's: this bridge's alarm takes the part that is its own
            if global.contains("HouseAlarm") && r.alarm != nil  r.house.alarm = global.HouseAlarm(r.house, / c -> r.alarm.take_cfg(c)) end
            # the devices of this bridge that panels of other rooms mark: their reports are said to the house, and one that has said nothing is read
            r.house.state.resolve = / key -> r.ieee_of(key)
            r.house.state.prime = / ieee -> r.read_state(ieee)
            # and the devices a panel of another room picks from: what Z2T said of them, the names the panels gave, and the question to Z2T when it has said nothing
            # out of the rule of the mesh's frame that asks, at the next turn of the loop: Z2T's answer, published inside the
            # command, reaches the ZbInfo rule only there (the relay's ESP-NOW commands, below)
            r.house.devices.ask_info = / -> tasmota.defer(/ -> tasmota.cmd("ZbInfo", true))
            r.house.devices.name_of = / ieee -> r.discovery != nil ? r.discovery.names.find(ieee) : nil
        end
        # the bridge's own clock, set by the internet, kept across a restart, or taken from a panel's word or the house's (node_host.be)
        NodeHost.clock(r)
        tasmota.add_rule("ZbReceived", / value, trigger, payload -> r.forward(value, trigger, payload), "zbbridge_relay_out")
        tasmota.add_rule("ZbState", / value, trigger, payload -> r.forward_state(value, trigger, payload), "zbbridge_relay_out")
        tasmota.add_rule("ZbResponse", / value, trigger, payload -> r.forward_response(value, trigger, payload), "zbbridge_relay_out")
        tasmota.add_rule("ZbInfo", / value, trigger, payload -> r.forward_info(value, trigger, payload), "zbbridge_relay_out")
        tasmota.add_rule("ZbPing", / value, trigger, payload -> r.forward_ping(value, trigger, payload), "zbbridge_relay_out")
        # the button held 5 s: with ButtonTopic 0 and no relay, the
        # hold reaches the rules as {"Button1":{"State":3}}
        tasmota.add_rule("Button1#State=3", / -> r.button_held(), "zbbridge_relay_button")
        # a command of a panel is confirmed by its report, not by the read Z2T would make after it: this bridge's own setting
        tasmota.cmd("SetOption116 1")
        r.radio_at_boot()
        r.boot()
        if r.drivers != nil  r.drivers.boot() end
        log("ZBBRIDGE_RELAY: forwarding ZbReceived, ZbState, ZbResponse, ZbInfo and ZbPing to the panels of the house over the mesh", 2)
        return r
    end

    # ZbRelayAlarm {...}: the panel's word to the alarm, the console's command. The alarm takes them all but one, which is this side's: panic_act
    def alarm_cmd(payload)
        import json
        if self.alarm == nil
            tasmota.resp_cmnd_failed()
            return
        end
        var m = json.load(str(payload))
        var verb = isinstance(m, map) ? m.find("do") : nil
        # in a house whose alarm's configuration is the house's, a panel writes it in the house's list, and a word that set it here would
        # last until the house's next change: it is refused
        if self.house != nil && self.house.alarm_setting() != nil && ["sensor", "times", "panic_cfg", "siren", "burst", "panic_act"].find(verb) != nil
            log("ZBBRIDGE_RELAY: the alarm's configuration is the house's, set from a panel", 2)
            tasmota.resp_cmnd_failed()
            return
        end
        if verb == "panic_act"
            if self.panic_act(m)  tasmota.resp_cmnd_done() else tasmota.resp_cmnd_failed() end
            return
        end
        self.alarm.cmd_payload(payload)
    end

    # What one device does when the panic runs: {"do":"panic_act","id":<its IEEE address>,"act":"on"|"off"|"open"|"close"|"none"}.
    # The alarm keeps them as a list, [[ieee, act], ...], which panic_cfg took whole in one frame: past six or seven devices it
    # was over the 233 bytes of an ESP-NOW frame, and the link dropped it with a line in the log. A frame a device
    # has no such limit. The list is the alarm's own (set_panic), with this device's pair put, or taken out with "none": false
    # for a word that is not one, or for a list that would pass PANIC_MAX
    def panic_act(m)
        import string
        var id = m.find("id")
        var act = m.find("act")
        if type(id) != "string" || type(act) != "string" || size(id) < 3 || size(act) == 0 || size(act) > 12  return false end
        var digits = (id[0 .. 1] == "0x" || id[0 .. 1] == "0X") ? id[2 ..] : id
        if size(digits) != 16  return false end
        var ieee = "0x" + string.toupper(digits)
        var devs = []
        for pair: self.alarm.cfg["panic"].find("devices", [])
            if isinstance(pair, list) && size(pair) == 2 && pair[0] != ieee  devs.push(pair) end
        end
        if act != "none"
            if size(devs) >= ZbBridgeRelay.PANIC_MAX  return false end
            devs.push([ieee, act])
        end
        return self.alarm.set_panic({"devices": devs})
    end

    # A command line from a panel of the house, over the mesh (`from`, its number, MeshCmd): run when it is one a panel sends, refused and logged
    # otherwise. The panel is noted as one that hears this bridge, and the words every node takes, ZbRelayListen (listen) and ZbRelayAdmin (the factory
    # reset and the web password, from a panel of the house only), are the node's (node_host.be)
    def run(line, via, from)
        import string
        if NodeHost.run(self, line, via, from) return end
        var w = NodeHost.word(line)
        if ZbBridgeRelay.ALLOWED.find(w) != nil
            # a command of the panel to a device or a group: its echo is not a hand on the device
            if w == "ZBSEND" && self.alarm != nil  self.alarm.commanded(line) end
            # whether the device a leave or a forget names is this bridge's: on its network before the line takes it out, or, for a forget, the
            # device of the leave before it, which may have taken it out already
            var had = false
            if w == "ZBLEAVE" || w == "ZBFORGET"
                var parts = string.split(line, " ")
                var a = size(parts) > 1 ? parts[1] : ""
                had = ZbBridgeRelay.on_network(line) || (w == "ZBFORGET" && self.leaving.contains(a))
                if w == "ZBFORGET"  self.leaving.remove(a)
                elif had
                    if size(self.leaving) >= 8  self.leaving = {} end
                    self.leaving[a] = true
                end
            end
            tasmota.cmd(line)
            # a device the panel removed: out of Home Assistant too, a moment later
            # and out of the alarm's setup, with the losses it had of it
            if w == "ZBFORGET" && self.alarm != nil
                var parts = string.split(line, " ")
                if size(parts) > 1  self.alarm.forget_device(parts[1]) end
            end
            # removed from the house: the panels that show it are told (house_state.be). Only a device this bridge had: a
            # tombstone of another's would say "gone" of a device that is not (seen on the bench: a bridge that never had a curtain kept one
            # from a remove that went to it by mistake)
            if w == "ZBFORGET" && self.house != nil && had
                var gone = string.split(line, " ")
                if size(gone) > 1  self.house.state.forgotten(gone[1]) end
            end
            if w == "ZBFORGET" && self.discovery != nil  self.discovery.check_later(1000) end
            if w == "ZBFORGET" && self.drivers != nil  self.drivers.check_later(1000) end
        else
            # at 1: a panel newer than its bridge says a word this bridge does not know, and the vocabulary has no version
            log("ZBBRIDGE_RELAY: refused from the " + str(via) + ", not a command a panel sends: " + w, 1)
        end
    end

    # whether the device a line names after its word (an IEEE or a short address) is on this bridge's Zigbee network now; true when Z2T cannot say
    # (not up), which leaves things as they were
    static def on_network(line)
        import global
        import string
        var i = string.find(line, " ")
        if i < 0 return false end
        if !global.contains("zigbee") || global.zigbee.started() != true return true end
        try
            return global.zigbee.find(line[i + 1 ..]) != nil
        except ..
            return true
        end
    end

    # A panel of the house keeps this bridge as the one it says the house's words to (the favourite, in step), and hears its events: what
    # `run` noted already (heard_from). Its first word, with a 1 (the session up on its side), has this bridge say again what a panel that came up
    # after it changed would not know: every device a driver has, its description and state, and the alarm's state
    def listen(payload, from)
        if from == nil || from <= 0 return false end
        if str(payload) == "1"  self.say_all() end
        return true
    end

    # every device a driver has, its description and state, and the alarm's state, said again to the panels that hear this bridge
    def say_all()
        if self.drivers != nil  self.drivers.link_up() end
        if self.alarm != nil  self.alarm.say_state() end
    end

    # After a boot, once this bridge is in its house and in step on the mesh, everything said again to the panels that show its devices (their marks, which the
    # flash kept): a restart quicker than the mesh's heartbeats is no session a panel saw go down, and the drivers' and the alarm's state begin again here
    def again_after_boot(tries)
        NodeHost.again_after_boot(self, tries)
    end

    # a panel of the house asks for this bridge's factory reset, or sets or removes its web password: every node's (node_host.be), with this bridge's wipe
    def admin(payload, via, from)
        return NodeHost.admin(self, payload, via, from)
    end

    # This bridge's screens, which a panel of the house shows as its Main settings and Wireless settings: every node's (node_host.be), with the rows of
    # the Main settings that are a bridge's own (settings_rows)
    def render_for(view, k, x)
        return NodeHost.render_for(self, view, k, x)
    end

    # the rows of its Main settings that are a bridge's own: its Zigbee network. MAIN_ROWS says how many they are
    def settings_rows()
        var ch = ZbBridgeRelay.zigbee_channel()
        return [["Zigbee channel", ch > 0 ? str(ch) : "Not up", 0, 0], ["Zigbee devices", str(ZbBridgeRelay.device_count()), 0, 0]]
    end

    # the station driver's report to this bridge's Wi-Fi (node_host.be)
    def wifi_said(kind, v)
        NodeHost.wifi_said(self, kind, v)
    end

    # The bridge as its image left it: no panel, nothing persist keeps, the driver's
    # pairing, the Zigbee network and Tasmota's settings, its Wi-Fi with them. The
    # network's parameters come from the MAC, the same after a Reset 1, and the
    # coordinator would keep its lamps: ZbReset 1 resets the ZNP's own memory and
    # erases the devices' files first. Reset 1 then restarts it
    def wipe()
        # out of the house first: the mesh's number and keys are in the driver's record, which nothing below touches; and the panels told first that it
        # goes, the rest once it has left
        self.leave_house(/ -> self.wipe_rest())
    end

    def wipe_rest()
        import persist
        persist.zero()
        PairSign.safe_save("ZBBRIDGE_RELAY")
        tasmota.cmd("EspNowEnable 0")
        tasmota.cmd("EspNowPeerMac 00:00:00:00:00:00")
        tasmota.cmd("EspNowSecret2 0")
        log("ZBBRIDGE_RELAY: back to its image: the Zigbee network and the settings erased, restarting", 2)
        tasmota.cmd("ZbReset 1")
        tasmota.cmd("Reset 1")
    end

    # What is pending, in as few messages as fit `budget`, a device never split.
    # A Zigbee GROUP command makes several bulbs report within the same debounce
    # window, and the merge by address makes one JSON of them: not an edge case,
    # exactly the case the accumulator was built for. A frame of the link carries
    # 233 bytes, and three bulbs pass it.
    static def send_batched(pending, budget, send)
        import json
        var empty = size('{"ZbReceived":{}}')
        var batch = {}
        var used = empty
        for addr: pending.keys()
            # the device's entry, and the comma before it
            var need = size(json.dump({addr: pending[addr]})) - 1
            if size(batch) > 0 && used + need > budget
                send(json.dump({"ZbReceived": batch}))
                batch = {}
                used = empty
            end
            if used + need > budget
                log("ZBBRIDGE_RELAY: the report of " + addr + " is " + str(need) + " bytes and does not fit in " + str(budget) + ", dropped", 2)
                continue
            end
            batch[addr] = pending[addr]
            used += need
        end
        if size(batch) > 0  send(json.dump({"ZbReceived": batch})) end
    end

    # One message to the panels that hear this bridge, now, over the mesh: a frame to each, which must fit its room (node_host.be)
    def send_text(msg)
        NodeHost.send_text(self, msg)
    end

    # The panels this bridge's events go to over the mesh, by their numbers: those that commanded it lately, which include the ones that keep it as the
    # bridge of the house's words (listen), and those that show its devices (their marks) (node_host.be)
    def listeners()
        return NodeHost.listeners(self)
    end

    # A message to the NSPanel through the queue: the
    # frames of what Z2T said, in the order it said them, FRAME_BURST at once and
    # then one each FRAME_GAP_MS. `event` is a map, or a text already serialised
    # (a batch of reports). The `key` of a ZbInfo is its device's address: said
    # again while the first waits (the NSPanel asks for its map again while it is
    # short), it takes the first's place in the queue, with what Z2T knows now,
    # and the queue never holds a device twice. Others have no key.
    def emit(key, event)
        import json
        var f = [key, isinstance(event, map) ? json.dump(event) : event]
        var waiting = key != nil ? self.queued.find(key) : nil
        if waiting != nil
            waiting[1] = f[1]
        else
            self.out.push(f)
            if key != nil  self.queued[key] = f end
            if size(self.out) > ZbBridgeRelay.OUT_MAX
                var old = self.out[0]
                self.out.remove(0)
                if old[0] != nil  self.queued.remove(old[0]) end
                log("ZBBRIDGE_RELAY: " + str(ZbBridgeRelay.OUT_MAX) + " frames waiting for the NSPanel, the oldest dropped", 2)
            end
        end
        self.drain()
    end

    # What the credit lets go, and a timer for the next credit while there is
    # more waiting or the credit is not back
    def drain()
        while size(self.out) > 0 && self.credit > 0
            var f = self.out[0]
            self.out.remove(0)
            if f[0] != nil  self.queued.remove(f[0]) end
            self.credit -= 1
            self.send_text(f[1])
        end
        if (size(self.out) > 0 || self.credit < ZbBridgeRelay.FRAME_BURST) && !self.gap_timer
            self.gap_timer = true
            tasmota.set_timer(ZbBridgeRelay.FRAME_GAP_MS, / -> self.credit_back(), "zbbridge_relay_frames")
        end
    end

    def credit_back()
        self.gap_timer = false
        if self.credit < ZbBridgeRelay.FRAME_BURST  self.credit += 1 end
        self.drain()
    end

    # actually sends to the NSPanel -- only called by the debounce timer, never
    # directly from the ZbReceived rule. `pending` is a map {address -> attributes}
    # accumulated by forward() (merged by address, not overwritten), serialised to
    # JSON only here, when actually sending.
    # The event goes as an EVENT-type frame: the driver on the other side hands
    # the JSON straight to the rules engine, so it lands on the SAME
    # `ZbReceived` rule a Zigbee2Tasmota of its own would raise. No
    # wrapping in a command -- command dispatch costs ~8ms and blocks the main
    # loop (measured). Through the queue
    # (emit): a batch that is more than FRAME_BURST frames goes paced.
    def send_now()
        if self.pending == nil || size(self.pending) == 0  return end
        var pending = self.pending
        self.pending = nil
        if self.house != nil  self.house.state.flood(pending) end
        ZbBridgeRelay.send_batched(pending, self.frame_budget(), / m -> self.emit(nil, m))
    end

    # the IEEE of a device, by the key Z2T gives it in a report (its short address), or nil
    def ieee_of(key)
        import global
        if !global.contains("ZbBridgeDiscovery") return nil end
        var z = global.ZbBridgeDiscovery.coordinator()
        if z == nil return nil end
        var d = z.find(key)
        return d != nil ? global.ZbBridgeDiscovery.ieee(d) : nil
    end

    # What the panels call a device by: its IEEE, which is the same whatever bridge's network it is on, where a short address is of one network only and
    # two bridges give the same one to two devices. The key as Z2T said it when Z2T does not know it
    def id_of(addr)
        var ieee = self.ieee_of(addr)
        return ieee != nil ? ieee : addr
    end

    # a device's state asked of it: its report comes back as any report does
    # a marked device asked for its state: false, and nothing sent, while Zigbee has not started, for the read would be answered "Zigbee not started"
    # and lost (seen on the bench: a bridge just started read the lamps its panels marked before its coordinator was up); the house's state asks again
    def read_state(ieee)
        import global
        if !global.contains("zigbee") || global.zigbee.started() != true return false end
        tasmota.cmd('ZbSend {"Device":"' + ieee + '","Read":{"Power":true}}', true)
        return true
    end

    def forward(value, trigger, payload)
        # `payload` comes as a Berry map, the JSON Tasmota's rules engine parsed, not as a string, and is serialised again to be sent.
        #
        # Only the fields the panels read go (Power, Dimmer, Hue, Sat, CT, Reachable, and the keys below), not the whole ZbReceived, which also
        # carries Device, Endpoint, LinkQuality and more that nothing on the other side reads: the message stays small, and quick to build and send.
        var recv = payload.find("ZbReceived")
        if recv == nil  return end
        # the devices that have a driver (zbbridge_drivers.be) have their own words in it,
        # which nothing below reads: the host takes them, and what it says goes as its own event
        if self.drivers != nil  self.drivers.on_received(recv) end
        # the alarm hears every report of its sensors, whatever the panel's pages read of them: a humidity has none of
        # the keys below, and is still a notification's condition
        if self.alarm != nil
            for addr: recv.keys()  self.alarm.heard(addr, recv[addr]) end
        end
        var filtered = {}
        for addr: recv.keys()
            var attrs = recv[addr]
            var keep = {}
            # a device a driver has is the driver's to speak for: its channels' raw on and off would fight the state the
            # driver says (a switch of two that opens a window)
            var owned = self.drivers != nil && self.drivers.owns(attrs.find("Device", addr))
            if attrs.find("Power") != nil && !owned  keep["Power"] = attrs["Power"] end
            if attrs.find("Dimmer") != nil  keep["Dimmer"] = attrs["Dimmer"] end
            if attrs.find("Hue") != nil  keep["Hue"] = attrs["Hue"] end
            if attrs.find("Sat") != nil  keep["Sat"] = attrs["Sat"] end
            if attrs.find("CT") != nil  keep["CT"] = attrs["CT"] end
            if attrs.find("Reachable") == false  keep["Reachable"] = false end
            # what our pages need besides the state: the model, read
            # during a pairing, and the answers of the group cluster -- AddGroup,
            # RemoveGroup and GetGroup, with their status and capacity
            for k: ZbBridgeRelay.EXTRA_KEYS
                if attrs.find(k) != nil  keep[k] = attrs[k] end
            end
            # a sensor's state too
            for k: ZbBridgeRelay.SENSOR_KEYS
                if attrs.find(k) != nil  keep[k] = attrs[k] end
            end
            # a device goes only with one of these fields: a bulb sends bursts of raw attribute reports (a manufacturer's cluster, such as
            # "FC11") that carry none, and each would be an empty send (`{"ZbReceived":{"0xXXXX":{}}}`) filling the queue
            if size(keep) == 0  continue end
            # A channel of a switch of several reports from its own endpoint, and Z2T sends each endpoint
            # its own message: one of 2 to 8 goes under its own key, with the address and the endpoint the NSPanel finds
            # the channel by, so that the merge below keeps both. A lamp's endpoint is 1, or 11 on a Hue, and the Green
            # Power one 242: theirs go as they did
            var ep = attrs.find("Endpoint")
            var e = ep != nil ? int(ep) : 1
            var dev = self.id_of(attrs.find("Device", addr))
            if e >= 2 && e <= ZbBridgeRelay.CHANNEL_MAX
                keep["Device"] = dev
                keep["Endpoint"] = e
                filtered[dev + "/" + str(e)] = keep
            else
                filtered[dev] = keep
            end
        end
        if size(filtered) == 0  return end
        # Debounce: a bulb sometimes sends two ZbReceived very close together
        # (~230ms), which would make two near-simultaneous sends. 50ms: a longer
        # window (300ms) does not make the panel feel any faster.
        #
        # ACCUMULATES by address (map), does not overwrite: a single value is
        # right for "the SAME bulb reported twice" (only the latest state matters
        # anyway), but WRONG for "a Zigbee GROUP command makes SEVERAL different
        # bulbs report almost together", where it would drop every bulb but the
        # last within the 50ms window. Merging by address solves both: same bulb twice = its most recent
        # entry overwrites the previous (right behaviour, preserved); different
        # bulbs = each keeps its own key, none is lost.
        #
        # And by attribute within a device: a bulb reports
        # Power and then Dimmer in two messages within the window, and replacing its
        # whole entry would drop the Power.
        if self.pending == nil  self.pending = {} end
        for addr: filtered.keys()
            var into = self.pending.find(addr)
            if into == nil
                self.pending[addr] = filtered[addr]
            else
                for k: filtered[addr].keys()  into[k] = filtered[addr][k] end
            end
        end
        tasmota.remove_timer("zbbridge_relay_send")
        tasmota.set_timer(50, / -> self.send_now(), "zbbridge_relay_send")
    end

    # The rest of what the NSPanel's pages need from the network:
    # the announce and the interview (ZbState), the answers to writes (ZbResponse)
    # and what Z2T knows of each device (ZbInfo). Each is cut to the keys the
    # other side reads -- in `direct` a message carries at most 233 bytes -- and
    # goes through the queue (emit), one frame each: none of these merge. A ZbInfo
    # of many devices, the NSPanel's map of the network, is a frame a device, and
    # goes paced.
    static def pick(m, keys)
        var out = {}
        for k: keys
            if m.find(k) != nil  out[k] = m[k] end
        end
        return out
    end

    # the bridge's clock at the boot: kept across a restart, or none yet (node_host.be)
    def time_boot()
        NodeHost.time_boot(self)
    end

    # An event to the panels at once, whatever waits in the queue: what the alarm, the drivers and the time say (the first two keep a queue and a gap
    # of their own). What Z2T said goes through emit()
    def send_event(event)
        NodeHost.send_event(self, event)
    end

    # The most one event carries: an ESP-NOW frame's, and what a frame of the mesh to each panel that hears this bridge carries, when it is less
    # (node_host.be)
    def frame_budget()
        return NodeHost.frame_budget(self)
    end

    def forward_state(value, trigger, payload)
        var s = payload.find("ZbState")
        if !isinstance(s, map)  return end
        var status = s.find("Status")
        if status == 30
            if self.drivers != nil  self.drivers.announced(s) end
            # a device back on the network is not one the house removed
            if self.house != nil && s.contains("IEEEAddr")  self.house.state.back(str(s["IEEEAddr"])) end
            self.emit(nil, {"ZbState": ZbBridgeRelay.pick(s, ["Status", "IEEEAddr", "ShortAddr"])})
        elif status == 33
            # a device a driver has is described to the panel by it, in the interview's place
            if self.drivers != nil && self.drivers.interview(s)  return end
            # the clusters the pages read of an endpoint, and no more:
            # the whole list of a device with 13 or more passed the
            # 233 bytes of a direct frame, and its interview was lost
            var st = ZbBridgeRelay.pick(s, ["Status", "Device", "Endpoint", "ProfileId", "DeviceId", "InClusters"])
            var kept = []
            for c: st.find("InClusters", [])
                if ZbBridgeRelay.CLUSTERS.find(int(str(c))) != nil  kept.push(c) end
            end
            st["InClusters"] = kept
            if st.contains("Device")  st["Device"] = self.id_of(st["Device"]) end
            self.emit(nil, {"ZbState": st})
        elif status == 20 || status == 21 || status == 22
            # pairing opened and closed
            self.emit(nil, {"ZbState": {"Status": status}})
        elif status == 50
            # the ZNP's version at boot: the Z-Stack the image carries goes in when the CC2652P runs another
            self.coord_check(s)
        elif status == 99
            # Z2T gave up: with the image's Z-Stack in the chip, the likely cause is a PAN ID another coordinator in reach has
            # ("Failed to start in coordinator mode, try changing PanID"); a Z2T that gave up takes no command, and secure_network
            # restarts the bridge once for the next boot to draw it (identity_at_boot)
            if self.coord_rev == ZbBridgeRelay.COORD_REVISION  self.zb_aborted = true end
        elif status == 0
            # the coordinator started: a restart asked for its identity is behind
            import persist
            if persist.contains("zb_identity_restart")
                persist.remove("zb_identity_restart")
                ZbBridgeRelay.persist_save()
            end
        end
    end

    def forward_response(value, trigger, payload)
        var r = payload.find("ZbResponse")
        if !isinstance(r, map)  return end
        var said = ZbBridgeRelay.pick(r, ["Device", "Endpoint", "Command", "Status"])
        if said.contains("Device")  said["Device"] = self.id_of(said["Device"]) end
        self.emit(nil, {"ZbResponse": said})
    end

    def forward_info(value, trigger, payload)
        var info = payload.find("ZbInfo")
        if !isinstance(info, map)  return end
        for addr: info.keys()
            var d = info[addr]
            if !isinstance(d, map)  continue end
            if self.house != nil  self.house.devices.heard(d) end
            # a sensor's zone type and last status, and its battery, which Z2T keeps of it
            var said = ZbBridgeRelay.pick(d, ["Device", "IEEEAddr", "ModelId", "Config", "Power", "Reachable", "ZoneType", "ZoneStatus", "BatteryPercentage"])
            var dev = d.contains("IEEEAddr") ? str(d["IEEEAddr"]) : self.id_of(d.find("Device", addr))
            said["Device"] = dev
            self.emit(addr, {"ZbInfo": {dev: said}})
        end
    end

    # A ping the panel sent, answered: the lamp is there, and one the panel had
    # with no communication shows what it last said again. The command's
    # own answer, {"ZbPing":"Done"}, reaches this rule too, and is not one.
    def forward_ping(value, trigger, payload)
        var p = payload.find("ZbPing")
        if !isinstance(p, map) || !p.contains("IEEEAddr")  return end
        self.emit(nil, {"ZbPing": {"Device": str(p["IEEEAddr"]), "IEEEAddr": p["IEEEAddr"]}})
    end

    # The house's MQTT, as every node takes it (house_mqtt.be, node_host.be): this bridge on the house's broker. The discovery here is the Zigbee
    # devices' (zbbridge_discovery.be), with the hours its battery devices' sensors wait for word, set before the broker's settings restart Tasmota
    def apply_mqtt(m)
        if self.discovery != nil
            self.discovery.set_on(m["discovery"] != false)
            self.discovery.set_expire(m["expire"])
        end
        NodeHost.apply_mqtt(self, m)
    end

    # --- the button's window -----------------------------------------------

    # The window in which a panel may add this bridge to its house, the button that opens it and the LED that says it is open are every node's
    # (node_host.be). What the window's announcement says of a bridge is the Zigbee channel its network is on, 0 with the coordinator not up
    def window_open()
        return NodeHost.window_open(self)
    end

    def button_held()
        NodeHost.button_held(self)
    end

    def open_window(ms, by_button)
        NodeHost.open_window(self, ms, by_button)
    end

    def close_window(driver_closed)
        NodeHost.close_window(self, driver_closed)
    end

    def identify()
        NodeHost.identify(self)
    end

    def announce()
        return str(ZbBridgeRelay.zigbee_channel())
    end

    # the window closed: the room's Zigbee channel, when the panel that added this bridge chose one this network takes (plan_channel), a moment later
    def window_closed()
        if self.next_channel != nil  tasmota.set_timer(2000, / -> self.apply_channel(), "zbbridge_relay_channel") end
    end

    # the first word of the panel that adds this bridge (node_pairing.be): the room's Zigbee channel it chose, for a network with no device yet
    def guest_said(m)
        if m.contains("zigbee")  self.plan_channel(int(m["zigbee"])) end
    end

    # This bridge out of the house, the panels told first that it goes, and `then` once it has left (node_host.be)
    def leave_house(then)
        NodeHost.leave_house(self, then)
    end

    # how many devices the Zigbee network has, or 0 with the coordinator not up
    static def device_count()
        import global
        if !global.contains("zigbee") || global.zigbee.started() != true return 0 end
        return global.zigbee.size()
    end

    # the Zigbee channel the network is on, for the announcement, or 0 with the
    # coordinator not up
    static def zigbee_channel()
        import global
        if !global.contains("zigbee") || global.zigbee.started() != true return 0 end
        var c = ZbBridgeRelay.zb_config()
        return c != nil ? int(c.find("Channel", 0)) : 0
    end

    # Z2T's configuration, or nil. Its answer carries the network's key, so it is asked without a word: the leading _ keeps the
    # answer off MQTT and off the log's RESULT line, and the mute keeps the command's own lines off the log. Every ZbConfig of
    # the relay goes so (a plain one puts the key in the log at every boot)
    static def zb_config()
        var r = tasmota.cmd("_ZbConfig", true)
        var c = isinstance(r, map) ? r.find("ZbConfig") : nil
        return isinstance(c, map) ? c : nil
    end

    # The Zigbee channel the panel chose for the room, kept for when
    # the pairing is over: taken only by a network with no device yet, which forms
    # again on it. Moved under lamps, the network would leave them orphaned
    def plan_channel(c)
        import global
        import persist
        self.next_channel = nil
        if c < 11 || c > 26 || c == ZbBridgeRelay.zigbee_channel() return end
        if !global.contains("zigbee") return end
        if global.zigbee.started() != true
            # a bridge out of its box: the coordinator is not up because its Z-Stack goes in first (coord_check), and the channel is
            # kept for the network it forms after the flash, which takes it with its identity in one restart (secure_network)
            if self.coord_due && global.zigbee.size() == 0
                persist.setmember("zb_channel_wanted", c)
                ZbBridgeRelay.persist_save()
                log("ZBBRIDGE_RELAY: Zigbee channel " + str(c) + " kept for after the coordinator's flash", 2)
            end
            return
        end
        if global.zigbee.size() > 0
            log("ZBBRIDGE_RELAY: Zigbee channel " + str(c) + " asked for, and the network has devices: it stays on " +
                str(ZbBridgeRelay.zigbee_channel()), 2)
            return
        end
        self.next_channel = c
    end

    # The channel, once nothing of the pairing needs the bridge up: ZbConfig saves it and restarts the bridge, and the coordinator forms the network on
    # it. A join of the panel's network goes first
    def apply_channel()
        if self.next_channel == nil return end
        var p = self.pairing
        if p != nil && p.joining != nil
            tasmota.set_timer(5000, / -> self.apply_channel(), "zbbridge_relay_channel")
            return
        end
        var c = self.next_channel
        self.next_channel = nil
        log("ZBBRIDGE_RELAY: the Zigbee network forms again on channel " + str(c) + ", as the NSPanel chose", 2)
        # the network forms again here anyway, so an identity made of the chip's address is replaced in the same restart (secure_network)
        var fix = ZbBridgeRelay.fresh_identity(ZbBridgeRelay.zb_config())
        if ZbBridgeRelay.device_count() != 0  fix = "" end
        tasmota.cmd("_ZbConfig {\"Channel\":" + str(c) + (fix != "" ? "," + fix : "") + "}", true)
    end

    # The identity of a Zigbee network the Z2T formed on its own, which the relay replaces by a drawn one while the network has no
    # device: the key made of the chip's address, the same 64 bits in both halves of it, which the
    # Wi-Fi and the beacons say aloud; and the PAN ID and the extended PAN ID made of the Wi-Fi's MAC
    # (ZigbeeInit: the PAN ID is the MAC's first 14 bits, the extended one 0xCCCCCCCC and the MAC's first 4 bytes). At our bridges'
    # first boot the radio is held with no network, so the MAC reads as zero and every bridge is 0x0001 / 0xCCCCCCCC00000000; and
    # the bridges of a batch share those first bytes anyway. Two of them within reach cannot both form their network on a channel
    # ("Failed to start in coordinator mode, try changing PanID"). Returns the inside of the ZbConfig's
    # JSON that replaces what is derived (a zero key is the one ZbConfig draws itself), or "" with nothing to replace
    static def fresh_identity(c)
        import crypto
        import string
        if c == nil return "" end
        var parts = []
        var e = c.find("ExtPanID")
        if (type(e) == "string" && size(e) >= 10 && string.toupper(e[0 .. 9]) == "0XCCCCCCCC") || c.find("PanID") == "0x0001"
            var b = crypto.random(2)
            # 0x0001 to 0x3FFE, the range Z2T keeps the PAN ID in; and an extended PAN ID that is not a derived one, nor empty
            var pan = ((b[0] << 8) | b[1]) % 0x3FFE + 1
            var ext = string.toupper(crypto.random(8).tohex())
            while ext == "0000000000000000" || ext == "FFFFFFFFFFFFFFFF" || ext[0 .. 7] == "CCCCCCCC"
                ext = string.toupper(crypto.random(8).tohex())
            end
            parts.push(string.format("\"PanID\":\"0x%04X\",\"ExtPanID\":\"0x%s\"", pan, ext))
        end
        var l = c.find("KeyL")
        if type(l) == "string" && l == c.find("KeyH")  parts.push("\"KeyL\":0,\"KeyH\":0") end
        return parts.concat(",")
    end

    # Once, a while after boot: a bridge whose Zigbee network has no device yet takes its key, and its PAN ID when that is derived
    # too, from the chip's random generator (ZbConfig saves and restarts the bridge), before a lamp joins, and with them the channel
    # a panel chose while the coordinator was not up (plan_channel). A pairing in hand has the bridge first: the window, a join of
    # the panel's network, the channel the panel chose, which takes the identity with it (apply_channel), and the coordinator's
    # flash. Most bridges have drawn theirs already, when the ZNP said its version (identity_at_boot); this is the one for a
    # pairing that held it there. A coordinator Z2T gave up on takes no command, ZbConfig included: with a derived PAN ID seen at
    # this boot, the bridge restarts once, for the next boot to draw it before the coordinator starts
    def secure_network(tries)
        import global
        import persist
        if !global.contains("zigbee") return end
        var up = global.zigbee.started() == true || self.zb_aborted
        var busy = !up || self.coord_due || self.window_open() || self.next_channel != nil
        var p = self.pairing
        if p != nil && p.joining != nil  busy = true end
        if busy
            if tries < ZbBridgeRelay.KEY_TRIES
                tasmota.set_timer(ZbBridgeRelay.KEY_AGAIN_MS, / -> self.secure_network(tries + 1), "zbbridge_relay_key")
            end
            return
        end
        var cfg = ZbBridgeRelay.zb_config()
        if cfg == nil && self.zb_aborted
            if self.boot_fix == nil || self.boot_fix == "" || global.zigbee.size() > 0 return end
            if persist.find("zb_identity_restart") == true
                log("ZBBRIDGE_RELAY: Z2T gave up again on a coordinator with a PAN ID made of the chip's address, after a restart for it: ZbConfig by hand", 1)
                return
            end
            persist.setmember("zb_identity_restart", true)
            if !ZbBridgeRelay.persist_save() return end
            log("ZBBRIDGE_RELAY: Z2T gave up on a coordinator with a PAN ID made of the chip's address, and takes no command now: restarting, for the next boot to draw it before the coordinator starts", 2)
            tasmota.set_timer(1000, / -> tasmota.cmd("Restart 1"), "zbbridge_relay_identity_restart")
            return
        end
        self.take_identity(cfg)
    end

    # The ZNP is up with the image's Z-Stack and Z2T has not started the coordinator yet (ZbState 50): the earliest moment the
    # network's identity can be drawn, before a coordinator with a derived PAN ID meets another one on its channel and Z2T gives
    # up. Z2T takes commands here, and its table of devices is loaded. Only a pairing that runs holds it
    # (the join of a panel's network, a channel to take): an open window that no panel has used yet is opened again by the restart
    def identity_at_boot()
        import global
        if !global.contains("zigbee") return end
        var cfg = ZbBridgeRelay.zb_config()
        self.boot_fix = ZbBridgeRelay.fresh_identity(cfg)
        var p = self.pairing
        if self.next_channel != nil || (p != nil && p.joining != nil) return end
        self.take_identity(cfg)
    end

    # What of the identity is derived, and the channel a panel chose while the coordinator was not up, in one ZbConfig that saves
    # them and restarts the bridge, while the network has no device. A network with devices keeps what it has, since a new identity
    # would leave them orphaned, and the log says so. True when it was sent
    def take_identity(cfg)
        import global
        import string
        import persist
        var fix = ZbBridgeRelay.fresh_identity(cfg)
        var want = persist.find("zb_channel_wanted")
        var ch = ""
        if want != nil && cfg != nil && int(want) != int(cfg.find("Channel", 0))  ch = "\"Channel\":" + str(int(want)) end
        if want != nil && cfg != nil
            persist.remove("zb_channel_wanted")
            ZbBridgeRelay.persist_save()
        end
        if fix == "" && ch == "" return false end
        if global.zigbee.size() > 0
            log("ZBBRIDGE_RELAY: the Zigbee network has devices: its identity and its channel stay, new ones would leave them orphaned", 1)
            return false
        end
        var parts = []
        var what = []
        if ch != ""
            parts.push(ch)
            what.push("channel " + str(int(want)))
        end
        if fix != ""
            parts.push(fix)
            if string.find(fix, "PanID") >= 0  what.push("a random PAN ID") end
            if string.find(fix, "KeyL") >= 0  what.push("a random key") end
        end
        if persist.contains("zb_identity_restart")
            persist.remove("zb_identity_restart")
            ZbBridgeRelay.persist_save()
        end
        log("ZBBRIDGE_RELAY: the Zigbee network has no device: it takes " + what.concat(" and ") + ", and the bridge restarts", 2)
        tasmota.cmd("_ZbConfig {" + parts.concat(",") + "}", true)
        return true
    end

    # --- the coordinator's Z-Stack -------------------------------------------------------------

    # The ZNP said its version at boot (ZbState 50). The CC2652P of a ZBBridge Pro comes with Sonoff's Z-Stack, which Z2T cannot
    # configure (Z2T aborts); the image carries the coordinator firmware Tasmota ships (COORD_HEX) and the flasher's
    # files, and the relay flashes it by itself, as the panel flashes the image's .tft (brain.be): a count of tries
    # in persist keeps a chip that never takes it from being flashed at every boot, and past the tries the console is told how to do
    # it by hand. The flash keeps Tasmota mute for 5 to 8 minutes, so it waits for the pairing's window and a join to be over
    def coord_check(s)
        import persist
        import path
        var rev = int(str(s.find("Revision", 0)))
        self.coord_rev = rev
        var want = ZbBridgeRelay.COORD_REVISION
        if rev == want
            if persist.contains("zb_coord_tries")
                persist.remove("zb_coord_tries")
                ZbBridgeRelay.persist_save()
            end
            # and the network's identity, before the coordinator starts
            self.identity_at_boot()
            return
        end
        if self.coord_due return end
        var hex = ZbBridgeRelay.COORD_HEX
        var runs = "the coordinator runs Z-Stack revision " + str(rev) + ", not " + str(want)
        if !path.exists(hex)
            log("ZBBRIDGE_RELAY: " + runs + ", and the file system has no " + hex + ": nothing flashed", 1)
            return
        end
        var tries = ZbBridgeRelay.coord_tries()
        if tries >= ZbBridgeRelay.COORD_TRIES
            log("ZBBRIDGE_RELAY: " + runs + ", and " + hex + " was tried " + str(tries) + " times: by hand, in the console, Br import sonoff_zb_pro_flasher as cc cc.load(\"" + hex + "\") cc.check() cc.flash()", 1)
            return
        end
        self.coord_due = true
        log("ZBBRIDGE_RELAY: " + runs + ": " + hex + " goes in, try " + str(tries + 1) + " of " + str(ZbBridgeRelay.COORD_TRIES) + ", once the pairing is over", 2)
        tasmota.remove_timer("zbbridge_relay_coord")
        tasmota.set_timer(ZbBridgeRelay.COORD_AFTER_MS, / -> self.coord_flash(0), "zbbridge_relay_coord")
    end

    # how many boots tried the image's Z-Stack: a try kept before the count was the first
    static def coord_tries()
        import persist
        return persist.find("zb_coord_auto") == ZbBridgeRelay.COORD_HEX ? int(persist.find("zb_coord_tries", 1)) : 0
    end

    # a save of persist that does not raise: true when it went through
    static def persist_save()
        import persist
        try
            persist.save()
            return true
        except .. as e, m
            log("ZBBRIDGE_RELAY: persist could not be saved: " + str(e) + " " + str(m), 1)
            return false
        end
    end

    # The flash, once nothing of the pairing needs the bridge: the flasher takes the serial and stops Z2T, writes the file and reads
    # its CRC, and the bridge restarts on it. A flash that does not go through (the BSL not answering, a bad file) restarts the
    # bridge too, for the next of the tries
    def coord_flash(tries)
        import persist
        var p = self.pairing
        if self.window_open() || (p != nil && p.joining != nil)
            if tries < ZbBridgeRelay.COORD_WAIT_TRIES
                tasmota.set_timer(ZbBridgeRelay.COORD_AGAIN_MS, / -> self.coord_flash(tries + 1), "zbbridge_relay_coord")
            else
                log("ZBBRIDGE_RELAY: the pairing kept the bridge too long: the coordinator's flash waits for the next boot", 1)
            end
            return
        end
        var hex = ZbBridgeRelay.COORD_HEX
        var n = ZbBridgeRelay.coord_tries() + 1
        persist.setmember("zb_coord_auto", hex)
        persist.setmember("zb_coord_tries", n)
        # the count is what keeps a chip that never takes the file from being flashed at every boot: with no record of it there is no flash
        if !ZbBridgeRelay.persist_save()
            log("ZBBRIDGE_RELAY: the count of the coordinator's tries could not be saved: nothing flashed", 1)
            return
        end
        log("ZBBRIDGE_RELAY: flashing the coordinator with " + hex + ", try " + str(n) + ": the bridge is mute for 5 to 8 minutes", 2)
        var ok = false
        try
            import sonoff_zb_pro_flasher as cc
            cc.load(hex)
            cc.check()
            cc.flash()
            # flash() keeps its exceptions, and says them by dropping the check
            ok = cc.file_checked == true
        except .. as e, m
            log("ZBBRIDGE_RELAY: the coordinator's flash raised " + str(e) + ": " + str(m), 1)
        end
        if ok
            log("ZBBRIDGE_RELAY: the coordinator flashed with " + hex + ": restarting, for Z2T to start it", 2)
        else
            log("ZBBRIDGE_RELAY: the coordinator's flash did not go through: restarting for the next try, of " + str(ZbBridgeRelay.COORD_TRIES), 1)
        end
        tasmota.set_timer(2000, / -> tasmota.cmd("Restart 1"), "zbbridge_relay_coord_restart")
    end

    # --- the boot -------------------------------------------------------------------------

    # a bridge with no network saved holds its radio with no network and no access point, and opens its window (node_host.be)
    def radio_at_boot()
        NodeHost.radio_at_boot(self)
    end

    # The key of the Zigbee network looked at, a while after the boot (secure_network), and everything said again once the house is in step (again_after_boot).
    # The mesh comes up by itself (mesh_cmd.be, house_mesh.be)
    def boot()
        tasmota.set_timer(ZbBridgeRelay.KEY_AFTER_MS, / -> self.secure_network(0), "zbbridge_relay_key")
        tasmota.set_timer(NodeHost.AGAIN_MS, / -> self.again_after_boot(NodeHost.AGAIN_TRIES), "zbbridge_relay_again")
    end
end
