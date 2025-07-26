export function flattenFields(elements) {
  return elements.flatMap((el) => {
    if (el.type === 'Section' || el.type === 'RepeatableSection') {
      return [el, ...flattenFields(el.elements)];
    }

    return [el];
  });
}
