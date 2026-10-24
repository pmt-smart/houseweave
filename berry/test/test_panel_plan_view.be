# berry/panel_plan_view.be on the real interpreter: the Living room drawn in blocks at
# the serial line's pace, a tap that finds its card and paints it pending, the
# relays, the carousel, and the transport's commands (panel_plan_commands.be). The drawing itself is
# held to the TypeScript by test_panel_draw.be; this is about what goes when.
#
# The timers are the test's: set_timer only records, and fire() runs the next
# one, so the order things reach the glass is an assertion, not a race.

import json
import string

var failures = 0
var checks = 0

def check(name, got, want)
    checks += 1
    if json.dump(got) != json.dump(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + json.dump(got))
        print("  want " + json.dump(want))
    end
end

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

# --- a Tasmota whose timers and relays the test holds ----------------------------
class PlanTasmota : TasmotaStub
    var timers
    var power
    var cmds
    var states    # the two relays, as set_power left them
    var now
    def init() self.timers = [] self.power = [] self.cmds = [] self.states = [false, false] self.now = 0 end
    def cmd(c) self.cmds.push(c) end
    def set_timer(ms, f, id) self.timers.push([ms, f, id]) end
    def set_power(i, on) self.power.push([i + 1, on]) self.states[i] = on end
    def get_power() return self.states.copy() end
    def millis(d) return d != nil ? self.now + d : self.now end
    # runs the oldest timer, and says how long it had waited
    def fire()
        if size(self.timers) == 0 return nil end
        var t = self.timers[0]
        self.timers.remove(0)
        t[1]()
        return t[0]
    end
end
tasmota = PlanTasmota()

var v = json.load(read_text("berry/test/vectors/draw.json"))
var style = v["style"]
var store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
# as autoexec.be does: the Living room, made 8 x 5, takes the EU panel's 11 x 5 as it is
store.fit_matrix(PanelPlanView.matrix_of(style))
var sent = []
var runs = []
var titles = []
var actions = []
var plan = PanelPlanView(store, style, def (t) sent.push(t) end, def (p, intent) runs.push([p, intent]) end,
                         def (t) titles.push(t) end, def (r) actions.push(r) end)

# a point inside a card, as the glass sends it: x * 1000 + y
def at(x, y) return x * 1000 + y end
var MIDDLE = at(300, 140)
var HALL = at(40, 200)

check("the EU card area holds 11 x 5 cells", PanelPlanView.matrix_of(style), [11, 5])
check("the US one 8 x 8, of the same cells", PanelPlanView.matrix_of({"area": [320, 394]}), [8, 8])

# --- show: the whole plan, in blocks, each when the one before has crossed ------
var whole = PanelDraw.chunk_ops(PanelDraw.plan(store, "home", plan.view(), style, true), nil)
plan.on_show()
check("the header says which plan", titles, ["Home"])
check("the first block goes at once", sent, whole[0])
check("and one timer waits for it", size(tasmota.timers), 1)
var nbytes = 0
for t: whole[0] nbytes += size(t) + 3 end
check("as long as its bytes take at 115200, plus the slack", tasmota.timers[0][0], nbytes * 10000 / 115200 + 20)
while tasmota.fire() != nil end
var all = []
for b: whole for t: b all.push(t) end end
check("then the rest, in order, and nothing else", sent, all)
check("the first instruction clears the card area, the glass's whole width", sent[0], "fill 0,86,450,234," + str(style["colors"]["page"]))

# --- the page just loaded (plan.show): its card area is clean and is not cleared
# again, and what was still queued for the page before it is dropped
def fresh_checks()
    sent.clear()
    var first = PanelDraw.chunk_ops(PanelDraw.plan(store, "home", plan.view(), style, true), nil)[0]
    var want = first.copy()
    for b: PanelDraw.chunk_ops(PanelDraw.plan(store, "home", plan.view(), style, false), nil)
        for t: b want.push(t) end
    end
    plan.on_show()
    plan.on_show(true)
    while tasmota.fire() != nil end
    check("the page loaded mid-draw: the block on the wire, then the plan, with no clear", sent, want)
    check("which starts with a card", string.find(sent[size(first)], "fill 0,86,450,234,") != 0, true)
end
fresh_checks()

# what moving the dashed card sends: its old cells back to the page, then it
def ghost_redrawn(was)
    var ops = PanelDraw.ghost_erase(store, was, style)
    for op: PanelDraw.ghost(store, plan.ghost_drawn(), style) ops.push(op) end
    var out = []
    for b: PanelDraw.chunk_ops(ops, nil)
        for t: b out.push(t) end
    end
    return out
end

# --- a tap on the Middle: its plan goes out, and the card turns pending ----------
sent.clear()
check("a tap on the Middle toggles it on", plan.on_tap(MIDDLE), "on")
# the Living room's Middle has its group, with all twelve lamps confirmed in it
check("with the store's plan for it: the zone's group", runs[0][0]["zids"], [3])
check("and no lamp direct", runs[0][0]["unicast"], [])
check("and no relay", runs[0][0]["relays"], [])
var middle = nil
for c: store.doc["screens"][0]["cards"] if c[0] == "z:middle" middle = c end end
var pend_view = {"live": {}, "relayOn": [true, true], "pending": ["z:middle"]}
while tasmota.timers[0][0] != PanelPlanView.PENDING_MS tasmota.fire() end
var painted = []
for b: PanelDraw.chunk_ops(PanelDraw.card_icons(store, middle, pend_view, style), nil) for t: b painted.push(t) end end
check("its icons are redrawn in the pending colour", sent, painted)
check("the pending colour is the style's", string.find(sent[0], "," + str(style["colors"]["pending"]) + ",") > 0, true)

# --- the reports come back, and the card settles --------------------------------
sent.clear()
for i: 1 .. 11
    plan.on_report(string.format("0x00124B0000E%05X", i), "on")
end
check("while one lamp has not answered, the Middle waits", plan.pending_refs(), ["z:middle"])
plan.on_report("0x00124B0000E0000C", "on")
check("the last one settles it", plan.pending_refs(), [])
check("each report redrew the card", size(sent) > 0, true)
while tasmota.fire() != nil end

# --- a pending that nothing answers stops waiting --------------------------------
check("a second tap turns it off", plan.on_tap(MIDDLE), "off")
check("pending again", plan.pending_refs(), ["z:middle"])
var waited = nil
while size(tasmota.timers) > 0
    var w = tasmota.fire()
    if w == PanelPlanView.PENDING_MS waited = w end
end
check("after the pending time", waited, PanelPlanView.PENDING_MS)
check("it is no longer pending", plan.pending_refs(), [])
check("and the lamps still show what they last said", plan.live["0x00124B0000E00001"], "on")

