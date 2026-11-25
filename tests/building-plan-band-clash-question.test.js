import test from 'node:test';
import assert from 'node:assert/strict';
import { applied, example } from './helpers/building-plan-bands.js';

// Bands unit 4b (decided 2026-11-25): a band edit that runs bands into openings asks first: fit
// the openings (a head down to the band's underside, a window's sill up to the sill band's top),
// keep them (problems to fix, 4a) or cancel. Clashes already there, opening edits and other
// problems don't ask. The example's walls are 3 m high; the Shared door (2 m) is on W3.

const pending = (result) => {
  assert.equal(result.status, 'pending', JSON.stringify(result.issues));
  return result.uiOperations[0].params;
};
const answer = (t, result, value) =>
  t.session.resolveUIRequest(pending(result).requestId, { value });
const door = (t) => t.wall('W3').doors[0];
const window1 = (t) => t.wall('W1').windows[0];
const heights = (opening) => [opening.sillHeight ?? null, opening.height];

function withLintel() {
  const t = example();
  applied(t.answer('lintel'));
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.1, floor_lintel_band_depth: 0.25 })
  );
  return t;
}
const lowerLintel = (t, value) => t.floorValues({ floor_lintel_band_distance_from_floor: value });

test('the floor lowering its lintel band into a door asks; Fit lowers the door, one Undo', () => {
  const t = withLintel();
  const result = lowerLintel(t, 1.9);
  assert.deepEqual(pending(result).title, 'Openings in the way');
  assert.equal(
    pending(result).message,
    'This edit runs Lintel band into 1 opening: Shared door (W3).'
  );
  assert.deepEqual(
    pending(result).buttons.map((button) => button.id),
    ['fit', 'keep', 'cancel']
  );
  applied(answer(t, result, 'fit'));
  assert.equal(door(t).height, 1.9);
  assert.equal(t.band('W3', 'lintel').underside, 1.9);
  assert.deepEqual(t.listed(), []);
  assert.equal(t.session.undo().status, 'undone');
  assert.equal(door(t).height, 2);
  assert.equal(t.band('W3', 'lintel').underside, 2.1);
});

test('Keep applies the edit and leaves the problem; Cancel changes nothing', () => {
  const t = withLintel();
  applied(answer(t, lowerLintel(t, 1.9), 'keep'));
  assert.equal(door(t).height, 2);
  assert.deepEqual(t.listed(), ['W3 opening_into_band Shared door + Lintel band']);
  // Already there: a deeper band, or a Split of the wall away from the door, doesn't ask again.
  applied(t.floorValues({ floor_lintel_band_depth: 0.3 }));
  const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall('W3').id);
  applied(t.apply({ type: 'split_face', faceId: face.id, offset: 0.2 }));

  const s = withLintel();
  const cancelled = answer(s, lowerLintel(s, 1.9), 'cancel');
  assert.equal(cancelled.status, 'unchanged');
  assert.equal(s.band('W3', 'lintel').underside, 2.1);
  assert.equal(door(s).height, 2);
});

test('opening edits never ask: one raised into the lintel band pushes it, into the ring beam is a problem', () => {
  const t = withLintel();
  applied(t.window('W1', 0.5, 0.9, 1.2, 'Window 1'));
  applied(
    t.apply({
      type: 'update_opening',
      wallId: t.wall('W1').id,
      openingId: window1(t).id,
      height: 1.4,
    })
  );
  assert.equal(t.band('W1', 'lintel').underside, 2.3);
  applied(t.answer('ring'));
  applied(
    t.apply({
      type: 'update_opening',
      wallId: t.wall('W1').id,
      openingId: window1(t).id,
      height: 1.9,
    })
  );
  assert.ok(t.listed().includes('W1 opening_into_band Window 1 + Ring beam'));
});

test('a sill band raised into a window: Fit raises the sill, the head staying', () => {
  const t = example();
  applied(t.window('W1', 0.5, 0.9, 1.2, 'Window 1'));
  applied(t.answer('sill'));
  applied(t.floorValues({ floor_sill_band_distance_from_floor: 0.7, floor_sill_band_depth: 0.2 }));
  const result = t.floorValues({ floor_sill_band_distance_from_floor: 0.8 });
  assert.equal(pending(result).message, 'This edit runs Sill band into 1 opening: Window 1 (W1).');
  applied(answer(t, result, 'fit'));
  assert.deepEqual(heights(window1(t)), [1, 1.1]);
  // The Shared door passes through the sill band.
  assert.equal(door(t).height, 2);
});

test('a wall lowered brings its ring beam into a window: asks; Fit lowers the head', () => {
  const t = example();
  applied(t.window('W1', 0.5, 0.9, 1.6, 'Window 1'));
  applied(t.answer('ring'));
  const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall('W1').id);
  const result = t.apply({
    type: 'set_property',
    property: 'wall_height',
    value: 2.6,
    nodeKey: 'walls',
    scope: 'physical_wall',
    wallId: t.wall('W1').id,
    faceId: face.id,
    activeRoomId: t.floor().rooms[0].id,
  });
  assert.equal(pending(result).message, 'This edit runs Ring beam into 1 opening: Window 1 (W1).');
  applied(answer(t, result, 'fit'));
  assert.deepEqual(heights(window1(t)), [0.9, 1.4]);
});

test('an opening that would keep no height is named and left as it is', () => {
  const t = withLintel();
  applied(t.window('W1', 0.5, 0.9, 1.2, 'Window 1'));
  // A lintel band from 0.8 to 1.05 m: the window's head would come below its sill.
  const result = lowerLintel(t, 0.8);
  assert.equal(
    pending(result).message,
    'This edit runs Lintel band into 2 openings: Window 1 (W1) and Shared door (W3). Window 1 (W1) would keep no height: fitting leaves it as it is.'
  );
  applied(answer(t, result, 'fit'));
  assert.deepEqual(heights(window1(t)), [0.9, 1.2]);
  assert.equal(door(t).height, 0.8);
  assert.deepEqual(t.listed(), ['W1 opening_into_band Window 1 + Lintel band']);
});
