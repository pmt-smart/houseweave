// The generator refuses what the simulator refuses.
//
// `build-project-hmi.mjs` is the only path that reaches a panel, so it runs
// `core/`'s three-layer funnel as the browser does before it lays anything out.
// A rule that is written down and never run on the path that matters reads as a
// guarantee and is not one.
//
// So these tests do not check that the funnel works -- `core/test/model.test.mjs`
// does that, against the rules themselves. They check that the funnel is WIRED:
// that a document the simulator would paint red does not quietly become bytes.
//
// Each case writes a whole project of its own under `projects/` and deletes it
// in `finally`. Mutating a real one in place can lose an uncommitted edit to a
// `git checkout --`; a copy costs nothing and cannot take anything with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readZi, layoutZiText } from "../dist/index.js";
import { printhFrame } from "../../layout/dist/index.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "..");
const script = join(root, "scripts", "build-project-hmi.mjs");

// Both dist trees the script imports. Built by `npm test` for layout and export;
// `core/dist` is the one this file added a dependency on, so it says so plainly
// instead of failing with ERR_MODULE_NOT_FOUND from inside a spawned process.
const ready =
  existsSync(join(workspace, "layout", "dist", "index.js")) &&
  existsSync(join(workspace, "core", "dist", "index.js"));
const skip = !ready && "run `npm run build --workspace=core --workspace=layout` first";

/**
 * A generated project's tables, as berry/panel_runtime.be reads them: the first
 * line, and each page's and each table's line by the indexes the first one gives,
 * each running to where the next one starts.
 */
function readTables(file) {
  const bytes = readFileSync(file);
  const nl = bytes.indexOf(0x0a);
  const head = JSON.parse(bytes.subarray(0, nl).toString("utf8"));
  const body = bytes.length - nl - 1;
  const starts = [...Object.values(head.pages), ...Object.values(head.tables)].sort((a, b) => a - b);
  assert.equal(starts[0], 0, `${file}: the second line is no page's or table's`);
  assert.equal(bytes[bytes.length - 1], 0x0a, `${file}: the last line is not ended`);
  const lines = (index, kind) => {
    const out = {};
    for (const [name, at] of Object.entries(index)) {
      const stop = starts.find((s) => s > at) ?? body;
      assert.equal(bytes[nl + stop], 0x0a, `${file}: ${name}'s line does not end where the next one starts`);
      out[name] = JSON.parse(bytes.subarray(nl + 1 + at, nl + stop).toString("utf8"));
      assert.equal(out[name][kind], name, `${file}: the index points ${name} at another ${kind}'s line`);
    }
    return out;
  };
  return { head, pages: lines(head.pages, "page"), tables: lines(head.tables, "table") };
}

/** A binding's writes as a list of its targets: its one target, or the list it holds. */
const targetsOf = (w) => (typeof w[0] === "string" ? [w] : w);

/** The real project, as the parsed document the script will read back. */
function donor() {
  return JSON.parse(readFileSync(join(workspace, "projects", "living-room", "project.json"), "utf8"));
}

/**
 * Writes `doc` as project `id`, runs the generator on it, always cleans up --
 * the project directory AND the scenario the run leaves in `hmi-scenarios/`,
 * which is a real output directory a person reads, not a build cache.
 */
function build(id, doc, read, panel = "eu-landscape") {
  const dir = join(workspace, "projects", id);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...doc, id }, null, 2));
    const result = spawnSync(process.execPath, [script, id, panel], { encoding: "utf8" });
    // The scenario is read INSIDE the try, because the `finally` deletes it:
    // a test that wants to look at what was generated cannot wait until after.
    if (read && result.status === 0) {
      result.scenario = JSON.parse(readFileSync(join(root, "hmi-scenarios", `p1-${id}-${panel}.json`), "utf8"));
      result.tables = readTables(join(root, "hmi-scenarios", `p1-${id}-${panel}.jsonl`));
    }
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    for (const ext of [".json", ".runtime.json", ".jsonl"]) {
      rmSync(join(root, "hmi-scenarios", `p1-${id}-${panel}${ext}`), { force: true });
    }
  }
}

test("the project that ships still passes its own funnel", { skip }, () => {
  const r = build("guard-ok", donor());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /reported events: \d+/);
});

