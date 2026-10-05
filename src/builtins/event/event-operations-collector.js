let activeScope = null;
let boundScope = null;

/**
 * Internal function to collect event operations
 * @param {Object} operation - The operation descriptor to collect
 */
export function __collectEventOperation(operation) {
  const scope = boundScope || activeScope;
  scope?.collect(operation);
}

/**
 * Run synchronous event work with a dispatch-owned operation scope.
 * @param {Object} scope - The scope receiving operations
 * @param {Function} work - Synchronous work to execute
 * @returns {*} The work result
 */
export function __runWithEventOperationScope(scope, work) {
  const enclosingScope = activeScope;
  activeScope = scope;
  try {
    return work();
  } finally {
    activeScope = enclosingScope;
  }
}

/**
 * Invoke a canonical builtin with the scope it was bound to.
 * @param {Object} scope - The builtin's originating scope
 * @param {Function} builtin - Canonical event builtin
 * @param {Array} args - Builtin arguments
 * @returns {*} The builtin result
 */
export function __invokeBoundEventBuiltin(scope, builtin, args) {
  const enclosingScope = boundScope;
  boundScope = scope;
  try {
    return builtin(...args);
  } finally {
    boundScope = enclosingScope;
  }
}
