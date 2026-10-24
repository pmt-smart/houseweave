# What berry/zbbridge_autoexec.be calls, standing in for the firmware's, and the file system a bridge has
# when a file of the relay was left on it: two of the relay's files are there, which the loader
# runs over the firmware's classes. It sits before the driver, since the autoexec runs as it is read:
# the test file reads what it did.
#
# The log is kept as [level, text], load() records the file it is given, and the firmware's relay is a class
# in the global table that only counts its start.

import path
path.present.push("zbbridge_relay_pairing.be")
path.present.push("zbdriver_cover.be")

var loaded = []
var logged = []
load = def (f) loaded.push(f) end
log = def (msg, level) logged.push([level, msg]) end

class ZbBridgeRelay
    static var started = 0
    static def start()
        ZbBridgeRelay.started += 1
    end
end

class AutoexecGlobal : GlobalStub
    def contains(k) return self.store.contains(k) end
end
global = AutoexecGlobal()
global.store["ZbBridgeRelay"] = ZbBridgeRelay
