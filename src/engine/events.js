import { runExpression } from '../evaluator.js';
import { __consumeEventOperations } from '../helpers/builtins.js';

/**
 * EventManager handles form event registration and execution
 */
export class EventManager {
  constructor() {
    this.listeners = new Map(); // eventType -> Map<fieldKey, callback[]>
    this.eventContext = null;
    this.securityConfig = null;
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
    // Create enhanced context with ON() builtin
    const enhancedContext = {
      ...context,
      ON: this.createOnBuiltin(),
    };
    
    // Execute the code to register event listeners (same security as calculated fields)
    runExpression(code, enhancedContext, this.securityConfig, true);
  }
  
  /**
   * Create the ON() builtin function
   * @returns {Function} The ON builtin function
   */
  createOnBuiltin() {
    return (eventType, fieldKeyOrCallback, callback) => {
      // Handle both: ON('load-record', func) and ON('change', 'field', func)
      if (typeof fieldKeyOrCallback === 'function') {
        this.registerListener(eventType, '*', fieldKeyOrCallback);
      } else {
        this.registerListener(eventType, fieldKeyOrCallback, callback);
      }
    };
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
      ...eventMetadata
    };
    
    // Execute specific field listeners
    const fieldListeners = eventMap.get(fieldKey) || [];
    const wildcardListeners = eventMap.get('*') || [];
    
    [...fieldListeners, ...wildcardListeners].forEach(callback => {
      try {
        // Execute the callback
        const result = callback(event);
        
        // Consume any collected event operations
        const collectedOps = __consumeEventOperations();
        operations.push(...collectedOps);
        
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
} 