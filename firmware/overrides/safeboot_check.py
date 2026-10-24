# Holds each factory image's safeboot to the house's.
#
# The safeboot of every firmware.factory.bin is firmware/safeboot/houseweave-safeboot.bin,
# the one the house's key signed, which safeboot_pin.py puts where Tasmota's
# pio-tools/post_esp32.py takes it from. A broken safeboot does not stop the boot
# -- the bootloader starts app0 -- but it ends the OTA for good: every update goes
# through it. So once the factory image is made, the safeboot's bytes in it are
# held to that file, byte for byte, and a build whose safeboot is another stops,
# with its factory images taken away.
#
# Runs as a `post:` script after Tasmota's: its action on the .bin comes after
# the one that makes the factory image and the one that copies it to
# build_output (pio-tools/name-firmware.py).

Import("env")

import csv
import hashlib
import os
import pathlib
import sys

SAFEBOOT = os.path.join(os.path.normpath(os.path.join(env.subst("$PROJECT_DIR"), "..", "..")), "firmware", "safeboot", "houseweave-safeboot.bin")


# The safeboot partition's offset, from the env's partition table; None when it
# has none
def safeboot_offset(env):
    with open(os.path.join(env.subst("$PROJECT_DIR"), env.BoardConfig().get("build.partitions")), newline="") as f:
        for row in csv.reader(f):
            if len(row) > 3 and row[0].strip() == "safeboot":
                return int(row[3].strip(), 0)
    return None


# The SHA-256 of `size` bytes at `offset` of a factory image, or None when the
# image is too short to hold them
def safeboot_sha256(path, offset, size):
    with open(path, "rb") as f:
        f.seek(offset)
        data = f.read(size)
    if len(data) != size:
        return None
    return hashlib.sha256(data).hexdigest()


# The factory images this build made: the one in the build directory and its
# copy in build_output, beside the .bin name-firmware.py copied there
def factory_images(env):
    tools = os.path.join(env.subst("$PROJECT_DIR"), "pio-tools")
    if tools not in sys.path:
        sys.path.append(tools)
    import tasmotapiolib
    images = [env.subst("$BUILD_DIR/${PROGNAME}.factory.bin")]
    final = pathlib.Path(str(tasmotapiolib.get_final_bin_path(env))).with_suffix("")
    images.append(os.path.normpath(str(final.with_suffix(final.suffix + ".factory.bin"))))
    return images


def check_safeboot(source, target, env):
    offset = safeboot_offset(env)
    images = factory_images(env)
    if offset is None or not os.path.isfile(images[0]):
        print("safeboot_check.py: no factory image with a safeboot to check")
        return 0
    with open(SAFEBOOT, "rb") as f:
        pinned = f.read()
    want = hashlib.sha256(pinned).hexdigest()
    got = safeboot_sha256(images[0], offset, len(pinned))
    if got == want:
        print("safeboot_check.py: the factory image's safeboot is the house's (%s)" % want[:16])
        return 0
    for image in images:
        if os.path.isfile(image):
            os.remove(image)
    sys.stderr.write(
        "safeboot_check.py: the safeboot in the factory image is not the house's: its %d bytes at 0x%X hash to %s, "
        "and %s hashes to %s. The factory images are taken away: a broken safeboot ends the OTA for good.\n"
        % (len(pinned), offset, got, SAFEBOOT, want))
    return 1


env.AddPostAction("$BUILD_DIR/${PROGNAME}.bin", env.Action(check_safeboot, "Checking the safeboot of the factory image"))
