import {
  GEOMETRY_EPSILON as EPS,
  add,
  at,
  cleanPoint,
  distance,
  dot,
  samePoint,
  segmentFrame,
  subtract,
} from './geometry.js';
import {
  buildingPlanSegmentThickness,
  copyBuildingPlanData as copy,
  equalValue,
  findFace,
  findWall,
  planIssue,
  rebindBuildingPlanFaces,
} from './model.js';
import { remapSubject } from './topology.js';

function fail(code, message, subject = null, details = {}) {
  throw Object.assign(new Error(message), { issues: [planIssue(code, message, subject, details)] });
}

/** Move a cut partition portion and keep its two neighbouring runs connected atomically. */
export function movePartitionPortion(floor, operation, { createId, splitSegment, finish }) {
  const { room, face, wall } = findFace(floor, operation.faceId);
  if (!face.lineage?.editingOriginFaceId)
    fail('invalid_partition_cut', 'Choose a partition portion created with Split.');
  if (face.lineage?.editingReturn)
    fail('derived_partition_return', 'Move an adjacent partition portion to adjust this return.');
  if (!Array.isArray(operation.vertices) || operation.vertices.length !== 2)
    fail('invalid_partition_edit', 'Choose one straight partition portion to move.');
  const delta = subtract(operation.vertices[0], face.freePath[0]);
  if (!samePoint(add(face.freePath[1], delta), operation.vertices[1]))
    fail(
      'partition_alignment',
      'Keep this split portion parallel while moving it. Rejoin it to reshape the whole partition.'
    );
  if (Math.abs(dot(segmentFrame(...face.freePath).tangent, delta)) > EPS)
    fail(
      'partition_alignment',
      'Move this split portion perpendicular to its wall. Rejoin it to move or reshape the whole partition.'
    );
  if (Math.hypot(delta.x, delta.y) <= EPS) return;
  const before = copy(floor);
  const origin = face.lineage.editingOriginFaceId;
  const affected = new Set([wall]);
  for (const binding of [...face.bindings]) {
    const segment = wall.segments.find((segment) => segment.id === binding.segmentId);
    splitSegment(wall, segment, ...binding.interval, delta, createId);
  }
  face.freePath = face.freePath.map((point) => cleanPoint({ ...point, ...add(point, delta) }));
  const originals = room.faces.filter(
    (entry) =>
      entry.freePath &&
      entry.lineage?.editingOriginFaceId === origin &&
      !entry.lineage.editingReturn
  );
  const sources = new Map(
    originals.flatMap((entry) => entry.freePath.map((point) => [point.id, { face: entry, point }]))
  );
  const returns = room.faces.filter(
    (entry) => entry.lineage?.editingOriginFaceId === origin && entry.lineage.editingReturn
  );
  const linked = new Set();
  for (const entry of returns) {
    const relation = entry.lineage.editingReturn;
    const start = sources.get(relation.startVertexId),
      end = sources.get(relation.endVertexId);
    if (!start || !end || entry.freePath.some((point) => point.editingCutId !== relation.cutId))
      fail(
        'partition_return_cut',
        'Rejoin the explicit cuts on this return before moving its neighbouring portions.'
      );
    linked.add(relation.cutId);
    const host = findWall(floor, entry.wallId);
    const segment = host.segments.find((segment) => segment.id === entry.bindings[0]?.segmentId);
    affected.add(host);
    if (samePoint(start.point, end.point)) {
      const openings = [...host.doors, ...host.windows].filter(
        (opening) => opening.segmentId === segment.id
      );
      if (openings.length)
        fail(
          'opening_crosses_edit_boundary',
          'This edit removes a partition return containing an opening.',
          { type: openings[0].type, id: openings[0].id },
          { openingIds: openings.map((opening) => opening.id) }
        );
      if (
        !equalValue(entry.values, start.face.values) ||
        !equalValue(entry.overrides, start.face.overrides) ||
        !equalValue(host.overrides, findWall(floor, start.face.wallId).overrides) ||
        Object.keys(segment.overrides || {}).length
      )
        fail(
          'partition_return_answers',
          'This return has distinct answers. Resolve them before straightening the partition.'
        );
      room.faces = room.faces.filter((candidate) => candidate !== entry);
      for (const id of [entry.id, ...entry.freePath.map((point) => point.id), ...entry.freeEdges])
        remapSubject(floor, id, start.face.id, 'room_face');
      remapSubject(floor, segment.id, start.face.wallId, 'wall');
      host.segments = host.segments.filter((candidate) => candidate !== segment);
      if (!host.segments.length) {
        remapSubject(floor, host.id, start.face.wallId, 'wall');
        floor.walls = floor.walls.filter((candidate) => candidate !== host);
      } else if (host.referenceFaceId === entry.id) host.referenceFaceId = start.face.id;
      continue;
    }
    const old = copy(segment);
    entry.freePath = [start.point, end.point].map((point, index) =>
      cleanPoint({ ...entry.freePath[index], x: point.x, y: point.y })
    );
    const frame = segmentFrame(...entry.freePath);
    const half =
      (buildingPlanSegmentThickness(host, segment) ?? (segment.referenceOffset ?? 0) * 2) / 2;
    segment.start = at(frame, 0, -half);
    segment.end = at(frame, frame.length, -half);
    for (const opening of [...host.doors, ...host.windows].filter(
      (opening) => opening.segmentId === segment.id
    ))
      if (samePoint(old.end, segment.end))
        opening.offset += frame.length - distance(old.start, old.end);
  }
  for (const start of originals) {
    const point = start.freePath.at(-1),
      cutId = point.editingCutId;
    if (!cutId || linked.has(cutId)) continue;
    const end = originals.find(
      (entry) => entry !== start && entry.freePath[0].editingCutId === cutId
    );
    if (!end || samePoint(point, end.freePath[0])) continue;
    linked.add(cutId);
    const frame = segmentFrame(point, end.freePath[0]);
    const half = (wall.properties.wall_thickness_m ?? wall.segments[0].referenceOffset * 2) / 2;
    const segment = {
      id: createId(),
      start: at(frame, 0, -half),
      end: at(frame, frame.length, -half),
      referenceOffset: half,
      junction: true,
    };
    wall.segments.push(segment);
    room.faces.push({
      id: createId(),
      wallId: wall.id,
      freePath: [point, end.freePath[0]].map((point) => ({ ...copy(point), id: createId() })),
      freeEdges: [createId()],
      bindings: [],
      values: copy(face.values),
      overrides: copy(face.overrides),
      lineage: {
        editingOriginFaceId: origin,
        editingReturn: { cutId, startVertexId: point.id, endVertexId: end.freePath[0].id },
      },
    });
  }
  rebindBuildingPlanFaces(floor, createId);
  finish(
    before,
    [...affected].filter((wall) => floor.walls.includes(wall))
  );
}
