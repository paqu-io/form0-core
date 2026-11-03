import { BUILDING_PLAN_BLUEPRINT } from './building-plan-blueprint.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const WALL_PROPERTIES = ['wall_thickness_m', 'wall_height_m'];
const INHERITABLE_TYPES = new Set([
  'TextField',
  'NumericField',
  'BooleanField',
  'SingleChoiceField',
  'MultiChoiceField',
]);

function storageField(name, label) {
  const template = clone(
    BUILDING_PLAN_BLUEPRINT.nodes.walls.mandatory_elements.find(
      (field) => field.data_name === 'wall_geometry'
    )
  );
  return { ...template, key: `bp_${name}`, data_name: name, label, required: false };
}

function repeatableNode(name, label, fields = [], children = []) {
  const repeatable = clone(BUILDING_PLAN_BLUEPRINT.nodes.walls.repeatable);
  return {
    repeatable: {
      ...repeatable,
      key: `bp_${name}`,
      data_name: `building_plan_${name}`,
      label,
      description: null,
      description_mode: null,
    },
    mandatory_elements: fields,
    extra_elements: [],
    children,
    canvas: null,
    fieldRoles: {},
  };
}

export function validateBuildingPlanBindings(overrides) {
  const errors = [];
  const properties = new Set(WALL_PROPERTIES);
  for (const [nodeKey, override] of Object.entries(overrides || {})) {
    if (!override || (nodeKey !== 'walls' && !override.field_bindings)) continue;
    if (
      nodeKey !== 'walls' ||
      (override.field_bindings != null && typeof override.field_bindings !== 'object') ||
      Array.isArray(override.field_bindings)
    ) {
      errors.push('BuildingPlan field_bindings must be an object on the walls node.');
      continue;
    }
    const fields = new Map(
      (override.extra_elements || []).map((field) => [field.data_name, field])
    );
    for (const field of override.extra_elements || []) {
      const binding = override.field_bindings?.[field.data_name];
      const property = binding?.property || field.data_name;
      if (properties.has(property))
        errors.push(`BuildingPlan property "${property}" must have one unambiguous field binding.`);
      properties.add(property);
    }
    for (const [name, binding] of Object.entries(override.field_bindings || {})) {
      const field = fields.get(name);
      if (
        !field ||
        !binding ||
        typeof binding !== 'object' ||
        !['physical_wall', 'room_face', 'observation'].includes(binding.scope)
      ) {
        errors.push(
          `BuildingPlan binding "${name}" must name a custom wall field and a supported scope.`
        );
        continue;
      }
      if (binding.inherit != null && typeof binding.inherit !== 'boolean')
        errors.push(`BuildingPlan binding "${name}" inherit must be boolean.`);
      if (
        binding.inherit &&
        (!INHERITABLE_TYPES.has(field.type) || binding.scope === 'observation')
      )
        errors.push(
          `BuildingPlan field "${name}" cannot inherit observation/evidence or computed values.`
        );
      if (
        binding.property != null &&
        (typeof binding.property !== 'string' ||
          !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(binding.property) ||
          ['constructor', 'prototype', '__proto__'].includes(binding.property))
      )
        errors.push(`BuildingPlan field "${name}" has an invalid semantic property name.`);
    }
  }
  return errors;
}

