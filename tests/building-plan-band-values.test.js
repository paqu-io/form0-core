import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanEditor,
  createBuildingPlanRecordSession,
  createBuildingPlanSession,
  settleBuildingPlanQuestions,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Bands unit 3 (decided 2026-11-24): a band row's underside and depth come from the floor and its
// width from its wall's thickness, unless the row sets its own (typed in its row, or pushed by an
// opening); Reset returns the inherited value; the form shows "Floor default" or "This wall", as
// plaster. The ring beam's underside stays its wall's top less its depth. The example's walls are
// 3 m high and 0.2 m thick; W1 (5 m) runs above the Bedroom.

const yes = { choice: [{ value: 'yes', label: 'y' }], other: [] };

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
  const band = (label, kind) =>
    wall(label).beams.find((beam) => beam.values.wall_beam_band?.choice?.[0]?.value === kind);
  const floorValues = (values) =>
    apply({ type: 'set_values', nodeKey: 'floors', elementId: f.floorId, values });
  const answer = (kind) =>
    apply({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: kind === 'ring' ? 'floor_ring_beam' : `floor_${kind}_band`,
      property: kind === 'ring' ? 'wall_ring_beam' : `wall_${kind}_band`,
      value: yes,
    });
  const edit = (label, kind, change) =>
    apply({
      type: 'update_opening',
      wallId: wall(label).id,
      openingId: band(label, kind).id,
      ...change,
    });
  return { f, session, floor, apply, wall, band, floorValues, answer, edit };
}
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));
const size = (row) => [row.underside, row.depth, row.width, row.ownValues || []];

test("a band row's own values stay when the floor's change; Reset returns the floor's", () => {
  const t = example();
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.2, floor_lintel_band_depth: 0.25 })
  );
  applied(t.answer('lintel'));
  applied(t.edit('W1', 'lintel', { underside: 2.4, width: 0.15 }));
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2.3 }));
  assert.deepEqual(size(t.band('W1', 'lintel')), [2.4, 0.25, 0.15, ['underside', 'width']]);
  assert.deepEqual(size(t.band('W2', 'lintel')), [2.3, 0.25, 0.2, []]);
  applied(t.edit('W1', 'lintel', { reset: ['underside'] }));
  assert.deepEqual(size(t.band('W1', 'lintel')), [2.3, 0.25, 0.15, ['width']]);
  // The record keeps what the row sets itself.
  const record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const back = createBuildingPlanRecordSession({ meta: t.f.meta, record }).getSnapshot();
  const w1 = back.floors[0].walls.find((wall) => wall.autoLabel === 'W1');
  assert.deepEqual(w1.beams[0].ownValues, ['width']);
});

test("the ring beam's depth may be its own; its underside stays the wall's top less it", () => {
  const t = example();
  applied(t.answer('ring'));
  applied(t.edit('W1', 'ring', { depth: 0.4 }));
  assert.deepEqual(size(t.band('W1', 'ring')), [2.6, 0.4, 0.2, ['depth']]);
  const result = t.edit('W1', 'ring', { underside: 2 });
  assert.equal(result.status, 'conflict');
  assert.equal(
    result.issues[0].message,
    "The ring beam's top is its wall's top: change its depth instead."
  );
});

test('an opening rising into a lintel band pushes it up as its own height', () => {
  const t = example();
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.2, floor_lintel_band_depth: 0.2 })
  );
  applied(t.answer('lintel'));
  const w1 = t.wall('W1').id;
  applied(
    t.apply({
      type: 'create_opening',
      wallId: w1,
      kind: 'window',
      offset: 1.9,
      width: 1.2,
      height: 1.2,
      sillHeight: 0.9,
      values: {},
    })
  );
  const window = t.wall('W1').windows[0].id;
  applied(t.apply({ type: 'update_opening', wallId: w1, openingId: window, height: 1.5 }));
  assert.deepEqual(size(t.band('W1', 'lintel')), [2.4, 0.2, 0.2, ['underside']]);
  assert.equal(t.band('W2', 'lintel').underside, 2.2);
});

/** The first row of a node, walking the record. */
function firstPath(record, key) {
  const walk = (row, path) => {
    for (const [name, rows] of Object.entries(row.repeatable || {}))
      for (const child of rows) {
        const here = [...path, { key: name, id: child.id }];
        if (name === key) return here;
        const found = walk(child, here);
        if (found) return found;
      }
    return null;
  };
  return walk(record, []);
}
const rowAt = (record, path) =>
  path.reduce(
    (row, part) => row.repeatable[part.key].find((entry) => entry.id === part.id),
    record
  );

test('the form shows where a band value comes from, and Reset returns it', async () => {
  const t = example();
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.2, floor_lintel_band_depth: 0.25 })
  );
  applied(t.answer('lintel'));
  const meta = t.f.meta;
  const editor = createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    record: writeBuildingPlanRecord({ meta, plan: t.session.getSnapshot() }),
  });
  const node = meta.repeatablesByNodeKey.face_beams;
  const name = (field) => node.fieldsByOriginalDataName[field].dataName;
  const path = firstPath(editor.getRecord(), node.preferredKey);
  const source = (field) => editor.fieldState(path, name(field))?.source;
  assert.deepEqual(source('wall_beam_distance_from_floor'), { scope: 'floor', mode: 'inherit' });
  assert.deepEqual(source('wall_beam_width'), { scope: 'physical_wall', mode: 'inherit' });
  assert.equal(editor.fieldState(path, name('wall_beam_depth')).untagged, true);
  const save = async (change, reset = null) => {
    const row = rowAt(editor.getRecord(), path);
    const scopeId = `edit-${Math.random()}`;
    editor.openRow({ path, scopeId });
    const pending = reset
      ? editor.updateRow(scopeId, row, { resetProperties: [name(reset)] })
      : editor.completeRow(
          scopeId,
          { ...row, values: { ...row.values, ...change } },
          {
            finishAll: true,
          }
        );
    const result = await settleBuildingPlanQuestions(editor, pending, async () => ({
      value: 'candidate:0',
    }));
    applied(result);
    assert.equal(editor.acceptRow(scopeId).status, 'accepted');
  };
  await save({ [name('wall_beam_distance_from_floor')]: 2.35 });
  assert.deepEqual(source('wall_beam_distance_from_floor'), { scope: 'floor', mode: 'override' });
  assert.equal(rowAt(editor.getRecord(), path).values[name('wall_beam_distance_from_floor')], 2.35);
  await save(null, 'wall_beam_distance_from_floor');
  assert.deepEqual(source('wall_beam_distance_from_floor'), { scope: 'floor', mode: 'inherit' });
  assert.equal(rowAt(editor.getRecord(), path).values[name('wall_beam_distance_from_floor')], 2.2);
});
