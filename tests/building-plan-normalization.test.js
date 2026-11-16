import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
  buildingPlanCanvasSnapshot,
} from '../src/index.js';
import { openingWorldPositions } from './helpers/building-plan-v2.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { dot, polygonArea, project, segmentFrame } from '../src/building-plan/geometry.js';

// Accepted 4206 draft from the 2026-11-10 automatic-node report. No user secrets.
const captured = JSON.parse(
  readFileSync(
    new URL('./fixtures/building-plan-normalization-captured.json', import.meta.url),
    'utf8'
  )
);
const { meta } = createBuildingPlanExample();
function overlappingOwners(floor) {
  const overlaps = [];
  for (let i = 0; i < floor.walls.length; i++)
    for (const b of floor.walls.slice(i + 1)) {
      const a = floor.walls[i];
      if (a.exposure !== 'exterior' || b.exposure !== 'exterior') continue;
      const ar = a.sides.map((s) => s.roomId).filter(Boolean);
      const br = b.sides.map((s) => s.roomId).filter(Boolean);
      if (ar.length !== 1 || br.length !== 1 || ar[0] === br[0]) continue;
      const af = segmentFrame(a.segments[0].start, a.segments[0].end);
      const bf = segmentFrame(b.segments[0].start, b.segments[0].end);
      if (
        Math.abs(dot(af.normal, bf.tangent)) > 1e-7 ||
        Math.abs(project(af, bf.start).offset) > 1e-7
      )
        continue;
      const stations = [project(af, bf.start).along, project(af, bf.end).along].sort(
        (a, b) => a - b
      );
      if (Math.min(af.length, stations[1]) - Math.max(0, stations[0]) > 1e-7)
        overlaps.push([a.autoLabel, b.autoLabel]);
    }
  return overlaps;
}
function fixture(snapshot = captured) {
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot,
    properties: meta.properties,
    createId: () => `normalization-${++serial}`,
    editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
  });
  const before = session.getSnapshot();
  const floor = before.floors[0];
  const face = floor.rooms[1].faces.find(
    (f) => floor.walls.find((w) => w.id === f.wallId).autoLabel === 'W7'
  );
  return {
    session,
    before,
    floorId: floor.id,
    operation: { type: 'resize_face', floorId: floor.id, faceId: face.id, distance: 0.1 },
  };
}

test('settling the captured jog draft gives each shared band one physical owner', () => {
  const { session, before, operation } = fixture();
  assert.equal(
    overlappingOwners(before.floors[0]).length,
    5,
    'The fixture retains the reported ownership failure.'
  );
  const result = session.apply(operation);
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const after = session.getSnapshot();
  assert.deepEqual(overlappingOwners(after.floors[0]), []);
  const cuts = (plan) =>
    [
      ...new Set(
        plan.floors[0].rooms.flatMap((r) => r.vertices.map((p) => p.editingCutId).filter(Boolean))
      ),
    ].sort();
  assert.deepEqual(cuts(after), cuts(before), 'The four intentional splits remain.');
  assert.ok(
    Math.abs(
      polygonArea(after.floors[0].rooms[0].vertices) -
        polygonArea(before.floors[0].rooms[0].vertices)
    ) < 1e-7
  );
  const record = writeBuildingPlanRecord({ meta, plan: after });
  assert.deepEqual(
    readBuildingPlanRecord({ meta, record }).floors[0].rooms.map((r) => r.vertices),
    after.floors[0].rooms.map((r) => r.vertices)
  );
  assert.equal(session.undo().status, 'undone');
  assert.deepEqual(session.getSnapshot(), before);
  assert.equal(session.redo().status, 'redone');
  assert.deepEqual(session.getSnapshot(), after);
});

test('supplied short caps become derived geometry without independent wall rows', () => {
  const { session, before, operation } = fixture();
  const caps = before.floors[0].walls.filter((wall) =>
    ['W3.6', 'W3.8', 'W3.9', 'W3.11', 'W3.14', 'W3.16', 'W3.17', 'W3.19'].includes(wall.autoLabel)
  );
  assert.equal(caps.length, 8);
  assert.equal(session.apply(operation).status, 'applied');
  const floor = session.getSnapshot().floors[0];
  assert.ok(caps.every((cap) => !floor.walls.some((wall) => wall.id === cap.id)));
  assert.ok(floor.rooms.every((room) => room.edges.some((edge) => edge.profile)));
  assert.deepEqual(session.validate(), []);
});

