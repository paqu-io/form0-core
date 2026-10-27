# Plan 3 verification — 23 October 2026

Current follow-up: accepted-snapshot viewing and event.mode are implemented. See
[the current verification and Android handoff](ACCEPTED_VIEW_VERIFICATION.md). Earlier results
below retain their original candidate provenance. Android functional walkthroughs and cancellation
pass according to the maintainer. The latest production Pixel preparation is 1,333/8,454 ms for
200/2,000 rows, gaps 90/323 ms, with prompt cancellation. The maintainer selected ending the tuning
pass and proceeding with final review. See
[the current Pixel investigation](ANDROID_PREPARATION_INVESTIGATION.md).

Final review: [scope, resolved CLI identity finding and current release gates](PLAN_3_FINAL_REVIEW.md).
The CLI correction passes 171 tests, formatting/smoke/package and browser persistence checks.
Its fresh production audit fails with 2 high and 1 moderate findings also present in the maintained
lockfile. Do not reuse earlier clean-audit statements as current release readiness. No dependency
upgrade was made in this pass; CLI security remediation remains a separate release prerequisite.


Current implementation and automated verification pass. Android functional walkthroughs and prompt
cancellation pass; the remaining targeted check concerns large-form responsiveness. iOS remains deferred. This document does not authorize
publication, deployment, issue closure or production reform persistence adoption.

Reference: [alignment](VALIDATION_FRESHNESS_AGGREGATION_ALIGNMENT.md),
[approved plan](PLAN_3_CONSUMER_ADOPTION.md) and [core contract](RECORD_EVALUATION_CONTRACT.md).
Production application persistence and rollout follow-ups are owned by the host repositories.

## Implemented contracts

- Core `evaluateScope()` reuses schema preparation, execution, projection, state and built-in validation.
  It evaluates only the selected record and returns its state without a complete tree. Accepted
  descendants and current ancestors are captured before yielding; ID zero, complete ancestry,
  reordered identified rows, explicit invalid paths, cancellation and input immutability are covered.
  Redundant full-tree input copies were removed from full preparation (automatic submission retains no unnecessary accepted-source copy); the change report retains only
  original calculation values. Full evaluate/prepare semantics and tests remain intact, including edits made to caller inputs while yielded. Renderer seed initialization and snapshot copies are shared only across unchanged accepted children; public snapshots remain defensive copies.
- Portable private coordination owns one record evaluator per session, accepted/draft editor overlays,
  save-hook-once/revalidation, all-or-none review, immutable captured proposal selection, paged change
  reports, stale decision/acknowledgement guards and disposal. It never persists the record itself.
  Changes during asynchronous serialization cannot deliver a stale payload. Changed host policy invalidates reviews. Switching records with the same schema uses the current controller, and failed Native draft saves release reports without acknowledging pending freshness. Root ID zero now survives
  the existing structured-record serializer, including deprecated fallback-ID handling.
- React main-thread/actual worker, Native and CLI preview use shared preparation even with managed
  lifecycle disabled. Managed opt-out still disables custom validation/lifecycle. Closed-row lifecycle
  is not replayed. Selected values remain dirty unsaved work after validation or persistence failure.
  A resolved callback acknowledges persistence; rejection does not. Explicit controllers acknowledge
  only the matching preparation. Saved pending freshness remains separate from unsaved values.
- Worker proposals/reports remain private, replies omit duplicate proposals and closed-row maps,
  changes are paged (50 default, 100 maximum), cancellation uses request IDs, and release/termination
  races do not produce unhandled browser rejections. Function-valued worker-helper restrictions remain.
- Validation findings are complete and deterministically ordered with bounded UI pages and record/field
  navigation. Scope-level INVALID targets its record. Review labels use field labels and record titles
  or paths. Existing repeatable-title behavior is preserved.
- CLI policy is server-owned. Retention requires a load/save adapter, and adapter completion acknowledges
  the exact prepared record plus companion. The tested file adapter replaces one envelope atomically.
  Failed/partial persistence cannot clear pending status. Existing connector record payloads are
  unchanged. Record routes accept a configurable 16 MiB default request limit; 2,000-row HTTP input is
  tested. Retry-response caching is bounded by count and an 8 MiB budget.
- Builder writes the root setting, consumes collection metadata, keeps scalar quick previews and applies
  record-aware expressions only to the unsaved document before opening the existing full-form preview.
  The actual ReformForm wrapper verifies 10 + 20 = 30 and nested project subtotals 30 / 100.

