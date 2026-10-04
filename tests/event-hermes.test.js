import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFormEngine, SAFE_SECURITY_CONFIG, validateSchema } from '../src/index.js';
import {
  numericField,
  textField,
  calculatedField,
  repeatableSection,
  formSchema,
  captureConsole,
} from './helpers/calculation-fixtures.js';

function withOpaqueFunctions(run) {
  const original = Function.prototype.toString;
  Function.prototype.toString = function () {
    return 'function () { [bytecode] }';
  };
  try {
    return run();
  } finally {
    Function.prototype.toString = original;
  }
}

const setNote = (value) => ({
  type: 'FIELD_OPERATION',
  operation: 'SETVALUE',
  params: { fieldDataName: 'note', valueToSet: value },
});
const schemaFor = (code) =>
  formSchema([numericField('input', { default_value: 1 }), textField('note')], {
    events: { code },
  });

captureConsole(() =>
  withOpaqueFunctions(() => {
    const engine = createFormEngine({
      schema: formSchema([numericField('input', { default_value: 1 }), textField('note')], {
        events: {
          code: "ON('change', 'input', function (event) { SETVALUE('note', String($input)); });",
        },
      }),
    });
    engine.getState().values.input = 9;
    assert.deepEqual(engine.trigger('change', 'input'), [
      {
        type: 'FIELD_OPERATION',
        operation: 'SETVALUE',
        params: { fieldDataName: 'note', valueToSet: '9' },
      },
    ]);
  })
);

captureConsole(() =>
  withOpaqueFunctions(() => {
    const engine = createFormEngine({
      schema: formSchema([numericField('input', { default_value: 1 }), textField('note')], {
        events: {
          code: "ON('change', 'input', onChange); function onChange(event) { SETVALUE('note', String($input)); }",
        },
      }),
    });
    engine.getState().values.input = 11;
    assert.deepEqual(engine.trigger('change', 'input'), [
      {
        type: 'FIELD_OPERATION',
        operation: 'SETVALUE',
        params: { fieldDataName: 'note', valueToSet: '11' },
      },
    ]);
  })
);

captureConsole(() =>
  withOpaqueFunctions(() => {
    const sources = [
      "event => {}; function h(event) { SETVALUE('note', String($input)); } ON('change', 'input', h);",
      "'use strict'; { ON('change', 'input', h); function h(event) { SETVALUE('note', String($input)); } }",
      "\nconst h = event => SETVALUE('note', String($input));\nconst alias = h; ON('change', 'input', alias);",
      "function factory() { function h(event) { SETVALUE('note', String($input)); } return h; } ON('change', 'input', factory());",
      "ON('change', 'input', function (event) { const r = /[{}()]/; /* } ) */ SETVALUE('note', r.test('{}') ? `${$input}` : 'bad'); });",
      "let __form0CaptureEventSource = 'authored'; ON('change', 'input', function () { SETVALUE('note', String($input)); });",
    ];
    for (const code of sources) {
      const engine = createFormEngine({ schema: schemaFor(code) });
      for (const value of [9, 11]) {
        engine.getState().values.input = value;
        assert.deepEqual(engine.trigger('change', 'input'), [setNote(String(value))], code);
      }
    }
  })
);

captureConsole(() =>
  withOpaqueFunctions(() => {
    for (const declaration of [
      "const h = event => SETVALUE('note', String($input));",
      "let h; h = event => SETVALUE('note', String($input));",
      "const object = { h: event => SETVALUE('note', String($input)) }; const h = object.h;",
      "class Handlers { static h = event => SETVALUE('note', String($input)); } const h = Handlers.h;",
    ]) {
      const names = [];
      const engine = createFormEngine({
        schema: schemaFor(`\n${declaration}\nobserveName(h.name); ON('change', 'input', h);`),
        helpers: { observeName: (name) => names.push(name) },
      });
      assert.deepEqual(names, ['h'], declaration);
      assert.deepEqual(engine.trigger('change', 'input'), [setNote('1')], declaration);
    }
  })
);

