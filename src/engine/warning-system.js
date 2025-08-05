/**
 * Centralized warning system for field access violations
 * Supports both development debugging and future commercial app integration
 */

export class WarningSystem {
  constructor(options = {}) {
    // Determine if we're in development mode
    this.isDevelopment = options.isDevelopment ?? this.detectDevelopmentMode();
    
    // Console warnings enabled by default in development
    this.enableConsoleWarnings = options.enableConsoleWarnings ?? this.isDevelopment;
    
    // Custom warning handlers (for future "reform" integration)
    this.warningHandlers = new Set();
    
    // Warning throttling to prevent spam
    this.recentWarnings = new Map();
    this.throttleMs = options.throttleMs ?? 1000; // 1 second throttling
    
    // Collected warnings for external access (e.g., form0-cli)
    this.collectedWarnings = [];
    this.enableCollection = options.enableCollection ?? false;
  }
  
  /**
   * Detect if we're in development mode
   * @returns {boolean} True if in development mode
   */
  detectDevelopmentMode() {
    // Node.js environment
    if (typeof process !== 'undefined' && process.env) {
      return process.env.NODE_ENV !== 'production';
    }
    
    // Browser environment - assume development if not explicitly production
    if (typeof window !== 'undefined') {
      // Check for common development indicators
      return window.location.hostname === 'localhost' || 
             window.location.hostname === '127.0.0.1' ||
             window.location.port !== '';
    }
    
    // Default to development mode for safety
    return true;
  }
  
  /**
   * Register custom warning handler (for future "reform" integration)
   * @param {Function} handler - Warning handler function
   */
  addWarningHandler(handler) {
    if (typeof handler === 'function') {
      this.warningHandlers.add(handler);
    } else {
      console.warn('[form0] Warning handler must be a function');
    }
  }
  
  /**
   * Remove custom warning handler
   * @param {Function} handler - Warning handler function to remove
   */
  removeWarningHandler(handler) {
    this.warningHandlers.delete(handler);
  }
  
  /**
   * Clear all custom warning handlers
   */
  clearWarningHandlers() {
    this.warningHandlers.clear();
  }
  
  /**
   * Check if warning should be throttled
   * @param {Object} warning - Warning object
   * @returns {boolean} True if warning should be suppressed
   */
  shouldThrottleWarning(warning) {
    // Use a simpler key that focuses on the core warning identity
    // Don't include executionContext as it may contain timestamps or other changing data
    const warningKey = `${warning.type}:${warning.fieldName}:${warning.message}:${warning.reason || ''}`;
    const now = Date.now();
    const lastEmitted = this.recentWarnings.get(warningKey);
    
    if (lastEmitted && (now - lastEmitted) < this.throttleMs) {
      return true; // Throttle this warning
    }
    
    // Update last emitted time
    this.recentWarnings.set(warningKey, now);
    
    // Clean up old entries to prevent memory leaks
    if (this.recentWarnings.size > 100) {
      this.cleanupOldWarnings(now);
    }
    
    return false;
  }
  
  /**
   * Clean up old warning entries to prevent memory leaks
   * @param {number} now - Current timestamp
   */
  cleanupOldWarnings(now) {
    for (const [key, timestamp] of this.recentWarnings.entries()) {
      if ((now - timestamp) > (this.throttleMs * 10)) { // Keep for 10x throttle time
        this.recentWarnings.delete(key);
      }
    }
  }
  
  /**
   * Emit warning to all registered handlers
   * @param {Object} warning - Warning object with structured information
   */
  emitWarning(warning) {
    // Throttle warnings to prevent spam
    if (this.shouldThrottleWarning(warning)) {
      return;
    }
    
    // Collect warning if collection is enabled
    if (this.enableCollection) {
      this.collectedWarnings.push({
        message: warning.message,
        suggestion: warning.suggestion,
        context: warning.executionContext,
        fieldContext: warning.fieldContext,
        timestamp: Date.now()
      });
    }
    
    // Console logging for development
    if (this.enableConsoleWarnings) {
      this.logWarningToConsole(warning);
    }
    
    // Custom handlers (for "reform" and other integrations)
    this.notifyCustomHandlers(warning);
  }
  
  /**
   * Log warning to console with formatted output
   * @param {Object} warning - Warning object
   */
  logWarningToConsole(warning) {
    const contextInfo = this.formatExecutionContext(warning.executionContext);
    
    console.warn(`[form0] ${warning.message}`);
    
    if (contextInfo) {
      console.warn(`[form0] Context: ${contextInfo}`);
    }
    
    if (warning.suggestion) {
      console.info(`[form0] Suggestion: ${warning.suggestion}`);
    }
    
    // Additional debug information in development
    if (this.isDevelopment && warning.fieldContext) {
      console.info('[form0] Field context:', warning.fieldContext);
    }
  }
  
  /**
   * Format execution context for human-readable display
   * @param {Object} executionContext - Execution context object
   * @returns {string} Formatted context string
   */
  formatExecutionContext(executionContext) {
    const { type, eventType, fieldName } = executionContext;
    
    if (type === 'calculation') {
      return `CalculatedField '${fieldName}'`;
    }
    
    if (type === 'event') {
      if (fieldName) {
        return `Event '${eventType}' on field '${fieldName}'`;
      } else {
        return `Event '${eventType}'`;
      }
    }
    
    return `${type} context`;
  }
  
  /**
   * Notify all custom warning handlers
   * @param {Object} warning - Warning object
   */
  notifyCustomHandlers(warning) {
    for (const handler of this.warningHandlers) {
      try {
        handler(warning);
      } catch (err) {
        console.error('[form0] Warning handler failed:', err);
        // Don't remove the handler automatically - let the user decide
      }
    }
  }
  
  /**
   * Set console warning state
   * @param {boolean} enabled - Whether to enable console warnings
   */
  setConsoleWarnings(enabled) {
    this.enableConsoleWarnings = enabled;
  }
  
  /**
   * Get current warning system stats (for debugging)
   * @returns {Object} Stats object
   */
  getStats() {
    return {
      isDevelopment: this.isDevelopment,
      enableConsoleWarnings: this.enableConsoleWarnings,
      customHandlerCount: this.warningHandlers.size,
      recentWarningCount: this.recentWarnings.size,
      throttleMs: this.throttleMs,
      collectedWarningCount: this.collectedWarnings.length
    };
  }
  
  /**
   * Get collected warnings (for external access like form0-cli)
   * @returns {Array} Array of collected warning objects
   */
  getCollectedWarnings() {
    return [...this.collectedWarnings]; // Return a copy to prevent external modification
  }
  
  /**
   * Clear collected warnings
   */
  clearCollectedWarnings() {
    this.collectedWarnings = [];
  }
  
  /**
   * Enable or disable warning collection
   * @param {boolean} enabled - Whether to enable warning collection
   */
  setCollectionEnabled(enabled) {
    this.enableCollection = enabled;
    if (!enabled) {
      this.clearCollectedWarnings();
    }
  }
}