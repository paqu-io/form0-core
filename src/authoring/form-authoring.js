import { FIELD_SPECS } from '../schema/field-specs.js';
import { getValidOperators } from '../schema/operators.js';
import { validateSchema } from '../schema/schema-validator.js';
import { getAllEventTypes } from '../engine/event-registry.js';
import { generateKey } from '../utilities/hash.js';
import { flattenFields } from '../utilities/field-helpers.js';
import {
  analyzeCalculationExpression,
  getCalculationBuiltinCatalog,
  getCalculationReferenceCatalog,
} from '../utilities/calculation-editor.js';
import {
  analyzeFormEventCode,
  getFormEventBuiltinCatalog,
  getFormEventReferenceCatalog,
} from '../utilities/form-event-editor.js';

const CONTAINER_TYPES = new Set(['Section', 'RepeatableSection', 'BuildingPlanSection']);
const MUTATION_OPERATIONS = Object.freeze([
  'updateForm',
  'addField',
  'updateField',
  'moveField',
  'removeField',
  'setTitleField',
  'setStatusField',
  'setCalculation',
  'setFormEventCode',
]);

const CALCULATION_GUIDANCE = Object.freeze({
  version: 1,
  preferenceOrder: Object.freeze([
    'direct-expression',
    'builtin-expression',
    'multiline-javascript',
  ]),
  multilineResult: Object.freeze({
    builtin: 'SETRESULT',
    requiredCalls: 1,
    placement: 'final-statement',
  }),
  nonPreferredPatterns: Object.freeze(['iife']),
  examples: Object.freeze({
    direct: '$quantity * $unit_price',
    builtin: 'IF($eligible, $amount, 0)',
    multiline: `let age = null;
if ($birth_date) {
  const birth = new Date($birth_date);
  const today = new Date();
  age = today.getFullYear() - birth.getFullYear();
  const month = today.getMonth() - birth.getMonth();
  if (month < 0 || (month === 0 && today.getDate() < birth.getDate())) age--;
}
SETRESULT(age);`,
  }),
});

const EVENT_GUIDANCE = Object.freeze({
  version: 1,
  choiceValues: Object.freeze({
    single: Object.freeze({
      fieldTypes: Object.freeze(['SingleChoiceField', 'BooleanField']),
      builtin: 'CHOICEVALUE',
    }),
    multiple: Object.freeze({
      fieldTypes: Object.freeze(['MultiChoiceField']),
      builtin: 'CHOICEVALUES',
    }),
  }),
  conditionalMappings: Object.freeze({
    explicitNamedCases: true,
    explicitFallback: true,
  }),
  examples: Object.freeze({
    singleChoiceComparison: "CHOICEVALUE($birth_town) === 'loreto'",
    multipleChoiceComparison: "CHOICEVALUES($interests).includes('music')",
    conditionalChoiceMapping: `ON('change', 'birth_town', function () {
  SETVALUE(
    'comments',
    IF(
      CHOICEVALUE($birth_town) === 'loreto',
      'Hooola!',
      IF(CHOICEVALUE($birth_town) === 'recanati', 'Ciaooo', '')
    )
  );
});`,
  }),
});

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeRootSchema(schema) {
  if (schema && schema.form && Array.isArray(schema.form.elements)) {
    return schema;
  }
  if (schema && Array.isArray(schema.elements)) {
    return { form: schema };
  }
  throw new Error('Expected a root schema containing form.elements or a form schema');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function fnv1a64(input) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function toSerializable(value) {
  if (Array.isArray(value)) return value.map(toSerializable);
  if (!value || typeof value !== 'object') return typeof value === 'function' ? undefined : value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    const serialized = toSerializable(entry);
    if (serialized !== undefined) result[key] = serialized;
  }
  return result;
}

function indexFields(elements) {
  const byKey = new Map();
  function visit(list, parentKey = null) {
    if (!Array.isArray(list)) return;
    list.forEach((field, index) => {
      if (field?.key) byKey.set(field.key, { field, list, index, parentKey });
      if (CONTAINER_TYPES.has(field?.type)) visit(field.elements, field.key || null);
    });
  }
  visit(elements);
  return byKey;
}

function ensureFieldKeys(field) {
  if (!field || typeof field !== 'object' || Array.isArray(field)) {
    throw new Error('Field must be an object');
  }
  if (!field.key && field.data_name) field.key = generateKey(field.data_name);
  if (CONTAINER_TYPES.has(field.type)) {
    if (!Array.isArray(field.elements)) field.elements = [];
    field.elements.forEach(ensureFieldKeys);
  }
  return field;
}

