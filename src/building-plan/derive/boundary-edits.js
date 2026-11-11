import { cleanPoint, polygonIssue } from '../geometry.js';
import { SAME, along, lineFrame, offset, pointAt } from './grid.js';
import { signedArea } from './room-lines.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const plus = (p, d) => ({ x: p.x + d.x, y: p.y + d.y });
const minus = (p, d) => ({ x: p.x - d.x, y: p.y - d.y });
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Intersection of the lines through p (direction u) and q (direction v), or null if parallel. */
function intersect(p, u, q, v) {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) <= 1e-12 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / det;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/** Vertex IDs of a room line in boundary order (see `roomLines`). */
export function lineVertexIds(room, line) {
  const edge = (id) => room.edges.find((entry) => entry.id === id);
  return [...line.edges.map((entry) => edge(entry.id).startId), edge(line.edges.at(-1).id).endId];
}

/**
 * Move the stretch [from, to] of one room line (stations of `line.frame`, the room's vertex
 * order) by `delta`, perpendicular to the line, and reconnect each end:
 *
 * - `slide`: the stretch ends at a corner; the corner slides along the adjoining edge, whose
 *   direction stays fixed.
 * - `jog` at `station`: the line continues straight; vertices between the stretch end and the
 *   station move with it (an extension), and a right-angle jog joins the moved line to the
 *   stationary vertex at the station.
 * - `shift` to `station`: the line ends at a jog that leads to a parallel continuation; the jog is
 *   placed at `station` (the moved line ends there, the continuation's first vertex slides along
 *   its line), or removed when `station` is null (the moved line joins the continuation).
 *
 * The room is edited in place. Returns, per resulting edge, its provenance: the old edge it is
 * part of with the old stations it spans (beyond the old ends when lengthened) and whether it
 * moved, or a jog. Edges of an extension carry `extension: 'start'|'end'` (the side they extend).
 *
 * @returns {{edges: Map<string, Object>, lengths: Map<string, number>}} Provenance by new edge
 *   ID, and the old edges' lengths.
 */
