# Issue 101 implementation and verification

Implementation checkpoint: 28 October 2026; acceptance follow-up: 29 October 2026. Changes are on existing development branches in core, React, Native,
CLI and docs. Versions, dependency ranges, publishing, merges, deployment and Reform adoption remain
maintainer-owned. No storage cleanup was executed.

## Delivered contract

Core exports `normalizeFieldValue(field, value)` and synchronous `engine.setValue` / `setValues`.
A nonempty accepted core batch commits atomically, evaluates once and returns state; an empty map
is a no-op. Dispatch remains explicit. Existing direct state mutation stays compatible this release.

Choice normalization preserves schema definitions and existing live/stored shape distinctions:
SingleChoice and Boolean use `choice` / `choice_value`; MultiChoice uses `choices` / `choices_value`.
Only string choice IDs are accepted by setters. Unknown IDs, duplicates, order, labels, metadata,
explicit empty Other text and immutable media handles survive copying. Invalid selections use
ordinary validation. Malformed calls, foreign scopes, calculated/display/container writes and
record-readonly writes fail before mutation/evaluation. Ordinary read_only input fields remain
programmatically writable. Initial values and trusted host replacement retain malformed drafts and
accepted calculations. Existing evaluator result coercion, including numeric calculation outputs,
was not changed by the string-only choice-input rule.

Bindings share the normalizer while retaining their existing state-update timing, scoped evaluation,
operation batching and worker generation guards. Exposed engine handles use existing coordination.
Worker preflight occurs before optimistic values, record synchronization and message queuing, and
again inside the worker. CLI serves only the two fixed dependency-free browser modules and validates
operation batches before updating controls. Managed readonly load handlers may read/present but
cannot write accepted records; writable initialization belongs in edit/new handlers or host loading.

Legacy dispatch now rejects the whole collected batch when field-access validation rejects an operation; the prior partial-filter characterization is intentionally tightened to preserve atomic writes. SETVALUE remains an instruction collector.

## Verification results

All candidate source imports used an isolated core loader; existing dependencies and Chromium were
reused without installation. See the local task report for exact commands, source hashes and logs.

| Package / surface | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core              | Full `npm run check` passes: formatter, lint, normal suite and security tests. Existing standalone live/stored `field-value-registry` tests are now in `npm test`; new normalization/setter tests are included. Expanded final contract test also passes. Package-content and production-audit gates pass.                                                                                                                                                                           |
| React             | Build and 148 maintained tests pass, plus seven Native hook fixture tests in the retained JSX environment: 155 total. This includes actual worker transport, readonly overrides, generation handling, schema changes and exposed setters. Format, package-content and audit threshold gates pass.                                                                                                                                                                                    |
| Native            | Normal Node gate: 94 tests pass. Seven additional actual hook scenarios pass in the retained React JSX environment. Android production Hermes export passes with candidate core/Native source aliases. Package and audit gates pass.                                                                                                                                                                                                                                                 |
| CLI               | Full 243-test suite passes on Node 24.22.1 and 22.23.4; formatter, smoke and package-content checks pass. Browser shared-module HTTP, initial calculated-default hydration, explicit empty Other and BuildingPlan draft regressions included. Current-version audit passes only through the unchanged exact 0.8.2 exception.                                                                                                                                                         |
| Browser           | Eight React choice scenarios pass across main/actual worker, TRUSTED/SAFE and lifecycle on/off; atomic exposed setters included. Fourteen accepted-view/freshness/save/cancel/retry scenarios pass. CLI controls: 26 scenarios per security mode, including calculated and choice defaults with lifecycle on/off; consumer catalog checks and retain/persist/reopen/failure/retry browser adapter scenarios pass in both modes. No page exceptions or logged default-loading errors. |
| Documentation     | EN/ES/FR/IT engine, binding, choice, events, output and CLI examples updated. Locale keys, navigation, 129-page parity, 23 tests, lint and format pass. Production build prerenders 532 routes; rendered metadata/navigation/Markdown/search/sitemap checks pass.                                                                                                                                                                                                                    |