function getInsertionPoint(form, parentKey, position = {}) {
  let list = form.elements;
  if (parentKey) {
    const parent = indexFields(form.elements).get(parentKey)?.field;
    if (!parent || !CONTAINER_TYPES.has(parent.type)) {
      throw new Error(`Parent field '${parentKey}' is not a container`);
    }
    if (!Array.isArray(parent.elements)) parent.elements = [];
    list = parent.elements;
  }

  if (position.beforeKey || position.afterKey) {
    const siblingKey = position.beforeKey || position.afterKey;
    const index = list.findIndex((field) => field?.key === siblingKey);
    if (index === -1) throw new Error(`Sibling field '${siblingKey}' was not found in the target`);
    return { list, index: position.beforeKey ? index : index + 1 };
  }
  return { list, index: list.length };
}

function updateConditionReferences(value, oldValues, replacement) {
  if (Array.isArray(value)) {
    value.forEach((entry) => updateConditionReferences(entry, oldValues, replacement));
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (value.type === 'TitleField' && Array.isArray(value.elements)) {
    value.elements = value.elements.map((entry) => (oldValues.has(entry) ? replacement : entry));
  }
  for (const key of ['field_id', 'field_key', 'destination_field_id', 'form_link_field_key']) {
    if (oldValues.has(value[key])) value[key] = replacement;
  }
  Object.values(value).forEach((entry) => updateConditionReferences(entry, oldValues, replacement));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceCodeReferences(code, oldKey, oldDataName, newKey, newDataName) {
  if (typeof code !== 'string') return code;
  let updated = code.replace(
    new RegExp(`\\$${escapeRegExp(oldDataName)}(?![A-Za-z0-9_])`, 'g'),
    `$${newDataName}`
  );
  const replacements = [
    { name: oldDataName, replacement: newDataName },
    { name: oldKey, replacement: newKey },
  ].filter(({ name }) => typeof name === 'string' && name.length > 0);
  for (const { name, replacement } of replacements) {
    const escaped = escapeRegExp(name);
    updated = updated.replace(
      new RegExp(`((?:ON|OFF)\\(\\s*['\"][^'\"]+['\"]\\s*,\\s*)(['\"])${escaped}\\2`, 'g'),
      `$1$2${replacement}$2`
    );
    updated = updated.replace(
      new RegExp(`((?:SETVALUE)\\(\\s*)(['\"])${escaped}\\2`, 'g'),
      `$1$2${replacement}$2`
    );
  }
  return updated;
}

function renameReferences(form, oldField, newField) {
  const oldValues = new Set([oldField.key, oldField.data_name].filter(Boolean));
  updateConditionReferences(form, oldValues, newField.key);
  for (const field of flattenFields(form.elements)) {
    if (field.type === 'CalculatedField') {
      field.calculate = replaceCodeReferences(
        field.calculate,
        oldField.key,
        oldField.data_name,
        newField.key,
        newField.data_name
      );
    }
  }
  if (form.events?.code) {
    form.events.code = replaceCodeReferences(
      form.events.code,
      oldField.key,
      oldField.data_name,
      newField.key,
      newField.data_name
    );
  }
}

function hasCodeReference(code, field) {
  if (typeof code !== 'string') return false;
  const names = [field.key, field.data_name].filter(Boolean).map(escapeRegExp);
  return names.some(
    (name) =>
      new RegExp(`\\$${name}(?![A-Za-z0-9_])`).test(code) ||
      new RegExp(`(?:ON|OFF|SETVALUE)\\([^)]*['\"]${name}['\"]`).test(code)
  );
}

function findRemovalReferences(form, field) {
  const references = [];
  const oldValues = new Set([field.key, field.data_name].filter(Boolean));
  const scan = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => scan(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (
        ['field_id', 'field_key', 'destination_field_id', 'form_link_field_key'].includes(key) &&
        oldValues.has(entry)
      ) {
        references.push(`${path}.${key}`);
      }
      scan(entry, `${path}.${key}`);
    }
  };
  scan(form, 'form');
  const titleReferences = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => titleReferences(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'TitleField' && value.elements?.some((entry) => oldValues.has(entry))) {
      references.push(`${path}.elements`);
    }
    Object.entries(value).forEach(([key, entry]) => titleReferences(entry, `${path}.${key}`));
  };
  titleReferences(form, 'form');
  for (const candidate of flattenFields(form.elements)) {
    if (candidate !== field && hasCodeReference(candidate.calculate, field)) {
      references.push(`CalculatedField:${candidate.data_name}`);
    }
  }
  if (hasCodeReference(form.events?.code, field)) references.push('form.events.code');
  return [...new Set(references)];
}

function mutationError(index, operation, error) {
  return {
    code: 'mutation_failed',
    severity: 'error',
    operationIndex: index,
    operation: operation?.op || null,
    message: error instanceof Error ? error.message : String(error),
  };
}

