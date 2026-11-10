import { BUILDING_PLAN_BLUEPRINT } from './building-plan-blueprint.js';
import { generateKey } from '../utilities/hash.js';
import { normalizeFieldValue } from '../utilities/field-value-normalization.js';
import { createBuildingPlanBlueprint } from './building-plan-contract.js';
import {
  scopeBuildingPlanConditions,
  scopeBuildingPlanExpression,
} from './building-plan-expressions.js';

const DATA_NAME_MAX_LENGTH = 42;

function appendSuffix(base, suffix, maxLength = null) {
  const sanitizedBase = typeof base === 'string' ? base.replace(/_+$/, '') : '';
  const joiner = sanitizedBase === '' ? '' : '_';
  let combined = `${sanitizedBase}${joiner}${suffix}`;

  if (maxLength && combined.length > maxLength) {
    const available = Math.max(1, maxLength - suffix.length - (joiner ? 1 : 0));
    const trimmedBase = sanitizedBase.slice(0, available).replace(/_+$/, '');
    const trimmedJoiner = trimmedBase === '' ? '' : '_';
    combined = `${trimmedBase}${trimmedJoiner}${suffix}`;
  }

  return combined;
}

function createScopedKey(baseKey, suffix) {
  const cleanBase =
    typeof baseKey === 'string' ? baseKey.replace(/^~+/, '').replace(/_+$/, '') : '';
  const scopedBase = appendSuffix(cleanBase, suffix);
  return `~${scopedBase}`;
}

function createScopedDataName(baseDataName, suffix) {
  return appendSuffix(baseDataName, suffix, DATA_NAME_MAX_LENGTH);
}

function recordFieldMeta(container, entry) {
  if (!container) {
    return;
  }
  container.fields.push(entry);
  if (entry.originalDataName) {
    container.fieldsByOriginalDataName[entry.originalDataName] = entry;
  }
  if (entry.originalKey) {
    container.fieldsByOriginalKey[entry.originalKey] = entry;
  }
}

