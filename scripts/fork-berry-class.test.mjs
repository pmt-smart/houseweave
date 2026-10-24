// The fork's Tasmota class, as the firmware builds it: its methods are written in Berry (tasmota_class.be, solidified at build time) and
// listed one by one in C (be_tasmota_lib.c), and a method that is not in the list does not exist on the device. The simulator loads the
// Berry class whole, so it cannot see a missing entry: a method of the rules engine missing from the list (keys_upper) makes
// every rule raise on the device and its boot fall back to the safeboot. This test reads the two files.
//
//   node --test scripts/fork-berry-class.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lib = path.join(repoRoot, "firmware", "tasmota", "lib", "libesp32", "berry_tasmota", "src");
const classBe = path.join(lib, "embedded", "tasmota_class.be");
const libC = path.join(lib, "be_tasmota_lib.c");

/** the methods a Berry class source defines at its own level, outside the comment blocks (#- ... -#) */
export function definedMethods(source) {
  const code = source.replace(/#-[\s\S]*?-#/g, "");
  return [...code.matchAll(/^ {2}(?:static )?def ([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map((m) => m[1]);
}

/** the members the C class lists as closures of the solidified Tasmota class */
export function registeredClosures(source) {
  return [...source.matchAll(/^\s+([A-Za-z_][A-Za-z0-9_]*),\s*(?:static_)?closure\(class_Tasmota_([A-Za-z0-9_]+)_closure\)/gm)].map((m) => [m[1], m[2]]);
}

test("the parsers read a definition and a registration", () => {
  assert.deepEqual(definedMethods("class Tasmota\n  def a(x)\n  end\n  static def b()\n  end\n#-\n  def c()\n-#\n  def d ()\nend"), ["a", "b", "d"]);
  assert.deepEqual(registeredClosures("    a, closure(class_Tasmota_a_closure)\n    b, static_closure(class_Tasmota_b_closure)\n"), [["a", "a"], ["b", "b"]]);
});

test("every method of the fork's tasmota_class.be is listed in be_tasmota_lib.c, under its own closure", { skip: !existsSync(classBe) && "the submodule is not checked out" }, () => {
  const defined = definedMethods(readFileSync(classBe, "utf8"));
  const registered = registeredClosures(readFileSync(libC, "utf8"));
  const names = new Set(registered.map(([name]) => name));
  const missing = defined.filter((d) => !names.has(d));
  assert.deepEqual(missing, [], `methods the device would not have: ${missing.join(", ")}`);
  const wrong = registered.filter(([name, closure]) => name !== closure);
  assert.deepEqual(wrong, [], "a member listed under another method's closure");
});
