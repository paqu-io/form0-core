import { cleanPoint } from '../geometry.js';
import { lineFrame } from './grid.js';
import { beamContacts, beamLines } from './beam-contacts.js';

/**
 * Room beams following what they touch (3a-4, 2026-11-23; B3 of the beams round), with
 * `follow-attached.js`'s rules: an end keeps its place along a line that moved whole or only got
 * longer, shorter or moved square to itself, its fraction along one that turned or at a corner
 * move (4b D1); a beam lying along a line moves with it and keeps that side at its width now (a
 * wider beam grows away from the face); a beam on a beam that follows follows too. A beam left
 * under a centimetre, or turned back, refuses the edit, named (`beam-contents.js`).
 */

/** A beam left shorter than this (or turned back) is refused, naming it (as free walls, D4). */
const MIN_LENGTH_M = 0.01;

const gap = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
const dot = (u, v) => u.x * v.x + u.y * v.y;

/** Beams the edit didn't move that touch something (one only resized keeps its contacts). */
export function beamFollowers(before, primary, halfOf) {
  return before.rooms.flatMap((room) => {
    const after = primary.rooms.find((entry) => entry.id === room.id);
    return (room.beams || []).flatMap((beam) => {
      const now = after?.beams?.find((entry) => entry.id === beam.id);
      if (!beam.start || !beam.end || !now?.start || !now?.end) return [];
      if (gap(now.start, beam.start) > 1e-9 || gap(now.end, beam.end) > 1e-9) return [];
      const contacts = beamContacts(before, room, beam, halfOf);
      return contacts ? [{ beam, now, contacts, sized: now.width !== beam.width }] : [];
    });
  });
}

/** The line a beam anchor is now (another beam's centreline or side), or null. */
export function beamLineNow(primary, anchor) {
  const room = primary.rooms.find((entry) => entry.id === anchor.roomId);
  const beam = room?.beams?.find((entry) => entry.id === anchor.beamId);
  const lines = beam && beamLines(beam, beam.width > 0 ? beam.width / 2 : 0);
  return lines ? { frame: lines[anchor.line], divided: false } : null;
}

/**
 * Moves a beam with what it touches; whether it moved. `place(contacts, original, target, force)`
 * is `follow-attached.js`'s; `short` collects the beams following would leave too short.
 */
export function followBeam(follower, place, short) {
  const { contacts, now, beam, sized } = follower;
  const half = now.width > 0 ? now.width / 2 : 0;
  const target = (contact) => (contact.along ? Math.sign(contact.d) * half : contact.d);
  const ends = contacts.ends.map((list, index) =>
    place(list, index ? beam.end : beam.start, target, sized && list.some((entry) => entry.along))
  );
  if (ends[0] === beam.start && ends[1] === beam.end) return false;
  const frame = lineFrame(ends[0], ends[1]);
  const was = lineFrame(beam.start, beam.end);
  if (!frame || frame.length < MIN_LENGTH_M || dot(frame.tangent, was.tangent) <= 0) {
    short.add(now.id);
    return false;
  }
  short.delete(now.id);
  if (gap(ends[0], now.start) <= 1e-9 && gap(ends[1], now.end) <= 1e-9) return false;
  now.start = cleanPoint({ ...now.start, x: ends[0].x, y: ends[0].y });
  now.end = cleanPoint({ ...now.end, x: ends[1].x, y: ends[1].y });
  return true;
}
