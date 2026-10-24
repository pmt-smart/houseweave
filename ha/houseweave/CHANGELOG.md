# Changelog

## 1.6.0 (2026-10-23)

- Only HouseWeave's names: every node of the house runs the firmware that speaks them, so the server no longer takes or calls a node in the
  names before them, a release's index has each image once, and the integration (its version 1.6.0) and the weather automation use only the
  `houseweave/` topics.

## 1.5.0 (2026-10-22)

- The add-on is HouseWeave: the app (Studio, House and Settings) in Home Assistant's sidebar, through the ingress.
- Two ports: the nodes' (8080), with their releases and their signed routes, and the app's (8099), with the owner's API, which only the ingress reaches.
- From the add-on repository, Home Assistant compiles the app while it builds the add-on, from the version's source: an install or an update takes a few minutes.
- The integration is HouseWeave in Home Assistant, its technical name `houseweave` (its version 1.5.0). The add-on takes out the one it copied as
  `casainteligente`, whose entry is deleted in Devices & services before HouseWeave is added. The schedules come on `houseweave/schedule`, and from
  a panel on the firmware before on `casainteligente/schedule`, cleared once the panel speaks the current names.
- The add-on is `houseweave_release_server`, with the house's folder in `/share/houseweave`.
- The nodes' signed requests are in HouseWeave's names (the `X-HouseWeave-*` headers, the `/houseweave/do` and `/houseweave/pair` routes); the server
  still takes and calls a node in the names of the firmware before them until it runs the current firmware.
- The images are `tasmota32-houseweave-*` and the safeboot `houseweave-safeboot.bin`; the index has each release under its former name too, for
  a node on the firmware before, and the House tab shows each image once.

## 1.4.0 (2026-10-21)

- Every node's backup through the house's server, signed by the server and the node, with the night's round and the house's nodes in the app.

## 1.3.0 (2026-10-09)

- A schedule event's start and end, each with its action, and the blind in the calendars.

## 1.2.0 (2026-10-07)

- The integration: a Home Assistant calendar for each device of the panels' schedule.

## 1.1.0 (2026-09-30)

- The server found by the panels over MQTT, and Home Assistant's button for a backup.

## 1.0.0 (2026-09-30)

- The backup server, on the Home Assistant machine.
