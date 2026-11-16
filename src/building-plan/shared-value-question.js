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

function wallName(snapshot, id) {
  for (const floor of snapshot.floors)
    for (const wall of floor.walls)
      if (wall.id === id || (wall.sides || []).some((side) => side.id === id))
        return wall.values?.wall_label || wall.autoLabel || null;
  return null;
}

/**
 * The question for a value that rooms sharing a wall give differently (conflicting_room_defaults),
 * in words a person reads: which wall, which rooms, the field's label and the values with units.
 * English for now, as every BuildingPlan question (translating them is a recorded follow-up).
 */
export function sharedValueQuestion(conflict, snapshot, specifications) {
  const specification = Object.values(specifications).find(
    (entry) => entry.property === conflict.property
  );
  const field = plainLabel(specification?.field) || conflict.property;
  const wall = wallName(snapshot, conflict.subject.id);
  const names = conflict.candidates.map((candidate) => sourceName(snapshot, candidate.id));
  // Two rooms may share a name (two "Bedroom"s): add their position on the floor.
  const sources = names.map((name, index) => {
    const id = conflict.candidates[index].id;
    const clash = conflict.candidates.some((other, at) => names[at] === name && other.id !== id);
    const number = clash ? roomNumber(snapshot, id) : null;
    return number ? `${name} (room ${number})` : name;
  });
  const shared = [...new Set(sources)].join(' and ');
  return {
    title: 'Shared wall: choose one value',
    message: `${wall ? `Wall ${wall}` : 'This wall'} is shared by ${shared}, which give different values for ${field}. Choose the one that applies to this wall; you can still change it on the wall later.`,
    buttons: [
      ...conflict.candidates.map((candidate, index) => ({
        id: `candidate:${index}`,
        label: `${sources[index]}: ${formatValue(candidate.value, conflict.property)}`,
      })),
      { id: 'cancel', label: 'Cancel edit' },
    ],
  };
}
