# panel_http.be -- one HTTP/1.0 request at a time, over Tasmota's non-blocking
# TCP client (tcpclientasync), for the panel's backup (panel_backup.be). The
# webclient would block the loop until the server answers, and with it the
# glass, the relays and the bridge's link, for as long as a slow server takes.
#
# The request goes in pieces as the socket takes them, and the answer is read as
# it comes. It is whole at its Content-Length, or when the server closes. An
# answer longer than MAX is refused, as is one that does not come in
# TIMEOUT_MS. HTTP/1.0 asks for no chunked answer, and a redirect is an answer
# like any other.
#
# A name for a host is looked up by Tasmota as the connection opens, which
# waits for the DNS: an address does not.
#
# No connection is made without the network: before the Wi-Fi is up there is no
# TCP/IP stack to make one on, and the socket's call reads a null pointer and
# resets the device (a bridge that knew its server at boot did, three times in a
# row, until Tasmota's boot loop protection left Berry off). The request then
# fails at the next poll, "No network".

#@ solidify:PanelHttp
class PanelHttp : Driver
    static TIMEOUT_MS = 10000
    static MAX = 32000

    var client      # the connection of the request under way, or nil
    var out         # what is left to send of it
    var got         # what came back so far
    var done        # done(code, body): code 0, and the reason, for a failure
    var deadline    # when the request gives up
    var offline     # the request found no network: it fails at the next poll

    def init()
        tasmota.add_driver(self)
    end

    def busy() return self.done != nil end

    # `method` to `path` on host:port, with `body` (nil for none) as JSON and
    # `headers` (a map, or nil) beside Host; false, and nothing sent, while
    # another request is under way
    def request(method, host, port, path, body, done, headers)
        if self.done != nil return false end
        self.done = done
        self.got = ""
        self.deadline = tasmota.millis(PanelHttp.TIMEOUT_MS)
        var head = method + " " + path + " HTTP/1.0\r\nHost: " + host + "\r\nConnection: close\r\n"
        if headers != nil
            for k: headers.keys()  head += k + ": " + str(headers[k]) + "\r\n" end
        end
        if body != nil  head += "Content-Type: application/json\r\nContent-Length: " + str(size(body)) + "\r\n" end
        self.out = head + "\r\n" + (body != nil ? body : "")
        self.offline = !tasmota.wifi().find("up", false)
        if self.offline
            self.client = nil
            return true
        end
        self.client = tcpclientasync()
        # refused at once: the next poll says so
        if !self.client.connect(host, port)  self.client = nil end
        return true
    end

    def every_50ms()
        if self.done == nil return end
        var c = self.client
        if c == nil
            self.finish(0, self.offline ? "No network" : "No answer")
            return
        end
        var up = c.connected()
        if up == true && size(self.out) > 0
            var n = c.write(self.out)
            if n > 0  self.out = n < size(self.out) ? self.out[n ..] : "" end
        end
        # what the server sent before it closed is still read
        if up != nil && c.available() > 0  self.got += c.read() end
        if size(self.got) > PanelHttp.MAX + 2048
            self.finish(0, "Too large")
            return
        end
        var r = PanelHttp.answer(self.got, up == false)
        if r != nil
            self.finish(r[0], r[1])
        elif up == false || tasmota.time_reached(self.deadline)
            self.finish(0, "No answer")
        end
    end

    # The answer in `got`, once whole: [code, body], or nil while more is to come.
    # Closed, what came is all there is, and an answer cut short is a failure
    static def answer(got, closed)
        import string
        var i = string.find(got, "\r\n\r\n")
        if i < 0 return closed && size(got) > 0 ? [0, "Cut short"] : nil end
        var head = string.tolower(got[0 .. i - 1])
        var body = i + 4 < size(got) ? got[i + 4 ..] : ""
        var code = 0
        if string.find(head, "http/1.") == 0 && size(head) >= 12  code = int(head[9 .. 11]) end
        var at = string.find(head, "\r\ncontent-length:")
        if at < 0 return closed ? [code, body] : nil end
        var rest = head[at + 17 ..]
        var e = string.find(rest, "\r\n")
        if e >= 0  rest = e > 0 ? rest[0 .. e - 1] : "" end
        var n = int(string.tr(rest, " \t", ""))
        if size(body) < n return closed ? [0, "Cut short"] : nil end
        return [code, n > 0 ? body[0 .. n - 1] : ""]
    end

    def finish(code, body)
        var done = self.done
        if self.client != nil  self.client.close() end
        self.client = nil
        self.done = nil
        self.out = nil
        self.got = nil
        done(code, body)
    end
end
