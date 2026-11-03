export const BUILDING_PLAN_EDITING_DEFAULTS = Object.freeze({
  preserveWallGrouping: false,
  snapping: true,
  edgeAutoPan: true,
});

/** Editor preferences govern future operations; they are never physical answers. */
export function normalizeBuildingPlanEditingPolicy(policy = {}) {
  const result = { ...BUILDING_PLAN_EDITING_DEFAULTS };
  for (const key of Object.keys(result)) {
    if (policy[key] === undefined) continue;
    if (typeof policy[key] !== 'boolean') throw new TypeError(`${key} must be boolean.`);
    result[key] = policy[key];
  }
  return result;
}
