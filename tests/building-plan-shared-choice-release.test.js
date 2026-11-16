import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildingPlanRecord, writeBuildingPlanRecord } from '../src/index.js';
import { sharedValuePlan } from './helpers/building-plan-shared-values.js';

// The 2026-11-16 web retest, option (b2): an answer the shared-value question chose holds only
// while its wall faces the rooms it was chosen between; typed answers are never released.

const own = (wall, key) => Object.hasOwn(wall?.overrides || {}, key);

/** Bedroom (3 m) and New (2.5 m) attached below it, the shared wall answered New: 2.5 m. */
function attachedNew() {
  const plan = sharedValuePlan();
  plan.createRoom('Bedroom', { x: 0, y: 0, width: 4, height: 3 });
  plan.createRoom('New', { x: 0, y: 10, width: 4, height: 3 });
  plan.apply({
    type: 'set_property',
    nodeKey: 'rooms',
    roomId: plan.room('New').id,
    property: 'room_structural_clear_height',
    value: 2.5,
  });
  const move = (dy, attach) =>
    plan.apply({ type: 'move_room', roomId: plan.room('New').id, delta: { x: 0, y: dy }, attach });
  return { ...plan, move };
}

test('the web retest path: a detach releases the chosen height and a re-attach asks again', () => {
  const plan = attachedNew();
  assert.equal(plan.answer(plan.move(-6.8, true), 'New').status, 'applied');
  const shared = plan.wallAt('Bedroom', 3.1);
  assert.equal(shared.overrides.wall_height, 2.5);
  assert.deepEqual(shared.sharedChoices, ['wall_height']);

  assert.equal(plan.move(2, false).status, 'applied');
  // Bedroom's bottom is one wall following Bedroom again; New's top one wall following New.
  const bedroom = plan
    .floor()
    .walls.filter((wall) => wall.sides.some((side) => side.roomId === plan.room('Bedroom').id));
  const bottom = bedroom.filter((wall) => Math.abs(wall.segments[0].start.y - 3.1) < 1e-6);
  assert.equal(bottom.length, 1);
  assert.equal(bottom[0].properties.wall_height, 3);
  assert.equal(own(bottom[0], 'wall_height'), false);
  const top = plan.wallAt('New', 5.1);
  assert.equal(top.properties.wall_height, 2.5);
  assert.equal(own(top, 'wall_height'), false);
  assert.equal(top.sharedChoices, undefined);

  const asked = plan.move(-2, true);
  assert.equal(asked.status, 'pending');
  assert.deepEqual(
    asked.uiOperations[0].params.buttons.map((button) => button.label),
    ['Bedroom: 3 m', 'New: 2.5 m', 'Cancel edit']
  );
  assert.equal(plan.answer(asked, 'Bedroom').status, 'applied');
  assert.equal(plan.wallAt('Bedroom', 3.1).overrides.wall_height, 3);
});

test('a typed value stays on both pieces after a detach', () => {
  const plan = attachedNew();
  plan.answer(plan.move(-6.8, true), 'New');
  const shared = plan.wallAt('Bedroom', 3.1);
  plan.apply({
    type: 'set_property',
    faceId: plan.faceOf('Bedroom', shared).id,
    property: 'wall_height',
    value: 2.6,
  });
  assert.equal(plan.move(2, false).status, 'applied');
  for (const [label, y] of [
    ['Bedroom', 3.1],
    ['New', 5.1],
  ]) {
    const wall = plan.wallAt(label, y);
    assert.equal(wall.overrides.wall_height, 2.6, label);
  }
});

test('removing a room releases the chosen value on the wall left behind', () => {
  const plan = attachedNew();
  plan.answer(plan.move(-6.8, true), 'New');
  assert.equal(plan.apply({ type: 'remove_room', roomId: plan.room('New').id }).status, 'applied');
  const bottom = plan.wallAt('Bedroom', 3.1);
  assert.equal(own(bottom, 'wall_height'), false);
  assert.equal(bottom.properties.wall_height, 3);
});

test('a chosen thickness is released only when it equals the inherited one', () => {
  for (const [thickness, released] of [
    [0.2, true],
    [0.3, false],
  ]) {
    const first = attachedNew();
    first.answer(first.move(-6.8, true), 'New');
    if (thickness !== 0.2) {
      const shared = first.wallAt('Bedroom', 3.1);
      first.apply({
        type: 'set_property',
        faceId: first.faceOf('Bedroom', shared).id,
        property: 'wall_thickness',
        value: thickness,
      });
    }
    // Mark the shared wall's thickness as chosen, as a thickness question would.
    const snapshot = first.session.getSnapshot();
    const wall = snapshot.floors[0].walls.find((entry) => entry.exposure === 'interior');
    wall.overrides.wall_thickness = thickness;
    wall.sharedChoices = ['wall_height', 'wall_thickness'];
    const plan = sharedValuePlan({ snapshot, idPrefix: 'again' });
    const result = plan.apply({
      type: 'move_room',
      roomId: plan.room('New').id,
      delta: { x: 0, y: 2 },
      attach: false,
    });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const bottom = plan.wallAt('Bedroom', thickness === 0.2 ? 3.1 : 3.15);
    assert.equal(own(bottom, 'wall_height'), false, `height released (${thickness})`);
    assert.equal(own(bottom, 'wall_thickness'), !released, `thickness ${thickness}`);
    assert.equal(bottom.properties.wall_thickness, thickness);
  }
});

test('the chosen mark is kept in the record', () => {
  const plan = attachedNew();
  plan.answer(plan.move(-6.8, true), 'New');
  const record = writeBuildingPlanRecord({
    meta: plan.meta,
    record: { values: {}, repeatable: {} },
    plan: plan.session.getSnapshot(),
  });
  const read = readBuildingPlanRecord({ meta: plan.meta, record });
  const wall = read.floors[0].walls.find((entry) => entry.sharedChoices);
  assert.deepEqual(wall?.sharedChoices, ['wall_height']);
  assert.equal(wall.overrides.wall_height, 2.5);
});
