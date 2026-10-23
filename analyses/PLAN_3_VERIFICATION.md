# Plan 3 verification — 23 October 2026

Implementation and automated verification are complete. Actual Android/Expo Go/Hermes acceptance is
pending the three maintained walkthroughs; iOS remains deferred. This document does not authorize
publication, deployment, issue closure or production reform persistence adoption.

Reference: [alignment](VALIDATION_FRESHNESS_AGGREGATION_ALIGNMENT.md),
[approved plan](PLAN_3_CONSUMER_ADOPTION.md), [core contract](RECORD_EVALUATION_CONTRACT.md), and
[production reform follow-up](REFORM_FRESHNESS_ADOPTION_FOLLOWUP.md).

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

The isolated Expo SDK 57 / React Native 0.86.3 fixture builds an Android Hermes bytecode bundle and
persists a record-plus-companion envelope in a separate SQLite database. The maintainer has an Android
Expo Go device available. Record the actual model, Android/client/RN versions and Hermes flag when
running the three walkthroughs; a successful export does not establish actual device acceptance.