# --- a tap in the pending time turns back what it asked -------
# Ignored until the lamps confirmed or the time was up, a lamp that took the
# first command slow to confirm could not be switched back in the meantime.
do
    var lamps = []
    for i: 1 .. 12 lamps.push(string.format("0x00124B0000E%05X", i)) end
    for id: lamps plan.on_report(id, "on") end
    runs.clear()
    check("a tap on the Middle, its lamps on, turns it off", plan.on_tap(MIDDLE), "off")
    check("a second, while it waits, turns it back on", plan.on_tap(MIDDLE), "on")
    check("both go out", size(runs), 2)
    check("and the lamps wait for the second", plan.unconfirmed[lamps[0]][0], "on")
    check("the card still pending, with it", plan.pending_refs(), ["z:middle"])
    # the first command's time is up first: its lamps wait for another, and none
    # of them loses its communication over the command turned back
    tasmota.fire()
    check("the first one's time finds them waiting for the second", [plan.unconfirmed.contains(lamps[0]), plan.doubt.contains(lamps[0])], [true, false])
    for id: lamps plan.on_report(id, "on") end
    check("their reports settle it", [plan.pending_refs(), size(plan.unconfirmed)], [[], 0])
    while tasmota.fire() != nil end
end

# --- a lamp's own colour, for its icon lit ------
do
    var lamp = "0x00124B0000E00001"
    plan.on_color(lamp, 0xF800)
    check("the colour a lamp says is kept for its icon", plan.view()["colors"][lamp], 0xF800)
    var set = PanelDraw.glyphs_of(style, "light")
    check("and its icon lit shows it", PanelDraw.looks(set, "on", lamp, plan.view(), style, false)[1], 0xF800)
    check("unlit, the theme's", PanelDraw.looks(set, "off", lamp, plan.view(), style, false)[1], style["colors"]["iconOff"])
    plan.on_color(lamp, nil)
    check("a white leaves the icon to the theme's on", [plan.view()["colors"].contains(lamp), PanelDraw.looks(set, "on", lamp, plan.view(), style, false)[1]],
          [false, style["colors"]["iconOn"]])
end

# --- the Hall is relay 1: the relay itself answers --------------------------------
runs.clear()
check("a tap on the Hall toggles its relay off", plan.on_tap(HALL), "off")
check("through the relay", runs[0][0]["relays"], [1])
check("another before the relay says it moved is ignored", [plan.on_tap(HALL), size(runs)], [nil, 1])
plan.on_relay(1, false)
check("the relay moving settles it", plan.pending_refs(), [])
while tasmota.fire() != nil end

# --- relay 2 open: the lamps it feeds have no power, and a tap does nothing -------
sent.clear()
runs.clear()
plan.on_relay(2, false)
check("every card is redrawn when a relay moves", size(sent) > 0, true)
var nopower = style["glyphs"]["light"][PanelDraw.GLYPH["nopower"]]
var joined = ""
for t: sent joined += t end
check("the lamps behind it in the dashed icon", string.find(joined, nopower) >= 0, true)
check("a tap on the Middle without power does nothing", plan.on_tap(MIDDLE), nil)
check("and sends nothing", size(runs), 0)
# the views are told, since no report follows a relay (panel_ui.be, refresh_relay)
var moved = []
plan.relay_moved = / n -> moved.push(n)
plan.on_relay(2, true)
plan.on_relay(2, true)
check("a relay that moved tells the views which, once", moved, [2])
plan.relay_moved = nil
while tasmota.fire() != nil end

# --- relay 2 closing again: each lamp it feeds as its power-on state says -----------
do
    var fed = []
    for d: store.relay_devices(2)
        if !PanelStore.is_relay_id(d[0]) && size(fed) < 4  fed.push(d) end
    end
    var kept = []
    for d: fed  kept.push([d[8], plan.live.find(d[0])]) end
    var startups = [1, 3, 4, 0]
    for i: 0 .. 3
        fed[i][8] = startups[i]
        plan.live[fed[i][0]] = "on"
    end
    plan.on_relay(2, false)
    plan.on_relay(2, true)
    check("closing again: Off is off, On is on, as it was is as it was, and one never written is not known",
          [plan.live.find(fed[0][0]), plan.live.find(fed[1][0]), plan.live.find(fed[2][0]), plan.live.find(fed[3][0])], ["off", "on", "on", nil])
    for i: 0 .. 3
        fed[i][8] = kept[i][0]
        if kept[i][1] != nil  plan.live[fed[i][0]] = kept[i][1] elif plan.live.contains(fed[i][0])  plan.live.remove(fed[i][0]) end
    end
    while tasmota.fire() != nil end
end

# --- nothing under the finger, and a hold -----------------------------------------
check("a tap in the 5 px the matrix leaves is nothing", plan.on_tap(at(2, 90)), nil)
check("a hold says which card, for the zone's screen of phase 3", plan.on_hold(MIDDLE), "z:middle")

# --- hidden: nothing may draw on another page ------------------------------------
sent.clear()
var now = PanelDraw.chunk_ops(PanelDraw.plan(store, "home", plan.view(), style, true), nil)
plan.on_show()
plan.hide()
while tasmota.fire() != nil end
check("a plan hidden mid-draw sends only the block already on the wire", sent, now[0])
sent.clear()
plan.on_report("0x00124B0000E00001", "off")
check("and a report while hidden draws nothing", sent, [])

# --- the carousel ------------------------------------------------------------------
check("one plan: a swipe goes nowhere", plan.on_swipe("left"), false)
store.add_screen("Kitchen")
titles.clear()
plan.on_show()
while tasmota.fire() != nil end
sent.clear()
check("left goes to the next plan", plan.on_swipe("left"), true)
check("which names itself", titles[size(titles) - 1], "Kitchen")
check("and draws an empty one", string.find(sent[1], "Empty") >= 0, true)
plan.on_swipe("left")
check("round again to the Home", titles[size(titles) - 1], "Home")
plan.on_swipe("right")
check("and right goes back", titles[size(titles) - 1], "Kitchen")
check("up and down are no carousel", [plan.on_swipe("up"), plan.on_swipe("down"), titles[size(titles) - 1]], [false, false, "Kitchen"])
while tasmota.fire() != nil end

