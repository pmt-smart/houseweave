// The RAM model against what the Nextion compiler actually printed. Every
// number here was read out of a `<scenario>.compile.txt` produced in the
// sandbox, so a change that breaks one of these breaks agreement with the
// Editor, not with an opinion.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PANEL_RAM, componentRamCost, pageRamCost, globalsRamCost, countProgramInts,
  pageRamVerdict, checkPageRam, curveRamCost, qrcodeReserve,
} from "../dist/ramBudget.js";

const rep = (n, c) => Array.from({ length: n }, () => c);

test("the flat per-type cost is what the compiler measured, one component per empty page", () => {
  // `cost = page - 20`, from the m17 and m26 families.
  const measured = {
    Hotspot: 0, Touchcap: 4, Timer: 4, Vari: 4, Picture: 4,
    Radio: 8, Prog: 8, PictureCrop: 8, CheckBox: 12,
    Number: 24, XFloat: 24, Zhizhen: 24, Slider: 28,
  };
  for (const [type, cost] of Object.entries(measured)) {
    assert.equal(componentRamCost({ type }), cost, type);
    assert.equal(pageRamCost([{ type }]), 20 + cost, `page with one ${type}`);
  }
});

test("the types whose cost is not a constant", () => {
  // Text: align4(10 + txt_maxl), m17-one-text and the m20/m38 sweeps
  assert.equal(pageRamCost([{ type: "Text" }]), 48);                               // m17-one-text
  assert.equal(pageRamCost([{ type: "Text", attributes: { txt_maxl: 255 } }]), 288);   // m20-text-maxl255
  assert.equal(pageRamCost([{ type: "Text", attributes: { txt_maxl: 1000 } }]), 1032); // m20-text-maxl1000
  assert.equal(pageRamCost([{ type: "Text", attributes: { txt_maxl: 3538 } }]), 3568); // m38-text-txt_maxl-3538
  // Qrcode: 20 + 4*floor(txt_maxl/4), m43 sweep plus the ceiling at 154
  assert.equal(pageRamCost([{ type: "Qrcode" }]), 68);                                 // m17-one-qrcode (default 30)
  assert.equal(pageRamCost([{ type: "Qrcode", attributes: { txt_maxl: 10 } }]), 48);    // m43-qr-maxl-10
  assert.equal(pageRamCost([{ type: "Qrcode", attributes: { txt_maxl: 20 } }]), 60);    // m43-qr-maxl-20
  assert.equal(pageRamCost([{ type: "Qrcode", attributes: { txt_maxl: 130 } }]), 168);  // m43-qr-maxl-130
  assert.equal(pageRamCost([{ type: "Qrcode", attributes: { txt_maxl: 154 } }]), 192);  // m34-qrcode-txt_maxl-154
  // GText, Button and ButtonT grow on the Text's body plus a per-type constant
  // (m51, six capacities each). A flat 48 or 24 is those formulas at the
  // template default and nowhere else.
  for (const [maxl, page] of [[4, 64], [10, 68], [20, 80], [40, 100], [100, 160], [250, 308]])
    assert.equal(pageRamCost([{ type: "GText", attributes: { txt_maxl: maxl } }]), page, `GText ${maxl}`);
  for (const type of ["Button", "ButtonT"])
    for (const [maxl, page] of [[4, 40], [10, 44], [20, 56], [40, 76], [100, 136], [250, 284]])
      assert.equal(pageRamCost([{ type, attributes: { txt_maxl: maxl } }]), page, `${type} ${maxl}`);
  // the Vari is the one type whose capacity costs nothing, up to the largest
  // the joBr99 project ships
  for (const maxl of [4, 10, 20, 40, 100, 250, 1935])
    assert.equal(pageRamCost([{ type: "Vari", attributes: { txt_maxl: maxl } }]), 24, `Vari ${maxl}`);
  // a string Vari is a different animal: align4(txt_maxl + 1) + 4. Seven
  // capacities (m51-vari-sta1, m60-vari-str-*, m61-page-varistr-15).
  // 15 and 35 are the capacities that SEPARATE align4(n+1)+4 from the earlier
  // align4(6+n): the other four agree under both, which is how the wrong one
  // survived five points and only failed on the joBr99 project.
  for (const [maxl, page] of [[10, 36], [15, 40], [20, 48], [35, 60], [40, 68], [100, 128], [250, 276]])
    assert.equal(pageRamCost([{ type: "Vari", attributes: { sta: 1, txt_maxl: maxl } }]), page, `Vari string ${maxl}`);
  // and it is the kind joBr99 uses 226 times, so the writer has to see sta
  assert.notEqual(componentRamCost({ type: "Vari", attributes: { sta: 1, txt_maxl: 100 } }), componentRamCost({ type: "Vari", attributes: { txt_maxl: 100 } }));
});

