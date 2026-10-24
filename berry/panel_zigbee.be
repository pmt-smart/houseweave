# panel_zigbee.be -- the Zigbee network as our pages see it.
#
# What reaches us from Zigbee2Tasmota, as its own source writes it
# (firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_23_zigbee_8_parsers.ino,
# _2a_devices_impl.ino, _5_2_converters.ino):
#
#   ZbState Status 30   a device announced itself: "IEEEAddr" and "ShortAddr"
#   ZbState Status 33   one endpoint of its interview: "Device" (short),
#                       "Endpoint", "ProfileId", "DeviceId", "InClusters", all hex
#   ZbReceived          attributes, keyed by the short address: Power,
#                       Reachable (false when a ping went unanswered), ModelId
#   ZbResponse          the answer to a write: "Command" "0006_04", "Status" 0,
#                       or 134 for UNSUPPORTED_ATTRIBUTE
#   ZbInfo              what Z2T knows of a device: IEEEAddr, ModelId, Config
#                       ("L01.5"), the last Power, Reachable; one message each
#   ZbPing              a ping answered: "Device" (short) and "IEEEAddr". The
#                       command's own answer is the word "Done", not a map
#   ZbReceived, again   the group cluster's answers (_6_0_commands.ino):
#                       "AddGroup" and "AddGroupStatus", "RemoveGroup" and
#                       "RemoveGroupStatus", and for GetAllGroups "GetGroup": [...]
#
# The groups under the zones and the buttons are kept here too:
# the store says what each membership needs (group_work), and this sends it, one
# command at a time and never during a pairing, and hands the answer back.
#
# There is no message for a device that left, and none for an interview that
# finished: a device is interviewed when its first endpoint's descriptor arrives.
#
# The panel keys devices by IEEE, the one address that does not change,
# and reports come by short address, which a rejoin changes. So the map
# from one to the other lives here, fed by every message that carries both,
# and seeded at boot: from the zigbee module when the coordinator is ours, or
# by asking ZbInfo through the bridge when it is on the other side.
#
# Loaded with load(), after panel_store.be and panel_ui.be.

