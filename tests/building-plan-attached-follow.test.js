import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  faceCentreline,
  newFreeWallFace,
  newFreeWallWidth,
} from '../src/building-plan/free-wall-lines.js';

// 4b (2026-11-21): attached contents follow their wall (rule 3), on the derived engine. Whatever
// touches a line an edit moves moves with it: a free wall's end (the wall gets longer or shorter,
// or turns), a free wall lying along a face, a free wall's end on a moved free wall, a column.
// The example's bedroom is 0..5 × 0..3 m (W1 above, W2 right, both 20 cm, outside it); the room
// below it shares W3 (y 3..3.2, x 3..5). Free walls are given by their centreline, 20 cm thick.

function example(derived = true) {
  const f = createBuildingPlanExample();
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    derivedCommands: derived,
  });
  const floor = () => session.getSnapshot().floors[0];
  const room = (index = 0) => floor().rooms[index];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  return { f, session, floor, room, apply };
}
const round = (value) => Math.round(value * 1e4) / 1e4;
const codes = (result) => (result.issues || []).map((issue) => issue.code);
const freeWall = (t, points) =>
  t.apply({
    type: 'create_wall',
    roomId: t.room().id,
    vertices: newFreeWallFace(
      points.map(([x, y]) => ({ x, y })),
      newFreeWallWidth(t.floor(), t.room().id, t.f.meta.properties)
    ),
    values: {},
  });
const freeFaces = (t) => t.room().faces.filter((face) => face.freePath);
const centrelines = (t) =>
  freeFaces(t).map((face) =>
    faceCentreline(t.floor(), t.room(), face).map(({ x, y }) => [round(x), round(y)])
  );
const wallOf = (t, label) => t.floor().walls.find((wall) => wall.autoLabel === label);
const faceOf = (t, label, room = t.room()) =>
  room.faces.find((face) => face.wallId === wallOf(t, label).id);
const moveFace = (t, label, distance) =>
  t.apply({ type: 'resize_face', faceId: faceOf(t, label).id, distance });
const column = (t, x, y, size = 0.3) =>
  t.apply({
    type: 'create_element',
    roomId: t.room().id,
    collection: 'columns',
    element: { position: { x, y }, width: size, height: size },
    values: {},
  });
const columns = (t) => t.room().columns.map(({ position }) => [position.x, position.y].map(round));

test('a free wall’s end on a face follows it, out and in; too short, or touching nothing: refused', () => {
  const t = example();
  freeWall(t, [
    [3, 1],
    [5, 1],
  ]);
  assert.equal(moveFace(t, 'W2', 0.3).status, 'applied');
  assert.deepEqual(centrelines(t), [
    [
      [3, 1],
      [5.3, 1],
    ],
  ]);
  assert.equal(moveFace(t, 'W2', -0.8).status, 'applied');
  assert.deepEqual(centrelines(t)[0][1], [4.5, 1]);
  // Past its other end (D4): refused, naming it.
  const past = moveFace(t, 'W2', -2);
  assert.deepEqual(codes(past), ['free_wall_too_short']);
  assert.equal(past.issues[0].message, 'Wall W9 would be too short.');
  assert.equal(past.issues[0].subject.type, 'room_face');
  // One that doesn't touch the face still blocks it (D8, rule 1).
  const clear = example();
  freeWall(clear, [
    [3, 1],
    [4.8, 1],
  ]);
  assert.deepEqual(codes(moveFace(clear, 'W2', -0.5)), ['free_wall_outside_room']);
  // Today's engine: it stays.
  const today = example(false);
  freeWall(today, [
    [3, 1],
    [5, 1],
  ]);
  moveFace(today, 'W2', 0.3);
  assert.deepEqual(centrelines(today)[0][1], [5, 1]);
});

test('a slanted wall keeps its end’s place along a moved face; at a corner move, its fraction', () => {
  const t = example();
  freeWall(t, [
    [3, 1],
    [5, 2],
  ]);
  assert.equal(moveFace(t, 'W2', 1).status, 'applied');
  assert.deepEqual(centrelines(t)[0], [
    [3, 1],
    [6, 2],
  ]);
  const c = example();
  freeWall(c, [
    [3, 1],
    [5, 1],
  ]);
  const corner = c.room().vertices.find((vertex) => vertex.x === 5 && vertex.y === 3);
  const moved = c.apply({
    type: 'move_corner',
    roomId: c.room().id,
    vertexId: corner.id,
    point: { x: 6, y: 3 },
  });
  assert.equal(moved.status, 'applied');
  // A third of the way down the right face, as before.
  assert.deepEqual(centrelines(c)[0][1], [5.3333, 1]);
});

test('a wall lying along a face moves with it; one ending on a moved free wall follows it', () => {
  const t = example();
  freeWall(t, [
    [1, 0.1],
    [3, 0.1],
  ]);
  assert.equal(moveFace(t, 'W1', -0.5).status, 'applied');
  assert.deepEqual(centrelines(t)[0], [
    [1, 0.6],
    [3, 0.6],
  ]);
  const w = example();
  freeWall(w, [
    [1, 1.5],
    [4, 1.5],
  ]);
  // From the lower side of W9 down to the lower face.
  freeWall(w, [
    [2, 1.6],
    [2, 3],
  ]);
  const w9 = freeFaces(w)[0];
  const moved = w.apply({
    type: 'update_wall',
    wallId: w9.wallId,
    faceId: w9.id,
    vertices: w9.freePath.map((point) => ({ x: point.x, y: point.y - 0.5 })),
  });
  assert.equal(moved.status, 'applied');
  assert.deepEqual(centrelines(w), [
    [
      [1, 1],
      [4, 1],
    ],
    [
      [2, 1.1],
      [2, 3],
    ],
  ]);
});

