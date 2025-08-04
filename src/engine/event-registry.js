/**
 * Registry of all supported event types and their scoping rules
 * This defines how field access works for each event category
 */

/**
 * Event registry with scoping rules
 * 
 * Categories:
 * - record: Events that operate at the record level (main form only)
 * - field: Events that operate at the field level (contextual scope)  
 * - repeatable: Events that operate at the RepeatableSection level (specific instance scope)
 *
 * Scopes:
 * - main: Can only access main form fields (not RepeatableSection fields)
 * - contextual: Can access main form fields + fields in same RepeatableSection context
 * - repeatable: Can access main form fields + fields in specific RepeatableSection instance
 */
export const EVENT_REGISTRY = {
  // Record-level events (main form fields only)
  'load-record': { category: 'record', scope: 'main' },
  'edit-record': { category: 'record', scope: 'main' },
  'new-record': { category: 'record', scope: 'main' },
  'save-record': { category: 'record', scope: 'main' },
  'validate-record': { category: 'record', scope: 'main' },
  
  // Field-level events (contextual scope)
  'change': { category: 'field', scope: 'contextual' },
  'blur': { category: 'field', scope: 'contextual' },
  'focus': { category: 'field', scope: 'contextual' },
  'click': { category: 'field', scope: 'contextual' },
  
  // RepeatableSection-level events (specific instance scope)
  'new-repeatable': { category: 'repeatable', scope: 'repeatable' },
  'load-repeatable': { category: 'repeatable', scope: 'repeatable' },
  'edit-repeatable': { category: 'repeatable', scope: 'repeatable' },
  'save-repeatable': { category: 'repeatable', scope: 'repeatable' },
  'validate-repeatable': { category: 'repeatable', scope: 'repeatable' }
};

/**
 * Get event information by event type
 * @param {string} eventType - The event type to look up
 * @returns {Object} Event info with category and scope, or default for unknown events
 */
export function getEventInfo(eventType) {
  return EVENT_REGISTRY[eventType] || { category: 'unknown', scope: 'main' };
}

/**
 * Check if an event type is registered
 * @param {string} eventType - The event type to check
 * @returns {boolean} True if the event type is registered
 */
export function isValidEventType(eventType) {
  return eventType in EVENT_REGISTRY;
}

/**
 * Get all event types for a specific category
 * @param {string} category - The event category ('record', 'field', 'repeatable')
 * @returns {string[]} Array of event types in the category
 */
export function getEventsByCategory(category) {
  return Object.keys(EVENT_REGISTRY).filter(
    eventType => EVENT_REGISTRY[eventType].category === category
  );
}

/**
 * Get all supported event types
 * @returns {string[]} Array of all registered event types
 */
export function getAllEventTypes() {
  return Object.keys(EVENT_REGISTRY);
}