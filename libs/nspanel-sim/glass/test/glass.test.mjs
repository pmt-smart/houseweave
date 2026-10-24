// The Living room's compiled pages, run by the emulated glass: page 0 as the panel
// boots into it, the plan's own code on a touch, and the frames it prints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Glass, readScenario, fontOf, pictureOf } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const scenarios = join(here, "../../export/hmi-scenarios");

export function livingRoom(project = "p1-living-room-eu-landscape", size = [480, 320]) {
  const json = JSON.parse(readFileSync(join(scenarios, `${project}.json`), "utf8"));
  const hmi = readScenario(json);
  const sent = [];
  const diagnostics = [];
  const glass = new Glass(hmi, {
    width: size[0], height: size[1],
    fonts: hmi.fonts.map((f) => fontOf(readFileSync(join(scenarios, f)))),
    pictures: hmi.pictures.map(pictureOf),
    send: (b) => sent.push(...b),
    onDiagnostic: (m) => diagnostics.push(m),
  });
  return { glass, sent, diagnostics, hmi };
}

/** the 55 BB frames in what the glass sent, as their payloads */
export function frames(bytes) {
  const out = [];
  for (let i = 0; i + 4 < bytes.length; i++) {
    if (bytes[i] !== 0x55 || bytes[i + 1] !== 0xbb) continue;
    const len = bytes[i + 2] | (bytes[i + 3] << 8);
    out.push(String.fromCharCode(...bytes.slice(i + 4, i + 4 + len)));
    i += 3 + len + 2;
  }
  return out;
}

test("the glass powers on into page 0 and says so", () => {
  const { glass, sent, hmi } = livingRoom();
  glass.start();
  assert.equal(glass.page.name, "screensaver");
  assert.deepEqual(sent.slice(0, 10), [0, 0, 0, 0xff, 0xff, 0xff, 0x88, 0xff, 0xff, 0xff]);
  assert.equal(hmi.pages.map((p) => p.name).join(","), "screensaver,home,lightdetail,zone,thermostat,cover,settings,house,mesh,confirm,qr,help,lock,safeboot,editboard,editpad,editsymbols");
});

test("in Protocol Reparse an instruction is data, until the string that leaves it", async () => {
  // measured in the Editor's debugger: after recmod=1, `page home`
  // left the page where it was; after the reserved string and recmod=0 it ran
  const { REPARSE_EXIT } = await import("../dist/index.js");
  const { glass } = livingRoom();
  glass.start();
  const say = (line) => glass.receive(Uint8Array.from([...new TextEncoder().encode(line), 0xff, 0xff, 0xff]));
  say("recmod=1");
  say("page home");
  assert.equal(glass.page.name, "screensaver", "an instruction in Protocol Reparse ran");
  say(REPARSE_EXIT);
  say("recmod=0");
  say("page home");
  assert.equal(glass.page.name, "home");
});

test("cirs and cir draw the Nextion's circles, flat at the four extremes", () => {
  // measured in the Editor's debugger, for every radius from 1 to
  // 24: the half-width of each row of a disc, from its centre up, and a ring's
  // first octant. The picker's dot and ring are 16 and 21 (berry/panel_draw.be)
  const { glass } = livingRoom();
  glass.start();
  const { pixels, width } = glass.frame;
  const lit = (x, y) => pixels[y * width + x] === 0xffff;
  const rows = (cx, cy, r) => Array.from({ length: r + 1 }, (_, dy) => {
    for (let dx = r + 1; dx >= 0; dx--) if (lit(cx + dx, cy - dy)) return dx;
    return -1;
  });
  glass.instruction("fill 0,0,480,320,0");
  glass.instruction("cirs 30,30,5,65535");
  glass.instruction("cirs 90,30,16,65535");
  glass.instruction("cirs 160,30,21,65535");
  assert.deepEqual(rows(30, 30, 5), [5, 5, 4, 3, 2, 1]);
  assert.deepEqual(rows(90, 30, 16), [16, 16, 16, 16, 15, 15, 14, 14, 13, 13, 12, 11, 10, 9, 7, 5, 3]);
  assert.deepEqual(rows(160, 30, 21), [21, 21, 21, 21, 20, 20, 20, 19, 19, 19, 18, 17, 17, 16, 15, 14, 13, 12, 10, 9, 6, 3]);
  glass.instruction("fill 0,0,480,320,0");
  glass.instruction("cir 30,100,8,65535");
  const octant = [];
  for (let x = 0; x <= 8; x++) for (let y = 8; y >= x; y--) if (lit(30 + x, 100 - y)) { octant.push([x, y]); break; }
  assert.deepEqual(octant, [[0, 8], [1, 8], [2, 8], [3, 7], [4, 6], [5, 6]]);
  let ring = 0;
  for (let y = 90; y <= 110; y++) for (let x = 20; x <= 40; x++) ring += lit(x, y) ? 1 : 0;
  assert.equal(ring, 44, "the octant in its eight places, each pixel once, as the debugger lit them");
});

test("outside Protocol Reparse, the reserved string is a word the glass refuses as a variable", async () => {
  // measured in the Editor's debugger: 4 bytes back, "Invalid
  // Variables". A flash starts with the string whatever the mode, and a 0x1A has
  // no NUL to end the driver's search for the comok that follows it
  const { REPARSE_EXIT } = await import("../dist/index.js");
  const { glass, sent } = livingRoom();
  glass.start();
  sent.length = 0;
  glass.receive(Uint8Array.from([...new TextEncoder().encode(REPARSE_EXIT), 0xff, 0xff, 0xff]));
  assert.deepEqual(sent, [0x1a, 0xff, 0xff, 0xff]);
});

test("an instruction writes what it names, and refuses another page's local component", () => {
  const { glass, sent, diagnostics } = livingRoom();
  glass.start();
  glass.instruction("page home");
  assert.equal(glass.page.name, "home");
  assert.ok(frames(sent).includes("ev,home,page,show"), "the page's load says it is up");
  glass.instruction('home.tTitle0.txt="Living room"');
  assert.equal(glass.read("tTitle0.txt"), "Living room");
  sent.length = 0;
  glass.instruction('zone.tLabel6.txt="Hall 1"');
  assert.deepEqual(sent, [0x1a, 0xff, 0xff, 0xff], "invalid variable, as the glass answers it");
  assert.match(diagnostics.at(-1), /not global/);
});

test("a tap on the plan's title runs its own code: the touch said as it lands, a hold's timer, and the tap's frame on release", () => {
  const { glass, sent } = livingRoom();
  glass.start();
  glass.instruction("page home");
  sent.length = 0;
  glass.press(100, 40);
  glass.advance(100);
  glass.release();
  assert.deepEqual(frames(sent), ["ev,home,page,touch", "ev,home,mTitle0,tap"]);
  sent.length = 0;
  glass.press(100, 40);
  glass.advance(600);
  glass.release();
  assert.deepEqual(frames(sent), ["ev,home,page,touch", "ev,home,mTitle0,hold"], "held past 500 ms: the hold, and no tap after it");
});
