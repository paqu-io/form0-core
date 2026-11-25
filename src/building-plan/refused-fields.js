/**
 * Which of a row's changed fields core refuses (refused typed values as field errors, decided
 * 2026-11-25): `completeRow` sends every field changed since the row opened, so a refusal may come
 * from any of them, and a value refused earlier is sent again with each later edit. Each changed
 * field is tried alone (a preview: nothing applies); those refused alone carry their own issues.
 * When none is refused alone (only together), each changed field carries the refusal.
 *
 * @param {{
 *   previewRow: (editedRow: object) => { status: string, issues?: object[] },
 *   initialRow: object,
 *   row: object,
 *   changed: Array<{ dataName: string }>,
 *   issues: object[],
 * }} input `previewRow` previews the row edited as given; `issues` are the refusal's
 * @returns {Array<{ dataName: string, issues: object[] }>}
 */
export function refusedFields({ previewRow, initialRow, row, changed, issues }) {
  if (changed.length < 2) return changed.map(({ dataName }) => ({ dataName, issues }));
  const alone = changed
    .map(({ dataName }) => {
      const proposal = previewRow({
        ...row,
        values: { ...initialRow.values, [dataName]: row.values?.[dataName] },
        repeatable: initialRow.repeatable,
      });
      return proposal.status === 'conflict' ? { dataName, issues: proposal.issues || [] } : null;
    })
    .filter(Boolean);
  return alone.length ? alone : changed.map(({ dataName }) => ({ dataName, issues }));
}
