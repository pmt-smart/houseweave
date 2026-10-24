# `autoexec.be` compiles, start to finish, and starts the boot once.
#
# It is the one file of the brain that is still a file, and the one a typo in
# costs a panel that boots into nothing with a syntax error in a log nobody is
# watching. The interpreter parsing and running it is a small claim, and it is
# the claim that matters: the boot itself is test_panel_boot.be's.
#
# Everything before this test file is the stubs plus autoexec itself (run.mjs
# concatenates them), so reaching this line at all is the first assertion.
assert(size(PanelBoot.started) == 1, "the boot starts once: " + str(PanelBoot.started))
assert(PanelBoot.started[0] == nil, "for joBr99's stack, with no project named")
print("ok - autoexec.be parsed and ran to the end")
