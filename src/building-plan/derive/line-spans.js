import { SAME } from './grid.js';

/**
 * Attach anchors (subject per span) and cut stations to each room line, in the line's own
 * stations (metres from the line start).
 */
export function annotateLines(lines, primary) {
  const anchorsByEdge = new Map();
  for (const anchor of primary.anchors) {
    const key = `${anchor.roomId}:${anchor.edgeId}`;
    if (!anchorsByEdge.has(key)) anchorsByEdge.set(key, []);
    anchorsByEdge.get(key).push(anchor);
  }
  for (const line of lines) {
    line.anchors = [];
    for (const edge of line.edges) {
      const length = edge.to - edge.from;
      for (const anchor of anchorsByEdge.get(`${line.roomId}:${edge.id}`) || [])
        line.anchors.push({
          subjectId: anchor.subjectId,
          faceId: anchor.faceId,
          from: edge.from + anchor.from,
          to: edge.from + (anchor.to ?? length),
        });
    }
    line.anchors.sort((a, b) => a.from - b.from);
  }
  return lines;
}

/** The anchor covering a station interval's midpoint, if any. */
export function anchorAt(line, from, to) {
  const middle = (from + to) / 2;
  return line.anchors.find((anchor) => anchor.from <= middle + SAME && anchor.to >= middle - SAME);
}

/** Every station where a piece may have to end: anchor ends and cuts. */
export function lineStations(line) {
  return [
    ...line.anchors.flatMap((anchor) => [anchor.from, anchor.to]),
    ...line.cuts.map((cut) => cut.station),
  ];
}
