import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { equalValue } from '../src/building-plan/model.js';
import { areJsonValuesEqual } from '../src/utilities/value-equality.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

test('plan data compares by content: key order does not matter, an undefined property is absent', () => {
  for (const equal of [equalValue, areJsonValuesEqual]) {
    assert.ok(
      equal(
        { a: 1, b: { c: 2, d: [3, { e: 4, f: 5 }] } },
        { b: { d: [3, { f: 5, e: 4 }], c: 2 }, a: 1 }
      )
    );
    assert.ok(equal({ a: 1, b: undefined }, { a: 1 }));
    assert.ok(equal(null, null) && equal(0, -0) && equal('x', 'x'));
    assert.ok(!equal([1, 2], [2, 1]), 'array order matters');
    assert.ok(!equal({ a: 1 }, { a: 2 }));
    assert.ok(!equal({ a: 1 }, { a: 1, b: null }));
    assert.ok(!equal({ a: [1] }, { a: { 0: 1 } }));
    assert.ok(!equal(null, {}) && !equal(1, '1'));
  }
});

/**
 * Manual round, session 4762a5d9: on the derived core, walls an edit rebuilds can list their keys
 * in another order than walls it creates. Undo checks that the plan still holds what an edit
 * produced: by content, not by key order.
 */
function session() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const plan = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `h-${++serial}`,
    derivedCommands: true,
    editingPolicy: { inheritedChangePolicy: 'apply', thicknessAnchor: 'midline' },
  });
  const applied = (operation, options) => {
    const result = plan.apply({ floorId: f.floorId, ...operation }, options);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return plan.getSnapshot();
  };
  const edits = (options) => {
    const created = applied(
      {
        type: 'create_room',
        attach: true,
        attachmentTolerance: 0.25,
        rectangle: { x: 10.2286, y: -0.9006, width: 4.9604, height: 3.1058 },
      },
      options
    );
    const roomId = created.floors[0].rooms.at(-1).id;
    const moved = applied(
      {
        type: 'move_room',
        attach: true,
        attachmentTolerance: 0.25,
        roomId,
        delta: { x: 0.0223, y: 2.5101 },
      },
      options
    );
    return [created, moved];
  };
  const thicker = applied({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness',
    value: 0.5,
  });
  return { plan, thicker, edits };
}

test('derived edits undo and redo one after another', () => {
  const t = session();
  const [created, moved] = t.edits();
  const states = [t.thicker, created, moved];
  for (const expected of [created, t.thicker]) {
    const result = t.plan.undo();
    assert.equal(result.status, 'undone', JSON.stringify(result.issues));
    assert.deepEqual(t.plan.getSnapshot(), expected);
  }
  for (const expected of states.slice(1)) {
    const result = t.plan.redo();
    assert.equal(result.status, 'redone', JSON.stringify(result.issues));
    assert.deepEqual(t.plan.getSnapshot(), expected);
  }
});

test('cancelling an editor reverts all of its derived edits', () => {
  const t = session();
  const scope = t.plan.beginScope({ id: 'room-editor' });
  assert.equal(scope.status, 'opened', JSON.stringify(scope.issues));
  t.edits({ scopeId: 'room-editor' });
  const result = t.plan.cancelScope('room-editor');
  assert.equal(result.status, 'cancelled', JSON.stringify(result.issues));
  assert.deepEqual(t.plan.getSnapshot(), t.thicker);
});
