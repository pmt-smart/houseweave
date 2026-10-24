# What `autoexec.be` calls, standing in for the firmware's.
#
# The brain is compiled into the firmware, and autoexec.be only
# names the project and starts the boot (berry/panel_boot.be, PanelBoot.start).
# The boot has its own test (test_panel_boot.be); this one records the call.

class PanelBoot
    static var started = []
    static def start(project)
        PanelBoot.started.push(project)
    end
end
