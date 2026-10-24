# berry/panel_draw.be against berry/test/vectors/draw.json: every instruction
# the glass would get, compared one by one.
#
# The vectors are this suite's own: the inputs by hand, what they must draw as
# the drawing drew it when the change was meant. `node berry/test/run.mjs
# --update-vectors` writes that (UPDATE_VECTORS: check_at records instead of
# comparing), and the diff of the file is the review. The simulator runs this
# file too.

import json

var failures = 0
var checks = 0

def deep_eq(a, b)
    if a == nil || b == nil return a == nil && b == nil end
    if isinstance(a, list)
        if !isinstance(b, list) || size(a) != size(b) return false end
        for i: 0 .. size(a) - 1
            if !deep_eq(a[i], b[i]) return false end
        end
        return true
    end
    if isinstance(a, map)
        if !isinstance(b, map) || size(a) != size(b) return false end
        for k: a.keys()
            if !b.contains(k) || !deep_eq(a[k], b[k]) return false end
        end
        return true
    end
    return a == b
end

def check(name, got, want)
    checks += 1
    if !deep_eq(got, want)
        failures += 1
        print("FAIL " + name)
        print("  got  " + json.dump(got))
        print("  want " + json.dump(want))
    end
end

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

var v = json.load(read_text("berry/test/vectors/draw.json"))

# a check whose expectation is in the vectors, at a path: recorded instead with UPDATE_VECTORS
def check_at(name, got, path)
    if UPDATE_VECTORS
        checks += 1
        print("VECTOR " + json.dump(path) + " " + json.dump(got))
        return
    end
    var want = v
    for k: path want = want[k] end
    check(name, got, want)
end

# a list of instructions: its length, then each, so a failure says which one
def check_list(name, got, path)
    if UPDATE_VECTORS return check_at(name, got, path) end
    var want = v
    for k: path want = want[k] end
    check(name + ": as many instructions", size(got), size(want))
    for i: 0 .. size(want) - 1
        check(name + " instruction " + str(i), i < size(got) ? got[i] : nil, want[i])
    end
end

var store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
# the Living room as the EU fits it: made 8 x 5, it takes the panel's 11 x 5 as it is
check("the Living room fits the EU with no turn", store.fit_matrix(v["matrix"])["value"], 0)
var style = v["style"]
var view = v["view"]

# the whole plan, instruction by instruction, so a failure says which one
var plan = PanelDraw.plan(store, "home", view, style, false)
check_list("the plan", plan, ["plan"])

var middle = nil
for c: store.doc["screens"][0]["cards"] if c[0] == "z:middle" middle = c end end
var unpowered = {"live": view["live"], "relayOn": [true, false], "colors": view["colors"]}
check_at("the Middle without power", PanelDraw.card_icons(store, middle, unpowered, style), ["middleUnpowered"])
var pending = {"live": view["live"], "relayOn": view["relayOn"], "colors": view["colors"], "pending": ["z:middle"]}
check_at("the Middle pending", PanelDraw.card_icons(store, middle, pending, style), ["middlePending"])
# no communication: two lamps a command did not confirm in time,
# with nothing heard from them since, whatever they last said
var doubt = {"0x00124B0000E00002": true, "0x00124B0000E00003": true}
var silent = {"live": view["live"], "relayOn": view["relayOn"], "colors": view["colors"], "doubt": doubt}
check_at("the Middle with two lamps with no communication", PanelDraw.card_icons(store, middle, silent, style), ["middleDoubt"])
var doubted = []
for op: PanelDraw.card_icons(store, middle, silent, style)
    if op[0] == "xstr" && op[11] == style["glyphs"]["light"][PanelDraw.GLYPH["noanswer"]] doubted.push(op[6]) end
end
check("two icons in the no answer's glyph, in the theme's colour for it", doubted, [style["colors"]["noAnswer"], style["colors"]["noAnswer"]])
# with no power, the dashed glyph in the theme's colour for it
def appearance_checks()
    var dashed = []
    for op: PanelDraw.card_icons(store, middle, unpowered, style)
        if op[0] == "xstr" && op[11] == style["glyphs"]["light"][PanelDraw.GLYPH["nopower"]] dashed.push(op[6]) end
    end
    check("the Middle without power: every icon dashed, in the theme's colour for it",
          [size(dashed) > 0, dashed.find(style["colors"]["noPower"]) != nil, dashed.find(style["colors"]["iconOff"])], [true, true, nil])
    # tables made before a theme named the two: the unlit colour
    var old = {"colors": {"iconOff": 1, "iconOn": 2, "pending": 3}}
    var set = style["glyphs"]["light"]
    check("tables with no colour for them: no answer and no power unlit",
          [PanelDraw.looks(set, "noanswer", nil, view, old, false)[1], PanelDraw.looks(set, "nopower", nil, view, old, false)[1]], [1, 1])
