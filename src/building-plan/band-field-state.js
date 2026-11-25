import { BAND_OWN_VALUES, bandOf, ownsValue } from './band-rows.js';
import { copyBuildingPlanData as copy } from './model.js';
import { normalizeBuildingPlanLocale } from './presentation.js';
import { BAND_TEXTS } from './presentation-band-texts.js';

/**
 * Where a band row's underside, depth and width come from, as the form shows it (bands unit 3,
 * 2026-11-24): "Floor default" or "This wall" while inherited, Reset once set on the row, as
 * plaster. A value the row can't set says why in its description, in the editor's language (asked
 * at the unit 3 hand test): its distance and length (a band spans its whole wall), the ring beam's
 * underside (its wall's top). A beam added by hand shows neither.
 */

const SPANS =
  'Spans the whole wall. For part of it, set it to No on the wall and add the beam yourself.';
const RING_TOP = "The ring beam's top is the wall's top: change its depth instead.";

const FIELD_VALUES = Object.freeze({
  wall_beam_distance_from_floor: 'underside',
  wall_beam_depth: 'depth',
  wall_beam_width: 'width',
});

const KEPT_FIELDS = Object.freeze(['wall_beam_offset', 'wall_beam_length']);

/** The state of a value the row can't set: no source, the reason as its description. */
function keptState(field, selected, row, text, locale) {
  const language = normalizeBuildingPlanLocale(locale);
  return {
    managed: false,
    dataName: field.dataName,
    scope: field.binding?.scope,
    property: field.originalDataName,
    inheritable: false,
    value: copy(selected.row.values[field.dataName]),
    source: null,
    description: BAND_TEXTS[language]?.[text] || text,
    subjectId: row.id,
    untagged: true,
    outside: false,
    opposite: false,
    applicable: true,
    sharedWith: [],
  };
}

/**
 * @param {object} plan the editor's plan
 * @param {object} selected the row the field is in (`transactions.js`'s selection)
 * @param {object} field the field's metadata entry
 * @param {string} [locale] the editor's language, for a description
 * @returns {object | null} the field's state, or null when it isn't a band row's value
 */
export function bandFieldState(plan, selected, field, locale = 'en') {
  if (!['wall_beams', 'face_beams'].includes(selected.node.nodeKey)) return null;
  const key = FIELD_VALUES[field.originalDataName];
  const kept = KEPT_FIELDS.includes(field.originalDataName);
  if (!key && !kept) return null;
  const floor = plan.floors.find((entry) => entry.id === selected.floorId);
  const row = floor?.walls
    .flatMap((wall) => wall.beams || [])
    .find((beam) => beam.id === selected.model.id);
  const kind = bandOf(row);
  if (!kind) return null;
  if (kept) return keptState(field, selected, row, SPANS, locale);
  if (kind === 'ring' && key === 'underside')
    return keptState(field, selected, row, RING_TOP, locale);
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
