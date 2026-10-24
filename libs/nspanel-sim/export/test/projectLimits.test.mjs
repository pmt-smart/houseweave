// The project ceilings and the references a component makes, against what the
// Editor was measured to refuse.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_COMPONENTS_PER_PAGE, MAX_PAGES, checkComponentCount, checkPageCount,
  checkResourceRefs, projectResourceCounts, checkOnScreen, checkPictureSize,
} from "../dist/projectLimits.js";
import { OUR_RULES } from "../dist/attrRanges.js";
import { editHmiProject, buildComponent, projectGlobalsRam, checkNextionName, checkProgramNameClash, LENIENT } from "../dist/hmiWrite.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cached = (n) => join(root, "fixtures", "cache", "eseverson-hmi", n);
const load = (n) => {
  const b = readFileSync(cached(n));
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
};
// a test that reads a public fixture runs once it is fetched (npm run fetch-fixtures), and is skipped before
const skipWithout = (...names) => !names.every((n) => existsSync(cached(n))) && "fixtures not fetched";

test("the two ceilings are the measured walls", () => {
  // 250 compiles and 251 answers "Too many components." (m27, m31);
  // 251 pages compile and 252 answers "Too many pages." (m31, m47-pages-*)
  assert.equal(MAX_COMPONENTS_PER_PAGE, 250);
  assert.equal(MAX_PAGES, 251);
  assert.doesNotThrow(() => checkComponentCount("page0", 250));
  assert.throws(() => checkComponentCount("page0", 251), /Too many components/);
  assert.doesNotThrow(() => checkPageCount(251));
  assert.throws(() => checkPageCount(252), /Too many pages/);
});

test("a dangling FONT is refused, and that is the Editor's rule", () => {
  const counts = { fonts: 3, pictures: 1 };
  assert.doesNotThrow(() => checkResourceRefs({ font: 2, pic: 0 }, counts, "t1"));  // m50-font-last
  assert.throws(() => checkResourceRefs({ font: 3 }, counts, "t1"), /Invalid Font ID/);   // m50-font-dangling
  assert.throws(() => checkResourceRefs({ font: 40 }, counts, "t1"), /Invalid Font ID/);  // m50-font-far
  // 0xFFFF is the "no picture" sentinel every template carries, not an id
  assert.doesNotThrow(() => checkResourceRefs({ picc: 0xffff, pic1: 0xffff }, { fonts: 0, pictures: 0 }, "t1"));
});

test("a dangling PICTURE is ours, because the Editor compiles it", () => {
  // m50-pic-dangling, m50-picc-dangling, m50-picc-used (sta = 1, so it is drawn)
  // and m50-prog-bpic all compile. What the panel draws is untested.
  const counts = { fonts: 3, pictures: 1 };
  assert.throws(() => checkResourceRefs({ pic: 1 }, counts, "p0"), /our rule; the Editor compiles it/);
  OUR_RULES.on = false;
  try {
    assert.doesNotThrow(() => checkResourceRefs({ pic: 1, picc: 7, bpic: 9 }, counts, "p0"));
    // turning our rules off must NOT turn off the Editor's
    assert.throws(() => checkResourceRefs({ font: 3 }, counts, "t1"), /Invalid Font ID/);
  } finally {
    OUR_RULES.on = true;
  }
});

test("the minimal project really has no resources, so a font reference cannot work there", { skip: skipWithout("23_minimal_project_23.HMI") }, () => {
  const minimal = load("23_minimal_project_23.HMI");
  assert.deepEqual(projectResourceCounts(minimal), { fonts: 0, pictures: 0 });
  assert.throws(
    () => editHmiProject(minimal, { "0.pa": { add: [{ type: "Text", objname: "t1", x: 0, y: 0, w: 60, h: 20, attributes: { font: 0 } }] } }),
    /the project has 0 font\(s\)/,
  );
  // fixture 06 has fonts, so the same component goes in
  const six = load("06_bco_magenta_06.HMI");
  assert.ok(projectResourceCounts(six).fonts > 0);
});

test("a txt longer than its declared capacity is refused, as the Editor's dialog says", () => {
  assert.throws(
    () => buildComponent({ type: "Text", objname: "t1", x: 0, y: 0, w: 60, h: 20, attributes: { txt: "a text of more than fifteen bytes", txt_maxl: 15 } }, 1),
    /the length exceeds the maximum value/,
  );
  // when the caller gives no capacity, the writer raises it instead of refusing
  assert.doesNotThrow(() => buildComponent({ type: "Text", objname: "t1", x: 0, y: 0, w: 60, h: 20, attributes: { txt: "a text of more than fifteen bytes" } }, 1));
});

test("lenient mode turns the ceilings off, because the probes need to be refused by the Editor", () => {
  LENIENT.on = true;
  try {
    assert.doesNotThrow(() => buildComponent({ type: "Text", objname: "t1", x: 0, y: 0, w: 60, h: 20, attributes: { txt: "a text of more than fifteen bytes", txt_maxl: 15 } }, 1));
  } finally {
    LENIENT.on = false;
  }
});

