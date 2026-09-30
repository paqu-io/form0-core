import assert from 'node:assert/strict';

import { createFormEngine } from '../src/index.js';
import { evaluateConditions } from '../src/engine/conditions.js';

const commonInputAttributes = {
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
  supporting_image: false,
  supporting_image_path: null,
  supporting_image_display: null,
};

const textField = (key, dataName, overrides = {}) => ({
  ...commonInputAttributes,
  type: 'TextField',
  key,
  data_name: dataName,
  label: dataName,
  pattern: null,
  pattern_description: null,
  ...overrides,
});

const singleChoiceField = (key, dataName, overrides = {}) => ({
  ...commonInputAttributes,
  type: 'SingleChoiceField',
  key,
  data_name: dataName,
  label: dataName,
  allow_other: false,
  is_searchable: false,
  is_searchable_mode: null,
  choices: [
    { value: 'us', label: 'United States' },
    { value: 'fr', label: 'France' },
  ],
  ...overrides,
});

const countryCondition = {
  field_id: 'country-key',
  operator: 'equal_to',
  value: 'us',
};

const schema = {
  form: {
    name: 'Choice condition regression',
    elements: [
      singleChoiceField('country-key', 'country', { default_value: 'us' }),
      textField('visible-key', 'visible_for_us', {
        visible: false,
        visible_conditions: countryCondition,
      }),
      textField('required-key', 'required_for_us', {
        required_conditions: countryCondition,
      }),
      textField('read-only-key', 'read_only_for_us', {
        read_only_conditions: countryCondition,
      }),
    ],
  },
};

const engine = createFormEngine({ schema });
engine.eval();

const initialState = engine.getState();
assert.deepEqual(initialState.values.country, {
  choice: [{ value: 'us', label: 'United States' }],
  other: [],
});
assert.equal(
  initialState.visible.visible_for_us,
  true,
  'SingleChoice equal_to should evaluate the selected choice value for visibility'
);
assert.equal(
  initialState.required.required_for_us,
  true,
  'SingleChoice equal_to should evaluate the selected choice value for requiredness'
);
assert.equal(
  initialState.read_only.read_only_for_us,
  true,
  'SingleChoice equal_to should evaluate the selected choice value for read-only state'
);

initialState.values.country = {
  choice: [{ value: 'fr', label: 'France' }],
  other: [],
};
engine.eval();

const updatedState = engine.getState();
assert.equal(updatedState.visible.visible_for_us, false);
assert.equal(updatedState.required.required_for_us, false);
assert.equal(updatedState.read_only.read_only_for_us, false);

const choiceFields = {
  approved: { type: 'BooleanField', data_name: 'approved' },
  tags: { type: 'MultiChoiceField', data_name: 'tags' },
};
const choiceValues = {
  approved: { choice: [{ value: 'yes', label: 'Yes' }], other: [] },
  tags: {
    choices: [
      { value: 'red', label: 'Red' },
      { value: 'blue', label: 'Blue' },
    ],
    other: [],
  },
};

assert.equal(
  evaluateConditions(
    { field_id: 'approved', operator: 'equal_to', value: 'yes' },
    choiceValues,
    choiceFields
  ),
  true,
  'BooleanField conditions should compare the selected choice value'
);
assert.equal(
  evaluateConditions(
    { field_id: 'tags', operator: 'contains', value: 'red' },
    choiceValues,
    choiceFields
  ),
  true,
  'MultiChoice contains should inspect selected choice values'
);
assert.equal(
  evaluateConditions(
    { field_id: 'tags', operator: 'equal_to', value: ['blue', 'red'] },
    choiceValues,
    choiceFields
  ),
  true,
  'MultiChoice equality should compare the selected value set without depending on order'
);
assert.equal(
  evaluateConditions(
    { field_id: 'tags', operator: 'is_empty' },
    { tags: { choices: [], other: [] } },
    choiceFields
  ),
  true,
  'an empty MultiChoice value should satisfy is_empty'
);
assert.equal(
  evaluateConditions(
    { field_id: 'tags', operator: 'is_not_empty' },
    { tags: { choices: [], other: [{ label: 'Custom' }] } },
    choiceFields
  ),
  true,
  'a MultiChoice other value should satisfy is_not_empty'
);

console.log('condition tests passed');
