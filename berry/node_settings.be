# node_settings.be -- a node's Tasmota settings in its backup: the block Tasmota keeps in /.settings (4 096 bytes: the Wi-Fi with its
# password, the MQTT, the time zone, the template, the options and, on a bridge, the Zigbee network), sealed under a key the mesh driver derives from the
# house's key (espnow_mesh_group_seal): the house's server keeps it and cannot read it, and a node of the house reads it back.
#
# A RESTORE writes the block back to the file and restarts with Restart 99, which does not save the settings in memory over it: Tasmota reads the file
# first when it starts. Only a block of Tasmota's own size and header (cfg_holder, the settings of this firmware's kind) is written.
#
# IN A HARDWARE SWAP the new node keeps its own Zigbee network (NETWORK: the extended PAN, the network key, the PAN, the channel
# and the radio's power): the devices do not follow a network to another coordinator, and they are paired again; an old bridge
# that came back would otherwise form the same network as the new one.
#
# CHANGES: Tasmota writes the block by itself (the boot count at every start, the save counter and the time of each save, the checksums, the relays'
# state): the fingerprint leaves those fields out, so that a change is the owner's, and has the house key's version in it, so that a backup sealed under a
# key the house changed is made again.
#@ solidify:NodeSettings
class NodeSettings
    static FILE = "/.settings"
    static SIZE = 4096
    static LABEL = "tasmota-settings"
    # the fields Tasmota changes by itself, [offset, length] (tasmota_types.h): save_flag, bootcount, cfg_crc, power, bootcount_reset_time,
    # cfg_timestamp, cfg_crc32
    static VOLATILE = [[0x004, 4], [0x00C, 2], [0x00E, 2], [0x2E8, 4], [0xFD4, 4], [0xFF8, 4], [0xFFC, 4]]
    # the Zigbee network, [offset, length]: zb_ext_panid, zb_precfgkey_l and _h, zb_pan_id, zb_channel, zb_txradio_dbm
    static NETWORK = [0xF18, 28]

    var file    # the block's file: FILE, or a test's

    def init(file)
        self.file = file != nil ? file : NodeSettings.FILE
    end

    # whether this image seals under the house's key: the mesh driver's functions
    static def can()
        import global
        return global.contains("espnow_mesh_group_seal") && global.contains("espnow_mesh_group_open")
    end

    # the version of the house's key in use, or 0
    static def version()
        var r = tasmota.cmd("_EspNowMeshStatus", true)
        var s = isinstance(r, map) ? r.find("EspNowMeshStatus") : nil
        return isinstance(s, map) && type(s.find("GroupVersion")) == "int" ? s["GroupVersion"] : 0
    end

    # the block, or nil (no file, or not of Tasmota's size)
    def read()
        var b = nil
        try
            var f = open(self.file, "rb")
            b = f.readbytes()
            f.close()
        except .. as e, m
            return nil
        end
        return size(b) == NodeSettings.SIZE ? b : nil
    end

    # the block sealed for the backup: {"v": 1, "kv": the house key's version, "d": base64}, or nil (no block, or no key)
    def sealed()
        import global
        if !NodeSettings.can() return nil end
        var b = self.read()
        if b == nil return nil end
        var s = global.espnow_mesh_group_seal(NodeSettings.LABEL, b)
        return isinstance(s, list) ? {"v": 1, "kv": s[0], "d": s[1].tob64()} : nil
    end

    # what a block holds that the owner set: the SHA-256 of it without the fields Tasmota changes by itself, and the house key's version; nil without one
    def fingerprint(b)
        import crypto
        if b == nil  b = self.read() end
        if b == nil return nil end
        b = b.copy()
        for r: NodeSettings.VOLATILE
            for i: r[0] .. r[0] + r[1] - 1  b[i] = 0 end
        end
        var h = crypto.SHA256()
        h.update(b)
        return h.out().tohex() + ":" + str(NodeSettings.version())
    end

    # the block a backup carries, opened: the bytes, or why it is not one to write ("No key": not of a key this node holds; "Not settings")
    def opened(m)
        import global
        if !isinstance(m, map) || m.find("v") != 1 || type(m.find("kv")) != "int" || type(m.find("d")) != "string" return "Not settings" end
        if !NodeSettings.can() return "No key" end
        var b = global.espnow_mesh_group_open(NodeSettings.LABEL, m["kv"], bytes().fromb64(m["d"]))
        if !isinstance(b, bytes) return "No key" end
        if size(b) != NodeSettings.SIZE return "Not settings" end
        # Tasmota's own header, the settings of this firmware's kind
        var mine = self.read()
        if mine != nil && b[0 .. 1] != mine[0 .. 1] return "Not settings" end
        return b
    end

    # another node's block with this node's own Zigbee network (a hardware swap): nil when this node has no block of its own
    def with_own_network(b)
        var mine = self.read()
        if mine == nil return nil end
        b = b.copy()
        for i: NodeSettings.NETWORK[0] .. NodeSettings.NETWORK[0] + NodeSettings.NETWORK[1] - 1  b[i] = mine[i] end
        return b
    end

    # the block written in place of Tasmota's: whether it was, read back. The restart after it is Restart 99, which does not save over it
    def write(b)
        try
            var f = open(self.file, "wb")
            f.write(b)
            f.close()
        except .. as e, m
            log("BACKUP: the settings were not written (" + str(e) + ": " + str(m) + ")", 1)
            return false
        end
        return self.read() == b
    end
end