end
appearance_checks()
var group = ["0x00124B0000E00002", "0x00124B0000E00004"]
check("a summed-up group with one lamp with no communication and none on is off",
      PanelDraw.group_icon(store, group, "light", {"live": {}, "relayOn": [true, true], "doubt": doubt}, style, false)[0],
      style["glyphs"]["light"][PanelDraw.GLYPH["off"]])
check("and with all of them, the no answer's glyph",
      PanelDraw.group_icon(store, group, "light", {"live": {}, "relayOn": [true, true], "doubt": {group[0]: true, group[1]: true}}, style, false)[0],
      style["glyphs"]["light"][PanelDraw.GLYPH["noanswer"]])
check_at("the dashed card", PanelDraw.ghost(store, v["ghost"]["ghost"], style), ["ghost", "ops"])
# A card one column wide is 32 px inside its stroke. Its lines are fitted
# there with "..", as every name is: xstr cuts mid-letter at the box's edge.
var narrow_texts = []
for op: PanelDraw.ghost(store, {"block": [0, 0, 1, 3], "lines": ["no room"]}, style)
    if op[0] == "xstr" narrow_texts.push(op[11]) end
end
check("a narrow dashed card fits its line", narrow_texts, [PanelDraw.fit_name(style["advances"], "no room", PanelStore.CELL_W - 2 * PanelStore.INSET - 2 * PanelDraw.STROKE)])
check("and a long one ends in the ellipsis", narrow_texts[0][-2 ..], "..")
check_at("an empty plan", PanelDraw.empty(style, nil), ["empty"])

# summary cards: each case's edits on a Living room of its own, then its card
for ci: 0 .. size(v["summaries"]) - 1
    var c = v["summaries"][ci]
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(v["matrix"])
    for e: c["edits"]
        var r
        if e[0] == "display" r = st.set_display(e[1], e[2])
        elif e[0] == "rename" r = st.rename_zone(e[1], e[2])
        elif e[0] == "register" r = st.register_device(e[1])
        elif e[0] == "screen" r = st.add_screen(e[1])
        elif e[0] == "zone" r = st.create_zone(e[1], e[2], e[3], e[4])
        elif e[0] == "slot" r = st.set_slot(e[1], e[2], e[3], false)
        else r = st.add_to_zone(e[1], e[2])
        end
        check(c["name"] + ": " + e[0], r["ok"], true)
    end
    var card = nil
    for sc: st.doc["screens"]
        for k: sc["cards"] if k[0] == c["card"] card = k end end
    end
    var cv = {"live": view["live"], "relayOn": view["relayOn"], "colors": view["colors"]}
    for k: c["view"].keys() cv[k] = c["view"][k] end
    check_at(c["name"], PanelDraw.card_icons(st, card, cv, style), ["summaries", ci, "ops"])
end

for hi: 0 .. size(v["hits"]) - 1
    var h = v["hits"][hi]
    var card = PanelDraw.hit_card(store, "home", h[0], h[1], style)
    check_at("hit " + str(h[0]) + "," + str(h[1]), card != nil ? card[0] : nil, ["hits", hi, 2])
end
for ti: 0 .. size(v["texts"]) - 1
    var t = v["texts"][ti]
    check_at("text of " + t[0][0], PanelDraw.op_text(t[0]), ["texts", ti, 1])
end

# a zone's colour: the card and its icons' ground, and the picker
for mi: 0 .. size(v["mixes"]) - 1
    var m = v["mixes"][mi]
    check_at("mix of " + str(m[0]) + " over " + str(m[1]) + " at " + str(m[2]), PanelDraw.mix565(m[0], m[1], m[2]), ["mixes", mi, 3])
end
var colored = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
colored.fit_matrix(v["matrix"])
check("the Middle takes blue at 60 %", colored.set_color("middle", v["colored"]["value"])["ok"], true)
var mcard = nil
for c: colored.doc["screens"][0]["cards"] if c[0] == "z:middle" mcard = c end end
check_at("the coloured Middle", PanelDraw.card(colored, mcard, view, style), ["colored", "ops"])
check_at("the picker, blue at 60 % chosen", PanelDraw.picker(style, v["picker"]["chosen"]), ["picker", "ops"])
check_at("the picker, the theme's own chosen", PanelDraw.picker(style, 0), ["picker", "ops0"])
# a hue's row takes the room the area has, from a cell's 46 px up to 12 mm:
# the EU's 234 px keep 46, the US portrait's 394 give 78
check("the picker's rows on the EU", PanelDraw.picker_row(style), 46)
check("the picker's rows on the US portrait", PanelDraw.picker_row({"area": [320, 394], "palette": style["palette"]}), 78)
for hi: 0 .. size(v["pickerHits"]) - 1
    var h = v["pickerHits"][hi]
    check_at("picker hit " + str(h[0]) + "," + str(h[1]), PanelDraw.hit_picker(h[0], h[1], style), ["pickerHits", hi, 2])
