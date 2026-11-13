# Stages the filesystem image of an appliance for this build.
#
# The node is compiled into the firmware (`custom_berry_solidify`):
# ApplianceNode, the device it is, NodeHost, NodePairing and the house's
# layer. What the appliance keeps as a file is what starts it. An env that says
# `custom_appliance_image = yes` gets, in the LittleFS image Tasmota's
# pio-tools/post_esp32.py merges into firmware.factory.bin, autoexec.be, which
# is berry/appliance_autoexec.be under the name Tasmota runs at boot, and
# nothing else: the base env's own files, the ZBBridge Pro's, never reach it.
#
# The env's `custom_files_upload` names ONE directory: the file is staged
# there, and post_esp32.py copies that directory into the image. Only a serial
# flash of firmware.factory.bin writes the filesystem; an OTA upload of
# firmware.bin writes the app, which is where the node is.
#
# Runs as a `post:` script, as bridge_files.py does, and for the same reason:
# the image is made by a post-action on the .bin.

Import("env")

import os
import shutil
import sys


def fail(message):
    sys.stderr.write("appliance_files.py: " + message + "\n")
    env.Exit(1)


if env.GetProjectOption("custom_appliance_image", "").strip().lower() in ("yes", "true", "1"):
    project_dir = env.subst("$PROJECT_DIR")
    repo = os.path.normpath(os.path.join(project_dir, "..", ".."))

    # autoexec.be starts the node the firmware carries: an image without it
    # compiled in would start nothing
    solidified = env.GetProjectOption("custom_berry_solidify", "")
    if "appliance_node.be" not in solidified:
        fail("the env compiles no appliance node into the firmware (custom_berry_solidify), and autoexec.be only starts it")

    entries = [e.strip() for e in env.GetProjectOption("custom_files_upload", "").splitlines() if e.strip()]
    if len(entries) != 1:
        fail("custom_files_upload has to name exactly one directory, the staging one; it names %d entries" % len(entries))
    stage = os.path.normpath(os.path.join(project_dir, entries[0]))

    # From scratch every time, as bridge_files.py does: post_esp32.py gathers the
    # image in $BUILD_DIR/littlefs_data and never empties it
    shutil.rmtree(stage, ignore_errors=True)
    shutil.rmtree(os.path.join(env.subst("$BUILD_DIR"), "littlefs_data"), ignore_errors=True)
    os.makedirs(stage)
    shutil.copy(os.path.join(repo, "berry", "appliance_autoexec.be"), os.path.join(stage, "autoexec.be"))

    total = sum(os.path.getsize(os.path.join(stage, n)) for n in os.listdir(stage))
    print("Appliance files: %d files, %d bytes, staged in %s" % (len(os.listdir(stage)), total, stage))

    # the image is made after the .bin, and only when SCons makes the .bin
    env.AlwaysBuild(env.subst("$BUILD_DIR/${PROGNAME}.bin"))
