import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';

// Step 2, 2b (decisions D1 and D2, 2026-11-23): the canvas snapshot's plaster surfaces, every
// visible face of the floor's wall material with the plaster that finishes it. Checked as
// invariants (every surface has an owner; each room's outline, doors and windows left out, is
// covered exactly once) and on the hand test's cases: a cap continues the row in line with it, a
// wall's exposed end the outside face round its corner. The example's Bedroom is 0..5 × 0..3 m;
// the room below shares W3 (y 3..3.2, x 3..5); walls are 20 cm.

const plastered = { choice: [{ value: 'plastered', label: 'Plastered' }], other: [] };
const G = 100;

function plan(steps = () => {}) {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `s-${++serial}`,
    derivedCommands: true,
    editingPolicy: {
      inheritedChangePolicy: 'apply',
      thicknessAnchor: 'room_face',
      sharedWallDrag: 'widen',
    },
  });
  const floor = () => session.getSnapshot().floors[0];
  const faceOf = (label, roomIndex = 0) =>
    floor().rooms[roomIndex].faces.find(
      (face) => floor().walls.find((wall) => wall.id === face.wallId).autoLabel === label
    ).id;
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  };
  steps({ apply, faceOf, floor, f });
  let record = writeBuildingPlanRecord({ meta: f.meta, plan: session.getSnapshot() });
  const controller = new BuildingPlanCanvasController({
    meta: f.meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => ((record = next), true),
  });
  controller.setGridSize(G);
  return { controller, snapshot: controller.getSnapshot(), floor: floor(), f };
}

const length = (s) => Math.hypot(s.to.x - s.from.x, s.to.y - s.from.y);
const sameLine = (a, b) => {
  const u = { x: (a.to.x - a.from.x) / length(a), y: (a.to.y - a.from.y) / length(a) };
  const cross = (p) => u.x * (p.y - a.from.y) - u.y * (p.x - a.from.x);
  return Math.abs(cross(b.from)) < 0.5 && Math.abs(cross(b.to)) < 0.5;
};
const along = (a, p) =>
  ((p.x - a.from.x) * (a.to.x - a.from.x) + (p.y - a.from.y) * (a.to.y - a.from.y)) / length(a);

/** Every surface has an owner; each room's outline, its openings left out, is covered once. */
function assertCovered(snapshot, freeWallIds = new Set()) {
  const surfaces = snapshot.plasterSurfaces;
  // A free wall's free end is the one surface left without an owner (no plaster there).
  assert.deepEqual(
    surfaces.filter((surface) => !surface.sideId && !freeWallIds.has(surface.wallId)),
    [],
    'every surface has an owner'
  );
  for (const room of snapshot.rooms) {
    const v = room.vertices;
    let perimeter = 0;
    for (let i = 0; i < v.length; i++)
      perimeter += Math.hypot(v[(i + 1) % v.length].x - v[i].x, v[(i + 1) % v.length].y - v[i].y);
    const openings = [...snapshot.doors, ...snapshot.windows]
      .filter((opening) => opening.roomId === room.id)
      .reduce((total, opening) => total + opening.width * G, 0);
    const own = surfaces.filter(
      (surface) => surface.roomId === room.id && !freeWallIds.has(surface.wallId)
    );
    const covered = own.reduce((total, surface) => total + length(surface), 0);
    assert.ok(
      Math.abs(covered - (perimeter - openings)) < 0.5,
      `${room.displayLabel}: covered ${covered}, outline ${perimeter - openings}`
    );
    for (const a of own)
      for (const b of own) {
        if (a === b || !sameLine(a, b)) continue;
        const [lo, hi] = [along(a, b.from), along(a, b.to)].sort((x, y) => x - y);
        assert.ok(
          Math.min(hi, length(a)) - Math.max(lo, 0) < 0.5,
          `${room.displayLabel}: two surfaces overlap`
        );
      }
  }
}

test('the example plan: every surface has an owner, each room outline is covered once', () => {
  const t = plan();
  assert.ok(t.snapshot.plasterSurfaces.length > 0);
  assertCovered(t.snapshot);
  // Nothing plastered yet: no thickness anywhere.
  assert.ok(t.snapshot.plasterSurfaces.every((surface) => surface.thickness === null));
  t.controller.dispose();
});

const setPlaster = (apply, faceId, outside, thickness) => {
  apply({ type: 'set_property', faceId, outside, property: 'wall_plaster', value: plastered });
  apply({
    type: 'set_property',
    faceId,
    outside,
    property: 'wall_plaster_thickness',
    value: thickness,
  });
};
const within = (snapshot, x0, y0, x1, y1) =>
  snapshot.plasterSurfaces.filter((surface) =>
    [surface.from, surface.to].every(
      (p) =>
        p.x >= x0 * G - 0.5 && p.x <= x1 * G + 0.5 && p.y >= y0 * G - 0.5 && p.y <= y1 * G + 0.5
    )
  );
