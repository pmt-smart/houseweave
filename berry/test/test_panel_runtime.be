# Exercises a GENERATED project (the `.jsonl` that
# libs/nspanel-sim/export/scripts/build-project-hmi.mjs writes beside each
# scenario, read by berry/panel_runtime.be) on the real Berry interpreter, with
# no Tasmota and no panel.
#
# What it is really checking is the claim the whole generator rests on: that
# the compiled page and this file come out of ONE manifest, so a binding
# reaches the component it was declared on, and a touch that arrives as an
# objname comes back out as the event it means. Nothing here knows any
# geometry -- if it did, that would be the second implementation again.
#
# `send` is captured instead of sent, so what the panel WOULD have been told is
# an assertion rather than a photograph of a screen.

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

var sent = []
var SCENARIOS = TEST_ROOT + "/libs/nspanel-sim/export/hmi-scenarios/"
var panel = PanelRuntime(def (instruction) sent.push(instruction) end, "p1-living-room-eu-landscape", SCENARIOS)

# --- before any page is known, only what every page may address is written ----
# The glass is on a page this side was not told of, and a component local to
# any other page refuses a write.
sent.clear()
check("no page on show: the clock, local to the screensaver, is written nowhere", panel.set("$clock.time", "21:51"), 0)
check("and the live-slider Variable, which every page may address, is", panel.set("$settings.liveSliderUpdate", 1), 1)

# --- a text binding reaches the component it was declared on ----------------
panel.showing("screensaver")
sent.clear()
check("one component takes the clock", panel.set("$clock.time", "21:51"), 1)
check("addressed by page and objname", sent[0], 'screensaver.tTime0.txt="21:51"')

# --- a text is FITTED to its box, by width, with an ellipsis ----------------
# The runtime measures every text it writes with the advances of the slot's own
# font (generated, 224 bytes a font) and cuts at a whole character, where the
# glass would cut mid-letter. The same literals are pinned on the JS side
# (libs/nspanel-sim/export/test/fitText.test.mjs), so the panel and the
# simulator cannot drift apart. The detail's title is 420 px in the 32 px title
# font. The narrow case is the old home card's 98 px in the 24 px body font:
# the Home is a plan and places no card, so the fit is called
# at that width directly, the width the JS side pins.
check("a name longer than the card ends in an ellipsis", panel.fit("Living Room", 98, "body", 19), "Living Roo..")
panel.showing("lightdetail")
sent.clear()
panel.set("$light.name", "Living Room")
check("and is whole where it fits", sent[0], 'lightdetail.tTitle0.txt="Living Room"')
check("a name that fits is not touched", panel.fit("Ceiling", 98, "body", 19), "Ceiling")
check("a long name keeps its start", panel.fit("Living room lamp with a shade", 98, "body", 19), "Living roo..")
sent.clear()
panel.set("$light.name", "Living room lamp with a shade")
check("which the detail shows whole", sent[0], 'lightdetail.tTitle0.txt="Living room lamp with a shade"')
check("two-byte letters are measured as one character", panel.fit("Café terrace", 98, "body", 19), "Café terra..")
check("the keyboard lets the widest place decide", panel.limit("$screen.home.title") > 19, true)

# --- a colour binding resolves a THEME TOKEN, which only this side can do ----
# The panel has no palette: a name means nothing on the glass, so the token has
# to become a number before it crosses the wire. `brain` writes this binding
# as a bare 565 today, and the token path still has to work -- it is the whole
# reason `self.colors` is generated at all. No placement binds a colour by
# token since the Home became a plan, so the rendering is asked directly.
check("a token becomes RGB565", panel.render("home", ["tIcon1", "pco"], "icon-low-sat"), "65222")

# --- a number goes bare, not quoted -----------------------------------------
# The live-slider setting is the glass's own global Variable (first page, read
# by every slider's Touch Move). No row is bound to it: Settings is a
# template, and a row is only a SLOT the runtime fills.
sent.clear()
check("the setting reaches the Variable", panel.set("$settings.liveSliderUpdate", 1), 1)
check("a number is not quoted", sent[0], "screensaver.vaLive.val=1")

