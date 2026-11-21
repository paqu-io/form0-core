/**
 * Floors in level order, for display (the Floors list, the canvas's floor tabs; 2026-11-21): by
 * story elevation, low to high, floors without one last; ties by name (land survey, basement,
 * ground floor, mezzanine, upper floor, roof, any other name), then by the number an upper or
 * basement floor carries, then as added. The stored row order is left as it is.
 */

const NAME_RANK = {
  land_survey: 0,
  basement: 1,
  ground_floor: 2,
  mezzanine: 3,
  upper_floor: 4,
  roof: 5,
};
const OTHER_RANK = 6;
const NUMBER_FIELDS = { upper_floor: 'floor_upper_number', basement: 'floor_basement_number' };

const numberOr = (value, fallback) =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value);

/**
 * @template T
 * @param {T[]} floors
 * @param {(floor: T, originalDataName: string) => unknown} read a value of a floor, by the
 *   field's original data name (`floor_elevation`, `floor_name`, …)
 * @returns {T[]} a sorted copy
 */
export function buildingPlanFloorsByLevel(floors, read) {
  const keyed = (floors || []).map((floor, index) => {
    const name = read(floor, 'floor_name')?.choice?.[0]?.value;
    const numberField = NUMBER_FIELDS[name];
    return {
      floor,
      index,
      elevation: numberOr(read(floor, 'floor_elevation'), Infinity),
      rank: NAME_RANK[name] ?? OTHER_RANK,
      number: numberField ? numberOr(read(floor, numberField), 0) : 0,
    };
  });
  keyed.sort(
    (a, b) =>
      (a.elevation === b.elevation ? 0 : a.elevation < b.elevation ? -1 : 1) ||
      a.rank - b.rank ||
      a.number - b.number ||
      a.index - b.index
  );
  return keyed.map((entry) => entry.floor);
}
