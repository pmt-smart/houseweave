# panel_gate.be -- the buttons of a device are not there while the bridge that owns it is not ready: no device is acted on by a bridge
# that is not in step.
#
# A device of another room (PanelStore.owner_of) is acted on by that room's bridge. The panel knows, from the mesh's heartbeats (espnow_mesh_neighbors), whether that bridge
# is there and in step: heard, not silent, and with the bit "synced" of the byte 19 of its heartbeat on. While it is not, the devices are marked as with no communication (the
# icon of the four that already exist: PanelZigbee.gate) and their tap does nothing (PanelStore.toggle_state: no power to act on), BEFORE the touch, and not after as a "?" two
# seconds later; and what the panel says of them, PanelRoute refuses.
#
# The hysteresis: no flicker. A bridge goes unavailable at once when it is silent (the mesh's "mute", 25 s after its last heartbeat, and not "suspect", which comes first and
# changes nothing), not heard at all, or says it is not in step; and it is available again only after NEED heartbeats in a row that say it is. A heartbeat is told from the
# last by the time since it: `beat` goes back down.
#
# The devices of the bridge the panel is paired with are not gated: a group on its own acts on its own. Only the devices of other bridges are.
#
# It is a driver of its own, which looks at the mesh every second, and gives the panel's way of marking a device as `apply`.
#
# THE OWN BRIDGE. With `own` (a closure, the number the house gives the panel's own bridge, or 0) it looks at that bridge the same way,
# and tells `on_own` whether it is ready each time that changes: the room's session over the mesh (ZigbeeBridge.mesh_session). Its devices are never held.

#@ solidify:PanelGate
class PanelGate
    static NEED = 2

    var store      # the panel's configuration: whose a device is
    var apply      # a closure (ieee, off) -> nothing: marks a device as not to be acted on, or lifts it
    var good       # node -> the heartbeats in a row that said it is in step
    var last       # node -> the `beat` of the last look: a smaller one is a new heartbeat
    var ready      # node -> whether it is available
    var why        # node -> the reason it is not
    var held       # ieee -> true: the devices this gate marked
    var own        # a closure -> the own bridge's number, or 0; nil without one
    var on_own     # a closure (ready) -> nothing, told when the own bridge's readiness changes, or nil
    var own_said   # what on_own was last told
    var others     # a closure -> the numbers of the house's other bridges, looked at too (a search opens one with no device here yet), or nil

    def init(store, apply)
        self.store = store
        self.apply = apply
        self.good = {}
        self.last = {}
        self.ready = {}
        self.why = {}
        self.held = {}
        tasmota.add_driver(self)
    end

    # the neighbours of the mesh that are nodes of the house (house_mesh.be, neighbors()), or nil where there is no mesh
    static def mesh()
        import global
        if !global.contains("espnow_mesh_neighbors") return nil end
        if global.contains("house") && global.house != nil return global.house.neighbors() end
        var l = global.espnow_mesh_neighbors()
        return isinstance(l, list) ? l : nil
    end

    # the house's numbers, m (number -> true; house_mesh.be, sweep()): what this gate kept of a bridge that is no more goes, and the marks of devices no bridge of
    # the house owns
    def sweep(m)
        for t: [self.good, self.last, self.ready, self.why]
            var drop = []
            for k: t.keys()
                if !m.contains(k)  drop.push(k) end
            end
            for k: drop  t.remove(k) end
        end
        var gone = []
        for ieee: self.held.keys()
            if !m.contains(self.store.owner_of(ieee))  gone.push(ieee) end
        end
        for ieee: gone  self.held.remove(ieee) end
    end

    # whether a neighbour says it is in step: the bit 0 of the byte 19 of its heartbeat
    static def in_step(n)
        var info = n.find("info")
        if type(info) != "string" return false end
        var b = bytes(info)
        return size(b) > 19 && (b[19] & 1) != 0
    end

    def every_second()
        self.tick()
    end

    def tick()
        var owners = self.store.remote_by_owner()
        var mesh = PanelGate.mesh()
        for node: owners.keys() self.look(node, mesh) end
        var o = self.own != nil ? self.own() : 0
        if o > 0 && !owners.contains(o) self.look(o, mesh) end
        var more = self.others != nil ? self.others() : []
        for node: more
            if node != o && !owners.contains(node)  self.look(node, mesh) end
        end
        # a device no longer another room's is not held, nor one of a bridge the panel no longer shows anything of
        var lifted = []
        for ieee: self.held.keys()
            if !self.store.is_remote(ieee) lifted.push(ieee) end
        end
        for ieee: lifted
            self.held.remove(ieee)
            if self.apply != nil self.apply(ieee, false) end
        end
        var gone = []
        for node: self.ready.keys()
            if !owners.contains(node) && node != o && more.find(node) == nil gone.push(node) end
        end
        for node: gone
            self.ready.remove(node)
            self.good.remove(node)
            self.last.remove(node)
            self.why.remove(node)
        end
        var r = o > 0 && self.ready.find(o, false)
        if r != self.own_said
            self.own_said = r
            if self.on_own != nil self.on_own(r) end
        end
        for node: owners.keys()
            for ieee: owners[node]
                var off = !self.ready.find(node, false)
                if self.held.contains(ieee) != off
                    if off self.held[ieee] = true else self.held.remove(ieee) end
                    if self.apply != nil self.apply(ieee, off) end
                end
            end
        end
    end

    # how a bridge is heard (house_mesh.be, heard_by): its own heartbeat, or, two hops away, the one of the neighbour whose heartbeat lists it; nil
    # where there is no mesh or no house, which look() reads the neighbours for itself
    static def heard_by(node, l)
        import global
        if !global.contains("house") || global.house == nil return nil end
        return global.house.heard_by(node, l)
    end

    # one bridge, at this look: as a neighbour, or two hops away by the neighbour that hears it, which the bridge's own heartbeat is not repeated past
    def look(node, mesh)
        var n = PanelGate.heard_by(node, mesh)
        if n == nil && mesh != nil
            for x: mesh
                if isinstance(x, map) && x.find("id") == node n = x end
            end
        end
        if n == nil
            self.down(node, "Bridge not heard")
            return
        end
        var state = n.find("state", 2)
        if state == 2
            self.down(node, "Bridge off")
            return
        end
        if state == 1 return end
        if !PanelGate.in_step(n)
            self.down(node, "Bridge syncing")
            return
        end
        var beat = n.find("beat", -1)
        var was = self.last.find(node)
        self.last[node] = beat
        if beat < 0 return end
        if was == nil || beat < was self.good[node] = self.good.find(node, 0) + 1 end
        if self.good.find(node, 0) >= PanelGate.NEED
            self.ready[node] = true
            self.why.remove(node)
        elif !self.ready.find(node, false)
            self.why[node] = "Bridge starting"
        end
    end

    def down(node, reason)
        self.ready[node] = false
        self.good[node] = 0
        self.last.remove(node)
        self.why[node] = reason
    end

    # whether the device may be acted on: the panel's own always are, another room's when its bridge is ready
    def available(dev)
        var node = self.store.owner_of(dev)
        return node == 0 || self.ready.find(node, false)
    end

    # why not, as the device's page says it, or nil when it may
    def reason(dev)
        var node = self.store.owner_of(dev)
        if node == 0 || self.ready.find(node, false) return nil end
        return self.why.find(node, "Bridge not heard")
    end
end
