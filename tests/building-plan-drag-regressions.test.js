import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
  buildingPlanCanvasSnapshot,
  expandBuildingPlanSchema,
} from '../src/index.js';
import { distance } from '../src/building-plan/geometry.js';
import { buildingPlanBoundaryClearanceIssues } from '../src/building-plan/footprints.js';
import { openingWorldPositions } from './helpers/building-plan-v2.js';
import { textField, repeatableSection } from './helpers/calculation-fixtures.js';

function fixture(angle = 0, sign = 1) {
  const f = createBuildingPlanExample();
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const point = ({ x, y, ...rest }) => ({
    ...rest,
    x: sign * x * cos - y * sin,
    y: sign * x * sin + y * cos,
  });
  const local = ({ x, y }) => ({ x: sign * (x * cos + y * sin), y: -x * sin + y * cos });
  const snapshot = readBuildingPlanRecord({ meta: f.meta, record: f.record });
  for (const floor of snapshot.floors) {
    for (const room of floor.rooms) {
      room.vertices = room.vertices.map(point);
      for (const face of room.faces) for (const binding of face.bindings) binding.side *= sign;
    }
    for (const wall of floor.walls) {
      for (const side of wall.sides) side.sign *= sign;
      for (const segment of wall.segments) {
        segment.start = point(segment.start);
        segment.end = point(segment.end);
      }
    }
  }
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot,
    properties: f.meta.properties,
    createId: () => `drag-${++serial}`,
  });
  return { ...f, session, point, local, faceId: snapshot.floors[0].rooms[0].faces[3].id };
}
function wallLabels(f, plan) {
  const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan });
  const nodes = f.meta.repeatablesByNodeKey;
  const floor = record.repeatable[nodes.floors.preferredKey][0];
  return {
    record,
    labels: new Map(
      floor.repeatable[nodes.physical_walls.preferredKey].map((row) => [
        JSON.parse(row.values[nodes.physical_walls.fieldsByOriginalDataName.wall_model.dataName])
          .id,
        row.values[nodes.physical_walls.fieldsByOriginalDataName.wall_label.dataName],
      ])
    ),
  };
}

for (const [roomIndex, label] of [
  [0, 'W3.2'],
  [1, 'W3.1'],
])
  test(`a fitted jog preserves the existing facing row on its surviving physical piece (${label})`, () => {
    const f = fixture(),
      before = f.session.getSnapshot();
    const selected = buildingPlanCanvasSnapshot({
      meta: f.meta,
      record: f.record,
      plan: before,
    }).walls.find(
      (wall) => wall.roomId === before.floors[0].rooms[roomIndex].id && wall.displayLabel === label
    );
    assert.ok(selected);
    const result = f.session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: selected.id,
      distance: 2,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const after = f.session.getSnapshot();
    assert.ok(after.floors[0].walls.some((wall) => wall.id === selected.physicalWallId));
    const face = after.floors[0].rooms[roomIndex].faces.find((face) => face.id === selected.id);
    assert.ok(
      face,
      "A temporary return must not take the surviving physical piece's facing identity"
    );
    assert.equal(face.wallId, selected.physicalWallId);
    const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: after });
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record }), after);
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
    f.session.redo();
    assert.deepEqual(f.session.getSnapshot(), after);
  });

