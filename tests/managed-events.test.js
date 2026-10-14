import assert from 'node:assert/strict';
import {
  createFormEngine,
  INVALID,
  getFormEventBuiltinCatalog,
  analyzeFormEventCode,
  SAFE_SECURITY_CONFIG,
  WarningSystem,
} from '../src/index.js';
import { validateExpression } from '../src/security/validation.js';
import { formSchema, numericField, repeatableSection } from './helpers/calculation-fixtures.js';

// Custom findings belong to the attempted validation, never intrinsic field errors or values.
{
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: {
        code: `ON('validate-record', function(event) {
        if ($amount < 4) INVALID(event.isDraft ? 'Draft needs review' : 'Amount must reach four');
      });`,
      },
    }),
    initialValues: { amount: 0 },
    diagnostics: { console: false },
  });
  engine.eval();
  const first = engine.triggerDetailed('validate-record', undefined, {
    isDraft: false,
    isValid: true,
  });
  assert.deepEqual(first.operations, []);
  assert.deepEqual(first.issues, []);
  assert.deepEqual(first.validationIssues, [
    { message: 'Amount must reach four', instancePath: [] },
  ]);
  first.validationIssues[0].instancePath.push({ invalid: true });
  assert.deepEqual(engine.triggerDetailed('validate-record').validationIssues[0].instancePath, []);
  assert.deepEqual(engine.getState().errors, {});
  assert.deepEqual(engine.getDiagnostics(), []);
  assert.equal(engine.getState().values.amount, 0);
  engine.getState().values.amount = 4;
  assert.deepEqual(engine.triggerDetailed('validate-record').validationIssues, []);
}

// The dispatcher owns identity. Nested rows may read main/ancestor fields, but only write locally.
{
  const path = [{ repeatableKey: 'rows-key', instanceId: 'row-a', index: 0, identity: 'id' }];
  const schema = formSchema(
    [
      numericField('main'),
      {
        ...repeatableSection('rows', [
          numericField('amount'),
          repeatableSection('children', [numericField('quantity')]),
        ]),
        key: 'rows-key',
      },
      repeatableSection('other', [numericField('unrelated')]),
    ],
    {
      events: {
        code: `
    ON('change', 'amount', function(event) { SETVALUE('amount', $amount + $main); });
    ON('save-repeatable', 'rows', function() { SETVALUE('main', 99); });
    ON('edit-repeatable', 'rows', function() { SETVALUE('amount', $quantity); });
    ON('new-repeatable', 'rows', function() { SETVALUE('amount', EVAL('$unrelated')); });
    ON('cancel-repeatable', 'rows', function() { if (typeof $quantity === 'undefined') {} });
    ON('load-record', function() { SETVALUE('main', 100); });
    ON('validate-repeatable', 'rows', function(event) { INVALID(event.type + ':' + event.instancePath[0].instanceId); });
  `,
      },
    }
  );
  const row = createFormEngine({
    schema,
    initialValues: { main: 4, amount: 2, quantity: 8, unrelated: 30 },
    eventScope: { instancePath: path },
  });
  path[0].instanceId = 'mutated';
  assert.equal(row.triggerDetailed('change', 'amount').operations[0].params.valueToSet, 6);
  assert.equal(
    row.triggerDetailed('save-repeatable', 'rows').issues[0].code,
    'write_scope_restricted'
  );
  assert.equal(row.triggerDetailed('edit-repeatable', 'rows').operations.length, 0);
  assert.equal(row.triggerDetailed('new-repeatable', 'rows').operations.length, 0);
  assert.equal(
    row.triggerDetailed('cancel-repeatable', 'rows').issues[0].code,
    'read_scope_restricted'
  );
  assert.equal(row.triggerDetailed('load-record').issues[0].code, 'invalid_routing_context');
  assert.equal(row.triggerDetailed('change', 'quantity').issues[0].code, 'invalid_routing_context');
  const validation = row.triggerDetailed('validate-repeatable', 'rows', {
    type: 'save-record',
    fieldKey: 'main',
    instancePath: [],
  });
  assert.equal(validation.validationIssues[0].message, 'validate-repeatable:row-a');
  const root = createFormEngine({ schema });
  assert.equal(root.triggerDetailed('change', 'amount').issues[0].code, 'invalid_routing_context');
  assert.equal(
    root.triggerDetailed('save-repeatable', 'rows').issues[0].code,
    'invalid_routing_context'
  );
  // Detailed ownership must not tighten the compatibility operation-array interface.
  assert.equal(row.trigger('save-repeatable', 'rows')[0].params.fieldDataName, 'main');

  const child = createFormEngine({
    schema: formSchema(schema.form.elements, {
      events: {
        code: `
    ON('load-repeatable', 'children', function() { SETVALUE('quantity', $quantity + $amount + $main); });
    ON('save-repeatable', 'children', function() { SETVALUE('amount', 99); });
  `,
      },
    }),
    initialValues: { quantity: 1, amount: 2, main: 4 },
    eventScope: {
      instancePath: [
        { ...path[0], instanceId: 'row-a' },
        { repeatableKey: 'children', instanceId: null, index: 1, identity: 'position' },
      ],
    },
  });
  assert.equal(
    child.triggerDetailed('load-repeatable', 'children').operations[0].params.valueToSet,
    7
  );
  assert.equal(
    child.triggerDetailed('save-repeatable', 'children').issues[0].code,
    'write_scope_restricted'
  );
  assert.throws(
    () =>
      createFormEngine({
        schema,
        eventScope: {
          instancePath: [
            { repeatableKey: 'children', instanceId: 'child', index: 0, identity: 'id' },
          ],
        },
      }),
    /complete repeatable ancestry/
  );
}

