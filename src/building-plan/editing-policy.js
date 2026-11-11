export const BUILDING_PLAN_EDITING_DEFAULTS = Object.freeze({
  inheritedChangePolicy: 'apply',
  copyCustomAnswersAutomatically: false,
  snapping: true,
  edgeAutoPan: true,
  thicknessAnchor: 'room_face',
  // Dragging a room's side of a shared wall (derived core): `widen` moves the whole wall towards
  // the neighbour and widens it away from it; `move_wall` moves the whole wall both ways.
  sharedWallDrag: 'widen',
});

/** Editor preferences govern future operations; they are never physical answers. */
export function normalizeBuildingPlanEditingPolicy(policy = {}) {
  const result = { ...BUILDING_PLAN_EDITING_DEFAULTS };
  for (const key of Object.keys(result)) {
    if (policy[key] === undefined) continue;
    if (key === 'inheritedChangePolicy') {
      if (!['ask', 'apply'].includes(policy[key]))
        throw new TypeError('inheritedChangePolicy must be ask or apply.');
      result[key] = policy[key];
      continue;
    }
    if (key === 'sharedWallDrag') {
      if (!['widen', 'move_wall'].includes(policy[key]))
        throw new TypeError('sharedWallDrag must be widen or move_wall.');
      result[key] = policy[key];
      continue;
    }
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
