import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingPlanCanvasController, writeBuildingPlanRecord } from '../src/index.js';
import { buildingPlanFrontView } from '../src/building-plan/front-view.js';
import { sideParts } from '../src/building-plan/front-view-strip.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';
import { applied, example } from './helpers/building-plan-bands.js';

// A1 (decided 2026-11-25): the front view of one wall row, display only, in metres from the
// side's left end as seen from inside the room (a free wall: from its row's side), the lengths its
// fields count (WB3). The example's Bedroom is 0..5 × 0..3 m: W1 along the top, W3 (x 5..3, the
// Shared door 0.5 m in from x 5) and W3.2 (x 3..0) along the bottom; Room 2's top is W3 then W3.1.
// The floor's bands at their defaults: ring 2.70 + 0.30, lintel 2.10 + 0.15, sill 0.75 + 0.15 (the
// depths until typed, 150 mm for lintel and sill since 2026-11-26).

const faceOf = (t, label, roomIndex = 0) =>
  t.floor().rooms[roomIndex].faces.find((face) => face.wallId === t.wall(label).id).id;
const view = (t, label, roomIndex = 0) =>
  buildingPlanFrontView(t.floor(), faceOf(t, label, roomIndex));
const bands = (t) => {
  for (const kind of ['ring', 'lintel', 'sill']) applied(t.answer(kind));
};
const window = (t, label, offset, sillHeight, height) =>
  applied(t.window(label, offset, sillHeight, height, `${label} window`));
const pieces = (v) =>
  v.pieces.map((piece) => [piece.label, piece.from, piece.to, piece.shown, piece.drawnHeight]);
const beams = (v) =>
  v.beams.map((beam) => [beam.band, beam.from, beam.to, beam.bottom, beam.top]).sort();

test("W1 from the Bedroom: its bands, a window between them, the shown wall's levels", () => {
  const t = example();
  bands(t);
  window(t, 'W1', 1.9, 0.9, 1.2);
  const v = view(t, 'W1');
  assert.equal(v.roomId, t.floor().rooms[0].id);
  assert.equal(v.faceId, faceOf(t, 'W1'));
  assert.equal(v.freeWall, false);
  assert.equal(v.length, 5);
  assert.deepEqual(v.folds, []);
  assert.deepEqual(pieces(v), [['W1', 0, 5, true, 3]]);
  assert.equal(v.pieces[0].height, 3);
  assert.deepEqual(
    v.openings.map((o) => [o.kind, o.name, o.faceId, o.from, o.to, o.bottom, o.top]),
    [['window', 'W1 window', faceOf(t, 'W1'), 1.9, 2.9, 0.9, 2.1]]
  );
  assert.deepEqual(beams(v), [
    ['lintel', 0, 5, 2.1, 2.25],
    ['ring', 0, 5, 2.7, 3],
    ['sill', 0, 5, 0.75, 0.9],
  ]);
  // The floor, each band's underside and top, the window's sill and head (shared), the top.
  assert.deepEqual(v.levels, [0, 0.75, 0.9, 2.1, 2.25, 2.7, 3]);
  assert.deepEqual(v.problems, []);
  assert.deepEqual(v.fit, { length: 5, height: 3 });
});

test('a side of two rows is drawn whole, the shown row marked; the Shared door from each room', () => {
  const t = example();
  const w32 = view(t, 'W3.2');
  assert.equal(w32.length, 5);
  assert.deepEqual(pieces(w32), [
    ['W3', 0, 2, false, 3],
    ['W3.2', 2, 5, true, 3],
  ]);
  // The door is W3's: listed with its row, 0.5 m from W3's left end as the Bedroom's entry says.
  assert.deepEqual(
    w32.openings.map((o) => [o.kind, o.faceId, o.from, o.to, o.bottom, o.top]),
    [['door', faceOf(t, 'W3'), 0.5, 1.4, 0, 2]]
  );
  assert.deepEqual(w32.levels, [0, 3], "only the shown row's levels");
  const w3 = view(t, 'W3');
  assert.deepEqual(pieces(w3), [
    ['W3', 0, 2, true, 3],
    ['W3.2', 2, 5, false, 3],
  ]);
  assert.deepEqual(w3.levels, [0, 2, 3], "the door's head; a door has no sill level");
  // Room 2 sees W3 from its own left end: the door 0.6 m in, as Room 2's entry says.
  const other = view(t, 'W3', 1);
  assert.deepEqual(pieces(other), [
    ['W3', 0, 2, true, 3],
    ['W3.1', 2, 5, false, 3],
  ]);
  assert.deepEqual(
    other.openings.map((o) => [o.from, o.to]),
    [[0.6, 1.5]]
  );
});

