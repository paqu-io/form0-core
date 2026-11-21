import { cleanPoint, isPoint } from '../geometry.js';
import { SAME, lineFrame } from './grid.js';
import { halfWidth } from './partition-portions.js';

const refuse = (code, message, details = {}) => {
  throw Object.assign(new Error(message), { issues: [{ code, message, ...details }] });
};
const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const offset = (point, frame, distance) => ({
  x: point.x + frame.normal.x * distance,
  y: point.y + frame.normal.y * distance,
});

/** Where the lines through `p` along `u` and through `q` along `v` cross (null if parallel). */
function crossing(p, u, q, v) {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) <= 1e-12) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / det;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/**
 * `move_free_wall_point` (4a-4, 2026-11-20): a free wall's split point moves, so its two portions
 * bend there into runs at an angle, as a room wall's split point does (its corner move). `point`
 * is the new meeting point of their centrelines: each portion's centreline keeps its far end, and
 * its face (the row's side, stored) is rebuilt from it, meeting the other's where their faces
 * cross; a far end joined to another portion meets it the same way. Not where a return stands:
 * the portion goes back in line first. Derived engine only.
 * @param {object} primary
 * @param {{ roomId: string, cutId: string, point: { x: number, y: number } }} operation
 */
export function bendPartition(primary, operation, { specifications } = {}) {
  const { roomId, cutId, point } = operation;
  if (!isPoint(point)) refuse('invalid_wall_geometry', 'Choose where the wall bends.');
  const inRoom = primary.partitions.filter(
    (entry) => entry.roomId === roomId && !entry.lineage?.editingReturn
  );
  const at = (where, id) => inRoom.find((entry) => where(entry.path)?.editingCutId === id);
  const earlier = at((path) => path.at(-1), cutId);
  const later = at((path) => path[0], cutId);
  if (!earlier || !later || earlier === later) throw new Error('The split point no longer exists.');
  if (
    primary.partitions.some((entry) => entry.lineage?.editingReturn?.cutId === cutId) ||
    gap(earlier.path.at(-1), later.path[0]) > SAME
  )
    refuse(
      'free_wall_bend_return',
      'Move this portion back in line with the wall before bending it here.'
    );
  // Each portion's centreline and how far its face lies from it (the body on the face's side).
  const half = halfWidth(primary, earlier, specifications);
  const side = (entry) => (entry.sides?.[0] ?? 1) * half;
  const axis = (entry) => {
    const frame = lineFrame(entry.path[0], entry.path.at(-1));
    return frame && [entry.path[0], entry.path.at(-1)].map((p) => offset(p, frame, -side(entry)));
  };
  const [a, b] = [axis(earlier), axis(later)];
  if (!a || !b) refuse('invalid_wall_geometry', 'Keep some wall on both sides of the bend.');
  const runs = [
    { entry: earlier, frame: lineFrame(a[0], point) },
    { entry: later, frame: lineFrame(point, b[1]) },
  ];
  if (runs.some((run) => !run.frame))
    refuse('invalid_wall_geometry', 'Keep some wall on both sides of the bend.');
  const face = (run) => offset(run.frame.start, run.frame, side(run.entry));
  const joint =
    crossing(face(runs[0]), runs[0].frame.tangent, face(runs[1]), runs[1].frame.tangent) ||
    offset(point, runs[1].frame, side(later));
  // A far end joined to another portion (another split point) meets it where their faces cross.
  const farEnd = (run, end, neighbour) => {
    const own = end === 0 ? face(run) : offset(run.frame.end, run.frame, side(run.entry));
    const other = neighbour && lineFrame(neighbour.path[0], neighbour.path.at(-1));
    return (other && crossing(own, run.frame.tangent, other.start, other.tangent)) || own;
  };
  const before =
    earlier.path[0].editingCutId && at((path) => path.at(-1), earlier.path[0].editingCutId);
  const after =
    later.path.at(-1).editingCutId && at((path) => path[0], later.path.at(-1).editingCutId);
  const length = (entry) => lineFrame(entry.path[0], entry.path.at(-1))?.length ?? 0;
  const laterBefore = length(later);
  const set = (entry, index, p) => {
    const i = index < 0 ? entry.path.length + index : index;
    entry.path[i] = cleanPoint({ ...entry.path[i], x: p.x, y: p.y });
  };
  const start = farEnd(runs[0], 0, before);
  const end = farEnd(runs[1], 1, after);
  set(earlier, 0, start);
  if (before) set(before, -1, start);
  set(earlier, -1, joint);
  set(later, 0, joint);
  set(later, -1, end);
  if (after) set(after, 0, end);
  // The later portion's openings keep their distance from its far end.
  const change = length(later) - laterBefore;
  for (const opening of primary.subjects.get(later.subjectId)?.openings || [])
    if (opening.faceId === later.faceId) opening.from += change;
  return { result: {}, preferredRoomIds: primary.rooms.map((room) => room.id) };
}
