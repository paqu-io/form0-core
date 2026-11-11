import { wallCornerPolygon } from '../corner-profiles.js';
import { SAME, lineFrame, offset, pointAt } from './grid.js';
import { roomLines, signedArea } from './room-lines.js';
import { convexPolygonOps } from './polygon-ops.js';
import { extractBuildingPlanPrimary } from './extract.js';

const band = (frame, from, to, half) => [
  pointAt(frame, from, half),
  pointAt(frame, to, half),
  pointAt(frame, to, -half),
  pointAt(frame, from, -half),
];

/** Opening rectangles of the stored walls, as world polygons with their supporting axis. */
function openingRects(floor) {
  const rects = [];
  for (const wall of floor.walls)
    for (const opening of [...wall.doors, ...wall.windows]) {
      const segment = wall.segments.find((entry) => entry.id === opening.segmentId);
      const frame = segment && lineFrame(segment.start, segment.end);
      const width = wall.properties?.wall_thickness_m;
      if (!frame || !(width > 0)) continue;
      rects.push({
        axis: frame,
        polygon: band(frame, opening.offset, opening.offset + opening.width, width / 2),
      });
    }
  return rects;
}

const collinear = (a, b) =>
  Math.abs(offset(a, b.start)) <= SAME * 4 && Math.abs(offset(a, b.end)) <= SAME * 4;

/**
 * Wall material from derived pieces: a band per piece and a fill at each outer room corner
 * where two pieces (or a supplied cap) meet, minus the clear space of the pieces' rooms and the
 * openings on the same axis. Material belongs to the piece's subject; a corner fill belongs to
 * the incoming piece, as today.
 *
 * @param {Object} floor Stored floor (rooms, openings).
 * @param {{pieces: Array<Object>, caps: Array<Object>}} derived Output of the derivation.
 * @param {{ops?: import('./polygon-ops.js').PolygonOps}} [options]
 * @returns {{bySubject: Map<string|null, Array<Array<{x: number, y: number}>>>}}
 */
export function deriveBuildingPlanMaterial(floor, derived, { ops = convexPolygonOps } = {}) {
  const rooms = new Map(floor.rooms.map((room) => [room.id, room]));
  const linesByRoom = new Map(floor.rooms.map((room) => [room.id, roomLines(room)]));
  const openings = openingRects(floor);
  const bySubject = new Map();
  // Counter-clockwise, as today's footprints, so overlapping pieces never cancel in a union.
  const oriented = (polygon) => (signedArea(polygon) < 0 ? [...polygon].reverse() : polygon);
  const add = (subjectId, polygons) =>
    bySubject.set(subjectId, [
      ...(bySubject.get(subjectId) || []),
      ...polygons.filter((polygon) => polygon.length >= 3).map(oriented),
    ]);
  const clipFor = (polygon, roomIds, axes) => {
    const clips = [...new Set(roomIds)].filter(Boolean).map((id) => rooms.get(id).vertices);
    for (const opening of openings)
      if (axes.some((axis) => collinear(axis, opening.axis))) clips.push(opening.polygon);
    return ops.difference(polygon, clips);
  };
  const axisOf = (piece) => lineFrame(piece.axis.start, piece.axis.end);

  // Material follows the resolved thickness: an unknown thickness draws no material (hosts show
  // a schematic line), although its geometry keeps the last width.
  for (const piece of derived.pieces) {
    const axis = axisOf(piece);
    if (!axis || !(piece.thickness > 0)) continue;
    // A partition stands inside its room, so its room's clear space does not clip it.
    const clipRooms = piece.partition ? [] : piece.roomIds;
    add(
      piece.subjectId,
      clipFor(band(axis, 0, axis.length, piece.thickness / 2), clipRooms, [axis])
    );
  }

  // Corner fills: where line k of a room ends and line k+1 starts.
  const boundary = derived.pieces.filter((piece) => !piece.partition);
  const endPiece = (roomId, index, atEnd, length) =>
    boundary.find((piece) =>
      piece.lines.some(
        (line) =>
          line.roomId === roomId &&
          line.index === index &&
          Math.abs((atEnd ? line.to : line.from) - (atEnd ? length : 0)) <= SAME
      )
    ) ||
    derived.caps.find(
      (cap) =>
        cap.roomId === roomId &&
        cap.index === index &&
        Math.abs((atEnd ? cap.to : cap.from) - (atEnd ? length : 0)) <= SAME
    );
  const sourcePiece = (cap) =>
    cap.sourceId === undefined
      ? null
      : derived.pieces.find((piece) => piece.subjectId === cap.sourceId);
  const widthOf = (entry) => {
    if (entry.sourceId === undefined) return entry.thickness;
    // A supplied cap takes its source's thickness.
    return derived.pieces.find((piece) => piece.subjectId === entry.sourceId)?.thickness;
  };
  for (const room of floor.rooms) {
    const lines = linesByRoom.get(room.id);
    const side = -(lines[0]?.outward ?? 1);
    for (let k = 0; k < lines.length; k++) {
      const incoming = lines[k];
      const outgoing = lines[(k + 1) % lines.length];
      const a = endPiece(room.id, incoming.index, true, incoming.frame.length);
      const b = endPiece(room.id, outgoing.index, false, outgoing.frame.length);
      if (!a || !b) continue;
      const polygon = wallCornerPolygon(
        incoming.frame,
        outgoing.frame,
        incoming.frame.end,
        widthOf(a),
        widthOf(b),
        side
      );
      if (!polygon) continue;
      const owner = a.subjectId !== undefined ? a.subjectId : a.sourceId;
      // A supplied cap stands on its source's axis, so openings there clip the corner too.
      const axes = [a, b]
        .map((entry) => (entry.axis ? entry : sourcePiece(entry)))
        .filter(Boolean)
        .map(axisOf)
        .filter(Boolean);
      add(owner, clipFor(polygon, [room.id, ...(a.roomIds || []), ...(b.roomIds || [])], axes));
    }
  }

  // A Split inside a partition can leave a jog; fill its outer corner like a room corner.
  const partitions = extractBuildingPlanPrimary(floor).partitions;
  for (const a of partitions)
    for (const b of partitions) {
      const point = a.path.at(-1);
      const next = b.path[0];
      if (
        a === b ||
        a.roomId !== b.roomId ||
        !point.editingCutId ||
        point.editingCutId !== next.editingCutId ||
        Math.hypot(point.x - next.x, point.y - next.y) > SAME ||
        a.sides.at(-1) == null ||
        a.sides.at(-1) !== b.sides[0]
      )
        continue;
      const [pieceA, pieceB] = [a, b].map((entry) =>
        derived.pieces.find((piece) => piece.partition && piece.faceIds[0] === entry.faceId)
      );
      const incoming = lineFrame(a.path.at(-2), point);
      const outgoing = lineFrame(next, b.path[1]);
      if (!pieceA || !pieceB || !incoming || !outgoing) continue;
      const polygon = wallCornerPolygon(
        incoming,
        outgoing,
        point,
        pieceA.thickness,
        pieceB.thickness,
        a.sides.at(-1)
      );
      if (polygon) add(pieceA.subjectId, [polygon]);
    }
  return { bySubject };
}