/** Authoring nodes stay familiar; storage ownership is explicit in expansion metadata. */
export function createBuildingPlanBlueprint(overrides = {}) {
  const errors = validateBuildingPlanBindings(overrides);
  if (errors.length) throw new TypeError(errors.join('\n'));
  const blueprint = clone(BUILDING_PLAN_BLUEPRINT);
  blueprint.version = 1;
  const physical = clone(blueprint.nodes.walls);
  physical.repeatable.key = 'bp_physical_walls';
  physical.repeatable.data_name = 'building_plan_physical_walls';
  physical.repeatable.label = 'Physical walls';
  physical.canvas = null;
  physical.extra_elements = [];
  physical.fieldRoles = {};
  physical.role = 'physical_walls';
  const face = blueprint.nodes.walls;
  face.mandatory_elements = [];
  face.extra_elements = [];
  face.children = ['face_doors', 'face_windows', 'face_observations'];
  face.fieldRoles = {};
  face.role = 'room_faces';

  const addStorage = (node, name) => {
    node.mandatory_elements.push(storageField(name, 'Building plan model'));
    node.fieldRoles ||= {};
    node.fieldRoles[name] = { role: 'storage' };
  };
  addStorage(blueprint.nodes.floors, 'floor_model');
  addStorage(blueprint.nodes.rooms, 'room_model');
  addStorage(physical, 'wall_model');
  addStorage(face, 'wall_face_model');
  for (const node of ['columns', 'beams', 'objects', 'doors', 'windows'])
    addStorage(blueprint.nodes[node], `${node}_model`);

  const custom = overrides.walls?.extra_elements || [];
  const bindings = overrides.walls?.field_bindings || {};
  const inheritable = [];
  for (const field of physical.mandatory_elements.filter(
    (item) => item.data_name !== 'wall_model'
  )) {
    const property = field.data_name;
    const role =
      property === 'wall_geometry'
        ? 'geometry'
        : WALL_PROPERTIES.includes(property)
          ? 'property'
          : 'value';
    physical.fieldRoles[property] = {
      role,
      scope: 'physical_wall',
      property,
      inherit: WALL_PROPERTIES.includes(property),
    };
    const projected = clone(field);
    face.mandatory_elements.push(projected);
    face.fieldRoles[property] = {
      role: 'projection',
      sourceNode: 'physical_walls',
      sourceOriginalDataName: property,
      scope: 'physical_wall',
      property,
      inherit: WALL_PROPERTIES.includes(property),
      storageRole: role,
    };
    if (WALL_PROPERTIES.includes(property))
      inheritable.push({ field, scope: 'physical_wall', property });
  }
  for (const field of custom) {
    const binding = { scope: 'room_face', inherit: false, ...bindings[field.data_name] };
    const property = binding.property || field.data_name;
    if (binding.scope === 'physical_wall') {
      physical.extra_elements.push(clone(field));
      physical.fieldRoles[field.data_name] = {
        ...binding,
        role: field.type === 'CalculatedField' ? 'calculation' : 'property',
        property,
      };
      face.extra_elements.push(clone(field));
      face.fieldRoles[field.data_name] = {
        ...binding,
        property,
        role: 'projection',
        sourceNode: 'physical_walls',
        sourceOriginalDataName: field.data_name,
        storageRole: 'property',
      };
    } else if (binding.scope === 'room_face') {
      face.extra_elements.push(clone(field));
      face.fieldRoles[field.data_name] = { ...binding, role: 'property', property };
    }
    if (binding.inherit) inheritable.push({ field, scope: binding.scope, property });
  }
  blueprint.nodes.physical_walls = physical;
  blueprint.nodes.floors.children = ['physical_walls', 'observations', 'rooms'];

  for (const node of ['floors', 'rooms']) {
    blueprint.nodes[node].fieldRoles ||= {};
    for (const { field, scope, property } of inheritable) {
      const definition = clone(field);
      definition.key = `bp_default_${property}`;
      definition.data_name = `default_${property}`;
      definition.label = `Default ${field.label.charAt(0).toLowerCase()}${field.label.slice(1)}`;
      definition.required = false;
      definition.required_conditions = null;
      definition.default_value = null;
      blueprint.nodes[node].mandatory_elements.push(definition);
      blueprint.nodes[node].fieldRoles[definition.data_name] = {
        role: 'default',
        scope,
        property,
        sourceOriginalDataName: field.data_name,
      };
    }
  }

  const observation = repeatableNode('observations', 'Observations', [
    storageField('observation_model', 'Observation context'),
  ]);
  observation.role = 'observations';
  observation.fieldRoles.observation_model = { role: 'storage' };
  observation.extra_elements = custom
    .filter((field) => bindings[field.data_name]?.scope === 'observation')
    .map(clone);
  for (const field of observation.extra_elements)
    observation.fieldRoles[field.data_name] = {
      role: 'value',
      scope: 'observation',
      property: field.data_name,
    };
  blueprint.nodes.observations = observation;

  for (const node of ['doors', 'windows']) {
    const prefix = node === 'doors' ? 'door' : 'window';
    const template = clone(
      blueprint.nodes[node].mandatory_elements.find(
        (field) => field.data_name === `${prefix}_width_m`
      )
    );
    blueprint.nodes[node].mandatory_elements.push({
      ...template,
      key: `bp_${prefix}_offset_m`,
      data_name: `${prefix}_offset_m`,
      label: 'Distance from wall start (m)',
      min: 0,
    });
    blueprint.nodes[node].fieldRoles ||= {};
    for (const field of blueprint.nodes[node].mandatory_elements) {
      if (field.data_name.endsWith('_ratio') || field.data_name.endsWith('_segment_index'))
        blueprint.nodes[node].fieldRoles[field.data_name] = {
          role: 'derived',
          scope: node,
          property: field.data_name,
        };
      if (field.data_name.endsWith('_wall_reference'))
        blueprint.nodes[node].fieldRoles[field.data_name] = {
          role: 'reference',
          scope: node,
          property: field.data_name,
        };
    }
  }

  for (const [name, source] of [
    ['face_doors', 'doors'],
    ['face_windows', 'windows'],
    ['face_observations', 'observations'],
  ]) {
    const projected = clone(blueprint.nodes[source]);
    projected.extra_elements = clone(overrides[source]?.extra_elements || projected.extra_elements);
    projected.repeatable.key = `bp_${name}`;
    projected.repeatable.data_name = `building_plan_${name}`;
    projected.role = 'projection';
    projected.sourceNode = source;
    projected.fieldRoles = {};
    for (const field of [...projected.mandatory_elements, ...projected.extra_elements])
      projected.fieldRoles[field.data_name] = {
        role: 'projection',
        sourceNode: source,
        sourceOriginalDataName: field.data_name,
        storageRole: blueprint.nodes[source].fieldRoles?.[field.data_name]?.role || 'value',
      };
    blueprint.nodes[name] = projected;
  }

  blueprint.nodes.rooms.fieldRoles.room_vertices = { role: 'geometry' };
  // Field scopes are compiled here; do not merge wall extras a second time.
  const compiledOverrides = clone(overrides);
  if (compiledOverrides.walls) delete compiledOverrides.walls.extra_elements;
  return { blueprint, overrides: compiledOverrides };
}
