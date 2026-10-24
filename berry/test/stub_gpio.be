# Tasmota's `gpio` module, as berry/zbbridge_relay.be uses it for the pairing's
# LED: the LED1 function, the pin it is on, and the level written to it. The
# ZBBridge Pro's template puts LED1 on GPIO17, inverted.
var gpio = module("gpio")
gpio.LED1 = 288
# and its button, KEY1, on GPIO4 here, at 1 while it is not pressed (a pull-up)
gpio.KEY1 = 32
gpio.levels = {17: 1, 4: 1}
gpio.pin = def (f, idx) if idx != nil && idx != 0 return -1 end return f == 288 ? 17 : (f == 32 ? 4 : -1) end
gpio.digital_read = def (p) return gpio.levels.find(p, 0) end
gpio.digital_write = def (p, v) gpio.levels[p] = v end
return gpio
