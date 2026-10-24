# Builds the panel firmware images: the overrides copied
# into the submodule, then PlatformIO once per env, one after the other.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1 tasmota32-houseweave-living-room-eu
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-firmware.ps1 tasmota32-houseweave-living-room-eu tasmota32-houseweave-bridge
#
# With no env named, every panel env of firmware/overrides/platformio_override.ini
# is built; with several, each of them, in that order. Run it from PowerShell, not
# Git Bash.
#
# The base env, tasmota32-houseweave, is refused by name. It is the env the
# others extend: an image with no panel template that runs the commands it hears on
# ESP-NOW. (The override's default_envs, which a bare `pio run` in the submodule
# builds, is the Living room US panel env, not the base.) This script never builds the base by itself (no argument takes the
# envs that have a suffix), and it does not build it by a typo either: it takes
# -AllowBase, said in the command, for the owner who wants it. A name that is not
# an env of the override is refused before anything is copied.
#
#   ... -File scripts/build-firmware.ps1 -DryRun [env...]
#
# says what it would build, and what it finds in the checkout, and stops there:
# nothing is copied, nothing is compiled.
#
# A submodule that is at another commit than the one this repository's HEAD records
# for it, or has a tracked file changed, is warned about before anything starts, and
# not refused: a commit in the fork, a build and its numbers, and only then the commit
# here that records the new one, is the way a change of the fork is made.
# The stamp of that build carries a "+" after the fork's commit.
#
# After each env, its images are kept in releases/ (ignored by git) as
# <env>-<commit>.bin and <env>-<commit>.factory.bin, the commit being the stamp the
# brain was built with (firmware/overrides/panel_build.py): this repository's HEAD
# and the fork's, each with a "+" when it was not what the commit holds. A file
# already there is never overwritten: the same bytes are left alone, and other
# bytes under the same name go to <env>-<commit>-2.bin, -3, and so on. The
# build_output/ copy is the one the next build of the env replaces; releases/ is
# what a rollback goes back to.
#
# A GNU make in .tools/make (the xPack Windows Build Tools) goes on the
# end of PATH, where GCC's lto-wrapper finds it to compile the link's LTO
# partitions in parallel; at the end, so its sh, cp, rm and the rest shadow
# nothing of Windows. Without it the link runs in series.
#
# Why a script and not the bare pio command: our env sets custom_sdkconfig, so
# the platform compiles the ESP-IDF libraries into the Arduino framework for it
# ("hybrid compile"), and marks the submodule's sdkconfig.defaults with a hash of
# that configuration on its first line. A build that finds the mark reuses the
# libraries; one that does not reinstalls the framework and compiles them again,
# about 6 minutes. The submodule is upstream untouched, so sdkconfig.defaults goes
# back to upstream after the build, and that removed the mark: every build paid
# the 6 minutes, the second env of the same run included. So the mark is kept
# aside, with the SHA-256 of the configuration the framework records next to its
# libraries, and it is put back before the next build only while the framework
# still holds those very libraries. That is what the platform would see if the
# file had never been restored.
# Every name given is an env: -File binds only the first to a plain [string[]]
# and leaves the rest unbound, so a run naming three built one.
param(
  [switch]$AllowBase,
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Envs
)
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$tasmota = Join-Path $repo "firmware\tasmota"
$overrideIni = Join-Path $repo "firmware\overrides\platformio_override.ini"
$releases = Join-Path $repo "releases"
$baseEnv = "tasmota32-houseweave"
$pio = Join-Path $repo ".tools\pio-venv\Scripts\pio.exe"
if (-not $env:PLATFORMIO_CORE_DIR) { $env:PLATFORMIO_CORE_DIR = "C:\pio" }
$make = Join-Path $repo ".tools\make\bin"
if (Test-Path (Join-Path $make "make.exe")) {
  $env:PATH = $env:PATH + ";" + $make
  "make from .tools/make: the link's LTO runs in parallel"
}
$librariesConfig = Join-Path $env:PLATFORMIO_CORE_DIR "packages\framework-arduinoespressif32\tools\esp32-arduino-libs\sdkconfig"
$keptMark = Join-Path $env:PLATFORMIO_CORE_DIR "houseweave-hybrid-mark.json"
$defaults = Join-Path $tasmota "sdkconfig.defaults"

function Sha256($path) {
  if (Test-Path $path) { return (Get-FileHash $path -Algorithm SHA256).Hash }
  return ""
}

# --- releases: begin (scripts/build-firmware.test.mjs runs this block on its own)

