// Host test of xdrv_98_5_espnow_ota_receiver.ino and xdrv_98_6_espnow_ota_display.ino: the receiver and its page on the display, compiled on a
// host over stand-ins (host_stubs.h), driven by frames the test makes as a neighbour would, and by what the display says back. Run it with run.mjs (see README.md): it compiles this file with the emscripten SDK and runs the result with node.
#include "host_stubs.h"
#include <JsonParser.h>                                            // the fork's, which reads the releases' manifests
// The keys the build carries: one that signs nothing here, then RFC 8032's first test key, which signs the images of the tests
#define ESPNOW_OTA_PUBLIC_KEYS \
  "\x3d\x40\x17\xc3\xe8\x43\x89\x5a\x92\xb7\x0a\xa7\x4d\x1b\x7e\xbc\x9c\x98\x2c\xcf\x2e\xc4\x96\x8c\xc0\xcd\x55\xf1\x2a\xf4\x66\x0c" \
  "\xd7\x5a\x98\x01\x82\xb1\x0a\xb7\xd5\x4b\xfe\xd3\xc9\x64\x07\x3a\x0e\xe1\x72\xf3\xda\xa6\x23\x25\xaf\x02\x1a\x68\xf7\x07\x51\x1a"
#include "xdrv_98_5_espnow_ota_receiver.ino"
#include "xdrv_98_6_espnow_ota_display.ino"

// The mesh driver (xdrv_98_1), as much of it as the sender takes: its radio, the radio's lock, its peers and its record
#define USE_ESPNOW_MESH
#define USE_ESPNOW_OTA
// the safeboot image the build pins, as a factory image's: here the fixture's app image (run.mjs, image.bin), apart from the safeboot image
// the installs write, so that each way EspNowOtaArm knows one is tested by itself
#define ESPNOW_OTA_SAFEBOOT_SIZE 200000
#define ESPNOW_OTA_SAFEBOOT_SHA256 "03f4e53dc2e96f9a2904a555fc4b4fa6425f4076078af910f4e7c93933b0dbe7"
// and its signed record (200 000 bytes, 0 blocks of 0 KB, that SHA-256), under RFC 8032's first test key, which the app keeps
#define ESPNOW_OTA_SAFEBOOT_RECORD "400d030000000003f4e53dc2e96f9a2904a555fc4b4fa6425f4076078af910f4e7c93933b0dbe7"
#define ESPNOW_OTA_SAFEBOOT_SIGNATURE \
  "224c503cd9f96666f5607d36d0b97d472e9f6a81fa9778b9bfb0c15d453f713076758c398c1ba5133951fdb52b46ee5288c0affd060b04257717b673ea65fb07"
struct { bool radio = true; bool radio_lost = false; } EspNowMeshDriver;
struct { uint8_t id; uint8_t has_group; uint8_t group_version; uint8_t group_key[32]; } EspNowMeshSettings;
static int g_radio_takes = 0;
static bool EspNowMeshRadioTake(uint32_t) { g_radio_takes++; return true; }
static void EspNowMeshRadioGive(void) {}
static bool EspNowMeshAddPeer(const uint8_t* to, uint32_t) {
  for (auto& p : g_peers) { if (p == mac_hex(to)) { return true; } }
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, to, 6);
  esp_now_add_peer(&peer);
  return true;
}
#include "xdrv_98_7_espnow_ota_sender.ino"

static int g_failures = 0;
static int g_checks = 0;
#define CHECK(cond, what) do { g_checks++; if (!(cond)) { g_failures++; printf("FAIL %s  (line %d)\n", what, __LINE__); } } while (0)
static bool logged(const char* part) { for (auto& l : g_log) { if (l.find(part) != std::string::npos) { return true; } } return false; }

typedef std::vector<uint8_t> Bytes;
static Bytes from_hex(const char* h) { Bytes b; for (size_t i = 0; h[i] && h[i + 1]; i += 2) { unsigned v; sscanf(h + i, "%2x", &v); b.push_back((uint8_t)v); } return b; }
static void put32(Bytes& b, uint32_t v) { for (int i = 0; i < 4; i++) { b.push_back((uint8_t)(v >> (8 * i))); } }
static void put16(Bytes& b, uint16_t v) { b.push_back((uint8_t)v); b.push_back((uint8_t)(v >> 8)); }
static uint32_t get32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint16_t get16(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }

// --- Ed25519, signing as RFC 8032 says, on the same field and group code the receiver verifies with -----------------------------------------
static const Bytes kSeed = from_hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");      // RFC 8032, test 1
static const Bytes kPublic = from_hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
static const Bytes kEmptySignature = from_hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
static void sha512(const Bytes& a, const uint8_t* b, size_t bn, const uint8_t* c, size_t cn, uint8_t out[64]) {
  br_sha512_context ctx;
  br_sha512_init(&ctx);
  br_sha512_update(&ctx, a.data(), a.size());
  if (bn) { br_sha512_update(&ctx, b, bn); }
  if (cn) { br_sha512_update(&ctx, c, cn); }
  br_sha512_out(&ctx, out);
}
static void secret_scalar(const Bytes& seed, uint8_t h[64]) {
  sha512(seed, nullptr, 0, nullptr, 0, h);
  h[0] &= 248; h[31] &= 63; h[31] |= 64;
}
static Bytes public_of(const Bytes& seed) {
  uint8_t h[64];
  secret_scalar(seed, h);
  ge_p3 A;
  ge_scalarmult_base(&A, h);
  Bytes pub(32);
  ge_p3_tobytes(pub.data(), &A);
  return pub;
}
static Bytes sign(const Bytes& seed, const uint8_t* m, size_t n) {
  uint8_t h[64], r[64], k[64];
  secret_scalar(seed, h);
  Bytes prefix(h + 32, h + 64);
  sha512(prefix, m, n, nullptr, 0, r);
  sc_reduce(r);
  ge_p3 R;
  ge_scalarmult_base(&R, r);
  Bytes sig(64);
  ge_p3_tobytes(sig.data(), &R);
  Bytes rs(sig.begin(), sig.begin() + 32);
  Bytes pub = public_of(seed);
  sha512(rs, pub.data(), 32, m, n, k);
  sc_reduce(k);
  sc_muladd(sig.data() + 32, k, h, r);
  return sig;
}

// --- The network: the record of the ESP-NOW mesh in NVS, and the tag every frame carries -----------------------------------------------------
static const Bytes kGroupKey = from_hex("00112233445566778899aabbccddeeff0123456789abcdeffedcba9876543210");
static void mesh_record(uint8_t id, uint8_t channel, bool has_group) {
  Bytes r(2188, 0);
  r[0] = 4;
  r[5] = id;
  r[6] = channel;
  r[13] = has_group;
  memcpy(r.data() + 48, kGroupKey.data(), 32);
  g_nvs["espnowmesh/settings"] = r;
}
static Bytes tag_of(const uint8_t* f, size_t n, const Bytes& group = kGroupKey) {
  uint8_t key[32];
  br_hkdf_context hc;
  br_hkdf_init(&hc, &br_sha256_vtable, "espnow-ota", 10);
  br_hkdf_inject(&hc, group.data(), 32);
  br_hkdf_flip(&hc);
  br_hkdf_produce(&hc, "tag", 3, key, sizeof(key));
  br_hmac_key_context kc;
  br_hmac_key_init(&kc, &br_sha256_vtable, key, sizeof(key));
  br_hmac_context mc;
  br_hmac_init(&mc, &kc, 8);
  br_hmac_update(&mc, f, n);
  Bytes tag(8);
  br_hmac_out(&mc, tag.data());
  return tag;
}
static bool tag_ok(const Bytes& f) { if (f.size() < 8) { return false; } Bytes t = tag_of(f.data(), f.size() - 8); return !memcmp(t.data(), f.data() + f.size() - 8, 8); }
static Bytes frame(uint8_t kind, const Bytes& body, uint8_t sender = 9, const Bytes& group = kGroupKey) {
  Bytes f = { 0x4F, kind, sender };
  f.insert(f.end(), body.begin(), body.end());
  Bytes t = tag_of(f.data(), f.size(), group);
  f.insert(f.end(), t.begin(), t.end());
  return f;
}

// --- An image, cut and compressed in blocks, with its signed manifest, as the release tool makes it ---------------------------------------------
struct Image { Bytes data; std::vector<Bytes> blocks; Bytes offer; Bytes sha; };
static Bytes sha256_of(const Bytes& d) { br_sha256_context c; br_sha256_init(&c); br_sha256_update(&c, d.data(), d.size()); Bytes o(32); br_sha256_out(&c, o.data()); return o; }
static Bytes make_data(size_t size, uint32_t seed) {
  Bytes d(size);
  uint32_t s = seed;
  for (size_t i = 0; i < size; i++) {
    s = s * 1664525u + 1013904223u;
    d[i] = (i % 3000 < 1800) ? (uint8_t)("Tasmota safeboot "[i % 17]) : (uint8_t)(s >> 24);  // text that compresses, and noise that does not
  }
  d[0] = 0xE9;                                                  // the first byte of an ESP image
  return d;
}
static Image pack(const Bytes& data, const Bytes& seed = kSeed, const Bytes* signed_sha = nullptr) {
  Image im;
  im.data = data;
  im.sha = sha256_of(data);
  const size_t block = 64 * 1024;
  for (size_t at = 0; at < data.size(); at += block) {
    size_t n = std::min(block, data.size() - at);
    Bytes out(n + n / 8 + 1024);
    int len = host_deflate_raw(data.data() + at, n, out.data(), out.size());
    out.resize(len);
    im.blocks.push_back(out);
  }
  put32(im.offer, (uint32_t)data.size());
  put16(im.offer, (uint16_t)im.blocks.size());
  im.offer.push_back(64);
  const Bytes& sha = signed_sha ? *signed_sha : im.sha;
  im.offer.insert(im.offer.end(), sha.begin(), sha.end());
  Bytes sig = sign(seed, im.offer.data(), im.offer.size());
  im.offer.insert(im.offer.end(), sig.begin(), sig.end());
  if (signed_sha) { im.sha = *signed_sha; }
  return im;
}

