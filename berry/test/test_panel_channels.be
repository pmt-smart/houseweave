# A switch of several channels, each a device of its own: its ids, its commands to each endpoint,
# a report to its channel, a device that does not answer for all of them, the interview of its second endpoint in a
# search, the channels of a device already on the network, the startup's answer of each, and a Remove that takes the
# whole device. Each part is a function, as a script's top level holds 256 constants at most.

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

var living_room_text = read_text("berry/test/fixtures/living-room.json")
var shape = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard"},
             "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5}

class FakePlan
    var live
    var answered
    def init() self.live = {} self.answered = [] end
    def on_report(id, state) self.live[id] = state end
    def on_color(id, c) end
    def on_answered(id) self.answered.push(id) return true end
end

var SW = "0x00124B0000AB0001"

def fixture(sh)
    var f = {}
    f["store"] = PanelStore(json.load(living_room_text))
    f["ui"] = PanelUi(f["store"], sh != nil ? sh : shape, / -> [], nil)
    f["ui"].providers.push(PanelAddView(f["ui"]))
    f["ui"].now_fn = / -> 0
    f["plan"] = FakePlan()
    f["ui"].live = f["plan"].live
    f["effects"] = []
    f["sent"] = []
    var fx = f["effects"]
    var sent = f["sent"]
    f["zb"] = PanelZigbee(f["store"], f["ui"], f["plan"], def (e) for x: e fx.push(x) end end, def (c) sent.push(c) end)
    return f
end

# a two-channel switch found in the Hall's search: the announce, and the interview of its two endpoints, as Z2T says
# a TS0002's, an on/off light on each
def found(f)
    var ui = f["ui"]
    var zb = f["zb"]
    ui.open_card("z:hall", "home")
    ui.action()
    ui.list_row(0, 0, false)
    zb.on_event({"ZbState": {"Status": 30, "IEEEAddr": SW, "ShortAddr": "0x5A01", "PowerSource": true, "ReceiveWhenIdle": true, "Security": false}})
    zb.on_event({"ZbState": {"Status": 33, "Device": "0x5A01", "Endpoint": "0x01", "ProfileId": "0x0104", "DeviceId": "0x0100", "InClusters": ["0x0006"]}})
    zb.on_event({"ZbState": {"Status": 33, "Device": "0x5A01", "Endpoint": "0x02", "ProfileId": "0x0104", "DeviceId": "0x0100", "InClusters": ["0x0006"]}})
end

def interview_checks()
    var f = fixture()
    var store = f["store"]
    found(f)
    var a = store.find_device(SW)
    var b = store.find_device(SW + "/2")
    check("two channels, two devices: the first by the IEEE, the second by the IEEE and its endpoint, both switches",
          [a != nil ? [a[2], a[3], a[7]] : nil, b != nil ? [b[2], b[3], b[7]] : nil], [["switch", 1, 1], ["switch", 1, 2]])
    check("the first, taken for an on/off lamp by its endpoint, is named a switch too, and each has its name",
          [a[1], b[1]], ["Switch 1", "Switch 2"])
    check("both in the Hall, each in its place", [store.zone_of(SW)["id"], store.zone_of(SW + "/2")["id"], store.zone_of(SW)["members"][SW] != store.zone_of(SW)["members"][SW + "/2"]],
          ["hall", "hall", true])
    var startups = []
    for e: f["effects"]
        if e[0] == "startup" startups.push(e[1]) end
    end
    check("each channel is asked to come back off, as a lamp is", startups, [SW, SW + "/2"])
    check("the search shows both", [f["ui"].pairing["found"][0], f["ui"].pairing["found"][1]], [[SW, "ready"], [SW + "/2", "ready"]])
    f["effects"].clear()
    f["zb"].on_event({"ZbState": {"Status": 33, "Device": "0x5A01", "Endpoint": "0x02", "ProfileId": "0x0104", "DeviceId": "0x0100", "InClusters": ["0x0006"]}})
    check("its interview again adds nothing", [size(store.channels_of(SW)), f["effects"]], [2, []])
    check("Replace is no channel's: the device's of one only", [f["ui"].replaceable(SW), f["ui"].replaceable(SW + "/2"), f["ui"].replaceable("0x00124B0000E00001")], [false, false, true])
