import { prepareRecordContext, visitRecordScopes, iterateRecordScopes } from './record-context.js';
import {
  validateSubmissionWithContext,
  validateScope,
  summarizeSubmissionFindings,
} from './submission-validation.js';
import { getDefaultValue } from './form-engine.js';
import { evaluateCalculatedField } from './calculation.js';
import { evaluateVisibility, evaluateRequirement, evaluateReadOnly } from './conditions.js';
import { createCalculationDiagnostics } from './calculation-diagnostics.js';
import { createManagedEventDispatcher } from './managed-events.js';
import { EventManager } from './events.js';
import { WarningSystem } from './warning-system.js';
import { calculationBuiltins, eventBuiltins } from '../builtins/registry.js';
import { DEFAULT_SECURITY_CONFIG } from '../security/config.js';
import { validateFieldValue } from '../schema/field-value-registry.js';
import { copyRecordData, copyRecordDataCooperatively } from '../utilities/record-data.js';
import { areStructuredValuesEqual } from '../utilities/value-equality.js';
import { projectCollectionValue } from '../utilities/repeatable-collections.js';
import { getFormSchemaRevision } from '../utilities/schema-revision.js';
import { createRecordFreshness } from './record-freshness.js';

const clock = () => globalThis.performance?.now?.() ?? Date.now();
const issue = (code, message, instancePath = []) => ({ code, message, instancePath });
const failure = (error) => ({
  status: error.code === 'cancelled' ? 'cancelled' : 'failed',
  eligible: false,
  snapshot: null,
  issues: [
    {
      ...issue(error.code || 'record_evaluation_failed', error.message, error.instancePath || []),
      ...(error.context ? { context: error.context } : {}),
    },
  ],
  diagnostics: [],
});
function problem(code, message) {
  return Object.assign(new Error(message), { code });
}

function sameInstancePath(left, right) {
  return (
    left.length === right.length &&
    left.every((part, index) => {
      const other = right[index];
      return (
        part.repeatableKey === other.repeatableKey &&
        part.identity === other.identity &&
        (part.identity === 'id' ? part.instanceId === other.instanceId : part.index === other.index)
      );
    })
  );
}

function validateInstancePath(path) {
  if (
    !Array.isArray(path) ||
    path.some(
      (part) =>
        !part ||
        typeof part.repeatableKey !== 'string' ||
        !part.repeatableKey ||
        !Number.isSafeInteger(part.index) ||
        part.index < 0 ||
        !['id', 'position'].includes(part.identity) ||
        (part.identity === 'id' &&
          !(
            (typeof part.instanceId === 'string' && part.instanceId.trim()) ||
            (typeof part.instanceId === 'number' && Number.isFinite(part.instanceId))
          )) ||
        (part.identity === 'position' && part.instanceId != null)
    )
  )
    throw problem('invalid_instance_path', 'A complete record instancePath is required.');
}

function scheduler(options) {
  let started = clock();
  const check = () => {
    if (options.signal?.aborted) throw problem('cancelled', 'Record evaluation was cancelled.');
  };
  return async () => {
    check();
    if (clock() - started >= (options.budgetMs ?? 8)) {
      await (options.yieldToHost
        ? options.yieldToHost()
        : new Promise((resolve) => setTimeout(resolve, 0)));
      started = clock();
      check();
    }
  };
}

