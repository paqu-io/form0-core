import {
  GEOMETRY_EPSILON as EPS,
  at,
  dot,
  polygonArea,
  polygonEdges,
  segmentFrame,
  project,
  pointInPolygon,
} from './geometry.js';
import {
  copyBuildingPlanData as copy,
  facesOfWall,
  equalValue,
  rebindBuildingPlanFaces,
} from './model.js';
import { renewBuildingPlanRowIdentities, sameBuildingPlanCustomRows } from './custom-rows.js';
import { buildingPlanFootprints, buildingPlanMaterialCovered } from './footprints.js';
import { buildingPlanJunctionAllowance } from './junction-edits.js';
import { buildingPlanEditingCutStations } from './wall-divisions.js';

const hasAnswers = (subject) =>
  ['values', 'overrides', 'providerOverrides'].some(
    (key) => Object.keys(subject[key] || {}).length
  ) || Object.values(subject.repeatable || {}).some((rows) => rows.length);

/** Demote only automatic collinear end caps supplied by retained construction.
 * Deliberate divisions, real jog returns, hosted openings and independent answers
 * remain physical owners. This also settles older accepted candidates coherently.
 */
export function normalizeBuildingPlanMaterialCaps(floor, createId) {
  const candidates = [];
  for (const wall of floor.walls) {
    if (
      wall.segments.length !== 1 ||
      (!wall.segments[0].junction && wall.lineage?.automaticDivision !== 'adjacency') ||
      wall.doors.length ||
      wall.windows.length ||
      [wall, ...wall.sides].some(hasAnswers)
    )
      continue;
    const frame = segmentFrame(wall.segments[0].start, wall.segments[0].end);
    if (
      buildingPlanEditingCutStations(floor, frame, wall.properties.wall_thickness / 2).some(
        (station) => station >= -EPS && station <= frame.length + EPS
      )
    )
      continue;
    const linked = facesOfWall(floor, wall.id);
    if (linked.length !== 1 || linked[0].face.freePath) continue;
    const { room, face } = linked[0];
    const edges = polygonEdges(room);
    if (face.edgeIds.length !== 1) continue;
    const edge = edges.find((edge) => edge.id === face.edgeIds[0]);
    if (!edge) continue;
    for (const end of [edge.start, edge.end]) {
      if (!end.physicalBoundaryId || end.editingCutId) continue;
      const other = edges.find(
        (other) =>
          other.id !== edge.id &&
          (other.start.id === end.id || other.end.id === end.id) &&
          dot(edge.tangent, other.tangent) > 1 - EPS &&
          other.length > edge.length + EPS
      );
      if (!other) continue;
      const continuation = room.faces.find((otherFace) =>
        otherFace.bindings.some((binding) => binding.edgeId === other.id)
      );
      if (!continuation || continuation.wallId === wall.id) continue;
      const source = floor.walls.find((other) => other.id === continuation.wallId);
      // A thickness/material transition is real construction, even when its
      // answers are inherited. Only a compatible end of this same band derives.
      if (!equalValue(wall.properties, source.properties)) continue;
      const far = edge.start.id === end.id ? edge.end : edge.start;
      const thickness = wall.properties.wall_thickness;
      const allowance = buildingPlanJunctionAllowance(floor, room, edge, far, thickness);
      if (!(thickness > EPS) || edge.length > allowance + EPS) continue;
      candidates.push({
        wall,
        room,
        face,
        edge,
        source,
        sideSign: continuation.bindings.find((binding) => binding.edgeId === other.id).side,
      });
      break;
    }
  }
  if (!candidates.length) return new Set();
  const omitted = new Set(candidates.map(({ wall }) => wall.id));
  const profiles = new Map(
    candidates.map(({ edge, source, sideSign }) => [edge.id, { wallId: source.id, sideSign }])
  );
  const material = materialWithoutWalls(floor, omitted, profiles);
  const retired = new Set();
  for (const { wall, room, face, edge, source, sideSign } of candidates) {
    if (omitted.has(source.id)) continue;
    const frame = segmentFrame(wall.segments[0].start, wall.segments[0].end);
    const half = wall.properties.wall_thickness / 2;
    if (
      !buildingPlanMaterialCovered(
        [
          at(frame, 0, half),
          at(frame, frame.length, half),
          at(frame, frame.length, -half),
          at(frame, 0, -half),
        ],
        material
      )
    )
      continue;
    room.edges.find((stored) => stored.id === edge.id).profile = { wallId: source.id, sideSign };
    room.faces = room.faces.filter((other) => other !== face);
    retired.add(wall.id);
    const sourceFrame = segmentFrame(source.segments[0].start, source.segments[0].end);
    const direction = dot(frame.tangent, sourceFrame.tangent) >= 0 ? 1 : -1;
    for (const target of floor.rooms)
      for (const stored of target.edges)
        if (stored.profile?.wallId === wall.id) {
          stored.profile.wallId = source.id;
          stored.profile.sideSign *= direction;
        }
  }
  floor.walls = floor.walls.filter((wall) => !retired.has(wall.id));
  rebindBuildingPlanFaces(floor, createId);
  return retired;
}