// --- The radio ---------------------------------------------------------------------------------------------------------------------------------
static const uint8_t kSender[6] = { 0x24, 0x6f, 0x28, 0x00, 0x00, 0x09 };
static const uint8_t kOther[6] = { 0x24, 0x6f, 0x28, 0x00, 0x00, 0x0a };
static void hear(const uint8_t* mac, const Bytes& f) {
  esp_now_recv_info_t info = { (uint8_t*)mac, nullptr, nullptr };
  g_recv_cb(&info, f.data(), (int)f.size());
  Xdrv104(FUNC_LOOP);
}
struct Ack { bool has; uint16_t block; uint32_t got; uint8_t state; };
static Ack last_ack(const uint8_t* to) {                        // the last ack sent to that neighbour, checked for its form and tag
  for (size_t i = g_sent.size(); i-- > 0;) {
    const Sent& s = g_sent[i];
    if (memcmp(s.mac, to, 6) || s.data.size() < 3 || s.data[1] != 3) { continue; }
    if (s.data.size() != 22 || !tag_ok(s.data)) { return { false, 0, 0, 0 }; }
    return { true, get16(s.data.data() + 7), get32(s.data.data() + 9), s.data[13] };
  }
  return { false, 0, 0, 0 };
}
static size_t acks_to(const uint8_t* to) { size_t n = 0; for (auto& s : g_sent) { if (!memcmp(s.mac, to, 6) && s.data.size() > 1 && s.data[1] == 3) { n++; } } return n; }
static Bytes piece(const Image& im, uint16_t block, uint32_t offset, size_t n) {
  const Bytes& b = im.blocks[block];
  Bytes body(im.sha.begin(), im.sha.begin() + 4);
  put16(body, block);
  put32(body, offset);
  put32(body, (uint32_t)b.size());
  body.insert(body.end(), b.begin() + offset, b.begin() + offset + n);
  return frame(2, body);
}
static void send_block(const uint8_t* mac, const Image& im, uint16_t block) {
  const size_t kData = 250 - 3 - 14 - 8;                         // what a frame of 250 bytes carries of the image
  const Bytes& b = im.blocks[block];
  for (uint32_t at = 0; at < b.size(); at += kData) { hear(mac, piece(im, block, at, std::min(kData, b.size() - at))); }
}

// --- The world -----------------------------------------------------------------------------------------------------------------------------------
static void reset_world(void) {
  g_log.clear(); g_sent.clear(); g_peers.clear(); g_nvs.clear(); g_namespaces.clear();
  g_recv_cb = nullptr; g_now_up = false; g_now_fail = false; g_wifi_mode = WIFI_MODE_STA; g_channel = 1; g_has_app = true;
  g_wifi_connected = false; g_auto_reconnect = true; g_disconnects = 0;
  g_yields = 0; g_inflates = 0;
  TasmotaGlobal.uptime = 100; TasmotaGlobal.restart_flag = 0;
  snprintf(TasmotaGlobal.hostname, sizeof(TasmotaGlobal.hostname), "tasmota-3A91F0-1234");
  g_millis = 100000; g_boot_refuses = false; Wifi.config_type = 0;
  g_settings_text[SET_FRIENDLYNAME1] = "Living room"; g_settings_text[SET_TEMPLATE_NAME] = "Sonoff Zigbee Pro";
  Serial2 = HostSerial();
  flash_reset();
  decltype(EspNowOta) fresh;
  EspNowOta = fresh;
  decltype(EspNowOtaDisplay) fresh_display;
  EspNowOtaDisplay = fresh_display;
}
static void power_cycle(void) {                                  // what the RAM held is gone; the NVS and the flash stay
  g_recv_cb = nullptr; g_now_up = false; g_peers.clear(); g_log.clear(); g_auto_reconnect = true;
  decltype(EspNowOta) fresh;
  EspNowOta = fresh;
}
static void start(void) {
  Xdrv104(FUNC_INIT);
  TasmotaGlobal.uptime = 100;
  Xdrv104(FUNC_EVERY_SECOND);
}
static bool flash_holds(const Bytes& d, size_t from, size_t n) { return !memcmp(g_flash.data() + from, d.data() + from, n); }

// --- The tests -----------------------------------------------------------------------------------------------------------------------------------
static void test_signature(void) {
  printf("-- the signature\n");
  CHECK(public_of(kSeed) == kPublic, "the public key of RFC 8032's first test is made from its secret");
  CHECK(sign(kSeed, nullptr, 0) == kEmptySignature, "and its signature of the empty message is the RFC's");
  CHECK(EspNowOtaVerify(nullptr, 0, kEmptySignature.data(), kPublic.data()), "the receiver takes the RFC's signature");
  Bytes bad = kEmptySignature;
  bad[10] ^= 1;
  CHECK(!EspNowOtaVerify(nullptr, 0, bad.data(), kPublic.data()), "and not one with a bit changed");
  bad = kEmptySignature;
  bad[63] |= 0x20;
  CHECK(!EspNowOtaVerify(nullptr, 0, bad.data(), kPublic.data()), "nor one whose S is out of its range");
  uint8_t m[3] = { 1, 2, 3 };
  CHECK(!EspNowOtaVerify(m, 3, kEmptySignature.data(), kPublic.data()), "nor the signature of one message on another");

  Image im = pack(make_data(70000, 1));
  CHECK(EspNowOtaSigned(im.offer.data()), "an offer signed with the second key of the build is taken");
  Bytes stranger = from_hex("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb");   // RFC 8032, test 2: its key is the first of the build
  Bytes other_seed = from_hex("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7");   // RFC 8032, test 3: in no build
  Image signed_by_stranger = pack(make_data(70000, 1), stranger);
  CHECK(EspNowOtaSigned(signed_by_stranger.offer.data()), "one signed with the first key too");
  Image signed_by_other = pack(make_data(70000, 1), other_seed);
  CHECK(!EspNowOtaSigned(signed_by_other.offer.data()), "and one signed with a key the build does not carry is not");
  Bytes changed = im.offer;
  changed[0] ^= 1;
  CHECK(!EspNowOtaSigned(changed.data()), "nor an offer whose size was changed after it was signed");
}

static void test_no_house(void) {
  printf("-- a device of no house\n");
  reset_world();
  start();
  CHECK(!g_now_up && g_sent.empty(), "no network key: the receiver does not start the radio, and says nothing");
  CHECK(!Xdrv104(FUNC_BUTTON_PRESSED), "and the buttons work as Tasmota's");

  reset_world();
  mesh_record(7, 6, false);
  start();
  CHECK(!g_now_up, "a record of the mesh without the network key does not start it either");

  reset_world();
  mesh_record(7, 6, true);
  g_has_app = false;
  start();
  CHECK(!g_now_up, "nor does a device with no app partition to write");
}

static void test_beacon(void) {
  printf("-- the beacon\n");
  reset_world();
  mesh_record(7, 6, true);
  Xdrv104(FUNC_INIT);
  g_wifi_mode = WIFI_MODE_NULL;
  TasmotaGlobal.uptime = 100;
  Xdrv104(FUNC_EVERY_SECOND);
  CHECK(!g_now_up, "the radio waits for the WiFi to be up");
  g_wifi_mode = WIFI_MODE_STA;
  Xdrv104(FUNC_EVERY_SECOND);
  CHECK(g_now_up && g_channel == 6, "then starts, on the channel of the mesh's record");
  CHECK(logged("Listening as node 7 on channel 6"), "and says so");
  CHECK(g_peers.size() == 1 && g_peers[0] == "ffffffffffff", "with the broadcast address as its peer");
  CHECK(g_sent.size() == 1 && mac_hex(g_sent[0].mac) == "ffffffffffff", "a beacon goes to everyone at once");
  const Bytes& b = g_sent[0].data;
  CHECK(b.size() == 20 && b[0] == 0x4F && b[1] == 0 && b[2] == 7 && b[3] == 0, "with the node's number and the state idle");
  CHECK(tag_ok(b), "under the network's tag");
  TasmotaGlobal.uptime = 101;
  Xdrv104(FUNC_EVERY_SECOND);
  CHECK(g_sent.size() == 1, "and again only 2 s later");
  TasmotaGlobal.uptime = 102;
  Xdrv104(FUNC_EVERY_SECOND);
  CHECK(g_sent.size() == 2, "when it does");
  CHECK(Xdrv104(FUNC_BUTTON_PRESSED) && Xdrv104(FUNC_BUTTON_MULTI_PRESSED), "a device of a house takes its buttons from Tasmota: they do nothing");
}

static void second(uint32_t uptime) { TasmotaGlobal.uptime = uptime; Xdrv104(FUNC_EVERY_SECOND); }

static void test_park(void) {
  printf("-- the station parked on the mesh's channel\n");
  reset_world();
  mesh_record(7, 6, true);
  g_wifi_connected = true;
  g_channel = 6;
  Xdrv104(FUNC_INIT);
  second(100);
  CHECK(!EspNowOtaWifiQuiet() && g_disconnects == 0 && g_auto_reconnect, "a station connected to an access point on the mesh's channel is left alone");
  CHECK(g_now_up && g_sent.size() == 1, "and the beacon goes out on that channel");

  reset_world();
  mesh_record(7, 6, true);
  Xdrv104(FUNC_INIT);
  second(10);
  CHECK(!EspNowOtaWifiQuiet() && g_auto_reconnect, "a station not connected is given 30 s to connect");
  second(30);
  CHECK(EspNowOtaWifiQuiet() && !g_auto_reconnect && g_disconnects == 1, "then it is parked: the stack's retries and Tasmota's held, the try under way ended");
  CHECK(g_channel == 6 && logged("WiFi parked on channel 6, for the mesh"), "on the mesh's channel, and said");
  g_channel = 3;
  second(31);
  CHECK(g_channel == 6, "the radio goes back to the mesh's channel when something moved it");
  second(32);
  CHECK(g_disconnects == 1, "and it is parked once");

  reset_world();
  mesh_record(7, 6, true);
  g_nvs["espnowota/armed"] = { 1 };
  Xdrv104(FUNC_INIT);
  second(3);
  CHECK(EspNowOtaWifiQuiet() && g_channel == 6, "asked by the application for the image over ESP-NOW, a station not connected parks at once");

  reset_world();
  mesh_record(7, 6, true);
  g_nvs["espnowota/armed"] = { 1 };
  g_wifi_connected = true;
  g_channel = 6;
  Xdrv104(FUNC_INIT);
  second(3);
  CHECK(!EspNowOtaWifiQuiet() && g_wifi_connected, "one connected on the mesh's channel keeps its access point");

  reset_world();
  mesh_record(7, 6, true);
  g_nvs["espnowota/armed"] = { 1 };
  g_wifi_connected = true;
  g_channel = 11;
  Xdrv104(FUNC_INIT);
  second(3);
  CHECK(EspNowOtaWifiQuiet() && !g_wifi_connected && g_channel == 6, "one connected on another channel leaves it, for the mesh's");

  reset_world();
  mesh_record(7, 6, true);
  Image im = pack(make_data(70000, 8));
  g_nvs["espnowota/manifest"] = im.offer;
  g_nvs["espnowota/block"] = { 1, 0 };
  Xdrv104(FUNC_INIT);
  second(2);
  CHECK(EspNowOtaWifiQuiet() && EspNowOta.block == 1, "a transfer under way at the start parks the station at once");

  reset_world();
  second(100);
  Xdrv104(FUNC_INIT);
  second(101);
  CHECK(!EspNowOtaWifiQuiet() && g_auto_reconnect, "a device of no house never parks its station");
}

