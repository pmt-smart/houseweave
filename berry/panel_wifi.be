# panel_wifi.be -- the panel's Wi-Fi as Wireless settings shows it and asks
# for it: the radio off with no network saved, the one network the
# glass keeps, the search and the join from the glass, and Tasmota's own Wi-Fi
# Manager for the web setup.
#
# Over Tasmota's commands: `Wifi 0` turns the radio off with no AP and no
# restart, `Wifi 1` turns it back on to the network saved, and `WifiConfig 2`
# opens the Wi-Fi Manager. The search, the join that saves a network only once
# it works, and the forget without a restart are the station driver's
# (StaScan, StaJoin, StaForget), and so is the radio held on with
# no network for the Zigbee on ESP-NOW (StaHold), and the hotspot, the driver's
# own access point for a phone to reach the panel (StaHotspot), which
# the web setup opens on Tasmota's Wi-Fi page. A firmware without the driver has
# Tasmota's Wi-Fi Manager for the web setup, and its Forget restarts.
#
# The fork turns Wi-Fi on at every boot, so what the glass chose
# is chosen again at every boot, by at_boot, before Tasmota's first Wi-Fi
# check: autoexec.be runs at the first tick of the main loop, and the check is a
# tick of 250 ms after it (firmware/tasmota/tasmota/tasmota.ino, Scheduler).
#
# The views never call this: they return ["wifi", op, ...] effects
# (panel_ui.be), and brain.be carries them out here, and hands the driver's
# answers, {"StaScan":...} and {"StaJoin":...}, to scanned and joined.

