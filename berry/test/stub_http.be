# Tasmota's non-blocking TCP client (tcpclientasync, xdrv_52_3_berry_tcpclientasync.ino)
# as panel_http.be sees it, declared before the file compiles: each client made
# is kept in `tcp_made`, and says what the test sets on it.
#   refuse     connect() fails at once, as an address that does not resolve
#   state      what connected() says: nil connecting, true up, false closed
#   room       how much a write() takes, nil for all of it
#   inbox      what the server sent, for available() and read()
class FakeTcp
    var host, port, refuse, state, room, inbox, sent, closed
    def init() self.state = nil self.inbox = "" self.sent = "" self.closed = false self.refuse = false end
    def connect(host, port)
        self.host = host
        self.port = port
        return !self.refuse
    end
    def connected() return self.closed ? false : self.state end
    def write(s)
        if self.state != true return 0 end
        var n = self.room == nil || self.room > size(s) ? size(s) : self.room
        self.sent += n > 0 ? s[0 .. n - 1] : ""
        return n
    end
    def available() return self.state == true ? size(self.inbox) : 0 end
    def read()
        var d = self.inbox
        self.inbox = ""
        return d
    end
    def close() self.closed = true end
end
var tcp_made = []
var tcp_refuse = false
def tcpclientasync()
    var c = FakeTcp()
    c.refuse = tcp_refuse
    tcp_made.push(c)
    return c
end
