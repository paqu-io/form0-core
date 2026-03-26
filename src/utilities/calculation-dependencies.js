import { ContextResolver } from '../engine/context-resolver.js';
import { flattenFields } from './field-helpers.js';

function sortFieldNames(fieldNames, orderByFieldName) {
  return [...fieldNames].sort(
    (left, right) => orderByFieldName.get(left) - orderByFieldName.get(right)
  );
}

function buildStronglyConnectedComponents(nodesByDataName, orderByFieldName) {
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];
  let currentIndex = 0;

  function strongConnect(fieldName) {
    indices.set(fieldName, currentIndex);
    lowLinks.set(fieldName, currentIndex);
    currentIndex += 1;
    stack.push(fieldName);
    onStack.add(fieldName);

    const node = nodesByDataName.get(fieldName);
    if (node) {
      for (const dependency of node.dependencies) {
        if (!indices.has(dependency)) {
          strongConnect(dependency);
          lowLinks.set(fieldName, Math.min(lowLinks.get(fieldName), lowLinks.get(dependency)));
        } else if (onStack.has(dependency)) {
          lowLinks.set(fieldName, Math.min(lowLinks.get(fieldName), indices.get(dependency)));
        }
      }
    }

    if (lowLinks.get(fieldName) !== indices.get(fieldName)) {
      return;
    }

    const componentFieldNames = [];
    while (stack.length > 0) {
      const stackFieldName = stack.pop();
      onStack.delete(stackFieldName);
      componentFieldNames.push(stackFieldName);
      if (stackFieldName === fieldName) {
        break;
      }
    }

    components.push(sortFieldNames(componentFieldNames, orderByFieldName));
  }

  const sortedFieldNames = sortFieldNames(nodesByDataName.keys(), orderByFieldName);
  sortedFieldNames.forEach((fieldName) => {
    if (!indices.has(fieldName)) {
      strongConnect(fieldName);
    }
  });

  return components;
}

function topologicallyOrderComponents(componentIds, componentEdges) {
  const inDegree = new Map(componentIds.map((componentId) => [componentId, 0]));

  componentEdges.forEach((targets) => {
    targets.forEach((targetId) => {
      inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
    });
  });

  const queue = componentIds.filter((componentId) => (inDegree.get(componentId) || 0) === 0);
  const ordered = [];

  while (queue.length > 0) {
    const componentId = queue.shift();
    ordered.push(componentId);

    for (const targetId of componentEdges.get(componentId) || []) {
      const nextDegree = (inDegree.get(targetId) || 0) - 1;
      inDegree.set(targetId, nextDegree);
      if (nextDegree === 0) {
        queue.push(targetId);
      }
    }
  }

  if (ordered.length === componentIds.length) {
    return ordered;
  }

  return [...componentIds];
}

export function normalizeCalculationFormSchema(schema) {
  if (schema && Array.isArray(schema.elements)) {
    return schema;
  }

  if (schema && schema.form && Array.isArray(schema.form.elements)) {
    return schema.form;
  }

  throw new Error('Expected a form schema or a root schema containing form.elements');
}

export function hasDynamicCalculationDependencies(code) {
  return /\bEVAL\s*\(/.test(typeof code === 'string' ? code : '');
}

export function removeEvalContents(code) {
  const source = typeof code === 'string' ? code : '';
  let result = '';
  let i = 0;

  while (i < source.length) {
    const evalMatch = source.substring(i).match(/^EVAL\s*\(/);
    if (evalMatch) {
      result += 'EVAL()';
      i += evalMatch[0].length;

      let parenCount = 1;
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let inBacktick = false;

      while (i < source.length && parenCount > 0) {
        const char = source[i];

        if (char === "'" && !inDoubleQuote && !inBacktick) {
          inSingleQuote = !inSingleQuote;
        } else if (char === '"' && !inSingleQuote && !inBacktick) {
          inDoubleQuote = !inDoubleQuote;
        } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
          inBacktick = !inBacktick;
        }

        if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
          if (char === '(') {
            parenCount += 1;
          } else if (char === ')') {
            parenCount -= 1;
          }
        }

        i += 1;
      }
    } else {
      result += source[i];
      i += 1;
    }
  }

  return result;
}

export function extractStaticFieldReferenceMatches(code) {
  const cleanedCode = removeEvalContents(code);
  const fieldRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const matches = [];
  let match;

  while ((match = fieldRegex.exec(cleanedCode)) !== null) {
    matches.push({
      fieldName: match[1],
      reference: `$${match[1]}`,
      index: match.index,
      length: match[0].length,
    });
  }

  return matches;
}

