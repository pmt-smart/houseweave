# host-tests/espnow-ota-receiver

A test on the PC (no device) of the house's OTA over the mesh: the safeboot's receiver and its page on the screen
(`firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_98_5_espnow_ota_receiver.ino` and `xdrv_98_6_espnow_ota_display.ino`) and the app's sender
(`xdrv_98_7_espnow_ota_sender.ino`). The `.ino` files are included as they are in `host_test.cpp`, over the stand-ins of `host_stubs.h` for what
they ask of the ESP-IDF (ESP-NOW, NVS, the app's partition, the boot partition), the ROM's inflate, FreeRTOS, Arduino, the HTTP client, the
mesh driver and Tasmota.

The test plays three parts: the neighbour that sends (building the image in blocks and signing the offer with the test key of RFC 8032), the
screen that answers, and, end to end, the air between the real sender and the real receiver, with the image the releases' tool packs.

What the house's OTA is: [docs/06](../../../docs/06-ota-and-backup.md).

## Command

From the repository's root:

```
node firmware/host-tests/espnow-ota-receiver/run.mjs
```

Before compiling, it packs an image of 200 000 bytes with `scripts/ota-release.mjs` into `.build/fixture/` (the manifest and the blocks, as a
release). It compiles `host_test.cpp` with emscripten, runs the result with Node, and exits with 0 when every check passes (the last line says
`all <N> checks passed`). On a failure it shows each failed check and exits with 1. The first run also compiles the BearSSL units and the fork's
`JsonParser` into `.build/` (ignored by git). `node scripts/verify.mjs ota` runs it. What to install is as for
[the mesh driver's test](../espnow-mesh-driver/README.md).

## What is real and what is a stand-in

- **Real:** the receiver, the screen's page and the sender; the firmware's Ed25519 (`tasmota/include/ed25519.h`, checked against the first
  vector of RFC 8032); the SHA-256, SHA-512, HMAC and HKDF of the submodule's BearSSL; the fork's `JsonParser`; and the image packed by the
  releases' tool.
- **Stand-ins:** the ROM's `tinfl_decompress`, by Node's `zlib` (the same raw deflate, through `EM_JS`); the partition's flash, which only clears
  bits on a write, as the real one, and reports a write over what was not erased; NVS, a map; the radio, a list of the frames sent, with who sent
  them, which the test delivers to the other side (and can lose one in N); the HTTP server, the files in memory, with `Range`; the screen's
  serial line, what was written and what the screen says back; and of the mesh driver only the radio, the lock, the peers and the record.
- **What the PC does not prove:** the ROM's inflate itself, the radio's timing, the Wi-Fi that sweeps the channels, a panel's heap while it
  sends, and the boot of the new image. Those are the bench's.
