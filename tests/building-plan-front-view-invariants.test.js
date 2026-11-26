import test from 'node:test';
import assert from 'node:assert/strict';
import { writeBuildingPlanRecord } from '../src/index.js';
import { buildingPlanCanvasSnapshot } from '../src/building-plan/canvas-controller.js';
import { buildingPlanFrontView } from '../src/building-plan/front-view.js';
import { buildingPlanRoomSides } from '../src/building-plan/room-sides.js';
import { pointInPolygon, roomBounds } from '../src/building-plan/geometry.js';
import { newFreeWallFace, newFreeWallWidth } from '../src/building-plan/free-wall-lines.js';
import { applied, example } from './helpers/building-plan-bands.js';

// A1 (decided 2026-11-25): every wall row's front view, checked as invariants over plans. Per
// room: one fit; the pieces cover the view end to end, the shown ones the row's whole length;
// every door, window, wall beam and band the canvas puts on the row is in its view, inside one of
// the row's pieces and within the fit, as are the columns and room beams against it (2026-11-26); the levels rise from the floor; walls of unknown height
// share one drawn height, above every level.

const EPS = 1e-6;
const near = (a, b) => Math.abs(a - b) < EPS;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const POLICY = {
  inheritedChangePolicy: 'apply',
  thicknessAnchor: 'room_face',
  sharedWallDrag: 'widen',
};

const faceOf = (t, label) =>
  t.floor().rooms[0].faces.find((face) => face.wallId === t.wall(label).id).id;
const bands = (t) => {
  for (const kind of ['ring', 'lintel', 'sill']) applied(t.answer(kind));
};
const freeWall = (t) => {
  const room = t.floor().rooms[0];
  applied(
    t.apply({
      type: 'create_wall',
      roomId: room.id,
      vertices: newFreeWallFace(
        [
          { x: 1, y: 1.5 },
          { x: 3, y: 1.5 },
        ],
        newFreeWallWidth(t.floor(), room.id, t.f.meta.properties)
      ),
      values: {},
    })
  );
};
const beam = (t, label, offset, length, underside) =>
  applied(
    t.apply({
      type: 'create_opening',
      kind: 'beam',
      wallId: t.wall(label).id,
      offset,
      length,
      depth: 0.25,
      underside,
    })
  );

