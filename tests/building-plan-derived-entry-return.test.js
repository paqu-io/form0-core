import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  createBuildingPlanEditor,
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';

// The kept notch, option 2: in an editor, a drag of a shared wall away from the neighbour first
// returns the neighbour's face to where the editor first saw it, then widens.
// The example: A (0..5 × 0..3) and B (3..8 × 3.2..6.2) share W3 over x 3..5; B is wider, so a
// push of A's face into B leaves B a notch, whose side (x 5.2) then faces A's side (x 5).

const near = (a, b) => Math.abs(a - b) < 1e-9;
const points = (room) => room.vertices.map((v) => [+v.x.toFixed(6), +v.y.toFixed(6)]);

/**
 * The face of a room whose edge lies on `axis` = `at` and spans `mid` along the other axis.
 * @returns {{faceId: string, edgeId: string}}
 */
function faceAt(room, axis, at, mid) {
  const other = axis === 'x' ? 'y' : 'x';
  const vertex = Object.fromEntries(room.vertices.map((v) => [v.id, v]));
  for (const face of room.faces)
    for (const binding of face.bindings) {
      const edge = room.edges.find((entry) => entry.id === binding.edgeId);
      const [p, q] = [vertex[edge.startId], vertex[edge.endId]];
      if (near(p[axis], at) && near(q[axis], at) && Math.min(p[other], q[other]) < mid)
        if (Math.max(p[other], q[other]) > mid) return { faceId: face.id, edgeId: edge.id };
    }
  throw new Error(`No face at ${axis} = ${at}`);
}

function example() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `w-${++serial}`,
    derivedCommands: true,
  });
  const rooms = () => session.getSnapshot().floors[0].rooms;
  const move = (faceId, distance, scopeId = null) => {
    const result = session.apply(
      { type: 'resize_face', floorId: f.floorId, faceId, distance },
      { scopeId }
    );
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
  };
  const drag = (distance, scopeId = null) => move(f.faceA, distance, scopeId);
  return { f, session, rooms, move, drag };
}
/** B's face over x 3..5 (its lowest y there). */
const bFace = (b) => Math.min(...b.vertices.filter((v) => v.x < 5 - 1e-9).map((v) => v.y));
/** A's face over x 3..5 (its highest y there). */
const aFace = (a) => Math.max(...a.vertices.filter((v) => v.x > 3 + 1e-9).map((v) => v.y));
/** B's notch side facing A's side (x near 5, at the notch's y 3.5). */
const notchSide = (b) =>
  Math.min(...b.vertices.filter((v) => near(v.y, 3.5) && v.x > 2.5).map((v) => v.x));
/** A's side over y 3.2..3.5 (its x at y 3.35). */
const aSide = (a) => Math.max(...a.vertices.filter((v) => near(v.y, 3.5)).map((v) => v.x));

test('a drag back in the same editor moves the whole wall back first', () => {
  const t = example();
  t.session.beginScope({ id: 'entry' });
  t.drag(0.5, 'entry');
  assert.ok(near(bFace(t.rooms()[1]), 3.7), 'the push moved B’s face');
  t.drag(-0.2, 'entry');
  const [a, b] = t.rooms();
  assert.ok(near(bFace(b), 3.5), 'B’s face came back with the wall');
  assert.ok(near(aFace(a), 3.3));
});

test('dragged back as far as it was pushed, the plan is the one the editor opened on', () => {
  const t = example();
  const start = t.rooms().map(points);
  t.session.beginScope({ id: 'entry' });
  t.drag(0.5, 'entry');
  t.drag(-0.5, 'entry');
  assert.deepEqual(t.rooms().map(points), start);
});

test('past the return the wall widens as before, B where the editor found it', () => {
  const t = example();
  const bStart = points(t.rooms()[1]);
  t.session.beginScope({ id: 'entry' });
  t.drag(0.5, 'entry');
  t.drag(-0.7, 'entry');
  const floor = t.session.getSnapshot().floors[0];
  const [a, b] = floor.rooms;
  assert.deepEqual(points(b), bStart);
  assert.ok(near(aFace(a), 2.8));
  const widened = floor.walls.find((wall) => near(wall.overrides?.wall_thickness ?? 0, 0.4));
  assert.ok(widened, 'the widened width (0.2 + 0.2) is explicit, as widen sets it');
});

test('outside an editor, and for a push saved before the editor opened, B keeps its face', () => {
  const free = example();
  free.drag(0.5);
  free.drag(-0.5);
  assert.ok(near(bFace(free.rooms()[1]), 3.7), 'no editor: widen as today');

  const saved = example();
  saved.session.beginScope({ id: 'first' });
  saved.drag(0.5, 'first');
  saved.session.acceptScope('first');
  saved.session.beginScope({ id: 'second' });
  saved.drag(-0.5, 'second');
  assert.ok(near(bFace(saved.rooms()[1]), 3.7), 'the editor opened on the pushed face');
});

test('move_wall is unchanged: the whole wall follows the drag either way', () => {
  const t = example();
  t.session.beginScope({ id: 'entry' });
  t.drag(0.5, 'entry');
  const result = t.session.apply(
    {
      type: 'resize_face',
      floorId: t.f.floorId,
      faceId: t.f.faceA,
      distance: -0.7,
      sharedWallDrag: 'move_wall',
    },
    { scopeId: 'entry' }
  );
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  assert.ok(near(bFace(t.rooms()[1]), 3.0));
});

