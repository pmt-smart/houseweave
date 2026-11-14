# keys_backup.be -- what of a node with no screen goes in its backup, and how it comes back: the part of the backup of a node whose configuration
# is what persist keeps under some keys, a bridge's and an appliance's alike. The way to the house's server and back is every node's
# (node_backup.be).
#
# What goes is the node's to say, as it makes its part (init): the word of its kind, which is the field of the backup that names the node and
# what the server takes the backup's kind by ("bridge", "device"); the keys; and, of them, the one whose entries are the devices the screens
# count, or none for a node that is one device. For the same node, written again after a flash of its firmware. Not the house's key, which a
# node takes when it joins.
#
# The node says nothing when one of them changes: the backup's engine asks for the FINGERPRINT of what they hold (the SHA-256 of their JSON) at the
# round and at Back up now, and one that differs from the last backup's is a change.
#@ solidify:KeysBackup
class KeysBackup
    static FORMAT = 1

    var KEY        # where persist keeps the backup's state, node_backup.be's: the kind's word and "_backup"
    var kind       # the word of the node's kind
    var keys       # the persist keys that go
    var counted    # the key whose entries are the devices the screens count, or nil for a node that is one device

    def init(kind, keys, counted)
        self.kind = kind
        self.keys = keys
        self.counted = counted
        self.KEY = kind + "_backup"
    end

    # this node's name on the server: its MAC in lower-case hex
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

    # what the keys hold
    def held()
        import persist
        var out = {}
        for key: self.keys
            var v = persist.find(key, nil)
            if v != nil  out[key] = v end
        end
        return out
    end

    # The backup
    def doc()
        var d = {"v": KeysBackup.FORMAT, "from": str(tasmota.wifi().find("mac", "")), "at": tasmota.rtc()["utc"], "keys": self.held()}
        d[self.kind] = KeysBackup.name()
        return d
    end

    # what the keys hold, as a fingerprint: the SHA-256 of their JSON, key by key in the keys' order
    def fingerprint()
        import json
        import crypto
        var h = crypto.SHA256()
        var out = self.held()
        for key: self.keys
            h.update(bytes().fromstring(key + "=" + json.dump(out.find(key)) + ";"))
        end
        return h.out().tohex()
    end

    # A backup as the server gave it: the map, or why it is not one to restore
    def check(body)
        import json
        var b = json.load(str(body))
        if !isinstance(b, map) || b.find("v") != KeysBackup.FORMAT || !isinstance(b.find("keys"), map) return "Not a backup" end
        # another node's only in a hardware swap, for this one by name; one of another kind names no node under this kind's word
        if b.find(self.kind) != KeysBackup.name() && b.find("for") != KeysBackup.name() return "Another " + self.kind + "'s" end
        for key: b["keys"].keys()
            if self.keys.find(key) == nil return "Not a backup" end
        end
        return b
    end

    # The backup written in place of this node's, with the backup's state (`kept()`), and the node restarts with it: what the keys hold is the
    # backup's whole, and one the backup has not is one the node had not then. Whether it went
    def apply(b, kept)
        import persist
        for key: self.keys
            if b["keys"].contains(key)
                persist.setmember(key, b["keys"][key])
            elif persist.find(key, nil) != nil
                persist.remove(key)
            end
        end
        var restart = kept()
        if !restart return false end
        log("BACKUP: restored the backup of " + str(NodeBackup.when(b["at"])) + ": the " + self.kind + " restarts", 2)
        # Restart 99 when the Tasmota settings were written (node_backup.be): Restart 1 would save the ones in memory over them
        tasmota.cmd(type(restart) == "string" ? restart : "Restart 1")
        return true
    end

    # what a backup carries, as the screens say it: the devices it has, the entries of the key that counts them, or the one the node is
    def summary(b)
        var n = self.counted != nil ? b["keys"].find(self.counted) : nil
        return {"at": b.find("at"), "from": b.find("from"), "zones": 0, "devices": self.counted == nil ? 1 : (isinstance(n, map) ? size(n) : 0)}
    end
end
