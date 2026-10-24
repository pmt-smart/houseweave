# 12 — Berry notes

What the Berry of this Tasmota does that well-meaning code does not survive, and the rules the brain follows because of it. Read it before
creating or changing any `.be` file.

## 1. The brain is compiled into the firmware

The firmware build compiles the brain's Berry files into flash with Tasmota's `custom_berry_solidify` option: the bytecode, the constants and
the strings stop taking heap, and nothing is loaded from a file. The option runs the top of each file in a Berry VM of the build and writes into
the firmware the class that the file's `#@ solidify:` line names, and nothing else. So every brain file (`berry/*.be`, the panel's and the
bridge's) follows four rules:

- **One class a file, with the line `#@ solidify:<Class>` right above it.** The build registers only that class; a second class would go into
  the firmware with no name the code could find it by.
- **The top of the file only declares the class.** An `import`, a `var`, an instance, a command or a driver at the top runs in the build and
  never on the device. What must run at boot is a method, and the boot calls it (`Nextion.start()` creates the screen's driver and registers its
  console commands).
- **Every method that uses a module imports it itself** (`import string` inside the `def`). A module imported at the top would be a global of a
  loose file; solidified, that global does not exist on the device, and the method fails on its first call with `'string' undeclared`.
- **`static` members are read-only.** On the device they live in flash. Assigning a simple `static` raises `attribute_error`; writing into a
  `static` map or list raises nothing and hangs or crashes the device, and no `try` catches it. A container that changes is an instance field
  (`var`), created in `init`.

What the build has beyond the files:

- **A prelude**, `firmware/overrides/_brain_prelude.be`, run first (the leading `_` sorts it before the others). The build's VM lacks what
  Tasmota adds to Berry: the `Driver` class the brain's drivers extend, and the natives the methods name (`log`, `serial`, `tcpclient`, `udp`,
  ...). It compiles strictly, so a name must be declared before the file that uses it; the prelude declares all of that, our classes included,
  read from the other files' directives. Nothing of it reaches the device: the solidified code points at Tasmota's own `Driver`.
- **The boot is a class**, `PanelBoot` (`berry/panel_boot.be`) on a panel, and `autoexec.be` only calls it. `autoexec.be` is the only file
  that stays a file.
- **A fix before the next firmware** is a loose file with the same class, loaded with `load("file.be")` in `autoexec.be` above the boot. The
  code names our classes at run time, so the file's class takes the firmware's place. The boot logs every class that runs from a file: the
  firmware's are solidified (`introspect.solidified`), a file's is not.
- **Strings are strong** (no `,weak` in the directive): a string the code builds at run time with the text of a constant is the constant, and
  costs no heap.

