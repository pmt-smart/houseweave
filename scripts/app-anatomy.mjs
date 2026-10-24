#!/usr/bin/env node
// Where an app image's flash goes: the bytes of the image, by the part of the firmware they belong to.
//
//   node scripts/app-anatomy.mjs <env>                 the last build of <env> (firmware/tasmota/.pio/build/<env>/firmware.map and .elf)
//   node scripts/app-anatomy.mjs <firmware.map> <firmware.elf>
//
// The image is what the boot loader copies or maps from the app's partition: the code in flash (.flash.text), the constants (.flash.rodata), the
// code in IRAM and its vectors, and the data that starts with a value (.dram0.data). The linker's map says which input file each piece of them came
// from. The ESP-IDF's libraries are precompiled and keep their names (libnet80211.a, liblwip.a, ...); what the build compiles itself goes through
// LTO and comes out as a few ltrans objects with no name of its own: Tasmota, the Arduino core, the libraries, Berry and the fork's C. That part is
// told apart by the names of its symbols (the ELF's symbol table, with their sizes), by the patterns below; what has no symbol (the strings the
// compiler pooled, the padding) is said as such. The brain's classes are the ones berry/*.be marks with "#@ solidify:" (a solidified class leaves
// be_class_<Name> and class_<Name>_<method>_closure symbols; its bytecode and constants are mostly pooled, and scripts/brain-flash.mjs measures
// them whole).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const IMAGE_SECTIONS = [".flash.text", ".flash.rodata", ".iram0.vectors", ".iram0.text", ".dram0.data"];

/** the ESP-IDF's precompiled libraries, by what they are */
const LIBS = [
  [/^lib(net80211|pp|phy|wpa_supplicant|coexist|espnow|mesh|smartconfig|rtc|core|wapi|esp_phy|esp_coex)\.a$/, "Wi-Fi and radio (ESP-IDF blobs)"],
  [/^liblwip\.a$/, "TCP/IP (lwIP)"],
  [/^libmbed(tls|crypto|x509)(_2)?\.a$/, "TLS and crypto (mbedTLS)"],
  [/^lib(bt|btdm_app|nimble|bluedroid)\.a$/, "Bluetooth"],
  [/^lib(c|m|gcc|stdc\+\+|newlib|cxx|pthread)\.a$/, "C and C++ libraries"],
  [/^lib(freertos|esp_system|esp_hw_support|esp_common|heap|soc|hal|spi_flash|driver|esp_timer|vfs|log|esp_event|esp_netif|esp_wifi|nvs_flash|app_update|bootloader_support|efuse|esp_rom|xtensa|esp_ringbuf|esp_partition|esp_mm|esp_pm|esp_app_format|esp_driver_\w+|esp_security|esp_psram|esp_gdbstub|esp_vfs_console|esp_adc|esp_ipc|mbedtls_port)\.a$/, "ESP-IDF system"],
];

