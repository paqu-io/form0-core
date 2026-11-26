import {
  GEOMETRY_EPSILON,
  add,
  at,
  distance,
  dot,
  multiply,
  polygonArea,
  polygonEdges,
  segmentFrame,
  subtract,
} from './geometry.js';

/**
 * A room's sides for its lengths (step 2, 2c; decision A, 2026-11-23): display only, nothing is
 * stored. Each side runs corner to corner along the room's inside face (the bare wall face):
 * edges in line are one side, since a vertex where another room's wall meets it is no corner
 * (3-L2). A side lists what covers it end to end, the pieces, and the openings on it:
 *
 * - a piece is a row's stretch (its face bound to the room's edges), or a cap (an edge with no
 *   row) given to the row it continues: one of the same wall next to it in line first, then any
 *   row next to it in line; a side of caps alone goes to a row of the cap's wall, else none;
 * - an opening is a door or window standing in one of the side's rows, by its ends along the side;
 * - a beam is a wall beam or band of one of the side's rows (D1c, 2026-11-25), by the ends of the
 *   stretch the side's rows cover, for an open beam entry's lengths.
 *
 * Canvas units throughout (`gridSize` per metre).
 */

/** @typedef {{ x: number, y: number }} Point */
/**
 * @typedef {{
 *   start: Point, end: Point, normal: Point, edgeIds: string[],
 *   pieces: Array<{ from: Point, to: Point, faceId: string | null, cap: boolean }>,
 *   openings: Array<{ subjectId: string, kind: 'door' | 'window', from: Point, to: Point }>,
 *   beams: Array<{ subjectId: string, from: Point, to: Point }>,
 * }} RoomSide `normal`: into the room; `edgeIds`: the room's edges along it (a row's bindings
 *   name theirs), for the front view (A1)
 */

// Edges whose directions differ by less than this are in line (as the snapshot's corners).
const IN_LINE = 1 - 1e-6;

/**
 * @param {object} floor the plan's floor
 * @param {object} room one of its rooms
 * @param {number} gridSize canvas units per metre
 * @returns {RoomSide[]}
 */
export function buildingPlanRoomSides(floor, room, gridSize) {
  const edges = polygonEdges(room).filter((edge) => edge.length > GEOMETRY_EPSILON);
  if (edges.length < 3) return [];
  const inLine = (a, b) => dot(a.tangent, b.tangent) > IN_LINE;
  // Start where the outline turns, so no side is cut at the first edge.
  const first = edges.findIndex((edge, index) => !inLine(edges.at(index - 1), edge));
  if (first < 0) return [];
  const runs = [];
  for (let step = 0; step < edges.length; step += 1) {
    const edge = edges[(first + step) % edges.length];
    const last = runs.at(-1);
    if (last && inLine(last.at(-1), edge)) last.push(edge);
    else runs.push([edge]);
  }

  const rows = new Map();
  for (const face of room.faces || []) {
    if (face.freePath) continue;
    for (const binding of face.bindings || []) rows.set(binding.edgeId, { face, binding });
  }
  const wallOf = (faceId) =>
    (room.faces || []).find((face) => face.id === faceId && !face.freePath)?.wallId;
  const sign = polygonArea(room.vertices) >= 0 ? 1 : -1;
  const pixels = (point) => ({ x: point.x * gridSize, y: point.y * gridSize });

  return runs.map((run) => {
    const start = run[0].start;
    const end = run.at(-1).end;
    const frame = segmentFrame(start, end);
    const owners = run.map((edge) => {
      const row = rows.get(edge.id);
      return {
        faceId: row?.face.id ?? null,
        cap: !row,
        capWall: row ? null : edge.profile?.wallId,
      };
    });
    capOwners(owners, wallOf, room);
    const pieces = [];
    run.forEach((edge, index) => {
      const owner = owners[index];
      const last = pieces.at(-1);
      if (last && last.faceId === owner.faceId && owner.faceId !== null) {
        last.to = edge.end;
        last.cap = last.cap && owner.cap;
      } else pieces.push({ from: edge.start, to: edge.end, faceId: owner.faceId, cap: owner.cap });
    });
    return {
      start: pixels(start),
      end: pixels(end),
      normal: { x: frame.normal.x * sign + 0, y: frame.normal.y * sign + 0 },
      edgeIds: run.map((edge) => edge.id),
      pieces: pieces.map((piece) => ({ ...piece, from: pixels(piece.from), to: pixels(piece.to) })),
      openings: sideOpenings(floor, run, rows, frame).map((opening) => ({
        ...opening,
        from: pixels(opening.from),
        to: pixels(opening.to),
      })),
      beams: sideBeams(floor, run, rows, frame).map((beam) => ({
        ...beam,
        from: pixels(beam.from),
        to: pixels(beam.to),
      })),
    };
  });
}

