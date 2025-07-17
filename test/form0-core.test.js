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
        description: 'This is a test description',
        description_mode: 'default', //description_mode can be null,'default' or 'subtext'
        display: 'inline', //Section can be 'inline' or 'drilldown'
        elements: [
          {
            type: 'TextField',
            key: 'ef661',
            data_name: 'first_name',
            label: 'First Name',
            description: 'This is a test description',
            description_mode: 'subtext', //description_mode can be null, 'default' or 'subtext'
            display: 'default', //TextField can only be 'default'
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
            pattern: '^[a-zA-Z]+$',
            pattern_description:
              'One or more letters (uppercase or lowercase), with no spaces, numbers, or symbols',
          },
          {
            type: 'SingleChoiceField',
            key: '0180f',
            data_name: 'city',
            label: 'City',
            description: null,
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            display: 'default', //SingleChoiceField can be 'default' or 'radio'
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
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
            description: null,
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            display: 'default', //MultiChoiceField can be 'default' or 'checkbox'
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
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
            description: null,
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            display: {
              style: 'text', // or numeric, date, currency
            },
            required: false, //CalcualtedField is always required = false
            hidden: false,
            visible_conditions: null,
            read_only: true, //CalcualtedField is always read_only = true
            calculate: `
            const citySelection = CHOICEVALUE($city);
            SETRESULT(IF(OR(citySelection === "bogota", OTHER($city) === "Bogotá"), "Welcome to Bogotá!", "Welcome!"));
            `,
          },
          {
            type: 'CalculatedField',
            key: 'aa123',
            data_name: 'colors_calc',
            label: 'colors_calc',
            description: null,
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            display: {
              style: 'text', // or numeric, date, currency
            },
            required: false, //CalcualtedField is always required = false
            hidden: false,
            visible_conditions: null,
            read_only: true, //CalcualtedField is always read_only = true
            calculate: 'CHOICELABELS($colors) + " -> Other: " + OTHER($colors)',
          },
          {
            type: 'NumericField',
            key: 'ccbb56',
            data_name: 'age',
            label: 'Age',
            description: null,
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            display: 'default', //NumericField can only be 'default'
            required: true,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
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
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: {
          style: 'text', // or numeric, date, currency
        },
        required: false, //CalcualtedField is always required = false
        hidden: false,
        visible_conditions: null,
        read_only: true, //CalcualtedField is always read_only = true
        calculate: 'IF($age >= 18, "yes", "no")',
      },
      {
        type: 'CalculatedField',
        key: 'e4567',
        data_name: 'calc_test',
        label: 'calc_test',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: {
          style: 'text', // or numeric, date, currency
        },
        required: false, //CalcualtedField is always required = false
        hidden: false,
        visible_conditions: null,
        read_only: true, //CalcualtedField is always read_only = true
        calculate: 'SETRESULT($age + 10 >= 30 ? true : false)',
      },
      {
        type: 'CalculatedField',
        key: 'ee123',
        data_name: 'calc_test_new',
        label: 'calc_test_new',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: {
          style: 'text', // or numeric, date, currency
        },
        required: false, //CalcualtedField is always required = false
        hidden: false,
        visible_conditions: null,
        read_only: true, //CalcualtedField is always read_only = true
        calculate: '$age + 88',
      },
      {
        type: 'DateField',
        key: 'ff551',
        data_name: 'field_visit_date',
        label: 'Field visit date',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'default', //DateField can only be 'default'
        required: false,
        required_conditions: null,
        hidden: false,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'now', // can only be 'now' or null
      },
      {
        type: 'TimeField',
        key: 'a34a1',
        data_name: 'field_visit_time',
        label: 'Field visit time',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'default', //TimeField can only be 'default'
        required: false,
        required_conditions: null,
        hidden: false,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'now', // can only be 'now' or null
      },
      {
        type: 'BooleanField',
        key: '1990f',
        data_name: 'gender',
        label: 'Gender',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'default', //BooleanField can only be 'default'
        required: true,
        required_conditions: null,
        hidden: false,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null,
        third_option_enabled: true, //BooleanField can be true or false
        choices: [
          {
            label: 'Male',
            value: 'm',
          },
          {
            label: 'Female',
            value: 'f',
          },
          {
            label: 'Other',
            value: 'other',
          },
        ],
      },
      {
        type: 'LabelField',
        key: '1985ff',
        data_name: 'photo_consent',
        label: 'Please be aware that photographs may be taken at this Community Engagement event. By submitting this form, you consent to the use of any photos in which you appear in reports related to the Housing Improvement under PDUNM project and in Build Change marketing materials. You also acknowledge that the information you provide on this form will only be used for the purposes of this project.',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'default', //LabelField can only be 'default'
        required: false, //LabelField is always required = false
        required_conditions: null, //LabelField is always required_conditions = null
        hidden: false,
        visible_conditions: null,
        read_only: true, //LabelField is always read_only = true
        read_only_conditions: null, //LabelField is always read_only_conditions = null
        default_value: null, //LabelField is always default_value = null
      },
      {
        type: 'SignatureField',
        key: '1993ff',
        data_name: 'signature',
        label: 'Please add your signature below',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'default', //SignatureField can only be 'default'
        required: true,
        required_conditions: null,
        hidden: false,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null, //SignatureField is always default_value = null
        agreement_text: 'I agree to the terms and conditions', //agreement_text can be null or a string
      },
      {
        type: 'PhotoField',
        key: '1991ff',
        data_name: 'house_photo',
        label: 'Take a photo of the house',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'default', //PhotoField can only be 'default'
        required: false,
        required_conditions: null,
        hidden: false,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null, //PhotoField is always default_value = null
        min_length: null, //min_length can be null or a number representing minimum number of photos
        max_length: null, //max_length can be null or a number representing maximum number of photos
      },
      {
        type: 'VideoField',
        key: '1989ff',
        data_name: 'house_video',
        label: 'Take a video of the house',
        description: 'This is a description of the video field',
        description_mode: 'subtext', //description_mode can be null, 'default' or 'subtext'
        display: 'default', //PhotoField can only be 'default'
        required: false,
        required_conditions: null,
        hidden: false,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: null, //PhotoField is always default_value = null
        min_length: null, //min_length can be null or a number representing minimum number of video minutes
        max_length: null, //max_length can be null or a number representing maximum number of video minutes
      },
      {
        type: 'Section',
        key: 'e4568',
        data_name: 'section_drill',
        label: 'Drilldown section test',
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'drilldown', //Section can be 'inline' or 'drilldown'
        elements: [
          {
            type: 'TextField',
            key: '43aa1',
            data_name: 'comments',
            label: 'Comments',
            description: null,
            description_mode: null, //description_mode can be null, 'default' or 'subtext'
            display: 'default', //TextField can only be 'default'
            required: false,
            required_conditions: null,
            hidden: false,
            visible_conditions: null,
            read_only: false,
            read_only_conditions: null,
            default_value: null,
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
        description: null,
        description_mode: null, //description_mode can be null, 'default' or 'subtext'
        display: 'default', //TextField can only be 'default'
        required: true,
        required_conditions: null,
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
        read_only: true,
        read_only_conditions: null,
        default_value: null,
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

// // Test default values for DateField and TimeField
// console.log('\n=== Testing DateField and TimeField default values ===');
// const testSchema = {
//   form: {
//     name: 'TestForm',
//     elements: [
//       {
//         type: 'DateField',
//         key: 'date1',
//         data_name: 'test_date',
//         label: 'Test Date',
//         default_value: 'now'
//       },
//       {
//         type: 'TimeField',
//         key: 'time1',
//         data_name: 'test_time',
//         label: 'Test Time',
//         default_value: 'now'
//       },
//       {
//         type: 'DateField',
//         key: 'date2',
//         data_name: 'test_date_null',
//         label: 'Test Date Null',
//         default_value: null
//       },
//       {
//         type: 'TimeField',
//         key: 'time2',
//         data_name: 'test_time_null',
//         label: 'Test Time Null',
//         default_value: null
//       }
//     ]
//   }
// };

// const testEngine = createFormEngine({ schema: testSchema });
// testEngine.eval();
// const testState = testEngine.getState();
// console.log('DateField with default "now":', testState.values.test_date);
// console.log('TimeField with default "now":', testState.values.test_time);
// console.log('DateField with default null:', testState.values.test_date_null);
// console.log('TimeField with default null:', testState.values.test_time_null);

// // Test default value validation for all field types
// console.log('\n=== Testing default value validation ===');
// const validationTestSchema = {
//   form: {
//     name: 'ValidationTestForm',
//     elements: [
//       {
//         type: 'TextField',
//         key: 'text1',
//         data_name: 'text_field',
//         label: 'Text Field',
//         default_value: 'Hello World'
//       },
//       {
//         type: 'NumericField',
//         key: 'num1',
//         data_name: 'numeric_field',
//         label: 'Numeric Field',
//         default_value: 42,
//         format: 'integer'
//       },
//       {
//         type: 'SingleChoiceField',
//         key: 'choice1',
//         data_name: 'single_choice',
//         label: 'Single Choice',
//         default_value: 'option1',
//         choices: [
//           { label: 'Option 1', value: 'option1' },
//           { label: 'Option 2', value: 'option2' }
//         ]
//       },
//       {
//         type: 'MultiChoiceField',
//         key: 'multi1',
//         data_name: 'multi_choice',
//         label: 'Multi Choice',
//         default_value: ['option1', 'option2'],
//         choices: [
//           { label: 'Option 1', value: 'option1' },
//           { label: 'Option 2', value: 'option2' },
//           { label: 'Option 3', value: 'option3' }
//         ]
//       }
//     ]
//   }
// };

// try {
//   const validationEngine = createFormEngine({ schema: validationTestSchema });
//   validationEngine.eval();
//   const validationState = validationEngine.getState();
//   console.log('TextField default:', validationState.values.text_field);
//   console.log('NumericField default:', validationState.values.numeric_field);
//   console.log('SingleChoiceField default:', validationState.values.single_choice);
//   console.log('MultiChoiceField default:', validationState.values.multi_choice);
//   console.log('✅ All default values validated successfully');
// } catch (error) {
//   console.log('❌ Validation error:', error.message);
// }
