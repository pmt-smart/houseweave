# Stages the filesystem image of one NSPanel for this build.
#
# The brain is compiled into the firmware (`custom_berry_solidify`),
# so what a panel keeps as files is what is its own. An env that names a
# project (`custom_panel_project`) gets, in the LittleFS image Tasmota's
# pio-tools/post_esp32.py merges into firmware.factory.bin:
#   - autoexec.be from the repository root, with PANEL_PROJECT set to the project;
#   - the project's generated tables, <project>.jsonl, from the exporter's
#     hmi-scenarios/;
#   - any Berry file autoexec.be loads by name, from berry/: none today, since
#     the boot is in the firmware, but a file loaded on purpose rides along;
#   - the project's compiled screen, <project>.tft, from the exporter's
#     hmi-scenarios/out/, when the Nextion Editor has made it, with the stamp it
#     was built with beside it, <project>.tft.stamp: the brain flashes the file
#     to a screen that does not say it runs that stamp. The stamp
#     is read out of the .tft itself, so the two cannot disagree. The .tft goes
#     in only when it is of the tables' own generation -- its stamp ends in
#     their hash -- and when the pre-flight passed that very file, as the record
#     scripts/preflight-tft.mjs --record writes beside it says
#     (<project>.preflight.json). A .tft that is there and fails either stops
#     the build: the brain would give it to every screen it meets. It goes in
#     packed, under the same name: the record's packed copy, <project>.tftz,
#     which the flash reads back as the .tft (berry/tft_pack.be).
#
# The image has to leave the panel room for what it writes at run time
# (MIN_FREE_BLOCKS): the files are laid in an image here as post_esp32.py will
# lay them, and a build whose image leaves less stops.
#
# The env's `custom_files_upload` names ONE directory: the files are staged
# there, and post_esp32.py copies that directory into the image.
#
# Only a serial flash of firmware.factory.bin writes the filesystem. An OTA
# upload of firmware.bin writes the app partition and leaves the files alone.
#
# Runs as a `post:` script: the image is made by a post-action on the .bin,
# whose name (PROGNAME) is only known once the platform's builder has run.

Import("env")

import csv
import hashlib
import json
import os
import re
import shutil
import sys

# up to the line's end, not past it: `.` would take the \r of a CRLF file
PANEL_PROJECT_LINE = re.compile(r"^var PANEL_PROJECT = nil\b[^\r\n]*", re.MULTILINE)
LOADED_FILE = re.compile(r'^[ \t]*load\("([^"]+)"\)', re.MULTILINE)

# the file system's blocks, as post_esp32.py makes its image: LittleFS 2.0
BLOCK_SIZE = 4096
# What the image leaves free, in blocks, for what the panel writes at run time
# with twice the Living room, the most a panel is planned for: its persist file (10.4 KB
# in the simulator, 3 blocks), Tasmota's copy of its settings (/.settings, 1) and
# Z2T's devices in local mode (/zbv4 and /zbdata, about 2). A file written over
# keeps its old blocks until it closes, and the biggest one written so is a
# release's tables, which go over the old ones before the old screen is deleted:
# 6 blocks on the US. Provisional until the bench.
MIN_FREE_BLOCKS = 12


# The stamp a .tft says as its first page loads (panel.version):
# the page's printh keeps its operand as the Editor's source text, the hex pairs
# of "55 BB <len> <len> <payload> <crc> <crc>", and the payload of that one is
# "ev,<page>,page,version,<stamp>". None when it is not there once.
def tft_stamp(data):
    key = " ".join("%02X" % b for b in b",page,version,").encode()
    at = data.find(key)
    if at < 0 or data.find(key, at + 1) >= 0:
        return None
    start = data.rfind(b"55 BB ", max(0, at - 400), at)
    if start < 0:
        return None
    words = data[start:start + 3 * 4].decode("ascii", "replace").split()
    if len(words) != 4:
        return None
    length = int(words[2], 16) | (int(words[3], 16) << 8)
    text = data[start + 12:start + 12 + 3 * length - 1].decode("ascii", "replace").split()
    if len(text) != length:
        return None
    payload = bytes(int(h, 16) for h in text).decode("ascii", "replace")
    marker = ",page,version,"
    if not payload.startswith("ev,") or marker not in payload:
        return None
    return payload.split(marker, 1)[1]


def fail(message):
    sys.stderr.write("panel_files.py: " + message + "\n")
    env.Exit(1)


