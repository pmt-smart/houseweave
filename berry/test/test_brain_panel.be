# Exercises brain.be's side of OUR pages on the real Berry interpreter, with
# fakes for the panel driver, the light model and the generated PanelRuntime.
#
# What it holds: that every event the generated manifest can carry lands
# somewhere real -- a slider report on the light whose detail page is open, a
# hold on a card opening OUR detail page by binding and `page`, the live-slider
# switch remembered, and a change in a bulb reaching the cards by binding.
# Nothing here knows geometry or objnames: those are the runtime's, and
# test_panel_runtime.be covers them.
var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if got != want
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# --- the fakes ---------------------------------------------------------------
class FakeNx
    var on_event
    var sent        # joBr99-framed sends (unused on our pages)
    var native      # sendnx: raw Nextion instructions
    var flashed     # the files a flash was started from
    var done        # who is told how the last one ended
    def init() self.sent = [] self.native = [] self.flashed = [] end
    def send(s) self.sent.push(s) end
    def sendnx(s) self.native.push(s) end
    def flash_file(p, done) self.flashed.push(p) self.done = done return true end
end

class FakeLight
    var devices
    var open_detail_id
    var on_change
    var calls       # [method, id, value] in order
    def init()
        self.devices = {
            "L1": {"addr": "0x1", "name": "Ceiling", "power": 1, "bri": 254, "hue": 127, "sat": 0, "ct": 250},
            "L2": {"addr": "0x2", "name": "Desk", "power": 0, "bri": 100, "hue": 0, "sat": 0, "ct": 300},
        }
        self.calls = []
    end
    def toggle(id) self.calls.push(["toggle", id, nil]) end
    def set_brightness(id, pct) self.calls.push(["set_brightness", id, pct]) end
    def set_color_temp(id, pct) self.calls.push(["set_color_temp", id, pct]) end
    def set_hue_pct(id, pct) self.calls.push(["set_hue_pct", id, pct]) end
    def send_detail(id) self.calls.push(["send_detail", id, nil]) end
    def detail_pcts(id) return [50, 25, 10] end
    def icon_color565(id) return self.devices[id]["power"] != 0 ? 65222 : 17299 end
end

class FakePanel
    var writes      # [path, value, how many native instructions had gone before]
    var nx          # the FakeNx beside it, so a write knows what came before it
    var shown       # the page brain last put up (showing)
    # The generated runtime carries this: the screen the project's screensaver
    # hands the finger to, which is where a close with no history lands.
    var home_page
    # and these: how much each editable slot holds, and what the compiled page
    # already shows. Both are measured by the generator out of the theme's own
    # font and written into the manifest.
    var limits
    var initial
    var keyboard_page
    var keyboard_pads
    # the Settings template: two row slots on this layout, the project's list
    var items
    var settings_rows
    var settings_page
    var help_page
    var plan_page   # the page whose cards the runtime draws, or nil
    def init()
        self.writes = []
        self.home_page = "home"
        self.limits = {"$screen.home.title": 13, "$lights.0.name": 6}
        self.initial = {"$screen.home.title": "Home"}
        self.keyboard_page = "editboard"
        self.keyboard_pads = {"qwerty": "editboard", "t9": "editpad"}
        self.items = [
            ["Live update", "liveSliderUpdate", ["Changes the light while", "dragging."]],
            ["Keypad", "keyboardKind", ["Renaming opens a keypad."]],
            ["Setting A", "testSettingA", []],
        ]
        self.settings_rows = 2
        self.settings_page = "settings"
        self.help_page = "help"
    end
    # Help's page carries five body lines: a sixth is a binding nobody placed,
    # which the real runtime answers with 0 -- and that is how Help stops.
    def set(path, value)
        import string
        if string.find(path, "$help.lines.") == 0 && int(path[12..]) >= 5  return 0 end
        self.writes.push([path, value, self.nx == nil ? 0 : size(self.nx.native)])
        return 1
    end
    def on_payload(p) return nil end
    # the page brain says it put up, as the generated runtime keeps it for its set
    def showing(p) self.shown = p end
    # the tables the runtime reads from the project's file when a page asks for them
    def limit(path) return self.limits.find(path) end
    def initial_text(path) return self.initial.find(path) end
    def settings_items() return self.items end
    def wrote(path)
        var last = nil
        for w : self.writes
            if w[0] == path last = w[1] end
        end
        return last
    end
    # the native instruction sent last before the latest write to `path`
    def sent_before(path)
        var at = nil
        for w : self.writes
            if w[0] == path at = w[2] end
        end
        return (at == nil || at == 0) ? nil : self.nx.native[at - 1]
    end
end

var nx = FakeNx()
var light = FakeLight()
var panel = FakePanel()
panel.nx = nx
var brain = Brain(nx, light, nil, panel)

# --- construction wires light.be to us ----------------------------------------
check("brain registered for the light's changes", light.on_change != nil, true)
check("the live-slider preference starts off", brain.live_slider_update, false)
# the last raw frame is not kept and not served by a console command: a password typed on the glass travels in one
import introspect
check("no raw frame is kept", introspect.members(brain).find("last_raw_event"), nil)

# --- a hold on a card opens OUR detail page, by binding and by page ------------
brain.handle_panel_event("light.detail", "$lights.1", nil)
check("the detail page's light is the second card's", light.open_detail_id, "L2")
check("its name is written", panel.wrote("$light.name"), "Desk")
check("its brightness is written", panel.wrote("$light.brightnessPct"), 50)
check("its colour temperature is written", panel.wrote("$light.colorTempPct"), 25)
check("its hue is written", panel.wrote("$light.huePct"), 10)
check("and the page is switched with a NATIVE instruction", nx.native[-1], "page lightdetail")
# before the writes: a local component of a page that is not showing refuses
# them (measured in the Editor's debugger)
check("the jump goes before the name", panel.sent_before("$light.name"), "page lightdetail")
check("and before the hue, the last write", panel.sent_before("$light.huePct"), "page lightdetail")
check("joBr99's entityUpdateDetail is not sent on our pages", size(light.calls), 0)

# --- the X goes back to the screen the long press came FROM -------------------
# Not to a fixed page: with more than one group screen the way back is not known
# at compile time, which is why nav.close is an EVENT and not a `page <name>`
# baked into the glass.
brain.handle_panel_event("light.detail", "$lights.0", nil, "kitchen")
check("the detail remembers where it came from", brain.return_page, "kitchen")
brain.handle_panel_event("nav.close", nil, nil, "lightdetail")
check("the X returns there, not to home", nx.native[-1], "page kitchen")
check("and the history is spent, not kept", brain.return_page, nil)

# A close with nothing behind it still lands somewhere real.
brain.handle_panel_event("nav.close", nil, nil, "lightdetail")
check("a close with no history falls back to the first group screen", nx.native[-1], "page home")

# Reopen the detail the way the rest of the file expects it.
brain.handle_panel_event("light.detail", "$lights.1", nil)
# --- a slider report moves the light whose detail is open ---------------------
brain.handle_panel_event("light.brightness", "$light.brightnessPct", 57)
check("brightness goes to the open light", light.calls[-1], ["set_brightness", "L2", 57])
brain.handle_panel_event("light.colorTemp", "$light.colorTempPct", 80)
check("colour temperature too", light.calls[-1], ["set_color_temp", "L2", 80])
brain.handle_panel_event("light.hue", "$light.huePct", 3)
check("and hue, as a percentage", light.calls[-1], ["set_hue_pct", "L2", 3])
var before = size(light.calls)
brain.handle_panel_event("light.brightness", "$light.brightnessPct", nil)
check("a report with no value moves nothing", size(light.calls), before)
light.open_detail_id = nil
brain.handle_panel_event("light.brightness", "$light.brightnessPct", 57)
check("a report with no detail page open moves nothing", size(light.calls), before)

# --- a tap on a card toggles it -----------------------------------------------
brain.handle_panel_event("light.toggle", "$lights.0", nil)
check("the first card toggles the first light", light.calls[-1], ["toggle", "L1", nil])

# --- the live-slider switch is remembered, not acted on ------------------------
brain.handle_panel_event("toggle.change", nil, 1)
check("on", brain.live_slider_update, true)
brain.handle_panel_event("toggle.change", nil, 0)
check("off", brain.live_slider_update, false)
brain.handle_panel_event("toggle.change", nil, nil)
check("a report with no value flips it", brain.live_slider_update, true)

# --- a change in a bulb reaches the cards by binding --------------------------
panel.writes.clear()
light.devices["L1"]["power"] = 0
light.on_change("L1", true)
check("the first card's icon follows the state", panel.wrote("$lights.0.icon"), "lightOff")
check("its colour too", panel.wrote("$lights.0.iconColor"), 17299)
check("the second card is written as well", panel.wrote("$lights.1.name"), "Desk")
check("no detail page open: its sliders are not written", panel.wrote("$light.brightnessPct"), nil)
light.open_detail_id = "L1"
panel.writes.clear()
light.on_change("L1", true)
check("detail page open on that light: its sliders follow", panel.wrote("$light.brightnessPct"), 50)


# --- the on-screen keyboard --------------------------------------------------
# Three things this side owns, and it owns them because the glass cannot: which
# slot is being edited, whether what was typed is a name at all, and keeping the
# answer over a reboot. The typing itself never arrives here.
panel.writes.clear()
nx.native.clear()
brain.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
check("the keyboard is told what the slot says now", panel.writes[0][1], "Home")
check("under the binding the keyboard page shows", panel.writes[0][0], "$keyboard.value")
check("and how much it holds", panel.writes[1][0], "$keyboard.max")
check("which is the capacity the manifest declared", panel.writes[1][1], 13)
check("then the page opens", nx.native[0], "page editboard")

# a slot with no declared capacity does not open a keyboard that cannot stop
panel.writes.clear()
nx.native.clear()
brain.handle_panel_event("text.edit", "$nothing.declared", nil, "home")
check("an undeclared slot opens nothing", size(nx.native), 0)

# OK: the name is kept, written to the glass, and the finger goes back
panel.writes.clear()
nx.native.clear()
brain.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
panel.writes.clear()
nx.native.clear()
brain.handle_panel_event("text.commit", nil, "Living room", nil)
check("the typed name reaches the glass", panel.writes[0][0], "$screen.home.title")
check("as what was typed", panel.writes[0][1], "Living room")
check("and the finger goes back where it came from", nx.native[0], "page home")
check("the panel remembers it", brain.text_of("$screen.home.title"), "Living room")

# blanks off both ends, because a name with a space on it is the same name
brain.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
panel.writes.clear()
brain.handle_panel_event("text.commit", nil, "  Bedroom  ", nil)
check("the ends are trimmed", brain.text_of("$screen.home.title"), "Bedroom")

