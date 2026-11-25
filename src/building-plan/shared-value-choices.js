import { copyBuildingPlanData as copy } from './model.js';
import { writeBandChoice } from './derive/band-join-values.js';

/**
 * Choices the session asks before it accepts an edit (2026-11-16). Two sources report them, both
 * as `conflicting_room_defaults` issues:
 *
 * - the inheritance resolver: rooms give one property different values (`candidates`);
 * - the derived write-back: walls joining or rejoining hold different values (`entries` and
 *   `options`, several values at once; see `derive/value-choices.js`).
 *
 * Each becomes a choice `{ subjectId, origin, entries, options }`; choices of one subject whose
 * options name the same rooms merge, so a wall is asked once with every difference.
 */

/** Every subject a choice may name, with the wall it belongs to. */
function subjectsOf(snapshot) {
  return snapshot.floors.flatMap((floor) => [
    floor,
    ...floor.rooms,
    ...floor.rooms.flatMap((room) => [...room.columns, ...room.beams, ...room.objects]),
    ...floor.walls.flatMap((wall) => [wall, ...wall.sides, ...wall.doors, ...wall.windows]),
  ]);
}

const findSubject = (snapshot, id) => subjectsOf(snapshot).find((subject) => subject.id === id);

/** The room a candidate source stands for: a room, or the room of a wall side. */
function roomOf(snapshot, id) {
  for (const floor of snapshot.floors) {
    if (floor.rooms.some((room) => room.id === id)) return id;
    for (const wall of floor.walls)
      for (const side of wall.sides || []) if (side.id === id) return side.roomId ?? null;
  }
  return null;
}

function normalize(conflict, snapshot) {
  if (conflict.options)
    return {
      subjectId: conflict.subject.id,
      origin: conflict.origin || 'join',
      entries: conflict.entries,
      options: conflict.options.map((option) => ({
        ...option,
        room: option.id ?? null,
      })),
    };
  return {
    subjectId: conflict.subject.id,
    origin: 'rooms',
    entries: [{ kind: 'property', key: conflict.property }],
    options: conflict.candidates.map((candidate) => ({
      id: candidate.id,
      label: null,
      room: roomOf(snapshot, candidate.id),
      values: [candidate.value],
    })),
  };
}

/** Options name distinct rooms, the same in both choices: their values can be asked together. */
function mergeable(a, b) {
  if (a.subjectId !== b.subjectId || a.origin === 'rejoin' || b.origin === 'rejoin') return false;
  const rooms = (choice) => choice.options.map((option) => option.room);
  const [x, y] = [rooms(a), rooms(b)];
  return (
    x.every(Boolean) &&
    new Set(x).size === x.length &&
    x.length === y.length &&
    x.every((room) => y.includes(room))
  );
}

/**
 * The choices to ask, in the order reported, one per subject where their rooms allow.
 *
 * @param {Array<Object>} conflicts The edit's `conflicting_room_defaults` issues.
 * @param {Object} snapshot The candidate plan.
 * @returns {Array<{subjectId: string, origin: 'rooms'|'join'|'rejoin',
 *   entries: Array<Object>, options: Array<Object>}>}
 */
export function groupSharedValueChoices(conflicts, snapshot) {
  const choices = [];
  for (const conflict of conflicts) {
    const choice = normalize(conflict, snapshot);
    const target = choices.find((entry) => mergeable(entry, choice));
    if (!target) {
      choices.push(choice);
      continue;
    }
    target.entries = [...target.entries, ...choice.entries];
    if (choice.origin === 'join') target.origin = 'join';
    for (const option of target.options) {
      const other = choice.options.find((entry) => entry.room === option.room);
      option.values = [...option.values, ...other.values];
      if (!option.label && other.label) option.label = other.label;
    }
  }
  return choices;
}

function write(container, key, value) {
  if (value == null) delete container[key];
  else container[key] = copy(value);
}

/** Mark (or unmark) a wall property as chosen by the question; a typed value is never marked. */
function markChoice(wall, key, chosen) {
  const keys = new Set(wall.sharedChoices || []);
  if (chosen) keys.add(key);
  else keys.delete(key);
  if (keys.size) wall.sharedChoices = [...keys];
  else delete wall.sharedChoices;
}

/**
 * Apply the option a person chose to the candidate. A physical-wall property becomes the wall's
 * own value, marked as chosen (`sharedChoices`: released when the wall faces other rooms; typing
 * or resetting the value clears the mark) unless the option's value was typed on its wall.
 * Returns false when the subject or option is gone.
 */
export function applySharedValueChoice(snapshot, choice, index) {
  const owner = findSubject(snapshot, choice.subjectId);
  const option = choice.options[index];
  if (!owner || !option) return false;
  const isWall = Array.isArray(owner.segments) && Array.isArray(owner.sides);
  for (const [at, entry] of choice.entries.entries()) {
    const value = option.values[at];
    if (entry.kind === 'property') {
      write((owner.overrides ||= {}), entry.key, value);
      if (isWall) markChoice(owner, entry.key, value != null && option.marks?.[at] !== false);
    } else if (entry.kind === 'answer') write((owner.values ||= {}), entry.key, value);
    else if (entry.kind === 'band') {
      if (!isWall) return false;
      writeBandChoice(owner, entry, value, option.marks?.[at] === true);
    } else {
      const side = owner.sides?.find((candidate) => candidate.id === entry.sideId);
      if (!side) return false;
      write((side[entry.target] ||= {}), entry.key, value);
    }
  }
  return true;
}

/**
 * Re-deriving the candidate after an answer does not prepare join choices again (the walls are
 * already one): the unanswered ones, of other subjects that still exist, are asked next.
 */
export function carriedJoinChoices(before, answered, after, snapshot) {
  return before.filter(
    (conflict) =>
      conflict.options &&
      conflict.subject.id !== answered.subjectId &&
      findSubject(snapshot, conflict.subject.id) &&
      !after.some((entry) => entry === conflict)
  );
}
