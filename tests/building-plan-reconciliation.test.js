import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  expandBuildingPlanSchema,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from '../src/index.js';
import {
  cleanPoint,
  polygonArea,
  polygonEdges,
  polygonIssue,
  project,
  segmentFrame,
} from '../src/building-plan/geometry.js';
import { buildingPlanBoundaryClearanceIssues } from '../src/building-plan/footprints.js';
import { isolateBuildingPlanContact } from '../src/building-plan/physical-pieces.js';
import { findFace, rebindBuildingPlanFaces } from '../src/building-plan/model.js';

function fixture(exterior = 0.5, interior = 0.2) {
  const meta = expandBuildingPlanSchema({
    form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
  }).buildingPlanMeta[0];
  let serial = 0;
  const session = (snapshot) =>
    createBuildingPlanSession({
      snapshot,
      properties: meta.properties,
      createId: () => `reconciliation-${++serial}`,
      editingPolicy: { inheritedChangePolicy: 'apply', copyCustomAnswersAutomatically: true },
    });
  const domain = session();
  const apply = (operation, target = domain) => {
    const result = target.apply(operation);
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(target.validate(), []);
    for (const floor of target.getSnapshot().floors) {
      assert.deepEqual(buildingPlanBoundaryClearanceIssues(floor), []);
      for (const room of floor.rooms) assert.equal(polygonIssue(room.vertices), null);
    }
    return result;
  };
  const floorId = apply({
    type: 'create_floor',
    values: { floor_exterior_wall_thickness: 0.2, floor_interior_wall_thickness: 0.2 },
  }).created.id;
  for (const rectangle of [
    { x: 0, y: 0, width: 5, height: 3 },
    { x: 3, y: 3.2, width: 5, height: 3 },
  ])
    apply({ type: 'create_room', floorId, rectangle });
  const floor = domain.getSnapshot().floors[0];
  const roomId = floor.rooms[0].id;
  const sharedFaceId = floor.rooms[0].faces[2].id;
  const eastFaceId = floor.rooms[0].faces[1].id;
  apply({
    type: 'bind_faces',
    floorId,
    referenceFaceId: sharedFaceId,
    faceId: floor.rooms[1].faces[0].id,
  });
  apply({
    type: 'batch',
    operations: [
      ['exterior', exterior],
      ['interior', interior],
    ].map(([name, value]) => ({
      type: 'set_provider',
      floorId,
      nodeKey: 'floors',
      fieldName: `floor_${name}_wall_thickness`,
      property: 'wall_thickness',
      value,
    })),
  });
  const move = (faceId, distance, target = domain) =>
    apply({ type: 'resize_face', floorId, faceId, distance }, target);
  return { domain, session, apply, floorId, roomId, sharedFaceId, eastFaceId, move, meta };
}

for (const [exterior, interior] of [
  [0.2, 0.2],
  [0.5, 0.2],
  [0.2, 0.5],
  [0.5, 0.5],
])
  test(`shared-wall return reconciles automatic shoulders (${exterior}/${interior})`, () => {
    const f = fixture(exterior, interior);
    const before = f.domain.getSnapshot();
    f.move(f.sharedFaceId, -0.3);
    f.move(f.sharedFaceId, 0.3);
    for (const previous of before.floors[0].rooms) {
      const room = f.domain.getSnapshot().floors[0].rooms.find((entry) => entry.id === previous.id);
      assert.ok(Math.abs(polygonArea(room.vertices) - polygonArea(previous.vertices)) < 1e-6);
    }
  });

test('shared-wall fitting uses the selected room independently of room collection order', () => {
  const f = fixture();
  const initial = f.domain.getSnapshot();
  const reordered = structuredClone(initial);
  reordered.floors[0].rooms.reverse();
  const other = f.session(reordered);
  f.move(f.sharedFaceId, -0.3);
  f.move(f.sharedFaceId, -0.3, other);
  const outlines = (domain) =>
    Object.fromEntries(
      domain
        .getSnapshot()
        .floors[0].rooms.map((room) => [room.id, room.vertices.map(({ x, y }) => [x, y])])
    );
  assert.deepEqual(outlines(other), outlines(f.domain));
});

