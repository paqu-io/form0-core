import { areJsonValuesEqual } from '../utilities/value-equality.js';
/** Copying a wall owner creates new independent custom row identities. */
export function renewBuildingPlanRowIdentities(subject, createId) {
  for (const rows of Object.values(subject.repeatable || {}))
    for (const row of rows) {
      row.id = createId();
      if (Object.hasOwn(row, 'record_id')) row.record_id = row.id;
      renewBuildingPlanRowIdentities(row, createId);
    }
}

/** A temporary copy may retire only when every row's content survives on its
 * retained owner. Ignore only the identities renewed by the copy operation. */
export function sameBuildingPlanCustomRows(a, b) {
  const content = (repeatable = {}) =>
    Object.fromEntries(
      Object.entries(repeatable).map(([name, rows]) => [
        name,
        rows.map((row) => {
          const result = { ...row };
          delete result.id;
          delete result.record_id;
          if (row.repeatable) result.repeatable = content(row.repeatable);
          return result;
        }),
      ])
    );
  return areJsonValuesEqual(content(a.repeatable), content(b.repeatable));
}
