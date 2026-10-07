/**
 * Engine-private, evaluation-scoped calculation reporting. Legacy warning handlers
 * and throttling remain independent of this snapshot.
 */
export function createCalculationDiagnostics(options, observer, resolver, warningSystem) {
  const consoleOverride = typeof options?.console === 'boolean' ? options.console : undefined;
  const frames = [];
  let snapshot = [];
  const copy = (items) => JSON.parse(JSON.stringify(items));

  function reportObserverFailure() {
    if (consoleOverride ?? warningSystem.enableConsoleWarnings) {
      console.warn('[form0] onDiagnostics observer failed.');
    }
  }

  function record(fieldName, diagnostic) {
    const frame = frames.at(-1);
    if (!frame) return;
    const item = {
      code: diagnostic.code,
      severity: diagnostic.severity || 'error',
      message:
        typeof diagnostic.message === 'string'
          ? diagnostic.message
          : 'Unknown calculation runtime error.',
      fieldName,
      phase: diagnostic.phase,
      suggestion: diagnostic.suggestion || null,
      context: {
        source: 'expression',
        parentPath: [...(resolver.getFieldInfo(fieldName)?.parentPath || [])],
        ...diagnostic.context,
      },
    };
    const key = JSON.stringify(item);
    if (!frame.keys.has(key)) {
      frame.keys.add(key);
      frame.items.push(copy([item])[0]);
    }
  }

  function emitWarning(warning, fieldNames = [warning.executionContext.fieldName]) {
    const isScope = warning.type === 'FIELD_ACCESS_WARNING';
    for (const fieldName of fieldNames) {
      record(fieldName, {
        code: isScope
          ? warning.reason === 'not_found'
            ? 'missing_reference'
            : 'restricted_reference'
          : warning.reason,
        severity: warning.severity || 'warning',
        phase: isScope ? 'scope' : 'dependency',
        message: warning.message,
        suggestion: warning.suggestion,
        context: isScope
          ? { referencedFieldName: warning.fieldName }
          : {
              ...(warning.fieldContext.fieldNames
                ? { fieldNames: [...warning.fieldContext.fieldNames] }
                : {}),
              ...(warning.fieldContext.maxPasses
                ? { maxPasses: warning.fieldContext.maxPasses }
                : {}),
            },
      });
    }
    warningSystem.emitWarning(
      warning,
      consoleOverride === undefined ? undefined : { console: false }
    );
  }

  return {
    consoleOverride,
    record,
    emitWarning,
    begin() {
      const frame = { items: [], keys: new Set() };
      frames.push(frame);
      return frame;
    },
    abort(frame) {
      frames.splice(frames.indexOf(frame), 1);
    },
    complete(frame) {
      frames.splice(frames.indexOf(frame), 1);
      snapshot = copy(frame.items);
      if (consoleOverride === true) {
        for (const item of frame.items) {
          console.warn(`[form0] ${item.code} (${item.fieldName}): ${item.message}`);
        }
      }
      if (typeof observer === 'function') {
        try {
          const result = observer(copy(frame.items));
          if (result && typeof result.then === 'function') {
            Promise.resolve(result).catch(reportObserverFailure);
          }
        } catch {
          reportObserverFailure();
        }
      }
    },
    getSnapshot: () => copy(snapshot),
  };
}
