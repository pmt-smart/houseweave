# panel_boot.be -- the panel's boot: every piece of the brain, built and wired
# in order, for the project autoexec.be names (PanelBoot.start).
#
# The brain is compiled into the firmware, so autoexec.be, the one
# file of it that is still a file, says which project this panel runs and
# nothing else. This is the rest.
#
# Each piece is built in its own try: one that fails to construct (a bug, a
# typo) is logged, and the others keep working -- a clear error beats a panel
# frozen by a single piece. The order is the pieces' own: the display's driver
# first; the Zigbee transport before the light, which sends through it; the
# light before home and brain, which read it; the project's tables before our
# pages, which are drawn with them; brain last, over all of them.
#
# The instances are left where the console and the pieces look for them:
# global.nextion, zb_bridge, light, home, panel, plan and panel_ui.

#@ solidify:PanelBoot
class PanelBoot
    # what a bridge of the house that is not the panel's own says over the mesh that the panel takes: what it says of its devices
    static DEVICE_EVENTS = ["ZbReceived", "ZbState", "ZbResponse", "ZbInfo", "ZbPing", "ZbDriver"]
    # how often the panel's configuration is looked at against the house (house_upkeep)
    static UPKEEP_MS = 10000
    # Without PSRAM, the heap our pages take is the heap Wi-Fi, the web server
    # and OTA need, and a panel that cannot be reached cannot be fixed either. So
    # at the peaks of the boot -- the project's tables read, the configuration
    # built -- the free heap must still be at least this, and under it our pages
    # are dropped and the panel runs without them. A first figure,
    # from what Tasmota, Wi-Fi and Z2T used on the prototype, to be measured with
    # the Living room paired.
    static HEAP_FLOOR_KB = 60
    # the brain's classes, which the firmware carries
    static CLASSES = ["PanelBuild", "TftPack", "Nextion", "PanelRules", "ZigbeeBridge", "PairSign", "ZigbeePairing", "Light", "Home", "Brain", "PanelRuntime", "PanelText",
                      "PanelPlan", "PanelStore", "PanelDraw", "PanelPlanView", "PanelPlanCommands", "ClockLink", "PanelClock", "PanelUi", "PanelTapView", "PanelAddView", "PanelDriverView", "PanelSchedule", "PanelCalendarDraw", "PanelScheduleView",
                      "PanelZigbee", "PanelThermostat", "PanelCover", "PanelThermostatSettings", "PanelThermostatView", "PanelCoverView", "PanelPageButtons", "PanelLampSettings", "PanelAlarm", "PanelAlarmDraw", "PanelAlarmCanvas", "PanelAlarmView", "PanelNames", "PanelWifi", "PanelMqtt", "PanelHttp", "ServerLink", "MeshHttp", "NodeSettings", "NodeBackup", "PanelBackup", "PanelScheduleMqtt", "PanelWeb", "PanelRoute", "MeshEvents", "MeshCmd", "PanelGate", "MeshBeat", "HouseList", "HouseKey", "HouseState", "HouseDevices", "HouseLink", "HouseChannel", "HouseMesh", "HouseCommands", "HouseMqtt", "HouseAlarm", "HouseServer", "PanelRemoteView", "NodeOta", "NodeWireless", "PanelHouseView", "PanelBoot"]

    var project     # the generated project this panel runs, or nil for joBr99's stack
    var light       # light.be's model, or nil
    var home        # home.be's, or nil
    var panel       # the project's tables (panel_runtime.be), or nil
    var plan        # the plan on the glass, when the project's Home is one
    var ui          # our views
    var zb          # the Zigbee network as our pages see it
    var commands    # the transport of a command plan
    var clock       # the panel's own clock and place (panel_clock.be), with our pages
    var schedule    # the house's schedule (panel_schedule.be), with our pages
    var screens     # its screens (panel_schedule_view.be)
    var schedule_mqtt # and what the house's MQTT is told of it (panel_schedule_mqtt.be)
    var wifi        # the Wi-Fi as Wireless settings sees it
    var mqtt        # the MQTT as Wireless settings sees it and saves it
    var backup      # the configuration kept on the house's server (node_backup.be)
    var link        # the house's server: the pair's key, its requests and this panel's word to it (server_link.be), or nil
    var names       # the devices' names, told to the bridge for Home Assistant
    var house       # the house's list and key on the mesh (house_mesh.be), or nil on an image without the mesh driver
    var route       # where each line about a device goes, the link or the mesh (panel_route.be)
    var gate        # whether the bridge that owns a device of another room is ready to act on it (panel_gate.be)
    var mesh_cmd    # the commands to another room's bridge over the mesh (mesh_cmd.be), or nil on an image without the mesh driver

    def init(project)
        self.project = project
    end

    # The brain for `project`, which names its generated tables
    # (<project>.jsonl), or joBr99's stack for nil. What autoexec.be calls.
    static def start(project)
        import global
        var boot = PanelBoot(project)
        # the panel's rules, taken by one of Tasmota's (panel_rules.be): made before any part of the brain sets one
        PanelRules.start()
        global.nextion = Nextion.start()
        PanelBoot.keep_network()
        boot.base()
        # The buttons are the button driver's from the first boot, with our
        # pages or joBr99's, loaded or not: Tasmota's own would switch relay 2 on
        # a double press of button 1 and open the Wi-Fi manager on six. The
        # driver's tap switches the button's own relay until a panel takes it.
        # And seven quick power cycles do not wipe the
        # configuration. A firmware without the driver answers the second
        # command as unknown, and keeps Tasmota's buttons.
        tasmota.cmd("SetOption65 1")
        tasmota.cmd("ButtonDecoupleEnable 1")
        if project != nil
            boot.tables()
            if boot.panel != nil  boot.pages() end
        end
        # the Wi-Fi as the glass left it, with our pages up:
        # without them no Wireless settings brings it back, and it stays on
        if boot.ui != nil  boot.wireless() end
        boot.house_layer()
        boot.brain()
        boot.pings()
        PanelBoot.hotfixes()
        return boot
    end

    # The panel's way back, set at every boot before anything that can fail.
    # A panel with the Zigbee chip soldered in is updated over the
    # air only, so the network and the web server are what it cannot lose:
    #   - on a firmware built with Ethernet, Tasmota turns the Wi-Fi back on at
    #     boot only with Ethernet off, and a panel has none: without it, a `Wifi 0`
    #     would stay for good. `Ethernet` restarts the device whenever it is given
    #     a value, the same one included, so it is given one only while it is on:
    #     one restart, the first boot after a serial flash, and never again (sent
    #     at every boot it would be a restart at every boot). Our firmware has no
    #     Ethernet and turns the Wi-Fi on at every boot by itself,
    #     and there `Ethernet` answers Unknown and this sends nothing;
    #   - the web server is where OTA and the console are, and `WebServer 0`
    #     stays for good too. Setting it restarts nothing.
    static def keep_network()
        var ethernet = tasmota.cmd("Ethernet")
        if isinstance(ethernet, map) && ethernet.find("Ethernet") == "ON"  tasmota.cmd("Ethernet 0") end
        tasmota.cmd("WebServer 2")
    end

    # The free heap at a peak of the boot, under the floor or not. What a step
    # left behind is garbage, and garbage is not a heap that is gone: collected
    # first, it counts as free.
    static def heap_left(what)
        tasmota.yield()
        tasmota.gc()
        var free = tasmota.memory()["heap_free"]
        if free < PanelBoot.HEAP_FLOOR_KB
            raise "memory_error", what + " left " + str(free) + " KB of heap, under the " + str(PanelBoot.HEAP_FLOOR_KB) + " KB the network needs"
        end
    end

    # The Zigbee transport, and joBr99's light and home.
    def base()
        import global
        try
            global.zb_bridge = ZigbeeBridge()
        except .. as e, msg
            log("ZBBRIDGE: failed to load - " + str(e) + ": " + str(msg), 1)
        end
        # the nodes this panel adds to its house, found and paired from the glass
        try
            if global.zb_bridge != nil  global.zb_pairing = ZigbeePairing(global.zb_bridge) end
        except .. as e, msg
            log("ZBPAIR: failed to load - " + str(e) + ": " + str(msg), 1)
        end
        try
            self.light = Light(global.nextion, global.zb_bridge)
            # A single fixed test bulb (Coolo/eWeLink GU10 RGB), its Zigbee address
            # from a manual pairing. The joBr99 stack's only: on a panel with our pages the address is whatever
            # device another house gave it, and every report from it rewrote the
            # whole _persist.json.
            if self.project == nil  self.light.add("L1", "0x9F52", "Test light") end
            global.light = self.light
        except .. as e, msg
            log("LIGHT: failed to load - " + str(e) + ": " + str(msg), 1)
        end
        try
            self.home = Home(global.nextion, self.light)
            global.home = self.home
        except .. as e, msg
            log("HOME: failed to load - " + str(e) + ": " + str(msg), 1)
        end
        tasmota.yield()
    end

    # The generated project for this room: the manifest that says which
    # component on which page carries which binding, and what each touch means,
    # as a file of data beside its .tft, which berry/panel_runtime.be reads a
    # page at a time. Generated from the same declaration as the .tft by
    # libs/nspanel-sim/export/scripts/build-project-hmi.mjs.
    def tables()
        import global
        # A panel flashed with our .tft, whatever loads below. Our pages take
        # native instructions, and Protocol Reparse would hold every one of them
        # as data, so the driver stays out of it, and it has to from the first
        # screeninit: set after a project that failed to load, it never was, and
        # the display showed nothing the Berry sent. No reserved string to leave
        # it here: a display that just came up is out of it (its Program.s says
        # recmod=0), and one that kept running through an ESP32 restart is taken
        # out of it when no ready comes (Nextion.assume_ready, in brain).
        global.nextion.reparse = false
        try
            # sendnx and not send: everything this writes is a native Nextion
            # instruction (`page0.t3.txt="…"`), and send() would wrap it in
            # joBr99's 55 BB frame, which the panel takes as data
            self.panel = PanelRuntime(/ instruction -> global.nextion.sendnx(instruction), self.project)
            PanelBoot.heap_left(self.project + ".jsonl")
            global.panel = self.panel
            log("PANEL: running generated project " + self.project, 2)
        except .. as e, msg
            # a missing, broken or too heavy project file must not take the panel
            # down with it: without it brain falls back to the joBr99 stack,
            # which draws nothing on our .tft but leaves the panel on the network
            log("PANEL: failed to load " + self.project + " - " + str(e) + ": " + str(msg), 1)
            self.panel = nil
            global.panel = nil
        end
    end

    # Our pages: the configuration the user builds on the glass, the
    # views of a zone's screen and of the list, and the plan when this
    # project's Home is one (schema 11 of the project). A failure in any of them
    # leaves the rest of the panel running.
    def pages()
        import global
        var panel = self.panel
        try
            # the heap is looked at after the configuration, before anything is
            # registered: a failure there leaves nothing half wired
            var store = PanelStore(nil)
            store.load()
            PanelBoot.heap_left("the configuration")
            # every line goes over the mesh: about a device, to its bridge, and the house's words to the bridge of the house. Whether
            # it left is the route's word (false: no bridge, the mesh not there): the alarm's word that did not is told to the glass, which does not claim
            # a panic it did not send (brain.be's alarm effect)
            var route = PanelRoute(store, self.mesh_cmd)
            self.route = route
            if global.zb_bridge != nil  global.zb_bridge.via = / c -> route.send(c) end
            self.commands = PanelPlanCommands(/ c -> route.send(c), / n -> store.relay_powers(n))
            # a line to one bridge by its number: a device's leave from the house
            self.commands.send_at = / n, l -> route.send_at(n, l)
            # a channel of a device of several by its endpoint
            self.commands.address = / dev -> store.zb_address(dev)
            # a relay that feeds lamps rests between two changes, whoever makes
            # them: the button's hold, the Web UI and the console count as much
            # as a card
            var rules = PanelRules.of()
            rules.add_rule("Power1#state", def (v, tr, pl) if self.commands != nil  self.commands.relay_changed(1) end end)
            rules.add_rule("Power2#state", def (v, tr, pl) if self.commands != nil  self.commands.relay_changed(2) end end)
            # the Settings list is read from the project's tables when a view needs it
            self.ui = PanelUi(store, PanelBoot.shape(panel), / -> panel.settings_items(), nil)
            # the clock and the place: the preferences back in Tasmota, the clock's Time#Set heard, and its
            # screens in Main settings
            var clock = PanelClock()
            clock.load_saved()
            clock.apply()
            rules.add_rule("Time#Set", / -> clock.time_set())
            self.clock = clock
            self.ui.providers.push(clock)
            # what a tap on a zone's card turns on: its screens, from the zone's options and its group's page
            self.ui.providers.push(PanelTapView(store))
            # what a zone's + adds: a Zigbee device's search, or a relay device of its kind
            self.ui.providers.push(PanelAddView(self.ui))
            # the driver of a switch of two channels that opens and closes
            self.ui.providers.push(PanelDriverView(self.ui))
            # an existing device of another room's bridge, where the house has one
            self.ui.providers.push(PanelRemoteView(self.ui))
            # the house, in the Wireless settings: its nodes, a node struck off, a change of the key not closed
            self.ui.providers.push(PanelHouseView(self.ui))
            # the schedule, run every second by the brain on the store, the clock and the screens
            var schedule = PanelSchedule(self.ui.store, clock)
            schedule.ui = self.ui
            self.schedule = schedule
            var screens = PanelScheduleView(schedule)
            self.ui.schedule = screens
            self.ui.providers.push(screens)
            self.screens = screens
            if panel.plan_page != nil  self.plan_view(store) end
            # the network as our pages see it: reports, the search, what Z2T knows
            var zb = PanelZigbee(store, self.ui, self.plan, nil, / c -> route.send(c))
            self.zb = zb
            self.ui.network = zb
            # the thermostats' state, and the blinds', which the bridge's drivers say
            zb.thermostat = PanelThermostat(zb)
            zb.cover = PanelCover(zb)
            # and the lamps' settings, which the panel reads and writes itself
            zb.lamp = PanelLampSettings(zb)
            # the alarm, as the panel keeps it and shows it: its state and events from the bridge, its screens, its
            # notice, and the stripe the plan wears while it is armed
            var alarm = PanelAlarm(zb)
            zb.alarm = alarm
            var alarm_view = PanelAlarmView(alarm, self.ui)
            self.ui.alarm = alarm_view
            self.ui.providers.push(alarm_view)
            if self.plan != nil  self.plan.overlay = / style -> alarm_view.overlay(style) end
            # what the network has, as soon as it can be known: when the transport
            # says its link is up, in whatever mode, and a mode chosen later
            # included. With Zigbee off there is no link.
            if global.zb_bridge != nil
                global.zb_bridge.listen(/ p -> zb.on_event(p))
                global.zb_bridge.on_link(/ -> zb.linked())
                # the time with the bridge of the house: said when the session comes up, the bridge's taken
                clock.link = def (c) if global.zb_bridge.link_state()  global.zb_bridge.post(c) end end
                global.zb_bridge.on_link(/ -> clock.link_up())
                global.zb_bridge.listen(/ p -> clock.on_event(p))
            end
            # the devices' names, for the bridge's Home Assistant:
            # all of them with every link, and what a save changed
            var names = PanelNames(store, / c -> route.send(c))
            self.names = names
            store.on_saved = / -> names.changed()
            if global.zb_bridge != nil  global.zb_bridge.on_link(/ -> names.linked()) end
            # a command the lamps did not confirm in time: a ping for those, and only
            # those, and a zone's screen on show drawn with their "?", or sending
            if self.plan != nil
                self.plan.ping = / ids -> zb.ping(ids)
                self.plan.changed = def (ids) for id: ids zb.refresh_later(id) end end
            end
            global.panel_ui = self.ui
            log("PANEL: " + str(size(store.doc["zones"])) + " zones on " + str(size(store.doc["screens"])) + " plans", 2)
            # once all is built nothing can be undone, so under the floor it only says so
            tasmota.gc()
            var free = tasmota.memory()["heap_free"]
            if free < PanelBoot.HEAP_FLOOR_KB  log("PANEL: " + str(free) + " KB of heap left with our pages running, under the " + str(PanelBoot.HEAP_FLOOR_KB) + " KB floor", 1) end
        except .. as e, msg
            log("PANEL: our pages failed to load - " + str(e) + ": " + str(msg), 1)
            self.plan = nil
            self.ui = nil
            self.zb = nil
            self.commands = nil
            global.plan = nil
            global.panel_ui = nil
        end
    end

    # The Wi-Fi of Wireless settings, and what the glass chose for it
    # made again: this runs in the first tick of the main loop, before
    # Tasmota's first Wi-Fi check, so a radio that stays off never opens
    # Tasmota's AP. A failure leaves the Wi-Fi as Tasmota has it: on.
    def wireless()
        import global
        try
            var wifi = PanelWifi(global.zb_bridge)
            wifi.at_boot()
            self.wifi = wifi
            self.ui.wireless = wifi
        except .. as e, msg
            log("WIFI: failed to load - " + str(e) + ": " + str(msg), 1)
            self.wifi = nil
        end
        # and the MQTT, with the discovery as the glass chose it
        try
            var mqtt = PanelMqtt(global.zb_bridge)
            mqtt.at_boot()
            self.mqtt = mqtt
            self.ui.mqtt = mqtt
        except .. as e, msg
            log("MQTT: failed to load - " + str(e) + ": " + str(msg), 1)
            self.mqtt = nil
        end
        # and the backup of the configuration, told of every save of it, on the house's server, as every node's
        try
            var store = self.ui.store
            var link = ServerLink(/ -> PanelBoot.house_of(), PanelHttp(), / -> self.server_state(), / -> PanelBoot.house_nodes())
            # and the way to the server through a neighbour on the Wi-Fi, for this panel when it has none (the case 3)
            link.mesh = MeshHttp(/ -> PanelBoot.house_of(), PanelHttp(), / -> link.server())
            self.link = link
            var backup = NodeBackup(PanelBackup(self.project, store), PanelHttp(), link)
            var names = self.names
            # and the schedule's word on the house's MQTT, for Home Assistant's calendars
            var told = self.schedule != nil ? PanelScheduleMqtt(self.schedule, self.screens) : nil
            self.schedule_mqtt = told
            store.on_saved = def ()
                backup.changed()
                if names != nil  names.changed() end
                if told != nil  told.later() end
            end
            self.backup = backup
            self.ui.backup = backup
        except .. as e, msg
            log("BACKUP: failed to load - " + str(e) + ": " + str(msg), 1)
            self.backup = nil
        end
    end

    # the house's layer, or nil before it, or where the image has none
    static def house_of()
        import global
        return global.contains("house") ? global.house : nil
    end

    # the nodes of the house this panel tells the server of, with their keys (server_link.be)
    static def house_nodes()
        var h = PanelBoot.house_of()
        return h != nil && h.up ? ServerLink.nodes_of(h) : []
    end

    # what this panel says of itself to the house's server: what it runs, and its backup
    def server_state()
        return {"role": "panel", "image": PanelBuild.IMAGE, "build": PanelBuild.COMMIT, "date": PanelBuild.DATE,
                "backup": self.backup != nil ? self.backup.brief() : nil}
    end

    # The pages the views are drawn on, and their slots, as the manifest says.
    static def shape(panel)
        var pads = panel.keyboard_pads != nil ? panel.keyboard_pads : {}
        return {
            "pages": {"plan": panel.plan_page != nil ? panel.plan_page : panel.home_page, "list": panel.list_page,
                      "dialog": panel.dialog_page, "house": panel.house_page, "mesh": panel.mesh_page, "qr": panel.qr_page,
                      "zone": panel.zone_page, "thermostat": panel.thermostat_page, "cover": panel.cover_page, "help": panel.help_page, "detail": panel.detail_page,
                      "keyboard": pads.find("qwerty", panel.keyboard_page), "keypad": pads.find("t9"),
                      "lock": panel.lock_page},
            "listRows": panel.list_rows, "houseRows": panel.house_rows, "houseIcons": panel.house_icons, "meshRows": panel.mesh_rows, "qrMax": panel.qr_max, "qrLines": panel.qr_lines, "zoneRows": panel.zone_rows,
            "counters": panel.zone_counters, "helpLines": panel.help_lines, "thermostatLines": panel.thermostat_lines, "thermostatModes": panel.thermostat_modes,
        }
    end

    # The plan on the glass, when the project's Home is one: its cards, the
    # relays, and the buttons' taps.
    def plan_view(store)
        import global
        var panel = self.panel
        # a configuration made on the other panel turns a quarter to fit this one
        var fit = store.fit_matrix(PanelPlanView.matrix_of(panel.plan_style))
        if !fit["ok"]  log("PLAN: the configuration does not fit this panel - " + str(fit["refusal"]), 1) end
        var plan = PanelPlanView(store, panel.plan_style,
            / i -> global.nextion.sendnx(i),
            / p, intent -> self.commands.run(p, intent),
            / t -> panel.set("$screen." + panel.plan_page + ".title", t),
            / r -> panel.set("$plan.actionIcon", r))
        var power = tasmota.get_power()
        if size(power) >= 2  plan.relay_on = [power[0], power[1]] end
        # one picture of the lamps and the relays for the plan and the views, with
        # the commands not confirmed yet and the lamps with no communication
        self.ui.live = plan.live
        self.ui.unconfirmed = plan.unconfirmed
        self.ui.doubt = plan.doubt
        self.ui.relay_on = plan.relay_on
        self.plan = plan
        var rules = PanelRules.of()
        rules.add_rule("Power1#state", def (v, tr, pl) if self.plan != nil  self.plan.on_relay(1, v == 1) end end)
        rules.add_rule("Power2#state", def (v, tr, pl) if self.plan != nil  self.plan.on_relay(2, v == 1) end end)
        # an unlinked button's tap, as the button driver reports it
        rules.add_rule("Button1#Action", def (v, tr, pl) if v == "SINGLE" && self.plan != nil  self.plan.on_button(1) end end)
        rules.add_rule("Button2#Action", def (v, tr, pl) if v == "SINGLE" && self.plan != nil  self.plan.on_button(2) end end)
        global.plan = plan
    end

    # Brain, over every piece that came up.
    def brain()
        import global
        try
            var brain = Brain(global.nextion, self.light, self.home, self.panel, self.plan, self.ui, self.commands)
            # which build it is, for Main settings' Info (panel_build.be)
            brain.build = [PanelBuild.COMMIT, PanelBuild.DATE]
            # a configuration that is new gets the panel's web password
            brain.first_boot()
            # the factory image's .tft, for a screen that does not run it: looked
            # at once the first page had its time to say which one it runs
            var project = self.project
            if project != nil  brain.expect_screen(project) end
            # and the Wi-Fi the views ask for; a view of it on show draws again
            # when the Wi-Fi comes up or goes down
            brain.wifi = self.wifi
            brain.mqtt_ctl = self.mqtt
            brain.backup_ctl = self.backup
            brain.clock = self.clock
            brain.schedule = self.schedule
            # a tap on a zone of blinds only, or its button: their cycle
            if self.plan != nil  self.plan.cover_cycle = / ids -> brain.run(self.ui.cover_cycle(ids)) end
            if self.backup != nil  self.backup.said = / -> brain.backup_said() end
            if self.wifi != nil
                var rules = PanelRules.of()
                rules.add_rule("Wifi#Connected", / -> brain.refresh_wireless())
                rules.add_rule("Wifi#Disconnected", / -> brain.refresh_wireless())
                # and the station driver's answers, the search and the join
                rules.add_rule("StaScan", / v -> brain.wifi_answer("scan", v))
                rules.add_rule("StaJoin", / v -> brain.wifi_answer("join", v))
                rules.add_rule("StaHotspot", / v -> brain.hotspot_said(v))
            end
            # and the Zigbee's: its mode, its bridge and the pairing
            # the screens of the house draw again when a bridge answers a word of theirs
            var hv = self.ui != nil ? self.ui.provider_of("house", nil) : nil
            if hv != nil  hv.on_change = / -> brain.run(hv.redraw()) end
            # and when the house's list changes: a node in or out, a name, the house this panel founds as it leaves another
            # and the radio held or let go: a panel that has just founded its house, with no bridge and no network, lets it go (panel_wifi.be)
            if hv != nil && self.house != nil
                var wfh = self.wifi
                self.house.on_change = def (l)
                    brain.run(hv.redraw())
                    if wfh != nil  wfh.mode_changed() end
                end
                # and once now: the Wi-Fi's boot came before the house, and a panel with no house and no network holds its radio to found one
                if wfh != nil  wfh.mode_changed() end
            end
            # and when a node starts or stops being heard: its state on the mesh's list (house_mesh.be, poll)
            if hv != nil && self.house != nil  self.house.on_heard = / -> brain.run(hv.redraw()) end
            # and another node's screens on this panel, and this panel's on another (house_mesh.be, ask_view): a screen that came draws
            # again, and one asked of this panel is drawn by its own list, a touch on it changing this panel as its own touch would
            if hv != nil && self.house != nil
                self.house.on_view = / n -> brain.run(hv.view_came(n))
                self.house.view_fn = def (v, k, x)
                    var r = hv.render_for(v, k, x, / e -> brain.run(e))
                    if r != nil && size(r[4]) > 0  brain.run(r[4]) end
                    return r
                end
                # and this panel's OTA, from the house's server, and the pairing of that server on this panel: their screens draw again as
                # they change
                var house = self.house
                hv.ota = NodeOta(PanelHttp(), / -> house.server(), / -> brain.run(hv.ota_changed()), / -> house)
                # and its way to the server through a neighbour, for the safeboot image of a panel with no Wi-Fi
                if self.link != nil  hv.ota.mesh = self.link.mesh end
                brain.ota_ctl = hv.ota
                hv.server = HouseServer(/ -> house, / -> brain.run(hv.ota_changed()))
                # and the server's word to this panel: its upgrade, and its state; the backup's are the backup's. This panel says it is up
                if self.link != nil
                    var ota = hv.ota
                    self.link.on("upgrade", / -> {"upgrade": ota.upgrade_asked()})
                    self.link.on("state", / -> {})
                    self.link.hello("boot")
                end
            end
            # told by another panel to join another house: out of this one, this panel's window, on the glass
            var bui = self.ui
            if hv != nil && self.house != nil  self.house.on_move = / -> brain.run(PanelHouseView.window_open(bui)) end
            var pairing = global.contains("zb_pairing") ? global.zb_pairing : nil
            # the mode the network is reached in, as it switches and as it booted:
            # out of the bridge's, its lamps are marked as not answering
            var zbp = self.zb
            var wf = self.wifi
            if pairing != nil
                brain.zigbee_ctl = pairing
                if self.ui != nil  self.ui.zigbee = pairing end
                pairing.on_change = / -> brain.refresh_zigbee()
                global.zb_bridge.on_change = def ()
                    if zbp != nil  zbp.mode_is(global.zb_bridge.mode) end
                    # the radio held, or let go, as the house has a bridge or none (panel_wifi.be)
                    if wf != nil  wf.mode_changed() end
                    brain.refresh_zigbee()
                end
            end
            if zbp != nil && global.zb_bridge != nil  zbp.mode_is(global.zb_bridge.mode) end
            tasmota.add_driver(brain)
            # a page of another bridge's devices that came is drawn (house_devices.be)
            if self.house != nil  self.house.devices.on_page = / -> brain.refresh_views() end
            # what the views answer a Zigbee event with is carried out like any other
            if self.zb != nil  brain.attach_zigbee(self.zb) end
            # and what they answer a relay with: a relay sends no report, and a
            # zone's screen with a device it switches or feeds draws again
            var ui = self.ui
            if self.plan != nil && ui != nil  self.plan.relay_moved = / n -> brain.run(ui.refresh_relay(n)) end
            # the buttons' modes are the driver's: read them, and give it the buttons
            brain.sync_buttons()
            # the rooms in the Web UI, for the batch work the glass is slow at
            if ui != nil  tasmota.add_driver(PanelWeb(ui.store, / -> brain.refresh_views())) end
            # a display that kept running through the ESP32's restart says no
            # ready: it is taken back to its page 0 and drawn, a few seconds into
            # the boot
            if self.panel != nil  tasmota.set_timer(3000, / -> global.nextion.assume_ready()) end
        except .. as e, msg
            log("BRAIN: failed to load - " + str(e) + ": " + str(msg), 1)
            # the glass does nothing without it: the radio the Wi-Fi turned off
            # comes back, for the console
            if self.wifi != nil  self.wifi.rescue() end
        end
    end

    # The house's list and key on the mesh, where this image has the mesh driver: it waits by itself for the node to have a number
    # (the pairing gives it), and does nothing before. An image without the driver does not make it, and the panel runs as it did. It is global.house for the views
    def house_layer()
        import global
        try
            if HouseMesh.here()
                self.house = HouseMesh(HouseList.ROLE_PANEL)
                global.house = self.house
                # the console's way of building and reading a house
                HouseCommands(self.house)
                # a panel always has a house, and founds its own when it has none, but while it waits at its window for another to take it
                var waiting = global.contains("zb_pairing") ? global.zb_pairing : nil
                if waiting != nil  self.house.hold = / -> waiting.waits() end
                # and the house's MQTT, which this panel takes as every node does
                var mqtt = self.mqtt
                if mqtt != nil  self.house.mqtt = HouseMqtt(self.house, / m -> mqtt.apply(m)) end
                # and the alarm's configuration, which the screens read and write in the house's list, made again as the list changes
                var alarm = self.zb != nil ? self.zb.alarm : nil
                if alarm != nil && self.ui != nil
                    var house = self.house
                    var store = self.ui.store
                    var route = self.route
                    var zb = self.zb
                    alarm.house = house
                    alarm.owner = def (id)
                        var n = store.owner_of(id)
                        return n > 0 ? n : (route != nil && route.own != nil ? route.own() : 0)
                    end
                    house.alarm = HouseAlarm(house, def (c)
                        if alarm.from_house()  zb.emit([["alarmShow"]]) end
                    end)
                end
            end
            # the devices of other rooms: the marks this panel puts on them, and the state their bridges say
            if self.house != nil && self.ui != nil && self.zb != nil
                var store = self.ui.store
                var zb = self.zb
                var route = self.route
                self.house.state.wanted = def ()
                    var w = store.remote_by_owner()
                    # and the panel's devices of no bridge numbered, from before the house, at the bridge of the house
                    var own = route != nil && route.own != nil ? route.own() : 0
                    if own > 0
                        var set = w.find(own, [])
                        for ieee: store.own_ieees()
                            if set.find(ieee) == nil  set.push(ieee) end
                        end
                        if size(set) > 0  w[own] = set end
                    end
                    return w
                end
                self.house.state.deliver = / r -> zb.on_remote(r)
            end
            # the commands to the bridges of other rooms: the sender's half of MeshCmd, which waits for the mesh's clock by itself
            if MeshCmd.here()
                self.mesh_cmd = MeshCmd(nil)
                if self.route != nil  self.route.cmd = self.mesh_cmd end
            end
            # The bridge of the house: the one the house's words go to, and the alarm's and the time come from. This panel's
            # favourite while it is in step on the mesh, and else the first bridge of the house in step, by the gate; with none in step, the favourite
            if self.house != nil && self.route != nil
                var house = self.house
                var route = self.route
                route.own = def ()
                    if !house.up return 0 end
                    var fav = house.favorite()
                    var g = self.gate
                    if g == nil || fav <= 0 || g.ready.find(fav, false) return fav end
                    for id: house.bridges()
                        if g.ready.find(id, false) return id end
                    end
                    return fav
                end
                # and what the views show of it, and whether the house has a bridge at all (zigbee_bridge.be)
                if global.zb_bridge != nil
                    global.zb_bridge.house_bridge = route.own
                    global.zb_bridge.bridge_info = / n -> PanelBoot.bridge_info(house, n)
                    global.zb_bridge.bridges = / -> house.up ? size(house.bridges()) : 0
                end
                # What the bridges say over the mesh reaches the rules, as an event of Z2T's would, at the next turn of the loop: inside the mesh's rule,
                # Tasmota runs no other. From the bridge of the house, everything (the alarm's, the time, the drivers'); from another bridge of the house,
                # what it says of its devices (the reports, the interview, the answers, the map, the pings, its drivers), which the
                # panel hears when it shows some of them or commanded the bridge; and from any, its answer to a word of this panel's
                house.events = def (src, text, m)
                    if src == 0 || house.list.role(src) != HouseList.ROLE_BRIDGE || house.list.revoked(src) return end
                    if src != route.own() && !m.contains("ZbRelayAdmin")
                        var device = false
                        for k: PanelBoot.DEVICE_EVENTS
                            if m.contains(k)  device = true end
                        end
                        if !device return end
                    end
                    tasmota.defer(/ -> tasmota.publish_rule(text))
                end
            end
            # and the buttons of those devices, which are not there while their bridge is not ready
            if self.house != nil && self.ui != nil && self.zb != nil
                var zb = self.zb
                var gate = PanelGate(self.ui.store, / ieee, off -> zb.gate(ieee, off))
                self.gate = gate
                self.ui.gate = gate
                if self.route != nil  self.route.gate = gate end
                # and the bridge of the house: in step on the mesh, it is the room's session
                if self.route != nil && global.zb_bridge != nil
                    gate.own = self.route.own
                    gate.on_own = / up -> global.zb_bridge.mesh_session(up)
                    # and every bridge of the house, which a search may open, and which may become the bridge of the house
                    var hb = self.house
                    gate.others = / -> hb.up ? hb.bridges() : []
                    # and the route takes the house's words to it only while it is in step there
                    self.route.ready = / -> global.zb_bridge.mesh_up
                end
                # the configuration against the house, now and every UPKEEP_MS
                tasmota.set_timer(PanelBoot.UPKEEP_MS, / -> self.house_upkeep(), "panel_house_upkeep")
                # and leaving the house takes the house's devices from this panel
                var st = self.ui.store
                self.house.on_left = def ()
                    if st.drop_owned() > 0  st.save() end
                end
                # and the nodes the house forgets (house_mesh.be, sweep()): the devices of a bridge that is no more leave this panel, which the Notifications say,
                # and the web passwords this panel drew for it, the words it waits the answer of, and the gate's looks at it go
                var ui = self.ui
                self.house.forgets.push(def (m, forgot)
                    var changed = false
                    for n: st.remote_by_owner().keys()
                        if m.contains(n) continue end
                        var k = st.drop_bridge(n)
                        changed = true
                        log("HOUSE: bridge " + str(n) + " is no node of the house, and its " + str(k) + " devices left this panel", 2)
                        if k > 0 && self.zb != nil && self.zb.alarm != nil  self.zb.emit(self.zb.alarm.house_word("left", forgot.find(n, "A bridge"), k)) end
                    end
                    if changed  st.save() end
                    var hv = ui.provider_of("house", nil)
                    if hv != nil  hv.sweep(m) end
                    if self.gate != nil  self.gate.sweep(m) end
                end)
            end
        except .. as e, msg
            log("HOUSE: failed to load - " + str(e) + ": " + str(msg), 1)
            self.house = nil
        end
    end

    # The panel's configuration against the house, every UPKEEP_MS: in a house, its groups in its own range of numbers; the devices of the
    # bridge it was paired with, given that bridge's number, and the pair's record gone; and the groups' upkeep started. Saved when something
    # changed
    def house_upkeep()
        var h = self.house
        var store = self.ui != nil ? self.ui.store : nil
        try
            if h != nil && store != nil && h.up && h.list.me >= 1
                var changed = store.zid_space(h.list.me)
                if PanelBoot.unpair(h, store)  changed = true end
                if changed  store.save() end
                if self.zb != nil && !self.zb.grouping
                    self.zb.grouping = true
                    self.zb.start_groups()
                end
            end
        except .. as e, m
            log("HOUSE: the panel's upkeep failed - " + str(e) + ": " + str(m), 2)
        end
        tasmota.set_timer(PanelBoot.UPKEEP_MS, / -> self.house_upkeep(), "panel_house_upkeep")
    end

    # A bridge of the house as the views show it, {"mac", "name", "ip", "id"}, or nil
    static def bridge_info(house, n)
        var node = house.list.node(n)
        if node == nil || node["role"] != HouseList.ROLE_BRIDGE return nil end
        var mac = ""
        for i: 0 .. size(node["mac"]) - 1
            if i > 0  mac += ":" end
            mac += node["mac"][i .. i].tohex()
        end
        var ip = nil
        var a = node["ip"]
        if isinstance(a, bytes) && size(a) == 4  ip = str(a[0]) + "." + str(a[1]) + "." + str(a[2]) + "." + str(a[3]) end
        return {"mac": mac, "name": house.list.label(n), "ip": ip, "id": n}
    end

    # The pair of an older image, which paired a panel with one bridge: the devices of the bridge this panel was paired with, which the store keeps with no bridge numbered,
    # given that bridge's number once the house has it; that bridge this panel's favourite, when it has none; and the pair's record gone, here and in the
    # ESP-NOW driver. True when there was one, for the configuration to be saved
    static def unpair(house, store)
        import persist
        var p = persist.find("zb_bridge_peer", nil)
        if !isinstance(p, map) || !p.contains("mac") return false end
        var n = house.number_of(str(p["mac"]), HouseList.ROLE_BRIDGE)
        if n <= 0 return false end
        store.adopt_owner(n)
        if house.favorite() <= 0  house.set_favorite(n) end
        persist.remove("zb_bridge_peer")
        persist.remove("zb_bridge_mode")
        tasmota.cmd("EspNowPeerMac 00:00:00:00:00:00")
        tasmota.cmd("EspNowSecret2 0")
        log("HOUSE: the pair with the bridge " + str(n) + " is gone: its devices are its own, by its number in the house, and it is the favourite", 2)
        return true
    end

    # Pings the bulbs at boot (after the network is up) and whenever a relay
    # changes state -- switching a bulb off at the physical relay cuts its power
    # without any Zigbee notice, so this is how we notice it lost power (see
    # light.be: ping_all()/Reachable in on_zigbee_event). 5 s after the network
    # comes up: a ping sent sooner fails with "Command Error".
    #
    # 300 ms after the relay switches: a ping at that very instant can reach a
    # bulb whose contact has not opened yet, which answers though it is already
    # dark; and a longer wait is a lag the panel shows. joBr99's
    # stack only: our pages ping the lamps a command did not reach, and know a
    # lamp without power by its relay's mark.
    def pings()
        var light = self.light
        if light == nil || self.panel != nil return end
        tasmota.when_network_up(/ -> tasmota.set_timer(5000, / -> light.ping_all()))
        var rules = PanelRules.of()
        rules.add_rule("Power1#state", / v, tr, pl -> tasmota.set_timer(300, / -> light.ping_all()))
        rules.add_rule("Power2#state", / v, tr, pl -> tasmota.set_timer(300, / -> light.ping_all()))
    end

    # A class of the brain that a file replaced. On the panel the firmware's
    # classes are solidified, and one a file defined is not: that is how a hotfix
    # runs before the next firmware, and a panel that runs something
    # other than its firmware says so, at every boot.
    static def hotfixes()
        import introspect
        import global
        # the firmware's Berry tells a solidified class; an older one cannot, and
        # neither can the vendored interpreter the test suite also runs
        var solidified = introspect.get(introspect, "solidified")
        if solidified == nil || !solidified(PanelBoot) return end
        for name: PanelBoot.CLASSES
            var c = global.(name)
            if c != nil && !solidified(c)
                log("BOOT: " + name + " runs from a file, not from the firmware", 2)
            end
        end
    end
end