function applyMutation(root, operation) {
  const form = root.form;
  const fields = indexFields(form.elements);
  switch (operation.op) {
    case 'updateForm': {
      const forbidden = new Set(['elements', 'events', 'title_field', 'status_field']);
      for (const key of Object.keys(operation.changes || {})) {
        if (forbidden.has(key)) throw new Error(`updateForm cannot change '${key}'`);
      }
      Object.assign(form, deepClone(operation.changes || {}));
      return `Updated form attributes`;
    }
    case 'addField': {
      const field = ensureFieldKeys(deepClone(operation.field));
      if (field.key && fields.has(field.key))
        throw new Error(`Field key '${field.key}' already exists`);
      if (
        field.data_name &&
        [...fields.values()].some((entry) => entry.field.data_name === field.data_name)
      ) {
        throw new Error(`Field data_name '${field.data_name}' already exists`);
      }
      const point = getInsertionPoint(form, operation.parentKey || null, operation.position || {});
      point.list.splice(point.index, 0, field);
      return `Added ${field.type || 'field'} '${field.data_name || field.key}'`;
    }
    case 'updateField': {
      const target = fields.get(operation.fieldKey);
      if (!target) throw new Error(`Field '${operation.fieldKey}' was not found`);
      if (operation.changes?.type && operation.changes.type !== target.field.type) {
        throw new Error('Field type cannot be changed; remove and add the field explicitly');
      }
      const original = deepClone(target.field);
      const children = target.field.elements;
      Object.assign(target.field, deepClone(operation.changes || {}));
      if (
        target.field.data_name !== original.data_name &&
        [...fields.values()].some(
          (entry) =>
            entry.field !== target.field && entry.field.data_name === target.field.data_name
        )
      ) {
        throw new Error(`Field data_name '${target.field.data_name}' already exists`);
      }
      if (CONTAINER_TYPES.has(target.field.type)) target.field.elements = children || [];
      if (target.field.data_name !== original.data_name) {
        target.field.key = generateKey(target.field.data_name);
        renameReferences(form, original, target.field);
      } else {
        target.field.key = original.key;
      }
      return `Updated field '${original.data_name}'`;
    }
    case 'moveField': {
      const target = fields.get(operation.fieldKey);
      if (!target) throw new Error(`Field '${operation.fieldKey}' was not found`);
      const descendants = new Set(
        flattenFields(target.field.elements || [])
          .map((field) => field?.key)
          .filter(Boolean)
      );
      if (operation.parentKey && descendants.has(operation.parentKey)) {
        throw new Error('A field cannot be moved into one of its descendants');
      }
      target.list.splice(target.index, 1);
      const point = getInsertionPoint(form, operation.parentKey || null, operation.position || {});
      point.list.splice(point.index, 0, target.field);
      return `Moved field '${target.field.data_name}'`;
    }
    case 'removeField': {
      const target = fields.get(operation.fieldKey);
      if (!target) throw new Error(`Field '${operation.fieldKey}' was not found`);
      const references = findRemovalReferences(form, target.field);
      if (references.length > 0) {
        throw new Error(
          `Field '${target.field.data_name}' is still referenced by: ${references.join(', ')}`
        );
      }
      target.list.splice(target.index, 1);
      return `Removed field '${target.field.data_name}'`;
    }
    case 'setTitleField':
      form.title_field = deepClone(operation.field ?? null);
      return 'Updated title field';
    case 'setStatusField':
      form.status_field = deepClone(operation.field ?? null);
      return 'Updated status field';
    case 'setCalculation': {
      const target = fields.get(operation.fieldKey)?.field;
      if (!target || target.type !== 'CalculatedField') {
        throw new Error(`Field '${operation.fieldKey}' is not a CalculatedField`);
      }
      target.calculate = operation.expression;
      return `Updated calculation '${target.data_name}'`;
    }
    case 'setFormEventCode':
      form.events = operation.code ? { ...(form.events || {}), code: operation.code } : null;
      return 'Updated form event code';
    default:
      throw new Error(`Unsupported mutation operation '${operation.op}'`);
  }
}

function validateDraft(root, security) {
  const diagnostics = [];
  try {
    validateSchema(root.form);
  } catch (error) {
    diagnostics.push({
      code: 'schema_validation_failed',
      severity: 'error',
      message: error.message,
    });
  }
  for (const field of flattenFields(root.form.elements)) {
    if (field?.type !== 'CalculatedField') continue;
    const analysis = analyzeCalculationExpression({
      expression: field.calculate,
      schema: root,
      fieldDataName: field.data_name,
      securityConfig: security,
    });
    diagnostics.push(
      ...analysis.issues.map((issue) => ({ ...issue, source: `calculation:${field.data_name}` }))
    );
  }
  const eventAnalysis = analyzeFormEventCode({
    code: root.form.events?.code || '',
    schema: root,
    securityConfig: security,
  });
  diagnostics.push(...eventAnalysis.issues.map((issue) => ({ ...issue, source: 'form-events' })));
  return diagnostics;
}

