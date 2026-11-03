import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildFormRecordSnapshot,
  expandBuildingPlanSchema,
  readBuildingPlanRecord,
  validateBuildingPlanSnapshot,
} from '../../src/index.js';

const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const [schema, record, expected] = await Promise.all(
  ['schema.json', 'record-output.json', 'semantic-output.json'].map(read)
);
const expanded = expandBuildingPlanSchema(schema);
const decoded = readBuildingPlanRecord({
  meta: expanded.buildingPlanMeta[0],
  record: buildFormRecordSnapshot(expanded.schema, record),
});

assert.deepEqual(decoded, expected, 'The saved record must decode to the documented snapshot.');
assert.deepEqual(validateBuildingPlanSnapshot(decoded), []);
const floor = decoded.floors[0];
assert.equal(floor.rooms.length, 2);
assert.equal(floor.walls.length, 7);
assert.equal(floor.walls.flatMap((wall) => wall.doors).length, 1);
assert.equal(floor.observations.length, 1);
const [a, b] = floor.rooms.map((room) =>
  room.faces.find((face) =>
    floor.rooms.some(
      (other) => other.id !== room.id && other.faces.some((entry) => entry.wallId === face.wallId)
    )
  )
);
assert.equal(a.wallId, b.wallId);
assert.equal(
  Math.min(a.bindings[0].interval[1], b.bindings[0].interval[1]) -
    Math.max(a.bindings[0].interval[0], b.bindings[0].interval[0]),
  2
);
console.log(
  'BuildingPlan example verified: 2 rooms, 7 walls, 2 m partial sharing, 1 door, 1 observation.'
);
