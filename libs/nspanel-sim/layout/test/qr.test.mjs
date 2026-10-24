// The QR encoder the simulator draws the Qrcode with (src/qr.ts).
//
// There is no QR reader on this machine to hold it against, so a reader is
// written here, apart from the encoder, from the standard: it reads the format
// information back, takes the mask off, walks the zigzag, splits the blocks,
// checks each block's Reed-Solomon syndromes and parses the bytes. A symbol it
// reads back whole, with every syndrome zero, is a symbol whose structure and
// arithmetic agree with the standard's -- the placement, the interleaving and
// the error correction together.
//
// What no test here can say is how the NEXTION draws its own symbol: which
// version, which mask, how big a module. The panel writes the
// text and the glass encodes it; this is only what the simulator shows.
import test from "node:test";
import assert from "node:assert/strict";

import {
  qrEncode, qrByteCapacity, qrVersionFor, qrDataCodewords, formatBits, alignmentPositions, gfMultiply,
  qrPlacement, utf8Bytes,
} from "../dist/index.js";

test("the byte capacities at level L are the ones the Nextion's own limits sit on", () => {
  // a Qrcode's txt_maxl reserves more at 135 and at 155, and the
  // range stops at 192 -- the level L byte capacities of versions 6, 7 and 8
  assert.equal(qrByteCapacity(1, "L"), 17);
  assert.equal(qrByteCapacity(6, "L"), 134);
  assert.equal(qrByteCapacity(7, "L"), 154);
  assert.equal(qrByteCapacity(8, "L"), 192);
  assert.equal(qrByteCapacity(10, "L"), 271, "16 count bits from version 10");
  assert.equal(qrByteCapacity(1, "M"), 14);
  assert.equal(qrByteCapacity(1, "H"), 7);
  assert.equal(qrVersionFor(154), 7);
  assert.equal(qrVersionFor(155), 8);
  assert.equal(qrVersionFor(272), null, "past what this encoder writes");
});

test("the format information is the standard's table", () => {
  // ISO/IEC 18004 table C.1: level L mask 0, and level M mask 0 (the XOR mask alone)
  assert.equal(formatBits("L", 0), 0b111011111000100);
  assert.equal(formatBits("M", 0), 0b101010000010010);
  assert.equal(formatBits("H", 7), 0b000100000111011);
});

test("the alignment patterns sit where the standard's table says", () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(10), [6, 28, 50]);
});

/** The modules a reader skips: finders and separators, timing, alignments, format and version. */
function functionMap(version) {
  const size = version * 4 + 17;
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const box = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < size && y < size) f[y][x] = true;
  };
  box(0, 0, 9, 9);
  box(size - 8, 0, 8, 9);
  box(0, size - 8, 9, 8);
  for (let i = 0; i < size; i++) { f[6][i] = true; f[i][6] = true; }
  const a = alignmentPositions(version);
  for (const cx of a) for (const cy of a) {
    // an alignment never sits on a finder; on a timing line, it does
    const onFinder = (cx <= 8 && cy <= 8) || (cx >= size - 9 && cy <= 8) || (cx <= 8 && cy >= size - 9);
    if (!onFinder) box(cx - 2, cy - 2, 5, 5);
  }
  if (version >= 7) { box(size - 11, 0, 3, 6); box(0, size - 11, 6, 3); }
  return f;
}

