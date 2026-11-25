import { at, segmentFrame } from './geometry.js';
import { buildingPlanSegmentThickness } from './model.js';
import { bandOf } from './band-rows.js';
import { nameOf } from './wall-children.js';

/**
 * Wall beams and bands on the canvas (D1a, decided 2026-11-25): per room face, as doors and
 * windows are, each beam of the face's physical wall over the stretch of its segment that face
 * covers. An entry gives where it lies (ratios along the face's binding; its outline at its width,
 * centred on the wall's axis; its axis line), its heights, its band kind (ring, lintel or sill;
 * null for a beam added by hand) and its name. Both faces of a wall give the same outline. Display
 * only: the plan doesn't pick or drag them (WB10).
 */

const EPS = 1e-6;
/** A beam of no known width (its wall's thickness unknown) still shows as a thin band. */
const FALLBACK_WIDTH = 0.1;

/**
 * @param {object} options
 * @param {object} options.physical the face's physical wall
 * @param {object} options.face the room's face
 * @param {object[]} options.copies the face row's `face_beams` rows
 * @param {(row: object) => string} options.idOf a copy's subject id
 * @param {Array<{ key: string, index: number }>} options.wallPath the face row's index path
 * @param {string} options.copiesKey the `face_beams` key
 * @param {(point: { x: number, y: number }) => { x: number, y: number }} options.pixels
 * @param {object} options.at `{ roomId, floorIndex }`
 */
export function canvasWallBeams({
  physical,
  face,
  copies,
  idOf,
  wallPath,
  copiesKey,
  pixels,
  at: where,
}) {
  const entries = [];
  for (const beam of physical.beams || []) {
    const from = beam.offset;
    const to = beam.offset + beam.length;
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    const bindingIndex = face.bindings.findIndex(
      (binding) =>
        binding.segmentId === beam.segmentId &&
        Math.min(to, binding.interval[1]) - Math.max(from, binding.interval[0]) > EPS
    );
    if (bindingIndex < 0) continue;
    const binding = face.bindings[bindingIndex];
    const segment = physical.segments.find((entry) => entry.id === beam.segmentId);
    if (!segment) continue;
    // The part of the beam this face covers.
    const low = Math.max(from, binding.interval[0]);
    const high = Math.min(to, binding.interval[1]);
    const span = binding.interval[1] - binding.interval[0];
    const start = binding.direction > 0 ? low - binding.interval[0] : binding.interval[1] - high;
    const frame = segmentFrame(segment.start, segment.end);
    const thickness = buildingPlanSegmentThickness(physical, segment);
    const width = beam.width > 0 ? beam.width : thickness > 0 ? thickness : FALLBACK_WIDTH;
    const index = copies.findIndex((row) => idOf(row) === beam.id);
    entries.push({
      id: `${face.id}:${beam.id}`,
      subjectId: beam.id,
      wallId: face.id,
      physicalWallId: physical.id,
      roomId: where.roomId,
      floorIndex: where.floorIndex,
      index,
      path: [...wallPath, { key: copiesKey, index }],
      segmentIndex: bindingIndex,
      startRatio: start / span,
      endRatio: (start + high - low) / span,
      length: beam.length,
      width: beam.width ?? null,
      depth: beam.depth ?? null,
      underside: beam.underside ?? null,
      band: bandOf(beam),
      points: [
        at(frame, low, width / 2),
        at(frame, high, width / 2),
        at(frame, high, -width / 2),
        at(frame, low, -width / 2),
      ].map(pixels),
      axisPoints: [at(frame, low), at(frame, high)].map(pixels),
      label: beam.values?.wall_beam_identifier || '',
      displayLabel: beam.values?.wall_beam_identifier || nameOf(beam),
    });
  }
  return entries;
}
