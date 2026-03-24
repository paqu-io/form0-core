import assert from 'node:assert/strict';

import {
  analyzeCalculationExpression,
  createFormEngine,
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
  const roomNameReference = references.find((reference) => reference.dataName === 'room_name');
  const ageReference = references.find((reference) => reference.dataName === 'age');

  assert.equal(referenceNames.includes('room_summary'), false);
  assert.equal(referenceNames.includes('room_name'), true);
  assert.equal(referenceNames.includes('age'), true);
  assert.equal(referenceNames.includes('task_duration'), false);
  assert.equal(roomNameReference?.access.level, 'accessible');
  assert.equal(roomNameReference?.access.code, 'same_repeatable_section');
  assert.equal(ageReference?.access.level, 'accessible');
  assert.equal(ageReference?.access.code, 'main_form');
})();

(() => {
  const references = getCalculationReferenceCatalog({
    schema,
    fieldDataName: 'room_summary',
    includeRestricted: true,
  });
  const referenceNames = references.map((reference) => reference.dataName);
  const taskDurationReference = references.find(
    (reference) => reference.dataName === 'task_duration'
  );

  assert.equal(referenceNames.includes('room_summary'), false);
  assert.equal(referenceNames.includes('room_name'), true);
  assert.equal(referenceNames.includes('age'), true);
  assert.equal(referenceNames.includes('task_duration'), true);
  assert.equal(taskDurationReference?.access.level, 'restricted');
  assert.equal(taskDurationReference?.access.code, 'different_repeatable_section');
  assert.match(
    taskDurationReference?.access.suggestion || '',
    /same RepeatableSection or ancestor contexts/
  );
})();