# --- the dashed card ---------------------------------------------
# the Home is full: all 40 cells of the Living room
plan.on_swipe("left")
while tasmota.fire() != nil end
check("back on the Home", plan.screen, "home")
# the Living room, made 8 x 5, leaves three columns of the EU's 11 free
check("the Home has room for a dashed card, beside the Living room", plan.on_action(), true)
check("at its first free cell", plan.ghost["block"], [8, 0, 1, 1])
# the Kitchen is empty
plan.on_swipe("left")
while tasmota.fire() != nil end
actions.clear()
sent.clear()
check("the + draws a dashed card", plan.on_action(), true)
check("one cell, at the first free one", plan.ghost["block"], [0, 0, 1, 1])
check("named after the next zone", titles[size(titles) - 1], "Card 6")
check("and the header's action turns into the check", actions, ["confirm"])
check("it says its size", plan.ghost_lines(), ["1x1"])
var drew = ""
while tasmota.fire() != nil end
for t: sent drew += t + "|" end
check("it is drawn, with its lines", string.find(drew, "1x1") >= 0, true)
check("a size moves it to where it fits", plan.set_grid("2x3"), nil)
check("two rows by three columns", plan.ghost["block"], [0, 0, 3, 2])
check("which it says", plan.ghost_lines()[0], "2x3")
while tasmota.fire() != nil end
sent.clear()
var was = plan.ghost_drawn()
plan.on_tap(at(40, 100))
check("a tap on it moves it to the next place", plan.ghost["block"], [1, 0, 3, 2])
while tasmota.fire() != nil end
check("and only it is drawn again, over where it was", sent, ghost_redrawn(was))
sent.clear()
was = plan.ghost_drawn()
check("a tap on a free cell around it is its too, and sends nothing", plan.on_tap(at(420, 300)), nil)
check("it goes there, its corner pulled back onto the plan", plan.ghost["block"], [8, 3, 3, 2])
while tasmota.fire() != nil end
check("drawn alone there too", sent, ghost_redrawn(was))
plan.on_tap(at(60, 100))
check("and back, its corner on the cell touched", plan.ghost["block"], [1, 0, 3, 2])
check("a size the plan cannot hold is cut at its edge", plan.set_grid("9x9"), nil)
check("and the card says what it took: nine columns fit, five of the rows", plan.ghost_lines(), ["5x9"])
check("what is not a size is refused", plan.set_grid("abc"), "grid")
check("and so is the old way of writing one", plan.set_grid("23"), "grid")
check("a hold on it asks for its grid", plan.on_hold(at(100, 100)), "ghost")
check("which starts as its size", plan.set_grid("1x2") == nil && plan.ghost_grid() == "1x2", true)
check("the title calls it off", plan.cancel_ghost(), true)
check("gone", plan.ghost, nil)
while tasmota.fire() != nil end
check("and the + is back", actions[size(actions) - 1], "add")
plan.on_action()
plan.set_grid("2x3")
plan.rename_ghost("Bench")
check("the check makes the zone", plan.on_action(), true)
check("and says the card it made, for the brain to open", plan.made, "z:z2")
check("with the card's name", store.doc["zones"][5]["name"], "Bench")
check("its grid", PanelStore.grid_of(store.doc["zones"][5]), [2, 3])
check("on this plan, where the card was", store.find_screen("s1")["cards"], [["z:z2", 0, 0]])
check("no dashed card any more", plan.ghost, nil)
while tasmota.fire() != nil end
var reloaded = PanelStore(nil)
reloaded.load()
check("and it is kept", size(reloaded.doc["zones"]), 6)

# --- Editing off: no + on the plan, and a press of where it was does nothing -------
do
    var roles = []
    var v2 = PanelPlanView(PanelStore(json.load(read_text("berry/test/fixtures/living-room.json"))), style,
                           def (t) end, def (p, intent) end, def (t) end, def (r) roles.push(r) end)
    v2.editing = false
    v2.on_show()
    check("with Editing off the plan's header has no +", roles[-1], "")
    check("and the action does nothing", v2.on_action(), false)
    check("no dashed card", v2.ghost, nil)
    v2.editing = true
    v2.on_show()
    check("with it on, the + is back", roles[-1], "add")
    v2.hide()
    while tasmota.fire() != nil end
end

# --- a command the lamps did not confirm in time: a ping for those, and only those -
do
    var pinged = []
    var v3 = PanelPlanView(PanelStore(json.load(read_text("berry/test/fixtures/living-room.json"))), style,
                           def (t) end, def (p, intent) end, def (t) end, def (r) end)
    v3.ping = / ids -> pinged.push(ids)
    v3.on_tap(MIDDLE)
    v3.on_report("0x00124B0000E00001", "on")
    while tasmota.fire() != nil end
    check("the lamps a tap did not reach are pinged", size(pinged) == 1 ? size(pinged[0]) : -1, 11)
    check("not the one that answered", pinged[0].find("0x00124B0000E00001"), nil)
    tasmota.power.clear()
    v3.on_relay(2, false)
    v3.on_tap(MIDDLE)
    while tasmota.fire() != nil end
    check("and none without power", size(pinged), 1)
end

