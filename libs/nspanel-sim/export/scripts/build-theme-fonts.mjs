// Builds the .zi files a theme declares, by subsetting the fonts of a
// reference project.
//
//   node scripts/build-theme-fonts.mjs                 # every theme
//   node scripts/build-theme-fonts.mjs lovelace-jobr99
//   node scripts/build-theme-fonts.mjs --check         # verify, write nothing
//
// Why generated and not hand-placed: the fonts that reach the panel have to be
// the fonts the panel already runs, and the full ones are enormous -- the three
// NotoSans of the joBr99 project carry 7120 glyphs each, 6400 of them icons, and
// the 80-pixel bold alone is 2.6 MB. A theme needs the characters its
// components actually draw, so each entry declares a `source` (which font of
// which fixture) and an `include` (which characters), and this writes the
// subset. Adding a character is editing JSON and running this again.
//
// Icons are named, never spelled as codepoints: an `include.icons` entry is a
// Material Design Icons name, resolved through the mapping the joBr99 backend
// itself uses (`reference/joBr99/luibackend/icon_mapping.py`, read as data). On
// this panel an icon IS a glyph, and `berry/light.be` already
// cites that file for the one it sends today -- so the same table is the only
// honest source for the rest.
//
// Needs the fixtures (`npm run fetch-fixtures`). The OUTPUT is versioned, so the
// simulator and the generator work without them.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readHmiDirectory, hmiLiveEntries, hmiBlob, readZi, writeZi, subsetZi, ziGlyphMap,
  decodeZiGlyph, encodeZiGlyph, ziBitmapWidth, derivedGlyph, QUESTION_MARK,
} from "../dist/index.js";
// Build-time only: the vector paths are baked into a tiny generated file, so the
// simulator never carries the seven thousand icons of the package.
import * as mdi from "@mdi/js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "..");
const repo = resolve(workspace, "..", "..");
const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));

/** The MDI name -> codepoint table, straight out of the joBr99 backend. */
function iconTable() {
  const path = join(repo, "reference", "joBr99", "luibackend", "icon_mapping.py");
  if (!existsSync(path)) throw new Error(`icon mapping not found: ${path}`);
  const table = new Map();
  for (const m of readFileSync(path, "utf8").matchAll(/'([^']+)':\s*'(.)'/g)) table.set(m[1], m[2].codePointAt(0));
  if (table.size < 6000) throw new Error(`icon mapping parsed only ${table.size} entries; the file's shape changed`);
  return table;
}

// --- glyphs drawn from other glyphs ---------------------------------------------
//
// A theme may name an icon as "<mdi-name>:<effect>": a glyph no font carries,
// drawn here from the plain one. The plan's "no power" is a lamp's outline,
// dashed, and a theme gets it without anyone drawing it by hand.
//
// Which names are derived, and the code each one gets, is export/src/derivedGlyphs.ts:
// the tests read the same list.
const EFFECTS = { dashed: dashGlyph, "dashed-outline": dashOutlineGlyph, "dashed-silhouette": dashSilhouetteGlyph, question: questionGlyph };
const derivedOf = derivedGlyph;
const ALPHA_MAX = 7;

/** every other sector of a circle around the ink's centre dropped, of a bitmap w wide */
function dashPixels(px, w, height) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < w; x++) if (px[y * w + x] > 0) { sx += x; sy += y; n++; }
  const cx = sx / n, cy = sy / n;
  const sectors = 20;
  const out = new Uint8Array(px.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      const a = Math.atan2(y - cy, x - cx);
      const k = Math.floor(((a + Math.PI) / (2 * Math.PI)) * sectors);
      out[y * w + x] = k % 2 === 0 ? px[y * w + x] : 0;
    }
  }
  return out;
}

/**
 * The glyph with its ink cut into dashes: every other sector of a circle
 * around the ink's centre is dropped. For an outline that is a dashed outline,
 * whatever its shape, and at any size the same number of dashes.
 */
function dashGlyph(glyph, height, code) {
  const w = ziBitmapWidth(glyph);
  const out = dashPixels(decodeZiGlyph(glyph.data, w * height), w, height);
  return { ...glyph, code, data: encodeZiGlyph(out), gapBefore: new Uint8Array(0) };
}

