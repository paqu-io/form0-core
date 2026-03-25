import { BUILTIN_CONTEXTS } from '../builtins/builtin-metadata.js';
import { BUILTIN_DEFINITION_BY_NAME, EVENT_BUILTIN_DEFINITIONS } from '../builtins/registry.js';
import { ContextResolver } from '../engine/context-resolver.js';
import { getAllEventTypes } from '../engine/event-registry.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/config.js';
import { validateExpression } from '../security/validation.js';
import { flattenFields } from './field-helpers.js';

const COMMON_GLOBAL_FUNCTIONS = new Set([
  'Math',
  'Date',
  'JSON',
  'Number',
  'String',
  'Array',
  'Object',
  'Boolean',
]);

const STRUCTURAL_FIELD_TYPES = new Set([
  'Section',
  'RepeatableSection',
  'BuildingPlanSection',
]);

const FORM_EVENT_BUILTIN_STATUS_BY_NAME = Object.freeze({
  EVAL: 'advanced',
  FORM: 'unavailable',
});

function getFormEventBuiltinStatus(name) {
  return FORM_EVENT_BUILTIN_STATUS_BY_NAME[name] ?? 'stable';
}

function toFormEventBuiltinDefinition(definition) {
  return Object.freeze({
    name: definition.name,
    category: definition.category,
    signature: definition.signature,
    description: definition.description,
    examples: Object.freeze([...definition.examples]),
    status: getFormEventBuiltinStatus(definition.name),
  });
}

const FORM_EVENT_BUILTIN_CATALOG = Object.freeze(
  EVENT_BUILTIN_DEFINITIONS.map(toFormEventBuiltinDefinition)
);

const FORM_EVENT_BUILTIN_METADATA_BY_NAME = new Map(
  FORM_EVENT_BUILTIN_CATALOG.map((definition) => [definition.name, definition])
);

function normalizeFormSchema(schema) {
  if (schema && Array.isArray(schema.elements)) {
    return schema;
  }

  if (schema && schema.form && Array.isArray(schema.form.elements)) {
    return schema.form;
  }

  throw new Error('Expected a form schema or a root schema containing form.elements');
}

function isBuiltinCallMatchAllowed(functionName) {
  return COMMON_GLOBAL_FUNCTIONS.has(functionName);
}

function removeEvalContents(code) {
  let result = '';
  let i = 0;

  while (i < code.length) {
    const evalMatch = code.substring(i).match(/^EVAL\s*\(/);
    if (evalMatch) {
      result += 'EVAL()';
      i += evalMatch[0].length;

      let parenCount = 1;
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let inBacktick = false;

      while (i < code.length && parenCount > 0) {
        const char = code[i];

        if (char === "'" && !inDoubleQuote && !inBacktick) {
          inSingleQuote = !inSingleQuote;
        } else if (char === '"' && !inSingleQuote && !inBacktick) {
          inDoubleQuote = !inDoubleQuote;
        } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
          inBacktick = !inBacktick;
        }

        if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
          if (char === '(') {
            parenCount++;
          } else if (char === ')') {
            parenCount--;
          }
        }

        i++;
      }
    } else {
      result += code[i];
      i++;
    }
  }

  return result;
}

