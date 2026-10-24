# berry/panel_boot.be, the panel's boot, over stand-ins of every piece it
# builds (stub_boot.be): the order the pieces need each other in, what it keeps
# of the network at every boot, and what a project that cannot be read leaves
# running. The real pieces boot together in the simulator's end-to-end tests
# (libs/nspanel-sim/vm/test/panel.test.mjs).

# the commands the boot sends, and what a freshly flashed panel answers them
class BootTasmota : TasmotaStub
    var cmds, rules, drivers, ethernet
    def init() self.cmds = [] self.rules = [] self.drivers = [] self.ethernet = "ON" end
    def cmd(c)
        self.cmds.push(c)
        if c == "Ethernet" return {"Ethernet": self.ethernet} end
        return nil
    end
    def add_rule(trigger, f) self.rules.push(trigger) end
    def add_driver(d) self.drivers.push(d) end
end
tasmota = BootTasmota()

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
def count(items, item)
    var n = 0
    for x: items if x == item n += 1 end end
    return n
end

def boot_checks()

# --- the pair of an older image: its bridge's devices by its number, the bridge the favourite, and the record gone ---------------
def unpair_checks()
    import persist
    class UnpairHouse
        var fav, numbered
        def init() self.fav = 0 self.numbered = {"B0:B0:B0:00:00:01": 6} end
        def number_of(mac, role) return self.numbered.find(mac, 0) end
        def favorite() return self.fav end
        def set_favorite(id) self.fav = id return true end
    end
    class UnpairStore
        var adopted
        def adopt_owner(n) self.adopted = n return true end
    end
    var h = UnpairHouse()
    var s = UnpairStore()
    tasmota.cmds.clear()
    check("no pair of before: nothing", PanelBoot.unpair(h, s), false)
    persist.store["zb_bridge_peer"] = {"mac": "B0:B0:B0:00:00:09"}
    check("a pair with a bridge the house does not have yet: kept, for when it has it", [PanelBoot.unpair(h, s), persist.store.contains("zb_bridge_peer")], [false, true])
    persist.store["zb_bridge_peer"] = {"mac": "B0:B0:B0:00:00:01"}
    persist.store["zb_bridge_mode"] = "direct"
    check("its bridge in the house: its devices by its number, and it the favourite", [PanelBoot.unpair(h, s), s.adopted, h.fav], [true, 6, 6])
    check("and the record gone, here and in the driver", [persist.store.contains("zb_bridge_peer"), persist.store.contains("zb_bridge_mode"), tasmota.cmds],
          [false, false, ["EspNowPeerMac 00:00:00:00:00:00", "EspNowSecret2 0"]])
    h.fav = 3
    persist.store["zb_bridge_peer"] = {"mac": "B0:B0:B0:00:00:01"}
    PanelBoot.unpair(h, s)
    check("a favourite chosen already stays", h.fav, 3)
end
unpair_checks()
    import global
    # --- joBr99's stack: no project named ------------------------------------
    var boot = PanelBoot.start(nil)
    check("every piece is built, in the order they need each other", BUILT, ["Nextion", "ZigbeeBridge", "ZigbeePairing", "Light", "Home", "Brain"])
    check("the display's driver is where the console finds it", classname(global.nextion), "Nextion")
    check("and joBr99's TFT reads it in Protocol Reparse", global.nextion.reparse, true)
    check("the test bulb is joBr99's stack's", boot.light.added, ["L1"])
    check("brain is one of Tasmota's drivers", size(tasmota.drivers), 1)
    check("the bulbs are pinged when a relay moves", tasmota.rules, ["Power1#state", "Power2#state"])
    # `Ethernet` restarts the device whenever it is given a value, the same one
    # included (xdrv_82_esp32_ethernet.ino, CmndEthernet): sent at every boot it
    # would be a restart at every boot. A freshly flashed panel has it on, and
    # the boot turns it off once, because it was on.
    check("Ethernet 0 once, because the panel said ON", count(tasmota.cmds, "Ethernet 0"), 1)
    check("the web server back on", tasmota.cmds.find("WebServer 2") != nil, true)
    # no project here, so joBr99's stack: the buttons are the driver's all the same
    check("the button driver takes the buttons without a project", tasmota.cmds.find("ButtonDecoupleEnable 1") != nil, true)
    check("and quick power cycles keep the configuration", tasmota.cmds.find("SetOption65 1") != nil, true)
    # the next boot: Ethernet is off, and it is not given a value again
    tasmota.ethernet = "OFF"
    tasmota.cmds.clear()
    PanelBoot.keep_network()
    check("no Ethernet 0 when it is off already", tasmota.cmds.find("Ethernet 0"), nil)
    check("and the web server still asserted", tasmota.cmds.find("WebServer 2") != nil, true)

    # --- a project whose file cannot be read ----------------------------------
    # The panel stays on the network, on joBr99's stack, which draws nothing on
    # our .tft; the log says why (PanelRuntime's own raise).
    BUILT.clear()
    tasmota.rules.clear()
    tasmota.drivers.clear()
    boot = PanelBoot.start("p1-no-such-project")
    check("a project that cannot be read is no panel of ours", [boot.panel, global.panel], [nil, nil])
    check("and brain still comes up", BUILT[-1], "Brain")
    check("without any of our pages", tasmota.drivers[0].given, [nil, nil, nil, nil])
    check("the display's driver is out of Protocol Reparse all the same: the glass has our .tft", global.nextion.reparse, false)
    check("and there is no test bulb", boot.light.added, [])

    # --- the house's layer: made where the image has the mesh driver, and only there --------------
    check("an image without the mesh driver has no house layer, and sends nothing over the mesh", [boot.house, boot.mesh_cmd], [nil, nil])
    HouseMesh.present = true
    MeshCmd.present = true
    BUILT.clear()
    tasmota.rules.clear()
    tasmota.drivers.clear()
    boot = PanelBoot.start(nil)
    check("an image with it makes the house's layer, of a panel", [classname(boot.house), boot.house.role], ["HouseMesh", HouseList.ROLE_PANEL])
    check("and the views find it in global.house", global.house == boot.house, true)
    check("and it sends to the bridges of other rooms over the mesh", classname(boot.mesh_cmd), "MeshCmd")
    HouseMesh.present = false
    MeshCmd.present = false
end
boot_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
