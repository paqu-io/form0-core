// Decided 2026-11-16: rows the canvas creates get automatic names, so none starts with an empty
// required name; numbering is per floor after the highest number in use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession } from '../src/index.js';

function floorWithRooms(locale, count = 2) {
  const session = createBuildingPlanSession({ locale });
  const floorId = session.apply({
    type: 'create_floor',
    values: { floor_elevation: 0, floor_height: 3 },
  }).created.id;
  for (let index = 0; index < count; index++)
    session.apply({
      type: 'create_room',
      floorId,
      rectangle: { x: index * 6, y: 0, width: 5, height: 3 },
    });
  return { session, floorId, floor: () => session.getSnapshot().floors[0] };
}
const roomNames = (floor) => floor.rooms.map((room) => room.values.room_name.other[0].label);

test('new rooms are named as Other answers, numbered per floor, in the editor language', () => {
  const english = floorWithRooms('en');
  assert.deepEqual(roomNames(english.floor()), ['Room 1', 'Room 2']);
  assert.deepEqual(english.floor().rooms[0].values.room_name.choice, []);
  assert.deepEqual(roomNames(floorWithRooms('it-IT').floor()), ['Stanza 1', 'Stanza 2']);
  assert.deepEqual(roomNames(floorWithRooms('fr').floor()), ['Pièce 1', 'Pièce 2']);
});

test('numbering continues after the highest number and keeps names a person gave', () => {
  const f = floorWithRooms('en', 3);
  f.session.apply({ type: 'remove_room', floorId: f.floorId, roomId: f.floor().rooms[1].id });
  f.session.apply({
    type: 'create_room',
    floorId: f.floorId,
    rectangle: { x: 30, y: 0, width: 5, height: 3 },
  });
  assert.deepEqual(roomNames(f.floor()), ['Room 1', 'Room 3', 'Room 4']);
  f.session.apply({
    type: 'create_room',
    floorId: f.floorId,
    rectangle: { x: 40, y: 0, width: 5, height: 3 },
    values: { room_name: { choice: [{ value: 'kitchen', label: 'Kitchen' }], other: [] } },
  });
  assert.equal(f.floor().rooms.at(-1).values.room_name.choice[0].value, 'kitchen');
});

test('doors, windows, columns, beams and objects get their automatic names', () => {
  const f = floorWithRooms('en', 1);
  const room = f.floor().rooms[0];
  const wall = f.floor().walls.find((entry) => room.faces.some((face) => face.wallId === entry.id));
  const segmentId = wall.segments[0].id;
  for (const [kind, offset] of [
    ['door', 0.2],
    ['window', 2.5],
    ['door', 3.8],
  ])
    f.session.apply({
      type: 'create_opening',
      floorId: f.floorId,
      wallId: wall.id,
      segmentId,
      kind,
      offset,
      width: kind === 'door' ? 0.8 : 1,
      height: kind === 'door' ? 2 : 1.2,
      sillHeight: kind === 'door' ? null : 0.9,
    });
  for (const [index, collection] of ['columns', 'columns', 'beams', 'objects'].entries())
    f.session.apply({
      type: 'create_element',
      floorId: f.floorId,
      roomId: room.id,
      collection,
      element:
        collection === 'beams'
          ? { start: { x: 1, y: 1 }, end: { x: 4, y: 1 }, width: 0.25, height: 0.4 }
          : { position: { x: 1 + index, y: 2 }, width: 0.3, height: 0.3 },
    });
  const floor = f.floor();
  const opened = floor.walls.find((entry) => entry.id === wall.id);
  assert.deepEqual(
    opened.doors.map((door) => door.values.door_label),
    ['Door 1', 'Door 2']
  );
  assert.deepEqual(
    opened.windows.map((window) => window.values.window_label),
    ['Window 1']
  );
  const [named] = floor.rooms;
  assert.deepEqual(
    named.columns.map((column) => column.values.column_identifier),
    ['C#1', 'C#2']
  );
  assert.equal(named.beams[0].values.beam_identifier, 'B#1');
  assert.equal(named.objects[0].values.object_name, 'Object 1');
});
