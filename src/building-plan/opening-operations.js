import { copyBuildingPlanData as copy, findWall, own, planIssue } from './model.js';
import { wallChildForType, wallChildren } from './wall-children.js';
import { bandKind, bandOf } from './band-rows.js';

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
    // A band row's place, size and height come from its wall and the floor (bands unit 2).
    const kept = ['segmentId', 'offset', 'width', 'length', 'depth', 'underside'];
    if (band && kept.some((key) => own(operation, key)))
      refuse(
        'band_kept',
        `The ${band.title.toLowerCase()} spans its whole wall at the floor's height.`
      );
    for (const key of [...EDITABLE, ...(opening.type === 'beam' ? BEAM_EDITABLE : [])])
      if (own(operation, key)) opening[key] = copy(operation[key]);
  }
  return {};
}