# --- a row slot of the Settings template ------------------------------------
# Its colour is one of the THEME's two, picked by a 0/1: both are in the
# manifest, so this side never names a colour the theme did not choose.
# The list pages -- the list, with its rail, the house's and a confirmation's --
# share the slots, and the runtime writes only the page on
# show, whose line holds its own targets: a write to a local component of a
# page not showing is refused.
sent.clear()
check("a slot's label is written on no page but a list's", panel.set("$list.rows.0.label", "Setting A"), 0)
panel.showing("confirm")
check("the confirmation's answers are list slots too", panel.set("$list.rows.0.label", "Setting A"), 1)
panel.showing("settings")
sent.clear()
check("and written on the one on show", panel.set("$list.rows.0.label", "Setting A"), 1)
check("like any text", sent[0], 'settings.tLabel2.txt="Setting A"')
panel.showing("confirm")
sent.clear()
panel.set("$list.rows.0.label", "Setting A")
check("the confirmation's own, when it is the one up", sent[0], 'confirm.tLabel3.txt="Setting A"')
sent.clear()
panel.set("$list.pageCount", 3)
check("and nothing of the rail it has not got", size(sent), 0)
panel.showing("settings")
sent.clear()
panel.set("$list.rows.0.on", 1)
check("on lights the label in the theme's accent", sent[0], "settings.tLabel2.pco=1374")
sent.clear()
panel.set("$list.rows.0.on", 0)
check("off puts it back in the text colour", sent[0], "settings.tLabel2.pco=65535")
sent.clear()
panel.set("$list.rows.1.on", true)
check("a boolean true lights it too", sent[0], "settings.tLabel3.pco=1374")
# The scrollbar is a VERTICAL slider whose Nextion minimum is at the bottom,
# so the first of 3 pages is val 2 on the glass and the last is val 0: the
# manifest marks it `flip`.
sent.clear()
panel.set("$list.page", 0)
check("the first page puts the pointer at the top", sent[0], "settings.hPage0.val=2")
sent.clear()
panel.set("$list.page", 1)
check("a page written to the scrollbar lands the right way round", sent[0], "settings.hPage0.val=1")
sent.clear()
panel.set("$list.page", 2)
check("and the last one at the bottom", sent[0], "settings.hPage0.val=0")
# The list's length is the view's, so the runtime writes the scrollbar's last
# page, hides it on a view of one page, and turns a page by the maximum it
# wrote rather than the compiled one.
sent.clear()
panel.set("$list.pageCount", 5)
check("a longer view sets the scrollbar's last page", sent[0], "settings.hPage0.maxval=4")
check("and shows it", sent[1], "vis hPage0,1")
sent.clear()
panel.set("$list.page", 1)
check("and a page lands by that maximum", sent[0], "settings.hPage0.val=3")
sent.clear()
panel.set("$list.pageCount", 1)
check("a view of one page hides the scrollbar", sent[1], "vis hPage0,0")
check("the list pages three rows at a time on this panel", panel.list_rows, 3)
check("the list is its own page", panel.list_page, "settings")
check("a zone's screen too, with two devices a page", [panel.zone_page, panel.zone_rows, panel.zone_counters], ["zone", 2, 3])
check("and lists the project's thirteen settings, the factory reset last", [size(panel.settings_items()), panel.settings_items()[-1][1]], [13, "factoryReset"])
check("the lock is its own page", panel.lock_page, "lock")
check("each with its key", panel.settings_items()[0][1], "liveSliderUpdate")
# Help's body is paragraphs in the project, broken at THIS layout's 420 px by
# the generator: four lines here, where the portrait panel breaks it sooner
check("and its Help lines, as this panel breaks them", size(panel.settings_items()[0][2]), 4)
check("the first one running on to the width's end", panel.settings_items()[0][2][0], "Changes the light while dragging the slider, not")
check("and a blank line kept as one", panel.settings_items()[0][2][2], "")
check("Help is a page of this project", panel.help_page, "help")
# --- an icon ROLE becomes this theme's glyph, and no codepoint crosses -------
var icon_slot = ["tIcon1", "txt", "glyph"]
check("written as the theme's glyph, quoted", panel.render("home", icon_slot, "lightOn"), panel.quote(panel.glyphs["lightOn"]))
check("the glyph is not the role name", panel.render("home", icon_slot, "lightOn") != '"lightOn"', true)
check("an unknown role writes nothing, not a guess", panel.render("home", icon_slot, "noSuchRole"), '""')

