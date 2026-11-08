import { renewBuildingPlanRowIdentities, sameBuildingPlanCustomRows } from './custom-rows.js';
import {
  GEOMETRY_EPSILON as EPS,
  at,
  project,
  segmentFrame,
  pointInPolygon,
  dot,
  polygonArea,
  polygonEdges,
} from './geometry.js';
import { copyBuildingPlanData as copy, facesOfWall, rebindBuildingPlanFaces } from './model.js';
import { splitEditingFace } from './editing-cuts.js';
import { splitFacingRows } from './topology.js';
import { mergeWalls } from './wall-merge.js';
import { coalesceFacingRows, normalizeRoomBoundary } from './topology.js';
import { equalValue } from './model.js';
import { createWallSides } from './wall-sides.js';
import { buildingPlanFootprints, buildingPlanMaterialCovered } from './footprints.js';

/** A new connector wholly supplied by existing material is an end/corner profile.
 * Its copied answers already live on the retained source; it cannot become a new
 * physical owner just because the clear-room polygon has another straight edge.
 * Existing owners and deliberate cuts within an accepted span are never retired here.
 */
function retireMaterialProfiles(floor, before) {
  if (!before) return new Set();
  const candidates = floor.walls.filter((wall) => {
    if (
      before.walls.some((old) => old.id === wall.id) ||
      wall.sides.every((side) => side.roomId) ||
      wall.doors.length ||
      wall.windows.length
    )
      return false;
    const sourceId = wall.lineage?.profileSource?.wallId || wall.lineage?.dividedFromWallId;
    const source = before.walls.find((old) => old.id === sourceId);
    const retained = floor.walls.find((other) => other.id === sourceId);
    if (
      !source ||
      !retained ||
      !equalValue(wall.overrides, retained.overrides) ||
      !equalValue(wall.providerOverrides || {}, retained.providerOverrides || {}) ||
      !equalValue(wall.values, retained.values) ||
      !sameBuildingPlanCustomRows(wall, retained) ||
      wall.sides.some((side) => {
        const other = retained.sides.find(
          (other) => other.sign === side.sign * (wall.lineage?.profileDirection || 1)
        );
        return (
          !other ||
          !equalValue(side.overrides, other.overrides) ||
          !equalValue(side.providerOverrides || {}, other.providerOverrides || {}) ||
          !equalValue(side.values, other.values) ||
          !sameBuildingPlanCustomRows(side, other)
        );
      })
    )
      return false;
    const segment = wall.segments[0],
      old = source.segments[0];
    // A genuine drag-created return remains a physical run even when very
    // short. Only thickness connectors and derived profiles can retire here.
    if (segment.junction && !segment.thicknessProfile && !wall.lineage?.profileSource) return false;
    const frame = segmentFrame(old.start, old.end);
    const points = [segment.start, segment.end].map((p) => project(frame, p));
    const withinSource = points.every(
      (p) => Math.abs(p.offset) <= EPS && p.along >= -EPS && p.along <= frame.length + EPS
    );
    // A divider's width can leave a collinear gap in room coverage at a T-junction.
    // Its automatic adjacency piece may be supplied entirely by the other wall bands.
    if (!withinSource) return true;
    if (wall.lineage?.automaticDivision !== 'adjacency' || wall.lineage.explicitPhysicalSeparation)
      return false;
    const rooms = new Set(wall.sides.map((side) => side.roomId).filter(Boolean));
    return floor.walls.some(
      (other) =>
        other !== wall &&
        other.sides.every((side) => side.roomId && !rooms.has(side.roomId)) &&
        other.segments.some(
          (span) => Math.abs(dot(frame.normal, segmentFrame(span.start, span.end).tangent)) > EPS
        )
    );
  });
  const omitted = new Set(candidates.map((wall) => wall.id));
  if (!omitted.size) return omitted;
  const materialFloor = {
    ...floor,
    // Ownership follows gross construction bands. Hosted openings cut the
    // accepted material later; a void must never manufacture a new cap owner.
    walls: floor.walls
      .filter((wall) => !omitted.has(wall.id))
      .map((wall) => ({
        ...wall,
        doors: [],
        windows: [],
      })),
    rooms: floor.rooms.map((room) => ({
      ...room,
      faces: room.faces.filter((face) => !omitted.has(face.wallId)),
    })),
  };
  const material = buildingPlanFootprints(materialFloor, 1).wallFootprints.flatMap(
    (wall) => wall.polygons
  );
  const retired = new Set();
  for (const wall of candidates) {
    const segment = wall.segments[0],
      frame = segmentFrame(segment.start, segment.end);
    const half = (wall.properties.wall_thickness_m ?? 0) / 2;
    if (!(half > EPS)) continue;
    const polygon = [
      at(frame, 0, half),
      at(frame, frame.length, half),
      at(frame, frame.length, -half),
      at(frame, 0, -half),
    ];
    if (buildingPlanMaterialCovered(polygon, material)) {
      const wallId = wall.lineage?.profileSource?.wallId || wall.lineage.dividedFromWallId;
      const linked = facesOfWall(floor, wall.id);
      const transfers = [];
      let canRetire = true;
      for (const { room, face } of linked) {
        const previous = before.rooms.find((other) => other.id === room.id)?.faces || [];
        if (!previous.some((other) => other.id === face.id)) continue;
        const target = room.faces.find((other) => other.wallId === wallId && other.id !== face.id);
        if (!target || previous.some((other) => other.id === target.id)) {
          canRetire = false;
          break;
        }
        transfers.push({ face, target });
      }
      if (!canRetire) continue;
      // A temporary cap can capture the old facing identity during corner division.
      // Keep that accepted row on the surviving source rather than losing an editor.
      const retained = floor.walls.find((other) => other.id === wallId);
      for (const { face, target } of transfers) {
        if (retained.referenceFaceId === target.id) retained.referenceFaceId = face.id;
        target.id = face.id;
      }
      retired.add(wall.id);
      for (const { room, face } of linked)
        for (const edge of room.edges.filter((edge) => face.edgeIds?.includes(edge.id)))
          edge.profile = wall.lineage?.profileSource || {
            wallId,
            sideSign: face.bindings[0]?.side,
          };
    }
  }
  floor.walls = floor.walls.filter((wall) => !retired.has(wall.id));
  for (const room of floor.rooms)
    room.faces = room.faces.filter((face) => !retired.has(face.wallId));
  return retired;
}

