# berry/pair_sign.be, the two helpers both images load first: a password drawn to be typed, and the save of persist that never raises.

import persist
import crypto
import json

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

# --- a password drawn ---------------------------------------------------------------------------------
def of_alphabet(s)
    import string
    for i: 0 .. size(s) - 1
        if string.find(PairSign.PASSWORD_CHARS, s[i]) < 0 return false end
    end
    return true
end
var drawn = PairSign.password(10)
check("a password drawn: ten characters, none of the ones read two ways", [size(drawn), of_alphabet(drawn)], [10, true])
check("drawn with no bias: a byte past the last whole run of the alphabet gives none",
      PairSign.grow("", bytes("00FFF8F7"), 4), PairSign.PASSWORD_CHARS[0] + PairSign.PASSWORD_CHARS[0xF7 % size(PairSign.PASSWORD_CHARS)])
check("and no more than asked", size(PairSign.grow("abc", bytes("0001020304"), 4)), 4)

# --- a save that falls over is not an exception out of the helper -----------------
def failing_save_checks()
    persist.store = {}
    persist.plan = nil
    persist.failures = 0
    persist.setmember("zb_marker", 1)
    persist.fail_next()
    check("the helper says it did not write, and that it did when it could", [PairSign.safe_save("TEST"), PairSign.safe_save("TEST")], [false, true])
    check("and the file has all of it, from the memory", json.load(persist.written)["zb_marker"], 1)
end
failing_save_checks()

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
