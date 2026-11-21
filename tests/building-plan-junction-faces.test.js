import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  expandBuildingPlanSchema,
  writeBuildingPlanRecord,
} from '../src/index.js';
import { createBuildingPlanSnapshot, copyBuildingPlanData } from '../src/building-plan/model.js';
import { buildingPlanFootprints } from '../src/building-plan/footprints.js';
import { buildingPlanCanvasSnapshot } from '../src/building-plan/canvas-controller.js';
import { pointInPolygon } from '../src/building-plan/geometry.js';

// After the 4b hand test (2026-11-21): two rooms meeting at an L of shared walls, as drawn on the
// test page. Room B wraps Room A's corner: A is x 1.6..7 below y 2.6, its top right part raised to
// y 1.63 from x 2.45; B is x 0..2.25 above y 2.4, its left part reaching down to y 5.45 left of
// x 1.4. B's face along its inner corner runs past A's corner by a wall's thickness (20 cm): that
// stretch is a cap (rule F4, no row). Its band is drawn with its wall, the face's highlight runs
// over it, and a room's corner beside a face a few micrometres longer than its wall is filled.

const meta = expandBuildingPlanSchema({
  form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
}).buildingPlanMeta[0];

function junction() {
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: createBuildingPlanSnapshot(),
    properties: meta.properties,
    createId: () => `junction-${++serial}`,
    derivedCommands: true,
    editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
  });
  const floorId = session.apply({
    type: 'create_floor',
    values: { floor_exterior_wall_thickness: 0.2, floor_interior_wall_thickness: 0.2 },
  }).created.id;
  const apply = (operation) => {
    const result = session.apply({ floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    return result;
  };
  const floor = () => session.getSnapshot().floors[0];
  const room = (id) => floor().rooms.find((entry) => entry.id === id);
  /** The row of `roomId` on the edge running along y (or x) = `value`, within `range`. */
  const faceAlong = (roomId, axis, value, test = () => true) => {
    const current = room(roomId);
    const vertex = (id) => current.vertices.find((entry) => entry.id === id);
    return current.faces.find((face) =>
      (face.edgeIds || []).some((edgeId) => {
        const edge = current.edges.find((entry) => entry.id === edgeId);
        const [a, b] = [vertex(edge.startId), vertex(edge.endId)];
        return a[axis] === value && b[axis] === value && test(a, b);
      })
    );
  };
  const a = apply({ type: 'create_room', rectangle: { x: 1.6, y: 2.6, width: 5.4, height: 2.85 } })
    .created.id;
  apply({ type: 'split_face', faceId: faceAlong(a, 'y', 2.6).id, offset: 0.85 });
  const raised = faceAlong(a, 'y', 2.6, (p, q) => Math.min(p.x, q.x) >= 2.44);
  apply({ type: 'resize_face', faceId: raised.id, distance: 0.97 });
  const b = apply({ type: 'create_room', rectangle: { x: 0, y: 0, width: 2.25, height: 2.4 } })
    .created.id;
  const bottom = faceAlong(b, 'y', 2.4, (p, q) => Math.max(p.x, q.x) <= 1.61);
  const edge = room(b).edges.find((entry) => bottom.edgeIds.includes(entry.id));
  const start = room(b).vertices.find((entry) => entry.id === edge.startId);
  apply({ type: 'split_face', faceId: bottom.id, offset: start.x > 1 ? 0.2 : 1.4 });
  const left = faceAlong(b, 'y', 2.4, (p, q) => Math.max(p.x, q.x) <= 1.41);
  apply({ type: 'resize_face', faceId: left.id, distance: 3.05 });
  return { session, apply, floor, room, a, b };
}

const covered = (floor, point) =>
  buildingPlanFootprints(floor, 1)
    .wallFootprints.filter((wall) =>
      wall.polygons.some((polygon) => pointInPolygon(point, polygon, true))
    )
    .map((wall) => floor.walls.find((entry) => entry.id === wall.id)?.autoLabel)
    .sort();

const extents = (t, roomId) => {
  const plan = t.session.getSnapshot();
  const record = writeBuildingPlanRecord({ meta, plan, record: { values: {}, repeatable: {} } });
  const g = 20;
  return buildingPlanCanvasSnapshot({ meta, plan, record, gridSize: g })
    .walls.filter((wall) => wall.roomId === roomId && wall.extentPoints)
    .map((wall) => wall.extentPoints.map(({ x, y }) => [x / g, y / g].map((v) => +v.toFixed(3))));
};

test('a face along an inner corner is highlighted up to the corner, over its cap', () => {
  const t = junction();
  // Each room has an inner corner at the L: B's at (1.4, 2.4), A's at (2.45, 2.6). The faces of
  // the shared walls there run on to it (their rows stop a wall's thickness short).
  assert.deepEqual(extents(t, t.b), [
    [
      [2.25, 2.4],
      [1.4, 2.4],
    ],
    [
      [1.4, 2.4],
      [1.4, 5.45],
    ],
  ]);
  assert.deepEqual(extents(t, t.a), [
    [
      [1.6, 2.6],
      [2.45, 2.6],
    ],
    [
      [2.45, 2.6],
      [2.45, 1.63],
    ],
  ]);
});

test('detached, a room’s inner corner is still built: its caps draw with their walls', () => {
  const t = junction();
  t.apply({ type: 'move_room', roomId: t.a, delta: { x: 1, y: 0 } });
  // B's inner corner square, between its walls along y 2.4 and x 1.4.
  assert.ok(covered(t.floor(), { x: 1.5, y: 2.5 }).length >= 1);
  // A's own inner corner, where its raised part starts (x 3.45, y 2.6): built too.
  assert.ok(covered(t.floor(), { x: 3.35, y: 2.5 }).length >= 1);
});

test('a face a few micrometres longer than its wall still fills its room’s corner', () => {
  const t = junction();
  const floor = copyBuildingPlanData(t.floor());
  const room = floor.rooms.find((entry) => entry.id === t.b);
  // B's corner below the shared wall along x 1.4: its face there made 2 µm longer.
  const corner = room.vertices.find((vertex) => vertex.x === 1.4 && vertex.y === 5.45);
  corner.y += 2e-6;
  const shared = floor.walls.find((wall) =>
    wall.segments.some((segment) => segment.start.x === 1.5 && segment.end.x === 1.5)
  );
  assert.ok(covered(floor, { x: 1.5, y: 5.55 }).includes(shared.autoLabel));
});
