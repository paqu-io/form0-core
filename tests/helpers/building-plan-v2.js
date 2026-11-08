import { at, segmentFrame } from '../../src/building-plan/geometry.js';

/** Automatic physical-piece stations are not the original corners chosen by these fixtures. */
export const originalVertices = (room) =>
  room.vertices.filter((point) => !point.physicalBoundaryId);

/** Preserve selection intent when v2 inserts extra ordinary facing rows along an original side. */
export const originalFaces = (room) => {
  const seen = new Set();
  return room.faces.filter((face) => {
    const origin = face.lineage?.jogOriginFaceId || face.lineage?.editingOriginFaceId || face.id;
    if (seen.has(origin)) return false;
    seen.add(origin);
    return true;
  });
};

/** Select the continuing shared piece after an automatic adjacency division. */
export function sharedFaceId(snapshot, originalId) {
  for (const floor of snapshot.floors) {
    const room = floor.rooms.find((entry) => entry.faces.some((face) => face.id === originalId));
    if (!room) continue;
    const candidates = room.faces.filter(
      (face) =>
        face.id === originalId ||
        face.lineage?.editingOriginFaceId === originalId ||
        face.lineage?.jogOriginFaceId === originalId
    );
    const shared = candidates.filter(
      (face) => floor.walls.find((wall) => wall.id === face.wallId)?.exposure === 'interior'
    );
    return (
      (shared.length ? shared : candidates).sort(
        (a, b) =>
          b.bindings.reduce(
            (n, binding) => n + binding.roomInterval[1] - binding.roomInterval[0],
            0
          ) -
          a.bindings.reduce(
            (n, binding) => n + binding.roomInterval[1] - binding.roomInterval[0],
            0
          )
      )[0]?.id || originalId
    );
  }
  return originalId;
}

/** Compare openings across host/offset rebasing in a stationary world frame. */
export function openingWorldPositions(floor) {
  const point = ({ x, y }) => ({ x: Math.round(x * 1e8) / 1e8, y: Math.round(y * 1e8) / 1e8 });
  return floor.walls
    .flatMap((wall) =>
      [...wall.doors, ...wall.windows].map((opening) => {
        const segment = wall.segments.find((segment) => segment.id === opening.segmentId);
        const frame = segmentFrame(segment.start, segment.end);
        return {
          id: opening.id,
          type: opening.type,
          width: opening.width,
          height: opening.height,
          sillHeight: opening.sillHeight,
          start: point(at(frame, opening.offset)),
          end: point(at(frame, opening.offset + opening.width)),
        };
      })
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
