import { runExpression } from './evaluator.js';
import { __consumeEventOperations } from '../builtins/registry.js';
import { ContextResolver } from './context-resolver.js';
import { WarningSystem } from './warning-system.js';

// Global registry to track logged event handlers (development only)
const _loggedHandlers = new Set();

/**
 * EventManager handles form event registration and execution
 */
export class EventManager {
  constructor(schema = null, contextResolver = null, warningSystem = null) {
    this.listeners = new Map(); // eventType -> Map<fieldKey, callback[]>
    this.eventContext = null;
    this.securityConfig = null;

    // Context resolution for scoped field access
    this.contextResolver = contextResolver || (schema ? new ContextResolver(schema) : null);
    this.warningSystem = warningSystem || new WarningSystem();
    this.schema = schema;
  }

  /**
   * Called once during form initialization to register listeners
   * @param {string} eventCode - The event code to execute
   * @param {Object} context - The context for execution
   */
  initializeEventCode(eventCode, context) {
    this.eventContext = context;
    try {
      // Execute the event code to register listeners (recompile each time)
      this.executeEventCode(eventCode, context);
    } catch (error) {
      console.warn('[form0] Event code initialization failed:', error.message);
    }
  }

  /**
   * Execute event code to register listeners
   * @param {string} code - The event code
   * @param {Object} context - The execution context
   */
  executeEventCode(code, context) {
    // Execute the code to register event listeners (same security as calculated fields)
    // ON() and OFF() are now available as regular event builtins
    runExpression(code, context, this.securityConfig, true);

    // Process any ON/OFF operations that were collected during initialization
    const initOperations = __consumeEventOperations();
    this.processEventOperations(initOperations);
  }