for (const angle of [0, 0.37])
  test(`thickness setbacks have a material profile without another physical owner (${angle})`, () => {
    const f = fixture(angle),
      s = f.session;
    const apply = (op) => {
      const r = s.apply({ floorId: f.floorId, ...op });
      assert.equal(r.status, 'applied', JSON.stringify(r.issues));
      return r;
    };
    const floor = () => s.getSnapshot().floors[0];
    const shared = floor().walls.find((wall) => wall.sides.every((side) => side.roomId));
    for (const opening of shared.doors)
      apply({ type: 'remove_opening', wallId: shared.id, openingId: opening.id });
    for (const side of shared.sides)
      apply({
        type: 'set_property',
        wallId: shared.id,
        sideId: side.id,
        scope: 'wall_face',
        property: 'finish',
        value: `Surface ${side.sign}`,
      });
    apply({
      type: 'set_property',
      wallId: shared.id,
      activeRoomId: floor().rooms[0].id,
      property: 'wall_thickness',
      value: 0.8,
    });
    assert.equal(floor().walls.length, 9, 'Changing thickness must not create a wall owner');
    apply({
      type: 'split_face',
      faceId: floor().rooms[0].faces.find((face) => face.wallId === shared.id).id,
      offset: 1,
    });
    const second = floor().walls.find(
      (wall) => wall.id !== shared.id && wall.properties.wall_thickness === 0.8
    );
    const before = s.getSnapshot();
    apply({
      type: 'set_property',
      wallId: second.id,
      activeRoomId: floor().rooms[0].id,
      property: 'wall_thickness',
      value: 0.3,
    });
    assert.equal(floor().walls.length, 10, 'The 0.5 m shoulder is a profile, not a third wall');
    assert.equal(
      floor().walls.find((wall) => wall.id === second.id).properties.wall_thickness,
      0.3
    );
    assert.deepEqual(s.validate(), []);
    const after = s.getSnapshot();
    const record = writeBuildingPlanRecord({ meta: f.meta, plan: after });
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record }), after);
    s.undo();
    assert.deepEqual(s.getSnapshot(), before);
    s.redo();
    assert.deepEqual(s.getSnapshot(), after);
    const reloaded = createBuildingPlanSession({
      snapshot: readBuildingPlanRecord({ meta: f.meta, record }),
      properties: f.meta.properties,
    });
    const changed = reloaded.apply({
      type: 'set_property',
      floorId: f.floorId,
      wallId: second.id,
      activeRoomId: floor().rooms[0].id,
      property: 'wall_thickness',
      value: 0.4,
    });
    assert.equal(changed.status, 'applied', JSON.stringify(changed.issues));
    const owners = reloaded.getSnapshot().floors[0].walls;
    assert.equal(owners.length, 10, 'Later edits reuse derived profiles after a record reload');
    for (const id of [shared.id, second.id])
      assert.deepEqual(
        owners.find((wall) => wall.id === id).sides.map((side) => side.overrides.finish),
        shared.sides.map((side) => `Surface ${side.sign}`)
      );
  });

test('moving a room removes obsolete automatic adjacency stations and retains current contacts', () => {
  const f = fixture(),
    before = f.session.getSnapshot();
  const r = f.session.apply({
    type: 'move_room',
    floorId: f.floorId,
    roomId: before.floors[0].rooms[0].id,
    delta: { x: 6, y: 0 },
  });
  assert.equal(r.status, 'applied', JSON.stringify(r.issues));
  const room = f.session.getSnapshot().floors[0].rooms[0];
  assert.ok(
    !room.vertices.some((p) => Math.abs(p.x - 9) < 1e-6 && Math.abs(p.y - 3) < 1e-6),
    'The old adjacency station at x=9 must disappear'
  );
  assert.ok(
    room.vertices.some((p) => Math.abs(p.x - 8) < 1e-6 && Math.abs(p.y - 3) < 1e-6),
    'The current adjacency station at x=8 must remain'
  );
  assert.deepEqual(f.session.validate(), []);
  const after = f.session.getSnapshot();
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
  f.session.redo();
  assert.deepEqual(f.session.getSnapshot(), after);
});

