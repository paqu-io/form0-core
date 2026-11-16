// Decided 2026-11-16: walls and columns stand up to their room's structural clear height; a wall
// shared by rooms whose heights differ asks which one applies; both heights are required only on
// enclosed levels, as the floor's height is.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanEditor,
  createBuildingPlanSession,
  createRecordEvaluator,
  expandBuildingPlanSchema,
  settleBuildingPlanQuestions,
  writeBuildingPlanRecord,
} from '../src/index.js';

const schema = {
  form: {
    name: 'Building',
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
const nodes = meta.repeatablesByNodeKey;
const choice = (value) => ({ choice: [{ value, label: value }], other: [] });

/** Rooms A, B, C in a row, each sharing a wall with the next; a column in A. */
function plan(floorName = 'ground_floor', floorHeight = 3) {
  const session = createBuildingPlanSession({ properties: meta.properties });
  const floorId = session.apply({
    type: 'create_floor',
    values: {
      floor_name: choice(floorName),
      floor_elevation: 0,
      floor_height: floorHeight,
      floor_interior_wall_thickness: 0.2,
      floor_exterior_wall_thickness: 0.2,
    },
  }).created.id;
  for (const x of [0, 4.2, 8.4])
    session.apply({ type: 'create_room', floorId, rectangle: { x, y: 0, width: 4, height: 3 } });
  const roomA = session.getSnapshot().floors[0].rooms[0].id;
  session.apply({
    type: 'create_element',
    floorId,
    roomId: roomA,
    collection: 'columns',
    element: { position: { x: 2, y: 1.5 }, width: 0.3, height: 0.3 },
  });
  return session;
}

function editorFor(session) {
  const editor = createBuildingPlanEditor({
    meta,
    derivedCommands: true,
    editingPolicy: { copyCustomAnswersAutomatically: true },
    record: writeBuildingPlanRecord({ meta, plan: session.getSnapshot() }),
  });
  const floorRow = editor.getRecord().repeatable[nodes.floors.preferredKey][0];
  const floorPath = [{ key: nodes.floors.preferredKey, id: floorRow.id }];
  editor.openRow({ path: floorPath, scopeId: 'floor' });
  return { editor, floorPath };
}

const walls = (editor) => {
  const floor = editor.getSnapshot().floors[0];
  const name = new Map(floor.rooms.map((room, index) => [room.id, 'ABC'[index]]));
  return floor.walls.map((wall) => ({
    rooms: wall.sides
      .filter((side) => side.roomId)
      .map((side) => name.get(side.roomId))
      .sort()
      .join(''),
    height: wall.properties.wall_height,
    own: Object.hasOwn(wall.overrides || {}, 'wall_height'),
  }));
};

/** Change one room's clear height as its screen sends it; answer each question with `pick`. */
async function setRoomHeight({ editor, floorPath }, index, value, pick = 0) {
  const row =
    editor.getRecord().repeatable[nodes.floors.preferredKey][0].repeatable[
      nodes.rooms.preferredKey
    ][index];
  const name = nodes.rooms.fieldsByOriginalDataName.room_structural_clear_height.dataName;
  editor.openRow({
    path: [...floorPath, { key: nodes.rooms.preferredKey, id: row.id }],
    scopeId: `room-${index}`,
    parentScopeId: 'floor',
  });
  const questions = [];
  const result = await settleBuildingPlanQuestions(
    editor,
    editor.completeRow(
      `room-${index}`,
      { ...row, values: { ...row.values, [name]: value } },
      { fieldName: name }
    ),
    async (params) => {
      questions.push(params);
      return { value: `candidate:${pick}` };
    }
  );
  assert.equal(editor.acceptRow(`room-${index}`).status, 'accepted');
  return { result, questions };
}

test('walls and columns take their room height, inherited from the floor', () => {
  const floor = plan().getSnapshot().floors[0];
  assert.ok(floor.walls.length >= 10);
  for (const wall of floor.walls) {
    assert.equal(wall.properties.wall_height, 3);
    assert.equal(wall.provenance.wall_height.scope, 'room');
  }
  assert.equal(floor.rooms[0].columns[0].properties.column_height, 3);
});

test("a room's own height reaches its own walls and columns; a wall's own height wins", async () => {
  const context = editorFor(plan());
  const { questions } = await setRoomHeight(context, 0, 2.6);
  assert.equal(questions.length, 1, 'only the wall shared with B asks');
  const byRooms = walls(context.editor);
  for (const wall of byRooms.filter((entry) => entry.rooms === 'A')) assert.equal(wall.height, 2.6);
  assert.equal(
    context.editor.getSnapshot().floors[0].rooms[0].columns[0].properties.column_height,
    2.6
  );
  // The answer (the first value, A's 2.6) becomes the shared wall's own height.
  assert.deepEqual(
    byRooms.filter((entry) => entry.rooms === 'AB'),
    [{ rooms: 'AB', height: 2.6, own: true }]
  );
});

test('changing a room shared with two rooms of another height asks once per shared wall', async () => {
  const context = editorFor(plan());
  const { questions } = await setRoomHeight(context, 1, 2.5);
  assert.equal(questions.length, 2);
  for (const question of questions)
    assert.equal(question.buttons.filter((button) => button.id.startsWith('candidate')).length, 2);
  // Readable: the wall, the rooms (automatic names), the field label and values with units.
  assert.equal(questions[0].title, 'Shared wall: choose one value');
  assert.match(
    questions[0].message,
    /^Wall W\d+ is shared by Room 1 and Room 2, which give different values for Height\./
  );
  assert.deepEqual(
    questions[0].buttons.map((button) => button.label),
    ['3 m (Room 1)', '2.5 m (Room 2)', 'Cancel edit']
  );
  const { questions: again } = await setRoomHeight(context, 1, 2.4);
  assert.equal(again.length, 0, 'answered walls keep their own height and no longer ask');
});

test('wall and column heights are required on enclosed levels only', async () => {
  const heightIssues = async (floorName) => {
    const record = writeBuildingPlanRecord({ meta, plan: plan(floorName, null).getSnapshot() });
    const { validationSummary } = await createRecordEvaluator({
      schema,
      diagnostics: { console: false },
    }).prepareSubmission(record);
    const names = new Set(
      ['walls', 'columns'].map(
        (node) =>
          nodes[node].fieldsByOriginalDataName[node === 'walls' ? 'wall_height' : 'column_height']
            .dataName
      )
    );
    return validationSummary.orderedIssues.filter((issue) => names.has(issue.fieldName)).length;
  };
  assert.ok((await heightIssues('ground_floor')) > 0);
  assert.equal(await heightIssues('roof'), 0);
  assert.equal(await heightIssues('land_survey'), 0);
});