test("the display boots at 115200, the rate the ESP32 speaks, and the EU runs joBr99's first line", { skip }, () => {
  // The base's Program.s is the Editor's default, whose baud=9600 left every
  // panel deaf to its ESP32 after a flash. The six committed
  // scenarios are the ones that get compiled, so they are checked too.
  for (const panel of ["eu-landscape", "us-portrait"]) {
    const r = build(`guard-program-${panel}`, donor(), true, panel);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.scenario.program.split("\r\n").filter(Boolean);
    assert.ok(lines.includes("bauds=115200"), lines.join(" | "));
    assert.ok(!lines.some((l) => /^bauds?=(?!115200$)/.test(l)), "no other rate");
    assert.equal(lines.includes("lcd_dev fffb 0002 0000 0020"), panel === "eu-landscape", "joBr99's EU line on the EU only");
    assert.equal(lines.at(-2), "printh 00 00 00 ff ff ff 88 ff ff ff", "the ready message the driver waits for");
    assert.equal(lines.at(-1), "page 0");
    for (const project of ["living-room", "living-room-shadcn", "living-room-tailwind"]) {
      const committed = JSON.parse(readFileSync(join(root, "hmi-scenarios", `p1-${project}-${panel}.json`), "utf8"));
      assert.equal(committed.program, r.scenario.program, `p1-${project}-${panel}.json is regenerated`);
    }
  }
});

test("a box under the housing does not become bytes", { skip }, () => {
  // 460..474 is inside the 480-column grid and outside the 450 the EU glass
  // shows: the Editor compiles it happily, which is exactly why we must not.
  const doc = donor();
  const p = doc.layouts["eu-landscape"].screens[1].place[0];
  p.x = 460;
  p.w = 15;
  const r = build("guard-bezel", doc);
  assert.notEqual(r.status, 0, "the generator accepted a placement behind the bezel");
  assert.match(r.stderr, /behind-the-bezel/);
  // and the refusal carries WHERE it comes from, or nobody can tell a hardware
  // limit from a decision of ours that could be revisited
  assert.match(r.stderr, /hardware, measured in/);
});

test("a box below the theme's own touch minimum does not become bytes", { skip }, () => {
  const doc = donor();
  doc.layouts["eu-landscape"].screens[1].place[0].h = 20;
  const r = build("guard-touch", doc);
  assert.notEqual(r.status, 0, "the generator accepted a target no finger can hit");
  assert.match(r.stderr, /below-touch-minimum/);
});

// A SLOT WHOSE VALUES THE PROJECT HOLDS. Help's title and the Settings rows show
// the `settings.items` labels, so the generator knows every value they will get:
// it sizes them by those, and refuses one that does not fit its box in the
// theme's font -- rather than letting the panel cut it mid-letter.
test("a Settings label too wide for its box does not become bytes", { skip }, () => {
  const doc = donor();
  doc.settings.items[0].label = "Mmmmmmmmmmmmmmmmmmmmmmm";
  const r = build("guard-label", doc);
  assert.notEqual(r.status, 0, "the generator accepted a label the glass would cut");
  assert.match(r.stderr, /"Mmmmmmmmmmmmmmmmmmmmmmm" \(\$(help\.title|list\.rows\.\d+\.label)\) is \d+ px/);
});

// A TEXT COMPILED INTO THE PAGE HAS NOBODY TO FIT IT. A runtime text is cut by
// the runtime, with an ellipsis; a compiled one -- here the sample a title shows
// until the first write -- would be cut by the glass, mid-letter.
test("a compiled text wider than its box does not become bytes", { skip }, () => {
  const doc = donor();
  // capitals, so it is under the project's 40-character rule (39) and still
  // wider than the Home's header: 512 px in the 32 px title font. The Home's
  // title compiles as its sample, the project's word; the list's is the view's,
  // written at run time and fitted then.
  doc.layouts["eu-landscape"].screens.find((s) => s.id === "home").title = "THE GENERAL SETTINGS OF THE LIVING ROOM";
  const r = build("guard-compiled-text", doc);
  assert.notEqual(r.status, 0, "the generator accepted a title the glass would cut mid-letter");
  assert.match(r.stderr, /"THE GENERAL SETTINGS OF THE LIVING ROOM" is \d+ px .* cut it mid-letter/);
});

test("Help's title holds the longest label even where eleven widest letters would not fit", { skip }, () => {
  // US portrait: 226 px of title, 10 of the 32 px font's widest glyph -- and
  // "Live update" is 11 characters in 129 px. By the worst case it would be cut.
  const doc = donor();
  const r = build("guard-help-cap", doc, true, "us-portrait");
  assert.equal(r.status, 0, r.stderr);
  const title = r.scenario.addPages.find((p) => p.name === "help").add.find((c) => c.objname.startsWith("tTitle"));
  const longest = Math.max(...doc.settings.items.map((i) => Buffer.byteLength(i.label, "utf8")));
  assert.ok(title.attributes.txt_maxl >= longest, `txt_maxl ${title.attributes.txt_maxl} < ${longest}`);
});