test('material profiles keep nested inspection rows on the retained physical source only', () => {
  const f = fixture();
  const inspections = repeatableSection('inspections', [
    textField('comment'),
    repeatableSection('details', [textField('description')]),
  ]);
  inspections.building_plan = { scope: 'physical_wall' };
  f.schema.form.elements[0].node_overrides.walls.extra_elements.push(inspections);
  const meta = expandBuildingPlanSchema(f.schema).buildingPlanMeta[0];
  const s = createBuildingPlanSession({
    snapshot: f.session.getSnapshot(),
    properties: meta.properties,
  });
  const floor = () => s.getSnapshot().floors[0];
  const wall = floor().walls.find((wall) => wall.sides.every((side) => side.roomId));
  const rows = {
    inspections: [
      {
        id: 'inspection',
        values: { comment: 'Site inspection' },
        repeatable: {
          details: [{ id: 'detail', values: { description: 'Keep this detail' }, repeatable: {} }],
        },
      },
    ],
  };
  assert.equal(
    s.apply({ type: 'set_custom_rows', floorId: f.floorId, wallId: wall.id, repeatable: rows })
      .status,
    'applied'
  );
  for (const value of [0.8, 0.3, 0.2]) {
    const result = s.apply({
      type: 'set_property',
      floorId: f.floorId,
      wallId: wall.id,
      activeRoomId: floor().rooms[0].id,
      property: 'wall_thickness',
      value,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.equal(floor().walls.length, 9);
    assert.deepEqual(floor().walls.find((other) => other.id === wall.id).repeatable, rows);
    assert.equal(floor().walls.flatMap((other) => other.repeatable?.inspections || []).length, 1);
  }
});

test('the fitted jog keeps its shared return without owners for the corner cap', () => {
  const f = fixture();
  assert.equal(
    f.session.apply({ type: 'resize_face', floorId: f.floorId, faceId: f.faceId, distance: 0.5 })
      .status,
    'applied'
  );
  const floor = f.session.getSnapshot().floors[0];
  const cap = floor.walls.filter((wall) => {
    const [a, b] = [wall.segments[0].start, wall.segments[0].end].map(f.local);
    return [a, b].every(
      (p) => p.x >= 2.8 - 1e-6 && p.x <= 3 + 1e-6 && p.y >= 3 - 1e-6 && p.y <= 3.2 + 1e-6
    );
  });
  assert.equal(cap.length, 0, 'The stationary corner material needs no separate physical owners');
  assert.ok(
    floor.walls.some(
      (wall) =>
        wall.sides.every((side) => side.roomId) &&
        Math.abs(distance(wall.segments[0].start, wall.segments[0].end) - 0.3) < 1e-6
    )
  );
});

for (const angle of [0, 0.37])
  test(`a genuine short jog return stays physical even inside the incident material bands (${angle})`, () => {
    const f = fixture(angle),
      before = f.session.getSnapshot();
    const result = f.session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.faceA,
      distance: 0.05,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const floor = f.session.getSnapshot().floors[0];
    assert.ok(
      floor.walls.some(
        (wall) =>
          wall.segments[0].junction &&
          Math.abs(distance(wall.segments[0].start, wall.segments[0].end) - 0.05) < 1e-6
      )
    );
    assert.deepEqual(f.session.validate(), []);
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
  });

test('a retained automatic answer boundary is selectable and Rejoin explains its conflict', () => {
  const f = fixture();
  f.schema.form.elements[0].node_overrides.walls.extra_elements.push(
    textField('survey_note', { building_plan: { scope: 'physical_wall', on_split: 'confirm' } })
  );
  const meta = expandBuildingPlanSchema(f.schema).buildingPlanMeta[0];
  const session = createBuildingPlanSession({
    snapshot: f.session.getSnapshot(),
    properties: meta.properties,
    editingPolicy: { copyCustomAnswersAutomatically: true },
  });
  let floor = session.getSnapshot().floors[0];
  const source = floor.walls.find((wall) => wall.sides.every((side) => side.roomId));
  assert.equal(
    session.apply({
      type: 'set_property',
      floorId: f.floorId,
      wallId: source.id,
      property: 'survey_note',
      value: 'Site inspection',
    }).status,
    'applied'
  );
  assert.equal(
    session.apply({
      type: 'move_room',
      floorId: f.floorId,
      roomId: floor.rooms[0].id,
      delta: { x: 6, y: 0 },
    }).status,
    'applied'
  );
  const before = session.getSnapshot();
  floor = before.floors[0];
  const point = floor.rooms[0].vertices.find(
    (p) => Math.abs(p.x - 9) < 1e-6 && Math.abs(p.y - 3) < 1e-6
  );
  assert.ok(point?.physicalBoundaryId, 'Independent inspection extent must remain');
  const record = writeBuildingPlanRecord({ meta, plan: before });
  const scene = buildingPlanCanvasSnapshot({ meta, record, plan: before });
  assert.ok(scene.editingCuts.some((cut) => cut.id === point.physicalBoundaryId && cut.automatic));
  const result = session.apply({
    type: 'rejoin_cut',
    floorId: f.floorId,
    cutId: point.physicalBoundaryId,
  });
  assert.equal(result.status, 'conflict');
  assert.match(result.issues[0].message, /answers|override/i);
  assert.deepEqual(session.getSnapshot(), before);
});

test('automatic physical labels agree with both room views and remain stable through a jog', () => {
  const f = fixture(),
    before = f.session.getSnapshot();
  const initial = wallLabels(f, before);
  assert.equal(new Set(initial.labels.values()).size, before.floors[0].walls.length);
  const result = f.session.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: f.faceId,
    distance: -1,
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  const after = f.session.getSnapshot(),
    saved = wallLabels(f, after);
  assert.equal(new Set(saved.labels.values()).size, after.floors[0].walls.length);
  for (const wall of after.floors[0].walls)
    if (initial.labels.has(wall.id))
      assert.equal(saved.labels.get(wall.id), initial.labels.get(wall.id));
  const source = before.floors[0].rooms[0].faces.find((face) => face.id === f.faceId).wallId;
  const added = after.floors[0].walls.filter((wall) => !initial.labels.has(wall.id));
  assert.ok(added.length);
  assert.ok(
    added.some((wall) =>
      saved.labels.get(wall.id).startsWith(`${initial.labels.get(source).split('.')[0]}.`)
    )
  );
  for (const wall of buildingPlanCanvasSnapshot({ meta: f.meta, record: saved.record, plan: after })
    .walls)
    assert.equal(wall.displayLabel, saved.labels.get(wall.physicalWallId));
  assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record: saved.record }), after);
  f.session.undo();
  assert.deepEqual(f.session.getSnapshot(), before);
  f.session.redo();
  assert.deepEqual(f.session.getSnapshot(), after);
});

