import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingPlanFrontView } from '../src/building-plan/front-view.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';
import { pointInPolygon, polygonArea } from '../src/building-plan/geometry.js';
import { applied, example } from './helpers/building-plan-bands.js';

// The front view's mini-map (decided 2026-11-26, mockup round 4): the room in plan, in metres as
// the plan draws it (O1). Its walls are the plan's wall material kept to the room (openings
// as gaps, neighbours left out); the shown row's face, the side's other rows; a ring at the row's
// 0 end (its left end, WB3); a cone from in front of the row's middle, along its inward normal,
// half its length in but at most 80% of the way to the first wall ahead (free walls count),
// to the row's ends, clipped to the room's floor; from the same eye, a side cone to the ends of
// what Front shows when the side has other rows (asked in the hand test, 2026-11-26). The example's Bedroom is 0..5 × 0..3 m, walls
// 0.2 m outside it; Room 2 is 3..8 × 3.2..6.2, the Shared door on W3 at x 3.6..4.5.

const faceOf = (t, label, roomIndex = 0) =>
  t.floor().rooms[roomIndex].faces.find((face) => face.wallId === t.wall(label).id).id;
const mapOf = (t, label, roomIndex = 0) =>
  buildingPlanFrontView(t.floor(), faceOf(t, label, roomIndex)).map;
const p = (x, y) => ({ x, y });
/** Whether the map draws wall material at a point (inside one of its pieces). */
const material = (map, point) => map.walls.some((piece) => pointInPolygon(point, piece, false));
const inside = (map, point) => pointInPolygon(point, map.outline, true);
const area = (points) => Math.abs(polygonArea(points));

test("W1 from the Bedroom: the room's walls, W1 shown, seen from 80% of the way to W3", () => {
  const t = example();
  const map = mapOf(t, 'W1');
  assert.deepEqual(map.outline, [p(0, 0), p(5, 0), p(5, 3), p(3, 3), p(0, 3)]);
  assert.deepEqual(map.shown, [[p(0, 0), p(5, 0)]]);
  assert.deepEqual(map.others, []);
  assert.deepEqual(map.zero, p(0, 0), "W1's left end seen from inside");
  // Half W1's length would be 2.5 m in; W3 and W3.2 are 3 m ahead, so 2.4.
  assert.deepEqual(map.eye, p(2.5, 2.4));
  assert.ok(Math.abs(area(map.cone) - 6) < 1e-9, 'the whole triangle, inside the floor');
  assert.deepEqual(map.sideCone, [], 'W1 is its whole side');
  assert.ok(map.cone.every((point) => inside(map, point)));
  // The Bedroom's walls with their corners, the Shared door a gap; Room 2's walls left out, the
  // corner its W3.1 shares with W2 drawn as the Bedroom's.
  for (const point of [p(2.5, -0.1), p(5.1, -0.1), p(5.1, 1.5), p(5.1, 3.1), p(1, 3.1), p(-0.1, 1)])
    assert.ok(material(map, point), `wall at ${point.x}, ${point.y}`);
  for (const point of [p(4.05, 3.1), p(6, 3.1), p(8.1, 4), p(5, 6.3), p(2.5, 1.5)])
    assert.ok(!material(map, point), `no wall at ${point.x}, ${point.y}`);
  assert.deepEqual(map.lines, []);
  assert.deepEqual(map.bounds, { x: -0.2, y: -0.2, width: 5.4, height: 3.4 });
});

