# boiler_history.be -- what a water heater's thermostat measured, kept on the appliance itself (boiler_thermostat.be): the water and the time its
# heater was on, for a chart a panel draws of them.
#
# TWO SERIES, each a ring in RAM, written to the file system every hour and before a restart: an OTA leaves the file system as it is, and a restart
# loses nothing.
#   the slots   one every SLOT_S, SLOTS of them (a week): the water at the end of the slot, in half degrees (NONE with no reading in it), and the minutes
#               the heater was on in it, with the bit EXC for a slot the appliance filled with no clock
#   the days    one a day, DAYS of them (a year): the lowest and the highest water of the day, in half degrees, and the minutes the heater was on
# A slot's place is its number, the local time over SLOT_S; a day's, the slot's number over the slots of a day. The slots the appliance was not there to
# fill are NONE.
#
# WITH NO CLOCK a slot has no place. The appliance still fills one every SLOT_S, and keeps them in order (pending, a day of them at most); when the
# clock comes they take the places just before that moment, with EXC, which is how the chart tells the time the appliance ran with no clock.
#
# THE CHART is drawn from two series made of the rings when a panel asks (day_series, month_series): the last day in steps of a quarter of an
# hour, and the last thirty days, each as bytes.
#
# Compiled into the appliance's firmware: one class, nothing at the top, every module imported where it is used.

