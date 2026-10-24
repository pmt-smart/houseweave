# Tasmota's `webserver` module, as a file the standalone interpreter can
# import: what a page sends is kept in `sent`, the request's arguments are the
# list `args` a test fills, and the routes and the redirect are recorded.
# Only what berry/panel_web.be calls, the way Tasmota names it
# (lib/libesp32/berry_tasmota/src/be_webserver_lib.c).
var m = module("webserver")
m.HTTP_GET = 1
m.HTTP_POST = 3
m.BUTTON_MAIN = 0
m.sent = []
m.args = []
m.routes = []
m.redirected = nil
m.privileged = true
m.check_privileged_access = def () return m.privileged end
m.content_start = def (title) m.sent.push("<start " + title + ">") end
m.content_send_style = def () end
m.content_send = def (s) m.sent.push(s) end
m.content_button = def (b) end
m.content_stop = def () m.sent.push("<stop>") end
m.html_escape = def (s)
    import string
    s = string.replace(s, "&", "&amp;")
    s = string.replace(s, "<", "&lt;")
    s = string.replace(s, ">", "&gt;")
    s = string.replace(s, "'", "&#39;")
    return string.replace(s, "\"", "&quot;")
end
m.has_arg = def (name)
    for a: m.args if a[0] == name return true end end
    return false
end
m.arg = def (x)
    if type(x) == "int" return m.args[x][1] end
    for a: m.args if a[0] == x return a[1] end end
    return nil
end
m.arg_name = def (i) return m.args[i][0] end
m.arg_size = def () return size(m.args) end
m.on = def (path, f, method) m.routes.push([path, method]) end
m.redirect = def (url) m.redirected = url end
# a whole answer of its own (a route that answers JSON): the last one kept
m.responded = nil
m.content_response = def (s) m.responded = s end
return m