const plans = {
  'the example': () => {},
  'bands, windows on W1 and W4': (t) => {
    bands(t);
    applied(t.window('W1', 1.9, 0.9, 1.2, 'W#1'));
    applied(t.window('W4', 0.5, 0.9, 1.2, 'W#2'));
  },
  "a beam over the Shared door, W3.2's own band": (t) => {
    beam(t, 'W3', 0.35, 1.2, 2);
    beam(t, 'W3.2', 0, 3, 2.7);
  },
  'the lintel band into the Shared door': (t) => {
    applied(t.answer('lintel'));
    applied(t.keep(t.floorValues({ floor_lintel_band_distance_from_floor: 1.9 })));
  },
  'the lintel band above every wall but W1': (t) => {
    applied(t.answer('lintel'));
    applied(t.edit('W1', 'lintel', { underside: 2.5 }));
    applied(t.floorValues({ floor_lintel_band_distance_from_floor: 3.4 }));
  },
  'a free wall with bands': (t) => {
    bands(t);
    freeWall(t);
  },
  'W3.2 dragged down, with bands (its leftover a row of its own)': (t) => {
    bands(t);
    applied(t.apply({ type: 'resize_face', faceId: faceOf(t, 'W3.2'), distance: 0.752 }));
  },
  // Up past its line with bands is refused (a ring beam too short), so without.
  'W3.2 dragged down, then up past its line': (t) => {
    applied(t.apply({ type: 'resize_face', faceId: faceOf(t, 'W3.2'), distance: 0.752 }));
    applied(t.apply({ type: 'resize_face', faceId: faceOf(t, 'W3.2'), distance: -1.702 }));
  },
  'W1 split between two windows': (t) => {
    applied(t.window('W1', 3, 0.9, 1.2, 'W#1'));
    applied(t.window('W1', 0.5, 0.9, 1.2, 'W#2'));
    applied(t.apply({ type: 'split_face', faceId: faceOf(t, 'W1'), offset: 2 }));
  },
  "the Bedroom wrapping the other room's corner": (t) => {
    applied(
      t.apply({
        type: 'set_provider',
        nodeKey: 'floors',
        fieldName: 'floor_exterior_wall_thickness',
        property: 'wall_thickness',
        value: 0.5,
      })
    );
    applied(t.apply({ type: 'resize_face', faceId: faceOf(t, 'W3.2'), distance: 3.2 }));
  },
  'an L with a step, a room of its own': (t) => {
    applied(t.apply({ type: 'remove_room', roomId: t.floor().rooms[1].id }));
    applied(t.apply({ type: 'resize_face', faceId: faceOf(t, 'W3.2'), distance: 3 }));
    applied(
      t.apply({
        type: 'create_room',
        attach: false,
        rectangle: { x: 5.6, y: 2.9, width: 2.4, height: 3 },
      })
    );
  },
  'columns and room beams against the walls, a column free in the room': (t) => {
    bands(t);
    const room = t.floor().rooms[0];
    const element = (collection, shape) =>
      applied(
        t.apply({ type: 'create_element', roomId: room.id, collection, element: shape, values: {} })
      );
    element('columns', { position: { x: 1, y: 0.15 }, width: 0.3, height: 0.3 });
    element('columns', { position: { x: 4.85, y: 1.5 }, width: 0.3, height: 0.3 });
    element('columns', { position: { x: 2.5, y: 1.5 }, width: 0.3, height: 0.3 });
    element('beams', { start: { x: 2, y: 0 }, end: { x: 2, y: 3 }, width: 0.2, height: 0.3 });
    element('beams', {
      start: { x: 0.1, y: 0.5 },
      end: { x: 0.1, y: 2.5 },
      width: 0.2,
      height: 0.25,
    });
  },
  'unknown heights, bands and a free wall': (t) => {
    bands(t);
    freeWall(t);
    applied(t.floorValues({ floor_height: null }));
    applied(t.edit('W1', 'lintel', { underside: 2.45 }));
  },
};

/** A row's own length: its pieces on the room's sides, or a free wall's bindings. */
function ownLength(floor, room, face) {
  if (face.freePath)
    return face.bindings.reduce(
      (sum, binding) => sum + binding.interval[1] - binding.interval[0],
      0
    );
  return buildingPlanRoomSides(floor, room, 1)
    .flatMap((side) => side.pieces)
    .filter((piece) => piece.faceId === face.id)
    .reduce(
      (sum, piece) => sum + Math.hypot(piece.to.x - piece.from.x, piece.to.y - piece.from.y),
      0
    );
}

