import { SAME, along, pointAt } from './grid.js';
import { pieceMaterial } from './material.js';
import { convexPolygonOps as ops } from './polygon-ops.js';

/**
 * Where a jog of a growing stretch may stand: the room gains a strip beside the stretch (between
 * its old and its moved line); near the stretch's end that strip must stay out of other rooms'
 * wall material (a neighbour's corner, say), so the jog steps back to where that material begins.
 * Today's junction allowance, read from the material itself.
 *
 * @param {Object} primary Primary data before the edit.
 * @param {Object} derived Its derivation.
 * @param {Object} line The stretch's room line.
 * @param {number} station The jog's station on the line.
 * @param {boolean} atEnd The jog ends the stretch (else starts it).
 * @param {number} gained How far the moved line lies outside the old one (positive).
 * @returns {number} The station, stepped back towards the stretch if needed.
 */
export function retreatStation(primary, derived, line, station, atEnd, gained) {
  if (!(gained > SAME)) return station;
  const sign = atEnd ? 1 : -1;
  const widest = Math.max(0, ...derived.pieces.map((piece) => piece.width || 0));
  const reach = 2 * widest + SAME;
  const outward = line.outward * gained;
  const near = station - sign * reach;
  const strip = [
    pointAt(line.frame, near),
    pointAt(line.frame, station),
    pointAt(line.frame, station, outward),
    pointAt(line.frame, near, outward),
  ];
  // Material of every piece (corner fills need both walls), then only other rooms' pieces count.
  const { byPiece } = pieceMaterial(
    { rooms: primary.rooms, partitions: primary.partitions },
    { pieces: derived.pieces, caps: derived.caps }
  );
  let limit = station;
  for (const [piece, polygons] of byPiece) {
    if (piece.partition || piece.lines.some((entry) => entry.roomId === line.roomId)) continue;
    for (const polygon of polygons) {
      // The strip's part inside this material: strip minus (strip minus material).
      const outside = ops.difference(strip, [polygon]);
      const inside = outside.length
        ? ops.difference(strip, outside).filter((part) => ops.area([part]) > 1e-9)
        : [strip];
      for (const part of inside)
        for (const vertex of part) {
          const value = along(line.frame, vertex);
          limit = atEnd ? Math.min(limit, value) : Math.max(limit, value);
        }
    }
  }
  // Never step back past the stretch's other side of the search window.
  return atEnd ? Math.max(limit, near) : Math.min(limit, near);
}
