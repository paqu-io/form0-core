# Plan 2: record evaluation verification

Verified 22 October 2026 on existing development branches. This is an unpublished candidate based
on core 0.6.0; package version deliberately remains 0.6.0 until the maintainer releases it.
See [the contract](RECORD_EVALUATION_CONTRACT.md) and
[alignment](VALIDATION_FRESHNESS_AGGREGATION_ALIGNMENT.md).

Implementation commit: `36a8e8f`. Localized documentation commit: `e9e75cd`.

## Implementation

Public createRecordEvaluator() evaluates immutable runtime record trees and prepares one selected
submission snapshot. Shared validateSubmission()/isFieldValueEmpty() centralize participation.
REPEATABLEVALUES/REPEATABLESUM are calculation-only and use explicit section/target references.
Accepted/fresh/retained behavior, permissioned single-use review, invalid root drafts, scoped custom
validation and companion freshness metadata are implemented. Consumer UI/persistence adoption is
Plan 3. No maintained dependency tree, record/media/ID/timestamp contract or release version changed.

The coordinator reuses existing expression, condition, field-validation and managed-event execution.
Ownership is prepared once. Registration is evaluated in each selected scope using shared source
analysis/compilation; closed-row lifecycle hooks are not replayed. No full row engine is constructed
or retained. Ancestor object reads are defensive. Existing local diagnostics remain separate from
submission findings and record-spanning coordination failures.

## Automated gates

| Gate                                   | Result                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Full core npm run check, Node 24.22.1  | PASS, including 43 record-evaluator scenarios and existing regression/security suites.                        |
| Focused record evaluator, Node 22.23.4 | PASS, same 43 scenarios.                                                                                      |
| Package check                          | PASS, 92 allowed files.                                                                                       |
| Production dependency audit            | PASS, zero vulnerabilities; no dependency upgrades.                                                           |
| Chromium main-thread / actual Worker   | PASS, 17 portable record scenarios agree in both runtimes.                                                    |
| Packed React compatibility             | PASS, 18 existing renderer/worker checks; 11 actual Workers observed including benchmark workers.             |
| Native platform adapter                | PASS, eight tests, including 17 portable record scenarios. Adapter execution is not Hermes/device acceptance. |
| Packed CLI dependency environment      | PASS, 17 portable record scenarios.                                                                           |
| Packed CLI preview HTTP compatibility  | PASS, 14 checks including nested editors and invalid-schema handling.                                         |
| Four-locale documentation source gates | PASS: formatting, i18n, navigation, parity, 20 tests and lint; 128 substantive pages per locale.              |
| Whitespace checks                      | PASS in core and docs.                                                                                        |

Coverage includes upward aggregation followed by downward reads, 22-level uneven nesting, unrelated
branch rejection, all three ancestor-dependent condition properties, hidden participation, strict
numeric/choice/link projection, dynamic EVAL and re-entry, cycles, review invalidation/cancellation,
root drafts, save-once reference orchestration, ID zero, media handles and unknown metadata.
Structural assertions prove one ownership index across rows/repeated preparation and reuse of
compiled expressions despite input key ordering changes.

## Performance

Committed benchmark: npm run benchmark:records. Fixtures change the ancestor factor, refresh five
calculations per row and include the complete change report. Node 24.22.1 warmed sample maxima:

- 200 rows: 32 ms, target 250 ms.
- 2,000 rows: 206 ms, target 2,000 ms.
- 2,000 rows with scope-specific registration and 1,000 custom validation failures: 93 ms.

Browser fixtures use the same portable generator. Each 2,000-row run refreshes 10,000 child results.
The column labelled p95 is the maximum of the three retained warmed browser samples, a conservative
small-sample statistic rather than a population percentile.

| Runtime              | Rows | Warmed p95/max | Largest observed scheduling gap | Prepared JSON bytes |
| -------------------- | ---- | -------------- | ------------------------------- | ------------------- |
| Chromium main-thread | 200  | 16.7 ms        | 9.0 ms                          | 209,229             |
| Chromium main-thread | 2000 | 188.5 ms       | 36.2 ms                         | 2,108,431           |
| Chromium worker      | 200  | 16.8 ms        | 10.1 ms                         | 209,229             |
| Chromium worker      | 2000 | 179.7 ms       | 41.6 ms                         | 2,108,431           |

The browser harness records input size, serialization time, reported heap delta and Worker round-trip
overhead with the actual prepared payload. Node records RSS/heap deltas and yields. These are local
reference-machine observations, not retained-heap measurements or mobile guarantees. Scheduling is
cooperative: whole-data copies, graph work, synchronous expressions and GC can exceed the 8ms target.
Actual Hermes memory/latency and interactive renderer acceptance remain Plan 3; iOS remains deferred.

## Packed provenance and reproduction

Archive SHA-256:

```text
90978771268979b3adcd80b71b6ad781e61e7e7e0189bfdaccd96fd02633db3d
```

At the original verification, all 92 archived files matched the then-current workspace package sources
and each independently copied browser/Native-adapter/CLI tree. Symlink audit found no links outside those independent trees.
Existing accepted evidence and maintained consumer dependency edits were preserved.

Local drivers, archives, complete logs and JSON evidence:
`.local-test-harnesses/form0-record-evaluation-20261022/` in the parent workspace. In particular:
PACKED_PROOF.json, artifacts/core-pack.json, logs/core-check.log, logs/node22-record-tests.log,
logs/benchmark.json, logs/browser-benchmark.json, logs/browser.log, logs/native-tests.log,
logs/cli.log and logs/docs-final.log. Portable conformance and benchmark fixtures are committed under
tests/helpers; environment drivers require their independent dependencies and a Chromium executable.

No new manual acceptance is required for this core delivery. Production/rendered docs checks remain
with docs PR CI; no local production docs build was run. Maintainer owns merges, version bump,
publication, deployment and issue closure. Existing Native/mobile dependency exceptions remain
separate targeted work and expire 7 November 2026.

## Large-schema follow-up

The original 200/2,000-row timing fixture has nine schema elements, eight scalar field definitions,
five row calculation definitions and one repeatable level. The 22-level correctness fixture has 26
schema elements and 22 populated rows; the separate condition-scope test has 514 elements and 12
levels. These dimensions were originally exercised separately, not as a single large populated form.

The subsequent [complex-form verification](COMPLEX_RECORD_EVALUATION_VERIFICATION.md) combines
377 schema elements, six populated repeatable levels, 549 condition leaves and up to 2,000 total rows.
Its independent packed candidate, profiling, performance improvement and automated evidence are
recorded separately; the original archive and accepted results above remain historical evidence.
