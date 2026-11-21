import { BUILDING_PLAN_PROPERTIES, buildingPlanFaceSegments } from './model.js';
import { buildingPlanFaceAxes } from './footprints.js';
import { SAME, lineFrame } from './derive/grid.js';
import { resolveWallThickness } from './derive/thickness.js';

/**
 * Free walls are drawn, moved and checked by their centreline (4a-3, 2026-11-20). The record keeps
 * the face each was drawn along before (the row's own side, `freePath`), with the body beside it,
 * so hosts get a free wall's centreline and its row's face (`sidePoints`) from the canvas snapshot,
 * and the canvas controller turns the centreline a host sends back into that face.
 */

/**
 * `points` moved `distance` along their normal (the left of the direction of travel, as
 * `lineFrame`); where two segments meet, the point goes where their moved lines cross.
 * @param {Array<{ x: number, y: number }>} points
 * @param {number} distance
 * @returns {Array<{ x: number, y: number }>}
 */
export function offsetLine(points, distance) {
  const frames = points.slice(1).map((point, index) => lineFrame(points[index], point));
  const nearestFrame = (index) =>
    frames.slice(index).find(Boolean) || frames.slice(0, index).reverse().find(Boolean) || null;
  return points.map((point, index) => {
    const before = frames[index - 1] || null;
    const after = frames[index] || null;
    const own = after || before || nearestFrame(index);
    if (!own) return { ...point };
    const moved = (frame) => ({
      x: point.x + frame.normal.x * distance,
      y: point.y + frame.normal.y * distance,
    });
    const det = before && after ? cross(before.tangent, after.tangent) : 0;
    if (Math.abs(det) <= 1e-9) return { ...point, ...moved(own) };
    const [p, q] = [moved(before), moved(after)];
    const t = cross({ x: q.x - p.x, y: q.y - p.y }, after.tangent) / det;
    return { ...point, x: p.x + before.tangent.x * t, y: p.y + before.tangent.y * t };
  });
}

const cross = (a, b) => a.x * b.y - a.y * b.x;

/**
 * How far a free wall's row's face lies from its centreline, along the centreline's normal
 * (signed; 0 without a face or a centreline).
 * @param {Array<{ x: number, y: number }>} points the centreline
 * @param {Array<{ x: number, y: number }> | undefined} sidePoints the row's face
 */
export function freeWallSideDistance(points, sidePoints) {
  const frame = points?.length > 1 ? lineFrame(points[0], points[1]) : null;
  const face = sidePoints?.[0];
  if (!frame || !face) return 0;
  return (face.x - frame.start.x) * frame.normal.x + (face.y - frame.start.y) * frame.normal.y;
}

/**
 * The thickness a new free wall in `roomId` takes, in metres, as the derived engine resolves it
 * (floor and room defaults; 0 when unknown or in conflict, where the wall has no width).
 * @param {object} floor the stored floor
 * @param {string} roomId
 * @param {object} [properties] the plan's property specifications (`meta.properties`)
 */
export function newFreeWallWidth(floor, roomId, properties = {}) {
  const { rooms = [], walls: _walls, ...data } = floor || {};
  const resolved = resolveWallThickness(
    { ...data, rooms: rooms.map((room) => ({ ...room, faces: [] })), walls: [] },
    { ...BUILDING_PLAN_PROPERTIES, ...properties },
    null,
    [roomId, roomId]
  );
  return !resolved.conflict && resolved.value > 0 ? resolved.value : 0;
}

/**
 * The face a new free wall is drawn along, from the centreline drawn: its body lies on side +1 of
 * the face (`create_wall`), so the face is half its width to the centreline's left.
 * @param {Array<{ x: number, y: number }>} centreline in metres
 * @param {number} width in metres
 */
export const newFreeWallFace = (centreline, width) => offsetLine(centreline, width / 2);

/**
 * A room face's centreline, in metres, along the face's direction (empty when its physical wall is
 * missing): the stored wall's axis under each portion of the face.
 * @param {object} floor
 * @param {object} room
 * @param {object} face
 */
