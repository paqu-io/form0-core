import { renewBuildingPlanRowIdentities } from './custom-rows.js';
import {
  GEOMETRY_EPSILON as EPS,
  at,
  project,
  segmentFrame,
  pointInPolygon,
  dot,
  polygonEdges,
} from './geometry.js';
import {
  copyBuildingPlanData as copy,
  facesOfWall,
  rebindBuildingPlanFaces,
  planIssue,
} from './model.js';
import { splitEditingFace } from './editing-cuts.js';
import { splitFacingRows, separatePhysicalWallRuns } from './topology.js';
import { mergeWalls } from './wall-merge.js';
import { coalesceFacingRows, normalizeRoomBoundary } from './topology.js';
import { equalValue } from './model.js';
import { createWallSides } from './wall-sides.js';
import { buildingPlanEditingCutStations } from './wall-divisions.js';
import { normalizeBuildingPlanMaterialProfiles } from './material-profiles.js';

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

/** Partition one planning span without changing its supporting line or captured answers. */
function dividePhysicalSpan(floor, wall, segment, cuts, createId) {
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
  const frame = segmentFrame(segment.start, segment.end);
  return cuts.slice(1).map((high, index) => {
    const low = cuts[index];
    const part = {
      ...copy(segment),
      id: index ? createId() : segment.id,
      start: at(frame, low),
      end: at(frame, high),
    };
    delete part.overrides;
    delete part.properties;
    delete part.provenance;
    return {
      segment: part,
      sourceId: segment.id,
      low,
      high,
      rooms: coverage(floor, wall, segment, (low + high) / 2),
    };
  });
}

/** Keep the accepted span/owner on construction covered by its reference room. */
function retainReferenceSpan(pieces, sourceId, station, roomId) {
  const retained = Math.max(
    0,
    pieces.findIndex(
      (piece) =>
        piece.sourceId === sourceId &&
        station >= piece.low - EPS &&
        station <= piece.high + EPS &&
        (!roomId || piece.rooms.includes(roomId))
    )
  );
  const target = pieces[retained];
  const first = pieces.find((piece) => piece.segment.id === target.sourceId);
  if (first && first !== target)
    [first.segment.id, target.segment.id] = [target.segment.id, first.segment.id];
  return retained;
}

