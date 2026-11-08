import { at, polygonArea, polygonEdges } from './geometry.js';
import { copyBuildingPlanData as copy, rebindBuildingPlanFaces } from './model.js';
import { renewBuildingPlanRowIdentities } from './custom-rows.js';

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
      const half = (source.properties.wall_thickness_m ?? 0) / 2;
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
