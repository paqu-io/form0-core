import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingPlanFloorsByLevel } from '../src/index.js';

const floor = (id, name, elevation, numbers = {}) => ({
  id,
  values: {
    floor_name: name ? { choice: [{ value: name, label: name }] } : null,
    floor_elevation: elevation,
    ...numbers,
  },
});
const order = (floors) =>
  buildingPlanFloorsByLevel(floors, (entry, name) => entry.values[name]).map((entry) => entry.id);

test('floors in level order: by story elevation, ties by name and number, then as added', () => {
  const floors = [
    floor('roof', 'roof', 9),
    floor('upper2', 'upper_floor', 6, { floor_upper_number: 2 }),
    floor('ground', 'ground_floor', 0),
    floor('basement1', 'basement', -3, { floor_basement_number: -1 }),
    floor('land', 'land_survey', 0),
    floor('mezzanine', 'mezzanine', 1.5),
    floor('basement2', 'basement', -6, { floor_basement_number: -2 }),
    floor('upper1', 'upper_floor', 3, { floor_upper_number: 1 }),
  ];
  assert.deepEqual(order(floors), [
    'basement2',
    'basement1',
    'land',
    'ground',
    'mezzanine',
    'upper1',
    'upper2',
    'roof',
  ]);
});

test('a floor without an elevation comes last; equal ones by name, number, then as added', () => {
  const floors = [
    floor('new', null, null),
    floor('upper2', 'upper_floor', 3, { floor_upper_number: 2 }),
    floor('upper1', 'upper_floor', 3, { floor_upper_number: 1 }),
    floor('other', null, 3),
    floor('ground', 'ground_floor', ''),
  ];
  // An empty elevation is no elevation (not 0): the ground floor here has none yet.
  assert.deepEqual(order(floors), ['upper1', 'upper2', 'other', 'ground', 'new']);
  const input = floors.map((entry) => entry.id);
  assert.deepEqual(
    floors.map((entry) => entry.id),
    input,
    'the floors keep their own order'
  );
});
