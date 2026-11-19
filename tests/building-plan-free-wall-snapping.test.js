import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanInteraction } from '../src/index.js';
import { freeWallTargets } from '../src/building-plan/free-wall-targets.js';
import {
  snapFreeWallEnd,
  snapFreeWallTranslation,
} from '../src/building-plan/free-wall-snapping.js';

// 100 canvas units a metre: the 1 cm step is 1 unit. Room A is 0..1000 square; room B is to its
// right; a free wall W in A stands at x 300..600, y 400 (its body 380..400); a 30 × 30 column in A
// is centred at (800, 800).
const square = (x, y, size) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const view = {
  gridSize: 100,
  rooms: [
    {
      id: 'a',
      vertices: square(0, 0, 1000),
      rect: { x: 0, y: 0, width: 1000, height: 1000 },
    },
    {
      id: 'b',
      vertices: square(1020, 137, 500),
      rect: { x: 1020, y: 137, width: 500, height: 500 },
    },
  ],
  walls: [
    { id: 'face-a', roomId: 'a', isBoundary: true, physicalWallId: 'pa', points: [] },
    {
      id: 'w',
      roomId: 'a',
      isBoundary: false,
      physicalWallId: 'pw',
      points: [
        { x: 300, y: 400 },
        { x: 600, y: 400 },
      ],
    },
    {
      id: 'mine',
      roomId: 'a',
      isBoundary: false,
      physicalWallId: 'pm',
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    },
  ],
  wallFootprints: [
    {
      id: 'pw',
      roomIds: [],
      polygons: [
        [
          { x: 300, y: 380 },
          { x: 600, y: 380 },
          { x: 600, y: 400 },
          { x: 300, y: 400 },
        ],
      ],
    },
    { id: 'pm', roomIds: [], polygons: [square(100, 80, 20)] },
  ],
  columns: [{ roomId: 'a', centerU: 0.8, centerV: 0.8, width: 0.3, height: 0.3 }],
};
const targets = freeWallTargets(view, { roomId: 'a', wallId: 'mine' });
const reach = () => 8;
const snap = (point, extra = {}) =>
  snapFreeWallEnd(point, { targets, gridSize: 100, tolerance: reach, ...extra });

test('targets: the room, the other free walls and the columns in it; the floor to line up with', () => {
  // The room's outline, W's body (not the wall being edited) and the column.
  assert.equal(targets.lines.length, 4 + 4 + 4);
  assert.ok(targets.points.some((p) => p.x === 785 && p.y === 785));
  assert.ok(!targets.points.some((p) => p.x === 100 && p.y === 80));
  // Room B's corners only to line up with.
  assert.ok(targets.align.some((p) => p.y === 137));
  assert.ok(!targets.points.some((p) => p.y === 137));
});

test('an end locks horizontal or vertical, and a corner off the line does not bend it', () => {
  const from = { x: 100, y: 700 };
  assert.deepEqual(snap({ x: 450.4, y: 705 }, { from }).point, { x: 450, y: 700 });
  assert.deepEqual(snap({ x: 104, y: 900.4 }, { from }).point, { x: 100, y: 900 });
  // The column's corner (785, 785) is 5 off a line at y 790: the wall stays horizontal.
  assert.equal(snap({ x: 786, y: 793 }, { from: { x: 100, y: 790 } }).point.y, 790);
});

test('on a locked line the end stops on a line it reaches: a face, a free wall side, a column', () => {
  // Towards W's body from below, vertical: it stops on W's lower side.
  assert.deepEqual(snap({ x: 450, y: 405 }, { from: { x: 450, y: 900 } }).point, {
    x: 450,
    y: 400,
  });
  // Towards the room's right face, horizontal.
  assert.deepEqual(snap({ x: 995, y: 200 }, { from: { x: 500, y: 200 } }).point, {
    x: 1000,
    y: 200,
  });
});

test('unlocked, a corner beats a line; else it lines up with corners on the floor, else 1 cm', () => {
  assert.deepEqual(snap({ x: 783, y: 788 }).point, { x: 785, y: 785 });
  assert.deepEqual(snap({ x: 450, y: 396 }).point, { x: 450, y: 400 });
  const lined = snap({ x: 700.4, y: 140 });
  assert.deepEqual(lined.point, { x: 700, y: 137 });
  assert.equal(lined.guides.length, 1);
  assert.deepEqual(snap({ x: 700.4, y: 250.6 }).point, { x: 700, y: 251 });
});

test('an end never leaves the room; Alt keeps the step and the room only', () => {
  // From inside, outwards: it stops where it leaves (507.5), on the step along that face.
  assert.deepEqual(snap({ x: 1300, y: 512 }, { from: { x: 500, y: 500 } }).point, {
    x: 1000,
    y: 508,
  });
  const free = snap({ x: 450.4, y: 705 }, { from: { x: 100, y: 700 }, free: true });
  assert.deepEqual(free.point, { x: 450, y: 705 });
  assert.deepEqual(snap({ x: -40, y: 300 }, { free: true }).point, { x: 0, y: 300 });
});

test('a whole free wall keeps its direction, meets a corner or line, else takes the step', () => {
  const move = (points, originalPoints) =>
    snapFreeWallTranslation(points, { originalPoints, targets, gridSize: 100, tolerance: reach })
      .points;
  const original = [
    { x: 100, y: 600 },
    { x: 200, y: 600 },
  ];
  // Its right end meets the column's corner.
  assert.deepEqual(
    move(
      [
        { x: 682, y: 783 },
        { x: 782, y: 783 },
      ],
      original
    ),
    [
      { x: 685, y: 785 },
      { x: 785, y: 785 },
    ]
  );
  assert.deepEqual(
    move(
      [
        { x: 150.3, y: 650.6 },
        { x: 250.3, y: 650.6 },
      ],
      original
    ),
    [
      { x: 150, y: 651 },
      { x: 250, y: 651 },
    ]
  );
  // Pushed out of the room on the left: it stops on the outline.
  const out = move(
    [
      { x: -50, y: 600 },
      { x: 50, y: 600 },
    ],
    original
  );
  assert.ok(Math.abs(out[0].x) < 0.01 && out[1].x - out[0].x === 100);
});

test('the interaction helper holds a caught pull a little further and shows the guides', () => {
  const interaction = createBuildingPlanInteraction({
    scene: () => view,
    policy: () => ({ snapping: true }),
  });
  const options = { roomId: 'a', wallId: 'mine', from: { x: 100, y: 700 }, zoom: 1 };
  assert.equal(interaction.snapFreeWallEnd({ x: 400, y: 707 }, options).y, 700);
  assert.equal(interaction.getGuides().length, 1);
  // 11 off: past the reach to catch, within the reach to hold.
  assert.equal(interaction.snapFreeWallEnd({ x: 400, y: 711 }, options).y, 700);
  interaction.reset();
  assert.equal(interaction.snapFreeWallEnd({ x: 400, y: 711 }, options).y, 711);
});
