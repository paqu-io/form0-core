# Android preparation investigation — 23 October 2026

Current status (26 October): production JavaScript on the Pixel/Hermes completes 200/2,000 rows in
1,373/9,897 ms with maximum observed JS gaps 96/336 ms, eligible and no execution issues. The large
sample is essentially unchanged from the previous individual 9,933 ms development sample. Earlier
functional walkthroughs and prompt cancellation retain acceptance. The diagnostic loader passes
compiled production checks. The maintainer now confirms the session-key cache workaround loads the
current v3 UI and supplies the complete 200-row production/Hermes phase profile. Managed validation
is 46.4% of active preparation, calculations 30.2%; explicit scheduler waiting is 4.2% of elapsed.
The selected literal-registration candidate passes paired core and independent consumer checks.
The next controller revision is `native-literal-registration`; its physical timings remain pending.
See the latest section below;
earlier measurements retain their original provenance. Plan 3 performance sign-off remains open.
Desktop, adapter and compiler measurements are not actual Android/Hermes acceptance.

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


## Bounded preparation, serialization and owned-tree signatures — 24 October

### Physical result received

The maintainer ran the installed `native-responsive-serialization` candidate on the same Pixel,
SAFE off and DevTools closed. No cold/warm classification or repeated sample set was supplied.
Raw report: `logs/android-pixel8a-responsive-serialization.json` in the active harness.

| Total rows | Elapsed (ms) | Maximum observed JS gap (ms) | Result |
| --- | --- | --- | --- |
| 200 | 1,682 | 152 | Completed, eligible, no execution issues. |
| 2,000 | 12,457 | 325 | Completed, eligible, no execution issues. |

The maintainer separately confirms that Cancel responds promptly during a fresh 2,000-row attempt
and returns cancelled. Preserve this and walkthroughs 1/2 as accepted. Compared with the preceding
full-controller result, the large JS gap improves 949 → 325 ms (66%), while elapsed time increases
11,213 → 12,457 ms (11%). This is a responsiveness improvement, not an elapsed-time improvement.
It does not establish a one-frame bound. The phone's Metro inspector endpoint was unavailable
when resuming; no actual Hermes CPU profile was obtained.

### Measured causes and implementation

The Native renderer's real controller was reproduced through the existing HTML platform adapter,
production Chromium 151.0.7922.34 with CPU throttle 4. A baseline has warmed 2,000-row gaps
537–613 ms and elapsed 9.5–9.8 seconds. This is a reproducible comparator, not a simulated Hermes
claim. Phase/CPU profiles identify unbudgeted setup, complete result copies, repeated full-tree
signatures and synchronous serialization in consecutive preparation phases.

- Core captures live inputs atomically before yielding, then budgets traversal, dependency setup,
  evaluation and change reporting on its private capture. Private output/review copies checkpoint
  in bounded property batches. Cancellation and superseding preparations prevent output or review
  resurrection, including during final delivery. An already-aborted attempt performs no input copy.
- Additive `createStructuredRecordAsync(state, fields, options, scheduling)` uses the exact same
  transformation generator as the unchanged synchronous API. It yields between completed rows,
  preserves record/media/ID-zero/order/timestamp behavior and rejects cancellation without partial
  output. Scheduling is a separate fourth argument, never saved metadata. The caller supplies stable
  evaluated inputs until completion. Expressions and individual field formatters stay synchronous.
- React/Native root preparation uses cooperative serialization and guarded checkpoints around
  selection, the save hook and final payload delivery. The existing hook still runs once. CLI gains
  equivalent guards and release-generation protection, while its server serializer stays synchronous.
- Applying selected values no longer triggers a redundant root calculation or internal render-time
  full collection clone. Public snapshot callbacks remain defensive. TRUSTED/SAFE regressions prove
  exactly one root calculation on selection and continued live changes/save/cancel behavior.
- The latest optimization shares an immutable collection-tree signature between renderer adapters
  and UI bookkeeping. It is weakly keyed by the owned tree; accepted row updates replace that tree.
  Mutable engine values, metadata and host policy remain freshly checked. Generic/headless adapters
  retain full checks, including in-place child mutation detection. This caches no calculated values,
  compiled events or executable proposals. Schema replacement still creates new preparation.

The signature regression fails with the former full-scan control and passes with the new adapter;
the generic mutation regression also passes. Current-value/media/policy/row tests and the full
renderer cases guard the optimization. Bundle-only phase instrumentation stays in explicitly named
ignored diagnostic harness files; maintained runtime sources contain no diagnostic hooks.

### Final automated measurements for the new candidate

Uninstrumented Native-adapter CPU-4 controller: cold 10,980.5 ms / 139.6 ms gap; three warmed samples
8,182.5 / 8,210.4 / 8,813.5 ms, with gaps 107.4 / 110.5 / 143.8 ms. The maximum warmed observed
synchronous long task is 72 ms. Raw data: `logs/responsiveness-final.json`. Individual host tasks
and interval gaps are different measurements. The original diagnostic stretch target of a 100 ms
interval gap was not reached; its failing historical logs remain. Manual benchmark gates require
no warmed individual task >=100 ms at fixed CPU4 and at least 50% reduction from the recorded
613 ms warmed gap. Both pass. These are outside ordinary unit tests, not a new phone acceptance
threshold. The latest phase probe reports signature checks below 1 ms after the one-time new-tree
scan, compared with repeated 35–42 ms scans (`responsiveness-shared-owned-signatures.json`).

