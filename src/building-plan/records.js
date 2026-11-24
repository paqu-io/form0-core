import { providerApplies } from './inheritance.js';
import { reconcileWallLabels } from './wall-labels.js';
import { generateUuidV7 } from '../utilities/uuid.js';
import { expandBuildingPlanSchema } from '../schema/building-plan-expander.js';
import { getBuildingPlanMetadata } from './metadata.js';
import {
  copyBuildingPlanData as copy,
  createBuildingPlanSnapshot,
  own,
  reconcileBuildingPlanProperties,
  validateBuildingPlanSnapshot,
} from './model.js';
import { at, distance, project, segmentFrame, roomBounds } from './geometry.js';
import { faceSeesSegmentReversed, offsetSeenFrom } from './opening-sides.js';

const metadataFor = (options) => {
  if (options.meta) return options.meta;
  const metas = getBuildingPlanMetadata(expandBuildingPlanSchema(options.schema).schema);
  const meta = options.sectionKey
    ? metas.find((entry) => [entry.key, entry.dataName].includes(options.sectionKey))
    : metas.length === 1
      ? metas[0]
      : null;
  if (!meta) throw new TypeError('Select one BuildingPlanSection using sectionKey.');
  return meta;
};
const nodeFor = (meta, node) => meta.repeatablesByNodeKey[node];
const keyFor = (meta, node) => nodeFor(meta, node).preferredKey;
const fieldFor = (meta, node, name) =>
  nodeFor(meta, node).fieldsByOriginalDataName?.[name]?.dataName;
const read = (meta, node, row, name) => row.values?.[fieldFor(meta, node, name)];
const write = (meta, node, row, name, value) => {
  const key = fieldFor(meta, node, name);
  if (key) row.values[key] = copy(value);
};
const rows = (meta, node, parent) => parent.repeatable?.[keyFor(meta, node)] || [];

function ownerRecords(meta, record, result = []) {
  if (own(record?.repeatable, keyFor(meta, 'floors'))) result.push(record);
  for (const list of Object.values(record?.repeatable || {}))
    for (const child of Array.isArray(list) ? list : []) ownerRecords(meta, child, result);
  return result;
}

function decode(value, name) {
  let result;
  try {
    result = typeof value === 'string' ? JSON.parse(value) : null;
  } catch {
    throw new TypeError(`Invalid BuildingPlan ${name} JSON.`);
  }
  if (!result || result.version !== 2 || typeof result.id !== 'string')
    throw new TypeError(
      `BuildingPlan ${name} requires a versioned model identity. Existing development payloads are not migrated.`
    );
  return result;
}

function geometry(value, name) {
  let result;
  try {
    result = typeof value === 'string' ? JSON.parse(value) : null;
  } catch {
    throw new TypeError(`Invalid BuildingPlan ${name} geometry JSON.`);
  }
  if (!result || result.version !== 2 || result.unit !== 'meters')
    throw new TypeError(`BuildingPlan ${name} requires versioned metric geometry.`);
  return result;
}

const encode = (value) => JSON.stringify({ version: 2, ...value });
function modelOf(meta, node, row) {
  const storage = nodeFor(meta, node).fields.find((entry) => entry.binding?.role === 'storage');
  return decode(row.values?.[storage.dataName], node);
}

function plainValues(meta, node, row) {
  const result = {};
  for (const entry of nodeFor(meta, node).fields || []) {
    if (entry.type === 'CalculatedField') continue;
    if (entry.binding && !['value', 'calculation', 'provider'].includes(entry.binding.role))
      continue;
    if (own(row.values, entry.dataName))
      result[entry.originalDataName] = copy(row.values[entry.dataName]);
  }
  return result;
}

function readDefaults(meta, node, row, model) {
  const result = copy(model.defaultValues || {});
  for (const entry of nodeFor(meta, node).fields.filter(
    (field) => field.binding?.role === 'default'
  ))
    if (model.defaultProperties?.includes(entry.binding.property))
      result[entry.binding.property] = copy(row.values[entry.dataName]);
  return result;
}

function readProviders(meta, node, row, model) {
  const result = {};
  for (const name of model.providerProperties || []) {
    const field = nodeFor(meta, node).fieldsByOriginalDataName[name];
    if (!field || field.binding?.role !== 'provider')
      throw new TypeError('BuildingPlan provider metadata must reference declared source fields.');
    result[name] = copy(row.values?.[field.dataName] ?? null);
  }
  return result;
}

