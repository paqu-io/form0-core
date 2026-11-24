import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanRecordSession,
  createBuildingPlanSession,
  createStructuredRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Wall beams, unit 1 (2026-11-24): each room's copy of a wall beam counts from that room's own
// left end (WB3); a distance or length typed there converts back; the exported record keeps the
// stored row only. Moved out of building-plan-wall-beams.test.js (file size). The example's W3
// is shared: 2 m, its axis from x = 5 (the Bedroom's left end) to x = 3 (Room 2's).

const round = (value) => Math.round(value * 1000) / 1000 + 0;

function example() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `c-${++serial}`,
    derivedCommands: true,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  return { f, session, floor, apply, wall };
}
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));
const addBeam = (t, label, offset, length, extra = {}) =>
  t.apply({
    type: 'create_opening',
    kind: 'beam',
    wallId: t.wall(label).id,
    offset,
    length,
    width: 0.2,
    depth: 0.3,
    underside: 2,
    values: {},
    ...extra,
  });
test("each room's copy counts from its own left end; typed there, converted back", () => {
  const t = example();
  applied(addBeam(t, 'W3', 0.2, 1.5));
  const nodes = t.f.meta.repeatablesByNodeKey;
  const name = (field) => nodes.face_beams.fieldsByOriginalDataName[field].dataName;
  const record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const copies = record.repeatable[nodes.floors.preferredKey][0].repeatable[
    nodes.rooms.preferredKey
  ].map((room) =>
    room.repeatable[nodes.walls.preferredKey]
      .flatMap((row) => row.repeatable?.[nodes.face_beams.preferredKey] || [])
      .map((row) => round(row.values[name('wall_beam_offset')]))
  );
  // From the Bedroom's left end (x = 5) 0.2 m; from Room 2's (x = 3) 2 - 0.2 - 1.5 = 0.3 m.
  assert.deepEqual(copies, [[0.2], [0.3]]);
  // Typed in Room 2's copy (its entry's Save): from Room 2's left end, stored from the wall's.
  const session = createBuildingPlanRecordSession({ meta: t.f.meta, record });
  const type = (values) => {
    const floorRow = session.getRecord().repeatable[nodes.floors.preferredKey][0];
    const room = floorRow.repeatable[nodes.rooms.preferredKey][1];
    const face = room.repeatable[nodes.walls.preferredKey].find(
      (row) => (row.repeatable?.[nodes.face_beams.preferredKey] || []).length
    );
    const beam = face.repeatable[nodes.face_beams.preferredKey][0];
    const edited = structuredClone(beam);
    for (const [field, value] of Object.entries(values)) edited.values[name(field)] = value;
    const scopeId = session.beginScope({ id: `beam-${Object.keys(values)[0]}` }).scopeId;
    const path = [
      { key: nodes.floors.preferredKey, id: floorRow.id },
      { key: nodes.rooms.preferredKey, id: room.id },
      { key: nodes.walls.preferredKey, id: face.id },
      { key: nodes.face_beams.preferredKey, id: beam.id },
    ];
    applied(session.applyRow({ path, editedRow: edited, initialRow: beam, scopeId }));
    const [stored] = session.getSnapshot().floors[0].walls.flatMap((wall) => wall.beams);
    return [round(stored.offset), round(stored.length)];
  };
  assert.deepEqual(type({ wall_beam_offset: 0.5 }), [0, 1.5]);
  // A length typed there keeps Room 2's distance: the beam grows to the right as Room 2 sees it.
  assert.deepEqual(type({ wall_beam_length: 1 }), [0.5, 1]);
  // The exported record keeps the stored row only.
  const stored = createStructuredRecord(record, t.f.schema.form.elements, {
    originalElements: t.f.schema.form.elements,
    fieldKeyMode: 'prefer-key',
  });
  assert.ok(!JSON.stringify(stored).includes('~bp_face_beams_'));
});