Matched warmed production browser controller, managed lifecycle/custom validation enabled, two
warm-ups then two retained samples (settling, selection, signatures, serialization included):

| Rows | Main thread (ms) | Actual browser worker (ms) |
| --- | --- | --- |
| 200 | 206.3, 211.2 | 192.1, 184.9 |
| 2,000 | 1,756.9, 1,763.4 | 1,397.2, 1,445.1 |

Reference targets of 250 ms / 2 seconds pass. Complete 2,000-row prepared controller replies remain
4,169,642 / 4,163,362 bytes, including existing payload and callback metadata. No new durable
record storage is introduced; grouped freshness remains unchanged. Eight Node actual-worker
prepare/review/release cycles leave zero report entries; retained heaps are 14.9–16.3 MB and sampled
peak heap is 122,385,640 bytes. This is not a Hermes or frontend-cache heap measurement. The new
cache uses weak ownership; it retains signature strings while their accepted trees remain reachable.

### Verification and limits

- Core full release gates: formatting/lint/full tests, 48 record-evaluator scenarios, complex/deep
  fixtures, security/audit and 96-file package check pass (`responsiveness-core-release-final.log`).
- React full check/build: 100 tests; Native: 35 adapter cases and 69 Node tests. Package/audit gates
  pass in independent dependency trees. Existing development dependency findings/exceptions are
  unchanged. CLI: 168 tests and package check.
- Actual browser: 14 submission cases/9 workers; 12 accepted-view cases/10 workers; four live-edit
  and four schema-reload cases each/4 workers, no page errors. CLI retained/reopen/failure/retry and
  real schema-watch reload checks pass. `responsiveness-conformance.json` records all gate results.
- Four-locale docs formatting, localization, navigation, page parity, 23 tests and lint pass.
  No local production docs build or deployment/security-policy change was made.
- Packed Builder integration and Native declaration checks are rerun against the final candidates;
  exact manifests are `logs/responsiveness-owned-tree-candidates.json` and
  `logs/responsiveness-owned-tree-device-candidates.json`. Earlier Pixel archives remain in
  `responsiveness/`; the new set is separate in `responsiveness-owned-tree/`.

The installed harness's new full-controller revision is `native-owned-tree-signatures`. Restart the
existing Metro process with its usual clear-cache command and reload the app; do not regenerate or
reinstall dependencies. With SAFE off and DevTools closed, run **Large 2,000 → Programmatic prepare**
once and share its JSON/revision and whether the remaining pause is noticeable. Walkthroughs 1/2,
the core-only Profile diagnostic and the already-confirmed physical cancellation need no repetition.
Keep performance and Plan 3 sign-off open until that targeted result. iOS remains deferred.


### Committed source and installed archives

All commits are on the existing `development` branches: core `ee43cf7`, React `854f79d`, Native
`f2bced7`, CLI `eabac90`, localized docs `b46fb44`. Maintainer package/lock edits stay unstaged.
The device installer verified exact maintained/installed core and Native source bytes and unchanged
Expo 58.0.17 / RN 0.88.0 / React 19.3.0. Core plus Native archives total 551,844 bytes.

| Package | Archive bytes | SHA-256 |
| --- | --- | --- |
| form0-core | 129133 | `170ed1feb1fe728ce1ffeddb4f064be428a20e59198c6fe9fe9baee735db3cde` |
| form0-react | 372417 | `4a7f850905ef4ba3b90d074ec4a22a9f533287eb6b810fb02e631cc8096b7459` |
| form0-react-native | 422711 | `25f61e36d20860bd3a3053f900969ac0cff125e2909aa9ee02de19af7607a308` |

Candidate version labels are unpublished; no registry release is claimed. Archives live in
`responsiveness-owned-tree/` in the retained active harness. The older physical candidate archives
remain separately preserved. Active harness allocation is 5,021,536 KiB (about 4.79 GiB); no folder
was removed. Device dependencies, SDK verification and npm cache together are future reviewed
cleanup candidates of about 1.45 GiB after acceptance, with evidence preserved first. Linux
allocation is not evidence of current Windows backing-volume free space.


## Throughput checkpoint — scalar bindings and private event contexts, 24 October

### Scope and stopping rule

The maintainer authorized further investigation while preserving current calculations/events, and
asked for a clear stopping point. The previous Pixel result is retained in
`logs/android-pixel8a-owned-tree-signatures.json`: 12,400 ms, gap 294 ms, completed/eligible/no issues.
Its manually transcribed revision omits a trailing s; the installed archive/source proof retains the
exact expected revision. No cold/warm classification was supplied. Elapsed time is essentially
unchanged from 12,457 ms; it does not establish a controlled comparative speedup.

