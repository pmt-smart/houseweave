# bridge_backup.be -- what of a bridge goes in its backup, and how it comes back: the bridge's part of the backup, whose way to the
# house's server and back is every node's (node_backup.be).
#
# What goes (KEYS): the names the panels gave its devices, the alarm's configuration, which driver each device runs and the drivers it was given, and the
# discovery's word to Home Assistant; for the same bridge, written again after a flash of its firmware. Not its Zigbee network: a bridge flashed again
# forms its network again, and its devices are paired again. Not the house's key, which a node takes when it joins.
#
# The bridge says nothing when one of them changes: the backup's engine asks for the FINGERPRINT of what they hold (the SHA-256 of their JSON) at the
# round and at Back up now, and one that differs from the last backup's is a change.
#@ solidify:BridgeBackup
class BridgeBackup
    static KEY = "bridge_backup"    # the backup's state, node_backup.be's
    static KEYS = ["zb_relay_names", "zb_alarm_cfg", "zb_relay_drivers", "zb_relay_assigned", "zb_relay_discovery", "zb_relay_expire"]
    static FORMAT = 1

    # this bridge's name on the server: its MAC in lower-case hex
    static def name()
        import string
        return string.tolower(string.tr(str(tasmota.wifi().find("mac", "")), ":", ""))
    end

    def readonly() return false end

    def save(last)
        import persist
        persist.save()
        return true
    end

    # what KEYS hold
    static def held()
        import persist
        var keys = {}
        for key: BridgeBackup.KEYS
            var v = persist.find(key, nil)
            if v != nil  keys[key] = v end
        end
        return keys
    end

    # The backup
    def doc()
        return {"v": BridgeBackup.FORMAT, "bridge": BridgeBackup.name(), "from": str(tasmota.wifi().find("mac", "")), "at": tasmota.rtc()["utc"],
                "keys": BridgeBackup.held()}
    end

    # what KEYS hold, as a fingerprint: the SHA-256 of their JSON, key by key in KEYS' order
    def fingerprint()
        import json
        import crypto
        var h = crypto.SHA256()
        var keys = BridgeBackup.held()
        for key: BridgeBackup.KEYS
            h.update(bytes().fromstring(key + "=" + json.dump(keys.find(key)) + ";"))
        end
        return h.out().tohex()
    end

    # A backup as the server gave it: the map, or why it is not one to restore
    def check(body)
        import json
        var b = json.load(str(body))
        if !isinstance(b, map) || b.find("v") != BridgeBackup.FORMAT || !isinstance(b.find("keys"), map) return "Not a backup" end
        # another bridge's only in a hardware swap, for this one by name
        if b.find("bridge") != BridgeBackup.name() && b.find("for") != BridgeBackup.name() return "Another bridge's" end
        for key: b["keys"].keys()
            if BridgeBackup.KEYS.find(key) == nil return "Not a backup" end
        end
        return b
    end

    # The backup written in place of this bridge's, with the backup's state (`kept()`), and the bridge restarts with it: what KEYS hold is the backup's
    # whole, and one the backup has not is one the bridge had not then. Whether it went
    def apply(b, kept)
        import persist
        for key: BridgeBackup.KEYS
            if b["keys"].contains(key)
                persist.setmember(key, b["keys"][key])
            elif persist.find(key, nil) != nil
                persist.remove(key)
            end
        end
        var restart = kept()
        if !restart return false end
        log("BACKUP: restored the backup of " + str(NodeBackup.when(b["at"])) + ": the bridge restarts", 2)
        # Restart 99 when the Tasmota settings were written (node_backup.be): Restart 1 would save the ones in memory over them
        tasmota.cmd(type(restart) == "string" ? restart : "Restart 1")
        return true
    end

    # what a backup carries, as the screens say it: the devices it named
    def summary(b)
        var n = b["keys"].find("zb_relay_names")
        return {"at": b.find("at"), "from": b.find("from"), "zones": 0, "devices": isinstance(n, map) ? size(n) : 0}
    end
end