function readOverrides(meta, node, row, model) {
  const result = {};
  for (const entry of nodeFor(meta, node).fields.filter(
    (field) => field.binding?.role === 'property'
  ))
    if (model.overrideProperties?.includes(entry.binding.property))
      result[entry.binding.property] = copy(row.values[entry.dataName]);
  return result;
}

const intent = (subject) => ({
  overrideProperties: Object.keys(subject.overrides || {}),
  providerProperties: Object.keys(subject.providerOverrides || {}),
});
function unpackCustom(entries, row) {
  const target = { ...copy(row), values: {}, repeatable: {} };
  for (const entry of entries) {
    if (entry.type === 'RepeatableSection')
      target.repeatable[entry.originalDataName] = (row.repeatable?.[entry.preferredKey] || []).map(
        (child) => unpackCustom(entry.children || [], child)
      );
    else if (own(row.values, entry.dataName))
      target.values[entry.originalDataName] = copy(row.values[entry.dataName]);
  }
  return target;
}
function packCustom(entries, row) {
  const target = { ...copy(row), values: {}, repeatable: {} };
  for (const entry of entries) {
    if (entry.type === 'RepeatableSection')
      target.repeatable[entry.preferredKey] = (row.repeatable?.[entry.originalDataName] || []).map(
        (child) => packCustom(entry.children || [], child)
      );
    else
      target.values[entry.dataName] = copy(
        row.values?.[entry.originalDataName] ?? entry.field.default_value ?? null
      );
  }
  return target;
}
function readCustom(meta, node, row) {
  return Object.fromEntries(
    nodeFor(meta, node)
      .fields.filter(
        (entry) => entry.type === 'RepeatableSection' && entry.binding?.role !== 'projection'
      )
      .map((entry) => [
        entry.originalDataName,
        (row.repeatable?.[entry.preferredKey] || []).map((child) =>
          unpackCustom(entry.children || [], child)
        ),
      ])
  );
}
function writeCustom(meta, node, row, subject) {
  row.repeatable ||= {};
  for (const entry of nodeFor(meta, node).fields.filter(
    (entry) => entry.type === 'RepeatableSection' && entry.binding?.role !== 'projection'
  ))
    row.repeatable[entry.preferredKey] = (subject.repeatable?.[entry.originalDataName] || []).map(
      (child) => packCustom(entry.children || [], child)
    );
}

