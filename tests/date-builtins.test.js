import assert from 'node:assert/strict';

import { createFormEngine } from '../src/index.js';
import { DATEADD, DAYS } from '../src/builtins/registry.js';
import { parseIsoDate } from '../src/utilities/date-utils.js';

function createDateField({ key, data_name, default_value = null }) {
  return {
    type: 'DateField',
    key,
    data_name,
    label: data_name,
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
  };
}

function createCalculatedField({ key, data_name, calculate, style = 'date' }) {
  return {
    type: 'CalculatedField',
    key,
    data_name,
    label: data_name,
    display: { style },
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

// DATEADD: calendar arithmetic across month, year, leap-day, and DST boundaries.
(() => {
  assert.equal(DATEADD('2015-01-01', 10), '2015-01-11');
  assert.equal(DATEADD('2015-01-31', 90), '2015-05-01');
  assert.equal(DATEADD('2024-02-28', 1), '2024-02-29');
  assert.equal(DATEADD('2025-02-28', 1), '2025-03-01');
  assert.equal(DATEADD('2026-12-31', 1), '2027-01-01');
  assert.equal(DATEADD('2026-03-29', 1), '2026-03-30');
  assert.equal(DATEADD('2026-10-25', 1), '2026-10-26');
  assert.equal(DATEADD('2026-03-01', -1), '2026-02-28');
  assert.equal(DATEADD('2026-03-01', 0), '2026-03-01');
})();

// DATEADD: blank arguments return null; invalid arguments throw.
(() => {
  assert.equal(DATEADD(null, 5), null);
  assert.equal(DATEADD(undefined, 5), null);
  assert.equal(DATEADD('', 5), null);
  assert.equal(DATEADD('2026-01-01', null), null);

  assert.throws(() => DATEADD('2026-02-30', 1), /YYYY-MM-DD/);
  assert.throws(() => DATEADD('2026-1-5', 1), /YYYY-MM-DD/);
  assert.throws(() => DATEADD('2026-01-05T10:00:00Z', 1), /YYYY-MM-DD/);
  assert.throws(() => DATEADD(new Date(), 1), /YYYY-MM-DD/);
  assert.throws(() => DATEADD('2026-01-05', 1.5), /whole number/);
  assert.throws(() => DATEADD('2026-01-05', '3'), /whole number/);
  assert.equal(DATEADD('0099-01-01', 1), '0099-01-02');
  assert.throws(() => DATEADD('0000-01-01', 1), /YYYY-MM-DD/);
  assert.throws(() => DATEADD('9999-12-31', 1), /supported date range/);
  assert.throws(() => DATEADD('0001-01-01', -1), /supported date range/);
  assert.throws(() => DATEADD('1970-01-01', Number.MAX_SAFE_INTEGER), /supported date range/);
})();

// DAYS: signed difference in calendar days, end date first.
(() => {
  assert.equal(DAYS('2026-01-11', '2026-01-01'), 10);
  assert.equal(DAYS('2026-01-01', '2026-01-11'), -10);
  assert.equal(DAYS('2026-01-01', '2026-01-01'), 0);
  assert.equal(DAYS('2024-03-01', '2024-02-28'), 2);
  assert.equal(DAYS('2026-03-30', '2026-03-28'), 2);

  assert.equal(DAYS(null, '2026-01-01'), null);
  assert.equal(DAYS('2026-01-01', ''), null);
  assert.throws(() => DAYS('2026-02-30', '2026-01-01'), /YYYY-MM-DD/);
})();

// parseIsoDate supports four-digit years below 0100 without Date.UTC's 1900s remapping.
(() => {
  assert.equal(parseIsoDate('0099-01-01'), -683_368);
  assert.equal(parseIsoDate('0000-01-01'), null);
  assert.equal(parseIsoDate('1970-01-01'), 0);
})();

// A DateField with default_value "now" uses the local calendar day.
(() => {
  const OriginalDate = globalThis.Date;
  const originalTimezone = process.env.TZ;
  const fixedInstant = '2027-01-01T00:30:00.000Z';

  process.env.TZ = 'America/New_York';
  globalThis.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixedInstant] : args));
    }

    static now() {
      return new OriginalDate(fixedInstant).getTime();
    }
  };

  try {
    const schema = {
      form: {
        name: 'Date Defaults',
        description: null,
        elements: [
          createDateField({ key: 'opened_on', data_name: 'opened_on', default_value: 'now' }),
        ],
      },
    };

    const engine = createFormEngine({ schema });
    engine.eval();

    assert.equal(engine.getState().values.opened_on, '2026-12-31');
  } finally {
    globalThis.Date = OriginalDate;
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
})();

// Date builtins inside calculations, including a blank date and chained calculations.
(() => {
  const schema = {
    form: {
      name: 'Date Calculations',
      description: null,
      elements: [
        createDateField({ key: 'received_on', data_name: 'received_on' }),
        createCalculatedField({
          key: 'respond_by',
          data_name: 'respond_by',
          calculate: 'DATEADD($received_on, 10)',
        }),
        createCalculatedField({
          key: 'window_days',
          data_name: 'window_days',
          calculate: 'DAYS($respond_by, $received_on)',
          style: 'numeric',
        }),
      ],
    },
  };

  const engine = createFormEngine({ schema });
  engine.eval();
  assert.equal(engine.getState().values.respond_by, null);
  assert.equal(engine.getState().values.window_days, null);

  engine.getState().values.received_on = '2026-12-28';
  engine.eval();
  assert.equal(engine.getState().values.respond_by, '2027-01-07');
  assert.equal(engine.getState().values.window_days, 10);
})();

// Date builtins are also available to synchronous event handlers.
(() => {
  const schema = {
    form: {
      name: 'Date Events',
      description: null,
      elements: [
        createDateField({ key: 'received_on', data_name: 'received_on' }),
        createCalculatedField({
          key: 'respond_by',
          data_name: 'respond_by',
          calculate: 'null',
        }),
        createCalculatedField({
          key: 'window_days',
          data_name: 'window_days',
          calculate: 'null',
          style: 'numeric',
        }),
      ],
      events: {
        code: `
          ON('change', 'received_on', function () {
            SETVALUE('respond_by', DATEADD($received_on, 10));
            SETVALUE('window_days', DAYS(DATEADD($received_on, 10), $received_on));
          });
        `,
      },
    },
  };

  const engine = createFormEngine({
    schema,
    initialValues: { received_on: '2026-12-28' },
  });
  engine.eval();

  const operations = engine.trigger('change', 'received_on');
  assert.deepEqual(
    operations.map((operation) => [operation.params.fieldDataName, operation.params.valueToSet]),
    [
      ['respond_by', '2027-01-07'],
      ['window_days', 10],
    ]
  );
})();

console.log('Date builtin tests passed.');
