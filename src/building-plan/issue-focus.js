/**
 * Where a host opens a validation issue that lies inside a BuildingPlan row. A row below a floor
 * (a room, a wall, a door…) is reached through its floor: the host opens the floor with
 * `focusPath`, and the floor's canvas opens the nested row, the way a double tap does. Opening the
 * nested row directly from the root skips the floor editor it belongs to (mobile round,
 * 2026-11-16).
 *
 * @param {{ metadata: object[], record: object, instancePath: object[] }} input
 * @returns {null | { floorDepth: number, focusPath: Array<{ key: string, index: number }> }}
 *   `null` when the issue is not below a floor; else the floor's depth in `instancePath` and the
 *   index path from the floor down to the issue's row.
 */
export function buildingPlanIssueFocus({ metadata = [], record, instancePath = [] }) {
  const floorKeys = new Set(
    metadata.map((meta) => meta.repeatablesByNodeKey?.floors?.preferredKey).filter(Boolean)
  );
  const floorDepth = instancePath.findIndex((part) => floorKeys.has(part.repeatableKey));
  if (floorDepth < 0 || floorDepth === instancePath.length - 1) return null;
  let row = record;
  const focusPath = [];
  for (const [depth, part] of instancePath.entries()) {
    const rows = row?.repeatable?.[part.repeatableKey] || [];
    const index =
      part.identity === 'id'
        ? rows.findIndex((item) => (item?.id ?? item?.record_id) === part.instanceId)
        : part.index;
    if (!(index >= 0) || !rows[index]) return null;
    row = rows[index];
    if (depth >= floorDepth) focusPath.push({ key: part.repeatableKey, index });
  }
  return { floorDepth, focusPath };
}
