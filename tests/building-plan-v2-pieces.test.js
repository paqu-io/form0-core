import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { normalizePhysicalPieces } from '../src/building-plan/physical-pieces.js';
import { distance } from '../src/building-plan/geometry.js';

function fixture() {
  let serial = 0;
  const createId = () => `piece-${++serial}`;
  const session = createBuildingPlanSession({ createId });
  const apply = (operation) => {
    const result = session.apply(operation);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result.created?.id;
  };
  const floorId = apply({ type: 'create_floor' });
  const a = apply({ type: 'create_room', floorId, rectangle: { x: 0, y: 0, width: 6, height: 3 } });
  const b = apply({
    type: 'create_room',
    floorId,
    rectangle: { x: 2, y: 3.2, width: 2, height: 3 },
  });
  const before = session.getSnapshot().floors[0];
  apply({
    type: 'bind_faces',
    floorId,
    referenceFaceId: before.rooms[0].faces[2].id,
    faceId: before.rooms[1].faces[0].id,
  });
  return { floor: session.getSnapshot().floors[0], a, b, createId };
}

test('partial sharing divides into straight owners with consistent adjacency even when values match', () => {
  const f = fixture();
  const shared = f.floor.walls.find((w) =>
    f.floor.rooms.every((r) => r.faces.some((face) => face.wallId === w.id))
  );
  const originalId = shared.lineage?.splitFromWallId || shared.id;
  normalizePhysicalPieces(f.floor, f.createId);
  const run = f.floor.walls.filter(
    (w) => w.id === originalId || w.lineage?.splitFromWallId === originalId
  );
  assert.equal(run.length, 3);
  assert.deepEqual(
    run.map((w) => distance(w.segments[0].start, w.segments[0].end)),
    [2, 2, 2]
  );
  assert.deepEqual(
    run.map((w) => w.exposure),
    ['exterior', 'interior', 'exterior']
  );
  assert.ok(f.floor.walls.every((w) => w.segments.length === 1 && w.sides.length === 2));
  const ids = f.floor.walls.flatMap((w) => w.sides.map((side) => side.id));
  assert.equal(new Set(ids).size, ids.length);
  const middle = run[1];
  assert.ok(f.floor.rooms.every((room) => room.faces.some((face) => face.wallId === middle.id)));
  const saved = structuredClone(f.floor);
  normalizePhysicalPieces(f.floor, f.createId);
  assert.deepEqual(f.floor, saved, 'normalization preserves accepted identities');
});

test('adjacency division is independent of orientation', () => {
  const f = fixture();
  const rotate = ({ x, y, ...rest }) => ({
    ...rest,
    x: x * Math.cos(0.37) - y * Math.sin(0.37),
    y: x * Math.sin(0.37) + y * Math.cos(0.37),
  });
  for (const room of f.floor.rooms) room.vertices = room.vertices.map(rotate);
  for (const wall of f.floor.walls)
    for (const segment of wall.segments) {
      segment.start = rotate(segment.start);
      segment.end = rotate(segment.end);
    }
  normalizePhysicalPieces(f.floor, f.createId);
  assert.equal(f.floor.walls.filter((w) => w.exposure === 'interior').length, 1);
  assert.ok(f.floor.walls.every((w) => w.segments.length === 1));
});
