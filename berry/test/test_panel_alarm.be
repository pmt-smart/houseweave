# berry/panel_alarm.be, panel_alarm_draw.be, panel_alarm_canvas.be and panel_alarm_view.be: the alarm as the
# panel keeps it from what the bridge says (state, events, acknowledgements, the log, the settings), the notice and its
# screens, the beeps by the panel's Alarm sounds, the panic touch, and the screens' words, touches and rows. The glass, the
# buzzer and the bridge are the bench's.

import json

var failures = 0
var checks = 0
# a value as text with the keys of its maps in order, for a map keeps its keys in no order worth comparing
def canon(x)
    if isinstance(x, map)
        var ks = []
        for k: x.keys()
            var i = size(ks)
            while i > 0 && str(ks[i - 1]) > str(k)  i -= 1 end
            ks.insert(i, k)
        end
        var parts = []
        for k: ks  parts.push(json.dump(str(k)) + ":" + canon(x[k])) end
        return "{" + parts.concat(",") + "}"
    end
    if isinstance(x, list)
        var parts = []
        for e: x  parts.push(canon(e)) end
        return "[" + parts.concat(",") + "]"
    end
    return json.dump(x)
end
def check(name, got, want)
    checks += 1
    if canon(got) != canon(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + canon(got))
        print("  want " + canon(want))
    end
end

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

var DOOR = "0x00124B0000AA0001"
var HUM = "0x00124B0000AA0004"
var LAMP2 = "0x00124B0000AA000A"
var T = 1790000000      # 14:13 UTC

var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard",
                       "keypad": "keypad", "lock": "lock"}, "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5}

class FakeZb
    var store, ui, sent
    def init(store, ui) self.store = store self.ui = ui self.sent = [] end
    def emit(effects) for e: effects self.sent.push(e) end end
end

def wipe(m)
    for k: m.keys()  m.remove(k) end
end
def empty(l)
    while size(l) > 0  l.pop() end
end

var store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
store.register_device([DOOR, "Front door", "sensor", 0, 0, 0, "TS0203", 1, 0, 0])
store.register_device([HUM, "Bath humidity", "sensor", 0, 0, 0, "TS0201", 1, 0, 0])
store.register_device([LAMP2, "Siren plug", "plug", 1, 0, 0, "TS011F", 1, 0, 0])
var zid = store.doc["zones"][0]["id"]
store.add_to_zone(zid, DOOR)
var ui = PanelUi(store, shape, / -> [], nil)
var zb = FakeZb(store, ui)
var al = PanelAlarm(zb)
var view = PanelAlarmView(al, ui)
ui.alarm = view
ui.providers.push(view)
var beeps = []
al.cmd_fn = def (c) beeps.push(c) end
tasmota.utc_now = T
tasmota.at_ms = 100000

# a style of the plan's page, by hand: the origin, the area, the colours the screens use, and a body font 12 px wide
var adv = bytes()
for i: 0 .. 223  adv.add(12, 1) end
var style = {"origin": [20, 60], "area": [440, 230], "fonts": {"body": 1}, "advances": adv,
             "colors": {"page": 0, "label": 65535, "secondary": 33808, "pending": 1279, "card": 8452}}

def event(i, y, who, g, v, snd)
    return [i, T, y, who, g, v, snd ? 1 : 0]
end
# the texts an instruction list writes
def texts(ops)
    var out = []
    for op: ops if op[0] == "xstr" out.push(op[11]) end end
    return out
end

# --- the state and the events the bridge says --------------------------------------------------------------
def state_checks()
    var fx = al.on_message({"st": "armed_away", "md": "away", "v": 3})
    check("a state said is kept, with its mode and version", [al.st, al.mode, al.ver, al.cause], ["armed_away", "away", 3, nil])
    check("and the screens are told", fx, [["alarmShow"]])
    check("its words", [al.state_word(), PanelAlarm.STATE_WORDS["pending"]], ["Armed away", "Disarm now"])
    al.on_message({"st": "pending", "md": "away", "v": 4, "c": [DOOR, "open"]})
    check("the entry time names its cause, with the device's name", [al.cause_text(), al.state_word()], ["Front door opened", "Disarm now"])
    al.on_message({"st": "disarmed", "v": 5})
    check("a disarmed state has no mode and no cause", [al.mode, al.cause], [nil, nil])
    check("what is not a map says nothing", al.on_message("x"), [])
end
state_checks()

def event_checks()
    var fx = al.on_message({"ev": event(1, "open", DOOR, "house", nil, false)})
    check("a house event is kept, and is a warning, with no notice", [size(al.events), al.notice, al.warnings(), fx], [1, nil, 1, [["alarmShow"]]])
    check("its line: the hour, the device's name and what it did", al.line_of(al.events[0]), "14:13 Front door opened")
    al.on_message({"ev": event(1, "open", DOOR, "house", nil, false)})
    check("the same event again is not another", size(al.events), 1)
    fx = al.on_message({"ev": event(2, "trigger", DOOR, "alarm", "open", true)})
    check("an event of the alarm's grade takes the glass", [al.notice["kind"], al.notice["e"][0], fx[0]], ["event", 2, ["alarmNotice"]])
    check("the trigger's line", al.line_of(al.events[1]), "14:13 TRIGGERED: open Front door")
    check("a panic by a device", al.line_of(event(3, "panic", DOOR, "house", nil, false)), "14:13 PANIC Front door")
    check("an arm by the panel", al.line_of(event(3, "arm", "panel", "house", "away", false)), "14:13 Armed away by panel")
    check("a disarm by Home Assistant", al.line_of(event(3, "disarm", "ha", "house", nil, false)), "14:13 Disarmed by ha")
    check("a numeric crossing says its value", al.line_of(event(3, "above", HUM, "local", 71, false)), "14:13 Bath humidity high 71")
    check("a siren the bridge cannot reach", al.line_of(event(3, "unreach", LAMP2, "alert", nil, false)), "14:13 Siren plug unreachable")
    check("a change of the alarm's settings, with what", al.line_of(event(3, "config", "panel", "house", "siren", false)), "14:13 Settings changed: siren")
    check("and who, when it was not the panel", al.line_of(event(3, "config", "ha", "house", "times", false)), "14:13 Settings changed: times by ha")
    check("a time with no clock is dashes", PanelAlarm.hhmm(0), "--:--")
    check("the room of a device is its zone's", al.room_of(DOOR), store.zone_of(DOOR)["name"])
    # an alert's notice is left by a touch, which marks nothing seen on the bridge
    var out = al.dismiss()
    check("a touch leaves the notice", [al.notice, out], [nil, [["alarmDismiss"]]])
    check("and the event is still not seen", al.seen.contains(2), false)
    fx = al.on_message({"ev": event(4, "water", HUM, "alert", nil, false)})
    var back = al.on_message({"ack": 4})
    check("an acknowledgement takes the notice off the glass, and says so", [al.notice, back[0]], [nil, ["alarmDismiss"]])
    check("and marks it seen", al.seen.contains(4), true)
    al.on_message({"ack": "all"})
    check("all of them", al.warnings(), 0)
    # a local notice that went by itself
    al.on_message({"ev": event(5, "above", HUM, "local", 71, false)})
    check("a local event is a warning", al.warnings(), 1)
    al.on_message({"clr": HUM})
    check("and one that cleared is seen", al.warnings(), 0)
    # 45 events: the oldest go
    for i: 10 .. 54  al.on_message({"ev": event(i, "open", DOOR, "house", nil, false)}) end
    check("the events kept are the last 40", [size(al.events), al.events[0][0], al.events[-1][0]], [40, 15, 54])
    check("the unseen are a list of the grades asked", size(al.unseen(["house"])) > 0 && size(al.unseen(["alarm"])) == 0, true)
end
event_checks()

