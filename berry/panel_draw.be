# panel_draw.be -- what a plan draws on the glass, as Nextion drawing
# instructions.
#
# A plan page has a header and a TouchCap and nothing else; the cards and the
# icons are drawn at runtime with `fill`, `cirs` and `xstr`, because this
# series cannot move a compiled component. The list of instructions
# is the contract: the simulator's emulated glass draws what this file sends
# (libs/nspanel-sim/glass), and berry/test/vectors/draw.json holds it to its
# instructions (berry/test/test_panel_draw.be).
#
# An instruction is a list, `["fill", x, y, w, h, color]`,
# `["cirs", x, y, r, color]` or
# `["xstr", x, y, w, h, font, pco, bco, xcen, ycen, sta, text]`, in page
# coordinates. `style` is a map with the theme and the panel already resolved
# (the card area's origin and size in pixels, colours as RGB565, fonts as the
# .tft's index, glyphs per kind of device as [on, off, noanswer, nopower], and
# the body font's advances, which a summary card's name is fitted with); the
# generator writes it.
#
# The plan is a matrix of fixed cells, the same on every panel, centred in the
# card area; a card covers its zone's cells, and each icon sits in the middle of
# its own cell, so every icon on a plan is on the same lattice.
#
# Needs panel_text.be, panel_plan.be and panel_store.be loaded first. autoexec.be
# loads it, with panel_plan_view.be, when the generated project's Home is a plan.