// Invalid arguments, forbidden operations and asynchronous handlers fail without a partial batch.
for (const [code, type, expected] of [
  ["INVALID('')", 'validate-record', 'handler_failed'],
  ['INVALID(7)', 'validate-record', 'handler_failed'],
  ["INVALID('not validation')", 'change', 'invalid_context'],
  ["ALERT('stop')", 'validate-record', 'operation_not_allowed'],
  ["SETVALUE('amount', 7)", 'validate-record', 'operation_not_allowed'],
  ["ALERT('closed')", 'unload-record', 'operation_not_allowed'],
  ["INVALID('closed')", 'cancel-record', 'invalid_context'],
  ["SETVALUE('amount', 8); throw new Error('failed')", 'save-record', 'handler_failed'],
]) {
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: {
        code: `ON('${type}', ${type === 'change' ? "'amount', " : ''}function() { ${code}; });`,
      },
    }),
  });
  const result = engine.triggerDetailed(type, type === 'change' ? 'amount' : undefined);
  assert.equal(result.issues[0].code, expected, code);
  assert.deepEqual(result.operations, []);
}

{
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: {
        code: `ON('save-record', async function() { SETVALUE('amount', 1); await wait(); SETVALUE('amount', 99); throw new Error('late'); });`,
      },
    }),
    helpers: { wait: () => waiting },
  });
  const result = engine.triggerDetailed('save-record');
  assert.equal(result.issues[0].code, 'async_handler_unsupported');
  assert.deepEqual(result.operations, []);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.getState().values.amount, null);
  assert.deepEqual(engine.triggerDetailed('edit-record').operations, []);
}

// A pure notification/validation never evaluates or exposes mutable engine-owned objects.
{
  let evaluations = 0;
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: {
        code: `ON('save-record', function() { SETVALUE('amount', { nested: [1] }); });`,
      },
    }),
    onDiagnostics: () => {
      evaluations += 1;
    },
  });
  engine.eval();
  const result = engine.triggerDetailed('save-record');
  result.operations[0].params.valueToSet.nested[0] = 99;
  assert.equal(engine.triggerDetailed('save-record').operations[0].params.valueToSet.nested[0], 1);
  engine.triggerDetailed('validate-record');
  engine.triggerDetailed('unload-record');
  assert.equal(evaluations, 1);
  for (const type of ['unknown-event', '__proto__', 'toString'])
    assert.equal(engine.triggerDetailed(type).issues[0].code, 'invalid_request');
  assert.equal(engine.triggerDetailed(() => {}).issues[0].eventType, null);
}

