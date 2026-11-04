import {
  GEOMETRY_EPSILON as EPS,
  assignRoomEdges,
  at,
  cross,
  dot,
  polygonEdges,
  project,
  samePoint,
  segmentFrame,
} from './geometry.js';
import {
  buildingPlanSegmentThickness,
  copyBuildingPlanData as copy,
  facesOfWall,
  findFace,
  equalValue,
  planIssue,
  rebindBuildingPlanFaces,
} from './model.js';
import { coalesceFacingRows, normalizeRoomBoundary, remapSubject } from './topology.js';

const fail = (code, message) => {
  throw Object.assign(new Error(message), { issues: [planIssue(code, message)] });
};
const edgesOf = (room, face) =>
  face.freePath
    ? face.freePath.slice(0, -1).map((point, index) => ({
        id: face.freeEdges[index],
        ...segmentFrame(point, face.freePath[index + 1]),
      }))
    : polygonEdges(room);
const compatible = (faces, floor) => {
  if (faces.some((face) => !face) || faces[0].wallId !== faces[1].wallId)
    fail(
      'cut_physical_conflict',
      'These portions belong to separate physical walls. Resolve their physical relationship before rejoining.'
    );
  if (
    !equalValue(faces[0].values, faces[1].values) ||
    !equalValue(faces[0].overrides, faces[1].overrides)
  )
    fail(
      'cut_answer_conflict',
      'The split portions have different room-side answers. Resolve those answers before rejoining.'
    );
  const wall = floor.walls.find((wall) => wall.id === faces[0].wallId);
  const segments = faces.flatMap((face) =>
    face.bindings.map((binding) =>
      wall.segments.find((segment) => segment.id === binding.segmentId)
    )
  );
  if (segments.some((segment) => !equalValue(segment.overrides || {}, segments[0].overrides || {})))
    fail(
      'cut_construction_conflict',
      'These portions have different physical properties. Resolve their thickness or construction overrides before rejoining.'
    );
};

/** Divide selectable faces without dividing their physical construction or measurements. */
export function splitEditingFace(floor, operation, createId) {
  const { room, face, wall } = findFace(floor, operation.faceId);
  const edgeIds = (face.freeEdges || face.edgeIds).filter(
    (id) => !operation.edgeId || operation.edgeId === id
  );
  if (edgeIds.length !== 1) fail('ambiguous_cut', 'Choose one straight wall portion to split.');
  const edge = edgesOf(room, face).find((edge) => edge.id === edgeIds[0]);
  const bindings = face.bindings.filter((binding) => binding.edgeId === edge.id);
  if (!bindings.length)
    fail('uncaptured_cut', 'Capture this straight wall portion before splitting it.');
  const from = Math.min(...bindings.map((binding) => binding.roomInterval[0]));
  const to = Math.max(...bindings.map((binding) => binding.roomInterval[1]));
  const along = from + operation.offset;
  if (!Number.isFinite(along) || along <= from + EPS || along >= to - EPS)
    fail('invalid_cut', 'Choose an interior position on this wall portion.');
  const binding = bindings.find(
    (binding) => along >= binding.roomInterval[0] - EPS && along <= binding.roomInterval[1] + EPS
  );
  const segment = wall.segments.find((segment) => segment.id === binding.segmentId);
  const frame = segmentFrame(segment.start, segment.end);
  const cut = project(frame, at(edge, along)).along;
  if (
    [...wall.doors, ...wall.windows].some(
      (opening) =>
        opening.segmentId === segment.id &&
        opening.offset < cut - EPS &&
        opening.offset + opening.width > cut + EPS
    )
  )
    fail(
      'opening_crosses_cut',
      'This cut crosses a door or window. Choose an opening edge or another position.'
    );
  const cutId = createId();
  let divisions = 0;
  for (const { room: target, face: portion } of facesOfWall(floor, wall.id)) {
    const bound = portion.bindings.find(
      (entry) =>
        entry.segmentId === segment.id &&
        entry.interval[0] < cut - EPS &&
        entry.interval[1] > cut + EPS
    );
    if (!bound) continue;
    divisions++;
    const source = edgesOf(target, portion).find((edge) => edge.id === bound.edgeId);
    const point = at(
      frame,
      cut,
      (bound.side *
        (buildingPlanSegmentThickness(wall, segment) ?? (segment.referenceOffset ?? 0) * 2)) /
        2
    );
    const index = target.vertices.findIndex((vertex) => vertex.id === source.start.id);
    const vertex = { ...point, id: createId(), editingCutId: cutId };
    const origin = portion.lineage?.editingOriginFaceId || portion.id;
    remapSubject(floor, source.id, portion.id, 'room_face');
    if (portion.freePath) {
      if (portion.freePath.length !== 2)
        fail('ambiguous_cut', 'Choose one straight wall portion to split.');
      const next = {
        ...copy(portion),
        id: createId(),
        freePath: [{ ...vertex, id: createId() }, copy(portion.freePath[1])],
        freeEdges: [createId()],
        bindings: [],
        lineage: { ...portion.lineage, editingOriginFaceId: origin },
      };
      portion.freePath = [portion.freePath[0], vertex];
      portion.freeEdges = [createId()];
      portion.lineage = { ...portion.lineage, editingOriginFaceId: origin };
      target.faces.splice(target.faces.indexOf(portion) + 1, 0, next);
      continue;
    }
    const previous = target.edges;
    target.vertices.splice(index + 1, 0, vertex);
    assignRoomEdges(target, createId, previous);
    const left = target.edges.find((edge) => edge.startId === source.start.id);
    const right = target.edges.find((edge) => edge.startId === vertex.id);
    for (const other of target.faces.filter(
      (entry) => entry !== portion && entry.edgeIds?.includes(source.id)
    ))
      other.edgeIds = other.edgeIds.flatMap((id) =>
        id === source.id ? [left.id, right.id] : [id]
      );
    const next = {
      ...copy(portion),
      id: createId(),
      edgeIds: [right.id],
      bindings: [],
      lineage: { ...copy(portion.lineage || {}), editingOriginFaceId: origin },
    };
    portion.edgeIds = [left.id];
    portion.lineage = { ...portion.lineage, editingOriginFaceId: origin };
    target.faces.splice(target.faces.indexOf(portion) + 1, 0, next);
  }
  if (!divisions)
    fail(
      'invalid_cut',
      'This position is already a portion boundary. Choose an interior position.'
    );
  rebindBuildingPlanFaces(floor, createId);
  return { created: { type: 'editing_cut', id: cutId } };
}