# The stamp the brain of the last build carries, made a file name: what
# firmware/overrides/panel_build.py wrote in the copy of panel_build.be it gave the
# build, with what a file name does not take (the "/" before the fork's commit) a "-".
function Get-BuildStamp($generated) {
  if (-not (Test-Path $generated)) { return "unknown" }
  $m = [regex]::Match((Get-Content $generated -Raw), 'COMMIT = "([^"]+)"')
  if (-not $m.Success) { return "unknown" }
  return ($m.Groups[1].Value -replace '[^0-9A-Za-z+_.-]', '-')
}

# Keeps the images one build wrote, <from>\<name>.bin and <from>\<name>.factory.bin,
# in <to> as <name>-<stamp>.bin and <name>-<stamp>.factory.bin. Nothing there is
# overwritten: a file with the same bytes is left as it is, and one with other bytes
# under the same name sends the new one to <name>-<stamp>-2.bin, -3, and so on.
function Keep-Release($name, $stamp, $from, $to) {
  New-Item -ItemType Directory -Force $to | Out-Null
  foreach ($ext in @(".bin", ".factory.bin")) {
    $src = Join-Path $from ($name + $ext)
    if (-not (Test-Path $src)) {
      Write-Warning "$name$ext is not in ${from}: nothing of it to keep"
      continue
    }
    $item = Get-Item $src
    $sum = (Get-FileHash $src -Algorithm SHA256).Hash
    $n = 1
    while ($true) {
      $suffix = ""
      if ($n -gt 1) { $suffix = "-$n" }
      $dest = Join-Path $to ($name + "-" + $stamp + $suffix + $ext)
      if (-not (Test-Path $dest)) {
        Copy-Item $src $dest
        Write-Host "kept $dest ($($item.Length) bytes, written $($item.LastWriteTime.ToString('yyyy-MM-dd HH:mm')), SHA-256 $($sum.Substring(0, 12)))"
        break
      }
      if ((Get-FileHash $dest -Algorithm SHA256).Hash -eq $sum) {
        Write-Host "already kept as $dest"
        break
      }
      $n++
    }
  }
}

# --- releases: end

# --- fork: begin (scripts/build-firmware.test.mjs runs this block on its own)

# What git prints, or "" when it prints nothing or fails: here a native command's
# stderr is no error, whatever $ErrorActionPreference is. A function's own $args drop
# a bare "--", so no call below has one.
function Get-Git {
  $before = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $out = & git @args 2>$null
    if ($LASTEXITCODE -ne 0) { return "" }
    return (($out | ForEach-Object { "$_" }) -join "`n").Trim()
  } finally {
    $ErrorActionPreference = $before
  }
}

# The submodule against what this repository's HEAD records for it, as
# firmware/overrides/panel_build.py stamps it: the fork's HEAD, the commit HEAD
# records, Moved when they are not the same, and Dirty when a tracked file of the
# fork differs from its HEAD, but for the three the build rewrites and puts back.
# $null when the folder is not a checkout of its own (an empty one would make git
# answer with this repository's HEAD).
function Get-ForkState($repoDir, $forkDir) {
  if (-not (Test-Path (Join-Path $forkDir ".git"))) { return $null }
  $head = Get-Git -C $forkDir rev-parse HEAD
  if (-not $head) { return $null }
  $line = @((Get-Git -C $repoDir ls-tree HEAD firmware/tasmota) -split '\s+')
  $recorded = ""
  if ($line.Count -ge 3 -and $line[0] -eq "160000") { $recorded = $line[2] }
  $changed = Get-Git -C $forkDir status --porcelain --untracked-files=no . ":(exclude)sdkconfig.defaults" ":(exclude)CMakeLists.txt" ":(exclude)lib/libesp32/berry_custom/src/modules.h"
  return [pscustomobject]@{ Head = $head; Recorded = $recorded; Moved = ($head -ne $recorded); Dirty = [bool]$changed }
}

# The warnings a build of this checkout earns: the stamp will carry a "+" after the
# fork's commit, and the images kept in releases/ will say so in their names. A
# warning and not a refusal: a commit in the fork, a build and its numbers, and only
# then the commit here that records the fork's new one, is the way a change of the
# fork is made.
function Write-ForkWarnings($state) {
  if ($null -eq $state) {
    Write-Warning "firmware\tasmota is not a checkout of the fork (git submodule update --init firmware/tasmota): the stamp will say unknown for it"
    return
  }
  if ($state.Moved) {
    $recorded = $state.Recorded
    if (-not $recorded) { $recorded = "nothing" }
    Write-Warning "the fork is at $($state.Head.Substring(0, 8)) and this repository's HEAD records $recorded for it: the stamp will carry a + after the fork's commit. It is what it should be when you committed in the fork and will commit its new pointer after this build. After a git checkout of an old commit of this repository it is the fork left at a newer one: run git submodule update first (submodule.recurse is off here)."
  }
  if ($state.Dirty) {
    Write-Warning "a tracked file of the fork differs from its commit (git -C firmware/tasmota status): the stamp will carry a + after the fork's commit"
  }
}

