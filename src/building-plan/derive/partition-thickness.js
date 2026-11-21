import { cleanPoint } from '../geometry.js';
import { SAME, lineFrame } from './grid.js';
import { resolutionFloor, resolveWallThickness } from './thickness.js';
import { derivePartitionPieces } from './partitions.js';
import { ATTACH_M, roomFaces } from './attached-contacts.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};
const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

/** Where two lines (point and direction) cross, or null when they are parallel. */
function crossing(p, u, q, v) {
  const det = u.x * v.y - u.y * v.x;
  if (Math.abs(det) <= 1e-12) return null;
  const t = ((q.x - p.x) * v.y - (q.y - p.y) * v.x) / det;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/**
 * Which side of a free wall row lies along one of its room's faces (4b, D5): its row's side
 * (`row`, its stored face), its other side (`other`, `width` away), or neither (null).
 */
function flushSide(primary, partition, width) {
  const frame = lineFrame(partition.path[0], partition.path.at(-1));
  if (!frame) return null;
  const room = primary.rooms.find((entry) => entry.id === partition.roomId);
  const shift = -(partition.sides[0] ?? 1) * width;
  const sides = {
    row: [frame.start, frame.end],
    other: [frame.start, frame.end].map((p) => ({
      x: p.x + frame.normal.x * shift,
      y: p.y + frame.normal.y * shift,
    })),
  };
  const along = (face, p) =>
    (p.x - face.start.x) * face.tangent.x + (p.y - face.start.y) * face.tangent.y;
  const away = (face, p) =>
    (p.x - face.start.x) * face.normal.x + (p.y - face.start.y) * face.normal.y;
  for (const [name, ends] of Object.entries(sides))
    for (const { frame: face } of roomFaces(room)) {
      if (ends.some((p) => Math.abs(away(face, p)) > ATTACH_M)) continue;
      const stations = ends.map((p) => along(face, p));
      const covered =
        Math.min(face.length, Math.max(...stations)) - Math.max(0, Math.min(...stations));
      if (covered > SAME) return name;
    }
  return null;
}

/**
 * J5: a partition whose thickness changes keeps its axis (whatever the anchor since 4a-3: free
 * walls are drawn by their centreline), so its path (the face) moves by half the change away from
 * its body; one with a side flush against a face of its room keeps that side (4b, D5). Runs meeting at a point (the runs of a drawn
 * polyline, a Split portion and its return) stay joined: the point goes to where their lines,
 * moved or not, now cross; parallel runs moved alike stay joined by moving alike.
 */
export function shiftPartitions(primary, before, specifications) {
  const floor = resolutionFloor(primary);
  const lines = new Map();
  for (const partition of primary.partitions) {
    const frame = lineFrame(partition.path[0], partition.path.at(-1));
    if (frame) lines.set(partition, { frame, shift: 0 });
  }
  for (const piece of derivePartitionPieces(before, specifications).pieces) {
    const partition = primary.partitions.find((entry) => entry.faceId === piece.faceIds[0]);
    const line = partition && lines.get(partition);
    if (!line) continue;
    const subject = primary.subjects.get(piece.subjectId) || null;
    const resolved = resolveWallThickness(floor, specifications, subject, piece.roomIds);
    if (resolved.conflict || resolved.value == null) continue;
    if (!(resolved.value > 0))
      refuse('invalid_dimension', 'Wall thickness must be positive or explicitly unknown.');
    const change = resolved.value - piece.width;
    if (Math.abs(change) <= SAME) continue;
    const kept = flushSide(primary, partition, piece.width);
    line.shift =
      (partition.sides[0] ?? 1) * (kept === 'row' ? 0 : kept === 'other' ? change : change / 2);
  }
  const movedLine = ({ frame, shift }) => ({
    point: {
      x: frame.start.x + frame.normal.x * shift,
      y: frame.start.y + frame.normal.y * shift,
    },
    direction: frame.tangent,
  });
  const next = new Map();
  for (const [partition, line] of lines) {
    if (Math.abs(line.shift) <= SAME) continue;
    const own = movedLine(line);
    next.set(
      partition,
      partition.path.map((point) => {
        const joined = [...lines].find(
          ([other]) =>
            other !== partition &&
            other.roomId === partition.roomId &&
            [other.path[0], other.path.at(-1)].some((end) => gap(end, point) <= SAME)
        );
        const shifted = {
          x: point.x + line.frame.normal.x * line.shift,
          y: point.y + line.frame.normal.y * line.shift,
        };
        if (!joined) return shifted;
        const theirs = movedLine(joined[1]);
        return crossing(own.point, own.direction, theirs.point, theirs.direction) || shifted;
      })
    );
  }
  // A joined end of a run that did not move follows the moved run's crossing too.
  for (const [partition, line] of lines) {
    if (Math.abs(line.shift) > SAME) continue;
    const own = movedLine(line);
    partition.path = partition.path.map((point) => {
      const joined = [...lines].find(
        ([other, theirs]) =>
          other !== partition &&
          Math.abs(theirs.shift) > SAME &&
          other.roomId === partition.roomId &&
          [other.path[0], other.path.at(-1)].some((end) => gap(end, point) <= SAME)
      );
      if (!joined) return point;
      const theirs = movedLine(joined[1]);
      const at = crossing(own.point, own.direction, theirs.point, theirs.direction);
      return at ? cleanPoint({ ...point, ...at }) : point;
    });
  }
  for (const [partition, points] of next)
    partition.path = partition.path.map((point, index) =>
      cleanPoint({ ...point, ...points[index] })
    );
  return [...next.keys()].map((partition) => partition.roomId);
}
