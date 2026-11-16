import { BUILDING_PLAN_MEASURES } from '../schema/building-plan-measures.js';

const plainLabel = (field) => (field?.label || '').replace(/\s*[[(](?:m|mm)[\])]$/, '');
const round = (value, digits) => Number(value.toFixed(digits));

/** A value as a person reads it: metres and millimetres for dimensions, labels for choices. */
function formatValue(value, property) {
  if (value == null || value === '') return 'empty';
  if (typeof value === 'number') {
    const measure = BUILDING_PLAN_MEASURES[property];
    if (measure === 'thickness') return `${round(value * 1000, 0)} mm`;
    if (measure === 'length') return `${round(value, 3)} m`;
    return String(value);
  }
  if (typeof value === 'object') {
    const labels = [...(value.choice || value.choices || []), ...(value.other || [])].map(
      (entry) => entry.label ?? entry.value
    );
    return labels.length ? labels.join(', ') : 'empty';
  }
  return String(value);
}

const nameText = (value) =>
  typeof value === 'string'
    ? value
    : (value?.other?.[0]?.label ?? value?.choice?.[0]?.label ?? value?.choice?.[0]?.value);

/** Who gave a candidate value: a room's or floor's name, else its position. */
function sourceName(snapshot, id) {
  for (const floor of snapshot.floors) {
    if (floor.id === id) return nameText(floor.values?.floor_name) || 'the floor';
    const index = floor.rooms.findIndex((room) => room.id === id);
    if (index >= 0) return nameText(floor.rooms[index].values?.room_name) || `Room ${index + 1}`;
    for (const wall of floor.walls)
      for (const side of wall.sides || [])
        if (side.id === id) {
          const room = floor.rooms.find((entry) => entry.id === side.roomId);
          return room ? nameText(room.values?.room_name) || 'a room' : 'the outside';
        }
  }
  return 'another source';
}

/** A room's position on its floor (1-based), for telling rooms with the same name apart. */
function roomNumber(snapshot, id) {
  for (const floor of snapshot.floors) {
    const index = floor.rooms.findIndex((room) => room.id === id);
    if (index >= 0) return index + 1;
  }
  return null;
}

/** A wall's name; its automatic label when the typed one is still being chosen. */
function wallName(snapshot, id, typed = true) {
  for (const floor of snapshot.floors)
    for (const wall of floor.walls)
      if (wall.id === id || (wall.sides || []).some((side) => side.id === id))
        return (typed && wall.values?.wall_label) || wall.autoLabel || null;
  return null;
}

const listed = (names) =>
  names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

function specificationFor(specifications, key) {
  const entries = Object.values(specifications).filter((entry) => entry.property === key);
  return entries.find((entry) => entry.nodeKey === 'walls') || entries[0];
}

/** What a difference is about, as a person reads it: the field, and the side for a surface. */
function entryLabel(entry, choice, snapshot, specifications) {
  const field =
    plainLabel(specificationFor(specifications, entry.key)?.field) ||
    (entry.key === 'wall_label' ? 'Wall label' : entry.key);
  if (entry.kind !== 'side') return field;
  let roomId = null;
  for (const floor of snapshot.floors)
    for (const wall of floor.walls)
      if (wall.id === choice.subjectId)
        roomId = wall.sides.find((side) => side.id === entry.sideId)?.roomId ?? null;
  return roomId ? `${field} on ${sourceName(snapshot, roomId)}'s side` : `${field} on the outside`;
}

/**
 * Who each option stands for: a room (with its position when two rooms share a name), or a wall
 * for a rejoin. `rooms` are the room names alone; `names` add the wall when one room gives two
 * sets of values (two of its walls join one).
 */
function optionNames(choice, snapshot) {
  if (choice.origin === 'rejoin') {
    const names = choice.options.map((option, index) => option.label || `portion ${index + 1}`);
    return { names, rooms: names };
  }
  const base = choice.options.map((option) => sourceName(snapshot, option.id));
  const rooms = base.map((name, index) => {
    const { id } = choice.options[index];
    const clash = choice.options.some(
      (other, at) => at !== index && base[at] === name && other.id !== id
    );
    const number = clash ? roomNumber(snapshot, id) : null;
    return number ? `${name} (room ${number})` : name;
  });
  const names = rooms.map((name, index) => {
    const { id, label } = choice.options[index];
    const twin = choice.options.some((other, at) => at !== index && other.id === id);
    return label && twin ? `${name} (${label})` : name;
  });
  return { names, rooms };
}

/**
 * The question for values that walls give differently before an edit is accepted (see
 * `shared-value-choices.js`), in words a person reads: which wall, which rooms or portions, the
 * fields' labels and the values with units. One difference keeps the wording decided on
 * 2026-11-16; several are summarised in one question with one choice of whose values apply, and
 * a mixed result is edited on the wall afterwards. English for now, as every BuildingPlan question
 * (translating them is a recorded follow-up).
 */
export function sharedValueQuestion(choice, snapshot, specifications) {
  const { names, rooms } = optionNames(choice, snapshot);
  const fields = choice.entries.map((entry) => entryLabel(entry, choice, snapshot, specifications));
  const format = (index, at) =>
    formatValue(choice.options[index].values[at], choice.entries[at].key);
  const rejoin = choice.origin === 'rejoin';
  const labelChosen = choice.entries.some(
    (entry) => entry.kind === 'answer' && entry.key === 'wall_label'
  );
  const wall = wallName(snapshot, choice.subjectId, !labelChosen);
  const subject = rejoin
    ? listed(names)
    : `${wall ? `Wall ${wall}` : 'This wall'} is shared by ${listed([...new Set(rooms)])}, which`;
  const cancel = { id: 'cancel', label: rejoin ? 'Cancel rejoin' : 'Cancel edit' };
  if (choice.entries.length === 1)
    return {
      title: rejoin ? 'Rejoin: choose one value' : 'Shared wall: choose one value',
      message: rejoin
        ? `${subject} have different values for ${fields[0]}. Choose the one the rejoined wall keeps; you can still change it on the wall later.`
        : `${subject} give different values for ${fields[0]}. Choose the one that applies to this wall; you can still change it on the wall later.`,
      buttons: [
        ...names.map((name, index) => ({
          id: `candidate:${index}`,
          label: `${name}: ${format(index, 0)}`,
        })),
        cancel,
      ],
    };
  const differences = fields
    .map(
      (field, at) =>
        `${field} (${names.map((name, index) => `${name} ${format(index, at)}`).join(', ')})`
    )
    .join('; ');
  return {
    title: rejoin
      ? 'Rejoin: choose which values to keep'
      : 'Shared wall: choose whose values apply',
    message: rejoin
      ? `${subject} have different values: ${differences}. Choose which values the rejoined wall keeps; you can still change each one on the wall later.`
      : `${subject} give different values: ${differences}. Choose whose values apply to this wall; you can still change each one on the wall later.`,
    buttons: [
      ...names.map((name, index) => ({ id: `candidate:${index}`, label: `${name}'s values` })),
      cancel,
    ],
  };
}
