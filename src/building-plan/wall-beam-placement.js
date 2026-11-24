import { planIssue } from './model.js';
import { nameOf } from './wall-children.js';

/**
 * Where a wall beam may sit in height (wall beams 2b, 2026-11-24): not above its wall's top, not
 * below the floor (2e: a sill pushing it down), and not through an opening (their stretches along
 * the wall overlapping, their heights too; touching is allowed: a lintel resting on a window's
 * head, a sill beam under it). An opening running into a beam pushes it
 * (`derive/follow-beam-heights.js`), so what is left is a real clash: the edit is refused, naming
 * what moved first ("Window 1 would run into Beam B#2." or the other way). A clash already there
 * before the edit doesn't refuse it. Unknown heights aren't judged.
 */

const EPS = 1e-6;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function clashes(floor) {
  const found = [];
  for (const wall of floor?.walls || []) {
    const height = wall.properties?.wall_height;
    for (const beam of wall.beams || []) {
      if (!finite(beam.underside) || !finite(beam.depth)) continue;
      const top = beam.underside + beam.depth;
      if (finite(height) && top > height + EPS)
        found.push({ key: `${beam.id}|above`, beam, opening: null });
      if (beam.underside < -EPS) found.push({ key: `${beam.id}|below`, beam, opening: null });
      for (const opening of [...wall.doors, ...wall.windows]) {
        if (opening.segmentId !== beam.segmentId || !finite(opening.height)) continue;
        const along =
          Math.min(opening.offset + opening.width, beam.offset + beam.length) -
          Math.max(opening.offset, beam.offset);
        const bottom = opening.sillHeight || 0;
        const vertical = Math.min(bottom + opening.height, top) - Math.max(bottom, beam.underside);
        if (along > EPS && vertical > EPS)
          found.push({ key: `${beam.id}|${opening.id}`, beam, opening });
      }
    }
  }
  return found;
}

const placed = (element) =>
  JSON.stringify([
    element?.offset,
    element?.width,
    element?.length,
    element?.depth,
    element?.underside,
    element?.height,
    element?.sillHeight,
    element?.segmentId,
  ]);

/**
 * @param {object} floor the stored floor after the edit
 * @param {object | null} previous the same floor before it
 * @returns {Array<object>} issues
 */
export function wallBeamPlacementIssues(floor, previous) {
  const before = clashes(previous);
  const known = new Set(before.map((entry) => entry.key));
  const was = new Map(
    (previous?.walls || []).flatMap((wall) =>
      [...wall.doors, ...wall.windows, ...(wall.beams || [])].map((item) => [item.id, item])
    )
  );
  return clashes(floor)
    .filter((entry) => !known.has(entry.key))
    .map(({ key, beam, opening }) => {
      if (key.endsWith('|below'))
        return planIssue('beam_below_floor', `${nameOf(beam)} would go below the floor.`, {
          type: 'beam',
          id: beam.id,
        });
      if (!opening)
        return planIssue('beam_above_wall', `${nameOf(beam)} would stand above its wall.`, {
          type: 'beam',
          id: beam.id,
        });
      const beamMoved = placed(was.get(beam.id)) !== placed(beam);
      const [mover, other] = beamMoved ? [beam, opening] : [opening, beam];
      return planIssue('beam_opening_clash', `${nameOf(mover)} would run into ${nameOf(other)}.`, {
        type: mover.type,
        id: mover.id,
      });
    });
}
