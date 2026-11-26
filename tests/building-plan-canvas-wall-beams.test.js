import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  resolveBuildingPlanRow,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { applied, example } from './helpers/building-plan-bands.js';

// D1a (decided 2026-11-25): the canvas snapshot carries each wall's beams and bands per room face,
// as doors and windows: where they lie along the face, their outline at their width centred on
// the wall's axis (the same from both faces), their heights, band kind and name, and the row an
// entry opens. The example's walls are 20 cm thick; W3 is shared by the Bedroom and Room 2.

const no = { choice: [{ value: 'no', label: 'No' }], other: [] };
const round = (value) => Math.round(value * 1000) / 1000;
const outline = (entry) => entry.points.map((point) => [round(point.x), round(point.y)]);

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
  const view = controller.getSnapshot();
  const faceOf = (label, roomIndex = 0) =>
    view.walls.find(
      (wall) =>
        wall.physicalWallId === t.wall(label).id && wall.roomId === t.floor().rooms[roomIndex].id
    );
  const beamsOf = (face) =>
    face.wallBeams.map((id) => view.wallBeams.find((entry) => entry.id === id));
  return { view, record: () => record, faceOf, beamsOf, gridSize: controller.gridSize };
}

/** A local beam over the Shared door on W3, as a wall's Beams list adds it. */
const beamOverDoor = (t) =>
  t.apply({
    type: 'create_opening',
    kind: 'beam',
    wallId: t.wall('W3').id,
    offset: 0.35,
    length: 1.2,
    depth: 0.25,
    underside: 2,
  });

test("each face lists its wall's bands: along it, on the wall's axis, the row it opens", () => {
  const t = example();
  applied(t.answer('lintel'));
  applied(t.answer('ring'));
  const c = canvas(t);
  const w1 = c.faceOf('W1');
  const [ring, lintel] = ['ring', 'lintel'].map((kind) =>
    c.beamsOf(w1).find((entry) => entry.band === kind)
  );
  assert.deepEqual(
    [lintel.displayLabel, lintel.startRatio, lintel.endRatio, lintel.underside, lintel.depth],
    ['Lintel band', 0, 1, 2.1, 0.15]
  );
  assert.deepEqual([ring.displayLabel, ring.underside], ['Ring beam', 2.7]);
  // As wide as the wall (20 cm), centred on its axis, along its whole length.
  const g = c.gridSize;
  const xs = lintel.points.map((point) => point.x / g);
  const ys = lintel.points.map((point) => point.y / g);
  assert.equal(round(Math.max(...ys) - Math.min(...ys)), 0.2);
  assert.equal(round(Math.max(...xs) - Math.min(...xs)), 5);
  assert.deepEqual(
    lintel.axisPoints.map((point) => round(point.y / g)),
    [round((Math.max(...ys) + Math.min(...ys)) / 2), round((Math.max(...ys) + Math.min(...ys)) / 2)]
  );
  // Its path opens the face's copy of the band row.
  const row = resolveBuildingPlanRow(c.record(), lintel.path);
  const storage = Object.values(row.values).find(
    (value) => typeof value === 'string' && value.includes(t.band('W1', 'lintel').id)
  );
  assert.ok(storage, 'the copy of the lintel band row');
  assert.equal(lintel.subjectId, t.band('W1', 'lintel').id);
});

test('a beam on a shared wall: both rooms list it, counted from their own ends, the same outline', () => {
  const t = example();
  applied(beamOverDoor(t));
  const c = canvas(t);
  const [bedroom] = c.beamsOf(c.faceOf('W3', 0));
  const [room2] = c.beamsOf(c.faceOf('W3', 1));
  assert.equal(bedroom.band, null);
  assert.equal(bedroom.displayLabel, room2.displayLabel);
  assert.match(bedroom.displayLabel, /^B#\d+$/);
  assert.deepEqual([bedroom.startRatio, bedroom.endRatio].map(round), [0.175, 0.775]);
  assert.deepEqual([room2.startRatio, room2.endRatio].map(round), [0.225, 0.825]);
  assert.deepEqual(outline(bedroom), outline(room2));
  assert.deepEqual([bedroom.underside, bedroom.depth], [2, 0.25]);
});

test('every beam shows on each face of its wall, through a Split; a wall answered No has none', () => {
  const t = example();
  applied(t.answer('lintel'));
  applied(beamOverDoor(t));
  const face = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall('W4').id);
  applied(
    t.apply({
      type: 'set_property',
      property: 'wall_lintel_band',
      value: no,
      nodeKey: 'walls',
      scope: 'physical_wall',
      wallId: t.wall('W4').id,
      faceId: face.id,
      activeRoomId: t.floor().rooms[0].id,
    })
  );
  const north = t.floor().rooms[0].faces.find((entry) => entry.wallId === t.wall('W1').id).id;
  applied(t.apply({ type: 'split_face', faceId: north, offset: 2 }));
  const c = canvas(t);
  for (const wall of t.floor().walls) {
    const faces = c.view.walls.filter((entry) => entry.physicalWallId === wall.id);
    for (const beam of wall.beams || []) {
      const entries = faces.flatMap((entry) =>
        c.beamsOf(entry).filter((item) => item.subjectId === beam.id)
      );
      assert.equal(entries.length, faces.length, `${wall.autoLabel} ${beam.id}`);
      for (const entry of entries) assert.deepEqual(outline(entry), outline(entries[0]));
    }
  }
  assert.deepEqual(c.beamsOf(c.faceOf('W4')), []);
  assert.deepEqual(
    ['W1', 'W1.1'].map((label) => c.beamsOf(c.faceOf(label)).map((entry) => entry.band)),
    [['lintel'], ['lintel']]
  );
});
