# berry/panel_history.be, the chart of what a device measured, on the plan's page: the series gathered from the device's frames, the last day's
# columns, band, target and hours, the last month's bars and days, what it says with no series, and the swipe from one chart to the other.

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if str(got) != str(want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + str(got))
        print("  want " + str(want))
    end
end

# the plan's style as the generator writes it: a wide area and a tall one
def style_of(wide)
    return {"origin": [0, 86], "area": wide ? [450, 234] : [320, 394],
            "colors": {"page": 1, "card": 2, "label": 3, "iconOff": 4, "iconOn": 5, "pending": 6, "heating": 7, "secondary": 8}, "fonts": {"body": 0}}
end

# the panel as the chart reads it: the network's word of a thermostat's target
class FakeThermostat
    var set
    def get(id, field, missing) return field == "set" && self.set != nil ? self.set : missing end
end
class FakeNetwork
    var thermostat
    def init() self.thermostat = FakeThermostat() end
end
class FakeUi
    var network
    def init() self.network = FakeNetwork() end
end

var ID = "0xA0B765FFFE880001"
# a Friday at noon, local time: 2024-10-04
var NOON = 20000 * 86400 + 12 * 3600

# the frames a device says a series in (boiler_thermostat.be): what it is, and its bytes in base64, 48 an entry, `per` entries a frame
def frames_of(head, b, per)
    var entries = [head]
    var i = 0
    while i < size(b)
        var j = i + 47
        entries.push(b[i .. (j < size(b) ? j : size(b) - 1)].tob64())
        i += 48
    end
    var out = []
    var at = 0
    while at < size(entries)
        var l = []
        var k = at
        while k < size(entries) && k < at + per
            l.push(entries[k])
            k += 1
        end
        out.push({"at": at, "of": size(entries), "l": l})
        at += per
    end
    return out
end
def given(h, head, b)
    var whole = false
    for f: frames_of(head, b, 2)  whole = h.take(ID, f) end
    return whole
end

# the texts a drawing writes, and its rectangles of a colour, [x, y, w, h] each
def texts_of(ops)
    var out = []
    for o: ops
        if o[0] == "xstr"  out.push(o[11]) end
    end
    return out
end
def fills_of(ops, color)
    var out = []
    for o: ops
        if o[0] == "fill" && o[5] == color  out.push(o[1 .. 4]) end
    end
    return out
end
def dots_of(ops)
    var out = []
    for o: ops
        if o[0] == "cirs"  out.push(o[4]) end
    end
    return out
end

# a day: nothing until twenty to four in the afternoon... the steps 80 to 89 at 50 degrees, one of them with no clock, and 90 to 95 at 55, the
# heater on in the first two of those
def day_bytes()
    var b = bytes()
    for i: 0 .. 95
        var w = i < 80 ? 255 : (i < 90 ? 100 : 110)
        var m = (i == 90 || i == 91) ? 15 : 0
        if i == 85  m = m | 0x80 end
        b.add(w, 1)
        b.add(m, 1)
    end
    return b
end
# a month: nothing but yesterday, 50 to 55 degrees and an hour of the heater, and today, 45 to 65 and two hours
def month_bytes()
    var b = bytes()
    for i: 0 .. 29
        b.add(i == 28 ? 100 : (i == 29 ? 90 : 255), 1)
        b.add(i == 28 ? 110 : (i == 29 ? 130 : 255), 1)
        b.add(i == 28 ? 60 : (i == 29 ? 120 : 0), 2)
    end
    return b
end

def gather_checks()
    var h = PanelHistory(FakeUi(), ID)
    check("opened on the last day, which it asks its device for", [h.period, h.title(), h.action(), h.ask()], ["d", "Last 24 hours", "", ["thermostat", [ID], "history", "d"]])
    check("until the series comes it says it is reading the device, under its dots", [texts_of(h.ops(style_of(true))), dots_of(h.ops(style_of(true)))],
          [["Reading the device"], [3, 8]])
    var f = frames_of({"p": "d", "t": NOON, "w": 3000}, day_bytes(), 2)
    check("the series in three frames", size(f), 3)
    check("a frame of another device is not its own", h.take("0x0000000000000001", f[0]), false)
    check("whole at the last frame, and not before", [h.take(ID, f[0]), h.take(ID, f[1]), h.head, h.take(ID, f[2]), size(h.data), h.head["t"]], [false, false, nil, true, 192, NOON])
    check("a frame lost: nothing is kept", [h.take(ID, f[0]), h.take(ID, f[2]), size(h.parts)], [false, false, 0])
    var other = PanelHistory(FakeUi(), ID)
    check("the series of the other chart, late on its way, is not the one on show", [given(other, {"p": "m", "t": NOON, "w": 3000}, month_bytes()), other.head], [false, nil])
    check("with no clock on the device there is no series, and it says so", [given(other, {"p": "d", "t": nil, "w": 3000}, bytes()), texts_of(other.ops(style_of(true)))],
          [true, ["No clock on the device"]])
    check("a series that is not whole is none", [given(other, {"p": "d", "t": NOON, "w": 3000}, bytes("0102")), texts_of(other.ops(style_of(true)))], [true, ["No history"]])
    var none = bytes()
    for i: 0 .. 95
        none.add(255, 1)
        none.add(0, 1)
    end
    check("and one with no reading in it has nothing to draw", [given(other, {"p": "d", "t": NOON, "w": 3000}, none), texts_of(other.ops(style_of(true)))], [true, ["No measurements yet"]])
end
gather_checks()

