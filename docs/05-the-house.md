# 05 — The house

**The house is the mesh** ([04](04-the-mesh.md)): the bridges and the panels, with a name and a list of who belongs to it. It is a house of
**equal nodes**: any panel adds nodes, panels and bridges alike; no panel is tied to a bridge; a bridge is a node with its own Zigbee network and
its devices; and a panel is a window on the house, whose zones gather devices of any bridge. The house's layer is Berry, on top of the mesh
driver (`berry/house_*.be`, `berry/mesh_*.be`), the same in the panel's and the bridge's images.

## 1. The list

The house is **a list that only the panels write** (`berry/house_list.be`). Each write is an **entry** of one panel (its author), numbered by that
panel:

| kind | what it says |
|---|---|
| `IDENT` | a node's number and what it is: its role (bridge, panel, or the house's server), its public key (32 bytes) and its radio address (6) |
| `NAME` | a node's name, or, for the number 0, the house's |
| `REVOKE` | the node is struck off: every field of it goes, and the mark alone stays, so that its number is never used again |
| `SLOT` | a bridge's alarm number (1 to 15), the replica's counter |
| `ADDR`, `PORT` | a node's (or the server's) address on the house's network |
| `MQTT` | for the house: the broker, the port, the user, the password, the discovery and the battery timeout ([07 §4](07-home-assistant.md)) |
| `ALARM` | for the house: the exit, entry and siren times, what the panic does and its burst |
| `APAGE` | for a bridge: its devices in the alarm, in pages |
| `CHANNEL` | for the house: the Wi-Fi channel the mesh is on, and the instant the house moves to it |

The state is made of **fields**, one for each (kind, node): the entry with the greater **time** wins, and on a tie the panel with the lower number.
The time is a Lamport clock: a panel gives an entry a time above every time it has seen, so what it writes after reading another's entry wins over
it. A `REVOKE` is for good. Two `IDENT` for one number keep the lower public key, and the panel whose node lost it gives the node another number.