export function faceCentreline(floor, room, face) {
  const physical = floor.walls.find((wall) => wall.id === face.wallId);
  if (!physical) return [];
  const portions = buildingPlanFaceSegments(floor, room, face).map((part) =>
    part.direction > 0 ? part : { ...part, start: part.end, end: part.start }
  );
  return buildingPlanFaceAxes(physical, portions, (point) => point);
}

/** The point of polyline `points` nearest to `point`. */
function nearestOn(points, point) {
  let best = null;
  for (let index = 1; index < points.length; index += 1) {
    const frame = lineFrame(points[index - 1], points[index]);
    if (!frame) continue;
    const along = Math.max(
      0,
      Math.min(
        frame.length,
        (point.x - frame.start.x) * frame.tangent.x + (point.y - frame.start.y) * frame.tangent.y
      )
    );
    const at = {
      x: frame.start.x + frame.tangent.x * along,
      y: frame.start.y + frame.tangent.y * along,
    };
    const gap = Math.hypot(point.x - at.x, point.y - at.y);
    if (!best || gap < best.gap) best = { at, gap };
  }
  return best?.at || null;
}

/**
 * Where each point of the room's free walls' faces falls on their centreline (by point id), so a
 * Split mark on a free wall shows on the line the wall is drawn by.
 * @returns {Map<string, { x: number, y: number }>}
 */
export function freeWallCutPoints(floor, room) {
  const points = new Map();
  for (const face of room.faces || []) {
    if (!face.freePath) continue;
    const centreline = faceCentreline(floor, room, face);
    for (const point of face.freePath) {
      const at = centreline.length > 1 ? nearestOn(centreline, point) : null;
      if (at && point.id) points.set(point.id, at);
    }
  }
  return points;
}

/**
 * A free wall's row's face (its own side) as the wall stands at `points`, its centreline as drawn
 * now (dragged, previewed), at the side and distance the snapshot gives; a wall given by its face
 * (`sidePoints` absent) is returned as it stands.
 * @param {{ points: object[], sidePoints?: object[] }} wall a canvas snapshot wall
 * @param {Array<{ x: number, y: number }>} [points]
 */
export function freeWallSideLine(wall, points = wall?.points) {
  if (!wall?.sidePoints?.length || !(points?.length > 1)) return points;
  return offsetLine(points, freeWallSideDistance(wall.points, wall.sidePoints));
}

/** Where the lines through `a1`–`a2` and `b1`–`b2` cross, or null when they are parallel. */
function crossingOf([a1, a2], [b1, b2]) {
  const u = { x: a2.x - a1.x, y: a2.y - a1.y };
  const v = { x: b2.x - b1.x, y: b2.y - b1.y };
  const det = cross(u, v);
  if (Math.abs(det) <= 1e-12) return null;
  const t = cross({ x: b1.x - a1.x, y: b1.y - a1.y }, v) / det;
  return { x: a1.x + u.x * t, y: a1.y + u.y * t };
}

/**
 * The room's free wall split points where two portions meet with no return between them (4a-4):
 * each a corner a host can drag to bend the wall there, at the centrelines' meeting point (metres).
 * @returns {Array<{ id: string, cutId: string, faceIds: [string, string], point: object }>}
 */
export function freeWallBendCorners(floor, room) {
  const faces = (room.faces || []).filter((face) => face.freePath && !face.lineage?.editingReturn);
  const corners = [];
  for (const earlier of faces) {
    const end = earlier.freePath.at(-1);
    if (!end?.editingCutId) continue;
    const later = faces.find(
      (face) =>
        face !== earlier &&
        face.freePath[0].editingCutId === end.editingCutId &&
        Math.hypot(face.freePath[0].x - end.x, face.freePath[0].y - end.y) <= SAME
    );
    if (!later) continue;
    const [a, b] = [faceCentreline(floor, room, earlier), faceCentreline(floor, room, later)];
    if (a.length < 2 || b.length < 2) continue;
    const point = crossingOf(a.slice(-2), b.slice(0, 2)) || a.at(-1);
    corners.push({ id: end.id, cutId: end.editingCutId, faceIds: [earlier.id, later.id], point });
  }
  return corners;
}
