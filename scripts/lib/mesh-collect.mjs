// What the bench's collectors make of the lists the devices answer: the answers of all the devices
// put together, the way no one device can say. Pure functions over the answers, so that a test holds them to what the
// simulator's own graph (libs/nspanel-sim/vm/src/mesh.ts: healthGraph and articulationPoints) says of the same house.

/** the nodes of a list of numbers, ascending and without repeats */
const sorted = (set) => [...set].sort((a, b) => a - b);

/**
 * The graph the nodes' own reports describe, put together: an edge when each of the two counts on the other as a way (a neighbour that is `Usable`
 * in the report of the one and of the other). `reports` is [{ id, list: [{ Id, Usable, ... }], cut? }], one for each device that answered.
 */
export function healthGraph(reports) {
  const counts = new Map();
  for (const r of reports) counts.set(r.id, new Set(r.list.filter((e) => e.Usable === 1).map((e) => e.Id)));
  const graph = new Map();
  for (const r of reports) graph.set(r.id, new Set());
  const oneSided = [];
  for (const [a, set] of counts) {
    for (const b of set) {
      if (counts.get(b)?.has(a)) {
        graph.get(a).add(b);
        graph.get(b).add(a);
      } else if (counts.has(b)) {
        // a counts on b, and b, which answered, does not count on a: a link of one hand
        oneSided.push([a, b]);
      }
    }
  }
  return { graph, oneSided };
}

/** The nodes whose going away would split the graph (Tarjan), ascending. */
export function articulationPoints(graph) {
  const disc = new Map();
  const low = new Map();
  const cut = new Set();
  let time = 0;
  const visit = (u, parent) => {
    disc.set(u, ++time);
    low.set(u, time);
    let children = 0;
    for (const v of graph.get(u) ?? []) {
      if (!disc.has(v)) {
        children++;
        visit(v, u);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (parent !== null && low.get(v) >= disc.get(u)) cut.add(u);
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u), disc.get(v)));
      }
    }
    if (parent === null && children > 1) cut.add(u);
  };
  for (const u of graph.keys()) if (!disc.has(u)) visit(u, null);
  return sorted(cut);
}

/** How many pieces the graph is in: more than one is a house that is already split. */
export function components(graph) {
  const seen = new Set();
  let n = 0;
  for (const u of graph.keys()) {
    if (seen.has(u)) continue;
    n++;
    const stack = [u];
    while (stack.length > 0) {
      const v = stack.pop();
      if (seen.has(v)) continue;
      seen.add(v);
      for (const w of graph.get(v) ?? []) stack.push(w);
    }
  }
  return n;
}

/**
 * The health of the house, from what every device says of its neighbours. `reports` is [{ id, list, cut }]: the node's number, the
 * neighbours of its EspNowMeshHealth, and its own `Cut` (1 when it marked itself a single point of failure). Says the points a collector finds
 * against the ones the devices marked: a ring of five nodes or more marks every node and has no single point, and the collector is the answer.
 */
export function healthSummary(reports) {
  const { graph, oneSided } = healthGraph(reports);
  const articulation = articulationPoints(graph);
  const marked = sorted(new Set(reports.filter((r) => r.cut === 1).map((r) => r.id)));
  const edges = [];
  for (const [a, set] of graph) for (const b of set) if (a < b) edges.push([a, b]);
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return {
    nodes: sorted(graph.keys()),
    edges,
    components: components(graph),
    articulation,
    marked,
    // marked and no single point: the false alarms of a device that sees two hops; a point the device did not mark: one it could not see
    falseAlarm: marked.filter((id) => !articulation.includes(id)),
    missed: articulation.filter((id) => !marked.includes(id)),
    oneSided,
  };
}

/**
 * The time of the house, from what every device says of its clock and its neighbours'. `reports` is [{ id, clock, list }]: the node's number,
 * the head of its EspNowMeshClock (Clock, Synced, Adopted, Timeline, Tag, Mesh, Ticks10, Taken, Steps, EventsLost) and its neighbours
 * ({ Id, Seen, Sync, Skew, Timeline }). Item 1 wants one timeline and all synchronised; item 2, a neighbour in another timeline (`Seen` 1) minutes after the
 * start; item 3, the skew of a neighbour's beat, which a follower never has ahead (0 or negative when the clocks agree).
 */
export function clockSummary(reports) {
  const timelines = [...new Set(reports.map((r) => r.clock.Timeline))].sort();
  const otherTimeline = [];
  const noClock = [];
  const skews = [];
  for (const r of reports) {
    for (const n of r.list) {
      if (n.Seen === 1) otherTimeline.push([r.id, n.Id]);
      else if (n.Seen === 0) noClock.push([r.id, n.Id]);
      if (Number.isFinite(n.Skew)) skews.push(n.Skew);
    }
  }
  return {
    nodes: sorted(new Set(reports.map((r) => r.id))),
    timelines,
    sameTimeline: timelines.length === 1,
    unsynced: sorted(new Set(reports.filter((r) => r.clock.Synced !== 1).map((r) => r.id))),
    taken: sorted(new Set(reports.filter((r) => r.clock.Taken === 1).map((r) => r.id))),
    otherTimeline,
    noClock,
    // the neighbours' skew, in ms, and the greatest of them: the budget is 60 ms
    skewMs: skews.length > 0 ? { min: Math.min(...skews), max: Math.max(...skews) } : null,
    steps: Object.fromEntries(reports.map((r) => [r.id, r.clock.Steps])),
    eventsLost: sorted(new Set(reports.filter((r) => r.clock.EventsLost > 0).map((r) => r.id))),
  };
}

/**
 * The house, from what each node has of it. `reports` is [{ id, house }]: the node's number and its HouseStatus (Me, Up, Name, Key, Pending, Nodes, and a Digest
 * of the list when the node says one). A house is one when the nodes agree on its name, the version of its key and the nodes of its list, and the
 * differences are said by node: who has another name, another key, a node missing or a different one, and who has its mesh down or a key change pending.
 */
export function houseSummary(reports) {
  const key = (n) => `${n.Id}:${n.Role}:${n.Revoked ? 1 : 0}:${n.Name}`;
  const lists = reports.map((r) => ({ id: r.id, nodes: new Set((r.house.Nodes ?? []).map(key)) }));
  const all = new Set(lists.flatMap((l) => [...l.nodes]));
  const names = [...new Set(reports.map((r) => r.house.Name))].sort();
  const keys = [...new Set(reports.map((r) => r.house.Key))].sort((a, b) => a - b);
  const digests = [...new Set(reports.map((r) => r.house.Digest).filter((d) => d !== undefined))].sort();
  const missing = {};
  for (const l of lists) {
    const lack = [...all].filter((k) => !l.nodes.has(k));
    if (lack.length > 0) missing[l.id] = lack.sort();
  }
  return {
    nodes: sorted(new Set(reports.map((r) => r.id))),
    names,
    sameName: names.length === 1,
    keyVersions: keys,
    sameKey: keys.length === 1,
    digests,
    sameDigest: digests.length <= 1,
    sameList: Object.keys(missing).length === 0,
    missing,
    down: sorted(new Set(reports.filter((r) => r.house.Up !== 1).map((r) => r.id))),
    pending: sorted(new Set(reports.filter((r) => r.house.Pending === 1).map((r) => r.id))),
  };
}