end

def lamp_checks()
    var f = fixture()
    var store = f["store"]
    var ui = f["ui"]
    ui.open_card("z:hall", "home")
    ui.action()
    ui.list_row(0, 0, false)
    var LAMP = "0x00124B0000AB0002"
    f["zb"].on_event({"ZbState": {"Status": 30, "IEEEAddr": LAMP, "ShortAddr": "0x5A02", "PowerSource": true, "ReceiveWhenIdle": true, "Security": false}})
    f["zb"].on_event({"ZbState": {"Status": 33, "Device": "0x5A02", "Endpoint": "0x01", "ProfileId": "0x0104", "DeviceId": "0x010D", "InClusters": ["0x0006", "0x0008", "0x0300"]}})
    f["zb"].on_event({"ZbState": {"Status": 33, "Device": "0x5A02", "Endpoint": "0x02", "ProfileId": "0x0104", "DeviceId": "0x0100", "InClusters": ["0x0006"]}})
    check("a lamp's second endpoint is no channel: one lamp", [size(store.channels_of(LAMP)), store.find_device(LAMP)[2]], [1, "light"])
end

def address_checks()
    var f = fixture()
    var store = f["store"]
    found(f)
    check("a channel's IEEE", [PanelStore.ieee_part(SW + "/2"), PanelStore.ieee_part(SW), PanelStore.ieee_part("relay:1")], [SW, SW, "relay:1"])
    check("a device's channels, the first first", store.channels_of(SW), [SW, SW + "/2"])
    check("a command names each channel's endpoint, and a lamp as it did",
          [store.zb_address(SW), store.zb_address(SW + "/2"), store.zb_address("0x00124B0000E00001")],
          ['"Device":"' + SW + '","Endpoint":1', '"Device":"' + SW + '","Endpoint":2', '"Device":"0x00124B0000E00001"'])
    var out = []
    var cmds = PanelPlanCommands(def (c) out.push(c) end, nil)
    cmds.address = / dev -> store.zb_address(dev)
    # the fourth line of a burst waits its gap: the timers are the test's, and the clock moves on
    tasmota.timers = TimerBook(tasmota)
    cmds.run({"zids": [], "unicast": [SW + "/2"], "relays": [], "skipped": []}, "on")
    cmds.identify(SW + "/2")
    cmds.query(SW + "/2")
    cmds.startup(SW + "/2")
    check("the first three go at once, and the fourth waits", size(out), 3)
    tasmota.timers.advance(PanelPlanCommands.GAP_MS)
    tasmota.timers = nil
    tasmota.at_ms = nil
    check("on to the second channel; Identify and ZbInfo to the device; its StartUpOnOff to the channel", out,
          ['ZbSend {"Device":"' + SW + '","Endpoint":2,"Send":{"Power":1}}', 'ZbSend {"Device":"' + SW + '","Send":{"Identify":3}}',
           "ZbInfo " + SW, 'ZbSend {"Device":"' + SW + '","Endpoint":2,"Write":{"StartUpOnOff":0}}'])
    f["zb"].send_group("add", SW + "/2", 7)
    check("a channel joins a group on its endpoint", f["sent"][-1], 'ZbSend {"Device":"' + SW + '","Endpoint":2,"Send":{"AddGroup":7}}')
end

