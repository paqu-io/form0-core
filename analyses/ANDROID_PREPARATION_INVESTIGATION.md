# Android preparation investigation — 23 October 2026

Current status (24 October): physical Pixel core and full-renderer measurements confirm the improvement.
Full-renderer cancellation passes; the 2,000-row preparation still takes 11.2 seconds with a 949 ms
observed JS gap. Functional acceptance is reported; performance investigation remains open. Do not substitute
desktop, adapter or compiler results for actual Android/Hermes acceptance.

## Maintainer device observations

Pixel 8a, Android 17; no React Native DevTools open and no profiling/recording during the runs.
The subsequent profile confirms Expo Go 58.0.5, Android API 37, RN 0.88.0, Hermes and development
mode; SAFE is off. The installed harness uses SDK 58.

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

## Pixel diagnostic and targeted fixes — 24 October

The maintainer supplied the requested diagnostic from the same Pixel, without DevTools open.
The complete original report is retained in `logs/android-pixel8a-baseline.json` in the active harness.
The timer calibration averages 33.3 ms (maximum 35.5 ms). All times below are milliseconds.

| Managed validation | Sample | Preparation | Outside explicit yields | Yield waiting | Yields | Maximum work interval |
| --- | --- | --- | --- | --- | --- | --- |
| Disabled | Cold | 24,020.1 | 7,261.2 | 16,758.8 | 678 | 92.1 |
| Disabled | Warm | 20,343.7 | 5,863.2 | 14,480.5 | 590 | 90.1 |
| Enabled | Cold | 29,931.9 | 9,125.1 | 20,806.8 | 824 | 89.7 |
| Enabled | Warm | 28,102.4 | 8,382.8 | 19,719.5 | 792 | 88.4 |

About 70% of the warm managed run is time waiting at explicit host yields. Computation remains
substantial, including an approximately 2.5-second increment with managed validation. These are
wall-clock buckets, not hardware CPU counters. Factory setup is separate: 159 / 95.2 ms for the
two configurations. Metro's reported 8,065 ms bundling precedes these samples and is separate.
These diagnostic runs are not controlled comparisons with the earlier controller timings.

Two targeted changes follow that evidence and the existing computation profile:

