import { GAP_TOLERANCE, SAME, along, offset, overlap, parallelTo } from './grid.js';
import { roomLines } from './room-lines.js';
import { sharedWallLimit, sharedWallMode } from './shared-wall-drag.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;
/** The direction a room line faces (out of its room). */
const facing = ({ frame, outward }) => ({
  x: frame.normal.x * outward,
  y: frame.normal.y * outward,
});

/**
 * How much of a drag away from the neighbour first returns the shared wall (the kept notch,
 * option 2). A push of a shared wall into its neighbour moves the neighbour's face; dragged back
 * in the same editor, the whole wall first moves back until the neighbour's face is where the
 * editor first saw it, then `widen` applies to the rest (F7 counts from there for the neighbour's
 * face, from the drag's start for the width).
 *
 * Where the editor first saw it: the earliest of the plans the editor went through (`entryFloors`:
 * the plan it opened on, then the plan after each change) in which the neighbour had this face. A
 * face an earlier push in the editor made, such as a notch's side, is found in the plan after that
 * push. The face is found by geometry, not by row identity (a push can divide the neighbour's
 * row): see `faceIn`.
 *
 * @param {Object} operation `resize_face`, `distance` negative for a drag away
 * @param {{stretch: Object, sharing: Array<Object>}} prepared the dragged stretch and the
 *   neighbours sharing it (`face-plans.js`)
 * @param {{entryFloors?: Array<Object>, editingPolicy?: Object, specifications?: Object}} context
 *   `entryFloors`: the stored floor in each plan the editor went through, earliest first (none
 *   outside an editor)
 * @returns {number} the distance to move the whole wall back (0: none)
 */
export function entryReturnDistance(operation, { stretch, sharing }, context) {
  const { entryFloors = [], editingPolicy, specifications } = context;
  if (!entryFloors.length || sharing.length !== 1 || operation.distance >= -SAME) return 0;
  if (sharedWallMode(operation, editingPolicy) !== 'widen') return 0;
  const follower = sharing[0];
  const widest = Math.max(sharedWallLimit(specifications), follower.width || 0);
  for (const floor of entryFloors) {
    const pushed = faceIn(floor, follower, stretch.roomId, widest);
    if (pushed == null) continue;
    return pushed <= SAME ? 0 : Math.min(pushed, -operation.distance);
  }
  return 0;
}

/**
 * The neighbour's face in one plan, as its distance outside the face now (towards the dragged
 * room), or null when that plan has none: the nearest line of the neighbour that faces the same
 * way as its face now, overlaps the shared stretch, lies on the dragged room's side of it, and
 * has a line of the dragged room facing it across a wall no wider than `widest`. The last
 * condition keeps another face of the neighbour that happens to lie within reach from counting.
 */
function faceIn(floor, follower, draggedRoomId, widest) {
  const now = follower.line.frame;
  const out = facing(follower.line);
  const outside = (point) => follower.line.outward * offset(now, point);
  const stations = ({ frame }) => [along(now, frame.start), along(now, frame.end)];
  const lines = (roomId) => {
    const room = floor.rooms?.find((entry) => entry.id === roomId);
    if (!room) return [];
    return roomLines(room).filter(({ frame }) => parallelTo(now, frame.start, frame.end));
  };
  const across = lines(draggedRoomId).filter((line) => dot(facing(line), out) < 0);
  let pushed = null;
  for (const line of lines(follower.roomId)) {
    if (dot(facing(line), out) <= 0) continue;
    const shared = overlap(stations(line), [follower.from, follower.to]);
    const distance = outside(line.frame.start);
    if (!shared || distance < -SAME || (pushed != null && distance >= pushed)) continue;
    const faced = across.some((other) => {
      const width = outside(other.frame.start) - distance;
      return width > SAME && width <= widest + GAP_TOLERANCE && overlap(stations(other), shared);
    });
    if (faced) pushed = distance;
  }
  return pushed;
}
