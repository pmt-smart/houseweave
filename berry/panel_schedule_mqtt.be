# panel_schedule_mqtt.be -- the schedule on the house's MQTT: what the panel says of it, retained, for
# Home Assistant's calendars (the house's package), and the Schedule command they are edited with. Home
# Assistant only sees and asks: the panel checks every change, keeps it and runs it, with or without it.
#
# Retained, under houseweave/schedule/<panel>/, the panel's name being the one its backup has (PanelBackup.name):
#   panel         {"command": the Schedule command's topic, "result": where its answers go, "place": {"lat", "lon": in
#                 ten-thousandths of a degree, or nil; "tz": the time zone, in hours}}
#   device/<id>   each device of a kind the schedule turns on and off: {"name", "kind", "zone", "zoneName", "relay", "off"},
#                 "off" its schedule switched off
#   event/<uid>   each event: {"uid", "for", "devices", "kind", "day", "from", "to", "rrule", "rule", "exdates", "start",
#                 "end", "during"}: "to" and "end" nil for an event with no end, and "during" the start's words again, for
#                 who read it before the end had an action of its own
# and an empty one for a device or an event that is gone. A day is "2026-10-07", a time "18:00" or the sun "sunset" or
# "sunset-30"; the rrule is iCalendar's (PanelSchedule.rrule), and the rule the same as the schedule keeps it, for who
# expands the occurrences: {"freq": 1 daily, 2 weekly, 3 monthly, 4 yearly, "every", "days": the weekdays a bit each from
# Monday's 1, "until": its last day or nil}; the actions are the screens' words. A message is one
# thing, because Tasmota's MQTT takes 1200 bytes at most. It is all said again at every connection to the broker and a
# moment after every save of the configuration, one message at a time.
#
# The command, cmnd/<topic>/Schedule, takes {"n": the asker's number, "op": "put", "event": {"uid": nil for a new one,
# "for", "day", "from", "to", "rrule", "exdates", "start", "end"}}, {"n", "op": "delete", "uid"}, {"n", "op": "skip", "uid",
# "day"} for one occurrence, or {"n", "op": "end", "uid", "day"} for that one and the ones after, and answers
# {"Schedule": {"n", "ok": true, "uid"}} or {"Schedule": {"n", "ok": false, "error": the refusal, "message": the
# glass's words for it}}. An action comes in words, as Home Assistant's titles have it: "21°C", "heat 21.5", "60% blue",
# "warm", "on", "off", a blind's "open", "closed", "ventilation" or "70%", in any case, a zone's name before a colon and
# the sun in brackets after being left out. A "to" of nil, or none, is an event with no end; the start's words may be
# "during", as before, and may carry the end's after an arrow, "open -> closed", which is how a title says both. An event
# with an end and no words for it ends off, as every event did before.