# The file system partition's size, from the env's partition table, as
# post_esp32.py reads it: the row named spiffs. None when there is none.
def fs_size_of(project_dir):
    with open(os.path.join(project_dir, env.BoardConfig().get("build.partitions")), newline="") as f:
        for row in csv.reader(f):
            if len(row) > 4 and row[0].strip() == "spiffs":
                return int(row[4].strip(), 0)
    return None


# The blocks the staged files leave free and the blocks there are, in an image
# laid as post_esp32.py lays it, with littlefs-python; None free when the files
# do not fit at all
def free_blocks(stage, fs_size):
    from littlefs import LittleFS, LittleFSError
    count = fs_size // BLOCK_SIZE
    fs = LittleFS(block_size=BLOCK_SIZE, block_count=count, disk_version=0x00020000, mount=True)
    try:
        for name in sorted(os.listdir(stage)):
            with open(os.path.join(stage, name), "rb") as f:
                data = f.read()
            with fs.open(name, "wb") as dest:
                dest.write(data)
    except LittleFSError:
        return None, count
    return count - fs.used_block_count, count


# The image leaves the panel its room, or the build stops
def check_room(project, stage, fs_size):
    if fs_size is None:
        fail("the env's partition table has no file system partition (spiffs) for %s's files" % project)
    free, count = free_blocks(stage, fs_size)
    if free is None:
        fail("%s's files do not fit the file system's %d blocks of %d bytes" % (project, count, BLOCK_SIZE))
    print("Panel files for %s: %d of the file system's %d blocks used, %d free" % (project, count - free, count, free))
    if free < MIN_FREE_BLOCKS:
        fail("%s's image leaves %d blocks of the file system free, and the panel needs %d for what it writes at run "
             "time (MIN_FREE_BLOCKS): a smaller screen or fewer files" % (project, free, MIN_FREE_BLOCKS))


