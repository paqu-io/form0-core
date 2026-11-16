import { equalValue, own } from '../model.js';
import { resolutionFloor, resolveWallThickness } from './thickness.js';

const roomsKey = (ids) => [...new Set((ids || []).filter(Boolean))].sort().join('|');

/** The rooms a subject faced before the edit: its stored wall's, or its division source's. */
export function previousRoomsOf(context, subjectId) {
  const rooms = context.primary.previousRooms;
  return rooms?.get(subjectId) ?? rooms?.get(context.children.get(subjectId)) ?? null;
}

/** Whether a piece faces other rooms than its subject's wall faced before the edit. */
export function roomsChanged(context, subjectId, piece) {
  const before = previousRoomsOf(context, subjectId);
  return before != null && roomsKey(before) !== roomsKey(piece.roomIds);
}

/**
 * Option b2 of the 2026-11-16 web retest: an answer the shared-value question chose
 * (`sharedChoices`, per property) only holds while the wall faces the rooms it was chosen
 * between. When a piece faces other rooms (a room detached, moved, resized or removed), the answer
 * is released and the piece follows its room again. A chosen thickness is released only when it
 * equals the inherited one: a detach must not change the width of a wall nobody edits (R1).
 * Answers a person typed carry no marker and are never released. Runs after divisions, before
 * joins.
 */
export function releaseSharedChoices(context, specifications) {
  const floor = resolutionFloor(context.primary);
  for (const piece of context.pieces)
    for (const { subjectId } of piece.anchored || []) {
      const subject = context.subjects.get(context.resolve(subjectId));
      if (!subject?.sharedChoices?.length || !roomsChanged(context, subject.id, piece)) continue;
      for (const property of subject.sharedChoices) {
        if (!own(subject.overrides, property)) continue;
        if (property === 'wall_thickness') {
          const { wall_thickness: value, ...others } = subject.overrides;
          const inherited = resolveWallThickness(
            floor,
            specifications,
            { ...subject, overrides: others },
            piece.roomIds
          ).value;
          if (!equalValue(inherited, value)) continue;
        }
        delete subject.overrides[property];
      }
      delete subject.sharedChoices;
    }
}

/**
 * Before two subjects merge: returns a function to call after the merge that keeps the marks of
 * values the survivor received from the other subject (`mergeWallAnswers` copies an own value the
 * survivor lacked).
 */
export function carrySharedChoices(survivor, other) {
  const ownBefore = new Set(Object.keys(survivor.overrides || {}));
  return () => {
    const carried = (other.sharedChoices || []).filter(
      (key) => !ownBefore.has(key) && own(survivor.overrides, key)
    );
    if (!carried.length) return;
    survivor.sharedChoices = [...new Set([...(survivor.sharedChoices || []), ...carried])];
  };
}
