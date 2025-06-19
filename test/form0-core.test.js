import { createFormEngine } from '../src/index.js';

const schema = {
  form: {
    name: 'MyForm',
    description: 'This is a test description',
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
              hidden: false,
              read_only: false,
              pattern: '^[a-zA-Z]+$',
              pattern_description: 'One or more letters (uppercase or lowercase), with no spaces, numbers, or symbols'
            },
            {
              type: 'NumericField',
              key: 'ccbb56',
              data_name: 'age',
              label: 'Age',
              required: true,
              hidden: false,
              read_only: false,
              min: 16,
              max: 100,
              format: 'integer', //NumericField can be 'integer' or 'float'
            }
          ]
        },
        {
          type: 'CalculatedField',
          key: 'ea3a1',
          data_name: 'can_vote',
          label: 'Eligible',
          required: false, //CalcualtedField is required = false by default
          hidden: false,
          read_only: true, //CalcualtedField is read_only = true by default
          calculate: 'IF($age >= 18, "yes", "no")',
          display: {
              style: 'text' // or numeric, date, currency
          }
        },
        {
            type: 'CalculatedField',
            key: 'e4567',
            data_name: 'calc_test',
            label: 'calc_test',
            required: false, //CalcualtedField is required = false by default
            hidden: false,
            read_only: true, //CalcualtedField is read_only = true by default
            calculate: 'SETRESULT($age + 10 >= 30 ? true : false)',
            display: {
                style: 'text' // or numeric, date, currency
            }
        },
        {
            type: 'CalculatedField',
            key: 'ee123',
            data_name: 'calc_test_new',
            label: 'calc_test_new',
            required: false, //CalcualtedField is required = false by default
            hidden: false,
            read_only: true, //CalcualtedField is read_only = true by default
            calculate: '$age + 88',
            display: {
                style: 'text' // or numeric, date, currency
            }
        },
        {
            type: 'Section',
            key: 'e4567',
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
                hidden: false,
                read_only: false,
                pattern: null,
                pattern_description: null
              }
            ]
        },
        {
            type: 'TextField',
            key: '11332',
            data_name: 'who_voted',
            label: 'Who voted?',
            required: true,
            read_only: true,
            hidden: false,
            visible_conditions: {
                and: [
                  { field_key: 'can_vote', operator: 'equal_to', value: 'yes' },
                  {
                    or: [
                      { field_key: 'age', operator: 'greater_than', value: 20 },
                      { field_key: 'first_name', operator: 'equal_to', value: 'Bob' }
                    ]
                  }
                ]
            }
        }
      ]
  }
};

const engine = createFormEngine({ schema, initialValues: { first_name: 'Alice', age: 21 } });
engine.eval();
console.log(engine.getState());