end

# a card made around another: drawn cell by cell, and a touch on its hole is the other card's
var shaped = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
shaped.fit_matrix(v["matrix"])
var sid = shaped.add_screen("Shapes")["value"]
shaped.create_zone(sid, "One", [1, 1], [1, 1])
shaped.create_zone(sid, "Ring", [0, 0], [3, 3])
var ring = shaped.find_zone(shaped.find_screen(sid)["cards"][1][0][2 ..])
check_at("the ring's hole is the other card's cell", ring["holes"], ["shaped", "holes"])
var splan = PanelDraw.plan(shaped, sid, view, style, false)
check_list("the plan with the ring", splan, ["shaped", "plan"])
for hi: 0 .. size(v["shaped"]["hits"]) - 1
    var h = v["shaped"]["hits"][hi]
    var card = PanelDraw.hit_card(shaped, sid, h[0], h[1], style)
    check_at("ring hit " + str(h[0]) + "," + str(h[1]), card != nil ? card[0] : nil, ["shaped", "hits", hi, 2])
end
check_at("the dashed card around a card", PanelDraw.ghost(shaped, {"block": [0, 0, 3, 3], "lines": ["3x3"], "holes": [[1, 1]]}, style), ["shaped", "ghost"])

# the production panel: the same Living room, on the same cells
var us = v["us"]
var store_us = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
check("and the US with no turn either", store_us.fit_matrix(us["matrix"])["value"], 0)
var style_us = json.load(json.dump(style))
style_us["area"] = us["area"]
var plan_us = PanelDraw.plan(store_us, "home", view, style_us, false)
check_list("the US plan", plan_us, ["us", "plan"])
for hi: 0 .. size(us["hits"]) - 1
    var h = us["hits"][hi]
    var card = PanelDraw.hit_card(store_us, "home", h[0], h[1], style_us)
    check_at("US hit " + str(h[0]) + "," + str(h[1]), card != nil ? card[0] : nil, ["us", "hits", hi, 2])
end
var sizes_us = []
for b: PanelDraw.chunk_ops(plan_us, nil) sizes_us.push(size(b)) end
check_at("the US plan in the same blocks", sizes_us, ["us", "blocks"])

# The first block goes with the header around it: the title
# just before, home.tTitle0.txt="..." at its 53 characters (75 bytes with the
# terminators), the action's glyph and its two vis (60), and the status icon's
# glyph and vis just after (43). A block leaves them room under 1 000 bytes,
# against the glass's 1 024-byte input buffer.
def check_blocks_leave_header_room(blocks)
    var header = 75 + 60 + 43
    for b: blocks
        var n = 0
        for t: b n += size(t) + 3 end
        check("a block leaves the header room under the glass's buffer", n + header <= 1000, true)
    end
end

var blocks = PanelDraw.chunk_ops(plan, nil)
var sizes = []
for b: blocks sizes.push(size(b)) end
check_at("the plan in the same blocks", sizes, ["blocks"])
check_blocks_leave_header_room(blocks)
check_blocks_leave_header_room(PanelDraw.chunk_ops(plan_us, nil))

# --- a plan streamed a block at a time crosses in the blocks of the whole ---------
# The plan view builds a card only when the line reaches it (next_block), and the
# glass must get exactly what chunk_ops makes of the plan built at once: the same
# blocks, split at the same places, a text that did not fit carried to the next.
# In a function: this script's top level is past 256 constants.
def streamed(parts, limit)
    var s = {"parts": parts, "k": 0, "ops": [], "j": 0, "carry": nil}
    var out = []
    var b = PanelDraw.next_block(s, limit)
    while b != nil
        out.push(b)
        b = PanelDraw.next_block(s, limit)
    end
    return out
end
def stream_checks(store, store_us, view, style, style_us)
    for limit: [nil, 200, 40]
        check("the EU plan streamed is the plan chunked, blocks of " + str(limit),
              streamed(PanelDraw.plan_parts(store, "home", view, style, true), limit),
              PanelDraw.chunk_ops(PanelDraw.plan(store, "home", view, style, true), limit))
        check("and the US one, blocks of " + str(limit),
              streamed(PanelDraw.plan_parts(store_us, "home", view, style_us, true), limit),
              PanelDraw.chunk_ops(PanelDraw.plan(store_us, "home", view, style_us, true), limit))
    end
    check("a plan with nothing streams nothing", streamed([], nil), [])
