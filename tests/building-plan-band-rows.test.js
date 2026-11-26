import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanRecordSession,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Bands unit 2 (decided 2026-11-24, B, option A): a wall answering Yes to a band has one row of
// it in its Beams list, kept by the engine: over the whole wall, as wide as the wall, at the
// floor's underside and depth (live until unit 3), the ring beam at the wall's top. A No removes
// it; removing it sets the answer to No. The example's Bedroom is 0..5 × 0..3, walls 3 m high and
// 0.2 m thick; W1 (5 m) above it; W3 (2 m) shared with Room 2.

const yes = { choice: [{ value: 'yes', label: 'Every wall has a lintel band' }], other: [] };
const no = { choice: [{ value: 'no', label: 'No' }], other: [] };

function example(locale = 'en') {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `c-${++serial}`,
    derivedCommands: true,
    locale,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  const floorValues = (values) =>
    apply({ type: 'set_values', nodeKey: 'floors', elementId: f.floorId, values });
  const floorAnswer = (kind, value) =>
    apply({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: kind === 'ring' ? 'floor_ring_beam' : `floor_${kind}_band`,
      property: kind === 'ring' ? 'wall_ring_beam' : `wall_${kind}_band`,
      value,
    });
  const wallAnswer = (label, property, value, extra = {}) => {
    const target = wall(label);
    const face = floor().rooms[0].faces.find((entry) => entry.wallId === target.id);
    return apply({
      type: 'set_property',
      property,
      value,
      nodeKey: 'walls',
      scope: 'physical_wall',
      wallId: target.id,
      faceId: face.id,
      activeRoomId: floor().rooms[0].id,
      ...extra,
    });
  };
  return { f, session, floor, apply, wall, floorValues, floorAnswer, wallAnswer };
}
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));
const round = (value) => Math.round(value * 1000) / 1000 + 0;
const kindOf = (beam) => beam.values.wall_beam_band?.choice?.[0]?.value ?? null;
/** A wall's beams: name, place along it, underside, depth, width. */
const rows = (wall) =>
  (wall?.beams || []).map((beam) => [
    beam.values.wall_beam_identifier,
    round(beam.offset),
    round(beam.length),
    beam.underside,
    beam.depth,
    beam.width,
  ]);

test("a Yes gives every wall one band row over its whole length, at the floor's values", () => {
  const t = example();
  applied(
    t.apply({
      type: 'create_wall',
      roomId: t.floor().rooms[0].id,
      vertices: [
        { x: 1, y: 1.5 },
        { x: 4, y: 1.5 },
      ],
    })
  );
  applied(
    t.floorValues({ floor_lintel_band_distance_from_floor: 2.2, floor_lintel_band_depth: 0.25 })
  );
  applied(t.floorAnswer('lintel', yes));
  for (const wall of t.floor().walls) {
    const segment = wall.segments[0];
    const length = round(
      Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y)
    );
    assert.deepEqual(rows(wall), [['Lintel band', 0, length, 2.2, 0.25, 0.2]], wall.autoLabel);
  }
  // The floor's values are the rows' (until unit 3); the ring beam's top is its wall's.
  applied(t.floorValues({ floor_lintel_band_distance_from_floor: 2.3 }));
  applied(t.floorValues({ floor_ring_beam_depth: 0.35 }));
  applied(t.floorAnswer('ring', yes));
  assert.deepEqual(rows(t.wall('W1')), [
    ['Lintel band', 0, 5, 2.3, 0.25, 0.2],
    ['Ring beam', 0, 5, 2.65, 0.35, 0.2],
  ]);
  applied(t.wallAnswer('W1', 'wall_height', 3.2));
  assert.equal(t.wall('W1').beams[1].underside, 2.85);
});

// Until the floor's depths are typed (decided 2026-11-26): lintel and sill bands 150 mm deep, the
// sill band's top at a new window's sill (0.9 m); the ring beam, as a beam added by hand, 300 mm.
test("without the floor's depths: lintel and sill bands 150 mm deep, the ring beam 300 mm", () => {
  const t = example();
  for (const kind of ['ring', 'lintel', 'sill']) applied(t.floorAnswer(kind, yes));
  const band = (kind) => t.wall('W1').beams.find((beam) => kindOf(beam) === kind);
  assert.deepEqual([band('ring').underside, band('ring').depth], [2.7, 0.3]);
  assert.deepEqual([band('lintel').underside, band('lintel').depth], [2.1, 0.15]);
  assert.deepEqual([band('sill').underside, band('sill').depth], [0.75, 0.15]);
});