static void test_offer(void) {
  printf("-- the offer\n");
  reset_world();
  mesh_record(7, 6, true);
  start();
  Image im = pack(make_data(150000, 2));
  g_sent.clear();

  Bytes other_seed = from_hex("c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7");
  Image unsigned_im = pack(make_data(150000, 2), other_seed);
  hear(kSender, frame(1, unsigned_im.offer));
  CHECK(logged("its signature does not check") && g_sent.empty(), "an offer under a key the build does not carry is refused, with no answer");
  CHECK(!g_nvs.count("espnowota/manifest"), "and nothing of it is kept");

  Bytes stranger_key = from_hex("ffeeddccbbaa99887766554433221100fedcba98765432100123456789abcdef");
  hear(kSender, frame(1, im.offer, 9, stranger_key));
  CHECK(g_sent.empty() && !EspNowOta.has_manifest, "an offer under another network's tag is not even looked at");

  Bytes cut(im.offer.begin(), im.offer.end() - 1);
  hear(kSender, frame(1, cut));
  CHECK(g_sent.empty() && !EspNowOta.has_manifest, "nor one of the wrong length");

  Image huge = pack(make_data(70000, 3));
  Bytes body = huge.offer;
  body.resize(39);
  body[0] = 0; body[1] = 0; body[2] = 0x30; body[3] = 0;          // 3 MB, more than the partition
  body[4] = 48; body[5] = 0;
  Bytes sig = sign(kSeed, body.data(), 39);
  body.insert(body.end(), sig.begin(), sig.end());
  hear(kSender, frame(1, body));
  CHECK(logged("the image does not fit") && g_sent.empty(), "a signed offer of an image larger than the partition is refused");

  body.resize(39);
  body[0] = 0x70; body[1] = 0x11; body[2] = 0x01; body[3] = 0;    // 70 000 bytes, said to be in 3 blocks of 64 KB
  body[4] = 3;
  sig = sign(kSeed, body.data(), 39);
  body.insert(body.end(), sig.begin(), sig.end());
  hear(kSender, frame(1, body));
  CHECK(g_sent.empty() && !EspNowOta.has_manifest, "and one whose blocks do not add up to its size");

  hear(kSender, frame(1, im.offer));
  Ack a = last_ack(kSender);
  CHECK(a.has && a.block == 0 && a.got == 0 && a.state == 1, "a good offer is answered: block 0, from its first byte, receiving");
  CHECK(logged("Taking an image of 150000 bytes in 3 blocks"), "and said in the log");
  CHECK(g_nvs.count("espnowota/manifest") && g_nvs["espnowota/manifest"] == im.offer, "the offer, signature and all, is kept in the NVS");
  CHECK(g_peers.size() == 2 && g_peers[1] == mac_hex(kSender), "and the sender is the peer the acks go to");
}

static void test_transfer_and_resume(void) {
  printf("-- the transfer, a power loss and the resume\n");
  reset_world();
  mesh_record(7, 6, true);
  start();
  Image im = pack(make_data(150000, 4));
  CHECK(im.blocks.size() == 3 && im.blocks[0].size() < 65536, "the image goes in 3 blocks, each one smaller compressed");
  hear(kSender, frame(1, im.offer));

  hear(kSender, piece(im, 0, 0, 225));
  Ack a = last_ack(kSender);
  CHECK(a.has && a.block == 0 && a.got == 225, "a piece is acknowledged with the byte wanted next");
  hear(kSender, piece(im, 0, 450, 225));
  a = last_ack(kSender);
  CHECK(a.got == 225, "a piece after a gap is not taken: the ack says where the receiver is");
  hear(kSender, piece(im, 0, 0, 225));
  a = last_ack(kSender);
  CHECK(a.got == 225, "nor a piece it has, said again");
  Bytes stray = piece(im, 0, 225, 225);
  stray[3] ^= 1;                                                    // the image's id, and the tag made again over it
  stray.resize(stray.size() - 8);
  Bytes t = tag_of(stray.data(), stray.size());
  stray.insert(stray.end(), t.begin(), t.end());
  size_t before = acks_to(kSender);
  hear(kSender, stray);
  CHECK(acks_to(kSender) == before, "a piece of another image gets no answer");

  // the rest of block 0, from where the receiver is
  const Bytes& b0 = im.blocks[0];
  for (uint32_t at = 225; at < b0.size(); at += 225) { hear(kSender, piece(im, 0, at, std::min<size_t>(225, b0.size() - at))); }
  a = last_ack(kSender);
  CHECK(a.block == 1 && a.got == 0, "a whole block is written, and the ack asks for the next one");
  CHECK(flash_holds(im.data, 0, 65536) && !g_flash_bad_write, "the block is in the partition, inflated, written on erased flash");
  uint16_t saved = 0;
  memcpy(&saved, g_nvs["espnowota/block"].data(), 2);
  CHECK(saved == 1, "and the next block is kept in the NVS");

  send_block(kSender, im, 1);
  CHECK(last_ack(kSender).block == 2 && flash_holds(im.data, 65536, 65536), "block 1 too");

  // the power goes, halfway through block 2
  const Bytes& b2 = im.blocks[2];
  for (uint32_t at = 0; at < b2.size() / 2; at += 225) { hear(kSender, piece(im, 2, at, std::min<size_t>(225, b2.size() - at))); }
  power_cycle();
  start();
  CHECK(EspNowOta.has_manifest && EspNowOta.block == 2 && EspNowOta.state == 1, "after a power loss the offer and the block are read back: receiving block 2");
  const Bytes& beacon = g_sent.back().data;
  CHECK(mac_hex(g_sent.back().mac) == "ffffffffffff" && beacon[3] == 1 && !memcmp(beacon.data() + 4, im.sha.data(), 4) &&
        get16(beacon.data() + 8) == 2 && get16(beacon.data() + 10) == 3, "and the beacon says so: receiving, the image, block 2 of 3");

  // another neighbour takes over, from the beacon
  hear(kOther, frame(1, im.offer));
  a = last_ack(kOther);
  CHECK(a.has && a.block == 2 && a.got == 0, "the same offer from another neighbour resumes at block 2, from its start");
  CHECK(g_peers.back() == mac_hex(kOther), "and the acks go to it");
  send_block(kOther, im, 2);
  a = last_ack(kOther);
  CHECK(a.state == 3 && a.block == 3, "the last block written, the image is checked, and the ack says done");
  CHECK(flash_holds(im.data, 0, im.data.size()), "the partition holds the whole image");
  CHECK(g_boot == &g_app && TasmotaGlobal.restart_flag == 3, "the app partition is set to boot, and the device restarts");
  CHECK(logged("Image of 150000 bytes written and checked"), "said in the log");
  CHECK(!g_nvs.count("espnowota/manifest") && !g_nvs.count("espnowota/block"), "and the progress is cleared from the NVS");
  CHECK(g_yields > 0, "the check reads the flash with the loop given its turns");
}

static void test_bad_block(void) {
  printf("-- a block that does not inflate\n");
  reset_world();
  mesh_record(7, 6, true);
  start();
  Image im = pack(make_data(70000, 5));
  hear(kSender, frame(1, im.offer));
  Image broken = im;
  for (size_t i = 0; i < broken.blocks[0].size(); i++) { broken.blocks[0][i] ^= 0x5A; }
  send_block(kSender, broken, 0);
  Ack a = last_ack(kSender);
  CHECK(logged("Block 0 could not be written") && a.block == 0 && a.got == 0, "the receiver says so, and asks for the block again from its start");
  CHECK(EspNowOta.state == 1, "still receiving");
  send_block(kSender, im, 0);
  send_block(kSender, im, 1);
  CHECK(last_ack(kSender).state == 3 && flash_holds(im.data, 0, im.data.size()), "the block sent right is taken, and the image ends");
}

static void test_wrong_image(void) {
  printf("-- an image that is not the one signed\n");
  reset_world();
  mesh_record(7, 6, true);
  start();
  Bytes real = make_data(70000, 6);
  Bytes other = make_data(70000, 7);
  Bytes claimed = sha256_of(real);
  Image im = pack(other, kSeed, &claimed);                         // the offer is for the real image, the blocks are the other's
  hear(kSender, frame(1, im.offer));
  send_block(kSender, im, 0);
  send_block(kSender, im, 1);
  Ack a = last_ack(kSender);
  CHECK(logged("image does not match its SHA-256") && a.state == 4, "the image read back does not match: failed");
  CHECK(g_boot == nullptr && TasmotaGlobal.restart_flag == 0, "nothing is set to boot");
  uint16_t saved = 1;
  memcpy(&saved, g_nvs["espnowota/block"].data(), 2);
  CHECK(saved == 0, "and the image will be received again from its start");
  hear(kSender, frame(1, im.offer));
  a = last_ack(kSender);
  CHECK(a.state == 1 && a.block == 0, "the offer made again starts it over");
}

static void test_sender_name_and_hotspot(void) {
  printf("-- the sender's name, and the hotspot\n");
  reset_world();
  mesh_record(7, 6, true);
  start();
  Image im = pack(make_data(70000, 9));
  Bytes named = im.offer;
  const char* name = "B-Stove";
  named.push_back((uint8_t)strlen(name));
  named.insert(named.end(), name, name + strlen(name));
  hear(kSender, frame(1, named, 3));
  CHECK(last_ack(kSender).has && !strcmp(EspNowOta.sender_name, "B-Stove") && EspNowOta.sender_node == 3, "an offer may carry its sender's name, after the signed part");
  Bytes long_name = im.offer;
  long_name.push_back(21);
  long_name.insert(long_name.end(), 21, 'x');
  size_t before = g_sent.size();
  hear(kOther, frame(1, long_name, 4));
  CHECK(g_sent.size() == before && EspNowOta.sender_node == 3, "a name longer than 20 is refused, with the offer");
  Bytes short_name = im.offer;
  short_name.push_back(5);
  short_name.push_back('x');
  hear(kOther, frame(1, short_name, 4));
  CHECK(g_sent.size() == before, "and one shorter than it says");
  hear(kOther, frame(1, im.offer, 4));
  CHECK(EspNowOta.sender_name[0] == 0 && EspNowOta.sender_node == 4, "an offer without a name forgets the last one");

  reset_world();
  mesh_record(7, 6, true);
  Xdrv104(FUNC_INIT);
  Wifi.config_type = WIFI_MANAGER;
  g_channel = 1;
  TasmotaGlobal.uptime = 100;
  Xdrv104(FUNC_EVERY_SECOND);
  CHECK(!EspNowOtaWifiQuiet() && g_disconnects == 0, "with the WiFi Manager's access point up, the station is not parked");
  EspNowOta.parked = true;
  Xdrv104(FUNC_EVERY_SECOND);
  CHECK(g_channel == 1, "nor is the channel taken from its access point");
}