end
stream_checks(store, store_us, view, style, style_us)

# --- a card with holes, a run a row -----------------------------------------------
# It paints the pixels drawing it cell by cell paints; that drawing is kept here as
# what it is held to.
def cell_by_cell(store, zone, block, style, color)
    var ops = []
    for r: 1 .. block[3]
        for c: 1 .. block[2]
            if !PanelStore.in_zone(zone, PanelText.make_slot(r, c)) continue end
            var inside = def (dc, dr) return PanelStore.in_zone(zone, PanelText.make_slot(r + dr, c + dc)) end
            var b = PanelDraw.cell_rect(store, block[0] + c - 1, block[1] + r - 1, style, inside)
            PanelDraw.round_some(ops, b[0], b[1], b[2], b[3], style["radius"], color, [
                !inside(-1, 0) && !inside(0, -1), !inside(1, 0) && !inside(0, -1),
                !inside(-1, 0) && !inside(0, 1), !inside(1, 0) && !inside(0, 1)])
        end
    end
    return ops
end

# Every pixel a list of instructions paints, x * 1000 + y -> colour: a fill as it
# is, a circle as the pixels within its radius of its centre, and a text by its
# box, which it paints in its background
def painted(ops)
    var px = {}
    for op: ops
        if op[0] == "fill" || op[0] == "xstr"
            var colour = op[0] == "fill" ? op[5] : op[7]
            for y: op[2] .. op[2] + op[4] - 1
                for x: op[1] .. op[1] + op[3] - 1 px[x * 1000 + y] = colour end
            end
        elif op[0] == "cirs"
            var r = op[3]
            for dy: -r .. r
                for dx: -r .. r
                    if dx * dx + dy * dy <= r * r px[(op[1] + dx) * 1000 + op[2] + dy] = op[4] end
                end
            end
        end
    end
    return px
end

def same_pixels(a, b)
    if size(a) != size(b) return false end
    for k: a.keys()
        if b.find(k) != a[k] return false end
    end
    return true
end

def band_checks(store, style)
    var color = style["colors"]["card"]
    var counts = []
    # what, its grid (rows x cols, as a slot) and its holes
    for t: [["a card of 11 x 5 with a hole", 404, [101, 201, 202, 203, 301]],
            ["a ring", 303, [202]],
            ["an L", 202, [102]],
            ["a square short of a corner", 404, [404]],
            ["a card in two pieces", 203, [102, 202]],
            ["a cross", 303, [101, 103, 301, 303]],
            ["a U", 303, [102, 202]],
            ["a staircase", 303, [102, 103, 203]],
            ["a band with a bite out of its edge", 205, [103]],
            ["a tall card with a hole on each side", 503, [201, 403]],
            ["two runs over one", 305, [103, 203]]]
        var zone = {"grid": t[1], "holes": t[2]}
        var block = [1, 0, PanelText.slot_col(t[1]), PanelText.slot_row(t[1])]
        var ops = []
        PanelDraw.shape(ops, store, zone, block, style, color)
        var ref = cell_by_cell(store, zone, block, style, color)
        check(t[0] + ": the pixels it painted cell by cell", same_pixels(painted(ops), painted(ref)), true)
        check(t[0] + ": in no more instructions", size(ops) <= size(ref), true)
        counts.push([size(ops), size(ref)])
    end
    check("that card in 20 instructions, not 28", counts[0], [20, 28])
end
band_checks(store, style)

# --- the dashed card erased: what it painted goes back to the page,
# and nothing of the card in its hole
def erase_checks(store, style)
    var page = style["colors"]["page"]
    for g: [{"block": [0, 0, 3, 3], "lines": ["3x3"], "holes": [[1, 1]]},
            {"block": [2, 1, 4, 3], "lines": ["3x4"], "holes": [[2, 1], [3, 1], [2, 2], [5, 3]]},
            {"block": [4, 2, 2, 2], "lines": ["2x2"], "holes": []}]
        var what = "the dashed card at " + json.dump(g["block"])
        var erased = painted(PanelDraw.ghost_erase(store, g, style))
        var own = {}
        var b = g["block"]
        for r: b[1] .. b[1] + b[3] - 1
            for c: b[0] .. b[0] + b[2] - 1
                var hole = false
                for h: g["holes"]
                    if h[0] == c && h[1] == r hole = true end
                end
                if hole continue end
                var o = PanelDraw.cell_origin(store, c, r, style)
                for y: o[1] .. o[1] + PanelStore.CELL_H - 1
                    for x: o[0] .. o[0] + PanelStore.CELL_W - 1 own[x * 1000 + y] = page end
                end
            end
        end
        check(what + ": its own cells, whole, in the page colour, and nothing else", same_pixels(erased, own), true)
        var missed = 0
        for k: painted(PanelDraw.ghost(store, g, style)).keys()
            if !erased.contains(k) missed += 1 end
        end
        check(what + ": every pixel it painted", missed, 0)
    end
    var whole = PanelDraw.ghost_erase(store, {"block": [4, 2, 2, 2], "holes": []}, style)
    var o = PanelDraw.cell_origin(store, 4, 2, style)
    check("with nothing in its way, one fill", whole, [["fill", o[0], o[1], 2 * PanelStore.CELL_W, 2 * PanelStore.CELL_H, page]])
