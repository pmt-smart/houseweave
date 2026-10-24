# berry/panel_lamp_settings.be, a lamp's settings: its power-on state and its on/off transition,
# read from it and written to it by the panel itself, on the screen the thermostat's and the blind's settings have. The
# Settings icon of the lamp's page opens it; a read's answer fills it; a choice is written and its answer awaited, and a
# refusal says the lamp has no such setting; the power-on choice goes to the lamp's record, which the plan reads when the
# relay that feeds the lamp closes again. Each part is a function, as the script's own top level is far past the 256
# constants a function may name.

import json

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

var living_room_text = read_text("berry/test/fixtures/living-room.json")
var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard",
                       "thermostat": "thermostat", "cover": "cover"},
             "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5, "thermostatLines": 1, "thermostatModes": 2}

class FakePlan
    var live
    def init() self.live = {} end
    def on_report(id, state) self.live[id] = state end
    def on_color(id, c) end
    def on_answered(id) return true end
end

def fixture()
    var f = {}
    f["store"] = PanelStore(json.load(living_room_text))
    f["ui"] = PanelUi(f["store"], shape, / -> [], nil)
    f["plan"] = FakePlan()
    f["ui"].live = f["plan"].live
    f["effects"] = []
    f["sent"] = []
    var fx = f["effects"]
    var sent = f["sent"]
    f["zb"] = PanelZigbee(f["store"], f["ui"], f["plan"], def (e) for x: e fx.push(x) end end, def (c) sent.push(c) end)
    f["lamp"] = PanelLampSettings(f["zb"])
    f["zb"].lamp = f["lamp"]
    f["ui"].network = f["zb"]
    return f
end

def settings_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    var zb = f["zb"]
    var lamp = PanelStore.member_ids(store.find_zone("corridor")["members"])[0]
    zb.ieee_of[0x1A2B] = lamp
    ui.prefs["editing"] = true
    ui.open(["detail", "d", lamp])
    check("a lamp's page: Identify, Settings and the card (no Schedule without one)", PanelPageButtons.icons(ui, ui.top()["view"]), ["identify", "settings"])
    var out = ui.page_icon(2)
    check("the Settings asks the lamp, and its screen is on top", [out[0], ui.top()["view"]], [["lamp", lamp, "read"], ["thermostatSettings", lamp]])
    var rows = def () var o = [] for r: ui.list_view(ui.top()["view"])[2] o.push([r[2], r[3], r[5]]) end return o end
    check("its two rows, which the lamp has not said yet", rows(),
          [["Power on", "?", ["thermostat", "pick", lamp, "power"]], ["Fade", "?", ["thermostat", "pick", lamp, "fade"]]])
    f["lamp"].run(out[0])
    check("a read of each attribute, as they are of two clusters", f["sent"],
          ['ZbSend {"Device":"' + lamp + '","Read":{"StartUpOnOff":true}}', 'ZbSend {"Device":"' + lamp + '","Read":{"OnOffTransitionTime":true}}'])
    zb.on_event({"ZbReceived": {"0x1A2B": {"Device": "0x1A2B", "StartUpOnOff": 0, "Endpoint": 1}}})
    zb.on_event({"ZbReceived": {"0x1A2B": {"Device": "0x1A2B", "OnOffTransitionTime": 4, "Endpoint": 1}}})
    check("its answers fill them: Off, and the 0.4 s it has as the nearest, 0.5 s", rows(),
          [["Power on", "Off", ["thermostat", "pick", lamp, "power"]], ["Fade", "0.5 s", ["thermostat", "pick", lamp, "fade"]]])
    ui.act(["thermostat", "pick", lamp, "power"])
    var choices = []
    for r: ui.list_view(ui.top()["view"])[2]  choices.push([r[0], r[2]]) end
    check("the power-on choices, a dot on the one it has", choices, [["dotOn", "Off"], ["dotOff", "On"], ["dotOff", "Previous"]])
    out = ui.act(["thermostat", "choose", lamp, "power", 2])
    check("one chosen is written by the panel, and back on the screen", [out[0], ui.top()["view"]], [["lamp", lamp, "write", "power", 2], ["thermostatSettings", lamp]])
    f["sent"].clear()
    f["lamp"].run(out[0])
    check("as StartUpOnOff 255, as it was", f["sent"], ['ZbSend {"Device":"' + lamp + '","Write":{"StartUpOnOff":255}}'])
    f["effects"].clear()
    zb.on_event({"ZbResponse": {"Device": "0x1A2B", "Command": "0006_04", "Status": 0}})
    check("taken: the row says it, and the record keeps it for the plan, saved", [rows()[0][1], store.find_device(lamp)[8], f["effects"][0]], ["Previous", 4, ["save"]])
    ui.act(["thermostat", "pick", lamp, "fade"])
    out = ui.act(["thermostat", "choose", lamp, "fade", 3])
    f["lamp"].run(out[0])
    check("a fade of 2 s", f["sent"][-1], 'ZbSend {"Device":"' + lamp + '","Write":{"OnOffTransitionTime":20}}')
    zb.on_event({"ZbResponse": {"Device": "0x1A2B", "Command": "0008_04", "Status": 134}})
    check("refused: the lamp has no such setting", rows()[1][1], "Not supported")
    check("a choice out of the list writes nothing", [size(f["sent"]), f["lamp"].run(["lamp", lamp, "write", "fade", 9]), size(f["sent"])], [2, nil, 2])
    ui.back()
    check("the screen left: what it read goes, to be read again", f["lamp"].values.contains(lamp), false)
    # the pairing's own write of Off is still the pairing's: no lamp screen expects it
    zb.expect_startup(lamp)
    f["effects"].clear()
    zb.on_event({"ZbResponse": {"Device": "0x1A2B", "Command": "0006_04", "Status": 0}})
    check("the pairing's StartUpOnOff answer goes where it always went", [store.find_device(lamp)[8], f["effects"]], [1, [["save"]]])
    # Editing off: the screen opens only to be seen
    ui.prefs["editing"] = false
    ui.page_icon(2)
    var taps = false
    for r: ui.list_view(ui.top()["view"])[2]
        if r[5] != nil  taps = true end
    end
    check("Editing off, its rows take no touch", taps, false)
end
settings_checks()


if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
