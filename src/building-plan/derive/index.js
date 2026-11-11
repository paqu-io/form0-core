/**
 * Derived BuildingPlan core (redesign step 3). It runs alongside the current engine and is not
 * wired into any session: walls are computed from room geometry, explicit cuts and wall subjects,
 * and written back in the stored record shape.
 */
import { extractBuildingPlanPrimary } from './extract.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { derivePartitionPieces } from './partitions.js';

/**
 * @param {Object} primary Primary data (see `extractBuildingPlanPrimary`).
 * @param {Object} specifications Session property specifications.
 * @returns {{pieces: Array<Object>, caps: Array<Object>, lines: Array<Object>,
 *   issues: Array<Object>}}
 */
export function deriveBuildingPlanPrimary(primary, specifications) {
  const boundary = deriveBuildingPlanPieces(primary, specifications);
  const partitions = derivePartitionPieces(primary, specifications);
  return {
    pieces: [...boundary.pieces, ...partitions.pieces],
    caps: boundary.caps,
    lines: boundary.lines,
    issues: [...boundary.issues, ...partitions.issues],
  };
}

/**
 * @param {Object} floor A stored floor (current snapshot format).
 * @param {Object} specifications Session property specifications.
 */
export function deriveBuildingPlanFloor(floor, specifications) {
  return deriveBuildingPlanPrimary(extractBuildingPlanPrimary(floor), specifications);
}

export { extractBuildingPlanPrimary };
