import {
  GEOMETRY_EPSILON as EPS,
  cross,
  dot,
  multiply,
  polygonArea,
  polygonEdges,
  project,
} from './geometry.js';
import { findFace } from './model.js';

/** Whether an operation snaps a created or moved room onto rooms already in place. */
export function seatsAttachedRoom(operation) {
  if (operation.type === 'batch') return (operation.operations || []).some(seatsAttachedRoom);
  const attaches =
    (operation.type === 'create_room' && operation.attach === true) ||
    (operation.type === 'move_room' && operation.attach !== false);
  return attaches && (operation.attachmentTolerance ?? 0) > 0;
}

/** Whether "Keep previous values" was chosen for an attachment's contact walls. */
export const keepsContactThickness = (operation) =>
  operation.type === 'batch'
    ? (operation.operations || []).some(keepsContactThickness)
    : operation.keepContactThickness === true;

/** The same attachment, seated at the existing contact widths instead of the inherited ones. */
export const keepingContactThickness = (operation) =>
  operation.type === 'batch'
    ? { ...operation, operations: operation.operations.map(keepingContactThickness) }
    : { ...operation, keepContactThickness: true };

/**
 * Translation that seats a newly attached, still unshared room against its stationary
 * neighbours. Each contact gap becomes that contact's resolved shared-wall thickness,
 * so attaching never moves or resizes rooms that were already in place.
 *
 * @param {Object} floor
 * @param {Object} room The room being created or moved; it has no shared walls yet.
 * @param {Array<{referenceFaceId: string, referenceEdgeId: string, edgeId: string, seatThickness: number}>} contacts
 * @returns {{x: number, y: number} | null} The translation, or null when no single
 *   translation satisfies every contact (for example a room squeezed between two rooms).
 */
export function attachmentSeatingDelta(floor, room, contacts) {
  const constraints = contacts.map((contact) => {
    const reference = findFace(floor, contact.referenceFaceId).room;
    const referenceEdge = polygonEdges(reference).find(
      (edge) => edge.id === contact.referenceEdgeId
    );
    const edge = polygonEdges(room).find((entry) => entry.id === contact.edgeId);
    const expected = -Math.sign(polygonArea(reference.vertices)) * contact.seatThickness;
    return {
      normal: referenceEdge.normal,
      shift: expected - project(referenceEdge, edge.start).offset,
    };
  });
  if (!constraints.length) return { x: 0, y: 0 };
  // Solve delta·normal = shift for the first two independent directions, then
  // require every remaining contact to agree with that single translation.
  const [first] = constraints;
  const second = constraints.find((entry) => Math.abs(cross(first.normal, entry.normal)) > EPS);
  let delta = multiply(first.normal, first.shift);
  if (second) {
    const determinant = cross(first.normal, second.normal);
    delta = {
      x: (first.shift * second.normal.y - second.shift * first.normal.y) / determinant,
      y: (second.shift * first.normal.x - first.shift * second.normal.x) / determinant,
    };
  }
  return constraints.every((entry) => Math.abs(dot(delta, entry.normal) - entry.shift) <= EPS)
    ? delta
    : null;
}
