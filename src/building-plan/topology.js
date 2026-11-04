import {
  GEOMETRY_EPSILON as EPS,
  assignRoomEdges,
  cross,
  distance,
  dot,
  subtract,
} from './geometry.js';
import { copyBuildingPlanData as copy, equalValue, facesOfWall, findWall } from './model.js';

export const wallTopologyOrigin = (wall) => wall.lineage?.jogOriginWallId || wall.id;

export function remapSubject(floor, from, to, type) {
  if (from === to) return;
  for (const observation of floor.observations) {
    if (observation.subject?.id === from) {
      observation.sourceSubject ||= copy(observation.subject);
      observation.subject = { type, id: to };
    }
    if (observation.relatedSubjects)
      observation.relatedSubjects = observation.relatedSubjects.map((subject) =>
        subject.id === from ? { type, id: to } : subject
      );
  }
}

/** Remove only geometrically redundant automatic topology, preserving meaningful divisions. */
export function normalizeRoomBoundary(floor, room, createId) {
  const previous = room.edges;
  const vertices = [...room.vertices];
  const runs = room.edges.map((edge) => ({ sources: [edge.id] }));
  const owners = (run) =>
    room.faces.filter((face) => face.edgeIds?.some((id) => run.sources.includes(id)));
  const mayMerge = (a, b) => {
    const faces = [...new Set([...owners(a), ...owners(b)])];
    if (!faces.length) return true;
    const first = faces[0];
    const wall = findWall(floor, first.wallId);
    return faces.every((face) => {
      const other = findWall(floor, face.wallId);
      if (
        wall.id !== other.id &&
        (wall.lineage?.explicitPhysicalSeparation || other.lineage?.explicitPhysicalSeparation)
      )
        return false;
      return (
        wallTopologyOrigin(wall) === wallTopologyOrigin(other) &&
        equalValue(first.values, face.values) &&
        equalValue(first.overrides, face.overrides) &&
        equalValue(wall.overrides, other.overrides) &&
        wall.segments.every((segment) =>
          other.segments.every((entry) =>
            equalValue(segment.overrides || {}, entry.overrides || {})
          )
        )
      );
    });
  };
  let changed = true;
  while (changed && vertices.length > 2) {
    changed = false;
    for (let i = 0; i < vertices.length; i++) {
      const next = (i + 1) % vertices.length;
      if (distance(vertices[i], vertices[next]) > EPS) continue;
      // The collapsed edge has no surviving extent. Its answers are remapped below.
      runs[i].sources = [...runs[next].sources];
      vertices.splice(next, 1);
      runs.splice(next, 1);
      changed = true;
      break;
    }
    if (changed) continue;
    for (let i = 0; i < vertices.length; i++) {
      const prev = (i + vertices.length - 1) % vertices.length;
      const next = (i + 1) % vertices.length;
      const a = subtract(vertices[i], vertices[prev]);
      const b = subtract(vertices[next], vertices[i]);
      if (
        vertices[i].editingCutId ||
        Math.abs(cross(a, b)) > EPS ||
        dot(a, b) <= 0 ||
        !mayMerge(runs[prev], runs[i])
      )
        continue;
      runs[prev].sources.push(...runs[i].sources);
      vertices.splice(i, 1);
      runs.splice(i, 1);
      changed = true;
      break;
    }
  }
  room.vertices = vertices;
  assignRoomEdges(room, createId, previous);
  const removed = [];
  for (const face of room.faces) {
    if (face.freePath) continue;
    face.edgeIds = room.edges
      .filter((edge, index) => runs[index].sources.some((id) => face.edgeIds?.includes(id)))
      .map((edge) => edge.id);
    if (!face.edgeIds.length) removed.push(face);
  }
  room.faces = room.faces.filter((face) => !removed.includes(face));
  for (const face of removed) {
    const origin = wallTopologyOrigin(findWall(floor, face.wallId));
    const replacement = room.faces.find(
      (entry) => wallTopologyOrigin(findWall(floor, entry.wallId)) === origin
    );
    if (!replacement) continue;
    if (
      !equalValue(face.values, replacement.values) ||
      !equalValue(face.overrides, replacement.overrides)
    )
      throw new Error(
        'This alignment removes a portion with different room-side answers. Resolve those answers or use a smaller move.'
      );
    remapSubject(floor, face.id, replacement.id, 'room_face');
    const wall = findWall(floor, face.wallId);
    if (wall.referenceFaceId === face.id) wall.referenceFaceId = null;
  }
}

/** Retire stale automatic returns after the room polygon has been normalized/rebound. */
export function pruneAutomaticReturns(floor) {
  for (const wall of [...floor.walls]) {
    const linked = facesOfWall(floor, wall.id);
    const referenced = new Set(
      linked.flatMap(({ face }) => face.bindings.map((binding) => binding.segmentId))
    );
    const retired = wall.segments.filter(
      (segment) => segment.junction && !referenced.has(segment.id)
    );
    for (const segment of retired) {
      if (Object.keys(segment.overrides || {}).length)
        throw new Error(
          'This return has explicit construction answers. Reset those overrides or use a smaller move.'
        );
      if ([...wall.doors, ...wall.windows].some((opening) => opening.segmentId === segment.id))
        throw new Error(
          'An opening occupies the return being removed. Move it before aligning the wall.'
        );
      remapSubject(floor, segment.id, wallTopologyOrigin(wall), 'wall');
    }
    wall.segments = wall.segments.filter((segment) => !retired.includes(segment));
    if (!linked.length && wall.lineage?.jogOriginWallId) {
      const surviving = floor.walls.find(
        (entry) =>
          entry !== wall &&
          wallTopologyOrigin(entry) === wallTopologyOrigin(wall) &&
          facesOfWall(floor, entry.id).length
      );
      if (surviving && !equalValue(wall.overrides, surviving.overrides))
        throw new Error(
          'This return has different physical wall answers. Resolve those overrides or use a smaller move.'
        );
      remapSubject(floor, wall.id, wallTopologyOrigin(wall), 'wall');
      floor.walls = floor.walls.filter((entry) => entry !== wall);
    }
  }
}

