import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanInteraction } from '../src/index.js';
import { beamTargets } from '../src/building-plan/beam-targets.js';

// 100 canvas units a metre: the 1 cm step is 1 unit. Room A is 0..1000 square, room B to its
// right. In A: free wall W along y 400 (centreline, x 300..600), a 30 × 30 column at (800, 800),
// beam B1 from (100, 600) to (900, 600), 25 cm wide (body 587.5..612.5), and beam "mine", the one
// being edited. In B: beam B2 from (1100, 237) to (1400, 237).
const square = (x, y, size) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];
const view = {
  gridSize: 100,
  rooms: [
    { id: 'a', vertices: square(0, 0, 1000), rect: { x: 0, y: 0, width: 1000, height: 1000 } },
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
  ],
  wallFootprints: [
    {
      id: 'pw',
      roomIds: [],
      polygons: [
        [
          { x: 300, y: 390 },
          { x: 600, y: 390 },
          { x: 600, y: 410 },
          { x: 300, y: 410 },
        ],
      ],
    },
  ],
  columns: [{ id: 'c', roomId: 'a', centerU: 0.8, centerV: 0.8, width: 0.3, height: 0.3 }],
  beams: [
    { id: 'b1', roomId: 'a', startU: 0.1, startV: 0.6, endU: 0.9, endV: 0.6, width: 0.25 },
    { id: 'mine', roomId: 'a', startU: 0.2, startV: 0.3, endU: 0.5, endV: 0.3, width: 0.25 },
    { id: 'b2', roomId: 'b', startU: 0.16, startV: 0.2, endU: 0.76, endV: 0.2, width: 0.25 },
  ],
};
const interaction = () => createBuildingPlanInteraction({ scene: () => view });
const options = { roomId: 'a', beamId: 'mine', width: 0.25, zoom: 1 };
const has = (list, point) => list.some((entry) => entry.x === point.x && entry.y === point.y);
const round = ({ x, y }) => ({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });

test('targets: the free wall targets, free walls centrelines, column centres, the other beams', () => {
  const targets = beamTargets(view, { roomId: 'a', beamId: 'mine' });
  // Room (4), W's body (4), the column (4); W's centreline; B1's body (4) and centreline.
  assert.equal(targets.lines.length, 4 + 4 + 4 + 1 + 4 + 1);
  assert.ok(has(targets.points, { x: 800, y: 800 }), "the column's centre");
  assert.ok(has(targets.points, { x: 100, y: 600 }) && has(targets.points, { x: 900, y: 587.5 }));
  // The beam being edited is left out; B2, in another room, only lines up.
  assert.ok(!has(targets.points, { x: 200, y: 300 }));
  assert.ok(!has(targets.points, { x: 1100, y: 237 }) && has(targets.align, { x: 1100, y: 237 }));
});

test('drawing: the first end onto a face; the second locks level and stops on the far face', () => {
  const plan = interaction();
  plan.begin();
  const start = plan.snapBeamEnd({ x: 4, y: 203 }, options);
  assert.deepEqual(start, { x: 0, y: 203 });
  const end = plan.snapBeamEnd({ x: 996, y: 207 }, { ...options, from: start });
  assert.deepEqual(end, { x: 1000, y: 203 });
  // Past the room: it stops on the face, its body inside.
  const past = plan.snapBeamEnd({ x: 1080, y: 205 }, { ...options, from: start });
  assert.deepEqual(past, { x: 1000, y: 203 });
  // Near nothing: whole centimetres.
  const free = plan.snapBeamEnd({ x: 503.4, y: 261.7 }, { ...options, from: start });
  assert.deepEqual(free, { x: 503, y: 262 });
});

test('an end onto a column centre, another beam side or centreline, a free wall centreline', () => {
  const plan = interaction();
  plan.begin();
  const from = { x: 500, y: 500 };
  const end = (point, start) => round(plan.snapBeamEnd(point, { ...options, from: start }));
  assert.deepEqual(end({ x: 797, y: 803 }, from), { x: 800, y: 800 });
  const top = { x: 300, y: 200 };
  assert.deepEqual(end({ x: 502, y: 584 }, top), { x: 502, y: 587.5 });
  plan.reset();
  assert.deepEqual(end({ x: 502, y: 597 }, top), { x: 502, y: 600 });
  plan.reset();
  assert.deepEqual(end({ x: 451, y: 402 }, { x: 120, y: 150 }), { x: 451, y: 400 });
});

test('a whole beam: an end onto a face; pushed into a parallel face it lies flush', () => {
  const plan = interaction();
  plan.begin();
  const original = [
    { x: 200, y: 300 },
    { x: 500, y: 300 },
  ];
  const moved = (dx, dy) => original.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  const onFace = plan.snapBeamTranslation(moved(-196, 0), { ...options, originalPoints: original });
  assert.deepEqual(onFace, moved(-200, 0));
  plan.reset();
  const flushY = (dy) =>
    plan
      .snapBeamTranslation(moved(3, dy), { ...options, originalPoints: original })
      .map((point) => round(point));
  // Its side on the face, not its centreline on whole centimetres (13); along, the step.
  assert.deepEqual(flushY(-295), moved(3, -287.5));
  plan.reset();
  assert.deepEqual(flushY(-290), moved(3, -287.5));
  plan.reset();
  // Near it, not into it: not laid flat against it (as free walls), the step.
  assert.deepEqual(flushY(-283), moved(3, -283));
});

test('Alt: no pulls, still whole centimetres and inside the room', () => {
  const plan = interaction();
  plan.begin();
  const from = { x: 0, y: 203 };
  const bypass = { ...options, from, bypass: true };
  assert.deepEqual(plan.snapBeamEnd({ x: 996.4, y: 203.3 }, bypass), { x: 996, y: 203 });
  assert.deepEqual(plan.snapBeamEnd({ x: 797, y: 803 }, bypass), { x: 797, y: 803 });
  assert.deepEqual(plan.snapBeamEnd({ x: 1200, y: 203 }, bypass), { x: 1000, y: 203 });
});
