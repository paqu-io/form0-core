import { originalVertices, originalFaces, sharedFaceId } from './helpers/building-plan-v2.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildingPlanExample } from '../examples/building-plan/create-example.js';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
  buildingPlanCanvasSnapshot,
  BuildingPlanCanvasController,
} from '../src/index.js';
import { project, segmentFrame } from '../src/building-plan/geometry.js';

const EPS = 1e-6;
const orientations = [
  { angle: 0, sign: 1 },
  { angle: Math.PI / 2, sign: 1 },
  { angle: 0.37, sign: 1 },
  { angle: -0.61, sign: -1 },
];
function fixture({ angle = 0, sign = 1 } = {}, preserveWallGrouping = false) {
  const f = createBuildingPlanExample();
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const point = ({ x, y, ...rest }) => ({
    ...rest,
    x: sign * x * cos - y * sin,
    y: sign * x * sin + y * cos,
  });
  const inverse = ({ x, y }) => ({ x: sign * (x * cos + y * sin), y: -x * sin + y * cos });
  const snapshot = readBuildingPlanRecord({ meta: f.meta, record: f.record });
  for (const floor of snapshot.floors) {
    for (const room of floor.rooms) {
      room.vertices = room.vertices.map(point);
      for (const face of room.faces) for (const binding of face.bindings) binding.side *= sign;
    }
    for (const wall of floor.walls) {
      for (const side of wall.sides) side.sign *= sign;
      for (const segment of wall.segments) {
        segment.start = point(segment.start);
        segment.end = point(segment.end);
      }
    }
  }
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot,
    properties: f.meta.properties,
    editingPolicy: { preserveWallGrouping },
    createId: () => `junction-${++serial}`,
  });
  const apply = (operation) => {
    const result = session.apply({ floorId: f.floorId, ...operation });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(session.validate(), []);
    return session.getSnapshot();
  };
  const coherent = () => {
    const plan = session.getSnapshot();
    const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan });
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record }), plan);
    assert.deepEqual(plan.floors[0].observations, snapshot.floors[0].observations);
    assert.equal(plan.floors[0].walls.flatMap((w) => w.doors)[0].width, 0.9);
    return buildingPlanCanvasSnapshot({ meta: f.meta, record, plan, gridSize: 1 });
  };
  return { ...f, snapshot, session, apply, coherent, point, inverse };
}

for (const orientation of orientations)
  for (const grouped of [false, true]) {
    for (const [corner, y] of [
      [1, 2.8],
      [0, 3.6],
    ])
      test(`shared diagonal junction ${corner ? 'NE up' : 'NW down'}, angle=${orientation.angle}, reflected=${orientation.sign < 0}, grouped=${grouped}`, () => {
        const f = fixture(orientation, grouped),
          before = f.session.getSnapshot();
        const room = before.floors[0].rooms[1],
          vertex = originalVertices(room)[corner];
        f.apply({
          type: 'move_corner',
          roomId: room.id,
          vertexId: vertex.id,
          point: f.point({ x: corner ? 8 : 3, y }),
        });
        const after = f.session.getSnapshot(),
          next = after.floors[0].rooms[1];
        assert.deepEqual(
          originalVertices(next).filter((v) => v.id !== vertex.id),
          originalVertices(room).filter((v) => v.id !== vertex.id)
        );
        const scene = f.coherent();
        if (!corner) {
          const returns = scene.walls
            .filter((w) => w.roomId === before.floors[0].rooms[0].id)
            .map((w) => w.axisPoints.map(f.inverse))
            .filter(
              (points) =>
                points.length === 2 &&
                Math.abs(points[0].x - points[1].x) < EPS &&
                Math.abs(points[0].x - 2.9) < 0.5 &&
                points.some((p) => p.y > 3.1 && p.y < 3.6)
            );
          assert.equal(returns.length, 1);
          assert.ok(
            Math.abs(returns[0][0].x - 2.9) < EPS,
            'The physical return must continue the west wall axis.'
          );
        }
        f.session.undo();
        assert.deepEqual(f.session.getSnapshot(), before);
        f.session.redo();
        assert.deepEqual(f.session.getSnapshot(), after);
        f.apply({
          type: 'move_corner',
          roomId: room.id,
          vertexId: vertex.id,
          point: { x: vertex.x, y: vertex.y },
        });
        for (const [index, original] of before.floors[0].rooms.entries()) {
          const restored = originalVertices(f.session.getSnapshot().floors[0].rooms[index]);
          assert.deepEqual(
            restored.map((v) => v.id),
            originalVertices(original).map((v) => v.id)
          );
          for (const [i, old] of originalVertices(original).entries())
            assert.ok(Math.hypot(restored[i].x - old.x, restored[i].y - old.y) < EPS);
        }
        f.coherent();
      });

    test(`existing return can reverse after a corner edit, angle=${orientation.angle}, grouped=${grouped}`, () => {
      const f = fixture(orientation, grouped);
      f.apply({ type: 'resize_face', faceId: f.faceB, distance: 1 });
      const room = f.session.getSnapshot().floors[0].rooms[1];
      for (const y of [3.6, 1.8, 2.2]) {
        f.apply({
          type: 'move_corner',
          roomId: room.id,
          vertexId: originalVertices(room)[0].id,
          point: f.point({ x: 3, y }),
        });
        f.coherent();
      }
    });

    for (const corner of [0, 1])
      for (const distance of [-0.3, 0.3])
        test(`a shared diagonal can move after corner ${corner}, distance=${distance}, angle=${orientation.angle}, grouped=${grouped}`, () => {
          const f = fixture(orientation, grouped),
            room = f.snapshot.floors[0].rooms[1];
          f.apply({
            type: 'move_corner',
            roomId: room.id,
            vertexId: originalVertices(room)[corner].id,
            point: f.point({ x: corner ? 8 : 3, y: 2.6 }),
          });
          const beforeMove = f.session.getSnapshot();
          const move = {
            type: 'resize_face',
            floorId: f.floorId,
            faceId: sharedFaceId(beforeMove, f.faceB),
            distance,
          };
          if (distance < 0 && corner === 1) {
            // Only the shared owner moves in v2. Its inward miter would cross
            // the stationary exterior neighbour, so preserve the accepted plan.
            const history = f.session.getState();
            const rejected = f.session.apply(move);
            assert.equal(rejected.status, 'conflict');
            assert.ok(
              rejected.issues.some((issue) =>
                ['wall_clearance_conflict', 'invalid_room_geometry'].includes(issue.code)
              )
            );
            assert.deepEqual(f.session.getSnapshot(), beforeMove);
            assert.deepEqual(f.session.getState(), history);
            f.coherent();
            return;
          }
          f.apply(move);
          const next = f.session.getSnapshot().floors[0].rooms[1];
          assert.ok(Math.abs(f.inverse(originalVertices(next)[0]).x - 3) < EPS);
          assert.ok(Math.abs(f.inverse(originalVertices(next)[1]).x - 8) < EPS);
          f.coherent();
        });
  }