// A cap takes the owner of the stretch it continues in line (the side's next edges): one of its
// own wall first, then any; repeated so a run of caps passes the owner along.
function capOwners(owners, wallOf, room) {
  for (const sameWall of [true, false])
    for (let pass = 0; pass < owners.length; pass += 1) {
      let changed = false;
      owners.forEach((owner, index) => {
        if (owner.faceId !== null) return;
        const next = [owners[index - 1], owners[index + 1]].find(
          (other) => other?.faceId != null && (!sameWall || wallOf(other.faceId) === owner.capWall)
        );
        if (!next) return;
        owner.faceId = next.faceId;
        changed = true;
      });
      if (!changed) break;
    }
  // A side of caps alone: a row of the cap's wall, else none.
  for (const owner of owners)
    if (owner.faceId === null && owner.capWall)
      owner.faceId =
        (room.faces || []).find((face) => !face.freePath && face.wallId === owner.capWall)?.id ??
        null;
}

// The doors and windows standing in the side's rows, by their ends along the side.
function sideOpenings(floor, run, rows, frame) {
  const result = [];
  const seen = new Set();
  for (const edge of run) {
    const row = rows.get(edge.id);
    if (!row) continue;
    const { face, binding } = row;
    const wall = (floor.walls || []).find((entry) => entry.id === face.wallId);
    const segment = wall?.segments.find((entry) => entry.id === binding.segmentId);
    if (!segment) continue;
    const along = segmentFrame(segment.start, segment.end);
    for (const kind of ['doors', 'windows'])
      for (const opening of wall[kind] || []) {
        if (seen.has(opening.id) || opening.segmentId !== segment.id) continue;
        const [low, high] = binding.interval;
        if (opening.offset < low - 1e-6 || opening.offset + opening.width > high + 1e-6) continue;
        seen.add(opening.id);
        const ends = [at(along, opening.offset), at(along, opening.offset + opening.width)]
          .map((point) => dot(subtract(point, frame.start), frame.tangent))
          .sort((a, b) => a - b);
        result.push({
          subjectId: opening.id,
          kind: kind === 'doors' ? 'door' : 'window',
          from: add(frame.start, multiply(frame.tangent, ends[0])),
          to: add(frame.start, multiply(frame.tangent, ends[1])),
        });
      }
  }
  return result.sort((a, b) => distance(frame.start, a.from) - distance(frame.start, b.from));
}

// The wall beams and bands of the side's rows, by the ends along the side of what those rows
// cover of them; a beam over two of the side's rows is one stretch.
function sideBeams(floor, run, rows, frame) {
  const stretches = new Map();
  for (const edge of run) {
    const row = rows.get(edge.id);
    if (!row) continue;
    const { face, binding } = row;
    const wall = (floor.walls || []).find((entry) => entry.id === face.wallId);
    const segment = wall?.segments.find((entry) => entry.id === binding.segmentId);
    if (!segment) continue;
    const along = segmentFrame(segment.start, segment.end);
    const [low, high] = binding.interval;
    for (const beam of wall.beams || []) {
      if (beam.segmentId !== segment.id) continue;
      const from = Math.max(beam.offset, low);
      const to = Math.min(beam.offset + beam.length, high);
      if (!(to - from > 1e-6)) continue;
      const ends = [at(along, from), at(along, to)].map((point) =>
        dot(subtract(point, frame.start), frame.tangent)
      );
      const known = stretches.get(beam.id);
      stretches.set(beam.id, [
        Math.min(...ends, ...(known || [])),
        Math.max(...ends, ...(known || [])),
      ]);
    }
  }
  return [...stretches.entries()]
    .map(([subjectId, [low, high]]) => ({
      subjectId,
      from: add(frame.start, multiply(frame.tangent, low)),
      to: add(frame.start, multiply(frame.tangent, high)),
    }))
    .sort((a, b) => distance(frame.start, a.from) - distance(frame.start, b.from));
}
