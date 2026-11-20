import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, validateBuildingPlanSnapshot } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// 4a-1 (2026-11-20): a column lies inside its room plus the room's own walls, and may touch but
// not overlap another column, a door or a window; the derived engine refuses any edit that breaks
// it. The example's bedroom is 0..5 × 0..3 m with 20 cm walls outside it (its right wall W2 from
// x 5 to 5.2), and a door "Shared door" in its lower wall from x 3.6 to 4.5.

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
  const column = (x, y, size = 0.3) =>
    apply({
      type: 'create_element',
      roomId: room().id,
      collection: 'columns',
      element: { position: { x, y }, width: size, height: size },
      values: {},
    });
  return { f, session, floor, room, apply, column };
}
const codes = (result) => (result.issues || []).map((issue) => issue.code);

test('a column may stand in its room’s wall, up to the far face', () => {
  const t = example();
  // Flush with the far face of W2: 10 cm in the room, 20 cm in the wall, its centre in the wall.
  assert.equal(t.column(5.05, 1.5).status, 'applied');
  // Centred on a 20 cm wall, a 20 cm column; and a 30 cm one, standing out on both sides.
  assert.equal(t.column(5.1, 2.4, 0.2).status, 'applied');
  assert.equal(t.column(5.1, 0.6).status, 'applied');
  assert.deepEqual(t.session.validate(), []);
  assert.deepEqual(validateBuildingPlanSnapshot(t.session.getSnapshot()), []);
});

test('standing out of a wall: centred on it, or flush with its interior face; else refused', () => {
  const t = example();
  // In W2, its room-side face on the wall's interior face (x 5): 10 cm past the exterior face.
  assert.equal(t.column(5.15, 1.5).status, 'applied');
  // Centred where W1's and W2's midlines meet, a 30 cm column stands out of both.
  assert.equal(t.column(5.1, -0.1).status, 'applied');
  // Off the midline, partly in the room: refused.
  assert.equal(example().column(5.12, 1.5).issues[0].code, 'column_outside_room');
  // In the wall but not flush with its interior face: refused, naming the column.
  const result = example().column(5.18, 1.5);
  assert.notEqual(result.status, 'applied');
  assert.deepEqual(codes(result), ['column_outside_room']);
  assert.equal(result.issues[0].message, 'Column C#1 would leave its room.');
  assert.equal(result.issues[0].subject.type, 'columns');
});

test('over another column: refused, naming both', () => {
  const t = example();
  assert.equal(t.column(2, 1.5).status, 'applied');
  const first = t.room().columns[0];
  assert.equal(first.values.column_identifier, 'C#1');
  const result = t.column(2.2, 1.5);
  assert.deepEqual(codes(result), ['column_overlap']);
  assert.equal(result.issues[0].message, 'Column C#2 would overlap column C#1.');
  assert.deepEqual(result.issues[0].columnIds, [first.id]);
  // Touching it is fine.
  assert.equal(t.column(2.3, 1.5).status, 'applied');
});

test('a door: beside its jamb yes, flush across it no', () => {
  const t = example();
  const result = t.column(4, 2.85);
  assert.deepEqual(codes(result), ['column_overlap']);
  assert.equal(result.issues[0].message, 'Column C#1 would overlap Shared door.');
  assert.equal(result.issues[0].openingIds.length, 1);
  assert.equal(t.column(3.45, 2.85).status, 'applied');
});

test('a wall moved in past a column, or a size typed out of the room: refused', () => {
  // (Moved in by 20 cm, the wall's body would hold the column: allowed.)
  const t = example();
  assert.equal(t.column(4.85, 1.5).status, 'applied');
  const w2 = t.floor().walls.find((wall) => wall.autoLabel === 'W2');
  const face = t.room().faces.find((entry) => entry.wallId === w2.id);
  assert.deepEqual(codes(t.apply({ type: 'resize_face', faceId: face.id, distance: -0.35 })), [
    'column_outside_room',
  ]);
  const column = t.room().columns[0];
  const resize = (width) =>
    t.apply({
      type: 'update_element',
      roomId: t.room().id,
      collection: 'columns',
      elementId: column.id,
      element: { position: column.position, width, height: 0.3 },
      values: { column_width: width },
    });
  assert.equal(resize(0.6).status, 'applied');
  assert.deepEqual(codes(resize(0.8)), ['column_outside_room']);
});

test('an entry previewing its unchanged row (an empty batch): no refusal for a column in a wall', () => {
  // The empty batch goes to today's engine even on the derived one; it has no column rule.
  const t = example();
  assert.equal(t.column(5.05, 1.5).status, 'applied');
  const result = t.session.preview({ type: 'batch', operations: [], floorId: t.f.floorId });
  assert.deepEqual(result.issues || [], []);
});