/**
 * For any drawing, solid or not (a plug, a fan, a shutter): the edge of its
 * silhouette, a band of the ink as wide as the font is tall over sixteen along
 * the clear that reaches the glyph's border, broken into dashes by squares as
 * wide as the font is tall over eight, every other one dropped. What the
 * drawing holds inside, a shutter's slats, goes with the dashes: the dashed
 * silhouette is the lamp's own "not there now". The sectors of `dashGlyph` dash
 * a closed outline around its centre, as the lamp's; on a drawing of many
 * strokes they leave a burst of rays, and on a solid one stripes.
 */
function dashOutlineGlyph(glyph, height, code) {
  const w = ziBitmapWidth(glyph);
  return { ...glyph, code, data: encodeZiGlyph(dashedEdge(decodeZiGlyph(glyph.data, w * height), w, height)), gapBefore: new Uint8Array(0) };
}

/**
 * For a drawing of parallel bars open at the sides (a shutter's slats): its
 * silhouette closed first -- the gaps narrower than the font is tall over six
 * filled -- and then its edge dashed as `dashOutlineGlyph` dashes one: a dashed
 * outline of the whole thing, where the bars alone would come out a checkerboard.
 */
function dashSilhouetteGlyph(glyph, height, code) {
  const w = ziBitmapWidth(glyph);
  const px = decodeZiGlyph(glyph.data, w * height);
  const r = Math.max(1, Math.round(height / 12));
  const disk = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) disk.push([dx, dy]);
  const at = (m, x, y) => x >= 0 && y >= 0 && x < w && y < height && m[y * w + x] !== 0;
  const morph = (m, grow) => {
    const o = new Uint8Array(m.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < w; x++) {
        const hit = grow ? disk.some(([dx, dy]) => at(m, x + dx, y + dy)) : disk.every(([dx, dy]) => at(m, x + dx, y + dy));
        o[y * w + x] = hit ? ALPHA_MAX : 0;
      }
    return o;
  };
  const ink = px.map((v) => (v >= 4 ? ALPHA_MAX : 0));
  const closed = morph(morph(ink, true), false);
  return { ...glyph, code, data: encodeZiGlyph(dashedEdge(closed, w, height)), gapBefore: new Uint8Array(0) };
}

/** The edge of a bitmap's silhouette along the clear that reaches its border, broken into squares' dashes */
function dashedEdge(px, w, height) {
  const band = Math.max(1, Math.round(height / 16));
  const square = Math.max(3, Math.round(height / 8));
  // the clear that reaches the border, flooded from it
  const outside = new Uint8Array(px.length);
  const stack = [];
  const seed = (x, y) => { const i = y * w + x; if (px[i] < 4 && !outside[i]) { outside[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, height - 1); }
  for (let y = 0; y < height; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i - x) / w;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < height - 1) seed(x, y + 1);
  }
  const out_ = (x, y) => x < 0 || y < 0 || x >= w || y >= height || outside[y * w + x] === 1;
  const out = new Uint8Array(px.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      if (px[y * w + x] === 0) continue;
      if ((Math.floor(x / square) + Math.floor(y / square)) % 2 !== 0) continue;
      // kept where the outside lies within `band`: the silhouette's edge
      let edge = false;
      for (let dy = -band; dy <= band && !edge; dy++)
        for (let dx = -band; dx <= band && !edge; dx++)
          if (dx * dx + dy * dy <= band * band && out_(x + dx, y + dy)) edge = true;
      out[y * w + x] = edge ? px[y * w + x] : 0;
    }
  }
  return out;
}

/**
 * The glyph with a question mark: the drawing at 70 % in the upper left, the
 * mark (QUESTION_MARK) at 60 % in the lower right, and a pixel of clear around
 * the mark so the two do not run together -- the shape of the lamp's own
 * lightbulb-question, for the kinds whose icon set has none.
 */
