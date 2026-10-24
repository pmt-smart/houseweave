// A QR code, as modules: what the simulator draws where the glass has a
// Nextion Qrcode.
//
// The panel does not need this. A Nextion Qrcode takes a text and draws its
// own symbol, and the page only writes the text. This is for the
// two renderers that are not the Nextion -- the React column and the emulated
// glass -- so the page they show carries a code a phone can read, and the
// simulator can be scanned the way the glass will be.
//
// It is the standard's byte mode (ISO/IEC 18004), and nothing else: the one
// mode a `WIFI:` string needs. Error correction L by default, because that is
// the Nextion's own: its measured limits are the byte capacities of level L
// exactly -- 134 bytes for a version 6 symbol, 154 for a 7 and 192 for an 8,
// where the Editor's `txt_maxl` stops. Which version and which
// mask the Nextion picks for a given text, and how big it draws a module, has
// not been measured; this picks the smallest version that holds the text and
// the mask of least penalty, as the standard says a writer should.
//
// Written from the standard's algorithm (the structure of Project Nayuki's
// reference encoder, which follows it step by step), for versions 1 to 10 --
// 271 bytes at level L, past anything a Nextion takes.

export type QrEcc = "L" | "M" | "Q" | "H";

/** The two format bits of each level: L 01, M 00, Q 11, H 10. */
const FORMAT_BITS: Record<QrEcc, number> = { L: 1, M: 0, Q: 3, H: 2 };

/** The largest version this encoder writes. */
export const QR_MAX_VERSION = 10;

// Per level, per version (index 0 unused): the error correction codewords of
// one block, and how many blocks. The standard's table 9, versions 1 to 10.
const ECC_PER_BLOCK: Record<QrEcc, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
};
const BLOCKS: Record<QrEcc, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
};

/** A symbol: `size` x `size` modules, `true` for a dark one, by row. */
export interface QrSymbol {
  version: number;
  ecc: QrEcc;
  mask: number;
  size: number;
  modules: boolean[][];
}

/** How many modules of a version carry data and error correction, the function patterns taken out. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** How many data codewords a version holds at a level. */
export function qrDataCodewords(version: number, ecc: QrEcc): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[ecc][version] * BLOCKS[ecc][version];
}

/** The bits of the character count in byte mode: 8 up to version 9, 16 from 10. */
const countBits = (version: number) => (version <= 9 ? 8 : 16);

/** How many bytes a version holds in byte mode at a level. */
export function qrByteCapacity(version: number, ecc: QrEcc = "L"): number {
  return Math.floor((qrDataCodewords(version, ecc) * 8 - 4 - countBits(version)) / 8);
}

/** The smallest version whose byte mode holds `bytes` at a level, or null past `QR_MAX_VERSION`. */
export function qrVersionFor(bytes: number, ecc: QrEcc = "L"): number | null {
  for (let v = 1; v <= QR_MAX_VERSION; v++) if (qrByteCapacity(v, ecc) >= bytes) return v;
  return null;
}

/** A text's bytes in UTF-8, which is what a phone reads a `WIFI:` string as. */
export function utf8Bytes(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

// --- Reed-Solomon over GF(2^8), the field of the polynomial 0x11D -----------------------------

/** The product of two field elements. */
export function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

/** The generator polynomial of `degree`, its leading 1 left out, highest power first. */
export function rsDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** The error correction codewords of a block of data. */
export function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

// --- the symbol ---------------------------------------------------------------------------------

/**
 * The QR symbol of `text` in byte mode, or null when it holds more than
 * version `QR_MAX_VERSION` can.
 */
export function qrEncode(text: string, ecc: QrEcc = "L"): QrSymbol | null {
  const bytes = utf8Bytes(text);
  const version = qrVersionFor(bytes.length, ecc);
  if (version === null) return null;

  // The data bits: the mode (0100, bytes), the count, the bytes, and the
  // terminator and the pad the capacity asks for.
  const capacityBits = qrDataCodewords(version, ecc) * 8;
  const bits: number[] = [];
  const put = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, capacityBits - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacityBits / 8; pad ^= 0xec ^ 0x11) data.push(pad);

  // The blocks, each with its error correction, and the codewords interleaved.
  const blocks = BLOCKS[ecc][version];
  const eccLen = ECC_PER_BLOCK[ecc][version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLen);
  const cut: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1));
    k += dat.length;
    const block = [...dat];
    if (i < shortBlocks) block.push(0);
    cut.push([...block, ...rsRemainder(dat, divisor)]);
  }
  const codewords: number[] = [];
  for (let i = 0; i < cut[0].length; i++) {
    cut.forEach((block, j) => {
      // the short blocks' placeholder byte is not a codeword
      if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(block[i]);
    });
  }

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const fixed: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    fixed[y][x] = true;
  };

  // the timing patterns, then the finders, the alignments, and room for the
  // format and version information
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const align = alignmentPositions(version, size);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormat(set, size, ecc, 0);
  if (version >= 7) drawVersion(set, size, version);

  // The codewords, in the standard's zigzag: two columns at a time from the
  // right, up and then down, skipping the vertical timing column.
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y][x] || bit >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1) === 1;
        bit++;
      }
    }
  }

  // the mask of least penalty, and its format information
  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(modules, fixed, m);
    drawFormat(set, size, ecc, m);
    const score = penalty(modules);
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
    applyMask(modules, fixed, m);
  }
  applyMask(modules, fixed, best);
  drawFormat(set, size, ecc, best);
  return { version, ecc, mask: best, size, modules };
}

