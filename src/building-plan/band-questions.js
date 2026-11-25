import { bandClashQuestion, fitOpenings, newBandClashes } from './band-clash-question.js';
import { bandRemovalQuestion, keepOwnBands, removedOwnBands } from './band-removal-question.js';

/**
 * The questions a commit asks about bands, after the others (bands 4b and 4c): band rows with
 * values of their own removed by a No (remove them, keep those walls' bands, or cancel), then
 * bands run into openings (fit the openings, keep them, or cancel). Each answer is recorded on
 * the prepared edit and applied to its candidate, so the edit and the answers are one Undo.
 *
 * @param {object} prepared the session's prepared edit (its candidate changed in place)
 * @param {object} before the plan before the edit
 * @param {string | null} decision the reply to the question asked last, if it was one of these
 * @returns {{ question: object | null, changed: boolean }} the next question to ask, and whether
 *   an answer changed the candidate
 */
export function nextBandQuestion(prepared, before, decision) {
  let changed = false;
  if (decision === 'remove' || decision === 'keep-bands') prepared.bandRemoval = decision;
  if (decision === 'fit' || decision === 'keep') prepared.bandAnswer = decision;

  if (!prepared.bandRemovalDone) {
    const removed = removedOwnBands(before, prepared.candidate, prepared.operation);
    if (removed.length && !prepared.bandRemoval)
      return { question: bandRemovalQuestion(removed), changed };
    if (removed.length && prepared.bandRemoval === 'keep-bands') {
      keepOwnBands(removed);
      changed = true;
    }
    prepared.bandRemovalDone = true;
  }

  const clashes = prepared.bandAnswer === 'keep' ? [] : newBandClashes(before, prepared.candidate);
  if (clashes.length && !prepared.bandAnswer)
    return { question: bandClashQuestion(clashes), changed };
  if (clashes.length && prepared.bandAnswer === 'fit') {
    fitOpenings(clashes);
    changed = true;
  }
  return { question: null, changed };
}