/**
 * @typedef {Object} RecordInstanceSegment
 * @property {string} repeatableKey Preferred schema key.
 * @property {string|number|null} instanceId Preserves zero; null for positional targeting.
 * @property {number} index Captured row position.
 * @property {'id'|'position'} identity
 *
 * @typedef {Object<string, *> & {values?: Object<string, *>, repeatable?: Object<string, RecordSnapshot[]>, id?: string|number, record_id?: string|number}} RecordSnapshot
 * Live values use data_names; collections use preferred schema keys. Unknown metadata is retained.
 *
 * @typedef {Object} RecordFieldChange
 * @property {RecordInstanceSegment[]} instancePath
 * @property {string} fieldName data_name.
 * @property {string} fieldKey
 * @property {*} before
 * @property {*} after
 *
 * @typedef {Object} RecordFreshness
 * @property {1} version
 * @property {'current'|'pending'} status
 * @property {string} schemaRevision
 * @property {Array<{instancePath: RecordInstanceSegment[], fields: Array<{fieldName: string, fieldKey: string}>}>} affected One entry per affected row, in record order.
 *
 * @typedef {Object} RecordEvaluationOptions
 * @property {'accepted'|'refresh'} [mode='accepted'] Closed-child calculation policy.
 * @property {AbortSignal} [signal]
 * @property {number} [budgetMs=8] Cooperative scheduling target, not an expression timeout.
 * @property {() => (void|Promise<void>)} [yieldToHost]
 *
 * @typedef {Object} SubmissionPreparationOptions
 * @property {'submit'|'draft'} [intent='submit']
 * @property {'automatic'|'confirm'} [mode='automatic'] Cannot weaken schema confirmation.
 * @property {boolean} [allowRetain=false] Explicit host permission on both review calls.
 * @property {boolean} [managedEvents=false] Synchronous custom validation only.
 * @property {{reviewId: string, action: 'refresh'|'retain'|'cancel'}} [decision]
 * @property {AbortSignal} [signal]
 * @property {number} [budgetMs=8]
 * @property {() => (void|Promise<void>)} [yieldToHost]
 *
 * @typedef {Object} RecordEvaluationResult
 * @property {'evaluated'|'ready'|'blocked'|'requires_decision'|'failed'|'cancelled'} status
 * @property {RecordSnapshot|null} snapshot Null when no selection can be delivered.
 * @property {boolean} [eligible] Submission eligibility, distinct from diagnostics.
 * @property {RecordSnapshot} [proposal] Review only, not a deliverable selection.
 * @property {RecordFieldChange[]} [changes]
 * @property {Object[]} diagnostics Scoped calculation findings, separate from validation.
 * @property {Object[]} issues Execution/configuration failures.
 * @property {import('./submission-validation.js').SubmissionValidationSummary} [validationSummary]
 * @property {RecordFreshness} [freshness] Host-persisted companion, outside the record.
 * @property {string} [reviewId] Single-use factory-owned review handle.
 * @property {Array<'refresh'|'retain'|'cancel'>} [choices]
 *
 * @typedef {Object} RecordScopeEvaluationOptions
 * @property {'edit'|'readonly'} [interactionMode='edit'] Readonly computes field state from supplied values without calculations or defaults.
 * @property {RecordInstanceSegment[]} [instancePath=[]] Complete record ancestry; an empty path selects root.
 * @property {AbortSignal} [signal]
 * @property {number} [budgetMs=8]
 * @property {() => (void|Promise<void>)} [yieldToHost]
 *
 * @typedef {Object} RecordScopeEvaluationResult
 * @property {'evaluated'|'failed'|'cancelled'} status
 * @property {RecordInstanceSegment[]} [instancePath] Resolved identity and current ordering on success.
 * @property {{values: Object, errors: Object, visible: Object, required: Object, read_only: Object}|null} state
 * @property {import('./submission-validation.js').SubmissionValidationSummary} [validationSummary]
 * @property {RecordFieldChange[]} [changes]
 * @property {Object[]} diagnostics
 * @property {Object[]} issues
 *
 * @typedef {Object} RecordEvaluator
 * @property {(snapshot: RecordSnapshot, options?: RecordEvaluationOptions) => Promise<RecordEvaluationResult>} evaluate
 * @property {(snapshot: RecordSnapshot, options?: RecordScopeEvaluationOptions) => Promise<RecordScopeEvaluationResult>} evaluateScope Evaluates only the selected editor record, without a complete tree response.
 * @property {(snapshot: RecordSnapshot, options?: SubmissionPreparationOptions) => Promise<RecordEvaluationResult>} prepareSubmission
 */

