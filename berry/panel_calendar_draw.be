# panel_calendar_draw.be -- the house's calendar, drawn on the plan's page where the cards go: a month,
# a dot under each day for the kinds of device its events are for, today in a ring and the day chosen filled; and the
# chosen day's events, beside the month on a wide area and under it on a tall one. Nextion drawing instructions, as
# PanelDraw's (panel_draw.be), with the plan's style: no byte of .tft.
#
# The colours are the plan's own: the day chosen and today's ring in the tone of a command on its way (the theme's
# accent), a thermostat's dot in its heating tone, a lamp's in its lit one, any other's in the unlit one.

#@ solidify:PanelCalendarDraw
class PanelCalendarDraw
    static HEAD = 24          # the line of the weekdays
    static GAP = 12           # between the month and the day's list
    static MARGIN = 15        # the day's list under the month, in from the edges as a list's rows are
    static LINE = 30          # a line of the day's list
    static DOT = 2            # an event's dot under its day
    static DOT_GAP = 7
    static RING = 2
    static INITIALS = ["M", "T", "W", "T", "F", "S", "S"]

    # Where things go: [month x, y, cell w, cell h, list x, y, w, h]. Side by side on a wide area, the list under the
    # month on a tall one; the month takes six weeks always
    static def layout(style)
        var o = style["origin"]
        var a = style["area"]
        if a[0] > a[1]
            var ch = (a[1] - PanelCalendarDraw.HEAD) / 6
            var mw = 7 * ch
            return [o[0], o[1], ch, ch, o[0] + mw + PanelCalendarDraw.GAP, o[1], a[0] - mw - PanelCalendarDraw.GAP, a[1]]
        end
        var cw = a[0] / 7
        var ch = cw * 4 / 5
        var mh = PanelCalendarDraw.HEAD + 6 * ch
        return [o[0], o[1], cw, ch, o[0] + PanelCalendarDraw.MARGIN, o[1] + mh + PanelCalendarDraw.GAP / 2, a[0] - 2 * PanelCalendarDraw.MARGIN,
                a[1] - mh - PanelCalendarDraw.GAP / 2]
    end

    # how many of the day's events its list shows: the lines under the day's own
    static def lines_fit(style)
        return PanelCalendarDraw.layout(style)[7] / PanelCalendarDraw.LINE - 1
    end

    # the colour of a kind's dot
    static def dot_color(kind, colors)
        if kind == "thermostat" return colors["heating"] end
        if kind == "light" return colors["iconOn"] end
        return colors["iconOff"]
    end

    # A month: `dots` the kinds with an event on each day of it, by the day of the month; `head` the day chosen's
    # words, and `lines` its events, already in the order of the day
    static def month(style, y, m, chosen, today, dots, head, lines)
        var c = style["colors"]
        var font = style["fonts"]["body"]
        var L = PanelCalendarDraw.layout(style)
        var ops = [["fill", style["origin"][0], style["origin"][1], style["area"][0], style["area"][1], c["page"]]]
        for i: 0 .. 6
            ops.push(["xstr", L[0] + i * L[2], L[1], L[2], PanelCalendarDraw.HEAD, font, c["secondary"], c["page"],
                      PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, PanelCalendarDraw.INITIALS[i]])
        end
        var first = PanelClock.days_of(y, m, 1)
        var lead = PanelClock.weekday(first)
        for d: 1 .. PanelClock.month_days(y, m)
            var k = lead + d - 1
            var x = L[0] + (k % 7) * L[2]
            var top = L[1] + PanelCalendarDraw.HEAD + (k / 7) * L[3]
            var day = first + d - 1
            var bg = day == chosen ? c["pending"] : c["page"]
            var r = PanelCalendarDraw.RING
            if day == today && day != chosen
                # the ring: four strokes round the cell
                ops.push(["fill", x + 1, top + 1, L[2] - 2, r, c["pending"]])
                ops.push(["fill", x + 1, top + L[3] - 1 - r, L[2] - 2, r, c["pending"]])
                ops.push(["fill", x + 1, top + 1, r, L[3] - 2, c["pending"]])
                ops.push(["fill", x + L[2] - 1 - r, top + 1, r, L[3] - 2, c["pending"]])
            end
            var ix = x + r + 1
            var iy = top + r + 1
            var iw = L[2] - 2 * r - 2
            var ih = L[3] - 2 * r - 2
            var kinds = dots.find(d)
            if day == chosen  ops.push(["fill", ix, iy, iw, ih, bg]) end
            ops.push(["xstr", ix, iy, iw, kinds != nil ? ih - 2 * PanelCalendarDraw.DOT - 2 : ih, font, c["label"], bg,
                      PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, str(d)])
            if kinds != nil
                var n = size(kinds) < 3 ? size(kinds) : 3
                var cx = ix + iw / 2 - (n - 1) * PanelCalendarDraw.DOT_GAP / 2
                for i: 0 .. n - 1
                    ops.push(["cirs", cx + i * PanelCalendarDraw.DOT_GAP, iy + ih - PanelCalendarDraw.DOT - 1, PanelCalendarDraw.DOT,
                              PanelCalendarDraw.dot_color(kinds[i], c)])
                end
            end
        end
        # the day chosen and its events
        var adv = style["advances"]
        ops.push(["xstr", L[4], L[5], L[6], PanelCalendarDraw.LINE, font, c["secondary"], c["page"], PanelDraw.LEFT, PanelDraw.CENTER,
                  PanelDraw.SOLID, head])
        var fit = PanelCalendarDraw.lines_fit(style)
        var shown = size(lines) > fit ? fit - 1 : size(lines)
        for i: 0 .. shown - 1
            ops.push(["xstr", L[4], L[5] + (i + 1) * PanelCalendarDraw.LINE, L[6], PanelCalendarDraw.LINE, font, c["label"], c["page"],
                      PanelDraw.LEFT, PanelDraw.CENTER, PanelDraw.SOLID, PanelDraw.fit_name(adv, lines[i], L[6])])
        end
        var last = nil
        if size(lines) == 0  last = "No events" end
        if size(lines) > fit  last = "+" + str(size(lines) - shown) + " more" end
        if last != nil
            ops.push(["xstr", L[4], L[5] + (shown + 1) * PanelCalendarDraw.LINE, L[6], PanelCalendarDraw.LINE, font, c["secondary"], c["page"],
                      PanelDraw.LEFT, PanelDraw.CENTER, PanelDraw.SOLID, last])
        end
        return ops
    end

    # a sentence where the month would be, as with no clock
    static def message(style, text)
        var o = style["origin"]
        var a = style["area"]
        var c = style["colors"]
        return [["fill", o[0], o[1], a[0], a[1], c["page"]],
                ["xstr", o[0], o[1], a[0], a[1], style["fonts"]["body"], c["secondary"], c["page"], PanelDraw.CENTER, PanelDraw.CENTER,
                 PanelDraw.SOLID, text]]
    end

    # What a touch at x, y is: ["day", days since 1970] on a day of the month, ["line", n] on the day's n-th event, or nil
    static def hit(style, x, y, yy, m)
        var L = PanelCalendarDraw.layout(style)
        var top = L[1] + PanelCalendarDraw.HEAD
        if x >= L[0] && x < L[0] + 7 * L[2] && y >= top && y < top + 6 * L[3]
            var first = PanelClock.days_of(yy, m, 1)
            var d = ((y - top) / L[3]) * 7 + (x - L[0]) / L[2] - PanelClock.weekday(first) + 1
            if d < 1 || d > PanelClock.month_days(yy, m) return nil end
            return ["day", first + d - 1]
        end
        if x >= L[4] && x < L[4] + L[6] && y >= L[5] + PanelCalendarDraw.LINE && y < L[5] + L[7]
            return ["line", (y - L[5]) / PanelCalendarDraw.LINE - 1]
        end
        return nil
    end
end
