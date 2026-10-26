import { evaluateCalculatedFields } from './calculation.js';
import { evaluateVisibility } from './conditions.js';
import { evaluateRequirement } from './conditions.js';
import { evaluateReadOnly } from './conditions.js';
import { validateFields } from './field-validation.js';
import { calculationBuiltins, eventBuiltins } from '../builtins/registry.js';
import { validateSchemaWithContext } from '../schema/schema-validator.js';
import { createConditionContext } from './condition-context.js';
import { flattenFields } from '../utilities/field-helpers.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/config.js';
import { EventManager } from './events.js';
import { FIELD_SPECS } from '../schema/field-specs.js';
import { ContextResolver } from './context-resolver.js';
import { WarningSystem } from './warning-system.js';
import { expandBuildingPlanSchema } from '../schema/building-plan-expander.js';
import { buildCalculationDependencyPlan } from '../utilities/calculation-dependencies.js';
import { createCalculationDiagnostics } from './calculation-diagnostics.js';
import { formatLocalDate } from '../utilities/date-utils.js';
import { createManagedEventDispatcher } from './managed-events.js';
import { validateInteractionMode } from './event-policy.js';
import { copyRecordData } from '../utilities/record-data.js';
import { areStructuredValuesEqual } from '../utilities/value-equality.js';

/**
 * @typedef {Object} CalculationDiagnostic
 * @property {string} code Stable diagnostic identifier.
 * @property {'warning'|'error'} severity
 * @property {string} message
 * @property {string} fieldName Calculated field's data_name.
 * @property {'dependency'|'scope'|'validation'|'syntax'|'runtime'} phase
 * @property {string|null} suggestion
 * @property {Object} context JSON-safe metadata; no expression source, values or stack.
 */

/**
 * @typedef {Object} ManagedValidationIssue
 * @property {string} message Scope-level message, without an invented field association.
 * @property {Object[]} instancePath Complete engine-owned row ancestry; [] for root.
 *
 * @typedef {Object} ManagedEventIssue
 * @property {string} code Stable execution failure identifier.
 * @property {string} message
 * @property {string|null} eventType Null for a malformed event-type argument.
 * @property {Object[]} instancePath
 *
 * @typedef {Object} ManagedEventResult
 * @property {Object[]} operations Defensive accepted operation batch; [] on execution failure.
 * @property {ManagedValidationIssue[]} validationIssues Fresh findings for this attempt.
 * @property {ManagedEventIssue[]} issues Execution failures, separate from validation findings.
 */

/**
 * Create a form engine. Calculations collect diagnostics independently of validation.
 * @param {Object} options
 * @param {Object} options.schema
 * @param {Object} [options.initialValues]
 * @param {Object} [options.helpers]
 * @param {Object} [options.security]
 * @param {'edit'|'readonly'} [options.mode='edit'] View preserves supplied calculations/defaults.
 * @param {WarningSystem} [options.warningSystem]
 * @param {Array} [options.runtimeDiagnostics] Deprecated append-only compatibility adapter.
 * Use getDiagnostics() for the latest snapshot or onDiagnostics for evaluation notifications.
 * @param {{console?: boolean}} [options.diagnostics] Omit console to preserve legacy reporting.
 * @param {(snapshot: CalculationDiagnostic[]) => (void|Promise<void>)} [options.onDiagnostics]
 * Called once per completed evaluation, including empty/identical snapshots. Failures are isolated.
 * @param {{scopeId?: string, instancePath: Array<{repeatableKey: string, instanceId: string|number|null, index: number, identity: 'id'|'position'}>}} [options.eventScope]
 * Managed event ownership, fixed for this engine lifetime. Root is []; headless row engines must
 * provide the complete repeatable path. triggerDetailed() never evaluates or applies operations.
 * @returns {Object} Engine with getDiagnostics(): defensive copy of latest evaluation (initially []).
 */

