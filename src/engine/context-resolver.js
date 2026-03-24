/**
 * Context-aware field resolution for calculations and events
 * Determines which fields are accessible based on execution context
 * Reuses tree-building logic from record-transformer.js
 */

import { getEventInfo } from './event-registry.js';

export class ContextResolver {
  constructor(schema) {
    // Maps to store field context information (similar to record-transformer.js)
    this.fieldOwnership = new Map(); // Field data_name -> { preferredKey, field, parentPath }
    this.repeatableSectionTree = new Map(); // RepeatableSection data_name -> tree info
    this.sectionFields = new Set(); // Section field names (organizational only)

    // Build field context from schema
    this.buildFieldContext(schema.elements || []);
  }

  /**
   * Build field context tree (adapted from record-transformer.js buildRepeatableSectionTree)
   * @param {Array} elements - Form schema elements
   * @param {Array} parentPath - Current RepeatableSection ancestry path
   */
  buildFieldContext(elements, parentPath = []) {
    if (!Array.isArray(elements)) return;

    elements.forEach((element) => {
      if (element.type === 'Section' || element.type === 'BuildingPlanSection') {
        this.sectionFields.add(element.data_name);
        // Recursively process Section children with same parentPath
        // (Sections don't change the RepeatableSection parentage)
        if (Array.isArray(element.elements)) {
          this.buildFieldContext(element.elements, parentPath);
        }
      } else if (element.type === 'RepeatableSection') {
        const preferredKey =
          element.key && element.key.trim() !== '' ? element.key : element.data_name;
        const currentPath = [...parentPath, preferredKey];

        // Store this RepeatableSection in the tree
        this.repeatableSectionTree.set(element.data_name, {
          preferredKey,
          field: element,
          parentPath: [...parentPath], // Copy to avoid reference issues
          currentPath: [...currentPath], // Copy to avoid reference issues
          children: new Map(), // Will store child RepeatableSections
          fields: new Map(), // Will store direct child fields
        });

        // Recursively process RepeatableSection children with updated path
        if (Array.isArray(element.elements)) {
          this.buildFieldContext(element.elements, currentPath);
        }
      } else {
        // This is a regular field - determine its ownership
        const preferredFieldKey =
          element.key && element.key.trim() !== '' ? element.key : element.data_name;
        this.fieldOwnership.set(element.data_name, {
          preferredKey: preferredFieldKey,
          field: element,
          parentPath: [...parentPath], // Copy the current path
        });
      }
    });
  }

  /**
   * Resolve field access with structured metadata for editor integrations.
   * @param {Object} executionContext - Current execution context
   * @param {string} fieldName - Field data_name being accessed
   * @param {Object | null} [providedFieldInfo]
   * @returns {{
   *   level: 'accessible' | 'restricted' | 'not_found',
   *   code: 'main_form' | 'same_repeatable_section' | 'ancestor_repeatable_context' | 'different_repeatable_section' | null,
   *   message: string | null,
   *   suggestion: string | null,
   *   fieldInfo: Object | null,
   * }}
   */
  resolveFieldAccessInfo(executionContext, fieldName, providedFieldInfo = null) {
    const fieldInfo = providedFieldInfo || this.fieldOwnership.get(fieldName) || null;

    if (!fieldInfo) {
      return {
        level: 'not_found',
        code: null,
        message: `Field '${fieldName}' does not exist in the form schema`,
        suggestion: `Check that field '${fieldName}' exists in the form schema`,
        fieldInfo: null,
      };
    }

    // Main form fields (no parent RepeatableSection) are always accessible
    if (fieldInfo.parentPath.length === 0) {
      return this.buildAccessInfo('accessible', 'main_form', fieldName, fieldInfo, executionContext);
    }

    // RepeatableSection field access depends on execution context
    return this.checkRepeatableSectionAccessInfo(executionContext, fieldName, fieldInfo);
  }

  /**
   * Determine if a field is accessible from the current execution context
   * @param {Object} executionContext - Current execution context
   * @param {string} fieldName - Field data_name being accessed
   * @returns {string} 'accessible', 'restricted', or 'not_found'
   */
  resolveFieldAccess(executionContext, fieldName) {
    return this.resolveFieldAccessInfo(executionContext, fieldName).level;
  }

  /**
   * Check RepeatableSection field access based on context
   * @param {Object} executionContext - Current execution context
   * @param {Object} fieldInfo - Field ownership information
   * @returns {string} 'accessible' or 'restricted'
   */
  checkRepeatableSectionAccess(executionContext, fieldInfo) {
    return this.checkRepeatableSectionAccessInfo(
      executionContext,
      fieldInfo.field?.data_name || fieldInfo.preferredKey,
      fieldInfo
    ).level;
  }

