import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';

// Step 2, 2c (decision A, 2026-11-23): each room's sides in the canvas snapshot, corner to corner,
// with the rows and openings on them, for the room's lengths. Checked as invariants (the sides
// cover the room's outline once, turning at each; each side's pieces cover it end to end once,
// each a row of the room; every row and every door or window of the room is on a side, each
// opening inside one piece) and on the cases the lengths show. The example's Bedroom is 0..5 ×
// 0..3 m, its bottom side W3 (x 5..3, a door 0.9 m at x 4.5..3.6) and W3.2 (x 3..0); walls 20 cm.

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
  const wallOf = (label) => floor().walls.find((wall) => wall.autoLabel === label);
  const faceOf = (label, roomIndex = 0) =>
    floor().rooms[roomIndex].faces.find((face) => face.wallId === wallOf(label).id).id;
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  };
  steps({ apply, faceOf, wallOf, floor, f });
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

const gap = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);
const close = (p, q) => gap(p, q) < 0.5;
const unit = (p, q) => ({ x: (q.x - p.x) / gap(p, q), y: (q.y - p.y) / gap(p, q) });
const cross = (a, b) => a.x * b.y - a.y * b.x;
const offLine = (side, p) =>
  Math.abs(cross(unit(side.start, side.end), { x: p.x - side.start.x, y: p.y - side.start.y }));
const along = (side, p) => {
  const u = unit(side.start, side.end);
  return (p.x - side.start.x) * u.x + (p.y - side.start.y) * u.y;
};

function inside(point, vertices) {
  let result = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i];
    const b = vertices[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}

/** The invariants, on every room of a snapshot. */
function assertSides(snapshot) {
  for (const room of snapshot.rooms) {
    const name = `${room.displayLabel} (${room.id})`;
    const { sides, vertices } = room;
    assert.ok(sides.length >= 3, `${name}: sides`);
    let perimeter = 0;
    vertices.forEach((v, i) => (perimeter += gap(v, vertices[(i + 1) % vertices.length])));
    const total = sides.reduce((sum, side) => sum + gap(side.start, side.end), 0);
    assert.ok(Math.abs(total - perimeter) < 0.5, `${name}: sides ${total}, outline ${perimeter}`);
    const rows = snapshot.walls.filter((wall) => wall.roomId === room.id && !wall.sidePoints);
    const rowIds = new Set(rows.map((wall) => wall.id));
    const seenRows = new Set();
    const seenOpenings = new Map();
    sides.forEach((side, index) => {
      const next = sides[(index + 1) % sides.length];
      assert.ok(close(side.end, next.start), `${name}: side ${index} ends where the next starts`);
      assert.ok(
        Math.abs(cross(unit(side.start, side.end), unit(next.start, next.end))) > 1e-4,
        `${name}: sides ${index} and ${index + 1} turn`
      );
      const middle = { x: (side.start.x + side.end.x) / 2, y: (side.start.y + side.end.y) / 2 };
      const probe = { x: middle.x + side.normal.x, y: middle.y + side.normal.y };
      assert.ok(inside(probe, vertices), `${name}: side ${index}'s normal points into the room`);
      // The pieces cover the side end to end, once, each a row of the room.
      const { pieces } = side;
      assert.ok(pieces.length > 0);
      assert.ok(close(pieces[0].from, side.start), `${name}: side ${index}'s first piece`);
      assert.ok(close(pieces.at(-1).to, side.end), `${name}: side ${index}'s last piece`);
      pieces.forEach((piece, k) => {
        assert.ok(gap(piece.from, piece.to) > 0.5, `${name}: piece ${k} has a length`);
        assert.ok(offLine(side, piece.from) < 0.5 && offLine(side, piece.to) < 0.5);
        assert.ok(
          along(side, piece.to) > along(side, piece.from),
          `${name}: pieces run with the side`
        );
        if (k) assert.ok(close(pieces[k - 1].to, piece.from), `${name}: pieces meet`);
        if (k)
          assert.notEqual(pieces[k - 1].faceId, piece.faceId, `${name}: one piece per row stretch`);
        assert.ok(rowIds.has(piece.faceId), `${name}: piece ${k} is a row of the room`);
        seenRows.add(piece.faceId);
      });
      for (const opening of side.openings) {
        assert.ok(!seenOpenings.has(opening.subjectId), `${name}: an opening on one side`);
        seenOpenings.set(opening.subjectId, opening);
        const [a, b] = [along(side, opening.from), along(side, opening.to)];
        assert.ok(a < b);
        assert.ok(
          pieces.some(
            (piece) => along(side, piece.from) - 0.5 <= a && b <= along(side, piece.to) + 0.5
          ),
          `${name}: opening ${opening.subjectId} inside one piece`
        );
      }
    });
    assert.deepEqual(
      [...rowIds].filter((id) => !seenRows.has(id)),
      [],
      `${name}: every row on a side`
    );
    for (const opening of [...snapshot.doors, ...snapshot.windows].filter(
      (o) => o.roomId === room.id
    )) {
      const found = seenOpenings.get(opening.subjectId);
      assert.ok(found, `${name}: ${opening.subjectId} on a side`);
      assert.ok(Math.abs(gap(found.from, found.to) - opening.width * G) < 0.5);
    }
  }
}

