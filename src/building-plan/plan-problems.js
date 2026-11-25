import { nameOf } from './wall-children.js';
import { bandOf } from './band-rows.js';

/**
 * Problems to fix before saving (bands unit 4a, decided 2026-11-25): what a floor holds that
 * doesn't make sense, though no edit was refused for it, so the person can fix it in any order
 * before the floor is saved. Listed per wall:
 *
 * - `opening_into_band`: a door or window and a band (ring beam, lintel or sill band) on its
 *   segment overlapping in height; touching is allowed, and doors pass through sill bands. A
 *   window wholly above a lintel band, or a vent wholly under a sill band, is fine.
 * - `bands_overlap`: two bands of one segment overlapping in height (the lower named first).
 * - `band_above_wall`, `band_below_floor`: a band beyond its wall, from the floor's values or an
 *   opening pushing it (typed on the band row itself, it is refused: `opening-operations.js`).
 *
 * Unknown heights aren't judged. Messages read as the refusals do (English sentences, the
 * elements' names as `nameOf` gives them). Beams added by hand are checked when they are placed
 * (`wall-beam-placement.js`); bands against them aren't checked yet.
 */

const EPS = 1e-6;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const overlap = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0) > EPS;

/** A band's place in height, or null while unknown. */
function bandSpan(beam) {
  if (!bandOf(beam) || !finite(beam.underside) || !finite(beam.depth)) return null;
  return { beam, bottom: beam.underside, top: beam.underside + beam.depth };
}

/** Whether two wall children on one segment overlap along it. */
function alongWall(a, aLength, b, bLength) {
  return (
    a.segmentId === b.segmentId &&
    overlap(a.offset, a.offset + aLength, b.offset, b.offset + bLength)
  );
}

/**
 * @param {object} floor a stored floor
 * @returns {Array<{
 *   id: string,
 *   code: string,
 *   message: string,
 *   wallId: string,
 *   wallName: string,
 *   segmentId: string,
 *   elements: Array<{ type: string, id: string, name: string }>,
 * }>}
 */
export function buildingPlanProblems(floor) {
  const problems = [];
  const add = (code, wall, elements, message) =>
    problems.push({
      id: [code, ...elements.map((element) => element.id)].join('|'),
      code,
      message,
      wallId: wall.id,
      wallName: wall.values?.wall_label || wall.autoLabel || '',
      segmentId: elements.at(-1).segmentId,
      elements: elements.map((element) => ({
        type: element.type,
        id: element.id,
        name: nameOf(element),
      })),
    });
  for (const wall of floor?.walls || []) {
    const height = wall.properties?.wall_height;
    const bands = (wall.beams || []).map(bandSpan).filter(Boolean);
    for (const { beam, bottom, top } of bands) {
      if (finite(height) && top > height + EPS)
        add('band_above_wall', wall, [beam], `${nameOf(beam)} stands above its wall.`);
      if (bottom < -EPS)
        add('band_below_floor', wall, [beam], `${nameOf(beam)} goes below the floor.`);
    }
    for (const opening of [...(wall.doors || []), ...(wall.windows || [])]) {
      if (!finite(opening.height)) continue;
      const sill = opening.sillHeight || 0;
      for (const { beam, bottom, top } of bands) {
        if (opening.type === 'door' && bandOf(beam) === 'sill') continue;
        if (!alongWall(opening, opening.width, beam, beam.length)) continue;
        if (overlap(sill, sill + opening.height, bottom, top))
          add(
            'opening_into_band',
            wall,
            [opening, beam],
            `${nameOf(opening)} runs into ${nameOf(beam)}.`
          );
      }
    }
    const rising = [...bands].sort((a, b) => a.bottom - b.bottom);
    for (const [index, lower] of rising.entries())
      for (const upper of rising.slice(index + 1))
        if (
          alongWall(lower.beam, lower.beam.length, upper.beam, upper.beam.length) &&
          overlap(lower.bottom, lower.top, upper.bottom, upper.top)
        )
          add(
            'bands_overlap',
            wall,
            [lower.beam, upper.beam],
            `${nameOf(lower.beam)} runs into ${nameOf(upper.beam)}.`
          );
  }
  return problems;
}

