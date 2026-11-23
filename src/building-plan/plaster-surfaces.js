import { buildingPlanSegmentThickness } from './model.js';

/**
 * Plaster surfaces (step 2, 2b; decisions D1 and D2, 2026-11-23): every visible face of a floor's
 * wall material, on a room's side or outside, with the plaster that finishes it. Display only:
 * the canvas draws them; nothing is stored.
 *
 * A surface is a stretch of a wall footprint's edge with no wall material and no opening beyond
 * it (room sides, outside faces, a free wall's faces, a cap's face, a wall's exposed end). It is
 * owned by the wall side whose face lies on it (a side's face: its segment's centreline, half the
 * thickness over on the side's sign). A stretch no side lies on takes the owner of the stretch it
 * continues: one in line first, then one of the same wall, then any next to it. So the plaster runs
 * on along each room's outline and the building's outline, round caps, corners and wall ends. A
 * free wall's free end is left bare: no owner, no plaster.
 *
 * Canvas units throughout (`gridSize` per metre); thicknesses in metres.
 */

/** @typedef {{ x: number, y: number }} Point */
/**
 * @typedef {{ from: Point, to: Point, normal: Point, wallId: string, sideId: string | null,
 *   roomId: string | null, own: boolean, thickness: number | null }} PlasterSurface
 *   `normal`: towards the open side; `wallId`: the owner's wall (else the footprint's);
 *   `roomId`: the owner side's room (null outside); `own`: the side's face lies on it
 */

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const len = (a) => Math.hypot(a.x, a.y);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const perp = (u) => ({ x: -u.y, y: u.x });

function inPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

/** A side's plaster thickness in metres, or null (not plastered, or no thickness). */
export function buildingPlanSidePlaster(side) {
  const status = side?.properties?.wall_plaster;
  const value = status?.choice?.[0]?.value ?? (typeof status === 'string' ? status : null);
  const thickness = side?.properties?.wall_plaster_thickness;
  return value === 'plastered' && typeof thickness === 'number' && thickness > 0 ? thickness : null;
}

// Each side's face, as a line: from its segment's start, along it, the side's way out.
function sideFaces(floor, gridSize) {
  const faces = [];
  for (const wall of floor.walls || [])
    for (const segment of wall.segments || []) {
      const thickness = buildingPlanSegmentThickness(wall, segment) * gridSize;
      if (!(thickness > 0)) continue;
      const start = mul(segment.start, gridSize);
      const along = sub(mul(segment.end, gridSize), start);
      const length = len(along);
      if (!(length > 0)) continue;
      const u = unit(along);
      for (const side of wall.sides || []) {
        const out = mul(perp(u), side.sign);
        faces.push({ wall, side, a: add(start, mul(out, thickness / 2)), u, n: out, length });
      }
    }
  return faces;
}

// The footprint edges' stretches with open space beyond (no wall material, no opening).
function openStretches(polygons, openings, faces, eps) {
  const solid = [...polygons.map((entry) => entry.points), ...openings];
  const stretches = [];
  for (const { wallId, points } of polygons)
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const q = points[(i + 1) % points.length];
      const length = len(sub(q, p));
      if (length < eps) continue;
      const u = unit(sub(q, p));
      let n = perp(u);
      const middle = mul(add(p, q), 0.5);
      if (inPolygon(add(middle, mul(n, eps)), points)) n = mul(n, -1);
      // Where what lies beyond can change: other corners on the line, and side faces' ends.
      const stations = [0, length];
      const onLine = (point) => {
        if (Math.abs(cross(u, sub(point, p))) > eps) return;
        const s = dot(sub(point, p), u);
        if (s > eps && s < length - eps) stations.push(s);
      };
      for (const polygon of solid) polygon.forEach(onLine);
      for (const face of faces) {
        onLine(face.a);
        onLine(add(face.a, mul(face.u, face.length)));
      }
      stations.sort((x, y) => x - y);
      for (let k = 0; k < stations.length - 1; k++) {
        const [s0, s1] = [stations[k], stations[k + 1]];
        if (s1 - s0 < eps) continue;
        const probe = add(add(p, mul(u, (s0 + s1) / 2)), mul(n, eps));
        if (solid.some((polygon) => inPolygon(probe, polygon))) continue;
        stretches.push({ from: add(p, mul(u, s0)), to: add(p, mul(u, s1)), u, normal: n, wallId });
      }
    }
  return stretches;
}

