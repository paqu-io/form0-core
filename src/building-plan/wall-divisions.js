import {
  GEOMETRY_EPSILON as EPS,
  distance,
  dot,
  near,
  polygonEdges,
  project,
  segmentFrame,
} from './geometry.js';

/** Longitudinal cut stations on this supporting band, independent of owner flags.
 * A cut that has become a jog corner still retains its identity, but does not
 * divide a different straight band merely because its endpoint projects onto it.
 */
export function buildingPlanEditingCutStations(floor, frame, half) {
  const stations = [];
  for (const room of floor.rooms) {
    const free = room.faces.filter((face) => face.freePath);
    const edges = [
      ...polygonEdges(room),
      ...free.flatMap((face) =>
        face.freePath
          .slice(0, -1)
          .map((point, index) => segmentFrame(point, face.freePath[index + 1]))
      ),
    ];
    for (const point of [...room.vertices, ...free.flatMap((face) => face.freePath)]) {
      if (!point.editingCutId) continue;
      const value = project(frame, point);
      if (!near(Math.abs(value.offset), half)) continue;
      const incident = edges.filter((edge) =>
        [edge.start, edge.end].some(
          (end) => end.editingCutId === point.editingCutId && distance(end, point) <= EPS
        )
      );
      if (
        incident.length >= 2 &&
        incident.every((edge) => Math.abs(dot(frame.normal, edge.tangent)) <= EPS)
      )
        stations.push(value.along);
    }
  }
  return stations
    .sort((a, b) => a - b)
    .filter((value, index, list) => !index || value - list[index - 1] > EPS);
}
