import { ContextResolver } from '../src/engine/context-resolver.js';
import assert from 'node:assert/strict';
import { copyRecordData, copyRecordDataCooperatively } from '../src/utilities/record-data.js';
import {
  createRecordEvaluator,
  createFormEngine,
  validateSubmission,
  isFieldValueEmpty,
  SAFE_SECURITY_CONFIG,
  createStructuredRecord,
  flattenFields,
  analyzeCalculationExpression,
  getCalculationReferenceCatalog,
  createCalculationPreviewSession,
  validateSchema,
} from '../src/index.js';
import {
  numericField,
  calculatedField,
  repeatableSection,
  textField,
  formSchema,
  commonInputAttributes,
} from './helpers/calculation-fixtures.js';

let count = 0;
async function test(name, run) {
  await run();
  count++;
  console.log(`  ${name}`);
}
const evaluator = (schema, extra = {}) =>
  createRecordEvaluator({ schema, diagnostics: { console: false }, ...extra });
const row = (id, values, repeatable = {}, metadata = {}) => ({
  id,
  values,
  repeatable,
  ...metadata,
});
const lineSchema = (form = {}) =>
  formSchema(
    [
      numericField('tax', { format: 'float' }),
      calculatedField('grand_total', "REPEATABLESUM($lines, 'total')"),
      repeatableSection('lines', [
        numericField('amount'),
        calculatedField('total', 'SETRESULT($amount * (1 + $tax))'),
      ]),
    ],
    form
  );
const input = () => ({
  values: { tax: 0.2, grand_total: 330 },
  repeatable: {
    lines: [row(0, { amount: 100, total: 110 }), row('B', { amount: 200, total: 220 })],
  },
});
const choice = (name, multiple = false) => ({
  ...commonInputAttributes,
  type: multiple ? 'MultiChoiceField' : 'SingleChoiceField',
  key: name,
  data_name: name,
  label: name,
  choices: [
    { value: 'red', label: 'Red' },
    { value: 'blue', label: 'Blue' },
    { value: '100', label: 'One hundred' },
  ],
  allow_other: true,
  default_value: multiple ? null : null,
  is_searchable: false,
  is_searchable_mode: null,
});

for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  const config = security ? { security } : {};
  await test(`${security?.mode || 'trusted'} refresh and accepted snapshots`, async () => {
    const source = input(),
      original = structuredClone(source);
    const instance = evaluator(lineSchema(), config);
    const accepted = await instance.evaluate(source);
    assert.equal(accepted.snapshot.values.grand_total, 330);
    assert.equal(accepted.snapshot.repeatable.lines[0].values.total, 110);
    const fresh = await instance.prepareSubmission(source);
    assert.equal(fresh.status, 'ready');
    assert.equal(fresh.snapshot.values.grand_total, 360);
    assert.deepEqual(
      fresh.snapshot.repeatable.lines.map((item) => item.values.total),
      [120, 240]
    );
    assert.equal(fresh.freshness.status, 'current');
    assert.equal(
      fresh.changes.find((item) => item.fieldName === 'total').instancePath[0].instanceId,
      0
    );
    assert.deepEqual(source, original);
  });
  await test(`${security?.mode || 'trusted'} upward sum then downward share`, async () => {
    const schema = formSchema([
      calculatedField('total', "REPEATABLESUM($items, 'amount')"),
      repeatableSection('items', [
        numericField('amount'),
        calculatedField('share', 'SETRESULT($amount / $total)'),
      ]),
    ]);
    const result = await evaluator(schema, config).evaluate(
      { values: {}, repeatable: { items: [row('A', { amount: 100 }), row('B', { amount: 200 })] } },
      { mode: 'refresh' }
    );
    assert.equal(result.status, 'evaluated');
    assert.equal(result.snapshot.values.total, 300);
    assert.deepEqual(
      result.snapshot.repeatable.items.map((item) => item.values.share),
      [1 / 3, 2 / 3]
    );
  });
}