# and a name of only spaces is not a name: nothing is written and the keyboard
# stays open, because there is nowhere else for the finger to go
brain.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
panel.writes.clear()
nx.native.clear()
brain.handle_panel_event("text.commit", nil, "   ", nil)
check("only spaces changes nothing", brain.text_of("$screen.home.title"), "Bedroom")
check("and does not leave the keyboard", size(nx.native), 0)

# the X leaves without changing anything
brain.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
panel.writes.clear()
nx.native.clear()
brain.handle_panel_event("text.cancel", nil, nil, nil)
check("the X goes back", nx.native[0], "page home")
check("and wrote nothing", size(panel.writes), 0)
check("the name is what it was", brain.text_of("$screen.home.title"), "Bedroom")

# what the user typed survives a restart: restore_texts writes it back over
# whatever the page was compiled with
panel.writes.clear()
brain.restore_texts()
check("the typed name is written back at start", panel.writes[0][0], "$screen.home.title")
check("as the user's word and not the project's", panel.writes[0][1], "Bedroom")

# WHICH KEYBOARD OPENS. The layout ships a default -- a QWERTY key is 6.3 mm on
# the EU panel and 4.3 mm on the portrait one, against a keypad's 15.7, so the
# answer really differs -- and the panel's own switch overrides it. Nothing is
# invented on this side: a preference naming a kind the project does not carry
# falls back to the default, because a `page` to a name the .tft has no page for
# is a blank screen with no way back.
check("with no preference, the layout's own default opens", brain.keyboard_page_for(), "editboard")

brain.keyboard_kind = "t9"
check("the switch picks the keypad", brain.keyboard_page_for(), "editpad")

brain.keyboard_kind = "qwerty"
check("and picks the QWERTY back", brain.keyboard_page_for(), "editboard")

brain.keyboard_kind = "dvorak"
check("a kind this project does not have falls back", brain.keyboard_page_for(), "editboard")

brain.keyboard_kind = "t9"
panel.keyboard_pads = nil
check("and so does a project that declares no kinds at all", brain.keyboard_page_for(), "editboard")
panel.keyboard_pads = {"qwerty": "editboard", "t9": "editpad"}
brain.keyboard_kind = nil

# --- the list and the zone's screen are the views' (panel_ui.be) ----------------
# A real PanelUi on the Living room: brain only routes the glass's events to it and
# carries out the effects -- the pages, the writes, the commands. What each view
# shows is held to the TypeScript by test_panel_ui.be; this is the wiring.
import json
def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var t = f.read()
    f.close()
    return t
end
class FakeCommands
    var sent
    def init() self.sent = [] end
    def run(plan, intent) self.sent.push(["run", plan, intent]) end
    def identify(d) self.sent.push(["identify", d]) end
    def identify_plan(p) self.sent.push(["identifyPlan", p]) end
    def leave(d) self.sent.push(["leave", d]) end
    def permit(on, at) self.sent.push(at != nil && at > 0 ? ["permit", on, at] : ["permit", on]) end
    def button(n, mode) self.sent.push(["button", n, mode]) end
    def level(plan, key, value) self.sent.push(["level", plan, key, value]) end
    def startup(d) self.sent.push(["startup", d]) end
    def query(d) self.sent.push(["query", d]) end
    def drive(d, verb, key, value) self.sent.push(["drive", d, verb, key, value]) end
end
var ui_store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard", "keypad": "editpad"},
             "listRows": 2, "zoneRows": 2, "counters": 3, "helpLines": 5}
var ui = PanelUi(ui_store, shape, / -> panel.settings_items(), nil)
var cmds = FakeCommands()
var nx3 = FakeNx()
var panel3 = FakePanel()
panel3.nx = nx3
panel3.plan_page = "home"
var brain3 = Brain(nx3, FakeLight(), nil, panel3, nil, ui, cmds)
# what the brains above saved is in the same persist: start this one clean
brain3.live_slider_update = false
brain3.keyboard_kind = "qwerty"
brain3.flags = {}
brain3.push_prefs()

# the display is up: our pages draw the screensaver, which is blank as compiled
brain3.on_nextion_event("ready", "")
check("the display's ready draws the screensaver", nx3.native[-1] != nil, true)
check("with the time on it", panel3.wrote("$clock.time") != nil, true)
check("no time from the network yet: no time shown", panel3.wrote("$clock.time"), "--:--")
check("and no date", panel3.wrote("$clock.date"), "")
tasmota.utc_now = 1790000000
brain3.update_clock()
check("with the network's time, the time", panel3.wrote("$clock.time"), "%H:%M")
check("and the date", panel3.wrote("$clock.date"), "%d/%m/%Y")
tasmota.utc_now = nil

brain3.handle_panel_event("list.show", "$list.page", nil, "settings")
check("the swipe down to Settings fills its first slot", panel3.wrote("$list.rows.0.label"), "Live update")
check("and says whether it is on, in words", panel3.wrote("$list.rows.0.hint"), "Off")
check("with no switch at its end: the page starts with no icon, and none is written", panel3.wrote("$list.rows.0.icon"), nil)
check("the second slot shows the second item", panel3.wrote("$list.rows.1.label"), "Keypad")
check("titled as the view is", panel3.wrote("$list.title"), "Main settings")
brain3.handle_panel_event("list.page", "$list.page", 1, "settings")
check("page two starts at the third item", panel3.wrote("$list.rows.0.label"), "Setting A")
brain3.handle_panel_event("list.row", "$list.rows.0.label", 0, "settings")
check("slot 0 on page 0 flips the live setting", brain3.live_slider_update, true)
check("and tells the glass's own copy", panel3.wrote("$settings.liveSliderUpdate"), 1)
check("and the row says On", panel3.wrote("$list.rows.0.hint"), "On")
check("in the colour it had: no row lights up", panel3.wrote("$list.rows.0.on"), 0)
brain3.handle_panel_event("list.row", "$list.rows.1.label", 0, "settings")
check("slot 1 on page 0 is the keypad choice", brain3.keyboard_kind, "t9")
brain3.handle_panel_event("list.row", "$list.rows.0.label", 1, "settings")
check("slot 0 on page 1 is the third item, a plain flag", brain3.flags.find("testSettingA"), true)
nx3.native.clear()
brain3.handle_panel_event("list.hold", "$list.rows.0.label", 0, "settings")
check("a long press opens Help", nx3.native[0], "page help")
check("titled with the item's label", panel3.wrote("$help.title"), "Live update")
check("after the jump, not before", panel3.sent_before("$help.title"), "page help")
check("its own lines follow", panel3.wrote("$help.lines.1"), "dragging.")
brain3.handle_panel_event("nav.close", nil, nil, "help")
check("Help's title goes back to Settings", nx3.native[-1], "page settings")
brain3.handle_panel_event("nav.close", nil, nil, "settings")
check("and Settings' back to the plan", nx3.native[-1], "page home")

# a zone's screen: opened from the plan, and a device toggled from it
brain3.run(ui.open_card("z:middle", "home"))
check("the zone's page opens", nx3.native[-1], "page zone")
check("with its name", panel3.wrote("$zone.title"), "Middle")
brain3.handle_panel_event("zone.icon", "$zone.rows.0.label", 0, "zone")
check("a device's icon sends its own command", cmds.sent[-1][0], "run")
check("to that lamp alone", cmds.sent[-1][1]["unicast"], ["0x00124B0000E00001"])
# tapped again while it waits for the report, it turns back what it asked, and does
# not ask the same again off the lamp's last report
var asked = cmds.sent[-1][2]
# what waits for a report is the plan's (PanelPlanView.wait), shared with the
# views on the panel (panel_boot.be); this one has no plan, so it is kept here
ui.unconfirmed["0x00124B0000E00001"] = [asked, 1]
brain3.handle_panel_event("zone.icon", "$zone.rows.0.label", 0, "zone")
check("tapped again while it waits, the icon turns back what it asked", [asked, cmds.sent[-1][2]], [asked, asked == "on" ? "off" : "on"])
ui.unconfirmed.remove("0x00124B0000E00001")
var sent0 = size(cmds.sent)
brain3.handle_panel_event("zone.row", "$zone.rows.0.label", 0, "zone")
check("its name opens its options", panel3.wrote("$list.title"), "Middle 1")
check("and sends nothing", size(cmds.sent), sent0)
brain3.handle_panel_event("nav.close", nil, nil, "settings")
brain3.handle_panel_event("zone.hold", "$zone.rows.0.label", 0, "zone")
check("its name held renames it, through the keyboard", panel3.wrote("$keyboard.value"), "Middle 1")
brain3.handle_panel_event("text.cancel", nil, nil, "editpad")
check("called off, back on the zone's page", nx3.native[-1], "page zone")
brain3.handle_panel_event("zone.count", "$zone.counts.0.count", 0, "zone")
check("the counter sends the zone's group", cmds.sent[-1][1]["zids"], [3])
brain3.handle_panel_event("zone.row", "$zone.name.label", 0, "zone")
check("Settings under the title opens the zone's options on the list page", nx3.native[-1], "page settings")
check("titled with the zone", panel3.wrote("$list.title"), "Middle")
brain3.handle_panel_event("nav.close", nil, nil, "settings")
check("and the title goes back to the zone", nx3.native[-1], "page zone")
# the title held renames the zone, through the keyboard
brain3.handle_panel_event("text.edit", "$zone.title", nil, "zone")
check("the keyboard opens on the zone's name, on the keypad", nx3.native[-1], "page editpad")
check("with the name in it", panel3.wrote("$keyboard.value"), "Middle")
brain3.handle_panel_event("text.commit", nil, "  Centre ", "editpad")
check("the zone is renamed, trimmed", ui_store.find_zone("middle")["name"], "Centre")
check("and its page shows it", panel3.wrote("$zone.title"), "Centre")
check("back on the zone's page", nx3.native[-1], "page zone")
# a lamp's detail: its slider goes to that lamp, every time
brain3.handle_panel_event("nav.close", nil, nil, "zone")
brain3.run(ui.open_card("z:middle", "home"))
brain3.handle_panel_event("zone.iconHold", "$zone.rows.0.label", 0, "zone")
check("a lamp's icon held opens its detail", nx3.native[-1], "page lightdetail")
brain3.handle_panel_event("light.brightness", "$light.brightnessPct", 80, "lightdetail")
check("its brightness goes to it", cmds.sent[-1][2], "Dimmer")
check("as the level on the wire", cmds.sent[-1][3], 195)
check("to that lamp alone", cmds.sent[-1][1]["unicast"], ["0x00124B0000E00001"])
# its title held renames the lamp: the detail has no ⋯
brain3.handle_panel_event("text.edit", "$light.name", nil, "lightdetail")
check("the detail's title held opens the keyboard on the lamp's name", panel3.wrote("$keyboard.value"), "Middle 1")
brain3.handle_panel_event("text.cancel", nil, nil, "editpad")
check("called off, back on the detail", nx3.native[-1], "page lightdetail")
# the joint mode: by the zone's group, at most one every 500 ms, the last one kept
brain3.handle_panel_event("nav.close", nil, nil, "lightdetail")
brain3.handle_panel_event("zone.countHold", "$zone.counts.0.count", 0, "zone")
check("the counter's hold opens the joint mode", panel3.wrote("$light.name"), "Centre · 12 lamps")
var n0 = size(cmds.sent)
brain3.handle_panel_event("light.brightness", "$light.brightnessPct", 10, "lightdetail")
check("the first of a drag goes at once, by the group", cmds.sent[-1][1]["zids"], [3])
brain3.handle_panel_event("light.brightness", "$light.brightnessPct", 20, "lightdetail")
brain3.handle_panel_event("light.brightness", "$light.brightnessPct", 30, "lightdetail")
check("the next ones wait their turn", size(cmds.sent), n0 + 1)
brain3.flush_level()
check("and the latest goes when it comes", cmds.sent[-1][3], (5 + 90 * 30 / 100) * 254 / 100)
check("only it", size(cmds.sent), n0 + 2)
# a level a drag left waiting goes with the Off that comes after it, to the same lamps: a group's Dimmer is the lamps' on as well, and
# half a second behind the Off it lit them again
brain3.handle_panel_event("light.brightness", "$light.brightnessPct", 40, "lightdetail")
check("a drag's level waits its turn", brain3.level_last != nil, true)
var n1 = size(cmds.sent)
brain3.run([["command", ui_store.zone_plan("middle", [true, true]), "off", []]])
check("the zone is turned off", [size(cmds.sent), cmds.sent[-1][2]], [n1 + 1, "off"])
check("and the level that waited is let go with it", brain3.level_last, nil)
brain3.flush_level()
check("so the Dimmer behind the Off never goes", size(cmds.sent), n1 + 1)
# an On does not take it: the lamps come on, and at the level that was dragged to
brain3.handle_panel_event("light.brightness", "$light.brightnessPct", 50, "lightdetail")
brain3.run([["command", ui_store.zone_plan("middle", [true, true]), "on", []]])
check("an On leaves the waiting level to go", brain3.level_last != nil, true)
brain3.run([["command", ui_store.zone_plan("hall", [true, true]), "off", []]])
check("and so does an Off to other lamps", brain3.level_last != nil, true)
brain3.flush_level()
check("which goes when its time comes", cmds.sent[-1][3], (5 + 90 * 50 / 100) * 254 / 100)
brain3.handle_panel_event("nav.close", nil, nil, "lightdetail")