/**
 * Coordinate an immutable runtime record tree using the existing expression/condition engine.
 * Factory configuration is captured; recreate the evaluator when schema/helpers/security change.
 * @param {{schema: Object, helpers?: Object, security?: Object, warningSystem?: Object,
 * diagnostics?: {console?: boolean}, onDiagnostics?: Function}} config
 * @returns {RecordEvaluator}
 */
export function createRecordEvaluator({
  schema,
  helpers = {},
  security = DEFAULT_SECURITY_CONFIG,
  warningSystem = new WarningSystem(),
  diagnostics: diagnosticOptions = {},
  onDiagnostics = null,
}) {
  const context = prepareRecordContext(schema, warningSystem);
  const fixedHelpers = { ...helpers };
  const fixedSecurity = {
    ...security,
    ...(Array.isArray(security.allowedGlobals)
      ? { allowedGlobals: [...security.allowedGlobals] }
      : {}),
    ...(Array.isArray(security.blockedPatterns)
      ? {
          blockedPatterns: security.blockedPatterns.map((pattern) =>
            pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags) : pattern
          ),
        }
      : {}),
  };
  const schemaRevision = getFormSchemaRevision(context.sourceSchema);
  const diagnostics = createCalculationDiagnostics(
    diagnosticOptions,
    null,
    context.resolver,
    warningSystem
  );
  const compileCache = new Map();
  const calculationPreparationCache = new Map();
  const eventSourceCache = new Map();
  const eventReferenceCache = new Map();
  const evaluatorId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let generation = 0;
  let review = null;

  async function run(input, options = {}, scopePath = null) {
    const mode = options.mode ?? 'accepted';
    if (!['accepted', 'refresh'].includes(mode))
      throw problem('invalid_request', 'Evaluation mode must be accepted or refresh.');
    const scoped = scopePath !== null;
    const viewing = scoped && options.interactionMode === 'readonly';
    if (
      scoped &&
      options.interactionMode !== undefined &&
      !['edit', 'readonly'].includes(options.interactionMode)
    )
      throw problem('invalid_request', 'interactionMode must be edit or readonly.');
    if (options.signal?.aborted) throw problem('cancelled', 'Record evaluation was cancelled.');
    const snapshot = scoped ? input : copyRecordData(input);
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot))
      throw problem('invalid_record_tree', 'A runtime record snapshot is required.');
    const pause = scheduler(options);
    if (!scoped) await pause();
    else if (options.signal?.aborted)
      throw problem('cancelled', 'Record evaluation was cancelled.');
    const scopes = [];
    const byDefinition = new Map();
    let selectedScope = null;
    const prepareScope = (scope) => {
      let { record } = scope;
      const { template } = scope;
      scope.sourceRecord = record;
      // Capture only the calculation values needed by the change report. A second complete
      // record-tree copy is unnecessary; all execution happens against our private snapshot.
      if (!scoped)
        scope.beforeCalculations = new Map(
          template.fields
            .filter((field) => field.type === 'CalculatedField')
            .map((field) => [
              field.data_name,
              copyRecordData(record.values?.[field.data_name] ?? null),
            ])
        );
      if (
        record.values !== undefined &&
        (!record.values || typeof record.values !== 'object' || Array.isArray(record.values))
      )
        throw problem('invalid_record_tree', 'Record values must be an object.');
      if (
        record.repeatable !== undefined &&
        (!record.repeatable ||
          typeof record.repeatable !== 'object' ||
          Array.isArray(record.repeatable))
      )
        throw problem('invalid_record_tree', 'Record repeatable collections must be an object.');
      if (scoped && sameInstancePath(scope.instancePath, scopePath)) {
        selectedScope = scope;
        scope.beforeValues = copyRecordData(record.values || {});
        record = scope.record = { ...record, values: copyRecordData(record.values || {}) };
      }
      if (!scoped || selectedScope === scope) {
        record.values ??= {};
        record.errors = {};
        record.visible = {};
        record.required = {};
        record.read_only = {};
        for (const field of template.fields)
          if (!Object.hasOwn(record.values, field.data_name))
            record.values[field.data_name] = copyRecordData(
              getDefaultValue(viewing ? { ...field, default_value: null } : field)
            );
      }
      scope.uid = scopes.length;
      scope.lineage = [...scope.ancestors, scope];
      scope.nodes = new Map();
      scopes.push(scope);
      const key = JSON.stringify(template.path);
      if (!byDefinition.has(key)) byDefinition.set(key, []);
      byDefinition.get(key).push(scope);
    };
    // Live scoped reads must all be captured before the first yield. Full runs already own
    // their captured input, so scope preparation can give the host control between rows.
    if (scoped) visitRecordScopes(snapshot, context, prepareScope);
    else
      for (const scope of iterateRecordScopes(snapshot, context)) {
        prepareScope(scope);
        await pause();
      }
    if (scoped && !selectedScope)
      throw problem('invalid_instance_path', 'No record matches this instancePath.');
    const nodes = [];
    for (const scope of scopes) {
      if (
        viewing ||
        (scoped ? scope !== selectedScope : scope.instancePath.length && mode === 'accepted')
      )
        continue;
      for (const field of scope.template.fields)
        if (field.type === 'CalculatedField' && field.calculate) {
          const definition = context.calculations.get(field.data_name);
          const node = {
            scope,
            field,
            definition,
            dependencies: new Set(),
            state: 0,
            blocked: false,
          };
          scope.nodes.set(field.data_name, node);
          nodes.push(node);
        }
      if (!scoped) await pause();
    }
    const ownerScope = (scope, name) => {
      const info = context.resolver.fieldOwnership.get(name);
      return info &&
        info.parentPath.length <= scope.template.path.length &&
        info.parentPath.every((part, index) => scope.template.path[index] === part)
        ? scope.lineage[info.parentPath.length]
        : null;
    };
    const queryCache = new Map();
    function rows(scope, section) {
      const info = context.resolver.repeatableSectionTree.get(section);
      const depth = Math.min(scope.template.path.length, info.parentPath.length);
      const anchor = scope.lineage[depth];
      const key = `${anchor.uid}:${section}`;
      if (!queryCache.has(key))
        queryCache.set(
          key,
          (byDefinition.get(JSON.stringify(info.currentPath)) || []).filter(
            (candidate) => candidate.lineage[depth] === anchor
          )
        );
      return queryCache.get(key);
    }
    if (scoped) {
      const captured = new Set([selectedScope]);
      for (const ancestor of selectedScope.ancestors) {
        ancestor.record = { values: copyRecordData(ancestor.sourceRecord.values || {}) };
        captured.add(ancestor);
      }
      // Capture only the fields actually read from closed collections, before yielding.
      for (const node of nodes)
        for (const call of node.definition.collection.calls)
          if (!node.definition.collection.issues.length)
            for (const row of rows(selectedScope, call.section)) {
              if (row === selectedScope) continue;
              if (!captured.has(row)) {
                row.record = { values: {} };
                captured.add(row);
              }
              row.record.values[call.target] = copyRecordData(
                row.sourceRecord.values?.[call.target]
              );
            }
      await pause();
    }
    for (const node of nodes) {
      for (const name of node.definition.directReferences) {
        const dependency = ownerScope(node.scope, name)?.nodes.get(name);
        if (dependency) node.dependencies.add(dependency);
      }
      if (!node.definition.collection.issues.length)
        for (const call of node.definition.collection.calls)
          for (const row of rows(node.scope, call.section)) {
            const dependency = row.nodes.get(call.target);
            if (dependency) node.dependencies.add(dependency);
          }
      await pause();
    }
    const ordered = [];
    const visiting = [];
    const reported = [];
    let fatal = null;
    function cycle(node) {
      const group = visiting.slice(visiting.indexOf(node));
      if (
        new Set(group.map((entry) => entry.scope.uid)).size > 1 ||
        group.some((entry) => entry.definition.collection.calls.length)
      ) {
        fatal = problem(
          'record_dependency_cycle',
          `Record-spanning calculation dependency cycle detected: ${group.map((entry) => entry.field.data_name).join(' -> ')}.`
        );
        fatal.instancePath = node.scope.instancePath;
        fatal.context = {
          cycle: group.map((entry) => ({
            fieldName: entry.field.data_name,
            instancePath: entry.scope.instancePath,
          })),
        };
        throw fatal;
      }
      for (const entry of group) {
        entry.blocked = true;
        entry.scope.record.values[entry.field.data_name] = null;
        reported.push({
          code: 'cyclic_dependencies',
          severity: 'error',
          phase: 'dependency',
          fieldName: entry.field.data_name,
          message: 'CalculatedField dependency cycle detected; involved fields evaluate to null.',
          suggestion: 'Remove the calculation cycle.',
          context: {},
          instancePath: entry.scope.instancePath,
        });
      }
    }
    function order(node) {
      if (node.state === 2) return;
      if (node.state === 1) {
        cycle(node);
        return;
      }
      node.state = 1;
      visiting.push(node);
      for (const dependency of node.dependencies) order(dependency);
      visiting.pop();
      node.state = 2;
      ordered.push(node);
    }
    for (const node of nodes) {
      order(node);
      await pause();
    }
    for (const node of nodes) node.state = 0;
    const projectionCache = new Map();
    const readable = (scope) =>
      Object.assign({}, ...scope.lineage.map((entry) => entry.record.values));
    function execute(node) {
      if (node.blocked || node.state === 2) return;
      if (node.state === 1) {
        cycle(node);
        return;
      }
      node.state = 1;
      visiting.push(node);
      for (const dependency of node.dependencies) execute(dependency);
      const frame = diagnostics.begin();
      try {
        const analysis = node.definition.collection;
        if (analysis.issues.length) {
          node.scope.record.values[node.field.data_name] = null;
          for (const item of analysis.issues)
            diagnostics.record(node.field.data_name, { ...item, phase: 'validation' });
        } else {
          function collect(section, target) {
            const info = context.resolver.repeatableSectionTree.get(section);
            const anchor =
              node.scope.lineage[Math.min(node.scope.template.path.length, info.parentPath.length)];
            const key = `${anchor.uid}:${section}:${target}`;
            if (!projectionCache.has(key)) {
              const field = context.resolver.fieldOwnership.get(target).field;
              projectionCache.set(
                key,
                rows(node.scope, section).map((row) => {
                  const dependency = row.nodes.get(target);
                  if (dependency) execute(dependency);
                  return copyRecordData(projectCollectionValue(field, row.record.values?.[target]));
                })
              );
            }
            return copyRecordData(projectionCache.get(key));
          }
          const runtimeHelpers = {
            ...calculationBuiltins,
            ...fixedHelpers,
            REPEATABLEVALUES: collect,
            REPEATABLESUM: (section, target) =>
              collect(section, target).reduce((sum, value) => {
                if (value == null) return sum;
                if (typeof value !== 'number' || !Number.isFinite(value))
                  throw new Error(
                    'REPEATABLESUM requires finite numbers; numeric strings are not converted.'
                  );
                const next = sum + value;
                if (!Number.isFinite(next)) throw new Error('REPEATABLESUM result is not finite.');
                return next;
              }, 0),
          };
          const calculationValues = readable(node.scope);
          for (const name of node.definition.directReferences) {
            const owner = ownerScope(node.scope, name);
            if (
              owner &&
              owner !== node.scope &&
              calculationValues[name] &&
              typeof calculationValues[name] === 'object'
            )
              calculationValues[name] = copyRecordData(calculationValues[name]);
          }
          evaluateCalculatedField(
            node.field,
            context.schema.form,
            calculationValues,
            runtimeHelpers,
            fixedSecurity,
            context.resolver,
            warningSystem,
            null,
            diagnostics,
            {
              expression: analysis.expression,
              compileCache,
              preparationCache: calculationPreparationCache,
              writeValue: (value) => {
                node.scope.record.values[node.field.data_name] = value;
              },
              resolveReference: (reference) => {
                const name = reference.slice(1);
                const owner = ownerScope(node.scope, name);
                if (!owner) return undefined;
                const dependency = owner.nodes.get(name);
                if (dependency) execute(dependency);
                return copyRecordData(owner.record.values[name]);
              },
            }
          );
        }
      } finally {
        diagnostics.complete(frame);
        reported.push(
          ...diagnostics
            .getSnapshot()
            .map((item) => ({ ...item, instancePath: node.scope.instancePath }))
        );
        visiting.pop();
        node.state = 2;
      }
      if (node.blocked) node.scope.record.values[node.field.data_name] = null;
      if (fatal) throw fatal;
    }
    for (const node of ordered) {
      execute(node);
      await pause();
    }
    for (const scope of scopes) {
      if (scoped && scope !== selectedScope) continue;
      const values = readable(scope);
      evaluateRequirement(
        scope.template.form,
        values,
        scope.record.required,
        scope.template.conditions
      );
      evaluateVisibility(
        scope.template.form,
        values,
        scope.record.visible,
        scope.template.conditions
      );
      evaluateReadOnly(
        scope.template.form,
        values,
        scope.record.read_only,
        scope.template.conditions
      );
      for (const field of scope.template.fields) {
        const error = validateFieldValue(field, scope.record.values[field.data_name]);
        if (error) scope.record.errors[field.data_name] = error;
      }
      await pause();
    }
    const changes = [];
    for (const scope of scopes) {
      if (scoped && scope !== selectedScope) continue;
      for (const field of scope.template.fields)
        if (field.type === 'CalculatedField') {
          const before = scoped
            ? (scope.beforeValues[field.data_name] ?? null)
            : scope.beforeCalculations.get(field.data_name);
          const after = scope.record.values[field.data_name] ?? null;
          if (!areStructuredValuesEqual(before, after))
            changes.push({
              instancePath: scope.instancePath,
              fieldName: field.data_name,
              fieldKey: field.key || field.data_name,
              before: copyRecordData(before),
              after: copyRecordData(after),
            });
        }
      await pause();
    }
    if (scoped) {
      // A scoped caller need not carry cached ancestor visibility maps. Resolve participation
      // from the current supplied ancestors without refreshing any ancestor calculations.
      selectedScope.participating = true;
      for (const [index, ancestor] of selectedScope.ancestors.entries()) {
        const visible = {};
        evaluateVisibility(
          ancestor.template.form,
          readable(ancestor),
          visible,
          ancestor.template.conditions
        );
        const key = selectedScope.instancePath[index].repeatableKey;
        const section = ancestor.template.fields.find(
          (field) =>
            field.type === 'RepeatableSection' &&
            context.resolver.repeatableSectionTree.get(field.data_name).preferredKey === key
        );
        if (
          visible[section.data_name] === false ||
          !(ancestor.template.chains.get(section.data_name) || []).every(
            (name) => visible[name] !== false
          )
        )
          selectedScope.participating = false;
      }
      const { values, errors, visible, required, read_only } = selectedScope.record;
      return {
        status: 'evaluated',
        instancePath: copyRecordData(selectedScope.instancePath),
        state: { values, errors, visible, required, read_only },
        validationSummary: summarizeSubmissionFindings(validateScope(selectedScope)),
        changes,
        diagnostics: reported,
        issues: [],
      };
    }
    return { status: 'evaluated', snapshot, changes, diagnostics: reported, issues: [] };
  }

  async function validate(result, options) {
    const custom = [];
    const executionIssues = [];
    const pause = scheduler(options);
    await pause();
    if (options.managedEvents === true) {
      const scopes = [];
      visitRecordScopes(result.snapshot, context, (scope) => scopes.push(scope));
      for (const scope of scopes) {
        if (!scope.participating) continue;
        const values = Object.assign(
          {},
          ...scope.ancestors.map((entry) => entry.record.values),
          scope.record.values
        );
        const eventManager = new EventManager(
          context.schema.form,
          context.resolver,
          warningSystem,
          {
            sourceCache: eventSourceCache,
            compilationCache: compileCache,
            referenceSourceCache: eventReferenceCache,
          }
        );
        eventManager.securityConfig = fixedSecurity;
        const initialContext = { ...eventBuiltins, ...fixedHelpers };
        for (const [name, info] of context.resolver.fieldOwnership)
          initialContext[`$${name}`] = copyRecordData(getDefaultValue(info.field));
        for (const [name, value] of Object.entries(values))
          initialContext[`$${name}`] = copyRecordData(value);
        if (context.schema.form.events?.code)
          eventManager.initializeEventCode(context.schema.form.events.code, initialContext);
        eventManager.eventContext = initialContext;
        const dispatch = createManagedEventDispatcher(
          eventManager,
          {
            instancePath: scope.instancePath,
          },
          () => 'readonly'
        );
        const row = scope.instancePath.length > 0;
        const definition = row
          ? context.repeatableByPath.get(JSON.stringify(scope.template.path))
          : null;
        const detail = dispatch(
          row ? 'validate-repeatable' : 'validate-record',
          definition?.field.data_name,
          { isDraft: options.intent === 'draft', isValid: validateScope(scope).length === 0 }
        );
        custom.push(...detail.validationIssues);
        executionIssues.push(...detail.issues);
        await pause();
      }
    }
    const validationSummary = validateSubmissionWithContext(result.snapshot, context, custom);
    await pause();
    return {
      ...result,
      status: executionIssues.length
        ? 'failed'
        : options.intent !== 'draft' && validationSummary.hasErrors
          ? 'blocked'
          : 'ready',
      eligible:
        !executionIssues.length && (options.intent === 'draft' || !validationSummary.hasErrors),
      validationSummary,
      issues: executionIssues,
    };
  }

  async function evaluate(snapshot, options = {}) {
    try {
      const result = await run(snapshot, options);
      if (typeof onDiagnostics === 'function') {
        try {
          Promise.resolve(onDiagnostics(copyRecordData(result.diagnostics))).catch(() => {});
        } catch {
          /* Observational. */
        }
      }
      return result;
    } catch (error) {
      return failure(error);
    }
  }

  /** Evaluate one editor without refreshing or copying its accepted descendants. */
  async function evaluateScope(snapshot, options = {}) {
    try {
      const path = options.instancePath ?? [];
      validateInstancePath(path);
      const result = await run(snapshot, { ...options, mode: 'accepted' }, path);
      if (typeof onDiagnostics === 'function') {
        try {
          Promise.resolve(onDiagnostics(copyRecordData(result.diagnostics))).catch(() => {});
        } catch {
          /* Observational. */
        }
      }
      return result;
    } catch (error) {
      return { ...failure(error), state: null };
    }
  }

  /**
   * Prepare only: no save hooks, persistence, editor acceptance or timestamp generation.
   * Resume a required decision with {decision:{reviewId, action:'refresh'|'retain'|'cancel'}}.
   */
  async function prepareSubmission(snapshot, options = {}) {
    const prior = review;
    const attempt = ++generation;
    review = null;
    try {
      const intent = options.intent ?? 'submit';
      if (!['submit', 'draft'].includes(intent))
        throw problem('invalid_request', 'Submission intent must be submit or draft.');
      if (options.mode !== undefined && !['automatic', 'confirm'].includes(options.mode))
        throw problem('invalid_request', 'Submission mode must be automatic or confirm.');
      const mode =
        context.schema.form.repeatable_recalculation === 'confirm' || options.mode === 'confirm'
          ? 'confirm'
          : 'automatic';
      const settings = {
        intent,
        mode,
        allowRetain: options.allowRetain === true,
        managedEvents: options.managedEvents === true,
      };
      if (options.signal?.aborted) throw problem('cancelled', 'Record evaluation was cancelled.');
      let fresh, retained, selected;
      if (options.decision) {
        const decision = options.decision;
        if (
          !prior ||
          prior.id !== decision.reviewId ||
          !areStructuredValuesEqual(snapshot, prior.source) ||
          !areStructuredValuesEqual(settings, prior.settings)
        )
          throw problem(
            'stale_review',
            'Submission review is obsolete; prepare the current record again.'
          );
        if (decision.action === 'cancel')
          return {
            status: 'cancelled',
            eligible: false,
            snapshot: null,
            issues: [],
            diagnostics: [],
          };
        if (!['refresh', 'retain'].includes(decision.action))
          throw problem('invalid_decision', 'Decision must be refresh, retain or cancel.');
        if (decision.action === 'retain' && !settings.allowRetain)
          throw problem(
            'retention_not_allowed',
            'The host has not permitted retaining child calculations.'
          );
        fresh = prior.fresh;
        retained = prior.retained;
        selected = decision.action === 'retain' ? retained : fresh;
      } else {
        // run() captures its input before the first yield. Automatic submission has no
        // retained branch, so only confirmation/drafts need another accepted-source copy.
        const source =
          intent === 'draft' || mode === 'confirm' ? copyRecordData(snapshot) : snapshot;
        fresh = await run(source, { ...options, mode: 'refresh' });
        if (attempt !== generation)
          throw problem(
            'stale_preparation',
            'A newer submission preparation superseded this attempt.'
          );
        const childChanges = fresh.changes.filter((change) => change.instancePath.length);
        if (intent === 'draft' || (mode === 'confirm' && childChanges.length))
          retained = await run(source, { ...options, mode: 'accepted' });
        if (attempt !== generation)
          throw problem(
            'stale_preparation',
            'A newer submission preparation superseded this attempt.'
          );
        if (intent === 'submit' && mode === 'confirm' && childChanges.length) {
          const id = `${evaluatorId}:${attempt}`;
          const pendingReview = { id, source, settings, fresh, retained };
          const result = await copyRecordDataCooperatively(
            {
              status: 'requires_decision',
              eligible: false,
              snapshot: null,
              proposal: fresh.snapshot,
              reviewId: id,
              changes: fresh.changes,
              validationSummary: validateSubmissionWithContext(fresh.snapshot, context),
              diagnostics: fresh.diagnostics,
              issues: [],
              freshness: createRecordFreshness(schemaRevision, childChanges),
              choices: settings.allowRetain
                ? ['refresh', 'retain', 'cancel']
                : ['refresh', 'cancel'],
            },
            scheduler(options)
          );
          if (attempt !== generation)
            throw problem(
              'stale_preparation',
              'A newer submission preparation superseded this attempt.'
            );
          review = pendingReview;
          return result;
        }
        selected = intent === 'draft' ? retained : fresh;
      }
      const childChanges = fresh.changes.filter((change) => change.instancePath.length);
      const pending = selected === retained && childChanges.length > 0;
      const prepared = await validate(selected, { ...options, intent });
      if (attempt !== generation)
        throw problem(
          'stale_preparation',
          'A newer submission preparation superseded this attempt.'
        );
      const result = await copyRecordDataCooperatively(
        {
          ...prepared,
          changes: fresh.changes,
          freshness: createRecordFreshness(schemaRevision, pending ? childChanges : []),
        },
        scheduler(options)
      );
      if (attempt !== generation)
        throw problem(
          'stale_preparation',
          'A newer submission preparation superseded this attempt.'
        );
      return result;
    } catch (error) {
      return failure(error);
    }
  }
  return { evaluate, evaluateScope, prepareSubmission };
}