captureConsole(() =>
  withOpaqueFunctions(() => {
    let coercions = 0;
    const names = [];
    const engine = createFormEngine({
      schema: schemaFor(`
      const object = { [makeKey()]: event => SETVALUE('note', String($input)) };
      observeName(object.h.name); ON('change', 'input', object.h);
    `),
      helpers: {
        makeKey: () => ({ [Symbol.toPrimitive]: () => (coercions++, 'h') }),
        observeName: (name) => names.push(name),
      },
    });
    assert.equal(coercions, 1, 'Computed keys are coerced only once');
    assert.deepEqual(names, ['h']);
    assert.deepEqual(engine.trigger('change', 'input'), [setNote('1')]);
  })
);

captureConsole(() =>
  withOpaqueFunctions(() => {
    const engine = createFormEngine({
      schema: schemaFor(String.raw`
    const __form0CaptureEventSourc\u0065 = null;
    ON('change', 'input', function () { SETVALUE('note', String($input)); });
  `),
    });
    assert.deepEqual(engine.trigger('change', 'input'), [setNote('1')]);
  })
);

// Retained callbacks never consult toString, even when it throws outright.
const savedToString = Function.prototype.toString;
Function.prototype.toString = function () {
  throw new Error('toString must not be called');
};
try {
  captureConsole(() => {
    let initialized = 0;
    let evaluated = 0;
    const engine = createFormEngine({
      schema: formSchema(
        [
          numericField('input', { default_value: 1 }),
          textField('note'),
          calculatedField('double', 'observe($input * 2)'),
        ],
        {
          events: {
            code: `
        initialize();
        ON('change', 'input', handler);
        ON('change', 'input', handler);
        OFF('change', 'input', handler);
        function handler(event) {
          SETVALUE('note', String($double) + ':' + event.value + ':' + EVAL('$input') + ':' + DATANAMES().includes('input'));
        }
        ON('change', event => SETVALUE('note', 'wildcard'));
      `,
          },
        }
      ),
      helpers: { initialize: () => initialized++, observe: (value) => (evaluated++, value) },
    });
    for (const value of [9, 11]) {
      engine.getState().values.input = value;
      engine.eval();
      const calls = evaluated;
      assert.deepEqual(engine.trigger('change', 'input', { value }), [
        setNote(`${value * 2}:${value}:${value}:true`),
        setNote('wildcard'),
      ]);
      assert.equal(evaluated, calls);
      assert.deepEqual(engine.getDiagnostics(), []);
    }
    assert.equal(initialized, 1);
    assert.equal(engine.getState().values.note, null);
  });
} finally {
  Function.prototype.toString = savedToString;
}

const opaqueHost = captureConsole(() =>
  withOpaqueFunctions(() => {
    const engine = createFormEngine({
      schema: schemaFor(
        "ON('change', 'input', host); ON('change', 'input', function () { SETVALUE('note', 'continued'); });"
      ),
      helpers: { host: new Function("SETVALUE('note', 'external');") },
    });
    assert.deepEqual(engine.trigger('change', 'input'), [setNote('continued')]);
  })
);
assert.equal(opaqueHost.calls.filter((call) => call.method === 'warn').length, 1);
assert.match(
  opaqueHost.calls.find((call) => call.method === 'warn').args.join(' '),
  /callback source is unavailable.*form.events.code/
);

const recovery = captureConsole(() =>
  withOpaqueFunctions(() => {
    const engine = createFormEngine({
      schema: schemaFor(`
      ON('change', 'input', function () {
        SETVALUE('note', 'partial');
        if ($input === 0) throw new SyntaxError('event failure');
        SETVALUE('note', 'recovered');
        OFF('change', 'input');
        ON('change', 'note', function () { SETVALUE('note', 'unexpected'); });
      });
      ON('change', 'input', function () { SETVALUE('note', 'continued'); });
    `),
      diagnostics: { console: false },
    });
    engine.getState().values.input = 0;
    engine.eval();
    assert.deepEqual(engine.trigger('change', 'input'), [setNote('partial'), setNote('continued')]);
    assert.deepEqual(engine.getDiagnostics(), []);
    engine.getState().values.input = 4;
    engine.eval();
    assert.deepEqual(engine.trigger('change', 'input'), [
      setNote('partial'),
      setNote('recovered'),
      setNote('continued'),
    ]);
    assert.deepEqual(engine.trigger('change', 'note'), []);
    assert.deepEqual(engine.trigger('change', 'input'), [
      setNote('partial'),
      setNote('recovered'),
      setNote('continued'),
    ]);
  })
);
assert.equal(
  recovery.calls.filter((call) => call.method === 'warn').length,
  1,
  'Calculation console silence does not silence events'
);