/** Read the canonical floor-owned physical records, never the room-side mirrors. */
export function readBuildingPlanRecord(options) {
  const meta = metadataFor(options);
  const record = options.record || {};
  const snapshot = createBuildingPlanSnapshot();
  for (const row of rows(meta, 'floors', record)) {
    const model = modelOf(meta, 'floors', row);
    const floor = {
      id: model.id,
      values: plainValues(meta, 'floors', row),
      overrides: readOverrides(meta, 'floors', row, model),
      providerOverrides: readProviders(meta, 'floors', row, model),
      repeatable: readCustom(meta, 'floors', row),
      defaults: readDefaults(meta, 'floors', row, model),
      rooms: [],
      walls: [],
    };
    snapshot.floors.push(floor);
    for (const wallRow of rows(meta, 'physical_walls', row)) {
      const state = modelOf(meta, 'physical_walls', wallRow);
      const shape = geometry(read(meta, 'physical_walls', wallRow, 'wall_geometry'), 'wall');
      const wall = {
        id: state.id,
        ...(state.autoLabel ? { autoLabel: state.autoLabel } : {}),
        referenceFaceId: state.referenceFaceId,
        providerOverrides: readProviders(meta, 'physical_walls', wallRow, state),
        segments: copy(shape.segments),
        overrides: readOverrides(meta, 'physical_walls', wallRow, state),
        properties: {},
        provenance: {},
        values: plainValues(meta, 'physical_walls', wallRow),
        doors: [],
        windows: [],
      };
      if (state.autoLabel != null && wall.values.wall_label === state.autoLabel)
        delete wall.values.wall_label;
      if (state.lineage) wall.lineage = copy(state.lineage);
      // Properties whose own value the shared-value question chose (released on detach).
      if (state.sharedChoices?.length) wall.sharedChoices = copy(state.sharedChoices);
      wall.repeatable = readCustom(meta, 'physical_walls', wallRow);
      wall.sides = rows(meta, 'wall_sides', wallRow).map((sideRow) => {
        const side = modelOf(meta, 'wall_sides', sideRow);
        const sideIdentity = { id: side.id, sign: side.sign, roomId: side.roomId };
        return {
          ...sideIdentity,
          overrides: readOverrides(meta, 'wall_sides', sideRow, side),
          values: plainValues(meta, 'wall_sides', sideRow),
          properties: {},
          provenance: {},
          repeatable: readCustom(meta, 'wall_sides', sideRow),
        };
      });
      wall.exposure = wall.sides.every((side) => side.roomId) ? 'interior' : 'exterior';
      floor.walls.push(wall);
      for (const collection of ['doors', 'windows'])
        for (const openingRow of rows(meta, collection, wallRow)) {
          const state = modelOf(meta, collection, openingRow);
          const prefix = collection === 'doors' ? 'door' : 'window';
          wall[collection].push({
            id: state.id,
            type: prefix,
            segmentId: state.segmentId,
            offset: read(meta, collection, openingRow, `${prefix}_offset`),
            width: read(meta, collection, openingRow, `${prefix}_width`),
            height: read(meta, collection, openingRow, `${prefix}_height`),
            sillHeight:
              collection === 'windows'
                ? read(meta, collection, openingRow, 'window_distance_from_floor')
                : null,
            values: plainValues(meta, collection, openingRow),
            overrides: readOverrides(meta, collection, openingRow, state),
            providerOverrides: readProviders(meta, collection, openingRow, state),
            repeatable: readCustom(meta, collection, openingRow),
            ...(state.provenance ? { provenance: copy(state.provenance) } : {}),
          });
        }
    }
    for (const roomRow of rows(meta, 'rooms', row)) {
      const state = modelOf(meta, 'rooms', roomRow);
      const shape = geometry(read(meta, 'rooms', roomRow, 'room_vertices'), 'room');
      const room = {
        id: state.id,
        vertices: copy(shape.vertices),
        edges: copy(state.edges),
        defaults: readDefaults(meta, 'rooms', roomRow, state),
        values: plainValues(meta, 'rooms', roomRow),
        overrides: readOverrides(meta, 'rooms', roomRow, state),
        providerOverrides: readProviders(meta, 'rooms', roomRow, state),
        repeatable: readCustom(meta, 'rooms', roomRow),
        faces: [],
        columns: [],
        beams: [],
        objects: [],
      };
      floor.rooms.push(room);
      for (const faceRow of rows(meta, 'walls', roomRow)) {
        const state = modelOf(meta, 'walls', faceRow);
        const face = {
          id: state.id,
          wallId: state.wallId,
          sideId: state.sideId,
          bindings: copy(state.bindings),
          overrides: readOverrides(meta, 'walls', faceRow, state),
          values: plainValues(meta, 'walls', faceRow),
        };
        for (const key of ['edgeIds', 'freePath', 'freeEdges', 'lineage'])
          if (state[key]) face[key] = copy(state[key]);
        room.faces.push(face);
      }
      for (const collection of ['columns', 'beams', 'objects'])
        for (const elementRow of rows(meta, collection, roomRow)) {
          const state = modelOf(meta, collection, elementRow);
          room[collection].push({
            ...copy(state),
            values: plainValues(meta, collection, elementRow),
            overrides: readOverrides(meta, collection, elementRow, state),
            repeatable: readCustom(meta, collection, elementRow),
          });
          const element = room[collection].at(-1);
          delete element.version;
          delete element.overrideProperties;
          delete element.providerProperties;
          delete element.defaultProperties;
          const bounds = roomBounds(room);
          const location = (uName, vName) => {
            const u = read(meta, collection, elementRow, uName),
              v = read(meta, collection, elementRow, vName);
            if (u == null || v == null) {
              // Preserve a partially captured coordinate without inventing the other axis.
              if (u != null) element.values[uName] = copy(u);
              if (v != null) element.values[vName] = copy(v);
              return null;
            }
            return { x: bounds.x + u * bounds.width, y: bounds.y + v * bounds.height };
          };
          if (collection === 'columns') {
            element.position = location('column_center_u', 'column_center_v');
            element.width = read(meta, collection, elementRow, 'column_width');
            element.height = read(meta, collection, elementRow, 'column_depth');
          } else if (collection === 'beams') {
            element.start = location('beam_start_u', 'beam_start_v');
            element.end = location('beam_end_u', 'beam_end_v');
            element.width = read(meta, collection, elementRow, 'beam_width');
            element.height = read(meta, collection, elementRow, 'beam_depth');
          }
        }
    }
  }
  const issues = [
    ...reconcileBuildingPlanProperties(snapshot, meta.properties),
    ...validateBuildingPlanSnapshot(snapshot),
  ];
  if (issues.length) {
    const error = new TypeError(issues[0].message);
    error.issues = issues;
    throw error;
  }
  return snapshot;
}

