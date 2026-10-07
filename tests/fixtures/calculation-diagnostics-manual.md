# Calculation diagnostics: manual before/after checks

Current status (2026-10-04): verification is complete for the approved scope.
Automated gates and user-reported CLI, React main-thread, actual browser worker,
and physical Android tests passed. Android bytecode errors disappeared. The user
explicitly chose to skip iOS device testing; its automated bundle export passed.
Earlier records below preserve the pre-fix failures and previous checkpoints.

Load `calculation-diagnostics.schema.json` in your usual CLI/Playground preview,
React main-thread and worker examples, and React Native example. This fixture
does not need credentials, a backend, or any external service.

| Action                                  | quotient   | dependent | independent | failure_notice |
| --------------------------------------- | ---------- | --------- | ----------- | -------------- |
| Open the form (numerator 12, divisor 3) | 4          | 5         | 24          | Hidden         |
| Change divisor to 0                     | Empty/null | 1         | 24          | Visible        |
| Change divisor to 4                     | 3          | 4         | 24          | Hidden         |

Each divisor edit should update `note` to `divisor changed` through the existing
change handler. It must not create duplicate operations or alerts. This form has
no ALERT handler. Record any crash, stale dependent value, or unexpected event.

For each experience, record the version/core source used, whether all three rows
match, whether the note updates, and any console differences. Repeat with the
modified local core package after implementation. An older installed registry
package does not verify the modified implementation.

Existing renderer diagnostic UI is not expected to change in this work package.
The headless/preview harness will separately demonstrate the new collector and
console controls after implementation.

## Running the after test

Restart the CLI preview and rebuild/restart renderer examples with the modified
local core dependency. Both before and after packages still have version 0.3.1;
check the source and presence of `getDiagnostics`, rather than version alone.

From the CLI checkout, verify the imported core and start the fixture:

```bash
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createFormEngine} from "form0-core"; const schema=JSON.parse(readFileSync("../form0-core/tests/fixtures/calculation-diagnostics.schema.json")); console.log(import.meta.resolve("form0-core"), typeof createFormEngine({schema}).getDiagnostics);'
node bin/form0.js serve ../form0-core/tests/fixtures/calculation-diagnostics.schema.json --port 3030
```

The smoke command must print `function`. Open the preview URL printed by the
server, leave numerator at 12, and perform the three actions in the table.

Load the same JSON in the React example twice, using the renderer's
`engineMode="main-thread"` and then `engineMode="worker"` prop. Load it in the
React Native example too. Check the values, notice, note, and event behavior
separately for each mode; a fallback to main-thread is not a worker test.

For the additional headless API/preview demonstration, run from the core checkout:

```bash
node tests/calculation-diagnostics-harness.js
```

This prints the value sequence, the callback snapshots `[]`,
`[runtime_exception]`, `[]`, and asserts explicit console controls and preview
recovery. It is an automated harness, not a browser or device manual result.

The unchanged baseline core from commit `c9f6f75` is preserved for comparison in
`/tmp/form0-issue100-consumers-xyh4189k/baseline-core`. The final modified package
is in the same directory at `core/package`. These are local test artifacts.

## Results

Automated core baseline: passed on unchanged core 0.3.1, commit `c9f6f75`.
`npm run check`, the separately executed calculation-dependency suite, and the
calculation diagnostics characterization suite passed before runtime edits.

User-reported CLI manual baseline: passed. Divisor 3 → 0 → 4 produced
(4, 5, 24) → (null, 1, 24) → (3, 4, 24); notice visible only at zero;
note updated to `divisor changed`. The user initially reported a local core
dependency, but the subsequent dependency smoke check resolved the CLI's installed
core 0.3.0 and printed `getDiagnostics: undefined`. The exact core source used for
that earlier manual baseline was not independently verified. The automated core
baseline remains verified against unchanged workspace 0.3.1, commit `c9f6f75`.

CLI test setup was corrected by linking `node_modules/form0-core` to the workspace
core. The original installed copy is retained in
`form0-cli/node_modules/.form0-core-issue100-backup-aZy8GN/form0-core`.
The smoke check now resolves `form0-core/src/index.js` in the workspace,
prints `getDiagnostics: function`, and collects `runtime_exception` at divisor 0.
CLI package.json and package-lock.json are unchanged. The manual after test
must use this link and a restarted preview process.

