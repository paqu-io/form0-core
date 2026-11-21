import { cleanPoint } from '../geometry.js';
import { SAME, along, lineFrame, pointAt } from './grid.js';
import { deriveBuildingPlanPieces } from './pieces.js';
import { halfWidth } from './partition-portions.js';
import {
  columnContacts,
  freeWallContacts,
  freeWallLines,
  reach,
  related,
  roomFaces,
} from './attached-contacts.js';

/**
 * Attached contents follow their wall (4b, 2026-11-21; rule 3). After an edit has moved rooms
 * or free walls, what touched a moved line before the edit (`attached-contacts.js`) moves with
 * it: a free wall's end (the wall gets longer or shorter, or turns), a free wall lying along it,
 * a column. A point keeps its place along a line that moved whole or only got longer, shorter
 * or moved square to itself, and its fraction along a line that turned or whose corner moved
 * (D1). A free wall touching a free wall that follows follows it too. What the edit itself moved
 * leads; what touches nothing stays. Rule 1 is checked afterwards, as for any edit.
 */

/** A free wall left shorter than this (or turned back) is refused, naming it (D4). */
const MIN_LENGTH_M = 0.01;

const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const cross = (u, v) => u.x * v.y - u.y * v.x;
const dot = (u, v) => u.x * v.x + u.y * v.y;
const sameFrame = (a, b) => gap(a.start, b.start) <= 1e-12 && gap(a.end, b.end) <= 1e-12;
const movedPath = (a, b) => a.length !== b.length || a.some((p, i) => gap(p, b[i]) > 1e-9);

/**
 * Where `foot`, a point of the line `before`, is on `after`: moved with a line that moved whole;
 * kept where it is along one that only got longer, shorter or moved square to itself; at its
 * fraction along one that turned, or along any at a corner move (`byFraction`).
 */
function mapOnto(foot, before, after, byFraction) {
  const shift = { x: after.start.x - before.start.x, y: after.start.y - before.start.y };
  const endShift = { x: after.end.x - before.end.x, y: after.end.y - before.end.y };
  if (gap(shift, endShift) <= 1e-9) return { x: foot.x + shift.x, y: foot.y + shift.y };
  const turned =
    Math.abs(cross(before.tangent, after.tangent)) > 1e-9 || dot(before.tangent, after.tangent) < 0;
  if (!turned && !byFraction) return pointAt(after, along(after, foot));
  return pointAt(after, (along(before, foot) / before.length) * after.length);
}

/** Where two lines (point, direction) cross, or null when they are (nearly) parallel. */
function crossing(p, u, q, v) {
  const det = cross(u, v);
  if (Math.abs(det) <= 1e-3) return null;
  const t = cross({ x: q.x - p.x, y: q.y - p.y }, v) / det;
  return { x: p.x + u.x * t, y: p.y + u.y * t };
}

/**
 * @param {object} before the floor's primary data before the edit
 * @param {object} primary the same floor after the edit (changed in place)
 * @param {{ specifications?: object, operation?: object }} options
 * @returns {{ shortFaceIds: string[] }} free wall rows following would leave too short
 */
