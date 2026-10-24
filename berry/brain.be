# brain.be — the panel's brain: our generated pages, their events and the
# views behind them, all local, with no MQTT or HA needed. With no generated
# project it speaks joBr99's TFT vocabulary:
#
# Command vocabulary derived from joBr99's AppDaemon backend (not
# invented; see reference/joBr99/luibackend/{mqtt,controller,pages}.py):
#   - from the TFT we receive: "event,startup,<fw_version>,<model>" inside
#     CustomRecv (mqtt.py:customrecv_event_callback)
#   - to the TFT we send: pageType~, timeout~, dimmode~, time~, date~,
#     weatherUpdate, statusUpdate (pages.py: page_type/update_time/
#     update_date/update_screensaver_brightness/update_screensaver_weather/
#     update_status_icons)
#
# Difference from the original backend: reads time/date from Tasmota's
# local RTC (tasmota.rtc + tasmota.strftime), not from Home Assistant.
#
# Compiled into the firmware with the rest of the brain: this
# file only DEFINES the class, and PanelBoot (panel_boot.be) creates it, with
# the Nextion driver it started first. A loose copy of the file, loaded with
# load() from autoexec.be ahead of the boot, takes the firmware class's place:
# that is how a fix goes ahead of the next firmware. Never `import` a loose
# file: on this Tasmota it silently returns nil.