Tests cover defaults, single/multiple live and stored assertions, current choice labels/values,
chained calculations, no intermediate batch input pairs, atomic errors, ID zero, scope and readonly
protection. Retained record suites cover round trips, row order, attachments, timestamps, metadata,
accepted child isolation, invalid drafts, save-hook-once and persistence acknowledgement/retry.
Ordinary scoped updates do not introduce full-record preparation or an extra evaluation pass.

The CLI's initial evaluated defaults include calculated values such as `city_calc`. Preview loading
now hydrates those results through its existing instance-local display path, without editable writes,
events or extra evaluation. Programmatic setters and SETVALUE still reject calculated targets. The
browser regression captures initial values before session setup and checks caught initialization
errors as well as page exceptions; see `CLI_DEFAULT_HYDRATION_FIX.md` in the local task directory.

29 October follow-up: the CLI's four choice change emitters now retain `other: [{ label: '' }]`
when Other is selected before text entry; checkbox synchronization retains that selection too.
The regression includes a regular MultiChoice selection plus Other, real pointer selection,
focus changes and clearing. The former tests started empty and could reconstruct Other from the
still-focused controls, masking the missing entry in change payloads. `OTHER_AND_POLICY_FOLLOWUP.md`
records red/green evidence, both CLI runtime suites, eight React main/worker browser combinations
and 17 React/worker/Native hook checks. Native physical choice acceptance was subsequently reported
passing by the user on 29 October; see the device observations below. The CLI
README and EN/ES/FR/IT live-preview pages explain authored confirmation versus open-editor evaluation.

29 October BuildingPlan follow-up: canvas mutations now automatically open the owning floor's draft
and commit geometry and descendant rows together through the managed CLI editor. Floor Save still
requires valid survey answers; Cancel restores geometry and rows together. An open child editor must
be accepted/cancelled before drawing. Pending drawings lock conflicting controls; readonly records
and authored readonly plans reject writes. SETVALUE scope protections, core evaluation and submitted
formats are unchanged. Ten durable server/adapter tests run in the ordinary CLI suite; pointer-driven
canvas checks cover both security modes and lifecycle settings, alongside existing preview-control
and persistence gates. A separate React pointer check confirms a drawn wall survives field-driven
rerendering and is removed on room Cancel; no binding production patch was needed for that path.
Native has no equivalent canvas implementation; its separate BuildingPlan checks use hooks, without
claiming physical canvas acceptance. See
`building-plan-diagnosis-20261029/REPORT.md` in the task directory for exact scope and evidence.

React's all-dependencies audit reports two low-severity findings below its unchanged high threshold;
its production audit reports zero. CLI retains one moderate and one high Pi/Undici finding under
its existing **0.8.2-only** exception, expiring **2026-11-03T00:00:00Z**. This exception does not permit
a future CLI publication; resolve the findings or obtain a separately authorized policy decision.
Correction after inspecting the 28 October deployment: docs production audit reports zero. The deployment at 12:29 UTC reported 9 high build-toolchain findings, matching a fresh lockfile-only audit. The earlier 18-count log is a historical local reused-installation result, not the deployment count. The full docs audit is explicitly informational (`continue-on-error: true`) under the existing workflow and SECURITY.md; it does not block deployment. These findings need maintenance review, but are not a new issue-101 release gate. Local installed GraphQL Tools utilities (10.11.0) and Vite (8.1.5) differ from the lock (12.0.1 and 8.1.6); the final docs PR must receive the existing clean-install CI checks. No dependencies, security gate or exception limit were changed.

## Performance and remaining acceptance

Matched desktop Node 24.22.1 comparison uses original core HEAD and candidate, the same retained
wide fixtures, two warmups and five samples per size. Prepared snapshots are identical.