def log_config_checks()
    var a = PanelAlarm(zb)
    a.on_message({"ev": event(20, "open", DOOR, "house", nil, false)})
    a.on_message({"log": [event(18, "arm", "panel", "house", "away", false), event(19, "open", DOOR, "house", nil, false), event(20, "open", DOOR, "house", nil, false)], "at": 0, "of": 3})
    check("the log fills what is missing, in order, and no event twice", [size(a.events), a.events[0][0], a.events[1][0], a.events[2][0]], [3, 18, 19, 20])
    a.on_message({"cfg": {"t": [30, 30, 300], "p": [1, 0, 0], "b": [8, 3], "s": [LAMP2]}})
    a.on_message({"sc": [DOOR, "perimeter", 1, "house", 1, "", "", 0, 4]})
    a.on_message({"np": [HUM]})
    a.on_message({"pd": [[LAMP2, "on"]]})
    check("the settings the bridge says are kept", [a.cfg["t"], a.cfg["p"], a.cfg["b"], a.cfg["s"], a.cfg["np"], a.cfg["pd"]],
          [[30, 30, 300], [1, 0, 0], [8, 3], [LAMP2], [HUM], [[LAMP2, "on"]]])
    check("a sensor's record, without its address", a.cfg["sensors"][DOOR], ["perimeter", 1, "house", 1, "", "", 0, 4])
    check("a record that is short is let go", a.cfg["sensors"][DOOR][0], "perimeter")
    a.on_message({"sc": [DOOR]})
    check("and changes nothing", a.cfg["sensors"][DOOR][0], "perimeter")
    # a list of more than a frame holds is said in messages: the first is the list, each other says where it stands
    a.on_message({"pd": [[LAMP2, "on"], [LAMP2 + "1", "off"]]})
    check("a message with no place is the whole list, and replaces it", a.cfg["pd"], [[LAMP2, "on"], [LAMP2 + "1", "off"]])
    a.on_message({"pd": [[LAMP2 + "2", "open"], [LAMP2 + "3", "close"]], "at": 2})
    a.on_message({"pd": [[LAMP2 + "4", "on"]], "at": 4})
    check("the ones after it go after what is there", a.cfg["pd"], [[LAMP2, "on"], [LAMP2 + "1", "off"], [LAMP2 + "2", "open"], [LAMP2 + "3", "close"], [LAMP2 + "4", "on"]])
    a.on_message({"pd": [[LAMP2 + "9", "on"]], "at": 7})
    check("one that does not follow, one before it lost, is let go: the list is the head of the bridge's, with no hole", size(a.cfg["pd"]), 5)
    a.on_message({"pd": [[LAMP2 + "5", "off"]], "at": 3})
    check("one that comes again, from its place, takes the place of what was there", [size(a.cfg["pd"]), a.cfg["pd"][3]], [4, [LAMP2 + "5", "off"]])
    a.on_message({"pd": [], "at": 0})
    check("and a list that says it has nothing empties it", a.cfg["pd"], [])
    a.on_message({"np": [HUM, LAMP2]})
    a.on_message({"np": [DOOR], "at": 2})
    a.on_message({"cfg": {"s": [LAMP2]}})
    a.on_message({"sr": [HUM, DOOR], "at": 1})
    check("the same for the devices out of the burst", a.cfg["np"], [HUM, LAMP2, DOOR])
    check("and for the sirens, whose first are in the cfg message and the rest are sr", a.cfg["s"], [LAMP2, HUM, DOOR])
    a.on_message({"np": "no", "pd": 7, "sr": nil})
    check("a list that is not one changes nothing", [a.cfg["np"], a.cfg["pd"]], [[HUM, LAMP2, DOOR], []])
end
log_config_checks()

# --- what a person did, and the link ------------------------------------------------------------------------
def action_checks()
    check("arm", al.arm("home"), [["alarm", {"do": "arm", "mode": "home", "by": "panel"}]])
    check("disarm", al.disarm(), [["alarm", {"do": "disarm", "by": "panel"}]])
    al.on_message({"ev": event(60, "open", DOOR, "house", nil, false)})
    var fx = al.ack(60)
    check("an acknowledgement is taken at once and sent", [al.seen.contains(60), fx[-1]], [true, ["alarm", {"do": "ack", "id": 60}]])
    check("all of them", al.ack(nil)[-1], ["alarm", {"do": "ack"}])
    tasmota.timers = []
    al.link_up()
    var delays = []
    for t: tasmota.timers delays.push(t[0]) end
    check("the link coming up asks the state, the log and the settings, a moment apart", delays, [1200, 1600, 2000])
    tasmota.timers[1][1]()
    check("and the second is the log's, which the alarm sends as an effect", zb.sent[-1], ["alarm", {"do": "log", "n": 20}])
end
action_checks()

# --- the beeps, by this panel's Alarm sounds ---------------------------------------------------------------------
def sound_checks()
    var a = PanelAlarm(zb)
    a.cmd_fn = def (c) beeps.push(c) end
    empty(beeps)
    ui.prefs["alarmSounds"] = "off"
    a.on_message({"st": "triggered", "v": 1})
    a.on_message({"ev": event(70, "open", DOOR, "house", nil, true)})
    check("with Alarm sounds off a panel does not beep", beeps, [])
    ui.prefs["alarmSounds"] = "always"
    a.on_message({"ev": event(71, "open", DOOR, "house", nil, true)})
    check("a sensor that asks beeps once, on a panel that accepts", beeps, ["Buzzer 1,1,1"])
    a.on_message({"ev": event(72, "open", DOOR, "house", nil, false)})
    check("one that does not ask, does not", size(beeps), 1)
    empty(beeps)
    a.on_message({"st": "disarmed", "v": 2})
    a.on_message({"st": "triggered", "v": 3})
    check("a trigger beeps on and on", [beeps, a.buzzing], [["Buzzer -1,2,2"], true])
    a.on_message({"st": "armed_away", "md": "away", "v": 4})
    check("until the state leaves the trigger", [beeps[-1], a.buzzing], ["Buzzer 0", false])
    ui.prefs["alarmSounds"] = "home"
    empty(beeps)
    a.on_message({"st": "armed_away", "md": "away", "v": 5})
    a.tick()
    check("Home beeps only with the house armed home", beeps, [])
    a.on_message({"st": "armed_home", "md": "home", "v": 6})
    a.on_message({"ev": event(73, "open", DOOR, "alert", nil, true)})
    check("an alert asked for beeps three at a time", beeps, ["Buzzer 3,1,1"])
    ui.prefs["alarmSounds"] = "always"
    var b = PanelAlarm(zb)
    b.cmd_fn = def (c) beeps.push(c) end
    empty(beeps)
    b.on_message({"st": "arming", "md": "away", "v": 1})
    b.tick()
    check("the exit time beeps, then waits", beeps, ["Buzzer 1,1,1"])
    b.tick()
    check("two seconds between", size(beeps), 1)
    tasmota.at_ms += 2100
    b.tick()
    check("and beeps again", size(beeps), 2)
    b.on_message({"st": "pending", "md": "away", "v": 2})
    empty(beeps)
    b.tick()
    tasmota.at_ms += 1100
    b.tick()
    check("the entry time beeps every second", size(beeps), 2)
end
sound_checks()

# --- the panic touch ---------------------------------------------------------------------------------------------
def touch_checks()
    var a = PanelAlarm(zb)
    tasmota.at_ms = 500000
    var fx = []
    for i: 1 .. 7
        tasmota.at_ms += 200
        fx = a.touch("home")
    end
    check("seven touches are not the panic", fx, [])
    tasmota.at_ms += 200
    fx = a.touch("home")
    check("the eighth within 3 s is: the word to the bridge, and the glass's own screen", fx, [["alarm", {"do": "panic", "by": "panel"}], ["alarmNotice"]])
    check("the screen is the brief one, with no event of its own", [a.notice["kind"], a.notice["e"]], ["brief", nil])
    check("a touch with the notice up counts for nothing", a.touch("home"), [])
    # the bridge says the panic it was told: that is no second screen
    var out = a.on_message({"ev": event(80, "panic", "panel", "house", nil, false)})
    check("the bridge's word of this glass's own panic is not another notice", [a.notice["kind"], out], ["brief", [["alarmShow"]]])
    a.notice = nil
    var b = PanelAlarm(zb)
    tasmota.at_ms += 5000
    for i: 1 .. 12
        tasmota.at_ms += 50
        fx = b.touch("home")
    end
    check("touches closer than 80 ms count as one", fx, [])
    var c = PanelAlarm(zb)
    for i: 1 .. 20
        tasmota.at_ms += 100
        fx = c.touch("editboard")
    end
    check("the keyboard's touches do not count", fx, [])
    for i: 1 .. 20
        tasmota.at_ms += 100
        fx = c.touch("lock")
    end
    check("nor the lock's", fx, [])
    var d = PanelAlarm(zb)
    for i: 1 .. 16
        tasmota.at_ms += 500
        fx = d.touch("home")
    end
    check("eight in 8 s are not a frenzy", fx, [])
    # the pages of + and -: eight taps 400 ms apart on a thermostat's + were the panic
    shape["pages"]["thermostat"] = "thermo"
    shape["pages"]["cover"] = "blind"
    var panics = 0
    for p: ["thermo", "blind", "lightdetail"]
        var g = PanelAlarm(zb)
        for i: 1 .. 24
            tasmota.at_ms += 400
            if size(g.touch(p)) > 0  panics += 1 end
        end
    end
    check("taps on the thermostat's, the blind's and the lamp's pages are not the panic, 24 at 400 ms", panics, 0)
    var h = PanelAlarm(zb)
    for i: 1 .. 24
        tasmota.at_ms += 400
        if size(h.touch("home")) > 0  panics += 1 end
    end
    check("and on the plan's page it still is, once: the notice then counts the touches for nothing", panics, 1)
    shape["pages"].remove("thermostat")
    shape["pages"].remove("cover")
    # a panic given by a device shows its brief screen on the panels of its bridge
    var e = PanelAlarm(zb)
    out = e.on_message({"ev": event(90, "panic", DOOR, "house", nil, false)})
    check("a device's panic: the brief screen, with the device's name", [e.notice["kind"], e.notice["e"][3], out[0]], ["brief", DOOR, ["alarmNotice"]])
    check("it goes by itself", [e.tick(), e.notice != nil], [[], true])
    tasmota.at_ms += 5100
    check("after its five seconds", [e.tick(), e.notice], [[["alarmDismiss"]], nil])