# --- the plan: its page, and what the runtime draws it with ----
# Resolved by the generator from the theme, with the functions the simulator's
# plan layer uses, so both paint the same numbers.
check("the Home is the plan", panel.plan_page, "home")
var ps = panel.plan_style
check("its cards start below the header, at the glass's edge", ps["origin"], [0, 86])
check("in the EU's whole visible width", ps["area"], [450, 234])
check("a lit lamp in the theme's own colour", ps["colors"]["iconOn"], panel.colors["icon-low-sat"])
check("the page colour is the page's", ps["colors"]["page"], panel.colors["background"])
check("a summary card's large icons in the 48 px font", ps["fonts"]["iconLarge"], 4)
check("and its name in the theme's primary text colour", ps["colors"]["label"], panel.colors["text-primary"])
check("fitted with the body font's advances", ps["advances"], panel.advances["body"])
# a kind's glyphs by state, [on, off, noanswer, nopower] (PanelDraw.GLYPH)
check("a plug is the theme's plug glyph", ps["glyphs"]["plug"][0], panel.glyphs["plugOn"])
check("the zone colours start with the theme's card colour", ps["palette"][0], ps["colors"]["card"])
check("and have five hues", size(ps["palette"]), 5)
check("a lit lamp is the theme's glyph for it", ps["glyphs"]["light"][0], panel.glyphs["lightOn"])
check("and a lamp without power its dashed one", ps["glyphs"]["light"][3], panel.glyphs["lightNoPower"])
check("which is not the plain outline", ps["glyphs"]["light"][3] != ps["glyphs"]["light"][1], true)
check("and one that does not answer its own", ps["glyphs"]["light"][2], panel.glyphs["lightNoAnswer"])

# --- a binding nobody placed is a zero, not a silence ------------------------
sent.clear()
check("an unplaced binding writes nothing", panel.set("$nothing.here", "x"), 0)
check("and sends nothing", size(sent), 0)

# --- a confirmation's sentence is broken over its page's lines --------------
# A Text does not wrap, so the runtime does: at a space, each
# line as wide as its own box, and what runs past the last line joined to it
# and cut with "..". Two lines on this panel.
panel.showing("confirm")
sent.clear()
check("a short sentence is written to every line", panel.wrap("$dialog.lines.", "It leaves the network."), 2)
check("the first one has it", sent[0], 'confirm.t1.txt="It leaves the network."')
check("and the other is cleared", sent[1], 'confirm.t2.txt=""')
sent.clear()
panel.wrap("$dialog.lines.", "The marks on 3 zones are cleared, and the button goes back to the panel.")
check("a longer one breaks at a space", sent[0], 'confirm.t1.txt="The marks on 3 zones are cleared, and the"')
check("and goes on in the next line", sent[1], 'confirm.t2.txt="button goes back to the panel."')
sent.clear()
panel.wrap("$dialog.lines.", "Its 12 devices leave the panel, and every mark on its buttons goes with them, which is more than two lines can say on this glass.")
check("what runs past the last line ends it with ..", sent[1], 'confirm.t2.txt="its buttons goes with them, which is more than.."')
panel.showing("settings")
sent.clear()
check("with another page on show, it writes nothing", panel.wrap("$dialog.lines.", "It leaves the network."), 0)

# --- a quote in a value would end the Nextion string early ------------------
panel.showing("screensaver")
sent.clear()
panel.set("$clock.date", 'he said "no"')
check("the quote is dropped, not escaped", sent[0], 'screensaver.tDate0.txt="he said no"')
# a backslash, which the symbols' keyboard types, is the start of an escape there
sent.clear()
panel.set("$clock.date", "a\\b\\")
check("a backslash goes doubled, even the last one", sent[0], 'screensaver.tDate0.txt="a\\\\b\\\\"')

# --- a binding reaches every placement that shows it ------------------------
panel.showing("lightdetail")
sent.clear()
var wrote = panel.set("$light.name", "Ceiling")
check("every placement of one binding is written", wrote, size(sent))

