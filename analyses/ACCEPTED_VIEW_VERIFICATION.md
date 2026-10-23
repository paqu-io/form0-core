# Accepted-snapshot viewing and event mode verification — 23 October 2026

This implements the approved view/load policy after Plan 3 opening controls. Actual Android/Expo
Go/Hermes acceptance remains pending the three updated Native walkthroughs. iOS remains deferred.
No merge, push, version bump, publication, deployment or issue closure was performed.

## Implementation commits

| Repository | Development commit |
| --- | --- |
| form0-core | `df6a9b8` |
| form0-react | `aa8e58f` |
| form0-react-native | `73e9fa1` |
| form0-docs-zudoku | `27c6e70` |

## Delivered behavior

- View preserves supplied accepted calculated values and does not apply missing schema defaults.
  Conditions and intrinsic validation still use those supplied values. Edit starts calculations
  with current permitted ancestor values. Mode changes keep the same editor and do not replay load.
- Accepted totals 110/220 and root 330 stay visible in View. Editing line 1 computes 120; cancelling
  leaves 110/220/root 330, and saving that child accepts 120/220/root 340. A failed root persistence
  callback leaves selected 120/240/root 360 as unsaved working values, including after returning to View.
- Scalar engines accept mode edit/readonly (default edit) and expose getMode/setMode. A headless host
  evaluates explicitly after setMode. Scoped tree evaluation adds interactionMode readonly without
  changing evaluate/prepareSubmission accepted/refresh policies. No schema or record attribute is added.
- Event mode is captured from the executing engine, independently for each handler; metadata and
  handler assignments cannot grant writes. Viewed children remain readonly under editable parents.
  Headless tree validation receives readonly execution context without reopening records; editor
  validation retains its interaction mode and the stricter findings-only phase permissions.
- The shared builtin catalog declares descriptor effects. View allows reads, ALERT and engine-lifetime
  ON/OFF, and rejects record-write batches before delegation, including accompanying alerts/listener
  updates. Unknown descriptors/effects are rejected. Managed execution returns issues; legacy execution
  returns no operations and uses structured warnings. Intrinsic errors and calculation diagnostics
  remain separate. Nested authored callbacks retain source for Hermes without capturing local variables.
- Managed opening still awaits load, then new/edit for direct editing. View → Edit runs edit only.
  No closed-row load/edit/change/save/unload replay is introduced. Field-level read-only is independent
  from whole-record view permission. New rows start editing; parent read-only restrictions still win.
- Main-thread and worker calculations discard superseded scoped evaluations. Workers transport mode
  changes as cloneable requests. Read-only views do not schedule record timestamp updates. IDs,
  including zero, accepted row order and media metadata remain intact.

## Verification

All checks used Node 24.22.1, retained independent dependency trees and packed core candidates.
Heavy checks were sequential. Binding builds use current maintained source synchronized into those
independent trees. Final Native/React archives are packed from those tested trees. No install or
SDK export was required, no maintained dependency tree was replaced, and no secret file was read.

| Check | Result | Evidence under active harness logs/ |
| --- | --- | --- |
| Core formatting, lint, full suite, production audit and package contents | Pass; 95 package files, zero production audit findings | accepted-view-core-release.log |
| Core new view/mode/default/listener/descriptor scenarios | TRUSTED and SAFE pass, including opaque-function/Hermes source characterization | tests/view-mode.test.js via managed-events.test.js; core release log |
| React production ESM/CJS/worker build and full suite | 93/93 | accepted-view-react-full.log |
| React formatting and package contents | Pass; 14 package files | accepted-view-react-format.log, accepted-view-react-package.log |
| Native adapter build and full behavioral suite | 29/29 | accepted-view-native-full.log |
| Native Node suite, declarations and package contents | 54/54; types pass; 67 package files | accepted-view-native-node.log, accepted-view-native-types.log, accepted-view-native-package.log |
| Actual Chromium accepted-view pointer checks | 12 main-thread/worker TRUSTED/SAFE scenarios; 10 actual worker instances; no page errors | browser-accepted-view.json; browser-accepted-view.mjs |
| Existing actual-browser submission cases | 14 scenarios; no page errors | accepted-view-browser-record.json; browser-record-accepted-view.mjs |
| CLI tests and browser persistence scenarios | 168/168; retention/reopening/failure/retry pass | accepted-view-cli-full.log, accepted-view-cli-browser.json |
| EN/ES/FR/IT docs source, formatting, localization, navigation, page parity, tests and lint | All pass; 23 tests | accepted-view-docs-*.log |

React's high/critical audit gates pass with the existing two moderate development-tool findings.
Native's package audit currently reports zero findings, including a refreshed maintained-package
policy check. This pass changes no dependency versions or exception policy. Mobile/starter dependency
exception remediation remains a separate task with the existing 7 November deadline. No local docs
production build ran; rendered validation remains docs CI owned.

