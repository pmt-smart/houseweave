# berry/panel_web.be on the real interpreter, over a real store of the Living room:
# names cleaned to what the glass draws, a posted form applied through the
# store's own operations, and the page it draws.

import json
import string
import webserver

var failures = 0
var checks = 0
def check(name, got, want)
    checks += 1
    if json.dump(got) != json.dump(want)
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

var MIDDLE1 = "0x00124B0000E00001"
var store = PanelStore(json.load(read_text("berry/test/fixtures/living-room.json")))
var redraws = [0]
var web = PanelWeb(store, def () redraws[0] += 1 end)

# --- a name as the glass can draw it -------------------------------------------------
check("quotes and backslashes go", PanelWeb.clean('Lamp "big" \\ one'), "Lamp big  one")
check("so do control characters, and the ends are trimmed", PanelWeb.clean("  Tab\there \n"), "Tabhere")
check("twenty bytes at most", PanelWeb.clean("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnopqrst")
# 19 letters and an "é", two bytes: the cut at 20 falls inside it, and takes it whole
check("never in the middle of a character", PanelWeb.clean("abcdefghijklmnopqrséz"), "abcdefghijklmnopqrs")
check("a character that fits whole stays", PanelWeb.clean("Café lights on stairs"), "Café lights on stai")
check("accents stay: the fonts carry Latin-1", PanelWeb.clean("Façade café"), "Façade café")

# --- a posted form -------------------------------------------------------------------
var n = web.apply_all([
    ["z:middle", "Centre"],
    ["n:" + MIDDLE1, " Pendant 1 "],
    ["n:0x00124B0000E00002", "Middle 2"],
    ["k:relay:1", "switch"],
    ["k:" + MIDDLE1, "plug"],
    ["n:0x00124B0000E00003", "   "],
    ["n:0xNOPE", "Ghost"],
    ["save", ""],
])
check("what changed is counted: a zone, a name, a kind", n, 3)
check("the zone is renamed", store.find_zone("middle")["name"], "Centre")
check("the lamp too, trimmed", store.find_device(MIDDLE1)[1], "Pendant 1")
check("the relay device is a switch now", store.find_device("relay:1")[2], "switch")
check("a lamp with colour cannot be a plug: the store refuses it", store.find_device(MIDDLE1)[2], "light")
check("a name of nothing is refused", store.find_device("0x00124B0000E00003")[1], "Middle 3")
check("and the glass draws again, once", redraws[0], 1)
check("nothing changed is nothing redrawn", web.apply_all([["z:middle", "Centre"]]), 0)
check("so no second redraw", redraws[0], 1)

# --- the page, and its routes ---------------------------------------------------------
web.web_add_handler()
check("GET draws the page and POST saves it, both at /panel", webserver.routes, [["/panel", webserver.HTTP_GET], ["/panel", webserver.HTTP_POST]])
store.rename_device("0x00124B0000E00004", "A<b>")
webserver.args = [["saved", "3"]]
web.page()
var html = webserver.sent.concat("")
check("the page says what the last save changed", string.find(html, "<b>3 changed.</b>") >= 0, true)
check("a zone is a field of its own", string.find(html, "name='z:middle' value='Centre'") >= 0, true)
check("a device has its name and its kinds", string.find(html, "name='n:" + MIDDLE1 + "' value='Pendant 1'") >= 0, true)
check("its kind among the ones what it does allows", string.find(html, "<select name='k:" + MIDDLE1 + "'><option selected>light</option></select>") >= 0, true)
check("names are escaped", string.find(html, "value='A&lt;b&gt;'") >= 0, true)
check("every device is in a zone: no loose ones", string.find(html, "<legend>In no zone</legend>"), -1)
webserver.args = [["n:0x00124B0000E00005", "Corner"], ["save", ""]]
web.post()
check("a POST applies, and goes back to the page with the count", webserver.redirected, "/panel?saved=1")
check("the name took", store.find_device("0x00124B0000E00005")[1], "Corner")
webserver.privileged = false
webserver.sent.clear()
web.page()
check("without the Web UI's password, nothing is drawn", webserver.sent, [])

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