def day_checks()
    var ui = FakeUi()
    ui.network.thermostat.set = 600
    var h = PanelHistory(ui, ID)
    given(h, {"p": "d", "t": NOON, "w": 3000}, day_bytes())
    var ops = h.ops(style_of(true))
    check("the page first, and the dots, the day's lit", [ops[0], dots_of(ops)], [["fill", 0, 86, 450, 234, 1], [3, 8]])
    check("the heater's time and energy, the scale's two ends with the target on it, and every sixth hour",
          texts_of(ops), ["Heater on 0 h 30   1.5 kWh", "60°", "50°", "18h", "0h", "6h", "12h"])
    check("the water: the steps side by side of one height and colour as one rectangle, a step with no clock in another tone",
          [fills_of(ops, 6), fills_of(ops, 8)], [[[372, 283, 20, 1], [396, 283, 16, 1], [412, 200, 24, 84]], [[392, 283, 4, 1]]])
    check("the target, a line across the chart", fills_of(ops, 3), [[52, 115, 384, 2]])
    check("the heater's band, under the steps it was on in", fills_of(ops, 7), [[412, 287, 8, 6]])
    check("the hours under the steps they begin at", [ops[-4][1], ops[-1][1]], [52 + 23 * 4 - 20, 52 + 95 * 4 - 20])
    ui.network.thermostat.set = nil
    ops = h.ops(style_of(true))
    check("with no target known: no line, and the scale is the water's", [fills_of(ops, 3), texts_of(ops)[1 .. 2]], [[], ["60°", "50°"]])
    ops = h.ops(style_of(false))
    check("on a tall area the steps are narrower and the chart taller", [fills_of(ops, 6)[-1], fills_of(ops, 7)], [[263, 280, 12, 164], [[263, 447, 4, 6]]])
    check("a tap does nothing", h.tap(100200, style_of(true)), [])
end
day_checks()

def month_checks()
    var h = PanelHistory(FakeUi(), ID)
    var fx = h.swipe("left")
    check("a swipe is the other chart: asked of the device, and the page drawn again, reading it",
          [h.period, h.title(), fx[0], fx[1][0], fx[1][1] == h, h.head, texts_of(h.ops(style_of(true))), dots_of(h.ops(style_of(true)))],
          ["m", "Last 30 days", ["thermostat", [ID], "history", "m"], "calendar", true, nil, ["Reading the device"], [8, 3]])
    check("what is no swipe to a side is none", [h.swipe("up"), h.period], [[], "m"])
    given(h, {"p": "m", "t": NOON, "w": 3000}, month_bytes())
    var ops = h.ops(style_of(true))
    check("the month's heater time and energy, the water's scale, the most energy of a day, and every fifth day of the month",
          texts_of(ops), ["Heater on 3 h 00   9.0 kWh", "70°", "40°", "6.0", "0", "5", "10", "15", "20", "25", "30"])
    check("a day's water: a bar from its lowest to its highest", fills_of(ops, 6), [[413, 166, 12, 17], [426, 133, 12, 67]])
    check("and under it the day's energy, against the most of any day", fills_of(ops, 7), [[413, 256, 12, 34], [426, 222, 12, 68]])
    check("the days under their bars", [ops[-6][1], ops[-1][1]], [49 + 6 - 20, 49 + 25 * 13 + 6 - 20])
    var one = bytes()
    for i: 0 .. 29
        one.add(i == 29 ? 100 : 255, 1)
        one.add(i == 29 ? 100 : 255, 1)
        one.add(0, 2)
    end
    given(h, {"p": "m", "t": NOON, "w": 3000}, one)
    ops = h.ops(style_of(true))
    check("a day whose water never moved is still a bar, and a month with the heater never on has no energy to draw",
          [fills_of(ops, 6), fills_of(ops, 7), texts_of(ops)[0]], [[[426, 214, 12, 2]], [], "Heater on 0 h 00   0.0 kWh"])
    h.swipe("right")
    check("and a swipe back is the day's", [h.period, h.title()], ["d", "Last 24 hours"])
end
month_checks()

# What a chart costs to draw, at its most: a day whose every step is another height, the heater on and off by turns. The instructions go to the
# glass at 115 200 bps, ten bits a byte
def cost_checks()
    var ui = FakeUi()
    ui.network.thermostat.set = 600
    var h = PanelHistory(ui, ID)
    var b = bytes()
    for i: 0 .. 95
        b.add(80 + i, 1)
        b.add(i % 2 == 0 ? 15 : 0, 1)
    end
    given(h, {"p": "d", "t": NOON, "w": 3000}, b)
    var ops = h.ops(style_of(true))
    var wire = 0
    for block: PanelDraw.chunk_ops(ops, nil)
        for t: block  wire += size(t) + 3 end
    end
    # the two lowest steps are a pixel high both, and so one rectangle
    check("a day at its most is one instruction a step, one a turn of the heater, and the rest", size(ops), 3 + 1 + 2 + 95 + 1 + 48 + 4)
    check("and crosses the wire in under half a second", wire < 5760, true)
end
cost_checks()

def word_checks()
    check("minutes as hours and minutes", [PanelHistory.span(0), PanelHistory.span(65), PanelHistory.span(1440)], ["0 h 00", "1 h 05", "24 h 00"])
    check("the energy of a heater's minutes, to the tenth of a kWh", [PanelHistory.energy(30, 3000), PanelHistory.energy(1440, 9000), PanelHistory.energy(1, 500)],
          ["1.5", "216.0", "0.0"])
    check("a scale's ends: the tens of degrees that hold the values, in half degrees, and never the same",
          [PanelHistory.scale(100, 120), PanelHistory.scale(101, 121), PanelHistory.scale(100, 100), PanelHistory.scale(95, 100)],
          [[100, 120], [100, 140], [100, 120], [80, 100]])
end
word_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
