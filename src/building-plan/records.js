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
import { portionThicknessState } from './portion-properties.js';

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
  if (!result || result.version !== 1 || typeof result.id !== 'string')
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
  if (!result || result.version !== 1 || result.unit !== 'meters')
    throw new TypeError(`BuildingPlan ${name} requires versioned metric geometry.`);
  return result;
}

const encode = (value) => JSON.stringify({ version: 1, ...value });
function modelOf(meta, node, row) {
  const storage = nodeFor(meta, node).fields.find((entry) => entry.binding?.role === 'storage');
  return decode(row.values?.[storage.dataName], node);
}

function plainValues(meta, node, row) {
  const result = {};
  for (const entry of nodeFor(meta, node).fields || []) {
    if (entry.type === 'CalculatedField') continue;
    if (entry.binding && !['value', 'calculation'].includes(entry.binding.role)) continue;
    if (own(row.values, entry.dataName))
      result[entry.originalDataName] = copy(row.values[entry.dataName]);
  }
  return result;
}

function readDefaults(meta, node, row, model) {
  const result = {};
  for (const entry of nodeFor(meta, node).fields.filter(
    (field) => field.binding?.role === 'default'
  ))
    if (model.defaultProperties?.includes(entry.binding.property))
      result[entry.binding.property] = copy(row.values[entry.dataName]);
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
      defaults: readDefaults(meta, 'floors', row, model),
      rooms: [],
      walls: [],
      observations: [],
    };
    snapshot.floors.push(floor);
    for (const wallRow of rows(meta, 'physical_walls', row)) {
      const state = modelOf(meta, 'physical_walls', wallRow);
      const shape = geometry(read(meta, 'physical_walls', wallRow, 'wall_geometry'), 'wall');
      const wall = {
        id: state.id,
        referenceFaceId: state.referenceFaceId,
        segments: copy(shape.segments),
        overrides: readOverrides(meta, 'physical_walls', wallRow, state),
        properties: {},
        provenance: {},
        values: plainValues(meta, 'physical_walls', wallRow),
        doors: [],
        windows: [],
      };
      if (state.lineage) wall.lineage = copy(state.lineage);
      floor.walls.push(wall);
      for (const collection of ['doors', 'windows'])
        for (const openingRow of rows(meta, collection, wallRow)) {
          const state = modelOf(meta, collection, openingRow);
          const prefix = collection === 'doors' ? 'door' : 'window';
          wall[collection].push({
            id: state.id,
            type: prefix,
            segmentId: state.segmentId,
            offset: read(meta, collection, openingRow, `${prefix}_offset_m`),
            width: read(meta, collection, openingRow, `${prefix}_width_m`),
            height: read(meta, collection, openingRow, `${prefix}_height_m`),
            sillHeight:
              collection === 'windows'
                ? read(meta, collection, openingRow, 'window_distance_from_floor_m')
                : null,
            values: plainValues(meta, collection, openingRow),
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
          });
          const element = room[collection].at(-1);
          delete element.version;
          const bounds = roomBounds(room);
          const location = (uName, vName) => {
            const u = read(meta, collection, elementRow, uName),
              v = read(meta, collection, elementRow, vName);
            return u == null || v == null
              ? null
              : { x: bounds.x + u * bounds.width, y: bounds.y + v * bounds.height };
          };
          if (collection === 'columns') {
            element.position = location('column_center_u', 'column_center_v');
            element.width = read(meta, collection, elementRow, 'column_cross_section_width_m');
            element.height = read(meta, collection, elementRow, 'column_cross_section_height_m');
          } else if (collection === 'beams') {
            element.start = location('beam_start_u', 'beam_start_v');
            element.end = location('beam_end_u', 'beam_end_v');
            element.width = read(meta, collection, elementRow, 'beam_cross_section_width_m');
            element.height = read(meta, collection, elementRow, 'beam_cross_section_height_m');
          }
        }
    }
    for (const observationRow of rows(meta, 'observations', row)) {
      const state = modelOf(meta, 'observations', observationRow);
      delete state.version;
      floor.observations.push({
        ...state,
        values: plainValues(meta, 'observations', observationRow),
      });
    }
  }
  const issues = reconcileBuildingPlanProperties(snapshot, meta.properties);
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
    if (entry.binding && !['value', 'calculation'].includes(entry.binding.role)) continue;
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
    row.values[entry.dataName] = copy(subject.properties[entry.binding.property] ?? null);
}