The selected checkpoint requires a repeatable improvement of approximately 20% for the complete
managed 2,000-row benchmark, preserved output/input hashes, complete behavior/security gates, and
no deliberate responsiveness regression. This is a bounded investigation criterion, not a universal
SLA. Stop optimization changes at the verified candidate and request one physical comparison.
Do not broaden into result caching, incremental invalidation or Native execution architecture on
benchmark evidence alone. If the Pixel gain is absent or insufficient, obtain a discriminating
Hermes measurement before further edits. Finishing this checkpoint does not finalize Plan 3.

### Hypotheses and selected implementation

The ranked hypotheses were excess calculation bindings, repeated closed-row validation setup, then
copies/scheduling. The existing CPU profile showed context construction and validation dominating.
The new direct paired comparator separates managed validation on/off. A broader scratch prototype
improved calculations substantially but was narrowed before delivery to give stronger semantic
boundaries. Intermediate reports are annotated in `logs/throughput-provenance.json`.

1. Schema-bound record evaluation now prepares a conservative scalar binding plan. A calculation
   such as `$amount * (1 + $tax)` reads the same current inputs without rebinding every unrelated
   permitted ancestor/local field or helper. Only primitive operators and the canonical IF/SETRESULT
   calls qualify. Every referenced field must be accessible, present and primitive at that execution.
   Overrides, object values, unresolved/restricted names, other calls, EVAL, arguments, member access,
   arrays, locals and complex JavaScript retain the complete prior context. Runtime layout changes
   remain supported. The ordinary scalar engine path is unchanged. Metadata is cached; values,
   results, permissions checks and expression security validation stay current.
2. Event execution avoids copying a context twice when that context is already privately owned by
   this one initialization/handler execution. Base engine/host contexts remain untouched, and the
   default internal helper calls still copy defensively. Each row/attempt still initializes its
   authored registrations and executes applicable handlers with fresh field values and operation
   scopes. No bound callback, mutable context or validation result is shared across records.

No calculation is skipped, dependency order changed, or closed-row lifecycle replay added. Saved
record/freshness shapes, security, view/edit policy, load ordering, save-once/revalidation and
persistence acknowledgement remain unchanged. No public API, authoring metadata or dependency
version changes are introduced in this throughput pass.

### Paired core measurement and behavior evidence

`node throughput-comparison.mjs final 3 200,2000 --gate` runs in the retained active harness. It
compares maintained source with an independent immutable source copy of the preceding owned-tree
archive (SHA-256 `170ed1feb1fe728ce1ffeddb4f064be428a20e59198c6fe9fe9baee735db3cde`). Source/archive
parity is verified. Two warm-ups precede three retained samples per variant, alternating their order.
Every complete prepared-result hash matches and caller input hashes stay unchanged. Managed events
are enabled/disabled explicitly. Scheduling gives the host control; there are no timing assertions
in ordinary unit tests. Results: `logs/throughput-comparison-final.json`.

| Rows | Managed validation | Baseline median (ms) | Candidate median (ms) | Improvement |
| --- | --- | --- | --- | --- |
| 200 | Disabled | 89.4 | 70.8 | 20.8% |
| 200 | Enabled | 199.8 | 151.4 | 24.2% |
| 2,000 | Disabled | 751.3 | 519.2 | 30.9% |
| 2,000 | Enabled | 1,789.6 | 1,306.3 | 27.0% |

The baseline comparator failed the improvement gate before optimization. Deterministic tests also
failed before the fixes: simple expressions declared unrelated parameters; owned event contexts
were recopied. Final tests cover live 0/false/null/object/primitive layout changes, canonical helper
overrides, EVAL and aliases, custom helpers, arguments, existing unresolved host names, and security
validation on every invocation. TRUSTED/SAFE row checks prove fresh registrations and field values
across multiple attempts, complete scope-level findings with ID zero, and immutable caller data.

### Actual browser and Native-adapter results

Actual production Chromium 151.0.7922.34, full React controller, managed validation enabled, two
warm-ups and two retained samples (no persistence):

| Rows | Main thread (ms) | Actual browser worker (ms) |
| --- | --- | --- |
| 200 | 125.6, 132.9 | 125.2, 139.0 |
| 2,000 | 1,109.8, 1,133.4 | 1,052.1, 1,047.7 |

The previous matched browser candidate recorded 1,756.9/1,763.4 ms main and 1,397.2/1,445.1 ms worker
for 2,000 rows. These are real browser runs automated with Playwright, not just Node/jsdom tests.
They are desktop Chromium evidence, not mobile-browser, Safari or Hermes measurements. Reference
250 ms / 2 s targets pass. Prepared 2,000-row controller sizes stay exactly 4,169,642 / 4,163,362 bytes.

The production Native HTML adapter at fixed CPU throttle 4 records cold 7,483 ms/gap 147 ms; warmed
4,933 / 5,353 / 5,376 ms, gaps 136 / 129 / 136 ms and maximum individual warmed host task 66 ms.
The preceding candidate's warmed times were 8,183 / 8,210 / 8,814 ms. This is not Hermes. One initial
run observed a 110 ms task and failed the existing 100 ms diagnostic gate; that failure is retained
in `logs/throughput-native-controller-first.log` and `throughput-controller-first.json`. The final
candidate passes the unchanged gate; do not treat this noisy host-task limit as a universal bound.

