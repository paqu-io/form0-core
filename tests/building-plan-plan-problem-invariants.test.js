import test from 'node:test';
import assert from 'node:assert/strict';
import { applied, example } from './helpers/building-plan-bands.js';

// Bands unit 4a (decided 2026-11-25): the floor's problems checked as invariants over plans with
// bands, through edits that move no height (a wall moved, a Split and its Rejoin): each problem
// names elements that are on its wall and segment, bands by their band rows; ids are unique; the
// defaults (bands touching openings of today's default heights) make none; a wall moved keeps
// the same problems, a Split and Rejoin give the same ones back.

const plans = {
  'no bands': () => {},
  'every band at its defaults, a window of the default heights': (t) => {
    for (const kind of ['ring', 'lintel', 'sill']) applied(t.answer(kind));
    applied(t.window('W1', 0.5, 0.9, 1.2, 'Window 1'));
  },
  'the lintel band into the Shared door': (t) => {
    applied(t.answer('lintel'));
    applied(t.keep(t.floorValues({ floor_lintel_band_distance_from_floor: 1.9 })));
  },
  'the lintel band into the ring beam, the sill band into a window': (t) => {
    for (const kind of ['ring', 'lintel', 'sill']) applied(t.answer(kind));
    applied(t.window('W1', 0.5, 0.9, 1.2, 'Window 1'));
    applied(
      t.keep(
        t.floorValues({
          floor_lintel_band_distance_from_floor: 2.6,
          floor_lintel_band_depth: 0.25,
          floor_sill_band_distance_from_floor: 0.8,
          floor_sill_band_depth: 0.2,
        })
      )
    );
  },
  'the lintel band above every wall, one row of its own': (t) => {
    applied(t.answer('lintel'));
    applied(t.edit('W1', 'lintel', { underside: 2.5 }));
    applied(t.floorValues({ floor_lintel_band_distance_from_floor: 3.4 }));
  },
};

const NONE = new Set(['no bands', 'every band at its defaults, a window of the default heights']);

/** Every problem names what is there: its elements on its wall and segment, bands as band rows. */
function named(t) {
  const problems = t.problems();
  assert.equal(new Set(problems.map((problem) => problem.id)).size, problems.length);
  for (const problem of problems) {
    const wall = t.floor().walls.find((entry) => entry.id === problem.wallId);
    assert.ok(wall, problem.id);
    const children = [...wall.doors, ...wall.windows, ...(wall.beams || [])];
    for (const element of problem.elements) {
      const child = children.find((entry) => entry.id === element.id);
      assert.ok(child, `${problem.id}: ${element.id} on its wall`);
      assert.equal(child.segmentId, problem.segmentId, problem.id);
      if (element.type === 'beam') assert.ok(child.values.wall_beam_band, problem.id);
    }
    assert.equal(problem.elements.filter((element) => element.type !== 'beam').length < 2, true);
  }
}

/** A problem without its wall's or band rows' identities: its code, opening and bands. */
const kinds = (t) =>
  [
    ...new Set(
      t.problems().map((problem) => {
        const opening = problem.elements.find((element) => element.type !== 'beam');
        const bands = problem.elements
          .filter((element) => element.type === 'beam')
          .map((element) => element.name);
        return [problem.code, opening?.id ?? '-', ...bands].join(' ');
      })
    ),
  ].sort();

for (const [name, build] of Object.entries(plans))
  test(`problems hold through a wall moved, Split and Rejoin: ${name}`, () => {
    const t = example();
    build(t);
    named(t);
    if (NONE.has(name)) assert.deepEqual(t.problems(), []);
    else assert.notDeepEqual(t.problems(), []);
    const face = (label) =>
      t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall(label).id);

    const ids = t.problems().map((problem) => problem.id);
    const listed = t.listed();
    const before = kinds(t);
    applied(t.apply({ type: 'resize_face', faceId: face('W2').id, distance: 0.5 }));
    named(t);
    assert.deepEqual(
      t.problems().map((problem) => problem.id),
      ids
    );

    const cut = t.apply({ type: 'split_face', faceId: face('W1').id, offset: 2 });
    applied(cut);
    named(t);
    assert.deepEqual(kinds(t), before);
    applied(t.apply({ type: 'rejoin_cut', cutId: cut.created.id }));
    named(t);
    assert.deepEqual(t.listed(), listed);
  });
