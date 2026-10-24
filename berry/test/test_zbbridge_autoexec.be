# berry/zbbridge_autoexec.be, the ZBBridge Pro's autoexec.be: the relay's files that were left on its file
# system are loaded over the firmware's classes, and a file that is there wins over the
# firmware just updated by OTA, which nothing else on the bridge says. So the loader says,
# at level 1, which file it runs, by its name; and it starts the relay once, whichever files it ran.
#
# stub_bridge_autoexec.be puts two files on the file system (zbbridge_relay_pairing.be, zbdriver_cover.be)
# and the firmware's relay in the global table; the autoexec has run by the time this file does.

import string

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

check("only the files that are on the file system are loaded, in the loader's order",
      loaded, ["zbbridge_relay_pairing.be", "zbdriver_cover.be"])
var said = []
for l: logged
    if string.find(l[1], "runs from the file system") >= 0  said.push(l) end
end
check("each file it runs is said, once, at level 1, by its name",
      [size(said), said[0][0], string.find(said[0][1], "zbbridge_relay_pairing.be") >= 0, said[1][0], string.find(said[1][1], "zbdriver_cover.be") >= 0],
      [2, 1, true, 1, true])
check("with the log's prefix, for whoever reads the console", said[0][1][0 .. 15], "ZBBRIDGE_RELAY: ")
check("a file that is not there is not said", string.find(str(logged), "pair_sign.be"), -1)
check("the firmware's relay is started once", ZbBridgeRelay.started, 1)
check("and the firmware having it, nothing says it is missing", string.find(str(logged), "not in this firmware"), -1)

if failures == 0
    print("ok - " + str(checks) + " checks")
else
    print("FAILED " + str(failures) + " of " + str(checks))
    raise "assert_failed"
end
