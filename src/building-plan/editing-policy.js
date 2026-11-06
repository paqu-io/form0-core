export const BUILDING_PLAN_EDITING_DEFAULTS = Object.freeze({
  preserveWallGrouping: false,
  snapping: true,
  edgeAutoPan: true,
  thicknessAnchor: 'room_face',
});

/** Editor preferences govern future operations; they are never physical answers. */
export function normalizeBuildingPlanEditingPolicy(policy = {}) {
  const result = { ...BUILDING_PLAN_EDITING_DEFAULTS };
  for (const key of Object.keys(result)) {
    if (policy[key] === undefined) continue;
    if (key === 'thicknessAnchor') {
      if (!['room_face', 'midline'].includes(policy[key]))
        throw new TypeError('thicknessAnchor must be room_face or midline.');
      result[key] = policy[key];
      continue;
    }
    if (typeof policy[key] !== 'boolean') throw new TypeError(`${key} must be boolean.`);
    result[key] = policy[key];
  }
  return result;
}