#@ solidify:PanelScheduleMqtt
class PanelScheduleMqtt
    static TOPIC = "houseweave/schedule"
    static PACE_MS = 50       # between two messages
    static SETTLE_MS = 2000   # after a save, for the next one of a burst
    static WHITES = {"cool": 0, "neutral": 50, "warm": 100}

    var sched      # the PanelSchedule
    var screens    # the PanelScheduleView, for the words of a refusal
    var queue      # what is still to be said: ["panel"], ["device", id], ["event", uid] or ["gone", topic]
    var devices    # the devices said last, by id, and the events, by uid: what is gone is emptied
    var events
    var stamp      # counts the saves: a late moment for an older one does nothing
    var up         # on the broker at the last second

    def init(sched, screens)
        self.sched = sched
        self.screens = screens
        self.queue = []
        self.devices = []
        self.events = []
        self.stamp = 0
        self.up = false
        tasmota.add_cmd("Schedule", / cmd, idx, payload -> self.command(payload))
        tasmota.add_driver(self)
    end

    # the connection to the broker, watched: everything said when it comes up
    def every_second()
        import mqtt
        var up = mqtt.connected() == true
        if up && !self.up  self.later() end
        self.up = up
    end

    # a moment after a change, everything said again: a burst of saves is one telling
    def later()
        self.stamp += 1
        var s = self.stamp
        tasmota.set_timer(PanelScheduleMqtt.SETTLE_MS, / -> self.tell(s))
    end

    def base() return PanelScheduleMqtt.TOPIC + "/" + PanelBackup.name() + "/" end

    # What is said, in the queue, and what was said and is gone, emptied
    def tell(stamp)
        import mqtt
        if stamp != self.stamp || mqtt.connected() != true return end
        var store = self.sched.store
        var q = [["panel"]]
        var devices = []
        for d: store.doc["devices"]
            if PanelSchedule.KINDS.find(d[2]) != nil
                devices.push(d[0])
                q.push(["device", d[0]])
            end
        end
        var events = []
        for e: self.sched.events()
            events.push(e[0])
            q.push(["event", e[0]])
        end
        var b = self.base()
        for id: self.devices
            if devices.find(id) == nil  q.push(["gone", b + "device/" + id]) end
        end
        for uid: self.events
            if events.find(uid) == nil  q.push(["gone", b + "event/" + uid]) end
        end
        self.devices = devices
        self.events = events
        var was = size(self.queue)
        self.queue = q
        if was == 0  self.pump() end
    end

    # one message, and the next a moment after; each is made only as it goes. The next is armed before this one is made, and this one
    # on its own: a timer that raised is not called again, and a queue with nothing to pump it is one tell() never starts (it does
    # when it was empty), so an event that cannot be said would be the end of all of the schedule's word, until the next boot
    def pump()
        import mqtt
        if size(self.queue) == 0 || mqtt.connected() != true
            self.queue = []
            return
        end
        var m = self.queue[0]
        self.queue.remove(0)
        if size(self.queue) > 0  tasmota.set_timer(PanelScheduleMqtt.PACE_MS, / -> self.pump()) end
        try
            self.say(m)
        except .. as err, msg
            log("MQTT: the schedule's " + str(m[0]) + " could not be said (" + str(err) + ": " + str(msg) + ")", 1)
        end
    end

    # one message of the queue
    def say(m)
        import mqtt
        import json
        var b = self.base()
        var c = self.sched.clock
        if m[0] == "panel"
            mqtt.publish(b + "panel", json.dump({"command": PanelBackup.own_topic("Prefix1", "Schedule"), "result": PanelBackup.own_topic("Prefix2", "RESULT"),
                                                 "place": {"lat": c != nil ? c.lat : nil, "lon": c != nil ? c.lon : nil, "tz": c != nil ? c.tz : 0}}), true)
        elif m[0] == "device"
            var d = self.sched.store.find_device(m[1])
            if d != nil
                var z = self.sched.store.zone_of(m[1])
                mqtt.publish(b + "device/" + m[1], json.dump({"name": d[1], "kind": d[2], "zone": z != nil ? z["id"] : nil,
                                                              "zoneName": z != nil ? z["name"] : nil, "relay": d[9], "off": self.sched.is_off(m[1])}), true)
            end
        elif m[0] == "event"
            var e = self.sched.find(m[1])
            if e != nil  mqtt.publish(b + "event/" + m[1], json.dump(self.event_said(e)), true) end
        else
            mqtt.publish(m[1], "", true)
        end
    end

    # --- the words of the wire ---------------------------------------------------------------------------------------

    static def day_text(d)
        var ymd = PanelClock.date_of(d)
        return str(ymd[0]) + "-" + PanelClock.two(ymd[1]) + "-" + PanelClock.two(ymd[2])
    end

    static def parse_day(s)
        import string
        if type(s) != "string" || size(s) != 10 || s[4] != "-" || s[7] != "-" return nil end
        var y = PanelSchedule.number(s[0 .. 3])
        var m = PanelSchedule.number(s[5 .. 6])
        var d = PanelSchedule.number(s[8 .. 9])
        if y == nil || m == nil || d == nil || m < 1 || m > 12 || d < 1 || d > PanelClock.month_days(y, m) return nil end
        return PanelClock.days_of(y, m, d)
    end

    # a time: "18:00", or the sun, "sunrise", "sunset-30", "sunrise+15"
    static def time_word(t)
        if t < 1440 return PanelClock.hhmm(t) end
        var rise = t < PanelSchedule.SUNSET - 1000
        var m = t - (rise ? PanelSchedule.SUNRISE : PanelSchedule.SUNSET)
        return (rise ? "sunrise" : "sunset") + (m > 0 ? "+" : "") + (m != 0 ? str(m) : "")
    end

    # a time as the wire has it, or nil
    static def parse_time_word(s)
        import string
        if type(s) != "string" return nil end
        var w = string.tolower(s)
        var base = nil
        var rest = ""
        if string.find(w, "sunrise") == 0
            base = PanelSchedule.SUNRISE
            rest = w[7 ..]
        elif string.find(w, "sunset") == 0
            base = PanelSchedule.SUNSET
            rest = w[6 ..]
        else
            var hm = string.split(w, ":")
            if size(hm) != 2 || size(hm[1]) != 2 return nil end
            var h = PanelSchedule.number(hm[0])
            var m = PanelSchedule.number(hm[1])
            if h == nil || m == nil || h > 23 || m > 59 return nil end
            return h * 60 + m
        end
        if rest == "" return base end
        var sign = rest[0] == "-" ? -1 : (rest[0] == "+" ? 1 : 0)
        var m = sign != 0 ? PanelSchedule.number(rest[1 ..]) : nil
        if m == nil return nil end
        var t = base + sign * m
        return PanelSchedule.time_ok(t) ? t : nil
    end

    # What an action is, from its words: [the action], or nil for words the kind's screen has not. A zone's name before a
    # colon and the sun in brackets after are left out
    static def parse_during(kind, text)
        import string
        if type(text) != "string" return nil end
        var w = string.tolower(text)
        var colon = string.find(w, ":")
        if colon >= 0  w = w[colon + 1 ..] end
        var bracket = string.find(w, "[")
        if bracket >= 0  w = w[0 .. bracket - 1] end
        var words = []
        for x: string.split(w, " ")
            if x != ""  words.push(x) end
        end
        if size(words) == 1 && words[0] == "off" return ["off"] end
        if kind == "cover"
            # a blind's: all the way up or down, its ventilation, or a place
            if size(words) != 1 return nil end
            var c = words[0]
            if c == "open" return [100] end
            if c == "closed" || c == "close" return [0] end
            if c == "ventilation" || c == "vent" return ["vent"] end
            var p = string.find(c, "%") == size(c) - 1 ? PanelSchedule.number(c[0 .. size(c) - 2]) : nil
            return p != nil && p <= 100 ? [p] : nil
        end
        if kind == "thermostat"
            if size(words) > 0 && words[0] == "heat"  words.remove(0) end
            if size(words) != 1 return nil end
            var n = string.replace(string.replace(string.replace(words[0], "°c", ""), "°", ""), ",", ".")
            if size(n) > 0 && n[size(n) - 1] == "c"  n = n[0 .. size(n) - 2] end
            var dot = string.find(n, ".")
            var whole = PanelSchedule.number(dot >= 0 ? n[0 .. dot - 1] : n)
            var tenth = dot >= 0 ? PanelSchedule.number(n[dot + 1 ..]) : 0
            if whole == nil || tenth == nil || (dot >= 0 && size(n) - dot != 2) return nil end
            return [whole * 10 + tenth]
        end
        if kind != "light"
            return size(words) == 0 || (size(words) == 1 && words[0] == "on") ? [nil] : nil
        end
        var out = [nil, nil, nil]
        for x: words
            var p = PanelSchedule.number(string.replace(x, "%", ""))
            if x == "on"
                continue
            elif p != nil && string.find(x, "%") == size(x) - 1 && p >= 1 && p <= 100
                out[0] = p
            elif PanelScheduleMqtt.WHITES.contains(x)
                out[1] = PanelScheduleMqtt.WHITES[x]
            else
                var hue = nil
                for h: PanelScheduleView.HUES
                    if string.tolower(h[1]) == x  hue = h[0] * 100 / 360 end
                end
                if hue == nil return nil end
                out[2] = hue
            end
        end
        if out[1] != nil && out[2] != nil return nil end
        return [out[0] == nil && out[1] == nil && out[2] == nil ? nil : out]
    end

    # a rule as the wire says it, or nil for an event that does not repeat
    static def rule_said(r)
        if r == nil return nil end
        return {"freq": r[0], "every": r[1], "days": r[2], "until": r[3] != 0 ? PanelScheduleMqtt.day_text(r[3]) : nil}
    end

    # an event as the wire says it
    def event_said(e)
        var f = e[1]
        var who = self.screens.subject(f)
        var skips = []
        for x: e[6]  skips.push(PanelScheduleMqtt.day_text(x)) end
        var c = self.sched.clock
        return {"uid": e[0], "for": f, "devices": self.sched.devices_of(f), "kind": who[0], "day": PanelScheduleMqtt.day_text(e[2]),
                "from": PanelScheduleMqtt.time_word(e[3]), "to": e[4] != nil ? PanelScheduleMqtt.time_word(e[4]) : nil,
                "rrule": PanelSchedule.rrule(e[5], c != nil ? c.tz : 0), "rule": PanelScheduleMqtt.rule_said(e[5]), "exdates": skips,
                "start": PanelScheduleView.during_text(who[0], e[7]),
                "end": e[4] != nil ? PanelScheduleView.during_text(who[0], PanelSchedule.end_of(e)) : nil,
                "during": PanelScheduleView.during_text(who[0], e[7])}
    end

    # --- the command -------------------------------------------------------------------------------------------------

    # Schedule <json>: the change, saved when it is taken, and the answer
    def command(payload)
        import json
        var q = json.load(str(payload))
        var r = isinstance(q, map) ? self.run(q) : PanelStore.refuse("bad_request", nil)
        var a = {"n": isinstance(q, map) ? q.find("n") : nil, "ok": r["ok"]}
        if r["ok"]
            if r.find("value") != nil  a["uid"] = r["value"] end
            self.sched.store.save()
        else
            a["error"] = r["refusal"]
            a["message"] = self.screens.message(r)
        end
        tasmota.resp_cmnd(json.dump({"Schedule": a}))
    end

    def run(q)
        var op = q.find("op")
        if op == "put" return self.put(q.find("event")) end
        if op == "delete" return self.sched.delete(q.find("uid")) end
        if op == "skip" || op == "end"
            var day = PanelScheduleMqtt.parse_day(q.find("day"))
            if day == nil return PanelStore.refuse("bad_day", nil) end
            return op == "skip" ? self.sched.skip(q.find("uid"), day) : self.sched.end_before(q.find("uid"), day)
        end
        return PanelStore.refuse("bad_request", op)
    end

    # an event from the wire, checked by the schedule as one from the glass
    def put(ev)
        if !isinstance(ev, map) return PanelStore.refuse("bad_event", nil) end
        var f = ev.find("for")
        var kind = self.screens.subject(f)[0]
        if !isinstance(f, list) && kind == nil return PanelStore.refuse("no_such_device", f) end
        var day = PanelScheduleMqtt.parse_day(ev.find("day"))
        var from = PanelScheduleMqtt.parse_time_word(ev.find("from"))
        # an event with no end has no "to", or a nil or empty one
        var word = ev.find("to")
        var to = word != nil && word != "" ? PanelScheduleMqtt.parse_time_word(word) : nil
        if day == nil || from == nil || (word != nil && word != "" && to == nil) return PanelStore.refuse("bad_time", nil) end
        var rule = nil
        var rr = ev.find("rrule")
        if rr != nil && rr != ""
            var c = self.sched.clock
            rule = PanelSchedule.parse_rrule(rr, day, from < 1440 ? from : 0, c != nil ? c.tz : 0)
            if rule == nil return PanelStore.refuse("bad_rule", nil) end
        end
        var skips = []
        for x: ev.find("exdates", [])
            var d = PanelScheduleMqtt.parse_day(x)
            if d == nil return PanelStore.refuse("bad_skip", nil) end
            skips.push(d)
        end
        # the start's words, and the end's, after an arrow in them or on their own; an end with none is off
        import string
        var said = str(ev.find("start", ev.find("during", "")))
        var arrow = string.find(said, "->")
        var then = ev.find("end")
        if arrow >= 0
            if then == nil  then = said[arrow + 2 ..] end
            said = arrow > 0 ? said[0 .. arrow - 1] : ""
        end
        var w = PanelScheduleMqtt.parse_during(kind, said)
        var ending = to != nil && then != nil ? PanelScheduleMqtt.parse_during(kind, str(then)) : ["off"]
        if w == nil || ending == nil return PanelStore.refuse("bad_during", kind) end
        return self.sched.put([ev.find("uid"), isinstance(f, list) ? f : str(f), day, from, to, rule, skips, w[0], to != nil ? ending[0] : nil])
    end
end
