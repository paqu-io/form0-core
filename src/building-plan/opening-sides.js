import { cleanLength as clean, distance } from './geometry.js';
import { own } from './model.js';
import { spanOf, wallChildForType } from './wall-children.js';

/**
 * An opening's distance from the wall start as each room's copy shows it (WB3, 2026-11-24).
 *
 * An opening is stored once, on its physical wall, `offset` metres from its segment's start: the
 * left end seen from the room on the segment's side +1 (the reference row's room). A room on side
 * -1 sees the segment run the other way, so its copy counts from its own left end instead:
 * `length - offset - width`. Stored values, and so exported records, don't change; a value typed
 * in that room's copy converts back the same way.
 */

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Whether a room-facing row sees the segment run right to left (its room on side -1).
 * @param {{ bindings?: Array<{ segmentId: string, side: number }> } | null} face
 * @param {string} segmentId
 */
export function faceSeesSegmentReversed(face, segmentId) {
  return face?.bindings?.find((binding) => binding.segmentId === segmentId)?.side === -1;
}

/** An offset measured from the segment's other end; the same call converts it back. */
export function offsetFromOtherEnd(offset, width, length) {
  return clean(length - offset - width);
}

/**
 * @param {Array<{ id: string, start: object, end: object }>} segments
 * @param {string} segmentId
 * @returns {number | null}
 */
export function segmentLength(segments, segmentId) {
  const segment = (segments || []).find((entry) => entry.id === segmentId);
  return segment ? distance(segment.start, segment.end) : null;
}

/**
 * The offset a room's copy of a wall child shows, or the stored one when that room sees the
 * segment run left to right. `opening.width`: how far it reaches along the wall (a beam's length).
 */
export function offsetSeenFrom(face, opening, segments) {
  const length = segmentLength(segments, opening.segmentId);
  if (!faceSeesSegmentReversed(face, opening.segmentId) || length == null) return opening.offset;
  if (!finite(opening.offset) || !finite(opening.width)) return opening.offset;
  return offsetFromOtherEnd(opening.offset, opening.width, length);
}

/**
 * An `update_opening` typed in a room's copy, in stored terms. In a reversed copy the typed
 * distance (or, when only the width changes, the distance the room sees now) counts from that
 * room's left end, so the opening keeps it and grows to the right as that room sees it.
 * @param {object} command `update_opening`, changed in place
 * @param {{ opening: object, face: object | null, segments: Array<object> }} context
 * @returns {object} the command
 */
export function storedOpeningEdit(command, { opening, face, segments }) {
  const child = wallChildForType(opening.type);
  const spanKey = child?.spanKey || 'width';
  if (!own(command, 'offset') && !own(command, spanKey)) return command;
  if (!faceSeesSegmentReversed(face, opening.segmentId)) return command;
  const length = segmentLength(segments, opening.segmentId);
  const span = own(command, spanKey) ? command[spanKey] : spanOf(opening);
  const seen = own(command, 'offset')
    ? command.offset
    : offsetSeenFrom(face, { ...opening, width: spanOf(opening) }, segments);
  if (length == null || !finite(span) || !finite(seen)) return command;
  command.offset = offsetFromOtherEnd(seen, span, length);
  const key = child?.offset || `${opening.type}_offset`;
  if (command.values && own(command.values, key)) command.values[key] = command.offset;
  return command;
}
