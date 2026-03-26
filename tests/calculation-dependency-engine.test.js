import assert from 'node:assert/strict';

import { createFormEngine, WarningSystem } from '../src/index.js';

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

(() => {
  const schema = {
    form: {
      name: 'Chained Calculations',
      description: null,
      elements: [
        createCalculatedField({
          key: 'calc_total',
          data_name: 'calc_total',
          calculate: 'SETRESULT(($calc_source ?? 0) + 50)',
        }),
        createCalculatedField({
          key: 'calc_source',
          data_name: 'calc_source',
          calculate: 'SETRESULT(23)',
        }),
      ],
    },
  };

  const engine = createFormEngine({ schema });
  engine.eval();

  assert.equal(engine.getState().values.calc_source, 23);
  assert.equal(engine.getState().values.calc_total, 73);
})();

(() => {
  const calcFields = [];
  for (let index = 1; index <= 36; index += 1) {
    const dataName = `calc_${index}`;
    const calculate =
      index === 36
        ? 'SETRESULT(($base_value ?? 0) + 1)'
        : `SETRESULT(($calc_${index + 1} ?? 0) + 1)`;

    calcFields.push(
      createCalculatedField({
        key: dataName,
        data_name: dataName,
        calculate,
      })
    );
  }

  const schema = {
    form: {
      name: 'Dozens Of Calculations',
      description: null,
      elements: [...calcFields, createNumericField({ key: 'base_value', data_name: 'base_value' })],
    },
  };

  const engine = createFormEngine({
    schema,
    initialValues: {
      base_value: 4,
    },
  });

  engine.eval();
  assert.equal(engine.getState().values.calc_36, 5);
  assert.equal(engine.getState().values.calc_1, 40);

  engine.getState().values.base_value = 10;
  engine.eval();
  assert.equal(engine.getState().values.calc_36, 11);
  assert.equal(engine.getState().values.calc_1, 46);
})();

(() => {
  const schema = {
    form: {
      name: 'Repeatable Ancestor Chain',
      description: null,
      elements: [
        createNumericField({
          key: 'project_multiplier',
          data_name: 'project_multiplier',
        }),
        {
          type: 'RepeatableSection',
          key: 'rooms',
          data_name: 'rooms',
          label: 'Rooms',
          display: 'drilldown',
          description: null,
          description_mode: null,
          visible: true,
          visible_conditions: null,
          location_enabled: false,
          location_required: false,
          elements: [
            createCalculatedField({
              key: 'room_total',
              data_name: 'room_total',
              calculate: 'SETRESULT(($room_base ?? 0) + ($project_multiplier ?? 0))',
            }),
            createCalculatedField({
              key: 'room_base',
              data_name: 'room_base',
              calculate: 'SETRESULT(23)',
            }),
          ],
        },
      ],
    },
  };

  const engine = createFormEngine({
    schema,
    initialValues: {
      project_multiplier: 5,
    },
  });

  engine.eval();

  assert.equal(engine.getState().values.room_base, 23);
  assert.equal(engine.getState().values.room_total, 28);
})();

(() => {
  const warningSystem = new WarningSystem({
    enableCollection: true,
    enableConsoleWarnings: false,
    throttleMs: 0,
  });
  const schema = {
    form: {
      name: 'Dynamic Calculation Dependencies',
      description: null,
      elements: [
        createCalculatedField({
          key: 'calc_target',
          data_name: 'calc_target',
          calculate: 'SETRESULT(EVAL("\'$calc_source\'"))',
        }),
        createCalculatedField({
          key: 'calc_source',
          data_name: 'calc_source',
          calculate: 'SETRESULT(23)',
        }),
      ],
    },
  };

  const engine = createFormEngine({
    schema,
    warningSystem,
    runtimeDiagnostics: [],
  });

  engine.eval();

  const warnings = warningSystem.getCollectedWarnings();
  assert.equal(engine.getState().values.calc_target, 23);
  assert.equal(
    warnings.some((warning) => /dynamic field access/.test(warning.message)),
    true
  );
})();

(() => {
  const warningSystem = new WarningSystem({
    enableCollection: true,
    enableConsoleWarnings: false,
    throttleMs: 0,
  });
  const runtimeDiagnostics = [];
  const schema = {
    form: {
      name: 'Non Converging Cycle',
      description: null,
      elements: [
        createCalculatedField({
          key: 'calc_a',
          data_name: 'calc_a',
          calculate: 'SETRESULT(($calc_b ?? 0) + 1)',
        }),
        createCalculatedField({
          key: 'calc_b',
          data_name: 'calc_b',
          calculate: 'SETRESULT(($calc_a ?? 0) + 1)',
        }),
      ],
    },
  };

  const engine = createFormEngine({
    schema,
    warningSystem,
    runtimeDiagnostics,
  });

  engine.eval();

  assert.equal(
    warningSystem
      .getCollectedWarnings()
      .some((warning) => /did not stabilize/.test(warning.message)),
    true
  );
  assert.equal(
    runtimeDiagnostics.some((diagnostic) => /did not stabilize/.test(diagnostic.message)),
    true
  );
})();