// HELP IS PARAGRAPHS, BROKEN WHERE IT LANDS. Lines written into the project, cut
// by hand for the 290 px portrait panel, would stop at two thirds of the 420 px
// landscape one's width.
test("Help's body is broken at each layout's own width", { skip }, () => {
  const doc = donor();
  const eu = build("guard-help-wrap", doc, true, "eu-landscape");
  const us = build("guard-help-wrap", doc, true, "us-portrait");
  assert.equal(eu.status, 0, eu.stderr);
  assert.equal(us.status, 0, us.stderr);
  const live = (r) => r.tables.tables.settings.items.find((item) => item[1] === "liveSliderUpdate")[2];
  assert.deepEqual(live(eu), ["Changes the light while dragging the slider, not", "only on release.", "", "Off saves serial traffic."]);
  assert.deepEqual(live(us), ["Changes the light while dragging", "the slider, not only on release.", "", "Off saves serial traffic."]);
});

test("a Help body that breaks into more lines than the screen has does not become bytes", { skip }, () => {
  // five paragraphs pass the parser; the last one takes two lines at 420 px
  const doc = donor();
  doc.settings.items[0].help = ["One.", "Two.", "Three.", "Four.", "A fifth paragraph, long enough to need a second line of its own on the landscape panel."];
  const r = build("guard-help-lines", doc);
  assert.notEqual(r.status, 0, "the generator accepted a Help body the glass would lose the end of");
  assert.match(r.stderr, /the help of "Live update" breaks into 6 lines at 420 px in the body font, and the Help screen shows 5/);
});

test("a project that mixes themes compiles each placement in its own theme, and its runtime targets name it", { skip }, () => {
  // A project may take components
  // of another theme it declares. The Living room's header, from
  // shadcn: its colours, its fonts after lovelace's, and the glyph and texts the
  // runtime writes into it resolved in shadcn's tables, by the tag "@1".
  const FONT_COUNT = 5;
  const doc = donor();
  doc.themes = ["lovelace-jobr99", "shadcn-dark"];
  const home = doc.layouts["eu-landscape"].screens.find((s) => s.id === "home");
  const at = home.place.findIndex((p) => p.component === "lovelace-jobr99/nav-header");
  assert.ok(at >= 0, "the Home has lovelace's header");
  home.place[at] = { ...home.place[at], component: "shadcn-dark/nav-header" };
  const r = build("guard-mixed-themes", doc, true);
  assert.equal(r.status, 0, r.stderr);
  const theme = (id) => JSON.parse(readFileSync(join(workspace, "themes", id, "theme.json"), "utf8"));
  const lovelace = theme("lovelace-jobr99"), shadcn = theme("shadcn-dark");
  const color = (t, id) => t.colors.find((c) => c.id === id).rgb565;
  // the page carries both themes' fonts, the project's own first
  const fonts = r.scenario.addFonts.map((f) => f.file);
  assert.equal(fonts.length, 2 * FONT_COUNT, `both themes' fonts: ${fonts.join(", ")}`);
  assert.ok(fonts.slice(0, FONT_COUNT).every((f) => f.includes("/lovelace-jobr99/")) && fonts.slice(FONT_COUNT).every((f) => f.includes("/shadcn-dark/")), fonts.join(", "));
  // the header's components: shadcn's fonts and colours, which lovelace's would not be
  const page = r.scenario.addPages.find((p) => p.name === "home");
  const header = page.add.filter((c) => /^(tTitle|tAction|tStatus|hTitle|hAction)/.test(c.objname) && c.attributes);
  assert.ok(header.length > 0, `the header's components on home: ${page.add.map((c) => c.objname).join(", ")}`);
  const texts = header.filter((c) => c.attributes.font !== undefined);
  assert.ok(texts.length > 0 && texts.every((c) => c.attributes.font >= FONT_COUNT), `in shadcn's fonts: ${JSON.stringify(texts.map((c) => [c.objname, c.attributes.font]))}`);
  const title = texts.find((c) => c.objname.startsWith("tTitle"));
  assert.equal(title.attributes.pco, color(shadcn, "text-primary"), "in shadcn's text colour");
  assert.notEqual(color(shadcn, "text-primary"), color(lovelace, "text-primary"), "which is not lovelace's");
  // the tables: shadcn's glyphs, colours and advances by its tag, beside lovelace's own
  const head = r.tables.head;
  assert.equal(head.colors["text-primary@1"], color(shadcn, "text-primary"));
  assert.equal(head.colors["text-primary"], color(lovelace, "text-primary"));
  const shadcnRoles = JSON.parse(readFileSync(join(workspace, "themes", "shadcn-dark", "fonts", "icon-roles.generated.json"), "utf8"));
  assert.equal(head.glyphs["confirm@1"], String.fromCodePoint(shadcnRoles.confirm.code), "shadcn's ✓, by its tag");
  // and the header's targets on home end with the tag; nothing of lovelace's does
  const targets = Object.values(r.tables.pages.home.writes).flatMap(targetsOf);
  const tagged = targets.filter((t) => t[t.length - 1] === "@1");
  assert.ok(tagged.length > 0, `a tagged target on home: ${JSON.stringify(targets)}`);
  assert.ok(tagged.every((t) => header.some((c) => c.objname === t[0])), `only the header's: ${JSON.stringify(tagged)}`);
  // the project that mixes nothing has no tag anywhere
  const plain = build("guard-unmixed-themes", donor(), true);
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!JSON.stringify(plain.tables).includes("@1"), "no tag in a project that mixes nothing");
});

