# Builtin Metadata Next Steps

This note captures follow-up work after moving builtin editor metadata next to the builtin implementations.

## Short-Term Follow-Up

- Align the MDX builtin docs under `src/builtins/docs/` with the new metadata source so signatures, descriptions, and examples do not drift.
- Review builtin JSDoc blocks and either keep them intentionally human-focused or derive them from the same metadata model.
- Revisit `COUNT`, `COUNTA`, and `COUNTBLANK` UX to decide whether the runtime should stay array-based or move to a more spreadsheet-like varargs API.

## Calculation Authoring Follow-Up

- Extend `analyzeCalculationExpression()` to optionally accept known custom helper names so builder integrations can avoid false `unknown_builtin` errors.
- Add richer structured metadata for editor tooling, such as parameter lists, return kinds, and snippet templates.
- Consider exposing field-type compatibility hints for choice builtins like `CHOICELABEL()` and `OTHER()`.

## Runtime Follow-Up

- Implement `FORM()` or replace it with a narrower schema-inspection API before promoting it beyond `unavailable`.
- Consider whether `EVAL()` should carry stronger runtime/editor warnings or require an explicit opt-in flag.
- Decide whether `getBuiltinDefinitions()` should remain a small public export or grow into the canonical docs-generation API.