test('W3 shares its side with W3.2: W3 shown, W3.2 the other row, half W3 in; from Room 2', () => {
  const t = example();
  const map = mapOf(t, 'W3');
  // Seen from inside the Bedroom, facing down the plan: W3 runs from x 5 to 3.
  assert.deepEqual(map.shown, [[p(5, 3), p(3, 3)]]);
  assert.deepEqual(map.others, [[p(3, 3), p(0, 3)]]);
  assert.deepEqual(map.zero, p(5, 3));
  assert.deepEqual(map.eye, p(4, 2), 'half its 2 m in: less than 80% of the 3 m to W1');
  assert.ok(Math.abs(area(map.cone) - 1) < 1e-9);
  // Front shows W3.2 beside it: the side cone from the same eye to the side's ends, x 5 and 0.
  assert.ok(Math.abs(area(map.sideCone) - 2.5) < 1e-9, `side cone ${area(map.sideCone)}`);
  for (const end of [p(5, 3), p(0, 3)])
    assert.ok(map.sideCone.some((point) => point.x === end.x && point.y === end.y));
  assert.ok(map.sideCone.every((point) => inside(map, point)));
  // Room 2 sees W3 from its own side, from x 3; its map has its own walls, not the Bedroom's.
  const other = mapOf(t, 'W3', 1);
  assert.deepEqual(other.shown, [[p(3, 3.2), p(5, 3.2)]]);
  assert.deepEqual(other.others, [[p(5, 3.2), p(8, 3.2)]]);
  assert.deepEqual(other.zero, p(3, 3.2));
  assert.deepEqual(other.eye, p(4, 4.2));
  assert.ok(material(other, p(5.5, 6.3)) && material(other, p(4.05, 3.05)) === false);
  assert.ok(!material(other, p(2.5, -0.1)), "the Bedroom's W1 left out");
});

test("a free wall: seen from its row's side; it counts as the first wall ahead of W1", () => {
  const t = example();
  const room = t.floor().rooms[0];
  applied(
    t.apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: newFreeWallFace(
        [p(1, 1.5), p(3, 1.5)],
        newFreeWallWidth(t.floor(), room.id, t.f.meta.properties)
      ),
      values: {},
    })
  );
  // Its body is 1..3 × 1.4..1.6; its row faces down the plan (y 1.6), toward W3 and W3.2.
  const free = t.floor().rooms[0].faces.find((face) => face.freePath);
  const map = buildingPlanFrontView(t.floor(), free.id).map;
  assert.deepEqual(map.shown, [[p(1, 1.6), p(3, 1.6)]]);
  assert.deepEqual(map.zero, p(1, 1.6));
  assert.deepEqual(map.eye, p(2, 2.6), 'half its 2 m: less than 80% of the 1.4 m ahead');
  assert.deepEqual(map.sideCone, [], 'Front shows the free wall alone');
  assert.ok(material(map, p(2, 1.5)), 'the free wall drawn as a wall');
  // W1's middle looks at the free wall 1.4 m ahead: 80% of it, 1.12 m in.
  assert.deepEqual(mapOf(t, 'W1').eye, p(2.5, 1.12));
});

test("a bump in the floor clips the cone; walls of unknown thickness are the plan's lines", () => {
  const t = example();
  // A room of its own with a bump from its left wall (x 10..11.5, y 0.8..1.8) into it.
  const bump = [p(10, 0), p(10, 1.8), p(11.5, 1.8), p(11.5, 0.8), p(10, 0.8)];
  applied(
    t.apply({
      type: 'create_room',
      attach: false,
      vertices: [bump[0], p(16, 0), p(16, 4), p(10, 4), ...bump.slice(1)],
    })
  );
  const room = t.floor().rooms.at(-1);
  const top = room.faces
    .map((face) => buildingPlanFrontView(t.floor(), face.id))
    .find((v) => v.length === 6);
  const { map } = top;
  // 4 m to the far wall: half the top's 6 m, 3 m in. The triangle's left side crosses the bump.
  assert.deepEqual(map.eye, p(13, 3));
  assert.ok(area(map.cone) < 9 - 0.1, `clipped: ${area(map.cone)}`);
  assert.ok(area(map.cone) > 8, 'only the bump taken out');
  assert.ok(map.cone.every((point) => inside(map, point)));
  assert.ok(!map.cone.some((point) => pointInPolygon(point, bump.slice(1), false)));

  // The floor's walls of unknown thickness: lines, as the plan draws them; W3 keeps its own.
  const unknown = example();
  applied(
    unknown.apply({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: 'floor_exterior_wall_thickness',
      property: 'wall_thickness',
      value: null,
    })
  );
  const w1 = mapOf(unknown, 'W1');
  assert.equal(w1.lines.length, 4, "W1, W2, W3.2 and W4: the Bedroom's, not Room 2's");
  assert.ok(material(w1, p(3.3, 3.1)) && !material(w1, p(2.5, -0.1)), "W3's material, W1 a line");
});
