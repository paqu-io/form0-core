import { GAP_TOLERANCE, SAME, along, offset, overlap, pointAt, stationsWithin } from './grid.js';
import { roomLines } from './room-lines.js';
import { anchorAt, annotateLines, lineStations, profileAt } from './line-spans.js';
import { resolveWallThickness } from './thickness.js';

/** Contacts are only searched up to this gap; no wall is thicker. */
const MAX_GAP = 3;

const toLine = (from, to, a, b) =>
  [along(b.frame, pointAt(a.frame, from)), along(b.frame, pointAt(a.frame, to))].sort(
    (x, y) => x - y
  );

/** Distance from line a to line b at a station of a, measured outward from a's room. */
const gapAt = (a, b, station) =>
  a.outward * offset(a.frame, pointAt(b.frame, along(b.frame, pointAt(a.frame, station))));

/**
 * Facing room lines: opposite directions, overlapping, the other room outside, and parallel
 * over the overlap (judged where they face each other, not over their full lengths).
 */
function facingPairs(lines) {
  const pairs = [];
  for (const a of lines)
    for (const b of lines) {
      if (a.roomId >= b.roomId) continue;
      if (a.frame.tangent.x * b.frame.tangent.x + a.frame.tangent.y * b.frame.tangent.y >= 0)
        continue;
      const interval = overlap(
        [0, a.frame.length],
        [along(a.frame, b.frame.start), along(a.frame, b.frame.end)]
      );
      if (!interval) continue;
      const [first, last] = interval.map((station) => gapAt(a, b, station));
      if (Math.abs(first - last) > GAP_TOLERANCE) continue;
      if (Math.min(first, last) <= SAME || Math.max(first, last) > MAX_GAP) continue;
      pairs.push({ a, b, interval });
    }
  return pairs;
}

/**
 * Derive physical pieces from room geometry: shared pieces where facing room lines are exactly
 * the resolved thickness apart, exterior pieces elsewhere, divided by subject and explicit cuts.
 *
 * @returns {{pieces: Array<Object>, caps: Array<Object>, issues: Array<Object>}}
 */
export function deriveBuildingPlanPieces(primary, specifications) {
  const { floor } = primary;
  const lines = annotateLines(primary.rooms.flatMap(roomLines), primary);
  const covered = new Map(lines.map((line) => [line, []]));
  const parts = [];
  const issues = [];
  const subject = (id) => (id ? primary.subjects.get(id) || null : null);
  const thickness = (id, roomIds) => {
    const result = resolveWallThickness(floor, specifications, subject(id), roomIds);
    if (result.conflict) issues.push({ code: 'conflicting_room_defaults', subjectId: id });
    return result.value;
  };
  // An explicitly unknown thickness keeps the subject's last geometric width.
  const width = (id, value) => (value > 0 ? value : lastWidth(subject(id)));

  for (const { a, b, interval } of facingPairs(lines)) {
    const stations = stationsWithin(
      [...lineStations(a), ...lineStations(b).map((s) => along(a.frame, pointAt(b.frame, s)))],
      ...interval
    );
    for (let i = 0; i < stations.length - 1; i++) {
      const [from, to] = [stations[i], stations[i + 1]];
      const gap = (gapAt(a, b, from) + gapAt(a, b, to)) / 2;
      const onB = toLine(from, to, a, b);
      const anchorA = anchorAt(a, from, to);
      const anchorB = anchorAt(b, ...onB);
      const subjectId = anchorA?.subjectId ?? anchorB?.subjectId ?? null;
      const value = thickness(subjectId, [a.roomId, b.roomId]);
      const anchoredBoth = anchorA && anchorA.subjectId === anchorB?.subjectId;
      const matches = value > 0 && Math.abs(gap - value) <= GAP_TOLERANCE;
      // One subject on both faces is a contact even when the gap disagrees (reported) or the
      // thickness is unknown (the gap is then the geometric width).
      if (!matches && !anchoredBoth) continue;
      if (!matches && value > 0)
        issues.push({ code: 'gap_mismatch', subjectId, gap, thickness: value });
      if (anchorA && anchorB && anchorA.subjectId !== anchorB.subjectId)
        issues.push({
          code: 'subject_mismatch',
          subjectIds: [anchorA.subjectId, anchorB.subjectId],
        });
      covered.get(a).push([from, to]);
      covered.get(b).push(onB);
      parts.push({
        line: a,
        from,
        to,
        subjectId,
        roomIds: [a.roomId, b.roomId],
        thickness: value,
        width: value > 0 ? value : gap,
        faceIds: [anchorA?.faceId ?? null, anchorB?.faceId ?? null],
        other: { line: b, from: onB[0], to: onB[1] },
      });
    }
  }

  const caps = [];
  for (const line of lines) {
    const taken = covered.get(line);
    const stations = stationsWithin([...lineStations(line), ...taken.flat()], 0, line.frame.length);
    for (let i = 0; i < stations.length - 1; i++) {
      const [from, to] = [stations[i], stations[i + 1]];
      const middle = (from + to) / 2;
      if (taken.some(([x, y]) => middle > x - SAME && middle < y + SAME)) continue;
      const profile = profileAt(line, from, to);
      if (profile && !anchorAt(line, from, to)) {
        caps.push({ roomId: line.roomId, index: line.index, sourceId: profile.sourceId, from, to });
        continue;
      }
      const anchor = anchorAt(line, from, to);
      const subjectId = anchor?.subjectId ?? null;
      const value = thickness(subjectId, [line.roomId, null]);
      parts.push({
        line,
        from,
        to,
        subjectId,
        roomIds: [line.roomId, null],
        thickness: value,
        width: width(subjectId, value),
        faceIds: [anchor?.faceId ?? null, null],
      });
    }
  }
  return { pieces: mergeParts(parts).map(withAxis), caps, issues };
}