const label = (snapshot, faceId) => snapshot.walls.find((wall) => wall.id === faceId)?.displayLabel;
const sideAt = (room, x0, y0, x1, y1) =>
  room.sides.find(
    (side) =>
      close(side.start, { x: x0 * G, y: y0 * G }) && close(side.end, { x: x1 * G, y: y1 * G })
  );
const pieceLengths = (snapshot, side) =>
  side.pieces.map((piece) => [
    label(snapshot, piece.faceId),
    Math.round(gap(piece.from, piece.to)),
  ]);

test('the example: the sides cover each room once; a side with two rows and a door', () => {
  const t = plan();
  assertSides(t.snapshot);
  const [bedroom, other] = t.snapshot.rooms;
  assert.equal(bedroom.sides.length, 4, 'the vertex at (3, 3) is no corner');
  const bottom = sideAt(bedroom, 5, 3, 0, 3);
  assert.deepEqual(pieceLengths(t.snapshot, bottom), [
    ['W3', 200],
    ['W3.2', 300],
  ]);
  assert.equal(bottom.openings.length, 1);
  assert.equal(bottom.openings[0].kind, 'door');
  assert.deepEqual(
    [along(bottom, bottom.openings[0].from), along(bottom, bottom.openings[0].to)].map(Math.round),
    [50, 140]
  );
  assert.deepEqual(bottom.normal, { x: 0, y: -1 });
  // The other room's top side: W3 and W3.1, the same door seen from below.
  const top = sideAt(other, 3, 3.2, 8, 3.2);
  assert.deepEqual(pieceLengths(t.snapshot, top), [
    ['W3', 200],
    ['W3.1', 300],
  ]);
  assert.deepEqual(
    [along(top, top.openings[0].from), along(top, top.openings[0].to)].map(Math.round),
    [60, 150]
  );
  t.controller.dispose();
});

test("a cap goes to the row it continues: W3's after W3.2's drag down, the return's below it", () => {
  const t = plan(({ apply, faceOf }) =>
    apply({ type: 'resize_face', faceId: faceOf('W3.2'), distance: 0.752 })
  );
  assertSides(t.snapshot);
  const bedroom = t.snapshot.rooms[0];
  // (3, 3) to (2.8, 3) is a cap of W3: one W3 piece 2.2 m long.
  const bottom = sideAt(bedroom, 5, 3, 2.8, 3);
  assert.deepEqual(pieceLengths(t.snapshot, bottom), [['W3', 220]]);
  // (2.8, 3) to (2.8, 3.2) is a cap of the return: one piece with its row.
  const ret = sideAt(bedroom, 2.8, 3, 2.8, 3.752);
  assert.equal(ret.pieces.length, 1);
  assert.equal(Math.round(gap(ret.pieces[0].from, ret.pieces[0].to)), 75);
  t.controller.dispose();
});

