import { bandFieldState } from './band-field-state.js';
import { normalizeFieldValue } from '../utilities/field-value-normalization.js';
import { generateUuidV7 } from '../utilities/uuid.js';
import { createBuildingPlanSession } from './session.js';
import { copyBuildingPlanData as copy, equalValue, findFace, findRoom, own } from './model.js';
import { roomBounds } from './geometry.js';
import { wallSide } from './wall-sides.js';
import { storedOpeningEdit } from './opening-sides.js';
import { wallChildForNode } from './wall-children.js';
import { nodeSubjects } from './inheritance.js';
import { sharedWallRooms } from './shared-value-question.js';
import {
  getBuildingPlanRecordMetadata,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from './records.js';

export function resolveBuildingPlanRow(record, path = []) {
  let row = record;
  for (const part of path) {
    const key = part.repeatableKey || part.key;
    const items = row?.repeatable?.[key] || [];
    const id = own(part, 'instanceId') ? part.instanceId : part.id;
    row =
      id != null && part.identity !== 'position'
        ? items.find((entry) => (entry.id ?? entry.record_id) === id)
        : items[part.index];
    if (!row) return null;
  }
  return row;
}

function rowModel(node, row) {
  const field = node.fields.find(
    (entry) => entry.binding?.role === 'storage' || entry.binding?.storageRole === 'storage'
  );
  try {
    const model = JSON.parse(row.values[field.dataName]);
    if (model.version === 2 && typeof model.id === 'string') return model;
  } catch {
    /* Report a typed error at the adapter seam. */
  }
  throw new TypeError('The selected BuildingPlan row has no valid model identity.');
}

function viewNode(meta, key) {
  const node = meta.repeatables.find((entry) =>
    [entry.preferredKey, entry.dataName, entry.nodeKey].includes(key)
  );
  if (!node) throw new TypeError('The selected row does not belong to this BuildingPlanSection.');
  return node;
}

function selection(meta, record, path) {
  const part = path.at(-1);
  const node = viewNode(meta, part?.repeatableKey || part?.key);
  const row = resolveBuildingPlanRow(record, path);
  if (!row) throw new TypeError('The BuildingPlan editor row no longer exists.');
  let floor = null,
    room = null,
    face = null;
  for (let depth = 1; depth <= path.length; depth++) {
    const current = resolveBuildingPlanRow(record, path.slice(0, depth));
    const info = viewNode(meta, path[depth - 1].repeatableKey || path[depth - 1].key);
    if (info.nodeKey === 'floors') floor = rowModel(info, current);
    if (info.nodeKey === 'rooms') room = rowModel(info, current);
    if (info.nodeKey === 'walls') face = rowModel(info, current);
  }
  if (!floor) throw new TypeError('Open the owning floor editor before editing its elements.');
  return {
    node,
    row,
    model: rowModel(node, row),
    floorId: floor.id,
    roomId: room?.id,
    faceId: face?.id,
  };
}

/** Convert only this editor's declared writes to semantic operations. */
export function buildingPlanOperationsForRow({
  meta,
  record,
  path,
  editedRow,
  initialRow,
  resetProperties = [],
}) {
  const target = selection(meta, record, path);
  const { node, model, floorId, roomId, faceId } = target;
  const changed = initialRow || target.row;
  const editedModel = rowModel(node, editedRow);
  if (editedModel.id !== model.id)
    throw new TypeError('An editor cannot replace its BuildingPlan subject identity.');
  const commands = [];
  const plain = {};
  // A wall child's value reset (a band row's own value, bands unit 3) is sent as a reset.
  const resetPlain = new Set();
  const wallId =
    node.nodeKey === 'physical_walls' ? model.id : node.nodeKey === 'walls' ? model.wallId : null;
  for (const field of node.fields) {
    const binding = field.binding;
    const property = binding?.property;
    const reset =
      resetProperties.includes(field.dataName) ||
      (property && resetProperties.includes(property) && !binding.outside);
    const before = changed.values?.[field.dataName];
    const value = editedRow.values?.[field.dataName];
    const isProperty =
      binding?.role === 'property' ||
      (binding?.role === 'projection' && binding.storageRole === 'property');
    const isDefault = binding?.role === 'default';
    const isProvider = binding?.role === 'provider';
    const previousFlags = isDefault
      ? rowModel(node, changed).defaultProperties
      : rowModel(node, changed).overrideProperties;
    const flags = isDefault ? editedModel.defaultProperties : editedModel.overrideProperties;
    const modeChanged =
      (previousFlags || []).includes(property) !== (flags || []).includes(property);
    if (
      !reset &&
      !modeChanged &&
      equalValue(normalizeFieldValue(field.field, before), normalizeFieldValue(field.field, value))
    )
      continue;
    if (binding && ['storage', 'geometry', 'derived', 'reference'].includes(binding.role)) continue;
    if (
      binding?.role === 'projection' &&
      binding.storageRole !== 'property' &&
      binding.storageRole !== 'value'
    )
      continue;
    if (['CalculatedField', 'RepeatableSection'].includes(field.type)) continue;
    if (field.field.read_only === true || target.row.read_only?.[field.dataName] === true) {
      const error = new TypeError('This BuildingPlan field is read-only.');
      error.issues = [
        { code: 'readonly_field', message: error.message, fieldName: field.dataName },
      ];
      throw error;
    }
    if (isProperty || isDefault || isProvider) {
      const command = {
        type: isProvider ? 'set_provider' : isDefault ? 'set_defaults' : 'set_property',
        floorId,
        property,
        activeRoomId: roomId,
        nodeKey: ['walls', 'physical_walls', 'wall_sides'].includes(node.nodeKey)
          ? 'walls'
          : node.sourceNode || node.nodeKey,
        scope: binding.scope,
        outside: binding.outside === true,
        ...(isProvider ? { fieldName: field.originalDataName } : {}),
        ...(node.nodeKey === 'walls'
          ? { faceId: model.id, wallId }
          : node.nodeKey === 'physical_walls'
            ? { wallId }
            : node.nodeKey === 'rooms'
              ? { roomId: model.id, elementId: model.id }
              : { roomId, elementId: model.id }),
      };
      if (reset || (modeChanged && !(flags || []).includes(property))) command.reset = true;
      else command.value = normalizeFieldValue(field.field, value);
      commands.push(command);
    } else if (reset && wallChildForNode(node.nodeKey)) resetPlain.add(field.originalDataName);
    else plain[field.originalDataName] = normalizeFieldValue(field.field, value);
  }
  const child = wallChildForNode(node.nodeKey);
  if (child) {
    const floor = readBuildingPlanRecord({ meta, record }).floors.find(
      (entry) => entry.id === floorId
    );
    const wall = floor.walls.find((entry) =>
      (entry[child.list] || []).some((opening) => opening.id === model.id)
    );
    if (!wall) throw new TypeError('The opening host no longer exists.');
    const opening = wall[child.list].find((entry) => entry.id === model.id);
    const command = {
      type: 'update_opening',
      floorId,
      wallId: wall.id,
      openingId: opening.id,
      values: { ...opening.values, ...plain },
    };
    for (const [name, key] of child.fields) if (own(plain, name)) command[key] = plain[name];
    const reset = child.fields.filter(([name]) => resetPlain.has(name)).map(([, key]) => key);
    if (reset.length) command.reset = reset;
    // WB3: a room on the segment's side -1 typed its distance from its own left end.
    const face = floor.rooms.flatMap((entry) => entry.faces).find((entry) => entry.id === faceId);
    commands.push(storedOpeningEdit(command, { opening, face, segments: wall.segments }));
  } else if (['columns', 'beams', 'objects'].includes(node.nodeKey)) {
    const floor = readBuildingPlanRecord({ meta, record }).floors.find(
      (entry) => entry.id === floorId
    );
    const room = findRoom(floor, roomId);
    const element = room[node.nodeKey].find((entry) => entry.id === model.id);
    const values = { ...element.values, ...plain };
    const bounds = roomBounds(room);
    const shape = { ...element, values };
    // The position fields are geometry, not plain values: an edit without them (a typed width)
    // keeps the element where it is.
    const point = (uName, vName, current) =>
      values[uName] == null || values[vName] == null
        ? (current ?? null)
        : {
            x: bounds.x + values[uName] * bounds.width,
            y: bounds.y + values[vName] * bounds.height,
          };
    if (node.nodeKey === 'columns') {
      shape.position = point('column_center_u', 'column_center_v', element.position);
      shape.width = values.column_width;
      shape.height = values.column_depth;
      shape.rotation = values.column_rotation_deg ?? 0;
    } else if (node.nodeKey === 'beams') {
      shape.start = point('beam_start_u', 'beam_start_v', element.start);
      shape.end = point('beam_end_u', 'beam_end_v', element.end);
      shape.width = values.beam_width;
      shape.height = values.beam_depth;
    }
    commands.push({
      type: 'update_element',
      floorId,
      roomId,
      collection: node.nodeKey,
      elementId: model.id,
      element: shape,
    });
  } else if (Object.keys(plain).length) {
    const grouped = new Map();
    for (const [name, value] of Object.entries(plain)) {
      const binding = node.fieldsByOriginalDataName[name]?.binding;
      const scope = binding?.scope || 'node';
      const key = `${scope}:${binding?.outside === true}`;
      if (!grouped.has(key)) grouped.set(key, { binding, values: {} });
      grouped.get(key).values[name] = value;
    }
    for (const { binding, values } of grouped.values())
      commands.push({
        type: 'set_values',
        floorId,
        nodeKey: node.sourceNode || node.nodeKey,
        elementId: model.id,
        roomId: node.nodeKey === 'rooms' ? model.id : roomId,
        wallId,
        faceId: node.nodeKey === 'walls' ? model.id : undefined,
        scope: binding?.scope,
        outside: binding?.outside,
        values,
      });
  }
  for (const field of node.fields.filter((entry) => entry.type === 'RepeatableSection')) {
    const before = changed.repeatable?.[field.preferredKey] || [],
      after = editedRow.repeatable?.[field.preferredKey] || [];
    if (equalValue(before, after)) continue;
    const convert = (entries, row) => ({
      ...copy(row),
      values: Object.fromEntries(
        entries
          .filter((entry) => entry.type !== 'RepeatableSection' && entry.type !== 'CalculatedField')
          .map((entry) => [entry.originalDataName, copy(row.values?.[entry.dataName] ?? null)])
      ),
      repeatable: Object.fromEntries(
        entries
          .filter((entry) => entry.type === 'RepeatableSection')
          .map((entry) => [
            entry.originalDataName,
            (row.repeatable?.[entry.preferredKey] || []).map((row) =>
              convert(entry.children || [], row)
            ),
          ])
      ),
    });
    const binding = field.binding;
    const plan = readBuildingPlanRecord({ meta, record });
    const floor = plan.floors.find((entry) => entry.id === floorId);
    const wall = wallId && floor.walls.find((entry) => entry.id === wallId);
    const subject =
      node.nodeKey === 'walls'
        ? binding?.scope === 'physical_wall'
          ? wall
          : wallSide(floor, findFace(floor, model.id).face, binding?.outside)
        : node.nodeKey === 'physical_walls'
          ? wall
          : nodeSubjects(floor, node.nodeKey).find((entry) => entry.subject.id === model.id)
              ?.subject;
    commands.push({
      type: 'set_custom_rows',
      floorId,
      nodeKey: node.nodeKey,
      elementId: model.id,
      roomId,
      wallId,
      faceId: node.nodeKey === 'walls' ? model.id : undefined,
      scope: binding?.scope,
      outside: binding?.outside,
      repeatable: {
        ...subject?.repeatable,
        [binding?.sourceOriginalDataName || field.originalDataName]: after.map((row) =>
          convert(field.children || [], row)
        ),
      },
    });
  }
  return {
    type: 'batch',
    operations: commands,
    activeRoomId: roomId,
    subject: { nodeKey: node.nodeKey, id: model.id },
    floorId,
    faceId,
  };
}

/**
 * One adapter for canonical record ownership, editor scopes, and semantic operations.
 * `derivedCommands` runs the geometry commands on the derived core (redesign step 3; until the
 * switch, hosts turn it on for testing).
 */
export function createBuildingPlanRecordSession({
  record,
  meta: suppliedMeta,
  schema,
  sectionKey,
  createId = generateUuidV7,
  createRowId = generateUuidV7,
  readOnly = false,
  editingPolicy = {},
  derivedCommands = false,
  locale = 'en',
}) {
  const meta = getBuildingPlanRecordMetadata({ meta: suppliedMeta, schema, sectionKey });
  let source = copy(record || { values: {}, repeatable: {} });
  let evaluationRequest = 0;
  const session = createBuildingPlanSession({
    snapshot: readBuildingPlanRecord({ meta, record: source }),
    properties: meta.properties,
    createId,
    readOnly,
    editingPolicy,
    derivedCommands,
    locale,
  });
  source = writeBuildingPlanRecord({
    meta,
    record: source,
    plan: session.getSnapshot(),
    createRowId,
  });
  const materialize = (result) => {
    if (['applied', 'accepted', 'cancelled', 'undone', 'redone'].includes(result.status))
      source = writeBuildingPlanRecord({
        meta,
        record: source,
        plan: session.getSnapshot(),
        createRowId,
      });
    return { ...result, record: copy(source) };
  };
  const apply = (operation, options) => materialize(session.apply(operation, options));
  const rowOperation = (options, preview) => {
    try {
      const operation = buildingPlanOperationsForRow({ ...options, meta, record: source });
      return preview
        ? session.preview(operation, { scopeId: options.scopeId })
        : apply(operation, { scopeId: options.scopeId });
    } catch (error) {
      return {
        status: 'conflict',
        issues: error.issues || [{ code: 'invalid_row_write', message: error.message }],
        record: copy(source),
      };
    }
  };
  return {
    meta,
    getSnapshot: session.getSnapshot,
    resolveUIRequest: (id, response) => materialize(session.resolveUIRequest(id, response)),
    cancelUIRequests: session.cancelUIRequests,
    isUIRequestCurrent: session.isUIRequestCurrent,
    setEditingPolicy: session.setEditingPolicy,
    getRecord: () => copy(source),
    adoptRowMetadata(record) {
      source = writeBuildingPlanRecord({ meta, record, plan: session.getSnapshot(), createRowId });
      return copy(source);
    },
    async evaluate(evaluator, parentValues = {}) {
      const request = ++evaluationRequest;
      const revision = session.getState().revision;
      const result = await evaluator.evaluate(
        {
          ...copy(source),
          values: { ...parentValues, ...source.values },
        },
        { mode: 'refresh' }
      );
      if (request !== evaluationRequest || revision !== session.getState().revision)
        return { status: 'stale', issues: [], record: copy(source) };
      const merge = (target, evaluated, node) => {
        for (const field of node?.fields || [])
          if (field.type === 'CalculatedField')
            target.values[field.dataName] = copy(evaluated.values?.[field.dataName] ?? null);
        for (const map of ['errors', 'visible', 'required', 'read_only'])
          if (evaluated[map]) target[map] = copy(evaluated[map]);
        for (const [key, rows] of Object.entries(target.repeatable || {})) {
          const descriptor =
            meta.repeatables.find((entry) => entry.preferredKey === key) ||
            (() => {
              const entry = node?.fields?.find(
                (field) => field.type === 'RepeatableSection' && field.preferredKey === key
              );
              return entry ? { fields: entry.children } : null;
            })();
          for (const row of rows) {
            const match = evaluated.repeatable?.[key]?.find(
              (entry) => (entry.id ?? entry.record_id) === (row.id ?? row.record_id)
            );
            if (match) merge(row, match, descriptor);
          }
        }
      };
      merge(source, result.snapshot, null);
      return { status: 'evaluated', issues: [], record: copy(source) };
    },
    getState: session.getState,
    synchronize(record) {
      const result = session.synchronize(readBuildingPlanRecord({ meta, record }));
      if (result.status === 'synchronized') source = copy(record);
      return { ...result, record: copy(source) };
    },
    preview: session.preview,
    commit: (proposal) => materialize(session.commit(proposal)),
    apply,
    beginScope: session.beginScope,
    acceptScope: (id) => materialize(session.acceptScope(id)),
    cancelScope: (id) => materialize(session.cancelScope(id)),
    undo: (options) => materialize(session.undo(options)),
    redo: (options) => materialize(session.redo(options)),
    previewRow: (options) => rowOperation(options, true),
    applyRow: (options) => rowOperation(options, false),
    resolveRow: (path) => selection(meta, source, path),
    fieldState: (path, dataName) =>
      getBuildingPlanFieldState(meta, source, session.getSnapshot(), path, dataName),
  };
}

/** Display ownership without altering schema visibility or record storage. */
export function getBuildingPlanFieldState(meta, record, plan, path, dataName) {
  const selected = selection(meta, record, path);
  const field = selected.node.fields.find((entry) => entry.dataName === dataName);
  const binding = field?.binding;
  if (!binding) return null;
  const band = bandFieldState(plan, selected, field);
  if (band) return band;
  const managed =
    ['storage', 'geometry', 'derived', 'reference'].includes(binding.role) ||
    ['storage', 'geometry', 'derived', 'reference'].includes(binding.storageRole);
  const floor = plan.floors.find((entry) => entry.id === selected.floorId);
  const room = floor.rooms.find((entry) => entry.id === selected.roomId);
  const property = binding.property;
  const physical = binding.scope === 'physical_wall' && binding.role !== 'provider';
  const wall = floor.walls.find(
    (entry) => entry.id === (selected.model.wallId || selected.model.id)
  );
  const subject = physical
    ? wall
    : binding.scope === 'wall_face'
      ? wallSide(floor, findFace(floor, selected.model.id).face, binding.outside)
      : nodeSubjects(floor, selected.node.nodeKey).find(
          (entry) => entry.subject.id === selected.model.id
        )?.subject;
  // A system provider that is also its row's own inherited property (the room's structural clear
  // height, inherited from the floor and passed on to walls and columns) shows that property's
  // ownership, so the row says where the value comes from and offers "Reset to inheritance".
  const ownProperty =
    binding.system &&
    binding.role === 'provider' &&
    Object.values(meta.properties).some(
      (spec) =>
        spec.nodeKey === selected.node.nodeKey &&
        spec.property === field.originalDataName &&
        spec.inherit !== false
    );
  const source = ownProperty
    ? subject?.provenance?.[field.originalDataName]
    : binding.role === 'provider'
      ? {
          scope: selected.node.nodeKey,
          mode: own(subject?.providerOverrides, field.originalDataName) ? 'override' : 'inherit',
        }
      : subject?.provenance?.[property];
  const hidden = binding.system && binding.role === 'provider' && !ownProperty;
  return {
    managed,
    dataName,
    scope: binding.scope,
    property: ownProperty ? field.originalDataName : property,
    inheritable:
      !hidden &&
      Boolean(binding.inherit || binding.role === 'provider' || binding.role === 'default'),
    value: copy(selected.row.values[dataName]),
    source: hidden ? null : copy(source || null),
    subjectId: subject?.id,
    outside: binding.outside === true && Boolean(subject) && subject.roomId == null,
    opposite: binding.outside === true && Boolean(subject?.roomId),
    applicable: binding.outside ? Boolean(subject) : true,
    // A whole-wall field of a wall other rooms share: those rooms, named (2026-11-23).
    sharedWith: physical && wall ? sharedWallRooms(floor, wall, selected.roomId) : [],
  };
}
