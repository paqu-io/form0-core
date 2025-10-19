/**
 * Shared helpers for working with RepeatableSections.
 * Extracted from record-transformer so both the engine and CLI can rely on
 * the same tree-building logic.
 */

/**
 * Build a comprehensive tree structure for nested RepeatableSections.
 * @param {Array} elements - Schema elements to inspect.
 * @param {Array} parentPath - Preferred key ancestry.
 * @param {Map} repeatableSectionTree - Map to populate (data_name -> info).
 * @param {Map} fieldOwnership - Map to populate (field data_name -> ownership info).
 * @param {Set} sectionFields - Set to populate with Section data_names.
 */
export function buildRepeatableSectionTree(
  elements,
  parentPath = [],
  repeatableSectionTree = new Map(),
  fieldOwnership = new Map(),
  sectionFields = new Set()
) {
  if (!Array.isArray(elements)) return {
    repeatableSectionTree,
    fieldOwnership,
    sectionFields,
  };

  elements.forEach((element) => {
    if (element.type === 'Section' || element.type === 'BuildingPlanSection') {
      sectionFields.add(element.data_name);
      if (Array.isArray(element.elements)) {
        buildRepeatableSectionTree(
          element.elements,
          parentPath,
          repeatableSectionTree,
          fieldOwnership,
          sectionFields
        );
      }
    } else if (element.type === 'RepeatableSection') {
      const preferredKey =
        element.key && element.key.trim() !== '' ? element.key : element.data_name;
      const currentPath = [...parentPath, preferredKey];

      repeatableSectionTree.set(element.data_name, {
        preferredKey,
        field: element,
        parentPath: [...parentPath],
        currentPath: [...currentPath],
        children: new Map(),
        fields: new Map(),
      });

      if (Array.isArray(element.elements)) {
        buildRepeatableSectionTree(
          element.elements,
          currentPath,
          repeatableSectionTree,
          fieldOwnership,
          sectionFields
        );
      }
    } else {
      const preferredFieldKey =
        element.key && element.key.trim() !== '' ? element.key : element.data_name;
      fieldOwnership.set(element.data_name, {
        preferredKey: preferredFieldKey,
        field: element,
        parentPath: [...parentPath],
      });
    }
  });

  return {
    repeatableSectionTree,
    fieldOwnership,
    sectionFields,
  };
}

/**
 * Establish parent/child relationships between RepeatableSections based on
 * the tree produced by buildRepeatableSectionTree.
 * @param {Map} repeatableSectionTree
 */
export function linkRepeatableSections(repeatableSectionTree) {
  for (const [dataName, repInfo] of repeatableSectionTree) {
    if (repInfo.parentPath.length > 0) {
      const parentKey = repInfo.parentPath[repInfo.parentPath.length - 1];
      for (const [, parentRepInfo] of repeatableSectionTree) {
        if (parentRepInfo.preferredKey === parentKey) {
          parentRepInfo.children.set(dataName, repInfo);
          break;
        }
      }
    }
  }
}

/**
 * Populate RepeatableSection field ownership information.
 * @param {Map} repeatableSectionTree
 * @param {Map} fieldOwnership
 */
export function populateRepeatableFields(repeatableSectionTree, fieldOwnership) {
  for (const [fieldDataName, fieldInfo] of fieldOwnership) {
    if (fieldInfo.parentPath.length > 0) {
      const immediateParentKey = fieldInfo.parentPath[fieldInfo.parentPath.length - 1];
      for (const [, repInfo] of repeatableSectionTree) {
        if (repInfo.preferredKey === immediateParentKey) {
          repInfo.fields.set(fieldDataName, {
            preferredKey: fieldInfo.preferredKey,
            field: fieldInfo.field,
          });
          break;
        }
      }
    }
  }
}

/**
 * Convenience helper that returns fully-linked repeatable metadata.
 */
export function buildRepeatableMetadata(elements) {
  const { repeatableSectionTree, fieldOwnership, sectionFields } = buildRepeatableSectionTree(
    elements,
    [],
    new Map(),
    new Map(),
    new Set()
  );

  linkRepeatableSections(repeatableSectionTree);
  populateRepeatableFields(repeatableSectionTree, fieldOwnership);

  return {
    repeatableSectionTree,
    fieldOwnership,
    sectionFields,
  };
}