export function createFormEngine({
  schema,
  initialValues = {},
  helpers = {},
  security = DEFAULT_SECURITY_CONFIG,
  warningSystem = null,
  runtimeDiagnostics = null,
  diagnostics = {},
  onDiagnostics = null,
  eventScope = { instancePath: [] },
  mode = 'edit',
}) {
  let interactionMode = validateInteractionMode(mode);
  const { schema: preparedSchema, buildingPlanMeta } = expandBuildingPlanSchema(schema);

  const contextResolver = new ContextResolver(preparedSchema.form);
  validateSchemaWithContext(preparedSchema.form, contextResolver);

  const { form } = preparedSchema;
  const values = copyRecordData(initialValues);
  const allFields = flattenFields(form.elements);
  const pendingDefaults = new Map();

  // Create a lookup map for choice fields
  const choiceFieldMap = new Map();
  for (const field of allFields) {
    if (
      field.type === 'SingleChoiceField' ||
      field.type === 'MultiChoiceField' ||
      field.type === 'BooleanField'
    ) {
      const valueToLabelMap = new Map();
      field.choices.forEach((choice) => {
        valueToLabelMap.set(choice.value, choice.label);
      });
      choiceFieldMap.set(field.data_name, valueToLabelMap);
    }
  }

  for (const field of allFields) {
    if (!(field.data_name in values)) {
      // Initialize field with default value if specified
      values[field.data_name] = getDefaultValue(
        interactionMode === 'readonly' ? { ...field, default_value: null } : field
      );
      if (interactionMode === 'readonly')
        pendingDefaults.set(field, copyRecordData(values[field.data_name]));
    } else if (field.type === 'SingleChoiceField' || field.type === 'BooleanField') {
      // Enrich SingleChoiceField and BooleanField values with labels from schema
      const fieldValue = values[field.data_name];
      if (fieldValue && typeof fieldValue === 'object' && Array.isArray(fieldValue.choice)) {
        const labelMap = choiceFieldMap.get(field.data_name);
        fieldValue.choice = fieldValue.choice.map((choice) => {
          if (choice && choice.value && !choice.label) {
            // Auto-populate label from schema
            const label = labelMap.get(choice.value);
            return {
              ...choice,
              label: label || choice.value, // fallback to value if label not found
            };
          }
          return choice;
        });
      }
    } else if (field.type === 'MultiChoiceField') {
      // Enrich MultiChoiceField values with labels from schema
      const fieldValue = values[field.data_name];
      if (fieldValue && typeof fieldValue === 'object' && Array.isArray(fieldValue.choices)) {
        const labelMap = choiceFieldMap.get(field.data_name);
        fieldValue.choices = fieldValue.choices.map((choice) => {
          if (choice && choice.value && !choice.label) {
            // Auto-populate label from schema
            const label = labelMap.get(choice.value);
            return {
              ...choice,
              label: label || choice.value, // fallback to value if label not found
            };
          }
          return choice;
        });
      }
    }
  }
  const errors = {};
  const visible = {};
  const required = {};
  const read_only = {};

  const allHelpers = { ...calculationBuiltins, ...helpers };

  // Initialize context resolution system
  const calculationPlan = buildCalculationDependencyPlan(form, contextResolver);
  const sharedWarningSystem = warningSystem || new WarningSystem();
  const conditionContext = createConditionContext(form, contextResolver, sharedWarningSystem);
  const calculationDiagnostics = createCalculationDiagnostics(
    diagnostics,
    onDiagnostics,
    contextResolver,
    sharedWarningSystem
  );

  // Initialize event system with context resolution
  const eventManager = new EventManager(form, contextResolver, sharedWarningSystem);
  eventManager.securityConfig = security; // Pass security config
  const eventHelpers = { ...eventBuiltins, ...helpers };
  const getMode = () => interactionMode;
  const dispatchManagedEvent = createManagedEventDispatcher(eventManager, eventScope, getMode);

  // Initialize event code if present
  if (form.events && form.events.code) {
    const eventContext = buildEventContext(
      interactionMode === 'readonly' ? copyRecordData(values) : values,
      eventHelpers,
      {}
    );
    eventManager.initializeEventCode(form.events.code, eventContext);
  }

  function buildEventContext(values, helpers, eventMeta) {
    const ctx = {};

    // Add field values with $ prefix
    for (const key in values) {
      ctx[`$${key}`] = values[key];
    }

    // Add helpers and event-specific builtins
    // TODO: Add form/record metadata builtins (THIS, ALTITUDE, etc.)
    return { ...ctx, ...helpers };
  }

  function evalForm() {
    const frame = calculationDiagnostics.begin();
    try {
      if (interactionMode === 'edit')
        evaluateCalculatedFields(
          form,
          values,
          allHelpers,
          security,
          contextResolver,
          sharedWarningSystem,
          runtimeDiagnostics,
          calculationPlan,
          calculationDiagnostics
        );
      evaluateRequirement(form, values, required, conditionContext);
      evaluateVisibility(form, values, visible, conditionContext);
      evaluateReadOnly(form, values, read_only, conditionContext);
      validateFields(form, values, errors);
    } catch (error) {
      calculationDiagnostics.abort(frame);
      throw error;
    }
    calculationDiagnostics.complete(frame);
  }

  function trigger(eventType, fieldKey, metadata = {}) {
    // Update event context with current values for event execution
    const eventContext = buildEventContext(
      interactionMode === 'readonly' ? copyRecordData(values) : values,
      eventHelpers,
      {
        eventType,
        fieldKey,
        ...metadata,
      }
    );
    eventManager.eventContext = eventContext; // Update the event context
    return eventManager.trigger(eventType, fieldKey, metadata, interactionMode);
  }

  function getState() {
    return { values, errors, visible, required, read_only };
  }

  /** Host-owned mode changes do not replay events, restore a record or evaluate implicitly. */
  function setMode(nextMode) {
    interactionMode = validateInteractionMode(nextMode);
    if (interactionMode === 'edit') {
      for (const [field, placeholder] of pendingDefaults) {
        if (areStructuredValuesEqual(values[field.data_name], placeholder))
          values[field.data_name] = copyRecordData(getDefaultValue(field));
      }
      pendingDefaults.clear();
    }
  }

  /**
   * Dispatch synchronously within this engine's construction scope. No operations are applied.
   * @param {string} eventType Registered event name.
   * @param {string} [fieldKey] Field/repeatable data_name; omitted for record lifecycle events.
   * @param {Object} [metadata] Portable host metadata; dispatcher-owned identity is authoritative.
   * @returns {ManagedEventResult}
   */
  function triggerDetailed(eventType, fieldKey, metadata = {}) {
    eventManager.eventContext = buildEventContext(values, eventHelpers, {});
    return dispatchManagedEvent(eventType, fieldKey, metadata);
  }

  return {
    eval: evalForm,
    getMode,
    setMode,
    trigger,
    triggerDetailed,
    getState,
    getDiagnostics: calculationDiagnostics.getSnapshot,
    getWarningSystem: () => sharedWarningSystem,
    getContextResolver: () => contextResolver,
    getBuildingPlanMeta: () => buildingPlanMeta,
    getPreparedSchema: () => preparedSchema,
  };
}

