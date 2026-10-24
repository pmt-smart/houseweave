# house_channel.be -- the house's channel: the Wi-Fi channel the house's mesh is on, one setting for every node.
#
# A panel that writes the list writes it (HouseList.K_CHANNEL, the house's number 0), and the list carries it to every node, as it carries the house's MQTT
# (house_mqtt.be). Each node gives it to its driver (EspNowMeshChannel): the radio goes there when the station is on no access point, and the station keeps to it
# (xdrv_98_3: an access point on another channel is left, and only one on this channel is joined, once the node has other nodes). A change carries the instant it
# takes place, a stamp of the mesh clock MOVE_S after it was written: every node moves at that moment, the ones on no network too, and none is left behind on the
# old channel where the others no longer hear it. A node that was off then finds the house by the driver's search on the other channels (xdrv_98_4).
#
# What this does is the node's side, and two writes of a panel's own:
#   - the field against what this node applied last (the persist key KEY, the field's bytes as hex): a field this node has not applied is given to the driver at its
#     instant, or at once when the instant is past or of another timeline. A field applied is never given again: the driver's search may have moved the channel
#     since, and an old field must not move it back;
#   - a house with no channel takes the channel of the network of the first panel that writes it and is on one (the panel that founded the house); and a
#     panel alone in its house, with no other node, follows its network: the house is only it;
#   - the heartbeat's bytes 28 to 31 (mesh_beat.be): this node's mesh channel, the channel of the access point its station is on (0 none), the
#     channel of an access point of its network seen off the mesh's channel (0 none), and the last failure its station reported, while it is on none and the
#     driver has the retries (0 otherwise), for the ESP-NOW Mesh screen (panel_house_view.be). Read from the driver (EspNowMeshStation) every POLL_S.
#
# Loaded with load() after house_list.be and mesh_beat.be, and before house_mesh.be, whose HouseMesh makes one (`channel`).

#@ solidify:HouseChannel
class HouseChannel
    static KEY = "house_channel"
    static WAIT_MS = 500
    static MOVE_S = 60          # a change of the house's channel takes place this long after it is written
    static POLL_S = 10          # the driver's station is read this often, for the heartbeat
    static AT = 28              # the heartbeat's bytes 28 to 31

    var host      # the HouseMesh
    var radio     # the heartbeat's 4 bytes as this node last gave them, or nil

    def init(host)
        self.host = host
    end

    # the list changed, or the node came up: looked at a moment later, once, with whatever else changed meanwhile
    def later()
        tasmota.set_timer(HouseChannel.WAIT_MS, / -> self.check(nil), "house_channel")
    end

    # the driver's station, as EspNowMeshStation says it, or nil where the image has none (asked muted: it is a read)
    static def station()
        var r = tasmota.cmd("_EspNowMeshStation", true)
        var s = isinstance(r, map) ? r.find("EspNowMeshStation") : nil
        return isinstance(s, map) ? s : nil
    end

    # the mesh's channel the driver has, 0 for none
    static def driver_channel()
        var r = tasmota.cmd("_EspNowMeshChannel", true)
        var n = isinstance(r, map) ? r.find("EspNowMeshChannel") : nil
        return type(n) == "int" ? n : 0
    end

    # a stamp of the mesh clock `s` seconds from now, or nil when the node has none to give (the change then takes place at once)
    static def stamp_in(s)
        import global
        if !global.contains("espnow_mesh_stamp") return nil end
        var b = global.espnow_mesh_stamp()
        if !isinstance(b, bytes) || size(b) != 6 return nil end
        b.set(2, b.get(2, -4) + s * 100, -4)
        return b
    end

    # the milliseconds to the instant `at` (a stamp of the mesh clock), 0 when it is past, there is none, or it is of another timeline than this node's
    static def wait_of(at)
        import global
        if at == nil || !global.contains("espnow_mesh_age") return 0 end
        var a = global.espnow_mesh_age(at)
        if !isinstance(a, map) || a.find("tag") != true return 0 end
        var age = a.find("age", 0)
        return age < 0 ? -age : 0
    end

    # whether the house has no node but this one
    static def alone(h)
        for id: h.list.ids(false)
            if id != h.list.me return false end
        end
        return true
    end

    # The house's channel against this node's: the panel's own writes first (a house with none, and a panel alone), then the field given to the driver when this
    # node has not applied it. `s` is the station as poll() read it, or nil to read it. True when the driver was given it
    def check(s)
        import persist
        var h = self.host
        if h == nil || !h.up return false end
        var f = h.list.field(HouseList.K_CHANNEL, 0)
        if h.writes()
            if s == nil  s = HouseChannel.station() end
            var ap = s != nil ? int(s.find("Ap", 0)) : 0
            var cur = f != nil ? HouseList.channel_of(f[2]) : nil
            if ap > 0 && (cur == nil || (HouseChannel.alone(h) && cur["channel"] != ap))
                # the list changed: the check comes again with it
                if h.set_channel(ap, 0)  return false end
            end
        end
        if f == nil return false end
        var hex = f[2].tohex()
        if persist.find(HouseChannel.KEY, nil) == hex return false end
        var m = HouseList.channel_of(f[2])
        if m == nil return false end
        var wait = HouseChannel.wait_of(m["at"])
        if wait > 0
            # one wait for the instant, whatever changed meanwhile
            tasmota.remove_timer("house_channel_at")
            tasmota.set_timer(wait, / -> self.check(nil), "house_channel_at")
            return false
        end
        tasmota.cmd("_EspNowMeshChannel " + str(m["channel"]), true)
        persist.setmember(HouseChannel.KEY, hex)
        try
            persist.save()
        except .. as e, msg
            log("HOUSE: the house's channel applied was not saved (" + str(e) + ": " + str(msg) + ")", 1)
        end
        log("HOUSE: the house's channel, " + str(m["channel"]) + ", taken by this node", 2)
        self.radio = nil
        return true
    end

    # The heartbeat's bytes 28 to 31 from the driver, given to it when they changed (MeshBeat gives nothing it has), and the house's channel looked at again: a panel
    # that came on a network may give the house its first one. A node in no house says nothing there: the house layer's bytes are zeros until it has one
    def poll()
        var h = self.host
        if h == nil || size(h.list.ids(false)) == 0 return end
        var s = HouseChannel.station()
        var b = bytes(-4)
        if s != nil
            var ap = int(s.find("Ap", 0))
            b[0] = int(s.find("Channel", 0)) & 255
            b[1] = ap & 255
            b[2] = int(s.find("OffChannel", 0)) & 255
            b[3] = ap == 0 && s.find("State", "Watch") != "Watch" ? int(s.find("Reason", 0)) & 255 : 0
        else
            b[0] = HouseChannel.driver_channel() & 255
        end
        self.radio = b
        var beat = MeshBeat.shared()
        beat.put(HouseChannel.AT, b)
        beat.flush()
        self.check(s)
    end

    # what a node's heartbeat says of its radio: {"mesh", "ap", "off", "why"} as poll() puts them, from the bytes of the application in hex, or nil when it says nothing
    static def of_info(info)
        if type(info) != "string" || size(info) < 64 return nil end
        var b = bytes(info)
        return {"mesh": b[28], "ap": b[29], "off": b[30], "why": b[31]}
    end

    # what this node's own radio is, as its heartbeat says it, or nil before the first poll
    def mine()
        var b = self.radio
        return b != nil ? {"mesh": b[0], "ap": b[1], "off": b[2], "why": b[3]} : nil
    end
end