{
  const schema = formSchema([numericField('amount')]);
  assert.throws(() => INVALID('outside'), /event scope/);
  const example = "ON('validate-record', function() { INVALID('Review'); });";
  assert.equal(analyzeFormEventCode({ schema, code: example }).valid, true);
  assert.ok(getFormEventBuiltinCatalog().some((entry) => entry.name === 'INVALID'));
  assert.equal(validateExpression("INVALID('Review')", SAFE_SECURITY_CONFIG, false).valid, false);
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], { events: { code: example } }),
    security: SAFE_SECURITY_CONFIG,
  });
  assert.equal(engine.triggerDetailed('validate-record').validationIssues[0].message, 'Review');
  const malformed = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: { code: "ON('save-record', function() { NOT_A_BUILTIN(); });" },
    }),
  });
  assert.equal(malformed.triggerDetailed('save-record').issues[0].code, 'initialization_failed');
}

// Every observer result is defensive; event metadata cannot mutate values or later handlers.
{
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: {
        code: `
      ON('save-record', function(event) { event.notes.push('changed'); $amount.nested.push(99); });
      ON('save-record', function(event) { SETVALUE('amount', { notes: event.notes, original: $amount.nested, scope: event.scopeId }); });
    `,
      },
    }),
    initialValues: { amount: { nested: [1] } },
    eventScope: { instancePath: [], scopeId: 'root-session' },
  });
  const metadata = { notes: ['original'], scopeId: 'spoofed' };
  const result = engine.triggerDetailed('save-record', undefined, metadata);
  assert.deepEqual(result.operations[0].params.valueToSet, {
    notes: ['original'],
    original: [1],
    scope: 'root-session',
  });
  assert.deepEqual(metadata.notes, ['original']);
  assert.deepEqual(engine.getState().values.amount, { nested: [1] });
  assert.equal(
    engine.triggerDetailed('save-record', undefined, { bad: () => {} }).issues[0].code,
    'invalid_request'
  );
  assert.equal(
    engine.triggerDetailed('save-record', undefined, { bad: new Map() }).issues[0].code,
    'invalid_request'
  );
}

{
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: { code: "ON('save-record', function() { return returned(); });" },
    }),
    helpers: {
      returned: () =>
        Object.defineProperty({}, 'then', {
          get() {
            throw new Error('bad then accessor');
          },
        }),
    },
  });
  assert.equal(engine.triggerDetailed('save-record').issues[0].code, 'handler_failed');
}

{
  const warnings = new WarningSystem({ enableConsoleWarnings: false });
  warnings.addWarningHandler(() => {
    throw new Error('observer');
  });
  warnings.addWarningHandler(async () => {
    throw new Error('rejected observer');
  });
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      events: {
        code: "ON('save-record', async function() { await wait(); SETVALUE('amount', 99); });",
      },
    }),
    helpers: { wait: () => pending },
    warningSystem: warnings,
  });
  const result = engine.triggerDetailed('save-record');
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.issues[0].code, 'async_handler_unsupported');
  assert.deepEqual(result.operations, []);
  assert.deepEqual(engine.triggerDetailed('edit-record').issues, []);
}

// Managed dispatch uses retained authored source, including on engines with opaque functions.
{
  const original = Function.prototype.toString;
  Function.prototype.toString = function () {
    return 'function () { [bytecode] }';
  };
  try {
    const engine = createFormEngine({
      schema: formSchema([numericField('amount', { min: 4 })], {
        events: { code: "ON('validate-record', () => INVALID('Custom review'));" },
      }),
      initialValues: { amount: 0 },
    });
    engine.eval();
    const before = JSON.parse(JSON.stringify(engine.getState()));
    assert.ok(Object.keys(before.errors).length);
    assert.equal(
      engine.triggerDetailed('validate-record').validationIssues[0].message,
      'Custom review'
    );
    assert.deepEqual(engine.getState(), before);
  } finally {
    Function.prototype.toString = original;
  }
}

