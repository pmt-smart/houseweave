# house_commands.be -- the house by the console: the commands that build and read a house on the bench, with no screen, over the Tasmota console, the web
# console and the HTTP API, one line each.
#
#   HouseFound [name[,number]]            this node founds the house (a panel): draws the key, writes itself in. `number` is the one a node that has none takes
#   HouseAdd role,number,public,mac[,name]   a node written into the list (a panel): `role` is bridge or panel, `number` 0 for the next, `public` and `mac` as the new node's
#                                         EspNowMeshPublic says them (Public and Mac, with or without the colons), and the name is the one it will have
#   HouseBench [0]                        opens (or, with 0, closes) the window of BENCH_MS in which the two commands below work: the pieces carry the network's KEY, and the console,
#                                         the web console and MQTT show a command and its answer. A closed window is the rule, and a deliberate act opens it
#   HouseWelcome number[,index]           what a panel gives the node it wrote: a piece of the welcome (the number, the key and the list), as hex; `Of` says how many there are,
#                                         and the pieces are asked one at a time, from 0
#   HouseAccept piece                     what the new node is given, a piece at a time, in any order: when the last has come the node takes the number, the key and the list,
#                                         and the mesh is on. One that is not a whole welcome is refused, and nothing is changed
#   HouseStatus                           the house as this node has it: the name, the nodes, the key
#   HouseLeave 1                          this node leaves the house, here: the list, the keys and the number go, in the driver too. Bare, it says "1 to leave"
#
# The pairing's screens do the same with the link of the pairing; on a bench the console does it, node to node, by hand. Nothing here is a
# way round a rule: the same functions, with the same refusals (a bridge writes nothing; a node that has a key takes no welcome).
#
# It is made by the same boot that makes the house layer (panel_boot.be, the bridge's relay), where there is one.