test("the Curve is the only type that depends on its geometry", () => {
  // m30 sweeps the channels at width 120, m48 sweeps the width at one channel
  // and shows the height does not move it at all.
  assert.equal(pageRamCost([{ type: "Curve", w: 120, attributes: { ch: 1 } }]), 228);
  assert.equal(pageRamCost([{ type: "Curve", w: 120, attributes: { ch: 2 } }]), 400);
  assert.equal(pageRamCost([{ type: "Curve", w: 120, attributes: { ch: 3 } }]), 572);
  assert.equal(pageRamCost([{ type: "Curve", w: 120, attributes: { ch: 4 } }]), 744);
  for (const h of [2, 4, 10, 30, 120, 240, 320]) {
    assert.equal(pageRamCost([{ type: "Curve", w: 120, h, attributes: { ch: 1 } }]), 228, `height ${h}`);
  }
  // the whole width sweep at one channel (m48-curve-w*), plus width 120 from m30
  for (const [w, page] of [[2, 76], [4, 80], [8, 84], [16, 92], [32, 116], [64, 156], [100, 204], [120, 228], [160, 280], [240, 384], [320, 488], [400, 592], [480, 696]]) {
    assert.equal(pageRamCost([{ type: "Curve", w, attributes: { ch: 1 } }]), page, `width ${w}`);
  }
  // the per-channel term scales with the width too (m48-curve-w480-ch*)
  assert.equal(pageRamCost([{ type: "Curve", w: 480, attributes: { ch: 2 } }]), 1336);
  assert.equal(pageRamCost([{ type: "Curve", w: 480, attributes: { ch: 4 } }]), 2616);
  assert.equal(curveRamCost(1, 120), 208);
});

test("a whole page: 20 + sum of the costs + 4 every four components", () => {
  // heterogeneous pages, measured
  assert.equal(pageRamCost([{ type: "Text" }, { type: "Number" }, { type: "Timer" }, { type: "Timer" }]), 84);   // m24-two-timers
  assert.equal(pageRamCost([{ type: "Text" }, { type: "Number" }, { type: "Timer" }, { type: "Vari" }]), 84);    // m43-page-mixed-4
  assert.equal(pageRamCost([...rep(5, { type: "Text", attributes: { txt_maxl: 15 } }), { type: "Timer" }, { type: "Vari" }, { type: "Number" }, { type: "Hotspot" }]), 200); // m43-page-mixed-9
  assert.equal(pageRamCost(rep(250, { type: "Vari" })), 1268);                                                   // m27-comps-250
  const thirty = [];
  for (let i = 0; i < 3; i++) thirty.push(...["Text", "Number", "Button", "CheckBox", "Radio", "Prog", "Slider", "XFloat", "Zhizhen", "Qrcode"].map((type) => ({ type })));
  assert.equal(pageRamCost(thirty), 732);                                                                        // m25-thirty-mixed
});