#@ solidify:Brain
class Brain : Driver

    # joBr99 defaults (luibackend/config.py) — we have no HA to configure
    # these yet, so they are fixed here for now.
    static sleep_timeout = 120
    static sleep_brightness = 20
    static screen_brightness = 100
    static bg_color_565 = 6371   # "ha-dark" converted to RGB565 (theme.py)

    # The dashed card's grid, as the keyboard edits it: a value
    # no placement shows, so it has a name of its own and a capacity of its own,
    # "5x11". Here and not in panel_plan_view.be, which loads after this file and so
    # cannot be named in it.
    static PLAN_GRID_PATH = "$plan.grid"
    static PLAN_GRID_LIMIT = 4
    # A joint mode's slider is a broadcast, and broadcasts have a quota:
    # at most one every this many milliseconds, and the last one always
    # goes. The bench measures what the Living room's network really takes.
    static GROUP_LEVEL_MS = 500
    # a thermostat's target goes this long after the last touch on the + or the - of its page: a few touches are one write
    static AIM_MS = 500
    # A zone's screen reports, and the gesture each one is to PanelUi.zone_row:
    # the Settings row and a device row's name and icon
    static ZONE_GESTURES = {"zone.row": "tap", "zone.hold": "hold", "zone.icon": "icon", "zone.iconHold": "iconHold"}
    # What the pages of advanced options report, their faces and their rows, the row under their title's among them
    # (PanelUi.page_touch)
    static PAGE_TOUCHES = ["light.count", "light.row", "thermostat.count", "thermostat.row", "cover.count", "cover.row"]
    # Berry collects by itself only when its heap has doubled since the last
    # collection, and Tasmota asks only at boot and at each teleperiod: in
    # between, the garbage grows as big as all that is alive, out of the heap
    # Wi-Fi, the web server and OTA allocate from too, and they cannot collect
    # it. So once this many bytes have been allocated since the
    # last collection, the next tenth of a second collects: a second is long
    # enough for a plan to allocate three times as much.
    static GC_STEP = 32768
    # the image's .tft is tried this many times a file (screen_check)
    static SCREEN_TRIES = 3
    # The first page says which build it runs as it loads; a screen that is not ours
    # says nothing, and is taken for it after this long, the Sonoff's screen lit
    # meanwhile. The bench sets the time
    static SCREEN_WAIT_MS = 10000
    # a flash that went through, and a screen that never says the new build: the
    # installation ends all the same, and the next boot looks at it again
    static INSTALL_END_MS = 60000
    # the factory reset: the bridge's Forget goes out first, and the link drops half
    # a second after it (ZigbeePairing.forget); then the erase. The Zigbee devices'
    # files are Z2T's, on a panel whose chip is soldered
    static FACTORY_MS = 1000
    static ZIGBEE_FILES = ["/zb", "/zbv4", "/zbdata"]
    # The screensaver's weather: Home Assistant says it, retained,
    # on the house's MQTT, and the panel asks nothing of it; without it the row
    # says "--". A forecast older than this is not shown: its days have gone
    static WEATHER_TOPIC = "houseweave/weather"
    static WEATHER_MAX_AGE = 21600

    var nx     # Nextion instance (nextion_driver.be), injected in the constructor
    var light  # Light instance (light.be), injected in the constructor — nil if it failed to load
    var home   # Home instance (home.be), injected in the constructor — nil if it failed to load

    # The generated project (berry/panel_runtime.be, with its <project>.jsonl), when
    # this panel runs OUR .tft instead of joBr99's. nil means the joBr99 stack,
    # validated on hardware, and the fallback.
    #
    # Presence IS the mode. There is no flag to set and therefore none to get
    # wrong: autoexec.be either names this room's generated project
    # (PANEL_PROJECT), whose <project>.jsonl the runtime reads, or it does not,
    # and whichever .tft is flashed is the one that has matching objnames. A flag that disagreed with the flashed file would be a panel that
    # draws nothing and says nothing about why.
    var panel
    # The plan on the glass (panel_plan_view.be), when the project's Home is one
    # (schema 11): it draws the cards and answers the touches on them. nil
    # without a generated project, or with one that has no plan.
    var plan
    # The panel's "live slider update" preference. The GLASS runs it -- the
    # switch writes a global Variable the sliders' Touch Move handlers read --
    # and this side only remembers it, to write it back after a reboot.
    var live_slider_update
    # Which keyboard a rename opens on: "qwerty" or "t9". The project ships a
    # factory default per LAYOUT (`keyboard_page`, what the layout's `editor`
    # names), because the answer really differs -- a QWERTY key is 6.3 mm on the
    # EU panel and 4.3 mm on the portrait one, against a keypad's 15.7. This is
    # the panel owner's override of that, and like every preference here it is
    # only REMEMBERED on this side: the glass jumps between the two by itself.
    var keyboard_kind
    # The screen the detail page was opened FROM, so the X knows where to go
    # back to. nil when nothing opened it by touch.
    var return_page
    # Which binding the on-screen keyboard is editing, and what every renamed
    # slot is called now.
    #
    # `texts` is the panel's OWN copy of every name the user has typed, keyed by
    # the same binding path the manifest uses. It has to exist on this side:
    # the glass forgets everything on a reboot, and a name the user typed is not
    # something a re-flash should take away.
    var editing
    var texts
    # The Settings list's plain on/off preferences: every item whose key this
    # side has no action for yet (the live-slider and keyboard ones do). Still
    # REMEMBERED, across reboots, so a row shows what the user left it at.
    var flags
    # Our pages beyond the plan (panel_ui.be): a zone's screen, the list and
    # its views, Help, and what the keyboard edits for them. nil without a
    # generated project. Its events come back as effects, which run() carries
    # out: pages, writes, commands.
    var ui
    # The transport the effects' commands go out on (PanelPlanCommands).
    var commands
    # a joint mode's level waiting for its turn, and when the last one went
    var level_last
    var zigbee      # panel_zigbee.be, or nil: the answers to our writes come back through it
    var pair_ticking  # a second of the search is counting down
    var counting_down # a view on show counts seconds down: it is drawn again in a second
    var level_armed
    var level_sent_at
    var aimed       # a thermostat's target waiting for the last touch's moment: [the devices, the target], or nil
    var aim_stamp   # counts the touches, so a late timer knows another came after it
    var gc_mark     # what the Berry heap held after the last collection
    # The screensaver's clock: when the glass, untouched until
    # then, goes to the screensaver; when the screensaver turns the screen off;
    # and whether it is off now. The two times are Main settings' (PanelUi).
    var idle_at
    var dark_at
    var dark
    # Main settings' Info: [commit, date] of this firmware's
    # build, which the boot hands over (panel_build.be); the screen's own, as its
    # first page says when it loads ("<commit> <date>"); and the installed date
    # noted, this boot
    var build
    var tft_version
    var screen_project   # the project the boot looks at the screen for, and its folder
    var screen_dir
    var screen_pending   # the look at the screen is still to come, once a boot
    var install_stamp    # the build being installed on the screen, until it says it runs it
    var installed_noted
    # The Wi-Fi Wireless settings asks for (panel_wifi.be), which the boot hands
    # over, or nil: the views' ["wifi", op] are carried out on it
    var wifi
    # the Zigbee's mode, its bridge and the pairing (zigbee_pairing.be), or nil:
    # the views' ["zigbee", op] are carried out on it
    var zigbee_ctl
    # the MQTT (panel_mqtt.be), or nil: the views' ["mqtt", op] are carried out on it
    var mqtt_ctl
    # the backup (panel_backup.be), or nil: the views' ["backup", op] are carried
    # out on it, and the preferences and the texts saved tell it
    var backup_ctl
    # the OTA (node_ota.be), or nil: the views' ["ota", op] are carried out on it
    var ota_ctl
    var clock       # the panel's own clock and place (panel_clock.be), or nil
    var schedule    # the house's schedule (panel_schedule.be), or nil: run every second
    var scheduling  # the schedule's own commands are running: they are not a touch
    var step_said   # step -> when its failure was last said (every_second), or nil
    # the weather Home Assistant said last, {"at", "cells"}, or nil; and whether
    # the screensaver drew it as too old
    var weather
    var weather_old

    def init(nx, light, home, panel, plan, ui, commands)
        import string
        import mqtt
        self.nx = nx
        self.light = light
        self.home = home
        self.panel = panel
        self.plan = plan
        self.ui = ui
        self.commands = commands
        self.level_last = nil
        self.level_armed = false
        self.level_sent_at = -Brain.GROUP_LEVEL_MS
        self.aimed = nil
        self.aim_stamp = 0
        self.gc_mark = tasmota.gc()
        self.idle_at = nil
        self.dark_at = nil
        self.dark = false
        self.build = nil
        self.tft_version = nil
        self.installed_noted = false
        self.wifi = nil
        self.zigbee_ctl = nil
        self.mqtt_ctl = nil
        self.backup_ctl = nil
        self.ota_ctl = nil
        self.counting_down = false
        if ui != nil  ui.info_fn = / -> self.panel_info() end
        # the panel's "live slider update" preference, kept here only to be
        # written back to the glass after a reboot (the glass runs it)
        self.live_slider_update = false
        # nil means "whatever the layout shipped", which is the honest default:
        # this side has no opinion until somebody flips the switch.
        self.keyboard_kind = nil
        self.return_page = nil
        self.editing = nil
        self.flags = {}
        self.texts = self.load_texts()
        self.load_prefs()
        self.push_prefs()
        # the boot the rescue opens: three presses on the reset button
        # are a hand on the panel, and the glass goes in with no pattern until the
        # restart -- the pattern may be what was forgotten, and the Info shows the
        # web password the rescue's WiFi Manager asks for
        if ui != nil && Brain.rescue_boot()  ui.rescue = true end
        self.nx.on_event = / kind, payload -> self.on_nextion_event(kind, payload)
        # light.be tells us when a bulb changed, so OUR pages follow by binding
        # the way joBr99's follow by command
        if self.light != nil
            self.light.on_change = / id, refresh_detail -> self.on_light_changed(id, refresh_detail)
        end
        tasmota.add_cmd("PatternClear", / cmd, idx, payload -> self.clear_pattern())
        # the screensaver's weather, as Home Assistant says it; Tasmota's mqtt
        # subscribes again at every connection, and the broker gives the retained one
        self.weather = nil
        self.weather_old = false
        if panel != nil
            mqtt.subscribe(Brain.WEATHER_TOPIC, / topic, idx, payload_s, payload_b -> self.weather_said(payload_s))
        end
        # the screensaver's clock runs from the start, and not from the first touch
        self.touched()
    end

    def on_nextion_event(kind, payload)
        if kind == "customrecv"
            self.handle_customrecv(payload)
        elif kind == "ready" && self.panel != nil
            # our pages at power on, or after the display reset itself: its page 0
            # is the screensaver as compiled, blank until it is drawn -- the time,
            # the texts kept here. joBr99's TFT asks with its startup event instead
            log("BRAIN: the display is up, rendering the screensaver", 2)
            self.render_screensaver()
        end
    end

    def handle_customrecv(msg)
        import string

        # Our generated pages say "ev,<page>,<objname>,<gesture>" and joBr99's
        # TFT says "event,...". The two prefixes differ on purpose, so a payload
        # identifies which stack sent it and nothing has to be configured to tell
        # them apart. on_payload() returns nil for anything that is not ours.
        if self.panel != nil
            var hit = self.panel.on_payload(msg)
            if hit != nil
                # The PAGE is in the payload and `on_payload` does not return it:
                # it identifies the component, and which page that component sits
                # on is a different question. `nav.close` needs it -- the X goes
                # back to where the finger came from -- so it is read here, from
                # "ev,<page>,<objname>,<gesture>", instead of widening the
                # manifest's return shape for one caller.
                var parts = string.split(msg, ",")
                var page = size(parts) > 1 ? parts[1] : nil
                # [event, subject] for a touch; [event, subject, value] for a slider
                self.handle_panel_event(hit[0], hit[1], size(hit) > 2 ? hit[2] : nil, page)
                return
            end
        end

        var parts = string.split(msg, ",")
        if size(parts) < 2 || parts[0] != "event"  return end

        if parts[1] == "startup"
            log("BRAIN: screen started (startup event), rendering screensaver", 2)
            self.render_screensaver()
            return
        end

        # The TFT hit its own screen timeout and went back to sleep mode by
        # itself — without this we never send `pageType~screensaver` back
        # and the screen stays black waiting (behaviour confirmed in the
        # log: sleepReached fires ~20s after the home render, with no
        # answer from us). Same behaviour as the original backend
        # (controller.py:242-246): re-render the screensaver.
        if parts[1] == "sleepReached"
            log("BRAIN: TFT went to sleep (sleepReached), back to screensaver", 2)
            self.render_screensaver()
            return
        end

        # The TFT announcing it finished the page transition and is ready
        # to receive content (see home.be:awaiting_render) — does not exist
        # in the original backend (not in any vendored .py), found only by
        # reading the TFT's real behaviour in the log.
        if parts[1] == "renderCurrentPage"
            if self.home != nil  self.home.on_render_ready() end
            return
        end

        # The TFT closing the light detail page (X button) — same pattern
        # as the screensaver's bExit (buttonPress2,screensaver,bExit,...),
        # except here the id is the literal "popupLight" (not any device
        # id) instead of "screensaver". Without this handler the X did
        # nothing — found by reading the raw event, which the console log
        # truncates. It
        # is page navigation, which is why it lives here in brain (which
        # knows home and light) and not inside light.be.
        if parts[1] == "buttonPress2" && size(parts) >= 4 && parts[2] == "popupLight" && parts[3] == "bExit"
            if self.light != nil  self.light.close_detail() end
            if self.home != nil  self.home.render(true) end
            return
        end

        # delegate to the entity modules — each one only recognises the
        # events that belong to it (buttonPress2/pageOpenDetail with the
        # right id)
        if self.home != nil && self.home.handle_event(parts)  return end
        if self.light != nil && self.light.handle_event(parts)  return end
    end

    # `$lights.<n>` -> the device id at that position.
    #
    # The project places cards by INDEX (`"light": "$lights.0"`) because a
    # project is written before any bulb is paired; `light.devices` is keyed by
    # id. home.be already walks the same map in the same order to fill the cards
    # (`send_content`), so position n here is the card the finger touched.
    def light_id_at(subject)
        import string
        if self.light == nil || subject == nil  return nil end
        var mark = string.find(subject, "$lights.")
        if mark != 0  return nil end
        var n = int(subject[8..])
        var ids = self.light.devices.keys()
        var i = 0
        for id : ids
            if i == n  return id end
            i += 1
        end
        return nil
    end

    # What a touch on one of OUR pages means.
    #
    # The page sent an objname and a gesture; the generated runtime turned that
    # into a name and the subject it was about; this is where they become an
    # action. The panel already decided tap or hold -- it times the press itself
    # with a Timer (layout/src/wire.ts) -- so there is nothing to work out here.
    #
    # Every event the generated manifest can carry has a destination here, or
    # is logged by name -- a branch that called a method that does not exist
    # would be a panel that crashes on a touch.
    #
    # `value` is nil for a tap or a hold and a number for a slider report: the
    # frame carries the slider's position, appended on the glass, and the
    # generated runtime splits it off (layout/src/wire.ts). A slider is about
    # the light whose detail page is open (`light.open_detail_id`), which is
    # what a hold on a card set -- so the subject of a slider event is which
    # DIMENSION it moves, and the light comes from here.
    # Every page change this side asks for. A drawing instruction draws on
    # whatever page is up, so the plan stops drawing the moment another page is
    # asked for; the plan's own page says when it is back (plan.show).
    def go(page)
        if self.plan != nil && str(page) != self.panel.plan_page  self.plan.hide() end
        # the views write on the page they think is up, so they are always told,
        # and so is the runtime, which writes only there (its set)
        if self.ui != nil  self.ui.page = str(page) end
        self.panel.showing(str(page))
        self.nx.sendnx("page " + str(page))
    end

    # Carry out what the views asked for (panel_ui.be), in order.
    def run(effects)
        for e: effects
            var k = e[0]
            if k == "page"
                self.go(e[1])
            elif k == "set"
                self.panel.set(e[1], e[2])
            elif k == "wrap"
                # a sentence over the lines of a page, broken where the runtime measures
                self.panel.wrap(e[1], e[2])
            elif k == "command"
                # an Off ends what a slider had still to say of the same lamps: the Dimmer a half second behind it would light them again
                if e[2] == "off"  self.level_cancel(e[1]) end
                if self.commands != nil  self.commands.run(e[1], e[2]) end
                if size(e) > 3  self.touch(e[3]) end
                # its Zigbee devices wait for its confirmation, as a card's do
                if self.plan != nil && size(e) > 3  self.plan.expect(e[3], e[2]) end
            elif k == "thermostat"
                # a thermostat's command to its driver on the bridge: the devices, the verb, the
                # value, and a setting's key. A mode waits for the driver's word as a lamp's command does
                if self.commands != nil
                    for id: e[1]  self.commands.drive(id, e[2], size(e) > 4 ? e[4] : nil, e[3]) end
                end
                self.touch(e[1])
                if e[2] == "mode" && self.plan != nil  self.plan.expect(e[1], e[3] == "off" ? "off" : "on") end
            elif k == "cover"
                # a blind's command to its driver on the bridge: the devices, all the same verb, and a position
                if self.commands != nil
                    for id: e[1]  self.commands.drive(id, e[2], nil, size(e) > 3 ? e[3] : nil) end
                end
                self.touch(e[1])
            elif k == "thermostatTarget"
                self.aim(e[1], e[2])
                self.touch(e[1])
            elif k == "identify"
                if self.commands != nil  self.commands.identify(e[1]) end
            elif k == "drive"
                # a command to a device's driver on the bridge with its value: a driver assigned, or given back
                if self.commands != nil  self.commands.drive(e[1], e[2], nil, size(e) > 3 ? e[3] : nil) end
            elif k == "identifyGroup"
                # a group's devices blink together, by its Zigbee group where the plan has one
                if self.commands != nil && e[1] != nil  self.commands.identify_plan(e[1]) end
            elif k == "leave"
                if self.commands != nil  self.commands.leave(e[1]) end
                # and out of the house's alarm
                if self.alarm_obj() != nil  self.alarm_obj().left(e[1]) end
            elif k == "sendAt"
                # a word to a bridge of the house by its number, over the mesh (its web password and its reset)
                if self.commands != nil && self.commands.send_at != nil  self.commands.send_at(e[1], e[2]) end
            elif k == "leaveAt"
                # a device out of the house: its bridge, by its number, has it leave the network
                if self.commands != nil  self.commands.leave_at(e[1], e[2]) end
                if self.alarm_obj() != nil  self.alarm_obj().left(e[1]) end
            elif k == "pair" || k == "pairStop"
                # on the bridge of the house the search is on, by its number, or the panel's own
                var at = k == "pair" ? (size(e) > 2 ? e[2] : 0) : (size(e) > 1 ? e[1] : 0)
                if self.commands != nil  self.commands.permit(k == "pair", at) end
                if k == "pair"  self.pair_tick() end
            elif k == "lamp"
                # a lamp's settings, read from it or one written to it, by the panel itself
                if self.zigbee != nil && self.zigbee.lamp != nil  self.zigbee.lamp.run(e) end
            elif k == "startup"
                if self.zigbee != nil  self.zigbee.expect_startup(e[1]) end
                if self.commands != nil  self.commands.startup(e[1]) end
            elif k == "query"
                if self.commands != nil  self.commands.query(e[1]) end
            elif k == "button"
                if self.commands != nil  self.commands.button(e[1], e[2]) end
            elif k == "level"
                # the schedule's go at once, every one: the pacing keeps a drag's last only
                if size(e) > 4 && self.commands != nil
                    self.commands.level(e[1], e[2], e[3])
                else
                    self.send_level(e[1], e[2], e[3])
                end
            elif k == "plan"
                if self.plan != nil  self.plan.show_screen(e[1]) end
            elif k == "calendar"
                # the house's calendar on the plan's page: drawn now on a plan on show, or when it loads
                if self.plan != nil
                    self.plan.canvas = e[1]
                    if self.plan.shown  self.plan.on_show(false) end
                end
            elif k == "alarm"
                var al = self.alarm_obj()
                # in a house, a word of the settings is the house's, and no bridge's. A word that did not leave, as the send says it
                # (false), is told to the alarm: a panic's screen does not claim it
                if al == nil || !al.to_house(e[1])
                    if self.commands != nil && self.commands.alarm(e[1]) == false && al != nil  al.unsent(e[1]) end
                end
            elif k == "alarmShow"
                self.alarm_show()
            elif k == "alarmNotice"
                self.alarm_notice()
            elif k == "alarmDismiss"
                self.alarm_dismiss()
            elif k == "picker"
                # the plan's page shows a zone's colour picker when it loads
                if self.plan != nil  self.plan.picker = {"zone": e[1], "chosen": e[2]} end
            elif k == "wifi"
                if self.wifi != nil  self.wifi.run(e[1], e[2 ..]) end
            elif k == "zigbee"
                if self.zigbee_ctl != nil  self.zigbee_ctl.run(e[1], e[2 ..]) end
            elif k == "mqtt"
                if self.mqtt_ctl != nil  self.mqtt_ctl.run(e[1], e[2 ..]) end
            elif k == "backup"
                if self.backup_ctl != nil  self.backup_ctl.run(e[1], e[2 ..]) end
            elif k == "ota"
                if self.ota_ctl != nil  self.ota_ctl.run(e[1], e[2 ..]) end
            elif k == "show"
                # the view on top, drawn now that the effects before this ran
                if self.ui != nil
                    self.run(self.ui.show())
                    self.count_down()
                end
            elif k == "save"
                self.ui.store.save()
            elif k == "factory"
                self.factory_reset()
            elif k == "webPassword"
                self.generate_web_password()
            elif k == "webPasswordRemove"
                self.remove_web_password()
            elif k == "prefs"
                self.pull_prefs()
                self.save_prefs()
            elif k == "clock"
                # the time, the date, the time zone, the internet's time, the place
                if self.clock != nil  self.clock.run(e) end
            elif k == "redraw"
                # the page on show loaded again, now or in a moment: the lock's
                # dots and lines go, and the page says when it is back
                var pg = self.ui.page
                if e[1] > 0
                    tasmota.set_timer(e[1], / -> self.reload(pg))
                else
                    self.reload(pg)
                end
            end
        end
    end

    # A command to devices from anyone but the schedule: theirs is the last word
    def touch(ids)
        if self.schedule != nil && !self.scheduling  self.schedule.touched(ids) end
    end

    # The schedule's minute: its commands run as its own
    def run_schedule()
        var out = self.schedule.tick()
        if size(out) == 0 return end
        self.scheduling = true
        # each command on its own: one that fails (a device that is gone) is no reason for the rest of the minute not to go
        for x: out
            try
                self.run([x])
            except .. as err, m
                log("PANEL: the schedule's command failed - " + str(err) + ": " + str(m), 2)
            end
        end
        self.scheduling = false
    end

    # A level to its target. One device gets every one: the glass already paces
    # a drag at 100 ms. A group, or many devices, get the latest at most every
    # GROUP_LEVEL_MS, so a drag is a couple of broadcasts a second and the value
    # the finger let go on is always the last to go.
    def send_level(plan, key, value)
        if self.commands == nil  return end
        if size(plan["zids"]) == 0 && size(plan["unicast"]) <= 1
            self.commands.level(plan, key, value)
            return
        end
        self.level_last = [plan, key, value]
        if self.level_armed  return end
        var since = tasmota.millis() - self.level_sent_at
        if since >= Brain.GROUP_LEVEL_MS
            self.flush_level()
        else
            self.level_armed = true
            tasmota.set_timer(Brain.GROUP_LEVEL_MS - since, / -> self.flush_level())
        end
    end

    # A thermostat's target from the + and the - of its page: held for AIM_MS after the last touch, and then written, so the value the
    # finger left is the one that goes
    def aim(ids, value)
        self.aimed = [ids, value]
        self.aim_stamp += 1
        var stamp = self.aim_stamp
        tasmota.set_timer(Brain.AIM_MS, / -> self.aim_now(stamp))
    end

    def aim_now(stamp)
        if stamp != self.aim_stamp || self.aimed == nil  return end
        var a = self.aimed
        self.aimed = nil
        self.run([["thermostat", a[0], "target", a[1]]])
    end

    # The level a drag left waiting (send_level) is let go when an Off goes to the same targets: a group's Dimmer is the lamps' on as well, and
    # sent after the Off it lights them again. A plan is the zones' groups and the devices no group reaches, as the command
    # plan says them
    def level_cancel(plan)
        var l = self.level_last
        if l == nil || !isinstance(plan, map)  return end
        for z: plan.find("zids", [])
            if l[0]["zids"].find(z) != nil
                self.level_last = nil
                return
            end
        end
        for d: plan.find("unicast", [])
            if l[0]["unicast"].find(d) != nil
                self.level_last = nil
                return
            end
        end
    end

    def flush_level()
        self.level_armed = false
        if self.level_last == nil  return end
        var l = self.level_last
        self.level_last = nil
        self.level_sent_at = tasmota.millis()
        self.commands.level(l[0], l[1], l[2])
    end

    # The views' preferences are the ones this side keeps (the live slider, the
    # keyboard, the plain flags), plus Editing and the buttons: one copy each
    # way, so a switch flipped by either reads the same to both.
    def push_prefs()
        if self.ui == nil  return end
        self.ui.prefs["liveSliderUpdate"] = self.live_slider_update == true
        # the keyboard a rename opens: this side's choice, or the layout's when
        # nobody has chosen (keyboard_page_for), the Settings switch's own rule.
        # "Nobody chose" is not QWERTY: the US portrait, whose layout ships the
        # keypad, would open 4.3 mm keys on every rename, and the first switch
        # flipped in Settings would write that QWERTY back as the user's choice
        # (pull_prefs).
        var pads = self.panel != nil ? self.panel.keyboard_pads : nil
        self.ui.prefs["keypad"] = pads != nil && self.keyboard_page_for() == pads.find("t9")
        self.ui.prefs["flags"] = self.flags
        # Editing is the views' preference, and the plan keeps a copy to draw its
        # + by: without this one, a boot with Editing off left the plan's at its
        # default, and the + came back
        if self.plan != nil  self.plan.editing = self.ui.prefs["editing"] end
    end

    def pull_prefs()
        if self.ui == nil  return end
        self.live_slider_update = self.ui.prefs["liveSliderUpdate"]
        self.keyboard_kind = self.ui.prefs["keypad"] ? "t9" : "qwerty"
        self.flags = self.ui.prefs["flags"]
        if self.plan != nil  self.plan.editing = self.ui.prefs["editing"] end
    end

    # A finger on the glass: the screensaver waits for the
    # first of Main settings' times from now, and a screen it turned off lights
    # up. The glass reports every touch as it lands (panel.touch), and anything
    # else it says counts too.
    def touched()
        if self.ui == nil  return end
        self.idle_at = tasmota.millis(self.ui.prefs["screensaver"][0] * 1000)
        if self.dark
            self.dark = false
            self.nx.sendnx("dim=100")
        end
    end

    # Once a second, on our pages: the screensaver, when the glass has gone
    # untouched for the first time; on it, the screen off after the second.
    def idle_tick()
        if self.panel == nil || self.ui == nil || self.idle_at == nil  return end
        if self.ui.page != "screensaver"
            if tasmota.time_reached(self.idle_at)  self.render_screensaver() end
        elif !self.dark && self.dark_at != nil && tasmota.time_reached(self.dark_at)
            self.dark = true
            self.nx.sendnx("dim=0")
        end
    end

    # What runs on this panel, for Main settings' Info: the
    # firmware as its build stamped it, and the screen as it says of itself when
    # its first page loads, with the dates they came to this panel. Rows of
    # [label, value]; what is not known says so. A row with a third, the
    # action of a tap on it: Generate, on a panel that drew no web password. And
    # a fourth, a long press's: the password drawn removed, asked first. A
    # bridge's is on its page in the house.
    def panel_info()
        import introspect
        import persist
        import string
        var ver = introspect.get(tasmota, "version")
        var v = ver != nil ? tasmota.version() : nil
        var build = self.build != nil ? self.build : ["dev", ""]
        var seen = persist.find("panel_installed", nil)
        var here = (seen != nil && seen.find("build") == build[0] + " " + build[1]) ? seen.find("at") : nil
        var tft = self.tft_version != nil ? string.split(self.tft_version, " ") : []
        var pw = persist.find("panel_webpw", nil)
        var rows = [["Tasmota", v != nil ? string.format("%d.%d.%d", (v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF) : "unknown"],
                ["Firmware", build[0]],
                ["Built", Brain.short_date(build[1])],
                ["Installed", here != nil ? here : "unknown"],
                ["Screen", size(tft) > 0 ? tft[0] : "unknown"],
                ["Screen built", size(tft) > 1 ? Brain.short_date(tft[1]) : "unknown"],
                ["Flashed", persist.find("panel_tft_flashed", "unknown")],
                # the web password drawn at the first boot; a panel that drew none draws one from its row, and a row held
                # removes it, asked first
                pw != nil ? ["Web password", pw, nil, ["open", "confirm", "webPasswordRemove"]] : ["Web password", "Generate", ["webPassword"]]]
        # a configuration the saved file holds and this Berry cannot run (one of a newer version, after a rollback of the firmware, or one
        # malformed) is kept as it is, and the panel runs with none and saves nothing over it: the first row says so, on the glass,
        # where a panel that comes up empty would have nobody to tell it why
        if self.ui != nil && self.ui.store.readonly  rows.insert(0, ["Saved settings", "Kept, not run"]) end
        return rows
    end

    # The screen's file of the factory image: the image carries
    # the project's .tft, and the stamp it was built with, beside it. The screen
    # is judged by the tables the panel runs: a stamp
    # ends in the hash of the tables its screen was built from, and a screen of
    # the panel's own tables stays, wherever it came from -- a layout updated by
    # hand, the .jsonl and its .tft together, is one. A screen of other tables, or
    # that says none -- the Sonoff's own, joBr99's, one of ours from before -- is
    # given the image's file when that file is of the panel's tables, up to
    # SCREEN_TRIES times a file; when neither is, nothing is flashed, and the log
    # says why. With no tables on the panel, a screen that says the image's stamp
    # stays, and any other is given the file. Each try is counted before the
    # flash starts, so a panel that restarts in the middle counts it too, and a
    # flash that fails restarts the panel for the next one.
    #
    # With the tries over, the Wi-Fi comes back on. A panel with no network has
    # its radio off, and with a screen that is not ours the console is the only
    # way left to it: there FlashNextionFile flashes the file by hand
    #.
    # The boot knows its project: the screen is looked at once its first page says
    # which build it runs, or after SCREEN_WAIT_MS with nothing said
    def expect_screen(project, dir)
        self.screen_project = project
        self.screen_dir = dir
        self.screen_pending = true
        if self.tft_version != nil
            self.screen_due()
            return
        end
        tasmota.set_timer(Brain.SCREEN_WAIT_MS, / -> self.screen_due())
    end

    def screen_due()
        if !self.screen_pending  return end
        self.screen_pending = false
        self.screen_check(self.screen_project, self.screen_dir)
    end

    def screen_check(project, dir)
        import path
        import persist
        import string
        var base = (dir != nil ? dir : "/") + project
        var tft = base + ".tft"
        if !path.exists(tft) || !path.exists(tft + ".stamp") return end
        var f = open(tft + ".stamp", "r")
        var stamp = string.tr(f.read(), "\r\n", "")
        f.close()
        if stamp == "" return end
        var tables = Brain.tables_hash(base + ".jsonl")
        if self.tft_version != nil && (tables != nil ? Brain.stamp_hash(self.tft_version) == tables : self.tft_version == stamp)
            # it runs a screen of these tables, or the file itself: a later one
            # counts its tries from none
            if persist.contains("panel_tft_tries")
                persist.remove("panel_tft_tries")
                self.safe_save(false)
            end
            return
        end
        if tables != nil && Brain.stamp_hash(stamp) != tables
            log("SCREEN: the screen says " + str(self.tft_version) + ", and neither it nor the image's .tft (" + stamp + ") is of the tables on the panel (" + tables + "): nothing flashed; flash the screen built with them", 2)
            return
        end
        # a try kept before the count was the first
        var tries = persist.find("panel_tft_auto") == stamp ? persist.find("panel_tft_tries", 1) : 0
        if tries >= Brain.SCREEN_TRIES
            log("SCREEN: the screen says " + str(self.tft_version) + ", and the image's .tft (" + stamp + ") was tried " + str(tries) + " times: the Wi-Fi comes on for the console, where FlashNextionFile " + tft + " flashes it by hand", 2)
            if self.wifi != nil  self.wifi.rescue() end
            return
        end
        persist.setmember("panel_tft_auto", stamp)
        persist.setmember("panel_tft_tries", tries + 1)
        # the count is what keeps a screen that never takes the file from being flashed at every boot: with no record of it
        # there is no flash, as a save that raised left it before
        if !self.safe_save(true)
            log("SCREEN: the count of tries could not be saved: nothing flashed", 1)
            return
        end
        log("SCREEN: the screen says " + str(self.tft_version) + ": flashing the image's .tft, " + stamp + ", try " + str(tries + 1) + " of " + str(Brain.SCREEN_TRIES), 2)
        self.install_begin(stamp)
        if self.nx != nil  self.nx.flash_file(tft, / ok -> self.screen_flashed(ok, project, dir)) end
    end

    # The first 8 hex digits of the SHA-256 of a project's tables, as a stamp ends
    # in them (build-project-hmi.mjs), or nil with no file. Read in pieces: the
    # heap has no room to spare for the whole file at once
    static def tables_hash(file)
        import path
        import crypto
        import string
        if !path.exists(file) return nil end
        var f = open(file, "rb")
        var h = crypto.SHA256()
        while true
            var b = f.readbytes(1024)
            if size(b) == 0 break end
            h.update(b)
        end
        f.close()
        return string.tolower(h.out()[0 .. 3].tohex())
    end

    # A stamp's third word, the hash of its screen's tables, or nil in one from
    # before it said them
    static def stamp_hash(s)
        import string
        if s == nil return nil end
        var w = string.split(s, " ")
        return size(w) > 2 && size(w[2]) == 8 ? string.tolower(w[2]) : nil
    end

    # The installation: the screen goes dark, as the screensaver
    # darkens it, and the buttons do nothing until the restart that ends it
    def install_begin(stamp)
        self.install_stamp = stamp
        if self.nx != nil  self.nx.sendnx("dim=0") end
        tasmota.cmd("ButtonDecoupleInert 1")
    end

    # Back to the state of a factory image:
    # a second later, for the effects of the touch to go out, the
    # panel leaves the house, the brain's persist and the Zigbee devices' files
    # are erased, and Tasmota's settings with Reset 1, which restarts. What the image brought stays: autoexec.be, the screen's .tft, its
    # tables and its stamp. The next boot is a first one: a web password drawn,
    # no Wi-Fi, no MQTT, no zones
    def factory_reset()
        tasmota.set_timer(Brain.FACTORY_MS, / -> self.factory_erase())
    end

    def factory_erase()
        import persist
        import path
        import global
        # out of the house first: the mesh's number and keys are in the driver's record, which the rest does not touch
        if global.contains("house") && global.house != nil
            global.house.leaving = true
            global.house.leave()
        else
            tasmota.cmd("EspNowMeshLeave 1", true)
        end
        persist.zero()
        self.safe_save(true)
        for f: Brain.ZIGBEE_FILES
            if path.exists(f)  path.remove(f) end
        end
        log("BRAIN: back to the factory image, restarting", 2)
        tasmota.cmd("Reset 1")
    end

    # Whether this is the boot the boot rescue opens its WiFi Manager in:
    # the driver's BootRescue says Due from the boot's start until it opens
    # it, 20 s in, and the brain starts before that. A firmware with no rescue
    # answers no such thing
    static def rescue_boot()
        var r = tasmota.cmd("BootRescue")
        var b = isinstance(r, map) ? r.find("BootRescue") : nil
        return isinstance(b, map) && b.find("Due", 0) == 1
    end

    # The first boot of a configuration that is new -- a factory image, or a Reset
    # that erased it: Tasmota counts the boots from 0, and the first count comes
    # 10 s in, so a first boot cut short is still the first. The panel has no web
    # password then, and gets one of its own, shown in Main settings' Info;
    # the one drawn before is set again, when the
    # configuration was erased under it. Any other boot leaves the password
    # alone, and one set by hand stays.
    def first_boot()
        import introspect
        import persist
        var s = introspect.get(tasmota, "settings")
        if s == nil || s.bootcount != 0  return end
        var pw = persist.find("panel_webpw", nil)
        if pw == nil
            self.draw_web_password()
            log("BRAIN: a new configuration: a web password drawn for the panel, shown in Main settings, Info", 2)
        else
            log("BRAIN: a new configuration: the panel's web password set again", 2)
            tasmota.cmd("WebPassword2 " + pw)
        end
    end

    # A web password for the panel: drawn, kept for Main settings' Info to show,
    # and set. WebPassword2 answers with asterisks, so the log never has it.
    def draw_web_password()
        import persist
        var pw = PairSign.password(10)
        persist.setmember("panel_webpw", pw)
        # the one Tasmota is given is the one the Info can show: with no copy kept, it is not set, and the panel has none (Generate again)
        if !self.safe_save(true)
            persist.remove("panel_webpw")
            return
        end
        tasmota.cmd("WebPassword2 " + pw)
    end

    # The web password removed, from the Info's row held, asked first:
    # the web page and the console open with none,
    # and Generate draws another. WebPassword2 " clears it, answering with asterisks
    def remove_web_password()
        import persist
        var pw = persist.find("panel_webpw", nil)
        if pw == nil return end
        persist.remove("panel_webpw")
        # kept when the file could not say it gone: Tasmota still has it, and the Info shows it
        if !self.safe_save(true)
            persist.setmember("panel_webpw", pw)
            return
        end
        tasmota.cmd('WebPassword2 "')
        log("BRAIN: the panel's web password removed at the glass", 2)
    end

    # Generate, on the Info's row of a panel that drew no web password:
    # one drawn now, as the first boot of
    # a new configuration draws one. A panel with none has its web page open
    # until then. One that has one keeps it.
    def generate_web_password()
        import persist
        if persist.find("panel_webpw", nil) != nil  return end
        self.draw_web_password()
        log("BRAIN: a web password drawn for the panel at the glass, shown in Main settings, Info", 2)
    end

    # The screen runs the image's .tft: a pattern is offered at the first Home of
    # the next boot, and the restart brings our pages up.
    # The web password was the first boot's (first_boot).
    def finish_install()
        import persist
        if self.install_stamp == nil  return end
        self.install_stamp = nil
        persist.setmember("panel_pattern_offer", true)
        self.safe_save(true)
        log("SCREEN: installed, restarting into our pages", 2)
        tasmota.set_timer(2000, / -> tasmota.cmd("Restart 1"))
    end

    # The first Home after the installation: a panel with no pattern is offered
    # one, once
    def offer_pattern()
        import persist
        if self.ui == nil || !persist.find("panel_pattern_offer", false)  return end
        persist.remove("panel_pattern_offer")
        self.safe_save(false)
        if size(self.ui.prefs["pattern"]) == 2  return end
        self.run(self.ui.open(["patternOffer"]))
    end

    # How the image's .tft went. A flash that stopped restarts the panel for the
    # next try, or, with none left, brings the Wi-Fi back at once. Says which it
    # did: "restart", "rescue", or nil for a flash that went through.
    def screen_flashed(ok, project, dir)
        import persist
        if ok
            # the screen restarts on the new build, and says it: finish_install
            tasmota.set_timer(Brain.INSTALL_END_MS, / -> self.finish_install())
            return nil
        end
        if persist.find("panel_tft_tries", 0) >= Brain.SCREEN_TRIES
            # no try left: the buttons are the panel's again, with the console
            self.install_stamp = nil
            tasmota.cmd("ButtonDecoupleInert 0")
            self.screen_check(project, dir)
            return "rescue"
        end
        log("SCREEN: the flash stopped, restarting for the next try", 2)
        tasmota.set_timer(2000, / -> tasmota.cmd("Restart 1"))
        return "restart"
    end

    # "2026-09-28T01:05", the builds' stamp, as the Info writes it: "28/09 01:05"
    static def short_date(s)
        if s == nil || size(s) < 16 || s[4] != "-"  return (s != nil && s != "") ? s : "unknown" end
        return s[8 .. 9] + "/" + s[5 .. 6] + " " + s[11 .. 15]
    end

    # The first boot of this firmware once the clock knows the time: when Main
    # settings' Info says it was installed. Looked at once a boot.
    def note_installed()
        if self.installed_noted || self.build == nil  return end
        var now = tasmota.rtc()
        if now["utc"] < 1700000000  return end
        self.installed_noted = true
        import persist
        var stamp = self.build[0] + " " + self.build[1]
        var seen = persist.find("panel_installed", nil)
        if seen != nil && seen.find("build") == stamp  return end
        persist.setmember("panel_installed", {"build": stamp, "at": tasmota.strftime("%d/%m %H:%M", now["local"])})
        self.safe_save(false)
    end

    # The screensaver came up. With a pattern, the lock closes: Main settings
    # asks for it again. Editing stays as it was.
    def sleep_views()
        if self.ui != nil  self.run(self.ui.sleep()) end
    end

    # The configuration changed from outside the glass -- the Web UI's page
    # (panel_web.be): what is on show draws again, the view on top or the plan.
    def refresh_views()
        if self.ui != nil && self.ui.top() != nil
            self.run(self.ui.render(self.ui.top()))
        elif self.plan != nil && self.plan.shown
            self.plan.on_show()
        end
    end

    # The Wi-Fi came up or went down (Tasmota's Wifi#Connected and
    # Wifi#Disconnected): a view of Wireless settings on show draws again, with
    # what it is now (PanelUi.wireless_changed).
    def refresh_wireless()
        if self.ui != nil  self.run(self.ui.wireless_changed()) end
        self.status_icon()
    end

    # The hotspot said something (the station driver's StaHotspot report): the
    # phones on it, or its closing. The Wi-Fi keeps it, the view on show draws it,
    # and the Home's sign follows
    # The backup's state changed (panel_backup.be): a request answered, or
    # started, and the view on show says so
    def backup_said()
        if self.ui != nil  self.run(self.ui.backup_changed()) end
    end

    def hotspot_said(v)
        if self.wifi != nil  self.wifi.hotspot_said(v) end
        if self.ui != nil  self.run(self.ui.hotspot_changed()) end
        self.status_icon()
    end

    # The Home's sign that the panel is open to a phone: the
    # hotspot in its header while the hotspot or the web setup is up, and nothing otherwise.
    # Written as the plan shows and when the Wi-Fi changes: a write reaches only
    # the page on show, so with another page up it goes nowhere.
    def status_icon()
        if self.ui == nil || self.panel == nil return end
        self.panel.set("$plan.statusIcon", self.ui.open_to_phone() ? "hotspot" : "")
    end

    # The pairing heard a bridge, or the Zigbee's mode switched: a
    # view of the Zigbee on show draws again (PanelUi.zigbee_changed)
    def refresh_zigbee()
        if self.ui != nil  self.run(self.ui.zigbee_changed()) end
        # the link up or down changes the Alarm screen's state, which says No link without it
        self.alarm_show()
    end

    # The station driver answered: a search found its networks
    # ("scan"), or a join ended ("join"). The Wi-Fi keeps what it said, and the
    # view on show draws it.
    def wifi_answer(kind, v)
        # the command's own answer ("Started", "Joining") reaches the same rule,
        # during the tasmota.cmd that sent it: only the report is a map
        if self.wifi == nil || !isinstance(v, map) return end
        if kind == "scan" self.wifi.scanned(v) else self.wifi.joined(v) end
        if self.ui != nil  self.run(self.ui.wifi_answer(kind)) end
    end

    # The buttons are the driver's: whether each tap is the
    # relay's or the panel's is kept there, and read from there, so this side
    # never holds a copy that disagrees. The driver is switched on, which it is
    # not on a fresh flash, and SetOption65 1 keeps quick power cycles from
    # wiping the configuration. A firmware without the driver keeps Tasmota's
    # own buttons, and the preferences as they were.
    def sync_buttons()
        if self.ui == nil  return end
        tasmota.cmd("SetOption65 1")
        tasmota.cmd("ButtonDecoupleEnable 1")
        var r = tasmota.cmd("ButtonDecouple")
        if r == nil || !isinstance(r, map) || !r.contains("ButtonDecouple") || !isinstance(r["ButtonDecouple"], list)
            log("BRAIN: no button driver in this firmware; the buttons stay Tasmota's", 2)
            return
        end
        var v = r["ButtonDecouple"]
        var i = 0
        while i < size(v) && i < size(self.ui.prefs["buttons"])
            self.ui.prefs["buttons"][i] = v[i] == 1 ? "panel" : "relay"
            i += 1
        end
    end

    # Our pages' Zigbee (panel_zigbee.be): what the views answer its events
    # with is carried out here, and the answers to our writes go back to it.
    def attach_zigbee(zb)
        self.zigbee = zb
        zb.run = / effects -> self.run(effects)
    end

    # The search's second: its countdown on the glass, until it ends. One chain
    # of timers at a time: a search opened again while one runs joins it.
    # A view on show counts seconds down (PanelUi.counting): drawn again every
    # second while it does, as a zone's + does its search
    def count_down()
        if self.counting_down || self.ui == nil || !self.ui.counting()  return end
        self.counting_down = true
        tasmota.set_timer(1000, def ()
            self.counting_down = false
            if self.ui == nil || !self.ui.counting()  return end
            self.run(self.ui.show())
            self.count_down()
        end)
    end

    def pair_tick()
        if self.pair_ticking  return end
        self.pair_ticking = true
        tasmota.set_timer(1000, def ()
            self.pair_ticking = false
            if self.ui == nil || self.ui.pairing == nil  return end
            self.run(self.ui.pair_tick())
            if self.ui.before(self.ui.pairing["until"], self.ui.PAIR_MS)  self.pair_tick() end
        end)
    end

    # A page loaded again, if the glass is still on it: a later touch may have
    # taken the finger elsewhere in the meantime.
    def reload(page)
        if self.ui != nil && self.ui.page != page  return end
        self.nx.sendnx("page " + str(page))
    end

    # `PatternClear` in the Tasmota console: the pattern that guards Settings
    # is forgotten. What protects the console is the Web UI's
    # own password.
    def clear_pattern()
        if self.ui != nil
            self.ui.prefs["pattern"] = []
            self.save_prefs()
            log("BRAIN: the pattern was cleared from the console", 2)
        end
        tasmota.resp_cmnd_done()
    end

    # The row slot a list or zone event is about: 2 for "$list.rows.2.label".
    static def slot_of(subject)
        import string
        if subject == nil  return nil end
        var parts = string.split(subject, ".")
        if size(parts) < 3 || parts[1] != "rows"  return nil end
        return int(parts[2])
    end

    # Our pages beyond the plan: true when the views took the event.
    def ui_event(event, subject, value, page)
        if self.ui == nil  return false end
        var pg = value != nil ? value : 0
        if event == "list.show" || event == "zone.show" || event == "lock.show" || event == "thermostat.show" || event == "cover.show"
            self.run(self.ui.shown(page))
        elif event == "lock.try"
            # the dots the finger joined, one digit each
            if value != nil  self.run(self.ui.lock_try(value)) end
        elif event == "list.page"
            self.run(self.ui.set_page(pg))
        elif event == "list.swipe"
            # the swipe up or down on a paged list: its next page, or the one before
            self.run(self.ui.swipe(subject))
        elif event == "list.row" || event == "list.hold"
            var k = Brain.slot_of(subject)
            if k != nil  self.run(self.ui.list_row(k, pg, event == "list.hold")) end
        elif Brain.ZONE_GESTURES.contains(event)
            self.run(self.ui.zone_row(subject, pg, Brain.ZONE_GESTURES[event]))
        elif event == "zone.count" || event == "zone.countHold"
            self.run(self.ui.zone_row(subject, pg, event == "zone.count" ? "tap" : "hold"))
        elif event == "house.count"
            # an icon of the house's page
            self.run(self.ui.house_icon(subject))
        elif event == "mesh.count"
            # the mesh's cog, over its nodes
            self.run(self.ui.mesh_cog())
        elif Brain.PAGE_TOUCHES.find(event) != nil
            # a page of advanced options: the row under its title, a thermostat's + and - and its modes, and
            # a blind's keys, up, stop or down, and its ventilation
            self.run(self.ui.page_touch(event, subject))
        elif event == "header.action" && page != self.panel.plan_page
            self.run(self.ui.action())
        elif (event == "light.brightness" || event == "light.colorTemp" || event == "light.hue") && self.ui.top() != nil && self.ui.top()["view"][0] == "detail"
            # a detail of OUR devices: the level goes to its target, one or many
            if value != nil
                self.run(self.ui.level(event == "light.brightness" ? "bri" : event == "light.colorTemp" ? "ct" : "hue", value))
            end
        elif event == "nav.close" && size(self.ui.stack) > 0 && page != self.panel.plan_page
            self.run(self.ui.close())
        elif event == "text.edit" && (subject == "$list.title" || subject == "$zone.title" ||
                                      (subject == "$light.name" && self.ui.top() != nil && self.ui.top()["view"][0] == "detail") ||
                                      (subject == "$thermostat.name" && self.ui.top() != nil && self.ui.top()["view"][0] == "thermostat") ||
                                      (subject == "$cover.name" && self.ui.top() != nil && self.ui.top()["view"][0] == "cover"))
            self.run(self.ui.rename_top())
        elif event == "text.commit" && self.ui.editing != nil && Brain.typed_as_is(self.ui.editing[1])
            # a password and a network's name are what was typed, spaces and all, and
            # a Wi-Fi password may be none, an open network's; a hidden
            # network's name of none goes back (PanelUi.commit)
            var typed = value != nil ? str(value) : ""
            if typed == "" && self.ui.editing[1] == "mqttPassword"
                log("BRAIN: an empty password is no password; keyboard stays open", 2)
                return true
            end
            self.run(self.ui.commit(typed))
        elif event == "text.commit" && self.ui.editing != nil
            var name = self.trim(value)
            if name == ""
                log("BRAIN: a name of only spaces is not a name; keyboard stays open", 2)
                return true
            end
            self.run(self.ui.commit(name))
        elif event == "text.cancel" && self.ui.editing != nil
            self.run(self.ui.cancel())
        else
            return false
        end
        return true
    end

    # The binding the plan's title is shown by, or nil without a plan.
    def plan_title_path()
        if self.plan == nil  return nil end
        return "$screen." + self.panel.plan_page + ".title"
    end

    def handle_panel_event(event, subject, value, page)
        # the screen says which build it is as its first page loads: kept for the
        # Info, and it is no touch
        if event == "panel.version"
            self.tft_version = value
            # the screen runs what was just installed: the installation ends; or a
            # first page said which build it runs, and the look at it is due now
            if self.install_stamp != nil && value == self.install_stamp
                self.finish_install()
            else
                self.screen_due()
            end
            return
        end
        # what the glass says comes from a finger on it, or from a page it
        # loaded for one: the screensaver's clock starts again
        self.touched()
        # an event from any other page means the glass has moved on, by a jump
        # of its own (the swipe down to Settings is one): the plan stops drawing
        if self.plan != nil && page != nil && page != self.panel.plan_page  self.plan.hide() end
        # every touch reports itself first, and says nothing more: but the alarm counts it, for the panic touch
        if event == "panel.touch"
            self.alarm_touch(page)
            return
        end
        # a notice of the alarm on the glass is left by a touch, whatever it landed on
        if self.alarm_intercept(event)  return end
        # a notice that took the glass from another page: the page's last touches hid the plan, and its canvas with it
        if event == "plan.show"  self.alarm_restore() end
        var picking = self.plan != nil && self.plan.picker != nil
        var canvas = self.plan != nil ? self.plan.canvas : nil
        if event == "plan.show"
            # the plan is up: whatever views were open are behind it now -- but
            # the colour picker is a view drawn on the plan's page, and the way
            # back to the zone's options stays
            if self.ui != nil
                # what the views held goes as they do: a keyboard's OK, a search, a
                # password typed (PanelUi.leave_views)
                if !picking && canvas == nil  self.run(self.ui.leave_views()) end
                self.ui.page = self.panel.plan_page
            end
            # the page has just loaded, as it was compiled: its card area is clean
            if self.plan != nil  self.plan.on_show(true) end
            self.status_icon()
            self.offer_pattern()
            return
        elif event == "plan.tap"
            if canvas != nil
                if value != nil  self.run(canvas.tap(value, self.plan.style)) end
                return
            end
            if picking
                # a dot is the zone's colour, and its options come back
                var chosen = value != nil ? self.plan.picker_at(value) : nil
                if chosen != nil && self.ui != nil  self.run(self.ui.pick_color(chosen)) end
                return
            end
            if self.plan != nil && value != nil  self.plan.on_tap(value) end
            return
        elif canvas != nil && (event == "header.action" || event == "nav.swipe")
            # a canvas's +, and its swipes
            if self.ui != nil  self.run(event == "header.action" ? self.ui.action() : canvas.swipe(subject)) end
            return
        elif (picking || canvas != nil) && (event == "plan.hold" || event == "header.action" || event == "nav.swipe" ||
                         (event == "text.edit" && subject == self.plan_title_path()))
            # the picker takes only its dots and its title's tap
            return
        elif event == "text.edit" && subject == self.plan_title_path() && self.plan.ghost == nil && !self.plan.editing
            # with Editing off, the plan keeps its name
            return
        elif event == "plan.hold"
            # a hold on the dashed card asks for its grid, which is typed; on a
            # card, it opens what the card is: the zone's screen,
            # or the page of its one device or of its one group
            if self.plan == nil || value == nil  return end
            var held = self.plan.on_hold(value)
            if held == "ghost"
                self.open_keyboard(Brain.PLAN_GRID_PATH, page, Brain.PLAN_GRID_LIMIT)
            elif held != nil && self.ui != nil
                self.run(self.ui.hold_card(held, self.plan.screen))
            end
            return
        elif event == "header.action" && self.plan != nil && page == self.panel.plan_page
            self.plan.on_action()
            # the check made a zone: its screen opens, where its devices go and its
            # buttons are marked
            var made = self.plan.made
            if made != nil
                self.plan.made = nil
                if self.ui != nil  self.run(self.ui.open_card(made, self.plan.screen)) end
            end
            return
        elif event == "nav.close" && self.plan != nil && page == self.panel.plan_page
            # the plan's title tapped: the picker goes back to the zone's options,
            # choosing nothing; a creation is called off; and with nothing being
            # created it opens Screens
            if picking || canvas != nil
                if self.ui != nil  self.run(self.ui.close()) end
                return
            end
            if !self.plan.cancel_ghost() && self.ui != nil
                self.run(self.ui.open_screens(self.plan.screen))
            end
            return
        elif event == "nav.swipe"
            # up is Wireless settings and down is Main settings, both through the
            # pattern; left and right are the carousel between the plans
            if subject == "up"
                if self.ui != nil  self.run(self.ui.open_wireless()) end
            elif subject == "down"
                if self.ui != nil  self.run(self.ui.open_settings()) end
            elif self.plan != nil
                self.plan.on_swipe(subject)
            end
            return
        end
        if self.ui_event(event, subject, value, page)  return end
        if event == "light.toggle"
            var id = self.light_id_at(subject)
            if id != nil
                self.light.toggle(id)
                return
            end
        elif event == "light.detail"
            var id = self.light_id_at(subject)
            if id != nil
                self.open_light_detail(id, page)
                return
            end
        elif event == "nav.close"
            # The X. It goes back to the screen the finger came FROM, which is
            # why this is an event and not a `page <name>` compiled into the
            # glass: with more than one group screen the way back is not fixed.
            # `return_page` is whatever was open when the detail
            # was asked for; with nothing behind it -- a reboot with the detail
            # showing -- it falls back to the manifest's `home_page`, the screen
            # the project's own screensaver hands the finger to. Taken from
            # there and not written as "home" here, which would be a page name
            # invented on this side.
            var back = self.return_page != nil ? self.return_page : self.panel.home_page
            self.go(back)
            self.return_page = nil
            return
        elif event == "light.brightness" || event == "light.colorTemp" || event == "light.hue"
            var id = self.light.open_detail_id
            if id == nil || value == nil
                log("BRAIN: " + str(event) + " with no detail page open or no value", 2)
                return
            end
            if event == "light.brightness"
                self.light.set_brightness(id, value)
            elif event == "light.colorTemp"
                self.light.set_color_temp(id, value)
            else
                self.light.set_hue_pct(id, value)
            end
            return
        elif event == "text.edit"
            # A long press on a heading. `subject` is the binding the heading
            # shows, which is also the key everything else about it is under.
            self.open_keyboard(subject, page)
            return
        elif event == "text.commit"
            self.commit_text(value)
            return
        elif event == "text.cancel"
            self.close_keyboard()
            return
        elif event == "keyboard.kind"
            # The switch is a two-state control and the kinds are two, so "on"
            # means the keypad -- the label beside it says so. Remembered here
            # and nowhere else: what it DOES happens the next time a long press
            # opens the keyboard.
            self.keyboard_kind = (value != nil && value != 0) ? "t9" : "qwerty"
            self.push_prefs()
            self.save_prefs()
            return
        elif event == "toggle.change"
            # The switch already flipped the glass's own copy (`vaLive`, written in
            # the same touch). This side keeps the preference so it can be written
            # back after a reboot of the panel, and it is the only thing to keep:
            # what the setting DOES lives in the sliders' Touch Move handlers.
            self.live_slider_update = value != nil ? value != 0 : !self.live_slider_update
            self.push_prefs()
            self.save_prefs()
            return
        end
        log("BRAIN: panel event " + str(event) + " (" + str(subject) + ") has no handler yet", 2)
    end

    # Everything below is the on-screen keyboard's half that is NOT on the glass.
    #
    # The typing itself never comes here: the page appends, deletes and measures
    # by itself, and the only frame it sends is the one OK builds. So
    # what this side owns is exactly the three things the glass cannot do --
    # remember which slot is being edited, say no to a name that is not a name,
    # and keep the answer across a reboot.

    # What a slot says now: what the user last typed, or what the page was
    # compiled showing. The manifest carries the second (`initial`), so the
    # project's own word for a screen is not written down twice.
    def text_of(path)
        # the plan's title is whatever the configuration calls the plan on show,
        # or the dashed card's name while one is up; its grid is the card's own
        if path != nil && path == self.plan_title_path()
            if self.plan.picker != nil  return "Color" end
            if self.plan.canvas != nil  return self.plan.canvas.title() end
            return self.plan.ghost != nil ? self.plan.ghost["name"] : self.plan.current()["title"]
        end
        if path == Brain.PLAN_GRID_PATH && self.plan != nil && self.plan.ghost != nil  return self.plan.ghost_grid() end
        var typed = self.texts.find(path)
        if typed != nil  return typed end
        if self.panel == nil  return "" end
        var base = self.panel.initial_text(path)
        return base != nil ? base : ""
    end

    # Open the keyboard on one binding.
    #
    # The capacity comes from the manifest, which took it from the `txt_maxl`
    # compiled into that very Text -- so the finger stops exactly where the
    # glass would have truncated in silence. A path with no
    # declared limit is not guessed at: it is refused, because a keyboard that
    # let the user type past the end would look like it worked.
    #
    # `limit` is for a value no placement shows, so the manifest has no capacity
    # for it: the dashed card's grid, four characters ("5x11").
    def open_keyboard(path, from_page, limit)
        if self.panel == nil || path == nil  return end
        if limit == nil  limit = self.panel.limit(path) end
        if limit == nil
            log("BRAIN: no declared capacity for " + str(path) + "; not opening the keyboard", 2)
            return
        end
        self.editing = path
        # this keyboard is this side's: a views' one left open does not take its OK
        if self.ui != nil  self.ui.editing = nil end
        if from_page != nil  self.return_page = from_page end
        self.panel.set("$keyboard.value", self.text_of(path))
        self.panel.set("$keyboard.max", limit)
        # Which keyboard, from the manifest and not from a name written here:
        # the project declares two (QWERTY and the T9 keypad) and a key on each
        # jumps to the other, on the glass, without telling this side. So what
        # this side picks is only where the finger STARTS.
        var page = self.keyboard_page_for()
        if page == nil
            log("BRAIN: this project has no keyboard page", 2)
            return
        end
        self.go(page)
    end

    # Which keyboard a rename opens on.
    #
    # The owner's switch first, the layout's own default second, and nothing
    # invented here: if the preference names a kind this project does not have
    # -- a layout with only the QWERTY, say -- the default wins rather than a
    # page name that would not exist. A `page` to a name the .tft does not
    # carry is a blank screen with no way back.
    def keyboard_page_for()
        if self.panel == nil  return nil end
        if self.keyboard_kind != nil && self.panel.keyboard_pads != nil
            var chosen = self.panel.keyboard_pads.find(self.keyboard_kind)
            if chosen != nil  return chosen end
        end
        return self.panel.keyboard_page
    end

    # Blanks off both ends. Berry's string module has no trim, and the rule
    # -- no empty name, no name made only of spaces -- is the
    # reason this exists rather than a nicety.
    # the slots whose text goes as typed: a password, and a network's name
    static def typed_as_is(target)
        return target == "wifiPassword" || target == "wifiName" || target == "mqttPassword"
    end

    def trim(v)
        var s = str(v)
        var a = 0
        var b = size(s) - 1
        while a <= b && s[a] == " "
            a += 1
        end
        while b >= a && s[b] == " "
            b -= 1
        end
        return a > b ? "" : s[a..b]
    end

    # OK. The glass already refused an empty line; this refuses one that is only
    # spaces, which on the glass would have been a loop.
    #
    # A refusal LEAVES THE KEYBOARD OPEN. There is nowhere else for the finger
    # to go and nothing else it could mean: the user is still typing a name.
    def commit_text(value)
        if self.editing == nil  return end
        var name = self.trim(value)
        if name == ""
            log("BRAIN: a name of only spaces is not a name; keyboard stays open", 2)
            return
        end
        if self.plan != nil && self.editing == Brain.PLAN_GRID_PATH
            # a grid is a size: the dashed card moves to where it fits, or says
            # why not, when the plan shows again
            self.plan.set_grid(name)
        elif self.plan != nil && self.editing == self.plan_title_path() && self.plan.ghost != nil
            # the dashed card's name, which becomes the zone's
            self.plan.rename_ghost(name)
            self.panel.set(self.editing, name)
        elif self.editing == self.plan_title_path()
            # the plan on show is renamed in the configuration, which keeps it
            var r = self.plan.store.rename_screen(self.plan.screen, name)
            if r["ok"]  self.plan.store.save() end
            self.panel.set(self.editing, name)
        else
            self.texts[self.editing] = name
            self.panel.set(self.editing, name)
            self.save_texts()
        end
        self.close_keyboard()
    end

    # Back where the finger came from, and forget what was being edited. Same
    # return_page the detail page's X uses, for the same reason: with more than
    # one group screen the way back is not a fixed page.
    def close_keyboard()
        self.editing = nil
        var back = self.return_page != nil ? self.return_page : (self.panel != nil ? self.panel.home_page : "home")
        self.go(back)
        self.return_page = nil
    end

    # The names the user typed, across reboots. One key for the lot: there are a
    # handful of them and they are written by hand, one at a time, so the cost
    # of rewriting the map is nothing and the alternative is a key per path in
    # a flash area shared with everything else Tasmota keeps.
    def load_texts()
        import persist
        var saved = persist.find("panel_texts", nil)
        return saved != nil ? saved : {}
    end

    # The panel's own preferences, kept across a reboot the same way the renamed
    # texts are. Separate from `panel_texts` because they answer different
    # questions and a reader of either should not have to skip the other.
    def load_prefs()
        import persist
        var saved = persist.find("panel_prefs", nil)
        if saved == nil  return end
        var kind = saved.find("keyboard_kind", nil)
        if kind != nil  self.keyboard_kind = kind end
        var live = saved.find("live_slider_update", nil)
        if live != nil  self.live_slider_update = live end
        var flags = saved.find("flags", nil)
        if flags != nil  self.flags = flags end
        if self.ui != nil
            var editing = saved.find("editing", nil)
            if editing != nil  self.ui.prefs["editing"] = editing end
            var buttons = saved.find("buttons", nil)
            if buttons != nil  self.ui.prefs["buttons"] = buttons end
            var pattern = saved.find("pattern", nil)
            if pattern != nil  self.ui.prefs["pattern"] = pattern end
            var saver = saved.find("screensaver", nil)
            if saver != nil && self.ui.valid_saver(saver)  self.ui.prefs["screensaver"] = saver end
            var sounds = saved.find("alarm_sounds", nil)
            if sounds == "off" || sounds == "home" || sounds == "always"  self.ui.prefs["alarmSounds"] = sounds end
        end
    end

    def save_prefs()
        import persist
        var clock = self.clock != nil ? self.clock.kept() : nil
        persist.setmember("panel_prefs", {
            "clock": clock,
            "keyboard_kind": self.keyboard_kind,
            "live_slider_update": self.live_slider_update,
            "flags": self.flags,
            "editing": self.ui != nil ? self.ui.prefs["editing"] : true,
            "buttons": self.ui != nil ? self.ui.prefs["buttons"] : ["relay", "relay"],
            # the salt and the SHA-256, never the pattern
            "pattern": self.ui != nil ? self.ui.prefs["pattern"] : [],
            "screensaver": self.ui != nil ? self.ui.prefs["screensaver"] : nil,
            # this panel's own beeps for the alarm
            "alarm_sounds": self.ui != nil ? self.ui.prefs.find("alarmSounds", "off") : "off",
        })
        if self.backup_ctl != nil  self.backup_ctl.changed() end
        self.safe_save(false)
    end

    def save_texts()
        import persist
        persist.setmember("panel_texts", self.texts)
        if self.backup_ctl != nil  self.backup_ctl.changed() end
        self.safe_save(false)
    end

    # Write every renamed slot back to the glass. Called at start, after the
    # page is up: the compiled page shows the project's word and the user's own
    # has to replace it before they see the old one.
    def restore_texts()
        if self.panel == nil  return end
        for path : self.texts.keys()
            self.panel.set(path, self.texts[path])
        end
    end

    # The light detail page on OUR stack: switch to it, then fill its bindings.
    # On joBr99's stack the same touch sends `entityUpdateDetail~…`, which none
    # of our pages understand; `light.send_detail` keeps doing that for his.
    #
    # The jump FIRST, as in `open_help`: the detail's components are local to
    # its page, and a write to a local component of a page that is not showing
    # is refused -- `lightdetail.tTitle0.txt="x"` sent with home up answered
    # `1A FF FF FF` in the Editor's debugger and the page opened with its title
    # empty; the same write with the detail up draws (measured).
    def open_light_detail(id, from_page)
        self.light.open_detail_id = id
        # Where the X will go back to. Only recorded when the caller knows it: a
        # detail opened from code rather than from a touch has nowhere to return.
        if from_page != nil  self.return_page = from_page end
        if self.panel == nil
            self.light.send_detail(id)
            return
        end
        var d = self.light.devices[id]
        var pcts = self.light.detail_pcts(id)
        self.go("lightdetail")
        self.panel.set("$light.name", d["name"])
        self.panel.set("$light.brightnessPct", pcts[0])
        self.panel.set("$light.colorTempPct", pcts[1])
        self.panel.set("$light.huePct", pcts[2])
    end

    # What the home page shows about every light, by binding: the name, the
    # icon's role for its state, and the icon's colour. Called at start and on
    # every change light.be reports (`on_change`), and harmless when no page
    # binds a light -- `set` returns how many components it wrote.
    def refresh_lights()
        if self.panel == nil || self.light == nil  return end
        var i = 0
        for id : self.light.devices.keys()
            var d = self.light.devices[id]
            var base = "$lights." + str(i)
            self.panel.set(base + ".name", d["name"])
            self.panel.set(base + ".icon", d["power"] != 0 ? "lightOn" : "lightOff")
            self.panel.set(base + ".iconColor", self.light.icon_color565(id))
            i += 1
        end
    end

    # One light changed (light.be's `on_change`): the cards, and the detail page
    # if it is showing that light.
    def on_light_changed(id, refresh_detail)
        self.refresh_lights()
        if refresh_detail && self.light.open_detail_id == id && self.panel != nil
            var pcts = self.light.detail_pcts(id)
            self.panel.set("$light.brightnessPct", pcts[0])
            self.panel.set("$light.colorTempPct", pcts[1])
            self.panel.set("$light.huePct", pcts[2])
        end
    end

    def render_screensaver()
        import string
        # On our own stack a page is a page: switch to it by name and fill it by
        # binding. None of joBr99's page vocabulary applies, because none of his
        # pages are in the file.
        if self.panel != nil
            self.sleep_views()
            # sendnx, not send: `page <name>` is a NATIVE Nextion instruction and
            # send() wraps its argument in joBr99's 55 BB frame, which the panel
            # would take as data and ignore
            self.go("screensaver")
            # lit, whatever the screen was, and off after Main settings' second time
            self.dark = false
            self.nx.sendnx("dim=100")
            if self.ui != nil  self.dark_at = tasmota.millis(self.ui.prefs["screensaver"][1] * 1000) end
            self.update_clock()
            self.draw_weather()
            # the cards and the status icon, by binding; and the panel's own
            # "live slider update" Variable, restored from what this side kept
            self.refresh_lights()
            self.restore_texts()
            self.alarm_signs()
            self.panel.set("$settings.liveSliderUpdate", self.live_slider_update ? 1 : 0)
            # The keyboard switch shows what this side remembers, and when this
            # side has no opinion it shows what the LAYOUT ships -- so the
            # control never claims a choice nobody made.
            self.panel.set("$settings.keyboardKind", self.keyboard_page_for() == self.panel.keyboard_pads.find("t9") ? 1 : 0)
            return
        end

        # same order as the original startup() (controller.py): time/date/
        # dimmode before switching pages — not yet confirmed on hardware
        # whether the order matters, but replicating the original is the
        # safest bet.
        self.update_clock()
        self.nx.send(string.format("dimmode~%d~%d~%d~~0", self.sleep_brightness, self.screen_brightness, self.bg_color_565))
        self.nx.send("pageType~screensaver")
        self.nx.send(string.format("timeout~%d", self.sleep_timeout))

        # no sensors/weather configured on the joBr99 stack: send the 5
        # weatherUpdate slots as "delete" (pages.py format:
        # generate_entities_item, type "delete" = "~delete~~~~~") so no
        # leftovers show on screen.
        var weather_items = ""
        for i:0..4
            weather_items += "~delete~~~~~"
        end
        self.nx.send("weatherUpdate" + weather_items)
        self.nx.send("statusUpdate~~~~~~")
    end

    def update_clock()
        var t = tasmota.rtc()['local']
        var time_str = tasmota.strftime("%H:%M", t)
        var date_str = tasmota.strftime("%d/%m/%Y", t)
        # With no time from the network yet, the clock counts from 0 at boot, and
        # "00:00" on 01/01/1970 is a time that is not one: no time, then. The
        # line is Tasmota's own for a clock that was set (START_VALID_TIME).
        if tasmota.rtc()['utc'] < 1451602800
            time_str = "--:--"
            date_str = ""
        end
        if self.panel != nil
            # by binding, not by command: the generated runtime knows which
            # component on which page carries the time, and this does not
            self.panel.set("$clock.time", time_str)
            self.panel.set("$clock.date", date_str)
            return
        end
        self.nx.send("time~" + time_str + "~")
        self.nx.send("date~" + date_str)
    end

    # --- the screensaver's weather --------------------------------------

    # What Home Assistant says, retained, on WEATHER_TOPIC: {"at": <UTC seconds>,
    # "cells": [[label, °C], ...]}, the first cell the weather now and the next
    # four the days ahead, a temperature a number or null. Anything else, an
    # empty message included, is no forecast. Drawn at once on the screensaver
    # only: the glass is never woken, nor another page written
    def weather_said(payload)
        import json
        var m = json.load(str(payload))
        var cells = isinstance(m, map) ? m.find("cells") : nil
        var at = isinstance(m, map) ? m.find("at") : nil
        self.weather = nil
        if isinstance(cells, list) && (type(at) == "int" || type(at) == "real")
            var kept = []
            for c: cells
                if size(kept) == 5 break end
                var label = isinstance(c, list) && size(c) > 0 && type(c[0]) == "string" ? c[0] : ""
                var temp = isinstance(c, list) && size(c) > 1 && (type(c[1]) == "int" || type(c[1]) == "real") ? c[1] : nil
                kept.push([label, temp])
            end
            self.weather = {"at": int(at), "cells": kept}
        elif size(str(payload)) > 0
            log("BRAIN: the weather said is not a forecast, and the screensaver shows none", 2)
        end
        if self.panel != nil && (self.ui == nil || self.ui.page == "screensaver")  self.draw_weather() end
    end

    # a forecast too old to show: with the clock set, past WEATHER_MAX_AGE
    def weather_too_old()
        var now = tasmota.rtc()["utc"]
        return self.weather != nil && now >= 1451602800 && now - self.weather["at"] > Brain.WEATHER_MAX_AGE
    end

    # The row's five cells, by binding: what Home Assistant said, or "--" --
    # and not an em dash: the theme fonts are 191-glyph subsets and none of them
    # carries U+2014. Kept in step with NO_READING in
    # libs/nspanel-sim/layout/src/format.ts, which cannot be imported from here
    def draw_weather()
        self.weather_old = self.weather_too_old()
        var cells = self.weather != nil && !self.weather_old ? self.weather["cells"] : []
        for i: 0 .. 4
            var c = i < size(cells) ? cells[i] : nil
            self.panel.set("$weather." + str(i) + ".label", c != nil ? c[0] : "")
            self.panel.set("$weather." + str(i) + ".temp", Brain.temp_text(c != nil ? c[1] : nil))
        end
    end

    # A cell's temperature: a whole degree and the unit, or "--", as the layout
    # formats it (formatTempC, libs/nspanel-sim/layout/src/format.ts): up from .6,
    # and never "-0"
    static def temp_text(celsius)
        import math
        if celsius == nil return "--" end
        var whole = int(math.floor(math.abs(real(celsius)) + 0.4 + 1e-9))
        if celsius < 0 && whole != 0  whole = -whole end
        return str(whole) + "\xc2\xb0C"
    end

    # A collection, when the garbage since the last one passed GC_STEP.
    def collect_garbage()
        import gc
        if gc.allocated() - self.gc_mark > Brain.GC_STEP
            self.gc_mark = tasmota.gc()
        end
    end

    def every_100ms()
        self.collect_garbage()
    end

    # --- the alarm: what its screens ask of the glass ---------------------------------------------------

    def alarm_obj()
        return self.ui != nil && self.ui.alarm != nil ? self.ui.alarm.alarm : nil
    end

    # The screensaver's two signs, lit or hidden: hidden is its own background, which the page starts as. Written only on the
    # screensaver, whose Texts they are; it writes them again when it comes back
    def alarm_signs()
        var al = self.alarm_obj()
        if al == nil || self.panel == nil || self.ui == nil || self.ui.page != "screensaver"  return end
        var s = al.signals()
        self.panel.set("$status.alarm.color", s[0] != nil ? s[0] : "background-screensaver")
        self.panel.set("$status.notice.color", s[1] != nil ? s[1] : "background-screensaver")
    end

    # the alarm's state or events changed: its screen on the plan is drawn again, and so is the plan under its stripe
    def alarm_show()
        var al = self.alarm_obj()
        self.alarm_signs()
        if self.plan == nil || al == nil || self.ui == nil || self.ui.alarm == nil || !self.plan.shown  return end
        if self.plan.canvas != nil
            if self.ui.alarm.owns(self.plan.canvas)  self.plan.on_show(false) end
        elif self.ui.alarm.stale()
            self.plan.on_show(false)
        end
    end

    # An event takes the glass: a screen asleep lit, the plan's page up if another is, and the notice drawn where the cards go,
    # over whatever views were open, which come back when it is left
    def alarm_notice()
        var al = self.alarm_obj()
        if self.plan == nil || al == nil || self.ui == nil || self.ui.alarm == nil || al.notice == nil  return end
        self.touched()
        self.plan.canvas = self.ui.alarm.canvas("notice")
        if self.ui.page == self.panel.plan_page && self.plan.shown
            self.plan.on_show(false)
        else
            self.go(self.panel.plan_page)
        end
    end

    # the plan's page loaded with a notice waiting for it: its canvas is back
    def alarm_restore()
        var al = self.alarm_obj()
        if al != nil && al.notice != nil && self.plan != nil && self.plan.canvas == nil
            self.plan.canvas = self.ui.alarm.canvas("notice")
        end
    end

    # The notice left: the views that were open drawn again, or the plan
    def alarm_dismiss()
        if self.plan == nil  return end
        self.plan.canvas = nil
        if self.ui != nil && size(self.ui.stack) > 0
            self.run(self.ui.show())
        elif self.plan.shown
            self.plan.on_show(false)
        end
    end

    # a touch of the glass, for the panic touch
    def alarm_touch(page)
        var al = self.alarm_obj()
        if al != nil  self.run(al.touch(page)) end
    end

    # with a notice on the glass, any touch of the plan's page leaves it, and is not what it landed on
    def alarm_intercept(event)
        var al = self.alarm_obj()
        # a brief notice (a panic's own word) is not left by a touch: the release of the touch that gave the panic would take it off
        # in the same breath, and it goes by its five seconds
        if al == nil || al.notice == nil || al.notice["kind"] == "brief" return false end
        if event == "plan.tap" || event == "plan.hold" || event == "header.action" || event == "nav.close" || event == "nav.swipe"
            self.run(al.dismiss())
            return true
        end
        return false
    end

    def alarm_tick()
        var al = self.alarm_obj()
        if al != nil  self.run(al.tick()) end
    end

    # The panel's one save (PanelStore.safe_save), which loads after this file, so it is found by name. It never raises,
    # and says whether the file was written. With `last` it is the last try: it does not wait for heap, for what goes on to a
    # restart, a flash or a password set, which the write was for
    def safe_save(last)
        import global
        return global.PanelStore.safe_save(last ? global.PanelStore.SAVE_TRIES : 0)
    end

    # A step of the second that failed, said once a minute at most: one that trips every second would fill the log, which holds a
    # few minutes of it, with a line that has nothing new
    def step_failed(step, err, m)
        var said = self.step_said
        if said == nil
            said = {}
            self.step_said = said
        end
        var at = said.find(step)
        if at != nil && !tasmota.time_reached(at)  return end
        said[step] = tasmota.millis(60000)
        log("PANEL: the " + step + " step of the second failed - " + str(err) + ": " + str(m), 1)
    end

    # fires every second; only refreshes the clock when the minute turns,
    # to avoid sending serial traffic for nothing.
    def every_second()
        # the schedule's minute first, and each step on its own: one that trips for good is no reason for the others not to run, and
        # the schedule is the one the house waits on
        if self.schedule != nil
            try
                self.run_schedule()
            except .. as err, m
                self.step_failed("schedule", err, m)
            end
        end
        try
            self.idle_tick()
        except .. as err, m
            self.step_failed("idle", err, m)
        end
        try
            self.alarm_tick()
        except .. as err, m
            self.step_failed("alarm", err, m)
        end
        try
            self.note_installed()
        except .. as err, m
            self.step_failed("installed", err, m)
        end
        var t = tasmota.rtc()['local']
        if tasmota.strftime("%S", t) == "00"
            # Our pages: the time is written where it shows, on the screensaver.
            # Its Texts are page 0's own, so with another page up the glass
            # refuses the write (0x1A) -- twice a minute, for nothing;
            # render_screensaver writes the time when the page comes back
            if self.panel != nil && self.ui != nil && self.ui.page != "screensaver" return end
            self.update_clock()
            # a forecast that grew too old on the screensaver goes to "--"
            if self.panel != nil && self.weather_too_old() != self.weather_old  self.draw_weather() end
        end
    end

end
