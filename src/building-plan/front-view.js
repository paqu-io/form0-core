import { bandOf } from './band-rows.js';
import { buildingPlanRoomSides } from './room-sides.js';
import { nameOf } from './wall-children.js';
import { at, cleanLength as clean, polygonArea, segmentFrame } from './geometry.js';
import { alongStrip, freeParts, sideParts } from './front-view-strip.js';
import { frontViewProblems } from './front-view-problems.js';
import { frontViewStructure, structureTops } from './front-view-structure.js';
import { frontViewMap } from './front-view-map.js';

/**
 * The front view of one wall row (A1, decided 2026-11-25): what the read-only Front view draws,
 * display only, nothing stored. Metres, from the left end of the row's side as seen from inside
 * its room (a free wall: its own length, from its row's side), so the shown row's lengths start
 * where its fields count (WB3). Given:
 *
 * - `pieces`: the walls along the side, corner to corner, end to end, the shown row's marked;
 *   a row on several sides is unfolded, `folds` where the sides meet;
 * - `openings`, `beams` (wall beams and bands): those of every row on the side, by their ends
 *   along it and their heights from the floor; one of unknown height isn't drawn;
 * - `columns`, `roomBeams`: the room's columns and beams against the side (2026-11-26,
 *   `front-view-structure.js`);
 * - `problems`: where the floor's problems clash in this view;
 * - `levels`: the shown row's, for its chain (the floor, its top when known, each beam's
 *   underside and top, each opening's sill and head);
 * - `fit`: the room's, for one scale across its rows: its longest row and tallest wall as drawn
 *   (its columns and beams included);
 * - `map`: the room in plan for the view's mini-map (2026-11-26, `front-view-map.js`);
 * - `around`: the room's outline rows clockwise on the plan, each where it starts, for a room's
 *   entry to step through (A3's hand test, 2026-11-26).
 *
 * A wall of unknown height is drawn to the room's highest level plus 0.5 m, at least 1 m: every
 * such wall of the room to the same height (decided 2026-11-25).
 */

const EPS = 1e-6;
const UNKNOWN_ABOVE = 0.5;
const UNKNOWN_LEAST = 1;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const heightOf = (wall) =>
  finite(wall?.properties?.wall_height) ? wall.properties.wall_height : null;

/**
 * @param {object} floor the plan's floor
 * @param {string} faceId a wall row of one of its rooms
 * @returns {object | null} null when the floor has no such row
 */
export function buildingPlanFrontView(floor, faceId) {
  const room = floor?.rooms?.find((entry) => entry.faces.some((face) => face.id === faceId));
  if (!room) return null;
  const walls = new Map((floor.walls || []).map((wall) => [wall.id, wall]));
  const faces = new Map(room.faces.map((face) => [face.id, face]));
  const sides = buildingPlanRoomSides(floor, room, 1);
  // Clockwise on the plan (y down): the outline as it runs when its area is positive.
  const outlineRows = sides.flatMap((side) => side.pieces.map((piece) => piece.faceId));
  if (polygonArea(room.vertices) < 0) outlineRows.reverse();
  const around = [...new Set(outlineRows.filter(Boolean))];
  const stripOf = (face) =>
    face.freePath ? freeParts(floor, room, face) : sideParts(sides, face.id);
  const face = faces.get(faceId);
  const parts = stripOf(face);
  if (!parts?.length) return null;
  const heights = roomHeights(room, walls);

  const pieces = parts.flatMap((part) =>
    part.pieces.map((piece) => {
      const wall = walls.get(faces.get(piece.faceId)?.wallId);
      const height = heightOf(wall);
      return {
        faceId: piece.faceId,
        label: wall?.values?.wall_label || wall?.autoLabel || '',
        from: piece.from,
        to: piece.to,
        height,
        drawnHeight: height ?? heights.unknown,
        shown: piece.faceId === faceId,
      };
    })
  );
  const rows = [...new Set(pieces.map((piece) => piece.faceId))]
    .map((id) => faces.get(id))
    .filter(Boolean);
  const { openings, beams } = elementsOf(rows, parts, walls);
  const drawnHeight = (id) =>
    pieces.find((piece) => piece.faceId === id)?.drawnHeight ?? heights.unknown;
  const { columns, roomBeams } = frontViewStructure(room, parts, drawnHeight);
  // Every row's strip: for the room's fit and each row's face on the map (A3).
  const strips = new Map(room.faces.map((entry) => [entry.id, stripOf(entry) || []]));
  const fitLength = Math.max(
    ...[...strips.values()].map((strip) => strip.reduce((sum, part) => sum + part.length, 0))
  );
  return {
    roomId: room.id,
    faceId,
    freeWall: Boolean(face.freePath),
    length: clean(parts.reduce((sum, part) => sum + part.length, 0)),
    around,
    folds: parts.slice(1).map((part) => clean(part.x0)),
    pieces,
    openings,
    beams,
    columns,
    roomBeams,
    problems: frontViewProblems(floor, { openings, beams }, walls),
    levels: levelsOf(heightOf(walls.get(face.wallId)), [...openings, ...beams], faceId),
    fit: { length: clean(fitLength), height: heights.fit },
    map: frontViewMap(floor, room, face, strips),
  };
}

