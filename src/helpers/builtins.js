let _resultSet = false;
let _resultValue;

export const builtins = {
    IF: (cond, a, b) => (cond ? a : b),
    AND: (...args) => args.every(Boolean),
    OR: (...args) => args.some(Boolean),
    SETRESULT: (value) => {
        _resultSet = true;
        _resultValue = value;
        return value;
    }
};

export function __consumeResult() {
    const value = _resultValue;
    const called = _resultSet;
    _resultSet = false;
    _resultValue = undefined;
    return { called, value };
}