for (const [angle, sign] of [
  [0, 1],
  [Math.PI / 2, 1],
  [0.37, 1],
  [-0.61, -1],
])
  test(`downward exterior-piece jog fits the stationary neighbour band (${angle}, ${sign})`, () => {
    const f = fixture(angle, sign),
      before = f.session.getSnapshot();
    const room2 = before.floors[0].rooms[1];
    const result = f.session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.faceId,
      distance: 0.5,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const after = f.session.getSnapshot(),
      floor = after.floors[0];
    assert.deepEqual(f.session.validate(), []);
    assert.deepEqual(buildingPlanBoundaryClearanceIssues(floor), []);
    for (const vertex of room2.vertices)
      assert.deepEqual(
        floor.rooms[1].vertices.find((point) => point.id === vertex.id),
        vertex
      );
    const shared = floor.walls.filter((wall) => wall.sides.every((side) => side.roomId));
    assert.ok(
      shared.some((wall) => {
        const segment = wall.segments[0],
          a = f.local(segment.start),
          b = f.local(segment.end);
        return (
          Math.abs(a.x - 2.9) < 1e-6 &&
          Math.abs(b.x - 2.9) < 1e-6 &&
          Math.abs(Math.abs(a.y - b.y) - 0.3) < 1e-6
        );
      }),
      "The new return must share Room 2's existing left-wall axis over the new coverage"
    );
    assert.deepEqual(openingWorldPositions(floor), openingWorldPositions(before.floors[0]));
    const saved = writeBuildingPlanRecord({ meta: f.meta, plan: after });
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record: saved }), after);
    f.session.undo();
    assert.deepEqual(f.session.getSnapshot(), before);
    f.session.redo();
    assert.deepEqual(f.session.getSnapshot(), after);
  });

for (const steps of [
  [-1, 2],
  [1, -2],
  [0.5, 0.5, -1],
])
  test(`an exterior piece can reverse through the stationary junction (${steps.join(', ')})`, () => {
    const f = fixture(),
      before = f.session.getSnapshot();
    let y = 3;
    for (const distance of steps) {
      const plan = f.session.getSnapshot();
      const record = writeBuildingPlanRecord({ meta: f.meta, plan });
      const wall = buildingPlanCanvasSnapshot({
        meta: f.meta,
        record,
        plan,
        gridSize: 1,
      }).walls.find(
        (wall) =>
          wall.roomId === before.floors[0].rooms[0].id &&
          wall.points.every((point) => Math.abs(point.y - y) < 1e-6) &&
          wall.points.some((point) => point.x < 0.01)
      );
      assert.ok(wall);
      const result = f.session.apply({
        type: 'resize_face',
        floorId: f.floorId,
        faceId: wall.id,
        distance,
      });
      assert.equal(result.status, 'applied', JSON.stringify(result.issues));
      y += distance;
      const after = f.session.getSnapshot();
      assert.deepEqual(f.session.validate(), []);
      for (const vertex of before.floors[0].rooms[1].vertices)
        assert.deepEqual(
          after.floors[0].rooms[1].vertices.find((point) => point.id === vertex.id),
          vertex
        );
      assert.deepEqual(
        openingWorldPositions(after.floors[0]),
        openingWorldPositions(before.floors[0])
      );
      const final = f.session.getSnapshot();
      f.session.undo();
      f.session.redo();
      assert.deepEqual(f.session.getSnapshot(), final);
    }
  });

