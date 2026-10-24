# home.be — the joBr99 stack's home page (cardGrid): the bulb is touchable on
# screen only if a page exists to host its card, so this is a minimal "home"
# page.
#
# Protocol mapped from joBr99's original backend (not invented — see
# reference/joBr99/luibackend/{controller,pages}.py):
#   - leaving the screensaver: the TFT sends
#     "event,buttonPress2,screensaver,bExit,<tapCount>" (controller.py
#     ~lines 219-240, button_press) — there is no "give me the home" event,
#     it is literally the gesture of leaving the screensaver that triggers
#     the first render of the home (controller.py __init__ only stacks the
#     default card; this handler is what sends it to the screen).
#   - rendering a cardGrid page: `pageType~<cardType>` (pages.py
#     page_type, ~lines 136-139) followed by
#     `entityUpd~<heading>~<navigation>` + one `generate_entities_item`
#     chunk per entity (pages.py generate_entities_page, ~lines 473-478).
#   - `navigation` = "<leftBtn>~<rightBtn>", each being `"delete~~~~~"`
#     when there is no previous/next card (pages.py render_card,
#     ~lines 786-816) — no pagination (only 1 bulb), so
#     both buttons are always "delete".

#@ solidify:Home
class Home
    static TITLE = "Home"
    static NO_NAV = "delete~~~~~"

    var nx
    var light   # Light instance (light.be) — nil if it did not load
    var awaiting_render  # true right after sending pageType~cardGrid, waiting
                          # for the TFT to confirm (event,renderCurrentPage) that
                          # it finished the transition — found in the log: that
                          # event arrives ~40ms after the pageType, and if we send
                          # the entityUpd before it (mid-transition) the content
                          # is lost and the page stays black (the screensaver did
                          # not suffer from this because its content after the
                          # pageType is only "delete" placeholders, nothing
                          # visible to lose).

    def init(nx, light)
        self.nx = nx
        self.light = light
        self.awaiting_render = false
        if self.light != nil
            self.light.on_change = / id -> self.on_light_change(id)
        end
    end

    #################################################################
    # events coming from the TFT
    #################################################################

    def handle_event(parts)
        if parts[1] == "buttonPress2" && size(parts) >= 4 && parts[2] == "screensaver" && parts[3] == "bExit"
            self.render(true)
            return true
        end
        return false
    end

    #################################################################
    # rendering
    #################################################################

    # send_page_type=true when actually switching pages (leaving the
    # screensaver); false when it is only a state refresh with the home
    # already on screen — same distinction as the original render_card
    # (pages.py ~lines 777/818-824: sends `pageType~` only if send_page_type).
    def render(send_page_type)
        if send_page_type
            self.nx.send("pageType~cardGrid")
            self.awaiting_render = true
            return
        end
        self.send_content()
    end

    def send_content()
        import string
        var navigation = self.NO_NAV + "~" + self.NO_NAV
        var cmd = string.format("entityUpd~%s~%s", self.TITLE, navigation)
        if self.light != nil
            for id: self.light.devices.keys()
                cmd += self.light.card_chunk(id)
            end
        end
        self.nx.send(cmd)
    end

    # The TFT confirmed it finished switching pages (event,renderCurrentPage)
    # — only now is it safe to send the content, if we were waiting for it.
    def on_render_ready()
        if self.awaiting_render
            self.awaiting_render = false
            self.send_content()
        end
    end

    # a bulb's state changed (locally or via Zigbee) — resend the whole page
    # without changing pageType, exactly as the original backend does
    # (controller.py state_change_callback -> render_card(send_page_type=False)).
    # There is no single-item partial update in the original protocol.
    def on_light_change(id)
        self.render(false)
    end

end
