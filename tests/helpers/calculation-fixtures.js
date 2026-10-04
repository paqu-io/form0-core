export const commonInputAttributes = {
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

export function numericField(dataName, overrides = {}) {
  return {
    ...commonInputAttributes,
    type: 'NumericField',
    key: dataName,
    data_name: dataName,
    label: dataName,
    min: null,
    max: null,
    format: 'integer',
    ...overrides,
  };
}

export function textField(dataName, overrides = {}) {
  return {
    ...commonInputAttributes,
    type: 'TextField',
    key: dataName,
    data_name: dataName,
    label: dataName,
    pattern: null,
    pattern_description: null,
    ...overrides,
  };
}

export function calculatedField(dataName, calculate, overrides = {}) {
  const { required_conditions, read_only_conditions, default_value, ...attributes } =
    commonInputAttributes;
  return {
    ...attributes,
    type: 'CalculatedField',
    key: dataName,
    data_name: dataName,
    label: dataName,
    display: { style: 'numeric' },
    read_only: true,
    calculate,
    ...overrides,
  };
}

export function repeatableSection(dataName, elements) {
  return {
    type: 'RepeatableSection',
    key: dataName,
    data_name: dataName,
    label: dataName,
    display: 'drilldown',
    description: null,
    description_mode: null,
    visible: true,
    visible_conditions: null,
    location_enabled: false,
    location_required: false,
    elements,
  };
}

export function formSchema(elements, overrides = {}) {
  return { form: { name: 'Calculation diagnostic tests', elements, ...overrides } };
}

export function captureConsole(run) {
  const original = {
    log: console.log,
    warn: console.warn,
    info: console.info,
    error: console.error,
  };
  const calls = [];
  for (const method of Object.keys(original)) {
    console[method] = (...args) => calls.push({ method, args });
  }
  try {
    return { result: run(), calls };
  } finally {
    Object.assign(console, original);
  }
}
