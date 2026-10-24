# berry/panel_http.be, the backup's HTTP, against a TCP client the test drives
# (stub_http.be): the request as it goes, in pieces when the socket takes
# pieces, the answer read as it comes and whole at its length, and each way
# a request fails.

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

tasmota.wifi_up = true
var http = PanelHttp()
var answers = []
def got(code, body) answers.push([code, body]) end

# --- a PUT, sent whole, and its answer ------------------------------------------------------------
check("nothing under way", http.busy(), false)
check("a request taken", http.request("PUT", "192.168.2.10", 8080, "/backup/living-room.json", "{\"v\":1}", got), true)
var c = tcp_made[-1]
check("to the server's address and port", [c.host, c.port], ["192.168.2.10", 8080])
check("and a second waits for the first", http.request("GET", "192.168.2.10", 8080, "/x", nil, got), false)
http.every_50ms()
check("nothing sent while it connects", c.sent, "")
c.state = true
http.every_50ms()
check("the request, HTTP/1.0, with its length and type",
      c.sent, "PUT /backup/living-room.json HTTP/1.0\r\nHost: 192.168.2.10\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: 7\r\n\r\n{\"v\":1}")
c.inbox = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n"
http.every_50ms()
check("the answer, whole at its length", answers, [[204, ""]])
check("the connection closed, and the next one can go", [c.closed, http.busy()], [true, false])

# --- a GET, the request in pieces and the answer in pieces -------------------------------------------
answers.clear()
http.request("GET", "192.168.2.10", 80, "/backup/living-room.json", nil, got)
c = tcp_made[-1]
c.state = true
c.room = 10
http.every_50ms()
check("the socket takes ten bytes: ten go", c.sent, "GET /backu")
c.room = nil
http.every_50ms()
check("and the rest at the next turn, with no body", c.sent, "GET /backup/living-room.json HTTP/1.0\r\nHost: 192.168.2.10\r\nConnection: close\r\n\r\n")
c.inbox = "HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nCONTENT-LENGTH: 11\r\n\r\n{\"a\":"
http.every_50ms()
check("half the body: more to come", [answers, http.busy()], [[], true])
c.inbox = "12345}"
http.every_50ms()
check("the body whole, the header in any case", answers, [[200, "{\"a\":12345}"]])

# --- a header beside Host --------------------------------------------------------------------------
answers.clear()
http.request("PUT", "192.168.2.10", 8080, "/backup/living-room.json", "{}", got, {"Authorization": "Bearer 0123"})
c = tcp_made[-1]
c.state = true
http.every_50ms()
check("the key's header, with the rest",
      c.sent, "PUT /backup/living-room.json HTTP/1.0\r\nHost: 192.168.2.10\r\nConnection: close\r\nAuthorization: Bearer 0123\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}")
c.inbox = "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n"
http.every_50ms()

# --- the ways it fails -----------------------------------------------------------------------------
answers.clear()
tcp_refuse = true
http.request("GET", "house.local", 80, "/x", nil, got)
http.every_50ms()
check("an address that does not open: No answer", answers, [[0, "No answer"]])
tcp_refuse = false
answers.clear()
http.request("GET", "192.168.2.10", 80, "/x", nil, got)
c = tcp_made[-1]
c.state = false
http.every_50ms()
check("refused: No answer", answers, [[0, "No answer"]])
answers.clear()
http.request("GET", "192.168.2.10", 80, "/x", nil, got)
c = tcp_made[-1]
tasmota.at_ms = PanelHttp.TIMEOUT_MS - 1
http.every_50ms()
check("still connecting before its time", answers, [])
tasmota.at_ms = PanelHttp.TIMEOUT_MS
http.every_50ms()
check("and at its time, No answer", [answers, c.closed], [[[0, "No answer"]], true])
tasmota.at_ms = nil
answers.clear()
http.request("GET", "192.168.2.10", 80, "/x", nil, got)
c = tcp_made[-1]
c.state = true
http.every_50ms()
c.inbox = "HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\nshort"
http.every_50ms()
c.state = false
http.every_50ms()
check("closed before its length: Cut short", answers, [[0, "Cut short"]])
answers.clear()
http.request("GET", "192.168.2.10", 80, "/x", nil, got)
c = tcp_made[-1]
c.state = true
http.every_50ms()
c.inbox = "HTTP/1.1 200 OK\r\n\r\nno length, the close ends it"
http.every_50ms()
check("no length: more may come", answers, [])
c.state = false
http.every_50ms()
check("and the close ends it", answers, [[200, "no length, the close ends it"]])
answers.clear()
http.request("GET", "192.168.2.10", 80, "/x", nil, got)
c = tcp_made[-1]
c.state = true
http.every_50ms()
var big = "HTTP/1.1 200 OK\r\n\r\n"
while size(big) < PanelHttp.MAX + 3000  big += "0123456789012345678901234567890123456789" end
c.inbox = big
http.every_50ms()
check("an answer past the most the panel reads: refused", answers, [[0, "Too large"]])
answers.clear()
http.request("GET", "192.168.2.10", 80, "/x", nil, got)
c = tcp_made[-1]
c.state = true
http.every_50ms()
c.inbox = "HTTP/1.1 404 Not Found\r\nContent-Length: 10\r\n\r\nnot found\n"
http.every_50ms()
check("an error is an answer, with its code", answers, [[404, "not found\n"]])

# --- no network: no connection, and the request fails at the next poll --------------------------------
tasmota.wifi_up = false
answers = []
var made = size(tcp_made)
check("without the network a request is taken", http.request("GET", "192.168.2.10", 8080, "/x", nil, got), true)
http.every_50ms()
check("and fails at the next poll, with no connection made", [answers, size(tcp_made), http.busy()], [[[0, "No network"]], made, false])
tasmota.wifi_up = true

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
