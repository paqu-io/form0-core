import assert from 'node:assert/strict';
import { BUILDING_PLAN_PROPERTIES } from '../../src/building-plan/model.js';
import {
  deriveBuildingPlanPrimary,
  extractBuildingPlanPrimary,
  writeBackBuildingPlanFloor,
} from '../../src/building-plan/derive/index.js';

export const derivedSpecifications = (meta) => ({
  ...BUILDING_PLAN_PROPERTIES,
  ...meta.properties,
});

/** Rotate a snapshot about the origin (rooms, partition paths and wall axes). */
export function rotate(snapshot, angle) {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  const turn = (point) => ({
    ...point,
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
  });
  const copy = structuredClone(snapshot);
  for (const floor of copy.floors) {
    for (const room of floor.rooms) {
      room.vertices = room.vertices.map(turn);
      for (const face of room.faces) if (face.freePath) face.freePath = face.freePath.map(turn);
    }
    for (const wall of floor.walls)
      for (const segment of wall.segments) {
        segment.start = turn(segment.start);
        segment.end = turn(segment.end);
      }
  }
  return copy;
}

/** Extract, optionally edit the primary data, derive and write back. */
export function writeBack(floor, specifications, { edit, ...options } = {}) {
  const primary = extractBuildingPlanPrimary(floor);
  edit?.(primary);
  let serial = 0;
  return writeBackBuildingPlanFloor(primary, deriveBuildingPlanPrimary(primary, specifications), {
    specifications,
    createId: () => `wb-${++serial}`,
    ...options,
  });
}

/** Move a room of the primary data, as a room command will. */
export const translateRoom = (primary, roomId, dx, dy = 0) => {
  const room = primary.rooms.find((entry) => entry.id === roomId);
  room.vertices = room.vertices.map((vertex) => ({
    ...vertex,
    x: vertex.x + dx,
    y: vertex.y + dy,
  }));
};

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The stored floor in canonical orientation: a wall whose reference row's binding is on side -1
 * is reversed (segment, bindings, opening offsets), and the reference row's side is signed +1.
 */
export function canonicalFloor(floor) {
  const result = structuredClone(floor);
  for (const wall of result.walls) {
    const faces = result.rooms.flatMap((room) => room.faces.filter((f) => f.wallId === wall.id));
    const reference = faces.find((face) => face.id === wall.referenceFaceId) || faces[0];
    const sign = wall.sides.find((side) => side.id === reference?.sideId)?.sign ?? 1;
    if (sign === -1) {
      for (const side of wall.sides) side.sign *= -1;
      for (const room of result.rooms)
        for (const edge of room.edges)
          if (edge.profile?.wallId === wall.id) edge.profile.sideSign *= -1;
    }
    if (reference?.bindings[0]?.side !== -1) continue;
    const segment = wall.segments[0];
    const length = distance(segment.start, segment.end);
    [segment.start, segment.end] = [segment.end, segment.start];
    for (const face of faces)
      for (const binding of face.bindings) {
        binding.direction *= -1;
        binding.side *= -1;
        binding.interval = [length - binding.interval[1], length - binding.interval[0]];
      }
    for (const opening of [...wall.doors, ...wall.windows]) {
      opening.offset = length - opening.offset - opening.width;
      if (Object.hasOwn(opening.values || {}, `${opening.type}_offset_m`))
        opening.values[`${opening.type}_offset_m`] = opening.offset;
    }
  }
  return result;
}

/** Deep equality with a 2 µm tolerance on numbers; object key order is ignored. */
export function assertClose(actual, expected, path = 'floor') {
  if (typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Math.abs(actual - expected) <= 2e-6, `${path}: ${actual} instead of ${expected}`);
    return;
  }
  if (expected === null || typeof expected !== 'object') {
    assert.equal(actual, expected, path);
    return;
  }
  assert.equal(Array.isArray(actual), Array.isArray(expected), `${path}: kind`);
  const keys = new Set([...Object.keys(actual || {}), ...Object.keys(expected)]);
  for (const key of keys) assertClose(actual?.[key], expected[key], `${path}.${key}`);
}

/** Write back an unchanged floor: nothing joins, divides or retires, and every field matches. */
export function assertRoundTrip(floor, specifications) {
  const result = writeBack(floor, specifications);
  assert.deepEqual(result.issues, []);
  assert.deepEqual([result.joins, result.divisions, result.retired], [[], [], []]);
  assertClose(result.floor, canonicalFloor(floor));
  return result;
}
