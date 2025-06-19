export function flattenFields(elements) {
  return elements.flatMap(el => {
    if (el.type === 'Section') {
      return flattenFields(el.elements);
    }

    return [el];
  });
}