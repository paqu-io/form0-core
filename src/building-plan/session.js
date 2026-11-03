import { prepareBuildingPlanEdit } from './opening-edits.js';
import { generateUuidV7 } from '../utilities/uuid.js';
import { normalizeBuildingPlanEditingPolicy } from './editing-policy.js';
import {
  BUILDING_PLAN_PROPERTIES,
  copyBuildingPlanData as copy,
  createBuildingPlanSnapshot,
  equalValue,
  own,
  planIssue,
  reconcileBuildingPlanProperties,
  validateBuildingPlanSnapshot,
} from './model.js';
import { applyBuildingPlanOperation } from './operations.js';

const entityArray = (value) =>
  Array.isArray(value) &&
  value.every((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string');
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

/** Identity-based patches survive unrelated row additions and removals. */
export function diffBuildingPlanSnapshots(before, after, path = [], changes = []) {
  if (equalValue(before, after)) return changes;
  if (entityArray(before) && entityArray(after)) {
    for (let i = 0; i < before.length; i++) {
      const item = before[i];
      if (!after.some((entry) => entry.id === item.id))
        changes.push({
          path: [...path, { id: item.id }],
          before: copy(item),
          beforePresent: true,
          afterPresent: false,
          beforeIndex: i,
        });
    }
    for (let i = 0; i < after.length; i++) {
      const item = after[i];
      const previous = before.find((entry) => entry.id === item.id);
      if (!previous)
        changes.push({
          path: [...path, { id: item.id }],
          after: copy(item),
          beforePresent: false,
          afterPresent: true,
          afterIndex: i,
        });
      else diffBuildingPlanSnapshots(previous, item, [...path, { id: item.id }], changes);
    }
    const commonBefore = before
      .filter((item) => after.some((entry) => entry.id === item.id))
      .map((item) => item.id);
    const commonAfter = after
      .filter((item) => before.some((entry) => entry.id === item.id))
      .map((item) => item.id);
    if (!equalValue(commonBefore, commonAfter))
      changes.push({
        kind: 'order',
        path,
        before: before.map((item) => item.id),
        after: after.map((item) => item.id),
      });
  } else if (object(before) && object(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!own(before, key) || !own(after, key))
        changes.push({
          path: [...path, key],
          before: own(before, key) ? copy(before[key]) : undefined,
          after: own(after, key) ? copy(after[key]) : undefined,
          beforePresent: own(before, key),
          afterPresent: own(after, key),
        });
      else diffBuildingPlanSnapshots(before[key], after[key], [...path, key], changes);
    }
  } else
    changes.push({
      path,
      before: copy(before),
      after: copy(after),
      beforePresent: true,
      afterPresent: true,
    });
  return changes;
}

function locate(root, path) {
  let parent = root;
  for (const part of path.slice(0, -1)) {
    parent =
      typeof part === 'string'
        ? parent?.[part]
        : Array.isArray(parent)
          ? parent.find((entry) => entry.id === part.id)
          : undefined;
    if (!parent || typeof parent !== 'object') return null;
  }
  const part = path.at(-1);
  if (typeof part === 'string')
    return { parent, key: part, present: own(parent, part), value: parent[part] };
  if (!Array.isArray(parent)) return null;
  const key = parent.findIndex((entry) => entry.id === part.id);
  return { parent, key, present: key >= 0, value: key >= 0 ? parent[key] : undefined };
}

function patch(root, change, inverse) {
  if (change.kind === 'order') {
    const entry = locate(root, change.path);
    if (!entry || !Array.isArray(entry.value)) return false;
    const expected = inverse ? change.after : change.before;
    if (
      !equalValue(
        entry.value.map((item) => item.id),
        expected
      )
    )
      return false;
    const order = inverse ? change.before : change.after;
    entry.parent[entry.key] = order.map((id) => entry.value.find((item) => item.id === id));
    return true;
  }
  const entry = locate(root, change.path);
  if (!entry) return false;
  const expectedPresent = inverse ? change.afterPresent : change.beforePresent;
  const expected = inverse ? change.after : change.before;
  if (entry.present !== expectedPresent || (expectedPresent && !equalValue(entry.value, expected)))
    return false;
  const present = inverse ? change.beforePresent : change.afterPresent;
  const value = inverse ? change.before : change.after;
  if (typeof change.path.at(-1) === 'string') {
    if (present) entry.parent[entry.key] = copy(value);
    else delete entry.parent[entry.key];
  } else if (!present) entry.parent.splice(entry.key, 1);
  else if (entry.present) entry.parent[entry.key] = copy(value);
  else entry.parent.splice(inverse ? change.beforeIndex : change.afterIndex, 0, copy(value));
  return true;
}

function applyChanges(snapshot, changes, inverse = false) {
  for (const change of inverse ? [...changes].reverse() : changes)
    if (!patch(snapshot, change, inverse)) return false;
  return true;
}

function validate(snapshot) {
  try {
    return validateBuildingPlanSnapshot(snapshot);
  } catch {
    return [
      planIssue(
        'invalid_snapshot',
        'The building-plan snapshot has malformed subject or geometry data.'
      ),
    ];
  }
}

/**
 * Own immutable candidate operations, accepted history, and nested editor scopes.
 * Hosts own rendering, form lifecycle events, and actual record persistence.
 * @param {{snapshot?: Object, properties?: Object, createId?: () => string, readOnly?: boolean, editingPolicy?: {preserveWallGrouping?: boolean, snapping?: boolean, edgeAutoPan?: boolean}}} [options]
 * @returns {Object} Portable building-plan session.
 */
export function createBuildingPlanSession({
  snapshot = createBuildingPlanSnapshot(),
  properties = {},
  createId = generateUuidV7,
  readOnly = false,
  editingPolicy = {},
} = {}) {
  editingPolicy = normalizeBuildingPlanEditingPolicy(editingPolicy);
  const specifications = copy({ ...BUILDING_PLAN_PROPERTIES, ...properties });
  let current = copy(snapshot);
  let revision = 0;
  let past = [];
  let future = [];
  const proposals = new WeakMap();
  const scopes = new Map();
  const initialIssues = [
    ...reconcileBuildingPlanProperties(current, specifications),
    ...validate(current),
  ];
  if (initialIssues.length) {
    const error = new TypeError(initialIssues[0].message);
    error.issues = initialIssues;
    throw error;
  }
  const response = (status, issues = [], extra = {}) => ({
    status,
    revision,
    issues: copy(issues),
    ...extra,
  });
  const scopeExists = (scopeId) => scopeId == null || scopes.has(scopeId);
  const locked = () =>
    response('blocked', [planIssue('readonly', 'This building plan is read-only.')]);
  const stale = () =>
    response('conflict', [
      planIssue(
        'stale_proposal',
        'The plan or editor changed after this preview. Preview the operation again.'
      ),
    ]);
  const getSnapshot = () => copy(current);

  function preview(operation, { scopeId = null } = {}) {
    if (readOnly) return locked();
    if (!scopeExists(scopeId)) return stale();
    try {
      const { candidate, result } = prepareBuildingPlanEdit(
        current,
        copy(operation),
        (candidate, edit) =>
          applyBuildingPlanOperation(candidate, edit, { createId, specifications, editingPolicy }),
        (candidate) => [
          ...reconcileBuildingPlanProperties(candidate, specifications),
          ...validate(candidate),
        ]
      );

      const changes = diffBuildingPlanSnapshots(current, candidate);
      const proposal = response('ready', [], {
        snapshot: copy(candidate),
        changes: copy(changes),
        ...copy(result),
      });
      proposals.set(proposal, {
        revision,
        candidate,
        operation: copy(operation),
        changes,
        scopeId,
        result,
      });
      return proposal;
    } catch (error) {
      return response('conflict', error.issues || [planIssue('invalid_operation', error.message)]);
    }
  }

  function commit(proposal) {
    if (readOnly) return locked();
    const prepared = proposals.get(proposal);
    if (!prepared || prepared.revision !== revision || !scopeExists(prepared.scopeId))
      return stale();
    proposals.delete(proposal);
    if (prepared.changes.length) {
      current = prepared.candidate;
      past.push({
        changes: prepared.changes,
        operation: prepared.operation,
        scopeId: prepared.scopeId,
      });
      future = [];
      revision++;
    }
    return response('applied', [], {
      snapshot: getSnapshot(),
      changes: copy(prepared.changes),
      ...copy(prepared.result),
    });
  }

  function apply(operation, options) {
    const proposal = preview(operation, options);
    return proposal.status === 'ready' ? commit(proposal) : proposal;
  }

  function beginScope({ id = createId(), parentScopeId = null, subject = null } = {}) {
    if (readOnly) return locked();
    if (typeof id !== 'string' || !id || scopes.has(id) || !scopeExists(parentScopeId))
      return response('conflict', [
        planIssue(
          'invalid_editor_scope',
          'The editor scope must be unique and have an open parent.'
        ),
      ]);
    scopes.set(id, { id, parentScopeId, subject: copy(subject) });
    return response('opened', [], { scopeId: id });
  }

  function descendants(scopeId) {
    const result = new Set([scopeId]);
    for (const scope of scopes.values()) {
      let cursor = scope;
      while (cursor.parentScopeId != null) {
        if (cursor.parentScopeId === scopeId) {
          result.add(scope.id);
          break;
        }
        cursor = scopes.get(cursor.parentScopeId);
      }
    }
    return result;
  }

  function acceptScope(scopeId) {
    if (readOnly) return locked();
    const scope = scopes.get(scopeId);
    if (!scope) return stale();
    if (descendants(scopeId).size > 1)
      return response('blocked', [
        planIssue('open_child_editor', 'Save or cancel the child editor before saving its parent.'),
      ]);
    for (const entry of past) if (entry.scopeId === scopeId) entry.scopeId = scope.parentScopeId;
    scopes.delete(scopeId);
    future = [];
    revision++;
    return response('accepted', [], { snapshot: getSnapshot() });
  }

  function cancelScope(scopeId) {
    if (readOnly) return locked();
    if (!scopes.has(scopeId)) return stale();
    const owned = descendants(scopeId);
    const candidate = copy(current);
    const entries = past.filter((entry) => owned.has(entry.scopeId));
    for (const entry of [...entries].reverse())
      if (!applyChanges(candidate, entry.changes, true))
        return response('conflict', [
          planIssue(
            'dependent_edit',
            'A later independent edit depends on this editor. Resolve that edit before cancelling.'
          ),
        ]);
    const issues = [
      ...reconcileBuildingPlanProperties(candidate, specifications),
      ...validate(candidate),
    ];
    if (issues.length) return response('conflict', issues);
    current = candidate;
    past = past.filter((entry) => !owned.has(entry.scopeId));
    future = [];
    for (const id of owned) scopes.delete(id);
    revision++;
    return response('cancelled', [], { snapshot: getSnapshot() });
  }

  function history(direction, { scopeId = null } = {}) {
    if (readOnly) return locked();
    const source = direction === 'undo' ? past : future;
    const entry = source.at(-1);
    if (!entry) return response('unchanged', [], { snapshot: getSnapshot() });
    if (!scopeExists(scopeId) || entry.scopeId !== scopeId)
      return response('blocked', [
        planIssue(
          'different_editor_scope',
          'Undo and Redo belong to the editor that owns the operation.'
        ),
      ]);
    const candidate = copy(current);
    if (!applyChanges(candidate, entry.changes, direction === 'undo')) return stale();
    const issues = validate(candidate);
    if (issues.length) return response('conflict', issues);
    current = candidate;
    source.pop();
    (direction === 'undo' ? future : past).push(entry);
    revision++;
    return response(direction === 'undo' ? 'undone' : 'redone', [], { snapshot: getSnapshot() });
  }

  return {
    getSnapshot,
    /** Editor preferences affect future proposals, never the accepted record or history. */
    setEditingPolicy(policy) {
      editingPolicy = normalizeBuildingPlanEditingPolicy(policy);
    },
    preview,
    commit,
    apply,
    /** Adopt a validated host draft without manufacturing a gesture or lifecycle event. */
    synchronize(snapshot) {
      const candidate = copy(snapshot);
      const issues = [
        ...reconcileBuildingPlanProperties(candidate, specifications),
        ...validate(candidate),
      ];
      if (issues.length) return response('conflict', issues);
      if (!equalValue(candidate, current)) {
        current = candidate;
        future = [];
        revision++;
      }
      return response('synchronized', [], { snapshot: getSnapshot() });
    },
    beginScope,
    acceptScope,
    cancelScope,
    undo: (options) => history('undo', options),
    redo: (options) => history('redo', options),
    getState: () => ({
      revision,
      readOnly,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      scopes: copy([...scopes.values()]),
    }),
    validate: () => validate(current),
  };
}