const setPlaster = (apply, faceId, thickness) => {
  apply({
    type: 'set_property',
    faceId,
    outside: false,
    property: 'wall_plaster',
    value: plastered,
  });
  apply({
    type: 'set_property',
    faceId,
    outside: false,
    property: 'wall_plaster_thickness',
    value: thickness,
  });
};
// The 2b hand test: W3.2 at 35 mm dragged down (its leftover stays a row), then up past its line.
const handTest =
  (up) =>
  ({ apply, faceOf }) => {
    setPlaster(apply, faceOf('W3'), 0.015);
    setPlaster(apply, faceOf('W3.2'), 0.035);
    apply({ type: 'resize_face', faceId: faceOf('W3.2'), distance: 0.752 });
    if (up) apply({ type: 'resize_face', faceId: faceOf('W3.2'), distance: -1.702 });
  };

test('a leftover row is a piece of its own; down and up keep the invariants', () => {
  const down = plan(handTest(false));
  assertSides(down.snapshot);
  const bottom = sideAt(down.snapshot.rooms[0], 5, 3, 2.8, 3);
  assert.deepEqual(
    bottom.pieces.map((piece) => Math.round(gap(piece.from, piece.to))),
    [200, 20],
    'W3, then the leftover'
  );
  down.controller.dispose();
  const up = plan(handTest(true));
  assertSides(up.snapshot);
  up.controller.dispose();
});

test('a split side has a piece per row; openings in order along the side', () => {
  const t = plan(({ apply, faceOf, wallOf }) => {
    apply({
      type: 'create_opening',
      wallId: wallOf('W1').id,
      kind: 'window',
      offset: 3,
      width: 1.2,
      height: 1.2,
    });
    apply({
      type: 'create_opening',
      wallId: wallOf('W1').id,
      kind: 'window',
      offset: 0.5,
      width: 1,
      height: 1.2,
    });
    apply({ type: 'split_face', faceId: faceOf('W1'), offset: 2 });
  });
  assertSides(t.snapshot);
  const top = sideAt(t.snapshot.rooms[0], 0, 0, 5, 0);
  assert.deepEqual(
    top.pieces.map((piece) => Math.round(gap(piece.from, piece.to))),
    [200, 300]
  );
  assert.deepEqual(
    top.openings.map((opening) =>
      [along(top, opening.from), along(top, opening.to)].map(Math.round)
    ),
    [
      [50, 150],
      [300, 420],
    ]
  );
  t.controller.dispose();
});

test('a preview snapshot has its own sides, covered as the plan', () => {
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
  assertSides(preview);
  assert.ok(
    preview.rooms[0].sides.some(
      (side) => close(side.end, { x: 0, y: 3.5 * G }) && side.start.y === 3.5 * G
    ),
    'the dragged side'
  );
  t.controller.dispose();
});

test('more plans keep the invariants: a free wall, a room wrapping a corner, an L with a step', () => {
  const sequences = {
    // A free wall is room content, no piece of a side.
    'free wall': ({ apply, floor, f }) => {
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
    },
    // Exterior walls 0.5 m, W3.2 dragged 3.2 m down: the Bedroom wraps the other room's corner.
    wrapped: ({ apply, faceOf }) => {
      apply({
        type: 'set_provider',
        nodeKey: 'floors',
        fieldName: 'floor_exterior_wall_thickness',
        property: 'wall_thickness',
        value: 0.5,
      });
      apply({ type: 'resize_face', faceId: faceOf('W3.2'), distance: 3.2 });
    },
    // The other room removed, W3.2 dragged 3 m down: an L whose step (W3) is free, with its door.
    'L with a step': ({ apply, faceOf, floor }) => {
      apply({ type: 'remove_room', roomId: floor().rooms[1].id });
      apply({ type: 'resize_face', faceId: faceOf('W3.2'), distance: 3 });
      apply({
        type: 'create_room',
        attach: false,
        rectangle: { x: 5.6, y: 2.9, width: 2.4, height: 3 },
      });
    },
  };
  for (const [name, steps] of Object.entries(sequences)) {
    const t = plan(steps);
    assert.ok(t.snapshot.rooms[0].sides.length >= 4, name);
    assertSides(t.snapshot);
    t.controller.dispose();
  }
});
