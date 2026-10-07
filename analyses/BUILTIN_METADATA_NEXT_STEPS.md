# Builtin Metadata Next Steps

This note captures follow-up work on builtin editor metadata. The metadata now lives in a single catalog, `src/builtins/builtin-definitions.js`, which security validation reads without loading the implementations.

## Short-Term Follow-Up

- Done: the catalog is the single source of truth for signatures, descriptions, and examples. The stale MDX docs under `src/builtins/docs/` were removed (reader-facing docs live in form0-docs-zudoku), implementation JSDoc keeps only `@builtin`, a catalog pointer, and `@param`/`@returns` types, and `tests/builtin-catalog-examples.test.js` checks that every example parses and validates.
- Consider building `RUNTIME_ENTRIES` from the catalog plus an implementations map keyed by name, and dropping the per-file `*_METADATA` re-exports, which only internal code can import because `package.json` `exports` exposes `.` alone.
- Revisit `COUNT`, `COUNTA`, and `COUNTBLANK` UX to decide whether the runtime should stay array-based or move to a more spreadsheet-like varargs API.

## Calculation Authoring Follow-Up

- Extend `analyzeCalculationExpression()` to optionally accept known custom helper names so builder integrations can avoid false `unknown_builtin` errors.
- Add richer structured metadata for editor tooling, such as parameter lists, return kinds, and snippet templates.
- Consider exposing field-type compatibility hints for choice builtins like `CHOICELABEL()` and `OTHER()`.

## Runtime Follow-Up

- Implement `FORM()` or replace it with a narrower schema-inspection API before promoting it beyond `unavailable`.
- Consider whether `EVAL()` should carry stronger runtime/editor warnings or require an explicit opt-in flag.
- Decide whether `getBuiltinDefinitions()` should remain a small public export or grow into the canonical docs-generation API.
