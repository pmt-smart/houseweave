#!/usr/bin/env node
// The house's releases, signed: an image cut into the blocks the safeboot takes over the mesh, and every file
// a device takes, with a record of its size and SHA-256 signed by the house's key, which the safeboot and the app check.
//
//   node scripts/ota-release.mjs key                          the house's key: made once, never written over; says its public half
//   node scripts/ota-release.mjs public                       the public half, as the C string ESPNOW_OTA_PUBLIC_KEYS takes
//   node scripts/ota-release.mjs pack <image.bin> [--out dir] an app image, for the mesh and for HTTP: <dir>/<name>/manifest.json and blocks.bin,
//                                                             the blocks one after the other and the manifest saying the length of each
//   node scripts/ota-release.mjs sign <file> [--out dir]      a file that goes whole, over HTTP (the .tft, the .jsonl): <dir>/<file>.sig.json
//   node scripts/ota-release.mjs publish <image.bin>... --to <dir>
//                                                             the house's releases, in the folder the release server serves under /ota:
//                                                             each app image packed at <dir>/<image>.ota, the safeboot image signed as
//                                                             <dir>/houseweave-safeboot.bin, and <dir>/index.json, the build of each, which the
//                                                             OTA row of every node reads, and an app image's SHA-256, by which
//                                                             a neighbour knows the release a node waits for in its safeboot image. Builds' names say the image and
//                                                             the build: tasmota32-houseweave-living-room-us-a91d8b13-319cddad.bin
//
// The key is an Ed25519 key pair in a PEM file OUTSIDE the repository: HOUSEWEAVE_RELEASE_KEY names it, and it is
// ../HouseWeave-keys/release-ed25519.pem beside the repository when nothing does. Its secret half is never printed. Losing it
// means no new release the devices take: keep a copy of the file somewhere safe.
//
// The signed record is what the safeboot's receiver (xdrv_98_5_espnow_ota_receiver.ino) checks, 39 bytes:
//   size(4, LE) blocks(2, LE) block_kb(1) sha256(32)
// and the offer the mesh carries is the record and its 64-byte signature, 103 bytes. A file that goes whole has 0 blocks of 0 KB.
// Each block is 64 KB of the image (the last one shorter), compressed on its own as a raw deflate stream, which the chip's ROM
// inflates: a block lost to a power cut is the most a device takes again.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as signWith, verify as verifyWith } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** the KB of image in a block: the safeboot's ESPNOW_OTA_BLOCK_MAX_KB at most */
export const BLOCK_KB = 64;
/** the bytes the signature covers */
export const RECORD_LEN = 39;
/** the most bytes of JSON Tasmota's parser reads: it keeps a token's place in 11 bits (the sender's ESPNOW_OTA_MANIFEST_MAX) */
export const MANIFEST_MAX = 2047;

/** where the house's key is */
export function keyPath(env = process.env) {
  return env.HOUSEWEAVE_RELEASE_KEY ? resolve(env.HOUSEWEAVE_RELEASE_KEY) : resolve(repo, "..", "HouseWeave-keys", "release-ed25519.pem");
}

/** the 32 bytes of a public key, as the safeboot carries them */
export function rawPublic(key) {
  const der = (key.type === "public" ? key : createPublicKey(key)).export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32);
}

/** the public half as a C string literal, for ESPNOW_OTA_PUBLIC_KEYS */
export function cString(raw) {
  return `"${[...raw].map((b) => "\\x" + b.toString(16).padStart(2, "0")).join("")}"`;
}