test("a free wall from its row's side: its own length, its bands and window", () => {
  const t = example();
  bands(t);
  const room = t.floor().rooms[0];
  applied(
    t.apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: newFreeWallFace(
        [
          { x: 1, y: 1.5 },
          { x: 3, y: 1.5 },
        ],
        newFreeWallWidth(t.floor(), room.id, t.f.meta.properties)
      ),
      values: {},
    })
  );
  const free = t.floor().rooms[0].faces.find((face) => face.freePath);
  const label = t.floor().walls.find((wall) => wall.id === free.wallId).autoLabel;
  window(t, label, 0.5, 0.9, 1.2);
  const v = buildingPlanFrontView(t.floor(), free.id);
  assert.equal(v.freeWall, true);
  assert.equal(v.length, 2);
  assert.deepEqual(pieces(v), [[label, 0, 2, true, 3]]);
  assert.deepEqual(
    v.openings.map((o) => [o.from, o.to]),
    [[0.5, 1.5]]
  );
  assert.deepEqual(beams(v), [
    ['lintel', 0, 2, 2.1, 2.25],
    ['ring', 0, 2, 2.7, 3],
    ['sill', 0, 2, 0.75, 0.9],
  ]);
  assert.deepEqual(v.fit, { length: 5, height: 3 }, 'the room fits as before');
});

test("walls of unknown height: drawn to the room's highest level + 0.5 m, no top, no ring beam", () => {
  const t = example();
  bands(t);
  applied(t.floorValues({ floor_height: null }));
  const w4 = view(t, 'W4');
  assert.equal(w4.pieces[0].height, null);
  // The lintel band's top, 2.25, is the Bedroom's highest level.
  assert.equal(w4.pieces[0].drawnHeight, 2.75);
  assert.deepEqual(beams(w4), [
    ['lintel', 0, 3, 2.1, 2.25],
    ['sill', 0, 3, 0.75, 0.9],
  ]);
  assert.deepEqual(w4.levels, [0, 0.75, 0.9, 2.1, 2.25], 'no top level');
  assert.deepEqual(w4.fit, { length: 5, height: 2.75 });
  // W1's lintel band raised: every unknown wall of the room is drawn to the new highest level.
  applied(t.edit('W1', 'lintel', { underside: 2.45 }));
  for (const label of ['W1', 'W2', 'W3', 'W4'])
    assert.ok(
      view(t, label).pieces.every((piece) => piece.drawnHeight === 3.1),
      label
    );
  assert.equal(view(t, 'W4').fit.height, 3.1);
  // At least 1 m: a room of its own with nothing on its walls.
  const bare = example();
  applied(bare.floorValues({ floor_height: null }));
  applied(
    bare.apply({
      type: 'create_room',
      attach: false,
      rectangle: { x: 10, y: 0, width: 4, height: 3 },
    })
  );
  const lone = buildingPlanFrontView(bare.floor(), bare.floor().rooms.at(-1).faces[0].id);
  assert.equal(lone.pieces[0].drawnHeight, 1);
  assert.deepEqual(lone.levels, [0]);
});

test('a problem is the overlap: the window and the lintel band; a band above its wall', () => {
  const t = example();
  window(t, 'W1', 0.5, 0.9, 1.2);
  applied(t.answer('lintel'));
  applied(t.keep(t.floorValues({ floor_lintel_band_distance_from_floor: 1.9 })));
  const v = view(t, 'W1');
  const [problem] = t.problems();
  assert.equal(problem.code, 'opening_into_band');
  assert.deepEqual(v.problems, [
    {
      id: problem.id,
      code: 'opening_into_band',
      elementIds: problem.elements.map((element) => element.id),
      from: 0.5,
      to: 1.5,
      bottom: 1.9,
      top: 2.05,
    },
  ]);
  // The lintel band above every wall but W1: W2's part above its top, and the room's fit over it.
  const above = example();
  applied(above.answer('lintel'));
  applied(above.edit('W1', 'lintel', { underside: 2.5 }));
  applied(above.floorValues({ floor_lintel_band_distance_from_floor: 3.4 }));
  const w2 = view(above, 'W2');
  assert.deepEqual(
    w2.problems.map((p) => [p.code, p.from, p.to, p.bottom, p.top]),
    [['band_above_wall', 0, 3, 3, 3.55]]
  );
  assert.equal(w2.fit.height, 3.55);
  assert.deepEqual(view(above, 'W1').problems, []);
});

