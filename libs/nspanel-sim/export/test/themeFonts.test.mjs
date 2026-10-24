// The themes' fonts, against what the themes say about them.
//
// This is the layer of the funnel that was missing: `lovelace-jobr99` declared four
// `.zi` files, named a height and an encoding for each, and **none of the files
// existed**. Nothing complained, because parsing a JSON document cannot know
// what is on disk. So the check lives here, where the `.zi` reader is, and it
// runs without the fixture cache -- the generated fonts are versioned, and it is
// exactly them that are being checked.
//
// `scripts/build-theme-fonts.mjs --check` answers the other half (is the
// file still what the current source and include would produce?), which needs
// the fixtures and therefore cannot be a test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { derivedGlyph, isZi, readZi, ziGlyphMap } from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "..");
const repo = resolve(workspace, "..", "..");
const systemsDir = join(workspace, "themes");

const CODE_PAGES = { "utf-8": 0x18, "iso-8859-1": 0x03 };

function iconTable() {
  const path = join(repo, "reference", "joBr99", "luibackend", "icon_mapping.py");
  if (!existsSync(path)) return undefined;
  const table = new Map();
  for (const m of readFileSync(path, "utf8").matchAll(/'([^']+)':\s*'(.)'/g)) table.set(m[1], m[2].codePointAt(0));
  return table;
}

function codepointsOf(range) {
  const m = /^U\+([0-9A-Fa-f]{4,6})(?:\.\.U\+([0-9A-Fa-f]{4,6}))?$/.exec(range);
  assert.ok(m, `bad range ${range}`);
  const from = parseInt(m[1], 16), to = m[2] ? parseInt(m[2], 16) : from;
  const out = [];
  for (let c = from; c <= to; c++) out.push(c);
  return out;
}

const systems = readdirSync(systemsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(systemsDir, d.name, "theme.json")))
  .map((d) => ({ name: d.name, dir: join(systemsDir, d.name), doc: JSON.parse(readFileSync(join(systemsDir, d.name, "theme.json"), "utf8")) }));

test("there is at least one theme to check", () => {
  assert.ok(systems.length > 0, "no theme found");
  assert.ok(systems.some((s) => (s.doc.fonts ?? []).length > 0), "no theme declares a font");
});

for (const system of systems) {
  test(`${system.name}: every declared font is on disk and is what it says it is`, () => {
    for (const font of system.doc.fonts ?? []) {
      const path = join(system.dir, ...font.file.split("/"));
      assert.ok(existsSync(path), `${font.id}: ${font.file} is declared but not there (run scripts/build-theme-fonts.mjs)`);
      const bytes = new Uint8Array(readFileSync(path));
      assert.ok(isZi(bytes), `${font.id}: ${font.file} is not a .zi`);
      const zi = readZi(bytes);
      assert.equal(zi.height, font.height, `${font.id}: declared height ${font.height}, file says ${zi.height}`);
      const page = CODE_PAGES[font.encoding];
      assert.ok(page !== undefined, `${font.id}: unknown encoding "${font.encoding}"`);
      assert.equal(zi.codePage, page, `${font.id}: declared ${font.encoding}, file's code page is 0x${zi.codePage.toString(16)}`);
      assert.ok(zi.glyphs.length > 0, `${font.id}: no glyphs`);
    }
  });

  test(`${system.name}: every character a font declares it includes is really in it`, () => {
    const icons = iconTable();
    for (const font of system.doc.fonts ?? []) {
      if (!font.include) continue;
      const path = join(system.dir, ...font.file.split("/"));
      if (!existsSync(path)) continue; // the test above already failed on this
      const have = ziGlyphMap(readZi(new Uint8Array(readFileSync(path))));
      const missing = [];
      for (const range of font.include.ranges ?? [])
        for (const c of codepointsOf(range)) if (!have.has(c)) missing.push(`U+${c.toString(16).toUpperCase()}`);
      // `iconRoles` means the glyph list comes from the theme's role
      // table, which is the only place an icon is named (build-theme-fonts.mjs)
      const iconNames = [...(font.include.icons ?? [])];
      if (font.include.iconRoles) iconNames.push(...Object.values(system.doc.icons?.roles ?? {}));
      if (icons)
        for (const name of iconNames) {
          // a derived glyph ("lightbulb-outline:dashed") is carried with its base
          const d = derivedGlyph(name);
          const c = icons.get(d ? d.base : name);
          assert.ok(c !== undefined, `${font.id}: no Material Design Icon called "${d ? d.base : name}"`);
          if (!have.has(c)) missing.push(`${name} (U+${c.toString(16).toUpperCase()})`);
          if (d && !have.has(d.code)) missing.push(`${name} (U+${d.code.toString(16).toUpperCase()})`);
        }
      assert.deepEqual(missing, [], `${font.id} is missing ${missing.length} of the characters it declares`);
      // and nothing beyond what was asked for: a subset that quietly carried the
      // whole source font would pass everything above and cost megabytes
      const declared = new Set();
      for (const range of font.include.ranges ?? []) for (const c of codepointsOf(range)) declared.add(c);
      if (icons)
        for (const name of iconNames) {
          const d = derivedGlyph(name);
          declared.add(icons.get(d ? d.base : name));
          if (d) declared.add(d.code);
        }
      assert.equal(have.size, declared.size, `${font.id} carries ${have.size} glyphs but declares ${declared.size}`);
    }
  });
}

