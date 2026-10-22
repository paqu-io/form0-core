# Complex record evaluation follow-up

Verified 22 October 2026, after the original Plan 2 implementation. The package remains unpublished
at 0.6.0; a future 0.7.0 minor release is recommended because Plan 2 adds public evaluator/validation
APIs, collection builtins and authoring metadata. No version was changed, pushed or published here.

Builtin split: `8ccba8f`. Metadata cache, fixtures and tests: `021dbc0`.

## Workload

The original timing fixture exercised 200/2,000 rows using nine schema elements at one repeatable
level. Its separate deep test and wide condition test did not establish performance for a broad,
populated schema. This follow-up combines those dimensions using a portable deterministic fixture.

| Dimension                                    | Complex fixture                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| Schema elements                              | 377: 360 scalar fields, eight RepeatableSections, nine Sections             |
| Scalar field definitions                     | 180 NumericField, 90 TextField, 90 CalculatedField                          |
| Conditions                                   | 549 leaves across visible, required, read-only and section visibility rules |
| Nesting                                      | Six populated repeatable levels, plus observations/payment sibling branches |
| Calculation definitions                      | 90; local chains, ancestor reads, eight SUM calls, one VALUES call          |
| Total accepted rows across all levels        | 200 / 2,000                                                                 |
| Populated scalar value cells, including root | 8,040 / 80,040                                                              |
| Refresh calculation executions               | 2,010 / 20,010                                                              |

Row distribution for 2,000 rows: projects 80, tasks 160, visits 280, checks 360, samples 400,
readings 440, observations 160, payments 120. Unequal parent membership creates short/empty and deep
branches. Containers do not contribute extra rows. Each instantiated record has 40 scalar fields;
the 360 definitions are distributed across the root and eight record scopes.

An accepted ancestor factor of 2 becomes 3. Calculations propagate down six levels, subtotals
propagate upward, and root totals/array predicates feed downward shares and conditions. Five
required/read-only text inputs per scope are empty under a hidden Section and must not block submit.
Tests inject one visible required/read-only empty input and one scope-level custom failure at depth
six, verifying both report the same complete instance path. Arithmetic is checked against a direct
domain oracle for every field/row, rather than only checking the root total.

This supplements the existing field-family, malformed collection, cycle, save-once and 22-level
tests. It does not claim every field type or arbitrary author-supplied JavaScript has been load tested
in every combination. The benchmark has custom validation disabled; separate TRUSTED/SAFE
correctness cases enable the fixture's managed handlers for 200 rows. The original 2,000-row custom
validation benchmark remains separate.

## Profiling and change

CPU profiles identified repeated calculation-context construction, including resolution of the same
schema-owned access relationships for every row. Initial warmed preparation was approximately
0.31–0.35 seconds / 2.8–2.9 seconds for the broader workload. The intermediate metadata cache reduced
this to approximately 0.31 / 2.59 seconds; precomputing permitted field bindings removed the remaining
repeated enumeration/resolution work.

The evaluator now owns a bounded metadata cache per calculation definition: execution context,
static references, schema access decisions and permitted binding names. No row values, live engines
or diagnostics are stored in it. Each execution reads current values. The full permitted context,
including fields reachable via EVAL and its aliases/helpers, remains available. The normal engine
path continues to use its existing behavior. Tests assert that 200 and 2,000 rows perform the same
number of ownership resolutions and that repeated preparation adds no resolutions.

REPEATABLEVALUES and REPEATABLESUM also now follow the repository's one-file-per-builtin layout:
repeatablevalues.js / repeatablesum.js. Their authoritative metadata remains in builtin-definitions.js.

## Performance

Reproduce Node measurements with `npm run benchmark:records:complex`. Two warm-ups precede five
retained Node samples; the browser uses three retained samples after two warm-ups. Values below are
sample maxima, not statistical population percentiles. Factory setup and serialization are reported
separately from preparation. Correctness checking runs outside timed preparation intervals.

