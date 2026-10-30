/**
 * @typedef {Object} SubmissionFinding
 * @property {'required'|'error'|'custom'} kind
 * @property {string} message
 * @property {Object[]} instancePath Complete row ancestry; [] for root.
 * @property {string} [fieldName] Absent for scope-level custom findings.
 * @property {string} [fieldKey]
 *
 * @typedef {Object} SubmissionValidationSummary
 * @property {boolean} hasErrors
 * @property {SubmissionFinding[]} requiredFieldErrors
 * @property {SubmissionFinding[]} generalErrors
 * @property {SubmissionFinding[]} scopeIssues
 * @property {SubmissionFinding[]} orderedIssues
 */

import { prepareRecordContext, visitRecordScopes } from './record-context.js';

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const hasChoice = (entries) =>
  Array.isArray(entries) &&
  entries.some(
    (entry) => entry && ((entry.value != null && entry.value !== '') || hasText(entry.label))
  );
const hasOther = (entries) =>
  Array.isArray(entries) &&
  entries.some((entry) =>
    typeof entry === 'string'
      ? hasText(entry)
      : entry && (hasText(entry.label) || (entry.value != null && entry.value !== ''))
  );

/** Type-aware input emptiness shared with submission participation; zero/false are values. */
export function isFieldValueEmpty(field, value) {
  if (!field || value == null) return true;
  switch (field.type) {
    case 'TextField':
    case 'CalculatedField':
    case 'DateField':
    case 'TimeField':
    case 'TitleField':
    case 'StatusField':
      return typeof value === 'string' && !value.trim();
    case 'NumericField':
      return typeof value === 'number' ? false : typeof value === 'string' ? !value.trim() : true;
    case 'SingleChoiceField':
    case 'BooleanField':
      return !hasChoice(value.choice) && !hasOther(value.other);
    case 'MultiChoiceField':
      return !hasChoice(value.choices) && !hasOther(value.other);
    case 'PhotoField':
    case 'VideoField':
      return !Array.isArray(value) || value.length === 0;
    case 'SignatureField':
      return typeof value === 'string'
        ? !value.trim()
        : !(hasText(value?.data) || hasText(value?.url));
    default:
      return Array.isArray(value)
        ? value.length === 0
        : typeof value === 'object'
          ? Object.keys(value).length === 0
          : false;
  }
}

export function validateScope(scope, { validateHiddenValues = false } = {}) {
  const findings = [];
  if (!scope.participating && !validateHiddenValues) return findings;
  const { record, template, instancePath } = scope;
  for (const field of template.fields) {
    if (['Section', 'BuildingPlanSection', 'RepeatableSection', 'LabelField'].includes(field.type))
      continue;
    const hidden =
      !scope.participating ||
      record.visible?.[field.data_name] === false ||
      !(template.chains.get(field.data_name) || []).every(
        (name) => record.visible?.[name] !== false
      );
    if (hidden && !validateHiddenValues) continue;
    const message = record.errors?.[field.data_name];
    const required = record.required?.[field.data_name] ?? field.required;
    const base = {
      fieldName: field.data_name,
      fieldKey: field.key || field.data_name,
      instancePath,
    };
    if (message) findings.push({ ...base, kind: 'error', message });
    else if (!hidden && required && isFieldValueEmpty(field, record.values?.[field.data_name]))
      findings.push({ ...base, kind: 'required', message: 'This field is required' });
  }
  return findings;
}

export function validateSubmissionWithContext(snapshot, context, customIssues = [], options = {}) {
  if (
    options.validateHiddenValues !== undefined &&
    typeof options.validateHiddenValues !== 'boolean'
  )
    throw new TypeError('validateHiddenValues must be a boolean.');
  const orderedIssues = [];
  const issuesByScope = new Map();
  for (const custom of customIssues) {
    const key = JSON.stringify(custom.instancePath || []);
    if (!issuesByScope.has(key)) issuesByScope.set(key, []);
    issuesByScope.get(key).push(custom);
  }
  visitRecordScopes(snapshot, context, (scope) => {
    orderedIssues.push(...validateScope(scope, options));
    if (scope.participating)
      for (const custom of issuesByScope.get(JSON.stringify(scope.instancePath)) || [])
        orderedIssues.push({ ...custom, instancePath: scope.instancePath, kind: 'custom' });
  });
  return summarizeSubmissionFindings(orderedIssues);
}

/** Shared ordering/classification for a complete tree or a selected editor scope. */
export function summarizeSubmissionFindings(orderedIssues) {
  return {
    hasErrors: orderedIssues.length > 0,
    requiredFieldErrors: orderedIssues.filter((issue) => issue.kind === 'required'),
    generalErrors: orderedIssues.filter((issue) => issue.kind === 'error'),
    scopeIssues: orderedIssues.filter((issue) => issue.kind === 'custom'),
    orderedIssues,
  };
}

/**
 * Validate an already evaluated runtime record tree; never evaluates or mutates intrinsic errors.
 * @param {{schema: Object, snapshot: Object, validationIssues?: Object[], validateHiddenValues?: boolean}} options
 * @returns {SubmissionValidationSummary} Ordered field and scope findings; no freshness assertion.
 */
export function validateSubmission({
  schema,
  snapshot,
  validationIssues = [],
  validateHiddenValues = false,
}) {
  return validateSubmissionWithContext(snapshot, prepareRecordContext(schema), validationIssues, {
    validateHiddenValues,
  });
}