/** Join contiguous parts of one line with the same subject, rooms and thickness, unless cut. */
function mergeParts(parts) {
  const sorted = [...parts].sort(
    (x, y) =>
      lineKey(x).localeCompare(lineKey(y)) ||
      String(x.roomIds[1]).localeCompare(String(y.roomIds[1])) ||
      x.from - y.from
  );
  const merged = [];
  for (const part of sorted) {
    const last = merged.at(-1);
    if (
      last &&
      last.line === part.line &&
      last.subjectId === part.subjectId &&
      last.roomIds[1] === part.roomIds[1] &&
      last.thickness === part.thickness &&
      last.width === part.width &&
      Math.abs(last.to - part.from) <= SAME &&
      !part.line.cuts.some((cut) => Math.abs(cut.station - part.from) <= SAME)
    ) {
      last.to = part.to;
      if (last.other && part.other) {
        last.other = {
          ...last.other,
          from: Math.min(last.other.from, part.other.from),
          to: Math.max(last.other.to, part.other.to),
        };
      }
      continue;
    }
    merged.push({ ...part, ...(part.other ? { other: { ...part.other } } : {}) });
  }
  return merged;
}

const lineKey = (part) =>
  `${part.line.roomId}:${part.line.frame.start.x},${part.line.frame.start.y}`;

/** Last geometric width stored for a subject whose thickness is explicitly unknown. */
function lastWidth(subject) {
  const offset = subject?.segments?.[0]?.referenceOffset;
  return Number.isFinite(offset) ? offset * 2 : 0;
}

function withAxis(part) {
  const distance = part.line.outward * ((part.width ?? 0) / 2);
  return {
    subjectId: part.subjectId,
    roomIds: part.roomIds,
    exposure: part.roomIds.every(Boolean) ? 'interior' : 'exterior',
    thickness: part.thickness,
    width: part.width,
    faceIds: part.faceIds,
    line: { roomId: part.line.roomId, index: part.line.index, from: part.from, to: part.to },
    // Every room line the piece faces: the first line and, for a shared piece, the other room's.
    lines: [
      { roomId: part.line.roomId, index: part.line.index, from: part.from, to: part.to },
      ...(part.other
        ? [
            {
              roomId: part.other.line.roomId,
              index: part.other.line.index,
              from: part.other.from,
              to: part.other.to,
            },
          ]
        : []),
    ],
    axis: {
      start: pointAt(part.line.frame, part.from, distance),
      end: pointAt(part.line.frame, part.to, distance),
    },
  };
}
