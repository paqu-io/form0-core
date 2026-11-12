import { SAME, along, offset, parallelTo, pointAt } from './grid.js';

const refuse = (code, message, subject) => {
  throw Object.assign(new Error(message), {
    issues: [{ code, message, ...(subject ? { subject } : {}) }],
  });
};
import { anchorAt } from './line-spans.js';
import { retreatStation } from './jog-retreat.js';
import { planTurnedEnd } from './turn-ends.js';
import { junctionAllowance, junctionReturn } from './junction-allowance.js';

export { pieceAtLineEnd } from './junction-allowance.js';

const dot = (a, b) => a.x * b.x + a.y * b.y;

/** Unit vector from a room line into its room. */
export const inward = (line) => ({
  x: -line.outward * line.frame.normal.x,
  y: -line.outward * line.frame.normal.y,
});

const roomLinesOf = (lines, roomId) =>
  lines.filter((line) => line.roomId === roomId).sort((a, b) => a.index - b.index);
const neighbourLine = (lines, line, step) => {
  const own = roomLinesOf(lines, line.roomId);
  return own[(own.indexOf(line) + step + own.length * 2) % own.length];
};

/**
 * How a moved stretch of a room line reconnects at one end (`atEnd`: its end, else its start):
 *
 * - `straight`: the line continues past the stretch, which then needs a jog.
 * - `slide`: the line turns at a corner there; the corner slides along the adjoining line.
 * - `shift`: the line ends at a right-angle jog to a parallel continuation in the same direction
 *   (a step made by an earlier edit); the jog is placed again, or removed.
 *
 * Caps between the stretch end and the line end move with the stretch (`reach`): they are the
 * junction a previous edit left, not walls of their own.
 */
export function endSituation(lines, caps, line, station, atEnd) {
  const length = line.frame.length;
  const onLine = caps.filter((cap) => cap.roomId === line.roomId && cap.index === line.index);
  let reach = station;
  for (let guard = 0; guard < onLine.length; guard++) {
    const cap = onLine.find((entry) =>
      atEnd
        ? Math.abs(entry.from - reach) <= SAME && entry.to > reach
        : Math.abs(entry.to - reach) <= SAME && entry.from < reach
    );
    if (!cap) break;
    reach = atEnd ? cap.to : cap.from;
  }
  if (atEnd ? reach < length - SAME : reach > SAME) return { kind: 'straight', reach: station };
  const step = atEnd ? 1 : -1;
  const next = neighbourLine(lines, line, step);
  const beyond = neighbourLine(lines, line, 2 * step);
  const square =
    Math.abs(along(line.frame, next.frame.start) - along(line.frame, next.frame.end)) <= SAME;
  const continues =
    beyond !== line &&
    dot(line.frame.tangent, beyond.frame.tangent) > 0 &&
    parallelTo(line.frame, beyond.frame.start, beyond.frame.end);
  if (square && continues) return { kind: 'shift', reach, jog: next, continuation: beyond };
  return { kind: 'slide', reach, adjoining: next };
}

/** Offset into the room of a parallel line, measured from `line`. */
export const depth = (line, other) => -line.outward * offset(line.frame, other.frame.start);

/** The subject anchored on a room line just inside a station (towards `towards`). */
export function subjectNear(line, station, towards) {
  const probe = station + Math.sign(towards - station) * SAME * 2;
  return anchorAt(line, probe - SAME, probe + SAME) || null;
}

/** The current piece covering a point of a room line, if any. */
export function pieceAt(derived, line, station) {
  return derived.pieces.find((piece) =>
    piece.lines.some(
      (entry) =>
        entry.roomId === line.roomId &&
        entry.index === line.index &&
        entry.from - SAME <= station &&
        station <= entry.to + SAME
    )
  );
}

/** The dragged stretch: the row's edge (or `interval` of it) as stations of its room line. */
export function locateFace(primary, operation, lines) {
  if (primary.partitions.some((partition) => partition.faceId === operation.faceId))
    refuse('unsupported_face_edit', 'Resize the host wall of an internal partition directly.');
  const anchors = primary.anchors.filter(
    (anchor) =>
      anchor.faceId === operation.faceId &&
      (!operation.edgeId || anchor.edgeId === operation.edgeId)
  );
  if (!anchors.length) throw new Error('The wall face no longer exists.');
  const edgeIds = [...new Set(anchors.map((anchor) => anchor.edgeId))];
  if (edgeIds.length !== 1)
    refuse('ambiguous_face_edit', 'Choose the specific straight room edge to edit.', {
      type: 'room_face',
      id: operation.faceId,
    });
  const roomId = anchors[0].roomId;
  const line = lines.find(
    (entry) => entry.roomId === roomId && entry.edges.some((edge) => edge.id === edgeIds[0])
  );
  const edge = line.edges.find((entry) => entry.id === edgeIds[0]);
  const length = edge.to - edge.from;
  const interval = operation.interval || [
    Math.min(...anchors.map((anchor) => anchor.from)),
    Math.max(...anchors.map((anchor) => anchor.to ?? length)),
  ];
  if (
    !Array.isArray(interval) ||
    !interval.every(Number.isFinite) ||
    interval[0] < -SAME ||
    interval[1] > length + SAME ||
    interval[1] - interval[0] <= SAME
  )
    refuse('invalid_dimension', 'The edited extent is outside its room edge.');
  return {
    roomId,
    line,
    edgeId: edge.id,
    from: edge.from + Math.max(0, interval[0]),
    to: edge.from + Math.min(length, interval[1]),
  };
}

