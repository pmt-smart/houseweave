# light.be — the joBr99 stack's Zigbee light entity (toggle + RGB/brightness detail).
#
# TFT<->brain protocol mapped from joBr99's original backend (not
# invented; see reference/joBr99/luibackend/{mqtt,controller,pages}.py):
#   - from the TFT: "event,buttonPress2,<id>,button," (quick toggle on the card),
#     "event,pageOpenDetail,popupLight,<id>" (opens the detail page),
#     "event,buttonPress2,<id>,OnOff,<0 or 1>" (switch on the detail page —
#     explicit state, not a relative toggle),
#     "event,buttonPress2,<id>,brightnessSlider,<0-100>" (slider),
#     "event,buttonPress2,<id>,colorTempSlider,<0-100>" (colour temperature
#     slider, see CT_MIN/CT_MAX below),
#     "event,buttonPress2,<id>,colorWheel,<x>|<y>|<wheel_diameter>" (colour
#     wheel) — both enabled together, this bulb really is RGB+W/C
#     (`color`/`color_temp` are independent fields in the original
#     protocol, not one-or-the-other)
#   - to the TFT: "entityUpdateDetail~<id>~~<icon_color>~<on>~<bri_pct>~<ct>~
#     <color_flag>~..." (pages.py generate_light_detail_page, ~line 873)
#   - card on the home page: see home.be (Milestones 1+3 merged, cardGrid
#     protocol researched separately)
#
# Zigbee: ZbSend syntax confirmed by reading the driver source
# (xdrv_23_zigbee_6_0_commands.ino, xdrv_23_zigbee_A_impl.ino) — it is NOT
# the same thing as the `HSBColor` command of Tasmota's local light driver:
#   - only ONE "friendly" field per ZbSend call (Power and Dimmer cannot go
#     together — two separate calls are needed)
#   - Dimmer: 0-254 (not 0-100, not 0-255)
#   - Hue/Sat: 0-254 each (ZCL scale), not the local driver's "H,S,B" string
#   - CT: mireds (not kelvin)
#
# Card/detail identifier for the TFT: short strings of our own (e.g. "L1"),
# not the original backend's "uuid.xxxxxxxxxx" scheme — that field is opaque
# to the TFT (it only comes back the way we send it), any string works.