/** When a corner straightens, absorb its profile into the compatible adjacent
 * longitudinal run with the same room coverage, preserving opening positions. */
function absorbCollinearProfiles(floor, createId) {
  for (const room of floor.rooms)
    for (const edge of polygonEdges(room)) {
      const stored = room.edges.find((entry) => entry.id === edge.id);
      if (!stored.profile) continue;
      const source = floor.walls.find((wall) => wall.id === stored.profile.wallId);
      for (const face of room.faces.filter((face) => !face.freePath)) {
        const wall = floor.walls.find((wall) => wall.id === face.wallId);
        if (
          !wall ||
          !source ||
          !equalValue(wall.overrides, source.overrides) ||
          !equalValue(wall.values, source.values) ||
          !equalValue(wall.providerOverrides || {}, source.providerOverrides || {})
        )
          continue;
        const segment = wall.segments[0],
          frame = segmentFrame(segment.start, segment.end);
        const original = segmentFrame(source.segments[0].start, source.segments[0].end);
        const direction = dot(original.tangent, frame.tangent) >= 0 ? 1 : -1;
        if (
          source.sides.some((side) => {
            const other = wall.sides.find((other) => other.sign === side.sign * direction);
            return (
              !other ||
              !equalValue(side.overrides, other.overrides) ||
              !equalValue(side.providerOverrides || {}, other.providerOverrides || {}) ||
              !equalValue(side.values, other.values) ||
              !equalValue(side.repeatable || {}, other.repeatable || {})
            );
          })
        )
          continue;
        const half = (wall.properties.wall_thickness_m ?? 0) / 2;
        const side = dot(frame.tangent, edge.tangent) > 0 ? 1 : -1;
        const points = [edge.start, edge.end].map((p) => project(frame, p));
        if (
          !(half > EPS) ||
          Math.abs(dot(frame.normal, edge.tangent)) > EPS ||
          points.some(
            (p) => Math.abs(p.offset - side * Math.sign(polygonArea(room.vertices)) * half) > EPS
          )
        )
          continue;
        const low = Math.min(...points.map((p) => p.along)),
          high = Math.max(...points.map((p) => p.along));
        if (low > frame.length + EPS || high < -EPS) continue;
        const middle = (low + high) / 2;
        if (
          wall.sides.some((side) => {
            const point = at(frame, middle, side.sign * (half + EPS * 4));
            const covering = floor.rooms.find((room) =>
              pointInPolygon(point, room.vertices, false)
            );
            return (covering?.id ?? null) !== side.roomId;
          })
        )
          continue;
        const from = Math.min(0, low),
          to = Math.max(frame.length, high);
        segment.start = at(frame, from);
        segment.end = at(frame, to);
        for (const opening of [...wall.doors, ...wall.windows]) opening.offset -= from;
        face.edgeIds.push(edge.id);
        delete stored.profile;
        break;
      }
    }
  rebindBuildingPlanFaces(floor, createId);
}