/** Where the alignment patterns' centres are, on either axis. */
export function alignmentPositions(version: number, size = version * 4 + 17): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** The 15 format bits: the level and the mask, their BCH code, and the standard's XOR. */
export function formatBits(ecc: QrEcc, mask: number): number {
  const data = (FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(set: (x: number, y: number, dark: boolean) => void, size: number, ecc: QrEcc, mask: number) {
  const bits = formatBits(ecc, mask);
  const at = (i: number) => ((bits >>> i) & 1) === 1;
  // around the top left finder
  for (let i = 0; i <= 5; i++) set(8, i, at(i));
  set(8, 7, at(6));
  set(8, 8, at(7));
  set(7, 8, at(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, at(i));
  // and again beside the other two
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, at(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, at(i));
  // the one module that is always dark
  set(8, size - 8, true);
}

function drawVersion(set: (x: number, y: number, dark: boolean) => void, size: number, version: number) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    set(a, b, dark);
    set(b, a, dark);
  }
}

/** The standard's eight masks, applied to every module that is not a function pattern (or undone: they are XORs). */
function applyMask(modules: boolean[][], fixed: boolean[][], mask: number) {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (fixed[y][x]) continue;
      let invert: boolean;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
      }
      if (invert) modules[y][x] = !modules[y][x];
    }
  }
}

/** The standard's penalty of a masked symbol: long runs, 2x2 blocks, finder look-alikes, and the balance. */
function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let result = 0;
  const lines = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i++) {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      const add = (length: number) => {
        if (history[0] === 0) length += size;
        history.pop();
        history.unshift(length);
      };
      const count = () => {
        const n = history[1];
        const core = n > 0 && history[2] === n && history[3] === n * 3 && history[4] === n && history[5] === n;
        return (core && history[0] >= n * 4 && history[6] >= n ? 1 : 0) + (core && history[6] >= n * 4 && history[0] >= n ? 1 : 0);
      };
      for (let j = 0; j < size; j++) {
        if (get(i, j) === color) {
          run++;
          if (run === 5) result += 3;
          else if (run > 5) result++;
        } else {
          add(run);
          if (!color) result += count() * 40;
          color = get(i, j);
          run = 1;
        }
      }
      if (color) {
        add(run);
        run = 0;
      }
      add(run + size);
      result += count() * 40;
    }
  };
  lines((y, x) => modules[y][x]);
  lines((x, y) => modules[y][x]);
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += 3;
    }
  }
  let dark = 0;
  for (const row of modules) for (const m of row) if (m) dark++;
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/**
 * Where a symbol goes in a box: the biggest whole module that leaves a quiet
 * zone of at least `quiet` modules on every side, and the symbol centred. A
 * module is never a fraction of a pixel -- a reader needs square modules.
 */
export function qrPlacement(size: number, box: { w: number; h: number }, quiet = 2): { scale: number; x: number; y: number } {
  const side = Math.min(box.w, box.h);
  const scale = Math.max(1, Math.floor(side / (size + 2 * quiet)));
  const drawn = scale * size;
  return { scale, x: Math.floor((box.w - drawn) / 2), y: Math.floor((box.h - drawn) / 2) };
}
