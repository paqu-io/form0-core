import assert from 'node:assert/strict';

import {
  buildDatasetDescriptors,
  buildFieldIdentityMap,
  getFieldQuerySemantics,
  projectDatasetRowValues,
  resolveDatasetDescriptorById,
} from '../src/index.js';

const schema = {
  form: {
    name: 'Zoo Survey',
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
        ],
      },
      {
        type: 'RepeatableSection',
        key: 'animals_key',
        data_name: 'animals',
        label: 'Animals',
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
assert.deepEqual(
  rootDataset.fields.map((field) => field.field_id),
  ['title_key', 'age_key', 'city_key'],
);
assert.deepEqual(
  rootDataset.fields.map((field) => field.output_key),
  ['title', 'age', 'city'],
);

const animalsDataset = resolveDatasetDescriptorById(schema, 'animals_key');
assert.ok(animalsDataset);
assert.equal(animalsDataset.kind, 'repeatable');
assert.equal(animalsDataset.parent_dataset_id, '__root__');
assert.equal(animalsDataset.repeatable_field_id, 'animals_key');
assert.equal(animalsDataset.repeatable_output_key, 'animals');
assert.equal(animalsDataset.label, 'Animals');
assert.deepEqual(
  animalsDataset.fields.map((field) => field.field_id),
  ['animal_name_key', 'animal_tags_key'],
);

const vaccinationsDataset = resolveDatasetDescriptorById(schema, 'animals_key.vaccinations_key');
assert.ok(vaccinationsDataset);
assert.equal(vaccinationsDataset.parent_dataset_id, 'animals_key');
assert.equal(vaccinationsDataset.label, 'Animals / Vaccinations');
assert.deepEqual(
  vaccinationsDataset.fields.map((field) => field.field_id),
  ['shot_date_key', 'dose_count_key'],
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
    choice: [{ value: 'bogota', label: 'Bogota' }],
    other: [],
  },
});

assert.deepEqual(projectedRoot.displayValues, {
  title_key: 'Main record',
  age_key: '12',
  city_key: 'Bogota',
});
assert.deepEqual(projectedRoot.scalarValues, {
  title_key: 'Main record',
  age_key: 12,
  city_key: 'bogota',
});
assert.deepEqual(projectedRoot.termValues, {});

const projectedChild = projectDatasetRowValues(animalsDataset, {
  form_values: {
    animal_name: 'Falcon',
    animal_tags: {
      choices: [
        { value: 'fast', label: 'Fast' },
        { value: 'calm', label: 'Calm' },
      ],
      other: [{ value: 'custom-tag', label: 'Custom Tag' }],
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