#@ solidify:BoilerHistory
class BoilerHistory
    static FILE = "boiler_history.bin"
    static MAGIC = 0x4842
    static WIRE = 1
    static HEAD = 12
    static SLOT_S = 300
    static SLOTS = 2016
    static DAY_SLOTS = 288
    static DAYS = 365
    static NONE = 255
    static EXC = 0x80
    static PENDING_MAX = 288
    # what a chart of the last day and one of the last month are drawn from: a quarter of an hour a step, a day of them, and thirty days
    static STEP_SLOTS = 3
    static DAY_STEPS = 96
    static MONTH_DAYS = 30

    var file       # the file it is kept in
    var slots      # bytes, 2 a slot: the water, and the minutes on with EXC
    var days       # bytes, 4 a day: the lowest water, the highest, and the minutes on (2, the low byte first)
    var last       # the number of the newest slot written, or nil for none
    var day        # the number of the newest day written, or nil for none
    var slot       # the number of the slot being filled, or nil with no clock
    var water      # the last reading in the slot being filled, in tenths of a degree, or nil for none
    var on_s       # the seconds the heater was on in it
    var ticks      # the seconds of it gone by
    var exc        # part of it went with no clock
    var pending    # the slots filled with no clock, the oldest first: [water, minutes]
    var dirty      # changed since it was saved

    def init(file)
        self.file = file != nil ? file : BoilerHistory.FILE
        self.clear_slots()
        self.clear_days()
        self.slot = nil
        self.water = nil
        self.on_s = 0
        self.ticks = 0
        self.exc = false
        self.pending = []
        self.dirty = false
    end

    # no slot kept: every one with no reading
    def clear_slots()
        var s = bytes()
        s.resize(BoilerHistory.SLOTS * 2)
        for i: 0 .. BoilerHistory.SLOTS - 1  s[i * 2] = BoilerHistory.NONE end
        self.slots = s
        self.last = nil
    end

    # no day kept: every one with no reading
    def clear_days()
        var d = bytes()
        d.resize(BoilerHistory.DAYS * 4)
        for i: 0 .. BoilerHistory.DAYS - 1
            d[i * 4] = BoilerHistory.NONE
            d[i * 4 + 1] = BoilerHistory.NONE
        end
        self.days = d
        self.day = nil
    end

    # a temperature in tenths of a degree as half degrees, 0 to 127 degrees; NONE for none
    static def half(tenths)
        if tenths == nil return BoilerHistory.NONE end
        var h = (tenths + 2) / 5
        if h < 0  h = 0 end
        if h > 254  h = 254 end
        return h
    end

    # One second of the thermostat: the local time, nil with no clock, the water in tenths of a degree, nil with no reading, and whether the heater is
    # on. The slot that ended is written, or kept in order with no clock; the first second with a clock gives the slots kept their places
    def tick(local, water, heating)
        if local == nil
            self.slot = nil
            if self.ticks >= BoilerHistory.SLOT_S  self.close(nil) end
            self.exc = true
        else
            var n = local / BoilerHistory.SLOT_S
            if self.slot == nil
                self.place(n)
                self.slot = n
            elif n != self.slot
                self.close(n)
            end
        end
        # this second is of the slot that is being filled now
        if water != nil  self.water = water end
        if heating  self.on_s += 1 end
        self.ticks += 1
    end

    # the slot being filled is over, and the one numbered `n` begins (nil with no clock): written in its place, or kept in order
    def close(n)
        var w = BoilerHistory.half(self.water)
        var m = (self.on_s + 30) / 60
        if m > 127  m = 127 end
        if self.slot != nil
            self.put(self.slot, w, m | (self.exc ? BoilerHistory.EXC : 0))
            if n != nil && n % 12 == 0  self.save() end
        else
            self.pending.push([w, m])
            while size(self.pending) > BoilerHistory.PENDING_MAX  self.pending.remove(0) end
        end
        self.water = nil
        self.on_s = 0
        self.ticks = 0
        self.exc = false
        self.slot = n
    end

    # the clock came, at the slot `n`: the slots kept with no clock are the ones just before it, the newest the last
    def place(n)
        var k = size(self.pending)
        if k == 0 return end
        var i = 0
        while i < k
            self.put(n - (k - i), self.pending[i][0], self.pending[i][1] | BoilerHistory.EXC)
            i += 1
        end
        self.pending = []
    end

    # One slot written at its number. The slots between the newest written and it, which nothing filled, are NONE; one numbered at or before the
    # newest is written over what is there, as a clock set back has it
    def put(n, w, m)
        if self.last != nil && n > self.last
            var gap = n - self.last - 1
            if gap >= BoilerHistory.SLOTS
                self.clear_slots()
            else
                var k = 1
                while k <= gap
                    self.set_slot(self.last + k, BoilerHistory.NONE, 0)
                    k += 1
                end
            end
        end
        self.set_slot(n, w, m)
        if self.last == nil || n > self.last  self.last = n end
        self.sum_day(n / BoilerHistory.DAY_SLOTS, w, m & 0x7F)
        self.dirty = true
    end

    def set_slot(n, w, m)
        var i = (n % BoilerHistory.SLOTS) * 2
        self.slots[i] = w
        self.slots[i + 1] = m
    end

    # a slot's water and minutes into its day: a day that begins, and the days between it and the newest written, start with no reading
    def sum_day(d, w, minutes)
        if self.day == nil || d - self.day >= BoilerHistory.DAYS
            self.clear_days()
            self.day = d
        elif d > self.day
            var x = self.day + 1
            while x <= d
                var j = (x % BoilerHistory.DAYS) * 4
                self.days[j] = BoilerHistory.NONE
                self.days[j + 1] = BoilerHistory.NONE
                self.days[j + 2] = 0
                self.days[j + 3] = 0
                x += 1
            end
            self.day = d
        end
        var i = (d % BoilerHistory.DAYS) * 4
        if w != BoilerHistory.NONE
            if self.days[i] == BoilerHistory.NONE || w < self.days[i]  self.days[i] = w end
            if self.days[i + 1] == BoilerHistory.NONE || w > self.days[i + 1]  self.days[i + 1] = w end
        end
        var total = self.days[i + 2] | (self.days[i + 3] << 8)
        total += minutes
        if total > 1440  total = 1440 end
        self.days[i + 2] = total & 0xFF
        self.days[i + 3] = (total >> 8) & 0xFF
    end

    # the slot numbered `n`: [the water in half degrees or NONE, the minutes on, whether it went with no clock], or nil for one the ring does not hold
    def slot_at(n)
        if self.last == nil || n > self.last || n <= self.last - BoilerHistory.SLOTS return nil end
        var i = (n % BoilerHistory.SLOTS) * 2
        var m = self.slots[i + 1]
        return [self.slots[i], m & 0x7F, (m & BoilerHistory.EXC) != 0]
    end

    # the day numbered `d`: [the lowest water, the highest, in half degrees or NONE, the minutes on], or nil for one the ring does not hold
    def day_at(d)
        if self.day == nil || d > self.day || d <= self.day - BoilerHistory.DAYS return nil end
        var i = (d % BoilerHistory.DAYS) * 4
        return [self.days[i], self.days[i + 1], self.days[i + 2] | (self.days[i + 3] << 8)]
    end

    # --- the series a chart is drawn from --------------------------------------------------------

    # The last day, at the local time `local`: DAY_STEPS steps of STEP_SLOTS slots, the last the one that time is in, 2 bytes each: the water at
    # the step's end, in half degrees (NONE for a step with no reading), and the minutes the heater was on in it, with EXC for a step that went
    # with no clock
    def day_series(local)
        var out = bytes()
        var last = local / BoilerHistory.SLOT_S / BoilerHistory.STEP_SLOTS
        var k = last - BoilerHistory.DAY_STEPS + 1
        while k <= last
            var w = BoilerHistory.NONE
            var m = 0
            var i = 0
            while i < BoilerHistory.STEP_SLOTS
                var s = self.slot_at(k * BoilerHistory.STEP_SLOTS + i)
                if s != nil
                    if s[0] != BoilerHistory.NONE  w = s[0] end
                    m = (m & BoilerHistory.EXC) | ((m & 0x7F) + s[1]) | (s[2] ? BoilerHistory.EXC : 0)
                end
                i += 1
            end
            out.add(w, 1)
            out.add(m, 1)
            k += 1
        end
        return out
    end

    # The last month, at the local time `local`: MONTH_DAYS days, the last the one that time is in, 4 bytes each, as the ring keeps a day: the
    # lowest and the highest water, in half degrees (NONE for a day with no reading), and the minutes the heater was on, the low byte first
    def month_series(local)
        var out = bytes()
        var last = local / BoilerHistory.SLOT_S / BoilerHistory.DAY_SLOTS
        var d = last - BoilerHistory.MONTH_DAYS + 1
        while d <= last
            var x = self.day_at(d)
            out.add(x != nil ? x[0] : BoilerHistory.NONE, 1)
            out.add(x != nil ? x[1] : BoilerHistory.NONE, 1)
            out.add(x != nil ? x[2] : 0, 2)
            d += 1
        end
        return out
    end

    # --- the file -------------------------------------------------------------------------------

    # the two rings as the file keeps them: a head, the slots and the days
    def image()
        var b = bytes()
        b.add(BoilerHistory.MAGIC, 2)
        b.add(BoilerHistory.WIRE, 1)
        b.add(0, 1)
        b.add(self.last != nil ? self.last : -1, 4)
        b.add(self.day != nil ? self.day : -1, 4)
        b .. self.slots
        b .. self.days
        return b
    end

    # the rings out of what a file kept: false, and nothing changed, for what is not one
    def take(b)
        var want = BoilerHistory.HEAD + BoilerHistory.SLOTS * 2 + BoilerHistory.DAYS * 4
        if !isinstance(b, bytes) || size(b) != want || b.get(0, 2) != BoilerHistory.MAGIC || b[2] != BoilerHistory.WIRE return false end
        var newest = b.geti(4, 4)
        var day = b.geti(8, 4)
        self.last = newest >= 0 ? newest : nil
        self.day = day >= 0 ? day : nil
        self.slots = b[BoilerHistory.HEAD .. BoilerHistory.HEAD + BoilerHistory.SLOTS * 2 - 1]
        self.days = b[BoilerHistory.HEAD + BoilerHistory.SLOTS * 2 ..]
        return true
    end

    static def read_file(name)
        try
            var f = open(name, "rb")
            var b = f.readbytes()
            f.close()
            return b
        except .. as e, m
            return nil
        end
    end

    # At boot: what the file kept, or what a save that the power cut left beside it; nothing kept when neither is whole
    def load()
        if self.take(BoilerHistory.read_file(self.file)) return true end
        return self.take(BoilerHistory.read_file(self.file + ".new"))
    end

    # nothing kept, in RAM or in the file system: the appliance goes back to its image
    def erase()
        import path
        self.clear_slots()
        self.clear_days()
        self.pending = []
        self.dirty = false
        try
            path.remove(self.file)
            path.remove(self.file + ".new")
        except .. as e, m
            log("BOILER: the history's file was not removed (" + str(e) + ": " + str(m) + ")", 1)
        end
    end

    # The rings to the file, when they changed: written beside it and moved over it, so a power cut in the middle leaves one of the two whole. It
    # does not raise: true when the file has them
    def save()
        import path
        if !self.dirty return true end
        try
            var f = open(self.file + ".new", "wb")
            f.write(self.image())
            f.close()
            path.remove(self.file)
            path.rename("/" + self.file + ".new", "/" + self.file)
            self.dirty = false
            return true
        except .. as e, m
            log("BOILER: the history was not saved (" + str(e) + ": " + str(m) + ")", 1)
            return false
        end
    end
end
