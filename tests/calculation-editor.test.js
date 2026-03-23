import assert from 'node:assert/strict';

import {
  analyzeCalculationExpression,
  getCalculationBuiltinCatalog,
  getCalculationReferenceCatalog,
} from '../src/index.js';

const schema = {
  form: {
    name: 'Calculation Editor Test Form',
    description: null,
    elements: [
      {
        type: 'NumericField',
        key: 'age',
        data_name: 'age',
        label: 'Age',
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
        min: null,
        max: null,
        format: 'integer',
        supporting_image: false,
        supporting_image_path: null,
        supporting_image_display: null,
      },
      {
        type: 'RepeatableSection',
        key: 'rooms',
        data_name: 'rooms',
        label: 'Rooms',
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
            key: 'room_name',
            data_name: 'room_name',
            label: 'Room Name',
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
            key: 'room_summary',
            data_name: 'room_summary',
            label: 'Room Summary',
            display: { style: 'text' },
            description: null,
            description_mode: null,
            required: false,
            visible: true,
            visible_conditions: null,
            read_only: true,
            calculate: 'SETRESULT($room_name)',
            supporting_image: false,
            supporting_image_path: null,
            supporting_image_display: null,
          },
        ],
      },
      {
        type: 'RepeatableSection',
        key: 'tasks',
        data_name: 'tasks',
        label: 'Tasks',
        display: 'drilldown',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        location_enabled: false,
        location_required: false,
        elements: [
          {
            type: 'NumericField',
            key: 'task_duration',
            data_name: 'task_duration',
            label: 'Task Duration',
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
            min: null,
            max: null,
            format: 'integer',
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
  const catalog = getCalculationBuiltinCatalog();
  const builtinNames = catalog.map((builtin) => builtin.name);

  assert.equal(builtinNames.includes('SETVALUE'), false);
  assert.equal(builtinNames.includes('ON'), false);
  assert.equal(builtinNames.includes('OFF'), false);
  assert.equal(builtinNames.includes('ALERT'), false);
  assert.equal(catalog.find((builtin) => builtin.name === 'COUNT')?.signature, 'COUNT(values)');
  assert.equal(catalog.find((builtin) => builtin.name === 'EVAL')?.status, 'advanced');
  assert.equal(catalog.find((builtin) => builtin.name === 'FORM')?.status, 'unavailable');
})();

(() => {
  const references = getCalculationReferenceCatalog({
    schema,
    fieldDataName: 'room_summary',
  });
  const referenceNames = references.map((reference) => reference.dataName);

  assert.equal(referenceNames.includes('room_summary'), false);
  assert.equal(referenceNames.includes('room_name'), true);
  assert.equal(referenceNames.includes('age'), true);
  assert.equal(referenceNames.includes('task_duration'), false);
})();

(() => {
  const analysis = analyzeCalculationExpression({
    schema,
    fieldDataName: 'room_summary',
    expression: `
      const roundedAge = ROUND($age / 2, 0);
      SETRESULT($room_name + ' / ' + roundedAge);
    `,
  });

  assert.equal(analysis.valid, true);
  assert.deepEqual(
    analysis.usedBuiltins,
    ['ROUND', 'SETRESULT'],
    'Expected multiline calculations to collect builtin usage'
  );
  assert.deepEqual(analysis.referencedFields, ['age', 'room_name']);
})();

(() => {
  const analysis = analyzeCalculationExpression({
    schema,
    fieldDataName: 'room_summary',
    expression:
      "SETVALUE('age', 30); BOOM($age); SETRESULT($task_duration); FORM(); EVAL('$room_name');",
  });

  const issueCodes = analysis.issues.map((issue) => issue.code);

  assert.equal(analysis.valid, false);
  assert.equal(issueCodes.includes('event_builtin_not_allowed'), true);
  assert.equal(issueCodes.includes('unknown_builtin'), true);
  assert.equal(issueCodes.includes('restricted_field_reference'), true);
  assert.equal(issueCodes.includes('unavailable_builtin'), true);
  assert.equal(issueCodes.includes('advanced_builtin'), true);
})();

(() => {
  const analysis = analyzeCalculationExpression({
    schema,
    fieldDataName: 'room_summary',
    expression: 'SETRESULT($missing_field)',
  });

  assert.equal(analysis.valid, false);
  assert.equal(
    analysis.issues.some((issue) => issue.code === 'unknown_field_reference'),
    true
  );
})();
