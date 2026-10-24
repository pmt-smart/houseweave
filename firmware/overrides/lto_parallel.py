# Links with the LTO partitions compiled in parallel.
#
# The Arduino framework's build script (pioarduino-build.py) compiles with
# -flto=auto but links with a bare -flto, and with no job count GCC's
# lto-wrapper compiles the LTRANS partitions one after the other: 21 of them for
# this firmware, on one core, the longest step of a build whose objects all come
# from the cache. With -flto=auto it runs them in parallel through make, which
# it needs on PATH (scripts/build-firmware.ps1 puts .tools/make there); without
# make it goes on in series, as before. How the program is cut into partitions
# does not depend on the job count, so the code is the same.
Import("env")

flags = env.get("LINKFLAGS", [])
if "-flto" in flags:
    env.Replace(LINKFLAGS=["-flto=auto" if flag == "-flto" else flag for flag in flags])