for (const kind of ['physical answer', 'surface answer', 'opening', 'intentional cap cut'])
  test(`normalization retains a legacy cap with an independent ${kind}`, () => {
    const snapshot = structuredClone(captured);
    const floor = snapshot.floors[0];
    const cap = floor.walls.find((wall) => wall.autoLabel === 'W3.8');
    const side = cap.sides.find((side) => side.roomId);
    if (kind === 'physical answer') cap.overrides.material = 'Measured concrete';
    if (kind === 'surface answer') side.overrides.finish = 'Retain this survey finish';
    if (kind === 'opening')
      cap.windows.push({
        id: 'cap-window',
        type: 'window',
        segmentId: cap.segments[0].id,
        offset: 0.05,
        width: 0.1,
        height: 0.5,
        sillHeight: 0.8,
        values: {},
      });
    if (kind === 'intentional cap cut') {
      const room = floor.rooms.find((room) => room.id === side.roomId);
      const face = room.faces.find((face) => face.wallId === cap.id);
      const edge = room.edges.find((edge) => face.edgeIds.includes(edge.id));
      const point = room.vertices.find(
        (point) => [edge.startId, edge.endId].includes(point.id) && point.physicalBoundaryId
      );
      point.editingCutId = 'explicit-cap-cut';
    }
    const session = createBuildingPlanSession({
      snapshot,
      properties: meta.properties,
      editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
    });
    const face = floor.rooms[1].faces.find(
      (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W7'
    );
    const result = session.apply({
      type: 'resize_face',
      floorId: floor.id,
      faceId: face.id,
      distance: 0.1,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const retained = session.getSnapshot().floors[0].walls.find((wall) => wall.id === cap.id);
    assert.ok(retained, 'Accepted independent evidence keeps its physical owner.');
    assert.deepEqual(retained.overrides, cap.overrides);
    assert.deepEqual(
      retained.sides.map((side) => [side.id, side.overrides]),
      cap.sides.map((side) => [side.id, side.overrides])
    );
    assert.deepEqual(retained.windows, cap.windows);
    assert.deepEqual(session.validate(), []);
  });

test('the portable canvas exposes real corners and owners after normalization', () => {
  const { session, operation } = fixture();
  assert.equal(session.apply(operation).status, 'applied');
  const plan = session.getSnapshot();
  const view = buildingPlanCanvasSnapshot({
    meta,
    plan,
    record: writeBuildingPlanRecord({ meta, plan }),
  });
  assert.equal(plan.floors[0].walls.length, 15, 'Nine shared runs and six exterior runs remain.');
  for (const room of plan.floors[0].rooms)
    assert.equal(view.corners.filter((corner) => corner.roomId === room.id).length, 12);
  assert.equal(view.walls.length, 24, 'Room views share the nine physical runs.');
  const before = session.getSnapshot().floors[0];
  assert.equal(
    session.apply({
      type: 'set_provider',
      floorId: before.id,
      nodeKey: 'floors',
      fieldName: 'floor_exterior_wall_thickness',
      property: 'wall_thickness',
      value: 0.2,
    }).status,
    'applied'
  );
  const after = session.getSnapshot().floors[0];
  assert.deepEqual(after.rooms, before.rooms);
  assert.deepEqual(after.walls, before.walls);
});

test('normalization transfers a hosted opening while reconciling the shared owner', () => {
  const snapshot = structuredClone(captured);
  const wall = snapshot.floors[0].walls.find((wall) => wall.autoLabel === 'W3.31');
  wall.windows.push({
    id: 'shared-window',
    type: 'window',
    segmentId: wall.segments[0].id,
    offset: 0.1,
    width: 0.2,
    height: 0.8,
    sillHeight: 0.9,
    values: {},
  });
  const { session, before, operation } = fixture(snapshot);
  assert.equal(session.apply(operation).status, 'applied');
  const after = session.getSnapshot().floors[0];
  assert.deepEqual(openingWorldPositions(after), openingWorldPositions(before.floors[0]));
  assert.equal(after.walls.flatMap((wall) => wall.windows).length, 1);
  assert.deepEqual(overlappingOwners(after), []);
});

test('incompatible accepted construction rejects normalization atomically', () => {
  const snapshot = structuredClone(captured);
  for (const [label, value] of [
    ['W3.31', 'Brick'],
    ['W3.12', 'Concrete'],
  ])
    snapshot.floors[0].walls.find((wall) => wall.autoLabel === label).overrides.material = value;
  const { session, before, operation } = fixture(snapshot);
  const history = session.getState();
  const result = session.apply(operation);
  assert.equal(result.status, 'conflict');
  assert.ok(result.issues.some((issue) => issue.code === 'conflicting_wall_properties'));
  assert.deepEqual(session.getSnapshot(), before);
  assert.deepEqual(session.getState(), history);
});

for (const sign of [-1, 1])
  test(`shared ownership and cap normalization are independent of world axes (${sign})`, () => {
    const snapshot = structuredClone(captured);
    const angle = 0.37;
    const transform = ({ x, y, ...rest }) => ({
      ...rest,
      x: sign * x * Math.cos(angle) - y * Math.sin(angle),
      y: sign * x * Math.sin(angle) + y * Math.cos(angle),
    });
    for (const floor of snapshot.floors) {
      for (const room of floor.rooms) {
        room.vertices = room.vertices.map(transform);
        for (const face of room.faces) for (const binding of face.bindings) binding.side *= sign;
      }
      for (const wall of floor.walls) {
        for (const side of wall.sides) side.sign *= sign;
        for (const span of wall.segments) {
          span.start = transform(span.start);
          span.end = transform(span.end);
        }
      }
    }
    const { session, operation } = fixture(snapshot);
    const result = session.apply(operation);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(overlappingOwners(session.getSnapshot().floors[0]), []);
    assert.equal(session.getSnapshot().floors[0].walls.length, 15);
    assert.deepEqual(session.validate(), []);
  });
