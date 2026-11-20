import { buildingPlanFaceAxes, buildingPlanFootprints } from './footprints.js';
import {
  GEOMETRY_EPSILON as EPS,
  cross,
  dot,
  pointInPolygon,
  project,
  roomBounds,
  segmentFrame,
  subtract,
} from './geometry.js';
import { buildingPlanFaceSegments, planIssue } from './model.js';
import { columnTargets } from './column-targets.js';
import { columnClash } from './column-fit.js';
import { faceCentreline } from './free-wall-lines.js';

/**
 * What a room holds stays where it may (the room contents rules, 2026-11-19; 4a-1 for columns,
 * 2026-11-20; 4a-2 for free walls). A column lies inside its room plus the room's own walls (it
 * may stand in them: flush inside, centred on a wall's midline, flush with its far face) and may
 * touch, but not overlap, another column, a door or a window. A free wall's centreline lies inside
 * its room's outline, touching it allowed. Checked on the derived engine's edits,
 * whatever the edit (an element moved or resized, a wall moved or thinned, a room reshaped, an
 * opening moved onto a column); records that break it still read.
 */

/** Within this distance of a room's outline a point counts as on it (as columns touch, 0.1 mm). */
const TOUCH_M = 1e-4;

const textOf = (value) =>
  typeof value === 'string'
    ? value.trim() || null
    : (value?.other?.[0]?.label ?? value?.choice?.[0]?.label ?? null);

/** A column's name: its identifier, else its place in its room ("C#2"). */
const columnName = (column, index) => textOf(column.values?.column_identifier) || `C#${index + 1}`;

/** An opening's name: its label, else "the door" / "the window". */
function openingName(floor, id) {
  for (const wall of floor.walls)
    for (const [kind, list] of [
      ['door', wall.doors],
      ['window', wall.windows],
    ]) {
      const opening = list.find((entry) => entry.id === id);
      if (opening) return textOf(opening.values?.[`${kind}_label`]) || `the ${kind}`;
    }
  return 'an opening';
}

/** The floor as the column checks read it: the canvas snapshot's shapes, in metres. */
function viewOf(floor) {
  const { wallFootprints, physicalOpenings } = buildingPlanFootprints(floor, 1);
  const rooms = floor.rooms.map((room) => {
    const bounds = roomBounds(room);
    return { id: room.id, vertices: room.vertices, rect: bounds };
  });
  const columns = floor.rooms.flatMap((room, roomIndex) =>
    room.columns
      .filter((column) => column.position && column.width > 0 && column.height > 0)
      .map((column) => {
        const { rect } = rooms[roomIndex];
        return {
          id: column.id,
          roomId: room.id,
          centerU: (column.position.x - rect.x) / rect.width,
          centerV: (column.position.y - rect.y) / rect.height,
          width: column.width,
          height: column.height,
        };
      })
  );
  // The rooms' walls with their faces and midlines, as the canvas snapshot has them (a column
  // may stand out of a wall it is centred on, or sits in flush with its interior face).
  const same = (point) => point;
  const walls = floor.rooms.flatMap((room) =>
    room.faces.map((face) => {
      const physical = floor.walls.find((wall) => wall.id === face.wallId);
      const portions = buildingPlanFaceSegments(floor, room, face).map((part) =>
        part.direction > 0 ? part : { ...part, start: part.end, end: part.start }
      );
      return {
        id: face.id,
        roomId: room.id,
        physicalWallId: face.wallId,
        isBoundary: !face.freePath,
        isCutPortion: Boolean(face.freePath?.some((point) => point.editingCutId)),
        points: portions.flatMap((part, index) => (index ? [part.end] : [part.start, part.end])),
        axisPoints: physical ? buildingPlanFaceAxes(physical, portions, same) : [],
      };
    })
  );
  return { gridSize: 1, rooms, walls, columns, wallFootprints, physicalOpenings };
}

/** Whether a column's place or size differs from the one in `before` (or it is new). */
const changed = (column, before) => {
  const old = before?.rooms.flatMap((room) => room.columns).find((entry) => entry.id === column.id);
  return (
    !old ||
    old.position?.x !== column.position?.x ||
    old.position?.y !== column.position?.y ||
    old.width !== column.width ||
    old.height !== column.height
  );
};

/**
 * The columns of `floor` out of their room and its walls, or over another column or an opening,
 * one issue each (a pair reported once, from the column the edit changed when there is one).
 * @param {object} floor the edited floor
 * @param {object | null} before the floor before the edit
 * @returns {object[]} issues
 */
