import { subtractConvex, triangles } from '../footprints.js';
import { polygonArea } from '../geometry.js';

/**
 * Polygon operations the material derivation needs, implemented with today's convex subtraction:
 * a concave clip is triangulated first, and the result is a list of convex pieces.
 * An alternative implementation (for example Clipper2) can be passed with the same shape.
 *
 * @typedef {Array<{x: number, y: number}>} Polygon
 * @typedef {{
 *   difference: (subject: Polygon, clips: Polygon[]) => Polygon[],
 *   area: (polygons: Polygon[]) => number,
 * }} PolygonOps
 */
const isConvex = (polygon) => {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [a, b, c] = [0, 1, 2].map((k) => polygon[(i + k) % polygon.length]);
    const turn = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(turn) <= 1e-12) continue;
    if (sign && Math.sign(turn) !== sign) return false;
    sign = Math.sign(turn);
  }
  return true;
};

/** @type {PolygonOps} */
export const convexPolygonOps = {
  difference(subject, clips) {
    let pieces = [subject];
    for (const clip of clips.flatMap((entry) => (isConvex(entry) ? [entry] : triangles(entry))))
      pieces = pieces.flatMap((piece) => subtractConvex(piece, clip));
    return pieces;
  },
  area(polygons) {
    return polygons.reduce((total, polygon) => total + Math.abs(polygonArea(polygon)), 0);
  },
};
