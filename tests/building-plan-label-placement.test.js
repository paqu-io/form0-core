import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingPlanLabelPlacement } from '../src/index.js';

const rect = (width, height) => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];
const round = ({ x, y, scale }) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100, scale];
const inside = ({ x, y }, vertices) => {
  let result = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [a, b] = [vertices[i], vertices[j]];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
};

test('a rectangular room puts its label at its centre, full size when it fits', () => {
  assert.deepEqual(
    round(buildingPlanLabelPlacement(rect(5, 3), { width: 3.3, height: 1 })),
    [2.5, 1.5, 1]
  );
  assert.deepEqual(
    round(buildingPlanLabelPlacement(rect(10, 1.2), { width: 3.3, height: 0.8 })),
    [5, 0.6, 1]
  );
});

test('a badge too large for a small room shrinks to fit', () => {
  const placement = buildingPlanLabelPlacement(rect(2, 2), { width: 3.3, height: 1 });
  assert.deepEqual(round(placement), [1, 1, 0.55]);
});

test('an L-shaped or U-shaped room keeps its label inside, on an arm wide enough for it', () => {
  const shapes = {
    L: [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 6 },
      { x: 0, y: 6 },
    ],
    U: [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 5 },
      { x: 0, y: 5 },
    ],
  };
  for (const [name, vertices] of Object.entries(shapes)) {
    const placement = buildingPlanLabelPlacement(vertices, { width: 3.3, height: 1 });
    assert.equal(placement.scale, 1, name);
    // The badge lies strictly inside the room (its margin may touch a wall): all four corners.
    const [w, h] = [3.3 / 2, 1 / 2];
    for (const [dx, dy] of [
      [-w, -h],
      [w, -h],
      [w, h],
      [-w, h],
    ])
      assert.ok(inside({ x: placement.x + dx, y: placement.y + dy }, vertices), name);
  }
});

test('without a badge size the label point is still inside the room', () => {
  assert.deepEqual(round(buildingPlanLabelPlacement(rect(4, 4))), [2, 2, 1]);
  assert.equal(buildingPlanLabelPlacement([{ x: 0, y: 0 }]), null);
});