test("everything has to fit the screen, with the Editor's own wording", () => {
  // m44-*-full compile at 480x320 for eight types; m44-*-over (x=460, w=21) all
  // answer `Error:Page:page0 Fail:c1 Position Invalid.`
  assert.doesNotThrow(() => checkOnScreen("c1", 0, 0, 480, 320));
  assert.throws(() => checkOnScreen("c1", 460, 10, 21, 40), /Fail:c1 Position Invalid/);
  assert.throws(() => checkOnScreen("c1", 0, 300, 60, 21), /Position Invalid/);
  assert.throws(() => checkOnScreen("c1", -1, 0, 60, 20), /Position Invalid/);
  assert.throws(() => checkOnScreen("c1", 0, -10, 60, 20), /Position Invalid/);  // m37-y-negative
});

test("and a project's edit that puts a component off the screen is refused the same way", { skip: skipWithout("06_bco_magenta_06.HMI") }, () => {
  const at = (over) => ({ type: "Text", objname: "farRight", x: 0, y: 0, w: 60, h: 20, ...over });
  const six = load("06_bco_magenta_06.HMI");
  assert.throws(() => editHmiProject(six, { "0.pa": { add: [at({ x: 460, w: 21 })] } }), /Position Invalid/);
});

test("the globals area includes the global components, because it is charged to every page", { skip: skipWithout("06_bco_magenta_06.HMI") }, () => {
  // m19-global-text40 reports Global Memory:68 = 4 + 4*3 ints + align4(10+40);
  // leaving the component out gives 16, and the budget check would be that much
  // too generous on EVERY page of the project.
  const six = load("06_bco_magenta_06.HMI");
  const before = projectGlobalsRam(six);
  const withGlobal = editHmiProject(six, {
    "0.pa": { add: [{ type: "Text", objname: "gTxt", x: 0, y: 0, w: 100, h: 30, attributes: { vscope: 1, txt_maxl: 40 } }] },
  });
  assert.equal(projectGlobalsRam(withGlobal) - before, 52);   // align4(10 + 40)
});

test("the picture resolution ceiling is the measured one", () => {
  // 700x880 compiles; 1024x620 answers "Resolution beyond the maximum support range"
  // the pair that actually fixes the constant: 800x776 = 620.800 compiles and
  // 700x890 = 623.000 refuses (m35-pic-*). The older 700x880 / 1024x620 pair
  // brackets it so loosely that a wrong constant would still pass.
  assert.doesNotThrow(() => checkPictureSize(0, 800, 776));
  assert.throws(() => checkPictureSize(0, 700, 890), /Resolution beyond the maximum support range/);
  assert.doesNotThrow(() => checkPictureSize(0, 700, 880));
  assert.throws(() => checkPictureSize(0, 1024, 620), /Resolution beyond the maximum support range/);
});

test("the names the Editor refuses, measured one by one", () => {
  // m49: every one of the ten system variables the campaign knows is refused,
  // for a component and for a page alike, in a dialog at load time.
  for (const n of ["dim", "dims", "baud", "bauds", "sleep", "delay", "bkcmd", "thsp", "sendxy", "RED",
                   "wup", "usup", "ussp", "thup", "recmod", "spax", "crcval"]) {
    assert.throws(() => checkNextionName(n), /refuses to open a project with this name/, n);
  }
  // m49-chr-*: the alphabet is letters, digits and _
  for (const n of ["a.b", "a b", "a$b", "a+b", "a[b", "a/b", ".ab", "a-b"]) {
    assert.throws(() => checkNextionName(n), /Illegal character/, n);
  }
  // these compile
  for (const n of ["_ab", "__", "t1", "T1", "café"]) {
    assert.doesNotThrow(() => checkNextionName(n), n);
  }
  // the two older rules still hold
  assert.throws(() => checkNextionName("9a"), /can not be number/);
  assert.throws(() => checkNextionName("abcdefghijklmno"), /Max Length 14/);
});

// The system variables are an ARRAY. A keyboard naming a key's border after the
// key makes `eq0`, and the Editor answers by refusing to open the whole project
// with a bare "Illegal name" dialog that names nothing. Measured at every index, plus the two that bound the family.
test("eq0 through eq9 are system variables, and eq and eq10 are not", () => {
  for (let i = 0; i < 10; i++) assert.throws(() => checkNextionName(`eq${i}`), /refuses to open/, `eq${i}`);
  for (const n of ["eq", "eq10", "keq0", "eqq0", "Eq0"]) assert.doesNotThrow(() => checkNextionName(n), n);
});

test("a component may not take the name of a Program.s global", () => {
  // m57-sys-sys0: the Editor answers
  // "Global variable definition failed:Conflict with Component name:page0.sys0"
  // because the default Program.s declares int sys0. It is a collision computed
  // from the project, not a reserved word — which is why sys0 is not in the list.
  const program = "int sys0=0,sys1=0,sys2=0\r\npage 0";
  assert.throws(() => checkProgramNameClash("sys0", program), /Conflict with Component name/);
  assert.throws(() => checkProgramNameClash("sys2", program), /Conflict with Component name/);
  assert.doesNotThrow(() => checkProgramNameClash("sys3", program));
  assert.doesNotThrow(() => checkNextionName("sys0"));
  // the forms the parser is documented to read
  assert.throws(() => checkProgramNameClash("a", "int  a = 5   // comment"), /Conflict/);
  assert.doesNotThrow(() => checkProgramNameClash("a", "// int a"));
  assert.doesNotThrow(() => checkProgramNameClash("a", "integer a"));
});