/** Explicit cuts are removed only after all linked facing portions agree. */
export function rejoinEditingCut(floor, { cutId }, createId) {
  const targets = floor.rooms.filter((room) => room.vertices.some((v) => v.editingCutId === cutId));
  const freeTargets = floor.rooms.filter((room) =>
    room.faces.some((face) => face.freePath?.some((v) => v.editingCutId === cutId))
  );
  if (!cutId || (!targets.length && !freeTargets.length))
    fail('missing_cut', 'Choose an existing editing cut to rejoin.');
  for (const room of freeTargets) {
    const before = room.faces.find((face) => face.freePath?.at(-1).editingCutId === cutId);
    const after = room.faces.find((face) => face.freePath?.[0].editingCutId === cutId);
    if (
      !before ||
      !after ||
      before === after ||
      !samePoint(before.freePath.at(-1), after.freePath[0])
    )
      fail(
        'cut_not_aligned',
        'Align the split portions on the same straight line before rejoining.'
      );
    compatible([before, after], floor);
    const a = segmentFrame(before.freePath[0], before.freePath.at(-1));
    const b = segmentFrame(after.freePath[0], after.freePath.at(-1));
    if (Math.abs(cross(a.tangent, b.tangent)) > EPS || dot(a.tangent, b.tangent) < 1 - EPS)
      fail(
        'cut_not_aligned',
        'Align the split portions on the same straight line before rejoining.'
      );
    for (const id of [
      before.freePath.at(-1).id,
      after.freePath[0].id,
      ...before.freeEdges,
      ...after.freeEdges,
      after.id,
    ])
      remapSubject(floor, id, before.id, 'room_face');
    before.freePath = [before.freePath[0], after.freePath.at(-1)];
    before.freeEdges = [createId()];
    const wall = floor.walls.find((wall) => wall.id === before.wallId);
    if (wall.referenceFaceId === after.id) wall.referenceFaceId = before.id;
    room.faces = room.faces.filter((face) => face !== after);
  }
  for (const room of targets) {
    const vertices = room.vertices.filter((v) => v.editingCutId === cutId);
    if (vertices.length !== 1)
      fail(
        'cut_not_aligned',
        'Align the split portions on the same straight line before rejoining.'
      );
    const vertex = vertices[0];
    const edges = polygonEdges(room);
    const before = edges.find((edge) => edge.end.id === vertex.id);
    const after = edges.find((edge) => edge.start.id === vertex.id);
    if (
      Math.abs(cross(before.tangent, after.tangent)) > EPS ||
      dot(before.tangent, after.tangent) < 1 - EPS
    )
      fail(
        'cut_not_aligned',
        'Align the split portions on the same straight line before rejoining.'
      );
    const faces = [before, after].map((edge, index) =>
      room.faces.find((face) =>
        face.bindings.some(
          (binding) =>
            binding.edgeId === edge.id &&
            Math.abs(binding.roomInterval[index === 0 ? 1 : 0] - (index === 0 ? edge.length : 0)) <
              EPS
        )
      )
    );
    compatible(faces, floor);
    delete vertex.editingCutId;
    const previous = room.edges;
    normalizeRoomBoundary(floor, room, createId);
    if (room.vertices.some((v) => v.id === vertex.id))
      fail(
        'cut_construction_conflict',
        'A construction division prevents this join. Keep the division or resolve its properties first.'
      );
    remapSubject(floor, vertex.id, faces[0].id, 'room_face');
    for (const edge of previous.filter((edge) => !room.edges.some((entry) => entry.id === edge.id)))
      remapSubject(floor, edge.id, faces[0].id, 'room_face');
  }
  coalesceFacingRows(floor);
  rebindBuildingPlanFaces(floor, createId);
  return {};
}