const fail = (code, message, details = {}) => {
  const error = new Error(message);
  error.issues = [{ code, message, ...details }];
  throw error;
};

function coverage(floor, wall, segment, along) {
  const frame = segmentFrame(segment.start, segment.end);
  const half = (wall.properties.wall_thickness_m ?? (segment.referenceOffset ?? 0) * 2) / 2;
  return [-1, 1].map((sign) => {
    const direct = facesOfWall(floor, wall.id).find(({ face }) =>
      face.bindings.some(
        (binding) =>
          binding.segmentId === segment.id &&
          binding.side === sign &&
          binding.interval[0] < along + EPS &&
          binding.interval[1] > along - EPS
      )
    );
    if (direct) return direct.room.id;
    // An internal free partition can have the same room on both sides.
    return (
      floor.rooms.find(
        (room) =>
          room.faces.some((face) => face.wallId === wall.id && face.freePath) &&
          pointInPolygon(at(frame, along, sign * (half + EPS * 4)), room.vertices, false)
      )?.id ?? null
    );
  });
}

function divideFacingRows(floor, wall, segment, cuts, createId) {
  const temporary = new Set();
  for (const cut of cuts.slice(1, -1)) {
    const crossing = facesOfWall(floor, wall.id).find(({ face }) =>
      face.bindings.some(
        (binding) =>
          binding.segmentId === segment.id &&
          binding.interval[0] < cut - EPS &&
          binding.interval[1] > cut + EPS
      )
    );
    if (!crossing) continue;
    const binding = crossing.face.bindings.find(
      (b) => b.segmentId === segment.id && b.interval[0] < cut - EPS && b.interval[1] > cut + EPS
    );
    const from = Math.min(
      ...crossing.face.bindings
        .filter((b) => b.edgeId === binding.edgeId)
        .map((b) => b.roomInterval[0])
    );
    const offset =
      binding.roomInterval[0] -
      from +
      (binding.direction > 0 ? cut - binding.interval[0] : binding.interval[1] - cut);
    temporary.add(
      splitEditingFace(
        floor,
        { faceId: crossing.face.id, edgeId: binding.edgeId, segmentId: segment.id, offset },
        createId
      ).created.id
    );
  }
  for (const room of floor.rooms)
    for (const point of [...room.vertices, ...room.faces.flatMap((face) => face.freePath || [])])
      if (temporary.has(point.editingCutId)) {
        point.physicalBoundaryId = point.editingCutId;
        delete point.editingCutId;
      }
}

