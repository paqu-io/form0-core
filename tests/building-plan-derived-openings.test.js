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
    createId: () => `o-${++serial}`,
    derivedCommands: derived,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  return { f, session, floor, apply, wall };
}

/** Every opening: its ends on the plan (rounded to 1 mm), size and answers. */
function openings(floor) {
  return floor.walls
    .flatMap((wall) =>
      [...wall.doors, ...wall.windows].map((opening) => {
        const { start, end } = wall.segments.find((s) => s.id === opening.segmentId);
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        const at = (d) =>
          `${round(start.x + ((end.x - start.x) * d) / length)},${round(start.y + ((end.y - start.y) * d) / length)}`;
        const ends = [at(opening.offset), at(opening.offset + opening.width)].sort();
        const values = { ...opening.values };
        delete values[`${opening.type}_offset_m`];
        return JSON.stringify([
          opening.id,
          opening.type,
          ends,
          opening.width,
          opening.height,
          opening.sillHeight,
          values,
        ]);
      })
    )
    .sort();
}

/** The same steps on both engines: statuses, refusal codes and openings must match each time. */
function bothEngines(steps) {
  const [now, derived] = [example(false), example(true)];
  for (const step of steps) {
    const [a, b] = [now, derived].map((t) => step(t));
    assert.equal(b.status, a.status, JSON.stringify(b.issues));
    assert.equal(b.issues?.[0]?.code, a.issues?.[0]?.code);
    assert.deepEqual(openings(derived.floor()), openings(now.floor()));
  }
  assert.deepEqual(derived.session.validate(), []);
  return { now, derived };
}

const window = (t, extra = {}) => ({
  type: 'create_opening',
  id: 'window-1',
  wallId: t.wall('W1').id,
  kind: 'window',
  offset: 1,
  width: 1.2,
  height: 1.2,
  sillHeight: 0.9,
  values: {},
  ...extra,
});
const update = (t, extra) =>
  t.apply({ type: 'update_opening', wallId: t.wall('W1').id, openingId: 'window-1', ...extra });

test('opening operations, and batches of data operations, run on the derived core', () => {
  for (const type of ['create_opening', 'update_opening', 'remove_opening'])
    assert.ok(usesDerivedPath({ type }), type);
  const opening = { type: 'update_opening', openingId: 'door', offset: 1 };
  const property = { type: 'set_property', property: 'material', value: 'Wood' };
  assert.ok(usesDerivedPath({ type: 'batch', operations: [property, opening] }));
  assert.ok(!usesDerivedPath({ type: 'batch', operations: [opening, { type: 'set_values' }] }));
});

test('a window is created, moved, resized, answered and removed as today', () => {
  const { derived } = bothEngines([
    (t) => t.apply(window(t)),
    (t) => update(t, { offset: 2.5 }),
    (t) => update(t, { width: 0.8, height: 1.4 }),
    (t) => update(t, { values: { window_label: 'East' } }),
    (t) => t.apply({ type: 'remove_opening', wallId: t.wall('W1').id, openingId: 'window-1' }),
  ]);
  assert.equal(derived.wall('W1').windows.length, 0);
});

test('an opening that does not fit its wall, or its height, refuses as today', () => {
  bothEngines([
    (t) => t.apply(window(t)),
    (t) => update(t, { offset: 4.5 }),
    (t) => update(t, { offset: -0.1 }),
    (t) => update(t, { height: 2.5 }),
    (t) => t.apply(window(t, { id: 'window-2', offset: 4.6, width: 1 })),
  ]);
});

test('the shared door keeps its place along the wall when the wall thickens', () => {
  bothEngines([
    (t) =>
      t.apply({
        type: 'set_property',
        wallId: t.f.wallId,
        property: 'wall_thickness_m',
        value: 0.3,
        activeRoomId: t.floor().rooms[0].id,
      }),
    (t) => {
      const door = t.floor().walls.find((wall) => wall.doors.length).doors[0];
      return t.apply({
        type: 'update_opening',
        wallId: t.f.wallId,
        openingId: door.id,
        offset: 0.8,
      });
    },
  ]);
});

test('a door moved across a Split cut refuses as today', () => {
  const { derived } = bothEngines([
    (t) => t.apply({ type: 'split_face', faceId: t.f.faceA, offset: 0.5 }),
    (t) => {
      // The cut (x = 4.5) ends the door's wall: push the door 0.3 m over it.
      const wall = t.floor().walls.find((entry) => entry.doors.length);
      const [door] = wall.doors;
      const { start, end } = wall.segments[0];
      const length = Math.hypot(end.x - start.x, end.y - start.y);
      const offset = round(start.x) === 4.5 ? -0.3 : length - door.width + 0.3;
      return t.apply({ type: 'update_opening', wallId: wall.id, openingId: door.id, offset });
    },
  ]);
  assert.equal(
    derived.session.getSnapshot().floors[0].walls.some((w) => w.doors.length),
    true
  );
});

test('a record-sync batch edits answers and an opening in one command, as today', () => {
  bothEngines([
    (t) => t.apply(window(t)),
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
            type: 'update_opening',
            wallId: t.wall('W1').id,
            openingId: 'window-1',
            offset: 2,
            values: { window_label: 'South' },
          },
        ],
      }),
  ]);
});

test('an edit that cuts through a door asks first; confirmed, the door goes, as today', () => {
  let doorId = null;
  const move = (t, extra = {}) =>
    t.apply({ type: 'move_room', roomId: t.floor().rooms[1].id, delta: { x: 1, y: 0 }, ...extra });
  const { derived } = bothEngines([
    (t) => {
      doorId = t.floor().walls.flatMap((wall) => wall.doors)[0].id;
      return move(t);
    },
    (t) => move(t, { removeOpeningIds: [doorId] }),
  ]);
  assert.equal(derived.floor().walls.flatMap((wall) => wall.doors).length, 0);
});
