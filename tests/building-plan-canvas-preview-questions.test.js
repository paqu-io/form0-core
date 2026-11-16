import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingPlanCanvasController,
  createBuildingPlanEditor,
  createBuildingPlanSession,
  expandBuildingPlanSchema,
  readBuildingPlanRecord,
  settleBuildingPlanQuestions,
  writeBuildingPlanRecord,
} from '../src/index.js';

// Web retest 2026-11-16: dragging a room whose clear height differs onto Bedroom and Kitchen. The
// preview at the attaching position threw ("Choose one value…"); the drop handler previews first,
// so the drop was lost and no question was asked. A preview may hold the questions its drop asks.
// Then the drop itself threw: the hosts run the canvas with managed transactions, and the record
// handed to the host refused the open question; the drag stayed attached to the pointer.

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

/** A session with Bedroom and Kitchen (3 m) side by side on the ground floor. */
function seeded() {
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
  return { seed, floorId };
}

/** The canvas controller on that plan; a 2.5 m room drawn below Bedroom and Kitchen. */
async function canvas() {
  const { seed, floorId } = seeded();
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

/**
 * The controller as the web and mobile room screens run it: managed transactions, the host
 * applying the operation through its row editor and answering questions with the first option.
 */
function managedCanvas({ write } = {}) {
  const { seed, floorId } = seeded();
  seed.apply({
    type: 'create_room',
    floorId,
    rectangle: { x: 2, y: 10, width: 4, height: 3 },
    values: { room_name: name('New') },
  });
  const room = seed.getSnapshot().floors[0].rooms[2];
  seed.apply({
    type: 'set_provider',
    floorId,
    nodeKey: 'rooms',
    roomId: room.id,
    property: 'wall_height',
    fieldName: 'room_structural_clear_height',
    value: 2.5,
  });
  const editor = createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    record: writeBuildingPlanRecord({ meta, plan: seed.getSnapshot() }),
  });
  const floors = meta.repeatablesByNodeKey.floors.preferredKey;
  const scopeId = 'floor-screen';
  editor.openRow({
    path: [{ key: floors, id: editor.getRecord().repeatable[floors][0].id }],
    scopeId,
  });
  const questions = [];
  const reported = [];
  const controller = new BuildingPlanCanvasController({
    meta,
    managedTransactions: true,
    derivedCommands: true,
    readRecord: () => ({ values: {}, repeatable: editor.getRecord().repeatable }),
    writeRecord:
      write ||
      ((_record, { operation }) =>
        settleBuildingPlanQuestions(editor, editor.apply(operation, { scopeId }), (question) => {
          questions.push(question.message);
          return { value: question.buttons.find((button) => button.id !== 'cancel').id };
        })),
    reportIssues: (issues) => reported.push(issues),
  });
  const attached = { ...controller.rooms.get(room.id).rect, y: 3.2 * controller.gridSize };
  return { controller, editor, room, attached, questions, reported };
}

test('a managed drop onto rooms of another height asks for each shared wall and applies', async () => {
  const { controller, editor, room, attached, questions } = managedCanvas();
  assert.equal(controller.previewRoom(room.id, attached).status, 'ready');
  assert.ok(await controller.updateRoom(room.id, attached));
  assert.equal(questions.length, 2, questions.join('\n'));
  const floor = readBuildingPlanRecord({ meta, record: editor.getRecord() }).floors[0];
  const moved = floor.rooms.find((entry) => entry.id === room.id);
  assert.equal(Math.min(...moved.vertices.map((point) => point.y)), 3.2);
  assert.equal(controller.isBusy(), false);
  controller.dispose();
});

test('a drop whose host write fails reports it instead of throwing', async () => {
  const { controller, room, attached, reported } = managedCanvas({
    write: () => {
      throw new Error('The host could not store the plan.');
    },
  });
  const before = controller.rooms.get(room.id).rect;
  let dropped;
  await assert.doesNotReject(async () => {
    dropped = await controller.updateRoom(room.id, attached);
  });
  assert.equal(dropped, null);
  assert.equal(reported.at(-1)[0].message, 'The host could not store the plan.');
  assert.deepEqual(controller.rooms.get(room.id).rect, before, 'the room stays where it was');
  assert.equal(controller.isBusy(), false);
  controller.dispose();
});
