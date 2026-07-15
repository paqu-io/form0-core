import assert from 'node:assert/strict';

import {
  buildDatasetDescriptors,
  buildFieldIdentityMap,
  getFieldQuerySemantics,
  getFieldExportKind,
  projectDatasetRowValues,
  resolveDatasetDescriptorById,
} from '../src/index.js';

const exportKindExpectations = new Map([
  ['TextField', 'value'],
  ['NumericField', 'value'],
  ['SingleChoiceField', 'value'],
  ['MultiChoiceField', 'value'],
  ['BooleanField', 'value'],
  ['DateField', 'value'],
  ['TimeField', 'value'],
  ['CalculatedField', 'value'],
  ['FormLinkField', 'value'],
  ['StatusField', 'value'],
  ['TitleField', 'value'],
  ['PhotoField', 'media'],
  ['VideoField', 'media'],
  ['SignatureField', 'media'],
  ['LabelField', 'none'],
  ['Section', 'none'],
  ['RepeatableSection', 'none'],
  ['BuildingPlanSection', 'none'],
]);

for (const [fieldType, expected] of exportKindExpectations) {
  assert.equal(
    getFieldExportKind({ type: fieldType }),
    expected,
    `${fieldType} should use export kind ${expected}`
  );
}

const exportProjectionDataset = buildDatasetDescriptors({
  form: {
    elements: [
      { type: 'PhotoField', key: 'photo_key', data_name: 'photo', label: 'Photo' },
      {
        type: 'CalculatedField',
        key: 'metric_key',
        data_name: 'metric',
        label: 'Metric',
        display: { style: 'currency' },
      },
    ],
  },
})[0];
const exportedProjection = projectDatasetRowValues(exportProjectionDataset, {
  photo: [{ asset_id: 'asset-1' }],
  metric: 123.45,
});
assert.equal(exportProjectionDataset.fields[0].export_kind, 'media');
assert.equal(exportProjectionDataset.fields[1].export_kind, 'value');
assert.deepEqual(exportedProjection.displayValues.photo_key, [{ asset_id: 'asset-1' }]);
assert.equal(exportedProjection.scalarValues.metric_key, 123.45);

const schema = {
  form: {
    name: 'Zoo Survey',
    location_enabled: true,
    location_required: false,
    elements: [
      {
        type: 'TextField',
        key: 'title_key',
        data_name: 'title',
        label: 'Title',
      },
      {
        type: 'NumericField',
        key: 'age_key',
        data_name: 'age',
        label: 'Age',
      },
      {
        type: 'Section',
        key: 'location_section',
        data_name: 'location_section',
        label: 'Location Section',
        elements: [
          {
            type: 'SingleChoiceField',
            key: 'city_key',
            data_name: 'city',
            label: 'City',
            choices: [
              { label: 'Bogota', value: 'bogota' },
              { label: 'Paris', value: 'paris' },
            ],
          },
          {
            type: 'BooleanField',
            key: 'approved_key',
            data_name: 'approved',
            label: 'Approved',
            choices: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ],
          },
        ],
      },
      {
        type: 'RepeatableSection',
        key: 'animals_key',
        data_name: 'animals',
        label: 'Animals',
        location_enabled: true,
        location_required: true,
        elements: [
          {
            type: 'TextField',
            key: 'animal_name_key',
            data_name: 'animal_name',
            label: 'Animal Name',
          },
          {
            type: 'MultiChoiceField',
            key: 'animal_tags_key',
            data_name: 'animal_tags',
            label: 'Animal Tags',
            choices: [
              { label: 'Fast', value: 'fast' },
              { label: 'Calm', value: 'calm' },
            ],
          },
          {
            type: 'RepeatableSection',
            key: 'vaccinations_key',
            data_name: 'vaccinations',
            label: 'Vaccinations',
            elements: [
              {
                type: 'DateField',
                key: 'shot_date_key',
                data_name: 'shot_date',
                label: 'Shot Date',
              },
              {
                type: 'CalculatedField',
                key: 'dose_count_key',
                data_name: 'dose_count',
                label: 'Dose Count',
                display: {
                  style: 'numeric',
                },
              },
            ],
          },
        ],
      },
    ],
  },
};

