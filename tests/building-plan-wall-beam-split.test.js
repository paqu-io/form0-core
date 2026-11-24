import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Wall beams 2c (decided 2026-11-24, option b): a Split that crosses no door or window divides
// the wall and every beam across it, as the wall divides (the part on the piece keeping the wall
// keeps the beam; the others are new beams with the same size, height and answers, the next B#);
// Rejoin makes them one again when they meet and match. The example's W1 runs above the Bedroom
// (0..5 × 0..3), from x = 0; its Shared door is on W3.

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
  const beam = (wallId, offset, length, extra = {}) =>
    apply({
      type: 'create_opening',
      kind: 'beam',
      wallId,
      offset,
      length,
      width: 0.2,
      depth: 0.3,
      underside: 2.7,
      values: {},
      ...extra,
    });
  return { f, session, floor, apply, wall, beam };
}
const round = (value) => Math.round(value * 1000) / 1000 + 0;
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));
/** Every wall beam: its wall, name, ends along x (W1 runs along x) and height, sorted. */
const beams = (floor) =>
  floor.walls
    .flatMap((wall) =>
      (wall.beams || []).map((entry) => {
        const segment = wall.segments.find((item) => item.id === entry.segmentId);
        const size = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
        const x = (station) =>
          round(segment.start.x + ((segment.end.x - segment.start.x) * station) / size);
        const ends = [x(entry.offset), x(entry.offset + entry.length)].sort((a, b) => a - b);
        return `${wall.autoLabel} ${entry.values.wall_beam_identifier} ${ends.join('..')} @${entry.underside} ${entry.values.note ?? ''}`.trim();
      })
    )
    .sort();

test('a Split across two beams divides both; Rejoin makes them one again', () => {
  const t = example();
  const w1 = t.wall('W1').id;
  applied(t.beam(w1, 0, 5, { values: { note: 'ring' } }));
  applied(t.beam(w1, 1, 2, { underside: 2.1, depth: 0.25 }));
  const north = t.floor().rooms[0].faces.find((face) => face.wallId === w1).id;
  const cut = t.apply({ type: 'split_face', faceId: north, offset: 2 });
  applied(cut);
  assert.deepEqual(beams(t.floor()), [
    'W1 B#1 2..5 @2.7 ring',
    'W1 B#2 2..3 @2.1',
    'W1.1 B#3 0..2 @2.7 ring',
    'W1.1 B#4 1..2 @2.1',
  ]);
  applied(t.apply({ type: 'rejoin_cut', cutId: cut.created.id }));
  assert.deepEqual(beams(t.floor()), ['W1 B#1 0..5 @2.7 ring', 'W1 B#2 1..3 @2.1']);
  assert.deepEqual(t.session.validate(), []);
});

test('parts that no longer match stay two beams after Rejoin', () => {
  const t = example();
  const w1 = t.wall('W1').id;
  applied(t.beam(w1, 0, 5));
  const north = t.floor().rooms[0].faces.find((face) => face.wallId === w1).id;
  const cut = t.apply({ type: 'split_face', faceId: north, offset: 2 });
  applied(cut);
  const part = t.floor().walls.find((wall) => wall.autoLabel === 'W1.1');
  applied(
    t.apply({
      type: 'update_opening',
      wallId: part.id,
      openingId: part.beams[0].id,
      underside: 2.5,
    })
  );
  applied(t.apply({ type: 'rejoin_cut', cutId: cut.created.id }));
  assert.deepEqual(beams(t.floor()), ['W1 B#1 2..5 @2.7', 'W1 B#2 0..2 @2.5']);
});

test('a free wall split through its beam divides it; Rejoin joins it', () => {
  const t = example();
  const room = t.floor().rooms[0];
  applied(
    t.apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: [
        { x: 1, y: 1.5 },
        { x: 4, y: 1.5 },
      ],
    })
  );
  const face = t.floor().rooms[0].faces.find((entry) => entry.freePath);
  applied(t.beam(face.wallId, 0, 3, { underside: 2.5 }));
  const cut = t.apply({ type: 'split_face', faceId: face.id, offset: 1 });
  applied(cut);
  const free = t.floor().walls.filter((wall) => wall.beams?.length);
  assert.equal(free.length, 2);
  assert.deepEqual(
    free.flatMap((wall) => wall.beams.map((entry) => round(entry.length))).sort(),
    [1, 2]
  );
  applied(t.apply({ type: 'rejoin_cut', cutId: cut.created.id }));
  const after = t.floor().walls.flatMap((wall) => wall.beams || []);
  assert.deepEqual(
    after.map((entry) => [entry.values.wall_beam_identifier, round(entry.length)]),
    [['B#1', 3]]
  );
});

test('a door across the cut still refuses it', () => {
  const t = example();
  const w3 = t.wall('W3').id;
  applied(t.beam(w3, 0, 2, { underside: 2.2 }));
  const result = t.apply({ type: 'split_face', faceId: t.f.faceA, offset: 1 });
  assert.equal(result.status, 'conflict');
  assert.match(result.issues[0].message, /^This cut crosses Shared door\./);
});

test('divided parts store their lengths without float noise', () => {
  const t = example();
  const w1 = t.wall('W1').id;
  applied(t.beam(w1, 0, 5));
  applied(t.beam(w1, 0.3, 2.7));
  const north = t.floor().rooms[0].faces.find((face) => face.wallId === w1).id;
  applied(t.apply({ type: 'split_face', faceId: north, offset: 0.986266301 }));
  const stored = t.floor().walls.flatMap((wall) => wall.beams || []);
  assert.equal(stored.length, 4);
  for (const entry of stored)
    assert.equal(entry.length, Math.round(entry.length * 1e9) / 1e9, String(entry.length));
});