test("a global component leaves nothing in its page but still counts for the per-four term", () => {
  assert.equal(pageRamCost([{ type: "Text", attributes: { vscope: 1 } }]), 20);  // m36-global-text-24
  assert.equal(
    pageRamCost([{ type: "Text" }, { type: "Number" }, { type: "Hotspot" }, { type: "Text", attributes: { txt_maxl: 40, vscope: 1 } }]),
    76,                                                                          // m19-global-text40
  );
});

test("the globals area is 4 plus 4 per Program.s int", () => {
  assert.equal(globalsRamCost(3), 16);   // the Editor's default sys0..sys2
  assert.equal(globalsRamCost(8), 36);   // m46-dir-8ints
  assert.equal(globalsRamCost(20), 84);  // m46-dir-20ints
  assert.equal(globalsRamCost(0), 4);    // m40-no-ints
  assert.equal(countProgramInts("int sys0=0,sys1=0,sys2=0\r\npage 0"), 3);
  assert.equal(countProgramInts("//no globals\r\npage 0"), 0);
  assert.equal(countProgramInts("int a=1\nint b=2,c=3\n"), 3);
});

test("the cut is at 3584 and it is inclusive", () => {
  assert.equal(PANEL_RAM, 3584);
  // m43-cut-3584 compiles at 4+3580; m43-cut-3588 fails at 4+3584
  const fits = pageRamVerdict([{ type: "Text", attributes: { txt_maxl: 3550 } }], 4);
  assert.equal(fits.summary, "4+3580=3584");
  assert.equal(fits.fits, true);
  const over = pageRamVerdict([{ type: "Text", attributes: { txt_maxl: 3554 } }], 4);
  assert.equal(over.summary, "4+3584=3588");
  assert.equal(over.fits, false);
  assert.throws(() => checkPageRam("page0", [{ type: "Text", attributes: { txt_maxl: 3554 } }], 4), /memory overflow 4\+3584=3588/);
});

test("globals are charged to every page, which is what sinks a big Program.s", () => {
  // m47-300ints-84texts: 1204+2456=3660, refused
  const globals = globalsRamCost(300);
  assert.equal(globals, 1204);
  const v = pageRamVerdict(rep(84, { type: "Text", attributes: { txt_maxl: 15 } }), globals);
  assert.equal(v.summary, "1204+2456=3660");
  assert.equal(v.fits, false);
});

test("a Qrcode makes the compiler hold scratch aside, and the reserve steps with the QR version", () => {
  const qr = (maxl) => ({ type: "Qrcode", attributes: { txt_maxl: maxl } });
  const fill = (n) => Array.from({ length: n }, () => ({ type: "Text", attributes: { txt_maxl: 15 } }));
  assert.equal(qrcodeReserve(192), 3382);   // m59-qr-cap-192, deficit 34
  assert.equal(qrcodeReserve(155), 3382);   // m59-qr-155-fill8, deficit 226
  assert.equal(qrcodeReserve(154), 2823);   // m59-qr-154-fill24, deficit 131
  assert.equal(qrcodeReserve(134), 2712);   // version 6: a bound, m59-qr-134-fill24 compiled at 868 + 4
  assert.equal(qrcodeReserve(107), 2712);
  assert.equal(qrcodeReserve(106), null);   // version 5 and under: never forced to fail
  assert.equal(pageRamVerdict([qr(134), ...fill(24)], 4).fits, true);     // m59-qr-134-fill24 compiled
  // each of these reproduces a compiler verdict
  assert.equal(pageRamVerdict([qr(155)], 4).fits, true);                  // m59-qr-cap-155
  assert.equal(pageRamVerdict([qr(192)], 4).fits, false);                 // m59-qr-cap-192
  assert.equal(pageRamVerdict([qr(155)], 16).fits, false);                // m52-qr-155-full
  assert.equal(pageRamVerdict([qr(154), ...fill(8)], 4).fits, true);      // m59-qr-154-fill8
  assert.equal(pageRamVerdict([qr(154), ...fill(24)], 4).fits, false);    // m59-qr-154-fill24
  assert.throws(() => checkPageRam("page0", [qr(155)], 16), /temporary use of QR code/);
});
