# zbbridge_autoexec.be -- the ZBBridge Pro's autoexec.be (the bridge's firmware
# image puts it in place under that name, firmware/overrides/bridge_files.py;
# uploaded by hand, rename it). NEVER use on the NSPanel -- there, autoexec.be
# is the file at the repo root.
#
# The relay is compiled into the bridge's firmware:
# ZbBridgeRelay, ZbBridgeRelayPairing,
# ZbBridgeDiscovery, ZbBridgeDrivers and ZbDriverThermostat, ZbDriverCover, ZbDriverTwoKey, ZbBridgeAlarm, ZbAlarmMerge (the alarm replica's rule), ZbAlarmMesh (the replica on the mesh, which ZbBridgeAlarm builds once the mesh runs and the bridge has an alarm number), PairSign and ClockLink, one class a file in berry/. This only starts it -- which it has to,
# at every boot: without it, every restart of the ZBBridge Pro (and it restarts
# on its own now and then -- RestartReason "Software reset CPU" without any
# command from us) silently takes the relay down, local Zigbee
# working and the NSPanel hearing nothing of the bulbs.
#
# A class of the relay can be replaced before the next firmware by its file,
# uploaded to the file system: loaded here, above the start, it takes the
# firmware's place, as a panel's does. A firmware without the
# relay compiled in (the NSPanel's image, or an older one) runs it
# from the eight files. The order is the one their names need: PairSign and ClockLink, then
# the two drivers, the discovery, the drivers' host, the thermostats' and the blinds' drivers, then the relay,
# which names them.
#
# A file there wins over the firmware: a bridge updated by OTA keeps running the class of a file left on
# its file system, and nothing else says so. Each file the loader runs is said by its name, at level 1, the one
# the console shows at every log setting.
#
# Discard this file (and the relay's) from the ZBBridge Pro once the CC2652P is
# soldered into the NSPanel and the mode becomes `ZbBridgeMode local`.

import global
import path

for f: ["panel_build.be", "pair_sign.be", "clock_link.be", "zbbridge_relay_pairing.be", "zbbridge_discovery.be", "zbbridge_drivers.be", "zbdriver_thermostat.be", "zbdriver_cover.be", "zbdriver_twokey.be", "mesh_beat.be", "mesh_events.be", "zbbridge_alarm_merge.be", "zbbridge_alarm_mesh.be", "zbbridge_alarm.be", "mesh_cmd.be", "house_list.be", "house_key.be", "house_state.be", "house_devices.be", "house_link.be", "house_channel.be", "house_mesh.be", "house_commands.be", "house_mqtt.be", "house_alarm.be", "panel_wifi.be", "panel_http.be", "node_ota.be", "node_wireless.be", "server_link.be", "mesh_http.be", "node_settings.be", "node_backup.be", "bridge_backup.be", "zbbridge_relay.be"]
    if path.exists(f)
        load(f)
        log("ZBBRIDGE_RELAY: " + f + " runs from the file system, over the firmware's", 1)
    end
end
if global.contains("ZbBridgeRelay")
    global.ZbBridgeRelay.start()
else
    log("ZBBRIDGE_RELAY: not in this firmware, and not in the file system: nothing relays to the NSPanel", 1)
end
