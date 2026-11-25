import { buildingPlanProblems } from './plan-problems.js';
import { bandOf } from './band-rows.js';
import { nameOf } from './wall-children.js';
import { cleanLength as clean } from './geometry.js';

/**
 * The question a band edit asks when it runs bands into openings (bands unit 4b, decided
 * 2026-11-25): the floor's band answers and values, a wall's band answer, a band row's underside
 * or depth, a wall's height or the ring beam's depth. Only clashes the edit makes ask, and only
 * where the band moved: an opening the edit placed or moved itself never asks (raised into a
 * lintel or sill band it pushes the band; into the ring beam it is a problem to fix, 4a). Other
 * problems (bands overlapping, a band beyond its wall) don't ask. "Fit the openings" shrinks
 * them, their other edge staying: a head down to the underside of the lowest band above it, a
 * window's sill up to the sill band's top; one that would keep no height is left as it is.
 */

const EPS = 1e-6;
const placement = (opening) =>
  JSON.stringify([
    opening?.segmentId,
    opening?.offset,
    opening?.width,
    opening?.height,
    opening?.sillHeight,
  ]);
const openingsOf = (wall) => [...(wall?.doors || []), ...(wall?.windows || [])];

/**
 * The clashes between openings and bands the edit made by moving or adding bands.
 * @param {object} before the plan before the edit
 * @param {object} after the edit's candidate plan
 * @returns {Array<{ floorId: string, wall: object, opening: object, band: object }>}
 */
export function newBandClashes(before, after) {
  const clashes = [];
  for (const floor of after?.floors || []) {
    const previous = before?.floors?.find((entry) => entry.id === floor.id);
    const walls = new Map((previous?.walls || []).map((wall) => [wall.id, wall]));
    const known = new Set();
    for (const problem of buildingPlanProblems(previous))
      if (problem.code === 'opening_into_band') {
        const wall = walls.get(problem.wallId);
        const band = wall?.beams?.find((beam) => beam.id === problem.elements[1].id);
        known.add(`${problem.elements[0].id}|${bandOf(band)}`);
      }
    for (const problem of buildingPlanProblems(floor)) {
      if (problem.code !== 'opening_into_band') continue;
      const wall = floor.walls.find((entry) => entry.id === problem.wallId);
      const opening = openingsOf(wall).find((entry) => entry.id === problem.elements[0].id);
      const band = wall.beams.find((beam) => beam.id === problem.elements[1].id);
      if (known.has(`${opening.id}|${bandOf(band)}`)) continue;
      // Placed or moved by the edit itself: the opening ran into the band, not the other way.
      const was = [...walls.values()].flatMap(openingsOf).find((entry) => entry.id === opening.id);
      if (!was || placement(was) !== placement(opening)) continue;
      clashes.push({ floorId: floor.id, wall, opening, band });
    }
  }
  return clashes;
}

/**
 * An opening's sill and head once fitted to the bands it clashes with, or null if no height is left.
 * New openings take the same rule (unit 5, `opening-heights.js`).
 */
export function fitToBands(opening, bands) {
  let sill = opening.sillHeight || 0;
  let head = sill + opening.height;
  for (const band of bands) {
    if (bandOf(band) === 'sill') sill = Math.max(sill, band.underside + band.depth);
    else head = Math.min(head, band.underside);
  }
  return head - sill > EPS ? { sill, head } : null;
}

/** Clashes grouped by opening: the opening, its wall and the bands it runs into. */
function byOpening(clashes) {
  const groups = new Map();
  for (const clash of clashes) {
    const group = groups.get(clash.opening.id) || { ...clash, bands: [] };
    group.bands.push(clash.band);
    groups.set(clash.opening.id, group);
  }
  return [...groups.values()];
}

const listed = (names) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
const SHOWN = 4;

/**
 * The question's title, message and buttons.
 * @param {ReturnType<typeof newBandClashes>} clashes
 */
export function bandClashQuestion(clashes) {
  const groups = byOpening(clashes);
  const bands = [...new Set(clashes.map(({ band }) => nameOf(band)))];
  const named = (group) =>
    `${nameOf(group.opening)} (${group.wall.values?.wall_label || group.wall.autoLabel})`;
  const shown = groups.slice(0, SHOWN).map(named);
  const more = groups.length - shown.length;
  const openings = more ? [...shown, `${more} more`] : shown;
  const stuck = groups.filter((group) => !fitToBands(group.opening, group.bands)).map(named);
  const count = groups.length === 1 ? '1 opening' : `${groups.length} openings`;
  return {
    title: 'Openings in the way',
    message: [
      `This edit runs ${listed(bands)} into ${count}: ${listed(openings)}.`,
      stuck.length
        ? `${listed(stuck)} would keep no height: fitting leaves ${stuck.length === 1 ? 'it' : 'them'} as ${stuck.length === 1 ? 'it is' : 'they are'}.`
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    buttons: [
      { id: 'fit', label: 'Fit the openings' },
      { id: 'keep', label: "Keep them, I'll fix them" },
      { id: 'cancel', label: 'Cancel' },
    ],
  };
}

/**
 * "Fit the openings": each opening shrinks to clear the bands it runs into (changed in place).
 * @param {ReturnType<typeof newBandClashes>} clashes
 */
export function fitOpenings(clashes) {
  for (const group of byOpening(clashes)) {
    const fit = fitToBands(group.opening, group.bands);
    if (!fit) continue;
    if (group.opening.type === 'window') group.opening.sillHeight = clean(fit.sill);
    group.opening.height = clean(fit.head - fit.sill);
  }
}