// --- The display -----------------------------------------------------------------------------------------------------------------------------
static void display_says(const std::string& payload) {           // a frame of the page: 55 BB len payload crc
  std::vector<uint8_t> f = { 0x55, 0xBB, (uint8_t)payload.size(), (uint8_t)(payload.size() >> 8) };
  f.insert(f.end(), payload.begin(), payload.end());
  uint16_t crc = EspNowOtaDisplayCrc(f.data(), f.size());
  f.push_back((uint8_t)crc);
  f.push_back((uint8_t)(crc >> 8));
  for (uint8_t b : f) { Serial2.in.push_back(b); }
}
static void display_answers(int32_t v) {                           // a number: 71 and four bytes, then FF FF FF
  uint8_t a[8] = { 0x71, (uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24), 0xFF, 0xFF, 0xFF };
  for (uint8_t b : a) { Serial2.in.push_back(b); }
}
static bool written(const std::string& command) { return Serial2.out.find(command + "\xFF\xFF\xFF") != std::string::npos; }
static void display_second(uint32_t ms = 1000) { g_millis += ms; TasmotaGlobal.uptime++; Xdrv105(FUNC_EVERY_SECOND); Xdrv105(FUNC_LOOP); }
// The page up, and the six questions answered: the bar at 15,146, 290 by 12, in 1374 on 10597
static void display_up(void) {
  display_says("ev,safeboot,page,show");
  Xdrv105(FUNC_LOOP);
  const int32_t answers[6] = { 15, 146, 290, 12, 1374, 10597 };
  for (int i = 0; i < 6; i++) {
    Xdrv105(FUNC_LOOP);                                              // asks
    display_answers(answers[i]);
    Xdrv105(FUNC_LOOP);                                              // reads the answer
  }
}
static void panel(void) {
  g_settings_text[SET_TEMPLATE_NAME] = "NSPanel";
  Xdrv104(FUNC_INIT);
  Xdrv105(FUNC_INIT);
}

static void test_display_template(void) {
  printf("-- the display, on a device whose template has one\n");
  reset_world();
  Xdrv105(FUNC_INIT);
  display_second();
  CHECK(!Serial2.begun && Serial2.out.empty(), "a bridge's template: the serial is never opened, nothing is written to its pins");
  reset_world();
  panel();
  CHECK(Serial2.begun && Serial2.baud == 115200 && Serial2.rx_pin == 17 && Serial2.tx_pin == 16, "the NSPanel's: the display's serial, 115200, RX 17 and TX 16");
  CHECK(written("sleep=0") && written("thsp=0"), "and the display is woken and kept awake");
}

static void test_display_page(void) {
  printf("-- the page\n");
  reset_world();
  panel();
  display_second();
  CHECK(written("page safeboot"), "the page is asked for");
  for (int i = 0; i < 6; i++) { display_second(); }
  CHECK(logged("Display has no safeboot page"), "a display that never says it is up is taken for one without the page");
  Serial2.out.clear();
  display_second();
  display_second();
  CHECK(Serial2.out.empty(), "and is left alone");

  reset_world();
  panel();
  display_second();
  display_says("ev,safeboot,page,show");
  Xdrv105(FUNC_LOOP);
  CHECK(logged("Display page up"), "the page says it is up");
  CHECK(written("get t3.x"), "then the bar's box is asked for");
  Serial2.out.clear();
  display_second(0);
  CHECK(!written("t0.txt=\"Safeboot\""), "and nothing is drawn before it comes");
  display_answers(15);
  Xdrv105(FUNC_LOOP);
  Xdrv105(FUNC_LOOP);
  CHECK(written("get t3.y"), "one question at a time");
  g_millis += 400;
  Xdrv105(FUNC_LOOP);
  CHECK(logged("Display did not say t3.y, no bar"), "a question not answered in 300 ms leaves the page without its bar");
  display_second();
  CHECK(written("t0.txt=\"Safeboot\""), "and the page is drawn without it");

  reset_world();
  panel();
  display_second();
  display_up();
  display_second();
  std::string first = Serial2.out;
  Serial2.out.clear();
  display_second();
  CHECK(Serial2.out.empty(), "what has not changed is not written again");
  Serial2.in.push_back(0x55); Serial2.in.push_back(0xBB); Serial2.in.push_back(22); Serial2.in.push_back(0);
  const char* bad = "ev,safeboot,bRow13,tap";
  for (const char* c = bad; *c; c++) { Serial2.in.push_back((uint8_t)*c); }
  Serial2.in.push_back(0); Serial2.in.push_back(0);
  Xdrv105(FUNC_LOOP);
  CHECK(TasmotaGlobal.restart_flag == 0, "a frame whose CRC does not check is not acted on");
  display_says("ev,safeboot,page,show");
  Xdrv105(FUNC_LOOP);
  CHECK(!EspNowOtaDisplay.has_bar, "the page loaded again: everything is asked and written again");
}

static void test_display_waiting_and_hotspot(void) {
  printf("-- waiting, the hotspot and Restart\n");
  reset_world();
  mesh_record(7, 6, true);
  panel();
  display_second();
  display_up();
  display_second();
  CHECK(written("t0.txt=\"Safeboot\"") && written("t1.txt=\"Living room, node 7\""), "waiting: the title and the device's name and number");
  CHECK(written("t4.txt=\"Waiting for its firmware.\"") && written("t5.txt=\"The mesh can send it.\""), "what it waits for");
  CHECK(written("vis bRow12,1") && written("vis bRow13,1") && written("bRow12.txt=\"Open hotspot\"") && written("bRow13.txt=\"Restart\""), "and the two buttons");
  CHECK(written("vis t2,0") && written("vis t8,0") && written("vis qCode9,0"), "the percentage, the warning and the code hidden");
  size_t hide = Serial2.out.find("vis t2,0"), show = Serial2.out.find("vis bRow12,1");
  CHECK(hide < show, "what goes is hidden before what comes is shown");

  display_says("ev,safeboot,bRow12,tap");
  Xdrv105(FUNC_LOOP);
  CHECK(Wifi.config_type == WIFI_MANAGER && logged("Hotspot asked on the display"), "Open hotspot starts the WiFi Manager's access point");
  Serial2.out.clear();
  display_second();
  CHECK(written("t0.txt=\"Hotspot open\"") && written("vis qCode9,1"), "the hotspot's view: its title and the code");
  CHECK(written("qCode9.txt=\"WIFI:T:nopass;S:tasmota-3A91F0-1234;;\""), "the code joins the open network");
  CHECK(written("t10.txt=\"tasmota-3A91F0-1234\"") && written("t11.txt=\"Open 192.168.4.1\"") && written("bRow12.txt=\"Close hotspot\""), "its name and address in words, and the way to close it");
  display_says("ev,safeboot,bRow12,tap");
  Xdrv105(FUNC_LOOP);
  CHECK(TasmotaGlobal.restart_flag == 2 && g_boot == nullptr, "Close hotspot restarts this image");

  TasmotaGlobal.restart_flag = 0;
  display_says("ev,safeboot,bRow13,tap");
  Xdrv105(FUNC_LOOP);
  CHECK(TasmotaGlobal.restart_flag == 2 && g_boot == &g_app && logged("into the app"), "Restart boots the app when its image is whole");
  TasmotaGlobal.restart_flag = 0;
  g_boot = nullptr;
  g_boot_refuses = true;
  display_says("ev,safeboot,bRow13,tap");
  Xdrv105(FUNC_LOOP);
  CHECK(TasmotaGlobal.restart_flag == 2 && g_boot == nullptr && logged("into the safeboot"), "and this image again when it is not");

  reset_world();
  g_settings_text[SET_FRIENDLYNAME1] = "Bedroom";
  strcpy(TasmotaGlobal.hostname, "a;b");
  panel();
  display_second();
  display_up();
  Wifi.config_type = WIFI_MANAGER;
  display_second();
  CHECK(written("t1.txt=\"Bedroom\""), "a device of no house is named without a number");
  CHECK(written("qCode9.txt=\"WIFI:T:nopass;S:a\\;b;;\""), "and a ; in the network's name is escaped in the code");
}

static void test_display_updating(void) {
  printf("-- updating\n");
  reset_world();
  mesh_record(7, 6, true);
  panel();
  TasmotaGlobal.uptime = 100;
  Xdrv104(FUNC_EVERY_SECOND);
  display_second();
  display_up();
  display_second();
  Image im = pack(make_data(150000, 10));
  Bytes named = im.offer;
  named.push_back(7);
  for (const char* c = "B-Stove"; *c; c++) { named.push_back((uint8_t)*c); }
  hear(kSender, frame(1, named, 3));
  hear(kSender, piece(im, 0, 0, 225));
  Serial2.out.clear();
  display_second();
  CHECK(written("t0.txt=\"Updating firmware\"") && written("vis bRow12,0") && written("vis bRow13,0"), "updating: the title, and no button");
  CHECK(written("t2.txt=\"0%\"") && written("t4.txt=\"Block 1 of 3\"") && written("t5.txt=\"From B-Stove\"") && written("t8.txt=\"Keep the power on\""), "the percentage, the block, the sender and the warning");
  CHECK(Serial2.out.find("t6.txt=\"About") == std::string::npos, "no time left until a block has come");
  CHECK(written("fill 15,146,290,12,10597"), "the bar's track, in the buttons' face");
  display_says("ev,safeboot,bRow13,tap");
  Xdrv105(FUNC_LOOP);
  CHECK(TasmotaGlobal.restart_flag == 0, "a tap while the image comes does nothing");

  g_millis += 30000;
  const Bytes& b0 = im.blocks[0];
  for (uint32_t at = 225; at < b0.size(); at += 225) { hear(kSender, piece(im, 0, at, std::min<size_t>(225, b0.size() - at))); }
  Serial2.out.clear();
  display_second();
  CHECK(written("t2.txt=\"33%\"") && written("t4.txt=\"Block 2 of 3\""), "a block written: a third, and the next block");
  CHECK(written("fill 15,146,95,12,1374"), "the bar filled to it, in the accent");
  CHECK(written("t6.txt=\"About 2 min left\""), "and the time left, from the pace so far");

  g_millis += 61000;
  Serial2.out.clear();
  display_second();
  CHECK(written("t0.txt=\"Safeboot\"") && written("t4.txt=\"Update paused at 33%.\"") && written("vis bRow13,1"), "no piece for a minute: paused, with the buttons back");
  hear(kSender, piece(im, 1, 0, 225));
  Serial2.out.clear();
  display_second();
  CHECK(written("t0.txt=\"Updating firmware\"") && written("vis bRow13,0"), "a piece again: updating, the buttons gone");
  CHECK(written("fill 15,146,290,12,10597") && written("fill 15,146,95,12,1374"), "the bar drawn again whole, its Text shown over it");

  send_block(kSender, im, 1);
  send_block(kSender, im, 2);
  Serial2.out.clear();
  display_second();
  CHECK(written("t0.txt=\"Firmware written\"") && written("t2.txt=\"100%\"") && written("t4.txt=\"Restarting\""), "written and checked: restarting, at 100%");
}