// The same prepared state and final move passed core a3a830a's geometry and clearance checks.
// Keep this as an expected-behavior test without loading another checkout at runtime.
test('extending shared coverage does not make an intermediate contact invalidate the edit', () => {
  const f = fixture();
  f.move(f.sharedFaceId, 1);
  f.move(f.eastFaceId, 3.2);
  const before = f.domain.getSnapshot();
  f.move(f.sharedFaceId, 0.5);
  const after = f.domain.getSnapshot();
  const room = after.floors[0].rooms.find((entry) => entry.id === f.roomId);
  assert.ok(room.vertices.some((vertex) => Math.abs(vertex.y - 4.5) < 1e-6));
  assert.equal(f.domain.undo().status, 'undone');
  assert.deepEqual(f.domain.getSnapshot(), before);
  assert.equal(f.domain.redo().status, 'redone');
  assert.deepEqual(f.domain.getSnapshot(), after);
});

for (const [exterior, interior] of [
  [0.5, 0.2],
  [0.2, 0.5],
])
  test(`a reflected diagonal shared wall returns without moving far corners (${exterior}/${interior})`, () => {
    const f = fixture(exterior, interior);
    const snapshot = f.domain.getSnapshot();
    const point = ({ x, y, ...rest }) =>
      cleanPoint({
        ...rest,
        x: -x * Math.cos(0.37) - y * Math.sin(0.37),
        y: -x * Math.sin(0.37) + y * Math.cos(0.37),
      });
    for (const floor of snapshot.floors) {
      for (const room of floor.rooms) {
        room.vertices = room.vertices.map(point);
        for (const edge of room.edges) if (edge.profile) edge.profile.sideSign *= -1;
        for (const face of room.faces) for (const binding of face.bindings) binding.side *= -1;
      }
      for (const wall of floor.walls) {
        for (const side of wall.sides) side.sign *= -1;
        for (const span of wall.segments) {
          span.start = point(span.start);
          span.end = point(span.end);
        }
      }
    }
    const domain = f.session(snapshot);
    f.move(f.sharedFaceId, -0.3, domain);
    f.move(f.sharedFaceId, 0.3, domain);
    for (const previous of snapshot.floors[0].rooms) {
      const room = domain.getSnapshot().floors[0].rooms.find((entry) => entry.id === previous.id);
      assert.ok(Math.abs(polygonArea(room.vertices) - polygonArea(previous.vertices)) < 1e-6);
      for (const corner of previous.vertices.filter((vertex) => !vertex.physicalBoundaryId)) {
        const current = room.vertices.find((vertex) => vertex.id === corner.id);
        assert.ok(current);
        assert.ok(Math.hypot(current.x - corner.x, current.y - corner.y) < 1e-6);
      }
    }
  });

test('changing the floor thickness after a jog uses the same reconciliation as a provider-first edit', () => {
  const f = fixture(0.2, 0.2);
  f.move(f.sharedFaceId, -0.3);
  f.apply({
    type: 'set_provider',
    floorId: f.floorId,
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness',
    value: 0.5,
  });
  f.move(f.sharedFaceId, 0.3);
  for (const room of f.domain.getSnapshot().floors[0].rooms)
    assert.ok(Math.abs(polygonArea(room.vertices) - 15) < 1e-6);
});

for (const decision of ['apply', 'preserve', 'cancel'])
  test(`shared-wall reconciliation stays atomic through a managed ${decision} decision`, () => {
    const f = fixture();
    f.domain.setEditingPolicy({ inheritedChangePolicy: 'ask' });
    const before = f.domain.getSnapshot();
    const history = f.domain.getState();
    let result = f.domain.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.sharedFaceId,
      distance: -0.3,
    });
    assert.equal(result.status, 'pending');
    assert.deepEqual(f.domain.getSnapshot(), before);
    for (let question = 0; result.status === 'pending' && question < 4; question++)
      result = f.domain.resolveUIRequest(result.uiOperations[0].params.requestId, {
        value: decision,
      });
    if (decision === 'cancel') {
      assert.equal(result.status, 'unchanged');
      assert.deepEqual(f.domain.getSnapshot(), before);
      assert.deepEqual(f.domain.getState(), history);
      return;
    }
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    assert.deepEqual(f.domain.validate(), []);
    assert.deepEqual(buildingPlanBoundaryClearanceIssues(f.domain.getSnapshot().floors[0]), []);
    assert.equal(f.domain.getSnapshot().floors[0].values.floor_exterior_wall_thickness, 0.5);
    assert.equal(f.domain.undo().status, 'undone');
    assert.deepEqual(f.domain.getSnapshot(), before);
    assert.equal(f.domain.redo().status, 'redone');
  });

