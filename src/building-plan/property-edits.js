import { wallSide } from './wall-sides.js';
import { propertySpecification, nodeSubjects } from './inheritance.js';
import { copyBuildingPlanData as copy, findFace, findRoom, findWall, planIssue } from './model.js';

/** Answer edits of the property operations, shared by today's engine and the derived core. */

function failOperation(code, message, subject = null, details = {}) {
  const error = new Error(message);
  error.issues = [planIssue(code, message, subject, details)];
  throw error;
}

const scalarKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function propertyKey(key) {
  if (typeof key !== 'string' || !key || scalarKeys.has(key))
    failOperation('invalid_property', 'A valid declared property name is required.');
}

/** The subject a property or value operation addresses: node, wall, side, room or floor. */
export function operationSubject(floor, operation, specification = {}) {
  if (operation.nodeKey && !['walls', 'physical_walls', 'wall_sides'].includes(operation.nodeKey)) {
    const subject = nodeSubjects(floor, operation.nodeKey).find(
      ({ subject }) => subject.id === (operation.elementId || operation.roomId || floor.id)
    )?.subject;
    if (!subject) failOperation('missing_subject', 'The selected element no longer exists.');
    return subject;
  }
  if (operation.faceId) {
    const { face, wall } = findFace(floor, operation.faceId);
    return ['wall_face', 'room_face'].includes(operation.scope || specification.scope)
      ? wallSide(floor, face, operation.outside)
      : wall;
  }
  if (operation.wallId) {
    const wall = findWall(floor, operation.wallId);
    if (operation.sideId) return wall.sides.find((side) => side.id === operation.sideId);
    return wall;
  }
  return operation.roomId ? findRoom(floor, operation.roomId) : floor;
}

/**
 * Apply `set_property`, `set_defaults` or `set_provider` to the stored floor's subject: an override,
 * an inherited default, or a provider field's value (or their reset). Refuses undeclared
 * properties and providers with today's codes.
 */
export function applyProperty(floor, operation, specifications) {
  propertyKey(operation.property);
  if (operation.segmentId)
    failOperation(
      'segment_property_removed',
      'Physical properties belong to one complete wall piece in version 2.'
    );
  const specification = propertySpecification(
    specifications,
    operation.property,
    operation.nodeKey || 'walls',
    operation.scope
  );
  if (!specification && operation.type !== 'set_provider')
    failOperation('unknown_property', 'Choose a declared property.');
  const subject = operationSubject(floor, operation, specification);
  if (!subject) failOperation('missing_surface', 'This wall has no uncovered outside surface.');
  if (operation.type === 'set_provider') {
    const declared = Object.values(specifications).some((spec) =>
      spec.providers?.some(
        (provider) =>
          provider.sourceNode === operation.nodeKey &&
          provider.property === operation.property &&
          provider.sourceOriginalDataName === operation.fieldName
      )
    );
    if (!declared)
      failOperation('unknown_provider', 'Choose a declared BuildingPlan source field.');
    subject.providerOverrides ||= {};
    subject.values ||= {};
    const name = operation.fieldName;
    propertyKey(name);
    if (operation.reset) {
      delete subject.providerOverrides[name];
      delete subject.values[name];
    } else {
      subject.providerOverrides[name] = copy(operation.value);
      subject.values[name] = copy(operation.value);
    }
    return;
  }
  const target =
    operation.type === 'set_defaults' ? (subject.defaults ||= {}) : (subject.overrides ||= {});
  if (operation.type === 'set_defaults' && !specification.inherit)
    failOperation('property_not_inheritable', 'This property does not accept inherited defaults.');
  if (operation.reset) delete target[operation.property];
  else target[operation.property] = copy(operation.value);
}
