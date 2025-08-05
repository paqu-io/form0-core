/**
 * Version utilities for form0
 * Handles both record versions (simple integers) and form versions (environment-aware strings)
 */

/**
 * Record version utilities (simple integers for end users)
 */
export const recordVersion = {
  /**
   * Increment record version
   * @param {number} currentVersion 
   * @returns {number}
   */
  increment: (currentVersion = 0) => currentVersion + 1,
  
  /**
   * Validate record version
   * @param {*} version 
   * @returns {boolean}
   */
  isValid: (version) => Number.isInteger(version) && version > 0,
  
  /**
   * Compare two record versions
   * @param {number} v1 
   * @param {number} v2 
   * @returns {number} -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  compare: (v1, v2) => {
    if (v1 < v2) return -1;
    if (v1 > v2) return 1;
    return 0;
  }
};

/**
 * Form schema version utilities (environment-aware strings for developers)
 */
export const formVersion = {
  /**
   * Parse form version string
   * @param {string} version - e.g., "2-dev1704123456" or "1.1.1-dev1704123456"
   * @returns {Object|null} - {base: string, environment: string|null, isProduction: boolean}
   */
  parse: (version) => {
    if (typeof version !== 'string') return null;
    
    // Handle both simple ("2-dev123") and semantic ("1.1.1-dev123") formats
    const match = version.match(/^(\d+(?:\.\d+\.\d+)?)(-.+)?$/);
    if (!match) return null;
    
    return {
      base: match[1],
      environment: match[2] || null,
      isProduction: !match[2]
    };
  },
  
  /**
   * Generate development version
   * @param {string} baseVersion - e.g., "2" or "1.1.1"
   * @param {number} timestamp - Optional timestamp, defaults to current time
   * @returns {string} - e.g., "2-dev1704123456"
   */
  createDev: (baseVersion, timestamp = Date.now()) => 
    `${baseVersion}-dev${Math.floor(timestamp / 1000)}`,
    
  /**
   * Strip environment suffix for production
   * @param {string} version - e.g., "2-dev1704123456"
   * @returns {string} - e.g., "2"
   */
  toProduction: (version) => {
    const parsed = formVersion.parse(version);
    return parsed ? parsed.base : version;
  },
  
  /**
   * Check if version is a development version
   * @param {string} version 
   * @returns {boolean}
   */
  isDevelopment: (version) => {
    const parsed = formVersion.parse(version);
    return parsed ? !parsed.isProduction : false;
  },
  
  /**
   * Validate form version format
   * @param {*} version 
   * @returns {boolean}
   */
  isValid: (version) => {
    return formVersion.parse(version) !== null;
  }
};