#@ solidify:PanelWifi
class PanelWifi
    # What the glass chose, kept across a reboot: {"off": the radio turned off
    # with a network saved, "config": the WifiConfig a web setup found, given
    # back at the next boot}
    static PERSIST_KEY = "panel_wifi"
    # Tasmota's own tool for a network it cannot reach, when a WifiConfig cannot
    # be read (WIFI_CONFIG_TOOL in my_user_config.h: WIFI_RETRY)
    static CONFIG_DEFAULT = 4
    # how long the station driver gives a join (STA_CTRL_JOIN_TIMEOUT_MS in
    # xdrv_96_wifi_station.ino): the view counts the seconds down
    static JOIN_MS = 25000

    var zb        # the Zigbee transport (zigbee_bridge.be), for its mode, or nil
    var web       # the Wi-Fi Manager was opened from the glass: it stays up until the restart that ends it
    var saved     # the network the glass keeps, Ssid1's name: read at boot, changed from here
    var station   # the firmware has the station driver: the search, the join and the forget without a restart
    var networks  # what the last search found, [[name, rssi, auth, channel, bssid]] strongest first, or nil before one
    var scanning  # a search is running
    var join      # the join from the glass: {"ssid", "password", "channel", "bssid", "state", "reason"}, or nil
    var looking   # a view of the networks is on show: a search's report is kept only for one
    var hotspot   # the hotspot opened from the glass: {"kind": "hotspot" or "web", "ssid", "password",
                  # "clients", "state": "up" or "off", "reason"}, or nil
    var holding   # the radio is held on with no network for the mesh (StaHold 1), as this last set it, or nil before

    def init(zb)
        self.zb = zb
        self.web = false
        self.saved = nil
        self.networks = nil
        self.scanning = false
        self.join = nil
        self.looking = false
        self.hotspot = nil
        var r = tasmota.cmd("StaState")
        self.station = isinstance(r, map) && r.contains("StaState")
    end

    # A text field of a command's answer, or "" when it has none
    static def field(r, key)
        if !isinstance(r, map) return "" end
        var v = r.find(key)
        return v != nil ? str(v) : ""
    end

    # The number a WifiConfig answer starts with: {"WifiConfig":"4 (Retry)"}
    static def config_of(r)
        import string
        var s = PanelWifi.field(r, "WifiConfig")
        var n = size(s) > 0 ? int(string.split(s, " ")[0]) : 0
        return n > 0 ? n : PanelWifi.CONFIG_DEFAULT
    end

    def kept()
        import persist
        var k = persist.find(PanelWifi.PERSIST_KEY, nil)
        return isinstance(k, map) ? k : {}
    end

    # written here and now, as the commands that follow it go on to a restart that would take a write waiting for heap
    # (PanelStore.safe_save does not raise: a failed one is a line in the log). A bridge, which runs this for its Wireless settings on a
    # panel, has no PanelStore: its save is the persist's own, which does not raise either
    def keep(k)
        import persist
        import global
        persist.setmember(PanelWifi.PERSIST_KEY, k)
        if global.contains("PanelStore")
            global.PanelStore.safe_save(global.PanelStore.SAVE_TRIES)
        else
            try
                persist.save()
            except .. as e, m
                log("WIFI: saving failed (" + str(e) + ": " + str(m) + ")", 2)
            end
        end
    end

    # The radio held on with no network, for the mesh: while the house has another node, a bridge (the Zigbee of its bridges
    # goes over the mesh) or a panel; and while this panel has no house yet, which makes its identity on the mesh with the radio's random numbers to found
    # one: fresh from its box, with no network, it waited with the radio off, and no house. Alone in its house, it lets the radio go, and
    # adding a node turns it on by itself (the pairing)
    def holds_radio()
        import global
        if self.zigbee_mode() == "mesh" return true end
        var h = global.contains("house") ? global.house : nil
        if h == nil return false end
        return !h.up || size(h.list.ids(false)) > 1
    end

    # The radio off for the glass: off, or, for ESP-NOW, on with no network and
    # no AP when the driver can hold it so
    def radio_off()
        tasmota.cmd("Wifi 0")
        if self.station && self.holds_radio() tasmota.cmd("StaHold 1") end
    end

    # The Wi-Fi at boot, with our pages up (panel_boot.be): the tool a web setup
    # replaced given back, and the radio off with no network saved, or after the
    # glass turned it off. With Ssid2 set and Ssid1 empty, Tasmota has a network
    # to go to, and the radio stays on: the glass keeps Ssid1 alone, and leaves
    # Ssid2 as it found it.
    def at_boot()
        var k = self.kept()
        if k.find("config") != nil
            # the restart that ends a web setup is this boot: Tasmota's tool for a
            # network it cannot reach comes back, and WifiConfig restarts nothing
            # with the Wi-Fi Manager down
            tasmota.cmd("WifiConfig " + str(k["config"]))
            k.remove("config")
            self.keep(k)
        end
        var names = tasmota.cmd("SSId")
        self.saved = PanelWifi.field(names, "SSId1")
        var none = self.saved == "" && PanelWifi.field(names, "SSId2") == ""
        var held = self.station && self.holds_radio()
        # A network saved since the Disconnect, on Tasmota's own page (the web
        # setup), ends it: the radio stays on for it. The
        # same network saved again does not, and Reconnect is there for it; a
        # Disconnect from before the name was kept stays as it was.
        if k.find("off", false) && self.saved != "" && self.saved != k.find("offSsid", self.saved)
            k["off"] = false
            k.remove("offSsid")
            self.keep(k)
            log("WIFI: " + self.saved + " was saved since the Disconnect: the Wi-Fi stays on for it", 2)
        end
        if k.find("off", false)
            # the glass turned it off, and said what stops with it
            self.radio_off()
            log(held ? "WIFI: turned off on the glass, the radio held for the Zigbee on ESP-NOW" : "WIFI: turned off on the glass, the radio stays off", 2)
        elif none && self.holds_radio() && !self.station
            # ESP-NOW is the radio's, and this firmware cannot hold it with no
            # network: it stays on, and Tasmota opens its AP as it always did
            log("WIFI: no network saved, and the radio stays on for the Zigbee on ESP-NOW", 2)
        elif none
            self.radio_off()
            log(held ? "WIFI: no network saved, the radio held with no network for the Zigbee on ESP-NOW" : "WIFI: no network saved, the radio stays off", 2)
        end
        self.holding = held && (none || k.find("off", false) == true)
    end

    # The Zigbee transport's mode changed (zigbee_bridge.be: the house has a bridge, or no longer has one): a panel on no
    # network, or whose radio the glass turned off, holds the radio on for the mesh once the house has a bridge, and lets it go once it
    # has none. Its boot saw the house as it was then: a panel factory reset, or fresh from its box, adds its first bridge later, and
    # with the radio left off the bridge stayed in "No signal". Called too when the house's list changes: a panel
    # with no house holds the radio for its identity, and lets it go once it founded one with no bridge (panel_boot.be)
    def mode_changed()
        if !self.station return end
        var names = tasmota.cmd("SSId")
        var none = PanelWifi.field(names, "SSId1") == "" && PanelWifi.field(names, "SSId2") == ""
        var want = self.holds_radio() && (none || self.kept().find("off", false) == true)
        if want == self.holding return end
        self.holding = want
        tasmota.cmd(want ? "StaHold 1" : "StaHold 0")
        log(want ? "WIFI: the radio held with no network, for the mesh: the house has another node, or this panel has no house yet" : "WIFI: alone in its house: the radio let go", 2)
    end

    # The way back to a panel the glass cannot reach, a screen that is not ours
    # or a brain that did not come up: the radio comes back on,
    # whatever the glass chose, and the console reaches the panel on the saved
    # network or, with none, on Tasmota's own AP. Nothing of it is kept.
    def rescue()
        tasmota.cmd("StaHold 0")
        tasmota.cmd("Wifi 1")
        log("WIFI: on for the console to reach the panel, whatever the glass chose", 2)
    end

    # The network the glass keeps, read once
    def saved_name()
        if self.saved == nil self.saved = PanelWifi.field(tasmota.cmd("SSId1"), "SSId1") end
        return self.saved
    end

    # The Zigbee transport's mode: off, local, tcp or direct
    def zigbee_mode()
        return self.zb != nil ? self.zb.mode : "off"
    end

    # Why the network saved does not come up, from the driver: WrongPassword,
    # NotFound, NoAnswer, NoAddress, or "" when it has not failed
    def reason()
        var s = tasmota.cmd("StaState")
        var st = isinstance(s, map) ? s.find("StaState") : nil
        return isinstance(st, map) ? str(st.find("Reason", "")) : ""
    end

    # What Wireless settings draws, read when a view is drawn:
    #   saved    the network the glass keeps, or ""
    #   ssid     the one Tasmota is on, when it is on one
    #   up, ip, quality, rssi, mac   tasmota.wifi()'s
    #   off      the glass turned the radio off, with the network kept
    #   web      the Wi-Fi Manager opened from the glass is up
    #   ap       the Wi-Fi Manager's network, which is named after the panel
    #   search   the firmware can search for networks and join one from the glass
    #   reason   why the network saved does not come up, or ""
    #   scanning, networks, join   the search and the join from the glass
    #   zigbee   the Zigbee transport's mode
    def state()
        var w = tasmota.wifi()
        var up = w.find("up", false) == true
        var off = self.kept().find("off", false) == true
        var saved = self.saved_name()
        return {"saved": saved, "ssid": w.find("ssid", ""), "up": up,
                "ip": w.find("ip", ""), "quality": w.find("quality"), "rssi": w.find("rssi"), "mac": w.find("mac", ""),
                "off": off, "web": self.web, "ap": tasmota.hostname(), "search": self.station,
                "reason": self.station && !up && !off && saved != "" ? self.reason() : "",
                "scanning": self.scanning, "networks": self.networks, "join": self.join,
                "hotspot": self.hotspot, "zigbee": self.zigbee_mode()}
    end

    # What a view asked for (panel_ui.be's ["wifi", op, ...]): `args` are the
    # effect's values after the op
    def run(op, args)
        var k = self.kept()
        if op == "off"
            # Disconnect: the radio off, and the network kept for Reconnect, with its
            # name, which says at boot whether another one was saved since
            if self.saved == nil  self.saved = PanelWifi.field(tasmota.cmd("SSId1"), "SSId1") end
            k["off"] = true
            k["offSsid"] = self.saved
            self.keep(k)
            self.radio_off()
        elif op == "on"
            k["off"] = false
            k.remove("offSsid")
            self.keep(k)
            tasmota.cmd("Wifi 1")
        elif op == "forget"
            k["off"] = false
            k.remove("offSsid")
            self.keep(k)
            self.saved = ""
            if self.station
                # the driver empties Ssid1 and Password1 with no restart, and the
                # radio goes off
                tasmota.cmd("StaForget")
                if self.holds_radio() tasmota.cmd("StaHold 1") end
            else
                # Ssid1 and Password1 emptied: Tasmota restarts for them, and the
                # boot after finds no network, so the radio stays off
                tasmota.cmd("Wifi 0")
                tasmota.cmd('Backlog0 Password1 "; SSId1 "')
            end
        elif op == "scan"
            # the driver answers at once, and reports the networks when done
            self.looking = true
            self.scanning = PanelWifi.field(tasmota.cmd("StaScan"), "StaScan") == "Started"
            if !self.scanning && self.networks == nil self.networks = [] end
        elif op == "join"
            self.start_join(args[0], args[1], args[2], args[3])
        elif op == "endJoin"
            # the join's view closed: what was typed goes with it
            self.join = nil
        elif op == "endSearch"
            # the networks' view closed: what the search found goes with it, and
            # a report still on its way is not kept (the heap)
            self.looking = false
            self.networks = nil
        elif op == "web"
            # The Wi-Fi Manager, now: WifiConfig 2 opens it at the next Wi-Fi
            # check, which runs only with the Wi-Fi on. It ends with Tasmota's own
            # restart, when a network is saved on its page, and the tool it
            # replaces comes back at the boot after (at_boot). A Disconnect stays
            # until a network is saved there: a web setup stopped with none saved
            # leaves the radio off
            k["config"] = PanelWifi.config_of(tasmota.cmd("WifiConfig"))
            self.keep(k)
            self.web = true
            tasmota.cmd("Wifi 1")
            tasmota.cmd("WifiConfig 2")
            log("WIFI: web setup open, on the network " + tasmota.hostname(), 2)
        elif op == "stopWeb"
            # the Wi-Fi Manager has no way out but a restart
            tasmota.cmd("Restart 1")
        elif op == "hotspot"
            self.open_hotspot(size(args) > 0 ? str(args[0]) : "hotspot")
        elif op == "stopHotspot"
            # the hotspot closes with no restart, and the station stays as it is
            tasmota.cmd("StaHotspot 0")
            self.hotspot = nil
        end
    end

    # The hotspot: the station driver's own access point, for a
    # phone to reach the panel's web UI, named after the panel, with a password
    # drawn each time and shown on the glass alone. The web setup is the same
    # hotspot, on Tasmota's Wi-Fi page. The driver closes it on Stop, a restart,
    # or 15 min with nobody on it
    def open_hotspot(kind)
        import json
        var ssid = tasmota.hostname()
        var pw = PanelWifi.draw(10)
        self.hotspot = nil
        var r = tasmota.cmd("StaHotspot " + json.dump({"SSId": ssid, "Password": pw}))
        var h = isinstance(r, map) ? r.find("StaHotspot") : nil
        if isinstance(h, map) && h.find("State") == "Up"
            self.hotspot = {"kind": kind, "ssid": ssid, "password": pw, "clients": 0, "state": "up", "reason": ""}
            log("WIFI: hotspot " + ssid + " open, on channel " + str(h.find("Channel", 0)), 2)
        else
            self.hotspot = {"kind": kind, "ssid": ssid, "password": "", "clients": 0, "state": "off",
                            "reason": h == "Busy" ? "Busy" : "Error"}
        end
    end

    # What the driver says of the hotspot, {"StaHotspot": {"State", "Clients",
    # "Reason"}}: the phones on it, and its closing, by Stop, by itself after 15
    # min with nobody on it, or under the WiFi Manager
    def hotspot_said(v)
        var h = self.hotspot
        if h == nil || !isinstance(v, map) || h["state"] != "up" return end
        if v.find("State") == "Up"
            h["clients"] = int(v.find("Clients", 0))
        elif v.find("State") == "Off"
            h["state"] = "off"
            h["clients"] = 0
            h["reason"] = str(v.find("Reason", ""))
        end
    end

    # A password read off the glass and typed on a phone: no 0 or o, no 1, l or i,
    # each character as likely as another
    static def draw(n)
        import crypto
        var chars = "abcdefghjkmnpqrstuvwxyz23456789"
        var s = ""
        while size(s) < n
            var r = crypto.random(n)
            var i = 0
            while i < size(r) && size(s) < n
                if r[i] < 248  s += chars[r[i] % 31] end
                i += 1
            end
        end
        return s
    end

    # A network tried: saved only once it works, by the driver. A
    # WPA password has 8 characters or more, and an open network none. The
    # password stays in memory for Try again, and nowhere else.
    def start_join(ssid, password, channel, bssid)
        import json
        # until: when the station driver gives up (STA_CTRL_JOIN_TIMEOUT_MS), for the view to count down
        self.join = {"ssid": ssid, "password": password, "channel": channel, "bssid": bssid, "state": "joining", "reason": "",
                     "until": tasmota.millis() + PanelWifi.JOIN_MS}
        if size(password) > 0 && size(password) < 8
            self.join["state"] = "failed"
            self.join["reason"] = "TooShort"
            return
        end
        var q = {"SSId": ssid, "Password": password}
        if bssid != ""
            q["Channel"] = channel
            q["BSSId"] = bssid
        end
        if PanelWifi.field(tasmota.cmd("StaJoin " + json.dump(q)), "StaJoin") != "Joining"
            # a search or another join still has the radio
            self.join["state"] = "failed"
            self.join["reason"] = "NoAnswer"
        end
    end

    # A search ended (the driver's {"StaScan": {"Networks": [...]}}): the
    # networks by name, the strongest access point of each
    def scanned(v)
        self.scanning = false
        if !self.looking return end
        var found = []
        var nets = isinstance(v, map) ? v.find("Networks") : nil
        if isinstance(nets, list)
            for n: nets
                if isinstance(n, list) && size(n) >= 5 found.push(n) end
            end
        end
        self.networks = found
    end

    # A join ended ({"StaJoin": {"State": ...}}): connected, the network is the
    # one saved and the radio is on; failed, the reason, with the password kept
    # for Try again
    def joined(v)
        if !isinstance(v, map) return end
        if v.find("State") == "Connected"
            var k = self.kept()
            k["off"] = false
            self.keep(k)
            self.saved = str(v.find("SSId", ""))
            self.join = nil
            return
        end
        if self.join != nil
            self.join["state"] = "failed"
            self.join["reason"] = str(v.find("Reason", "NoAnswer"))
        end
    end
end
