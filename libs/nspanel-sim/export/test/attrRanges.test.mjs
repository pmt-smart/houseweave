// The attribute walls, against what the Editor was measured to refuse.
// Each case names the scenario that produced the verdict.
import test from "node:test";
import assert from "node:assert/strict";
import { checkAttributeRanges, ATTR_RANGES } from "../dist/attrRanges.js";
import { buildComponent, LENIENT } from "../dist/hmiWrite.js";

test("the values the Editor refuses are refused here first", () => {
  const refused = [
    ["CheckBox", { val: 2 }],          // m20
    ["Radio", { val: 2 }],             // m38-radio-val-2
    ["Curve", { ch: 0 }],              // m30
    ["Curve", { ch: 5 }],              // m30
    ["Curve", { dis: 0 }],             // m38-curve-dis-0
    ["Curve", { dis: 4 }],             // m47-curve-dis-4
    ["Curve", { dis: 9 }],             // m32
    ["Curve", { dis: 65535 }],         // m47-curve-dis-65535
    ["GText", { dis: 1 }],             // m30
    ["GText", { tim: 79 }],            // m35-gtext-tim-79
    ["Number", { format: 3 }],         // m20-number-format3
    ["Number", { lenth: 16 }],         // m32-number-lenth-16
    ["Prog", { val: 101 }],            // m20-prog-val101
    ["Timer", { tim: 49 }],            // m30
    ["Timer", { tim: 65535 }],         // m20-timer-tim65535
    ["Zhizhen", { val: 361 }],         // m30
    ["Zhizhen", { wid: 21 }],          // m34
    ["XFloat", { vvs0: 11 }],          // m30
    ["XFloat", { vvs1: 9 }],           // m30-xfloat-vvs1-9
    ["Qrcode", { txt_maxl: 193 }],     // m59-qr-cap-193: 192 is representable, 193 is not
    ["Prog", { sta: 2 }],              // m26-sta2-prog
    ["Qrcode", { sta: 2 }],            // m26-sta2-qrcode
  ];
  for (const [type, values] of refused) {
    assert.throws(() => checkAttributeRanges(type, values, "c1"), RangeError, `${type} ${JSON.stringify(values)} should be refused`);
  }
});

test("the values the Editor accepts go through", () => {
  const accepted = [
    ["CheckBox", { val: 1 }],
    ["Radio", { val: 1 }],
    ["Curve", { ch: 4 }],
    ["Curve", { dis: 10 }],            // the smallest that compiles
    ["Curve", { dis: 1000 }],          // the largest measured
    ["GText", { dis: 2 }],
    ["GText", { tim: 80 }],
    ["Number", { format: 2 }],
    ["Number", { lenth: 15 }],
    ["Number", { lenth: 0 }],          // m38-number-lenth-0
    ["Prog", { val: 100 }],
    ["Timer", { tim: 50 }],
    ["Timer", { tim: 65534 }],
    ["Zhizhen", { val: 360 }],
    ["Zhizhen", { wid: 20 }],
    ["XFloat", { vvs0: 10, vvs1: 8 }],
    ["Qrcode", { txt_maxl: 192 }],     // m59-qr-cap-192: representable, and the budget decides
    ["Text", { sta: 2 }],              // sta 2 was measured accepted on seven types and refused on two; nothing above 2 was ever tried, so nothing above 2 is refused here
    ["Slider", { minval: 0, maxval: 100, val: 50 }],
  ];
  for (const [type, values] of accepted) {
    assert.doesNotThrow(() => checkAttributeRanges(type, values, "c1"), `${type} ${JSON.stringify(values)} should pass`);
  }
});

test("a wall nobody bisected does not become an invented rule", () => {
  // sta 3 refused on the five types m53 tried; the check applies it to the rest
  assert.throws(() => checkAttributeRanges("Text", { sta: 3 }, "t1"), /out of range/);
  assert.doesNotThrow(() => checkAttributeRanges("Text", { sta: 0 }, "t1"));   // m53-text-sta0
  assert.throws(() => checkAttributeRanges("Vari", { sta: 2 }, "v1"), /on a Vari/);  // m53-vari-sta2
  // and the Qrcode capacity has no measured floor: nothing below 10 was built
  assert.doesNotThrow(() => checkAttributeRanges("Qrcode", { txt_maxl: 0 }, "qr0"));
  // 1000 compiles and 1024 refuses, so the wall is somewhere in 1001..1023.
  // The check refuses from 1024 up — what was measured — and lets the gap
  // through, because nobody has shown it fails.
  assert.doesNotThrow(() => checkAttributeRanges("Curve", { dis: 1000 }, "c1"));   // m30-curve-dis-1000
  assert.doesNotThrow(() => checkAttributeRanges("Curve", { dis: 1010 }, "c1"));   // in the gap
  assert.throws(() => checkAttributeRanges("Curve", { dis: 1024 }, "c1"), /out of range/);   // m57-curve-dis-1024
  assert.throws(() => checkAttributeRanges("Curve", { dis: 50000 }, "c1"), /out of range/);
  assert.equal(ATTR_RANGES.Curve.dis.max, 1023);
});

test("our own rules say so in the message", () => {
  // The Editor validates nothing on a Slider (m20), so these are ours.
  assert.throws(() => checkAttributeRanges("Slider", { minval: 100, maxval: 0 }, "h0"), /our rule/);
  assert.throws(() => checkAttributeRanges("Slider", { minval: 0, maxval: 100, val: 200 }, "h0"), /our rule/);
  assert.throws(() => checkAttributeRanges("Slider", { wid: 0 }, "h0"), /our rule/);
});

test("the writer applies the ranges, and lenient mode turns them off for the probes", () => {
  assert.throws(() => buildComponent({ type: "Number", objname: "n1", attributes: { lenth: 16 } }, 1), /out of range/);
  LENIENT.on = true;
  try {
    assert.doesNotThrow(() => buildComponent({ type: "Number", objname: "n1", attributes: { lenth: 16 } }, 1));
  } finally {
    LENIENT.on = false;
  }
});

test("the keyboard binding takes only the two values that compile", () => {
  // m60-key-zero compiles and m54-text-key-1 / m60-key-valid are refused with
  // the same words, whether the page they name exists or not.
  assert.doesNotThrow(() => checkAttributeRanges("Text", { key: 0xff }, "t1"));
  assert.doesNotThrow(() => checkAttributeRanges("Text", { key: 0 }, "t1"));
  assert.throws(() => checkAttributeRanges("Text", { key: 1 }, "t1"), /Lost on-screen keyboard page/);
});

test("the Slider's one measured wall is its mode", () => {
  assert.doesNotThrow(() => checkAttributeRanges("Slider", { mode: 1 }, "h0"));
  assert.throws(() => checkAttributeRanges("Slider", { mode: 2 }, "h0"), /out of range/);
  // and it is the Editor's rule, not ours, so the message must say so
  assert.throws(() => checkAttributeRanges("Slider", { mode: 2 }, "h0"), /the Editor refuses it/);
});
