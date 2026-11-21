/**
 * Where a room face's line reaches with the caps next to it (2026-11-21, after the 4b hand test).
 * A cap is an edge of the room with no row whose material its wall supplies (rule F4, the edge's
 * `profile`): at a room's inner corner, the face of a wall shared with another room runs on past
 * that room's corner, and that stretch is a cap. The canvas draws a selected wall over it, so its
 * highlight reaches the room's corner. Metres; the record is unchanged.
 */

/** How near the face's end a cap starts (a binding can end a few micrometres short). */
const NEAR_M = 1e-4;

const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const unit = (from, to) => {
  const length = gap(from, to);
  return length > 0 ? { x: (to.x - from.x) / length, y: (to.y - from.y) / length } : null;
};

/**
 * @param {object} room the stored room (vertices, edges with their profiles, faces)
 * @param {object} face one of its rows (a room wall's; a free wall's has no caps)
 * @param {Array<{ x: number, y: number }>} points the face's line, in metres
 * @returns {Array<{ x: number, y: number }> | null} the line over its caps, or null when none
 */
export function faceExtent(room, face, points) {
  if (face.freePath || points.length < 2) return null;
  const bound = new Set(
    (room.faces || []).flatMap((entry) => (entry.bindings || []).map((binding) => binding.edgeId))
  );
  const vertex = (id) => room.vertices.find((entry) => entry.id === id);
  const caps = (room.edges || []).filter(
    (edge) => edge.profile?.wallId === face.wallId && !bound.has(edge.id)
  );
  const line = points.map(({ x, y }) => ({ x, y }));
  let extended = false;
  for (let pass = 0; pass < 2; pass += 1)
    for (const edge of caps) {
      const ends = [vertex(edge.startId), vertex(edge.endId)];
      if (!ends.every(Boolean)) continue;
      for (const [near, far] of [ends, [...ends].reverse()])
        for (const atStart of [true, false]) {
          const end = atStart ? line[0] : line.at(-1);
          const next = atStart ? line[1] : line.at(-2);
          if (gap(near, end) > NEAR_M || gap(far, end) <= NEAR_M) continue;
          const [along, onward] = [unit(next, end), unit(end, far)];
          if (!along || !onward) continue;
          const cross = along.x * onward.y - along.y * onward.x;
          if (Math.abs(cross) > 1e-6 || along.x * onward.x + along.y * onward.y <= 0) continue;
          line[atStart ? 0 : line.length - 1] = { x: far.x, y: far.y };
          extended = true;
        }
    }
  return extended ? line : null;
}