#@ solidify:HouseCommands
class HouseCommands
    static BENCH_MS = 600000

    var host     # the HouseMesh
    var got      # the pieces of a welcome in, by their place
    var of       # how many there are of it, or 0
    var until    # millis the window of the bench closes, or 0

    def init(host)
        self.host = host
        self.got = {}
        self.of = 0
        self.until = 0
        tasmota.add_cmd("HouseBench", / cmd, idx, payload -> self.bench(payload))
        tasmota.add_cmd("HouseFound", / cmd, idx, payload -> self.found(payload))
        tasmota.add_cmd("HouseAdd", / cmd, idx, payload -> self.add(payload))
        tasmota.add_cmd("HouseWelcome", / cmd, idx, payload -> self.welcome(payload))
        tasmota.add_cmd("HouseAccept", / cmd, idx, payload -> self.accept(payload))
        tasmota.add_cmd("HouseStatus", / cmd, idx, payload -> self.status())
        tasmota.add_cmd("HouseLeave", / cmd, idx, payload -> self.leave(payload))
    end

    # this node leaves the house, as the factory reset and the bridge's button make it
    def leave(payload)
        import string
        if string.tr(str(payload), " ", "") != "1"
            tasmota.resp_cmnd('{"HouseLeave":"1 to leave"}')
            return
        end
        self.host.leaving = true
        self.host.leave()
        tasmota.resp_cmnd('{"HouseLeave":"Done"}')
    end

    # a payload split at the commas, each part without the blanks around it
    static def parts(payload)
        import string
        var out = []
        var rest = str(payload)
        while true
            var i = string.find(rest, ",")
            var one = i < 0 ? rest : rest[0 .. i - 1]
            while size(one) > 0 && one[0] == " " one = one[1 ..] end
            while size(one) > 0 && one[-1] == " " one = one[0 .. -2] end
            out.push(one)
            if i < 0 break end
            rest = rest[i + 1 ..]
        end
        return out
    end

    # a radio address as 6 bytes, with the colons or without
    static def mac_bytes(text)
        var hex = ""
        for i: 0 .. size(text) - 1
            if text[i] != ":" hex += text[i] end
        end
        return size(hex) == 12 ? bytes(hex) : nil
    end

    # whether the window is open: the commands that carry the key work only in it
    def open_now()
        if self.until == 0 || tasmota.millis() >= self.until
            self.until = 0
            log("HOUSE: the welcome carries the network's key: HouseBench opens the window for it", 1)
            return false
        end
        return true
    end

    def bench(payload)
        var off = str(payload) == "0"
        self.until = off ? 0 : tasmota.millis(HouseCommands.BENCH_MS)
        tasmota.resp_cmnd('{"HouseBench":"' + (off ? "Closed" : "Open") + '"}')
    end

    def found(payload)
        var f = HouseCommands.parts(payload)
        var id = size(f) > 1 && f[1] != "" ? int(f[1]) : nil
        if self.host.found(f[0] != "" ? f[0] : "Home", id)
            tasmota.resp_cmnd('{"HouseFound":"Done"}')
        else
            tasmota.resp_cmnd_failed()
        end
    end

    def add(payload)
        var f = HouseCommands.parts(payload)
        if size(f) < 4 return tasmota.resp_cmnd_failed() end
        var role = f[0] == "bridge" ? HouseList.ROLE_BRIDGE : (f[0] == "panel" ? HouseList.ROLE_PANEL : 0)
        var pub = size(f[2]) == 64 ? bytes(f[2]) : nil
        var mac = HouseCommands.mac_bytes(f[3])
        if role == 0 || pub == nil || size(pub) != 32 || mac == nil return tasmota.resp_cmnd_failed() end
        var want = int(f[1])
        var id = self.host.add_node(role, pub, mac, nil, size(f) > 4 && f[4] != "" ? f[4] : nil, want > 0 ? want : nil)
        if id < 1 return tasmota.resp_cmnd_failed() end
        tasmota.resp_cmnd('{"HouseAdd":{"Id":' + str(id) + '}}')
    end

    def welcome(payload)
        if !self.open_now() return tasmota.resp_cmnd_failed() end
        var f = HouseCommands.parts(payload)
        var pieces = self.host.welcome(int(f[0]))
        var at = size(f) > 1 ? int(f[1]) : 0
        if pieces == nil || at < 0 || at >= size(pieces) return tasmota.resp_cmnd_failed() end
        tasmota.resp_cmnd('{"HouseWelcome":{"Id":' + str(int(f[0])) + ',"Index":' + str(at) + ',"Of":' + str(size(pieces)) + ',"Piece":"' + pieces[at].tohex() + '"}}')
    end

    def accept(payload)
        if !self.open_now() return tasmota.resp_cmnd_failed() end
        var piece = bytes(str(payload))
        if size(piece) < 3 return tasmota.resp_cmnd_failed() end
        if piece[1] != self.of
            self.got = {}
            self.of = piece[1]
        end
        self.got[piece[0]] = piece
        if size(self.got) < self.of
            return tasmota.resp_cmnd('{"HouseAccept":{"Have":' + str(size(self.got)) + ',"Of":' + str(self.of) + '}}')
        end
        var all = []
        for k: self.got.keys() all.push(self.got[k]) end
        self.got = {}
        self.of = 0
        if self.host.accept(all)
            tasmota.resp_cmnd('{"HouseAccept":"Done"}')
        else
            tasmota.resp_cmnd('{"HouseAccept":"Refused"}')
        end
    end

    def status()
        import json
        var l = self.host.list
        var nodes = []
        for id: l.ids(true)
            var n = l.node(id)
            # a number struck off is the mark alone
            nodes.push(n == nil ? {"Id": id, "Revoked": 1} : {"Id": id, "Role": n["role"] == HouseList.ROLE_BRIDGE ? "Bridge" : "Panel", "Name": n["name"], "Revoked": 0})
        end
        tasmota.resp_cmnd(json.dump({"HouseStatus": {"Me": l.me, "Up": self.host.up ? 1 : 0, "Name": l.name(), "Key": self.host.key.version, "Pending": self.host.key.pend != nil ? 1 : 0, "Nodes": nodes}}))
    end
end