test('a corner can trim an automatic zero-area cap while preserving different physical answers', () => {
  const f = fixture();
  f.schema.form.elements[0].node_overrides.walls.extra_elements.push(
    textField('survey_note', {
      building_plan: { scope: 'physical_wall', on_split: 'confirm' },
    })
  );
  const meta = expandBuildingPlanSchema(f.schema).buildingPlanMeta[0];
  const session = createBuildingPlanSession({
    snapshot: f.session.getSnapshot(),
    properties: meta.properties,
  });
  const floor = session.getSnapshot().floors[0];
  for (const [faceId, value] of [
    [floor.rooms[0].faces[2].id, 'Shared inspection'],
    [floor.rooms[1].faces[1].id, 'Independent right portion'],
  ]) {
    assert.equal(
      session.apply({
        type: 'set_property',
        floorId: f.floorId,
        faceId,
        property: 'survey_note',
        value,
      }).status,
      'applied'
    );
  }
  const before = session.getSnapshot();
  const result = session.apply({
    type: 'move_corner',
    floorId: f.floorId,
    roomId: floor.rooms[0].id,
    vertexId: floor.rooms[0].vertices[2].id,
    point: { x: 5, y: 2.5 },
  });
  assert.equal(result.status, 'pending', JSON.stringify(result.issues));
  assert.deepEqual(session.getSnapshot(), before);
  const accepted = session.resolveUIRequest(result.uiOperations[0].params.requestId, {
    value: 'apply',
  });
  assert.equal(accepted.status, 'applied', JSON.stringify(accepted.issues));
  assert.deepEqual(session.validate(), []);
  const after = session.getSnapshot();
  for (const wall of before.floors[0].walls.filter((wall) => wall.overrides.survey_note))
    assert.equal(
      after.floors[0].walls.find((entry) => entry.id === wall.id)?.overrides.survey_note,
      wall.overrides.survey_note
    );
  const record = writeBuildingPlanRecord({ meta, plan: after });
  assert.deepEqual(readBuildingPlanRecord({ meta, record }), after);
  session.undo();
  assert.deepEqual(session.getSnapshot(), before);
});

test('new shared coverage preserves existing surface answers, openings and nested cancellation', () => {
  const f = fixture(),
    session = f.session;
  let floor = session.getSnapshot().floors[0];
  const left = floor.walls.find((wall) => wall.id === floor.rooms[1].faces.at(-1).wallId);
  const outside = left.sides.find((side) => !side.roomId);
  assert.equal(
    session.apply({
      type: 'set_property',
      floorId: f.floorId,
      wallId: left.id,
      sideId: outside.id,
      scope: 'wall_face',
      property: 'finish',
      value: 'Existing outside finish',
    }).status,
    'applied'
  );
  assert.equal(
    session.apply({
      type: 'create_opening',
      floorId: f.floorId,
      wallId: left.id,
      kind: 'window',
      offset: 1,
      width: 0.6,
      height: 1,
      sillHeight: 0.8,
    }).status,
    'applied'
  );
  session.beginScope({ id: 'floor' });
  assert.equal(
    session.apply(
      { type: 'set_values', floorId: f.floorId, values: { floor_note: 'Earlier floor answer' } },
      { scopeId: 'floor' }
    ).status,
    'applied'
  );
  const before = session.getSnapshot();
  session.beginScope({ id: 'room', parentScopeId: 'floor' });
  const result = session.apply(
    { type: 'resize_face', floorId: f.floorId, faceId: f.faceId, distance: 0.5 },
    { scopeId: 'room' }
  );
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  floor = session.getSnapshot().floors[0];
  const newShared = floor.walls.find(
    (wall) =>
      wall.sides.every((side) => side.roomId) &&
      wall.segments.every(
        (segment) => Math.abs(segment.start.x - 2.9) < 1e-6 && Math.abs(segment.end.x - 2.9) < 1e-6
      )
  );
  assert.ok(newShared);
  assert.equal(
    newShared.sides.find((side) => side.roomId === floor.rooms[0].id).overrides.finish,
    'Existing outside finish'
  );
  assert.deepEqual(openingWorldPositions(floor), openingWorldPositions(before.floors[0]));
  assert.equal(session.cancelScope('room').status, 'cancelled');
  assert.deepEqual(session.getSnapshot(), before);
  assert.equal(session.getSnapshot().floors[0].values.floor_note, 'Earlier floor answer');
});

