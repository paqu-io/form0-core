import { cleanLength as clean } from '../geometry.js';

/**
 * A beam's height follows what it touches (P2, wall beams 2b, 2026-11-24). The height is stored
 * (its underside from the floor); an edit keeps a beam touching what it rested on or under:
 *
 * - a wall beam resting on an opening's head (their stretches along the wall overlapping) follows
 *   that head when the opening's height or sill changes; it comes to rest on the highest head
 *   still under it;
 * - an opening rising into a beam above it pushes the beam up (decided 2026-11-24, (a)): one edit
 *   or two give the same result; past the wall's top the edit is refused
 *   (`wall-beam-placement.js`), as is an opening moved along the wall into a beam;
 * - else a wall beam flush with its wall's top stays flush when the wall's height or the beam's
 *   depth changes (it grows downwards);
 * - a room beam whose top was at the room's structural clear height stays there.
 *
 * A beam whose underside this edit typed keeps it. Called after the write-back, with the floor
 * as it was before the edit.
 */

const EPS = 1e-6;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const near = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= EPS;
const headOf = (opening) =>
  finite(opening?.height) ? (opening.sillHeight || 0) + opening.height : null;
const alongOverlap = (opening, beam) =>
  opening.segmentId === beam.segmentId &&
  Math.min(opening.offset + opening.width, beam.offset + beam.length) -
    Math.max(opening.offset, beam.offset) >
    EPS;

/**
 * @param {object | null} previous the stored floor before the edit
 * @param {object | null} floor the stored floor after it (changed in place)
 */
export function followBeamHeights(previous, floor) {
  if (!previous || !floor) return;
  const openingsNow = new Map(
    floor.walls.flatMap((wall) => [...wall.doors, ...wall.windows].map((o) => [o.id, o]))
  );
  const wasBeam = new Map(
    previous.walls.flatMap((wall) => (wall.beams || []).map((beam) => [beam.id, { beam, wall }]))
  );
  for (const wall of floor.walls)
    for (const beam of wall.beams || []) {
      const was = wasBeam.get(beam.id);
      if (!was || !finite(was.beam.underside) || beam.underside !== was.beam.underside) continue;
      // The openings under the beam before the edit, and still under it along the wall.
      const under = [...was.wall.doors, ...was.wall.windows].filter((opening) => {
        const now = openingsNow.get(opening.id);
        return (
          now &&
          alongOverlap(opening, was.beam) &&
          alongOverlap(now, beam) &&
          finite(headOf(opening)) &&
          headOf(opening) <= was.beam.underside + EPS
        );
      });
      const headsNow = under
        .map((opening) => headOf(openingsNow.get(opening.id)))
        .filter((value) => finite(value));
      const top = headsNow.length ? Math.max(...headsNow) : null;
      const supportMoved = under.some(
        (opening) =>
          near(headOf(opening), was.beam.underside) &&
          !near(headOf(openingsNow.get(opening.id)), headOf(opening))
      );
      if (finite(top) && (supportMoved || top > beam.underside + EPS)) {
        beam.underside = clean(top);
        continue;
      }
      const height = wall.properties?.wall_height;
      if (
        near(was.beam.underside + was.beam.depth, was.wall.properties?.wall_height) &&
        finite(height) &&
        finite(beam.depth)
      )
        beam.underside = clean(height - beam.depth);
    }
  const rooms = new Map(previous.rooms.map((room) => [room.id, room]));
  for (const room of floor.rooms) {
    const old = rooms.get(room.id);
    const clear = room.properties?.room_structural_clear_height;
    for (const beam of room.beams || []) {
      const was = (old?.beams || []).find((entry) => entry.id === beam.id);
      const underside = was?.values?.beam_distance_from_floor;
      if (!finite(underside) || beam.values?.beam_distance_from_floor !== underside) continue;
      if (
        near(underside + was.height, old.properties?.room_structural_clear_height) &&
        finite(clear) &&
        finite(beam.height)
      )
        beam.values = { ...beam.values, beam_distance_from_floor: clean(clear - beam.height) };
    }
  }
}