The accepted-view browser driver initially checked the edit marker as soon as the calculation
changed. A focused actual-worker probe confirms the same brief intermediate rendering with both
baseline and candidate, followed by correct settled events. The final driver awaits the marker
itself, retaining all final-value assertions. No renderer runtime change was needed. Probe logs and
the original failure are preserved. This does not weaken event completion or snapshot contracts.

### Gates, archives and next physical step

- Full core release gates pass: formatting, lint, all tests including 50 evaluator scenarios,
  complex/deep/SAFE/TRUSTED/security/re-entry checks, zero production audit findings and 97-file package.
- React 100 tests; Native 69 Node tests/35 adapter cases; CLI 168 tests, package and audit gates pass
  in independent trees. Actual browser submission/view/live/schema-reload, actual CLI persistence
  and watcher reload, Builder 10 cases and Native declaration checks pass.
- Eight actual Node-worker prepare/review/release cycles retain no report entries. Retained heap
  ranges 14,758,352–16,139,168 bytes; sampled peak 116,816,112 bytes. These are not Hermes heap data.
- Four-locale docs source/localization/navigation/parity/lint and 23 tests pass. No reader-facing API
  changed, so localized product pages are unchanged. No local production docs build or policy change.
- Final gates: `logs/throughput-final-gates.json`, `throughput-gates.json`, `throughput-conformance.json`.
  Node-comparison/controller JSON files are separate; their initial filename collision was recovered
  from complete logs and fixed in the scripts. Source provenance is explicit in the companion report.

The new archives are separate in `throughput/`; candidate and installed-device manifests are
`logs/throughput-candidates.json` and `logs/throughput-device-candidates.json`. The core archive is
130,561 bytes, SHA-256 `d2eec93bf76e746825c06448af1f274fdb3ab73670f1ac954d99227d642cd651`.
React/Native archive source bytes remain unchanged from the preceding candidate; Native's fixture
App alone changes its displayed revision. Core plus Native archives total 553,272 bytes. Installed
source parity is verified with Expo 58.0.17 / RN 0.88.0 / React 19.3.0 unchanged. The new packed core
also compiles to Hermes bytecode; compilation is not runtime acceptance.

Restart the usual Metro process with cache clearing, reload, leave SAFE off/DevTools closed, and
run **Large 2,000 → Programmatic prepare** once. Expect `native-throughput-bindings`. Share the JSON
and whether the pause is noticeable. Do not repeat walkthroughs 1/2, the core-only diagnostic or
cancellation solely for this checkpoint. Preserve those accepted results. Review the phone gain
before deciding whether another contained optimization is worthwhile; do not silently accept 12 s
as a production target. iOS and production Reform persistence remain separate.


Throughput implementation commit: core `ea9adf0` on the existing development branch. The final
candidate source matches this commit. Maintainer package/funding edits remain outside the commit;
no push, publication, merge, deployment or issue closure was performed. No dependency installation,
SDK change or deletion was needed; previous candidate archives and accepted evidence stay intact.

Native fixture revision commit: `15ac0a1` on development. Its consumer runtime archive is unchanged.

## Physical throughput result and extension boundary — 26 October 2026

The maintainer reports `native-throughput-bindings`, completed/eligible with no issues, in
9,933 ms with a maximum observed JS gap of 293 ms. The preceding owned-tree sample was
12,400 ms/gap 294 ms: 2,467 ms less elapsed time, approximately 19.9%. These are individual
transcribed observations with unspecified warm-up, not a controlled repeated phone benchmark.
The longest observed gap is essentially unchanged. The raw transcription and normalized values
are retained in active-harness `logs/android-pixel8a-throughput-bindings.json` alongside the earlier
report. Cancellation and walkthroughs 1/2 were not rerun for this sample; their acceptance stands.

Recommendation: stop this contained optimization pass rather than widen the specialized language.
The observed gain supports the selected implementation, but approximately ten seconds for this
377-element, 2,000-row managed submission remains a large-record latency limitation. It is not
the cost of each live scalar edit: those use selected-scope evaluation. Performance sign-off for
Plan 3 remains an explicit acceptance decision, separate from functional acceptance. Further work
should start from a discriminating measurement of a remaining phase and an agreed benefit target.
No additional device rerun or runtime change is required solely to record this result.

The private optimizer caches syntax/binding metadata, not values or results. It recognizes a single
primitive expression, its operators/conditionals and canonical IF/SETRESULT calls. It checks current
accessible primitive values and function identities on each execution. Unknown AST nodes, calls,
parse failures, helper overrides, object inputs, EVAL and complex JavaScript use the original full
context. For example, `$amount * (1 + $tax)` can specialize; `ROUND($amount, 2)` already works via
full context. A newly registered `NEWBUILTIN($amount)` also uses full context automatically, without
an optimizer change. A function still needs ordinary catalog/runtime/security support and tests.

