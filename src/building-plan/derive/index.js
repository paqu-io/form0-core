/**
 * Derived BuildingPlan core (redesign step 2). It runs alongside the current engine and is not
 * wired into any session: walls are computed from room geometry, explicit cuts and wall subjects.
 */
import { extractBuildingPlanPrimary } from './extract.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { derivePartitionPieces } from './partitions.js';

/**
 * @param {Object} floor A stored floor (current snapshot format).
 * @param {Object} specifications Session property specifications.
 * @returns {{pieces: Array<Object>, caps: Array<Object>, issues: Array<Object>}}
 */
export function deriveBuildingPlanFloor(floor, specifications) {
  const primary = extractBuildingPlanPrimary(floor);
  const boundary = deriveBuildingPlanPieces(primary, specifications);
  const partitions = derivePartitionPieces(primary, specifications);
  return {
    pieces: [...boundary.pieces, ...partitions.pieces],
    caps: boundary.caps,
    issues: [...boundary.issues, ...partitions.issues],
  };
}

export { extractBuildingPlanPrimary };
