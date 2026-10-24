# panel_build.be -- which build this brain is (Main settings' Info):
# the commit and the time the firmware was built from, and the image it
# is (the build's env, tasmota32-houseweave-living-room-us), by which the house's
# releases are found (the OTA row).
#
# The file in the repository says "dev", and that is what the simulator and the
# test suite run. The firmware build compiles a copy stamped with its own commit,
# time and image instead (firmware/overrides/panel_build.py), with
# a "+" after the commit when the tree had changes nobody had committed.
#
# The boot hands the commit and the time to the brain (panel_boot.be), and the
# OTA row reads the three.

#@ solidify:PanelBuild
class PanelBuild
    static var COMMIT = "dev"
    static var DATE = ""
    static var IMAGE = ""
end