end
touch_checks()

# --- the screens ---------------------------------------------------------------------------------------------------
def screen_checks()
    var a = al
    a.on_message({"st": "disarmed", "v": 100})
    a.on_message({"ack": "all"})
    var rows = view.screen_rows()
    check("two rows at the end of Screens, Alarm with its state", [rows[0][2], rows[0][3], rows[1][2]], ["Alarm", "Disarmed", "Notifications"])
    check("their taps", [rows[0][5], rows[1][5]], [["alarm", "open", "alarm"], ["alarm", "open", "notifs"]])
    var d = view.state_data()
    check("disarmed, the Alarm screen offers to arm away and home", d["buttons"], [["Arm away", "arm"], ["Arm home", "arm"]])
    # an alarm that would trigger in silence says so over the Arm buttons, and does not stop the arming
    var sirens = a.cfg.find("s")
    d = view.state_data()
    check("the siren list not known yet: nothing is said", d["cause"], "")
    a.cfg["s"] = []
    ui.prefs["alarmSounds"] = "off"
    d = view.state_data()
    check("no siren and this panel's beeps off: the alarm would trigger in silence, and the screen says it", [d["cause"], d["buttons"]], ["No siren, sounds off", [["Arm away", "arm"], ["Arm home", "arm"]]])
    ui.prefs["alarmSounds"] = "always"
    check("no siren, the beeps on: no siren is said", view.state_data()["cause"], "No siren set")
    a.on_message({"ev": event(7, "open", DOOR, "house", nil, false)})
    check("with a warning, both", view.state_data()["cause"], "1 warning, No siren set")
    a.on_message({"ack": "all"})
    a.cfg["s"] = [LAMP2]
    ui.prefs["alarmSounds"] = "off"
    check("with a siren on the list the alarm sounds, whatever this panel's beeps are", view.state_data()["cause"], "")
    if sirens == nil  a.cfg.remove("s") else a.cfg["s"] = sirens end
    ui.prefs["alarmSounds"] = "off"
    a.on_message({"st": "armed_away", "md": "away", "v": 101})
    ui.prefs["pattern"] = []
    d = view.state_data()
    check("armed with no pattern, it cannot disarm, and says why", [d["buttons"], d["cause"]], [[["Disarm", "off"]], "Draw a pattern in Settings to disarm"])
    ui.prefs["pattern"] = ["salt", "hash"]
    d = view.state_data()
    check("with a pattern it can", [d["buttons"], d["cause"]], [[["Disarm", "disarm"]], "Armed away"])
    a.on_message({"st": "triggered", "md": "away", "v": 102, "c": [DOOR, "open"]})
    d = view.state_data()
    check("triggered, the cause is on the band", [d["word"], d["cause"]], ["TRIGGERED", "Front door opened"])
    var ops = view.ops_of("alarm", style)
    check("the Alarm screen is drawn: a band, the state, the cause, the button and the events", [ops[0][0], texts(ops)[0], texts(ops)[1]], ["fill", "TRIGGERED", "Front door opened"])
    check("its events are the alarm's own, newest first", texts(ops)[texts(ops).find("Events") + 2] != nil, true)
    check("the screens have their titles", [view.title_of("alarm"), view.title_of("notifs")], ["Alarm", "Notifications"])
    # touches on the Alarm screen
    a.on_message({"st": "disarmed", "v": 103})
    var R = PanelAlarmDraw.rows(style)
    var box = PanelAlarmDraw.button_box(style, 0, 2)
    var fx = view.tap_of("alarm", (box[0] + 10) * 1000 + R[2] + 10, style)
    check("a touch on Arm away arms away", fx[0], ["alarm", {"do": "arm", "mode": "away", "by": "panel"}])
    box = PanelAlarmDraw.button_box(style, 1, 2)
    fx = view.tap_of("alarm", (box[0] + 10) * 1000 + R[2] + 10, style)
    check("on Arm home, home", fx[0], ["alarm", {"do": "arm", "mode": "home", "by": "panel"}])
    fx = view.tap_of("alarm", 430 * 1000 + R[3] + 5, style)
    check("on Settings, the settings, and the bridge asked for them", [ui.top()["view"], fx[-1]], [["alarmSettings"], ["alarm", {"do": "config"}]])
    ui.stack = []
    a.on_message({"st": "armed_away", "md": "away", "v": 104})
    box = PanelAlarmDraw.button_box(style, 0, 1)
    fx = view.tap_of("alarm", (box[0] + 10) * 1000 + R[2] + 10, style)
    check("Disarm asks for the pattern first", ui.top()["view"], ["lock", "enter", ["alarm", "doDisarm"]])
    ui.stack = []
    fx = ui.act(["alarm", "doDisarm"])
    check("and the pattern drawn carries the disarm out", fx[0], ["alarm", {"do": "disarm", "by": "panel"}])
    ui.prefs["pattern"] = []
    check("with no pattern a Disarm does nothing", ui.act(["alarm", "disarm"]), [])
    ui.prefs["pattern"] = ["salt", "hash"]
    ui.stack = []
end
screen_checks()

# the Alarm screen's cog: a row of its own under the title, the band whole under it, and the word Settings gone
def cog_checks()
    var cogged = {}
    for k: style.keys() cogged[k] = style[k] end
    cogged["icons"] = {"settings": "S"}
    cogged["fonts"] = {"body": 1, "icon": 2}
    cogged["radius"] = 6
    cogged["area"] = [440, 394]
    al.on_message({"st": "disarmed", "v": 105})
    var R0 = PanelAlarmDraw.rows(style)
    var R = PanelAlarmDraw.rows(cogged)
    check("the band goes under the cog's row, 48 px lower, and keeps its height", [R[0] - R0[0], R[2] - R[0]], [48, R0[2] - R0[0]])
    var ops = view.ops_of("alarm", cogged)
    var cog = nil
    for op: ops if op[0] == "xstr" && op[11] == "S" cog = op end end
    check("the cog is drawn in the row, in the icon font, a face of 56 x 44 at the left", [cog != nil ? [cog[1], cog[2], cog[3], cog[4], cog[5]] : nil],
          [[20, 62, 56, 44, 2]])
    check("and the word Settings is gone from the line of the events", [texts(ops).find("Events") != nil, texts(ops).find("Settings")], [true, nil])
    var fx = view.tap_of("alarm", 40 * 1000 + 80, cogged)
    check("a touch on the cog opens the settings", [ui.top()["view"], fx[-1]], [["alarmSettings"], ["alarm", {"do": "config"}]])
    ui.stack = []
    check("the line of the events is no longer a way to them", view.tap_of("alarm", 430 * 1000 + R[3] + 5, cogged), [])
    check("nor the row beside the cog", view.tap_of("alarm", 200 * 1000 + 80, cogged), [])
    # a glass with no room for an event under the cog (the EU's 234 px): no Events line at all
    cogged["area"] = [440, 226]
    ops = view.ops_of("alarm", cogged)
    check("where no event fits, no Events line is drawn", [PanelAlarmDraw.rows(cogged)[5], texts(ops).find("Events"), texts(ops).find("No events")], [0, nil, nil])