export function columnPlacementIssues(floor, before = null) {
  if (!floor.rooms.some((room) => room.columns.length)) return [];
  const view = viewOf(floor);
  const order = floor.rooms
    .flatMap((room) =>
      room.columns.map((column, index) => ({ room, column, name: columnName(column, index) }))
    )
    .filter(({ column }) => column.position && column.width > 0 && column.height > 0)
    .sort((a, b) => Number(changed(b.column, before)) - Number(changed(a.column, before)));
  const names = new Map(order.map(({ column, name }) => [column.id, name]));
  const reported = new Set();
  const issues = [];
  for (const { room, column, name } of order) {
    if (reported.has(column.id)) continue;
    const clash = columnClash(
      column.position,
      { x: column.width / 2, y: column.height / 2 },
      columnTargets(view, { roomId: room.id, columnId: column.id }),
      1
    );
    if (!clash) continue;
    reported.add(column.id);
    const subject = { type: 'columns', id: column.id };
    if (clash.kind === 'outside')
      issues.push(
        planIssue('column_outside_room', `Column ${name} would leave its room.`, subject)
      );
    else if (clash.kind === 'column') {
      reported.add(clash.id);
      issues.push(
        planIssue(
          'column_overlap',
          `Column ${name} would overlap column ${names.get(clash.id) || 'another column'}.`,
          subject,
          { columnIds: [clash.id] }
        )
      );
    } else
      issues.push(
        planIssue(
          'column_overlap',
          `Column ${name} would overlap ${openingName(floor, clash.id)}.`,
          subject,
          { openingIds: [clash.id] }
        )
      );
  }
  return issues;
}

/** Whether `point` lies inside `vertices` or within `TOUCH_M` of its outline. */
function inOrOn(point, vertices) {
  if (pointInPolygon(point, vertices, true)) return true;
  return vertices.some((start, index) => {
    const frame = segmentFrame(start, vertices[(index + 1) % vertices.length]);
    const { along, offset } = project(frame, point);
    if (along >= 0 && along <= frame.length) return Math.abs(offset) <= TOUCH_M;
    return Math.hypot(point.x - start.x, point.y - start.y) <= TOUCH_M;
  });
}

/**
 * Whether segment `a`–`b` lies inside the outline, touching allowed: cut where it meets the
 * outline's edges and passes its corners, every piece lies on one side of the outline, so its
 * middle tells (an L-shaped room's notch is caught even with both ends inside).
 */
function segmentInside(a, b, vertices) {
  if (!inOrOn(a, vertices) || !inOrOn(b, vertices)) return false;
  const span = subtract(b, a);
  const lengthSquared = dot(span, span);
  if (lengthSquared <= EPS * EPS) return true;
  const cuts = [0, 1];
  vertices.forEach((start, index) => {
    const edge = subtract(vertices[(index + 1) % vertices.length], start);
    const offset = subtract(start, a);
    const denominator = cross(span, edge);
    if (Math.abs(denominator) > EPS) {
      const u = cross(offset, span) / denominator;
      if (u >= 0 && u <= 1) cuts.push(cross(offset, edge) / denominator);
    }
    cuts.push(dot(offset, span) / lengthSquared);
  });
  const sorted = cuts.filter((t) => t >= 0 && t <= 1).sort((p, q) => p - q);
  return sorted.every((t, index) => {
    if (!index || t - sorted[index - 1] <= EPS) return true;
    const middle = (t + sorted[index - 1]) / 2;
    return inOrOn({ x: a.x + span.x * middle, y: a.y + span.y * middle }, vertices);
  });
}

/**
 * The free walls of `floor` whose line leaves their room's outline, one issue per row (a wall
 * drawn with turns has a row per straight run, W9 and W9.1, each named). The line is the one the
 * wall is drawn by and the canvas keeps inside: its centreline (4a-3; its stored face before).
 * @param {object} floor the edited floor
 * @returns {object[]} issues
 */
export function freeWallPlacementIssues(floor) {
  const issues = [];
  for (const room of floor.rooms) {
    if (!(room.vertices?.length >= 3)) continue;
    for (const face of room.faces || []) {
      if (!face.freePath?.length) continue;
      const path = faceCentreline(floor, room, face);
      if (!path.length) continue;
      if (
        path.every((point, index) => !index || segmentInside(path[index - 1], point, room.vertices))
      )
        continue;
      const wall = floor.walls.find((entry) => entry.id === face.wallId);
      const name = textOf(wall?.values?.wall_label) || wall?.autoLabel || null;
      issues.push(
        planIssue(
          'free_wall_outside_room',
          name ? `Wall ${name} would leave its room.` : 'A wall would leave its room.',
          { type: 'room_face', id: face.id }
        )
      );
    }
  }
  return issues;
}
