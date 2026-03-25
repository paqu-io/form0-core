import assert from 'node:assert/strict';

import {
  analyzeFormEventCode,
  createFormEngine,
  getBuiltinDefinitions,
  getFormEventBuiltinCatalog,
  getFormEventReferenceCatalog,
} from '../src/index.js';

const schema = {
  form: {
    name: 'Form Event Authoring Test',
    description: null,
    events: null,
    elements: [
      {
        type: 'TextField',
        key: 'first_name',
        data_name: 'first_name',
        label: 'First Name',
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
        pattern: null,
        pattern_description: null,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
      },
      {
        type: 'TextField',
        key: 'status_message',
        data_name: 'status_message',
        label: 'Status Message',
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
        pattern: null,
        pattern_description: null,
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
      },
      {
        type: 'CalculatedField',
        key: 'full_name',
        data_name: 'full_name',
        label: 'Full Name',
        display: { style: 'text' },
        description: null,
        description_mode: null,
        required: false,
        visible: true,
        visible_conditions: null,
        read_only: true,
        calculate: 'SETRESULT($first_name)',
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
      },
      {
        type: 'RepeatableSection',
        key: 'contacts',
        data_name: 'contacts',
        label: 'Contacts',
        display: 'drilldown',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        location_enabled: false,
        location_required: false,
        elements: [
          {
            type: 'TextField',
            key: 'contact_name',
            data_name: 'contact_name',
            label: 'Contact Name',
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
            pattern: null,
            pattern_description: null,
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
          },
        ],
      },
    ],
  },
};

(() => {
  const builtinCatalog = getFormEventBuiltinCatalog();
  const builtinNames = builtinCatalog.map((builtin) => builtin.name);

  assert.equal(builtinNames.includes('ON'), true);
  assert.equal(builtinNames.includes('OFF'), true);
  assert.equal(builtinNames.includes('SETVALUE'), true);
  assert.equal(builtinNames.includes('ALERT'), true);
  assert.equal(builtinNames.includes('EVAL'), true);
  assert.equal(builtinNames.includes('SETRESULT'), false);
  assert.equal(builtinCatalog.find((builtin) => builtin.name === 'EVAL')?.status, 'advanced');
  assert.equal(
    builtinCatalog.find((builtin) => builtin.name === 'FORM')?.status,
    'unavailable'
  );
})();

(() => {
  const definitionsByName = new Map(
    getBuiltinDefinitions().map((definition) => [definition.name, definition])
  );

  assert.deepEqual(definitionsByName.get('SETRESULT')?.contexts, ['calculation']);
})();

(() => {
  const references = getFormEventReferenceCatalog({ schema });
  const referenceNames = references.map((reference) => reference.dataName);
  const repeatableReference = references.find((reference) => reference.dataName === 'contact_name');

  assert.equal(referenceNames.includes('first_name'), true);
  assert.equal(referenceNames.includes('status_message'), true);
  assert.equal(referenceNames.includes('full_name'), true);
  assert.equal(referenceNames.includes('contacts'), false);
  assert.equal(referenceNames.includes('contact_name'), true);
  assert.deepEqual(repeatableReference?.parentPath, ['contacts']);
})();

(() => {
  const analysis = analyzeFormEventCode({
    schema,
    code: '',
  });

  assert.equal(analysis.valid, true);
  assert.deepEqual(analysis.issues, []);
})();

(() => {
  const analysis = analyzeFormEventCode({
    schema,
    code: `
      function loadHandler(event) {
        SETVALUE(EVAL("'status_message'"), EVAL("'Loaded'"));
      }

      ON('load-record', loadHandler);
      ON('change', 'first_name', function (event) {
        SETVALUE('status_message', $first_name);
      });
    `,
  });

  assert.equal(analysis.valid, true);
  assert.deepEqual(analysis.usedBuiltins, ['SETVALUE', 'EVAL', 'ON']);
  assert.deepEqual(analysis.referencedFields, ['first_name']);
})();

(() => {
  const analysis = analyzeFormEventCode({
    schema,
    code: `
      ON('not-a-real-event', function (event) {
        SETRESULT($missing_field);
        ALERT('Oops', FORM());
        BOOM($status_message);
      });
    `,
  });

  const issueCodes = analysis.issues.map((issue) => issue.code);

  assert.equal(analysis.valid, false);
  assert.equal(issueCodes.includes('unknown_event_type'), true);
  assert.equal(issueCodes.includes('calculation_builtin_not_allowed'), true);
  assert.equal(issueCodes.includes('unknown_field_reference'), true);
  assert.equal(issueCodes.includes('unavailable_builtin'), true);
  assert.equal(issueCodes.includes('unknown_builtin'), true);
})();

(() => {
  const engine = createFormEngine({
    schema: {
      form: {
        ...schema.form,
        events: {
          code: `
            function loadHandler(event) {
              SETVALUE(EVAL("'status_message'"), EVAL("'named handler'"));
            }

            ON('load-record', loadHandler);

            ON('change', 'first_name', function (event) {
              SETVALUE(EVAL("'status_message'"), EVAL("'inline handler'"));
            });
          `,
        },
      },
    },
    initialValues: {
      first_name: 'Ada',
      status_message: null,
    },
  });

  const loadOperations = engine.trigger('load-record');
  const changeOperations = engine.trigger('change', 'first_name');

  assert.deepEqual(loadOperations, [
    {
      type: 'FIELD_OPERATION',
      operation: 'SETVALUE',
      params: {
        fieldDataName: 'status_message',
        valueToSet: 'named handler',
      },
    },
  ]);
  assert.deepEqual(changeOperations, [
    {
      type: 'FIELD_OPERATION',
      operation: 'SETVALUE',
      params: {
        fieldDataName: 'status_message',
        valueToSet: 'inline handler',
      },
    },
  ]);
})();

(() => {
  const engine = createFormEngine({
    schema: {
      form: {
        ...schema.form,
        events: {
          code: `
            ON('load-record', function (event) {
              SETRESULT('blocked');
            });
          `,
        },
      },
    },
  });

  assert.deepEqual(engine.trigger('load-record'), []);
})();
