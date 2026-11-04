import { at, cross, distance, project, segmentFrame, subtract } from './geometry.js';

/** Locate a straight selectable portion and project nearby nodes onto its editing face. */
export function buildingPlanCutPlacement(
  scene,
  point,
  {
    roomId = null,
    wallId = null,
    preferredRoomId = null,
    zoom = 1,
    snapping = true,
    bypass = false,
  } = {}
) {
  const candidates = [];
  for (const wall of scene.walls || []) {
    if (
      (wallId && wall.id !== wallId) ||
      (roomId && wall.roomId !== roomId) ||
      wall.points.length !== 2
    )
      continue;
    const frame = segmentFrame(...wall.points);
    const along = Math.max(0, Math.min(frame.length, project(frame, point).along));
    const error = distance(point, at(frame, along));
    if (!wallId && error * zoom > 14) continue;
    candidates.push({ wall, frame, along, error });
  }
  const selected = candidates.sort(
    (a, b) =>
      Number(b.wall.roomId === preferredRoomId) - Number(a.wall.roomId === preferredRoomId) ||
      a.error - b.error
  )[0];
  if (!selected) return null;
  const { wall, frame } = selected;
  let along = selected.along,
    target = null;
  if (snapping && !bypass) {
    const targets = (scene.rooms || []).flatMap((room) => room.vertices);
    for (const other of scene.walls || [])
      for (let i = 1; i < other.points.length; i++) {
        const a = other.points[i - 1],
          b = other.points[i],
          delta = subtract(b, a);
        const determinant = cross(frame.tangent, delta);
        if (Math.abs(determinant) < 1e-6) continue;
        const offset = subtract(a, frame.start);
        const ratio = cross(offset, frame.tangent) / determinant;
        if (ratio >= 0 && ratio <= 1)
          targets.push({ x: a.x + delta.x * ratio, y: a.y + delta.y * ratio });
      }
    const nearest = targets
      .map((point) => ({ point, along: project(frame, point).along }))
      .filter(
        (entry) =>
          entry.along > 1e-6 &&
          entry.along < frame.length - 1e-6 &&
          Math.abs(entry.along - along) * zoom <= 8
      )
      .sort((a, b) => Math.abs(a.along - along) - Math.abs(b.along - along))[0];
    if (nearest) {
      along = nearest.along;
      target = nearest.point;
    }
  }
  return {
    wallId: wall.id,
    roomId: wall.roomId,
    point: at(frame, along),
    start: { ...wall.points[0] },
    end: { ...wall.points[1] },
    offset: along / scene.gridSize,
    length: frame.length / scene.gridSize,
    snapped: Boolean(target),
    guide: target ? { from: { ...target }, to: at(frame, along) } : null,
  };
}

export function buildingPlanJoinPlacement(
  scene,
  point,
  { roomId = null, preferredRoomId = null, zoom = 1 } = {}
) {
  const selected =
    (scene.editingCuts || [])
      .filter(
        (cut) => (!roomId || cut.roomId === roomId) && distance(cut.point, point) * zoom <= 14
      )
      .sort(
        (a, b) =>
          Number(b.roomId === preferredRoomId) - Number(a.roomId === preferredRoomId) ||
          distance(a.point, point) - distance(b.point, point)
      )[0] || null;
  return selected ? { ...selected, point: { ...selected.point } } : null;
}
