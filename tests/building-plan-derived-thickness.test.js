import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { usesDerivedPath } from '../src/building-plan/derive/derived-edit.js';

const round = (value) => Math.round(value * 1000) / 1000 + 0;

/** The example on today's engine or the derived core. */
function example(derived, editingPolicy = {}) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `t-${++serial}`,
    derivedCommands: derived,
    editingPolicy,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const rooms = () => floor().rooms;
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  return { f, session, floor, apply, rooms, wall };
}

/** Corners and cuts of every room (collinear stations left out), rounded to 1 mm. */
function shape(floor) {
  return floor.rooms.map((room) => {
    const v = room.vertices;
    return v
      .filter((b, i) => {
        const [a, c] = [v[(i + v.length - 1) % v.length], v[(i + 1) % v.length]];
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        return b.editingCutId || Math.abs(cross) / Math.hypot(c.x - a.x, c.y - a.y) > 1.5e-4;
      })
      .map((p) => `${round(p.x)},${round(p.y)}${p.editingCutId ? ':cut' : ''}`);
  });
}

/** The same steps on both engines: statuses, refusal codes and outlines must match each time. */
function bothEngines(steps, editingPolicy = {}) {
  const [now, derived] = [example(false, editingPolicy), example(true, editingPolicy)];
  const results = [];
  for (const step of steps) {
    const [a, b] = [now, derived].map((t) => step(t));
    assert.equal(b.status, a.status, JSON.stringify(b.issues));
    assert.equal(b.issues?.[0]?.code, a.issues?.[0]?.code);
    assert.deepEqual(shape(derived.floor()), shape(now.floor()));
    results.push(b);
  }
  assert.deepEqual(derived.session.validate(), []);
  return { now, derived, results };
}

const thickness = (t, value, extra = {}) =>
  t.apply({
    type: 'set_property',
    wallId: t.f.wallId,
    property: 'wall_thickness_m',
    value,
    ...extra,
  });

test('property operations, and batches made only of them, run on the derived core (J3)', () => {
  for (const type of ['set_property', 'set_defaults', 'set_provider'])
    assert.ok(usesDerivedPath({ type }), type);
  const property = { type: 'set_property', property: 'material', value: 'Wood' };
  assert.ok(usesDerivedPath({ type: 'batch', operations: [property, property] }));
  assert.ok(!usesDerivedPath({ type: 'batch', operations: [property, { type: 'set_values' }] }));
  assert.ok(!usesDerivedPath({ type: 'batch', operations: [] }));
});

test('a thicker shared wall keeps the anchor room; the neighbour notches round its wall (R2)', () => {
  // A (0..5 x 0..3) anchors; B's stretch moves 0.05 into B, and its jog lands past A's east
  // wall (x = 5.2) instead of at the shared wall's end, as today.
  const { derived, results } = bothEngines([
    (t) => thickness(t, 0.25, { activeRoomId: t.rooms()[0].id }),
  ]);
  const [a, b] = derived.rooms();
  assert.deepEqual(shape(derived.floor())[1].slice(0, 4), [
    '3,3.25',
    '5.2,3.25',
    '5.2,3.2',
    '8,3.2',
  ]);
  assert.deepEqual(results[0].carvedRoomIds, [b.id]);
  assert.deepEqual(shape(derived.floor())[0], shape(example(true).floor())[0], a.id);
});

test("midline moves both rooms by half, each notching round the other room's wall", () => {
  const { results } = bothEngines([(t) => thickness(t, 0.4, { activeRoomId: t.rooms()[0].id })], {
    thicknessAnchor: 'midline',
  });
  assert.equal(results[0].carvedRoomIds.length, 2);
});

test('a wall made thinner again restores the outline it had (round trip)', () => {
  const t = example(true);
  const start = shape(t.floor());
  const active = t.rooms()[0].id;
  for (const value of [0.4, 0.3, 0.2]) {
    const result = thickness(t, value, { activeRoomId: active });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    if (value === 0.3) assert.deepEqual(result.carvedRoomIds, []);
  }
  assert.deepEqual(shape(t.floor()), start);
  assert.deepEqual(t.session.validate(), []);
});