## Automated gates and provenance

The protected independent workspace is
`../.local-test-harnesses/form0-plan3-20261022` relative to the core checkout. Builder/docs reuse their
retained independent dependency trees; maintained dependency trees were not replaced. All heavy
checks ran sequentially. CLI's copied dependency mismatch was repaired only in its independent tree
using the current lockfile. Harness omissions (format configuration, LICENSE and Builder root config)
were corrected without product workarounds. Archived evidence keeps its original date/scope.

| Surface               | Evidence and result                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core                  | Full formatting/lint/tests/security and package gates; new scoped TRUSTED/SAFE matrices and 22-level uneven nesting; existing full evaluator and complex-schema suites retained.                                                                                                                                          |
| React                 | 78 tests; build, formatting, production/full audit thresholds and package checks pass. Full audit reports two moderate development-tool entries, not a clean all-dependency audit.                                                                                                                                        |
| Actual browser worker | 14 main-thread/worker cases: TRUSTED/SAFE automatic/retained totals, abort, pending editor protection, child save/cancel isolation, callback failure/retry and unmount. Zero page errors.                                                                                                                                 |
| Native                | 54 Node tests and 17 adapter cases, including automatic/retain/failure/draft renderer cases under TRUSTED/SAFE. Positive/negative public controller TypeScript usage also compiles against the packed Native declarations. Adapter evidence is not Hermes acceptance.                                                     |
| CLI                   | 168 tests plus actual Chromium interactions for retain 330, persisted pending reopening, failed refresh persistence and successful retry at 360. Full release gates pass; production audit has zero findings.                                                                                                             |
| Builder               | 175 maintained test files / 774 tests; typecheck, affected-file lint/format and four-locale catalog gates pass. Earlier 850-test output included a historical standalone harness fixture; it is excluded from the final maintained-source run. Unrelated existing working-tree tests ran but are not part of this commit. |
| Documentation         | EN/ES/FR/IT source formatting, localization, navigation/links, parity (128 substantive documents), 23 tests and lint pass. No local production/rendered build; docs CI owns rendered validation.                                                                                                                          |
| Native security       | Existing targeted Metro/braces exception remains unpatched and expires 7 November 2026. Its separate remediation is not part of Plan 3.                                                                                                                                                                                   |

Exact commands, machine-readable gate exits and outputs are preserved under the active `logs/` folder:
`final-gates.json`, `core-complete.log`, `react-session-edges.log`, `native-node-last.log`,
`native-session-edges.log`, `cli-release-check.log`, `browser-record.json`, `cli-browser.json`,
`builder-final-gates.json`, `docs-final-gates.json`, and the Native audit/package outputs.
The three device walkthroughs live in
`../form0-react-native/analyses/PLAN_3_ANDROID_ACCEPTANCE.md` relative to core.

## Performance and allocation

Reference machine: WSL2 Linux x64, Intel i7-12700H, 20 logical CPUs, 16.63 GB available to WSL;
Node 24.22.1. Chromium version is recorded in `browser-performance.json`. Measurements are not
ordinary unit assertions. The wide fixture has 377 schema elements, 360 scalar fields, 90 calculation
definitions, 549 condition leaves, eight repeatable definitions and six uneven populated levels.
The 2,000-row fixture has 80,040 value cells and 20,010 refresh calculation tasks. Separate correctness
fixtures exercise at least 22 nesting levels.

Five retained warmed backend samples followed warm-up. Targets remain 250 ms / 2 seconds for preparation. The browser columns preserve the transport baseline before the final task-scheduling follow-up; current complete-renderer timings are reported below.
An early worker sample exceeded 2 seconds. Removing the redundant complete input copy and measuring
again with fresh dependency optimization produced the following backend maxima (early logs are retained).

| Total rows | Node prepare | Browser main prepare | Actual worker prepare incl. RPC | Routine worker reply | Main / worker UI scheduling gap |
| ---------- | ------------ | -------------------- | ------------------------------- | -------------------- | ------------------------------- |
| 200        | 158.0 ms     | 150.8 ms             | 140.5 ms                        | 179,767 bytes        | 33.6 / 4.4 ms                   |
| 2,000      | 1391.2 ms    | 1289.2 ms            | 1368.3 ms                       | 1,777,285 bytes      | 148.7 / 8.8 ms                  |