await test('confirmation retains consistent root totals and requires host permission', async () => {
  const instance = evaluator(lineSchema({ repeatable_recalculation: 'confirm' }));
  let pending = await instance.prepareSubmission(input());
  assert.equal(pending.status, 'requires_decision');
  assert.equal(pending.snapshot, null);
  assert.deepEqual(pending.choices, ['refresh', 'cancel']);
  let result = await instance.prepareSubmission(input(), {
    decision: { reviewId: pending.reviewId, action: 'retain' },
  });
  assert.equal(result.issues[0].code, 'retention_not_allowed');
  pending = await instance.prepareSubmission(input(), { allowRetain: true });
  result = await instance.prepareSubmission(input(), {
    allowRetain: true,
    decision: { reviewId: pending.reviewId, action: 'retain' },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.snapshot.values.grand_total, 330);
  assert.equal(result.freshness.status, 'pending');
  assert.equal(result.freshness.affected.length, 2);
  assert.ok(!JSON.stringify(result.freshness).includes('before'));
  const reopened = await instance.prepareSubmission(result.snapshot, { allowRetain: true });
  assert.equal(reopened.status, 'requires_decision');
  const refreshed = await instance.prepareSubmission(result.snapshot, {
    allowRetain: true,
    decision: { reviewId: reopened.reviewId, action: 'refresh' },
  });
  assert.equal(refreshed.snapshot.values.grand_total, 360);
  assert.equal(refreshed.freshness.status, 'current');
});
await test('review captures the proposal, is single use and rejects changed values', async () => {
  let helperCalls = 0;
  const schema = lineSchema({ repeatable_recalculation: 'confirm' });
  schema.form.elements[2].elements[1].calculate = 'SETRESULT(nextValue($amount))';
  const instance = evaluator(schema, {
    helpers: {
      nextValue: (amount) => {
        helperCalls++;
        return amount * 2;
      },
    },
  });
  let pending = await instance.prepareSubmission(input());
  const calls = helperCalls;
  let result = await instance.prepareSubmission(input(), {
    decision: { reviewId: pending.reviewId, action: 'refresh' },
  });
  assert.equal(result.status, 'ready');
  assert.equal(helperCalls, calls);
  assert.equal(result.snapshot.values.grand_total, 600);
  result = await instance.prepareSubmission(input(), {
    decision: { reviewId: pending.reviewId, action: 'refresh' },
  });
  assert.equal(result.issues[0].code, 'stale_review');
  pending = await instance.prepareSubmission(input());
  const changed = input();
  changed.repeatable.lines[0].values.amount = 101;
  result = await instance.prepareSubmission(changed, {
    decision: { reviewId: pending.reviewId, action: 'refresh' },
  });
  assert.equal(result.issues[0].code, 'stale_review');
});
await test('new preparation and a different evaluator invalidate old reviews', async () => {
  const schema = lineSchema({ repeatable_recalculation: 'confirm' });
  const one = evaluator(schema),
    two = evaluator(schema);
  const a = await one.prepareSubmission(input());
  const b = await one.prepareSubmission(input());
  assert.notEqual(a.reviewId, b.reviewId);
  const c = await two.prepareSubmission(input());
  assert.notEqual(c.reviewId, b.reviewId);
  assert.equal(
    (
      await one.prepareSubmission(input(), {
        decision: { reviewId: a.reviewId, action: 'refresh' },
      })
    ).issues[0].code,
    'stale_review'
  );
});
await test('host can require confirmation and cannot weaken schema confirmation', async () => {
  assert.equal(
    (await evaluator(lineSchema()).prepareSubmission(input(), { mode: 'confirm' })).status,
    'requires_decision'
  );
  assert.equal(
    (
      await evaluator(lineSchema({ repeatable_recalculation: 'confirm' })).prepareSubmission(
        input(),
        { mode: 'automatic' }
      )
    ).status,
    'requires_decision'
  );
  const current = (await evaluator(lineSchema()).prepareSubmission(input())).snapshot;
  assert.equal(
    (
      await evaluator(lineSchema({ repeatable_recalculation: 'confirm' })).prepareSubmission(
        current
      )
    ).status,
    'ready'
  );
});
await test('drafts preserve accepted children, allow errors and carry pending status', async () => {
  const schema = lineSchema({ repeatable_recalculation: 'confirm' });
  schema.form.elements.push(textField('name', { required: true }));
  const result = await evaluator(schema).prepareSubmission(input(), { intent: 'draft' });
  assert.equal(result.status, 'ready');
  assert.equal(result.eligible, true);
  assert.equal(result.validationSummary.hasErrors, true);
  assert.equal(result.snapshot.values.grand_total, 330);
  assert.equal(result.snapshot.repeatable.lines[0].values.total, 110);
  assert.equal(result.freshness.status, 'pending');
});
await test('retained calculation-dependent rules use the retained selected snapshot', async () => {
  const schema = formSchema(
    [
      numericField('threshold'),
      repeatableSection('lines', [
        numericField('amount'),
        calculatedField('needs_note', 'SETRESULT($amount > $threshold)'),
        textField('note', {
          required: true,
          visible: false,
          visible_conditions: { field_id: 'needs_note', operator: 'equal_to', value: true },
        }),
      ]),
    ],
    { repeatable_recalculation: 'confirm' }
  );
  const source = {
    values: { threshold: 80 },
    repeatable: { lines: [row('A', { amount: 100, needs_note: false, note: '' })] },
  };
  const instance = evaluator(schema);
  let pending = await instance.prepareSubmission(source, { allowRetain: true });
  let result = await instance.prepareSubmission(source, {
    allowRetain: true,
    decision: { reviewId: pending.reviewId, action: 'retain' },
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.freshness.status, 'pending');
  pending = await instance.prepareSubmission(source);
  result = await instance.prepareSubmission(source, {
    decision: { reviewId: pending.reviewId, action: 'refresh' },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.validationSummary.requiredFieldErrors[0].fieldName, 'note');
});
await test('deep collection anchors instances and preserves array grouping', async () => {
  const schema = formSchema([
    calculatedField('all_costs', "REPEATABLEVALUES($tasks, 'cost')"),
    repeatableSection('projects', [
      numericField('rate'),
      calculatedField('local_costs', "REPEATABLEVALUES($tasks, 'cost')"),
      repeatableSection('tasks', [
        numericField('hours'),
        calculatedField('cost', 'SETRESULT($hours * $rate)'),
      ]),
    ]),
  ]);
  const source = {
    values: {},
    repeatable: {
      projects: [
        row('P1', { rate: 10 }, { tasks: [row('T1', { hours: 1 }), row('T2', { hours: 2 })] }),
        row('P2', { rate: 100 }, { tasks: [row('T3', { hours: 1 })] }),
      ],
    },
  };
  const result = await evaluator(schema).evaluate(source, { mode: 'refresh' });
  assert.equal(result.status, 'evaluated');
  assert.deepEqual(result.snapshot.values.all_costs, [10, 20, 100]);
  assert.deepEqual(
    result.snapshot.repeatable.projects.map((item) => item.values.local_costs),
    [[10, 20], [100]]
  );
});
await test('hidden accepted rows remain collection members', async () => {
  const schema = lineSchema();
  schema.form.elements[2].visible = false;
  schema.form.elements[2].elements.push(textField('note', { required: true }));
  const result = await evaluator(schema).prepareSubmission(input());
  assert.equal(result.status, 'ready');
  assert.equal(result.snapshot.values.grand_total, 360);
});
await test('root-child-grandchild freshness and exact metadata preservation', async () => {
  const schema = formSchema([
    numericField('multiplier'),
    calculatedField('total', "REPEATABLESUM($tasks, 'cost')"),
    repeatableSection('projects', [
      numericField('rate'),
      calculatedField('adjusted_rate', 'SETRESULT($multiplier * $rate)'),
      repeatableSection('tasks', [
        numericField('hours'),
        calculatedField('cost', 'SETRESULT($hours * $adjusted_rate)'),
      ]),
    ]),
  ]);
  const media = {
    id: 'M1',
    uri: 'file://photo.jpg',
    metadata: { width: 100 },
    created_at_client: '2026-01-01',
  };
  const source = {
    values: { multiplier: 3, created_at_client: '2026-01-01' },
    id: 0,
    host: { retained: true },
    repeatable: {
      projects: [
        row(
          0,
          { rate: 50, adjusted_rate: 100 },
          {
            tasks: [
              row(
                0,
                { hours: 3, cost: 300 },
                {},
                { attachments: [media], updated_at_server: '2026-02-01', custom: { a: 1 } }
              ),
            ],
          }
        ),
      ],
    },
  };
  const original = structuredClone(source);
  const result = await evaluator(schema).prepareSubmission(source);
  assert.equal(result.snapshot.values.total, 450);
  const task = result.snapshot.repeatable.projects[0].repeatable.tasks[0];
  assert.equal(task.values.cost, 450);
  assert.equal(task.id, 0);
  assert.deepEqual(task.attachments, [media]);
  assert.deepEqual(task.custom, { a: 1 });
  assert.equal(task.updated_at_server, '2026-02-01');
  assert.deepEqual(source, original);
  const record = createStructuredRecord(result.snapshot, flattenFields(schema.form.elements), {
    originalElements: schema.form.elements,
  });
  assert.equal(record.form_values.projects[0].form_values.tasks[0].form_values.cost, 450);
});
await test('twenty-two nested levels and uneven sibling branches', async () => {
  let elements = [numericField('amount')];
  let repeatable = {};
  for (let index = 21; index >= 0; index--) {
    elements = [repeatableSection(`level_${index}`, elements)];
    repeatable = {
      [`level_${index}`]: [row(index, index === 21 ? { amount: 7 } : {}, repeatable)],
    };
  }
  const schema = formSchema([
    calculatedField('sum', "REPEATABLESUM($level_21, 'amount')"),
    ...elements,
    repeatableSection('empty_branch', [textField('unused')]),
  ]);
  const result = await evaluator(schema).prepareSubmission({ values: {}, repeatable });
  assert.equal(result.status, 'ready');
  assert.equal(result.snapshot.values.sum, 7);
});
await test('cycles across records fail without a partial snapshot', async () => {
  const schema = formSchema([
    calculatedField('total', "REPEATABLESUM($lines, 'cost')"),
    repeatableSection('lines', [calculatedField('cost', 'SETRESULT($total + 1)')]),
  ]);
  const result = await evaluator(schema).prepareSubmission({
    values: {},
    repeatable: { lines: [row('A', {})] },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.snapshot, null);
  assert.equal(result.issues[0].code, 'record_dependency_cycle');
});
await test('local cycles retain diagnostics-only semantics', async () => {
  const schema = formSchema([
    calculatedField('a', 'SETRESULT($b+1)'),
    calculatedField('b', 'SETRESULT($a+1)'),
  ]);
  const result = await evaluator(schema).prepareSubmission({ values: {} });
  assert.equal(result.status, 'ready');
  assert.equal(result.snapshot.values.a, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'cyclic_dependencies'));
});
await test('dynamic EVAL resolves current scoped dependencies and detects feedback', async () => {
  const schema = formSchema([
    calculatedField('root_calc', 'SETRESULT(7)'),
    repeatableSection('lines', [
      textField('target'),
      calculatedField('cost', "SETRESULT(EVAL('$' + $target))"),
    ]),
  ]);
  let result = await evaluator(schema).prepareSubmission({
    values: {},
    repeatable: { lines: [row('A', { target: 'root_calc' })] },
  });
  assert.equal(result.snapshot.repeatable.lines[0].values.cost, 7);
  schema.form.elements[0].calculate = "REPEATABLESUM($lines, 'cost')";
  result = await evaluator(schema).prepareSubmission({
    values: {},
    repeatable: { lines: [row('A', { target: 'root_calc' })] },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.issues[0].code, 'record_dependency_cycle');
});
await test('missing context and unsupported collection syntax are explicit diagnostics', async () => {
  const schema = lineSchema();
  const engine = createFormEngine({ schema, diagnostics: { console: false } });
  engine.eval();
  assert.ok(engine.getDiagnostics().some((item) => item.message.includes('record-tree context')));
  for (const expression of [
    'REPEATABLESUM($lines, $field)',
    "const f = REPEATABLESUM; SETRESULT(f($lines, 'total'));",
    `EVAL("REPEATABLESUM($lines, 'total')")`,
  ]) {
    const analysis = analyzeCalculationExpression({
      schema,
      fieldDataName: 'grand_total',
      expression,
    });
    assert.equal(analysis.valid, false, expression);
  }
  assert.equal(
    analyzeCalculationExpression({
      schema,
      fieldDataName: 'grand_total',
      expression: "REPEATABLESUM($lines, 'amount')",
    }).valid,
    true
  );
  assert.ok(
    getCalculationReferenceCatalog({
      schema,
      fieldDataName: 'grand_total',
      includeCollections: true,
    }).some((item) => item.dataName === 'lines' && item.collectionOnly)
  );
  assert.ok(
    !getCalculationReferenceCatalog({ schema, fieldDataName: 'grand_total' }).some(
      (item) => item.type === 'RepeatableSection'
    )
  );
});
await test('preview supports explicit record-tree evaluation', async () => {
  const session = createCalculationPreviewSession({
    schema: lineSchema(),
    fieldDataName: 'grand_total',
    expression: "REPEATABLESUM($lines, 'total')",
  });
  const result = await session.runRecord({ snapshot: input() });
  assert.equal(result.result, 360);
  assert.equal(result.runtimeError, null);
  session.dispose();
});
await test('unrelated nested collection and targets outside the named rows are rejected', async () => {
  const schema = formSchema([
    repeatableSection('projects', [repeatableSection('tasks', [numericField('cost')])]),
    repeatableSection('payments', [calculatedField('bad', "REPEATABLESUM($tasks, 'cost')")]),
  ]);
  const result = await evaluator(schema).evaluate(
    { values: {}, repeatable: { payments: [row('P', {})] } },
    { mode: 'refresh' }
  );
  assert.ok(result.diagnostics.some((item) => item.code === 'invalid_collection_reference'));
  assert.equal(
    analyzeCalculationExpression({
      schema,
      fieldDataName: 'bad',
      expression: "REPEATABLESUM($projects, 'cost')",
    }).valid,
    false
  );
});
await test('strict sums preserve missing slots and reject coercion and overflow', async () => {
  const schema = formSchema([
    calculatedField('values', "REPEATABLEVALUES($lines, 'amount')"),
    calculatedField('sum', "REPEATABLESUM($lines, 'amount')"),
    repeatableSection('lines', [numericField('amount')]),
  ]);
  for (const [values, sum] of [
    [[100, null, 200], 300],
    [[], 0],
    [[0, 2], 2],
  ]) {
    const result = await evaluator(schema).prepareSubmission({
      values: {},
      repeatable: { lines: values.map((amount, index) => row(index, { amount })) },
    });
    assert.equal(result.snapshot.values.sum, sum);
    assert.deepEqual(result.snapshot.values.values, values);
  }
  for (const value of ['200', 'invalid', Infinity, NaN]) {
    const result = await evaluator(schema).prepareSubmission({
      values: {},
      repeatable: { lines: [row(0, { amount: 100 }), row(1, { amount: value })] },
    });
    assert.equal(result.snapshot.values.sum, null);
    assert.ok(result.diagnostics.some((item) => item.message.includes('finite numbers')));
  }
  const overflow = await evaluator(schema).prepareSubmission({
    values: {},
    repeatable: { lines: [row(0, { amount: 1e308 }), row(1, { amount: 1e308 })] },
  });
  assert.equal(overflow.snapshot.values.sum, null);
});
await test('choice projections preserve strings, Other text, grouping and reject ambiguity', async () => {
  for (const multiple of [false, true]) {
    const schema = formSchema([
      calculatedField('collected', "REPEATABLEVALUES($lines, 'selection')"),
      repeatableSection('lines', [choice('selection', multiple)]),
    ]);
    const key = multiple ? 'choices' : 'choice';
    const selections = [
      { [key]: [{ value: 'red', label: 'Red' }], other: [] },
      { [key]: [], other: [] },
      { [key]: [], other: [{ label: 'Teal' }] },
      { [key]: [{ value: '100', label: 'One hundred' }], other: [] },
    ];
    const result = await evaluator(schema).prepareSubmission({
      values: {},
      repeatable: { lines: selections.map((selection, index) => row(index, { selection })) },
    });
    assert.deepEqual(
      result.snapshot.values.collected,
      multiple ? [['red'], [], ['Teal'], ['100']] : ['red', null, 'Teal', '100']
    );
    const malformed = await evaluator(schema).prepareSubmission({
      values: {},
      repeatable: { lines: [row(0, { selection: { [key]: [{ value: 'unknown' }], other: [] } })] },
    });
    assert.equal(malformed.snapshot.values.collected, null);
    assert.ok(malformed.diagnostics.length);
    if (!multiple) {
      const ambiguous = await evaluator(schema).prepareSubmission({
        values: {},
        repeatable: {
          lines: [
            row(0, { selection: { choice: [{ value: 'red' }], other: [{ label: 'Teal' }] } }),
          ],
        },
      });
      assert.equal(ambiguous.snapshot.values.collected, null);
    }
  }
});
await test('linked references omit titles/defaults while preserving grouping', async () => {
  const link = {
    ...commonInputAttributes,
    type: 'FormLinkField',
    key: 'link',
    data_name: 'link',
    label: 'Link',
    form_id: 'linked',
    allow_creating_records: false,
    allow_existing_records: true,
    allow_updating_records: false,
    allow_multiple_records: true,
    record_conditions: null,
    record_defaults: null,
  };
  delete link.supporting_image;
  delete link.supporting_image_path;
  delete link.supporting_image_display;
  const schema = formSchema([
    calculatedField('refs', "REPEATABLEVALUES($lines, 'link')"),
    repeatableSection('lines', [link]),
  ]);
  const result = await evaluator(schema).prepareSubmission({
    values: {},
    repeatable: {
      lines: [
        row(0, { link: [{ record_id: 'R1', title: 'One', defaults: { hidden: 1 } }] }),
        row(1, { link: [{ record_id: 'R2' }, { record_id: 'R3' }] }),
      ],
    },
  });
  assert.deepEqual(result.snapshot.values.refs, [
    [{ record_id: 'R1' }],
    [{ record_id: 'R2' }, { record_id: 'R3' }],
  ]);
});
await test('hidden ancestors exclude findings without rewriting local visibility', async () => {
  const section = {
    type: 'Section',
    key: 'business',
    data_name: 'business',
    label: 'Business',
    display: 'inline',
    description: null,
    description_mode: null,
    visible: false,
    visible_conditions: null,
    elements: [textField('vat', { required: true, read_only: true })],
  };
  const schema = formSchema([section]);
  let result = await evaluator(schema).prepareSubmission({ values: { vat: '' } });
  assert.equal(result.status, 'ready');
  assert.equal(result.snapshot.visible.vat, true);
  assert.equal(result.snapshot.visible.business, false);
  section.visible = true;
  result = await evaluator(schema).prepareSubmission({ values: { vat: '' } });
  assert.equal(result.status, 'blocked');
  assert.equal(result.validationSummary.requiredFieldErrors.length, 1);
  assert.deepEqual(result.snapshot.errors, {});
  const standalone = validateSubmission({ schema, snapshot: result.snapshot });
  assert.equal(standalone.hasErrors, true);
});
await test('type-aware emptiness covers all catalog value families', async () => {
  const cases = [
    ['TextField', ' ', true],
    ['NumericField', 0, false],
    ['CalculatedField', false, false],
    ['DateField', '', true],
    ['TimeField', '12:00', false],
    ['SingleChoiceField', { choice: [{ value: false }], other: [] }, false],
    ['BooleanField', { choice: [{ value: 'false' }], other: [] }, false],
    ['MultiChoiceField', { choices: [], other: [{ label: 'Teal' }] }, false],
    ['PhotoField', [], true],
    ['VideoField', [{ id: 'media' }], false],
    ['SignatureField', { data: 'base64' }, false],
    ['FormLinkField', [], true],
    ['StatusField', 'open', false],
    ['TitleField', '', true],
    ['LabelField', null, true],
    ['Section', null, true],
    ['RepeatableSection', null, true],
    ['BuildingPlanSection', null, true],
  ];
  for (const [type, value, expected] of cases)
    assert.equal(Boolean(isFieldValueEmpty({ type }, value)), expected, type);
});
await test('automatic closed-row custom checks, hidden scope exclusion and draft errors', async () => {
  const schema = formSchema(
    [numericField('limit'), repeatableSection('lines', [numericField('amount')])],
    {
      events: {
        code: "ON('validate-repeatable', 'lines', function(event) { if ($amount > $limit) INVALID('Amount exceeds current limit'); }); ON('load-repeatable', 'lines', function(event) { ALERT('MUST NOT RUN'); });",
      },
    }
  );
  const source = {
    values: { limit: 80 },
    repeatable: {
      lines: Array.from({ length: 200 }, (_, index) =>
        row(index, { amount: index < 100 ? 100 : 50 })
      ),
    },
  };
  let result = await evaluator(schema).prepareSubmission(source, { managedEvents: true });
  assert.equal(result.status, 'blocked');
  assert.equal(result.validationSummary.scopeIssues.length, 100);
  assert.equal(result.validationSummary.scopeIssues[0].instancePath[0].instanceId, 0);
  assert.equal(result.issues.length, 0);
  result = await evaluator(schema).prepareSubmission(source, {
    managedEvents: true,
    intent: 'draft',
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.validationSummary.hasErrors, true);
  result = await evaluator(schema).prepareSubmission(source);
  assert.equal(result.status, 'ready');
  schema.form.elements[1].visible = false;
  result = await evaluator(schema).prepareSubmission(source, { managedEvents: true });
  assert.equal(result.status, 'ready');
  assert.equal(result.validationSummary.scopeIssues.length, 0);
});
await test('validation operations are rejected even for drafts; root INVALID remains scope-level', async () => {
  const schema = formSchema([numericField('amount')], {
    events: { code: "ON('validate-record', function(event) { SETVALUE('amount', 99); });" },
  });
  let result = await evaluator(schema).prepareSubmission(
    { values: { amount: 1 } },
    { managedEvents: true, intent: 'draft' }
  );
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.some((item) => item.code === 'operation_not_allowed'));
  schema.form.events.code = "ON('validate-record', function(event) { INVALID('Root problem'); });";
  result = await evaluator(schema).prepareSubmission(
    { values: { amount: 1 } },
    { managedEvents: true }
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.validationSummary.scopeIssues[0].fieldName, undefined);
  assert.deepEqual(result.validationSummary.scopeIssues[0].instancePath, []);
});
await test('cancellation and yielding stop without delivering a partial tree', async () => {
  const controller = new AbortController();
  let yields = 0;
  const result = await evaluator(lineSchema()).evaluate(input(), {
    mode: 'refresh',
    budgetMs: 0,
    signal: controller.signal,
    yieldToHost: async () => {
      yields++;
      controller.abort();
    },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.snapshot, null);
  assert.equal(yields, 1);
});
await test('accepted child save updates aggregation, cancellation leaves it unchanged', async () => {
  const source = input(),
    instance = evaluator(lineSchema());
  const first = await instance.evaluate(source);
  assert.equal(first.snapshot.values.grand_total, 330);
  const accepted = input();
  accepted.repeatable.lines[0].values = { amount: 150, total: 180 };
  assert.equal((await instance.evaluate(accepted)).snapshot.values.grand_total, 400);
  assert.equal((await instance.evaluate(source)).snapshot.values.grand_total, 330);
});
await test('invalid modes, metadata shape and duplicate IDs report configuration failures', async () => {
  assert.throws(
    () => validateSchema(lineSchema({ repeatable_recalculation: 'sometimes' }).form),
    /repeatable_recalculation/
  );
  assert.equal(
    (await evaluator(lineSchema()).evaluate(input(), { mode: 'invalid' })).status,
    'failed'
  );
  const source = input();
  source.repeatable.lines[1].id = 0;
  assert.equal((await evaluator(lineSchema()).prepareSubmission(source)).status, 'failed');
});
await test('save-once orchestration revalidates changed input and serializes that snapshot', async () => {
  const instance = evaluator(lineSchema());
  const source = input();
  let saves = 0;
  let prepared = await instance.prepareSubmission(source);
  assert.equal(prepared.status, 'ready');
  if (prepared.eligible) {
    saves++;
    source.values.tax = 0.3;
    prepared = await instance.prepareSubmission(source);
  }
  assert.equal(saves, 1);
  assert.equal(prepared.snapshot.values.grand_total, 390);
  const record = createStructuredRecord(
    prepared.snapshot,
    flattenFields(lineSchema().form.elements),
    { originalElements: lineSchema().form.elements }
  );
  assert.equal(record.form_values.grand_total, 390);
  assert.equal(record.form_values.lines[0].form_values.total, 130);
});

await test('complex dynamic EVAL is dependency-aware', async () => {
  const schema = formSchema([
    calculatedField('answer', 'SETRESULT(EVAL($expression))'),
    textField('expression'),
    calculatedField('base', 'SETRESULT(7)'),
  ]);
  const result = await evaluator(schema).prepareSubmission({
    values: { expression: '($base * 2)' },
  });
  assert.equal(result.snapshot.values.answer, 14);
});
await test('captured evaluation ignores edits made while yielded', async () => {
  const source = input();
  let changed = false;
  const result = await evaluator(lineSchema()).evaluate(source, {
    mode: 'refresh',
    budgetMs: 0,
    yieldToHost: async () => {
      if (!changed) {
        source.values.tax = 0.9;
        changed = true;
      }
    },
  });
  assert.equal(result.snapshot.values.grand_total, 360);
  assert.equal(source.values.tax, 0.9);
});
await test('cancelled and superseded preparations cannot deliver a snapshot', async () => {
  const controller = new AbortController();
  controller.abort();
  const instance = evaluator(lineSchema({ repeatable_recalculation: 'confirm' }));
  const pending = await instance.prepareSubmission(input());
  const cancelled = await instance.prepareSubmission(input(), {
    signal: controller.signal,
    decision: { reviewId: pending.reviewId, action: 'refresh' },
  });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.snapshot, null);
  let release;
  let waiting;
  const entered = new Promise((resolve) => {
    waiting = resolve;
  });
  let yielded = false;
  const first = instance.prepareSubmission(input(), {
    budgetMs: 0,
    yieldToHost: async () => {
      if (!yielded) {
        yielded = true;
        waiting();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
    },
  });
  await entered;
  const second = await instance.prepareSubmission(input());
  release();
  assert.equal(second.status, 'requires_decision');
  assert.equal((await first).issues[0].code, 'stale_preparation');
});
await test('media handles and expanded BuildingPlan schemas remain supported', async () => {
  const source = input();
  const blob = new Blob(['media'], { type: 'image/jpeg' });
  source.repeatable.lines[0].attachments = [{ file: blob, metadata: { id: 0 } }];
  const result = await evaluator(lineSchema()).prepareSubmission(source);
  assert.equal(result.snapshot.repeatable.lines[0].attachments[0].file, blob);
  assert.equal(await blob.text(), 'media');
  const building = {
    type: 'BuildingPlanSection',
    key: 'bp',
    data_name: 'building',
    label: 'Building',
    description: null,
    description_mode: null,
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    node_overrides: null,
  };
  assert.equal(
    (await evaluator(formSchema([building])).prepareSubmission({ values: {}, repeatable: {} }))
      .status,
    'ready'
  );
});
await test('root collection -> payment helper -> local visibility works with real collections', async () => {
  for (const security of [undefined, SAFE_SECURITY_CONFIG])
    for (const score of [90, 60]) {
      const schema = formSchema([
        calculatedField('scores', "REPEATABLEVALUES($inspections, 'score')"),
        repeatableSection('inspections', [numericField('score')]),
        repeatableSection('payments', [
          calculatedField(
            'needs_note',
            'SETRESULT($scores.some(score => typeof score === "number" && score < 80))',
            { visible: false }
          ),
          textField('note', {
            required: true,
            visible: false,
            visible_conditions: { field_id: 'needs_note', operator: 'equal_to', value: true },
          }),
        ]),
      ]);
      const result = await evaluator(schema, security ? { security } : {}).prepareSubmission({
        values: {},
        repeatable: {
          inspections: [row('I1', { score: 95 }), row('I2', { score })],
          payments: [row('P1', { note: '' })],
        },
      });
      assert.equal(result.status, score < 80 ? 'blocked' : 'ready');
      assert.deepEqual(result.snapshot.values.scores, [95, score]);
    }
});
await test('new collections remain calculation-only and nested engines restore EVAL', async () => {
  const inner = createFormEngine({
    schema: formSchema([calculatedField('inner', 'SETRESULT(2)')]),
    diagnostics: { console: false },
  });
  const schema = lineSchema();
  schema.form.elements[1].calculate =
    "nested();\nSETRESULT(REPEATABLESUM($lines, 'total') + EVAL('$tax'));";
  const result = await evaluator(schema, {
    helpers: {
      nested() {
        inner.eval();
      },
    },
  }).prepareSubmission(input());
  assert.equal(result.snapshot.values.grand_total, 360.2);
});

await test('compiled expressions are reused across rows and input key order changes', async () => {
  const OriginalFunction = globalThis.Function;
  let compilations = 0;
  globalThis.Function = new Proxy(OriginalFunction, {
    construct(target, args, newTarget) {
      compilations++;
      return Reflect.construct(target, args, newTarget);
    },
  });
  try {
    const instance = evaluator(lineSchema());
    assert.equal((await instance.prepareSubmission(input())).status, 'ready');
    const first = compilations;
    assert.equal(first, 2);
    const reordered = input();
    reordered.values = { grand_total: 330, tax: 0.2 };
    assert.equal((await instance.prepareSubmission(reordered)).status, 'ready');
    assert.equal(compilations, first);
  } finally {
    globalThis.Function = OriginalFunction;
  }
});

await test('managed registration receives root values at its first selected snapshot', async () => {
  const schema = formSchema([numericField('limit')], {
    events: {
      code: "if ($limit > 0) ON('validate-record', function(event) { INVALID('Registered root rule'); });",
    },
  });
  const result = await evaluator(schema).prepareSubmission(
    { values: { limit: 80 } },
    { managedEvents: true }
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.validationSummary.scopeIssues[0].message, 'Registered root rule');
});

await test('ancestor object reads cannot write into another record', async () => {
  for (const expression of [
    '$info.value = 99;\nSETRESULT(1);',
    "EVAL('$info').value = 99;\nSETRESULT(1);",
  ]) {
    const schema = formSchema([
      calculatedField('info', 'SETRESULT({value:7})'),
      repeatableSection('rows', [calculatedField('attempt', expression)]),
    ]);
    const result = await evaluator(schema).prepareSubmission({
      values: {},
      repeatable: { rows: [row(0, {})] },
    });
    assert.equal(result.snapshot.values.info.value, 7);
    assert.equal(result.snapshot.repeatable.rows[0].values.attempt, 1);
  }
});

await test('closed-row registration conditions use each selected row without lifecycle replay', async () => {
  const schema = formSchema([repeatableSection('rows', [numericField('amount')])], {
    events: {
      code: "if ($amount > 80) ON('validate-repeatable', 'rows', function(event) { INVALID('Row rule'); });",
    },
  });
  const result = await evaluator(schema).prepareSubmission(
    { values: {}, repeatable: { rows: [row('A', { amount: 100 }), row('B', { amount: 50 })] } },
    { managedEvents: true }
  );
  assert.equal(result.status, 'blocked');
  assert.equal(result.validationSummary.scopeIssues.length, 1);
  assert.equal(result.validationSummary.scopeIssues[0].instancePath[0].instanceId, 'A');
});

await test('one ownership index serves all row instances and repeated preparations', async () => {
  const original = ContextResolver.prototype.buildFieldContext;
  const seen = new WeakSet();
  let constructions = 0;
  ContextResolver.prototype.buildFieldContext = function (...args) {
    if (!seen.has(this)) {
      seen.add(this);
      constructions++;
    }
    return original.apply(this, args);
  };
  try {
    const instance = evaluator(lineSchema());
    for (let i = 0; i < 3; i++)
      assert.equal((await instance.prepareSubmission(input())).status, 'ready');
    assert.equal(constructions, 1);
  } finally {
    ContextResolver.prototype.buildFieldContext = original;
  }
});

await test('all condition properties resolve root and multiple ancestor-row references', async () => {
  for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
    const note = textField('note', {
      visible: false,
      visible_conditions: { field_id: 'gate_key', operator: 'greater_than', value: 0 },
      required: false,
      required_conditions: { field_id: 'limit_key', operator: 'greater_than', value: 5 },
      read_only: false,
      read_only_conditions: { field_id: 'gate_key', operator: 'greater_than', value: 1 },
    });
    const schema = formSchema([
      numericField('gate', { key: 'gate_key' }),
      repeatableSection('projects', [
        numericField('limit', { key: 'limit_key' }),
        repeatableSection('tasks', [note]),
      ]),
    ]);
    const source = {
      values: { gate: 2 },
      repeatable: { projects: [row('P1', { limit: 10 }, { tasks: [row('T1', { note: '' })] })] },
    };
    const result = await evaluator(schema, security ? { security } : {}).prepareSubmission(source);
    assert.equal(result.status, 'blocked');
    const task = result.snapshot.repeatable.projects[0].repeatable.tasks[0];
    assert.deepEqual(
      [task.visible.note, task.required.note, task.read_only.note],
      [true, true, true]
    );
  }
});
await test('grouped freshness preserves identities, row order, review isolation and reopening', async () => {
  const schema = formSchema(
    [
      numericField('rate'),
      calculatedField('grand', "REPEATABLESUM($tasks, 'subtotal')"),
      repeatableSection('parents', [
        numericField('multiplier'),
        repeatableSection('tasks', [
          numericField('amount'),
          calculatedField('subtotal', 'SETRESULT($rate * $multiplier * $amount)', {
            key: 'subtotal_key',
          }),
          calculatedField('tax', 'SETRESULT($subtotal * 0.1)', { key: 'tax_key' }),
        ]),
      ]),
    ],
    { repeatable_recalculation: 'confirm' }
  );
  const snapshot = {
    values: { rate: 3 },
    repeatable: {
      parents: [
        row(
          0,
          { multiplier: 2 },
          {
            tasks: [
              row(0, { amount: 10, subtotal: 40, tax: 4 }),
              { values: { amount: 5, subtotal: 20, tax: 2 } },
            ],
          }
        ),
        row(1, { multiplier: 5 }, { tasks: [row(0, { amount: 1, subtotal: 10, tax: 1 })] }),
      ],
    },
  };
  for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
    const instance = evaluator(schema, { security });
    const pending = await instance.prepareSubmission(snapshot, { allowRetain: true });
    assert.equal(pending.status, 'requires_decision');
    const metadata = JSON.parse(JSON.stringify(pending.freshness));
    assert.equal(metadata.version, 1);
    assert.equal(metadata.affected.length, 3);
    assert.deepEqual(
      metadata.affected.map(({ instancePath }) =>
        instancePath.map(({ instanceId, identity }) => [instanceId, identity])
      ),
      [
        [
          [0, 'id'],
          [0, 'id'],
        ],
        [
          [0, 'id'],
          [null, 'position'],
        ],
        [
          [1, 'id'],
          [0, 'id'],
        ],
      ]
    );
    for (const entry of metadata.affected)
      assert.deepEqual(entry.fields, [
        { fieldName: 'subtotal', fieldKey: 'subtotal_key' },
        { fieldName: 'tax', fieldKey: 'tax_key' },
      ]);
    const flat = metadata.affected.flatMap(({ instancePath, fields }) =>
      fields.map((field) => ({ instancePath, ...field }))
    );
    assert.deepEqual(
      flat,
      pending.changes
        .filter(({ instancePath }) => instancePath.length)
        .map(({ instancePath, fieldName, fieldKey }) => ({ instancePath, fieldName, fieldKey }))
    );
    pending.freshness.affected[0].instancePath[0].instanceId = 'tampered';
    pending.freshness.affected[0].fields[0].fieldName = 'tampered';
    const retained = await instance.prepareSubmission(snapshot, {
      allowRetain: true,
      decision: { reviewId: pending.reviewId, action: 'retain' },
    });
    assert.equal(retained.status, 'ready');
    assert.equal(retained.snapshot.values.grand, 70);
    assert.deepEqual(retained.freshness, metadata);
    const reopened = JSON.parse(JSON.stringify(retained.snapshot));
    const review = await instance.prepareSubmission(reopened, { allowRetain: true });
    assert.equal(review.status, 'requires_decision');
    assert.deepEqual(review.freshness, metadata);
    const refreshed = await instance.prepareSubmission(reopened, {
      allowRetain: true,
      decision: { reviewId: review.reviewId, action: 'refresh' },
    });
    assert.equal(refreshed.snapshot.values.grand, 105);
    assert.equal(refreshed.freshness.status, 'current');
    assert.deepEqual(refreshed.freshness.affected, []);
  }
});
await test('already cancelled preparation releases its review without copying the record', async () => {
  const instance = evaluator(lineSchema());
  const abort = new AbortController();
  abort.abort();
  let reads = 0;
  const snapshot = {
    get values() {
      reads++;
      return {};
    },
  };
  const result = await instance.prepareSubmission(snapshot, { signal: abort.signal });
  assert.equal(result.status, 'cancelled');
  assert.equal(reads, 0);
});

await test('cooperative result copies preserve portable shapes and detach all mutable aliases', async () => {
  const shared = { nested: [0, false, undefined, NaN, Infinity] };
  const data = {
    id: 0,
    first: shared,
    second: shared,
    date: new Date('2026-10-24T00:00:00.000Z'),
    media: new Blob(['immutable'], { type: 'text/plain' }),
    rows: Array.from({ length: 200 }, (_, id) => ({ id, values: { amount: id } })),
  };
  Object.defineProperty(data, '__proto__', { value: { harmless: true }, enumerable: true });
  let checkpoints = 0;
  const result = await copyRecordDataCooperatively(data, async () => {
    checkpoints++;
  });
  assert.ok(checkpoints > 1);
  assert.deepEqual(result, copyRecordData(data));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.notEqual(result.first, data.first);
  assert.notEqual(result.first, result.second);
  assert.notEqual(result.date, data.date);
  assert.equal(result.media, data.media);
  result.rows[0].values.amount = 999;
  assert.equal(data.rows[0].values.amount, 0);
  const cyclic = {};
  cyclic.self = cyclic;
  for (const invalid of [cyclic, { value: () => 1 }, { value: Symbol('invalid') }, new Map()])
    await assert.rejects(
      copyRecordDataCooperatively(invalid, async () => {}),
      /Record data/
    );
});

await test('large result delivery yields and can be cancelled after managed validation', async () => {
  for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
    const schema = formSchema([repeatableSection('rows', [numericField('amount')])]);
    schema.form.events = {
      code: "ON('validate-repeatable', 'rows', function() { if ($amount === 99) finished(); });",
    };
    let validated = false,
      afterValidation = 0;
    const abort = new AbortController();
    const instance = evaluator(schema, {
      security,
      helpers: { finished: () => (validated = true) },
    });
    const snapshot = {
      values: {},
      repeatable: { rows: Array.from({ length: 100 }, (_, id) => row(id, { amount: id })) },
    };
    const original = structuredClone(snapshot);
    const result = await instance.prepareSubmission(snapshot, {
      managedEvents: true,
      budgetMs: 0,
      signal: abort.signal,
      yieldToHost() {
        if (validated && ++afterValidation === 3) abort.abort();
      },
    });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.snapshot, null);
    assert.deepEqual(snapshot, original);
  }
});

await test('a newer preparation supersedes a result while its delivery is yielding', async () => {
  const schema = formSchema([repeatableSection('rows', [numericField('amount')])]);
  schema.form.events = {
    code: "ON('validate-repeatable', 'rows', function() { if ($amount === 99) finished(); });",
  };
  let validated = false,
    afterValidation = 0,
    newer;
  const instance = evaluator(schema, { helpers: { finished: () => (validated = true) } });
  const snapshot = {
    values: {},
    repeatable: { rows: Array.from({ length: 100 }, (_, id) => row(id, { amount: id })) },
  };
  const old = await instance.prepareSubmission(snapshot, {
    managedEvents: true,
    budgetMs: 0,
    yieldToHost() {
      if (validated && ++afterValidation === 3) newer = instance.prepareSubmission(snapshot);
    },
  });
  assert.ok(newer, 'Result delivery must offer a scheduling opportunity.');
  assert.equal(old.issues[0].code, 'stale_preparation');
  assert.equal((await newer).eligible, true);
});

console.log(`Record evaluator: ${count} scenarios passed.`);
