# The brain's classes, standing in for the ones berry/panel_boot.be builds and
# wires, each noting that it was built. What test_panel_boot.be holds is the
# boot's own part -- the order, what it keeps of the network, what a project
# that cannot be read leaves running -- and each piece has its own test.

var BUILT = []   # what the boot built, by class, in order

class Nextion
    var reparse
    def init() self.reparse = true end
    static def start() BUILT.push("Nextion") return Nextion() end
    def sendnx(s) end
    def assume_ready() end
end

class ZigbeeBridge
    static MODE_OFF = "off"
    static MODE_DIRECT = "direct"
    var mode, on_change
    def init() BUILT.push("ZigbeeBridge") self.mode = "off" end
    def send(c) end
    def listen(f) end
    def on_link(f) end
end

class ZigbeePairing
    var on_change, on_wiped
    def init(bridge) BUILT.push("ZigbeePairing") end
end

class Light
    var added
    def init(nx, zb) BUILT.push("Light") self.added = [] end
    def add(id, address, name) self.added.push(id) end
    def ping_all() end
end

class Home
    def init(nx, light) BUILT.push("Home") end
end

class Brain
    var given
    var build   # which build it is, as the boot hands it (panel_build.be)
    var wifi    # the Wi-Fi Wireless settings asks for (panel_wifi.be), nil without our pages
    var zigbee_ctl   # the Zigbee's (zigbee_pairing.be), nil without our pages
    var mqtt_ctl     # the MQTT's (panel_mqtt.be), nil without our pages
    var backup_ctl   # the backup's (panel_backup.be), nil without our pages
    var clock        # the panel's own clock (panel_clock.be), nil without our pages
    var schedule     # the house's schedule (panel_schedule.be), nil without our pages
    def backup_said() end
    def init(nx, light, home, panel, plan, ui, commands) BUILT.push("Brain") self.given = [panel, plan, ui, commands] end
    def attach_zigbee(z) end
    def sync_buttons() end
    def first_boot() end
    def run(effects) end
    def refresh_views() end
    def expect_screen(project, dir) end
end

# a project whose file is not on the panel, as open() says it on the device
class PanelRuntime
    def init(send, project) raise "io_error", "cannot open file '/" + project + ".jsonl'" end
end

# named by the boot and never built here: no project gets past its tables
class PanelStore end
class PanelPlanCommands end
class PanelClock end
class PanelSchedule end
class PanelCalendarDraw end
class PanelScheduleView end
class PanelScheduleMqtt end
class MeshBeat end
class PanelRoute end
class PanelGate end
# the sender's half of the commands over the mesh, made where the image has the driver
class MeshCmd
    static present = false
    static def here() return MeshCmd.present end
    def init(host) end
end
class HouseKey end
class HouseState end
class HouseDevices end
class HouseLink end
class HouseCommands
    def init(host) end
end
class HouseMqtt
    def init(host, apply) end
end
class HouseAlarm
    def init(host, apply) end
end
# the panel's rules, taken by one: here, Tasmota's own
class PanelRules
    static def start() end
    static def of() return tasmota end
end
class PanelRemoteView end
class PanelHouseView end
class NodeOta end
class HouseServer end
# the house's layer: made by the boot where the image has the mesh driver (here()), which a test says
class HouseList
    static ROLE_BRIDGE = 1
    static ROLE_PANEL = 2
end
class HouseMesh
    static present = false
    var role, mqtt, alarm, hold, on_change, view_fn, on_view
    static def here() return HouseMesh.present end
    def init(role) self.role = role end
end
class PanelUi end
class PanelTapView end
class PanelAddView end
class PanelDriverView end
class PanelPlanView end
class PanelZigbee end
class PanelThermostat end
class PanelCover end
class PanelThermostatSettings end
class PanelThermostatView end
class PanelCoverView end
class PanelPageButtons end
class PanelLampSettings end
class PanelAlarm end
class PanelAlarmDraw end
class PanelAlarmCanvas end
class PanelAlarmView end
class PanelWifi end
class PanelMqtt end
class PanelHttp end
class PanelNames end
class PanelBackup end
class ServerLink end
class MeshHttp end
class NodeSettings end
class NodeBackup end
class PanelWeb end
