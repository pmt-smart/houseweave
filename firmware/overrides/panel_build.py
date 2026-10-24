# Stamps the brain with the build it is (Main settings' Info),
# and with the image it is, the env being built (tasmota32-houseweave-living-room-us),
# by which the house's releases are found (the OTA row).
#
# berry/panel_build.be says "dev" for its commit and nothing for its date; this
# writes a copy of it with this build's own into firmware/overrides/generated/,
# and that copy is the one custom_berry_solidify compiles into the firmware.
#
# The commit is two, <repository>/<fork>: this repository's HEAD, with a "+" after
# it when a tracked file outside the Tasmota submodule differs from it, and the
# submodule's own HEAD (the fork, firmware/tasmota), with a "+" after it when it is
# not the commit this repository's HEAD records for the submodule (a build made on a
# fork commit that no commit of this repository holds yet, or on a checkout that a
# `git checkout` of an old commit left behind) or when a tracked file of the fork
# differs from its HEAD. A build of changes nobody committed says so on the panel.
# The three files the build itself rewrites in the fork, and the build script puts
# back at its end, are not changes (scripts/build-firmware.ps1). A fork that is not
# a checkout says "unknown". The date is when the build ran, to the minute.
#
# Runs as a `pre:` script, listed before Tasmota's own, so the copy exists when
# pio-tools/solidify-from-url.py reads the files it compiles.

Import("env")

import datetime
import os
import subprocess
import sys

repo = os.path.normpath(os.path.join(env.subst("$PROJECT_DIR"), "..", ".."))
fork_path = "firmware/tasmota"
fork = os.path.join(repo, *fork_path.split("/"))
source = os.path.join(repo, "berry", "panel_build.be")
target_dir = os.path.join(repo, "firmware", "overrides", "generated")
target = os.path.join(target_dir, "panel_build.be")

# What a build leaves changed in the fork until the build script puts it back: the
# marker line of the hybrid compile in sdkconfig.defaults, and what the solidification
# of the brain rewrites (CMakeLists.txt, berry_custom's modules.h)
rewritten = ("sdkconfig.defaults", "CMakeLists.txt", "lib/libesp32/berry_custom/src/modules.h")


def git(where, *args):
    r = subprocess.run(["git", "-C", where] + list(args), capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def repo_stamp():
    commit = git(repo, "rev-parse", "--short", "HEAD") or "unknown"
    changed = git(repo, "status", "--porcelain", "--untracked-files=no", "--", ".", ":(exclude)" + fork_path)
    return commit + ("+" if changed else "")


def fork_stamp():
    # a submodule that is not checked out is an empty folder, and git would climb to
    # this repository and answer with its HEAD: only a folder with its own .git is the fork
    if not os.path.exists(os.path.join(fork, ".git")):
        return "unknown"
    head = git(fork, "rev-parse", "HEAD")
    if not head:
        return "unknown"
    short = git(fork, "rev-parse", "--short=8", "HEAD") or head[:8]
    recorded = git(repo, "ls-tree", "HEAD", fork_path).split()
    held = recorded[2] if len(recorded) >= 3 and recorded[0] == "160000" else ""
    changed = git(fork, "status", "--porcelain", "--untracked-files=no", "--", ".", *[":(exclude)" + p for p in rewritten])
    return short + ("+" if held != head or changed else "")


stamp = repo_stamp() + "/" + fork_stamp()
image = env.subst("$PIOENV")
date = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M")

with open(source, encoding="utf-8") as f:
    text = f.read()
for old, new in (('static var COMMIT = "dev"', 'static var COMMIT = "%s"' % stamp),
                 ('static var DATE = ""', 'static var DATE = "%s"' % date),
                 ('static var IMAGE = ""', 'static var IMAGE = "%s"' % image)):
    if text.count(old) != 1:
        sys.stderr.write("panel_build.py: %s does not hold `%s` once\n" % (source, old))
        env.Exit(1)
    text = text.replace(old, new)

os.makedirs(target_dir, exist_ok=True)
with open(target, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)
print("panel_build.py: the brain is %s, built %s, image %s" % (stamp, date, image))
