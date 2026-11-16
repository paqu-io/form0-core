import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const near = (a, b) => Math.abs(a - b) < 1e-9;

/** The example on the derived core (widen, midline), with the plan's edits applied. */
function example(editingPolicy = {}) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `jog-${++serial}`,
    derivedCommands: true,
    editingPolicy: { sharedWallDrag: 'widen', thicknessAnchor: 'midline', ...editingPolicy },
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const applied = (operation) => {
    const result = apply(operation);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  return { floor, apply, applied };
}

/** The ends of a row (its first edge's end points). */
function ends(room, face) {
  const edge = room.edges.find((entry) => entry.id === face.edgeIds[0]);
  return [edge.startId, edge.endId].map((id) => room.vertices.find((v) => v.id === id));
}
const rowWhere = (room, test) => room.faces.find((face) => test(...ends(room, face)));
/** Corners only: an automatic boundary on a straight line is no change of shape. */
const corners = (room) =>
  room.vertices
    .filter((b, i, v) => {
      const [a, c] = [v[(i + v.length - 1) % v.length], v[(i + 1) % v.length]];
      return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9;
    })
    .map((v) => [v.x, v.y]);

/**
 * Manual round, session 4007c4b7: exterior walls 0.5 m (midline), then Room 1's bottom-left row
 * dragged 3.2 m down, so Room 1 wraps Room 2's top-left corner. Room 1's outline then runs W2,
 * W3 (shared with Room 2, with the door) and W8 (shared): W3 is the step between W2 and W8.
 */
function wrapped() {
  const t = example();
  t.applied({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness',
    value: 0.5,
  });
  const room1 = t.floor().rooms[0];
  const bottomLeft = rowWhere(room1, (a, b) => near(a.y, 2.85) && near(b.y, 2.85));
  t.applied({ type: 'resize_face', faceId: bottomLeft.id, distance: 3.2 });
  return t;
}
const doorWall = (floor) => floor.walls.find((wall) => wall.doors.length);

test("a step that is another room's wall holds: the dragged corner slides along it", () => {
  for (const distance of [-0.1, 0.1]) {
    const t = wrapped();
    const room2 = corners(t.floor().rooms[1]);
    const room1 = t.floor().rooms[0];
    const east = Math.max(...room1.vertices.map((v) => v.x));
    const w2 = rowWhere(room1, (a, b) => near(a.x, east) && near(b.x, east));
    t.applied({ type: 'resize_face', faceId: w2.id, distance });
    const after = t.floor().rooms[0];
    // W3 stays where it is, still shared with Room 2 and still holding the door.
    assert.ok(!after.vertices.some((v) => near(v.y, 2.85)), String(distance));
    assert.ok(after.vertices.some((v) => near(v.y, 3) && near(v.x, east + distance)));
    assert.equal(doorWall(t.floor()).exposure, 'interior');
    assert.deepEqual(corners(t.floor().rooms[1]), room2);
  }
});

test('dragging the other end of that step leaves its door alone', () => {
  for (const distance of [-0.1, 0.1]) {
    const t = wrapped();
    const room1 = t.floor().rooms[0];
    // W8: Room 1's side of the vertical wall it shares with Room 2.
    const shared = room1.faces.find((face) => {
      const wall = t.floor().walls.find((w) => w.id === face.wallId);
      const [a, b] = ends(room1, face);
      return wall.exposure === 'interior' && near(a.x, b.x);
    });
    const door = doorWall(t.floor()).doors[0].id;
    // No door question: the door's wall (the step) is not part of the edit.
    t.applied({ type: 'resize_face', faceId: shared.id, distance });
    assert.equal(doorWall(t.floor())?.doors[0].id, door, String(distance));
    assert.ok(t.floor().rooms[0].vertices.some((v) => near(v.y, 3) && v.x > 4.8));
  }
});

/**
 * Room 1 as an L (its bottom split at x = 3, the left part 3 m down), Room 2 removed, and a room
 * to the east whose north wall stands at the step's level beyond Room 1's east wall. The step
 * (x 3–5 at y = 3) is free: no other room touches it. It holds the example's door unless removed.
 */
function lShaped({ keepDoor = false } = {}) {
  const t = example();
  const door = doorWall(t.floor());
  if (!keepDoor)
    t.applied({ type: 'remove_opening', wallId: door.id, openingId: door.doors[0].id });
  t.applied({ type: 'remove_room', roomId: t.floor().rooms[1].id });
  const room = () => t.floor().rooms[0];
  const bottom = rowWhere(room(), (a, b) => near(a.y, 3) && near(b.y, 3));
  t.applied({ type: 'split_face', faceId: bottom.id, edgeId: bottom.edgeIds[0], offset: 2 });
  const left = rowWhere(room(), (a, b) => near(a.y, 3) && near(b.y, 3) && Math.max(a.x, b.x) < 3.1);
  t.applied({ type: 'resize_face', faceId: left.id, distance: 3 });
  t.applied({
    type: 'create_room',
    attach: false,
    rectangle: { x: 5.6, y: 2.9, width: 2.4, height: 3 },
  });
  const east = () => rowWhere(room(), (a, b) => near(a.x, 5) && near(b.x, 5));
  return { ...t, room, east };
}
const rounded = (room) =>
  room.vertices.map((v) => [Math.round(v.x * 1000) / 1000, Math.round(v.y * 1000) / 1000]);
/** A door's centre on the plan (its offset runs along its wall's segment). */
function doorCentre(floor) {
  const wall = doorWall(floor);
  const door = wall.doors[0];
  const { start, end } = wall.segments.find((segment) => segment.id === door.segmentId);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const along = door.offset + door.width / 2;
  return {
    id: door.id,
    x: start.x + ((end.x - start.x) * along) / length,
    y: start.y + ((end.y - start.y) * along) / length,
  };
}

test("a free step stays put when the dragged stretch moves in (no retreat on the step's depth)", () => {
  const t = lShaped();
  t.applied({ type: 'resize_face', faceId: t.east().id, distance: -0.1 });
  assert.deepEqual(rounded(t.room()), [
    [0, 0],
    [4.9, 0],
    [4.9, 3],
    [3, 3],
    [3, 6],
    [0, 6],
  ]);
});

test('a free step that stays where it stands keeps its door: the corner slides along it', () => {
  for (const distance of [-0.1, 0.1, 0.25]) {
    const t = lShaped({ keepDoor: true });
    const before = doorCentre(t.floor());
    // No door question: the step is not placed again.
    t.applied({ type: 'resize_face', faceId: t.east().id, distance });
    assert.deepEqual(rounded(t.room()).slice(1, 4), [
      [5 + distance, 0],
      [5 + distance, 3],
      [3, 3],
    ]);
    const after = doorCentre(t.floor());
    assert.equal(after.id, before.id, String(distance));
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    assert.ok(moved < 1e-6, JSON.stringify({ before, after }));
  }
  // The step shortened past the door, or gone: the door is part of the edit (question).
  for (const distance of [-1.9, -2, -2.5]) {
    const t = lShaped({ keepDoor: true });
    const result = t.apply({ type: 'resize_face', faceId: t.east().id, distance });
    assert.equal(result.status, 'conflict', String(distance));
    assert.equal(result.issues[0].code, 'opening_cut_requires_confirmation');
  }
});
