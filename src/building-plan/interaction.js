import { at, dot, polygonArea, project, segmentFrame } from './geometry.js';
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
  let cornerAxis = null;
  let wallAxis = null;
  const currentScene = () => referenceScene || scene();
  const settings = () => normalizeBuildingPlanEditingPolicy(policy());
  const captureError = (entry) => entry.captureError ?? entry.error;
  function choose(candidates, zoom) {
    const ranked = candidates
      .filter((entry) => captureError(entry) * zoom <= (latch.has(entry.key) ? 13 : 8))
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
    {
      roomId,
      physicalWallId,
      editingGroupId,
      faceId,
      zoom = 1,
      originalPoints = [],
      bypass = false,
      translationAxis = null,
    } = {}
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
      const originalStart = originalPoints[index] || start;
      const originalEnd = originalPoints[(index + 1) % originalPoints.length] || end;
      const original = segmentFrame(originalStart, originalEnd);
      const movingWall = (view.walls || []).find((wall) =>
        faceId
          ? wall.id === faceId
          : wall.roomId === roomId &&
            wall.points.length === 2 &&
            Math.abs(dot(original.normal, segmentFrame(...wall.points).tangent)) < 1e-6 &&
            Math.abs(project(original, wall.points[0]).offset) < 1e-6 &&
            Math.min(
              original.length,
              Math.max(...wall.points.map((p) => project(original, p).along))
            ) -
              Math.max(0, Math.min(...wall.points.map((p) => project(original, p).along))) >
              1e-6
      );
      const ownAxisOffset =
        movingWall?.axisPoints?.length === 2
          ? project(original, movingWall.axisPoints[0]).offset
          : null;
      for (const wall of view.walls || []) {
        if (
          wall.points.length !== 2 ||
          wall.id === faceId ||
          (editingGroupId
            ? wall.editingGroupId !== editingGroupId || wall.id === faceId || wall.isEditingReturn
            : !wall.isBoundary ||
              (wall.roomId === roomId && !faceId) ||
              (physicalWallId && wall.physicalWallId === physicalWallId && wall.roomId !== roomId))
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
        let expected =
          !editingGroupId && wall.roomId !== roomId && direction < 0 && overlap >= -8 / zoom
            ? -Math.sign(polygonArea(neighbour.vertices)) * thickness
            : 0;
        const otherAxis = wall.axisPoints?.length === 2 ? segmentFrame(...wall.axisPoints) : null;
        if (ownAxisOffset !== null && otherAxis)
          expected = project(other, otherAxis.start).offset - direction * ownAxisOffset;
        const offset = project(other, start).offset;
        const difference = expected - offset;
        const delta = { x: other.normal.x * difference, y: other.normal.y * difference };
        candidates.push({
          key: `face:${index}:${wall.id}`,
          error: Math.abs(difference),
          // Opposing inside faces bound the same physical material. Capture contact across
          // that band as well as the usual screen tolerance, even when zoomed in closely.
          captureError: Math.max(0, Math.min(0, expected) - offset, offset - Math.max(0, expected)),
          normal: other.normal,
          delta,
          guides: [
            {
              from: at(
                other,
                Math.min(0, ...offsets),
                otherAxis ? project(other, otherAxis.start).offset : expected
              ),
              to: at(
                other,
                Math.max(other.length, ...offsets),
                otherAxis ? project(other, otherAxis.start).offset : expected
              ),
            },
          ],
        });
      }
    }
    if (
      !candidates.some((candidate) => captureError(candidate) * zoom <= 8) &&
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
    const restricted = translationAxis
      ? candidates.flatMap((candidate) => {
          const component = candidate.normal[translationAxis];
          if (Math.abs(component) < 1e-6) return [];
          const amount = dot(candidate.delta, candidate.normal) / component;
          return [
            {
              ...candidate,
              normal: { x: translationAxis === 'x' ? 1 : 0, y: translationAxis === 'y' ? 1 : 0 },
              delta: {
                x: translationAxis === 'x' ? amount : 0,
                y: translationAxis === 'y' ? amount : 0,
              },
              error: Math.abs(amount),
              captureError: captureError(candidate) / Math.abs(component),
            },
          ];
        })
      : candidates;
    const chosen = choose(restricted, zoom);
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
      !candidates.some((candidate) => captureError(candidate) * zoom <= 20)
    ) {
      const snapped = snapPoint(points[0], { roomId, zoom, bypass });
      const delta = { x: snapped.x - points[0].x, y: snapped.y - points[0].y };
      return points.map((point) => ({ ...point, x: point.x + delta.x, y: point.y + delta.y }));
    }
    return points;
  }
  function snapWallTranslation(points, options = {}) {
    const { originalPoints = [], zoom = 1, bypass = false, perpendicular = false } = options;
    if (perpendicular && originalPoints.length >= 2 && points.length === originalPoints.length) {
      const frame = segmentFrame(originalPoints[0], originalPoints.at(-1));
      const amount = project(frame, points[0]).offset;
      return snapTranslation(
        originalPoints.map((point) => ({
          ...point,
          x: point.x + frame.normal.x * amount,
          y: point.y + frame.normal.y * amount,
        })),
        options
      );
    }
    if (bypass || points.length !== originalPoints.length || !points.length)
      return snapTranslation(points, options);
    const dx = points[0].x - originalPoints[0].x,
      dy = points[0].y - originalPoints[0].y;
    const start = originalPoints[0],
      end = originalPoints.at(-1);
    if (Math.abs(end.x - start.x) < 1e-6) wallAxis = 'x';
    else if (Math.abs(end.y - start.y) < 1e-6) wallAxis = 'y';
    if (!wallAxis && Math.hypot(dx, dy) * zoom >= 3)
      wallAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const axis = wallAxis || (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y');
    const constrained = points.map((point, index) => ({
      ...point,
      [axis === 'x' ? 'y' : 'x']: originalPoints[index][axis === 'x' ? 'y' : 'x'],
    }));
    return snapTranslation(constrained, { ...options, translationAxis: axis });
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
  function snapCorner(point, { roomId, vertexId, originalPoint, zoom = 1, bypass = false } = {}) {
    guides = [];
    if (bypass || !settings().snapping || !originalPoint) return { ...point };
    const dx = point.x - originalPoint.x,
      dy = point.y - originalPoint.y;
    if (!cornerAxis && Math.hypot(dx, dy) * zoom >= 3)
      cornerAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    const axis = cornerAxis || (Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y');
    const result = {
      ...point,
      [axis === 'x' ? 'y' : 'x']: originalPoint[axis === 'x' ? 'y' : 'x'],
    };
    const targets = (currentScene().corners || []).filter((corner) => corner.id !== vertexId);
    const nearest = targets
      .filter((c) => Math.abs(c.point[axis] - result[axis]) * zoom <= 8)
      .sort(
        (a, b) => Math.abs(a.point[axis] - result[axis]) - Math.abs(b.point[axis] - result[axis])
      )[0];
    if (nearest) {
      result[axis] = nearest.point[axis];
      guides.push({ from: nearest.point, to: { ...result } });
    }
    guides.push({ from: { ...originalPoint }, to: { ...result } });
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
      cornerAxis = null;
      wallAxis = null;
    },
    snapPoint,
    snapCorner,
    snapTranslation,
    snapWallTranslation,
    edgePan,
    getGuides: () => guides.map((guide) => ({ from: { ...guide.from }, to: { ...guide.to } })),
    reset() {
      referenceScene = null;
      cornerAxis = null;
      wallAxis = null;
      latch.clear();
      guides = [];
      edgeSince = null;
      lastFrame = null;
    },
  };
}
