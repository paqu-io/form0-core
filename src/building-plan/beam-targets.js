import { edgesOf, freeWallTargets } from './free-wall-targets.js';

/**
 * What a room beam snaps to (3a, 2026-11-23): the free wall pulls (`free-wall-snapping.js`) with
 * a beam's own targets, in canvas units, from the canvas snapshot. Everything a free wall in the
 * room is pulled to (the room's corners and faces, free walls' corners, ends and sides, columns'
 * corners and sides), and also free walls' centrelines (a beam bearing on a wall's middle),
 * columns' centres (a beam resting on a column) and the other beams in the room: their corners,
 * ends, sides and centrelines (a beam framing into another). Corners and ends anywhere on the
 * floor, other beams' ends among them, to line up with. Nothing of the floor below (B2).
 */

const isFreeWall = (wall) => !wall.isBoundary && !wall.isCutPortion;

/**
 * A beam's centreline ends in canvas units, from its room's box and its fractions of it.
 * @param {{ startU?: number, startV?: number, endU?: number, endV?: number }} beam
 * @param {{ rect?: { x: number, y: number, width: number, height: number } } | undefined} room
 * @returns {Array<{ x: number, y: number }>} its start and end, none without the room's box
 */
export function beamEnds(beam, room) {
  const rect = room?.rect;
  if (!rect) return [];
  const at = (u, v) => ({ x: rect.x + u * rect.width, y: rect.y + v * rect.height });
  return [at(beam.startU ?? 0.25, beam.startV ?? 0.5), at(beam.endU ?? 0.75, beam.endV ?? 0.5)];
}

/**
 * A beam's body as a rectangle around its centreline, `half` to each side (square ends).
 * @returns {Array<{ x: number, y: number }>} four corners, none for a beam of no length
 */
export function beamBody(start, end, half) {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (!length) return [];
  const n = { x: (-(end.y - start.y) / length) * half, y: ((end.x - start.x) / length) * half };
  return [
    { x: start.x + n.x, y: start.y + n.y },
    { x: end.x + n.x, y: end.y + n.y },
    { x: end.x - n.x, y: end.y - n.y },
    { x: start.x - n.x, y: start.y - n.y },
  ];
}

/**
 * What a beam in `roomId` is pulled to (the free wall targets' shape).
 * @param {object} view the canvas snapshot, with `gridSize`
 * @param {{ roomId: string, beamId?: string | null }} options `beamId`: the beam being edited,
 *   left out
 * @returns {import('./free-wall-targets.js').FreeWallTargets}
 */
export function beamTargets(view, { roomId, beamId = null }) {
  const gridSize = view.gridSize || 20;
  const rooms = view.rooms || [];
  const base = freeWallTargets(view, { roomId });
  const centrelines = (view.walls || [])
    .filter((wall) => isFreeWall(wall) && wall.roomId === roomId && wall.points?.length > 1)
    .flatMap((wall) => wall.points.slice(1).map((point, index) => [wall.points[index], point]));
  const columnCentres = (view.columns || [])
    .filter((column) => column.roomId === roomId)
    .flatMap((column) => {
      const rect = rooms.find((room) => room.id === column.roomId)?.rect;
      if (!rect) return [];
      return [
        {
          x: rect.x + (column.centerU ?? 0.5) * rect.width,
          y: rect.y + (column.centerV ?? 0.5) * rect.height,
        },
      ];
    });
  const beams = (view.beams || [])
    .filter((beam) => beam.id == null || beam.id !== beamId)
    .flatMap((beam) => {
      const ends = beamEnds(
        beam,
        rooms.find((room) => room.id === beam.roomId)
      );
      if (ends.length !== 2) return [];
      const body = beamBody(ends[0], ends[1], ((beam.width ?? 0.25) * gridSize) / 2);
      return [{ roomId: beam.roomId, ends, body }];
    });
  const inRoom = beams.filter((beam) => beam.roomId === roomId);
  return {
    outline: base.outline,
    points: [
      ...base.points,
      ...columnCentres,
      ...inRoom.flatMap((beam) => [...beam.body, ...beam.ends]),
    ],
    lines: [
      ...base.lines,
      ...centrelines,
      ...inRoom.flatMap((beam) => [...(beam.body.length ? edgesOf(beam.body) : []), beam.ends]),
    ],
    align: [...base.align, ...beams.flatMap((beam) => beam.ends)],
  };
}
