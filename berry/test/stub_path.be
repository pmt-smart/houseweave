# Tasmota's `path` module, as a file the standalone interpreter can import (see
# stub_persist.be for why a module has to be a real file): exists() over the real
# filesystem the test writes into, and over the paths a test says are there
# (`present`); remove() takes a path off `present` and records it (`removed`),
# for the device's own files, such as Z2T's at the root, which no test writes.
var m = module("path")
m.present = []
m.removed = []
m.exists = def (p)
    if m.present.find(p) != nil return true end
    try
        var f = open(p, "r")
        f.close()
        return true
    except ..
        return false
    end
end
m.remove = def (p)
    var i = m.present.find(p)
    if i != nil m.present.remove(i) end
    m.removed.push(p)
    return true
end
return m