Review this optimization when changing the semantics of currently specialized operations or their
context contracts, or deliberately adding another operation to its whitelist. Adding an unrelated
builtin or a more complex expression does not require that extension for correctness. Existing
regression evidence covers these fallback boundaries; it does not imply immunity to future bugs.
This checkpoint changes documentation/evidence only, leaving candidate bytes and installed trees
unchanged. No new full runtime suite is necessary for these prose/report updates.

## Production-mode investigation prepared — 26 October 2026

The maintainer authorized the proposed investigation. Preserve current calculation, event and form
logic. Judge optimization benefit against complexity and edge cases; do not retain another layer
merely because a microbenchmark improves. Keep the existing binding optimization unchanged until
new evidence justifies a different choice. No further runtime optimization has been implemented.

The ranked predictions are: (1) development overhead will show a material decrease with production
JavaScript; (2) event setup/validation overhead will remain concentrated in managed validation and
grow when managed validation is enabled; (3) copying/scheduling will appear in the remaining phase
durations or explicit yield waits. Measure these before choosing a fix. An actual Hermes trace is
still needed if boundary timings cannot discriminate the remaining cost; Chromium is a comparator.

The existing device harness now displays JS development mode in the header and reports environment
flags for full controller preparation, revision `native-production-baseline`. Baseline controller
checks use fresh accepted fixtures; a repeated preparation on the same editor applies a different
change-report workload after the first selection. This observation does not invalidate the earlier
reported timings, but it must remain explicit when comparing them.

The 200-row diagnostic separately evaluates the same captured input for one cold and three warm
samples per managed-events setting. It can load a boundary-instrumented copy of installed core for
one separate warmed phase probe (after a warm-up). Only that ignored source copy has phase hooks;
the normal controller still uses unchanged packed core/Native. The source generator is retained in
Native for reproducibility and fails if its exact candidate-source anchors change. It installs no
dependencies. Phase wall/active timing is not CPU time; active time subtracts explicit scheduler
waits only. Managed context/registration and dispatch are nested within managed validation, and
must not be summed as independent work. Instrumented and uninstrumented samples stay separate.

Source SHA-256 before instrumentation:
`5b3147e4f1efb1c77fed277e69614a6dcd7d5255fc926943d65a2c708babcfc4`.
The installed package/archive bytes remain the preceding candidate. Production Android JavaScript
exports successfully (no APK build), with `__DEV__=false` verified in the bundle. Size 3,584,406 bytes,
SHA-256 `1705f0cc87cc3167742fa88642eef1c2f4b465eba7c884ec4ae5410561238ce1`.

