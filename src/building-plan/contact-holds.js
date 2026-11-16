import { GEOMETRY_EPSILON as EPS, polygonEdges, project, segmentFrame } from './geometry.js';
import { own } from './model.js';

// Boundary faces only: internal partitions never form these contacts.
const faceEdges = (room, face) =>
  face.freePath ? [] : polygonEdges(room).filter((edge) => face.edgeIds?.includes(edge.id));
const width = (wall) => wall?.properties?.wall_thickness;
const rooms = (wall) =>
  wall.sides
    .map((side) => side.roomId)
    .filter(Boolean)
    .sort();

/** The accepted wall this candidate wall came from, following division lineage. */
function previousWall(before, wall) {
  const ids = [
    wall.id,
    wall.lineage?.dividedFromWallId,
    wall.lineage?.splitFromWallId,
    wall.lineage?.copiedFromWallId,
    wall.lineage?.profileSource?.wallId,
  ];
  return ids.map((id) => before.walls.find((entry) => entry.id === id)).find(Boolean);
}

/** Supporting lines of the faces that resize_face operations dragged. */
function draggedLines(floor, operation) {
  const edits = operation.type === 'batch' ? operation.operations || [] : [operation];
  const lines = [];
  for (const edit of edits) {
    if (edit.type !== 'resize_face' || !edit.faceId) continue;
    for (const room of floor.rooms) {
      const face = room.faces.find((entry) => entry.id === edit.faceId);
      if (!face) continue;
      for (const edge of faceEdges(room, face))
        lines.push({ roomId: room.id, frame: segmentFrame(edge.start, edge.end) });
    }
  }
  return lines;
}

/**
 * Rooms to hold when fitting new shared walls formed on a dragged face. When a drag
 * makes a face meet another room and inheritance changes the new wall's width, the
 * neighbour keeps its face and the dragged face adapts, as an attached room does.
 *
 * @returns {Object<string, string>} Room ID to hold, keyed by wall ID.
 */
export function buildingPlanContactHolds(floor, geometry, before, operation) {
  const hold = {};
  const lines = before ? draggedLines(floor, operation) : [];
  if (!lines.length) return hold;
  for (const wall of floor.walls) {
    const measured = width(geometry.walls.find((entry) => entry.id === wall.id));
    if (
      wall.exposure !== 'interior' ||
      !Number.isFinite(measured) ||
      measured === width(wall) ||
      own(wall.overrides, 'wall_thickness')
    )
      continue;
    const old = previousWall(before, wall);
    if (old?.exposure === 'interior' && rooms(old).join() === rooms(wall).join()) continue;
    const dragged = lines.find(({ roomId, frame }) =>
      floor.rooms.some(
        (room) =>
          room.id === roomId &&
          room.faces.some((face) => {
            const edges = face.wallId === wall.id ? faceEdges(room, face) : [];
            return (
              edges.length > 0 &&
              edges.every(
                (edge) =>
                  Math.abs(project(frame, edge.start).offset) <= EPS &&
                  Math.abs(project(frame, edge.end).offset) <= EPS
              )
            );
          })
      )
    );
    const neighbour = dragged && rooms(wall).find((roomId) => roomId !== dragged.roomId);
    if (neighbour) hold[wall.id] = neighbour;
  }
  return hold;
}