function previousBySubject(meta, node, parent) {
  return new Map(
    rows(meta, node, parent).map((row) => {
      try {
        return [modelOf(meta, node, row).id, row];
      } catch {
        return [null, row];
      }
    })
  );
}

function makeRow(previous, createRowId) {
  return previous ? copy(previous) : { id: createRowId(), values: {}, repeatable: {} };
}

function writeModel(meta, node, row, model) {
  const storage = nodeFor(meta, node).fields.find((entry) => entry.binding?.role === 'storage');
  row.values[storage.dataName] = encode(model);
}

function writePlain(meta, node, row, values) {
  for (const entry of nodeFor(meta, node).fields || []) {
    if (entry.type === 'CalculatedField') continue;
    if (entry.binding && !['value', 'calculation', 'provider'].includes(entry.binding.role))
      continue;
    if (own(values, entry.originalDataName))
      row.values[entry.dataName] = copy(values[entry.originalDataName]);
    else if (!own(row.values, entry.dataName))
      row.values[entry.dataName] = copy(entry.field.default_value ?? null);
  }
}

function writeDefaults(meta, node, row, subject, floor) {
  for (const entry of nodeFor(meta, node).fields.filter(
    (field) => field.binding?.role === 'default'
  )) {
    const property = entry.binding.property;
    row.values[entry.dataName] = copy(
      own(subject.defaults, property)
        ? subject.defaults[property]
        : own(floor.defaults, property)
          ? floor.defaults[property]
          : (meta.properties[property]?.fallback ?? null)
    );
  }
}

function writeProperties(meta, node, row, subject) {
  for (const entry of nodeFor(meta, node).fields.filter(
    (field) => field.binding?.role === 'property'
  ))
    row.values[entry.dataName] = copy(subject.properties?.[entry.binding.property] ?? null);
}

function writeOpening(meta, node, row, opening, wall) {
  const prefix = node === 'doors' ? 'door' : 'window';
  writePlain(meta, node, row, opening.values);
  writeProperties(meta, node, row, opening);
  writeCustom(meta, node, row, opening);
  writeModel(meta, node, row, {
    ...intent(opening),
    id: opening.id,
    segmentId: opening.segmentId,
    ...(opening.provenance ? { provenance: opening.provenance } : {}),
  });
  for (const [name, value] of [
    [`${prefix}_width`, opening.width],
    [`${prefix}_height`, opening.height],
    [`${prefix}_offset`, opening.offset],
    [`${prefix}_wall_reference`, wall.id],
  ])
    write(meta, node, row, name, value);
  if (node === 'windows') write(meta, node, row, 'window_distance_from_floor', opening.sillHeight);
  const index = wall.segments.findIndex((segment) => segment.id === opening.segmentId);
  const segment = wall.segments[index];
  const size = segment ? distance(segment.start, segment.end) : 1;
  for (const [name, value] of [
    [`${prefix}_segment_index`, index],
    [`${prefix}_start_ratio`, opening.offset / size],
    [`${prefix}_end_ratio`, (opening.offset + opening.width) / size],
  ])
    write(meta, node, row, name, value);
}

/** Preserve unrelated fields/row metadata while replacing this plan's canonical collections. */
export function writeBuildingPlanRecord(options) {
  return writeRecord(options);
}

/**
 * A record of a proposal that may hold questions its commit asks (rooms that disagree on a shared
 * wall's value): what a canvas preview draws from, and what the canvas hands a managed host, which
 * commits the operation itself and returns its own record. The conflicted value stays as it was;
 * the record cannot be read back while the question is open, so it is never stored. Every other
 * problem still refuses. Internal: not exported from the package.
 */