/** the LTO part, by symbol name: [pattern, part]; the first that matches */
export function ltoParts(brainClasses) {
  const brain = new RegExp(`^(be_class_|class_|be_local_class_|be_ktab_class_)(${brainClasses.join("|")})(_|$)`);
  return [
    [brain, "the brain (our Berry, solidified)"],
    [/^(be_class_|class_|be_local_class_|be_ktab_class_)(Matter|Mtr)/, "Berry: Matter"],
    [/^(be_class_|class_|be_local_class_)(Animate|Anim)|animat/i, "Berry: animation"],
    [/^(be_class_|class_|be_local_class_|be_ktab_class_)/, "Berry: Tasmota's solidified classes"],
    [/^be_const_str_|^be_const_(long|real|int)_|^m_builtin|^be_map_|^be_const_class/, "Berry: constant strings and tables"],
    [/^lv_|^_lv_|lvgl/i, "LVGL"],
    [/^(be_|m_|vm_|berry|l_|b_|mapping)/i, "Berry: the VM and its modules"],
    [/EspNowMesh|EspNowOta|espnow_mesh|espnow_ota|StaCtrl|Esp32NowMesh|EspNow|_eot_|EspNowDirect/i, "the fork's C (ESP-NOW mesh, OTA, station)"],
    [/Zigbee|Z_|zigbee|ZbSend|Zb[A-Z]/, "Tasmota: Zigbee"],
    [/Matter|matter/, "Tasmota: Matter"],
    [/Nextion|NSPanel|nspanel|Tft|Flh|Nxp/i, "Tasmota and the fork: the display (Nextion, flash of the .tft)"],
    [/Mqtt|PubSub|mqtt/, "Tasmota: MQTT"],
    [/Web|HTTP|Http|http|Html|html|WSContent|Upload|kUpload/, "Tasmota and Arduino: web and HTTP"],
    [/Rule|Script|rule/, "Tasmota: rules"],
    [/Xdrv|Xsns|Xdsp|Xnrg|Xlgt|XdrvMailbox|Cmnd|Settings|Tasmota|kTasmota|S_JSON|ResponseCmnd|Light|Energy|Timer|Sensor|Switch|Button|Gpio|kGpio|Template/, "Tasmota: core and drivers"],
    [/WiFi|Wifi|wifi|ESP8266WiFi|WiFiClient|WiFiUdp|IPAddress|Udp|udp|dns|DNS|mdns|MDNS/, "Arduino and Tasmota: Wi-Fi and networking"],
    [/^_Z|String|Print|Stream|HardwareSerial|Serial|Wire|SPI|esp32|Esp|esp_|nvs|Preferences|LittleFS|FS|File|vfs|uart|i2c|ledc|rmt|pcnt|timer|Ticker/, "Arduino core and the rest of C++"],
  ];
}

/** the input pieces of each image section, by file: {section: {file: bytes}}, from the linker's map */
export function mapPieces(text) {
  const out = {};
  let section = null;
  let pending = null;   // a section name on its own line, its address and size on the next
  for (const line of text.split(/\r?\n/)) {
    const top = /^(\.[\w.]+)\s/.exec(line) || /^(\.[\w.]+)$/.exec(line);
    if (top && !line.startsWith(" ")) {
      section = IMAGE_SECTIONS.includes(top[1]) ? top[1] : null;
      pending = null;
      continue;
    }
    if (!section) continue;
    let m = /^\s+(\S+)\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(.+\.(?:o|obj|a\(.+\)))\s*$/i.exec(line);
    if (!m && pending) {
      const n = /^\s+0x([0-9a-f]+)\s+0x([0-9a-f]+)\s+(.+\.(?:o|obj|a\(.+\)))\s*$/i.exec(line);
      if (n) m = [line, pending, n[1], n[2], n[3]];
    }
    pending = null;
    if (m) {
      const size = parseInt(m[3], 16);
      if (size > 0) {
        out[section] ??= {};
        out[section][m[4]] = (out[section][m[4]] ?? 0) + size;
      }
      continue;
    }
    const alone = /^\s+(\.\S+)\s*$/.exec(line);
    if (alone) pending = alone[1];
  }
  return out;
}

