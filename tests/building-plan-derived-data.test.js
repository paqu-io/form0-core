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
    createId: () => `d-${++serial}`,
    derivedCommands: derived,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  return { f, session, floor, apply, wall };
}

/** Every answer on the floor: floor, rooms with their elements, walls by axis with side answers. */
function answers(floor) {
  const json = (value) => JSON.stringify(value ?? {});
  const lines = [`floor ${json(floor.values)} ${json(floor.overrides)}`];
  for (const room of floor.rooms)
    lines.push(
      `room ${room.id} ${json(room.values)} ${json(room.repeatable)} ${json(room.columns)} ${json(room.beams)} ${json(room.objects)}`
    );
  for (const wall of floor.walls) {
    const [{ start, end }] = wall.segments;
    const axis = [start, end]
      .map((p) => `${round(p.x)},${round(p.y)}`)
      .sort()
      .join('>');
    const sides = wall.sides
      .map((side) => `${json(side.values)}${json(side.repeatable)}`)
      .sort()
      .join('|');
    lines.push(`${wall.autoLabel} ${axis} ${json(wall.values)} ${json(wall.repeatable)} ${sides}`);
  }
  return lines.sort();
}

/** The same steps on both engines: statuses, refusal codes and answers must match each time. */
function bothEngines(steps) {
  const [now, derived] = [example(false), example(true)];
  for (const step of steps) {
    const [a, b] = [now, derived].map((t) => step(t));
    assert.equal(b.status, a.status, JSON.stringify(b.issues));
    assert.equal(b.issues?.[0]?.code, a.issues?.[0]?.code);
    assert.deepEqual(answers(derived.floor()), answers(now.floor()));
  }
  assert.deepEqual(derived.session.validate(), []);
  return { now, derived };
}

const column = {
  type: 'create_element',
  id: 'column-1',
  collection: 'columns',
  element: { position: { x: 1, y: 1 }, width: 0.3, height: 0.3, rotation: 0 },
  values: { column_identifier: 'C1' },
};

test('values, custom rows and room elements run on the derived core, in batches too', () => {
  for (const type of [
    'set_values',
    'set_custom_rows',
    'create_element',
    'update_element',
    'remove_element',
  ])
    assert.ok(usesDerivedPath({ type }), type);
  const record = [
    { type: 'set_property', property: 'material', value: 'Wood' },
    { type: 'set_values', values: { note: 'x' } },
    { type: 'update_element', collection: 'columns', elementId: 'c' },
  ];
  assert.ok(usesDerivedPath({ type: 'batch', operations: record }));
});

test('answers on the floor, a room, a wall and a wall surface, as today', () => {
  bothEngines([
    (t) => t.apply({ type: 'set_values', values: { floor_note: 'Checked' } }),
    (t) =>
      t.apply({
        type: 'set_values',
        nodeKey: 'rooms',
        roomId: t.floor().rooms[0].id,
        elementId: t.floor().rooms[0].id,
        values: { room_name: { choice: [{ value: 'kitchen', label: 'Kitchen' }], other: [] } },
      }),
    (t) =>
      t.apply({ type: 'set_values', wallId: t.wall('W1').id, values: { survey_note: 'Crack' } }),
    (t) =>
      t.apply({
        type: 'set_values',
        faceId: t.floor().rooms[0].faces[0].id,
        scope: 'wall_face',
        values: { finish: 'Painted' },
      }),
  ]);
});

test('custom rows on a wall, as today', () => {
  bothEngines([
    (t) =>
      t.apply({
        type: 'set_custom_rows',
        wallId: t.wall('W2').id,
        repeatable: { inspections: [{ id: 'row-1', values: { comment: 'ok' }, repeatable: {} }] },
      }),
  ]);
});

test('a column is created, updated and removed, as today', () => {
  const update = (t, element) =>
    t.apply({
      type: 'update_element',
      roomId: t.floor().rooms[0].id,
      collection: 'columns',
      elementId: 'column-1',
      element,
    });
  const { derived } = bothEngines([
    (t) => t.apply({ ...column, roomId: t.floor().rooms[0].id }),
    (t) => update(t, { position: { x: 2, y: 1.5 }, values: { column_identifier: 'C2' } }),
    (t) =>
      t.apply({
        type: 'remove_element',
        roomId: t.floor().rooms[0].id,
        collection: 'columns',
        elementId: 'column-1',
      }),
  ]);
  assert.equal(derived.floor().rooms[0].columns.length, 0);
});

test('a record-sync batch with answers, values and an element runs as one command, as today', () => {
  bothEngines([
    (t) => t.apply({ ...column, roomId: t.floor().rooms[0].id }),
    (t) =>
      t.apply({
        type: 'batch',
        operations: [
          {
            floorId: t.f.floorId,
            type: 'set_property',
            wallId: t.wall('W1').id,
            property: 'material',
            value: 'Wood',
          },
          {
            floorId: t.f.floorId,
            type: 'set_values',
            wallId: t.wall('W1').id,
            values: { survey_note: 'Damp' },
          },
          {
            floorId: t.f.floorId,
            type: 'update_element',
            roomId: t.floor().rooms[0].id,
            collection: 'columns',
            elementId: 'column-1',
            element: { width: 0.4 },
          },
        ],
      }),
  ]);
});
