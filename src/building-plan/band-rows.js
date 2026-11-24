import { BAND_KINDS } from '../schema/building-plan-floors.js';
import { NEW_BEAM_DEPTH } from './beam-defaults.js';
import { cleanLength as clean, distance } from './geometry.js';

/**
 * Band rows (bands unit 2, decided 2026-11-24, B): a wall whose ring beam, lintel band or sill band
 * answer is Yes has one row of that band in its Beams list per segment, kept by the engine after
 * every edit, the way a room's outline keeps its wall rows. A band row spans its whole segment,
 * as wide as the wall; its underside and depth are the floor's, live (unit 3 lets a row set its
 * own); the ring beam's top is its wall's top. A No removes the row; removing the row sets the
 * wall's answer to No (`opening-operations.js`). Its `wall_beam_band` tells it from a beam added
 * by hand.
 */

export const BAND_FIELD = 'wall_beam_band';
/** Until the floor's underside is typed: a new window's head (0.9 + 1.2) and its sill. */
const LINTEL_UNDERSIDE = 2.1;
const SILL_TOP = 0.9;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** A wall beam's band kind (ring, lintel, sill), or null for a beam added by hand. */
export function bandOf(beam) {
  return beam?.values?.[BAND_FIELD]?.choice?.[0]?.value ?? null;
}

/** The band entry (`BAND_KINDS`) for a kind. */
export function bandKind(kind) {
  return BAND_KINDS.find((entry) => entry.kind === kind) || null;
}

/** The wall's answer for a band ('yes', 'no' or null). */
function answerOf(wall, band) {
  return wall.properties?.[band.wall]?.choice?.[0]?.value ?? null;
}

/** A band's size and height from the floor's answers, for this wall. */
function bandSize(floor, wall, band) {
  const value = (suffix) => floor.values?.[`${band.floor}_${suffix}`];
  const depth = finite(value('depth')) ? value('depth') : NEW_BEAM_DEPTH;
  if (band.kind === 'ring') {
    const height = wall.properties?.wall_height;
    return { depth, underside: finite(height) ? clean(height - depth) : null };
  }
  const typed = value('distance_from_floor');
  if (finite(typed)) return { depth, underside: typed };
  return { depth, underside: band.kind === 'lintel' ? LINTEL_UNDERSIDE : clean(SILL_TOP - depth) };
}

/**
 * Keep every wall's band rows in step with its answers and the floor's values.
 *
 * @param {object} floor the stored floor (changed in place)
 * @param {() => string} createId
 */
export function keepBandRows(floor, createId) {
  for (const wall of floor?.walls || []) {
    const beams = wall.beams || [];
    const kept = new Set();
    const added = [];
    for (const segment of wall.segments)
      for (const band of BAND_KINDS) {
        if (answerOf(wall, band) !== 'yes') continue;
        let row = beams.find(
          (beam) => bandOf(beam) === band.kind && beam.segmentId === segment.id && !kept.has(beam)
        );
        if (!row) {
          row = {
            id: createId(),
            type: 'beam',
            segmentId: segment.id,
            values: {
              [BAND_FIELD]: { choice: [{ value: band.kind, label: band.title }], other: [] },
            },
          };
          added.push(row);
        }
        kept.add(row);
        Object.assign(row, {
          offset: 0,
          length: clean(distance(segment.start, segment.end)),
          width: wall.properties?.wall_thickness ?? null,
          ...bandSize(floor, wall, band),
        });
      }
    // A second row of one band on a segment (a Rejoin of parts that differed) goes with the rest.
    wall.beams = [...beams.filter((beam) => !bandOf(beam) || kept.has(beam)), ...added];
  }
}
