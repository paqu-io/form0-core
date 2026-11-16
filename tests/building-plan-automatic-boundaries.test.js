import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { createBuildingPlanSession } from '../src/index.js';
import { at, segmentFrame, polygonIssue } from '../src/building-plan/geometry.js';
import { buildingPlanBoundaryClearanceIssues } from '../src/building-plan/footprints.js';

function fixture(provider, angle = 0, sign = 1) {
  const f = createBuildingPlanExample();
  let session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
  });
  assert.equal(
    session.apply({
      type: 'set_provider',
      floorId: f.floorId,
      nodeKey: 'floors',
      fieldName: `floor_${provider}_wall_thickness`,
      property: 'wall_thickness',
      value: 0.5,
    }).status,
    'applied'
  );
  const point = ({ x, y, ...rest }) => ({
    ...rest,
    x: sign * x * Math.cos(angle) - y * Math.sin(angle),
    y: sign * x * Math.sin(angle) + y * Math.cos(angle),
  });
  if (angle || sign < 0) {
    const snapshot = session.getSnapshot();
    for (const floor of snapshot.floors) {
      for (const room of floor.rooms) {
        room.vertices = room.vertices.map(point);
        for (const edge of room.edges) if (edge.profile) edge.profile.sideSign *= sign;
        for (const face of room.faces) for (const binding of face.bindings) binding.side *= sign;
      }
      for (const wall of floor.walls) {
        for (const side of wall.sides) side.sign *= sign;
        for (const span of wall.segments) {
          span.start = point(span.start);
          span.end = point(span.end);
        }
      }
    }
    session = createBuildingPlanSession({
      snapshot,
      properties: f.meta.properties,
      editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
    });
  }
  session.setEditingPolicy({ inheritedChangePolicy: 'ask' });
  const floor = () => session.getSnapshot().floors[0];
  const w2 = () =>
    floor().rooms[0].faces.find(
      (face) => floor().walls.find((wall) => wall.id === face.wallId).autoLabel === 'W2'
    );
  const move = (distance, choice) => {
    let result = session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: w2().id,
      distance,
    });
    if (result.status === 'pending') {
      assert.equal(result.uiOperations.length, 1);
      result = session.resolveUIRequest(result.uiOperations[0].params.requestId, { value: choice });
    }
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    assert.deepEqual(buildingPlanBoundaryClearanceIssues(floor()), []);
    for (const room of floor().rooms) assert.equal(polygonIssue(room.vertices), null);
    return result;
  };
  return { ...f, session, floor, point, move };
}

const openings = (floor) =>
  floor.walls.flatMap((wall) =>
    wall.doors.map((opening) => ({
      id: opening.id,
      width: opening.width,
      point: at(segmentFrame(wall.segments[0].start, wall.segments[0].end), opening.offset),
    }))
  );

for (const provider of ['interior', 'exterior'])
  for (const choice of ['apply', 'preserve'])
    for (const [angle, sign] of [
      [0, 1],
      [0.37, -1],
    ]) {
      test(`automatic boundaries support repeated outward and return drags (${provider}, ${choice}, ${angle}, ${sign})`, () => {
        const f = fixture(provider, angle, sign),
          initial = f.floor(),
          oldOpenings = openings(initial);
        // Every call is a new geometry edit, rather than snapshot-based Undo.
        for (const distance of [4, -2, -2, 5, -5]) {
          const before = f.session.getSnapshot();
          f.move(distance, choice);
          const accepted = f.session.getSnapshot();
          for (const old of oldOpenings) {
            const current = openings(f.floor()).find((opening) => opening.id === old.id);
            assert.ok(current, 'The existing door keeps its identity.');
            assert.equal(current.width, old.width);
            assert.ok(
              Math.hypot(current.point.x - old.point.x, current.point.y - old.point.y) < 1e-6
            );
          }
          for (const old of f.snapshot.floors[0].rooms[1].vertices
            .filter((vertex) => vertex.y > 4)
            .map(f.point)) {
            const current = f.floor().rooms[1].vertices.find((vertex) => vertex.id === old.id);
            assert.deepEqual(current, old, 'The stationary room retains its far corners.');
          }
          assert.equal(f.session.undo().status, 'undone');
          assert.deepEqual(f.session.getSnapshot(), before);
          assert.equal(f.session.redo().status, 'redone');
          assert.deepEqual(f.session.getSnapshot(), accepted);
        }
        const final = f.floor();
        assert.equal(final.values[`floor_${provider}_wall_thickness`], 0.5);
        assert.ok(
          final.rooms[0].vertices.some(
            (vertex) =>
              Math.hypot(
                vertex.x - f.point({ x: 5, y: 0 }).x,
                vertex.y - f.point({ x: 5, y: 0 }).y
              ) < 1e-6
          )
        );
      });
    }

function outsideTail(f) {
  return f
    .floor()
    .walls.find(
      (wall) =>
        wall.exposure === 'exterior' &&
        wall.segments.every(
          (span) =>
            span.start.x >= 8 &&
            span.end.x >= 8 &&
            Math.abs(span.start.y - 3.1) < 1e-6 &&
            Math.abs(span.end.y - 3.1) < 1e-6
        )
    );
}

