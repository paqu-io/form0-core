import { gridPoint } from './grid.js';

/**
 * Read a stored floor into the derived core's primary data.
 *
 * - Rooms: clear polygons rounded to the grid, with their vertex and edge identities and
 *   explicit cuts (`editingCutId`). Automatic stations (`physicalBoundaryId`) are kept as plain
 *   vertices; the derivation does not depend on them.
 * - Anchors: which wall subject covers which span of a room edge, read from the stored face
 *   bindings (the D4 anchor). A face without bindings anchors its whole edges.
 * - Profiles: room edges whose material a neighbouring wall supplies (no subject of their own).
 * - Partitions: internal walls drawn inside a room: the face path (`freePath`) and the side of
 *   each path edge on which the wall body lies.
 *
 * The stored walls stay available as `subjects`, for their answers and identities.
 */
export function extractBuildingPlanPrimary(floor) {
  const anchors = [];
  const profiles = [];
  const partitions = [];
  const rooms = floor.rooms.map((room) => {
    for (const face of room.faces || []) {
      if (face.freePath) {
        // The wall body lies on the binding's side of each path edge.
        partitions.push({
          roomId: room.id,
          faceId: face.id,
          subjectId: face.wallId,
          path: face.freePath.map(gridPoint),
          sides: (face.freeEdges || []).map((edgeId) => {
            const binding = face.bindings?.find((entry) => entry.edgeId === edgeId);
            return binding ? binding.side * binding.direction : null;
          }),
        });
        continue;
      }
      if (face.bindings?.length)
        for (const binding of face.bindings)
          anchors.push({
            subjectId: face.wallId,
            faceId: face.id,
            roomId: room.id,
            edgeId: binding.edgeId,
            from: binding.roomInterval[0],
            to: binding.roomInterval[1],
          });
      else
        for (const edgeId of face.edgeIds || [])
          anchors.push({
            subjectId: face.wallId,
            faceId: face.id,
            roomId: room.id,
            edgeId,
            from: 0,
            to: null,
          });
    }
    for (const edge of room.edges || [])
      if (edge.profile)
        profiles.push({ roomId: room.id, edgeId: edge.id, sourceId: edge.profile.wallId });
    return {
      id: room.id,
      vertices: room.vertices.map(gridPoint),
      edges: room.edges || [],
    };
  });
  return {
    floorId: floor.id,
    floor,
    rooms,
    anchors,
    profiles,
    partitions,
    subjects: new Map((floor.walls || []).map((wall) => [wall.id, wall])),
  };
}
