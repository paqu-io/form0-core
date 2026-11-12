import { generateUuidV7 } from '../../utilities/uuid.js';
import {
  BUILDING_PLAN_PROPERTIES,
  BUILDING_PLAN_VERSION,
  copyBuildingPlanData as copy,
  reconcileBuildingPlanProperties,
  validateBuildingPlanSnapshot,
} from '../model.js';
import { reconcileWallLabels } from '../wall-labels.js';
import { project, segmentFrame } from '../geometry.js';
import { pointAt } from './grid.js';
import {
  collectPieceSubjects,
  joinPieceSubjects,
  rejoinAutomaticPieces,
  subjectTangent,
} from './subject-joins.js';
import { divideSubjects, retireSubjects } from './subject-divisions.js';
import { dividePartitionSubjects } from './partition-divisions.js';
import { placeRoomStations } from './room-stations.js';
import { assembleRows, capOf } from './stored-rows.js';
import { buildStoredWalls } from './stored-walls.js';

/**
 * Edge profiles for caps: the source wall and the side of it that faces the cap's room, read from
 * the written wall's axis (today's record shape).
 */
function capProfiles(context, rebuilt, room, walls, written) {
  const profiles = new Map();
  const outputs = rebuilt.find((entry) => entry.room.id === room.id)?.outputs || [];
  for (const output of outputs) {
    if (output.piece) continue;
    const cap = capOf(context, room.id, output);
    const wallId = cap && context.resolve(cap.piece?.subjectId);
    if (!wallId || !written.has(wallId)) continue;
    const segment = walls.find((wall) => wall.id === wallId).segments[0];
    const inside = pointAt(
      output.line.frame,
      (output.from + output.to) / 2,
      -output.line.outward * 0.01
    );
    const side = project(segmentFrame(segment.start, segment.end), inside).offset < 0 ? -1 : 1;
    profiles.set(output.id, { wallId, sideSign: side });
  }
  return profiles;
}

function firstBy(entries, key) {
  const map = new Map();
  for (const entry of entries) if (!map.has(key(entry))) map.set(key(entry), entry);
  return map;
}

function createContext(primary, derived, createId, preferredRoomIds) {
  const boundary = derived.pieces.filter((piece) => !piece.partition);
  const pieces = boundary.map((piece) => ({
    ...piece,
    lines: piece.lines.map((entry) => ({ ...entry })),
  }));
  const lines = new Map(derived.lines.map((line) => [`${line.roomId}:${line.index}`, line]));
  const edgeLine = new Map();
  for (const line of derived.lines)
    for (const edge of line.edges) edgeLine.set(`${line.roomId}:${edge.id}`, { line, edge });
  const alias = new Map();
  const anchorsBySubject = new Map();
  for (const anchor of primary.anchors) {
    if (!anchorsBySubject.has(anchor.subjectId)) anchorsBySubject.set(anchor.subjectId, []);
    anchorsBySubject.get(anchor.subjectId).push(anchor);
  }
  const context = {
    primary,
    createId,
    preferredRoomIds,
    lines,
    edgeLine,
    alias,
    resolve: (id) => {
      for (let guard = 0; alias.has(id) && guard < 1000; guard++) id = alias.get(id);
      return id;
    },
    original: primary.subjects,
    subjects: new Map([...primary.subjects].map(([id, subject]) => [id, copy(subject)])),
    rooms: new Map(primary.rooms.map((room) => [room.id, room])),
    anchorByFace: firstBy(primary.anchors, (anchor) => anchor.faceId),
    anchorByEdge: firstBy(primary.anchors, (anchor) => `${anchor.roomId}:${anchor.edgeId}`),
    anchorsBySubject,
    partitionByFace: new Map(primary.partitions.map((partition) => [partition.faceId, partition])),
    pieces,
    // Caps refer to the context's copy of their source piece, whose subject the identity rules set.
    caps: (derived.caps || []).map((cap) => ({
      ...cap,
      piece: pieces[boundary.indexOf(cap.source)],
    })),
    partitionPieces: derived.pieces
      .filter((piece) => piece.partition)
      .map((piece) => ({ ...piece })),
    children: new Map(),
    divided: new Set(),
    basis: new Map(),
    joins: [],
    divisions: [],
    retired: [],
    created: [],
    issues: [],
  };
  // Side signs are defined against each subject's reference row in the primary geometry.
  for (const subject of context.subjects.values()) {
    const tangent = subjectTangent(context, subject);
    if (tangent) context.basis.set(subject.id, tangent);
  }
  return context;
}

