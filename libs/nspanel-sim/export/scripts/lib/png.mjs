// Minimal PNG encoder (8-bit RGBA, no interlace) and RGB565 conversion for
// the pictures the D1 scenarios embed. Node-only (zlib); the library in
// src/ stays free of Node APIs and takes the encoded bytes.
import { deflateSync, inflateSync, crc32 } from "node:zlib";
import { picturePixels, pictureRgba } from "../../../layout/dist/paint.js";

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBytes = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0, 0);
  return Buffer.concat([len, typeBytes, data, crc]);
}

/** RGBA (width*height*4) -> PNG file bytes. */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new RangeError("rgba size mismatch");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}

/** RGBA -> RGB565 little-endian (what `.i` and the panel use). */
export function rgbaToRgb565(width, height, rgba) {
  const out = new Uint8Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
    const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
    out[i * 2] = v & 0xff;
    out[i * 2 + 1] = v >> 8;
  }
  return out;
}

/**
 * A recognisable test picture: four coloured quadrants (red, green, blue,
 * yellow), a white diagonal and a 2-pixel black frame — easy to spot on
 * the Editor's debugger and on a photo of the panel.
 */
export function testPattern(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const left = x < width / 2, top = y < height / 2;
    let c = left && top ? [255, 0, 0] : !left && top ? [0, 255, 0] : left ? [0, 0, 255] : [255, 255, 0];
    if (Math.abs(Math.round((x * (height - 1)) / (width - 1)) - y) <= 1) c = [255, 255, 255];
    if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) c = [0, 0, 0];
    rgba.set([...c, 255], (y * width + x) * 4);
  }
  return { width, height, rgba, png: encodePng(width, height, rgba), rgb565: rgbaToRgb565(width, height, rgba) };
}

/** A single-colour picture (`color` = [r, g, b]): the case a compressor loves. */
export function solid(width, height, color = [255, 0, 0]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set([...color, 255], i * 4);
  return { width, height, rgba, png: encodePng(width, height, rgba), rgb565: rgbaToRgb565(width, height, rgba) };
}

/** An 8x8 black/white checkerboard: two colours, high frequency. */
export function checker(width, height, cell = 8) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
    rgba.set(on ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * width + x) * 4);
  }
  return { width, height, rgba, png: encodePng(width, height, rgba), rgb565: rgbaToRgb565(width, height, rgba) };
}

/**
 * A generated picture: a look the glass can hold and the attribute set cannot
 * name. A gradient track today, a switch rail with its knob today, whatever the
 * next one is tomorrow.
 *
 * The pixels come from `@nspanel-sim/layout`, not from here, and that is the
 * point: the browser draws those same stops as CSS. This file only encodes them,
 * because PNG needs zlib and `layout/` may not import `node:`.
 *
 * The RGBA is derived FROM the RGB565 rather than from the original 24-bit
 * colours, so the PNG the Editor imports is exactly what the panel will show --
 * and the Editor has no 24-bit detail left to dither or round differently.
 */
export function generated(spec) {
  const rgb565 = picturePixels(spec);
  const rgba = pictureRgba(spec);
  return { width: spec.width, height: spec.height, rgba, png: encodePng(spec.width, spec.height, rgba), rgb565 };
}

/**
 * PNG file bytes -> { width, height, rgba }. Enough of the format to read what
 * the sandbox screenshots are (8-bit truecolour with or without alpha, no
 * interlace), and no more: it exists so that a measurement off the Editor's
 * debugger is counted rather than eyeballed. Anything else throws by name.
 */
export function decodePng(bytes) {
  const b = Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (SIG.some((v, i) => b[i] !== v)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos);
    const type = b.toString("ascii", pos + 4, pos + 8);
    const data = b.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
  }
  if (depth !== 8) throw new Error(`decodePng: bit depth ${depth} not supported`);
  if (colour !== 2 && colour !== 6) throw new Error(`decodePng: colour type ${colour} not supported`);
  if (interlace !== 0) throw new Error("decodePng: interlaced");

  const channels = colour === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(height * stride);
  // the five filters of the spec, applied per scanline against the one above
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const up = prev ? prev[x] : 0;
      const ul = prev && x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) {
        const p = a + up - ul, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      } else if (filter !== 0) throw new Error(`decodePng: filter ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    rgba[i * 4] = out[i * channels];
    rgba[i * 4 + 1] = out[i * channels + 1];
    rgba[i * 4 + 2] = out[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? out[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}
