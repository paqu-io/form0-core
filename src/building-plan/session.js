import { prepareBuildingPlanEdit } from './opening-edits.js';
import { generateUuidV7 } from '../utilities/uuid.js';
import { normalizeBuildingPlanEditingPolicy } from './editing-policy.js';
import {
  BUILDING_PLAN_PROPERTIES,
  copyBuildingPlanData as copy,
  createBuildingPlanSnapshot,
  equalValue,
  findBuildingPlanFloor,
  own,
  planIssue,
  reconcileBuildingPlanProperties,
  validateBuildingPlanSnapshot,
} from './model.js';
import { createUIRequestRegistry } from '../utilities/ui-requests.js';
import { reconcileWallLabels } from './wall-labels.js';
import { assignBuildingPlanDefaultNames } from './default-names.js';
import { sharedValueQuestion } from './shared-value-question.js';
import {
  applySharedValueChoice,
  carriedJoinChoices,
  groupSharedValueChoices,
} from './shared-value-choices.js';
import { applyBuildingPlanOperation } from './operations.js';
import { applyOpeningOperation } from './opening-operations.js';
import {
  buildingPlanEditContext,
  reconcileBuildingPlanCandidate,
} from './candidate-reconciliation.js';
import {
  keepingContactThickness,
  keepsContactThickness,
  seatsAttachedRoom,
} from './attachment-seating.js';
import {
  applyDerivedOperation,
  derivedCandidateIssues,
  operationFloorIds,
  rederiveFloor,
  usesDerivedPath,
} from './derive/derived-edit.js';

/**
 * A command on the derived core is prepared again for "Keep previous values": an attached room
 * is seated, and a dragged face or its jogs land, at the walls' current widths.
 */
const reseatsDerivedRoom = (operation) =>
  (operation.type === 'create_room' && operation.attach === true) ||
  (operation.type === 'move_room' && operation.attach !== false) ||
  operation.type === 'resize_face';

