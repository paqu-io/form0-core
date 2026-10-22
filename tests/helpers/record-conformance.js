import {
  numericField,
  calculatedField,
  repeatableSection,
  textField,
  formSchema,
} from './calculation-fixtures.js';

/** Portable real-core conformance used by packed browser/worker/Native/CLI verification. */
export async function runRecordConformance(core) {
  const results = [];
  const check = (value, expected, name) => {
    if (JSON.stringify(value) !== JSON.stringify(expected))
      throw new Error(`Conformance failed: ${name}`);
    results.push({ name, value });
  };
  for (const security of [undefined, core.SAFE_SECURITY_CONFIG]) {
    const mode = security?.mode || 'trusted';
    const schema = formSchema([
      numericField('tax', { format: 'float' }),
      calculatedField('total', "REPEATABLESUM($lines, 'cost')"),
      repeatableSection('lines', [
        numericField('amount'),
        calculatedField('cost', 'SETRESULT($amount*(1+$tax))'),
      ]),
    ]);
    const source = {
      values: { tax: 0.2 },
      repeatable: {
        lines: [
          { id: 0, values: { amount: 100, cost: 110 } },
          { id: 'B', values: { amount: 200, cost: 220 } },
        ],
      },
    };
    const evaluator = core.createRecordEvaluator({
      schema,
      security,
      diagnostics: { console: false },
    });
    const accepted = await evaluator.evaluate(source);
    check(accepted.snapshot.values.total, 330, `${mode}: accepted aggregation`);
    const refreshed = await evaluator.prepareSubmission(source);
    check(
      [
        refreshed.status,
        refreshed.snapshot.values.total,
        refreshed.snapshot.repeatable.lines.map((row) => row.values.cost),
      ],
      ['ready', 360, [120, 240]],
      `${mode}: refreshed validation snapshot`
    );
    check(source.repeatable.lines[0].values.cost, 110, `${mode}: immutable source`);
    const pending = await evaluator.prepareSubmission(source, {
      mode: 'confirm',
      allowRetain: true,
    });
    check(
      [pending.status, pending.snapshot],
      ['requires_decision', null],
      `${mode}: review required`
    );
    const retained = await evaluator.prepareSubmission(source, {
      mode: 'confirm',
      allowRetain: true,
      decision: { reviewId: pending.reviewId, action: 'retain' },
    });
    check(
      [
        retained.snapshot.values.total,
        retained.freshness.status,
        retained.freshness.affected[0].instancePath[0].instanceId,
        retained.freshness.affected[0].fields,
      ],
      [330, 'pending', 0, [{ fieldName: 'cost', fieldKey: 'cost' }]],
      `${mode}: retained consistency and identity zero`
    );
    const nested = formSchema([
      calculatedField('all', "REPEATABLEVALUES($tasks, 'cost')"),
      repeatableSection('projects', [
        numericField('rate'),
        calculatedField('own', "REPEATABLEVALUES($tasks, 'cost')"),
        repeatableSection('tasks', [
          numericField('hours'),
          calculatedField('cost', 'SETRESULT($rate*$hours)'),
        ]),
      ]),
    ]);
    const nestedInput = {
      values: {},
      repeatable: {
        projects: [
          {
            id: 'P1',
            values: { rate: 10 },
            repeatable: {
              tasks: [
                { id: 'T1', values: { hours: 1 } },
                { id: 'T2', values: { hours: 2 } },
              ],
            },
          },
          {
            id: 'P2',
            values: { rate: 100 },
            repeatable: { tasks: [{ id: 'T3', values: { hours: 1 } }] },
          },
        ],
      },
    };
    const nestedResult = await core
      .createRecordEvaluator({ schema: nested, security, diagnostics: { console: false } })
      .prepareSubmission(nestedInput);
    check(
      [
        nestedResult.snapshot.values.all,
        nestedResult.snapshot.repeatable.projects.map((row) => row.values.own),
      ],
      [
        [10, 20, 100],
        [[10, 20], [100]],
      ],
      `${mode}: nested instance anchors`
    );
    const customSchema = formSchema(
      [
        numericField('limit'),
        repeatableSection('rows', [
          numericField('amount'),
          textField('note', {
            required: true,
            visible: false,
            visible_conditions: { field_id: 'limit', operator: 'less_than', value: 0 },
          }),
        ]),
      ],
      {
        events: {
          code: "ON('validate-repeatable', 'rows', function(event) { if ($amount > $limit) INVALID('Amount exceeds limit'); });",
        },
      }
    );
    const custom = core.createRecordEvaluator({
      schema: customSchema,
      security,
      diagnostics: { console: false },
    });
    const customSource = {
      values: { limit: 80 },
      repeatable: { rows: [{ id: 0, values: { amount: 100, note: '' } }] },
    };
    const blocked = await custom.prepareSubmission(customSource, { managedEvents: true });
    check(
      [
        blocked.status,
        blocked.validationSummary.scopeIssues.length,
        blocked.validationSummary.requiredFieldErrors.length,
      ],
      ['blocked', 1, 0],
      `${mode}: automatic closed validation and hidden field`
    );
    const draft = await custom.prepareSubmission(customSource, {
      managedEvents: true,
      intent: 'draft',
    });
    check(
      [draft.status, draft.validationSummary.hasErrors],
      ['ready', true],
      `${mode}: invalid drafts`
    );
  }
  const cyclic = formSchema([
    calculatedField('total', "REPEATABLESUM($rows, 'cost')"),
    repeatableSection('rows', [calculatedField('cost', 'SETRESULT($total+1)')]),
  ]);
  const failed = await core
    .createRecordEvaluator({ schema: cyclic, diagnostics: { console: false } })
    .prepareSubmission({ values: {}, repeatable: { rows: [{ id: 0, values: {} }] } });
  check(
    [failed.status, failed.snapshot, failed.issues[0].code],
    ['failed', null, 'record_dependency_cycle'],
    'record cycle failure'
  );
  return results;
}
