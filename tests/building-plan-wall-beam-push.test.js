import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Decided 2026-11-24, (a): an opening rising into a beam above it pushes the beam up, as far as the
// wall's top; one edit or two give the same result (before, one was refused and two carried it).
// 2e, "push, never pull": a sill dropping pushes a beam below down; lowering a head or raising a
// sill leaves the beam. The example's W1 runs above the Bedroom, 5 m from x = 0, 3 m high.

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
  const w1 = () => floor().walls.find((entry) => entry.autoLabel === 'W1');
  const window = (offset, height) =>
    apply({
      type: 'create_opening',
      wallId: w1().id,
      kind: 'window',
      offset,
      width: 1.2,
      height,
      sillHeight: 0.9,
      values: {},
    });
  const beam = (offset, length, underside) =>
    apply({
      type: 'create_opening',
      kind: 'beam',
      wallId: w1().id,
      offset,
      length,
      width: 0.2,
      depth: 0.2,
      underside,
      values: {},
    });
  const raise = (index, height) =>
    apply({ type: 'update_opening', wallId: w1().id, openingId: w1().windows[index].id, height });
  const underside = () => w1().beams[0].underside;
  return { apply, w1, window, beam, raise, underside };
}
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));

test('a window raised into a beam pushes it up, in one edit as in two', () => {
  const one = example();
  applied(one.window(1.9, 1.4));
  applied(one.beam(1.75, 1.5, 2.4));
  applied(one.raise(0, 1.55));
  assert.equal(one.underside(), 2.45);
  const two = example();
  applied(two.window(1.9, 1.4));
  applied(two.beam(1.75, 1.5, 2.4));
  applied(two.raise(0, 1.5));
  applied(two.raise(0, 1.55));
  assert.equal(two.underside(), 2.45);
});

test("pushed past the wall's top, refused; lowered, the window leaves the beam where it is", () => {
  const t = example();
  applied(t.window(0.2, 1.4));
  applied(t.window(2, 1.2));
  applied(t.beam(0, 3.5, 2.4));
  assert.equal(t.raise(0, 2).issues?.[0]?.message, 'Beam B#1 would stand above its wall.');
  applied(t.raise(0, 1.6));
  assert.equal(t.underside(), 2.5);
  applied(t.raise(0, 1));
  assert.equal(t.underside(), 2.5);
});

test('a sill dropping onto a beam below pushes it down, never below the floor', () => {
  const t = example();
  applied(t.window(1.9, 1.2));
  applied(t.beam(1.75, 1.5, 0.7)); // its top (depth 0.2) at the window's sill, 0.9
  const sill = (value) =>
    t.apply({
      type: 'update_opening',
      wallId: t.w1().id,
      openingId: t.w1().windows[0].id,
      sillHeight: value,
    });
  applied(sill(0.8));
  assert.equal(t.underside(), 0.6);
  applied(sill(1));
  assert.equal(t.underside(), 0.6);
  assert.equal(sill(0.1).issues?.[0]?.message, 'Beam B#1 would go below the floor.');
});

test('a window moved along the wall into a beam is still refused', () => {
  const t = example();
  applied(t.window(0.2, 1.6));
  applied(t.beam(3, 1.5, 2.4));
  const result = t.apply({
    type: 'update_opening',
    wallId: t.w1().id,
    openingId: t.w1().windows[0].id,
    offset: 2.5,
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].message, 'Window 1 would run into Beam B#1.');
});