export function followAttached(before, primary, { specifications, operation } = {}) {
  const byFraction = operation?.type === 'move_corner';
  const cached = (state) => {
    const halves = new Map();
    return (partition) => {
      if (!halves.has(partition.faceId))
        halves.set(partition.faceId, halfWidth(state, partition, specifications));
      return halves.get(partition.faceId);
    };
  };
  const [halfBefore, halfAfter] = [cached(before), cached(primary)];
  const widths = (state) => {
    let derived = null;
    return (roomId, point, tangent) => {
      derived ||= deriveBuildingPlanPieces(state, specifications);
      return wallWidthAt(derived, roomId, point, tangent);
    };
  };
  const [widthBefore, widthAfter] = [widths(before), widths(primary)];
  const followers = [
    ...runFollowers(before, primary, halfBefore),
    ...columnFollowers(before, primary, halfBefore, widthBefore),
  ];
  if (!followers.length) return { shortFaceIds: [] };

  /** The line an anchor is now, with whether a jog divided a room face (then kept in place). */
  const lineNow = (anchor, contact) => {
    if (anchor.type === 'wall') {
      const partition = primary.partitions.find((entry) => entry.faceId === anchor.faceId);
      const lines = partition && freeWallLines(partition, halfAfter(partition));
      return lines ? { frame: lines[anchor.line], divided: false } : null;
    }
    const room = primary.rooms.find((entry) => entry.id === anchor.roomId);
    const faces = roomFaces(room);
    const ids = (room?.vertices || []).map((vertex) => vertex.id);
    let index = ids.indexOf(anchor.startId);
    if (index < 0 || !ids.includes(anchor.endId)) return null;
    // The faces from its start vertex to its end vertex: one, unless a jog divided it.
    const chain = [];
    while (ids[index] !== anchor.endId && chain.length < ids.length) {
      chain.push(faces.find((face) => face.startId === ids[index]));
      index = (index + 1) % ids.length;
    }
    if (chain.some((face) => !face)) return null;
    if (chain.length === 1) return { frame: chain[0].frame, divided: false };
    // A face a move divided (a jog): the part along it where the contact was.
    const part = chain.find(({ frame }) => {
      if (Math.abs(cross(frame.tangent, contact.frame.tangent)) > 1e-6) return false;
      const stations = [frame.start, frame.end].map((p) => along(contact.frame, p));
      return (
        contact.station >= Math.min(...stations) - SAME &&
        contact.station <= Math.max(...stations) + SAME
      );
    });
    return part ? { frame: part.frame, divided: true } : null;
  };

  /** Where a point held by `contacts` goes: its lines' new place, each at the offset `target` gives. */
  const place = (contacts, original, target, force = false) => {
    const lines = [];
    let moved = force;
    for (const contact of contacts) {
      const now = lineNow(contact.anchor, contact);
      if (!now) continue;
      moved ||= !sameFrame(now.frame, contact.frame);
      const foot = mapOnto(contact.foot, contact.frame, now.frame, byFraction && !now.divided);
      lines.push({ foot, frame: now.frame, d: target(contact, now.frame, foot) });
    }
    if (!moved || !lines.length) return original;
    const at = ({ foot, frame, d }) => ({
      x: foot.x + frame.normal.x * d,
      y: foot.y + frame.normal.y * d,
    });
    let best = null;
    for (let i = 0; i < lines.length; i += 1)
      for (let j = i + 1; j < lines.length; j += 1) {
        const sin = Math.abs(cross(lines[i].frame.tangent, lines[j].frame.tangent));
        if (!best || sin > best.sin) best = { sin, pair: [lines[i], lines[j]] };
      }
    const [a, b] = best?.pair || [];
    const met = a && crossing(at(a), a.frame.tangent, at(b), b.frame.tangent);
    return met || at(lines[0]);
  };

  const short = new Set();
  const followRun = (follower) => {
    const { contacts, now } = follower;
    const ends = contacts.ends.map((list, index) =>
      place(list, index ? contacts.mid.end : contacts.mid.start, (contact) => contact.d)
    );
    if (ends[0] === contacts.mid.start && ends[1] === contacts.mid.end) return false;
    const frame = lineFrame(ends[0], ends[1]);
    if (!frame || frame.length < MIN_LENGTH_M || dot(frame.tangent, contacts.mid.tangent) <= 0) {
      short.add(now.faceId);
      return false;
    }
    short.delete(now.faceId);
    // Its face (the row's side, stored) beside the new centreline.
    const distance = contacts.sign * halfAfter(now);
    const next = ends.map((end) => ({
      x: end.x + frame.normal.x * distance,
      y: end.y + frame.normal.y * distance,
    }));
    if (!movedPath(now.path, next)) return false;
    now.path = now.path.map((point, index) => cleanPoint({ ...point, ...next[index] }));
    follower.moved = true;
    return true;
  };
  const followColumn = (follower) => {
    const { contacts, now, column } = follower;
    const half = { x: now.width / 2, y: now.height / 2 };
    const target = (contact, frame, foot) => columnTarget(contact, frame, foot, half, widthAfter);
    // Held to a wall's midline or far face, it moves when the wall's width changes too.
    const widened = contacts.some(
      ({ kind, anchor, at, width, frame }) =>
        (kind === 'midline' || kind === 'far') &&
        Math.abs((widthAfter(anchor.roomId, at, frame.tangent) ?? width) - width) > SAME
    );
    const point = place(contacts, column.position, target, follower.sized || widened);
    if (point === column.position || gap(point, now.position) <= 1e-9) return false;
    now.position = cleanPoint({ ...now.position, x: point.x, y: point.y });
    return true;
  };
  for (let pass = 0; pass <= followers.length; pass += 1) {
    let changed = false;
    for (const follower of followers)
      changed = (follower.column ? followColumn(follower) : followRun(follower)) || changed;
    if (!changed) break;
  }
  for (const follower of followers) if (follower.moved) settleRun(primary, follower);
  return { shortFaceIds: [...short] };
}

/**
 * The offset from its line a column keeps (D6): flush, it stays flush (its size as it is now, the
 * line as it turned); centred on a midline, it keeps to the midline as the wall's width changes;
 * flush with the far face, to the far face; in the wall, it keeps its distance from the face.
 */
