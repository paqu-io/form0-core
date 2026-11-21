import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { buildingPlanFootprints } from '../src/building-plan/footprints.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { cutBand, freeWallFits, outlineCuts } from '../src/building-plan/free-wall-body.js';

// 4a-3b (2026-11-20): a free wall's body, its ends cut along what they stop on (a room face,
// another free wall's side), stays inside its room. The example's Bedroom is 0..5 × 0..3 m, its
// interior walls 20 cm thick; walls here are given by their centreline, as the canvas draws them.

const round = (points) =>
  points.map(({ x, y }) => [x, y].map((value) => Math.round(value * 1e4) / 1e4));
const sorted = (points) => [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const box = [
  { x: 0, y: 0 },
  { x: 5, y: 0 },
  { x: 5, y: 3 },
  { x: 0, y: 3 },
];

test('an end on a face is cut along it; square across it; both faces in a corner', () => {
  const end = { x: 5, y: 2.5 };
  const diagonal = cutBand({ x: 3, y: 0.5 }, end, 0.1, [[], outlineCuts(end, box)]);
  // Both corners of that end on the face (x 5), none past it.
  assert.deepEqual(
    round(diagonal).filter(([x]) => x > 4.99),
    [
      [5, 2.6414],
      [5, 2.3586],
    ]
  );
  assert.deepEqual(
    round(cutBand({ x: 3, y: 1 }, { x: 5, y: 1 }, 0.1, [[], outlineCuts({ x: 5, y: 1 }, box)])),
    [
      [3, 1.1],
      [5, 1.1],
      [5, 0.9],
      [3, 0.9],
    ]
  );
  const corner = cutBand({ x: 4, y: 2 }, { x: 5, y: 3 }, 0.1, [
    [],
    outlineCuts({ x: 5, y: 3 }, box),
  ]);
  assert.ok(corner.every(({ x, y }) => x <= 5 + 1e-9 && y <= 3 + 1e-9));
  assert.ok(
    freeWallFits(
      [
        { x: 4, y: 2 },
        { x: 5, y: 3 },
      ],
      0.1,
      box
    )
  );
});

test('the body stays in the room: along a face it may lie flush, not in the wall', () => {
  assert.equal(
    freeWallFits(
      [
        { x: 1, y: 0.05 },
        { x: 4, y: 0.05 },
      ],
      0.1,
      box
    ),
    false
  );
  assert.equal(
    freeWallFits(
      [
        { x: 1, y: 0.1 },
        { x: 4, y: 0.1 },
      ],
      0.1,
      box
    ),
    true
  );
  assert.equal(
    freeWallFits(
      [
        { x: 3, y: 0.5 },
        { x: 5, y: 2.5 },
      ],
      0.1,
      box
    ),
    true
  );
});

function controllerFor() {
  const f = createBuildingPlanExample();
  let record = f.record;
  const reported = [];
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    reportIssues: (issues) => reported.splice(0, reported.length, ...issues),
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
    derivedCommands: true,
  });
  const g = controller.gridSize;
  const px = (points) => points.map(([x, y]) => ({ x: x * g, y: y * g }));
  const metres = (points) => round(points.map(({ x, y }) => ({ x: x / g, y: y / g })));
  const room = () => controller.session.getSnapshot().floors[0].rooms[0];
  const free = () => controller.getSnapshot().walls.filter((wall) => !wall.isBoundary);
  return { f, controller, g, px, metres, room, free, reported };
}

test('drawn bodies: cut along a face, along another free wall’s side; refused in the wall', async () => {
  const t = controllerFor();
  await t.controller.createWall(
    t.room().id,
    t.px([
      [3, 0.5],
      [5, 2.5],
    ])
  );
  await t.controller.createWall(
    t.room().id,
    t.px([
      [1, 2],
      [1, 0.5],
    ])
  );
  // A second wall ending on the first one's side (x - y = 2.5 - 0.1·√2), at an angle.
  const side = 2.5 - 0.1 * Math.SQRT2;
  await t.controller.createWall(
    t.room().id,
    t.px([
      [2, 2],
      [3.6, 3.6 - side],
    ])
  );
  const floor = t.controller.session.getSnapshot().floors[0];
  const bodies = buildingPlanFootprints(floor, 1).wallFootprints;
  const bodyOf = (wallId) => bodies.find((entry) => entry.id === wallId).polygons[0];
  const [diagonal, , tee] = t.free();
  assert.deepEqual(sorted(round(bodyOf(diagonal.physicalWallId)).filter(([x]) => x > 4.99)), [
    [5, 2.3586],
    [5, 2.6414],
  ]);
  // The tee's end corners lie on the diagonal's side line.
  const onSide = round(bodyOf(tee.physicalWallId)).filter(
    ([x, y]) => Math.abs(x - y - side) < 1e-3
  );
  assert.equal(onSide.length, 2);
  // Along the bottom face, 5 cm off it: half its body in the wall, refused; flush, accepted.
  const along = await t.controller.createWall(
    t.room().id,
    t.px([
      [1, 2.95],
      [3, 2.95],
    ])
  );
  assert.equal(along, null);
  assert.equal(t.reported[0]?.code, 'free_wall_outside_room');
  t.controller.dispose();
});

