import {
  numericField,
  calculatedField,
  repeatableSection,
  textField,
  formSchema,
} from './calculation-fixtures.js';

const levels = ['projects', 'tasks', 'visits', 'checks', 'samples', 'readings'];
const names = ['root', ...levels, 'observations', 'payments'];
const weights = [4, 8, 14, 18, 20, 22, 8, 6];
const children = (name) =>
  name === 'root'
    ? ['projects', 'payments']
    : name === 'projects'
      ? ['tasks', 'observations']
      : levels.includes(name) && name !== 'readings'
        ? [levels[levels.indexOf(name) + 1]]
        : [];
const parent = (name) =>
  name === 'payments' || name === 'projects'
    ? 'root'
    : name === 'observations'
      ? 'projects'
      : levels[levels.indexOf(name) - 1];
const condition = (field_id, operator, value) => ({ field_id, operator, value });
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * A broad, populated form rather than thousands of copies of a tiny row schema.
 * 360 scalar fields, 90 calculation definitions, 549 condition leaves, eight collection
 * definitions, six populated nesting levels and two uneven sibling branches.
 * size counts ALL rows across the tree, not rows per collection or leaf rows alone.
 */
export function complexRecordFixture(size = 200, { countCalls = false } = {}) {
  if (!Number.isInteger(size) || size < 100 || size % 100 !== 0)
    throw new Error('Complex fixture size must be a positive multiple of 100.');
  function fields(name) {
    const isRoot = name === 'root';
    const numeric = Array.from({ length: 20 }, (_, i) => numericField(`${name}_n${i}`));
    const text = Array.from({ length: 10 }, (_, i) =>
      textField(`${name}_t${i}`, {
        visible: false,
        visible_conditions: {
          and: [condition('root_n2', 'equal_to', 1), condition(`${name}_c9`, 'equal_to', 1)],
        },
        required_conditions: {
          and: [condition('root_n2', 'equal_to', 1), condition(`${name}_n0`, 'greater_than', 0)],
        },
        read_only_conditions: {
          and: [condition('root_n3', 'equal_to', 1), condition(`${name}_c5`, 'greater_than', 0)],
        },
      })
    );
    const sumChildren = children(name)
      .map((child) => `REPEATABLESUM($${child}, '${child}_c6')`)
      .join(' + ');
    const expressions = [
      isRoot
        ? '$root_n0 * 2'
        : `$${name}_n0 * $${parent(name) === 'root' ? 'root_n0' : `${parent(name)}_c0`}`,
      `$${name}_c0 + 1`,
      `$${name}_c1 * 2`,
      `ROUND($${name}_c2 / 2, 2)`,
      `IF($${name}_n4 > 0, $${name}_c3 + 2, 0)`,
      `$${name}_c4 + 3`,
      isRoot ? sumChildren : `$${name}_c5${sumChildren ? ` + ${sumChildren}` : ''}`,
      `ROUND($${name}_c5 / $root_c6, 6)`,
      isRoot
        ? "REPEATABLEVALUES($readings, 'readings_c5').some(value => value > 20)"
        : 'IF($root_c8, 1, 0)',
      isRoot ? 'IF($root_c8, 1, 0)' : `$${name}_c8 * IF($${name}_n0 > 0, 1, 0)`,
    ];
    const calculated = expressions.map((expression, index) =>
      calculatedField(
        `${name}_c${index}`,
        `SETRESULT(${countCalls ? `countCall(${expression})` : expression})`
      )
    );
    return [
      ...numeric,
      ...calculated,
      ...text.slice(0, 5),
      {
        type: 'Section',
        key: `${name}_details`,
        data_name: `${name}_details`,
        label: 'Additional details',
        display: 'inline',
        description: null,
        description_mode: null,
        visible: false,
        visible_conditions: condition('root_n1', 'equal_to', 1),
        elements: text.slice(5),
      },
      ...children(name).map((child) => repeatableSection(child, fields(child))),
    ];
  }
  const events = [
    "ON('validate-record', function(event) { if ($root_n0 <= 0) INVALID('Factor must be positive'); });",
    ...names
      .slice(1)
      .map(
        (name) =>
          `ON('validate-repeatable', '${name}', function(event) { if ($${name}_n0 > 10) INVALID('Amount exceeds limit'); });`
      ),
  ].join('\n');
  const schema = formSchema(fields('root'), { events: { code: events } });
  const records = new Map();
  function record(name, id) {
    const values = {};
    for (let i = 0; i < 20; i++) values[`${name}_n${i}`] = i === 0 ? (id % 3) + 1 : i + 1;
    for (let i = 0; i < 10; i++) values[`${name}_t${i}`] = i < 5 ? `Accepted ${id}` : null;
    return {
      id,
      values,
      repeatable: Object.fromEntries(children(name).map((child) => [child, []])),
      updated_at_server: '2026-10-01T00:00:00Z',
      custom: { source: name, ordinal: id },
      ...(id === 0 ? { attachments: [{ id: 0, path: 'accepted.jpg', width: 640 }] } : {}),
    };
  }
  const snapshot = record('root', 0);
  Object.assign(snapshot.values, { root_n0: 2, root_n1: 0, root_n2: 1, root_n3: 1 });
  records.set('root', [snapshot]);
  names.slice(1).forEach((name, scopeIndex) => {
    const count = (size * weights[scopeIndex]) / 100;
    const parents = records.get(parent(name));
    const rows = Array.from({ length: count }, (_, index) => {
      const row = record(name, index);
      // Unequal branch lengths, including empty collections, while retaining every row.
      const owner = parents[index % 3 === 0 ? 0 : (index * 13) % parents.length];
      owner.repeatable[name].push(row);
      return row;
    });
    records.set(name, rows);
  });
  const accepted = expectedComplexSnapshot(snapshot, 'refresh');
  // The ancestor changed after these closed-row calculations were accepted.
  accepted.values.root_n0 = 3;
  return {
    schema,
    snapshot: accepted,
    dimensions: {
      schemaElements: 377,
      scalarFieldDefinitions: 360,
      calculationDefinitions: 90,
      conditionLeaves: 549,
      repeatableDefinitions: 8,
      maxRepeatableDepth: 6,
      rows: size,
      populatedValueCells: (size + 1) * 40,
      refreshCalculationTasks: (size + 1) * 10,
      rowsByDefinition: Object.fromEntries(
        names.slice(1).map((name) => [name, records.get(name).length])
      ),
    },
  };
}

