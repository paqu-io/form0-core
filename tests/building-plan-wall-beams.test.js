import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanEditor,
  createBuildingPlanSession,
  expandBuildingPlanSchema,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// Wall beams, unit 1 (decided 2026-11-24, WB1 to WB10; form0-react analyses/building-plan-ui.md,
// "Wall beams"): beams stored once on the physical wall, a copy in each room's wall row, carried
// by every edit as its doors and windows are. The example's W3 is shared by the Bedroom (0..5 ×
// 0..3) and Room 2 (3..8 × 3.2..6.2): 2 m, its axis from x = 5 to x = 3, a door at 3.6..4.5;
// walls 3 m high and 20 cm thick.

const round = (value) => Math.round(value * 1000) / 1000 + 0;

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
  return { f, session, floor, apply, wall };
}
const applied = (result) => assert.equal(result.status, 'applied', JSON.stringify(result.issues));
const addBeam = (t, label, offset, length, extra = {}) =>
  t.apply({
    type: 'create_opening',
    kind: 'beam',
    wallId: t.wall(label).id,
    offset,
    length,
    width: 0.2,
    depth: 0.3,
    underside: 2,
    values: {},
    ...extra,
  });
/** Every wall beam's name and ends on the floor, to 1 mm. */
const beamPlaces = (floor) =>
  floor.walls
    .flatMap((wall) =>
      (wall.beams || []).map((beam) => {
        const segment = wall.segments.find((entry) => entry.id === beam.segmentId);
        const size = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
        const at = (station) =>
          ['x', 'y']
            .map((axis) =>
              round(
                segment.start[axis] + ((segment.end[axis] - segment.start[axis]) * station) / size
              )
            )
            .join(',');
        const ends = [at(beam.offset), at(beam.offset + beam.length)].sort();
        return `${beam.values.wall_beam_identifier} ${ends.join('..')}`;
      })
    )
    .sort();

test('the schema: beams under the physical wall, a copy in each room wall row', () => {
  const f = createBuildingPlanExample();
  const nodes = f.meta.repeatablesByNodeKey;
  assert.equal(nodes.face_beams.sourceNode, 'wall_beams');
  const names = (node) => nodes[node].fields.map((entry) => entry.originalDataName);
  for (const name of [
    'wall_beam_identifier',
    'wall_beam_offset',
    'wall_beam_length',
    'wall_beam_distance_from_floor',
    'wall_beam_width',
    'wall_beam_depth',
    'wall_beam_wall_reference',
  ])
    assert.ok(names('wall_beams').includes(name) && names('face_beams').includes(name), name);
  assert.ok(names('beams').includes('beam_distance_from_floor'));
  // Authors can add their own fields to wall beams (the role starter field).
  assert.doesNotThrow(() =>
    expandBuildingPlanSchema({
      form: {
        name: 'Plan',
        elements: [
          {
            ...f.schema.form.elements[0],
            node_overrides: {
              wall_beams: {
                extra_elements: [
                  {
                    ...nodes.wall_beams.fields.find(
                      (entry) => entry.originalDataName === 'wall_beam_identifier'
                    ).field,
                    key: 'wall_beam_role_note',
                    data_name: 'wall_beam_role_note',
                    label: 'Role note',
                    required: false,
                  },
                ],
              },
            },
          },
        ],
      },
    })
  );
});

test('the exported record writes an empty wall beams list on every physical wall', () => {
  const f = createBuildingPlanExample();
  const counts = { wall_beams: 0, physicalWalls: 0 };
  const visit = (values, inPhysicalWall) => {
    for (const [key, value] of Object.entries(values || {})) {
      if (!Array.isArray(value)) continue;
      if (/^~bp_wall_beams_/.test(key)) {
        assert.ok(inPhysicalWall);
        assert.deepEqual(value, []);
        counts.wall_beams += 1;
      }
      const physical = /^~bp_physical_walls_/.test(key);
      if (physical) counts.physicalWalls += value.length;
      for (const row of value) if (row?.form_values) visit(row.form_values, physical);
    }
  };
  visit(f.stored.form_values, false);
  assert.ok(counts.physicalWalls > 0);
  assert.equal(counts.wall_beams, counts.physicalWalls);
});

test('a beam added from a wall entry: the whole wall, as wide as it, 30 cm deep, on top; B#n', () => {
  const f = createBuildingPlanExample();
  const editor = createBuildingPlanEditor({
    meta: f.meta,
    record: f.record,
    derivedCommands: true,
  });
  const nodes = f.meta.repeatablesByNodeKey;
  const record = editor.getRecord();
  const floor = record.repeatable[nodes.floors.preferredKey][0];
  const room2 = floor.repeatable[nodes.rooms.preferredKey][1];
  const w3 = room2.repeatable[nodes.walls.preferredKey].find(
    (row) => row.values[nodes.walls.fieldsByOriginalDataName.wall_label.dataName] === 'W3'
  );
  const base = [
    { key: nodes.floors.preferredKey, id: floor.id },
    { key: nodes.rooms.preferredKey, id: room2.id },
    { key: nodes.walls.preferredKey, id: w3.id },
  ];
  for (const [scopeId, path] of [
    ['floor', base.slice(0, 1)],
    ['room', base.slice(0, 2)],
    ['wall', base],
  ])
    assert.equal(editor.openRow({ path, scopeId }).status, 'opened', scopeId);
  const opened = editor.openRow({
    path: [...base, { key: nodes.face_beams.preferredKey, id: 'new-beam-row' }],
    row: { id: 'new-beam-row', values: {}, repeatable: {} },
    scopeId: 'beam',
    parentScopeId: 'wall',
  });
  assert.equal(opened.status, 'opened', JSON.stringify(opened.issues));
  const wall = editor.getSnapshot().floors[0].walls.find((entry) => entry.autoLabel === 'W3');
  const [beam] = wall.beams;
  assert.deepEqual(
    {
      offset: round(beam.offset),
      length: round(beam.length),
      width: beam.width,
      depth: beam.depth,
      underside: beam.underside,
      name: beam.values.wall_beam_identifier,
    },
    { offset: 0, length: 2, width: 0.2, depth: 0.3, underside: 2.7, name: 'B#1' }
  );
});

