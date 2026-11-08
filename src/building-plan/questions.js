/** Settle internal questions without routing domain decisions through authored handlers. */
export async function settleBuildingPlanQuestions(editor, result, present) {
  while (result.status === 'pending') {
    if (typeof present !== 'function') return result;
    const question = result.uiOperations?.[0];
    if (!question) throw new TypeError('A pending BuildingPlan decision requires a question.');
    const id = question.params.requestId;
    const response = await present(question.params, {
      isCurrent: () => editor.isUIRequestCurrent(id),
      internal: true,
    });
    result = editor.resolveUIRequest(id, response || { cancelled: true });
  }
  return result;
}
