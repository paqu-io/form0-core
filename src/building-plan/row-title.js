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
      const field = node.fieldsByOriginalDataName?.[BUILDING_PLAN_TITLE_FIELDS[node.nodeKey]];
      return field ? text(row?.values?.[field.dataName]) : null;
    }
  return null;
}
