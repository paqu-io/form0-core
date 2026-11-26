import { buildingPlanFaceSegments } from './model.js';
import { cleanLength as clean, dot, segmentFrame, subtract } from './geometry.js';

/**
 * The line a wall row's front view (A1, decided 2026-11-25) is drawn along: straight parts laid
 * end to end from the viewer's left, in metres. A room row's parts are the room's sides holding
 * it, corner to corner; a row on several sides (a jog) is unfolded, a side at a time. A free
 * wall's are its own stretches, seen from its row's side. Left and right are as WB3 counts them:
 * a row on its segment's side +1 sees the segment's start on its left.
 */

/**
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{
 *   x0: number, length: number, left: Point, right: Point,
 *   holds: (binding: object) => boolean,
 *   pieces: Array<{ faceId: string | null, from: number, to: number }>,
 * }} StripPart `right`: the unit direction to the viewer's right; `holds`: whether a binding of a
 *   row lies along this part; `pieces` in strip metres
 */

/** The direction to the viewer's right, facing a wall with `toward` pointing at the viewer. */
const rightOf = (toward) => ({ x: toward.y + 0, y: -toward.x + 0 });

/** Where a plan point lies along the strip, through the part it is on. */
export function alongStrip(part, point) {
  return part.x0 + dot(subtract(point, part.left), part.right);
}

/** Lays parts end to end, left to right, and places their pieces. */
function laid(parts) {
  let x0 = 0;
  for (const part of parts) {
    part.x0 = x0;
    x0 += part.length;
    part.pieces = part.spans
      .map(({ faceId, from, to }) => {
        const ends = [alongStrip(part, from), alongStrip(part, to)].sort((a, b) => a - b);
        return { faceId, from: clean(ends[0]), to: clean(ends[1]) };
      })
      .sort((a, b) => a.from - b.from);
    delete part.spans;
  }
  return parts;
}

/**
 * A room row's parts: the room's sides holding it (`buildingPlanRoomSides` in metres).
 * @param {Array<object>} sides
 * @param {string} faceId
 * @returns {StripPart[] | null} null when no side holds it
 */
export function sideParts(sides, faceId) {
  const holding = sides
    .map((side, index) => (side.pieces.some((piece) => piece.faceId === faceId) ? index : -1))
    .filter((index) => index >= 0);
  if (!holding.length) return null;
  // Around the room from the first side after a gap, so a run over the outline's start is whole.
  const count = sides.length;
  const first = holding.find((index) => !holding.includes((index - 1 + count) % count));
  const ordered = [
    ...holding.filter((index) => index >= (first ?? 0)),
    ...holding.filter((index) => index < (first ?? 0)),
  ];
  const parts = ordered.map((index) => {
    const side = sides[index];
    const frame = segmentFrame(side.start, side.end);
    const right = rightOf(side.normal);
    const forward = dot(frame.tangent, right) > 0;
    const edges = new Set(side.edgeIds);
    return {
      length: frame.length,
      left: forward ? side.start : side.end,
      right,
      forward,
      holds: (binding) => edges.has(binding.edgeId),
      spans: side.pieces,
    };
  });
  // The room's outline runs the same way on every side: right to left, read it backwards.
  if (!parts[0].forward) parts.reverse();
  return laid(parts);
}

/**
 * A free wall's parts: its row's stretches, one per binding.
 * @returns {StripPart[]}
 */
export function freeParts(floor, room, face) {
  const parts = buildingPlanFaceSegments(floor, room, face).map((portion) => {
    const frame = segmentFrame(portion.start, portion.end);
    const toward = { x: frame.normal.x * portion.side, y: frame.normal.y * portion.side };
    const right = rightOf(toward);
    const forward = dot(frame.tangent, right) > 0;
    return {
      length: frame.length,
      left: forward ? portion.start : portion.end,
      right,
      forward,
      holds: (binding) => binding.id === portion.id,
      spans: [{ faceId: face.id, from: portion.start, to: portion.end }],
    };
  });
  if (parts.length && !parts[0].forward) parts.reverse();
  return laid(parts);
}
