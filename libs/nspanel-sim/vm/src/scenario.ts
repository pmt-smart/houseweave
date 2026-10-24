// What happens to a node or to the radio, as the bench's tests do it (cut the power, restart a node, take the radio away from a node, from a
// pair or from the house, lose a share of the frames),
// over what a SimHouse and an Air already have: a device that is unplugged and booted again from the flash it
// kept (device.ts: unplug, powerCycle, restartNow), a drop filter on the air (radio.ts: Air.drop), the networks a radio
// hears (Radio.networks). Nothing here is new behaviour: each is those, named, and a test that needs one says it in a line
// and does not build it again.
import type { SimDevice } from "./device.js";
import type { SimHouse } from "./house.js";
import type { Air, AirFrame, AirNode } from "./radio.js";

/** a node of a scenario: a device of a house, or a radio of the air's own (RadioDevice) */
export type FaultNode = SimDevice | AirNode;
const macOf = (n: FaultNode) => ("radio" in n ? n.radio.mac : n.mac);

/**
 * A node loses its power for `ms` and comes back: it is gone from the air and from the house's network for the time, the
 * rest of the house runs on, and the node boots again from what its flash kept, its clock lost with the power as the
 * RTC's is (SimDevice.powerCycle). `ms` 0 is a power that came back at once. The node that returns is a new one, the
 * house's from then on, and the old one is the test's no more: use the one this gives.
 */
export async function powerFailure<T extends SimDevice>(house: SimHouse, device: T, ms = 0): Promise<T> {
  device.unplug();
  if (ms > 0) house.advance(ms);
  return (await device.powerCycle()) as T;
}

/** A restart as Tasmota makes it, now (a Restart command, a watchdog): the node boots again from its flash, its clock kept. */
export async function restart<T extends SimDevice>(device: T): Promise<T> {
  return (await device.restartNow()) as T;
}

/** What a scenario put on the air, to be ended before its time. */
export interface AirFault {
  /** the frames it dropped so far */
  dropped: number;
  /** takes it away: what it dropped stays dropped, and the air is as it was before */
  end(): void;
}

/** which frames a fault takes: from or to this node, between these two, or any frame of the air when none is said */
export interface FaultScope {
  /** every frame this node sends, and every frame sent to it */
  node?: FaultNode;
  /** the frames between these two, both ways */
  between?: [FaultNode, FaultNode];
  /** and only these, of the ones the scope above matches */
  only?: (f: AirFrame) => boolean;
}

function inScope(scope: FaultScope, f: AirFrame): boolean {
  if (scope.node && f.from !== macOf(scope.node) && f.to !== macOf(scope.node)) return false;
  if (scope.between) {
    const [a, b] = scope.between.map(macOf);
    if (!((f.from === a && f.to === b) || (f.from === b && f.to === a))) return false;
  }
  return scope.only ? scope.only(f) : true;
}

/** a drop filter on the air, with the one it was before to go back to when it ends */
function fault(air: Air, takes: (f: AirFrame) => boolean): AirFault {
  const was = air.drop;
  let ended = false;
  const made: AirFault = {
    dropped: 0,
    end() {
      if (ended) return;
      ended = true;
      if (air.drop === drop) air.drop = was;
    },
  };
  const drop = (f: AirFrame) => {
    if (!ended && takes(f)) {
      made.dropped++;
      return true;
    }
    return was(f);
  };
  air.drop = drop;
  return made;
}

/**
 * The radio goes quiet for `ms` of the air's time, for the scope given (a node's, a pair's, or the whole house's): every
 * frame sent in that time, of that scope, never arrives, which is what a device out of range, a channel with a jammer on it
 * or a radio that is off looks like to the others. The air's time is the house's (SimHouse.air). The fault ends by itself,
 * or when end() says.
 */
export function quiet(air: Air, ms: number, scope: FaultScope = {}): AirFault {
  const until = air.now + ms;
  return fault(air, (f) => f.at < until && inScope(scope, f));
}

/**
 * A share of the frames is lost, `rate` from 0 to 1, drawn from a generator seeded with `seed` so that a run can be
 * repeated: the loss the alarm's cycles are tried against (10% and 30%). The scope narrows it as in quiet().
 */
export function loss(air: Air, rate: number, seed = 1, scope: FaultScope = {}): AirFault {
  let state = seed >>> 0 || 1;
  const next = () => {
    // xorshift32, as the radio's own generator is (radio_core.cpp)
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  return fault(air, (f) => inScope(scope, f) && next() < rate);
}

/**
 * The router goes away: no access point is in range of any device of the house, so each station that was associated
 * leaves its network at the next WiFi check, and the connections of the house's network end with it. The devices go on,
 * their ESP-NOW with them while the radio holds its channel. routerOn() brings it back.
 */
export function routerOff(house: SimHouse) {
  for (const d of house.devices) d.radio.networks([]);
}

/** The router is back, the access points the house was made with: the stations that lost it join again, as Tasmota's WiFi does. */
export function routerOn(house: SimHouse) {
  for (const d of house.devices) d.radio.networks(house.networks);
}

// --- the mesh -----------------------------------------------------------------------------------------------------------------------
//
// What happens to the nodes of a house's ESP-NOW mesh (the mesh cut and joined, a node that restarts and syncs): over the air
// the house's mesh has (house.enableMesh, mesh-driver.ts). A node that loses its power or restarts is a device that does (powerFailure, restart above): its
// driver starts the node again, under the next epoch, a new timeline whose clock begins at 0.

const meshOf = (house: SimHouse) => {
  if (!house.mesh) throw new Error("the house has no mesh: await house.enableMesh()");
  return house.mesh;
};

/**
 * The mesh's radio is cut in groups of nodes, by their numbers: a node hears only the nodes of its own group, on the radio and on the network. The nodes not
 * named stay in the group they were in (the one no cut has touched is the group 0). meshHeal() joins them.
 */
export function meshPartition(house: SimHouse, ...groups: number[][]) {
  meshOf(house).air.partition(groups);
}

/** a node of the mesh hears no one and is heard by no one, whatever its device does: out of the radio's reach, until meshHeal() */
export function meshIsolate(house: SimHouse, id: number) {
  meshOf(house).air.isolate(id);
}

/** every cut of the mesh taken away: all the nodes can hear each other again, as their links say */
export function meshHeal(house: SimHouse) {
  meshOf(house).air.heal();
}

/** the pace of a node's crystal from now on, in parts per million fast (negative: slow), against the house's time: what its counter has read stays */
export function meshDrift(house: SimHouse, id: number, ppm: number) {
  meshOf(house).air.setPpm(id, ppm);
}

/**
 * The mesh of a device alone restarts (EspNowMeshEnable 0 and 1, which is also what the driver does when the frame counter ends): the same boot of the
 * device, a new run of its node, under the next epoch: a new timeline, its clock at 0, and no event to Berry for it. The answer of the second command.
 */
export function meshRestart(device: SimDevice): string | null {
  device.console("EspNowMeshEnable 0");
  return device.console("EspNowMeshEnable 1");
}
