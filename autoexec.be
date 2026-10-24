# autoexec.be -- runs when Tasmota boots: the one file of the brain that is
# still a file. The brain itself is compiled into the firmware,
# and berry/panel_boot.be builds and wires it (PanelBoot.start). This only says
# which generated project this panel runs.
#
# PRESENCE IS THE MODE. There is no flag: naming a project here makes the brain
# read the tables generated beside its `.tft` (<project>.jsonl), and those only
# make sense with that `.tft` flashed, because the objnames in them are the ones
# the Editor compiled. A flag that disagreed with the flashed file would be a
# panel that draws nothing and says nothing about why. nil keeps the joBr99
# stack, validated on hardware, which is the fallback.
#
# A firmware build writes the project in (firmware/overrides/panel_files.py),
# and so can the owner, on the device. A class of the brain can
# be replaced before the next firmware by a file of it, loaded above the boot
# with load() -- never import, which returns nil for a file: the
# boot logs every class that runs from a file.
var PANEL_PROJECT = nil   # e.g. "p1-living-room-eu-landscape"

PanelBoot.start(PANEL_PROJECT)
