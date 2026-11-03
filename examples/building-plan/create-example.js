import {
  FIELD_SPECS,
  createBuildingPlanSession,
  expandBuildingPlanSchema,
  writeBuildingPlanRecord,
  createStructuredRecord,
} from '../../src/index.js';

function field(type, name, label, extra = {}) {
  const required = {};
  for (const [key, attr] of Object.entries(FIELD_SPECS[type].attributes)) {
    if (!attr.required) continue;
    required[key] =
      attr.value ??
      (attr.nullable
        ? null
        : (attr.allowedValues?.[0] ??
          { string: '', boolean: false, array: [], object: {}, number: 0 }[attr.type]));
  }
  return {
    ...required,
    type,
    key: name,
    data_name: name,
    label,
    visible: true,
    ...(type === 'NumericField' ? { format: 'float' } : {}),
    ...extra,
  };
}
export function createBuildingPlanExample() {
  const schema = {
    form: {
      name: 'BuildingPlan shared-wall acceptance',
      elements: [
        {
          type: 'BuildingPlanSection',
          key: 'plan',
          data_name: 'plan',
          label: 'Building plan',
          description: null,
          description_mode: null,
          visible: true,
          visible_conditions: null,
          read_only: false,
          read_only_conditions: null,
          node_overrides: {
            floors: { extra_elements: [field('TextField', 'floor_note', 'Floor note')] },
            rooms: { extra_elements: [field('TextField', 'room_note', 'Room note')] },
            walls: {
              extra_elements: [
                field('TextField', 'finish', 'Room-side finish'),
                field('TextField', 'material', 'Construction material', {
                  default_value: 'Masonry',
                }),
                field('NumericField', 'measured_thickness', 'Observed thickness (m)'),
              ],
              field_bindings: {
                material: { scope: 'physical_wall', inherit: true },
                measured_thickness: { scope: 'observation' },
              },
            },
          },
        },
      ],
    },
  };
  const expanded = expandBuildingPlanSchema(schema);
  const meta = expanded.buildingPlanMeta[0];
  let serial = 0;
  const domain = createBuildingPlanSession({
    createId: () => `acceptance-subject-${++serial}`,
    properties: meta.properties,
  });
  const apply = (operation) => {
    const result = domain.apply(operation);
    if (result.status !== 'applied') throw new Error(JSON.stringify(result.issues));
    return result;
  };
  const choice = (value, label) => ({ choice: [{ value, label }], other: [] });
  const floorId = apply({
    type: 'create_floor',
    values: {
      floor_name: choice('ground_floor', 'Ground Floor'),
      floor_elevation_m: 0,
      floor_height_m: 3,
      floor_note: 'Keep this earlier floor answer',
    },
    defaults: { wall_height_m: 3, wall_thickness_m: 0.2, material: 'Masonry' },
  }).created.id;
  for (const rectangle of [
    { x: 0, y: 0, width: 5, height: 3 },
    { x: 3, y: 3.2, width: 5, height: 3 },
  ])
    apply({
      type: 'create_room',
      floorId,
      rectangle,
      values: { room_name: choice('bedroom', 'Bedroom') },
    });
  let floor = domain.getSnapshot().floors[0];
  const faceA = floor.rooms[0].faces[2].id,
    faceB = floor.rooms[1].faces[0].id;
  apply({ type: 'bind_faces', floorId, referenceFaceId: faceA, faceId: faceB });
  floor = domain.getSnapshot().floors[0];
  const wallId = floor.rooms[0].faces[2].wallId;
  apply({
    type: 'create_opening',
    floorId,
    wallId,
    kind: 'door',
    offset: 3.5,
    width: 0.9,
    height: 2,
    values: { door_label: 'Shared door' },
  });
  apply({
    type: 'add_observation',
    floorId,
    subject: { type: 'room_face', id: faceA },
    observedAt: '2026-11-02',
    coverage: { interval: [3, 5], unit: 'm' },
    evidence: ['fixture-photo-reference'],
    values: { measured_thickness: 0.19 },
  });
  const record = writeBuildingPlanRecord({
    meta,
    plan: domain.getSnapshot(),
    createRowId: () => `acceptance-row-${++serial}`,
  });
  const stored = createStructuredRecord(record, expanded.schema.form.elements, {
    originalElements: expanded.schema.form.elements,
    fieldKeyMode: 'prefer-key',
  });
  return {
    schema,
    meta,
    record,
    stored,
    snapshot: domain.getSnapshot(),
    floorId,
    faceA,
    faceB,
    wallId,
  };
}