export function moveRoomStretch(room, plan, createId) {
  const { line, delta } = plan;
  const frame = line.frame;
  const [startEnd, endEnd] = plan.ends;
  const oldEdges = new Map(
    room.edges.map((edge) => {
      const point = (id) => room.vertices.find((vertex) => vertex.id === id);
      return [edge.id, { ...edge, frame: lineFrame(point(edge.startId), point(edge.endId)) }];
    })
  );
  // Working boundary: each entry keeps the vertex and where it came from in the old geometry.
  let list = room.vertices.map((vertex) => ({
    vertex: { ...vertex },
    back: { x: vertex.x, y: vertex.y },
    run: false,
  }));
  const indexOf = (id) => list.findIndex((entry) => entry.vertex.id === id);
  const ids = lineVertexIds(room, line);
  const station = (entry) => along(frame, entry.back);

  // Split the line at the stations where a stationary vertex must exist.
  const splits = [];
  if (startEnd.type === 'jog') splits.push(startEnd.station);
  if (endEnd.type === 'jog') splits.push(endEnd.station);
  for (const value of splits) {
    if (ids.some((id) => Math.abs(station(list[indexOf(id)]) - value) <= SAME)) continue;
    const after = ids.findIndex((id) => station(list[indexOf(id)]) > value);
    if (after <= 0) refuse('invalid_dimension', 'The edited extent is outside its room edge.');
    const point = cleanPoint(pointAt(frame, value));
    const id = createId();
    list.splice(indexOf(ids[after]), 0, { vertex: { id, ...point }, back: point, run: false });
    ids.splice(after, 0, id);
  }

  const lineEntries = ids.map((id) => list[indexOf(id)]);
  const low = startEnd.type === 'jog' ? startEnd.station : -Infinity;
  const high = endEnd.type === 'jog' ? endEnd.station : Infinity;
  const removed = new Set();
  for (const entry of lineEntries) {
    const value = station(entry);
    if (value > low + SAME && value < high - SAME) entry.run = true;
  }
  // `shift` ends: vertices beyond the new jog station leave the line.
  if (startEnd.type === 'shift' && startEnd.station != null)
    for (const entry of lineEntries.slice(1))
      if (station(entry) < startEnd.station - SAME) removed.add(entry.vertex.id);
  if (endEnd.type === 'shift' && endEnd.station != null)
    for (const entry of lineEntries.slice(0, -1))
      if (station(entry) > endEnd.station + SAME) removed.add(entry.vertex.id);

  for (const entry of lineEntries)
    if (entry.run) entry.vertex = { ...entry.vertex, ...cleanPoint(plus(entry.back, delta)) };

  const jogs = [];
  const reconnect = (end, atEnd) => {
    const corner = atEnd ? lineEntries.at(-1) : lineEntries[0];
    const position = indexOf(corner.vertex.id);
    const step = atEnd ? 1 : -1;
    const neighbour = list[(position + step + list.length) % list.length];
    if (end.type === 'slide') {
      const point = intersect(
        corner.vertex,
        frame.tangent,
        neighbour.back,
        minus(corner.back, neighbour.back)
      );
      if (!point) refuse('invalid_room_geometry', 'This edit would collapse a wall.');
      corner.vertex = { ...corner.vertex, ...cleanPoint(point) };
      corner.back = minus(point, delta);
      corner.out = point;
      return;
    }
    if (end.type === 'jog') {
      // The stationary vertex at the station stays; a moved copy starts the jog.
      const stay = lineEntries.find((entry) => Math.abs(station(entry) - end.station) <= SAME);
      const point = cleanPoint(plus(stay.back, delta));
      const moved = { vertex: { id: createId(), ...point }, back: stay.back, run: true };
      const at = indexOf(stay.vertex.id);
      list.splice(atEnd ? at : at + 1, 0, moved);
      jogs.push({
        ids: atEnd ? [moved.vertex.id, stay.vertex.id] : [stay.vertex.id, moved.vertex.id],
        end: atEnd ? 1 : 0,
      });
      return;
    }
    // shift: the line's end vertex is the top of a jog leading to the continuation.
    const far = list[(position + 2 * step + list.length) % list.length];
    const jogDirection = minus(neighbour.back, corner.back);
    const continuation = minus(far.back, neighbour.back);
    if (end.station == null) {
      // The moved line now runs on the continuation: its last edge reaches the continuation's
      // first vertex, which is read back on the old line like a slid corner.
      removed.add(corner.vertex.id);
      neighbour.out = neighbour.back;
      neighbour.back = minus(neighbour.back, delta);
      neighbour.run = true;
      return;
    }
    const top = plus(pointAt(frame, end.station), delta);
    const foot = intersect(top, jogDirection, neighbour.back, continuation);
    if (!foot) refuse('invalid_room_geometry', 'This edit would collapse a wall.');
    corner.vertex = { ...corner.vertex, ...cleanPoint(top) };
    corner.back = pointAt(frame, end.station);
    corner.run = true;
    neighbour.vertex = { ...neighbour.vertex, ...cleanPoint(foot) };
    neighbour.back = foot;
    neighbour.out = foot;
    const old = room.edges.find((edge) =>
      atEnd
        ? edge.startId === corner.vertex.id && edge.endId === neighbour.vertex.id
        : edge.startId === neighbour.vertex.id && edge.endId === corner.vertex.id
    );
    jogs.push({
      ids: atEnd
        ? [corner.vertex.id, neighbour.vertex.id]
        : [neighbour.vertex.id, corner.vertex.id],
      replaces: old?.id ?? null,
      end: atEnd ? 1 : 0,
    });
  };
  reconnect(startEnd, false);
  reconnect(endEnd, true);
  list = list.filter((entry) => !removed.has(entry.vertex.id));
  list = mergeCollapsed(list);

  const vertices = list.map((entry) => entry.vertex);
  const problem = polygonIssue(vertices);
  if (problem || Math.sign(signedArea(vertices)) !== Math.sign(signedArea(room.vertices)))
    refuse('invalid_room_geometry', problem || 'This edit would turn the room inside out.');
  const lengths = new Map([...oldEdges].map(([id, edge]) => [id, edge.frame?.length ?? 0]));
  return { edges: rebuildEdges(room, list, oldEdges, jogs, plan, createId), lengths };
}

/** Drop zero-length edges: a moved vertex that lands on its neighbour merges into it. */
function mergeCollapsed(list) {
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
function rebuildEdges(room, list, oldEdges, jogs, plan, createId) {
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
