import { buildingPlanFootprints, halfPlane, triangles } from './footprints.js';
import { buildingPlanSegmentThickness } from './model.js';
import {
  GEOMETRY_EPSILON,
  add,
  cleanPoint,
  cross,
  distance,
  multiply,
  polygonArea,
  polygonEdges,
  subtract,
} from './geometry.js';

/**
 * The mini-map's walls (decided 2026-11-26): the plan's wall material, the canvas's footprints
 * with their openings cut, kept to the room. That is its floor (its free walls) and, outside each
 * edge, a band as deep as the wall bound to it (a cap's: its source wall's), mitred at the room's
 * corners; so a neighbour's wall is left out but a corner it shares is drawn. Walls of unknown
 * thickness are the plan's lines. Metres; display only.
 */

const MITRE_LIMIT = 4; // as SVG's: a sharper corner's band isn't drawn past it
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** `subject` clipped to the convex `clip`; empty when they don't overlap. */
export function clipToConvex(subject, clip) {
  const side = Math.sign(polygonArea(clip));
  if (!side || subject.length < 3) return [];
  let result = subject;
  for (let i = 0; i < clip.length && result.length; i += 1)
    result = halfPlane(result, clip[i], clip[(i + 1) % clip.length], side);
  return result;
}

/**
 * @param {object} floor the plan's floor
 * @param {object} room one of its rooms
 * @returns {{ walls: Array<Array<{x: number, y: number}>>, lines: Array<Array<{x: number, y:
 *   number}>>, footprints: object[] }} `walls`: convex pieces, wound as the plan's (positive
 *   area), overlapping where the room's parts meet; `footprints`: the floor's, for the cone
 */
export function roomMapWalls(floor, room) {
  const { wallFootprints } = buildingPlanFootprints(floor, 1);
  const region = roomRegion(floor, room);
  const walls = [];
  for (const entry of wallFootprints)
    for (const polygon of entry.polygons)
      for (const clip of region) {
        if (!overlaps(polygon, clip)) continue;
        const piece = clipToConvex(polygon, clip).map(cleanPoint);
        if (piece.length >= 3) walls.push(polygonArea(piece) < 0 ? piece.reverse() : piece);
      }
  const own = new Set(room.faces.map((face) => face.wallId));
  const lines = wallFootprints
    .filter((entry) => own.has(entry.id))
    .flatMap((entry) => entry.schematicSegments.map((segment) => segment.points.map(cleanPoint)));
  return { walls, lines, footprints: wallFootprints };
}

/** The room's floor as triangles, a band outside each edge, a mitre at each outer corner. */
function roomRegion(floor, room) {
  const edges = polygonEdges(room).filter((edge) => edge.length > GEOMETRY_EPSILON);
  const sign = Math.sign(polygonArea(room.vertices)) || 1;
  const outward = (edge) => multiply(edge.normal, -sign);
  const depths = new Map(edges.map((edge) => [edge, depthOf(floor, room, edge)]));
  const region = triangles(room.vertices);
  for (const edge of edges) {
    const depth = depths.get(edge);
    if (!depth) continue;
    const out = multiply(outward(edge), depth);
    region.push([edge.start, edge.end, add(edge.end, out), add(edge.start, out)]);
  }
  edges.forEach((next, index) => {
    const previous = edges.at(index - 1);
    if (sign * cross(previous.tangent, next.tangent) <= GEOMETRY_EPSILON) return;
    const a = multiply(outward(previous), depths.get(previous));
    const b = multiply(outward(next), depths.get(next));
    const corner = next.start;
    const tip = mitre(add(corner, a), previous.tangent, add(corner, b), next.tangent);
    const reach = MITRE_LIMIT * Math.max(depths.get(previous), depths.get(next));
    if (tip && distance(tip, corner) <= reach)
      region.push([corner, add(corner, a), tip, add(corner, b)]);
  });
  return region;
}

/** How deep the wall bound to an edge is: its row's, a cap's source wall's; 0 when unknown. */
function depthOf(floor, room, edge) {
  const thickness = (wallId, segmentId) => {
    const wall = floor.walls.find((entry) => entry.id === wallId);
    const segment = wall?.segments.find((entry) => !segmentId || entry.id === segmentId);
    const value = segment && buildingPlanSegmentThickness(wall, segment);
    return finite(value) ? value : 0;
  };
  for (const face of room.faces)
    if (!face.freePath)
      for (const binding of face.bindings || [])
        if (binding.edgeId === edge.id) return thickness(face.wallId, binding.segmentId);
  return edge.profile ? thickness(edge.profile.wallId) : 0;
}

/** Where the line through `p` along `u` meets the one through `q` along `v`. */
function mitre(p, u, q, v) {
  const det = cross(u, v);
  if (Math.abs(det) <= GEOMETRY_EPSILON) return null;
  return add(p, multiply(u, cross(subtract(q, p), v) / det));
}

function overlaps(a, b) {
  const box = (points) => {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  const [ax0, ax1, ay0, ay1] = box(a);
  const [bx0, bx1, by0, by1] = box(b);
  return ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1;
}
