# _brain_prelude.be -- run first by the build that compiles the brain into the
# firmware, and by nothing else: never on the panel, never in the simulator.
#
# Tasmota's `custom_berry_solidify` (pio-tools/solidify-from-url.py) copies each
# file it lists into lib/libesp32/berry_custom/src/embedded/ and runs them all,
# in one Berry VM, in the order of their names; then it writes into the
# firmware the class each file's solidify directive names. That VM is not a
# panel's:
#   - it lacks what Tasmota's firmware adds to Berry, which the brain's classes
#     are compiled against: `Driver`, the class several of them extend, and
#     the natives their methods name;
#   - it compiles strict, so a name has to be declared before a file that names
#     it is compiled, and the files come in the order of their names, not of
#     who names whom.
# So this file, whose name sorts first, declares all of them. A class here is
# compiled against, never compiled in: the solidified code names Tasmota's own
# Driver (`be_class_Driver`), and each name of ours is replaced by the class its
# own file defines.
#
# Every file the build takes has to name a class to register (the script stops
# the build without one), so this one names its own, and it is empty.

#@ solidify:BrainPrelude
class BrainPrelude
end

import global
import os
import re

class Driver
end
for name: ["log", "serial", "tcpclient", "tcpserver", "udp", "wire1", "wire2"]
    global.(name) = nil
end

# every class the other files will register, by their directives
for f: os.listdir("src/embedded/")
    if f[0] == "." continue end
    var fh = open("src/embedded/" + f)
    var src = fh.read()
    fh.close()
    for d: re.searchall("#@\\s*solidify:([A-Za-z0-9_]+)", src)
        if !global.contains(d[1])  global.(d[1]) = nil  end
    end
end
