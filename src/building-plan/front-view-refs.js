/**
 * A front view (A1) with each part's canvas element (A2, decided 2026-11-26): `ref`, the canvas
 * snapshot's `{ collection, id, path }` for a piece's wall row, a door or window, a wall beam or
 * band, so the web opens a part by double-click and marks its findings as the plan does. A part
 * the snapshot doesn't show has `ref` null.
 */

const copy = (value) => JSON.parse(JSON.stringify(value));

/**
 * @param {object} view `buildingPlanFrontView`'s
 * @param {Record<string, Map<string, object>>} elements the controller's snapshot entries by
 *   collection (walls, doors, windows, wallBeams), each keyed by id
 * @returns {object}
 */
export function frontViewWithRefs(view, elements) {
  const ref = (collection, find) => {
    for (const entry of elements[collection]?.values() || [])
      if (find(entry)) return { collection, id: entry.id, path: copy(entry.path) };
    return null;
  };
  const on = (part) => (entry) =>
    entry.subjectId === part.subjectId && entry.wallId === part.faceId;
  return {
    ...view,
    pieces: view.pieces.map((piece) => ({
      ...piece,
      ref: ref('walls', (entry) => entry.id === piece.faceId),
    })),
    openings: view.openings.map((opening) => ({
      ...opening,
      ref: ref(opening.kind === 'door' ? 'doors' : 'windows', on(opening)),
    })),
    beams: view.beams.map((beam) => ({ ...beam, ref: ref('wallBeams', on(beam)) })),
  };
}
