import assert from 'node:assert/strict';
import {
  createFormEngine,
  createRecordEvaluator,
  SAFE_SECURITY_CONFIG,
  WarningSystem,
} from '../src/index.js';
import {
  formSchema,
  numericField,
  calculatedField,
  textField,
  repeatableSection,
  commonInputAttributes,
} from './helpers/calculation-fixtures.js';

for (const security of [undefined, SAFE_SECURITY_CONFIG]) {
  const warnings = new WarningSystem({ enableConsoleWarnings: false });
  const schema = formSchema(
    [
      numericField('tax', { format: 'float' }),
      numericField('amount', { default_value: 100 }),
      calculatedField('total', '$amount * (1 + $tax)'),
      textField('note', {
        visible: false,
        visible_conditions: { field_id: 'total', operator: 'greater_than', value: 115 },
      }),
    ],
    {
      events: {
        code: `
    ON('load-record', function(event) {
      ALERT('Loaded', event.mode);
      if (event.mode === 'edit') SETVALUE('amount', 200);
    });
    ON('edit-record', function(event) { SETVALUE('note', event.mode); });
  `,
      },
    }
  );
  const input = { tax: 0.2, amount: 100, total: 110 };
  const engine = createFormEngine({
    schema,
    security,
    initialValues: input,
    mode: 'readonly',
    warningSystem: warnings,
    diagnostics: { console: false },
  });
  engine.eval();
  assert.equal(engine.getState().values.total, 110);
  assert.equal(engine.getState().visible.note, false);
  const detail = engine.triggerDetailed('load-record', undefined, { mode: 'edit' });
  assert.deepEqual(detail.issues, []);
  assert.equal(detail.operations.length, 1);
  assert.equal(detail.operations[0].params.message, 'readonly');
  assert.equal(
    engine.trigger('load-record', undefined, { mode: 'edit' })[0].params.message,
    'readonly'
  );
  assert.deepEqual(input, { tax: 0.2, amount: 100, total: 110 });
  engine.setMode('edit');
  engine.eval();
  assert.equal(engine.getState().values.total, 120);
  assert.equal(engine.getState().visible.note, true);
  assert.equal(engine.triggerDetailed('edit-record').operations[0].params.valueToSet, 'edit');
  // Switching to view preserves current unsaved work, including a selection after a failed save.
  engine.getState().values.total = 124;
  engine.setMode('readonly');
  engine.eval();
  assert.equal(engine.getState().values.total, 124);
  assert.deepEqual(engine.getDiagnostics(), []);
  assert.throws(() => engine.setMode('view'), /mode must/);
  const missing = createFormEngine({ schema, security, mode: 'readonly', warningSystem: warnings });
  missing.eval();
  assert.equal(missing.getState().values.amount, null);
  missing.setMode('edit');
  assert.equal(missing.getState().values.amount, 100);
  const choice = createFormEngine({
    security,
    mode: 'readonly',
    schema: formSchema([
      {
        ...commonInputAttributes,
        type: 'SingleChoiceField',
        key: 'color',
        data_name: 'color',
        label: 'Color',
        choices: [{ value: 'red', label: 'Red' }],
        allow_other: false,
        is_searchable: false,
        is_searchable_mode: null,
        default_value: 'red',
      },
    ]),
  });
  assert.deepEqual(choice.getState().values.color, { choice: [], other: [] });
  choice.setMode('edit');
  assert.equal(choice.getState().values.color.choice[0].value, 'red');

  for (const detailed of [true, false]) {
    const guarded = createFormEngine({
      mode: 'readonly',
      security,
      warningSystem: warnings,
      schema: formSchema([numericField('amount')], {
        events: {
          code: `
      ON('load-record', function(event) {
        event.mode = 'edit';
        ALERT('Must not appear');
        ON('edit-record', function() { ALERT('Must not register'); });
        SETVALUE('amount', 999);
      });
    `,
        },
      }),
    });
    const result = detailed
      ? guarded.triggerDetailed('load-record')
      : guarded.trigger('load-record');
    if (detailed) {
      assert.deepEqual(result.operations, []);
      assert.equal(result.issues[0].code, 'readonly_operation_not_allowed');
    } else assert.deepEqual(result, []);
    guarded.setMode('edit');
    assert.deepEqual(guarded.triggerDetailed('edit-record').operations, []);
    assert.equal(guarded.getState().values.amount, null);
  }

  for (const detailed of [true, false]) {
    const listeners = createFormEngine({
      security,
      mode: 'readonly',
      warningSystem: warnings,
      schema: formSchema([numericField('amount')], {
        events: {
          code: `
      ON('load-record', function() {
        ON('edit-record', function(event) { ALERT('Entered', event.mode); });
        OFF('load-record');
      });
    `,
        },
      }),
    });
    const trigger = (...args) =>
      detailed ? listeners.triggerDetailed(...args).operations : listeners.trigger(...args);
    assert.deepEqual(trigger('load-record'), []);
    listeners.setMode('edit');
    assert.equal(trigger('edit-record')[0].params.message, 'edit');
    assert.deepEqual(trigger('load-record'), []);
  }

  for (const type of ['UI_OPERATION', 'MEDIA_OPERATION']) {
    const unknown = createFormEngine({
      schema: formSchema([], {
        events: { code: "ON('load-record', function() { return futureOperation(); });" },
      }),
      mode: 'readonly',
      security,
      warningSystem: warnings,
      helpers: { futureOperation: () => ({ type, operation: 'UNDECLARED', params: {} }) },
    });
    assert.equal(unknown.triggerDetailed('load-record').issues[0].code, 'invalid_operation');
    assert.deepEqual(unknown.trigger('load-record'), []);
  }

  const collectionSchema = formSchema(
    [
      numericField('tax', { format: 'float' }),
      calculatedField('grand', "REPEATABLESUM($lines, 'total')"),
      repeatableSection('lines', [
        numericField('amount'),
        calculatedField('total', '$amount * (1 + $tax)'),
      ]),
    ],
    {
      events: {
        code: "ON('validate-repeatable', 'lines', function(event) { if (event.mode !== 'readonly') INVALID('Expected read-only validation execution'); });",
      },
    }
  );
  const snapshot = {
    values: { tax: 0.2, grand: 330 },
    repeatable: {
      lines: [
        { id: 0, values: { amount: 100, total: 110 }, media: { keep: true } },
        { id: 1, values: { amount: 200, total: 220 } },
      ],
    },
  };
  const before = structuredClone(snapshot);
  const evaluator = createRecordEvaluator({
    schema: collectionSchema,
    security,
    diagnostics: { console: false },
  });
  const root = await evaluator.evaluateScope(snapshot, { interactionMode: 'readonly' });
  assert.equal(root.state.values.grand, 330);
  assert.deepEqual(root.changes, []);
  const path = [{ repeatableKey: 'lines', instanceId: 0, index: 0, identity: 'id' }];
  const view = await evaluator.evaluateScope(snapshot, {
    instancePath: path,
    interactionMode: 'readonly',
  });
  assert.equal(view.state.values.total, 110);
  const edit = await evaluator.evaluateScope(snapshot, { instancePath: path });
  assert.equal(edit.state.values.total, 120);
  assert.equal(
    (await evaluator.evaluateScope(snapshot, { interactionMode: 'bad' })).status,
    'failed'
  );
  const prepared = await evaluator.prepareSubmission(snapshot, { managedEvents: true });
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.snapshot.values.grand, 360);
  assert.deepEqual(snapshot, before);
}

console.log('Accepted-view and event-mode core checks passed (TRUSTED/SAFE).');