/**
 * The room's highest level (its walls' known tops, their openings' heads, their beams' tops, its
 * columns' and room beams' tops), the height its walls of unknown height are drawn to, and the
 * height it fits.
 */
function roomHeights(room, walls) {
  let highest = Math.max(0, ...structureTops(room));
  let unknown = false;
  for (const wall of new Set(room.faces.map((face) => walls.get(face.wallId)).filter(Boolean))) {
    const height = heightOf(wall);
    if (height === null) unknown = true;
    else highest = Math.max(highest, height);
    for (const opening of [...(wall.doors || []), ...(wall.windows || [])])
      if (finite(opening.height))
        highest = Math.max(highest, (opening.sillHeight || 0) + opening.height);
    for (const beam of wall.beams || [])
      if (finite(beam.underside) && finite(beam.depth))
        highest = Math.max(highest, beam.underside + beam.depth);
  }
  const drawn = clean(Math.max(UNKNOWN_LEAST, highest + UNKNOWN_ABOVE));
  return { unknown: drawn, fit: unknown ? drawn : clean(highest) };
}

/** The doors, windows, wall beams and bands of the rows on the strip, along it. */
function elementsOf(rows, parts, walls) {
  const openings = [];
  const beams = new Map();
  const seen = new Set();
  for (const face of rows) {
    const wall = walls.get(face.wallId);
    for (const binding of face.bindings || []) {
      const part = parts.find((entry) => entry.holds(binding));
      const segment = wall?.segments.find((entry) => entry.id === binding.segmentId);
      if (!part || !segment) continue;
      const frame = segmentFrame(segment.start, segment.end);
      const span = (from, to) => {
        const ends = [from, to].map((offset) => alongStrip(part, at(frame, offset)));
        return { from: clean(Math.min(...ends)), to: clean(Math.max(...ends)) };
      };
      const [low, high] = binding.interval;
      for (const [list, kind] of [
        ['doors', 'door'],
        ['windows', 'window'],
      ])
        for (const opening of wall[list] || []) {
          if (seen.has(opening.id) || opening.segmentId !== segment.id) continue;
          if (!finite(opening.height)) continue;
          if (opening.offset < low - EPS || opening.offset + opening.width > high + EPS) continue;
          seen.add(opening.id);
          const sill = opening.sillHeight || 0;
          openings.push({
            subjectId: opening.id,
            faceId: face.id,
            kind,
            name: nameOf(opening),
            ...span(opening.offset, opening.offset + opening.width),
            bottom: clean(sill),
            top: clean(sill + opening.height),
          });
        }
      for (const beam of wall.beams || []) {
        if (beam.segmentId !== segment.id) continue;
        if (!finite(beam.underside) || !finite(beam.depth)) continue;
        const from = Math.max(beam.offset, low);
        const to = Math.min(beam.offset + beam.length, high);
        if (!(to - from > EPS)) continue;
        const stretch = span(from, to);
        // A beam over two bindings of one row is one stretch.
        const key = `${beam.id}|${face.id}`;
        const known = beams.get(key);
        beams.set(key, {
          subjectId: beam.id,
          faceId: face.id,
          band: bandOf(beam),
          name: nameOf(beam),
          from: known ? Math.min(known.from, stretch.from) : stretch.from,
          to: known ? Math.max(known.to, stretch.to) : stretch.to,
          bottom: clean(beam.underside),
          top: clean(beam.underside + beam.depth),
        });
      }
    }
  }
  const byPlace = (a, b) => a.from - b.from || a.bottom - b.bottom;
  return { openings: openings.sort(byPlace), beams: [...beams.values()].sort(byPlace) };
}

/** The shown row's levels, rising: the floor, its top when known, its elements' edges. */
function levelsOf(top, elements, faceId) {
  const levels = [0];
  if (top !== null) levels.push(top);
  for (const element of elements)
    if (element.faceId === faceId) levels.push(element.bottom, element.top);
  return levels
    .map(clean)
    .sort((a, b) => a - b)
    .filter((level, index, all) => index === 0 || level - all[index - 1] > EPS);
}
