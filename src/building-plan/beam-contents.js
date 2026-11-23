import { planIssue } from './model.js';
import { beamFits } from './beam-body.js';

/**
 * Room beams stay in their room (rule 1 of the room contents rules; 3a-3, 2026-11-23, B1 and B4
 * of the beams round): a beam's centreline and its body lie inside its room's outline, touching
 * allowed, its ends cut along the faces they stop on (`beam-body.js`). Checked on the derived
 * engine's edits, naming the beam; records that break it still read.
 */

const textOf = (value) =>
  typeof value === 'string'
    ? value.trim() || null
    : (value?.other?.[0]?.label ?? value?.choice?.[0]?.label ?? null);

/** A beam's name: its identifier, else its place in its room ("B#2"). */
export const beamName = (beam, index) => textOf(beam.values?.beam_identifier) || `B#${index + 1}`;

const fits = (beam, room) =>
  !beam.start ||
  !beam.end ||
  beamFits(beam.start, beam.end, beam.width > 0 ? beam.width / 2 : 0, room?.vertices || []);

/**
 * The beams of `floor` an edit takes out of their room, one issue each. A beam already out
 * before the edit doesn't refuse it: no edit leaves it outside (records drawn before 3a may have
 * half a beam over a wall, which would otherwise refuse every edit on the floor).
 * @param {object} floor the edited floor
 * @param {object | null} before the floor before the edit
 * @returns {object[]} issues
 */
export function beamPlacementIssues(floor, before = null) {
  const issues = [];
  for (const room of floor.rooms) {
    const previous = before?.rooms.find((entry) => entry.id === room.id);
    (room.beams || []).forEach((beam, index) => {
      if (fits(beam, room)) return;
      const old = previous?.beams?.find((entry) => entry.id === beam.id);
      if (old && !fits(old, previous)) return;
      issues.push(
        planIssue('beam_outside_room', `Beam ${beamName(beam, index)} would leave its room.`, {
          type: 'beams',
          id: beam.id,
        })
      );
    });
  }
  return issues;
}