test('a face an earlier push in the editor made returns too: a notch’s side pushed again', () => {
  // Hand test 2026-11-22: B's far side lies out of A's reach (B widened to x -5 first), so the
  // plan the editor opened on has no face of B there; the notch's side appears after the push.
  const t = example();
  t.move(faceAt(t.rooms()[1], 'x', 3, 5).faceId, 8);
  t.session.beginScope({ id: 'entry' });
  t.move(faceAt(t.rooms()[0], 'y', 3, 4).faceId, 0.5, 'entry');
  const side = faceAt(t.rooms()[0], 'x', 5, 3.35).faceId;
  t.move(side, 0.3, 'entry');
  assert.ok(near(notchSide(t.rooms()[1]), 5.5), 'the push moved the notch’s side');
  t.move(side, -0.3, 'entry');
  const [a, b] = t.rooms();
  assert.ok(near(notchSide(b), 5.2), 'the notch’s side came back with the wall');
  assert.ok(near(aSide(a), 5));
});

test('another face of the neighbour within reach is not taken for the pushed one', () => {
  // B's far side (x 3) faces the same way as the notch's side and lies within A: dragged back
  // past the push, the wall returns 0.3 and widens the rest, not 0.6.
  const t = example();
  t.session.beginScope({ id: 'entry' });
  t.drag(0.5, 'entry');
  const side = faceAt(t.rooms()[0], 'x', 5, 3.35).faceId;
  t.move(side, 0.3, 'entry');
  t.move(side, -0.6, 'entry');
  const [a, b] = t.rooms();
  assert.ok(near(notchSide(b), 5.2), 'B’s notch side where the push found it');
  assert.ok(near(aSide(a), 4.7), 'A’s side widened the remaining 0.3');
});

/** The web host: the editor holds the entry's scope and commits; the canvas previews. */
function managedCanvas() {
  const f = createBuildingPlanExample();
  const meta = f.meta;
  const editor = createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    record: writeBuildingPlanRecord({ meta, plan: f.snapshot }),
  });
  const floors = meta.repeatablesByNodeKey.floors.preferredKey;
  const rooms = meta.repeatablesByNodeKey.rooms.preferredKey;
  const floorRow = editor.getRecord().repeatable[floors][0];
  const scopeId = 'room-entry';
  const open = () =>
    editor.openRow({
      path: [
        { key: floors, id: floorRow.id },
        { key: rooms, id: floorRow.repeatable[rooms][0].id },
      ],
      scopeId,
    });
  const plan = () => readBuildingPlanRecord({ meta, record: editor.getRecord() });
  const operation = ({ faceId, edgeId }, distance) => ({
    type: 'resize_face',
    floorId: f.floorId,
    faceId,
    edgeId,
    distance,
  });
  const controller = () =>
    new BuildingPlanCanvasController({
      meta,
      managedTransactions: true,
      derivedCommands: true,
      readRecord: () => ({ values: {}, repeatable: editor.getRecord().repeatable }),
      writeRecord: (_record, { operation: edit }) => editor.apply(edit, { scopeId }),
    });
  return { f, editor, open, plan, operation, controller };
}

test('a managed canvas previews the drag back as its host’s editor commits it', async () => {
  const m = managedCanvas();
  m.open();
  const controller = m.controller();
  const face = faceAt(m.plan().floors[0].rooms[0], 'y', 3, 4);
  assert.ok(await controller.apply(m.operation(face, 0.5)));
  controller.syncFromState();
  assert.ok(near(bFace(m.plan().floors[0].rooms[1]), 3.7), 'the push moved B’s face');
  const preview = controller.previewOperation(m.operation(face, -0.5));
  assert.equal(preview.status, 'ready', JSON.stringify(preview.issues));
  assert.ok(near(bFace(preview.snapshot.floors[0].rooms[1]), 3.2), 'the preview returns B');
  assert.ok(await controller.apply(m.operation(face, -0.5)));
  assert.ok(near(bFace(m.plan().floors[0].rooms[1]), 3.2), 'and so does the drop');
  controller.dispose();
});

test('a managed canvas returns a notch’s side its entry made, from the plans it synced', async () => {
  const m = managedCanvas();
  // B's far side out of A's reach, saved before the entry opens.
  m.editor.apply(m.operation(faceAt(m.plan().floors[0].rooms[1], 'x', 3, 5), 8));
  m.open();
  const controller = m.controller();
  const room = () => m.plan().floors[0].rooms[0];
  assert.ok(await controller.apply(m.operation(faceAt(room(), 'y', 3, 4), 0.5)));
  const side = faceAt(room(), 'x', 5, 3.35);
  assert.ok(await controller.apply(m.operation(side, 0.3)));
  assert.ok(near(notchSide(m.plan().floors[0].rooms[1]), 5.5), 'the push moved the side');
  const back = m.operation(side, -0.3);
  const preview = controller.previewOperation(back);
  assert.equal(preview.status, 'ready', JSON.stringify(preview.issues));
  assert.ok(near(notchSide(preview.snapshot.floors[0].rooms[1]), 5.2), 'the preview returns it');
  assert.ok(await controller.apply(back));
  assert.ok(near(notchSide(m.plan().floors[0].rooms[1]), 5.2), 'and so does the drop');
  controller.dispose();
});
