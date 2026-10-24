# panel_rules.be -- the panel's Tasmota rules, taken by one. Each rule of Tasmota's keeps a trigger, a matcher of each level of its pattern and the
# pattern's strings in the heap, some 350 bytes, and the panel's brain set about thirty of them (the relays, the buttons, the clock, the Wi-Fi, the
# station's answers, the events of the bridges, the pairing, the house's screens, the mesh). One rule of Tasmota's, of any key ("?"), takes every event
# now, and this hands it to the parts whose pattern it has, each key in the order the parts were added, as the rules were.
#
# THE PATTERNS are keys alone, "Power1#State", matched as Tasmota matches them, in any case, and each part is called as a rule is, f(value, pattern,
# event). A pattern with an operator ("Dimmer>50"), an index or a wildcard is not one of these, and stays a rule of Tasmota's.
#
# WHO SETS THEM: a part of the brain asks of() where its rules go, which is this on a panel whose boot made it (start) and Tasmota where none was made,
# the bridge and a test: both take add_rule(pattern, f, id) and remove_rule(pattern, id).
#
# A PART THAT FAILS is logged, and the others are called all the same: a rule of Tasmota's that raised left the rules after it uncalled.
#
# THE RESULT: the one rule takes every event, so Berry says to Tasmota that each was handled. That matters only where a build has the rules or the
# scripter (USE_RULES, USE_SCRIPT), where a button's event that a rule handled does not toggle its relay; this firmware has neither, and the button's
# relay is not the rules' to keep.

#@ solidify:PanelRules
class PanelRules
    static RULE = "panel_rules"
    var keys    # the event's key in capitals -> four slots a part, in the order they were added: the pattern's next key (a list of them for more than one,
                # nil for none), the pattern, f and the id. One list a key, and no list a part: a part is the four slots of a list that is already there

    def init()
        self.keys = {}
        tasmota.add_rule("?", / v, t, m -> self.run(m), PanelRules.RULE)
    end

    # The panel's one, made by the boot before any part of the brain sets a rule
    static def start()
        import global
        if !global.contains("panel_rules") || global.panel_rules == nil  global.panel_rules = PanelRules() end
        return global.panel_rules
    end

    # where a part's rules go: the panel's one, or Tasmota's own where there is none
    static def of()
        import global
        return global.contains("panel_rules") && global.panel_rules != nil ? global.panel_rules : tasmota
    end

    # As tasmota.add_rule: f(value, pattern, event) for the events that have the pattern's keys; one of the same pattern and id is replaced
    def add_rule(pattern, f, id)
        import string
        var keys_only = type(pattern) == "string" && size(pattern) > 0
        if keys_only
            for c: ["?", "[", "=", "<", ">", "!", "|", "$", "^"]
                if string.find(pattern, c) >= 0  keys_only = false end
            end
        end
        if !keys_only  raise "value_error", "not a pattern of keys: " + str(pattern) end
        if id != nil  self.remove_rule(pattern, id) end
        var parts = string.split(pattern, "#")
        var key = string.toupper(parts[0])
        var l = self.keys.find(key)
        if l == nil
            l = []
            self.keys[key] = l
        end
        l.push(size(parts) == 1 ? nil : (size(parts) == 2 ? parts[1] : parts[1 ..]))
        l.push(pattern)
        l.push(f)
        l.push(id)
    end

    def remove_rule(pattern, id)
        import string
        var l = self.keys.find(string.toupper(string.split(str(pattern), "#")[0]))
        if l == nil return end
        var i = 0
        while i < size(l)
            if l[i + 1] == pattern && l[i + 3] == id
                for n: 1 .. 4  l.remove(i) end
            else
                i += 4
            end
        end
    end

    # An event: each of its keys to the parts of that key whose other keys it has, in the order they were added. A part taken out while the event goes
    # round is not called for it
    def run(ev)
        if !isinstance(ev, map) return end
        import string
        for k: ev.keys()
            var l = self.keys.find(string.toupper(str(k)))
            if l == nil continue end
            var i = 0
            while i < size(l)
                var f = l[i + 2]
                var v = PanelRules.under(ev[k], l[i])
                if v != nil
                    try
                        f(v, l[i + 1], ev)
                    except .. as e, m
                        log("PANEL: the rule " + str(l[i + 1]) + " failed - " + str(e) + ": " + str(m), 1)
                    end
                end
                # the next part, unless this one went while it ran: then the next is where it was
                if i + 2 < size(l) && l[i + 2] == f  i += 4 end
            end
        end
    end

    # what an event's value has under the pattern's other keys: the value itself for none, or nil when it lacks one
    static def under(v, next)
        if next == nil return v end
        if type(next) == "string" return PanelRules.find_i(v, next) end
        for p: next
            v = PanelRules.find_i(v, p)
            if v == nil return nil end
        end
        return v
    end

    # the value of a key of a map, in any case, as Tasmota's matcher finds it, or nil
    static def find_i(m, key)
        if !isinstance(m, map) return nil end
        if m.contains(key) return m[key] end
        import string
        var u = string.toupper(key)
        for k: m.keys()
            var s = str(k)
            if size(s) == size(u) && string.toupper(s) == u return m[k] end
        end
        return nil
    end
end