React main-thread and React worker manual baselines: pending. The React Native
original-core device comparison was performed retrospectively after runtime
implementation, as recorded below; it was not a pre-edit manual baseline.
The user authorized implementation following the CLI baseline, with these
platform checks deferred until implementation pauses for manual testing.
User-reported CLI manual after-test: passed with the linked modified local core.
The user confirmed that everything behaved as described: initial values
(4, 5, 24), divisor 0 values (null, 1, 24), and divisor 4 values (3, 4, 24);
notice visible only at zero; note updated after both divisor changes.
No unexpected behavior was reported. The user did not need to fill the detailed
template because all checks matched the expected behavior.

User-reported React main-thread after-test: passed. The user confirmed the
temporary React page behaved as specified for the full divisor sequence, notice
visibility, and note updates. No unexpected behavior was reported.

User-reported React worker after-test: passed. The user confirmed everything
matched the requested checks, including actual worker execution marked
`verified`, the full divisor sequence, notice visibility, note updates after both
changes, increasing state replies, and no unexpected behavior.

User-reported React Native after-change manual results on a physical Android
device through Expo Go: calculations passed, event behavior failed. The divisor
sequence produced the expected numeric results, but note did not update
automatically. Metro reported `[form0] Expression evaluation failed: Property
'bytecode' doesn't exist` after field changes, alongside repeated intentional
`Division by zero` failures while divisor was zero. Full native verification
remains incomplete. The original-core device comparison below clarifies that
its bytecode warnings occur on field changes and stop while idle.

A temporary React main-thread test page is prepared at
`/tmp/form0-issue100-react-manual-4heojq7p`, served on
`http://127.0.0.1:3173/`. It uses the same JSON fixture and explicit
`engineMode="main-thread"`, with React StrictMode as in the maintained Vite
template. Vite aliases all core imports to the modified workspace source and
uses the isolated, built React binding. Its header checks the presence of
`getDiagnostics`. Build, HTTP module checks, and user-reported main-thread browser
interaction passed. React/template source and package manifests are
unchanged. If the temporary server stops, restart it from that directory with
`npm run dev`.

The same temporary page is now prepared for the React worker after-test using
`engineMode="worker"`. An observational Worker wrapper reports `verified` only
after an active engine worker returns state; terminated instances do not qualify.
The separate status component counts state replies without changing worker
messages or rerendering the form. The worker module served by Vite was checked
to import the modified workspace core directly. The temporary page's production
build and HTTP module checks passed. The user subsequently confirmed the actual
browser worker interaction passed; build and HTTP checks are separate evidence.
Hard-reload `http://localhost:3173/` and check that modified local core and worker
execution both show `verified` before repeating the divisor sequence. State reply
counts should increase during edits; no exact count is required. At divisor 0,
set note to a manual marker before changing divisor to 4 to confirm the change
handler updates it again.

A separate temporary Expo app is prepared for the React Native after-test at
`/tmp/form0-issue100-native-manual-JVR6Mq`. It renders the same JSON directly with
the workspace React Native binding, loading its fonts and light theme. Installed
dependencies are shared through a node_modules symlink to the maintained mobile
template; that template's files, manifests, and installed packages are unchanged.
Metro explicitly resolves every `form0-core` import to the modified workspace
`src/index.js`, every binding import to the workspace native `src/index.js`, and
React/React Native imports to the template's instances. The header checks that
`getDiagnostics` is available. Resolver assertions and the Android production
bundle export passed (2675 modules, eight font assets). This does not count as
device/emulator testing or an iOS bundle check.

Start the temporary app from its directory with:

```bash
EXPO_NO_DOTENV=1 EXPO_OFFLINE=1 npm_config_cache=/tmp/form0-issue100-npm-cache npm run start -- --lan --clear --max-workers 2
```

It uses the template's installed Expo SDK 57 and port 3174. Open in a compatible
Expo Go client on the target device/emulator, confirm `Modified local core:
verified`, then repeat the divisor, visibility, and note-marker sequence. Device
connectivity and client SDK compatibility must be established on the actual
target. Native manual results remain pending.