function assertViews(t, plan) {
  const floor = t.floor();
  const thickest = Math.max(...floor.walls.map((wall) => wall.properties.wall_thickness || 0));
  const record = writeBuildingPlanRecord({ meta: t.f.meta, plan: t.session.getSnapshot() });
  const canvas = buildingPlanCanvasSnapshot({
    meta: t.f.meta,
    record,
    plan: t.session.getSnapshot(),
    gridSize: 1,
  });
  for (const room of floor.rooms) {
    const fits = new Set();
    const unknown = new Set();
    for (const face of room.faces) {
      const name = `${plan}: ${room.id} ${face.id}`;
      const v = buildingPlanFrontView(floor, face.id);
      assert.ok(v, name);
      fits.add(JSON.stringify(v.fit));
      assert.ok(v.fit.length >= v.length - EPS, `${name}: fits along`);
      assert.ok(near(v.pieces[0].from, 0) && near(v.pieces.at(-1).to, v.length), `${name}: ends`);
      let shown = 0;
      v.pieces.forEach((piece, k) => {
        assert.ok(piece.to - piece.from > EPS, `${name}: piece ${k} has a length`);
        if (k) assert.ok(near(v.pieces[k - 1].to, piece.from), `${name}: pieces meet`);
        if (piece.shown) assert.equal(piece.faceId, face.id, `${name}: only the row is shown`);
        if (piece.shown) shown += piece.to - piece.from;
        assert.ok(piece.drawnHeight <= v.fit.height + EPS, `${name}: fits in height`);
        if (piece.height === null) unknown.add(piece.drawnHeight);
        else assert.equal(piece.drawnHeight, piece.height, `${name}: drawn as known`);
      });
      assert.ok(near(shown, ownLength(floor, room, face)), `${name}: the whole row shown`);
      v.folds.forEach((x, k) => assert.ok(x > (v.folds[k - 1] ?? 0) && x < v.length, name));
      for (const child of [...v.openings, ...v.beams, ...v.columns, ...v.roomBeams]) {
        assert.ok(child.from < child.to && child.bottom < child.top, `${name}: ${child.subjectId}`);
        assert.ok(
          v.pieces.some(
            (piece) =>
              piece.faceId === child.faceId &&
              piece.from - EPS <= child.from &&
              child.to <= piece.to + EPS
          ),
          `${name}: ${child.subjectId} inside its row`
        );
        assert.ok(child.top <= v.fit.height + EPS, `${name}: ${child.subjectId} fits`);
      }
      v.columns.forEach((column) => assert.equal(column.bottom, 0, `${name}: from the floor`));
      // From the floor (a band below it, a problem, starts lower).
      assert.ok(v.levels.includes(0) && v.levels[0] <= 0, name);
      v.levels.forEach(
        (level, k) => k && assert.ok(level > v.levels[k - 1], `${name}: levels rise`)
      );
      assert.ok(v.levels.at(-1) <= v.fit.height + EPS, `${name}: levels fit`);
      const own = v.pieces.find((piece) => piece.shown);
      if (own.height === null)
        assert.ok(
          v.levels.every((level) => level < own.drawnHeight),
          `${name}: above its levels`
        );
      const { map } = v;
      const box = roomBounds(room);
      const onFloor = (point) => pointInPolygon(point, room.vertices, true);
      assert.ok(onFloor(map.eye) && map.cone.length >= 3, `${name}: the eye and cone`);
      assert.ok(map.cone.every(onFloor), `${name}: the cone on the floor`);
      assert.ok(map.sideCone.every(onFloor), `${name}: the side cone on the floor`);
      const whole = v.pieces.every((piece) => piece.shown);
      assert.equal(map.sideCone.length === 0, whole, `${name}: a side cone for other rows`);
      assert.deepEqual(map.zero, map.shown[0][0], `${name}: from its 0 end`);
      const drawn = map.shown.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
      assert.ok(near(drawn, shown), `${name}: the row shown whole on the map`);
      for (const point of map.walls.flat())
        assert.ok(
          point.x >= box.x - thickest - EPS &&
            point.x <= box.x + box.width + thickest + EPS &&
            point.y >= box.y - thickest - EPS &&
            point.y <= box.y + box.height + thickest + EPS,
          `${name}: walls kept to the room`
        );
      // What the canvas draws on this row is in its view, as long along it.
      for (const opening of [...canvas.doors, ...canvas.windows]) {
        if (opening.wallId !== face.id || !finite(opening.height)) continue;
        const found = v.openings.find((entry) => entry.subjectId === opening.subjectId);
        assert.ok(found && found.faceId === face.id, `${name}: ${opening.subjectId} in view`);
        assert.ok(near(found.to - found.from, opening.width), `${name}: ${opening.subjectId}`);
      }
      for (const entry of canvas.wallBeams) {
        if (entry.wallId !== face.id || !finite(entry.underside) || !finite(entry.depth)) continue;
        const found = v.beams.find(
          (item) => item.subjectId === entry.subjectId && item.faceId === face.id
        );
        assert.ok(found, `${name}: ${entry.subjectId} in view`);
        assert.ok(near(found.bottom, entry.underside), `${name}: ${entry.subjectId}'s height`);
      }
    }
    assert.equal(fits.size, 1, `${plan}: one fit for ${room.id}`);
    assert.ok(unknown.size <= 1, `${plan}: one drawn height for ${room.id}'s unknown walls`);
  }
}

test('every wall row has a front view that keeps the invariants', () => {
  for (const [name, steps] of Object.entries(plans)) {
    const t = example(POLICY);
    steps(t);
    assertViews(t, name);
  }
});
