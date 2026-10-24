# webserver.be -- Tasmota's webserver module (be_webserver_lib.c), for the
# pages the panel adds to the Web UI (berry/panel_web.be). A handler registered
# with on() is served by the page on request (sim_web), with the request's
# arguments, and what it sends is gathered and handed back.
import string

var webserver = module("webserver")
webserver.HTTP_GET = 1
webserver.HTTP_POST = 2
webserver.HTTP_ANY = 3
webserver.BUTTON_MAIN = 0
webserver.BUTTON_CONFIGURATION = 1
webserver.BUTTON_INFORMATION = 2
webserver.BUTTON_MANAGEMENT = 3
webserver.BUTTON_MODULE = 4

webserver._handlers = []    # [uri, f, method]
webserver._args = []        # the request's [name, value], in order
webserver._out = []
webserver._redirect = nil

webserver.on = def (uri, f, method)
    webserver._handlers.push([uri, f, method != nil ? method : webserver.HTTP_ANY])
end
webserver.content_send = def (s) webserver._out.push(str(s)) end
# a whole answer of its own, the page's text alone (a route that answers JSON: the house's server's, house_server.be, server_link.be)
webserver.content_response = def (s) webserver._out.push(str(s)) end
webserver.content_send_style = def () end
webserver.content_start = def (title) webserver._out.push("<!-- start " + str(title) + " -->") end
webserver.content_stop = def () end
webserver.content_button = def (b) end
webserver.redirect = def (uri) webserver._redirect = str(uri) end
webserver.check_privileged_access = def () return true end
webserver.arg_size = def () return size(webserver._args) end
webserver.arg_name = def (i) return webserver._args[i][0] end
webserver.has_arg = def (name)
    for a: webserver._args if a[0] == name return true end end
    return false
end
webserver.arg = def (key)
    if type(key) == "int" return webserver._args[key][1] end
    for a: webserver._args if a[0] == key return a[1] end end
    return nil
end
webserver.html_escape = def (s)
    s = string.replace(str(s), "&", "&amp;")
    s = string.replace(s, "<", "&lt;")
    s = string.replace(s, ">", "&gt;")
    s = string.replace(s, "\"", "&quot;")
    return string.replace(s, "'", "&#39;")
end

# the page's request: {"uri", "method" (1 GET, 2 POST), "args": [[name, value]]}
webserver._serve = def (req)
    import json
    webserver._args = req.find("args", [])
    webserver._out = []
    webserver._redirect = nil
    var method = req.find("method", webserver.HTTP_GET)
    for h: webserver._handlers
        if h[0] == req["uri"] && (h[2] == webserver.HTTP_ANY || h[2] == method)
            h[1]()
            return json.dump({"body": webserver._out.concat(), "redirect": webserver._redirect})
        end
    end
    return json.dump({"status": 404})
end
return webserver
