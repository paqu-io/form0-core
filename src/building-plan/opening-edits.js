import { copyBuildingPlanData as copy, planIssue, equalValue } from './model.js';
import { partialOpeningCuts, capturedBoundaryIssues } from './boundary-edits.js';

/** Discover an exact, reviewable removal set before retrying an edit. All attempts are private candidates. */
export function prepareBuildingPlanEdit(current, operation, apply, validate) {
  const openings = new Map(
    current.floors.flatMap((floor) =>
      floor.walls.flatMap((wall) =>
        [...wall.doors, ...wall.windows].map((opening) => [
          opening.id,
          { ...opening, floorId: floor.id, wallId: wall.id },
        ])
      )
    )
  );
  const previousCuts = partialOpeningCuts(current);
  const requested = operation.removeOpeningIds;
  const base = { ...operation };
  delete base.removeOpeningIds;
  const affected = new Set();
  const targets = (edit) =>
    edit.type === 'batch'
      ? edit.operations.flatMap(targets)
      : edit.type === 'update_opening'
        ? [edit.openingId]
        : [];
  const editedOpenings = new Set(targets(base));
  const run = (ids, allowObservationDeletion) => {
    const candidate = copy(current);
    for (const id of ids) {
      const opening = openings.get(id);
      apply(candidate, {
        type: 'remove_opening',
        floorId: opening.floorId,
        wallId: opening.wallId,
        openingId: id,
        allowObservationDeletion,
      });
    }
    const result = apply(candidate, base);
    const issues = [...validate(candidate), ...capturedBoundaryIssues(current, candidate)];
    const other = issues.filter((issue) => issue.code !== 'opening_outside_wall');
    if (other.length) throw Object.assign(new Error(other[0].message), { issues: other });
    const cuts = partialOpeningCuts(candidate).filter(
      (cut) =>
        !previousCuts.some(
          (previous) =>
            previous.id === cut.id &&
            previous.roomId === cut.roomId &&
            previous.wallId === cut.wallId &&
            previous.segmentId === cut.segmentId &&
            previous.offset === cut.offset &&
            previous.width === cut.width &&
            equalValue(previous.extent, cut.extent)
        )
    );
    const idsToRemove = [
      ...new Set([...cuts.map((cut) => cut.id), ...issues.map((issue) => issue.subject?.id)]),
    ];
    return { candidate, result, idsToRemove };
  };
  let prepared;
  for (let attempt = 0; attempt <= openings.size; attempt++) {
    let discovered = [];
    try {
      prepared = run(affected, true);
      discovered = prepared.idsToRemove;
    } catch (error) {
      if (error.issues?.some((issue) => issue.code === 'opening_crosses_edit_boundary'))
        discovered = error.issues.flatMap((issue) => issue.openingIds || [issue.subject?.id]);
      else throw error;
    }
    if (!discovered.length) break;
    const previous = affected.size;
    if (discovered.some((id) => editedOpenings.has(id)))
      throw Object.assign(new Error('The opening does not fit. Move it or reduce its width.'), {
        issues: [
          planIssue(
            'opening_outside_wall',
            'The opening does not fit. Move it or reduce its width.'
          ),
        ],
      });
    for (const id of discovered) {
      if (!openings.has(id))
        throw Object.assign(
          new Error('The opening does not fit. Move it or change the wall edit.'),
          {
            issues: [
              planIssue(
                'opening_outside_wall',
                'The opening does not fit. Move it or change the wall edit.',
                { type: 'opening', id }
              ),
            ],
          }
        );
      affected.add(id);
    }
    if (previous === affected.size)
      throw new Error('Move the opening before changing this boundary.');
  }
  const ids = [...affected];
  if (
    requested !== undefined &&
    (!Array.isArray(requested) ||
      requested.length !== ids.length ||
      new Set(requested).size !== ids.length ||
      requested.some((id) => !affected.has(id)))
  )
    throw Object.assign(new Error('The affected openings changed. Review this edit again.'), {
      issues: [
        planIssue(
          'stale_opening_resolution',
          'The affected openings changed. Review this edit again.'
        ),
      ],
    });
  if (!ids.length) return prepared;
  if (requested === undefined) {
    const observationIds = current.floors.flatMap((floor) =>
      floor.observations
        .filter((observation) => affected.has(observation.subject?.id))
        .map((observation) => observation.id)
    );
    const items = ids.map((id) => {
      const item = openings.get(id);
      return { id, type: item.type, label: item.values?.[`${item.type}_label`] || item.type };
    });
    const message = `This edit cuts through ${items.map((item) => item.label).join(', ')}. Keep the previous layout, or confirm this position and remove ${ids.length === 1 ? 'the opening' : 'these openings'}.`;
    throw Object.assign(new Error(message), {
      issues: [
        planIssue('opening_cut_requires_confirmation', message, null, {
          openingIds: ids,
          observationIds,
          openings: items,
        }),
      ],
    });
  }
  return run(affected, operation.allowObservationDeletion === true);
}