# a views' keyboard: its line before its page, which copies it in as it loads;
# and left open behind the plan, its OK is not the next one's
brain3.handle_panel_event("zone.hold", "$zone.rows.0.label", 0, "zone")
check("the keyboard's page goes last", nx3.native[-1], "page editpad")
check("after its line", panel3.sent_before("$keyboard.value") != "page editpad", true)
brain3.handle_panel_event("plan.show", nil, nil, "home")
check("the plan puts the keyboard behind it", ui.editing, nil)
brain3.handle_panel_event("text.commit", nil, "Living", "editpad")
check("and an OK after renames nothing of the views", ui_store.find_device("0x00124B0000E00001")[1], "Middle 1")

# the Home's sign that the panel is open to a phone
check("the Home carries no sign while no phone can reach the panel", panel3.wrote("$plan.statusIcon"), "")
class FakeWebSetup
    def state() return {"web": true, "ap": "tasmota-3E51A7-6960"} end
    def zigbee_mode() return "off" end
end
var wireless_before = ui.wireless
ui.wireless = FakeWebSetup()
brain3.handle_panel_event("plan.show", nil, nil, "home")
check("and the hotspot while the web setup is up", panel3.wrote("$plan.statusIcon"), "hotspot")
ui.wireless = wireless_before
brain3.refresh_wireless()
check("which goes when it ends, with the plan on show", panel3.wrote("$plan.statusIcon"), "")

# the pattern: Settings goes through the lock, whose tries the views answer
shape["pages"]["lock"] = "lock"
ui.hash_fn = / salt, pattern -> salt + ":" + pattern
ui.prefs["pattern"] = ["s", "s:1235789"]
brain3.handle_panel_event("list.show", "$list.page", nil, "settings")
check("with a pattern, Settings opens the lock", nx3.native[-1], "page lock")
check("which asks for it", panel3.wrote("$lock.title"), "Draw pattern")
brain3.handle_panel_event("lock.try", nil, 1478, "lock")
check("a wrong one paints the dots", panel3.wrote("$lock.wrong"), 1)
check("and says so", panel3.wrote("$lock.title"), "Wrong pattern")
brain3.handle_panel_event("lock.show", nil, nil, "lock")
check("the page back clears them", panel3.wrote("$lock.wrong"), 0)
brain3.handle_panel_event("lock.try", nil, 1379, "lock")
check("the right one opens Settings", nx3.native[-1], "page settings")
check("and the drawing stands for what is sensitive, a while", ui.unlocked, true)
# every time a plan opens Settings or Wireless settings, the pattern
brain3.handle_panel_event("nav.close", nil, nil, "settings")
brain3.handle_panel_event("list.show", "$list.page", nil, "settings")
check("closed and opened again from the plan, Settings asks for it again", nx3.native[-1], "page lock")
brain3.handle_panel_event("lock.try", nil, 1379, "lock")
check("and opens with it", nx3.native[-1], "page settings")
brain3.handle_panel_event("nav.close", nil, nil, "settings")
brain3.handle_panel_event("nav.swipe", "up", nil, "home")
check("the swipe up to Wireless settings asks for it too", nx3.native[-1], "page lock")
brain3.handle_panel_event("lock.try", nil, 1379, "lock")
check("and opens them with it", panel3.wrote("$list.title"), "Wireless settings")
brain3.handle_panel_event("nav.close", nil, nil, "settings")
brain3.handle_panel_event("nav.swipe", "down", nil, "home")
check("the swipe down to Main settings asks for it as well, from the runtime, no page of the glass's own first", nx3.native[-1], "page lock")
brain3.handle_panel_event("lock.try", nil, 1379, "lock")
check("and opens Main settings with it", panel3.wrote("$list.title"), "Main settings")
brain3.handle_panel_event("nav.close", nil, nil, "settings")
ui.prefs["editing"] = true
brain3.sleep_views()
check("the screensaver ends what the drawing stands for", ui.unlocked, false)
check("and leaves Editing as it was: the pattern is only the way into Settings", ui.prefs["editing"], true)
brain3.clear_pattern()
check("PatternClear forgets the pattern", ui.prefs["pattern"], [])
ui.prefs["editing"] = true
brain3.handle_panel_event("list.show", "$list.page", nil, "settings")
check("and Main settings opens without it", panel3.wrote("$list.title"), "Main settings")
brain3.handle_panel_event("nav.close", nil, nil, "settings")

# a paired lamp's writes: the answer is expected before the write goes out
class FakeZigbee
    var expected
    var run
    def init() self.expected = [] end
    def expect_startup(id) self.expected.push(id) end
end
var fz = FakeZigbee()
brain3.attach_zigbee(fz)
cmds.sent.clear()
brain3.run([["startup", "0xA1"], ["query", "0xA1"]])
check("a StartUpOnOff write is expected by the network side", fz.expected, ["0xA1"])
check("and goes out, with the question of its model", cmds.sent, [["startup", "0xA1"], ["query", "0xA1"]])
fz.run([["set", "$list.title", "from the network"]])
check("what the views answer a network event with is carried out here", panel3.wrote("$list.title"), "from the network")
# the Web UI renamed something: the view on show draws again
brain3.handle_panel_event("list.show", "$list.page", nil, "settings")
panel3.set("$list.title", "stale")
brain3.refresh_views()
check("a change from the Web UI draws the view on show again", panel3.wrote("$list.title"), "Main settings")
brain3.handle_panel_event("nav.close", nil, nil, "settings")

# and leave the persist as the plan's brain below expects it
brain3.keyboard_kind = "qwerty"
brain3.push_prefs()
brain3.save_prefs()

# --- the plan: its events reach it, and another page stops its drawing ---------
class FakeStore
    var renamed
    var saved
    def init() self.saved = false end
    def rename_screen(id, title) self.renamed = [id, title] return {"ok": true} end
    def save() self.saved = true end
end
class FakePlan
    var calls
    var store
    var screen
    var ghost
    var picker
    var canvas
    var shown
    var style
    var editing
    var made
    def init() self.calls = [] self.store = FakeStore() self.screen = "home" self.editing = true end
    def current() return {"id": "home", "title": "Home"} end
    def on_show(fresh) self.calls.push(fresh ? "show" : "redraw") end
    def on_tap(n) self.calls.push("tap " + str(n)) end
    def on_hold(n)
        self.calls.push("hold " + str(n))
        return self.ghost != nil ? "ghost" : nil
    end
    def on_action() self.calls.push("action") end
    def cancel_ghost() self.calls.push("cancel") end
    def ghost_grid() return "1x1" end
    def set_grid(t) self.calls.push("grid " + t) end
    def rename_ghost(n) self.ghost["name"] = n end
    def on_swipe(d) self.calls.push("swipe " + str(d)) end
    def hide() self.calls.push("hide") end
    def expect(ids, intent) self.calls.push("expect " + json.dump(ids) + " " + intent) end
end
var nx2 = FakeNx()
var panel2 = FakePanel()
panel2.nx = nx2
panel2.plan_page = "home"
var plan = FakePlan()
var brain2 = Brain(nx2, FakeLight(), nil, panel2, plan, nil, nil)
brain2.handle_panel_event("plan.show", nil, nil, "home")
brain2.handle_panel_event("plan.tap", nil, 120272, "home")
brain2.handle_panel_event("plan.hold", nil, 300140, "home")
brain2.handle_panel_event("nav.swipe", "left", nil, "home")
check("the plan hears its page, its touches and its swipes", plan.calls.concat(" | "),
      "show | tap 120272 | hold 300140 | swipe left")
plan.calls.clear()
brain2.handle_panel_event("list.show", "$settings.page", nil, "settings")
check("an event from another page stops the plan drawing", plan.calls.find("hide") != nil, true)
plan.calls.clear()
brain2.go("help")
check("and so does a jump this side makes", plan.calls, ["hide"])
plan.calls.clear()
brain2.go("home")
check("but not a jump back to the plan, which says when it shows", plan.calls, [])
# the plan's title is the configuration's, and a rename goes there
brain2.open_keyboard("$screen.home.title", "home")
check("the keyboard opens on the plan's own title", panel2.wrote("$keyboard.value"), "Home")
var loose = brain2.texts.find("$screen.home.title")
brain2.commit_text("Living room")
check("the rename reaches the configuration", plan.store.renamed[1], "Living room")
check("for the plan on show", plan.store.renamed[0], "home")
check("which is saved", plan.store.saved, true)
check("and shown", panel2.wrote("$screen.home.title"), "Living room")
check("not kept as a loose text", brain2.texts.find("$screen.home.title"), loose)