test("a wall's No removes its row, Reset brings it back; removing the row answers No", () => {
  const t = example();
  applied(t.floorAnswer('lintel', yes));
  applied(t.wallAnswer('W1', 'wall_lintel_band', no));
  assert.deepEqual(rows(t.wall('W1')), []);
  assert.equal(rows(t.wall('W3')).length, 1);
  applied(t.wallAnswer('W1', 'wall_lintel_band', null, { reset: true }));
  const [row] = t.wall('W1').beams;
  assert.equal(kindOf(row), 'lintel');
  applied(t.apply({ type: 'remove_opening', wallId: t.wall('W1').id, openingId: row.id }));
  assert.deepEqual(rows(t.wall('W1')), []);
  assert.deepEqual(t.wall('W1').properties.wall_lintel_band.choice[0].value, 'no');
  assert.deepEqual(t.wall('W1').overrides.wall_lintel_band.choice[0].value, 'no');
});

test("a band row's place and size are kept; a beam added by hand sits beside it", () => {
  const t = example();
  applied(t.floorAnswer('lintel', yes));
  const w1 = t.wall('W1');
  const result = t.apply({
    type: 'update_opening',
    wallId: w1.id,
    openingId: w1.beams[0].id,
    offset: 1,
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.issues[0].message, 'The lintel band spans its whole wall.');
  applied(
    t.apply({
      type: 'create_opening',
      kind: 'beam',
      wallId: w1.id,
      offset: 1,
      length: 2,
      width: 0.2,
      depth: 0.3,
      underside: 1.2,
      values: {},
    })
  );
  assert.deepEqual(
    rows(t.wall('W1')).map(([name]) => name),
    ['Lintel band', 'B#1']
  );
});

test("a split's pieces each have their band row; Rejoin makes it one", () => {
  const t = example();
  applied(t.floorAnswer('lintel', yes));
  const north = t.floor().rooms[0].faces.find((face) => face.wallId === t.wall('W1').id).id;
  const cut = t.apply({ type: 'split_face', faceId: north, offset: 2 });
  applied(cut);
  assert.deepEqual(rows(t.wall('W1')), [['Lintel band', 0, 3, 2.1, 0.15, 0.2]]);
  assert.deepEqual(rows(t.wall('W1.1')), [['Lintel band', 0, 2, 2.1, 0.15, 0.2]]);
  applied(t.apply({ type: 'rejoin_cut', cutId: cut.created.id }));
  assert.deepEqual(rows(t.wall('W1')), [['Lintel band', 0, 5, 2.1, 0.15, 0.2]]);
  assert.deepEqual(t.session.validate(), []);
});

test("band rows are named in the editor's language and go through the record", () => {
  const t = example('it');
  applied(t.floorAnswer('lintel', yes));
  assert.equal(t.wall('W1').beams[0].values.wall_beam_identifier, 'Fascia architravi');
  const record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const back = createBuildingPlanRecordSession({ meta: t.f.meta, record }).getSnapshot();
  const w1 = back.floors[0].walls.find((wall) => wall.autoLabel === 'W1');
  assert.deepEqual(w1.beams.map(kindOf), ['lintel']);
  // Each of the Bedroom's wall rows shows its wall's band row, the band kind with it.
  const nodes = t.f.meta.repeatablesByNodeKey;
  const band = nodes.face_beams.fieldsByOriginalDataName.wall_beam_band.dataName;
  const faces =
    record.repeatable[nodes.floors.preferredKey][0].repeatable[nodes.rooms.preferredKey][0]
      .repeatable[nodes.walls.preferredKey];
  for (const face of faces)
    assert.deepEqual(
      (face.repeatable?.[nodes.face_beams.preferredKey] || []).map(
        (row) => row.values[band]?.choice?.[0]?.value
      ),
      ['lintel']
    );
});
