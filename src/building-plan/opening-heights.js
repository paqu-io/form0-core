import { bandOf } from './band-rows.js';
import { fitToBands } from './band-clash-question.js';
import { cleanLength as clean } from './geometry.js';

/**
 * A new door's or window's heights (bands unit 5, decided 2026-11-24 and 2026-11-25): from the
 * bands on the segment it is placed on, as they stand there (the wall's own band row, else the
 * floor's): a head at the lintel band's underside, a window's sill at the sill band's top; an edge
 * with no band of its own keeps today's place (a door's head 2 m; a window's sill 0.9 m, its head
 * 2.1 m). Then 4b's Fit (`fitToBands`): a head never starts inside a band above it (the ring beam
 * on a low wall). Bands that leave no height: today's defaults, listed as a problem (4a). The
 * values are the opening's own from then on; a band moved later doesn't carry them.
 */

const DOOR_HEIGHT = 2;
const WINDOW_SILL = 0.9;
const WINDOW_HEIGHT = 1.2;
const EPS = 1e-6;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * @param {object | null | undefined} floor the stored floor
 * @param {{ wallId: string, segmentId?: string | null, kind: 'door' | 'window' }} place
 * @returns {{ height: number, sillHeight: number | null }}
 */
export function newOpeningHeights(floor, { wallId, segmentId, kind }) {
  const window = kind === 'window';
  const defaults = {
    height: window ? WINDOW_HEIGHT : DOOR_HEIGHT,
    sillHeight: window ? WINDOW_SILL : null,
  };
  const wall = floor?.walls?.find((entry) => entry.id === wallId);
  const segment = segmentId || wall?.segments?.[0]?.id;
  // Doors pass through sill bands (4a).
  const bands = (wall?.beams || []).filter(
    (beam) =>
      beam.segmentId === segment &&
      bandOf(beam) &&
      finite(beam.underside) &&
      finite(beam.depth) &&
      (window || bandOf(beam) !== 'sill')
  );
  const band = (name) => bands.find((beam) => bandOf(beam) === name);
  const lintel = band('lintel');
  const sillBand = band('sill');
  const sill = !window ? 0 : sillBand ? sillBand.underside + sillBand.depth : WINDOW_SILL;
  const head = lintel ? lintel.underside : window ? WINDOW_SILL + WINDOW_HEIGHT : DOOR_HEIGHT;
  if (head - sill <= EPS) return defaults;
  const into = bands.filter(
    (beam) => Math.min(head, beam.underside + beam.depth) - Math.max(sill, beam.underside) > EPS
  );
  const fit = fitToBands({ sillHeight: sill, height: head - sill }, into);
  if (!fit) return defaults;
  return {
    height: clean(fit.head - fit.sill),
    sillHeight: window ? clean(fit.sill) : null,
  };
}
