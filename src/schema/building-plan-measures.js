/**
 * What each BuildingPlan system dimension measures. Values are always stored in metres; the
 * presentation shows a length in m or ft and a thickness in mm or in, by the form's
 * `measurement_system`, and puts that unit in the field's label. Every numeric system field a
 * person reads or types is listed here or in BUILDING_PLAN_UNITLESS_FIELDS
 * (tests/building-plan-measures.test.js checks it).
 */
export const BUILDING_PLAN_MEASURES = Object.freeze({
  floor_elevation: 'length',
  floor_height: 'length',
  floor_interior_wall_thickness: 'thickness',
  floor_interior_wall_plaster_thickness: 'thickness',
  floor_exterior_wall_thickness: 'thickness',
  floor_exterior_wall_plaster_thickness: 'thickness',
  room_elevation: 'length',
  room_structural_clear_height: 'length',
  wall_height: 'length',
  wall_thickness: 'thickness',
  wall_plaster_thickness: 'thickness',
  wall_plaster_thickness_outside: 'thickness',
  door_width: 'length',
  door_height: 'length',
  door_offset: 'length',
  window_width: 'length',
  window_height: 'length',
  window_distance_from_floor: 'length',
  window_offset: 'length',
  // A column's and a beam's cross-section in mm or in, like a wall's thickness (2026-11-20).
  column_width: 'thickness',
  column_depth: 'thickness',
  column_height: 'length',
  beam_width: 'thickness',
  beam_depth: 'thickness',
  beam_length: 'length',
  beam_distance_from_floor: 'length',
  // Wall beams (2026-11-24): along the wall and their height in m, the cross-section in mm.
  wall_beam_offset: 'length',
  wall_beam_length: 'length',
  wall_beam_distance_from_floor: 'length',
  wall_beam_width: 'thickness',
  wall_beam_depth: 'thickness',
});

/** Numeric system fields that are counts, not dimensions. */
export const BUILDING_PLAN_UNITLESS_FIELDS = Object.freeze([
  'floor_upper_number',
  'floor_basement_number',
]);
