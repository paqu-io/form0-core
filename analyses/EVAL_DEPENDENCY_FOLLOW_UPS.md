# EVAL Dependency Follow-Ups

## Current Position

`form0-core` now distinguishes between two `EVAL()` categories during calculation dependency analysis:

- statically resolvable `EVAL()` calls, such as `EVAL("'$calc_total'")` or `EVAL("'$' + 'calc_total'")`
- unresolved dynamic `EVAL()` calls, such as `EVAL("'$' + $selected_calc")`

Statically resolvable cases are treated like normal calculated-field dependencies. Unresolved cases still use the dynamic fallback path and emit warnings.

## Why This Is Not The Final Model

The current improvement intentionally keeps the planner conservative. It does not try to infer every possible dependency hidden behind `EVAL()`, because that would require either brittle string heuristics or runtime dependency capture.

Two important limitations remain:

- dynamic `EVAL()` expressions still rely on bounded stabilization at runtime
- references used to build the `EVAL()` string are not yet modeled as first-class calculation dependencies

## Recommended Next Steps

1. Add runtime dependency tracing for dynamic calculation evaluation.
   Record which field references were actually resolved while executing `EVAL()` so downstream recalculation can react to the real dependency set instead of a blind repeated-pass fallback.

2. Promote traced dependencies into engine diagnostics.
   Distinguish between:
   - statically ordered dependencies
   - runtime-traced dependencies
   - unresolved/non-converging dynamic dependencies

3. Consider a narrower builtin for dynamic field lookup.
   A dedicated field-lookup builtin would be easier to analyze and secure than generic `EVAL()`, while covering the most common dynamic-reference use cases.

4. Revisit whether `EVAL()` builder-time analysis should model field references used to construct the expression string.
   Example: `EVAL("'$' + $selected_calc")` always depends on `$selected_calc`, even if the final target field stays dynamic.

## Non-Goals For Now

- full static inference for arbitrary `EVAL()` expressions
- spreadsheet-style iterative circular calculation mode
- changing current `EVAL()` runtime semantics outside the dependency-planning improvement
