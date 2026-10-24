# Tasmota's `crypto` module, as a file the standalone interpreter can import
# (see stub_persist.be for why a module has to be a real file):
# - random(), which the pairing draws its secret from, and which counts up so a
#   test can say what it drew;
# - SHA256, a real one (FIPS 180-4) in Berry, with Tasmota's interface
#   (be_crypto_lib.c): update(bytes) returns the instance, out() the 32 bytes.
#   The pairing's signatures (pair_sign.be) need a real digest, and the
#   interpreter has none. Its ints are 32 bits, as on the ESP32: sums wrap, and a
#   right shift keeps the sign, so every shift is masked.
var m = module("crypto")
m.drawn = 0
m.random = def (n)
    var b = bytes()
    for i: 0 .. n - 1 b.add(m.drawn + i, 1) end
    m.drawn += n
    return b
end

class SHA256
    static K = [
        0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
        0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
        0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
        0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
        0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
        0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
        0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
        0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2]
    # what a right shift by n keeps, for the shift to bring zeros in
    static MASK = [
        0xFFFFFFFF, 0x7FFFFFFF, 0x3FFFFFFF, 0x1FFFFFFF, 0x0FFFFFFF, 0x07FFFFFF, 0x03FFFFFF, 0x01FFFFFF,
        0x00FFFFFF, 0x007FFFFF, 0x003FFFFF, 0x001FFFFF, 0x000FFFFF, 0x0007FFFF, 0x0003FFFF, 0x0001FFFF,
        0x0000FFFF, 0x00007FFF, 0x00003FFF, 0x00001FFF, 0x00000FFF, 0x000007FF, 0x000003FF, 0x000001FF,
        0x000000FF, 0x0000007F, 0x0000003F, 0x0000001F, 0x0000000F, 0x00000007, 0x00000003, 0x00000001]
    var data
    def init() self.data = bytes() end
    def update(b)
        self.data = self.data + b
        return self
    end
    static def shr(x, n) return (x >> n) & SHA256.MASK[n] end
    static def ror(x, n) return SHA256.shr(x, n) | (x << (32 - n)) end
    def out()
        var msg = self.data.copy()
        var bits = size(self.data) * 8
        msg.add(0x80, 1)
        while size(msg) % 64 != 56  msg.add(0, 1) end
        msg.add(0, -4)
        msg.add(bits, -4)
        var h = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19]
        var c = 0
        while c < size(msg)
            var w = []
            for i: 0 .. 15  w.push(msg.get(c + 4 * i, -4)) end
            for i: 16 .. 63
                var s0 = SHA256.ror(w[i - 15], 7) ^ SHA256.ror(w[i - 15], 18) ^ SHA256.shr(w[i - 15], 3)
                var s1 = SHA256.ror(w[i - 2], 17) ^ SHA256.ror(w[i - 2], 19) ^ SHA256.shr(w[i - 2], 10)
                w.push(w[i - 16] + s0 + w[i - 7] + s1)
            end
            var a = h[0]
            var b = h[1]
            var cc = h[2]
            var d = h[3]
            var e = h[4]
            var f = h[5]
            var g = h[6]
            var hh = h[7]
            for i: 0 .. 63
                var S1 = SHA256.ror(e, 6) ^ SHA256.ror(e, 11) ^ SHA256.ror(e, 25)
                var ch = (e & f) ^ ((~e) & g)
                var t1 = hh + S1 + ch + SHA256.K[i] + w[i]
                var S0 = SHA256.ror(a, 2) ^ SHA256.ror(a, 13) ^ SHA256.ror(a, 22)
                var maj = (a & b) ^ (a & cc) ^ (b & cc)
                var t2 = S0 + maj
                hh = g
                g = f
                f = e
                e = d + t1
                d = cc
                cc = b
                b = a
                a = t1 + t2
            end
            h[0] += a
            h[1] += b
            h[2] += cc
            h[3] += d
            h[4] += e
            h[5] += f
            h[6] += g
            h[7] += hh
            c += 64
        end
        var out = bytes()
        for v: h  out.add(v, -4) end
        return out
    end
end
m.SHA256 = SHA256
return m