for (const [exterior, interior] of [
  [0.5, 0.2],
  [0.2, 0.5],
])
  test(`Keep previous values protects distinct thickness answers on return (${exterior}/${interior})`, () => {
    const f = fixture(exterior, interior);
    f.domain.setEditingPolicy({ inheritedChangePolicy: 'ask' });
    let result = f.domain.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.sharedFaceId,
      distance: -0.3,
    });
    assert.equal(result.status, 'pending');
    for (let question = 0; result.status === 'pending' && question < 4; question++)
      result = f.domain.resolveUIRequest(result.uiOperations[0].params.requestId, {
        value: 'preserve',
      });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const before = f.domain.getSnapshot(),
      history = f.domain.getState();
    assert.ok(before.floors[0].walls.some((wall) => Object.keys(wall.overrides || {}).length));
    result = f.domain.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: f.sharedFaceId,
      distance: 0.3,
    });
    assert.equal(result.status, 'conflict');
    assert.match(result.issues[0].message, /distinct accepted answers/);
    assert.deepEqual(f.domain.getSnapshot(), before);
    assert.deepEqual(f.domain.getState(), history);
    assert.equal(f.domain.undo().status, 'undone');
  });

test('automatic return cleanup preserves distinct answers by rejecting their retirement', () => {
  const f = fixture();
  f.move(f.sharedFaceId, -0.3);
  const floor = f.domain.getSnapshot().floors[0];
  const returning = floor.walls.find(
    (wall) => wall.exposure === 'interior' && wall.segments[0].start.x === wall.segments[0].end.x
  );
  assert.ok(returning);
  f.apply({
    type: 'set_values',
    floorId: f.floorId,
    wallId: returning.id,
    values: { survey_note: 'Keep this distinct construction answer' },
  });
  const before = f.domain.getSnapshot();
  const result = f.domain.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: f.sharedFaceId,
    distance: 0.3,
  });
  assert.equal(result.status, 'conflict');
  assert.deepEqual(f.domain.getSnapshot(), before);
});

test('automatic exterior stations retire after expansion and return at the default thickness', () => {
  const f = fixture(0.2, 0.2);
  f.move(f.eastFaceId, 4);
  f.move(f.eastFaceId, -4);
  const room = f.domain.getSnapshot().floors[0].rooms.find((entry) => entry.id === f.roomId);
  assert.ok(
    !room.vertices.some(
      (vertex) => Math.abs(vertex.x - 5) < 1e-6 && vertex.y > 1e-6 && vertex.y < 3 - 1e-6
    )
  );
});

for (const distance of [2.9, 3, 3.1, 3.2])
  test(`an exterior portion returns across an interior-500 junction (${distance})`, () => {
    const f = fixture(0.2, 0.5);
    const initial = f.domain.getSnapshot();
    const floor = initial.floors[0];
    const face = floor.rooms[1].faces.find(
      (entry) => floor.walls.find((wall) => wall.id === entry.wallId).autoLabel === 'W3.1'
    );
    assert.ok(face);
    const original = polygonEdges(floor.rooms[1]).find((edge) => face.edgeIds.includes(edge.id));
    const line = segmentFrame(original.start, original.end);
    f.move(face.id, distance);
    const incidentId = floor.rooms[0].vertices.find((point) => point.x === 5 && point.y === 3).id;
    const incident = f.domain
      .getSnapshot()
      .floors[0].rooms[0].vertices.find((point) => point.id === incidentId);
    assert.ok(Math.abs(incident.x - 4.7) < 1e-6, 'The active-room anchor fits the opposite face.');
    f.move(face.id, -distance);
    const accepted = f.domain.getSnapshot().floors[0];
    const room = accepted.rooms.find((entry) => entry.id === floor.rooms[1].id);
    const selected = room.faces.find((entry) => entry.id === face.id);
    assert.ok(selected);
    for (const edge of polygonEdges(room).filter((edge) => selected.edgeIds.includes(edge.id))) {
      assert.ok(Math.abs(project(line, edge.start).offset) < 1e-6);
      assert.ok(Math.abs(project(line, edge.end).offset) < 1e-6);
    }
    // Contact changes fit the other incident faces according to their thickness
    // anchor. The selected line returns; the opposite, uninvolved corners stay fixed.
    for (const previous of floor.rooms)
      for (const corner of previous.vertices.filter((point) => point.x === 0 || point.y === 6.2)) {
        const current = accepted.rooms
          .find((entry) => entry.id === previous.id)
          .vertices.find((point) => point.id === corner.id);
        assert.deepEqual(current, corner);
      }
  });

