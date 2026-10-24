// The safeboot's page, as every shipped project compiles it. The safeboot image draws it over the screen's
// serial with neither Berry nor the manifest, addressing each component by the name the placement order gives it
// (firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_98_6_espnow_ota_display.ino): a theme or a template that renamed one
// would leave the panel's safeboot writing to nothing, with nothing to say so. This holds the six scenarios, the files the
// `.tft` is compiled from, to the names, the types, the room for what the safeboot writes, and the frames it reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspace = resolve(root, "..");
const ready = existsSync(join(workspace, "layout", "dist", "index.js"));
const skip = !ready && "run `npm run build --workspace=layout` first";
const layout = ready ? await import("../../layout/dist/index.js") : null;

const projects = readdirSync(join(workspace, "projects")).filter((id) => !id.startsWith("guard-") && existsSync(join(workspace, "projects", id, "project.json")));

// what the safeboot writes, at the most: ESPNOW_OTA_DISPLAY_TEXT_MAX and ESPNOW_OTA_DISPLAY_CODE_MAX
const TEXT_MAX = 40;
const CODE_MAX = 64;

function safebootPage(id, device) {
  const file = join(root, "hmi-scenarios", `p1-${id}-${device}.json`);
  assert.ok(existsSync(file), `${file} is the scenario the .tft is compiled from`);
  const page = JSON.parse(readFileSync(file, "utf8")).addPages.find((p) => p.name === "safeboot");
  assert.ok(page, `${id}/${device} has the safeboot page`);
  return page;
}

test("the safeboot page's components are named as the safeboot addresses them, on every project and panel", { skip }, () => {
  assert.ok(projects.length >= 3, "the three shipped projects");
  for (const id of projects) {
    for (const device of ["eu-landscape", "us-portrait"]) {
      const page = safebootPage(id, device);
      const drawn = page.add.filter((c) => c.x !== undefined && c.type !== "Timer" && c.type !== "Vari" && c.type !== "Touchcap");
      assert.deepEqual(drawn.map((c) => c.objname), [...layout.SAFEBOOT_NAMES], `${id}/${device}: the names, in order`);
      for (const c of drawn) {
        const type = c.objname.startsWith("qCode") ? "Qrcode" : c.objname.startsWith("bRow") ? "Button" : "Text";
        assert.equal(c.type, type, `${id}/${device}: ${c.objname} is a ${type}`);
      }
      for (const c of drawn.filter((c) => c.objname !== "t3")) {
        const room = Number(c.attributes?.txt_maxl);
        assert.ok(room >= (c.type === "Qrcode" ? CODE_MAX : TEXT_MAX), `${id}/${device}: ${c.objname} holds ${room} bytes, under what the safeboot writes`);
      }
      const qr = drawn.find((c) => c.type === "Qrcode");
      assert.ok(Number(qr.attributes.txt_maxl) < 107, `${id}/${device}: the QR holds no page RAM back`);
    }
  }
});

test("the safeboot page says when it is up, and its buttons report their taps", { skip }, () => {
  for (const id of projects) {
    for (const device of ["eu-landscape", "us-portrait"]) {
      const text = JSON.stringify(safebootPage(id, device));
      for (const payload of ["ev,safeboot,page,show", "ev,safeboot,bRow12,tap", "ev,safeboot,bRow13,tap"])
        assert.ok(text.includes(layout.printhFrame(payload)), `${id}/${device}: the page sends ${payload}`);
    }
  }
});