end
cog_checks()

def list_checks()
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    a.on_message({"ev": event(1, "open", DOOR, "house", nil, false)})
    a.on_message({"ev": event(2, "above", HUM, "local", 71, false)})
    a.on_message({"ev": [3, 1, "water", HUM, "alert", nil, 0]})
    a.on_message({"ev": event(4, "arm", "panel", "house", "away", false)})
    var r = v.list_rows()
    check("Now: what is not seen, newest first, and not the alarm's own arming", [size(r), r[0][3], r[1][3]], [3, 3, 2])
    v.tab = 1
    check("Today leaves what is older than a day, but keeps the one with no clock's", size(v.list_rows()) >= 2, true)
    v.tab = 2
    a.on_message({"ack": "all"})
    check("All keeps what was seen", size(v.list_rows()), 3)
    v.tab = 0
    check("Now has nothing after an acknowledgement", v.list_rows(), [])
    var ops = v.ops_of("notifs", style)
    check("the screen says so", texts(ops).find("Nothing to see") != nil, true)
    a.on_message({"ev": event(5, "motion", DOOR, "house", nil, false)})
    var R = PanelAlarmDraw.list_rows(style)
    var fx = v.tap_of("notifs", 100 * 1000 + R[1] + 5, style)
    check("a touch on a row opens it, and acknowledges it", [ui.top()["view"], fx[-1], a.seen.contains(5)], [["alarmEvent", 5], ["alarm", {"do": "ack", "id": 5}], true])
    ui.back()
    fx = v.tap_of("notifs", 400 * 1000 + R[0] + 5, style)
    check("a touch on a tab changes it, and the screen is drawn again", [v.tab, fx[0][0]], [2, "calendar"])
    check("a swipe goes to the next tab and the one before", [v.swipe_of("notifs", "left"), v.tab, v.swipe_of("notifs", "right") != nil, v.tab], [v.swipe_of("notifs", "left"), 0, true, 2])
    check("and not on the Alarm screen", v.swipe_of("alarm", "left"), [])
end
list_checks()

# A notification touched opens on a page of its own, whole, with Delete; Delete all asks, then takes the tab's; the bridge's word of a
# deletion takes them from a panel that did not ask; and the foot of the list
def notif_checks()
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    var kept = [ui.providers, ui.alarm, ui.stack]
    ui.providers = [v]
    ui.alarm = v
    ui.stack = []
    def words(fx)
        var out = []
        for e: fx if e[0] == "alarm" out.push(e[1]) end end
        return out
    end
    def labels(lv)
        var out = []
        for r: lv[2]  out.push(r[2]) end
        return out
    end
    a.on_message({"ev": event(11, "open", DOOR, "house", nil, false)})
    a.on_message({"ev": event(12, "water", HUM, "alert", nil, false)})
    a.on_message({"ev": event(13, "above", HUM, "local", 71, false)})
    var R = PanelAlarmDraw.list_rows(style)
    var fx = v.tap_of("notifs", 100 * 1000 + R[1] + 5, style)
    check("a touch on a notification opens its page, and it is seen", [ui.top()["view"], a.seen.contains(13), words(fx)], [["alarmEvent", 13], true, [{"do": "ack", "id": 13}]])
    var lv = ui.list_view(ui.top()["view"])
    check("its words whole, and when; then Delete and Back", [lv[0], labels(lv)],
          ["Notification", ["Bath humidity high 71. Today at " + PanelAlarm.hhmm(T) + ".", "Delete", "Back"]])
    check("a device in a zone says where it is", a.full_of(a.event_of(11)), "Front door opened. " + store.doc["zones"][0]["name"] + ". Today at " + PanelAlarm.hhmm(T) + ".")
    check("and an older one, the day", [PanelAlarm.day_of(T - 86400), PanelAlarm.day_of(T - 3 * 86400), PanelAlarm.day_of(0)],
          ["Yesterday at " + PanelAlarm.hhmm(T - 86400), "3 days ago at " + PanelAlarm.hhmm(T), "At a time not known"])
    tasmota.at_ms += 1000
    fx = ui.list_row(1, 0, false)
    check("Delete takes it here and on the bridge, and goes back to the list", [a.event_of(13), words(fx), ui.top()], [nil, [{"do": "del", "ids": [13]}], nil])
    check("a page of one that is gone says so", labels(v.view(["alarmEvent", 13], true)), ["It was deleted.", "Back"])
    # Delete all, on All: the question, with how many, and then the tab's whole
    v.tab = 2
    var foot = PanelAlarmDraw.foot(style, false, true)
    check("on Today and All the foot is Delete all alone", [size(foot), foot[0][0], foot[0][4]], [1, "Delete all", "del"])
    fx = v.tap_of("notifs", 100 * 1000 + foot[0][2] + 5, style)
    lv = ui.list_view(ui.top()["view"])
    check("Delete all asks first, with how many", [ui.top()["view"], lv[0], labels(lv)[1 ..]], [["alarmClear", 2], "Delete 2 notifications?", ["Delete", "Cancel"]])
    check("the notice of one of them is on the glass", a.notice != nil, true)
    tasmota.at_ms += 1000
    fx = ui.list_row(1, 0, false)
    check("and takes them: here, on the bridge, and the notice off the glass", [size(a.events), words(fx), fx.find(["alarmDismiss"]) != nil, a.notice, ui.top()],
          [0, [{"do": "del", "ids": [12, 11]}], true, nil, nil])
    # the bridge says one was deleted on another panel
    a.on_message({"ev": event(14, "motion", DOOR, "house", nil, false)})
    a.on_message({"ev": event(15, "open", DOOR, "house", nil, false)})
    a.on_message({"del": [14]})
    check("the bridge's word takes it out here too", [a.event_of(14), a.event_of(15) != nil], [nil, true])
    # a word of the house kept here is only this panel's; and many go in words of DEL_CHUNK
    a.house_word("left", "Living room", 2)
    check("a house's word deleted goes to no bridge", words(a.drop([a.events[-1][0], 15])), [{"do": "del", "ids": [15]}])
    var many = []
    for i: 1 .. PanelAlarm.DEL_CHUNK + 1  many.push(100 + i) end
    fx = words(a.drop(many))
    check("many go in words of DEL_CHUNK", [size(fx), size(fx[0]["ids"]), fx[1]["ids"]], [2, PanelAlarm.DEL_CHUNK, [100 + PanelAlarm.DEL_CHUNK + 1]])
    # the foot on Now: Acknowledge all and Delete all side by side when they fit, one over the other on a narrow glass
    foot = PanelAlarmDraw.foot(style, true, true)
    check("side by side when they fit", [size(foot), foot[0][2] == foot[1][2], PanelAlarmDraw.room(style, foot)], [2, true, R[2] - 1])
    check("a touch left of Delete all acknowledges, on it deletes",
          [PanelAlarmDraw.list_hit(style, foot[0][1] + 5, foot[0][2] + 5, foot), PanelAlarmDraw.list_hit(style, foot[1][1] + 5, foot[1][2] + 5, foot)], [["ack"], ["del"]])
    var narrow = {}
    for k: style.keys()  narrow[k] = style[k] end
    narrow["area"] = [280, 230]
    foot = PanelAlarmDraw.foot(narrow, true, true)
    check("one over the other on a narrow glass, a row less", [size(foot), foot[0][2] < foot[1][2], PanelAlarmDraw.room(narrow, foot)], [2, true, R[2] - 2])
    check("and with no rows, no foot", PanelAlarmDraw.foot(style, true, false), [])
    ui.providers = kept[0]
    ui.alarm = kept[1]
    ui.stack = kept[2]
end
notif_checks()