test('settled geometry and identities remain unchanged by a same-value provider edit', () => {
  const f = fixture();
  f.move(f.sharedFaceId, -0.3);
  const before = f.domain.getSnapshot();
  const result = f.apply({
    type: 'set_provider',
    floorId: f.floorId,
    nodeKey: 'floors',
    fieldName: 'floor_exterior_wall_thickness',
    property: 'wall_thickness',
    value: 0.5,
  });
  assert.deepEqual(result.changes, []);
  assert.deepEqual(f.domain.getSnapshot(), before);
});

test('an invalid new selection retires the preceding managed geometry question', () => {
  const f = fixture();
  f.domain.setEditingPolicy({ inheritedChangePolicy: 'ask' });
  const before = f.domain.getSnapshot();
  const pending = f.domain.apply({
    type: 'resize_face',
    floorId: f.floorId,
    faceId: f.sharedFaceId,
    distance: -0.3,
  });
  assert.equal(pending.status, 'pending');
  assert.equal(
    f.domain.preview({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: 'missing-face',
      distance: 1,
    }).status,
    'conflict'
  );
  const stale = f.domain.resolveUIRequest(pending.uiOperations[0].params.requestId, {
    value: 'apply',
  });
  assert.equal(stale.status, 'conflict');
  assert.deepEqual(f.domain.getSnapshot(), before);
});

for (const [exterior, interior] of [
  [0.2, 0.2],
  [0.5, 0.2],
  [0.5, 0.5],
])
  test(`an exterior south portion remains editable after accepting new defaults (${exterior}/${interior})`, () => {
    const f = fixture(exterior, interior);
    const initial = f.domain.getSnapshot();
    const room = initial.floors[0].rooms[0];
    const face = room.faces.find((face) => {
      if (face.id === f.sharedFaceId) return false;
      return face.edgeIds.some((id) => {
        const edge = polygonEdges(room).find((edge) => edge.id === id);
        return edge.start.y === 3 && edge.end.y === 3;
      });
    });
    assert.ok(face, 'The selected portion is the unshared south wall.');
    f.domain.setEditingPolicy({ inheritedChangePolicy: 'ask' });
    for (const distance of [0.3, 0.3, -0.1]) {
      let result = f.domain.apply({
        type: 'resize_face',
        floorId: f.floorId,
        faceId: face.id,
        distance,
      });
      for (let question = 0; result.status === 'pending' && question < 4; question++)
        result = f.domain.resolveUIRequest(result.uiOperations[0].params.requestId, {
          value: 'apply',
        });
      assert.equal(result.status, 'applied', JSON.stringify(result.issues));
      assert.deepEqual(f.domain.validate(), []);
      assert.deepEqual(buildingPlanBoundaryClearanceIssues(f.domain.getSnapshot().floors[0]), []);
    }
    const selected = f.domain.getSnapshot().floors[0].rooms[0];
    assert.ok(
      selected.vertices.some((point) => Math.abs(point.x) < 1e-7 && Math.abs(point.y - 3.5) < 1e-7)
    );
    assert.ok(
      selected.vertices.some((point) => Math.abs(point.x - 5) < 1e-7 && Math.abs(point.y) < 1e-7)
    );
  });