# the dashed card: the + reaches it, the title calls it off, a hold types its grid
plan.calls.clear()
brain2.handle_panel_event("header.action", "$screen.home.title", nil, "home")
check("the header's + reaches the plan", plan.calls, ["action"])
# the check made a zone: its screen opens
class OpenUi
    var opened, prefs, alarm
    def init() self.prefs = {"screensaver": [60, 300]} end
    def open_card(ref, screen) self.opened = [ref, screen] return [] end
end
brain2.ui = OpenUi()
plan.made = "z:z9"
brain2.handle_panel_event("header.action", "$screen.home.title", nil, "home")
check("the zone the check made opens, on its plan", brain2.ui.opened, ["z:z9", "home"])
check("once", plan.made, nil)
brain2.ui = nil
plan.calls.clear()
var before_close = size(nx2.native)
brain2.handle_panel_event("nav.close", nil, nil, "home")
check("a tap on the plan's title calls a creation off", plan.calls, ["cancel"])
check("and goes nowhere", size(nx2.native), before_close)
plan.ghost = {"name": "Card 6"}
plan.calls.clear()
brain2.handle_panel_event("plan.hold", nil, 30100, "home")
check("a hold on the dashed card opens the keyboard", nx2.native[-1], "page editboard")
check("on the card's grid", panel2.wrote("$keyboard.value"), "1x1")
check("four characters at most", panel2.wrote("$keyboard.max"), 4)
brain2.commit_text("23")
check("the grid typed goes to the dashed card", plan.calls[-1], "grid 23")
brain2.open_keyboard("$screen.home.title", "home")
check("while it is up, the title is the card's name", panel2.wrote("$keyboard.value"), "Card 6")
brain2.commit_text("Bench")
check("and a rename names the card", plan.ghost["name"], "Bench")
check("not the plan", plan.store.renamed[1], "Living room")

# --- Editing off: the plan keeps its + away and its name -----------
# In a function of its own, past the top level's 256 constants
def editing_checks()
    import persist
    # a hold on the plan's title renames it only with Editing on, and never under
    # the colour picker, which takes only its dots and its title's tap
    plan.ghost = nil
    plan.editing = false
    var before = size(nx2.native)
    brain2.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
    check("with Editing off, a hold on the plan's title opens no keyboard", size(nx2.native), before)
    plan.editing = true
    plan.picker = {}
    brain2.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
    check("nor under the colour picker", size(nx2.native), before)
    plan.picker = nil
    brain2.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
    check("with Editing on and no picker, the keyboard opens", nx2.native[-1], "page editboard")
    brain2.close_keyboard()
    # a boot with Editing off saved: the plan draws no + from the start
    var kept = persist.find("panel_prefs", nil)
    persist.setmember("panel_prefs", {"editing": false})
    var booted = FakePlan()
    var nx5 = FakeNx()
    var panel5 = FakePanel()
    panel5.nx = nx5
    panel5.plan_page = "home"
    Brain(nx5, FakeLight(), nil, panel5, booted, PanelUi(ui_store, shape, / -> panel5.settings_items(), nil), FakeCommands())
    check("a boot with Editing off saved leaves the plan's off too", booted.editing, false)
    if kept != nil  persist.setmember("panel_prefs", kept) else persist.remove("panel_prefs") end
end
editing_checks()

# --- a password and a network's name go as typed ------
def typed_checks()
    class TypedUi
        var editing, alarm
        var got
        def init(t) self.editing = ["keyboard", t] end
        def commit(text) self.got = text return [] end
    end
    var views = brain3.ui
    var t = TypedUi("wifiPassword")
    brain3.ui = t
    brain3.ui_event("text.commit", nil, " pass  1 ", "editboard")
    check("a Wi-Fi password goes as typed, spaces and all", t.got, " pass  1 ")
    t = TypedUi("wifiPassword")
    brain3.ui = t
    brain3.ui_event("text.commit", nil, "", "editboard")
    check("and an open network's, none", t.got, "")
    t = TypedUi("wifiName")
    brain3.ui = t
    brain3.ui_event("text.commit", nil, " Cottage 2G", "editboard")
    check("a network's name too", t.got, " Cottage 2G")
    t = TypedUi("mqttPassword")
    brain3.ui = t
    brain3.ui_event("text.commit", nil, "", "editboard")
    check("an MQTT password of none is none: the keyboard stays", t.got, nil)
    t = TypedUi("zoneName")
    brain3.ui = t
    brain3.ui_event("text.commit", nil, "  Living room  ", "editboard")
    check("a name the panel gives is trimmed", t.got, "Living room")
    brain3.ui = views
end
typed_checks()

# --- the garbage is collected on purpose, not left to double -----
# In a function of its own: this script's top level is far past 256 constants,
# where Berry's compiler gets an import followed by a for wrong
def collection_checks(brain)
    import gc
    brain.gc_mark = tasmota.gc()
    var mark = brain.gc_mark
    # a little garbage waits for more
    for i : 0 .. 20  var s = "a little garbage " + str(i) end
    brain.collect_garbage()
    check("under the step, nothing is collected", brain.gc_mark, mark)
    # past the step, the next tenth of a second collects it
    for i : 0 .. 2000  var s = "garbage enough to be worth a collection, line " + str(i) end
    check("the garbage is there", gc.allocated() - mark > Brain.GC_STEP, true)
    brain.every_100ms()
    var after = gc.allocated()
    check("past the step, the next tenth of a second collects it", after - mark < Brain.GC_STEP, true)
    # the collection was the last thing it did
    check("and remembers what was left", brain.gc_mark <= after && after - brain.gc_mark < 1024, true)
end
collection_checks(brain2)

# --- the screensaver after the glass goes untouched -----------------
def saver_checks()
    tasmota.at_ms = 0
    ui.prefs["screensaver"] = [60, 300]
    brain3.handle_panel_event("list.show", "$list.page", nil, "settings")
    brain3.handle_panel_event("panel.touch", nil, nil, "settings")
    nx3.native.clear()
    tasmota.at_ms = 59000
    brain3.every_second()
    check("a touch holds the screensaver off for Main settings' first time", nx3.native, [])
    # with a pattern drawn, the screensaver ends what the drawing stands for
    ui.prefs["pattern"] = ["00", "11"]
    ui.unlocked = true
    ui.prefs["editing"] = true
    tasmota.at_ms = 60000
    brain3.every_second()
    check("a minute untouched, the screensaver comes up", nx3.native.find("page screensaver") != nil, true)
    check("lit", nx3.native.find("dim=100") != nil, true)
    check("which the views know", ui.page, "screensaver")
    check("and the drawing stands no more for what is sensitive", ui.unlocked, false)
    check("Editing stays as it was", ui.prefs["editing"], true)
    nx3.native.clear()
    tasmota.at_ms = 60000 + 299000
    brain3.every_second()
    check("on it, the screen stays lit until the second time", nx3.native, [])
    tasmota.at_ms = 60000 + 300000
    brain3.every_second()
    check("five minutes on it, the screen goes off", nx3.native, ["dim=0"])
    tasmota.at_ms += 60000
    brain3.every_second()
    check("once", nx3.native, ["dim=0"])
    brain3.handle_panel_event("panel.touch", nil, nil, "screensaver")
    check("a touch lights it again", nx3.native, ["dim=0", "dim=100"])
    # a time chosen in Main settings is the one that counts
    ui.prefs["screensaver"] = [15, 30]
    brain3.handle_panel_event("plan.show", nil, nil, "home")
    nx3.native.clear()
    tasmota.at_ms += 14000
    brain3.every_second()
    check("with 15 s chosen, 14 s untouched is not enough", nx3.native, [])
    tasmota.at_ms += 1000
    brain3.every_second()
    check("and 15 s is", nx3.native.find("page screensaver") != nil, true)
    # a pair saved from another list, or none, is not taken
    check("a pair of the lists is valid", ui.valid_saver([30, 1800]), true)
    check("a time from neither list is not", ui.valid_saver([45, 300]), false)
    check("nor half a pair", ui.valid_saver([60]), false)
    ui.prefs["pattern"] = []
    ui.prefs["editing"] = true
    ui.prefs["screensaver"] = [60, 300]
    tasmota.at_ms = nil
end
saver_checks()

# --- Main settings' Info -----------------------------------------------------
def info_checks()
    brain3.handle_panel_event("panel.version", nil, "def5678 2026-09-28T01:02", "screensaver")
    check("the screen's stamp is kept", brain3.tft_version, "def5678 2026-09-28T01:02")
    brain3.build = ["abc1234+", "2026-09-28T01:05"]
    var rows = brain3.panel_info()
    check("the Info's rows", rows, [["Tasmota", "15.6.0"], ["Firmware", "abc1234+"], ["Built", "28/09 01:05"], ["Installed", "unknown"],
                                    ["Screen", "def5678"], ["Screen built", "28/09 01:02"], ["Flashed", "unknown"],
                                    ["Web password", "Generate", ["webPassword"]]])
    # a configuration saved that this Berry cannot run is kept, and the first row of the Info says it
    check("a store that reads its configuration has no such row", brain3.ui.store.readonly, false)
    brain3.ui.store.readonly = true
    var kept = brain3.panel_info()
    check("a configuration kept and not run: the Info says so in its first row, and the others are the same", [kept[0], size(kept), kept[1 ..]], [["Saved settings", "Kept, not run"], size(rows) + 1, rows])
    brain3.ui.store.readonly = false
    check("and the row goes with it", brain3.panel_info(), rows)
    check("a stamp that is not a date is shown as it is", Brain.short_date("dev"), "dev")
    check("and none, as unknown", Brain.short_date(""), "unknown")
    brain3.build = nil
end
info_checks()

# --- Wireless settings ---------------------------------------------------------------
# The Wi-Fi the views ask for, as the boot hands it over (panel_wifi.be): what it
# was asked, and the state it gives them.
class FakeWifi
    var asked, args, answers, st
    def init()
        self.asked = []
        self.args = []
        self.answers = []
        self.st = {"saved": "", "ssid": "", "up": false, "ip": "", "quality": nil, "mac": "24:0A:C4:3E:51:A7",
                   "off": false, "web": false, "ap": "tasmota-3E51A7-6960", "search": false, "reason": "",
                   "scanning": false, "networks": nil, "join": nil, "zigbee": "off"}
    end
    def run(op, args)
        self.asked.push(op)
        self.args = args
        if op == "web" self.st["web"] = true end
    end
    # the station driver's reports, as the Wi-Fi takes them in
    def scanned(v)
        self.answers.push("scan")
        self.st["networks"] = v["Networks"]
    end
    def joined(v) self.answers.push("join") end
    def state() return self.st end
    def zigbee_mode() return self.st["zigbee"] end
    def rescue() self.asked.push("rescue") end
end

