# gpio.be -- the parts of Tasmota's gpio module (be_gpio_lib.c) the devices use:
# the pin a function of the template is on, and the level written to it, as the
# page has them (the bridge's LED and button, vm/src/bridge.ts). GPIO_LED1 and GPIO_KEY1
# are Tasmota's numbers for the LED1 and the Button1 functions (AGPIO, the index times 32).
var gpio = module("gpio")
gpio.LED1 = 288
gpio.KEY1 = 32
gpio.pin = def (f, idx) return int(_host("gpio_pin", str(f) + "," + str(idx != nil ? idx : 0))) end
gpio.digital_read = def (p) return int(_host("gpio_read", str(p))) end
gpio.digital_write = def (p, v) _host("gpio_write", str(p) + "," + str(v)) end
return gpio
