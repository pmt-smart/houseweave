# house_link.be -- a node comes into the house over the link of the pairing: the welcome (the number, the key and the list, in pieces) carried
# by the events of the pairing's own link, which is signed, sealed and between the two devices only.
#
# One way (each side says in its hello whether it is in a house, "house": 1 for a node that has no key and can take a welcome, 2 for one that is in a house; none for an image
# that has no mesh driver, which does nothing of this): a panel that is in the house and writes gives the node at the other end, a bridge or a panel that is not in one, the
# welcome, and the node is added to the list (Add to this house). Nothing else is done: a node that is in a house is given no other, and only a panel of
# the house adds a node.
#
# The events, over the link, all `{"ZbPair": <kind>, ...}`:
#   houseAsk                  the giver: "who are you for the house?"
#   houseId  pub, mac         the taker: its public key (64 hex) and its radio address (12 hex), from the mesh driver; or houseNo, why "in" (it is in a house) or "none" (it cannot take one)
#   housePiece  d             a piece of the welcome as hex ([index, how many, data], 90 bytes at most: an event holds 233), one at a time, again every RESEND_MS until it is answered
#   houseAck  i               the piece i is in
#   houseDone | houseNo, why  the whole welcome was taken, or was not (a welcome that is not whole, or was not made as it is, is refused by HouseMesh.accept and nothing changes)
# The giver holds the pieces in RAM and the taker the ones it has had, for as long as the pairing lasts. What gets to the list is the panel's own: the node is written when its identity
# has come, and stays in the list when the welcome does not get through (the same key is the same number the next time; a struck off one is not taken again).
#
# One HouseMesh has one (host.link). The class that owns the link (zigbee_pairing.be on a panel, zbbridge_relay_pairing.be on a bridge) binds it to the way it says an event, and to what is
# to be done when it ends. It is called with `tick()` from the host's every 100 ms while it has something to do.

