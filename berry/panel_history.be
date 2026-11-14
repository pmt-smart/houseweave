# panel_history.be -- the chart of what a device measured, drawn on the plan's page where the cards go: a canvas of the plan's
# (PanelPlanView), as the house's calendar is, so no byte of .tft. The device keeps what it measured and says it when the chart is opened
# (boiler_thermostat.be, the verb "history"): a list in numbered frames, its first entry what the series is, {"p": the period, "t": the local
# time it ends at, nil with no clock, "w": the heater's power in watts}, and the rest the series' bytes in base64.
#
# TWO CHARTS, a swipe apart, the dots at the top right saying which:
#   the last day    STEPS steps of a quarter of an hour, 2 bytes each: the water in half degrees (NONE for none), and the minutes the heater was
#                   on, with EXC for a step the device ran with no clock. The water is a column a step, the heater's time a band under them,
#                   the target a line across, and the line of text the heater's time and energy.
#   the last month  DAYS days, 4 bytes each: the lowest and the highest water, in half degrees, and the minutes the heater was on, the low byte
#                   first. A bar from the lowest to the highest a day, under them a bar of the day's energy, and the line of text the total.
# The energy is the heater's minutes times its power, as the device says it: the device measures no current.
#
# The glass draws rectangles, circles and text, so a curve is columns; the columns side by side of one height and colour go as one rectangle.
# The series is kept only while the chart is on show.