# --- not confirmed in time: no communication, until something is heard
do
    var pinged = []
    var changed = []
    var runs5 = []
    var v5 = PanelPlanView(PanelStore(json.load(read_text("berry/test/fixtures/living-room.json"))), style,
                           def (t) end, def (p, intent) runs5.push(intent) end, def (t) end, def (r) end)
    v5.ping = / ids -> pinged.push(ids)
    v5.changed = / ids -> changed.push(ids)
    var L1 = "0x00124B0000E00001"
    var L2 = "0x00124B0000E00002"
    var L3 = "0x00124B0000E00003"
    var L4 = "0x00124B0000E00004"
    check("no communication: a tap on the Middle, all off, turns it on", v5.on_tap(MIDDLE), "on")
    check("each of its twelve lamps waits for its report", size(v5.unconfirmed), 12)
    v5.on_report(L1, "on")
    check("one that reports what was asked waits no more", v5.unconfirmed.contains(L1), false)
    v5.on_report(L3, "off")
    check("one that reports another state, as ZbInfo hands over what Z2T kept, still waits", v5.unconfirmed.contains(L3), true)
    while tasmota.fire() != nil end
    check("the eleven that did not have no communication", [v5.doubt.contains(L1), v5.doubt.contains(L2), size(v5.doubt)], [false, true, 11])
    check("they are pinged, and nothing is sent again", [size(pinged), size(runs5)], [1, 1])
    check("the views are told which", size(changed) == 1 ? size(changed[0]) : -1, 11)
    check("a lamp with no communication draws the lamp with ?, the no answer's glyph", PanelDraw.state_of(v5.store, L2, v5.view()), "noanswer")
    v5.on_report(L2, "on")
    check("a report, even late, takes it to what it says", [v5.doubt.contains(L2), PanelDraw.state_of(v5.store, L2, v5.view())], [false, "on"])
    check("an answered ping takes one back to what it last said", v5.on_answered(L3), true)
    check("which is off, what it last said", PanelDraw.state_of(v5.store, L3, v5.view()), "off")
    check("and one with communication is nothing to it", v5.on_answered(L3), false)
    v5.on_report(L3, "noanswer")
    check("Z2T saying it cannot reach one: no communication, what it last said kept",
          [v5.doubt.contains(L3), PanelDraw.state_of(v5.store, L3, v5.view()), v5.live[L3]], [true, "noanswer", "off"])
    check("and a ping answered later shows that again", [v5.on_answered(L3), PanelDraw.state_of(v5.store, L3, v5.view())], [true, "off"])
    # two on, the rest off or with no communication: any on turns them all off
    check("a card with lamps on toggles them off, those with ? with them", v5.on_tap(MIDDLE), "off")
    while tasmota.fire() != nil end
    var zone = v5.store.find_zone("middle")
    for id: v5.store.powered_zigbee([zone], [true, true]) v5.doubt[id] = true end
    runs5.clear()
    check("a card whose lamps all have no communication: a tap tries them, as neither on nor off", v5.on_tap(MIDDLE), "on")
    check("and sends it", runs5, ["on"])
    v5.on_report(L4, "on")
    check("one that was back answers, and loses its ?", [v5.doubt.contains(L4), PanelDraw.state_of(v5.store, L4, v5.view())], [false, "on"])
    # what the gate holds (panel_gate.be) is lifted by the gate, and by nothing the device says: its bridge is not ready to act on it
    v5.doubt[L4] = "gated"
    v5.on_report(L4, "on")
    check("a report does not lift what the gate holds, and the card says no communication", [v5.doubt.find(L4), PanelDraw.state_of(v5.store, L4, v5.view())], ["gated", "noanswer"])
    check("nor does an answered ping", [v5.on_answered(L4), v5.doubt.find(L4)], [false, "gated"])
    v5.on_report(L4, "noanswer")
    check("nor no communication, which the gate already says", v5.doubt.find(L4), "gated")
    v5.doubt.remove(L4)
    while tasmota.fire() != nil end
    v5.on_relay(2, false)
    check("the relay that feeds them opens: none of them keeps its ?", size(v5.doubt), 0)
    v5.on_relay(2, true)
    # a command from a zone's screen (brain.be): its lamps wait, and lose their
    # communication the same way. Back with the power, the Middle's lamps are off (StartUpOnOff).
    changed.clear()
    v5.expect([L1, L2], "on")
    check("a command from the views: its lamps wait, and the views are told", [size(v5.unconfirmed), changed], [2, [[L1, L2]]])
    while tasmota.fire() != nil end
    check("and unconfirmed in time, they have no communication", [v5.doubt.contains(L1), v5.doubt.contains(L2)], [true, true])
end

# --- an unlinked button's tap: its zones as one target, by its group -------------
do
    var runs2 = []
    var v4 = PanelPlanView(PanelStore(json.load(read_text("berry/test/fixtures/living-room.json"))), style,
                           def (t) end, def (p, intent) runs2.push([p, intent]) end, def (t) end, def (r) end)
    var pinged = []
    v4.ping = / ids -> pinged.push(ids)
    check("button 2's tap switches its zones on, as one", v4.on_button(2), "on")
    check("by the button's group alone", runs2[0][0]["zids"], [5])
    check("every card of its zones waits", size(v4.pending), 4)
    # a press while they wait for their lamps turns back what the first asked
    check("a press while they wait turns them back off", [v4.on_button(2), size(runs2)], ["off", 2])
    check("a button no zone is marked with does nothing", v4.on_button(1), nil)
    while tasmota.fire() != nil end
    var zones2 = []
    for z: v4.store.doc["zones"] if z["buttons"].find(2) != nil zones2.push(z) end end
    check("the lamps that did not answer are pinged, the command's all at once",
          [size(pinged), size(pinged[0])], [1, size(v4.store.powered_zigbee(zones2, [true, true]))])
    check("their time up, the button switches them again", v4.on_button(2) != nil, true)
    while tasmota.fire() != nil end
end

# --- a zone of thermostats: the tap on its card, and the button's, turn them off and on (revised) ---
do
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(PanelPlanView.matrix_of(style))
    var hall = st.find_zone("hall")
    # the Hall's relays leave it: it holds the thermostats alone, and button 1 is marked on it
    hall["members"] = {}
    hall["buttons"] = [1]
    var T1 = "0x00124B0000B00001"
    var T2 = "0x00124B0000B00002"
    st.register_device([T1, "Thermostat 1", "thermostat", 48, 50, 350, "", 1, 0, 0])
    st.register_device([T2, "Thermostat 2", "thermostat", 48, 50, 350, "", 1, 0, 0])
    st.add_to_zone("hall", T1)
    st.add_to_zone("hall", T2)
    var runs3 = []
    var pv = PanelPlanView(st, style, def (t) end, def (p, intent) runs3.push([p, intent]) end, def (t) end, def (r) end)
    pv.live[T1] = "on"
    pv.live[T2] = "off"
    check("a tap on the card of a zone with a thermostat on turns it off", pv.on_tap(HALL), "off")
    check("the one that is on is in the command, and the one that is off is not", runs3[0][0]["thermostat"], [T1])
    check("it waits for the off as a lamp does, and the card shows it pending", [pv.unconfirmed.contains(T1), pv.unconfirmed.contains(T2), pv.pending.contains("z:hall")], [true, false, true])
    while tasmota.fire() != nil end
    # all of them off: the tap turns them on, to Heat, as the icon of a row does
    pv.live[T1] = "off"
    pv.unconfirmed = {}
    pv.doubt = {}
    pv.pending = {}
    var runs_before = size(runs3)
    check("with all of them off the tap turns them on", [pv.on_tap(HALL), size(runs3) - runs_before, runs3[-1][0]["thermostat"], runs3[-1][1]], ["on", 1, [T1, T2], "on"])
    check("both wait for it, and the card shows it pending", [pv.unconfirmed.contains(T1), pv.unconfirmed.contains(T2), pv.pending.contains("z:hall")], [true, true, true])
    while tasmota.fire() != nil end
    pv.unconfirmed = {}
    pv.doubt = {}
    pv.pending = {}
    pv.live[T1] = "off"
    # the button marked on the zone: the same rule
    pv.live[T2] = "on"
    check("the button turns the zone's thermostat off", pv.on_button(1), "off")
    check("by the same plan", runs3[-1][0]["thermostat"], [T2])
    while tasmota.fire() != nil end
    pv.live[T2] = "off"
    pv.unconfirmed = {}
    pv.doubt = {}
    pv.pending = {}
    check("and with none on it turns them on", [pv.on_button(1), runs3[-1][0]["thermostat"]], ["on", [T1, T2]])
    while tasmota.fire() != nil end
end