# --- the factory image's .tft -----------------------------------
def screen_checks()
    import persist
    var dir = TEST_TMP + "/"
    persist.store.remove("panel_tft_auto")
    persist.store.remove("panel_tft_tries")
    var wifi = FakeWifi()
    brain3.wifi = wifi
    brain3.screen_check("p1-image", dir)
    check("with no .tft in the filesystem, nothing", nx3.flashed, [])
    var w = open(dir + "p1-image.tft", "wb")
    w.write(bytes("4E4E4E"))
    w.close()
    w = open(dir + "p1-image.tft.stamp", "w")
    w.write("abc1234 2026-09-28T10:00\n")
    w.close()
    brain3.tft_version = "abc1234 2026-09-28T10:00"
    brain3.screen_check("p1-image", dir)
    check("a screen that runs the image's .tft is left alone", nx3.flashed, [])
    brain3.tft_version = nil
    brain3.screen_check("p1-image", dir)
    check("one that does not say which it runs -- the Sonoff's own -- is given it", nx3.flashed, [dir + "p1-image.tft"])
    check("and the try is counted first", [persist.store["panel_tft_auto"], persist.store["panel_tft_tries"]], ["abc1234 2026-09-28T10:00", 1])
    check("a flash that stops restarts the panel for the next try", nx3.done(false), "restart")
    check("one that goes through does nothing more", nx3.done(true), nil)
    brain3.tft_version = "0000000 2026-09-01T10:00"
    brain3.screen_check("p1-image", dir)
    brain3.screen_check("p1-image", dir)
    check("the next boots try again, three tries a file", [size(nx3.flashed), persist.store["panel_tft_tries"]], [3, 3])
    check("the last one that stops brings the Wi-Fi back at once", nx3.done(false), "rescue")
    check("for the console", wifi.asked, ["rescue"])
    brain3.screen_check("p1-image", dir)
    check("with the tries over, no more flashes", size(nx3.flashed), 3)
    check("and the Wi-Fi comes back at every boot", wifi.asked, ["rescue", "rescue"])
    # a panel from before the count kept the stamp alone: that was its first try
    persist.store.remove("panel_tft_tries")
    brain3.screen_check("p1-image", dir)
    check("a try kept before the count was the first", persist.store["panel_tft_tries"], 2)
    brain3.tft_version = "abc1234 2026-09-28T10:00"
    brain3.screen_check("p1-image", dir)
    check("the screen that runs the file at last clears the count", persist.store.contains("panel_tft_tries"), false)
    persist.store.remove("panel_tft_auto")
    brain3.wifi = nil
    brain3.tft_version = nil
    nx3.flashed.clear()
end
screen_checks()

# A screen says its tables' hash after the date
# (build-project-hmi.mjs): it is matched on the whole stamp, and the Info shows
# the first two words
def stamp_hash_checks()
    import persist
    var dir = TEST_TMP + "/"
    var kept = [brain3.tft_version, brain3.install_stamp, persist.find("panel_tft_auto"), persist.find("panel_tft_tries")]
    persist.store.remove("panel_tft_auto")
    persist.store.remove("panel_tft_tries")
    var w = open(dir + "p2-image.tft", "wb")
    w.write(bytes("4E4E4E"))
    w.close()
    w = open(dir + "p2-image.tft.stamp", "w")
    w.write("abc1234 2026-10-02T10:00 a3715eef\n")
    w.close()
    brain3.tft_version = "abc1234 2026-10-02T10:00 a3715eef"
    brain3.screen_check("p2-image", dir)
    check("a screen that says the image's stamp, hash and all, is left alone", nx3.flashed, [])
    var rows = brain3.panel_info()
    check("the Info shows its commit and its date", [rows[4], rows[5]], [["Screen", "abc1234"], ["Screen built", "02/10 10:00"]])
    brain3.tft_version = "abc1234 2026-10-02T10:00"
    brain3.screen_check("p2-image", dir)
    check("one that says the commit and the minute without the hash is given the file", nx3.flashed, [dir + "p2-image.tft"])
    nx3.flashed.clear()
    brain3.tft_version = kept[0]
    brain3.install_stamp = kept[1]
    for k: ["panel_tft_auto", "panel_tft_tries"] persist.store.remove(k) end
    if kept[2] != nil  persist.store["panel_tft_auto"] = kept[2] end
    if kept[3] != nil  persist.store["panel_tft_tries"] = kept[3] end
end
stamp_hash_checks()

# The screen judged by the tables the panel runs: a stamp
# ends in the hash of its screen's tables. 021a91a4 is that file's, by Node's SHA-256
def pair_checks()
    import persist
    var dir = TEST_TMP + "/"
    var kept = [brain3.tft_version, brain3.install_stamp]
    for k: ["panel_tft_auto", "panel_tft_tries"] persist.store.remove(k) end
    # in binary, as the image carries it: a text write on Windows would put CRs in
    var w = open(dir + "p3-image.jsonl", "wb")
    w.write('{"format":3}\n{"page":"x"}\n')
    w.close()
    check("the tables' hash, as the build stamps it", Brain.tables_hash(dir + "p3-image.jsonl"), "021a91a4")
    check("no tables, no hash", Brain.tables_hash(dir + "p3-none.jsonl"), nil)
    check("a stamp's third word is its tables'", Brain.stamp_hash("abc1234 2026-10-02T10:00 021A91A4"), "021a91a4")
    check("one from before says none", Brain.stamp_hash("abc1234 2026-10-02T10:00"), nil)
    w = open(dir + "p3-image.tft", "wb")
    w.write(bytes("4E4E4E"))
    w.close()
    w = open(dir + "p3-image.tft.stamp", "w")
    w.write("abc1234 2026-10-02T10:00 021a91a4\n")
    w.close()
    brain3.tft_version = "def5678 2026-10-03T09:00 021a91a4"
    brain3.screen_check("p3-image", dir)
    check("a screen of the panel's tables, flashed by hand, stays", nx3.flashed, [])
    brain3.tft_version = "def5678 2026-10-03T09:00 0badf00d"
    brain3.screen_check("p3-image", dir)
    check("one of other tables is given the image's file, which is of them", nx3.flashed, [dir + "p3-image.tft"])
    nx3.flashed.clear()
    for k: ["panel_tft_auto", "panel_tft_tries"] persist.store.remove(k) end
    brain3.tft_version = "0000000 2026-09-01T10:00"
    brain3.screen_check("p3-image", dir)
    check("and so is one from before the hash", nx3.flashed, [dir + "p3-image.tft"])
    nx3.flashed.clear()
    for k: ["panel_tft_auto", "panel_tft_tries"] persist.store.remove(k) end
    # new tables uploaded by hand, and the screen built with them not flashed yet
    w = open(dir + "p3-image.jsonl", "wb")
    w.write('{"format":3}\n{"page":"y"}\n')
    w.close()
    brain3.screen_check("p3-image", dir)
    check("with neither of the panel's tables, nothing is flashed", [nx3.flashed, persist.store.contains("panel_tft_tries")], [[], false])
    brain3.tft_version = kept[0]
    brain3.install_stamp = kept[1]
    nx3.flashed.clear()
    for k: ["panel_tft_auto", "panel_tft_tries"] persist.store.remove(k) end
end
pair_checks()

# The installation: looked at as soon as the first page says its
# build, the screen dark and the buttons inert while it flashes, and, once the
# screen says the new build, a web password and the restart
def install_checks()
    import persist
    var dir = TEST_TMP + "/"
    class InstallTasmota : TasmotaStub
        var cmds, timers
        def init() self.cmds = [] self.timers = [] end
        def cmd(c) self.cmds.push(c) end
        def set_timer(ms, f, id) self.timers.push([ms, f, id]) end
    end
    var real_tasmota = tasmota
    tasmota = InstallTasmota()
    for k: ["panel_tft_auto", "panel_tft_tries", "panel_webpw", "panel_pattern_offer"] persist.store.remove(k) end
    nx3.flashed.clear()
    nx3.native.clear()
    brain3.tft_version = nil
    brain3.expect_screen("p1-image", dir)
    check("the boot waits a while for the screen to say its build", [size(tasmota.timers), tasmota.timers[0][0]], [1, Brain.SCREEN_WAIT_MS])
    brain3.handle_panel_event("panel.version", nil, "0000000 2026-09-01T10:00", nil)
    check("a first page that says another build is looked at at once", nx3.flashed, [dir + "p1-image.tft"])
    tasmota.timers[0][1]()
    check("and the wait over, not again", size(nx3.flashed), 1)
    check("the installation darkens the screen and leaves the buttons inert",
          [nx3.native.find("dim=0") != nil, tasmota.cmds.find("ButtonDecoupleInert 1") != nil], [true, true])
    tasmota.timers.clear()
    check("a flash that goes through waits for the screen to say the new build", [nx3.done(true), size(tasmota.timers)], [nil, 1])
    brain3.handle_panel_event("panel.version", nil, "abc1234 2026-09-28T10:00", nil)
    # the web password is the first boot's (first_boot_checks), not the installation's
    check("it does, and draws no password: the first boot did", [persist.store.contains("panel_webpw"), size(tasmota.cmds)], [false, 1])
    check("offers a pattern at the next boot, and restarts into our pages",
          [persist.store["panel_pattern_offer"], tasmota.timers[-1][0]], [true, 2000])
    tasmota.cmds.clear()
    tasmota.timers[0][1]()
    check("the wait for the screen over, nothing more", tasmota.cmds, [])
    # the next boot: the first Home offers the pattern, once
    ui.stack = []
    brain3.offer_pattern()
    check("the first Home after the installation offers a pattern", [panel3.wrote("$list.title"), persist.store.contains("panel_pattern_offer")],
          ["Protect these settings with a pattern?", false])
    ui.stack = []
    tasmota = real_tasmota
    brain3.tft_version = nil
    nx3.flashed.clear()
    for k: ["panel_tft_auto", "panel_tft_tries", "panel_webpw", "panel_pattern_offer"] persist.store.remove(k) end
end
install_checks()

# The web password at the first boot of a new configuration:
# Tasmota's boot count is 0 until 10 s into the first boot after an erase
def first_boot_checks()
    import persist
    class BootSettings
        var bootcount
        def init(n) self.bootcount = n end
    end
    class BootTasmota : TasmotaStub
        var cmds, settings
        def init(n) self.cmds = [] self.settings = BootSettings(n) end
        def cmd(c) self.cmds.push(c) end
    end
    var real_tasmota = tasmota
    persist.store.remove("panel_webpw")
    tasmota = BootTasmota(0)
    brain3.first_boot()
    var pw = persist.store.find("panel_webpw", "")
    check("the first boot of a new configuration draws a web password", [size(pw), tasmota.cmds], [10, ["WebPassword2 " + pw]])
    check("shown in Main settings, Info, and held off, asked first", brain3.panel_info()[-1], ["Web password", pw, nil, ["open", "confirm", "webPasswordRemove"]])
    tasmota = BootTasmota(0)
    brain3.first_boot()
    check("a configuration erased under a drawn one gets it again", [persist.store["panel_webpw"], tasmota.cmds], [pw, ["WebPassword2 " + pw]])
    tasmota = BootTasmota(1)
    brain3.first_boot()
    check("any other boot leaves the password alone", tasmota.cmds, [])
    persist.store.remove("panel_webpw")
    tasmota = BootTasmota(7)
    brain3.first_boot()
    check("a panel upgraded from before, with none drawn, keeps its own", [tasmota.cmds, persist.store.contains("panel_webpw")], [[], false])
    tasmota = real_tasmota
    brain3.first_boot()
    check("and a Tasmota with no settings to read draws nothing", persist.store.contains("panel_webpw"), false)
