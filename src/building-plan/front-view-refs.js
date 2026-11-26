/**
 * A front view (A1) with each part's canvas element (A2, decided 2026-11-26): `ref`, the canvas
 * snapshot's `{ collection, id, path }` for a piece's wall row, a door or window, a wall beam or
 * band, a column or room beam, so the web opens a part by double-click and marks its findings as the plan does. A part
 * the snapshot doesn't show has `ref` null. With `rows`, the room's wall rows in its Walls list's
 * order (free walls included), each `{ faceId, label, ref }`, for a room's entry to step through
 * (A3, decided 2026-11-26).
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
  const rows = [...(elements.walls?.values() || [])]
    .filter((entry) => entry.roomId === view.roomId)
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({
      faceId: entry.id,
      label: entry.displayLabel,
      ref: { collection: 'walls', id: entry.id, path: copy(entry.path) },
    }));
  return {
    ...view,
    rows,
    pieces: view.pieces.map((piece) => ({
      ...piece,
      ref: ref('walls', (entry) => entry.id === piece.faceId),
    })),
    openings: view.openings.map((opening) => ({
      ...opening,
      ref: ref(opening.kind === 'door' ? 'doors' : 'windows', on(opening)),
    })),
    beams: view.beams.map((beam) => ({ ...beam, ref: ref('wallBeams', on(beam)) })),
    columns: (view.columns || []).map((column) => ({
      ...column,
      ref: ref('columns', (entry) => entry.id === column.subjectId),
    })),
    roomBeams: (view.roomBeams || []).map((beam) => ({
      ...beam,
      ref: ref('beams', (entry) => entry.id === beam.subjectId),
    })),
  };
}
