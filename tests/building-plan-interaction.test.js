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

test('diagonal wall travel holds its initial world axis and allows a free bypass', () => {
  const interaction = createBuildingPlanInteraction({ policy: () => ({ snapping: false }) });
  const originalPoints = [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ];
  const translated = (x, y) => originalPoints.map((p) => ({ x: p.x + x, y: p.y + y }));
  interaction.begin();
  assert.deepEqual(
    interaction.snapWallTranslation(translated(20, 3), { originalPoints }),
    translated(20, 0)
  );
  assert.deepEqual(
    interaction.snapWallTranslation(translated(23, 50), { originalPoints }),
    translated(23, 0)
  );
  assert.deepEqual(
    interaction.snapWallTranslation(translated(23, 50), { originalPoints, bypass: true }),
    translated(23, 50)
  );
  interaction.reset();
  interaction.begin();
  assert.deepEqual(
    interaction.snapWallTranslation(translated(3, 20), { originalPoints }),
    translated(0, 20)
  );
});

test('magnetic alignment of a diagonal wall respects its chosen translation axis', () => {
  const originalPoints = [
    { x: 0, y: 0 },
    { x: 100, y: 50 },
  ];
  const interaction = createBuildingPlanInteraction({
    scene: () => ({
      rooms: [room],
      walls: [
        {
          id: 'reference',
          roomId: room.id,
          isBoundary: true,
          thickness: 0.2,
          points: [
            { x: 20, y: 0 },
            { x: 120, y: 50 },
          ],
        },
      ],
    }),
  });
  interaction.begin();
  const result = interaction.snapWallTranslation(
    [
      { x: 18, y: 2 },
      { x: 118, y: 52 },
    ],
    {
      roomId: 'active',
      faceId: 'moving',
      originalPoints,
    }
  );
  assert.ok(Math.abs(result[0].x - 20) < 1e-6);
  assert.equal(result[0].y, 0);
  assert.equal(result[1].y, 50);
});

test('free guidance bypass preserves a split internal partition perpendicular constraint', () => {
  const interaction = createBuildingPlanInteraction();
  const originalPoints = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  assert.deepEqual(
    interaction.snapWallTranslation(
      [
        { x: 6, y: 12 },
        { x: 106, y: 12 },
      ],
      {
        originalPoints,
        bypass: true,
        perpendicular: true,
      }
    ),
    [
      { x: 0, y: 12 },
      { x: 100, y: 12 },
    ]
  );
});

test('corner travel holds its chosen axis, supports free bypass and resets for the next gesture', () => {
  const interaction = createBuildingPlanInteraction();
  const originalPoint = { x: 0, y: 0 };
  interaction.begin();
  assert.deepEqual(interaction.snapCorner({ x: 15, y: 3 }, { originalPoint }), { x: 15, y: 0 });
  assert.deepEqual(interaction.snapCorner({ x: 18, y: 30 }, { originalPoint }), { x: 18, y: 0 });
  assert.deepEqual(interaction.snapCorner({ x: 18, y: 30 }, { originalPoint, bypass: true }), {
    x: 18,
    y: 30,
  });
  interaction.reset();
  interaction.begin();
  assert.deepEqual(interaction.snapCorner({ x: 2, y: 15 }, { originalPoint }), { x: 0, y: 15 });
});
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

for (const axis of ['x', 'y'])
  for (const grouped of [false, true])
    test(`wall guides reach same-room extensions and stationary split siblings (${axis}, grouped=${grouped})`, () => {
      const vertices = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 120 },
        { x: 0, y: 120 },
      ];
      const points =
        axis === 'x'
          ? [
              { x: 2, y: 80 },
              { x: 2, y: 120 },
            ]
          : [
              { x: 80, y: 2 },
              { x: 120, y: 2 },
            ];
      const reference =
        axis === 'x'
          ? [
              { x: 0, y: 0 },
              { x: 0, y: 40 },
            ]
          : [
              { x: 0, y: 0 },
              { x: 40, y: 0 },
            ];
      const interaction = createBuildingPlanInteraction({
        scene: () => ({
          gridSize: 20,
          rooms: [{ id: 'active', vertices }],
          walls: [
            {
              id: 'stationary',
              roomId: 'active',
              physicalWallId: grouped ? 'construction' : 'other',
              isBoundary: true,
              points: reference,
              thickness: 0.2,
            },
          ],
        }),
      });
      const actual = interaction.snapTranslation(points, {
        roomId: 'active',
        faceId: 'moving',
        physicalWallId: 'construction',
      });
      assert.equal(actual[0][axis], 0);
      assert.equal(actual[1][axis], 0);
      assert.ok(
        interaction.getGuides().some((guide) => guide.from[axis === 'x' ? 'y' : 'x'] === 0)
      );
      assert.deepEqual(
        interaction.snapTranslation(points, {
          roomId: 'active',
          faceId: 'moving',
          physicalWallId: 'construction',
          bypass: true,
        }),
        points
      );
      assert.equal(interaction.getGuides().length, 0);
    });

test('whole-room movement does not use its own boundary as a magnetic reference', () => {
  const points = [
    { x: 2, y: 2 },
    { x: 102, y: 2 },
    { x: 102, y: 62 },
    { x: 2, y: 62 },
  ];
  const interaction = createBuildingPlanInteraction({
    scene: () => ({
      rooms: [{ id: 'active', vertices: room.vertices }],
      walls: [
        {
          id: 'own',
          roomId: 'active',
          isBoundary: true,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          thickness: 0.2,
        },
      ],
    }),
  });
  assert.deepEqual(interaction.snapTranslation(points, { roomId: 'active' }), points);
});