captureConsole(() =>
  withOpaqueFunctions(() => {
    const engines = ['first', 'second'].map((label) =>
      createFormEngine({
        schema: schemaFor(
          `ON('change', 'input', function () { SETVALUE('note', '${label}:' + $input); });`
        ),
      })
    );
    engines[0].getState().values.input = 9;
    assert.deepEqual(engines[1].trigger('change', 'input'), [setNote('second:1')]);
    assert.deepEqual(engines[0].trigger('change', 'input'), [setNote('first:9')]);
    const strict = createFormEngine({
      schema: schemaFor(`
    'use strict';
    ON('change', 'input', handler);
    function handler() { 'use strict'; SETVALUE('note', this === undefined ? 'strict' : 'bad'); }
  `),
    });
    assert.deepEqual(strict.trigger('change', 'input'), [setNote('strict')]);
    const safe = createFormEngine({
      schema: schemaFor(
        "ON('change', 'input', function () { SETVALUE('note', String($input)); });"
      ),
      security: SAFE_SECURITY_CONFIG,
    });
    assert.deepEqual(safe.trigger('change', 'input'), [setNote('1')]);
  })
);

const restrictions = captureConsole(() =>
  withOpaqueFunctions(() => {
    const engine = createFormEngine({
      schema: formSchema(
        [
          numericField('input'),
          textField('note'),
          repeatableSection('rows', [
            textField('child'),
            repeatableSection('nested', [textField('deep')]),
          ]),
        ],
        {
          events: {
            code: `
    ON('change', 'input', function () { SETVALUE('child', 'blocked'); SETVALUE('deep', 'blocked'); SETVALUE('note', 'allowed'); });
    ON('change', 'note', function () { SETVALUE('note', $missing); });
  `,
          },
        }
      ),
    });
    assert.deepEqual(engine.trigger('change', 'input'), [setNote('allowed')]);
    assert.deepEqual(engine.trigger('change', 'note'), []);
  })
);
assert.match(
  restrictions.calls
    .filter((call) => call.method === 'warn')
    .map((call) => call.args.join(' '))
    .join(' '),
  /missing/
);

for (const code of [
  "ON('change', 'input', function () {", // Existing syntax failure
  "ON('change', 'input', function () { SETVALUE('note', process.version); });",
]) {
  const failure = captureConsole(() =>
    withOpaqueFunctions(() => {
      const engine = createFormEngine({ schema: schemaFor(code), security: SAFE_SECURITY_CONFIG });
      assert.deepEqual(engine.trigger('change', 'input'), []);
    })
  );
  assert.equal(failure.calls.filter((call) => call.method === 'warn').length, 1);
}

captureConsole(() =>
  withOpaqueFunctions(() => {
    const schema = JSON.parse(
      readFileSync(new URL('./fixtures/hermes-event-compatibility.schema.json', import.meta.url))
    );
    assert.doesNotThrow(() => validateSchema(schema.form));
    const engine = createFormEngine({ schema, diagnostics: { console: false } });
    for (const [divisor, quotient, dependent] of [
      [3, 4, 5],
      [0, null, 1],
      [4, 3, 4],
    ]) {
      engine.getState().values.divisor = divisor;
      engine.eval();
      assert.equal(engine.getState().values.quotient, quotient);
      assert.equal(engine.getState().values.dependent, dependent);
      assert.equal(engine.getState().values.independent, 24);
      assert.equal(engine.getState().visible.failure_notice, divisor === 0);
      assert.deepEqual(engine.trigger('change', 'divisor'), [
        setNote(`divisor=${divisor}; quotient=${quotient}`),
      ]);
      assert.deepEqual(engine.getState().errors, {});
    }
  })
);

captureConsole(() =>
  withOpaqueFunctions(() => {
    const names = [];
    const engine = createFormEngine({
      schema: schemaFor(`
    class Handlers { static #h = event => SETVALUE('note', String($input)); static get h() { return this.#h; } }
    observeName(Handlers.h.name); ON('change', 'input', Handlers.h);
  `),
      helpers: { observeName: (name) => names.push(name) },
    });
    assert.deepEqual(names, ['#h']);
    assert.deepEqual(engine.trigger('change', 'input'), [setNote('1')]);
  })
);

console.log('Hermes event tests passed.');