project = env.GetProjectOption("custom_panel_project", "").strip()
if project:
    project_dir = env.subst("$PROJECT_DIR")
    repo = os.path.normpath(os.path.join(project_dir, "..", ".."))

    # autoexec.be starts the boot the firmware carries: an image without the
    # brain compiled in would boot into nothing but Tasmota
    if not env.GetProjectOption("custom_berry_solidify", "").strip():
        fail("the env compiles no brain into the firmware (custom_berry_solidify), and autoexec.be only starts it")

    entries = [e.strip() for e in env.GetProjectOption("custom_files_upload", "").splitlines() if e.strip()]
    if len(entries) != 1:
        fail("custom_files_upload has to name exactly one directory, the staging one; it names %d entries" % len(entries))
    stage = os.path.normpath(os.path.join(project_dir, entries[0]))

    with open(os.path.join(repo, "autoexec.be"), encoding="utf-8", newline="") as f:
        autoexec = f.read()
    if len(PANEL_PROJECT_LINE.findall(autoexec)) != 1:
        fail("autoexec.be has to carry exactly one line 'var PANEL_PROJECT = nil'")
    autoexec = PANEL_PROJECT_LINE.sub(
        'var PANEL_PROJECT = "%s"   # set by the firmware build (custom_panel_project)' % project, autoexec)

    sources = []
    for name in LOADED_FILE.findall(autoexec):
        path = os.path.join(repo, "berry", name)
        if not os.path.isfile(path):
            fail("autoexec.be loads %s, and berry/%s does not exist" % (name, name))
        sources.append(path)
    generated = os.path.join(repo, "libs", "nspanel-sim", "export", "hmi-scenarios", project + ".jsonl")
    if not os.path.isfile(generated):
        fail("no generated tables for %s: %s is missing (libs/nspanel-sim/export/scripts/build-project-hmi.mjs writes it)"
             % (project, generated))
    # the panel reads it by the byte offsets of its first line, and refuses it
    # when a line is not where they say: a CRLF checkout would be that
    with open(generated, "rb") as f:
        tables = f.read()
    if b"\r" in tables:
        fail("%s has CR line endings, and the panel would refuse it (.gitattributes keeps *.jsonl LF)" % generated)
    sources.append(generated)

    # the screen, when the Editor has compiled it: an image without it boots on
    # whatever screen the panel has, and FlashNextion gives it ours
    tft = os.path.join(repo, "libs", "nspanel-sim", "export", "hmi-scenarios", "out", project + ".tft")
    tft_stamp_text = None
    # the screen's file and the name it takes in the image
    staged_tft = None
    if os.path.isfile(tft):
        with open(tft, "rb") as f:
            data = f.read()
        tft_stamp_text = tft_stamp(data)
        again = ("compile the screen again (in libs/nspanel-sim/export: scripts/build-project-hmi.mjs with --build, then "
                 "scripts/sandbox-compile.mjs %s), or take the .tft out of out/ for an image without it" % project)
        # the pair: the tables name the screen's components, and a screen of
        # another generation has them shifted under the same names
        words = tft_stamp_text.split() if tft_stamp_text is not None else []
        tables_hash = hashlib.sha256(tables).hexdigest()[:8]
        if tft_stamp_text is None:
            # a screen that says no version: the brain could not tell it from
            # the one on the screen
            fail("%s says no version as its first page loads: %s" % (tft, again))
        if len(words) < 3:
            fail("%s (stamped %s) was compiled before the screens carried their tables' hash: %s" % (tft, tft_stamp_text, again))
        if words[2] != tables_hash:
            fail("%s was compiled from other tables than %s (its stamp says %s, they hash to %s): %s"
                 % (tft, generated, words[2], tables_hash, again))
        # the pre-flight, of this very file
        record_path = os.path.join(os.path.dirname(tft), project + ".preflight.json")
        run = ("in libs/nspanel-sim/export, run node scripts/preflight-tft.mjs --record hmi-scenarios/out/%s.tft "
               "(scripts/sandbox-compile.mjs runs it after each compile)" % project)
        if not os.path.isfile(record_path):
            fail("%s has no pre-flight record, %s: %s" % (tft, record_path, run))
        try:
            with open(record_path, encoding="utf-8") as f:
                record = json.load(f)
        except ValueError as e:
            fail("%s does not read as a pre-flight record (%s): %s" % (record_path, e, run))
        if not isinstance(record, dict):
            fail("%s does not read as a pre-flight record (not an object): %s" % (record_path, run))
        if record.get("sha256") != hashlib.sha256(data).hexdigest():
            fail("%s is the pre-flight record of another file than %s: %s" % (record_path, tft, run))
        if record.get("ok") is not True:
            fail("%s failed its pre-flight (%s): %s" % (tft, "; ".join(record.get("blocking") or []) or "see " + record_path, again))
        # the copy the file system keeps: the record's own, packed from that .tft
        packed = record.get("packed")
        if not isinstance(packed, dict) or not packed.get("file") or not packed.get("sha256"):
            fail("%s names no packed copy of %s, recorded before the panel kept it packed: %s" % (record_path, tft, run))
        packed_path = os.path.join(os.path.dirname(tft), packed["file"])
        if not os.path.isfile(packed_path):
            fail("%s, the packed copy %s names, is missing: %s" % (packed_path, record_path, run))
        with open(packed_path, "rb") as f:
            packed_data = f.read()
        if hashlib.sha256(packed_data).hexdigest() != packed["sha256"]:
            fail("%s is not the packed copy %s recorded: %s" % (packed_path, record_path, run))
        if packed_data[:4] != b"NXLZ" or int.from_bytes(packed_data[8:12], "little") != len(data):
            fail("%s does not say it holds %s's %d bytes: %s" % (packed_path, tft, len(data), run))
        staged_tft = (packed_path, project + ".tft")
    else:
        print("panel_files.py: no compiled screen for %s (%s): the image goes without it" % (project, tft))

    # From scratch every time: a file autoexec.be stopped loading must not ride
    # along. post_esp32.py gathers the image in $BUILD_DIR/littlefs_data and
    # never empties it, so that goes too.
    shutil.rmtree(stage, ignore_errors=True)
    shutil.rmtree(os.path.join(env.subst("$BUILD_DIR"), "littlefs_data"), ignore_errors=True)
    os.makedirs(stage)
    with open(os.path.join(stage, "autoexec.be"), "w", encoding="utf-8", newline="") as f:
        f.write(autoexec)
    for path in sources:
        shutil.copy(path, stage)
    if staged_tft is not None:
        shutil.copy(staged_tft[0], os.path.join(stage, staged_tft[1]))
    if tft_stamp_text is not None:
        with open(os.path.join(stage, project + ".tft.stamp"), "w", encoding="ascii", newline="\n") as f:
            f.write(tft_stamp_text + "\n")
        print("Panel files for %s: the screen, stamped %s, packed in %d of its %d bytes"
              % (project, tft_stamp_text, os.path.getsize(staged_tft[0]), len(data)))

    total = sum(os.path.getsize(os.path.join(stage, n)) for n in os.listdir(stage))
    print("Panel files for %s: %d files, %d bytes, staged in %s" % (project, len(os.listdir(stage)), total, stage))
    check_room(project, stage, fs_size_of(project_dir))

    # The image is made after the .bin, and only when SCons makes the .bin: with
    # no C++ changed it would not, and a change of the project's tables would
    # miss the image.
    env.AlwaysBuild(env.subst("$BUILD_DIR/${PROGNAME}.bin"))
