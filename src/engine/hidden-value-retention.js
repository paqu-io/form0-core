/** Container ancestry is separate from each field's local visibility. */
export function createVisibilityChains(elements, chains = new Map(), ancestors = []) {
  for (const field of elements || []) {
    chains.set(field.data_name, ancestors);
    if (
      field.elements &&
      ['Section', 'RepeatableSection', 'BuildingPlanSection'].includes(field.type)
    )
      createVisibilityChains(field.elements, chains, [...ancestors, field.data_name]);
  }
  return chains;
}

export function isEffectivelyVisible(field, visible, chains) {
  return (
    visible?.[field.data_name] !== false &&
    (chains.get(field.data_name) || []).every((name) => visible?.[name] !== false)
  );
}

/** Collect before applying: one round must not depend on field declaration order. */
export function collectHiddenFieldClears({
  fields,
  values,
  visible,
  chains,
  participating = true,
  instancePath = [],
}) {
  const clearedFields = fields
    .filter(
      (field) =>
        field.visible_preserve_value === false &&
        Object.hasOwn(values, field.data_name) &&
        values[field.data_name] != null &&
        (!participating || !isEffectivelyVisible(field, visible, chains))
    )
    .map((field) => ({
      instancePath,
      fieldName: field.data_name,
      fieldKey: field.key || field.data_name,
    }));
  return clearedFields;
}

export function retentionFailure() {
  return Object.assign(new Error('Hidden-value retention did not settle.'), {
    code: 'hidden_value_retention_failed',
  });
}

export function clearHiddenFieldValues(options) {
  const fields = collectHiddenFieldClears(options);
  for (const field of fields) options.values[field.fieldName] = null;
  return fields;
}