# --- a zone of blinds only: the tap on its card, and the button's, are their cycle ---------------
do
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(PanelPlanView.matrix_of(style))
    var hall = st.find_zone("hall")
    hall["members"] = {}
    hall["buttons"] = [1]
    var C1 = "0x00124B0000C10001"
    var C2 = "0x00124B0000C10002"
    st.register_device([C1, "Cover 1", "cover", 64, 0, 0, "", 1, 0, 0])
    st.register_device([C2, "Cover 2", "cover", 64, 0, 0, "", 1, 0, 0])
    st.add_to_zone("hall", C1)
    st.add_to_zone("hall", C2)
    var runs4 = []
    var cycles = []
    var pv = PanelPlanView(st, style, def (t) end, def (p, intent) runs4.push([p, intent]) end, def (t) end, def (r) end)
    check("with no cover model to run it, a tap on a zone of blinds only does nothing", [pv.on_tap(HALL), size(runs4)], [nil, 0])
    pv.cover_cycle = def (ids) cycles.push(ids) end
    check("with one, the tap is the blinds' cycle, all of them together, and no on or off", [pv.on_tap(HALL), cycles, size(runs4)], ["cycle", [[C1, C2]], 0])
    check("and the button marked on the zone, the same", [pv.on_button(1), size(cycles), size(runs4)], ["cycle", 2, 0])
    var T1 = "0x00124B0000B00001"
    st.register_device([T1, "Thermostat 1", "thermostat", 48, 50, 350, "", 1, 0, 0])
    st.add_to_zone("hall", T1)
    check("a zone with a thermostat too is not of blinds only: the thermostats' rule", [pv.on_tap(HALL), size(cycles), runs4[-1][0]["thermostat"]], ["on", 2, [T1]])
    while tasmota.fire() != nil end
end

# --- where a button's tap goes: the driver's, told by command ----------------------
do
    tasmota.cmds.clear()
    var c = PanelPlanCommands(def (x) end)
    c.button(2, "panel")
    check("the driver takes the buttons, and button 2's tap goes to the panel", tasmota.cmds, ["ButtonDecoupleEnable 1", "ButtonDecouple2 1"])
    tasmota.cmds.clear()
    c.button(1, "relay")
    check("and back to its relay", tasmota.cmds[-1], "ButtonDecouple1 0")
end

# --- the transport: groups, devices and relays ------------------------------------
var zb = []
var cmds = PanelPlanCommands(def (c) zb.push(c) end)
tasmota.power.clear()
cmds.run({"zids": [5, 3], "unicast": ["0x00124B0000E00001"], "relays": [1], "skipped": []}, "on")
check("a group command per group", zb[0], 'ZbSend {"Group":5,"Send":{"Power":1}}')
check("in the plan's order", zb[1], 'ZbSend {"Group":3,"Send":{"Power":1}}')
check("a direct one per device the groups miss", zb[2], 'ZbSend {"Device":"0x00124B0000E00001","Send":{"Power":1}}')
check("and the relay by its number", tasmota.power, [[1, true]])
# each check is its own run: a run that comes less than a gap after the one before is part of its burst, so the clock moves
tasmota.now += 1000
zb.clear()
cmds.run({"zids": [], "unicast": ["0x1"], "relays": [], "skipped": ["0x2"]}, "off")
check("off is zero, and the skipped get nothing", zb, ['ZbSend {"Device":"0x1","Send":{"Power":0}}'])

# a thermostat the plan carries goes to its driver on the bridge, not to Zigbee
tasmota.now += 1000
zb.clear()
cmds.run({"zids": [], "unicast": [], "relays": [], "skipped": [], "thermostat": ["0x00124B0000B00001"]}, "off")
check("a thermostat the plan carries is turned off by its driver", zb, ['ZbRelayDrive {"id":"0x00124B0000B00001","do":"mode","v":"off"}'])
tasmota.now += 1000
zb.clear()
cmds.run({"zids": [], "unicast": [], "relays": [], "skipped": [], "thermostat": ["0x00124B0000B00001", "0x00124B0000B00002"]}, "on")
check("and on is heat, for each", zb, ['ZbRelayDrive {"id":"0x00124B0000B00001","do":"mode","v":"heat"}', 'ZbRelayDrive {"id":"0x00124B0000B00002","do":"mode","v":"heat"}'])
tasmota.now += 1000
zb.clear()
cmds.run({"zids": [], "unicast": [], "relays": [], "skipped": []}, "off")
check("a plan with no thermostat carries none, whoever made it", zb, [])
tasmota.now += 1000
zb.clear()
cmds.drive("0x00124B0000B00001", "target", nil, 215)
cmds.drive("0x00124B0000B00001", "setting", "dead", 3)
cmds.drive("0x00124B0000B00001", "settings", nil, nil)
cmds.drive("0x00124B0000B00001", "setting", "lock", false)
check("a command of the driver's: the device, the verb, a setting's key and the value, each only if it has one", zb,
      ['ZbRelayDrive {"id":"0x00124B0000B00001","do":"target","v":215}',
       'ZbRelayDrive {"id":"0x00124B0000B00001","do":"setting","k":"dead","v":3}',
       'ZbRelayDrive {"id":"0x00124B0000B00001","do":"settings"}'])
check("and the fourth of the burst waits for its turn, a gap after the one before", [size(tasmota.timers), tasmota.timers[0][0]], [1, PanelPlanCommands.GAP_MS])
check("which is its own", [tasmota.fire(), zb[3]], [PanelPlanCommands.GAP_MS, 'ZbRelayDrive {"id":"0x00124B0000B00001","do":"setting","k":"lock","v":false}'])
tasmota.now += 1000
zb.clear()
# a group's Identify, from the row of its page: by its group, and directly to the devices it misses; a
# relay has no Identify
cmds.identify_plan({"zids": [5], "unicast": ["0x00124B0000E00001"], "relays": [1], "skipped": []})
check("a group's Identify: by its group and to each device it misses", zb,
      ['ZbSend {"Group":5,"Send":{"Identify":3}}', 'ZbSend {"Device":"0x00124B0000E00001","Send":{"Identify":3}}'])
zb.clear()