export function writeBuildingPlanPreviewRecord(options) {
  return writeRecord(options, (issue) => issue.code !== 'conflicting_room_defaults');
}

function writeRecord(options, refuses = () => true) {
  const meta = metadataFor(options);
  const plan = copy(options.plan);
  for (const floor of plan.floors || []) reconcileWallLabels(floor);
  const createRowId = options.createRowId || generateUuidV7;
  const problems = [
    ...reconcileBuildingPlanProperties(plan, meta.properties),
    ...validateBuildingPlanSnapshot(plan),
  ].filter(refuses);
  if (problems.length) {
    const error = new TypeError(problems[0].message);
    error.issues = problems;
    throw error;
  }
  const record = copy(options.record || { values: {}, repeatable: {} });
  record.repeatable ||= {};
  const oldFloors = previousBySubject(meta, 'floors', record);
  record.repeatable[keyFor(meta, 'floors')] = plan.floors.map((floor) => {
    const row = makeRow(oldFloors.get(floor.id), createRowId);
    writePlain(meta, 'floors', row, floor.values);
    writeProperties(meta, 'floors', row, floor);
    writeCustom(meta, 'floors', row, floor);
    writeDefaults(meta, 'floors', row, floor, floor);
    writeModel(meta, 'floors', row, {
      ...intent(floor),
      id: floor.id,
      defaultProperties: Object.keys(floor.defaults),
      defaultValues: copy(floor.defaults),
    });
    const oldWalls = previousBySubject(meta, 'physical_walls', row);
    row.repeatable[keyFor(meta, 'physical_walls')] = floor.walls.map((wall, index) => {
      const target = makeRow(oldWalls.get(wall.id), createRowId);
      writePlain(meta, 'physical_walls', target, {
        wall_label: wall.autoLabel || `W${index + 1}`,
        ...wall.values,
      });
      writeProperties(meta, 'physical_walls', target, wall);
      writeCustom(meta, 'physical_walls', target, wall);
      const oldSides = previousBySubject(meta, 'wall_sides', target);
      target.repeatable[keyFor(meta, 'wall_sides')] = wall.sides.map((side) => {
        const entry = makeRow(oldSides.get(side.id), createRowId);
        writePlain(meta, 'wall_sides', entry, side.values);
        writeProperties(meta, 'wall_sides', entry, side);
        writeCustom(meta, 'wall_sides', entry, side);
        writeModel(meta, 'wall_sides', entry, {
          ...intent(side),
          id: side.id,
          sign: side.sign,
          roomId: side.roomId,
        });
        return entry;
      });
      write(
        meta,
        'physical_walls',
        target,
        'wall_geometry',
        JSON.stringify({ version: 2, unit: 'meters', segments: wall.segments })
      );
      writeModel(meta, 'physical_walls', target, {
        ...intent(wall),
        autoLabel: wall.autoLabel,
        id: wall.id,
        referenceFaceId: wall.referenceFaceId,
        overrideProperties: Object.keys(wall.overrides),
        ...(wall.sharedChoices?.length ? { sharedChoices: wall.sharedChoices } : {}),
        ...(wall.lineage ? { lineage: wall.lineage } : {}),
      });
      for (const collection of ['doors', 'windows']) {
        const previous = previousBySubject(meta, collection, target);
        target.repeatable[keyFor(meta, collection)] = wall[collection].map((opening) => {
          const entry = makeRow(previous.get(opening.id), createRowId);
          writeOpening(meta, collection, entry, opening, wall);
          return entry;
        });
      }
      return target;
    });
    const oldRooms = previousBySubject(meta, 'rooms', row);
    row.repeatable[keyFor(meta, 'rooms')] = floor.rooms.map((room) => {
      const target = makeRow(oldRooms.get(room.id), createRowId);
      writePlain(meta, 'rooms', target, room.values);
      writeProperties(meta, 'rooms', target, room);
      writeCustom(meta, 'rooms', target, room);
      writeDefaults(meta, 'rooms', target, room, floor);
      writeModel(meta, 'rooms', target, {
        ...intent(room),
        id: room.id,
        edges: room.edges,
        defaultProperties: Object.keys(room.defaults),
        defaultValues: copy(room.defaults),
      });
      write(
        meta,
        'rooms',
        target,
        'room_vertices',
        JSON.stringify({ version: 2, unit: 'meters', vertices: room.vertices })
      );
      const oldFaces = previousBySubject(meta, 'walls', target);
      target.repeatable[keyFor(meta, 'walls')] = room.faces.map((face) => {
        const entry = makeRow(oldFaces.get(face.id), createRowId);
        writePlain(meta, 'walls', entry, face.values);
        writeProperties(meta, 'walls', entry, face);
        writeModel(meta, 'walls', entry, {
          id: face.id,
          wallId: face.wallId,
          sideId: face.sideId,
          bindings: face.bindings,
          overrideProperties: Object.keys(face.overrides),
          ...Object.fromEntries(
            ['edgeIds', 'freePath', 'freeEdges', 'lineage']
              .filter((key) => face[key])
              .map((key) => [key, face[key]])
          ),
        });
        return entry;
      });
      for (const collection of ['columns', 'beams', 'objects']) {
        const previous = previousBySubject(meta, collection, target);
        target.repeatable[keyFor(meta, collection)] = room[collection].map((element) => {
          const entry = makeRow(previous.get(element.id), createRowId);
          const bounds = roomBounds(room);
          const presented = { ...element.values };
          if (collection === 'columns')
            Object.assign(presented, {
              column_center_u: element.position
                ? (element.position.x - bounds.x) / bounds.width
                : (element.values?.column_center_u ?? null),
              column_center_v: element.position
                ? (element.position.y - bounds.y) / bounds.height
                : (element.values?.column_center_v ?? null),
              column_width: element.width,
              column_depth: element.height,
            });
          else if (collection === 'beams')
            Object.assign(presented, {
              beam_start_u: element.start
                ? (element.start.x - bounds.x) / bounds.width
                : (element.values?.beam_start_u ?? null),
              beam_start_v: element.start
                ? (element.start.y - bounds.y) / bounds.height
                : (element.values?.beam_start_v ?? null),
              beam_end_u: element.end
                ? (element.end.x - bounds.x) / bounds.width
                : (element.values?.beam_end_u ?? null),
              beam_end_v: element.end
                ? (element.end.y - bounds.y) / bounds.height
                : (element.values?.beam_end_v ?? null),
              beam_width: element.width,
              beam_depth: element.height,
              beam_length:
                element.start && element.end ? distance(element.start, element.end) : null,
            });
          writePlain(meta, collection, entry, presented);
          writeProperties(meta, collection, entry, element);
          writeCustom(meta, collection, entry, element);
          for (const [name, value] of Object.entries(presented))
            if (
              ['derived', 'geometry'].includes(
                nodeFor(meta, collection).fieldsByOriginalDataName[name]?.binding?.role
              )
            )
              write(meta, collection, entry, name, value);
          const { values, repeatable, properties, provenance, overrides, ...state } = element;
          Object.assign(state, intent(element));
          if (collection !== 'objects')
            for (const attribute of ['position', 'start', 'end', 'width', 'height', 'length'])
              delete state[attribute];
          writeModel(meta, collection, entry, state);
          return entry;
        });
      }
      return target;
    });
    return row;
  });
  refreshBuildingPlanProjections({ meta, record });
  return record;
}