The main-thread scheduling gap includes synchronous capture/setup; cooperative 8 ms task budgeting
cannot preempt that work or individual expressions. Worker mode keeps this preparation away from the
UI thread. Scoped editor evaluation on the same 2,000-row fixture takes at most 10.5 ms in the five
warmed Node samples, returning 3.6–3.9 KB for root/six-level scopes rather than another complete tree.
Do not substitute these numbers for actual Hermes performance or claim a universal frame-time bound.

The full temporary 2,000-row core result still serializes to 12,440,656 bytes. Routine worker replies
contain selected data once and omit full proposal/change arrays. Pending persisted metadata remains
the selected lossless row-grouped contract; it is not the complete temporary preparation object.

Eight alternating prepare/confirm/release cycles in a Node worker running the real worker source
leave no report entries after release. In that instrumented pass, forced-GC retained heap stays roughly 14.5–15.9 MB; sampled
worker heap reaches about 125 MB. RSS can stay reserved by the allocator. These GC-instrumented
2.3–2.6 second cycles include forced GC/RPC and are not preparation-target samples or browser/Hermes
peak-memory measurements. This pass predates the final automatic-source copy reduction; it is retained as bounded-release evidence, not an exact final peak measurement. Browser window heap does not measure worker heap. Actual Android profiling
and cancellation/responsiveness remain the device acceptance boundary.

## Full renderer controller and scheduling follow-up

The full live renderer controller additionally settles edits, applies selected state, fingerprints
inputs and serializes the record. Its initial main-thread 2,000-row production samples reached
2.07 seconds (worker 1.36 seconds), above the 2-second reference target despite the backend meeting it.
CPU profiling is retained in `controller-main.cpuprofile` and `controller-profile.json`.
Duplicate accepted-seed/snapshot/serialization copies were removed without weakening public defensive
copies. Automatic core submission no longer keeps a redundant retained-source copy; capture-before-
yield is explicitly tested with concurrent caller edits in TRUSTED/SAFE.

