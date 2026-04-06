import assert from 'node:assert/strict';
import {
  FIELD_SPECS,
  validateFieldValue,
  validateRecordFieldValue,
  getRecordFieldValueValidator,
} from '../src/index.js';

const createSingleChoiceField = ({
  data_name,
  allow_other = false,
  choices = [],
}) => ({
  type: 'SingleChoiceField',
  data_name,
  allow_other,
  choices,
});

const createMultiChoiceField = ({
  data_name,
  allow_other = false,
  choices = [],
}) => ({
  type: 'MultiChoiceField',
  data_name,
  allow_other,
  choices,
});

const createBooleanField = ({ data_name, choices = [] }) => ({
  type: 'BooleanField',
  data_name,
  choices,
  third_option_enabled: false,
});

(() => {
  assert.equal(
    typeof FIELD_SPECS.SingleChoiceField.recordValueValidator,
    'function',
    'SingleChoiceField should expose a recordValueValidator'
  );
  assert.equal(
    typeof FIELD_SPECS.MultiChoiceField.recordValueValidator,
    'function',
    'MultiChoiceField should expose a recordValueValidator'
  );
  assert.equal(
    typeof FIELD_SPECS.BooleanField.recordValueValidator,
    'function',
    'BooleanField should expose a recordValueValidator'
  );
})();

(() => {
  const field = createSingleChoiceField({
    data_name: 'fruit',
    allow_other: true,
    choices: [
      { value: 'banana', label: 'Banana' },
      { value: 'orange', label: 'Orange' },
    ],
  });

  assert.equal(
    validateFieldValue(field, {
      choice: [{ value: 'banana', label: 'Banana' }],
      other: [{ label: 'Dragonfruit' }],
    }),
    null,
    'live validation should continue accepting renderer choice shape'
  );

  assert.equal(
    validateRecordFieldValue(field, {
      choice_value: [{ value: 'banana', label: 'Banana' }],
      other_value: [{ label: 'Dragonfruit' }],
    }),
    null,
    'record validation should accept canonical stored single choice shape'
  );

  assert.match(
    validateRecordFieldValue(field, {
      choice: [{ value: 'banana', label: 'Banana' }],
      other: [],
    }),
    /must not use renderer keys/,
    'record validation should reject renderer aliases for single choice fields'
  );
})();

(() => {
  const field = createMultiChoiceField({
    data_name: 'toppings',
    allow_other: true,
    choices: [
      { value: 'nuts', label: 'Nuts' },
      { value: 'honey', label: 'Honey' },
    ],
  });

  assert.equal(
    validateRecordFieldValue(field, {
      choices_value: [{ value: 'nuts', label: 'Nuts' }],
      other_value: [{ label: 'Sesame' }],
    }),
    null,
    'record validation should accept canonical stored multi choice shape'
  );

  assert.match(
    validateRecordFieldValue(field, {
      choice_value: [{ value: 'nuts', label: 'Nuts' }],
      other_value: [],
    }),
    /must use "choices_value" instead of "choice_value"/,
    'record validation should reject the wrong canonical selection key for multi choice fields'
  );
})();

(() => {
  const field = createBooleanField({
    data_name: 'approved',
    choices: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ],
  });

  assert.equal(
    validateRecordFieldValue(field, {
      choice_value: [{ value: 'yes', label: 'Yes' }],
      other_value: [],
    }),
    null,
    'record validation should accept canonical stored boolean shape'
  );

  assert.match(
    validateRecordFieldValue(field, {
      choice_value: [{ value: 'yes', label: 'Yes' }],
      other_value: [{ label: 'Maybe' }],
    }),
    /does not support/,
    'record validation should keep boolean other_value forbidden'
  );
})();

(() => {
  const validator = getRecordFieldValueValidator('TextField');
  assert.equal(
    typeof validator,
    'function',
    'record validator lookup should fall back to the live validator for non-choice fields'
  );
})();

console.log('field-value-registry tests passed');
