# panel_plan_view.be -- the plan on the glass: draws it
# in blocks, finds the card a finger touched, and paints it pending until what
# it commanded answers. A device that does not answer in time has no
# communication, the lamp with "?", until something is heard from it, and a
# command is never sent again on its own.
#
# The plan page is compiled with its header and its touch and nothing below
# them (schema 11 of the project): every card is drawn from here, by
# panel_draw.be, out of the configuration panel_store.be keeps. The page says
# when it shows and where a finger went down (the generated runtime turns that
# into plan.show, plan.tap, plan.hold and nav.swipe); brain.be hands those to
# this.
#
# Loaded with load(), after panel_store.be and panel_draw.be. Where a
# card goes is panel_plan.be's, and a command goes out through
# panel_plan_commands.be.
#
# The header's + draws a dashed card: one cell, at the first
# free one. Holding it opens the keyboard for its grid, which is its size, and
# the card keeps its place, its grid cut at the plan's edge; a tap moves it to
# the next place; a tap on the title cancels; the check creates the zone.
#
# A hold on a card opens the zone's own screen, and the check opens the new
# zone's; the Zigbee groups under the zones are the
# store's. A command goes out as the store's plan says, through the transport that is
# handed in, and the devices' reports come back through on_report.

#@ solidify:PanelPlanView
class PanelPlanView
    # The serial line to the glass, 10 bits a byte, and what a block gets on top
    # of the time its bytes take on the wire before the next one follows: the
    # glass's input buffer is 1 024 bytes, and a block is under 1 000. The
    # bench measures what the glass really needs.
    static var BAUD = 115200
    static var BLOCK_SLACK_MS = 20
    # how long a card shows pending while it waits for its devices, and a device
    # waits for the report of a command before it has no communication. The
    # bench sees the report in 410 to 625 ms, and once in a while in 2,0 s
    static var PENDING_MS = 2000
    # A card drawn again at every report of every device of its zone would be a burst of the whole card a lamp: twelve lamps answering
    # one tap would make twelve redraws, and the glass's queue would have no end. The first redraw of a moment goes at once, and the
    # reports that come in the REDRAW_MS after it make one, at the end of it, of what the card is by then; and with more than
    # REDRAW_QUEUE blocks waiting for the wire nothing is added to them, the card waits
    static var REDRAW_MS = 150
    static var REDRAW_QUEUE = 6

    var store       # PanelStore
    var style       # what the plan is drawn with: the generated runtime's plan_style
    var send        # f(instruction): one native Nextion instruction to the glass
    var execute     # f(plan, intent): carries a command plan out
    var set_title   # f(title), or nil: the header's title
    var set_action  # f(role), or nil: the header's action icon, "add" or "confirm"
    var editing     # Editing is on: off, the + is not drawn and does nothing
    var ping        # f(ids), or nil: the devices a command did not reach in time
    var relay_moved # f(n), or nil: a relay moved, for the views on show (panel_ui.be, refresh_relay)
    var screen      # the id of the store's screen on show
    var shown       # the plan page is on the glass
    var live        # device id -> "on" or "off", as last reported
    var relay_on    # the panel's two relays
    var pending     # card ref -> [intent, the tap's stamp]: the card's pending tone
    var unconfirmed # device id -> [intent, the command's stamp]: not confirmed yet
    # Device id -> true: no communication. Its last command went
    # unconfirmed in time, Z2T said it cannot reach it, or the transport's mode
    # cannot, and nothing was heard from it since: no report, no answer to its
    # ping. It draws as the lamp with "?"; live keeps what it last said, which an
    # answered ping shows again. A tap tries it, as a device neither on nor off.
    var doubt
    var changed     # f(ids), or nil: devices whose look changed with no report, for the views on show
    var colors      # device id -> RGB565 of the colour a lamp says, which its icon lit shows
    var temps       # thermostat id -> [room, floor] in whole degrees, nil for a floor with no probe: what a summed-up card shows
    var heating     # thermostat id -> true: the ones that heat now, whose icon is the warm tone
    var moving      # blind id -> true: the ones that move now, whose icon is the accent
    var covers      # blind id -> its position, 0 closed to 100 open: green at the top, and what a summed-up card shows
    var cover_cycle # f(ids), or nil: a tap on a zone of blinds only, or its button, runs their cycle
    var stamp       # counts commands, so a late timer knows its command was replaced
    var queue       # blocks of instructions still to go, and streams of them (pump)
    var busy        # a block is on the wire
    var dirty       # card ref -> true: cards whose look changed while the redraw before was recent, to be drawn once, by redraw_dirty
    var dirty_armed # a redraw went lately, and the timer that ends its moment is on its way
    # The dashed card, or nil: {"block": [col, row, cols, rows], "name": ...},
    # and "refusal" when the last grid typed did not fit.
    var ghost
    # The card the check just made, "z:<id>", for the brain to open its zone's
    # screen; nil once taken
    var made
    # The colour picker a zone's options opened, or nil: {"zone": id, "chosen": value}.
    # The views hold the way back; this only draws and hit-tests it.
    var picker
    # Another view drawn where the cards go, or nil: the house's calendar (panel_schedule_view.be). It says its title,
    # its header's action and what it draws (title, action, ops), and the brain gives it its touches
    var canvas
    # What is drawn over the cards when they are: a closure of the style that gives instructions (the alarm's stripe), or nil
    var overlay

    def init(store, style, send, execute, set_title, set_action)
        self.store = store
        self.style = style
        self.send = send
        self.execute = execute
        self.set_title = set_title
        self.set_action = set_action
        self.editing = true
        self.screen = store.doc["screens"][0]["id"]
        self.shown = false
        self.live = {}
        self.relay_on = [true, true]
        self.pending = {}
        self.unconfirmed = {}
        self.doubt = {}
        self.colors = {}
        self.temps = {}
        self.heating = {}
        self.moving = {}
        self.covers = {}
        self.stamp = 0
        self.queue = []
        self.busy = false
        self.dirty = {}
        self.dirty_armed = false
        self.ghost = nil
        self.made = nil
        self.picker = nil
    end

    # The matrix a style's card area holds: whole cells, 11 x 5 on the EU and
    # 8 x 8 on the US.
    static def matrix_of(style)
        return [style["area"][0] / PanelStore.CELL_W, style["area"][1] / PanelStore.CELL_H]
    end

    # a map's keys, as a list: keys() is an iterator, and a map may not lose one while it runs
    static def keys_of(m)
        var out = []
        for k: m.keys() out.push(k) end
        return out
    end

    # the refs painted pending
    def pending_refs()
        return PanelPlanView.keys_of(self.pending)
    end

    def view()
        return {"live": self.live, "relayOn": self.relay_on, "pending": self.pending_refs(), "doubt": self.doubt, "colors": self.colors,
                "temps": self.temps, "heating": self.heating, "moving": self.moving, "covers": self.covers}
    end

    # A thermostat began to heat, or stopped (panel_thermostat.be): its zone's card, if on show, is drawn again with its icon in the
    # warm tone or out of it
    def on_heating(id, on)
        if self.heating.contains(id) == on return end
        if on
            self.heating[id] = true
        else
            self.heating.remove(id)
        end
        self.redraw_zone_of(id)
    end

    # A blind began to move, or stopped (panel_cover.be): its zone's card, if on show, is drawn again with its icon in the accent
    # or out of it
    def on_moving(id, on)
        if self.moving.contains(id) == on return end
        if on
            self.moving[id] = true
        else
            self.moving.remove(id)
        end
        self.redraw_zone_of(id)
    end

    # Where a blind says it is, 0 closed to 100 open, or nil when it says nothing: its zone's card, if on show, is drawn again
    # when that changes
    def on_cover(id, pos)
        if self.covers.find(id) == pos return end
        if pos == nil
            self.covers.remove(id)
        else
            self.covers[id] = pos
        end
        self.redraw_zone_of(id)
    end

    # What a thermostat says of its temperatures, [room, floor] in whole degrees, or nil when it says none (panel_thermostat.be). Its
    # zone's card, if on show, is drawn again when that changes: a tenth of a degree that rounds to the same is not a change
    def on_temps(id, pair)
        var had = self.temps.find(id)
        if pair == nil
            if had == nil return end
            self.temps.remove(id)
        else
            if had != nil && had[0] == pair[0] && had[1] == pair[1] return end
            self.temps[id] = pair
        end
        self.redraw_zone_of(id)
    end

    # The colour a lamp said, RGB565, or nil for a white: its icon lit shows it,
    # and a card on show with it lit is
    # drawn again when it changes
    def on_color(id, c)
        var had = self.colors.find(id)
        if had == c return end
        if c == nil
            self.colors.remove(id)
        else
            self.colors[id] = c
        end
        if !self.shown || self.live.find(id) != "on" return end
        for card: self.current()["cards"]
            if self.card_has(card[0], [id]) self.redraw_later(card[0]) end
        end
    end

    def current()
        return self.store.find_screen(self.screen)
    end

    # --- what the glass is told ------------------------------------------------------

    # The whole plan. `fresh` when the page has just come back from its load, as
    # it was compiled, with nothing below the header (plan.show): the card area
    # is clean and is not cleared first, and what was still queued for the page
    # before it is dropped. Otherwise the area is cleared, and the plan drawn
    # over what the page shows.
    def on_show(fresh)
        self.shown = true
        if fresh self.queue = [] end
        # the colour picker a zone's options opened: drawn where the cards go
        if self.picker != nil
            if self.set_title != nil self.set_title("Color") end
            if self.set_action != nil self.set_action("") end
            self.draw(PanelDraw.picker(self.style, self.picker["chosen"]))
            return
        end
        if self.canvas != nil
            if self.set_title != nil self.set_title(self.canvas.title()) end
            if self.set_action != nil self.set_action(self.canvas.action()) end
            self.draw(self.canvas.ops(self.style))
            return
        end
        var sc = self.current()
        if sc == nil
            self.screen = self.store.doc["screens"][0]["id"]
            sc = self.current()
        end
        if self.set_title != nil self.set_title(self.ghost != nil ? self.ghost["name"] : sc["title"]) end
        if self.set_action != nil self.set_action(self.ghost != nil ? "confirm" : self.editing ? "add" : "") end
        var parts = nil
        if size(sc["cards"]) == 0 && self.ghost == nil
            var ops = fresh ? [] : [["fill", self.style["origin"][0], self.style["origin"][1],
                                     self.style["area"][0], self.style["area"][1], self.style["colors"]["page"]]]
            for op: PanelDraw.empty(self.style, nil) ops.push(op) end
            parts = [/ -> ops]
        else
            # a card is built when the line reaches it, not all of them first
            parts = PanelDraw.plan_parts(self.store, self.screen, self.view(), self.style, !fresh)
        end
        if self.ghost != nil
            var g = self.ghost_drawn()
            var store = self.store
            var style = self.style
            parts.push(/ -> PanelDraw.ghost(store, g, style))
        end
        self.queue.push({"parts": parts, "k": 0, "ops": [], "j": 0, "carry": nil})
        self.pump()
        if self.overlay != nil
            var over = self.overlay(self.style)
            if size(over) > 0  self.draw(over) end
        end
    end

    # Another page is on the glass: a drawing instruction draws on whatever page
    # is up, so nothing more may go until the plan shows again.
    def hide()
        self.shown = false
        self.queue = []
        self.dirty = {}
        # the picker belongs to the page it was drawn on, and so does a canvas
        self.picker = nil
        self.canvas = nil
    end

    # the value under a touch on the picker, or nil
    def picker_at(n)
        return PanelDraw.hit_picker(n / 1000, n % 1000, self.style)
    end

    def draw(ops)
        for b: PanelDraw.chunk_ops(ops, nil) self.queue.push(b) end
        self.pump()
    end

    # One block now and the next when its bytes have had time to cross the line.
    # The queue holds blocks, and the streams of a whole plan, whose next block is
    # made only now (PanelDraw.next_block).
    def pump()
        if self.busy || size(self.queue) == 0 return end
        if !self.shown
            self.queue = []
            return
        end
        var block = nil
        while block == nil && size(self.queue) > 0
            var head = self.queue[0]
            if isinstance(head, map)
                block = PanelDraw.next_block(head, nil)
                if block == nil self.queue.remove(0) end
            else
                block = head
                self.queue.remove(0)
            end
        end
        if block == nil return end
        var nbytes = 0
        for t: block
            self.send(t)
            nbytes += size(t) + 3
        end
        self.busy = true
        tasmota.set_timer(nbytes * 10000 / PanelPlanView.BAUD + PanelPlanView.BLOCK_SLACK_MS, / -> self.sent())
    end

    def sent()
        self.busy = false
        self.pump()
    end

    def redraw_card(card)
        if self.cards_shown() self.draw(PanelDraw.card_icons(self.store, card, self.view(), self.style)) end
    end

    # A card to be drawn again because a device of its zone said something: at once when no redraw went in the
    # REDRAW_MS before and the wire is not behind, and otherwise once, when that moment ends, with what the card is by then. What the
    # tap itself paints (on_tap, lapse) is not held: it is one, and the finger is waiting for it
    def redraw_later(ref)
        if self.dirty_armed || size(self.queue) > PanelPlanView.REDRAW_QUEUE
            self.dirty[ref] = true
            self.arm_redraw()
            return
        end
        self.arm_redraw()
        for c: self.current()["cards"]
            if c[0] == ref self.redraw_card(c) end
        end
    end

    def arm_redraw()
        if self.dirty_armed return end
        self.dirty_armed = true
        tasmota.set_timer(PanelPlanView.REDRAW_MS, / -> self.redraw_dirty())
    end

    # the moment ended: the cards that changed in it are drawn, once, unless the wire is still behind. A draw begins another moment, so
    # a burst that goes on is a draw every REDRAW_MS and no more
    def redraw_dirty()
        self.dirty_armed = false
        var refs = self.dirty
        if size(refs) == 0 return end
        if size(self.queue) > PanelPlanView.REDRAW_QUEUE
            self.arm_redraw()
            return
        end
        self.dirty = {}
        self.arm_redraw()
        for c: self.current()["cards"]
            if refs.contains(c[0]) self.redraw_card(c) end
        end
    end

    # the cards are on the glass: the plan is, and no picker or canvas is over them
    def cards_shown()
        return self.shown && self.picker == nil && self.canvas == nil
    end

    # The icons of every card on show, after something that changes many (a relay).
    def redraw_icons()
        if !self.cards_shown() return end
        var ops = []
        for c: self.current()["cards"]
            for op: PanelDraw.card_icons(self.store, c, self.view(), self.style) ops.push(op) end
        end
        self.draw(ops)
    end

    # --- touches -------------------------------------------------------------------------

    # The card under a point the glass reported as x * 1000 + y, or nil.
    def card_at(n)
        return PanelDraw.hit_card(self.store, self.screen, n / 1000, n % 1000, self.style)
    end

    # A tap toggles the card's zone. Returns the intent sent, or nil when the
    # touch did nothing -- nothing under it, or nothing there with power.
    # A lamp with no communication counts as neither on nor
    # off, and the tap tries it.
    def on_tap(n)
        if self.ghost != nil
            # with a dashed card up, a touch is its: on it, it moves on; on a
            # free cell around it, it goes there
            if self.in_ghost(n)
                self.cycle_ghost()
            else
                var cell = PanelDraw.hit_cell(self.store, n / 1000, n % 1000, self.style)
                if cell != nil self.move_ghost(cell) end
            end
            return nil
        end
        var card = self.card_at(n)
        if card == nil return nil end
        var ref = PanelStore.parse_ref(card[0])
        var zone = ref != nil ? self.store.find_zone(ref[1]) : nil
        if zone == nil return nil end
        # A card that still waits for its lamps takes the tap too, and the command
        # not confirmed yet counts as done: the tap turns back what it asked.
        # A card that waits for its relay alone, which moves in a moment,
        # ignores the tap until it confirms or the time is up.
        if self.relay_wait(card[0], zone)
            log("PLAN: " + card[0] + " still waits for its relay: the tap is ignored", 3)
            return nil
        end
        # what the zone's Tap reaches: the zone, for Auto and All, or its group or its device
        var parts = [self.store.tap_part(zone)]
        # a zone of blinds only, or a Tap of blinds: the tap is their cycle, all of them together
        if self.blinds(parts) return "cycle" end
        var cmd = self.store.plan(parts, self.relay_on, nil)
        # which way the tap goes, and what waits for it: the thermostats are turned off with a zone that goes off
        var tap = self.store.tap_intent(parts, cmd, self.live, self.relay_on, self.doubt, self.unconfirmed)
        if tap == nil return nil end
        var intent = tap[0]
        self.execute(cmd, intent)
        var stamp = self.wait(tap[1], intent, [card[0]])
        self.redraw_card(card)
        self.arm(stamp)
        return intent
    end

    # A long press says which card it was on; the caller opens what the card is: the zone's screen, or the page of its
    # one device or of its one group (PanelUi.hold_card)
    def on_hold(n)
        # a hold on the dashed card asks for its grid: the caller opens the keyboard
        if self.ghost != nil return self.in_ghost(n) ? "ghost" : nil end
        var card = self.card_at(n)
        if card == nil return nil end
        log("PLAN: hold on " + card[0], 3)
        return card[0]
    end

    # Left and right go round the plans, the carousel: left to
    # the next, right to the previous.
    def on_swipe(direction)
        # only left and right are the carousel: up and down are the runtime's, which opens Wireless and Main settings with them
        if direction != "left" && direction != "right" return false end
        var screens = self.store.doc["screens"]
        if size(screens) < 2 return false end
        var i = 0
        while i < size(screens) && screens[i]["id"] != self.screen i += 1 end
        var n = size(screens)
        var j = direction == "left" ? (i + 1) % n : (i + n - 1) % n
        self.screen = screens[j]["id"]
        self.pending = {}
        # a dashed card belongs to the plan it was drawn on
        self.ghost = nil
        if self.shown self.on_show() end
        return true
    end

    # --- the dashed card ---------------------------------------------------

    def blocks()
        return self.store.screen_blocks(self.current(), nil)
    end

    # Back from a view, on this screen: the page's own load draws it (plan.show).
    def show_screen(id)
        if id == self.screen return end
        self.screen = id
        self.pending = {}
        self.ghost = nil
    end

    # the header's action: + draws a dashed card, and the check confirms it
    def on_action()
        if self.ghost == nil && !self.editing return false end
        if self.ghost == nil return self.start_ghost() end
        return self.confirm_ghost()
    end

    # One cell, at the first free one, named after the next zone. Nothing when
    # the plan is full.
    def start_ghost()
        var at = PanelPlan.ghost_start(self.blocks(), self.store.matrix())
        if at == nil
            log("PLAN: the plan is full", 2)
            return false
        end
        self.ghost = {"block": at, "name": "Card " + str(size(self.store.doc["zones"]) + 1)}
        if self.shown self.on_show() end
        return true
    end

    # the cell a touch landed on is the dashed card's: inside it, and not a hole
    def in_ghost(n)
        var cell = PanelDraw.hit_cell(self.store, n / 1000, n % 1000, self.style)
        if cell == nil return false end
        var b = self.ghost["block"]
        if cell[0] < b[0] || cell[0] >= b[0] + b[2] || cell[1] < b[1] || cell[1] >= b[1] + b[3] return false end
        for h: self.ghost_holes()
            if h[0] == cell[0] && h[1] == cell[1] return false end
        end
        return true
    end

    # the cells of the dashed card other cards hold, [col, row] on the plan:
    # the zone's holes when it is made
    def ghost_holes()
        var b = self.ghost["block"]
        var h = PanelPlan.holes_at(self.blocks(), self.store.matrix(), b[0], b[1], b[2], b[3])
        var out = []
        if isinstance(h, list)
            for x: h out.push([b[0] + x[0], b[1] + x[1]]) end
        end
        return out
    end

    # The dashed card as it is drawn and erased: where it is, what it says, and
    # the cells in it that other cards hold
    def ghost_drawn()
        return {"block": self.ghost["block"], "lines": self.ghost_lines(), "holes": self.ghost_holes()}
    end

    # The dashed card moved, or says something else: its old cells go back to
    # the page and it is drawn again, and nothing else. The
    # cards around it stay as they were; redrawing the plan for it sent two to
    # five times the bytes.
    def redraw_ghost(was)
        if !self.shown return end
        var ops = PanelDraw.ghost_erase(self.store, was, self.style)
        for op: PanelDraw.ghost(self.store, self.ghost_drawn(), self.style) ops.push(op) end
        self.draw(ops)
    end

    # A tap on a free cell around it: the dashed card goes there, its corner on
    # that cell. A cell another card holds does nothing; a place where its shape
    # would be in pieces says there is no room
    def move_ghost(cell)
        var blocks = self.blocks()
        if PanelPlan.held_by(blocks, cell) return false end
        var was = self.ghost_drawn()
        var b = self.ghost["block"]
        var to = PanelPlan.ghost_to(blocks, self.store.matrix(), cell, b[2], b[3])
        if to == nil
            self.ghost["refusal"] = "no room"
        else
            self.ghost["block"] = to
            if self.ghost.contains("refusal") self.ghost.remove("refusal") end
        end
        self.redraw_ghost(was)
        return to != nil
    end

    # the next place, in reading order, where the dashed card fits; with none,
    # it stays, and nothing is drawn
    def cycle_ghost()
        var b = self.ghost["block"]
        var next = PanelPlan.next_place_for(self.blocks(), self.store.matrix(), b[2], b[3], b[0], b[1])
        if next == nil return end
        var was = self.ghost_drawn()
        self.ghost["block"] = [next[0], next[1], b[2], b[3]]
        self.redraw_ghost(was)
    end

    # its grid, as the keyboard starts it: "2x3"
    def ghost_grid()
        var b = self.ghost["block"]
        return PanelText.format_size([b[3], b[2]])
    end

    # A grid typed is a size typed: the card keeps its place, the grid cut at
    # the plan's edge, around the cards it meets there. nil when
    # it took it; otherwise why not, and the card says so.
    def set_grid(text)
        if self.ghost == nil return "no_ghost" end
        var grid = PanelText.parse_size(text)
        if grid == nil
            self.ghost["refusal"] = "grid"
            return "grid"
        end
        var to = PanelPlan.ghost_resized(self.blocks(), self.store.matrix(), self.ghost["block"], grid[1], grid[0])
        if to == nil
            self.ghost["refusal"] = "no room"
            return "no_room"
        end
        self.ghost["block"] = to
        if self.ghost.contains("refusal") self.ghost.remove("refusal") end
        return nil
    end

    # What the dashed card says: its grid, or why the last grid
    # typed was refused
    def ghost_lines()
        var refusal = self.ghost.find("refusal")
        return [refusal != nil ? refusal : self.ghost_grid()]
    end

    def rename_ghost(name)
        if self.ghost != nil self.ghost["name"] = name end
    end

    # the title tapped: the creation is off
    def cancel_ghost()
        if self.ghost == nil return false end
        self.ghost = nil
        if self.shown self.on_show() end
        return true
    end

    # The check: the zone is made where the dashed card is, and kept; its card is
    # the one the brain opens next (made)
    def confirm_ghost()
        var b = self.ghost["block"]
        var r = self.store.create_zone(self.screen, self.ghost["name"], [b[0], b[1]], [b[3], b[2]])
        if !r["ok"]
            log("PLAN: the zone was refused - " + str(r["refusal"]), 2)
            return false
        end
        self.store.save()
        self.ghost = nil
        self.made = "z:" + r["value"]
        if self.shown self.on_show() end
        return true
    end

    # --- what comes back -----------------------------------------------------------------

    # A device said what it is now, even late: it has communication again, shows
    # what it said, and a command that asked for this is confirmed.
    # Another state confirms nothing: what Z2T kept of a lamp, which
    # ZbInfo hands over again when the link comes up, is the state from before
    # the command. "noanswer" is Z2T saying it cannot reach the device, or the
    # transport's mode that cannot (panel_zigbee.be): no communication, with what
    # it last said kept. Its zone's card, if on show, follows.
    def on_report(id, state)
        if state == "noanswer"
            if self.doubt.find(id) != "gated" self.doubt[id] = true end
        else
            self.live[id] = state
            # what the gate holds (panel_gate.be) is lifted by the gate, not by a report
            if self.doubt.contains(id) && self.doubt[id] != "gated" self.doubt.remove(id) end
            var w = self.unconfirmed.find(id)
            if w != nil && w[0] == state self.unconfirmed.remove(id) end
        end
        self.redraw_zone_of(id)
    end

    # The card of a device's zone, if on show, settled and drawn again
    def redraw_zone_of(id)
        if !self.shown return end
        var zone = self.store.zone_of(id)
        if zone == nil return end
        for c: self.current()["cards"]
            if c[0] == "z:" + zone["id"]
                self.settle(c[0])
                self.redraw_later(c[0])
            end
        end
    end

    # A device answered its ping (panel_zigbee.be, ZbPing): it is there, and the
    # command it did not confirm most likely never reached it, the zone's
    # broadcast having no acknowledgement, where a report comes back with one.
    # It shows what it last said again. Returns whether it had no
    # communication.
    def on_answered(id)
        if !self.doubt.contains(id) || self.doubt[id] == "gated" return false end
        self.doubt.remove(id)
        self.redraw_zone_of(id)
        return true
    end

    # A relay of the panel moved: every card with a device it switches or feeds follows.
    def on_relay(n, on)
        if self.relay_on[n - 1] == on return end
        self.relay_on[n - 1] = on
        # Power back to the lamps it feeds: each is as its StartUpOnOff says.
        # One that took Off is off, one set to On is on, one set to come back
        # as it was is as it was, which is what the plan kept; any
        # other is in no known state until it reports. Kept as it was, a lamp that
        # was on stayed "on", and the card's first tap sent off to lamps already off.
        if on
            for d: self.store.relay_devices(n)
                if PanelStore.is_relay_id(d[0]) continue end
                var startup = size(d) > 8 ? d[8] : 0
                if startup == 1 || startup == 3
                    self.live[d[0]] = startup == 1 ? "off" : "on"
                elif startup != 4 && self.live.contains(d[0])
                    self.live.remove(d[0])
                end
            end
        end
        # the lamps it feeds wait for nothing and lose their "?": cut, they have
        # no power; back, they are what their announce says
        for d: self.store.relay_devices(n)
            if self.doubt.contains(d[0]) self.doubt.remove(d[0]) end
            if self.unconfirmed.contains(d[0]) self.unconfirmed.remove(d[0]) end
        end
        # settle() takes a card out of the map, so not while iterating it
        for ref: self.pending_refs() self.settle(ref) end
        self.redraw_icons()
        # no report follows a relay: a zone's screen on show is told here
        if self.relay_moved != nil  self.relay_moved(n) end
    end

    # A card that waits for what it asked, and for no lamp: for its relay, which
    # settles it as it moves, in a moment
    def relay_wait(ref, zone)
        if !self.pending.contains(ref) return false end
        for id: zone["members"].keys()
            if self.unconfirmed.contains(id) return false end
        end
        return true
    end

    # A pending card is done when every target it commanded that has power shows
    # what was asked.
    def settle(ref)
        var p = self.pending.find(ref)
        if p == nil return end
        var parsed = PanelStore.parse_ref(ref)
        var zone = parsed != nil ? self.store.find_zone(parsed[1]) : nil
        var states = zone != nil ? self.store.target_states([zone], self.live, self.relay_on, self.doubt) : []
        for s: states
            if s != "nopower" && s != p[0] return end
        end
        self.pending.remove(ref)
    end

    # A tap on an unlinked button: the zones marked with it, as
    # one target, by the button's group; every card of them waits for what was
    # asked, as a tap on it would.
    def on_button(n)
        var zones = []
        for z: self.store.doc["zones"]
            if z["buttons"].find(n) != nil zones.push(z) end
        end
        if size(zones) == 0 return nil end
        # zones that still wait for their lamps take the press too, as a tap on
        # their card does: the command not confirmed yet counts as done
        # One that waits for a relay alone ignores it, as its card does
        for z: zones
            if self.relay_wait("z:" + z["id"], z)
                log("PLAN: button " + str(n) + "'s zones still wait for a relay: the press is ignored", 3)
                return nil
            end
        end
        # each zone as its Tap says, as a tap on its card
        var parts = self.store.button_parts(n)
        # the zones of blinds only: the press is their cycle, as a tap on their card is
        if self.blinds(parts) return "cycle" end
        var cmd = self.store.button_plan(n, self.relay_on)
        var tap = self.store.tap_intent(parts, cmd, self.live, self.relay_on, self.doubt, self.unconfirmed)
        if tap == nil return nil end
        var intent = tap[0]
        self.execute(cmd, intent)
        var refs = []
        for z: zones refs.push("z:" + z["id"]) end
        var stamp = self.wait(tap[1], intent, refs)
        if self.shown
            for c: self.current()["cards"]
                if self.pending.contains(c[0]) self.redraw_card(c) end
            end
        end
        self.arm(stamp)
        return intent
    end

    # Zones that have blinds and nothing else a tap reaches run the blinds' cycle, with the panel's cover model: true when
    # they did
    def blinds(zones)
        var ids = self.store.blinds_only(zones)
        if ids == nil || self.cover_cycle == nil return false end
        self.cover_cycle(ids)
        return true
    end

    # A command went out to these devices: each waits for a report of what was
    # asked, and the cards in `refs` show the pending tone, until the time is up
    # (arm, lapse). A device that already shows it waits for nothing, but one
    # still waiting for the command before waits for this one, which turned
    # that back: the command before's time, when it is up, finds it waiting for
    # another. Returns the command's stamp.
    def wait(ids, intent, refs)
        self.stamp += 1
        var stamp = self.stamp
        for id: ids
            if self.live.find(id) != intent || self.unconfirmed.contains(id) self.unconfirmed[id] = [intent, stamp] end
        end
        for ref: refs self.pending[ref] = [intent, stamp] end
        return stamp
    end

    # the time a command's devices have to confirm it, from now
    def arm(stamp)
        tasmota.set_timer(PanelPlanView.PENDING_MS, / -> self.lapse(stamp))
    end

    # A command from the views (brain.be): a zone's screen, its counters. Its
    # devices wait as a card's do, and the views draw them sending.
    def expect(ids, intent)
        if size(ids) == 0 return end
        self.arm(self.wait(ids, intent, []))
        if self.changed != nil  self.changed(ids) end
    end

    # the card of a zone holds one of these devices
    def card_has(ref, ids)
        if size(ids) == 0 return false end
        var parsed = PanelStore.parse_ref(ref)
        var zone = parsed != nil ? self.store.find_zone(parsed[1]) : nil
        if zone == nil return false end
        for id: ids
            if zone["members"].contains(id) return true end
        end
        return false
    end

    # A command's time is up: its cards stop waiting, and a
    # device with power that did not show what was asked has no communication,
    # and is pinged. The ones that answer show what they last said
    # (on_answered); the others keep their "?". Nothing is sent again.
    def lapse(stamp)
        var late = []
        for id: PanelPlanView.keys_of(self.unconfirmed)
            var w = self.unconfirmed[id]
            if w[1] != stamp continue end
            self.unconfirmed.remove(id)
            if !self.store.unpowered(id, self.relay_on) && self.live.find(id) != w[0]
                if self.doubt.find(id) != "gated" self.doubt[id] = true end
                late.push(id)
            end
        end
        var refs = []
        for ref: self.pending_refs()
            if self.pending[ref][1] == stamp
                self.pending.remove(ref)
                refs.push(ref)
            end
        end
        if size(late) > 0
            if self.ping != nil  self.ping(late) end
            if self.changed != nil  self.changed(late) end
        end
        if !self.shown return end
        for c: self.current()["cards"]
            if refs.find(c[0]) != nil || self.card_has(c[0], late) self.redraw_card(c) end
        end
    end
end