function writeOpening(meta, node, row, opening, wall) {
  const prefix = node === 'doors' ? 'door' : 'window';
  writePlain(meta, node, row, opening.values);
  writeModel(meta, node, row, {
    id: opening.id,
    segmentId: opening.segmentId,
    ...(opening.provenance ? { provenance: opening.provenance } : {}),
  });
  for (const [name, value] of [
    [`${prefix}_width_m`, opening.width],
    [`${prefix}_height_m`, opening.height],
    [`${prefix}_offset_m`, opening.offset],
    [`${prefix}_wall_reference`, wall.id],
  ])
    write(meta, node, row, name, value);
  if (node === 'windows')
    write(meta, node, row, 'window_distance_from_floor_m', opening.sillHeight);
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
  const meta = metadataFor(options);
  const plan = copy(options.plan);
  const createRowId = options.createRowId || generateUuidV7;
  const problems = [
    ...reconcileBuildingPlanProperties(plan, meta.properties),
    ...validateBuildingPlanSnapshot(plan),
  ];
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
    writeDefaults(meta, 'floors', row, floor, floor);
    writeModel(meta, 'floors', row, {
      id: floor.id,
      defaultProperties: Object.keys(floor.defaults),
    });
    const oldWalls = previousBySubject(meta, 'physical_walls', row);
    row.repeatable[keyFor(meta, 'physical_walls')] = floor.walls.map((wall, index) => {
      const target = makeRow(oldWalls.get(wall.id), createRowId);
      writePlain(meta, 'physical_walls', target, { wall_label: `W${index + 1}`, ...wall.values });
      writeProperties(meta, 'physical_walls', target, wall);
      write(
        meta,
        'physical_walls',
        target,
        'wall_geometry',
        JSON.stringify({ version: 1, unit: 'meters', segments: wall.segments })
      );
      writeModel(meta, 'physical_walls', target, {
        id: wall.id,
        referenceFaceId: wall.referenceFaceId,
        overrideProperties: Object.keys(wall.overrides),
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
      writeDefaults(meta, 'rooms', target, room, floor);
      writeModel(meta, 'rooms', target, {
        id: room.id,
        edges: room.edges,
        defaultProperties: Object.keys(room.defaults),
      });
      write(
        meta,
        'rooms',
        target,
        'room_vertices',
        JSON.stringify({ version: 1, unit: 'meters', vertices: room.vertices })
      );
      const oldFaces = previousBySubject(meta, 'walls', target);
      target.repeatable[keyFor(meta, 'walls')] = room.faces.map((face) => {
        const entry = makeRow(oldFaces.get(face.id), createRowId);
        writePlain(meta, 'walls', entry, face.values);
        writeProperties(meta, 'walls', entry, face);
        writeModel(meta, 'walls', entry, {
          id: face.id,
          wallId: face.wallId,
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
              column_cross_section_width_m: element.width,
              column_cross_section_height_m: element.height,
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
              beam_cross_section_width_m: element.width,
              beam_cross_section_height_m: element.height,
              beam_length_m:
                element.start && element.end ? distance(element.start, element.end) : null,
            });
          writePlain(meta, collection, entry, presented);
          const { values, ...state } = element;
          if (collection !== 'objects')
            for (const attribute of ['position', 'start', 'end', 'width', 'height', 'length'])
              delete state[attribute];
          writeModel(meta, collection, entry, state);
          return entry;
        });
      }
      return target;
    });
    const previous = previousBySubject(meta, 'observations', row);
    row.repeatable[keyFor(meta, 'observations')] = floor.observations.map((observation) => {
      const entry = makeRow(previous.get(observation.id), createRowId);
      const { values, ...state } = observation;
      writeModel(meta, 'observations', entry, state);
      writePlain(meta, 'observations', entry, values);
      return entry;
    });
    return row;
  });
  refreshBuildingPlanProjections({ meta, record });
  return record;
}

function projectedThickness(meta, cache, wall, face) {
  if (!cache.has(wall))
    cache.set(wall, {
      segments: geometry(read(meta, 'physical_walls', wall, 'wall_geometry'), 'wall').segments,
      properties: { wall_thickness_m: read(meta, 'physical_walls', wall, 'wall_thickness_m') },
    });
  return portionThicknessState(cache.get(wall), face);
}

