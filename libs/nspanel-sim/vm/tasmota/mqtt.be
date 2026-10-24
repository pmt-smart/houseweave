# mqtt.be -- the parts of Tasmota's mqtt module (be_mqtt_lib.c and its
# embedded mqtt.be) the devices use: whether the client is on its broker, a
# publish, and a subscription with a closure, matched here as Tasmota's own
# matches it, `+` for one level and `#` for the rest. What the house's broker
# delivers (vm/src/house.ts) is read at every 50 ms of the loop, as Tasmota
# hands a message to Berry in the loop that reads it.
import json
var mqtt = module("mqtt")
mqtt.connected = def () return _host("mqtt_connected") == "1" end
mqtt.publish = def (topic, payload, retain)
    return _host("mqtt_publish", json.dump([str(topic), str(payload), retain == true])) == "1"
end

# [pattern as its levels, the pattern, the closure], a subscription
mqtt._topics = nil
mqtt._matches = def (pat, topic)
    import string
    var t = string.split(topic, "/")
    var i = 0
    while i < size(pat)
        if pat[i] == "#" return true end
        if i >= size(t) return false end
        if pat[i] != "+" && pat[i] != t[i] return false end
        i += 1
    end
    return size(pat) == size(t)
end
mqtt._poll = def ()
    var m = _host("mqtt_read")
    while m != nil
        var d = json.load(m)
        for s: mqtt._topics
            if mqtt._matches(s[0], d[0])  s[2](d[0], 0, d[1], bytes().fromstring(d[1])) end
        end
        m = _host("mqtt_read")
    end
end
mqtt.subscribe = def (topic, closure)
    import string
    if mqtt._topics == nil
        mqtt._topics = []
        class MqttPoll
            def every_50ms() mqtt._poll() end
        end
        tasmota.add_driver(MqttPoll())
    end
    for s: mqtt._topics
        if s[1] == topic && s[2] == closure return end
    end
    mqtt._topics.push([string.split(topic, "/"), topic, closure])
    _host("mqtt_subscribe", topic)
end
mqtt.unsubscribe = def (topic)
    if mqtt._topics == nil return end
    var i = 0
    while i < size(mqtt._topics)
        if topic == nil || mqtt._topics[i][1] == topic
            _host("mqtt_unsubscribe", mqtt._topics[i][1])
            mqtt._topics.remove(i)
        else
            i += 1
        end
    end
end
return mqtt