const datasets = buildDatasetDescriptors(schema);

assert.equal(datasets.length, 3);

const rootDataset = resolveDatasetDescriptorById(schema, '__root__');
assert.ok(rootDataset);
assert.equal(rootDataset.kind, 'root');
assert.equal(rootDataset.label, 'Zoo Survey');
assert.equal(rootDataset.location_enabled, true);
assert.equal(rootDataset.location_required, false);
assert.deepEqual(
  rootDataset.fields.map((field) => field.field_id),
  ['title_key', 'age_key', 'city_key', 'approved_key']
);
assert.deepEqual(
  rootDataset.fields.map((field) => field.output_key),
  ['title', 'age', 'city', 'approved']
);

const animalsDataset = resolveDatasetDescriptorById(schema, 'animals_key');
assert.ok(animalsDataset);
assert.equal(animalsDataset.kind, 'repeatable');
assert.equal(animalsDataset.parent_dataset_id, '__root__');
assert.equal(animalsDataset.repeatable_field_id, 'animals_key');
assert.equal(animalsDataset.repeatable_output_key, 'animals');
assert.equal(animalsDataset.label, 'Animals');
assert.equal(animalsDataset.location_enabled, true);
assert.equal(animalsDataset.location_required, true);
assert.deepEqual(
  animalsDataset.fields.map((field) => field.field_id),
  ['animal_name_key', 'animal_tags_key']
);

const vaccinationsDataset = resolveDatasetDescriptorById(schema, 'animals_key.vaccinations_key');
assert.ok(vaccinationsDataset);
assert.equal(vaccinationsDataset.parent_dataset_id, 'animals_key');
assert.equal(vaccinationsDataset.label, 'Animals / Vaccinations');
assert.equal(vaccinationsDataset.location_enabled, false);
assert.equal(vaccinationsDataset.location_required, false);
assert.deepEqual(
  vaccinationsDataset.fields.map((field) => field.field_id),
  ['shot_date_key', 'dose_count_key']
);

const textSemantics = getFieldQuerySemantics({
  type: 'TextField',
  key: 'text_key',
  data_name: 'text_value',
});
assert.deepEqual(textSemantics, {
  query_kind: 'scalar',
  display_kind: 'text',
  sortable: true,
  filterable: true,
  default_operator: 'contains',
  allowed_operators: [
    'contains',
    'not_contains',
    'eq',
    'neq',
    'in',
    'not_in',
    'starts_with',
    'ends_with',
    'is_blank',
    'is_not_blank',
  ],
});

const numericSemantics = getFieldQuerySemantics({
  type: 'NumericField',
  key: 'numeric_key',
  data_name: 'numeric_value',
});
assert.deepEqual(numericSemantics, {
  query_kind: 'scalar',
  display_kind: 'number',
  sortable: true,
  filterable: true,
  default_operator: 'between',
  allowed_operators: [
    'between',
    'gte',
    'lte',
    'eq',
    'neq',
    'gt',
    'lt',
    'in',
    'not_in',
    'is_blank',
    'is_not_blank',
  ],
});

const booleanSemantics = getFieldQuerySemantics({
  type: 'BooleanField',
  key: 'boolean_key',
  data_name: 'boolean_choice',
});
assert.deepEqual(booleanSemantics, {
  query_kind: 'scalar',
  display_kind: 'enum',
  sortable: true,
  filterable: true,
  default_operator: 'in',
  allowed_operators: ['in', 'eq', 'neq', 'not_in', 'is_blank', 'is_not_blank'],
});

const calculatedNumericAliasSemantics = getFieldQuerySemantics({
  type: 'CalculatedField',
  key: 'calc_number_key',
  data_name: 'calc_number',
  display_mode: 'number',
});
assert.deepEqual(calculatedNumericAliasSemantics, {
  query_kind: 'scalar',
  display_kind: 'number',
  sortable: true,
  filterable: true,
  default_operator: 'between',
  allowed_operators: [
    'between',
    'gte',
    'lte',
    'eq',
    'neq',
    'gt',
    'lt',
    'in',
    'not_in',
    'is_blank',
    'is_not_blank',
  ],
});

