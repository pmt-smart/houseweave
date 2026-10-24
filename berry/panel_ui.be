# panel_ui.be -- the panel's screens beyond the plan: a zone's own screen, the
# list and all of its views, Help and the keyboard's targets, as what each one
# writes on the glass and what each touch on it does.
#
# The only implementation of the views: the simulator runs this file too, on
# Tasmota's Berry VM (libs/nspanel-sim/vm). berry/test/vectors/ui.json holds
# runs of events on the Living room and every effect each one has, which
# berry/test/test_panel_ui.be replays.
#
# A screen is its WRITES: the list and the zone pages are templates whose
# slots are bindings of the generated runtime, so a view is exactly the values
# it writes. An event returns effects, in order, and the caller carries them
# out (brain.be):
#
#   ["page", name]              go to that page (the writes after it land on it)
#   ["set", path, value]        write a binding
#   ["command", plan, intent, ids]  send a command plan (panel_store.be) to the network;
#                               the Zigbee devices it reaches wait for its confirmation
#   ["identify", id] / ["leave", id]
#   ["plan", screen]            back to the plan
#   ["save"] / ["prefs"] / ["button", n, mode] / ["pair", zone] / ["pairStop"]
#   ["redraw", ms]              load the page on show again after ms: the lock's dots clear
#   ["startup", id]             write StartUpOnOff = 0: a new lamp comes back off after a power cut
#   ["query", id]               ask the device what it is: its model, from ZbInfo
#   ["wifi", op, ...]           the Wi-Fi (panel_wifi.be): off, on, forget, web, stopWeb, scan,
#                               join (ssid, password, channel, bssid), endJoin and endSearch
#   ["zigbee", op, ...]         the Zigbee (zigbee_pairing.be): mode (m), discover, pair (mac),
#                               forget and endPair
#   ["show"]                    the view on top, drawn after the effects before it ran: what
#                               the Wi-Fi shows is the state they left
#
# Loaded with load(), after panel_store.be.