/** Normalize accepted ownership independently of the axis planner's temporary geometry spans. */
export function normalizePhysicalPieces(floor, createId, before = null) {
  rebindBuildingPlanFaces(floor, createId);
  reconcileFacingOwnership(floor, before);
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
      const openings = [...wall.doors, ...wall.windows];
      if (!facesOfWall(floor, wall.id).length && openings.length)
        fail(
          'opening_crosses_edit_boundary',
          'An opening occupies the automatic wall portion removed by this edit.',
          {
            subject: { type: openings[0].type, id: openings[0].id },
            openingIds: openings.map((opening) => opening.id),
          }
        );
      const root = wall.lineage?.splitFromWallId || wall.lineage?.jogOriginWallId;
      const hasRows = [wall, ...(wall.sides || [])].some((subject) =>
        Object.values(subject.repeatable || {}).some((rows) => rows.length)
      );
      // Geometry overrides on an expired automatic extent do not migrate onto
      // surviving construction. Every custom answer must still survive there.
      const automatic = wall.lineage?.automaticDivision && !wall.lineage.explicitPhysicalSeparation;
      const retainedOverrides = (subject) =>
        Object.fromEntries(
          Object.entries(subject.overrides).filter(
            ([key]) => !automatic || !['wall_thickness_m', 'wall_height_m'].includes(key)
          )
        );
      const survivor = floor.walls.find(
        (other) =>
          other !== wall &&
          other.segments.length &&
          root &&
          (other.id === root || other.lineage?.splitFromWallId === root) &&
          equalValue(retainedOverrides(other), retainedOverrides(wall)) &&
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
      const explicitStations = buildingPlanEditingCutStations(
        floor,
        frame,
        (wall.properties.wall_thickness_m ?? segment.referenceOffset * 2) / 2
      ).filter((station) => station > EPS && station < frame.length - EPS);
      const stations = [
        0,
        frame.length,
        ...bindings.flatMap((b) => b.interval),
        ...explicitStations,
      ]
        .sort((a, b) => a - b)
        .filter((v, i, list) => !i || v - list[i - 1] > EPS);
      const cuts = [0];
      let previous = null;
      for (let i = 0; i < stations.length - 1; i++) {
        const signature = coverage(floor, wall, segment, (stations[i] + stations[i + 1]) / 2);
        const explicit = explicitStations.some((station) => Math.abs(station - stations[i]) <= EPS);
        if (i && (!equalValue(signature, previous) || explicit)) cuts.push(stations[i]);
        previous = signature;
      }
      cuts.push(frame.length);
      pieces.push(...dividePhysicalSpan(floor, wall, segment, cuts, createId));
    }
    if (!pieces.length) continue;
    const retained = retainReferenceSpan(
      pieces,
      referenceBinding?.segmentId || original.segments[0].id,
      referenceStation,
      reference?.room.id
    );
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
        if (Object.hasOwn(side.overrides, key) && !equalValue(side.overrides[key], value))
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
  const retiredProfiles = normalizeBuildingPlanMaterialProfiles(floor, before, createId);
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
      if (!a.lineage?.automaticDivision) continue;
      for (const b of floor.walls) {
        if (
          a === b ||
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
        const stations = [0, af.length, project(af, bf.start).along, project(af, bf.end).along];
        if (
          buildingPlanEditingCutStations(floor, af, (a.properties.wall_thickness_m ?? 0) / 2).some(
            (station) =>
              station > Math.min(...stations) + EPS && station < Math.max(...stations) - EPS
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

/** An accepted shared capture supersedes a compatible exterior claim on the
 * same room extent. Keep surviving construction/answers; partition its remaining
 * bindings below rather than extending the old exterior band through the join.
 */
function reconcileFacingOwnership(floor, before) {
  const sameAnswers = (a, b) =>
    ['overrides', 'providerOverrides', 'values', 'repeatable'].every((key) =>
      equalValue(a[key] || {}, b[key] || {})
    );
  for (const room of floor.rooms) {
    for (const face of [...room.faces]) {
      if (face.freePath) continue;
      const wall = floor.walls.find((wall) => wall.id === face.wallId);
      if (wall.lineage?.profileSource || wall.sides.every((side) => side.roomId)) continue;
      for (const edgeId of [...face.edgeIds]) {
        const claimed = face.bindings.filter((binding) => binding.edgeId === edgeId);
        // Empty temporary spans are retired below; they cannot supersede or
        // contribute an accepted longitudinal claim.
        if (!claimed.length) continue;
        const target = room.faces.find((other) => {
          if (other === face || other.freePath || !sameAnswers(face, other)) return false;
          const retained = floor.walls.find((wall) => wall.id === other.wallId);
          if (!retained.sides.every((side) => side.roomId) || !sameAnswers(wall, retained))
            return false;
          const direction =
            dot(
              segmentFrame(wall.segments[0].start, wall.segments[0].end).tangent,
              segmentFrame(retained.segments[0].start, retained.segments[0].end).tangent
            ) >= 0
              ? 1
              : -1;
          if (
            !wall.sides.every((side) => {
              const next = retained.sides.find((next) => next.sign === side.sign * direction);
              return next && sameAnswers(side, next);
            })
          )
            return false;
          return (
            claimed.length &&
            claimed.every((binding) =>
              other.bindings.some(
                (part) =>
                  part.edgeId === edgeId &&
                  part.roomInterval[0] <= binding.roomInterval[0] + EPS &&
                  part.roomInterval[1] >= binding.roomInterval[1] - EPS
              )
            )
          );
        });
        if (!target) continue;
        const accepted = before?.rooms.find((other) => other.id === room.id)?.faces || [];
        if (
          face.edgeIds.length === 1 &&
          accepted.some((old) => old.id === face.id) &&
          !accepted.some((old) => old.id === target.id)
        ) {
          const retained = floor.walls.find((wall) => wall.id === target.wallId);
          if (retained.referenceFaceId === target.id) retained.referenceFaceId = face.id;
          target.id = face.id;
        }
        face.edgeIds = face.edgeIds.filter((id) => id !== edgeId);
        face.bindings = face.bindings.filter((binding) => binding.edgeId !== edgeId);
      }
    }
    room.faces = room.faces.filter((face) => face.freePath || face.edgeIds.length);
  }
}

/** Enforce the settled contract without making older records unreadable. */
export function buildingPlanOwnershipIssues(floor) {
  const claims = new Map();
  for (const room of floor.rooms)
    for (const face of room.faces.filter((face) => !face.freePath)) {
      for (const binding of face.bindings) {
        const key = JSON.stringify([room.id, binding.edgeId]);
        const previous = claims.get(key) || [];
        if (
          previous.some(
            (other) =>
              other.wallId !== face.wallId &&
              Math.min(other.interval[1], binding.roomInterval[1]) -
                Math.max(other.interval[0], binding.roomInterval[0]) >
                EPS
          )
        )
          return [
            planIssue(
              'conflicting_wall_ownership',
              'These walls claim the same room-facing extent. Resolve their construction before continuing.',
              { type: 'room_face', id: face.id }
            ),
          ];
        previous.push({ wallId: face.wallId, interval: binding.roomInterval });
        claims.set(key, previous);
      }
    }
  return [];
}

/** Split only the contacted longitudinal extent before aligning different wall axes. */
export function isolateBuildingPlanContact(floor, entry, segmentId, otherEdge, createId) {
  const { room, wall } = entry;
  const segment = wall.segments.find((part) => part.id === segmentId);
  const frame = segmentFrame(segment.start, segment.end);
  const stations = [
    project(frame, otherEdge.start).along,
    project(frame, otherEdge.end).along,
  ].sort((a, b) => a - b);
  const bounds = entry.face.bindings.filter((binding) => binding.segmentId === segment.id);
  const low = Math.max(0, Math.min(...bounds.map((binding) => binding.interval[0])), stations[0]),
    high = Math.min(
      frame.length,
      Math.max(...bounds.map((binding) => binding.interval[1])),
      stations[1]
    );
  if (high - low <= EPS) return { ...entry, contactSegmentId: segmentId };
  const cuts = [0, low, high, frame.length].filter((v, i, list) => !i || v - list[i - 1] > EPS);
  if (cuts.length === 2) return { ...entry, contactSegmentId: segmentId };
  const reference = facesOfWall(floor, wall.id).find(
    ({ face }) => face.id === wall.referenceFaceId
  );
  const binding = reference?.face.bindings.find((binding) => binding.segmentId === segment.id);
  const referenceStation = binding?.interval[binding.direction > 0 ? 0 : 1] ?? 0;
  const pieces = dividePhysicalSpan(floor, wall, segment, cuts, createId);
  const retained =
    pieces[retainReferenceSpan(pieces, segment.id, referenceStation, reference?.room.id)];
  wall.segments.splice(wall.segments.indexOf(segment), 1, ...pieces.map((piece) => piece.segment));
  wall.lineage = {
    ...wall.lineage,
    splitFromWallId: wall.lineage?.splitFromWallId || wall.id,
    dividedFromWallId: wall.id,
    automaticDivision: 'adjacency',
  };
  for (const opening of [...wall.doors, ...wall.windows])
    if (opening.segmentId === segment.id) {
      const piece = pieces.find(
        (piece) =>
          opening.offset >= piece.low - EPS && opening.offset + opening.width <= piece.high + EPS
      );
      opening.segmentId = piece.segment.id;
      opening.offset -= piece.low;
    }
  rebindBuildingPlanFaces(floor, createId);
  separatePhysicalWallRuns(
    floor,
    wall,
    createId,
    pieces.filter((piece) => piece !== retained).map((piece) => piece.segment.id)
  );
  rebindBuildingPlanFaces(floor, createId);
  const middle = (low + high) / 2;
  const selected = pieces.find((piece) => middle > piece.low - EPS && middle < piece.high + EPS);
  const owner = floor.walls.find((wall) =>
    wall.segments.some((segment) => segment.id === selected.segment.id)
  );
  const face = room.faces.find(
    (face) =>
      face.wallId === owner.id &&
      face.bindings.some((binding) => binding.segmentId === selected.segment.id)
  );
  return { room, wall: owner, face, contactSegmentId: selected.segment.id };
}
