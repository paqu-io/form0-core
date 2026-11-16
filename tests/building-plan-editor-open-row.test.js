// Mobile round 2026-11-13, issue 2: a host listener threw while a room opened; the room's scope
// stayed open, so its floor could neither be saved nor cancelled.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanEditor,
  createBuildingPlanSession,
  expandBuildingPlanSchema,
  writeBuildingPlanRecord,
} from '../src/index.js';

function floorEditor() {
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
  const plan = createBuildingPlanSession();
  const floorId = plan.apply({
    type: 'create_floor',
    values: { floor_elevation: 0, floor_height: 3 },
    defaults: { wall_height: 3 },
  }).created.id;
  plan.apply({ type: 'create_room', floorId, rectangle: { x: 0, y: 0, width: 4, height: 3 } });
  const record = writeBuildingPlanRecord({ meta, plan: plan.getSnapshot() });
  const floorsKey = meta.repeatablesByNodeKey.floors.preferredKey;
  const editor = createBuildingPlanEditor({ meta, record });
  return { editor, meta, floorPath: [{ key: floorsKey, id: record.repeatable[floorsKey][0].id }] };
}

const failing = () => {
  throw new TypeError('listener failed');
};
const openScopes = (editor) => editor.getState().scopes.map((scope) => scope.id);

test('a listener that throws while a row opens leaves no scope open', () => {
  const { editor, floorPath } = floorEditor();
  const stop = editor.subscribe(failing);
  assert.throws(() => editor.openRow({ path: floorPath, scopeId: 'floor' }), /listener failed/);
  assert.equal(editor.hasEditor('floor'), false);
  assert.deepEqual(openScopes(editor), []);
  stop();
  assert.equal(editor.openRow({ path: floorPath, scopeId: 'floor' }).status, 'opened');
});

test('a new row whose opening throws is removed, and its floor still saves', () => {
  const { editor, meta, floorPath } = floorEditor();
  assert.equal(editor.openRow({ path: floorPath, scopeId: 'floor' }).status, 'opened');
  const rooms = () => editor.getSnapshot().floors[0].rooms.length;
  const before = rooms();
  const roomPath = [...floorPath, { key: meta.repeatablesByNodeKey.rooms.preferredKey, id: 'new' }];
  const stop = editor.subscribe(failing);
  assert.throws(
    () =>
      editor.openRow({
        path: roomPath,
        scopeId: 'room',
        parentScopeId: 'floor',
        row: { id: 'new', values: {} },
      }),
    /listener failed/
  );
  stop();
  assert.equal(editor.hasEditor('room'), false);
  assert.deepEqual(openScopes(editor), ['floor']);
  assert.equal(rooms(), before);
  assert.equal(editor.acceptRow('floor').status, 'accepted');
});
