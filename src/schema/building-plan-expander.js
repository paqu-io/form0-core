import { BUILDING_PLAN_BLUEPRINT } from './building-plan-blueprint.js';

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

function buildRepeatableTree(nodeKey, blueprint, overridesByNode, buildingPlanMeta, ancestor = []) {
  const baseNode = blueprint.nodes[nodeKey];
  const nodeOverride = overridesByNode[nodeKey] || {};
  const mergedNode = mergeNodeOverrides(baseNode, nodeOverride);

  const repeatable = deepClone(mergedNode.repeatable);
  repeatable.elements = [];

  const scopePath = [...ancestor, repeatable.data_name];

  const mandatoryElements = mergedNode.mandatory_elements.map((field) => deepClone(field));

  const extraElements = (mergedNode.extra_elements || []).map((field) => deepClone(field));

  const children = (mergedNode.children || []).map((childKey) =>
    buildRepeatableTree(childKey, blueprint, overridesByNode, buildingPlanMeta, scopePath)
  );

  repeatable.elements.push(...mandatoryElements, ...extraElements, ...children);

  buildingPlanMeta.repeatables.push({
    nodeKey,
    preferredKey: repeatable.key,
    dataName: repeatable.data_name,
    path: scopePath,
    canvas: mergedNode.canvas || null,
  });

  return repeatable;
}

function expandBuildingPlanSection(field, buildingPlanMeta) {
  const blueprint = deepClone(BUILDING_PLAN_BLUEPRINT);
  const overrides = field.node_overrides || {};
  const overridesByNode = {};

  Object.entries(overrides).forEach(([nodeKey, override]) => {
    if (blueprint.nodes[nodeKey]) {
      overridesByNode[nodeKey] = override;
    }
  });

  const localMeta = {
    root: blueprint.root,
    dataName: field.data_name,
    key: field.key,
    repeatables: [],
  };

  const rootRepeatable = buildRepeatableTree(
    blueprint.root,
    blueprint,
    overridesByNode,
    localMeta,
    [field.data_name]
  );

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
