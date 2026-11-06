import { GEOMETRY_EPSILON as EPS, distance } from './geometry.js';
import { buildingPlanFaceSegments, planIssue } from './model.js';

/** Pins are transient editor constraints, checked for every supplied operation before commit. */
export function buildingPlanPinIssues(before, after, ids = []) {
  const geometry = (snapshot, id) => {
    for (const floor of snapshot.floors)
      for (const room of floor.rooms) {
        const face = room.faces.find((f) => f.id === id);
        if (face)
          return buildingPlanFaceSegments(floor, room, face).map(({ start, end }) => [start, end]);
      }
    return null;
  };
  return ids.flatMap((id) => {
    const a = geometry(before, id),
      b = geometry(after, id);
    return a &&
      b &&
      a.length === b.length &&
      a.every((pair, i) => pair.every((p, j) => distance(p, b[i][j]) <= EPS))
      ? []
      : [
          planIssue(
            'pinned_wall_conflict',
            'This edit would move a pinned wall. Unpin it or choose another corner.',
            { type: 'room_face', id }
          ),
        ];
  });
}
