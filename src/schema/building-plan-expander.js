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
    sourceNode: mergedNode.sourceNode || null,
    fields: [],
    fieldsByOriginalDataName: {},
    fieldsByOriginalKey: {},
  };

  let fieldCounter = 0;

  const mandatoryElements = (mergedNode.mandatory_elements || []).map((field) => {
    const cloned = deepClone(field);
    if (cloned && cloned.data_name) {
      const fieldSeed = `${cloned.data_name}:${fieldCounter}`;
      const fieldSuffix = generateKey(`${namespaceSeed}:${fieldSeed}`);
      const originalFieldKey = cloned.key || null;
      const originalFieldDataName = cloned.data_name || null;
      cloned.key = createScopedKey(cloned.key || cloned.data_name, fieldSuffix);
      cloned.data_name = createScopedDataName(cloned.data_name, fieldSuffix);
      recordFieldMeta(repeatableMeta, {
        nodeKey,
        type: cloned.type || null,
        originalKey: originalFieldKey,
        originalDataName: originalFieldDataName,
        key: cloned.key,
        preferredKey: cloned.key,
        dataName: cloned.data_name,
        binding: mergedNode.fieldRoles?.[originalFieldDataName] || null,
        field: cloned,
      });
    }
    fieldCounter += 1;
    return cloned;
  });

  const extraElements = (mergedNode.extra_elements || []).map((field) => {
    const cloned = deepClone(field);
    if (cloned && cloned.data_name) {
      const fieldSeed = `${cloned.data_name}:${fieldCounter}`;
      const fieldSuffix = generateKey(`${namespaceSeed}:${fieldSeed}`);
      const originalFieldKey = cloned.key || null;
      const originalFieldDataName = cloned.data_name || null;
      cloned.key = createScopedKey(cloned.key || cloned.data_name, fieldSuffix);
      cloned.data_name = createScopedDataName(cloned.data_name, fieldSuffix);
      recordFieldMeta(repeatableMeta, {
        nodeKey,
        type: cloned.type || null,
        originalKey: originalFieldKey,
        originalDataName: originalFieldDataName,
        key: cloned.key,
        preferredKey: cloned.key,
        dataName: cloned.data_name,
        binding: mergedNode.fieldRoles?.[originalFieldDataName] || null,
        field: cloned,
      });
    }
    fieldCounter += 1;
    return cloned;
  });

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

  repeatable.elements.push(...mandatoryElements, ...extraElements, ...children);

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
  if (field.building_plan?.meta && Array.isArray(field.elements)) {
    buildingPlanMeta.push(field.building_plan.meta);
    return field;
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
    version: 1,
    root: blueprint.root,
    dataName: field.data_name,
    key: field.key,
    repeatables: [],
    repeatablesByNodeKey: {},
    fieldBindings: {},
    properties: {},
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
        if (binding.role === 'property')
          localMeta.properties[binding.property] = {
            scope: binding.scope,
            inherit: binding.inherit === true,
            fallback:
              entry.field.default_value != null
                ? normalizeFieldValue(entry.field, entry.field.default_value)
                : binding.property === 'wall_thickness_m'
                  ? 0.2
                  : null,
            field: entry.field,
            nodeKey: node.nodeKey,
            dataName: entry.dataName,
          };
      }
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
