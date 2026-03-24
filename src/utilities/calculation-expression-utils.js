export function isMultilineCalculationExpression(expression) {
  const normalizedExpression = typeof expression === 'string' ? expression : '';

  return (
    normalizedExpression.includes('\r\n') ||
    normalizedExpression.includes('\n') ||
    normalizedExpression.includes('function')
  );
}

export function normalizeInlineCalculationExpression(expression) {
  const normalizedExpression = typeof expression === 'string' ? expression : '';

  return normalizedExpression.replace(/;+\s*$/u, '');
}