The first browser attempt served a stale Vite optimized dependency; forced re-optimization loaded
the actual candidate. Nested worker assertions now await initialization rather than checking the
initial empty field. The initial memory-driver invocation omitted --expose-gc and could not measure
retained heap; the corrected run explicitly verifies GC availability. These are harness corrections,
not passing evidence from those first attempts.

## Performance and release of reports

The existing wide fixture has 377 schema elements, 90 calculations, 549 condition leaves and six
populated uneven repeatable levels. Existing deep/core tests reach at least 20 levels. Dedicated
production-browser measurements exclude warm-up, persistence and acknowledgement, and include live
controller settling, signatures, selected-state application and serialization. The reference 250 ms
and 2-second preparation targets are met. These are reference-machine observations, not device results.

| Rows | Execution | Maximum warmed preparation | Maximum sampled JS scheduling gap | Maximum prepared reply bytes |
| --- | --- | --- | --- | --- |
| 200 | main-thread | 176.3 ms | 42.7 ms | 424,085 |
| 200 | worker | 120.8 ms | 8.5 ms | 417,805 |
| 2,000 | main-thread | 1665.2 ms | 197.5 ms | 4,175,116 |
| 2,000 | worker | 1028.0 ms | 49.3 ms | 4,168,836 |

Main-thread synchronous work can still produce the recorded scheduling gaps; the 8 ms cooperative
budget is not a bound on copying, serialization or an individual expression. Actual cancellation
clicks pass in both execution modes. Browser window heap samples do not measure worker heap or true
process peak. See accepted-view-controller-production.json and controller-accepted-view.mjs.

Eight GC-enabled Node-worker automatic/confirm/release cycles return empty change reports after
release. Retained tail heap ranges from 14,606,408 to 16,056,368 bytes, without accumulation;
maximum sampled worker heap is 123,051,136 bytes. This measures
Node worker behavior, not Hermes. See accepted-view-worker-memory.json and reproduce with
`node --expose-gc memory-accepted-view.mjs`. The temporary roughly 4.18 MB prepared reply is still
record plus existing callback metadata, not a persisted per-record database allocation. Freshness
continues to use the grouped companion format; no value history or executable proposal is stored.

## Exact candidates and device handoff

Paths below are relative to `.local-test-harnesses/form0-plan3-20261022/`. Existing version labels
identify unpublished candidate filenames, not registry capability guarantees.

| Package | Archive | Bytes | SHA-256 |
| --- | --- | --- | --- |
| form0-core | `accepted-view/form0-core-0.7.0.tgz` | 127,272 | `548aa1b01d1c2ef27eb86849eb5bf93255fe245d8914e5a18a7575363606c60b` |
| form0-react | `accepted-view/form0-react-0.4.0.tgz` | 370,357 | `ea73b1bbcc018aa2e677b0cc05914e4a2b2ce11f6795783e6c99a0bcbd2f80c8` |
| form0-react-native | `accepted-view/form0-react-native-0.5.0.tgz` | 420,739 | `a8f79f7b8c8c920a154c9182db1814b0d22212ae8ff56b0222eda15c6a063898` |

All core/Native src bytes match maintained source; every extracted package member matches the
archive in the retained device tree. Device package/lock references and integrities point to these
archives. SDK/dependency versions are unchanged and only the root core resolution exists. The
Native declaration check resolves this device installation. See logs/accepted-view-candidates.json
and pack-accepted-view.py. Earlier archives and their evidence remain intact.

Reload the existing device app and reset each fixture. Follow
[the three walkthroughs](../../form0-react-native/analyses/PLAN_3_ANDROID_ACCEPTANCE.md), recording
actual device/Android/Expo/RN/Hermes details. No additional manual suite is required by this change.
The earlier SDK bundle export and walkthrough 1 result apply to their original candidate, not this
new source. Publication must coordinate the new core capability before dependent consumer releases.
Existing load setters require event.mode guards or migration to new/edit; no schemas are rewritten.

## Storage and remaining ownership

The three archives total 918,368 bytes. Verification reused installed trees;
new browser production assets and logs are small. WSL reports about 196 GiB available, but Windows
D: still has about 4.6 GiB free. Keep the active SDK/device and candidate trees through acceptance;
review disposable/historical cleanup afterward before another dependency installation. No deletion
was performed. Maintainer dependency/funding edits and unrelated Builder/Reform work remain untouched.

Core #99/#104 and React #73 retain the existing acceptance mapping; these checks add the selected
view/load policy. Actual Android acceptance, release operations and issue closure remain maintainer
owned. Production Reform persistence/load-handler migration stays in the separate follow-up.
