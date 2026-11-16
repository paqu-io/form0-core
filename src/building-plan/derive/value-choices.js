import { copyBuildingPlanData as copy, equalValue, own } from '../model.js';

/** Thickness is decided by the geometry at a join (seating, the contact's width): never a choice. */
const GEOMETRIC = ['wall_thickness'];
const SIDE_TARGETS = ['overrides', 'values'];

/** No answer: null, empty text, an empty list or a choice answer without entries. */
export function isBlankValue(value) {
  if (value == null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object')
    return Object.values(value).every((entry) =>
      Array.isArray(entry) ? entry.length === 0 : entry == null
    );
  return false;
}

const answerOf = (container, key) =>
  container && own(container, key) && !isBlankValue(container[key]) ? container[key] : null;

/** The value a wall had for a physical-wall property before the edit: its own, else inherited. */
const effectiveValue = (subject, key) =>
  own(subject.overrides, key) ? subject.overrides[key] : (subject.properties?.[key] ?? null);

const differ = (values) => values.some((value) => !equalValue(value, values[0]));

/** The member side facing the same way as the survivor's side `sign`. */
const sideOf = (member, sign, direction) =>
  (member.subject.sides || []).find((side) => side.sign === sign * direction(member.subject));

/**
 * What differs between walls joining into one: a physical-wall property one of them answered
 * (values compared as each wall had them, own or inherited), a wall answer both gave differently,
 * or an answer on corresponding sides both gave differently. One wall's value against no value
 * (no answer, nothing inherited) is no difference: the value is kept, as before.
 */
export function joinDifferences(survivor, members, direction) {
  const entries = [];
  const subjects = members.map((member) => member.subject);
  const keys = (pick) => [...new Set(subjects.flatMap((subject) => Object.keys(pick(subject))))];
  for (const key of keys((subject) => subject.overrides || {})) {
    if (GEOMETRIC.includes(key) || !subjects.some((subject) => own(subject.overrides, key)))
      continue;
    const given = subjects
      .map((subject) => effectiveValue(subject, key))
      .filter((value) => !isBlankValue(value));
    if (given.length > 1 && differ(given)) entries.push({ kind: 'property', key });
  }
  for (const key of keys((subject) => subject.values || {})) {
    const given = subjects.map((subject) => answerOf(subject.values, key)).filter(Boolean);
    if (given.length > 1 && differ(given)) entries.push({ kind: 'answer', key });
  }
  for (const side of survivor.sides || [])
    for (const target of SIDE_TARGETS) {
      const sides = members.map((member) => sideOf(member, side.sign, direction));
      const names = [...new Set(sides.flatMap((entry) => Object.keys(entry?.[target] || {})))];
      for (const key of names) {
        const given = sides.map((entry) => answerOf(entry?.[target], key)).filter(Boolean);
        if (given.length > 1 && differ(given))
          entries.push({ kind: 'side', sideId: side.id, sign: side.sign, target, key });
      }
    }
  return entries;
}

/**
 * Whether a property value in an option counts as chosen by the question (`sharedChoices`): an
 * inherited value, or an own value a question chose earlier. A typed value stays typed, so a later
 * detach never releases it.
 */
const chosenMark = (subject, key) =>
  !own(subject.overrides, key) || Boolean(subject.sharedChoices?.includes(key));

function valueFor(member, entry, direction) {
  if (entry.kind === 'property') return copy(effectiveValue(member.subject, entry.key));
  if (entry.kind === 'answer') return copy(answerOf(member.subject.values, entry.key));
  return copy(answerOf(sideOf(member, entry.sign, direction)?.[entry.target], entry.key));
}

function write(container, key, value) {
  if (value == null) delete container[key];
  else container[key] = copy(value);
}

/**
 * Prepare a join whose walls differ (option a of the 2026-11-16 web retest): the survivor holds its
 * own values as placeholders and the other walls lose the differing answers, so the merge keeps
 * every other answer and refuses nothing for these. Returns the choice the session asks, one
 * option per distinct set of values (the survivor's first), or null when nothing differs.
 *
 * @param {Object} survivor The subject that survives the join.
 * @param {Array<{subject: Object, roomId: string|null, label: string|null}>} members Every
 *   joining subject, the survivor included.
 * @param {(subject: Object) => 1|-1} direction Whether a subject runs as the survivor (1) or
 *   opposite (-1), for matching sides.
 * @param {'join'|'rejoin'} origin `join` when the wall becomes shared by other rooms (options are
 *   named by room), `rejoin` when portions facing the same rooms become one (named by wall).
 * @returns {Object|null} A `conflicting_room_defaults` issue with `options`.
 */
export function prepareJoinChoice(survivor, members, direction, origin) {
  const entries = joinDifferences(survivor, members, direction);
  if (!entries.length) return null;
  const ordered = [
    members.find((member) => member.subject === survivor),
    ...members.filter((member) => member.subject !== survivor),
  ];
  const options = [];
  for (const member of ordered) {
    const values = entries.map((entry) => valueFor(member, entry, direction));
    if (options.some((option) => equalValue(option.values, values))) continue;
    const marks = entries.map(
      (entry) => entry.kind !== 'property' || chosenMark(member.subject, entry.key)
    );
    options.push({ roomId: member.roomId ?? null, label: member.label ?? null, values, marks });
  }
  for (const [index, entry] of entries.entries()) {
    const value = options[0].values[index];
    if (entry.kind === 'property') (survivor.overrides ||= {})[entry.key] = copy(value);
    else if (entry.kind === 'answer') write((survivor.values ||= {}), entry.key, value);
    else {
      const side = survivor.sides.find((candidate) => candidate.id === entry.sideId);
      write((side[entry.target] ||= {}), entry.key, value);
    }
    for (const member of ordered.slice(1)) {
      const { subject } = member;
      if (entry.kind === 'property') delete subject.overrides?.[entry.key];
      else if (entry.kind === 'answer') delete subject.values?.[entry.key];
      else delete sideOf(member, entry.sign, direction)?.[entry.target]?.[entry.key];
    }
  }
  return {
    code: 'conflicting_room_defaults',
    message: 'Choose which values apply to this wall; the joining walls give different values.',
    origin,
    subject: { type: 'walls', id: survivor.id },
    entries: entries.map(({ sign: _, ...entry }) => entry),
    options: options.map(({ roomId, label, values, marks }) => ({
      id: roomId,
      label,
      values,
      marks,
    })),
  };
}

const millimetres = (metres) => `${Math.round(metres * 1000)} mm`;

/**
 * Decision c3 (2026-11-16): at a join the geometry decides the thickness (the room was seated at
 * the contact's width). A joining wall whose own thickness differs from that width would make the
 * shared wall disagree with its gap, so the edit is refused in plain words. Item 5 asks before
 * seating instead. A width kept with "Keep previous values" (`explicitWidth`) wins as before.
 *
 * @param {{width: number, explicitWidth?: number}} piece The joined piece.
 * @param {Array<{subject: Object, label: string|null, roomName: string|null}>} members
 */
export function assertJoinThickness(piece, members) {
  if (piece.explicitWidth > 0 || !(piece.width > 0)) return;
  for (const { subject, label, roomName } of members) {
    const own = subject.overrides?.wall_thickness;
    if (!(own > 0) || Math.abs(own - piece.width) <= 1e-6) continue;
    const wall = [label ? `Wall ${label}` : 'A wall', roomName ? `of ${roomName}` : '']
      .filter(Boolean)
      .join(' ');
    const message = `${wall} has its own thickness (${millimetres(own)}), but the wall it joins is ${millimetres(piece.width)}. Set the same thickness on both walls or reset one, then try again.`;
    throw Object.assign(new Error(message), {
      issues: [
        {
          code: 'conflicting_wall_properties',
          message,
          subject: { type: 'wall', id: subject.id },
          property: 'wall_thickness',
          values: [own, piece.width],
        },
      ],
    });
  }
}