test("the icon names resolve through the mapping the panel's own firmware cites", () => {
  const icons = iconTable();
  if (!icons) return; // reference/ not checked out
  assert.ok(icons.size > 6000, `the mapping parsed only ${icons.size} entries; its shape changed`);
  // berry/light.be says it sends U+E334 for 'lightbulb', citing this same file.
  // If that ever stops being true, an icon set built from names is built on sand.
  assert.equal(icons.get("lightbulb"), 0xe334);
});

for (const system of systems) {
  test(`${system.name}: every icon role resolves to a glyph the font actually carries`, () => {
    const icons = iconTable();
    if (!icons) return;
    const set = system.doc.icons;
    assert.ok(set, `${system.name} declares no icon set`);
    // every SIZE, not just one: a component picks the font that fits its box, so
    // a role missing from the 48-pixel set would fall back to a Material icon on
    // exactly the components that have room for a big one
    assert.ok((set.fonts ?? []).length > 1, `${system.name} carries icons at one size only`);
    for (const id of set.fonts) {
      const font = (system.doc.fonts ?? []).find((f) => f.id === id);
      assert.ok(font, `${system.name}: icons.fonts names "${id}", which is not one of its fonts`);
      const path = join(system.dir, ...font.file.split("/"));
      const have = ziGlyphMap(readZi(new Uint8Array(readFileSync(path))));
      for (const [role, name] of Object.entries(set.roles)) {
        const d = derivedGlyph(name);
        const code = d ? d.code : icons.get(name);
        assert.ok(code !== undefined, `${system.name}: role ${role} names "${name}", which is not a Material Design Icon`);
        assert.ok(have.has(code), `${system.name}: role ${role} -> ${name} (U+${code.toString(16).toUpperCase()}) is not in ${font.file}`);
      }
    }
  });
}

test("the themes do not all draw the same icons", () => {
  // The point of more than one theme is more than one LOOK. If every
  // one of them resolved its roles to the same glyphs, the icon set would be
  // decoration.
  const byRole = new Map();
  for (const s of systems) for (const [role, name] of Object.entries(s.doc.icons?.roles ?? {})) {
    if (!byRole.has(role)) byRole.set(role, new Set());
    byRole.get(role).add(name);
  }
  if (systems.length < 2) return;
  const differing = [...byRole.values()].filter((names) => names.size > 1).length;
  assert.ok(differing >= 4, `only ${differing} icon role(s) differ between the themes`);
});