function questionGlyph(glyph, height, code, mark) {
  const w = ziBitmapWidth(glyph);
  const base = decodeZiGlyph(glyph.data, w * height);
  const mw = ziBitmapWidth(mark);
  const q = decodeZiGlyph(mark.data, mw * height);
  // a bitmap scaled onto the glyph's own, by sixteen samples a pixel
  const scaled = (src, sw, scale, ox, oy) => {
    const layer = new Float64Array(w * height);
    const N = 4;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let j = 0; j < N; j++) {
          for (let i = 0; i < N; i++) {
            const sx = Math.floor((x + (i + 0.5) / N - ox) / scale), sy = Math.floor((y + (j + 0.5) / N - oy) / scale);
            if (sx >= 0 && sy >= 0 && sx < sw && sy < height) acc += src[sy * sw + sx];
          }
        }
        layer[y * w + x] = acc / (N * N);
      }
    }
    return layer;
  };
  const drawing = scaled(base, w, 0.7, 0, 0);
  const qScale = 0.6;
  const marked = scaled(q, mw, qScale, w - mw * qScale, height - height * qScale);
  const out = new Uint8Array(w * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      // clear around the mark: no ink of the drawing within a pixel of it
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1 && !near; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < height && marked[yy * w + xx] >= 2) near = true;
        }
      const v = Math.max(near ? 0 : drawing[y * w + x], marked[y * w + x]);
      out[y * w + x] = Math.min(ALPHA_MAX, Math.round(v));
    }
  }
  return { ...glyph, code, data: encodeZiGlyph(out), gapBefore: new Uint8Array(0) };
}

/** "U+0020..U+007E" or "U+00B0" -> the codepoints it names. */
function parseRange(text) {
  const m = /^U\+([0-9A-Fa-f]{4,6})(?:\.\.U\+([0-9A-Fa-f]{4,6}))?$/.exec(text.trim());
  if (!m) throw new Error(`bad range "${text}" (want "U+0020" or "U+0020..U+007E")`);
  const from = parseInt(m[1], 16), to = m[2] ? parseInt(m[2], 16) : from;
  if (to < from) throw new Error(`bad range "${text}": it ends before it starts`);
  const out = [];
  for (let c = from; c <= to; c++) out.push(c);
  return out;
}

function wanted(include, icons, doc) {
  const codes = new Set();
  for (const r of include.ranges ?? []) for (const c of parseRange(r)) codes.add(c);
  const names = [...(include.icons ?? [])];
  // `iconRoles` means "whatever the roles ask for", so the role table is the one
  // place an icon is named. A list here as well would be a second place to
  // forget, and the two would drift the first time a role changed.
  if (include.iconRoles) {
    const roles = doc.icons?.roles ?? {};
    if (Object.keys(roles).length === 0) throw new Error("include.iconRoles is set but the theme names no icon roles");
    names.push(...Object.values(roles));
  }
  const derived = [];
  for (const name of names) {
    const d = derivedOf(name);
    const c = icons.get(d ? d.base : name);
    if (c === undefined) throw new Error(`no Material Design Icon called "${d ? d.base : name}"`);
    // a derived glyph is drawn from its base, so the base is cut from the source too
    codes.add(c);
    if (d) derived.push({ ...d, from: c });
  }
  if (codes.size === 0) throw new Error("include selects nothing");
  // what a derived glyph is drawn WITH, and no role names: cut to draw, then
  // left out of the font (the question's mark)
  const helpers = new Set();
  for (const d of derived) {
    if (d.effect !== "question") continue;
    const mark = icons.get(QUESTION_MARK);
    if (mark === undefined) throw new Error(`no Material Design Icon called "${QUESTION_MARK}"`);
    d.mark = mark;
    if (!codes.has(mark)) helpers.add(mark);
  }
  return { codes: [...codes, ...helpers].sort((a, b) => a - b), derived, helpers };
}

function sourceFont(source) {
  const path = join(root, "fixtures", "cache", ...source.fixture.split("/"));
  if (!existsSync(path)) throw new Error(`fixture missing (${source.fixture}); run npm run fetch-fixtures`);
  const bytes = new Uint8Array(readFileSync(path));
  const entry = hmiLiveEntries(readHmiDirectory(bytes)).get(source.entry);
  if (!entry) throw new Error(`${source.fixture} has no entry ${source.entry}`);
  return readZi(hmiBlob(bytes, entry));
}


/**
 * The weight a `.zi` says it is, read off the face name in its own header.
 *
 * Measured names: `NotoSans-Bold`, `NotoSans-Regular`, `noto-sans-24-sp5`. A
 * name with no weight token is Regular -- which is how the Editor's Font Creator
 * writes a subset it cut from the regular face.
 */