**What each node holds**: the fields, and the **vector**: for each author, the highest number whose entries it has taken, all of them (in order, or
all at once as a snapshot of the author's current fields). The vector's digest (3 bytes, FNV-1a) goes in every heartbeat; a node that sees a
neighbour's digest differ asks it, with its own vector (`berry/house_mesh.be`). An entry is taken only from its author, in a frame to this node
sealed with the key of the pair, and only from a panel of the list. A node keeps and passes on an entry of a kind or a role its build does not
know, so the list can grow without stopping at an older node; a list saved by an older format forgets its vector when read, and asks every author
again.

## 2. Coming in and going out

**A node comes in through "Add to this house"** (`berry/zigbee_pairing.be`, `berry/house_link.be`). A panel of the house that writes opens the search
from the + of its mesh page; the nodes whose **window** is open show up (a bridge opens its window with its button, a new panel with its own screen).
The one picked identifies itself (a bridge blinks, a panel says so on its screen), the person says Yes, and the two pair over ESP-NOW as a **guest's
exchange**: neither side writes a record, and the exchange's link lives in RAM while it lasts. Over that link the node says who it is, and the panel
gives it the **welcome** (its number, the house's key and the list, in pieces of up to 90 bytes, each acknowledged), the house's channel, and the
room's Zigbee channel for a new bridge; a bridge with no network is offered the panel's Wi-Fi, or offers its own (only after its button). Then the
exchange ends, the node is in the house, and everything else goes over the mesh. Wi-Fi passwords go only through the driver, over the encrypted link,
after a touch on the glass.

**A panel always has a house.** A panel whose driver has no number founds its own house ("House-" and a code of its radio address) at its first boot
and as soon as it leaves a house, unless it is waiting at its window to be taken by another. From its own house its mesh page offers to join another;
from another's, to leave.

**Going out**: a panel **removes** a node (the word to leave, and the node struck off with a change of the key); a panel **leaves** by itself; a
bridge's **Remove from house** sends it back to its factory state; **Join another house** sends a node out and opens its window for the other house.
A node that leaves loses the list, the keys and its number, here and in the driver (`EspNowMeshLeave`), and is a new node to any house. A node that
finds itself struck off leaves. A node removed is forgotten whole, by every node, the ones that were off included.

**The key changes when a node is struck off** (`berry/house_key.be`). The panel that strikes it draws a new key with a higher version and writes it
to its flash, with whom it must reach, **before** giving it to its own driver; then sends it to every node not struck off, in a frame for that node
alone, tagged with the previous key (which the node can still check), until each says it has it; then sends each a close, and lets its own previous
key go. A node takes a key only from a panel of its list, with a version above its own (within half the numbers, so an old frame played back cannot
take it back to the struck-off node's key). A node that says nothing is left to its button, or to the driver's 720 hours.

## 3. The house's shared settings

Some settings are **one for every node**, written by a panel into the list and applied by each node: the **MQTT** (`berry/house_mqtt.be`), the
**channel** (`berry/house_channel.be`: every node moves at an instant of the mesh's clock, a few seconds after the write, so none is left behind on the
old one; a house with no channel takes the network channel of the first panel that writes it), and the **alarm's configuration**
(`berry/house_alarm.be`: any panel edits it on one screen, and each bridge applies the part that is its own devices'). A node remembers what it applied
last, and applies a field only once: the driver's search may have moved the channel since, and an old field must not move it back.

## 4. Devices of another room

**A bridge owns its devices.** Their names, types and drivers live on it, and any panel administers them. A panel's zone can hold a device of any
bridge; the panel keeps only its own view.

- **Adding**: a zone's + offers **Pair new device** (on which bridge, the panel's favourite first; the search opens that bridge's Zigbee network over
  the mesh) and **Existing device**: a page of a bridge's devices at a time, one tap to take one (`berry/house_devices.be`; the bridge answers one
  frame a device, with its IEEE, model, endpoints and name, and the panel keeps only the page on the glass).
- **Commands** (`berry/panel_route.be`): every line the panel sends about a device goes, through `MeshCmd`, to the bridge that owns it, with the
  stamp of the mesh's clock ([12 §6](12-berry-notes.md)); a group's command goes to every bridge that holds members of the group. A line that names no
  device (the house's words: the alarm's, the time, the network map) goes to **the bridge of the house**: the panel's favourite in step on the mesh,
  or another in step. With none, it does not leave, and the "?" tells the person.
- **State** (`berry/house_state.be`): a panel that shows a device of a bridge tells that bridge so (a **mark**, said again every few minutes and at
  once when it changes); the bridge floods the state of the devices some panel marks, on the group key, and counts its state frames in its heartbeat.
  A panel that sees a sequence it has not heard asks for what it missed; an owner farther than its heartbeat reaches is noticed by a skipped number
  in its floods. A bridge that restarts has the marks back from its flash. A device a panel removes from the house is kept by its bridge as removed
  for a few days, said to the house at once and in every answer to a mark, so a panel that was off removes it when it comes back.
- **The sync gate** (`berry/panel_gate.be`): **no device is acted on by a bridge that is not in step.** A panel knows from the heartbeats whether
  the bridge that owns a device is there and synced; while it is not, its devices show the "no communication" icon and their tap does nothing,
  **before** the touch rather than as a "?" two seconds later. A bridge goes unavailable at once when silent (25 s after its last heartbeat),
  unheard, or not synced, and comes back only after several heartbeats in a row that say it is, so the buttons do not flicker. **A room works on its
  own**: the devices of the panel's own room are never held by the network's state.
- **The room's own traffic** goes over the mesh as well: the bridge in step is the room's session, and everything a panel says to its own bridge
  goes as frames of the mesh.

**Presence.** A node's heartbeat is not repeated, so by heartbeats a node sees only its neighbours. Every node of a house of more than one also
floods its **presence** (`MSG_HERE`) every 10 s on a bridge and 30 s on a panel, with how it is tied to the mesh and the nodes it hears in their
safeboot ([06 §5](06-ota-and-backup.md)): the house sees a node at any distance.

## 5. The alarm

The alarm lives on the bridges, which own the Zigbee networks and hear every report (`berry/zbbridge_alarm.be`). **Sensors** enter it by their
record: a role (off, perimeter, interior, 24 h), whether it grants the entry time, the grade of the notification it raises (off, local, house,
alert), the beep, a numeric condition (a crossing raises a notification, which clears 2 units back), and the hours of silence after which it is
reported quiet. **The states** are Home Assistant's: disarmed, arming (the exit time), armed home, armed away, pending (the entry time), triggered. A
24 h sensor or the panic triggers it from any state; disarming wins from any state. A siren that does not confirm is told again on a ladder.

**Every bridge of the house keeps the alarm's state in a replica** (`berry/zbbridge_alarm_merge.be`, carried over the mesh by
`berry/zbbridge_alarm_mesh.be`), and shows and acts on what the replica says. The state is a set of **heads**, every record nothing seen descends
from (usually one; never more than 15, one a bridge). A record is 52 bytes: the state, a **dot** naming one action forever, the timeline it was made
in, its **mark** in that timeline (100 ms ticks), and a version vector of 15 counters. The rule that folds the heads, in three layers:

1. **causality**: a record that descends from another replaces it, with no clock at all;
2. **the relative clock**: inside one timeline, between two trusted marks, the later wins;
3. **the safe side**: what cannot be placed (two timelines, an untrusted mark) falls to disarmed.

Two replicas with the same heads show the same state, in whatever order the copies reached them. The replica reads no wall clock; the dot counter is
written to flash **before** the action it names exists. A bridge with no alarm number or no mesh has no replica, and its alarm is its own. The exit and
siren times are counted from the record's mark, not from when a bridge learned of it, so a bridge that hears of an arm late does not start them again;
when the siren's time ends, the siren stops and the state stays triggered until a disarm. The heartbeat carries the replica's digest of its heads
(bytes 1 to 19), and a node that sees another's differ asks for its records.

A command to the alarm (the alarm's words) is **sensitive**: its window at the owner is 1 s, not 3. Home Assistant sees one alarm through one bridge
([07 §4](07-home-assistant.md)); the panels show it on the house's Alarm screen, with the pattern lock on the glass.

**Notifications**: the alarm's events, each with its grade, go to the panels, which keep a list (Now and the history) on the house's Notifications
screen; a notification is acknowledged, or deleted on one panel and so on all, and Acknowledge all and Delete all are at the foot of the list.

## 6. The house's server

The house's server (the HouseWeave add-on) joins the house by a pairing on a panel and becomes a member of the list with a number, but no node of
the mesh: it has no radio. It talks to the house over the network, through a node, and keeps the releases and the backups ([06](06-ota-and-backup.md)).
