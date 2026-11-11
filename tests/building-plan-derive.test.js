import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  BUILDING_PLAN_PROPERTIES,
  createBuildingPlanSnapshot,
} from '../src/building-plan/model.js';
import { deriveBuildingPlanFloor } from '../src/building-plan/derive/index.js';
import { roomLines } from '../src/building-plan/derive/room-lines.js';
import { toGrid } from '../src/building-plan/derive/grid.js';
import { rotate } from './helpers/building-plan-derive.js';

const TOLERANCE = 3.1e-4;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function session(snapshot = createBuildingPlanExample().snapshot) {
  const example = createBuildingPlanExample();
  let serial = 0;
  const domain = createBuildingPlanSession({
    snapshot,
    properties: example.meta.properties,
    createId: () => `derive-${++serial}`,
  });
  const specifications = { ...BUILDING_PLAN_PROPERTIES, ...example.meta.properties };
  const apply = (operation) => {
    const result = domain.apply({ floorId: example.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  const floor = () => domain.getSnapshot().floors[0];
  return { domain, apply, floor, specifications, floorId: example.floorId };
}

/** Every stored wall has exactly one derived piece with its rooms, exposure, width and axis. */
function assertDerivedMatchesStored(floor, specifications) {
  const derived = deriveBuildingPlanFloor(floor, specifications);
  for (const wall of floor.walls) {
    const pieces = derived.pieces.filter((piece) => piece.subjectId === wall.id);
    assert.equal(pieces.length, 1, `${wall.autoLabel} derives one piece.`);
    const [piece] = pieces;
    assert.deepEqual(
      new Set(piece.roomIds),
      new Set(wall.sides.map((side) => side.roomId ?? null)),
      `${wall.autoLabel} rooms`
    );
    assert.equal(piece.exposure, wall.exposure, `${wall.autoLabel} exposure`);
    assert.equal(piece.thickness, wall.properties.wall_thickness_m, `${wall.autoLabel} thickness`);
    const [segment] = wall.segments;
    const gap = Math.min(
      Math.max(distance(segment.start, piece.axis.start), distance(segment.end, piece.axis.end)),
      Math.max(distance(segment.start, piece.axis.end), distance(segment.end, piece.axis.start))
    );
    assert.ok(gap <= TOLERANCE, `${wall.autoLabel} axis is ${gap} m away.`);
  }
  assert.equal(derived.pieces.filter((piece) => piece.subjectId == null).length, 0);
  return derived;
}

test('the grid rounds to 0.1 mm and room lines keep collinear stations and cuts', () => {
  assert.equal(toGrid(1.23456), 1.2346);
  assert.equal(toGrid(-0.00004), 0);
  const room = {
    id: 'r',
    vertices: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 0, editingCutId: 'cut' },
      { id: 'c', x: 4, y: 0 },
      { id: 'd', x: 4, y: 3 },
      { id: 'e', x: 0, y: 3 },
    ],
    edges: [],
  };
  const lines = roomLines(room);
  assert.equal(lines.length, 4);
  const south = lines.find((line) => line.edges.length === 2);
  assert.deepEqual(
    south.cuts.map((cut) => cut.station),
    [2]
  );
  assert.equal(south.outward, -1, 'Counter-clockwise rooms face outward against the normal.');
  assert.equal(roomLines({ ...room, vertices: [...room.vertices].reverse() })[0].outward, 1);
});

test('the example plan derives the stored walls, shared wall included', () => {
  const f = session();
  const derived = assertDerivedMatchesStored(f.floor(), f.specifications);
  assert.equal(derived.pieces.filter((piece) => piece.exposure === 'interior').length, 1);
  assert.deepEqual(derived.issues, []);
});

test('different exterior and interior thicknesses derive from the room geometry', () => {
  const f = session();
  f.apply({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness_m',
    value: 0.5,
  });
  const derived = assertDerivedMatchesStored(f.floor(), f.specifications);
  const widths = new Set(derived.pieces.map((piece) => `${piece.exposure}:${piece.thickness}`));
  assert.deepEqual(widths, new Set(['interior:0.2', 'exterior:0.5']));
});

test('derivation is independent of plan orientation', () => {
  const f = session(rotate(createBuildingPlanExample().snapshot, 0.37));
  assertDerivedMatchesStored(f.floor(), f.specifications);
});

test('rooms exactly a thickness apart are one shared wall, even before they are bound', () => {
  const f = session(createBuildingPlanSnapshot());
  const floorId = f.domain.apply({
    type: 'create_floor',
    values: { floor_interior_wall_thickness: 0.2, floor_exterior_wall_thickness: 0.2 },
  }).created.id;
  for (const rectangle of [
    { x: 0, y: 0, width: 4, height: 3 },
    { x: 0, y: 3.2, width: 4, height: 3 },
  ])
    f.domain.apply({ type: 'create_room', floorId, rectangle });
  const floor = f.domain.getSnapshot().floors[0];
  assert.ok(
    floor.walls.every((wall) => wall.exposure === 'exterior'),
    'Stored walls stay apart.'
  );
  const derived = deriveBuildingPlanFloor(floor, f.specifications);
  const shared = derived.pieces.filter((piece) => piece.exposure === 'interior');
  assert.equal(shared.length, 1);
  assert.ok(Math.abs(shared[0].axis.start.y - 3.1) < 1e-9);
  assert.ok(derived.issues.some((issue) => issue.code === 'subject_mismatch'));
});

test('an explicitly unknown thickness keeps the shared wall at its last width', () => {
  const f = session();
  const shared = f.floor().walls.find((wall) => wall.exposure === 'interior');
  f.apply({ type: 'set_property', wallId: shared.id, property: 'wall_thickness_m', value: null });
  const derived = deriveBuildingPlanFloor(f.floor(), f.specifications);
  const [piece] = derived.pieces.filter((entry) => entry.subjectId === shared.id);
  assert.equal(piece.exposure, 'interior');
  assert.equal(piece.thickness, null);
  assert.ok(Math.abs(piece.width - 0.2) < 1e-9);
});

test('an internal partition derives its axis from the drawn face and its side', () => {
  const f = session();
  f.apply({
    type: 'create_wall',
    roomId: f.floor().rooms[0].id,
    vertices: [
      { x: 1, y: 1 },
      { x: 4, y: 1 },
    ],
  });
  const derived = assertDerivedMatchesStored(f.floor(), f.specifications);
  assert.equal(derived.pieces.filter((piece) => piece.partition).length, 1);
});
