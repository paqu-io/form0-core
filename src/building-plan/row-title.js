/**
 * The field that names a row of each BuildingPlan node. The expander turns it into the node's
 * `title_field`, so plan rows get their titles the generic way (`resolveDatasetRowTitle`).
 */
export const BUILDING_PLAN_TITLE_FIELDS = {
  floors: 'floor_name',
  rooms: 'room_name',
  walls: 'wall_label',
  physical_walls: 'wall_label',
  doors: 'door_label',
  face_doors: 'door_label',
  windows: 'window_label',
  face_windows: 'window_label',
  wall_beams: 'wall_beam_identifier',
  face_beams: 'wall_beam_identifier',
  columns: 'column_identifier',
  beams: 'beam_identifier',
  objects: 'object_name',
};

const text = (value) => {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  const first = value?.other?.[0] ?? value?.choice?.[0];
  return first?.label ?? first?.value ?? null;
};

// A floor named "Upper floor" or "Basement floor" asks for its number (2026-11-21).
const FLOOR_NUMBERS = { upper_floor: 'floor_upper_number', basement: 'floor_basement_number' };

/**
 * A floor's name with the number its name asks for, as entered: "Upper floor 2", "Basement
 * floor -1"; other names as they are. Only the plan's own titles use it (list rows, the entry's
 * header, the canvas's floor tabs); a record's stored title stays its `title_field`'s.
 * @param {(originalDataName: string) => unknown} read a value of the floor, by original name
 * @returns {string | null}
 */
export function buildingPlanFloorTitle(read) {
  const value = read('floor_name');
  const name = text(value);
  if (!name) return null;
  const field = FLOOR_NUMBERS[value?.choice?.[0]?.value];
  const number = field ? read(field) : null;
  return number == null || number === '' || !Number.isFinite(Number(number))
    ? name
    : `${name} ${number}`;
}

/**
 * A BuildingPlan row's own name for locations such as validation lists: "Ground floor", "Room 2",
 * "W3", "Door 1", "C1" (2026-11-16). `null` for rows of other repeatables or without a name.
 *
 * @param {{ metadata: object[], repeatableKey: string, row: object | null | undefined }} input
 * @returns {string | null}
 */
export function buildingPlanRowTitle({ metadata = [], repeatableKey, row }) {
  for (const meta of metadata)
    for (const node of meta.repeatables || []) {
      if (node.preferredKey !== repeatableKey && node.dataName !== repeatableKey) continue;
      const read = (name) => {
        const field = node.fieldsByOriginalDataName?.[name];
        return field ? row?.values?.[field.dataName] : undefined;
      };
      if (node.nodeKey === 'floors') return buildingPlanFloorTitle(read);
      return text(read(BUILDING_PLAN_TITLE_FIELDS[node.nodeKey]));
    }
  return null;
}