# --- a touch comes back as what it MEANS, and what it was ABOUT -------------
# The plan's cards are drawn, not compiled, so a touch on them is not a
# component's: the page reports the point the finger went down at, x * 1000 + y,
# built on the glass, and the runtime finds the card.
var hit = panel.on_payload("ev,home,plan,tap,120272")
check("a tap on the plan", hit[0], "plan.tap")
check("is about no binding", hit[1], nil)
check("and carries the point", hit[2], 120272)
hit = panel.on_payload("ev,home,plan,hold,300140")
check("a long press on the plan", hit[0], "plan.hold")
check("with its point", hit[2], 300140)
check("the plan says when it shows", panel.on_payload("ev,home,page,show")[0], "plan.show")
hit = panel.on_payload("ev,home,page,left")
check("a swipe left is the carousel's", hit[0], "nav.swipe")
check("and says which way", hit[1], "left")
check("and right the other", panel.on_payload("ev,home,page,right")[1], "right")
check("a tap on the plan with no point is nil", panel.on_payload("ev,home,plan,tap"), nil)
check("the light card the Home used to place is gone", panel.on_payload("ev,home,mCard1,tap"), nil)
# the header's action, and its icon, which the runtime decides
check("the header's + reports its action", panel.on_payload("ev,home,mAction0,tap")[0], "header.action")
check("a tap on the plan's title is its close", panel.on_payload("ev,home,mTitle0,tap")[0], "nav.close")
sent.clear()
check("the action's icon is bound by role, and its slot with it", panel.set("$plan.actionIcon", "confirm"), 3)
check("and written as the theme's glyph", sent[0], 'home.tAction0.txt=' + panel.quote(panel.glyphs["confirm"]))
check("and the slot is there, drawn and touchable", [sent[1], sent[2]], ["vis tAction0,1", "vis mAction0,1"])
sent.clear()
panel.set("$plan.actionIcon", "")
check("no role, no icon", sent[0], 'home.tAction0.txt=""')
# a view with no action has no slot: nothing drawn, nothing to touch
check("and no slot", [sent[1], sent[2]], ["vis tAction0,0", "vis mAction0,0"])

# A row of the Settings template reports WHICH SLOT and the page the scrollbar
# was on -- read on the glass at the moment of the touch -- so this side never
# has to remember a page the glass forgets whenever Settings is left.
hit = panel.on_payload("ev,settings,mRow2,tap,1")
check("a tap on a row slot", hit[0], "list.row")
check("says which slot", hit[1], "$list.rows.0.label")
check("and which page", hit[2], 1)
hit = panel.on_payload("ev,settings,mRow3,hold,0")
check("a long press on a slot is its secondary action", hit[0], "list.hold")
check("on the first page", hit[2], 0)
hit = panel.on_payload("ev,settings,hPage0,change,1")
check("the scrollbar reports the page it was let go on", hit[0], "list.page")
check("as a number", hit[2], 1)
hit = panel.on_payload("ev,zone,mIcon6,tap,2")
check("a device's icon switches it", hit[0], "zone.icon")
check("about the row it is on", hit[1], "$zone.rows.0.label")
check("on the page the scrollbar was on", hit[2], 2)
check("a device's place has no box of its own: it is in its options", panel.on_payload("ev,zone,mTail6,hold,2"), nil)
check("and held opens its detail", panel.on_payload("ev,zone,mIcon6,hold,0")[0], "zone.iconHold")
check("its name is the row's", panel.on_payload("ev,zone,mRow6,tap,0")[0], "zone.row")
check("a counter's hold opens its kind", panel.on_payload("ev,zone,mCount3,hold")[0], "zone.countHold")
check("and its tap toggles it", panel.on_payload("ev,zone,mCount3,tap")[0], "zone.count")
check("the zone's page has no ⋯", panel.on_payload("ev,zone,mMore1,tap"), nil)
check("Settings under its title is the row that opens the options", panel.on_payload("ev,zone,mRow2,tap"), ["zone.row", "$zone.name.label"])
check("its title held renames the zone", panel.on_payload("ev,zone,mTitle1,hold")[1], "$zone.title")
check("the zone's page says when it shows", panel.on_payload("ev,zone,page,show")[0], "zone.show")
hit = panel.on_payload("ev,settings,page,show")
check("the Settings page says when it shows", hit[0], "list.show")

