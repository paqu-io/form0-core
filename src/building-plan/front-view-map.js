import { clipToConvex, roomMapWalls } from './front-view-map-walls.js';
import {
  GEOMETRY_EPSILON,
  add,
  cleanLength as clean,
  cleanPoint,
  cross,
  multiply,
  polygonArea,
  subtract,
} from './geometry.js';

/**
 * The front view's mini-map (decided 2026-11-26, mockup round 4): the shown row's room in plan,
 * in metres as the plan draws it (O1, not turned), display only. Given:
 *
 * - `outline`: the room's floor; `walls`: its walls' material as the plan draws it, openings as
 *   gaps, free walls included (`front-view-map-walls.js`); `lines`: its walls of unknown
 *   thickness, as the plan's lines;
 * - `shown`: the shown row's face, a segment per piece; `others`: the side's other rows';
 * - `zero`: the row's 0 end, its left end seen from inside, where its lengths count (WB3);
 * - `eye` and `cone`: where the row is seen from, in front of its middle along its inward normal,
 *   half its length in but at most 80% of the way to the first wall ahead (the room's outline,
 *   its free walls), the cone from there to the row's ends clipped to the floor; a row on several
 *   sides is seen from its longest part, a free wall from its row's side;
 * - `bounds`: what the map shows (the outline, walls and lines).
 */

const AHEAD = 0.8;

/** A strip point (metres along the view) in plan. */
const toPlan = (part, x) => cleanPoint(add(part.left, multiply(part.right, x - part.x0)));
/** Into the room, toward the viewer: `right` turned back (front-view-strip's `rightOf`). */
const inward = (part) => ({ x: -part.right.y + 0, y: part.right.x + 0 });

/**
 * @param {object} floor the plan's floor
 * @param {object} room the shown row's room
 * @param {object} face the shown row
 * @param {Array<object>} parts its strip (`front-view-strip.js`), laid out
 */
export function frontViewMap(floor, room, face, parts) {
  const { walls, lines, footprints } = roomMapWalls(floor, room);
  const outline = room.vertices.map(({ x, y }) => ({ x, y }));
  const segments = (keep) =>
    parts.flatMap((part) =>
      part.pieces.filter(keep).map((piece) => [toPlan(part, piece.from), toPlan(part, piece.to)])
    );
  const runs = parts
    .map((part) => {
      const own = part.pieces.filter((piece) => piece.faceId === face.id);
      if (!own.length) return null;
      const from = Math.min(...own.map((piece) => piece.from));
      return { part, from, to: Math.max(...own.map((piece) => piece.to)) };
    })
    .filter(Boolean);
  const zero = toPlan(runs[0].part, runs[0].from);
  const end = toPlan(runs.at(-1).part, runs.at(-1).to);
  const longest = runs.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
  const middle = toPlan(longest.part, (longest.from + longest.to) / 2);
  const normal = inward(longest.part);
  const free = freeAhead(middle, normal, obstacles(room, face, outline, footprints));
  const eye = cleanPoint(
    add(middle, multiply(normal, Math.min((longest.to - longest.from) / 2, AHEAD * free)))
  );
  const triangle = [eye, zero, end];
  const cone =
    Math.abs(polygonArea(triangle)) > GEOMETRY_EPSILON
      ? clipToConvex(outline, triangle).map(cleanPoint)
      : [];
  return {
    outline,
    walls,
    lines,
    shown: segments((piece) => piece.faceId === face.id),
    others: segments((piece) => piece.faceId && piece.faceId !== face.id),
    zero,
    eye,
    cone,
    bounds: boundsOf([...outline, ...walls.flat(), ...lines.flat()]),
  };
}

/** What a look ahead stops at: the room's outline, its free walls' bodies (not the shown one). */
function obstacles(room, face, outline, footprints) {
  const edges = (points) => points.map((point, i) => [point, points[(i + 1) % points.length]]);
  const free = new Set(room.faces.filter((entry) => entry.freePath).map((entry) => entry.wallId));
  if (face.freePath) free.delete(face.wallId);
  const bodies = footprints.filter((entry) => free.has(entry.id));
  return [
    ...edges(outline),
    ...bodies.flatMap((entry) => entry.polygons.flatMap(edges)),
    ...bodies.flatMap((entry) => entry.schematicSegments.map((segment) => segment.points)),
  ];
}

/** How far a look from `from` along `toward` runs before a segment; Infinity when none. */
function freeAhead(from, toward, segments) {
  let nearest = Infinity;
  for (const [a, b] of segments) {
    const along = subtract(b, a);
    const offset = subtract(a, from);
    const det = cross(toward, along);
    if (Math.abs(det) <= GEOMETRY_EPSILON) continue;
    const t = cross(offset, along) / det;
    const u = cross(offset, toward) / det;
    if (t > GEOMETRY_EPSILON && u >= -GEOMETRY_EPSILON && u <= 1 + GEOMETRY_EPSILON)
      nearest = Math.min(nearest, t);
  }
  return nearest;
}

function boundsOf(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x: clean(x),
    y: clean(y),
    width: clean(Math.max(...xs) - x),
    height: clean(Math.max(...ys) - y),
  };
}
