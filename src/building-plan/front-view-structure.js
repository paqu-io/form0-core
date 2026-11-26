import { beamOutline } from './beam-body.js';
import { cleanLength as clean, dot, subtract } from './geometry.js';
import { alongStrip } from './front-view-strip.js';

/**
 * The columns and room beams a wall row's front view (A1) draws (decided 2026-11-26): its room's,
 * where their footprint or body touches the face of the side shown (within 1 mm, standing against
 * it or set into it), not those standing free in the room. A column runs from the floor to its
 * height (unknown: its wall's drawn height, `height` null); a room beam is drawn at its underside
 * and depth (unknown: not drawn), `endOn` when it meets the wall across, seen end on, else lying
 * along it. Each by its stretch along the strip and the row it stands against.
 */

const TOUCH = 1e-3;
const EPS = 1e-6;
const PARALLEL = Math.cos((5 * Math.PI) / 180);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** A column's footprint: its box about its centre, turned by its rotation (degrees). */
function columnCorners(column) {
  const { x, y } = column.position;
  const hw = column.width / 2;
  const hh = column.height / 2;
  const angle = ((column.rotation || 0) * Math.PI) / 180;
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([u, v]) => ({ x: x + u * c - v * s, y: y + u * s + v * c }));
}

/** Where a footprint touches a part's face, along the strip; null when it doesn't. */
function against(part, polygon) {
  const inward = { x: -part.right.y, y: part.right.x };
  const depths = polygon.map((point) => dot(subtract(point, part.left), inward));
  if (Math.min(...depths) > TOUCH || Math.max(...depths) < -TOUCH) return null;
  const along = polygon.map((point) => alongStrip(part, point));
  const from = Math.max(Math.min(...along), part.x0);
  const to = Math.min(Math.max(...along), part.x0 + part.length);
  return to - from > EPS ? { from: clean(from), to: clean(to) } : null;
}

/** The first stretch of a footprint against the strip's parts, with the row it stands against. */
function onStrip(parts, polygon) {
  for (const part of parts) {
    const stretch = against(part, polygon);
    if (!stretch) continue;
    const middle = (stretch.from + stretch.to) / 2;
    const piece =
      part.pieces.find((entry) => entry.from - EPS <= middle && middle <= entry.to + EPS) ||
      part.pieces[0];
    return { part, stretch, faceId: piece?.faceId ?? null };
  }
  return null;
}

const heightOf = (element, name) => {
  const value = element.properties?.[name] ?? element.values?.[name];
  return finite(value) ? value : null;
};

/**
 * @param {object} room
 * @param {Array<object>} parts the strip's (`front-view-strip.js`)
 * @param {(faceId: string | null) => number} drawnHeight a row's drawn height
 * @returns {{ columns: object[], roomBeams: object[] }}
 */
export function frontViewStructure(room, parts, drawnHeight) {
  const columns = [];
  for (const [index, column] of (room.columns || []).entries()) {
    if (!column.position || !(column.width > 0) || !(column.height > 0)) continue;
    const found = onStrip(parts, columnCorners(column));
    if (!found) continue;
    const height = heightOf(column, 'column_height');
    columns.push({
      subjectId: column.id,
      faceId: found.faceId,
      name: column.values?.column_identifier || `C#${index + 1}`,
      ...found.stretch,
      bottom: 0,
      top: clean(height ?? drawnHeight(found.faceId)),
      height,
    });
  }
  const roomBeams = [];
  for (const [index, beam] of (room.beams || []).entries()) {
    const underside = heightOf(beam, 'beam_distance_from_floor');
    if (!beam.start || !beam.end || !(beam.width > 0) || underside === null) continue;
    if (!finite(beam.height)) continue;
    const found = onStrip(parts, beamOutline(beam.start, beam.end, beam.width / 2, room.vertices));
    if (!found) continue;
    const run = subtract(beam.end, beam.start);
    const along = Math.abs(dot(run, found.part.right)) / Math.hypot(run.x, run.y);
    roomBeams.push({
      subjectId: beam.id,
      faceId: found.faceId,
      name: beam.values?.beam_identifier || `B#${index + 1}`,
      ...found.stretch,
      bottom: clean(underside),
      top: clean(underside + beam.height),
      endOn: along < PARALLEL,
    });
  }
  const byPlace = (a, b) => a.from - b.from || a.bottom - b.bottom;
  return { columns: columns.sort(byPlace), roomBeams: roomBeams.sort(byPlace) };
}

/** The room's columns' known heights and room beams' tops, for its highest level. */
export function structureTops(room) {
  const tops = [];
  for (const column of room.columns || []) {
    const height = heightOf(column, 'column_height');
    if (height !== null) tops.push(height);
  }
  for (const beam of room.beams || []) {
    const underside = heightOf(beam, 'beam_distance_from_floor');
    if (underside !== null && finite(beam.height)) tops.push(underside + beam.height);
  }
  return tops;
}