The user's physical Android device could not load the app through the advertised
`exp://172.23.109.140:3174` LAN URL. A host interface check confirmed that address
belongs to WSL's `eth0`; reachability from the phone has not been established.
Recommend restarting the same temporary app with `--tunnel` instead of `--lan`
and omitting `EXPO_OFFLINE=1`, then scanning the new QR code. Expo's documented
tunnel mode requires internet access and the `@expo/ngrok` helper. No firewall or
Windows networking settings were changed. The user subsequently loaded the app
through Expo-managed tunneling and performed the native test sequence.

For the native event compatibility comparison, a separate temporary baseline app
is prepared at `/tmp/form0-issue100-native-baseline-2xT3xF`. All 83 original core
source files were compared byte-for-byte with commit `c9f6f75`. The baseline app
uses that original core through Metro aliases, while preserving the same native
binding, installed Expo/React dependencies, JSON fixture, theme, and fonts as the
modified-core test app. Its header says `Original core c9f6f75: verified` and
expects `getDiagnostics` to be absent. No runtime or binding code was changed.
The baseline app's Metro resolver assertions and Android production bundle export
passed (2674 modules and eight font assets).
User-reported original-core device comparison: completed on the same physical
Android device through Expo Go. The header verified original core `c9f6f75`.
At divisor 4, quotient/dependent/independent were 3/4/24. Note did not update.
Metro emitted the same `Property 'bytecode' doesn't exist` event execution errors
as the modified core. The original core also produced the same require-cycle
warning. The user's explanatory text clarified that bytecode warnings appear
on value changes, including changes to zero and back to four, but do not continue
while idle. Interpret that clarification over the initial YES/NO labels in the
response. This establishes that the native event failure predates issue #100;
it does not constitute a passing native event test. A separate Hermes event
compatibility fix was subsequently approved and implemented; its retest is below.

Automated after-change gates: passed `npm run release:check` in core (including
the calculation-dependency, characterization, and diagnostic contract suites in
`npm test`; zero production vulnerabilities; package contents verified).
Passed the complete documentation `npm run check`: formatting, locale/navigation
and page parity, 19 tests, lint, production build and build-output validation.

Consumer checks used an isolated packed core whose JavaScript sources were
verified against the modified workspace. CLI: 65 tests passed. React: 13 existing
renderer tests and 2 additional React/React Native hook checks passed. Native:
19 existing tests passed. The built React worker message handler passed the same
value/visibility/event-operation sequence headlessly. The two hook checks and
worker sequence also passed with the original core from `c9f6f75`; the CLI run
output matched exactly before and after. These are automated compatibility checks;
they do not replace actual browser worker or native device tests.

Verification logs: `/tmp/form0-issue100-core-release.log`,
`/tmp/form0-issue100-docs-check.log`, `/tmp/form0-issue100-cli-compat.log`,
`/tmp/form0-issue100-hooks-before.log`, `/tmp/form0-issue100-hooks-after.log`,
`/tmp/form0-issue100-native-compat.log`, `/tmp/form0-issue100-worker-before.log`,
`/tmp/form0-issue100-worker-after.log`, and `/tmp/form0-issue100-harness.log`.

The initial issue #100 CLI, React main-thread and worker after-tests passed.
Physical Android calculations matched expectations, but its event check failed
with both original and modified core. The approved Hermes fix below addresses
that pre-existing failure. Issue #100's full manual gate remains open.

## Hermes fix: automated results and physical Android retest

The approved source-capture fix is implemented in core. Before/after event
characterization and Hermes regressions pass. A production-only installation of
the packed modified core passes. Packed-core consumers: CLI 65, React 15 (with
2 web/native hook checks using the shared React alias), native 19. Built worker
message handling and diagnostics/preview harness pass. Core release and complete
four-locale documentation checks pass. These are automated results.

The same temporary modified-core app at
`/tmp/form0-issue100-native-manual-JVR6Mq` now offers two forms and an operation
counter. Final Android and iOS exports are automated bundle checks; neither
counts as a device test. Maintained bindings/templates remain unchanged. The
original-core baseline app remains available.

