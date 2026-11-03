import { dot, polygonArea, project, segmentFrame } from './geometry.js';
import { normalizeBuildingPlanEditingPolicy } from './editing-policy.js';

import { copyBuildingPlanData } from './model.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Shared magnetic guides and edge-pan timing in canvas-world/screen coordinates. */
export function createBuildingPlanInteraction({ scene = () => ({}), policy = () => ({}) } = {}) {
  let latch = new Set();
  let guides = [];
  let edgeSince = null;
  let lastFrame = null;
  let referenceScene = null;
  const currentScene = () => referenceScene || scene();
  const settings = () => normalizeBuildingPlanEditingPolicy(policy());
  function choose(candidates, zoom) {
    const ranked = candidates
      .filter((entry) => entry.error * zoom <= (latch.has(entry.key) ? 13 : 8))
      .sort(
        (a, b) =>
          Number(latch.has(b.key)) - Number(latch.has(a.key)) ||
          a.error - b.error ||
          a.key.localeCompare(b.key)
      );
    const first = ranked[0];
    if (!first) {
      latch.clear();
      guides = [];
      return null;
    }
    let second = ranked.find((entry) => Math.abs(dot(entry.normal, first.normal)) < 0.999999);
    let delta = first.delta;
    if (second) {
      const a = first.normal,
        b = second.normal;
      const x = dot(first.delta, a),
        y = dot(second.delta, b),
        determinant = a.x * b.y - a.y * b.x;
      delta = { x: (x * b.y - a.y * y) / determinant, y: (a.x * y - x * b.x) / determinant };
    }
    const chosen = second ? [first, second] : [first];
    latch = new Set(chosen.map((entry) => entry.key));
    guides = chosen.flatMap((entry) =>
      entry.guides.map((guide) => ({
        from: {
          x: guide.from.x + delta.x - entry.delta.x,
          y: guide.from.y + delta.y - entry.delta.y,
        },
        to: { x: guide.to.x + delta.x - entry.delta.x, y: guide.to.y + delta.y - entry.delta.y },
      }))
    );
    return { delta };
  }
  function snapTranslation(
    points,
    { roomId, physicalWallId, zoom = 1, originalPoints = [], bypass = false } = {}
  ) {
    if (!settings().snapping || bypass || points.length < 2) {
      latch.clear();
      guides = [];
      return points;
    }
    const view = currentScene();
    const movingRoom = view.rooms?.find((room) => room.id === roomId);
    const edges =
      points.length > 2
        ? points.map((point, index) => [point, points[(index + 1) % points.length]])
        : [[points[0], points[1]]];
    const candidates = [];
    for (const [index, [start, end]] of edges.entries()) {
      if (Math.hypot(end.x - start.x, end.y - start.y) < 1e-6) continue;
      const own = segmentFrame(start, end);
      for (const wall of view.walls || []) {
        if (
          !wall.isBoundary ||
          wall.roomId === roomId ||
          wall.points.length !== 2 ||
          (physicalWallId && wall.physicalWallId === physicalWallId)
        )
          continue;
        const other = segmentFrame(wall.points[0], wall.points[1]);
        const direction = dot(own.tangent, other.tangent);
        if (Math.abs(direction) < 0.999999) continue;
        const offsets = [project(other, start).along, project(other, end).along];
        const overlap =
          Math.min(other.length, Math.max(...offsets)) - Math.max(0, Math.min(...offsets));
        const neighbour = view.rooms.find((room) => room.id === wall.roomId);
        const thickness = (wall.thickness ?? 0) * (view.gridSize || 20);
        const expected =
          direction < 0 && overlap >= -8 / zoom
            ? -Math.sign(polygonArea(neighbour.vertices)) * thickness
            : 0;
        const difference = expected - project(other, start).offset;
        const delta = { x: other.normal.x * difference, y: other.normal.y * difference };
        candidates.push({
          key: `face:${index}:${wall.id}`,
          error: Math.abs(difference),
          normal: other.normal,
          delta,
          guides: [
            {
              from: { x: start.x + delta.x, y: start.y + delta.y },
              to: { x: end.x + delta.x, y: end.y + delta.y },
            },
          ],
        });
      }
    }
    if (
      !candidates.some((candidate) => candidate.error * zoom <= 8) &&
      originalPoints.length === points.length
    ) {
      const delta = { x: originalPoints[0].x - points[0].x, y: originalPoints[0].y - points[0].y };
      if (
        points.every(
          (point, i) =>
            Math.abs(point.x + delta.x - originalPoints[i].x) < 1e-6 &&
            Math.abs(point.y + delta.y - originalPoints[i].y) < 1e-6
        ) &&
        Math.hypot(delta.x, delta.y) * zoom <= (latch.has('original') ? 13 : 8)
      ) {
        latch = new Set(['original']);
        guides = [{ from: originalPoints[0], to: originalPoints[1] }];
        return points.map((point) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y }));
      }
    }
    const chosen = choose(candidates, zoom);
    if (chosen)
      return points.map((point) => ({
        ...point,
        x: point.x + chosen.delta.x,
        y: point.y + chosen.delta.y,
      }));
    // Tangential corner alignment is useful away from an opposing wall face.
    if (
      points.length > 2 &&
      movingRoom &&
      !candidates.some((candidate) => candidate.error * zoom <= 20)
    ) {
      const snapped = snapPoint(points[0], { roomId, zoom, bypass });
      const delta = { x: snapped.x - points[0].x, y: snapped.y - points[0].y };
      return points.map((point) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y }));
    }
    return points;
  }
  function snapPoint(point, { roomId, zoom = 1, bypass = false } = {}) {
    guides = [];
    if (!settings().snapping || bypass) return { ...point };
    const targets = (currentScene().rooms || [])
      .filter((room) => room.id !== roomId)
      .flatMap((room) => room.vertices);
    const result = { ...point };
    for (const axis of ['x', 'y']) {
      const target = targets
        .filter((entry) => Math.abs(entry[axis] - point[axis]) * zoom <= 8)
        .sort((a, b) => Math.abs(a[axis] - point[axis]) - Math.abs(b[axis] - point[axis]))[0];
      if (!target) continue;
      result[axis] = target[axis];
      guides.push({ from: target, to: { ...result } });
    }
    return result;
  }
  function edgePan(point, bounds, now) {
    if (!settings().edgeAutoPan || !bounds?.width || !bounds?.height) {
      edgeSince = null;
      lastFrame = null;
      return { x: 0, y: 0 };
    }
    const speed = (coordinate, extent) =>
      coordinate < 24
        ? clamp((24 - coordinate) / 24, 0, 1) * 180
        : coordinate > extent - 24
          ? -clamp((coordinate - extent + 24) / 24, 0, 1) * 180
          : 0;
    const velocity = { x: speed(point.x, bounds.width), y: speed(point.y, bounds.height) };
    if (!velocity.x && !velocity.y) {
      edgeSince = null;
      lastFrame = null;
      return { x: 0, y: 0 };
    }
    edgeSince ??= now;
    const elapsed = lastFrame == null ? 0 : clamp(now - lastFrame, 0, 32);
    lastFrame = now;
    if (now - edgeSince < 140) return { x: 0, y: 0 };
    return { x: (velocity.x * elapsed) / 1000, y: (velocity.y * elapsed) / 1000 };
  }
  return {
    begin() {
      referenceScene = copyBuildingPlanData(scene());
    },
    snapPoint,
    snapTranslation,
    edgePan,
    getGuides: () => guides.map((guide) => ({ from: { ...guide.from }, to: { ...guide.to } })),
    reset() {
      referenceScene = null;
      latch.clear();
      guides = [];
      edgeSince = null;
      lastFrame = null;
    },
  };
}
