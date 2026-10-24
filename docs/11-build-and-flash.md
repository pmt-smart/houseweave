# 11 — Build and flash

HouseWeave writes no firmware from scratch: it builds **Tasmota** from source, in our fork, with the override mechanism Tasmota itself offers
(`user_config_override.h` and `platformio_override.ini`).

## 1. Where things are

- `firmware/tasmota/` — a git submodule of our fork of Tasmota, [pmt-smart/Tasmota](https://github.com/pmt-smart/Tasmota), on top of an
  official Tasmota release. Its code is not edited loose: our C, drivers and fixes, are commits on `fix/` and `feature/` branches of the
  fork, each stacked on the one before and pushed to it before the commit of this repository that points at it. A build leaves nothing
  changed there.
- `firmware/overrides/` — our build configuration: `user_config_override.h`, `platformio_override.ini` and the build's scripts.
- `firmware/safeboot/` — the house's safeboot image and its signature (§6).
- `firmware/host-tests/` — host tests of the fork's C that has no test of its own: the mesh driver and the safeboot's OTA receiver.

A patch to the fork is written as if it were to go upstream: standard terms, no reference to this repository's docs, and behind a
`#define USE_...` or `NO_USE_...` switch, the way Tasmota does it. The reasons live in these docs, not in the patch.

## 2. Building

1. Clone with the submodules: `git submodule update --init --recursive`.
2. Install PlatformIO **from pioarduino** (the `pioarduino` package on PyPI), not the official `platformio`: Tasmota's platform expects its
   SCons, and with the official one the link fails. On Windows, run from PowerShell.
3. Build with the script:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1 tasmota32-houseweave-living-room-us tasmota32-houseweave-bridge
   ```

   With no env named it builds every product env, one after the other. It copies our overrides into the submodule (PlatformIO only looks
   there, and Tasmota's own `.gitignore` leaves those files out, so the source copies live in `firmware/overrides/`), and at the end gives the
   submodule back the files the build rewrites. `-DryRun` says what it would build and stops.

**The envs** (`firmware/overrides/platformio_override.ini`):

| env | what it is |
|---|---|
| `tasmota32-houseweave` | the base the others extend. **Not a product image**: no device template, and an ESP-NOW driver that runs the commands it hears. The script refuses it by name unless told `-AllowBase` |
| `tasmota32-houseweave-living-room-eu`, `-living-room-us` | a panel image (EU landscape, US portrait), with the panel's template (`HOUSEWEAVE_PANEL_IMAGE`) and the brain compiled in |
| `tasmota32-houseweave-bridge` | the ZBBridge Pro's image (`HOUSEWEAVE_BRIDGE_IMAGE`), with the bridge's brain compiled in and Zigbee2Tasmota |
| `tasmota32-houseweave-safeboot` | the house's safeboot (§6) |
| `tasmota32-probe-living-room-us`, `-bridge` | bench images with the mesh's probe (`USE_ESPNOW_MESH_PROBE`) |

The override's `default_envs` is the Living room US panel: a bare `pio run` in the submodule builds a product image, never the base.

**A new room** is a new panel env, like the Living room's: the name `tasmota32-houseweave-<room>` (the script finds it), `-DHOUSEWEAVE_PANEL_IMAGE`
in its `build_flags`, its `custom_panel_project`, a staging directory of its own in `custom_files_upload`, and `panel_files.py` in its
`extra_scripts`. The firmware is the same as the others'.

**What a build checks before it starts**: a name that is not an env of the override is refused; a submodule at another commit than the one
this repository's `HEAD` records, or with a tracked file changed, is warned about (not refused: a change of the fork is a commit there, a build
and its numbers, and only then the commit here).

## 3. What goes into an image

- **The brain is in the app.** The env's `custom_berry_solidify` lists the build's prelude (`firmware/overrides/_brain_prelude.be`) and the
  brain's files; Tasmota's `solidify-from-url.py` compiles them into the firmware ([12 §1](12-berry-notes.md)). The panel's list and the
  bridge's are different: each image has only its own role's classes.
- **The brain knows its build.** `berry/panel_build.be` says "dev" in the repository; before the solidifying, `firmware/overrides/panel_build.py`
  writes a copy with the stamp `<repository>/<fork>` (both `HEAD`s, e.g. `6224248a/d4e9afd6`) and the build's time. A `+` after the
  repository's commit says a tracked file differed from it; a `+` after the fork's says the fork is not at the commit this repository records,
  or had a tracked file changed. The Info of Main settings shows the stamp. `scripts/build-stamp.test.mjs` checks the arithmetic.
- **A panel's file system** is made by `firmware/overrides/panel_files.py`: the root `autoexec.be` with the env's `PANEL_PROJECT`, the
  project's tables (`<project>.jsonl`, from `libs/nspanel-sim/export/hmi-scenarios/`), and, when a compiled screen is there, the
  `<project>.tft` (compressed, `berry/tft_pack.be` inflates it while flashing the screen) with its `<project>.tft.stamp`. The script stops the
  build when the tables are missing or have CR, when the `.tft` is of another generation of the tables, or when it has no passing preflight
  record (`<project>.preflight.json`, from `libs/nspanel-sim/export/scripts/preflight-tft.mjs --record`), and says the command that is missing.
  Without a `.tft`, the image goes without the screen. HouseWeave's generator writes the tables and the screen's scenario but does not yet
  write a whole `.tft`: a compiled one is placed in `libs/nspanel-sim/export/hmi-scenarios/out/`.
- **The bridge's file system** is made by `firmware/overrides/bridge_files.py`: its `autoexec.be` (`berry/zbbridge_autoexec.be` under the name
  Tasmota runs) and the CC2652's flasher with the coordinator's `.hex`. The bridge flashes that `.hex` by itself when the coordinator reports
  another firmware version: after the pairing, up to 3 tries counted in `persist`, with the bridge silent for 5 to 8 minutes and a restart at
  the end.
- **The images** come out in `firmware/tasmota/build_output/firmware/`: `<env>.factory.bin` for a serial flash and `<env>.bin` for OTA. After
  each env the script keeps both in `releases/` (git-ignored) with the stamp in the name, never overwriting: a different content under the
  same name becomes `-2`, `-3`.
- **The build forces a new image every time**, so that a change only in the project's tables makes one.

## 4. Partitions

| offset | size | partition | what it holds |
|---|---|---|---|
| 0x1000 | — | bootloader | |
| 0x8000 | — | partition table | |
| 0x9000 | 20 KB | `nvs` | Tasmota's configuration and the drivers' records (the mesh's, the buttons', the boot rescue's count) |
| 0xE000 | 8 KB | `otadata` | which app boots |
| 0x10000 | 832 KB | `safeboot` | the house's safeboot (§6) |
| 0xE0000 | 2 176 KB on a panel, 1 856 KB on a bridge | `app0` | our firmware, with the brain |
| 0x300000 on a panel, 0x2B0000 on a bridge | 1 024 KB on a panel, 1 344 KB on a bridge | file system | the image's files, the brain's `_persist.json`, a copy of Tasmota's configuration (`/.settings`) and, on a bridge, the Zigbee devices |

The panels' table is `firmware/overrides/esp32_partition_app2176k_fs1024k.csv`; the bridge keeps the official
`firmware/tasmota/partitions/esp32_partition_app1856k_fs1344k.csv`. **An OTA writes only the app**: the bootloader, the table and the safeboot
are written by a serial flash alone, and a device still on an older table does not take by OTA an app larger than that table's `app0`.

## 5. Flashing

**The first flash of a device is serial**, with our `<env>.factory.bin`:

```bash
esptool --chip esp32 --port <COM> --baud 230400 write_flash 0x0 <env>.factory.bin
```

It writes the bootloader, the table, the safeboot, the app and the file system in one go, and **erases the NVS**: Tasmota's configuration
starts over (the template and the time zone come back from the firmware), and a bridge's Zigbee network with it. So a factory image is for a
new device or the bench, never for a bridge whose lamps are paired. Before flashing a device that runs another firmware, read the whole 4 MB
back (`read-flash 0 0x400000 <file>`): it is the only way back. Bench notes from flashing: at 460 800 baud a read can corrupt and leave the
`esptool` stub stuck, so 230 400 it is; `--after no-reset` keeps the chip in the bootloader, so that the first boot is the one with the screen
connected.

An official image is not a first flash: the NSPanel's does not carry the brain and uses another 4 MB layout, and the ZBBridge Pro's factory
image applies the bridge's template. A device that already runs official Tasmota needs the serial flash too.

**After that, the app only, over the network**: the house's OTA ([06](06-ota-and-backup.md)), from the server's House tab or a node's OTA row
in Wireless settings, or Tasmota's own Firmware Upgrade page with the `<env>.bin`. Every update goes through the safeboot: the app restarts
into it, the safeboot writes `app0` and marks it bootable only after checking what it wrote, and an interrupted upload leaves the device
waiting in the safeboot for another.

## 6. The house's safeboot

The images carry **the house's safeboot**, `firmware/safeboot/houseweave-safeboot.bin`, signed (`firmware/safeboot/houseweave-safeboot.bin.sig.json`): a
Tasmota safeboot with HTTP (no TLS: the house's server is plain HTTP on the LAN, and every image is signed) and the mesh's OTA receiver, which
takes an app image from a neighbour over ESP-NOW, and on a panel shows it on the screen's "safeboot" page.

- **The build pins it.** `firmware/overrides/safeboot_pin.py` checks that the signed record beside the file says its size and SHA-256 (a
  safeboot nobody signed goes into no factory image), copies it where Tasmota's `post_esp32.py` takes it from, and gives the app its size and
  SHA-256 (`ESPNOW_OTA_SAFEBOOT_SIZE`, `ESPNOW_OTA_SAFEBOOT_SHA256`): that is how `EspNowOtaArm` knows a device fresh from the factory has a
  safeboot that receives over the mesh. `firmware/overrides/safeboot_check.py` then reads the safeboot's bytes from 0x10000 of the factory
  image and compares them to the file; when they differ it stops the build and deletes both copies of the factory image.
- **A new safeboot** is built with the safeboot env, signed by `node scripts/ota-release.mjs publish`, and only then put in
  `firmware/safeboot/`.
- **The keys**: releases are signed with the house's Ed25519 key, a PEM file **outside the repository** (`HOUSEWEAVE_RELEASE_KEY` names it; by
  default `../HouseWeave-keys/release-ed25519.pem` beside the repository). Losing it means no new release the devices take. Its public
  half is compiled into the app and the safeboot (`ESPNOW_OTA_PUBLIC_KEYS` in `user_config_override.h`); a new key comes as a second one there,
  in a release the old key signs, before the old one goes.

**The ways into the safeboot**: from the app, `Restart 3` (which toggles between the app and the safeboot), the upload page, `Upgrade 1` or
`EspNowOtaArm`; by itself, an empty or invalid `otadata`, an invalid `app0` header, or the 10th fast crash in a row. There is no physical way:
the bootloader has no GPIO factory reset.

## 7. Releases

`scripts/ota-release.mjs`:

```
node scripts/ota-release.mjs key                          the house's key: made once, never written over; prints its public half
node scripts/ota-release.mjs public                       the public half, as the C string ESPNOW_OTA_PUBLIC_KEYS takes
node scripts/ota-release.mjs pack <image.bin>             an app image cut into blocks for the mesh and for HTTP, with its manifest
node scripts/ota-release.mjs sign <file>                  a file that goes whole over HTTP (the .tft, the .jsonl)
node scripts/ota-release.mjs publish <image.bin>... --to <dir>
                                                          the house's releases, in the folder the release server serves under /ota
```

Each app image is cut into 64 KB blocks, each compressed on its own as a raw deflate stream that the chip's ROM inflates, so a power cut costs
at most one block. The signed record is 39 bytes (size, blocks, block size, SHA-256), and the offer the mesh carries is the record and its
64-byte signature. `publish` also writes `index.json`: the build of each image, which every node's OTA row reads, and each app image's SHA-256,
by which a neighbour knows the release a node waits for in its safeboot.

## 8. What a device does to stay reachable

- **The network at every boot.** The firmware has no Ethernet and turns the Wi-Fi on at every boot, with or without Berry; the boot sends
  `WebServer 2`.
- **A heap floor.** A panel's boot checks the heap after loading the project's tables and its configuration, and gives up its pages below
  60 KB: the rest is for the Wi-Fi, lwIP, the web and the OTA.
- **The buttons belong to the button driver from the first boot**: a double press does not cut a relay, six presses do not open the Wi-Fi
  manager, and seven quick power cycles do not wipe the configuration.
- **The main loop's watchdog** (`USE_ESP32_WDT`): a stuck loop becomes a panic and a restart, and the fourth fast restart boots without Berry.
- **No upgrade URL** (`OTA_URL ""`), so an `Upgrade 1` cannot install an official image over ours.
- **The boot rescue** (`USE_BOOT_RESCUE`): three short boots open the way to a phone, since a device with no saved network opens no access
  point of its own.

**Never on a device that can only be reached over the network**: write the bootloader or the partition table over the network; `Upgrade 2`
(ours does not have it); `SetOption36 0` (it turns off the boot-loop protection); `Restart 2` or `Restart 9` (only a power cut brings it
back); a factory image.

**If something goes wrong**: the app's web (upload, file manager, console; `SetOption153 1` skips `autoexec.be` from the next boot); the
safeboot, on the same IP; the boot-loop protection, only for crashes in the first 10 s of boot (the 4th fast restart boots without Berry, the
10th goes to the safeboot; a crash after 10 s is never caught); a hotspot with the old network's name; and, last, opening the device for the
serial line.

## 9. Before an OTA of a bridge

A bridge's `autoexec.be` loads, over the compiled classes, any of the relay's files it finds on the file system (the list is in
`berry/zbbridge_autoexec.be`): a `.be` left there by an earlier fix would run instead of the class the OTA brought. Before an OTA, list the file
system (`UfsList`) and rename each such file (`UfsRename /<file>.be,/<file>.be.old`). After the boot, the log has a line
`ZBBRIDGE_RELAY: <file> runs from the file system, over the firmware's` for every file that still loaded.

## 10. Going back

- **A device to an earlier app** is the `.bin` from `releases/` through the usual way. If the change between the two touched the format of the
  project's tables (`PanelRuntime.FORMAT` in `berry/panel_runtime.be`), the `.jsonl` and the `.tft` of that build go with it.
- **The repository to an earlier commit**: `git checkout` does not move the submodule. Follow it with `git submodule update` (after a
  `git -C firmware/tasmota fetch` when the commit is not local); `git submodule status` shows a `+` for a submodule out of step, the stamp
  carries one, and the build script warns.