/** a map's input file as a part: an ESP-IDF library by its name, or "lto" for what went through LTO */
export function fileKind(file) {
  if (/ltrans/i.test(file)) return "lto";
  const lib = /([^\\/]+\.a)\(/.exec(file)?.[1] ?? /([^\\/]+\.a)$/.exec(file)?.[1];
  if (lib) {
    for (const [re, part] of LIBS) if (re.test(lib)) return part;
    return `other library: ${lib}`;
  }
  return `object: ${file.split(/[\\/]/).pop()}`;
}

/** the symbols of the ELF with their sizes: [{addr, size, name}] */
export function elfSymbols(nmText) {
  const out = [];
  for (const line of nmText.split(/\r?\n/)) {
    const m = /^([0-9a-f]{8}) ([0-9a-f]{8}) \w (.+)$/i.exec(line);
    if (m) out.push({ addr: parseInt(m[1], 16), size: parseInt(m[2], 16), name: m[3] });
  }
  return out;
}

const kb = (n) => (n / 1024).toFixed(1).padStart(8);

function main() {
  const args = process.argv.slice(2);
  let mapPath, elfPath;
  if (args.length === 1) {
    const dir = join(root, "firmware", "tasmota", ".pio", "build", args[0]);
    mapPath = join(dir, "firmware.map");
    elfPath = join(dir, "firmware.elf");
  } else if (args.length === 2) {
    [mapPath, elfPath] = args;
  } else {
    console.error("usage: node scripts/app-anatomy.mjs <env> | <firmware.map> <firmware.elf>");
    process.exit(2);
  }
  if (!existsSync(mapPath) || !existsSync(elfPath)) {
    console.error(`no ${mapPath} or ${elfPath}: build the env first`);
    process.exit(2);
  }
  const core = process.env.PLATFORMIO_CORE_DIR || "C:\\pio";
  const nm = join(core, "packages", "toolchain-xtensa-esp-elf", "bin", "xtensa-esp32-elf-nm.exe");
  const sizeTool = join(core, "packages", "toolchain-xtensa-esp-elf", "bin", "xtensa-esp32-elf-readelf.exe");
  const sections = {};
  for (const line of spawnSync(sizeTool, ["-SW", elfPath], { encoding: "utf8", maxBuffer: 1 << 26 }).stdout.split(/\r?\n/)) {
    const m = /\]\s+(\.[\w.]+)\s+\w+\s+([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)/.exec(line);
    if (m && IMAGE_SECTIONS.includes(m[1])) sections[m[1]] = { addr: parseInt(m[2], 16), size: parseInt(m[3], 16) };
  }
  const pieces = mapPieces(readFileSync(mapPath, "utf8"));
  const brainClasses = [];
  for (const f of readdirSync(join(root, "berry")).filter((n) => n.endsWith(".be"))) {
    for (const m of readFileSync(join(root, "berry", f), "utf8").matchAll(/#@ solidify:(\w+)/g)) brainClasses.push(m[1]);
  }
  const rules = ltoParts([...new Set(brainClasses)]);
  const symbols = elfSymbols(spawnSync(nm, ["-S", "--defined-only", "-C", elfPath], { encoding: "utf8", maxBuffer: 1 << 28 }).stdout);
  const total = Object.values(sections).reduce((s, x) => s + x.size, 0);
  console.log(`the image: ${total} bytes (${(total / 1024).toFixed(1)} KB)`);
  for (const [name, s] of Object.entries(sections)) console.log(`  ${name.padEnd(16)} ${kb(s.size)} KB`);
  const parts = {};
  const add = (part, section, n) => {
    parts[part] ??= { total: 0 };
    parts[part].total += n;
    parts[part][section] = (parts[part][section] ?? 0) + n;
  };
  for (const [section, files] of Object.entries(pieces)) {
    const s = sections[section];
    let lto = 0;
    for (const [file, n] of Object.entries(files)) {
      const kind = fileKind(file);
      if (kind === "lto") lto += n;
      else add(kind, section, n);
    }
    // the LTO part of this section, by its symbols' names
    let named = 0;
    for (const sym of symbols) {
      if (!s || sym.addr < s.addr || sym.addr >= s.addr + s.size) continue;
      const part = rules.find(([re]) => re.test(sym.name))?.[1];
      if (!part) continue;
      add(part, section, sym.size);
      named += sym.size;
    }
    if (lto > named) add("LTO, with no symbol said by name (pooled strings and constants, other code)", section, lto - named);
  }
  console.log("\nby part, KB (text = code in flash, rodata = constants, iram = code in RAM, data = initial data):");
  const short = { ".flash.text": "text", ".flash.rodata": "rodata", ".iram0.text": "iram", ".iram0.vectors": "iram", ".dram0.data": "data" };
  for (const [part, p] of Object.entries(parts).sort((a, b) => b[1].total - a[1].total)) {
    const detail = Object.entries(p).filter(([k]) => k !== "total").map(([k, v]) => `${short[k]} ${(v / 1024).toFixed(1)}`).join(", ");
    console.log(`${kb(p.total)}  ${part}  (${detail})`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
