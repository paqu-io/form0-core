import assert from 'node:assert/strict';

import { buildFormRecordSnapshot, normalizeStructuredRecord } from '../src/index.js';

function createNumericField({ key, data_name, label = data_name, default_value = null }) {
  return {
    type: 'NumericField',
    key,
    data_name,
    label,
    display: 'default',
    description: null,
    description_mode: null,
    required: false,
    required_conditions: null,
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    default_value,
    min: null,
    max: null,
    format: 'integer',
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
  };
}

function createSingleChoiceField({ key, data_name, label = data_name, choices }) {
  return {
    type: 'SingleChoiceField',
    key,
    data_name,
    label,
    display: 'default',
    description: null,
    description_mode: null,
    required: false,
    required_conditions: null,
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    default_value: null,
    allow_other: false,
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
    is_searchable: true,
    is_searchable_mode: 'default',
    choices,
  };
}

function createCalculatedField({ key, data_name, label = data_name, calculate }) {
  return {
    type: 'CalculatedField',
    key,
    data_name,
    label,
    display: { style: 'numeric' },
    description: null,
    description_mode: null,
    required: false,
    visible: true,
    visible_conditions: null,
    read_only: true,
    calculate,
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
  };
}

function createRepeatableSection({ key, data_name, label = data_name, elements }) {
  return {
    type: 'RepeatableSection',
    key,
    data_name,
    label,
    display: 'drilldown',
    description: null,
    description_mode: null,
    visible: true,
    visible_conditions: null,
    location_enabled: false,
    location_required: false,
    elements,
  };
}

const schema = {
  form: {
    name: 'Normalization Test',
    status_field: {
      type: 'StatusField',
      key: '@status',
      data_name: 'status',
      label: 'Status',
      display: 'default',
      enabled: true,
      visible: true,
      visible_conditions: null,
      read_only: false,
      read_only_conditions: null,
      default_value: 'pending',
      choices: [
        { label: 'Pending', value: 'pending', color: '#FFA500' },
        { label: 'Completed', value: 'completed', color: '#00AA00' },
      ],
    },
    title_field: {
      type: 'TitleField',
      key: '@title',
      data_name: 'title',
      label: 'Title',
      display: 'default',
      enabled: true,
      visible: true,
      visible_conditions: null,
      read_only: true,
      read_only_conditions: null,
      elements: ['city'],
    },
    elements: [
      createSingleChoiceField({
        key: 'city',
        data_name: 'city',
        choices: [
          { label: 'Roma', value: 'rome' },
          { label: 'Milano', value: 'milan' },
        ],
      }),
      createNumericField({
        key: 'base_amount',
        data_name: 'base_amount',
        default_value: 20,
      }),
      createCalculatedField({
        key: 'double_amount',
        data_name: 'double_amount',
        calculate: 'SETRESULT(($base_amount ?? 0) * 2)',
      }),
      createRepeatableSection({
        key: 'rooms',
        data_name: 'rooms',
        elements: [
          createSingleChoiceField({
            key: 'room_type',
            data_name: 'room_type',
            choices: [
              { label: 'Kitchen', value: 'kitchen' },
              { label: 'Bedroom', value: 'bedroom' },
            ],
          }),
        ],
      }),
    ],
  },
};

const legacyRecord = {
  '@status': 'pending',
  '@title': 'Old Rome',
  created_at_client: '2026-04-02T09:00:00.000Z',
  updated_at_client: '2026-04-02T09:05:00.000Z',
  form_values: {
    city: {
      choice: [{ value: 'rome', label: 'Old Rome' }],
      other: [],
    },
    rooms: [
      {
        id: 'room-1',
        form_values: {
          room_type: {
            choice: [{ value: 'kitchen', label: 'Legacy Kitchen' }],
            other: [],
          },
        },
      },
    ],
  },
};

(() => {
  const normalized = normalizeStructuredRecord(schema, legacyRecord, {
    mode: 'derived',
  });

  assert.equal(
    normalized.form_values.city.choice[0].value,
    'rome',
    'normalization should keep canonical choice values stable'
  );
  assert.equal(
    normalized.form_values.city.choice[0].label,
    'Roma',
    'normalization should refresh root choice labels from the current schema'
  );
  assert.equal(
    normalized['@title'],
    'Roma',
    'normalization should recompute the record title from current schema display values'
  );
  assert.equal(
    legacyRecord['@title'],
    'Old Rome',
    'normalization must not mutate the source record'
  );
})();

(() => {
  const normalized = normalizeStructuredRecord(schema, legacyRecord, {
    mode: 'derived',
  });

  assert.equal(
    normalized.form_values.rooms[0].form_values.room_type.choice[0].label,
    'Kitchen',
    'normalization should refresh nested repeatable choice labels'
  );
})();

(() => {
  const snapshot = buildFormRecordSnapshot(schema, legacyRecord, {
    mode: 'editor',
  });

  assert.equal(
    snapshot.raw_values.status,
    'pending',
    'editor snapshots should expose the current status field value'
  );
  assert.equal(
    snapshot.raw_values.base_amount,
    20,
    'editor snapshots should hydrate defaults for missing values'
  );
  assert.equal(
    snapshot.raw_values.double_amount,
    40,
    'editor snapshots should evaluate calculated fields against hydrated defaults'
  );
  assert.equal(
    snapshot.repeatable.rooms[0].values.room_type.choice[0].label,
    'Kitchen',
    'editor snapshots should keep normalized nested repeatable values'
  );
  assert.deepEqual(
    legacyRecord.form_values.base_amount,
    undefined,
    'editor hydration must not persist hydrated defaults back into the source record'
  );
})();

console.log('structured-record tests passed');
