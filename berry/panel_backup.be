# panel_backup.be -- what of a panel goes in its backup, and how it comes back: the panel's part of the backup, whose way to
# the house's server and back is every node's (node_backup.be).
#
# What goes (KEYS): the configuration built on the glass (the plans, the zones, the devices and their names), the texts renamed, and the preferences, all
# but the pattern: a salted SHA-256 of a pattern is found in seconds among the few hundred thousand there are. Nothing of this panel alone goes either: the
# pair's record, with the bridge's web password, and the pairing's secret, which a new panel makes again by pairing; the web password, the Wi-Fi, the MQTT.
#
# The backup is this panel's, by its radio address (name: its MAC in lower-case hex): each panel is a panel, and none receives another's.
# A panel that replaces another gets its backup through Home Assistant, at pairing, and a new one starts as new.
#
# Checked before it is restored: the format, the room, the panel, the configuration's version, the preferences' shapes. Restored, it is written in place of
# this panel's, the buttons go to the button driver (the boot reads them from it), and the panel restarts with it.
#@ solidify:PanelBackup
class PanelBackup
    static KEY = "panel_backup"     # the backup's state, node_backup.be's: {"server", "fresh", "dirty", "last", "result"}
    static KEYS = ["panel_config", "panel_texts", "panel_prefs"]
    static FORMAT = 1
    # the projects' names in the firmware before HouseWeave's, which a panel flashed with it keeps in its file system through an OTA: a backup under
    # either name is the same room's
    static FORMER = {"p1-living-room-eu-landscape": "p1-casa-sala-eu-landscape", "p1-living-room-us-portrait": "p1-casa-sala-us-portrait"}

    var project     # the project this panel runs: the room a backup is for
    var store       # the configuration (panel_store.be), kept from saving over a restore, or nil

    def init(project, store)
        self.project = project
        self.store = store
    end

    # this panel's name on the server: its MAC in lower-case hex
    static def name()
        import string
        return string.tolower(string.tr(PanelBackup.mac(), ":", ""))
    end

    static def mac() return str(tasmota.wifi().find("mac", "")) end

    # whether two projects are one room: the same name, or one the other's former name
    static def same_room(a, b)
        return a == b || (type(a) == "string" && type(b) == "string" && (PanelBackup.FORMER.find(a) == b || PanelBackup.FORMER.find(b) == a))
    end

    # whether this panel runs on a configuration it did not take (a newer version's, a malformed one, a restore on its way): it has none of its own to say
    def readonly() return self.store != nil && self.store.readonly end

    # the file written, as every site of the panel writes it (PanelStore.safe_save, which waits for heap, or does not with `last`): whether it was
    def save(last) return PanelStore.safe_save(last ? PanelStore.SAVE_TRIES : 0) end

    # The backup: what KEYS hold, the pattern taken out
    def doc()
        import persist
        var keys = {}
        for key: PanelBackup.KEYS
            var v = persist.find(key, nil)
            if v != nil  keys[key] = v end
        end
        var prefs = keys.find("panel_prefs")
        if isinstance(prefs, map)
            var p = {}
            for f: prefs.keys()
                if f != "pattern"  p[f] = prefs[f] end
            end
            keys["panel_prefs"] = p
        end
        return {"v": PanelBackup.FORMAT, "panel": PanelBackup.name(), "project": self.project, "from": PanelBackup.mac(),
                "at": tasmota.rtc()["utc"], "keys": keys}
    end

    # A backup as the server gave it: the map, or why it is not one to restore
    def check(body)
        import json
        var b = json.load(str(body))
        if !isinstance(b, map) || b.find("v") != PanelBackup.FORMAT || !isinstance(b.find("keys"), map) return "Not a backup" end
        # another panel's only in a hardware swap, for this one by name
        if b.find("panel") != PanelBackup.name() && b.find("for") != PanelBackup.name() return "Another panel's" end
        if !PanelBackup.same_room(b.find("project"), self.project) return "Another room's" end
        for key: b["keys"].keys()
            if PanelBackup.KEYS.find(key) == nil || !isinstance(b["keys"][key], map) return "Not a backup" end
        end
        var c = b["keys"].find("panel_config")
        if c != nil
            if !PanelStore.readable(c) return "Newer version" end
            # one the store could not run is not written over a good one: it would be dead at every boot
            if PanelStore.vet(c)[0] != nil return "Damaged" end
        end
        if !PanelBackup.prefs_ok(b["keys"].find("panel_prefs")) return "Damaged" end
        return b
    end

    # The backup written in place of this panel's: `kept()` writes the backup's state with it, and only when that went is there a restart to go through (a file
    # that did not take the backup is not a restore). Whether it went
    def apply(b, kept)
        import persist
        import string
        var keys = b["keys"]
        # this panel's pattern stays: the backup has none
        var prefs = keys.find("panel_prefs")
        if isinstance(prefs, map)
            var mine = persist.find("panel_prefs", nil)
            prefs["pattern"] = isinstance(mine, map) ? mine.find("pattern", []) : []
        end
        # the configuration in memory is the old one: nothing saves it over this, and it stays so when the write below fails
        if self.store != nil  self.store.readonly = true end
        for key: keys.keys()  persist.setmember(key, keys[key]) end
        var restart = kept()
        if !restart return false end
        # the buttons are the button driver's, and the boot reads them back from it (Brain.sync_buttons): the backup's go to the driver before the
        # restart, or a new panel's would be its factory ones again
        var buttons = isinstance(prefs, map) ? prefs.find("buttons") : nil
        if isinstance(buttons, list)
            tasmota.cmd("ButtonDecoupleEnable 1")
            for i: 0 .. size(buttons) - 1
                tasmota.cmd(string.format("ButtonDecouple%d %d", i + 1, buttons[i] == "panel" ? 1 : 0))
            end
        end
        log("BACKUP: restored the backup of " + str(NodeBackup.when(b["at"])) + ": the panel restarts", 2)
        # Restart 99 when the Tasmota settings were written (node_backup.be): Restart 1 would save the ones in memory over them
        tasmota.cmd(type(restart) == "string" ? restart : "Restart 1")
        return true
    end

    # The preferences a backup carries, as the ones the panel keeps are shaped: each field absent, or of the type the boot reads it as. What the panel reads
    # with its own checks (the screensaver's times, the alarm's sounds) is not asked twice
    static def prefs_ok(p)
        if p == nil return true end
        for f: ["editing", "live_slider_update"]
            if p.find(f) != nil && type(p[f]) != "bool" return false end
        end
        for f: ["clock", "flags"]
            if p.find(f) != nil && !isinstance(p[f], map) return false end
        end
        for f: ["keyboard_kind", "alarm_sounds"]
            if p.find(f) != nil && type(p[f]) != "string" return false end
        end
        var buttons = p.find("buttons")
        if buttons != nil
            if !isinstance(buttons, list) || size(buttons) != 2 return false end
            for x: buttons
                if x != "relay" && x != "panel" return false end
            end
        end
        var saver = p.find("screensaver")
        if saver != nil
            if !isinstance(saver, list) || size(saver) != 2 || type(saver[0]) != "int" || type(saver[1]) != "int" return false end
        end
        var pattern = p.find("pattern")
        return pattern == nil || isinstance(pattern, list)
    end

    # what a backup carries, as the screens say it
    def summary(b)
        var c = b["keys"].find("panel_config", {})
        var zones = c.find("zones")
        var devices = c.find("devices")
        return {"at": b.find("at"), "from": b.find("from"), "zones": isinstance(zones, list) ? size(zones) : 0,
                "devices": isinstance(devices, list) ? size(devices) : 0}
    end

    # A topic of this panel's, as Tasmota's FullTopic makes one: its prefix (Prefix1 for commands, Prefix3 for telemetry), and what comes after it (the
    # schedule's word on the house's MQTT, panel_schedule_mqtt.be)
    static def own_topic(prefix, rest)
        import string
        var t = PanelBackup.answer("Topic")
        var f = PanelBackup.answer("FullTopic")
        var p = PanelBackup.answer(prefix)
        if t == nil || f == nil || p == nil return nil end
        f = string.replace(string.replace(f, "%prefix%", p), "%topic%", t)
        if string.find(f, "%hostname%") >= 0  f = string.replace(f, "%hostname%", tasmota.hostname()) end
        if string.find(f, "%id%") >= 0  f = string.replace(f, "%id%", string.tr(PanelBackup.mac(), ":", "")) end
        return f + rest
    end

    # a setting as a command answers it, or nil
    static def answer(c)
        var r = tasmota.cmd(c)
        return isinstance(r, map) && r.find(c) != nil ? str(r[c]) : nil
    end
end
