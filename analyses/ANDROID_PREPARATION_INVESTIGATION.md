# Android preparation investigation — 23 October 2026

Status: functional acceptance reported; performance investigation remains open. Do not substitute
desktop, adapter or compiler results for actual Android/Hermes acceptance.

## Maintainer device observations

Pixel 8a, Android 17; no React Native DevTools open and no profiling/recording during the runs.
Expo Go build and displayed runtime details still need recording. The installed harness uses SDK 58.

| Walkthrough | Report |
| --- | --- |
| 1 — nested editing | Passed. |
| 2 — confirmation/persistence | Passed; review-button appearance and missing child Edit icon identified. |
| 3 — 200 total rows | Completed, eligible, no execution issues; 9,714 ms elapsed, 148 ms maximum observed JS gap. |
| 3 — 2,000 total rows | Completed, eligible, no execution issues; 97,889 ms elapsed, 970 ms maximum observed JS gap. |

The remaining walkthrough 3 functional checks passed according to the maintainer. The long
preparation and nearly one-second JS stall remain unresolved. These are full controller measurements
through payload creation, excluding SQLite persistence and acknowledgement. They are not database
storage measurements. No warmed repeat measurements were supplied yet.

Both large fixtures have 377 schema elements, 360 scalar definitions, 90 calculation definitions,
549 condition leaves, eight collection definitions, and six populated nesting levels with uneven
branches. Row counts are totals across the tree. They produce 2,010 / 20,010 refresh calculation
tasks. Separate core fixtures cover deeper nesting; this phone fixture is six levels deep.

## A verified benchmark mismatch

The previous `controller-accepted-view.mjs` called `mountFixture()` without `managed: true`.
The browser fixture defaults that option to false. The Android App explicitly enables managed
lifecycle/custom validation. The previous desktop timings therefore did not cover that additional
work; retain them as opt-out evidence, not equivalent Android workload evidence.

A matched production Chromium comparison now covers both settings, without changing production
code. Two warm-ups precede the two retained samples per setting. Values below are elapsed ms.

| Rows | Execution | Managed disabled | Managed enabled |
| --- | --- | --- | --- |
| 200 | Main thread | 152.5, 159.4 | 252.3, 248.6 |
| 200 | Actual worker | 115.7, 101.8 | 214.5, 216.2 |
| 2,000 | Main thread | 1,517.2, 1,450.0 | 2,408.9, 2,594.6 |
| 2,000 | Actual worker | 1,017.7, 979.0 | 1,967.4, 2,014.4 |

The added validation cost is measurable; it does not explain the entire phone/desktop gap.
The broad-form main-thread workload also exceeds the warmed two-second reference target when
managed validation participates. That target miss remains open. All comparisons yielded eligible
payloads with no page errors. Evidence and runnable scripts are in the retained active harness:

- `.local-test-harnesses/form0-plan3-20261022/controller-managed-comparison.mjs`
- `logs/controller-managed-comparison.json` (Chromium version included)
- `diagnose-native-preparation.mjs` (direct core, with timed scheduling waits)
- `logs/managed-validation-node.cpuprofile` (370,527 bytes)

The Node profile identifies expression/context construction, ancestor-value merging, record copies,
and per-scope validation setup as work to inspect. It is not a Hermes profile and does not establish
the mobile bottleneck. A separate V8 JIT-disabled 200-row comparison took approximately 0.25–0.46 s;
disabling V8's JIT does not turn it into Hermes. The installed `hermesc` is compiler-only and rejects
`-exec`. No runnable local phone runtime or connected device was available to reproduce its timing.

React Native's [performance guidance](https://reactnative.dev/docs/performance#running-in-development-mode-devtrue)
requires release-build measurements because development mode adds overhead. This is a reason to
record the build mode and eventually validate a release build, not evidence that development mode
caused the observed delay. No SDK or dependency migration is justified by the current measurements.

## Next discriminating measurement

The maintained Native harness now offers **Profile preparation (200)**. It performs no persistence
or editor updates. It uses the same synthetic 200-row record and security choice, and reports:

- Cold and warm core preparations with managed validation off, then on.
- Factory cost, total time, measured timer waiting, computation time excluding that wait, yield
  count and maximum work interval between yields.
- A twenty-timer scheduling calibration, development-mode flag and Hermes/runtime indicators.

This distinguishes timer-wait amplification from synchronous compute, validation, and cold setup.
The report contains timings only; no records, change histories or proposals are returned or logged.
Cancellation remains available. A functional Node test verifies cold/warm cases, input immutability,
non-delivery of record data and cancellation; it asserts no noisy timing threshold.

Refresh the existing Metro app, choose **Nested editing** to release any large preparation, leave
SAFE off to match the original report, and run this one diagnostic. Copy the selectable displayed
JSON (also emitted under `[form0 acceptance] Preparation profile`). Do not request another 2,000-row
run until this result identifies the next probe. If the new control is absent, restart Metro using
the existing start command; do not reinstall dependencies or regenerate the harness.

## UI change and delivery

Native header and review now use the same private `FormActionButton`, including theme overrides,
pressed/disabled states, border, typography and spacing. Refresh is primary; retain and cancel use
secondary/cancel colors. Pagination retains disabled endpoints. Root and child Edit both use the
existing Lucide Pencil; the child action ID was missing from its mapping. Review choices, save hooks,
freshness, persistence and accepted-view calculations are unchanged.

The review changes pass all 29 Native adapter cases and all 56 Node tests (including two diagnostic
tests). The package check passes with 68 files, excluding test instrumentation. The first adapter
attempt caught a missing header title HIT_SLOP constant during extraction; it was restored before
the passing final run. The failed report remains separate from the accepted final report.

The tested Native candidate is installed in the retained independent device tree without an npm
install or SDK changes. Core is unchanged from the accepted-view candidate. Candidate details:

- Native: `android-profile/form0-react-native-0.5.0.tgz`, 420,852 bytes.
- SHA-256: `2d277d38d58903007265c280e1f76f3bab2767a59449111c9c8eb160c19d9d49`.
- Manifest: `logs/android-profile-candidate.json`; installed Native source equals maintained source.

Archive filenames retain unpublished version labels; they do not claim those registry versions have
these changes. Maintainer dependency/funding edits are preserved. No production dependency tree,
release, merge, publication, issue state or deployment was changed. No cleanup/deletion or large
installation was performed; this pass adds small diagnostic artifacts and one approximately 0.4 MB
archive. Keep the active harness until the performance investigation is complete.
