import { BUILTIN_CONTEXTS } from '../builtins/builtin-metadata.js';
import {
  BUILTIN_DEFINITION_BY_NAME,
  CALCULATION_BUILTIN_DEFINITIONS,
} from '../builtins/registry.js';
import { ContextResolver } from '../engine/context-resolver.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/config.js';
import { validateExpression } from '../security/validation.js';
import {
  isMultilineCalculationExpression,
  normalizeInlineCalculationExpression,
} from './calculation-expression-utils.js';
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

const CALCULATION_BUILTIN_STATUS_BY_NAME = Object.freeze({
  EVAL: 'advanced',
  FORM: 'unavailable',
});

function getCalculationBuiltinStatus(name) {
  return CALCULATION_BUILTIN_STATUS_BY_NAME[name] ?? 'stable';
}

function toCalculationBuiltinDefinition(definition) {
  return Object.freeze({
    name: definition.name,
    category: definition.category,
    signature: definition.signature,
    description: definition.description,
    examples: Object.freeze([...definition.examples]),
    status: getCalculationBuiltinStatus(definition.name),
  });
}

const CALCULATION_BUILTIN_CATALOG = Object.freeze(
  CALCULATION_BUILTIN_DEFINITIONS.map(toCalculationBuiltinDefinition)
);