for (const firstDistance of [0.3, 1.8728])
  for (const [angle, sign] of [
    [0, 1],
    [0.37, -1],
  ])
    test(`reediting a south exterior junction does not accumulate cap corners (${firstDistance}, ${angle}, ${sign})`, () => {
      const f = fixture();
      const initial = f.domain.getSnapshot();
      const originalRoom = initial.floors[0].rooms[0];
      const fixedIds = new Set(
        [
          ...originalRoom.vertices.filter((vertex) => vertex.y === 0),
          ...initial.floors[0].rooms[1].vertices.filter(
            (vertex) => vertex.x === 8 || vertex.y === 6.2
          ),
        ].map((vertex) => vertex.id)
      );
      const south = originalRoom.faces.find(
        (face) =>
          face.id !== f.sharedFaceId &&
          face.edgeIds.some((id) => {
            const edge = polygonEdges(originalRoom).find((edge) => edge.id === id);
            return edge.start.y === 3 && edge.end.y === 3;
          })
      );
      const transform = ({ x, y, ...rest }) =>
        cleanPoint({
          ...rest,
          x: sign * x * Math.cos(angle) - y * Math.sin(angle),
          y: sign * x * Math.sin(angle) + y * Math.cos(angle),
        });
      for (const floor of initial.floors) {
        for (const room of floor.rooms) {
          room.vertices = room.vertices.map(transform);
          for (const edge of room.edges) if (edge.profile) edge.profile.sideSign *= sign;
          for (const face of room.faces) for (const binding of face.bindings) binding.side *= sign;
        }
        for (const wall of floor.walls) {
          for (const side of wall.sides) side.sign *= sign;
          for (const segment of wall.segments) {
            segment.start = transform(segment.start);
            segment.end = transform(segment.end);
          }
        }
      }
      const domain = f.session(initial);
      domain.setEditingPolicy({ inheritedChangePolicy: 'ask' });
      const move = (target, distance, expectedBends = 6) => {
        let result = target.apply({
          type: 'resize_face',
          floorId: f.floorId,
          faceId: south.id,
          distance,
        });
        for (let question = 0; result.status === 'pending' && question < 4; question++)
          result = target.resolveUIRequest(result.uiOperations[0].params.requestId, {
            value: 'apply',
          });
        assert.equal(result.status, 'applied', JSON.stringify(result.issues));
        assert.deepEqual(target.validate(), []);
        const floor = target.getSnapshot().floors[0];
        assert.deepEqual(buildingPlanBoundaryClearanceIssues(floor), []);
        for (const room of floor.rooms) {
          const edges = polygonEdges(room);
          const bends = edges.filter((edge, index) => {
            const previous = edges[(index + edges.length - 1) % edges.length];
            return (
              Math.abs(
                previous.tangent.x * edge.tangent.x + previous.tangent.y * edge.tangent.y - 1
              ) > 1e-7
            );
          });
          if (expectedBends === 4 && room.id === initial.floors[0].rooms[0].id)
            assert.equal(bends.length, 4, 'The selected room straightens on a full return.');
          else
            assert.ok(
              bends.length >= 4 && bends.length <= 6,
              'Only the requested L-shaped junction and necessary thickness shoulder remain.'
            );
          const previous = initial.floors[0].rooms.find((entry) => entry.id === room.id);
          for (const fixed of previous.vertices.filter((vertex) => fixedIds.has(vertex.id))) {
            const point = room.vertices.find((vertex) => vertex.id === fixed.id);
            assert.ok(point && Math.hypot(point.x - fixed.x, point.y - fixed.y) < 1e-7);
          }
        }
      };
      move(domain, firstDistance);
      const firstAccepted = domain.getSnapshot();
      // Both directions start from the same accepted first move, as in the user's draft.
      for (const distance of [0.3, -0.1, -0.3]) {
        const branch = f.session(firstAccepted);
        branch.setEditingPolicy({ inheritedChangePolicy: 'ask' });
        move(branch, distance, Math.abs(firstDistance + distance) < 1e-7 ? 4 : 6);
        assert.equal(branch.undo().status, 'undone');
        assert.deepEqual(branch.getSnapshot(), firstAccepted);
      }
    });

