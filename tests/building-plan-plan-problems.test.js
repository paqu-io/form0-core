import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  getBuildingPlanProblems,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { applied, example } from './helpers/building-plan-bands.js';

// Bands unit 4a (decided 2026-11-25): problems to fix before saving. An opening and a band
// overlapping in height (touching allowed; doors pass through sill bands), two bands overlapping,
// a band beyond its wall: listed for the floor, never refused, except a band row's own value typed
// beyond its wall. The example's walls are 3 m high; the Shared door (2 m) is on W3; W1 (5 m)
// runs above the Bedroom. Band rows by default: the lintel band's underside 2.1, 30 cm deep.

const refusal = (result) => (assert.equal(result.status, 'conflict'), result.issues[0].message);
const everyWall = (t, text) =>
  t
    .floor()
    .walls.map((entry) => `${entry.autoLabel} ${text}`)
    .sort();

test('an opening reaching into a band is a problem; touching or clear of it is not', () => {
  const t = example();
  applied(t.answer('lintel'));
  applied(
    t.keep(
      t.floorValues({ floor_lintel_band_distance_from_floor: 1.9, floor_lintel_band_depth: 0.25 })
    )
  );
  assert.deepEqual(t.listed(), ['W3 opening_into_band Shared door + Lintel band']);
  assert.equal(t.problems()[0].message, 'Shared door runs into Lintel band.');
  // Touching the door's head (2 m): fine.
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2 }));
  assert.deepEqual(t.listed(), []);
  // A window up to 2.1 m: into the lintel band; a high window over it and a vent under the sill
  // band aren't.
  applied(t.window('W1', 0.5, 0.9, 1.2, 'Window 1'));
  applied(t.window('W1', 2, 2.35, 0.5, 'High window'));
  applied(t.window('W1', 3.5, 0.2, 0.3, 'Vent'));
  assert.deepEqual(t.listed(), ['W1 opening_into_band Window 1 + Lintel band']);
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2.1 }));
  // The sill band (its top at 0.9 m by default) touches the window's sill; raised to 1 m, it
  // reaches into it. The Shared door passes through it.
  applied(t.answer('sill'));
  assert.deepEqual(t.listed(), []);
  applied(
    t.keep(t.floorValues({ floor_sill_band_distance_from_floor: 0.8, floor_sill_band_depth: 0.2 }))
  );
  assert.deepEqual(t.listed(), ['W1 opening_into_band Window 1 + Sill band']);
});

test('two bands overlapping in height are a problem, a sill band into the ring beam too', () => {
  const t = example();
  applied(t.answer('ring'));
  applied(t.answer('lintel'));
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.45, floor_lintel_band_depth: 0.25 })
  );
  assert.deepEqual(t.listed(), []);
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2.6 }));
  assert.deepEqual(t.listed(), everyWall(t, 'bands_overlap Lintel band + Ring beam'));
  assert.equal(t.problems()[0].message, 'Lintel band runs into Ring beam.');

  const s = example();
  applied(s.answer('ring'));
  applied(s.answer('sill'));
  applied(s.floorValues({ floor_sill_band_distance_from_floor: 2.6, floor_sill_band_depth: 0.2 }));
  assert.deepEqual(s.listed(), everyWall(s, 'bands_overlap Sill band + Ring beam'));
});