# --- fork: end

$known = @(Select-String -Path $overrideIni -Pattern '^\[env:([^\]]+)\]' | ForEach-Object { $_.Matches[0].Groups[1].Value })
if (-not $Envs) {
  $Envs = Select-String -Path $overrideIni -Pattern '^\[env:(tasmota32-houseweave-[^\]]+)\]' |
    ForEach-Object { $_.Matches[0].Groups[1].Value }
}
foreach ($name in $Envs) {
  if ($name -eq $baseEnv -and -not $AllowBase) {
    throw "$name is the base env the others extend: its image has no panel template and runs the commands it hears on ESP-NOW. Name a panel or bridge env, or say -AllowBase if the base is what you want."
  }
  if ($known -notcontains $name) {
    throw "$name is not an env of firmware/overrides/platformio_override.ini; they are: $($known -join ', ')"
  }
}
Write-ForkWarnings (Get-ForkState $repo $tasmota)
if ($DryRun) {
  "dry run: would build $($Envs -join ', '), one after the other, and keep their images in $releases"
  return
}

Copy-Item (Join-Path $repo "firmware\overrides\user_config_override.h") (Join-Path $tasmota "tasmota\user_config_override.h") -Force
Copy-Item (Join-Path $repo "firmware\overrides\platformio_override.ini") (Join-Path $tasmota "platformio_override.ini") -Force

Push-Location $tasmota
try {
  if (Test-Path $keptMark) {
    $kept = Get-Content $keptMark -Raw | ConvertFrom-Json
    $mark = $kept.mark
    if (-not ($mark -is [string] -and $mark.StartsWith("# TASMOTA__"))) {
      "the kept mark is not one this script wrote: the platform decides alone"
    } elseif ($kept.libraries -eq (Sha256 $librariesConfig)) {
      $upstream = Get-Content $defaults -Raw
      if (-not $upstream.StartsWith("# TASMOTA__")) {
        Set-Content -Path $defaults -Value ($mark + "`n" + $upstream) -NoNewline -Encoding ascii
      }
      "the framework still holds the libraries of the last build: no reinstall"
    } else {
      "the framework's libraries changed since the last build: the platform rebuilds them"
    }
  }
  foreach ($name in $Envs) {
    $start = Get-Date
    "=== $name, started $($start.ToString('HH:mm:ss'))"
    & $pio run -e $name
    if ($LASTEXITCODE -ne 0) { throw "$name failed (exit $LASTEXITCODE)" }
    # the hybrid compile builds the framework in a pio run of its own, and a compile that fails there can still end in
    # SUCCESS, the firmware.bin of an earlier build taken from the cache: an image older than this build is
    # not this build's, and is not kept under this build's name
    $image = Join-Path $tasmota ("build_output\firmware\" + $name + ".bin")
    if (-not (Test-Path $image) -or ((Get-Item $image).LastWriteTime -lt $start)) {
      throw "$name wrote no image of its own: build_output holds an earlier one (a compile that failed, hidden by the cache)"
    }
    "=== $name built in $([math]::Round(((Get-Date) - $start).TotalMinutes, 1)) min"
    Keep-Release $name (Get-BuildStamp (Join-Path $repo "firmware\overrides\generated\panel_build.be")) (Join-Path $tasmota "build_output\firmware") $releases
    # [string]: what Get-Content returns carries the file's properties along,
    # and ConvertTo-Json would write them all, the line as one field among many
    $first = [string](Get-Content $defaults -TotalCount 1)
    if ($first -like "# TASMOTA__*") {
      @{ mark = $first; libraries = (Sha256 $librariesConfig) } | ConvertTo-Json | Set-Content $keptMark -Encoding ascii
    }
  }
} finally {
  # the submodule as upstream has it, whatever happened above: the brain's
  # solidification rewrites berry_custom's modules.h, and the rest of what it
  # writes is ignored by the submodule's own .gitignore
  git -C $tasmota checkout -- CMakeLists.txt sdkconfig.defaults lib/libesp32/berry_custom/src/modules.h
  Pop-Location
}
