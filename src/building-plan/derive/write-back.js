import { generateUuidV7 } from '../../utilities/uuid.js';
import {
  BUILDING_PLAN_PROPERTIES,
  BUILDING_PLAN_VERSION,
  copyBuildingPlanData as copy,
  reconcileBuildingPlanProperties,
  validateBuildingPlanSnapshot,
} from '../model.js';
import { reconcileWallLabels } from '../wall-labels.js';
import { rejoinAutomaticPieces, resolvePieceSubjects } from './subject-joins.js';
import { divideSubjects, retireSubjects } from './subject-divisions.js';
import { placeRoomStations } from './room-stations.js';
import { assembleRows } from './stored-rows.js';
import { buildStoredWalls } from './stored-walls.js';

function firstBy(entries, key) {
  const map = new Map();
  for (const entry of entries) if (!map.has(key(entry))) map.set(key(entry), entry);
  return map;
}

function createContext(primary, derived, createId, preferredRoomIds) {
  const lines = new Map(derived.lines.map((line) => [`${line.roomId}:${line.index}`, line]));
  const edgeLine = new Map();
  for (const line of derived.lines)
    for (const edge of line.edges) edgeLine.set(`${line.roomId}:${edge.id}`, { line, edge });
  const alias = new Map();
  const profiles = primary.profiles.map((profile) => ({ ...profile }));
  return {
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
    partitionByFace: new Map(primary.partitions.map((partition) => [partition.faceId, partition])),
    profiles,
    profileByEdge: new Map(
      profiles.map((profile) => [`${profile.roomId}:${profile.edgeId}`, profile])
    ),
    pieces: derived.pieces
      .filter((piece) => !piece.partition)
      .map((piece) => ({ ...piece, lines: piece.lines.map((entry) => ({ ...entry })) })),
    partitionPieces: derived.pieces
      .filter((piece) => piece.partition)
      .map((piece) => ({ ...piece })),
    children: new Map(),
    joins: [],
    divisions: [],
    retired: [],
    created: [],
    issues: [],
  };
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
  resolvePieceSubjects(context);
  divideSubjects(context);
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
      return {
        ...rest,
        edges: room.edges.map((edge) => {
          const profile = context.profileByEdge.get(`${room.id}:${edge.id}`);
          const source = profile && context.resolve(profile.sourceId);
          const covered = rows.some((row) => row.roomId === room.id && row.edgeId === edge.id);
          return source && written.has(source) && !covered
            ? { ...edge, profile: { wallId: source, sideSign: profile.sideSign } }
            : edge;
        }),
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