test('reversal retains deliberate cuts and rejects removal of their physical portions', () => {
  const f = fixture('exterior');
  f.move(4, 'preserve');
  const wall = outsideTail(f),
    face = f.floor().rooms[0].faces.find((face) => face.wallId === wall.id);
  assert.equal(
    f.session.apply({ type: 'split_face', floorId: f.floorId, faceId: face.id, offset: 0.5 })
      .status,
    'applied'
  );
  const before = f.session.getSnapshot();
  const target = f
    .floor()
    .rooms[0].faces.find(
      (face) => f.floor().walls.find((wall) => wall.id === face.wallId).autoLabel === 'W2'
    );
  const result = f.session.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: target.id,
    distance: -4,
  });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(f.session.getSnapshot(), before);
});

for (const content of ['material', 'rows'])
  test(`automatic contraction preserves distinct custom ${content}`, () => {
    const f = fixture('exterior');
    f.move(4, 'preserve');
    const wall = outsideTail(f);
    let session = f.session;
    if (content === 'material')
      assert.equal(
        session.apply({
          type: 'set_property',
          floorId: f.floorId,
          wallId: wall.id,
          property: 'material',
          value: 'Distinct masonry',
        }).status,
        'applied'
      );
    else {
      const snapshot = session.getSnapshot();
      snapshot.floors[0].walls.find((value) => value.id === wall.id).repeatable = {
        inspection: [{ id: 'inspection-row', values: { note: 'Evidence' }, repeatable: {} }],
      };
      session = createBuildingPlanSession({ snapshot, properties: f.meta.properties });
    }
    const before = session.getSnapshot(),
      floor = before.floors[0],
      face = floor.rooms[0].faces.find(
        (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W2'
      );
    const result = session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: face.id,
      distance: -4,
    });
    assert.equal(result.status, 'conflict');
    assert.ok(
      result.issues.some((issue) => issue.code === 'wall_retirement_conflict'),
      JSON.stringify(result.issues)
    );
    assert.deepEqual(session.getSnapshot(), before);
  });

test('a door on disappearing automatic coverage uses the existing explicit removal recovery', () => {
  const f = fixture('exterior');
  f.move(4, 'preserve');
  const wall = outsideTail(f);
  const created = f.session.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId: wall.id,
    kind: 'door',
    offset: 0.1,
    width: 0.5,
    height: 2,
  });
  assert.equal(created.status, 'applied', JSON.stringify(created.issues));
  const before = f.session.getSnapshot(),
    floor = before.floors[0],
    face = floor.rooms[0].faces.find(
      (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W2'
    );
  const operation = { type: 'resize_face', floorId: f.floorId, faceId: face.id, distance: -4 };
  const result = f.session.apply(operation);
  assert.equal(result.status, 'conflict');
  const recovery = result.issues.find(
    (issue) => issue.code === 'opening_cut_requires_confirmation'
  );
  assert.ok(recovery, JSON.stringify(result.issues));
  assert.deepEqual(f.session.getSnapshot(), before);
  assert.deepEqual(recovery.openingIds, [created.created.id]);
  let accepted = f.session.apply({ ...operation, removeOpeningIds: recovery.openingIds });
  if (accepted.status === 'pending')
    accepted = f.session.resolveUIRequest(accepted.uiOperations[0].params.requestId, {
      value: 'preserve',
    });
  assert.equal(accepted.status, 'applied', JSON.stringify(accepted.issues));
  assert.deepEqual(f.session.validate(), []);
});

test('a stationary pinned wall remains a constraint when an automatic shoulder reaches its corner', () => {
  const f = fixture('interior'),
    before = f.session.getSnapshot(),
    floor = before.floors[0];
  const face = floor.rooms[0].faces.find(
    (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W2'
  );
  const pinned = floor.rooms[1].faces.find(
    (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W6'
  );
  const result = f.session.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: face.id,
    distance: 4,
    pinnedFaceIds: [pinned.id],
  });
  assert.equal(result.status, 'conflict');
  assert.ok(
    result.issues.some((issue) => issue.code === 'pinned_wall_conflict'),
    JSON.stringify(result.issues)
  );
  assert.deepEqual(f.session.getSnapshot(), before);
});

test('cancelling a multi-gesture child restores automatic ownership and earlier parent answers', () => {
  const f = fixture('exterior');
  f.session.setEditingPolicy({ inheritedChangePolicy: 'apply' });
  f.session.beginScope({ id: 'floor' });
  assert.equal(
    f.session.apply(
      { type: 'set_values', floorId: f.floorId, values: { floor_note: 'Earlier answer' } },
      { scopeId: 'floor' }
    ).status,
    'applied'
  );
  const before = f.session.getSnapshot();
  f.session.beginScope({ id: 'room', parentScopeId: 'floor' });
  for (const distance of [4, -4]) {
    const floor = f.floor(),
      face = floor.rooms[0].faces.find(
        (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W2'
      );
    const result = f.session.apply(
      { type: 'resize_face', floorId: f.floorId, faceId: face.id, distance },
      { scopeId: 'room' }
    );
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  }
  assert.equal(f.session.cancelScope('room').status, 'cancelled');
  assert.deepEqual(f.session.getSnapshot(), before);
});
