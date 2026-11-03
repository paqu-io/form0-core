/** Read compiler-owned BuildingPlan descriptors without introducing field attributes. */
export function getBuildingPlanMetadata(schema) {
  const result = [];
  function visit(elements) {
    for (const field of elements || []) {
      if (field.type === 'BuildingPlanSection' && field.building_plan?.meta?.version === 1)
        result.push(field.building_plan.meta);
      else if (field.elements) visit(field.elements);
    }
  }
  visit(schema?.form?.elements || schema?.elements);
  return result;
}

export function getBuildingPlanProjectionNames(schema) {
  const fields = new Set();
  const repeatables = new Set();
  for (const meta of getBuildingPlanMetadata(schema)) {
    for (const entry of meta.repeatables) {
      if (entry.role === 'projection') repeatables.add(entry.preferredKey);
      for (const field of entry.fields || [])
        if (['projection', 'derived'].includes(field.binding?.role)) fields.add(field.dataName);
    }
  }
  return { fields, repeatables };
}

export function getBuildingPlanFieldBinding(meta, dataName) {
  return meta?.fieldBindings?.[dataName] || null;
}

/**
 * Keep canonical storage out of row editors and navigation, without changing
 * engine visibility, validation, or serialization. Observation editors are opt-in.
 */
export function isBuildingPlanInternalCollection(meta, dataName) {
  if (meta?.version !== 1) return false;
  const node = meta.repeatables.find((entry) => entry.dataName === dataName);
  if (!node) return false;
  if (['physical_walls', 'observations'].includes(node.role)) return true;
  return (
    node.sourceNode === 'observations' &&
    !(node.fields || []).some((field) => field.binding?.storageRole !== 'storage')
  );
}
