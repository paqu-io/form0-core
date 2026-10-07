import assert from 'node:assert/strict';
import { createFormEngine, WarningSystem } from '../src/index.js';
import { formSchema, numericField, textField } from './helpers/calculation-fixtures.js';

const fields = [numericField('input', { default_value: 1 }), textField('note')];
const setNote = (value) => ({
  type: 'FIELD_OPERATION',
  operation: 'SETVALUE',
  params: { fieldDataName: 'note', valueToSet: value },
});
const alert = (title, message = '') => ({
  type: 'UI_OPERATION',
  operation: 'ALERT',
  params: { title, message },
});

function engineFor(code, options = {}) {
  return createFormEngine({
    schema: formSchema(fields, { events: { code } }),
    ...options,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushAsyncWork() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

function warningHarness(enableConsoleWarnings = false) {
  const warningSystem = new WarningSystem({
    enableCollection: true,
    enableConsoleWarnings,
    throttleMs: 0,
  });
  const warnings = [];
  warningSystem.addWarningHandler((warning) => warnings.push(warning));
  return { warningSystem, warnings };
}

// Synchronous ordering, partial operations, wildcard handlers, ignored in-handler ON/OFF,
// returned UI operations, and metadata remain unchanged.
{
  const engine = engineFor(`
    ON('change', 'input', function named(event) {
      SETVALUE('note', 'first:' + event.value);
      ON('change', 'note', function () { SETVALUE('note', 'unexpected'); });
      OFF('change', 'input');
      throw new Error('stop after first operation');
    });
    ON('change', function () { ALERT('wildcard'); });
  `);
  assert.deepEqual(engine.trigger('change', 'input', { value: 7, source: 'test' }), [
    setNote('first:7'),
    alert('wildcard'),
  ]);
  assert.deepEqual(engine.trigger('change', 'note'), [alert('wildcard')]);
  assert.equal(engine.getState().values.note, null, 'The host still owns operation application');
  assert.deepEqual(engine.getDiagnostics(), [], 'Events remain separate from calculations');
}

// Only operations before the first await are returned; late work cannot enter a later dispatch.
{
  const gate = deferred();
  const { warningSystem, warnings } = warningHarness();
  const engine = engineFor(
    `ON('change', 'input', async function delayed() {
      SETVALUE('note', 'before');
      await pause();
      SETVALUE('note', 'after-secret-value');
    });`,
    { helpers: { pause: () => gate.promise }, warningSystem }
  );

  assert.deepEqual(engine.trigger('change', 'input'), [setNote('before')]);
  gate.resolve();
  await flushAsyncWork();
  assert.deepEqual(engine.trigger('change', 'note'), []);
  assert.deepEqual(
    warnings.map((warning) => warning.reason),
    ['async_handler_unsupported', 'late_event_operation_discarded']
  );
  assert.equal(JSON.stringify(warnings).includes('after-secret-value'), false);
}

// A late operation from one engine cannot cross into another engine.
{
  const gate = deferred();
  const first = engineFor(
    `ON('change', 'input', async function firstHandler() {
      await pause();
      SETVALUE('note', 'cross-engine-secret');
    });`,
    {
      helpers: { pause: () => gate.promise },
      warningSystem: warningHarness().warningSystem,
    }
  );
  const second = engineFor(
    `ON('change', 'input', function secondHandler() { SETVALUE('note', 'second'); });`
  );
  assert.deepEqual(first.trigger('change', 'input'), []);
  gate.resolve();
  await flushAsyncWork();
  assert.deepEqual(second.trigger('change', 'input'), [setNote('second')]);
}

// Rejected promises, transpiled-style thenables, and throwing then accessors are contained.
{
  const { warningSystem, warnings } = warningHarness();
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const rejected = engineFor(
      `ON('change', 'input', async function rejectedHandler() {
        await Promise.resolve();
        throw new Error('private rejection detail');
      });`,
      { warningSystem }
    );
    const thenable = engineFor(
      `ON('change', 'input', function transpiledHandler() { return makeThenable(); });`,
      {
        warningSystem,
        helpers: {
          makeThenable: () => ({ then: (_resolve, reject) => reject(new Error('transpiled')) }),
        },
      }
    );
    const accessor = engineFor(
      `ON('change', 'input', function accessorHandler() { return brokenThen(); });`,
      {
        warningSystem,
        helpers: {
          brokenThen: () =>
            Object.create(null, {
              then: {
                get: () => {
                  throw new Error('accessor detail');
                },
              },
            }),
        },
      }
    );

    assert.deepEqual(rejected.trigger('change', 'input'), []);
    assert.deepEqual(thenable.trigger('change', 'input'), []);
    assert.deepEqual(accessor.trigger('change', 'input'), []);
    await flushAsyncWork();
    assert.deepEqual(unhandled, []);
    assert.ok(warnings.some((warning) => warning.reason === 'async_handler_unsupported'));
    assert.ok(warnings.some((warning) => warning.reason === 'async_handler_rejected'));
    const serialized = JSON.stringify(warnings);
    assert.equal(serialized.includes('private rejection detail'), false);
    assert.equal(serialized.includes('accessor detail'), false);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
}

// Nested dispatch restores the enclosing operation scope.
{
  const inner = engineFor(
    `ON('change', 'input', function innerHandler() { SETVALUE('note', 'inner'); });`
  );
  const nestedOperations = [];
  const outer = engineFor(
    `ON('change', 'input', function outerHandler() {
      SETVALUE('note', 'outer-before');
      dispatchInner();
      SETVALUE('note', 'outer-after');
    });`,
    {
      helpers: {
        dispatchInner: () => nestedOperations.push(...inner.trigger('change', 'input')),
      },
    }
  );
  assert.deepEqual(outer.trigger('change', 'input'), [
    setNote('outer-before'),
    setNote('outer-after'),
  ]);
  assert.deepEqual(nestedOperations, [setNote('inner')]);
}

// Every canonical event builtin stays bound to the scope where it originated.
{
  const gate = deferred();
  const { warningSystem, warnings } = warningHarness();
  const engine = engineFor(
    `ON('change', 'input', async function lateBuiltins() {
      await pause();
      SETVALUE('note', 'discard-me');
      ALERT('discard-me');
      ON('change', 'note', function unexpected() {});
      OFF('change', 'input');
    });`,
    { helpers: { pause: () => gate.promise }, warningSystem }
  );
  engine.trigger('change', 'input');
  gate.resolve();
  await flushAsyncWork();
  assert.deepEqual(engine.trigger('change', 'note'), []);
  assert.deepEqual(
    warnings
      .filter((warning) => warning.reason === 'late_event_operation_discarded')
      .map((warning) => warning.fieldContext.operationName),
    ['SETVALUE', 'ALERT', 'ON', 'OFF']
  );
  assert.equal(JSON.stringify(warnings).includes('discard-me'), false);
}

// Warning handlers and collection work with console output disabled.
{
  const { warningSystem, warnings } = warningHarness(false);
  let isolatedHandlerCalls = 0;
  warningSystem.addWarningHandler(() => {
    throw new Error('observer failure');
  });
  warningSystem.addWarningHandler(() => isolatedHandlerCalls++);
  const engine = engineFor(
    `ON('change', 'input', function namedThenable() { return Promise.resolve(); });`,
    { warningSystem }
  );
  engine.trigger('change', 'input');
  await flushAsyncWork();
  assert.equal(warnings[0].fieldContext.handlerName, 'namedThenable');
  assert.equal(warnings[0].executionContext.eventType, 'change');
  assert.equal(warningSystem.getCollectedWarnings().length, warnings.length);
  assert.equal(isolatedHandlerCalls, warnings.length, 'A failing warning handler is isolated');
}

// Console reporting follows WarningSystem.enableConsoleWarnings.
{
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const calls = [];
  console.warn = (...args) => calls.push(['warn', ...args]);
  console.info = (...args) => calls.push(['info', ...args]);
  try {
    const silent = warningHarness(false).warningSystem;
    engineFor(`ON('change', 'input', function () { return Promise.resolve(); });`, {
      warningSystem: silent,
    }).trigger('change', 'input');
    await flushAsyncWork();
    assert.equal(calls.length, 0);

    const visible = warningHarness(true).warningSystem;
    engineFor(`ON('change', 'input', function () { return Promise.resolve(); });`, {
      warningSystem: visible,
    }).trigger('change', 'input');
    await flushAsyncWork();
    assert.ok(calls.some((call) => call[0] === 'warn' && /<anonymous>/.test(call.join(' '))));
  } finally {
    console.warn = originalWarn;
    console.info = originalInfo;
  }
}

// Intentional helper overrides keep their existing behavior.
{
  const calls = [];
  const engine = engineFor(
    `ON('change', 'input', function overrideHandler() { SETVALUE('note', 'host-owned'); });`,
    { helpers: { SETVALUE: (...args) => calls.push(args) } }
  );
  assert.deepEqual(engine.trigger('change', 'input'), []);
  assert.deepEqual(calls, [['note', 'host-owned']]);
}

console.log('Event async isolation tests passed.');