end
first_boot_checks()

# Generate, on the Info's row of a panel that drew no web password:
# one updated over the air keeps its configuration, and drew none
def generate_password_checks()
    import persist
    class PwTasmota : TasmotaStub
        var cmds
        def init() self.cmds = [] end
        def cmd(c) self.cmds.push(c) end
    end
    var real_tasmota = tasmota
    persist.store.remove("panel_webpw")
    var ui = brain3.ui
    var row = nil
    for r: ui.list_view(["panelInfo"])[2] if r[2] == "Web password" row = r end end
    check("a panel that drew no web password says Generate, and the row taps", [row[3], row[5]], ["Generate", ["webPassword"]])
    var effects = ui.act(["webPassword"])
    check("the tap: drawn by the brain, and the Info drawn after it", effects, [["webPassword"], ["show"]])
    tasmota = PwTasmota()
    brain3.generate_web_password()
    var pw = persist.store.find("panel_webpw", "")
    check("a password of ten is drawn, kept and set", [size(pw), tasmota.cmds], [10, ["WebPassword2 " + pw]])
    for r: ui.list_view(["panelInfo"])[2] if r[2] == "Web password" row = r end end
    check("and the row shows it, with nothing to tap", [row[3], row[5]], [pw, nil])
    tasmota = PwTasmota()
    brain3.generate_web_password()
    check("a panel that has one keeps it", [persist.store["panel_webpw"], tasmota.cmds], [pw, []])
    # held off and asked: the password goes, and Generate is back
    tasmota = PwTasmota()
    brain3.remove_web_password()
    check("held off: the password goes, kept so, and Tasmota's with it", [persist.store.contains("panel_webpw"), tasmota.cmds], [false, ['WebPassword2 "']])
    for r: ui.list_view(["panelInfo"])[2] if r[2] == "Web password" row = r end end
    check("and the row says Generate again", [row[3], row[5], row[6]], ["Generate", ["webPassword"], nil])
    # a bridge's password is on its page in the house: the Info has no row of it
    check("no bridge's row in the Info", brain3.panel_info()[-1][0], "Web password")
    tasmota = real_tasmota
    persist.store.remove("panel_webpw")
end
generate_password_checks()

# The boot the rescue opens: three presses on the reset button are a
# hand on the panel, and the glass goes in with no pattern until the restart, for
# the pattern that was forgotten and the Info's web password behind it
def rescue_checks()
    class RescueTasmota : TasmotaStub
        var due
        def init(d) self.due = d end
        def cmd(c) return c == "BootRescue" ? {"BootRescue": {"ShortBoots": 0, "Of": 3, "Due": self.due}} : nil end
    end
    var real_tasmota = tasmota
    tasmota = RescueTasmota(1)
    check("the driver's BootRescue says the rescue's boot", Brain.rescue_boot(), true)
    tasmota = RescueTasmota(0)
    check("any other boot is not", Brain.rescue_boot(), false)
    tasmota = real_tasmota
    check("nor one with no rescue to ask", Brain.rescue_boot(), false)
    # the glass of the rescue's boot: no pattern asked, even for what is sensitive, until the restart
    var rui = PanelUi(ui_store, shape, / -> [], nil)
    tasmota = RescueTasmota(1)
    Brain(FakeNx(), FakeLight(), nil, FakePanel(), nil, rui, FakeCommands())
    tasmota = real_tasmota
    rui.prefs["pattern"] = ["s", "s:1235789"]
    check("the rescue's boot frees the glass", rui.rescue, true)
    rui.open_settings()
    check("Main settings opens with no pattern", rui.top()["view"][0], "settings")
    check("and what is sensitive asks for none either", rui.fresh(), true)
    rui.sleep()
    rui.stack = []
    rui.open_settings()
    check("the screensaver does not close it again: the restart does", rui.top()["view"][0], "settings")
    var lui = PanelUi(ui_store, shape, / -> [], nil)
    tasmota = RescueTasmota(0)
    Brain(FakeNx(), FakeLight(), nil, FakePanel(), nil, lui, FakeCommands())
    tasmota = real_tasmota
    lui.prefs["pattern"] = ["s", "s:1235789"]
    lui.open_settings()
    check("any other boot asks for the pattern", lui.top()["view"][0], "lock")
end
rescue_checks()

def wireless_checks()
    var wifi = FakeWifi()
    brain3.wifi = wifi
    ui.wireless = wifi
    ui.stack = []
    ui.unlocked = false
    brain3.handle_panel_event("plan.show", nil, nil, "home")
    nx3.native.clear()
    brain3.handle_panel_event("nav.swipe", "up", nil, "home")
    check("the swipe up on a plan opens Wireless settings", panel3.wrote("$list.title"), "Wireless settings")
    check("on the list's page", nx3.native.find("page settings") != nil, true)
    check("the Wi-Fi first, and what it is doing", [panel3.wrote("$list.rows.0.label"), panel3.wrote("$list.rows.0.hint")], ["Wi-Fi", "Off"])
    # the Wi-Fi, its Connect, and the web setup: the Wi-Fi Manager is asked for
    brain3.handle_panel_event("list.row", "$list.rows.0.label", 0, "settings")
    brain3.handle_panel_event("list.row", "$list.rows.0.label", 0, "settings")
    check("Connect has the web setup, and no search in this firmware", panel3.wrote("$list.rows.0.label"), "Web setup")
    brain3.handle_panel_event("list.row", "$list.rows.0.label", 0, "settings")
    check("its row asks the Wi-Fi for it", wifi.asked, ["web"])
    check("and says where the phone goes", panel3.wrote("$list.title"), "Web setup")
    # a view drawn after the Wi-Fi did what was asked: ["show"]
    ui.stack = [{"view": ["wifi"], "page": 0}]
    brain3.run([["wifi", "off"], ["show"]])
    check("an operation reaches the Wi-Fi", wifi.asked[-1], "off")
    check("and the view on top is drawn after it", [panel3.wrote("$list.title"), panel3.wrote("$list.rows.0.label")], ["Wi-Fi", "Web setup"])
    # the Wi-Fi's own events draw a view of it again (Wifi#Connected)
    wifi.st["web"] = false
    wifi.st["up"] = true
    wifi.st["ssid"] = "Cottage"
    brain3.refresh_wireless()
    check("the Wi-Fi coming up redraws its view", [panel3.wrote("$list.rows.0.label"), panel3.wrote("$list.rows.0.hint")], ["Cottage", "Connected"])
    # the station driver: an effect's values reach the Wi-Fi,
    # and its reports reach the Wi-Fi and the view on show
    brain3.run([["wifi", "join", "Cottage", "secret123", 6, "AA:BB:CC:DD:EE:01"]])
    check("a join reaches the Wi-Fi with its values", [wifi.asked[-1], wifi.args], ["join", ["Cottage", "secret123", 6, "AA:BB:CC:DD:EE:01"]])
    ui.stack = [{"view": ["wifiSearch"], "page": 0}]
    brain3.wifi_answer("scan", "Started")
    check("the command's own answer is not a report", wifi.answers, [])
    brain3.wifi_answer("scan", {"Networks": [["Cottage", -58, 3, 6, "AA:BB:CC:DD:EE:01"]]})
    check("a search's report reaches the Wi-Fi", wifi.answers, ["scan"])
    check("and the networks are drawn", [panel3.wrote("$list.title"), panel3.wrote("$list.rows.0.label"), panel3.wrote("$list.rows.0.hint")],
          ["Networks", "Cottage", "-58 dBm"])
    brain3.wifi_answer("join", {"State": "Failed", "Reason": "WrongPassword"})
    check("a join's report reaches it too", wifi.answers, ["scan", "join"])
    # a view that counts seconds down is drawn again every second, while it does
    var ticks = []
    var tick_tasmota = tasmota
    class TickTasmota : TasmotaStub
        def set_timer(ms, f) ticks.push([ms, f]) end
    end
    tasmota = TickTasmota()
    var clock_now = [100000]
    var real_now = ui.now_fn
    ui.now_fn = / -> clock_now[0]
    wifi.st["join"] = {"ssid": "Cottage", "password": "secret123", "channel": 6, "bssid": "", "state": "joining", "reason": "", "until": 125000}
    ui.stack = [{"view": ["wifiJoin"], "page": 0}]
    brain3.run([["show"]])
    check("a network being joined counts its seconds", [panel3.wrote("$list.rows.0.label"), panel3.wrote("$list.rows.0.hint")], ["Connecting", "25 s"])
    check("and the brain is to draw it again in a second", [size(ticks), ticks[0][0]], [1, 1000])
    clock_now[0] = 101000
    ticks[0][1]()
    check("a second later, one second less, and the next one armed", [panel3.wrote("$list.rows.0.hint"), size(ticks)], ["24 s", 2])
    brain3.run([["show"]])
    check("drawn again meanwhile, still one tick on its way", size(ticks), 2)
    clock_now[0] = 126000
    ticks[1][1]()
    check("the wait over: no tick more", size(ticks), 2)
    ui.now_fn = real_now
    tasmota = tick_tasmota
    wifi.st["join"] = nil
    ui.stack = []
    ui.wireless = nil
    brain3.wifi = nil
    # up is not the carousel's; left and right still are
    plan.calls.clear()
    brain2.handle_panel_event("nav.swipe", "up", nil, "home")
    brain2.handle_panel_event("nav.swipe", "right", nil, "home")
    check("up never turns the plans; right does", plan.calls, ["swipe right"])
end
wireless_checks()

# --- the plan shown, by any way: what the views held goes with them, a password
# typed for a network among it ------------------------
def left_views_checks()
    var wifi = FakeWifi()
    brain3.wifi = wifi
    ui.stack = [{"view": ["wireless"], "page": 0}, {"view": ["wifiSearch"], "page": 0}, {"view": ["wifiJoin"], "page": 0}]
    brain3.handle_panel_event("plan.show", nil, nil, "home")
    check("the plan shown with a join's view left open: what was typed is let go, and the networks found",
          [wifi.asked.find("endJoin") != nil, wifi.asked.find("endSearch") != nil, size(ui.stack)], [true, true, 0])
    brain3.wifi = nil
end
left_views_checks()

