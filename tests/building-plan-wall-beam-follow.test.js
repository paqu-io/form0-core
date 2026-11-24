import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Wall beams 2b (2026-11-24; WB5, WB8, P2): a beam's end at its wall's end follows it; its height
// is pushed by what runs into it (2e: an opening's head under it, the wall's top, a room's clear
// height), never pulled; a beam typed into an opening, or above its wall, refuses the edit. The
// example's Bedroom is 0..5 × 0..3, its walls 3 m high: W1 above (5 m, from x = 0, its left end
// seen from the room), W2 right, W4 left; W3 shared, its Shared door 2 m high.

function example(snapshot = null) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: snapshot || f.snapshot,
    properties: f.meta.properties,
    createId: () => `c-${++serial}`,
    derivedCommands: true,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  const face = (label) => floor().rooms[0].faces.find((entry) => entry.wallId === wall(label).id);
  const beam = (label, offset, length, extra = {}) =>
    apply({
      type: 'create_opening',
      kind: 'beam',
      wallId: wall(label).id,
      offset,
      length,
      width: 0.2,
      depth: 0.3,
      underside: 2.7,
      values: {},
      ...extra,
    });
  return { f, session, floor, apply, wall, face, beam };
}
const round = (value) => Math.round(value * 1000) / 1000 + 0;
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));
const refusal = (result) => {
  assert.equal(result.status, 'conflict', JSON.stringify(result));
  return result.issues[0].message;
};
const spans = (t, label) =>
  t.wall(label).beams.map((entry) => [round(entry.offset), round(entry.offset + entry.length)]);

test("an end at its wall's end follows it, out and in; a free end keeps its place", () => {
  const t = example();
  applied(t.beam('W1', 0, 5));
  applied(t.beam('W1', 1, 2));
  applied(t.apply({ type: 'resize_face', faceId: t.face('W2').id, distance: 0.5 }));
  assert.deepEqual(spans(t, 'W1'), [
    [0, 5.5],
    [1, 3],
  ]);
  applied(t.apply({ type: 'resize_face', faceId: t.face('W2').id, distance: -1 }));
  assert.deepEqual(spans(t, 'W1'), [
    [0, 4.5],
    [1, 3],
  ]);
  // The left wall moved out: the whole-wall beam starts at the new end; the other keeps its place
  // on the floor (from 1.5 m along the longer wall).
  applied(t.apply({ type: 'resize_face', faceId: t.face('W4').id, distance: 0.5 }));
  assert.deepEqual(spans(t, 'W1'), [
    [0, 5],
    [1.5, 3.5],
  ]);
});

test('one end at the wall: that end follows; past the free end, refused, named', () => {
  const t = example();
  applied(t.beam('W1', 0, 1));
  applied(t.apply({ type: 'resize_face', faceId: t.face('W4').id, distance: 0.5 }));
  assert.deepEqual(spans(t, 'W1'), [[0, 1.5]]);
  assert.equal(
    refusal(t.apply({ type: 'resize_face', faceId: t.face('W4').id, distance: -2 })),
    'Beam B#1 would be too short.'
  );
});

test("heights pushed: a lintel by the door's head, a top beam by the wall's top, a room beam by the ceiling", () => {
  const t = example();
  const wallHeight = (value) =>
    t.apply({
      type: 'set_property',
      property: 'wall_height',
      value,
      nodeKey: 'walls',
      scope: 'physical_wall',
      wallId: t.wall('W1').id,
      faceId: t.face('W1').id,
      activeRoomId: t.floor().rooms[0].id,
    });
  const floorHeight = (value) =>
    t.apply({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: 'floor_height',
      property: 'room_structural_clear_height',
      value,
    });
  applied(t.beam('W3', 0.35, 1.2, { underside: 2, depth: 0.25 }));
  applied(t.beam('W1', 0, 5));
  const door = t.wall('W3').doors[0];
  applied(
    t.apply({ type: 'update_opening', wallId: t.wall('W3').id, openingId: door.id, height: 2.1 })
  );
  assert.equal(t.wall('W3').beams[0].underside, 2.1);
  // Deeper, the top beam grows downwards; the wall higher, it stays; lower, it's pushed down.
  const top = t.wall('W1').beams[0];
  applied(
    t.apply({ type: 'update_opening', wallId: t.wall('W1').id, openingId: top.id, depth: 0.4 })
  );
  assert.equal(t.wall('W1').beams[0].underside, 2.6);
  applied(wallHeight(3.2));
  assert.equal(t.wall('W1').beams[0].underside, 2.6);
  applied(wallHeight(2.9));
  assert.equal(t.wall('W1').beams[0].underside, 2.5);
  applied(
    t.apply({
      type: 'create_element',
      roomId: t.floor().rooms[0].id,
      collection: 'beams',
      element: { start: { x: 0, y: 1.5 }, end: { x: 5, y: 1.5 }, width: 0.15, height: 0.3 },
      values: {},
    })
  );
  const roomBeam = () => t.floor().rooms[0].beams[0].values.beam_distance_from_floor;
  assert.equal(roomBeam(), 2.7);
  applied(floorHeight(3.4));
  assert.equal(roomBeam(), 2.7);
  applied(floorHeight(2.8));
  assert.equal(roomBeam(), 2.5);
});

test('a beam typed into an opening, or above its wall, refuses the edit, named', () => {
  const t = example();
  const w1 = t.wall('W1').id;
  applied(
    t.apply({
      type: 'create_opening',
      wallId: w1,
      kind: 'window',
      offset: 1.9,
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
      values: {},
    })
  );
  applied(t.beam('W1', 1.75, 1.5, { underside: 2.4, depth: 0.2 }));
  const [beam] = t.wall('W1').beams;
  // An opening rising into it pushes it up since (a): `building-plan-wall-beam-push.test.js`.
  assert.equal(
    refusal(t.apply({ type: 'update_opening', wallId: w1, openingId: beam.id, underside: 2 })),
    'Beam B#1 would run into Window 1.'
  );
  assert.equal(
    refusal(t.apply({ type: 'update_opening', wallId: w1, openingId: beam.id, underside: 2.9 })),
    'Beam B#1 would stand above its wall.'
  );
  // Resting on the window's head, or under its sill, is allowed.
  applied(t.apply({ type: 'update_opening', wallId: w1, openingId: beam.id, underside: 2.1 }));
  applied(t.apply({ type: 'update_opening', wallId: w1, openingId: beam.id, underside: 0.7 }));
});

test('a clash already in the record refuses no unrelated edit', () => {
  const t = example();
  applied(
    t.apply({
      type: 'create_opening',
      wallId: t.wall('W1').id,
      kind: 'window',
      offset: 1.9,
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
      values: {},
    })
  );
  applied(t.beam('W1', 1.75, 1.5, { underside: 2.4, depth: 0.2 }));
  const snapshot = t.session.getSnapshot();
  snapshot.floors[0].walls.find((wall) => wall.autoLabel === 'W1').beams[0].underside = 1.5;
  const old = example(snapshot);
  applied(old.apply({ type: 'resize_face', faceId: old.face('W2').id, distance: 0.5 }));
});