test('a row on two sides is unfolded; an outline wound the other way reads the same', () => {
  // Row r turns the corner at (3, 0); the room lies below the first side, left of the second.
  const side = (start, end, normal, pieces) => ({
    start,
    end,
    normal,
    edgeIds: [],
    pieces: pieces.map(([faceId, from, to]) => ({ faceId, from, to })),
  });
  const p = (x, y) => ({ x, y });
  const other = side(p(3, 1), p(0, 1), p(0, -1), [['x', p(3, 1), p(0, 1)]]);
  const wound = [
    side(p(0, 0), p(3, 0), p(0, 1), [
      ['o', p(0, 0), p(1, 0)],
      ['r', p(1, 0), p(3, 0)],
    ]),
    side(p(3, 0), p(3, 1), p(-1, 0), [['r', p(3, 0), p(3, 1)]]),
    other,
  ];
  const backwards = [
    side(p(3, 1), p(3, 0), p(-1, 0), [['r', p(3, 1), p(3, 0)]]),
    side(p(3, 0), p(0, 0), p(0, 1), [
      ['r', p(3, 0), p(1, 0)],
      ['o', p(1, 0), p(0, 0)],
    ]),
    other,
  ];
  for (const sides of [wound, backwards]) {
    const parts = sideParts(sides, 'r');
    assert.deepEqual(
      parts.map((part) => [part.x0, part.length]),
      [
        [0, 3],
        [3, 1],
      ]
    );
    assert.deepEqual(
      parts.flatMap((part) => part.pieces.map((piece) => [piece.faceId, piece.from, piece.to])),
      [
        ['o', 0, 1],
        ['r', 1, 3],
        ['r', 3, 4],
      ]
    );
  }
  assert.equal(sideParts(wound, 'missing'), null);
});

// The web opens and marks a part by its canvas element (A2, 2026-11-26): `ref`, the snapshot's
// { collection, id, path } for the piece's wall row, the door or window, the wall beam or band.
const withoutRefs = (v) => ({
  ...v,
  pieces: v.pieces.map(({ ref, ...rest }) => rest),
  openings: v.openings.map(({ ref, ...rest }) => rest),
  beams: v.beams.map(({ ref, ...rest }) => rest),
});

test('the canvas controller gives the front view of a wall row, each part with its element', () => {
  const t = example();
  bands(t);
  window(t, 'W3.1', 0.4, 0.9, 1.2);
  let record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const controller = new BuildingPlanCanvasController({
    meta: t.f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
  });
  const floor = controller.session.getSnapshot().floors[0];
  const faceId = floor.rooms[1].faces.find((face) => face.wallId === t.wall('W3').id).id;
  const v = controller.frontView(faceId);
  assert.deepEqual(withoutRefs(v), buildingPlanFrontView(floor, faceId));
  const snapshot = controller.getSnapshot();
  const element = (ref) => snapshot[ref.collection].find((entry) => entry.id === ref.id);
  assert.deepEqual(
    v.pieces.map((piece) => [piece.ref.collection, element(piece.ref).id]),
    v.pieces.map((piece) => ['walls', piece.faceId])
  );
  assert.deepEqual(
    v.openings.map((opening) => opening.ref.collection),
    ['doors', 'windows'],
    'the Shared door and W3.1 window'
  );
  for (const part of [...v.openings, ...v.beams]) {
    const entry = element(part.ref);
    assert.equal(entry.subjectId, part.subjectId);
    assert.equal(entry.wallId, part.faceId);
  }
  assert.ok(v.beams.every((beam) => beam.ref.collection === 'wallBeams'));
  for (const part of [...v.pieces, ...v.openings, ...v.beams])
    assert.deepEqual(part.ref.path, element(part.ref).path);
  assert.equal(controller.frontView('no such row'), null);
  controller.dispose();
});
