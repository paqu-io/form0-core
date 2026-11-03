import { normalizeFieldValue } from '../utilities/field-value-normalization.js';
import { generateUuidV7 } from '../utilities/uuid.js';
import { createBuildingPlanSession } from './session.js';
import { copyBuildingPlanData as copy, equalValue, findFace, findRoom, own } from './model.js';
import { roomBounds } from './geometry.js';
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
    if (model.version === 1 && typeof model.id === 'string') return model;
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
  const wallId =
    node.nodeKey === 'physical_walls' ? model.id : node.nodeKey === 'walls' ? model.wallId : null;
  for (const field of node.fields) {
    const binding = field.binding;
    const property = binding?.property;
    const reset = property && resetProperties.includes(property);
    const before = changed.values?.[field.dataName];
    const value = editedRow.values?.[field.dataName];
    const isProperty =
      binding?.role === 'property' ||
      (binding?.role === 'projection' && binding.storageRole === 'property');
    const isDefault = binding?.role === 'default';
    const previousFlags = isDefault
      ? rowModel(node, changed).defaultProperties
      : rowModel(node, changed).overrideProperties;
    const flags = isDefault ? editedModel.defaultProperties : editedModel.overrideProperties;
    const modeChanged =
      (previousFlags || []).includes(property) !== (flags || []).includes(property);
    if (!reset && equalValue(before, value) && !modeChanged) continue;
    if (binding && ['storage', 'geometry', 'derived', 'reference'].includes(binding.role)) continue;
    if (
      binding?.role === 'projection' &&
      binding.storageRole !== 'property' &&
      binding.storageRole !== 'value'
    )
      continue;
    if (field.type === 'CalculatedField') continue;
    if (field.field.read_only === true || target.row.read_only?.[field.dataName] === true) {
      const error = new TypeError('This BuildingPlan field is read-only.');
      error.issues = [
        { code: 'readonly_field', message: error.message, fieldName: field.dataName },
      ];
      throw error;
    }
    if (isProperty || isDefault) {
      const command = {
        type: isDefault ? 'set_defaults' : 'set_property',
        floorId,
        property,
        activeRoomId: roomId,
        ...(isDefault
          ? roomId
            ? { roomId }
            : {}
          : binding.scope === 'room_face'
            ? { faceId: model.id }
            : { wallId }),
      };
      if (reset || (modeChanged && !(flags || []).includes(property))) command.reset = true;
      else command.value = normalizeFieldValue(field.field, value);
      commands.push(command);
    } else plain[field.originalDataName] = normalizeFieldValue(field.field, value);
  }
  if (['doors', 'windows', 'face_doors', 'face_windows'].includes(node.nodeKey)) {
    const collection = node.sourceNode || node.nodeKey;
    const prefix = collection === 'doors' ? 'door' : 'window';
    const floor = readBuildingPlanRecord({ meta, record }).floors.find(
      (entry) => entry.id === floorId
    );
    const wall = floor.walls.find((entry) =>
      entry[collection].some((opening) => opening.id === model.id)
    );
    if (!wall) throw new TypeError('The opening host no longer exists.');
    const opening = wall[collection].find((entry) => entry.id === model.id);
    const command = {
      type: 'update_opening',
      floorId,
      wallId: wall.id,
      openingId: opening.id,
      values: { ...opening.values, ...plain },
    };
    for (const [name, key] of [
      [`${prefix}_width_m`, 'width'],
      [`${prefix}_height_m`, 'height'],
      [`${prefix}_offset_m`, 'offset'],
      ['window_distance_from_floor_m', 'sillHeight'],
    ])
      if (own(plain, name)) command[key] = plain[name];
    commands.push(command);
  } else if (['columns', 'beams', 'objects'].includes(node.nodeKey)) {
    const floor = readBuildingPlanRecord({ meta, record }).floors.find(
      (entry) => entry.id === floorId
    );
    const room = findRoom(floor, roomId);
    const element = room[node.nodeKey].find((entry) => entry.id === model.id);
    const values = { ...element.values, ...plain };
    const bounds = roomBounds(room);
    const shape = { ...element, values };
    if (node.nodeKey === 'columns') {
      shape.position =
        values.column_center_u == null || values.column_center_v == null
          ? null
          : {
              x: bounds.x + values.column_center_u * bounds.width,
              y: bounds.y + values.column_center_v * bounds.height,
            };
      shape.width = values.column_cross_section_width_m;
      shape.height = values.column_cross_section_height_m;
      shape.rotation = values.column_rotation_deg ?? 0;
    } else if (node.nodeKey === 'beams') {
      shape.start =
        values.beam_start_u == null || values.beam_start_v == null
          ? null
          : {
              x: bounds.x + values.beam_start_u * bounds.width,
              y: bounds.y + values.beam_start_v * bounds.height,
            };
      shape.end =
        values.beam_end_u == null || values.beam_end_v == null
          ? null
          : {
              x: bounds.x + values.beam_end_u * bounds.width,
              y: bounds.y + values.beam_end_v * bounds.height,
            };
    }
    commands.push({
      type: 'update_element',
      floorId,
      roomId,
      collection: node.nodeKey,
      elementId: model.id,
      element: shape,
    });
  } else if (node.nodeKey === 'observations' || node.nodeKey === 'face_observations') {
    const floor = readBuildingPlanRecord({ meta, record }).floors.find(
      (entry) => entry.id === floorId
    );
    const previous = floor.observations.find((entry) => entry.id === model.id);
    commands.push({
      type: 'update_observation',
      floorId,
      observationId: model.id,
      values: { ...previous.values, ...plain },
    });
  } else if (Object.keys(plain).length) {
    const physical = Object.fromEntries(
      Object.entries(plain).filter(
        ([name]) => node.fieldsByOriginalDataName[name]?.binding?.role === 'projection'
      )
    );
    const local = Object.fromEntries(
      Object.entries(plain).filter(([name]) => !own(physical, name))
    );
    if (Object.keys(physical).length)
      commands.push({ type: 'set_values', floorId, wallId, values: physical });
    if (Object.keys(local).length)
      commands.push({
        type: 'set_values',
        floorId,
        ...(node.nodeKey === 'rooms'
          ? { roomId: model.id }
          : node.nodeKey === 'walls'
            ? { faceId: model.id }
            : node.nodeKey === 'physical_walls'
              ? { wallId: model.id }
              : {}),
        values: local,
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

/** One adapter for canonical record ownership, editor scopes, and semantic operations. */
export function createBuildingPlanRecordSession({
  record,
  meta: suppliedMeta,
  schema,
  sectionKey,
  createId = generateUuidV7,
  createRowId = generateUuidV7,
  readOnly = false,
}) {
  const meta = getBuildingPlanRecordMetadata({ meta: suppliedMeta, schema, sectionKey });
  let source = copy(record || { values: {}, repeatable: {} });
  let evaluationRequest = 0;
  const session = createBuildingPlanSession({
    snapshot: readBuildingPlanRecord({ meta, record: source }),
    properties: meta.properties,
    createId,
    readOnly,
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
    getRecord: () => copy(source),
    adoptRowMetadata(record) {
      source = writeBuildingPlanRecord({ meta, record, plan: session.getSnapshot(), createRowId });
      return copy(source);
    },
    async evaluate(evaluator, parentValues = {}) {
      const request = ++evaluationRequest;
      const revision = session.getState().revision;
      const result = await evaluator.evaluate({
        ...copy(source),
        values: { ...parentValues, ...source.values },
      });
      if (request !== evaluationRequest || revision !== session.getState().revision)
        return { status: 'stale', issues: [], record: copy(source) };
      const merge = (target, evaluated, node) => {
        for (const field of node?.fields || [])
          if (field.type === 'CalculatedField')
            target.values[field.dataName] = copy(evaluated.values?.[field.dataName] ?? null);
        for (const map of ['errors', 'visible', 'required', 'read_only'])
          if (evaluated[map]) target[map] = copy(evaluated[map]);
        for (const [key, rows] of Object.entries(target.repeatable || {})) {
          const descriptor = meta.repeatables.find((entry) => entry.preferredKey === key);
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
  const managed =
    ['storage', 'geometry', 'derived', 'reference'].includes(binding.role) ||
    ['storage', 'geometry', 'derived', 'reference'].includes(binding.storageRole);
  const floor = plan.floors.find((entry) => entry.id === selected.floorId);
  const room = floor.rooms.find((entry) => entry.id === selected.roomId);
  const property = binding.property;
  const physical = binding.scope === 'physical_wall' && binding.role !== 'default';
  const subject = physical
    ? floor.walls.find((entry) => entry.id === (selected.model.wallId || selected.model.id))
    : binding.role === 'default'
      ? room || floor
      : room?.faces.find((entry) => entry.id === selected.model.id);
  const provenance =
    binding.role === 'default'
      ? {
          scope: own(subject?.defaults, property)
            ? room
              ? 'room'
              : 'floor'
            : own(floor.defaults, property)
              ? 'floor'
              : 'schema',
          mode: own(subject?.defaults, property) ? 'override' : 'inherit',
        }
      : subject?.provenance?.[property];
  return {
    managed,
    scope: binding.scope,
    property,
    inheritable: Boolean(binding.inherit || binding.role === 'default'),
    value: copy(selected.row.values[dataName]),
    source: copy(provenance || null),
    subjectId: subject?.id,
  };
}