test('a new adjacency boundary through an opening retains the existing recovery decision', () => {
  const f = fixture(),
    session = f.session;
  const floor = session.getSnapshot().floors[0];
  const wallId = floor.rooms[1].faces.at(-1).wallId;
  const opening = session.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId,
    kind: 'door',
    offset: 2.6,
    width: 0.3,
    height: 2,
  });
  assert.equal(opening.status, 'applied');
  const before = session.getSnapshot();
  const operation = { type: 'resize_face', floorId: f.floorId, faceId: f.faceId, distance: 0.5 };
  const result = session.apply(operation);
  assert.equal(result.status, 'conflict');
  const recovery = result.issues.find(
    (issue) => issue.code === 'opening_cut_requires_confirmation'
  );
  assert.ok(recovery, JSON.stringify(result.issues));
  assert.deepEqual(recovery.openingIds, [opening.created.id]);
  assert.deepEqual(session.getSnapshot(), before);
  const accepted = session.apply({ ...operation, removeOpeningIds: recovery.openingIds });
  assert.equal(accepted.status, 'applied', JSON.stringify(accepted.issues));
  assert.deepEqual(session.validate(), []);
  assert.deepEqual(
    session
      .getSnapshot()
      .floors[0].walls.flatMap((wall) => wall.doors)
      .map((door) => door.id),
    before.floors[0].walls
      .flatMap((wall) => wall.doors)
      .filter((door) => door.id !== opening.created.id)
      .map((door) => door.id)
  );
  session.undo();
  assert.deepEqual(session.getSnapshot(), before);
});

test('automatic numbering preserves explicit wall labels and survives a record reload', () => {
  const f = fixture(),
    session = f.session;
  const originalWallId = session.getSnapshot().floors[0].rooms[0].faces[0].wallId;
  assert.equal(
    session.apply({
      type: 'set_values',
      floorId: f.floorId,
      wallId: originalWallId,
      values: { wall_label: 'Surveyed north wall' },
    }).status,
    'applied'
  );
  const before = wallLabels(f, session.getSnapshot()).labels;
  assert.equal(before.get(originalWallId), 'Surveyed north wall');
  assert.equal(
    session.apply({ type: 'resize_face', floorId: f.floorId, faceId: f.faceId, distance: 0.5 })
      .status,
    'applied'
  );
  const saved = wallLabels(f, session.getSnapshot());
  assert.equal(saved.labels.get(originalWallId), 'Surveyed north wall');
  const decoded = readBuildingPlanRecord({ meta: f.meta, record: saved.record });
  const reloaded = createBuildingPlanSession({ snapshot: decoded, properties: f.meta.properties });
  assert.deepEqual(wallLabels(f, reloaded.getSnapshot()).labels, saved.labels);
});

for (const thickness of [0.12, 0.4])
  test(`the new shared return uses the stationary wall's accepted thickness (${thickness})`, () => {
    const f = fixture(),
      session = f.session;
    const initial = session.getSnapshot().floors[0];
    const wallId = initial.rooms[1].faces.at(-1).wallId;
    assert.equal(
      session.apply({
        type: 'set_property',
        floorId: f.floorId,
        wallId,
        property: 'wall_thickness',
        value: thickness,
      }).status,
      'applied'
    );
    const before = session.getSnapshot();
    const result = session.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.faceId,
      distance: 0.5,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const after = session.getSnapshot().floors[0];
    for (const vertex of before.floors[0].rooms[1].vertices)
      assert.deepEqual(
        after.rooms[1].vertices.find((point) => point.id === vertex.id),
        vertex
      );
    const shared = after.walls.find(
      (wall) =>
        wall.sides.every((side) => side.roomId) &&
        wall.segments.every(
          (segment) =>
            Math.abs(segment.start.x - (3 - thickness / 2)) < 1e-6 &&
            Math.abs(segment.end.x - (3 - thickness / 2)) < 1e-6
        )
    );
    assert.ok(shared);
    assert.equal(shared.properties.wall_thickness, thickness);
    assert.equal(shared.overrides.wall_thickness, thickness);
    assert.deepEqual(buildingPlanBoundaryClearanceIssues(after), []);
    session.undo();
    assert.deepEqual(session.getSnapshot(), before);
  });
