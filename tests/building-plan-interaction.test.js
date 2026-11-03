import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanInteraction } from '../src/building-plan/interaction.js';
import { normalizeBuildingPlanEditingPolicy } from '../src/building-plan/editing-policy.js';

const room = {
  id: 'other',
  vertices: [
    { x: 60, y: 64 },
    { x: 160, y: 64 },
    { x: 160, y: 124 },
    { x: 60, y: 124 },
  ],
};
function fixture(policy = {}) {
  return createBuildingPlanInteraction({
    policy: () => policy,
    scene: () => ({
      rooms: [room],
      gridSize: 20,
      walls: [
        {
          id: 'shared',
          roomId: room.id,
          isBoundary: true,
          points: room.vertices.slice(0, 2),
          thickness: 0.2,
        },
      ],
    }),
  });
}
test('editor policy defaults are independent, typed and do not force grouping', () => {
  assert.deepEqual(normalizeBuildingPlanEditingPolicy(), {
    preserveWallGrouping: false,
    snapping: true,
    edgeAutoPan: true,
  });
  assert.throws(() => normalizeBuildingPlanEditingPolicy({ snapping: 'yes' }), /boolean/);
});
test('magnetic wall alignment respects thickness and releases with a temporary bypass', () => {
  const interaction = fixture();
  const points = [
    { x: 100, y: 61 },
    { x: 0, y: 61 },
  ];
  assert.deepEqual(interaction.snapTranslation(points, { roomId: 'active' }), [
    { x: 100, y: 60 },
    { x: 0, y: 60 },
  ]);
  assert.equal(interaction.getGuides().length, 1);
  assert.deepEqual(interaction.snapTranslation(points, { roomId: 'active', bypass: true }), points);
  assert.equal(interaction.getGuides().length, 0);
});
test('snap tolerance is in screen coordinates and disabled snapping preserves precision', () => {
  const points = [
    { x: 100, y: 70 },
    { x: 0, y: 70 },
  ];
  assert.equal(fixture().snapTranslation(points, { roomId: 'active', zoom: 0.5 })[0].y, 60);
  assert.equal(fixture().snapTranslation(points, { roomId: 'active', zoom: 2 })[0].y, 70);
  assert.equal(fixture({ snapping: false }).snapPoint({ x: 60.1234, y: 64.9876 }).x, 60.1234);
});
test('edge pan waits briefly, is speed bounded, resets on cancellation, and can be disabled', () => {
  const interaction = fixture();
  assert.deepEqual(interaction.edgePan({ x: 199, y: 50 }, { width: 200, height: 100 }, 0), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(interaction.edgePan({ x: 199, y: 50 }, { width: 200, height: 100 }, 100), {
    x: 0,
    y: 0,
  });
  const pan = interaction.edgePan({ x: 250, y: 50 }, { width: 200, height: 100 }, 160);
  assert.ok(pan.x < 0 && pan.x >= -5.76);
  interaction.reset();
  assert.deepEqual(interaction.edgePan({ x: 199, y: 50 }, { width: 200, height: 100 }, 170), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(
    fixture({ edgeAutoPan: false }).edgePan({ x: 199, y: 50 }, { width: 200, height: 100 }, 1000),
    { x: 0, y: 0 }
  );
});

test('jog realignment uses stationary wall extensions instead of following the shared preview', () => {
  const view = {
    gridSize: 20,
    rooms: [room],
    walls: [
      {
        id: 'moving-side',
        physicalWallId: 'moving-wall',
        roomId: room.id,
        isBoundary: true,
        thickness: 0.2,
        points: [
          { x: 60, y: 60 },
          { x: 100, y: 60 },
        ],
      },
      {
        id: 'stationary-run',
        physicalWallId: 'stationary-wall',
        roomId: room.id,
        isBoundary: true,
        thickness: 0.2,
        points: [
          { x: 100, y: 64 },
          { x: 160, y: 64 },
        ],
      },
    ],
  };
  const interaction = createBuildingPlanInteraction({ scene: () => view });
  interaction.begin();
  view.walls[1].points.forEach((point) => (point.y = 80));
  const snapped = interaction.snapTranslation(
    [
      { x: 100, y: 62 },
      { x: 0, y: 62 },
    ],
    {
      roomId: 'active',
      physicalWallId: 'moving-wall',
      originalPoints: [
        { x: 100, y: 56 },
        { x: 0, y: 56 },
      ],
    }
  );
  assert.equal(snapped[0].y, 60);
  interaction.reset();
  assert.equal(interaction.getGuides().length, 0);
});
