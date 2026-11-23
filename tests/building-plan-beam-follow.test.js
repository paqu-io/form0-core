import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';

// 3a-4 (2026-11-23; B3 of the beams round, option b): a room beam follows what it touches, on the
// derived engine, as free walls and columns do (4b): an end on a room face, on a free wall's side
// or centreline, or on another beam's side or centreline; a beam lying along a face moves with it
// and keeps that side when it is made wider. The example's Bedroom is 0..5 × 0..3 m (W1 above,
// W2 right, W4 left, 20 cm walls outside it; W3.2 below, x 0..3). Beams are 15 cm wide.

function example(derived = true) {
  const f = createBuildingPlanExample();
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    derivedCommands: derived,
  });
  const floor = () => session.getSnapshot().floors[0];
  const room = () => floor().rooms[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  return { f, session, floor, room, apply };
}
const round = (value) => Math.round(value * 1e4) / 1e4;
const codes = (result) => (result.issues || []).map((issue) => issue.code);
const beam = (t, [x0, y0], [x1, y1], width = 0.15) =>
  t.apply({
    type: 'create_element',
    roomId: t.room().id,
    collection: 'beams',
    element: { start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, width, height: 0.3 },
    values: {},
  });
const beams = (t) =>
  t.room().beams.map(({ start, end }) => [
    [round(start.x), round(start.y)],
    [round(end.x), round(end.y)],
  ]);
const faceOf = (t, label) => {
  const wall = t.floor().walls.find((entry) => entry.autoLabel === label);
  return t.room().faces.find((face) => face.wallId === wall.id);
};
const moveFace = (t, label, distance) =>
  t.apply({ type: 'resize_face', faceId: faceOf(t, label).id, distance });
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));

test('an end on a face follows it, out and in; past its other end: refused, named', () => {
  const t = example();
  applied(beam(t, [0, 1.5], [5, 1.5]));
  applied(moveFace(t, 'W2', 0.5));
  assert.deepEqual(beams(t), [
    [
      [0, 1.5],
      [5.5, 1.5],
    ],
  ]);
  applied(moveFace(t, 'W2', -0.8));
  assert.deepEqual(beams(t)[0][1], [4.7, 1.5]);
  // Both ends: the left face moved in too.
  applied(moveFace(t, 'W4', -0.5));
  assert.deepEqual(beams(t)[0][0], [0.5, 1.5]);
  const short = example();
  applied(beam(short, [4.9, 1.5], [5, 1.5]));
  const past = moveFace(short, 'W2', -0.3);
  assert.deepEqual(codes(past), ['beam_too_short']);
  assert.equal(past.issues[0].message, 'Beam B#1 would be too short.');
  assert.equal(past.issues[0].subject.type, 'beams');
});

test('slanted onto a face: it keeps its place along a face moved square, its fraction at a corner', () => {
  const t = example();
  applied(beam(t, [2, 0.5], [5, 2]));
  applied(moveFace(t, 'W2', 0.4));
  assert.deepEqual(beams(t)[0][1], [5.4, 2]);
  // The bottom-right corner (5.4, 3) moved to (6, 3): along the right face, two thirds down.
  const corner = t.room().vertices.find((vertex) => round(vertex.x) === 5.4 && vertex.y === 3);
  applied(
    t.apply({
      type: 'move_corner',
      roomId: t.room().id,
      vertexId: corner.id,
      point: { x: 6, y: 3 },
    })
  );
  assert.deepEqual(beams(t)[0][1], [5.8, 2]);
});

test('lying along a face: it moves with it, and keeps that side when made wider', () => {
  const t = example();
  applied(beam(t, [1, 0.075], [4, 0.075]));
  applied(moveFace(t, 'W1', -0.5));
  assert.deepEqual(beams(t), [
    [
      [1, 0.575],
      [4, 0.575],
    ],
  ]);
  const placed = t.room().beams[0];
  applied(
    t.apply({
      type: 'update_element',
      roomId: t.room().id,
      collection: 'beams',
      elementId: placed.id,
      element: { start: placed.start, end: placed.end, width: 0.3, height: 0.3 },
      values: { beam_width: 0.3 },
    })
  );
  // Its side stays on the face (y 0.5): its centreline 15 cm below it.
  assert.deepEqual(beams(t)[0][0], [1, 0.65]);
});

test('on another beam that follows its face: it follows too', () => {
  const t = example();
  // A along the top face; B from A's lower side down to the bottom face.
  applied(beam(t, [1, 0.075], [4, 0.075]));
  applied(beam(t, [2, 0.15], [2, 3]));
  applied(moveFace(t, 'W1', -0.5));
  assert.deepEqual(beams(t)[1], [
    [2, 0.65],
    [2, 3],
  ]);
});

test('on a free wall: it follows the wall when it moves', () => {
  const t = example();
  // A free wall along y 1 from x 1 to 4 (centreline); a beam from the top face onto its centreline.
  applied(
    t.apply({
      type: 'create_wall',
      roomId: t.room().id,
      vertices: newFreeWallFace(
        [
          { x: 1, y: 1 },
          { x: 4, y: 1 },
        ],
        newFreeWallWidth(t.floor(), t.room().id, t.f.meta.properties)
      ),
      values: {},
    })
  );
  applied(beam(t, [2.5, 0], [2.5, 1]));
  const face = t.room().faces.find((entry) => entry.freePath);
  applied(
    t.apply({
      type: 'update_wall',
      wallId: face.wallId,
      faceId: face.id,
      vertices: face.freePath.map((point) => ({ x: point.x, y: point.y + 0.5 })),
    })
  );
  assert.deepEqual(beams(t)[0], [
    [2.5, 0],
    [2.5, 1.5],
  ]);
});

test('touching nothing it keeps its place; resting on a column it does not follow it', () => {
  const t = example();
  applied(beam(t, [1, 1.5], [3, 1.5]));
  applied(moveFace(t, 'W2', 0.3));
  assert.deepEqual(beams(t)[0], [
    [1, 1.5],
    [3, 1.5],
  ]);
  // A column flush with W2 follows it; a beam resting on its centre stays (a point, B3).
  const c = example();
  applied(
    c.apply({
      type: 'create_element',
      roomId: c.room().id,
      collection: 'columns',
      element: { position: { x: 4.85, y: 1.5 }, width: 0.3, height: 0.3 },
      values: {},
    })
  );
  applied(beam(c, [1, 1.5], [4.85, 1.5]));
  applied(moveFace(c, 'W2', 0.3));
  assert.deepEqual([round(c.room().columns[0].position.x)], [5.15]);
  assert.deepEqual(beams(c)[0][1], [4.85, 1.5]);
  // Today's engine: nothing follows.
  const today = example(false);
  applied(beam(today, [0, 1.5], [5, 1.5]));
  applied(moveFace(today, 'W2', 0.5));
  assert.deepEqual(beams(today)[0][1], [5, 1.5]);
});
