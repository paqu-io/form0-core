import { runExpression } from './evaluator.js';
import { flattenFields } from '../utilities/field-helpers.js';
import { ContextResolver } from './context-resolver.js';
import { WarningSystem } from './warning-system.js';

export function evaluateCalculatedFields(
  schema,
  values,
  helpers,
  securityConfig,
  contextResolver = null,
  warningSystem = null,
  runtimeDiagnostics = null
) {
  const fields = flattenFields(schema.elements);

  // Initialize context resolver and warning system if not provided (backward compatibility)
  const resolver = contextResolver || new ContextResolver(schema);
  const warnings = warningSystem || new WarningSystem();

  fields.forEach((field) => {
    if (field.type === 'CalculatedField' && field.calculate) {
      try {
        // Create execution context for this calculation
        const executionContext = {
          type: 'calculation',
          fieldName: field.data_name,
          parentPath: resolver.getFieldInfo(field.data_name)?.parentPath || [],
        };

        const context = buildScopedContext(
          values,
          helpers,
          executionContext,
          resolver,
          warnings,
          field.calculate
        );
        values[field.data_name] = runExpression(
          field.calculate,
          context,
          securityConfig,
          false,
          schema,
          {
            suppressConsoleWarning: Array.isArray(runtimeDiagnostics),
            onError: (error) => {
              if (!Array.isArray(runtimeDiagnostics)) {
                return;
              }

              runtimeDiagnostics.push({
                fieldName: field.data_name,
                message:
                  error instanceof Error && error.message
                    ? error.message
                    : 'Unknown calculation runtime error.',
              });
            },
          }
        );
      } catch (e) {
        if (Array.isArray(runtimeDiagnostics)) {
          runtimeDiagnostics.push({
            fieldName: field.data_name,
            message:
              e instanceof Error && e.message
                ? e.message
                : 'Unknown calculation runtime error.',
          });
        }
        if (!Array.isArray(runtimeDiagnostics)) {
          console.warn(`Calculation failed for ${field.data_name}:`, e.message);
        }
      }
    }
  });
}

function buildScopedContext(
  values,
  helpers,
  executionContext,
  contextResolver,
  warningSystem,
  expressionCode
) {
  const ctx = { ...helpers };

  // Find which fields are actually referenced in the expression
  const referencedFields = extractFieldReferences(expressionCode);

  // Track problematic fields that are actually accessed
  const restrictedAccessedFields = [];
  const notFoundAccessedFields = [];

  // Add scoped field access
  for (const [fieldName, value] of Object.entries(values)) {
    const accessLevel = contextResolver.resolveFieldAccess(executionContext, fieldName);

    if (accessLevel === 'accessible') {
      ctx[`$${fieldName}`] = value;
    } else if (accessLevel === 'restricted') {
      // Only add restricted fields to context if they're actually referenced
      if (referencedFields.has(fieldName)) {
        ctx[`$${fieldName}`] = undefined;
        restrictedAccessedFields.push(fieldName);
      }
      // If not referenced, don't add to context at all
    }
    // 'not_found' fields are not added to context at all
  }

  // Check for not_found fields that are actually referenced
  for (const fieldName of referencedFields) {
    // Check if this field was processed above (exists in values)
    if (!(fieldName in values)) {
      const accessLevel = contextResolver.resolveFieldAccess(executionContext, fieldName);
      if (accessLevel === 'not_found') {
        notFoundAccessedFields.push(fieldName);
        // Don't add to context - it will be undefined when accessed
      }
    }
  }

  // Emit warnings for restricted fields that are actually accessed
  restrictedAccessedFields.forEach((fieldName) => {
    const warning = contextResolver.generateAccessWarning(
      executionContext,
      fieldName,
      'restricted'
    );
    warningSystem.emitWarning(warning);
  });

  // Emit warnings for not_found fields that are actually accessed
  notFoundAccessedFields.forEach((fieldName) => {
    const warning = contextResolver.generateAccessWarning(executionContext, fieldName, 'not_found');
    warningSystem.emitWarning(warning);
  });

  return ctx;
}

/**
 * Extract field references from expression code (simple regex-based approach)
 * Skips field references inside EVAL() calls to avoid false positives from dynamic field construction
 * @param {string} code - The expression/code to analyze
 * @returns {Set<string>} Set of field names referenced in the code
 */
function extractFieldReferences(code) {
  const fieldReferences = new Set();

  // Remove content inside EVAL() calls to avoid false positives
  // This handles complex patterns like EVAL('string' + variable + 'more')
  const cleanedCode = removeEvalContents(code);

  // Simple regex to find $fieldname patterns in the cleaned code
  // This matches $ followed by valid JavaScript identifier characters
  const fieldRegex = /\$([a-zA-Z_][a-zA-Z0-9_]*)/g;
  let match;

  while ((match = fieldRegex.exec(cleanedCode)) !== null) {
    fieldReferences.add(match[1]); // Add the field name (without $)
  }

  return fieldReferences;
}

/**
 * Remove EVAL() function calls and their contents from code
 * Handles nested parentheses and complex expressions inside EVAL()
 * @param {string} code - The code to clean
 * @returns {string} Code with EVAL() contents removed
 */
function removeEvalContents(code) {
  let result = '';
  let i = 0;

  while (i < code.length) {
    // Look for EVAL pattern
    const evalMatch = code.substring(i).match(/^EVAL\s*\(/);
    if (evalMatch) {
      // Found EVAL(, add "EVAL()" to result and skip the entire call
      result += 'EVAL()';
      i += evalMatch[0].length;

      // Skip everything until we find the matching closing parenthesis
      let parenCount = 1;
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let inBacktick = false;

      while (i < code.length && parenCount > 0) {
        const char = code[i];

        // Handle string literals (ignore parentheses inside strings)
        if (char === "'" && !inDoubleQuote && !inBacktick) {
          inSingleQuote = !inSingleQuote;
        } else if (char === '"' && !inSingleQuote && !inBacktick) {
          inDoubleQuote = !inDoubleQuote;
        } else if (char === '`' && !inSingleQuote && !inDoubleQuote) {
          inBacktick = !inBacktick;
        }

        // Only count parentheses when not inside strings
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
      // Not an EVAL call, add character to result
      result += code[i];
      i++;
    }
  }

  return result;
}

// Legacy function for backward compatibility
function buildContext(values, helpers) {
  const ctx = {};
  for (const key in values) {
    ctx[`$${key}`] = values[key];
  }
  return { ...ctx, ...helpers };
}
