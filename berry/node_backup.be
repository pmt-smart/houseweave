# node_backup.be -- a node's configuration kept on the house's server, a panel's and a bridge's alike: what goes and how it comes back
# are the node's own (`part`: panel_backup.be, bridge_backup.be), and this is the way to the server and back, which is the upgrade's (node_ota.be).
#
# THE SERVER is the one the house's list has, paired on a panel, reached over HTTP; every request is signed with the key of the node's pair with it
# (server_link.be), and the server keeps the backup by the node's radio address, out of the folder it serves, the nine before it beside it. A node that
# meets a server it did not know (the first, or another paired) looks first: a backup of its own there is kept until a change, so a node flashed again
# finds its configuration and offers to restore it.
#
# WHEN: a change marks the configuration as not saved, and it goes at the server's round, at night, at the house's time (02:00), or when someone
# asks: the node's Back up now, or the server's Backup, for this node or for all. Nothing goes by itself during the day. The node presents itself to the
# server after a backup (ServerLink.hello).
#
# A backup is data, read back only when the owner asks, and checked first by the part: its format, its node, its version, its size. A part that says
# nothing of its changes (a bridge's) has a fingerprint of what it keeps, asked for at the round and at Back up now: one that differs from the last
# backup's is a change.
#
# THE HARDWARE SWAP: the server gives a node that replaces another the old one's backup, with "for" and this node's name, and asks
# it to restore (its restore verb, which the owner's Restore of a node's own backup is too). The part takes a backup of another name only so; restored,
# this node's configuration is not saved until its first backup, which tells the server the swap is over.
#
# THE TASMOTA SETTINGS go with every node's backup (node_settings.be), sealed under the house's key: Tasmota writes them by itself, and
# their fingerprint, the fields it changes left out, is asked for at the round and at Back up now as a bridge's is. A restore writes them last, and the
# part restarts with Restart 99, which does not save the ones in memory over them.
#
# The views never call this: they return ["backup", op] effects (panel_ui.be, node_wireless.be), and the node carries them out here.
#@ solidify:NodeBackup
class NodeBackup
    static PATH = "/api/backup"
    # the free heap a backup or a restore asks for: the backup's dump, and the request a copy of it; a look parses the backup, some 10 KB of objects
    # for the Living room's 5.7 KB (measured in the simulator)
    static HEAP_KB = 40

    var part        # what goes and how it comes back: name(), doc(), check(body), apply(b, kept), summary(b), readonly(), KEY, save(last), and fingerprint()
                    # when it says nothing of its changes
    var http        # the requests (panel_http.be)
    var link        # the house's server and the pair's key (server_link.be)
    var said        # said(): the state changed, for the view on show; or nil
    var busy        # "" or what runs: "saving", "looking", "restoring"
    var found       # the server's backup of this node, as last looked at: {"at", "from", "zones", "devices"}, or nil
    var restore_why # why the last Restore did not happen, "" when none failed
    var asked_by    # who asked for the backup on its way: "glass", "server", "round", "console"
    var changes     # how many changes since the boot: a backup is of the ones before it went
    var settings    # the node's Tasmota settings (node_settings.be)
    var then_restore # the server asked for a restore: done once its backup is looked at

    def init(part, http, link)
        self.part = part
        self.http = http
        self.link = link
        self.busy = ""
        self.restore_why = ""
        self.changes = 0
        self.settings = NodeSettings(nil)
        tasmota.add_cmd("BackupNow", / cmd, idx, payload -> self.now_cmd())
        tasmota.add_driver(self)
        if link != nil
            link.on("backup", / -> {"backup": self.now("server")})
            # the night's round: a backup when something changed since the last
            link.on("round", / -> {"backup": self.round()})
            # the server's Restore: this node's own backup, or, in a hardware swap, the one of the node it replaces
            link.on("restore", / -> {"restore": self.restore_asked()})
        end
    end

    def kept()
        import persist
        var k = persist.find(self.part.KEY, nil)
        return isinstance(k, map) ? k : {}
    end

    # written with the next save of the node's, or now, as the part writes its file: whether it was written
    def keep(k, now, last)
        import persist
        persist.setmember(self.part.KEY, k)
        return now ? self.part.save(last == true) : true
    end

    # What the views draw:
    #   server      the house's server, its name, or "" with none
    #   pending     a change with no backup, one that failed included
    #   last        the last backup this node made or restored: {"when", "at", "zones", "devices", "by", "server"}, or nil
    #   result      why the last request failed, "" when it did not
    #   busy        what runs: "", "saving", "looking", "restoring"
    #   found       the server's backup of this node: {"when", "at", "zones", "devices"}, or nil, as last looked at
    #   restore     why the last Restore did not happen, "" when none failed
    def state()
        var k = self.kept()
        var f = self.found
        var l = k.find("last")
        var s = self.link != nil ? self.link.server() : nil
        var server = s != nil ? (s.find("name", "") != "" ? str(s["name"]) : s["host"] + ":" + str(s["port"])) : ""
        return {"server": server, "pending": server != "" && k.find("dirty") == true, "result": str(k.find("result", "")),
                "last": isinstance(l, map) ? {"when": NodeBackup.when(l.find("at")), "at": l.find("at"), "zones": l.find("zones", 0),
                                              "devices": l.find("devices", 0), "by": l.find("by", "round"), "server": l.find("server", "")} : nil,
                "busy": self.busy, "restore": self.restore_why,
                "found": f != nil ? {"when": NodeBackup.when(f["at"]), "at": f["at"], "zones": f["zones"], "devices": f["devices"]} : nil}
    end

    # what the server is told of this node's backup: its last one, and whether a change has none
    def brief()
        var k = self.kept()
        var l = k.find("last")
        return {"at": isinstance(l, map) ? l.find("at") : nil, "dirty": k.find("dirty") == true}
    end

    # a moment on the glass, in the node's time: nil for none, and for a clock never set
    static def when(at)
        if at == nil || int(at) < 1000000000 return nil end
        var r = tasmota.rtc()
        return tasmota.strftime("%d/%m %H:%M", int(at) + (r["local"] - r["utc"]))
    end

    # What a view asked for (["backup", op])
    def run(op, args)
        if op == "look"  self.look()
        elif op == "now"  self.now("glass")
        elif op == "restore"  self.restore()
        end
    end

    # --- the server ----------------------------------------------------------------------

    # the house's server as [host, port], or nil
    def server()
        var s = self.link != nil ? self.link.server() : nil
        return s != nil ? [s["host"], s["port"]] : nil
    end

    # the server, as this node knew it last: another one is looked at first, for a backup of this node already there (looked). Once the network is
    # up: a server the node knows at its start is looked at when the Wi-Fi comes
    def every_second()
        if self.link == nil || !self.link.reachable() return end
        var s = self.link != nil ? self.link.server() : nil
        var id = s != nil && isinstance(s.find("key"), bytes) ? s["key"].tohex() + "@" + s["host"] + ":" + str(s["port"]) : ""
        var k = self.kept()
        if id == str(k.find("server", "")) return end
        k["server"] = id
        k["fresh"] = id != ""
        k["dirty"] = id != ""
        k["result"] = ""
        self.found = nil
        self.keep(k, true)
        if id != ""  self.look() end
        self.tell()
    end

    # --- the backups -------------------------------------------------------------------

    # A save of what the part keeps: the configuration is not saved until the round, or until someone asks
    def changed()
        self.changes += 1
        var k = self.kept()
        if k.find("server", "") == "" return end
        # a change of this node's goes over whatever the server has of it
        if k.find("dirty") != true || k.find("fresh") == true
            k["dirty"] = true
            k["fresh"] = false
            self.keep(k, false)
        end
        self.tell()
    end

    def later(ms)
        tasmota.remove_timer("node_backup")
        tasmota.set_timer(ms, / -> self.due(), "node_backup")
    end

    # the backup's time: sent, or the server looked at first when it was not yet, for a backup of this node already there
    def due()
        var k = self.kept()
        if k.find("server", "") == "" || k.find("dirty") != true return end
        if self.busy != "" || self.http.busy()
            self.later(1000)
            return
        end
        if k.find("fresh") == true
            self.look()
        else
            self.put()
        end
    end

    # the round's: a backup when something changed since the last. What it did, in the command's words
    def round()
        self.refresh()
        return self.kept().find("dirty") == true ? self.now("round") : "Up to date"
    end

    # the fingerprint of what the part keeps, or nil for a part that says its changes itself
    def fingerprint()
        import introspect
        return introspect.get(self.part, "fingerprint") != nil ? self.part.fingerprint() : nil
    end

    # a part that says nothing of its changes: what it keeps now, against the last backup's
    def refresh()
        var k = self.kept()
        if k.find("server", "") == "" || k.find("dirty") == true return end
        var fp = self.fingerprint()
        var sfp = self.settings.fingerprint(nil)
        if (fp != nil && fp != k.find("fp")) || (sfp != nil && sfp != k.find("sfp"))  self.changed() end
    end

    # A backup asked for: the glass's Back up now, the server's Backup or its round, or the console. At once, when a change has none. What it did, in
    # the command's words
    def now(by)
        self.refresh()
        var k = self.kept()
        if k.find("server", "") == "" return "No server" end
        if k.find("dirty") != true return "Up to date" end
        self.asked_by = by
        self.due()
        if self.busy != "" return self.busy == "saving" ? "Saving" : "Looking" end
        var r = str(self.kept().find("result", ""))
        return r != "" ? r : "Waiting"
    end

    # BackupNow, on the console
    def now_cmd()
        import json
        tasmota.resp_cmnd(json.dump({"BackupNow": self.now("console")}))
    end

    # The backup, to the server
    def put()
        import json
        if self.server() == nil || self.http.busy() return false end
        # a node that runs on a configuration it did not take (a newer version's, a malformed one, a restore on its way) has none of its own to say: what
        # its file keeps would go over the server's good one, the ten it holds rotating it out
        if self.part.readonly() return false end
        if tasmota.memory()["heap_free"] < NodeBackup.HEAP_KB
            self.failed("Low memory")
            return false
        end
        var b = self.part.doc()
        var st = self.settings.sealed()
        if st != nil  b["settings"] = st end
        var body = json.dump(b)
        if size(body) > PanelHttp.MAX
            # one the restore could not read back
            self.failed("Too large")
            return false
        end
        var sent = self.part.summary(b)
        sent["fp"] = self.fingerprint()
        sent["sfp"] = st != nil ? self.settings.fingerprint(nil) : nil
        var of = self.changes
        if !self.link.request(self.http, "PUT", NodeBackup.PATH, body, / code, text -> self.put_done(code, text, sent, of))
            self.failed(self.link.why_not())
            return false
        end
        self.busy = "saving"
        self.tell()
        return true
    end

    # The backup went: what changed while it was on its way is still to go
    def put_done(code, text, sent, of)
        self.busy = ""
        if code < 200 || code > 299
            self.failed(NodeBackup.reason(code, text))
            return
        end
        var k = self.kept()
        var s = self.link.server()
        k["dirty"] = of != self.changes
        k["last"] = {"at": sent["at"], "zones": sent["zones"], "devices": sent["devices"], "by": self.asked_by != nil ? self.asked_by : "round",
                     "server": s != nil ? str(s.find("name", "")) : ""}
        k["result"] = ""
        if sent.find("fp") != nil  k["fp"] = sent["fp"] end
        if sent.find("sfp") != nil  k["sfp"] = sent["sfp"] end
        self.asked_by = nil
        self.found = sent
        self.keep(k, true)
        log("BACKUP: saved on the house's server", 2)
        self.link.hello("backup")
        self.tell()
    end

    def failed(why)
        var k = self.kept()
        # the same word again changes nothing: the file is not written for it
        var same = str(k.find("result", "")) == why
        k["result"] = why
        self.asked_by = nil
        if !same  self.keep(k, true) end
        log("BACKUP: not saved - " + why, 2)
        self.tell()
    end

    static def reason(code, text)
        if code == 0 return str(text) end
        return "HTTP " + str(code)
    end

    # --- the server's backup, looked at and restored ------------------------------------

    # What the server has of this node: its backup's moment and size
    def look()
        if self.server() == nil || self.busy != "" || self.http.busy() return false end
        if tasmota.memory()["heap_free"] < NodeBackup.HEAP_KB
            self.failed("Low memory")
            return false
        end
        if !self.link.request(self.http, "GET", NodeBackup.PATH, nil, / code, body -> self.looked(code, body))
            # a server the driver makes no pair with, a clock without the time yet, or no way to the server: nothing is asked of it
            self.failed(self.link.why_not())
            return false
        end
        self.busy = "looking"
        self.tell()
        return true
    end

    def looked(code, body)
        self.busy = ""
        self.restore_why = ""
        var restoring = self.then_restore
        self.then_restore = false
        var k = self.kept()
        if code == 404
            # none there: this node's configuration has no backup
            self.found = nil
            k["dirty"] = true
        elif code == 200
            var b = self.part.check(body)
            self.found = isinstance(b, map) ? self.part.summary(b) : nil
            if !isinstance(b, map)  k["result"] = b end
            # on a server not looked at yet, a backup of this node there is kept until a change: a node flashed again offers it to restore, and its
            # factory configuration goes over it only by choice
            if k.find("fresh") == true  k["dirty"] = false end
        else
            var why = NodeBackup.reason(code, body)
            var same = str(k.find("result", "")) == why
            k["result"] = why
            if !same  self.keep(k, true) end
            self.tell()
            return
        end
        k["fresh"] = false
        if code == 404 || isinstance(self.found, map)  k["result"] = "" end
        self.keep(k, true)
        self.tell()
        # the restore the server asked for, of the backup it has
        if restoring && isinstance(self.found, map)
            self.restore()
            return
        end
        # one asked for while the server was looked at goes now
        if k.find("dirty") == true && self.asked_by != nil  self.put() end
    end

    # The server's Restore (server_link.be): the server's backup looked at again, and restored. What it did, in a word
    def restore_asked()
        if self.server() == nil return "No server" end
        if self.busy == "restoring" return "Restoring" end
        self.then_restore = true
        if !self.look()
            self.then_restore = false
            var r = str(self.kept().find("result", ""))
            return r != "" ? r : "Busy"
        end
        return "Looking"
    end

    # The owner's Restore, after the view's confirmation: the backup the screen showed, fetched again, checked, written in place of this node's, and the
    # node restarts with it
    def restore()
        if self.server() == nil || self.found == nil || self.busy != "" || self.http.busy() return false end
        if tasmota.memory()["heap_free"] < NodeBackup.HEAP_KB
            self.failed("Low memory")
            return false
        end
        var at = self.found["at"]
        if !self.link.request(self.http, "GET", NodeBackup.PATH, nil, / code, body -> self.restore_got(code, body, at)) return false end
        self.restore_why = ""
        self.busy = "restoring"
        self.tell()
        return true
    end

    def restore_got(code, body, at)
        self.busy = ""
        var b = code == 200 ? self.part.check(body) : NodeBackup.reason(code, body)
        # the one the owner confirmed, and not one written since: the screen shows the new one, to confirm again
        if isinstance(b, map) && b.find("at") != at
            self.found = self.part.summary(b)
            b = "Changed"
        end
        if !isinstance(b, map)
            self.restore_why = b
            log("BACKUP: not restored - " + b, 2)
            self.tell()
            return
        end
        var k = self.kept()
        var s = self.part.summary(b)
        var server = self.link.server()
        k["fresh"] = false
        # the backup of the node this one replaces (a hardware swap): this node's own is still the server's to have, at the next round
        k["dirty"] = b.find("for") != nil
        k["last"] = {"at": b["at"], "zones": s["zones"], "devices": s["devices"], "by": "restore", "server": server != nil ? str(server.find("name", "")) : ""}
        # the Tasmota settings it carries, opened: under a key of the house this node holds. Not opened, the rest is restored and they stay as they are
        var st = b.find("settings")
        var block = st != nil ? self.settings.opened(st) : nil
        if st != nil && !isinstance(block, bytes)
            log("BACKUP: the settings in the backup were not opened (" + str(block) + "): the rest is restored", 2)
            block = nil
        end
        # another node's (a hardware swap): this node keeps its own Zigbee network, and its devices are paired again
        if block != nil && b.find("for") != nil  block = self.settings.with_own_network(block) end
        k["last"]["settings"] = block != nil
        # sealed under a key the house no longer uses, they are backed up again at the next round
        var sfp = block != nil ? (st["kv"] == NodeSettings.version() ? self.settings.fingerprint(block) : "") : nil
        k["result"] = ""
        if !self.part.apply(b, / -> self.restored(k, block, sfp))
            self.restore_why = "Not saved"
            log("BACKUP: not restored - the file could not be written", 1)
            self.tell()
            return
        end
    end

    # the backup's state, written with what the part restored: a part's fingerprint is the restored one's, which is no change
    # and the Tasmota settings last, once the rest went: the restart the part makes, Restart 99 when they were written (which does not save the ones in
    # memory over them), or true for its own
    def restored(k, block, sfp)
        var fp = self.fingerprint()
        if fp != nil  k["fp"] = fp end
        if sfp != nil  k["sfp"] = sfp end
        if !self.keep(k, true, true) return false end
        return block != nil && self.settings.write(block) ? "Restart 99" : true
    end

    def tell()
        if self.said != nil  self.said() end
    end
end