/** Domain oracle: compute the fixture's arithmetic directly, without executing schema code. */
export function expectedComplexSnapshot(snapshot, mode) {
  const result = structuredClone(snapshot);
  const entries = [];
  function walk(record, name, ancestorAmount) {
    entries.push({ record, name });
    if (name === 'root' || mode === 'refresh') {
      const amount = record.values[`${name}_n0`];
      const c0 = name === 'root' ? amount * 2 : amount * ancestorAmount;
      const values = [c0, c0 + 1, (c0 + 1) * 2, c0 + 1, c0 + 3, c0 + 6];
      values.forEach((value, i) => (record.values[`${name}_c${i}`] = value));
    }
    for (const child of children(name))
      for (const row of record.repeatable[child])
        walk(row, child, name === 'root' ? record.values.root_n0 : record.values[`${name}_c0`]);
    if (name === 'root' || mode === 'refresh')
      record.values[`${name}_c6`] =
        (name === 'root' ? 0 : record.values[`${name}_c5`]) +
        children(name).reduce(
          (total, child) =>
            total +
            record.repeatable[child].reduce((sum, row) => sum + row.values[`${child}_c6`], 0),
          0
        );
  }
  walk(result, 'root');
  result.values.root_c8 = entries.some(
    ({ record, name }) => name === 'readings' && record.values.readings_c5 > 20
  );
  for (const { record, name } of entries) {
    if (name !== 'root' && mode === 'accepted') continue;
    record.values[`${name}_c7`] = round(record.values[`${name}_c5`] / result.values.root_c6, 6);
    if (name !== 'root') record.values[`${name}_c8`] = result.values.root_c8 ? 1 : 0;
    record.values[`${name}_c9`] = result.values.root_c8 ? 1 : 0;
  }
  return result;
}

/** Portable exhaustive arithmetic/metadata check, shared by Node and actual browser Workers. */
export function checkComplexSnapshot(actual, expected) {
  let rows = 0;
  function check(record, reference) {
    const name = reference.custom.source;
    for (const [field, value] of Object.entries(reference.values))
      if (!Object.is(record.values[field], value))
        throw new Error(
          `${name}/${reference.id}/${field}: expected ${value}, got ${record.values[field]}`
        );
    for (const key of ['id', 'updated_at_server', 'custom', 'attachments'])
      if (JSON.stringify(record[key]) !== JSON.stringify(reference[key]))
        throw new Error(`Record metadata changed: ${name}/${reference.id}/${key}`);
    for (const [collection, entries] of Object.entries(reference.repeatable)) {
      if (record.repeatable[collection].length !== entries.length)
        throw new Error(`Collection membership changed: ${collection}`);
      entries.forEach((row, index) => {
        rows++;
        check(record.repeatable[collection][index], row);
      });
    }
  }
  check(actual, expected);
  return rows;
}