| Rows  | Baseline median | Candidate median |  Change | Baseline / candidate max observed gap |
| ----- | --------------: | ---------------: | ------: | ------------------------------------: |
| 200   |        76.34 ms |         66.50 ms | -12.89% |                      16.49 / 16.37 ms |
| 2,000 |       612.22 ms |        618.63 ms |  +1.05% |                      30.63 / 28.22 ms |

These observations are not a statistical speedup/regression claim. The existing reference benchmark
also passes all configured targets. The earlier comparison is retained separately because another
build may have overlapped its run; the table uses the later idle comparison.

Historical accepted physical Pixel results remain **1,333 / 8,454 ms**, max JS gaps **90 / 323 ms**.
On 29 October the user reported that the corrected Android candidate opens and all walkthrough
checks pass, specifically choices/setters and nested choice editing/Cancel/Save. These are physical
user-reported results; the agent did not attach through ADB. New observations are **1,234 ms / 83 ms**
for Large 200, **880 ms / 84 ms** for its warm sample and **8,704 ms / 354 ms** for Large 2,000
(elapsed / maximum observed JS gap). The user confirmed exactly the same Pixel 8a / API37 /
Expo Go58.0.5 / RN0.88, JS development mode false, Hermes true and SAFE off. The first 200-row sample
is 99 ms faster (7.43%) with a 7 ms smaller gap; 2,000 rows is 250 ms slower (2.96%) with a 31 ms
larger gap. Single observations and the separate warm sample do not establish a statistical speedup
or regression.

The [issue-101 Pixel walkthrough](../../form0-react-native/analyses/ISSUE_101_ACCEPTANCE.md) records
this acceptance and a harness-only terminal-reporting follow-up. Original source hashes were saved
before adding that reporter. It runs after confirmed SQLite writes for small synthetic fixtures and
never during preparation; five focused tests and a local production Metro endpoint/bundle probe
pass. Its physical tunnel transport still needs one Submit check after restarting Metro. Missing
Native dropdown arrows are deferred styling work under Native #45 and the web counterpart React #77.
iOS remains deferred. Native's hook fixture uses the retained JSX environment in addition to its
ordinary Node gate; no new package test dependencies were installed.

Expanded BuildingPlan parity checks pass in 10 web pointer scenarios and four Native hook scenarios;
the CLI disappearing-child defect was not reproduced and no binding production patch was needed.
Web supports Add Room rather than a Draw Room tool; Native has no equivalent canvas, so these results
do not claim identical UI coverage. Both deferred interaction alternatives—selected-object details
navigation and one floor-wide edit session—are recorded in the private backend discussion document,
`docs/building-plan-ifc-and-entity-graph-discussion.md`, section 8.5. Neither was implemented.

## Provenance, storage and release order

The local report is
`../.local-test-harnesses/form0-issue101-20261028/REPORT.md` from the core repository. Its source
manifest records all five HEADs, development branches, dirty files, lock hashes and exact source
hashes. Unpublished tarballs keep existing version labels; identify them by SHA-256/integrity rather
than treating them as registry releases. The Android export also has a hash in the artifact inventory.

Publish the new core first. Before publishing React, Native or CLI, bump their minimum core range
and regenerate locks to require that core's new export; the unchanged `^0.8.1` ranges are not release
ready for these changes. Build/test again against the published core. Resolve the separate future
CLI security approval blocker. Then publish consumers, deploy matching docs and adopt in connectors,
templates and Reform in a separately owned dependency update. No record or schema migration is needed.

The task began with a disk/inventory snapshot and owns one identifiable directory. Its before/after
allocation and every new file's purpose, size, hash and reproduction dependency are recorded there.
Disposable caches/build copies and retained evidence are listed separately; delete nothing without
approval. Existing accepted evidence and device-launcher source were not edited. Browser tooling
regenerated its optimized dependency cache inside the reused independent dependency tree.
