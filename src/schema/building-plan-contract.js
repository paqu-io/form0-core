import { BUILDING_PLAN_BLUEPRINT } from './building-plan-blueprint.js';
import { FLOOR_SYSTEM_ROUTES } from './building-plan-floors.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const NODE_KEYS = Object.keys(BUILDING_PLAN_BLUEPRINT.nodes);
const PARENT = {
  rooms: 'floors',
  columns: 'rooms',
  beams: 'rooms',
  objects: 'rooms',
  walls: 'rooms',
  doors: 'walls',
  windows: 'walls',
};
const SCALAR_TYPES = new Set([
  'TextField',
  'NumericField',
  'BooleanField',
  'SingleChoiceField',
  'MultiChoiceField',
  'DateField',
  'TimeField',
]);
const WALL_PROPERTIES = new Set(['wall_thickness_m', 'wall_height_m']);
const systemDestination = (node, property) =>
  Object.values(FLOOR_SYSTEM_ROUTES).some(
    (route) =>
      route.inherit_to === node &&
      (route.property === property ||
        (route.scope === 'wall_face' && `${route.property}_outside` === property))
  );
const validProperty = (name) =>
  typeof name === 'string' &&
  /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name) &&
  !['constructor', 'prototype', '__proto__'].includes(name);
const descendant = (source, target) => {
  while ((target = PARENT[target])) if (target === source) return true;
  return false;
};
const storage = (name) => ({
  ...clone(
    BUILDING_PLAN_BLUEPRINT.nodes.walls.mandatory_elements.find(
      (field) => field.data_name === 'wall_geometry'
    )
  ),
  key: `bp_${name}`,
  data_name: name,
  label: 'Building plan model',
  required: false,
});
const specKey = (node, scope, property) =>
  node === 'walls' && scope === 'physical_wall' ? property : `${node}:${scope}:${property}`;

function walk(elements, visit, inRepeatable = false, inheritedScope = null) {
  for (const field of elements || []) {
    visit(field, inRepeatable, inheritedScope);
    if (field?.elements)
      walk(
        field.elements,
        visit,
        inRepeatable || field.type === 'RepeatableSection',
        field.building_plan?.scope || inheritedScope
      );
  }
}

function sourceConditionFields(overrides, nodeKey) {
  const fields = {};
  for (const ancestor of NODE_KEYS) {
    if (ancestor !== nodeKey && !descendant(ancestor, nodeKey)) continue;
    walk(
      [
        ...BUILDING_PLAN_BLUEPRINT.nodes[ancestor].mandatory_elements,
        ...(overrides[ancestor]?.extra_elements || []),
      ],
      (field, nested) => {
        if (nested || !SCALAR_TYPES.has(field?.type) || internalField(field)) return;
        if (field.key) fields[field.key] = field;
        if (field.data_name) fields[field.data_name] = field;
      }
    );
  }
  return fields;
}
function validSourceConditions(conditions, fields) {
  if (Array.isArray(conditions))
    return (
      conditions.length > 0 && conditions.every((entry) => validSourceConditions(entry, fields))
    );
  if (!conditions || typeof conditions !== 'object') return false;
  if (conditions.and || conditions.or)
    return (
      Object.keys(conditions).length === 1 &&
      validSourceConditions(conditions.and || conditions.or, fields)
    );
  return (
    Boolean(fields[conditions.field_id]) &&
    [
      'equal_to',
      'not_equal_to',
      'greater_than',
      'less_than',
      'greater_or_equal_than',
      'less_or_equal_than',
      'contains',
      'starts_with',
      'is_empty',
      'is_not_empty',
    ].includes(conditions.operator)
  );
}

