# Tasmota's `sonoff_zb_pro_flasher` (tasmota/berry/zigbee/sonoff_zb_pro_flasher.be), the CC2652P's flasher the bridge's image
# carries as a file, as a module the standalone interpreter can import (see stub_persist.be for why a module has to be a real
# file). The real one parses the Intel HEX file and writes the chip over the serial, 5 to 8 minutes with Tasmota mute; this one
# records what the relay asks of it (`calls`) and goes wrong on demand (`fail`): "check" raises in check(), as a file whose CCFG
# is wrong does, and "flash" leaves file_checked false after flash(), as the real one does when the write raised inside it.
var m = module("sonoff_zb_pro_flasher")
m.calls = []
m.fail = nil
m.file_checked = false
m.load = def (f)
    m.calls.push("load " + str(f))
    m.file_checked = false
end
m.check = def ()
    m.calls.push("check")
    if m.fail == "check"  raise "value_error", "incorrect CCFG, BSL is not set to DIO_8 LOW" end
    m.file_checked = true
end
m.flash = def ()
    m.calls.push("flash")
    if m.fail == "flash"  m.file_checked = false end
end
return m