test('a shared wall moved from the other room carries the bedroom’s free wall (D7)', () => {
  const t = example();
  freeWall(t, [
    [4, 1],
    [4, 3],
  ]);
  const below = faceOf(t, 'W3', t.room(1));
  assert.equal(t.apply({ type: 'resize_face', faceId: below.id, distance: 0.5 }).status, 'applied');
  assert.deepEqual(centrelines(t)[0], [
    [4, 1],
    [4, 2.5],
  ]);
});

test('its openings keep their place in the room; flush with a face, a thicker wall keeps it', () => {
  const t = example();
  // Drawn from the right face, so its start is the end that moves.
  freeWall(t, [
    [5, 1],
    [3, 1],
  ]);
  const wall = () => wallOf(t, 'W9');
  const opening = t.apply({
    type: 'create_opening',
    wallId: wall().id,
    segmentId: wall().segments[0].id,
    kind: 'door',
    offset: 0.5,
    width: 0.8,
    height: 2,
    sillHeight: null,
  });
  assert.equal(opening.status, 'applied');
  const doorCentre = () => {
    const segment = wall().segments[0];
    const door = wall().doors[0];
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    const at = (door.offset + door.width / 2) / length;
    return [segment.start.x + (segment.end.x - segment.start.x) * at, segment.start.y].map(round);
  };
  const before = doorCentre();
  assert.equal(moveFace(t, 'W2', 0.3).status, 'applied');
  assert.deepEqual(doorCentre(), before);
  // D5: along the upper face, 20 cm made 40: its side on the face stays.
  const f = example();
  freeWall(f, [
    [1, 0.1],
    [3, 0.1],
  ]);
  const thicker = f.apply({
    type: 'set_property',
    faceId: freeFaces(f)[0].id,
    property: 'wall_thickness',
    value: 0.4,
  });
  assert.equal(thicker.status, 'applied');
  assert.deepEqual(centrelines(f)[0], [
    [1, 0.2],
    [3, 0.2],
  ]);
});

test('a column flush with a face follows it; a free-standing one still blocks it', () => {
  const t = example();
  column(t, 4.85, 1.5);
  assert.equal(moveFace(t, 'W2', -0.35).status, 'applied');
  assert.deepEqual(columns(t), [[4.5, 1.5]]);
  // One clear of it, passed by the wall's far face: refused (D8, rule 1).
  const clear = example();
  column(clear, 2, 0.6);
  assert.deepEqual(codes(moveFace(clear, 'W1', -0.8)), ['column_outside_room']);
});

test('a thicker wall: a column keeps to its midline or far face, or stays flush with its face', () => {
  const t = example();
  column(t, 5.1, 2.4, 0.2); // centred, as wide as the wall
  column(t, 5.05, 1.5); // flush with the far face
  column(t, 5.15, 0.8); // in the wall from its face, standing out
  column(t, 5.1, -0.1); // centred where W1's and W2's midlines meet
  const thicker = t.apply({
    type: 'set_property',
    faceId: faceOf(t, 'W2').id,
    property: 'wall_thickness',
    value: 0.4,
  });
  assert.equal(thicker.status, 'applied');
  assert.deepEqual(columns(t), [
    [5.2, 2.4],
    [5.25, 1.5],
    [5.15, 0.8],
    [5.2, -0.1],
  ]);
  assert.equal(moveFace(t, 'W2', 0.5).status, 'applied');
  assert.deepEqual(columns(t), [
    [5.7, 2.4],
    [5.75, 1.5],
    [5.65, 0.8],
    [5.7, -0.1],
  ]);
});

test('a column flush with a face, made wider, keeps its side on the face (D6)', () => {
  const t = example();
  column(t, 4.85, 1.5);
  const { id, position } = t.room().columns[0];
  const resized = t.apply({
    type: 'update_element',
    roomId: t.room().id,
    collection: 'columns',
    elementId: id,
    element: { position, width: 0.6, height: 0.3 },
    values: { column_width: 0.6 },
  });
  assert.equal(resized.status, 'applied');
  assert.deepEqual(columns(t), [[4.7, 1.5]]);
});

test('a face moved into line with its neighbour (they merge) still carries what touches it', () => {
  // After the 4b hand test: the top wall split at x 3, its right part raised 0.5 m; a column
  // flush with it and a free wall ending on it. Snapped back onto the left part's line, the two
  // faces merge into one (the jog's vertices go): both still follow.
  const t = example();
  const faceAlong = (test) =>
    t.room().faces.find((face) =>
      (face.edgeIds || []).some((id) => {
        const edge = t.room().edges.find((entry) => entry.id === id);
        const [a, b] = [edge.startId, edge.endId].map((v) =>
          t.room().vertices.find((entry) => entry.id === v)
        );
        return test(a, b);
      })
    );
  t.apply({
    type: 'split_face',
    faceId: faceAlong((a, b) => a.y === 0 && b.y === 0).id,
    offset: 3,
  });
  const raise = (distance, y) =>
    t.apply({
      type: 'resize_face',
      faceId: faceAlong((a, b) => a.y === y && b.y === y && Math.min(a.x, b.x) >= 2.99).id,
      distance,
    });
  assert.equal(raise(0.5, 0).status, 'applied');
  column(t, 4, -0.35);
  freeWall(t, [
    [4.5, -0.5],
    [4.5, 1.5],
  ]);
  const back = raise(-0.5, -0.5);
  assert.equal(back.status, 'applied', JSON.stringify(back.issues));
  assert.equal(t.room().vertices.length, 6);
  assert.deepEqual(columns(t), [[4, 0.15]]);
  assert.deepEqual(centrelines(t)[0], [
    [4.5, 0],
    [4.5, 1.5],
  ]);
});
