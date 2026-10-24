# house_key.be -- the change of the network's key, from the panel that strikes a node off to every node that is left.
# The C side is in the driver: a node that takes a new key keeps the one it had as the PREVIOUS key (EspNowMeshGroupKey), a frame can be sent with the previous key's tag, and
# EspNowMeshKeyClose lets the previous key go. What the driver does not do is carry the new key to the nodes, and that is this.
#
# THE PANEL THAT STRIKES A NODE OFF draws a key, a version above the one in use, and writes both to its flash (the change it is carrying out, `pend`: the version, the key, the
# nodes it is to reach, and what each said) BEFORE it gives the key to its own driver, so that a power cut between the two does not leave a panel with a key that nobody else has.
# Then it sends the key to every node of the list that was not struck off, in a frame of the mesh's type 6 to that node alone (the mesh seals it with the key of the pair, so only
# that node can read it and only this panel could have made it), tagged with the PREVIOUS key (the node that has not taken the change can check no other), until the node says it has it.
#
# THE NODE THAT GETS IT takes it if it comes from a panel of its list and the version is above the one it has (within half the numbers: an old frame played back does not take a
# node back to the key of the one that was struck off), gives it to its driver, and says so to the panel. It keeps the previous key until it is told to close.
#
# WHEN EVERY NODE HAS SAID IT HAS THE KEY the panel sends each a CLOSE, and lets its own previous key go; a node closes on a CLOSE from a panel for the version it has, and says so. When
# every node said it closed, the change is done. A node that says nothing is the owner's: finish() closes the change anyway and the node is left to the button (or to the 720 hours).
#
# While a node holds a previous key it sends its frames of the house with that key's tag to a node that does not say, in its heartbeat, that it has the key in use (HouseMesh.send).
#
# MESSAGES (the wire version 1, the mesh's type 6, to one node):
#   0x23 key    the version (1), the key (32)
#   0x24 ack    the version (1), 1 when the node has also closed
#   0x25 close  the version (1)
# The key is in a frame of the air only sealed for the node it is for, and in the flash of a panel while the change is open (the driver keeps it in its own record as well).