# The factory reset: a second later, for the touch's effects to go
# out, the panel out of the house, the brain's persist and the Zigbee devices'
# files erased, and Tasmota's settings with Reset 1, which restarts; no bridge is
# this panel's own to forget
def factory_checks()
    import persist
    import path
    class FactoryTasmota : TasmotaStub
        var cmds, timers
        def init() self.cmds = [] self.timers = [] end
        def cmd(c) self.cmds.push(c) end
        def set_timer(ms, f, id) self.timers.push([ms, f, id]) end
    end
    class FakeZigbeeCtl
        var runs
        def init() self.runs = [] end
        def run(op, args) self.runs.push(op) end
    end
    var real_tasmota = tasmota
    var kept = persist.store
    var ctl_before = brain3.zigbee_ctl
    tasmota = FactoryTasmota()
    var ctl = FakeZigbeeCtl()
    brain3.zigbee_ctl = ctl
    persist.store = {"panel_config": {"version": 7}, "panel_webpw": "abcdefghij", "zb_bridge_peer": {"mac": "AA"}}
    path.present = ["/zbv4"]
    path.removed = []
    brain3.run([["factory"]])
    check("the factory reset asks no bridge anything", ctl.runs, [])
    check("and erases a second later, for the touch's effects to go out", [size(tasmota.timers), tasmota.timers[0][0], tasmota.cmds], [1, Brain.FACTORY_MS, []])
    tasmota.timers[0][1]()
    check("the brain's persist is erased", size(persist.store), 0)
    check("and the Zigbee devices' files", path.removed, ["/zbv4"])
    check("out of the house first, with no house layer by the driver alone, and Tasmota's settings, which restarts", tasmota.cmds, ["EspNowMeshLeave 1", "Reset 1"])
    brain3.zigbee_ctl = ctl_before
    path.present = []
    path.removed = []
    persist.store = kept
    tasmota = real_tasmota
end
factory_checks()

# --- the screensaver's weather, as Home Assistant says it ----------------------
def weather_checks()
    import mqtt
    var subs = []
    for s: mqtt.subs subs.push(s[0]) end
    check("the weather's topic is listened to", subs.find(Brain.WEATHER_TOPIC) != nil, true)
    tasmota.utc_now = 1791000000
    var cells = def ()
        var out = []
        for i: 0 .. 4 out.push([panel3.wrote("$weather." + str(i) + ".label"), panel3.wrote("$weather." + str(i) + ".temp")]) end
        return out
    end
    var none = [["", "--"], ["", "--"], ["", "--"], ["", "--"], ["", "--"]]
    ui.page = "screensaver"
    brain3.weather_said("")
    check("none said: the row says --", cells(), none)
    nx3.native.clear()
    brain3.weather_said('{"at": 1790999000, "cells": [["Now", 18.6], ["Mon", 20.4], ["Tue", -0.3], ["Wed", null], ["Thu", 15], ["Fri", 9]]}')
    check("a forecast, drawn at once on the screensaver: a whole degree, up from .6, never -0, -- for none, five cells",
          cells(), [["Now", "19\xc2\xb0C"], ["Mon", "20\xc2\xb0C"], ["Tue", "0\xc2\xb0C"], ["Wed", "--"], ["Thu", "15\xc2\xb0C"]])
    check("and nothing else: the glass is not woken, nor its page changed", nx3.native, [])
    check("a cold day", Brain.temp_text(-3.6), "-4\xc2\xb0C")
    # on another page nothing is written, and the screensaver draws it when it comes up
    ui.page = "home"
    panel3.writes.clear()
    brain3.weather_said('{"at": 1790999000, "cells": [["Now", 7]]}')
    check("on another page, nothing is written", size(panel3.writes), 0)
    brain3.render_screensaver()
    check("the screensaver draws it", cells(), [["Now", "7\xc2\xb0C"], ["", "--"], ["", "--"], ["", "--"], ["", "--"]])
    # what is no forecast clears the row
    brain3.weather_said('{"cells": [["Now", 7]]}')
    check("one with no time is none", cells(), none)
    brain3.weather_said('{"at": 1790999000, "cells": [["Now", "7"]]}')
    check("a temperature that is not a number says --", cells()[0], ["Now", "--"])
    brain3.weather_said("not json")
    check("nor is what does not read", cells(), none)
    # a forecast that grows old on the screensaver goes to -- at the minute's turn
    brain3.weather_said('{"at": 1790999000, "cells": [["Now", 7]]}')
    class MinuteTasmota : TasmotaStub
        def strftime(fmt, t) return fmt == "%S" ? "00" : fmt end
    end
    var real_tasmota = tasmota
    tasmota = MinuteTasmota()
    tasmota.utc_now = 1790999000 + Brain.WEATHER_MAX_AGE - 60
    brain3.every_second()
    check("under six hours old, still shown at the minute's turn", cells()[0], ["Now", "7\xc2\xb0C"])
    tasmota.utc_now = 1790999000 + Brain.WEATHER_MAX_AGE + 60
    brain3.every_second()
    check("six hours old: --", cells()[0], ["", "--"])
    tasmota = real_tasmota
    tasmota.utc_now = 1790999000 + Brain.WEATHER_MAX_AGE + 60
    brain3.weather_said('{"at": 1790999000, "cells": [["Now", 7]]}')
    check("and one said that old is not shown", cells()[0], ["", "--"])
    tasmota.utc_now = 1000
    brain3.weather_said('{"at": 1790999000, "cells": [["Now", 7]]}')
    check("with the clock never set, its age is not known, and it is shown", cells()[0], ["Now", "7\xc2\xb0C"])
    tasmota.utc_now = nil
end
weather_checks()

# a thermostat's command: to the driver of each device, a mode waiting for the
# driver's word as a lamp's command does, a target and a setting waiting for nothing
def thermostat_checks()
    var nx6 = FakeNx()
    var panel6 = FakePanel()
    panel6.nx = nx6
    panel6.plan_page = "home"
    var plan6 = FakePlan()
    var cmds6 = FakeCommands()
    var brain6 = Brain(nx6, FakeLight(), nil, panel6, plan6, nil, cmds6)
    brain6.run([["thermostat", ["0xA1", "0xA2"], "target", 215]])
    check("a target goes to the driver of each thermostat", cmds6.sent, [["drive", "0xA1", "target", nil, 215], ["drive", "0xA2", "target", nil, 215]])
    check("and waits for no word", plan6.calls, [])
    cmds6.sent.clear()
    brain6.run([["thermostat", ["0xA1"], "mode", "heat"]])
    check("a mode goes out, and the plan waits for the thermostat to say it is on", [cmds6.sent, plan6.calls], [[["drive", "0xA1", "mode", nil, "heat"]], ["expect [\"0xA1\"] on"]])
    cmds6.sent.clear()
    plan6.calls.clear()
    brain6.run([["thermostat", ["0xA1", "0xA2"], "mode", "off"]])
    check("off waits for off", plan6.calls, ["expect [\"0xA1\",\"0xA2\"] off"])
    cmds6.sent.clear()
    plan6.calls.clear()
    brain6.run([["thermostat", ["0xA1"], "setting", 3, "dead"]])
    check("a setting carries its key, and waits for no word", [cmds6.sent, plan6.calls], [[["drive", "0xA1", "setting", "dead", 3]], []])
    cmds6.sent.clear()
    brain6.run([["thermostat", ["0xA1"], "settings", nil]])
    check("the verbs that carry nothing carry nothing", cmds6.sent, [["drive", "0xA1", "settings", nil, nil]])
end
thermostat_checks()

# a blind's command: to the driver of each device, all with the same verb, and a position with its value
def cover_checks()
    var nx7 = FakeNx()
    var panel7 = FakePanel()
    panel7.nx = nx7
    panel7.plan_page = "home"
    var plan7 = FakePlan()
    var cmds7 = FakeCommands()
    var brain7 = Brain(nx7, FakeLight(), nil, panel7, plan7, nil, cmds7)
    brain7.run([["cover", ["0xC1", "0xC2"], "close"]])
    check("a tap's verb goes to the driver of each blind, all of them together", cmds7.sent, [["drive", "0xC1", "close", nil, nil], ["drive", "0xC2", "close", nil, nil]])
    check("and the plan waits for no word: the driver says the motion", plan7.calls, [])
    cmds7.sent.clear()
    brain7.run([["cover", ["0xC1"], "goto", 40]])
    check("a position carries its value", cmds7.sent, [["drive", "0xC1", "goto", nil, 40]])
end
cover_checks()

# a thermostat's page: what the glass reports of it goes to the view, and the target of its + and - goes to the driver a
# moment after the last touch, so a few touches are one write
def thermostat_page_checks()
    class RecordingUi
        var calls, view, stack, alarm
        def init() self.calls = [] self.view = ["thermostat", "d", "0xA1"] self.stack = [1] end
        def shown(page) self.calls.push(["shown", page]) return [] end
        # a page's touches, as PanelUi.page_touch takes them: the + of a thermostat aims its target
        def page_touch(event, subject)
            self.calls.push([event, subject])
            return event == "thermostat.count" ? [["thermostatTarget", ["0xA1"], 220]] : []
        end
        def rename_top() self.calls.push(["rename"]) return [] end
        def top() return {"view": self.view, "page": 0} end
    end
    class AimTasmota : TasmotaStub
        var timers
        def init() self.timers = [] end
        def set_timer(ms, f, id) self.timers.push([ms, f, id]) end
    end
    var nx7 = FakeNx()
    var panel7 = FakePanel()
    panel7.nx = nx7
    panel7.plan_page = "home"
    var cmds7 = FakeCommands()
    # the brain is made without views, as the others of this file are, and the views given after
    var brain7 = Brain(nx7, FakeLight(), nil, panel7, FakePlan(), nil, cmds7)
    var ui7 = RecordingUi()
    brain7.ui = ui7
    var real_tasmota = tasmota
    tasmota = AimTasmota()
    check("the page loading, a touch on its + and one on a mode go to the view", [
          brain7.ui_event("thermostat.show", nil, nil, "thermostat"), brain7.ui_event("thermostat.count", "$thermostat.plus.count", nil, "thermostat"),
          brain7.ui_event("thermostat.row", "$thermostat.modes.1.label", nil, "thermostat")], [true, true, true])
    check("each as the view's own call", ui7.calls, [["shown", "thermostat"], ["thermostat.count", "$thermostat.plus.count"], ["thermostat.row", "$thermostat.modes.1.label"]])
    # the row under a page's title, on the three pages: the same call, which tells an icon or the card from
    # the page's own faces and rows
    ui7.calls.clear()
    check("an icon of the row on a lamp's detail, and the card on a blind's page, go to the view", [brain7.ui_event("light.count", "$light.icons.0.count", nil, "lightdetail"),
          brain7.ui_event("cover.row", "$cover.card.label", nil, "cover")], [true, true])
    check("as the page's own call", ui7.calls, [["light.count", "$light.icons.0.count"], ["cover.row", "$cover.card.label"]])
    check("the + reached the target it asked for, held and not written", [brain7.aimed, cmds7.sent, size(tasmota.timers), tasmota.timers[0][0]], [[["0xA1"], 220], [], 1, Brain.AIM_MS])
    tasmota.timers[0][1]()
    check("a touch with none after it is written when its moment comes", [cmds7.sent, brain7.aimed], [[["drive", "0xA1", "target", nil, 220]], nil])
    # a few touches are one write: the last one's
    cmds7.sent.clear()
    tasmota.timers.clear()
    brain7.run([["thermostatTarget", ["0xA1"], 225]])
    brain7.run([["thermostatTarget", ["0xA1"], 230]])
    tasmota.timers[0][1]()
    check("the moment of a touch that another followed does nothing", cmds7.sent, [])
    tasmota.timers[1][1]()
    check("the last touch's goes, with the last target", cmds7.sent, [["drive", "0xA1", "target", nil, 230]])
    tasmota.timers[1][1]()
    check("once: the same moment again sends nothing", size(cmds7.sent), 1)
    # a joint page's target is every thermostat's of it
    cmds7.sent.clear()
    tasmota.timers.clear()
    brain7.run([["thermostatTarget", ["0xA1", "0xA2"], 240]])
    tasmota.timers[0][1]()
    check("a joint page's target goes to every thermostat of it", cmds7.sent, [["drive", "0xA1", "target", nil, 240], ["drive", "0xA2", "target", nil, 240]])
    # a hold on the title renames, on the thermostat's page and on no other
    ui7.calls.clear()
    check("a hold on the page's title renames, as a lamp's detail does", [brain7.ui_event("text.edit", "$thermostat.name", nil, "thermostat"), ui7.calls], [true, [["rename"]]])
    ui7.view = ["zone", "hall"]
    ui7.calls.clear()
    check("and not when the view on top is another's", [brain7.ui_event("text.edit", "$thermostat.name", nil, "zone"), ui7.calls], [false, []])
    tasmota = real_tasmota
