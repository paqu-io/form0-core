import { BUILDING_PLAN_MEASURES } from '../schema/building-plan-measures.js';
import { bandKind, bandOf } from './band-rows.js';
import { copyBuildingPlanData as copy, own } from './model.js';
import { nameOf } from './wall-children.js';

/**
 * A No that removes band rows with values of their own asks first (bands unit 4c, decided
 * 2026-11-25): a wall's answer set to No (or reset to the floor's No), or the floor's answer set to
 * No, would drop rows whose underside, depth or width the row set itself (typed, or pushed by an
 * opening). Remove them, or Cancel; on the floor's No (every such wall following the floor),
 * also keep those walls' bands: each gets its own Yes and keeps its row. Removing a row from a
 * wall's Beams list confirms as the list does and doesn't ask.
 */

const YES = Object.freeze({ choice: [{ value: 'yes', label: 'Yes' }], other: [] });
const FIELDS = {
  underside: 'wall_beam_distance_from_floor',
  depth: 'wall_beam_depth',
  width: 'wall_beam_width',
};

const answerOf = (wall, band) => wall?.properties?.[band.wall]?.choice?.[0]?.value ?? null;

/**
 * The band rows with values of their own the edit removes by a No.
 * @returns {Array<{ wall: object, row: object, band: object, inherited: boolean }>} `wall` is the
 *   candidate's; `inherited`: the wall follows the floor's answer
 */
export function removedOwnBands(before, after, operation) {
  if (operation?.type === 'remove_opening') return [];
  const removed = [];
  for (const floor of after?.floors || []) {
    const previous = before?.floors?.find((entry) => entry.id === floor.id);
    for (const wall of floor.walls) {
      const was = previous?.walls.find((entry) => entry.id === wall.id);
      for (const row of was?.beams || []) {
        const band = bandKind(bandOf(row));
        if (!band || !row.ownValues?.length || answerOf(wall, band) === 'yes') continue;
        if ((wall.beams || []).some((entry) => bandOf(entry) === band.kind)) continue;
        removed.push({ wall, row, band, inherited: !own(wall.overrides || {}, band.wall) });
      }
    }
  }
  return removed;
}

/** "underside 2.6 m, width 150 mm": the values a row set itself. */
function ownValuesText(row) {
  return row.ownValues
    .map((key) => {
      const value = row[key];
      const shown =
        BUILDING_PLAN_MEASURES[FIELDS[key]] === 'thickness'
          ? `${Math.round(value * 1000)} mm`
          : `${Number(value.toFixed(2))} m`;
      return `${key} ${shown}`;
    })
    .join(', ');
}

/** The question's title, message and buttons. */
export function bandRemovalQuestion(removed) {
  const who = ({ wall, row }) => `${wall.values?.wall_label || wall.autoLabel}'s ${nameOf(row)}`;
  const one = removed.length === 1;
  return {
    title: 'Bands with values of their own',
    message: one
      ? `${who(removed[0])} has values of its own (${ownValuesText(removed[0].row)}). Remove it?`
      : `These bands have values of their own: ${removed
          .map((entry) => `${who(entry)} (${ownValuesText(entry.row)})`)
          .join('; ')}. Remove them?`,
    buttons: [
      { id: 'remove', label: one ? 'Remove it' : 'Remove them' },
      ...(removed.every((entry) => entry.inherited)
        ? [{ id: 'keep-bands', label: one ? "Keep this wall's band" : "Keep those walls' bands" }]
        : []),
      { id: 'cancel', label: 'Cancel' },
    ],
  };
}

/** "Keep those walls' bands": each wall answers Yes itself and keeps its row (changed in place). */
export function keepOwnBands(removed) {
  for (const { wall, row, band } of removed) {
    wall.overrides = { ...(wall.overrides || {}), [band.wall]: copy(YES) };
    wall.properties = { ...(wall.properties || {}), [band.wall]: copy(YES) };
    (wall.beams ||= []).push(copy(row));
  }
}