function columnTarget(contact, frame, foot, half, widthAfter) {
  const e = reach(half, frame.normal);
  const { kind, outward } = contact;
  if (kind === 'flush') return Math.sign(contact.d) * e;
  if (kind === 'centred' || kind === 'inWall') return contact.d;
  if (kind === 'flushIn') return outward * -e;
  if (kind === 'flushOut') return outward * e;
  const on = pointAt(frame, Math.min(Math.max(along(frame, foot), 0), frame.length));
  const width = widthAfter(contact.anchor.roomId, on, frame.tangent) || contact.width;
  if (kind === 'midline') return outward * (contact.out + (width - contact.width) / 2);
  return outward * (width - e);
}

/**
 * A room wall's width at a point of a room's face running along `tangent` (at a corner, the
 * face that way), from the pieces derived; null if none.
 */
function wallWidthAt(derived, roomId, point, tangent) {
  for (const line of derived.lines) {
    if (line.roomId !== roomId || Math.abs(cross(line.frame.tangent, tangent)) > 1e-6) continue;
    const station = along(line.frame, point);
    const offset =
      (point.x - line.frame.start.x) * line.frame.normal.x +
      (point.y - line.frame.start.y) * line.frame.normal.y;
    if (Math.abs(offset) > 1e-3 || station < -1e-3 || station > line.frame.length + 1e-3) continue;
    const piece = derived.pieces.find((entry) =>
      entry.lines.some(
        (span) =>
          span.roomId === roomId &&
          span.index === line.index &&
          station >= span.from - 1e-3 &&
          station <= span.to + 1e-3
      )
    );
    if (piece) return piece.width;
  }
  return null;
}

/** Free wall rows the edit left in place that touch something. */
function runFollowers(before, primary, halfBefore) {
  return before.partitions.flatMap((partition) => {
    const now = primary.partitions.find((entry) => entry.faceId === partition.faceId);
    if (!now || movedPath(partition.path, now.path)) return [];
    const contacts = freeWallContacts(before, partition, halfBefore);
    if (!contacts || !contacts.ends.some((list) => list.length)) return [];
    return [{ partition, now, contacts }];
  });
}

/** Columns the edit didn't move that touch something (a column only resized keeps its contacts). */
function columnFollowers(before, primary, halfBefore, widthBefore) {
  return before.rooms.flatMap((room) => {
    const after = primary.rooms.find((entry) => entry.id === room.id);
    return (room.columns || []).flatMap((column) => {
      const now = after?.columns?.find((entry) => entry.id === column.id);
      if (!now?.position || !column.position || gap(now.position, column.position) > 1e-9)
        return [];
      const contacts = columnContacts(before, room, column, halfBefore, widthBefore);
      if (!contacts.length) return [];
      const sized = now.width !== column.width || now.height !== column.height;
      return [{ column, now, contacts, sized }];
    });
  });
}

/**
 * A free wall row that followed: an end joined to another row of its wall meets it where their
 * faces cross (an end at a return, or at another wall's end, stays where it was); its openings
 * keep their distance from the end that stayed (D3).
 */
function settleRun(primary, { partition, now, contacts }) {
  contacts.joints.forEach((joint, index) => {
    if (!joint) return;
    const end = index ? now.path.length - 1 : 0;
    const other = primary.partitions.find((entry) => entry.faceId === joint.faceId);
    if (!other || other.lineage?.editingReturn || !related(other, now)) {
      now.path[end] = cleanPoint({ ...now.path[end], ...pick(partition.path[end]) });
      return;
    }
    const own = lineFrame(now.path[0], now.path.at(-1));
    const theirs = lineFrame(other.path[0], other.path.at(-1));
    const met = own && theirs && crossing(own.start, own.tangent, theirs.start, theirs.tangent);
    if (!met || gap(met, now.path[end]) > 1) return;
    now.path[end] = cleanPoint({ ...now.path[end], ...met });
    const theirEnd = joint.end === 0 ? 0 : other.path.length - 1;
    other.path[theirEnd] = cleanPoint({ ...other.path[theirEnd], ...met });
  });
  const stayed = (index) => gap(partition.path.at(index), now.path.at(index)) <= SAME;
  if (stayed(0) || !stayed(-1)) return;
  const length = (path) => lineFrame(path[0], path.at(-1))?.length ?? 0;
  const change = length(now.path) - length(partition.path);
  for (const opening of primary.subjects.get(now.subjectId)?.openings || [])
    if (opening.faceId === now.faceId) opening.from += change;
}

const pick = ({ x, y }) => ({ x, y });
