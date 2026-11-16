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
