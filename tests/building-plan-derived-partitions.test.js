import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { usesDerivedPath } from '../src/building-plan/derive/derived-edit.js';

const round = (value) => Math.round(value * 1000) / 1000 + 0;
const at = (p) => `${round(p.x)},${round(p.y)}`;

/** The example on today's engine or the derived core. */
function example(derived, editingPolicy = {}) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `p-${++serial}`,
    derivedCommands: derived,
    editingPolicy,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const partitions = () => floor().rooms[0].faces.filter((face) => face.freePath);
  return { f, session, floor, apply, partitions };
}

/** Partition walls (label, axis, thickness, openings on the plan) and partition paths. */
function partitionState(floor) {
  const room = floor.rooms[0];
  const faces = room.faces.filter((face) => face.freePath);
  const walls = floor.walls
    .filter((wall) => faces.some((face) => face.wallId === wall.id))
    .map((wall) => {
      const [{ start, end }] = wall.segments;
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const along = (d) => ({
        x: start.x + ((end.x - start.x) * d) / length,
        y: start.y + ((end.y - start.y) * d) / length,
      });
      const openings = [...wall.doors, ...wall.windows].map((o) =>
        [at(along(o.offset)), at(along(o.offset + o.width))].sort().join('>')
      );
      return `${wall.autoLabel} ${[at(start), at(end)].sort().join('>')} t=${wall.properties.wall_thickness_m} ${openings.join(',')}`;
    })
    .sort();
  const paths = faces
    .map((face) => face.freePath.map((p) => `${at(p)}${p.editingCutId ? ':cut' : ''}`).join(' '))
    .sort();
  return { walls, paths };
}

/** The same steps on both engines: statuses, refusal codes and partitions must match each time. */
function bothEngines(steps) {
  const [now, derived] = [example(false), example(true)];
  for (const step of steps) {
    const [a, b] = [now, derived].map((t) => step(t));
    assert.equal(b.status, a.status, JSON.stringify(b.issues));
    assert.equal(b.issues?.[0]?.code, a.issues?.[0]?.code);
    assert.deepEqual(partitionState(derived.floor()), partitionState(now.floor()));
  }
  assert.deepEqual(derived.session.validate(), []);
  return { now, derived };
}

const draw = (t, vertices, extra = {}) =>
  t.apply({ type: 'create_wall', roomId: t.floor().rooms[0].id, vertices, ...extra });
const line = [
  { x: 1, y: 1 },
  { x: 4, y: 1 },
];

test('partition operations run on the derived core', () => {
  for (const type of ['create_wall', 'update_wall', 'remove_face'])
    assert.ok(usesDerivedPath({ type }), type);
});

test('a drawn partition, and a polyline drawn as one wall per straight run, as today', () => {
  const polyline = [
    { x: 1, y: 2 },
    { x: 2.5, y: 2 },
    { x: 2.5, y: 2.8 },
  ];
  bothEngines([
    (t) => draw(t, line, { values: { wall_label: 'Divider' } }),
    (t) => draw(t, polyline),
  ]);
  // A point on a straight run is no boundary: the run stays one row (today keeps two rows of
  // the same wall there).
  const t = example(true);
  draw(t, [polyline[0], { x: 2, y: 2 }, ...polyline.slice(1)]);
  assert.deepEqual(partitionState(t.floor()).paths, ['1,2 2.5,2', '2.5,2 2.5,2.8']);
});

test('a whole partition moves; its door keeps its distance from the start, or the end', () => {
  const door = (t) =>
    t.apply({
      type: 'create_opening',
      id: 'door-p',
      wallId: t.wallId,
      kind: 'door',
      offset: 1,
      width: 0.8,
      height: 2,
    });
  const move = (t, vertices, anchor) =>
    t.apply({
      type: 'update_wall',
      wallId: t.wallId,
      faceId: t.partitions()[0].id,
      vertices,
      ...(anchor ? { anchor } : {}),
    });
  bothEngines([
    (t) => {
      const result = draw(t, line);
      t.wallId = result.created.id;
      return result;
    },
    door,
    (t) =>
      move(t, [
        { x: 1, y: 1.5 },
        { x: 4, y: 1.5 },
      ]),
    (t) =>
      move(t, [
        { x: 0.5, y: 1.5 },
        { x: 4, y: 1.5 },
      ]),
    (t) =>
      move(
        t,
        [
          { x: 0.8, y: 1.5 },
          { x: 4.2, y: 1.5 },
        ],
        'end'
      ),
    (t) => move(t, [{ x: 1, y: 1 }]),
  ]);
});

