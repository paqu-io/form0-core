import assert from 'node:assert/strict';
import { createFormEngine, SAFE_SECURITY_CONFIG } from '../src/index.js';
import {
  numericField,
  textField,
  calculatedField,
  repeatableSection,
  formSchema,
  captureConsole,
} from './helpers/calculation-fixtures.js';

const setNote = (value) => ({
  type: 'FIELD_OPERATION',
  operation: 'SETVALUE',
  params: { fieldDataName: 'note', valueToSet: value },
});
const elements = [numericField('input', { default_value: 1 }), textField('note')];
const engineFor = (code, options = {}) =>
  createFormEngine({ schema: formSchema(elements, { events: { code } }), ...options });

captureConsole(() => {
  const sources = [
    "ON('change', 'input', function (event) { SETVALUE('note', String($input)); });",
    "function onInput(event) { SETVALUE('note', String($input)); } ON('change', 'input', onInput);",
    "ON('change', 'input', onInput); function onInput(event) { SETVALUE('note', String($input)); }",
    "\nconst onInput = event => { SETVALUE('note', String($input)); };\nON('change', 'input', onInput);",
    "ON('change', 'input', event => SETVALUE('note', String($input)))",
    "const handler = function (event) { SETVALUE('note', String($input)); }; const alias = handler; ON('change', 'input', alias);",
    "ON('change', 'input', function (event) { SETVALUE('note', `value:${$input}`); });",
    "ON('change', 'input', function (event) { const p = /[{}()]/; /* } ) function */ SETVALUE('note', p.test('{}') ? String($input) : 'bad'); });",
  ];
  for (const source of sources) {
    const engine = engineFor(source);
    engine.eval();
    for (const value of [9, 11]) {
      engine.getState().values.input = value;
      engine.eval();
      const expected = source.includes('`value:') ? `value:${value}` : String(value);
      assert.deepEqual(engine.trigger('change', 'input'), [setNote(expected)]);
      assert.equal(engine.getState().values.note, null, 'The host applies operations');
      assert.deepEqual(engine.getState().errors, {});
    }
  }
});

captureConsole(() => {
  let initialized = 0;
  let calculated = 0;
  const engine = createFormEngine({
    schema: formSchema([...elements, calculatedField('double', 'observe($input * 2)')], {
      events: {
        code: `
            initialize();
            ON('change', 'input', function (event) {
              SETVALUE('note', String($double) + ':' + event.value + ':' + EVAL('$input'));
            });
          `,
      },
    }),
    helpers: { initialize: () => initialized++, observe: (value) => (calculated++, value) },
  });
  engine.eval();
  engine.getState().values.input = 9;
  engine.eval();
  const callsBeforeTrigger = calculated;
  assert.deepEqual(engine.trigger('change', 'input', { value: 9 }), [setNote('18:9:9')]);
  assert.deepEqual(engine.trigger('change', 'input', { value: 9 }), [setNote('18:9:9')]);
  assert.equal(initialized, 1);
  assert.equal(calculated, callsBeforeTrigger, 'Dispatch does not run calculations');
});

captureConsole(() => {
  const engine = engineFor(`
    function handler() { SETVALUE('note', 'specific'); }
    ON('change', 'input', handler);
    ON('change', 'input', handler);
    OFF('change', 'input', handler);
    ON('change', function () { SETVALUE('note', 'wildcard'); });
  `);
  assert.deepEqual(engine.trigger('change', 'input'), [setNote('specific'), setNote('wildcard')]);
});

captureConsole(() => {
  const engine = engineFor(`
    ON('change', 'input', function () {
      ON('change', 'note', function () { SETVALUE('note', 'nested'); });
      OFF('change', 'input');
      SETVALUE('note', 'kept');
    });
  `);
  assert.deepEqual(engine.trigger('change', 'input'), [setNote('kept')]);
  assert.deepEqual(engine.trigger('change', 'input'), [setNote('kept')]);
  assert.deepEqual(engine.trigger('change', 'note'), []);
});

const failure = captureConsole(() => {
  const engine = engineFor(`
    ON('change', 'input', function () { SETVALUE('note', 'partial'); throw new SyntaxError('stop'); });
    ON('change', 'input', function () { SETVALUE('note', 'continued'); });
  `);
  assert.deepEqual(engine.trigger('change', 'input'), [setNote('partial'), setNote('continued')]);
});
assert.equal(failure.calls.filter(({ method }) => method === 'warn').length, 1);
assert.match(failure.calls.find(({ method }) => method === 'warn').args.join(' '), /stop/);

const closure = captureConsole(() => {
  const engine = engineFor(`
    const prefix = 'prefix:';
    ON('change', 'input', function () { SETVALUE('note', prefix + $input); });
  `);
  assert.deepEqual(engine.trigger('change', 'input'), []);
});
assert.match(closure.calls.find(({ method }) => method === 'warn').args.join(' '), /prefix/);

const singleLine = captureConsole(() => {
  const engine = engineFor(
    "const handler = event => SETVALUE('note', 'value'); ON('change', 'input', handler);"
  );
  assert.deepEqual(engine.trigger('change', 'input'), []);
});
assert.match(singleLine.calls.find(({ method }) => method === 'warn').args.join(' '), /const/);

captureConsole(() => {
  const engine = engineFor("ON('change', 'input', hostCallback);", {
    helpers: { hostCallback: new Function("SETVALUE('note', String($input));") },
  });
  engine.getState().values.input = 8;
  assert.deepEqual(engine.trigger('change', 'input'), [setNote('8')]);
});

captureConsole(() => {
  const engine = engineFor(
    "ON('change', 'input', function () { return ALERT('Title', 'Message'); });"
  );
  assert.deepEqual(engine.trigger('change', 'input'), [
    { type: 'UI_OPERATION', operation: 'ALERT', params: { title: 'Title', message: 'Message' } },
  ]);
});

const security = captureConsole(() => {
  const engine = engineFor(
    "ON('change', 'input', function () { SETVALUE('note', process.version); });",
    {
      security: SAFE_SECURITY_CONFIG,
    }
  );
  assert.deepEqual(engine.trigger('change', 'input'), []);
});
assert.match(
  security.calls.find(({ method }) => method === 'warn').args.join(' '),
  /validation failed/
);

const scope = captureConsole(() => {
  const engine = createFormEngine({
    schema: formSchema([...elements, repeatableSection('rows', [textField('child')])], {
      events: {
        code: "ON('change', 'input', function () { SETVALUE('child', 'blocked'); SETVALUE('note', 'allowed'); });",
      },
    }),
  });
  assert.deepEqual(engine.trigger('change', 'input'), [setNote('allowed')]);
});
assert.equal(scope.calls.filter(({ method }) => method === 'warn').length, 2);

console.log('Event compatibility characterization tests passed.');