/** makes the key pair, refusing to write over one */
export function makeKey(path) {
  if (existsSync(path)) throw new Error(`${path} exists: the house has its key, and a new one would leave every device unable to take a release`);
  mkdirSync(dirname(path), { recursive: true });
  const { privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  return privateKey;
}

export function readKey(path) {
  if (!existsSync(path)) throw new Error(`no key at ${path}: make the house's with \`node scripts/ota-release.mjs key\`, or set HOUSEWEAVE_RELEASE_KEY`);
  return createPrivateKey(readFileSync(path));
}

/** the 39-byte record of a file */
export function record(size, blocks, blockKb, sha256) {
  const r = Buffer.alloc(RECORD_LEN);
  r.writeUInt32LE(size, 0);
  r.writeUInt16LE(blocks, 4);
  r.writeUInt8(blockKb, 6);
  Buffer.from(sha256).copy(r, 7);
  return r;
}

const sha256Of = (data) => createHash("sha256").update(data).digest();

/** an image cut, compressed and signed: what `pack` writes */
export function packImage(image, key, blockKb = BLOCK_KB) {
  const size = blockKb * 1024;
  const chunks = [];
  for (let at = 0; at < image.length; at += size) chunks.push(deflateRawSync(image.subarray(at, at + size), { level: 9 }));
  const sha = sha256Of(image);
  const rec = record(image.length, chunks.length, blockKb, sha);
  const signature = signWith(null, rec, key);
  return {
    manifest: {
      v: 1, size: image.length, sha256: sha.toString("hex"), blockKb, blocks: chunks.map((c) => c.length),
      record: rec.toString("hex"), signature: signature.toString("hex"), offer: Buffer.concat([rec, signature]).toString("hex"),
      publicKey: rawPublic(key).toString("hex"),
    },
    blocks: Buffer.concat(chunks),
  };
}

/** the text of a manifest.json, which a device reads with Tasmota's JSON parser: compact, and refused past what it reads */
export function manifestText(file, manifest) {
  const text = JSON.stringify({ file, ...manifest }) + "\n";
  if (text.length > MANIFEST_MAX) throw new Error(`the manifest of ${file} has ${text.length} bytes, past the ${MANIFEST_MAX} a device reads`);
  return text;
}

/** the name the safeboot image is published under, beside the images' folders */
export const SAFEBOOT_FILE = "houseweave-safeboot.bin";

/** The names the images had in the firmware before HouseWeave's: a node on it looks its image up in the index by its own, so each release of these
 * images is written under the former name too, with "of" saying the image it is, until every node runs a release of the current names */
export const FORMER_IMAGES = {
  "tasmota32-houseweave-living-room-eu": "tasmota32-casainteligente-sala-eu",
  "tasmota32-houseweave-living-room-us": "tasmota32-casainteligente-sala-us",
  "tasmota32-houseweave-bridge": "tasmota32-casainteligente-bridge",
};

/** What a build's file name says (scripts/build-firmware.ps1 names them): of tasmota32-houseweave-living-room-us-a91d8b13-319cddad.bin, the
 * image, its env, and the build as the image's own stamp says it (berry/panel_build.be, PanelBuild.COMMIT), a91d8b13/319cddad; null for a
 * name of another shape */
export function buildOf(name) {
  const m = /^(.+)-([0-9a-f]{7,}\+?|unknown)-([0-9a-f]{8}\+?|unknown)\.bin$/.exec(basename(name));
  return m ? { image: m[1], build: `${m[2]}/${m[3]}` } : null;
}

/** The house's releases in a folder the release server serves: each app image packed at <image>.ota, the safeboot image
 * signed whole as SAFEBOOT_FILE, and index.json, which a device reads to know the build the house has for it and where. The images not
 * given stay as they were. The index, as written */
export function publish(files, dir, key, now = new Date()) {
  mkdirSync(dir, { recursive: true });
  const indexPath = join(dir, "index.json");
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : {};
  index.v = 1;
  index.images ??= {};
  // the time of the house, this machine's: what the screens and the tab say
  const p2 = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}T${p2(now.getHours())}:${p2(now.getMinutes())}`;
  for (const file of files) {
    const b = buildOf(file);
    if (!b) throw new Error(`${basename(file)}: not a build's name, <image>-<commit>-<fork>.bin`);
    const data = readFileSync(file);
    if (b.image.includes("safeboot")) {
      writeFileSync(join(dir, SAFEBOOT_FILE), data);
      writeFileSync(join(dir, SAFEBOOT_FILE + ".sig.json"), JSON.stringify({ file: SAFEBOOT_FILE, ...signFile(data, key) }, null, 2) + "\n");
      index.safeboot = { path: SAFEBOOT_FILE, build: b.build, size: data.length, date };
    } else {
      const { manifest, blocks } = packImage(data, key);
      const folder = join(dir, `${b.image}.ota`);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "blocks.bin"), blocks);
      writeFileSync(join(folder, "manifest.json"), manifestText(basename(file), manifest));
      index.images[b.image] = { path: `${b.image}.ota`, build: b.build, size: data.length, date, sha256: manifest.sha256 };
      if (FORMER_IMAGES[b.image]) index.images[FORMER_IMAGES[b.image]] = { ...index.images[b.image], of: b.image };
    }
  }
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  return index;
}