def notice_checks()
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    a.on_message({"ev": event(1, "trigger", DOOR, "alarm", "open", true)})
    var ops = v.ops_of("notice", style)
    check("the notice of a trigger: the title, what and where, how to leave it", [texts(ops)[0], texts(ops)[1] != nil, texts(ops)[-1]], ["ALARM", true, "Tap to dismiss"])
    check("in the alarm's red", ops[0][5], PanelAlarmDraw.RED)
    check("its header says ALARM", v.title_of("notice"), "ALARM")
    a.on_message({"ev": event(2, "water", HUM, "alert", nil, false)})
    ops = v.ops_of("notice", style)
    check("an alert: WATER, in orange", [texts(ops)[0], ops[0][5]], ["WATER", PanelAlarmDraw.ORANGE])
    var fx = v.tap_of("notice", 100 * 1000 + 100, style)
    check("a touch on it leaves it", [fx, a.notice], [[["alarmDismiss"]], nil])
    fx = a.panic()
    ops = v.ops_of("notice", style)
    check("the brief notice says Panic activated, in the accent", [texts(ops)[0], ops[0][5]], ["Panic activated", 1279])
    # the touch that gave the panic does not take its word off the glass: its release is a tap on the notice
    fx = v.tap_of("notice", 100 * 1000 + 100, style)
    check("a touch on the brief notice, the release of the one that gave it, leaves it", [fx, a.dismiss(), a.notice["kind"]], [[], [], "brief"])
    check("and it is there until its five seconds", [a.tick(), a.notice["kind"]], [[], "brief"])
    tasmota.at_ms += 5100
    check("then", [a.tick(), a.notice], [[["alarmDismiss"]], nil])
end
notice_checks()

# --- the bridge out of reach ----------------------------------------------------------------------------
# A panel boots "disarmed" and does not know it lost the bridge: with its link down the Alarm screen says No link in the state's
# place, Arm and Disarm do nothing, and the panic's screen does not say "Panic activated" for a word that did not leave
class FakeLinkBridge
    var last_link
    def init(up) self.last_link = up end
end
def no_link_checks()
    import global as natives
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    a.on_message({"st": "armed_away", "md": "away", "v": 3})
    check("with no bridge to ask, the link is taken as up", [a.linked(), a.state_word()], [true, "Armed away"])
    natives.zb_bridge = FakeLinkBridge(true)
    check("and with the bridge's link up", [a.linked(), a.state_word()], [true, "Armed away"])
    natives.zb_bridge = FakeLinkBridge(false)
    check("the link down: No link in the state's place", [a.linked(), a.state_word()], [false, "No link"])
    check("the Alarm row of Screens says it", v.screen_rows()[0][3], "No link")
    var d = v.state_data()
    check("the Alarm screen's band says it, grey, and the button stands inert", [d["st"], d["word"], d["buttons"]], ["nolink", "No link", [["Disarm", "off"]]])
    a.on_message({"st": "disarmed", "v": 4})
    d = v.state_data()
    check("disarmed, the two Arm buttons are inert too", d["buttons"], [["Arm away", "off"], ["Arm home", "off"]])
    var R = PanelAlarmDraw.rows(style)
    var box = PanelAlarmDraw.button_box(style, 0, 2)
    check("a touch on one does nothing", v.tap_of("alarm", (box[0] + 10) * 1000 + R[2] + 10, style), [])
    check("Arm and Disarm send nothing", [a.arm("away"), a.disarm()], [[], []])
    var sent_words = []
    for e: ui.act(["alarm", "arm", "away"]) if e[0] == "alarm"  sent_words.push(e) end end
    check("and the glass's Arm sends none", sent_words, [])
    # the panic: its screen is the truth about the word
    var fx = a.panic()
    check("a panic with the link down still tries, and its screen says it was not sent", [fx[0], a.notice["fail"], a.brief_at], [["alarm", {"do": "panic", "by": "panel"}], true, nil])
    var ops = v.ops_of("notice", style)
    check("in the alarm's red, not the accent", [texts(ops)[0], texts(ops)[1], ops[0][5]], ["Panic not sent", "Try again", PanelAlarmDraw.RED])
    a.notice = nil
    natives.zb_bridge = FakeLinkBridge(true)
    check("with the link up, the panic is announced", [a.panic()[1], a.notice["fail"], a.brief_at != nil], [["alarmNotice"], false, true])
    ops = v.ops_of("notice", style)
    check("as Panic activated, in the accent", [texts(ops)[0], ops[0][5]], ["Panic activated", 1279])
    # the send said it did not leave: the screen that was not drawn yet says so
    a.unsent({"do": "arm", "mode": "away"})
    check("a word that is not a panic does not change the screen", a.notice["fail"], false)
    a.unsent({"do": "panic", "by": "panel"})
    check("a panic that did not leave turns it into Not sent", [a.notice["fail"], a.brief_at], [true, nil])
    a.notice = {"kind": "brief", "e": [1, T, "panic", DOOR, "house", nil, 0]}
    a.unsent({"do": "panic", "by": "panel"})
    check("and a device's panic notice, which was never this glass's, is left alone", a.notice.contains("fail"), false)
    a.notice = nil
    natives.zb_bridge = nil
end
no_link_checks()

# --- the screensaver's two signs ---------------------------------------------------------------------------------------
def signal_checks()
    var a = PanelAlarm(zb)
    check("with nothing to say both signs are hidden", a.signals(), [nil, nil])
    a.on_message({"ev": event(1, "open", DOOR, "house", nil, false)})
    check("a house notification lights the notification sign, in yellow", a.signals(), [nil, PanelAlarm.YELLOW])
    a.on_message({"ev": event(2, "tamper", DOOR, "house", nil, false)})
    check("a tamper that only warns lights the alarm's sign, in orange", a.signals(), [PanelAlarm.ORANGE, PanelAlarm.YELLOW])
    a.on_message({"ev": event(3, "trigger", DOOR, "alarm", "open", true)})
    check("a trigger makes it red", a.signals()[0], PanelAlarm.RED)
    a.on_message({"ev": event(4, "arm", "panel", "house", "away", false)})
    a.on_message({"ack": "all"})
    check("an acknowledgement hides both, and the alarm's own arming was no sign", a.signals(), [nil, nil])
    a.on_message({"ev": event(5, "water", HUM, "alert", nil, false)})
    a.dismiss()
    check("an alert dismissed and not acknowledged is still the house's sign", a.signals(), [nil, PanelAlarm.YELLOW])
    a.on_message({"ev": event(6, "panic", "panel", "house", nil, false)})
    check("a panic is the alarm's, red", a.signals(), [PanelAlarm.RED, PanelAlarm.YELLOW])
    var b = PanelAlarm(zb)
    b.on_message({"ev": event(1, "config", "panel", "house", "times", false)})
    check("a change of settings is information: no sign, no warning", [b.signals(), b.warnings()], [[nil, nil], 0])
    b.on_message({"ev": event(2, "unreach", LAMP2, "house", nil, false)})
    check("a siren that is lost is the alarm's own, in orange, and a warning", [b.signals(), b.warnings()], [[PanelAlarm.ORANGE, nil], 1])
end
signal_checks()

# --- the stripe the plan wears --------------------------------------------------------------------------------------
def overlay_checks()
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    check("disarmed with nothing to see: nothing is drawn over the plan", v.overlay(style), [])
    a.on_message({"st": "armed_away", "md": "away", "v": 1})
    var o = v.overlay(style)
    check("armed: a stripe along the top, in green", [o[0][0], o[0][4], o[0][5]], ["fill", 3, PanelAlarmDraw.GREEN])
    check("and it is not stale once drawn", v.stale(), false)
    a.on_message({"ev": event(1, "open", DOOR, "house", nil, false)})
    check("a warning makes it stale", v.stale(), true)
    o = v.overlay(style)
    check("and is a dot", o[-1][0], "cirs")
    a.on_message({"st": "triggered", "v": 2, "c": [DOOR, "open"]})
    o = v.overlay(style)
    check("a trigger is a red stripe", o[0][5], PanelAlarmDraw.RED)
end
overlay_checks()

