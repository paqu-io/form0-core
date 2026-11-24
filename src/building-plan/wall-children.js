/**
 * What a physical wall carries along its length: doors, windows and beams (wall beams,
 * 2026-11-24). Each is stored once, on the physical wall (`source`, the model's `list`), with a
 * copy in each room's wall row (`copy`), and sits `offset` metres from the segment's start over
 * its `span` (an opening's width, a beam's length). `fields`: its system fields and the model
 * attributes they hold, as an edit typed in a row sends them.
 */
export const WALL_CHILDREN = Object.freeze([
  {
    source: 'doors',
    copy: 'face_doors',
    list: 'doors',
    type: 'door',
    offset: 'door_offset',
    span: 'door_width',
    spanKey: 'width',
    fields: [
      ['door_width', 'width'],
      ['door_height', 'height'],
      ['door_offset', 'offset'],
    ],
  },
  {
    source: 'windows',
    copy: 'face_windows',
    list: 'windows',
    type: 'window',
    offset: 'window_offset',
    span: 'window_width',
    spanKey: 'width',
    fields: [
      ['window_width', 'width'],
      ['window_height', 'height'],
      ['window_offset', 'offset'],
      ['window_distance_from_floor', 'sillHeight'],
    ],
  },
  {
    source: 'wall_beams',
    copy: 'face_beams',
    list: 'beams',
    type: 'beam',
    offset: 'wall_beam_offset',
    span: 'wall_beam_length',
    spanKey: 'length',
    fields: [
      ['wall_beam_offset', 'offset'],
      ['wall_beam_length', 'length'],
      ['wall_beam_width', 'width'],
      ['wall_beam_depth', 'depth'],
      ['wall_beam_distance_from_floor', 'underside'],
    ],
  },
]);

/** The entry for a node key: a wall child's collection or its copy in a room's wall row. */
export function wallChildForNode(nodeKey) {
  return WALL_CHILDREN.find((entry) => entry.source === nodeKey || entry.copy === nodeKey) || null;
}

/** The entry for a model element's `type` (door, window, beam). */
export function wallChildForType(type) {
  return WALL_CHILDREN.find((entry) => entry.type === type) || null;
}

/** Everything a wall carries, doors, windows and beams, in that order. */
export function wallChildren(wall) {
  return WALL_CHILDREN.flatMap((entry) => wall?.[entry.list] || []);
}

/** How far a wall child reaches along its wall (an opening's width, a beam's length). */
export function spanOf(element) {
  return element?.[wallChildForType(element?.type)?.spanKey || 'width'];
}

/** A wall child's name as its row shows it (a door's label, a beam's ID). */
export function labelOf(element) {
  const child = wallChildForType(element?.type);
  const field = child?.type === 'beam' ? 'wall_beam_identifier' : `${element?.type}_label`;
  return element?.values?.[field] || child?.type || 'opening';
}
