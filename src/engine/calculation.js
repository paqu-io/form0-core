import { prepareScalarBindings, selectScalarBindings } from './calculation-bindings.js';
import { analyzeRepeatableCollections } from '../utilities/repeatable-collections.js';
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
  calculationPlan = null,
  diagnostics = null
) {
  const resolver = contextResolver || new ContextResolver(schema);
  const warnings = warningSystem || new WarningSystem();
  const plan = calculationPlan || buildCalculationDependencyPlan(schema, resolver);

  emitDependencyPlanWarnings(plan, warnings, runtimeDiagnostics, diagnostics);

  if (plan.totalCalculatedFieldCount === 0) {
    return;
  }

  const blockedFieldNames = blockCyclicCalculatedFields(plan, values);
  const evaluableFieldNames = plan.orderedFieldNames.filter(
    (fieldName) => !blockedFieldNames.has(fieldName)
  );

  if (evaluableFieldNames.length === 0) {
    return;
  }

  if (plan.hasDynamicDependencies) {
    evaluateFieldSequenceUntilStable(
      evaluableFieldNames,
      plan,
      schema,
      values,
      helpers,
      securityConfig,
      resolver,
      warnings,
      runtimeDiagnostics,
      diagnostics
    );
    return;
  }

  plan.orderedComponentIds.forEach((componentId) => {
    const component = plan.componentsById.get(componentId);
    if (!component || component.fieldNames.length === 0) {
      return;
    }

    if (component.isCyclic) {
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
        runtimeDiagnostics,
        diagnostics
      );
    }
  });
}

function blockCyclicCalculatedFields(plan, values) {
  const blockedFieldNames = new Set();

  plan.cyclicComponentIds.forEach((componentId) => {
    const component = plan.componentsById.get(componentId);
    if (!component?.isCyclic) {
      return;
    }

    component.fieldNames.forEach((fieldName) => {
      blockedFieldNames.add(fieldName);
      values[fieldName] = null;
    });
  });

  return blockedFieldNames;
}

