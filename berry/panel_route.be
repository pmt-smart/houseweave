# panel_route.be -- where a line of the panel's goes: over the mesh, to the bridge that owns the device, or to the bridge of the house.
#
# Every line the panel sends about a device (a ZbSend, a ping, a leave, a forget, a name told to Home Assistant) goes through send(). The device is read from
# the line, as the panel writes it (the "Device" of a ZbSend, the "IEEE" of a name, the address of a ping, a leave or a forget), and the store says whose it is
# (PanelStore.owner_of): the number in the house of the bridge that owns it, which MeshCmd sends the line to (mesh_cmd.be: the stamp of the mesh's clock in
# front of the line, the owner's admission, and the line run there). A group's command goes to every bridge that holds members of the group
# (PanelStore.group_bridges), since a zone's group is on each of them.
#
# THE BRIDGE OF THE HOUSE. A line that names no device (the house's words: the alarm's, the time, the map of a network, the settings
# of the radio), and one about a device of no bridge numbered, goes to the bridge the boot says (`own`, a closure: the panel's favourite in step on the mesh, or
# another bridge in step), while it is in step (`ready`). A panel has no link of its own: with no such bridge, the line does not leave.
#
# A line that could not be sent (no bridge of the house, the node is not synced, the mesh is not there, the line is too long, the queue is full) is false, and the
# reason is counted, in `refused`: the panel's pending mark ("?") is what tells the person. A line the mesh took and then gave up is not sent again: by then it
# may be older than one sent after it.

#@ solidify:PanelRoute
class PanelRoute

    var store      # the panel's configuration: whose a device is
    var cmd        # the MeshCmd that sends a line to another node, or nil where the image has no mesh
    var gate       # the gate (panel_gate.be): whether the bridge that owns a device is ready to act on it, or nil
    var own        # a closure -> the number of the bridge of the house, or 0; nil without a house
    var ready      # a closure -> whether the bridge of the house is in step on the mesh, or nil for always
    var refused    # the reason -> how many lines were not sent
    var sent       # how many were

    def init(store, cmd)
        self.store = store
        self.cmd = cmd
        self.refused = {}
        self.sent = 0
    end

    # the device a line is for, as its IEEE, or nil when it is for none: {"Device":"0x.."} of a ZbSend, {"IEEE":"0x.."} of a name, or the address after a ping's word
    static def device_of(line)
        import string
        # a driver's word, {"id":"0x.."} of a ZbRelayDrive: to the bridge whose driver has the device (a Moes curtain on
        # another bridge was driven at the bridge of the house, which had no driver for it and said "nodriver")
        if string.find(line, "ZbRelayDrive ") == 0
            var d = string.find(line, "\"id\":\"")
            if d < 0 return nil end
            var tail = line[d + 6 ..]
            var e = string.find(tail, "\"")
            return e < 0 ? nil : tail[0 .. e - 1]
        end
        for key: ['"Device":"', '"IEEE":"']
            var i = string.find(line, key)
            if i >= 0
                var rest = line[i + size(key) ..]
                var j = string.find(rest, '"')
                return j < 0 ? nil : rest[0 .. j - 1]
            end
        end
        # the address after a ping's word, a leave's, a forget's (said to the bridge that owns the device) and a ZbInfo's
        var space = string.find(line, " ")
        var w = space > 0 ? string.toupper(line[0 .. space - 1]) : ""
        if w == "ZBPING" || w == "ZBLEAVE" || w == "ZBFORGET" || w == "ZBINFO"
            var arg = line[space + 1 ..]
            return string.find(arg, "0x") == 0 ? arg : nil
        end
        return nil
    end

    # the group a line is for, by its "Group", or nil
    static def group_of(line)
        import string
        var i = string.find(line, '"Group":')
        if i < 0 return nil end
        var rest = line[i + 8 ..]
        var k = 0
        while k < size(rest) && rest[k] >= '0' && rest[k] <= '9'  k += 1 end
        return k > 0 ? int(rest[0 .. k - 1]) : nil
    end

    # a command line's word, in capitals
    static def word(line)
        import string
        var i = string.find(line, " ")
        return string.toupper(i < 0 ? line : line[0 .. i - 1])
    end

    def count(why)
        self.refused[why] = self.refused.find(why, 0) + 1
    end

    # one line: whether it left
    def send(line)
        var dev = PanelRoute.device_of(line)
        if dev == nil
            var zid = PanelRoute.group_of(line)
            var held = zid != nil ? self.store.group_bridges(zid) : []
            if size(held) == 0 || (size(held) == 1 && held[0] == 0) return self.own_line(line) end
            var left = false
            for n: held
                if n == 0 ? self.own_line(line) : self.to_node(n, line, nil)  left = true end
            end
            return left
        end
        var node = self.store.owner_of(dev)
        return node == 0 ? self.own_line(line) : self.to_node(node, line, dev)
    end

    # a line to the bridge `node`, 0 for the bridge of the house: what is said of a device the panel no longer has (its leave from the house),
    # a search's window, a bridge's admin
    def send_at(node, line)
        var own = self.own != nil ? self.own() : 0
        return node == 0 || node == own ? self.own_line(line) : self.to_node(node, line, nil)
    end

    # a line of the bridge of the house, while it is in step
    def own_line(line)
        var own = self.own != nil && self.cmd != nil ? self.own() : 0
        if own <= 0 || (self.ready != nil && !self.ready())
            self.count("no bridge of the house")
            return false
        end
        if self.cmd.send(own, line, nil) == false
            self.count(self.cmd.why)
            return false
        end
        self.sent += 1
        return true
    end

    # a line to the bridge `node` over the mesh: about its device `dev`, or a group's (dev nil), while the gate says the bridge is ready
    def to_node(node, line, dev)
        if self.cmd == nil
            self.count("no mesh")
            return false
        end
        if self.gate != nil && !(dev != nil ? self.gate.available(dev) : self.gate.ready.find(node, false))
            self.count("bridge not ready")
            return false
        end
        if self.cmd.send(node, line, nil) == false
            self.count(self.cmd.why)
            return false
        end
        self.sent += 1
        return true
    end
end
