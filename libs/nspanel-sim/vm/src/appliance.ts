// An appliance: a node of the house that is itself one device of it (berry/appliance_node.be), with no Zigbee network and no screen. Its image carries
// the house's part of a node with no screen, as the bridge's does, with neither the Zigbee side nor the alarm, and its own device.

/** The appliance's Berry, in the order its files have to load: a file comes after the ones it names. */
export const APPLIANCE_FILES = ["panel_build.be", "pair_sign.be", "clock_link.be", "node_host.be", "node_pairing.be", "mesh_beat.be", "mesh_events.be", "mesh_cmd.be", "house_list.be", "house_key.be", "house_state.be", "house_devices.be", "house_link.be", "house_channel.be", "house_mesh.be", "house_commands.be", "house_mqtt.be", "panel_wifi.be", "panel_http.be", "node_ota.be", "node_wireless.be", "server_link.be", "mesh_http.be", "node_settings.be", "node_backup.be", "boiler_history.be", "boiler_thermostat.be", "appliance_node.be"] as const;