// --- The sender and the receiver, over a simulated radio ---------------------------------------------------------------------------------------
static const uint8_t kRecvMac[6] = { 0x24, 0x6f, 0x28, 0x00, 0x00, 0x07 };
static const uint8_t kSendMac[6] = { 0x24, 0x6f, 0x28, 0x00, 0x00, 0x03 };
static std::string g_fixture;                                      // the release tool's image, manifest and blocks (run.mjs)
static size_t g_delivered = 0;
static uint32_t g_drop_every = 0;                                  // every n-th frame on the air is lost, 0 for none
static uint32_t g_frames = 0;
static uint32_t g_twice_every = 0;                                 // every n-th frame of the sender heard twice, 0 for none
static uint32_t g_sender_frames = 0;
static Bytes read_file(const std::string& path) {
  Bytes b;
  FILE* f = fopen(path.c_str(), "rb");
  if (!f) { return b; }
  int c;
  while ((c = fgetc(f)) != EOF) { b.push_back((uint8_t)c); }
  fclose(f);
  return b;
}
static void as(const uint8_t* mac) { memcpy(g_who, mac, 6); }
// What each side sent is heard by the other, and what that makes it send, until both are quiet
static void air(void) {
  while (g_delivered < g_sent.size()) {
    Sent s = g_sent[g_delivered++];
    bool all = mac_hex(s.mac) == "ffffffffffff";
    if (g_drop_every && (++g_frames % g_drop_every == 0)) { continue; }
    if (!memcmp(s.from, kSendMac, 6) && (all || !memcmp(s.mac, kRecvMac, 6))) {
      int times = (g_twice_every && (++g_sender_frames % g_twice_every == 0)) ? 2 : 1;
      for (int t = 0; t < times; t++) {
        as(kRecvMac);
        esp_now_recv_info_t info = { (uint8_t*)kSendMac, nullptr, nullptr };
        g_recv_cb(&info, s.data.data(), (int)s.data.size());
        Xdrv104(FUNC_LOOP);
      }
    } else if (!memcmp(s.from, kRecvMac, 6) && (all || !memcmp(s.mac, kSendMac, 6))) {
      as(kSendMac);
      EspNowOtaHears(kRecvMac, -58, s.data.data(), (int)s.data.size());
      Xdrv106(FUNC_LOOP);
    }
  }
}
// Node 7 in its safeboot image, and its neighbour node 3 in its app, with the server's image
static void link_world(void) {
  reset_world();
  g_delivered = 0; g_drop_every = 0; g_frames = 0; g_twice_every = 0; g_sender_frames = 0; g_rules.clear(); g_http.clear(); g_http_gets = 0; g_http_stalls = 0; g_to_safeboot = 0;
  g_single_ota = true; g_running_factory = 0; g_radio_takes = 0;
  decltype(EspNowOtaSender) fresh_sender;
  EspNowOtaSender = fresh_sender;
  decltype(EspNowMeshDriver) fresh_driver;
  EspNowMeshDriver = fresh_driver;
  EspNowMeshSettings.id = 3; EspNowMeshSettings.has_group = 1; EspNowMeshSettings.group_version = 1;
  memcpy(EspNowMeshSettings.group_key, kGroupKey.data(), 32);
  g_http["http://server/living.ota/manifest.json"] = read_file(g_fixture + "/living.ota/manifest.json");
  g_http["http://server/living.ota/blocks.bin"] = read_file(g_fixture + "/living.ota/blocks.bin");
  as(kRecvMac);
  mesh_record(7, 6, true);
  start();                                                         // the receiver's radio, and its first beacon
  as(kSendMac);
  Xdrv106(FUNC_INIT);
  Xdrv106(FUNC_EVERY_SECOND);                                      // the network key
  air();
}
static void command(void (*cmnd)(void), const char* name, const char* data) {
  static char buffer[200];
  snprintf(buffer, sizeof(buffer), "%s", data);
  XdrvMailbox.data = buffer;
  XdrvMailbox.data_len = (uint32_t)strlen(buffer);
  XdrvMailbox.command = name;
  as(kSendMac);
  cmnd();
}
static bool rule(const char* part) { for (auto& r : g_rules) { if (r.find(part) != std::string::npos) { return true; } } return false; }
static bool answered(const char* part) { return g_response.find(part) != std::string::npos; }
// Time goes by for the sender, the air carrying what it sends, until the send ends or `ms` have gone
static void run_send(uint32_t ms) {
  for (uint32_t t = 0; (t < ms) && (kOtaSendIdle != EspNowOtaSender.send); t += 300) {
    g_millis += 300;
    as(kSendMac);
    Xdrv106(FUNC_LOOP);
    air();
  }
}