# --- a slider's report carries its VALUE, appended on the glass -------------
# The frame is built by joBr99's recipe in the slider's own event code, so the
# payload ends in a number this side never saw at compile time.
hit = panel.on_payload("ev,lightdetail,h5,change,57")
check("a slider release is the dimension it moves", hit[0], "light.brightness")
check("about the detail page's light", hit[1], "$light.brightnessPct")
check("and carries the value as a number", hit[2], 57)
hit = panel.on_payload("ev,lightdetail,h7,slide,0")
check("a drag report is the same event", hit[0], "light.hue")
check("zero is a value too", hit[2], 0)
check("a value report with no number is nil", panel.on_payload("ev,lightdetail,h5,change,"), nil)
check("and so is one with no value field at all", panel.on_payload("ev,lightdetail,h5,change"), nil)
check("a value report with garbage is nil", panel.on_payload("ev,lightdetail,h5,change,5x"), nil)
check("a tap that happens to end in a number is not a value report", panel.on_payload("ev,help,mTitle0,tap,12"), nil)
# --- EditBoard: a long press offers a name, and OK brings one back ----------
# The typing itself never reaches this side. What does is the two ends of it:
# which slot the finger asked to rename, and what it finally said.
hit = panel.on_payload("ev,home,mTitle0,hold")
check("a long press on the heading asks to edit", hit[0], "text.edit")
check("and says which slot, as the binding it shows", hit[1], "$screen.home.title")

hit = panel.on_payload("ev,editboard,mkOK0,text,Family room")
check("OK carries the typed name", hit[0], "text.commit")
check("and the name is text, not a number", hit[2], "Family room")
hit = panel.on_payload("ev,editboard,mkOK0,text,A")
check("one letter is a name", hit[2], "A")
hit = panel.on_payload("ev,editboard,mkOK0,text,   ")
check("spaces survive the wire; refusing them is brain's job", hit[2], "   ")
check("the X carries nothing", panel.on_payload("ev,editboard,mkX0,tap")[0], "text.cancel")

# --- the capacity of every slot whose text arrives at run time ---------------
# The number is the txt_maxl compiled into that very Text, so the keyboard stops
# the finger exactly where the glass would have truncated in silence.
check("the heading declares its capacity", panel.limit("$screen.home.title") > 0, true)
check("and so does a light's name", panel.limit("$light.name") > 0, true)
check("what the page was compiled showing", panel.initial_text("$screen.home.title"), "Home")
check("and a slot the keyboard never edits has neither", [panel.limit("$nothing.here"), panel.initial_text("$nothing.here")], [nil, nil])

# --- the tables only some pages need are read when one asks, and go with the page ---
def table_checks()
    panel.showing("settings")
    check("a page that asks for none holds none", size(panel.held), 0)
    panel.settings_items()
    check("the Settings list is read when asked", panel.held.contains("settings"), true)
    var items = panel.held["settings"]
    panel.settings_items()
    check("and not read again while its page is up", panel.held["settings"] == items, true)
    panel.showing("editboard")
    check("the next page takes it away", size(panel.held), 0)
    check("a table the project has not got is nil", panel.table("nothing"), nil)
end
table_checks()

# --- and anything else is nil rather than a guess ---------------------------
check("an unknown component", panel.on_payload("ev,home,bNothing,tap"), nil)
check("an unknown gesture", panel.on_payload("ev,home,bCard1,swipe"), nil)
check("a payload that is not ours", panel.on_payload("comok 2,37671-0"), nil)
check("an empty payload", panel.on_payload(""), nil)
check("a frame with no page", panel.on_payload("ev,,mTitle0,tap"), nil)
check("a page the project has not got knows no touch", panel.on_payload("ev,nopage,mTitle0,tap"), nil)
check("and writes nothing of its own", panel.set("$screen.home.title", "Home"), 0)

# --- the heap holds one page's tables, the page on show's --------------------
# Each page's line is read when the page comes up, and replaces the one before:
# however many pages the project has, what is kept of them is one.
def page_checks()
    panel.showing("zone")
    var zone = panel.writes
    check("the zone's line holds the zone's writes", zone.find("$zone.title") != nil, true)
    check("and none of another page's", zone.find("$clock.time"), nil)
    # a binding's writes are its one target, or the list of them
    check("a binding with one target holds the target itself", zone["$zone.title"][0], "tTitle1")
    check("one with more, the list of its targets", isinstance(zone["$zone.pageCount"][0], list), true)
    check("and a target names its component, on its line's page", zone["$zone.pageCount"][0][0], "hPage0")
    panel.showing("zone")
    check("a page that stays up is not read again", panel.writes == zone, true)
    panel.showing("home")
    check("the next page's line replaces it", panel.writes.find("$zone.title"), nil)
    check("with its own", panel.writes.find("$screen.home.title") != nil, true)