test("a malformed document is refused by the parser, not by a crash later", { skip }, () => {
  const doc = donor();
  doc.schemaVersion = 1;
  const r = build("guard-schema", doc);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /schemaVersion/);
});

test("the OK key's frame fits the buffer it is built in", { skip }, () => {
  // The keyboard's OK does not send a constant: it builds the payload on the
  // glass, in `vaSend`, the way a slider does. A slider appends three digits; OK
  // appends THE WHOLE TYPED LINE, so `vaSend` is sized for it and not for the
  // slider -- 48 bytes against a worst case of 87. Nothing would say so: `prints`
  // sends what the buffer holds, and a name cut in half on the wire looks like a
  // name the user typed in half.
  const r = build("guard-frame", donor(), true);
  assert.equal(r.status, 0, r.stderr);
  const kbIn = r.scenario.edits["0.pa"].add.find((c) => c.objname === "kbIn");
  assert.ok(kbIn, "the keyboard's line is a global on the first page");
  for (const page of r.scenario.addPages) {
    const send = page.add.find((c) => c.objname === "vaSend");
    // The code is on the key's Hotspot, not on the Button it draws: the topmost
    // component takes the press (`d3-03-overlap`).
    const ok = page.add.find((c) => c.objname === "mkOK0");
    if (!send || !ok) continue;
    const prefix = ok.events[0].lines.find((l) => l.includes("vaSend.txt=")).match(/"([^"]*)"/)[1];
    const worst = prefix.length + kbIn.attributes.txt_maxl;
    assert.ok(
      worst <= send.attributes.txt_maxl,
      `${page.name}: a full line makes a ${worst}-byte payload and vaSend holds ${send.attributes.txt_maxl}`,
    );
  }
});

// THE DOOR TO THE KEYBOARD, IN EVERY THEME. `onEditTitle` reached the panel on
// lovelace-jobr99 and was dropped in silence by the other two: two keyboard
// pages compiled, 1 408 bytes of glass each, and nothing on any screen opened
// them. The generator refuses a dropped handler now; this pins the other half,
// that the three projects that ship really do carry the long press.
test("every project that ships compiles the long press that opens the keyboard", { skip }, () => {
  for (const id of ["living-room", "living-room-shadcn", "living-room-tailwind"]) {
    const doc = JSON.parse(readFileSync(join(workspace, "projects", id, "project.json"), "utf8"));
    const r = build(`guard-door-${id}`, doc, true);
    assert.equal(r.status, 0, r.stderr);
    const home = r.scenario.addPages.find((p) => p.name === "home");
    const title = home.add.find((c) => c.objname === "mTitle0");
    assert.ok(title, `${id}: the home header has no mTitle0 hotspot`);
    assert.equal(title.type, "Hotspot", `${id}: mTitle0 is a ${title.type}`);
    // and it is the LONG press, not the tap: a header you cannot touch without
    // renaming the screen is worse than one you cannot rename at all. The frame
    // is a printh of pre-encoded bytes, so the check reads them back as text --
    // "text.edit" is the manifest's name for this, and never appears on glass.
    const timer = home.add.find((c) => c.objname === "tmmTitle0");
    assert.ok(timer, `${id}: the long press has no timer`);
    const hex = JSON.stringify(timer.events).match(/printh ([0-9A-F ]+)/)?.[1] ?? "";
    const frame = hex.trim().split(" ").map((b) => String.fromCharCode(parseInt(b, 16))).join("");
    assert.ok(frame.includes("mTitle0,hold"), `${id}: the long press sends ${JSON.stringify(frame)}`);
  }
});

