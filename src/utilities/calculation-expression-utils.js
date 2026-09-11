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
  const expressionWithoutTrailingWhitespace = normalizedExpression.trimEnd();

  if (!expressionWithoutTrailingWhitespace.endsWith(';')) {
    return normalizedExpression;
  }

  let expressionEnd = expressionWithoutTrailingWhitespace.length;
  while (expressionEnd > 0 && expressionWithoutTrailingWhitespace[expressionEnd - 1] === ';') {
    expressionEnd -= 1;
  }

  return expressionWithoutTrailingWhitespace.slice(0, expressionEnd);
}
