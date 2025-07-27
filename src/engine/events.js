import { runExpression } from './evaluator.js';
import { __consumeEventOperations } from '../builtins/registry.js';

// Global registry to track logged event handlers (development only)
const _loggedHandlers = new Set();

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
    operations.forEach(operation => {
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
    // Create a context that includes the event object and current form state
    const contextWithEvent = {
      ...this.eventContext,
      event: event
    };
    
    // Execute the callback function with the current context
    // This ensures EVAL() and other builtins have access to field values
    const functionCall = `(${callback.toString()})(event)`;
    return runExpression(functionCall, contextWithEvent, this.securityConfig, true);
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
        // Execute the callback with current form context
        // This ensures EVAL() and other builtins have access to field values
        const result = this.executeHandlerWithContext(callback, event);
        
        // Consume any collected event operations
        const collectedOps = __consumeEventOperations();
        operations.push(...collectedOps);
        
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
} 