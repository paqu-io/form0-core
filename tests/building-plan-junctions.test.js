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
    for (const wall of floor.walls)
      for (const segment of wall.segments) {
        segment.start = point(segment.start);
        segment.end = point(segment.end);
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
          vertex = room.vertices[corner];
        f.apply({
          type: 'move_corner',
          roomId: room.id,
          vertexId: vertex.id,
          point: f.point({ x: corner ? 8 : 3, y }),
        });
        const after = f.session.getSnapshot(),
          next = after.floors[0].rooms[1];
        assert.deepEqual(
          next.vertices.filter((v) => v.id !== vertex.id),
          room.vertices.filter((v) => v.id !== vertex.id)
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
          const restored = f.session.getSnapshot().floors[0].rooms[index].vertices;
          assert.deepEqual(
            restored.map((v) => v.id),
            original.vertices.map((v) => v.id)
          );
          for (const [i, old] of original.vertices.entries())
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
          vertexId: room.vertices[0].id,
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
            vertexId: room.vertices[corner].id,
            point: f.point({ x: corner ? 8 : 3, y: 2.6 }),
          });
          f.apply({ type: 'resize_face', faceId: f.faceB, distance });
          const next = f.session.getSnapshot().floors[0].rooms[1];
          assert.ok(Math.abs(f.inverse(next.vertices[0]).x - 3) < EPS);
          assert.ok(Math.abs(f.inverse(next.vertices[1]).x - 8) < EPS);
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
      assert.ok(Math.abs(f.inverse(room.vertices[0]).y - 2.8) < EPS);
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
      vertexId: room.vertices[2].id,
      point: f.point({ x: 9, y: 6.2 }),
    });
    const before = f.session.getSnapshot();
    const east = before.floors[0].rooms[1].faces[1];
    const oldEdge = segmentFrame(
      before.floors[0].rooms[1].vertices[1],
      before.floors[0].rooms[1].vertices[2]
    );
    f.apply({ type: 'resize_face', faceId: east.id, distance: 0.4 });
    const next = f.session.getSnapshot().floors[0].rooms[1];
    assert.ok(Math.abs(f.inverse(next.vertices[1]).y - 3.2) < EPS);
    assert.ok(Math.abs(f.inverse(next.vertices[2]).y - 6.2) < EPS);
    assert.ok(
      Math.abs(
        project(oldEdge, next.vertices[1]).offset - project(oldEdge, next.vertices[2]).offset
      ) < EPS
    );
    f.coherent();
  });
