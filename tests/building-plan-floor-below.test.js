import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// F2 (2026-11-22): the canvas snapshot carries the floor directly below the floor shown (U1),
// its wall bands' and columns' outlines, for the canvas to draw under it; display only. The
// example's Ground floor stands at 0 m.

async function plan(upperValues) {
  const f = createBuildingPlanExample();
  let record = f.record;
  const options = (extra = {}) => ({
    meta: f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
    ...extra,
  });
  const setup = new BuildingPlanCanvasController(options());
  const ground = setup.semanticSnapshot.floors[0];
  assert.ok(
    await setup.apply({
      type: 'create_element',
      floorId: ground.id,
      roomId: ground.rooms[0].id,
      collection: 'columns',
      element: { position: { x: 2, y: 1.5 }, width: 0.3, height: 0.4 },
      values: {},
    })
  );
  const upper = upperValues ? await setup.createFloor(upperValues) : null;
  setup.dispose();
  return { f, options, ground: ground.id, upper: upper?.id };
}
const canvas = (t, floorId) => new BuildingPlanCanvasController(t.options({ floorId }));

test('a floor above shows the floor below: its wall bands and columns, named', async () => {
  const t = await plan({ floor_elevation: 3 });
  const controller = canvas(t, t.upper);
  const below = controller.getSnapshot().floorBelow;
  assert.equal(below.id, t.ground);
  assert.equal(below.label, 'Ground floor');
  const g = controller.gridSize;
  const ground = canvas(t, t.ground).getSnapshot();
  assert.deepEqual(
    below.walls,
    ground.wallFootprints.flatMap((wall) => wall.polygons),
    'the same bands the Ground floor draws'
  );
  assert.deepEqual(
    below.columns.map((corners) => corners.map((p) => [p.x / g, p.y / g])),
    [
      [
        [1.85, 1.3],
        [2.15, 1.3],
        [2.15, 1.7],
        [1.85, 1.7],
      ],
    ]
  );
  controller.dispose();
});

test('none for the lowest floor, or a floor with no elevation (U1)', async () => {
  const t = await plan({});
  assert.equal(canvas(t, t.ground).getSnapshot().floorBelow, null, 'the lowest');
  assert.equal(canvas(t, t.upper).getSnapshot().floorBelow, null, 'no elevation yet');
  const level = await plan({ floor_elevation: 0 });
  assert.equal(canvas(level, level.upper).getSnapshot().floorBelow, null, 'the same level');
});

test('a preview on the floor above keeps it', async () => {
  const t = await plan({ floor_elevation: 3 });
  const controller = canvas(t, t.upper);
  const g = controller.gridSize;
  await controller.createRoom({ x: 0, y: 0, width: 3 * g, height: 2 * g });
  const below = controller.getSnapshot().floorBelow;
  const room = controller.getSnapshot().rooms[0];
  const corner = controller.getSnapshot().corners.find((entry) => entry.roomId === room.id);
  controller.previewCorner(room.id, corner.id, { x: corner.point.x + g / 2, y: corner.point.y });
  assert.ok(controller.previewView, 'a preview is shown');
  assert.deepEqual(controller.getSnapshot().floorBelow, below);
  controller.dispose();
});

// A drawn free wall stacking on the wall below (2026-11-23): the floor below's walls' midlines,
// their axes, and where they meet. Invariants: each runs halfway between its band's faces
// wherever it crosses a band; each meeting point lies on two midlines' lines.
function assertMidlines(below) {
  assert.ok(below.midlines.length > 0);
  for (const [a, b] of below.midlines) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const u = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const offset = (p) => (p.x - a.x) * -u.y + (p.y - a.y) * u.x;
    let inside = 0;
    for (let i = 1; i < 10; i += 1) {
      const sample = { x: a.x + (b.x - a.x) * (i / 10), y: a.y + (b.y - a.y) * (i / 10) };
      const band = below.walls.find((polygon) => pointIn(sample, polygon));
      if (!band) continue;
      inside += 1;
      // The band's edges running with the midline, by their offset from it.
      const offsets = band
        .map((p, index) => [p, band[(index + 1) % band.length]])
        .filter(([p, q]) => Math.abs((q.x - p.x) * u.y - (q.y - p.y) * u.x) < 1e-6)
        .filter(([p, q]) => Math.hypot(q.x - p.x, q.y - p.y) > 1e-6)
        .map(([p]) => offset(p));
      assert.ok(
        Math.abs(Math.max(...offsets) + Math.min(...offsets)) < 1e-6,
        `halfway: ${JSON.stringify(offsets)}`
      );
    }
    assert.ok(inside > 0, 'it crosses its band');
  }
  const onLine = (point, [a, b]) =>
    Math.abs((point.x - a.x) * (b.y - a.y) - (point.y - a.y) * (b.x - a.x)) /
      Math.hypot(b.x - a.x, b.y - a.y) <
    1e-6;
  for (const point of below.junctions)
    assert.ok(below.midlines.filter((line) => onLine(point, line)).length >= 2);
}
function pointIn(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [p, q] = [polygon[i], polygon[j]];
    if (
      p.y > point.y !== q.y > point.y &&
      point.x < ((q.x - p.x) * (point.y - p.y)) / (q.y - p.y) + p.x
    )
      inside = !inside;
  }
  return inside;
}

test('its walls’ midlines run halfway between their faces; where they meet', async () => {
  const t = await plan({ floor_elevation: 3 });
  const controller = canvas(t, t.upper);
  const g = controller.gridSize;
  const below = controller.getSnapshot().floorBelow;
  assertMidlines(below);
  // W3.2 (y 3.1) meets W8 (x 2.9): a T where Room 2's wall reaches the shared wall.
  assert.ok(
    below.junctions.some((p) => Math.abs(p.x / g - 2.9) < 1e-9 && Math.abs(p.y / g - 3.1) < 1e-9)
  );
  controller.dispose();
  // W3 thickened to 0.3 m, its Bedroom's face kept: still halfway.
  const ground = canvas(t, t.ground);
  const floor = ground.semanticSnapshot.floors[0];
  const w3 = floor.walls.find((wall) => wall.autoLabel === 'W3');
  assert.ok(
    await ground.apply({
      type: 'set_property',
      floorId: floor.id,
      wallId: w3.id,
      activeRoomId: floor.rooms[0].id,
      property: 'wall_thickness',
      value: 0.3,
    })
  );
  ground.dispose();
  const thick = canvas(t, t.upper);
  const thicker = thick.getSnapshot().floorBelow;
  assert.ok(
    thicker.midlines.some(([a, b]) => a.y === b.y && Math.abs(a.y / g - 3.15) < 1e-9),
    'W3’s midline in its 0.3 m band'
  );
  assertMidlines(thicker);
  thick.dispose();
});
