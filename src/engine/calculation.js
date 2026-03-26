import { runExpression } from './evaluator.js';
import { ContextResolver } from './context-resolver.js';
import { WarningSystem } from './warning-system.js';
import {
  buildCalculationDependencyPlan,
  buildCalculationExecutionContext,
  extractStaticFieldReferences,
} from '../utilities/calculation-dependencies.js';
import { areStructuredValuesEqual } from '../utilities/value-equality.js';

export function evaluateCalculatedFields(
  schema,
  values,
  helpers,
  securityConfig,
  contextResolver = null,
  warningSystem = null,
  runtimeDiagnostics = null,
  calculationPlan = null
) {
  const resolver = contextResolver || new ContextResolver(schema);
  const warnings = warningSystem || new WarningSystem();
  const plan = calculationPlan || buildCalculationDependencyPlan(schema, resolver);

  emitDependencyPlanWarnings(plan, warnings, runtimeDiagnostics);

  if (plan.totalCalculatedFieldCount === 0) {
    return;
  }

  if (plan.hasDynamicDependencies) {
    evaluateFieldSequenceUntilStable(
      plan.orderedFieldNames,
      plan,
      schema,
      values,
      helpers,
      securityConfig,
      resolver,
      warnings,
      runtimeDiagnostics
    );
    return;
  }

  plan.orderedComponentIds.forEach((componentId) => {
    const component = plan.componentsById.get(componentId);
    if (!component || component.fieldNames.length === 0) {
      return;
    }

    if (component.isCyclic) {
      evaluateFieldSequenceUntilStable(
        component.fieldNames,
        plan,
        schema,
        values,
        helpers,
        securityConfig,
        resolver,
        warnings,
        runtimeDiagnostics
      );
      return;
    }

    const fieldName = component.fieldNames[0];
    const node = plan.nodesByDataName.get(fieldName);
    if (node?.field) {
      evaluateCalculatedField(
        node.field,
        schema,
        values,
        helpers,
        securityConfig,
        resolver,
        warnings,
        runtimeDiagnostics
      );
    }
  });
}

function buildScopedContext(
  values,
  helpers,
  executionContext,
  contextResolver,
  warningSystem,
  expressionCode
) {
  const ctx = { ...helpers };

  const referencedFields = extractStaticFieldReferences(expressionCode);
  const restrictedAccessedFields = [];
  const notFoundAccessedFields = [];

  for (const [fieldName, value] of Object.entries(values)) {
    const accessLevel = contextResolver.resolveFieldAccess(executionContext, fieldName);

    if (accessLevel === 'accessible') {
      ctx[`$${fieldName}`] = value;
    } else if (accessLevel === 'restricted') {
      if (referencedFields.has(fieldName)) {
        ctx[`$${fieldName}`] = undefined;
        restrictedAccessedFields.push(fieldName);
      }
    }
  }

  for (const fieldName of referencedFields) {
    if (!(fieldName in values)) {
      const accessLevel = contextResolver.resolveFieldAccess(executionContext, fieldName);
      if (accessLevel === 'not_found') {
        notFoundAccessedFields.push(fieldName);
      }
    }
  }

  restrictedAccessedFields.forEach((fieldName) => {
    const warning = contextResolver.generateAccessWarning(
      executionContext,
      fieldName,
      'restricted'
    );
    warningSystem.emitWarning(warning);
  });

  notFoundAccessedFields.forEach((fieldName) => {
    const warning = contextResolver.generateAccessWarning(executionContext, fieldName, 'not_found');
    warningSystem.emitWarning(warning);
  });

  return ctx;
}

function pushRuntimeDiagnostic(
  runtimeDiagnostics,
  fieldName,
  message,
  severity = 'error',
  dedupeKey = null
) {
  if (!Array.isArray(runtimeDiagnostics)) {
    return;
  }

  if (
    dedupeKey &&
    runtimeDiagnostics.some(
      (diagnostic) =>
        diagnostic?.fieldName === fieldName &&
        diagnostic?.message === message &&
        diagnostic?.dedupeKey === dedupeKey
    )
  ) {
    return;
  }

  runtimeDiagnostics.push({
    fieldName,
    message,
    severity,
    dedupeKey,
  });
}

