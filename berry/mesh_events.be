# mesh_events.be -- the mesh driver's events, taken by one rule and handed to the parts of the brain that take them. The house
# layer, the alarm's replica and MeshCmd each had rules of their own on EspNowMesh, and the rules engine matched every one of them at every event
# of the driver, a frame, an outcome or a note of the clock, and called the ones that had nothing to do with it. One rule takes the events now:
# a frame (the event that has Data) goes to the parts that take frames, and a Timeline, a Synced or an Outcome to the parts that take that, each
# kind in the order the parts were added, as the rules were. The OTA driver's events (EspNowOta: a neighbour heard in its safeboot image)
# come under a key of their own, and go to the parts of the kind "Ota".

#@ solidify:MeshEvents
class MeshEvents
    static RULE = "mesh_events"
    var kinds   # the kind ("frame", "Timeline", "Synced", "Outcome") -> [[id, f], ...], in the order they were added

    def init()
        self.kinds = {}
        # on a panel, in its one rule (panel_rules.be); on a bridge, a rule of Tasmota's
        import global
        var rules = global.contains("panel_rules") && global.panel_rules != nil ? global.panel_rules : tasmota
        rules.add_rule("EspNowMesh", / v -> self.dispatch(v), MeshEvents.RULE)
        rules.add_rule("EspNowOta", / v -> self.call("Ota", v), MeshEvents.RULE)
    end

    # the dispatcher of this device, made at its first use
    static def get()
        import global
        if !global.contains("mesh_events") || global.mesh_events == nil
            global.mesh_events = MeshEvents()
        end
        return global.mesh_events
    end

    # f(value) for the events of `kind`: "frame", the driver's map of a frame for this device, or "Timeline", "Synced", "Outcome", the map
    # under that key. One of the same id and kind is replaced, as tasmota.add_rule replaces a rule
    def add(kind, f, id)
        self.remove(kind, id)
        var l = self.kinds.find(kind)
        if l == nil
            l = []
            self.kinds[kind] = l
        end
        l.push([id, f])
    end

    def remove(kind, id)
        var l = self.kinds.find(kind)
        if l == nil return end
        var i = 0
        while i < size(l)
            if l[i][0] == id
                l.remove(i)
            else
                i += 1
            end
        end
    end

    # whether a part of this id takes events of some kind
    def has(id)
        for l: self.kinds
            for h: l
                if h[0] == id return true end
            end
        end
        return false
    end

    def dispatch(v)
        if !isinstance(v, map) return end
        if v.contains("Data")
            self.call("frame", v)
            return
        end
        for k: v.keys()
            self.call(k, v[k])
        end
    end

    # the parts of a kind, by their place: one that a part takes out while the event goes round is not called for it, as with the rules
    def call(kind, value)
        var l = self.kinds.find(kind)
        if l == nil return end
        var i = 0
        while i < size(l)
            l[i][1](value)
            i += 1
        end
    end
end
