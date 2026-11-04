import { generateUuidV7 } from '../utilities/uuid.js';
import {
  copyBuildingPlanData as copy,
  findBuildingPlanFloor,
  findRoom,
  findWall,
} from './model.js';
import { roomBounds, distance } from './geometry.js';
import { createBuildingPlanRecordSession, resolveBuildingPlanRow } from './transactions.js';

const nodeFor = (meta, key) =>
  meta.repeatables.find((entry) =>
    [entry.preferredKey, entry.dataName, entry.nodeKey].includes(key)
  );
const keyOf = (part) => part.repeatableKey || part.key;

/**
 * Connect normal nested row lifetimes to one floor transaction. Hosts continue to own their
 * engines, validation, lifecycle events, and Save/Cancel controls.
 */
export function createBuildingPlanEditor(options) {
  const createId = options.createId || generateUuidV7;
  const session = createBuildingPlanRecordSession(options);
  const { meta } = session;
  const editors = new Map();
  const listeners = new Set();
  let revision = 0;
  let evaluation = null;
  const publish = (result) => {
    if (result.issues?.length || result.status === 'unchanged') return result;
    if (result.changes && !result.changes.length) return result;
    revision++;
    for (const listener of listeners) listener();
    return result;
  };
  const fail = (message) => {
    throw new TypeError(message);
  };

  const openingEditorConflict = (ids) => {
    const removing = new Set(ids);
    if (!removing.size) return null;
    for (const editor of editors.values()) {
      const target = session.resolveRow(editor.path);
      if (removing.has(target?.model?.id))
        return {
          status: 'conflict',
          record: session.getRecord(),
          issues: [
            {
              code: 'opening_editor_active',
              message:
                'Save or cancel the affected door/window entry, then repeat this move. Its open editor cannot be discarded by another row.',
              subject: { type: target.model.type, id: target.model.id },
            },
          ],
        };
    }
    return null;
  };
  const faceEditorConflict = (snapshot) => {
    const surviving = new Set(
      snapshot.floors.flatMap((floor) =>
        floor.rooms.flatMap((room) => room.faces.map((face) => face.id))
      )
    );
    for (const editor of editors.values()) {
      const target = session.resolveRow(editor.path);
      if (target.faceId && !surviving.has(target.faceId))
        return {
          status: 'conflict',
          record: session.getRecord(),
          issues: [
            {
              code: 'wall_editor_active',
              message:
                'Save or cancel the affected wall entry before rejoining. Its open editor cannot be removed by another row.',
              subject: { type: 'room_face', id: target.faceId },
            },
          ],
        };
    }
    return null;
  };
  const includesRejoin = (operation) =>
    operation?.type === 'rejoin_cut' ||
    (operation?.type === 'batch' && operation.operations?.some(includesRejoin));

  function createOperation(path) {
    const kind = nodeFor(meta, keyOf(path.at(-1)))?.nodeKey;
    if (kind === 'floors') return { type: 'create_floor' };
    const parent = session.resolveRow(path.slice(0, -1));
    const floor = findBuildingPlanFloor(session.getSnapshot(), parent.floorId);
    const base = { floorId: floor.id };
    if (kind === 'rooms') {
      const x = floor.rooms.length
        ? Math.max(
            ...floor.rooms.map((room) => {
              const bounds = roomBounds(room);
              return bounds.x + bounds.width;
            })
          ) + 1
        : 0;
      return { ...base, type: 'create_room', rectangle: { x, y: 0, width: 5, height: 4 } };
    }
    const room = parent.roomId && findRoom(floor, parent.roomId);
    if (kind === 'walls') {
      const bounds = roomBounds(room);
      return {
        ...base,
        type: 'create_wall',
        roomId: room.id,
        vertices: [
          { x: bounds.x + bounds.width * 0.2, y: bounds.y + bounds.height * 0.5 },
          { x: bounds.x + bounds.width * 0.8, y: bounds.y + bounds.height * 0.5 },
        ],
      };
    }
    if (['columns', 'beams', 'objects'].includes(kind)) {
      const bounds = roomBounds(room);
      return {
        ...base,
        type: 'create_element',
        roomId: room.id,
        collection: kind,
        element:
          kind === 'beams'
            ? {
                start: { x: bounds.x + bounds.width / 4, y: bounds.y + bounds.height / 2 },
                end: { x: bounds.x + (bounds.width * 3) / 4, y: bounds.y + bounds.height / 2 },
                width: 0.25,
                height: 0.4,
              }
            : {
                position: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
                width: 0.3,
                height: 0.3,
              },
      };
    }
    if (['doors', 'windows', 'face_doors', 'face_windows'].includes(kind)) {
      const face = parent.faceId && room.faces.find((entry) => entry.id === parent.faceId);
      const wall = findWall(floor, face?.wallId || parent.model.id);
      const binding = face?.bindings[0];
      const segment =
        wall.segments.find((entry) => entry.id === binding?.segmentId) || wall.segments[0];
      const low = binding?.interval[0] || 0;
      const high = binding?.interval[1] ?? distance(segment.start, segment.end);
      const window = kind.endsWith('windows');
      const width = window ? 1.2 : 0.9;
      return {
        ...base,
        type: 'create_opening',
        wallId: wall.id,
        segmentId: segment.id,
        kind: window ? 'window' : 'door',
        offset: low + Math.max(0, (high - low - width) / 2),
        width,
        height: window ? 1.2 : 2,
        sillHeight: window ? 0.9 : null,
      };
    }
    if (['observations', 'face_observations'].includes(kind))
      return {
        ...base,
        type: 'add_observation',
        subject: { type: parent.faceId ? 'room_face' : 'floor', id: parent.faceId || floor.id },
      };
    fail('Create physical walls through a room wall row or the canvas.');
  }

  function openRow({ path, scopeId = createId(), parentScopeId = null, row = null }) {
    const existing = resolveBuildingPlanRow(session.getRecord(), path);
    const opened = session.beginScope({ id: scopeId, parentScopeId, subject: { path } });
    if (opened.status !== 'opened') return opened;
    if (!existing) {
      const operation = createOperation(path);
      const created = session.apply(operation, { scopeId });
      if (created.status !== 'applied') {
        session.cancelScope(scopeId);
        return created;
      }
      const record = session.getRecord();
      const selectedNode = nodeFor(meta, keyOf(path.at(-1)));
      const parent = resolveBuildingPlanRow(record, path.slice(0, -1));
      const selectedId = created.createdFace?.id || created.created.id;
      const storage = selectedNode.fields.find(
        (entry) => entry.binding?.role === 'storage' || entry.binding?.storageRole === 'storage'
      ).dataName;
      const selected = parent.repeatable[selectedNode.preferredKey].find(
        (entry) => JSON.parse(entry.values[storage]).id === selectedId
      );
      if (!selected) fail('The new BuildingPlan row was not materialized.');
      if (row) {
        const { values, repeatable, ...metadata } = copy(row);
        Object.assign(selected, metadata);
        for (const field of selectedNode.fields) {
          if (
            (!field.binding || field.binding.role === 'value') &&
            values?.[field.dataName] != null
          )
            selected.values[field.dataName] = copy(values[field.dataName]);
        }
      }
      session.adoptRowMetadata(record);
    }
    const selected = resolveBuildingPlanRow(session.getRecord(), path);
    if (!selected) {
      session.cancelScope(scopeId);
      fail('The editor path does not identify its new row.');
    }
    // Ordinary editor lifetimes follow row identities when geometry inserts sibling rows.
    let parent = session.getRecord();
    const stablePath = path.map((part) => {
      const row = resolveBuildingPlanRow(parent, [part]);
      parent = row;
      return part.identity === 'position'
        ? copy(part)
        : { ...copy(part), instanceId: row.id ?? row.record_id };
    });
    editors.set(scopeId, { path: stablePath, initialRow: copy(selected) });
    publish(opened);
    return {
      status: 'opened',
      scopeId,
      issues: [],
      record: session.getRecord(),
      row: copy(selected),
    };
  }

  function updateRow(scopeId, row, { resetProperties = [] } = {}) {
    const editor = editors.get(scopeId);
    if (!editor) fail('This BuildingPlan editor has ended.');
    const result = session.applyRow({
      path: editor.path,
      initialRow: editor.initialRow,
      editedRow: row,
      resetProperties,
      scopeId,
    });
    if (result.status === 'applied') {
      const record = session.getRecord();
      const target = resolveBuildingPlanRow(record, editor.path);
      const { values, repeatable, ...metadata } = copy(row);
      Object.assign(target, metadata);
      session.adoptRowMetadata(record);
      result.record = session.getRecord();
      editor.initialRow = copy(resolveBuildingPlanRow(result.record, editor.path));
    }
    return publish(result);
  }

  function close(scopeId, accept) {
    const result = accept ? session.acceptScope(scopeId) : session.cancelScope(scopeId);
    if (result.status === (accept ? 'accepted' : 'cancelled')) {
      editors.delete(scopeId);
      for (const id of [...editors.keys()])
        if (!session.getState().scopes.some((entry) => entry.id === id)) editors.delete(id);
    }
    return publish(result);
  }

  function removeRow(
    path,
    { scopeId = null, allowObservationDeletion = false, preview = false } = {}
  ) {
    const target = session.resolveRow(path);
    const { floorId, roomId, faceId, model, node } = target;
    const base = { floorId, allowObservationDeletion };
    let operation;
    if (node.nodeKey === 'floors') operation = { ...base, type: 'remove_floor' };
    else if (node.nodeKey === 'rooms')
      operation = { ...base, type: 'remove_room', roomId: model.id };
    else if (node.nodeKey === 'walls') operation = { ...base, type: 'remove_face', faceId };
    else if (['columns', 'beams', 'objects'].includes(node.nodeKey))
      operation = {
        ...base,
        type: 'remove_element',
        roomId,
        collection: node.nodeKey,
        elementId: model.id,
      };
    else if (['observations', 'face_observations'].includes(node.nodeKey))
      operation = { ...base, type: 'remove_observation', observationId: model.id };
    else if (['doors', 'windows', 'face_doors', 'face_windows'].includes(node.nodeKey)) {
      const floor = findBuildingPlanFloor(session.getSnapshot(), floorId);
      const wall = floor.walls.find((entry) =>
        [...entry.doors, ...entry.windows].some((opening) => opening.id === model.id)
      );
      operation = { ...base, type: 'remove_opening', wallId: wall.id, openingId: model.id };
    } else fail('Remove this wall through its room relationship.');
    return preview
      ? session.preview(operation, { scopeId })
      : publish(session.apply(operation, { scopeId }));
  }
  return {
    ...session,
    evaluate(evaluator, values = {}) {
      const stamp = session.getState().revision;
      const input = JSON.stringify(values);
      if (
        evaluation?.evaluator === evaluator &&
        evaluation.stamp === stamp &&
        evaluation.input === input
      )
        return evaluation.promise;
      const promise = session
        .evaluate(evaluator, values)
        .then((result) => (result.status === 'evaluated' ? publish(result) : result));
      evaluation = { evaluator, stamp, input, promise };
      return promise;
    },
    apply(operation, options) {
      const conflict = openingEditorConflict(
        Array.isArray(operation?.removeOpeningIds) ? operation.removeOpeningIds : []
      );
      if (conflict) return conflict;
      if (includesRejoin(operation)) {
        const proposal = session.preview(operation, options);
        if (proposal.status !== 'ready') return proposal;
        return faceEditorConflict(proposal.snapshot) || publish(session.commit(proposal));
      }
      return publish(session.apply(operation, options));
    },
    commit(proposal) {
      if (proposal?.snapshot) {
        const faceConflict = faceEditorConflict(proposal.snapshot);
        if (faceConflict) return faceConflict;
        const surviving = new Set(
          proposal.snapshot.floors.flatMap((floor) =>
            floor.walls.flatMap((wall) =>
              [...wall.doors, ...wall.windows].map((opening) => opening.id)
            )
          )
        );
        const removed = session
          .getSnapshot()
          .floors.flatMap((floor) =>
            floor.walls.flatMap((wall) =>
              [...wall.doors, ...wall.windows]
                .filter((opening) => !surviving.has(opening.id))
                .map((opening) => opening.id)
            )
          );
        const conflict = openingEditorConflict(removed);
        if (conflict) return conflict;
      }
      return publish(session.commit(proposal));
    },
    undo: (...args) => publish(session.undo(...args)),
    redo: (...args) => publish(session.redo(...args)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getRevision: () => revision,
    openRow,
    updateRow,
    removeRow,
    acceptRow: (id) => close(id, true),
    cancelRow: (id) => close(id, false),
    hasEditor: (id) => editors.has(id),
  };
}