function emitDependencyPlanWarnings(plan, warningSystem, runtimeDiagnostics) {
  plan.dynamicFieldNames.forEach((fieldName) => {
    const message = `CalculatedField '${fieldName}' uses dynamic field access. Runtime evaluation falls back to bounded stabilization.`;
    warningSystem.emitWarning({
      type: 'calculation_dependency',
      reason: 'dynamic_dependencies',
      message,
      suggestion: 'Prefer direct $field references when possible to enable dependency ordering.',
      executionContext: {
        type: 'calculation',
        fieldName,
      },
      fieldContext: {
        fieldName,
        dynamic: true,
      },
    });
    pushRuntimeDiagnostic(
      runtimeDiagnostics,
      fieldName,
      message,
      'warning',
      `dynamic:${fieldName}`
    );
  });

  plan.cyclicComponentIds.forEach((componentId) => {
    const component = plan.componentsById.get(componentId);
    if (!component?.isCyclic) {
      return;
    }

    const fieldNames = component.fieldNames;
    const message = `CalculatedField dependency cycle detected: ${fieldNames.join(' -> ')}. Runtime evaluation will use bounded stabilization.`;
    warningSystem.emitWarning({
      type: 'calculation_dependency',
      reason: 'cyclic_dependencies',
      message,
      suggestion:
        'Remove the cycle or break it with a source field so calculated values can be evaluated deterministically.',
      executionContext: {
        type: 'calculation',
        fieldName: fieldNames[0] || null,
      },
      fieldContext: {
        fieldNames: [...fieldNames],
        cyclic: true,
      },
    });

    fieldNames.forEach((fieldName) => {
      pushRuntimeDiagnostic(
        runtimeDiagnostics,
        fieldName,
        message,
        'warning',
        `cycle:${componentId}`
      );
    });
  });
}

function evaluateCalculatedField(
  field,
  schema,
  values,
  helpers,
  securityConfig,
  resolver,
  warnings,
  runtimeDiagnostics
) {
  if (!field?.data_name || !field.calculate) {
    return { changed: false, hasError: false };
  }

  try {
    const executionContext = buildCalculationExecutionContext(schema, field.data_name, resolver);
    const context = buildScopedContext(
      values,
      helpers,
      executionContext,
      resolver,
      warnings,
      field.calculate
    );
    const previousValue = values[field.data_name];
    const nextValue = runExpression(field.calculate, context, securityConfig, false, schema, {
      suppressConsoleWarning: Array.isArray(runtimeDiagnostics),
      onError: (error) => {
        pushRuntimeDiagnostic(
          runtimeDiagnostics,
          field.data_name,
          error instanceof Error && error.message
            ? error.message
            : 'Unknown calculation runtime error.'
        );
      },
    });
    values[field.data_name] = nextValue;

    return {
      changed: !areStructuredValuesEqual(previousValue, nextValue),
      hasError: false,
    };
  } catch (error) {
    pushRuntimeDiagnostic(
      runtimeDiagnostics,
      field.data_name,
      error instanceof Error && error.message ? error.message : 'Unknown calculation runtime error.'
    );

    if (!Array.isArray(runtimeDiagnostics)) {
      console.warn(`Calculation failed for ${field.data_name}:`, error?.message);
    }

    return { changed: false, hasError: true };
  }
}

function evaluateFieldSequenceUntilStable(
  fieldNames,
  plan,
  schema,
  values,
  helpers,
  securityConfig,
  resolver,
  warnings,
  runtimeDiagnostics
) {
  const maxPasses = Math.max(2, plan.totalCalculatedFieldCount);
  let stillChangingFieldNames = [];

  for (let pass = 0; pass < maxPasses; pass += 1) {
    stillChangingFieldNames = [];

    fieldNames.forEach((fieldName) => {
      const node = plan.nodesByDataName.get(fieldName);
      if (!node?.field) {
        return;
      }

      const result = evaluateCalculatedField(
        node.field,
        schema,
        values,
        helpers,
        securityConfig,
        resolver,
        warnings,
        runtimeDiagnostics
      );

      if (result.changed) {
        stillChangingFieldNames.push(fieldName);
      }
    });

    if (stillChangingFieldNames.length === 0) {
      return;
    }
  }

  const message = `Calculated fields did not stabilize within ${maxPasses} evaluation passes: ${stillChangingFieldNames.join(', ')}.`;
  warnings.emitWarning({
    type: 'calculation_dependency',
    reason: 'non_converging_runtime',
    message,
    suggestion:
      'Review the involved CalculatedField expressions for dependency cycles or dynamic references that never settle.',
    executionContext: {
      type: 'calculation',
      fieldName: stillChangingFieldNames[0] || null,
    },
    fieldContext: {
      fieldNames: [...stillChangingFieldNames],
      maxPasses,
    },
  });

  stillChangingFieldNames.forEach((fieldName) => {
    pushRuntimeDiagnostic(
      runtimeDiagnostics,
      fieldName,
      message,
      'warning',
      `non-converging:${fieldNames.join(',')}`
    );
  });
}