// The hand test (captures state-2026-11-23T09-20-15-314Z, 09-57-13-507Z): W3.2 (35 mm inside, 30
// outside) dragged 0.752 down, then up to y 2.05; W3 15 mm.
const handTest =
  (up) =>
  ({ apply, faceOf }) => {
    setPlaster(apply, faceOf('W3'), false, 0.015);
    setPlaster(apply, faceOf('W3.2'), false, 0.035);
    setPlaster(apply, faceOf('W3.2'), true, 0.03);
    apply({ type: 'resize_face', faceId: faceOf('W3.2'), distance: 0.752 });
    if (up) apply({ type: 'resize_face', faceId: faceOf('W3.2'), distance: -1.702 });
  };

test('a cap continues the row in line with it; a leftover row keeps its own plaster', () => {
  const t = plan(handTest(false));
  assertCovered(t.snapshot);
  const bedroom = t.snapshot.rooms[0].id;
  // The cap from (2.8, 3) to (2.8, 3.2) has no row: it continues the return below it, in line.
  const cap = within(t.snapshot, 2.8, 3, 2.8, 3.2).filter((s) => s.roomId === bedroom);
  const ret = within(t.snapshot, 2.8, 3.2, 2.8, 3.752).filter((s) => s.roomId === bedroom);
  assert.equal(cap.length, 1);
  assert.equal(cap[0].own, false);
  assert.equal(cap[0].sideId, ret[0].sideId);
  // The 20 cm left at y 3 is a row of its own today, with W3.2's copied plaster (true to the
  // record; leftovers are a later core unit).
  const leftover = within(t.snapshot, 2.8, 3, 3, 3).filter((s) => s.roomId === bedroom);
  assert.equal(leftover.length, 1);
  assert.equal(leftover[0].own, true);
  assert.equal(leftover[0].thickness, 0.035);
  t.controller.dispose();
});

test("a wall's exposed end takes the outside face round its corner", () => {
  const t = plan(handTest(true));
  assertCovered(t.snapshot);
  // The return's band ends at y 3.2 over open ground: no side of its own, an outside face's.
  const end = within(t.snapshot, 2.6, 3.2, 2.8, 3.2);
  assert.equal(end.length, 1);
  assert.equal(end[0].roomId, null, 'an outside face');
  assert.equal(end[0].own, false);
  assert.ok(end[0].sideId);
  t.controller.dispose();
});

test("a free wall's two faces and its ends are surfaces of its room", () => {
  let freeWallIds = new Set();
  const t = plan(({ apply, floor, f }) => {
    const room = floor().rooms[0];
    apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: newFreeWallFace(
        [
          { x: 1, y: 1.5 },
          { x: 3, y: 1.5 },
        ],
        newFreeWallWidth(floor(), room.id, f.meta.properties)
      ),
      values: {},
    });
  });
  const bedroom = t.snapshot.rooms[0].id;
  const free = t.floor.rooms[0].faces.find((face) => face.freePath);
  freeWallIds = new Set([free.wallId]);
  assertCovered(t.snapshot, freeWallIds);
  const faces = t.snapshot.plasterSurfaces.filter((surface) => surface.wallId === free.wallId);
  // Two long faces (one per side), facing into the Bedroom; its two free ends bare (no owner, no
  // plaster: 2b hand test, 2026-11-23).
  const long = faces.filter((surface) => Math.abs(length(surface) - 2 * G) < 0.5);
  assert.equal(long.length, 2);
  assert.equal(new Set(long.map((s) => s.sideId)).size, 2);
  assert.ok(long.every((surface) => surface.own && surface.roomId === bedroom));
  const ends = faces.filter((surface) => !long.includes(surface));
  assert.equal(ends.length, 2);
  assert.ok(ends.every((end) => end.sideId === null && end.thickness === null));
  t.controller.dispose();
});

test('a preview snapshot has its own surfaces, covered as the plan', () => {
  const t = plan();
  const faceId = t.floor.rooms[0].faces.find(
    (face) => t.floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W3.2'
  ).id;
  const proposal = t.controller.previewOperation({
    type: 'resize_face',
    floorId: t.f.floorId,
    faceId,
    distance: 0.5,
  });
  assert.equal(proposal.status, 'ready', JSON.stringify(proposal.issues));
  const preview = t.controller.getSnapshot();
  assert.notDeepEqual(preview.rooms[0].vertices, t.snapshot.rooms[0].vertices);
  assertCovered(preview);
  t.controller.dispose();
});
