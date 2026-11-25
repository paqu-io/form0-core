import { copyBuildingPlanData as copy, findWall, own, planIssue } from './model.js';
import { nameOf, wallChildForType, wallChildren } from './wall-children.js';
import { BAND_OWN_VALUES, bandKind, bandOf, withOwnValue } from './band-rows.js';

const EDITABLE = ['offset', 'width', 'height', 'sillHeight', 'segmentId', 'values'];
const BEAM_EDITABLE = ['length', 'depth', 'underside'];

/** The opening operations, shared by today's engine and the derived core. */
export const OPENING_OPERATIONS = Object.freeze([
  'create_opening',
  'update_opening',
  'remove_opening',
]);

const refuse = (code, message) => {
  const error = new Error(message);
  error.issues = [planIssue(code, message)];
  throw error;
};

/**
 * Apply `create_opening`, `update_opening` or `remove_opening` to the stored floor: a door, a
 * window or a wall beam (`kind: 'beam'`, 2026-11-24) lives on its wall's segment, at `offset`
 * metres from the segment's start. Whether it fits is checked by the snapshot validation
 * afterwards.
 *
 * @returns {{created?: {type: string, id: string}}}
 */
export function applyOpeningOperation(floor, operation, createId) {
  const wall = findWall(floor, operation.wallId);
  if (operation.type === 'create_opening') {
    const child = wallChildForType(operation.kind);
    if (!child) refuse('invalid_opening_type', 'Choose a door, a window or a beam.');
    const element = {
      id: operation.id || createId(),
      type: child.type,
      segmentId: operation.segmentId || wall.segments[0]?.id,
      offset: operation.offset,
      ...(child.type === 'beam'
        ? {
            // Wall beams (2026-11-24): along the wall and across, and the underside's height.
            length: operation.length,
            width: operation.width ?? null,
            depth: operation.depth ?? null,
            underside: operation.underside ?? null,
          }
        : {
            width: operation.width,
            height: operation.height ?? null,
            sillHeight: operation.sillHeight ?? null,
          }),
      values: copy(operation.values || {}),
    };
    (wall[child.list] ||= []).push(element);
    return { created: { type: element.type, id: element.id } };
  }
  const opening = wallChildren(wall).find((entry) => entry.id === operation.openingId);
  if (!opening) refuse('missing_opening', 'The opening no longer exists.');
  const list = wallChildForType(opening.type).list;
  const band = bandKind(bandOf(opening));
  if (operation.type === 'remove_opening') {
    wall[list] = wall[list].filter((entry) => entry.id !== opening.id);
    // A band row removed from the list: the wall's answer becomes No (bands unit 2), so the
    // engine doesn't bring it back; Reset to the floor's answer does.
    if (band) {
      const no = { choice: [{ value: 'no', label: 'No' }], other: [] };
      wall.overrides = { ...(wall.overrides || {}), [band.wall]: no };
      wall.properties = { ...(wall.properties || {}), [band.wall]: copy(no) };
    }
  } else {
    // A band row spans its whole wall (bands unit 2); the ring beam's top is its wall's. Its
    // underside, depth and width typed here are its own; Reset returns them (unit 3).
    if (band) bandEdit(band, opening, operation);
    for (const key of [...EDITABLE, ...(opening.type === 'beam' ? BEAM_EDITABLE : [])])
      if (own(operation, key)) opening[key] = copy(operation[key]);
    if (band && (own(operation, 'underside') || own(operation, 'depth')))
      bandWithinWall(band, opening, wall);
  }
  return {};
}

/**
 * A band row's underside or depth typed beyond its wall is refused, as a beam added by hand
 * (bands unit 4a); from the floor's values or an opening pushing it, it is a problem to fix
 * before saving (`plan-problems.js`).
 */
function bandWithinWall(band, row, wall) {
  const height = wall.properties?.wall_height;
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  if (!finite(height) || !finite(row.depth)) return;
  const underside = band.kind === 'ring' ? height - row.depth : row.underside;
  if (!finite(underside)) return;
  if (underside + row.depth > height + 1e-6)
    refuse('beam_above_wall', `${nameOf(row)} would stand above its wall.`);
  if (underside < -1e-6) refuse('beam_below_floor', `${nameOf(row)} would go below the floor.`);
}

function bandEdit(band, row, operation) {
  const name = band.title.toLowerCase();
  if (['segmentId', 'offset', 'length'].some((key) => own(operation, key)))
    refuse('band_kept', `The ${name} spans its whole wall.`);
  if (band.kind === 'ring' && own(operation, 'underside'))
    refuse('band_kept', "The ring beam's top is its wall's top: change its depth instead.");
  for (const key of Object.keys(BAND_OWN_VALUES)) {
    if (own(operation, key)) withOwnValue(row, key, true);
    if ((operation.reset || []).includes(key)) withOwnValue(row, key, false);
  }
}
