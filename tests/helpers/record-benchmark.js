import {
  numericField,
  calculatedField,
  repeatableSection,
  formSchema,
} from './calculation-fixtures.js';

/** A changed ancestor refreshes every row and produces the complete review/change report. */
export function recordBenchmarkFixture(size, { countCalls = false } = {}) {
  const schema = formSchema([
    numericField('factor'),
    calculatedField('total', "REPEATABLESUM($rows, 'c4')"),
    repeatableSection('rows', [
      numericField('amount'),
      ...Array.from({ length: 5 }, (_, index) => {
        const value = index === 0 ? '$amount * $factor' : `$c${index - 1} + 1`;
        return calculatedField(
          `c${index}`,
          `SETRESULT(${countCalls ? `countCall(${value})` : value})`
        );
      }),
    ]),
  ]);
  const snapshot = {
    values: { factor: 3 },
    repeatable: {
      rows: Array.from({ length: size }, (_, id) => ({
        id,
        values: { amount: 10, c0: 20, c1: 21, c2: 22, c3: 23, c4: 24 },
      })),
    },
  };
  return { schema, snapshot, expectedTotal: size * 34 };
}