  /**
   * Check RepeatableSection field access and return structured access metadata.
   * @param {Object} executionContext - Current execution context
   * @param {string} fieldName - Field data_name being accessed
   * @param {Object} fieldInfo - Field ownership information
   * @returns {{
   *   level: 'accessible' | 'restricted' | 'not_found',
   *   code: 'main_form' | 'same_repeatable_section' | 'ancestor_repeatable_context' | 'different_repeatable_section' | null,
   *   message: string | null,
   *   suggestion: string | null,
   *   fieldInfo: Object | null,
   * }}
   */
  checkRepeatableSectionAccessInfo(executionContext, fieldName, fieldInfo) {
    const { type: contextType, eventType, fieldName: contextFieldName } = executionContext;

    if (contextType === 'calculation') {
      // CalculatedField can only access fields in same RepeatableSection context
      const calculationFieldInfo = this.fieldOwnership.get(contextFieldName);
      if (!calculationFieldInfo) {
        return this.buildAccessInfo(
          'restricted',
          'different_repeatable_section',
          fieldName,
          fieldInfo,
          executionContext
        );
      }

      return this.resolveRepeatableSectionRelationship(
        calculationFieldInfo.parentPath,
        fieldInfo.parentPath,
        fieldName,
        fieldInfo,
        executionContext
      );
    }

    if (contextType === 'event') {
      const eventInfo = getEventInfo(eventType);

      switch (eventInfo.scope) {
        case 'main':
          // Record events can't access RepeatableSection fields
          return this.buildAccessInfo(
            'restricted',
            'different_repeatable_section',
            fieldName,
            fieldInfo,
            executionContext
          );

        case 'contextual':
          // Field events can access fields in same RepeatableSection context
          if (!contextFieldName) {
            return this.buildAccessInfo(
              'restricted',
              'different_repeatable_section',
              fieldName,
              fieldInfo,
              executionContext
            );
          }

          const triggerFieldInfo = this.fieldOwnership.get(contextFieldName);
          if (!triggerFieldInfo) {
            return this.buildAccessInfo(
              'restricted',
              'different_repeatable_section',
              fieldName,
              fieldInfo,
              executionContext
            );
          }

          return this.resolveRepeatableSectionRelationship(
            triggerFieldInfo.parentPath,
            fieldInfo.parentPath,
            fieldName,
            fieldInfo,
            executionContext
          );

        case 'repeatable':
          // RepeatableSection events - future implementation
          // For now, assume accessible (will be refined when implemented)
          return this.buildAccessInfo(
            'accessible',
            'same_repeatable_section',
            fieldName,
            fieldInfo,
            executionContext
          );

        default:
          return this.buildAccessInfo(
            'restricted',
            'different_repeatable_section',
            fieldName,
            fieldInfo,
            executionContext
          );
      }
    }

    // Unknown context type
    return this.buildAccessInfo(
      'restricted',
      'different_repeatable_section',
      fieldName,
      fieldInfo,
      executionContext
    );
  }

  /**
   * Check if two fields have the same RepeatableSection context
   * @param {Array} parentPath1 - First field's parent path
   * @param {Array} parentPath2 - Second field's parent path
   * @returns {boolean} True if they share the same RepeatableSection context
   */
  haveSameRepeatableSectionContext(parentPath1, parentPath2) {
    return this.resolveRepeatableSectionAccessCode(parentPath1, parentPath2) !== 'different_repeatable_section';
  }

  resolveRepeatableSectionRelationship(
    contextPath,
    targetPath,
    fieldName,
    fieldInfo,
    executionContext
  ) {
    const code = this.resolveRepeatableSectionAccessCode(contextPath, targetPath);
    const level = code === 'different_repeatable_section' ? 'restricted' : 'accessible';

    return this.buildAccessInfo(level, code, fieldName, fieldInfo, executionContext);
  }

  resolveRepeatableSectionAccessCode(contextPath, targetPath) {
    if (targetPath.length === 0) {
      return 'main_form';
    }

    if (ContextResolver.pathsEqual(contextPath, targetPath)) {
      return contextPath.length === 0 ? 'main_form' : 'same_repeatable_section';
    }

    if (targetPath.length < contextPath.length && ContextResolver.isPrefix(targetPath, contextPath)) {
      return targetPath.length === 0 ? 'main_form' : 'ancestor_repeatable_context';
    }

    return 'different_repeatable_section';
  }

  buildAccessInfo(level, code, fieldName, fieldInfo, executionContext) {
    if (level === 'accessible') {
      return {
        level,
        code,
        message: null,
        suggestion: null,
        fieldInfo,
      };
    }

    return {
      level,
      code,
      message: `Field '${fieldName}' is not accessible from current context`,
      suggestion: this.buildRestrictedAccessSuggestion(executionContext, fieldName, fieldInfo, code),
      fieldInfo,
    };
  }

