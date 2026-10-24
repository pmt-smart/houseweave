# mesh_beat.be -- the 32 bytes of the application that every heartbeat of the ESP-NOW mesh carries, written by more than one part of the brain.
# The driver takes them whole, with espnow_mesh_info(bytes), and replaces what it had: there is no writing of a field. So the parts that have a field in them (the
# alarm's replica, bytes 1 to 19 and bit 7 of the byte 19; the house layer, the sequence of the state in 20 and 21, the identity in 23 and 24, the digest of the list of
# the house in 25 to 27) write into ONE buffer, this one, and it is given to the driver in a piece. The core writes over bytes 0 to 11, bit 0 of the byte 19 (synced)
# and, with the keys of the network said, bits 5 and 6 of the byte 19 and the byte 22 (the version of the key) as the heartbeat goes out, so what the parts leave there is not read.
#
# There is one of them on a device: MeshBeat.shared(). It reaches the natives by `global`, as the other classes of the mesh do: an image without the driver has none of them,
# flush() gives false there, and nothing raises.

#@ solidify:MeshBeat
class MeshBeat
    static SIZE = 32

    var buf      # the 32 bytes
    var sent     # the bytes the driver last took, or nil: flush() gives nothing the driver already has

    def init()
        self.buf = bytes(-32)
        self.buf[0] = 1
        self.sent = nil
    end

    # the one buffer of the device
    static def shared()
        import global
        var b = global.contains("mesh_beat_shared") ? global.mesh_beat_shared : nil
        if b == nil
            b = MeshBeat()
            global.mesh_beat_shared = b
        end
        return b
    end

    # writes bytes at an offset, and does not go past the end
    def put(at, b)
        var n = size(b)
        if at < 0 || at + n > MeshBeat.SIZE return false end
        for i: 0 .. n - 1
            self.buf[at + i] = b[i]
        end
        return true
    end

    # one bit (or more) of a byte, on or off
    def bit(at, mask, on)
        if on
            self.buf[at] = self.buf[at] | mask
        else
            self.buf[at] = self.buf[at] & (255 - mask)
        end
    end

    # the buffer given to the driver, when it is not what the driver has: true when the driver has it. The mesh restarting takes the bytes it had, so a caller that
    # knows it did calls forget() first
    def flush()
        import global
        if self.sent != nil && self.sent == self.buf return true end
        var ok = false
        try
            ok = global.contains("espnow_mesh_info") && global.espnow_mesh_info(self.buf.copy()) == true
        except .. as e, m
            log("MESH: the heartbeat's bytes were not taken (" + str(e) + ": " + str(m) + ")", 2)
        end
        self.sent = ok ? self.buf.copy() : nil
        return ok
    end

    # the driver lost what it had (the mesh started again): the next flush() gives the bytes again
    def forget()
        self.sent = nil
    end
end