#@ solidify:Light
class Light
    var bridge      # ZigbeeBridge instance (zigbee_bridge.be)
    var nx          # Nextion instance (nextion_driver.be)
    var devices     # {id -> {"addr":.., "name":.., "power":.., "bri":.., "hue":.., "sat":..}}
    var on_change       # f(id, refresh_detail) or nil: who to tell when a bulb's state changed
                        # (home.be refreshes the card; brain, for OUR pages)
    var open_detail_id  # id of the bulb whose detail page is open on screen right now, nil if
                         # none — resends the detail page when the state changes outside
                         # of a touch (e.g. moving the brightness slider physically turns the
                         # bulb on, and without this the on-screen switch would stay "frozen"
                         # showing off)
    var pending_send    # {id -> [cmd,...]} commands pending debounce, see queue_send()

    # real latency telemetry — neither external polling (~1-2s granularity,
    # competing for the network with the real test) nor eyeballing can
    # pinpoint WHEN/HOW MUCH a lag is. This measures at the source:
    # `pending_since[id]` holds the millis() of when the LAST Power command
    # was sent for that id (overwritten on every new touch, even before the
    # previous confirmation arrives — reflects the most recent intent);
    # when the real confirmation arrives in `on_zigbee_event`, the elapsed
    # time is computed and stored in `latency_log` (last 50 samples) —
    # queryable later via `Br global.light.latency_stats()`, no external
    # polling needed.
    var pending_since
    var latency_log

    # additional telemetry: measures only the stretch that is 100% ours and local (no dependence on
    # another device's clock) — from the touch arriving in `handle_event()`
    # to right before `bridge.send()` is called in `set_power()`. Kept
    # separate from `latency_log` above (which measures the full round trip
    # up to the bulb's real confirmation) to separate "our processing
    # overhead" from "network + Zigbee time".
    var last_touch_ms
    var send_latency_log

    def init(nx, bridge)
        self.nx = nx
        self.bridge = bridge
        self.pending_since = {}
        self.latency_log = []
        self.last_touch_ms = nil
        self.send_latency_log = []
        self.pending_send = nil
        self.devices = {}
        self.on_change = nil
        self.open_detail_id = nil
        self.bridge.on_event = / payload -> self.on_zigbee_event(payload)
    end

    # real colour temperature limits of this bulb (CK-BL702-AL-01, RGB+W/C
    # per the manual) — there is no reliable way to query this over Zigbee
    # (ColorTempPhysicalMinMireds/MaxMireds returned "UNSUPPORTED_CLUSTER"
    # on it), so measured empirically: sent CT outside the limits and saw
    # where the device clamps the value (ZbInfo confirms CT:142 for input
    # 100, CT:500 for input 600). Specific to this bulb model, not to the
    # protocol — if the bulb changes, measure again.
    static CT_MIN = 142
    static CT_MAX = 500

    # brightness limits requested by the user: the slider never lets the
    # bulb go fully dark (min) nor to full power (max) — not a physical
    # limit of the bulb, a usage preference. The slider still goes 0 to 100
    # visually, only the output range to Dimmer is remapped inside these
    # limits.
    static BRI_MIN_PCT = 5
    static BRI_MAX_PCT = 95

    # registers a bulb (a single fixed one — its address comes from a manual
    # pairing).
    #
    # Initial state comes from what was persisted last time (see
    # on_zigbee_event), not from a fixed guess, which showed the wrong icon
    # and switch right after a restart. We
    # first tried asking the bulb for its real state over Zigbee at boot
    # (`ZbSend {"read":[...]}`), but this particular bulb rejects ANY
    # explicit attribute read with UNSUPPORTED_CLUSTER (tested with Power
    # alone, Dimmer, Hue, Sat — all fail, even though it accepts writing
    # those values without complaint) — a bulb firmware limitation, no
    # workaround. Persisting the last known state locally is much simpler
    # and does not depend on the bulb answering anything.
    def add(id, addr, name)
        import persist
        var saved = persist.find("light_" + id, nil)
        if saved != nil
            self.devices[id] = saved
            # addr/name always come from the code (manual pairing), never
            # from what was persisted — avoids getting stuck on a stale
            # address if the device is re-paired with another one later.
            self.devices[id]["addr"] = addr
            self.devices[id]["name"] = name
        else
            self.devices[id] = {"addr": addr, "name": name, "power": 0, "bri": 254, "hue": 0, "sat": 0, "ct": self.CT_MIN}
        end
    end

    def find_by_addr(addr)
        for id: self.devices.keys()
            if self.devices[id]["addr"] == addr
                return id
            end
        end
        return nil
    end

    # pings every bulb — used when a relay changes state (see autoexec.be),
    # since switching the bulb off at the physical relay cuts its power
    # without any Zigbee notice. If it does not answer, Tasmota itself
    # sends a ZbReceived with Reachable:false over the same normal channel
    # (found by reading xdrv_23_zigbee_6_0_commands.ino, Z_Unreachable —
    # uses jsonPublishNow, like any other attribute), which
    # on_zigbee_event interprets as "no power, force off".
    def ping_all()
        for id: self.devices.keys()
            self.bridge.send("ZbPing " + self.devices[id]["addr"])
        end
    end

    #################################################################
    # events coming from the TFT (called by brain.be with
    # parts = string.split(msg, ",") of the "event,..." message already done)
    #################################################################

    # returns true if it handled the event
    def handle_event(parts)
        # uses the real arrival timestamp of the byte on the UART (stamped
        # in nextion_driver.be, see there, into Berry's `global` — not
        # `tasmota.global`, see the comment there) instead of
        # tasmota.millis() here — also captures the up-to-100ms polling of
        # the serial read, which a local timestamp at this point would miss
        # entirely. `global.` has NO `.find()` method (tested live before
        # relying on it — `type(global.find)` gave `nil`), but reading a
        # never-defined key safely returns `nil` (no exception), so it can
        # be checked directly.
        self.last_touch_ms = global.touch_rx_ms
        if self.last_touch_ms == nil  self.last_touch_ms = tasmota.millis() end
        if parts[1] == "buttonPress2" && size(parts) >= 4
            var id = parts[2]
            if self.devices.find(id) == nil  return false end
            var btype = parts[3]
            if btype == "button"
                self.toggle(id)
            elif btype == "OnOff" && size(parts) >= 5
                self.set_power(id, int(parts[4]))
            elif btype == "brightnessSlider" && size(parts) >= 5
                self.set_brightness(id, int(parts[4]))
            elif btype == "colorTempSlider" && size(parts) >= 5
                self.set_color_temp(id, int(parts[4]))
            elif btype == "colorWheel" && size(parts) >= 5
                self.set_color_from_wheel(id, parts[4])
            else
                return false
            end
            return true
        elif parts[1] == "pageOpenDetail" && size(parts) >= 4 && parts[2] == "popupLight"
            var id = parts[3]
            if self.devices.find(id) == nil  return false end
            self.open_detail_id = id
            self.send_detail(id)
            return true
        end
        return false
    end

    # called by brain.be when the X of the detail page closes it
    # (event,buttonPress2,popupLight,bExit) — to stop resending the detail
    # page once it is off the screen.
    def close_detail()
        self.open_detail_id = nil
    end

    # generic debounce for the continuous controls (brightness/colour
    # temperature/colour wheel) — dragging a slider generates several
    # events per second. Only the last gesture matters, so everything that
    # arrives within the window is coalesced and sent once. `cmds` is a
    # list because the colour wheel sends two commands (Hue and Sat) that
    # must go together.
    #
    # Was 200ms — the original reason was specifically to avoid a storm of
    # new TCP connections in zigbee_bridge.be's `http` mode (every
    # `bridge.send()` opened a connection from scratch, several in a row
    # froze the ESP32 for seconds). With
    # the `tcp` mode (persistent connection, every send is just a write on
    # the already-open socket) that reason is gone, reduced to 50ms — still
    # coalesces within the same drag gesture, but follows the finger much
    # more closely.
    static SEND_DEBOUNCE_MS = 50
    def queue_send(id, cmds)
        if self.pending_send == nil  self.pending_send = {} end
        self.pending_send[id] = cmds
        tasmota.remove_timer("light_send_" + id)
        tasmota.set_timer(self.SEND_DEBOUNCE_MS, / -> self.flush_send(id), "light_send_" + id)
    end

    def flush_send(id)
        if self.pending_send == nil  return end
        var cmds = self.pending_send.find(id)
        if cmds == nil  return end
        self.pending_send.remove(id)
        for cmd: cmds
            self.bridge.send(cmd)
        end
    end

    # Sends an ABSOLUTE state (not a relative "Power":"toggle"): with the bulb
    # taking ~900ms to confirm back (measured: it is the bulb itself, not our
    # transport), a relative toggle with no immediate visual feedback makes the
    # user tap again before the confirmation arrives, inverting again, and it
    # takes several taps to "land" on the right state. Absolute is idempotent: repeated taps before the
    # confirmation arrives send the SAME target (computed from the last
    # known state) instead of inverting on every tap. Same pattern already
    # used in set_power() (detail page switch).
    def toggle(id)
        var d = self.devices[id]
        self.set_power(id, d["power"] == 0 ? 1 : 0)
    end

    # the detail page switch sends the explicit state (0/1), not a relative
    # toggle — btype "OnOff", found via the LastEvent debug command
    # (event,buttonPress2,L1,OnOff,<0 or 1>).
    #
    # Does NOT update the state here. The screen reflects only what the
    # bulb actually confirmed, via on_zigbee_event: ~890ms of the perceived
    # delay is the bulb ITSELF reporting the new state back over Zigbee
    # (measured), outside our control.
    #
    # No optimistic update to hide that delay: it would mask delivery
    # failures, a link dropping ALL the events on the way back with the
    # screen still looking right, because the state would come from the
    # local guess and not from the bulb. The honest delay is preferred to the
    # apparent correctness. The cost (perceived slowness when
    # switching on/off) belongs to the bulb, not the transport.
    def set_power(id, on)
        import string
        var d = self.devices[id]
        if self.last_touch_ms != nil
            self.send_latency_log.push(tasmota.millis() - self.last_touch_ms)
            if size(self.send_latency_log) > 50  self.send_latency_log.remove(0) end
            self.last_touch_ms = nil
        end
        self.pending_since[id] = tasmota.millis()
        self.bridge.send(string.format('ZbSend {"device":"%s","send":{"Power":%d}}', d["addr"], on))
    end

    # statistics from the touch to right before bridge.send() — see
    # send_latency_log above. Query via
    # `Br global.light.send_latency_stats()`.
    def send_latency_stats()
        import string
        if self.send_latency_log == nil || size(self.send_latency_log) == 0  return "no samples" end
        var mn = 999999
        var mx = 0
        var sum = 0
        for v: self.send_latency_log
            if v < mn  mn = v end
            if v > mx  mx = v end
            sum += v
        end
        return string.format("n=%d avg=%dms min=%dms max=%dms samples=%s",
            size(self.send_latency_log), sum / size(self.send_latency_log), mn, mx, str(self.send_latency_log))
    end

    # quick statistics of the real latency telemetry — see
    # `pending_since`/`latency_log` above. Query via
    # `Br global.light.latency_stats()`.
    def latency_stats()
        import string
        if self.latency_log == nil || size(self.latency_log) == 0  return "no samples" end
        var mn = 999999
        var mx = 0
        var sum = 0
        for v: self.latency_log
            if v < mn  mn = v end
            if v > mx  mx = v end
            sum += v
        end
        return string.format("n=%d avg=%dms min=%dms max=%dms samples=%s",
            size(self.latency_log), sum / size(self.latency_log), mn, mx, str(self.latency_log))
    end

    def set_brightness(id, pct)
        import string
        if pct < 0  pct = 0 end
        if pct > 100  pct = 100 end
        var d = self.devices[id]
        var clamped_pct = self.BRI_MIN_PCT + (self.BRI_MAX_PCT - self.BRI_MIN_PCT) * pct / 100
        var level = clamped_pct * 254 / 100
        self.queue_send(id, [string.format('ZbSend {"device":"%s","send":{"Dimmer":%d}}', d["addr"], level)])
    end

    # slider 0-100 (0=cold, 100=warm, same direction as the original
    # colorTempSlider — controller.py:375-379 scales to kelvin with the 0
    # end at the maximum/coldest kelvin) -> mireds within the bulb's real
    # measured range (CT_MIN/CT_MAX above).
    def set_color_temp(id, pct)
        import string
        if pct < 0  pct = 0 end
        if pct > 100  pct = 100 end
        var d = self.devices[id]
        var mireds = self.CT_MIN + (self.CT_MAX - self.CT_MIN) * pct / 100
        self.queue_send(id, [string.format('ZbSend {"device":"%s","send":{"CT":%d}}', d["addr"], mireds)])
    end

    # Hue from a 0..100 bar, which is what OUR detail page has instead of
    # joBr99's colour wheel (`set_color_from_wheel`). Hue only: the bar says
    # nothing about saturation, so the bulb keeps the saturation it has.
    def set_hue_pct(id, pct)
        import string
        if pct < 0  pct = 0 end
        if pct > 100  pct = 100 end
        var d = self.devices[id]
        var hue = pct * 254 / 100
        self.queue_send(id, [string.format('ZbSend {"device":"%s","send":{"Hue":%d}}', d["addr"], hue)])
    end

    # The detail page's three sliders as 0..100, from the bulb's raw state --
    # the same remapping `send_detail` does for joBr99's page, in one place so
    # OUR page (filled by binding in brain.be) cannot disagree with his.
    def detail_pcts(id)
        var d = self.devices[id]
        var raw_bri_pct = d["bri"] * 100 / 254
        var bri_pct = (raw_bri_pct - self.BRI_MIN_PCT) * 100 / (self.BRI_MAX_PCT - self.BRI_MIN_PCT)
        if bri_pct < 0  bri_pct = 0 end
        if bri_pct > 100  bri_pct = 100 end
        var ct_pct = (d["ct"] - self.CT_MIN) * 100 / (self.CT_MAX - self.CT_MIN)
        if ct_pct < 0  ct_pct = 0 end
        if ct_pct > 100  ct_pct = 100 end
        var hue_pct = d["hue"] * 100 / 254
        return [bri_pct, ct_pct, hue_pct]
    end

    # x|y|wh coming from the TFT (touch coordinates on the colour wheel) ->
    # hue/sat 0-254 (ZCL). Same geometric idea as the original pos_to_color
    # (helper.py), but sends Zigbee hue/sat directly instead of converting
    # to RGB (ZbSend does not accept RGB, only Hue/Sat/Color-xy — see top).
    def set_color_from_wheel(id, raw)
        import math
        import string
        var parts = string.split(raw, "|")
        if size(parts) < 3  return end
        var wh = real(parts[2])
        var x = real(parts[0]) - wh / 2
        var y = wh / 2 - real(parts[1])
        var angle = math.atan2(y, x)               # -pi..pi
        if angle < 0  angle += 2 * math.pi end
        var radius = math.sqrt(x * x + y * y)
        var sat_pct = radius / (wh / 2)
        if sat_pct > 1  sat_pct = 1 end

        var hue = int(angle / (2 * math.pi) * 254)
        var sat = int(sat_pct * 254)
        var d = self.devices[id]
        self.queue_send(id, [
            string.format('ZbSend {"device":"%s","send":{"Hue":%d}}', d["addr"], hue),
            string.format('ZbSend {"device":"%s","send":{"Sat":%d}}', d["addr"], sat)
        ])
    end

    #################################################################
    # events coming from Zigbee (local or relayed over WiFi — the rest of
    # the brain never knows which, see zigbee_bridge.be)
    #################################################################

    # `payload` ALWAYS arrives as an already-parsed map — zigbee_bridge.be
    # normalises it. No `json.load()` here: the rules engine already delivers
    # the event parsed, and `json.load()` of a map returns `nil` WITHOUT
    # raising — so every event would be silently dropped.
    def on_zigbee_event(payload)
        import persist
        import string
        var data = payload
        if data == nil || type(data) == "string"  return end
        if data.find("ZbReceived") == nil  return end
        var recv = data["ZbReceived"]
        for addr: recv.keys()
            var id = self.find_by_addr(addr)
            if id == nil  continue end
            var attrs = recv[addr]
            var d = self.devices[id]
            var changed = false
            # triggers a resend of the detail page (see further below) —
            # only for Power/Dimmer/CT, not for Hue/Sat. Reason detailed in
            # the comment near the `if refresh_detail` below.
            var refresh_detail = false
            # only flag "changed" if the value DIFFERS from what we already
            # had — the bulb sometimes reports the same value several times
            # in a row (repeated spontaneous report, not a real change).
            if attrs.find("Power") != nil
                # telemetry: measures the real time from the last Power
                # command sent for this id to the confirmation arriving
                # here — see `pending_since`/`latency_log` above. Runs
                # whenever a Power confirmation arrives (whether or not it
                # matches what the optimistic UI had assumed), only if a
                # command was pending (avoids telemetry for spontaneous bulb
                # reports with no touch of ours behind them).
                # no log() here: it would fill the console at every burst of
                # commands. The data stays in latency_log, read with
                # `Br global.light.latency_stats()`.
                var since = self.pending_since.find(id)
                if since != nil
                    var elapsed = tasmota.millis() - since
                    self.pending_since.remove(id)
                    self.latency_log.push(elapsed)
                    if size(self.latency_log) > 50  self.latency_log.remove(0) end
                end
                if attrs["Power"] != d["power"]  d["power"] = attrs["Power"]  changed = true  refresh_detail = true end
            end
            if attrs.find("Dimmer") != nil && attrs["Dimmer"] != d["bri"]  d["bri"] = attrs["Dimmer"]  changed = true  refresh_detail = true end
            # Hue/Sat (colour wheel) NEVER trigger a resend of the detail
            # page, neither immediate nor delayed — tested live with a 3s
            # debounce (waiting for the colour change to "settle" before
            # resending) and the wheel still closed on its own sometimes,
            # and worse: it also closed later, in the middle of another
            # action (the timer fired a delayed resend right when the user
            # had already moved on to brightness or another control).
            # Reverted. The detail page
            # icon does not update its colour live (accepted side effect);
            # the home card updates normally via
            # on_change, and reopening the detail page also fixes it.
            if attrs.find("Hue") != nil && attrs["Hue"] != d["hue"]  d["hue"] = attrs["Hue"]  changed = true end
            if attrs.find("Sat") != nil && attrs["Sat"] != d["sat"]  d["sat"] = attrs["Sat"]  changed = true end
            if attrs.find("CT") != nil && attrs["CT"] != d["ct"]  d["ct"] = attrs["CT"]  changed = true  refresh_detail = true end
            # no answer to the ping (ZbPing, fired when a relay changes
            # state — see ping_all()) = really no power, force off.
            # Reachable:true says nothing about power on/off (only that it
            # has power), so only the false case acts.
            if attrs.find("Reachable") == false && d["power"] != 0
                d["power"] = 0
                changed = true
                refresh_detail = true
            end
            if changed
                log(string.format("LIGHT: %s updated - power=%d bri=%d", id, d["power"], d["bri"]), 3)
                # only updates the in-memory data here (cheap) — the real
                # save() (synchronous flash write, can take tens of ms) is
                # left for the end of the function, AFTER every screen
                # redraw (on_change + send_detail below). Without this
                # order, the screen only updated after save() finished —
                # the user felt it live: the physical light reacted almost
                # instantly, the icon took visibly longer.
                # Neither on_change() nor
                # send_detail() depend on save() having finished, they only
                # read the dict `d` already updated in memory.
                persist.setmember("light_" + id, d)
                if self.on_change != nil  self.on_change(id) end
            end
            # detail page open for this device AND something worth
            # resending changed? resend it (the whole entityUpdateDetail,
            # including the little icon faithful to the colour) — otherwise
            # the screen stays "frozen" showing the value from when the page
            # opened, even though the real state changed from outside (e.g.
            # moving the brightness physically turns the bulb on, or a ping
            # detects a power loss).
            #
            # Power/Dimmer/CT yes, Hue/Sat (colour wheel) no: the wheel is a
            # widget floating on top of the page, and the whole page sent in
            # the middle of its drag closes it. The brightness and colour
            # temperature sliders are part of the page itself, so a page sent
            # during their drag only moves them where they are.
            if refresh_detail && self.open_detail_id == id
                self.send_detail(id)
            end
            # OUR pages follow by binding (brain.on_light_changed); joBr99's by
            # the commands above. Both, because presence of the runtime is the
            # mode and this file does not know which .tft is flashed.
            if changed && self.on_change != nil
                self.on_change(id, refresh_detail)
            end
            # the real save() (flash I/O) only now, after every visual
            # update has already been sent to the TFT — see the comment
            # above, near persist.setmember().
            #
            # A save that falls over (the heap runs out, the flash is
            # full) raises, and the report was already taken and shown:
            # it is a line in the log, not an exception that unwinds the
            # caller (the bridge's event delivery, and the other bulbs'
            # reports after this one). The map in memory stays whole and
            # marked, so the next report that saves writes it all back.
            # The same shape as PairSign.safe_save (pair_sign.be), kept
            # local on purpose: this file is the joBr99 stack's and does
            # not depend on what loads before it.
            if changed
                try
                    persist.save()
                except .. as e, m
                    log("LIGHT: saving the state of " + id + " failed (" + str(e) + ": " + str(m) + ")", 1)
                end
            end
        end
    end

    #################################################################
    # to the TFT
    #################################################################

    # "lightbulb" icon glyph in joBr99's icon font — codepoint taken from
    # reference/joBr99/luibackend/icon_mapping.py ('lightbulb' entry,
    # U+E334), not invented.
    static ICON_LIGHTBULB = ""

    # blue-grey (rgb_dec565 of [68,115,158], default_color_off of the
    # original pages.py) when off.
    static ICON_OFF_COLOR = 17299

    # standard HSV->RGB (h/s/v in 0.0-1.0) — same algorithm as the
    # colorsys.hsv_to_rgb the original backend uses (helper.py:hsv2rgb),
    # reimplemented in Berry since that lib is not available here. Not
    # joBr99 protocol, just standard colour-space conversion.
    def hsv_to_rgb565(h, s, v)
        var r, g, b
        if s <= 0
            r = v
            g = v
            b = v
        else
            var hh = h * 6
            var i = int(hh)
            var f = hh - i
            var p = v * (1 - s)
            var q = v * (1 - s * f)
            var t = v * (1 - s * (1 - f))
            i = i % 6
            if i == 0
                r = v  g = t  b = p
            elif i == 1
                r = q  g = v  b = p
            elif i == 2
                r = p  g = v  b = t
            elif i == 3
                r = p  g = q  b = v
            elif i == 4
                r = t  g = p  b = v
            else
                r = v  g = p  b = q
            end
        end
        var ri = int(r * 255)
        var gi = int(g * 255)
        var bi = int(b * 255)
        return ((ri >> 3) << 11) | ((gi >> 2) << 5) | (bi >> 3)
    end

    # fallback warm yellow for when saturation is very low — with sat near
    # 0 the faithful computation gives almost pure white, which was
    # invisible/without contrast on screen (confirmed live: the "on" icon
    # looked off). Same value as the old fixed ON_COLOR.
    static ICON_LOW_SAT_COLOR = 65222
    static ICON_LOW_SAT_THRESHOLD = 25  # out of 254 — below this, use the yellow

    # icon faithful to the bulb's real colour (Hue/Sat) when on, instead of
    # a fixed yellow — user's request. Full brightness (v=1) in the
    # computation, does not darken along with the Dimmer (the colour itself
    # stays visible this way).
    def icon_color565(id)
        var d = self.devices[id]
        if d["power"] == 0  return self.ICON_OFF_COLOR end
        if d["sat"] < self.ICON_LOW_SAT_THRESHOLD  return self.ICON_LOW_SAT_COLOR end
        return self.hsv_to_rgb565(real(d["hue"]) / 254, real(d["sat"]) / 254, 1)
    end

    # card chunk in the original generate_entities_item format
    # (pages.py ~471): ~{type}~{id}~{icon}~{color}~{name}~{value}
    def card_chunk(id)
        import string
        var d = self.devices[id]
        return string.format("~light~%s~%s~%d~%s~%d",
            id, self.ICON_LIGHTBULB, self.icon_color565(id), d["name"], d["power"])
    end

    def send_detail(id)
        import string
        var d = self.devices[id]
        # inverse of the set_brightness remapping, so the slider position
        # shown matches the real brightness (without this, the bar would
        # always sit between 5%-95% even at the real extremes)
        var raw_bri_pct = d["bri"] * 100 / 254
        var bri_pct = (raw_bri_pct - self.BRI_MIN_PCT) * 100 / (self.BRI_MAX_PCT - self.BRI_MIN_PCT)
        if bri_pct < 0  bri_pct = 0 end
        if bri_pct > 100  bri_pct = 100 end
        var ct_pct = (d["ct"] - self.CT_MIN) * 100 / (self.CT_MAX - self.CT_MIN)
        # enables both: colour temperature slider (`color_temp`) AND colour
        # wheel (`color`) — in the original protocol the two fields are
        # independent, a bulb that supports both modes shows both on screen
        # (not one-or-the-other). This bulb really is RGB+W/C (confirmed in
        # the manual and by testing its real CT range, see CT_MIN/CT_MAX
        # above).
        # text labels of the controls — color_translation,
        # color_temp_translation, brightness_translation fields (pages.py
        # generate_light_detail_page). They are UI content shown on the
        # panel, so they stay in the panel's language.
        var cmd = string.format("entityUpdateDetail~%s~~%d~%d~%d~%d~enable~Color~Color temperature~Brightness~disable",
            id, self.icon_color565(id), d["power"], bri_pct, ct_pct)
        self.nx.send(cmd)
    end

end