/** Project only from canonical owners. A room editor never supplies outside-surface context. */
function sourceFor(meta, wall, state, binding) {
  if (binding.sourceNode !== 'wall_sides') return wall;
  const current = rows(meta, 'wall_sides', wall)
    .map((row) => modelOf(meta, 'wall_sides', row))
    .find((side) => side.id === state.sideId);
  return rows(meta, 'wall_sides', wall).find((row) => {
    const side = modelOf(meta, 'wall_sides', row);
    return binding.outside
      ? side.id !== current?.id && (!side.roomId || side.roomId === current?.roomId)
      : side.id === state.sideId;
  });
}

/** WB3: a room on its segment's side -1 sees an opening's offset from its own left end. */
function seenFromRoom(meta, projected, source, row, face, wallRow, target) {
  const prefix = source === 'doors' ? 'door' : 'window';
  const key = fieldFor(meta, projected, `${prefix}_offset`);
  if (!key) return target;
  const opening = {
    segmentId: modelOf(meta, source, row).segmentId,
    offset: read(meta, source, row, `${prefix}_offset`),
    width: read(meta, source, row, `${prefix}_width`),
  };
  const { segments } = geometry(read(meta, 'physical_walls', wallRow, 'wall_geometry'), 'wall');
  target.values[key] = offsetSeenFrom(face, opening, segments);
  return target;
}

