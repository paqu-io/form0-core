import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// A refusal names the door, window or beam in the way (2026-11-24): a Split across a wall beam
// read "This cut crosses a door or window", and the beam wasn't drawn. The example's W3 (shared,
// 2 m, its axis from x = 5 to x = 3) holds the Shared door at 3.6..4.5.

function example() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `c-${++serial}`,
    derivedCommands: true,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  return { f, floor, apply, wall };
}
const message = (result) => {
  assert.equal(result.status, 'conflict', JSON.stringify(result));
  return result.issues[0].message;
};

test('a Split across a beam or a door names it', () => {
  const t = example();
  const beam = t.apply({
    type: 'create_opening',
    kind: 'beam',
    wallId: t.wall('W3').id,
    offset: 0,
    length: 1.5,
    width: 0.2,
    depth: 0.3,
    underside: 2.1,
    values: {},
  });
  assert.equal(beam.status, 'applied', JSON.stringify(beam.issues));
  // x = 3.55: past the door's left edge (3.6), on the beam (3.5..5).
  assert.equal(
    message(t.apply({ type: 'split_face', faceId: t.f.faceA, offset: 1.45 })),
    'This cut crosses Beam B#1. Choose a position outside it, or shorten the beam first.'
  );
  const bare = example();
  assert.equal(
    message(bare.apply({ type: 'split_face', faceId: bare.f.faceA, offset: 1 })),
    'This cut crosses Shared door. Choose an opening edge or another position.'
  );
});

test("a beam typed past its wall's end is named", () => {
  const t = example();
  const w3 = t.wall('W3');
  const created = t.apply({
    type: 'create_opening',
    kind: 'beam',
    wallId: w3.id,
    offset: 0,
    length: 2,
    width: 0.2,
    depth: 0.3,
    underside: 2.7,
    values: {},
  });
  assert.equal(created.status, 'applied', JSON.stringify(created.issues));
  const id = t.wall('W3').beams[0].id;
  // The hand test's first step: a distance typed while the beam still spans the whole wall.
  assert.equal(
    message(t.apply({ type: 'update_opening', wallId: w3.id, openingId: id, offset: 0.2 })),
    'Beam B#1 does not fit on its wall. Shorten or move it.'
  );
});
