import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  createBuildingPlanEditor,
  getBuildingPlanProblems,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { applied, example } from './helpers/building-plan-bands.js';

// Bands unit 5 (decided 2026-11-24, aligned 2026-11-25): a new door or window takes its heights
// from the bands on its segment as they stand there (the wall's own band row, else the floor's):
// a head at the lintel band's underside, a window's sill at the sill band's top; an edge with no
// band keeps today's place (a door 2 m; a window's sill 0.9 m, its head 2.1 m); then 4b's Fit (a
// head never starts inside the ring beam). Plain values. The canvas tool and the Add in a wall's
// Doors and Windows lists both. The example's walls are 3 m high; W1 (5 m), W2 and W4 face the
// Bedroom.

const no = { choice: [{ value: 'no', label: 'No' }], other: [] };
const heights = (opening) => [opening.sillHeight ?? null, opening.height ?? null];

/** The canvas controller on the session's plan, as the hosts run it. */
function canvas(t) {
  let record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const controller = new BuildingPlanCanvasController({
    meta: t.f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
  });
  const stored = (id) =>
    controller.session
      .getSnapshot()
      .floors.flatMap((floor) => floor.walls)
      .flatMap((wall) => [...wall.doors, ...wall.windows])
      .find((opening) => opening.id === id);
  const face = (label) =>
    controller.getSnapshot().walls.find((entry) => entry.physicalWallId === t.wall(label).id);
  /** A door or window placed with the canvas tool (only where and how wide, as the web sends). */
  const add = async (kind, label, startRatio, options = {}) => {
    const created = await controller[kind === 'door' ? 'createDoor' : 'createWindow'](
      face(label).id,
      { segmentIndex: 0, startRatio, width: 0.8, ...options }
    );
    assert.ok(created, `${kind} on ${label}`);
    return created.subjectId;
  };
  const placed = async (...args) => heights(stored(await add(...args)));
  return { controller, stored, add, placed };
}

const setWall = (t, label, property, value) => {
  const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall(label).id);
  return t.apply({
    type: 'set_property',
    property,
    value,
    nodeKey: 'walls',
    scope: 'physical_wall',
    wallId: t.wall(label).id,
    faceId: face.id,
    activeRoomId: t.floor().rooms[0].id,
  });
};

test("the canvas tool: today's heights without bands; the lintel and sill bands' with them", async () => {
  const plain = canvas(example());
  assert.deepEqual(await plain.placed('door', 'W1', 0.1), [null, 2]);
  assert.deepEqual(await plain.placed('window', 'W1', 0.5), [0.9, 1.2]);

  const t = example();
  applied(t.answer('lintel'));
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.2, floor_lintel_band_depth: 0.25 })
  );
  applied(t.keep(t.answer('sill')));
  applied(
    t.keep(t.floorValues({ floor_sill_band_distance_from_floor: 0.75, floor_sill_band_depth: 0.2 }))
  );
  const c = canvas(t);
  // A door passes through the sill band: only its head moves.
  assert.deepEqual(await c.placed('door', 'W1', 0.1), [null, 2.2]);
  assert.deepEqual(await c.placed('window', 'W1', 0.5), [0.95, 1.25]);
});

test("the wall's own band row, not the floor's; a wall answered No keeps today's", async () => {
  const t = example();
  applied(t.answer('lintel'));
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2.3 }));
  applied(t.edit('W1', 'lintel', { underside: 2.6 }));
  applied(setWall(t, 'W4', 'wall_lintel_band', no));
  const c = canvas(t);
  // Only a lintel band: the window's sill stays at 0.9, its head at the band.
  assert.deepEqual(await c.placed('window', 'W1', 0.1), [0.9, 1.7]);
  assert.deepEqual(await c.placed('door', 'W1', 0.6), [null, 2.6]);
  assert.deepEqual(await c.placed('window', 'W2', 0.2), [0.9, 1.4]);
  assert.deepEqual(await c.placed('window', 'W4', 0.2), [0.9, 1.2]);
});

