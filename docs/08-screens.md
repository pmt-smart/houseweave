# 08 — The screens

What a panel shows and what each touch does. The pages are a generated project ([10](10-simulator-and-tft.md)), and what changes with the
configuration (the cards of a plan, the lists, the calendar, the alarm) the brain draws on them at run time ([03 §2](03-architecture.md)); the
rules of drawing for this screen are in [09](09-drawing-for-the-glass.md). The production panel is the US portrait (320 × 480); the EU
landscape (480 × 320, 450 visible) has the same screens. The words on the glass are English, and they are content, not code.

## 1. Moving around

- **The screensaver** comes up after the panel is left untouched for a while, with the time, the date and the weather (from Home Assistant,
  [07 §4](07-home-assistant.md); "--" without it), and the screen goes dark after another while; a touch wakes it.
- **Home is a plan** of zone cards. A swipe left or right goes to the next plan, the house's other screens.
- **The title** of a plan opens the **house's page**, and a hold on it renames the screen. On any other page, the title goes back.
- **A hold on a settings row** opens its **Help**, up to five short lines.
- **The two physical buttons** are below the screen ([§9](#9-the-physical-buttons-and-the-relays)).

## 2. The plan

**A plan is a matrix of fixed cells**, 40 × 46 px on both panels: 11 × 5 on the EU, 8 × 8 on the US, from edge to edge below the 78 px header. A
**zone** is a rectangle of cells, and its card holds **one icon per device**, each in its own place, so every icon of every zone sits on one grid.
The cards are drawn by the brain, not compiled, so a room's plan is configuration, and changing the house asks for no build.

- **How a card is drawn** is the zone's **Display**: `Places`, an icon per device in its place; or summed up, `Adaptive` or `Uniform`, an icon
  per group of devices (a kind and the relay that feeds it) with its count, the zone's name below, and, where the card has room, the room's and
  the floor's temperature of its first thermostat. A zone also has a colour.
- **A tap on a card** does what the zone's **Tap** says: `Auto`, the house's rule (lights, plugs and switches toggle together; blinds only in a
  zone of blinds; heating only goes off); `All`, everything in the zone; one `Group` of the zone; or one `Device`. If any of the chosen is on,
  the tap turns them off; else on. The physical buttons follow the same choice.
- **A hold on a card** opens the zone's screen; on a zone of one device, or of one group, the device's or the group's page.
- **A command waits for its answer**: the card is painted pending until the devices report what was asked. A device that does not show it
  within 2 s gets a "?" and a ping, and nothing is sent again on its own.
- **An icon has four looks**: on, off, no answer ("?"), and no power (a Zigbee lamp whose relay is open). A device of another bridge that is not
  in step on the mesh shows "no communication" and does nothing, before the touch ([05 §4](05-the-house.md)).
- **The header's +** (with Editing on) draws a dashed card at the first free cell: a tap moves it to the next place, a hold opens the keyboard
  for its grid, a tap on the title cancels, and the check creates the zone. An empty plan says "Empty".

## 3. A zone's screen

On top, the zone's card, one row wide: **Settings**, the zone's options, and on the right **a counter per group** (the count and the kind's
icon, lit while any of them is on). Below, **the devices**, one 78 px row each, ordered by their place on the plan, with the scroll bar of
the list.

| element | tap | hold |
|---|---|---|
| the title | back | rename the zone (Editing) |
| the + (Editing) | add a device (§5) | |
| Settings | the zone's options | the zone's options |
| a counter | toggle that group alone | the group's page, if the group has one |
| a device's name | its options | rename it (Editing) |
| a device's icon | toggle it alone | its page, if it has one |
| a swipe up or down | the next or the previous page of the list | |

**The zone's options**: Grid (its size in cells), Display, Color, Tap, the physical buttons it answers to, Delete zone (asked first), and
Info. **A device's options**: Position (its row and column on the plan), Type, the Driver of a switch of two channels, the alarm's rows (a
sensor's role, notification and sound; any device's panic burst), Relay, Zone (move it to another), Replace (another device in its place, name,
zone, place and relay kept), Remove (for a device of a bridge of the house: Remove from this panel, or Remove from the house), Status (why it is
held, when it is) and Info. The kinds are `light`, `cover`, `thermostat`, `plug`, `switch`, `fan`, `sensor`, `remote` and `generic`.

## 4. A device's page

Under the title of every page, a **row of buttons**: Identify (for the kinds that blink), Settings (a cog), Schedule (for the kinds the schedule
runs, lit while it is on), and, on the right, the card's name, which opens the zone's screen. A **group's page** acts on every device of one
kind on one relay in the zone at once, and its Settings opens the zone's Tap.

- **A lamp**: brightness, colour temperature and colour, as the lamp has them. A slider changes the lamp while dragging when **Live update** is
  on, or on release. Its settings: what it does when its power comes back (on, off, as it was) and how long it takes to light and to go out,
  written to the lamp itself. A new lamp is set to come back off after a power cut.
- **A thermostat**: the target with − and +, the room's temperature, the floor's when it has a probe, whether it is heating, and its modes (Off and
  Heat). A touch moves the target one step of the thermostat's own, shown at once
and sent a moment after the last touch, so a few touches are one write. For a group, the target shown is the median of theirs and the
  room the mean. Its settings come from the bridge's driver and its profile of the model: for the Moes ZHT-SR its preset, child lock,
  calibration, dead zone, temperature limits, sensor, backlight, screen time, ring light and eco temperature, each within the profile's range.
- **A blind**: its position in large type and what it is doing; up, stop and down, as on the wall; a slider from 100% at the top to 0% at the
  bottom in steps of 5, whose release sends the blind there; and the ventilation, a position almost closed, in one touch.
- **A switch of two channels** that opens and closes something (a gate, a window) has a **driver** on the bridge: its mode (Motor or Pulse) and
  its door sensor, chosen on its own screen; with no driver, each channel is a device.

## 5. Adding a device

The zone's **+** (with Editing on) asks for a **Zigbee device** or a **relay device**, and shows only what the panel can add now.

- **Pair new device**: with more than one bridge in the house, it asks on which (this panel's favourite first); the search opens that bridge's
  Zigbee network over the mesh, the device found is shown, and a tap adds it to the zone, in the next free place of its card.
- **Existing device**: a page of a bridge's devices at a time, and one tap takes one. The bridge owns its devices; the panel keeps its own view.
- **A relay device** is born on relay 1 or 2, of the kind chosen: a Light, a Switch or Other. A Zigbee lamp powered by a relay is marked on it.

## 6. Editing, the pattern and what is asked first

- **Editing** (Main settings) off hides every edit: the +, the renames, the options that change anything. The devices still work.
- **The pattern**, drawn on a 3 × 3 pad, is asked before Main settings opens, before a disarm, and before the alarm's and the Wi-Fi's sensitive
  changes; a pattern drawn a moment ago stands for the next words. A forgotten pattern: three presses of the reset open the boot rescue, which
  asks for none until the next restart. The pattern never leaves the panel.
- **What destroys is asked first**, in the colour of what destroys, with what it costs (a zone and its devices, a node and its devices).

## 7. The keyboard

The **EU** has three keyboards: QWERTY, a numeric pad that types letters by multiple taps (`2 abc`), and the symbols; **Keypad** in Main settings
makes the pad the one a rename opens. The **US** has two, both pads: the numeric one, where it always opens, and the symbols by multiple taps;
`#+=` and `ABC` go between them. On a pad the cursor blinks only once a character is in, not while another tap could still change it. A field
longer than its box slides.

## 8. Main settings

| row | what it does |
|---|---|
| Live update | a slider changes the light while dragging, not only on release |
| Keypad | renaming opens the 12-key pad instead of QWERTY (EU only) |
| Editing | off hides every edit; the devices still work |
| Button 1, Button 2 | Relay: a tap toggles the relay; Panel: a tap is for the zones marked with the button. A hold toggles the relay |
| Relay 1, Relay 2 | what each relay switches, and the Zigbee lamps it powers (set on the + of a zone) |
| Pattern | ask for a pattern before Main settings opens; change or remove it |
| Screensaver | when it starts, and when the screen goes dark on it |
| Date & time | the panel's clock, date and time zone; with Internet time on, the internet corrects it |
| Location | where the house is, for the sunrise and the sunset a schedule can follow |
| Info | the firmware and the screen that run, with their commits and dates |
| Factory reset | back to the factory image: zones, devices, Wi-Fi, MQTT and the house go; the screen stays |

## 9. The physical buttons and the relays

The panel's two buttons and two relays are its own. A button in **Relay** mode toggles its relay; in **Panel** mode a tap acts on the zones
marked with it, as their Tap says, and a hold always toggles the relay. A relay feeds **relay devices** (lamps on it, one device per lamp, all
changing together) or powers **Zigbee lamps**, which show "no power" while it is open.

## 10. The house's page

**Screens is the house's page**: the house's name as its title (a hold renames it), a row of icons (**Main settings**, **Wireless settings**,
the **calendar**, the **alarm**, the **notifications** and the **mesh**), and, below, the house's screens, the plans of the carousel, each with
its count of zones. With Editing on, the + adds a screen, and a screen's options rename it, reorganize its cards, move it up or down, and
delete it when it has no zones.

- **Wireless settings**: the Wi-Fi (search and join a network, the password typed on the glass; forget it; the hotspot, with a QR code to join
  it from a phone; the web setup), the house's MQTT ([07 §4](07-home-assistant.md)), the backup's state, and the **OTA** row: the release this
  node runs and the one the house offers, and Upgrade ([06](06-ota-and-backup.md)). A network on another channel than the house's is said so,
  and is not joined: it would take the node off the mesh.
- **The mesh**: a cog row first, the mesh's settings (the house's channel); then every node of the house, with how it is heard ("Mesh
  Strong(5), Wi-Fi Good"); and the **+**, which adds a node (a panel, a bridge, or the house's server) to this panel's house ([05 §2](05-the-house.md)).
  **A node's page** is its own Main settings and Wireless settings, drawn by that node and asked of it over the mesh, with what changes it
  taken to it with Editing on; what needs the node's own glass is shown and not touched. On it, with Editing on: **Join another house**, **Leave
  this house** (this panel, in another's house), and **Remove from house** (a bridge goes back to its factory settings, its Zigbee network
  and its devices erased). A bridge's page says whether it is this panel's favourite, and a tap makes it so.
- **The calendar**: the house's schedule, a month at a time (a swipe changes the month). A day touched is chosen, an event touched opens, and the
  + adds one for a device; an event has a start and an end, each with its own action, at an hour or at the sunrise or the sunset. A device's own
  schedule opens from its page's Schedule button, and the schedule runs on the panels, with or without Home Assistant.
- **The alarm**: its state, arming away or home, and disarming with the pattern; its settings (the exit, entry and siren times, what the panic
  does) are the house's, edited on any panel ([05 §5](05-the-house.md)). With no bridge in step, the screen says No link, and its buttons do
  nothing.
- **The notifications**, in three tabs (Now, Today, All), each with its grade, where and when; one touched opens whole, with Delete. A
  notification acknowledged or deleted on one panel is so on all; Delete all is at the foot of every tab, and Acknowledge all before it on Now.

## 11. The first boot, and a panel with no network

- **The first boot after a flash** is the installation: when the screen does not run the image's `.tft`, the brain darkens it, makes the
  buttons inert, flashes the `.tft` (the screen shows its own progress) and restarts, three tries at most. The screen says its build at boot, so
  this is decided within seconds.
- **A panel always has a house**: at its first boot it founds its own, and from its mesh page it joins another.
- **No network is needed.** A panel with no Wi-Fi works on its relays and over the mesh; its Wi-Fi is set from Wireless settings, or from a
  phone through the hotspot and the web setup.
- **The safeboot has a page of its own**: while a node's app is written over the mesh, the panel's screen shows the safeboot's progress
  ([06 §3](06-ota-and-backup.md)).
