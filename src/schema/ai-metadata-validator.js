const FORM_ALLOWED_KEYS = new Set([
  'context',
  'instructions',
  'namingPolicy',
  'tasks',
  'requiresConsent',
  'allowCloud',
]);

const FIELD_ALLOWED_KEYS = new Set([
  'context',
  'instructions',
  'examples',
  'synonyms',
  'tasks',
  'inferrable',
  'fillStrategy',
  'priority',
  'dependencies',
  'choicePolicy',
  'providerHints',
  'requiresConsent',
  'allowCloud',
]);

const NAMING_CASES = new Set(['camel', 'snake', 'kebab']);
const CHOICE_VALUE_STRATEGIES = new Set(['slug', 'transliterate', 'llm']);
const CHOICE_CASES = new Set(['upper', 'lower', 'kebab', 'snake']);
const FILL_STRATEGIES = new Set(['infer_from_previous', 'require_explicit', 'suggest_options']);

function ensureObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => isString(item));
}

function isOptionalBoolean(value) {
  return value === undefined || typeof value === 'boolean';
}

function validateStringOrStringArray(name, value, errors, prefix) {
  if (value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    if (!isString(value)) {
      errors.push(`${prefix}${name} must be a non-empty string`);
    }
    return;
  }
  if (!isStringArray(value)) {
    errors.push(`${prefix}${name} must be a string or array of non-empty strings`);
  }
}

function validateStringArray(name, value, errors, prefix) {
  if (value === undefined) {
    return;
  }
  if (!isStringArray(value)) {
    errors.push(`${prefix}${name} must be an array of non-empty strings`);
  }
}

function validateTasks(tasks, errors, prefix) {
  validateStringArray('tasks', tasks, errors, prefix);
}

function validateNamingPolicy(policy, errors, prefix) {
  if (policy === undefined || policy === null) {
    return;
  }

  if (!ensureObject(policy)) {
    errors.push(`${prefix}namingPolicy must be an object`);
    return;
  }

  for (const key of Object.keys(policy)) {
    if (!['language', 'case', 'separator', 'maxLength', 'asciiOnly'].includes(key)) {
      errors.push(`${prefix}namingPolicy.${key} is not supported`);
    }
  }

  if (policy.language !== undefined && !isString(policy.language)) {
    errors.push(`${prefix}namingPolicy.language must be a non-empty string`);
  }

  if (policy.case !== undefined && !NAMING_CASES.has(policy.case)) {
    errors.push(
      `${prefix}namingPolicy.case must be one of: ${Array.from(NAMING_CASES).join(', ')}`
    );
  }

  if (policy.separator !== undefined && !isString(policy.separator)) {
    errors.push(`${prefix}namingPolicy.separator must be a non-empty string`);
  }

  if (policy.maxLength !== undefined) {
    if (
      typeof policy.maxLength !== 'number' ||
      !Number.isInteger(policy.maxLength) ||
      policy.maxLength <= 0
    ) {
      errors.push(`${prefix}namingPolicy.maxLength must be a positive integer`);
    }
  }

  if (policy.asciiOnly !== undefined && typeof policy.asciiOnly !== 'boolean') {
    errors.push(`${prefix}namingPolicy.asciiOnly must be a boolean`);
  }
}

function validateChoicePolicy(policy, errors, prefix) {
  if (policy === undefined || policy === null) {
    return;
  }

  if (!ensureObject(policy)) {
    errors.push(`${prefix}choicePolicy must be an object`);
    return;
  }

  for (const key of Object.keys(policy)) {
    if (!['valueFromLabel', 'language', 'case', 'allowUnicode'].includes(key)) {
      errors.push(`${prefix}choicePolicy.${key} is not supported`);
    }
  }

  if (policy.valueFromLabel !== undefined && !CHOICE_VALUE_STRATEGIES.has(policy.valueFromLabel)) {
    errors.push(
      `${prefix}choicePolicy.valueFromLabel must be one of: ${Array.from(CHOICE_VALUE_STRATEGIES).join(', ')}`
    );
  }

  if (policy.language !== undefined && !isString(policy.language)) {
    errors.push(`${prefix}choicePolicy.language must be a non-empty string`);
  }

  if (policy.case !== undefined && !CHOICE_CASES.has(policy.case)) {
    errors.push(
      `${prefix}choicePolicy.case must be one of: ${Array.from(CHOICE_CASES).join(', ')}`
    );
  }

  if (policy.allowUnicode !== undefined && typeof policy.allowUnicode !== 'boolean') {
    errors.push(`${prefix}choicePolicy.allowUnicode must be a boolean`);
  }
}

