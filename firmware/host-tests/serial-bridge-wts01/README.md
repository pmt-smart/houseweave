# host-tests/serial-bridge-wts01

A test on the PC (no device) of the Sonoff WTS01 decoding in the fork's serial bridge,
`firmware/tasmota/tasmota/tasmota_xdrv_driver/xdrv_08_serial_bridge.ino`: the waterproof probe of the Sonoff TH Elite, which sends its
temperature over a serial line, one datagram a second, at 9600 bps (`SSerialMode 3`). The `.ino` file is included as it is in
`host_test.cpp`, over the stand-ins of `host_stubs.h` for what it asks of Tasmota and of its serial port, and its functions are called as
Tasmota calls them: the loop, the JSON of the sensors, the web page and the command.

What it checks: no temperature before the first datagram (the reading would be 0 °C), the temperature of a datagram and of one below zero,
the reading gone once no datagram came for `SERIAL_BRIDGE_WTS01_TIMEOUT` seconds (a probe unplugged or broken), what is not a datagram, the
mode set again, and `millis()` going round.

The tests of the suites: [docs/13](../../../docs/13-testing.md).

## Command

From the repository's root:

```
node firmware/host-tests/serial-bridge-wts01/run.mjs
```

It compiles `host_test.cpp` with emscripten into `.build/` (ignored by git), runs the result with Node, and exits with 0 when every check
passes (the last line says `all <N> checks passed`). On a failure it shows each failed check and exits with 1. `node scripts/verify.mjs wts01`
runs it. What to install is as for [the mesh driver's test](../espnow-mesh-driver/README.md).

## What is real and what is a stand-in

- **Real:** the driver, its decoding of a datagram and its reports.
- **Stand-ins:** the serial port, a queue of the bytes the test puts in; the clock, `millis()` as the test sets it; the response and the web
  page, strings the test reads; and the settings, the few the driver reads.
- **What the PC does not prove:** the probe itself, its datagram past the two the driver's notes show, and the serial line's timing. Those are
  the bench's.
