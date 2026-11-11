import { copyBuildingPlanData as copy } from '../model.js';
import { along, lineFrame, pointAt } from './grid.js';

/** Segment keys that are geometry, recomputed on write-back; every other key is carried. */
const GEOMETRY_KEYS = ['id', 'start', 'end', 'referenceOffset'];

/** The room edge or partition edge a room-facing row lies on, as a line frame. */
export function faceEdgeFrame(room, face, edgeId) {
  if (face.freePath) {
    const index = face.freeEdges.indexOf(edgeId);
    return index < 0 ? null : lineFrame(face.freePath[index], face.freePath[index + 1]);
  }
  const edge = room.edges.find((entry) => entry.id === edgeId);
  const vertex = (id) => room.vertices.find((point) => point.id === id);
  return edge ? lineFrame(vertex(edge.startId), vertex(edge.endId)) : null;
}

/** A wall's reference row (its first row when the reference is missing), with its room. */
export function referenceFaceOf(floor, wall) {
  let first = null;
  for (const room of floor.rooms)
    for (const face of room.faces || []) {
      if (face.wallId !== wall.id) continue;
      if (face.id === wall.referenceFaceId) return { room, face };
      first ||= { room, face };
    }
  return first;
}

/**
 * Canonical orientation: a wall runs so that its reference row lies on side +1 (seen from the
 * reference room, the wall runs left to right). Returns -1 for a stored wall whose reference
 * row's side is signed -1: its side signs and profile signs are flipped when read.
 *
 * The side is read through the row's `sideId` (the surface identity its answers follow), not
 * through the binding's geometric side: a few stored fixtures (mirrored seeds) disagree.
 */
export function storedOrientation(floor, wall) {
  const reference = referenceFaceOf(floor, wall)?.face;
  const side = wall.sides?.find((entry) => entry.id === reference?.sideId);
  if (side) return side.sign === -1 ? -1 : 1;
  return reference?.bindings?.[0]?.side === -1 ? -1 : 1;
}

/**
 * Openings anchored to a row of their wall: `from` is the distance from the start of that row's
 * edge to the opening's nearer end. The anchor moves with the room, not with the wall's axis.
 */
function anchorOpening(opening, wall, reference) {
  const { segmentId, offset, ...rest } = copy(opening);
  const segment = wall.segments.find((entry) => entry.id === segmentId);
  const axis = segment && lineFrame(segment.start, segment.end);
  const binding = reference?.face.bindings?.[0];
  const edge = binding && faceEdgeFrame(reference.room, reference.face, binding.edgeId);
  if (!axis || !edge) return { ...rest, faceId: null, from: offset };
  const ends = [offset, offset + opening.width].map((station) =>
    along(edge, pointAt(axis, station))
  );
  return { ...rest, faceId: reference.face.id, from: Math.min(...ends) };
}

/**
 * Wall subjects: the answer-bearing identities of the stored walls, without geometry. Sides keep
 * their identity and answers under the canonical sign (+1 is the reference row's side); the
 * room a side faces is derived. The segment identity and planner markers are carried as data.
 *
 * Resolved `properties` and `provenance` are kept because inheritance reads them (an inherited
 * side value counts as explicit when its provenance is not the schema); write-back resolves
 * them again.
 *
 * @returns {Map<string, Object>}
 */
export function extractBuildingPlanSubjects(floor) {
  const subjects = new Map();
  for (const wall of floor.walls || []) {
    const { segments, sides, doors, windows, exposure, ...rest } = copy(wall);
    const segment = segments[0] || {};
    const reference = referenceFaceOf(floor, wall);
    const orientation = storedOrientation(floor, wall);
    subjects.set(wall.id, {
      ...rest,
      referenceFaceId: reference?.face.id ?? wall.referenceFaceId ?? null,
      segmentId: segment.id,
      segmentFlags: Object.fromEntries(
        Object.entries(segment).filter(([key]) => !GEOMETRY_KEYS.includes(key))
      ),
      lastWidth: Number.isFinite(segment.referenceOffset) ? segment.referenceOffset * 2 : 0,
      sides: (sides || []).map(({ roomId, ...side }) => ({
        ...side,
        sign: side.sign * orientation,
      })),
      openings: [...(doors || []), ...(windows || [])].map((opening) =>
        anchorOpening(opening, wall, reference)
      ),
    });
  }
  return subjects;
}
