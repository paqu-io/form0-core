function normalizeToStringArray(value) {
  if (value == null) {
    return [];
  }

  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function getFormAIMetadata(form) {
  if (!form || typeof form !== 'object') {
    return null;
  }
  return form.ai ?? null;
}

export function getFormAIContext(form) {
  return normalizeToStringArray(getFormAIMetadata(form)?.context);
}

export function getFormAIInstructions(form) {
  return normalizeToStringArray(getFormAIMetadata(form)?.instructions);
}

export function getFormAITasks(form) {
  return normalizeToStringArray(getFormAIMetadata(form)?.tasks);
}

export function getFormAINamingPolicy(form) {
  const metadata = getFormAIMetadata(form);
  if (!metadata || typeof metadata.namingPolicy !== 'object' || Array.isArray(metadata.namingPolicy)) {
    return null;
  }
  return metadata.namingPolicy;
}

export function getFieldAIMetadata(field) {
  if (!field || typeof field !== 'object') {
    return null;
  }
  return field.ai ?? null;
}

export function getFieldAIContext(field) {
  return normalizeToStringArray(getFieldAIMetadata(field)?.context);
}

export function getFieldAIInstructions(field) {
  return normalizeToStringArray(getFieldAIMetadata(field)?.instructions);
}

export function getFieldAIExamples(field) {
  return normalizeToStringArray(getFieldAIMetadata(field)?.examples);
}

export function getFieldAISynonyms(field) {
  return normalizeToStringArray(getFieldAIMetadata(field)?.synonyms);
}

export function getFieldAITasks(field) {
  return normalizeToStringArray(getFieldAIMetadata(field)?.tasks);
}

export function isFieldAIInferrable(field) {
  const metadata = getFieldAIMetadata(field);
  return metadata != null && metadata.inferrable === true;
}

export function getFieldAIChoicePolicy(field) {
  const metadata = getFieldAIMetadata(field);
  if (!metadata || typeof metadata.choicePolicy !== 'object' || Array.isArray(metadata.choicePolicy)) {
    return null;
  }
  return metadata.choicePolicy;
}

export function getFieldAIProviderHints(field) {
  const metadata = getFieldAIMetadata(field);
  if (!metadata || typeof metadata.providerHints !== 'object' || Array.isArray(metadata.providerHints)) {
    return null;
  }
  return metadata.providerHints;
}
