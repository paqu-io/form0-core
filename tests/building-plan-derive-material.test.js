import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { BUILDING_PLAN_PROPERTIES } from '../src/building-plan/model.js';
import { polygonArea } from '../src/building-plan/geometry.js';
import { buildingPlanFootprints } from '../src/building-plan/footprints.js';
import { deriveBuildingPlanFloor } from '../src/building-plan/derive/index.js';
import { deriveBuildingPlanMaterial } from '../src/building-plan/derive/material.js';

const area = (polygons) =>
  polygons.reduce((total, polygon) => total + Math.abs(polygonArea(polygon)), 0);

function fixture() {
  const example = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: example.snapshot,
    properties: example.meta.properties,
    createId: () => `material-${++serial}`,
  });
  const specifications = { ...BUILDING_PLAN_PROPERTIES, ...example.meta.properties };
  const apply = (operation) => {
    const result = session.apply({ floorId: example.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  };
  const floor = () => session.getSnapshot().floors[0];
  return { apply, floor, specifications };
}

/** Each wall's derived material has the area of today's footprint for that wall. */
function assertMaterialMatchesFootprints(floor, specifications) {
  const derived = deriveBuildingPlanFloor(floor, specifications);
  const { bySubject } = deriveBuildingPlanMaterial(floor, derived);
  for (const footprint of buildingPlanFootprints(floor, 1).wallFootprints) {
    const label = floor.walls.find((wall) => wall.id === footprint.id).autoLabel;
    const expected = area(footprint.polygons);
    const actual = area(bySubject.get(footprint.id) || []);
    assert.ok(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} m² instead of ${expected}`);
  }
  return bySubject;
}

test('derived material matches the footprints: bands, corner fills and the shared door', () => {
  const f = fixture();
  const bySubject = assertMaterialMatchesFootprints(f.floor(), f.specifications);
  for (const polygons of bySubject.values())
    for (const polygon of polygons) assert.ok(polygonArea(polygon) > 0, 'Counter-clockwise.');
});

test('derived material follows different exterior and interior thicknesses', () => {
  const f = fixture();
  f.apply({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness',
    value: 0.5,
  });
  assertMaterialMatchesFootprints(f.floor(), f.specifications);
});

test('a wall of unknown thickness has no material, as in the footprints', () => {
  const f = fixture();
  const exterior = f.floor().walls.find((wall) => wall.exposure === 'exterior');
  f.apply({ type: 'set_property', wallId: exterior.id, property: 'wall_thickness', value: null });
  const bySubject = assertMaterialMatchesFootprints(f.floor(), f.specifications);
  assert.equal(area(bySubject.get(exterior.id) || []), 0);
});

test('a partition keeps its material inside its room', () => {
  const f = fixture();
  f.apply({
    type: 'create_wall',
    roomId: f.floor().rooms[0].id,
    vertices: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ],
  });
  const bySubject = assertMaterialMatchesFootprints(f.floor(), f.specifications);
  const partition = f
    .floor()
    .walls.find((wall) => wall.sides[0].roomId && wall.sides[0].roomId === wall.sides[1].roomId);
  assert.ok(area(bySubject.get(partition.id) || []) > 0);
});