const entityArray = (value) =>
  Array.isArray(value) &&
  value.every((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string');
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

/** Identity-based patches survive unrelated row additions and removals. */
export function diffBuildingPlanSnapshots(before, after, path = [], changes = []) {
  if (equalValue(before, after)) return changes;
  if (entityArray(before) && entityArray(after)) {
    // Undo reinserts removals in original order, including adjacent facing/edge entries.
    for (let i = before.length - 1; i >= 0; i--) {
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

/**
 * What stops an editor's edit from being undone on cancel, for hosts to log: the edit, the path
 * of its first change whose value is no longer the one it left, and the edits made since in other
 * editors (none means the value changed outside the history).
 */
function dependentEditDetails(current, past, owned, blocked) {
  const scratch = copy(current);
  const later = past.slice(past.indexOf(blocked) + 1);
  for (const entry of [...later].reverse())
    if (owned.has(entry.scopeId)) applyChanges(scratch, entry.changes, true);
  const change = [...blocked.changes].reverse().find((entry) => !patch(scratch, entry, true));
  return {
    operation: blocked.operation?.type ?? null,
    path: change ? copy(change.path) : null,
    laterEdits: later
      .filter((entry) => !owned.has(entry.scopeId))
      .map((entry) => ({ operation: entry.operation?.type ?? null, scopeId: entry.scopeId })),
  };
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
 * @param {{snapshot?: Object, properties?: Object, createId?: () => string, readOnly?: boolean, derivedCommands?: boolean, editingPolicy?: {inheritedChangePolicy?: 'ask'|'apply', copyCustomAnswersAutomatically?: boolean, snapping?: boolean, edgeAutoPan?: boolean, thicknessAnchor?: 'room_face'|'midline', sharedWallDrag?: 'widen'|'move_wall'}}} [options]
 * @returns {Object} Portable building-plan session.
 */
export function createBuildingPlanSession({
  snapshot = createBuildingPlanSnapshot(),
  properties = {},
  createId = generateUuidV7,
  readOnly = false,
  editingPolicy = {},
  derivedCommands = false,
  locale = 'en',
} = {}) {
  editingPolicy = normalizeBuildingPlanEditingPolicy(editingPolicy);
  // Room commands on the derived core (redesign step 3). Off until every geometry command family
  // runs there: today's engine branches on lineage markers the derived identity rules write
  // differently, so the two engines must not edit geometry on the same floor.
  const derived = (operation) => derivedCommands && usesDerivedPath(operation);
  const specifications = copy({ ...BUILDING_PLAN_PROPERTIES, ...properties });
  let current = copy(snapshot);
  for (const floor of current?.floors || []) reconcileWallLabels(floor);
  let revision = 0;
  let past = [];
  let future = [];
  const proposals = new WeakMap();
  const scopes = new Map();
  const questions = createUIRequestRegistry({ createId });
  let pendingGeneration = 0;
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
      pendingGeneration++;
      questions.cancelAll();
      operation = buildingPlanEditContext(current, copy(operation), editingPolicy);
      let divisions = [],
        defaultConflicts = [],
        derivedIssues = [];
      // Room commands run on the derived core; other operations stay on today's engine.
      const derivedPath = derived(operation);
      const { candidate, result } = prepareBuildingPlanEdit(
        current,
        copy(operation),
        (candidate, edit) => {
          if (!derivedPath)
            return applyBuildingPlanOperation(candidate, edit, {
              createId,
              specifications,
              editingPolicy,
            });
          // Openings a confirmed edit removes first are plain data edits of the candidate; the
          // edit's own write-back reads them.
          if (edit.type === 'remove_opening' && operation.type !== 'remove_opening')
            return applyOpeningOperation(findBuildingPlanFloor(candidate, edit.floorId), edit);
          const applied = applyDerivedOperation(candidate, edit, {
            createId,
            specifications,
            editingPolicy,
          });
          divisions = applied.divisions;
          derivedIssues = applied.issues;
          return applied.result;
        },
        (candidate) => {
          if (derivedPath) {
            const checked = derivedCandidateIssues(current, candidate, operation, derivedIssues);
            defaultConflicts = checked.defaultConflicts;
            return checked.issues;
          }
          const reconciled = reconcileBuildingPlanCandidate(candidate, current, operation, {
            createId,
            specifications,
          });
          divisions = reconciled.divisions;
          defaultConflicts = reconciled.defaultConflicts;
          return reconciled.issues;
        }
      );

      assignBuildingPlanDefaultNames(current, candidate, locale);
      for (const floor of candidate.floors)
        for (const wall of floor.walls) {
          if (
            !wall.lineage?.copiedFromWallId ||
            current.floors.some((entry) => entry.walls.some((old) => old.id === wall.id))
          )
            continue;
          const source = current.floors
            .find((entry) => entry.id === floor.id)
            ?.walls.find((entry) => entry.id === wall.lineage.copiedFromWallId);
          if (source && !divisions.some((entry) => entry.source.id === source.id))
            divisions.push({ source, floorId: floor.id, walls: [wall] });
        }
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
        divisions,
        defaultConflicts,
        generation: pendingGeneration,
      });
      return proposal;
    } catch (error) {
      return response('conflict', error.issues || [planIssue('invalid_operation', error.message)]);
    }
  }

  function transferRequirements(prepared) {
    const affected = [];
    for (const { source, floorId } of prepared.divisions || []) {
      for (const subject of [source, ...(source.sides || [])]) {
        const scope = subject === source ? 'physical_wall' : 'wall_face';
        const explicit = Object.keys(subject.overrides || {}).filter((property) => {
          const spec = Object.values(specifications).find(
            (entry) => entry.scope === scope && (entry.property || property) === property
          );
          return (
            spec &&
            !['wall_thickness', 'wall_height'].includes(property) &&
            spec.on_split !== 'copy'
          );
        });
        const collections = Object.keys(subject.repeatable || {}).filter(
          (name) =>
            subject.repeatable[name]?.length &&
            !Object.values(specifications).some(
              (entry) =>
                entry.kind === 'collection' &&
                entry.scope === scope &&
                entry.property === name &&
                entry.on_split === 'copy'
            )
        );
        if (explicit.length || collections.length)
          affected.push({ floorId, subjectId: subject.id, properties: explicit, collections });
      }
    }
    return affected;
  }

  function inheritedChanges(prepared) {
    const changes = [];
    // A property-only edit is already an explicit request, not an implicit topology transition.
    const types =
      prepared.operation.type === 'batch'
        ? prepared.operation.operations.map((entry) => entry.type)
        : [prepared.operation.type];
    if (
      types.every((type) =>
        ['set_property', 'set_defaults', 'set_provider', 'set_values', 'set_custom_rows'].includes(
          type
        )
      )
    )
      return changes;
    for (const floor of prepared.candidate.floors)
      for (const wall of floor.walls) {
        const previousWalls = current.floors.find((entry) => entry.id === floor.id)?.walls || [];
        const parentIds = [
          wall.id,
          wall.lineage?.dividedFromWallId,
          wall.lineage?.profileSource?.wallId,
          wall.lineage?.copiedFromWallId,
          wall.lineage?.splitFromWallId,
        ];
        const old = parentIds
          .map((id) => previousWalls.find((entry) => entry.id === id))
          .find(Boolean);
        if (!old) continue;
        for (const [property, value] of Object.entries(wall.properties || {})) {
          if (own(wall.overrides, property) || equalValue(value, old.properties[property]))
            continue;
          changes.push({
            floorId: floor.id,
            wallId: wall.id,
            property,
            before: copy(old.properties[property]),
            after: copy(value),
            exposureChanged: wall.exposure !== old.exposure,
          });
        }
      }
    return changes;
  }

  /** `previous`: the candidate before a decision changed its answers (property operations). */
  function reconcilePrepared(prepared, previous = null) {
    try {
      if (derived(prepared.operation)) {
        const writeIssues = [];
        const change = previous && { operation: prepared.operation, previous, current };
        for (const floorId of operationFloorIds(prepared.operation)) {
          const written = rederiveFloor(
            prepared.candidate,
            floorId,
            { createId, specifications, editingPolicy },
            change
          );
          prepared.divisions.push(...written.divisions);
          writeIssues.push(...written.issues);
          if (prepared.result?.carvedRoomIds)
            prepared.result.carvedRoomIds = [
              ...new Set([...prepared.result.carvedRoomIds, ...written.carvedRoomIds]),
            ].sort();
        }
        const checked = derivedCandidateIssues(
          current,
          prepared.candidate,
          prepared.operation,
          writeIssues
        );
        prepared.defaultConflicts = checked.defaultConflicts;
        prepared.changes = diffBuildingPlanSnapshots(current, prepared.candidate);
        return checked.issues;
      }
      const reconciled = reconcileBuildingPlanCandidate(
        prepared.candidate,
        current,
        prepared.operation,
        { createId, specifications }
      );
      prepared.divisions.push(...reconciled.divisions);
      prepared.defaultConflicts = reconciled.defaultConflicts;
      prepared.changes = diffBuildingPlanSnapshots(current, prepared.candidate);
      return reconciled.issues;
    } catch (error) {
      return error.issues || [planIssue('invalid_operation', error.message)];
    }
  }

  function commit(proposal, decision = null) {
    if (readOnly) return locked();
    const prepared = proposals.get(proposal);
    if (!prepared || prepared.revision !== revision || !scopeExists(prepared.scopeId))
      return stale();
    if (prepared.generation !== pendingGeneration) return stale();
    // Values walls give differently: one question per wall summarising them (2026-11-16).
    const [choice] = groupSharedValueChoices(prepared.defaultConflicts || [], prepared.candidate);
    if (choice) {
      if (decision?.startsWith('candidate:')) {
        const before = prepared.defaultConflicts;
        const previous = copy(prepared.candidate);
        if (!applySharedValueChoice(prepared.candidate, choice, Number(decision.slice(10))))
          return stale();
        const issues = reconcilePrepared(prepared, previous);
        if (issues.length) return response('conflict', issues);
        prepared.defaultConflicts.push(
          ...carriedJoinChoices(before, choice, prepared.defaultConflicts, prepared.candidate)
        );
        decision = null;
      } else {
        const question = questions.create(
          {
            ...sharedValueQuestion(choice, prepared.candidate, specifications),
            context: { revision, scopeId: prepared.scopeId },
          },
          (reply) => ({ proposal, reply }),
          () =>
            !readOnly &&
            revision === prepared.revision &&
            pendingGeneration === prepared.generation &&
            scopeExists(prepared.scopeId)
        );
        return response('pending', [], { snapshot: getSnapshot(), uiOperations: [question] });
      }
      if (prepared.defaultConflicts.length) return commit(proposal);
    }
    const transfers = editingPolicy.copyCustomAnswersAutomatically
      ? []
      : transferRequirements(prepared);
    const inherited = inheritedChanges(prepared);
    if (
      !decision &&
      (transfers.length || (editingPolicy.inheritedChangePolicy === 'ask' && inherited.length))
    ) {
      const question = questions.create(
        {
          title: 'Review wall changes',
          message: [
            inherited.length ? `${inherited.length} inherited physical value(s) would change.` : '',
            transfers.length
              ? 'This split copies explicit custom answers and records to the resulting pieces. Confirm that copying is appropriate.'
              : '',
          ]
            .filter(Boolean)
            .join(' '),
          buttons: inherited.length
            ? [
                {
                  id: 'apply',
                  label: 'Use new defaults' + (transfers.length ? ' and copy answers' : ''),
                },
                {
                  id: 'preserve',
                  label: 'Keep previous values' + (transfers.length ? ' and copy answers' : ''),
                },
                { id: 'cancel', label: 'Cancel operation' },
              ]
            : [
                { id: 'apply', label: 'Copy answers' },
                { id: 'cancel', label: 'Cancel operation' },
              ],
          context: { revision, scopeId: prepared.scopeId },
        },
        (reply) => ({ proposal, reply }),
        () =>
          !readOnly &&
          revision === prepared.revision &&
          prepared.generation === pendingGeneration &&
          scopeExists(prepared.scopeId)
      );
      return response('pending', [], { snapshot: getSnapshot(), uiOperations: [question] });
    }
    if (
      decision === 'preserve' &&
      (derived(prepared.operation)
        ? reseatsDerivedRoom(prepared.operation)
        : seatsAttachedRoom(prepared.operation)) &&
      !keepsContactThickness(prepared.operation)
    ) {
      // Keeping previous widths changes where the attached room must sit. Prepare the
      // attachment again instead of refitting rooms that were already in place.
      const replacement = preview(keepingContactThickness(prepared.operation), {
        scopeId: prepared.scopeId,
      });
      return replacement.status === 'ready' ? commit(replacement, 'preserve') : replacement;
    }
    if (decision === 'preserve') {
      for (const change of inherited) {
        // On the derived core a contact the edit formed or broke has the width its geometry
        // gives (prepared again at the current widths); only answers are restored.
        if (
          derived(prepared.operation) &&
          change.property === 'wall_thickness' &&
          change.exposureChanged
        )
          continue;
        const wall = prepared.candidate.floors
          .find((entry) => entry.id === change.floorId)
          .walls.find((entry) => entry.id === change.wallId);
        wall.overrides[change.property] = copy(change.before);
      }
      const issues = reconcilePrepared(prepared);
      if (issues.length) return response('conflict', issues);
      if (prepared.defaultConflicts.length) return commit(proposal);
    }
    proposals.delete(proposal);
    questions.cancelAll();
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
    questions.cancelAll();
    pendingGeneration++;
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
    questions.cancelAll();
    pendingGeneration++;
    future = [];
    revision++;
    return response('accepted', [], { snapshot: getSnapshot() });
  }

  function cancelScope(scopeId) {
    if (readOnly) return locked();
    if (!scopes.has(scopeId)) return stale();
    const owned = descendants(scopeId);
    questions.cancelAll();
    pendingGeneration++;
    const candidate = copy(current);
    const entries = past.filter((entry) => owned.has(entry.scopeId));
    for (const entry of [...entries].reverse())
      if (!applyChanges(candidate, entry.changes, true))
        return response('conflict', [
          planIssue(
            'dependent_edit',
            'A later independent edit depends on this editor. Resolve that edit before cancelling.',
            null,
            dependentEditDetails(current, past, owned, entry)
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
    resolveUIRequest(requestId, responseValue) {
      try {
        const result = questions.resolve(requestId, responseValue);
        if (!result || !result.reply) return stale();
        if (result.reply.cancelled || result.reply.value === 'cancel') {
          proposals.delete(result.proposal);
          return response('unchanged', [], { snapshot: getSnapshot() });
        }
        return commit(result.proposal, result.reply.value);
      } catch (error) {
        return response(
          'conflict',
          error.issues || [planIssue('invalid_ui_response', error.message)]
        );
      }
    },
    isUIRequestCurrent: questions.has,
    cancelUIRequests() {
      questions.cancelAll();
      pendingGeneration++;
    },
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
      for (const floor of candidate.floors || [])
        reconcileWallLabels(
          floor,
          current.floors.find((entry) => entry.id === floor.id)
        );
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