  buildRestrictedAccessSuggestion(executionContext, fieldName, fieldInfo, code) {
    const { type: contextType, eventType } = executionContext;

    if (contextType === 'calculation') {
      if (code === 'different_repeatable_section') {
        return `CalculatedField can only access fields in the same RepeatableSection or ancestor contexts. Field '${fieldName}' is in RepeatableSection: ${fieldInfo.parentPath.join(' -> ')}`;
      }
    }

    if (contextType === 'event') {
      const eventInfo = getEventInfo(eventType);

      if (eventInfo.scope === 'main') {
        return `Record-level events (like '${eventType}') can only access main form fields, not RepeatableSection fields`;
      }

      if (eventInfo.scope === 'contextual') {
        return `Field events can only access fields in the same RepeatableSection or ancestor contexts as the triggering field`;
      }
    }

    return 'Check the field access rules for your current context';
  }

  static isPrefix(prefix, fullPath) {
    if (prefix.length === 0) {
      return true;
    }

    if (prefix.length > fullPath.length) {
      return false;
    }

    for (let i = 0; i < prefix.length; i++) {
      if (prefix[i] !== fullPath[i]) {
        return false;
      }
    }

    return true;
  }

  static pathsEqual(pathA, pathB) {
    if (pathA.length !== pathB.length) {
      return false;
    }

    for (let i = 0; i < pathA.length; i++) {
      if (pathA[i] !== pathB[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Generate contextual warning message for restricted field access
   * Important for development and future "reform" commercial app
   * @param {Object} executionContext - Current execution context
   * @param {string} fieldName - Field being accessed
   * @param {string} reason - Reason for restriction
   * @returns {Object} Warning object with structured information
   */
  generateAccessWarning(executionContext, fieldName, reason) {
    const accessInfo =
      reason === 'not_found'
        ? this.resolveFieldAccessInfo(executionContext, fieldName)
        : this.resolveFieldAccessInfo(executionContext, fieldName);
    const fieldInfo = accessInfo.fieldInfo;

    return {
      type: 'FIELD_ACCESS_WARNING',
      fieldName,
      executionContext,
      reason,
      accessCode: accessInfo.code,
      message:
        accessInfo.message ||
        (reason === 'not_found'
          ? `Field '${fieldName}' does not exist in the form schema`
          : `Field '${fieldName}' is not accessible from current context`),
      suggestion:
        accessInfo.suggestion || this.generateAccessSuggestion(executionContext, fieldName, fieldInfo),
      fieldContext: fieldInfo
        ? {
            parentPath: fieldInfo.parentPath,
            isMainForm: fieldInfo.parentPath.length === 0,
            isInRepeatableSection: fieldInfo.parentPath.length > 0,
          }
        : null,
    };
  }

  /**
   * Generate helpful suggestion for field access issues
   * @param {Object} executionContext - Current execution context
   * @param {string} fieldName - Field being accessed
   * @param {Object} fieldInfo - Field ownership information
   * @returns {string} Helpful suggestion message
   */
  generateAccessSuggestion(executionContext, fieldName, fieldInfo) {
    const accessInfo = this.resolveFieldAccessInfo(executionContext, fieldName, fieldInfo);

    if (accessInfo.suggestion) {
      return accessInfo.suggestion;
    }

    if (accessInfo.level === 'not_found') {
      return `Check that field '${fieldName}' exists in the form schema`;
    }

    if (accessInfo.code === 'main_form') {
      return 'Main form fields are always accessible from calculations';
    }

    if (accessInfo.code === 'same_repeatable_section') {
      return 'Fields in the same RepeatableSection are accessible from this context';
    }

    if (accessInfo.code === 'ancestor_repeatable_context') {
      return 'Fields in ancestor RepeatableSection contexts are accessible from this context';
    }

    return 'Check the field access rules for your current context';
  }

  /**
   * Get field information for debugging
   * @param {string} fieldName - Field data_name
   * @returns {Object|null} Field ownership information
   */
  getFieldInfo(fieldName) {
    return this.fieldOwnership.get(fieldName) || null;
  }

  /**
   * Get all main form fields (no RepeatableSection parent)
   * @returns {string[]} Array of main form field names
   */
  getMainFormFields() {
    const mainFields = [];
    for (const [fieldName, fieldInfo] of this.fieldOwnership) {
      if (fieldInfo.parentPath.length === 0) {
        mainFields.push(fieldName);
      }
    }
    return mainFields;
  }

  /**
   * Get all RepeatableSection fields
   * @returns {string[]} Array of RepeatableSection field names
   */
  getRepeatableSectionFields() {
    const repeatableFields = [];
    for (const [fieldName, fieldInfo] of this.fieldOwnership) {
      if (fieldInfo.parentPath.length > 0) {
        repeatableFields.push(fieldName);
      }
    }
    return repeatableFields;
  }
}