Browser backends now feature-detect native task scheduling (`scheduler.postTask`), preserving core's timer
fallback on other hosts and respecting custom scheduling. Cancellation remains cooperative, with
callbacks kept outside worker transport. See [the platform scheduling contract](https://wicg.github.io/scheduling-apis/#dom-scheduler-posttask).
Production controller timing, timer/animation-frame gaps, payload sizes and actual cancellation clicks
are recorded separately in `controller-production.json`; development results remain preserved.

The final production controller uses three retained warmed samples after two warm-ups, including
settling, selected-state application, signatures and structured-record serialization (no persistence).
Its worst samples are 157.1 ms / 1,470.8 ms for main-thread 200 / 2,000 rows and 116.0 ms / 1,070.0 ms
for worker mode, within the reference targets. The complete prepared controller result is about
0.424 MB / 4.18 MB including the existing payload and callback metadata; this is distinct from the
1.78 MB routine worker reply and is not automatically persisted or retained in React state.

For 2,000 rows the sampled animation-frame gap reaches 172.3 ms main-thread / 81.5 ms worker,
including local selected-state application/serialization. Worker execution does not eliminate all UI
work. Physical cancellation clicks during main-thread/worker preparation return cancelled and
ineligible, with observed post-click completion 16.9 / 56.3 ms. These timings are observations, not
ordinary test thresholds or universal device guarantees. Actual Hermes acceptance is still required.

## Packed candidates and release boundary

Labels below deliberately retain the last published versions; these are unpublished candidate bytes,
not claims that registry releases contain Plan 3. All candidate trees are independent and unpacked
from the recorded archives. Compare SHA-256 when reproducing, not version labels alone.

| Package            | Candidate                      | SHA-256                                                            |
| ------------------ | ------------------------------ | ------------------------------------------------------------------ |
| form0-core         | `form0-core-0.7.0.tgz`         | `17d2b279a5363b3d927cc76fed28f95b6516fb79bf0ed87e62b891dfb9248f45` |
| form0-react        | `form0-react-0.4.0.tgz`        | `a0d0379d494b228bde9c2ed47cd175fc8e3ce29a05cac6177813ab1fd41f3773` |
| form0-react-native | `form0-react-native-0.5.0.tgz` | `f393c7956e85bbe6e20680d83f11b1dbd86f8af9204499341b40c656f00ed4a3` |
| form0-cli          | `form0-cli-0.7.0.tgz`          | `1a72d8d2942c3c59edd809a65660e21c884d60b64c584d52e142f64612485cb7` |

Publish the coordinated additive core capability before publishing dependent consumers, then update
consumer/Builder minimum ranges and locks to those releases. Existing user core dependency edits are
preserved. Maintainer-owned version changes, merges, publication, deployment and issue closure are
not performed here. Builder's current published dependency ranges alone do not establish compatibility
with the unpublished Plan 3 interface.

## Acceptance mapping and remaining work

| Issue / boundary           | Implemented evidence                                                                                                                                                                  | Remaining acceptance                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Core #99                   | Shared field participation/type-aware emptiness, required/read-only policy, hidden ancestors, scoped custom validation and draft eligibility, adopted across consumers.               | Maintainer review and coordinated release; renderer/device acceptance below.                                            |
| Core #104                  | Selected snapshot validation/serialization, scoped state/finding ownership, errors separate from execution/diagnostics, save-once conditional revalidation.                           | Maintainer review and coordinated release; no automatic closure.                                                        |
| React #73                  | Automatic/confirm/retain closed-row freshness, nested accepted edits, bidirectional collection dependencies, all-or-none reviews, callback failure/retry and actual worker transport. | Three Android/Expo Go walkthroughs for equivalent Native behavior and maintainer acceptance. Keep issue closure manual. |
| Production reform          | Required persistence/revision/media/callback/offline changes are documented separately.                                                                                               | Separate delivery across web/public-share/mobile/backend; no durable authenticated-web drafts added.                    |
| Native/mobile dependencies | Existing exception policy preserved.                                                                                                                                                  | Separate targeted remediation before 7 November 2026; iOS acceptance deferred.                                          |

The original isolated Expo SDK 57 / React Native 0.86.3 fixture built an Android Hermes bytecode bundle and
persists a record-plus-companion envelope in a separate SQLite database. The maintainer has an Android
Expo Go device available. Record the actual model, Android/client/RN versions and Hermes flag when
running the three walkthroughs; a successful export does not establish actual device acceptance.

## Android host migration to SDK 58 — 23 October 2026

The maintainer could not install the matching SDK 57 Expo Go client and selected migration of the
form0 starter and acceptance harness to SDK 58 before the device walkthroughs. Production Reform
adoption remains deferred. The active device tree now uses Expo 58.0.17, React Native 0.88.0 and
React 19.3.0, preserving the candidate archives and SDK 57 evidence above.

Both starter and harness pass Expo Doctor 20/20 and dependency compatibility checks. Starter
Android/iOS bundle exports, disposable native generation, the device Android Hermes export, Native's
54 Node tests, public declaration consumption and the 23-test four-locale documentation gates pass.
A local Metro manifest reports SDK 58.0.0. Actual Android/Hermes timings and the three walkthroughs
remain pending; previous browser/Node performance evidence is not reclassified as SDK 58 acceptance.

The starter's exact temporary audit graph was re-reviewed for SDK 58. The same two known advisories
still produce 15 high dependency entries; policy tests pass 19/19, with no deadline extension or
advisory expansion. Native's separate peer exception is unchanged. See the
[migration evidence](../../form0-mobile-tmpl-react-native-expo/analyses/SDK_58_MIGRATION.md) and updated
Native Android guide for commands, limits, storage and remaining work. No local docs production build
or actual device acceptance is claimed.


## Pixel profile and performance candidate — 24 October 2026

The maintainer's Pixel 8a / Android API 37 / Expo Go 58.0.5 / RN 0.88.0 Hermes diagnostic
identifies approximately 70% explicit yield waiting in the warm managed run (19.7 of 28.1 seconds).
Core now reuses expression argument layouts and immutable builtin-name sets; Native selects host
idle tasks with cancellation while preserving the 8 ms work budget. See
[the investigation](ANDROID_PREPARATION_INVESTIGATION.md) for exact baseline data, new packed archive
hashes, regression evidence and matched desktop improvements. Core implementation: `de1667d`;
Native implementation: `e7a7e7c`; Native acceptance guide: `42bf03a`.

All core release gates, 93 React tests, 61 Native Node tests, 29 Native adapter cases, 168 CLI tests,
actual-browser main/worker view and submission cases, CLI persistence interactions and eight worker
release/memory cycles pass. Matched managed desktop preparation now meets the reference 250 ms / 2 s
fixture targets. Native's updated physical-device profile is still pending; performance and Plan 3
are not complete. No publication, deployment, push, dependency installation or cleanup was performed.

The subsequent physical Pixel 200-row profile now confirms the expected revision and idle scheduler:
warm managed preparation is 1,010.3 ms versus the previous 28,102.4 ms. Exact data is in the linked
investigation and `logs/android-pixel8a-after.json`. Added repeated/rapid live-edit cases pass in
React and Native under TRUSTED/SAFE; the React target file passes 7 cases, Native's full adapter
suite passes 31. A real Chromium main/worker live-edit check passes four cases with four workers
and no page errors. Core dependency/static-EVAL/current-binding/re-entry/scoped tests also pass.
These additions change tests and evidence only; installed runtime hashes remain unchanged. The
remaining physical acceptance step is the full-renderer large-form preparation/gap/cancellation
check in walkthrough 3, preserving walkthroughs 1 and 2 as accepted.


## Responsiveness and exact candidate follow-up — 24 October 2026

See [the current investigation](ANDROID_PREPARATION_INVESTIGATION.md#bounded-preparation-serialization-and-owned-tree-signatures--24-october)
for measured causes, bounded capture/output/serialization ownership and the full verification record.
Core adds `createStructuredRecordAsync` with separate scheduling and stable-input ownership; it
shares exact formatting with the synchronous API. React/Native use it for root submission, retaining
save-hook-once, validation, cancellation and late-edit/disposal guards. CLI keeps its synchronous
server serializer and gains equivalent guards/release protection. No public record schema changes.

The physical `native-responsive-serialization` Pixel result is 1,682 / 12,457 ms for 200 / 2,000 rows,
with gaps 152 / 325 ms, eligible/no issues; prompt cancellation is separately confirmed. The newer
`native-owned-tree-signatures` candidate shares immutable accepted-tree signatures across renderer
checks; all mutable values/metadata/policy remain fresh. One targeted large Pixel timing check remains.
Walkthroughs 1/2 and cancellation retain acceptance; there is no new broad manual checklist.

Full checks now cover core 48 evaluator scenarios and all release gates; React 100 tests; Native
69 Node tests/35 adapter cases; CLI 168 tests; actual browser main/worker submission/view/live/reload;
CLI persistence/reload; Builder 10 cases; Native declaration checks; four-locales source/parity/lint
and 23 docs tests. Reference browser controller 200/2,000 rows meets 250 ms / 2 s with managed
validation; complete 2,000-row result bytes remain 4,169,642 main / 4,163,362 worker. Node-worker
release cycles retain zero report entries, without claiming actual Hermes/frontend peak memory.

Final new archives live in the separate active-harness `responsiveness-owned-tree/` directory.
Exact sizes, SHA-256/integrities and installed source parity are in
`logs/responsiveness-owned-tree-candidates.json` and
`logs/responsiveness-owned-tree-device-candidates.json`; earlier Pixel archives are preserved.
No dependency installation, SDK migration, release, deployment, push or issue closure occurred.
No cleanup was performed; active device/review trees remain protected pending final acceptance.


Responsiveness implementation commits: core `ee43cf7`, React `854f79d`, Native `f2bced7`, CLI
`eabac90`; localized API docs `b46fb44`. All use existing development history; maintainer funding
and dependency edits remain outside these commits. No publication or device performance completion
is implied. Exact archive hashes are also copied into the current investigation for durable review.


## Bounded throughput follow-up — 24 October 2026

The latest [investigation](ANDROID_PREPARATION_INVESTIGATION.md) records a conservative primitive
binding specialization and removal of redundant private event-context copies. Dynamic expressions,
EVAL, helpers/overrides, object values, unresolved names and arguments retain full context. Every
calculation/security check and row validation still executes with current values; no callback or
result is shared across records. No public interface or record/freshness shape changed.

Final core release gates pass with 50 evaluator scenarios and 97 package files. React 100, Native
69 Node/35 adapter, CLI 168, actual browser worker/live/reload/view/submission, CLI persistence/reload,
Builder 10, Native declaration and four-locale/23 docs tests all pass against packed candidates.
The paired managed 2,000-row Node workload improves 27% with matching complete output/input hashes.
Production desktop Chromium controller: 200 rows 125.6/132.9 ms main and 125.2/139.0 ms worker;
2,000 rows 1,109.8/1,133.4 ms main and 1,052.1/1,047.7 ms actual worker. Reply sizes are unchanged.
The final Native-adapter CPU4 gate passes, with preserved earlier noisy-task failure evidence.

Exact archives and installed source parity: active-harness `logs/throughput-candidates.json` and
`throughput-device-candidates.json`. The new core SHA-256 is
`d2eec93bf76e746825c06448af1f274fdb3ab73670f1ac954d99227d642cd651`; consumer source archives are unchanged.
Metro's fixture revision becomes `native-throughput-bindings`. No dependency install/SDK change,
cleanup, push, publication, deployment or issue closure occurred. Stop further optimization edits
until the one focused Pixel comparison; previous 12,400 ms/gap294 ms remains the physical evidence.
No new broad manual walkthrough or core-only profile is required. Plan 3 performance remains open.

Core throughput implementation: `ea9adf0` on development. Maintainer package/lock changes are preserved outside the implementation commit.

## Physical throughput follow-up — 26 October 2026

The maintainer's Pixel 8a result for `native-throughput-bindings` is completed/eligible/no issues,
9,933 ms elapsed and 293 ms maximum observed JS gap for 2,000 rows. This is approximately 19.9%
less elapsed time than the previous 12,400 ms sample; the 294 ms previous gap is essentially
unchanged. Both are individual transcriptions with unspecified warm-up, not repeated controlled
phone measurements. Raw report: active-harness `logs/android-pixel8a-throughput-bindings.json`.

No code/archive/tree changes or new runtime tests accompany this evidence update. Earlier full
gates, walkthroughs 1/2 and prompt cancellation remain accepted with their original provenance.
The source review confirms unknown calls/complex syntax use full context; only current primitive
expressions with canonical IF/SETRESULT specialize. New builtins therefore do not need optimizer
changes for correctness. Revisit it if extending the whitelist or changing existing semantics.

Recommendation: stop the contained optimization pass and make the remaining large-record latency
an explicit Plan 3 performance acceptance decision. Approximately ten seconds for the stress
submission remains a limitation; this observation alone does not finalize Plan 3, issue acceptance
or release readiness. No additional broad manual retest is requested. iOS and production Reform
persistence remain separate.

## Production-mode measurement readiness — 26 October 2026

The maintainer authorized a bounded follow-up with behavior preservation and benefit/maintenance
tradeoffs explicit. Device fixture revision `native-production-baseline` displays `dev` and Hermes
flags. Fresh controller runs are separate from repeated unchanged-input core runs; a diagnostic-only
source copy supplies phase timings. Product runtime/package bytes are unchanged.

The independent candidate tree passes 77 Native Node tests. Eight wide-fixture cases (200/2,000 rows,
TRUSTED/SAFE, managed on/off) match complete instrumented/control results and preserve input hashes;
pre-cancellation also matches. The production Android JS bundle exports successfully with
`__DEV__=false` verified. No APK build, dependency install or replacement was needed. Earlier runtime,
browser/worker, CLI and localized-doc gates retain provenance; they were not rerun for fixture-only
changes. Current Native browser CPU4 timings remain above two seconds and are not Hermes evidence.

Detailed results, limits and the excluded legacy diagnostic probe are recorded in the
[investigation](ANDROID_PREPARATION_INVESTIGATION.md). Three focused physical reports are requested
in the latest Native guide; they remain pending. No additional runtime optimization or performance
acceptance is implied.

## First production-mode physical reports — 26 October 2026

Pixel/Hermes with `dev:false`, SAFE off: 200 rows 1,373 ms/gap 96 ms; 2,000 rows 9,897 ms/gap
336 ms. Both completed/eligible/no issues and the form remains responsive. The maintainer corrected
an initial large-row transcription; do not use 19,897 ms. These are individual observations without
supplied warm-up/repeat classification. The large sample is essentially unchanged from the previous
9,933 ms development report. The measurement bottleneck remains unresolved.

The phase profile failed in Expo's native production async-chunk loader. A new actual Metro
`lazy=true` compiled-graph test without global `location` reproduces the exact failure, whereas the
earlier unsplit export did not. The diagnostic entry now uses a bundled require with initialization
deferred to Profile; no shipped runtime, schema or dependency changes. Corrected graph: zero chunk
network loads, identical complete 200-row TRUSTED/SAFE results and immutable inputs. Native Node
suite: 83 tests pass. This is loader/conformance evidence, not physical Hermes phase timing.

See [the investigation](ANDROID_PREPARATION_INVESTIGATION.md) for report provenance. Only the 200-row
phase profile is requested again; controller results and previous functional/cancellation acceptance
are preserved. No further runtime optimization or performance sign-off is inferred.
