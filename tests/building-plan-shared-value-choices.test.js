import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedValuePlan } from './helpers/building-plan-shared-values.js';

// The 2026-11-16 web retest, option (a): when walls join and one of them has its own value that
// differs from the other's (own or inherited), the edit asks once per wall; several differences
// are summarised in one question.

const message = (result) => result.uiOperations[0].params.message;
const buttons = (result) => result.uiOperations[0].params.buttons.map((button) => button.label);

/** Bedroom, and New below it with its top wall typed `height` m, ready to attach. */
function typedNew(height, { bedroomHeight = null } = {}) {
  const plan = sharedValuePlan();
  plan.createRoom('Bedroom', { x: 0, y: 0, width: 4, height: 3 });
  plan.createRoom('New', { x: 0, y: 10, width: 4, height: 3 });
  const top = plan.wallAt('New', 9.9);
  plan.apply({
    type: 'set_property',
    faceId: plan.faceOf('New', top).id,
    property: 'wall_height',
    value: height,
  });
  if (bedroomHeight != null) {
    const bottom = plan.wallAt('Bedroom', 3.1);
    plan.apply({
      type: 'set_property',
      faceId: plan.faceOf('Bedroom', bottom).id,
      property: 'wall_height',
      value: bedroomHeight,
    });
  }
  const attach = () =>
    plan.apply({
      type: 'move_room',
      roomId: plan.room('New').id,
      delta: { x: 0, y: -6.8 },
      attach: true,
    });
  return { ...plan, attach };
}

test('a typed height meeting an inherited one asks; the inherited answer is marked as chosen', () => {
  const plan = typedNew(2.7);
  const asked = plan.attach();
  assert.equal(asked.status, 'pending');
  assert.equal(
    message(asked),
    'Wall W3 is shared by Bedroom and New, which give different values for Height. Choose the one that applies to this wall; you can still change it on the wall later.'
  );
  assert.deepEqual(buttons(asked), ['Bedroom: 3 m', 'New: 2.7 m', 'Cancel edit']);
  assert.equal(plan.answer(asked, 'Bedroom').status, 'applied');
  const shared = plan.wallAt('Bedroom', 3.1);
  assert.equal(shared.exposure, 'interior');
  assert.equal(shared.overrides.wall_height, 3);
  assert.deepEqual(shared.sharedChoices, ['wall_height']);
});

test('choosing the typed value keeps it typed; Cancel leaves the plan as it was', () => {
  const plan = typedNew(2.7);
  const before = plan.session.getSnapshot();
  const cancelled = plan.answer(plan.attach(), 'Cancel');
  assert.notEqual(cancelled.status, 'applied');
  assert.deepEqual(plan.session.getSnapshot(), before);
  assert.equal(plan.answer(plan.attach(), 'New').status, 'applied');
  const shared = plan.wallAt('Bedroom', 3.1);
  assert.equal(shared.overrides.wall_height, 2.7);
  assert.equal(shared.sharedChoices, undefined);
});

test('two different typed heights ask instead of refusing the join', () => {
  const plan = typedNew(2.7, { bedroomHeight: 2.8 });
  const asked = plan.attach();
  assert.equal(asked.status, 'pending');
  assert.deepEqual(buttons(asked), ['Bedroom: 2.8 m', 'New: 2.7 m', 'Cancel edit']);
  assert.equal(plan.answer(asked, 'New').status, 'applied');
  assert.equal(plan.wallAt('Bedroom', 3.1).overrides.wall_height, 2.7);
});

test('several differences of one wall are summarised in one question', () => {
  const plan = typedNew(2.7);
  for (const [label, y, text] of [
    ['Bedroom', 3.1, 'South wall'],
    ['New', 9.9, 'North wall'],
  ])
    plan.apply({
      type: 'set_values',
      faceId: plan.faceOf(label, plan.wallAt(label, y)).id,
      scope: 'physical_wall',
      values: { wall_label: text },
    });
  const asked = plan.attach();
  assert.equal(
    message(asked),
    'Wall W3 is shared by Bedroom and New, which give different values: Height (Bedroom 3 m, New 2.7 m); Wall label (Bedroom South wall, New North wall). Choose whose values apply to this wall; you can still change each one on the wall later.'
  );
  assert.deepEqual(buttons(asked), ["Bedroom's values", "New's values", 'Cancel edit']);
  assert.equal(plan.answer(asked, 'New').status, 'applied');
  const shared = plan.wallAt('Bedroom', 3.1);
  assert.equal(shared.overrides.wall_height, 2.7);
  assert.equal(shared.values.wall_label, 'North wall');
});

test('one edit joining two walls asks for each wall in turn', () => {
  const plan = sharedValuePlan();
  plan.createRoom('Bedroom', { x: 0, y: 0, width: 4, height: 3 });
  plan.createRoom('Kitchen', { x: 4.2, y: 0, width: 4, height: 3 });
  plan.createRoom('New', { x: 0, y: 10, width: 8.2, height: 3 });
  plan.apply({
    type: 'set_property',
    faceId: plan.faceOf('New', plan.wallAt('New', 9.9)).id,
    property: 'wall_height',
    value: 2.7,
  });
  const first = plan.apply({
    type: 'move_room',
    roomId: plan.room('New').id,
    delta: { x: 0, y: -6.8 },
    attach: true,
  });
  assert.equal(first.status, 'pending');
  const firstRoom = /shared by (\w+) and New/.exec(message(first))[1];
  const second = plan.answer(first, firstRoom);
  assert.equal(second.status, 'pending');
  const secondRoom = /shared by (\w+) and New/.exec(message(second))[1];
  assert.deepEqual([firstRoom, secondRoom].sort(), ['Bedroom', 'Kitchen']);
  assert.equal(plan.answer(second, secondRoom).status, 'applied');
  for (const label of ['Bedroom', 'Kitchen'])
    assert.equal(plan.wallAt(label, 3.1).overrides.wall_height, 3, label);
});

test('an own thickness that disagrees with the join refuses in plain words (c3)', () => {
  const plan = sharedValuePlan();
  plan.createRoom('Bedroom', { x: 0, y: 0, width: 4, height: 3 });
  plan.createRoom('New', { x: 0, y: 10, width: 4, height: 3 });
  const top = plan.wallAt('New', 9.9);
  plan.apply({
    type: 'set_property',
    faceId: plan.faceOf('New', top).id,
    property: 'wall_thickness',
    value: 0.3,
  });
  const refused = plan.apply({
    type: 'move_room',
    roomId: plan.room('New').id,
    delta: { x: 0, y: -6.8 },
    attach: true,
  });
  assert.equal(refused.status, 'conflict');
  assert.equal(refused.issues[0].code, 'conflicting_wall_properties');
  assert.equal(
    refused.issues[0].message,
    'Wall W5 of New has its own thickness (300 mm), but the wall it joins is 200 mm. Set the same thickness on both walls or reset one, then try again.'
  );
});

test('typing or resetting a chosen value clears its mark', () => {
  for (const edit of [{ value: 2.9 }, { reset: true }]) {
    const plan = typedNew(2.7);
    plan.answer(plan.attach(), 'Bedroom');
    const shared = plan.wallAt('Bedroom', 3.1);
    const result = plan.apply({
      type: 'set_property',
      faceId: plan.faceOf('Bedroom', shared).id,
      property: 'wall_height',
      ...edit,
    });
    // Both rooms are 3 m, so a reset inherits 3 m without a question.
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.equal(plan.wallAt('Bedroom', 3.1).sharedChoices, undefined, JSON.stringify(edit));
  }
});