  /**
   * Register an event listener
   * @param {string} eventType - The event type
   * @param {string} fieldKey - The field key or '*' for all fields
   * @param {Function} callback - The callback function
   */
  registerListener(eventType, fieldKey, callback) {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Map());
    }

    const eventMap = this.listeners.get(eventType);
    if (!eventMap.has(fieldKey)) {
      eventMap.set(fieldKey, []);
    }

    eventMap.get(fieldKey).push(callback);
  }

  /**
   * Remove event listener(s)
   * @param {string} eventType - The event type
   * @param {string} fieldKey - The field key or '*' for all fields
   * @param {Function} [callback] - Specific callback to remove, or undefined to remove all
   */
  removeListener(eventType, fieldKey, callback) {
    const eventMap = this.listeners.get(eventType);
    if (!eventMap) return;

    const fieldListeners = eventMap.get(fieldKey);
    if (!fieldListeners) return;

    if (callback) {
      // Remove specific callback
      const index = fieldListeners.indexOf(callback);
      if (index > -1) {
        fieldListeners.splice(index, 1);
      }
    } else {
      // Remove all callbacks for this field
      fieldListeners.length = 0;
    }

    // Clean up empty arrays
    if (fieldListeners.length === 0) {
      eventMap.delete(fieldKey);
    }

    // Clean up empty event maps
    if (eventMap.size === 0) {
      this.listeners.delete(eventType);
    }
  }

  /**
   * Process ON/OFF operations during event execution
   * @param {Array} operations - Array of operation descriptors
   */
  processEventOperations(operations) {
    operations.forEach((operation) => {
      if (operation.type === 'EVENT_OPERATION') {
        const { operation: op, params } = operation;

        if (op === 'ON') {
          this.registerListener(params.eventType, params.fieldKey, params.callback);

          // Only log if this handler hasn't been logged before (prevents spam during development)
          const functionName = params.callback.name || 'function';
          const handlerKey = `${params.eventType}:${params.fieldKey}:${functionName}`;

          if (!_loggedHandlers.has(handlerKey)) {
            _loggedHandlers.add(handlerKey);

            // Format console output cleanly
            const isGlobalEvent = params.fieldKey === '*';
            const displayText = isGlobalEvent
              ? `ON('${params.eventType}', ${functionName})`
              : `ON('${params.eventType}', '${params.fieldKey}', ${functionName})`;
            console.log(`🔧 [EVENT HANDLER] Registered: ${displayText}`);
          }
        } else if (op === 'OFF') {
          this.removeListener(params.eventType, params.fieldKey, params.callback);

          // Always log OFF operations since they represent dynamic changes
          const isGlobalEvent = params.fieldKey === '*';
          const hasCallback = params.callback !== undefined;

          let displayText;
          if (isGlobalEvent) {
            displayText = hasCallback
              ? `OFF('${params.eventType}', ${params.callback.name || 'function'})`
              : `OFF('${params.eventType}')`;
          } else {
            displayText = hasCallback
              ? `OFF('${params.eventType}', '${params.fieldKey}', ${params.callback.name || 'function'})`
              : `OFF('${params.eventType}', '${params.fieldKey}')`;
          }
          console.log(`🔧 [EVENT HANDLER] Removed: ${displayText}`);

          // Clear logged handlers cache for removed handlers
          if (hasCallback) {
            const functionName = params.callback.name || 'function';
            const handlerKey = `${params.eventType}:${params.fieldKey}:${functionName}`;
            _loggedHandlers.delete(handlerKey);
          } else {
            // If removing all handlers, clear all related entries
            const prefix = `${params.eventType}:${params.fieldKey}:`;
            for (const key of _loggedHandlers) {
              if (key.startsWith(prefix)) {
                _loggedHandlers.delete(key);
              }
            }
          }
        }
      }
    });
  }

  /**
   * Execute event handler with current form context
   * @param {Function} callback - The event handler function
   * @param {Object} event - The event object
   * @returns {*} The result of the event handler
   */
  executeHandlerWithContext(callback, event) {
    // Create execution context for this event
    const executionContext = {
      type: 'event',
      eventType: event.type,
      fieldName: event.fieldKey || null,
    };

    // Get the callback code for field reference analysis
    const callbackCode = callback.toString();

    // Build scoped context if context resolver is available
    let contextWithEvent;
    if (this.contextResolver && this.warningSystem) {
      contextWithEvent = this.buildScopedEventContext(
        this.eventContext,
        executionContext,
        event,
        callbackCode
      );
    } else {
      // Fallback to legacy context building for backward compatibility
      contextWithEvent = {
        ...this.eventContext,
        event: event,
      };
    }

    // Execute the callback function with the scoped context
    // This ensures EVAL() and other builtins have access to field values
    const functionCall = `(${callbackCode})(event)`;
    return runExpression(functionCall, contextWithEvent, this.securityConfig, true);
  }

  /**
   * Build scoped event context with field access restrictions
   * @param {Object} baseContext - Base event context with helpers and field values
   * @param {Object} executionContext - Execution context for the event
   * @param {Object} event - Event object
   * @returns {Object} Scoped context with restricted field access
   */
  buildScopedEventContext(baseContext, executionContext, event, expressionCode) {
    // Separate field values from helpers/builtins
    const fieldValues = {};
    const helpers = {};

    for (const [key, value] of Object.entries(baseContext)) {
      if (key.startsWith('$')) {
        const fieldName = key.substring(1); // Remove $ prefix
        fieldValues[fieldName] = value;
      } else {
        helpers[key] = value;
      }
    }

    // Find which fields are actually referenced in the expression
    const referencedFields = this.extractFieldReferences(expressionCode);

    // Build scoped context
    const ctx = { ...helpers, event };

    // Track problematic fields that are actually accessed
    const restrictedAccessedFields = [];
    const notFoundAccessedFields = [];

    // Add scoped field access
    for (const [fieldName, value] of Object.entries(fieldValues)) {
      const accessLevel = this.contextResolver.resolveFieldAccess(executionContext, fieldName);

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
      // Check if this field was processed above (exists in fieldValues)
      if (!(fieldName in fieldValues)) {
        const accessLevel = this.contextResolver.resolveFieldAccess(executionContext, fieldName);
        if (accessLevel === 'not_found') {
          notFoundAccessedFields.push(fieldName);
          // Don't add to context - it will be undefined when accessed
        }
      }
    }

    // Emit warnings for restricted fields that are actually accessed
    restrictedAccessedFields.forEach((fieldName) => {
      const warning = this.contextResolver.generateAccessWarning(
        executionContext,
        fieldName,
        'restricted'
      );
      this.warningSystem.emitWarning(warning);
    });

    // Emit warnings for not_found fields that are actually accessed
    notFoundAccessedFields.forEach((fieldName) => {
      const warning = this.contextResolver.generateAccessWarning(
        executionContext,
        fieldName,
        'not_found'
      );
      this.warningSystem.emitWarning(warning);
    });

    return ctx;
  }

  /**
   * Extract field references from expression code (simple regex-based approach)
   * Skips field references inside EVAL() calls to avoid false positives from dynamic field construction
   * @param {string} code - The expression/code to analyze
   * @returns {Set<string>} Set of field names referenced in the code
   */
  extractFieldReferences(code) {
    const fieldReferences = new Set();

    // Remove content inside EVAL() calls to avoid false positives
    // This handles complex patterns like EVAL('string' + variable + 'more')
    const cleanedCode = this.removeEvalContents(code);

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
  removeEvalContents(code) {
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

  /**
   * Called when events are triggered
   * @param {string} eventType - The event type
   * @param {string} fieldKey - The field key (for field events)
   * @param {Object} eventMetadata - Additional event metadata
   * @returns {Array} Array of operation descriptors
   */
  trigger(eventType, fieldKey, eventMetadata) {
    const operations = [];
    const eventMap = this.listeners.get(eventType);

    if (!eventMap) return operations;

    // Build event object (placeholder structure for now)
    const event = {
      type: eventType,
      fieldKey: fieldKey,
      timestamp: Date.now(),
      // TODO: Add more metadata as needed
      ...eventMetadata,
    };

    // Create execution context for operation validation
    const executionContext = {
      type: 'event',
      eventType: eventType,
      fieldName: fieldKey || null,
    };

    // Execute specific field listeners
    const fieldListeners = eventMap.get(fieldKey) || [];
    const wildcardListeners = eventMap.get('*') || [];

    [...fieldListeners, ...wildcardListeners].forEach((callback) => {
      try {
        // Execute the callback with current form context
        // This ensures EVAL() and other builtins have access to field values
        const result = this.executeHandlerWithContext(callback, event);

        // Consume any collected event operations
        const collectedOps = __consumeEventOperations();

        // Validate operations against context restrictions before adding them
        const validOps = this.validateOperations(collectedOps, executionContext);
        operations.push(...validOps);

        // Note: EVENT_OPERATION processing (ON/OFF) is handled only during initialization
        // If event handlers contain ON/OFF calls, they will be in the operations array
        // but won't be processed here to avoid duplicate registrations

        // For backward compatibility, still handle returned operations
        if (result && result.type === 'UI_OPERATION') {
          operations.push(result);
        }
      } catch (error) {
        // Simple error message for now
        console.warn(`[form0] Event listener failed: ${error.message}`);
        // Make sure to consume operations even if callback fails
        __consumeEventOperations();
      }
    });

    return operations;
  }

  /**
   * Validate operations against context restrictions
   * Filters out invalid field operations and generates warnings for them
   * @param {Array} operations - Array of operation objects to validate
   * @param {Object} executionContext - Current execution context
   * @returns {Array} Array of valid operations
   */
  validateOperations(operations, executionContext) {
    if (!this.contextResolver || !this.warningSystem) {
      return operations; // No validation available, return all operations
    }

    const validOperations = [];

    operations.forEach((operation) => {
      // Only validate field operations that access fields
      if (operation.type === 'FIELD_OPERATION' && operation.operation === 'SETVALUE') {
        const fieldName = operation.params.fieldDataName;
        const accessLevel = this.contextResolver.resolveFieldAccess(executionContext, fieldName);

        if (accessLevel === 'accessible') {
          // Field is accessible, operation is valid
          validOperations.push(operation);
        } else {
          // Field is not accessible, generate warning and block operation
          const reason = accessLevel === 'not_found' ? 'not_found' : 'restricted';
          const warning = this.contextResolver.generateAccessWarning(
            executionContext,
            fieldName,
            reason
          );
          this.warningSystem.emitWarning(warning);
        }
      } else {
        // Non-field operations (like ALERT) are always valid
        validOperations.push(operation);
      }
    });

    return validOperations;
  }
}
