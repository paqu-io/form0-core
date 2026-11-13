/**
 * Where a room's label goes: inside the room, well away from its edges. The search finds the point
 * farthest from the edges (the pole of inaccessibility, by quadtree search as in Mapbox's polylabel);
 * of the points it measured at least 85% as far, the one nearest the room's centre of area wins, so
 * a rectangle gives its centre and an L-shaped room a point on an arm, never on a wall or outside
 * the room. Units are the caller's (metres or canvas pixels).
 */
const NEAR_BEST = 0.85;
// Candidates per axis besides the search's own cells, so the choice near the centre is not
// limited to where the search refined.
const GRID = 20;

function inside(point, vertices) {
  let result = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}

function segmentDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Distance to the nearest edge: positive inside the room, negative outside. */
function signedDistance(point, vertices) {
  let nearest = Infinity;
  for (let i = 0; i < vertices.length; i++)
    nearest = Math.min(
      nearest,
      segmentDistance(point, vertices[i], vertices[(i + 1) % vertices.length])
    );
  return inside(point, vertices) ? nearest : -nearest;
}

const cell = (x, y, half, vertices) => {
  const distance = signedDistance({ x, y }, vertices);
  return { x, y, half, distance, potential: distance + half * Math.SQRT2 };
};

function centroidCell(vertices) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    const f = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * f;
    y += (a.y + b.y) * f;
    area += f * 3;
  }
  return area
    ? cell(x / area, y / area, 0, vertices)
    : cell(vertices[0].x, vertices[0].y, 0, vertices);
}

/**
 * The label point and the other candidates the search measured, nearest the centre of area first;
 * `precision`: when the search stops (default 1% of the larger extent).
 */
function labelPoint(vertices, precision) {
  const xs = vertices.map((point) => point.x);
  const ys = vertices.map((point) => point.y);
  const [minX, minY, maxX, maxY] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  const size = Math.min(maxX - minX, maxY - minY);
  if (!(size > 0)) {
    const point = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    return { point, candidates: [point] };
  }
  const tolerance = precision ?? Math.max(maxX - minX, maxY - minY) / 100;
  const queue = [];
  for (let x = minX; x < maxX; x += size)
    for (let y = minY; y < maxY; y += size)
      queue.push(cell(x + size / 2, y + size / 2, size / 2, vertices));
  const centre = centroidCell(vertices);
  const middle = cell((minX + maxX) / 2, (minY + maxY) / 2, 0, vertices);
  let best = middle.distance > centre.distance ? middle : centre;
  const seen = [centre, middle, ...queue];
  while (queue.length) {
    let index = 0;
    for (let i = 1; i < queue.length; i++)
      if (queue[i].potential > queue[index].potential) index = i;
    const next = queue.splice(index, 1)[0];
    if (next.distance > best.distance) best = next;
    if (next.potential - best.distance <= tolerance) continue;
    const half = next.half / 2;
    for (const [dx, dy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const child = cell(next.x + dx * half, next.y + dy * half, half, vertices);
      queue.push(child);
      seen.push(child);
    }
  }
  for (let i = 0; i < GRID; i++)
    for (let j = 0; j < GRID; j++)
      seen.push(
        cell(
          minX + ((i + 0.5) * (maxX - minX)) / GRID,
          minY + ((j + 0.5) * (maxY - minY)) / GRID,
          0,
          vertices
        )
      );
  const fromCentre = (entry) => Math.hypot(entry.x - centre.x, entry.y - centre.y);
  const candidates = seen
    .filter((entry) => entry.distance > 0)
    .sort((a, b) => fromCentre(a) - fromCentre(b));
  const point = candidates.find((entry) => entry.distance >= best.distance * NEAR_BEST) || best;
  return { point, candidates };
}

// Badge sizes tried, largest first, until the badge fits inside the room.
const SCALES = [1, 0.85, 0.7, 0.55, 0.4];

/** A rectangle centred at `point` lies inside the room: its corners inside, no room corner inside it. */
function badgeFits(vertices, point, width, height) {
  const [left, right, top, bottom] = [
    point.x - width / 2,
    point.x + width / 2,
    point.y - height / 2,
    point.y + height / 2,
  ];
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  return (
    corners.every((corner) => signedDistance(corner, vertices) >= 0) &&
    !vertices.some((v) => v.x > left && v.x < right && v.y > top && v.y < bottom)
  );
}

/**
 * Where a room's label badge goes and how large it can be.
 *
 * @param {Array<{x: number, y: number}>} vertices The room's outline.
 * @param {{width?: number, height?: number}} [badge] The badge's size at full scale, in the
 *   outline's units; without it the scale is 1.
 * @returns {{x: number, y: number, scale: number} | null} The badge's centre, and the largest of
 *   1, 0.85, 0.7, 0.55 and 0.4 at which it fits inside the room with a small margin (0.4 when
 *   none does).
 */
export function buildingPlanLabelPlacement(vertices, { width = 0, height = 0 } = {}) {
  if (!Array.isArray(vertices) || vertices.length < 3) return null;
  const { point, candidates } = labelPoint(vertices);
  // A margin of 15% of the badge's height keeps it off the walls.
  const [w, h] = [width + height * 0.3, height * 1.3];
  const largest = (at) => SCALES.findIndex((s) => badgeFits(vertices, at, w * s, h * s));
  let chosen = point;
  let index = largest(point);
  // Too large there: the candidate nearest the centre where the badge can be largest.
  for (const candidate of index === 0 ? [] : candidates) {
    const fit = largest(candidate);
    if (fit !== -1 && (index === -1 || fit < index)) [chosen, index] = [candidate, fit];
    if (index === 0) break;
  }
  return { x: chosen.x, y: chosen.y, scale: index === -1 ? SCALES.at(-1) : SCALES[index] };
}