function deepClone(value) {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function mergeNodeOverrides(baseNode, override = {}) {
  const merged = { ...baseNode };
  if (override.canvas) {
    merged.canvas = { ...baseNode.canvas, ...override.canvas };
  }
  if (Array.isArray(override.extra_elements)) {
    merged.extra_elements = override.extra_elements.map((field) => deepClone(field));
  } else {
    merged.extra_elements = baseNode.extra_elements || [];
  }
  return merged;
}

function buildRepeatableTree(
  nodeKey,
  blueprint,
  overridesByNode,
  buildingPlanMeta,
  ancestorDataNames = [],
  namespaceParts = []
) {
  const baseNode = blueprint.nodes[nodeKey];
  const nodeOverride = overridesByNode[nodeKey] || {};
  const mergedNode = mergeNodeOverrides(baseNode, nodeOverride);

  const repeatable = deepClone(mergedNode.repeatable);
  repeatable.elements = [];

  const originalKey = repeatable.key;
  const originalDataName = repeatable.data_name;

  const nodeNamespaceParts = [...namespaceParts, nodeKey];
  const namespaceSeed = nodeNamespaceParts.join(':');
  const repeatableSuffix = generateKey(namespaceSeed);

  repeatable.key = createScopedKey(originalKey, repeatableSuffix);
  repeatable.data_name = createScopedDataName(originalDataName, repeatableSuffix);

  const scopePath = [...ancestorDataNames, repeatable.data_name];

  const repeatableMeta = {
    nodeKey,
    originalKey,
    originalDataName,
    key: repeatable.key,
    preferredKey: repeatable.key,
    dataName: repeatable.data_name,
    path: scopePath,
    canvas: mergedNode.canvas || null,
    role: mergedNode.role || nodeKey,
    fieldLabel: repeatable.label,
    sourceNode: mergedNode.sourceNode || null,
    fields: [],
    fieldsByOriginalDataName: {},
    fieldsByOriginalKey: {},
  };

  let fieldCounter = 0;
  function compileFields(fields, parts = [], owner = repeatableMeta, register = true) {
    return fields.map((field) => {
      const cloned = deepClone(field);
      const originalKey = cloned.key || null;
      const originalDataName = cloned.data_name || null;
      const suffix = generateKey(
        `${namespaceSeed}:${parts.join(':')}:${originalDataName}:${fieldCounter++}`
      );
      cloned.key = createScopedKey(originalKey || originalDataName, suffix);
      cloned.data_name = createScopedDataName(originalDataName, suffix);
      delete cloned.building_plan;
      const entry = {
        nodeKey,
        type: cloned.type,
        originalKey,
        originalDataName,
        key: cloned.key,
        preferredKey: cloned.key,
        dataName: cloned.data_name,
        binding: mergedNode.fieldRoles?.[originalDataName] || null,
        field: cloned,
      };
      if (register && cloned.type !== 'Section') recordFieldMeta(owner, entry);
      if (Array.isArray(field.elements)) {
        if (cloned.type === 'RepeatableSection') {
          const childOwner = { fields: [], fieldsByOriginalDataName: {}, fieldsByOriginalKey: {} };
          cloned.elements = compileFields(
            field.elements,
            [...parts, originalKey || originalDataName],
            childOwner
          );
          entry.children = childOwner.fields;
        } else
          cloned.elements = compileFields(
            field.elements,
            [...parts, originalKey || originalDataName],
            owner,
            register
          );
      }
      return cloned;
    });
  }
  const mandatoryElements = compileFields(mergedNode.mandatory_elements || []);
  const extraElements = compileFields(mergedNode.extra_elements || []);
  const applicability = [];
  for (const entry of [...repeatableMeta.fields]) {
    if (!['physical_walls', 'wall_sides', 'walls'].includes(nodeKey)) continue;
    if (!entry.binding?.outside && !Object.keys(entry.binding?.applies_to || {}).length) continue;
    const flagName = `applicable_${fieldCounter++}`;
    const template = deepClone(
      blueprint.nodes.physical_walls.mandatory_elements.find(
        (field) => field.data_name === 'wall_thickness_m'
      )
    );
    Object.assign(template, {
      key: `bp_${flagName}`,
      data_name: flagName,
      label: 'Applicability',
      required: false,
      required_conditions: null,
      visible: false,
      visible_conditions: null,
      read_only: true,
      read_only_conditions: null,
      default_value: 0,
      min: 0,
      max: 1,
    });
    mergedNode.fieldRoles[flagName] = { role: 'derived', applicabilityFor: entry.originalDataName };
    const [flag] = compileFields([template]);
    const guard = { field_id: flag.key, operator: 'equal_to', value: 1 };
    if (entry.field.visible !== false || entry.field.visible_conditions) {
      entry.field.visible = false;
      entry.field.visible_conditions = entry.field.visible_conditions
        ? { and: [entry.field.visible_conditions, guard] }
        : guard;
    }
    applicability.push(flag);
  }
  extraElements.push(...applicability);
  const systemSection = mandatoryElements.length
    ? [
        {
          type: 'Section',
          key: createScopedKey(`bp_${nodeKey}_system`, repeatableSuffix),
          data_name: createScopedDataName(`bp_${nodeKey}_system`, repeatableSuffix),
          label: 'System fields',
          display: 'inline',
          description: null,
          description_mode: null,
          visible: true,
          visible_conditions: null,
          elements: mandatoryElements,
        },
      ]
    : [];

  const children = (mergedNode.children || []).map((childKey) =>
    buildRepeatableTree(
      childKey,
      blueprint,
      overridesByNode,
      buildingPlanMeta,
      scopePath,
      nodeNamespaceParts
    )
  );

  repeatable.elements.push(...systemSection, ...extraElements, ...children);

  if (Array.isArray(repeatableMeta.fields) && repeatableMeta.fields.length === 0) {
    delete repeatableMeta.fields;
    delete repeatableMeta.fieldsByOriginalDataName;
    delete repeatableMeta.fieldsByOriginalKey;
  }

  buildingPlanMeta.repeatables.push(repeatableMeta);
  if (buildingPlanMeta.repeatablesByNodeKey) {
    buildingPlanMeta.repeatablesByNodeKey[nodeKey] = repeatableMeta;
  }

  return repeatable;
}

function expandBuildingPlanSection(field, buildingPlanMeta) {
  if (field.building_plan && (!field.building_plan.meta || !Array.isArray(field.elements)))
    throw new TypeError(
      'BuildingPlan compiler metadata is reserved; author configuration through node_overrides.'
    );
  if (field.building_plan?.meta && field.building_plan.meta.version !== 2)
    throw new TypeError('BuildingPlan version 1 development schemas are not migrated.');
  if (!field.building_plan?.meta && field.elements?.length)
    throw new TypeError(
      'BuildingPlan structure is compiler-owned; use node_overrides for custom content.'
    );
  if (field.building_plan?.meta && Array.isArray(field.elements)) {
    const { elements, building_plan, ...authored } = field;
    const rebuilt = [];
    const expected = expandBuildingPlanSection(authored, rebuilt);
    if (
      JSON.stringify(expected.elements) !== JSON.stringify(elements) ||
      JSON.stringify(expected.building_plan.meta) !== JSON.stringify(building_plan.meta)
    )
      throw new TypeError(
        'Generated BuildingPlan controls and structure are protected; edit authored node_overrides instead.'
      );
    buildingPlanMeta.push(expected.building_plan.meta);
    return expected;
  }
  const contract = createBuildingPlanBlueprint(field.node_overrides || {});
  const blueprint = contract.blueprint;
  const overrides = contract.overrides;
  const overridesByNode = {};

  Object.entries(overrides).forEach(([nodeKey, override]) => {
    if (blueprint.nodes[nodeKey]) {
      overridesByNode[nodeKey] = override;
    }
  });

  const localMeta = {
    version: 2,
    root: blueprint.root,
    dataName: field.data_name,
    key: field.key,
    repeatables: [],
    repeatablesByNodeKey: {},
    fieldBindings: {},
    properties: deepClone(blueprint.properties),
  };

  const rootRepeatable = buildRepeatableTree(
    blueprint.root,
    blueprint,
    overridesByNode,
    localMeta,
    [field.data_name],
    [field.data_name]
  );

  for (const node of localMeta.repeatables) {
    const aliases = new Map();
    const fieldKeys = new Map();
    const ancestors = localMeta.repeatables
      .filter(
        (candidate) =>
          candidate.path.length <= node.path.length &&
          candidate.path.every((part, index) => part === node.path[index])
      )
      .sort((a, b) => a.path.length - b.path.length);
    for (const ancestor of ancestors)
      for (const entry of ancestor.fields || []) {
        aliases.set(entry.originalDataName, entry.dataName);
        fieldKeys.set(entry.originalKey, entry.key);
      }
    if (node.nodeKey === 'wall_sides')
      for (const entry of node.fields || [])
        if (entry.binding?.contextOriginalDataName)
          aliases.set(entry.binding.contextOriginalDataName, entry.dataName);
    for (const entry of node.fields || []) {
      const binding = entry.binding;
      if (binding) {
        const compiled = {
          ...binding,
          nodeKey: node.nodeKey,
          originalDataName: entry.originalDataName,
          dataName: entry.dataName,
          fieldKey: entry.key,
        };
        if (binding.sourceNode)
          compiled.sourceDataName =
            localMeta.repeatablesByNodeKey[binding.sourceNode]?.fieldsByOriginalDataName?.[
              binding.sourceOriginalDataName
            ]?.dataName;
        entry.binding = compiled;
        localMeta.fieldBindings[entry.dataName] = compiled;
        if (binding.role === 'property') {
          const semanticNode =
            node.nodeKey === 'physical_walls' || node.nodeKey === 'wall_sides'
              ? 'walls'
              : node.nodeKey;
          const propertyKey =
            semanticNode === 'walls' && binding.scope === 'physical_wall'
              ? binding.property
              : `${semanticNode}:${binding.scope}:${binding.property}`;
          localMeta.properties[propertyKey] = {
            ...localMeta.properties[propertyKey],
            property: binding.property,
            scope: binding.scope,
            inherit: localMeta.properties[propertyKey]?.inherit ?? binding.inherit === true,
            fallback: normalizeFieldValue(
              entry.field,
              localMeta.properties[propertyKey]?.fallback ??
                entry.field.default_value ??
                (binding.property === 'wall_thickness_m' ? 0.2 : null)
            ),
            field: entry.field,
            nodeKey: semanticNode,
            dataName: entry.dataName,
          };
        }
      }
      const scopeChildren = (children, parentAliases, parentKeys) => {
        const names = new Map(parentAliases),
          keys = new Map(parentKeys);
        for (const child of children || []) {
          names.set(child.originalDataName, child.dataName);
          keys.set(child.originalKey, child.key);
        }
        for (const child of children || []) {
          if (typeof child.field.calculate === 'string')
            child.field.calculate = scopeBuildingPlanExpression(child.field.calculate, names);
          for (const attribute of [
            'visible_conditions',
            'required_conditions',
            'read_only_conditions',
          ])
            if (child.field[attribute])
              child.field[attribute] = scopeBuildingPlanConditions(
                child.field[attribute],
                names,
                keys
              );
          scopeChildren(child.children, names, keys);
        }
      };
      scopeChildren(entry.children, aliases, fieldKeys);
      if (typeof entry.field.calculate === 'string')
        entry.field.calculate = scopeBuildingPlanExpression(entry.field.calculate, aliases);
      for (const attribute of ['visible_conditions', 'required_conditions', 'read_only_conditions'])
        if (entry.field[attribute])
          entry.field[attribute] = scopeBuildingPlanConditions(
            entry.field[attribute],
            aliases,
            fieldKeys
          );
    }
  }

  const linkChildren = (targets, sources) => {
    for (const child of targets || []) {
      const source = (sources || []).find(
        (entry) => entry.originalDataName === child.originalDataName
      );
      if (!source) continue;
      child.sourceDataName =
        source.type === 'RepeatableSection' ? source.preferredKey : source.dataName;
      linkChildren(child.children, source.children);
    }
  };
  for (const node of localMeta.repeatables)
    for (const entry of node.fields || [])
      if (entry.binding?.role === 'projection' && entry.type === 'RepeatableSection') {
        const original =
          localMeta.repeatablesByNodeKey[entry.binding.sourceNode]?.fieldsByOriginalDataName[
            entry.binding.sourceOriginalDataName
          ];
        if (original) {
          entry.binding.sourceDataName = original.preferredKey;
          linkChildren(entry.children, original.children);
        }
      }
  buildingPlanMeta.push(localMeta);

  return {
    ...field,
    elements: [rootRepeatable],
    building_plan: {
      blueprint,
      meta: localMeta,
    },
  };
}

function expandElement(element, buildingPlanMeta) {
  if (!element || typeof element !== 'object') return element;

  if (element.type === 'Section' || element.type === 'RepeatableSection') {
    const elements = Array.isArray(element.elements)
      ? element.elements.map((child) => expandElement(child, buildingPlanMeta))
      : [];
    return {
      ...element,
      elements,
    };
  }

  if (element.type === 'BuildingPlanSection') {
    return expandBuildingPlanSection(element, buildingPlanMeta);
  }

  return element;
}

export function expandBuildingPlanSchema(schema) {
  if (!schema || typeof schema !== 'object' || !schema.form) {
    return { schema, buildingPlanMeta: [] };
  }

  const buildingPlanMeta = [];
  const form = schema.form;
  const elements = Array.isArray(form.elements)
    ? form.elements.map((element) => expandElement(element, buildingPlanMeta))
    : [];

  return {
    schema: {
      ...schema,
      form: {
        ...form,
        elements,
      },
    },
    buildingPlanMeta,
  };
}