/** a file that goes whole, signed */
export function signFile(data, key) {
  const sha = sha256Of(data);
  const rec = record(data.length, 0, 0, sha);
  return { v: 1, size: data.length, sha256: sha.toString("hex"), record: rec.toString("hex"), signature: signWith(null, rec, key).toString("hex"), publicKey: rawPublic(key).toString("hex") };
}

/** whether a signed record is a key's, and says these bytes */
export function checks(data, signed, publicRaw) {
  const rec = Buffer.from(signed.record, "hex");
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicRaw)]);
  const pub = createPublicKey({ key: der, format: "der", type: "spki" });
  return verifyWith(null, rec, pub, Buffer.from(signed.signature, "hex")) && rec.readUInt32LE(0) === data.length && rec.subarray(7).equals(sha256Of(data));
}

function main(argv) {
  const [command, file, ...rest] = argv;
  const outAt = rest.indexOf("--out");
  const out = outAt >= 0 ? resolve(rest[outAt + 1]) : null;
  const path = keyPath();
  if (command === "key") {
    const key = makeKey(path);
    console.log(`the house's key is at ${path}: keep a copy of it somewhere safe`);
    console.log(`its public half, for ESPNOW_OTA_PUBLIC_KEYS: ${cString(rawPublic(key))}`);
  } else if (command === "public") {
    console.log(cString(rawPublic(readKey(path))));
  } else if (command === "pack" && file) {
    const image = readFileSync(file);
    const { manifest, blocks } = packImage(image, readKey(path));
    const dir = join(out ?? dirname(resolve(file)), basename(file).replace(/\.bin$/, "") + ".ota");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), manifestText(basename(file), manifest));
    writeFileSync(join(dir, "blocks.bin"), blocks);
    console.log(`${basename(file)}: ${manifest.size} B in ${manifest.blocks.length} blocks of ${manifest.blockKb} KB, ${blocks.length} B compressed, signed: ${dir}`);
  } else if (command === "publish" && file) {
    const toAt = argv.indexOf("--to");
    const files = argv.slice(1, toAt >= 0 ? toAt : undefined);
    if (toAt < 0 || !argv[toAt + 1] || files.length === 0) throw new Error("usage: publish <image.bin>... --to <folder the release server serves>/ota");
    const index = publish(files, resolve(argv[toAt + 1]), readKey(path));
    for (const [image, r] of Object.entries(index.images)) if (!r.of) console.log(`${image}: ${r.build}, ${r.size} B, ${r.date}`);
    console.log(index.safeboot ? `the safeboot image: ${index.safeboot.build}, ${index.safeboot.size} B` : "no safeboot image: a device cannot upgrade over HTTP without one");
  } else if (command === "sign" && file) {
    const signed = signFile(readFileSync(file), readKey(path));
    const target = join(out ?? dirname(resolve(file)), basename(file) + ".sig.json");
    writeFileSync(target, JSON.stringify({ file: basename(file), ...signed }, null, 2) + "\n");
    console.log(`${basename(file)}: ${signed.size} B, signed: ${target}`);
  } else {
    console.error("usage: node scripts/ota-release.mjs key | public | pack <image.bin> [--out dir] | sign <file> [--out dir] | publish <image.bin>... --to <dir>");
    process.exit(2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
