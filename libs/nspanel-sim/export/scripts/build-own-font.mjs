// Builds a .zi that is OURS, to prove the Editor accepts a font this package
// produced rather than copied.
//
//   node scripts/build-own-font.mjs [--out hmi-scenarios/assets/ours-24.zi]
//
// The font it writes is deliberately three things at once, so one compile in the
// Editor tests all of them:
//
//   1. a SUBSET  — a handful of glyphs out of liber's 224, so the table and the
//                  offsets are rebuilt;
//   2. RE-ENCODED — every kept glyph is decoded to pixels and encoded again by
//                  encodeZiGlyph, so the streams are ours, not the Editor's;
//   3. SYNTHESISED — two glyphs drawn here pixel by pixel, shapes that exist in
//                  no font we hold.
//
// If the Editor compiles this and the panel would draw it, then "generate our
// own .zi" is settled, and with it the icon set of a theme: the panel's
// icons ARE glyphs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob,
  readZi, writeZi, subsetZi, ziGlyphMap, ziBitmapWidth, decodeZiGlyph, encodeZiGlyph, ZI_ALPHA_MAX,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outPath = args.includes("--out")
  ? resolve(args[args.indexOf("--out") + 1])
  : join(root, "hmi-scenarios", "assets", "ours-24.zi");

const basePath = join(root, "fixtures", "cache", "eseverson-hmi", "00_baseline_base.HMI");
if (!existsSync(basePath)) {
  console.error("base fixture missing; run npm run fetch-fixtures");
  process.exit(1);
}
const hmi = new Uint8Array(readFileSync(basePath));
const source = readZi(hmiBlob(hmi, hmiLiveEntries(readHmiDirectory(hmi)).get("0.zi")));
console.log(`origem: ${source.name}/${source.encoding}, ${source.height} px, ${source.glyphs.length} glifos`);

// ---- 1. subset --------------------------------------------------------------
const KEEP = " 0123456789:";
const subset = subsetZi(source, [...KEEP].map((c) => c.charCodeAt(0)), { strict: true });

// ---- 2. re-encode every stream ---------------------------------------------
let reEncoded = 0;
subset.glyphs = subset.glyphs.map((g) => {
  const pixels = decodeZiGlyph(g.data);
  const data = encodeZiGlyph(pixels);
  const back = decodeZiGlyph(data);
  if (back.length !== pixels.length || !back.every((v, i) => v === pixels[i]))
    throw new Error(`U+${g.code.toString(16)}: re-encoding changed the glyph`);
  reEncoded++;
  return { ...g, data };
});

// ---- 3. two glyphs drawn here ----------------------------------------------
const H = source.height;

/** Draws with a function of (x, y) returning an alpha 0..7. */
function draw(code, width, paint) {
  const px = new Uint8Array(width * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < width; x++) px[y * width + x] = paint(x, y) | 0;
  return { code, advance: width, kerningLeft: 0, kerningRight: 0, data: encodeZiGlyph(px), gapBefore: new Uint8Array(0) };
}

// '@' becomes a hollow square with a solid core: every edge is hard, so the
// codec has to choose black and white on its own
const L = 2, R0 = 15, T = 3, B = H - 4; // the frame's four sides
const box = draw(0x40, 18, (x, y) => {
  const inside = x >= L && x <= R0 && y >= T && y <= B;
  if (!inside) return 0;
  const onFrame = x === L || x === R0 || y === T || y === B;
  const core = x >= 7 && x <= 10 && y >= 10 && y <= 13;
  return onFrame || core ? ZI_ALPHA_MAX : 0;
});

// '#' becomes a soft disc, which forces the anti-aliased mode: the alpha falls
// off with the distance from the centre
const R = 7.5;
const disc = draw(0x23, 18, (x, y) => {
  const d = Math.hypot(x - 8.5, y - (H / 2 - 0.5));
  if (d <= R - 1) return ZI_ALPHA_MAX;
  if (d >= R + 1) return 0;
  return Math.max(0, Math.min(ZI_ALPHA_MAX, Math.round(((R + 1 - d) / 2) * ZI_ALPHA_MAX)));
});

subset.glyphs = [...subset.glyphs, box, disc].sort((a, b) => a.code - b.code);
subset.name = "ours24";

const bytes = writeZi(subset);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, bytes);

// ---- report, and check it reads back ---------------------------------------
const again = readZi(bytes);
const map = ziGlyphMap(again);
let pixels = 0;
for (const g of again.glyphs) {
  const n = decodeZiGlyph(g.data).length;
  if (n !== ziBitmapWidth(g) * again.height) throw new Error(`U+${g.code.toString(16)} decodes to ${n}, expected ${ziBitmapWidth(g) * again.height}`);
  pixels += n;
}
console.log(`subconjunto: ${KEEP.length} glifos, ${reEncoded} recodificados por nos`);
console.log(`sintetizados: U+0023 (disco suave, modo 0x${map.get(0x23).data[0].toString(16).padStart(2, "0")}) e U+0040 (quadrado, modo 0x${map.get(0x40).data[0].toString(16).padStart(2, "0")})`);
console.log(`${again.glyphs.length} glifos, ${pixels} pixels, ${bytes.length} bytes -> ${outPath}`);

// ASCII preview of the two drawn glyphs, so a wrong shape is visible here and
// not only after a compile
const SHADE = [" ", ".", ":", "-", "=", "+", "*", "#"];
for (const code of [0x23, 0x40]) {
  const g = map.get(code);
  const w = ziBitmapWidth(g);
  const px = decodeZiGlyph(g.data);
  console.log(`\nU+${code.toString(16).toUpperCase().padStart(4, "0")}  ${w}x${again.height}`);
  for (let y = 0; y < again.height; y++)
    console.log("  |" + Array.from(px.slice(y * w, (y + 1) * w), (a) => SHADE[a]).join("") + "|");
}