| Runtime                | Rows  | Warmed maximum | Cold preparation | Factory setup | Largest scheduling gap |
| ---------------------- | ----- | -------------- | ---------------- | ------------- | ---------------------- |
| Node 24.22.1           | 200   | 188.2 ms       | 342.5 ms         | 31.9 ms       | 34.3 ms                |
| Node 24.22.1           | 2,000 | 1,692.0 ms     | 1,639.9 ms       | 11.2 ms       | 166.6 ms               |
| Chromium main thread   | 200   | 178.3 ms       | 294.5 ms         | 12.9 ms       | 19.3 ms                |
| Chromium main thread   | 2,000 | 1,452.3 ms     | 1,431.8 ms       | 7.8 ms        | 111.7 ms               |
| Actual Chromium Worker | 200   | 168.1 ms       | 268.3 ms         | 18.8 ms       | 19.2 ms                |
| Actual Chromium Worker | 2,000 | 1,342.1 ms     | 2,267.0 ms       | 17.3 ms       | 97.3 ms                |

These warmed samples fit the reference-machine 250 ms / 2 second budgets, now also for the broader
fixture. No noisy wall-clock assertions were added to ordinary unit tests. Cold runs, other machines
and custom JavaScript may take longer. The complete serialized prepared result is 1,241,805 bytes /
12,440,656 bytes; schema plus input snapshot is 359,430 / 1,894,773 bytes. Worker transport/dispatch
outside measured worker execution was 7.9 / 70.7 ms and included the actual complete returned result.

Yielding is cooperative, not an 8 ms main-thread blocking ceiling. Snapshot cloning, graph work,
individual expressions, result construction and GC can exceed that interval. Large responses and
observed scheduling gaps are concrete Plan 3 worker/renderer/mobile acceptance inputs. Heap deltas
and RSS are recorded in JSON as process observations, not retained-heap/leak or Hermes measurements.
Actual Hermes/device performance and UI adoption remain Plan 3; iOS acceptance remains deferred.

## Verification and provenance

| Gate                                                                | Result                                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Full core format, lint and regression/security tests (Node 24.22.1) | PASS, including 43 existing record scenarios and seven new complex scenarios                          |
| Node 22.23.4 compatibility                                          | PASS, 43 existing and seven complex record scenarios                                                  |
| Original narrow-schema performance gate                             | PASS, warmed maxima 28 / 171 ms for 200/2,000 rows; managed 2,000-row validation 88 ms                |
| Complex Node, browser main thread, actual browser Worker            | PASS, all arithmetic/metadata/row-count checks and timings recorded above                             |
| Browser portable regression suite                                   | PASS, 17 record contract scenarios in main thread and actual Worker, including TRUSTED/SAFE           |
| Native platform adapter                                             | PASS, nine tests including the 17-case contract and complex 200-row fixture in TRUSTED/SAFE           |
| CLI dependency/preview environment                                  | PASS, 17 contract scenarios, 14 HTTP compatibility checks and complex 200-row fixture in TRUSTED/SAFE |
| Production audit / package contents                                 | PASS, zero vulnerabilities / 93 allowed files                                                         |
| Whitespace checks                                                   | PASS                                                                                                  |

The independent candidate and logs live under the parent workspace's
`.local-test-harnesses/form0-record-scale-20261022/`. Original accepted evidence under
`form0-record-evaluation-20261022/` was preserved. No maintained dependency tree was replaced.

Candidate SHA-256:

```text
0a7b1cf4576dd6c1206d373375881363563b44edd29d9a46025ce6c818f76ba4
```

PACKED_PROOF.json records all 93 package files matching workspace and the independent browser,
Native adapter and CLI candidate trees, with no dependency symlinks outside their respective trees.
Source fixtures and Node runner are committed; browser/adapter/CLI drivers are local test harnesses.
The original four-locale documentation source gates remain accepted evidence; this follow-up changes
core internals/tests and these analysis documents without changing the documented public contract.

No manual test is required for this core follow-up. Maintainer owns releases and issue closure.
Keep #99/#104 and React #73 open for Plan 3's actual consumer adoption/parity; #103 is already closed.