/**
 * Write primary data and its derivation back as a stored floor in today's record shape, applying
 * the identity rules: unbound contacts join (answers merge or the edit is refused), a subject
 * covering several pieces divides (copies keep the answers), automatic divisions join again, a
 * subject without a piece retires only with a survivor, rows follow their edges, labels follow
 * subjects (an automatic label is never a typed answer), and automatic stations are placed.
 *
 * @param {Object} primary Primary data (see `extractBuildingPlanPrimary`).
 * @param {Object} derived Its derivation (see `deriveBuildingPlanPrimary`).
 * @param {Object} [options]
 * @param {Object} [options.specifications] Session property specifications.
 * @param {() => string} [options.createId] New identities (deterministic IDs come with commands).
 * @param {string[]} [options.preferredRoomIds] Rooms whose wall survives a join (the command's
 *   choice); otherwise the lower label survives.
 * @returns {{floor: Object, divisions: Array<{source: Object, walls: Array<Object>}>,
 *   joins: Array<{survivorId: string, absorbedId: string}>, retired: string[], created: string[],
 *   issues: Array<Object>}} Refusals throw an error with `issues`, as the current engine does.
 */
export function writeBackBuildingPlanFloor(primary, derived, options = {}) {
  const {
    specifications = BUILDING_PLAN_PROPERTIES,
    createId = generateUuidV7,
    preferredRoomIds = [],
  } = options;
  const context = createContext(primary, derived, createId, preferredRoomIds);
  collectPieceSubjects(context);
  divideSubjects(context);
  dividePartitionSubjects(context);
  joinPieceSubjects(context);
  // An explicit contact width (kept on attach) is an answer on that physical piece.
  for (const piece of context.pieces)
    if (piece.explicitWidth > 0) {
      const subject = context.subjects.get(piece.subjectId);
      subject.overrides = { ...subject.overrides, wall_thickness_m: piece.explicitWidth };
    }
  rejoinAutomaticPieces(context);
  retireSubjects(context);

  const markers = new Map();
  const rebuilt = primary.rooms.map((room) => placeRoomStations(context, room, markers));
  const rows = assembleRows(context, rebuilt);
  const rooms = new Map(rebuilt.map(({ room }) => [room.id, room]));
  const walls = buildStoredWalls(context, rooms, rows);
  const written = new Set(walls.map((wall) => wall.id));
  const floor = {
    ...copy(primary.floor),
    id: primary.floorId,
    rooms: rebuilt.map(({ room }) => {
      const { faceOrder, ...rest } = room;
      const profiles = capProfiles(context, rebuilt, room, walls, written);
      return {
        ...rest,
        edges: room.edges.map((edge) =>
          profiles.has(edge.id) ? { ...edge, profile: profiles.get(edge.id) } : edge
        ),
        faces: rows.filter((row) => row.roomId === room.id && row.face).map((row) => row.face),
      };
    }),
    walls,
  };
  reconcileWallLabels(floor, { walls: [...context.original.values()] });
  const snapshot = {
    version: BUILDING_PLAN_VERSION,
    unit: 'm',
    axes: 'x-right-y-down',
    floors: [floor],
  };
  const issues = [
    ...context.issues,
    ...reconcileBuildingPlanProperties(snapshot, specifications),
    ...validateBuildingPlanSnapshot(snapshot),
  ];
  const byId = new Map(walls.map((wall) => [wall.id, wall]));
  const divisions = context.divisions
    .map(({ source, subjectIds }) => ({
      source,
      walls: [...new Set(subjectIds.map((id) => context.resolve(id)))]
        .map((id) => byId.get(id))
        .filter(Boolean),
    }))
    .filter((division) => division.walls.length > 1);
  return {
    floor,
    divisions,
    joins: context.joins,
    retired: context.retired,
    created: context.created.filter((id) => written.has(id)),
    issues,
  };
}
