# Tasmota's `mqtt` module (be_mqtt_lib.c), as a file the standalone interpreter
# can import (see stub_persist.be for why a module has to be a real file):
# whether the client is on its broker, as a test says (`up`), what it
# published, and what it subscribed to, kept for the test to look at and call.
var mqtt = module("mqtt")
mqtt.up = false
mqtt.published = []
mqtt.subs = []
mqtt.connected = def () return mqtt.up end
mqtt.publish = def (topic, payload, retain)
    mqtt.published.push([topic, payload, retain == true])
    return true
end
mqtt.subscribe = def (topic, closure) mqtt.subs.push([topic, closure]) end
mqtt.unsubscribe = def (topic)
    var i = 0
    while i < size(mqtt.subs)
        if topic == nil || mqtt.subs[i][0] == topic  mqtt.subs.remove(i) else i += 1 end
    end
end
return mqtt
