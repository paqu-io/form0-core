import test from 'node:test';
import assert from 'node:assert/strict';
import { buildingPlanIssueFocus } from '../src/index.js';

const metadata = [{ repeatablesByNodeKey: { floors: { preferredKey: 'floors' } } }];
const record = {
  repeatable: {
    floors: [
      {
        id: 'floor-1',
        repeatable: {
          rooms: [{ id: 'room-1' }, { id: 'room-2', repeatable: { walls: [{ id: 'wall-1' }] } }],
        },
      },
    ],
    findings: [{ id: 'finding-1' }],
  },
};
const segment = (repeatableKey, instanceId, index) => ({
  repeatableKey,
  instanceId,
  index,
  identity: 'id',
});

test('an issue below a floor opens the floor with an index path to its row', () => {
  assert.deepEqual(
    buildingPlanIssueFocus({
      metadata,
      record,
      instancePath: [
        segment('floors', 'floor-1', 0),
        segment('rooms', 'room-2', 1),
        segment('walls', 'wall-1', 0),
      ],
    }),
    {
      floorDepth: 0,
      focusPath: [
        { key: 'floors', index: 0 },
        { key: 'rooms', index: 1 },
        { key: 'walls', index: 0 },
      ],
    }
  );
});

test('a floor itself, other repeatables and missing rows open as before', () => {
  for (const instancePath of [
    [segment('floors', 'floor-1', 0)],
    [segment('findings', 'finding-1', 0)],
    [segment('floors', 'floor-1', 0), segment('rooms', 'gone', 5)],
  ])
    assert.equal(buildingPlanIssueFocus({ metadata, record, instancePath }), null);
});

test('plan rows are titled by their own name; other rows have none', async () => {
  const { buildingPlanRowTitle, expandBuildingPlanSchema } = await import('../src/index.js');
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
  const row = (node, name, value) => ({
    values: { [nodes[node].fieldsByOriginalDataName[name].dataName]: value },
  });
  const title = (node, value, name) =>
    buildingPlanRowTitle({
      metadata: [meta],
      repeatableKey: nodes[node].preferredKey,
      row: row(node, name, value),
    });
  assert.equal(
    title(
      'floors',
      { choice: [{ value: 'ground_floor', label: 'Ground floor' }], other: [] },
      'floor_name'
    ),
    'Ground floor'
  );
  assert.equal(title('rooms', { choice: [], other: [{ label: 'Room 2' }] }, 'room_name'), 'Room 2');
  assert.equal(title('walls', 'W3', 'wall_label'), 'W3');
  assert.equal(title('columns', 'C1', 'column_identifier'), 'C1');
  assert.equal(
    buildingPlanRowTitle({ metadata: [meta], repeatableKey: 'findings', row: {} }),
    null
  );
});