test('floor defaults change every wall in one command, notches at the new widths', () => {
  const provider = (fieldName, value) => ({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName,
    property: 'wall_thickness_m',
    value,
  });
  bothEngines([
    (t) =>
      t.apply({
        type: 'batch',
        operations: [
          { floorId: t.f.floorId, ...provider('floor_exterior_wall_thickness', 0.5) },
          { floorId: t.f.floorId, ...provider('floor_interior_wall_thickness', 0.5) },
        ],
      }),
  ]);
  // Under midline every exterior face moves in by half the change (today refuses this one,
  // `unbound_room_face`).
  const t = example(true, { thicknessAnchor: 'midline' });
  const result = t.apply(provider('floor_exterior_wall_thickness', 0.3));
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.deepEqual(t.session.validate(), []);
  const [a, b] = shape(t.floor());
  assert.ok(['0.05,0.05', '4.95,0.05', '0.05,2.95'].every((corner) => a.includes(corner)));
  assert.ok(['7.95,3.25', '7.95,6.15', '3.05,6.15'].every((corner) => b.includes(corner)));
});

test('a thicker Split portion steps at the cut, as today', () => {
  let cut = null;
  bothEngines([
    (t) => {
      const result = t.apply({ type: 'split_face', faceId: t.f.faceA, offset: 0.5 });
      cut = result.created.id;
      return result;
    },
    (t) => {
      // The portion of the shared wall west of the cut (3..4.5), anchored at B: A moves.
      const portion = t
        .floor()
        .walls.find(
          (wall) =>
            wall.exposure === 'interior' &&
            Math.min(wall.segments[0].start.x, wall.segments[0].end.x) < 4
        );
      return t.apply({
        type: 'set_property',
        wallId: portion.id,
        property: 'wall_thickness_m',
        value: 0.4,
        activeRoomId: t.rooms()[1].id,
      });
    },
  ]);
  assert.ok(cut);
});

test('an exterior wall grows outward under room_face and moves the room by half under midline', () => {
  const exterior = (t) =>
    t.apply({
      type: 'set_property',
      wallId: t.wall('W1').id,
      property: 'wall_thickness_m',
      value: 0.4,
    });
  const kept = bothEngines([exterior]);
  assert.deepEqual(shape(kept.derived.floor()), shape(example(true).floor()));
  const moved = bothEngines([exterior], { thicknessAnchor: 'midline' });
  assert.ok(shape(moved.derived.floor())[0].includes('0,0.1'));
});

test('an explicitly unknown thickness keeps the geometry; a negative one refuses', () => {
  const { derived } = bothEngines([(t) => thickness(t, null), (t) => thickness(t, -0.1)]);
  assert.deepEqual(shape(derived.floor()), shape(example(true).floor()));
});

test('rooms disagreeing on defaults: the chosen width moves the rooms as today', () => {
  for (const pick of ['candidate:0', 'candidate:1']) {
    const outcome = [false, true].map((derived) => {
      const t = example(derived);
      const [a, b] = t.rooms();
      const defaults = (room, value) =>
        t.apply({ type: 'set_defaults', roomId: room.id, property: 'wall_thickness_m', value });
      assert.equal(defaults(a, 0.2).status, 'applied');
      const pending = defaults(b, 0.3);
      assert.equal(pending.status, 'pending', JSON.stringify(pending.issues));
      const requestId = pending.uiOperations[0].params.requestId;
      const done = t.session.resolveUIRequest(requestId, { value: pick });
      assert.equal(done.status, 'applied', JSON.stringify(done.issues));
      if (derived) assert.deepEqual(t.session.validate(), []);
      return shape(t.floor());
    });
    assert.deepEqual(outcome[1], outcome[0], pick);
  }
});
