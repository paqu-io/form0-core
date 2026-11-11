import { copyBuildingPlanData as copy } from '../model.js';
import { SAME } from './grid.js';

const refuse = (code, message, subject) => {
  throw Object.assign(new Error(message), {
    issues: [{ code, message, ...(subject ? { subject } : {}) }],
  });
};

/** The old stations a new edge spans. */
const windowOf = (entry) => [entry.from, entry.to];

/**
 * Carry a room's anchors and the openings on its rows across `moveRoomStretch`.
 *
 * Every part of an old edge keeps the subjects anchored there, except an extension (a stretch the
 * edit moved only to clear a neighbour's wall material), which stays unanchored. An anchor that
 * reaches an end of its old edge follows that end when the edge is lengthened. A row keeps its
 * identity on the part that kept the edge's ID (else the longest part); other parts get new rows
 * that copy its lineage, as divisions do. An old jog that was relocated keeps its anchors.
 *
 * Openings keep their place along the moved or stationary part they lie on; one that an edit
 * boundary would cut is refused (`opening_crosses_edit_boundary`).
 *
 * @param {Object} primary Primary data (anchors and subjects are updated).
 * @param {Object} room The edited room (already rebuilt).
 * @param {Map<string, Object>} provenance New edge ID → provenance (see `moveRoomStretch`).
 * @param {Map<string, number>} lengths Old edge ID → old length.
 * @param {() => string} createId
 */
export function remapRoomSpans(primary, room, provenance, lengths, createId) {
  const parts = [...provenance.entries()].map(([id, entry]) => ({ id, ...entry }));
  const remapped = new Map();
  const anchors = [];
  for (const anchor of primary.anchors) {
    if (anchor.roomId !== room.id) {
      anchors.push(anchor);
      continue;
    }
    const length = lengths.get(anchor.edgeId);
    const [a, b] = [anchor.from, anchor.to ?? length];
    const found = [];
    for (const part of parts) {
      if (part.jog) {
        if (part.replaces === anchor.edgeId)
          found.push({ part, from: 0, to: null, whole: anchor.to == null && a <= SAME });
        continue;
      }
      if (part.edgeId !== anchor.edgeId || part.extension) continue;
      const [from, to] = windowOf(part);
      const low = Math.max(a <= SAME ? Math.min(a, from) : a, from);
      const high = Math.min(b >= length - SAME ? Math.max(b, to) : b, to);
      if (high - low <= SAME) continue;
      const whole = low <= from + SAME && high >= to - SAME;
      found.push({ part, from: low - from, to: whole && anchor.to == null ? null : high - from });
    }
    const keeper =
      found.find((entry) => entry.part.id === anchor.edgeId) ||
      [...found].sort((x, y) => span(y) - span(x))[0];
    const mapped = found.map((entry) => {
      const own = entry === keeper;
      return {
        ...anchor,
        edgeId: entry.part.id,
        from: entry.from,
        to: entry.to,
        ...(own
          ? {}
          : {
              faceId: createId(),
              bindingId: null,
              lineage: {
                ...copy(anchor.lineage || {}),
                jogOriginFaceId: anchor.lineage?.jogOriginFaceId || anchor.faceId,
              },
            }),
        window: entry.part.jog ? null : windowOf(entry.part),
        oldFrom: entry.part.jog ? null : entry.from + entry.part.from,
      };
    });
    remapped.set(anchor, mapped);
    for (const entry of mapped) {
      const { window: _, oldFrom: __, ...rest } = entry;
      anchors.push(rest);
    }
  }
  remapOpenings(primary, room, remapped);
  primary.anchors = anchors;
}

const span = (entry) => (entry.to ?? Infinity) - entry.from;

/** Openings on a remapped row: re-anchored to the part that holds them, same place on it. */
function remapOpenings(primary, room, remapped) {
  const first = new Map();
  for (const anchor of primary.anchors)
    if (!first.has(anchor.faceId)) first.set(anchor.faceId, anchor);
  for (const subject of primary.subjects.values())
    for (const opening of subject.openings || []) {
      const anchor = first.get(opening.faceId);
      if (!anchor || anchor.roomId !== room.id) continue;
      const [start, end] = [opening.from, opening.from + opening.width];
      const holder = (remapped.get(anchor) || []).find(
        (entry) =>
          entry.window &&
          entry.window[0] - SAME <= start &&
          end <= entry.window[1] + SAME &&
          entry.oldFrom - SAME <= start
      );
      if (!holder)
        refuse(
          'opening_crosses_edit_boundary',
          'An opening crosses this wall edit. Move it or split a different portion.',
          { type: opening.type, id: opening.id }
        );
      opening.faceId = holder.faceId;
      opening.from = start - holder.window[0];
    }
}
