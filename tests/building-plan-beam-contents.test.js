import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  createBuildingPlanSession,
  validateBuildingPlanSnapshot,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { polygonInside, segmentInside } from '../src/building-plan/free-wall-body.js';

// 3a-3 (2026-11-23; B1, B4 and B6 of the beams round): a room beam's centreline and body lie
// inside its room's outline, touching allowed, its ends cut along the faces they stop on; the
// derived engine refuses an edit that takes one out, naming it; the canvas snapshot carries each
// beam's outline. The example's Bedroom is 0..5 × 0..3 m with 20 cm walls outside it (W2, its
// right wall, from x 5 to 5.2).

const G = 100;
const codes = (result) => (result.issues || []).map((issue) => issue.code);

function example() {
  const f = createBuildingPlanExample();
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    derivedCommands: true,
  });
  const floor = () => session.getSnapshot().floors[0];
  const room = () => floor().rooms[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const beam = ([x0, y0], [x1, y1], width = 0.15) =>
    apply({
      type: 'create_element',
      roomId: room().id,
      collection: 'beams',
      element: { start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, width, height: 0.3 },
      values: {},
    });
  const face = (label) => {
    const wall = floor().walls.find((entry) => entry.autoLabel === label);
    return room().faces.find((entry) => entry.wallId === wall.id).id;
  };
  return { f, session, floor, room, apply, beam, face };
}

/** The canvas snapshot of the session's plan, as the canvas reads it. */
function canvasOf(t) {
  let record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const controller = new BuildingPlanCanvasController({
    meta: t.f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
  });
  controller.setGridSize(G);
  return controller.getSnapshot();
}

/**
 * Invariants on an accepted plan's snapshot: every beam has an outline, inside its room (touching
 * allowed), holding its centreline; an end on a face is cut along it (the outline's points there
 * lie on the face).
 */
function checkOutlines(snapshot) {
  assert.ok(snapshot.beams.length > 0);
  for (const beam of snapshot.beams) {
    const room = snapshot.rooms.find((entry) => entry.id === beam.roomId);
    const at = (u, v) => ({
      x: room.rect.x + u * room.rect.width,
      y: room.rect.y + v * room.rect.height,
    });
    const [start, end] = [at(beam.startU, beam.startV), at(beam.endU, beam.endV)];
    assert.ok(beam.outline.length >= 4, `${beam.displayLabel} has an outline`);
    assert.ok(polygonInside(beam.outline, room.vertices, 0.05), `${beam.displayLabel} inside`);
    assert.ok(
      segmentInside(start, end, [...beam.outline], 0.05),
      `${beam.displayLabel} holds its line`
    );
  }
}

test('outlines: face to face, slanted onto two faces, flush along a face, in a corner', () => {
  const t = example();
  for (const [from, to] of [
    [
      [0, 1.5],
      [5, 1.5],
    ],
    [
      [0, 0.6],
      [2, 3],
    ],
    [
      [1, 0.075],
      [4, 0.075],
    ],
    [
      [0, 0],
      [1.2, 1.2],
    ],
  ])
    assert.equal(t.beam(from, to).status, 'applied', JSON.stringify([from, to]));
  const snapshot = canvasOf(t);
  checkOutlines(snapshot);
  // The slanted one's ends are cut along the faces: its outline reaches no further than x 0 and
  // y 300, where a square end would stand past them.
  const slanted = snapshot.beams[1];
  assert.ok(Math.abs(Math.min(...slanted.outline.map((p) => p.x))) < 1e-6);
  assert.ok(Math.abs(Math.max(...slanted.outline.map((p) => p.y)) - 300) < 1e-6);
  // After the room's right wall moves out, still inside.
  assert.equal(
    t.apply({ type: 'resize_face', faceId: t.face('W2'), distance: 0.4 }).status,
    'applied'
  );
  checkOutlines(canvasOf(t));
});

test('a beam drawn out of its room, or half over a wall: refused, naming it', () => {
  const t = example();
  // Its centreline on the face: half of it over W1.
  const over = t.beam([1, 0], [4, 0]);
  assert.deepEqual(codes(over), ['beam_outside_room']);
  assert.equal(over.issues[0].message, 'Beam B#1 would leave its room.');
  assert.deepEqual(over.issues[0].subject, { type: 'beams', id: over.issues[0].subject.id });
  assert.equal(over.issues[0].subject.type, 'beams');
  assert.deepEqual(codes(t.beam([1, 1], [6, 1])), ['beam_outside_room']);
  // Flush along it: fine.
  assert.equal(t.beam([1, 0.075], [4, 0.075]).status, 'applied');
});

test('a wall moved in past a beam clear of it, or a width typed out of the room: refused', () => {
  const t = example();
  assert.equal(t.beam([1, 1.5], [4.5, 1.5]).status, 'applied');
  const moved = t.apply({ type: 'resize_face', faceId: t.face('W2'), distance: -1 });
  assert.deepEqual(codes(moved), ['beam_outside_room']);
  assert.equal(moved.issues[0].message, 'Beam B#1 would leave its room.');
  // Out: fine; the beam keeps its place.
  assert.equal(
    t.apply({ type: 'resize_face', faceId: t.face('W2'), distance: 0.3 }).status,
    'applied'
  );
  // A beam 10 cm off the top face, typed 30 cm wide: its body would cross the face. (At 20 cm it
  // would lie flush on it, and keep that side when made wider: `building-plan-beam-follow`.)
  const s = example();
  assert.equal(s.beam([1, 0.1], [4, 0.1]).status, 'applied');
  const beam = s.room().beams[0];
  const widen = (width) =>
    s.apply({
      type: 'update_element',
      roomId: s.room().id,
      collection: 'beams',
      elementId: beam.id,
      element: { start: beam.start, end: beam.end, width, height: 0.3 },
      values: { beam_width: width },
    });
  assert.equal(widen(0.18).status, 'applied');
  assert.deepEqual(codes(widen(0.3)), ['beam_outside_room']);
});

test('a record holding a beam out of its room still reads, and refuses no unrelated edit', () => {
  // Drawn before 3a: its centreline on the top face, half of it over W1 (the canvas allowed it).
  const f = createBuildingPlanExample();
  const room = f.snapshot.floors[0].rooms[0];
  room.beams.push({
    id: 'old-beam',
    start: { x: 1, y: 0 },
    end: { x: 4, y: 0 },
    width: 0.25,
    height: 0.4,
    values: { beam_identifier: 'B#1' },
  });
  assert.deepEqual(validateBuildingPlanSnapshot(f.snapshot), []);
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    derivedCommands: true,
  });
  const floor = session.getSnapshot().floors[0];
  const w2 = floor.walls.find((entry) => entry.autoLabel === 'W2');
  const faceId = floor.rooms[0].faces.find((entry) => entry.wallId === w2.id).id;
  const result = session.apply({ floorId: f.floorId, type: 'resize_face', faceId, distance: 0.3 });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
});