#@ solidify:PanelUi
class PanelUi
    # the counters' order: the kinds as PanelStore.KIND_ORDER has them,
    # and each kind by relay 1, relay 2 and none
    # anything beyond on and off: what a detail page is for (level | ct | color)
    static var LEVELS = 14
    # the pattern: the fewest dots, the wrong tries before a
    # wait, the first wait and the last, and how long the dots stay red
    static var PATTERN_MIN = 4
    static var LOCK_TRIES = 5
    static var LOCK_WAIT_MS = 30000
    static var LOCK_WAIT_MAX_MS = 300000
    static var LOAD_ECHO_MS = 3000    # a page this side loaded and drew on: its own load event comes back within this, and finds it drawn
    static var FRESH_MS = 180000    # a drawing older than this is asked again for what is sensitive
    static var WRONG_MS = 1000
    # how long a search for new devices runs: what ZbPermitJoin 1 opens the network for
    static var PAIR_MS = 60000
    static var COUNT_MAX_MS = 60000   # the longest wait a row counts down: more is no wait of ours
    # A confirmation's answer sits where the row that asked for it was, so the
    # second tap of a double tap would answer it: its first moments take no tap
    static var CONFIRM_GUARD_MS = 700
    # the networks the panel cannot join (ESP-IDF's wifi_auth_mode_t): the
    # Enterprise ones, which ask for a user name, and DPP
    static var WIFI_UNSUPPORTED = [5, 10, 13, 14, 15, 16]
    # how long a target set on a thermostat's page is shown before the device's own word is
    static var DRAFT_MS = 3000

    var store     # PanelStore
    var shape     # {"pages": {plan, list, zone, help, keyboard}, "listRows", "zoneRows", "counters", "helpLines"}
    var items     # f() -> the project's Settings items, [label, key, [help lines]]: read when a view needs them
    var prefs     # {"editing", "buttons", "liveSliderUpdate", "keypad", "flags", "pattern"}
    var live      # device id -> "on", "off", "noanswer"
    var unconfirmed   # device id -> [intent, stamp]: a command not confirmed yet (the plan's)
    var doubt     # device id -> true: no communication, the lamp with "?" (the plan's)
    var relay_on  # the panel's two relays
    var stack     # the views on show over the plan: {"view": [...], "page": n}
    var plan_screen   # the plan's screen a view came from
    var editing   # what the keyboard edits for a view, or nil
    var page      # the page the glass shows, as far as this side has said
    var blank     # the page just loaded that nothing is drawn on yet: it holds what the .tft starts with
    var loaded    # [page, until]: a page this side loaded and drew on at once, until when its own load event is not a reason to draw
    var levels    # what each device's sliders were last left at, 0..100: [bri, ct, hue]
    var unlocked  # the pattern was drawn since the screensaver last came up: what is sensitive takes it (fresh)
    var unlocked_at   # when it was last drawn: the sensitive actions ask again after FRESH_MS
    var rescue    # the boot the rescue opened: no pattern is asked until the restart
    var fails     # wrong tries in a row
    var rounds    # the waits so far
    var wait_until    # when the current wait ends, in the clock's ms
    var confirm_at    # when the confirmation on show opened
    var clearing  # the dots are being cleared: a try before the page is back is a stray touch
    var lock_msg  # what the lock's title says after a try, until the next
    var hash_fn   # f(salt, pattern) -> hex: SHA-256; the tests pass their own
    var info_fn   # f() -> [[label, value, tap?]]: what runs on the panel, for the Info (Brain.panel_info)
    var salt_fn   # f() -> a fresh salt
    var now_fn    # f() -> ms
    var pairing   # the search for new devices: {"zone", "until", "found": [[id, status]]}, or nil
    var late      # id -> [zone, relay, the device it replaces, or nil]: a device found whose search ended before its interview did
    var wireless  # the Wi-Fi and the Zigbee's mode, as Wireless settings shows them (panel_wifi.be), or nil
    var zigbee    # the Zigbee's mode, its bridge and the pairing (zigbee_pairing.be), or nil
    var network   # the network as the pages see it (panel_zigbee.be), for what it lacks, or nil
    var mqtt      # the MQTT, as Wireless settings shows it and saves it (panel_mqtt.be), or nil
    var mqtt_draft # the MQTT being edited, saved together: {"host", "port", "user", "discovery", "expire"[, "password"]}, or nil
    var backup    # the configuration kept on the house's release server (panel_backup.be), or nil
    var target_draft  # device id -> [tenths, when]: a target the + and the - of a thermostat's page set, shown until the device says its own
    # Views of other files' (the clock's, panel_clock.be): each says which kinds of view it shows (shows, view, opened),
    # what Main settings' row of a key of its says (hint), which verbs it answers (acts, act) and the keyboard of its
    # target, the verb again (keyboard, commit). They are handed this PanelUi, and list_view, which has few constants
    # left, only asks them
    var providers
    var gate      # the gate that holds the devices of a bridge that is not ready (panel_gate.be), or nil
    var schedule  # the schedule's screens (panel_schedule_view.be), or nil: a device's Schedule row, and its pages for an event
    var alarm     # the alarm's screens (panel_alarm_view.be), or nil: two rows of Screens, and the rows of a device's options
    var tones     # the slots of the list whose hint or tail is in a colour of its own now: path -> true; the others are the theme's quiet one

    def init(store, shape, items, prefs)
        self.store = store
        self.shape = shape
        self.items = items
        self.prefs = prefs != nil ? prefs : PanelUi.default_prefs()
        self.live = {}
        self.unconfirmed = {}
        self.tones = {}
        self.doubt = {}
        self.relay_on = [true, true]
        self.stack = []
        self.plan_screen = "home"
        self.editing = nil
        self.page = ""
        self.levels = {}
        self.providers = []
        self.alarm = nil
        if !self.prefs.contains("pattern") self.prefs["pattern"] = [] end
        if !self.prefs.contains("screensaver") self.prefs["screensaver"] = PanelUi.SAVER_DEFAULT.copy() end
        self.unlocked = false
        self.rescue = false
        self.fails = 0
        self.rounds = 0
        self.wait_until = nil
        self.clearing = false
        self.lock_msg = ""
        self.pairing = nil
        self.late = {}
        self.wireless = nil
        self.zigbee = nil
        self.network = nil
        self.mqtt = nil
        self.mqtt_draft = nil
        self.backup = nil
        self.target_draft = {}
        self.hash_fn = / salt, pattern -> PanelUi.sha256_hex(salt + pattern)
        self.salt_fn = def ()
            import crypto
            import string
            return string.tolower(crypto.random(8).tohex())
        end
        self.now_fn = def ()
            import global
            return global.tasmota.millis()
        end
    end

    static def default_prefs()
        return {"editing": true, "buttons": ["relay", "relay"], "liveSliderUpdate": false, "keypad": false, "flags": {}, "pattern": [],
                "screensaver": PanelUi.SAVER_DEFAULT.copy()}
    end

    # A pair of the screensaver's times as saved: one each, from its own list
    def valid_saver(t)
        if !isinstance(t, list) || size(t) != 2 return false end
        return PanelUi.SAVER_TIMES[0].find(t[0]) != nil && PanelUi.SAVER_TIMES[1].find(t[1]) != nil
    end

    # a time of the screensaver's, as its lists write it: "30 s", "5 min"
    static def duration(s) return s < 60 ? str(s) + " s" : str(s / 60) + " min" end

    # --- the pattern ---------------------------------------------------------------

    # SHA-256 of a string, as lowercase hex: Tasmota's own crypto module
    static def sha256_hex(text)
        import crypto
        import string
        var h = crypto.SHA256()
        h.update(bytes().fromstring(text))
        return string.tolower(h.out().tohex())
    end

    # The dots a stroke went through, as the phone counts them: a dot the finger
    # passed over between two it joined in a line is in the pattern too, unless
    # it already was. What is not a dot, or repeats one, is dropped.
    static def normalize_pattern(drawn)
        import string
        var out = []
        for i: 0 .. size(drawn) - 1
            var d = string.byte(drawn[i]) - 48
            if d < 1 || d > 9 || out.find(d) != nil continue end
            if size(out) > 0
                var prev = out[size(out) - 1]
                var r = (prev - 1) / 3 + (d - 1) / 3
                var c = (prev - 1) % 3 + (d - 1) % 3
                # both sums even: a row, a column or a diagonal apart, with a dot between
                if r % 2 == 0 && c % 2 == 0
                    var mid = (r / 2) * 3 + c / 2 + 1
                    if out.find(mid) == nil out.push(mid) end
                end
            end
            out.push(d)
        end
        var s = ""
        for d: out s += str(d) end
        return s
    end

    def now()
        var f = self.now_fn
        return f()
    end

    # Whether the clock is still before `t`, a time at most `span` ms ahead of
    # the moment it was set. The clock is tasmota.millis(), a 32-bit int that turns
    # negative after 24.8 days of uptime and wraps back after 49.7, so a time is
    # read by the difference, and a difference longer than it can be is the wrap,
    # not time left: a lock that compared by < refused the right pattern from day
    # 24.8 to day 49.7, and a wait nobody looked at again would come back 24.8
    # days after it ended.
    def before(t, span)
        if t == nil return false end
        var left = t - self.now()
        return left > 0 && left <= span
    end

    # the seconds a wait on show has left, rounded up, or nil for none running
    def seconds_left(t)
        if !self.before(t, PanelUi.COUNT_MAX_MS) return nil end
        return (t - self.now() + 999) / 1000
    end

    # A view on show whose rows count seconds down: a network being joined.
    # brain draws it again every second while it does.
    def counting()
        var entry = self.top()
        if entry == nil || self.editing != nil return false end
        var v = entry["view"][0]
        if v == "wifiJoin"
            var j = self.wireless_state()["join"]
            return j != nil && j["state"] == "joining" && self.seconds_left(j.find("until")) != nil
        end
        return false
    end

    # the lock's wait, still running; one that ended is forgotten
    def waiting()
        if self.before(self.wait_until, PanelUi.LOCK_WAIT_MAX_MS) return true end
        self.wait_until = nil
        return false
    end

    # Main settings, through the pattern when there is one, every time a plan opens it
    def open_settings() return self.open_locked("settings") end

    # Wireless settings, by the swipe up on a plan: through the
    # same pattern, every time too
    def open_wireless() return self.open_locked("wireless") end

    # A view the pattern guards: the lock first, which opens the view when the
    # right pattern is drawn (lock_try), every time a plan opens it. Inside them the pattern
    # is asked again only for what is sensitive (fresh). In the boot the rescue
    # opened, none
    def open_locked(kind)
        if size(self.prefs["pattern"]) == 2 && !self.rescue
            self.lock_msg = ""
            return self.open(["lock", "enter", kind])
        end
        return self.open([kind])
    end

    # The screensaver came up: the last drawing does not stand for what is
    # sensitive (fresh) any longer. Main settings asks for the pattern each time anyway
    # (open_locked). Editing stays as it was: the pattern is only the way into
    # Main settings.
    def sleep()
        self.unlocked = false
        # a search left open behind the screensaver ends with it
        return self.stop_pairing()
    end

    # the lock: its title, and the dots unlit; the glass lights them itself
    def render_lock(view)
        var mode = view[1]
        var title = self.lock_msg
        if mode == "enter" && self.waiting() title = self.wait_text() end
        if title == "" title = mode == "new" ? "New pattern" : mode == "again" ? "Draw it again" : "Draw pattern" end
        return [["set", "$lock.title", title], ["set", "$lock.wrong", 0]]
    end

    def wait_text()
        return "Wait " + str((self.wait_until - self.now() + 999) / 1000) + " s"
    end

    # The finger let go of the lock: `drawn` is the dots it went through, one
    # digit each, as the glass counted them.
    def lock_try(drawn)
        var entry = self.top()
        if entry == nil || entry["view"][0] != "lock" || self.clearing return [] end
        var seq = PanelUi.normalize_pattern(str(drawn))
        if seq == "" return [] end
        var mode = entry["view"][1]
        if mode == "enter"
            var now = self.now()
            if self.waiting() return self.wrong(self.wait_text(), true) end
            var h = self.hash_fn
            if h(self.prefs["pattern"][0], seq) == self.prefs["pattern"][1]
                self.unlocked = true
                self.unlocked_at = now
                self.fails = 0
                self.rounds = 0
                # what the lock stood in front of: Main settings, Wireless settings,
                # or a sensitive action, carried out now
                var guarded = size(entry["view"]) > 2 ? entry["view"][2] : "settings"
                self.stack.remove(size(self.stack) - 1)
                if isinstance(guarded, list) return self.act(guarded) end
                return self.open([guarded])
            end
            self.fails += 1
            if self.fails < PanelUi.LOCK_TRIES return self.wrong("Wrong pattern", false) end
            var wait = PanelUi.LOCK_WAIT_MS
            for i: 1 .. self.rounds wait *= 2 end
            if wait > PanelUi.LOCK_WAIT_MAX_MS wait = PanelUi.LOCK_WAIT_MAX_MS end
            self.wait_until = now + wait
            self.rounds += 1
            self.fails = 0
            return self.wrong(self.wait_text(), true)
        end
        if mode == "new"
            if size(seq) < PanelUi.PATTERN_MIN return self.wrong(str(PanelUi.PATTERN_MIN) + " dots or more", false) end
            entry["view"] = ["lock", "again", seq]
            self.lock_msg = ""
            self.clearing = true
            # the page loads again holding nothing: its load event draws it, and is not the echo of an earlier drawing
            self.loaded = nil
            return [["redraw", 0]]
        end
        if seq != entry["view"][2]
            entry["view"] = ["lock", "new"]
            return self.wrong("Not the same", false)
        end
        var sf = self.salt_fn
        var h = self.hash_fn
        var salt = sf()
        self.prefs["pattern"] = [salt, h(salt, seq)]
        self.unlocked = true
        self.unlocked_at = self.now()
        # the lock, and the pattern's options when it was a change
        self.stack.remove(size(self.stack) - 1)
        if self.top() != nil && self.top()["view"][0] == "patternOptions" self.stack.remove(size(self.stack) - 1) end
        var out = [["prefs"]]
        for e: self.show() out.push(e) end
        return out
    end

    # A try that did not open: the dots go red, the title says why, and the page
    # clears. A wait is not kept as words: the title counts it down from the clock.
    def wrong(msg, wait)
        self.lock_msg = wait ? "" : msg
        self.clearing = true
        self.loaded = nil
        return [["set", "$lock.wrong", 1], ["set", "$lock.title", msg], ["redraw", PanelUi.WRONG_MS]]
    end

    # --- what a device looks like, in a list -----------------------------------------------

    static def kind_icon(kind, on)
        if kind == "light" return on ? "lightOn" : "lightOff" end
        if kind == "plug" return on ? "plugOn" : "plugOff" end
        if kind == "switch" return on ? "switchOn" : "switchOff" end
        if kind == "fan" return on ? "fanOn" : "fanOff" end
        if kind == "cover" return on ? "coverOn" : "coverOff" end
        # a blind that is a window or a gate
        if kind == "window" return on ? "windowOn" : "windowOff" end
        if kind == "gate" return on ? "gateOn" : "gateOff" end
        if kind == "thermostat" return on ? "thermostatOn" : "thermostatOff" end
        if kind == "sensor" return "sensor" end
        if kind == "remote" return "remote" end
        return "power"
    end

    # The icon of a kind with no communication or no power: every
    # kind that acts has its own; nil for the others, which keep their one icon
    static def state_icon(kind, state)
        var silent = state == "noanswer"
        if kind == "light" return silent ? "lightNoAnswer" : "lightNoPower" end
        if kind == "plug" return silent ? "plugNoAnswer" : "plugNoPower" end
        if kind == "switch" return silent ? "switchNoAnswer" : "switchNoPower" end
        if kind == "fan" return silent ? "fanNoAnswer" : "fanNoPower" end
        if kind == "cover" return silent ? "coverNoAnswer" : "coverNoPower" end
        if kind == "window" return silent ? "windowNoAnswer" : "windowNoPower" end
        if kind == "gate" return silent ? "gateNoAnswer" : "gateNoPower" end
        if kind == "thermostat" return silent ? "thermostatNoAnswer" : "thermostatNoPower" end
        return nil
    end

    # [state, icon, color] of a device, as its row shows it. No words: the row
    # has none, and a device with no power or no
    # communication has an icon of its own. One whose command waits for
    # its confirmation is in the pending colour, the plan's.
    def device_look(id)
        var device = self.store.find_device(id)
        var kind = device != nil ? device[2] : "generic"
        var state
        if PanelStore.is_relay_id(id)
            state = self.relay_on[(device != nil ? device[9] : 1) - 1] ? "on" : "off"
        elif self.store.unpowered(id, self.relay_on)
            state = "nopower"
        elif self.doubt.contains(id)
            state = "noanswer"
        else
            state = self.live.find(id, "unknown")
        end
        var look = PanelStore.look_of(device)
        var icon = state == "noanswer" || state == "nopower" ? PanelUi.state_icon(look, state) : nil
        if icon == nil  icon = PanelUi.kind_icon(look, state == "on") end
        var color = state == "on" ? "icon-low-sat" : "icon-off"
        # a thermostat that heats now is the warm tone, under a command on its way
        if state == "on" && kind == "thermostat" && self.thermostat_heating(id) color = "icon-heating" end
        # a blind: the accent while it moves, green all the way up, and unlit otherwise, the open glyph part of the way
        if kind == "cover" && state != "nopower" && state != "noanswer"  color = self.cover_color([id], state == "on") end
        if state != "nopower" && self.unconfirmed.contains(id) color = "accent-blue" end
        return [state, icon, color]
    end

    # a device's place, as its options' Position... says it: the screen's own
    # place of its slot, "2,5"
    static def place_text(store, zone, slot)
        if slot == 0 return "" end
        return PanelText.format_place(store.slot_place(zone, slot))
    end

    # the zone's members' ids in the order of the ceiling: by their slot, the
    # ones with none last
    static def members_in_order(zone)
        var members = zone["members"]
        var out = []
        for dev: PanelStore.member_ids(members)
            var key = members[dev] != 0 ? members[dev] : 1000000
            var i = size(out)
            while i > 0
                var o = members[out[i - 1]]
                if (o != 0 ? o : 1000000) <= key break end
                i -= 1
            end
            out.insert(i, dev)
        end
        return out
    end

    # a zone's groups, a kind with the relay that switches or powers it, and how
    # many of each, in the counters' order: [[kind, relay, n], ...]
    def zone_groups(zone)
        var out = []
        for g: self.store.groups_of(PanelStore.member_ids(zone["members"])) out.push([g[0], g[1], size(g[2])]) end
        return out
    end

    # a zone's colour, as its row's hint says it: "Blue 60%", or "Default"
    static def color_name(value)
        if value == 0 return "Default" end
        return ["Default", "Blue", "Teal", "Amber", "Purple"][value / 3] + " " + str([100, 60, 30][value % 3]) + "%"
    end

    # a value as a row reads it, capitalised: "places" is "Places", "light" is "Light"
    static def capital(word)
        import string
        return string.toupper(word[0]) + word[1 ..]
    end

    # a device the search found, among its [id, state] entries
    static def found_in(found, id)
        for f: found
            if f[0] == id return true end
        end
        return false
    end

    static def plural(n, one, many)
        return str(n) + " " + (n == 1 ? one : many)
    end

    # what a kind is called in a joint mode's title: "Middle · 12 lamps"
    static def kind_words(kind)
        if kind == "light" return ["lamp", "lamps"] end
        if kind == "switch" return ["switch", "switches"] end
        if kind == "generic" return ["device", "devices"] end
        return [kind, kind + "s"]
    end

    # a slider's position as the level on the wire, the way light.be sends it
    static def level_for(dim, pct, ct_min, ct_max)
        var p = int(pct + 0.5)
        if p < 0 p = 0 end
        if p > 100 p = 100 end
        if dim == "bri" return ["Dimmer", (5 + (90 * p) / 100) * 254 / 100] end
        if dim == "ct" return ["CT", ct_min + ((ct_max - ct_min) * p) / 100] end
        return ["Hue", (p * 254) / 100]
    end

    # the middle of the numbers: where a joint mode's slider starts
    static def median(values)
        if size(values) == 0 return 50 end
        var sorted = PanelStore.sorted(values)
        return sorted[(size(sorted) - 1) / 2]
    end

    # --- going places ----------------------------------------------------------------------------

    def top()
        return size(self.stack) > 0 ? self.stack[size(self.stack) - 1] : nil
    end

    # A list view as list_view builds it, when the view is one: the page it goes
    # to and what it writes both come from it, and it is built once for the two.
    # nil for the views that are not lists.
    def list_of(view)
        var kind = view[0]
        if kind == "zone" || kind == "help" || kind == "helpText" || kind == "detail" || kind == "lock" || kind == "color" || kind == "thermostat" || kind == "cover" || kind == "calendar" || kind == "alarm" || kind == "notifs" return nil end
        return self.list_view(view)
    end

    # the page a view is drawn on; `lv` is its list view, when the caller built it
    def page_of(view, lv)
        if view[0] == "zone" return self.shape["pages"]["zone"] end
        if view[0] == "help" || view[0] == "helpText" return self.shape["pages"]["help"] end
        if view[0] == "detail" return self.shape["pages"]["detail"] end
        if view[0] == "thermostat" return self.shape["pages"]["thermostat"] end
        if view[0] == "cover" return self.shape["pages"].find("cover") end
        # the Screens on the house's page, under its icons, when the layout has it; the mesh on its own, under its cog, and on
        # the list where the layout has none, its cog the first row
        if view[0] == "screens" && self.shape["pages"].find("house") != nil return self.shape["pages"]["house"] end
        if view[0] == "house" && self.shape["pages"].find("mesh") != nil return self.shape["pages"]["mesh"] end
        if view[0] == "lock" return self.shape["pages"].find("lock", self.shape["pages"]["list"]) end
        # the colour picker is drawn where the cards go
        if view[0] == "color" || view[0] == "calendar" || view[0] == "alarm" || view[0] == "notifs" return self.shape["pages"]["plan"] end
        # the web setup and the hotspot on the QR's page, when the layout has one,
        # while they have a code to draw; a hotspot that closed
        # says so on the dialog's page
        var qr = self.shape["pages"].find("qr")
        if PanelUi.on_qr(view[0]) && qr != nil
            var drawn = lv != nil ? lv : self.list_view(view)
            if size(drawn) > 4 && drawn[4] != nil return qr end
        end
        # a confirmation on its page, when the layout has one, and
        # the web setup's sentence on the same page
        if PanelUi.on_dialog(view[0]) && self.shape["pages"].find("dialog") != nil return self.shape["pages"]["dialog"] end
        # the one list, its rows the value under the name, on both layouts; its twin without the rail, for a
        # view of one page, is gone
        return self.shape["pages"]["list"]
    end

    def open(view)
        var out = self.push_view(view)
        var prov = self.provider_of(view[0], nil)
        if prov != nil  prov.opened(self, view) end
        return out + self.show()
    end

    # The provider of a kind of view, or of Main settings' row of a key, or nil
    def provider_of(kind, key)
        for p: self.providers
            if kind != nil ? p.shows(kind) : p.hint(key) != nil return p end
        end
        return nil
    end

    # the provider whose verb, and keyboard target, this is, or nil
    def provider_for(verb)
        for p: self.providers
            if p.acts(verb) return p end
        end
        return nil
    end

    # A view on top, not drawn yet: for a view drawn once the effects before
    # it ran, with ["show"] after them
    def push_view(view)
        var out = []
        if size(self.stack) >= 5
            # the oldest view gives its place; a search it was ends with it
            if self.stack[0]["view"][0] == "pair" out = self.stop_pairing() end
            self.stack.remove(0)
        end
        self.stack.push({"view": view, "page": 0})
        if PanelUi.on_dialog(view[0]) self.confirm_at = self.now() end
        return out
    end

    # how many rows a page of the view shows, on the page it goes to
    def rows_for(view)
        if view[0] == "screens" && self.shape["pages"].find("house") != nil return self.shape["houseRows"] end
        if view[0] == "house" && self.shape["pages"].find("mesh") != nil return self.shape["meshRows"] end
        return self.shape["listRows"]
    end

    # The views drawn on the QR's page: the web setup, whose code
    # the phone joins the panel's network with
    static def on_qr(kind) return kind == "wifiWeb" || kind == "wifiHotspot" || kind == "houseRemote" end

    # The Wi-Fi QR a phone's camera reads: WIFI:T:WPA;S:<ssid>;P:<pw>;;
    # or, with no password, WIFI:T:nopass;S:<ssid>;; -- each \ ; , : and " of
    # the two escaped with a backslash, as the format asks. nil when it cannot be
    # written whole: longer than the page's code takes (`max`), or with a double
    # quote, which the glass cannot be sent (PanelRuntime.quote drops one)
    static def wifi_qr(ssid, password, max)
        if ssid == nil || ssid == "" return nil end
        def esc(s)
            var out = ""
            for i: 0 .. size(s) - 1
                var c = s[i]
                if c == "\"" return nil end
                if c == "\\" || c == ";" || c == "," || c == ":" out += "\\" end
                out += c
            end
            return out
        end
        var s = esc(ssid)
        if s == nil return nil end
        var code
        if password == nil || password == ""
            code = "WIFI:T:nopass;S:" + s + ";;"
        else
            var p = esc(password)
            if p == nil return nil end
            code = "WIFI:T:WPA;S:" + s + ";P:" + p + ";;"
        end
        if max != nil && size(code) > max return nil end
        return code
    end

    # The views drawn on the dialog's page: a sentence, and two answers where the
    # row that opened them may have been, so their first moments take no tap
    static def on_dialog(kind)
        return kind == "confirm" || kind == "wifiWeb" || kind == "patternOffer" ||
               kind == "zigbeePairBlink" || kind == "zigbeePairWifi" || kind == "wifiHotspot" ||
               kind == "eventDelete" || kind == "eventRefused" || kind == "alarmArm" || kind == "alarmEvent" || kind == "alarmClear" || kind == "houseRemoteAsk"
    end

    def back()
        var out = []
        var leaving = nil
        if size(self.stack) > 0
            # a join's view closing takes the password typed with it, and a
            # pairing's what its search found
            if self.top()["view"][0] == "wifiJoin" out.push(["wifi", "endJoin"]) end
            if self.top()["view"][0] == "zigbeePair" out.push(["zigbee", "endPair"]) end
            if self.top()["view"][0] == "wifiSearch" out.push(["wifi", "endSearch"]) end
            # the question whether the node identifies itself, left: not the one; the Wi-Fi
            # offered, left: not now, and the pairing is over. The pairing may draw
            # another view as it takes that: the view on top is drawn after it
            leaving = self.top()["view"][0]
            if leaving == "zigbeePairBlink" out.push(["zigbee", "notBlinking"]) end
            if leaving == "zigbeePairWifi" out.push(["zigbee", "done"]) end
            if leaving == "thermostatSettings" self.thermostat_leave(self.top()["view"][1]) end
            self.stack.remove(size(self.stack) - 1)
        end
        if size(self.stack) == 0 return out + self.to_plan() end
        if leaving == "zigbeePairBlink" || leaving == "zigbeePairWifi" return out + [["show"]] end
        return out + self.show()
    end

    # The views all behind the plan, which is up or going up: the stack goes, and
    # a keyboard a view left open with it, its OK not the plan's; a search for
    # devices left open ends, the groups waiting for no search nobody sees; and a
    # Wi-Fi join or search left open lets go of what it held, a password typed
    # among it
    def leave_views()
        var joining = false
        var searching = false
        for e: self.stack
            if e["view"][0] == "wifiJoin" joining = true end
            if e["view"][0] == "wifiSearch" searching = true end
        end
        self.stack = []
        self.editing = nil
        var out = self.stop_pairing()
        if joining out.push(["wifi", "endJoin"]) end
        if searching out.push(["wifi", "endSearch"]) end
        return out
    end

    def to_plan()
        var out = self.leave_views()
        self.page = self.shape["pages"]["plan"]
        out.push(["page", self.page])
        out.push(["plan", self.plan_screen])
        return out
    end

    def show()
        var entry = self.top()
        if entry == nil return self.to_plan() end
        var lv = self.list_of(entry["view"])
        var page = self.page_of(entry["view"], lv)
        var out = []
        if page != self.page
            out.push(["page", page])
            self.page = page
            self.blank = page
            self.loaded = [page, self.now() + PanelUi.LOAD_ECHO_MS]
        end
        for e: self.render(entry, lv) out.push(e) end
        return out
    end

    # the glass says a page loaded; a list reached by the finger alone is Settings
    def shown(page)
        self.page = page
        var echo = self.loaded
        self.loaded = nil
        var entry = self.top()
        if echo != nil && echo[0] == page && entry != nil && self.before(echo[1], PanelUi.LOAD_ECHO_MS)
            # this side loaded it and drew on it at once, and the writes after a page land on it: its own load event finds it drawn
            if entry["view"][0] == "lock" self.clearing = false end
            return []
        end
        # it loaded just now: what is drawn first on it finds what the .tft starts with
        self.blank = page
        var lv = entry != nil ? self.list_of(entry["view"]) : nil
        if entry == nil || self.page_of(entry["view"], lv) != page
            if page == self.shape["pages"]["list"] return self.open_settings() end
            self.blank = nil
            return []
        end
        if entry["view"][0] == "lock" self.clearing = false end
        return self.render(entry, lv)
    end

    # --- what each view writes ---------------------------------------------------------------------

    # what a view writes; `lv` is its list view, when the caller built it
    def render(entry, lv)
        var view = entry["view"]
        # the first thing drawn on a page that has just loaded is the one that finds it as the .tft starts
        var blank = self.blank != nil && self.blank == self.page
        self.blank = nil
        if view[0] == "zone" return self.render_zone(entry) end
        if view[0] == "help" || view[0] == "helpText" return self.render_help(view) end
        if view[0] == "detail" return self.render_detail(view) end
        if view[0] == "thermostat" return self.render_thermostat(view) end
        if view[0] == "cover" return self.render_cover(view) end
        if view[0] == "lock" return self.render_lock(view) end
        if view[0] == "calendar" return self.schedule != nil ? [["calendar", self.schedule]] : self.back() end
        if view[0] == "alarm" || view[0] == "notifs" return self.alarm != nil ? [["calendar", self.alarm.canvas(view[0])]] : self.back() end
        if view[0] == "color"
            var zone = self.store.find_zone(view[1])
            return zone != nil ? [["picker", zone["id"], zone.find("color", 0)]] : self.back()
        end
        if lv == nil lv = self.list_view(view) end
        var out = self.render_list(entry, lv[0], lv[1], lv[2], blank)
        # the house's icons, over its screens, and the mesh's cog, over its nodes
        if view[0] == "screens" && self.on_house_page()
            var hp = self.provider_of("house", nil)
            if hp != nil
                for e: hp.icon_effects(self.shape["houseIcons"], self.shape["houseIcons"]) out.push(e) end
            end
        end
        if view[0] == "house" && self.on_mesh_page()
            out.push(["set", "$mesh.cog.icon", "settings"])
            out.push(["set", "$mesh.cog.iconColor", "text-primary"])
        end
        # a confirmation's sentence, over its page's lines: the runtime breaks it
        if size(lv) > 3 && lv[3] != nil out.push(["wrap", "$dialog.lines.", lv[3]]) end
        # a QR's code and its lines, on the QR's page; a code that
        # cannot be written whole is no code at all, and the lines still say it
        if size(lv) > 4 && lv[4] != nil
            var qr = lv[4]
            out.push(["set", "$qr.code", qr["code"] != nil ? qr["code"] : ""])
            for i: 0 .. self.shape["qrLines"] - 1
                out.push(["set", "$qr.lines." + str(i), i < size(qr["lines"]) ? qr["lines"][i] : ""])
            end
        end
        return out
    end

    # A page just loaded (`blank`) starts every slot with no text and a label in the colour of a row that is off: the compiled
    # pages say so, and a test holds it for the six projects. So what would be written blank, and off, is not written there; the
    # colour of an icon with no glyph shows nowhere, and is not written at all
    def render_list(entry, title, action, rows, blank)
        var n = self.rows_for(entry["view"])
        var pages = (size(rows) + n - 1) / n
        if pages < 1 pages = 1 end
        if entry["page"] >= pages entry["page"] = pages - 1 end
        var out = [["set", "$list.title", title], ["set", "$list.actionIcon", action],
                   ["set", "$list.pageCount", pages], ["set", "$list.page", entry["page"]]]
        if blank  self.tones = {} end
        for k: 0 .. n - 1
            var i = entry["page"] * n + k
            var row = i < size(rows) ? rows[i] : nil
            var base = "$list.rows." + str(k) + "."
            var icon = row != nil ? row[0] : ""
            var label = row != nil ? row[2] : ""
            var hint = row != nil ? row[3] : ""
            var on = row != nil && row[4] == 2 ? 2 : 0
            if icon != "" || !blank  out.push(["set", base + "icon", icon]) end
            if icon != ""  out.push(["set", base + "iconColor", row[1] != "" ? row[1] : "icon-off"]) end
            if label != "" || !blank  out.push(["set", base + "label", label]) end
            if hint != "" || !blank  out.push(["set", base + "hint", hint]) end
            if on != 0 || !blank  out.push(["set", base + "on", on]) end
            # the hint's colour and the tail at the right of the name, with its own
            self.tone_slot(out, base + "hintColor", row != nil && size(row) > 7 ? row[7] : nil, "text-secondary")
            self.tone_slot(out, base + "tail", row != nil && size(row) > 8 && row[8] != "" ? row[8] : nil, "")
            self.tone_slot(out, base + "tailColor", row != nil && size(row) > 9 ? row[9] : nil, "text-secondary")
        end
        return out
    end

    def render_help(view)
        # a paragraph of the panel's own, the Tap's: broken over the lines by the panel, which measures, as a
        # confirmation's sentence is; the project's Help comes in lines its generator broke
        if view[0] == "helpText" return [["set", "$help.title", view[1]], ["wrap", "$help.lines.", view[2]]] end
        var out = [["set", "$help.title", view[1]]]
        for i: 0 .. self.shape["helpLines"] - 1
            out.push(["set", "$help.lines." + str(i), i + 2 < size(view) ? view[i + 2] : ""])
        end
        return out
    end

    # the devices a detail is for: one, or the members of one kind in a zone
    def detail_members(view)
        if view[1] == "d"
            var d = self.store.find_device(view[2])
            return d != nil ? [d] : []
        end
        var zone = self.store.find_zone(view[2])
        if zone == nil return [] end
        var out = []
        for dev: PanelStore.member_ids(zone["members"])
            var d = self.store.find_device(dev)
            if d != nil && d[2] == view[3] && d[9] == view[4] && !PanelStore.is_relay_id(d[0]) out.push(d) end
        end
        return out
    end

    # the colour temperature every member can reach: the intersection of their ranges
    static def ct_range(members)
        var lo = nil
        var hi = nil
        for d: members
            if (d[3] & PanelStore.CAP_CT) == 0 continue end
            if lo == nil || d[4] > lo lo = d[4] end
            if hi == nil || d[5] < hi hi = d[5] end
        end
        return lo == nil ? [0, 0] : [lo, hi]
    end

    def some_cap(members, cap)
        for d: members
            if (d[3] & cap) != 0 return true end
        end
        return false
    end

    def level_at(members, i, cap)
        var values = []
        for d: members
            if (d[3] & cap) != 0 && self.levels.contains(d[0]) values.push(self.levels[d[0]][i]) end
        end
        return PanelUi.median(values)
    end

    def render_detail(view)
        var members = self.detail_members(view)
        if size(members) == 0 return self.back() end
        if view[size(view) - 1] == "during" && self.schedule != nil return self.schedule.render_detail(self, view, members) end
        var title
        if view[1] == "d"
            title = members[0][1]
        else
            var zone = self.store.find_zone(view[2])
            var words = PanelUi.kind_words(view[3])
            title = zone["name"] + " · " + PanelUi.plural(size(members), words[0], words[1])
        end
        var ct = PanelUi.ct_range(members)
        var out = [["set", "$light.name", title],
                ["set", "$light.brightnessVisible", self.some_cap(members, PanelStore.CAP_LEVEL) ? 1 : 0],
                ["set", "$light.colorTempVisible", self.some_cap(members, PanelStore.CAP_CT) && ct[0] <= ct[1] ? 1 : 0],
                ["set", "$light.hueVisible", self.some_cap(members, PanelStore.CAP_COLOR) ? 1 : 0],
                ["set", "$light.brightnessPct", self.level_at(members, 0, PanelStore.CAP_LEVEL)],
                ["set", "$light.colorTempPct", self.level_at(members, 1, PanelStore.CAP_CT)],
                ["set", "$light.huePct", self.level_at(members, 2, PanelStore.CAP_COLOR)]]
        # the row under its title
        var ids = []
        for d: members  ids.push(d[0]) end
        for e: PanelPageButtons.effects(self, "$light", view, ids)  out.push(e) end
        return out
    end

    # a slider of the detail: the level for everyone of the target who has it
    def level(dim, pct)
        var entry = self.top()
        if entry == nil || entry["view"][0] != "detail" return [] end
        var view = entry["view"]
        if view[size(view) - 1] == "during" return self.schedule != nil ? self.schedule.level(dim, pct) : [] end
        var cap = dim == "bri" ? PanelStore.CAP_LEVEL : dim == "ct" ? PanelStore.CAP_CT : PanelStore.CAP_COLOR
        var members = []
        for d: self.detail_members(view)
            if (d[3] & cap) != 0 members.push(d) end
        end
        if size(members) == 0 return [] end
        var ct = dim == "ct" ? PanelUi.ct_range(members) : [0, 0]
        if dim == "ct" && ct[0] > ct[1] return [] end
        var plan = view[1] == "d" ? self.store.cap_plan(view[2], "", 0, cap, self.relay_on)
                                  : self.store.cap_plan(view[2], view[3], view[4], cap, self.relay_on)
        if plan == nil || (size(plan["zids"]) == 0 && size(plan["unicast"]) == 0) return [] end
        var i = dim == "bri" ? 0 : dim == "ct" ? 1 : 2
        var p = int(pct + 0.5)
        if p < 0 p = 0 end
        if p > 100 p = 100 end
        for d: members
            var was = self.levels.find(d[0], [50, 50, 50])
            var now = [was[0], was[1], was[2]]
            now[i] = p
            self.levels[d[0]] = now
        end
        var lv = PanelUi.level_for(dim, pct, ct[0], ct[1])
        return [["level", plan, lv[0], lv[1]]]
    end

    # whether any device of a kind in a zone does more than switch
    def group_has_levels(zone, kind, relay)
        for dev: zone["members"].keys()
            var d = self.store.find_device(dev)
            if d != nil && !PanelStore.is_relay_id(dev) && d[2] == kind && d[9] == relay && (d[3] & PanelUi.LEVELS) != 0 return true end
        end
        return false
    end

    def render_zone(entry)
        var zone = self.store.find_zone(entry["view"][1])
        if zone == nil return self.back() end
        var members = PanelUi.members_in_order(zone)
        var n = self.shape["zoneRows"]
        var pages = (size(members) + n - 1) / n
        if pages < 1 pages = 1 end
        if entry["page"] >= pages entry["page"] = pages - 1 end
        var room = self.can_add(zone)
        # "Settings", under the title: the way to the zone's settings (the
        # panel's own list is Main settings).
        var out = [["set", "$zone.title", zone["name"]], ["set", "$zone.actionIcon", room ? "add" : ""],
                   ["set", "$zone.pageCount", pages], ["set", "$zone.page", entry["page"]],
                   ["set", "$zone.name.label", "Settings"]]
        var groups = self.zone_groups(zone)
        for i: 0 .. self.shape["counters"] - 1
            var k = i < size(groups) ? groups[i] : nil
            var any_on = false
            var any_heating = false
            var ids = []
            if k != nil
                for dev: zone["members"].keys()
                    var d = self.store.find_device(dev)
                    if d != nil && d[2] == k[0] && d[9] == k[1]  ids.push(dev) end
                    if d != nil && d[2] == k[0] && d[9] == k[1] && self.device_look(dev)[0] == "on"
                        any_on = true
                        if k[0] == "thermostat" && self.thermostat_heating(dev) any_heating = true end
                    end
                end
            end
            out.push(["set", "$zone.counts." + str(i) + ".count", k != nil ? str(k[2]) : ""])
            # by the look its devices share: a counter of windows has the window's icon
            out.push(["set", "$zone.counts." + str(i) + ".icon", k != nil ? PanelUi.kind_icon(self.store.group_look(ids, k[0]), any_on) : ""])
            # lit as a device row is when any of its kind is on: the glyph alone
            # reads the same in the theme's plain icon colour, and a thermostat that heats is the warm one
            var tone = any_heating ? "icon-heating" : (any_on ? "icon-low-sat" : "icon-off")
            # the blinds' counter, as a blind's row: the accent while one moves, green with one all the way up
            if k != nil && k[0] == "cover"  tone = self.cover_color(ids, any_on) end
            out.push(["set", "$zone.counts." + str(i) + ".iconColor", tone])
        end
        for k: 0 .. n - 1
            var i = entry["page"] * n + k
            var base = "$zone.rows." + str(k) + "."
            if i >= size(members)
                out.push(["set", base + "icon", ""])
                out.push(["set", base + "iconColor", "icon-off"])
                # a zone with nothing in it says so, in its first row
                out.push(["set", base + "label", size(members) == 0 && k == 0 ? "No devices" : ""])
                out.push(["set", base + "on", 0])
                continue
            end
            var dev = members[i]
            var look = self.device_look(dev)
            var d = self.store.find_device(dev)
            out.push(["set", base + "icon", look[1]])
            out.push(["set", base + "iconColor", look[2]])
            out.push(["set", base + "label", d != nil ? d[1] : dev])
            out.push(["set", base + "on", look[0] == "on" ? 1 : 0])
        end
        return out
    end

    # --- the list's views: [title, action icon, rows]; a row is
    # [icon, color, label, hint, on, tap, hold] ------------------------------------------------------
    #
    # The icon is the glyph at the row's end, which says what a tap there does:
    # a dot chooses. A row that opens another view has none,
    # and neither has one whose action simply happens: no chevron. A setting that is on or
    # off says so as its value, "On" or "Off", with no glyph: no switch, and no lit row. `on` is 2
    # for a row that destroys, in the theme's destructive colour, and false for
    # every other: what is on, chosen or current says it in words, or with the
    # dot of a choice. A label names the thing, and its value is short: what
    # it is now.

    # The screensaver's two times, in seconds:
    # untouched this long, it comes up; on it this long, the
    # screen turns off. The first and the last of each are its least and its most.
    static var SAVER_TIMES = [[15, 30, 60, 120, 300, 600], [30, 60, 120, 300, 600, 1800]]
    static var SAVER_DEFAULT = [60, 300]

    static def on_off(on) return on ? "On" : "Off" end
    # the dot of a choice, in one colour: its shape alone says which is chosen
    static def chosen(on) return [on ? "dotOn" : "dotOff", "icon-off"] end
    static def row(glyph, label, hint, on, tap, hold)
        return [glyph != nil ? glyph[0] : "", glyph != nil ? glyph[1] : "", label, hint, on, tap, hold]
    end

    # a row's hint in a colour of its own, as a signal's number says it: the theme's token, or "" for the quiet one
    static def toned(r, token)
        while size(r) < 8  r.push(nil) end
        r[7] = token != "" ? token : nil
        return r
    end

    # and a tail at the right of its name, in a colour of its own: a node's Wi-Fi on the mesh's page
    static def tailed(r, tail, token)
        while size(r) < 10  r.push(nil) end
        r[8] = tail
        r[9] = token != "" ? token : nil
        return r
    end

    # a slot that most rows leave as the page has it (a colour of its own, a tail): written when the row has one, and `rest` written back only where a row
    # had one, so that a list with none costs no write
    def tone_slot(out, path, value, rest)
        if value != nil
            out.push(["set", path, value])
            self.tones[path] = true
        elif self.tones.contains(path)
            out.push(["set", path, rest])
            self.tones.remove(path)
        end
    end

    # --- Wireless settings ---------------------------------------------------------------

    # The Wi-Fi and the Zigbee as Wireless settings reads them (panel_wifi.be's
    # state), or, with neither known, off with nothing saved
    def wireless_state()
        if self.wireless != nil return self.wireless.state() end
        return {"saved": "", "ssid": "", "up": false, "ip": "", "quality": nil, "mac": "", "off": false,
                "web": false, "ap": "", "search": false, "reason": "", "scanning": false, "networks": nil,
                "join": nil, "zigbee": "off"}
    end

    # Zigbee is off: the + of a zone has its relays, and no search
    def zigbee_off() return self.wireless != nil && self.wireless.zigbee_mode() == "off" end

    # The panel is open to a phone: the hotspot, or the web setup's
    # access point, is up. The Home says so with an icon while it is.
    def open_to_phone()
        if self.wireless == nil return false end
        var st = self.wireless_state()
        var h = st.find("hotspot")
        return st["web"] == true || (h != nil && h["state"] == "up")
    end

    # the Wi-Fi row of Wireless settings: what it is doing, and why a network
    # saved does not come up, when the driver says
    static def wifi_hint(st)
        if st["web"] return "Web setup" end
        var h = st.find("hotspot")
        if h != nil && h["state"] == "up" return h["kind"] == "web" ? "Web setup" : "Hotspot" end
        if st["up"] return "Connected" end
        if st["saved"] == "" || st["off"] return "Off" end
        return st["reason"] != "" ? PanelUi.wifi_reason(st["reason"]) : "Connecting"
    end

    # why a join failed, as the driver says it
    static def wifi_reason(r)
        return r == "WrongPassword" ? "Wrong password" : r == "NotFound" ? "Not found" : r == "NoAddress" ? "No IP address"
             : r == "TooShort" ? "Too short" : "No answer"
    end


    # --- the Zigbee's search and pairing, from the house's page ------------

    # the Zigbee as its views read it (zigbee_pairing.be's state), or off with nothing
    def zigbee_state()
        if self.zigbee != nil return self.zigbee.state() end
        return {"mode": self.wireless != nil ? self.wireless.zigbee_mode() : "off", "peer": nil,
                "link": false, "searching": false, "sweeping": false, "found": [], "asking": nil, "chosen": nil,
                "result": nil, "offer": nil, "wifi": nil}
    end

    # whether this panel can add a node to the house: it is in a house, which it writes, with the mesh up
    def house_adds()
        import global
        var h = global.contains("house") ? global.house : nil
        return h != nil && h.up && h.writes()
    end

    # how a pairing that did not pair ended, as the list says it: short, for the
    # value's box of the EU landscape. The radio refused says who has it, as the
    # driver does: the Wi-Fi Manager for minutes, a join or a
    # search of networks for seconds
    static def zigbee_pair_said(r, holder)
        if r == "busy" return ["Busy", "another panel"] end
        if r == "noanswer" return ["No answer", "open its window"] end
        if r == "proof" || r == "key" return ["Not that one", "search again"] end
        if r == "notconfirmed" return ["Not confirmed", "pair again"] end
        if r == "timeout" return ["Too late", "pair again"] end
        if r == "radio"
            if holder == "WifiManager" return ["Wi-Fi Manager open", "try later"] end
            if holder == "Join" return ["Joining a network", "try again"] end
            if holder == "Scan" return ["Searching networks", "try again"] end
            return ["Wi-Fi busy", "try again"]
        end
        if r == "version" return ["Needs an update", "the node"] end
        if r == "noguest" return ["Needs an update", "the node"] end
        if r == "memory" return ["No memory", "try again"] end
        return nil
    end

    # The Hotspot up, or the web setup, which is the same access point:
    # what a search for nodes closes first, once the glass asked
    def hotspot_up()
        var h = self.wireless_state().find("hotspot")
        return h != nil && h["state"] == "up"
    end

    # the search for nodes, its view on top, after the effects given
    def search_bridges(out)
        for e: self.push_view(["zigbeePair"]) out.push(e) end
        out.push(["zigbee", "discover"])
        out.push(["show"])
        return out
    end

    # The nodes a search heard over ESP-NOW: the ones with their window open, a panel said so, the strongest bridge first and
    # marked, and a tap asks one to identify itself. Two heard means two windows at once: the one that identifies itself is the one. The search needs no
    # network: it pauses the Wi-Fi to listen on every channel. Every pairing is a guest's: a window of a build that takes none needs an update
    def zigbee_pair_view()
        var st = self.zigbee_state()
        var rows = []
        var said = PanelUi.zigbee_pair_said(st.find("result"), st.find("holder"))
        if said != nil rows.push(PanelUi.row(nil, said[0], said[1], false, nil, nil)) end
        var found = st.find("found", [])
        if size(found) > 1 rows.push(PanelUi.row(nil, str(size(found)) + " heard", "one identifies itself", false, nil, nil)) end
        var marked = false
        for b: found
            var ready = b["version"] == 2 && !b["busy"] && b.find("guest") == true
            var panel = b.find("display") == true
            var nearest = ready && !panel && !marked
            if nearest  marked = true end
            var hint = !ready ? (b["busy"] && b["version"] == 2 ? "busy" : "update it") : panel ? "panel" : nearest ? "nearest" : ""
            rows.push(PanelUi.row(nil, PanelUi.node_word(b), hint, false, ready ? ["zigbeePairWith", b["id"]] : nil, nil))
        end
        if size(found) == 0
            var sweeping = st.find("sweeping") == true
            rows.push(PanelUi.row(nil, sweeping ? "Every channel" : st["searching"] ? "Searching" : "None found",
                                  sweeping ? "Wi-Fi paused" : "", false, nil, nil))
            if !st["searching"] rows.push(PanelUi.row(nil, "Open its window", "search again", false, nil, nil)) end
        end
        # the house's server, which pairs by a code over the network, not by the radio
        if self.provider_of("house", nil) != nil rows.push(PanelUi.row(nil, "Add server", "by a code", false, ["house", "serverWindow"], nil)) end
        # the header's refresh searches again, once the search on show is over
        return ["Add to this house", st["searching"] ? "" : "refresh", rows]
    end

    # a node of the list asked to identify itself, and the question on the glass
    def ask_blink(id)
        var out = self.push_view(["zigbeePairBlink"])
        out.push(["zigbee", "blink", id])
        out.push(["show"])
        return out
    end

    # the node a pairing picked, by name
    static def zigbee_chosen_name(st)
        var b = st.find("chosen")
        if b == nil return "The node" end
        return PanelUi.node_word(b)
    end

    # a node a pairing's search heard, as the screens call a node of the house (HouseList.label): the name it was given, or, with none or Tasmota's own
    # host name, its role and the end of its radio address, "Bridge 4A7E21"
    static def node_word(b)
        import string
        var name = str(b.find("name", ""))
        if name != "" && string.find(name, "tasmota-") != 0 return name end
        var m = string.split(str(b.find("mac", "")), ":")
        if size(m) != 6 return name != "" ? name : str(b.find("mac", "")) end
        return (b.find("display") == true ? "Panel " : "Bridge ") + m[3] + m[4] + m[5]
    end

    # The node picked, asked to identify itself: a bridge's light blinks fast, a panel's screen says so, and the user says whether it is the one before
    # anything is paired. Then the pairing, until the node said who it is, and the welcome of the house
    def zigbee_blink_view()
        var st = self.zigbee_state()
        var name = PanelUi.zigbee_chosen_name(st)
        var a = st.find("asking")
        var cancel = [PanelUi.row(nil, "Cancel", "", false, ["back"], nil)]
        if a == "pairing" || a == "hello"
            return self.notice("Pairing " + name, "A few seconds.", [PanelUi.row(nil, "Wait", "", false, nil, nil)])
        end
        # the node comes into the house over the link (house_link.be): this panel gives it the welcome
        if a == "house"
            return self.notice("Adding " + name + " to the house", "A few seconds.", [PanelUi.row(nil, "Wait", "", false, nil, nil)])
        end
        var panel = st.find("chosen") != nil && st["chosen"].find("display") == true
        if a != "blinking"
            return self.notice("Asking " + name, panel ? "Its screen says so once it hears this panel." : "Its light blinks fast once it hears the panel.", cancel)
        end
        if panel
            return self.notice("Does " + name + " show it?", "Its screen says it is the one. Yes adds it, No goes back to the list.",
                               [PanelUi.row(nil, "Yes", "", false, ["zigbeePairYes"], nil), PanelUi.row(nil, "No", "", false, ["back"], nil)])
        end
        return self.notice("Is " + name + " blinking?", "Its light blinks fast. Yes adds it, No goes back to the list.",
                           [PanelUi.row(nil, "Yes", "", false, ["zigbeePairYes"], nil), PanelUi.row(nil, "No", "", false, ["back"], nil)])
    end

    # The Wi-Fi the pairing offers: the bridge's to this panel, or
    # this panel's to the bridge, only on a touch, and what came of it
    def zigbee_wifi_view()
        var st = self.zigbee_state()
        var o = st.find("offer")
        var w = st.find("wifi")
        var done = [PanelUi.row(nil, "Done", "", false, ["back"], nil)]
        if w != nil
            var ws = w["state"]
            if ws == "asking" || ws == "joining"
                return self.notice(w["kind"] == "use" ? "Joining " + w["ssid"] : "The bridge joins " + w["ssid"], "A few seconds.",
                                   [PanelUi.row(nil, "Wait", "", false, nil, nil)])
            end
            if ws == "connected"
                var said = w["kind"] != "use" ? "The bridge is on the Wi-Fi." : "The panel is on the bridge's Wi-Fi."
                return self.notice("Joined " + w["ssid"], said, done)
            end
            if ws == "unknown" return self.notice("The bridge joins " + w["ssid"], "Its address shows in the house in a minute.", done) end
            var why = w["reason"] == "Refused" || w["reason"] == "Button" ? "The bridge gives its Wi-Fi only after its button." : PanelUi.wifi_reason(w["reason"]) + "."
            return self.notice("Did not join " + w["ssid"], why, done)
        end
        if o == nil return self.notice("Added", "", done) end
        if o["kind"] == "use"
            var how = ". The panel joins it."
            return self.notice("Use the bridge's Wi-Fi?", o["ssid"] + how,
                               [PanelUi.row(nil, "Use", "", false, ["zigbeePairOffer", "use"], nil), PanelUi.row(nil, "Not now", "", false, ["back"], nil)])
        end
        return self.notice("Give the bridge Wi-Fi?", "It has none. It joins " + o["ssid"] + ".",
                           [PanelUi.row(nil, "Give", "", false, ["zigbeePairOffer", "give"], nil), PanelUi.row(nil, "Not now", "", false, ["back"], nil)])
    end

    # the MQTT row of Wireless settings: Off with no broker, and
    # otherwise whether the panel is on it
    static def mqtt_hint(m)
        if m["host"] == "" return "Off" end
        return m["connected"] ? "Connected" : "Not connected"
    end

    # The MQTT: the broker and what the panel says to it, as
    # being edited, and Save, which restarts the panel. In a house it is the
    # house's: every node takes it
    def mqtt_view()
        var d = self.mqtt_draft
        if d == nil
            self.mqtt_draft = self.mqtt_edit()
            d = self.mqtt_draft
        end
        var m = self.mqtt.state()
        # the password belongs to its broker: another host clears it unless one is typed (panel_mqtt.be)
        var rows = [PanelUi.row(nil, "Status", PanelUi.mqtt_hint(m), false, nil, nil),
                    PanelUi.row(nil, "Host", d["host"] != "" ? d["host"] : "None", false, ["keyboard", "mqttHost"], nil),
                    PanelUi.row(nil, "Port", str(d["port"]), false, ["keyboard", "mqttPort"], nil),
                    PanelUi.row(nil, "User", d["user"] != "" ? d["user"] : "None", false, ["keyboard", "mqttUser"], nil),
                    PanelUi.row(nil, "Password", d.contains("password") ? (d["password"] != "" ? "Changed" : "None") :
                                                 (m["password"] && d["host"] == m["host"] ? "Set" : "None"),
                                false, ["keyboard", "mqttPassword"], nil),
                    PanelUi.row(nil, "Discovery", PanelUi.on_off(d["discovery"]), false, ["mqttDiscovery"], nil),
                    PanelUi.row(nil, "Battery timeout", PanelUi.expire_text(d.find("expire", 0)), false, ["keyboard", "mqttExpire"], nil)]
        # in a house, the setting is the house's, which every node takes
        if self.house_adds() rows.push(PanelUi.row(nil, "Applies to", "The house", false, nil, nil)) end
        rows.push(PanelUi.row(nil, "Save", "", false, ["open", "confirm", "mqttSave"], nil))
        return ["MQTT", "", rows]
    end

    # what the MQTT view edits, from what the panel has now
    def mqtt_edit()
        var m = self.mqtt.state()
        return {"host": m["host"], "port": m["port"], "user": m["user"], "discovery": m["discovery"], "expire": m.find("expire", 0)}
    end

    # The battery sensors' timeout: the hours Home Assistant waits
    # for word of a sensor of the bridge that sleeps on a battery before it marks
    # it unavailable, and Off at 0, the last value kept
    static def expire_text(h)
        return h > 0 ? str(h) + " h" : "Off"
    end

    # a text that is a whole number: one digit or more, and nothing else
    static def digits(s)
        if size(s) == 0 return false end
        for i: 0 .. size(s) - 1
            if s[i] < "0" || s[i] > "9" return false end
        end
        return true
    end

    # the Backup row of Wireless settings: No server until one
    # says where it is on the MQTT, and otherwise how the last backup went
    static def backup_hint(b)
        if b["server"] == "" return "No server" end
        if b["busy"] == "saving" return "Saving" end
        if b["pending"] return "Not saved" end
        var l = b["last"]
        return l != nil && l["when"] != nil ? l["when"] : "Not yet"
    end

    # The backup: Back up now while a
    # change has no backup, with why the last one did not go; the last backup,
    # whose tap says what it carried; the server's backup of this panel, to
    # restore; and the house's server
    def backup_view()
        var b = self.backup.state()
        var on = b["server"] != ""
        var rows = []
        if b["pending"]
            var hint = b["busy"] == "saving" ? "Saving" : b["result"] != "" ? b["result"] : "Not saved"
            rows.push(PanelUi.row(nil, "Back up now", hint, false, ["backupNow"], nil))
        end
        var l = b["last"]
        rows.push(PanelUi.row(nil, "Last backup", l == nil ? "None" : l["when"] != nil ? l["when"] : "Saved", false,
                              l != nil ? ["open", "confirm", "backupLast"] : nil, nil))
        if on
            var f = b["found"]
            # the server's date only when it is not the last backup's, which the row above says
            var hint = b["busy"] == "looking" ? "Looking" : b["busy"] == "restoring" ? "Restoring" : b.find("restore", "") != "" ? b["restore"] :
                       f == nil ? "None" : l != nil && f["at"] == l["at"] ? "" : f["when"] != nil ? f["when"] : "Found"
            rows.push(PanelUi.row(nil, "Restore", hint, false, f != nil ? ["open", "confirm", "backupRestore"] : ["backupLook"], nil))
        end
        rows.push(PanelUi.row(nil, "Server", on ? b["server"] : "None", false, nil, nil))
        return ["Backup", "", rows]
    end

    # The tap on Last backup: when it went, who asked for it, what it carried
    # and where it went
    def backup_last()
        var ok = [PanelUi.row(nil, "OK", "", false, ["back"], nil)]
        var l = self.backup != nil ? self.backup.state()["last"] : nil
        if l == nil return self.notice("Last backup", "None yet.", ok) end
        var by = l["by"] == "glass" ? "asked on the glass" : l["by"] == "server" ? "asked by the server" : l["by"] == "console" ? "asked on the console" :
                 l["by"] == "restore" ? "the one this panel restored" : "at the night's round"
        return self.notice("Last backup", (l["when"] != nil ? l["when"] : "Saved") + ", " + by + ". " + PanelUi.plural(l["zones"], "zone", "zones") + " and " +
                           PanelUi.plural(l["devices"], "device", "devices") + (l["server"] != "" ? ", on " + l["server"] : "") + ".", ok)
    end

    # the backup's state changed: the views that show it draw again
    def backup_changed()
        var entry = self.top()
        if entry == nil || self.editing != nil return [] end
        var v = entry["view"][0]
        if v == "backup" || v == "wireless" return self.show() end
        return []
    end

    # The hotspot on the QR's page: the code a phone's camera
    # joins it with, its name and password in words for a computer, the address,
    # and whether a phone is on it. The web setup is the hotspot on Tasmota's Wi-Fi
    # page. Stop closes it with no restart
    def wifi_hotspot_view()
        var h = self.wireless_state().find("hotspot")
        var web = h != nil && h["kind"] == "web"
        var title = web ? "Web setup" : "Hotspot"
        var back = PanelUi.row(nil, "Back", "", false, ["back"], nil)
        if h == nil || h["state"] != "up"
            var r = h != nil ? h["reason"] : nil
            var why = h == nil ? "" : r == "Idle" ? "It closed after 15 min with nobody on it." :
                      r == "Busy" ? "The Wi-Fi Manager is open." : r == "Stop" ? "It closed." :
                      r == "WifiManager" ? "The Wi-Fi Manager took the radio." : r == "Lost" ? "It lost the radio." : "It did not open."
            return self.notice(title, why, [back])
        end
        var stop = PanelUi.row(nil, web ? "Stop web setup" : "Stop hotspot", "", 2, ["wifi", "stopHotspot"], nil)
        var address = web ? "http://192.168.4.1/wi" : "http://192.168.4.1"
        var who = h["clients"] == 0 ? "Waiting for a device" : PanelUi.plural(h["clients"], "device", "devices") + " on it"
        if self.shape["pages"].find("qr") != nil
            return [title, "", [stop, back], nil,
                    {"code": PanelUi.wifi_qr(h["ssid"], h["password"], self.shape["qrMax"]),
                     "lines": [h["ssid"], "Password " + h["password"], address, who]}]
        end
        var line = "On your phone, join " + h["ssid"] + " with the password " + h["password"] + ", then open " + address + "."
        if self.shape["pages"].find("dialog") != nil return [title, "", [stop, back], line] end
        return [title, "", [PanelUi.row(nil, line, "", false, nil, nil), stop, back]]
    end

    # The hotspot said something (the driver's report): its view, or the Wi-Fi's
    # row, draws it
    def hotspot_changed()
        var entry = self.top()
        if entry == nil || self.editing != nil return [] end
        var v = entry["view"][0]
        if v == "wifiHotspot" || v == "wifi" || v == "wireless" return self.show() end
        return []
    end

    # The pairing or the mode changed (zigbee_pairing.be, zigbee_bridge.be): a view of the Zigbee on show draws again. A node added goes back to where
    # the adding started: the house or the Wi-Fi. Nothing under a keyboard.
    def zigbee_changed()
        var entry = self.top()
        if entry == nil || self.editing != nil return [] end
        var v = entry["view"][0]
        var st = self.zigbee_state()
        # added, the Wi-Fi offered or not: back to where the adding started, the house or the Wi-Fi
        if (v == "zigbeePair" || v == "zigbeePairBlink" || v == "zigbeePairWifi") && st["result"] == "paired" && st.find("asking") == nil
            while self.top() != nil && self.top()["view"][0] != "wifi" && self.top()["view"][0] != "house"
                self.stack.remove(size(self.stack) - 1)
            end
            if self.top() != nil self.top()["page"] = 0 end
            var out = [["zigbee", "endPair"]]
            # added, and not in the house: the glass says why (panel_house_view.be)
            var hr = st.find("house")
            var shown = hr != nil && hr != "in" ? self.open(["houseResult"]) : self.show()
            for e: shown out.push(e) end
            return out
        end
        if v == "zigbeePairBlink"
            var a = st.find("asking")
            # the node said who it is and a Wi-Fi is offered: the question takes its place
            if a == "offer"
                self.stack.remove(size(self.stack) - 1)
                return self.open(["zigbeePairWifi"])
            end
            # not paired: back to the list, which says why
            if a == nil
                self.stack.remove(size(self.stack) - 1)
                return self.show()
            end
        end
        if v == "zigbeePairBlink" || v == "zigbeePairWifi" return self.show() end
        if v == "zigbeePair" || v == "wireless" || v == "panelInfo" || v == "house" || v == "houseWindow" return self.show() end
        return []
    end

    # A network tried: the join's view, drawn once the join
    # started, or drawn again for Try again
    def start_join(ssid, password, channel, bssid)
        var out = []
        var top = self.top()
        if top == nil || top["view"][0] != "wifiJoin" out = self.push_view(["wifiJoin"]) end
        out.push(["wifi", "join", ssid, password, channel, bssid])
        out.push(["show"])
        return out
    end

    # The station driver answered. What a search found is drawn on
    # its view, from the first page. A join that worked closes the way in, down
    # to the Wi-Fi, which says it is connected; one that failed says why. Nothing
    # under a keyboard a view opened.
    def wifi_answer(kind)
        var entry = self.top()
        if entry == nil || self.editing != nil return [] end
        var v = entry["view"][0]
        if kind == "scan"
            if v != "wifiSearch" return [] end
            entry["page"] = 0
            return self.show()
        end
        if self.wireless_state()["join"] != nil return v == "wifiJoin" ? self.show() : [] end
        var way_in = ["wifiJoin", "wifiSearch", "wifiConnect"]
        if way_in.find(v) == nil return [] end
        while self.top() != nil && way_in.find(self.top()["view"][0]) != nil
            self.stack.remove(size(self.stack) - 1)
        end
        if self.top() != nil self.top()["page"] = 0 end
        return self.show()
    end

    # The Wi-Fi came up or went down: what Wireless settings on
    # show lists is another list, drawn from its first page. Nothing with another
    # view on top, or under a keyboard a view opened.
    def wireless_changed()
        var entry = self.top()
        if entry == nil || self.editing != nil return [] end
        var v = entry["view"][0]
        # the Zigbee's views that say what needs the Wi-Fi draw again too, on their page
        if v == "zigbeePair" return self.show() end
        if v != "wireless" && v != "wifi" return [] end
        entry["page"] = 0
        return self.show()
    end

    # The Wi-Fi, by its state: the network and what it is doing
    # first, what can be done with it after, and the panel's MAC last. The name is
    # the network Tasmota is on, which with Ssid2 set may not be the one the
    # glass keeps.
    def wifi_view()
        var st = self.wireless_state()
        var name = st["ssid"] != "" ? st["ssid"] : st["saved"]
        var another = PanelUi.row(nil, "Connect to another", "", false, ["open", "wifiConnect"], nil)
        var off = PanelUi.row(nil, "Disconnect", "", false, ["open", "confirm", "wifiOff"], nil)
        var forget = PanelUi.row(nil, "Forget network", "", 2, ["open", "confirm", "wifiForget"], nil)
        var spot = PanelUi.hotspot_row(st)
        var rows = []
        if st["web"]
            rows.push(PanelUi.row(nil, "Web setup", "on", false, ["open", "wifiWeb"], nil))
        elif st["up"]
            rows.push(PanelUi.row(nil, name, "Connected", false, nil, nil))
            rows.push(PanelUi.toned(PanelUi.row(nil, "Signal", NodeWireless.dbm(st.find("rssi")), false, nil, nil), NodeWireless.tone_of(st.find("rssi"))))
            rows.push(PanelUi.row(nil, "IP address", st["ip"], false, nil, nil))
            rows.push(another)
            if spot != nil rows.push(spot) end
            rows.push(off)
            rows.push(forget)
        elif st["saved"] == ""
            rows.push(PanelUi.row(nil, "Connect", "", false, ["open", "wifiConnect"], nil))
            if spot != nil rows.push(spot) end
        elif st["off"]
            rows.push(PanelUi.row(nil, name, "Off", false, nil, nil))
            rows.push(PanelUi.row(nil, "Reconnect", "", false, ["wifi", "on"], nil))
            rows.push(another)
            if spot != nil rows.push(spot) end
            rows.push(forget)
        else
            # trying, and, with the driver, why it does not come up: a password
            # that changed is typed again here
            rows.push(PanelUi.row(nil, name, PanelUi.wifi_hint(st), false, nil, nil))
            if st["search"] rows.push(PanelUi.row(nil, "Change password", "", false, ["keyboard", "wifiPassword", st["saved"], 0, ""], nil)) end
            rows.push(another)
            if spot != nil rows.push(spot) end
            rows.push(off)
            rows.push(forget)
        end
        rows.push(PanelUi.row(nil, "MAC", st["mac"], false, nil, nil))
        return ["Wi-Fi", "", rows]
    end

    # The panel's web password, as the row of Main settings' Info has it, on Wireless settings too: the password, which
    # a long press removes, asked first; with none, Generate draws one
    static def webpw_row()
        import persist
        var pw = persist.find("panel_webpw", nil)
        if pw != nil return PanelUi.row(nil, "Web password", pw, false, nil, ["open", "confirm", "webPasswordRemove"]) end
        return PanelUi.row(nil, "Web password", "Generate", false, ["webPassword"], nil)
    end

    # The hotspot's row of the Wi-Fi, with the station driver:
    # on, it opens the QR again
    static def hotspot_row(st)
        if !st["search"] return nil end
        var h = st.find("hotspot")
        var on = h != nil && h["state"] == "up" && h["kind"] == "hotspot"
        return PanelUi.row(nil, "Hotspot", on ? "on" : "", false, ["wifiHotspot", "hotspot"], nil)
    end

    # The networks a search found: one row a name, strongest
    # first, the one saved and the ones the panel cannot join said so in the
    # value, and one off the house's channel by its channel; a
    # network by its name last, for one that hides it
    def wifi_search_view()
        var st = self.wireless_state()
        var rows = []
        var nets = st["networks"]
        var hp = self.provider_of("house", nil)
        if nets == nil || size(nets) == 0
            rows.push(PanelUi.row(nil, st["scanning"] ? "Searching" : "No networks found", "", false, nil, nil))
        else
            for n: nets
                var name = n[0]
                var auth = n[2]
                if PanelUi.WIFI_UNSUPPORTED.find(auth) != nil
                    rows.push(PanelUi.row(nil, name, "Not supported", false, nil, nil))
                else
                    var hint = NodeWireless.dbm(n[1]) + (name == st["saved"] ? ", saved" : auth == 0 ? ", open" : "")
                    var tone = NodeWireless.tone_of(n[1])
                    if hp != nil && hp.off_channel(n[3])
                        hint = "Channel " + str(n[3])
                        tone = ""
                    end
                    rows.push(PanelUi.toned(PanelUi.row(nil, name, hint, false, ["wifiPick", name, auth, n[3], n[4]], nil), tone))
                end
            end
        end
        rows.push(PanelUi.row(nil, "Other network", "", false, ["keyboard", "wifiName"], nil))
        # the header's refresh searches again, once the search on show is over
        return ["Networks", st["scanning"] ? "" : "refresh", rows]
    end

    # A network being joined: Connecting, and, when it fails,
    # why, with the password typed kept for Try again
    # Screens: the plans, and at the end the house's calendar and the alarm's rows. On the house's page the plans
    # alone, under the house's icons, which open the calendar and the alarm, and the house's name for a title
    def screens_view(view, ed)
        var doc = self.store.doc
        var rows = []
        for s: doc["screens"]
            var zones = 0
            for z: doc["zones"] if z["screen"] == s["id"] zones += 1 end end
            # each says its zones, the one on show as well
            rows.push(PanelUi.row(nil, s["title"], PanelUi.plural(zones, "zone", "zones"), false,
                       ["goto", s["id"]], ed ? ["open", "screenOptions", s["id"]] : nil))
        end
        var hp = self.shape["pages"].find("house") != nil ? self.provider_of("house", nil) : nil
        if hp != nil return [hp.title(), ed ? "add" : "", rows] end
        if self.schedule != nil  rows.push(self.schedule.calendar_row()) end
        if self.alarm != nil  for r: self.alarm.screen_rows() rows.push(r) end end
        # a new screen is the header's +, with Editing on; Settings opens only
        # by the swipe down on a plan
        return ["Screens", ed ? "add" : "", rows]
    end

    def wifi_join_view()
        var j = self.wireless_state()["join"]
        if j == nil return ["Wi-Fi", "", [PanelUi.row(nil, "Back", "", false, ["back"], nil)]] end
        if j["state"] == "joining"
            var secs = self.seconds_left(j.find("until"))
            return [j["ssid"], "", [PanelUi.row(nil, "Connecting", secs != nil ? str(secs) + " s" : "", false, nil, nil)]]
        end
        var again = j["password"] != "" || j["reason"] == "TooShort" ? ["keyboard", "wifiPassword", j["ssid"], j["channel"], j["bssid"]]
                                                                    : ["wifiJoinAgain"]
        return [j["ssid"], "", [PanelUi.row(nil, PanelUi.wifi_reason(j["reason"]), j["reason"] == "TooShort" ? "8 or more" : "", false, nil, nil),
                                PanelUi.row(nil, "Try again", "", false, again, nil),
                                PanelUi.row(nil, "Back", "", false, ["back"], nil)]]
    end

    def list_view(view)
        import string
        var doc = self.store.doc
        var ed = self.prefs["editing"]
        var kind = view[0]
        var prov = self.provider_of(kind, nil)
        if prov != nil return prov.view(view, ed) end
        if kind == "settings"
            var rows = []
            for item: self.items()
                var label = item[0]
                var key = item[1]
                var help = ["help", key]
                if string.find(key, "button") == 0 && size(key) == 7
                    var n = int(key[6 ..])
                    var zones = 0
                    for z: doc["zones"] if z["buttons"].find(n) != nil zones += 1 end end
                    # the mode alone: what a tap on the relay cuts, and the zones a
                    # panel button is for, are said where they are chosen
                    var hint = self.prefs["buttons"][n - 1] == "panel" ? "Panel" : "Relay"
                    rows.push(PanelUi.row(nil, label, hint, false, ["open", "choice", key], help))
                elif string.find(key, "relay") == 0 && size(key) == 6
                    # what hangs on it, set on the + of the zones: nothing to choose here
                    var n = int(key[5 ..])
                    var own = 0
                    var fed = 0
                    for d: self.store.relay_devices(n)
                        if PanelStore.is_relay_id(d[0]) own += 1 else fed += 1 end
                    end
                    # the lamps it powers first: switching it cuts them
                    var hint = fed > 0 ? "powers " + str(fed) : own > 0 ? PanelUi.plural(own, "device", "devices") : "unused"
                    rows.push(PanelUi.row(nil, label, hint, false, help, help))
                elif key == "screensaver"
                    rows.push(PanelUi.row(nil, label, PanelUi.duration(self.prefs["screensaver"][0]), false, ["open", "saver"], help))
                elif key == "info"
                    rows.push(PanelUi.row(nil, label, "", false, ["open", "panelInfo"], help))
                elif key == "pattern"
                    var set = size(self.prefs["pattern"]) == 2
                    rows.push(PanelUi.row(nil, label, PanelUi.on_off(set), false, set ? ["open", "patternOptions"] : ["lock", "new"], help))
                elif key == "factoryReset"
                    # back to the factory image, in the colour of what destroys, asked first; a bridge's is on its page
                    # in the house
                    rows.push(PanelUi.row(nil, label, "", 2, ["open", "confirm", "factoryReset"], help))
                elif self.provider_of(nil, key) != nil
                    rows.push(PanelUi.row(nil, label, self.provider_of(nil, key).hint(key), false, ["open", key], help))
                else
                    var on = self.setting_on(key)
                    rows.push(PanelUi.row(nil, label, PanelUi.on_off(on), false, ["setting", key], help))
                end
            end
            return ["Main settings", "", rows]
        end
        if kind == "choice"
            var key = view[1]
            var label = key
            for item: self.items() if item[1] == key label = item[0] end end
            if string.find(key, "button") == 0
                var n = int(key[6 ..])
                var mode = self.prefs["buttons"][n - 1]
                var marked = false
                for z: doc["zones"] if z["buttons"].find(n) != nil marked = true end end
                var relink = marked ? ["open", "confirm", "relink", n] : ["buttonMode", n, "relay"]
                return [label, "", [
                    PanelUi.row(PanelUi.chosen(mode == "relay"), "Relay", self.store.relay_powers(n) ? "cuts lamps" : "toggles it", false, mode == "relay" ? nil : relink, ["help", key]),
                    PanelUi.row(PanelUi.chosen(mode == "panel"), "Panel", "for zones", false, mode == "panel" ? nil : ["buttonMode", n, "panel"], ["help", key])]]
            end
            return [label, "", []]
        end
        # what runs on the panel: a fact a row, and nothing to tap
        # but a row the brain gives an action, the web password not drawn: Generate;
        # and nothing to hold but a password drawn, which goes, asked first
        if kind == "panelInfo"
            var rows = []
            for x: self.info_fn != nil ? self.info_fn() : []
                rows.push(PanelUi.row(nil, x[0], x[1], false, size(x) > 2 ? x[2] : nil, size(x) > 3 ? x[3] : nil))
            end
            return ["Info", "", rows]
        end
        # the screensaver's two times, and the list each is chosen from
        if kind == "saver"
            var t = self.prefs["screensaver"]
            return ["Screensaver", "", [
                PanelUi.row(nil, "Starts after", PanelUi.duration(t[0]), false, ["open", "saverTime", 0], nil),
                PanelUi.row(nil, "Turns off after", PanelUi.duration(t[1]), false, ["open", "saverTime", 1], nil)]]
        end
        if kind == "saverTime"
            var which = view[1]
            var now = self.prefs["screensaver"][which]
            var rows = []
            for s: PanelUi.SAVER_TIMES[which]
                rows.push(PanelUi.row(PanelUi.chosen(s == now), PanelUi.duration(s), "", false, s == now ? nil : ["saverTime", which, s], nil))
            end
            return [which == 0 ? "Starts after" : "Turns off after", "", rows]
        end
        # Wireless settings: the Wi-Fi with its state, and the MQTT, the backup and the house. The Zigbee is the house's bridges, on the
        # house's page, and has no row here
        if kind == "wireless"
            var st = self.wireless_state()
            var rows = [PanelUi.row(nil, "Wi-Fi", PanelUi.wifi_hint(st), false, ["open", "wifi"], nil)]
            # the radio's channel under it, where the image has the house's layer (panel_house_view.be)
            var hp = self.provider_of("house", nil)
            if hp != nil  for r: hp.wireless_rows() rows.push(r) end end
            if self.mqtt != nil rows.push(PanelUi.row(nil, "MQTT", PanelUi.mqtt_hint(self.mqtt.state()), false, ["mqttOpen"], nil)) end
            # the OTA, with the backup in it, once the panel has a number in the house; the backup alone before
            var ota = hp != nil ? hp.ota_row() : nil
            if ota != nil
                rows.push(ota)
            elif self.backup != nil
                rows.push(PanelUi.row(nil, "Backup", PanelUi.backup_hint(self.backup.state()), false, ["backupOpen"], nil))
            end
            # the house, where the image has the mesh and its layer (panel_house_view.be)
            if hp != nil && hp.in_wireless() rows.push(PanelUi.row(nil, "House", hp.summary(), false, ["open", "house"], nil)) end
            rows.push(PanelUi.webpw_row())
            return ["Wireless settings", "", rows]
        end
        if string.find(kind, "thermostat") == 0 return self.thermostat_view(view) end
        if kind == "mqtt" return self.mqtt_view() end
        if kind == "backup" return self.backup_view() end
        if kind == "wifi" return self.wifi_view() end
        # the two ways into a network: the search, when the
        # firmware can search, and Tasmota's Wi-Fi Manager
        if kind == "wifiConnect"
            # with the station driver, the web setup is the hotspot on Tasmota's
            # Wi-Fi page; without it, Tasmota's Wi-Fi Manager
            var rows = []
            var driver = self.wireless_state()["search"]
            if driver rows.push(PanelUi.row(nil, "Search networks", "", false, ["wifiSearch"], nil)) end
            rows.push(PanelUi.row(nil, "Web setup", "", false, driver ? ["wifiHotspot", "web"] : ["wifiWeb"], nil))
            return ["Connect", "", rows]
        end
        if kind == "wifiHotspot" return self.wifi_hotspot_view() end
        if kind == "wifiSearch" return self.wifi_search_view() end
        if kind == "patternOffer"
            # the first boot after the installation, on a panel with no pattern
            return self.notice("Protect these settings with a pattern?", "A pattern guards Main settings and Wireless settings on this panel.",
                               [PanelUi.row(nil, "Create", "", false, ["patternCreate"], nil), PanelUi.row(nil, "Not now", "", false, ["back"], nil)])
        end
        if kind == "zigbeePair" return self.zigbee_pair_view() end
        if kind == "zigbeePairBlink" return self.zigbee_blink_view() end
        if kind == "zigbeePairWifi" return self.zigbee_wifi_view() end
        if kind == "wifiJoin" return self.wifi_join_view() end
        # the web setup up: where the phone goes, and the way out,
        # which is Tasmota's own restart
        if kind == "wifiWeb"
            var ap = self.wireless_state()["ap"]
            var stop = PanelUi.row(nil, "Stop web setup", "", 2, ["wifi", "stopWeb"], nil)
            var back = PanelUi.row(nil, "Back", "", false, ["back"], nil)
            # the QR's page, when the layout has one: a code the
            # phone's camera joins the open network with, and the rest in words
            if self.shape["pages"].find("qr") != nil
                return ["Web setup", "", [stop, back], nil,
                        {"code": PanelUi.wifi_qr(ap, nil, self.shape["qrMax"]),
                         "lines": [ap, "No password", "Then open 192.168.4.1", "Stop restarts the panel"]}]
            end
            var line = "On your phone, join " + ap + ", then open 192.168.4.1."
            if self.shape["pages"].find("dialog") != nil return ["Web setup", "", [stop, back], line] end
            return ["Web setup", "", [PanelUi.row(nil, line, "", false, nil, nil), stop, back]]
        end
        if kind == "pair" return self.pair_view(view[1]) end
        if kind == "zoneOptions"
            var zone = self.store.find_zone(view[1])
            var id = zone["id"]
            var rows = []
            if ed
                rows.push(PanelUi.row(nil, "Grid", PanelText.format_size(PanelStore.grid_of(zone)), false, ["keyboard", "grid", id], nil))
                rows.push(PanelUi.row(nil, "Display", PanelUi.capital(zone.find("display", "places")), false, ["open", "display", id], nil))
                rows.push(PanelUi.row(nil, "Color", PanelUi.color_name(zone.find("color", 0)), false, ["open", "color", id], nil))
                # what a tap on its card turns on, as the Tap's screen words it
                var tap = self.provider_of("tap", nil)
                if tap != nil rows.push(PanelUi.row(nil, "Tap", tap.word(zone), false, ["open", "tap", id], nil)) end
                for n: [1, 2]
                    if self.prefs["buttons"][n - 1] == "panel"
                        var on = zone["buttons"].find(n) != nil
                        rows.push(PanelUi.row(nil, "Button " + str(n), PanelUi.on_off(on), false, ["op", "setMark", id, "button", n, !on], nil))
                    end
                end
                rows.push(PanelUi.row(nil, "Delete zone", PanelUi.plural(size(zone["members"]), "device", "devices"), 2, ["open", "confirm", "deleteZone", id], nil))
            end
            rows.push(PanelUi.row(nil, "Info", "", false, ["info", "zone", id], nil))
            return [zone["name"], "", rows]
        end
        if kind == "deviceOptions"
            # the zone's options' order: where it is first, then
            # what it is, then its moves, the one that destroys, and Info; each
            # value as its row reads it, capitalised
            var id = view[1]
            var device = self.store.find_device(id)
            var relay = PanelStore.is_relay_id(id)
            var zone = self.store.zone_of(id)
            # Identify and Settings are the buttons of its page now
            var rows = []
            if ed && device[2] == "unsupported"
                # in no zone and of no type the panel drives: only the way off the network
                for r: self.remove_rows(id) rows.push(r) end
            elif ed
                if zone != nil
                    rows.push(PanelUi.row(nil, "Position", PanelUi.place_text(self.store, zone, zone["members"][id]), false, ["keyboard", "slot", zone["id"], id], nil))
                end
                rows.push(PanelUi.row(nil, "Type", PanelUi.capital(device[2]), false, ["open", "type", id], nil))
                # under the Type, the Driver of a switch of two channels
                var dr = self.driver_row(id, ed)
                if dr != nil rows.push(dr) end
                # the alarm's rows of it: a sensor's role, notification and sound, any device's panic burst
                if self.alarm != nil  for r: self.alarm.device_rows(id, ed) rows.push(r) end end
                rows.push(PanelUi.row(nil, "Relay", device[9] != 0 ? "Relay " + str(device[9]) : "None", false, ["open", "relay", id], nil))
                # the zone it is in, which the row moves it out of
                rows.push(PanelUi.row(nil, "Zone", zone != nil ? zone["name"] : "", false, ["open", "moveTo", id], nil))
                # another device in its place: its name, zone, place and relay
                if self.replaceable(id) && zone != nil && !self.zigbee_off()  rows.push(PanelUi.row(nil, "Replace", "", false, ["replace", id], nil)) end
                for r: self.remove_rows(id) rows.push(r) end
            end
            var why = self.gate_reason(id)
            if why != nil rows.push(PanelUi.row(nil, "Status", why, false, nil, nil)) end
            rows.push(PanelUi.row(nil, "Info", "", false, ["info", "device", id], nil))
            return [device[1], "", rows]
        end
        if kind == "patternOptions"
            return ["Pattern", "", [
                PanelUi.row(nil, "Change pattern", "", false, ["lock", "new"], nil),
                PanelUi.row(nil, "Remove pattern", "", 2, ["open", "confirm", "removePattern"], nil)]]
        end
        if kind == "screens" return self.screens_view(view, ed) end
        if kind == "screenOptions"
            var id = view[1]
            var screens = doc["screens"]
            var i = 0
            while screens[i]["id"] != id i += 1 end
            var rows = [PanelUi.row(nil, "Rename", "", false, ["keyboard", "screenName", id], nil),
                        PanelUi.row(nil, "Reorganize", "", false, ["op", "reorganizeScreen", id], nil)]
            if id != "home" && i > 1 rows.push(PanelUi.row(nil, "Move up", "", false, ["op", "moveScreen", id, -1], nil)) end
            if id != "home" && i < size(screens) - 1 rows.push(PanelUi.row(nil, "Move down", "", false, ["op", "moveScreen", id, 1], nil)) end
            if id != "home"
                var owns = false
                for z: doc["zones"] if z["screen"] == id owns = true end end
                # a screen with zones says so, and its Delete opens nothing
                rows.push(PanelUi.row(nil, "Delete", owns ? "has zones" : "", owns ? false : 2, owns ? nil : ["open", "confirm", "deleteScreen", id], nil))
            end
            return [screens[i]["title"], "", rows]
        end
        if kind == "confirm" return self.confirm_view(view) end
        if kind == "type"
            var id = view[1]
            var device = self.store.find_device(id)
            var rows = []
            for k: PanelStore.kinds_for(device)
                rows.push(PanelUi.row(PanelUi.chosen(device[2] == k), PanelUi.capital(k), "", false, device[2] == k ? nil : ["op", "setKind", id, k], nil))
            end
            return ["Type", "", rows]
        end
        if kind == "relay"
            # the relay it hangs on: a relay device's switches it, a Zigbee device's powers it
            var id = view[1]
            var d = self.store.find_device(id)
            var rows = []
            for n: PanelStore.is_relay_id(id) ? [1, 2] : [0, 1, 2]
                # a relay holds one kind of device: one with the other kind is
                # not offered, and says why
                var mixed = n != 0 && d[9] != n && (PanelStore.is_relay_id(id) ? self.store.relay_powers(n) : self.store.relay_switches(n))
                var hint = !mixed ? "" : PanelStore.is_relay_id(id) ? "Zigbee only" : "no Zigbee"
                rows.push(PanelUi.row(PanelUi.chosen(d[9] == n), n != 0 ? "Relay " + str(n) : "No relay", hint, false, (d[9] == n || mixed) ? nil : ["op", "setRelay", id, n], nil))
            end
            return ["Relay", "", rows]
        end
        if kind == "display"
            # how the card is drawn: its places, or its groups summed up where they
            # fit, piece by piece or all its pieces together
            var zone = self.store.find_zone(view[1])
            var current = zone.find("display", "places")
            var rows = []
            for m: PanelStore.DISPLAYS
                rows.push(PanelUi.row(PanelUi.chosen(m == current), PanelUi.capital(m), "", false, m == current ? nil : ["op", "setDisplay", zone["id"], m], nil))
            end
            return ["Display", "", rows]
        end
        if kind == "moveTo"
            var id = view[1]
            var from = self.store.zone_of(id)
            var rows = []
            for z: doc["zones"]
                if from != nil && z["id"] == from["id"] continue end
                var free = size(PanelStore.free_slots(z))
                if free > 0 rows.push(PanelUi.row(nil, z["name"], str(free) + " free", false, ["op", "moveToZone", id, z["id"]], nil)) end
            end
            return ["Move to zone", "", rows]
        end
        return [str(kind), "", []]
    end

    # What destroys asks first: the question, a sentence that
    # says what it does, and the two answers -- the one that destroys, in the
    # destructive colour, and Cancel (`dialog`).
    def confirm_view(view)
        var doc = self.store.doc
        var kind = view[1]
        var arg = size(view) > 2 ? view[2] : nil
        if kind == "removeHouse"
            var g = self.store.find_device(arg)
            return self.dialog("Remove " + g[1] + " from the house?", "It leaves " + self.owner_name(arg) + ", and every panel.", "Remove", ["do", "removeHouse", arg])
        end
        if kind == "removeDevice"
            var d = self.store.find_device(arg)
            var line = PanelStore.is_relay_id(d[0]) ? "The relay stays as it is." : self.store.owner_of(arg) != 0 ? "It stays in the house." : "It leaves the network."
            # behind an open relay it has no power, and the leave does not reach it: the network still has it, and the next seed brings it
            # back as a new device. Said here, once: a list of those removed is not kept
            if !PanelStore.is_relay_id(d[0]) && self.store.owner_of(arg) == 0 && self.store.unpowered(d[0], self.relay_on)  line = "It has no power: the leave may not reach it, and it may come back." end
            return self.dialog("Remove " + d[1] + "?", line, "Remove", ["do", "removeDevice", arg])
        end
        if kind == "deleteZone"
            var z = self.store.find_zone(arg)
            var n = size(z["members"])
            return self.dialog("Delete " + z["name"] + "?", "Its " + PanelUi.plural(n, "device leaves", "devices leave") + " the panel.",
                               "Delete", ["do", "deleteZone", z["id"]])
        end
        if kind == "deleteScreen"
            var s = self.store.find_screen(arg)
            return self.dialog("Delete " + s["title"] + "?", "It has no zones.", "Delete", ["do", "deleteScreen", s["id"]])
        end
        if kind == "swapSlot"
            # the place typed is another device's: it takes this one's place instead
            var zone = self.store.find_zone(arg)
            var dev = view[3]
            var slot = view[4]
            var members = zone["members"]
            var other = nil
            for id: PanelStore.member_ids(members)
                if other == nil && id != dev && members[id] == slot other = id end
            end
            var od = self.store.find_device(other)
            var name = od != nil ? od[1] : other
            # a row holds some 20 characters on the EU: the title says who, the line where it goes
            var to = PanelText.format_place(self.store.slot_place(zone, members[dev]))
            return self.dialog("Swap with " + name + "?", name + " moves to " + to + ".", "Swap", ["do", "swapSlot", zone["id"], dev, slot])
        end
        if kind == "factoryReset"
            return self.dialog("Factory reset?", "The zones, the devices, the Wi-Fi and the MQTT are erased, and it leaves the house. The screen stays. It restarts.",
                               "Reset", ["do", "factoryReset"])
        end
        # a web password held off on the Info
        if kind == "webPasswordRemove"
            return self.dialog("Remove the web password?", "The panel's web page and console open with none. Generate draws another.",
                               "Remove", ["do", "webPasswordRemove"])
        end
        if kind == "removePattern"
            return self.dialog("Remove the pattern?", "Main settings opens without it.", "Remove", ["do", "removePattern"])
        end
        # what stops with the Wi-Fi: through a bridge, the Zigbee
        # lamps too, when the radio goes with it
        if kind == "wifiOff" || kind == "wifiForget"
            var st = self.wireless_state()
            # in the mesh, the driver holds the radio on with no network, and the
            # lamps stay with it (panel_wifi.be); without the driver, Disconnect
            # turns the radio off, and the mesh with it
            var lamps = st["zigbee"] == "mesh" && !st["search"]
            if kind == "wifiOff"
                return self.dialog("Disconnect Wi-Fi?", lamps ? "The bridge's lamps, the web page and updates stop until you reconnect."
                                   : "The web page, updates and Home Assistant stop until you reconnect.", "Disconnect", ["do", "wifiOff"])
            end
            # without the driver Forget restarts the panel, and with it the radio
            # stays on after it
            return self.dialog("Forget the network?", (st["search"] ? "The Wi-Fi turns off, " : "The panel restarts without Wi-Fi, ") + "and the web page and updates stop.",
                               "Forget", ["do", "wifiForget"])
        end
        # a search for nodes with the Hotspot up: what closes, by
        # the name its row has
        if kind == "pairHotspot"
            var h = self.wireless_state().find("hotspot")
            var what = h != nil && h["kind"] == "web" ? "The web setup" : "The Hotspot"
            return self.dialog("Add to this house?", what + " closes to search for the nodes.", "Continue", ["do", "pairHotspot"])
        end
        if kind == "mqttSave"
            # in a house, a node out of reach takes it when it is back
            var d = self.mqtt_draft != nil ? self.mqtt_draft : {"host": ""}
            return self.dialog("Save and restart?", d["host"] != "" ? "The panel restarts to connect to " + d["host"] + "." : "The panel restarts with MQTT off.",
                               "Save", ["do", "mqttSave"])
        end
        if kind == "backupRestore"
            var f = self.backup != nil ? self.backup.state()["found"] : nil
            if f == nil return self.notice("No backup", "The server has none of this panel now.", [PanelUi.row(nil, "OK", "", false, ["back"], nil)]) end
            # the panel's settings come too -- Editing, the buttons, the screensaver --
            # and the sentence says so, without listing them: two lines on the EU,
            # with two-digit counts
            var from = f["when"] != nil ? "From " + f["when"] + ": " : ""
            return self.dialog("Restore the backup?", from + PanelUi.plural(f["zones"], "zone", "zones") + ", " + PanelUi.plural(f["devices"], "device", "devices") +
                               " and the settings, in place of this panel's. It restarts.", "Restore", ["do", "backupRestore"])
        end
        if kind == "backupLast" return self.backup_last() end
        var zones = 0
        if kind == "relink"
            for z: doc["zones"] if z["buttons"].find(arg) != nil zones += 1 end end
            return self.dialog("Relink button " + str(arg) + "?", "The marks on " + PanelUi.plural(zones, "zone", "zones") + " are cleared.",
                               "Relink", ["do", "relink", arg])
        end
        return [kind, "", [PanelUi.row(nil, "Cancel", "", false, ["back"], nil)]]
    end

    # A confirmation as the list's view. With a dialog page (the shape says) the
    # sentence is its body, broken over its lines, and the rows are the two
    # answers; without one, the sentence is the first row: cut to a label's box,
    # and drawn like the rows a finger presses.
    # a dialog that only says: its line, and what closes it
    def notice(title, line, rows)
        if self.shape["pages"].find("dialog") != nil return [title, "", rows, line] end
        return [title, "", [PanelUi.row(nil, line, "", false, nil, nil)] + rows]
    end

    def dialog(title, line, answer, act)
        var rows = [PanelUi.row(nil, answer, "", 2, act, nil), PanelUi.row(nil, "Cancel", "", false, ["back"], nil)]
        if self.shape["pages"].find("dialog") != nil return [title, "", rows, line] end
        return [title, "", [PanelUi.row(nil, line, "", false, nil, nil), rows[0], rows[1]]]
    end

    def setting_on(key)
        if key == "editing" return self.prefs["editing"] end
        if key == "liveSliderUpdate" return self.prefs["liveSliderUpdate"] end
        if key == "keyboardKind" return self.prefs["keypad"] end
        return self.prefs["flags"].find(key, false) == true
    end

    # --- touches ----------------------------------------------------------------------------------------

    def row_at(k)
        var entry = self.top()
        var kind = entry != nil ? entry["view"][0] : nil
        if entry == nil || kind == "zone" || kind == "help" || kind == "helpText" || kind == "detail" || kind == "lock" return nil end
        var rows = self.list_view(entry["view"])[2]
        var i = entry["page"] * self.rows_for(entry["view"]) + k
        return i < size(rows) ? rows[i] : nil
    end

    def list_row(k, page, hold)
        var entry = self.top()
        if entry == nil return [] end
        if PanelUi.on_dialog(entry["view"][0]) && self.confirm_at != nil &&
           self.before(self.confirm_at + PanelUi.CONFIRM_GUARD_MS, PanelUi.CONFIRM_GUARD_MS)
            return []
        end
        entry["page"] = page
        var row = self.row_at(k)
        if row == nil return [] end
        var action = hold ? row[6] : row[5]
        return action != nil ? self.act(action) : []
    end

    def set_page(page)
        var entry = self.top()
        if entry == nil return [] end
        # a blind's page: its slider is the lists' scrollbar, and its place is where the blinds go
        if entry["view"][0] == "cover" return self.cover_slide(page) end
        entry["page"] = page
        return self.render(entry)
    end

    # A vertical swipe on a paged list: up to the next page, down
    # to the one before. At either end nothing is drawn: the render keeps the
    # page within the list, and one it kept is the page it was on.
    def swipe(direction)
        var entry = self.top()
        if entry == nil return [] end
        var was = entry["page"]
        if direction == "down" && was == 0 return [] end
        entry["page"] = was + (direction == "up" ? 1 : -1)
        var out = self.render(entry)
        return entry["page"] == was ? [] : out
    end

    def close()
        var leaving = self.top()
        if leaving == nil || leaving["view"][0] != "pair" return self.back() end
        # leaving the + stops the search
        var out = self.stop_pairing()
        self.stack.remove(size(self.stack) - 1)
        for e: self.show() out.push(e) end
        return out
    end

    # --- the search for new devices ---------------------------------------------

    # The + of a zone: the search for new devices and the
    # panel's two relays, on one list, with the check in its header. The rows:
    # every device found, or the search's own -- Add Zigbee device until it is
    # tapped, which is what starts it; the devices the network has and no zone
    # does; and a row for each relay, at most one marked, a tap on the marked one
    # unmarking it. The relay marked powers what is found; with nothing found,
    # the check makes a relay device of it. With Zigbee off, the relays alone.
    def pair_view(zone_id)
        var zone = self.store.find_zone(zone_id)
        var p = self.pairing
        if zone == nil || p == nil return ["Add", "", []] end
        var now = self.now()
        var found = p["found"]
        var rows = []
        # a Replace's search: for the one device that takes
        # the old one's place, which brings no relay and adds none from the network
        var old = p.find("replace") != nil ? self.store.find_device(p["replace"]) : nil
        # With Zigbee off, nothing of it: the relays are what the + adds
        var zigbee = !p.find("off", false)
        # the link to the network down: nothing to search with
        var zst = self.zigbee != nil ? self.zigbee.state() : nil
        var linked = zst == nil || zst.find("link") == true
        # on a bridge of the house that is not the panel's own: that bridge in step on the mesh
        var b = p.find("bridge", 0)
        if b > 0 && self.gate != nil && (self.gate.own == nil || b != self.gate.own())  linked = self.gate.ready.find(b, false) end
        if zigbee && size(found) == 0
            if p["until"] == nil && !linked
                rows.push(PanelUi.row(nil, "No bridge link", "", false, nil, nil))
            elif p["until"] == nil
                # the search starts from here, and not when the + opens
                rows.push(PanelUi.row(["add", "icon-off"], "Add Zigbee device", "", false, ["pairSearch"], nil))
            elif self.before(p["until"], PanelUi.PAIR_MS)
                # the seconds left are the row's value: what the finger waits for
                rows.push(PanelUi.row(nil, "Searching", str((p["until"] - now + 999) / 1000) + " s", false, nil, nil))
            else
                rows.push(PanelUi.row(["refresh", "icon-off"], "Search again", "none found", false, ["pairSearch"], nil))
            end
        end
        var ready = 0
        for f: found
            var d = self.store.find_device(f[0])
            if f[1] == "ready" && d != nil
                ready += 1
                # a switch that takes a driver says so, as a row that opens a screen says its value: its tap opens the
                # Type and the Driver
                var tap = self.found_tap(f[0])
                var said = tap[0] == "open" ? "No driver" : d[6] != "" ? d[6] : d[2]
                rows.push(PanelUi.row([PanelUi.kind_icon(PanelStore.look_of(d), false), "icon-off"], d[1], said, false, tap, ["keyboard", "deviceName", f[0]]))
            elif f[1] == "back" && d != nil
                # back in the zone it was in, which may be another
                var home = self.store.zone_of(f[0])
                rows.push(PanelUi.row([PanelUi.kind_icon(PanelStore.look_of(d), false), "icon-off"], d[1], home != nil ? "back in " + home["name"] : "back",
                                      false, ["identify", f[0]], nil))
            elif f[1] == "unsupported" && d != nil
                # kept, and its options take it off the network
                rows.push(PanelUi.row(nil, d[1], "unsupported", false, ["open", "deviceOptions", f[0]], nil))
            else
                # "configuring", no dots: ".." on this glass is a text cut short
                var hint = f[1] == "configuring" ? "configuring" : f[1] == "nofree" ? "no free slot" : "unsupported"
                rows.push(PanelUi.row(nil, "New device", hint, false, nil, nil))
            end
        end
        # what the network has and no zone does: a configuration restored, or a pairing from the console;
        # one the Zigbee cannot handle opens its options, where Remove is, and is listed once
        for d: zigbee && old == nil ? self.store.doc["devices"] : []
            if !PanelStore.is_relay_id(d[0]) && self.store.zone_of(d[0]) == nil
                if d[2] != "unsupported"
                    rows.push(PanelUi.row([PanelUi.kind_icon(PanelStore.look_of(d), false), "icon-off"], d[1], "on network", false, ["pairAdd", d[0]], nil))
                elif !PanelUi.found_in(found, d[0])
                    rows.push(PanelUi.row(nil, d[1], "unsupported", false, ["open", "deviceOptions", d[0]], nil))
                end
            end
        end
        if old == nil
            for n: [1, 2]
                var marked = p["relay"] == n
                # a relay holds one kind of device: what the check makes of it
                # here, or why it makes nothing -- one that powers Zigbee devices takes
                # no relay device, and one that switches relay devices powers no Zigbee
                var hint = ""
                if marked && ready == 0
                    # what it will power, said once a device is found; a relay device is the +'s other screen now
                    hint = self.store.relay_switches(n) ? "no Zigbee" : ""
                elif marked
                    hint = self.store.relay_switches(n) ? "no Zigbee" : ready == 1 ? "powers it" : "powers them"
                end
                rows.push(PanelUi.row(PanelUi.chosen(marked), "Relay " + str(n), hint, false, ["relayMark", n], nil))
            end
        end
        return [old != nil ? "Replace " + old[1] : "Add to " + zone["name"], "confirm", rows]
    end

    # the search opened, or opened again: the network takes new devices for a minute
    # The search, from its row of the + (not when the +
    # opens): the network takes new devices for a minute. What the + already
    # found and the relay it marked stay. With Zigbee off there is
    # no network and no such row.
    def start_pairing(zone_id)
        var same = self.pairing != nil && self.pairing["zone"] == zone_id
        # and the bridge of the house it is on, by its number, or 0: the panel's own, which a panel with Zigbee off has not
        var b = same ? self.pairing.find("bridge", 0) : 0
        if self.zigbee_off() && b == 0 return [] end
        self.pairing = {"zone": zone_id, "until": self.now() + PanelUi.PAIR_MS,
                        "found": same ? self.pairing["found"] : [], "relay": same ? self.pairing["relay"] : 0, "off": false,
                        "replace": same ? self.pairing.find("replace") : nil, "bridge": b}
        return [b > 0 ? ["pair", zone_id, b] : ["pair", zone_id]]
    end

    # the search's end, to the bridge it is on
    static def pair_stop(p)
        var b = p != nil ? p.find("bridge", 0) : 0
        return b > 0 ? ["pairStop", b] : ["pairStop"]
    end

    # the check of the search: done. A relay device is made on the +'s other screen, not here
    def finish_pairing()
        return self.close()
    end

    # a relay row of the + tapped: marked, or unmarked if it was; the other one
    # never stays marked with it. What the search already found follows
    def mark_relay(n)
        var p = self.pairing
        if p == nil return [] end
        p["relay"] = p["relay"] == n ? 0 : n
        var changed = false
        for f: p["found"]
            if f[1] == "ready" && self.store.set_relay(f[0], p["relay"])["ok"] changed = true end
        end
        var out = changed ? [["save"]] : []
        for e: self.pair_redraw() out.push(e) end
        return out
    end

    # the search, ended by the finger: the network stops taking devices, if it still was
    def stop_pairing()
        var p = self.pairing
        self.pairing = nil
        var out = []
        # a device on the network and not interviewed yet keeps its zone: the
        # search's end loses no one
        if p != nil
            for f: p["found"]
                # one still unsupported leaves the network, and its bridge forgets it: nothing keeps it
                if f[1] == "unsupported"
                    var b = p.find("bridge", 0)
                    out.push(b > 0 ? ["leaveAt", f[0], b] : ["leave", f[0]])
                end
                # and the old device a Replace's search was for, when it ended before the interview did
                if f[1] == "configuring"
                    var at = [p["zone"], p["relay"], p.find("replace")]
                    # and the bridge of the house the search was on
                    if p.find("bridge", 0) > 0  at.push(p["bridge"]) end
                    self.late[f[0]] = at
                end
            end
        end
        if p != nil && self.before(p["until"], PanelUi.PAIR_MS)  out.push(PanelUi.pair_stop(p)) end
        return out
    end

    # through show, not render: a search that finds more devices than one page
    # holds moves to the list with the rail (page_of)
    # and not under a keyboard it opened: a found device being renamed would lose
    # its keyboard to the next second of the countdown
    def pair_redraw()
        var entry = self.top()
        if entry == nil || entry["view"][0] != "pair" || self.editing != nil return [] end
        # on the list's page, and the screensaver over it is left alone
        if self.page != self.shape["pages"]["list"] return [] end
        return self.show()
    end

    # a second of the search went by: the countdown, and the end of it
    def pair_tick()
        return self.pairing != nil ? self.pair_redraw() : []
    end

    # A device's state changed -- a report, or no answer: a zone's screen that
    # lists it draws again. The plan follows on its own (panel_plan_view.be).
    def refresh_for(id)
        var entry = self.top()
        # a thermostat's page, when it is on show and one of its thermostats said something
        if entry != nil && entry["view"][0] == "thermostat" return self.thermostat_shows(id) ? self.render(entry) : [] end
        # a blind's, the same
        if entry != nil && entry["view"][0] == "cover" return self.cover_shows(id) ? self.render(entry) : [] end
        # on show, and not under a keyboard it opened: its page is not up to write on
        if entry == nil || entry["view"][0] != "zone" || self.page != self.shape["pages"]["zone"] return [] end
        var zone = self.store.find_zone(entry["view"][1])
        if zone == nil return [] end
        return zone["members"].contains(id) ? self.render(entry) : []
    end

    # A relay of the panel moved: a zone's screen with a device it switches or
    # feeds draws again -- the relay devices on it, and the lamps it powers. No
    # report says so: the relay is the panel's own (autoexec.be, Power1#state).
    def refresh_relay(n)
        var entry = self.top()
        if entry == nil || entry["view"][0] != "zone" || self.page != self.shape["pages"]["zone"] return [] end
        var zone = self.store.find_zone(entry["view"][1])
        if zone == nil return [] end
        for dev: zone["members"].keys()
            var d = self.store.find_device(dev)
            if d != nil && d[9] == n return self.render(entry) end
        end
        return []
    end

    # A new device announced itself while the search runs: a row now, a place
    # once its interview says what it is -- or, with no room left for it, off
    # the network: two that arrive together for the last place cannot both have it.
    def pair_announced(id)
        var p = self.pairing
        # before its row asked, the + is not searching, and the network takes no one
        if p == nil || p["until"] == nil return [] end
        for f: p["found"]
            if f[0] == id return [] end
        end
        var d = self.store.find_device(id)
        if d != nil return self.pair_back(id, d) end
        var zone = self.store.find_zone(p["zone"])
        if zone == nil return [] end
        var waiting = 0
        for f: p["found"] if f[1] == "configuring" waiting += 1 end end
        # a Replace's search is for one device, the old one's place, which is not
        # free yet: a second that comes with it leaves, as with a full zone
        var room = p.find("replace") != nil ? 1 : size(PanelStore.free_slots(zone))
        if room - waiting <= 0
            p["found"].push([id, "nofree"])
            var b = p.find("bridge", 0)
            var out = [b > 0 ? ["leaveAt", id, b] : ["leave", id]]
            for e: self.pair_redraw() out.push(e) end
            return out
        end
        p["found"].push([id, "configuring"])
        return self.pair_redraw()
    end

    # A device the panel knows announced itself while the search runs: one kept
    # through a bridge's Forget, reset and on the new bridge's
    # network now. It goes back to its place, which the
    # panel kept, blinks, is told again how to come back after a power cut, and
    # joins its zones' groups again, which the reset emptied. One that only got
    # its power back is in them still, and joining again changes nothing
    def pair_back(id, d)
        self.pairing["found"].push([id, "back"])
        self.own_by(id, self.pairing.find("bridge", 0))
        self.store.reconcile(id, [])
        var out = [["save"], ["identify", id]]
        if (d[3] & PanelStore.CAP_ONOFF) != 0 out.push(["startup", id]) end
        out.push(["query", id])
        for e: self.pair_redraw() out.push(e) end
        return out
    end

    # a device the search found is the bridge's it was opened on, when that is a bridge of the house by its number
    def own_by(id, b)
        if b > 0  self.store.set_owner(id, b) end
    end

    # the search's entry of a device that waits for its interview, or nil; with `unsupported`, of one its interview found unsupported too, which a
    # driver's description may still take (pair_described)
    def configuring(id, unsupported)
        var p = self.pairing
        if p != nil
            for f: p["found"]
                if f[0] == id && (f[1] == "configuring" || (unsupported && f[1] == "unsupported")) return f end
            end
        end
        return nil
    end

    # Its interview said what it is: registered with a name of its own, put in
    # the zone's next place, told to come back off after a power cut, asked its
    # model, and made to blink. A full grid ends the search by itself.
    def pair_interviewed(id, profile, device_type, clusters, ep)
        var entry = self.configuring(id)
        if entry == nil
            # another endpoint of a device the panel has: a channel of a switch of several
            var c = self.channel_interviewed(id, clusters, ep)
            if c != nil return c end
            return self.late_interviewed(id, profile, device_type, clusters, ep)
        end
        if self.late.contains(id) self.late.remove(id) end
        var kc = PanelStore.device_profile(profile, device_type, clusters)
        var kind = kc[0]
        var caps = kc[1]
        if caps == 0 && kind != "sensor" && kind != "remote"
            # what the Zigbee cannot handle is not kept (kept, an unsupported curtain came back in every search): the search
            # says so while it runs, a driver of its bridge may still describe it, and at the search's end it leaves the network and its bridge
            # forgets it (stop_pairing)
            entry[1] = "unsupported"
            return self.pair_redraw()
        end
        var ct = (caps & PanelStore.CAP_CT) != 0 ? PanelStore.CT_DEFAULT : [0, 0]
        return self.pair_place(entry, id, kind, caps, ct, "", ep, true)
    end

    # A device the search waits for, said what it is -- by its interview, which `ask`s it
    # to blink, to come back off and for its model, or by a driver's description, which
    # leaves nothing to ask. A Replace's search takes it for the old one's
    # place: the old one's name, zone, place and relay, the old one leaves the network, and
    # the search ends, as it was for one device.
    # Otherwise it is registered with a name of its own and put in the zone's next place,
    # and a full grid ends the search by itself.
    def pair_place(entry, id, kind, caps, ct, model, ep, ask)
        var p = self.pairing
        var old = p.find("replace")
        if old != nil
            p["replace"] = nil
            var r = self.store.replace_device(old, [id, "", kind, caps, ct[0], ct[1], model, ep, 0, 0])
            if r["ok"]
                self.own_by(id, p.find("bridge", 0))
                # its events went to the new one, and the ones another kind cannot run are not kept
                if self.schedule != nil  self.schedule.sched.sweep() end
                entry[1] = "ready"
                var swapped = [["save"]]
                for x: r["actions"] swapped.push(["leave", x[1]]) end
                if ask
                    swapped.push(["identify", id])
                    if (caps & PanelStore.CAP_ONOFF) != 0 swapped.push(["startup", id]) end
                    swapped.push(["query", id])
                end
                p["until"] = self.now()
                swapped.push(PanelUi.pair_stop(p))
                for e: self.pair_redraw() swapped.push(e) end
                return swapped
            end
        end
        self.store.register_device([id, self.store.auto_name(kind), kind, caps, ct[0], ct[1], model, ep, 0, self.store.zigbee_relay(p["relay"])])
        self.own_by(id, p.find("bridge", 0))
        var placed = self.store.add_to_zone(p["zone"], id)
        var out = [["save"]]
        if !placed["ok"]
            entry[1] = "nofree"
            for e: self.pair_redraw() out.push(e) end
            return out
        end
        entry[1] = "ready"
        if ask
            out.push(["identify", id])
            if (caps & PanelStore.CAP_ONOFF) != 0 out.push(["startup", id]) end
            out.push(["query", id])
        end
        if size(PanelStore.free_slots(self.store.find_zone(p["zone"]))) == 0
            p["until"] = self.now()
            out.push(PanelUi.pair_stop(p))
        end
        for e: self.pair_redraw() out.push(e) end
        return out
    end

    # The interview of another endpoint of a device the panel has: a channel, when both are on/off with no
    # level -- a switch of several, whose channels are each a device -- in the first one's zone, or with no zone when it is
    # full, and in the search as one more found. nil when it is no channel: one more endpoint of a lamp, or of a device the
    # panel has not
    def channel_interviewed(id, clusters, ep)
        if clusters.find(0x0006) == nil || clusters.find(0x0008) != nil || clusters.find(0x0300) != nil return nil end
        return self.channel_added(id, ep)
    end

    # A channel of a device the panel has, by the interview of its endpoint or by the Config ZbInfo says (PanelZigbee,
    # know_channels), whichever comes first: one more device, of the first's kind, in its zone, and in the search. nil when
    # the device is no switch: not on/off alone, or not one the panel has
    def channel_added(id, ep)
        var first = self.store.find_device(id)
        if first == nil || first[7] == ep return nil end
        if first[3] != PanelStore.CAP_ONOFF || PanelStore.ACTUATORS.find(first[2]) == nil return nil end
        var cid = id + "/" + str(ep)
        if self.store.find_device(cid) != nil return [] end
        # the first was taken for an on/off lamp, as its endpoint says: a switch of several is a switch, and the name the
        # panel gave it follows
        if first[2] == "light"
            var named = PanelStore.auto_named("light", first[1])
            first[2] = "switch"
            if named first[1] = self.store.auto_name("switch") end
        end
        self.store.register_device([cid, self.store.auto_name(first[2]), first[2], first[3], 0, 0, first[6], ep, 0, first[9]])
        var out = [["save"]]
        var zone = self.store.zone_of(id)
        if zone != nil && self.store.add_to_zone(zone["id"], cid)["ok"] out.push(["startup", cid]) end
        var p = self.pairing
        if p != nil && PanelUi.found_in(p["found"], id)
            p["found"].push([cid, "ready"])
            for e: self.pair_redraw() out.push(e) end
        else
            for e: self.refresh_for(cid) out.push(e) end
        end
        return out
    end

    # The tap on a device found in the search: a switch of two channels opens its driver's screen, the Type and the Driver;
    # any other blinks, for whoever is looking for it
    def found_tap(id)
        var p = self.provider_of("driver", nil)
        var ieee = PanelStore.ieee_part(id)
        return p != nil && p.takes(ieee) ? ["open", "driver", ieee] : ["identify", id]
    end

    # the Driver row of a device's options, its device's (a channel's is the device's), or nil
    def driver_row(id, ed)
        var p = self.provider_of("driver", nil)
        return p != nil ? p.row(PanelStore.ieee_part(id), ed) : nil
    end

    # whether a device has a Replace: a Zigbee device of one channel; a relay device has no network to search, and a
    # channel of a device of several is the device's
    def replaceable(id)
        return !PanelStore.is_relay_id(id) && size(self.store.channels_of(PanelStore.ieee_part(id))) < 2
    end

    # The interview of a device whose search ended first (the ✓, the title, the
    # screensaver): it goes to the zone it was found for, as in the search, with
    # no view to say so; one with no place left there stays on the network, in
    # the + of any zone
    def late_interviewed(id, profile, device_type, clusters, ep)
        var at = self.late.find(id)
        if at == nil return [] end
        self.late.remove(id)
        var kc = PanelStore.device_profile(profile, device_type, clusters)
        var kind = kc[0]
        var caps = kc[1]
        if caps == 0 && kind != "sensor" && kind != "remote" return [] end
        var ct = (caps & PanelStore.CAP_CT) != 0 ? PanelStore.CT_DEFAULT : [0, 0]
        return self.late_place(at, id, kind, caps, ct, "", ep, true)
    end

    # a device whose search ended first, in the zone it was found for (`at`, which the late list gave)
    def late_place(at, id, kind, caps, ct, model, ep, ask)
        # a Replace's search that ended before the interview did: the new one takes the old one's place, as it would have in the search
        # (pair_place), and the old one leaves, rather than the new one coming in as one more in the zone
        var old = size(at) > 2 ? at[2] : nil
        if old != nil
            var r = self.store.replace_device(old, [id, "", kind, caps, ct[0], ct[1], model, ep, 0, 0])
            if r["ok"]
                self.own_by(id, size(at) > 3 ? at[3] : 0)
                var swapped = [["save"]]
                for x: r["actions"] swapped.push(["leave", x[1]]) end
                if ask
                    swapped.push(["identify", id])
                    if (caps & PanelStore.CAP_ONOFF) != 0 swapped.push(["startup", id]) end
                    swapped.push(["query", id])
                end
                for e: self.refresh_for(id) swapped.push(e) end
                return swapped
            end
        end
        self.store.register_device([id, self.store.auto_name(kind), kind, caps, ct[0], ct[1], model, ep, 0, self.store.zigbee_relay(at[1])])
        self.own_by(id, size(at) > 3 ? at[3] : 0)
        var out = [["save"]]
        if !self.store.add_to_zone(at[0], id)["ok"] return out end
        if ask
            out.push(["identify", id])
            if (caps & PanelStore.CAP_ONOFF) != 0 out.push(["startup", id]) end
            out.push(["query", id])
        end
        # the zone's screen, when it is the one on show, draws it in its place
        for e: self.refresh_for(id) out.push(e) end
        return out
    end

    # A driver's description of a device, which says what an interview would:
    # its kind, what it can do, the range of its target and its model. A device the panel has
    # is brought up to it; one a search waits for, or whose search ended first, takes its place
    # as an interview's does, with nothing to ask of it; and one the network had before the
    # panel is kept in no zone, as know() does.
    def pair_described(id, d)
        if !isinstance(d, map) || !PanelStore.KIND_NAME.contains(str(d.find("kind"))) return [] end
        var kind = d["kind"]
        var caps = int(d.find("caps", 0))
        var ct = [int(d.find("min", 0)), int(d.find("max", 0))]
        var model = str(d.find("model", ""))
        var ep = int(d.find("ep", 1))
        var have = self.store.find_device(id)
        # A blind's [4] is its ventilation, the panel's own, and its [5] what a driver of two channels says it moves:
        # no range to take from the description, and a link must not set the ventilation back to 0
        if kind == "cover"
            var app = PanelStore.APPS.find(str(d.find("app", "")))
            ct = [have != nil ? have[4] : 0, app != nil ? app : (have != nil ? have[5] : 0)]
        end
        if have != nil return self.described_known(have, kind, caps, ct, model, ep) end
        var entry = self.configuring(id, true)
        if entry != nil
            if self.late.contains(id) self.late.remove(id) end
            return self.pair_place(entry, id, kind, caps, ct, model, ep, false)
        end
        var at = self.late.find(id)
        if at != nil
            self.late.remove(id)
            return self.late_place(at, id, kind, caps, ct, model, ep, false)
        end
        self.store.register_device([id, self.store.auto_name(kind), kind, caps, ct[0], ct[1], model, ep, 0, 0])
        return [["save"]]
    end

    # A device the panel has, told again what it is with every link: what changed is kept, and nothing else.
    # What the panel guessed of one, a sensor from its Config or an unsupported one, gives way to what its
    # driver says it is, and its automatic name with it: the thermostat the network had before the driver, which
    # the panel took for a sensor when Z2T told what it knew, or a Moes the panel could not take at its pairing.
    # A device of any other kind keeps the panel's record.
    def described_known(have, kind, caps, ct, model, ep)
        var changed = false
        if have[2] != kind
            if have[2] != "sensor" && have[2] != "unsupported" return [] end
            if PanelStore.auto_named(have[2], have[1]) have[1] = self.store.auto_name(kind) end
            have[2] = kind
            changed = true
        end
        if have[3] != caps
            have[3] = caps
            changed = true
        end
        if have[4] != ct[0] || have[5] != ct[1]
            have[4] = ct[0]
            have[5] = ct[1]
            changed = true
        end
        if model != "" && have[6] != model
            have[6] = model
            changed = true
        end
        if have[7] != ep
            have[7] = ep
            changed = true
        end
        if !changed return [] end
        var out = [["save"]]
        for e: self.pair_redraw() out.push(e) end
        return out
    end

    # what the device answered ZbInfo with: its model, for its row and its Info
    def pair_model(id, model)
        var d = self.store.find_device(id)
        if d == nil || d[6] == model return [] end
        # every channel of it: a switch's second channel took the first's model when it came, and none when the first had none yet
        for c: self.store.channels_of(id)
            self.store.find_device(c)[6] = model
        end
        var out = [["save"]]
        for e: self.pair_redraw() out.push(e) end
        return out
    end

    # whether the lamp took StartUpOnOff = 0: 1 accepted, 2 refused
    # The ways off of a device: one of a bridge of the house leaves this panel only, and stays in the house and on the other panels, or leaves
    # the house, its bridge's network and every panel, while that bridge is ready; one with no bridge numbered, or a relay, leaves as it did
    def remove_rows(id)
        var node = PanelStore.is_relay_id(id) ? 0 : self.store.owner_of(id)
        if node == 0 return [PanelUi.row(nil, "Remove", "", 2, ["open", "confirm", "removeDevice", id], nil)] end
        var out = [PanelUi.row(nil, "Remove from this panel", "", 2, ["open", "confirm", "removeDevice", id], nil)]
        if self.gate == nil || self.gate.available(id)  out.push(PanelUi.row(nil, "Remove from the house", "", 2, ["open", "confirm", "removeHouse", id], nil)) end
        return out
    end

    # the name of the bridge that owns a device, as the house says it
    def owner_name(id)
        import global
        var h = global.contains("house") ? global.house : nil
        var n = self.store.owner_of(id)
        var s = h != nil && n > 0 ? h.list.label(n) : nil
        return s != nil ? s : "its bridge"
    end

    # A device another panel removed from the house: out of this panel too, with no leave, since it left already
    def device_gone(dev)
        if self.store.find_device(dev) == nil return [] end
        var r = self.store.remove_device(dev)
        if !r["ok"] return [] end
        log("PANEL: " + dev + " was removed from the house by another panel", 2)
        return [["save"], ["show"]]
    end

    def startup_result(id, accepted)
        var d = self.store.find_device(id)
        if d == nil return [] end
        d[8] = accepted ? 1 : 2
        return [["save"]]
    end

    def action()
        var entry = self.top()
        var prov = entry != nil ? self.provider_of(entry["view"][0], nil) : nil
        if prov != nil return prov.header(self) end
        # the check of the +
        if entry != nil && entry["view"][0] == "pair" && self.pairing != nil return self.finish_pairing() end
        # the refresh of the networks found: a search again, once the one on show is over
        if entry != nil && entry["view"][0] == "wifiSearch" return self.wireless_state()["scanning"] ? [] : self.act(["wifiRescan"]) end
        # and of the bridges found
        if entry != nil && entry["view"][0] == "zigbeePair" return self.zigbee_state()["searching"] ? [] : [["zigbee", "discover"], ["show"]] end
        # the + of Screens: a new screen, the plan on show
        if entry != nil && entry["view"][0] == "screens" return self.prefs["editing"] ? self.act(["newScreen"]) : [] end
        # the + of a zone: what to add, a Zigbee device or a relay device, with the network closed
        # until the Zigbee is chosen
        if entry != nil && entry["view"][0] == "zone"
            var zone = self.store.find_zone(entry["view"][1])
            if zone != nil && self.can_add(zone) return self.open(["add", zone["id"]]) end
        end
        return []
    end

    # Whether a zone's + is there: Editing on, a free place, and a Zigbee device or a relay device to add
    def can_add(zone)
        return self.prefs["editing"] && size(PanelStore.free_slots(zone)) > 0 && (self.can_add_zigbee() || self.can_add_relay())
    end

    # a Zigbee device, with Zigbee on and the link to the network up; "Not ready" in the local mode is no link. With no bridge of its own, a panel of a house
    # with bridges pairs on one of them
    def can_add_zigbee()
        import global
        if self.zigbee_off() return global.contains("PanelRemoteView") && global.PanelRemoteView.offers() end
        var zst = self.zigbee != nil ? self.zigbee.state() : nil
        return zst == nil || zst.find("link") == true
    end

    # a relay device, on a relay that powers no Zigbee device
    def can_add_relay() return !self.store.relay_powers(1) || !self.store.relay_powers(2) end

    # why a device of another room has no buttons, as its page says it, or nil when it has them (panel_gate.be)
    def gate_reason(id)
        return self.gate != nil ? self.gate.reason(id) : nil
    end

    # The Zigbee device of the +'s first screen: its search, which starts as its screen opens, in the
    # first screen's place, so the check and the title go back to the zone
    def begin_pairing(zone_id, bridge)
        self.pairing = {"zone": zone_id, "until": nil, "found": [], "relay": 0, "off": false, "bridge": bridge != nil ? bridge : 0}
        var out = self.start_pairing(zone_id)
        self.stack.remove(size(self.stack) - 1)
        for e: self.open(["pair", zone_id]) out.push(e) end
        return out
    end

    # a dot of the colour picker touched: the zone takes it, and
    # the zone's options come back
    def pick_color(value)
        var entry = self.top()
        if entry == nil || entry["view"][0] != "color" return [] end
        if !self.store.set_color(entry["view"][1], value)["ok"] return [] end
        self.stack.remove(size(self.stack) - 1)
        var out = [["save"]]
        for e: self.show() out.push(e) end
        return out
    end

    # the number in "$zone.rows.1.label" or "$zone.counts.0.count", or nil
    static def slot_of(subject, prefix)
        import string
        if string.find(subject, prefix) != 0 return nil end
        var rest = subject[size(prefix) ..]
        var dot = string.find(rest, ".")
        return int(dot < 0 ? rest : rest[0 .. dot - 1])
    end

    def zone_row(subject, page, gesture)
        var entry = self.top()
        if entry == nil || entry["view"][0] != "zone" return [] end
        var zone = self.store.find_zone(entry["view"][1])
        if zone == nil return [] end
        # "Settings", under the title: a tap or a hold opens the zone's settings.
        # It and the counters carry no page on the glass: the list stays where it is
        if subject == "$zone.name.label" return self.open(["zoneOptions", zone["id"]]) end
        var c = PanelUi.slot_of(subject, "$zone.counts.")
        if c != nil
            var groups = self.zone_groups(zone)
            if c >= size(groups) return [] end
            var g = groups[c]
            if gesture != "hold" return self.act(["toggleGroup", zone["id"], g[0], g[1]]) end
            # its joint page: the thermostats' target and mode, the blinds' keys, slider and ventilation,
            # or the lamps' levels
            return self.group_page(zone, g)
        end
        var r = PanelUi.slot_of(subject, "$zone.rows.")
        if r == nil return [] end
        entry["page"] = page
        var members = PanelUi.members_in_order(zone)
        var i = page * self.shape["zoneRows"] + r
        if i >= size(members) return [] end
        var dev = members[i]
        # a device row: the name's tap opens its options and its
        # hold renames it; the icon's tap switches it and its hold opens its
        # detail. Where it is, is in its options (Position...)
        if gesture == "icon" return self.act(["toggleDevice", dev]) end
        if gesture == "hold" return self.prefs["editing"] ? self.act(["keyboard", "deviceName", dev]) : [] end
        if gesture == "iconHold" return self.device_page(dev) end
        return self.open(["deviceOptions", dev])
    end

    # A device's page of advanced options: a thermostat's, a blind's, or a lamp's detail. One that only switches has
    # none: []
    def device_page(dev)
        var d = self.store.find_device(dev)
        if d == nil return [] end
        if d[2] == "thermostat" return self.thermostat_open(["d", dev]) end
        if d[2] == "cover" return self.cover_open(["d", dev]) end
        if !PanelStore.is_relay_id(d[0]) && (d[3] & PanelUi.LEVELS) != 0 return self.open(["detail", "d", dev]) end
        return []
    end

    # A group's joint page, [kind, relay, n] in a zone: the thermostats', the blinds', or the lamps' detail when one of
    # them does more than switch; [] for a group with none
    def group_page(zone, g)
        if g[0] == "thermostat" return self.thermostat_open(["t", zone["id"], g[1]]) end
        if g[0] == "cover" return self.cover_open(["t", zone["id"], g[1]]) end
        if self.group_has_levels(zone, g[0], g[1]) return self.open(["detail", "t", zone["id"], g[0], g[1]]) end
        return []
    end

    # the check made a zone: its screen opens, where its devices go
    def open_card(ref, screen_id)
        self.plan_screen = screen_id
        var p = PanelStore.parse_ref(ref)
        return p != nil ? self.open(["zone", p[1]]) : []
    end

    # A hold on a zone's card of the plan: a zone of one device opens that device's page, and one
    # whose devices are all Zigbee, in one group, the group's. Any other, a panel's relay among them, or one with no
    # such page, opens the zone's screen, as it always did
    def hold_card(ref, screen_id)
        self.plan_screen = screen_id
        var p = PanelStore.parse_ref(ref)
        var zone = p != nil ? self.store.find_zone(p[1]) : nil
        if zone == nil return [] end
        var ids = PanelStore.member_ids(zone["members"])
        var out = []
        if size(ids) == 1
            out = self.device_page(ids[0])
        elif size(ids) > 1
            var relay = false
            for id: ids
                if PanelStore.is_relay_id(id) relay = true end
            end
            var groups = self.zone_groups(zone)
            if !relay && size(groups) == 1 out = self.group_page(zone, groups[0]) end
        end
        return size(out) > 0 ? out : self.open(["zone", zone["id"]])
    end

    def open_screens(screen_id)
        self.plan_screen = screen_id
        return self.open(["screens", screen_id])
    end

    # --- what a row does ----------------------------------------------------------------------------------

    # What is destructive or opens the panel wide, asked through the pattern again
    # when its last drawing is older than FRESH_MS
    static def sensitive(action)
        var v = action[0]
        if v == "wifiWeb" return true end
        # the hotspot, and the web setup that is the hotspot on Tasmota's Wi-Fi page:
        # the same access point, with the same web administration behind it, and its
        # password on the glass
        if v == "wifiHotspot" return true end
        # how the alarm guards the house: its times, sirens, panic and each sensor's record, which a hand on the glass would
        # change with no trace of who; not the screens, the acknowledgements or this panel's own beeps
        if v == "alarm"
            var w = size(action) > 1 ? action[1] : ""
            return w == "entry" || w == "sound" || w == "measure" || w == "way" || w == "siren" || w == "burstdev" || w == "pick" || w == "panic" || w == "burst"
        end
        if v == "keyboard" return size(action) > 2 && action[1] == "alarm" end
        if v != "open" || size(action) < 3 || action[1] != "confirm" return false end
        var k = action[2]
        return k == "wifiForget" || k == "factoryReset" || k == "webPasswordRemove"
    end

    # the pattern drawn a moment ago, or the boot the rescue opened, which stands
    # for it until the restart
    def fresh()
        if self.rescue return true end
        return self.unlocked && self.unlocked_at != nil && self.before(self.unlocked_at + PanelUi.FRESH_MS, PanelUi.FRESH_MS)
    end

    # A network found, picked: an open one is tried at once, and one with a
    # password asks for it
    # A network picked from the search: joined, or, on a channel off the house's, said to be: the way to it is moving the house
    def pick_network(action)
        var hp = self.provider_of("house", nil)
        if hp != nil && hp.off_channel(action[3]) return self.open(["houseOffNet", action[1], action[3]]) end
        if action[2] == 0 return self.start_join(action[1], "", action[3], action[4]) end
        return self.open_keyboard(["keyboard", "wifiPassword", action[1], action[3], action[4]])
    end

    def act(action)
        var doc = self.store.doc
        var verb = action[0]
        if (PanelUi.sensitive(action) || (self.alarm != nil && self.alarm.guards(action))) && size(self.prefs["pattern"]) == 2 && !self.fresh()
            self.lock_msg = ""
            return self.open(["lock", "enter", action])
        end
        if verb == "open" return self.open(action[1 ..]) end
        var prov = self.provider_for(verb)
        if prov != nil return prov.act(self, action) end
        if verb == "lock"
            self.lock_msg = ""
            return self.open(["lock", action[1]])
        end
        if verb == "back" return self.back() end
        # the web password, drawn by the brain (Brain.generate_web_password), and
        # the Info drawn again once it is, with the password in the row
        if verb == "webPassword" return [["webPassword"], ["show"]] end
        # the bridge's, asked of it (zigbee_pairing.be's lock): the row waits, and the
        # Info is drawn again when the bridge answers, or does not (zigbee_changed)
        if verb == "setting"
            var out = self.toggle_setting(action[1])
            for e: self.show() out.push(e) end
            return out
        end
        if verb == "help"
            for item: self.items()
                if item[1] == action[1]
                    var view = ["help", item[0]]
                    for l: item[2] view.push(l) end
                    return self.open(view)
                end
            end
            return []
        end
        if verb == "saverTime"
            self.prefs["screensaver"][action[1]] = action[2]
            var out = [["prefs"]]
            for e: self.back() out.push(e) end
            return out
        end
        if verb == "buttonMode"
            self.prefs["buttons"][action[1] - 1] = action[2]
            var out = [["prefs"], ["button", action[1], action[2]]]
            for e: self.back() out.push(e) end
            return out
        end
        if verb == "do" return self.destroy(action) end
        if verb == "op" return self.operate(action) end
        if verb == "identify" return [["identify", action[1]]] end
        if verb == "toggleDevice"
            var dev = action[1]
            var found = self.store.find_device(dev)
            if found != nil && found[2] == "thermostat" return self.thermostat_touch([dev]) end
            if found != nil && found[2] == "cover" return self.cover_cycle([dev]) end
            return self.command(self.store.device_plan(dev, self.relay_on), self.device_intent(dev),
                                self.store.is_zigbee_actuator(found) ? [dev] : [])
        end
        if verb == "toggleZone"
            var zone = self.store.find_zone(action[1])
            if zone == nil return [] end
            var plan = self.store.zone_plan(zone["id"], self.relay_on)
            var tap = self.store.tap_intent([zone], plan, self.live, self.relay_on, self.doubt, self.unconfirmed)
            return tap == nil ? [] : self.command(plan, tap[0], tap[1])
        end
        if verb == "toggleGroup"
            var zone = self.store.find_zone(action[1])
            if zone == nil return [] end
            var kind = action[2]
            var relay = action[3]
            var members = {}
            for dev: zone["members"].keys()
                var d = self.store.find_device(dev)
                if d != nil && d[2] == kind && d[9] == relay members[dev] = zone["members"][dev] end
            end
            if kind == "thermostat" return self.thermostat_touch(PanelStore.member_ids(members)) end
            if kind == "cover" return self.cover_cycle(PanelStore.member_ids(members)) end
            var part = {"id": zone["id"], "members": members, "zid": zone["zid"], "zstate": zone["zstate"]}
            return self.command(self.store.group_plan(zone["id"], kind, relay, self.relay_on),
                                PanelStore.toggle_intent(self.store.target_states([part], self.live, self.relay_on, self.doubt, self.unconfirmed)),
                                self.store.powered_zigbee([part], self.relay_on))
        end
        if verb == "keyboard" return self.open_keyboard(action) end
        if verb == "thermostat" return self.thermostat_act(action[1 ..]) end
        if verb == "goto"
            self.plan_screen = action[1]
            return self.to_plan()
        end
        if verb == "newScreen"
            var r = self.store.add_screen("Screen " + str(size(doc["screens"]) + 1))
            if !r["ok"] return [] end
            self.plan_screen = r["value"]
            var out = [["save"]]
            for e: self.to_plan() out.push(e) end
            return out
        end
        if verb == "info" return self.open(self.info(action[1], action[2])) end
        if verb == "replace"
            # Replace, in a device's options: the search of its zone, for the one device
            # that takes its place
            var zone = self.store.zone_of(action[1])
            if zone == nil || self.zigbee_off() return [] end
            self.pairing = {"zone": zone["id"], "until": nil, "found": [], "relay": 0, "off": false, "replace": action[1]}
            return self.open(["pair", zone["id"]])
        end
        if verb == "pairSearch"
            # the search's row: Add Zigbee device, or Search again
            if self.pairing == nil return [] end
            var out = self.start_pairing(self.pairing["zone"])
            for e: self.pair_redraw() out.push(e) end
            return out
        end
        if verb == "relayMark" return self.mark_relay(action[1]) end
        if verb == "wifi"
            # the web setup's way out, a restart, after which there is nothing to draw
            if action[1] == "stopWeb" return [["wifi", "stopWeb"]] end
            # the hotspot closes, and its view with it, to the Wi-Fi
            if action[1] == "stopHotspot"
                if self.top() != nil && self.top()["view"][0] == "wifiHotspot" self.stack.remove(size(self.stack) - 1) end
                if self.top() != nil self.top()["page"] = 0 end
                return [["wifi", "stopHotspot"], ["show"]]
            end
            # Reconnect, drawn once the radio is on, from the first page
            if self.top() != nil self.top()["page"] = 0 end
            return [["wifi", action[1]], ["show"]]
        end
        if verb == "wifiSearch"
            # the search starts, and its view is drawn once it runs
            var out = self.push_view(["wifiSearch"])
            out.push(["wifi", "scan"])
            out.push(["show"])
            return out
        end
        if verb == "wifiRescan"
            if self.top() != nil self.top()["page"] = 0 end
            return [["wifi", "scan"], ["show"]]
        end
        if verb == "wifiPick" return self.pick_network(action) end
        if verb == "mqttOpen"
            # the MQTT view, with what the panel has now as the draft
            self.mqtt_draft = self.mqtt != nil ? self.mqtt_edit() : nil
            var out = self.push_view(["mqtt"])
            out.push(["show"])
            return out
        end
        if verb == "mqttDiscovery"
            if self.mqtt_draft != nil  self.mqtt_draft["discovery"] = !self.mqtt_draft["discovery"] end
            return self.show()
        end
        if verb == "backupOpen"
            # the view, and the server's backup looked at when it is not known yet
            var out = self.push_view(["backup"])
            var b = self.backup != nil ? self.backup.state() : nil
            if b != nil && b["server"] != "" && b["found"] == nil && b["busy"] == "" out.push(["backup", "look"]) end
            out.push(["show"])
            return out
        end
        if verb == "backupLook" return [["backup", "look"], ["show"]] end
        if verb == "backupNow" return [["backup", "now"], ["show"]] end
        if verb == "wifiJoinAgain"
            var j = self.wireless_state()["join"]
            return j != nil ? self.start_join(j["ssid"], j["password"], j["channel"], j["bssid"]) : []
        end
        if verb == "patternCreate"
            # the offer closes, and the pattern is drawn twice
            self.stack.remove(size(self.stack) - 1)
            return self.act(["lock", "new"])
        end
        if verb == "zigbeeAdd"
            # a node added to the house: the Hotspot holds the radio the search needs, and the glass says it closes first, and the
            # search, opened last, wins
            if self.hotspot_up() return self.open(["confirm", "pairHotspot"]) end
            return self.search_bridges([])
        end
        if verb == "zigbeePairWith" return self.ask_blink(action[1]) end
        if verb == "zigbeePairYes" return [["zigbee", "pair"], ["show"]] end
        if verb == "zigbeePairOffer" return [["zigbee", "offer", action[1]], ["show"]] end
        if verb == "wifiHotspot"
            # the hotspot, or the web setup, which is the hotspot on Tasmota's Wi-Fi
            # page: opened once, and its QR drawn once it is up. One
            # up already is shown again
            if self.top() != nil && self.top()["view"][0] == "wifiConnect" self.stack.remove(size(self.stack) - 1) end
            var h = self.wireless_state().find("hotspot")
            var out = h != nil && h["state"] == "up" ? [] : [["wifi", "hotspot", action[1]]]
            out = out + self.push_view(["wifiHotspot"])
            out.push(["show"])
            return out
        end
        if verb == "wifiWeb"
            # Tasmota's Wi-Fi Manager opens, and its sentence takes
            # the place of the two ways in: Back is the Wi-Fi, which says it is on
            if self.top() != nil && self.top()["view"][0] == "wifiConnect" self.stack.remove(size(self.stack) - 1) end
            var out = [["wifi", "web"]]
            for e: self.open(["wifiWeb"]) out.push(e) end
            return out
        end
        if verb == "pairAdd"
            # a device the network has and no zone did: in, with the relay marked, and back to the zone
            var p = self.pairing
            if p == nil || !self.store.add_to_zone(p["zone"], action[1])["ok"] return [] end
            if p["relay"] != 0 self.store.set_relay(action[1], p["relay"]) end
            var out = [["save"]]
            for e: self.close() out.push(e) end
            return out
        end
        return []
    end

    def command(plan, intent, ids)
        if plan == nil || intent == nil return [] end
        return [["command", plan, intent, ids]]
    end

    # --- the blinds ---------------------------------------------------------------------------

    # A tap on blinds, one or a zone's: the cycle, all of them together (panel_cover.be)
    def cover_cycle(ids)
        var c = self.network != nil ? self.network.cover : nil
        return c != nil ? c.cycle(ids) : []
    end

    # the page of a blind, ["d", id], or of a zone's of one relay, ["t", zone, relay]: not in a project whose generator is older
    def cover_open(rest)
        if self.shape["pages"].find("cover") == nil return [] end
        return self.open(["cover"] + rest)
    end

    # whether the page on show is of a blind that is, or has, this one: what a report of it is worth drawing for
    def cover_shows(id)
        var entry = self.top()
        if entry == nil || entry["view"][0] != "cover" || self.page != self.shape["pages"].find("cover") return false end
        for d: PanelCoverView.members(self.store, entry["view"])
            if d[0] == id return true end
        end
        return false
    end

    # the blinds of the page on show, by their ids
    def cover_ids()
        var entry = self.top()
        var ids = []
        if entry == nil || entry["view"][0] != "cover" return ids end
        for d: PanelCoverView.members(self.store, entry["view"])  ids.push(d[0]) end
        return ids
    end

    # what the page says of its blinds
    def render_cover(view)
        var c = self.network != nil ? self.network.cover : nil
        var members = PanelCoverView.members(self.store, view)
        if c == nil || size(members) == 0 return self.back() end
        if view[size(view) - 1] == "during" && self.schedule != nil return self.schedule.render_cover(self, view, members) end
        var out = PanelCoverView.page(c, self.store, view, members)
        # the row under its title
        var ids = []
        for d: members  ids.push(d[0]) end
        for e: PanelPageButtons.effects(self, "$cover", view, ids)  out.push(e) end
        return out
    end

    # whether the page on show is a blind's set for an event's action: its keys, its slider and its ventilation set the action
    def cover_event()
        var entry = self.top()
        var v = entry != nil ? entry["view"] : nil
        return v != nil && v[0] == "cover" && v[size(v) - 1] == "during" && self.schedule != nil
    end

    # A touch on a page of advanced options, whose row shares the events of the page's own faces and rows: an icon of the
    # row under its title or its card, or the thermostat's + and - and its modes, or the blind's keys and
    # its ventilation
    def page_touch(event, subject)
        var t = PanelPageButtons.touched(subject)
        if t != nil return t[0] == "card" ? self.page_card() : self.page_icon(t[1]) end
        if event == "thermostat.count" return self.thermostat_step(subject) end
        if event == "thermostat.row" return self.thermostat_mode(subject) end
        if event == "cover.count" return self.cover_key(subject) end
        if event == "cover.row" return self.cover_vent() end
        return []
    end

    # A setting of Main settings that is on or off, turned: what the glass and the flash are told. Another panel's touch over the mesh turns it the same
    # way (panel_house_view.be, apply_remote)
    def toggle_setting(key)
        var out = []
        if key == "editing" self.prefs["editing"] = !self.prefs["editing"]
        elif key == "liveSliderUpdate"
            self.prefs["liveSliderUpdate"] = !self.prefs["liveSliderUpdate"]
            out.push(["set", "$settings.liveSliderUpdate", self.prefs["liveSliderUpdate"] ? 1 : 0])
        elif key == "keyboardKind" self.prefs["keypad"] = !self.prefs["keypad"]
        else self.prefs["flags"][key] = !self.prefs["flags"].find(key, false)
        end
        out.push(["prefs"])
        return out
    end

    # whether the page on show is the house's, where the layout has one
    def on_house_page()
        var p = self.shape["pages"].find("house")
        return p != nil && self.page == p
    end

    # whether the page on show is the mesh's, where the layout has one
    def on_mesh_page()
        var p = self.shape["pages"].find("mesh")
        return p != nil && self.page == p
    end

    # The mesh's cog, over its nodes: its settings
    def mesh_cog()
        var entry = self.top()
        if entry == nil || entry["view"][0] != "house" return [] end
        return self.open(["houseSettings"])
    end

    # An icon of the house's page: what it opens
    def house_icon(subject)
        var entry = self.top()
        var hp = self.provider_of("house", nil)
        # the Screens' icons, and the mesh's own, its settings
        if entry == nil || (entry["view"][0] != "screens" && entry["view"][0] != "house") || hp == nil return [] end
        return hp.icon_tap(subject)
    end

    # An icon of the row: Identify, the device or its group blinks; Settings, the device's, only to be seen with
    # Editing off; Schedule, the device's or the group's
    def page_icon(k)
        var entry = self.top()
        if entry == nil return [] end
        var v = entry["view"]
        var w = PanelPageButtons.icon_at(self, v[0] == "detail" ? "$light" : "$" + v[0], v, k)
        if w == "identify"
            if v[1] == "d" return [["identify", v[2]]] end
            return [["identifyGroup", self.store.group_plan(v[2], v[3], v[4], self.relay_on)]]
        end
        if w == "settings" return v[1] == "d" ? self.act(["thermostat", "open", v[2]]) : self.open(["tap", v[2]]) end
        if w == "schedule" return self.schedule.open_for(self, v) end
        return []
    end

    # The card's name: the zone's screen, in the page's place, so its title goes back where the page was opened from;
    # opened from the zone itself, back to it
    def page_card()
        var entry = self.top()
        var zone = entry != nil ? PanelPageButtons.zone_of(self.store, entry["view"]) : nil
        if zone == nil return [] end
        var n = size(self.stack)
        if n > 1 && self.stack[n - 2]["view"][0] == "zone" && self.stack[n - 2]["view"][1] == zone["id"] return self.back() end
        self.stack.remove(n - 1)
        return self.open(["zone", zone["id"]])
    end

    # A key of the page, up, stop or down: every blind of it, as the keys on the wall
    def cover_key(subject)
        var verb = PanelCoverView.key(subject)
        # on the page for an event, all the way up or down is its action
        if self.cover_event() return self.schedule.cover_set(self, verb == "open" ? 100 : (verb == "close" ? 0 : nil)) end
        var ids = self.cover_ids()
        if verb == nil || size(ids) == 0 return [] end
        var c = self.network.cover
        if verb != "stop"
            for id: ids  c.went(id, verb == "open" ? "up" : "down") end
        else
            # a gate of two keys has no stop: the key does nothing for it, and a page of it alone is dim (PanelCoverView.page)
            ids = PanelCoverView.stoppable(c, ids)
            if size(ids) == 0 return [] end
        end
        return [["cover", ids, verb]]
    end

    # the slider let go on a place: the blinds go to its position
    def cover_slide(place)
        if self.cover_event() return self.schedule.cover_set(self, PanelCoverView.position_of(place)) end
        var ids = self.cover_ids()
        if size(ids) == 0 return [] end
        return [["cover", ids, "goto", PanelCoverView.position_of(place)]]
    end

    # the ventilation touched: the blinds go to its position
    def cover_vent()
        if self.cover_event() return self.schedule.cover_set(self, "vent") end
        var entry = self.top()
        var ids = self.cover_ids()
        if size(ids) == 0 return [] end
        return [["cover", ids, "goto", PanelCoverView.ventilation(PanelCoverView.members(self.store, entry["view"]))]]
    end

    # The colour of blinds' icon, a row's or a counter's: the accent while one moves, green with one all the way up, and
    # unlit otherwise, which `opened` (one not all the way down) shows in the open glyph
    def cover_color(ids, opened)
        var c = self.network != nil ? self.network.cover : nil
        if c == nil return opened ? "icon-low-sat" : "icon-off" end
        var full = false
        for id: ids
            if c.moving(id) return "accent-blue" end
            if c.get(id, "pos", nil) == 100  full = true end
        end
        return full ? "icon-open" : "icon-off"
    end

    # --- a thermostat's page ---------------------------------------------------------------

    # the page of a thermostat, ["d", id], or of a zone's of one relay, ["t", zone, relay]: not in a project whose generator is older
    def thermostat_open(rest)
        if self.shape["pages"].find("thermostat") == nil return [] end
        return self.open(["thermostat"] + rest)
    end

    # whether the page on show is of a thermostat that is, or has, this one: what a report of it is worth drawing for
    def thermostat_shows(id)
        var entry = self.top()
        if entry == nil || entry["view"][0] != "thermostat" || self.page != self.shape["pages"].find("thermostat") return false end
        for d: PanelThermostatView.members(self.store, entry["view"])
            if d[0] == id return true end
        end
        return false
    end

    # the targets the finger set a moment ago, id -> tenths: those the devices have not said anything of yet, and the time is up for
    # the others, which are the device's word again
    def thermostat_drafts()
        var out = {}
        var gone = []
        for id: self.target_draft.keys()
            var d = self.target_draft[id]
            if self.before(d[1] + PanelUi.DRAFT_MS, PanelUi.DRAFT_MS)
                out[id] = d[0]
            else
                gone.push(id)
            end
        end
        for id: gone  self.target_draft.remove(id) end
        return out
    end

    # a thermostat said its target: when it is the one the finger set, the device has answered, and its word is the page's
    def thermostat_said(id, set)
        var d = self.target_draft.find(id)
        if d != nil && d[0] == set  self.target_draft.remove(id) end
    end

    # what the page says of its thermostats
    def render_thermostat(view)
        var t = self.network != nil ? self.network.thermostat : nil
        var members = PanelThermostatView.members(self.store, view)
        if t == nil || size(members) == 0 return self.back() end
        if view[size(view) - 1] == "during" && self.schedule != nil return self.schedule.render_thermostat(self, view, t, members) end
        var looks = []
        var ids = []
        for d: members
            looks.push(self.device_look(d[0])[0])
            ids.push(d[0])
        end
        var out = PanelThermostatView.page(t, self.store, view, members, looks, self.thermostat_drafts(), self.shape["thermostatLines"], self.shape["thermostatModes"])
        # the row under its title
        for e: PanelPageButtons.effects(self, "$thermostat", view, ids)  out.push(e) end
        return out
    end

    # A touch on the + or the - of the page: the target one step on, shown at once, and sent a moment after the last touch, so a few touches
    # are one write. The step is the thermostat's own, on its grid, and it stops at the lowest and the highest every one takes
    def thermostat_step(subject)
        var entry = self.top()
        var t = self.network != nil ? self.network.thermostat : nil
        if entry == nil || entry["view"][0] != "thermostat" || t == nil return [] end
        var dir = subject == "$thermostat.plus.count" ? 1 : (subject == "$thermostat.minus.count" ? -1 : 0)
        var members = PanelThermostatView.members(self.store, entry["view"])
        if dir == 0 || size(members) == 0 return [] end
        var v = entry["view"]
        if v[size(v) - 1] == "during" return self.schedule != nil ? self.schedule.step(self, dir, t, members) : [] end
        var now = PanelThermostatView.target(t, members, self.thermostat_drafts())
        if now == nil return [] end
        var r = PanelThermostatView.span(t, members)
        # from the step's grid: a target another maker left off it goes to the grid's next point that way
        var base = dir > 0 ? (now / r[2]) * r[2] : ((now + r[2] - 1) / r[2]) * r[2]
        var next = base + dir * r[2]
        if next < r[0]  next = r[0] end
        if next > r[1]  next = r[1] end
        if next == now return [] end
        var ids = []
        for d: members
            self.target_draft[d[0]] = [next, self.now()]
            ids.push(d[0])
        end
        var out = PanelThermostatView.target_effects(t, members, self.thermostat_drafts())
        out.push(["thermostatTarget", ids, next])
        return out
    end

    # A touch on a mode of the page: every thermostat of it goes to that mode
    def thermostat_mode(subject)
        var entry = self.top()
        var t = self.network != nil ? self.network.thermostat : nil
        if entry == nil || entry["view"][0] != "thermostat" || t == nil return [] end
        var k = PanelUi.slot_of(subject, "$thermostat.modes.")
        var members = PanelThermostatView.members(self.store, entry["view"])
        if k == nil || size(members) == 0 return [] end
        var s = t.shape.find(members[0][0])
        var names = s != nil ? s.find("modes", []) : []
        if k >= size(names) return [] end
        # for an event the mode is its action's: Off, or Heat at its target
        if entry["view"][size(entry["view"]) - 1] == "during" return self.schedule != nil ? self.schedule.mode(self, names[k] == "off" ? 0 : 1) : [] end
        var ids = []
        for d: members  ids.push(d[0]) end
        return [["thermostat", ids, "mode", names[k]]]
    end

    # --- a thermostat's settings -----------------------------------------------------------

    # whether a thermostat heats now: it is on and has demand (panel_thermostat.be)
    def thermostat_heating(id)
        var t = self.network != nil ? self.network.thermostat : nil
        return t != nil && t.heating(id)
    end

    # The model that keeps a device's settings as its driver says them: a blind's or a thermostat's. The two share
    # the screen, its views and its verbs, which are the thermostat's names for them
    def settings_of(id)
        if self.network == nil return nil end
        var d = self.store.find_device(id)
        if d != nil && d[2] == "light" return self.network.lamp end
        return d != nil && d[2] == "cover" ? self.network.cover : self.network.thermostat
    end

    # A setting to its device: a lamp's the panel writes itself, any other's goes to its driver on the bridge
    def setting_effect(id, key, value)
        var d = self.store.find_device(id)
        if d != nil && d[2] == "light" return ["lamp", id, "write", key, value] end
        return ["thermostat", [id], "setting", value, key]
    end

    # the screen, and the list one setting is chosen from: PanelThermostatSettings makes the rows
    def thermostat_view(view)
        return PanelThermostatSettings.view(self.settings_of(view[1]), view, self.prefs["editing"])
    end


    # what the driver said of a setting, or nil
    def thermostat_value(id, key)
        return PanelThermostatSettings.value(self.settings_of(id), id, key)
    end

    # What a touch on the settings does: open them, which asks the driver for the schema and the values; toggle a flag; open the list
    # a choice is made from, on the page of the one the device has; or take a choice and go back. The driver checks it all again,
    # and the screen shows the value it says: no more, no less, so a device that refuses leaves the old one
    def thermostat_act(a)
        var c = self.settings_of(a[1])
        if c == nil return [] end
        var id = a[1]
        if a[0] == "open"
            # a lamp's are the panel's, read from it; the others' the driver says, schema and values
            var d = self.store.find_device(id)
            var ask = ["thermostat", [id], "settings", nil]
            if d != nil && d[2] == "light"
                c.open(id)
                ask = ["lamp", id, "read"]
            end
            return [ask] + self.push_view(["thermostatSettings", id]) + self.show()
        end
        var e = PanelThermostatSettings.entry(c, id, a[2])
        if e == nil || e.find("w", 1) == 0 || !self.prefs["editing"] return [] end
        if a[0] == "toggle" return [self.setting_effect(id, a[2], PanelThermostatSettings.value(c, id, a[2]) != true)] end
        if a[0] == "pick"
            var out = self.push_view(["thermostatChoice", id, a[2]])
            self.top()["page"] = PanelThermostatSettings.index_of(e, PanelThermostatSettings.value(c, id, a[2])) / self.rows_for(["thermostatChoice"])
            return out + self.show()
        end
        if a[0] == "choose"
            # a blind's ventilation is the panel's, and not the device's
            if a[2] == "vent" return self.cover_vent_set(id, a[3]) end
            var out = [self.setting_effect(id, a[2], a[3])]
            for x: self.back() out.push(x) end
            return out
        end
        return []
    end

    # OK on the keypad of a number: in the range the schema says, it goes to the driver; any other is as if none was typed
    def thermostat_commit(action, text)
        self.editing = nil
        self.page = ""
        var e = PanelThermostatSettings.entry(self.settings_of(action[2]), action[2], action[3])
        if e != nil && PanelUi.digits(text) && int(text) >= e.find("min", 0) && int(text) <= e.find("max", 0)
            return [self.setting_effect(action[2], action[3], int(text))] + self.show()
        end
        return self.show()
    end

    # The settings of a thermostat arrived, or changed: their screen, when it is the one on show, drawn again. The page it is drawn
    # on may be another than the one up: the one row that says the device is being read goes on the short list, and the schema
    # that comes is more than it holds
    def thermostat_changed(id)
        var entry = self.top()
        if entry == nil || self.editing != nil return [] end
        var v = entry["view"]
        if (v[0] != "thermostatSettings" && v[0] != "thermostatChoice") || v[1] != id return [] end
        if self.page != self.shape["pages"]["list"] return [] end
        return self.show()
    end

    # the screen of a thermostat's settings left: its schema goes
    def thermostat_leave(id)
        var m = self.settings_of(id)
        if m != nil  m.release(id) end
    end

    # A blind's ventilation chosen: kept in its record, in the field it has no other use for, and saved
    def cover_vent_set(id, v)
        var d = self.store.find_device(id)
        if d == nil || d[2] != "cover" || type(v) != "int" || v < 5 || v > 95 return [] end
        d[4] = v
        if self.network != nil && self.network.cover != nil  self.network.cover.vent_said(id, v) end
        var out = [["save"]]
        for x: self.back() out.push(x) end
        return out
    end

    # A touch on thermostats themselves, a row's icon or a counter, as on lamps: any that is on
    # turns them all off, and with none on all go to heat. One with no power, behind a relay held open, is left
    # out, and with none that has there is nothing to do
    def thermostat_touch(ids)
        var powered = []
        var states = []
        for id: ids
            var d = self.store.find_device(id)
            if d == nil || d[2] != "thermostat" continue end
            var s = self.store.toggle_state(id, self.live, self.relay_on, self.doubt, self.unconfirmed)
            states.push(s)
            if s != "nopower" powered.push(id) end
        end
        var plan = {"zids": [], "unicast": [], "relays": [], "skipped": [], "thermostat": powered}
        return self.command(plan, PanelStore.toggle_intent(states), powered)
    end

    def device_intent(id)
        if PanelStore.is_relay_id(id)
            # a relay device's row switches its relay only as its zone's card would
            var n = self.store.relay_of(id)
            var zone = self.store.zone_of(id)
            if n == 0 || zone == nil || !self.store.relay_free(n, [zone]) return nil end
            return self.relay_on[n - 1] ? "off" : "on"
        end
        if self.store.unpowered(id, self.relay_on) return nil end
        # a command not confirmed yet counts as done: a tap in its pending time
        # turns back what it asked, and asks it no more
        var asked = self.unconfirmed.find(id)
        if asked != nil return asked[0] == "on" ? "off" : "on" end
        # no communication: neither on nor off, and the tap tries it
        if self.doubt.contains(id) return "on" end
        return self.live.find(id) == "on" ? "off" : "on"
    end

    # a store operation from a row, and where the list goes after it
    def operate(action)
        var name = action[1]
        var a = action[2 ..]
        var r = nil
        var then = "back"
        var s = self.store
        if name == "addToZone" r = s.add_to_zone(a[0], a[1])
        elif name == "setMark"
            r = s.set_mark(a[0], a[1], a[2], a[3])
            then = "stay"
        elif name == "setKind" r = s.set_kind(a[0], a[1])
        elif name == "setRelay" r = s.set_relay(a[0], a[1])
        elif name == "setDisplay" r = s.set_display(a[0], a[1])
        elif name == "moveToZone"
            r = s.move_to_zone(a[0], a[1])
            then = "back2"
        elif name == "reorganizeScreen" r = s.reorganize_screen(a[0])
        elif name == "moveScreen"
            r = s.move_screen(a[0], a[1])
            then = "stay"
        else return []
        end
        if !r["ok"] return [] end
        var out = [["save"]]
        if then == "stay"
            for e: self.show() out.push(e) end
            return out
        end
        if then == "back2" self.stack.remove(size(self.stack) - 1) end
        for e: self.back() out.push(e) end
        return out
    end

    def pop2()
        self.stack.remove(size(self.stack) - 1)
        self.stack.remove(size(self.stack) - 1)
    end

    # what the confirmation's first answer does
    def destroy(action)
        var s = self.store
        var kind = action[1]
        var arg = size(action) > 2 ? action[2] : nil
        if kind == "swapSlot"
            var r = s.set_slot(arg, action[3], action[4], true)
            if !r["ok"] return [] end
            # the confirmation goes, and the device's options show its new place
            self.stack.remove(size(self.stack) - 1)
            var out = [["save"]]
            for e: self.show() out.push(e) end
            return out
        end
        if kind == "factoryReset"
            # the brain forgets the bridge, erases what the panel keeps and restarts
            # (Brain.factory_reset); the confirmation goes meanwhile
            self.stack.remove(size(self.stack) - 1)
            return [["factory"], ["show"]]
        end
        if kind == "webPasswordRemove"
            # the brain clears it (Brain.remove_web_password), and the Info shows Generate
            self.stack.remove(size(self.stack) - 1)
            return [["webPasswordRemove"], ["show"]]
        end
        if kind == "removePattern"
            self.prefs["pattern"] = []
            # the confirmation, and the options of a pattern that is gone
            self.pop2()
            var out = [["prefs"]]
            for e: self.show() out.push(e) end
            return out
        end
        if kind == "mqttSave"
            # the confirmation closes, and the draft goes: the panel restarts,
            # and the view is drawn as it is until then
            var d = self.mqtt_draft
            self.mqtt_draft = nil
            self.stack.remove(size(self.stack) - 1)
            return d != nil ? [["mqtt", "save", d], ["show"]] : [["show"]]
        end
        if kind == "backupRestore"
            # the confirmation closes, and the backup view says how it goes
            self.stack.remove(size(self.stack) - 1)
            return [["backup", "restore"], ["show"]]
        end
        if kind == "pairHotspot"
            # Continue: the Hotspot closes, and the search it held the radio from
            # starts
            var out = [["wifi", "stopHotspot"]]
            self.stack.remove(size(self.stack) - 1)
            return self.search_bridges(out)
        end
        if kind == "wifiOff" || kind == "wifiForget"
            # the confirmation goes, and the Wi-Fi is drawn once it did what was
            # asked: ["show"] after ["wifi"], from the first page of what is now
            # another list
            self.stack.remove(size(self.stack) - 1)
            if self.top() != nil self.top()["page"] = 0 end
            return [["wifi", kind == "wifiOff" ? "off" : "forget"], ["show"]]
        end
        var out = [["save"]]
        if kind == "removeDevice" || kind == "removeHouse"
            var node = s.owner_of(arg)
            var r = s.remove_device(arg)
            if !r["ok"] return [] end
            self.pop2()
            # and its detail, when the options were opened from there: its page would flash
            var top = self.top()
            if top != nil && top["view"][0] == "detail" && top["view"][1] == "d" && top["view"][2] == arg
                self.stack.remove(size(self.stack) - 1)
            end
            for x: r["actions"] out.push(["leave", x[1]]) end
            # out of the house: its bridge has it leave the network, and the panels that show it are told
            if kind == "removeHouse"  out.push(["leaveAt", PanelStore.ieee_part(arg), node]) end
            for e: self.show() out.push(e) end
            return out
        end
        if kind == "deleteZone"
            var r = s.delete_zone(arg)
            if !r["ok"] return [] end
            for x: r["actions"] out.push(["leave", x[1]]) end
            for e: self.to_plan() out.push(e) end
            return out
        end
        if kind == "deleteScreen"
            var r = s.delete_screen(arg)
            if !r["ok"] return [] end
            if self.plan_screen == arg self.plan_screen = "home" end
            self.pop2()
            for e: self.show() out.push(e) end
            return out
        end
        if kind == "relink"
            s.clear_button_marks(arg)
            self.prefs["buttons"][arg - 1] = "relay"
            self.stack.remove(size(self.stack) - 1)
            out.push(["prefs"])
            out.push(["button", arg, "relay"])
            for e: self.back() out.push(e) end
            return out
        end
        return []
    end

    # Info: what the panel knows of a zone or a device, on Help's page -- a
    # zone's and a device's in the same order: where it is,
    # what it is, and how the network knows it
    def info(kind, id)
        if kind == "zone"
            var z = self.store.find_zone(id)
            var pending = 0
            for k: z["zstate"].keys() if z["zstate"][k] != "in" pending += 1 end end
            var sc = self.store.find_screen(z["screen"])
            return ["help", z["name"],
                    "Screen: " + (sc != nil ? sc["title"] : z["screen"]) + ", at " + PanelText.format_place(self.store.slot_place(z, PanelText.make_slot(1, 1))),
                    "Grid: " + PanelText.format_size(PanelStore.grid_of(z)) + ", " + str(PanelStore.capacity(z)) + " places",
                    PanelUi.plural(size(z["members"]), "device", "devices"),
                    z["zid"] != 0 ? "Zigbee group " + str(z["zid"]) : "No Zigbee group",
                    pending > 0 ? PanelUi.plural(pending, "membership pending", "memberships pending") : "Memberships settled"]
        end
        var d = self.store.find_device(id)
        var zone = self.store.zone_of(id)
        var where = "In no zone"
        if zone != nil
            where = "Zone: " + zone["name"]
            var slot = zone["members"][id]
            if slot != 0 where += ", at " + PanelUi.place_text(self.store, zone, slot) end
        end
        if PanelStore.is_relay_id(id) return ["help", d[1], where, "Kind: " + PanelUi.capital(d[2]), "Switched by relay " + str(d[9])] end
        return ["help", d[1], where, "Kind: " + PanelUi.capital(d[2]), d[6] != "" ? "Model: " + d[6] : "Model unknown", "Address: " + id,
                "Endpoint " + str(d[7]) + ", " + (d[9] != 0 ? "powered by relay " + str(d[9]) : "no relay")]
    end

    # --- the keyboard's targets ------------------------------------------------------------------------------

    def open_keyboard(action)
        var target = action[1]
        var value = ""
        var max = 20
        if target == "grid"
            value = PanelText.format_size(PanelStore.grid_of(self.store.find_zone(action[2])))
            max = 4
        elif target == "slot"
            var zone = self.store.find_zone(action[2])
            var slot = zone["members"].find(action[3])
            if slot != nil value = PanelUi.place_text(self.store, zone, slot) end
            max = 5
        elif target == "screenName" value = self.store.find_screen(action[2])["title"]
        elif target == "zoneName" value = self.store.find_zone(action[2])["name"]
        elif target == "deviceName" value = self.store.find_device(action[2])[1]
        elif target == "wifiName" max = 32
        elif target == "mqttHost" || target == "mqttUser" || target == "mqttPort"
            # the MQTT's, as being edited; the password never comes back to the glass
            var d = self.mqtt_draft != nil ? self.mqtt_draft : {}
            value = target == "mqttHost" ? str(d.find("host", "")) : target == "mqttUser" ? str(d.find("user", "")) : str(d.find("port", 1883))
            max = target == "mqttPort" ? 5 : target == "mqttHost" ? 63 : 32
        elif target == "mqttPassword" max = 63
        elif target == "mqttExpire"
            value = str(self.mqtt_draft != nil ? self.mqtt_draft.find("expire", 0) : 0)
            max = 3
        elif target == "thermostatNumber"
            var now = self.thermostat_value(action[2], action[3])
            if type(now) == "int" value = str(now) end
            max = 3
        elif target == "wifiPassword"
            # WPA's longest, and what was typed before, for Try again: in memory only
            max = 63
            var j = self.wireless_state()["join"]
            if j != nil && j["ssid"] == action[2] value = j["password"] end
        elif self.provider_for(target) != nil
            var k = self.provider_for(target).keyboard(action[2])
            value = k[0]
            max = k[1]
        end
        self.editing = action
        var pad = self.shape["pages"].find("keypad")
        self.page = self.prefs["keypad"] && pad != nil ? pad : self.shape["pages"]["keyboard"]
        # the line before the page: the keyboard's page copies it into its field as
        # it loads, and a line written after would show the last one until a key
        return [["set", "$keyboard.value", value], ["set", "$keyboard.max", max], ["page", self.page]]
    end

    # OK on the keyboard: the value goes where the view asked, and the view comes back
    def commit(text)
        var action = self.editing
        if action == nil return [] end
        var s = self.store
        var target = action[1]
        if target == "thermostatNumber" return self.thermostat_commit(action, text) end
        var prov = self.provider_for(target)
        if prov != nil
            self.editing = nil
            self.page = ""
            return prov.commit(self, action[2], text)
        end
        if target == "mqttHost" || target == "mqttUser" || target == "mqttPort" || target == "mqttPassword" || target == "mqttExpire"
            # into the MQTT's draft, saved with the rest by Save
            self.editing = nil
            self.page = ""
            var d = self.mqtt_draft
            if d != nil
                import string
                if target == "mqttHost"  d["host"] = string.tr(text, " ", "") end
                if target == "mqttUser"  d["user"] = text end
                if target == "mqttPassword"  d["password"] = text end
                if target == "mqttPort"
                    var n = int(text)
                    if n > 0 && n < 65536  d["port"] = n end
                end
                # hours, three digits at most, 0 for Off; what is no number, or none,
                # leaves it as it was
                if target == "mqttExpire" && PanelUi.digits(text)  d["expire"] = int(text) end
            end
            return self.show()
        end
        if target == "wifiName" || target == "wifiPassword"
            self.editing = nil
            self.page = ""
            if target == "wifiPassword" return self.start_join(action[2], text, action[3], action[4]) end
            # a hidden network's name, and then its password; none is none
            if text == "" return self.show() end
            return self.open_keyboard(["keyboard", "wifiPassword", text, 0, ""])
        end
        var r = {"ok": false}
        if target == "grid"
            var grid = PanelText.parse_size(text)
            if grid != nil r = s.resize_zone(action[2], grid) end
        elif target == "slot"
            # one place of the screen, typed; the zone keeps it as its own slot.
            # One device, one place: two places typed are refused
            var zone = s.find_zone(action[2])
            var places = PanelText.parse_places(text)
            if places != nil && size(places) == 1
                var sl = s.place_slot(zone, places[0])
                r = sl != nil ? s.set_slot(action[2], action[3], sl, false) : {"ok": false, "refusal": "slot_outside"}
                # a place another device holds: the swap is asked first
                if !r["ok"] && r.find("refusal") == "slot_taken"
                    self.editing = nil
                    self.page = ""
                    return self.open(["confirm", "swapSlot", action[2], action[3], sl])
                end
            end
        elif target == "screenName" r = s.rename_screen(action[2], text)
        elif target == "zoneName" r = s.rename_zone(action[2], text)
        elif target == "deviceName" r = s.rename_device(action[2], text)
        end
        self.editing = nil
        self.page = ""
        var out = r["ok"] ? [["save"]] : []
        for e: self.show() out.push(e) end
        return out
    end

    def cancel()
        self.editing = nil
        self.page = ""
        return self.show()
    end

    # the title of the view on top was held: rename what it shows, with Editing on
    def rename_top()
        var entry = self.top()
        if entry == nil || !self.prefs["editing"] || entry["view"][size(entry["view"]) - 1] == "during" return [] end
        if entry["view"][0] == "zone" return self.open_keyboard(["keyboard", "zoneName", entry["view"][1]]) end
        if entry["view"][0] == "zoneOptions" return self.open_keyboard(["keyboard", "zoneName", entry["view"][1]]) end
        if entry["view"][0] == "deviceOptions" return self.open_keyboard(["keyboard", "deviceName", entry["view"][1]]) end
        # the house's page: the house's name
        if entry["view"][0] == "screens" && self.on_house_page()
            var hp = self.provider_of("house", nil)
            return hp != nil ? hp.rename(self) : []
        end
        # a node's page on the mesh: the node's name
        if entry["view"][0] == "houseNode"
            var np = self.provider_of("houseNode", nil)
            return np != nil ? np.rename_node(self, entry["view"][1]) : []
        end
        var page = entry["view"][0]
        if (page == "detail" || page == "thermostat" || page == "cover") && entry["view"][1] == "d" return self.open_keyboard(["keyboard", "deviceName", entry["view"][2]]) end
        # a joint mode's title is its zone's name, and its kind: the zone is renamed
        if page == "detail" || page == "thermostat" || page == "cover" return self.open_keyboard(["keyboard", "zoneName", entry["view"][2]]) end
        return []
    end
end
