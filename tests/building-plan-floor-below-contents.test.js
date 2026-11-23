import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// U6 (2026-11-23): free walls and columns pull to the floor below as rooms do (F3): its wall
// bands' corners and faces, lining up with its corners; a moved free wall's side flush with a face
// below running with it (stacked on the wall below); a column's centre over a column below's
// centre, whatever their sizes. Each pull rings the point it took (a guide marked `below`); one
// that places the whole element (stacked, centred over) rings its grip (`grip`).
//
// The example's ground floor (canvas units, 20 a metre): the Bedroom 0..100 × 0..60 with a 0.4 m
// column centred at (30, 30); the band of the wall it shares with Room 2 at y 60..64; Room 2's
// left wall band at x 56..60, y 64..124. Above, at elevation 3, one room over all of it.

async function upperFloor() {
  const f = createBuildingPlanExample();
  let record = f.record;
  const options = (extra = {}) => ({
    meta: f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
    ...extra,
  });
  const ground = new BuildingPlanCanvasController(options());
  const bedroom = ground.getSnapshot().rooms[0];
  await ground.createColumn(bedroom.id, { centerU: 0.3, centerV: 0.5, width: 0.4, height: 0.4 });
  const upper = await ground.createFloor({ floor_elevation: 3 });
  ground.dispose();
  const controller = new BuildingPlanCanvasController(options({ floorId: upper.id }));
  await controller.createRoom({ x: -20, y: -20, width: 200, height: 160 });
  const roomId = controller.getSnapshot().rooms[0].id;
  return { controller, roomId, interaction: controller.interaction };
}

const rings = (interaction) =>
  interaction.getGuides().filter((guide) => guide.below && guide.from.x === guide.to.x);
const round = (point) => ({ x: +point.x.toFixed(6), y: +point.y.toFixed(6) });

test('a free wall’s end: onto a corner below, onto a face below, lined up with a corner below', async () => {
  const t = await upperFloor();
  const end = (point, options = {}) =>
    t.interaction.snapFreeWallEnd(point, { roomId: t.roomId, zoom: 5, ...options });
  t.interaction.begin();
  // The door's jamb in the shared wall below, at (72, 60).
  assert.deepEqual(end({ x: 72.9, y: 59.4 }), { x: 72, y: 60 });
  assert.deepEqual(rings(t.interaction), [
    { from: { x: 72, y: 60 }, to: { x: 72, y: 60 }, below: true },
  ]);
  // Alt: the 1 cm step only.
  assert.deepEqual(round(end({ x: 72.9, y: 59.4 }, { bypass: true })), { x: 73, y: 59.4 });
  // The shared wall's face below, at y 60.
  assert.deepEqual(end({ x: 30, y: 60.9 }), { x: 30, y: 60 });
  assert.deepEqual(rings(t.interaction)[0].from, { x: 30, y: 60 });
  // Far from any face, lined up with the jamb's x: the guide from the corner below.
  assert.equal(end({ x: 72.8, y: 100 }).x, 72);
  const [guide] = t.interaction.getGuides();
  assert.equal(guide.below, true);
  assert.equal(guide.from.x, 72);
  // The floor below's switch off: no pull.
  t.controller.setFloorBelowPulls(false);
  t.interaction.begin();
  assert.deepEqual(round(end({ x: 72.9, y: 59.4 })), { x: 73, y: 59.4 });
  assert.equal(t.interaction.getGuides().length, 0);
  t.controller.dispose();
});

test('a moved free wall stacks on the wall below: both sides flush, not its centreline on a face', async () => {
  const t = await upperFloor();
  await t.controller.createWall(t.roomId, [
    { x: 10, y: 100 },
    { x: 50, y: 100 },
  ]);
  const wall = t.controller.getSnapshot().walls.find((entry) => entry.roomId === t.roomId);
  const half = (wall.thickness * 20) / 2;
  assert.equal(half, 2, 'as thick as the wall below');
  t.interaction.begin();
  // At zoom 4 (reach 2): its centreline 0.4 off the face at 64, where an end meeting a face would
  // put it (half off the wall below); each side 1.6 off a face. It stacks.
  const moved = t.interaction.snapFreeWallTranslation(
    [
      { x: 10, y: 63.6 },
      { x: 50, y: 63.6 },
    ],
    { roomId: t.roomId, wallId: wall.id, zoom: 4, originalPoints: wall.points }
  );
  assert.deepEqual(moved.map(round), [
    { x: 10, y: 62 },
    { x: 50, y: 62 },
  ]);
  // Around the wall's grip, at its middle.
  const [ring] = rings(t.interaction);
  assert.deepEqual(round(ring.from), { x: 30, y: 62 });
  assert.equal(ring.grip, 'wall');
  t.controller.dispose();
});

