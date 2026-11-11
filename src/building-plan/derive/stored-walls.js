import { copyBuildingPlanData as copy } from '../model.js';
import { at, dot, project, segmentFrame } from '../geometry.js';
import { lineFrame, pointAt } from './grid.js';
import { edgeEnds, rowFrame, rowTangent } from './frames.js';

/** A row's binding to its wall segment, computed directly from the edge (as rebinding does). */
export function bindingFor(id, segment, edgeId, start, end) {
  const frame = segmentFrame(segment.start, segment.end);
  const edge = segmentFrame(start, end);
  const a = project(frame, edge.start);
  const b = project(frame, edge.end);
  const low = Math.max(0, Math.min(a.along, b.along));
  const high = Math.min(frame.length, Math.max(a.along, b.along));
  const edgeStart = project(edge, at(frame, low, a.offset)).along;
  const edgeEnd = project(edge, at(frame, high, a.offset)).along;
  return {
    id,
    segmentId: segment.id,
    edgeId,
    interval: [low, high],
    roomInterval: [Math.min(edgeStart, edgeEnd) || 0, Math.max(edgeStart, edgeEnd) || 0],
    direction: dot(frame.tangent, edge.tangent) >= 0 ? 1 : -1,
    side: a.offset < 0 ? -1 : 1,
  };
}

/** World endpoints of an opening anchored to a row, in the primary geometry. */
function openingEnds(context, opening) {
  const anchor = context.anchorByFace.get(opening.faceId);
  const partition = context.partitionByFace.get(opening.faceId);
  const ends = anchor
    ? edgeEnds(context.rooms.get(anchor.roomId), anchor.edgeId)
    : partition && [partition.path[0], partition.path[1]];
  const frame = ends && ends.every(Boolean) && lineFrame(...ends);
  return frame && [pointAt(frame, opening.from), pointAt(frame, opening.from + opening.width)];
}

function touchesCut(room, row) {
  if (row.partition) return row.partition.path.some((point) => point.editingCutId);
  const edge = room.edges.find((entry) => entry.id === row.edgeId);
  return [edge?.startId, edge?.endId].some(
    (id) => room.vertices.find((vertex) => vertex.id === id)?.editingCutId
  );
}

/** Walls in the stored order: retained subjects, each followed by its new divisions, then new. */
function orderedSubjects(context) {
  const ids = [];
  for (const id of context.original.keys()) {
    ids.push(id);
    for (const [child, source] of context.children) if (source === id) ids.push(child);
  }
  ids.push(...context.created);
  return ids.filter((id) => context.subjects.has(id)).map((id) => context.subjects.get(id));
}

/**
 * Stored walls from subjects and pieces. A wall runs along its reference row's edge, offset
 * outward by half its width, in the canonical direction (the reference row on side +1), so a
 * round trip reproduces today's axes. Sides keep their identity; the room each faces, the
 * exposure and every binding follow from the geometry. Rows mirror their side's answers.
 */
export function buildStoredWalls(context, rooms, rows) {
  const pieceBySubject = new Map(
    [...context.pieces, ...context.partitionPieces].map((piece) => [piece.subjectId, piece])
  );
  const walls = [];
  for (const subject of orderedSubjects(context)) {
    const piece = pieceBySubject.get(subject.id);
    const own = rows.filter((row) => row.wallId === subject.id);
    const reference = own.find((row) => row.id === subject.referenceFaceId) || own[0];
    const frame = reference && rowFrame(rooms, reference);
    if (!piece || !frame) {
      context.issues.push({ code: 'unwritten_subject', subjectId: subject.id });
      continue;
    }
    // A wall whose reference row now runs against the direction its side signs were defined for
    // (a copy whose row is in the other room, a reference that moved) turns its signs over.
    const tangent = rowTangent(rooms, reference);
    const basis = context.basis.get(subject.id);
    if (tangent && basis && tangent.x * basis.x + tangent.y * basis.y < 0) {
      for (const side of subject.sides) side.sign *= -1;
      for (const profile of context.profiles)
        if (profile.sourceId === subject.id) profile.sideSign *= -1;
    }
    const edge = segmentFrame(...frame.ends);
    const half = (piece.width || 0) / 2;
    const ends = [0, edge.length].map((station) => at(edge, station, -frame.bodySign * half));
    const [start, end] = frame.bodySign > 0 ? ends : [ends[1], ends[0]];
    const segment = {
      id: subject.segmentId,
      start,
      end,
      referenceOffset: half,
      ...copy(subject.segmentFlags),
    };
    const other = piece.partition
      ? reference.roomId
      : (piece.roomIds.find((id) => id && id !== reference.roomId) ?? null);
    const sides = subject.sides.map((side) => ({
      ...copy(side),
      roomId: side.sign > 0 ? reference.roomId : other,
    }));
    const axis = segmentFrame(start, end);
    const openings = { door: [], window: [] };
    for (const { faceId, from, ...opening } of copy(subject.openings)) {
      const points = openingEnds(context, { faceId, from, width: opening.width });
      const offset = points ? Math.min(...points.map((p) => project(axis, p).along)) : from;
      const written = { ...opening, segmentId: segment.id, offset };
      if (Object.hasOwn(written.values || {}, `${written.type}_offset_m`))
        written.values[`${written.type}_offset_m`] = offset;
      (openings[written.type] || openings.door).push(written);
    }
    const lineage = { ...(subject.lineage || {}) };
    if (own.some((row) => touchesCut(rooms.get(row.roomId), row)))
      lineage.explicitPhysicalSeparation = true;
    else delete lineage.explicitPhysicalSeparation;
    const {
      segmentId,
      segmentFlags,
      lastWidth,
      sides: _sides,
      openings: _openings,
      ...rest
    } = subject;
    const wall = {
      ...copy(rest),
      referenceFaceId: reference.id,
      segments: [segment],
      sides,
      exposure: sides.every((side) => side.roomId) ? 'interior' : 'exterior',
      lineage,
      doors: openings.door,
      windows: openings.window,
    };
    for (const row of own) {
      const binding = bindingFor(row.bindingId, segment, row.edgeId, ...rowFrame(rooms, row).ends);
      const side = sides.find((entry) => entry.sign === binding.side);
      row.face = {
        id: row.id,
        wallId: wall.id,
        sideId: side?.id ?? null,
        ...(row.partition
          ? { freePath: copy(row.partition.path), freeEdges: [...row.partition.freeEdges] }
          : { edgeIds: [row.edgeId] }),
        bindings: [binding],
        overrides: copy(side?.overrides || {}),
        values: copy(side?.values || {}),
        properties: {},
        provenance: {},
        ...(row.lineage ? { lineage: row.lineage } : {}),
      };
    }
    walls.push(wall);
  }
  return walls;
}
