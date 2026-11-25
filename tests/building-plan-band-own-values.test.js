import test from 'node:test';
import assert from 'node:assert/strict';
import { applied, example } from './helpers/building-plan-bands.js';

// Bands unit 4c (decided 2026-11-25): a band row's values of its own aren't lost unasked. A No
// removing such rows asks (remove them, keep those walls' bands on the floor's No, or cancel); a
// Rejoin of parts whose band rows differ asks which values the rejoined wall keeps. The example's
// walls are 3 m high, 20 cm thick; W1 and W4 face the Bedroom.

const no = { choice: [{ value: 'no', label: 'No' }], other: [] };
const pending = (result) => {
  assert.equal(result.status, 'pending', JSON.stringify(result.issues));
  return result.uiOperations[0].params;
};
const reply = (t, result, value) =>
  t.session.resolveUIRequest(pending(result).requestId, { value });

function withOwnLintel() {
  const t = example();
  applied(t.answer('lintel'));
  applied(t.edit('W1', 'lintel', { underside: 2.6 }));
  return t;
}
const wallNo = (t, label) => {
  const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall(label).id);
  return t.apply({
    type: 'set_property',
    property: 'wall_lintel_band',
    value: no,
    nodeKey: 'walls',
    scope: 'physical_wall',
    wallId: t.wall(label).id,
    faceId: face.id,
    activeRoomId: t.floor().rooms[0].id,
  });
};
const floorNo = (t) =>
  t.apply({
    type: 'set_provider',
    nodeKey: 'floors',
    fieldName: 'floor_lintel_band',
    property: 'wall_lintel_band',
    value: no,
  });
const lintel = (t, label) => {
  const row = t.band(label, 'lintel');
  return row ? [row.underside, row.width, row.ownValues || []] : null;
};

test("a wall's No removing a band with values of its own asks; Remove or Cancel", () => {
  const t = withOwnLintel();
  const result = wallNo(t, 'W1');
  assert.deepEqual(pending(result), {
    ...pending(result),
    title: 'Bands with values of their own',
    message: "W1's Lintel band has values of its own (underside 2.6 m). Remove it?",
  });
  assert.deepEqual(
    pending(result).buttons.map((button) => button.id),
    ['remove', 'cancel']
  );
  assert.equal(reply(t, result, 'cancel').status, 'unchanged');
  assert.deepEqual(lintel(t, 'W1'), [2.6, 0.2, ['underside']]);
  applied(reply(t, wallNo(t, 'W1'), 'remove'));
  assert.equal(lintel(t, 'W1'), null);
  // Without values of its own, a No doesn't ask; removing the row from the list doesn't either.
  applied(wallNo(t, 'W2'));
  const s = withOwnLintel();
  applied(
    s.apply({
      type: 'remove_opening',
      wallId: s.wall('W1').id,
      openingId: s.band('W1', 'lintel').id,
    })
  );
  assert.equal(lintel(s, 'W1'), null);
});

test("the floor's No asks for every wall's own band; keeping them gives those walls their own Yes", () => {
  const t = withOwnLintel();
  applied(t.edit('W4', 'lintel', { width: 0.15 }));
  const result = floorNo(t);
  assert.equal(
    pending(result).message,
    "These bands have values of their own: W1's Lintel band (underside 2.6 m); W4's Lintel band (width 150 mm). Remove them?"
  );
  assert.deepEqual(
    pending(result).buttons.map((button) => button.id),
    ['remove', 'keep-bands', 'cancel']
  );
  applied(reply(t, result, 'keep-bands'));
  assert.deepEqual(lintel(t, 'W1'), [2.6, 0.2, ['underside']]);
  assert.deepEqual(lintel(t, 'W4'), [2.1, 0.15, ['width']]);
  assert.equal(t.wall('W1').overrides.wall_lintel_band.choice[0].value, 'yes');
  assert.equal(lintel(t, 'W2'), null);
  // One Undo: the floor's Yes and every row back.
  assert.equal(t.session.undo().status, 'undone');
  assert.equal(t.wall('W1').overrides?.wall_lintel_band, undefined);
  assert.deepEqual(lintel(t, 'W2'), [2.1, 0.2, []]);

  const s = withOwnLintel();
  applied(reply(s, floorNo(s), 'remove'));
  assert.equal(lintel(s, 'W1'), null);
});

test('a Rejoin of parts whose band rows differ asks which values the wall keeps', () => {
  const rejoin = (choice) => {
    const t = example();
    applied(t.answer('lintel'));
    const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall('W1').id);
    const cut = t.apply({ type: 'split_face', faceId: face.id, offset: 2 });
    applied(cut);
    applied(t.edit('W1.1', 'lintel', { underside: 2.6 }));
    const result = t.apply({ type: 'rejoin_cut', cutId: cut.created.id });
    assert.deepEqual(
      pending(result).buttons.map((button) => button.label),
      ['W1: 2.1 m', 'W1.1: 2.6 m', 'Cancel rejoin']
    );
    assert.equal(
      pending(result).message,
      'W1 and W1.1 have different values for Lintel band underside. Choose the one the rejoined wall keeps; you can still change it on the wall later.'
    );
    applied(reply(t, result, choice));
    assert.equal(t.wall('W1.1'), undefined);
    return lintel(t, 'W1');
  };
  assert.deepEqual(rejoin('candidate:1'), [2.6, 0.2, ['underside']]);
  assert.deepEqual(rejoin('candidate:0'), [2.1, 0.2, []]);

  // Parts that match rejoin without asking.
  const t = example();
  applied(t.answer('lintel'));
  const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall('W1').id);
  const cut = t.apply({ type: 'split_face', faceId: face.id, offset: 2 });
  applied(t.apply({ type: 'rejoin_cut', cutId: cut.created.id }));
});