test('a Split portion moves square with a return at its cut, and back without it, as today', () => {
  const portion = (t) => t.partitions().find((face) => face.freePath[0].editingCutId);
  const move = (t, y) =>
    t.apply({
      type: 'update_wall',
      wallId: portion(t).wallId,
      faceId: portion(t).id,
      vertices: [
        { x: 2, y },
        { x: 4, y },
      ],
    });
  bothEngines([
    (t) => draw(t, line),
    (t) => t.apply({ type: 'split_face', faceId: t.partitions()[0].id, offset: 1 }),
    (t) => move(t, 1.5),
    (t) => move(t, 1.6),
    (t) =>
      t.apply({
        type: 'update_wall',
        wallId: portion(t).wallId,
        faceId: portion(t).id,
        vertices: [
          { x: 2.2, y: 1.8 },
          { x: 4.2, y: 1.8 },
        ],
      }),
    (t) => move(t, 1),
  ]);
});

test('a return holding a door asks before the portion moves back; confirmed, both go', () => {
  const portion = (t) =>
    t.partitions().find((face) => face.freePath[0].editingCutId && !face.lineage?.editingReturn);
  const back = (t, extra = {}) =>
    t.apply({
      type: 'update_wall',
      wallId: portion(t).wallId,
      faceId: portion(t).id,
      vertices: [
        { x: 2, y: 1 },
        { x: 4, y: 1 },
      ],
      ...extra,
    });
  const { derived } = bothEngines([
    (t) => draw(t, line),
    (t) => t.apply({ type: 'split_face', faceId: t.partitions()[0].id, offset: 1 }),
    (t) =>
      t.apply({
        type: 'update_wall',
        wallId: portion(t).wallId,
        faceId: portion(t).id,
        vertices: [
          { x: 2, y: 2 },
          { x: 4, y: 2 },
        ],
      }),
    (t) => {
      const ret = t.partitions().find((face) => face.lineage?.editingReturn);
      return t.apply({
        type: 'create_opening',
        id: 'door-r',
        wallId: ret.wallId,
        kind: 'door',
        offset: 0.1,
        width: 0.7,
        height: 2,
      });
    },
    (t) => back(t),
    (t) => back(t, { removeOpeningIds: ['door-r'] }),
  ]);
  assert.equal(derived.partitions().length, 2);
});

test('removing a partition row removes its wall and openings, as today', () => {
  bothEngines([
    (t) => {
      t.created = draw(t, line);
      return t.created;
    },
    (t) =>
      t.apply({
        type: 'create_opening',
        wallId: t.created.created.id,
        kind: 'door',
        offset: 1,
        width: 0.8,
        height: 2,
      }),
    (t) => t.apply({ type: 'remove_face', faceId: t.created.createdFace.id }),
  ]);
});

test("a room's boundary row cannot be removed on its own (K1, pending)", () => {
  const t = example(true);
  const result = t.apply({ type: 'remove_face', faceId: t.floor().rooms[0].faces[0].id });
  assert.equal(result.issues?.[0]?.code, 'boundary_row_required');
});

test('midline: a thicker partition keeps its axis; a run joined to it stays joined (J5)', () => {
  const t = example(true, { thicknessAnchor: 'midline' });
  const created = draw(t, [
    { x: 1, y: 1 },
    { x: 3, y: 1 },
    { x: 3, y: 2.5 },
  ]);
  const result = t.apply({
    type: 'set_property',
    wallId: created.created.id,
    property: 'wall_thickness_m',
    value: 0.4,
  });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.deepEqual(t.session.validate(), []);
  // Today's engine moves the first run too but leaves the second at (3, 1), apart from it.
  assert.deepEqual(partitionState(t.floor()).paths, ['1,1.1 3,1.1', '3,1.1 3,2.5']);
  assert.ok(
    partitionState(t.floor()).walls.some((wall) => wall.startsWith('W9 1,0.9>3,0.9 t=0.4'))
  );
});