{
  const status = {
    type: 'StatusField',
    key: '@status',
    data_name: 'status',
    label: 'Status',
    display: 'default',
    enabled: true,
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    default_value: 'pending',
    choices: [{ label: 'Pending', value: 'pending', color: '#FFA500' }],
  };
  const engine = createFormEngine({
    schema: formSchema([numericField('amount')], {
      status_field: status,
      events: {
        code: "ON('change-status', 'status', function() { SETVALUE('amount', $status === 'pending' ? 4 : 8); });",
      },
    }),
    initialValues: { status: 'pending' },
  });
  assert.equal(
    engine.triggerDetailed('change-status', 'status').operations[0].params.valueToSet,
    4
  );
  assert.equal(
    engine.triggerDetailed('change-status', 'amount').issues[0].code,
    'invalid_routing_context'
  );
}

// Existing numeric row IDs, including zero, retain the diagnostics path contract.
{
  const engine = createFormEngine({
    schema: formSchema([repeatableSection('rows', [numericField('amount')])], {
      events: { code: "ON('validate-repeatable', 'rows', function() { INVALID('Review'); });" },
    }),
    eventScope: {
      instancePath: [{ repeatableKey: 'rows', instanceId: 0, index: 0, identity: 'id' }],
    },
  });
  assert.equal(
    engine.triggerDetailed('validate-repeatable', 'rows').validationIssues[0].instancePath[0]
      .instanceId,
    0
  );
}

// Scope checks distinguish actual field references from strings, property names and local variables.
{
  const engine = createFormEngine({
    schema: formSchema(
      [numericField('amount'), repeatableSection('rows', [numericField('quantity')])],
      {
        events: {
          code: `ON('save-record', function() {
      const object = { $quantity: 7 }; let $quantity = object.$quantity;
      for (let $local of [2]) { $quantity += $local; }
      function add($parameter) { return $quantity + $parameter; }
      $label: { if ($quantity > 0) break $label; }
      ALERT('Literal $quantity is not a reference');
      SETVALUE('amount', add(1));
    });`,
        },
      }
    ),
  });
  const result = engine.triggerDetailed('save-record');
  assert.deepEqual(result.issues, []);
  assert.equal(result.operations[1].params.valueToSet, 10);
}

// Media-bearing forms retain native binary data through managed validation and defensive operations.
{
  const file = new File(['image bytes'], 'image.jpg', { type: 'image/jpeg', lastModified: 1234 });
  const photo = {
    type: 'PhotoField',
    key: 'photo',
    data_name: 'photo',
    label: 'photo',
    display: 'default',
    description: null,
    description_mode: null,
    required: false,
    required_conditions: null,
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    default_value: null,
    min_length: null,
    max_length: null,
  };
  const original = [{ photo_id: 'media-A', media_id: 'media-A', url: 'blob:image', file }];
  const engine = createFormEngine({
    schema: formSchema([photo], {
      events: {
        code: `
      ON('validate-record', function() { if ($photo[0].file.name !== 'image.jpg') INVALID('Wrong file.'); });
      ON('save-record', function() { SETVALUE('photo', $photo); });
    `,
      },
    }),
    initialValues: { photo: original },
    diagnostics: { console: false },
  });
  engine.eval();
  const validation = engine.triggerDetailed('validate-record');
  assert.deepEqual(validation.issues, []);
  assert.deepEqual(validation.validationIssues, []);
  const operation = engine.triggerDetailed('save-record').operations[0];
  const copied = operation.params.valueToSet[0].file;
  assert.notEqual(copied, file);
  assert.equal(copied.name, 'image.jpg');
  assert.equal(copied.lastModified, 1234);
  assert.equal(copied.type, 'image/jpeg');
  assert.equal(await copied.text(), 'image bytes');
  copied.extra = 'observer-owned';
  assert.equal(file.extra, undefined);
  assert.equal(engine.getState().values.photo[0].file, file);
  assert.equal(engine.getState().values.photo[0].media_id, 'media-A');
  const blob = new Blob(['opaque bytes'], { type: 'application/octet-stream' });
  const detail = engine.triggerDetailed('load-record', undefined, { blob });
  assert.deepEqual(detail.issues, []);
}

console.log('Managed event tests passed.');
