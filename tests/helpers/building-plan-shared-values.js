import { createBuildingPlanSession, expandBuildingPlanSchema } from '../../src/index.js';

/**
 * A derived-core session on the default BuildingPlan schema with Bedroom (0..4 × 0..3) and a far
 * room New (below), for the shared-value tests of the 2026-11-16 web retest. Floor height 3 m,
 * every default thickness 0.2 m.
 */
export function sharedValuePlan({ snapshot, idPrefix = 'sv' } = {}) {
  const schema = {
    form: {
      name: 'Shared values',
      elements: [
        {
          type: 'BuildingPlanSection',
          key: 'plan',
          data_name: 'plan',
          label: 'Plan',
          description: null,
          description_mode: null,
          visible: true,
          visible_conditions: null,
          read_only: false,
          read_only_conditions: null,
          node_overrides: null,
        },
      ],
    },
  };
  const meta = expandBuildingPlanSchema(schema).buildingPlanMeta[0];
  let serial = 0;
  const session = createBuildingPlanSession({
    ...(snapshot ? { snapshot } : {}),
    properties: meta.properties,
    createId: () => `${idPrefix}-${String(++serial).padStart(4, '0')}`,
    derivedCommands: true,
    editingPolicy: { copyCustomAnswersAutomatically: true },
  });
  const name = (label) => ({ choice: [{ value: label.toLowerCase(), label }], other: [] });
  const floor = () => session.getSnapshot().floors[0];
  let floorId = floor()?.id;
  if (!floorId)
    floorId = session.apply({
      type: 'create_floor',
      values: {
        floor_name: name('Ground floor'),
        floor_elevation: 0,
        floor_height: 3,
        floor_interior_wall_thickness: 0.2,
        floor_exterior_wall_thickness: 0.2,
      },
    }).created.id;
  const apply = (operation) => session.apply({ floorId, ...operation });
  const roomName = (room) => room.values?.room_name?.choice?.[0]?.label;
  const room = (label) => floor().rooms.find((entry) => roomName(entry) === label);
  const createRoom = (label, rectangle) =>
    apply({ type: 'create_room', rectangle, values: { room_name: name(label) } });
  /** The wall a room's row lies on, found by the row's line (horizontal at `y`). */
  const wallAt = (label, y) =>
    floor().walls.find(
      (wall) =>
        wall.sides.some((side) => side.roomId === room(label).id) &&
        Math.abs(wall.segments[0].start.y - y) < 0.2 &&
        Math.abs(wall.segments[0].end.y - y) < 0.2
    );
  const faceOf = (label, wall) => room(label).faces.find((face) => face.wallId === wall.id);
  /** Answer the pending question with the button whose label starts with `pick`. */
  const answer = (result, pick) => {
    const { params } = result.uiOperations[0];
    const button = params.buttons.find((entry) => entry.label.startsWith(pick));
    return session.resolveUIRequest(params.requestId, { value: button.id });
  };
  return { session, meta, floor, floorId, apply, room, createRoom, wallAt, faceOf, answer };
}
