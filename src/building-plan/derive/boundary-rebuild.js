import { SAME, along, offset } from './grid.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Drop zero-length edges: a moved vertex that lands on its neighbour merges into it. */
export function mergeCollapsed(list) {
  for (let i = 0; i < list.length && list.length > 3; ) {
    const next = (i + 1) % list.length;
    if (gap(list[i].vertex, list[next].vertex) > SAME) {
      i++;
      continue;
    }
    // Keep the vertex that did not move, and any explicit cut. A kept stationary vertex now also
    // ends the moved line: it is read back on the old line for the run's edge.
    const [keep, drop] = list[i].run && !list[next].run ? [next, i] : [i, next];
    const [kept, gone] = [list[keep], list[drop]];
    if (gone.vertex.editingCutId && !kept.vertex.editingCutId)
      kept.vertex = { ...kept.vertex, editingCutId: gone.vertex.editingCutId };
    if (gone.run && !kept.run) {
      kept.out = kept.out || kept.back;
      kept.back = gone.back;
      kept.run = true;
    }
    list.splice(drop, 1);
    if (drop < i) i--;
  }
  return list;
}

/**
 * New edges from consecutive vertices, with provenance: a jog, or the old edge whose line holds
 * both ends' old positions (run edges are read back on the old line, other edges where they are).
 */
export function rebuildEdges(room, list, oldEdges, jogs, plan, createId) {
  const provenance = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const b = list[(i + 1) % list.length];
    const pair = [a.vertex.id, b.vertex.id];
    const jog = jogs.find((entry) => entry.ids[0] === pair[0] && entry.ids[1] === pair[1]);
    if (jog) {
      provenance.push({
        startId: pair[0],
        endId: pair[1],
        jog: true,
        replaces: jog.replaces ?? null,
        end: jog.end,
      });
      continue;
    }
    // A run edge is read back on the old line; any other edge where its ends lie (a slid corner
    // or a slid continuation vertex at its new place on the old edge's line).
    const run = a.run && b.run;
    const [p, q] = run ? [a.back, b.back] : [a.out || a.back, b.out || b.back];
    let best = null;
    for (const edge of oldEdges.values()) {
      if (!edge.frame) continue;
      if (Math.abs(offset(edge.frame, p)) > SAME || Math.abs(offset(edge.frame, q)) > SAME)
        continue;
      const [from, to] = [along(edge.frame, p), along(edge.frame, q)];
      if (to - from <= SAME) continue;
      const shared = Math.min(to, edge.frame.length) - Math.max(from, 0);
      if (shared < -SAME || (best && best.shared >= shared)) continue;
      best = { edge, from, to, shared };
    }
    if (!best) refuse('invalid_room_geometry', 'This edit would break the room outline.');
    const stations = run ? [along(plan.line.frame, p), along(plan.line.frame, q)] : null;
    provenance.push({
      startId: pair[0],
      endId: pair[1],
      edgeId: best.edge.id,
      from: best.from,
      to: best.to,
      // A turned stretch also stretches: new stations are old ones times this ratio.
      ratio: run && plan.map ? gap(a.vertex, b.vertex) / (best.to - best.from) : 1,
      moved: run,
      extension: !stations
        ? null
        : Math.max(...stations) <= plan.from + SAME
          ? 'start'
          : Math.min(...stations) >= plan.to - SAME
            ? 'end'
            : null,
    });
  }
  // Each old edge's ID stays with one part: the preferred one, else the part covering most of it.
  const keeper = new Map();
  for (const entry of provenance) {
    if (entry.jog) continue;
    const length =
      Math.min(entry.to, oldEdges.get(entry.edgeId).frame.length) - Math.max(entry.from, 0);
    const preferred = plan.preferMoved?.includes(entry.edgeId) && entry.moved;
    const rank = (preferred ? 1e9 : 0) + length;
    if (!keeper.has(entry.edgeId) || keeper.get(entry.edgeId).rank < rank)
      keeper.set(entry.edgeId, { entry, rank });
  }
  const result = new Map();
  const used = new Set();
  for (const entry of provenance) {
    let id;
    if (entry.jog && entry.replaces && !used.has(entry.replaces)) id = entry.replaces;
    else if (!entry.jog && keeper.get(entry.edgeId).entry === entry) id = entry.edgeId;
    else id = createId();
    used.add(id);
    entry.id = id;
    result.set(id, entry);
  }
  room.vertices = list.map((entry) => entry.vertex);
  room.edges = provenance.map(({ id, startId, endId }) => ({ id, startId, endId }));
  return result;
}
