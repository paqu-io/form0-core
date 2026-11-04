import { GEOMETRY_EPSILON as EPS, segmentFrame } from './geometry.js';
import { equalValue, facesOfWall, findFace, own, rebindBuildingPlanFaces } from './model.js';
import { splitEditingFace } from './editing-cuts.js';

export const usesPortionThickness = (face, property) =>
  property === 'wall_thickness_m' && Boolean(face.lineage?.editingOriginFaceId);

/** One effective physical thickness for the ordinary facing row, with canonical provenance. */
export function portionThicknessState(wall, face) {
  const segments = [...new Set(face.bindings.map((binding) => binding.segmentId))]
    .map((id) => wall.segments.find((segment) => segment.id === id))
    .filter(Boolean);
  const overrides = segments.filter((segment) => own(segment.overrides, 'wall_thickness_m'));
  if (!overrides.length && !usesPortionThickness(face, 'wall_thickness_m')) return null;
  const values = segments.map((segment) =>
    own(segment.overrides, 'wall_thickness_m')
      ? segment.overrides.wall_thickness_m
      : wall.properties.wall_thickness_m
  );
  const mixed = values.some((value) => !equalValue(value, values[0]));
  return {
    value: mixed ? null : (values[0] ?? null),
    mixed,
    source: overrides.length
      ? {
          scope: 'construction_segment',
          id: overrides[0].id,
          ids: overrides.map((segment) => segment.id),
          mode: 'override',
        }
      : { ...wall.provenance?.wall_thickness_m, mode: 'inherit' },
  };
}

/** Delimit a physical span without inventing construction identities or observation answers. */
export function preparePortionThickness(floor, faceId, createId, splitSegment) {
  const { face, wall } = findFace(floor, faceId);
  wall.lineage = { ...wall.lineage, thicknessProfile: true };
  const ranges = new Map();
  const temporaryCuts = new Set();
  for (const binding of face.bindings) {
    const previous = ranges.get(binding.segmentId);
    ranges.set(
      binding.segmentId,
      previous
        ? [Math.min(previous[0], binding.interval[0]), Math.max(previous[1], binding.interval[1])]
        : [...binding.interval]
    );
  }
  // Every room crossing a new property boundary needs an ordinary row with one effective value.
  for (const [segmentId, range] of ranges) {
    const segment = wall.segments.find((entry) => entry.id === segmentId);
    const length = segmentFrame(segment.start, segment.end).length;
    for (const along of range.filter((value) => value > EPS && value < length - EPS)) {
      const crossing = facesOfWall(floor, wall.id).find(({ face }) =>
        face.bindings.some(
          (binding) =>
            binding.segmentId === segmentId &&
            binding.interval[0] < along - EPS &&
            binding.interval[1] > along + EPS
        )
      );
      if (!crossing) continue;
      const binding = crossing.face.bindings.find(
        (binding) =>
          binding.segmentId === segmentId &&
          binding.interval[0] < along - EPS &&
          binding.interval[1] > along + EPS
      );
      const start = Math.min(
        ...crossing.face.bindings
          .filter((entry) => entry.edgeId === binding.edgeId)
          .map((entry) => entry.roomInterval[0])
      );
      const offset =
        binding.roomInterval[0] -
        start +
        (binding.direction > 0 ? along - binding.interval[0] : binding.interval[1] - along);
      const { created } = splitEditingFace(
        floor,
        {
          faceId: crossing.face.id,
          edgeId: binding.edgeId,
          offset,
        },
        createId
      );
      temporaryCuts.add(created.id);
    }
  }
  const selectedIds = [];
  for (const [id, [low, high]] of ranges) {
    const segment = wall.segments.find((entry) => entry.id === id);
    const length = segmentFrame(segment.start, segment.end).length;
    if (low > EPS || high < length - EPS)
      splitSegment(wall, segment, low, high, { x: 0, y: 0 }, createId);
    selectedIds.push(id);
  }
  rebindBuildingPlanFaces(floor, createId);
  return {
    wall,
    segments: wall.segments.filter((segment) => selectedIds.includes(segment.id)),
    releaseCuts() {
      // Hold the stationary side during adjustment, without persisting new user editing cuts.
      for (const room of floor.rooms)
        for (const vertex of [
          ...room.vertices,
          ...room.faces.flatMap((face) => face.freePath || []),
        ])
          if (temporaryCuts.has(vertex.editingCutId)) delete vertex.editingCutId;
    },
  };
}