Automated checks pass in the independent candidate tree: 77 Native Node tests, including complete
instrumented/control equality for valid and invalid custom validation, ID/media/metadata preservation,
and cancellation; a separate conformance run matches complete prepared results and immutable inputs
for 200/2,000 rows under TRUSTED/SAFE with managed validation on/off. No maintained dependency tree
was replaced. Production-mode startup and reporting follow
[Expo guidance](https://docs.expo.dev/workflow/development-mode/); production JS in Expo Go does not
establish final compiled-release performance.

The actual Native browser adapter at CPU throttle 4 remains a reproducible slow comparator: current
unprofiled warmed samples 5,079.9/5,813 ms; first sample 7,815.1 ms. The manual two-second diagnostic
assertion fails as expected, outside ordinary unit tests. Existing responsiveness assertions pass.
An initial profiling invocation selected the legacy diagnostic bundle; its report is retained but
excluded from current-candidate comparisons. Current uninstrumented runtime was then rerun, with
source features and asset hashes matching the previous final candidate. These are not Hermes data.

Reports live in the active harness: `production-phase-conformance.json`,
`production-baseline-native-tests-final.log`, `production-mode-bundle.log`,
`throughput-production-investigation-current.json`, and the provenance/manifest companion.
The Native acceptance guide contains three focused actions: fresh 200/2,000-row controller timings,
then the single 200-row diagnostic, with production mode confirmed on-screen. Earlier walkthroughs
and cancellation retain acceptance. Physical production reports are pending; do not infer speedup,
performance sign-off or a need to change execution architecture. No publication or issue closure.

### Tunnel transport blocker during the first production attempt

The first physical launch reported Metro `Server._processRequest` throwing `TypeError: Invalid URL`.
It did not reach form preparation. Installed Metro uses forwarded protocol/host values directly in
`new URL()`. Local real HTTP requests reproduce that error with comma-separated forwarding chains;
the phone's actual headers were not captured, so this remains a likely class of cause.

A device-harness-only middleware now normalizes a valid HTTP(S) forwarding chain only when its
unmodified origin is invalid. Default Expo configuration and ordinary requests stay unchanged;
other malformed origins stay untouched, with redacted counts/status for further diagnosis. No
package dependency or runtime/form logic changed. Actual corrected HTTP requests return 200 and
byte-identical production bundle content to the single-origin control. The Node suite now passes
82 tests. Report: `logs/production-metro-header-conformance.json`; the original failing request and
local server logs are preserved. A retry of the same maintainer command is requested. Physical
tunnel recovery/performance remain pending; no SDK upgrade or actual-phone diagnosis is claimed.

## Production Pixel reports and native profiler loading — 26 October 2026

The maintainer reports `native-production-baseline`, `dev:false`, `hermes:true`, SAFE off,
completed/eligible and no issues: 200 rows 1,373 ms/gap 96 ms, 2,000 rows **9,897 ms/gap 336 ms**.
The initial 19,897 ms large-row transcription was explicitly corrected; it is not a valid sample.
Raw report: `logs/android-pixel8a-production-baseline.json`. The form remains responsive. Startup
after the Metro retry is confirmed; original forwarded headers were not captured. No controlled
repeat set/warm-up classification was supplied. The large result is essentially unchanged from
9,933 ms in development mode; do not claim a production-mode gain or a 19.9-second regression.

The phase profile failed before measurements because the diagnostic dynamic import took Expo's
native production chunk-URL path without a global `location`. The prior export/HTTP verification
did not reproduce the Expo Go manifest's `lazy=true` seam. A purpose-built loop now loads the actual
Metro Android production module graph without `location`, using the installed SDK's native chunk
URL resolver. `node phase-loader-production.mjs before-lazy` fails with the exact reported message;
the unsplit control passes. This is a discriminating loader regression, not Hermes runtime timing.

Only the diagnostic entry generator changes: a statically resolved `require()` keeps its module in
the bundle and defers initialization until the Profile button. There is no `location` shim or chunk
host configuration, and no SDK/dependency or shipped runtime change. The same loop passes after
restarting the agent-owned CI Metro server, with zero chunk network loads, complete 200-row
TRUSTED/SAFE result equality and immutable inputs. The first post-edit probe hit the CI server's
unchanged cached graph; that failure is retained, then the restarted-graph result is recorded.
The diagnostic source itself stays byte-identical (hash recorded above). Native Node tests: 83 pass.

Reports: `logs/phase-loader-before.json` (unsplit control), `phase-loader-before-lazy.json` (decisive
failure), `phase-loader-after-bundled.json` (stale CI graph),
`phase-loader-after-bundled-restarted.json` (corrected graph), `phase-loader-native-tests-final.log`.
The agent's localhost diagnostic Metro was stopped; the maintainer's process was not stopped.
No additional package archive or dependency tree was created.

The maintainer is asked to restart the same production Metro command and repeat **only Profile
preparation (200)**. Expect revision `native-production-phases-bundled` and
`diagnosticLoading: bundled-require`, with eight control samples and a separate phaseProbe.
Retain the supplied controller reports. Actual phase proportions remain pending, so do not choose
a further runtime optimization, infer a CPU profile or finalize Plan 3 performance acceptance yet.

### Repeated phone loader error; versioned bootstrap verification

The maintainer still sees the same message after restarting Metro and closing/reopening Expo Go.
No actual phase timings arrived. The running maintainer Metro serves the bundled loader; testing
its full main-index graph (not only the standalone diagnostic entry) passes without location or
chunk requests and preserves complete 200-row TRUSTED/SAFE results. The source bundle contains the
updated profiler revision. That proves server-side delivery, not which code the handset executed.

The device fixture now shows a shared **phase-profile-v3** marker for both UI and bootstrap, with
an explicitly versioned button. A stale/missing bootstrap is rejected before its loader runs; a
failure in a current build reports stage, revision, loader metadata and URL-redacted stack frames.
No evaluator, event, dependency or runtime package changes. Independent Native tests: 84 pass.

Only the physical build/profile checkpoint remains: force stop Expo Go, scan the current Metro QR,
check both v3 markers and press Profile phases v3 (200). Stop on mismatched markers. No controller
or large-form rerun. Stale handset code is unconfirmed until that observation arrives. Live graph
reports: `logs/phase-loader-maintainer-index-graph.json` and
`phase-loader-maintainer-index-graph-v3.json`; test log `phase-loader-v3-native-tests.log`.
The maintainer Metro process was inspected read-only and was not stopped. No additional diagnostic
server or dependency tree was started for the marker follow-up.

The maintainer cannot see the new header. A read-only request through both localhost and the
advertised public tunnel returns the v3 header, button and guard; neither response has the former
dynamic-import descriptor. Report `logs/phase-loader-local-tunnel-parity.json` retains safe metadata
and marker booleans, not tunnel URLs. This rules out an outdated response at those endpoints during
the probe, but does not prove what the phone executes. The next requested observation is the visible
profiler button label, with no test rerun or application-data deletion. Physical phase data and the
cause of the repeated handset message remain unresolved.

The maintainer then confirms the older **Profile preparation (200)** button. Terminal `r` reports
no connected app; it does not reload this session or settle cache/connection causality. A minimal
harness-only change gives the diagnostic a distinct launch filename, phase-profile-v3.js, by
updating its ignored package main while preserving the Expo slug and stored fixtures. The live
manifest now advertises /phase-profile-v3.bundle; both local and public responses have the current
markers. The manifest-path check fails before and passes after this change. The actual versioned
production graph passes with zero chunk loads, immutable full TRUSTED/SAFE 200-row parity and
84 Native tests. Reports: `logs/phase-launch-before.json`, `phase-launch-after.json`,
`phase-loader-versioned-launch.json`, `phase-launch-native-tests.log`. No SDK or product-runtime
change, installation or new dependency tree. Phone recovery remains pending: open the project from
Expo Go's home using the current QR, verify the v3 button and repeat only the 200-row profile.

## SDK 58 production asset-key collision — 26 October

The maintainer transcribes the old UI after the latest restart: dev:false, no build marker and
Profile preparation (200). Direct localhost and the exact reported tunnel serve the current v3
bundle. The previous source/URL checks proved HTTP delivery but missed native asset-cache identity.

SDK 58 Android `ExpoUpdatesUpdate` builds a launch AssetEntity from the manifest's key. The live
CLI still sets that key to `bundle`. `Loader.downloadAllAssets` finds a cached entity by key,
`AssetDao.mergeAndUpdateAsset` updates a changed URL without clearing the existing relative path,
and the loader reuses that local file. Development mode skips the asset download/cache path.
This source path matches the observed production-only persistence of old UI, but exact handset
causality remains pending. A successful Windows ADB device listing reports no attached devices;
the agent did not alter phone configuration or storage.

Primary sources: [loader](https://github.com/expo/expo/blob/sdk-58/packages/expo-updates/android/src/main/java/expo/modules/updates/loader/Loader.kt),
[asset merge](https://github.com/expo/expo/blob/sdk-58/packages/expo-updates/android/src/main/java/expo/modules/updates/db/dao/AssetDao.kt),
[Expo Go launcher](https://github.com/expo/expo/blob/sdk-58/apps/expo-go/android/expoview/src/main/java/host/exp/exponent/ExpoUpdatesAppLoader.kt).
Copied primary source is retained under `logs/expo-sdk58-loader-source/` for the narrow probe.

Only the private diagnostic launcher changes: it loads the installed CLI manifest module with a
fresh session asset key in memory, before the existing serialization/signing code. Installed SDK
files, dependencies, package archives, form runtime, schema, records and SQLite fixtures are unchanged.
The single source anchor and safe filename format are guarded; source drift fails explicitly.

`node production-asset-cache-probe.mjs before 8081` fails: both actual JSON and native multipart
manifests contain the constant key and a source-guided cache model selects the older UI despite
current bundle source. `after 8108` passes with the new key and current UI. This model is not Android
execution. Independent Native tests: 86 pass, including pre-signing key injection and source drift.
Reports: `logs/production-asset-cache-before.json`, `production-asset-cache-after.json`,
`production-asset-key-native-tests.log`. The agent stopped its 8108 server, leaving the maintainer's
8081 server untouched. No new dependency tree or installation; no SDK source was edited on disk.

Next physical action: restart the same production command; startup must report
production-launch-asset-key/session-key-enabled. Force stop/reopen Expo Go, scan the current QR,
verify Profile phases v3 (200), then run only that profile with SAFE off. No large controller rerun.
The former filename-only attempt did not address the key collision; retain its evidence as an
unsuccessful workaround. No additional product optimization until actual phase data is available.

## Physical production phase profile received — 26 October

The maintainer confirms the fresh-session asset-key workaround works and copies the entire on-screen
`phase-profile-v3` report. It identifies dev:false, Hermes, Android API37, RN0.88.0, SAFE off,
idle-callback scheduling, bundled-require and both v3 bootstrap markers. Diagnostic source SHA256
is the expected `5b3147e4f1efb1c77fed277e69614a6dcd7d5255fc926943d65a2c708babcfc4`.
Raw report: `logs/android-pixel8a-production-phases-v3.json`; computed summary:
`android-pixel8a-production-phases-v3-summary.json`. The launcher fix is physically confirmed;
no further cache/profile-loader retry is needed.

Three warm uninstrumented samples have elapsed medians 520.4 ms without managed events and 844.0 ms
with them, using the same captured 200-row input every time. Factory setup is separately reported
(155.5/95.1 ms per factory), not repeated work within every sample. The separate instrumented warm
probe takes 828.2 ms with 35.1 ms explicit scheduler waiting, leaving 793.1 ms active wall time.

| Phase | Active ms | Share of active wall time |
| --- | ---: | ---: |
| Managed validation, inclusive | 367.8 | 46.4% |
| ↳ Context construction/registration (201 scopes) | 231.4 | 29.2% |
| ↳ Managed dispatch (201 scopes) | 133.1 | 16.8% |
| Calculations | 239.7 | 30.2% |
| Public result copy/freshness | 67.3 | 8.5% |
| Scope/dependency setup | 50.1 | 6.3% |
| Conditions/intrinsic fields | 48.7 | 6.1% |

Nested managed phases overlap their inclusive parent and must not be added twice. Active timing
means wall time less explicit waits, not a sampled CPU profile. This is one instrumented 200-row
warm probe, not a new 2,000-row controller measurement. Retain the previous 1,373/9,897 ms controller
observations; these different workloads must not be pooled. Waiting is only 4.2% of elapsed time;
further timer tweaks cannot account for most remaining work.

First controlled Node experiments preserve complete result hashes and immutable inputs but show
only 2.4%/4.1%/6.4% median active improvement for copy-traversal reuse, precomputed default-binding
layout and their combination on 2,000 rows. The 200-row medians regress by 8–12%. These variants
are rejected and not applied to maintained source or installed candidates. Evidence:
`logs/validation-context-experiment.json`; source-only probe `validation-context-experiment.mjs`.
A scratch source-rewrite error was caught by its result assertion and corrected before measurement.

The next bounded prototype examines literal `ON(...)`-only registration. Registration itself cannot
read fields in that syntax, while actual handler dispatch must retain fresh scoped values and its
existing executor/security. Conditional initialization and custom `ON` need the complete old path.
No handler result, registration outcome or field value may be cached. Unknown/future calls inside
handler bodies continue through the ordinary executor. The following checks select this candidate.

## Literal registration candidate — 26 October

The private classifier accepts only complete scripts of canonical `ON` calls with literal route
strings and function/arrow callbacks. It classifies registration syntax once per evaluator, without
inspecting or restricting callback bodies. Such registration needs builtins/helpers but no field
defaults. Immediately before ordinary managed dispatch, the evaluator supplies fresh copied current
ancestor/local values. Registration and dispatch still happen for every participating record scope.

Conditional/top-level executable initialization, aliases, dynamic routes, unsupported syntax and
an overridden `ON` retain the original complete initialization context. New builtins or complex code
inside handlers require no optimizer changes. This caches no results, field values or registrations;
it changes neither `engine.eval()` nor the calculation executor, permissions, lifecycle, schemas,
saved shapes or submission policy. The regression first fails on unnecessary initialization bindings,
then passes with current-value, dynamic `EVAL`, arbitrary helper and overridden-`ON` coverage in
TRUSTED/SAFE. Core now has 55 record-evaluator scenarios; the full core release check passes,
including formatting, lint, security/package checks and the wide/deep suites.

Five-sample alternating Node comparisons use the same accepted captured input, two warm-ups and
identical complete result hashes with immutable inputs:

| Rows | Security | Baseline active ms | Candidate active ms | Reduction |
| --- | --- | ---: | ---: | ---: |
| 200 | TRUSTED | 158.36 | 104.35 | 34.1% |
| 200 | SAFE | 187.13 | 145.38 | 22.3% |
| 2,000 | TRUSTED | 1,348.62 | 948.37 | 29.7% |
| 2,000 | SAFE | 1,854.67 | 1,417.55 | 23.6% |

Evidence: `logs/literal-registration-comparison.json`, `literal-registration-core-release.log`.
Packed core: `validation-registration/form0-core-0.7.0.tgz`, 131,100 bytes, SHA256
`407bd5fe839202b9c0d5a707b12a5857e13eaeb1dfd8058c15dbd3712c682b8d`.
This is an unpublished candidate, without a version bump. Original throughput archives are retained.
Only the core package is replaced in existing independent consumer trees; no dependency installation.

Consumer suites pass: React 100, Native 86, CLI 168. A React test initially observed handler entry
before queued `SETVALUE` publication finished; it now awaits the published value. The focused
candidate and accepted-core control pass, and the corrected full candidate suite passes. This is a
test synchronization change, not a renderer behavior change. Actual browser tests cover main-thread,
worker, live root/row calculations, accepted Save/Cancel, schema replacement and CLI persistence/watch.
No page errors or mismatched outputs. Reports: `logs/literal-registration-consumer-gates.json` and
`literal-registration-browser-gates.json`.

Production Chromium 151 warmed full-controller samples (selected values applied between attempts):
200 rows main 150/110 ms, worker 106.8/98.4 ms; 2,000 main 914.4/912.4 ms, worker 787.3/754.9 ms.
Reference targets pass. The initial Native proxy accidentally reused an older generated bundle;
its timing is excluded and retained with the `stale-generated-bundle` suffix. The corrected driver
rebuilds and asserts the candidate implementation before bundling, using a static adapter entry.
At CPU throttle 4, unprofiled warm attempts take 4,762.4/4,688.5 ms, maximum observed gaps
141.7/118.9 ms; the additional profiled attempt is 4,642.4 ms/gap 136.1 ms. All responsiveness gates
pass. This is an HTML adapter on Chromium, not Hermes, and is not a paired phone speedup estimate.

Eight actual Node-worker prepare/review/release cycles pass report-release assertions; retained
heap after explicit GC is approximately 14.2–15.5 MiB, with no accumulating proposal/report tail.
RSS and transient allocation remain distinct from retained heap and database size. Reports:
`logs/literal-registration-android-performance-controller-managed.json`,
`literal-registration-native-proxy.json`,
`literal-registration-android-performance-accepted-view-worker-memory.json`.

Stop new optimization changes at this candidate and measure its actual Pixel effect. Repeat only
fresh 200/2,000-row controller preparation and prompt cancellation under the same production/SAFE-off
conditions. Earlier functional walkthroughs remain accepted. A meaningful measured reduction justifies
this bounded change; a universal two-second mobile preparation guarantee is not established. Further
work needs a new measured dominant cost and an explicit maintenance/behavior tradeoff.
