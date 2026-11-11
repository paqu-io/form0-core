import { cleanPoint, isPoint, polygonIssue } from '../geometry.js';
import { SAME, along, lineFrame, offset } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { signedArea } from './room-lines.js';
import { editRuns, prepareEnds } from './run-edits.js';
import { cornerNeighbourRuns } from './corner-neighbours.js';
import { dropPassedStations, snapStations } from './corner-stations.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The part of a room boundary a corner drag reshapes on one side of the corner: from the corner
 * through automatic stations on the same straight line to the next corner or cut, which stays
 * (today's rule; an automatic station dragged on its own reshapes only its two edges).
 */
function cornerRun(room, index, step) {
  const n = room.vertices.length;
  const at = (k) => room.vertices[(((index + k * step) % n) + n) % n];
  const corner = at(0);
  let k = 1;
  if (!corner.physicalBoundaryId || corner.editingCutId)
    while (k < n - 1 && at(k).physicalBoundaryId && !at(k).editingCutId) {
      const frame = lineFrame(corner, at(k));
      if (!frame || Math.abs(offset(frame, at(k + 1))) > SAME) break;
      if (along(frame, at(k + 1)) <= frame.length + SAME) break;
      k++;
    }
  return { ids: [...Array(k + 1).keys()].map((j) => at(j).id), fixed: at(k), corner };
}

/**
 * The plane map of a corner drag on one side: the run turns about its fixed end and stretches so
 * the corner reaches `point`; points beside the run keep their distance from it.
 */
function turnMap(fixed, corner, point) {
  const before = lineFrame(fixed, corner);
  const after = lineFrame(fixed, point);
  if (!before || !after) refuse('invalid_room_geometry', 'This corner would collapse a wall.');
  const scale = after.length / before.length;
  const place = (frame, station, distance) => ({
    x: frame.start.x + frame.tangent.x * station + frame.normal.x * distance,
    y: frame.start.y + frame.tangent.y * station + frame.normal.y * distance,
  });
  return {
    map: (p) => place(after, along(before, p) * scale, offset(before, p)),
    unmap: (p) => place(before, along(after, p) / scale, offset(after, p)),
  };
}

/** The corner moves along the run's own line: the line keeps its place, only its length changes. */
function keepsLine(fixed, corner, point) {
  const before = lineFrame(fixed, corner);
  return Math.abs(offset(before, point)) <= SAME && along(before, point) > SAME;
}

/**
 * An anchor or opening span on an edge whose ends moved: kept from the end that stayed (or in
 * proportion when both moved); a span reaching an end that moved follows that end.
 */
function respan(from, to, length, next, startFixed, endFixed, follow = false) {
  let span;
  if (startFixed) span = [from, to];
  else if (endFixed) span = [next - (length - from), next - (length - to)];
  else span = [(from * next) / length, (to * next) / length];
  if (follow && from <= SAME) span[0] = 0;
  if (follow && to >= length - SAME) span[1] = next;
  return span;
}

/**
 * `move_corner` on the derived core (decision F8): the corner moves to `point`; on each side its
 * run (through automatic stations to the next corner or cut) turns about the run's fixed end.
 * A neighbour sharing a run keeps the shared wall: its facing stretch moves to the new parallel
 * line, its corner is where its own lines meet, and where its line goes on it makes a local
 * return. No widening and no seating: contacts form only where gaps are exact.
 *
 * @returns {{result: Object, preferredRoomIds: string[]}}
 */
export function moveCorner(primary, operation, { createId, specifications }) {
  const room = primary.rooms.find((entry) => entry.id === operation.roomId);
  const index = room ? room.vertices.findIndex((v) => v.id === operation.vertexId) : -1;
  if (index < 0 || !isPoint(operation.point))
    refuse('invalid_corner', 'Choose an existing room corner and a finite position.');
  const all = primary.rooms.map((entry) => entry.id);
  const corner = room.vertices[index];
  if (gap(corner, operation.point) <= SAME) return { result: {}, preferredRoomIds: all };
  const derived = deriveBuildingPlanPieces(primary, specifications);
  const sides = [cornerRun(room, index, 1), cornerRun(room, index, -1)].map((run) => ({
    ...run,
    ...turnMap(run.fixed, corner, operation.point),
    keepsLine: keepsLine(run.fixed, corner, operation.point),
  }));

  const runs = cornerNeighbourRuns(derived, room, sides);
  prepareEnds(derived, runs);

  // The corner's own room: its runs turn; rows and openings keep their place from the end that
  // stayed. On a side whose line keeps its place, stations stay (or leave once passed).
  const lengths = new Map();
  const ends = (current) =>
    new Map(
      current.edges.map((edge) => [
        edge.id,
        [edge.startId, edge.endId].map((id) => current.vertices.find((v) => v.id === id)),
      ])
    );
  const before = ends(room);
  const outline = room.vertices;
  const moved = new Map();
  for (const side of sides)
    for (const id of side.keepsLine ? [] : side.ids.slice(1, -1))
      moved.set(id, side.map(room.vertices.find((v) => v.id === id)));
  moved.set(corner.id, operation.point);
  room.vertices = room.vertices.map((v) =>
    moved.has(v.id) ? { ...v, ...cleanPoint({ x: moved.get(v.id).x, y: moved.get(v.id).y }) } : v
  );
  for (const side of sides)
    if (side.keepsLine) dropPassedStations(primary, room, side, operation.point);
  const problem = polygonIssue(room.vertices);
  const turned = signedArea(room.vertices);
  if (problem || Math.sign(turned) !== Math.sign(signedArea(outline)))
    refuse('invalid_room_geometry', problem || 'This corner would turn the room inside out.');
  const after = ends(room);
  for (const [id, [p, q]] of before) {
    if (!after.has(id)) continue;
    const [p2, q2] = after.get(id);
    lengths.set(id, [gap(p, q), gap(p2, q2), gap(p, p2) <= 1e-12, gap(q, q2) <= 1e-12]);
  }
  respanRoom(primary, room, lengths);

  editRuns(
    primary,
    derived,
    runs.filter((run) => !run.stationary),
    { x: 0, y: 0 },
    { createId, specifications }
  );
  primary.contactWidths = [];
  snapStations(primary, room, sides, specifications);
  const edited = new Set([room.id, ...runs.map((run) => run.roomId)]);
  return { result: {}, preferredRoomIds: all.filter((id) => !edited.has(id)) };
}

/** Anchors and openings on the corner room's edges after its runs turned. */
function respanRoom(primary, room, lengths) {
  for (const anchor of primary.anchors) {
    if (anchor.roomId !== room.id || anchor.to == null) continue;
    const [length, next, startFixed, endFixed] = lengths.get(anchor.edgeId);
    [anchor.from, anchor.to] = respan(
      anchor.from,
      anchor.to,
      length,
      next,
      startFixed,
      endFixed,
      true
    );
  }
  const first = new Map();
  for (const anchor of primary.anchors)
    if (!first.has(anchor.faceId)) first.set(anchor.faceId, anchor);
  for (const subject of primary.subjects.values())
    for (const opening of subject.openings || []) {
      const anchor = first.get(opening.faceId);
      if (anchor?.roomId !== room.id) continue;
      const [length, next, startFixed, endFixed] = lengths.get(anchor.edgeId);
      const [from, to] = respan(
        opening.from,
        opening.from + opening.width,
        length,
        next,
        startFixed,
        endFixed
      );
      const start = startFixed || endFixed ? from : (from + to - opening.width) / 2;
      if (start < -SAME || start + opening.width > next + SAME)
        refuse(
          'opening_crosses_edit_boundary',
          'An opening crosses this wall edit. Move it or split a different portion.'
        );
      opening.from = start;
    }
}
