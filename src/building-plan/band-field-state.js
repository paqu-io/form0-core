import { BAND_OWN_VALUES, bandOf, ownsValue } from './band-rows.js';
import { copyBuildingPlanData as copy } from './model.js';

/**
 * Where a band row's underside, depth and width come from, as the form shows it (bands unit 3,
 * 2026-11-24): "Floor default" or "This wall" while inherited, Reset once set on the row, as
 * plaster. The ring beam's underside is its wall's top, not shown as inherited. A beam added by
 * hand has no source to show.
 */

const FIELD_VALUES = Object.freeze({
  wall_beam_distance_from_floor: 'underside',
  wall_beam_depth: 'depth',
  wall_beam_width: 'width',
});

/**
 * @param {object} plan the editor's plan
 * @param {object} selected the row the field is in (`transactions.js`'s selection)
 * @param {object} field the field's metadata entry
 * @returns {object | null} the field's state, or null when it isn't a band row's value
 */
export function bandFieldState(plan, selected, field) {
  if (!['wall_beams', 'face_beams'].includes(selected.node.nodeKey)) return null;
  const key = FIELD_VALUES[field.originalDataName];
  if (!key) return null;
  const floor = plan.floors.find((entry) => entry.id === selected.floorId);
  const row = floor?.walls
    .flatMap((wall) => wall.beams || [])
    .find((beam) => beam.id === selected.model.id);
  const kind = bandOf(row);
  if (!kind || (kind === 'ring' && key === 'underside')) return null;
  return {
    managed: false,
    dataName: field.dataName,
    scope: field.binding?.scope,
    property: field.originalDataName,
    inheritable: true,
    value: copy(selected.row.values[field.dataName]),
    source: { scope: BAND_OWN_VALUES[key], mode: ownsValue(row, key) ? 'override' : 'inherit' },
    subjectId: row.id,
    // Its source shows; no "Whole wall" or "Room side" tag, as on any beam's field.
    untagged: true,
    outside: false,
    opposite: false,
    applicable: true,
    sharedWith: [],
  };
}