static void test_link(void) {
  printf("-- the sender and the receiver, over the air\n");
  link_world();
  Bytes image = read_file(g_fixture + "/image.bin");
  CHECK(image.size() == 200000, "the release tool's image is there (run.mjs)");
  CHECK(rule("{\"EspNowOta\":{\"Node\":7,\"State\":0,"), "the neighbour hears the beacon and tells the rules: node 7 is in its safeboot image");
  command(CmndEspNowOtaNodes, "EspNowOtaNodes", "");
  CHECK(answered("\"Node\":7,\"Mac\":\"24:6F:28:00:00:07\",\"State\":0"), "and lists it");

  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota B-Stove");
  CHECK(answered("Started") && EspNowOtaSender.blocks == 4, "a send starts, with the manifest's four blocks");
  air();
  CHECK(EspNowOta.state == kOtaDone && flash_holds(image, 0, image.size()), "the image, packed by the release tool, is written whole");
  CHECK(g_boot == &g_app && TasmotaGlobal.restart_flag == 3, "and checked, and set to boot");
  CHECK(g_radio_takes > 0, "every frame the sender sends goes under the radio's lock");
  CHECK(!strcmp(EspNowOta.sender_name, "B-Stove") && EspNowOta.sender_node == 3, "the receiver knows who sent it");
  CHECK(rule("{\"EspNowOtaSend\":{\"Node\":7,\"Result\":\"Done\"}}") && kOtaSendIdle == EspNowOtaSender.send, "the sender says it is done");
  uint32_t compressed = (uint32_t)read_file(g_fixture + "/living.ota/blocks.bin").size();
  CHECK(EspNowOtaSender.again == 0 && EspNowOtaSender.pieces >= compressed / ESPNOW_OTA_PIECE_DATA, "a piece each, none again, on a quiet air");
  CHECK((uint32_t)g_http_gets == 1 + EspNowOtaSender.fetches && EspNowOtaSender.fetches >= compressed / ESPNOW_OTA_CHUNK, "the blocks fetched 2 KB at a time");

  printf("-- one frame in five lost\n");
  link_world();
  g_drop_every = 5;
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota");
  air();
  run_send(600000);
  CHECK(EspNowOta.state == kOtaDone && flash_holds(image, 0, image.size()), "the image still comes whole");
  CHECK(rule("\"Result\":\"Done\"") && EspNowOtaSender.again > 0, "with pieces sent again");

  printf("-- a piece heard twice now and then\n");
  link_world();
  g_twice_every = 50;
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota");
  air();
  run_send(600000);
  CHECK(EspNowOta.state == kOtaDone && flash_holds(image, 0, image.size()) && rule("\"Result\":\"Done\""), "the image comes whole");
  CHECK(EspNowOtaSender.pieces <= compressed / ESPNOW_OTA_PIECE_DATA + EspNowOtaSender.blocks,
        "and no more pieces than the image has: the ack a repeated piece brings back does not start a second piece for every ack");

  printf("-- blocks whose bytes stop halfway, twice\n");
  link_world();
  g_http_stalls = 2;
  int yields = g_yields;
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota");
  air();
  run_send(600000);
  CHECK(EspNowOta.state == kOtaDone && flash_holds(image, 0, image.size()) && rule("\"Result\":\"Done\"") && (0 == g_http_stalls),
        "the image still comes whole: a fetch that stalls gives up and is tried again");
  CHECK(g_yields - yields >= 2 * ESPNOW_OTA_HTTP_MS, "waiting for the bytes with the loop given its turns (its watchdog fed), ESPNOW_OTA_HTTP_MS each time");

  printf("-- what the sender refuses, and how a send ends otherwise\n");
  link_world();
  command(CmndEspNowOtaSend, "EspNowOtaSend", "9 http://server/living.ota");
  CHECK(answered("node not heard in its safeboot image"), "a node not heard in its safeboot image");
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 ftp://server/living.ota");
  CHECK(answered("EspNowOtaSend <node>"), "a url that is not http");
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/none.ota");
  CHECK(answered("the manifest could not be fetched or read"), "a manifest the server does not have");
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota");
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota");
  CHECK(answered("a send is under way"), "a second send while one is under way");
  command(CmndEspNowOtaSend, "EspNowOtaSend", "");
  CHECK(answered("\"State\":1,\"Node\":7,"), "the send's state, asked");
  command(CmndEspNowOtaStop, "EspNowOtaStop", "");
  CHECK(rule("\"Result\":\"Stopped\"") && kOtaSendIdle == EspNowOtaSender.send, "and stopped");

  link_world();
  Bytes largest = read_file(g_fixture + "/largest.ota/manifest.json");
  Bytes total = read_file(g_fixture + "/largest.ota/total");
  g_http["http://server/largest.ota/manifest.json"] = largest;
  snprintf(EspNowOtaSender.url, sizeof(EspNowOtaSender.url), "http://server/largest.ota");
  bool whole = EspNowOtaSenderManifest();
  uint32_t end = EspNowOtaSender.block_offset[47] + EspNowOtaSender.block_length[47];
  CHECK(largest.size() < ESPNOW_OTA_MANIFEST_MAX && whole && EspNowOtaSender.blocks == 48 &&
        end == (uint32_t)atoi(std::string(total.begin(), total.end()).c_str()),
        "the manifest of the largest image, 48 blocks, read whole: the blocks one after the other, to the end of blocks.bin");

  link_world();
  g_http.erase("http://server/living.ota/blocks.bin");
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota");
  air();
  CHECK(!rule("\"Result\":\"Fetch\"") && kOtaSendIdle != EspNowOtaSender.send, "blocks the server no longer has: tried again, the send not over at once");
  int gets = g_http_gets;
  run_send(20000);
  CHECK(rule("\"Result\":\"Fetch\"") && (g_http_gets - gets == ESPNOW_OTA_FETCH_TRIES - 1), "and the send ends after ESPNOW_OTA_FETCH_TRIES in a row");

  link_world();
  Bytes manifest = g_http["http://server/living.ota/manifest.json"];
  std::string text(manifest.begin(), manifest.end());
  size_t at = text.find("\"offer\":\"") + 9 + 2 * 60;                // a digit of the signature
  text[at] = (text[at] == '0') ? '1' : '0';
  g_http["http://server/living.ota/manifest.json"] = Bytes(text.begin(), text.end());
  command(CmndEspNowOtaSend, "EspNowOtaSend", "7 http://server/living.ota");
  air();
  run_send(20000);
  CHECK(rule("\"Result\":\"NoAnswer\"") && EspNowOta.state == kOtaIdle, "an offer whose signature does not check gets no answer, and the send ends");

  printf("-- the neighbour gone, a beacon of another network, the way in, and the app's start\n");
  link_world();
  g_millis += 31000;
  as(kSendMac);
  Xdrv106(FUNC_EVERY_SECOND);
  CHECK(rule("{\"EspNowOta\":{\"Node\":7,\"Gone\":1}}"), "a neighbour not heard for 30 s is gone");
  g_rules.clear();
  Bytes stranger = from_hex("ffeeddccbbaa99887766554433221100fedcba98765432100123456789abcdef");
  Bytes beacon = frame(0, Bytes(9, 0), 8, stranger);
  EspNowOtaHears(kRecvMac, -60, beacon.data(), (int)beacon.size());
  Xdrv106(FUNC_LOOP);
  CHECK(g_rules.empty(), "a beacon under another network's key is not heard");
  uint8_t mesh_frame[4] = { 0x41, 0, 0, 0 };
  CHECK(!EspNowOtaHears(kRecvMac, -60, mesh_frame, 4), "and a frame of the mesh is left to the mesh");

  link_world();
  command(CmndEspNowOtaArm, "EspNowOtaArm", "");
  CHECK(answered("not one known to take an image over ESP-NOW") && !g_nvs.count("espnowota/armed") && g_to_safeboot == 0 && TasmotaGlobal.restart_flag == 0,
        "EspNowOtaArm refused while the safeboot partition holds no image known to take one over ESP-NOW: Tasmota's own would keep a device without WiFi in it");
  CHECK(!g_nvs.count("espnowota_sb/record"), "and no record is kept for an image the partition does not hold");
  // the image the build pins, as a factory image's, with no record kept
  Bytes pinned = read_file(g_fixture + "/image.bin");
  CHECK(pinned.size() == ESPNOW_OTA_SAFEBOOT_SIZE, "the pinned image is the fixture's (run.mjs)");
  memcpy(g_factory_flash.data(), pinned.data(), pinned.size());
  command(CmndEspNowOtaArm, "EspNowOtaArm", "");
  CHECK(answered("Done") && g_nvs["espnowota/armed"] == Bytes{ 1 } && g_to_safeboot == 1 && TasmotaGlobal.restart_flag == 2,
        "EspNowOtaArm: the image the build pins (a factory image's), read back whole, with no record: armed");
  Bytes pinned_kept = from_hex(ESPNOW_OTA_SAFEBOOT_RECORD ESPNOW_OTA_SAFEBOOT_SIGNATURE);
  CHECK(g_nvs["espnowota_sb/record"] == pinned_kept,
        "and the pinned image's signed record is kept: an app that pins another image knows this one by it, with no install over HTTP");
  const esp_partition_t* factory = esp_partition_find_first(ESP_PARTITION_TYPE_APP, ESP_PARTITION_SUBTYPE_APP_FACTORY, nullptr);
  CHECK(EspNowOtaRecordSigned(pinned_kept.data(), pinned_kept.data() + ESPNOW_OTA_SIGNED_LEN) &&
        EspNowOtaSafebootHolds(factory, EspNowOtaGet32(pinned_kept.data()), pinned_kept.data() + 7),
        "the record kept is signed, and says the image the partition holds");
  g_factory_flash[150000] ^= 1;
  g_to_safeboot = 0;
  TasmotaGlobal.restart_flag = 0;
  command(CmndEspNowOtaArm, "EspNowOtaArm", "");
  CHECK(answered("not one known") && g_to_safeboot == 0 && TasmotaGlobal.restart_flag == 0, "one byte off, it is not that image: refused");
  CHECK(g_nvs["espnowota_sb/record"] == pinned_kept, "and the record kept stays as it was");
  g_nvs.erase("espnowota_sb/record");
  flash_reset();
  // a safeboot image an install checked: its signed record kept, apart from what the app clears at its start
  g_http["http://server/houseweave-safeboot.bin"] = read_file(g_fixture + "/safeboot.bin");
  g_http["http://server/houseweave-safeboot.bin.sig.json"] = read_file(g_fixture + "/safeboot.bin.sig.json");
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", "http://server/houseweave-safeboot.bin");
  CHECK(answered("\"Written\":300000") && g_nvs["espnowota_sb/record"].size() == ESPNOW_OTA_SIGNED_LEN + 64,
        "an install keeps the signed record of the safeboot image it wrote");
  command(CmndEspNowOtaArm, "EspNowOtaArm", "");
  CHECK(answered("Done") && g_nvs["espnowota/armed"] == Bytes{ 1 } && g_to_safeboot == 1 && TasmotaGlobal.restart_flag == 2,
        "EspNowOtaArm: the image that record says, read back whole: armed, the otadata erased, and a restart into the safeboot image");
  g_factory_flash[1000] ^= 1;
  g_to_safeboot = 0;
  TasmotaGlobal.restart_flag = 0;
  command(CmndEspNowOtaArm, "EspNowOtaArm", "");
  CHECK(answered("not one known") && TasmotaGlobal.restart_flag == 0, "nor once the partition no longer holds it");
  g_factory_flash[1000] ^= 1;
  g_nvs["espnowota_sb/record"][50] ^= 1;
  command(CmndEspNowOtaArm, "EspNowOtaArm", "");
  CHECK(answered("not one known") && TasmotaGlobal.restart_flag == 0, "nor with a record its signature does not check");
  g_nvs.erase("espnowota_sb/record");
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", "http://server/houseweave-safeboot.bin");
  CHECK(answered("\"Kept\":300000") && g_nvs["espnowota_sb/record"].size() == ESPNOW_OTA_SIGNED_LEN + 64,
        "a partition that holds the image already has its record kept too: a device that took it before the record was kept gets one");
  g_running_factory = 1;
  TasmotaGlobal.restart_flag = 0;
  command(CmndEspNowOtaArm, "EspNowOtaArm", "");
  CHECK(answered("no safeboot image to restart into") && TasmotaGlobal.restart_flag == 0, "refused where there is no safeboot image to go to");
  g_nvs["espnowota/manifest"] = Bytes(103, 1);
  g_nvs["espnowota/block"] = Bytes{ 2, 0 };
  as(kSendMac);
  Xdrv106(FUNC_INIT);
  CHECK(!g_nvs.count("espnowota/manifest") && !g_nvs.count("espnowota/block") && !g_nvs.count("espnowota/armed"),
        "the app that starts clears what the safeboot image kept");
  CHECK(g_nvs.count("espnowota_sb/record"), "and keeps the record of the safeboot image");
}

static void test_boot_guard(void) {
  printf("-- this image restarting in a row gives the device back to its app\n");
  reset_world();
  EspNowOtaBootMagic = 0;                                          // a power cut: RTC memory holds nothing
  g_restarts = 0;
  Xdrv104(FUNC_PRE_INIT);
  Xdrv104(FUNC_PRE_INIT);
  CHECK(g_restarts == 0 && g_boot == nullptr, "two starts that did not last: nothing yet");
  Xdrv104(FUNC_PRE_INIT);
  CHECK(g_restarts == 1 && g_boot == &g_app && logged("restarted 3 times in a row, the app is booted"), "the third: the app is set to boot, and the device restarts");
  reset_world();
  g_restarts = 0;
  Xdrv104(FUNC_PRE_INIT);
  Xdrv104(FUNC_PRE_INIT);
  TasmotaGlobal.uptime = 30;
  Xdrv104(FUNC_EVERY_SECOND);
  Xdrv104(FUNC_PRE_INIT);
  Xdrv104(FUNC_PRE_INIT);
  CHECK(g_restarts == 0, "a start that lasted 30 s ends the count");
  Xdrv104(FUNC_PRE_INIT);
  g_boot_refuses = true;
  CHECK(g_restarts == 1, "and three more in a row bring it back");
  reset_world();
  g_restarts = 0;
  g_boot_refuses = true;
  Xdrv104(FUNC_PRE_INIT);
  Xdrv104(FUNC_PRE_INIT);
  Xdrv104(FUNC_PRE_INIT);
  CHECK(g_restarts == 0, "with no whole app to boot, it stays");
  g_boot_refuses = false;
}

