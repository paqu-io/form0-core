import assert from 'node:assert/strict';

import {
  buildDatasetDescriptors,
  createStructuredRecord,
  flattenFields,
  normalizeStructuredRecord,
  resolveDatasetRowTitle,
  validateSchema,
} from '../src/index.js';

const titleField = (elements) => ({
  type: 'TitleField',
  key: '@title',
  data_name: 'title',
  label: 'Title',
  display: 'default',
  enabled: true,
  visible: true,
  visible_conditions: null,
  read_only: true,
  read_only_conditions: null,
  elements,
});

const textField = (key, dataName) => ({
  type: 'TextField',
  key,
  data_name: dataName,
  label: dataName,
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
});

const choiceField = (key, dataName) => ({
  type: 'SingleChoiceField',
  key,
  data_name: dataName,
  label: dataName,
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
  allow_other: true,
  choices: [{ value: 'lead', label: 'Lead' }],
  supporting_image: false,
  supporting_image_path: null,
  supporting_image_display: null,
  is_searchable: true,
  is_searchable_mode: 'default',
});

const section = (key, elements) => ({
  type: 'Section',
  key,
  data_name: key,
  label: key,
  display: 'inline',
  description: null,
  description_mode: null,
  visible: true,
  visible_conditions: null,
  elements,
});

const repeatable = (key, elements, title = null) => ({
  type: 'RepeatableSection',
  key,
  data_name: key,
  label: key,
  display: 'drilldown',
  description: null,
  description_mode: null,
  visible: true,
  visible_conditions: null,
  location_enabled: false,
  location_required: false,
  title_field: title,
  elements,
});

const schema = {
  form: {
    title_field: titleField(['site_key']),
    elements: [
      textField('site_key', 'site'),
      repeatable(
        'people_key',
        [
          section('identity_section', [textField('person_name_key', 'person_name')]),
          choiceField('person_role_key', 'person_role'),
          repeatable(
            'tasks_key',
            [textField('task_name_key', 'task_name')],
            titleField(['task_name_key'])
          ),
        ],
        titleField(['person_name_key', 'person_role_key'])
      ),
    ],
  },
};

validateSchema(schema.form);

const descriptors = buildDatasetDescriptors(schema);
const rootDescriptor = descriptors.find((descriptor) => descriptor.kind === 'root');
const peopleDescriptor = descriptors.find(
  (descriptor) => descriptor.repeatable_field_id === 'people_key'
);

assert.equal(resolveDatasetRowTitle(rootDescriptor, { site: 'HQ' }), 'HQ');
assert.equal(
  resolveDatasetRowTitle(peopleDescriptor, {
    person_name: 'Ada',
    person_role: { choice: [{ value: 'lead', label: 'Old label' }], other: [] },
  }),
  'Ada, Lead'
);
assert.equal(resolveDatasetRowTitle(peopleDescriptor, { person_name: '  ' }), null);

const invalidRootScope = structuredClone(schema);
invalidRootScope.form.title_field = titleField(['person_name_key']);
assert.throws(() => validateSchema(invalidRootScope.form), /outside its record scope/);

const invalidNestedScope = structuredClone(schema);
invalidNestedScope.form.elements[1].title_field = titleField(['task_name_key']);
assert.throws(() => validateSchema(invalidNestedScope.form), /outside its record scope/);

const record = createStructuredRecord(
  {
    values: { site: 'HQ' },
    repeatable: {
      people_key: [
        {
          id: 'person-1',
          values: {
            person_name: 'Ada',
            person_role: { choice: [{ value: 'lead', label: 'Old label' }], other: [] },
          },
          repeatable: {
            tasks_key: [{ id: 'task-1', values: { task_name: 'Survey' }, repeatable: {} }],
          },
        },
      ],
    },
  },
  flattenFields(schema.form.elements),
  {
    fieldKeyMode: 'data-name',
    originalElements: schema.form.elements,
    title_field: schema.form.title_field,
  }
);

assert.equal(record['@title'], 'HQ');
assert.equal(record.form_values.people_key[0]['@title'], 'Ada, Lead');
assert.equal(record.form_values.people_key[0].form_values.tasks_key[0]['@title'], 'Survey');

record.form_values.people_key[0]['@title'] = 'Stale';
record.form_values.people_key[0].form_values.person_role.choice_value[0].label = 'Stale';
const normalized = normalizeStructuredRecord(schema, record);
assert.equal(normalized.form_values.people_key[0]['@title'], 'Ada, Lead');
assert.equal(
  normalized.form_values.people_key[0].form_values.person_role.choice_value[0].label,
  'Lead'
);

const normalizedChild = normalizeStructuredRecord(schema, record.form_values.people_key[0], {
  datasetId: peopleDescriptor.id,
});
assert.equal(normalizedChild['@title'], 'Ada, Lead');

console.log('title field tests passed');