end
erase_checks(store, style)

# --- the temperatures of a summed-up card -------------------------------------------------
# What the vectors hold the whole card to is here by its rules: who is shown, where the line goes with or without the name, and
# the colour of the floor's number
def temps_checks(style)
    var TH = "0x00124B0000B00001"
    var TH2 = "0x00124B0000B00002"
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(v["matrix"])
    var screen = st.add_screen("Shapes")["value"]
    var big = st.create_zone(screen, "Bedroom", [0, 0], [3, 3])["value"]
    var small = st.create_zone(screen, "Pantry", [4, 0], [2, 3])["value"]
    st.register_device([TH, "Thermostat", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    st.register_device([TH2, "Thermostat 2", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    st.add_to_zone(big, TH)
    st.add_to_zone(small, TH2)
    st.set_display(big, "adaptive")
    st.set_display(small, "adaptive")
    var cards = st.find_screen(screen)["cards"]
    var part_of = def (zid, card)
        return PanelDraw.display_parts(st, st.find_zone(zid), st.card_block(card), style)[0]
    end
    var part = part_of(big, cards[0])
    var live = {"live": {}, "relayOn": [true, true], "temps": {TH: [21, 27], TH2: [18, 30]}}
    var with = def (extra)
        var out = {"live": {}, "relayOn": [true, true], "temps": {TH: [21, 27]}}
        for k: extra.keys() out[k] = extra[k] end
        return out
    end

    # who is shown
    check("a thermostat's room and floor, whole degrees with the sign", PanelDraw.temps_of(st, part, live), ["21°", "27°"])
    check("with no floor, the room's alone", PanelDraw.temps_of(st, part, with({"temps": {TH: [21, nil]}})), ["21°", nil])
    check("below zero, the minus stays", PanelDraw.temps_of(st, part, with({"temps": {TH: [-3, 5]}})), ["-3°", "5°"])
    check("a view with no temperatures, or none of this thermostat's, shows none", [PanelDraw.temps_of(st, part, {"live": {}, "relayOn": [true, true]}),
          PanelDraw.temps_of(st, part, with({"temps": {TH2: [18, 30]}}))], [nil, nil])
    check("a thermostat that has not said its room's shows none, whatever its floor's", PanelDraw.temps_of(st, part, with({"temps": {TH: [nil, 27]}})), nil)
    check("one with no communication shows none", PanelDraw.temps_of(st, part, with({"doubt": {TH: true}})), nil)
    st.find_device(TH)[9] = 2
    check("and one with no power", [PanelDraw.temps_of(st, part, with({"relayOn": [true, false]})), PanelDraw.temps_of(st, part, with({"relayOn": [true, true]}))],
          [nil, ["21°", "27°"]])
    st.find_device(TH)[9] = 0
    var narrow = [[part[0][0], part[0][1], 2, part[0][3]], part[1], true, true, part[4]]
    check("a piece of two columns has no room for the line, one of three has", [PanelDraw.temps_of(st, narrow, live), PanelDraw.temps_of(st, part, live) != nil], [nil, true])
    var middle = nil
    var living_room = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    living_room.fit_matrix(v["matrix"])
    living_room.set_display("middle", "adaptive")
    for c: living_room.doc["screens"][0]["cards"] if c[0] == "z:middle" middle = c end end
    var lamps = PanelDraw.display_parts(living_room, living_room.find_zone("middle"), living_room.card_block(middle), style)[0]
    check("a piece with no thermostat shows none", PanelDraw.temps_of(living_room, lamps, {"live": {}, "relayOn": [true, true], "temps": {"0x00124B0000E00001": [20, 20]}}), nil)

    # what the icons may be with the line: 48 px where the stack fits, 32 where only those do, none where not even those
    var tall = [0, 0, 116, 134]
    var low = [0, 0, 116, 88]
    check("the icons' size with a line: 3 rows named, 2 rows without the name, 2 rows named", [PanelDraw.summary_size(tall, true, 1, true), PanelDraw.summary_size(low, false, 1, true),
          PanelDraw.summary_size(low, true, 1, true)], [48, 48, nil])
    check("and without it, as it was", [PanelDraw.summary_size(tall, true, 1, false), PanelDraw.summary_size(low, true, 1, false), PanelDraw.summary_size(low, false, 1, false)], [48, 48, 48])
    check("three icons are 32 px wide, line or not", [PanelDraw.summary_size(tall, true, 3, true), PanelDraw.summary_size(tall, true, 3, false)], [32, 32])

    # the line, its two numbers each against the middle, and the floor's in the secondary colour: the theme's own, the ghost's, the unlit icon's
    var line = PanelDraw.temps_line(["21°", "27°"], 11, 160, 108, style, 7)
    check("the room's against the middle on its left, the floor's on its right, a gap between", [line[0][1] + line[0][3] + PanelDraw.TEMPS_GAP, line[1][1], line[0][8], line[1][8]],
          [69, 69, PanelDraw.RIGHT, PanelDraw.LEFT])
    check("each as wide as its half, and the pair as wide as the card's inside", [line[0][3], line[1][3], line[1][1] + line[1][3] - line[0][1]], [50, 50, 108])
    check("the room in the label's colour, the floor in the ghost's, the card's behind them", [line[0][6], line[1][6], line[0][7], line[1][7]],
          [style["colors"]["label"], style["colors"]["ghost"], 7, 7])
    var themed = json.load(json.dump(style))
    themed["colors"]["secondary"] = 1234
    check("a theme that names its secondary colour is the one", PanelDraw.temps_line(["21°", "27°"], 11, 160, 108, themed, 7)[1][6], 1234)
    var bare = json.load(json.dump(style))
    bare["colors"].remove("ghost")
    check("and tables with neither have the floor in the unlit icon's", PanelDraw.temps_line(["21°", "27°"], 11, 160, 108, bare, 7)[1][6], style["colors"]["iconOff"])
    var alone = PanelDraw.temps_line(["21°", nil], 11, 160, 108, style, 7)
    check("the room's alone is one text, centred over the whole inside", [size(alone), alone[0][1], alone[0][3], alone[0][8]], [1, 11, 108, PanelDraw.CENTER])

    # a card of 3 rows with the name: the icon, the line and the name have the same room at the top and between them
    var box = PanelDraw.block_box(st, part[0], style)
    var ops = PanelDraw.summary(st, st.find_zone(big), part, live, style, false)
    var name_at = box[1] + box[3] - PanelDraw.PAD - PanelDraw.LABEL_H
    var gap = (name_at - box[1] - 48 - PanelDraw.LABEL_H) / 3
    check("the icon at the first gap, the line a gap under it, the name at the bottom", [size(ops), ops[0][2], ops[1][2], ops[2][2], ops[3][2]],
          [4, box[1] + gap, box[1] + gap + 48 + gap, box[1] + gap + 48 + gap, name_at])
    check("the line between the icon and the name, a gap of at least 4 px on each side of it", [ops[1][2] - (ops[0][2] + 48) >= 4, name_at - (ops[1][2] + PanelDraw.LABEL_H) >= 4], [true, true])

    # a piece with no name: 2 rows, the line under the icon, and nothing at the bottom
    var small_part = part_of(small, cards[1])
    check("a card of two rows is the one that carries the name here", small_part[3], true)
    var nameless = [small_part[0], small_part[1], true, false, small_part[4]]
    var lbox = PanelDraw.block_box(st, nameless[0], style)
    var lops = PanelDraw.summary(st, st.find_zone(small), nameless, live, style, false)
    var lgap = (lbox[3] - 48 - PanelDraw.LABEL_H) / 3
    check("with no name: the icon and the line, each at its gap, and no text under them", [size(lops), lops[0][2], lops[1][2], lops[2][2]],
          [3, lbox[1] + lgap, lbox[1] + lgap + 48 + lgap, lbox[1] + lgap + 48 + lgap])
    check("the line ends inside the card with room to spare", lops[1][2] + PanelDraw.LABEL_H + PanelDraw.PAD <= lbox[1] + lbox[3], true)
    # the same card with the name: the icons would not fit the line, and the card is as it was before it
    var named = PanelDraw.summary(st, st.find_zone(small), small_part, live, style, false)
    var nsz = PanelDraw.summary_size(lbox, true, 1, false)
    check("with the name the line is left out: the icon centred over the name, as any card", [size(named), named[0][2], named[1][11]],
          [2, lbox[1] + (lbox[3] - PanelDraw.PAD - PanelDraw.LABEL_H - nsz) / 2, "Pantry"])
end
temps_checks(style)

# --- the thermostat that heats: the warm tone of its icon, under a command on its way and over the lit one ---------
def heating_checks(style)
    var set = style["glyphs"]["light"]
    var view = {"live": {}, "relayOn": [true, true]}
    var tone = def (state, pending, heating, st) return PanelDraw.looks(set, state, nil, view, st, pending, heating)[1] end
    var c = style["colors"]
    check("a thermostat that heats is the style's warm tone, and one that does not is the lit one", [tone("on", false, true, style), tone("on", false, false, style)], [c["heating"], c["iconOn"]])
    check("and one with nothing said of it is the lit one: the caller's argument is optional", PanelDraw.looks(set, "on", nil, view, style, false)[1], c["iconOn"])
    check("a command on its way is the pending tone over the warm one", tone("on", true, true, style), c["pending"])
    check("no communication, no power and unlit keep their own tones, heating or not",
          [tone("noanswer", false, true, style), tone("nopower", false, true, style), tone("off", false, true, style)], [c["noAnswer"], c["noPower"], c["iconOff"]])
    var old = {"colors": {"iconOff": 1, "iconOn": 2, "pending": 3}}
    check("tables made before the theme named it have the lit tone for it", tone("on", false, true, old), 2)
    var A = "0x00124B0000B00001"
    var B = "0x00124B0000B00002"
    check("a device of the list that heats: heating_in", [PanelDraw.heating_in({"heating": {A: true}}, [B, A]), PanelDraw.heating_in({"heating": {A: true}}, [B]),
          PanelDraw.heating_in({"heating": {}}, [A]), PanelDraw.heating_in({}, [A])], [true, false, false, false])

    # a card's icon: a thermostat that heats is warm, in a group with a lamp that is lit the group is the first lit's, and a lamp's own is not warm
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(v["matrix"])
    var T = "0x00124B0000B00001"
    st.register_device([T, "Thermostat", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    var heat = {"live": {T: "on"}, "relayOn": [true, true], "heating": {T: true}}
    var rest = {"live": {T: "on"}, "relayOn": [true, true]}
    check("a thermostat's own icon is warm while it heats, lit while it rests", [PanelDraw.icon_of(st, T, nil, heat, style, false)[1], PanelDraw.icon_of(st, T, nil, rest, style, false)[1]],
          [c["heating"], c["iconOn"]])
    check("a group of thermostats, one of which heats, is warm", PanelDraw.group_icon(st, [T, "0x00124B0000B00003"], "thermostat", heat, style, false)[1], c["heating"])
    check("a group of them none of which is on is unlit, whatever the view says of heating", PanelDraw.group_icon(st, [T], "thermostat", {"live": {}, "relayOn": [true, true], "heating": {T: true}}, style, false)[1], c["iconOff"])
    var T3 = "0x00124B0000B00003"
    st.register_device([T3, "Thermostat 3", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    check("and the group is warm when any of them heats, though the first that is on only rests", PanelDraw.group_icon(st, [T, T3], "thermostat", {"live": {T: "on", T3: "on"}, "relayOn": [true, true], "heating": {T3: true}}, style, false)[1], c["heating"])
    check("a lamp's group is its own, and heating is none of its", PanelDraw.group_icon(st, ["0x00124B0000E00001"], "light", {"live": {"0x00124B0000E00001": "on"}, "relayOn": [true, true], "heating": {T: true}}, style, false)[1], c["iconOn"])
end
heating_checks(style)

# The blinds: the accent while one moves, green all the way up, the open glyph unlit part of the way; and their
# position on a summed-up card's line, with a thermostat's temperatures when the piece is wide enough
def cover_checks(style)
    var c = style["colors"]
    var set = style["glyphs"]["light"]
    var view = {"live": {}, "relayOn": [true, true]}
    var tone = def (state, t, st) return PanelDraw.looks(set, state, nil, view, st, false, t)[1] end
    check("a blind that moves is the pending tone with no moving colour of the theme's, whatever it shows, but no power and no communication",
          [tone("on", "moving", style), tone("off", "moving", style), tone("noanswer", "moving", style), tone("nopower", "moving", style)],
          [c["pending"], c["pending"], c["noAnswer"], c["noPower"]])
    var themed = json.load(json.dump(style))
    themed["colors"]["moving"] = 4321
    themed["colors"]["open"] = 1234
    check("a theme's own moving and open colours are the ones", [tone("on", "moving", themed), tone("on", "full", themed)], [4321, 1234])
    check("all the way up is the lit tone with no open colour of the theme's, part of the way the unlit one", [tone("on", "full", style), tone("on", "part", style)],
          [c["iconOn"], c["iconOff"]])
    var A = "0x00124B0000C10001"
    var B = "0x00124B0000C10002"
    check("what a blind's look says: moving before all the way up, which is before part of the way",
          [PanelDraw.tone_of("cover", [A, B], {"moving": {B: true}, "covers": {A: 100}}), PanelDraw.tone_of("cover", [A, B], {"covers": {A: 100, B: 40}}),
           PanelDraw.tone_of("cover", [A], {"covers": {A: 40}}), PanelDraw.tone_of("cover", [A], {})], ["moving", "full", "part", "part"])
    check("a thermostat's is whether it heats, and a lamp has none", [PanelDraw.tone_of("thermostat", [A], {"heating": {A: true}}), PanelDraw.tone_of("light", [A], {})],
          [true, nil])

    # the line of a summed-up card
    var TH = "0x00124B0000B00001"
    var TH2 = "0x00124B0000B00002"
    var st = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
    st.fit_matrix(v["matrix"])
    var screen = st.add_screen("Blinds")["value"]
    # a zone is at [column, line], [lines, columns] in size: four columns, and three
    var wide = st.create_zone(screen, "Living room", [0, 0], [3, 4])["value"]
    var three = st.create_zone(screen, "Bedroom", [5, 0], [3, 3])["value"]
    st.register_device([A, "Blind", "cover", 64, 0, 0, "TS0601", 1, 0, 0])
    st.register_device([B, "Blind 2", "cover", 64, 0, 0, "TS0601", 1, 0, 0])
    st.register_device([TH, "Thermostat", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    st.register_device([TH2, "Thermostat 2", "thermostat", 48, 50, 350, "TS0601", 1, 0, 0])
    st.add_to_zone(wide, A)
    st.add_to_zone(wide, TH)
    st.add_to_zone(three, B)
    st.add_to_zone(three, TH2)
    st.set_display(wide, "adaptive")
    st.set_display(three, "adaptive")
    var cards = st.find_screen(screen)["cards"]
    var part_of = def (zid, card) return PanelDraw.display_parts(st, st.find_zone(zid), st.card_block(card), style)[0] end
    var pw = part_of(wide, cards[0])
    var p3 = part_of(three, cards[1])
    var all = {"live": {A: "on", B: "on"}, "relayOn": [true, true], "temps": {TH: [21, 27], TH2: [21, nil]}, "covers": {A: 70, B: 35}}
    check("a blind's position, as the card shows it", PanelDraw.cover_of(st, p3, all), "35%")
    check("four columns: the temperatures and the position on one line", PanelDraw.info_of(st, pw, all), ["both", "21°", "27°", "70%"])
    check("three: the blind's alone, which comes first in the order", PanelDraw.info_of(st, p3, all), ["cover", "35%"])
    check("a blind that said nothing, or does not answer: the temperatures alone",
          [PanelDraw.info_of(st, pw, {"live": {}, "relayOn": [true, true], "temps": {TH: [21, 27]}}),
           PanelDraw.info_of(st, pw, {"live": {}, "relayOn": [true, true], "temps": {TH: [21, 27]}, "covers": {A: 70}, "doubt": {A: true}})],
          [["temps", ["21°", "27°"]], ["temps", ["21°", "27°"]]])
    check("a thermostat that said nothing: the position alone", PanelDraw.info_of(st, pw, {"live": {}, "relayOn": [true, true], "covers": {A: 70}}), ["cover", "70%"])

    var both = PanelDraw.info_line(["both", "21°", "27°", "70%"], 11, 160, 150, style, 7)
    check("the two on one line: three thirds, the floor in the secondary colour", [size(both), both[0][3], both[1][1], both[2][1], both[0][6], both[1][6], both[2][6], both[2][11]],
          [3, 50, 61, 111, c["label"], c["ghost"], c["label"], "70%"])
    var nofloor = PanelDraw.info_line(["both", "21°", nil, "70%"], 11, 160, 150, style, 7)
    check("with no floor, two halves", [size(nofloor), nofloor[0][3], nofloor[1][11]], [2, 75, "70%"])
    var alone = PanelDraw.info_line(["cover", "35%"], 11, 160, 108, style, 7)
    check("the position alone, centred over the whole inside", [size(alone), alone[0][1], alone[0][3], alone[0][8], alone[0][11]], [1, 11, 108, PanelDraw.CENTER, "35%"])
    check("and the temperatures alone, as temps_line draws them", PanelDraw.info_line(["temps", ["21°", "27°"]], 11, 160, 108, style, 7),
          PanelDraw.temps_line(["21°", "27°"], 11, 160, 108, style, 7))
    var ops = PanelDraw.summary(st, st.find_zone(wide), pw, all, style, false)
    var texts = []
    for op: ops
        if op[0] == "xstr"  texts.push(op[11]) end
    end
    check("the card of four columns draws the three numbers between its icons and its name", [texts.find("21°") != nil, texts.find("27°") != nil, texts.find("70%") != nil], [true, true, true])
end
cover_checks(style)

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
