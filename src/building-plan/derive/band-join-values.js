import { BAND_KINDS } from '../../schema/building-plan-floors.js';
import { bandOf, ownsValue, withOwnValue } from '../band-rows.js';
import { equalValue } from '../model.js';

/**
 * Band rows in the joining walls' question (bands unit 4c, decided 2026-11-25): walls joining or
 * rejoining whose band rows of one kind give a value differently, one of them setting it itself
 * (typed or pushed), ask which applies with their other differences. Without the question the
 * second row of a band was dropped, its values lost. An entry is `{ kind: 'band', band, key }`,
 * `key` the field's data name (for the question's words and units); an option's mark says whether
 * that wall's row set the value itself, so the chosen value stays its own or stays inherited.
 */

/** A band row's values by the field each is typed in. */
const FIELDS = Object.freeze({
  underside: 'wall_beam_distance_from_floor',
  depth: 'wall_beam_depth',
  width: 'wall_beam_width',
});
const VALUE_OF_FIELD = Object.fromEntries(
  Object.entries(FIELDS).map(([key, field]) => [field, key])
);

/** The question's words for a band entry ("Lintel band underside"). */
export function bandEntryLabel(entry) {
  const title = BAND_KINDS.find((band) => band.kind === entry.band)?.title || 'Band';
  return `${title} ${VALUE_OF_FIELD[entry.key]}`;
}

/** A subject's (derived) or a stored wall's band row of a kind. */
const rowOf = (wall, band) =>
  [...(wall.openings || []), ...(wall.beams || [])].find(
    (entry) => entry.type === 'beam' && bandOf(entry) === band
  );
/** The derived core carries a beam's width across the wall as `crossWidth` (`along-wall.js`). */
const valueOf = (row, key) => (key === 'width' && 'crossWidth' in row ? row.crossWidth : row[key]);

/**
 * The band values the joining walls give differently.
 * @param {object[]} subjects the joining walls, as the derived core carries them
 * @returns {Array<{ kind: 'band', band: string, key: string }>}
 */
export function bandDifferences(subjects) {
  const entries = [];
  for (const { kind } of BAND_KINDS)
    for (const [key, field] of Object.entries(FIELDS)) {
      const rows = subjects.map((subject) => rowOf(subject, kind)).filter(Boolean);
      if (rows.length < 2 || !rows.some((row) => ownsValue(row, key))) continue;
      const values = rows.map((row) => valueOf(row, key));
      if (values.some((value) => !equalValue(value, values[0])))
        entries.push({ kind: 'band', band: kind, key: field });
    }
  return entries;
}

/** One wall's value for a band entry and whether its row set it itself. */
export function bandOption(subject, entry) {
  const row = rowOf(subject, entry.band);
  const key = VALUE_OF_FIELD[entry.key];
  return row ? { value: valueOf(row, key) ?? null, own: ownsValue(row, key) } : null;
}

/** The chosen value written to the wall's rows of that band, its own or inherited as chosen. */
export function writeBandChoice(wall, entry, value, own) {
  const key = VALUE_OF_FIELD[entry.key];
  for (const row of wall.beams || [])
    if (bandOf(row) === entry.band) {
      row[key] = value;
      withOwnValue(row, key, own);
    }
}