/** Read-only joins used by engines/editors; these mirrors are excluded from persistence. */
export function refreshBuildingPlanProjections(options) {
  const meta = metadataFor(options);
  const record = options.record;
  const thicknessCache = new WeakMap();
  for (const floor of ownerRecords(meta, record).flatMap((owner) => rows(meta, 'floors', owner))) {
    const walls = previousBySubject(meta, 'physical_walls', floor);
    const observations = rows(meta, 'observations', floor);
    for (const room of rows(meta, 'rooms', floor))
      for (const face of rows(meta, 'walls', room)) {
        const state = modelOf(meta, 'walls', face);
        const wall = walls.get(state.wallId);
        if (!wall) continue;
        const thickness = projectedThickness(meta, thicknessCache, wall, state);
        for (const field of nodeFor(meta, 'walls').fields.filter(
          (entry) => entry.binding?.role === 'projection'
        ))
          face.values[field.dataName] = copy(
            thickness && field.binding.property === 'wall_thickness_m'
              ? thickness.value
              : (wall.values[field.binding.sourceDataName] ?? null)
          );
        for (const [projected, source] of [
          ['face_doors', 'doors'],
          ['face_windows', 'windows'],
          ['face_observations', 'observations'],
        ]) {
          const sourceRows =
            source === 'observations'
              ? observations.filter((row) => {
                  const model = modelOf(meta, 'observations', row);
                  return [model.subject, ...(model.relatedSubjects || [])].some((subject) =>
                    [state.id, state.wallId].includes(subject?.id)
                  );
                })
              : rows(meta, source, wall).filter((row) => {
                  const model = modelOf(meta, source, row);
                  const prefix = source === 'doors' ? 'door' : 'window';
                  const offset = read(meta, source, row, `${prefix}_offset_m`);
                  const width = read(meta, source, row, `${prefix}_width_m`);
                  return state.bindings.some(
                    (binding) =>
                      binding.segmentId === model.segmentId &&
                      offset >= binding.interval[0] - 1e-6 &&
                      offset + width <= binding.interval[1] + 1e-6
                  );
                });
          face.repeatable ||= {};
          face.repeatable[keyFor(meta, projected)] = sourceRows.map((row) => ({
            ...copy(row),
            values: Object.fromEntries(
              nodeFor(meta, projected).fields.map((field) => [
                field.dataName,
                copy(row.values[field.binding.sourceDataName] ?? null),
              ])
            ),
            repeatable: {},
          }));
        }
      }
  }
  return record;
}

export function getBuildingPlanRecordMetadata(options) {
  return metadataFor(options);
}

/** Live source links let record calculations depend on the canonical physical calculation. */
export function getBuildingPlanProjectionLinks({ meta, record }) {
  const links = new WeakMap();
  const thicknessCache = new WeakMap();
  for (const floor of ownerRecords(meta, record).flatMap((owner) => rows(meta, 'floors', owner))) {
    const walls = previousBySubject(meta, 'physical_walls', floor);
    const observations = rows(meta, 'observations', floor);
    for (const room of rows(meta, 'rooms', floor))
      for (const face of rows(meta, 'walls', room)) {
        const state = modelOf(meta, 'walls', face);
        const wall = walls.get(state.wallId);
        if (!wall) continue;
        const thickness = projectedThickness(meta, thicknessCache, wall, state);
        links.set(
          face,
          new Map(
            nodeFor(meta, 'walls')
              .fields.filter((field) => field.binding?.role === 'projection')
              .map((field) => [
                field.dataName,
                thickness?.source.mode === 'override' &&
                field.binding.property === 'wall_thickness_m'
                  ? { record: face, fieldName: field.dataName, local: true }
                  : { record: wall, fieldName: field.binding.sourceDataName },
              ])
          )
        );
        for (const [projected, source] of [
          ['face_doors', 'doors'],
          ['face_windows', 'windows'],
          ['face_observations', 'observations'],
        ]) {
          const canonical = source === 'observations' ? observations : rows(meta, source, wall);
          for (const row of rows(meta, projected, face)) {
            const original = canonical.find((entry) => entry.id === row.id);
            if (original)
              links.set(
                row,
                new Map(
                  nodeFor(meta, projected).fields.map((field) => [
                    field.dataName,
                    { record: original, fieldName: field.binding.sourceDataName },
                  ])
                )
              );
          }
        }
      }
  }
  return links;
}