# --- how far the state reached, and what an arm left unprotected ----------------------------------------------------
def headline_checks()
    var a = PanelAlarm(zb)
    a.on_message({"st": "armed_away", "v": 1, "md": "away"})
    check("a bridge alone says the state and nothing of a reach", a.state_word(), "Armed away")
    a.on_message({"st": "armed_away", "v": 2, "md": "away", "r": [3, 3, 0]})
    check("counted, and complete: how many bridges applied it", a.state_word(), "Armed away · 3 of 3")
    a.on_message({"st": "armed_away", "v": 3, "md": "away", "r": [2, 3, 0]})
    check("armed, and a part did not apply it: only here, the side that is not armed", a.state_word(), "Armed away only here")
    a.on_message({"st": "armed_away", "v": 4, "md": "away", "r": [1, 3, 1]})
    check("in the first moments of a change it says the state only, whatever the count", a.state_word(), "Armed away")
    a.on_message({"st": "disarmed", "v": 5, "r": [2, 5, 0]})
    check("disarmed, and a part out of reach: it says how many", a.state_word(), "Disarmed here · 3 out of reach")
    a.on_message({"st": "disarmed", "v": 6, "r": [5, 5, 0]})
    check("disarmed and complete", a.state_word(), "Disarmed · 5 of 5")
    a.on_message({"st": "armed_home", "v": 7, "md": "home", "r": [4, 4, 0], "l": 2})
    check("an arm that left 2 devices unprotected says so, with the reach", a.state_word(), "Armed home · 4 of 4 · 2 unprotected")
    a.on_message({"st": "armed_home", "v": 8, "md": "home", "l": 2})
    check("and with no reach to tell", a.state_word(), "Armed home · 2 unprotected")
    a.on_message({"st": "disarmed", "v": 9, "l": 2})
    check("a disarm has nothing unprotected, though the count of an old arm came", a.state_word(), "Disarmed")
    a.on_message({"st": "armed_away", "v": 10, "md": "away", "r": [1, 3, 0], "l": 1})
    check("only here, and unprotected", a.state_word(), "Armed away only here · 1 unprotected")
    a.on_message({"st": "triggered", "v": 11, "r": [3, 3, 0]})
    check("a trigger", a.state_word(), "TRIGGERED · 3 of 3")
end
headline_checks()

# what the bridge says is lost: the list, the line of a bridge, and the clearing of a device found again
def lost_list_checks()
    import string
    var a = PanelAlarm(zb)
    a.on_message({"lo": [[DOOR, "sensor", "house"], ["bridge 3", "bridge", "alert"]]})
    check("the list of what is lost is kept", a.cfg["lo"], [[DOOR, "sensor", "house"], ["bridge 3", "bridge", "alert"]])
    a.on_message({"ev": [5, 100, "unreach", "bridge 3", "alert", nil, 0]})
    check("a bridge lost is a line that says which", string.find(a.line_of(a.events[-1]), "bridge 3 unreachable") > 0, true)
    a.on_message({"clr": "bridge 3"})
    check("the bridge found again takes its notice off the unseen", a.seen.contains(5), true)
    a.on_message({"lo": []})
    check("and the list is empty", a.cfg["lo"], [])
    a.on_message({"lo": [["0x1", "sensor", "house"], ["0x2", "sensor", "house"], ["0x3", "sensor", "house"], ["0x4", "sensor", "house"], ["0x5", "sensor", "house"], ["0x6", "sensor", "house"]]})
    a.on_message({"lo": [["0x7", "siren", "alert"]], "at": 6})
    check("a long list comes in messages and is whole", size(a.cfg["lo"]), 7)
end
lost_list_checks()

# an arm that would leave devices unprotected asks first: a simple confirmation, and the arm goes when it is answered
def arm_confirm_checks()
    import string
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    var kept = [ui.providers, ui.alarm, ui.stack]
    ui.providers = [v]
    ui.alarm = v
    ui.stack = []
    def arms(fx)
        for e: fx if e[0] == "alarm" && e[1].find("do") == "arm" return true end end
        return false
    end
    a.cfg["sensors"][DOOR] = ["perimeter", 1, "house", 1, "", "", 0, 4]
    a.cfg["sensors"][HUM] = ["interior", 0, "off", 0, "", "", 0, 4]
    check("nothing lost: the arm goes at once", arms(ui.act(["alarm", "arm", "away"])), true)
    a.on_message({"lo": [[DOOR, "sensor", "house"], [HUM, "sensor", "house"], ["bridge 3", "bridge", "alert"]]})
    ui.stack = []
    check("what an arm leaves unprotected: away, the door, the interior sensor and the bridge; at home, the interior sensor does not watch", [a.unprotected("away"), a.unprotected("home")], [3, 2])
    var fx = ui.act(["alarm", "arm", "away"])
    check("with devices lost the arm waits: the confirmation opens", [arms(fx), ui.top()["view"]], [false, ["alarmArm", "away"]])
    var dlg = v.view(ui.top()["view"], true)
    check("it says how many and which, and its answers are Arm anyway and Cancel", [dlg[0], dlg[2][-2][2], dlg[2][-1][2], string.find(dlg[2][0][2], "Front door") >= 0], ["3 devices lost", "Arm anyway", "Cancel", true])
    fx = ui.act(["alarm", "armAnyway", "away"])
    check("Arm anyway sends the arm, and the confirmation is left", [arms(fx), ui.top() == nil || ui.top()["view"][0] != "alarmArm"], [true, true])
    # a lost sensor that watches nothing in the mode asks nothing
    a.on_message({"lo": [[HUM, "sensor", "house"]]})
    ui.stack = []
    check("at home, with only the interior sensor lost, the arm goes at once", arms(ui.act(["alarm", "arm", "home"])), true)
    ui.providers = kept[0]
    ui.alarm = kept[1]
    ui.stack = kept[2]
end
arm_confirm_checks()

