# pair_sign.be -- two helpers both images load first: a password drawn to be typed, and the save of persist that never raises.
#
# What a panel says to a bridge goes over the mesh, which seals a frame to one node with the key of the two. The name stays from an earlier
# use: every file that saves its records names this class.
#
# Loaded with load() first on the panel, where the firmware compiles it in, and before zbbridge_relay.be on the bridge.

#@ solidify:PairSign
class PairSign
    static PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"

    # A password to type from the glass or a phone: lowercase letters and digits,
    # without the ones read two ways (0 and o, 1, l and i). Drawn byte by byte
    # with no bias: a byte past the last whole run of the alphabet is drawn again.
    static def password(n)
        import crypto
        var s = ""
        while size(s) < n  s = PairSign.grow(s, crypto.random(n), n) end
        return s
    end

    # s and the characters the bytes r give, up to n: a byte past the last whole
    # run of the alphabet gives none, so no character comes out more often
    static def grow(s, r, n)
        var chars = PairSign.PASSWORD_CHARS
        var top = 256 - 256 % size(chars)
        var i = 0
        while i < size(r) && size(s) < n
            if r[i] < top  s += chars[r[i] % size(chars)] end
            i += 1
        end
        return s
    end

    # persist.save() that never raises: a failure (the heap, the file system) is a line at level 1 and not an exception in whoever asked,
    # which has nothing to do with it but goes on. What persist holds in memory is whole and still dirty, and any save that works afterwards
    # writes it all. It says whether the file was written now. On the panel it is the panel's one save (PanelStore.safe_save,
    # which does not wait for heap here: these are the saves that are not put off), found by name because it loads after this file; the
    # bridge has no such class and tries it itself, as the alarm's flush does
    static def safe_save(who)
        import global
        if global.contains("PanelStore")  return global.PanelStore.safe_save(global.PanelStore.SAVE_TRIES) end
        import persist
        try
            persist.save()
            return true
        except .. as e, m
            log(who + ": saving failed (" + str(e) + ": " + str(m) + ")", 1)
            return false
        end
    end
end
