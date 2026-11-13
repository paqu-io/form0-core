import { planIssue } from '../model.js';
import { SAME, along, lineFrame, offset, overlap } from './grid.js';
import { outwardSign } from './frames.js';

/** Face and corner drags: the edits that can leave part of a room's line behind (Q5). */
export const SELF_FACING_OPERATIONS = Object.freeze([
  'resize_face',
  'move_corner',
  'resize_room',
  'resize_preserve_group',
]);

/**
 * The room faces of a floor's exterior walls: per axis segment, the room's face line, the outward
 * direction (away from the room) and the wall's width.
 */
function exteriorFaces(floor) {
  const faces = [];
  for (const wall of floor.walls) {
    const rooms = wall.sides.filter((side) => side.roomId);
    const width = wall.properties?.wall_thickness_m;
    if (wall.exposure !== 'exterior' || rooms.length !== 1 || !(width > 0)) continue;
    const { roomId, sign } = rooms[0];
    for (const segment of wall.segments) {
      const axis = lineFrame(segment.start, segment.end);
      if (!axis) continue;
      // The room lies on the side of the axis's left normal when its side's sign is +1.
      const shift = (sign * width) / 2;
      const start = {
        x: segment.start.x + axis.normal.x * shift,
        y: segment.start.y + axis.normal.y * shift,
      };
      const end = {
        x: segment.end.x + axis.normal.x * shift,
        y: segment.end.y + axis.normal.y * shift,
      };
      const frame = lineFrame(start, end);
      faces.push({ wall, roomId, width, frame, outward: -sign });
    }
  }
  return faces;
}

const outwardOf = (face) => ({
  x: face.frame.normal.x * face.outward,
  y: face.frame.normal.y * face.outward,
});
const stations = (frame, face) => [along(frame, face.frame.start), along(frame, face.frame.end)];

/** The rooms' edges before the edit, with their outward side (whatever wall or cap they had). */
function roomEdges(floor) {
  return floor.rooms.flatMap((room) =>
    room.vertices
      .map((point, index) => ({
        roomId: room.id,
        frame: lineFrame(point, room.vertices[(index + 1) % room.vertices.length]),
        outward: outwardSign(room),
      }))
      .filter((edge) => edge.frame)
  );
}

/** The room had this face before the edit: its edges on the same line, facing the same way, cover it. */
function existedBefore(face, edges) {
  const out = outwardOf(face);
  const covering = edges
    .filter((edge) => {
      if (edge.roomId !== face.roomId) return false;
      const edgeOut = outwardOf(edge);
      return (
        out.x * edgeOut.x + out.y * edgeOut.y > 1 - 1e-6 &&
        Math.abs(offset(face.frame, edge.frame.start)) <= SAME &&
        Math.abs(offset(face.frame, edge.frame.end)) <= SAME
      );
    })
    .map((edge) => stations(face.frame, edge).sort((a, b) => a - b))
    .sort((a, b) => a[0] - b[0]);
  const [from, to] = stations(face.frame, face).sort((a, b) => a - b);
  let reached = from;
  for (const [start, end] of covering) {
    if (start > reached + SAME) break;
    reached = Math.max(reached, end);
  }
  return reached >= to - SAME;
}

/**
 * Q5: after a face or corner drag, a face the drag created must not face, across the outside, a
 * face of the same room that was already there, closer than the thinner wall's width beyond both
 * walls' material: the space between would be a slit (or the walls would overlap). Pairs of faces
 * the drag created together (the jogs of a notch) are allowed, and so is a pocket the room already
 * had (a cap turned into a wall does not make its face new).
 *
 * @returns {Array<Object>} A `wall_clearance_conflict` issue, or none.
 */
export function selfFacingWallIssues(before, candidate) {
  const edges = roomEdges(before);
  const faces = exteriorFaces(candidate);
  const existing = faces.filter((face) => existedBefore(face, edges));
  for (const face of faces) {
    if (existing.includes(face)) continue;
    const out = outwardOf(face);
    for (const other of existing) {
      if (other.roomId !== face.roomId) continue;
      const otherOut = outwardOf(other);
      if (out.x * otherOut.x + out.y * otherOut.y > -1 + 1e-6) continue;
      const gap = offset(face.frame, other.frame.start) * face.outward;
      if (Math.abs(gap - offset(face.frame, other.frame.end) * face.outward) > SAME) continue;
      if (!(gap > SAME)) continue;
      if (!overlap(stations(face.frame, face), stations(face.frame, other))) continue;
      const slit = gap - face.width - other.width;
      if (slit >= Math.min(face.width, other.width) - SAME) continue;
      const room = candidate.rooms.find((entry) => entry.id === face.roomId);
      return [
        planIssue(
          'wall_clearance_conflict',
          `The wall would leave a slit against Room ${candidate.rooms.indexOf(room) + 1}'s own wall. Move rejected; edit the adjoining portion first.`,
          { type: 'room', id: face.roomId },
          { wallId: face.wall.id }
        ),
      ];
    }
  }
  return [];
}
