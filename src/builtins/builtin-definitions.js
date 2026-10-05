import { BUILTIN_CONTEXTS, defineBuiltinMetadata } from './builtin-metadata.js';

// Authoritative builtin metadata. Keep this catalog independent of implementations
// so security validation can inspect names and contexts without loading EVAL().

export const IF_METADATA = defineBuiltinMetadata({
  name: 'IF',
  category: 'logical',
  signature: 'IF(condition, trueValue, falseValue)',
  description: 'Return one of two values based on a condition.',
  examples: [
    'IF($age >= 18, "adult", "minor")',
    'IF($country === "US", IF($state === "CA", 8.99, 5.99), 15.99)',
  ],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const AND_METADATA = defineBuiltinMetadata({
  name: 'AND',
  category: 'logical',
  signature: 'AND(...conditions)',
  description: 'Return true only when all arguments are truthy.',
  examples: ['AND($age >= 18, $country === "it")'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const OR_METADATA = defineBuiltinMetadata({
  name: 'OR',
  category: 'logical',
  signature: 'OR(...conditions)',
  description: 'Return true when at least one argument is truthy.',
  examples: ['OR($email, $phone)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const COUNT_METADATA = defineBuiltinMetadata({
  name: 'COUNT',
  category: 'logical',
  signature: 'COUNT(values)',
  description: 'Count numeric values.',
  examples: ['COUNT(ARRAY($score_1, $score_2, $score_3))'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const COUNTA_METADATA = defineBuiltinMetadata({
  name: 'COUNTA',
  category: 'logical',
  signature: 'COUNTA(values)',
  description: 'Count non-empty values.',
  examples: ['COUNTA(ARRAY($first_name, $last_name, $email))'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const COUNTBLANK_METADATA = defineBuiltinMetadata({
  name: 'COUNTBLANK',
  category: 'logical',
  signature: 'COUNTBLANK(values)',
  description: 'Count blank values.',
  examples: ['COUNTBLANK(ARRAY($first_name, $last_name, $email))'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const ARRAY_METADATA = defineBuiltinMetadata({
  name: 'ARRAY',
  category: 'logical',
  signature: 'ARRAY(...values)',
  description: 'Build an array from individual arguments.',
  examples: ['ARRAY($city, $country)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const EVAL_METADATA = defineBuiltinMetadata({
  name: 'EVAL',
  category: 'control',
  signature: 'EVAL(expression)',
  description: 'Evaluate a dynamically built expression string in a restricted context.',
  examples: ['EVAL("$" + dynamicFieldName)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const CHOICEVALUE_METADATA = defineBuiltinMetadata({
  name: 'CHOICEVALUE',
  category: 'choice',
  signature: 'CHOICEVALUE(fieldValue)',
  description: 'Return the selected choice value from a choice field.',
  examples: [
    'CHOICEVALUE($city)',
    'IF(CHOICEVALUE($city) === "bogota", "Welcome to Bogota!", "Welcome!")',
  ],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const CHOICELABEL_METADATA = defineBuiltinMetadata({
  name: 'CHOICELABEL',
  category: 'choice',
  signature: 'CHOICELABEL(fieldValue)',
  description: 'Return the selected choice label from a choice field.',
  examples: ['CHOICELABEL($city)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const HASOTHER_METADATA = defineBuiltinMetadata({
  name: 'HASOTHER',
  category: 'choice',
  signature: 'HASOTHER(fieldValue)',
  description: 'Return true when the field has an "other" value.',
  examples: ['HASOTHER($city)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const OTHER_METADATA = defineBuiltinMetadata({
  name: 'OTHER',
  category: 'choice',
  signature: 'OTHER(fieldValue)',
  description: 'Return the "other" label from a choice field.',
  examples: ['OTHER($city)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const CHOICEVALUES_METADATA = defineBuiltinMetadata({
  name: 'CHOICEVALUES',
  category: 'choice',
  signature: 'CHOICEVALUES(fieldValue)',
  description: 'Return all selected values from a MultiChoiceField.',
  examples: ['CHOICEVALUES($colors)', 'CHOICEVALUES($colors).includes("red")'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const CHOICELABELS_METADATA = defineBuiltinMetadata({
  name: 'CHOICELABELS',
  category: 'choice',
  signature: 'CHOICELABELS(fieldValue)',
  description: 'Return all selected labels from a MultiChoiceField.',
  examples: ['CHOICELABELS($colors)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const FORM_METADATA = defineBuiltinMetadata({
  name: 'FORM',
  category: 'schema',
  signature: 'FORM()',
  description: 'Access the form definition. Reserved for a future implementation.',
  examples: ['FORM()'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const DATANAMES_METADATA = defineBuiltinMetadata({
  name: 'DATANAMES',
  category: 'schema',
  signature: "DATANAMES(type = 'any')",
  description: 'Return form field data names, optionally filtered by field type.',
  examples: ["DATANAMES('NumericField')"],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const ABS_METADATA = defineBuiltinMetadata({
  name: 'ABS',
  category: 'math',
  signature: 'ABS(value)',
  description: 'Return the absolute value of a number.',
  examples: ['ABS($variance)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const CEILING_METADATA = defineBuiltinMetadata({
  name: 'CEILING',
  category: 'math',
  signature: 'CEILING(value, factor)',
  description: 'Round a number up to the nearest multiple.',
  examples: ['CEILING($amount, 5)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const COS_METADATA = defineBuiltinMetadata({
  name: 'COS',
  category: 'math',
  signature: 'COS(value)',
  description: 'Return the cosine of a value in radians.',
  examples: ['COS($angle_radians)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const SIN_METADATA = defineBuiltinMetadata({
  name: 'SIN',
  category: 'math',
  signature: 'SIN(value)',
  description: 'Return the sine of a value in radians.',
  examples: ['SIN($angle_radians)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const ROUND_METADATA = defineBuiltinMetadata({
  name: 'ROUND',
  category: 'math',
  signature: 'ROUND(value, places)',
  description: 'Round a number to a fixed number of decimal places.',
  examples: ['ROUND($total, 2)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const UPPER_METADATA = defineBuiltinMetadata({
  name: 'UPPER',
  category: 'string',
  signature: 'UPPER(value)',
  description: 'Convert a string to uppercase.',
  examples: ['UPPER($city_name)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION, BUILTIN_CONTEXTS.EVENT],
});

export const SETRESULT_METADATA = defineBuiltinMetadata({
  name: 'SETRESULT',
  category: 'control',
  signature: 'SETRESULT(value)',
  description: 'Set the final return value for multiline calculations.',
  examples: ['SETRESULT($price * $quantity)'],
  contexts: [BUILTIN_CONTEXTS.CALCULATION],
});

export const ALERT_METADATA = defineBuiltinMetadata({
  name: 'ALERT',
  category: 'event',
  signature: "ALERT(title, message = '')",
  description: 'Display an alert from a form event handler.',
  examples: ["ALERT('Saved', 'The record was saved successfully.')"],
  contexts: [BUILTIN_CONTEXTS.EVENT],
});

export const SETVALUE_METADATA = defineBuiltinMetadata({
  name: 'SETVALUE',
  category: 'event',
  signature: 'SETVALUE(fieldDataName, valueToSet)',
  description: 'Set a field value from a form event handler.',
  examples: ["SETVALUE('field_dataname', 'value_to_set')"],
  contexts: [BUILTIN_CONTEXTS.EVENT],
});

export const ON_METADATA = defineBuiltinMetadata({
  name: 'ON',
  category: 'event',
  signature: 'ON(eventType, fieldKeyOrCallback, callback)',
  description: 'Register an event handler within form event code.',
  examples: ["ON('change', 'city', function(event) { ALERT('City changed!'); })"],
  contexts: [BUILTIN_CONTEXTS.EVENT],
});

export const OFF_METADATA = defineBuiltinMetadata({
  name: 'OFF',
  category: 'event',
  signature: 'OFF(eventType, fieldKeyOrCallback, callback)',
  description: 'Remove event handlers within form event code.',
  examples: ["OFF('change', 'city', specificCallback)"],
  contexts: [BUILTIN_CONTEXTS.EVENT],
});

export const BUILTIN_DEFINITIONS = Object.freeze([
  IF_METADATA,
  AND_METADATA,
  OR_METADATA,
  COUNT_METADATA,
  COUNTA_METADATA,
  COUNTBLANK_METADATA,
  ARRAY_METADATA,
  EVAL_METADATA,
  CHOICEVALUE_METADATA,
  CHOICELABEL_METADATA,
  HASOTHER_METADATA,
  OTHER_METADATA,
  CHOICEVALUES_METADATA,
  CHOICELABELS_METADATA,
  FORM_METADATA,
  DATANAMES_METADATA,
  ABS_METADATA,
  CEILING_METADATA,
  COS_METADATA,
  SIN_METADATA,
  ROUND_METADATA,
  UPPER_METADATA,
  SETRESULT_METADATA,
  ALERT_METADATA,
  SETVALUE_METADATA,
  ON_METADATA,
  OFF_METADATA,
]);

function filterDefinitionsByContext(context) {
  return Object.freeze(
    BUILTIN_DEFINITIONS.filter((definition) => definition.contexts.includes(context))
  );
}

export const CALCULATION_BUILTIN_DEFINITIONS = filterDefinitionsByContext(
  BUILTIN_CONTEXTS.CALCULATION
);
export const EVENT_BUILTIN_DEFINITIONS = filterDefinitionsByContext(BUILTIN_CONTEXTS.EVENT);

export const BUILTIN_DEFINITION_BY_NAME = new Map(
  BUILTIN_DEFINITIONS.map((definition) => [definition.name, definition])
);