/** The standard's reading of a symbol back to its bytes, with each block's syndromes. */
function read(symbol) {
  const { size, modules, version } = symbol;
  const bit = (x, y) => modules[y][x];
  // the format information, around the top left finder
  let format = 0;
  const at = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  at.forEach(([x, y], i) => { if (bit(x, y)) format |= 1 << i; });
  const ecc = ["L", "M", "Q", "H"].find((e) => [...Array(8).keys()].some((m) => formatBits(e, m) === format));
  const mask = [...Array(8).keys()].find((m) => formatBits(ecc, m) === format);
  const fixed = functionMap(version);
  const masks = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  const bits = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      const y = upward ? size - 1 - v : v;
      for (const x of [right, right - 1]) {
        if (fixed[y][x]) continue;
        bits.push(bit(x, y) !== masks[mask](x, y) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return { ecc, mask, codewords };
}

/** The data bytes and the syndromes, from the interleaved codewords of a version and level. */
function deinterleave(codewords, version, ecc, blocks, eccLen) {
  const total = codewords.length;
  const dataTotal = qrDataCodewords(version, ecc);
  const shortData = Math.floor(dataTotal / blocks);
  const longBlocks = dataTotal % blocks;
  const lens = Array.from({ length: blocks }, (_, i) => shortData + (i >= blocks - longBlocks ? 1 : 0));
  const out = lens.map(() => []);
  let k = 0;
  for (let i = 0; i < shortData + 1; i++) for (let b = 0; b < blocks; b++) if (i < lens[b]) out[b].push(codewords[k++]);
  for (let i = 0; i < eccLen; i++) for (let b = 0; b < blocks; b++) out[b].push(codewords[k++]);
  assert.equal(k, total, "every codeword is in a block");
  // S_j = C(alpha^j), j = 0 .. eccLen-1, for a block's polynomial highest term first
  const syndromes = out.map((block) => {
    const s = [];
    let root = 1;
    for (let j = 0; j < eccLen; j++) {
      let acc = 0;
      for (const c of block) acc = gfMultiply(acc, root) ^ c;
      s.push(acc);
      root = gfMultiply(root, 2);
    }
    return s;
  });
  return { data: out.flatMap((block, b) => block.slice(0, lens[b])), syndromes };
}

const BLOCKS = { L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4] };
const ECC = { L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18] };

for (const text of [
  "WIFI:T:nopass;S:tasmota-3E51A7-6960;;",
  "WIFI:T:WPA;S:nspanel-living;P:k7m3q9t2;;",
  "a",
  "x".repeat(154),
  "http://192.168.4.1",
  "WIFI:T:WPA;S:Cottage\\;2G;P:p@ss\\:w0rd;;",
]) {
  test(`reads back ${JSON.stringify(text.length > 40 ? text.slice(0, 20) + "..." : text)} whole, every block's syndromes zero`, () => {
    const symbol = qrEncode(text, "L");
    assert.ok(symbol);
    assert.equal(symbol.size, symbol.version * 4 + 17);
    assert.equal(symbol.version, qrVersionFor(utf8Bytes(text).length));
    const back = read(symbol);
    assert.equal(back.ecc, "L", "the format information says level L");
    assert.equal(back.mask, symbol.mask, "and the mask the encoder chose");
    const { data, syndromes } = deinterleave(back.codewords, symbol.version, "L", BLOCKS.L[symbol.version], ECC.L[symbol.version]);
    for (const s of syndromes) assert.ok(s.every((v) => v === 0), `a block's syndromes: ${s}`);
    // mode 0100, the count, the bytes
    const bits = data.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >> i) & 1));
    const take = (n) => bits.splice(0, n).reduce((a, b) => (a << 1) | b, 0);
    assert.equal(take(4), 0b0100, "byte mode");
    const count = take(symbol.version <= 9 ? 8 : 16);
    const bytes = Array.from({ length: count }, () => take(8));
    assert.equal(new TextDecoder().decode(Uint8Array.from(bytes)), text);
  });
}

test("the finders are where a reader looks for them, dark rings around a dark core", () => {
  const { modules, size } = qrEncode("WIFI:T:WPA;S:nspanel-living;P:k7m3q9t2;;");
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    assert.equal(modules[cy][cx], true, "the core");
    assert.equal(modules[cy - 2][cx - 2], false, "the light ring");
    assert.equal(modules[cy - 3][cx - 3], true, "the dark ring");
  }
  assert.equal(modules[size - 8][8], true, "the module that is always dark");
});

test("a symbol is placed at whole modules, centred, with a quiet zone", () => {
  const p = qrPlacement(29, { w: 226, h: 226 });
  assert.equal(p.scale, 6, "29 modules and two of quiet zone on each side in 226 px");
  assert.equal(p.x, Math.floor((226 - 6 * 29) / 2));
  assert.equal(p.y, p.x);
  assert.equal(qrPlacement(45, { w: 60, h: 60 }).scale, 1, "never less than a pixel a module");
});