test("a band beyond its wall: refused when typed on its row, a problem from the floor's values or a push", () => {
  const t = example();
  applied(t.answer('lintel'));
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 3.4 }));
  assert.deepEqual(t.listed(), everyWall(t, 'band_above_wall Lintel band'));
  assert.equal(t.problems()[0].message, 'Lintel band stands above its wall.');
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2.2 }));
  assert.deepEqual(t.listed(), []);

  assert.equal(
    refusal(t.edit('W1', 'lintel', { underside: 3.5 })),
    'Lintel band would stand above its wall.'
  );
  assert.equal(
    refusal(t.edit('W1', 'lintel', { underside: -1 })),
    'Lintel band would go below the floor.'
  );
  assert.equal(
    refusal(t.edit('W1', 'lintel', { depth: 0.9 })),
    'Lintel band would stand above its wall.'
  );
  applied(t.answer('ring'));
  assert.equal(
    refusal(t.edit('W1', 'ring', { depth: 3.5 })),
    'Ring beam would go below the floor.'
  );
  assert.equal(t.band('W1', 'lintel').underside, 2.2);

  // A window raised into the lintel band pushes it (bands unit 3), past the wall's top here.
  const s = example();
  applied(s.answer('lintel'));
  applied(s.window('W1', 0.5, 0.9, 1.2, 'Window 1'));
  applied(
    s.apply({
      type: 'update_opening',
      wallId: s.wall('W1').id,
      openingId: s.wall('W1').windows[0].id,
      height: 2,
    })
  );
  assert.equal(s.band('W1', 'lintel').underside, 2.9);
  assert.deepEqual(s.listed(), ['W1 band_above_wall Lintel band']);
});

/** The canvas snapshot of the session's plan, as the plan page builds it. */
function canvas(t) {
  let record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  return new BuildingPlanCanvasController({
    meta: t.f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
  }).getSnapshot();
}

test("the canvas snapshot lists the floor's problems with the rows that show them", () => {
  const t = example();
  applied(t.answer('lintel'));
  applied(t.keep(t.floorValues({ floor_lintel_band_distance_from_floor: 1.9 })));
  const snapshot = canvas(t);
  assert.equal(snapshot.problems.length, 1);
  const [door] = snapshot.problems;
  // Selected: the lintel band, in both rooms' W3 rows (D1c); marked at the Shared door.
  const copies = snapshot.doors.filter((entry) => entry.subjectId === door.elements[0].id);
  const bands = snapshot.wallBeams.filter((entry) => entry.subjectId === door.elements[1].id);
  assert.deepEqual([copies.length, bands.length], [2, 2]);
  assert.deepEqual(
    door.paths,
    bands.map((entry) => entry.path)
  );
  assert.deepEqual(
    door.markPaths,
    copies.map((entry) => entry.path)
  );

  // A band of its own: selected and marked on the band.
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 3.4 }));
  const next = canvas(t);
  const w1 = t.wall('W1').id;
  const own = next.problems.find((problem) => problem.wallId === w1);
  const rows = next.wallBeams.filter((entry) => entry.subjectId === t.band('W1', 'lintel').id);
  assert.equal(rows.length, 1);
  assert.deepEqual([own.paths, own.markPaths], [[rows[0].path], [rows[0].path]]);
  assert.equal(own.wallName, 'W1');

  // From an editor's plan and record, as the floor entry reads them: the same rows.
  const record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const plan = t.session.getSnapshot();
  assert.deepEqual(
    getBuildingPlanProblems(plan, t.f.floorId, { meta: t.f.meta, record }),
    next.problems
  );
  assert.equal(getBuildingPlanProblems(plan, t.f.floorId)[0].paths, undefined);
  assert.deepEqual(getBuildingPlanProblems(plan, 'gone'), []);
});

test('two bands overlapping: the lower one, named first, is selected', () => {
  const t = example();
  applied(t.answer('ring'));
  applied(t.answer('lintel'));
  applied(t.keep(t.floorValues({ floor_lintel_band_distance_from_floor: 2.6 })));
  const snapshot = canvas(t);
  const w1 = t.wall('W1').id;
  const overlap = snapshot.problems.find(
    (problem) => problem.wallId === w1 && problem.code === 'bands_overlap'
  );
  assert.deepEqual(
    overlap.elements.map((element) => element.name),
    ['Lintel band', 'Ring beam']
  );
  const lintel = snapshot.wallBeams.find((entry) => entry.subjectId === t.band('W1', 'lintel').id);
  assert.deepEqual(overlap.paths, [lintel.path]);
});
