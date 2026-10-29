import { getEventInfo, isValidEventType } from './event-registry.js';
import { closeEventOperationScope, createEventOperationScope } from './event-operation-scope.js';
import { getEventFieldReferences } from './event-field-references.js';
import { eventOperationIssue, reportEventOperationIssue } from './event-policy.js';
import { assertWritableField } from '../utilities/field-value-normalization.js';

// Portable defensive copies also work in runtimes without structuredClone (including Hermes).
function copy(value, seen = new Map()) {
  if (typeof value === 'function' || typeof value === 'symbol')
    throw new Error('Event data must not contain functions or symbols.');
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (value instanceof Date) return new Date(value.getTime());
  // Media controls retain native binary handles. Copy their immutable data and standard metadata
  // without serializing custom properties or loading the bytes into JavaScript memory.
  if (typeof File === 'function' && value instanceof File)
    return new File([value], value.name, { type: value.type, lastModified: value.lastModified });
  if (typeof Blob === 'function' && value instanceof Blob)
    return Blob.prototype.slice.call(value, 0, value.size, value.type);
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error('Event data must use plain objects, arrays, dates or native media handles.');
  const result = Array.isArray(value) ? [] : {};
  seen.set(value, result);
  for (const key of Object.keys(value)) {
    Object.defineProperty(result, key, {
      value: copy(value[key], seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return result;
}

const managedReferenceCaches = new WeakMap();
const managedFieldCaches = new WeakMap();
const managedRepeatableCaches = new WeakMap();

/** Internal adapter; the public synchronous API is engine.triggerDetailed(). */
export function createManagedEventDispatcher(manager, constructionScope, getMode = () => 'edit') {
  const instancePath = copy(constructionScope?.instancePath);
  const scopeId = constructionScope?.scopeId;
  if (scopeId !== undefined && (typeof scopeId !== 'string' || !scopeId.trim()))
    throw new Error('eventScope.scopeId must be a nonempty string when supplied.');
  const resolver = manager.contextResolver;
  if (!managedFieldCaches.has(resolver))
    managedFieldCaches.set(resolver, new Map(resolver.fieldOwnership));
  const fields = managedFieldCaches.get(resolver);
  if (!managedRepeatableCaches.has(resolver))
    managedRepeatableCaches.set(
      resolver,
      new Map(
        [...resolver.repeatableSectionTree.values()].map((entry) => [
          JSON.stringify([entry.parentPath, entry.preferredKey]),
          entry,
        ])
      )
    );
  const repeatableIndex = managedRepeatableCaches.get(resolver);
  const statusField = manager.schema?.status_field;
  if (statusField?.enabled && typeof statusField.data_name === 'string')
    fields.set(statusField.data_name, { field: statusField, parentPath: [] });
  if (!Array.isArray(instancePath)) throw new Error('eventScope.instancePath must be an array.');
  const ownershipPath = [];
  for (const segment of instancePath) {
    const repeatable = repeatableIndex.get(JSON.stringify([ownershipPath, segment?.repeatableKey]));
    if (
      !repeatable ||
      JSON.stringify(repeatable.parentPath) !== JSON.stringify(ownershipPath) ||
      !Number.isInteger(segment.index) ||
      segment.index < 0 ||
      !['id', 'position'].includes(segment.identity) ||
      (segment.identity === 'id'
        ? !(typeof segment.instanceId === 'string' && segment.instanceId.trim()) &&
          !(typeof segment.instanceId === 'number' && Number.isFinite(segment.instanceId))
        : segment.instanceId !== null)
    ) {
      throw new Error(
        'eventScope.instancePath must describe a complete repeatable ancestry with an ID or explicit positional identity.'
      );
    }
    ownershipPath.push(repeatable.preferredKey);
  }
  const same = (path) => JSON.stringify(path) === JSON.stringify(ownershipPath);
  const readable = (path) =>
    path.length <= ownershipPath.length && path.every((key, index) => ownershipPath[index] === key);
  const ownedField = (name) => fields.get(name) || resolver.repeatableSectionTree.get(name);
  if (!managedReferenceCaches.has(manager)) managedReferenceCaches.set(manager, new WeakMap());
  const referenceCache = managedReferenceCaches.get(manager);
  return function dispatch(eventType, fieldKey, metadata = {}) {
    const mode = getMode();
    const result = { operations: [], validationIssues: [], issues: [] };
    const issue = (code, message) =>
      result.issues.push({
        code,
        message,
        eventType: typeof eventType === 'string' ? eventType : null,
        instancePath: copy(instancePath),
      });
    if (
      typeof eventType !== 'string' ||
      !isValidEventType(eventType) ||
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata)
    ) {
      issue('invalid_request', 'A registered event type and metadata object are required.');
      return result;
    }
    const info = getEventInfo(eventType);
    const target = ownedField(fieldKey);
    const routeValid =
      info.category === 'record'
        ? ownershipPath.length === 0 &&
          (fieldKey === undefined ||
            fieldKey === null ||
            (eventType === 'change-status' &&
              statusField?.enabled &&
              fieldKey === statusField.data_name))
        : info.category === 'repeatable'
          ? resolver.repeatableSectionTree.has(fieldKey) && same(target.currentPath)
          : typeof fieldKey === 'string' && target && same(target.parentPath);
    if (!routeValid) {
      issue(
        'invalid_routing_context',
        'The event target is not owned by the executing engine scope.'
      );
      return result;
    }
    for (const initializationIssue of manager.initializationIssues)
      issue(initializationIssue.code, initializationIssue.message);
    if (result.issues.length) return result;
    let event;
    try {
      event = {
        ...copy(metadata),
        type: eventType,
        fieldKey,
        timestamp: Date.now(),
        instancePath: copy(instancePath),
        scopeId,
        mode,
      };
    } catch {
      issue('invalid_request', 'Event metadata must contain portable data.');
      return result;
    }
    const registrations = [];
    const eventMap = manager.listeners.get(eventType);
    const listeners = [...(eventMap?.get(fieldKey) || []), ...(eventMap?.get('*') || [])];
    for (const callback of listeners) {
      const scope = createEventOperationScope((operationName) => {
        // Late async work cannot mutate this completed result or break another dispatch.
        try {
          manager.emitHandlerWarning(
            'late_event_operation_discarded',
            { type: 'event', eventType, fieldName: fieldKey || null },
            callback.name || '<anonymous>',
            operationName
          );
        } catch {
          /* Reporting is observational. */
        }
      });
      let returned;
      let collected;
      try {
        const source = manager.callbackSources.getSource(callback);
        if (referenceCache.get(callback)?.source !== source) {
          const references =
            manager.referenceSourceCache?.get(source) ?? getEventFieldReferences(source);
          manager.referenceSourceCache?.set(source, references);
          referenceCache.set(callback, { source, references });
        }
        let rejectedReference = false;
        for (const name of referenceCache.get(callback).references) {
          const field = fields.get(name);
          if (!field || !readable(field.parentPath)) {
            issue(
              'read_scope_restricted',
              `Field '${name}' is not readable from the executing scope.`
            );
            rejectedReference = true;
          }
        }
        if (rejectedReference) continue;
        const context = { event: copy(event) };
        for (const [key, value] of Object.entries(manager.eventContext)) {
          if (!key.startsWith('$')) context[key] = value;
          else {
            const field = fields.get(key.slice(1));
            if (field && readable(field.parentPath)) context[key] = copy(value);
          }
        }
        context.event = copy(event);
        returned = manager.executeHandlerWithContext(callback, event, scope, {
          source,
          context,
          reporting: {
            suppressConsoleWarning: true,
            onDiagnostic: (diagnostic) => issue('handler_failed', diagnostic.message),
            evalReporting: {
              suppressConsole: true,
              onDiagnostic: (diagnostic) => issue('read_scope_restricted', diagnostic.message),
            },
          },
        });
        if (returned && typeof returned.then === 'function') {
          issue('async_handler_unsupported', 'Managed schema handlers must be synchronous.');
          Promise.resolve(returned).catch(() => {});
        }
      } catch {
        issue('handler_failed', 'The managed event handler failed.');
      } finally {
        collected = closeEventOperationScope(scope);
      }
      try {
        if (
          typeof returned?.type === 'string' &&
          returned.type.endsWith('_OPERATION') &&
          !collected.includes(returned)
        )
          collected.push(copy(returned));
      } catch {
        issue('invalid_operation', 'The returned event operation must contain portable data.');
      }
      for (const operation of collected) {
        const rejected = eventOperationIssue(operation, mode, eventType);
        if (rejected) {
          issue(rejected.code, rejected.message);
          if (
            rejected.code === 'readonly_operation_not_allowed' ||
            rejected.code === 'invalid_operation'
          )
            reportEventOperationIssue(manager.warningSystem, rejected, eventType);
        } else if (operation.type === 'EVENT_OPERATION') {
          registrations.push(operation);
        } else if (operation.operation === 'INVALID') {
          result.validationIssues.push({
            message: operation.params.message,
            instancePath: copy(instancePath),
          });
        } else if (operation?.type === 'FIELD_OPERATION' && operation.operation === 'SETVALUE') {
          const field = fields.get(operation.params?.fieldDataName);
          if (!field || !same(field.parentPath))
            issue(
              'write_scope_restricted',
              'SETVALUE() may only write fields owned by the executing scope.'
            );
          else {
            try {
              assertWritableField(field.field);
              result.operations.push(copy(operation));
            } catch (error) {
              issue('invalid_operation', error.message);
            }
          }
        } else {
          try {
            result.operations.push(copy(operation));
          } catch {
            issue('invalid_operation', 'Event operations must contain portable data.');
          }
        }
      }
    }
    // A failed managed dispatch is not a partially applicable operation batch.
    if (result.issues.length) result.operations = [];
    else manager.processEventOperations(registrations);
    return copy(result);
  };
}
