import { cleanPoint, polygonIssue } from '../geometry.js';
import { SAME, along, lineFrame, offset, pointAt } from './grid.js';
import { signedArea } from './room-lines.js';
import { mergeCollapsed, rebuildEdges } from './boundary-rebuild.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const plus = (p, d) => ({ x: p.x + d.x, y: p.y + d.y });
const minus = (p, d) => ({ x: p.x - d.x, y: p.y - d.y });

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
 * order) by `delta`, perpendicular to the line, or by `map` (an affine map of the line's points,
 * with its inverse `unmap`: a corner drag turns the line), and reconnect each end:
 *
 * - `slide`: the stretch ends at a corner; the corner slides along the adjoining edge, whose
 *   direction stays fixed.
 * - `jog` at `station`: the line continues straight; vertices between the stretch end and the
 *   station move with it (an extension), and a right-angle jog joins the moved line to the
 *   stationary vertex at the station.
 * - `shift` to `station`: the line ends at a jog that leads to a parallel continuation; the jog is
 *   placed at `station` (the moved line ends there, the continuation's first vertex slides along
 *   its line), or removed when `station` is null (the moved line joins the continuation).
 * - `bend` at `station` to `point`: a turned stretch ends where it crosses the line beyond; the
 *   vertex at the station moves to that point, no jog. With no station the line's end vertex
 *   stays where the turn carries it (the moved line lies on the adjoining line).
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
  const map = plan.map || ((point) => plus(point, delta));
  const unmap = plan.unmap || ((point) => minus(point, delta));
  // Where the moved line crosses a line through `point` in `direction` (a jog's line): a jog
  // stays square to the old line even when the edit turns the moved one.
  const movedOrigin = map(frame.start);
  const movedDirection = minus(map(frame.end), movedOrigin);
  const onMovedLine = (point, direction) =>
    intersect(movedOrigin, movedDirection, point, direction) || map(point);
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

  // Split the line at the stations where a vertex must exist (a jog's foot, a bend).
  const atStation = (end) => ['jog', 'bend'].includes(end.type) && end.station != null;
  const splits = [startEnd, endEnd].filter(atStation).map((end) => end.station);
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
  const low = atStation(startEnd) ? startEnd.station : -Infinity;
  const high = atStation(endEnd) ? endEnd.station : Infinity;
  const removed = new Set();
  for (const entry of lineEntries) {
    const value = station(entry);
    if (value > low + SAME && value < high - SAME) entry.run = true;
  }
  // `shift` ends: vertices at or beyond the new jog station leave the line; the jog's corner takes
  // the place of one at the station (and its cut, if any).
  const leave = (entry, top) => {
    removed.add(entry.vertex.id);
    if (entry.vertex.editingCutId && !top.vertex.editingCutId)
      top.vertex = { ...top.vertex, editingCutId: entry.vertex.editingCutId };
  };
  if (startEnd.type === 'shift' && startEnd.station != null)
    for (const entry of lineEntries.slice(1, -1))
      if (station(entry) < startEnd.station + SAME) leave(entry, lineEntries[0]);
  if (endEnd.type === 'shift' && endEnd.station != null)
    for (const entry of lineEntries.slice(1, -1))
      if (station(entry) > endEnd.station - SAME) leave(entry, lineEntries.at(-1));

  for (const entry of lineEntries)
    if (entry.run) entry.vertex = { ...entry.vertex, ...cleanPoint(map(entry.back)) };

  // Decision E: vertices of the moved line that an end placed on it (a slid corner, a bend) has
  // reached or passed leave the outline; passing a cut refuses (moving cuts belongs to item 4).
  const movedFrame = lineFrame(movedOrigin, map(frame.end));
  const leavePassed = (placed, atEnd) => {
    if (!movedFrame) return;
    const inner = lineEntries.slice(1, -1);
    const order = atEnd ? inner.reverse() : inner;
    const outward = (entry) => (atEnd ? 1 : -1) * along(movedFrame, entry.vertex);
    // Inner vertices from the placed end inwards (after it when it is itself an inner vertex).
    for (const entry of order.slice(order.indexOf(placed) + 1)) {
      if (!entry.run || outward(entry) < outward(placed) - SAME) break;
      if (entry.vertex.editingCutId)
        refuse('invalid_room_geometry', 'This edit would pass a cut of its wall.');
      removed.add(entry.vertex.id);
    }
  };

  const jogs = [];
  const reconnect = (end, atEnd) => {
    const corner = atEnd ? lineEntries.at(-1) : lineEntries[0];
    const position = indexOf(corner.vertex.id);
    const step = atEnd ? 1 : -1;
    const neighbour = list[(position + step + list.length) % list.length];
    if (end.type === 'slide') {
      // The corner slides along the outline beyond it until the moved line meets it: the
      // adjoining line (lengthened or shortened), or, when the moved line passes that line's far
      // end, a later edge; the vertices it passes leave the outline (their edges collapse).
      const movedDirection = minus(map(frame.end), map(frame.start));
      const at = (k) => list[(position + k * step + 2 * list.length) % list.length];
      let point = null;
      for (let k = 1; k < Math.min(list.length - 1, 8) && !point; k++) {
        const [from, to] = [k === 1 ? corner.back : at(k - 1).back, at(k).back];
        const edge = lineFrame(from, to);
        if (!edge) continue;
        const hit = intersect(corner.vertex, movedDirection, from, minus(to, from));
        const reach = hit && along(edge, hit);
        // The first edge may lengthen (the corner moves away from it); later ones must contain it.
        if (hit && reach <= edge.length + SAME && (k === 1 || reach >= -SAME)) {
          point = hit;
          for (let passed = 1; passed < k; passed++) removed.add(at(passed).vertex.id);
        }
      }
      if (!point) refuse('invalid_room_geometry', 'This edit would collapse a wall.');
      corner.vertex = { ...corner.vertex, ...cleanPoint(point) };
      corner.back = unmap(point);
      corner.out = point;
      leavePassed(corner, atEnd);
      return;
    }
    if (end.type === 'bend') {
      // The vertex at the station (or the line's end) is where the moved line meets the line
      // beyond: read back on the old line for the moved edge, where it is for the other.
      const entry = atStation(end)
        ? lineEntries.find((item) => Math.abs(station(item) - end.station) <= SAME)
        : corner;
      if (end.point) {
        entry.vertex = { ...entry.vertex, ...cleanPoint(end.point) };
        entry.back = unmap(end.point);
      }
      entry.out = { x: entry.vertex.x, y: entry.vertex.y };
      entry.run = true;
      leavePassed(entry, atEnd);
      return;
    }
    if (end.type === 'jog') {
      // The stationary vertex at the station stays; a moved copy starts the jog.
      const stay = lineEntries.find((entry) => Math.abs(station(entry) - end.station) <= SAME);
      const point = cleanPoint(onMovedLine(stay.back, end.direction || frame.normal));
      const moved = { vertex: { id: createId(), ...point }, back: stay.back, run: true };
      const at = indexOf(stay.vertex.id);
      list.splice(atEnd ? at : at + 1, 0, moved);
      jogs.push({
        ids: atEnd ? [moved.vertex.id, stay.vertex.id] : [stay.vertex.id, moved.vertex.id],
        end: atEnd ? 1 : 0,
      });
      return;
    }
    // shift: the line's end vertex is the top of a jog (one or more collinear edges) leading to
    // the continuation; the jog's inner stations go, the derivation places them again.
    const at = (k) => list[(position + k * step + 2 * list.length) % list.length];
    const jogFrame = lineFrame(corner.back, neighbour.back);
    let reach = 1;
    while (
      jogFrame &&
      reach < list.length - 2 &&
      Math.abs(offset(jogFrame, at(reach + 1).back)) <= SAME
    )
      reach++;
    const foot = at(reach);
    const far = at(reach + 1);
    const jogEdges = [];
    for (let k = 0; k < reach; k++) {
      const [p, q] = atEnd ? [at(k), at(k + 1)] : [at(k + 1), at(k)];
      const edge = room.edges.find(
        (entry) => entry.startId === p.vertex.id && entry.endId === q.vertex.id
      );
      if (edge) jogEdges.push(oldEdges.get(edge.id));
      if (k > 0) removed.add(at(k).vertex.id);
    }
    const jogDirection = minus(foot.back, corner.back);
    const continuation = minus(far.back, foot.back);
    if (end.station == null) {
      // The moved line now runs on the continuation: its last edge reaches the continuation's
      // first vertex, which is read back on the old line like a slid corner.
      removed.add(corner.vertex.id);
      foot.out = foot.back;
      foot.back = unmap(foot.back);
      foot.run = true;
      return;
    }
    const top = onMovedLine(pointAt(frame, end.station), jogDirection);
    const point = intersect(top, jogDirection, foot.back, continuation);
    if (!point) refuse('invalid_room_geometry', 'This edit would collapse a wall.');
    corner.vertex = { ...corner.vertex, ...cleanPoint(top) };
    corner.back = pointAt(frame, end.station);
    corner.run = true;
    foot.vertex = { ...foot.vertex, ...cleanPoint(point) };
    foot.back = point;
    foot.out = point;
    // The relocated jog keeps the identity of its longest old edge among those it owned (the
    // planner's `keep`; a stretch that was another wall's contact is not the jog's own).
    const own = end.keep ? jogEdges.filter((edge) => end.keep.includes(edge.id)) : jogEdges;
    const old = [...own].sort((x, y) => (y.frame?.length ?? 0) - (x.frame?.length ?? 0))[0];
    jogs.push({
      ids: atEnd ? [corner.vertex.id, foot.vertex.id] : [foot.vertex.id, corner.vertex.id],
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
