import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { createBuildingPlanSession, readBuildingPlanRecord } from '../src/index.js';

// A Rooms entry is cancelled after an edit made in the Floor entry under it changed the same
// wall: the refusal names what is in the way, so the host can log it.
test('a refused cancel names the edit in the way', () => {
  const f = createBuildingPlanExample();
  let serial = 0;
  const s = createBuildingPlanSession({
    snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
    properties: f.meta.properties,
    createId: () => `cancel-dependent-${++serial}`,
  });
  const plan = s.getSnapshot();
  const wall = plan.floors[0].walls.find((entry) => entry.sides.some((side) => side.roomId));
  const roomId = wall.sides.find((side) => side.roomId).roomId;
  const thickness = (value, scopeId) =>
    s.apply(
      {
        type: 'set_property',
        floorId: f.floorId,
        wallId: wall.id,
        activeRoomId: roomId,
        property: 'wall_thickness',
        value,
      },
      { scopeId }
    );
  s.beginScope({ id: 'floor' });
  s.beginScope({ id: 'room', parentScopeId: 'floor' });
  assert.equal(thickness(0.4, 'room').status, 'applied');
  assert.equal(thickness(0.5, 'floor').status, 'applied');

  const refused = s.cancelScope('room');
  assert.equal(refused.status, 'conflict');
  const [issue] = refused.issues;
  assert.equal(issue.code, 'dependent_edit');
  assert.equal(issue.operation, 'set_property');
  assert.ok(Array.isArray(issue.path) && issue.path.length > 0);
  assert.deepEqual(issue.laterEdits, [{ operation: 'set_property', scopeId: 'floor' }]);
});