# --- a relay that feeds lamps rests between two changes -------------
do
    tasmota.states = [false, false]
    tasmota.power.clear()
    tasmota.now = 1000
    var guarded = PanelPlanCommands(def (c) end, / n -> n == 2)
    var both = {"zids": [], "unicast": [], "relays": [1, 2], "skipped": []}
    guarded.run(both, "on")
    check("both relays switch the first time", tasmota.power, [[1, true], [2, true]])
    tasmota.now += 350
    guarded.run(both, "off")
    check("350 ms later the one that feeds lamps rests, the other switches", tasmota.power, [[1, true], [2, true], [1, false]])
    tasmota.now += 15000
    guarded.run(both, "off")
    check("and 15 s after its change it switches again", tasmota.power, [[1, true], [2, true], [1, false], [2, false]])
    guarded.run(both, "off")
    check("a relay already where it is asked to be is left alone", size(tasmota.power), 4)
    # changed by the button's hold or the Web UI: the rest counts from there
    guarded.relay_changed(2)
    tasmota.now += 1000
    guarded.run(both, "on")
    check("a change from anywhere else counts too", tasmota.power[-1], [1, true])
    # 25 days after the last change, millis() has wrapped, and it is not a recent one
    tasmota.states = [false, false]
    tasmota.now = guarded.changed_at[2] + 2147483647 + 2000
    guarded.run(both, "on")
    check("a change 25 days old does not make it rest", tasmota.power[-1], [2, true])
    tasmota.states = [false, false]
    tasmota.now = 0
end
zb.clear()
cmds.level({"zids": [3], "unicast": ["0x2"], "relays": [], "skipped": []}, "Dimmer", 195)
check("a level to a group", zb[0], 'ZbSend {"Group":3,"Send":{"Dimmer":195}}')
check("and to a device", zb[1], 'ZbSend {"Device":"0x2","Send":{"Dimmer":195}}')

# --- a burst of lines goes out in its turn --------------------------------------------------
# The link to the bridge takes four frames of a burst and the rest are dropped, and a plan of five lines or more, or a zone of twelve
# lamps that leave, is one: the first three lines of a run go at once, as a tap's always did, and each of the others a gap after the
# one before, in the order they were made, so none is lost. The clock and the timers are the test's.
def burst_checks()
    var out = []
    var p = PanelPlanCommands(def (c) out.push(c) end, nil)
    var lamps = []
    for i: 1 .. 6 lamps.push(string.format("0x00124B0000E%05X", i)) end
    var line = def (id) return 'ZbSend {"Device":"' + id + '","Send":{"Power":1}}' end
    # a plan of eight lines: two groups, and six lamps the groups miss
    tasmota.timers.clear()
    tasmota.now += 1000
    p.run({"zids": [5, 3], "unicast": lamps, "relays": [], "skipped": []}, "on")
    check("the first three lines of a plan go at once, the groups first", out, ['ZbSend {"Group":5,"Send":{"Power":1}}', 'ZbSend {"Group":3,"Send":{"Power":1}}', line(lamps[0])])
    check("the five others wait, with one timer a gap away", [size(p.outbox), size(tasmota.timers), tasmota.timers[0][0]], [5, 1, PanelPlanCommands.GAP_MS])
    var gaps = []
    for i: 1 .. 5
        gaps.push(tasmota.fire())
        check("a line a turn, " + str(i), size(out), 3 + i)
    end
    check("each a gap after the one before", gaps, [80, 80, 80, 80, 80])
    check("the last one's turn arms nothing", [size(tasmota.timers), size(p.outbox)], [0, 0])
    check("and they went in the order they were made", out[3 ..], [line(lamps[1]), line(lamps[2]), line(lamps[3]), line(lamps[4]), line(lamps[5])])

    # a run that comes a gap after the end of the one before is a run of its own: its first lines go at once
    out.clear()
    tasmota.now += PanelPlanCommands.GAP_MS
    p.run({"zids": [], "unicast": [lamps[0], lamps[1], lamps[2]], "relays": [], "skipped": []}, "off")
    check("three lines go at once, as a plan of three always did", size(out), 3)
    check("and nothing waits", [size(p.outbox), size(tasmota.timers)], [0, 0])
    # one that comes before the gap is over is the same burst, and waits behind it
    tasmota.now += 30
    p.run({"zids": [], "unicast": [lamps[3]], "relays": [], "skipped": []}, "off")
    check("a line 30 ms after a burst waits the rest of the gap", [size(out), size(p.outbox), tasmota.timers[0][0]], [3, 1, 50])
    tasmota.fire()
    check("and goes", out[-1], 'ZbSend {"Device":"' + lamps[3] + '","Send":{"Power":0}}')

    # the Middle's twelve lamps leave: twenty-four lines, ZbLeave and ZbForget each, all of them delivered, in order
    out.clear()
    tasmota.timers.clear()
    tasmota.now += 1000
    var twelve = []
    for i: 1 .. 12 twelve.push(string.format("0x00124B0000E%05X", i)) end
    for id: twelve p.leave(id) end
    var first = size(out)
    check("twelve lamps leaving: the first three lines at once", first, 3)
    while size(tasmota.timers) > 0 tasmota.fire() end
    var want = []
    for id: twelve want.push("ZbLeave " + id) want.push("ZbForget " + id) end
    check("and the twenty-four of them reach the bridge, in the order of the lamps", out, want)
    # what a Remove of one device sends goes at once
    out.clear()
    tasmota.now += 1000
    p.leave(twelve[0])
    check("a Remove of one device is two lines, and goes at once", out, ["ZbLeave " + twelve[0], "ZbForget " + twelve[0]])

    # a word to the alarm does not wait behind a burst
    out.clear()
    tasmota.timers.clear()
    tasmota.now += 1000
    p.run({"zids": [], "unicast": lamps, "relays": [], "skipped": []}, "on")
    check("a plan of six lines, three at once", size(out), 3)
    p.alarm({"do": "panic"})
    check("a word to the alarm in the middle of it goes at once, and is not held with the others", out[-1], 'ZbRelayAlarm {"do":"panic"}')
    while size(tasmota.timers) > 0 tasmota.fire() end
    check("and the plan's other three still go, after it", [size(out), out[-1]], [3 + 1 + 3, line(lamps[5])])

    # no room to hold more: the lines go as they would have, and none is lost
    out.clear()
    tasmota.timers.clear()
    tasmota.now += 1000
    var many = []
    for i: 1 .. 200 many.push(string.format("0x00124B00EE%06X", i)) end
    p.run({"zids": [], "unicast": many, "relays": [], "skipped": []}, "on")
    check("a plan of two hundred lines holds what it can: the rest of them go at once", [size(p.outbox), size(out)], [PanelPlanCommands.OUTBOX_MAX, 200 - PanelPlanCommands.OUTBOX_MAX])
    while size(tasmota.timers) > 0 tasmota.fire() end
    check("and in the end every one has gone", size(out), 200)
end
burst_checks()
tasmota.timers.clear()
tasmota.now = 0

# --- the colour picker a zone's options opened -------------------
var picker_view = PanelPlanView(store, style, def (t) sent.push(t) end, def (p, intent) runs.push([p, intent]) end,
                                def (t) titles.push(t) end, def (r) actions.push(r) end)