// A NAME WIDER THAN THE FIELD. `maxl` is the SLOT's capacity -- the promise
// that the name fits where it is going -- and the box the typing HAPPENS in is
// another one, in another font. On shadcn-dark and tailwind-slate the header is
// set in the body cut and the keyboard's field in the title cut, so the slot
// holds more than the field can show: 18 against 17 and 18 against 12.
//
// A Nextion Text clips on the right without a word -- measured in the Editor's
// debugger, where 26 "m" in the 440 px field draw exactly the same picture as
// 20 -- and since the caret is a character at the END of the
// line, an overflowing line loses the caret first: the screen stops changing
// while the finger keeps typing.
//
// So the field SLIDES. So the slot keeps its capacity
// and the field shows the tail. What has to hold is that every keyboard page
// really carries the window, and that the window leaves room for the caret.
test("every keyboard field slides, and leaves the caret a place", { skip }, () => {
  for (const id of ["living-room", "living-room-shadcn", "living-room-tailwind"]) {
    const doc = JSON.parse(readFileSync(join(workspace, "projects", id, "project.json"), "utf8"));
    const r = build(`guard-slide-${id}`, doc, true);
    assert.equal(r.status, 0, r.stderr);
    for (const page of ["editboard", "editpad", "editsymbols"]) {
      const add = r.scenario.addPages.find((p) => p.name === page).add;
      const draw = add.find((c) => c.objname === "kbDraw");
      const code = JSON.stringify(draw.events);
      const win = Number(/if\(sys0>(\d+)\)/.exec(code)?.[1] ?? NaN);
      assert.ok(Number.isFinite(win), `${id}/${page}: kbDraw does not compare the line against a window`);
      assert.match(code, /substr /, `${id}/${page}: kbDraw has a window and never takes the tail`);
      // the window has to leave the caret a place, or the caret is what clips
      const field = add.find((c) => c.objname === "kbShow");
      const fits = Math.floor(field.w / widestTypeable(doc.themes[0], "title"));
      assert.equal(win, fits - 1, `${id}/${page}: the window is ${win} in a field that fits ${fits}`);
    }
  }
});

/** The widest typeable glyph of a theme's font role, in pixels. */
function widestTypeable(themeId, role) {
  const doc = JSON.parse(readFileSync(join(workspace, "themes", themeId, "theme.json"), "utf8"));
  const token = doc.fonts.find((f) => f.role === role);
  const font = readZi(new Uint8Array(readFileSync(join(workspace, "themes", themeId, token.file))));
  let widest = 1;
  for (const c of " .0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    widest = Math.max(widest, layoutZiText(font, c).advance);
  }
  return widest;
}

// A narrower keyboard gets a narrower window and keeps the slot's capacity:
// 300 px is just above the 293 the touch minimum permits, so this is the
// smallest keyboard the funnel lets through, not a contrived box.
test("a narrower field narrows the window and leaves the slot alone", { skip }, () => {
  const doc = donor();
  for (const id of ["edit-board", "edit-pad"]) {
    const screen = doc.layouts["eu-landscape"].screens.find((s) => s.id === id);
    screen.place.find((p) => p.component.includes("keyboard")).w = 300;
  }
  const r = build("guard-field", doc, true);
  assert.equal(r.status, 0, r.stderr);
  // Against the same project with its keyboards untouched, not against a
  // number: the number moves for reasons (the width-fit buffer, the line's inset
  // in its field) that have nothing to do with this test's point, which is that a narrower
  // keyboard narrows the window and must not touch a slot ELSEWHERE.
  const baseline = build("guard-field-base", donor(), true);
  assert.equal(baseline.status, 0, baseline.stderr);
  const shown = (res) => Number(/the editing field shows (\d+) characters at a time and slides/.exec(res.stdout)?.[1]);
  assert.ok(shown(r) > 0 && shown(r) < shown(baseline), `the 300 px keyboard shows ${shown(r)} characters, the full one ${shown(baseline)}`);
  const titleOf = (res) => res.scenario.addPages.find((p) => p.name === "home").add.find((c) => c.objname === "tTitle0");
  assert.equal(titleOf(r).attributes.txt_maxl, titleOf(baseline).attributes.txt_maxl, "the slot lost capacity it had room for");
});

