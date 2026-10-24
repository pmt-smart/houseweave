# berry/tft_pack.be against berry/test/vectors/tft_pack.json: files packed by
# libs/nspanel-sim/export/src/tftPack.ts (scripts/tft-pack-vectors.mjs writes
# them), each read back here in every way the flash reads a file, and checked by
# the size and the SHA-256 of what it stands for. Then the files it must refuse,
# and the chunks it must not decode.

import json
import string
import crypto

def read_text(rel)
    var f = open(TEST_ROOT + "/" + rel)
    var s = f.read()
    f.close()
    return s
end

# a file of the file system, in memory: what the flash calls on one, and the closes
class MemFile
    var b, p, closed, reads
    def init(b) self.b = b self.p = 0 self.closed = 0 self.reads = 0 end
    def size() return size(self.b) end
    def seek(p) self.p = p end
    def readbytes(n)
        self.reads += 1
        var e = self.p + n
        if e > size(self.b) e = size(self.b) end
        var out = e > self.p ? self.b[self.p .. e - 1] : bytes()
        self.p = e
        return out
    end
    def close() self.closed += 1 end
end

def sha(b)
    var h = crypto.SHA256()
    h.update(b)
    return string.tolower(h.out().tohex())
end

# the whole .tft, `step` bytes a read
def read_all(t, step)
    var out = bytes()
    t.seek(0)
    while true
        var got = t.readbytes(step)
        if size(got) == 0 break end
        out .. got
    end
    return out
end

var v = json.load(read_text("berry/test/vectors/tft_pack.json"))
assert(v["chunk"] == TftPack.CHUNK, "the vectors' chunk is the decoder's")
for c: v["cases"]
    var name = c["name"]
    var t = TftPack.wrap(MemFile(bytes(c["packed"])))
    assert(isinstance(t, TftPack), name + ": a packed file is read through a TftPack")
    assert(t.size() == c["size"], name + ": its size is the .tft's")
    var whole = read_all(t, 4096)
    assert(size(whole) == c["size"] && sha(whole) == c["sha256"], name + ": read a block at a time, it is the .tft")
    assert(read_all(t, 1000) == whole, name + ": read in pieces that cross the chunks, the same")
    t.seek(0)
    assert(t.readbytes(c["size"] + 50) == whole, name + ": in one read, the same, and no more")
    # a jump into the middle of a chunk, and a read across the next
    if c["size"] > 4200
        t.seek(4090)
        assert(t.readbytes(20) == whole[4090 .. 4109], name + ": from a byte in the middle, across two chunks")
    end
    t.seek(c["size"])
    assert(size(t.readbytes(10)) == 0, name + ": nothing past the end")
    t.close()
end

# --- a file that is not packed is the .tft as the Editor wrote it ---------------------------
var plain = MemFile(bytes("00000000AABBCCDD"))
plain.readbytes(3)
assert(TftPack.wrap(plain) == plain && plain.p == 0, "a plain file comes back as itself, from its first byte")
var tiny = MemFile(bytes("4E58"))
assert(TftPack.wrap(tiny) == tiny && tiny.p == 0, "so does one shorter than the magic")

# --- the files it refuses: closed, and nil --------------------------------------------------
var packed = bytes(v["cases"][1]["packed"])
var cut = MemFile(packed[0 .. size(packed) - 2])
assert(TftPack.wrap(cut) == nil && cut.closed == 1, "a packed file cut short is refused, and closed")
var other = packed.copy()
other[4] = 2
var mf = MemFile(other)
assert(TftPack.wrap(mf) == nil && mf.closed == 1, "a format this panel does not read")
var wrong = packed.copy()
wrong.set(12, 7, 4)
assert(TftPack.wrap(MemFile(wrong)) == nil, "an index that does not count the .tft's chunks")
# the index whole, and a size that would need five chunks where it counts three
var bigger = packed.copy()
bigger.set(8, 20000, 4)
var mb = MemFile(bigger)
assert(TftPack.wrap(mb) == nil && mb.closed == 1, "a size its chunks do not make")
assert(TftPack.wrap(MemFile(packed[0 .. 9])) == nil, "a header cut short")

# --- chunks that do not decode -----------------------------------------------------------------
# one literal, then a match two bytes back: before the chunk starts, with nothing else wrong
assert(TftPack.unpack(bytes("10410200"), 5) == nil, "a match that reaches before the chunk")
# a match no bytes back would copy nothing, forever
assert(TftPack.unpack(bytes("10410000"), 5) == nil, "a match at offset 0")
# five literals announced, one there
assert(TftPack.unpack(bytes("5041"), 10) == nil, "literals past the chunk's end")
# a literal count of 15 and more, with its bytes missing
assert(TftPack.unpack(bytes("F0"), 100) == nil, "a length whose bytes are missing")
# right bytes, wrong size
assert(TftPack.unpack(bytes("30414243"), 4) == nil, "sequences that make fewer bytes than the chunk")
assert(TftPack.unpack(bytes("304142430100"), 7) == bytes("41424343434343"), "a run made by a match one byte back")
# the run over three chunks with its second chunk's token broken: the flash gets the
# first chunk, and the read stops where the second does not decode
var broken = packed.copy()
broken[52] = 0x50
var tb = TftPack.wrap(MemFile(broken))
assert(isinstance(tb, TftPack), "the index is whole")
assert(size(read_all(tb, 4096)) == 4096, "the chunk before the broken one, and nothing after")

print("test_tft_pack: all assertions passed")
