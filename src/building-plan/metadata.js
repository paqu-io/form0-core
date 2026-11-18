/** Read compiler-owned BuildingPlan descriptors without introducing field attributes. */
export function getBuildingPlanMetadata(schema) {
  const result = [];
  function visit(elements) {
    for (const field of elements || []) {
      if (field.type === 'BuildingPlanSection' && field.building_plan?.meta?.version === 2)
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
  // Every plan row's repeatable: their titles are for display; stored records keep no title.
  const rows = new Set();
  for (const meta of getBuildingPlanMetadata(schema)) {
    for (const entry of meta.repeatables) {
      for (const key of [entry.preferredKey, entry.key, entry.dataName]) if (key) rows.add(key);
      if (entry.role === 'projection') repeatables.add(entry.preferredKey);
      const visit = (entries, projected = false) => {
        for (const field of entries || []) {
          const mirror = projected || field.binding?.role === 'projection';
          if (mirror && field.type === 'RepeatableSection') repeatables.add(field.preferredKey);
          else if (mirror || field.binding?.role === 'derived') fields.add(field.dataName);
          visit(field.children, mirror);
        }
      };
      visit(entry.fields);
    }
  }
  return { fields, repeatables, rows };
}

export function getBuildingPlanFieldBinding(meta, dataName) {
  return meta?.fieldBindings?.[dataName] || null;
}

/**
 * Keep canonical storage out of row editors and navigation, without changing
 * engine visibility, validation, or serialization.
 */
export function isBuildingPlanInternalCollection(meta, dataName) {
  if (meta?.version !== 2) return false;
  const node = meta.repeatables.find((entry) => entry.dataName === dataName);
  if (!node) return false;
  return ['physical_walls', 'wall_sides'].includes(node.role);
}
