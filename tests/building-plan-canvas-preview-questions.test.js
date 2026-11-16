import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  createBuildingPlanSession,
  expandBuildingPlanSchema,
  writeBuildingPlanRecord,
} from '../src/index.js';

// Web retest 2026-11-16: dragging a room whose clear height differs onto Bedroom and Kitchen. The
// preview at the attaching position threw ("Choose one value…"); the drop handler previews first,
// so the drop was lost and no question was asked. A preview may hold the questions its drop asks.

const schema = {
  form: {
    name: 'Canvas preview questions',
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
const name = (label) => ({ choice: [{ value: label.toLowerCase(), label }], other: [] });

/** Bedroom and Kitchen (3 m) side by side; a 2.5 m room drawn below them on the canvas. */
async function canvas() {
  const seed = createBuildingPlanSession({ properties: meta.properties, derivedCommands: true });
  const floorId = seed.apply({
    type: 'create_floor',
    values: {
      floor_name: name('Ground floor'),
      floor_elevation: 0,
      floor_height: 3,
      floor_interior_wall_thickness: 0.2,
      floor_exterior_wall_thickness: 0.2,
    },
  }).created.id;
  for (const [label, x] of [
    ['Bedroom', 0],
    ['Kitchen', 4.2],
  ])
    seed.apply({
      type: 'create_room',
      floorId,
      rectangle: { x, y: 0, width: 4, height: 3 },
      values: { room_name: name(label) },
    });
  let record = writeBuildingPlanRecord({ meta, plan: seed.getSnapshot() });
  const questions = [];
  const reported = [];
  const controller = new BuildingPlanCanvasController({
    meta,
    derivedCommands: true,
    readRecord: () => record,
    writeRecord: (next) => {
      record = next;
      return true;
    },
    reportIssues: (issues) => reported.push(issues),
    presentQuestion: async (question) => {
      questions.push(question.message);
      return { value: question.buttons.find((button) => button.id !== 'cancel').id };
    },
  });
  const g = controller.gridSize;
  await controller.createRoom({ x: 2 * g, y: 10 * g, width: 4 * g, height: 3 * g });
  const room = controller.getSnapshot().rooms.at(-1);
  const height = await controller.apply({
    type: 'set_provider',
    floorId,
    nodeKey: 'rooms',
    roomId: room.id,
    property: 'wall_height',
    fieldName: 'room_structural_clear_height',
    value: 2.5,
  });
  assert.ok(height, 'the room height applies');
  // The room's top edge on Bedroom's and Kitchen's bottom walls (3 m + 0.2 m wall).
  const attached = { ...controller.rooms.get(room.id).rect, y: 3.2 * g };
  return { controller, room, attached, questions, reported };
}

test('a preview that joins rooms of different heights draws and asks nothing yet', async () => {
  const { controller, room, attached, questions, reported } = await canvas();
  const proposal = controller.previewRoom(room.id, attached);
  assert.equal(proposal.status, 'ready');
  assert.ok(controller.previewView, 'the canvas draws the preview');
  assert.deepEqual(reported.at(-1), []);
  assert.deepEqual(questions, []);
  controller.dispose();
});

test('the drop after that preview asks for each shared wall and applies', async () => {
  const { controller, room, attached, questions } = await canvas();
  controller.previewRoom(room.id, attached);
  assert.ok(await controller.updateRoom(room.id, attached));
  assert.equal(questions.length, 2, questions.join('\n'));
  assert.match(questions[0], /shared by .* which give different values for Height/);
  const floor = controller.session.getSnapshot().floors[0];
  const shared = floor.walls.filter((wall) => wall.sides.some((side) => side.roomId === room.id));
  assert.equal(shared.filter((wall) => wall.sides.every((side) => side.roomId)).length, 2);
  controller.dispose();
});

test('a preview that cannot be written reports its issue instead of throwing', async () => {
  const { controller, room, attached, reported } = await canvas();
  controller.previewRoom(room.id, { ...attached, y: attached.y + 2 * controller.gridSize });
  const last = controller.previewView;
  const broken = controller.session.getSnapshot();
  broken.floors[0].walls[0].overrides = { wall_thickness: 'thick' };
  controller.session.preview = () => ({ status: 'ready', issues: [], snapshot: broken });
  let proposal;
  assert.doesNotThrow(() => {
    proposal = controller.previewRoom(room.id, attached);
  });
  assert.equal(proposal.status, 'conflict');
  assert.ok(reported.at(-1).length, 'the issue is shown on the canvas');
  assert.equal(controller.previewView, last, 'the last good preview stays');
  controller.dispose();
});