# --- the rows a device's options get, and the settings ----------------------------------------------------------------
def rows_checks()
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    # the taps below go through the UI, which asks its provider: this one. With no pattern drawn on this panel nothing is asked
    # for (sensitive_checks has the ones that are)
    var kept = [ui.providers, ui.alarm, ui.prefs["pattern"]]
    ui.providers = [v]
    ui.alarm = v
    ui.prefs["pattern"] = []
    var r = v.device_rows(DOOR, true)
    var labels = []
    for x: r labels.push(x[2]) end
    check("a sensor's rows: Alarm, Notify, Sound, When, and Panic burst", labels, ["Alarm", "Notify", "Sound", "When", "Panic burst"])
    a.zoned[DOOR] = true
    labels = []
    for x: v.device_rows(DOOR, true) labels.push(x[2]) end
    check("a sensor with an IAS zone has no numeric condition", labels, ["Alarm", "Notify", "Sound", "Panic burst"])
    a.on_message({"sc": [DOOR, "perimeter", 1, "house", 1, "", "", 0, 4]})
    labels = []
    for x: v.device_rows(DOOR, true) labels.push(x[2]) end
    check("a perimeter sensor has the Entry door too", labels, ["Alarm", "Entry door", "Notify", "Sound", "Panic burst"])
    check("with what the bridge keeps as the hints", [v.device_rows(DOOR, true)[0][3], v.device_rows(DOOR, true)[1][3], v.device_rows(DOOR, true)[2][3]], ["Perimeter", "On", "House"])
    labels = []
    for x: v.device_rows(LAMP2, true) labels.push(x[2]) end
    check("another device's: Siren, On panic, Panic burst", labels, ["Siren", "On panic", "Panic burst"])
    # the second channel of a switch: the bridge keeps what a device does on the panic by IEEE address, so no row for it
    store.register_device([LAMP2 + "/2", "Siren plug 2", "plug", 1, 0, 0, "TS011F", 2, 0, 0])
    labels = []
    for x: v.device_rows(LAMP2 + "/2", true) labels.push(x[2]) end
    check("a channel after the first has no On panic: the bridge refuses its word (A30)", labels, ["Siren", "Panic burst"])
    check("with Editing off, nothing", v.device_rows(DOOR, false), [])
    check("a relay of the panel has none", v.device_rows("relay:1", true), [])
    # what a touch sends, and shows at once
    var fx = ui.act(["alarm", "entry", DOOR])
    check("Entry door toggles and is sent", [fx[0], v.record(DOOR)[1]], [["alarm", {"do": "sensor", "id": DOOR, "entry": false}], 0])
    fx = ui.act(["alarm", "sound", DOOR])
    check("Sound toggles", [fx[0], v.record(DOOR)[3]], [["alarm", {"do": "sensor", "id": DOOR, "sound": false}], 0])
    ui.act(["open", "alarmChoice", "role", DOOR])
    var lv = v.view(ui.top()["view"], true)
    check("the Alarm choice is four dots, the one in force lit", [lv[0], size(lv[2]), lv[2][1][0], lv[2][0][0]], ["Alarm", 4, "dotOn", "dotOff"])
    fx = ui.act(["alarm", "pick", "role", DOOR, "interior"])
    check("a choice is sent, shown, and the choice view is left", [fx[0], v.record(DOOR)[0], ui.top() == nil || ui.top()["view"][0] != "alarmChoice"],
          [["alarm", {"do": "sensor", "id": DOOR, "role": "interior"}], "interior", true])
    ui.stack = []
    fx = ui.act(["alarm", "pick", "notify", DOOR, "alert"])
    check("and the notification's", [fx[0], v.record(DOOR)[2]], [["alarm", {"do": "sensor", "id": DOOR, "notify": "alert"}], "alert"])
    ui.stack = []
    fx = ui.act(["alarm", "siren", LAMP2])
    check("a siren is put on the list", [fx[0], a.cfg["s"]], [["alarm", {"do": "siren", "id": LAMP2, "on": true}], [LAMP2]])
    # a channel after the first is a siren by its own id, and the bridge (zbbridge_alarm.be, act_on) sends the command to that endpoint
    fx = ui.act(["alarm", "siren", LAMP2 + "/2"])
    check("the second channel of a switch is put on the list by its own id", [fx[0], a.cfg["s"]], [["alarm", {"do": "siren", "id": LAMP2 + "/2", "on": true}], [LAMP2, LAMP2 + "/2"]])
    check("each channel's row says On: the first channel and the second are two sirens", [v.device_rows(LAMP2 + "/2", true)[0][3], v.device_rows(LAMP2, true)[0][3]], ["On", "On"])
    fx = ui.act(["alarm", "siren", LAMP2 + "/2"])
    check("and off it, the first channel still a siren", [fx[0], a.cfg["s"]], [["alarm", {"do": "siren", "id": LAMP2 + "/2", "on": false}], [LAMP2]])
    fx = ui.act(["alarm", "burstdev", HUM])
    check("a device is left out of the burst, as the row says Off", [fx[0], a.cfg["np"]], [["alarm", {"do": "burst", "id": HUM, "on": false}], [HUM]])
    ui.stack = []
    fx = ui.act(["alarm", "pick", "pact", LAMP2, "on"])
    check("a device the panic runs is one word of that device, not the whole list", [fx[0], a.cfg["pd"]], [["alarm", {"do": "panic_act", "id": LAMP2, "act": "on"}], [[LAMP2, "on"]]])
    ui.stack = []
    # seven devices, which the whole list in one word did not fit a frame of: a word each, each a few dozen bytes
    var ids = []
    for i: 0 .. 6  ids.push("0x00124B0000CC000" + str(i)) end
    var widest = 0
    for i: 0 .. 6
        ui.stack = []
        fx = ui.act(["alarm", "pick", "pact", ids[i], i % 2 == 0 ? "close" : "open"])
        var n = size(json.dump(fx[0][1]))
        if n > widest  widest = n end
    end
    check("seven devices: the list is whole on the glass and each word fits a frame", [size(a.cfg["pd"]), size(a.cfg["pd"][0]), widest < 100], [8, 2, true])
    fx = ui.act(["alarm", "pick", "pact", ids[2], "none"])
    check("a none takes the device out, and says so", [fx[0], size(a.cfg["pd"])], [["alarm", {"do": "panic_act", "id": ids[2], "act": "none"}], 7])
    # the bridge keeps 32: a 33rd is not put in the list and nothing is said of it, and one in the list still changes
    var full = []
    for i: 0 .. 31  full.push(["0x00124B0000DD" + (i < 10 ? "000" : "00") + str(i), "on"]) end
    a.cfg["pd"] = full
    ui.stack = []
    fx = ui.act(["alarm", "pick", "pact", "0x00124B0000EE0001", "on"])
    var said_to_bridge = 0
    for e: fx  if e[0] == "alarm"  said_to_bridge += 1 end end
    check("a 33rd device is not put in, and nothing is said to the bridge", [said_to_bridge, size(a.cfg["pd"])], [0, 32])
    ui.stack = []
    fx = ui.act(["alarm", "pick", "pact", full[3][0], "off"])
    check("one of the 32 still changes", [fx[0][1]["act"], a.cfg["pd"][-1]], ["off", [full[3][0], "off"]])
    a.cfg["pd"] = [[LAMP2, "on"]]
    ui.stack = []
    # When: a numeric sensor's condition
    ui.act(["alarm", "when", HUM])
    check("When opens its three rows", [ui.top()["view"][0], size(v.view(["alarmWhen", HUM], true)[2])], ["alarmWhen", 3])
    fx = ui.act(["alarm", "measure", HUM])
    check("Measure picks the first, as above", [v.record(HUM)[4], v.record(HUM)[5], fx[0][1]["key"]], ["Temperature", "above", "Temperature"])
    fx = ui.act(["alarm", "measure", HUM])
    check("and the next", v.record(HUM)[4], "Humidity")
    fx = ui.act(["alarm", "way", HUM])
    check("Rule turns it", [v.record(HUM)[5], fx[0][1]["way"]], ["below", "below"])
    check("the keyboard of the limit opens with the one in force", v.keyboard("limit"), ["0", 6])
    fx = v.commit(ui, "limit", "70")
    check("a limit typed is sent and kept", [v.record(HUM)[6], fx[0][1]["limit"]], [70, 70])
    v.commit(ui, "limit", "7x")
    check("one that is not a number is nothing", v.record(HUM)[6], 70)
    ui.stack = []
    # the settings
    var sv = v.view(["alarmSettings"], true)
    var names = []
    for x: sv[2] names.push(x[2]) end
    check("the settings' rows", names, ["Exit time", "Entry time", "Siren time", "Alarm sounds", "Panic burst", "Panic: Send to HA", "Panic: Notify all panels", "Panic: Trigger the alarm"])
    a.on_message({"cfg": {"t": [30, 30, 300], "p": [1, 0, 0], "b": [8, 3]}})
    sv = v.view(["alarmSettings"], true)
    check("with the bridge's values", [sv[2][0][3], sv[2][2][3], sv[2][4][3], sv[2][5][3], sv[2][7][3]], ["30 s", "300 s", "8 in 3 s", "On", "Off"])
    ui.prefs["alarmSounds"] = "off"
    fx = ui.act(["alarm", "sounds"])
    check("Alarm sounds goes round: Off, Home, Always", [ui.prefs["alarmSounds"], fx[0]], ["home", ["prefs"]])
    ui.act(["alarm", "sounds"])
    ui.act(["alarm", "sounds"])
    check("and back to Off", ui.prefs["alarmSounds"], "off")
    fx = ui.act(["alarm", "panic", "alarm"])
    check("Trigger the alarm is a panic action turned on", [fx[0], a.cfg["p"]], [["alarm", {"do": "panic_cfg", "alarm": true}], [1, 0, 1]])
    fx = ui.act(["alarm", "burst", 10, 4])
    check("a burst chosen", [fx[0], a.cfg["b"]], [["alarm", {"do": "panic_cfg", "burst": [10, 4]}], [10, 4]])
    fx = v.commit(ui, "exit", "45")
    check("a time typed", [fx[0], a.cfg["t"]], [["alarm", {"do": "times", "exit": 45}], [45, 30, 300]])
    check("a time past 15 minutes is nothing", [v.commit(ui, "siren", "901") != nil, a.cfg["t"][2]], [true, 300])
    ui.providers = kept[0]
    ui.alarm = kept[1]
    ui.prefs["pattern"] = kept[2]
end
rows_checks()