end
page_checks()

# --- a file that is not the one generated is refused, whole ----------------
# Its format and project are checked against what this side reads and was told,
# and its index against its lines, at boot: a panel runs no pages of ours rather
# than half of them (autoexec.be then falls back to joBr99's stack).
def file_checks()
    import string
    var fh = open(SCENARIOS + "p1-living-room-eu-landscape.jsonl", "rb")
    var original = fh.read()
    fh.close()
    # what building the runtime over this text raises, or nil when it is taken
    def refused(text, project)
        var out = open(TEST_TMP + "/" + project + ".jsonl", "wb")
        out.write(text)
        out.close()
        try
            PanelRuntime(def (i) end, project, TEST_TMP + "/")
        except .. as e, m
            return str(m)
        end
        return nil
    end
    var eu = "p1-living-room-eu-landscape"
    check("the file as it was generated is taken", refused(original, eu), nil)
    var other = refused(string.replace(original, '"format":3', '"format":4'), eu)
    check("one of another format is refused, by the format it is in", other != nil && string.find(other, "format 4") >= 0, true)
    other = refused(original, "p1-living-room-us-portrait")
    check("one of another project is refused", other != nil && string.find(other, "holds the project " + eu) >= 0, true)
    var nl = string.find(original, "\n")
    other = refused(original[0 .. nl] + " " + original[nl + 1 ..], eu)
    check("one whose lines moved is refused", other != nil && string.find(other, "is not where the index says") >= 0, true)
    other = refused(string.replace(original, "\n", "\r\n"), eu)
    check("and so is one whose ends of line became CRLF", other != nil && string.find(other, "is not where the index says") >= 0, true)
    other = refused(string.replace(original, '"screensaver":0', '"screensaver":1'), eu)
    check("and one whose index points inside a line", other != nil && string.find(other, "the line of screensaver") >= 0, true)
    # a line runs to where the next starts, so the last one has to be ended
    other = refused(original[0 .. size(original) - 2], eu)
    check("a file cut short is refused", other != nil && string.find(other, "does not end its last line") >= 0, true)
    var missing = nil
    try
        PanelRuntime(def (i) end, "p1-no-such-project", TEST_TMP + "/")
    except .. as e, m
        missing = e
    end
    check("a missing file raises", missing, "io_error")
end
file_checks()

# --- a placement of another theme than the project's -----------
# Its targets end with the tag of its theme, and what the runtime writes into
# them -- an icon role, a colour token, a text fitted in a font -- is resolved in
# that theme's entries of the tables, "lightOn@1"; with no tag, in the project's
# own. The Living room mixes no theme, so the tables are given the entries here.
def theme_tag_checks()
    var glyphs = panel.glyphs
    var colors = panel.colors
    var advances = panel.advances
    panel.glyphs = {"lightOn": "A", "lightOn@1": "B"}
    panel.colors = {"icon-off": 100, "icon-off@1": 200}
    var wide = ""
    for i: 0 .. 223 wide += "14" end
    panel.advances = {"body": advances["body"], "body@1": bytes(wide)}
    check("a target's tag", [PanelRuntime.tag(["t", "txt", "glyph", "@1"]), PanelRuntime.tag(["t", "txt", "glyph"]), PanelRuntime.tag(["t", "pco"])], ["@1", "", ""])
    check("an icon role in the project's own theme, and in another's",
          [panel.render("home", ["t", "txt", "glyph"], "lightOn"), panel.render("home", ["t", "txt", "glyph", "@1"], "lightOn")], ['"A"', '"B"'])
    check("a colour token in each", [panel.render("home", ["t", "pco"], "icon-off"), panel.render("home", ["t", "pco", "@1"], "icon-off")], ["100", "200"])
    # 20 px a character in the other theme's body font: 98 px hold two, and the ellipsis
    check("a text fitted in the other theme's font", panel.render("home", ["t", "txt", "fit", 98, "body", 19, "@1"], "Living Room"), '"Li.."')
    panel.glyphs = glyphs
    panel.colors = colors
    panel.advances = advances
end
theme_tag_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
