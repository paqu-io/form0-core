import { copyEventData as copy } from './event-data.js';
import { generateUuidV7 } from './uuid.js';

/** Normalize presentation independently of the evaluator and host UI. */
export function normalizeMessageBoxOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('MESSAGEBOX requires an options object.');
  if (options.buttons != null && !Array.isArray(options.buttons))
    throw new TypeError('MESSAGEBOX buttons must be an array.');
  const buttons = (options.buttons ?? ['OK']).map((button) => {
    if (typeof button === 'string') return { id: button, label: button };
    if (!button || typeof button.id !== 'string' || typeof button.label !== 'string')
      throw new TypeError('MESSAGEBOX buttons require string IDs and labels.');
    return { id: button.id, label: button.label };
  });
  if (
    !buttons.length ||
    buttons.some((b) => !b.id.trim() || !b.label.trim()) ||
    new Set(buttons.map((b) => b.id)).size !== buttons.length
  )
    throw new TypeError('MESSAGEBOX requires nonempty, unique buttons.');
  if (options.input != null && typeof options.input !== 'boolean')
    throw new TypeError('MESSAGEBOX input must be boolean.');
  if (
    options.context != null &&
    (typeof options.context !== 'object' || Array.isArray(options.context))
  )
    throw new TypeError('MESSAGEBOX context must be a portable object.');
  return {
    title: String(options.title ?? ''),
    message: String(options.message ?? ''),
    buttons,
    input: options.input === true,
    placeholder: String(options.placeholder ?? ''),
    context: copy(options.context ?? null),
  };
}

/** One-shot questions. Callbacks and context remain private to their owner. */
export function createUIRequestRegistry({ createId = generateUuidV7 } = {}) {
  const requests = new Map();
  return {
    create(options, continuation, isCurrent = () => true) {
      if (typeof continuation !== 'function')
        throw new TypeError('A UI response handler is required.');
      const normalized = normalizeMessageBoxOptions(options);
      const { context, ...presentation } = normalized;
      const requestId = createId();
      if (typeof requestId !== 'string' || !requestId || requests.has(requestId))
        throw new TypeError('UI request identities must be nonempty and unique.');
      requests.set(requestId, { normalized, continuation, isCurrent });
      return {
        type: 'UI_OPERATION',
        operation: 'MESSAGEBOX',
        params: { ...presentation, requestId },
      };
    },
    resolve(requestId, response) {
      const request = requests.get(requestId);
      if (!request || !request.isCurrent()) {
        requests.delete(requestId);
        throw new Error('This UI request has ended or is stale.');
      }
      if (!response || typeof response !== 'object' || Array.isArray(response))
        throw new TypeError('A UI response object is required.');
      const cancelled = response.cancelled === true;
      const value = response.value ?? response.buttonId;
      if (!cancelled && !request.normalized.buttons.some((b) => b.id === value))
        throw new TypeError('Choose one of the registered MESSAGEBOX buttons.');
      const input = cancelled || !request.normalized.input ? null : response.input;
      if (!cancelled && request.normalized.input && typeof input !== 'string')
        throw new TypeError('MESSAGEBOX input must be a string.');
      if (requests.get(requestId) !== request || !request.isCurrent())
        throw new Error('This UI request has ended or is stale.');
      requests.delete(requestId);
      return request.continuation({
        value: cancelled ? null : value,
        input,
        cancelled,
        context: copy(request.normalized.context),
      });
    },
    cancel(requestId) {
      requests.delete(requestId);
    },
    cancelAll() {
      requests.clear();
    },
    has(requestId) {
      const request = requests.get(requestId);
      return Boolean(request && request.isCurrent());
    },
  };
}