const node = (meta, name) => meta.repeatablesByNodeKey[name];
const rowsOf = (meta, name, parent) => parent?.repeatable?.[node(meta, name).preferredKey] || [];
/** A row's subject id (its storage field), or null. */
function idOf(meta, name, row) {
  const field = node(meta, name).fields.find(
    (entry) => entry.binding?.role === 'storage' || entry.binding?.storageRole === 'storage'
  );
  try {
    return JSON.parse(row.values[field.dataName]).id;
  } catch {
    return null;
  }
}
const indexOf = (meta, name, rows, id) => rows.findIndex((row) => idOf(meta, name, row) === id);

/**
 * The problems with the rows that show them (index paths from the floors, as canvas entries carry
 * them). `paths`, to select (D1c, 2026-11-25): the band's copy in each room's wall row facing it,
 * the lower band of two overlapping (named first); without a `face_beams` node, the wall rows
 * facing the band's segment. `markPaths`, where the marker stands: an opening's copies where one
 * runs into the band (where they clash), else the same rows.
 * @param {ReturnType<typeof buildingPlanProblems>} problems
 * @param {{ meta: object, record: object, floor: object }} plan the plan's metadata, its record
 *   and the problems' floor
 */
export function problemRowPaths(problems, { meta, record, floor }) {
  const floorRows = rowsOf(meta, 'floors', record);
  const floorIndex = indexOf(meta, 'floors', floorRows, floor.id);
  const roomRows = rowsOf(meta, 'rooms', floorRows[floorIndex]);
  const beams = node(meta, 'face_beams') ? 'face_beams' : null;
  return problems.map((problem) => {
    const opening = problem.elements.find((element) => element.type !== 'beam');
    const band = problem.elements.find((element) => element.type === 'beam');
    const projection = opening?.type === 'door' ? 'face_doors' : 'face_windows';
    const paths = [];
    const markPaths = [];
    // A copy of `id` in a wall row's `name` rows, as an index path, or null.
    const copy = (path, faceRow, name, id) => {
      const index = indexOf(meta, name, rowsOf(meta, name, faceRow), id);
      return index >= 0 ? [...path, { key: node(meta, name).preferredKey, index }] : null;
    };
    for (const room of floorIndex < 0 ? [] : floor.rooms) {
      const roomIndex = indexOf(meta, 'rooms', roomRows, room.id);
      const faceRows = rowsOf(meta, 'walls', roomRows[roomIndex]);
      for (const face of room.faces) {
        const faceIndex = indexOf(meta, 'walls', faceRows, face.id);
        if (face.wallId !== problem.wallId || roomIndex < 0 || faceIndex < 0) continue;
        if (!face.bindings.some((binding) => binding.segmentId === problem.segmentId)) continue;
        const path = [
          { key: node(meta, 'floors').preferredKey, index: floorIndex },
          { key: node(meta, 'rooms').preferredKey, index: roomIndex },
          { key: node(meta, 'walls').preferredKey, index: faceIndex },
        ];
        const selected = beams && band ? copy(path, faceRows[faceIndex], beams, band.id) : path;
        if (selected) paths.push(selected);
        const mark = opening ? copy(path, faceRows[faceIndex], projection, opening.id) : selected;
        if (mark) markPaths.push(mark);
      }
    }
    return { ...problem, paths, markPaths };
  });
}

/**
 * The problems of one floor of a plan (an editor's or session's `getSnapshot()`); with the plan's
 * metadata and record, the rows that show them too (`problemRowPaths`).
 * @param {object} plan
 * @param {string} floorId
 * @param {{ meta?: object, record?: object }} [rows]
 */
export function getBuildingPlanProblems(plan, floorId, { meta, record } = {}) {
  // A floor not in the plan (yet, or any more) has none.
  const floor = plan?.floors?.find((entry) => entry.id === floorId);
  if (!floor) return [];
  const problems = buildingPlanProblems(floor);
  return meta && record ? problemRowPaths(problems, { meta, record, floor }) : problems;
}
