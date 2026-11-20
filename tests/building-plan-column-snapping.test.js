import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanInteraction } from '../src/index.js';
import { columnTargets } from '../src/building-plan/column-targets.js';
import { snapColumn } from '../src/building-plan/column-snapping.js';
import { freeWallTargets } from '../src/building-plan/free-wall-targets.js';

// 100 canvas units a metre: the 1 cm step is 1 unit. Room A is 0..1000 square, with 20 cm walls
// all round (bodies outside the outline, corner pieces included) and their midlines; a door in the
// bottom wall from x 400 to 490. Column C (30 × 30 cm) is the one being moved.
const box = (x0, y0, x1, y1) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const face = (id, axisPoints) => ({
  id,
  roomId: 'a',
  isBoundary: true,
  physicalWallId: `p-${id}`,
  points: [],
  axisPoints,
});
const footprint = (id, ...polygons) => ({ id: `p-${id}`, roomIds: ['a'], polygons });
const room = {
  id: 'a',
  vertices: box(0, 0, 1000, 1000),
  rect: { x: 0, y: 0, width: 1000, height: 1000 },
};
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
    face('top', [
      { x: 0, y: -10 },
      { x: 1000, y: -10 },
    ]),
    face('right', [
      { x: 1010, y: 0 },
      { x: 1010, y: 1000 },
    ]),
    face('bottom', [
      { x: 1000, y: 1010 },
      { x: 0, y: 1010 },
    ]),
    face('left', [
      { x: -10, y: 1000 },
      { x: -10, y: 0 },
    ]),
  ],
  wallFootprints: [
    footprint('top', box(0, -20, 1000, 0), box(1000, -20, 1020, 0)),
    footprint('right', box(1000, 0, 1020, 1000), box(1000, 1000, 1020, 1020)),
    footprint('bottom', box(0, 1000, 1000, 1020), box(-20, 1000, 0, 1020)),
    footprint('left', box(-20, 0, 0, 1000), box(-20, -20, 0, 0)),
  ],
  physicalOpenings: [
    {
      id: 'door',
      thickness: 0.2,
      points: [
        { x: 490, y: 1010 },
        { x: 400, y: 1010 },
      ],
      polygon: box(400, 1000, 490, 1020),
    },
  ],
  columns: [column('c', 100, 100), ...columns],
});
// A free wall F in A, 10 cm thick: drawn along y 600 from x 300 to 700, its body above the line.
const withFreeWall = (view) => ({
  ...view,
  walls: [
    ...view.walls,
    {
      id: 'free',
      roomId: 'a',
      isBoundary: false,
      physicalWallId: 'p-free',
      points: [
        { x: 300, y: 600 },
        { x: 700, y: 600 },
      ],
      axisPoints: [
        { x: 300, y: 595 },
        { x: 700, y: 595 },
      ],
    },
  ],
  wallFootprints: [
    ...view.wallFootprints,
    { id: 'p-free', roomIds: [], polygons: [box(300, 590, 700, 600)] },
  ],
});
const reach = () => 8;
const snap = (centre, { columns = [], size = 30, freeWall = false, ...extra } = {}) =>
  snapColumn(centre, {
    size: { width: size, height: size },
    targets: columnTargets(freeWall ? withFreeWall(viewWith(columns)) : viewWith(columns), {
      roomId: 'a',
      columnId: 'c',
    }),
    gridSize: 100,
    tolerance: reach,
    ...extra,
  });

test('targets: the room and its walls as the region, the moved column left out', () => {
  const targets = columnTargets(viewWith([column('d', 600, 500)]), { roomId: 'a', columnId: 'c' });
  assert.equal(targets.region.length, 1 + 8);
  assert.equal(targets.midlines.length, 4);
  assert.deepEqual(targets.rects, [{ minX: 585, minY: 485, maxX: 615, maxY: 515, id: 'd' }]);
  assert.deepEqual(targets.boxIds, ['door']);
  assert.deepEqual(targets.centres, [{ x: 600, y: 500 }]);
  // The door's box reaches a tenth of a millimetre past both faces.
  assert.deepEqual(
    targets.boxes[0].map((point) => +point.y.toFixed(3)).sort(),
    [1020.1, 1020.1, 999.9, 999.9]
  );
  const free = freeWallTargets(viewWith(), { roomId: 'a', columnId: 'c' });
  assert.equal(free.lines.length, 4, 'only the outline: the moved column is left out');
});

test('nothing near: its sides on the 1 cm step', () => {
  assert.deepEqual(snap({ x: 503.4, y: 497.6 }).centre, { x: 503, y: 498 });
});

