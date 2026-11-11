import { assignRoomEdges, cleanPoint, polygonIssue } from '../geometry.js';
import { copyBuildingPlanData as copy } from '../model.js';
import { along, lineFrame, pointAt } from './grid.js';
import { edgeEnds } from './frames.js';
import { seatRoom } from './seating.js';

const refuse = (code, message) => {
  throw Object.assign(new Error(message), { issues: [{ code, message }] });
};

function findPrimaryRoom(primary, roomId) {
  const room = primary.rooms.find((entry) => entry.id === roomId);
  if (!room) throw new Error('The room no longer exists.');
  return room;
}

const moved = (point, delta) =>
  cleanPoint({ ...point, x: point.x + delta.x, y: point.y + delta.y });

/** Move a room with its partitions and elements; rows and openings follow its edges. */
function translateRoom(primary, room, delta) {
  if (!delta.x && !delta.y) return;
  room.vertices = room.vertices.map((point) => moved(point, delta));
  for (const partition of primary.partitions)
    if (partition.roomId === room.id) partition.path = partition.path.map((p) => moved(p, delta));
  for (const kind of ['columns', 'beams', 'objects'])
    for (const item of room[kind] || [])
      for (const key of ['position', 'start', 'end'])
        if (item[key]) item[key] = moved(item[key], delta);
}

function rowFrame(primary, anchor) {
  const ends = edgeEnds(findPrimaryRoom(primary, anchor.roomId), anchor.edgeId);
  return ends && lineFrame(...ends);
}

/**
 * An opening on a shared wall stays with the room that stays: when a room moves or is removed,
 * an opening anchored to one of its rows is anchored to the other room's row instead, at the
 * same place. Openings on walls only this room faces move with it. `subjectIds` limits this to
 * some walls.
 */
export function keepOpeningsWithStationaryRooms(primary, roomId, subjectIds = null) {
  for (const subject of primary.subjects.values()) {
    if (subjectIds && !subjectIds.includes(subject.id)) continue;
    for (const opening of subject.openings || []) {
      const anchor = primary.anchors.find((entry) => entry.faceId === opening.faceId);
      if (anchor?.roomId !== roomId) continue;
      const other = primary.anchors.find(
        (entry) => entry.subjectId === subject.id && entry.roomId !== roomId
      );
      const [from, to] = [anchor, other].map((entry) => entry && rowFrame(primary, entry));
      if (!from || !to) continue;
      const stations = [opening.from, opening.from + opening.width].map((station) =>
        along(to, pointAt(from, station))
      );
      opening.faceId = other.faceId;
      opening.from = Math.min(...stations);
    }
  }
}

function seat(primary, room, operation, specifications) {
  const seated = seatRoom(primary, room.id, {
    tolerance: operation.attachmentTolerance ?? 0,
    keep: operation.keepContactThickness === true,
    specifications,
  });
  translateRoom(primary, room, seated.delta);
  primary.contactWidths = seated.contactWidths;
}

function createRoom(primary, operation, { createId, specifications }) {
  const { rectangle } = operation;
  const input = operation.vertices || [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y + rectangle.height },
    { x: rectangle.x, y: rectangle.y + rectangle.height },
  ];
  const room = {
    id: operation.id || createId(),
    values: copy(operation.values || {}),
    defaults: copy(operation.defaults || {}),
    vertices: input.map((point) => cleanPoint({ ...point, id: point.id || createId() })),
    edges: [],
    columns: [],
    beams: [],
    objects: [],
    faceOrder: [],
  };
  const problem = polygonIssue(room.vertices);
  if (problem) throw new Error(problem);
  assignRoomEdges(room, createId);
  primary.rooms.push(room);
  if (operation.attach === true) seat(primary, room, operation, specifications);
  return { created: { type: 'room', id: room.id } };
}

function moveRoom(primary, operation, { specifications }) {
  const room = findPrimaryRoom(primary, operation.roomId);
  const delta = operation.delta || {};
  if (![delta.x, delta.y].every(Number.isFinite))
    refuse('invalid_delta', 'Moving a room requires a finite displacement.');
  keepOpeningsWithStationaryRooms(primary, room.id);
  translateRoom(primary, room, delta);
  if (operation.attach !== false) seat(primary, room, operation, specifications);
  return {};
}

/** Removing a room deletes it with the walls only it faces (their openings and records). */
function removeRoom(primary, operation) {
  const room = findPrimaryRoom(primary, operation.roomId);
  keepOpeningsWithStationaryRooms(primary, room.id);
  const elsewhere = new Set(
    primary.anchors.filter((anchor) => anchor.roomId !== room.id).map((a) => a.subjectId)
  );
  const exclusive = new Set([
    ...primary.anchors.filter((anchor) => anchor.roomId === room.id).map((a) => a.subjectId),
    ...primary.partitions.filter((entry) => entry.roomId === room.id).map((p) => p.subjectId),
  ]);
  for (const id of exclusive) if (!elsewhere.has(id)) primary.subjects.delete(id);
  primary.anchors = primary.anchors.filter((anchor) => anchor.roomId !== room.id);
  primary.partitions = primary.partitions.filter((entry) => entry.roomId !== room.id);
  primary.rooms = primary.rooms.filter((entry) => entry !== room);
  return {};
}

const COMMANDS = { create_room: createRoom, move_room: moveRoom, remove_room: removeRoom };

/**
 * Apply a room command to primary data. The rooms the command did not move or create are its
 * stationary rooms: their walls survive a join.
 *
 * @returns {{result: Object, preferredRoomIds: string[]}}
 */
export function applyRoomCommand(primary, operation, options) {
  const command = COMMANDS[operation.type];
  if (!command) throw new Error(`Unsupported room command: ${operation.type}`);
  const editedId = operation.type === 'create_room' ? null : operation.roomId;
  const stationary = primary.rooms.map((room) => room.id).filter((id) => id !== editedId);
  const result = command(primary, operation, options);
  return { result, preferredRoomIds: stationary };
}
