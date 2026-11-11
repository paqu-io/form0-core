import test from 'node:test';
import assert from 'node:assert/strict';
import { moveRoomStretch } from '../src/building-plan/derive/boundary-edits.js';
import { remapRoomSpans } from '../src/building-plan/derive/span-remap.js';
import { roomLines } from '../src/building-plan/derive/room-lines.js';

/** A primary room from points, one anchor (subject w<i>, row f<i>) per edge. */
function primaryRoom(points, marks = {}) {
  const vertices = points.map(([x, y], i) => ({ id: `v${i}`, x, y, ...(marks[i] || {}) }));
  const edges = vertices.map((v, i) => ({
    id: `e${i}`,
    startId: v.id,
    endId: vertices[(i + 1) % vertices.length].id,
  }));
  const room = { id: 'r', vertices, edges };
  const anchors = edges.map((edge, i) => ({
    subjectId: `w${i}`,
    faceId: `f${i}`,
    roomId: 'r',
    edgeId: edge.id,
    from: 0,
    to: null,
    bindingId: `b${i}`,
  }));
  const subjects = new Map(edges.map((_, i) => [`w${i}`, { id: `w${i}`, openings: [] }]));
  return { room, primary: { rooms: [room], anchors, subjects } };
}

let serial = 0;
const createId = () => `n${++serial}`;
const coords = (room) => room.vertices.map((v) => [round(v.x), round(v.y)]);
const round = (value) => Math.round(value * 1e6) / 1e6 + 0;
const lineOf = (room, edgeId) => roomLines(room).find((l) => l.edges.some((e) => e.id === edgeId));

function edit(state, plan) {
  const result = moveRoomStretch(state.room, plan, createId);
  remapRoomSpans(state.primary, state.room, result.edges, result.lengths, createId);
  return result;
}

test('a whole line moves; its corners slide along the adjoining edges, which keep their IDs', () => {
  const s = primaryRoom([
    [0, 0],
    [5, 0],
    [5, 3],
    [0, 3],
  ]);
  const line = lineOf(s.room, 'e2');
  const { edges } = edit(s, {
    line,
    from: 0,
    to: line.frame.length,
    delta: { x: 0, y: 0.5 },
    ends: [{ type: 'slide' }, { type: 'slide' }],
  });
  assert.deepEqual(coords(s.room), [
    [0, 0],
    [5, 0],
    [5, 3.5],
    [0, 3.5],
  ]);
  assert.deepEqual(
    s.room.edges.map((e) => e.id),
    ['e0', 'e1', 'e2', 'e3']
  );
  assert.equal(round(edges.get('e1').to), 3.5, 'the east edge is lengthened at its end');
  assert.equal(round(edges.get('e3').from), -0.5, 'the west edge is lengthened at its start');
  assert.ok(s.primary.anchors.every((a) => a.to === null && a.from === 0));
});

test('a partial stretch moves with right-angle jogs; its row stays on the moved part', () => {
  const s = primaryRoom([
    [0, 0],
    [5, 0],
    [5, 3],
    [0, 3],
  ]);
  const line = lineOf(s.room, 'e2'); // runs from (5,3) to (0,3)
  const { edges } = edit(s, {
    line,
    from: 1,
    to: 3,
    delta: { x: 0, y: 0.5 },
    ends: [
      { type: 'jog', station: 1 },
      { type: 'jog', station: 3 },
    ],
    preferMoved: ['e2'],
  });
  assert.deepEqual(coords(s.room), [
    [0, 0],
    [5, 0],
    [5, 3],
    [4, 3],
    [4, 3.5],
    [2, 3.5],
    [2, 3],
    [0, 3],
  ]);
  const jogs = [...edges.values()].filter((entry) => entry.jog);
  assert.equal(jogs.length, 2);
  const moved = s.primary.anchors.find((a) => a.edgeId === 'e2');
  assert.equal(moved.faceId, 'f2', 'the dragged row stays on the moved part');
  const parts = s.primary.anchors.filter((a) => a.subjectId === 'w2');
  assert.equal(parts.length, 3, 'both stationary parts keep the subject');
  assert.ok(
    parts.filter((a) => a.faceId !== 'f2').every((a) => a.lineage.jogOriginFaceId === 'f2')
  );
  assert.ok(!s.primary.anchors.some((a) => jogs.some((j) => j.id === a.edgeId)), 'jogs unanchored');
});

test('an extension moves with the stretch but stays unanchored', () => {
  const s = primaryRoom([
    [0, 0],
    [5, 0],
    [5, 3],
    [3, 3],
    [0, 3],
  ]);
  // Line y = 3 runs (5,3) -> (3,3) -> (0,3); move [0, 2] and extend to station 2.2.
  const line = lineOf(s.room, 'e2');
  edit(s, {
    line,
    from: 0,
    to: 2,
    delta: { x: 0, y: 0.2 },
    ends: [{ type: 'slide' }, { type: 'jog', station: 2.2 }],
  });
  assert.deepEqual(coords(s.room), [
    [0, 0],
    [5, 0],
    [5, 3.2],
    [3, 3.2],
    [2.8, 3.2],
    [2.8, 3],
    [0, 3],
  ]);
  const extension = s.room.edges[3];
  assert.ok(!s.primary.anchors.some((a) => a.edgeId === extension.id), 'extension unanchored');
  const rest = s.primary.anchors.filter((a) => a.subjectId === 'w3');
  assert.deepEqual(
    rest.map((a) => [a.edgeId, a.faceId]),
    [['e3', 'f3']],
    'the stationary part keeps the row'
  );
});

