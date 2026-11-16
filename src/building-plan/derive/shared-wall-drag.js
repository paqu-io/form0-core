import { GAP_TOLERANCE } from './grid.js';
import { resolveWallThickness } from './thickness.js';
import { keepOpeningsWithStationaryRooms } from './room-commands.js';

/** Widening limit when the form's thickness field sets no maximum (decision F7). */
export const SHARED_WALL_WIDEN_LIMIT = 0.7;

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};

/** The policy for this drag: the operation's own choice, else the session's editing policy. */
export function sharedWallMode(operation, editingPolicy = {}) {
  const mode = operation.sharedWallDrag ?? editingPolicy.sharedWallDrag ?? 'widen';
  if (!['widen', 'move_wall'].includes(mode))
    refuse('invalid_editing_policy', 'sharedWallDrag must be widen or move_wall.');
  return mode;
}

/**
 * `widen` for a drag away from the neighbour (decision R1, F7). The neighbour keeps its face and
 * the wall widens by the drag, up to the limit (the thickness field's `max`, else 0.7 m). Past the
 * limit the face holds there, until the gap reaches the larger of the limit and both rooms' own
 * exterior walls side by side; then the room detaches. A wall already at or above the limit does
 * not widen: it holds, then detaches the same way.
 *
 * @returns {{kind: 'widen'|'hold'|'detach', distance: number, width?: number}} `distance` along
 *   the dragged room's outward normal (negative: away from the neighbour).
 */
export function widenPlan(primary, floor, specifications, { subjectId, roomIds, width, distance }) {
  const field = specifications?.wall_thickness?.field;
  const limit = Number.isFinite(field?.max) && field.max > 0 ? field.max : SHARED_WALL_WIDEN_LIMIT;
  const subject = primary.subjects.get(subjectId) || null;
  const exterior = (roomId) =>
    resolveWallThickness(floor, specifications, subject, [roomId, null]).value || 0;
  const detachAt = Math.max(limit, exterior(roomIds[0]) + exterior(roomIds[1]));
  const gap = width - distance;
  if (gap >= detachAt - GAP_TOLERANCE) return { kind: 'detach', distance };
  if (gap <= limit + GAP_TOLERANCE && width < limit - GAP_TOLERANCE)
    return { kind: 'widen', distance, width: gap };
  const held = Math.max(width, limit);
  return { kind: 'hold', distance: width - held, width: held };
}

/**
 * After a detach the room that stays keeps the wall: its row becomes the wall's reference (side
 * signs turned over to match) and the openings on the moved room's row move to it.
 */
export function keepWallWithStationaryRoom(primary, subjectId, movedRoomId, stayingRoomId) {
  const subject = primary.subjects.get(subjectId);
  const reference = primary.anchors.find((anchor) => anchor.faceId === subject?.referenceFaceId);
  keepOpeningsWithStationaryRooms(primary, movedRoomId, [subjectId]);
  if (!subject || reference?.roomId !== movedRoomId) return;
  const row = primary.anchors.find(
    (anchor) => anchor.subjectId === subjectId && anchor.roomId === stayingRoomId
  );
  if (!row) return;
  subject.referenceFaceId = row.faceId;
  for (const side of subject.sides || []) side.sign *= -1;
}