/** Normalize accepted ownership independently of the axis planner's temporary geometry spans. */
export function normalizePhysicalPieces(floor, createId, before = null) {
  rebindBuildingPlanFaces(floor, createId);
  const divisions = [];
  for (const wall of [...floor.walls]) {
    if (!wall.segments.length) {
      for (const { room, face } of facesOfWall(floor, wall.id)) {
        if (face.freePath || face.bindings.length) continue;
        const covered = face.edgeIds.every((id) => {
          const edge = room.edges.find((edge) => edge.id === id);
          if (!edge) return true;
          const vertices =
            edge &&
            [edge.startId, edge.endId].map((id) => room.vertices.find((point) => point.id === id));
          const length = segmentFrame(...vertices).length;
          const intervals = room.faces
            .filter(
              (other) =>
                other !== face &&
                other.wallId !== wall.id &&
                equalValue(other.overrides, face.overrides) &&
                equalValue(other.values, face.values)
            )
            .flatMap((other) =>
              other.bindings
                .filter((binding) => binding.edgeId === id)
                .map((binding) => binding.roomInterval)
            )
            .sort((a, b) => a[0] - b[0]);
          let end = 0;
          for (const [from, to] of intervals) {
            if (from > end + EPS) return false;
            end = Math.max(end, to);
          }
          return end >= length - EPS;
        });
        if (covered) room.faces = room.faces.filter((entry) => entry !== face);
      }
    }
    if (
      !wall.segments.length ||
      (wall.lineage?.automaticDivision && !facesOfWall(floor, wall.id).length)
    ) {
      const root = wall.lineage?.splitFromWallId || wall.lineage?.jogOriginWallId;
      const hasRows = [wall, ...(wall.sides || [])].some((subject) =>
        Object.values(subject.repeatable || {}).some((rows) => rows.length)
      );
      const survivor = floor.walls.find(
        (other) =>
          other !== wall &&
          other.segments.length &&
          root &&
          (other.id === root || other.lineage?.splitFromWallId === root) &&
          equalValue(other.overrides, wall.overrides) &&
          equalValue(other.providerOverrides || {}, wall.providerOverrides || {}) &&
          equalValue(other.values, wall.values) &&
          (wall.sides || []).every((side) => {
            const target = other.sides?.find((entry) => entry.sign === side.sign);
            return (
              target &&
              equalValue(target.overrides, side.overrides) &&
              equalValue(target.providerOverrides || {}, side.providerOverrides || {}) &&
              equalValue(target.values, side.values)
            );
          })
      );
      const hasAnswers = [wall, ...(wall.sides || [])].some((subject) =>
        ['overrides', 'providerOverrides', 'values'].some(
          (key) => Object.keys(subject[key] || {}).length
        )
      );
      if (
        facesOfWall(floor, wall.id).length ||
        wall.doors.length ||
        wall.windows.length ||
        hasRows ||
        (hasAnswers && !survivor)
      )
        fail(
          'wall_retirement_conflict',
          'This edit removes a physical piece with unresolved answers or records. Resolve them before continuing.',
          { subject: { type: 'wall', id: wall.id } }
        );
      for (const room of floor.rooms)
        for (const edge of room.edges.filter((edge) => edge.profile?.wallId === wall.id)) {
          if (survivor) edge.profile.wallId = survivor.id;
          else delete edge.profile;
        }
      floor.walls = floor.walls.filter((entry) => entry !== wall);
      continue;
    }
    const original = copy(wall);
    const reference = facesOfWall(floor, wall.id).find(
      ({ face }) => face.id === wall.referenceFaceId
    );
    // The reference face can acquire a connector at its first endpoint. The
    // accepted span, rather than that new connector, retains physical identity.
    const primaryId = wall.segments[0].id;
    const referenceBinding = (
      reference?.face.bindings.filter((binding) => binding.segmentId === primaryId) || []
    ).concat(
      facesOfWall(floor, wall.id)
        .filter(({ room }) => !reference || room.id === reference.room.id)
        .flatMap(({ face }) => face.bindings.filter((binding) => binding.segmentId === primaryId))
    )[0];
    const referenceStation =
      referenceBinding?.interval[referenceBinding.direction > 0 ? 0 : 1] ?? 0;
    const oldSides = wall.sides || createWallSides(createId);
    const pieces = [];
    for (const segment of [...wall.segments]) {
      const frame = segmentFrame(segment.start, segment.end);
      const bindings = facesOfWall(floor, wall.id).flatMap(({ face }) =>
        face.bindings.filter((b) => b.segmentId === segment.id)
      );
      const stations = [0, frame.length, ...bindings.flatMap((b) => b.interval)]
        .sort((a, b) => a - b)
        .filter((v, i, list) => !i || v - list[i - 1] > EPS);
      const cuts = [0];
      let previous = null;
      for (let i = 0; i < stations.length - 1; i++) {
        const signature = coverage(floor, wall, segment, (stations[i] + stations[i + 1]) / 2);
        const explicit = floor.rooms.some((room) =>
          [...room.vertices, ...room.faces.flatMap((face) => face.freePath || [])].some(
            (point) =>
              point.editingCutId &&
              Math.abs(project(frame, point).along - stations[i]) < EPS &&
              Math.abs(
                Math.abs(project(frame, point).offset) - (wall.properties.wall_thickness_m ?? 0) / 2
              ) < EPS
          )
        );
        if (i && (JSON.stringify(signature) !== JSON.stringify(previous) || explicit))
          cuts.push(stations[i]);
        previous = signature;
      }
      cuts.push(frame.length);
      for (const cut of cuts.slice(1, -1))
        for (const opening of [...wall.doors, ...wall.windows])
          if (
            opening.segmentId === segment.id &&
            opening.offset < cut - EPS &&
            opening.offset + opening.width > cut + EPS
          )
            fail(
              'opening_crosses_split',
              'A required room-adjacency boundary passes through an opening. Move the opening or adjust the room.',
              { subject: { type: opening.type, id: opening.id }, openingIds: [opening.id] }
            );
      divideFacingRows(floor, wall, segment, cuts, createId);
      for (let i = 0; i < cuts.length - 1; i++) {
        const low = cuts[i],
          high = cuts[i + 1];
        for (const opening of [...wall.doors, ...wall.windows])
          if (
            opening.segmentId === segment.id &&
            opening.offset < high - EPS &&
            opening.offset + opening.width > high + EPS
          )
            fail(
              'opening_crosses_split',
              'A required room-adjacency boundary passes through an opening. Move the opening or adjust the room.',
              { subject: { type: opening.type, id: opening.id } }
            );
        const part = {
          ...copy(segment),
          id: i ? createId() : segment.id,
          start: at(frame, low),
          end: at(frame, high),
        };
        delete part.overrides;
        delete part.properties;
        delete part.provenance;
        pieces.push({
          segment: part,
          sourceId: segment.id,
          low,
          high,
          rooms: coverage(floor, wall, segment, (low + high) / 2),
        });
      }
    }
    if (!pieces.length) continue;
    wall.segments = pieces.map((piece) => piece.segment);
    for (const collection of ['doors', 'windows'])
      for (const opening of wall[collection]) {
        const piece = pieces.find(
          (p) =>
            p.sourceId === opening.segmentId &&
            opening.offset >= p.low - EPS &&
            opening.offset + opening.width <= p.high + EPS
        );
        if (!piece)
          fail('opening_crosses_split', 'An opening cannot span separate physical pieces.');
        opening.segmentId = piece.segment.id;
        opening.offset -= piece.low;
      }
    rebindBuildingPlanFaces(floor, createId);
    const owners = new Map();
    const referencePiece = pieces.findIndex(
      (piece) =>
        piece.sourceId === (referenceBinding?.segmentId || original.segments[0].id) &&
        referenceStation >= piece.low - EPS &&
        referenceStation <= piece.high + EPS &&
        (!reference || piece.rooms.includes(reference.room.id))
    );
    const retained = Math.max(0, referencePiece);
    const newWalls = pieces.map((piece, index) => {
      const target = index !== retained ? { ...copy(original), id: createId() } : wall;
      target.segments = [piece.segment];
      target.lineage = {
        ...target.lineage,
        ...(pieces.length > 1
          ? {
              splitFromWallId: original.lineage?.splitFromWallId || original.id,
              dividedFromWallId: original.id,
              automaticDivision: 'adjacency',
            }
          : {}),
      };
      delete target.lineage.thicknessProfile;
      target.sides = oldSides.map((side, i) => ({
        ...copy(side),
        id: index !== retained ? createId() : side.id,
        roomId: piece.rooms[side.sign > 0 ? 1 : 0],
      }));
      if (index !== retained) {
        renewBuildingPlanRowIdentities(target, createId);
        for (const side of target.sides) renewBuildingPlanRowIdentities(side, createId);
      }
      target.exposure = piece.rooms.every(Boolean) ? 'interior' : 'exterior';
      for (const collection of ['doors', 'windows'])
        target[collection] = original[collection]
          .filter((opening) => {
            const originalPiece = pieces.find(
              (p) =>
                p.sourceId === opening.segmentId &&
                opening.offset >= p.low - EPS &&
                opening.offset + opening.width <= p.high + EPS
            );
            return originalPiece === piece;
          })
          .map((opening) => ({
            ...copy(opening),
            segmentId: piece.segment.id,
            offset: opening.offset - piece.low,
          }));
      for (const opening of [...target.doors, ...target.windows])
        if (Object.hasOwn(opening.values || {}, `${opening.type}_offset_m`))
          opening.values[`${opening.type}_offset_m`] = opening.offset;
      owners.set(piece.segment.id, target.id);
      return target;
    });
    if (newWalls.length > 1) divisions.push({ source: original, walls: newWalls });
    floor.walls.splice(floor.walls.indexOf(wall), 1, ...newWalls);
    splitFacingRows(floor, createId, owners, new Set([wall.id]));
  }
  rebindBuildingPlanFaces(floor, createId);
  for (const wall of floor.walls) {
    for (const { room, face } of facesOfWall(floor, wall.id)) {
      const side = wall.sides.find((entry) => entry.sign === face.bindings[0]?.side);
      if (!side) continue;
      face.sideId = side.id;
      side.roomId = room.id;
      for (const [key, value] of Object.entries(face.overrides || {})) {
        if (
          Object.hasOwn(side.overrides, key) &&
          JSON.stringify(side.overrides[key]) !== JSON.stringify(value)
        )
          fail(
            'conflicting_surface_answers',
            'Resolve the differing answers for this physical wall surface before attaching rooms.'
          );
        side.overrides[key] = copy(value);
      }
      if (!Object.keys(side.values).length) Object.assign(side.values, copy(face.values || {}));
      face.overrides = copy(side.overrides);
      face.values = copy(side.values);
    }
    wall.exposure = wall.sides.every((side) => side.roomId) ? 'interior' : 'exterior';
    const explicit = facesOfWall(floor, wall.id).some(
      ({ room, face }) =>
        face.freePath?.some((point) => point.editingCutId) ||
        room.vertices.some(
          (p) =>
            p.editingCutId &&
            face.edgeIds?.some((id) =>
              room.edges.some((edge) => edge.id === id && [edge.startId, edge.endId].includes(p.id))
            )
        )
    );
    if (explicit) wall.lineage = { ...wall.lineage, explicitPhysicalSeparation: true };
    else if (wall.lineage) delete wall.lineage.explicitPhysicalSeparation;
  }
  const retiredProfiles = retireMaterialProfiles(floor, before);
  absorbCollinearProfiles(floor, createId);
  for (const division of divisions)
    division.walls = division.walls.filter((wall) => !retiredProfiles.has(wall.id));
  // Automatic boundaries may disappear; deliberate cuts and differing answer intent survive.
  let joined = true;
  while (joined) {
    joined = false;
    for (const a of [...floor.walls].sort(
      (a, b) =>
        Number(b.id === b.lineage?.splitFromWallId) - Number(a.id === a.lineage?.splitFromWallId)
    )) {
      if (!a.lineage?.automaticDivision || a.lineage.explicitPhysicalSeparation) continue;
      for (const b of floor.walls) {
        if (
          a === b ||
          b.lineage?.explicitPhysicalSeparation ||
          (!b.lineage?.automaticDivision &&
            (a.lineage.splitFromWallId || a.id) !== (b.lineage?.splitFromWallId || b.id))
        )
          continue;
        if (
          !equalValue(a.overrides, b.overrides) ||
          !equalValue(a.providerOverrides || {}, b.providerOverrides || {}) ||
          !equalValue(a.values, b.values) ||
          !equalValue(a.repeatable || {}, b.repeatable || {})
        )
          continue;
        const af = segmentFrame(a.segments[0].start, a.segments[0].end),
          bf = segmentFrame(b.segments[0].start, b.segments[0].end);
        const direction = af.tangent.x * bf.tangent.x + af.tangent.y * bf.tangent.y >= 0 ? 1 : -1;
        if (
          Math.abs(project(af, bf.start).offset) > EPS ||
          Math.abs(project(af, bf.end).offset) > EPS ||
          ![bf.start, bf.end].some(
            (p) =>
              Math.abs(project(af, p).along) < EPS ||
              Math.abs(project(af, p).along - af.length) < EPS
          )
        )
          continue;
        if (
          a.sides.some((side) => {
            const other = b.sides.find((entry) => entry.sign === side.sign * direction);
            return (
              !other ||
              side.roomId !== other.roomId ||
              !equalValue(side.overrides, other.overrides) ||
              !equalValue(side.providerOverrides || {}, other.providerOverrides || {}) ||
              !equalValue(side.values, other.values) ||
              !equalValue(side.repeatable || {}, other.repeatable || {})
            );
          })
        )
          continue;
        mergeWalls(floor, a, b, {}, createId);
        joined = true;
        break;
      }
      if (joined) break;
    }
  }
  for (const room of floor.rooms) {
    for (const vertex of room.vertices)
      if (vertex.physicalBoundaryId) {
        const edges = room.edges.filter(
          (edge) => edge.startId === vertex.id || edge.endId === vertex.id
        );
        const owners = new Set(
          room.faces
            .filter((face) => face.edgeIds?.some((id) => edges.some((edge) => edge.id === id)))
            .map((face) => face.wallId)
        );
        const captured = edges.every((edge) =>
          room.faces.some((face) => face.bindings.some((binding) => binding.edgeId === edge.id))
        );
        if (owners.size <= 1 && captured) delete vertex.physicalBoundaryId;
      }
    normalizeRoomBoundary(floor, room, createId);
  }
  coalesceFacingRows(floor);
  rebindBuildingPlanFaces(floor, createId);
  return divisions.filter((division) => division.walls.length > 1);
}
