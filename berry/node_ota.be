# node_ota.be -- a node's OTA, the row of its Wireless settings on any panel of the house, for a panel and for a bridge alike: the house's server
# (the one the list has, paired on a panel), what this node runs, and the release the server has for it, with its upgrade.
#
# The server keeps the releases in its folder under /ota (scripts/ota-release.mjs, publish): index.json says, for each image (the build's env, PanelBuild.IMAGE),
# the build it has ("a91d8b13/319cddad", as PanelBuild.COMMIT says one), its date, its size and the folder of the release, and the safeboot image's file. This
# node looks at it as its OTA screen opens (again when what it saw is older than LOOK_MS) and on a touch.
#
# The upgrade goes through the node's own safeboot image, over HTTP: the app writes the safeboot image the server signed unless the partition holds it, and
# restarts into it with the release's address (xdrv_98_7, EspNowOtaUpgrade, which checks the release's signature first); the safeboot image fetches the release,
# checks it, writes it and boots it (xdrv_98_5). A node that the release does not reach over its Wi-Fi waits there for a neighbour over the mesh. The
# server asks for it too (server_link.be, the verb "upgrade"): what it has is looked at again, and the upgrade goes when it is another build.
#
# THROUGH A NEIGHBOUR (the case 3): the server's Upgrade reaches a node out of its reach through another node (server_link.be's relay), and
# the node's own look at the index fails for the network. The node asks a neighbour it hears on the radio, one on a Wi-Fi access point, the best
# signal first (HouseMesh.wifi_neighbours), for its release (HouseMesh.MSG_OTA_ASK: its image and its build). The neighbour looks at the index for
# that image: a newer build, and it says so (MSG_OTA_GO) and keeps the node to send to; none, or no index, and it says why (MSG_OTA_NO), and the node
# asks the next one. Told GO, the node restarts into its safeboot image to take the image over ESP-NOW (EspNowOtaArm, which goes only into a safeboot
# image known to take one, and whose receiver gives the node back to its app when nobody sends in 10 min). The neighbour sends (EspNowOtaSend) when it
# hears the node there, waiting, again SEND_AGAIN_MS after a send that ended, for SEND_MS; the image is signed, and the safeboot image checks it.
#
# A NODE ITS SAFEBOOT IMAGE LEFT WAITING: a release that the safeboot image could not fetch over its Wi-Fi, 10 times in a row, is given up,
# and the image already begun waits for the mesh. A neighbour on a Wi-Fi access point that hears it there, with an image under way (its SHA-256 prefix,
# HouseMesh.safeboot) that has not moved for STUCK_MS, and RANK_MS more for each dB of its signal below 0, so that the one that hears it best goes
# first, looks for the release with that image in the index and sends it; one whose node moves again does not start. A node looked for is not again
# before RESCUE_AGAIN_MS, or INDEX_AGAIN_MS after an index that could not be read. Two neighbours that start together are only airtime spent: the
# receiver takes a piece once, whoever sends it.
#@ solidify:NodeOta
class NodeOta
    static INDEX = "/ota/index.json"
    static FOLDER = "/ota/"
    static LOOK_MS = 300000
    static UPGRADE_MS = 300
    static ASK_MS = 15000         # a neighbour asked for this node's release that does not answer in this long: the next one
    static SEND_MS = 540000       # the node a neighbour sends to, kept this long: less than the 10 min its safeboot image waits
    static SEND_AGAIN_MS = 30000  # and a send that ended, tried again after this long while the node waits
    static STUCK_MS = 90000       # a node in its safeboot image whose image has not moved this long: past the ~70 s its fetches take to give up
    static RANK_MS = 1000         # and this much more for each dB of the signal it is heard with below 0: 5 dB apart, 5 s apart
    static RESCUE_AGAIN_MS = 300000  # a node looked for after it stalled, not again before this
    static INDEX_AGAIN_MS = 30000    # or this, after an index that could not be read

    var http        # the HTTP client (panel_http.be), its own
    var server_fn   # -> the house's server {"host", "port", "name"}, or nil (HouseMesh.server)
    var changed     # called when what the screen says changes, or nil
    var seen        # what the server has for this image, as last looked at: {"build", "date", "size", "path", "safeboot"}; {} for none; nil before a look
    var seen_at     # when it was looked at
    var busy        # "looking", "upgrading", or ""
    var result      # why the last look or upgrade did not go, or ""
    var then_upgrade # the server asked for the upgrade: after the look, to what it has when it is another build
    var house_fn    # -> the house (HouseMesh), for the upgrade through a neighbour, or nil
    var helpers     # the neighbours on the Wi-Fi still to ask for this node's release
    var asked       # [the neighbour asked, millis], while its answer is waited for, or nil
    var sending     # a neighbour's: {"node", "url", "until", "at": millis of the last send started, "seen", "stuck"}, the node it sends its release to, or nil
    var tried       # node -> millis: not before then, a node this one looked for a release for, after it stalled in its safeboot image
    var rescuing    # the index looked at for a node that stalled

    def init(http, server_fn, changed, house_fn)
        self.http = http
        self.server_fn = server_fn
        self.changed = changed
        self.house_fn = house_fn
        self.busy = ""
        self.result = ""
        self.helpers = []
        self.tried = {}
        self.rescuing = false
        tasmota.add_driver(self)
    end

    # which build this is, and which image: the firmware's stamp (panel_build.be); "dev" and "" where nothing stamped it
    static def build()
        import global
        return global.contains("PanelBuild") ? global.PanelBuild.COMMIT : "dev"
    end
    static def image()
        import global
        return global.contains("PanelBuild") ? global.PanelBuild.IMAGE : ""
    end
    static def date()
        import global
        return global.contains("PanelBuild") ? global.PanelBuild.DATE : ""
    end
    # a build as the screens say it: its commit in this repository, "a91d8b13" of "a91d8b13/319cddad"
    static def short(b)
        import string
        var s = str(b)
        var i = string.find(s, "/")
        return i > 0 ? s[0 .. i - 1] : s
    end

    def server() return self.server_fn != nil ? self.server_fn() : nil end

    def house()
        var h = self.house_fn != nil ? self.house_fn() : nil
        return h != nil && h.up ? h : nil
    end

    # What the OTA screen reads (node_wireless.be): {"server": host:port or "", "name": the server's, "build", "image", "date", "seen", "busy", "result",
    # "stale": what the server said is to be looked at again}
    def state()
        var s = self.server()
        return {"server": s != nil ? s["host"] + ":" + str(s["port"]) : "", "name": s != nil ? str(s.find("name", "")) : "", "build": NodeOta.build(),
                "image": NodeOta.image(), "date": NodeOta.date(), "seen": self.seen, "busy": self.busy, "result": self.result,
                "stale": s != nil && self.busy == "" && (self.seen_at == nil || tasmota.millis() - self.seen_at > NodeOta.LOOK_MS)}
    end

    # A touch's effect, ["ota", verb]: look at the server again, or upgrade to what it has
    def run(verb, args)
        if verb == "look"
            self.look()
        elif verb == "upgrade"
            self.upgrade()
        end
    end

    def say()
        if self.changed != nil  self.changed() end
    end

    # what the server has for this image: its index, asked
    def look()
        var s = self.server()
        if s == nil
            self.result = "No server"
            return self.say()
        end
        if self.busy != "" || self.http.busy() return end
        self.busy = "looking"
        self.result = ""
        if !self.http.request("GET", s["host"], s["port"], NodeOta.INDEX, nil, / code, body -> self.looked(code, body))
            self.busy = ""
        end
        self.say()
    end

    # the server's index came, or why it did not: what it has for this image, kept
    def looked(code, body)
        import json
        self.busy = ""
        var m = code == 200 ? json.load(str(body)) : nil
        if !isinstance(m, map) || !isinstance(m.find("images"), map)
            self.result = code == 0 ? str(body) : code == 404 ? "No releases" : code == 200 ? "Not an index" : "Error " + str(code)
            # the server's Upgrade, where the network does not reach the server: through a neighbour
            var through = self.then_upgrade && code == 0
            self.then_upgrade = false
            # a look that failed is a look: the screen asks again after LOOK_MS, or at a touch, and not at each of its redraws
            self.seen_at = tasmota.millis()
            if through && self.through_neighbour() return end
            return self.say()
        end
        var e = m["images"].find(NodeOta.image())
        var sb = m.find("safeboot")
        self.seen = isinstance(e, map) ? {"build": str(e.find("build", "")), "date": str(e.find("date", "")), "size": e.find("size", 0), "path": str(e.find("path", "")),
                                          "safeboot": isinstance(sb, map) ? str(sb.find("path", "")) : ""} : {}
        self.seen_at = tasmota.millis()
        self.result = ""
        self.say()
        # the server's Upgrade: to what it has, when it is another build
        if self.then_upgrade
            self.then_upgrade = false
            if self.seen.find("build", "") != "" && self.seen["build"] != NodeOta.build()  self.upgrade() end
        end
    end

    # The server's Upgrade (server_link.be): what it has looked at again, and the upgrade to it when it is another build. What it did, in a word
    def upgrade_asked()
        if self.server() == nil return "No server" end
        if self.busy == "upgrading" return "Upgrading" end
        self.then_upgrade = true
        self.look()
        return "Looking"
    end

    # --- through a neighbour ----------------------------------------------------------------------------------------------------------------

    # the neighbours on the Wi-Fi, asked in turn for this node's release: whether one is asked
    def through_neighbour()
        var h = self.house()
        if h == nil return false end
        self.helpers = h.wifi_neighbours()
        self.result = ""
        return self.ask_next()
    end

    def ask_next()
        var h = self.house()
        self.asked = nil
        while h != nil && size(self.helpers) > 0
            var to = self.helpers[0]
            self.helpers.remove(0)
            if self.tell(to, h.MSG_OTA_ASK, {"i": NodeOta.image(), "b": NodeOta.build()})
                self.asked = [to, tasmota.millis()]
                self.result = "Asking node " + str(to)
                self.say()
                return true
            end
        end
        if self.result == "" || self.result[0 .. 5] == "Asking"  self.result = "No neighbour on the Wi-Fi" end
        self.say()
        return false
    end

    # a frame of the house's to a node, its body as JSON
    def tell(to, msg, m)
        import json
        var h = self.house()
        if h == nil return false end
        var b = bytes()
        b.add(msg, 1)
        b.add(h.WIRE, 1)
        b .. bytes().fromstring(json.dump(m))
        return h.send(to, b)
    end

    # The house's frames of this part: a node asking this one for its release, and the answer to this node's own asking
    def from_mesh(src, d)
        import json
        var h = self.house()
        if h == nil || size(d) < 3 return end
        var m = json.load(d[2 ..].asstring())
        if !isinstance(m, map) return end
        if d[0] == h.MSG_OTA_ASK
            self.help(src, m)
        elif self.asked == nil || self.asked[0] != src
            return
        elif d[0] == h.MSG_OTA_GO
            self.asked = nil
            self.helpers = []
            # into the safeboot image, where the neighbour's image comes; a safeboot image not known to take one is not gone into
            var r = tasmota.cmd("EspNowOtaArm")
            var a = isinstance(r, map) ? r.find("EspNowOtaArm") : nil
            self.result = a == "Done" ? "Waiting for node " + str(src) : a != nil ? str(a) : "Not in this firmware"
            log("OTA: node " + str(src) + " has build " + str(m.find("b", "")) + " for this node: " + self.result, 2)
            self.say()
        elif d[0] == h.MSG_OTA_NO
            self.result = str(m.find("r", ""))
            if self.result == "Up to date"
                self.asked = nil
                self.helpers = []
                return self.say()
            end
            self.ask_next()
        end
    end

    # A neighbour's asking, for its image: what the server has for it looked at, and the answer
    def help(src, m)
        var s = self.server()
        if type(m.find("i")) != "string" return end
        if s == nil return self.tell(src, self.house().MSG_OTA_NO, {"r": "No server"}) end
        if (self.sending != nil && self.sending["node"] != src) || self.busy != "" || self.http.busy()
            return self.tell(src, self.house().MSG_OTA_NO, {"r": "Busy"})
        end
        self.busy = "looking"
        if !self.http.request("GET", s["host"], s["port"], NodeOta.INDEX, nil, / code, body -> self.helped(src, m, code, body))
            self.busy = ""
            self.tell(src, self.house().MSG_OTA_NO, {"r": "Busy"})
        end
    end

    def helped(src, m, code, body)
        import json
        self.busy = ""
        var h = self.house()
        var s = self.server()
        if h == nil || s == nil return end
        var x = code == 200 ? json.load(str(body)) : nil
        var e = isinstance(x, map) && isinstance(x.find("images"), map) ? x["images"].find(m["i"]) : nil
        if !isinstance(e, map) || str(e.find("path", "")) == ""
            return self.tell(src, h.MSG_OTA_NO, {"r": code == 0 ? str(body) : code == 200 || code == 404 ? "No releases" : "Error " + str(code)})
        end
        if str(e.find("build", "")) == m.find("b")  return self.tell(src, h.MSG_OTA_NO, {"r": "Up to date"}) end
        self.sending = {"node": src, "url": "http://" + s["host"] + ":" + str(s["port"]) + NodeOta.FOLDER + e["path"],
                        "until": tasmota.millis() + NodeOta.SEND_MS, "at": nil, "seen": false}
        log("OTA: node " + str(src) + " is to take build " + str(e["build"]) + " from this node, over the mesh", 2)
        self.tell(src, h.MSG_OTA_GO, {"b": str(e["build"])})
    end

    # The node this one sends to, heard in its safeboot image and waiting: the send, again after one that ended; forgotten once it is out of it, or
    # after SEND_MS
    def every_second()
        var h = self.house()
        if h != nil && !h.hooks.contains(h.MSG_OTA_ASK)
            var f = / src, d -> self.from_mesh(src, d)
            h.hook(h.MSG_OTA_ASK, f)
            h.hook(h.MSG_OTA_GO, f)
            h.hook(h.MSG_OTA_NO, f)
        end
        if self.asked != nil && tasmota.millis() - self.asked[1] > NodeOta.ASK_MS  self.ask_next() end
        var p = self.sending
        if p == nil
            if h != nil  self.rescue_due(h) end
            return
        end
        if h == nil || tasmota.millis() - p["until"] > 0
            self.sending = nil
            return
        end
        var sb = h.safeboot.find(p["node"])
        if sb == nil
            if p["seen"]  self.sending = nil end
            return
        end
        p["seen"] = true
        # waiting (0), or failed (4) and waiting for another offer; not while it takes the image, unless it stalled there
        if sb[0] != 0 && sb[0] != 4 && !(p.find("stuck", false) && NodeOta.stalled(sb, tasmota.millis(), 0)) return end
        if p["at"] != nil && tasmota.millis() - p["at"] < NodeOta.SEND_AGAIN_MS return end
        var st = tasmota.cmd("EspNowOtaSend")
        var now = isinstance(st, map) ? st.find("EspNowOtaSend") : nil
        if !isinstance(now, map) || now.find("State", 0) != 0 return end
        p["at"] = tasmota.millis()
        var r = tasmota.cmd("EspNowOtaSend " + str(p["node"]) + " " + p["url"])
        log("OTA: sending node " + str(p["node"]) + " its image over the mesh: " + str(isinstance(r, map) ? r.find("EspNowOtaSend") : r), 2)
    end

    # --- a node its safeboot image left waiting ----------------------------------------------------------------------------------------------

    # whether a node heard in its safeboot image has had its image stand still for STUCK_MS, and `extra` more
    static def stalled(sb, now, extra) return size(sb) >= 6 && now - sb[5] >= NodeOta.STUCK_MS + extra end

    # A neighbour heard in its safeboot image, with an image under way that stood still long enough for this node's signal: the index looked at for its
    # release, by the image's SHA-256 prefix. From a node on a Wi-Fi access point, with the server and the HTTP client free, one node at a time
    def rescue_due(h)
        if self.rescuing || self.busy != "" || self.http.busy() || self.server() == nil || !tasmota.wifi().find("up", false) return end
        var now = tasmota.millis()
        for n: h.safeboot.keys()
            var sb = h.safeboot[n]
            if size(sb) < 6 || sb[3] == "" || (sb[0] != 0 && sb[0] != 1 && sb[0] != 4) continue end
            var rssi = type(sb[4]) == "int" && sb[4] < 0 ? -sb[4] : 0
            if !NodeOta.stalled(sb, now, rssi * NodeOta.RANK_MS) continue end
            var t = self.tried.find(n)
            if t != nil && now - t < 0 continue end
            var s = self.server()
            var image = sb[3]
            self.rescuing = self.http.request("GET", s["host"], s["port"], NodeOta.INDEX, nil, / code, body -> self.rescued(n, image, code, body))
            if self.rescuing  self.tried[n] = now + NodeOta.RESCUE_AGAIN_MS end
            return
        end
    end

    # the index for a node that stalled: the release whose image is the one it waits for, sent to it, unless it moved meanwhile
    def rescued(n, image, code, body)
        import json
        import string
        self.rescuing = false
        var h = self.house()
        var s = self.server()
        var sb = h != nil ? h.safeboot.find(n) : nil
        if s == nil || sb == nil || size(sb) < 6 || sb[3] != image || self.sending != nil || !NodeOta.stalled(sb, tasmota.millis(), 0) return end
        if code != 200
            self.tried[n] = tasmota.millis() + NodeOta.INDEX_AGAIN_MS
            return log("OTA: node " + str(n) + " stalled in its safeboot image; the server's index could not be read (" + str(code) + "), again in a while", 2)
        end
        var x = json.load(str(body))
        var images = isinstance(x, map) ? x.find("images") : nil
        if isinstance(images, map)
            for k: images.keys()
                var e = images[k]
                if isinstance(e, map) && str(e.find("path", "")) != "" && string.tolower(str(e.find("sha256", ""))[0 .. 7]) == string.tolower(image)
                    self.sending = {"node": n, "url": "http://" + s["host"] + ":" + str(s["port"]) + NodeOta.FOLDER + e["path"],
                                    "until": tasmota.millis() + NodeOta.SEND_MS, "at": nil, "seen": true, "stuck": true}
                    log("OTA: node " + str(n) + " stalled in its safeboot image on build " + str(e.find("build", "")) + ": this node sends it, over the mesh", 2)
                    return
                end
            end
        end
        log("OTA: node " + str(n) + " stalled in its safeboot image on an image the server has no release of (" + image + ")", 2)
    end

    # The upgrade to what the server has, a moment after the touch, for the screen to say so first: the node restarts into its safeboot image, or says why not
    def upgrade()
        var s = self.server()
        var e = self.seen
        if s == nil || !isinstance(e, map) || e.find("path", "") == "" || e.find("safeboot", "") == "" || self.busy != "" return end
        self.busy = "upgrading"
        self.result = ""
        self.say()
        var base = "http://" + s["host"] + ":" + str(s["port"]) + NodeOta.FOLDER
        tasmota.set_timer(NodeOta.UPGRADE_MS, def ()
            var r = tasmota.cmd("EspNowOtaUpgrade " + base + e["path"] + " " + base + e["safeboot"])
            var u = isinstance(r, map) ? r.find("EspNowOtaUpgrade") : nil
            # the upgrade's answer: the restart is on its way; any other, why it did not go
            if !isinstance(u, map)
                self.busy = ""
                self.result = u != nil ? str(u) : "Not in this firmware"
                log("OTA: the upgrade did not go: " + self.result, 2)
                self.say()
            else
                log("OTA: restarting into the safeboot image, for " + str(e["build"]), 2)
            end
        end, "node_ota_upgrade")
    end
end