def report_checks()
    var f = fixture()
    var zb = f["zb"]
    found(f)
    zb.on_event({"ZbReceived": {"0x5A01": {"Device": "0x5A01", "Endpoint": 1, "Power": 1}}})
    zb.on_event({"ZbReceived": {"0x5A01/2": {"Device": "0x5A01", "Endpoint": 2, "Power": 0}}})
    check("each channel's report is its own, by its endpoint", [f["plan"].live.find(SW), f["plan"].live.find(SW + "/2")], ["on", "off"])
    zb.on_event({"ZbReceived": {"0x5A01": {"Device": "0x5A01", "Reachable": false}}})
    check("a device that does not answer, for both", [f["plan"].live.find(SW), f["plan"].live.find(SW + "/2")], ["noanswer", "noanswer"])
    zb.on_event({"ZbPing": {"Device": "0x5A01", "IEEEAddr": SW}})
    check("and its ping answers for both", f["plan"].answered, [SW, SW + "/2"])
    zb.expect_startup(SW + "/2")
    zb.expect_startup(SW)
    f["effects"].clear()
    zb.on_event({"ZbResponse": {"Device": "0x5A01", "Endpoint": 2, "Command": "0006_04", "Status": 134}})
    check("each channel's StartUpOnOff answer is its own, by its endpoint", f["effects"][0], ["save"])
    check("the second refused it", f["store"].find_device(SW + "/2")[8], 2)
end

def network_checks()
    var f = fixture()
    var store = f["store"]
    var NEW = "0x00124B0000AB0003"
    check("a Config's channels: its on/off entries, two or more and no light",
          [PanelStore.config_channels(["O01", "O02"]), PanelStore.config_channels(["O01"]), PanelStore.config_channels(["L01.5", "O02"])], [[1, 2], [], []])
    f["zb"].on_event({"ZbInfo": {"0x5A03": {"Device": "0x5A03", "IEEEAddr": NEW, "ModelId": "TS0002", "Config": ["O01", "O02"]}}})
    check("a switch of two on the network and new to the panel: not this panel's, the house's network is not its", store.channels_of(NEW), [])
    var OLD = "0x00124B0000AB0004"
    store.register_device([OLD, "Switch 9", "switch", 1, 0, 0, "TS0002", 1, 0, 0])
    f["zb"].on_event({"ZbInfo": {"0x5A04": {"Device": "0x5A04", "IEEEAddr": OLD, "ModelId": "TS0002", "Config": ["O01", "O02"]}}})
    check("one registered before channels were takes its second from the next ZbInfo", store.channels_of(OLD), [OLD, OLD + "/2"])
end

def remove_checks()
    var f = fixture()
    var store = f["store"]
    found(f)
    var r = store.remove_device(SW + "/2")
    check("Remove of a channel: the device leaves, with all its channels, and one leave", [r["ok"], r["actions"], store.channels_of(SW)],
          [true, [["leave", SW]], []])
    check("and out of the Hall", PanelStore.member_ids(store.find_zone("hall")["members"]).find(SW) == nil, true)
end

# The search drawn again as the second channel comes, on a layout whose list has a twin for a list that fits one page:
# the first channel and the two relays fit it, and the second takes the search to the list with the rail: the search draws there
# too, the new row, the first channel's name and the countdown
def redraw_checks()
    var sh = {"pages": {"plan": "home", "list": "settings", "zone": "zone", "help": "help", "detail": "lightdetail", "keyboard": "editboard"},
              "listRows": 3, "zoneRows": 2, "counters": 3, "helpLines": 5}
    var f = fixture(sh)
    var ui = f["ui"]
    found(f)
    check("the search on the list with the rail once it has four rows", [ui.top()["view"][0], ui.page], ["pair", "settings"])
    var drawn = json.dump(f["effects"])
    check("drawn again with the second channel's row, and the first's name as a switch",
          [string.find(drawn, "Switch 2") >= 0, string.find(drawn, "Switch 1") >= 0], [true, true])
    f["effects"].clear()
    ui.now_fn = / -> 5000
    var tick = ui.pair_tick()
    check("and a second of the search draws it still", size(tick) > 0, true)
end

interview_checks()
redraw_checks()
lamp_checks()
address_checks()
report_checks()
network_checks()
remove_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
