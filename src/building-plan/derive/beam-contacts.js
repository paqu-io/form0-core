import { SAME, along, lineFrame, offset, pointAt } from './grid.js';
import { ATTACH_M, contactOn, freeWallAnchors, roomFaces } from './attached-contacts.js';

/**
 * What a room beam touches (3a-4, 2026-11-23; B3 of the beams round, option b; rule 2, nothing
 * stored, read from the floor before an edit): an end on a room face, on a free wall's side or
 * centreline, or on another beam's side or centreline; a beam lying along a face, a free wall's
 * side or another beam's side (a side on it: both ends hold to it). A beam resting on a column
 * doesn't follow it (a point, B3). `follow-beams.js` moves the beam with what it touches. Metres.
 */

const cross = (u, v) => u.x * v.y - u.y * v.x;
const parallel = (a, b) => Math.abs(cross(a.tangent, b.tangent)) <= 1e-6;
const key = (anchor) => JSON.stringify(anchor);

/** A beam's lines: its centreline (`mid`) and its sides, `half` to its left and right. */
export function beamLines(beam, half) {
  if (!beam?.start || !beam?.end) return null;
  const frame = lineFrame(beam.start, beam.end);
  if (!frame) return null;
  const at = (distance) =>
    lineFrame(pointAt(frame, 0, distance), pointAt(frame, frame.length, distance)) || frame;
  return { mid: frame, left: at(half), right: at(-half) };
}

const halfOfBeam = (beam) => (beam.width > 0 ? beam.width / 2 : 0);

/**
 * A beam's contacts, per end (`along`: a side lying on that line), or null when it touches
 * nothing. `halfOf(partition)`: a free wall row's half width.
 */
export function beamContacts(primary, room, beam, halfOf) {
  const half = halfOfBeam(beam);
  const own = beamLines(beam, half);
  if (!own) return null;
  const ends = [beam.start, beam.end];
  const contacts = [[], []];
  const lines = [
    ...roomFaces(room).map(({ startId, endId, frame }) => ({
      anchor: { type: 'face', roomId: room.id, startId, endId },
      frame,
    })),
    ...freeWallAnchors(primary, room.id, null, halfOf).flatMap(({ faceId, lines: theirs }) =>
      ['row', 'mid', 'other'].map((line) => ({
        anchor: { type: 'wall', faceId, line },
        frame: theirs[line],
      }))
    ),
    ...(room.beams || [])
      .filter((other) => other.id !== beam.id)
      .flatMap((other) => {
        const theirs = beamLines(other, halfOfBeam(other));
        return theirs
          ? ['mid', 'left', 'right'].map((line) => ({
              anchor: { type: 'beam', roomId: room.id, beamId: other.id, line },
              frame: theirs[line],
            }))
          : [];
      }),
  ];
  for (const { anchor, frame } of lines) {
    ends.forEach((end, index) => {
      const station = along(frame, end);
      if (Math.abs(offset(frame, end)) > ATTACH_M) return;
      if (station < -ATTACH_M || station > frame.length + ATTACH_M) return;
      contacts[index].push(contactOn(anchor, frame, end));
    });
    // Lying along it, a side on it (as a free wall, 4b D2b): the whole beam moves with it.
    if (anchor.line === 'mid' || !(half > 0) || !parallel(frame, own.mid)) continue;
    const offsets = ends.map((end) => offset(frame, end));
    if (offsets.some((d) => Math.abs(Math.abs(d) - half) > ATTACH_M)) continue;
    if (Math.sign(offsets[0]) !== Math.sign(offsets[1])) continue;
    const stations = ends.map((end) => along(frame, end));
    const overlap =
      Math.min(frame.length, Math.max(...stations)) - Math.max(0, Math.min(...stations));
    if (overlap <= SAME) continue;
    ends.forEach((end, index) => {
      if (contacts[index].some((entry) => key(entry.anchor) === key(anchor))) return;
      contacts[index].push(contactOn(anchor, frame, end, { along: true }));
    });
  }
  return contacts.some((list) => list.length) ? { ends: contacts } : null;
}