#@ solidify:HouseLink
class HouseLink
    # the data of a piece of the pairing's link: the piece is 2 bytes more, and as hex fits an event of 233 bytes with what it says around it
    static PIECE = 88
    static ASK_MS = 2000
    static ASK_TRIES = 8
    static RESEND_MS = 1000
    static TRIES = 8
    # how long a node that waits for the other side's word, and the whole of a welcome, may take
    static HOLD_MS = 45000
    static WHOLE_MS = 90000

    var host        # the HouseMesh
    var say         # f(msg) -> bool: an event over the pairing's link, or nil when there is none
    var on_end      # f(ok, why): this side's part is over, or nil
    var role        # nil, "give" (a panel adds the node at the other end) or "wait" (the node that is brought in)
    var step        # what the glass says: nil, "asking", "giving", "taking", "done" or "no"
    var why         # why it ended in "no": silent, refused, in, none, struck, full, nokey
    var kind        # the role of the node that comes in (HouseList.ROLE_...)
    var due         # millis of the next step
    var tries       # the steps done of this one
    var out         # the pieces being carried, in order
    var at          # the one the link is on
    var got         # the pieces taken, by place
    var of          # how many there are of them, or 0
    var fin         # a node that was given a welcome: "done" or "no", said again to a piece that comes again
    var name        # the name it is written with
    var ip          # its address, 4 bytes, or nil
    var until       # millis this gives up

    def init(host)
        self.host = host
        self.say = nil
        self.on_end = nil
        self.reset()
    end

    def reset()
        self.role = nil
        self.step = nil
        self.why = ""
        self.kind = 0
        self.due = 0
        self.tries = 0
        self.out = []
        self.at = 0
        self.got = {}
        self.of = 0
        self.fin = nil
        self.name = ""
        self.ip = nil
        self.until = 0
    end

    def bind(say, on_end)
        self.say = say
        self.on_end = on_end
        self.reset()
    end

    def unbind()
        self.say = nil
        self.on_end = nil
        self.reset()
    end

    def bound() return self.say != nil end

    def busy() return self.role != nil end

    # what this node says of itself in its hello: 0 it has no mesh driver, 1 it has no key and can take a welcome, 2 it is in a house
    def flag()
        var s = HouseKey.status()
        if s == nil return 0 end
        return s[0] == 0 ? 1 : 2
    end

    def tell(msg)
        if self.say == nil return false end
        return self.say(msg)
    end

    # "192.168.0.61" as the 4 bytes the list keeps, or nil
    static def ip_bytes(text)
        import string
        var parts = string.split(str(text), ".")
        if size(parts) != 4 return nil end
        var b = bytes()
        for p: parts
            var n = int(p)
            if n < 0 || n > 255 return nil end
            b.add(n, 1)
        end
        return b
    end

    static def named(text)
        import string
        var s = str(text)
        # Tasmota's own host name (tasmota-4A7E21-5212) is no name anyone gave the node: it has none, and the screens call it by its role (HouseList.label)
        if string.find(s, "tasmota-") == 0 return "" end
        return size(s) > HouseList.MAX_NAME ? s[0 .. HouseList.MAX_NAME - 1] : s
    end

    # --- the ways in -------------------------------------------------------------------------------------------------

    # a panel of the house that writes adds the node at the other end of the link, a bridge or a panel (`kind`, HouseList.ROLE_...): `ip` is its address as
    # it says it. False when it cannot
    def give(kind, name, ip)
        if self.role != nil || self.say == nil || !self.host.writes() return false end
        self.reset()
        self.role = "give"
        self.kind = kind
        self.name = HouseLink.named(name)
        self.ip = HouseLink.ip_bytes(ip)
        self.begin()
        return true
    end

    def begin()
        self.step = "asking"
        self.until = tasmota.millis(HouseLink.WHOLE_MS)
        self.ask()
    end

    def ask()
        self.tell({"ZbPair": "houseAsk"})
        self.tries += 1
        self.due = tasmota.millis(HouseLink.ASK_MS)
    end

    # --- every 100 ms ---------------------------------------------------------------------------------------------------

    def tick()
        if self.role == nil return end
        var now = tasmota.millis()
        if now >= self.until return self.finish(false, "silent") end
        if now < self.due return end
        if self.step == "asking"
            if self.tries >= HouseLink.ASK_TRIES return self.finish(false, "silent") end
            self.ask()
        elif self.step == "giving"
            self.push()
        end
    end

    # the piece the link is on, again at its time; it gives up after TRIES
    def push()
        if self.at >= size(self.out) return end
        self.tries += 1
        if self.tries > HouseLink.TRIES return self.finish(false, "silent") end
        self.tell({"ZbPair": "housePiece", "d": self.out[self.at].tohex()})
        self.due = tasmota.millis(HouseLink.RESEND_MS)
    end

    # --- what comes over the link ---------------------------------------------------------------------------------------

    def event(kind, m)
        if kind == "houseAsk" return self.on_ask() end
        if kind == "housePiece" return self.on_piece(m) end
        if kind == "houseId" return self.on_id(m) end
        if kind == "houseAck" return self.on_ack(m) end
        if kind == "houseDone"
            if self.step == "giving" self.finish(true, "") end
            return
        end
        if kind == "houseNo" && (self.step == "asking" || self.step == "giving" || self.role == "wait")
            self.finish(false, str(m.find("why", "refused")))
        end
    end

    # the other side asks who this node is: its identity, when it can take a welcome
    def on_ask()
        if self.say == nil return end
        var f = self.flag()
        if f != 1 return self.tell({"ZbPair": "houseNo", "why": f == 2 ? "in" : "none"}) end
        import global
        var who = global.HouseMesh.identity()
        if who == nil return self.tell({"ZbPair": "houseNo", "why": "none"}) end
        # a welcome that was refused before is asked for again: it starts from nothing
        self.fin = nil
        self.got = {}
        self.of = 0
        if self.role == nil self.role = "wait" end
        self.step = "taking"
        self.until = tasmota.millis(HouseLink.HOLD_MS)
        self.tell({"ZbPair": "houseId", "pub": who[0].tohex(), "mac": who[1].tohex()})
    end

    # a piece of the welcome: kept, answered, and when it is the last the node takes it. A piece that comes again after the welcome was taken is answered as it was
    def on_piece(m)
        if self.say == nil return end
        if self.fin != nil
            return self.tell(self.fin == "done" ? {"ZbPair": "houseDone"} : {"ZbPair": "houseNo", "why": "refused"})
        end
        var p = bytes(str(m.find("d", "")))
        if size(p) < 3 || p[1] < 1 || p[0] >= p[1] return end
        if self.of != p[1]
            self.got = {}
            self.of = p[1]
        end
        self.got[p[0]] = p
        self.until = tasmota.millis(HouseLink.HOLD_MS)
        self.tell({"ZbPair": "houseAck", "i": p[0]})
        if size(self.got) < self.of return end
        var all = []
        for i: 0 .. self.of - 1 all.push(self.got[i]) end
        self.got = {}
        self.of = 0
        var ok = self.host.accept(all)
        self.fin = ok ? "done" : "no"
        self.tell(ok ? {"ZbPair": "houseDone"} : {"ZbPair": "houseNo", "why": "refused"})
        self.role = nil
        self.finish(ok, ok ? "" : "refused")
    end

    # who the other node is, as it says: the giver writes it into the list
    def on_id(m)
        if self.step != "asking" || self.role != "give" return end
        var pub = bytes(str(m.find("pub", "")))
        var mac = bytes(str(m.find("mac", "")))
        if size(pub) != 32 || size(mac) != 6 return self.finish(false, "refused") end
        self.take_in(pub, mac)
    end

    # the panel writes the node into the list (the number it already has when the same key was written before), and carries its welcome
    def take_in(pub, mac)
        var h = self.host
        var id = h.list.find_key(pub)
        if id == 0
            id = h.add_node(self.kind, pub, mac, self.ip, self.name != "" ? self.name : nil, nil)
            if id < 1 return self.finish(false, "full") end
        end
        var pieces = h.welcome(id, HouseLink.PIECE)
        if pieces == nil return self.finish(false, "nokey") end
        self.carry(pieces)
    end

    def carry(pieces)
        self.out = pieces
        self.at = 0
        self.tries = 0
        self.step = "giving"
        self.until = tasmota.millis(HouseLink.WHOLE_MS)
        self.push()
    end

    def on_ack(m)
        if self.step != "giving" return end
        var i = int(m.find("i", -1))
        if i != self.at return end
        self.tries = 0
        if self.at < size(self.out) - 1
            self.at += 1
            self.push()
        else
            # the last is in: the word that it was taken is the next, and the piece goes again if it is lost
            self.due = tasmota.millis(HouseLink.RESEND_MS)
        end
    end

    # --- the end ----------------------------------------------------------------------------------------------------------

    def finish(ok, why)
        self.step = ok ? "done" : "no"
        self.why = why
        self.role = nil
        self.out = []
        self.got = {}
        self.of = 0
        if self.on_end != nil
            try
                self.on_end(ok, why)
            except .. as e, msg
                log("HOUSE: the end of a welcome failed (" + str(e) + ": " + str(msg) + ")", 1)
            end
        end
        return ok
    end
end
