import { SAME, along, lineFrame, offset, pointAt } from './grid.js';
import { outwardSign } from './frames.js';
import { CUT_REACH, TOUCH_M } from '../free-wall-body.js';

/**
 * What touches what in a room (4b, 2026-11-21; rule 2, attachment from contact: nothing is
 * stored, the contacts are read from the floor as it was before an edit). A free wall's end on a
 * room face or on another free wall, a free wall lying along a face or another free wall's side.
 * `follow-attached.js` moves whatever touches a line the edit moved. Metres.
 */

/** Closer than this, an end or a side touches a line: 1 mm, the reach a cut has (4a-3b). */
export const ATTACH_M = TOUCH_M * CUT_REACH;

const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const cross = (u, v) => u.x * v.y - u.y * v.x;
const parallel = (a, b) => Math.abs(cross(a.tangent, b.tangent)) <= 1e-6;

/** The room's faces, each by the vertices it runs between, with the side outside the room. */
export function roomFaces(room) {
  const count = room?.vertices?.length || 0;
  if (count < 3) return [];
  const outward = outwardSign(room);
  return room.vertices.flatMap((a, index) => {
    const b = room.vertices[(index + 1) % count];
    const frame = lineFrame(a, b);
    return frame ? [{ roomId: room.id, startId: a.id, endId: b.id, frame, outward }] : [];
  });
}

/**
 * A free wall row's lines: the row's side (its stored face, `row`), its centreline (`mid`) and its
 * other side (`other`), its body lying on side -`sign` of the row (`half`: half its width).
 */
export function freeWallLines(partition, half) {
  if (partition.path?.length !== 2) return null;
  const frame = lineFrame(partition.path[0], partition.path[1]);
  if (!frame) return null;
  const sign = partition.sides?.[0] ?? 1;
  const at = (distance) =>
    lineFrame(pointAt(frame, 0, distance), pointAt(frame, frame.length, distance)) || frame;
  return { sign, half, row: frame, mid: at(-sign * half), other: at(-2 * sign * half) };
}

/**
 * Each end of a free wall row joined to another row's end (a turn, a split point, a return at
 * it), else null.
 */
export function jointEnds(primary, partition) {
  return [partition.path[0], partition.path.at(-1)].map((end) => {
    for (const other of primary.partitions) {
      if (other === partition || other.roomId !== partition.roomId) continue;
      if (gap(other.path[0], end) <= SAME) return { faceId: other.faceId, end: 0 };
      if (gap(other.path.at(-1), end) <= SAME) return { faceId: other.faceId, end: -1 };
    }
    return null;
  });
}

const contactOn = (anchor, frame, point, extra = {}) => {
  const station = along(frame, point);
  return {
    anchor,
    frame,
    foot: pointAt(frame, station),
    station,
    d: offset(frame, point),
    ...extra,
  };
};

/** Whether two free wall rows belong together: one wall, a return at a split point of it. */
export function related(a, b) {
  if (a.subjectId === b.subjectId) return true;
  const cuts = (entry) => entry.path.map((point) => point.editingCutId).filter(Boolean);
  const returnOf = (entry) => entry.lineage?.editingReturn?.cutId;
  return (
    cuts(a).includes(returnOf(b)) ||
    cuts(b).includes(returnOf(a)) ||
    cuts(a).some((id) => cuts(b).includes(id))
  );
}

/** The free walls of the room not related to `partition` (if any), with their lines, as anchors. */
function freeWallAnchors(primary, roomId, partition, halfOf) {
  return primary.partitions.flatMap((other) => {
    if (
      other.roomId !== roomId ||
      (partition && (other === partition || related(other, partition)))
    )
      return [];
    const lines = freeWallLines(other, halfOf(other));
    return lines ? [{ faceId: other.faceId, lines }] : [];
  });
}

/**
 * A free wall row's contacts, per end (none at an end joined to another row's end): an end on a
 * room face or on another free wall's side or centreline, and a row lying along a face or another
 * free wall's side (both ends then hold to it). Rows of its own wall, and returns at its split
 * points, are not anchors. A return's row, or a row of more than one edge, gives null: a return
 * moves with its wall's portions.
 */
export function freeWallContacts(primary, partition, halfOf) {
  if (partition.lineage?.editingReturn) return null;
  const own = freeWallLines(partition, halfOf(partition));
  if (!own) return null;
  const joints = jointEnds(primary, partition);
  const ends = [own.mid.start, own.mid.end];
  const contacts = [[], []];
  const room = primary.rooms.find((entry) => entry.id === partition.roomId);
  const lines = [
    ...roomFaces(room).map(({ startId, endId, frame }) => ({
      anchor: { type: 'face', roomId: partition.roomId, startId, endId },
      frame,
    })),
    ...freeWallAnchors(primary, partition.roomId, partition, halfOf).flatMap(
      ({ faceId, lines: theirs }) =>
        ['row', 'mid', 'other'].map((line) => ({
          anchor: { type: 'wall', faceId, line },
          frame: theirs[line],
        }))
    ),
  ];
  for (const { anchor, frame } of lines) {
    ends.forEach((end, index) => {
      if (joints[index]) return;
      const station = along(frame, end);
      if (Math.abs(offset(frame, end)) > ATTACH_M) return;
      if (station < -ATTACH_M || station > frame.length + ATTACH_M) return;
      contacts[index].push(contactOn(anchor, frame, end));
    });
    // Lying along it, a side on it (D2b): the whole row moves with it.
    if (anchor.line === 'mid' || !(own.half > 0) || !parallel(frame, own.mid)) continue;
    const offsets = ends.map((end) => offset(frame, end));
    if (offsets.some((d) => Math.abs(Math.abs(d) - own.half) > ATTACH_M)) continue;
    if (Math.sign(offsets[0]) !== Math.sign(offsets[1])) continue;
    const stations = ends.map((end) => along(frame, end));
    const from = Math.min(...stations);
    const to = Math.max(...stations);
    if (Math.min(frame.length, to) - Math.max(0, from) <= SAME) continue;
    ends.forEach((end, index) => {
      const held = contacts[index].some((entry) => sameAnchor(entry.anchor, anchor));
      if (!held) contacts[index].push(contactOn(anchor, frame, end));
    });
  }
  return { partition, sign: own.sign, mid: own.mid, ends: contacts, joints };
}

export const sameAnchor = (a, b) =>
  a.type === b.type &&
  (a.type === 'face'
    ? a.roomId === b.roomId && a.startId === b.startId && a.endId === b.endId
    : a.faceId === b.faceId && a.line === b.line);