export function extractStaticFieldReferences(code) {
  return new Set(extractStaticFieldReferenceMatches(code).map((match) => match.fieldName));
}

export function buildCalculationExecutionContext(form, fieldDataName, resolver) {
  return {
    type: 'calculation',
    fieldName: fieldDataName,
    parentPath: resolver.getFieldInfo(fieldDataName)?.parentPath || [],
  };
}

export function buildCalculationDependencyPlan(schema, contextResolver = null) {
  const form = normalizeCalculationFormSchema(schema);
  const resolver = contextResolver || new ContextResolver(form);
  const fields = flattenFields(form.elements).filter((field) => field && typeof field === 'object');
  const fieldsByDataName = new Map(
    fields
      .filter((field) => typeof field.data_name === 'string' && field.data_name.length > 0)
      .map((field) => [field.data_name, field])
  );

  const orderByFieldName = new Map();
  fields.forEach((field, index) => {
    if (typeof field?.data_name === 'string') {
      orderByFieldName.set(field.data_name, index);
    }
  });

  const nodesByDataName = new Map();
  fields.forEach((field) => {
    if (field.type !== 'CalculatedField' || typeof field.data_name !== 'string') {
      return;
    }

    const fieldName = field.data_name;
    const executionContext = buildCalculationExecutionContext(form, fieldName, resolver);
    const directReferences = extractStaticFieldReferences(field.calculate || '');
    const dependencies = new Set();

    directReferences.forEach((referenceFieldName) => {
      const accessInfo = resolver.resolveFieldAccessInfo(executionContext, referenceFieldName);
      if (accessInfo.level !== 'accessible') {
        return;
      }

      const dependencyField = fieldsByDataName.get(referenceFieldName);
      if (dependencyField?.type === 'CalculatedField') {
        dependencies.add(referenceFieldName);
      }
    });

    nodesByDataName.set(fieldName, {
      field,
      fieldName,
      dependencies,
      directReferences,
      hasDynamicDependencies: hasDynamicCalculationDependencies(field.calculate || ''),
    });
  });

  const componentFieldGroups = buildStronglyConnectedComponents(nodesByDataName, orderByFieldName);
  const componentIdByFieldName = new Map();
  const componentsById = new Map();

  componentFieldGroups.forEach((fieldNames, componentIndex) => {
    const componentId = `component_${componentIndex}`;
    fieldNames.forEach((fieldName) => {
      componentIdByFieldName.set(fieldName, componentId);
    });
    componentsById.set(componentId, {
      id: componentId,
      fieldNames,
      hasDynamicDependencies: false,
      isCyclic: false,
    });
  });

  nodesByDataName.forEach((node) => {
    node.componentId = componentIdByFieldName.get(node.fieldName);
  });

  componentsById.forEach((component) => {
    component.hasDynamicDependencies = component.fieldNames.some(
      (fieldName) => nodesByDataName.get(fieldName)?.hasDynamicDependencies
    );
    component.isCyclic =
      component.fieldNames.length > 1 ||
      component.fieldNames.some((fieldName) =>
        nodesByDataName.get(fieldName)?.dependencies.has(fieldName)
      );
  });

  const componentEdges = new Map(
    Array.from(componentsById.keys(), (componentId) => [componentId, new Set()])
  );

  nodesByDataName.forEach((node) => {
    const targetComponentId = node.componentId;
    node.dependencies.forEach((dependencyFieldName) => {
      const dependencyComponentId = componentIdByFieldName.get(dependencyFieldName);
      if (!dependencyComponentId || dependencyComponentId === targetComponentId) {
        return;
      }
      componentEdges.get(dependencyComponentId).add(targetComponentId);
    });
  });

  const orderedComponentIds = topologicallyOrderComponents(
    Array.from(componentsById.keys()),
    componentEdges
  );
  const orderedFieldNames = orderedComponentIds.flatMap(
    (componentId) => componentsById.get(componentId)?.fieldNames || []
  );
  const dynamicFieldNames = orderedFieldNames.filter(
    (fieldName) => nodesByDataName.get(fieldName)?.hasDynamicDependencies
  );
  const cyclicComponentIds = orderedComponentIds.filter(
    (componentId) => componentsById.get(componentId)?.isCyclic
  );

  return {
    form,
    fieldsByDataName,
    nodesByDataName,
    componentsById,
    componentIdByFieldName,
    orderedComponentIds,
    orderedFieldNames,
    hasDynamicDependencies: dynamicFieldNames.length > 0,
    dynamicFieldNames,
    cyclicComponentIds,
    totalCalculatedFieldCount: orderedFieldNames.length,
  };
}
