import { copyRecordData } from '../utilities/record-data.js';

/** Group pending field identities by complete row path; retain no values or proposal history. */
export function createRecordFreshness(schemaRevision, changes = []) {
  const affected = new Map();
  for (const { instancePath, fieldName, fieldKey } of changes) {
    if (!instancePath.length) continue;
    const key = JSON.stringify(instancePath);
    if (!affected.has(key))
      affected.set(key, { instancePath: copyRecordData(instancePath), fields: [] });
    affected.get(key).fields.push({ fieldName, fieldKey });
  }
  return {
    version: 1,
    status: affected.size ? 'pending' : 'current',
    schemaRevision,
    affected: [...affected.values()],
  };
}