#@ solidify:HouseKey
class HouseKey
    static MSG_KEY = 0x23
    static MSG_ACK = 0x24
    static MSG_CLOSE = 0x25
    static WIRE = 1
    static KEY = "house_key"
    static CUR = "house_cur"
    static RESEND_MS = 8000

    var host       # the HouseMesh
    var version    # the version of the key in use, 1 to 255, or 0 when it is not known
    var holds      # this node holds a previous key
    var pend       # the change this panel is carrying out, or nil: {"v", "k", "to": [nodes], "got": {node: 1 has the key, 2 has closed}}
    var sent       # node -> millis when it was last sent a key or a close

    def init(host)
        self.host = host
        self.version = 0
        self.holds = false
        self.pend = nil
        self.sent = {}
    end

    # the house's numbers, m (number -> true; house_mesh.be, sweep()): a node that is no more is waited for no more by the change this panel carries out, which
    # closes once the others have the key
    def sweep(m)
        var drop = []
        for k: self.sent.keys()
            if !m.contains(k)  drop.push(k) end
        end
        for k: drop  self.sent.remove(k) end
        if self.pend == nil return end
        var to = []
        for id: self.pend["to"]
            if m.contains(id)  to.push(id) end
        end
        if size(to) == size(self.pend["to"]) return end
        var got = {}
        for id: to
            if self.pend["got"].contains(id)  got[id] = self.pend["got"][id] end
        end
        self.pend["to"] = to
        self.pend["got"] = got
        self.keep()
    end

    # the node left the house (house_mesh.be, leave()): the version, the previous key and the change it carried out are none
    def forget()
        self.version = 0
        self.holds = false
        self.pend = nil
        self.sent = {}
    end

    # --- the driver's state ------------------------------------------------------------------------------------------

    # the version of the key in use and the one held before it (0 for none), as the driver's status says; nil when the driver does not answer
    static def status()
        var r = tasmota.cmd("_EspNowMeshStatus", true)
        var s = isinstance(r, map) ? r.find("EspNowMeshStatus") : nil
        if !isinstance(s, map) || type(s.find("GroupVersion")) != "int" return nil end
        return [s["GroupVersion"], type(s.find("PrevVersion")) == "int" ? s["PrevVersion"] : 0]
    end

    # the version after this one: 1 to 255, and 0 is not one
    static def next_of(v)
        return v >= 255 ? 1 : v + 1
    end

    # whether `v` is above `cur`: within the half of the numbers after it (the numbers go round)
    static def newer(v, cur)
        if v < 1 || v > 255 return false end
        var d = (v - cur + 255) % 255
        return d >= 1 && d <= 127
    end

    # the key to the driver. True when it took it; revoke (1) when this node may take it over a change that is not closed
    static def give(key_hex, version)
        var r = tasmota.cmd("EspNowMeshGroupKey " + key_hex + "," + str(version) + ",1", true)
        var x = isinstance(r, map) ? r.find("EspNowMeshGroupKey") : nil
        return isinstance(x, map) && x.find("Version") == version
    end

    # The key in use, kept by a panel, for the nodes it brings into the house (house_mesh.be, welcome): the driver never says it. [version, key as 32 bytes], or nil when this
    # node does not have it (a bridge keeps none, and a panel that was given its key some other way than by the house does not know it)
    def cur()
        import persist
        var c = persist.find(HouseKey.CUR, nil)
        if !isinstance(c, map) || type(c.find("v")) != "int" || type(c.find("k")) != "string" return nil end
        var k = bytes(c["k"])
        return size(k) == 32 ? [c["v"], k] : nil
    end

    def keep_cur(version, key_hex)
        import persist
        if self.host.role != HouseList.ROLE_PANEL return end
        persist.setmember(HouseKey.CUR, {"v": version, "k": key_hex})
        try
            persist.save()
        except .. as e, m
            log("HOUSE: the key was not saved (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # --- start ---------------------------------------------------------------------------------------------------------

    def attach()
        import persist
        var s = HouseKey.status()
        if s != nil
            self.version = s[0]
            self.holds = s[1] != 0
        end
        var p = persist.find(HouseKey.KEY, nil)
        if isinstance(p, map) && type(p.find("v")) == "int" && type(p.find("k")) == "string" && isinstance(p.find("to"), list) && isinstance(p.find("got"), map)
            var got = {}
            for k: p["got"].keys() got[int(k)] = p["got"][k] end
            self.pend = {"v": p["v"], "k": p["k"], "to": p["to"], "got": got}
            # a power cut between the flash and the driver: the key is given to the driver again
            if s != nil && s[0] != self.pend["v"] && HouseKey.newer(self.pend["v"], s[0])
                if HouseKey.give(self.pend["k"], self.pend["v"])
                    self.version = self.pend["v"]
                    self.holds = true
                end
            end
        end
    end

    def keep()
        import persist
        if self.pend == nil
            persist.remove(HouseKey.KEY)
        else
            var got = {}
            for k: self.pend["got"].keys() got[str(k)] = self.pend["got"][k] end
            persist.setmember(HouseKey.KEY, {"v": self.pend["v"], "k": self.pend["k"], "to": self.pend["to"], "got": got})
        end
        try
            persist.save()
        except .. as e, m
            log("HOUSE: the change of the key was not saved (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # --- the panel that strikes a node off -------------------------------------------------------------------------------

    # the key is changed: drawn, kept, given to this node's driver, and sent to every node of the list that is left. False when it cannot be (not a panel, no key, the driver refuses)
    def rotate()
        import crypto
        if !self.host.writes() return false end
        var s = HouseKey.status()
        if s == nil return false end
        var to = []
        for id: self.host.list.ids(false)
            if id != self.host.list.me to.push(id) end
        end
        var v = HouseKey.next_of(s[0])
        var k = crypto.random(32).tohex()
        self.pend = {"v": v, "k": k, "to": to, "got": {}}
        self.keep()
        if !HouseKey.give(k, v)
            log("HOUSE: the driver took no new key", 1)
            self.pend = nil
            self.keep()
            return false
        end
        self.version = v
        self.holds = true
        self.sent = {}
        self.keep_cur(v, k)
        self.tick()
        return true
    end

    # the change closed by the owner, with nodes that did not say: the nodes that have the key are told to close, this node lets its previous key go, and the nodes that did not take
    # the key are left as they are
    def finish()
        if self.pend == nil return false end
        for id: self.pend["to"]
            if self.pend["got"].find(id, 0) == 1
                var b = bytes()
                b.add(HouseKey.MSG_CLOSE, 1)
                b.add(HouseKey.WIRE, 1)
                b.add(self.pend["v"], 1)
                self.host.send(id, b, false)
            end
        end
        self.pend = nil
        self.keep()
        self.close_own()
        return true
    end

    def close_own()
        tasmota.cmd("EspNowMeshKeyClose", true)
        self.holds = false
    end

    # a few frames a second: the key to the nodes that did not say they have it, the close to the ones that have it and did not say they closed
    def tick()
        if self.pend == nil return end
        var now = tasmota.millis()
        var all_have = true
        var all_closed = true
        for id: self.pend["to"]
            var g = self.pend["got"].find(id, 0)
            if g < 2 all_closed = false end
            if g < 1 all_have = false end
        end
        for id: self.pend["to"]
            var g = self.pend["got"].find(id, 0)
            if g >= 2 continue end
            var last = self.sent.find(id)
            if last != nil && now - last < HouseKey.RESEND_MS continue end
            self.sent[id] = now
            var b = bytes()
            if g == 0
                b.add(HouseKey.MSG_KEY, 1)
                b.add(HouseKey.WIRE, 1)
                b.add(self.pend["v"], 1)
                b .. bytes(self.pend["k"])
                self.host.send(id, b, true)
            elif all_have
                b.add(HouseKey.MSG_CLOSE, 1)
                b.add(HouseKey.WIRE, 1)
                b.add(self.pend["v"], 1)
                self.host.send(id, b, false)
            end
        end
        if all_have && self.holds self.close_own() end
        if all_closed
            self.pend = nil
            self.keep()
        end
    end

    # --- what is said to this node -----------------------------------------------------------------------------------------

    def ack(dest, version, closed)
        var b = bytes()
        b.add(HouseKey.MSG_ACK, 1)
        b.add(HouseKey.WIRE, 1)
        b.add(version, 1)
        b.add(closed ? 1 : 0, 1)
        self.host.send(dest, b, false)
    end

    # the key, from a panel of the list: a version above the one in use is taken, and the panel is told; one this node has is told again
    def take_key(src, d)
        if size(d) != 35 || !self.host.list.is_panel(src) return end
        var v = d[2]
        if v == self.version
            self.ack(src, v, !self.holds)
            return
        end
        if !HouseKey.newer(v, self.version) return end
        if !HouseKey.give(d[3 .. 34].tohex(), v)
            log("HOUSE: the driver took no key from " + str(src), 1)
            return
        end
        self.version = v
        self.holds = true
        self.keep_cur(v, d[3 .. 34].tohex())
        self.ack(src, v, false)
    end

    # the panel's word that every node has the key: the previous key goes
    def take_close(src, d)
        if size(d) != 3 || !self.host.list.is_panel(src) || d[2] != self.version return end
        if self.holds self.close_own() end
        self.ack(src, d[2], true)
    end

    # a node says it has the key (1), or has closed (2)
    def take_ack(src, d)
        if self.pend == nil || size(d) != 4 || d[2] != self.pend["v"] return end
        if self.pend["to"].find(src) == nil return end
        var g = d[3] == 1 ? 2 : 1
        if self.pend["got"].find(src, 0) < g
            self.pend["got"][src] = g
            self.keep()
            self.sent.remove(src)
        end
        self.tick()
    end

    # the nodes that have not said they have the key: for the screen that says "Key change pending"
    def waiting()
        var out = []
        if self.pend == nil return out end
        for id: self.pend["to"]
            if self.pend["got"].find(id, 0) < 1 out.push(id) end
        end
        return out
    end

    # the nodes that have the key and have not said they closed the change (they close when every node has the key)
    def unclosed()
        var out = []
        if self.pend == nil return out end
        for id: self.pend["to"]
            if self.pend["got"].find(id, 0) == 1 out.push(id) end
        end
        return out
    end
end
