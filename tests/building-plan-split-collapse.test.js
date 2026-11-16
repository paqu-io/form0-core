import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Room 2 of the example is the rectangle (3,3.2)-(8,6.2); W6 is its east wall and
// acceptance-subject-38 its north-east corner.
const EAST_FACE = 'acceptance-subject-50';
const NORTH_EAST = 'acceptance-subject-38';

function fixture(exterior) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `collapse-${++serial}`,
    editingPolicy: { inheritedChangePolicy: 'apply' },
  });
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  apply({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness',
    value: exterior,
  });
  const room = () => session.getSnapshot().floors[0].rooms[1];
  return { session, apply, room };
}

// The jog's step: the room-2 face whose edges join two vertices of the given cut.
function stepFace(room, cutId) {
  const cut = new Set(room.vertices.filter((v) => v.editingCutId === cutId).map((v) => v.id));
  return room.faces.find((face) =>
    room.edges.some(
      (edge) => face.edgeIds.includes(edge.id) && cut.has(edge.startId) && cut.has(edge.endId)
    )
  );
}

for (const exterior of [0.2, 0.5])
  test(`a Split whose portion collapses onto a corner retires instead of moving there (${exterior})`, () => {
    const f = fixture(exterior);
    const cutId = f.apply({ type: 'split_face', faceId: EAST_FACE, offset: 1 }).created.id;
    f.apply({ type: 'resize_face', faceId: EAST_FACE, distance: 1 });
    // Snapping can place the jog's step exactly on the north wall line: the upper
    // Split portion then has no length left.
    f.apply({ type: 'resize_face', faceId: stepFace(f.room(), cutId).id, distance: 2 });

    const plan = f.session.getSnapshot();
    assert.ok(
      plan.floors[0].rooms.every((room) => room.vertices.every((v) => v.editingCutId !== cutId)),
      'No corner inherits the collapsed Split.'
    );
    assert.deepEqual(f.session.validate(), []);
    const corner = f.room().vertices.find((v) => v.id === NORTH_EAST);
    assert.ok(corner, 'The original corner keeps its identity.');
    assert.equal(corner.y, 6.2);
    assert.ok(corner.physicalBoundaryId, 'Left on a straight line, it is an automatic boundary.');

    f.apply({ type: 'rejoin_cut', cutId: corner.physicalBoundaryId });
    const north = f.room().vertices.filter((v) => Math.abs(v.y - 6.2) < 1e-9);
    assert.equal(north.length, 2, 'Rejoin leaves one straight north wall.');
    assert.deepEqual(f.session.validate(), []);

    assert.equal(f.session.undo().status, 'undone');
    assert.equal(f.session.undo().status, 'undone');
    assert.ok(
      f.room().vertices.some((v) => v.editingCutId === cutId),
      'Undo restores the jog.'
    );
  });