export function validateBuildingPlanBindings(overrides) {
  const errors = [];
  for (const [node, config] of Object.entries(overrides || {})) {
    if (
      !NODE_KEYS.includes(node) ||
      !config ||
      typeof config !== 'object' ||
      Array.isArray(config)
    ) {
      errors.push('Choose a predefined BuildingPlan node.');
      continue;
    }
    for (const key of Object.keys(config))
      if (!['extra_elements', 'canvas', 'system_bindings', 'property_overrides'].includes(key))
        errors.push(`BuildingPlan node ${node} cannot redefine managed ${key}.`);
    if (config.extra_elements != null && !Array.isArray(config.extra_elements)) {
      errors.push('extra_elements must be an array.');
      continue;
    }
    walk(config.extra_elements, (field, nested, inheritedScope) => {
      if (
        !field ||
        typeof field !== 'object' ||
        field.type === 'BuildingPlanSection' ||
        systemDestination(node, field.data_name) ||
        /^~?bp_/.test(field.key || '') ||
        BUILDING_PLAN_BLUEPRINT.nodes[node].mandatory_elements.some(
          (managed) =>
            managed.data_name === field.data_name &&
            !(node === 'objects' && managed.data_name === 'object_category')
        )
      ) {
        errors.push(
          'Custom content cannot redefine managed BuildingPlan fields or structural nodes.'
        );
        return;
      }
      const binding = field.building_plan;
      if (!binding) return;
      if (typeof binding !== 'object' || Array.isArray(binding)) {
        errors.push('BuildingPlan field settings must be an object.');
        return;
      }
      if (
        Object.keys(binding).some(
          (key) => !['property', 'scope', 'inherit_to', 'applies_to', 'on_split'].includes(key)
        )
      )
        errors.push('Unknown BuildingPlan field setting.');
      if (!validProperty(binding.property || field.data_name))
        errors.push('Choose a valid semantic property name.');
      if (binding.scope && !['physical_wall', 'wall_face'].includes(binding.scope))
        errors.push('Choose physical_wall or wall_face ownership.');
      if (nested && inheritedScope && binding.scope && inheritedScope !== binding.scope)
        errors.push('A custom repeatable cannot mix answer owners.');
      if (binding.on_split && !['copy', 'confirm'].includes(binding.on_split))
        errors.push('on_split must be copy or confirm.');
      if (
        binding.inherit_to &&
        (!descendant(node, binding.inherit_to) || !SCALAR_TYPES.has(field.type) || nested)
      )
        errors.push(
          'Inheritance requires a compatible value field and one predefined descendant, outside custom repeatable rows.'
        );
      const filter = binding.applies_to;
      if (
        filter?.conditions &&
        !validSourceConditions(filter.conditions, sourceConditionFields(overrides, node))
      )
        errors.push(
          'Applicability conditions may reference only scalar values in the source or its predefined ancestors.'
        );
      if (
        filter &&
        (typeof filter !== 'object' ||
          Array.isArray(filter) ||
          Object.keys(filter).some((key) => !['exposure', 'surface', 'conditions'].includes(key)) ||
          (filter.exposure && !['interior', 'exterior'].includes(filter.exposure)) ||
          (filter.surface && !['room', 'outside'].includes(filter.surface)))
      )
        errors.push('Choose valid BuildingPlan applicability filters.');
      if (
        WALL_PROPERTIES.has(binding.property) &&
        binding.scope &&
        binding.scope !== 'physical_wall'
      )
        errors.push('System wall dimensions belong to the physical wall.');
    });
    for (const [name, binding] of Object.entries(config.system_bindings || {})) {
      if (
        binding?.applies_to?.conditions &&
        !validSourceConditions(
          binding.applies_to.conditions,
          sourceConditionFields(overrides, node)
        )
      )
        errors.push('System routing conditions must remain within the source context.');
      if (binding?.property && !validProperty(binding.property))
        errors.push('Choose a valid semantic property name.');
      if (
        !BUILDING_PLAN_BLUEPRINT.nodes[node].mandatory_elements.some(
          (field) =>
            field.data_name === name &&
            !internalField(field) &&
            !(node === 'objects' && name === 'object_category')
        ) ||
        !binding ||
        Object.keys(binding).some(
          (key) => !['inherit_to', 'property', 'applies_to'].includes(key)
        ) ||
        (binding.inherit_to && !descendant(node, binding.inherit_to))
      )
        errors.push('System routing may only reference an existing system field and a descendant.');
    }
    for (const [property, override] of Object.entries(config.property_overrides || {})) {
      if (
        systemDestination(node, property) ||
        BUILDING_PLAN_BLUEPRINT.nodes[node].mandatory_elements.some(
          (field) =>
            field.data_name === property && !(node === 'objects' && property === 'object_category')
        )
      )
        errors.push('System controls have protected presentation and placement.');
      if (
        (override?.section_key && typeof override.section_key !== 'string') ||
        (override?.order != null && (!Number.isInteger(override.order) || override.order < 0))
      )
        errors.push('Choose a valid custom Section and a nonnegative placement order.');
      if (
        !override ||
        Object.keys(override).some(
          (key) =>
            ![
              'label',
              'description',
              'description_mode',
              'visible',
              'visible_conditions',
              'required',
              'required_conditions',
              'read_only',
              'read_only_conditions',
              'section_key',
              'order',
            ].includes(key)
        )
      )
        errors.push('Custom property overrides are presentation/placement settings only.');
    }
  }
  return errors;
}

