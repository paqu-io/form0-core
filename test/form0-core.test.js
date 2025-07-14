import { createFormEngine } from '../src/index.js';

const schema = {
  form: {
    name: 'MyForm',
    description: 'This is a test description',
    events: {
      code: `
        function alertTest (event) {
          ALERT('Welcome to South America!');
          ALERT('Welcome to Colombia!');
        }
        
        ON('load-record', alertTest);
      `
    },
    elements: [
      {
        type: 'Section',
        key: 'abcd1',
        data_name: 'personal_info',
        label: 'Personal Info',
        display: 'inline', //Section can be 'inline' or 'drilldown'
        elements: [
          {
            type: 'TextField',
            key: 'ef661',
            data_name: 'first_name',
            label: 'First Name',
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            pattern: '^[a-zA-Z]+$',
            pattern_description:
              'One or more letters (uppercase or lowercase), with no spaces, numbers, or symbols',
          },
          {
            type: 'SingleChoiceField',
            key: '0180f',
            data_name: 'city',
            label: 'City',
            display: 'default', //SingleChoiceField can be 'default' or 'radio'
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            allow_other: true, //SingleChoiceField can be true or false
            choices: [
              {
                label: 'Bogotá',
                value: 'bogota',
              },
              {
                label: 'Recanati',
                value: 'recanati',
              },
              {
                label: 'New York',
                value: 'new_york',
              },
              {
                label: 'São Paulo - Centro',
                value: 'sao_paulo_centro',
              },
            ],
          },
          {
            type: 'MultiChoiceField',
            key: '0332f',
            data_name: 'colors',
            label: 'Please select your favorite colors',
            display: 'default', //MultiChoiceField can be 'default' or 'checkbox'
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            allow_other: true, //MultiChoiceField can be true or false
            choices: [
              {
                label: 'Red',
                value: 'red',
              },
              {
                label: 'Blue',
                value: 'blue',
              },
              {
                label: 'Orange',
                value: 'orange',
              },
              {
                label: 'Yellow',
                value: 'yellow',
              },
            ],
          },
          {
            type: 'CalculatedField',
            key: 'ea322',
            data_name: 'city_calc',
            label: 'city_calc',
            required: false, //CalcualtedField is required = false by default
            hidden: false,
            visible_conditions: null,
            read_only: true, //CalcualtedField is read_only = true by default
            calculate: `
            const citySelection = CHOICEVALUE($city);
            SETRESULT(IF(OR(citySelection === "bogota", OTHER($city) === "Bogotá"), "Welcome to Bogotá!", "Welcome!"));
            `,
            display: {
              style: 'text', // or numeric, date, currency
            },
          },
          {
            type: 'CalculatedField',
            key: 'aa123',
            data_name: 'colors_calc',
            label: 'colors_calc',
            required: false, //CalcualtedField is required = false by default
            hidden: false,
            visible_conditions: null,
            read_only: true, //CalcualtedField is read_only = true by default
            calculate: 'CHOICELABELS($colors) + " -> Other: " + OTHER($colors)',
            display: {
              style: 'text', // or numeric, date, currency
            },
          },
          {
            type: 'NumericField',
            key: 'ccbb56',
            data_name: 'age',
            label: 'Age',
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            min: 16,
            max: 100,
            format: 'integer', //NumericField can be 'integer' or 'float'
          },
        ],
      },
      {
        type: 'CalculatedField',
        key: 'ea3a1',
        data_name: 'can_vote',
        label: 'Eligible',
        required: false, //CalcualtedField is required = false by default
        hidden: false,
        visible_conditions: null,
        read_only: true, //CalcualtedField is read_only = true by default
        calculate: 'IF($age >= 18, "yes", "no")',
        display: {
          style: 'text', // or numeric, date, currency
        },
      },
      {
        type: 'CalculatedField',
        key: 'e4567',
        data_name: 'calc_test',
        label: 'calc_test',
        required: false, //CalcualtedField is required = false by default
        hidden: false,
        visible_conditions: null,
        read_only: true, //CalcualtedField is read_only = true by default
        calculate: 'SETRESULT($age + 10 >= 30 ? true : false)',
        display: {
          style: 'text', // or numeric, date, currency
        },
      },
      {
        type: 'CalculatedField',
        key: 'ee123',
        data_name: 'calc_test_new',
        label: 'calc_test_new',
        required: false, //CalcualtedField is required = false by default
        hidden: false,
        visible_conditions: null,
        read_only: true, //CalcualtedField is read_only = true by default
        calculate: '$age + 88',
        display: {
          style: 'text', // or numeric, date, currency
        },
      },
      {
        type: 'Section',
        key: 'e4568',
        data_name: 'section_drill',
        label: 'Drilldown section test',
        display: 'drilldown', //Section can be 'inline' or 'drilldown'
        elements: [
          {
            type: 'TextField',
            key: '43aa1',
            data_name: 'comments',
            label: 'Comments',
            required: false,
            required_conditions: null,
            read_only: false,
            read_only_conditions: null,
            hidden: false,
            visible_conditions: null,
            pattern: null,
            pattern_description: null,
          },
        ],
      },
      {
        type: 'TextField',
        key: '11332',
        data_name: 'who_voted',
        label: 'Who voted?',
        required: true,
        required_conditions: null,
        read_only: true,
        read_only_conditions: null,
        hidden: false,
        visible_conditions: {
          and: [
            { field_key: 'can_vote', operator: 'equal_to', value: 'yes' },
            {
              or: [
                { field_key: 'age', operator: 'greater_than', value: 20 },
                { field_key: 'first_name', operator: 'equal_to', value: 'Bob' },
              ],
            },
          ],
        },
        pattern: null,
        pattern_description: null,
      },
    ],
  },
};

// Test the value generation utility
// console.log('Testing value generation from labels:');
// console.log('Bogotá ->', generateValueFromLabel('Bogotá'));
// console.log('São Paulo - Centro ->', generateValueFromLabel('São Paulo - Centro'));
// console.log('New York ->', generateValueFromLabel('New York'));
// console.log('Recanati ->', generateValueFromLabel('Recanati'));
// console.log();

// // Test choice processing utility
// console.log('Testing choice processing:');
// const choicesWithMissingValues = [
//   { label: 'Bogotá', value: 'bogota' },
//   { label: 'Recanati' }, // missing value
//   { label: 'São Paulo - Centro' }, // missing value with accents
// ];
// const processedChoices = processChoiceFieldChoices(choicesWithMissingValues);
// console.log('Processed choices:', JSON.stringify(processedChoices, null, 2));
// console.log();

// Test with initial values - only value needed for predefined choices
const initialValues = {
  first_name: 'Alice',
  age: 21,
  city: {
    choice: [
      {
        value: 'bogota'  // label will be auto-populated from schema
      }
    ],
    other: []
  },
  colors: {
    choices: [
      {
        value: 'red'  // label will be auto-populated from schema
      },
      {
        value: 'yellow'  // label will be auto-populated from schema
      }
    ],
    other: [
      {
        label: 'Purple'
      }
    ]
  }
};

const engine = createFormEngine({ schema, initialValues });
engine.eval();
console.log(JSON.stringify(engine.getState(), null, 2));
const operations = engine.trigger('load-record');
console.log('Load operations:', operations);
