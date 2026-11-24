import { cleanLength as clean } from '../geometry.js';

/**
 * A beam's height moves only when something runs into it ("push, never pull", decided 2026-11-24,
 * after 2b and (a)). The height is stored (its underside from the floor); after an edit:
 *
 * - an opening whose head rises past a wall beam above it pushes the beam up (several: the
 *   highest head); past the wall's top the edit is refused (`wall-beam-placement.js`);
 * - an opening whose sill drops past a wall beam below it pushes the beam down (several: the
 *   lowest sill); below the floor the edit is refused;
 * - a wall's top coming down past a wall beam (the wall lowered, or the beam made deeper) pushes it
 *   down; a room's structural clear height does the same to a room beam;
 * - a head lowered, a sill raised, a wall or ceiling raised leave the beam where it is.
 *
 * "Under" and "above" are read before the edit, along the wall where the opening and the beam
 * overlap before and after it; an opening moved along the wall into a beam is a clash, refused. A
 * beam whose underside this edit typed keeps it. Called after the write-back, with the floor as it
 * was before the edit.
 */

const EPS = 1e-6;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const headOf = (opening) =>
  finite(opening?.height) ? (opening.sillHeight || 0) + opening.height : null;
const alongOverlap = (opening, beam) =>
  opening.segmentId === beam.segmentId &&
  Math.min(opening.offset + opening.width, beam.offset + beam.length) -
    Math.max(opening.offset, beam.offset) >
    EPS;

/** The new underside of a wall beam an opening pushed, or null. */
function pushedByOpenings(was, beam, openingsNow) {
  const rising = [];
  const dropping = [];
  const topBefore = was.beam.underside + (was.beam.depth ?? beam.depth);
  for (const opening of [...was.wall.doors, ...was.wall.windows]) {
    const now = openingsNow.get(opening.id);
    if (!now || !alongOverlap(opening, was.beam) || !alongOverlap(now, beam)) continue;
    const head = headOf(opening);
    const headNow = headOf(now);
    if (finite(head) && finite(headNow) && head <= was.beam.underside + EPS)
      if (headNow > beam.underside + EPS) rising.push(headNow);
    const sill = opening.sillHeight || 0;
    const sillNow = now.sillHeight || 0;
    if (sill >= topBefore - EPS && sillNow < beam.underside + beam.depth - EPS)
      dropping.push(sillNow);
  }
  if (rising.length) return Math.max(...rising);
  if (dropping.length) return Math.min(...dropping) - beam.depth;
  return null;
}

/** A top (a wall's, a room's clear height) come down past a beam that stood under it. */
function pushedByTop(underside, depth, top, before) {
  const { underside: oldUnderside, depth: oldDepth, top: oldTop } = before;
  if (!finite(top) || !finite(depth) || underside + depth <= top + EPS) return null;
  if (finite(oldTop) && finite(oldDepth) && oldUnderside + oldDepth > oldTop + EPS) return null;
  return top - depth;
}

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
      if (!finite(beam.depth)) continue;
      const pushed =
        pushedByOpenings(was, beam, openingsNow) ??
        pushedByTop(beam.underside, beam.depth, wall.properties?.wall_height, {
          underside: was.beam.underside,
          depth: was.beam.depth,
          top: was.wall.properties?.wall_height,
        });
      if (finite(pushed)) beam.underside = clean(pushed);
    }
  const rooms = new Map(previous.rooms.map((room) => [room.id, room]));
  for (const room of floor.rooms) {
    const old = rooms.get(room.id);
    for (const beam of room.beams || []) {
      const was = (old?.beams || []).find((entry) => entry.id === beam.id);
      const underside = was?.values?.beam_distance_from_floor;
      if (!finite(underside) || beam.values?.beam_distance_from_floor !== underside) continue;
      const pushed = pushedByTop(
        underside,
        beam.height,
        room.properties?.room_structural_clear_height,
        {
          underside,
          depth: was.height,
          top: old.properties?.room_structural_clear_height,
        }
      );
      if (finite(pushed)) beam.values = { ...beam.values, beam_distance_from_floor: clean(pushed) };
    }
  }
}