function validateProviderHints(hints, errors, prefix) {
  if (hints === undefined || hints === null) {
    return;
  }

  if (!ensureObject(hints)) {
    errors.push(`${prefix}providerHints must be an object`);
    return;
  }

  for (const [key, value] of Object.entries(hints)) {
    if (!isString(key)) {
      errors.push(`${prefix}providerHints keys must be non-empty strings`);
      break;
    }
    if (
      !['string', 'number', 'boolean'].includes(typeof value) ||
      (typeof value === 'number' && Number.isNaN(value))
    ) {
      errors.push(
        `${prefix}providerHints["${key}"] must be a string, number (non-NaN), or boolean`
      );
    }
  }
}

function validateDependencies(dependencies, errors, prefix) {
  if (dependencies === undefined) {
    return;
  }
  validateStringArray('dependencies', dependencies, errors, prefix);
}

function validatePriority(priority, errors, prefix) {
  if (priority === undefined) {
    return;
  }

  if (typeof priority !== 'number' || Number.isNaN(priority)) {
    errors.push(`${prefix}priority must be a number`);
  }
}

function validateFillStrategy(strategy, errors, prefix) {
  if (strategy === undefined) {
    return;
  }

  if (typeof strategy !== 'string' || strategy.trim() === '') {
    errors.push(`${prefix}fillStrategy must be a non-empty string`);
    return;
  }

  if (!FILL_STRATEGIES.has(strategy)) {
    errors.push(
      `${prefix}fillStrategy must be one of: ${Array.from(FILL_STRATEGIES).join(', ')}`
    );
  }
}

export function validateFormAIMetadata(form) {
  const errors = [];
  const { ai } = form;

  if (ai === undefined || ai === null) {
    return { isValid: true, errors };
  }

  if (!ensureObject(ai)) {
    errors.push('form.ai must be an object');
    return { isValid: false, errors };
  }

  for (const key of Object.keys(ai)) {
    if (!FORM_ALLOWED_KEYS.has(key)) {
      errors.push(`form.ai.${key} is not supported`);
    }
  }

  validateStringOrStringArray('context', ai.context, errors, 'form.ai.');
  validateStringArray('instructions', ai.instructions, errors, 'form.ai.');
  validateTasks(ai.tasks, errors, 'form.ai.');
  validateNamingPolicy(ai.namingPolicy, errors, 'form.ai.');

  if (!isOptionalBoolean(ai.requiresConsent)) {
    errors.push('form.ai.requiresConsent must be a boolean when provided');
  }

  if (!isOptionalBoolean(ai.allowCloud)) {
    errors.push('form.ai.allowCloud must be a boolean when provided');
  }

  return { isValid: errors.length === 0, errors };
}

export function validateFieldAIMetadata(field) {
  const errors = [];
  const ai = field.ai;

  if (ai === undefined || ai === null) {
    return { isValid: true, errors };
  }

  if (!ensureObject(ai)) {
    return { isValid: false, errors: [`Field "${field.data_name}": ai must be an object`] };
  }

  for (const key of Object.keys(ai)) {
    if (!FIELD_ALLOWED_KEYS.has(key)) {
      errors.push(`Field "${field.data_name}": ai.${key} is not supported`);
    }
  }

  validateStringOrStringArray('context', ai.context, errors, `Field "${field.data_name}" ai.`);
  validateStringArray('instructions', ai.instructions, errors, `Field "${field.data_name}" ai.`);
  validateStringArray('examples', ai.examples, errors, `Field "${field.data_name}" ai.`);
  validateStringArray('synonyms', ai.synonyms, errors, `Field "${field.data_name}" ai.`);
  validateTasks(ai.tasks, errors, `Field "${field.data_name}" ai.`);
  validateChoicePolicy(ai.choicePolicy, errors, `Field "${field.data_name}" ai.`);
  validateProviderHints(ai.providerHints, errors, `Field "${field.data_name}" ai.`);
  validateDependencies(ai.dependencies, errors, `Field "${field.data_name}" ai.`);
  validatePriority(ai.priority, errors, `Field "${field.data_name}" ai.`);
  validateFillStrategy(ai.fillStrategy, errors, `Field "${field.data_name}" ai.`);

  if (!isOptionalBoolean(ai.inferrable)) {
    errors.push(`Field "${field.data_name}" ai.inferrable must be a boolean when provided`);
  }

  if (!isOptionalBoolean(ai.requiresConsent)) {
    errors.push(`Field "${field.data_name}" ai.requiresConsent must be a boolean when provided`);
  }

  if (!isOptionalBoolean(ai.allowCloud)) {
    errors.push(`Field "${field.data_name}" ai.allowCloud must be a boolean when provided`);
  }

  return { isValid: errors.length === 0, errors };
}
