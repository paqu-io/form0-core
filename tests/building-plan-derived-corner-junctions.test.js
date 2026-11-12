import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { rotate } from './helpers/building-plan-derive.js';

const round = (value) => Math.round(value * 1000) / 1000 + 0;

/**
 * The example on today's engine or the derived core (shared walls move with a drag), turned by
 * `angle` about the origin. Points passed to `moveB` are in the example's own frame.
 */
function example(derived = true, angle = 0) {
  const f = createBuildingPlanExample();
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const turn = (x, y) => ({ x: x * c - y * s, y: x * s + y * c });
  // B's corners, followed by their IDs across edits.
  const cornerOf = ([x, y]) =>
    f.snapshot.floors[0].rooms[1].vertices.find((v) => v.x === x && v.y === y).id;
  const cornersB = { west: cornerOf([3, 3.2]), east: cornerOf([8, 3.2]) };
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: angle ? rotate(f.snapshot, angle) : f.snapshot,
    properties: f.meta.properties,
    createId: () => `j-${++serial}`,
    derivedCommands: derived,
    editingPolicy: { sharedWallDrag: 'move_wall' },
  });
  const floor = () => session.getSnapshot().floors[0];
  const applied = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
  };
  const vertexAt = (roomIndex, [x, y]) =>
    floor().rooms[roomIndex].vertices.find((v) => round(v.x) === x && round(v.y) === y);
  const moveB = (x, y, corner = 'west') =>
    applied({
      type: 'move_corner',
      roomId: floor().rooms[1].id,
      vertexId: cornersB[corner],
      point: turn(x, y),
    });
  return { f, session, floor, applied, vertexAt, moveB };
}

/** Vertices where the outline turns (collinear stations left out), rounded to 1 mm. */
function corners(room) {
  const v = room.vertices;
  return v
    .filter((b, i) => {
      const a = v[(i + v.length - 1) % v.length];
      const c = v[(i + 1) % v.length];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      return Math.abs(cross) / Math.hypot(c.x - a.x, c.y - a.y) > 1.5e-4;
    })
    .map((p) => [round(p.x), round(p.y)]);
}

/** Run the same steps on both engines and compare outlines after each one. */
function bothEngines(steps, angle = 0) {
  const [now, derived] = [example(false, angle), example(true, angle)];
  for (const step of steps) {
    for (const t of [now, derived]) step(t);
    assert.deepEqual(derived.floor().rooms.map(corners), now.floor().rooms.map(corners));
  }
  return { now, derived };
}

// After faceB +1, B's south-west corner (3,2.2) has A on both sides: A's corner (2.8,2) wraps it.
const stepDown = (t) => t.applied({ type: 'resize_face', faceId: t.f.faceB, distance: 1 });

test('a wrapped corner: the neighbour corner goes where its moved lines meet, and back', () => {
  const { derived } = bothEngines([stepDown, (t) => t.moveB(3, 2.8), (t) => t.moveB(3, 2.2)]);
  // The corner slid along B's own west line: B's station at (3,3) kept its place throughout.
  assert.ok(derived.vertexAt(1, [3, 3]));
});

test('a wrapped corner reaches past a leftover wall of the neighbour', () => {
  // After the drag to (3,1.4), A's slanted line runs on past the shared wall as a short wall of
  // its own before A's corner; dragging back must not make a jog there.
  bothEngines([stepDown, (t) => t.moveB(3, 1.4), (t) => t.moveB(3, 2.2)]);
});

test('a station landing on the corner merges into it', () => {
  // Up and back: on the way back B's automatic station at the end of the shared wall lands on
  // B's corner and must merge instead of leaving a zero-length edge.
  const { derived } = bothEngines([(t) => t.moveB(3, 3.6), (t) => t.moveB(3, 3.2)]);
  const b = derived.floor().rooms[1];
  assert.deepEqual(
    b.vertices.map((v) => [round(v.x), round(v.y)]),
    [
      [3, 3.2],
      [5, 3.2],
      [8, 3.2],
      [8, 6.2],
      [3, 6.2],
    ]
  );
});

test('a corner moved along its own line past a station drops the station', () => {
  const t = example();
  const a = t.floor().rooms[0].vertices.map((v) => [v.x, v.y]);
  t.moveB(5.5, 3.2);
  const [roomA, roomB] = t.floor().rooms;
  assert.deepEqual(
    roomB.vertices.map((v) => [round(v.x), round(v.y)]),
    [
      [5.5, 3.2],
      [8, 3.2],
      [8, 6.2],
      [3, 6.2],
    ]
  );
  // A's facing line keeps its place: B no longer reaches it.
  assert.deepEqual(
    roomA.vertices.map((v) => [v.x, v.y]).filter(([x, y]) => !(x === 3 && y === 3)),
    a.filter(([x, y]) => !(x === 3 && y === 3))
  );
});

for (const angle of [0, 0.37])
  test(`a turned neighbour line bends at the pivot and straightens back (D), angle=${angle}`, () => {
    // B's east corner turns B's south line about its west corner (3,3.2): A's facing line turns
    // about a point next to its own station x = 3, where A's north line goes on to the west.
    const { derived } = bothEngines(
      [(t) => t.moveB(8, 2.8, 'east'), (t) => t.moveB(8, 3.2, 'east')],
      angle
    );
    const a = derived.floor().rooms[0];
    const sides = a.vertices.map((v, i) => {
      const w = a.vertices[(i + 1) % a.vertices.length];
      return Math.hypot(w.x - v.x, w.y - v.y);
    });
    assert.ok(Math.min(...sides) > 0.1, 'no sliver jog at the pivot');
  });

/** Distance from a point to the line through p and q. */
const toLine = (point, p, q) =>
  Math.abs((q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x)) /
  Math.hypot(q.x - p.x, q.y - p.y);

test('a slid corner drops the station it passes on its own moved line (E)', () => {
  // After B's east corner went to (8,2.6), B's south line is slanted with a 12 mm cap at its
  // west corner. Dragging that line 0.3 m slides the corner down B's west wall, 36 mm along the
  // moved line: past the cap's station, which must leave the outline.
  const t = example();
  t.moveB(8, 2.6, 'east');
  t.applied({ type: 'resize_face', faceId: t.f.faceB, distance: 0.3 });
  const b = t.floor().rooms[1];
  const corner = b.vertices.find((v) => round(v.x) === 3 && round(v.y) === 2.898);
  assert.ok(corner, 'the corner slid along B west wall');
  assert.ok(
    b.vertices.every((v) => v.x >= 3 - 1e-9),
    'no station left west of the slid corner'
  );
});

for (const point of [
  [3.2, 2.5],
  [2.7, 1.9],
])
  test(`a wrapped corner dragged diagonally: both neighbour lines turn (${point})`, () => {
    // Today refuses these drags (corner_constraint_conflict); the derived core places A's corner
    // where its two lines, 0.2 m from B's moved lines, meet.
    const t = example();
    stepDown(t);
    const before = t.floor().rooms.map(corners);
    t.moveB(...point);
    const [a, b] = t.floor().rooms;
    const at = (x, y) => b.vertices.find((v) => round(v.x) === x && round(v.y) === y);
    const [corner, east, north] = [at(...point), at(5, 2.2), at(3, 6.2)];
    assert.ok(
      a.vertices.some(
        (v) =>
          Math.abs(toLine(v, corner, east) - 0.2) < 1e-3 &&
          Math.abs(toLine(v, corner, north) - 0.2) < 1e-3
      ),
      "A's corner is the counterpart of B's"
    );
    t.moveB(3, 2.2);
    assert.deepEqual(t.floor().rooms.map(corners), before);
  });