test('against a wall: flush inside, flush with the far face, centred where it fits', () => {
  assert.deepEqual(snap({ x: 980, y: 500 }).centre, { x: 985, y: 500 }, 'flush inside');
  // A 30 cm column in a 20 cm wall: 10 cm in the room, its centre in the wall.
  assert.deepEqual(snap({ x: 1003, y: 500 }).centre, { x: 1005, y: 500 }, 'far face');
  // Centred, a 30 cm column stands out of a 20 cm wall on both sides: allowed when centred.
  assert.deepEqual(snap({ x: 1009, y: 500 }).centre, { x: 1010, y: 500 }, 'centred, wider');
  // A 20 cm column fits the wall exactly.
  assert.deepEqual(snap({ x: 1008, y: 500 }, { size: 20 }).centre, { x: 1010, y: 500 });
});

test('a free wall holds a column: flush with either side, or centred on it', () => {
  assert.deepEqual(snap({ x: 500, y: 572 }, { freeWall: true }).centre, { x: 500, y: 575 });
  assert.deepEqual(snap({ x: 500, y: 613 }, { freeWall: true }).centre, { x: 500, y: 615 });
  // Centred, it stands out on both sides, both in its room.
  assert.deepEqual(snap({ x: 500, y: 598 }, { freeWall: true }).centre, { x: 500, y: 595 });
});

test('a corner into a corner', () => {
  assert.deepEqual(snap({ x: 20, y: 18 }).centre, { x: 15, y: 15 }, "the room's corner");
  // Flush with the far faces of both walls: into the corner piece.
  assert.deepEqual(snap({ x: 1003, y: 1004 }).centre, { x: 1005, y: 1005 });
});

test('a drag stops where the column would leave the room and its walls', () => {
  const result = snap({ x: 1100, y: 500 }, { from: { x: 500, y: 500 } });
  assert.deepEqual(result.centre, { x: 1005, y: 500 });
  assert.equal(result.fits, true);
});

test('columns may touch but not overlap', () => {
  const columns = [column('d', 600, 500)];
  const result = snap({ x: 590, y: 500 }, { columns, from: { x: 500, y: 500 } });
  assert.deepEqual(result.centre, { x: 570, y: 500 }, 'stopped against its side');
  assert.deepEqual(
    snap({ x: 578, y: 500 }, { columns }).centre,
    { x: 570, y: 500 },
    'pulled to it'
  );
});

test('openings: beside a jamb yes, flush across the opening no', () => {
  assert.deepEqual(snap({ x: 380, y: 982 }).centre, { x: 385, y: 985 }, 'into the jamb corner');
  const across = snap({ x: 445, y: 982 }).centre;
  assert.notEqual(across.y, 985, 'not pulled flush across the door');
  assert.ok(across.y + 15 < 1000);
  // Into the wall across the door: it stops at the face.
  const pushed = snap({ x: 445, y: 1010 }, { from: { x: 445, y: 900 } }).centre;
  assert.ok(pushed.y + 15 < 1000);
});

test('placing where it does not fit: the nearest place that does', () => {
  // Out of reach of every pull (the midline included): the nearest place that fits.
  assert.deepEqual(snap({ x: 1030, y: 500 }).centre, { x: 1005, y: 500 });
  assert.equal(snap({ x: 5000, y: 5000 }).fits, false);
});

test('lining up with another column centre, with a guide', () => {
  // A 20 cm column: its centre is nearer to lining up than its sides.
  const result = snap({ x: 300.4, y: 302 }, { columns: [column('d', 600, 300)], size: 20 });
  assert.deepEqual(result.centre, { x: 300, y: 300 });
  assert.deepEqual(result.guides, [{ from: { x: 600, y: 300 }, to: { x: 300, y: 300 } }]);
});

test('free (Alt): no pulls, still the step and the room', () => {
  assert.deepEqual(snap({ x: 980.4, y: 500 }, { free: true }).centre, { x: 980, y: 500 });
  assert.deepEqual(
    snap({ x: 1100, y: 500 }, { free: true, from: { x: 500, y: 500 } }).centre.x,
    1005
  );
});

test('the interaction helper holds a pull a little farther', () => {
  const view = viewWith();
  const interaction = createBuildingPlanInteraction({ scene: () => view });
  const options = { roomId: 'a', columnId: 'c', width: 0.3, height: 0.3 };
  assert.deepEqual(interaction.snapColumn({ x: 978, y: 500 }, options), { x: 985, y: 500 });
  assert.deepEqual(interaction.snapColumn({ x: 974, y: 500 }, options), { x: 985, y: 500 });
  const fresh = createBuildingPlanInteraction({ scene: () => view });
  assert.deepEqual(fresh.snapColumn({ x: 974, y: 500 }, options), { x: 974, y: 500 });
  assert.equal(fresh.snapColumn({ x: 5000, y: 5000 }, options), null);
});
