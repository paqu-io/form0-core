import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const round = (value) => Math.round(value * 1000) / 1000 + 0;

/** The example on today's engine or the derived core, shared walls moving with a drag. */
function example(derived) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `s-${++serial}`,
    derivedCommands: derived,
    editingPolicy: { sharedWallDrag: 'move_wall' },
  });
  const floor = () => session.getSnapshot().floors[0];
  const applied = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return result;
  };
  return { f, session, floor, applied };
}

/** Corners and cuts of every room (collinear stations left out), rounded to 1 mm. */
function shape(floor) {
  return floor.rooms.map((room) => {
    const v = room.vertices;
    return v
      .filter((b, i) => {
        const [a, c] = [v[(i + v.length - 1) % v.length], v[(i + 1) % v.length]];
        const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        return b.editingCutId || Math.abs(cross) / Math.hypot(c.x - a.x, c.y - a.y) > 1.5e-4;
      })
      .map((p) => `${round(p.x)},${round(p.y)}${p.editingCutId ? ':cut' : ''}`);
  });
}

/** Split A's side of the shared wall at x = 3.5; returns a mover for A's cut vertex. */
function splitShared(t) {
  const cutId = t.applied({ type: 'split_face', faceId: t.f.faceA, offset: 1.5 }).created.id;
  const vertexId = t.floor().rooms[0].vertices.find((v) => v.editingCutId === cutId).id;
  return (point) =>
    t.applied({ type: 'move_corner', roomId: t.floor().rooms[0].id, vertexId, point });
}

test('a shared Split point moves like a corner and returns: same outlines as today', () => {
  const [now, derived] = [example(false), example(true)];
  const [moveNow, moveDerived] = [now, derived].map(splitShared);
  for (const point of [
    { x: 3.5, y: 3.6 },
    { x: 3.5, y: 3 },
  ]) {
    moveNow(point);
    moveDerived(point);
    assert.deepEqual(shape(derived.floor()), shape(now.floor()));
  }
  // B's counterpart cut followed: it is at x = 3.5 on B's face again.
  assert.ok(derived.floor().rooms[1].vertices.some((v) => v.editingCutId && round(v.x) === 3.5));
});

test('a shared Split point dragged into the neighbour and back restores the Split state', () => {
  // Today's engine makes a return along A's east wall at the pivot; the derived core bends there
  // (decision D), and dragging back straightens the line again.
  const t = example(true);
  const move = splitShared(t);
  const split = shape(t.floor());
  move({ x: 3.5, y: 2.4 });
  assert.notDeepEqual(shape(t.floor()), split);
  move({ x: 3.5, y: 3 });
  assert.deepEqual(shape(t.floor()), split);
});

test('a dragged Split portion makes a jog that carries the cut at both ends, as today', () => {
  const [now, derived] = [example(false), example(true)];
  for (const t of [now, derived]) {
    const south = t.floor().rooms[0].faces[0].id;
    t.applied({ type: 'split_face', faceId: south, offset: 4.9 });
    const portion = t
      .floor()
      .rooms[0].faces.find(
        (face) => face.lineage?.editingOriginFaceId === south && face.id !== south
      );
    t.applied({ type: 'resize_face', faceId: portion.id, distance: -0.3 });
  }
  assert.deepEqual(shape(derived.floor()), shape(now.floor()));
});

test('a corner sliding past a cut on the adjoining wall retires that cut (I3; today refuses)', () => {
  const [now, derived] = [example(false), example(true)];
  const drag = (t) => {
    const south = t.floor().rooms[0].faces[0].id;
    t.applied({ type: 'split_face', faceId: south, offset: 4.9 });
    const w2 = t.floor().walls.find((wall) => wall.autoLabel === 'W2');
    const east = t.floor().rooms[0].faces.find((face) => face.wallId === w2.id);
    return t.session.apply({
      floorId: t.f.floorId,
      type: 'resize_face',
      faceId: east.id,
      distance: -0.3,
    });
  };
  assert.equal(drag(now).issues?.[0]?.code, 'invalid_room_geometry');
  assert.equal(drag(derived).status, 'applied');
  assert.deepEqual(derived.session.validate(), []);
  const a = derived.floor().rooms[0];
  assert.ok(!a.vertices.some((v) => v.editingCutId), 'the passed cut retired');
  assert.ok(a.vertices.some((v) => round(v.x) === 4.7 && v.y === 0));
});