#@ solidify:PanelHistory
class PanelHistory
    static NONE = 255
    static EXC = 0x80
    static STEPS = 96
    static DAYS = 30
    static LINE = 24         # a line of text
    static AXIS = 44         # the scale's numbers, left of the chart: four characters of the body font, "100°"
    static PAD = 6
    static BAND = 6          # the heater's band under the day's columns
    static DOT = 3           # a chart's dot

    var ui        # PanelUi: the network's word of the device's target
    var id        # the device
    var period    # the chart on show: "d" the last day, "m" the last month
    var parts     # the frames of a series being gathered (PanelThermostatSettings.gather)
    var head      # what the series on show is, as the device said it, or nil until it came
    var data      # its bytes

    def init(ui, id)
        self.ui = ui
        self.id = id
        self.period = "d"
        self.parts = {}
    end

    # the effect that asks the device for the series of the chart on show
    def ask()
        return ["thermostat", [self.id], "history", self.period]
    end

    # A frame of a device's history: true when it is this device's, of the chart on show, and the series is whole
    def take(id, f)
        if id != self.id return false end
        var got = PanelThermostatSettings.gather(self, id, f)
        if got == nil || size(got) == 0 || !isinstance(got[0], map) || got[0].find("p") != self.period return false end
        var b = bytes()
        var i = 1
        while i < size(got)
            if type(got[i]) == "string"  b .. bytes().fromb64(got[i]) end
            i += 1
        end
        self.head = got[0]
        self.data = b
        return true
    end

    # --- what the plan's page asks of a canvas ----------------------------------------------------

    def title() return self.period == "d" ? "Last 24 hours" : "Last 30 days" end
    def action() return "" end
    def tap(n, style) return [] end

    # a swipe is the other chart: asked of the device, and drawn when it comes
    def swipe(dir)
        if dir != "left" && dir != "right" return [] end
        self.period = self.period == "d" ? "m" : "d"
        self.head = nil
        self.data = nil
        self.parts = {}
        return [self.ask(), ["calendar", self]]
    end

    def ops(style)
        if self.head == nil return self.message(style, "Reading the device") end
        if self.head.find("t") == nil return self.message(style, "No clock on the device") end
        var whole = self.period == "d" ? PanelHistory.STEPS * 2 : PanelHistory.DAYS * 4
        if self.data == nil || size(self.data) != whole return self.message(style, "No history") end
        return self.period == "d" ? self.day_ops(style) : self.month_ops(style)
    end

    # --- what every chart has ---------------------------------------------------------------------

    # the page under a chart, and the two dots at its top right, the lit one the chart on show
    def base(style)
        var o = style["origin"]
        var a = style["area"]
        var c = style["colors"]
        var x = o[0] + a[0] - PanelHistory.PAD - 4 * PanelHistory.DOT
        var y = o[1] + PanelHistory.LINE / 2
        return [["fill", o[0], o[1], a[0], a[1], c["page"]],
                ["cirs", x, y, PanelHistory.DOT, self.period == "d" ? c["label"] : c["secondary"]],
                ["cirs", x + 3 * PanelHistory.DOT, y, PanelHistory.DOT, self.period == "m" ? c["label"] : c["secondary"]]]
    end

    # a sentence where the chart would be
    def message(style, text)
        var o = style["origin"]
        var a = style["area"]
        var ops = self.base(style)
        ops.push(["xstr", o[0], o[1] + PanelHistory.LINE, a[0], a[1] - PanelHistory.LINE, style["fonts"]["body"], style["colors"]["secondary"],
                  style["colors"]["page"], PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, text])
        return ops
    end

    # a line of text
    static def text(style, x, y, w, color, align, s)
        return ["xstr", x, y, w, PanelHistory.LINE, style["fonts"]["body"], color, style["colors"]["page"], align, PanelDraw.CENTER, PanelDraw.SOLID, s]
    end

    # minutes as hours and minutes, "2 h 05"
    static def span(minutes)
        return str(minutes / 60) + " h " + (minutes % 60 < 10 ? "0" : "") + str(minutes % 60)
    end

    # the energy of a heater of `watts` on for `minutes`, to the tenth of a kWh: "4.5"
    static def energy(minutes, watts)
        var tenths = minutes * watts / 6000
        return str(tenths / 10) + "." + str(tenths % 10)
    end

    # A scale's ends for values in half degrees from `lo` to `hi`: whole tens of degrees that hold them, and never the same
    static def scale(lo, hi)
        lo = (lo / 20) * 20
        hi = ((hi + 19) / 20) * 20
        return [lo, hi > lo ? hi : lo + 20]
    end

    # The two numbers of a scale left of a chart: the top's under the chart's top, and the foot's over its foot. Inside the chart's height, a
    # number paints over nothing of the line above the chart or of another chart under it: a text's box is filled with the page's colour
    static def scale_ops(ops, style, x, y, h, top, foot)
        var c = style["colors"]["secondary"]
        var w = PanelHistory.AXIS - 4
        ops.push(PanelHistory.text(style, x, y, w, c, PanelDraw.RIGHT, top))
        ops.push(PanelHistory.text(style, x, y + h - PanelHistory.LINE, w, c, PanelDraw.RIGHT, foot))
    end

    # --- the last day -----------------------------------------------------------------------------

    def day_ops(style)
        var o = style["origin"]
        var a = style["area"]
        var c = style["colors"]
        var d = self.data
        var lo = nil
        var hi = nil
        var on = 0
        var i = 0
        while i < PanelHistory.STEPS
            var w = d[i * 2]
            if w != PanelHistory.NONE
                if lo == nil || w < lo  lo = w end
                if hi == nil || w > hi  hi = w end
            end
            on += d[i * 2 + 1] & 0x7F
            i += 1
        end
        if lo == nil return self.message(style, "No measurements yet") end
        # the target, in half degrees, is on the scale too
        var t = self.ui.network != nil && self.ui.network.thermostat != nil ? self.ui.network.thermostat.get(self.id, "set", nil) : nil
        if type(t) == "int"
            t = t / 5
            if t < lo  lo = t end
            if t > hi  hi = t end
        else
            t = nil
        end
        var s = PanelHistory.scale(lo, hi)
        var room = a[0] - PanelHistory.AXIS - PanelHistory.PAD
        var cw = room / PanelHistory.STEPS
        if cw < 1  cw = 1 end
        var x0 = o[0] + PanelHistory.AXIS + (room - cw * PanelHistory.STEPS) / 2
        var y0 = o[1] + PanelHistory.LINE + PanelHistory.PAD
        var h = a[1] - 2 * PanelHistory.LINE - 2 * PanelHistory.PAD - PanelHistory.BAND
        var ops = self.base(style)
        ops.push(PanelHistory.text(style, o[0] + PanelHistory.PAD, o[1], a[0] - 2 * PanelHistory.PAD - 8 * PanelHistory.DOT, c["label"], PanelDraw.LEFT,
                                   "Heater on " + PanelHistory.span(on) + "   " + PanelHistory.energy(on, self.head.find("w", 0)) + " kWh"))
        PanelHistory.scale_ops(ops, style, o[0], y0, h, str(s[1] / 2) + "°", str(s[0] / 2) + "°")
        self.day_columns(ops, x0, y0, cw, h, s, c)
        if t != nil  ops.push(["fill", x0, y0 + h - (t - s[0]) * h / (s[1] - s[0]) - 1, cw * PanelHistory.STEPS, 2, c["label"]]) end
        self.day_band(ops, x0, y0 + h + PanelHistory.PAD / 2, cw, c["heating"])
        self.day_hours(ops, style, x0, o[1] + a[1] - PanelHistory.LINE, cw)
        return ops
    end

    # the water of the day: a column a step from the chart's foot, a step with no clock in the tone of what is not lit, and the columns side by
    # side of one height and colour as one rectangle
    def day_columns(ops, x0, y0, cw, h, s, c)
        var d = self.data
        var run = nil
        var i = 0
        while i <= PanelHistory.STEPS
            var cur = nil
            if i < PanelHistory.STEPS && d[i * 2] != PanelHistory.NONE
                var ph = (d[i * 2] - s[0]) * h / (s[1] - s[0])
                cur = [ph < 1 ? 1 : ph, (d[i * 2 + 1] & PanelHistory.EXC) != 0 ? c["secondary"] : c["pending"]]
            end
            if run != nil && (cur == nil || cur[0] != run[1] || cur[1] != run[2])
                ops.push(["fill", x0 + run[0] * cw, y0 + h - run[1], (i - run[0]) * cw, run[1], run[2]])
                run = nil
            end
            if run == nil && cur != nil  run = [i, cur[0], cur[1]] end
            i += 1
        end
    end

    # the heater's time of the day: a band under the steps it was on in
    def day_band(ops, x0, y, cw, color)
        var d = self.data
        var first = nil
        var i = 0
        while i <= PanelHistory.STEPS
            var on = i < PanelHistory.STEPS && (d[i * 2 + 1] & 0x7F) > 0
            if on && first == nil  first = i end
            if !on && first != nil
                ops.push(["fill", x0 + first * cw, y, (i - first) * cw, PanelHistory.BAND, color])
                first = nil
            end
            i += 1
        end
    end

    # the hours under the day: every sixth, under the step it begins at
    def day_hours(ops, style, x0, y, cw)
        var first = self.head["t"] / 900 - (PanelHistory.STEPS - 1)
        var i = 0
        while i < PanelHistory.STEPS
            var at = (first + i) * 900
            if at % 21600 == 0
                ops.push(PanelHistory.text(style, x0 + i * cw - 20, y, 40, style["colors"]["secondary"], PanelDraw.CENTER, str((at / 3600) % 24) + "h"))
            end
            i += 1
        end
    end

    # --- the last month ---------------------------------------------------------------------------

    def month_ops(style)
        var o = style["origin"]
        var a = style["area"]
        var c = style["colors"]
        var d = self.data
        var lo = nil
        var hi = nil
        var most = 0
        var total = 0
        var i = 0
        while i < PanelHistory.DAYS
            if d[i * 4] != PanelHistory.NONE && (lo == nil || d[i * 4] < lo)  lo = d[i * 4] end
            if d[i * 4 + 1] != PanelHistory.NONE && (hi == nil || d[i * 4 + 1] > hi)  hi = d[i * 4 + 1] end
            var m = d.get(i * 4 + 2, 2)
            if m > most  most = m end
            total += m
            i += 1
        end
        if lo == nil || hi == nil return self.message(style, "No measurements yet") end
        var s = PanelHistory.scale(lo, hi)
        var watts = self.head.find("w", 0)
        var room = a[0] - PanelHistory.AXIS - PanelHistory.PAD
        var dw = room / PanelHistory.DAYS
        if dw < 2  dw = 2 end
        var x0 = o[0] + PanelHistory.AXIS + (room - dw * PanelHistory.DAYS) / 2
        var y0 = o[1] + PanelHistory.LINE + PanelHistory.PAD
        var h = a[1] - 2 * PanelHistory.LINE - 3 * PanelHistory.PAD
        var h1 = h * 6 / 10
        var y1 = y0 + h1 + PanelHistory.PAD
        var h2 = h - h1
        var ops = self.base(style)
        ops.push(PanelHistory.text(style, o[0] + PanelHistory.PAD, o[1], a[0] - 2 * PanelHistory.PAD - 8 * PanelHistory.DOT, c["label"], PanelDraw.LEFT,
                                   "Heater on " + PanelHistory.span(total) + "   " + PanelHistory.energy(total, watts) + " kWh"))
        PanelHistory.scale_ops(ops, style, o[0], y0, h1, str(s[1] / 2) + "°", str(s[0] / 2) + "°")
        PanelHistory.scale_ops(ops, style, o[0], y1, h2, PanelHistory.energy(most, watts), "0")
        self.month_bars(ops, x0, dw, [y0, h1, y1, h2], s, most, c)
        self.month_days(ops, style, x0, o[1] + a[1] - PanelHistory.LINE, dw)
        return ops
    end

    # the days of the month: the water's bar, from the day's lowest to its highest, and under it the bar of the day's energy, which is the
    # heater's minutes against the most of any day. `at` is [the water's top, its height, the energy's top, its height]
    def month_bars(ops, x0, dw, at, s, most, c)
        var d = self.data
        var i = 0
        while i < PanelHistory.DAYS
            var x = x0 + i * dw
            if d[i * 4] != PanelHistory.NONE && d[i * 4 + 1] != PanelHistory.NONE
                var foot = (d[i * 4] - s[0]) * at[1] / (s[1] - s[0])
                var tall = (d[i * 4 + 1] - s[0]) * at[1] / (s[1] - s[0]) - foot
                # a day whose water never moved is still a bar, standing on its lowest
                if tall < 2  tall = 2 end
                ops.push(["fill", x, at[0] + at[1] - foot - tall, dw - 1, tall, c["pending"]])
            end
            var m = d.get(i * 4 + 2, 2)
            if m > 0 && most > 0
                var e = m * at[3] / most
                ops.push(["fill", x, at[2] + at[3] - (e < 1 ? 1 : e), dw - 1, e < 1 ? 1 : e, c["heating"]])
            end
            i += 1
        end
    end

    # the days under the month: every fifth of the month's, under its bar
    def month_days(ops, style, x0, y, dw)
        var first = self.head["t"] / 86400 - (PanelHistory.DAYS - 1)
        var i = 0
        while i < PanelHistory.DAYS
            var dom = PanelClock.date_of(first + i)[2]
            if dom % 5 == 0
                ops.push(PanelHistory.text(style, x0 + i * dw + dw / 2 - 20, y, 40, style["colors"]["secondary"], PanelDraw.CENTER, str(dom)))
            end
            i += 1
        end
    end
end
