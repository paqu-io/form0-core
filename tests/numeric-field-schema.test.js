import assert from 'node:assert/strict';

import { validateSchema } from '../src/index.js';

function createNumericField(bounds) {
  return {
    type: 'NumericField',
    key: 'numeric-field',
    data_name: 'numeric_field',
    label: 'Numeric field',
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
    format: 'integer',
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
    ...bounds,
  };
}

function validateNumericField(bounds) {
  validateSchema({ elements: [createNumericField(bounds)] });
}

assert.doesNotThrow(
  () => validateNumericField({ min: 1, max: null }),
  'A NumericField may have a minimum without a maximum'
);
assert.doesNotThrow(
  () => validateNumericField({ min: null, max: -1 }),
  'A NumericField may have a maximum without a minimum'
);
assert.doesNotThrow(
  () => validateNumericField({ min: null, max: null }),
  'A NumericField may leave both bounds unset'
);
assert.throws(
  () => validateNumericField({ min: 2, max: 1 }),
  /NumericField "numeric_field" has min > max/,
  'A NumericField must still reject an inverted numeric range'
);

console.log('✅ NumericField schema bounds validation tests passed');
