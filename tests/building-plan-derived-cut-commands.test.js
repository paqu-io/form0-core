import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { usesDerivedPath } from '../src/building-plan/derive/derived-edit.js';

const round = (value) => Math.round(value * 1000) / 1000 + 0;

/** The example on today's engine or the derived core. */
function example(derived) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `c-${++serial}`,
    derivedCommands: derived,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  return { f, session, floor, apply };
}

/** Room vertices (cuts marked) and partition paths, rounded to 1 mm. */
const outlines = (floor) =>
  floor.rooms.map((room) => [
    room.vertices.map((v) => `${round(v.x)},${round(v.y)}${v.editingCutId ? ':cut' : ''}`),
    room.faces
      .filter((face) => face.freePath)
      .map((face) => face.freePath.map((v) => `${round(v.x)},${round(v.y)}`)),
  ]);
/** Walls by geometry and exposure (identities and labels left out). */
const walls = (floor) =>
  floor.walls
    .map((wall) => {
      const [s] = wall.segments;
      const ends = [s.start, s.end].map((p) => `${round(p.x)},${round(p.y)}`).sort();
      return `${ends.join('>')}|${wall.exposure}|${wall.properties.wall_thickness}`;
    })
    .sort();

/**
 * Run the same steps on both engines: each step returns the operation result; refusal codes,
 * outlines and walls must match after every step.
 */
function bothEngines(steps) {
  const [now, derived] = [example(false), example(true)];
  for (const step of steps) {
    const [a, b] = [now, derived].map((t) => step(t));
    assert.equal(b.status, a.status, JSON.stringify(b.issues));
    assert.equal(b.issues?.[0]?.code, a.issues?.[0]?.code);
    assert.deepEqual(outlines(derived.floor()), outlines(now.floor()));
    assert.deepEqual(walls(derived.floor()), walls(now.floor()));
  }
  assert.deepEqual(derived.session.validate(), []);
  return { now, derived };
}

const cutOf = (result) => result.created?.id;

test('Split and Rejoin run on the derived core when derivedCommands is on', () => {
  for (const type of ['split_face', 'rejoin_cut']) assert.ok(usesDerivedPath({ type }), type);
});

test('Split on a shared wall cuts both rooms with one cut ID, and Rejoin restores one wall', () => {
  let cut = null;
  const { derived } = bothEngines([
    (t) => {
      const result = t.apply({ type: 'split_face', faceId: t.f.faceA, offset: 1.5 });
      cut = cutOf(result);
      return result;
    },
    (t) => t.apply({ type: 'rejoin_cut', cutId: cut }),
  ]);
  const floor = derived.floor();
  assert.ok(floor.rooms.every((room) => !room.vertices.some((v) => v.editingCutId)));
  assert.equal(floor.walls.length, example(true).floor().walls.length);
});

test('Split refuses across a door and at the ends; at the door edge it is allowed', () => {
  bothEngines([
    ...[1, 0, 5, NaN].map(
      (offset) => (t) => t.apply({ type: 'split_face', faceId: t.f.faceA, offset })
    ),
    (t) => t.apply({ type: 'split_face', faceId: t.f.faceA, offset: 0.5 }),
  ]);
});

test('Split at an automatic boundary makes that station the cut', () => {
  // faceB's row spans B's shared stretch 3..5; offset 2 lands on B's station at x = 5, which
  // faces A's corner: only B carries that boundary.
  const { derived } = bothEngines([
    (t) => t.apply({ type: 'split_face', faceId: t.f.faceB, offset: 2 }),
  ]);
  const cuts = derived.floor().rooms[1].vertices.filter((v) => v.editingCutId);
  assert.deepEqual(
    cuts.map((v) => [round(v.x), round(v.y)]),
    [[5, 3.2]]
  );
});

test('Rejoin refuses differing room-side answers, as today', () => {
  let cut = null;
  bothEngines([
    (t) => {
      const result = t.apply({ type: 'split_face', faceId: t.f.faceA, offset: 1.5 });
      cut = cutOf(result);
      return result;
    },
    (t) => {
      const other = t
        .floor()
        .rooms[0].faces.find(
          (face) => face.lineage?.editingOriginFaceId === t.f.faceA && face.id !== t.f.faceA
        );
      return t.apply({
        type: 'set_values',
        faceId: other.id,
        scope: 'wall_face',
        values: { finish: 'painted' },
      });
    },
    (t) => t.apply({ type: 'rejoin_cut', cutId: cut }),
  ]);
});

test('a partition: Split divides its wall and Rejoin joins it again', () => {
  let cut = null;
  const partition = (t) => t.floor().rooms[0].faces.find((face) => face.freePath);
  bothEngines([
    (t) =>
      t.apply({
        type: 'create_wall',
        roomId: t.floor().rooms[0].id,
        vertices: [
          { x: 1, y: 1 },
          { x: 4, y: 1 },
        ],
      }),
    (t) => {
      const result = t.apply({ type: 'split_face', faceId: partition(t).id, offset: 1 });
      cut = cutOf(result);
      return result;
    },
    (t) => t.apply({ type: 'rejoin_cut', cutId: cut }),
  ]);
});

test('Rejoin gives back the wall the Split divided, even when its piece became shorter (I6)', () => {
  const t = example(true);
  const w1 = () => t.floor().walls.find((wall) => wall.autoLabel === 'W1');
  const original = w1().id;
  const south = t.floor().rooms[0].faces[0].id;
  const cut = cutOf(t.apply({ type: 'split_face', faceId: south, offset: 2 }));
  // The Split point slides along the line to x = 4: W1 keeps 1 m, the new piece has 4 m, so the
  // join rule alone (W7: the longer piece) would keep the new one.
  const room = t.floor().rooms[0];
  const vertex = room.vertices.find((v) => v.editingCutId === cut);
  const moved = t.apply({
    type: 'move_corner',
    roomId: room.id,
    vertexId: vertex.id,
    point: { x: 4, y: 0 },
  });
  assert.equal(moved.status, 'applied', JSON.stringify(moved.issues));
  assert.equal(w1().id, original);
  assert.equal(round(Math.abs(w1().segments[0].end.x - w1().segments[0].start.x)), 1);
  assert.equal(t.apply({ type: 'rejoin_cut', cutId: cut }).status, 'applied');
  assert.equal(w1().id, original);
  assert.equal(t.floor().walls.filter((wall) => /^W1(\.|$)/.test(wall.autoLabel)).length, 1);
  assert.deepEqual(t.session.validate(), []);
});
