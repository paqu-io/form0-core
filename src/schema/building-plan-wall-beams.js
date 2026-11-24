import { BAND_KINDS } from './building-plan-floors.js';

/**
 * Beams carried by a wall (decided 2026-11-24, WB1 to WB10; form0-react
 * `analyses/building-plan-ui.md`, "Wall beams"). Stored once on the physical wall, like its doors
 * and windows, with a copy in each room's wall row. Along the wall a beam is its distance from the
 * wall's left end, seen from the room, and its length; its height is its underside from the floor,
 * the stored truth (P2: no position choice, no opening reference). Room beams get the same height
 * field.
 */

const base = (name, label, description) => ({
  key: `bp_${name}`,
  data_name: name,
  label,
  display: 'default',
  description,
  description_mode: description ? 'subtext' : null,
  required: true,
  required_conditions: null,
  visible: true,
  visible_conditions: null,
  read_only: false,
  read_only_conditions: null,
  default_value: null,
  supporting_image: false,
  supporting_image_path: null,
  supporting_image_display: null,
});
const number = (name, label, description = null, attributes = {}) => ({
  ...base(name, label, description),
  type: 'NumericField',
  min: null,
  max: null,
  format: 'float',
  ...attributes,
});
const text = (name, label, description, attributes = {}) => ({
  ...base(name, label, description),
  type: 'TextField',
  pattern: null,
  pattern_description: null,
  ...attributes,
});

const choice = (name, label, description, choices, attributes = {}) => ({
  ...base(name, label, description),
  type: 'SingleChoiceField',
  allow_other: false,
  is_searchable: false,
  is_searchable_mode: null,
  choices,
  ...attributes,
});

const UNDERSIDE = 'Measured from the finished floor to the underside of the beam.';

/**
 * Which band a wall beam is (bands 1, 2026-11-24, B): kept by the engine on the rows it keeps for
 * the wall's ring beam and bands, empty on a beam added by hand. Internal (hidden, read-only): a
 * band's row is titled by its kind.
 */
function bandKindField() {
  return choice(
    'wall_beam_band',
    'Band',
    "Kept from the wall's ring beam and bands.",
    BAND_KINDS.map(({ kind, title }) => ({ value: kind, label: title })),
    { required: false, read_only: true, visible: false }
  );
}

/** A room beam's height: its underside from the floor, filled when the beam is added. */
export function createBeamHeightField() {
  return number('beam_distance_from_floor', 'Underside from floor (m)', UNDERSIDE, { min: 0 });
}

/** The `wall_beams` node, a child of Wall. */
export function createWallBeamsNode() {
  return {
    repeatable: {
      type: 'RepeatableSection',
      key: 'bp_wall_beams',
      data_name: 'wall_beams',
      label: 'Beams',
      display: 'drilldown',
      description: 'Beams carried by this wall.',
      description_mode: 'default',
      visible: true,
      visible_conditions: null,
      location_enabled: false,
      location_required: false,
      elements: [],
    },
    canvas: null,
    mandatory_elements: [
      bandKindField(),
      text('wall_beam_identifier', 'Beam ID', 'Identifier shown on the canvas.'),
      number(
        'wall_beam_offset',
        'Distance from wall start (m)',
        "From the wall's left end, seen from this room.",
        { min: 0 }
      ),
      number('wall_beam_length', 'Length (m)', 'Along the wall.', { min: 0 }),
      number('wall_beam_distance_from_floor', 'Underside from floor (m)', UNDERSIDE, { min: 0 }),
      number(
        'wall_beam_width',
        'Width (m)',
        'Measured across the beam, in the direction of the wall thickness.'
      ),
      number('wall_beam_depth', 'Depth (m)', 'Vertical dimension of the beam.'),
      text(
        'wall_beam_wall_reference',
        'Wall reference',
        'Automatically populated with the parent wall identifier.',
        { read_only: true }
      ),
    ],
    extra_elements: [],
    children: [],
  };
}
