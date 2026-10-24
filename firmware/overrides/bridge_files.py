# Stages the filesystem image of the ZBBridge Pro for this build.
#
# The relay is compiled into the firmware (`custom_berry_solidify`):
# ZbBridgeRelay, ZbBridgeRelayPairing, ZbBridgeDiscovery,
# ZbBridgeDrivers, ZbDriverThermostat and PairSign. What the
# bridge keeps as files is what starts it and what is its own. An env that says
# `custom_bridge_image = yes` gets, in the LittleFS image Tasmota's
# pio-tools/post_esp32.py merges into firmware.factory.bin:
#   - autoexec.be, which is berry/zbbridge_autoexec.be under the name Tasmota
#     runs at boot;
#   - Tasmota's own flasher of the ZBBridge Pro's CC2652P and the coordinator's
#     firmware it flashes, as the official image carries them (the entries of
#     `custom_bridge_extra`, relative to the Tasmota tree).
#
# The env's `custom_files_upload` names ONE directory: the files are staged
# there, and post_esp32.py copies that directory into the image. Only a serial
# flash of firmware.factory.bin writes the filesystem; an OTA upload of
# firmware.bin writes the app, which is where the relay is.
#
# Runs as a `post:` script, as panel_files.py does, and for the same reason: the
# image is made by a post-action on the .bin.

Import("env")

import os
import shutil
import sys


def fail(message):
    sys.stderr.write("bridge_files.py: " + message + "\n")
    env.Exit(1)


if env.GetProjectOption("custom_bridge_image", "").strip().lower() in ("yes", "true", "1"):
    project_dir = env.subst("$PROJECT_DIR")
    repo = os.path.normpath(os.path.join(project_dir, "..", ".."))

    # autoexec.be starts the relay the firmware carries: an image without it
    # compiled in would start nothing
    solidified = env.GetProjectOption("custom_berry_solidify", "")
    if "zbbridge_relay.be" not in solidified:
        fail("the env compiles no relay into the firmware (custom_berry_solidify), and autoexec.be only starts it")

    entries = [e.strip() for e in env.GetProjectOption("custom_files_upload", "").splitlines() if e.strip()]
    if len(entries) != 1:
        fail("custom_files_upload has to name exactly one directory, the staging one; it names %d entries" % len(entries))
    stage = os.path.normpath(os.path.join(project_dir, entries[0]))

    sources = []
    for rel in [e.strip() for e in env.GetProjectOption("custom_bridge_extra", "").splitlines() if e.strip()]:
        path = os.path.normpath(os.path.join(project_dir, rel))
        if not os.path.isfile(path):
            fail("custom_bridge_extra names %s, and it does not exist" % path)
        sources.append(path)

    # From scratch every time, as panel_files.py does: post_esp32.py gathers the
    # image in $BUILD_DIR/littlefs_data and never empties it
    shutil.rmtree(stage, ignore_errors=True)
    shutil.rmtree(os.path.join(env.subst("$BUILD_DIR"), "littlefs_data"), ignore_errors=True)
    os.makedirs(stage)
    shutil.copy(os.path.join(repo, "berry", "zbbridge_autoexec.be"), os.path.join(stage, "autoexec.be"))
    for path in sources:
        shutil.copy(path, stage)

    total = sum(os.path.getsize(os.path.join(stage, n)) for n in os.listdir(stage))
    print("Bridge files: %d files, %d bytes, staged in %s" % (len(os.listdir(stage)), total, stage))

    # the image is made after the .bin, and only when SCons makes the .bin
    env.AlwaysBuild(env.subst("$BUILD_DIR/${PROGNAME}.bin"))