function extractFunctionCalls(code) {
  const functionCallPattern = /\b([A-Z_][A-Z0-9_]*)\s*\(/g;
  const matches = [];
  let match;

  while ((match = functionCallPattern.exec(code)) !== null) {
    matches.push({
      name: match[1],
      index: match.index,
      length: match[1].length,
    });
  }

  return matches;
}

function extractFieldReferenceMatches(code) {
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

function extractLiteralEventTypeMatches(code) {
  const matches = [];
  const eventTypeCallPattern = /\b(ON|OFF)\s*\(\s*(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\2/g;
  let match;

  while ((match = eventTypeCallPattern.exec(code)) !== null) {
    const eventType = match[3];
    const eventTypeIndex = match.index + match[0].indexOf(eventType);
    matches.push({
      builtinName: match[1],
      eventType,
      index: eventTypeIndex,
      length: eventType.length,
    });
  }

  return matches;
}

function cloneCatalogDefinition(definition) {
  return {
    ...definition,
    examples: [...definition.examples],
  };
}

function toFormEventReferenceDefinition(field, resolver) {
  return {
    key: typeof field.key === 'string' ? field.key : field.data_name,
    reference: `$${field.data_name}`,
    dataName: field.data_name,
    label: typeof field.label === 'string' ? field.label : field.data_name,
    type: typeof field.type === 'string' ? field.type : 'UnknownField',
    description: typeof field.description === 'string' ? field.description : null,
    displayStyle:
      field.display && typeof field.display === 'object' && typeof field.display.style === 'string'
        ? field.display.style
        : typeof field.display === 'string'
          ? field.display
          : null,
    parentPath: resolver.getFieldInfo(field.data_name)?.parentPath || [],
  };
}

function createIssue({ code, severity, message, symbol = null, index = null, length = null }) {
  return {
    code,
    severity,
    message,
    symbol,
    startIndex: typeof index === 'number' ? index : null,
    endIndex: typeof index === 'number' && typeof length === 'number' ? index + length : null,
  };
}

function addIssue(issues, issueKeys, issue) {
  const key = `${issue.code}:${issue.symbol || issue.message}`;
  if (issueKeys.has(key)) {
    return;
  }
  issueKeys.add(key);
  issues.push(issue);
}

function validateSyntax(code) {
  new Function(code);
}

function createSchemaFilteredSecurityConfig(securityConfig) {
  if (!securityConfig || typeof securityConfig !== 'object') {
    return DEFAULT_SECURITY_CONFIG;
  }

  return {
    ...securityConfig,
    validateBuiltins: false,
  };
}

/**
 * @typedef {'stable' | 'advanced' | 'unavailable'} FormEventBuiltinStatus
 *
 * @typedef {Object} FormEventBuiltinDefinition
 * @property {string} name
 * @property {string} category
 * @property {string} signature
 * @property {string} description
 * @property {string[]} examples
 * @property {FormEventBuiltinStatus} status
 *
 * @typedef {Object} FormEventReferenceDefinition
 * @property {string} key
 * @property {string} reference
 * @property {string} dataName
 * @property {string} label
 * @property {string} type
 * @property {string | null} description
 * @property {string | null} displayStyle
 * @property {string[]} parentPath
 *
 * @typedef {Object} FormEventCodeIssue
 * @property {string} code
 * @property {'error' | 'warning'} severity
 * @property {string} message
 * @property {string | null} symbol
 * @property {number | null} startIndex
 * @property {number | null} endIndex
 */

/**
 * Return the canonical builtin catalog for form event authoring.
 *
 * @returns {FormEventBuiltinDefinition[]}
 */
export function getFormEventBuiltinCatalog() {
  return FORM_EVENT_BUILTIN_CATALOG.map(cloneCatalogDefinition);
}

/**
 * Return the list of field references available for form event authoring.
 *
 * @param {Object} options
 * @param {Object} options.schema
 * @returns {FormEventReferenceDefinition[]}
 */
export function getFormEventReferenceCatalog({ schema }) {
  const form = normalizeFormSchema(schema);
  const resolver = new ContextResolver(form);

  return flattenFields(form.elements)
    .filter((field) => field && typeof field === 'object')
    .filter((field) => field.data_name)
    .filter((field) => !STRUCTURAL_FIELD_TYPES.has(field.type))
    .map((field) => toFormEventReferenceDefinition(field, resolver));
}

/**
 * Statistically analyze form event code without executing it.
 *
 * @param {Object} options
 * @param {string} options.code
 * @param {Object} options.schema
 * @param {Object} [options.securityConfig]
 * @returns {{
 *   valid: boolean,
 *   issues: FormEventCodeIssue[],
 *   usedBuiltins: string[],
 *   referencedFields: string[],
 * }}
 */
export function analyzeFormEventCode({
  code,
  schema,
  securityConfig = DEFAULT_SECURITY_CONFIG,
}) {
  const issues = [];
  const issueKeys = new Set();
  const usedBuiltins = [];
  const usedBuiltinNames = new Set();
  const referencedFields = [];
  const referencedFieldNames = new Set();
  const validEventTypes = new Set(getAllEventTypes());
  const normalizedCode = typeof code === 'string' ? code : '';
  const form = normalizeFormSchema(schema);
  const knownFieldNames = new Set(
    flattenFields(form.elements)
      .filter((field) => field && typeof field === 'object')
      .map((field) => field.data_name)
      .filter((fieldName) => typeof fieldName === 'string' && fieldName.length > 0)
  );

  if (normalizedCode.trim().length > 0) {
    try {
      validateSyntax(normalizedCode);
    } catch (error) {
      addIssue(
        issues,
        issueKeys,
        createIssue({
          code: 'invalid_syntax',
          severity: 'error',
          message:
            error instanceof Error && error.message
              ? `Invalid form event syntax: ${error.message}`
              : 'Invalid form event syntax.',
          index: 0,
          length: 1,
        })
      );
    }
  }

  const securityValidation = validateExpression(
    normalizedCode,
    createSchemaFilteredSecurityConfig(securityConfig),
    true
  );

  if (!securityValidation.valid) {
    addIssue(
      issues,
      issueKeys,
      createIssue({
        code: 'security_validation_failed',
        severity: 'error',
        message: securityValidation.reason,
        index: 0,
        length: 1,
      })
    );
  }

  for (const call of extractFunctionCalls(normalizedCode)) {
    if (isBuiltinCallMatchAllowed(call.name)) {
      continue;
    }

    const builtinDefinition = BUILTIN_DEFINITION_BY_NAME.get(call.name);
    if (builtinDefinition) {
      const isEventBuiltin = builtinDefinition.contexts.includes(BUILTIN_CONTEXTS.EVENT);

      if (!isEventBuiltin && builtinDefinition.contexts.includes(BUILTIN_CONTEXTS.CALCULATION)) {
        addIssue(
          issues,
          issueKeys,
          createIssue({
            code: 'calculation_builtin_not_allowed',
            severity: 'error',
            message: `${call.name}() is only available in CalculatedField expressions, not in form event code.`,
            symbol: call.name,
            index: call.index,
            length: call.length,
          })
        );
        continue;
      }

      const builtinMetadata = FORM_EVENT_BUILTIN_METADATA_BY_NAME.get(call.name);
      if (!builtinMetadata) {
        continue;
      }

      if (!usedBuiltinNames.has(call.name)) {
        usedBuiltinNames.add(call.name);
        usedBuiltins.push(call.name);
      }

      if (builtinMetadata.status === 'unavailable') {
        addIssue(
          issues,
          issueKeys,
          createIssue({
            code: 'unavailable_builtin',
            severity: 'error',
            message: `${call.name}() is not available in form event code.`,
            symbol: call.name,
            index: call.index,
            length: call.length,
          })
        );
      } else if (builtinMetadata.status === 'advanced') {
        addIssue(
          issues,
          issueKeys,
          createIssue({
            code: 'advanced_builtin',
            severity: 'warning',
            message: `${call.name}() is an advanced builtin. Prefer direct $field references when possible.`,
            symbol: call.name,
            index: call.index,
            length: call.length,
          })
        );
      }

      continue;
    }

    addIssue(
      issues,
      issueKeys,
      createIssue({
        code: 'unknown_builtin',
        severity: 'error',
        message: `Unknown builtin function: ${call.name}.`,
        symbol: call.name,
        index: call.index,
        length: call.length,
      })
    );
  }

  for (const reference of extractFieldReferenceMatches(normalizedCode)) {
    if (!referencedFieldNames.has(reference.fieldName)) {
      referencedFieldNames.add(reference.fieldName);
      referencedFields.push(reference.fieldName);
    }

    if (!knownFieldNames.has(reference.fieldName)) {
      addIssue(
        issues,
        issueKeys,
        createIssue({
          code: 'unknown_field_reference',
          severity: 'error',
          message: `Unknown field reference: ${reference.reference}.`,
          symbol: reference.reference,
          index: reference.index,
          length: reference.length,
        })
      );
    }
  }

  for (const eventTypeReference of extractLiteralEventTypeMatches(normalizedCode)) {
    if (validEventTypes.has(eventTypeReference.eventType)) {
      continue;
    }

    addIssue(
      issues,
      issueKeys,
      createIssue({
        code: 'unknown_event_type',
        severity: 'error',
        message: `Unknown event type: ${eventTypeReference.eventType}.`,
        symbol: eventTypeReference.eventType,
        index: eventTypeReference.index,
        length: eventTypeReference.length,
      })
    );
  }

  return {
    valid: issues.every((issue) => issue.severity !== 'error'),
    issues,
    usedBuiltins,
    referencedFields,
  };
}