// Asked at U6's hand test (2026-11-23): near the W3.2 / W8 junction below (x 56..60), a corner of
// the band took the wall's centreline end (zoomed out), or the junction's face its end alone
// (zoomed in), leaving the wall half off the wall below. It stays stacked, its end on the face.
test('a wall stacked near a junction below keeps the stack, its end on the crossing face', async () => {
  const t = await upperFloor();
  await t.controller.createWall(t.roomId, [
    { x: 10, y: 100 },
    { x: 50, y: 100 },
  ]);
  const wall = t.controller.getSnapshot().walls.find((entry) => entry.roomId === t.roomId);
  // Its centreline 0.6 off the band's middle (62), its end 0.4 past the junction's face (60).
  const near = [
    { x: 60.4, y: 61.4 },
    { x: 100.4, y: 61.4 },
  ];
  for (const zoom of [3, 7.5]) {
    t.interaction.begin();
    const moved = t.interaction.snapFreeWallTranslation(near, {
      roomId: t.roomId,
      wallId: wall.id,
      zoom,
      originalPoints: wall.points,
    });
    assert.deepEqual(moved.map(round), [
      { x: 60, y: 62 },
      { x: 100, y: 62 },
    ]);
    // A ring around its grip, and a small one where its end meets the face.
    assert.deepEqual(
      rings(t.interaction).map((ring) => ({ at: round(ring.from), grip: ring.grip ?? null })),
      [
        { at: { x: 80, y: 62 }, grip: 'wall' },
        { at: { x: 60, y: 62 }, grip: null },
      ]
    );
  }
  t.controller.dispose();
});

test('a column’s centre over the column below, whatever their sizes', async () => {
  const t = await upperFloor();
  t.interaction.begin();
  const centre = t.interaction.snapColumn(
    { x: 31, y: 29.2 },
    { roomId: t.roomId, width: 0.3, height: 0.3, zoom: 5 }
  );
  assert.deepEqual(round(centre), { x: 30, y: 30 });
  // Around the column's grip, at the centre below.
  assert.deepEqual(rings(t.interaction), [
    { from: { x: 30, y: 30 }, to: { x: 30, y: 30 }, below: true, grip: 'column' },
  ]);
  t.controller.dispose();
});

test('a column’s side flush with a face below; a corner into a corner below', async () => {
  const t = await upperFloor();
  t.interaction.begin();
  // Its right side 0.7 left of Room 2's wall band below (x 56), half-way down it.
  const flush = t.interaction.snapColumn(
    { x: 52.3, y: 90 },
    { roomId: t.roomId, width: 0.3, height: 0.3, zoom: 5 }
  );
  assert.equal(+flush.x.toFixed(6), 53);
  assert.deepEqual(round(rings(t.interaction)[0].from), { x: 56, y: 90 });
  // Its top left corner near the jamb at (72, 64), below the shared wall.
  const corner = t.interaction.snapColumn(
    { x: 75.6, y: 66.8 },
    { roomId: t.roomId, width: 0.3, height: 0.3, zoom: 5 }
  );
  assert.deepEqual(round(corner), { x: 75, y: 67 });
  assert.deepEqual(rings(t.interaction)[0].from, { x: 72, y: 64 });
  t.controller.dispose();
});

// A drawn free wall stacking on the wall below (2026-11-23, from U6's hand test): its walls'
// midlines and where they meet pull a drawn end, so the wall stands on the middle of the wall
// below; a moved wall may go centred on it as well as flush with a face, the nearer winning.
test('a drawn free wall’s end onto where midlines below meet, or onto a midline; the next end stays on it', async () => {
  const t = await upperFloor();
  const end = (point, options = {}) =>
    t.interaction.snapFreeWallEnd(point, { roomId: t.roomId, zoom: 5, ...options });
  t.interaction.begin();
  // Where the shared wall's midline (y 62) meets Room 2's wall's (x 58), nearer than any corner.
  assert.deepEqual(round(end({ x: 58.9, y: 62.6 })), { x: 58, y: 62 });
  assert.deepEqual(rings(t.interaction)[0].from, { x: 58, y: 62 });
  // On the shared wall's midline, nearer than its face at 64.
  const start = end({ x: 30, y: 62.7 });
  assert.deepEqual(round(start), { x: 30, y: 62 });
  // The other end, drawn along it, keeps to it.
  assert.deepEqual(round(end({ x: 50, y: 62.5 }, { from: start })), { x: 50, y: 62 });
  t.controller.dispose();
});

test('a moved thinner free wall goes centred on the wall below, or flush with a face, the nearer', async () => {
  const t = await upperFloor();
  await t.controller.createWall(t.roomId, [
    { x: 10, y: 100 },
    { x: 50, y: 100 },
  ]);
  let wall = t.controller.getSnapshot().walls.find((entry) => entry.roomId === t.roomId);
  assert.ok(
    await t.controller.apply({
      type: 'set_property',
      floorId: t.controller.floorId,
      wallId: wall.physicalWallId,
      activeRoomId: t.roomId,
      property: 'wall_thickness',
      value: 0.1,
    })
  );
  wall = t.controller.getSnapshot().walls.find((entry) => entry.roomId === t.roomId);
  assert.equal(wall.thickness, 0.1);
  const move = (y) => {
    t.interaction.begin();
    return t.interaction
      .snapFreeWallTranslation(
        [
          { x: 10, y },
          { x: 50, y },
        ],
        { roomId: t.roomId, wallId: wall.id, zoom: 4, originalPoints: wall.points }
      )
      .map(round);
  };
  // 0.3 off the band's middle (62), a side 0.7 off its face: centred.
  assert.deepEqual(move(62.3), [
    { x: 10, y: 62 },
    { x: 50, y: 62 },
  ]);
  assert.equal(rings(t.interaction)[0].grip, 'wall');
  // 1.2 off the middle, a side 0.2 off the face at 64: flush.
  assert.deepEqual(move(63.2), [
    { x: 10, y: 63 },
    { x: 50, y: 63 },
  ]);
  t.controller.dispose();
});
