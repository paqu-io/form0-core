import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const round = (value) => Math.round(value * 1000) / 1000 + 0;

/** The example on today's engine or the derived core (shared walls move with a drag). */
function example(derived = true) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
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
  // B's south-west corner (3,3.2), followed by its ID across edits.
  const cornerId = vertexAt(1, [3, 3.2]).id;
  const moveB = (x, y) =>
    applied({
      type: 'move_corner',
      roomId: floor().rooms[1].id,
      vertexId: cornerId,
      point: { x, y },
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
function bothEngines(steps) {
  const [now, derived] = [example(false), example()];
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
