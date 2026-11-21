import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanSession, expandBuildingPlanSchema } from '../src/index.js';
import { createBuildingPlanSnapshot } from '../src/building-plan/model.js';
import { buildingPlanFootprints } from '../src/building-plan/footprints.js';

// Web round 2026-11-21: room B, attached east of A and taller, kept a 16 cm strip above A's top
// wall once A's east wall was pushed into it. The cap at the strip's end was banded both ways
// from its edge, so 4 cm of it stood past the strip, in B's top wall, drawn at A's level.
test("a cap's band stands on its face's outer side only", () => {
  const meta = expandBuildingPlanSchema({
    form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
  }).buildingPlanMeta[0];
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: createBuildingPlanSnapshot(),
    properties: meta.properties,
    createId: () => `cap-band-${++serial}`,
    derivedCommands: true,
    editingPolicy: { inheritedChangePolicy: 'apply' },
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
  const roomA = apply({
    type: 'create_room',
    rectangle: { x: 0, y: 0.36, width: 3.53, height: 2.39 },
  }).created.id;
  apply({
    type: 'create_room',
    attach: true,
    attachmentTolerance: 0.25,
    rectangle: { x: 3.73, y: 0, width: 2.87, height: 3.27 },
  });
  const a = session.getSnapshot().floors[0].rooms.find((room) => room.id === roomA);
  const east = a.edges.find((edge) => {
    const [p, q] = [edge.startId, edge.endId].map((id) => a.vertices.find((v) => v.id === id));
    return Math.abs(p.x - 3.53) < 1e-9 && Math.abs(q.x - 3.53) < 1e-9;
  });
  const face = a.faces.find((entry) => entry.edgeIds?.includes(east.id));
  apply({ type: 'resize_face', faceId: face.id, distance: 0.56 });

  const floor = session.getSnapshot().floors[0];
  const { wallFootprints } = buildingPlanFootprints(floor, 1);
  // A's top wall's outer face is at y = 0.16: nothing of a wall bounding A stands above it.
  const above = wallFootprints
    .filter((wall) => wall.roomIds.includes(roomA))
    .flatMap((wall) => wall.polygons)
    .filter((polygon) => polygon.some((point) => point.y < 0.16 - 1e-6));
  assert.deepEqual(above, []);
});