(() => {
  const sectionScopedSchema = {
    form: {
      name: 'Section Scoped Calculation Test',
      description: null,
      elements: [
        {
          type: 'TextField',
          key: 'full_name',
          data_name: 'full_name',
          label: 'Full Name',
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
          type: 'Section',
          key: 'contact_section',
          data_name: 'contact_section',
          label: 'Contact',
          display: 'inline',
          description: null,
          description_mode: null,
          visible: true,
          visible_conditions: null,
          elements: [
            {
              type: 'TextField',
              key: 'city_name',
              data_name: 'city_name',
              label: 'City',
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
              type: 'Section',
              key: 'nested_section',
              data_name: 'nested_section',
              label: 'Nested',
              display: 'inline',
              description: null,
              description_mode: null,
              visible: true,
              visible_conditions: null,
              elements: [
                {
                  type: 'CalculatedField',
                  key: 'contact_summary',
                  data_name: 'contact_summary',
                  label: 'Contact Summary',
                  display: { style: 'text' },
                  description: null,
                  description_mode: null,
                  required: false,
                  visible: true,
                  visible_conditions: null,
                  read_only: true,
                  calculate: 'SETRESULT($full_name + " / " + $city_name)',
                  supporting_image: false,
                  supporting_image_path: null,
                  supporting_image_display: null,
                },
                {
                  type: 'BooleanField',
                  key: 'is_primary_contact',
                  data_name: 'is_primary_contact',
                  label: 'Primary',
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
                  choices: [
                    {
                      label: 'Yes',
                      value: 'yes',
                    },
                    {
                      label: 'No',
                      value: 'no',
                    },
                  ],
                  third_option_enabled: false,
                  supporting_image: false,
                  supporting_image_path: null,
                  supporting_image_display: null,
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const references = getCalculationReferenceCatalog({
    schema: sectionScopedSchema,
    fieldDataName: 'contact_summary',
  });
  const referenceNames = references.map((reference) => reference.dataName);
  const cityReference = references.find((reference) => reference.dataName === 'city_name');

  assert.equal(referenceNames.includes('full_name'), true);
  assert.equal(referenceNames.includes('city_name'), true);
  assert.equal(referenceNames.includes('is_primary_contact'), true);
  assert.equal(cityReference?.access.level, 'accessible');
  assert.equal(cityReference?.access.code, 'main_form');
})();

(() => {
  const nestedRepeatableSchema = {
    form: {
      name: 'Nested Repeatable Calculation Test',
      description: null,
      elements: [
        {
          type: 'NumericField',
          key: 'base_rate',
          data_name: 'base_rate',
          label: 'Base Rate',
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
          key: 'buildings',
          data_name: 'buildings',
          label: 'Buildings',
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
              key: 'building_multiplier',
              data_name: 'building_multiplier',
              label: 'Building Multiplier',
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
                  type: 'NumericField',
                  key: 'room_area',
                  data_name: 'room_area',
                  label: 'Room Area',
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
                  type: 'CalculatedField',
                  key: 'room_total',
                  data_name: 'room_total',
                  label: 'Room Total',
                  display: { style: 'numeric' },
                  description: null,
                  description_mode: null,
                  required: false,
                  visible: true,
                  visible_conditions: null,
                  read_only: true,
                  calculate: 'SETRESULT($room_area * $building_multiplier * $base_rate)',
                  supporting_image: false,
                  supporting_image_path: null,
                  supporting_image_display: null,
                },
              ],
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
              key: 'task_hours',
              data_name: 'task_hours',
              label: 'Task Hours',
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

  const references = getCalculationReferenceCatalog({
    schema: nestedRepeatableSchema,
    fieldDataName: 'room_total',
    includeRestricted: true,
  });
  const roomAreaReference = references.find((reference) => reference.dataName === 'room_area');
  const buildingMultiplierReference = references.find(
    (reference) => reference.dataName === 'building_multiplier'
  );
  const baseRateReference = references.find((reference) => reference.dataName === 'base_rate');
  const taskHoursReference = references.find((reference) => reference.dataName === 'task_hours');

  assert.equal(roomAreaReference?.access.level, 'accessible');
  assert.equal(roomAreaReference?.access.code, 'same_repeatable_section');
  assert.equal(buildingMultiplierReference?.access.level, 'accessible');
  assert.equal(buildingMultiplierReference?.access.code, 'ancestor_repeatable_context');
  assert.equal(baseRateReference?.access.level, 'accessible');
  assert.equal(baseRateReference?.access.code, 'main_form');
  assert.equal(taskHoursReference?.access.level, 'restricted');
  assert.equal(taskHoursReference?.access.code, 'different_repeatable_section');
})();

(() => {
  const analysis = analyzeCalculationExpression({
    schema,
    fieldDataName: 'room_summary',
    expression: 'SETRESULT($age);',
  });

  assert.equal(analysis.valid, true);
  assert.deepEqual(analysis.issues, []);
})();

(() => {
  const inlineSemicolonSchema = {
    form: {
      name: 'Inline Semicolon Test Form',
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
          type: 'CalculatedField',
          key: 'age_copy',
          data_name: 'age_copy',
          label: 'Age Copy',
          display: { style: 'numeric' },
          description: null,
          description_mode: null,
          required: false,
          visible: true,
          visible_conditions: null,
          read_only: true,
          calculate: 'SETRESULT($age);',
          supporting_image: false,
          supporting_image_path: null,
          supporting_image_display: null,
        },
      ],
    },
  };

  const engine = createFormEngine({
    schema: inlineSemicolonSchema,
    initialValues: {
      age: 21,
    },
  });

  engine.eval();

  assert.equal(engine.getState().values.age_copy, 21);
})();

(() => {
  const analysis = analyzeCalculationExpression({
    schema,
    fieldDataName: 'room_summary',
    expression: `
      SETRESULT($room_name);
      SETRESULT($age);
    `,
  });

  assert.equal(analysis.valid, false);
  assert.equal(
    analysis.issues.some((issue) => issue.code === 'multiple_setresult_calls'),
    true
  );
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