#@ solidify:PanelDraw
class PanelDraw
    static var DASH = 8
    static var GAP = 6
    static var STROKE = 2
    # a summary card: its name's line, the room around, the gap between icons
    static var LABEL_H = 24
    static var PAD = 4
    static var KIND_GAP = 4
    static var ICON_LARGE = 48
    # a summary card's line of temperatures: the columns a piece needs for it, and the space
    # between the room's number and the floor's
    static var TEMPS_COLS = 3
    static var TEMPS_GAP = 8
    # the columns a piece needs for a thermostat's temperatures and a blind's position on one line
    static var BOTH_COLS = 4
    # xstr's centring and background modes
    static var LEFT = 0
    static var CENTER = 1
    static var RIGHT = 2
    static var SOLID = 1
    # where a state's glyph is in a kind's glyphs, in the style
    static var GLYPH = {"on": 0, "off": 1, "noanswer": 2, "nopower": 3}

    # the colour picker: a row per hue, as tall as a cell; a dot per level
    static var LEVELS = [100, 60, 30]
    static var PICKER_ROW = 46
    static var PICKER_ROW_MAX = 78   # 12 mm: a row as tall as the area allows, up to this (picker_row)
    static var PICKER_DOT = 16
    static var PICKER_RING = 21
    static var PICKER_GAP = 19

    # pct percent of RGB565 colour c over page, channel by channel: the glass has
    # no alpha. Rounded to the nearest with no negative in the sum -- the rule
    # of mix565 in draw.ts
    static def mix565(c, page, pct)
        var r = ((c >> 11) & 31) * pct + ((page >> 11) & 31) * (100 - pct) + 50
        var g = ((c >> 5) & 63) * pct + ((page >> 5) & 63) * (100 - pct) + 50
        var b = (c & 31) * pct + (page & 31) * (100 - pct) + 50
        return ((r / 100) << 11) | ((g / 100) << 5) | (b / 100)
    end

    # the colour a value of the picker shows: hue * 3 + level
    static def color_of(value, style)
        var palette = style["palette"]
        var hue = value / 3
        var c = hue < size(palette) ? palette[hue] : style["colors"]["card"]
        return PanelDraw.mix565(c, style["colors"]["page"], PanelDraw.LEVELS[value % 3])
    end

    # a zone's card colour: its own, or the theme's
    static def fill_of(zone, style)
        var c = zone.find("color", 0)
        return c != 0 ? PanelDraw.color_of(c, style) : style["colors"]["card"]
    end

    # the page coordinates of a cell's top-left corner; the matrix is centred
    static def cell_origin(store, col, row, style)
        var m = store.doc["matrix"]
        var left = style["origin"][0] + (style["area"][0] - PanelText.slot_col(m) * PanelStore.CELL_W) / 2
        var top = style["origin"][1] + (style["area"][1] - PanelText.slot_row(m) * PanelStore.CELL_H) / 2
        return [left + col * PanelStore.CELL_W, top + row * PanelStore.CELL_H]
    end

    # a block's rectangle on the page, inset: where a card's background goes
    static def block_box(store, block, style)
        var o = PanelDraw.cell_origin(store, block[0], block[1], style)
        var inset = PanelStore.INSET
        return [o[0] + inset, o[1] + inset, block[2] * PanelStore.CELL_W - 2 * inset, block[3] * PanelStore.CELL_H - 2 * inset]
    end

    # a filled rectangle with round corners: two bands and four circles
    # a filled rectangle with some corners round, [tl, tr, bl, br]: the middle
    # band top to bottom, the side strips short of their round corners, and a
    # circle in each of those -- roundSome in draw.ts
    static def round_some(ops, x, y, w, h, r, color, round)
        var tl = round[0]
        var tr = round[1]
        var bl = round[2]
        var br = round[3]
        if !tl && !tr && !bl && !br
            ops.push(["fill", x, y, w, h, color])
            return
        end
        ops.push(["fill", x + r, y, w - 2 * r, h, color])
        ops.push(["fill", x, y + (tl ? r : 0), r, h - (tl ? r : 0) - (bl ? r : 0), color])
        ops.push(["fill", x + w - r, y + (tr ? r : 0), r, h - (tr ? r : 0) - (br ? r : 0), color])
        if tl ops.push(["cirs", x + r, y + r, r, color]) end
        if tr ops.push(["cirs", x + w - 1 - r, y + r, r, color]) end
        if bl ops.push(["cirs", x + r, y + h - 1 - r, r, color]) end
        if br ops.push(["cirs", x + w - 1 - r, y + h - 1 - r, r, color]) end
    end

    # the rectangle of a cell of a shape: to the cell's edge on a side where
    # the next cell is the shape's too, inset where it is not; inside(dc, dr)
    # says whether the cell dc, dr away is the shape's
    static def cell_rect(store, col, row, style, inside)
        var o = PanelDraw.cell_origin(store, col, row, style)
        var inset = PanelStore.INSET
        var l = inside(-1, 0) ? 0 : inset
        var t = inside(0, -1) ? 0 : inset
        var r = inside(1, 0) ? 0 : inset
        var b = inside(0, 1) ? 0 : inset
        return [o[0] + l, o[1] + t, PanelStore.CELL_W - l - r, PanelStore.CELL_H - t - b]
    end

    # A card with holes, a row at a time: each run of its cells
    # side by side is one rectangle, inset at its ends, and above or below where
    # the whole run is open there; where only some of its cells are joined to
    # the next row, a strip takes those to their edge. A run with the same one
    # under it, joined all along, goes on down as one. Round at a corner open on
    # both sides, it paints what drawing the card cell by cell painted, in fewer
    # instructions (test_panel_draw.be holds it to that, pixel by pixel).
    static def shape(ops, store, zone, block, style, color)
        var inside = def (c, r) return PanelStore.in_zone(zone, PanelText.make_slot(r, c)) end
        var inset = PanelStore.INSET
        # [first col, last col, first row, last row, joined above all along,
        # joined below all along, and whether each corner is round: tl, tr, bl, br]
        var bands = []
        var strips = []
        for r: 1 .. block[3]
            var c = 1
            while c <= block[2]
                if !inside(c, r)
                    c += 1
                    continue
                end
                var last = c
                while last < block[2] && inside(last + 1, r) last += 1 end
                var n = last - c + 1
                var ups = 0
                var downs = 0
                for x: c .. last
                    if inside(x, r - 1) ups += 1 end
                    if inside(x, r + 1) downs += 1 end
                end
                var joined = false
                if ups == n
                    for x: bands
                        if x[3] == r - 1 && x[0] == c && x[1] == last && x[5]
                            x[3] = r
                            x[5] = downs == n
                            x[8] = !inside(c, r + 1)
                            x[9] = !inside(last, r + 1)
                            joined = true
                            break
                        end
                    end
                end
                if !joined
                    bands.push([c, last, r, r, ups == n, downs == n, !inside(c, r - 1), !inside(last, r - 1),
                                !inside(c, r + 1), !inside(last, r + 1)])
                end
                if ups > 0 && ups < n PanelDraw.join_strips(strips, store, block, style, inside, c, last, r, -1, color) end
                if downs > 0 && downs < n PanelDraw.join_strips(strips, store, block, style, inside, c, last, r, 1, color) end
                c = last + 1
            end
        end
        for x: bands
            var o = PanelDraw.cell_origin(store, block[0] + x[0] - 1, block[1] + x[2] - 1, style)
            var t = x[4] ? 0 : inset
            PanelDraw.round_some(ops, o[0] + inset, o[1] + t, (x[1] - x[0] + 1) * PanelStore.CELL_W - 2 * inset,
                (x[3] - x[2] + 1) * PanelStore.CELL_H - t - (x[5] ? 0 : inset), style["radius"], color, [x[6], x[7], x[8], x[9]])
        end
        for x: strips ops.push(x) end
    end

    # The strips of a run of a card's cells, first to last on row r, for the
    # cells joined to the row above (dir -1) or below (1) when the rest of the
    # run is not: the inset there, filled to the cell's edge, as drawing the
    # cell alone does
    static def join_strips(ops, store, block, style, inside, first, last, r, dir, color)
        var inset = PanelStore.INSET
        var c = first
        while c <= last
            if !inside(c, r + dir)
                c += 1
                continue
            end
            var b = c
            while b < last && inside(b + 1, r + dir) b += 1 end
            var o = PanelDraw.cell_origin(store, block[0] + c - 1, block[1] + r - 1, style)
            var l = c == first ? inset : 0
            ops.push(["fill", o[0] + l, o[1] + (dir < 0 ? 0 : PanelStore.CELL_H - inset),
                      (b - c + 1) * PanelStore.CELL_W - l - (b == last ? inset : 0), inset, color])
            c = b + 1
        end
    end

    static def round_rect(ops, x, y, w, h, r, color)
        var rr = r
        if w / 2 < rr rr = w / 2 end
        if h / 2 < rr rr = h / 2 end
        if rr <= 0
            ops.push(["fill", x, y, w, h, color])
            return
        end
        ops.push(["fill", x + rr, y, w - 2 * rr, h, color])
        ops.push(["fill", x, y + rr, w, h - 2 * rr, color])
        ops.push(["cirs", x + rr, y + rr, rr, color])
        ops.push(["cirs", x + w - 1 - rr, y + rr, rr, color])
        ops.push(["cirs", x + rr, y + h - 1 - rr, rr, color])
        ops.push(["cirs", x + w - 1 - rr, y + h - 1 - rr, rr, color])
    end

    # [[slot, device, zone], ...] in slot order, or nil
    static def card_slots(store, card)
        var ref = PanelStore.parse_ref(card[0])
        var zone = ref != nil ? store.find_zone(ref[1]) : nil
        if zone == nil return nil end
        var slots = []
        var members = zone["members"]
        for dev: members.keys()
            var s = members[dev]
            if s == 0 continue end
            # insertion by slot, the reading order of the card
            var i = 0
            while i < size(slots) && slots[i][0] < s i += 1 end
            slots.insert(i, [s, dev, zone])
        end
        return slots
    end

    # what one device shows: "on", "off", "nopower" from its relay, or "noanswer",
    # no communication, when the view's doubt has it; a relay
    # device shows its relay, whether or not the glass may switch it
    static def state_of(store, dev, view)
        if PanelStore.is_relay_id(dev)
            var n = store.relay_of(dev)
            return view["relayOn"][(n != 0 ? n : 1) - 1] ? "on" : "off"
        end
        if store.unpowered(dev, view["relayOn"]) return "nopower" end
        var doubt = view.find("doubt")
        if doubt != nil && doubt.contains(dev) return "noanswer" end
        var live = view["live"].find(dev, "unknown")
        return live == "on" ? "on" : (live == "noanswer" ? "noanswer" : "off")
    end

    static def kind_of(store, dev)
        var d = store.find_device(dev)
        return d != nil ? d[2] : "generic"
    end

    static def glyphs_of(style, kind)
        var glyphs = style["glyphs"]
        var set = glyphs.find(kind)
        # a window or a gate on a table made before they had glyphs: the blind's
        if set == nil && (kind == "window" || kind == "gate") set = glyphs.find("cover") end
        if set == nil set = glyphs.find("generic") end
        if set == nil set = glyphs["light"] end
        return set
    end

    # [glyph, colour] of a state; `lit`, the device whose own colour an "on" shows, and `tone`, what a kind's own look says (tone_of):
    # true for a thermostat that heats now, whose "on" is the warm tone and not the lit one; and for a blind,
    # "moving", the accent whatever it shows, "full", all the way up, green, and "part", open part of the way, the open
    # glyph unlit. Each appearance has the theme's own colour; tables made before the theme named them give no answer
    # and no power the unlit one, a lit one for the heating and the blind all the way up, and the pending tone for one that moves
    static def looks(set, state, lit, view, style, pending, tone)
        var glyph = set[PanelDraw.GLYPH[state]]
        var colors = style["colors"]
        if pending && state != "nopower" return [glyph, colors["pending"]] end
        if tone == "moving" && state != "nopower" && state != "noanswer" return [glyph, colors.find("moving", colors["pending"])] end
        if state == "on"
            if tone == true return [glyph, colors.find("heating", colors["iconOn"])] end
            if tone == "full" return [glyph, colors.find("open", colors["iconOn"])] end
            if tone == "part" return [glyph, colors["iconOff"]] end
            var own = view.find("colors")
            var c = (own != nil && lit != nil) ? own.find(lit) : nil
            return [glyph, c != nil ? c : colors["iconOn"]]
        end
        if state == "noanswer" return [glyph, colors.find("noAnswer", colors["iconOff"])] end
        if state == "nopower" return [glyph, colors.find("noPower", colors["iconOff"])] end
        return [glyph, colors["iconOff"]]
    end

    # whether any of these devices is a thermostat that heats now, as the view says (panel_thermostat.be tells the plan)
    static def heating_in(view, devs)
        var heating = view.find("heating")
        if heating == nil return false end
        for dev: devs
            if heating.contains(dev) return true end
        end
        return false
    end

    # What a kind's own look says of these devices (looks): a thermostat whether one heats, and a blind whether one moves, or is
    # all the way up; nil for the other kinds
    static def tone_of(kind, devs, view)
        if kind == "thermostat" return PanelDraw.heating_in(view, devs) end
        if kind != "cover" return nil end
        var moving = view.find("moving")
        var covers = view.find("covers")
        var full = false
        for dev: devs
            if moving != nil && moving.contains(dev) return "moving" end
            if covers != nil && covers.find(dev) == 100  full = true end
        end
        return full ? "full" : "part"
    end

    # [glyph, colour] of one device
    static def icon_of(store, dev, zone, view, style, pending)
        var kind = PanelDraw.kind_of(store, dev)
        # its glyphs by how it looks, a window's or a gate's for a blind that is one, its colours by its kind
        return PanelDraw.looks(PanelDraw.glyphs_of(style, PanelStore.look_of(store.find_device(dev))), PanelDraw.state_of(store, dev, view), dev, view, style, pending,
                               PanelDraw.tone_of(kind, [dev], view))
    end

    # [glyph, colour] of a group's icon, as the zone's counters show it:
    # on if any of its devices is, in the colour of the first lit; no
    # power or no communication only when all of them are, and in the warm tone when a thermostat of it
    # heats
    static def group_icon(store, devs, kind, view, style, pending)
        var lit = nil
        var all_nopower = true
        var all_noanswer = true
        for dev: devs
            var s = PanelDraw.state_of(store, dev, view)
            if s == "on" && lit == nil lit = dev end
            if s != "nopower" all_nopower = false end
            if s != "noanswer" all_noanswer = false end
        end
        var state = lit != nil ? "on" : (all_nopower ? "nopower" : (all_noanswer ? "noanswer" : "off"))
        # its glyphs by the look its devices share, a card's windows the window's, its colours by its kind
        return PanelDraw.looks(PanelDraw.glyphs_of(style, store.group_look(devs, kind)), state, lit, view, style, pending, PanelDraw.tone_of(kind, devs, view))
    end

    # the size of n icons side by side in a box, over the zone's name when it
    # carries it, and over a line of temperatures when `temps`: 48 px when they
    # fit, 32 otherwise, nil when not even those
    static def summary_size(box, named, n, temps)
        var room = box[3] - PanelDraw.PAD - (named ? PanelDraw.LABEL_H + PanelDraw.PAD : PanelDraw.PAD) -
                   (temps ? PanelDraw.LABEL_H + PanelDraw.PAD : 0)
        for sz: [PanelDraw.ICON_LARGE, PanelStore.ICON]
            if n * sz + (n - 1) * PanelDraw.KIND_GAP <= box[2] - 2 * PanelDraw.PAD && sz <= room return sz end
        end
        return nil
    end

    # The pieces of a zone's card, each its slots in reading
    # order, the pieces in the reading order of their first slots. A card
    # without holes is one piece
    static def card_pieces(zone)
        var g = zone["grid"]
        var free = def (c, r) return PanelStore.in_zone(zone, PanelText.make_slot(r + 1, c + 1)) end
        var out = []
        for piece: PanelPlan.pieces(PanelText.slot_col(g), PanelText.slot_row(g), free)
            var slots = []
            for cell: piece slots.push(PanelText.make_slot(cell[1] + 1, cell[0] + 1)) end
            out.push(slots)
        end
        return out
    end

    # The largest rectangle of a piece with no hole in it, as a block of the
    # plan: the taller of two the same size, then the first in reading order.
    # `slots` are the piece's, `block` the card's
    static def piece_rect(slots, block)
        var inside = {}
        for s: slots inside[s] = true end
        var cols = block[2]
        var rows = block[3]
        var best = [block[0], block[1], 0, 0]
        for r0: 0 .. rows - 1
            for c0: 0 .. cols - 1
                var w = cols - c0
                var h = 1
                while r0 + h <= rows
                    # the width every row down to this one has from c0
                    var run = 0
                    while run < w && inside.contains(PanelText.make_slot(r0 + h, c0 + run + 1)) run += 1 end
                    w = run
                    if w == 0 break end
                    var area = w * h
                    var best_area = best[2] * best[3]
                    if area > best_area || (area == best_area && h > best[3]) best = [block[0] + c0, block[1] + r0, w, h] end
                    h += 1
                end
            end
        end
        return best
    end

    # How a zone's card is drawn now: nil for its places, or
    # its pieces, each [rect, groups, summed, named, slots]. Adaptive sums up
    # each piece whose groups fit its largest whole rectangle of 2x2 or more,
    # and the others show their places; uniform sums up every piece when they
    # all fit, and none when one does not. The largest piece summed up carries
    # the zone's name, and a piece with no device shows nothing
    static def display_parts(store, zone, block, style)
        var mode = zone.find("display", "places")
        if mode == "places" return nil end
        var members = zone["members"]
        var ids = PanelStore.member_ids(members)
        var parts = []
        var all_fit = true
        for slots: PanelDraw.card_pieces(zone)
            var devs = []
            for dev: ids
                if slots.find(members[dev]) != nil devs.push(dev) end
            end
            var rect = PanelDraw.piece_rect(slots, block)
            var groups = store.groups_of(devs)
            var fits = size(groups) > 0 && rect[2] >= 2 && rect[3] >= 2 &&
                       PanelDraw.summary_size(PanelDraw.block_box(store, rect, style), true, size(groups), false) != nil
            if size(groups) > 0 && !fits all_fit = false end
            parts.push([rect, groups, fits, false, slots])
        end
        var named = nil
        for p: parts
            if mode == "uniform" && !all_fit p[2] = false end
            if p[2] && (named == nil || p[0][2] * p[0][3] > named[0][2] * named[0][3] ||
                        (p[0][2] * p[0][3] == named[0][2] * named[0][3] && p[0][3] > named[0][3])) named = p end
        end
        if named == nil return nil end
        named[3] = true
        return parts
    end

    # how many BYTES of s, at whole characters, fit width pixels of the font
    # whose advances are adv (U+0020..U+00FF, one byte each); a double quote and
    # anything past U+00FF measure nothing. The runtime's span, without its limit
    static def span(s, adv, width)
        import string
        var pen = 0
        var i = 0
        var n = size(s)
        while i < n
            var b = string.byte(s[i])
            var len = b >= 0xF0 ? 4 : b >= 0xE0 ? 3 : b >= 0xC0 ? 2 : 1
            var cp = len == 1 ? b : -1
            if len == 2 && i + 1 < n
                cp = ((b & 0x1F) << 6) | (string.byte(s[i + 1]) & 0x3F)
            end
            var a = (cp >= 0x20 && cp <= 0xFF && cp != 0x22) ? adv[cp - 0x20] : 0
            if pen + a > width break end
            pen += a
            i += len
        end
        return i
    end

    # a name as it fits width pixels of the body font: whole, or the longest
    # start that leaves room for "..", trailing spaces dropped -- the rule of the
    # runtime's fit, and of fitZiText in libs/nspanel-sim/export/src/textRaster.ts.
    # `adv` is bytes, or its hex when the style was read from JSON
    static def fit_name(adv, s, width)
        if type(adv) == "string" adv = bytes(adv) end
        if PanelDraw.span(s, adv, width) == size(s) return s end
        var room = width - 2 * adv[0x2E - 0x20]
        if room < 0
            var whole = PanelDraw.span(s, adv, width)
            return whole == 0 ? "" : s[0 .. whole - 1]
        end
        var k = PanelDraw.span(s, adv, room)
        while k > 0 && s[k - 1] == " " k -= 1 end
        return (k == 0 ? "" : s[0 .. k - 1]) + ".."
    end

    # The temperatures a piece summed up shows between its icons and its name, [room, floor] as text with the
    # degree sign, the floor nil when there is no reading of it: those of the first thermostat of the piece, once it has said
    # its room's. Nothing for a piece narrower than TEMPS_COLS, or for a thermostat with no communication or no power: what it
    # last said is not what is there now. The view's `temps` has them, in whole degrees (panel_thermostat.be)
    static def temps_of(store, part, view)
        var temps = view.find("temps")
        if temps == nil || part[0][2] < PanelDraw.TEMPS_COLS return nil end
        for g: part[1]
            if g[0] != "thermostat" continue end
            var id = g[2][0]
            var t = temps.find(id)
            var state = PanelDraw.state_of(store, id, view)
            if t == nil || t[0] == nil || state == "noanswer" || state == "nopower" return nil end
            return [str(t[0]) + "°", t[1] != nil ? str(t[1]) + "°" : nil]
        end
        return nil
    end

    # The line of temperatures: the room's, alone and centred, or with the floor's, the room's against the middle on its
    # left and the floor's on its right in the theme's secondary colour, so the numbers do not slide as their digits change.
    # `card` is what both are drawn over; tables made before the theme named the secondary colour have the ghost's, which is
    # the same token, and the unlit icon's before that
    static def temps_line(temps, x, y, w, style, card)
        var colors = style["colors"]
        var font = style["fonts"]["body"]
        var h = PanelDraw.LABEL_H
        if temps[1] == nil
            return [["xstr", x, y, w, h, font, colors["label"], card, PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, temps[0]]]
        end
        var half = (w - PanelDraw.TEMPS_GAP) / 2
        var second = colors.find("secondary", colors.find("ghost", colors["iconOff"]))
        return [["xstr", x, y, half, h, font, colors["label"], card, PanelDraw.RIGHT, PanelDraw.CENTER, PanelDraw.SOLID, temps[0]],
                ["xstr", x + w - half, y, half, h, font, second, card, PanelDraw.LEFT, PanelDraw.CENTER, PanelDraw.SOLID, temps[1]]]
    end

    # A blind's position as a summed-up card shows it, "70%": the first blind of the piece's, once it said one. Nothing
    # for one with no communication or no power, as for a thermostat's temperatures
    static def cover_of(store, part, view)
        var covers = view.find("covers")
        if covers == nil return nil end
        for g: part[1]
            if g[0] != "cover" continue end
            var id = g[2][0]
            var p = covers.find(id)
            var state = PanelDraw.state_of(store, id, view)
            if p == nil || state == "noanswer" || state == "nopower" return nil end
            return str(p) + "%"
        end
        return nil
    end

    # The line a summed-up card shows between its icons and its name: ["temps", [room, floor]] for a thermostat's, ["cover", text]
    # for a blind's position, and ["both", room, floor, text] for the two, on a piece of BOTH_COLS columns or more.
    # A narrower piece with both shows the kind that comes first in the order, the blind; nil for none, or a piece narrower
    # than TEMPS_COLS
    static def info_of(store, part, view)
        if part[0][2] < PanelDraw.TEMPS_COLS return nil end
        var t = PanelDraw.temps_of(store, part, view)
        var c = PanelDraw.cover_of(store, part, view)
        if t != nil && c != nil
            if part[0][2] >= PanelDraw.BOTH_COLS return ["both", t[0], t[1], c] end
            for g: part[1]
                if g[0] == "cover" return ["cover", c] end
                if g[0] == "thermostat" return ["temps", t] end
            end
        end
        if t != nil return ["temps", t] end
        if c != nil return ["cover", c] end
        return nil
    end

    # The line itself: the temperatures as temps_line draws them, a blind's position alone and centred, or the two in thirds, the
    # room's, the floor's in the secondary colour and the position, the position in the right half when there is no floor
    static def info_line(line, x, y, w, style, card)
        if line[0] == "temps" return PanelDraw.temps_line(line[1], x, y, w, style, card) end
        var colors = style["colors"]
        var font = style["fonts"]["body"]
        var h = PanelDraw.LABEL_H
        if line[0] == "cover"
            return [["xstr", x, y, w, h, font, colors["label"], card, PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, line[1]]]
        end
        var parts = line[2] != nil ? [[line[1], colors["label"]], [line[2], colors.find("secondary", colors.find("ghost", colors["iconOff"]))],
                                      [line[3], colors["label"]]] : [[line[1], colors["label"]], [line[3], colors["label"]]]
        var n = size(parts)
        var each = w / n
        var out = []
        for i: 0 .. n - 1
            out.push(["xstr", x + i * each, y, each, h, font, parts[i][1], card, PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, parts[i][0]])
        end
        return out
    end

    # a piece summed up: its groups' icons, centred over the zone's name when
    # it carries it, which is centred below; and between them
    # the line of its thermostat's temperatures and its blind's position, when the piece has the room for it
    static def summary(store, zone, part, view, style, pending)
        var named = part[3]
        var box = PanelDraw.block_box(store, part[0], style)
        var x = box[0]
        var y = box[1]
        var w = box[2]
        var h = box[3]
        var groups = part[1]
        var n = size(groups)
        var temps = PanelDraw.info_of(store, part, view)
        var sz = temps != nil ? PanelDraw.summary_size(box, named, n, true) : nil
        if sz == nil
            # no room for the line with icons that size: the card is as it was
            temps = nil
            sz = PanelDraw.summary_size(box, named, n, false)
        end
        var pad = PanelDraw.PAD
        var label_top = named ? y + h - pad - PanelDraw.LABEL_H : y + h
        var total = n * sz + (n - 1) * PanelDraw.KIND_GAP
        var left = x + (w - total) / 2
        # the icons, the line of temperatures if there is one, and the name, with the same room at the top and between them
        var gap = (label_top - y - sz - (temps != nil ? PanelDraw.LABEL_H : 0)) / (temps != nil ? 3 : 2)
        var iy = y + gap
        var font = sz == PanelDraw.ICON_LARGE ? style["fonts"]["iconLarge"] : style["fonts"]["icon"]
        var card = PanelDraw.fill_of(zone, style)
        var ops = []
        for i: 0 .. n - 1
            var icon = PanelDraw.group_icon(store, groups[i][2], groups[i][0], view, style, pending)
            ops.push(["xstr", left + i * (sz + PanelDraw.KIND_GAP), iy, sz, sz, font, icon[1], card,
                      PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, icon[0]])
        end
        if temps != nil
            for op: PanelDraw.info_line(temps, x + pad, iy + sz + gap, w - 2 * pad, style, card) ops.push(op) end
        end
        if named
            ops.push(["xstr", x + pad, label_top, w - 2 * pad, PanelDraw.LABEL_H, style["fonts"]["body"], style["colors"]["label"], card,
                      PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, PanelDraw.fit_name(style["advances"], zone["name"], w - 2 * pad)])
        end
        return ops
    end

    # what is inside a card: what a state change, or the pending tone, redraws.
    # A card of places has an icon in the glyph's own square in the middle of
    # each place's cell; a piece summed up, its groups, and the zone's name in
    # the largest. No card carries a number
    static def card_icons(store, card, view, style)
        var slots = PanelDraw.card_slots(store, card)
        var block = store.card_block(card)
        if slots == nil || block == nil return [] end
        var pend = view.find("pending")
        var pending = pend != nil && pend.find(card[0]) != nil
        # card_slots found the zone, so the ref is one
        var zone = store.find_zone(PanelStore.parse_ref(card[0])[1])
        var ops = []
        var parts = PanelDraw.display_parts(store, zone, block, style)
        if parts != nil
            # the pieces summed up draw their groups, and the others their places
            var placed = {}
            for p: parts
                if p[2]
                    for op: PanelDraw.summary(store, zone, p, view, style, pending) ops.push(op) end
                else
                    for s: p[4] placed[s] = true end
                end
            end
            var rest = []
            for entry: slots
                if placed.contains(entry[0]) rest.push(entry) end
            end
            slots = rest
        end
        var sz = PanelStore.ICON
        var dx = (PanelStore.CELL_W - sz) / 2
        var dy = (PanelStore.CELL_H - sz) / 2
        var fill = PanelDraw.fill_of(zone, style)
        for entry: slots
            var o = PanelDraw.cell_origin(store, block[0] + PanelText.slot_col(entry[0]) - 1, block[1] + PanelText.slot_row(entry[0]) - 1, style)
            var icon = PanelDraw.icon_of(store, entry[1], entry[2], view, style, pending)
            ops.push(["xstr", o[0] + dx, o[1] + dy, sz, sz, style["fonts"]["icon"], icon[1],
                      fill, PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, icon[0]])
        end
        return ops
    end

    # one whole card: its background, then what is inside it
    static def card(store, card, view, style)
        var block = store.card_block(card)
        if block == nil return [] end
        var box = PanelDraw.block_box(store, block, style)
        var ops = []
        var ref = PanelStore.parse_ref(card[0])
        var zone = ref != nil ? store.find_zone(ref[1]) : nil
        if zone != nil && size(zone.find("holes", [])) > 0
            PanelDraw.shape(ops, store, zone, block, style, PanelDraw.fill_of(zone, style))
        else
            PanelDraw.round_rect(ops, box[0], box[1], box[2], box[3], style["radius"], zone != nil ? PanelDraw.fill_of(zone, style) : style["colors"]["card"])
        end
        for op: PanelDraw.card_icons(store, card, view, style) ops.push(op) end
        return ops
    end

    # A hue's row: the area's height shared among the hues, between a cell's
    # 46 px and 12 mm. The EU's 234 px give the 46 it always had; the US
    # portrait's 394 give 78, where rows of 46 would fill half the room the
    # picker has.
    static def picker_row(style)
        var n = size(style["palette"])
        var r = n > 0 ? style["area"][1] / n : PanelDraw.PICKER_ROW
        if r > PanelDraw.PICKER_ROW_MAX r = PanelDraw.PICKER_ROW_MAX end
        if r < PanelDraw.PICKER_ROW r = PanelDraw.PICKER_ROW end
        return r
    end

    # the centre of a value's dot on the page
    static def picker_dot(value, style)
        var col_w = style["area"][0] / 3
        var row = PanelDraw.picker_row(style)
        return [style["origin"][0] + col_w * (value % 3) + col_w / 2,
                style["origin"][1] + (value / 3) * row + row / 2]
    end

    # The picker, drawn on the plan's page where the cards go: one row per hue,
    # its three levels as dots, the one chosen in a ring. No names
    static def picker(style, chosen)
        var colors = style["colors"]
        var ops = [["fill", style["origin"][0], style["origin"][1], style["area"][0], style["area"][1], colors["page"]]]
        for value: 0 .. size(style["palette"]) * 3 - 1
            var c = PanelDraw.picker_dot(value, style)
            if value == chosen
                ops.push(["cirs", c[0], c[1], PanelDraw.PICKER_RING, colors["label"]])
                ops.push(["cirs", c[0], c[1], PanelDraw.PICKER_GAP, colors["page"]])
            end
            ops.push(["cirs", c[0], c[1], PanelDraw.PICKER_DOT, PanelDraw.color_of(value, style)])
        end
        return ops
    end

    # the value under a touch on the picker, or nil: a row is a hue, a third of the width a level
    static def hit_picker(x, y, style)
        var col_w = style["area"][0] / 3
        if x < style["origin"][0] || y < style["origin"][1] return nil end
        var col = (x - style["origin"][0]) / col_w
        var row = (y - style["origin"][1]) / PanelDraw.picker_row(style)
        if col > 2 || row >= size(style["palette"]) return nil end
        return row * 3 + col
    end

    # a whole plan, as it is drawn when the page opens; `clear` paints the card
    # area first, for a redraw on a page that already shows cards
    static def plan(store, screen_id, view, style, clear)
        var ops = []
        for part: PanelDraw.plan_parts(store, screen_id, view, style, clear)
            for op: part() ops.push(op) end
        end
        return ops
    end

    # The same plan in the pieces it is drawn in: the area cleared, then one per
    # card, each a function that builds its ops when it is called. The plan view
    # sends them a block at a time (next_block), holding one card's ops and one
    # block of text instead of the whole plan's.
    static def plan_parts(store, screen_id, view, style, clear)
        var screen = store.find_screen(screen_id)
        if screen == nil return [] end
        var parts = []
        if clear
            var fill = [["fill", style["origin"][0], style["origin"][1], style["area"][0], style["area"][1], style["colors"]["page"]]]
            parts.push(/ -> fill)
        end
        for c: screen["cards"]
            parts.push(PanelDraw.card_part(store, c, view, style))
        end
        return parts
    end

    static def card_part(store, c, view, style)
        return / -> PanelDraw.card(store, c, view, style)
    end

    # "Empty", in the middle, for a plan with nothing on it, Editing on or off: a
    # word, in the text colour a placeholder has (the dashed card's), and not in
    # an unlit icon's, which is 2.6:1 on the page
    static def empty(style, text)
        var area = style["area"]
        return [["xstr", style["origin"][0], style["origin"][1], area[0], area[1], style["fonts"]["body"],
                 style["colors"]["ghost"], style["colors"]["page"],
                 PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID, text != nil ? text : "Empty"]]
    end

    # the dashed card: a ring of short strokes and, inside, its lines in the
    # body font, as many as fit; about 1.5 KB on a large card, so only redrawn
    # when it changes
    # short strokes along a line from (x, y), len long, across or down
    static def dashes(ops, x, y, len, across, color)
        var d = 0
        while d < len
            var n = len - d < PanelDraw.DASH ? len - d : PanelDraw.DASH
            ops.push(across ? ["fill", x + d, y, n, PanelDraw.STROKE, color] : ["fill", x, y + d, PanelDraw.STROKE, n, color])
            d += PanelDraw.DASH + PanelDraw.GAP
        end
    end

    # The dashed card with holes: strokes along every side of
    # its cells that is its edge, and its lines in the widest band of whole
    # rows; over a hole they would paint on the card that holds it
    static def ghost_shape(store, ghost, style)
        var b = ghost["block"]
        var holes = ghost["holes"]
        var own = def (c, r)
            if c < b[0] || r < b[1] || c >= b[0] + b[2] || r >= b[1] + b[3] return false end
            for h: holes
                if h[0] == c && h[1] == r return false end
            end
            return true
        end
        var color = style["colors"]["ghost"]
        var stroke = PanelDraw.STROKE
        var ops = []
        for r: b[1] .. b[1] + b[3] - 1
            for c: b[0] .. b[0] + b[2] - 1
                if !own(c, r) continue end
                var inside = def (dc, dr) return own(c + dc, r + dr) end
                var x = PanelDraw.cell_rect(store, c, r, style, inside)
                if !inside(0, -1) PanelDraw.dashes(ops, x[0], x[1], x[2], true, color) end
                if !inside(0, 1) PanelDraw.dashes(ops, x[0], x[1] + x[3] - stroke, x[2], true, color) end
                if !inside(-1, 0) PanelDraw.dashes(ops, x[0], x[1], x[3], false, color) end
                if !inside(1, 0) PanelDraw.dashes(ops, x[0] + x[2] - stroke, x[1], x[3], false, color) end
            end
        end
        # the longest run of rows with no hole, the first of the longest
        var best = [0, 0]
        var start = -1
        for r: b[1] .. b[1] + b[3]
            var whole = r < b[1] + b[3]
            if whole
                for c: b[0] .. b[0] + b[2] - 1
                    if !own(c, r) whole = false end
                end
            end
            if whole && start < 0 start = r end
            if !whole && start >= 0
                if r - start > best[1] best = [start, r - start] end
                start = -1
            end
        end
        if best[1] > 0
            var box = PanelDraw.block_box(store, [b[0], best[0], b[2], best[1]], style)
            var line = PanelStore.GHOST_LINE
            var lines = ghost["lines"]
            var fit = (box[3] - 2 * stroke) / line
            if size(lines) < fit fit = size(lines) end
            var top = box[1] + (box[3] - fit * line) / 2
            # each line fitted to the card with "..": xstr cuts mid-letter at the
            # box's edge, and a card one column wide is 32 px inside its stroke
            for i: 0 .. fit - 1
                ops.push(["xstr", box[0] + stroke, top + i * line, box[2] - 2 * stroke, line, style["fonts"]["body"], color,
                          style["colors"]["page"], PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID,
                          PanelDraw.fit_name(style["advances"], lines[i], box[2] - 2 * stroke)])
            end
        end
        return ops
    end

    static def ghost(store, ghost, style)
        if size(ghost.find("holes", [])) > 0 return PanelDraw.ghost_shape(store, ghost, style) end
        var box = PanelDraw.block_box(store, ghost["block"], style)
        var x = box[0]
        var y = box[1]
        var w = box[2]
        var h = box[3]
        var c = style["colors"]["ghost"]
        var dash = PanelDraw.DASH
        var stroke = PanelDraw.STROKE
        var ops = []
        var d = 0
        while d < w
            var len = w - d < dash ? w - d : dash
            ops.push(["fill", x + d, y, len, stroke, c])
            ops.push(["fill", x + d, y + h - stroke, len, stroke, c])
            d += dash + PanelDraw.GAP
        end
        d = 0
        while d < h
            var len = h - d < dash ? h - d : dash
            ops.push(["fill", x, y + d, stroke, len, c])
            ops.push(["fill", x + w - stroke, y + d, stroke, len, c])
            d += dash + PanelDraw.GAP
        end
        var lines = ghost["lines"]
        var line = PanelStore.GHOST_LINE
        var fit = (h - 2 * stroke) / line
        if size(lines) < fit fit = size(lines) end
        var top = y + (h - fit * line) / 2
        # fitted as the shaped card's lines are, above
        for i: 0 .. fit - 1
            ops.push(["xstr", x + stroke, top + i * line, w - 2 * stroke, line,
                      style["fonts"]["body"], c, style["colors"]["page"],
                      PanelDraw.CENTER, PanelDraw.CENTER, PanelDraw.SOLID,
                      PanelDraw.fit_name(style["advances"], lines[i], w - 2 * stroke)])
        end
        return ops
    end

    # Where the dashed card was, back to the page: its own cells,
    # whole, a fill for each run of them in a row and the rows under it that
    # have the same run. They are free, and a card never paints past its own
    # cells, so no card is under them.
    static def ghost_erase(store, ghost, style)
        var b = ghost["block"]
        var holes = ghost.find("holes", [])
        var own = def (c, r)
            for h: holes
                if h[0] == c && h[1] == r return false end
            end
            return true
        end
        var runs = []   # [first col, last col, first row, last row]
        for r: b[1] .. b[1] + b[3] - 1
            var c = b[0]
            while c < b[0] + b[2]
                if !own(c, r)
                    c += 1
                    continue
                end
                var last = c
                while last + 1 < b[0] + b[2] && own(last + 1, r) last += 1 end
                var joined = false
                for x: runs
                    if x[3] == r - 1 && x[0] == c && x[1] == last
                        x[3] = r
                        joined = true
                        break
                    end
                end
                if !joined runs.push([c, last, r, r]) end
                c = last + 1
            end
        end
        var ops = []
        for x: runs
            var o = PanelDraw.cell_origin(store, x[0], x[2], style)
            ops.push(["fill", o[0], o[1], (x[1] - x[0] + 1) * PanelStore.CELL_W, (x[3] - x[2] + 1) * PanelStore.CELL_H, style["colors"]["page"]])
        end
        return ops
    end

    # the cell under a touch at page coordinates (x, y), or nil off the matrix
    static def hit_cell(store, x, y, style)
        var o = PanelDraw.cell_origin(store, 0, 0, style)
        if x < o[0] || y < o[1] return nil end
        var col = (x - o[0]) / PanelStore.CELL_W
        var row = (y - o[1]) / PanelStore.CELL_H
        var m = store.doc["matrix"]
        if col >= PanelText.slot_col(m) || row >= PanelText.slot_row(m) return nil end
        return [col, row]
    end

    # the card under a touch at page coordinates (x, y), or nil
    static def hit_card(store, screen_id, x, y, style)
        var screen = store.find_screen(screen_id)
        var cell = PanelDraw.hit_cell(store, x, y, style)
        if screen == nil || cell == nil return nil end
        # a hole of a card is not the card: the cell is the other card's, or nobody's
        for c: screen["cards"]
            if PanelPlan.held_by(store.card_blocks(c), cell) return c end
        end
        return nil
    end

    # --- to the wire

    # one instruction as the Nextion reads it; the 0xFF terminator goes on send
    static def op_text(op)
        import string
        var n = op[0] == "xstr" ? 10 : size(op) - 1
        var s = op[0] + " "
        for i: 1 .. n
            if i > 1 s += "," end
            s += str(op[i])
        end
        if op[0] == "xstr"
            # a quote would end the string early; names typed on the glass cannot
            # have one. A backslash, which the symbols' keyboard types, goes
            # doubled: the Nextion reads one as the start of an escape
            s += ",\"" + string.replace(string.replace(op[11], "\\", "\\\\"), "\"", "'") + "\""
        end
        return s
    end

    # the instructions in blocks under `limit` bytes each, terminators included,
    # against the glass's 1 024-byte input buffer. The first block
    # does not go alone: the header's title, its action and the status icon go
    # just before and just after it, up to 178 bytes on the EU's header, and a
    # block leaves them room under 1 000
    static BLOCK_BYTES = 820

    # The next block of a stream of parts, by chunk_ops's own rule, so a plan sent
    # this way crosses the line in exactly the blocks chunk_ops makes of it; nil
    # when the stream is done. A stream is {"parts": [f() -> ops], "k": the next
    # part, "ops": the part being read, "j": its next op, "carry": the text that
    # did not fit the block before}.
    static def next_block(stream, limit)
        if limit == nil limit = PanelDraw.BLOCK_BYTES end
        var block = []
        var bytes_in = 0
        if stream["carry"] != nil
            block.push(stream["carry"])
            bytes_in = size(stream["carry"]) + 3
            stream["carry"] = nil
        end
        while true
            while stream["j"] >= size(stream["ops"])
                if stream["k"] >= size(stream["parts"]) return size(block) > 0 ? block : nil end
                stream["ops"] = stream["parts"][stream["k"]]()
                stream["k"] += 1
                stream["j"] = 0
            end
            var text = PanelDraw.op_text(stream["ops"][stream["j"]])
            stream["j"] += 1
            var sz = size(text) + 3
            if size(block) > 0 && bytes_in + sz > limit
                stream["carry"] = text
                return block
            end
            block.push(text)
            bytes_in += sz
        end
    end

    static def chunk_ops(ops, limit)
        if limit == nil limit = PanelDraw.BLOCK_BYTES end
        var blocks = []
        var block = []
        var bytes_in = 0
        for op: ops
            var text = PanelDraw.op_text(op)
            var sz = size(text) + 3
            if size(block) > 0 && bytes_in + sz > limit
                blocks.push(block)
                block = []
                bytes_in = 0
            end
            block.push(text)
            bytes_in += sz
        end
        if size(block) > 0 blocks.push(block) end
        return blocks
    end
end