test('snapping: a move stops flush; an end near a face meets it; a tilt stops where it fitted', async () => {
  const t = controllerFor();
  await t.controller.createWall(
    t.room().id,
    t.px([
      [1, 1.5],
      [4, 1.5],
    ])
  );
  const wall = t.free()[0];
  const interaction = t.controller.interaction;
  const options = { roomId: t.room().id, wallId: wall.id, zoom: 10 };
  // Moved up past the top face (y 0): it stops with its side flush (centreline at 0.1).
  const moved = interaction.snapFreeWallTranslation(
    t.px([
      [1, -0.2],
      [4, -0.2],
    ]),
    {
      ...options,
      originalPoints: wall.points,
    }
  );
  assert.deepEqual(t.metres(moved), [
    [1, 0.1],
    [4, 0.1],
  ]);
  // Its right end dragged to 2 cm short of the right face, at an angle: it goes onto the face.
  interaction.reset();
  const from = wall.points[0];
  const near = interaction.snapFreeWallEnd(t.px([[4.98, 2.47]])[0], {
    ...options,
    from,
    bypass: true,
  });
  assert.equal(t.metres([near])[0][0], 5);
  // From flush against the top face, an end tilted into it stops where it last fitted.
  interaction.reset();
  const flushFrom = t.px([[1, 0.1]])[0];
  const first = interaction.snapFreeWallEnd(t.px([[4, 0.1]])[0], {
    ...options,
    from: flushFrom,
    bypass: true,
  });
  const tilted = interaction.snapFreeWallEnd(t.px([[4, 0.04]])[0], {
    ...options,
    from: flushFrom,
    bypass: true,
  });
  assert.deepEqual(t.metres([first]), [[4, 0.1]]);
  assert.ok(t.metres([tilted])[0][0] > 3.99);
  t.controller.dispose();
});

test('after the hand test: an attached wall slides along its face; an end 0.3 mm off still tilts', async () => {
  const t = controllerFor();
  await t.controller.createWall(
    t.room().id,
    t.px([
      [3.437, 1.5],
      [5, 1.5],
    ])
  );
  const wall = t.free()[0];
  // Dragged up 0.6 m with 20 cm towards the face (past the line pull's hold): it slides up, its
  // end exactly on the face (it used to stay where it was, and step 7 mm off the face).
  const slid = t.controller.interaction.snapFreeWallTranslation(
    wall.points.map((p) => ({ x: p.x + 0.2 * t.g, y: p.y - 0.6 * t.g })),
    { roomId: t.room().id, wallId: wall.id, zoom: 1.16, originalPoints: wall.points }
  );
  assert.deepEqual(t.metres(slid), [
    [3.437, 0.9],
    [5, 0.9],
  ]);
  // A wall whose end stops 0.3 mm short of the face: its end is still cut along it, so its free
  // end tilts as far as the pointer goes (close in, so nothing lines it up with a corner).
  const u = controllerFor();
  await u.controller.createWall(
    u.room().id,
    u.px([
      [3, 1.5],
      [4.9997, 1.5],
    ])
  );
  const short = u.free()[0];
  let end;
  for (let i = 1; i <= 20; i += 1)
    end = u.controller.interaction.snapFreeWallEnd(
      { x: short.points[0].x + 0.2 * u.g * (i / 20), y: short.points[0].y - 0.9 * u.g * (i / 20) },
      { roomId: u.room().id, wallId: short.id, from: short.points[1], zoom: 10 }
    );
  assert.deepEqual(u.metres([end]), [[3.2, 0.6]]);
  t.controller.dispose();
  u.controller.dispose();
});