/** Return a deterministic revision for optimistic authoring concurrency. */
export function getFormSchemaRevision(schema) {
  const root = normalizeRootSchema(schema);
  return `form0-${fnv1a64(JSON.stringify(stableValue(root)))}`;
}

/** Return the installed-version authoring capabilities and complete schema context. */
export function getFormAuthoringContext({ schema, coreVersion = null }) {
  const root = normalizeRootSchema(schema);
  const fieldSpecs = Object.fromEntries(
    Object.entries(FIELD_SPECS).map(([type, spec]) => [type, toSerializable(spec.attributes)])
  );
  const operators = Object.fromEntries(
    Object.keys(FIELD_SPECS).map((type) => [type, getValidOperators(type)])
  );
  const calculations = flattenFields(root.form.elements)
    .filter((field) => field?.type === 'CalculatedField')
    .map((field) => ({
      fieldKey: field.key,
      fieldDataName: field.data_name,
      references: getCalculationReferenceCatalog({
        schema: root,
        fieldDataName: field.data_name,
        includeRestricted: true,
      }),
    }));
  return {
    contractVersion: 3,
    coreVersion,
    revision: getFormSchemaRevision(root),
    schema: deepClone(root),
    mutationOperations: [...MUTATION_OPERATIONS],
    fieldSpecs,
    operators,
    eventTypes: getAllEventTypes(),
    eventGuidance: deepClone(EVENT_GUIDANCE),
    calculationBuiltins: getCalculationBuiltinCatalog(),
    calculationGuidance: deepClone(CALCULATION_GUIDANCE),
    eventBuiltins: getFormEventBuiltinCatalog(),
    eventReferences: getFormEventReferenceCatalog({ schema: root }),
    calculations,
  };
}

/** Resolve whether the complete form may be sent to a cloud AI provider. */
export function getFormAICloudPolicy(schema) {
  const root = normalizeRootSchema(schema);
  const cloudBlockers = [];
  const consentReasons = [];
  if (root.form.ai?.allowCloud === false) cloudBlockers.push({ scope: 'form' });
  if (root.form.ai?.requiresConsent === true) consentReasons.push({ scope: 'form' });
  for (const field of flattenFields(root.form.elements)) {
    const identity = field?.key || field?.data_name || 'unknown-field';
    if (field?.ai?.allowCloud === false) cloudBlockers.push({ scope: 'field', key: identity });
    if (field?.ai?.requiresConsent === true) consentReasons.push({ scope: 'field', key: identity });
  }
  return {
    allowCloud: cloudBlockers.length === 0,
    requiresConsent: consentReasons.length > 0,
    cloudBlockers,
    consentReasons,
  };
}

/** Apply and fully validate a semantic mutation batch without mutating the input schema. */
export function applyFormMutationBatch({ schema, baseRevision, operations, security }) {
  const root = normalizeRootSchema(schema);
  const currentRevision = getFormSchemaRevision(root);
  if (baseRevision !== currentRevision) {
    return {
      valid: false,
      schema: null,
      revision: currentRevision,
      semanticDiff: [],
      diagnostics: [
        {
          code: 'stale_schema_revision',
          severity: 'error',
          message: `Expected revision '${currentRevision}', received '${baseRevision}'`,
        },
      ],
    };
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    return {
      valid: false,
      schema: null,
      revision: currentRevision,
      semanticDiff: [],
      diagnostics: [
        {
          code: 'empty_mutation_batch',
          severity: 'error',
          message: 'At least one operation is required',
        },
      ],
    };
  }

  const draft = deepClone(root);
  const semanticDiff = [];
  for (let index = 0; index < operations.length; index += 1) {
    try {
      semanticDiff.push({
        index,
        op: operations[index]?.op,
        summary: applyMutation(draft, operations[index]),
      });
    } catch (error) {
      return {
        valid: false,
        schema: null,
        revision: currentRevision,
        semanticDiff: [],
        diagnostics: [mutationError(index, operations[index], error)],
      };
    }
  }

  const diagnostics = validateDraft(draft, security);
  const valid = !diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  return {
    valid,
    schema: valid ? draft : null,
    revision: valid ? getFormSchemaRevision(draft) : currentRevision,
    semanticDiff: valid ? semanticDiff : [],
    diagnostics,
  };
}