for (const firstDistance of [0.3, 1.8728])
  test(`south-junction contact preserves openings and confirms a cut (${firstDistance})`, () => {
    const f = fixture();
    const floor = f.domain.getSnapshot().floors[0];
    const room = floor.rooms[0];
    const south = room.faces.find(
      (face) =>
        face.id !== f.sharedFaceId &&
        face.edgeIds.some((id) => {
          const edge = polygonEdges(room).find((edge) => edge.id === id);
          return edge.start.y === 3 && edge.end.y === 3;
        })
    );
    const west = floor.walls.find((wall) => wall.autoLabel === 'W8');
    const openingId = f.apply({
      type: 'create_opening',
      floorId: f.floorId,
      wallId: west.id,
      kind: 'door',
      offset: 0.5,
      width: 0.8,
      height: 2,
    }).created.id;
    const opening = () =>
      f.domain
        .getSnapshot()
        .floors[0].walls.flatMap((wall) => wall.doors.map((door) => ({ wall, door })))
        .find((entry) => entry.door.id === openingId);
    f.move(south.id, firstDistance);
    const before = f.domain.getSnapshot();
    const previous = opening();
    const result = f.domain.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: south.id,
      distance: 0.3,
    });
    if (firstDistance === 0.3) {
      assert.equal(result.status, 'applied', JSON.stringify(result.issues));
      const accepted = opening();
      assert.equal(accepted.wall.id, previous.wall.id);
      assert.deepEqual(accepted.door, previous.door);
      assert.deepEqual(buildingPlanBoundaryClearanceIssues(f.domain.getSnapshot().floors[0]), []);
    } else {
      assert.equal(result.status, 'conflict');
      assert.equal(result.issues[0].code, 'opening_cut_requires_confirmation');
      assert.deepEqual(result.issues[0].openingIds, [openingId]);
      assert.deepEqual(f.domain.getSnapshot(), before);
      f.apply({
        type: 'resize_face',
        floorId: f.floorId,
        faceId: south.id,
        distance: 0.3,
        removeOpeningIds: [openingId],
      });
      assert.equal(opening(), undefined);
    }
  });

test('contact isolation retains the reference owner after an uncovered leading extension', () => {
  let serial = 0;
  const createId = () => `contact-reference-${++serial}`;
  const session = createBuildingPlanSession({ createId });
  const floorId = session.apply({ type: 'create_floor', defaults: { wall_thickness: 0.2 } }).created
    .id;
  session.apply({ type: 'create_room', floorId, rectangle: { x: 3, y: 3.2, width: 5, height: 3 } });
  const floor = session.getSnapshot().floors[0],
    face = floor.rooms[0].faces[0],
    entry = findFace(floor, face.id);
  const segment = entry.wall.segments[0],
    wallId = entry.wall.id,
    segmentId = segment.id,
    sideId = face.sideId;
  segment.start.x = 0;
  rebindBuildingPlanFaces(floor, createId);
  const selected = isolateBuildingPlanContact(
    floor,
    entry,
    segmentId,
    { start: { x: 3, y: 3.2 }, end: { x: 6, y: 3.2 } },
    createId
  );
  assert.equal(selected.wall.id, wallId);
  assert.equal(selected.contactSegmentId, segmentId);
  assert.equal(selected.face.id, face.id);
  assert.equal(selected.face.sideId, sideId);
});

for (const conflicting of [false, true])
  test(`south-junction contact protects physical inspection records (${conflicting})`, () => {
    const f = fixture(),
      initial = f.domain.getSnapshot().floors[0],
      room = initial.rooms[0];
    const south = room.faces.find(
      (face) =>
        face.id !== f.sharedFaceId &&
        face.edgeIds.some((id) => {
          const edge = polygonEdges(room).find((edge) => edge.id === id);
          return edge.start.y === 3 && edge.end.y === 3;
        })
    );
    f.move(south.id, 1.8728);
    const snapshot = f.domain.getSnapshot(),
      floor = snapshot.floors[0];
    const shared = floor.walls.find(
      (wall) =>
        wall.sides.every((side) => side.roomId) &&
        wall.segments[0].start.x === wall.segments[0].end.x
    );
    const row = {
      id: 'independent-inspection',
      values: { note: 'Retain this accepted survey' },
      repeatable: {},
    };
    shared.repeatable = { inspection: [row] };
    if (conflicting)
      floor.walls.find((wall) => wall.autoLabel === 'W8').repeatable = {
        inspection: [
          {
            id: 'other-inspection',
            values: { note: 'A different accepted survey' },
            repeatable: {},
          },
        ],
      };
    const domain = createBuildingPlanSession({
      snapshot,
      properties: {
        ...f.meta.properties,
        inspection: {
          kind: 'collection',
          property: 'inspection',
          scope: 'physical_wall',
          on_split: 'confirm',
        },
      },
      editingPolicy: { inheritedChangePolicy: 'ask', copyCustomAnswersAutomatically: false },
    });
    const before = domain.getSnapshot();
    const operation = { type: 'resize_face', floorId: f.floorId, faceId: south.id, distance: 0.3 };
    let result = domain.apply(operation);
    if (conflicting) {
      assert.equal(result.status, 'conflict');
      assert.ok(result.issues.some((issue) => issue.code === 'conflicting_wall_records'));
      assert.deepEqual(domain.getSnapshot(), before);
      return;
    }
    assert.equal(result.status, 'pending');
    assert.equal(
      domain.resolveUIRequest(result.uiOperations[0].params.requestId, { value: 'cancel' }).status,
      'unchanged'
    );
    assert.deepEqual(domain.getSnapshot(), before);
    result = domain.apply(operation);
    for (let question = 0; result.status === 'pending' && question < 4; question++)
      result = domain.resolveUIRequest(result.uiOperations[0].params.requestId, { value: 'apply' });
    assert.equal(result.status, 'applied', JSON.stringify(result.issues));
    const rows = domain
      .getSnapshot()
      .floors[0].walls.flatMap((wall) => wall.repeatable?.inspection || []);
    assert.ok(
      rows.some((retained) => retained.id === row.id && retained.values.note === row.values.note)
    );
    assert.equal(domain.undo().status, 'undone');
    assert.deepEqual(domain.getSnapshot(), before);
  });

