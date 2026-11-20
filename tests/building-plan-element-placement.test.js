import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildingPlanOpeningStretches as stretchesOf,
  placeBuildingPlanColumn,
  placeBuildingPlanOpening,
} from '../src/index.js';

// 100 canvas units a metre. Room A is 0..1000 square with 20 cm walls outside it. Its bottom face
// runs from (1000, 1000) to (0, 1000), 10 m along its physical wall in the same direction, with a
// door from x 490 to 400 (ratios 0.51 to 0.6). A free wall F stands along y 600 from x 300 to 700,
// its 10 cm body above the line.
const box = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const room = {
  id: 'a',
  vertices: box(0, 0, 1000, 1000),
  rect: { x: 0, y: 0, width: 1000, height: 1000 },
};
const face = (id, points, extra = {}) => ({
  id,
  roomId: 'a',
  isBoundary: true,
  physicalWallId: `p-${id}`,
  points,
  bindings: [{ interval: [0, 10], direction: 1 }],
  thickness: 0.2,
  ...extra,
});
const column = (id, x, y, size = 0.3) => ({
  id,
  roomId: 'a',
  centerU: x / 1000,
  centerV: y / 1000,
  width: size,
  height: size,
});
const viewWith = (columns = []) => ({
  gridSize: 100,
  rooms: [room],
  walls: [
    face('bottom', [
      { x: 1000, y: 1000 },
      { x: 0, y: 1000 },
    ]),
    face('right', [
      { x: 1000, y: 0 },
      { x: 1000, y: 1000 },
    ]),
    face(
      'free',
      [
        { x: 300, y: 600 },
        { x: 700, y: 600 },
      ],
      { isBoundary: false, thickness: 0.1 }
    ),
  ],
  wallFootprints: [
    { id: 'p-bottom', roomIds: ['a'], polygons: [box(0, 1000, 1000, 1020)] },
    { id: 'p-right', roomIds: ['a'], polygons: [box(1000, 0, 1020, 1000)] },
    { id: 'p-free', roomIds: [], polygons: [box(300, 590, 700, 600)] },
  ],
  physicalOpenings: [
    {
      id: 'door',
      wallId: 'p-bottom',
      thickness: 0.2,
      points: [
        { x: 490, y: 1010 },
        { x: 400, y: 1010 },
      ],
      polygon: box(400, 1000, 490, 1020),
    },
  ],
  columns,
});
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);
const stretches = (view, options = {}) =>
  stretchesOf(view, { wallId: 'bottom', ...options }).stretches.map((pair) =>
    pair.map((value) => +value.toFixed(6))
  );

test('free stretches: past the openings and the columns against the wall or in it', () => {
  assert.deepEqual(stretches(viewWith()), [
    [0, 0.51],
    [0.6, 1],
  ]);
  // Flush inside at x 185..215: blocked; one standing 1 cm off the face: not.
  const columns = [column('c', 200, 985), column('d', 800, 984)];
  assert.deepEqual(stretches(viewWith(columns)), [
    [0, 0.51],
    [0.6, 0.785],
    [0.815, 1],
  ]);
  assert.deepEqual(stretches(viewWith(columns), { openings: false }), [
    [0, 0.785],
    [0.815, 1],
  ]);
  assert.deepEqual(stretches(viewWith(), { ignoreOpeningId: 'door' }), [[0, 1]]);
});

test('a door at the mark: on an existing door, it slides beside it', () => {
  const placed = placeBuildingPlanOpening(viewWith(), {
    wallId: 'bottom',
    width: 0.9,
    mark: { x: 450, y: 1000 },
  });
  assert.equal(placed.segmentIndex, 0);
  near(placed.startRatio, 0.42);
  near(placed.endRatio, 0.51);
  assert.equal(placed.width, 0.9);
});

test('a door at the mark: centred on it, its start on whole centimetres', () => {
  const placed = placeBuildingPlanOpening(viewWith(), {
    wallId: 'bottom',
    width: 0.9,
    mark: { x: 150.4, y: 1003 },
  });
  near(placed.startRatio, 0.805);
  near(placed.endRatio, 0.895);
});

test('a door without a mark: the middle of the widest stretch', () => {
  const placed = placeBuildingPlanOpening(viewWith(), { wallId: 'bottom', width: 0.9 });
  near(placed.startRatio, 0.21);
  near(placed.endRatio, 0.3);
});

test('no room for it: null', () => {
  assert.equal(placeBuildingPlanOpening(viewWith(), { wallId: 'bottom', width: 6 }), null);
});

test('a column with a wall selected: flush inside against it at the mark', () => {
  const view = viewWith();
  const size = { roomId: 'a', width: 0.3, height: 0.3 };
  assert.deepEqual(
    placeBuildingPlanColumn(view, { ...size, wallId: 'right', mark: { x: 1004, y: 300.4 } }),
    { x: 985, y: 300 }
  );
  // A free wall: on the side the mark is nearer to.
  assert.deepEqual(
    placeBuildingPlanColumn(view, { ...size, wallId: 'free', mark: { x: 500, y: 592 } }),
    { x: 500, y: 575 }
  );
  assert.deepEqual(
    placeBuildingPlanColumn(view, { ...size, wallId: 'free', mark: { x: 500, y: 598 } }),
    { x: 500, y: 615 }
  );
});

test('a column at a room mark, else at the room centre; null where it fits nowhere near', () => {
  const view = viewWith();
  const size = { roomId: 'a', width: 0.3, height: 0.3 };
  assert.deepEqual(placeBuildingPlanColumn(view, { ...size, mark: { x: 503.4, y: 497.6 } }), {
    x: 503,
    y: 498,
  });
  assert.deepEqual(placeBuildingPlanColumn(view, size), { x: 500, y: 500 });
  assert.equal(placeBuildingPlanColumn(view, { ...size, mark: { x: 5000, y: 5000 } }), null);
});