const multiChoiceSemantics = getFieldQuerySemantics({
  type: 'MultiChoiceField',
  key: 'multi_key',
  data_name: 'multi_value',
});
assert.deepEqual(multiChoiceSemantics, {
  query_kind: 'terms',
  display_kind: 'enum_multi',
  sortable: false,
  filterable: true,
  default_operator: 'has_any',
  allowed_operators: ['has_any', 'has_all', 'has_none', 'is_blank', 'is_not_blank'],
});

const projectedRoot = projectDatasetRowValues(rootDataset, {
  title: 'Main record',
  age: '12',
  city: {
    choice_value: [{ value: 'bogota', label: 'Legacy Bogota' }],
    other_value: [],
  },
  approved: {
    choice_value: [{ value: 'yes', label: 'Legacy Yes' }],
    other_value: [],
  },
});

assert.deepEqual(projectedRoot.displayValues, {
  title_key: 'Main record',
  age_key: '12',
  city_key: 'Bogota',
  approved_key: 'Yes',
});
assert.deepEqual(projectedRoot.scalarValues, {
  title_key: 'Main record',
  age_key: 12,
  city_key: 'bogota',
  approved_key: 'yes',
});
assert.deepEqual(projectedRoot.termValues, {});

const projectedChild = projectDatasetRowValues(animalsDataset, {
  form_values: {
    animal_name: 'Falcon',
    animal_tags: {
      choices_value: [
        { value: 'fast', label: 'Legacy Fast' },
        { value: 'calm', label: 'Legacy Calm' },
      ],
      other_value: [{ value: 'custom-tag', label: 'Custom Tag' }],
    },
  },
});

const projectedCalculatedNumeric = projectDatasetRowValues(vaccinationsDataset, {
  form_values: {
    shot_date: '2026-04-02',
    dose_count: '44',
  },
});

assert.deepEqual(projectedCalculatedNumeric.scalarValues, {
  shot_date_key: '2026-04-02',
  dose_count_key: 44,
});

assert.deepEqual(projectedChild.displayValues, {
  animal_name_key: 'Falcon',
  animal_tags_key: ['Fast', 'Calm', 'Custom Tag'],
});
assert.deepEqual(projectedChild.scalarValues, {
  animal_name_key: 'Falcon',
});
assert.deepEqual(projectedChild.termValues, {
  animal_tags_key: ['fast', 'calm', 'custom-tag'],
});

const projectedBlankRootChoices = projectDatasetRowValues(rootDataset, {
  city: {
    choice_value: [],
    other_value: [],
  },
  approved: {
    choice_value: [],
    other_value: [],
  },
});

assert.deepEqual(
  projectedBlankRootChoices.displayValues,
  {},
  'blank canonical single choice and boolean values should not leak raw objects into display values'
);
assert.deepEqual(
  projectedBlankRootChoices.scalarValues,
  {},
  'blank canonical single choice and boolean values should not project scalar values'
);

const projectedBlankMultiChoice = projectDatasetRowValues(animalsDataset, {
  form_values: {
    animal_tags: {
      choices_value: [],
      other_value: [],
    },
  },
});

assert.deepEqual(
  projectedBlankMultiChoice.displayValues,
  {},
  'blank canonical multi choice values should not leak raw objects into display values'
);
assert.deepEqual(
  projectedBlankMultiChoice.termValues,
  {},
  'blank canonical multi choice values should not project term values'
);

assert.throws(
  () =>
    projectDatasetRowValues(rootDataset, {
      city: {
        choice: [{ value: 'bogota', label: 'Bogota' }],
        other: [],
      },
    }),
  /must not use renderer keys/,
  'dataset projection should reject renderer choice aliases'
);

const identityMap = buildFieldIdentityMap(schema);
assert.deepEqual(identityMap.city_key, {
  field_id: 'city_key',
  output_key: 'city',
  key: 'city_key',
  data_name: 'city',
  label: 'City',
  field_type: 'SingleChoiceField',
});
assert.deepEqual(identityMap.shot_date_key, {
  field_id: 'shot_date_key',
  output_key: 'shot_date',
  key: 'shot_date_key',
  data_name: 'shot_date',
  label: 'Shot Date',
  field_type: 'DateField',
});

console.log('dataset-descriptors tests passed');
