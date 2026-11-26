import { buildingPlanProblems } from './plan-problems.js';
import { cleanLength as clean } from './geometry.js';

/**
 * A front view's problems (A1, decided 2026-11-25): each of the floor's problems (bands unit 4a)
 * whose elements the view shows, as the area where they clash, in the view's metres: an opening
 * and a band, or two bands, where they overlap; a band above its wall from the wall's top to the
 * band's; a band below the floor from its underside to the floor. Display only.
 */

const EPS = 1e-6;

/**
 * @param {object} floor the stored floor
 * @param {{ openings: object[], beams: object[] }} view the view's elements, by `subjectId`
 * @param {Map<string, object>} walls the floor's walls by id
 * @returns {Array<{ id: string, code: string, elementIds: string[], from: number, to: number,
 *   bottom: number, top: number }>}
 */
export function frontViewProblems(floor, { openings, beams }, walls) {
  const shown = new Map();
  for (const element of [...openings, ...beams])
    shown.set(element.subjectId, [...(shown.get(element.subjectId) || []), element]);
  const result = [];
  for (const problem of buildingPlanProblems(floor)) {
    const lists = problem.elements.map((element) => shown.get(element.id) || []);
    if (lists.some((list) => !list.length)) continue;
    const add = (from, to, bottom, top) => {
      if (to - from > EPS && top - bottom > EPS)
        result.push({
          id: problem.id,
          code: problem.code,
          elementIds: problem.elements.map((element) => element.id),
          from: clean(from),
          to: clean(to),
          bottom: clean(bottom),
          top: clean(top),
        });
    };
    if (lists.length === 1) {
      const height = walls.get(problem.wallId)?.properties?.wall_height;
      for (const band of lists[0])
        if (problem.code === 'band_above_wall') add(band.from, band.to, height, band.top);
        else if (problem.code === 'band_below_floor') add(band.from, band.to, band.bottom, 0);
      continue;
    }
    for (const a of lists[0])
      for (const b of lists[1])
        add(
          Math.max(a.from, b.from),
          Math.min(a.to, b.to),
          Math.max(a.bottom, b.bottom),
          Math.min(a.top, b.top)
        );
  }
  return result;
}