function weightOfZiName(name) {
  const n = name.toLowerCase();
  if (/(^|[^a-z])(black|heavy)([^a-z]|$)/.test(n)) return 900;
  if (/(^|[^a-z])extrabold([^a-z]|$)/.test(n)) return 800;
  if (/(^|[^a-z])bold([^a-z]|$)/.test(n)) return 700;
  if (/(^|[^a-z])semibold([^a-z]|$)/.test(n)) return 600;
  if (/(^|[^a-z])medium([^a-z]|$)/.test(n)) return 500;
  if (/(^|[^a-z])light([^a-z]|$)/.test(n)) return 300;
  if (/(^|[^a-z])(extralight|ultralight|thin)([^a-z]|$)/.test(n)) return 200;
  return 400;
}

/** "NotoSans-Bold" and "noto-sans-24-sp5" both normalise to start with notosans. */
const squash = (s) => s.toLowerCase().replace(/[^a-z]/g, "");

let problems = 0;
const dirs = readdirSync(join(workspace, "themes"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && (only.length === 0 || only.includes(d.name)));

for (const d of dirs) {
  const base = join(workspace, "themes", d.name);
  const docPath = join(base, "theme.json");
  if (!existsSync(docPath)) continue;
  const doc = JSON.parse(readFileSync(docPath, "utf8"));
  console.log(`${d.name}`);
  const icons = iconTable();
  /** what each built `.zi` turned out to carry; written out below */
  const carried = {};

  for (const font of doc.fonts ?? []) {
    const out = join(base, ...font.file.split("/"));
    const label = `  ${font.id} ${font.file}`;
    try {
      if (!font.source || !font.include) {
        console.log(`${label}: declared but not generated (no source/include) -- ${existsSync(out) ? "the file is there, unexplained" : "AND THE FILE IS MISSING"}`);
        if (!existsSync(out)) problems++;
        continue;
      }
      const src = sourceFont(font.source);
      const { codes, derived, helpers } = wanted(font.include, icons, doc);
      const have = ziGlyphMap(src);
      const absent = codes.filter((c) => !have.has(c));
      if (absent.length)
        throw new Error(`${font.source.fixture}/${font.source.entry} has no glyph for ${absent.slice(0, 6).map((c) => "U+" + c.toString(16).toUpperCase()).join(", ")}${absent.length > 6 ? ` (+${absent.length - 6})` : ""}`);

      let subset = subsetZi(src, codes, { strict: true });
      if (derived.length) {
        const byCode = ziGlyphMap(subset);
        const extra = derived.map((d) =>
          EFFECTS[d.effect](byCode.get(d.from), subset.height, d.code, d.mark !== undefined ? byCode.get(d.mark) : undefined));
        const kept = subset.glyphs.filter((g) => !helpers.has(g.code));
        subset = { ...subset, glyphs: [...kept, ...extra].sort((a, b) => a.code - b.code) };
      }
      if (subset.height !== font.height) throw new Error(`declared height ${font.height} but the source is ${subset.height}`);
      const declaredPage = font.encoding === "utf-8" ? 0x18 : 0x03;
      if (subset.codePage !== declaredPage)
        throw new Error(`declared encoding ${font.encoding} but the source's code page is 0x${subset.codePage.toString(16)}`);

      // What this `.zi` actually IS, read from its own header rather than from
      // the declaration a second time. The declared weight is checked against
      // it: before this the weight was inferred from the filename, and
      // `tailwind-slate/clock-80.zi` -- NotoSans-Bold inside -- was drawn
      // Regular in the React column because the name says nothing about it.
      const carriedWeight = weightOfZiName(subset.name);
      if (carriedWeight !== font.weight)
        throw new Error(`declares weight ${font.weight} but the .zi is "${subset.name}", which is ${carriedWeight}`);
      carried[font.id] = { ziName: subset.name, weight: carriedWeight, height: subset.height, antiAlias: subset.antiAlias };

      const bytes = writeZi(subset);
      const same = existsSync(out) && Buffer.from(bytes).equals(readFileSync(out));
      if (check) {
        if (!same) { console.log(`${label}: OUT OF DATE (${existsSync(out) ? "differs from" : "missing"}; rerun without --check)`); problems++; }
        else console.log(`${label}: up to date, ${subset.glyphs.length} glyphs, ${bytes.length} bytes`);
        continue;
      }
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
      console.log(`${label}: ${subset.glyphs.length} glyphs, ${bytes.length} bytes${same ? " (unchanged)" : ""} <- ${font.source.fixture}/${font.source.entry}`);
    } catch (e) {
      console.log(`${label}: ${e.message}`);
      problems++;
    }
  }

  // What the typeface TURNED OUT to be, written next to the fonts.
  //
  // The mirror of the icon table below, and there for the same reason: the theme
  // declares the face it asks for ONCE (`typeface.family`), and the face the
  // panel will really draw is a fact about the files, so it is read from them
  // rather than declared a second time. The simulator can then say "asked for
  // Inter, carries NotoSans-Regular" instead of leaving a reader to assume the
  // two agree -- which, for two of the three themes here, they do not, because
  // the only face we have to cut a `.zi` from is the joBr99 project's Noto Sans.
  if (Object.keys(carried).length > 0) {
    const anyFont = (doc.fonts ?? []).find((f) => carried[f.id]);
    const out = join(base, dirname(anyFont.file), "typeface.generated.json");
    const asked = doc.typeface?.family ?? "";
    const families = [...new Set(Object.values(carried).map((c) => c.ziName))];
    const text = JSON.stringify({ asked, fonts: carried, carriedNames: families }, null, 2) + "\n";
    const same = existsSync(out) && readFileSync(out, "utf8") === text;
    if (check) {
      if (!same) { console.log("  typeface.generated.json: OUT OF DATE (rerun without --check)"); problems++; }
      else console.log(`  typeface.generated.json: up to date, asked "${asked}", carries ${families.join(", ")}`);
    } else {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, text);
      console.log(`  typeface.generated.json: asked "${asked}", carries ${families.join(", ")}`);
    }
  }

  // The role table, resolved to codepoints, written next to the fonts.
  //
  // The browser cannot read `icon_mapping.py` -- it lives in `reference/`, not
  // among the assets -- and the theme's document names icons rather
  // than codepoints on purpose: a name is reviewable, `U+E334` is not. So the
  // resolution happens here, once, and the simulator reads the result.
  if (doc.icons?.roles) {
    const iconFont = (doc.fonts ?? []).find((f) => (doc.icons.fonts ?? []).includes(f.id));
    const rolesOut = join(base, dirname(iconFont?.file ?? "fonts/icons.zi"), "icon-roles.generated.json");
    const resolved = {};
    let bad = 0;
    for (const [role, name] of Object.entries(doc.icons.roles)) {
      const d = derivedOf(name);
      const base = d ? d.base : name;
      const code = d ? d.code : icons.get(name);
      if (code === undefined) { console.log(`  icons.roles.${role}: no Material Design Icon called "${name}"`); bad++; continue; }
      // the same icon as a vector path, for the React tree. One tree draws both
      // columns -- the Real one is that tree rasterised and quantised -- so the
      // vector and the glyph have to BE the same icon, not merely similar ones.
      // a derived glyph has no vector of its own: the React column draws its base
      const key = "mdi" + base.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join("");
      const path = mdi[key];
      if (path === undefined) { console.log(`  icons.roles.${role}: @mdi/js has no ${key}`); bad++; continue; }
      resolved[role] = { name, code, path };
    }
    if (bad) problems += bad;
    else {
      const text = JSON.stringify(resolved, null, 2) + "\n";
      const same = existsSync(rolesOut) && readFileSync(rolesOut, "utf8") === text;
      if (check) {
        if (!same) { console.log("  icon-roles.generated.json: OUT OF DATE (rerun without --check)"); problems++; }
        else console.log(`  icon-roles.generated.json: up to date, ${Object.keys(resolved).length} roles`);
      } else {
        mkdirSync(dirname(rolesOut), { recursive: true });
        writeFileSync(rolesOut, text);
        console.log(`  icon-roles.generated.json: ${Object.keys(resolved).length} roles`);
      }
    }
  }
}

if (problems) { console.error(`\n${problems} font(s) not built`); process.exitCode = 1; }