function projectRow(entries, source, previous = source, links = null) {
  const target = { ...copy(previous), values: {}, repeatable: {} };
  const references = new Map();
  for (const entry of entries) {
    const sourceName = entry.binding?.sourceDataName || entry.sourceDataName;
    if (entry.type === 'RepeatableSection') {
      target.repeatable[entry.preferredKey] = (source?.repeatable?.[sourceName] || []).map((row) =>
        projectRow(entry.children || [], row, row, links)
      );
    } else {
      target.values[entry.dataName] = copy(source?.values?.[sourceName] ?? null);
      if (source) references.set(entry.dataName, { record: source, fieldName: sourceName });
    }
  }
  if (links) links.set(target, references);
  return target;
}

export function refreshBuildingPlanProjections(options) {
  const meta = metadataFor(options),
    record = options.record;
  for (const floor of ownerRecords(meta, record).flatMap((owner) => rows(meta, 'floors', owner))) {
    const walls = previousBySubject(meta, 'physical_walls', floor);
    const roomsById = previousBySubject(meta, 'rooms', floor);
    const conditionFields = Object.fromEntries(
      meta.repeatables.flatMap((node) =>
        node.fields.flatMap((entry) => [
          [entry.originalKey, { ...entry.field, data_name: entry.originalDataName }],
          [entry.originalDataName, { ...entry.field, data_name: entry.originalDataName }],
        ])
      )
    );
    const contextValues = (node, row) =>
      row
        ? Object.fromEntries(
            nodeFor(meta, node)
              .fields.filter((entry) => entry.type !== 'RepeatableSection')
              .map((entry) => [entry.originalDataName, copy(row.values?.[entry.dataName])])
          )
        : {};
    const flags = (node, row, wall, sideRow = null, only = null) => {
      const side = sideRow && modelOf(meta, 'wall_sides', sideRow),
        room = side?.roomId && roomsById.get(side.roomId);
      const context = {
        floor: { values: contextValues('floors', floor) },
        room: room ? { values: contextValues('rooms', room) } : null,
        wall: {
          exposure: rows(meta, 'wall_sides', wall).every(
            (row) => modelOf(meta, 'wall_sides', row).roomId
          )
            ? 'interior'
            : 'exterior',
        },
        side,
      };
      for (const entry of nodeFor(meta, node).fields) {
        if (entry.binding?.contextNode === 'rooms')
          row.values[entry.dataName] = copy(
            room?.values?.[fieldFor(meta, 'rooms', entry.binding.contextOriginalDataName)] ?? null
          );
        if (!entry.binding?.applicabilityFor || (only && entry.dataName !== only)) continue;
        const field = nodeFor(meta, node).fieldsByOriginalDataName[entry.binding.applicabilityFor];
        const source = {
          values: { ...contextValues('physical_walls', wall), ...contextValues(node, row) },
        };
        row.values[entry.dataName] =
          (!field.binding?.outside || Boolean(sideRow)) &&
          providerApplies(
            { applies_to: field.binding?.applies_to, conditionFields },
            context,
            source
          )
            ? 1
            : 0;
      }
    };
    for (const wall of walls.values()) {
      flags('physical_walls', wall, wall);
      for (const side of rows(meta, 'wall_sides', wall)) flags('wall_sides', side, wall, side);
    }
    for (const room of rows(meta, 'rooms', floor))
      for (const face of rows(meta, 'walls', room)) {
        const state = modelOf(meta, 'walls', face),
          wall = walls.get(state.wallId);
        if (!wall) continue;
        for (const field of nodeFor(meta, 'walls').fields.filter(
          (entry) => entry.binding?.role === 'projection'
        )) {
          const source = sourceFor(meta, wall, state, field.binding);
          if (field.type === 'RepeatableSection') {
            face.repeatable ||= {};
            face.repeatable[field.preferredKey] = (
              source?.repeatable?.[field.binding.sourceDataName] || []
            ).map((row) => projectRow(field.children || [], row));
          } else
            face.values[field.dataName] = copy(
              source?.values?.[field.binding.sourceDataName] ?? null
            );
        }
        for (const flag of nodeFor(meta, 'walls').fields.filter(
          (entry) => entry.binding?.applicabilityFor
        )) {
          const field = nodeFor(meta, 'walls').fieldsByOriginalDataName[
            flag.binding.applicabilityFor
          ];
          const source = sourceFor(meta, wall, state, {
            sourceNode: 'wall_sides',
            outside: field.binding?.outside,
          });
          flags('walls', face, wall, source, flag.dataName);
        }
        for (const [projected, source] of [
          ['face_doors', 'doors'],
          ['face_windows', 'windows'],
        ]) {
          face.repeatable ||= {};
          face.repeatable[keyFor(meta, projected)] = rows(meta, source, wall)
            .filter((row) => {
              const model = modelOf(meta, source, row),
                prefix = source === 'doors' ? 'door' : 'window';
              const offset = read(meta, source, row, `${prefix}_offset`),
                width = read(meta, source, row, `${prefix}_width`);
              return state.bindings.some(
                (binding) =>
                  binding.segmentId === model.segmentId &&
                  offset >= binding.interval[0] - 1e-6 &&
                  offset + width <= binding.interval[1] + 1e-6
              );
            })
            .map((row) =>
              seenFromRoom(
                meta,
                projected,
                source,
                row,
                state,
                wall,
                projectRow(nodeFor(meta, projected).fields, row)
              )
            );
        }
      }
  }
  return record;
}