1. Native's coordinator uses `requestIdleCallback` when available, after the existing browser
   `scheduler.postTask` preference; older hosts keep the timer fallback. Its 8 ms work budget is
   unchanged. Abort resolves a pending idle wait and cancels its handle so core can report cancellation
   immediately. Completed, failed and cancelled waits detach their listeners. No `setImmediate` or
   microtask-only continuation is used: installed RN 0.88 implements immediates through microtasks.
   Native input must retain a scheduling opportunity. The
   [RN guidance](https://reactnative.dev/docs/timers) and installed NativeIdleCallbacksCxx/runtime
   scheduler source support this choice; the actual Pixel improvement remains to be measured.
2. Core's existing compilation cache gains an internal weakly owned parameter-layout index.
   Previously every row calculation sorted and JSON-serialized the complete parameter list even
   when reusing a compiled function. The regression reproduces 4,020 argument-signature constructions
   across two 200-row preparations; the fixed path constructs 90, with no further warm constructions.
   Layouts retain parameter names/functions only, reuse current argument values, respect key changes,
   sorted-argument semantics and explicit cache clearing. Security checks still run for every execution.
   Immutable builtin-name sets also move from per-expression construction to catalog initialization.

The Native backend regression failed before the fix because it never selected the available host
idle-task queue; it now passes. Five scheduling cases cover actual backend preparation and scoped
evaluation, input-driven cancellation (including idle handle zero), late callbacks, listener release,
host errors, caller override and timer fallback. Core regression checks current/reordered/added
bindings, cache clearing, TRUSTED/SAFE/custom restrictions and exact broad-fixture results. Existing
re-entry, event-mode, EVAL, condition-scope, readonly and saved-record preservation checks also pass.

### Matched desktop comparison after the fixes

Same production browser driver/settings as above, two warm-ups and two retained samples, managed
custom validation enabled. It includes controller settling, selection, signatures and serialization.

| Rows | Execution | Before | After |
| --- | --- | --- | --- |
| 200 | Main thread | 252.3, 248.6 | 213.1, 207.8 |
| 200 | Actual worker | 214.5, 216.2 | 160.8, 162.9 |
| 2,000 | Main thread | 2,408.9, 2,594.6 | 1,808.5, 1,839.1 |
| 2,000 | Actual worker | 1,967.4, 2,014.4 | 1,458.7, 1,438.0 |

These new reference measurements satisfy 250 ms / 2 s for this fixture; they do not establish
Android acceptance. The 2,000-row main-thread/worker reply sizes remain 4,169,642 / 4,163,362 bytes.
An eight-cycle GC-enabled Node worker prepare/review/release check finds no retained reports;
tail retained heaps range from 14,845,344 to 14,904,872 bytes. It is not a Hermes heap measurement.

### Verification and next device step

- Full core release gates: formatting, lint, complete tests including the new regression, zero
  production audit findings, 96-file package check.
- React: build, 93 tests, 14-file package check. Actual Chromium: 12 accepted-view cases with 10
  worker instances and 14 submission cases with 9 workers; no page errors.
- Native: 61 Node tests, 29 adapter cases, focused scheduling cases including scoped evaluation,
  69-file package check, production/all dependency audit gates.
- CLI: 168 tests and retained/reopen/persistence-failure/retry browser checks; no page errors.

Logs have the `android-performance-` prefix, preserving the original evidence. No reader-facing API,
schema, output shape or UI text changed; no localized product documentation or production docs build
was needed for this internal optimization. Existing security/dependency exceptions remain separate.

New installed archives (unpublished version labels):

| Package | Archive under active harness | Bytes | SHA-256 |
| --- | --- | --- | --- |
| Core | `android-performance/form0-core-0.7.0.tgz` | 127,798 | `8bc0415d248f86190b6b645f5abe89984923fa2f892258a19cca600088e39763` |
| Native | `android-performance/form0-react-native-0.5.0.tgz` | 421,271 | `9cf84ca32f60bc179881357225819324bdbc392d71b0001008ca838c27f2f19e` |

The archives total 549,069 bytes. Installed core/Native source matches maintained source; installed
profile/scheduler fixture bytes match their sources with the generator's relative-import adjustment.
No SDK/dependency installation or cleanup was performed. The Native guide and current-work checkpoint
point to this investigation. Maintainer dependency/funding edits remain untouched.

Reload the app, reset with **Nested editing**, keep SAFE off and run **Profile preparation (200)**.
The updated report must identify `revision: "native-idle-layout-cache"` and, on this Native runtime,
`scheduler: "idle-callback"`. Copy its JSON. It now times the same scheduler as the actual renderer;
the twenty-timer calibration remains as the old-path comparison. Do not request another 2,000-row
run before this confirms the scheduling reduction and quantifies the remaining compute cost.

## Updated physical Pixel result and live-calculation verification — 24 October

The maintainer supplied the updated report with the expected `native-idle-layout-cache` revision
and `idle-callback` scheduler. Same Pixel 8a, Expo Go 58.0.5, API 37, RN 0.88.0, Hermes,
development mode and SAFE off. Exact JSON is retained in `logs/android-pixel8a-after.json`.

| Managed validation | Sample | Preparation before → after (ms) | Outside yields after (ms) | Yield waiting after (ms) | Yields after | Maximum work interval after (ms) |
| --- | --- | --- | --- | --- | --- | --- |
| Disabled | Cold | 24,020.1 → 909.5 | 906.3 | 3.2 | 88 | 53.7 |
| Disabled | Warm | 20,343.7 → 677.0 | 648.7 | 28.3 | 65 | 52.2 |
| Enabled | Cold | 29,931.9 → 1,356.3 | 1,277.5 | 78.7 | 128 | 56.8 |
| Enabled | Warm | 28,102.4 → 1,010.3 | 945.6 | 64.8 | 99 | 59.9 |

The warm managed run is approximately 27.8 times faster. Explicit waiting drops from 19,719.5 ms
to 64.8 ms; time outside yields drops from 8,382.8 ms to 945.6 ms. Zero-timer calibration remains
slow (mean 33.5 ms, maximum 36.2 ms), supporting the scheduling-path diagnosis. Factory setup is
unchanged in scale (159.8 / 94.1 ms, outside preparation). Metro's 8,630 ms bundle is separate.
The maximum work interval remains above one display frame. The report is a core-only 200-row
diagnostic, not a full renderer, 2,000-row or release-build responsiveness result.

### Live values are recomputed

The maintainer asked whether the optimization could regress older live-calculation fixes.
The diff against `de1667d`'s parent confirms calculation dependency planning/order, stabilization
and record scheduling algorithms were not changed by that core performance commit. Source history
contains dependency-order/cycle/static-EVAL fixes on 26 March; the description alone does not
identify which older incident the maintainer remembers. No claim is made that it is that exact fix.

The cache stores compiled functions and argument-name layouts; every invocation maps its arguments
from the current context. It stores no field values or results. `attachRecordEngine` still starts
a new scoped evaluation on input changes and rejects superseded results by sequence. Field editing
and Save/Cancel ownership are unchanged. View still shows accepted values; opening Edit evaluates
current ancestor inputs, and closed children retain accepted calculations until the agreed selection.

New maintained regression cases in React and Native exercise actual input handlers repeatedly and
rapidly, under TRUSTED and SAFE:

- Root tax changes 0.2 → 0.3 → 0.4 → 0.5 → 0.6; a root calculation displays 20 → 30 → 40 → 60,
  including two rapid final changes. Accepted root aggregate stays 330.
- View shows child total 110; entering Edit with current tax shows 160.
- Child amount changes 100 → 150 → 200 → 300; its calculation shows 160 → 240 → 480,
  including rapid final edits. Closed accepted children remain [110,220] until child Save.
- Saving that child accepts [480,220] and updates root aggregate to 700. Caller inputs stay immutable.

The React target file passes all seven cases; Native's complete adapter suite passes all 31 cases
(two new live-input cases). Core dependency-order/static-EVAL, compilation-cache, evaluator re-entry
and scoped-evaluation scripts also pass. A real Chromium check repeats those edits in main-thread
and actual-worker modes, in TRUSTED and SAFE: four cases, four workers, no page errors. Its first
attempt read the worker field before its initial state arrived; the fixture was corrected to wait
for the expected value. No runtime code was changed. Reports are `logs/pixel-live-*.json`; the actual
browser driver/fixture is `pixel-live-browser.mjs` and `react/live-cache-browser.*` in the active harness.

Runtime archives and installed bytes remain those listed above. Only tests and evidence changed in
this verification pass. Next use the existing walkthrough 3's full-controller 200 / 2,000-row
**Programmatic prepare** measurements and large-form cancellation check; report `elapsedMs` and
`maxObservedJsGapMs`. Preserve walkthroughs 1 and 2 as accepted. Do not infer the full renderer's
JS scheduling gap from this core diagnostic's `maxWorkSliceMs`, or close Plan 3 on this profile alone.

## Full-renderer Pixel retest and schema reload — 24 October

The maintainer's subsequent walkthrough 3 results use the same installed runtime candidate. Raw
reported measurements are retained in `logs/android-pixel8a-controller-after.json`. No warm-up or
cold/warm classification was supplied; do not present these as controlled warmed samples.

| Total rows | Previous controller elapsed (ms) | Current elapsed (ms) | Current maximum observed JS gap (ms) | Result |
| --- | --- | --- | --- | --- |
| 200 | 9,714 | 1,516 | 182 | Completed, eligible, no execution issues. |
| 2,000 | 97,889 | 11,213 | 949 | Completed, eligible, no execution issues. |

The maintainer also confirms cancellation works. Elapsed time improves approximately 6.4x / 8.7x;
the nearly one-second large-form JS gap remains. Retain walkthroughs 1 and 2 and cancellation as
accepted functional evidence, while keeping performance and Plan 3 sign-off open. No additional
phone rerun is requested until a targeted probe or change is ready.

Next investigate full preparation in phases: capture/signatures, evaluator setup/tasks and managed
validation, applying selected editor state, and serialization. The previous core-only timing does
not identify which phase produces the controller's longest stall. Whole-tree copies/signatures,
unbudgeted preparation/finalization, and renderer synchronization are candidates to measure, not
established causes. Preserve stale-review/input guards and exact output shapes during optimization.
Do not attribute this to development mode or require an SDK upgrade without new evidence.

### Schema replacement does not reuse stale code

The compilation layout key contains execution mode and complete source code; argument values are
read from the current context at every invocation. New schema objects rebuild binding preparation
and coordinator lifetimes. CLI file watching reloads/validates the schema, broadcasts it, disposes
the old preview session and starts a new session. Server session fingerprints also reject old
commands after schema changes. Form events receive new registrations rather than accumulating
callbacks from an earlier schema. Existing lifecycle/mode policies remain in force.

Maintained React and Native regressions replace a schema while the renderer stays mounted, under
TRUSTED and SAFE. They change a calculation, add a dependent calculation, change a collection target
from `total` to `amount`, and replace an event handler. The new calculations produce 400 / 401,
the aggregate becomes 300, and only the new change handler appends its marker, once. React's target
file passes nine tests; Native's full adapter suite passes 33 tests. Core's compilation regression
also passes. An actual Chromium main-thread/worker check repeats the four security/execution
combinations, creates four worker instances across initialization/replacement, and records no page
errors (`logs/schema-reload-browser.json`).

`schema-reload-cli-browser.mjs` additionally starts the actual CLI server/file watcher, edits a
fixture schema on disk and waits for the WebSocket update. With input 4, edited `* 3` produces 12,
the added `$total + 1` produces 13, and event marker `newB` proves replacement of both load and
change handlers. Two schema messages and zero page errors are recorded in
`logs/schema-reload-cli-browser.json`. Its first attempt used the wrong DOM attribute in the test
selector; correcting it required no runtime change. The fixture and driver remain reproducible in
the active harness. Renderer source tests are committed; no runtime archive bytes changed.

Headless factories capture their schema at construction. Hosts changing schemas recreate the
evaluator; mutation of a previously supplied object is not a supported live-update API. Binding
hosts supply a new schema object, as the normal watch/reload path already does. Cache invalidation
does not authorize refreshing accepted closed rows or replaying their lifecycle handlers.
