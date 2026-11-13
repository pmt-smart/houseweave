# appliance_autoexec.be -- an appliance's autoexec.be (the appliance's firmware image puts it in place under that name,
# firmware/overrides/appliance_files.py; uploaded by hand, rename it). NEVER use on the NSPanel -- there, autoexec.be is the file at the
# repo root -- nor on a bridge, whose own is zbbridge_autoexec.be.
#
# The node is compiled into the appliance's firmware: ApplianceNode, the device it is (BoilerThermostat, with BoilerHistory), NodeHost (the house's
# part of a node with no screen, which the node hands over to), NodePairing (how such a node enters the house), PairSign, ClockLink and the house's
# layer, one class a file in berry/. This only starts it -- which it has to, at every boot: without it nothing switches the appliance, and no panel
# hears of it.
#
# A class of the node can be replaced before the next firmware by its file, uploaded to the file system: loaded here, above the start, it takes
# the firmware's place, as a bridge's does. The order is the one their names need: the build's stamp, PairSign and ClockLink, then NodeHost and
# NodePairing, the house's layer, the device's classes, then the node, which names them.
#
# A file there wins over the firmware: an appliance updated by OTA keeps running the class of a file left on its file system, and nothing else
# says so. Each file the loader runs is said by its name, at level 1, the one the console shows at every log setting.

import global
import path

for f: ["panel_build.be", "pair_sign.be", "clock_link.be", "node_host.be", "node_pairing.be", "mesh_beat.be", "mesh_events.be", "mesh_cmd.be", "house_list.be", "house_key.be", "house_state.be", "house_devices.be", "house_link.be", "house_channel.be", "house_mesh.be", "house_commands.be", "house_mqtt.be", "panel_wifi.be", "panel_http.be", "node_ota.be", "node_wireless.be", "server_link.be", "mesh_http.be", "node_settings.be", "node_backup.be", "boiler_history.be", "boiler_thermostat.be", "appliance_node.be"]
    if path.exists(f)
        load(f)
        log("APPLIANCE: " + f + " runs from the file system, over the firmware's", 1)
    end
end
if global.contains("ApplianceNode")
    global.ApplianceNode.start()
else
    log("APPLIANCE: not in this firmware, and not in the file system: nothing switches the appliance", 1)
end
