# HouseWeave, the house's package for Home Assistant

*A smart house mesh, built on ESP32.* It serves the nodes' releases and keeps their backups, over plain HTTP on the house's network, and carries
the Home Assistant integration that turns the panels' schedule into Home Assistant calendars. It runs on the Home Assistant machine. What it is
and how it talks to the house: [docs/06](../../docs/06-ota-and-backup.md) and [docs/07](../../docs/07-home-assistant.md).

**The app** (the Studio, the House and the Settings) is served on the app's port and shows in Home Assistant's sidebar, through the ingress. It
goes built in `app/`, which the package's script assembles, from the repository's root:

```
node scripts/ha-addon.mjs
```

On a PC, `APP_DIR` points to another folder. From the add-on repository, `app/` arrives empty and Home Assistant builds the app when it builds
the image, from the code of the version's tag (`v1.5.0`): installing or updating takes a few minutes. A folder with the app the script built, as
the local add-on's, goes as it is.

**The version** is the one in `config.yaml`, one for the server, the integration and the app. The script takes the package's fingerprint (the
files Home Assistant builds the image from) and keeps it in `version-lock.json`, in the same commit. A version is released with the tag
`v<version>`, which Home Assistant builds from: after its commit,

```
node scripts/ha-addon.mjs --release
git push origin v<version>
```

Before the tag, the version follows the package's changes; after it, a changed package in the same version is refused, and a new version needs
its line in `CHANGELOG.md` (`## 1.6.0`), which Home Assistant shows. `--no-build` only checks, without building.

The build in Home Assistant runs the simulator's `npm ci` on Alpine, which needs its native binaries (the bundler and the CSS minifier), and npm,
run on Windows, writes only Windows's into `libs/nspanel-sim/package-lock.json`. The script checks they are there, and
`node scripts/ha-addon.mjs --lock` adds the missing ones.

**Two ports** (the server is `server/release-server.mjs`):

- **the nodes' port, 8080**, on the house's network: the releases and the routes the nodes sign (the hello, the backup, an answer another node
  carried). The owner's API does not answer here;
- **the app's port, 8099**: the owner's API (the fleet, the requests to a node, the round, the hardware swap, the pairing) and the releases,
  read-only. It has no login of its own: it listens on `APP_HOST` (`127.0.0.1` unless told otherwise, the machine itself) and, with `APP_FROM`,
  answers only those addresses. In the add-on, only Home Assistant's ingress (`172.30.32.2`), which passes only who logged into Home Assistant.