static void test_armed_wait(void) {
  printf("-- an image asked for that nobody offers gives the device back to its app\n");
  reset_world();
  g_restarts = 0;
  mesh_record(7, 6, true);
  g_nvs["espnowota/armed"] = { 1 };
  Xdrv104(FUNC_INIT);
  second(ESPNOW_OTA_WAIT_S - 1);
  CHECK(g_restarts == 0 && g_boot == nullptr, "armed, and nothing offered: it waits");
  second(ESPNOW_OTA_WAIT_S);
  CHECK(g_restarts == 1 && g_boot == &g_app && logged("No image offered in 600 s, the app is booted"),
        "after ESPNOW_OTA_WAIT_S, the app is set to boot and the device restarts");
  second(ESPNOW_OTA_WAIT_S + 1);
  CHECK(g_restarts == 1, "once");

  reset_world();
  g_restarts = 0;
  mesh_record(7, 6, true);
  g_nvs["espnowota/url"] = Bytes((const uint8_t*)"http://server/living.ota", (const uint8_t*)"http://server/living.ota" + 23);
  Xdrv104(FUNC_INIT);
  second(ESPNOW_OTA_WAIT_S);
  CHECK(g_restarts == 1 && g_boot == &g_app, "and so with a release over HTTP that never came");

  reset_world();
  g_restarts = 0;
  mesh_record(7, 6, true);
  g_nvs["espnowota/armed"] = { 1 };
  Image im = pack(make_data(70000, 8));
  g_nvs["espnowota/manifest"] = im.offer;
  g_nvs["espnowota/block"] = { 1, 0 };
  Xdrv104(FUNC_INIT);
  second(ESPNOW_OTA_WAIT_S);
  CHECK(EspNowOta.has_manifest && g_restarts == 0, "an image under way is waited for: the app partition is being written over");

  reset_world();
  g_restarts = 0;
  mesh_record(7, 6, true);
  g_nvs["espnowota/armed"] = { 1 };
  g_boot_refuses = true;
  Xdrv104(FUNC_INIT);
  second(ESPNOW_OTA_WAIT_S);
  CHECK(g_restarts == 0 && logged("no whole app to boot: waiting for one"), "with no whole app to boot, it waits, and says so");
  g_boot_refuses = false;

  reset_world();
  g_restarts = 0;
  mesh_record(7, 6, true);
  Xdrv104(FUNC_INIT);
  second(ESPNOW_OTA_WAIT_S);
  CHECK(g_restarts == 0, "a device put here by hand (the web's upload) is left here");
}

// The safeboot partition's first sector, erased: the boot loader finds no image there, and starts the app
static bool first_sector_erased(void) {
  for (int i = 0; i < SPI_FLASH_SEC_SIZE; i++) { if (g_factory_flash[i] != 0xFF) { return false; } }
  return true;
}

// A string field of a small JSON file, as the release tool writes its .sig.json
static std::string json_field(const Bytes& file, const char* name) {
  std::string text(file.begin(), file.end());
  size_t at = text.find(std::string("\"") + name + "\"");
  if (at == std::string::npos) { return ""; }
  size_t from = text.find('"', text.find(':', at) + 1) + 1;
  return text.substr(from, text.find('"', from) - from);
}

static void test_safeboot_install(void) {
  printf("-- the app writes a safeboot image, signed\n");
  const char* url = "http://server/houseweave-safeboot.bin";
  const std::string sig = std::string(url) + ".sig.json";
  Bytes image = read_file(g_fixture + "/safeboot.bin");
  Bytes signature = read_file(g_fixture + "/safeboot.bin.sig.json");
  auto setup = [&]() {
    link_world();
    flash_reset();
    g_http[url] = image;
    g_http[sig] = signature;
    g_http_gets = 0;
    g_http_after = nullptr;
    g_image_verify_fails = false;
  };
  setup();
  CHECK(image.size() == 300000, "the safeboot image the release tool signed is there (run.mjs)");
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("\"Written\":300000"), "written, and said with its size and SHA-256");
  CHECK(!memcmp(g_factory_flash.data(), image.data(), image.size()) && !g_flash_bad_write, "the safeboot partition holds the image, on erased flash");
  CHECK(g_factory_erases == 5 && g_erases == 0, "the safeboot partition erased a 64 KB block at a time (300 000 bytes, 5 blocks), the app's never");
  CHECK(g_http_gets == 3, "the signature, then the image twice: checked before anything is erased, then written");
  g_http_gets = 0;
  g_factory_erases = 0;
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("\"Kept\":300000") && g_factory_erases == 0 && g_http_gets == 1, "asked again, the partition that holds it is kept: the signature fetched, nothing erased");

  setup();
  g_http[sig] = read_file(g_fixture + "/safeboot-other.sig.json");
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("not signed by a key of this build") && g_factory_erases == 0, "signed by a key the build does not carry: refused, nothing erased");

  setup();
  g_http[url][1000] ^= 1;
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("not the one signed") && g_factory_erases == 0, "an image that is not the one signed: refused before anything is erased");

  setup();
  g_http[sig] = read_file(g_fixture + "/living.ota/manifest.json");
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("does not fit the safeboot partition") && g_factory_erases == 0, "an app's record, in blocks, is not a safeboot image");

  setup();
  g_http_after_gets = 2;                                           // the signature and the first pass, then the server's image changes
  g_http_after = []() { g_http["http://server/houseweave-safeboot.bin"][5000] ^= 1; };
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("written wrong: run it again") && logged("the partition holds none"), "an image that changed between the two passes is written wrong, and said so");
  CHECK(first_sector_erased() && g_nvs["espnowota_sb/writing"] == Bytes{ 1 },
        "with no first sector: no image the boot loader would start, and the write said unfinished");
  g_http[url] = image;
  g_http_after = nullptr;
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("\"Written\":300000") && !g_nvs.count("espnowota_sb/writing"), "run again, it is written, and no longer unfinished");

  setup();
  g_image_verify_fails = true;
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("written wrong") && first_sector_erased(), "and so is one the boot loader does not take, its first sector erased after the check");

  setup();
  g_running_factory = 1;
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", url);
  CHECK(answered("no safeboot partition to write") && g_factory_erases == 0, "the safeboot image does not write itself");
  g_running_factory = 0;
  command(CmndEspNowOtaSafeboot, "EspNowOtaSafeboot", "ftp://server/x.bin");
  CHECK(answered("EspNowOtaSafeboot <http://"), "and a url that is not http is not one");
}

static void test_safeboot_writer(void) {
  printf("-- a safeboot image written a piece at a time, as a script that fetches it another way writes it\n");
  Bytes image = read_file(g_fixture + "/safeboot.bin");
  Bytes sig = read_file(g_fixture + "/safeboot.bin.sig.json");
  Bytes record = from_hex(json_field(sig, "record").c_str());
  Bytes signature = from_hex(json_field(sig, "signature").c_str());
  CHECK(record.size() == ESPNOW_OTA_SIGNED_LEN && signature.size() == 64, "the record and signature, read from the image's .sig.json");
  auto setup = [&]() {
    link_world();
    flash_reset();
    g_image_verify_fails = false;
  };
  // the image given in pieces of 4 KB, as it comes through a neighbour
  auto give = [&](uint32_t from, uint32_t to) {
    bool ok = true;
    for (uint32_t at = from; ok && (at < to); at += 4096) {
      uint32_t n = (to - at < 4096) ? to - at : 4096;
      ok = EspNowOtaSafebootWrite(at, image.data() + at, n);
    }
    return ok;
  };

  setup();
  bool kept = true;
  const char* why = EspNowOtaSafebootBegin(record.data(), signature.data(), &kept);
  CHECK(!why && !kept && g_factory_erases == 0 && !g_nvs.count("espnowota_sb/writing"), "begun: nothing erased before the first bytes come");
  // the first bytes as a carrier that ends a binary file at its first zero byte leaves them: the image's header, then what memory held
  Bytes spoilt(image.begin(), image.begin() + 4096);
  for (size_t i = 9; i < spoilt.size(); i++) { spoilt[i] = (uint8_t)(i * 37); }
  CHECK(!EspNowOtaSafebootWrite(0, spoilt.data(), spoilt.size()) && g_factory_erases == 0 && !EspNowOtaSafebootUnfinished(),
        "a first piece that is not an app image's (no description at offset 32): refused before anything is erased, the image there left whole");
  CHECK(!EspNowOtaSafebootWrite(0, image.data(), 20), "and so is one too short to tell");
  CHECK(give(0, 8192) && g_factory_erases == 1 && g_nvs["espnowota_sb/writing"] == Bytes{ 1 } && EspNowOtaSafebootUnfinished(),
        "the first bytes: the first 64 KB block erased, and the write said unfinished, in NVS, across a restart");
  CHECK(!EspNowOtaSafebootWrite(16384, image.data() + 16384, 4096), "bytes that are not the next ones are refused");
  CHECK(!EspNowOtaSafebootWrite(8192, image.data() + 8192, 300000), "and so are bytes past the image's end");
  CHECK(give(8192, 300000) && g_factory_erases == 5 && !g_flash_bad_write, "the rest, the partition erased a block at a time as the write reaches it");
  CHECK(first_sector_erased() && !memcmp(g_factory_flash.data() + 4096, image.data() + 4096, image.size() - 4096),
        "the whole image given, all of it is in the partition but its first sector: until the image checks, the boot loader starts the app");
  why = EspNowOtaSafebootFinish();
  CHECK(!why && !memcmp(g_factory_flash.data(), image.data(), image.size()) && !g_flash_bad_write, "finished: checked, and its first sector written last");
  Bytes kept_record = record;
  kept_record.insert(kept_record.end(), signature.begin(), signature.end());
  CHECK(g_nvs["espnowota_sb/record"] == kept_record, "its record kept");
  CHECK(!g_nvs.count("espnowota_sb/writing") && !EspNowOtaSafebootUnfinished() && logged("written and checked"), "and the write no longer unfinished");
  CHECK(EspNowOtaSafebootKnown(), "EspNowOtaArm knows the image by its record");
  CHECK(!EspNowOtaSafebootWrite(0, image.data(), 4096) && EspNowOtaSafebootFinish(), "with nothing begun, nothing is written or finished");

  int erases = g_factory_erases;
  why = EspNowOtaSafebootBegin(record.data(), signature.data(), &kept);
  CHECK(!why && kept && g_factory_erases == erases, "a partition that holds the image already is kept: nothing erased");

  setup();
  EspNowOtaSafebootBegin(record.data(), signature.data(), &kept);
  give(0, 4096);
  Bytes wrong(image.begin() + 4096, image.begin() + 8192);
  wrong[100] ^= 1;
  EspNowOtaSafebootWrite(4096, wrong.data(), wrong.size());
  give(8192, 300000);
  why = EspNowOtaSafebootFinish();
  CHECK(why && std::string(why).find("not the one signed") != std::string::npos && first_sector_erased(),
        "one byte that went wrong on its way: refused, and the first sector never written, so the boot loader starts the app");
  CHECK(EspNowOtaSafebootUnfinished() && !g_nvs.count("espnowota_sb/record") && !EspNowOtaSafebootKnown(),
        "the write still unfinished, no record kept, and EspNowOtaArm knows no image there");

  setup();
  EspNowOtaSafebootBegin(record.data(), signature.data(), &kept);
  give(0, 200000);
  why = EspNowOtaSafebootFinish();
  CHECK(why && std::string(why).find("not whole") != std::string::npos && first_sector_erased() && EspNowOtaSafebootUnfinished(),
        "a write that stops halfway: not whole, and no image the boot loader would start");
  setup();
  EspNowOtaSafebootBegin(record.data(), signature.data(), &kept);
  why = EspNowOtaSafebootFinish();
  CHECK(why && g_factory_erases == 0 && !EspNowOtaSafebootUnfinished(), "one given nothing erased nothing, and leaves the partition as it was");

  setup();
  Bytes forged = record;
  forged[10] ^= 1;
  why = EspNowOtaSafebootBegin(forged.data(), signature.data(), &kept);
  CHECK(why && std::string(why).find("not signed") != std::string::npos && !EspNowOtaSafebootWrite(0, image.data(), 4096) && g_factory_erases == 0,
        "a record its signature does not check: nothing begun, nothing erased");
  g_running_factory = 1;
  why = EspNowOtaSafebootBegin(record.data(), signature.data(), &kept);
  CHECK(why && std::string(why).find("no safeboot partition") != std::string::npos, "the safeboot image does not write itself");
  g_running_factory = 0;
}

