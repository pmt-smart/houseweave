# tft_pack.be -- the panel's .tft as its file system keeps it: compressed
#.
#
# The image and a release carry the screen packed, in the form
# libs/nspanel-sim/export/src/tftPack.ts writes and describes: a header, an
# index of where each chunk starts, and the .tft in chunks of 4096 bytes, each
# compressed alone as LZ4 sequences, or kept as it is when that is no shorter.
#
#   0   "NXLZ"
#   4   u8   format, 1
#   5   u8   log2 of the chunk size, 12
#   6   u16  0
#   8   u32  the .tft's size
#   12  u32  n, the number of chunks
#   16  u32 * (n + 1)  where each chunk starts in this file; the last is the file's size
#
# A chunk decodes alone, so any byte of the .tft is one chunk away -- the jump
# the display asks for when it holds part of the file already -- and the flash
# keeps one chunk in memory. A TftPack reads like the file it stands for:
# size(), readbytes(n), seek(p) and close(), all the flash asks of a file
# (nextion_driver.be, flash_file). A file that does not start with the magic is a
# .tft as the Editor wrote it, and wrap() gives it back as it is.

#@ solidify:TftPack
class TftPack
    static MAGIC = "NXLZ"
    static CHUNK = 4096

    var f          # the packed file
    var raw_size   # the .tft's size
    var count      # its chunks
    var offsets    # where each chunk starts in f, u32 each, and the file's end
    var pos        # the .tft's byte readbytes gives next
    var at         # the chunk decoded in `data`, or -1
    var data

    # An open file, as the .tft it holds: the file itself, from its first byte,
    # when it is not packed; a TftPack over it when it is; nil, with the file
    # closed, when a packed one is of a format this panel does not read or has
    # fewer bytes than its index says, as a download cut short would
    static def wrap(f)
        var head = f.readbytes(16)
        if size(head) < 4 || head[0 .. 3].asstring() != TftPack.MAGIC
            f.seek(0)
            return f
        end
        var why = nil
        var n = 0
        var index = nil
        if size(head) < 16 || head[4] != 1 || head[5] != 12
            why = "a format this panel does not read"
        else
            n = head.get(12, 4)
            index = f.readbytes(4 * (n + 1))
            if n != (head.get(8, 4) + TftPack.CHUNK - 1) / TftPack.CHUNK
                why = "an index that does not count its chunks"
            elif size(index) != 4 * (n + 1) || index.get(4 * n, 4) != f.size()
                why = "fewer bytes than its index says: it is not whole"
            end
        end
        if why != nil
            log("FLH: a packed .tft with " + why, 2)
            f.close()
            return nil
        end
        return TftPack(f, head.get(8, 4), n, index)
    end

    def init(f, raw_size, count, offsets)
        self.f = f
        self.raw_size = raw_size
        self.count = count
        self.offsets = offsets
        self.pos = 0
        self.at = -1
    end

    def size() return self.raw_size end

    def seek(p)
        if p < 0 p = 0 end
        if p > self.raw_size p = self.raw_size end
        self.pos = p
    end

    def close()
        self.f.close()
        self.data = nil
        self.at = -1
    end

    # Up to `n` bytes of the .tft, from where it is: fewer at its end, or when a
    # chunk does not decode, which the flash takes as a file that ended
    def readbytes(n)
        var out = bytes()
        while n > 0 && self.pos < self.raw_size
            var k = self.pos / TftPack.CHUNK
            if k != self.at
                self.at = -1
                self.data = self.chunk(k)
                if self.data == nil
                    log("FLH: chunk " + str(k) + " of the packed .tft does not decode", 2)
                    return out
                end
                self.at = k
            end
            var skip = self.pos - k * TftPack.CHUNK
            var take = size(self.data) - skip
            if take > n take = n end
            if skip == 0 && take == size(self.data) && take == n && size(out) == 0
                # a whole chunk, the flash's own read: no copy
                self.pos += take
                return self.data
            end
            out .. self.data[skip .. skip + take - 1]
            self.pos += take
            n -= take
        end
        return out
    end

    # Chunk k, decoded, or nil when its bytes do not make it
    def chunk(k)
        var a = self.offsets.get(4 * k, 4)
        var b = self.offsets.get(4 * k + 4, 4)
        var want = self.raw_size - k * TftPack.CHUNK
        if want > TftPack.CHUNK want = TftPack.CHUNK end
        if b <= a return nil end
        self.f.seek(a)
        var src = self.f.readbytes(b - a)
        if size(src) != b - a return nil end
        if b - a == want return src end
        return TftPack.unpack(src, want)
    end

    # LZ4 sequences back to the `want` bytes they make, or nil when they do not
    # make exactly that. A sequence is a token (the literal count in its high
    # nibble, the match length less 4 in its low one, 15 saying more bytes
    # follow, each adding up to 255 until one is less), the literals, and, but
    # in the last one, the match: its offset back, u16, and its length's bytes.
    static def unpack(src, want)
        var out = bytes(want)
        out.resize(want)
        var stop = size(src)
        var o = 0
        var i = 0
        while i < stop
            var t = src[i]
            i += 1
            var lit = t >> 4
            if lit == 15
                var e = 255
                while e == 255
                    if i >= stop return nil end
                    e = src[i]
                    i += 1
                    lit += e
                end
            end
            if i + lit > stop || o + lit > want return nil end
            if lit > 0
                out.setbytes(o, src, i, lit)
                o += lit
                i += lit
            end
            if i >= stop break end
            if i + 2 > stop return nil end
            var back = src.get(i, 2)
            i += 2
            var run = (t & 15) + 4
            if (t & 15) == 15
                var e = 255
                while e == 255
                    if i >= stop return nil end
                    e = src[i]
                    i += 1
                    run += e
                end
            end
            if back == 0 || back > o || o + run > want return nil end
            # a match nearer than its length repeats what it reaches: copied in
            # rounds that double, each one from where the repeat starts
            var done = 0
            while done < run
                var take = back + done
                if take > run - done take = run - done end
                out.setbytes(o + done, out, o - back, take)
                done += take
            end
            o += run
        end
        if o != want return nil end
        return out
    end
end