The house's folder is `/share/houseweave`, and the releases go in it ([docs/11 §7](../../docs/11-build-and-flash.md)). The server's
identity, the house and the nodes' backups live in the data folder, which it never serves (`/data` in the add-on): `backups/<the node's radio
address>.json`, one per node, with the nine before it beside it, from `.1` (the newest) to `.9`.

A node writes and reads its own backup only with a request signed by the key of its pair with the server, which the two derive from their
X25519 identities, with nothing on the network. That is why the server must be in the house: paired on a panel (below), it receives the nodes'
public keys and addresses, and each node finds it in the house's list.

**When the backup goes:** a change leaves the node's configuration marked as not saved, and it goes in the nightly round, which the server runs
at the house's hour (02:00, or what the app says): it calls each node, one at a time, and a node that changed since its last backup sends it. Or
at once, by the node's Back up now, or by the app's Backup, of one node or of all.

## On Home Assistant OS, from the add-on repository

1. In Settings, Add-ons, Add-on store, the three-dot menu: Repositories, and add `https://github.com/pmt-smart/houseweave`
   (`repository.yaml`, at the repository's root, describes it).
2. HouseWeave shows in the store: install it (Home Assistant builds the app from the version's source, which takes a few minutes) and start it.
   Home Assistant offers each new version with its update button.
3. Pair the server on a panel, as below.

## On Home Assistant OS, as a local add-on

1. Run the package's script (above), which puts the app in `app/`, and copy this folder, `houseweave`, to `/addons` on the Home Assistant
   machine, through the Samba or the SSH add-on.
2. In Settings, Add-ons, Add-on store, the three-dot menu: Check for updates. The add-on shows under "Local add-ons".
3. Install and start it. The nodes' port is 8080, and the add-on's Network tab changes it. The address the nodes use comes from the Supervisor:
   the machine's IP and the Network tab's port. The app's port does not go to the network.
4. Pair the server on a panel (below, "The server joins the house"): in Wireless settings, OTA, Backup, the Server row shows its name.

The releases go in Samba's `share` folder, in `houseweave/`.

## The integration: a calendar for each device

The add-on copies the integration (`custom_components/houseweave`) into Home Assistant's configuration when it starts, whenever the
version Home Assistant has is another, and its log says "INTEGRATION: copied".

1. Restart Home Assistant once after the copy.
2. In Settings, Devices & services, Add integration: HouseWeave (its technical name is `houseweave`). There is nothing to type: it uses the MQTT Home
   Assistant already has.
3. Each device the panels' schedule turns on and off becomes a calendar (`calendar.thermostat_1`), seen and edited in Home Assistant's calendar.
   The panel checks every change and refuses one with the sentence the glass would say, which Home Assistant shows.

A new version of the add-on brings the integration's new version, and asks for the restart again.

## On Home Assistant Container, as a container beside it

```
docker build -t houseweave ha/houseweave
docker run -d --name houseweave --restart unless-stopped -p 8080:8080 -p 127.0.0.1:8099:8099 -v /srv/houseweave:/share/houseweave -v /srv/houseweave-server:/data -e SERVER_HOST=<this machine's IP> -e APP_FROM= houseweave
```

`docker build` takes the app the package's script put in `app/`; without it, it builds the one of the tag that `--build-arg
BUILD_VERSION=<version>` names.

The house's folder is `/srv/houseweave`, or what `-v` says. The integration, here, is copied by hand: the folder
`custom_components/houseweave` goes into the `custom_components` of Home Assistant's configuration, and Home Assistant restarts.
`SERVER_HOST` is the address the nodes use to reach this machine, and `SERVER_PORT` the port, 8080 when not given: from inside the container, the
server does not know the machine's address. The app's port, here, stays on the machine itself (`127.0.0.1:8099`), and an empty `APP_FROM` lets it
answer whoever reaches it.

## Outside Home Assistant, to test

```
node ha/houseweave/server/release-server.mjs <folder> 8080 8099
```

The nodes' port and the app's; the app's only on this machine, unless `APP_HOST` says another. With `SERVER_HOST`, to tell the house where the
nodes find it; without it, this machine's address on the network of the panel that pairs it.

## The house's OTA: the releases, the server in the house, and the app

**The releases** go in `ota/`, inside the house's folder, through the releases' tool, which signs them with the house's key:

```
node scripts/ota-release.mjs publish releases/tasmota32-houseweave-living-room-us-<commit>-<fork>.bin releases/tasmota32-houseweave-safeboot-<commit>-<fork>.bin --to <the house's folder>/ota
```

Each image goes in `ota/<env>.ota/` (the manifest and the blocks), the safeboot in `ota/houseweave-safeboot.bin` with its signature beside it, and
`ota/index.json` says the build of each. The OTA row of each node's Wireless settings reads that index and offers Upgrade when the server's build
is another than the node's. An image not given to `publish` stays as it was.

**The server joins the house** by a pairing on a panel: on the mesh page, the +, and Add server; the panel shows a 6-digit code and its address
for 2 minutes. In the app's Settings, Pair with a house, both are typed. The server keeps its identity (an X25519 pair, `server-x25519.pem`) and
the house (`house.json`) in the data folder, which it never serves: `DATA_DIR`, `/data` in the add-on and, on a PC, `<the house's folder>-server`
beside the folder. In a container, the data folder needs a volume (`-v /srv/houseweave-server:/data`), or a new container is another
server, and the house pairs it again.

**The app's House** talks to the app's port at `/api` and `/ota`: the house, the nodes with each one's state and the last backup the server
keeps, Backup, Upgrade and State of one node or of all, and the hour of the nightly round. On a PC, the simulator's development server passes
those to the app's port of a server on that PC, `http://localhost:8098`, or to `RELEASE_SERVER`. On a bench where the house was paired with a
server whose nodes' port is 8099:

```
node ha/houseweave/server/release-server.mjs releases/ota-test 8099 8098
npm run dev --prefix libs/nspanel-sim/sim
```