#@ solidify:PanelZigbee
class PanelZigbee
    # the Green Power profile: an endpoint every coordinator-side stack adds, never the device's own
    static var GREEN_POWER = 0xA1E0
    # the answer to a write of an attribute of the on/off cluster
    static var WRITE_ONOFF = "0006_04"
    # the groups' pace: how often it looks, how long an answer may take, how
    # many tries a leaving member gets before its group moves, and how often
    # failed joins are tried again and one device is asked its groups
    static var GROUP_TICK_MS = 2000
    static var ANSWER_MS = 8000
    static var LEAVE_TRIES = 3
    static var RETRY_MS = 600000
    static var RECONCILE_MS = 300000
    # between two pings: a burst of them is a burst on the network
    static var PING_GAP_MS = 250
    # the map of the network asked for again when the link comes back, at most
    # this often, and a moment after it came up, for the other side to settle
    # below this saturation, of Z2T's 254, a lamp's colour is a white for its icon
    static var PALE_SAT = 50
    static var SEED_MS = 300000
    static var SEED_DELAY_MS = 2000
    # A map that comes short of the bridge's network: Z2T says every device in one pass, and what
    # reaches this side of a burst is what the link's queue holds. SEED_CHECK_MS after a seed, the map is looked at, and the
    # devices of the panel that are not in it are asked one by one, SEED_GAP_MS apart; a map still short is looked at again, SEED_ROUNDS
    # times at most, and left to the next link. A report from a short address the map does not have asks for that device, once in
    # SHORT_ASK_MS, for at most SHORT_ASKS addresses at a time
    static var SEED_CHECK_MS = 5000
    static var SEED_GAP_MS = 120
    static var SEED_ROUNDS = 4
    static var SHORT_ASK_MS = 30000
    static var SHORT_ASKS = 16

    var store
    var ui
    var plan      # PanelPlanView, or nil on a project without a plan
    var run       # f(effects): what the views answer, carried out by brain
    var send      # f(command): the Zigbee bridge's send
    var ieee_of   # short address, as a number (0x5ADF) -> IEEE "0x00124B0000E00001"
    var startup   # short address, as a number -> the IEEE whose StartUpOnOff write awaits its answer
    var to_refresh      # devices a zone's screen has not drawn since they reported
    var refresh_armed   # the redraw that draws them is on its way
    var seeded_at       # when the map of the network was last asked for, or nil
    var seed_round      # how many times the map was found short since the seed that went out last
    var asks            # the devices waiting to be asked their ZbInfo, in order: an IEEE, or a short address as Z2T writes it
    var whole           # IEEE -> true: the asks of a whole seed, which go even for a device the map has, for its state
    var asking          # the asks are going out, one every SEED_GAP_MS
    var asked_short     # short address, as a number -> when it was last asked for, for what the map does not have
    var shared_levels   # percent -> the slider positions [percent, 50, 50] that every lamp at that brightness shares (note_level)
    var grouping        # the groups' upkeep has started
    var inflight  # the group command waiting for its answer: [op, ieee, zid, sent at], or nil
    var tries     # "op ieee zid" -> how many times it went unanswered
    var retried_at    # when failed joins were last tried again
    var asked_at      # when a device was last asked its groups
    var asked_next    # which device of the Zigbee ones is asked next
    var pings     # the devices waiting for their ping, in order
    var mode_seen     # the transport's mode as mode_is last saw it, or nil
    var thermostat       # the thermostats' state (panel_thermostat.be), or nil
    var cover            # the blinds' state (panel_cover.be), or nil
    var lamp             # the lamps' settings (panel_lamp_settings.be), or nil
    var alarm            # the alarm as the panel keeps it (panel_alarm.be), or nil

    def init(store, ui, plan, run, send)
        self.store = store
        self.ui = ui
        self.plan = plan
        self.run = run
        self.send = send
        self.ieee_of = {}
        self.startup = {}
        self.to_refresh = {}
        self.refresh_armed = false
        self.inflight = nil
        self.tries = {}
        self.retried_at = 0
        self.asked_at = 0
        self.asked_next = 0
        self.pings = []
        self.seeded_at = nil
        self.seed_round = 0
        self.asks = []
        self.whole = {}
        self.asking = false
        self.asked_short = {}
        self.shared_levels = {}
        self.grouping = false
        self.mode_seen = nil
    end

    # "0x5adf" and "0x5ADF" are one address
    static def norm(a)
        import string
        a = str(a)
        if size(a) > 2 && (a[0 .. 1] == "0x" || a[0 .. 1] == "0X") return "0x" + string.toupper(a[2 ..]) end
        return string.toupper(a)
    end

    # "0x010D" or 269: the number
    static def num(v)
        if type(v) == "int" return v end
        return int(str(v))
    end

    # An IEEE, "0x00124B0000E00001", as a bridge of the house names a device to the panels: 16 hex digits, which no short address has
    static def is_ieee(a)
        return type(a) == "string" && size(a) == 18 && (a[0 .. 1] == "0x" || a[0 .. 1] == "0X")
    end

    # A short address, "0x5ADF" as Z2T writes one, or 23263 as the zigbee module
    # has it: the number, which the maps key it by, where a text of it cost the
    # heap a string; nil for what is not one, like a friendly name
    static def short(a)
        import string
        if type(a) == "int" return a end
        var s = str(a)
        if size(s) < 3 || string.tolower(s[0 .. 1]) != "0x" return nil end
        return int(s)
    end

    # The colour a lit lamp shows on its icon,
    # as RGB565, from what a report says of it: its hue and saturation, or its
    # xy, at full brightness. A white -- a colour temperature, or a colour this
    # pale -- is nil: the theme's own "on" keeps its contrast on the card. A report
    # that says nothing of colour is false, and leaves the one kept as it was. Hue
    # and saturation come in one report when they change together; one alone says
    # nothing here.
    static def color_of(attrs)
        var mode = attrs.find("ColorMode")
        if mode == 2 return nil end
        if attrs.contains("Hue") && attrs.contains("Sat") && mode != 1
            return PanelZigbee.hs565(int(attrs["Hue"]), int(attrs["Sat"]))
        end
        if attrs.contains("X") && attrs.contains("Y") && mode != 0
            return PanelZigbee.xy565(int(attrs["X"]), int(attrs["Y"]))
        end
        if attrs.contains("CT") return nil end
        return false
    end

    # hue and saturation, both of 254, at full brightness
    static def hs565(hue, sat)
        if sat < PanelZigbee.PALE_SAT return nil end
        var h = (hue * 360 / 254) % 360
        var c = 255 * sat / 254
        var t = (h * 1000 / 60) % 2000 - 1000
        if t < 0 t = -t end
        var x = c * (1000 - t) / 1000
        var m = 255 - c
        var rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
        return PanelZigbee.rgb565(rgb[0] + m, rgb[1] + m, rgb[2] + m)
    end

    # CIE xy, each of 65535, to sRGB with its brightest channel full (the wide
    # gamut matrix of the Zigbee lamps' own documentation)
    static def xy565(X, Y)
        import math
        if Y == 0 return nil end
        var x = X / 65535.0
        var y = Y / 65535.0
        var bx = x / y
        var bz = (1.0 - x - y) / y
        var lin = [bx * 1.656492 - 0.354851 - bz * 0.255038,
                   -bx * 0.707196 + 1.655397 + bz * 0.036152,
                   bx * 0.051713 - 0.121364 + bz * 1.011530]
        var top = 0.0
        for v: lin if v > top top = v end end
        if top <= 0 return nil end
        var out = []
        for v: lin
            var n = v > 0 ? v / top : 0.0
            out.push(n <= 0.0031308 ? 12.92 * n : 1.055 * math.pow(n, 1 / 2.4) - 0.055)
        end
        var hi = 0.0
        var lo = 1.0
        for v: out
            if v > hi hi = v end
            if v < lo lo = v end
        end
        if hi <= 0 || (hi - lo) / hi < PanelZigbee.PALE_SAT / 254.0 return nil end
        return PanelZigbee.rgb565(int(out[0] * 255 + 0.5), int(out[1] * 255 + 0.5), int(out[2] * 255 + 0.5))
    end

    static def rgb565(r, g, b)
        return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)
    end

    # A device's model as it may be shown: printable ASCII only. It comes from
    # the device, and Tasmota's JSON passes any byte above 0x7F as it is: three
    # 0xFF in a model would end the instruction that draws it on the glass, and
    # what followed would run as instructions of its own.
    static def printable(v)
        import string
        var s = v != nil ? str(v) : ""
        var out = ""
        for i: 0 .. size(s) - 1
            var c = string.byte(s[i])
            if c >= 0x20 && c < 0x7F out += s[i] end
        end
        return out
    end

    # A rejoin gives a device a new short address: the old one goes, or a lamp
    # that took it later would be reported as this one.
    def learn(short, ieee)
        # a device named by its IEEE is kept under it: what counts the map counts it, and a short address that was it goes
        var s = PanelZigbee.is_ieee(short) ? PanelZigbee.norm(short) : PanelZigbee.short(short)
        if s == nil return end
        var id = PanelZigbee.norm(ieee)
        var stale = []
        for k: self.ieee_of.keys()
            if k != s && self.ieee_of[k] == id stale.push(k) end
        end
        for k: stale self.ieee_of.remove(k) end
        self.ieee_of[s] = id
    end

    # The IEEE behind a short address as a message gives it, or nil: a device that
    # joined again, or a report before the map was read, waits for the next
    # announce or ZbInfo
    def ieee_by(short)
        if PanelZigbee.is_ieee(short) return PanelZigbee.norm(short) end
        var s = PanelZigbee.short(short)
        if s == nil return nil end
        return self.ieee_of.find(s)
    end

    # the short address the network last gave a device, or nil
    def short_of(ieee)
        for k: self.ieee_of.keys()
            if self.ieee_of[k] == ieee return k end
        end
        return nil
    end

    def emit(effects)
        if self.run != nil && size(effects) > 0 self.run(effects) end
    end

    # anything the bridge heard; what is not ours is let go
    def on_event(payload)
        if !isinstance(payload, map) return end
        if payload.contains("ZbState") self.on_state(payload["ZbState"]) end
        if payload.contains("ZbInfo") self.on_info(payload["ZbInfo"]) end
        if payload.contains("ZbReceived") self.on_received(payload["ZbReceived"]) end
        if payload.contains("ZbResponse") self.on_response(payload["ZbResponse"]) end
        if payload.contains("ZbPing") self.on_ping(payload["ZbPing"]) end
        if payload.contains("ZbDriver") self.on_driver(payload["ZbDriver"]) end
        if payload.contains("ZbAlarm") && self.alarm != nil self.emit(self.alarm.on_message(payload["ZbAlarm"])) end
    end

    # What the bridge's drivers say of their devices, a message a device: a
    # description takes the place of an interview, and the rest is the kind's own, which for a
    # thermostat is the state PanelThermostat keeps, and for a blind the one PanelCover keeps
    def on_driver(m)
        if !isinstance(m, map) return end
        for ieee: m.keys()
            var secs = m[ieee]
            if !isinstance(secs, map) continue end
            var id = PanelZigbee.norm(ieee)
            if secs.contains("d")
                # the driver of a switch of two channels keeps what it was told, before the pairing takes it
                var dv = self.ui.provider_of("driver", nil)
                if dv != nil  dv.described(id, secs["d"]) end
                self.emit(self.ui.pair_described(id, secs["d"]))
            end
            if self.thermostat != nil self.thermostat.on_driver(id, secs) end
            if self.cover != nil self.cover.on_driver(id, secs) end
        end
    end

    # A device answered its ping: it is there. One with no communication shows
    # what it last said again, the plan's cards and a zone's
    # screen alike -- and is read, for what it says now: what it last said is the state from before
    # a command whose report was lost, and a card that keeps it sends the same word at every tap.
    # The read is not a command sent again, which is ruled out:
    # it changes nothing on the lamp, and the report that comes back is the one that was missing.
    def on_ping(p)
        if !isinstance(p, map) || !p.contains("IEEEAddr") return end
        if p.contains("Device") self.learn(p["Device"], p["IEEEAddr"]) end
        for id: self.reachable(PanelZigbee.norm(p["IEEEAddr"])) self.read_power(id) end
    end

    # A device of another room held, or let go, by the gate (panel_gate.be): the bridge that owns it is not ready, and its buttons are not there. It is marked as with no
    # communication, and the tap does nothing, until the gate lifts it: then it is as the house last said, and a report corrects it
    def gate(ieee, off)
        for id: self.store.channels_of(ieee)
            var held = self.plan != nil ? self.plan.doubt : (self.ui != nil ? self.ui.doubt : nil)
            if held == nil continue end
            if off
                held[id] = "gated"
            elif held.find(id) == "gated"
                held.remove(id)
            end
            self.refresh_later(id)
        end
    end

    # a device of ours that is there: one marked with no communication is not any more. The ids
    # that were, for the read
    def reachable(ieee)
        var back = []
        # the device answers for all its channels
        for id: self.store.channels_of(ieee)
            var was = false
            if self.plan != nil
                was = self.plan.on_answered(id)
            elif self.ui != nil && self.ui.doubt.contains(id)
                self.ui.doubt.remove(id)
                was = true
            end
            if was
                self.refresh_later(id)
                back.push(id)
            end
        end
        return back
    end

    # the state a switching device has now, asked of it: its report comes back by on_received. A sensor,
    # a thermostat or a blind has no Power to read, and what they say comes by their own words
    def read_power(id)
        if self.send == nil || !self.store.is_zigbee_actuator(self.store.find_device(id)) return end
        self.send('ZbSend {' + self.store.zb_address(id) + ',"Read":{"Power":true}}')
    end

    # The device a report of an endpoint is about: the channel of that endpoint, for a device of several,
    # or the device itself
    def channel(ieee, ep)
        if ep == nil return ieee end
        var id = ieee + "/" + str(PanelZigbee.num(ep))
        return self.store.find_device(id) != nil ? id : ieee
    end

    def on_state(s)
        if !isinstance(s, map) return end
        var status = s.find("Status")
        if status == 30 && s.contains("IEEEAddr") && s.contains("ShortAddr")
            # a join, or a lamp coming back with the power: both are an announce
            self.learn(s["ShortAddr"], s["IEEEAddr"])
            self.emit(self.ui.pair_announced(PanelZigbee.norm(s["IEEEAddr"])))
        elif status == 33 && s.contains("Device")
            var ieee = self.ieee_by(s["Device"])
            if ieee == nil return end
            var profile = PanelZigbee.num(s.find("ProfileId", "0x0000"))
            if profile == PanelZigbee.GREEN_POWER return end
            var clusters = []
            for c: s.find("InClusters", []) clusters.push(PanelZigbee.num(c)) end
            self.emit(self.ui.pair_interviewed(ieee, profile, PanelZigbee.num(s.find("DeviceId", "0x0000")),
                                               clusters, PanelZigbee.num(s.find("Endpoint", "0x01"))))
        end
    end

    # What Z2T knows of each device: its addresses, its model and the channels its Config says it has. A device the panel does not have is not taken from
    # here: a device of the house comes into a panel by its search, or by Existing device, as its bridge's
    def on_info(info)
        if !isinstance(info, map) return end
        var saved = false
        for key: info.keys()
            var d = info[key]
            if !isinstance(d, map) || !d.contains("IEEEAddr") continue end
            # the short address of a device the panel has: a bridge's network is the house's, and the rest of it is not this panel's
            if self.store.find_device(PanelZigbee.norm(d["IEEEAddr"])) != nil  self.learn(d.find("Device", key), d["IEEEAddr"]) end
            # a sensor with an IAS zone is a door, a window, water, smoke or presence: no numeric condition for the alarm
            if self.alarm != nil && d.contains("ZoneType")  self.alarm.zoned[PanelZigbee.norm(d["IEEEAddr"])] = true end
            if self.know(PanelZigbee.norm(d["IEEEAddr"]), PanelZigbee.printable(d.find("ModelId", "")), d.find("Config", [])) saved = true end
        end
        if saved self.emit([["save"]]) end
        # The last state it knows and the model, through the same path as a report,
        # but not its Reachable: Z2T starts every device as not reachable until it
        # hears from it, and a lamp reports at most once an hour, so at boot ZbInfo
        # marked every lamp as not answering, and a zone that was on could not be
        # switched off from its card.
        var known = {}
        for key: info.keys()
            var d = info[key]
            if !isinstance(d, map) continue end
            var attrs = {}
            for k: d.keys()
                if k != "Reachable" attrs[k] = d[k] end
            end
            known[key] = attrs
        end
        self.on_received(known)
    end

    # a device the panel has: the channels its Config says it has beyond the ones the panel knows. True when one was added
    def know(ieee, model, config)
        if self.store.find_device(ieee) == nil return false end
        return self.know_channels(ieee, config)
    end

    # The channels a device's Config says it has beyond its first, each a device of its own, as the
    # interview of its endpoint makes it (PanelUi.channel_added): of the first's kind, in its zone, and in a search for it;
    # one registered before channels were, too, which the next ZbInfo gives its others. True when one was added
    def know_channels(ieee, config)
        var added = false
        for ep: PanelStore.config_channels(config)
            var fx = self.ui.channel_added(ieee, ep)
            if fx != nil && size(fx) > 0
                log("ZIGBEE: " + ieee + "/" + str(ep) + " is a channel of " + ieee, 2)
                self.emit(fx)
                added = true
            end
        end
        return added
    end

    # What a sensor's report says of it, "on" for open, motion, water, smoke or
    # CO and "off" for none, by the alarm Z2T names from its zone type or by the
    # occupancy cluster, and by the raw zone status under them (its two alarm
    # bits); nil for a report with none of them
    static def sensor_state(attrs)
        for k: ["Contact", "Occupancy", "Water", "Fire", "CO"]
            var v = attrs.find(k)
            if v != nil return (v == 1 || v == true) ? "on" : "off" end
        end
        var zs = attrs.find("ZoneStatus")
        if zs == nil return nil end
        return (int(zs) & 3) != 0 ? "on" : "off"
    end

    # A report: the state of a device of ours, for the plan and a zone's screen.
    def on_received(recv)
        if !isinstance(recv, map) return end
        for key: recv.keys()
            var attrs = recv[key]
            if !isinstance(attrs, map) continue end
            var dev = self.ieee_by(attrs.find("Device", key))
            # a short address the map lacks: its device is asked for, and the report is let go
            if dev == nil
                self.unknown_short(attrs.find("Device", key))
                continue
            end
            self.report(dev, attrs, false)
        end
    end

    # The reports of devices of other rooms, which the bridge that owns them said to the house (house_state.be), keyed by the IEEE, and by the IEEE and the endpoint for a
    # channel of a device of several: the same reports, with no short address to find the device by
    def on_remote(recv)
        if !isinstance(recv, map) return end
        var own = PanelZigbee.session_bridge()
        for key: recv.keys()
            var attrs = recv[key]
            if !isinstance(attrs, map) continue end
            var dev = PanelZigbee.norm(PanelStore.ieee_part(key))
            # one the house removed (another panel's "Remove from the house"): out of this panel too
            if attrs.contains("Gone")
                self.emit(self.ui.device_gone(dev))
                continue
            end
            # a device of the bridge of the house, or of none, comes this way too once the panel marks it there: while the
            # session with that bridge is up, its events say it already, whole, and the flood's word is not taken twice; with the session
            # down, its state only, as another room's
            var o = self.store.owner_of(dev)
            if own >= 0 && (o == 0 || o == own) continue end
            self.report(dev, attrs, true)
        end
    end

    # the number of the bridge of the house while the session with it is up (zigbee_bridge.be), whose events reach this panel whole; -1 otherwise
    static def session_bridge()
        import global
        var b = global.contains("zb_bridge") ? global.zb_bridge : nil
        if b == nil || b.link_state() != true || b.house_bridge == nil return -1 end
        return b.house_bridge()
    end

    # One device's report: its state for the plan and a zone's screen. `remote` is a device of another room, whose settings and groups are not this panel's to read
    def report(dev, attrs, remote)
        if self.store.find_device(dev) == nil return end
        if !remote && attrs.contains("ModelId") self.emit(self.ui.pair_model(dev, PanelZigbee.printable(attrs["ModelId"]))) end
        # a channel of a device of several, by the endpoint it reports from
        var ieee = self.channel(dev, attrs.find("Endpoint"))
        if !remote
            self.on_group_answer(ieee, attrs)
            # a lamp's settings, read for its screen
            if self.lamp != nil && (attrs.contains("StartUpOnOff") || attrs.contains("OnOffTransitionTime"))  self.lamp.said(ieee, attrs) end
        end
        # its brightness, for the detail's slider
        if attrs.contains("Dimmer")  self.note_level(ieee, attrs["Dimmer"]) end
        # the colour it says, for its icon when lit; a report of colour alone too
        var color = PanelZigbee.color_of(attrs)
        if color != false && self.plan != nil  self.plan.on_color(ieee, color) end
        var state = nil
        if attrs.find("Reachable") == false
            state = "noanswer"
        elif attrs.contains("Power")
            var p = attrs["Power"]
            state = (p == 1 || p == true) ? "on" : "off"
        end
        # a sensor's: open or motion lights its icon, as a lamp on does
        if state == nil
            var rec = self.store.find_device(ieee)
            if rec != nil && rec[2] == "sensor"  state = PanelZigbee.sensor_state(attrs) end
        end
        if state == nil return end
        # a device that does not answer does not, for any of its channels
        for id: state == "noanswer" ? self.store.channels_of(dev) : [ieee]
            self.tell(id, state)
            self.refresh_later(id)
        end
    end

    # the slider's position, whole percent, that a Dimmer on the wire stands for: what PanelUi.level_for sent, read back
    static def bri_pct(dimmer)
        var p = ((dimmer * 100 + 127) / 254 - 5) * 100 / 90
        if p < 0 p = 0 end
        if p > 100 p = 100 end
        return p
    end

    # What a lamp says of its brightness is where the detail's slider stands. It stood where this panel last put it, and at
    # 50 for a lamp it never set: a lamp another panel, a button or an app had dimmed showed 50 until the finger moved it. What the
    # lamp says of what this panel itself sent is no news, and leaves the slider where the finger put it, which a round trip of whole
    # percents would not
    def note_level(id, dimmer)
        if self.ui == nil return end
        if type(dimmer) == "real" dimmer = int(dimmer) end
        if type(dimmer) != "int" return end
        var d = self.store.find_device(id)
        if d == nil || (d[3] & PanelStore.CAP_LEVEL) == 0 return end
        var was = self.ui.levels.find(id)
        if was != nil && PanelUi.level_for("bri", was[0], 0, 0)[1] == dimmer return end
        var pct = PanelZigbee.bri_pct(dimmer)
        if was != nil
            self.ui.levels[id] = [pct, was[1], was[2]]
            return
        end
        # a lamp the finger never touched shares its list with every other at the same brightness: the sliders write a new list (PanelUi.level)
        # and never into one, and thirty lamps at full brightness are one list and thirty keys, where each was a list of its own
        var shared = self.shared_levels.find(pct)
        if shared == nil
            shared = [pct, 50, 50]
            self.shared_levels[pct] = shared
        end
        self.ui.levels[id] = shared
    end

    # A device's state to the plan, or with no plan to the views: "noanswer" is
    # no communication, which keeps what it last said
    def tell(ieee, state)
        if self.plan != nil
            self.plan.on_report(ieee, state)
        elif state == "noanswer"
            self.ui.doubt[ieee] = true
        else
            self.ui.live[ieee] = state
            if self.ui.doubt.contains(ieee) self.ui.doubt.remove(ieee) end
        end
    end

    # A zone's screen drawn again for every report was a burst of its whole page
    # per lamp: twelve lamps answering one tap made 7 KB in 90 ms, against the
    # display's 1 KB of input, and a serial write that holds the loop while it
    # goes out. The reports of a moment make one redraw: only one zone is on
    # show, and a redraw draws every lamp of it.
    static REFRESH_MS = 150
    # The transport's mode, when it switches and at boot:
    # with no bridge the lamps do not answer, and their cards say so, as a lamp
    # that went unanswered does, until a report says otherwise, and a tap on one
    # does not turn back after the pending time with no mark.
    def mode_is(m)
        if m == self.mode_seen return end
        self.mode_seen = m
        if m != "off" return end
        for d: self.store.doc["devices"]
            if PanelStore.is_relay_id(d[0]) continue end
            self.tell(d[0], "noanswer")
            self.refresh_later(d[0])
        end
    end

    def refresh_later(ieee)
        self.to_refresh[ieee] = true
        if self.refresh_armed return end
        self.refresh_armed = true
        tasmota.set_timer(PanelZigbee.REFRESH_MS, / -> self.refresh_now())
    end

    def refresh_now()
        self.refresh_armed = false
        var ids = self.to_refresh
        self.to_refresh = {}
        for id: ids.keys()
            var fx = self.ui.refresh_for(id)
            if size(fx) > 0
                self.emit(fx)
                return
            end
        end
    end

    # --- the groups ---------------------------------------------------

    static def now()
        import global
        return global.tasmota.millis()
    end

    # A group command out: AddGroup or RemoveGroup, and GetAllGroups to reconcile.
    def send_group(op, ieee, zid)
        import string
        var cmd = op == "add" ? string.format('{"AddGroup":%d}', zid)
                : op == "remove" ? string.format('{"RemoveGroup":%d}', zid) : '{"GetAllGroups":true}'
        # one the way refused (its bridge not ready on the mesh) waits for no answer: the work is still the store's, for the next step
        if self.send(string.format('ZbSend {%s,"Send":%s}', self.store.zb_address(ieee), cmd)) == false return end
        self.inflight = [op, ieee, zid, PanelZigbee.now()]
    end

    # The next thing the groups need, if the network is ours to use: an answer
    # that did not come is dealt with first, then the store's work, then the
    # retries and the reconciling, when there is nothing else.
    def group_step()
        var now = PanelZigbee.now()
        # with the link down nothing reaches the network, and the transport drops
        # what is sent: no step, and an answer waited for is let go with no try
        # counted -- the work is still the store's, for when the link is back
        # and in a house, the bridges are reached by the mesh, each line by the route, which says when one is not ready
        if !PanelZigbee.link_up() && !PanelZigbee.house_up()
            self.inflight = nil
            return
        end
        if self.inflight != nil
            # one whose relay opened while its answer was awaited cannot answer:
            # let go with no try counted, as with the link down
            if self.unpowered(self.inflight[1])
                self.inflight = nil
            else
                if now - self.inflight[3] < PanelZigbee.ANSWER_MS return end
                self.unanswered(self.inflight)
                self.inflight = nil
            end
        end
        # never during a search's window, when the network is taking devices;
        # a search whose window is over pauses nothing
        if self.ui != nil && self.ui.pairing != nil && self.ui.before(self.ui.pairing["until"], self.ui.PAIR_MS) return end
        # a device behind an open relay cannot answer: its work waits for the
        # relay to close, and the next goes
        for w: self.store.group_work()
            if !self.unpowered(w[1])
                self.send_group(w[0], w[1], w[2])
                return
            end
        end
        # A failed join is the transient state: tried again here, and never written. A
        # member that cannot answer -- a lamp switched off at the wall -- would write the whole
        # configuration, and its backup, three times in ten minutes, with no one touching anything
        if now - self.retried_at >= PanelZigbee.RETRY_MS
            self.retried_at = now
            if self.store.retry_failed()["value"] > 0 return end
        end
        if now - self.asked_at >= PanelZigbee.RECONCILE_MS
            var ids = []
            for id: self.zigbee_ids()
                if !self.unpowered(id) ids.push(id) end
            end
            if size(ids) == 0 return end
            self.asked_at = now
            if self.asked_next >= size(ids) self.asked_next = 0 end
            self.send_group("get", ids[self.asked_next], 0)
            self.asked_next += 1
        end
    end

    # The bridge's link is up; with no transport at all (a test of the views),
    # nothing says otherwise
    static def link_up()
        import global
        var b = global.contains("zb_bridge") ? global.zb_bridge : nil
        return b == nil || b.link_state() == true
    end

    # the panel is in a house, whose bridges the mesh reaches
    static def house_up()
        import global
        var h = global.contains("house") ? global.house : nil
        return h != nil && h.up == true
    end

    # a Zigbee device whose relay is open, on the plan's word: nothing sent to it
    # can be answered. With no plan, the relays are not followed
    def unpowered(ieee)
        return self.plan != nil && self.plan.relay_on != nil && self.store.unpowered(ieee, self.plan.relay_on)
    end

    # the Zigbee devices of the panel, in a fixed order
    def zigbee_ids()
        var ids = []
        for d: self.store.doc["devices"]
            if !PanelStore.is_relay_id(d[0]) ids.push(d[0]) end
        end
        return PanelStore.sorted(ids)
    end

    # An answer that did not come. A join is failed, to be tried again later; a
    # leave gets its tries, and then the group moves to a new address -- or, for
    # an old address, is given up: the reconciling finds it again if it is there.
    def unanswered(w)
        var op = w[0]
        if op == "get" return end
        if op == "add"
            # failed, in the document and not on the flash: the retry tries it again, and what a reboot finds there
            # is a join, which is tried again as well
            self.store.group_answer("add", w[1], w[2], 0xFF)
            return
        end
        var key = op + " " + w[1] + " " + str(w[2])
        var n = self.tries.find(key, 0) + 1
        self.tries[key] = n
        if n < PanelZigbee.LEAVE_TRIES return end
        self.tries.remove(key)
        var leaving = false
        for o: self.store.group_owners()
            if o["zid"] == w[2] && o["zstate"].find(w[1]) == "leaving" leaving = true end
        end
        if leaving
            var r = self.store.move_group(w[2])
            log("ZIGBEE: " + w[1] + " did not leave group " + str(w[2]) + ", which moves to " + str(r["value"]), 2)
        else
            var kept = []
            for s: self.store.doc["stale"]
                if s[0] != w[1] || s[1] != w[2] kept.push(s) end
            end
            self.store.doc["stale"] = kept
        end
        self.emit([["save"]])
    end

    # the group cluster's answers, in a report of the device that gives them
    def on_group_answer(ieee, attrs)
        var w = self.inflight
        if attrs.contains("GetGroup") && isinstance(attrs["GetGroup"], list)
            var r = self.store.reconcile(ieee, attrs["GetGroup"])
            if r["value"] self.emit([["save"]]) end
            if w != nil && w[0] == "get" && w[1] == ieee self.inflight = nil end
            return
        end
        var op = attrs.contains("AddGroupStatus") ? "add" : attrs.contains("RemoveGroupStatus") ? "remove" : nil
        if op == nil return end
        var zid = attrs.find(op == "add" ? "AddGroup" : "RemoveGroup")
        var status = attrs[op == "add" ? "AddGroupStatus" : "RemoveGroupStatus"]
        var r = self.store.group_answer(op, ieee, zid, status)
        # a join the device refused is the transient state too (a table with no room): not written, tried again by the retry
        var refused = op == "add" && status != PanelStore.ZCL_SUCCESS && status != PanelStore.ZCL_DUPLICATE_EXISTS
        if r["value"] && !refused self.emit([["save"]]) end
        if w != nil && w[0] == op && w[1] == ieee && w[2] == zid
            self.inflight = nil
            self.tries.remove(op + " " + ieee + " " + str(zid))
        end
    end

    # the groups' clock, from boot: one step every GROUP_TICK_MS
    # Re-armed before the step: a step that raises loses its tick, not the clock
    # (a Tasmota timer that raises is not called again).
    def start_groups()
        import global
        global.tasmota.set_timer(PanelZigbee.GROUP_TICK_MS, def ()
            self.start_groups()
            try
                self.group_step()
            except .. as e, m
                log("ZIGBEE: a step of the group work failed - " + str(e) + ": " + str(m), 2)
            end
        end)
    end

    # Devices that did not show what a command asked in time: a
    # ping each, spaced, and only for those; the one that does not answer keeps
    # its "?", and the one that does shows what it last said (on_ping).
    def ping(ids)
        var idle = size(self.pings) == 0
        for id: ids
            if self.pings.find(id) == nil self.pings.push(id) end
        end
        if idle self.next_ping() end
    end

    def next_ping()
        import global
        if size(self.pings) == 0 return end
        var id = self.pings[0]
        self.pings.remove(0)
        self.send("ZbPing " + PanelStore.ieee_part(id))
        if size(self.pings) > 0 global.tasmota.set_timer(PanelZigbee.PING_GAP_MS, / -> self.next_ping()) end
    end

    # a write of StartUpOnOff went out: its answer is expected from that device
    def expect_startup(id)
        self.startup[self.startup_key(PanelStore.ieee_part(id), id)] = id
    end

    # a write's answer by the device's IEEE, and for a channel of a device of several by its endpoint too, as both may be awaited
    def startup_key(base, id)
        var ieee = PanelStore.ieee_part(id)
        if ieee == id && size(self.store.channels_of(ieee)) < 2 return base end
        var d = self.store.find_device(id)
        return base + "/" + str(d != nil ? d[7] : 1)
    end

    def on_response(r)
        if !isinstance(r, map) || !r.contains("Device") return end
        # the device it is about, by its IEEE: what the bridge says, or the map's of its short address
        var base = self.ieee_by(r["Device"])
        # the answer to a write of a lamp's settings
        if base != nil && self.lamp != nil && self.lamp.answer(base, r) return end
        var key = base
        if base != nil && r.contains("Endpoint") && self.startup.find(base) == nil  key = base + "/" + str(PanelZigbee.num(r["Endpoint"])) end
        var ieee = key != nil ? self.startup.find(key) : nil
        if ieee == nil || r.find("Command") != PanelZigbee.WRITE_ONOFF return end
        self.startup.remove(key)
        # 0 SUCCESS; anything else -- 134 UNSUPPORTED_ATTRIBUTE -- is a refusal, tolerated
        self.emit(self.ui.startup_result(ieee, r.find("Status") == 0))
    end

    # The link to the network came up (zigbee_bridge.be's on_link): Z2T started
    # on this panel, the bridge connected, or its ESP-NOW session opened. Until
    # the map is read a report from a lamp is not known as that lamp, and every
    # tap reads "on", so it is asked for now that a command reaches the network,
    # and the groups' upkeep starts, once. Waiting for the Wi-Fi would leave a
    # panel with no network never asking at all.
    #
    # A link that comes back asks again, at most every SEED_MS: ZbInfo carries
    # each lamp's last Power, which is what the lamps did while it was down.
    def linked()
        import global
        var now = global.tasmota.millis()
        # the alarm's state, its log and its settings asked for again with every link
        if self.alarm != nil  self.alarm.link_up() end
        # what the panel's devices are, and their state, asked for again with the session, at most every SEED_MS (what changed while it was down);
        # within it, only what the map lacks, a session back on a map whose answers were lost
        self.seed_round = 0
        if self.seeded_at != nil && now - self.seeded_at < PanelZigbee.SEED_MS
            if size(self.lacking()) > 0  global.tasmota.set_timer(PanelZigbee.SEED_DELAY_MS, / -> self.seed(false)) end
            return
        end
        self.seeded_at = now
        global.tasmota.set_timer(PanelZigbee.SEED_DELAY_MS, / -> self.seed(true))
        if !self.grouping
            self.grouping = true
            self.start_groups()
        end
    end

    # The map looked at, SEED_CHECK_MS after a seed: the devices of the panel it lacks are asked again, one by one, each of its
    # bridge; the check comes back, SEED_ROUNDS times at most
    def seed_check()
        import global
        if !PanelZigbee.link_up() return end
        var lacking = self.lacking()
        if size(lacking) == 0 return end
        if self.seed_round >= PanelZigbee.SEED_ROUNDS
            log("ZIGBEE: " + str(size(lacking)) + " of the panel's devices said nothing of themselves: the next seed asks again", 2)
            return
        end
        self.seed_round += 1
        for ieee: lacking  self.ask(ieee) end
        global.tasmota.set_timer(PanelZigbee.SEED_CHECK_MS + size(self.asks) * PanelZigbee.SEED_GAP_MS, / -> self.seed_check())
    end

    # the panel's Zigbee devices, by their IEEEs, a device of several channels once
    def ieees()
        var out = []
        for id: self.zigbee_ids()
            var ieee = PanelStore.ieee_part(id)
            if out.find(ieee) == nil  out.push(ieee) end
        end
        return out
    end

    # the panel's Zigbee devices the map does not have yet, by their IEEEs, a device of several channels once
    def lacking()
        var on = {}
        for s: self.ieee_of.keys() on[self.ieee_of[s]] = true end
        var out = []
        for id: self.zigbee_ids()
            var ieee = PanelStore.ieee_part(id)
            if !on.contains(ieee) && out.find(ieee) == nil  out.push(ieee) end
        end
        return out
    end

    # A device's ZbInfo asked for, in its turn: the first at once, and the next ones SEED_GAP_MS apart, as pings are
    def ask(what, all)
        if self.send == nil return end
        if all  self.whole[what] = true end
        if self.asks.find(what) != nil return end
        self.asks.push(what)
        if !self.asking
            self.asking = true
            self.ask_next()
        end
    end

    def ask_next()
        import global
        # one the map has by now is not asked for, but in a whole seed; the asks end when there are none
        while size(self.asks) > 0
            var what = self.asks[0]
            self.asks.remove(0)
            var had = size(what) > 6 ? self.short_of(what) != nil : self.ieee_of.find(PanelZigbee.short(what)) != nil
            var all = self.whole.contains(what)
            if all  self.whole.remove(what) end
            if had && !all continue end
            self.send("ZbInfo " + what)
            global.tasmota.set_timer(PanelZigbee.SEED_GAP_MS, / -> self.ask_next())
            return
        end
        self.asking = false
    end

    # A report from a short address the map does not have: a lamp whose ZbInfo was lost on the way, or one that joined again. It is
    # asked for itself, once in SHORT_ASK_MS: its answer teaches the address, and the next report is the lamp's
    def unknown_short(a)
        import string
        var s = PanelZigbee.short(a)
        if s == nil || self.send == nil || !PanelZigbee.link_up() return end
        var now = PanelZigbee.now()
        var at = self.asked_short.find(s)
        if at != nil && now - at >= 0 && now - at < PanelZigbee.SHORT_ASK_MS return end
        if size(self.asked_short) >= PanelZigbee.SHORT_ASKS  self.asked_short = {} end
        self.asked_short[s] = now
        self.ask(string.format("0x%04X", s))
    end

    # What the panel's devices are, with the session: a ZbInfo of each, which the route takes to its bridge, one message a device
    # (on_info), SEED_GAP_MS apart
    def seed(all)
        import global
        for ieee: all ? self.ieees() : self.lacking()  self.ask(ieee, all) end
        # the map, looked at when its answers have had their time, after the last ask: the bridge's queue may not have held them all
        global.tasmota.set_timer(PanelZigbee.SEED_CHECK_MS + size(self.asks) * PanelZigbee.SEED_GAP_MS, / -> self.seed_check())
    end
end
