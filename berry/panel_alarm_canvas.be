# panel_alarm_canvas.be -- one of the alarm's screens as the plan's page takes it: what PanelPlanView asks of
# a canvas, its title, its header's action, what it draws, its touches and its swipes, handed to PanelAlarmView, which knows
# the alarm. The Alarm screen, the Notifications screen and the notice that takes the glass are three of these, by `mode`.

#@ solidify:PanelAlarmCanvas
class PanelAlarmCanvas
    var owner   # PanelAlarmView
    var mode    # "alarm", "notifs" or "notice"

    def init(owner, mode)
        self.owner = owner
        self.mode = mode
    end

    def title() return self.owner.title_of(self.mode) end
    def action() return "" end
    def ops(style) return self.owner.ops_of(self.mode, style) end
    def tap(n, style) return self.owner.tap_of(self.mode, n, style) end
    def swipe(dir) return self.owner.swipe_of(self.mode, dir) end
end
