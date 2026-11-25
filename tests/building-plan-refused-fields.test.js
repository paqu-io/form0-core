import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanEditor, writeBuildingPlanRecord } from '../src/index.js';
import { applied, example } from './helpers/building-plan-bands.js';

// Refused typed values as field errors (decided 2026-11-25): `completeRow` sends every field
// changed since the row opened, so on a refusal core names the fields it refuses, trying each
// alone; when only the combination is refused, every changed field carries it. The example's
// walls are 3 m high; every wall's lintel band at 2.2 m, 25 cm deep.

function lintelRow() {
  const t = example();
  applied(t.answer('lintel'));
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.2, floor_lintel_band_depth: 0.25 })
  );
  const meta = t.f.meta;
  const editor = createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    record: writeBuildingPlanRecord({ meta, plan: t.session.getSnapshot() }),
  });
  const node = meta.repeatablesByNodeKey.face_beams;
  const name = (field) => node.fieldsByOriginalDataName[field].dataName;
  const walk = (row, path) => {
    for (const [key, rows] of Object.entries(row.repeatable || {}))
      for (const child of rows) {
        const here = [...path, { key, id: child.id }];
        if (key === node.preferredKey) return here;
        const found = walk(child, here);
        if (found) return found;
      }
    return null;
  };
  const path = walk(editor.getRecord(), []);
  const scopeId = 'edit-lintel';
  editor.openRow({ path, scopeId });
  const row = path.reduce(
    (current, part) => current.repeatable[part.key].find((entry) => entry.id === part.id),
    editor.getRecord()
  );
  /** Completes the row with these values typed (as a field's blur does). */
  const complete = (typed) => {
    const values = Object.fromEntries(
      Object.entries(typed).map(([field, value]) => [name(field), value])
    );
    const fieldName = name(Object.keys(typed).at(-1));
    return editor.completeRow(
      scopeId,
      { ...row, values: { ...row.values, ...values } },
      { fieldName }
    );
  };
  const refused = (result) =>
    (result.refusedFields || []).map(({ dataName, issues }) => [
      Object.keys(node.fieldsByOriginalDataName).find((field) => name(field) === dataName),
      issues.map((issue) => issue.message),
    ]);
  return { complete, refused };
}

test('a refused typed value names its field', () => {
  const t = lintelRow();
  const result = t.complete({ wall_beam_distance_from_floor: 3.5 });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(t.refused(result), [
    ['wall_beam_distance_from_floor', ['Lintel band would stand above its wall.']],
  ]);
});

test('with other changed fields, only the refused one is named', () => {
  const t = lintelRow();
  // The width is fine; the underside, sent with it, is not.
  const result = t.complete({ wall_beam_distance_from_floor: 3.5, wall_beam_width: 0.15 });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(t.refused(result), [
    ['wall_beam_distance_from_floor', ['Lintel band would stand above its wall.']],
  ]);
});

test('refused only together, every changed field carries the refusal', () => {
  const t = lintelRow();
  // 2.7 with 25 cm and 2.2 with 35 cm fit a 3 m wall; 2.7 with 35 cm doesn't.
  const result = t.complete({ wall_beam_distance_from_floor: 2.7, wall_beam_depth: 0.35 });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(t.refused(result), [
    ['wall_beam_distance_from_floor', ['Lintel band would stand above its wall.']],
    ['wall_beam_depth', ['Lintel band would stand above its wall.']],
  ]);
});

test('an applied edit names none', () => {
  const t = lintelRow();
  const result = t.complete({ wall_beam_distance_from_floor: 2.4 });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.equal(result.refusedFields, undefined);
});