for (const orientation of orientations)
  test(`canvas wall displacement follows the requested direction after rotation/reflection (${orientation.angle}, ${orientation.sign})`, async () => {
    const f = fixture(orientation);
    let record = writeBuildingPlanRecord({
      meta: f.meta,
      record: f.record,
      plan: f.session.getSnapshot(),
    });
    const controller = new BuildingPlanCanvasController({
      meta: f.meta,
      readRecord: () => record,
      writeRecord: (next) => {
        record = next;
      },
    });
    try {
      const wall = controller.getSnapshot().walls.find((w) => w.id === f.faceB);
      const delta = f.point({ x: 0, y: -0.4 });
      assert.ok(
        await controller.updateWall(
          wall.id,
          wall.points.map((p) => ({ x: p.x + delta.x * 20, y: p.y + delta.y * 20 }))
        )
      );
      const room = readBuildingPlanRecord({ meta: f.meta, record }).floors[0].rooms[1];
      assert.ok(Math.abs(f.inverse(originalVertices(room)[0]).y - 2.8) < EPS);
    } finally {
      controller.dispose();
    }
  });

for (const orientation of orientations)
  test(`diagonal body movement holds adjoining supporting lines, angle=${orientation.angle}, reflected=${orientation.sign < 0}`, () => {
    const f = fixture(orientation);
    const room = f.snapshot.floors[0].rooms[1];
    f.apply({
      type: 'move_corner',
      roomId: room.id,
      vertexId: originalVertices(room)[2].id,
      point: f.point({ x: 9, y: 6.2 }),
    });
    const before = f.session.getSnapshot();
    const east = originalFaces(before.floors[0].rooms[1])[1];
    const oldEdge = segmentFrame(
      originalVertices(before.floors[0].rooms[1])[1],
      originalVertices(before.floors[0].rooms[1])[2]
    );
    f.apply({ type: 'resize_face', faceId: east.id, distance: 0.4 });
    const next = f.session.getSnapshot().floors[0].rooms[1];
    assert.ok(Math.abs(f.inverse(originalVertices(next)[1]).y - 3.2) < EPS);
    assert.ok(Math.abs(f.inverse(originalVertices(next)[2]).y - 6.2) < EPS);
    assert.ok(
      Math.abs(
        project(oldEdge, originalVertices(next)[1]).offset -
          project(oldEdge, originalVertices(next)[2]).offset
      ) < EPS
    );
    f.coherent();
  });