sent.clear()
titles.clear()
actions.clear()
picker_view.picker = {"zone": "middle", "chosen": 4}
picker_view.on_show()
check("the picker's title", titles, ["Color"])
check("and no action in the header", actions, [""])
check("drawn where the cards go, as the TypeScript draws it", sent, PanelDraw.chunk_ops(v["picker"]["ops"], nil)[0])
check("a dot is a colour: the middle row's middle one", picker_view.picker_at(at(225, 200)), 7)
check("and outside the dots, nothing", picker_view.picker_at(at(10, 50)), nil)
var queued = size(picker_view.queue)
picker_view.redraw_icons()
check("no card is drawn over the picker", [size(picker_view.queue), picker_view.cards_shown()], [queued, false])
picker_view.hide()
check("another page drops the picker", picker_view.picker, nil)

# --- another view drawn where the cards go: the house's calendar ---
class FakeCanvas
    def title() return "October 2026" end
    def action() return "add" end
    def ops(st) return [["fill", 0, 86, 10, 10, 1]] end
end
var canvas_view = PanelPlanView(store, style, def (t) sent.push(t) end, def (p, intent) runs.push([p, intent]) end,
                                def (t) titles.push(t) end, def (r) actions.push(r) end)
sent.clear()
titles.clear()
actions.clear()
canvas_view.canvas = FakeCanvas()
canvas_view.on_show()
check("a canvas says its title and its action, and draws what it says", [titles, actions, sent], [["October 2026"], ["add"], ["fill 0,86,10,10,1"]])
queued = size(canvas_view.queue)
canvas_view.redraw_icons()
check("and no card is drawn over it", [size(canvas_view.queue), canvas_view.cards_shown()], [queued, false])
canvas_view.hide()
check("another page drops it", canvas_view.canvas, nil)

# --- a card around another: the grid keeps its place, less what is taken
var shaped_store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
shaped_store.fit_matrix(PanelPlanView.matrix_of(style))
var sid = shaped_store.add_screen("Shapes")["value"]
shaped_store.create_zone(sid, "One", [1, 1], [1, 1])
var shaped = PanelPlanView(shaped_store, style, def (t) sent.push(t) end, def (p, intent) runs.push([p, intent]) end,
                           def (t) titles.push(t) end, def (r) actions.push(r) end)
shaped.show_screen(sid)
shaped.on_action()
check("the dashed card starts at the first free cell", shaped.ghost["block"], [0, 0, 1, 1])
check("a 3x3 keeps its place", shaped.set_grid("3x3"), nil)
check("around the card in its way", shaped.ghost["block"], [0, 0, 3, 3])
check("which is its hole", shaped.ghost_holes(), [[1, 1]])
check("a tap on the hole is the other card's, and moves nothing", shaped.move_ghost([1, 1]), false)
shaped.on_tap(at(5 + 6 * 40 + 20, 88 + 20))
check("a tap on a free cell takes it there", shaped.ghost["block"], [6, 0, 3, 3])
check("where nothing is in its way", shaped.ghost_holes(), [])
shaped.on_tap(at(5 + 20, 88 + 20))
check("and back around the other card", shaped.ghost["block"], [0, 0, 3, 3])
check("the check makes the zone", shaped.confirm_ghost(), true)
var made = shaped_store.doc["zones"][size(shaped_store.doc["zones"]) - 1]
check("with the cell the other card holds as its hole", made["holes"], [202])
check("and eight places", PanelStore.capacity(made), 8)
check("the plan is still valid", shaped_store.validate(), [])