test('an interior-500 return rejects genuine material overlap independently of gesture history', () => {
  const f = fixture(0.2, 0.5),
    initial = f.domain.getSnapshot();
  const room = initial.floors[0].rooms[0];
  const south = room.faces.find(
    (face) =>
      face.id !== f.sharedFaceId &&
      face.edgeIds.some((id) => {
        const edge = polygonEdges(room).find((edge) => edge.id === id);
        return edge.start.y === 3 && edge.end.y === 3;
      })
  );
  for (const prefix of [[], [0.3]]) {
    const domain = f.session(initial);
    for (const distance of prefix) f.move(south.id, distance, domain);
    const before = domain.getSnapshot();
    const result = domain.apply({
      type: 'resize_face',
      floorId: f.floorId,
      faceId: south.id,
      distance: prefix.length ? 0.3 : 0.6,
    });
    assert.equal(result.status, 'conflict');
    assert.ok(result.issues.some((issue) => issue.code === 'wall_clearance_conflict'));
    assert.deepEqual(domain.getSnapshot(), before);
  }
});

function assertExclusiveFacingCoverage(floor) {
  for (const room of floor.rooms)
    for (let index = 0; index < room.faces.length; index++)
      for (const other of room.faces.slice(index + 1))
        for (const a of room.faces[index].bindings)
          for (const b of other.bindings) {
            if (a.edgeId !== b.edgeId) continue;
            const overlap =
              Math.min(a.roomInterval[1], b.roomInterval[1]) -
              Math.max(a.roomInterval[0], b.roomInterval[0]);
            assert.ok(overlap < 1e-7, 'A room extent cannot acquire overlapping physical owners.');
          }
}

function bendCount(room) {
  const edges = polygonEdges(room);
  return edges.filter(
    (edge, index) =>
      Math.abs(
        edge.tangent.x * edges[(index + 1) % edges.length].tangent.y -
          edge.tangent.y * edges[(index + 1) % edges.length].tangent.x
      ) > 1e-7
  ).length;
}

