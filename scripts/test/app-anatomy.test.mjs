// Where an app image's flash goes (scripts/app-anatomy.mjs): the linker map read by input file, a file told as an ESP-IDF library or the
// LTO part, and the ELF's symbols, with the patterns the LTO part is split by.
import { test } from "node:test";
import assert from "node:assert/strict";
import { elfSymbols, fileKind, ltoParts, mapPieces } from "../app-anatomy.mjs";

const MAP = [
  ".flash.text     0x400d0020    0xed8f8",
  "                0x400d0020                        _stext = .",
  " .literal       0x400d0020      0x7d0 C:\\Temp\\cc4zzj5M.ltrans0.ltrans.o",
  "                               0x187c (size before relaxing)",
  " .text.wifi_tx",
  "                0x400d1000      0x120 C:\\pio\\esp32\\lib\\libnet80211.a(ieee80211_output.o)",
  " .text          0x400d2000       0x40 C:\\pio\\esp32\\lib\\libfatfs.a(ff.o)",
  ".flash.rodata   0x3f400120    0xfe660",
  " .rodata.str1.1",
  "                0x3f400120        0x0 C:\\Temp\\cc4zzj5M.ltrans0.ltrans.o",
  " .rodata        0x3f400120      0x9ec C:\\Temp\\cc4zzj5M.ltrans0.ltrans.o",
  ".debug_info     0x00000000   0x5c5000",
  " .debug_info    0x00000000      0x100 C:\\Temp\\cc4zzj5M.ltrans0.ltrans.o",
].join("\n");

test("the map, by image section and input file: a piece on one line or on two, the empty ones left out, and no section that is not the image's", () => {
  assert.deepEqual(mapPieces(MAP), {
    ".flash.text": { "C:\\Temp\\cc4zzj5M.ltrans0.ltrans.o": 0x7d0, "C:\\pio\\esp32\\lib\\libnet80211.a(ieee80211_output.o)": 0x120,
      "C:\\pio\\esp32\\lib\\libfatfs.a(ff.o)": 0x40 },
    ".flash.rodata": { "C:\\Temp\\cc4zzj5M.ltrans0.ltrans.o": 0x9ec },
  });
});

test("a file as a part: the LTO objects, an ESP-IDF library by what it is, another library by its name", () => {
  assert.equal(fileKind("C:\\Temp\\cc4zzj5M.ltrans3.ltrans.o"), "lto");
  assert.equal(fileKind("C:\\pio\\lib\\libnet80211.a(ieee80211_output.o)"), "Wi-Fi and radio (ESP-IDF blobs)");
  assert.equal(fileKind("C:\\pio\\lib\\liblwip.a(tcp.o)"), "TCP/IP (lwIP)");
  assert.equal(fileKind("C:\\pio\\lib\\libfatfs.a(ff.o)"), "other library: libfatfs.a");
});

test("the symbols with their sizes, and the LTO part by name: the brain's classes before Tasmota's", () => {
  const syms = elfSymbols("3f4becd8 00000018 d be_class_PanelUi\n3f4ae4f4 00000014 d class_PanelUi_act_closure\n400d2e88 00000010 T loop\n0036c337 N \n");
  assert.deepEqual(syms.map((s) => s.name), ["be_class_PanelUi", "class_PanelUi_act_closure", "loop"]);
  const rules = ltoParts(["PanelUi", "HouseMesh"]);
  const part = (name) => rules.find(([re]) => re.test(name))?.[1];
  assert.equal(part("class_PanelUi_act_closure"), "the brain (our Berry, solidified)");
  assert.equal(part("be_class_Tasmota"), "Berry: Tasmota's solidified classes");
  assert.equal(part("be_const_str_PanelUi"), "Berry: constant strings and tables");
  assert.equal(part("EspNowMeshTable"), "the fork's C (ESP-NOW mesh, OTA, station)");
});