The three lists of the brain's files must agree: the simulator's `BRAIN_FILES` (`libs/nspanel-sim/vm/src/panel.ts`), the
`custom_berry_solidify` of `firmware/overrides/platformio_override.ini` and the `CLASSES` of `berry/panel_boot.be`. A new class goes into all
three; `libs/nspanel-sim/vm/test/brain.test.mjs` checks them, and checks the first three rules file by file (it compiles each one in a strict VM
with only the firmware's globals and our classes, and runs its top in a VM with no Tasmota). The end-to-end tests check the fourth: after each
session, every `static` of our classes must be as it was when the device came up.

## 2. Loose files: `load()`, `global` and `var`

What is still a loose file (`autoexec.be`, a fix before the next firmware) follows three rules of its own:

- **`load()`, never `import`, for a `.be` file on the file system.** `import` is for modules built into the firmware. For a loose file it runs
  the file (its logs appear) but binds nothing usable: the result is `nil`, silently, with no error at the `import`.
- **After a `load()`, what the file defined is reached through `global.`**, which is a run-time lookup. A bare name does not compile: the strict
  compiler resolves free names at compile time, before the `load()` has run.

  ```berry
  load("nextion_driver.be")
  var brain = global.Brain(global.nextion)   # works; Brain(nextion) does not compile
  ```
- **Every assignment at the top of a file declares with `var`** (`var nextion = Nextion()`); strict mode refuses a bare assignment.

## 3. The device compiles strictly, with named globals

Tasmota turns on both compiler options when it creates the VM (`comp_set_named_gbl` and `comp_set_strict`), Berry's `-g` and `-s`.

- **A builtin's name cannot be a variable or a parameter**: `var list = ...`, `def permit(open)`, `var range = ...` stop the compile with
  `strict: redefinition of builtin 'list'`. The same goes for `map`, `str`, `int`, `size`, `type`, `bytes`, `print`, `format` and the rest. A
  class field named like a builtin (`var list` in a class) compiles.
- **`except` is a reserved word**, so it is not a parameter or a variable name either; the error does not say so
  (`expected 'ID' before 'except'`).
- **No function goes past 256 constants**, counting strings, member names and numbers that do not fit in an instruction. Past constant 255 the
  compiler loads the constant into a register first, and more than one of those paths miscounts the registers: with named globals a global's
  *name* arrives where its value should (`f(g1, g2, 33)` receives `"g1"`, the value of `g1` and `"g2"`), and even without them an `import`
  misaligns a `for` that follows it. A big function is split. `libs/nspanel-sim/vm/test/compiler.test.mjs` brings the simulated panel and
  bridge up and fails when the bytecode of any of our classes, or of any file's top, uses a constant past `K255`. The test scripts of
  `berry/test/` have thousands of lines at their top and pass 256: a new test block with an `import`, a `for` or a global goes inside a function.
- **A class loaded later cannot be named inside a function of a class loaded earlier.** The strict compiler resolves each free name when the
  file is compiled, and a class later in the load order does not exist yet: `'PairSign' undeclared (first use in this function)`, and the file is
  refused. The class that comes earlier is named directly; the one that comes later is reached through `global` inside the method
  (`import global`, then `global.PanelStore.safe_save(...)`), and who needs to know whether it exists asks `global.contains("PanelStore")`. Or
  the order changes.

## 4. Language traps

- **The device's integers are 32 bits** (`BE_INTGER_TYPE 1`). `tasmota.millis()` turns negative after 24.8 days of uptime, so `now < deadline`
  breaks there: compare by the difference (`now - deadline < 0`), as `tasmota.time_reached` does. A wait nobody looks at again also needs a
  bound, since a difference past 24.8 days wraps too (`PanelUi.before(t, span)` in `berry/panel_ui.be`).
- **A JSON integer past 32 bits does not load as itself.** The `json.load` of the standalone `berry.exe` truncates to the low 32 bits, and the
  simulator's WebAssembly Berry returns `nil` for the whole object; which one the device does, only the device says. What passes 31 bits
  travels as two integers (high and low) or as text, which is what the C does (the mesh clock's `hi` and `lo`, the `Delta` of a `Timeline`
  event as text).
- **A ternary whose false branch computes `&&` or `||` as a value, with a bare variable as the last operand, returns garbage when the true
  branch is taken.** `c ? a : (x && y)`, `c ? 7 : (s == 0 || y)`, `c ? a : f(x && y)`, `c ? a : [x && y]` are all wrong with `c` true; both VMs
  give the same garbage, so it is the compiler. It does not happen when the last operand is a comparison, a `!`, a compared call or an index.
  Such a ternary is written with `if`/`elif`.
- **`string.find` stops at the first NUL.** To search bytes from the serial line, search the bytes themselves (`Nextion.find_bytes` in
  `berry/nextion_driver.be`) and make a string only of the piece found.
- **`str(bytes(...))` cuts at 32 bytes** and appends `...`. Log a payload with `.tohex()`, or `.asstring()` when it is text.
- **`bytes(b)` of a `bytes` is not a copy**: it is the same object. A copy the callee keeps while the caller changes the original is `b.copy()`.
- **`bytes.get(i, -4)` reads big-endian**; a negative size is the most significant byte first, and `set(i, v, -4)` writes the same way.
- **A lambda cannot assign.** The body of `/ ->` is an expression; changing an outer variable takes a `def`.
- **A Berry function does not check its argument count.** Missing arguments are `nil`, extra ones are dropped silently. Where the count is part
  of the contract, `def f(*a)` and a check of `size(a)` and of each type.
- **`for` over `nil` raises "'nil' value is not callable"**: a function that takes a list from outside checks `isinstance(x, list)` first.

## 5. Tasmota's behaviours

- **`persist.save()` only writes what was put since the last save** (`setmember`, `remove`, `zero` or `dirty`). A map that `persist.find` gave
  and the code changes in place changes in RAM only: after changing it, it goes through `setmember` again, and then `save()`.
- **Our fork's `persist.save()` is atomic.** It writes the whole map to `_persist.tmp`, closes it, then removes `_persist.json` and moves the
  temporary file over it. A failed save removes the temporary file and **raises**, and the file of before stays whole; the in-memory map and
  its dirty flag stay, so a later save writes everything back. A power cut between the remove and the move leaves the new file whole in the
  temporary one, and the next `load()` takes it. A file that is not a JSON map goes to `_persist.bad`, with a log line. Still, no code calls
  `persist.save()` raw: the panel saves through `PanelStore.safe_save` (`berry/panel_store.be`), which waits for 30 KB of free heap, tries
  again every 2 s up to five times, and **does not raise**; the bridge through `PairSign.safe_save` (`berry/pair_sign.be`), a `try` with a log
  line. `path.rename` wants the leading `/` on both names; `open`, `path.exists` and `path.remove` do not.
- **`tasmota.set_timer(ms, f, id)` stacks**, even with a timer of the same id already set, and **`tasmota.remove_timer(id)` removes all** the
  timers of that id. Who re-arms a timer of an id removes the old one first, or both fire; who removes an id removes every timer of that name,
  including another part's. The test stubs (`TimerBook` in `berry/test/stub_tasmota.be`) do the same, and `berry/test/test_stub_timers.be`
  holds them to the real class.
- **A Tasmota timer that raises is not called again**: `run_timers` takes it off the list before calling it, so a chain that re-arms at the end
  of its own function stops for good at the first exception. Re-arm first, and isolate the step with `try`.
- **A driver command lifts Berry's 4 s limit**: the event dispatcher ends with `BrTimeoutReset()`, and the limit is checked only every 2^19
  instructions anyway. A loop stuck at boot would leave the device with no web and no OTA, so the firmware has the watchdog (`USE_ESP32_WDT`),
  and the boot calls `tasmota.yield()` between the pieces it creates, which feeds it.
- **A `serial()` on a hardware UART takes the console off UART0** (`ClaimSerial()`), whatever port is opened. On a panel the first piece the
  boot creates is the screen's driver, and that is what takes the console out of the way.
- **`Ethernet <value>` restarts the device**, even with the value it already has; ask first (`Ethernet` alone). Our firmware has no Ethernet,
  so there the command answers "Unknown".
- **Every `tasmota.cmd` goes to the log and to MQTT**, as a console command would (`RSL: RESULT = {...}`, and a publish when MQTT is on). A
  reading that runs in a loop, or at every drawing of a view, goes quiet with both tools: a `_` before the name (`_EspNowStatus`) keeps it off
  MQTT and the `RSL` log line, and the second argument, `mute` (`tasmota.cmd(c, true)`), lowers the log level to 1 for the command. A command
  that changes something stays in the log.
- **A panel's rules go through `PanelRules`.** The panel has one Tasmota rule of any key (`?`), which hands each event to the parts of the
  brain that have its key (`berry/panel_rules.be`): every Tasmota rule keeps about 200 B of heap that the dispatcher's entry does not. New panel
  code does not call `tasmota.add_rule`: at boot it calls `PanelRules.of().add_rule(pattern, f, id)`, same signature; in a file that also runs
  on the bridge, it takes `global.panel_rules` when it exists and `tasmota` otherwise. Patterns are keys only (`Power1#State`, `EspNowPair`),
  matched in any case; one with an operator, an index or a wildcard raises `value_error` and stays a Tasmota rule. A part that raises goes to the
  log without taking the event from the others.

## 6. The mesh from Berry

The mesh driver (`USE_ESPNOW_MESH`, in every image) gives Berry global functions that **do not go through the command handler** (which costs
about 8 ms a call), and hands what happens to the rules as `{"EspNowMesh":...}`. In the standalone interpreter they do not exist. After a
`BrRestart` the VM is new: the driver registers them again within a second and marks the application not ready. With the mesh's task stopped,
the readers (`clock`, `stamp`, `age`, `neighbors`, `health`) and the senders (`send`, `info`) return `false`.

| function | what it returns |
|---|---|
| `espnow_mesh_send(dest, type, ack, data[, previous])` | a **token**, an integer from 1, or `false` when not taken (task stopped, command queue full, destination or type out of range, data past `espnow_mesh_max_payload(dest)`); `data` is `bytes` or text. `previous` true tags the frame with the network key of before the last change, for a node that has not taken the new one. The `Outcome` event repeats the token in `Counter` |
| `espnow_mesh_max_payload(dest)` | the payload limit: 220 bytes to one node, 228 to all |
| `espnow_mesh_ready([ready])` | `true`; says the application is ready (the default) or, with `false`, not. Without it the driver neither delivers nor answers the application's frames |
| `espnow_mesh_info(data)` | `true` when the task took the bytes every heartbeat carries, **up to 32**; more than 32 returns `false` and changes nothing. It **replaces the whole buffer**, always. It also says the application is ready |
| `espnow_mesh_health()` | the health report, a map: `neighbors`, `weak`, `twohop`, `branches`, `cut`, `soleways`, `alone`, `relays` |
| `espnow_mesh_clock()` | the mesh clock, a map (below) |
| `espnow_mesh_stamp()` | the **stamp**, 6 `bytes`: the timeline's tag (2 bytes) and the mesh time in 10 ms ticks (4 bytes), most significant first; `false` when the node is not synced. **Without a stamp Berry sends no command** and shows "?" |
| `espnow_mesh_age(stamp)` | how old a stamp is, a map (below); `false` when the bytes are not 6 long |
| `espnow_mesh_neighbors()` | a list of maps, one per neighbour (below), all of them at once |

**`espnow_mesh_clock()`**: `synced` and `adopted` (the node took a timeline since it came up), `ticks10` and `ticks100` (the mesh time in
10 ms and 100 ms ticks: the low 32 bits, as Berry's signed integer), `tag` (the 16 bits that name the timeline in a stamp), `timeline` (10 hex
digits: the node's number and the epoch), `taken` (the timelines taken since the mesh started), and `lo` and `hi` (the time in ms: the low 32
bits and the rest). **`espnow_mesh_age()`**: `age` (ms, signed: **negative for a stamp from the future**; the 32-bit difference is done in C and
is right across the 497 days a stamp's time takes to wrap), `tag` (`true` when the stamp is of this node's timeline) and `synced`. **Each
neighbour**: `id`, `state` (0 alive, 1 suspect, 2 silent), `rssi`, `age` (ms since anything of it arrived), `beat` (ms since its last heartbeat,
-1 for none), `info` (the hex of the application bytes of its last heartbeat; `bytes(n['info'])`), `seen` (0 no clock in its heartbeat, 1
another timeline, 2 the same), `skew` (ms: its time in the heartbeat less this node's when it arrived), `key` (the network key version its
heartbeat says it uses) and `keybits` (1 keeps the previous key, 2 needs the key, 4 its last heartbeat came under the previous key's tag, and
then its `info` is empty).

### The events

```json
{"EspNowMesh":{"From":3,"Type":0,"Dest":1,"Counter":12,"Epoch":7,"Rssi":-61,"Flags":0,"Part":0,"Joins":0,"Behind":0,"Data":"68656c6c6f"}}
{"EspNowMesh":{"Outcome":{"Counter":5,"Frame":12,"Dest":3,"Ok":1,"Attempts":1}}}
{"EspNowMesh":{"Notice":{"Kind":"Silent","Node":3,"By":2,"Value":0}}}
{"EspNowMesh":{"Timeline":{"Old":"0300000007","New":"0100000002","Ticks":12,"Delta":"1184","Synced":1}}}
{"EspNowMesh":{"Synced":{"Value":1,"Timeline":"0100000002","Tag":258}}}
```

- **A frame** (the first): `Flags` 1 asks for an answer, **2 marks the repeat of a number already delivered** (a command runs once), 4 a frame
  under the previous key's tag; `Behind`, 0 to 31, is how many of the origin's numbers the frame was behind the newest heard; `Data` is the
  payload's hex. A rule on `EspNowMesh` gets the inner map, and only a frame's has `Data`.
- **`Outcome`**: what became of a send that asked for an answer (`Counter` is the token; `Frame` the number on the air; `Ok` 0 with no attempts
  is a refusal of the core). **`Notice`**: `Silent`, `Back`, `Noisy`, `Calm`, `BulkDone` or `BulkLost`.
- **`Timeline`** (the clock took another node's timeline): `Old` and `New` are 10 hex digits; `Ticks` is the difference in 100 ms ticks, the
  low 32 bits, never negative (a node only takes a later time, or within the 20 ms band one at most 20 ms earlier, which rounds to 0); `Delta`
  is the difference in ms **as text**, for the log: **the arithmetic uses `Ticks`**. Berry moves every mark whose timeline is `Old` to `New`,
  adding `Ticks`. A `Timeline` with nothing to move is normal: at a house's cold start every node numbered above 1 gets one with `Ticks` 0.
- **`Synced`**: the sync bit changed to `Value`, once a mesh life, and never back to 0.

### The rules Berry keeps with them

- **Read the timeline and the time in one call** of `espnow_mesh_clock()`. The clock is already on the new timeline when the `Timeline` event
  reaches the rules: a mark made after reading the clock is of the new timeline; one made before is of the old, and the event translates it.
- **A lost event**: when `taken` passes the number of `Timeline` events Berry has handled this life, one was lost (the core's queue holds 8 and
  the driver's 16); the marks of older timelines become "cannot be placed", the safe side.
- **A mesh restart** (`EspNowMeshEnable 0` then `1`) is a new timeline with the clock at 0, and no event says so: Berry compares the `timeline`
  at every reading. The `espnow_mesh_info` buffer goes with the old node, so Berry sends it again when the timeline changes.
- **The mesh time wraps**, and two values compare by their difference, never with `<` or `>`: `ticks10` wraps in 497 days, `ticks100` in
  13.6 years, and the difference is right while the two are within 2³¹ ticks of each other.
- **The functions are reached through `global`, not by name** (`import global`, `global.contains("espnow_mesh_clock")`, then
  `global.espnow_mesh_clock()`): a member of `global` resolves at the call, so a file that uses them compiles where they do not exist. The node's
  number comes from `tasmota.cmd("_EspNowMeshId", true)`.
- **The heartbeat's 32 application bytes have owners**, and only `MeshBeat.shared()` (`berry/mesh_beat.be`) hands them to the driver: the core
  writes bytes 0 to 11 (the clock), the alarm's replica 1 to 19, the house 23 to 27, and the core, with the key, bits 5 and 6 of byte 19 and
  byte 22. Nobody calls `espnow_mesh_info` with a buffer of their own.
- **A command to another node** goes through `MeshCmd` (`berry/mesh_cmd.be`): the stamp of the sender's timeline before the line. The bridge
  that owns the device refuses it when it is a repeat (`Flags` 2), too far behind (`Behind` > 16), when the bridge is not synced or the stamp is
  of another timeline, when its age at the moment of running is past the window (3 s, and 1 s for the alarm's words) or more than 250 ms in
  the future, and when a newer frame of the same origin for the same device already ran in the last 3 s.

## 7. Testing Berry off the device

The language runs standalone, so the **pure logic** of a `.be` file (parsing, formatting, decisions) is tested without a device; anything that
depends on the real UART, the panel's handshake or physical timing is not, and runs on the device.

- `load()` and `global` are Tasmota's, registered when it creates the VM: the standalone interpreter
  (`firmware/tasmota/lib/libesp32/berry/berry.exe`, in the submodule) does not have them. The rest (`class`, `string`, `bytes`, `json`,
  `open()`) is the language.
- A test concatenates a stub of the few native pieces the file uses (`tasmota`, `Driver`, `serial`, `persist`, `log()`: see
  `berry/test/stub_tasmota.be` and `berry/test/stub_persist.be`), the real file, and the assertions, and runs them; the production file does not
  change.
- `node berry/test/run.mjs` runs the suite in the submodule's `berry.exe`; `--vm=wasm` runs every test in the submodule's Berry compiled to
  WebAssembly (`libs/nspanel-sim/vm`), the VM the simulator runs the panel in, with the same output line by line. Both run with `-s`; the
  suite does not use `-g` (the old `berry.exe` miscompiles named globals in more cases, and the concatenated scripts' tops pass 256 constants),
  and the simulator compiles the device's files with both options, where faithfulness to the device matters.
- The vectors of `berry/test/vectors/` belong to the suite: a change on purpose rewrites `berry/test/vectors/draw.json` and
  `berry/test/vectors/ui.json` with `node berry/test/run.mjs --update-vectors`, and the diff is the review. `berry/test/vectors/store.json` is
  written by hand.
- The persist stub fails like the fork's: `fail_next()` makes the next save raise with the file as it was, `lose_next()` cuts the power before
  the move, `reboot()` is a boot that reads the file as `load()` does. `berry/test/test_stub_persist.be` holds it to the fork's real one
  (`firmware/tasmota/lib/libesp32/berry_tasmota/src/embedded/persist.be`), run over a file system that fails.

## 8. The device's HTTP API, for debugging

- `GET http://<ip>/cm?cmnd=<command>` runs a command and answers JSON. **It needs the header `Referer: http://<ip>/`**: without it the reply is
  empty, and only the device's log says `Referer '' denied`.
- `GET http://<ip>/cs?c2=0` dumps the log buffer (what the web console shows); `c2=0&c1=<command>` runs and returns the log at once. A Berry
  `print()` does not appear there: only `log(msg, level)` at a level up to `WebLog`.
- `POST http://<ip>/ufsu?fsz=<size>` with `curl -F "ufsu=@file"` uploads a file to the file system; from Git Bash, use a relative path after a
  `cd` (MSYS path translation breaks `-F "x=@/c/..."`). `GET http://<ip>/ufsd?download=/file` downloads one, with the leading slash.
- **Two free-heap numbers**: `tasmota.memory()`'s `heap_free`, `Status 4`'s `Heap` and the boot's floor are the data RAM; `tasmota.get_free_heap()`
  adds the free IRAM, which takes only 32-bit accesses. Budget with the first.
- **Every `Br` leaves 16 bytes alive in Berry**: a monitor that reads the memory through `Br` sees growth of its own. To look for a leak, space
  the readings out and count them.
