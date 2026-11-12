import { copyBuildingPlanData as copy } from '../model.js';
import { divisionLineage, subjectCopy } from './subject-divisions.js';

/**
 * Partitions divide like room walls: a subject on several partition rows (Split portions) keeps
 * the row it is referenced from, else the first; the pieces of every other row get a copy of the
 * subject, and openings follow the row they are anchored to. Reported as divisions, so the
 * session asks today's `on_split` questions.
 */
export function dividePartitionSubjects(context) {
  const faces = new Map();
  for (const piece of context.partitionPieces) {
    const list = faces.get(piece.subjectId) || [];
    if (!list.includes(piece.faceIds[0])) list.push(piece.faceIds[0]);
    faces.set(piece.subjectId, list);
  }
  for (const [id, list] of faces) {
    if (list.length < 2) continue;
    const subject = context.subjects.get(id);
    const kept = list.includes(subject.referenceFaceId) ? subject.referenceFaceId : list[0];
    const source = copy(subject);
    const lineage = { ...source.lineage, ...divisionLineage(source) };
    delete lineage.thicknessProfile;
    context.divided.add(id);
    const subjectIds = [];
    for (const faceId of list) {
      const target = faceId === kept ? subject : subjectCopy(context, source);
      target.lineage = { ...lineage };
      target.openings = source.openings.filter((opening) => opening.faceId === faceId);
      for (const piece of context.partitionPieces)
        if (piece.subjectId === id && piece.faceIds[0] === faceId) piece.subjectId = target.id;
      subjectIds.push(target.id);
    }
    context.divisions.push({ source, subjectIds });
  }
}