const CALCULATION_BUILTIN_METADATA_BY_NAME = new Map(
  CALCULATION_BUILTIN_CATALOG.map((definition) => [definition.name, definition])
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

function buildExecutionContext(form, fieldDataName, resolver) {
  return {
    type: 'calculation',
    fieldName: fieldDataName,
    parentPath: resolver.getFieldInfo(fieldDataName)?.parentPath || [],
  };
}

function cloneCatalogDefinition(definition) {
  return {
    ...definition,
    examples: [...definition.examples],
  };
}

function toCalculationReferenceAccess(accessInfo) {
  return {
    level: accessInfo.level,
    code: accessInfo.code,
    message: accessInfo.message,
    suggestion: accessInfo.suggestion,
  };
}

function toCalculationReferenceDefinition(field, resolver, executionContext) {
  const accessInfo = resolver.resolveFieldAccessInfo(executionContext, field.data_name);

  if (accessInfo.level === 'not_found') {
    return null;
  }

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
    access: toCalculationReferenceAccess(accessInfo),
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

function validateSyntax(expression) {
  const isMultiLine = isMultilineCalculationExpression(expression);

  if (isMultiLine) {
    new Function(expression);
    return;
  }

  const inlineExpression = normalizeInlineCalculationExpression(expression);
  new Function(`return (${inlineExpression});`);
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
 * @typedef {'stable' | 'advanced' | 'unavailable'} CalculationBuiltinStatus
 *
 * @typedef {Object} CalculationBuiltinDefinition
 * @property {string} name
 * @property {string} category
 * @property {string} signature
 * @property {string} description
 * @property {string[]} examples
 * @property {CalculationBuiltinStatus} status
 *
 * @typedef {Object} CalculationReferenceDefinition
 * @property {string} key
 * @property {string} reference
 * @property {string} dataName
 * @property {string} label
 * @property {string} type
 * @property {string | null} description
 * @property {string | null} displayStyle
 * @property {string[]} parentPath
 * @property {{
 *   level: 'accessible' | 'restricted',
 *   code: 'main_form' | 'same_repeatable_section' | 'ancestor_repeatable_context' | 'different_repeatable_section',
 *   message: string | null,
 *   suggestion: string | null,
 * }} access
 *
 * @typedef {Object} CalculationExpressionIssue
 * @property {string} code
 * @property {'error' | 'warning'} severity
 * @property {string} message
 * @property {string | null} symbol
 * @property {number | null} startIndex
 * @property {number | null} endIndex
 */

/**
 * Return the canonical builtin catalog for CalculatedField authoring.
 * Event-only builtins are intentionally excluded.
 *
 * @returns {CalculationBuiltinDefinition[]}
 */
export function getCalculationBuiltinCatalog() {
  return CALCULATION_BUILTIN_CATALOG.map(cloneCatalogDefinition);
}

/**
 * Return the list of field references accessible from the given CalculatedField.
 *
 * @param {Object} options
 * @param {Object} options.schema
 * @param {string} options.fieldDataName
 * @param {boolean} [options.includeRestricted=false]
 * @returns {CalculationReferenceDefinition[]}
 */
export function getCalculationReferenceCatalog({
  schema,
  fieldDataName,
  includeRestricted = false,
}) {
  const form = normalizeFormSchema(schema);
  const resolver = new ContextResolver(form);
  const executionContext = buildExecutionContext(form, fieldDataName, resolver);

  return flattenFields(form.elements)
    .filter((field) => field && typeof field === 'object')
    .filter((field) => field.data_name && field.data_name !== fieldDataName)
    .filter(
      (field) =>
        field.type !== 'Section' &&
        field.type !== 'RepeatableSection' &&
        field.type !== 'BuildingPlanSection'
    )
    .map((field) => toCalculationReferenceDefinition(field, resolver, executionContext))
    .filter((reference) => reference !== null)
    .filter((reference) => includeRestricted || reference.access.level === 'accessible');
}

/**
 * Statistically analyze a CalculatedField expression without executing it.
 *
 * @param {Object} options
 * @param {string} options.expression
 * @param {Object} options.schema
 * @param {string} options.fieldDataName
 * @param {Object} [options.securityConfig]
 * @returns {{
 *   valid: boolean,
 *   issues: CalculationExpressionIssue[],
 *   usedBuiltins: string[],
 *   referencedFields: string[],
 * }}
 */
export function analyzeCalculationExpression({
  expression,
  schema,
  fieldDataName,
  securityConfig = DEFAULT_SECURITY_CONFIG,
}) {
  const issues = [];
  const issueKeys = new Set();
  const usedBuiltins = [];
  const usedBuiltinNames = new Set();
  const referencedFields = [];
  const referencedFieldNames = new Set();
  const setResultCalls = [];

  const normalizedExpression = typeof expression === 'string' ? expression : '';
  const form = normalizeFormSchema(schema);
  const resolver = new ContextResolver(form);
  const executionContext = buildExecutionContext(form, fieldDataName, resolver);

  if (normalizedExpression.trim().length === 0) {
    addIssue(
      issues,
      issueKeys,
      createIssue({
        code: 'empty_expression',
        severity: 'error',
        message: 'Calculation expression cannot be empty.',
        index: 0,
        length: 1,
      })
    );
  }

  try {
    validateSyntax(normalizedExpression);
  } catch (error) {
    addIssue(
      issues,
      issueKeys,
      createIssue({
        code: 'invalid_syntax',
        severity: 'error',
        message:
          error instanceof Error && error.message
            ? `Invalid calculation syntax: ${error.message}`
            : 'Invalid calculation syntax.',
        index: 0,
        length: 1,
      })
    );
  }

  const securityValidation = validateExpression(
    normalizedExpression,
    createSchemaFilteredSecurityConfig(securityConfig),
    false
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

  for (const call of extractFunctionCalls(normalizedExpression)) {
    if (isBuiltinCallMatchAllowed(call.name)) {
      continue;
    }

    const builtinDefinition = BUILTIN_DEFINITION_BY_NAME.get(call.name);
    if (builtinDefinition) {
      const isCalculationBuiltin = builtinDefinition.contexts.includes(
        BUILTIN_CONTEXTS.CALCULATION
      );

      if (!isCalculationBuiltin && builtinDefinition.contexts.includes(BUILTIN_CONTEXTS.EVENT)) {
        addIssue(
          issues,
          issueKeys,
          createIssue({
            code: 'event_builtin_not_allowed',
            severity: 'error',
            message: `${call.name}() is only available in form event handlers, not in CalculatedField expressions.`,
            symbol: call.name,
            index: call.index,
            length: call.length,
          })
        );
        continue;
      }

      const builtinMetadata = CALCULATION_BUILTIN_METADATA_BY_NAME.get(call.name);
      if (!builtinMetadata) {
        continue;
      }

      if (!usedBuiltinNames.has(call.name)) {
        usedBuiltinNames.add(call.name);
        usedBuiltins.push(call.name);
      }

      if (call.name === 'SETRESULT') {
        setResultCalls.push(call);
      }

      if (builtinMetadata.status === 'unavailable') {
        addIssue(
          issues,
          issueKeys,
          createIssue({
            code: 'unavailable_builtin',
            severity: 'error',
            message: `${call.name}() is not available in CalculatedField expressions.`,
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

  if (setResultCalls.length > 1) {
    const duplicateSetResultCall = setResultCalls[1];
    addIssue(
      issues,
      issueKeys,
      createIssue({
        code: 'multiple_setresult_calls',
        severity: 'error',
        message: 'SETRESULT() can only be used once in a CalculatedField expression.',
        symbol: duplicateSetResultCall.name,
        index: duplicateSetResultCall.index,
        length: duplicateSetResultCall.length,
      })
    );
  }

  for (const reference of extractFieldReferenceMatches(normalizedExpression)) {
    if (!referencedFieldNames.has(reference.fieldName)) {
      referencedFieldNames.add(reference.fieldName);
      referencedFields.push(reference.fieldName);
    }

    const accessInfo = resolver.resolveFieldAccessInfo(executionContext, reference.fieldName);
    if (accessInfo.level === 'restricted') {
      addIssue(
        issues,
        issueKeys,
        createIssue({
          code: 'restricted_field_reference',
          severity: 'error',
          message:
            accessInfo.suggestion ||
            accessInfo.message ||
            resolver.generateAccessSuggestion(
              executionContext,
              reference.fieldName,
              resolver.getFieldInfo(reference.fieldName)
            ),
          symbol: reference.reference,
          index: reference.index,
          length: reference.length,
        })
      );
    } else if (accessInfo.level === 'not_found') {
      addIssue(
        issues,
        issueKeys,
        createIssue({
          code: 'unknown_field_reference',
          severity: 'error',
          message: `Field '${reference.fieldName}' does not exist in the form schema.`,
          symbol: reference.reference,
          index: reference.index,
          length: reference.length,
        })
      );
    }
  }

  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
    usedBuiltins,
    referencedFields,
  };
}
