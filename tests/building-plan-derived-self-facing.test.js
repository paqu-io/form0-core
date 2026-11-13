import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

const f = createBuildingPlanExample();
const derivedSession = (snapshot) => {
  let serial = 0;
  return createBuildingPlanSession({
    snapshot,
    properties: f.meta.properties,
    createId: () => `q5-${++serial}`,
    derivedCommands: true,
    editingPolicy: {
      inheritedChangePolicy: 'apply',
      thicknessAnchor: 'room_face',
      sharedWallDrag: 'widen',
    },
  });
};

test("a row drag that would leave a slit against the room's own wall refuses (Q5)", () => {
  // Session 34ce7725 (F4′ fixture) with the corner stub W7.4 kept a wall by a note: dragging the
  // row next to it moved only that row, and its new jog faced Room 2's own wall W3.3 across a
  // 0.2 m slit (overlapping material for short drags; an enclosed 0.2 m void when the jog retreats).
  const { snapshot } = JSON.parse(
    readFileSync(new URL('./fixtures/building-plan-session-34ce7725.json', import.meta.url), 'utf8')
  );
  const stub = snapshot.floors[0].walls.find((wall) => wall.autoLabel === 'W7.4');
  stub.values = { ...stub.values, wall_note: 'kept' };
  for (const distance of [0.3, 1.1546]) {
    const session = derivedSession(structuredClone(snapshot));
    const result = session.apply({
      floorId: snapshot.floors[0].id,
      type: 'resize_face',
      faceId: '01a1d0c4-a758-7a77-bdcd-c051532a8fbf',
      distance,
    });
    assert.notEqual(result.status, 'applied', `distance ${distance}`);
    assert.deepEqual(
      result.issues.map((issue) => [issue.code, issue.subject?.id]),
      [['wall_clearance_conflict', 'acceptance-subject-35']]
    );
    assert.match(result.issues[0].message, /slit against Room 2's own wall/);
  }
});

test('a notch made by one drag keeps its two jogs even when their walls touch', () => {
  // A chimney breast: Split the top face twice and drag the 0.4 m portion 0.8 m in. The two
  // jogs face each other closer than their walls allow, but the drag made both: not a slit.
  const session = derivedSession(undefined);
  const floorId = session.apply({ type: 'create_floor' }).created.id;
  const roomId = session.apply({
    type: 'create_room',
    floorId,
    rectangle: { x: 0, y: 0, width: 6, height: 4 },
  }).created.id;
  const room = () => session.getSnapshot().floors[0].rooms.find((entry) => entry.id === roomId);
  const faceOnTop = (x) => {
    const r = room();
    const at = new Map(r.vertices.map((point) => [point.id, point]));
    return r.faces.find((face) =>
      face.edgeIds.some((id) => {
        const edge = r.edges.find((entry) => entry.id === id);
        const [a, b] = [at.get(edge.startId), at.get(edge.endId)];
        return a.y === 0 && b.y === 0 && Math.min(a.x, b.x) < x && x < Math.max(a.x, b.x);
      })
    ).id;
  };
  const applied = (operation) => {
    const result = session.apply({ floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  };
  applied({ type: 'split_face', faceId: faceOnTop(3), offset: 2.8 });
  applied({ type: 'split_face', faceId: faceOnTop(3), offset: 0.4 });
  applied({ type: 'resize_face', faceId: faceOnTop(3), distance: -0.8 });
  assert.deepEqual(
    room().vertices.map((point) => [point.x, point.y].map((v) => Math.round(v * 1000) / 1000)),
    [
      [0, 0],
      [2.8, 0],
      [2.8, 0.8],
      [3.2, 0.8],
      [3.2, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ]
  );
});