for (const [exterior, interior] of [
  [0.2, 0.2],
  [0.5, 0.2],
  [0.5, 0.5],
])
  for (const kind of ['split jog', 'west junction'])
    for (const dx of [-0.3, 0.3])
      test(`a ${kind} return moves with its material cap (${exterior}/${interior}, ${dx})`, () => {
        const f = fixture(exterior, interior);
        let floor = f.domain.getSnapshot().floors[0];
        if (kind === 'split jog') {
          f.apply({ type: 'split_face', floorId: f.floorId, faceId: f.sharedFaceId, offset: 1 });
          f.move(f.sharedFaceId, 1.2);
        } else {
          const south = floor.rooms[0].faces.find(
            (face) => floor.walls.find((wall) => wall.id === face.wallId).autoLabel === 'W3.2'
          );
          f.move(south.id, 1.2);
          floor = f.domain.getSnapshot().floors[0];
          const lowerWest = floor.rooms[1].faces.find((face) =>
            polygonEdges(floor.rooms[1]).some(
              (edge) =>
                face.edgeIds.includes(edge.id) &&
                Math.abs(edge.start.x - 3) < 1e-7 &&
                Math.abs(edge.end.x - 3) < 1e-7 &&
                Math.max(edge.start.y, edge.end.y) > 6
            )
          );
          assert.ok(lowerWest);
          f.move(lowerWest.id, 3);
        }
        const before = f.domain.getSnapshot();
        floor = before.floors[0];
        const room = floor.rooms[1];
        const selected = room.faces
          .flatMap((face) =>
            polygonEdges(room)
              .filter(
                (edge) =>
                  face.edgeIds.includes(edge.id) &&
                  Math.abs(edge.tangent.x) < 1e-7 &&
                  edge.length > 0.5 &&
                  edge.length < 2 &&
                  floor.walls.find((wall) => wall.id === face.wallId).exposure === 'interior'
              )
              .map((edge) => ({ face, edge }))
          )
          .sort((a, b) => a.edge.start.x - b.edge.start.x)[0];
        assert.ok(selected, 'The selected return has a shared room-facing run.');
        if (exterior !== interior && kind === 'split jog' && dx > 0) {
          const result = f.domain.apply({
            type: 'resize_face',
            floorId: f.floorId,
            faceId: selected.face.id,
            distance: -dx / selected.edge.normal.x,
          });
          assert.equal(result.status, 'conflict');
          assert.ok(result.issues.some((issue) => issue.code === 'wall_clearance_conflict'));
          assert.deepEqual(f.domain.getSnapshot(), before);
          return;
        }
        f.move(selected.face.id, -dx / selected.edge.normal.x);
        const after = f.domain.getSnapshot();
        const changed = after.floors[0].rooms[1];
        if (exterior === interior)
          assert.equal(bendCount(changed), bendCount(room), 'Moving the return adds no cap notch.');
        else
          assert.ok(
            bendCount(changed) <= bendCount(room) + 2,
            'Different widths can require one additional thickness shoulder.'
          );
        if (exterior === interior)
          assert.ok(
            !changed.vertices.some((point) => Math.abs(point.x - selected.edge.start.x) < 1e-7),
            'The former return line cannot remain as a second wall.'
          );
        else
          assert.ok(
            !polygonEdges(changed).some(
              (edge) =>
                Math.abs(edge.start.x - selected.edge.start.x) < 1e-7 &&
                Math.abs(edge.end.x - selected.edge.start.x) < 1e-7 &&
                edge.length > Math.max(exterior, interior) + 1e-7
            ),
            'A width transition can retain a short cap, not the former longitudinal return.'
          );
        assertExclusiveFacingCoverage(after.floors[0]);
        const restored = readBuildingPlanRecord({
          meta: f.meta,
          record: writeBuildingPlanRecord({ meta: f.meta, plan: after }),
        });
        assert.deepEqual(
          restored.floors[0].rooms.map((entry) => entry.vertices),
          after.floors[0].rooms.map((entry) => entry.vertices)
        );
        assert.equal(f.domain.undo().status, 'undone');
        assert.deepEqual(f.domain.getSnapshot(), before);
        assert.equal(f.domain.redo().status, 'redone');
        assert.deepEqual(f.domain.getSnapshot(), after);
      });

test('a derived cap follows the retained construction answer without owning another row', () => {
  const f = fixture(0.2, 0.2);
  f.apply({ type: 'split_face', floorId: f.floorId, faceId: f.sharedFaceId, offset: 1 });
  f.move(f.sharedFaceId, 1.2);
  let floor = f.domain.getSnapshot().floors[0];
  const room = floor.rooms[1];
  const edges = polygonEdges(room);
  const returning = edges.find(
    (edge) => Math.abs(edge.start.x - 3.8) < 1e-7 && edge.length > 0.5 && edge.length < 2
  );
  const cap = room.edges.find((edge) => edge.startId === returning.end.id);
  assert.ok(cap.profile, 'The supplied cap has a physical source rather than another wall row.');
  const selected = room.faces.find((face) => face.edgeIds.includes(returning.id));
  const sourceId = cap.profile.wallId;
  f.apply({
    type: 'set_values',
    floorId: f.floorId,
    wallId: sourceId,
    values: { survey_note: 'Keep the retained construction answer' },
  });
  const before = f.domain.getSnapshot();
  f.move(selected.id, 0.3);
  floor = f.domain.getSnapshot().floors[0];
  const retained = floor.walls.find((wall) => wall.id === sourceId);
  assert.equal(retained.values.survey_note, 'Keep the retained construction answer');
  assertExclusiveFacingCoverage(floor);
  assert.equal(f.domain.undo().status, 'undone');
  assert.deepEqual(f.domain.getSnapshot(), before);
});