Stop the baseline Metro terminal with Ctrl+C, then run in WSL:

```bash
cd /tmp/form0-issue100-native-manual-JVR6Mq
EXPO_NO_DOTENV=1 npm_config_cache=/tmp/form0-issue100-npm-cache npm run start -- --tunnel --clear --max-workers 2
```

Scan the new QR in the same Expo Go client. Both `Modified local core` and
`Callback source capture` must say `verified`. Start on `Original diagnostics`.
Repeat divisor 3 → 0 → 4 and the value/notice table above. Each divisor change
must update note to `divisor changed`. While divisor is zero, type a manual
marker in note; changing divisor to 4 must replace that marker.

Tap `Open current-value form` (it remounts a fresh form and resets the counter).
Repeat 3 → 0 → 4. Note is initially empty because no change event occurred.
After setting 0 it must be `divisor=0; quotient=null`; after 4 it must be
`divisor=4; quotient=3`. This verifies current calculated values and a named
callback declared after its ON call. The schema is validated and tested under
opaque Function.toString in `tests/event-hermes.test.js`.

For both forms, divisor batch count and SETVALUE operation count must remain
equal, and `Last batch` must be 1 after changes. Each real input change can
produce a batch; clearing an input and entering another number may produce
more than one change. Editing note manually must not increase divisor counts.
Observe idle behavior separately from edits. At zero, intentional `Division by
zero` calculation warnings remain expected. Bytecode/unavailable-source errors,
unexpected alerts and continued warnings while idle are not expected.

Paste a result for each form: header verification, divisor values/notice, note
updates, counts/last batch, bytecode errors, idle warnings, unexpected behavior.
The user-reported physical Android retest passed, as recorded below. Final
post-fix React main-thread/worker manual regressions remain pending; their earlier manual
results precede this fix. iOS device testing remains unverified. Full manual
closeout awaits the remaining regression checks.

See `analyses/HERMES_EVENT_COMPATIBILITY_PLAN.md` for measurements and logs.


### Temporary startup-probe correction

The user's first post-fix Android launch stopped before either form appeared:
`Condition references unknown field "quotient" in field "failure_notice"`.
The temporary App's startup probe selected array indices 1 and 6; index 6 was
failure_notice, not note. Its reduced schema therefore contained a condition
whose referenced calculated field was absent. Core correctly rejected it.
This was a test-page mistake, not evidence of a calculation/runtime regression.

The temporary probe now selects divisor and note by data_name. A Node check of
the actual probe extracted from App.js reproduced the exact validation failure
before correction and passes afterward, including the retained-source operation
and validation of both complete schemas. The check is kept at
`/tmp/form0-issue100-native-manual-JVR6Mq/check-probe.mjs`; its result is in
`/tmp/form0-hermes-native-startup-check.log`. Bundle exports alone do not execute
module-level startup code. Android/iOS exports passed after this correction;
the subsequent physical Android test passed, as recorded below. No core or
binding runtime changes were needed for the probe correction.


### Physical Android after-Hermes result: passed (2026-10-04)

The user confirmed all requested checks matched on the physical Android device
through Expo Go. Original diagnostics: 4/5/24 → empty/1/24 → 3/4/24 for divisor
3 → 0 → 4, notice only at zero, and note updated after both changes, replacing
the manual marker. Current-value form: note became divisor=0; quotient=null
and then divisor=4; quotient=3. Both forms kept equal batch and operation counts
with Last batch: 1. The user explicitly confirmed bytecode errors disappeared.
No new runtime changes or automated reruns were needed to record this result.

The preceding managed-tunnel startup failed with session closed. Instructions
were supplied to forward the user's custom ngrok domain to Metro port 3174,
set EXPO_PACKAGER_PROXY_URL at process startup, run Metro with --localhost, and
open the HTTPS endpoint in Expo Go via exps://. Installed Expo SDK 57 URL creation
was checked independently. No credentials or service configuration were changed.

Next manual regression: restart CLI against its existing workspace-core link,
repeat the original diagnostics fixture, then repeat React main-thread and actual
worker checks. Retain temporary dependencies/apps until those checks finish.
iOS device testing is unperformed; a bundle export is not a device result.