test('a sill band alone keeps the head; the ring beam caps a head on a low wall', async () => {
  const sill = example();
  applied(sill.keep(sill.answer('sill')));
  applied(
    sill.keep(
      sill.floorValues({ floor_sill_band_distance_from_floor: 0.9, floor_sill_band_depth: 0.2 })
    )
  );
  const s = canvas(sill);
  assert.deepEqual(await s.placed('window', 'W1', 0.1), [1.1, 1]);
  assert.deepEqual(await s.placed('door', 'W1', 0.6), [null, 2]);

  // A 2.2 m wall with a ring beam 30 cm deep (its underside 1.9) and no lintel band: 4b's Fit.
  const ring = example();
  applied(ring.answer('ring'));
  applied(ring.keep(setWall(ring, 'W1', 'wall_height', 2.2)));
  const r = canvas(ring);
  assert.deepEqual(await r.placed('door', 'W1', 0.1), [null, 1.9]);
  assert.deepEqual(await r.placed('window', 'W1', 0.6), [0.9, 1]);
  // On a 3 m wall the ring beam is out of the way.
  assert.deepEqual(await r.placed('door', 'W2', 0.2), [null, 2]);
});

test("bands that leave no height: today's heights, listed as a problem", async () => {
  const t = example();
  applied(t.keep(t.answer('sill')));
  applied(
    t.keep(t.floorValues({ floor_sill_band_distance_from_floor: 2, floor_sill_band_depth: 0.3 }))
  );
  const c = canvas(t);
  const id = await c.add('window', 'W1', 0.1);
  assert.deepEqual(heights(c.stored(id)), [0.9, 1.2]);
  const problems = getBuildingPlanProblems(c.controller.session.getSnapshot(), t.f.floorId);
  assert.ok(
    problems.some(
      (problem) => problem.code === 'opening_into_band' && problem.elements[0].id === id
    ),
    JSON.stringify(problems)
  );
});

test('a typed height wins; moving an opening keeps its blank heights blank', async () => {
  const t = example();
  applied(t.answer('lintel'));
  const c = canvas(t);
  assert.deepEqual(
    await c.placed('window', 'W1', 0.1, { height: 1.5, distanceFromFloor: 0.6 }),
    [0.6, 1.5]
  );
  const id = await c.add('window', 'W1', 0.5);
  const wallId = t.wall('W1').id;
  await c.controller.apply({
    type: 'update_opening',
    floorId: c.controller.floorId,
    wallId,
    openingId: id,
    height: null,
    sillHeight: null,
  });
  assert.deepEqual(heights(c.stored(id)), [null, null]);
  const entry = c.controller.getSnapshot().windows.find((window) => window.subjectId === id);
  await c.controller.updateWindow(entry.id, { startRatio: 0.6 });
  assert.equal(c.stored(id).offset, 3);
  assert.deepEqual(heights(c.stored(id)), [null, null]);
});

test("the Add in a wall's Doors and Windows lists takes the same heights", () => {
  const t = example();
  applied(t.answer('lintel'));
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2.3 }));
  applied(t.keep(t.answer('sill')));
  applied(
    t.keep(t.floorValues({ floor_sill_band_distance_from_floor: 0.8, floor_sill_band_depth: 0.2 }))
  );
  const meta = t.f.meta;
  const editor = createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    record: writeBuildingPlanRecord({ meta, plan: t.session.getSnapshot() }),
  });
  const nodes = meta.repeatablesByNodeKey;
  const floor = editor.getRecord().repeatable[nodes.floors.preferredKey][0];
  const bedroom = floor.repeatable[nodes.rooms.preferredKey][0];
  const w1 = bedroom.repeatable[nodes.walls.preferredKey].find(
    (row) => row.values[nodes.walls.fieldsByOriginalDataName.wall_label.dataName] === 'W1'
  );
  const base = [
    { key: nodes.floors.preferredKey, id: floor.id },
    { key: nodes.rooms.preferredKey, id: bedroom.id },
    { key: nodes.walls.preferredKey, id: w1.id },
  ];
  for (const [scopeId, path] of [
    ['floor', base.slice(0, 1)],
    ['room', base.slice(0, 2)],
    ['wall', base],
  ])
    assert.equal(editor.openRow({ path, scopeId }).status, 'opened', scopeId);
  const added = (node, id) => {
    const opened = editor.openRow({
      path: [...base, { key: nodes[node].preferredKey, id }],
      row: { id, values: {}, repeatable: {} },
      scopeId: id,
      parentScopeId: 'wall',
    });
    assert.equal(opened.status, 'opened', JSON.stringify(opened.issues));
    const wall = editor.getSnapshot().floors[0].walls.find((entry) => entry.autoLabel === 'W1');
    const [opening] = node === 'face_doors' ? wall.doors : wall.windows;
    return heights(opening);
  };
  assert.deepEqual(added('face_windows', 'new-window'), [1, 1.3]);
  assert.equal(editor.cancelRow('new-window').status, 'cancelled');
  assert.deepEqual(added('face_doors', 'new-door'), [null, 2.3]);
});