/** Neighbours sharing the dragged stretch follow it: their facing stretch moves too. */
export function followers(derived, lines, stretch) {
  const result = [];
  for (const piece of derived.pieces) {
    if (piece.partition || piece.lines.length < 2) continue;
    const own = piece.lines.find(
      (entry) => entry.roomId === stretch.roomId && entry.index === stretch.line.index
    );
    const other = piece.lines.find((entry) => entry !== own);
    if (!own || !other) continue;
    const from = Math.max(own.from, stretch.from);
    const to = Math.min(own.to, stretch.to);
    if (to - from <= SAME) continue;
    const line = lines.find(
      (entry) => entry.roomId === other.roomId && entry.index === other.index
    );
    const [a, b] = [from, to]
      .map((station) => along(line.frame, pointAt(stretch.line.frame, station)))
      .sort((x, y) => x - y);
    result.push({
      roomId: line.roomId,
      line,
      from: a,
      to: b,
      width: piece.width,
      subjectId: piece.subjectId,
    });
  }
  return result;
}

const minus = (p, q) => ({ x: p.x - q.x, y: p.y - q.y });

/**
 * Plan one end of a moved stretch: slide its corner, or place a jog where the room's clear space
 * stays out of the partner room's wall material (the partner being the room across the moved
 * wall). F1: a new jog copies the adjacent part with its own exposure, else the moved part.
 */
export function planEnd(derived, run, atEnd, delta, primary = null) {
  const bend = planTurnedEnd(run, atEnd);
  if (bend) return bend;
  const { line, situation } = run.ends[atEnd ? 1 : 0];
  const station = atEnd ? run.to : run.from;
  const sign = atEnd ? 1 : -1;
  // How far the line moves into the room at this end (a turned line moves by different amounts).
  const point = pointAt(line.frame, station);
  const map = run.maps?.[atEnd ? 1 : 0] || run.map;
  const shift = map ? minus(map(point), point) : delta;
  const moved = dot(shift, inward(line));
  if (situation.kind === 'slide') return { type: 'slide' };
  const relative = situation.kind === 'shift' ? moved - depth(line, situation.continuation) : moved;
  const partner = run.ends[atEnd ? 1 : 0].partner;
  const allowance = relative > SAME ? junctionAllowance(derived, line, partner, run.width ?? 0) : 0;
  // A stretch growing with no room across it: its jog steps back from other rooms' material.
  const place = (value) =>
    relative < -SAME && !partner && primary
      ? retreatStation(primary, derived, line, value, atEnd, -relative)
      : value;
  const jogExposure = partner?.situation.kind === 'straight' ? 'interior' : 'exterior';
  const moving = {
    anchor: subjectNear(line, station, station - sign),
    exposure: run.partnerRun
      ? 'interior'
      : pieceAt(derived, line, station - sign * SAME * 2)?.exposure,
  };
  // F1: a new jog copies the adjacent part with its exposure, else the moved part.
  const choose = (staying) =>
    [moving, staying].find((part) => part.anchor && part.exposure === jogExposure)?.anchor ||
    moving.anchor;
  if (situation.kind === 'shift') {
    const continuation = situation.continuation;
    const at = atEnd ? 0 : continuation.frame.length;
    const staying = {
      anchor: subjectNear(continuation, at, at + sign),
      exposure: pieceAt(derived, continuation, at + sign * SAME * 2)?.exposure,
    };
    // The moved line runs on again on the continuation: what moved with it there continues it.
    if (Math.abs(relative) <= SAME)
      return { type: 'shift', station: null, joinAnchor: staying.anchor };
    // The old jog's own wall stays with it; a stretch that was another wall's contact does not.
    const keep = situation.jog.edges
      .filter((edge) => {
        const piece = pieceAt(derived, situation.jog, (edge.from + edge.to) / 2);
        return piece?.subjectId && piece.exposure === 'exterior';
      })
      .map((edge) => edge.id);
    return {
      type: 'shift',
      station: place(station + sign * allowance),
      keep,
      jogAnchor: choose(staying),
    };
  }
  // Against the other room's adjoining wall the return runs parallel to it (square on a plan
  // drawn square, along a slanted wall otherwise).
  const square = relative > SAME ? junctionReturn(derived, line, partner) : null;
  const against = square && sign * (square.station - station) > -SAME ? square : null;
  const target = against ? against.station : place(station + sign * allowance);
  // A jog would pass the line's corner: the whole remainder of the line moves instead.
  if (atEnd ? target >= line.frame.length - SAME : target <= SAME) return { type: 'slide' };
  const staying = {
    anchor: subjectNear(line, target, target + sign),
    exposure: pieceAt(derived, line, target + sign * SAME * 2)?.exposure,
  };
  return {
    type: 'jog',
    station: target,
    jogAnchor: choose(staying),
    ...(against ? { direction: against.direction } : {}),
  };
}