function internalField(field) {
  return (
    field.data_name.endsWith('_model') ||
    field.data_name === 'wall_geometry' ||
    field.data_name === 'room_vertices' ||
    /_(?:u|v|ratio|segment_index|wall_reference)$/.test(field.data_name)
  );
}

/** Compiler-owned structure; authors supply only custom content and binding references. */
export function createBuildingPlanBlueprint(overrides = {}) {
  const errors = validateBuildingPlanBindings(overrides);
  if (errors.length) throw new TypeError(errors.join('\n'));
  const blueprint = clone(BUILDING_PLAN_BLUEPRINT);
  blueprint.version = 2;
  blueprint.properties = {};
  for (const [name, node] of Object.entries(blueprint.nodes)) {
    node.fieldRoles = {};
    node.extra_elements = clone(overrides[name]?.extra_elements || []);
    node.role = name;
    node.mandatory_elements.push(
      storage(`${name === 'floors' ? 'floor' : name === 'rooms' ? 'room' : name}_model`)
    );
    for (const field of node.mandatory_elements) {
      const internal = internalField(field);
      if (name !== 'floors' || internal) {
        field.required = !internal;
        field.required_conditions = null;
        field.visible = !internal;
        field.visible_conditions = null;
      }
      if (internal && field.read_only !== undefined) field.read_only = true;
      node.fieldRoles[field.data_name] = {
        role: field.data_name.endsWith('_model')
          ? 'storage'
          : field.data_name === 'room_vertices' || /_(?:u|v)$/.test(field.data_name)
            ? 'geometry'
            : internal
              ? 'derived'
              : 'value',
        system: true,
      };
    }
  }
  // Category is survey vocabulary, never a managed construction-type catalog.
  const objectCategory = blueprint.nodes.objects.mandatory_elements.find(
    (field) => field.data_name === 'object_category'
  );
  blueprint.nodes.objects.mandatory_elements = blueprint.nodes.objects.mandatory_elements.filter(
    (field) => field !== objectCategory
  );
  delete blueprint.nodes.objects.fieldRoles.object_category;
  for (const node of ['doors', 'windows']) {
    const prefix = node === 'doors' ? 'door' : 'window';
    const field = clone(
      blueprint.nodes[node].mandatory_elements.find(
        (field) => field.data_name === `${prefix}_width_m`
      )
    );
    Object.assign(field, {
      key: `bp_${prefix}_offset_m`,
      data_name: `${prefix}_offset_m`,
      label: 'Distance from wall start (m)',
      min: 0,
    });
    blueprint.nodes[node].mandatory_elements.push(field);
    blueprint.nodes[node].fieldRoles[field.data_name] = { role: 'value', system: true };
  }
  const physical = clone(blueprint.nodes.walls);
  physical.repeatable.key = 'bp_physical_walls';
  physical.repeatable.data_name = 'building_plan_physical_walls';
  physical.repeatable.label = 'Physical walls';
  physical.role = 'physical_walls';
  physical.canvas = null;
  physical.extra_elements = [];
  // Preserve the established wall model key, independent of its editing projection.
  physical.mandatory_elements.find((field) => field.data_name === 'walls_model').data_name =
    'wall_model';
  physical.mandatory_elements.find((field) => field.data_name === 'wall_model').key =
    'bp_wall_model';
  delete physical.fieldRoles.walls_model;
  physical.fieldRoles.wall_model = { role: 'storage', system: true };
  const face = blueprint.nodes.walls;
  face.mandatory_elements = [storage('wall_face_model')];
  face.fieldRoles = { wall_face_model: { role: 'storage', system: true } };
  face.extra_elements = [];
  face.children = ['face_doors', 'face_windows'];
  face.role = 'room_faces';
  const sides = {
    repeatable: {
      ...clone(face.repeatable),
      key: 'bp_wall_sides',
      data_name: 'building_plan_wall_sides',
      label: 'Wall sides',
    },
    role: 'wall_sides',
    canvas: null,
    children: [],
    extra_elements: [],
    mandatory_elements: [storage('wall_side_model')],
    fieldRoles: { wall_side_model: { role: 'storage', system: true } },
  };
  blueprint.nodes.physical_walls = physical;
  blueprint.nodes.wall_sides = sides;
  physical.children = ['wall_sides', 'doors', 'windows'];
  blueprint.nodes.floors.children = ['physical_walls', 'rooms'];
  for (const field of physical.mandatory_elements) {
    if (field.data_name === 'wall_model') continue;
    const property = field.data_name;
    const role =
      property === 'wall_geometry'
        ? 'geometry'
        : WALL_PROPERTIES.has(property)
          ? 'property'
          : 'value';
    physical.fieldRoles[property] = {
      role,
      scope: 'physical_wall',
      property,
      inherit: WALL_PROPERTIES.has(property),
      system: true,
    };
    face.mandatory_elements.push(clone(field));
    face.fieldRoles[property] = {
      role: 'projection',
      sourceNode: 'physical_walls',
      sourceOriginalDataName: property,
      scope: 'physical_wall',
      property,
      storageRole: role,
      inherit: WALL_PROPERTIES.has(property),
      system: true,
    };
    if (WALL_PROPERTIES.has(property))
      blueprint.properties[property] = {
        property,
        nodeKey: 'walls',
        scope: 'physical_wall',
        inherit: true,
        fallback: property === 'wall_thickness_m' ? 0.2 : null,
        field: clone(field),
        providers: [],
      };
  }
  const definitions = new Map();
  const providers = [];
  const register = (nodeKey, field, binding, provider = null) => {
    const scope = nodeKey === 'walls' ? binding.scope || 'wall_face' : 'node';
    const property = binding.property || field.data_name;
    if (
      nodeKey === 'walls' &&
      [...definitions.values()].some(
        (entry) => entry.nodeKey === nodeKey && entry.property === property && entry.scope !== scope
      )
    )
      throw new TypeError(`Choose one owner for semantic wall property ${property}.`);
    const key = specKey(nodeKey, scope, property);
    let specification = blueprint.properties[key];
    if (specification) {
      const prior = specification.field;
      if (
        prior.type !== field.type ||
        JSON.stringify(prior.choices?.map((choice) => choice.value) || null) !==
          JSON.stringify(field.choices?.map((choice) => choice.value) || null)
      )
        throw new TypeError(
          `Default providers for ${property} need one compatible field definition.`
        );
    } else {
      specification = {
        property,
        nodeKey,
        scope,
        inherit: Boolean(provider),
        fallback: field.default_value ?? null,
        field: clone(field),
        providers: [],
        on_split: binding.on_split || 'confirm',
        applies_to: clone(binding.applies_to || {}),
      };
      blueprint.properties[key] = specification;
    }
    if (provider) {
      specification.inherit = true;
      specification.providers.push(provider);
    }
    definitions.set(key, { nodeKey, field, binding, scope, property, specification });
    return specification;
  };
  for (const [name, route] of Object.entries(FLOOR_SYSTEM_ROUTES)) {
    const field = blueprint.nodes.floors.mandatory_elements.find(
      (field) => field.data_name === name
    );
    providers.push({
      sourceNode: 'floors',
      sourceOriginalDataName: name,
      ...clone(route),
      destination: route.inherit_to,
      field: clone(field),
      system: true,
      conditionFields: clone(sourceConditionFields(overrides, 'floors')),
    });
  }
  for (const nodeKey of NODE_KEYS) {
    const source = overrides[nodeKey]?.extra_elements || blueprint.nodes[nodeKey].extra_elements;
    const conditionFields = clone(sourceConditionFields(overrides, nodeKey));
    walk(source, (field, nested, inheritedScope) => {
      if (!field?.building_plan && nodeKey !== 'walls') return;
      const binding = {
        scope: WALL_PROPERTIES.has(field.building_plan?.property)
          ? 'physical_wall'
          : inheritedScope || 'wall_face',
        ...field.building_plan,
      };
      const property = binding.property || field.data_name;
      if (binding.inherit_to)
        providers.push({
          sourceNode: nodeKey,
          sourceOriginalDataName: field.data_name,
          property,
          scope: binding.scope,
          applies_to: clone(binding.applies_to || {}),
          field: clone(field),
          conditionFields,
          destination: binding.inherit_to,
        });
      if (
        nodeKey === 'walls' &&
        !nested &&
        !['Section', 'RepeatableSection', 'CalculatedField', 'LabelField'].includes(field.type)
      )
        register(nodeKey, field, binding);
      else if (
        field.building_plan &&
        !binding.inherit_to &&
        !nested &&
        !['Section', 'RepeatableSection', 'CalculatedField', 'LabelField'].includes(field.type)
      )
        register(nodeKey, field, binding);
    });
    for (const [name, binding] of Object.entries(overrides[nodeKey]?.system_bindings || {})) {
      const field = BUILDING_PLAN_BLUEPRINT.nodes[nodeKey].mandatory_elements.find(
        (entry) => entry.data_name === name
      );
      if (binding.inherit_to) {
        const fixed = providers.findIndex(
          (provider) =>
            provider.system &&
            provider.sourceNode === nodeKey &&
            provider.sourceOriginalDataName === name
        );
        if (fixed >= 0) providers.splice(fixed, 1);
        providers.push({
          sourceNode: nodeKey,
          sourceOriginalDataName: name,
          property: binding.property || name,
          field: clone(field),
          scope: FLOOR_SYSTEM_ROUTES[name]?.scope || 'physical_wall',
          system: true,
          applies_to: clone(binding.applies_to || {}),
          conditionFields,
          destination: binding.inherit_to,
        });
      }
    }
  }
  for (const provider of providers)
    register(
      provider.destination,
      provider.field,
      { property: provider.property, scope: provider.scope, on_split: provider.on_split },
      provider
    );
  // Build canonical custom field trees and their editing projections without flattening authored layout.
  const routeTree = (elements, nodeKey, scope, inheritedScope = null, outside = false) =>
    elements.flatMap((field) => {
      const config = {
        scope: WALL_PROPERTIES.has(field.building_plan?.property)
          ? 'physical_wall'
          : inheritedScope || 'wall_face',
        ...field.building_plan,
      };
      if (field.type === 'Section') {
        const elements = routeTree(field.elements || [], nodeKey, scope, config.scope, outside);
        return elements.length ? [{ ...clone(field), elements }] : [];
      }
      const chosen = config.scope;
      if (scope !== 'all' && chosen !== scope) return [];
      const result = clone(field);
      delete result.building_plan;
      const property = config.property || field.data_name;
      const target =
        nodeKey === 'physical_walls' ? physical : nodeKey === 'wall_sides' ? sides : face;
      const sourceName = outside ? `${field.data_name}_outside` : field.data_name;
      if (outside) {
        result.data_name = sourceName;
        result.key = `${field.key}_outside`;
      }
      if (field.type === 'RepeatableSection') {
        // Ordinary child records are owned by their canonical wall/side; projections share row IDs.
        result.building_plan_owner = undefined;
        delete result.building_plan_owner;
      }
      const definition = blueprint.properties[specKey('walls', chosen, property)];
      target.fieldRoles[sourceName] =
        nodeKey === 'walls'
          ? {
              role: 'projection',
              sourceNode: chosen === 'physical_wall' ? 'physical_walls' : 'wall_sides',
              sourceOriginalDataName: field.data_name,
              scope: chosen,
              property,
              storageRole:
                field.type === 'RepeatableSection'
                  ? 'collection'
                  : field.type === 'CalculatedField'
                    ? 'calculation'
                    : field.type === 'LabelField'
                      ? 'display'
                      : 'property',
              inherit: definition?.inherit === true,
              outside,
              on_split: config.on_split || 'confirm',
              applies_to: config.applies_to || {},
            }
          : {
              role:
                field.type === 'RepeatableSection'
                  ? 'collection'
                  : field.type === 'CalculatedField'
                    ? 'calculation'
                    : field.type === 'LabelField'
                      ? 'display'
                      : 'property',
              scope: chosen,
              property,
              inherit: definition?.inherit === true,
              on_split: config.on_split || 'confirm',
              applies_to: config.applies_to || {},
            };
      return [result];
    });
  const wallExtras = overrides.walls?.extra_elements || [];
  walk(wallExtras, (field, nested, inheritedScope) => {
    if (field.type !== 'RepeatableSection' || nested) return;
    const config = {
      scope: WALL_PROPERTIES.has(field.building_plan?.property)
        ? 'physical_wall'
        : inheritedScope || 'wall_face',
      ...field.building_plan,
    };
    const property = config.property || field.data_name;
    blueprint.properties[specKey('walls', config.scope, property)] = {
      property,
      nodeKey: 'walls',
      scope: config.scope,
      kind: 'collection',
      on_split: config.on_split || 'confirm',
    };
  });
  physical.extra_elements = routeTree(wallExtras, 'physical_walls', 'physical_wall');
  sides.extra_elements = routeTree(wallExtras, 'wall_sides', 'wall_face');
  face.extra_elements = [
    ...routeTree(wallExtras, 'walls', 'all'),
    ...routeTree(wallExtras, 'walls', 'wall_face', null, true),
  ];
  for (const [key, definition] of definitions) {
    const { nodeKey, property, scope, specification } = definition;
    const source =
      specification.providers.find((provider) => provider.system)?.field || definition.field;
    const target =
      nodeKey === 'walls'
        ? scope === 'physical_wall'
          ? physical
          : sides
        : blueprint.nodes[nodeKey];
    let existing = Object.entries(target.fieldRoles).find(([, role]) => role.property === property);
    const systemField = target.mandatory_elements.find((field) => field.data_name === property);
    if (!existing && systemField) {
      if (systemField.type !== source.type)
        throw new TypeError(`Provider type is incompatible with system property ${property}.`);
      target.fieldRoles[property] = {
        ...target.fieldRoles[property],
        role: 'property',
        property,
        scope,
        inherit: specification.inherit,
      };
      existing = [property, target.fieldRoles[property]];
    }
    if (!existing) {
      const field = clone(source);
      delete field.building_plan;
      field.data_name = property;
      field.key = `bp_custom_${property}`;
      field.visible = true;
      field.visible_conditions = null;
      const managed = specification.providers.some((provider) => provider.system);
      if (managed && property === 'wall_plaster') {
        field.label = 'Plaster';
        field.choices = [
          { value: 'plastered', label: 'Plastered' },
          { value: 'not_plastered', label: 'Not plastered' },
        ];
        field.required = false;
      }
      if (managed && property === 'wall_plaster_thickness') {
        field.label = 'Plaster thickness [mm]';
        field.required = false;
        field.visible = false;
        field.required_conditions = field.visible_conditions = {
          field_id: 'bp_custom_wall_plaster',
          operator: 'equal_to',
          value: 'plastered',
        };
      }
      field.read_only = false;
      field.read_only_conditions = null;
      (managed ? target.mandatory_elements : target.extra_elements).push(field);
      target.fieldRoles[property] = {
        role: 'property',
        property,
        scope,
        inherit: specification.inherit,
        on_split: specification.on_split || 'confirm',
        ...(managed ? { system: true } : {}),
      };
      if (nodeKey === 'walls') {
        for (const outside of scope === 'wall_face' ? [false, true] : [false]) {
          const projected = clone(field);
          if (outside) {
            projected.data_name = `${property}_outside`;
            projected.key += '_outside';
          }
          if (managed && property === 'wall_plaster_thickness' && outside) {
            projected.required_conditions = projected.visible_conditions = {
              field_id: 'bp_custom_wall_plaster_outside',
              operator: 'equal_to',
              value: 'plastered',
            };
          }
          (managed ? face.mandatory_elements : face.extra_elements).push(projected);
          face.fieldRoles[projected.data_name] = {
            role: 'projection',
            sourceNode: scope === 'physical_wall' ? 'physical_walls' : 'wall_sides',
            sourceOriginalDataName: property,
            property,
            scope,
            storageRole: 'property',
            inherit: true,
            outside,
            ...(managed ? { system: true } : {}),
          };
        }
      }
    }
  }
  for (const nodeKey of NODE_KEYS)
    if (nodeKey !== 'walls') {
      const node = blueprint.nodes[nodeKey];
      const prepare = (elements) =>
        elements.map((field) => {
          const result = clone(field);
          const binding = result.building_plan;
          delete result.building_plan;
          if (result.elements) result.elements = prepare(result.elements);
          if (binding?.inherit_to)
            node.fieldRoles[result.data_name] = {
              role: 'provider',
              property: binding.property || result.data_name,
              inherit_to: binding.inherit_to,
            };
          else if (binding)
            node.fieldRoles[result.data_name] = {
              role: 'property',
              property: binding.property || result.data_name,
              scope: 'node',
              inherit: true,
            };
          return result;
        });
      node.extra_elements = prepare(node.extra_elements);
      for (const provider of providers.filter((entry) => entry.sourceNode === nodeKey))
        node.fieldRoles[provider.sourceOriginalDataName] = {
          ...node.fieldRoles[provider.sourceOriginalDataName],
          role: 'provider',
          property: provider.property,
          inherit_to: provider.destination,
        };
    }
  // A canonical surface's room context follows its own coverage, never the editor that opened it.
  const roomContext = [];
  walk(
    [...blueprint.nodes.rooms.mandatory_elements, ...blueprint.nodes.rooms.extra_elements],
    (field, nested) => {
      if (!nested) roomContext.push(field);
    }
  );
  for (const roomField of roomContext) {
    if (!SCALAR_TYPES.has(roomField.type)) continue;
    const mirror = clone(roomField);
    mirror.key = `bp_context_${roomField.data_name}`;
    mirror.data_name = `context_${roomField.data_name}`;
    mirror.visible = false;
    mirror.visible_conditions = null;
    mirror.required = false;
    mirror.required_conditions = null;
    mirror.read_only = true;
    mirror.read_only_conditions = null;
    delete mirror.building_plan;
    sides.extra_elements.push(mirror);
    sides.fieldRoles[mirror.data_name] = {
      role: 'derived',
      contextNode: 'rooms',
      contextOriginalDataName: roomField.data_name,
    };
  }
  for (const [nodeKey, config] of Object.entries(overrides)) {
    const node = blueprint.nodes[nodeKey];
    for (const [property, presentation] of Object.entries(config.property_overrides || {})) {
      const apply = (elements) => {
        for (const field of elements) {
          if (field.elements) apply(field.elements);
          const binding = node.fieldRoles[field.data_name];
          if (binding?.property === property && !binding.system) {
            const { section_key, order, ...attributes } = presentation;
            Object.assign(field, clone(attributes));
          }
        }
      };
      apply(node.extra_elements);
      const findSection = (elements, key) => {
        for (const field of elements) {
          if (field.type === 'Section' && field.key === key) return field;
          // Generated controls stay in the predefined owner's context, outside custom rows.
          if (field.type === 'Section') {
            const nested = findSection(field.elements || [], key);
            if (nested) return nested;
          }
        }
        return null;
      };
      if (presentation.section_key) {
        const section = findSection(node.extra_elements, presentation.section_key);
        const index = node.extra_elements.findIndex(
          (field) => node.fieldRoles[field.data_name]?.property === property
        );
        if (!section || index < 0)
          throw new TypeError('Choose an authored inline Section for inherited-control placement.');
        const [field] = node.extra_elements.splice(index, 1);
        section.elements.splice(presentation.order ?? section.elements.length, 0, field);
      }
    }
  }
  for (const [name, source] of [
    ['face_doors', 'doors'],
    ['face_windows', 'windows'],
  ]) {
    const projection = clone(blueprint.nodes[source]);
    projection.repeatable.key = `bp_${name}`;
    projection.repeatable.data_name = `building_plan_${name}`;
    projection.role = 'projection';
    projection.sourceNode = source;
    projection.fieldRoles = {};
    walk([...projection.mandatory_elements, ...projection.extra_elements], (field) => {
      projection.fieldRoles[field.data_name] = {
        role: 'projection',
        sourceNode: source,
        sourceOriginalDataName: field.data_name,
        storageRole: blueprint.nodes[source].fieldRoles[field.data_name]?.role || 'value',
      };
    });
    blueprint.nodes[name] = projection;
  }
  const compiledOverrides = clone(overrides);
  for (const config of Object.values(compiledOverrides)) delete config.extra_elements;
  return { blueprint, overrides: compiledOverrides };
}
