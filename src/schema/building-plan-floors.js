const condition = (field, value) => ({ field_id: `bp_${field}`, operator: 'equal_to', value });
/** A level with a structure above it: every floor name except Land survey and Roof. */
export const ENCLOSED_LEVEL = {
  and: ['land_survey', 'roof'].map((value) => ({
    ...condition('floor_name', value),
    operator: 'not_equal_to',
  })),
};
const base = (name, label) => ({
  key: `bp_${name}`,
  data_name: name,
  label,
  display: 'default',
  description: null,
  description_mode: null,
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
const number = (name, label, attributes = {}) => ({
  ...base(name, label),
  type: 'NumericField',
  min: null,
  max: null,
  format: 'float',
  ...attributes,
});
const choice = (name, label, choices, attributes = {}) => ({
  ...base(name, label),
  type: 'SingleChoiceField',
  allow_other: false,
  is_searchable: false,
  is_searchable_mode: null,
  choices: choices.map(([value, label]) => ({ value, label })),
  ...attributes,
});
const plasterChoices = [
  ['plastered', 'Plastered'],
  ['not_plastered', 'Not plastered'],
];

/** Compiler-owned definitions. Requiredness is independent of system ownership. */
export function createFloorSystemFields() {
  return [
    choice(
      'floor_name',
      'Name',
      [
        ['land_survey', 'Land survey'],
        ['basement', 'Basement floor'],
        ['ground_floor', 'Ground floor'],
        ['upper_floor', 'Upper floor'],
        ['roof', 'Roof'],
        ['mezzanine', 'Mezzanine'],
      ],
      { allow_other: true }
    ),
    number('floor_upper_number', 'Upper floor number', {
      format: 'integer',
      min: 1,
      required: false,
      visible: false,
      required_conditions: condition('floor_name', 'upper_floor'),
      visible_conditions: condition('floor_name', 'upper_floor'),
    }),
    number('floor_basement_number', 'Basement floor number', {
      format: 'integer',
      max: -1,
      required: false,
      visible: false,
      required_conditions: condition('floor_name', 'basement'),
      visible_conditions: condition('floor_name', 'basement'),
    }),
    number('floor_elevation', 'Story elevation [m]', {
      description_mode: 'subtext',
      description:
        "Measured from the finished floor of the building's ground floor. Ground floor is 0; levels above are positive and levels below are negative.",
    }),
    number('floor_height', 'Structural clear height [m]', {
      description_mode: 'subtext',
      required: false,
      required_conditions: ENCLOSED_LEVEL,
      description:
        'Measured from the finished floor to the underside of the floor or roof structure above. Ignore any suspended or false ceiling.',
    }),
    ...['interior', 'exterior'].flatMap((surface) => {
      const title = surface === 'interior' ? 'Interior' : 'Exterior';
      const status = `floor_${surface}_wall_plaster`;
      return [
        number(`floor_${surface}_wall_thickness`, `${title} predominant wall thickness [mm]`, {
          required: false,
          required_conditions: ENCLOSED_LEVEL,
        }),
        choice(status, `Select a default status for ${surface} wall plaster`, plasterChoices, {
          required: false,
          choices: plasterChoices.map(([value]) => ({
            value,
            label:
              value === 'plastered'
                ? `All the ${surface} walls are plastered`
                : `No ${surface} wall is plastered`,
          })),
        }),
        number(`${status}_thickness`, `${title} plaster thickness [mm]`, {
          required: false,
          visible: false,
          required_conditions: condition(status, 'plastered'),
          visible_conditions: condition(status, 'plastered'),
        }),
      ];
    }),
  ];
}

/** Fixed semantic routing; system definitions never enter authored node_overrides. */
export const FLOOR_SYSTEM_ROUTES = {
  floor_elevation: { property: 'room_elevation', inherit_to: 'rooms' },
  floor_height: { property: 'room_structural_clear_height', inherit_to: 'rooms' },
  ...Object.fromEntries(
    ['interior', 'exterior'].flatMap((surface) => [
      [
        `floor_${surface}_wall_thickness`,
        {
          property: 'wall_thickness',
          inherit_to: 'walls',
          scope: 'physical_wall',
          applies_to: { exposure: surface },
        },
      ],
      [
        `floor_${surface}_wall_plaster`,
        {
          property: 'wall_plaster',
          inherit_to: 'walls',
          scope: 'wall_face',
          on_split: 'copy',
          applies_to: { surface: surface === 'interior' ? 'room' : 'outside' },
        },
      ],
      [
        `floor_${surface}_wall_plaster_thickness`,
        {
          property: 'wall_plaster_thickness',
          inherit_to: 'walls',
          scope: 'wall_face',
          on_split: 'copy',
          applies_to: {
            surface: surface === 'interior' ? 'room' : 'outside',
            conditions: condition(`floor_${surface}_wall_plaster`, 'plastered'),
          },
        },
      ],
    ])
  ),
};

/**
 * Room values that set descendants' defaults (decided 2026-11-16): walls and columns stand up to
 * the room's structural clear height, inherited from the floor or set on the room. A wall shared
 * by rooms whose heights differ asks which one applies (conflicting_room_defaults).
 */
export const ROOM_SYSTEM_ROUTES = Object.freeze([
  {
    source: 'room_structural_clear_height',
    property: 'wall_height',
    inherit_to: 'walls',
    scope: 'physical_wall',
  },
  { source: 'room_structural_clear_height', property: 'column_height', inherit_to: 'columns' },
]);

/**
 * Heights required only on enclosed levels, as the floor's own height is. The condition reads the
 * owning floor's name; it could later become an ISREQUIRED()-style builtin.
 */
export const LEVEL_DEPENDENT_HEIGHTS = Object.freeze(['wall_height', 'column_height']);