test('a shifted jog relocates, and joins the continuation when the line is straight again', () => {
  // Top: (5,3.2) -> (3,3.2) -> jog (3,3) -> (0,3).
  const make = () =>
    primaryRoom([
      [0, 0],
      [5, 0],
      [5, 3.2],
      [3, 3.2],
      [3, 3],
      [0, 3],
    ]);
  const s = make();
  const line = lineOf(s.room, 'e2');
  edit(s, {
    line,
    from: 0,
    to: line.frame.length,
    delta: { x: 0, y: -0.3 },
    ends: [{ type: 'slide' }, { type: 'shift', station: 2.2 }],
  });
  assert.deepEqual(coords(s.room), [
    [0, 0],
    [5, 0],
    [5, 2.9],
    [2.8, 2.9],
    [2.8, 3],
    [0, 3],
  ]);
  assert.ok(
    s.primary.anchors.some((a) => a.edgeId === 'e3' && a.subjectId === 'w3'),
    'the relocated jog keeps its edge and anchor'
  );

  const t = make();
  edit(t, {
    line: lineOf(t.room, 'e2'),
    from: 0,
    to: 2,
    delta: { x: 0, y: -0.2 },
    ends: [{ type: 'slide' }, { type: 'shift', station: null }],
  });
  assert.deepEqual(coords(t.room), [
    [0, 0],
    [5, 0],
    [5, 3],
    [3, 3],
    [0, 3],
  ]);
  assert.ok(!t.primary.anchors.some((a) => a.subjectId === 'w3'), 'the old jog is gone');
});

test('a corner slide that collapses its adjoining jog merges into the stationary vertex', () => {
  const s = primaryRoom([
    [0, 0],
    [5, 0],
    [5, 3.2],
    [3, 3.2],
    [3, 3],
    [0, 3],
  ]);
  edit(s, {
    line: lineOf(s.room, 'e2'),
    from: 0,
    to: 2,
    delta: { x: 0, y: -0.2 },
    ends: [{ type: 'slide' }, { type: 'slide' }],
  });
  assert.deepEqual(coords(s.room), [
    [0, 0],
    [5, 0],
    [5, 3],
    [3, 3],
    [0, 3],
  ]);
  assert.ok(s.primary.anchors.some((a) => a.edgeId === 'e2' && a.subjectId === 'w2'));
});

test('an edit that turns the room inside out is refused', () => {
  const s = primaryRoom([
    [0, 0],
    [5, 0],
    [5, 3],
    [0, 3],
  ]);
  const line = lineOf(s.room, 'e2');
  assert.throws(
    () =>
      edit(s, {
        line,
        from: 0,
        to: line.frame.length,
        delta: { x: 0, y: -4 },
        ends: [{ type: 'slide' }, { type: 'slide' }],
      }),
    (error) => error.issues[0].code === 'invalid_room_geometry'
  );
});

test('openings keep their place on the part they lie on; one cut by a jog is refused', () => {
  const s = primaryRoom([
    [0, 0],
    [5, 0],
    [5, 3],
    [0, 3],
  ]);
  s.primary.subjects
    .get('w2')
    .openings.push({ id: 'door', type: 'door', faceId: 'f2', from: 3.5, width: 0.9 });
  edit(s, {
    line: lineOf(s.room, 'e2'),
    from: 1,
    to: 3,
    delta: { x: 0, y: 0.5 },
    ends: [
      { type: 'jog', station: 1 },
      { type: 'jog', station: 3 },
    ],
    preferMoved: ['e2'],
  });
  const door = s.primary.subjects.get('w2').openings[0];
  const holder = s.primary.anchors.find((a) => a.faceId === door.faceId);
  assert.notEqual(door.faceId, 'f2', 'the door stays on the stationary part');
  assert.equal(round(door.from), 0.5);
  assert.ok(holder);

  const t = primaryRoom([
    [0, 0],
    [5, 0],
    [5, 3],
    [0, 3],
  ]);
  t.primary.subjects
    .get('w2')
    .openings.push({ id: 'door', type: 'door', faceId: 'f2', from: 2.5, width: 0.9 });
  assert.throws(
    () =>
      edit(t, {
        line: lineOf(t.room, 'e2'),
        from: 1,
        to: 3,
        delta: { x: 0, y: 0.5 },
        ends: [
          { type: 'jog', station: 1 },
          { type: 'jog', station: 3 },
        ],
      }),
    (error) => error.issues[0].code === 'opening_crosses_edit_boundary'
  );
});
