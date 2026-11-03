import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import {
  buildFormRecordSnapshot,
  expandBuildingPlanSchema,
  readBuildingPlanRecord,
} from '../../src/index.js';
import { createBuildingPlanExample } from './create-example.js';

const { schema, meta, stored } = createBuildingPlanExample();
const formatting = (await resolveConfig(fileURLToPath(import.meta.url))) || {};
const expanded = expandBuildingPlanSchema(schema);
const semantic = readBuildingPlanRecord({
  meta,
  record: buildFormRecordSnapshot(expanded.schema, stored),
});

for (const [name, value] of [
  ['schema.json', schema],
  ['record-output.json', stored],
  ['semantic-output.json', semantic],
]) {
  const json = await format(JSON.stringify(value), { ...formatting, parser: 'json' });
  await writeFile(new URL(name, import.meta.url), json);
  console.log(`Updated ${name}`);
}