# --- what the alarm's settings ask of the pattern ----------------------------------------------------------------
# Siren time 0, a sensor's role off, the siren off the list and Remove of a sensor changed how the house is guarded with no
# pattern drawn: the settings of the alarm ask for it as the Wi-Fi's Forget does, and the screens, the acknowledgements and the
# beeps of this panel do not
def sensitive_checks()
    var a = PanelAlarm(zb)
    var v = PanelAlarmView(a, ui)
    var kept = [ui.providers, ui.alarm, ui.prefs["pattern"], ui.stack, ui.unlocked]
    ui.providers = [v]
    ui.alarm = v
    ui.prefs["pattern"] = ["salt", "hash"]
    ui.unlocked = false
    var asks = [["alarm", "entry", DOOR], ["alarm", "sound", DOOR], ["alarm", "measure", HUM], ["alarm", "way", HUM], ["alarm", "siren", LAMP2],
                ["alarm", "burstdev", HUM], ["alarm", "pick", "role", DOOR, "off"], ["alarm", "pick", "pact", LAMP2, "on"], ["alarm", "panic", "alarm"],
                ["alarm", "burst", 0, 3], ["keyboard", "alarm", "siren"], ["keyboard", "alarm", "exit"], ["keyboard", "alarm", "limit"]]
    var wrong = []
    for act: asks
        ui.stack = []
        ui.act(act)
        var top = ui.top()
        if top == nil || top["view"][0] != "lock" || str(top["view"][2]) != str(act)  wrong.push(act) end
        if !PanelUi.sensitive(act)  wrong.push(["static", act]) end
    end
    check("each word that sets the alarm up asks for the pattern first, and the pattern carries it out", wrong, [])
    var free = [["alarm", "open", "alarm"], ["alarm", "open", "notifs"], ["alarm", "settings"], ["alarm", "sounds"], ["alarm", "ack", 3], ["alarm", "when", HUM],
                ["alarm", "arm", "away"], ["alarm", "doDisarm"]]
    wrong = []
    for act: free
        ui.stack = []
        ui.act(act)
        var top = ui.top()
        if top != nil && top["view"][0] == "lock"  wrong.push(act) end
        if PanelUi.sensitive(act)  wrong.push(["static", act]) end
    end
    check("the screens, the acknowledgements, the panel's own beeps, the disarm's own lock and the arm ask for none", wrong, [])
    check("and a keyboard of another kind is not the alarm's", PanelUi.sensitive(["keyboard", "slot", "z", DOOR]), false)
    # the pattern drawn a moment ago stands for it, as it does for the Wi-Fi's Forget
    ui.stack = []
    ui.unlocked = true
    ui.unlocked_at = ui.now()
    var fx = ui.act(["alarm", "siren", LAMP2])
    check("a pattern drawn a moment ago stands: the word goes", [fx[0], ui.top() == nil || ui.top()["view"][0] != "lock"], [["alarm", {"do": "siren", "id": LAMP2, "on": true}], true])
    # Remove of a sensor or of a siren, and of nothing else
    ui.unlocked = false
    ui.stack = []
    ui.act(["open", "confirm", "removeDevice", DOOR])
    check("Remove of a sensor asks for the pattern", [ui.top()["view"][0], ui.top()["view"][2][1]], ["lock", "confirm"])
    ui.stack = []
    a.cfg["s"] = []
    ui.act(["open", "confirm", "removeDevice", LAMP2])
    check("Remove of a plug that is no siren does not", ui.top()["view"][0], "confirm")
    ui.stack = []
    a.cfg["s"] = [LAMP2]
    ui.act(["open", "confirm", "removeDevice", LAMP2])
    check("one that is the alarm's siren does", ui.top()["view"][0], "lock")
    ui.prefs["pattern"] = []
    ui.stack = []
    ui.act(["open", "confirm", "removeDevice", DOOR])
    check("a panel with no pattern is asked for none, as for the rest", ui.top()["view"][0], "confirm")
    ui.providers = kept[0]
    ui.alarm = kept[1]
    ui.prefs["pattern"] = kept[2]
    ui.stack = kept[3]
    ui.unlocked = kept[4]
end
sensitive_checks()

# --- what PanelZigbee does with it ------------------------------------------------------------------------------------
def zigbee_checks()
    var sent = []
    var a = PanelAlarm(zb)
    var z = PanelZigbee(store, ui, nil, / e -> sent.push(e), / c -> nil)
    z.alarm = a
    z.on_event({"ZbAlarm": {"st": "armed_home", "md": "home", "v": 9}})
    check("the link's ZbAlarm reaches the alarm, and what it asks goes out as effects", [a.st, a.mode, sent[-1]], ["armed_home", "home", [["alarmShow"]]])
    z.on_info({"0x1": {"Device": "0x1", "IEEEAddr": DOOR, "ModelId": "TS0203", "ZoneType": 21, "ZoneStatus": 0}})
    check("a sensor ZbInfo says has a zone is marked, for the options' rows", a.zoned.contains(DOOR), true)
    check("a message it does not know does nothing", z.on_event({"Whatever": 1}), nil)
end
zigbee_checks()

# --- a word of the house that the panel keeps ---------------------------------------------------------
def house_word_checks()
    var a = PanelAlarm(zb)
    a.on_message({"ev": event(7, "open", DOOR, "house", nil, false)})
    var fx = a.house_word("left", "Living room", 3)
    var e = a.events[-1]
    check("a bridge that left the house: a warning of the house in the Notifications, numbered below zero, with no notice", [e[0], e[2], e[4], a.notice, a.warnings(), fx], [-1, "left", "local", nil, 2, [["alarmShow"]]])
    check("its line says who left and how many devices went", a.line_of(e)[6 ..], "Living room left the house: 3 devices removed")
    check("one device is one", a.line_of([-9, T, "left", "Bedroom", "local", 1, 0])[6 ..], "Bedroom left the house: 1 device removed")
    a.house_word("left", "Bedroom", 1)
    check("each its own number", [a.events[-1][0], size(a.events)], [-2, 3])
    a.on_message({"ack": "all"})
    check("and it is seen as the others are", a.warnings(), 0)
end
house_word_checks()

# --- the house's settings: the screens read the house's list and write there ------------------------------------------
class FakeHouseList
    var me
    def init() self.me = 4 end
end
class FakeHouse
    var list, setting, edits
    def init() self.list = FakeHouseList() self.setting = nil self.edits = [] end
    def alarm_setting() return self.setting end
end
# house_alarm.be as the panel calls it: what it was asked, and the house's model, which the first word makes
class HouseAlarm
    static def panel_cfg(h) return {"t": h.setting["times"], "sensors": {}, "pd": []} end
    static def edit(h, m, owner, seed)
        h.edits.push([m, owner(m.find("id", "")), seed.find("t")])
        if h.setting == nil  h.setting = {"times": [10, 20, 120]} end
        return true
    end
    static def forget(h, ieee)
        h.edits.push(["forget", ieee])
        return true
    end
    static def norm(id) return id end
end

def house_settings_checks()
    var a = PanelAlarm(zb)
    a.on_message({"cfg": {"t": [45, 20, 120], "p": [1, 0, 0]}, "lo": [[DOOR, "sensor", "house"]]})
    check("a panel in no house: no word is the house's", a.to_house({"do": "times", "exit": 10}), false)
    var h = FakeHouse()
    a.house = h
    a.owner = / id -> id == DOOR ? 6 : 7
    check("in a house with no alarm in its list, the bridge's word of its settings is still the screens' model", [a.of_house(), a.cfg["t"]], [false, [45, 20, 120]])
    check("a word of the settings is the house's, the first starting from the screens' model", a.to_house({"do": "times", "exit": 10}), true)
    check("what the house was asked: the word, and the screens' model of the bridge of the house", [h.edits[-1][0]["exit"], h.edits[-1][2]], [10, [45, 20, 120]])
    check("and the screens' model is the house's then, with the losses the bridge said", [a.of_house(), a.cfg["t"], a.cfg["lo"]], [true, [10, 20, 120], [[DOOR, "sensor", "house"]]])
    a.to_house({"do": "sensor", "id": DOOR, "role": "24h"})
    check("a device's word goes under the bridge that owns it", h.edits[-1][1], 6)
    a.cfg["pd"] = [[LAMP2, "on"]]
    a.to_house({"do": "panic_act", "id": LAMP2, "act": "on"})
    check("a device's action in the panic is the whole list the view changed", h.edits[-1][0], {"do": "panic_cfg", "devices": [[LAMP2, "on"]]})
    check("an arm is the bridge's, and so are the state and the asks", [a.to_house({"do": "arm", "mode": "away"}), a.to_house({"do": "config"})], [false, false])
    a.on_message({"cfg": {"t": [99, 99, 99]}, "sc": [DOOR, "perimeter", 1, "house", 0, "", "", 0, 4], "lo": []})
    check("the bridge's word of its own settings is not the model any more, and its losses are", [a.cfg["t"], a.cfg["sensors"], a.cfg["lo"]], [[10, 20, 120], {}, []])
    a.left(DOOR)
    check("a device that left the network leaves the house's alarm", h.edits[-1], ["forget", DOOR])
    h.list.me = 0
    check("a panel that left the house: its words are the bridge's again", [a.of_house(), a.to_house({"do": "times", "exit": 5})], [false, false])
end
house_settings_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