test('a room beam: 15 by 30 cm from its list, its underside filled at the clear height', () => {
  const t = example();
  applied(
    t.apply({
      type: 'create_element',
      roomId: t.floor().rooms[0].id,
      collection: 'beams',
      element: { start: { x: 0, y: 1.5 }, end: { x: 5, y: 1.5 }, width: 0.15, height: 0.3 },
      values: {},
    })
  );
  assert.equal(t.floor().rooms[0].beams[0].values.beam_distance_from_floor, 2.7);
  // A wall beam added next takes the next number on the floor.
  applied(addBeam(t, 'W1', 1, 2));
  assert.deepEqual(
    t.floor().walls.flatMap((wall) => wall.beams.map((beam) => beam.values.wall_beam_identifier)),
    ['B#2']
  );
  // From the room's Beams list (core's editor), 15 by 30 cm as the canvas draws one.
  const f = createBuildingPlanExample();
  const editor = createBuildingPlanEditor({ meta: f.meta, record: f.record });
  const nodes = f.meta.repeatablesByNodeKey;
  const floor = editor.getRecord().repeatable[nodes.floors.preferredKey][0];
  const room = floor.repeatable[nodes.rooms.preferredKey][0];
  const path = [
    { key: nodes.floors.preferredKey, id: floor.id },
    { key: nodes.rooms.preferredKey, id: room.id },
  ];
  editor.openRow({ path: path.slice(0, 1), scopeId: 'floor' });
  editor.openRow({ path, scopeId: 'room', parentScopeId: 'floor' });
  const opened = editor.openRow({
    path: [...path, { key: nodes.beams.preferredKey, id: 'new-room-beam' }],
    row: { id: 'new-room-beam', values: {}, repeatable: {} },
    scopeId: 'beam',
    parentScopeId: 'room',
  });
  assert.equal(opened.status, 'opened', JSON.stringify(opened.issues));
  const [beam] = editor.getSnapshot().floors[0].rooms[0].beams;
  assert.deepEqual(
    [beam.width, beam.height, beam.values.beam_distance_from_floor],
    [0.15, 0.3, 2.7]
  );
});

test('a wall beam is carried by every edit, in place; a Split across it is refused', () => {
  const t = example();
  applied(addBeam(t, 'W3', 0.2, 1.5));
  applied(addBeam(t, 'W1', 1, 3));
  const before = beamPlaces(t.floor());
  assert.deepEqual(before, ['B#1 3.3,3.1..4.8,3.1', 'B#2 1,-0.1..4,-0.1']);
  // The shared wall moved down 0.4 m: its beam with it, along the wall in place.
  applied(t.apply({ type: 'resize_face', faceId: t.f.faceA, distance: 0.4 }));
  assert.deepEqual(beamPlaces(t.floor()), ['B#1 3.3,3.5..4.8,3.5', 'B#2 1,-0.1..4,-0.1']);
  const moved = beamPlaces(t.floor());
  // Split before each beam, then Rejoin: in place throughout.
  const north = t.floor().rooms[0].faces.find((face) => face.wallId === t.wall('W1').id).id;
  for (const [faceId, offset] of [
    [t.f.faceA, 0.1],
    [north, 0.5],
  ]) {
    const cut = t.apply({ type: 'split_face', faceId, offset });
    applied(cut);
    assert.deepEqual(beamPlaces(t.floor()), moved);
    applied(t.apply({ type: 'rejoin_cut', cutId: cut.created.id }));
    assert.deepEqual(beamPlaces(t.floor()), moved);
  }
  assert.equal(t.apply({ type: 'split_face', faceId: north, offset: 2 }).status, 'conflict');
  // Room 2 removed: the shared wall stays the Bedroom's, its beam with it.
  applied(t.apply({ type: 'remove_room', roomId: t.floor().rooms[1].id }));
  assert.deepEqual(beamPlaces(t.floor()), moved);
  assert.deepEqual(t.session.validate(), []);
});

test('a beam that would not fit its wall is refused', () => {
  const t = example();
  const result = addBeam(t, 'W3', 1, 1.5);
  assert.equal(result.status, 'conflict');
  assert.ok(result.issues.some((issue) => issue.code === 'wall_beam_outside_wall'));
});