// Every kind that acts has its own "no answer" and "no power",
// drawn by the font generator from the kind's plain
// glyph: a drawing of its own, and not the base again, with the question's mark
// in its lower right and the dashed one lighter than its base. The mark it is
// drawn with is no role's, and the font does not carry it.
test("the kinds' no answer and no power are glyphs of their own, drawn from their base", async () => {
  const { decodeZiGlyph, ziBitmapWidth, QUESTION_MARK } = await import("../dist/index.js");
  const icons = iconTable();
  if (!icons) return;
  const ink = (g, h) => decodeZiGlyph(g.data, ziBitmapWidth(g) * h);
  for (const system of systems) {
    const roles = system.doc.icons.roles;
    for (const id of system.doc.icons.fonts) {
      const font = system.doc.fonts.find((f) => f.id === id);
      const zi = readZi(new Uint8Array(readFileSync(join(system.dir, ...font.file.split("/")))));
      const have = ziGlyphMap(zi);
      assert.ok(!have.has(icons.get(QUESTION_MARK)), `${system.name} ${id}: carries the mark it draws with`);
      for (const kind of ["plug", "switch", "fan", "cover", "thermostat"]) {
        for (const state of ["NoAnswer", "NoPower"]) {
          const d = derivedGlyph(roles[`${kind}${state}`]);
          assert.ok(d, `${system.name}: ${kind}${state} is drawn from a plain glyph`);
          const glyph = have.get(d.code), base = have.get(icons.get(d.base));
          const px = ink(glyph, zi.height), from = ink(base, zi.height);
          const sum = (a) => a.reduce((s, v) => s + v, 0);
          assert.ok(sum(px) > 0 && px.some((v, i) => v !== from[i]), `${system.name} ${id}: ${kind}${state} is a drawing of its own`);
          const w = ziBitmapWidth(glyph);
          if (state === "NoPower") assert.ok(sum(px) < sum(from), `${system.name} ${id}: ${kind}${state}, dashed, is lighter than its base`);
          else {
            // the mark's ink in the lower right quarter, where the base drawing shrinks away from
            let corner = 0;
            for (let y = Math.floor(zi.height * 0.6); y < zi.height; y++) for (let x = Math.floor(w * 0.6); x < w; x++) corner += px[y * w + x];
            assert.ok(corner > 0, `${system.name} ${id}: ${kind}${state} has its mark at the lower right`);
          }
        }
      }
    }
  }
});

// The thermostat has one glyph, the heating coil: lit, unlit and heating
// differ in colour alone, so its two plain roles are the same drawing in every theme and in both icon fonts, and
// the roles that are not plain are drawn from it.
test("the thermostat's lit and unlit are one glyph, the coil, and its other two are drawn from it", async () => {
  const icons = iconTable();
  if (!icons) return;
  for (const system of systems) {
    const roles = system.doc.icons.roles;
    assert.equal(roles.thermostatOn, roles.thermostatOff, `${system.name}: lit and unlit are one glyph`);
    assert.equal(roles.thermostatOn, "heating-coil", `${system.name}: the glyph is the heating coil`);
    for (const role of ["thermostatNoAnswer", "thermostatNoPower"]) {
      assert.equal(derivedGlyph(roles[role]).base, "heating-coil", `${system.name}: ${role} is drawn from the coil`);
    }
    for (const id of system.doc.icons.fonts) {
      const font = system.doc.fonts.find((f) => f.id === id);
      const zi = readZi(new Uint8Array(readFileSync(join(system.dir, ...font.file.split("/")))));
      const have = ziGlyphMap(zi);
      for (const role of ["thermostatOn", "thermostatNoAnswer", "thermostatNoPower"]) {
        const name = roles[role];
        const code = derivedGlyph(name) ? derivedGlyph(name).code : icons.get(name);
        assert.ok(have.has(code), `${system.name} ${id}: carries ${role}, ${name}`);
      }
    }
  }
});
