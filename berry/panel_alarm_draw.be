# panel_alarm_draw.be -- the alarm's screens, drawn on the plan's page where the cards go: the Alarm
# screen, the Notifications screen and the notice that takes the glass. Nextion drawing instructions, as PanelCalendarDraw's
# (panel_calendar_draw.be), with the plan's style: no byte of .tft.
#
# One font, the body's, so what is big is made so by a band of colour behind it: the state's, red for a trigger, orange for
# the entry time, green armed, grey disarmed. The colours of the states are fixed, RGB565, and not the theme's: an alarm is
# the same red in every theme.
#
# The Alarm screen's settings are a cog in a row of its own under the title, as the row of buttons of a device's page:
# a face of 56 x 44 in a row of 48, with the state's band whole under it. A manifest from before has no cog
# (the plan style's `icons`), and the screen keeps the word Settings on the line of the events.

#@ solidify:PanelAlarmDraw
class PanelAlarmDraw
    static RED = 0xF800
    static ORANGE = 0xFD20
    static GREEN = 0x0400
    static GREY = 0x7BEF
    static WHITE = 0xFFFF
    static BAND = 56          # the state's band
    static BTN = 50           # a button
    static LINE = 30          # a line of a list
    static MARGIN = 8
    static GAP = 6
    static TABS = ["Now", "Today", "All"]
    # the foot of the Notifications' list: Delete all on every tab, and Acknowledge all before it on Now
    static ACK = "Acknowledge all"
    static DEL = "Delete all"
    # the cog's row: as tall as the row under a page's title, its face as wide as an icon of that row
    static TOOLS = 48
    static FACE_W = 56
    static FACE_H = 44

    # the colour of a state's band
    static def state_color(st)
        if st == "triggered" return PanelAlarmDraw.RED end
        if st == "pending" || st == "arming" return PanelAlarmDraw.ORANGE end
        if st == "armed_home" || st == "armed_away" return PanelAlarmDraw.GREEN end
        return PanelAlarmDraw.GREY
    end

    # the colour a grade's bar is: red the alarm's, orange an alert's, and the house's and the local's the theme's own
    static def grade_color(g, colors)
        if g == "alarm" return PanelAlarmDraw.RED end
        if g == "alert" return PanelAlarmDraw.ORANGE end
        return colors["secondary"]
    end

    static def text(style, x, y, w, h, fg, bg, align, s)
        return ["xstr", x, y, w, h, style["fonts"]["body"], fg, bg, align, PanelDraw.CENTER, PanelDraw.SOLID, s]
    end

    static def blank(style)
        var o = style["origin"]
        var a = style["area"]
        return ["fill", o[0], o[1], a[0], a[1], style["colors"]["page"]]
    end

    # --- the Alarm screen -----------------------------------------------------------------------------

    # the cog's glyph, from the manifest, or nil where it has none
    static def cog(style)
        var i = style.find("icons")
        return isinstance(i, map) ? i.find("settings") : nil
    end

    # Where the state screen's parts go: [band y, cause y, buttons y, events header y, first line y, lines that fit]; the band
    # under the cog's row, where there is a cog
    static def rows(style)
        var o = style["origin"]
        var a = style["area"]
        var band = o[1] + (PanelAlarmDraw.cog(style) != nil ? PanelAlarmDraw.TOOLS : 0)
        var cause = band + PanelAlarmDraw.BAND + 2
        var btn = cause + PanelAlarmDraw.LINE + 2
        var head = btn + PanelAlarmDraw.BTN + 8
        var first = head + PanelAlarmDraw.LINE
        var fit = (o[1] + a[1] - first) / PanelAlarmDraw.LINE
        return [band, cause, btn, head, first, fit < 0 ? 0 : fit]
    end

    # The x and width of button i of n
    static def button_box(style, i, n)
        var o = style["origin"]
        var a = style["area"]
        var m = PanelAlarmDraw.MARGIN
        var w = (a[0] - 2 * m - (n - 1) * PanelAlarmDraw.GAP) / n
        return [o[0] + m + i * (w + PanelAlarmDraw.GAP), w]
    end

    # The Alarm screen. `d`: "st", "word" (the state in words), "cause" (a line under the band), "buttons" ([[label, kind]],
    # kind "arm", "disarm" or "off"), "lines" (the events, newest first, as words)
    static def state(style, d)
        var c = style["colors"]
        var o = style["origin"]
        var a = style["area"]
        var R = PanelAlarmDraw.rows(style)
        var ops = [PanelAlarmDraw.blank(style)]
        var cog = PanelAlarmDraw.cog(style)
        if cog != nil
            var fy = o[1] + (PanelAlarmDraw.TOOLS - PanelAlarmDraw.FACE_H) / 2
            PanelDraw.round_rect(ops, o[0], fy, PanelAlarmDraw.FACE_W, PanelAlarmDraw.FACE_H, style["radius"], c["card"])
            ops.push(["xstr", o[0], fy, PanelAlarmDraw.FACE_W, PanelAlarmDraw.FACE_H, style["fonts"]["icon"], c["label"], c["card"],
                      PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, cog])
        end
        ops.push(["fill", o[0], R[0], a[0], PanelAlarmDraw.BAND, PanelAlarmDraw.state_color(d["st"])])
        ops.push(PanelAlarmDraw.text(style, o[0], R[0], a[0], PanelAlarmDraw.BAND, PanelAlarmDraw.WHITE, PanelAlarmDraw.state_color(d["st"]),
                                     PanelDraw.CENTER, d["word"]))
        ops.push(PanelAlarmDraw.text(style, o[0], R[1], a[0], PanelAlarmDraw.LINE, c["secondary"], c["page"], PanelDraw.CENTER, d["cause"]))
        var n = size(d["buttons"])
        for i: 0 .. n - 1
            var b = d["buttons"][i]
            var box = PanelAlarmDraw.button_box(style, i, n)
            var bg = b[1] == "disarm" ? PanelAlarmDraw.RED : c["card"]
            var fg = b[1] == "disarm" ? PanelAlarmDraw.WHITE : (b[1] == "off" ? c["secondary"] : c["label"])
            ops.push(["fill", box[0], R[2], box[1], PanelAlarmDraw.BTN, bg])
            ops.push(PanelAlarmDraw.text(style, box[0], R[2], box[1], PanelAlarmDraw.BTN, fg, bg, PanelDraw.CENTER, b[0]))
        end
        var m = PanelAlarmDraw.MARGIN
        # no line for the events, where the glass has no room for one under the cog (the EU's): the list is the HA's, and the US's
        if R[5] == 0 return ops end
        ops.push(PanelAlarmDraw.text(style, o[0] + m, R[3], a[0] / 2, PanelAlarmDraw.LINE, c["secondary"], c["page"], PanelDraw.LEFT, "Events"))
        if cog == nil
            ops.push(PanelAlarmDraw.text(style, o[0] + a[0] / 2, R[3], a[0] / 2 - m, PanelAlarmDraw.LINE, c["pending"], c["page"],
                                         PanelDraw.RIGHT, "Settings"))
        end
        var adv = style["advances"]
        var shown = size(d["lines"]) < R[5] ? size(d["lines"]) : R[5]
        for i: 0 .. shown - 1
            ops.push(PanelAlarmDraw.text(style, o[0] + m, R[4] + i * PanelAlarmDraw.LINE, a[0] - 2 * m, PanelAlarmDraw.LINE, c["label"], c["page"],
                                         PanelDraw.LEFT, PanelDraw.fit_name(adv, d["lines"][i], a[0] - 2 * m)))
        end
        if size(d["lines"]) == 0
            ops.push(PanelAlarmDraw.text(style, o[0] + m, R[4], a[0] - 2 * m, PanelAlarmDraw.LINE, c["secondary"], c["page"], PanelDraw.LEFT, "No events"))
        end
        return ops
    end

    # What a touch at x, y on the Alarm screen is: ["button", i], ["settings"], or nil
    static def state_hit(style, x, y, n)
        var R = PanelAlarmDraw.rows(style)
        if y >= R[2] && y < R[2] + PanelAlarmDraw.BTN
            for i: 0 .. n - 1
                var box = PanelAlarmDraw.button_box(style, i, n)
                if x >= box[0] && x < box[0] + box[1] return ["button", i] end
            end
            return nil
        end
        var o = style["origin"]
        var a = style["area"]
        if PanelAlarmDraw.cog(style) != nil
            if y >= o[1] && y < o[1] + PanelAlarmDraw.TOOLS && x >= o[0] && x < o[0] + PanelAlarmDraw.FACE_W return ["settings"] end
            return nil
        end
        if R[5] > 0 && y >= R[3] && y < R[3] + PanelAlarmDraw.LINE && x >= o[0] + a[0] / 2 return ["settings"] end
        return nil
    end

    # --- the Notifications screen ---------------------------------------------------------------------

    # Where the list's parts go: [tabs y, first row y, rows that fit]; the last of them are kept for the foot
    static def list_rows(style)
        var o = style["origin"]
        var a = style["area"]
        var tabs = o[1]
        var first = tabs + PanelAlarmDraw.LINE + 6
        var fit = (o[1] + a[1] - first) / PanelAlarmDraw.LINE
        return [tabs, first, fit < 1 ? 1 : fit]
    end

    # The foot of the list, on its last lines: Delete all, and on Now Acknowledge all before it, side by side when the two fit and
    # one over the other when they do not, as on the narrow glass of the US. Each [word, x, y, w, verb, align], left to right on a
    # line; nothing for a list with no rows
    static def foot(style, ack, any)
        if !any return [] end
        var o = style["origin"]
        var a = style["area"]
        var R = PanelAlarmDraw.list_rows(style)
        var m = PanelAlarmDraw.MARGIN
        var last = R[1] + (R[2] - 1) * PanelAlarmDraw.LINE
        var w = a[0] - 2 * m
        var del = [PanelAlarmDraw.DEL, o[0] + m, last, w, "del", PanelDraw.LEFT]
        if !ack return [del] end
        var adv = style["advances"]
        if type(adv) == "string" adv = bytes(adv) end
        var half = w / 2
        if PanelDraw.span(PanelAlarmDraw.ACK, adv, half) == size(PanelAlarmDraw.ACK)
            return [[PanelAlarmDraw.ACK, o[0] + m, last, half, "ack", PanelDraw.LEFT], [PanelAlarmDraw.DEL, o[0] + m + half, last, w - half, "del", PanelDraw.RIGHT]]
        end
        return [[PanelAlarmDraw.ACK, o[0] + m, last - PanelAlarmDraw.LINE, w, "ack", PanelDraw.LEFT], del]
    end

    # the rows the list has room for, over the foot's lines
    static def room(style, foot)
        var lines = 0
        var y = nil
        for f: foot
            if f[2] != y
                lines += 1
                y = f[2]
            end
        end
        var n = PanelAlarmDraw.list_rows(style)[2] - lines
        return n < 0 ? 0 : n
    end

    # The Notifications screen. `d`: "tab" (0 Now, 1 Today, 2 All), "rows" ([[words, grade, unseen]], the ones to show, in
    # order), "more" (how many do not fit), "foot" (foot())
    static def list(style, d)
        var c = style["colors"]
        var o = style["origin"]
        var a = style["area"]
        var R = PanelAlarmDraw.list_rows(style)
        var ops = [PanelAlarmDraw.blank(style)]
        var tw = a[0] / 3
        for i: 0 .. 2
            var on = i == d["tab"]
            var bg = on ? c["pending"] : c["page"]
            ops.push(["fill", o[0] + i * tw, R[0], tw, PanelAlarmDraw.LINE, bg])
            ops.push(PanelAlarmDraw.text(style, o[0] + i * tw, R[0], tw, PanelAlarmDraw.LINE, on ? PanelAlarmDraw.WHITE : c["secondary"], bg,
                                         PanelDraw.CENTER, PanelAlarmDraw.TABS[i]))
        end
        var adv = style["advances"]
        var m = PanelAlarmDraw.MARGIN
        var room = PanelAlarmDraw.room(style, d["foot"])
        var shown = size(d["rows"]) < room ? size(d["rows"]) : room
        for i: 0 .. shown - 1
            var r = d["rows"][i]
            var y = R[1] + i * PanelAlarmDraw.LINE
            ops.push(["fill", o[0], y + 3, 5, PanelAlarmDraw.LINE - 6, PanelAlarmDraw.grade_color(r[1], c)])
            ops.push(PanelAlarmDraw.text(style, o[0] + m + 4, y, a[0] - 2 * m - 24, PanelAlarmDraw.LINE, r[2] ? c["label"] : c["secondary"], c["page"],
                                         PanelDraw.LEFT, PanelDraw.fit_name(adv, r[0], a[0] - 2 * m - 24)))
            if r[2] ops.push(["cirs", o[0] + a[0] - m - 6, y + PanelAlarmDraw.LINE / 2, 4, c["pending"]]) end
        end
        if size(d["rows"]) == 0
            ops.push(PanelAlarmDraw.text(style, o[0] + m, R[1], a[0] - 2 * m, PanelAlarmDraw.LINE, c["secondary"], c["page"], PanelDraw.LEFT,
                                         d["tab"] == 0 ? "Nothing to see" : "No events"))
        end
        if d["more"] > 0 && shown < room
            ops.push(PanelAlarmDraw.text(style, o[0] + m, R[1] + shown * PanelAlarmDraw.LINE, a[0] - 2 * m, PanelAlarmDraw.LINE, c["secondary"], c["page"],
                                         PanelDraw.LEFT, "+" + str(d["more"]) + " more"))
        end
        for f: d["foot"]
            ops.push(PanelAlarmDraw.text(style, f[1], f[2], f[3], PanelAlarmDraw.LINE, c["pending"], c["page"], f[5], f[0]))
        end
        return ops
    end

    # What a touch on the Notifications screen is: ["tab", i], ["row", i], ["ack"], ["del"], or nil; `foot` is the list's (foot()).
    # On a line of two words the touch left of the second is the first's
    static def list_hit(style, x, y, foot)
        var R = PanelAlarmDraw.list_rows(style)
        var o = style["origin"]
        var a = style["area"]
        if y >= R[0] && y < R[0] + PanelAlarmDraw.LINE
            var i = (x - o[0]) / (a[0] / 3)
            return ["tab", i > 2 ? 2 : i]
        end
        var hit = nil
        for f: foot
            if y >= f[2] && y < f[2] + PanelAlarmDraw.LINE && (hit == nil || x >= f[1])  hit = [f[4]] end
        end
        if hit != nil return hit end
        if y >= R[1] && y < o[1] + a[1] return ["row", (y - R[1]) / PanelAlarmDraw.LINE] end
        return nil
    end

    # --- the notice ---------------------------------------------------------------------------------------

    # The notice that takes the glass: a colour all over, the title, the lines, and what to do to leave it. `color` is the
    # band's, red for an alarm, orange for an alert, and the plan's accent for a panic that was only said
    static def notice(style, title, lines, color, foot)
        var o = style["origin"]
        var a = style["area"]
        var m = PanelAlarmDraw.MARGIN
        var ops = [["fill", o[0], o[1], a[0], a[1], color]]
        ops.push(PanelAlarmDraw.text(style, o[0], o[1] + a[1] / 8, a[0], a[1] / 4, PanelAlarmDraw.WHITE, color, PanelDraw.CENTER, title))
        var adv = style["advances"]
        var y = o[1] + a[1] * 3 / 8
        for l: lines
            ops.push(PanelAlarmDraw.text(style, o[0] + m, y, a[0] - 2 * m, PanelAlarmDraw.LINE, PanelAlarmDraw.WHITE, color, PanelDraw.CENTER,
                                         PanelDraw.fit_name(adv, l, a[0] - 2 * m)))
            y += PanelAlarmDraw.LINE + 4
        end
        ops.push(PanelAlarmDraw.text(style, o[0], o[1] + a[1] - PanelAlarmDraw.LINE - m, a[0], PanelAlarmDraw.LINE, PanelAlarmDraw.WHITE, color,
                                     PanelDraw.CENTER, foot))
        return ops
    end
end
