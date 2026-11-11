import { copyBuildingPlanData as copy } from '../model.js';
import { extractBuildingPlanSubjects, storedOrientation } from './extract-subjects.js';

/**
 * Read a stored floor into the derived core's primary data. Primary data is self-contained: the
 * write-back rebuilds walls, rows and bindings from it without reading the stored walls.
 *
 * - Floor: floor-level answers and defaults (everything but rooms and walls).
 * - Rooms: clear polygons with their vertex and edge identities, at their stored coordinates
 *   (no grid rounding: a round trip moves nothing), explicit cuts (`editingCutId`) and automatic
 *   stations (`physicalBoundaryId`), plus room answers and elements. Rows and profiles are read
 *   separately.
 * - Anchors: which wall subject covers which span of a room edge (the D4 anchor), with the row's
 *   identity: row ID, binding ID and row lineage. A row without bindings anchors its whole edges.
 * - Profiles: room edges whose material a neighbouring wall supplies (no subject of their own),
 *   with the canonical side of the source that faces the room.
 * - Partitions: internal walls drawn inside a room: the face path (`freePath`), the side of each
 *   path edge on which the wall body lies, and the row identities.
 * - Subjects: the answer-bearing wall identities (see `extract-subjects.js`).
 */
export function extractBuildingPlanPrimary(floor) {
  const { rooms: storedRooms = [], walls = [], ...floorData } = floor;
  const orientation = new Map(walls.map((wall) => [wall.id, storedOrientation(floor, wall)]));
  const anchors = [];
  const profiles = [];
  const partitions = [];
  const rooms = storedRooms.map(({ faces = [], ...room }) => {
    for (const face of faces) {
      if (face.freePath) {
        // The wall body lies on the binding's side of each path edge.
        const binding = (edgeId) => face.bindings?.find((entry) => entry.edgeId === edgeId);
        partitions.push({
          roomId: room.id,
          faceId: face.id,
          subjectId: face.wallId,
          path: copy(face.freePath),
          freeEdges: [...(face.freeEdges || [])],
          sides: (face.freeEdges || []).map((edgeId) => {
            const entry = binding(edgeId);
            return entry ? entry.side * entry.direction : null;
          }),
          bindingIds: (face.freeEdges || []).map((edgeId) => binding(edgeId)?.id ?? null),
          ...(face.lineage ? { lineage: copy(face.lineage) } : {}),
        });
        continue;
      }
      const identity = {
        subjectId: face.wallId,
        faceId: face.id,
        roomId: room.id,
        ...(face.lineage ? { lineage: copy(face.lineage) } : {}),
      };
      if (face.bindings?.length)
        for (const binding of face.bindings)
          anchors.push({
            ...identity,
            edgeId: binding.edgeId,
            from: binding.roomInterval[0],
            to: binding.roomInterval[1],
            bindingId: binding.id,
          });
      else
        for (const edgeId of face.edgeIds || [])
          anchors.push({ ...identity, edgeId, from: 0, to: null, bindingId: null });
    }
    for (const edge of room.edges || [])
      if (edge.profile)
        profiles.push({
          roomId: room.id,
          edgeId: edge.id,
          sourceId: edge.profile.wallId,
          sideSign: edge.profile.sideSign * (orientation.get(edge.profile.wallId) ?? 1),
        });
    return {
      ...copy(room),
      edges: (room.edges || []).map(({ profile, ...edge }) => ({ ...edge })),
    };
  });
  return {
    floorId: floor.id,
    floor: copy(floorData),
    rooms,
    anchors,
    profiles,
    partitions,
    subjects: extractBuildingPlanSubjects(floor),
  };
}
