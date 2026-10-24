# panel_web.be -- the rooms in the Tasmota Web UI.
#
# The batch work the glass is slow at: naming thirty lamps is quicker on a real
# keyboard. A page of the Web UI, over the same store the glass edits and
# through the store's own operations, so a name or a kind the glass would
# refuse is refused here too -- one set of rules, reached two ways. What the
# glass shows follows: the page tells brain, which draws again whatever is on
# show.
#
# Tasmota's own pattern, as its Extension Manager does it
# (lib/libesp32/berry_tasmota/src/embedded/extension_manager.be): a Driver
# answers `web_add_main_button` with a button and `web_add_handler` with the
# routes, the page is a form, and its POST redirects back to it. The Web UI's
# own password is what guards it (`check_privileged_access`).
#
# Loaded with load(), after panel_store.be.

#@ solidify:PanelWeb
class PanelWeb : Driver
    # what the glass's keyboard lets a name be, in bytes: the slot's own buffer
    static var NAME_MAX = 20

    var store
    var changed   # f(): the configuration changed, and the glass draws again

    def init(store, changed)
        self.store = store
        self.changed = changed
    end

    def web_add_main_button()
        import webserver
        webserver.content_send("<p></p><form action='panel' method='get'><button>Panel rooms</button></form>")
    end

    def web_add_handler()
        import webserver
        webserver.on("/panel", / -> self.page(), webserver.HTTP_GET)
        webserver.on("/panel", / -> self.post(), webserver.HTTP_POST)
    end

    # A name as the glass can draw it: no double quote or backslash, which
    # would end or bend a Nextion string, no control character, and at most
    # NAME_MAX bytes, cut where a character starts.
    static def clean(text)
        import string
        var out = ""
        for i: 0 .. size(text) - 1
            var c = string.byte(text[i])
            if c < 32 || c == 34 || c == 92 || c == 127 continue end
            out += text[i]
        end
        # trimmed both ends, the way the glass's keyboard is
        while size(out) > 0 && out[0] == " " out = out[1 ..] end
        while size(out) > 0 && out[size(out) - 1] == " " out = out[0 .. size(out) - 2] end
        if size(out) > PanelWeb.NAME_MAX
            var cut = PanelWeb.NAME_MAX
            # not in the middle of a UTF-8 character: its continuation bytes are 10xxxxxx
            while cut > 0 && (string.byte(out[cut]) & 0xC0) == 0x80 cut -= 1 end
            out = out[0 .. cut - 1]
        end
        return out
    end

    # One field of the form, "z:<zone>", "n:<device>" or "k:<device>": true
    # when it changed the configuration.
    def apply(key, value)
        if size(key) < 3 || key[1] != ":" return false end
        var what = key[0]
        var id = key[2 ..]
        if what == "z"
            var zone = self.store.find_zone(id)
            var name = PanelWeb.clean(value)
            if zone == nil || name == zone["name"] return false end
            return self.store.rename_zone(id, name)["ok"]
        end
        var device = self.store.find_device(id)
        if device == nil return false end
        if what == "n"
            var name = PanelWeb.clean(value)
            if name == device[1] return false end
            return self.store.rename_device(id, name)["ok"]
        end
        if what == "k"
            if value == device[2] return false end
            return self.store.set_kind(id, value)["ok"]
        end
        return false
    end

    # every field of a posted form; how many changed something
    def apply_all(fields)
        var n = 0
        for f: fields
            if self.apply(f[0], f[1]) n += 1 end
        end
        if n > 0
            self.store.save()
            if self.changed != nil self.changed() end
        end
        return n
    end

    # a device's row: its name, and its kind among the ones what it does allows
    def device_row(d)
        import webserver
        var id = webserver.html_escape(d[0])
        var row = "<tr><td><input name='n:" + id + "' value='" + webserver.html_escape(d[1]) +
                  "' maxlength='" + str(PanelWeb.NAME_MAX) + "'></td><td><select name='k:" + id + "'>"
        for k: PanelStore.kinds_for(d)
            row += "<option" + (k == d[2] ? " selected" : "") + ">" + k + "</option>"
        end
        return row + "</select></td><td><small>" + id + "</small></td></tr>"
    end

    def page()
        import webserver
        if !webserver.check_privileged_access() return nil end
        webserver.content_start("Panel rooms")
        webserver.content_send_style()
        webserver.content_send("<div style='text-align:center;'><h3><hr>Panel rooms<hr></h3></div>")
        if webserver.has_arg("saved")
            webserver.content_send("<p><b>" + webserver.html_escape(webserver.arg("saved")) + " changed.</b></p>")
        end
        webserver.content_send("<form action='panel' method='post'>")
        var placed = {}
        for z: self.store.doc["zones"]
            webserver.content_send("<fieldset><legend><input name='z:" + webserver.html_escape(z["id"]) + "' value='" +
                                   webserver.html_escape(z["name"]) + "' maxlength='" + str(PanelWeb.NAME_MAX) + "'></legend><table>")
            for dev: PanelStore.member_ids(z["members"])
                var d = self.store.find_device(dev)
                if d != nil
                    placed[d[0]] = true
                    webserver.content_send(self.device_row(d))
                end
            end
            webserver.content_send("</table></fieldset>")
        end
        var loose = []
        for d: self.store.doc["devices"]
            if !placed.contains(d[0]) loose.push(d) end
        end
        if size(loose) > 0
            webserver.content_send("<fieldset><legend>In no zone</legend><table>")
            for d: loose webserver.content_send(self.device_row(d)) end
            webserver.content_send("</table></fieldset>")
        end
        webserver.content_send("<p></p><button name='save' class='button bgrn'>Save</button></form><p></p>")
        webserver.content_button(webserver.BUTTON_MAIN)
        webserver.content_stop()
    end

    def post()
        import webserver
        if !webserver.check_privileged_access() return nil end
        var fields = []
        for i: 0 .. webserver.arg_size() - 1
            fields.push([webserver.arg_name(i), webserver.arg(i)])
        end
        var n = self.apply_all(fields)
        webserver.redirect("/panel?saved=" + str(n))
    end
end
