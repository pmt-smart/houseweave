# house_devices.be -- the devices of one bridge, for a panel of another room to pick from: the "Existing device" of the +.
#
# A panel asks a bridge for a page of its devices (LIST, to one node: where to start), and the bridge answers with one frame an item (ITEM, to that node: the place, how many
# there are, and the device as the panel needs it to classify and name it): the IEEE, the model, the endpoints' Config as Z2T says it, and the name the owner has for it (the one the
# panels gave it, for Home Assistant). The panel keeps ONE page, the one on the glass (PAGE items, a few hundred bytes), and nothing of the rest: it asks again for the next, as the
# +'s list pages ("a page at a time, without keeping the rest": the heap).
#
# The bridge keeps what Z2T told of its devices (heard: what the relay forwards of a ZbInfo), and a bridge that has nothing, or nothing in FRESH_MS, asks Z2T for the map (ZbInfo,
# ask_info) and answers SETTLE_MS later, when the reports of it have come. The list is in the order of the IEEEs.
#
# It is one of HouseMesh's parts (house_mesh.be), as HouseState is: it sends over the host, which keeps what the driver did not take.

#@ solidify:HouseDevices
class HouseDevices
    static MSG_LIST = 0x33
    static MSG_ITEM = 0x34
    static WIRE = 1
    static PAGE = 5
    static FRESH_MS = 60000
    static SETTLE_MS = 3000
    static ASK_GAP_MS = 10000
    static RETRY_MS = 4000
    static TRIES = 3
    static END = 255

    var host         # the HouseMesh
    var cache        # the bridge's: IEEE -> [model, config, name]
    var fresh_at     # the bridge's: millis the cache was last given a device, or 0
    var asked_at     # the bridge's: millis Z2T was last asked for the map, or 0
    var waiting      # the bridge's: panel -> the place it asked for, to be answered when the map has come
    var ask_info     # the bridge's: a closure () -> nothing, which asks Z2T for the map
    var name_of      # the bridge's: a closure (ieee) -> the name the panels gave the device, or nil
    var page         # the panel's: the page asked for: {"owner", "from", "total", "items": {index: [ieee, model, config, name]}, "tries", "at"}, or nil
    var on_page      # the panel's: a closure () -> nothing, told when an item of the page has come

    def init(host)
        self.host = host
        self.cache = {}
        self.fresh_at = 0
        self.asked_at = 0
        self.waiting = {}
    end

    # the house's numbers, m (number -> true; house_mesh.be, sweep()): a panel that is no more is not answered, and the page of a bridge that is no more is not waited for
    def sweep(m)
        var drop = []
        for k: self.waiting.keys()
            if !m.contains(k)  drop.push(k) end
        end
        for k: drop  self.waiting.remove(k) end
        if self.page != nil && !m.contains(self.page.find("owner"))  self.page = nil end
    end

    # --- the bridge ---------------------------------------------------------------------------------------------------

    # what Z2T said of a device (the relay's ZbInfo): its IEEE, its model and its Config
    def heard(d)
        if !isinstance(d, map) || type(d.find("IEEEAddr")) != "string" return end
        # a device whose interview never read its address (all zeros) is no device to pick: what a failed join leaves in Z2T
        if d["IEEEAddr"] == "0x0000000000000000" return end
        var config = d.find("Config")
        self.cache[d["IEEEAddr"]] = [str(d.find("ModelId", "")), isinstance(config, list) ? config : [], ""]
        self.fresh_at = tasmota.millis()
    end

    # the devices a panel asks for, from a place: now when the map is fresh, and when it has come if it was asked for
    def take_list(src, d)
        if size(d) < 3 || d[1] != HouseDevices.WIRE || !self.host.list.is_panel(src) return end
        var now = tasmota.millis()
        if size(self.cache) > 0 && now - self.fresh_at < HouseDevices.FRESH_MS
            self.answer(src, d[2])
            return
        end
        self.waiting[src] = d[2]
        if now - self.asked_at >= HouseDevices.ASK_GAP_MS || self.asked_at == 0
            self.asked_at = now
            if self.ask_info != nil self.ask_info() end
        end
    end

    # a list of texts in order (insertion: the lists are the devices of one bridge)
    static def in_order(l)
        var i = 1
        while i < size(l)
            var x = l[i]
            var j = i - 1
            while j >= 0 && l[j] > x
                l[j + 1] = l[j]
                j -= 1
            end
            l[j + 1] = x
            i += 1
        end
        return l
    end

    def answer(src, first)
        var ieees = []
        for k: self.cache.keys() ieees.push(k) end
        var sorted = HouseDevices.in_order(ieees)
        var total = size(sorted)
        if first >= total
            self.item(src, HouseDevices.END, total, {})
            return
        end
        var at = first
        while at < total && at < first + HouseDevices.PAGE
            var e = self.cache[sorted[at]]
            var name = self.name_of != nil ? self.name_of(sorted[at]) : nil
            self.item(src, at, total, {"i": sorted[at], "m": e[0], "c": e[1], "n": name != nil ? name : ""})
            at += 1
        end
    end

    def item(dest, index, total, body)
        import json
        var b = bytes()
        b.add(HouseDevices.MSG_ITEM, 1)
        b.add(HouseDevices.WIRE, 1)
        b.add(index, 1)
        b.add(total > 254 ? 254 : total, 1)
        b .. bytes().fromstring(json.dump(body))
        self.host.send(dest, b, nil)
    end

    # --- the panel ----------------------------------------------------------------------------------------------------

    # a page of a bridge's devices, from a place
    def ask(owner, first)
        self.page = {"owner": owner, "from": first, "total": nil, "items": {}, "tries": 1, "at": tasmota.millis()}
        self.send_ask()
    end

    def send_ask()
        var b = bytes()
        b.add(HouseDevices.MSG_LIST, 1)
        b.add(HouseDevices.WIRE, 1)
        b.add(self.page["from"], 1)
        self.host.send(self.page["owner"], b, nil)
    end

    # the devices of the page, in order, as the view draws them; the place of the first, and how many the bridge has
    def current()
        var p = self.page
        if p == nil return nil end
        var out = []
        for i: p["from"] .. p["from"] + HouseDevices.PAGE - 1
            if p["items"].contains(i) out.push(p["items"][i]) end
        end
        return [out, p["from"], p["total"]]
    end

    # whether the page has come whole, or what it is to hold
    def whole()
        var p = self.page
        if p == nil || p["total"] == nil return false end
        var want = p["total"] - p["from"]
        if want > HouseDevices.PAGE want = HouseDevices.PAGE end
        if want < 0 want = 0 end
        return size(p["items"]) >= want
    end

    # an item of a page, from the bridge it was asked of
    def take_item(src, d)
        var p = self.page
        if p == nil || p["owner"] != src || size(d) < 5 || d[1] != HouseDevices.WIRE return end
        var from = self.host.list.node(src)
        if from == nil || from["role"] != HouseList.ROLE_BRIDGE return end
        p["total"] = d[3]
        if d[2] != HouseDevices.END
            import json
            var m = json.load(d[4 ..].asstring())
            if isinstance(m, map) && type(m.find("i")) == "string"
                p["items"][d[2]] = [m["i"], str(m.find("m", "")), isinstance(m.find("c"), list) ? m["c"] : [], str(m.find("n", ""))]
            end
        end
        if self.on_page != nil self.on_page() end
    end

    # --- the clock of every second -----------------------------------------------------------------------------------------

    def tick()
        var now = tasmota.millis()
        # a bridge that was asked for the map answers when it has had time to say it
        if size(self.waiting) > 0 && now - self.asked_at >= HouseDevices.SETTLE_MS
            for src: self.waiting.keys()
                self.answer(src, self.waiting[src])
            end
            self.waiting = {}
        end
        # a page that did not come is asked for again, a few times
        var p = self.page
        if p != nil && !self.whole() && now - p["at"] >= HouseDevices.RETRY_MS && p["tries"] < HouseDevices.TRIES
            p["tries"] += 1
            p["at"] = now
            self.send_ask()
        end
    end

    # --- the frames the host hands over -------------------------------------------------------------------------------------

    def on_frame(src, d)
        if d[0] == HouseDevices.MSG_LIST
            self.take_list(src, d)
        elif d[0] == HouseDevices.MSG_ITEM
            self.take_item(src, d)
        end
    end
end
