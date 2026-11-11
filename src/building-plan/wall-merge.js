import { GEOMETRY_EPSILON as EPS, at, dot, project, segmentFrame } from './geometry.js';
import { copyBuildingPlanData as copy, equalValue, own, planIssue } from './model.js';
import { mergeWallSides } from './wall-sides.js';
const failOperation = (code, message, subject = null, details = {}) => {
  throw Object.assign(new Error(message), { issues: [planIssue(code, message, subject, details)] });
};
const propertyKey = (key) => {
  if (typeof key !== 'string' || !key || ['__proto__', 'prototype', 'constructor'].includes(key))
    failOperation('invalid_property', 'A valid declared property name is required.');
};

export function mergeWalls(floor, reference, other, resolutions, createId) {
  if (reference.id === other.id) return reference;
  if (reference.segments.length !== 1 || other.segments.length !== 1)
    failOperation(
      'complex_wall_merge',
      'Join one pair of straight construction segments at a time.'
    );
  const a = reference.segments[0],
    b = other.segments[0];
  const frame = segmentFrame(a.start, a.end);
  const otherFrame = segmentFrame(b.start, b.end);
  if (
    Math.abs(dot(frame.normal, otherFrame.tangent)) > EPS ||
    Math.abs(project(frame, b.start).offset) > EPS
  )
    failOperation('unaligned_walls', 'The wall axes must align before joining.');
  const sideMap = mergeWallAnswers(
    reference,
    other,
    dot(frame.tangent, otherFrame.tangent) >= 0 ? 1 : -1,
    resolutions
  );
  for (const room of floor.rooms)
    for (const face of room.faces)
      if (face.wallId === other.id && sideMap.has(face.sideId))
        face.sideId = sideMap.get(face.sideId);
  const projectedB = [project(frame, b.start).along, project(frame, b.end).along];
  const from = Math.min(0, ...projectedB),
    to = Math.max(frame.length, ...projectedB);
  if (Math.min(frame.length, Math.max(...projectedB)) < Math.max(0, Math.min(...projectedB)) - EPS)
    failOperation(
      'disconnected_walls',
      'Only touching or overlapping wall segments can be joined.'
    );
  for (const collection of ['doors', 'windows']) {
    for (const opening of reference[collection]) opening.offset -= from;
    for (const opening of other[collection]) {
      const start = project(frame, at(otherFrame, opening.offset)).along;
      const end = project(frame, at(otherFrame, opening.offset + opening.width)).along;
      reference[collection].push({
        ...copy(opening),
        segmentId: a.id,
        offset: Math.min(start, end) - from,
      });
    }
  }
  a.start = at(frame, from);
  a.end = at(frame, to);
  reference.lineage = {
    ...(reference.lineage || {}),
    mergedWallIds: [...(reference.lineage?.mergedWallIds || []), other.id],
  };
  for (const room of floor.rooms) {
    for (const face of room.faces) if (face.wallId === other.id) face.wallId = reference.id;
    for (const edge of room.edges)
      if (edge.profile?.wallId === other.id) {
        edge.profile.wallId = reference.id;
        edge.profile.sideSign *= dot(frame.tangent, otherFrame.tangent) >= 0 ? 1 : -1;
      }
  }

  floor.walls = floor.walls.filter((wall) => wall.id !== other.id);
  return reference;
}

/**
 * Join the answers of two physical walls onto the reference: values, explicit providers,
 * overrides, custom rows and both canonical sides. Every answer survives or the join is refused
 * (`conflicting_wall_answers`, `conflicting_wall_properties`, `conflicting_wall_records`,
 * `conflicting_surface_answers`); `resolutions` settle chosen keys. Geometry is not touched.
 *
 * @param {Object} reference Surviving wall; receives the answers.
 * @param {Object} other Joined wall.
 * @param {1|-1} direction Whether the other wall runs the same way (1) or opposite (-1).
 * @param {Object} [resolutions] Chosen values per property, applied as answers.
 * @returns {Map<string, string>} The other wall's side IDs mapped to the reference's.
 */
export function mergeWallAnswers(reference, other, direction, resolutions = {}) {
  const sideMap = mergeWallSides(reference, other, direction);
  const valueKeys = new Set([
    ...Object.keys(reference.values || {}),
    ...Object.keys(other.values || {}),
  ]);
  for (const key of valueKeys) {
    if (own(resolutions, key)) reference.values[key] = copy(resolutions[key]);
    else if (
      own(reference.values, key) &&
      own(other.values, key) &&
      !equalValue(reference.values[key], other.values[key])
    )
      failOperation(
        'conflicting_wall_answers',
        'Resolve the differing accepted answers before joining these physical walls.',
        { type: 'wall', id: reference.id },
        { property: key }
      );
    else if (!own(reference.values, key)) reference.values[key] = copy(other.values[key]);
  }
  reference.repeatable ||= {};
  for (const [name, rows] of Object.entries(other.repeatable || {})) {
    if (
      reference.repeatable[name]?.length &&
      rows.length &&
      !equalValue(reference.repeatable[name], rows)
    )
      failOperation(
        'conflicting_wall_records',
        'Resolve custom records on these physical walls before joining them.',
        { type: 'wall', id: reference.id },
        { collection: name }
      );
    if (rows.length) reference.repeatable[name] = copy(rows);
  }
  reference.providerOverrides ||= {};
  for (const [key, value] of Object.entries(other.providerOverrides || {})) {
    if (
      own(reference.providerOverrides, key) &&
      !equalValue(reference.providerOverrides[key], value)
    )
      failOperation(
        'conflicting_wall_answers',
        'Resolve the differing explicit providers before joining these walls.',
        { type: 'wall', id: reference.id },
        { property: key }
      );
    reference.providerOverrides[key] = copy(value);
  }
  const keys = new Set([
    ...Object.keys(reference.overrides),
    ...Object.keys(other.overrides || {}),
  ]);
  for (const key of keys) {
    if (own(resolutions, key)) reference.overrides[key] = copy(resolutions[key]);
    else if (
      own(reference.overrides, key) &&
      own(other.overrides, key) &&
      !equalValue(reference.overrides[key], other.overrides[key])
    )
      failOperation(
        'conflicting_wall_properties',
        'Choose one value before joining the physical walls.',
        { type: 'wall', id: reference.id },
        { property: key, values: [reference.overrides[key], other.overrides[key]] }
      );
    else if (!own(reference.overrides, key)) reference.overrides[key] = copy(other.overrides[key]);
  }
  for (const [key, value] of Object.entries(resolutions || {})) {
    propertyKey(key);
    if (!valueKeys.has(key)) reference.overrides[key] = copy(value);
  }
  return sideMap;
}