// Stretches of two polygons on one line, facing the same way, can overlap (a wall's band and the
// piece next to it): each part of the line is kept once.
function distinct(stretches, eps) {
  const kept = [];
  const done = new Set();
  for (const stretch of stretches) {
    if (done.has(stretch)) continue;
    const group = stretches.filter(
      (other) =>
        !done.has(other) &&
        dot(other.normal, stretch.normal) > 0.99 &&
        Math.abs(cross(stretch.u, sub(other.from, stretch.from))) <= eps
    );
    group.forEach((other) => done.add(other));
    const at = (point) => dot(sub(point, stretch.from), stretch.u);
    const spans = group.map((other) => {
      const [a, b] = [at(other.from), at(other.to)];
      return { other, lo: Math.min(a, b), hi: Math.max(a, b) };
    });
    const cuts = [...new Set(spans.flatMap((span) => [span.lo, span.hi]))].sort((x, y) => x - y);
    for (let k = 0; k < cuts.length - 1; k++) {
      const [lo, hi] = [cuts[k], cuts[k + 1]];
      if (hi - lo < eps) continue;
      const middle = (lo + hi) / 2;
      const cover = spans.find((span) => span.lo - eps <= middle && middle <= span.hi + eps);
      if (!cover) continue;
      // Along the first stretch's direction; the covering stretch's own way round.
      const ends = [
        stretch.from,
        add(stretch.from, mul(stretch.u, lo)),
        add(stretch.from, mul(stretch.u, hi)),
      ];
      const forward = dot(cover.other.u, stretch.u) > 0;
      kept.push({
        ...cover.other,
        from: forward ? ends[1] : ends[2],
        to: forward ? ends[2] : ends[1],
      });
    }
  }
  return kept;
}

// The side whose face lies on the stretch, facing the same way.
function ownerOf(stretch, faces, eps) {
  const middle = mul(add(stretch.from, stretch.to), 0.5);
  return (
    faces.find((face) => {
      if (Math.abs(cross(face.u, stretch.u)) > 1e-6 || dot(face.n, stretch.normal) < 0.99)
        return false;
      if (Math.abs(dot(sub(middle, face.a), face.n)) > eps) return false;
      const s = dot(sub(middle, face.a), face.u);
      return s > -eps && s < face.length + eps;
    }) || null
  );
}

const near = (a, b, eps) => len(sub(a, b)) <= eps;
const inLine = (a, b, eps) =>
  Math.abs(cross(a.u, b.u)) < 1e-6 && Math.abs(cross(a.u, sub(b.from, a.from))) <= eps;

/**
 * The plaster surfaces of a floor.
 * @param {object} floor the plan's floor (walls with their segments and resolved sides)
 * @param {{ footprints: Array<{ id: string, polygons: Point[][] }>,
 *   openings: Array<{ polygon: Point[] }>, gridSize: number }} options the canvas snapshot's
 *   footprints and openings (canvas units)
 * @returns {PlasterSurface[]}
 */
export function buildingPlanPlasterSurfaces(floor, { footprints, openings, gridSize }) {
  const eps = gridSize * 0.002;
  const polygons = (footprints || []).flatMap((entry) =>
    (entry.polygons || []).map((points) => ({ wallId: entry.id, points }))
  );
  const holes = (openings || []).map((opening) => opening.polygon).filter((p) => p?.length > 2);
  const faces = sideFaces(floor, gridSize);
  const stretches = distinct(openStretches(polygons, holes, faces, eps), eps).map((stretch) => {
    const face = ownerOf(stretch, faces, eps);
    return { ...stretch, owner: face && { wall: face.wall, side: face.side }, own: Boolean(face) };
  });
  // A free wall's free end has no plaster (2b hand test, 2026-11-23): it stays without an owner.
  const freeWalls = new Set(
    (floor.rooms || []).flatMap((room) =>
      (room.faces || []).filter((face) => face.freePath).map((face) => face.wallId)
    )
  );
  // D2: a stretch with no side of its own continues its neighbour's, in line first, then one of
  // the same wall, then any; passed on until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    for (const stretch of stretches) {
      if (stretch.owner || freeWalls.has(stretch.wallId)) continue;
      const touching = stretches.filter(
        (other) =>
          other !== stretch &&
          other.owner &&
          [other.from, other.to].some(
            (end) => near(end, stretch.from, eps) || near(end, stretch.to, eps)
          )
      );
      const next =
        touching.find((other) => inLine(stretch, other, eps)) ||
        touching.find((other) => other.wallId === stretch.wallId) ||
        touching[0];
      if (next) {
        stretch.owner = next.owner;
        changed = true;
      }
    }
  }
  return stretches.map((stretch) => ({
    from: stretch.from,
    to: stretch.to,
    normal: stretch.normal,
    wallId: stretch.owner?.wall.id ?? stretch.wallId,
    sideId: stretch.owner?.side.id ?? null,
    roomId: stretch.owner?.side.roomId ?? null,
    own: stretch.own,
    thickness: buildingPlanSidePlaster(stretch.owner?.side),
  }));
}
