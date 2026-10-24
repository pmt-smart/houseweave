# The house's safeboot in every factory image.
#
# firmware/safeboot/houseweave-safeboot.bin is the safeboot the house's key signed
# (scripts/ota-release.mjs publish writes it and its .sig.json beside it). Before
# the build, it goes where Tasmota's pio-tools/post_esp32.py takes the safeboot
# of every firmware.factory.bin from, variants/tasmota/tasmota32-safeboot.bin:
# post_esp32.py fetches Tasmota's own only when that file is not there. And the
# app is told its size and SHA-256 (ESPNOW_OTA_SAFEBOOT_SIZE and
# ESPNOW_OTA_SAFEBOOT_SHA256), so that EspNowOtaArm knows it on a device flashed
# with the factory image, which never took a safeboot from the server and keeps
# no record of one. The file's signed record must say the same size and SHA-256,
# or the build stops: a safeboot nobody signed is not put in a factory image.
# The record and its signature go in too (ESPNOW_OTA_SAFEBOOT_RECORD and
# ESPNOW_OTA_SAFEBOOT_SIGNATURE), and the app keeps them on a device it finds
# holding this safeboot: without them, an app that pins another safeboot would
# not know this one, and a device out of the Wi-Fi's reach, which only takes a
# safeboot over HTTP, would take no image again.
# safeboot_check.py checks the factory image against the same file.
#
# Runs as a `pre:` script of every panel and bridge env.

Import("env")

import hashlib
import json
import os
import shutil
import sys

repo = os.path.normpath(os.path.join(env.subst("$PROJECT_DIR"), "..", ".."))
safeboot = os.path.join(repo, "firmware", "safeboot", "houseweave-safeboot.bin")
variants = os.path.join(env.subst("$PROJECT_DIR"), "variants", "tasmota", "tasmota32-safeboot.bin")


def stop(why):
    sys.stderr.write("safeboot_pin.py: %s\n" % why)
    env.Exit(1)


if not os.path.isfile(safeboot) or not os.path.isfile(safeboot + ".sig.json"):
    stop("%s and its .sig.json are the safeboot of every factory image: they are not there" % safeboot)
with open(safeboot, "rb") as f:
    data = f.read()
sha = hashlib.sha256(data).hexdigest()
with open(safeboot + ".sig.json", encoding="utf-8") as f:
    signed = json.load(f)
if signed.get("size") != len(data) or str(signed.get("sha256", "")).lower() != sha:
    stop("the signed record in %s.sig.json is not of %s (%d bytes, SHA-256 %s)" % (safeboot, safeboot, len(data), sha))
# the record: size (4 bytes, little-endian), 0 blocks (2), 0 KB (1) and the SHA-256 (32)
record = str(signed.get("record", "")).lower()
signature = str(signed.get("signature", "")).lower()
try:
    record_bytes = bytes.fromhex(record)
    signature_bytes = bytes.fromhex(signature)
except ValueError:
    record_bytes = signature_bytes = b""
if (len(record_bytes) != 39 or len(signature_bytes) != 64 or int.from_bytes(record_bytes[0:4], "little") != len(data)
        or record_bytes[4:7] != b"\0\0\0" or record_bytes[7:].hex() != sha):
    stop("the record and signature in %s.sig.json are not a signed record of %s (%d bytes, SHA-256 %s)" % (safeboot, safeboot, len(data), sha))

os.makedirs(os.path.dirname(variants), exist_ok=True)
if not os.path.isfile(variants) or hashlib.sha256(open(variants, "rb").read()).hexdigest() != sha:
    shutil.copyfile(safeboot, variants)
    print("safeboot_pin.py: the house's safeboot (%d bytes, %s) is the factory image's" % (len(data), sha[:16]))

env.Append(CPPDEFINES=[("ESPNOW_OTA_SAFEBOOT_SIZE", len(data)), ("ESPNOW_OTA_SAFEBOOT_SHA256", env.StringifyMacro(sha)),
                       ("ESPNOW_OTA_SAFEBOOT_RECORD", env.StringifyMacro(record)),
                       ("ESPNOW_OTA_SAFEBOOT_SIGNATURE", env.StringifyMacro(signature))])