function buildScopedContext(
  values,
  helpers,
  executionContext,
  contextResolver,
  warningSystem,
  expressionCode,
  diagnostics,
  preparation = null
) {
  let ctx;

  const referencedFields = preparation?.references ?? extractStaticFieldReferences(expressionCode);
  const access = (fieldName) => {
    if (
      !preparation ||
      (!contextResolver.elementOwnership.has(fieldName) && !referencedFields.has(fieldName))
    )
      return contextResolver.resolveFieldAccess(executionContext, fieldName);
    if (!preparation.access.has(fieldName))
      preparation.access.set(
        fieldName,
        contextResolver.resolveFieldAccess(executionContext, fieldName)
      );
    return preparation.access.get(fieldName);
  };
  const restrictedAccessedFields = [];
  const notFoundAccessedFields = [];

  if (preparation) {
    // The record evaluator has one immutable schema. Enumerate permitted bindings once,
    // then read their CURRENT values on every execution (including all EVAL-accessible fields).
    preparation.bindings ??= [...contextResolver.fieldOwnership.keys()]
      .filter((name) => access(name) === 'accessible')
      .map((name) => [name, `$${name}`]);
    // Use fewer parameters only when syntax and current primitive bindings prove it safe.
    // Keep the full context for dynamic expressions, helper overrides and object inputs.
    const scalar = selectScalarBindings(preparation, values, helpers);
    ctx = scalar
      ? Object.fromEntries(
          [...scalar.names]
            .filter((name) => Object.hasOwn(helpers, name))
            .map((name) => [name, helpers[name]])
        )
      : { ...helpers };
    for (const [name, identifier] of scalar?.bindings ?? preparation.bindings)
      if (Object.hasOwn(values, name)) ctx[identifier] = values[name];
  } else {
    ctx = { ...helpers };
    for (const [fieldName, value] of Object.entries(values)) {
      const accessLevel = access(fieldName);

      if (accessLevel === 'accessible') {
        ctx[`$${fieldName}`] = value;
      } else if (accessLevel === 'restricted') {
        if (referencedFields.has(fieldName)) {
          ctx[`$${fieldName}`] = undefined;
          restrictedAccessedFields.push(fieldName);
        }
      }
    }
  }

  for (const fieldName of referencedFields) {
    if (preparation || !(fieldName in values)) {
      const accessLevel = access(fieldName);
      if (accessLevel === 'not_found' && !(fieldName in values)) {
        notFoundAccessedFields.push(fieldName);
      } else if (accessLevel === 'restricted') {
        ctx[`$${fieldName}`] = undefined;
        restrictedAccessedFields.push(fieldName);
      }
    }
  }

  restrictedAccessedFields.forEach((fieldName) => {
    const warning = contextResolver.generateAccessWarning(
      executionContext,
      fieldName,
      'restricted'
    );
    if (diagnostics) diagnostics.emitWarning(warning);
    else warningSystem.emitWarning(warning);
  });

  notFoundAccessedFields.forEach((fieldName) => {
    const warning = contextResolver.generateAccessWarning(executionContext, fieldName, 'not_found');
    if (diagnostics) diagnostics.emitWarning(warning);
    else warningSystem.emitWarning(warning);
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

function emitDependencyPlanWarnings(plan, warningSystem, runtimeDiagnostics, diagnostics) {
  const emit = (warning, fieldNames) =>
    diagnostics ? diagnostics.emitWarning(warning, fieldNames) : warningSystem.emitWarning(warning);
  plan.dynamicFieldNames.forEach((fieldName) => {
    const message = `CalculatedField '${fieldName}' uses dynamic field access. Runtime evaluation falls back to bounded stabilization.`;
    emit({
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
    const message = `CalculatedField dependency cycle detected: ${fieldNames.join(' -> ')}. Runtime evaluation is disabled for the involved fields until the cycle is removed.`;
    emit(
      {
        type: 'calculation_dependency',
        reason: 'cyclic_dependencies',
        severity: 'error',
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
      },
      fieldNames
    );

    fieldNames.forEach((fieldName) => {
      pushRuntimeDiagnostic(
        runtimeDiagnostics,
        fieldName,
        message,
        'error',
        `cycle:${componentId}`
      );
    });
  });
}

export function evaluateCalculatedField(
  field,
  schema,
  values,
  helpers,
  securityConfig,
  resolver,
  warnings,
  runtimeDiagnostics,
  diagnostics,
  execution = {}
) {
  if (!field?.data_name || !field.calculate) {
    return { changed: false, hasError: false };
  }

  try {
    // Factory-owned metadata only: never retain instance values, diagnostics or permissions
    // from a different schema. The ordinary engine path continues without this private cache.
    let preparation = execution.preparationCache?.get(field.data_name);
    if (!preparation && execution.preparationCache) {
      preparation = {
        context: buildCalculationExecutionContext(schema, field.data_name, resolver),
        references: extractStaticFieldReferences(field.calculate),
        access: new Map(),
        scalar: prepareScalarBindings(field.calculate),
      };
      execution.preparationCache.set(field.data_name, preparation);
    }
    const executionContext =
      preparation?.context ?? buildCalculationExecutionContext(schema, field.data_name, resolver);
    const context = buildScopedContext(
      values,
      helpers,
      executionContext,
      resolver,
      warnings,
      field.calculate,
      diagnostics,
      preparation
    );
    const previousValue = values[field.data_name];
    const collection =
      execution.expression === undefined
        ? analyzeRepeatableCollections(field.calculate, resolver, field.data_name)
        : null;
    if (collection?.issues.length) {
      values[field.data_name] = null;
      for (const issue of collection.issues)
        diagnostics?.record(field.data_name, { ...issue, phase: 'validation' });
      return { changed: previousValue !== null, hasError: true };
    }
    const nextValue = runExpression(
      execution.expression ?? collection?.expression ?? field.calculate,
      context,
      securityConfig,
      false,
      schema,
      {
        sourceExpression: field.calculate,
        compileCache: execution.compileCache,
        requireResult: true,
        fieldName: field.data_name,
        suppressConsoleWarning:
          diagnostics?.consoleOverride !== undefined || Array.isArray(runtimeDiagnostics),
        onDiagnostic: (diagnostic) => diagnostics?.record(field.data_name, diagnostic),
        evalReporting: {
          resolveReference: execution.resolveReference,
          suppressConsole: diagnostics?.consoleOverride !== undefined,
          onDiagnostic: (diagnostic) => diagnostics?.record(field.data_name, diagnostic),
        },
        onError: (error) => {
          pushRuntimeDiagnostic(
            runtimeDiagnostics,
            field.data_name,
            error instanceof Error && error.message
              ? error.message
              : 'Unknown calculation runtime error.'
          );
        },
      }
    );
    values[field.data_name] = nextValue;
    execution.writeValue?.(nextValue);

    return {
      changed: !areStructuredValuesEqual(previousValue, nextValue),
      hasError: false,
    };
  } catch (error) {
    diagnostics?.record(field.data_name, {
      code: 'runtime_exception',
      phase: 'runtime',
      message:
        error instanceof Error && error.message
          ? error.message
          : 'Unknown calculation runtime error.',
    });
    pushRuntimeDiagnostic(
      runtimeDiagnostics,
      field.data_name,
      error instanceof Error && error.message ? error.message : 'Unknown calculation runtime error.'
    );

    if (diagnostics?.consoleOverride === undefined && !Array.isArray(runtimeDiagnostics)) {
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
  runtimeDiagnostics,
  diagnostics
) {
  const maxPasses = Math.max(2, fieldNames.length);
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
        runtimeDiagnostics,
        diagnostics
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
  const warning = {
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
  };
  if (diagnostics) diagnostics.emitWarning(warning, stillChangingFieldNames);
  else warnings.emitWarning(warning);

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