export function getBuildingPlanRecordMetadata(options) {
  return metadataFor(options);
}

export function getBuildingPlanProjectionLinks({ meta, record }) {
  const links = new WeakMap();
  const linkChildren = (entries, target, source) => {
    const fields = new Map();
    for (const entry of entries || []) {
      const name = entry.binding?.sourceDataName || entry.sourceDataName;
      if (entry.type === 'RepeatableSection')
        for (const child of target.repeatable?.[entry.preferredKey] || []) {
          const original = (source.repeatable?.[name] || []).find((row) => row.id === child.id);
          if (original) linkChildren(entry.children, child, original);
        }
      else fields.set(entry.dataName, { record: source, fieldName: name });
    }
    links.set(target, fields);
  };
  for (const floor of ownerRecords(meta, record).flatMap((owner) => rows(meta, 'floors', owner))) {
    const walls = previousBySubject(meta, 'physical_walls', floor);
    for (const room of rows(meta, 'rooms', floor))
      for (const face of rows(meta, 'walls', room)) {
        const state = modelOf(meta, 'walls', face),
          wall = walls.get(state.wallId);
        if (!wall) continue;
        const entries = new Map();
        for (const field of nodeFor(meta, 'walls').fields.filter(
          (entry) => entry.binding?.role === 'projection'
        )) {
          const source = sourceFor(meta, wall, state, field.binding);
          if (source && field.type !== 'RepeatableSection')
            entries.set(field.dataName, {
              record: source,
              fieldName: field.binding.sourceDataName,
            });
          else if (source)
            for (const row of face.repeatable?.[field.preferredKey] || []) {
              const original = (source.repeatable?.[field.binding.sourceDataName] || []).find(
                (entry) => entry.id === row.id
              );
              if (original) linkChildren(field.children, row, original);
            }
        }
        links.set(face, entries);
        for (const [projected, source] of [
          ['face_doors', 'doors'],
          ['face_windows', 'windows'],
        ])
          for (const row of rows(meta, projected, face)) {
            const original = rows(meta, source, wall).find((item) => item.id === row.id);
            if (!original) continue;
            // WB3: a reversed copy's offset is its own value, not a mirror of the stored one.
            const offset = fieldFor(
              meta,
              source,
              `${source === 'doors' ? 'door' : 'window'}_offset`
            );
            const reversed = faceSeesSegmentReversed(
              state,
              modelOf(meta, source, original).segmentId
            );
            links.set(
              row,
              new Map(
                nodeFor(meta, projected)
                  .fields.filter((field) => !(reversed && field.binding.sourceDataName === offset))
                  .map((field) => [
                    field.dataName,
                    { record: original, fieldName: field.binding.sourceDataName },
                  ])
              )
            );
          }
      }
  }
  return links;
}
