import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Room 2's east face is x = 8 (face acceptance-subject-50). With 500 mm exterior walls, a
// separate room whose west face is x = 9 is met when that face moves 0.5 m east.
test('a dragged face adapts to a new 200 mm contact instead of pushing the neighbour', () => {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `hold-${++serial}`,
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
    value: 0.5,
  });
  const neighbourId = apply({
    type: 'create_room',
    rectangle: { x: 9, y: 3.2, width: 3, height: 3 },
  }).created.id;
  const neighbour = () => session.getSnapshot().floors[0].rooms.find((r) => r.id === neighbourId);
  const before = neighbour().vertices;

  apply({ type: 'resize_face', faceId: 'acceptance-subject-50', distance: 0.5 });

  const floor = session.getSnapshot().floors[0];
  assert.deepEqual(neighbour().vertices, before, 'The neighbour keeps its face.');
  assert.ok(
    Math.abs(Math.max(...floor.rooms[1].vertices.map((v) => v.x)) - 8.8) < 1e-9,
    'The dragged face lands 200 mm from the neighbour.'
  );
  const shared = floor.walls.filter(
    (wall) =>
      wall.sides.filter((side) => side.roomId).length === 2 &&
      wall.sides.some((side) => side.roomId === neighbourId)
  );
  assert.deepEqual(
    shared.map((wall) => wall.properties.wall_thickness),
    [0.2]
  );
  assert.deepEqual(session.validate(), []);
});