// THE KEYBOARD USES EVERY COLUMN ITS PANEL HAS, and the two panels do not have
// the same ones. The EU housing hides its 30 rightmost columns, so the visible
// area is 450x320 and a keyboard there stops at 450; the US portrait unit hides
// nothing, so its keyboard has all 320. The hazard is copying one number to the
// other panel: 450 on the US would be a keyboard wider than the glass, and 320
// on the EU would be a keyboard with 130 unused columns beside it. Neither is
// something the Editor or the verifier has an opinion about -- the first draws
// off-screen and the second just looks cramped.
//
// Whether the EU's dead strip is carried over to a panel that has none: it is not.
test("each panel's keyboard fills that panel's visible area, and not the other one's", { skip }, () => {
  const VISIBLE = { "eu-landscape": { w: 450, h: 320 }, "us-portrait": { w: 320, h: 480 } };
  for (const id of ["living-room", "living-room-shadcn", "living-room-tailwind"]) {
    const doc = JSON.parse(readFileSync(join(workspace, "projects", id, "project.json"), "utf8"));
    for (const [device, seen] of Object.entries(VISIBLE)) {
      for (const screen of doc.layouts[device].screens) {
        for (const place of screen.place.filter((p) => p.component.includes("keyboard"))) {
          assert.deepEqual(
            { x: place.x, y: place.y, w: place.w, h: place.h },
            { x: 0, y: 0, w: seen.w, h: seen.h },
            `${id}/${device}/${screen.id}: the keyboard is ${place.w}x${place.h} at ${place.x},${place.y} on a panel that shows ${seen.w}x${seen.h}`,
          );
        }
      }
    }
  }
});

// THE HOME IS A PLAN (schema 11). Its cards are drawn by the
// runtime, so what the page compiles is the header and the touch: a frame when
// it shows, and the point a finger tapped or held at, built on the glass. These
// are the lines the bench measures on the panel; here they are pinned as written.
test("the Home's plan reports when it shows, and where it was touched", { skip }, () => {
  const r = build("guard-plan", donor(), true);
  assert.equal(r.status, 0, r.stderr);
  const home = r.scenario.addPages.find((p) => p.name === "home");
  // nothing compiled below the header: the plan is the runtime's
  for (const c of home.add) if (c.y !== undefined) assert.ok(c.y + c.h <= 86, `${c.objname} reaches y ${c.y + c.h}`);
  // it shows, and says so from its own load
  const load = home.events.find((e) => e.event === "load").lines;
  assert.deepEqual(load, [printhFrame("ev,home,page,show")]);
  const tc = home.add.find((c) => c.objname === "tcGest");
  const down = tc.events.find((e) => e.event === "down").lines;
  const up = tc.events.find((e) => e.event === "up").lines.join("\n");
  // a press in the plan arms the hold; the header answers its own
  assert.ok(down.includes("if(vaGy.val>=86)") && down.includes("  tmPlan.en=1"), down.join("\n"));
  // the tap: the point it went down at, as one number, framed with a CRC on the glass
  assert.match(up, /sys2=vaGx\.val\*1000\+vaGy\.val\n\s+vaSend\.txt="ev,home,plan,tap,"/);
  assert.match(up, /prints crcval,2/);
  // left and right are reported, not jumped: the carousel is the runtime's
  assert.ok(up.includes(printhFrame("ev,home,page,left")), "the left swipe is a frame");
  assert.ok(up.includes(printhFrame("ev,home,page,right")), "the right swipe is a frame");
  assert.ok(up.includes(printhFrame("ev,home,page,up")) && up.includes(printhFrame("ev,home,page,down")), "up and down are frames too: the runtime opens Wireless and Main settings, through the pattern");
  assert.ok(!up.includes("page settings"), "and the glass jumps to no page of its own: a pattern would show the list for a moment before the lock");
  // a hold that fired owns the release
  assert.ok(up.indexOf("if(vaHeld.val==0)") < up.indexOf("ev,home,plan,tap"), "the held check wraps the tap");
  const timer = home.add.find((c) => c.objname === "tmPlan");
  assert.equal(timer.attributes.tim, 500);
  assert.match(timer.events[0].lines.join("\n"), /vaHeld\.val=1\n\s+sys2=vaGx\.val\*1000\+vaGy\.val\n\s+vaSend\.txt="ev,home,plan,hold,"/);
  // and the runtime knows the page, and what to draw it with: a touch is found
  // in its page's line, and the plan's style is the project's
  const { head: tables, pages } = r.tables;
  assert.deepEqual(pages.home.events["plan,tap"], ["plan.tap", null, true]);
  assert.deepEqual(pages.home.events["page,left"], ["nav.swipe", "left"]);
  assert.deepEqual(pages.home.events["page,down"], ["nav.swipe", "down"]);
  assert.equal(tables.plan_page, "home");
  // the whole visible width, edge to edge: the plan has no side margin
  assert.deepEqual([tables.plan_style.origin, tables.plan_style.area, tables.plan_style.radius], [[0, 86], [450, 234], 6]);
  // and its summary cards' names are fitted with the body font's advances, named and not repeated
  assert.equal(tables.plan_style.advances, "body");
  assert.equal(tables.advances.body.length, 224 * 2);
});