# --- a thermostat's temperatures on its summed-up card ---------------------------------------
# told by PanelThermostat, and drawn again only when what the card says changes: the whole degrees, and not a tenth of one
def temps_checks()
    while tasmota.fire() != nil end
    var TH = "0x00124B0000B00001"
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(PanelPlanView.matrix_of(style))
    var zid = st.create_zone("home", "Bedroom", [8, 0], [3, 3])["value"]
    st.register_device([TH, "Thermostat", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    st.add_to_zone(zid, TH)
    st.set_display(zid, "adaptive")
    var out = []
    var pv = PanelPlanView(st, style, def (t) out.push(t) end, def (p, i) end, nil, nil)
    var card = nil
    for c: st.doc["screens"][0]["cards"] if c[0] == "z:" + zid card = c end end
    # the card as drawn with the numbers, flat as they cross
    var drawn = def (pair)
        var view = pv.view()
        view["temps"] = pair != nil ? {TH: pair} : {}
        var flat = []
        for b: PanelDraw.chunk_ops(PanelDraw.card_icons(st, card, view, style), nil) for t: b flat.push(t) end end
        return flat
    end
    var sent_now = def ()
        while tasmota.fire() != nil end
        var got = out.copy()
        out.clear()
        return got
    end

    pv.shown = true
    pv.on_temps(TH, [21, 27])
    check("the first word of its temperatures draws its card again, with them", sent_now(), drawn([21, 27]))
    check("the plan keeps them for what it draws next", pv.view()["temps"], {TH: [21, 27]})
    pv.on_temps(TH, [21, 27])
    check("the same whole degrees again draw nothing", sent_now(), [])
    pv.on_temps(TH, [21, 28])
    check("a floor that changed draws the card with the new one", sent_now(), drawn([21, 28]))
    pv.on_temps(TH, [22, 28])
    check("and so does a room", sent_now(), drawn([22, 28]))
    pv.on_temps(TH, [22, nil])
    check("a probe that is gone leaves the room's alone", sent_now(), drawn([22, nil]))
    pv.on_temps(TH, nil)
    check("a thermostat with none draws the card without the line", sent_now(), drawn(nil))
    check("and the plan does not keep them", pv.view()["temps"], {})
    pv.on_temps(TH, nil)
    check("none again draws nothing", sent_now(), [])

    # a card that is not on show is not drawn, and the plan has them when it is
    pv.shown = false
    pv.on_temps(TH, [20, 25])
    check("with another page on the glass nothing is drawn, and the temperatures are kept", [sent_now(), pv.view()["temps"]], [[], {TH: [20, 25]}])
    pv.shown = true
    pv.on_show()
    var shown = sent_now()
    var room = false
    var floor = false
    for t: shown
        if string.find(t, ",\"20°\"") >= 0 room = true end
        if string.find(t, ",\"25°\"") >= 0 floor = true end
    end
    check("the plan shown after that draws them with the cards: the room's and the floor's", [room, floor], [true, true])

    # a device in no zone, or nobody's, is a word with nowhere to go
    pv.on_temps("0x00124B00FFFFFFFF", [1, 2])
    check("a thermostat in no zone draws nothing", sent_now(), [])
end
temps_checks()

# --- a thermostat that heats, in the warm tone: its zone's card is drawn again when it begins to heat and when it stops ---
def heating_checks()
    while tasmota.fire() != nil end
    var TH = "0x00124B0000B00001"
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(PanelPlanView.matrix_of(style))
    var zid = st.create_zone("home", "Bedroom", [8, 0], [3, 3])["value"]
    st.register_device([TH, "Thermostat", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    st.add_to_zone(zid, TH)
    st.set_display(zid, "adaptive")
    var out = []
    var pv = PanelPlanView(st, style, def (t) out.push(t) end, def (p, i) end, nil, nil)
    var card = nil
    for c: st.doc["screens"][0]["cards"] if c[0] == "z:" + zid card = c end end
    var drawn = def (heating)
        var view = pv.view()
        view["heating"] = heating ? {TH: true} : {}
        var flat = []
        for b: PanelDraw.chunk_ops(PanelDraw.card_icons(st, card, view, style), nil) for t: b flat.push(t) end end
        return flat
    end
    var sent_now = def ()
        while tasmota.fire() != nil end
        var got = out.copy()
        out.clear()
        return got
    end
    pv.shown = true
    pv.on_report(TH, "on")
    sent_now()
    pv.on_heating(TH, true)
    check("a thermostat that begins to heat: its card is drawn again, with the icon warm", sent_now(), drawn(true))
    check("and the plan keeps it", pv.view()["heating"], {TH: true})
    check("the card with it warm is not the card with it lit", drawn(true) != drawn(false), true)
    pv.on_heating(TH, true)
    check("the same word again draws nothing", sent_now(), [])
    pv.on_heating(TH, false)
    check("one that stops: the card is drawn again, with the icon lit", sent_now(), drawn(false))
    check("and the plan does not keep it", pv.view()["heating"], {})
    pv.on_heating(TH, false)
    check("not heating again draws nothing", sent_now(), [])

    # another page on the glass: nothing is drawn, and the plan has it when it is shown
    pv.shown = false
    pv.on_heating(TH, true)
    check("with another page on the glass nothing is drawn, and what was said is kept", [sent_now(), pv.view()["heating"]], [[], {TH: true}])
    pv.shown = true
    pv.on_show()
    var warm = false
    for t: sent_now()
        if string.find(t, "," + str(style["colors"]["heating"]) + ",") > 0 warm = true end
    end
    check("the plan shown after that draws the card with the warm icon", warm, true)
    pv.on_heating("0x00124B00FFFFFFFF", true)
    check("a thermostat in no zone draws nothing", sent_now(), [])
end
heating_checks()

# --- a zone's twelve lamps answering one tap are two redraws of its card, and not twelve ---------------------------
# The first report of a moment draws the card at once; the others, in the REDRAW_MS after it, wait and make one, when it ends, of what
# the card is by then. A report that says nothing new still counts: the same state again takes the "?" and the pending tone away
# (on_report settles at once), so none is let go, only the drawing is held. And with the wire behind, nothing is added to it.
def redraw_checks()
    while tasmota.fire() != nil end
    tasmota.timers.clear()
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(PanelPlanView.matrix_of(style))
    var out = []
    var pv = PanelPlanView(st, style, def (t) out.push(t) end, def (p, i) end, nil, nil)
    pv.shown = true
    var lamps = []
    for i: 1 .. 12 lamps.push(string.format("0x00124B0000E%05X", i)) end
    var card = nil
    for c: st.doc["screens"][0]["cards"] if c[0] == "z:middle" card = c end end
    # the instructions of one redraw of the Middle's card, as it is now
    var one = def ()
        var flat = []
        for b: PanelDraw.chunk_ops(PanelDraw.card_icons(st, card, pv.view(), style), nil) for t: b flat.push(t) end end
        return flat
    end
    var flush = def ()
        while tasmota.fire() != nil end
        var got = out.copy()
        out.clear()
        return got
    end
    # a tap on the card turned its lamps on, and every one of them waits for its report (the tap's own timer, which gives up on them, is
    # not what this is about)
    for id: lamps pv.unconfirmed[id] = ["on", 1] end
    pv.pending["z:middle"] = ["on", 1]
    check("each of its twelve lamps waits for its report, and the card shows it", [size(pv.unconfirmed), pv.pending_refs()], [12, ["z:middle"]])
    pv.on_report(lamps[0], "on")
    var first = size(out)
    check("the first report of a moment draws the card at once", first > 0, true)
    for i: 1 .. 11 pv.on_report(lamps[i], "on") end
    check("and the eleven after it, in the same moment, draw nothing yet", size(out), first)
    check("they settle the card all the same, and are one card waiting", [pv.pending_refs(), pv.dirty, pv.dirty_armed], [[], {"z:middle": true}, true])
    var got = flush()
    var final = one()
    check("when the moment ends the card is drawn again, once, as it is by then: two redraws for the twelve reports", size(got), 2 * size(final))
    check("and that one is the card with every lamp on", got[size(got) - size(final) ..], final)
    check("nothing waits, and the moment is over", [pv.dirty, pv.dirty_armed, size(tasmota.timers)], [{}, false, 0])
    # a report that changes nothing is still drawn, in its moment: it took the "?" away
    pv.doubt[lamps[3]] = true
    pv.on_report(lamps[3], "on")
    check("a report that says what the lamp said already takes its \"?\" away, and draws", [pv.doubt.contains(lamps[3]), size(flush()) > 0], [false, true])

    # the wire is behind: more than REDRAW_QUEUE blocks waiting, and the card waits for it, not added to it
    for i: 1 .. PanelPlanView.REDRAW_QUEUE + 2 pv.queue.push(["fill 0,0,1,1,0"]) end
    pv.on_report(lamps[0], "off")
    check("with the wire behind, a report draws nothing, and the card waits", [size(out), pv.dirty], [0, {"z:middle": true}])
    pv.queue = []
    pv.busy = false
    var later = flush()
    check("and when the wire is clear it is drawn, with what it is by then", [size(later) == size(one()), later[size(later) - size(one()) ..]], [true, one()])

    # another page on the glass: what waited is let go
    pv.on_report(lamps[0], "on")
    pv.on_report(lamps[1], "off")
    var waiting = size(pv.dirty)
    check("two reports in a moment: the first is drawn, the second waits, and both are drawn by the end of it", [waiting, size(flush()) > 0, size(pv.dirty)], [1, true, 0])
    pv.on_report(lamps[0], "off")
    out.clear()
    pv.on_report(lamps[1], "on")
    check("a report in a moment that is on its way waits", size(pv.dirty), 1)
    pv.hide()
    check("another page on the glass drops what waited, and draws nothing", [size(pv.dirty), size(flush())], [0, 0])
end
redraw_checks()
tasmota.timers.clear()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