// The receiver armed with a release's address, the station connected on the mesh's channel, and the server holding the fixture's releases
static void http_world(const char* url) {
  reset_world();
  g_http.clear(); g_http_gets = 0; g_http_stalls = 0; g_http_after = nullptr;
  for (const char* r : { "living", "other" }) {
    std::string at = std::string("http://server/") + r + ".ota/";
    g_http[at + "manifest.json"] = read_file(g_fixture + "/" + r + ".ota/manifest.json");
    g_http[at + "blocks.bin"] = read_file(g_fixture + "/" + r + ".ota/blocks.bin");
  }
  mesh_record(7, 6, true);
  g_nvs["espnowota/armed"] = { 1 };
  std::string u(url);
  g_nvs["espnowota/url"] = Bytes(u.begin(), u.end());
  g_nvs["espnowota/url"].push_back(0);
  g_wifi_connected = true;
  g_channel = 6;
}
// The receiver's loop with the time going by, a second's work every ten turns, until its image is done or `ms` have gone
static void run_receiver(uint32_t ms) {
  for (uint32_t t = 0; (t < ms) && (kOtaDone != EspNowOta.state); t += 100) {
    g_millis += 100;
    if (0 == t % 1000) { second(TasmotaGlobal.uptime + 1); }
    Xdrv104(FUNC_LOOP);
  }
}

static void test_http_receive(void) {
  printf("-- the image over HTTP, from the server\n");
  Bytes image = read_file(g_fixture + "/image.bin");
  http_world("http://server/living.ota");
  EspNowOtaBootMagic = ESPNOW_OTA_BOOT_MAGIC;                      // two quick installs before this one, with no power cut between
  EspNowOtaBoots = 2;
  Xdrv104(FUNC_INIT);
  second(1);
  CHECK(!EspNowOtaWifiQuiet() && g_wifi_connected, "armed with a release's address, a station connected is not parked");
  run_receiver(120000);
  CHECK(EspNowOta.state == kOtaDone && flash_holds(image, 0, image.size()), "the release, fetched over HTTP, is written whole");
  CHECK(0 == EspNowOtaBoots, "and an install that ends well ends the count of quick starts: the next one is no third in a row");
  CHECK(g_boot == &g_app && TasmotaGlobal.restart_flag == 3 && !g_nvs.count("espnowota/url"), "and checked, and set to boot, the NVS cleared");
  CHECK(!strcmp(EspNowOta.sender_name, "the server") && logged("Fetching the release at http://server/living.ota, from block 1"), "the page says it comes from the server");
  int parts = 0;
  for (uint32_t i = 0; i < EspNowOta.http_blocks; i++) { parts += (EspNowOta.http_length[i] + ESPNOW_OTA_HTTP_CHUNK - 1) / ESPNOW_OTA_HTTP_CHUNK; }
  CHECK(g_http_gets == 1 + parts, "the manifest, then the blocks in parts of ESPNOW_OTA_HTTP_CHUNK, each once");

  printf("-- over HTTP after a restart: from the block written last\n");
  http_world("http://server/living.ota");
  Xdrv104(FUNC_INIT);
  second(1);
  for (int i = 0; (i < 2000) && (EspNowOta.block < 2); i++) { g_millis += 100; Xdrv104(FUNC_LOOP); }
  CHECK(EspNowOta.block == 2, "two blocks written");
  power_cycle();
  g_http_gets = 0;
  Xdrv104(FUNC_INIT);
  second(1);
  run_receiver(120000);
  CHECK(EspNowOta.state == kOtaDone && flash_holds(image, 0, image.size()) && logged("from block 3"), "the rest of it, from the third block");
  CHECK(g_http_gets < 1 + parts, "and the two blocks written are not fetched again");

  printf("-- a release the server does not have, one signed by a key no build carries, and a WiFi that does not come up\n");
  http_world("http://server/none.ota");
  Xdrv104(FUNC_INIT);
  second(1);
  run_receiver(60000);
  CHECK(logged("could not be fetched, the mesh may bring it") && !EspNowOta.url[0] && g_http_gets == ESPNOW_OTA_HTTP_TRIES,
        "a release not found is asked ESPNOW_OTA_HTTP_TRIES times, then left to the mesh");
  CHECK(!EspNowOtaWifiQuiet() && EspNowOta.radio, "which reaches the device on the mesh's channel");

  http_world("http://server/other.ota");
  Xdrv104(FUNC_INIT);
  second(1);
  run_receiver(30000);
  CHECK(logged("Offer refused, its signature does not check") && logged("is refused, the mesh may bring another") && !EspNowOta.url[0] && g_erases == 0,
        "one signed by another key is refused before anything is written, and not asked again");

  http_world("http://server/living.ota");
  g_wifi_connected = false;
  Xdrv104(FUNC_INIT);
  second(10);
  CHECK(!EspNowOtaWifiQuiet() && g_http_gets == 0, "the WiFi not up yet: the station is given its time, and nothing is fetched");
  second(30);
  CHECK(EspNowOtaWifiQuiet() && g_channel == 6, "nor up after 30 s: parked on the mesh's channel, for a neighbour");
}

static void test_upgrade(void) {
  printf("-- the app's upgrade over HTTP, through the safeboot image\n");
  const char* both = "http://server/living.ota http://server/houseweave-safeboot.bin";
  Bytes safeboot = read_file(g_fixture + "/safeboot.bin");
  Bytes signature = read_file(g_fixture + "/safeboot.bin.sig.json");
  Bytes image = read_file(g_fixture + "/image.bin");
  auto setup = [&]() {
    link_world();
    flash_reset();
    g_http["http://server/houseweave-safeboot.bin"] = safeboot;
    g_http["http://server/houseweave-safeboot.bin.sig.json"] = signature;
    g_http["http://server/other.ota/manifest.json"] = read_file(g_fixture + "/other.ota/manifest.json");
    g_http_gets = 0;
    g_http_after = nullptr;
    g_image_verify_fails = false;
    g_to_safeboot = 0;
    TasmotaGlobal.restart_flag = 0;
  };
  setup();
  command(CmndEspNowOtaUpgrade, "EspNowOtaUpgrade", both);
  CHECK(answered("\"Size\":200000,\"Safeboot\":\"Written\"") && !memcmp(g_factory_flash.data(), safeboot.data(), safeboot.size()),
        "the release checked, then the safeboot image written");
  std::string armed_url = g_nvs.count("espnowota/url") ? std::string((const char*)g_nvs["espnowota/url"].data()) : "";
  CHECK(g_nvs["espnowota/armed"] == Bytes{ 1 } && armed_url == "http://server/living.ota" && g_to_safeboot == 1 && TasmotaGlobal.restart_flag == 2,
        "and the device armed with the release's address, and restarted into it");
  power_cycle();                                                   // the safeboot image starts, with what the app left in the NVS
  g_wifi_connected = true;
  g_channel = 6;
  Xdrv104(FUNC_INIT);
  second(1);
  run_receiver(120000);
  CHECK(EspNowOta.state == kOtaDone && flash_holds(image, 0, image.size()) && g_boot == &g_app, "which fetches the release over HTTP and takes it whole");

  setup();
  memcpy(g_factory_flash.data(), safeboot.data(), safeboot.size());
  command(CmndEspNowOtaUpgrade, "EspNowOtaUpgrade", both);
  CHECK(answered("\"Safeboot\":\"Kept\"") && g_factory_erases == 0 && g_to_safeboot == 1, "a partition that holds the safeboot image is kept");

  setup();
  command(CmndEspNowOtaUpgrade, "EspNowOtaUpgrade", "http://server/none.ota http://server/houseweave-safeboot.bin");
  CHECK(answered("the release could not be fetched or read") && g_factory_erases == 0 && !g_nvs.count("espnowota/url") && g_to_safeboot == 0,
        "a release the server does not have: nothing written, no restart");
  setup();
  command(CmndEspNowOtaUpgrade, "EspNowOtaUpgrade", "http://server/other.ota http://server/houseweave-safeboot.bin");
  CHECK(answered("the release is not signed by a key of this build") && g_factory_erases == 0 && g_to_safeboot == 0, "nor one signed by another key");
  setup();
  g_http["http://server/houseweave-safeboot.bin.sig.json"] = read_file(g_fixture + "/safeboot-other.sig.json");
  command(CmndEspNowOtaUpgrade, "EspNowOtaUpgrade", both);
  CHECK(answered("the image is not signed by a key of this build") && g_factory_erases == 0 && g_to_safeboot == 0, "nor with a safeboot image signed by another key");
  setup();
  command(CmndEspNowOtaUpgrade, "EspNowOtaUpgrade", "http://server/living.ota");
  CHECK(answered("EspNowOtaUpgrade <http://release> <http://safeboot.bin>"), "the two addresses are asked for");
}

int main(int argc, char** argv) {
  g_fixture = argc > 1 ? argv[1] : "";
  test_signature();
  test_no_house();
  test_beacon();
  test_park();
  test_sender_name_and_hotspot();
  test_offer();
  test_transfer_and_resume();
  test_bad_block();
  test_wrong_image();
  test_display_template();
  test_display_page();
  test_display_waiting_and_hotspot();
  test_display_updating();
  if (g_fixture.empty()) {
    printf("-- the sender and the receiver: skipped, no fixture (run.mjs makes it)\n");
  } else {
    test_link();
    test_safeboot_install();
    test_safeboot_writer();
    test_http_receive();
    test_upgrade();
  }
  test_boot_guard();
  test_armed_wait();
  if (g_failures) {
    printf("%d of %d checks failed\n", g_failures, g_checks);
    return 1;
  }
  printf("all %d checks passed\n", g_checks);
  return 0;
}
