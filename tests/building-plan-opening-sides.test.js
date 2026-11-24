import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanRecordSession, createRecordEvaluator } from '../src/index.js';
import { getBuildingPlanProjectionLinks } from '../src/building-plan/records.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// WB3 (2026-11-24): each room's copy of an opening shows its distance from that room's own left
// end of the wall; the stored row (and so the exported record) keeps the distance along the wall.
// The example's shared door on W3 (2 m, its axis from x = 5 to x = 3; the door 0.9 m wide) is
// 0.5 m from the Bedroom's left end (x = 5), so 0.6 m from Room 2's (x = 3).

function setup() {
  const f = createBuildingPlanExample();
  const session = createBuildingPlanRecordSession({ meta: f.meta, record: f.record });
  const nodes = f.meta.repeatablesByNodeKey;
  const key = (node) => nodes[node].preferredKey;
  const name = (node, field) => nodes[node].fieldsByOriginalDataName[field].dataName;
  const floorOf = (record) => record.repeatable[key('floors')][0];
  /** Each room's copy of the shared door, with the row path an entry opens it by. */
  const copies = (record = session.getRecord()) => {
    const floor = floorOf(record);
    return floor.repeatable[key('rooms')].map((room) => {
      const face = room.repeatable[key('walls')].find(
        (row) => (row.repeatable?.[key('face_doors')] || []).length
      );
      const door = face.repeatable[key('face_doors')][0];
      return {
        door,
        offset: door.values[name('face_doors', 'door_offset')],
        path: [
          { key: key('floors'), id: floor.id },
          { key: key('rooms'), id: room.id },
          { key: key('walls'), id: face.id },
          { key: key('face_doors'), id: door.id },
        ],
      };
    });
  };
  const stored = (record = session.getRecord()) =>
    floorOf(record)
      .repeatable[key('physical_walls')].flatMap((wall) => wall.repeatable[key('doors')] || [])
      .map((row) => ({
        offset: row.values[name('doors', 'door_offset')],
        width: row.values[name('doors', 'door_width')],
      }))[0];
  /** Types `values` (original data names) into a room's copy, as its entry's Save does. */
  const type = (roomIndex, values) => {
    const { door, path } = copies()[roomIndex];
    const edited = structuredClone(door);
    for (const [field, value] of Object.entries(values))
      edited.values[name('face_doors', field)] = value;
    const scopeId = session.beginScope({ id: `door-${roomIndex}-${Math.random()}` }).scopeId;
    return session.applyRow({ path, editedRow: edited, initialRow: door, scopeId });
  };
  return { f, session, copies, stored, type, name };
}
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));

test("each room's copy counts from its own left end; the stored row doesn't change", () => {
  const t = setup();
  assert.deepEqual(
    t.copies().map((copy) => copy.offset),
    [0.5, 0.6]
  );
  assert.deepEqual(t.stored(), { offset: 0.5, width: 0.9 });
});

test("a distance typed in Room 2's copy is from Room 2's left end", () => {
  const t = setup();
  applied(t.type(1, { door_offset: 1 }));
  assert.deepEqual(
    t.copies().map((copy) => copy.offset),
    [0.1, 1]
  );
  assert.deepEqual(t.stored(), { offset: 0.1, width: 0.9 });
  // In the Bedroom (the wall runs left to right for it) a typed distance is stored as it is.
  applied(t.type(0, { door_offset: 0.3 }));
  assert.deepEqual(
    t.copies().map((copy) => copy.offset),
    [0.3, 0.8]
  );
});

test("a width typed in a room keeps that room's distance: the door grows to its right", () => {
  const t = setup();
  applied(t.type(1, { door_width: 1.2 }));
  assert.deepEqual(
    t.copies().map((copy) => copy.offset),
    [0.2, 0.6]
  );
  assert.deepEqual(t.stored(), { offset: 0.2, width: 1.2 });
  applied(t.type(0, { door_width: 1 }));
  assert.deepEqual(
    t.copies().map((copy) => copy.offset),
    [0.2, 0.8]
  );
});

test("Room 2's distance is its copy's own value, kept by a full evaluation", async () => {
  const t = setup();
  const record = t.session.getRecord();
  const links = getBuildingPlanProjectionLinks({ meta: t.f.meta, record });
  const offsetName = t.name('face_doors', 'door_offset');
  const [bedroom, room2] = t.copies(record).map((copy) => links.get(copy.door));
  assert.ok(bedroom.has(offsetName), "the Bedroom's distance mirrors the stored row");
  assert.ok(!room2.has(offsetName), "Room 2's distance is not a mirror of the stored row");
  assert.ok(room2.has(t.name('face_doors', 'door_width')), 'its other answers still mirror it');
  // The record evaluator refreshes copies and their mirrors on every full evaluation.
  const evaluated = await createRecordEvaluator({
    schema: t.f.schema,
    diagnostics: { console: false },
  }).evaluate(record);
  assert.equal(evaluated.status, 'evaluated', JSON.stringify(evaluated.issues));
  assert.deepEqual(
    t.copies(evaluated.snapshot).map((copy) => copy.offset),
    [0.5, 0.6]
  );
});