export function getDefaultValue(field) {
  const spec = FIELD_SPECS[field.type];
  if (spec && spec.defaultProducer) {
    return spec.defaultProducer(field);
  }

  // Fallback to existing logic for safety
  return getDefaultValueLegacy(field);
}

function getDefaultValueLegacy(field) {
  if (field.default_value === null || field.default_value === undefined) {
    // Return appropriate default structure for each field type
    switch (field.type) {
      case 'SingleChoiceField':
      case 'BooleanField':
        return { choice: [], other: [] };
      case 'MultiChoiceField':
        return { choices: [], other: [] };
      case 'CalculatedField':
        return null; // Calculated fields don't have user input
      default:
        return null;
    }
  }

  switch (field.type) {
    case 'TextField':
      return field.default_value;

    case 'NumericField':
      return field.default_value;

    case 'SingleChoiceField':
    case 'BooleanField':
      // For SingleChoiceField and BooleanField, we need to find the choice and create the proper structure
      const choice = field.choices.find((c) => c.value === field.default_value);
      if (choice) {
        return {
          choice: [{ value: choice.value, label: choice.label }],
          other: [],
        };
      }
      return { choice: [], other: [] };

    case 'MultiChoiceField':
      // For MultiChoiceField, we need to find all choices and create the proper structure
      const selectedChoices = field.choices
        .filter((c) => field.default_value.includes(c.value))
        .map((c) => ({ value: c.value, label: c.label }));
      return {
        choices: selectedChoices,
        other: [],
      };

    case 'DateField':
      if (field.default_value === 'now') {
        return formatLocalDate(); // YYYY-MM-DD, local calendar day
      }
      return null;

    case 'TimeField':
      if (field.default_value === 'now') {
        const now = new Date();
        return now.toTimeString().split(' ')[0]; // HH:MM:SS format
      }
      return null;

    case 'CalculatedField':
    case 'Section':
    case 'RepeatableSection':
    case 'BuildingPlanSection':
    case 'LabelField':
      return null; // These don't support default values

    default:
      return null;
  }
}