### CLI after-Hermes result: passed (user-reported, 2026-10-04)

The user reported CLI passed after repeating the requested divisor 3 → 0 → 4
sequence, notice visibility and note updates, including replacement of a manual
marker. The preceding dependency smoke check resolved the workspace core source,
reported getDiagnostics as a function, and showed initial values 4/5/24. The CLI
source/manifests remain unchanged; the temporary workspace-core link is retained.

Physical Android and CLI manual gates now pass. React main-thread and actual
worker final manual regressions remain pending. The existing temporary React
page is prepared with engineMode main-thread and StrictMode retained. Its worker
observer is shown only in worker mode; source/configuration still alias core to
the modified workspace and use the isolated built binding. Maintained React
and template source remain unchanged.

The user asked whether calculation ordering or field updates changed. The final
runtime diff confirms dependency planning, field sequencing, stabilization bounds,
value writes, and calculation/condition/validation ordering were preserved. The
calculation/evaluator edits add reporting; the Hermes fix retains callback source
for the existing current-context event execution. Before/after characterization
assertions cover calculation call order/counts, state maps, null propagation,
recovery and event operations. No scheduling or repeatable ownership change is
included in these work packages.


### React main-thread after-Hermes result: passed (user-reported, 2026-10-04)

The user reported React main-thread passed after the requested divisor 3 → 0 → 4
sequence: values 4/5/24 → empty/1/24 → 3/4/24, notice visible only at zero,
and note updated after both changes, replacing the manual marker. The temporary
page retained StrictMode, explicitly used main-thread mode, and aliased core to
the modified workspace. Its build and served core/module checks passed before
the manual run. Maintained React and template source remained unchanged.

Physical Android, CLI and React main-thread manual gates now pass. The temporary
React page is switched to worker mode for the final browser regression. Confirm
Worker execution: verified and increasing state reply counts during the same
value/notice/note sequence; a main-thread fallback does not count as a worker
pass. Final worker interaction remains pending; iOS device testing is unverified.


### React worker after-Hermes result and closeout (2026-10-04)

The user reported React worker passed after the final requested browser checks:
worker mode and modified local core verified, actual worker execution verified,
state reply counts increasing during edits, divisor 3 → 0 → 4 yielding values
4/5/24 → empty/1/24 → 3/4/24, notice visible only at zero, and note updated after
both changes including replacement of the manual marker. The build and served
worker import checks passed before that interaction, with the worker importing
the modified workspace core. This is a user-reported browser worker result,
separate from headless tests and bundle checks.

The user explicitly chose to skip iOS for now. iOS device testing is deferred,
not passed; its automated bundle export passed. This removes it as an outstanding
requirement for this approved work package. The agreed manual matrix now passes:
CLI, React main-thread, actual React worker, and physical Android/Expo Go.
Automated core release, diagnostics/preview, packaged-consumer compatibility,
production-only installation, documentation and Android/iOS bundle gates pass.
No runtime or public documentation changes followed those final automated gates.

Calculation dependency ordering, stabilization bounds, calculation counts and
result writes remain unchanged. Issue #100 delivers core diagnostics, preview
migration and documentation. The separately approved Hermes event fix delivers
retained authored callback source. CLI/binding diagnostic adoption, React #73,
future repeatable aggregation and import-cycle/tunnel documentation work remain
outside this scope. No commit, release, issue publication or deployment occurred.

Cleanup: the agent-owned temporary React server on port 3173 was stopped. CLI's
temporary node_modules/form0-core workspace symlink was removed and the original
installed form0-core 0.3.0 package was restored from its backup; the now-empty
backup directory was removed. CLI manifests/lockfile/source and maintained web,
native and template worktrees remain unchanged. Compatibility/manual results
were obtained with the modified local core before that restoration; the restored
older CLI package is not counted as verification of this change.

Logs, original/final core packages and temporary harness/app files remain in
/tmp as verification evidence. They are not installed project dependencies or
tracked consumer changes. The user's own CLI/Expo/custom ngrok terminals were
not terminated; they can be stopped with Ctrl+C when no longer needed. Repo
fixtures, regression suites and these reports remain part of the implementation.
