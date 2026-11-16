import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBuildingPlanSession } from '../src/index.js';
import { sameCapAnswers } from '../src/building-plan/derive/caps.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

test('a cap has no thickness or height of its own: those answers do not keep it a wall (F4′)', () => {
  const source = { overrides: {}, values: {}, providerOverrides: {}, sides: [] };
  const stub = (extra) => ({
    overrides: {},
    values: {},
    providerOverrides: {},
    sides: [],
    ...extra,
  });
  assert.ok(sameCapAnswers(stub({ overrides: { wall_thickness: 0.35 } }), source));
  assert.ok(
    sameCapAnswers(stub({ overrides: { wall_thickness: 0.35, wall_height: 2.4 } }), source)
  );
  // Any other answer, or a custom row, is something the cap would lose.
  assert.ok(!sameCapAnswers(stub({ overrides: { material: 'Timber' } }), source));
  assert.ok(!sameCapAnswers(stub({ values: { wall_note: 'cracked' } }), source));
  assert.ok(!sameCapAnswers(stub({ repeatable: { defects: [{ id: 'd1' }] } }), source));
});

test("a stub that only differs by a copied thickness retires: a row drag moves the room's whole line", () => {
  // Manual round, session 34ce7725: Room 2's west line at x 4.419 ran from y 6.4 to 4.23 as the
  // dragged row and a 0.2 m stub below it (a piece split off a widened wall, 0.35 m explicit).
  // The stub lies inside W3.3's material: a cap. Kept as a wall, the drag ended against it and
  // left a 0.2 m slit facing Room 2's own wall (two overlapping exterior walls).
  const f = createBuildingPlanExample();
  const { snapshot } = JSON.parse(
    readFileSync(new URL('./fixtures/building-plan-session-34ce7725.json', import.meta.url), 'utf8')
  );
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot,
    properties: f.meta.properties,
    createId: () => `cap-${++serial}`,
    derivedCommands: true,
    editingPolicy: {
      inheritedChangePolicy: 'apply',
      thicknessAnchor: 'room_face',
      sharedWallDrag: 'widen',
    },
  });
  const floorId = snapshot.floors[0].id;
  const faceId = '01a1d0c4-a758-7a77-bdcd-c051532a8fbf';
  const result = session.apply({ floorId, type: 'resize_face', faceId, distance: 1.1546 });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.deepEqual(session.validate(), []);
  const floor = session.getSnapshot().floors[0];
  const room2 = floor.rooms.find((room) => room.id === 'acceptance-subject-35');
  const r3 = (value) => Math.round(value * 1000) / 1000 + 0;
  // Room 2 wraps Room 1's corner one interior wall away: its west line moved as a whole.
  assert.deepEqual(
    room2.vertices.map((v) => [r3(v.x), r3(v.y)]).filter(([x]) => x > 3 && x < 4.5),
    [
      [3.065, 6.4],
      [3.265, 6.4],
      [3.265, 6.2],
      [3.265, 4.43],
      [3.265, 4.23],
      [3.065, 4.23],
    ]
  );
  // No wall of Room 2 faces Room 2 (no slit).
  const exteriorOfRoom2 = floor.walls.filter(
    (wall) =>
      wall.exposure === 'exterior' &&
      wall.sides.some((side) => side.roomId === room2.id) &&
      wall.segments.every(
        (segment) =>
          Math.min(segment.start.x, segment.end.x) > 3 &&
          Math.max(segment.start.x, segment.end.x) < 4.5
      )
  );
  assert.deepEqual(
    exteriorOfRoom2.map((wall) => wall.autoLabel),
    []
  );
});