/** Restore derived junction incidence only inside a private geometry candidate.
 * Accepted profile edges reference their physical source, with no wall row or
 * independent answers. The established axis solver can use these temporary
 * bands; normalization removes them when existing material still supplies them.
 */
export function materializeBuildingPlanProfiles(floor, createId, identities = new Map()) {
  for (const room of floor.rooms)
    for (const edge of polygonEdges(room)) {
      const stored = room.edges.find((entry) => entry.id === edge.id);
      const profile = stored.profile;
      if (!profile) continue;
      const source = floor.walls.find((wall) => wall.id === profile.wallId);
      if (!source) {
        delete stored.profile;
        continue;
      }
      if (room.faces.some((face) => face.edgeIds?.includes(edge.id))) continue;
      let ids = identities.get(edge.id);
      if (!ids) {
        ids = {
          wall: createId(),
          face: createId(),
          segment: createId(),
          sides: [createId(), createId()],
        };
        identities.set(edge.id, ids);
      }
      const half = (source.properties.wall_thickness ?? 0) / 2;
      const sign = Math.sign(polygonArea(room.vertices));
      const direction = profile.sideSign * sign;
      const wall = {
        ...copy(source),
        id: ids.wall,
        referenceFaceId: ids.face,
        segments: [
          {
            id: ids.segment,
            start: at(edge, 0, -sign * half),
            end: at(edge, edge.length, -sign * half),
            referenceOffset: half,
            junction: true,
          },
        ],
        sides: source.sides.map((side, i) => ({
          ...copy(side),
          id: ids.sides[i],
          sign: side.sign * direction,
          roomId: side.sign === profile.sideSign ? room.id : null,
        })),
        doors: [],
        windows: [],
        lineage: {
          ...copy(source.lineage || {}),
          dividedFromWallId: source.id,
          jogOriginWallId:
            source.lineage?.jogOriginWallId || source.lineage?.splitFromWallId || source.id,
          profileSource: copy(profile),
          profileDirection: direction,
        },
      };
      const side = wall.sides.find((side) => side.sign === sign);
      renewBuildingPlanRowIdentities(wall, createId);
      for (const side of wall.sides) renewBuildingPlanRowIdentities(side, createId);
      room.faces.push({
        id: ids.face,
        wallId: wall.id,
        edgeIds: [edge.id],
        sideId: side.id,
        bindings: [],
        overrides: copy(side.overrides),
        values: copy(side.values),
      });
      floor.walls.push(wall);
      delete stored.profile;
    }
  rebindBuildingPlanFaces(floor, createId);
}

function materialWithoutWalls(floor, omitted, profiles = new Map()) {
  return buildingPlanFootprints(
    {
      ...floor,
      walls: floor.walls
        .filter((wall) => !omitted.has(wall.id))
        .map((wall) => ({ ...wall, doors: [], windows: [] })),
      rooms: floor.rooms.map((room) => ({
        ...room,
        faces: room.faces.filter((face) => !omitted.has(face.wallId)),
        edges: room.edges.map((edge) =>
          profiles.has(edge.id) ? { ...edge, profile: profiles.get(edge.id) } : edge
        ),
      })),
    },
    1
  ).wallFootprints.flatMap((wall) => wall.polygons);
}

/** Normalize derived incidence and its ownership at one seam, before automatic joins. */
export function normalizeBuildingPlanMaterialProfiles(floor, before, createId) {
  const retired = retireCopiedProfiles(floor, before);
  absorbCollinearProfiles(floor, createId);
  return retired;
}

/** A new connector wholly supplied by existing material is an end/corner profile.
 * Its copied answers already live on the retained source; it cannot become a new
 * physical owner just because the clear-room polygon has another straight edge.
 * Existing owners and deliberate cuts within an accepted span are never retired here.
 */
function retireCopiedProfiles(floor, before) {
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
    // Materialized profiles are private solver copies, including when a moved
    // endpoint folds their extent back inside the retained source's old span.
    if (wall.lineage?.profileSource || !withinSource) return true;
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
  const material = materialWithoutWalls(floor, omitted);
  const retired = new Set();
  for (const wall of candidates) {
    const segment = wall.segments[0],
      frame = segmentFrame(segment.start, segment.end);
    const half = (wall.properties.wall_thickness ?? 0) / 2;
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
        const half = (wall.properties.wall_thickness ?? 0) / 2;
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
