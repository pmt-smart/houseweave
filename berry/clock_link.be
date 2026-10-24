# clock_link.be -- the time over the link between a panel and its bridge: what each side
# says of its clock, and when one takes the other's. In both images, as PairSign is: the panel's PanelClock and the
# bridge's relay each say it of their own clock.
#
# A word is {"utc": the UTC now, 0 with no clock, "src": where the time came from, "at": when the clock was last set by
# the user or by the internet, in UTC, 0 for not known}. The rule: a side with no clock takes the other's; between two set
# clocks, the one set last by the user or the internet wins, and the other takes it only when the two are more than
# SLACK seconds apart. A side that took the other's keeps its "at", so how fresh the time is goes on with it. The panel
# says its word when the link comes up, when its time is set by hand, and every AGAIN_MS; the bridge answers with its own.
#
# And whether a boot's time is the one kept across a restart: the fork's RtcRetain driver says (USE_RTC_RETAIN),
# and a firmware without it knows no such command.

#@ solidify:ClockLink
class ClockLink
    static VALID = 1451602800       # 2016-01-01, Tasmota's START_VALID_TIME: a clock before it was never set
    static SLACK = 2
    static AGAIN_MS = 21600000      # 6 hours

    # what a side says of its clock
    static def word(src, at)
        var utc = tasmota.rtc()["utc"]
        return {"utc": utc >= ClockLink.VALID ? utc : 0, "src": src, "at": type(at) == "int" ? at : 0}
    end

    # Whether a side whose clock is set or not (`valid`), last set by the user or the internet at `at`, takes the other's word
    static def takes(valid, at, peer)
        if !isinstance(peer, map) return false end
        var utc = peer.find("utc")
        var pat = peer.find("at", 0)
        if type(utc) != "int" || utc < ClockLink.VALID || type(pat) != "int" return false end
        if !valid return true end
        if pat <= (type(at) == "int" ? at : 0) return false end
        var d = utc - tasmota.rtc()["utc"]
        return d > ClockLink.SLACK || d < -ClockLink.SLACK
    end

    # whether this boot's time is the one kept across the restart
    static def kept_across()
        var r = tasmota.cmd("RtcRetain")
        var m = isinstance(r, map) ? r.find("RtcRetain") : nil
        return isinstance(m, map) && m.find("Restored") == 1
    end
end
