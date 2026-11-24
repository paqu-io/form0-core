import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// A derived write-back works an opening's offset out again from its ends on the floor; it was
// stored with float noise (a typed 0.3 as 0.2999999999999998, decided 2026-11-24 to round it as
// coordinates are, though it changes stored door values: plans aren't published yet).

test('a typed distance is stored as typed, for doors and wall beams, through later edits', () => {
  const f = createBuildingPlanExample();
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    derivedCommands: true,
  });
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  };
  const w3 = () => session.getSnapshot().floors[0].walls.find((wall) => wall.autoLabel === 'W3');
  const door = () => w3().doors[0];
  for (const offset of [0.3, 0.2, 0.7]) {
    apply({ type: 'update_opening', wallId: w3().id, openingId: door().id, offset });
    assert.equal(door().offset, offset);
  }
  apply({
    type: 'create_opening',
    kind: 'beam',
    wallId: w3().id,
    offset: 0.1,
    length: 0.3,
    width: 0.2,
    depth: 0.3,
    underside: 2.1,
    values: {},
  });
  assert.equal(w3().beams[0].offset, 0.1);
  // The shared wall moved: both keep their exact distance.
  apply({ type: 'resize_face', faceId: f.faceA, distance: 0.3 });
  assert.deepEqual([door().offset, w3().beams[0].offset], [0.7, 0.1]);
});