end
thermostat_page_checks()

# The house's calendar on the plan's page: its touches, its swipes and its + go to it, a hold and the title's
# hold to nothing, and the title's tap closes it
def canvas_checks()
    class FakeCanvas
        var calls
        def init() self.calls = [] end
        def title() return "October 2026" end
        def tap(n, style) self.calls.push("tap " + str(n)) return [] end
        def swipe(d) self.calls.push("swipe " + d) return [] end
    end
    class CanvasUi
        var calls, page, prefs, alarm
        def init() self.calls = [] self.prefs = {"screensaver": [60, 300]} end
        def action() self.calls.push("action") return [] end
        def close() self.calls.push("close") return [] end
        def leave_views() self.calls.push("leave") return [] end
        def open_to_phone() return false end
    end
    var c = FakeCanvas()
    var cui = CanvasUi()
    brain2.ui = cui
    plan.calls.clear()
    brain2.run([["calendar", c]])
    check("the calendar's effect puts the canvas on the plan, which draws it when it shows", [plan.canvas == c, plan.calls], [true, []])
    plan.shown = true
    brain2.run([["calendar", c]])
    check("and draws it again on a plan on show", plan.calls, ["redraw"])
    plan.calls.clear()
    brain2.handle_panel_event("plan.show", nil, nil, "home")
    brain2.handle_panel_event("plan.tap", nil, 120272, "home")
    brain2.handle_panel_event("nav.swipe", "left", nil, "home")
    brain2.handle_panel_event("header.action", "$screen.home.title", nil, "home")
    brain2.handle_panel_event("plan.hold", nil, 300140, "home")
    check("its touches and its swipes go to it, its + to the views, and a hold to nothing", [c.calls, cui.calls, plan.calls],
          [["tap 120272", "swipe left"], ["action"], ["show"]])
    check("the plan's title says its month", brain2.text_of(brain2.plan_title_path()), "October 2026")
    var before = size(nx2.native)
    brain2.handle_panel_event("text.edit", "$screen.home.title", nil, "home")
    check("a hold on its title renames nothing", size(nx2.native), before)
    brain2.handle_panel_event("nav.close", nil, nil, "home")
    check("and a tap on it goes back", cui.calls[-1], "close")
    plan.canvas = nil
    plan.shown = nil
    brain2.ui = nil
end
canvas_checks()

# The schedule: its minute each second, its commands run as its own, and anyone else's a touch
def schedule_checks()
    class FakeSchedule
        var out, touches
        def init() self.out = [] self.touches = [] end
        def tick() var o = self.out self.out = [] return o end
        def touched(ids) self.touches.push(ids) end
    end
    var cmds8 = FakeCommands()
    var brain8 = Brain(FakeNx(), FakeLight(), nil, FakePanel(), nil, nil, cmds8)
    var sched = FakeSchedule()
    brain8.schedule = sched
    var plan = {"zids": [7], "unicast": [], "relays": [], "skipped": []}
    sched.out = [["command", plan, "on", ["0xA1"]], ["level", plan, "Dimmer", 149, "now"], ["level", plan, "Hue", 167, "now"],
                 ["thermostat", ["0xB1"], "mode", "heat"]]
    brain8.every_second()
    check("the schedule's commands run, every level at once", cmds8.sent, [["run", plan, "on"], ["level", plan, "Dimmer", 149],
          ["level", plan, "Hue", 167], ["drive", "0xB1", "mode", nil, "heat"]])
    check("and they are not a touch", [sched.touches, brain8.scheduling], [[], false])
    brain8.run([["command", plan, "off", ["0xA1"]], ["thermostat", ["0xB1"], "mode", "off"], ["thermostatTarget", ["0xB1"], 200]])
    check("anyone else's command is", sched.touches, [["0xA1"], ["0xB1"], ["0xB1"]])
    # a group's Identify, from the row of its page: by its group and to the devices outside it
    cmds8.sent.clear()
    var group = {"zids": [7], "unicast": ["0xA2"], "relays": [1], "skipped": []}
    brain8.run([["identifyGroup", group]])
    check("a group's Identify is the commands'", cmds8.sent, [["identifyPlan", group]])
end
schedule_checks()

# The second's steps, each on its own: the schedule first, and one that trips for good stops none of the others, nor
# the commands of its minute that were made before it
def steps_of_the_second_checks()
    class StepSchedule
        var out, steps, fail
        def init(steps) self.out = [] self.steps = steps end
        def tick()
            self.steps.push("schedule")
            if self.fail  raise "boom_error", "a schedule that trips" end
            var o = self.out
            self.out = []
            return o
        end
        def touched(ids) end
    end
    class BoomCommands : FakeCommands
        def run(plan, intent)
            if intent == "boom"  raise "boom_error", "a command that trips" end
            self.sent.push(["run", plan, intent])
        end
    end
    class SteppedBrain : Brain
        var steps, fail
        def idle_tick()
            self.steps.push("idle")
            if self.fail == "idle"  raise "boom_error", "idle" end
        end
        def alarm_tick()
            self.steps.push("alarm")
            if self.fail == "alarm"  raise "boom_error", "alarm" end
        end
        def note_installed()
            self.steps.push("installed")
            if self.fail == "installed"  raise "boom_error", "installed" end
        end
    end
    var cmds9 = BoomCommands()
    var c = SteppedBrain(FakeNx(), FakeLight(), nil, FakePanel(), nil, nil, cmds9)
    c.steps = []
    var sched = StepSchedule(c.steps)
    c.schedule = sched
    tasmota.at_ms = 0
    var raised = nil
    var tick = def ()
        c.steps.clear()
        try
            c.every_second()
        except .. as e, m
            raised = str(e) + ": " + str(m)
        end
    end
    tick()
    check("the schedule's minute is the first step, then the rest", [raised, c.steps], [nil, ["schedule", "idle", "alarm", "installed"]])
    # one that raises, whichever: nothing else is stopped, and nothing raised
    for step: ["schedule", "idle", "alarm", "installed"]
        sched.fail = step == "schedule"
        c.fail = step
        tick()
        check("the " + step + " step trips: the others run, and nothing is raised", [raised, c.steps], [nil, ["schedule", "idle", "alarm", "installed"]])
    end
    sched.fail = false
    c.fail = nil
    # said once a minute at most, with the clock the loop's
    sched.fail = true
    c.step_said = nil
    tasmota.at_ms = 1000
    tick()
    var first = c.step_said["schedule"]
    tasmota.at_ms = 2000
    tick()
    check("the same failure the second after is not said again: its moment is the first's", [first, c.step_said["schedule"]], [61000, 61000])
    tasmota.at_ms = 61000
    tick()
    check("and a minute after it is", c.step_said["schedule"], 121000)
    sched.fail = false
    tasmota.at_ms = nil
    # a command of the minute that trips: the ones after it go (the brain runs each on its own)
    var plan = {"zids": [7], "unicast": [], "relays": [], "skipped": []}
    sched.out = [["command", plan, "on", ["0xA1"]], ["command", plan, "boom", ["0xA2"]], ["command", plan, "off", ["0xA3"]]]
    tick()
    check("a command of the minute that raises: the ones before it and the ones after it are made", [raised, cmds9.sent, c.scheduling],
          [nil, [["run", plan, "on"], ["run", plan, "off"]], false])
end
steps_of_the_second_checks()

# A save of the panel's that fails raises nothing, and what depends on it waits for it
def unsaved_checks()
    import persist
    class PwTasmota : TasmotaStub
        var cmds
        def init() self.cmds = [] end
        def cmd(c) self.cmds.push(c) end
    end
    var real_tasmota = tasmota
    persist.plan = nil
    persist.store.remove("panel_webpw")
    var raised = false
    tasmota = PwTasmota()
    persist.fail_next()
    try
        brain3.generate_web_password()
    except .. as e, m
        raised = true
    end
    check("a web password whose copy cannot be kept: raises nothing, is not set, and the panel has none to show", [raised, tasmota.cmds, persist.store.contains("panel_webpw")], [false, [], false])
    brain3.generate_web_password()
    var pw = persist.store.find("panel_webpw", "")
    check("and Generate again, with a file that works, draws one and sets it", [size(pw), tasmota.cmds], [10, ["WebPassword2 " + pw]])
    tasmota = PwTasmota()
    persist.fail_next()
    brain3.remove_web_password()
    check("one that cannot be removed from the file stays: Tasmota's is not cleared, and the Info shows it", [persist.store.find("panel_webpw"), tasmota.cmds], [pw, []])
    brain3.remove_web_password()
    check("and removed, with a file that works", [persist.store.contains("panel_webpw"), tasmota.cmds], [false, ['WebPassword2 "']])
    # the preferences and the texts: the save is the brain's, and it is not the touch's
    persist.fail_next()
    raised = false
    try
        brain3.save_prefs()
        persist.fail_next()
        brain3.save_texts()
    except .. as e, m
        raised = true
    end
    check("a preferences' and a texts' save that fails raises nothing in the touch", raised, false)
    tasmota = real_tasmota
    persist.plan = nil
    persist.written = nil
end
unsaved_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
