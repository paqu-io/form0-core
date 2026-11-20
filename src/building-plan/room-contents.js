import { buildingPlanFaceAxes, buildingPlanFootprints } from './footprints.js';
import { roomBounds } from './geometry.js';
import { buildingPlanFaceSegments, planIssue } from './model.js';
import { columnTargets } from './column-targets.js';
import { columnClash } from './column-fit.js';

/**
 * What a room holds stays where it may (the room contents rules, 2026-11-19; 4a-1 for columns,
 * 2026-11-20). A column lies inside its room plus the room's own walls (it may stand in them:
 * flush inside, centred on a wall's midline, flush with its far face) and may touch, but not
 * overlap, another column, a door or a window. Checked on the derived engine's edits, whatever
 * the edit (a column moved or resized, a wall moved or thinned, an opening moved onto it); records
 * that break it still read.
 */

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
