import {
  __invokeBoundEventBuiltin,
  __runWithEventOperationScope,
} from '../builtins/event/event-operations-collector.js';

const EVENT_OPERATION_BUILTINS = ['ALERT', 'SETVALUE', 'ON', 'OFF'];

/**
 * Create an operation scope owned by one synchronous event execution.
 * @param {Function} onLateOperation - Receives only the discarded operation name
 * @returns {Object} Private scope
 */
export function createEventOperationScope(onLateOperation) {
  let open = true;
  let operations = [];

  return {
    collect(operation) {
      if (open) {
        operations.push(operation);
        return;
      }

      onLateOperation(operation?.operation || operation?.type || 'unknown');
    },
    close() {
      if (!open) return [];
      open = false;
      const collected = operations;
      operations = [];
      return collected;
    },
  };
}

/**
 * Bind canonical event operation builtins to their originating scope.
 * Intentional helper overrides are left untouched.
 */
export function bindEventBuiltins(context, canonicalBuiltins, scope) {
  const boundContext = { ...context };

  for (const name of EVENT_OPERATION_BUILTINS) {
    const builtin = canonicalBuiltins[name];
    if (context[name] === builtin) {
      boundContext[name] = (...args) => __invokeBoundEventBuiltin(scope, builtin, args);
    }
  }

  return boundContext;
}

/** Run synchronous work while raw canonical builtins target this scope. */
export function runInEventOperationScope(scope, work) {
  return __runWithEventOperationScope(scope, work);
}

/** Close a scope and return its operations in creation order. */
export function closeEventOperationScope(scope) {
  return scope.close();
}