test("on the US the plan is the portrait's whole width", { skip }, () => {
  const r = build("guard-plan-us", donor(), true, "us-portrait");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([r.tables.head.plan_style.origin, r.tables.head.plan_style.area], [[0, 86], [320, 394]]);
});

test("the lock follows the finger on the glass and reports only the dots", { skip }, () => {
  const r = build("guard-lock", donor(), true);
  assert.equal(r.status, 0, r.stderr);
  const lock = r.scenario.addPages.find((p) => p.name === "lock");
  const dots = lock.add.filter((c) => /^tDot\d$/.test(c.objname));
  assert.equal(dots.length, 9, "nine dots");
  // a 234 px pad of 78 px cells under the header: centres 78 apart
  assert.deepEqual([...new Set(dots.map((d) => d.x + d.w / 2))], [147, 225, 303]);
  assert.deepEqual([...new Set(dots.map((d) => d.y + d.h / 2))], [125, 203, 281]);
  // it says when it shows: that is how a wrong pattern is cleared
  assert.deepEqual(lock.events.find((e) => e.event === "load").lines, [printhFrame("ev,lock,page,show")]);
  const tick = lock.add.find((c) => c.objname === "tmGest").events[0].lines.join("\n");
  // the finger within a third of a cell of a centre, as bands: 147 +- 26
  assert.match(tick, /if\(vaLx\.val>=121\)\n\s+\{\n\s+if\(vaLx\.val<=173\)/);
  // a dot reached the first time lights, adds its digit and draws the line to it
  assert.match(tick, /if\(tDot5\.pco!=(\d+)\)\n\s+\{\n\s+tDot5\.pco=\1\n\s+vaPat\.val=vaPat\.val\*10\+5\n\s+if\(vaPx\.val>0\)\n\s+\{\n\s+line vaPx\.val,vaPy\.val,225,203,\1/);
  const tc = lock.add.find((c) => c.objname === "tcGest");
  assert.ok(tc.events.find((e) => e.event === "down").lines.includes("vaPat.val=0"), "a new stroke starts empty");
  const up = tc.events.find((e) => e.event === "up").lines.join("\n");
  assert.match(up, /if\(vaPat\.val>0\)\n\{\n\s+vaSend\.txt="ev,lock,pad1,change,"\n\s+covx vaPat\.val,vaTmp\.txt,0,0/);
  // nine digits fit the scratch the number is written into
  assert.ok(lock.add.find((c) => c.objname === "vaTmp").attributes.txt_maxl >= 9);
  const { head: tables, pages } = r.tables;
  assert.deepEqual(pages.lock.events["pad1,change"], ["lock.try", null, true]);
  assert.deepEqual(pages.lock.events["page,show"], ["lock.show", null]);
  assert.equal(tables.lock_page, "lock");
  assert.deepEqual(targetsOf(pages.lock.writes["$lock.wrong"])[0].slice(0, 3), ["tDot1", "pco", "switch"]);
});

test("on the US the lock's cells are 96 px", { skip }, () => {
  const r = build("guard-lock-us", donor(), true, "us-portrait");
  assert.equal(r.status, 0, r.stderr);
  const lock = r.scenario.addPages.find((p) => p.name === "lock");
  const xs = [...new Set(lock.add.filter((c) => /^tDot\d$/.test(c.objname)).map((d) => d.x + d.w / 2))];
  assert.deepEqual(xs.map((x) => x - xs[0]), [0, 96, 192]);
});

test("no page carries more Timers than a page takes, and the long presses share one where it must", { skip }, () => {
  const r = build("guard-timers-us", donor(), true, "us-portrait");
  assert.equal(r.status, 0, r.stderr);
  for (const page of r.scenario.addPages)
    assert.ok(page.add.filter((c) => c.type === "Timer").length <= 12, `${page.name} has too many Timers`);
  const zone = r.scenario.addPages.find((p) => p.name === "zone");
  const shared = zone.add.find((c) => c.objname === "tmHold");
  assert.ok(shared, "the US zone page shares its long presses");
  const lines = shared.events[0].lines.join("\n");
  assert.match(lines, /^tmHold\.en=0\nif\(vaHold\.val==1\)/);
  // a row: its press arms the shared Timer with its own number, and its release asks the same question
  const row = zone.add.find((c) => c.events?.some((e) => e.event === "down" && e.lines[0] === "vaHold.val=2"));
  assert.deepEqual(row.events.find((e) => e.event === "down").lines, ["vaHold.val=2", "tmHold.en=1"]);
  assert.match(row.events.find((e) => e.event === "up").lines.join("\n"), /^if\(tmHold\.en==1\)\n\{\n  tmHold\.en=0/);
  // and a page that fits keeps its own Timers
  const settings = r.scenario.addPages.find((p) => p.name === "settings");
  assert.equal(settings.add.some((c) => c.objname === "tmHold"), false);
});

test("no page carries an instruction the Nextion compiler refuses", { skip }, () => {
  // `return` is not in the instruction set: "Invalid command:return", the
  // Editor's own compiler, on the Living room's plan. Every page, both panels.
  for (const panel of ["eu-landscape", "us-portrait"]) {
    const r = build(`guard-return-${panel}`, donor(), true, panel);
    assert.equal(r.status, 0, r.stderr);
    for (const page of r.scenario.addPages) {
      const blocks = [...(page.events ?? []), ...page.add.flatMap((c) => c.events ?? [])];
      for (const e of blocks)
        for (const line of e.lines)
          assert.notEqual(line.trim(), "return", `${panel}/${page.name} ${e.event}: return`);
    }
  }
});

// A page is what its screen says it is (schema 12), and not what it happens to hold: the manifest names each page by the
// role, a page with no role is not found, and a role its page cannot back is refused at build time, not found blank on the glass.
test("the manifest finds each page by the role its screen declares, and a role the page cannot back is refused", { skip }, () => {
  const ok = build("guard-roles", donor(), true);
  assert.equal(ok.status, 0, ok.stderr);
  const head = ok.tables.head;
  assert.deepEqual(
    [head.plan_page, head.zone_page, head.detail_page, head.list_page, head.dialog_page, head.qr_page, head.help_page, head.lock_page],
    ["home", "zone", "lightdetail", "settings", "confirm", "qr", "help", "lock"],
    "each page, by its role",
  );
  // the thermostat's: its page, how many lines of words and modes it has, and what each touch on it reports
  assert.deepEqual([head.thermostat_page, head.thermostat_lines, head.thermostat_modes], ["thermostat", 1, 2], "the thermostat's page, its lines and its modes");
  const touches = ok.tables.pages.thermostat.events;
  const reported = Object.fromEntries(Object.values(touches).map((e) => [e[1], e[0]]));
  assert.deepEqual(
    [reported["$thermostat.minus.count"], reported["$thermostat.plus.count"], reported["$thermostat.modes.0.label"], reported["$thermostat.modes.1.label"], touches["page,show"]],
    ["thermostat.count", "thermostat.count", "thermostat.row", "thermostat.row", ["thermostat.show", null]],
    "the - and the +, the modes, and the page that loads, each reporting its own",
  );
  // a page with no role is not found, whatever it holds
  const bare = donor();
  delete bare.layouts["eu-landscape"].screens.find((s) => s.id === "light-detail").role;
  const unfound = build("guard-no-role", bare, true);
  assert.equal(unfound.status, 0, unfound.stderr);
  assert.equal(unfound.tables.head.detail_page, null, "the light's detail, with no role, is no page of the manifest");
  // a role its page cannot back
  const hollow = donor();
  hollow.layouts["eu-landscape"].screens.find((s) => s.id === "help").place[0].bind.title = "$list.title";
  const refused = build("guard-hollow-role", hollow);
  assert.notEqual(refused.status, 0, "a help page with no title to write was accepted");
  assert.match(refused.stderr, /has the role help and none of/);
  // and the zone's, which the runtime writes its device rows to
  const bareZone = donor();
  const zone = bareZone.layouts["eu-landscape"].screens.find((s) => s.id === "zone");
  zone.place = zone.place.filter((p) => !String(p.bind?.label ?? "").startsWith("$zone.rows."));
  const noRows = build("guard-zone-rows", bareZone);
  assert.notEqual(noRows.status, 0, "a zone with no device rows was accepted");
  assert.match(noRows.stderr, /has the role zone and none of/);
  // and the thermostat's, which the runtime writes its target and its lines of words to
  const bareThermostat = donor();
  const thermostat = bareThermostat.layouts["eu-landscape"].screens.find((s) => s.role === "thermostat");
  thermostat.place = thermostat.place.filter((p) => !String(p.bind?.text ?? "").startsWith("$thermostat."));
  const noWords = build("guard-thermostat-words", bareThermostat);
  assert.notEqual(noWords.status, 0, "a thermostat's page with no target nor lines to write was accepted");
  assert.match(noWords.stderr, /has the role thermostat and none of/);
});
