import { BUILTIN_DEFINITIONS } from '../builtins/builtin-definitions.js';

const operations = new Map(
  BUILTIN_DEFINITIONS.filter((entry) => entry.operation).map((entry) => [
    entry.name,
    entry.operation,
  ])
);
const knownEffects = new Set(['record-write', 'presentation', 'listeners', 'validation']);

export function validateInteractionMode(mode) {
  if (mode !== 'edit' && mode !== 'readonly') throw new Error('mode must be "edit" or "readonly".');
  return mode;
}

/** Shared descriptor policy; permission comes from the engine, never event metadata. */
export function eventOperationIssue(operation, mode, eventType) {
  const declaration = operations.get(operation?.operation);
  if (
    !declaration ||
    declaration.type !== operation?.type ||
    !declaration.effects.length ||
    declaration.effects.some((effect) => !knownEffects.has(effect))
  )
    return {
      code: 'invalid_operation',
      message: 'Event operations require declared, supported effects.',
    };
  const validation = /^(validate)-/.test(eventType);
  const closing = /^(cancel|unload)-/.test(eventType);
  if (declaration.effects.includes('validation')) {
    return validation
      ? null
      : {
          code: 'invalid_context',
          message: 'INVALID() is only available during managed validation.',
        };
  }
  if (validation || closing)
    return {
      code: 'operation_not_allowed',
      message: 'Validation and close handlers cannot perform value, listener or UI operations.',
    };
  if (mode === 'readonly' && declaration.effects.includes('record-write'))
    return {
      code: 'readonly_operation_not_allowed',
      message:
        'View-mode handlers cannot change record data. Guard SETVALUE() with event.mode or move writable initialization to a new/edit handler.',
    };
  return null;
}

export function reportEventOperationIssue(warningSystem, issue, eventType) {
  warningSystem.emitWarning({
    type: 'EVENT_OPERATION_WARNING',
    reason: issue.code,
    severity: 'error',
    message: issue.message,
    executionContext: { type: 'event', eventType, fieldName: null },
  });
}