/** One editor row per straight facing extent, independent of physical grouping. */
export function splitFacingRows(floor, createId, segmentOwners = new Map(), wallIds = null) {
  for (const room of floor.rooms) {
    const next = [];
    for (const face of room.faces) {
      if (wallIds && !wallIds.has(face.wallId)) {
        next.push(face);
        continue;
      }
      const sourceFace = copy(face);
      const groups = new Map();
      for (const binding of face.bindings) {
        const wallId = segmentOwners.get(binding.segmentId) || face.wallId;
        const key = `${wallId}:${binding.edgeId}`;
        if (!groups.has(key)) groups.set(key, { wallId, edgeId: binding.edgeId, bindings: [] });
        groups.get(key).bindings.push(copy(binding));
      }
      if (!groups.size) {
        next.push(face);
        continue;
      }
      const origin = face.lineage?.jogOriginFaceId || face.id;
      const usedVertices = new Set();
      for (const [index, group] of [...groups.values()].entries()) {
        const part = index ? { ...copy(sourceFace), id: createId() } : face;
        part.wallId = group.wallId;
        part.bindings = group.bindings;
        if (sourceFace.freePath) {
          const edgeIndex = sourceFace.freeEdges.indexOf(group.edgeId);
          part.freePath = copy(sourceFace.freePath.slice(edgeIndex, edgeIndex + 2)).map((point) => {
            const result = usedVertices.has(point.id) ? { ...point, id: createId() } : point;
            usedVertices.add(result.id);
            return result;
          });
          part.freeEdges = [group.edgeId];
        } else part.edgeIds = [group.edgeId];
        if (groups.size > 1 || face.lineage?.jogOriginFaceId)
          part.lineage = { ...part.lineage, jogOriginFaceId: origin };
        next.push(part);
      }
    }
    room.faces = next;
  }
  for (const wall of floor.walls) {
    const linked = facesOfWall(floor, wall.id);
    if (!linked.some(({ face }) => face.id === wall.referenceFaceId))
      wall.referenceFaceId = linked[0]?.face.id || null;
  }
}

/** Separate geometric runs without copying observations or opening identities. */
export function separatePhysicalWallRuns(floor, wall, createId, selectedIds = null) {
  const selected = selectedIds
    ? new Set(selectedIds)
    : new Set(wall.segments.map((segment) => segment.id));
  const retained = wall.segments.filter((segment) => !selected.has(segment.id));
  const pieces = wall.segments.filter((segment) => selected.has(segment.id));
  if (!retained.length && pieces.length) retained.push(pieces.shift());
  if (!pieces.length) return [];
  const origin = wallTopologyOrigin(wall);
  wall.lineage = { ...wall.lineage, jogOriginWallId: origin };
  const owners = new Map();
  const created = [];
  for (const segment of pieces) {
    const part = {
      ...copy(wall),
      id: createId(),
      segments: [segment],
      doors: [],
      windows: [],
      lineage: { ...copy(wall.lineage), copiedFromWallId: wall.id, jogOriginWallId: origin },
    };
    if (part.values.wall_label)
      part.values.wall_label = `${part.values.wall_label}.${created.length + 2}`;
    for (const collection of ['doors', 'windows']) {
      part[collection] = wall[collection].filter((opening) => opening.segmentId === segment.id);
      wall[collection] = wall[collection].filter((opening) => opening.segmentId !== segment.id);
    }
    owners.set(segment.id, part.id);
    created.push(part);
  }
  wall.segments = retained;
  floor.walls.push(...created);
  splitFacingRows(floor, createId, owners, new Set([wall.id]));
  for (const observation of floor.observations) {
    if (observation.subject?.id !== wall.id) continue;
    observation.relatedSubjects = [wall, ...created].map((entry) => ({
      type: 'wall',
      id: entry.id,
    }));
  }
  return created;
}

export function coalesceFacingRows(floor) {
  for (const room of floor.rooms) {
    const kept = [];
    for (const face of room.faces) {
      const equivalent = kept.find(
        (entry) =>
          entry.wallId === face.wallId &&
          equalValue(entry.edgeIds, face.edgeIds) &&
          equalValue(entry.values, face.values) &&
          equalValue(entry.overrides, face.overrides)
      );
      if (!equivalent || face.freePath) {
        kept.push(face);
        continue;
      }
      remapSubject(floor, face.id, equivalent.id, 'room_face');
      const wall = findWall(floor, face.wallId);
      if (wall.referenceFaceId === face.id) wall.referenceFaceId = equivalent.id;
    }
    room.faces = kept;
  }
  for (const observation of floor.observations)
    if (observation.relatedSubjects)
      observation.relatedSubjects = observation.relatedSubjects.filter(
        (subject) => subject.type !== 'wall' || floor.walls.some((wall) => wall.id === subject.id)
      );
}
