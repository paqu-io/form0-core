# Condition scope (#103): candidate verification

Verified on 22 October 2026 against the approved Plan 1 in
[the alignment document](VALIDATION_FRESHNESS_AGGREGATION_ALIGNMENT.md).
This is an unpublished candidate, retaining package version 0.5.1 for verification.

## Behavior

Schema validation and engine construction reject condition references outside the owning record
and its ancestors. This applies to visible, required and read-only rules, including every branch
of arrays, AND and OR expressions. Errors identify the owner, condition property, reference and
both ownership paths. Container ownership uses the existing scope resolver: a RepeatableSection's
conditions belong to its containing record, while its fields belong to rows.

Runtime checks use that same resolver before condition comparison, throw on violations and emit
existing structured access warnings. They do not add intrinsic errors or calculation diagnostics.
The shared ownership index is constructed once per engine and reused during schema validation and
evaluation. No public export, authored schema attribute, record metadata or dependency is added.

## Automated results

| Check                                                     | Result                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`, Node 24.22.1                             | PASS: full core suite, formatting and lint. Includes 118 focused condition-scope scenarios.                                           |
| `node tests/condition-scope.test.js`, Node 22.23.4        | PASS: the same 118 scenarios.                                                                                                         |
| `npm run package:check`                                   | PASS: 85 allowed package files.                                                                                                       |
| Packed React 0.4.0, Chromium                              | PASS: 18 checks across main-thread rendering, worker rendering and direct worker INIT replies; eight actual browser Workers observed. |
| Packed Native 0.5.0 through the renderer platform adapter | PASS: seven tests. This is automated adapter execution, not Android/Hermes or iOS device acceptance.                                  |
| Packed CLI 0.7.0 preview server                           | PASS: 14 HTTP checks, including root, payment-row and nested-line editors, plus invalid-schema rejection.                             |
| Documentation source gates                                | PASS: formatting, i18n, navigation, page parity, 20 tests and lint. Four locales; 128 substantive pages per locale.                   |
| `git diff --check`, core and docs                         | PASS.                                                                                                                                 |

Focused tests cover all three condition properties; key and data-name references; root, local and
multiple ancestor reads; forbidden descendants, siblings and unrelated branches; Section,
RepeatableSection, LabelField and expanded BuildingPlan ownership; unknown references; runtime
warning attribution; and malformed keys still producing schema errors after indexing moved earlier.

The inspection/payment regression rejects the unrelated score default of 50 even when accepted
inspection scores are 95 and 90. The permitted root-array → payment helper → local condition path
passes under TRUSTED and SAFE configurations for both `[95, 90]` and `[95, 60]`. These checks use
explicit arrays; they do not implement or imply a collection builtin.

The generated fixture has 514 elements and 12 nested repeatables. An assertion verifies exactly
one ownership-index construction across engine creation and five evaluations. The full Node 24
run took approximately 7 ms for that fixture; this observation is not a platform performance budget.

## Packed provenance and reproduction

Core archive SHA-256:

```text
92cdd3b1fdd82ed5b52bbd367695590818a4158ca00bd1de80fa7852d535f2ca
```

All 85 extracted files match the archive in each consumer. React, Native and CLI packages were
downloaded at the versions above. Dependencies were copied from existing independent verification
trees into new independent trees, then the downloaded consumer package and candidate core were
extracted there. A symlink audit found no dependency links outside those new trees. No maintained
dependency tree or accepted evidence directory was replaced.

Run the committed core checks with:

```sh
npm run check
npm run package:check
```

Local consumer drivers, results, complete logs and file hashes are retained at
`.local-test-harnesses/_archive/form0-condition-scope-20261022/` in the parent workspace:

- `fixture.mjs`, `fields.mjs`, `web/check.mjs`, `web/main.jsx`: browser renderer and worker checks.
- `adapter/build.mjs`, `adapter/scope.test.jsx`: packed Native renderer with platform primitives
  adapted for automated execution.
- `cli/check.mjs`: actual packed preview server and nested editor HTTP checks.
- `PACKED_PROOF.json`, `artifacts/*-pack.json`, `logs/`: provenance and recorded results.

These workspace artifacts are local evidence; core tests and this report are committed. Consumer
drivers require the independent dependency trees described above and a Chromium executable.

## Delivery boundaries

Four-language scope guidance explains strict rejection and how to correct invalid rules. It marks
the behavior as forthcoming and corrects obsolete lifecycle wording to the already delivered opt-in
contract. Local docs production/rendered validation was not run; that gate remains with docs PR CI.

Only core and documentation change. Existing development history and security commits are retained.
No title rendering, schema/output shape, calculations, event permissions, hidden-ancestor submission
policy, closed-row refresh, aggregation or setter normalization is changed. Existing core regression
coverage for records, media, IDs, timestamps, events and diagnostics passes with this candidate.
No new manual acceptance is required by the observed results. Plans 2 and 3 still require their
separate policy decisions and implementation plans. Merges, versions, publication, deployment and
issue closure remain with the maintainer.
