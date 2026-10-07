# Hermes event compatibility: approved work package

Status: complete for the approved scope. Automated gates and user-reported CLI, React main-thread, React worker and physical Android tests passed. iOS device testing was explicitly skipped by the user; its bundle export passed.

## Problem and verified baseline

Before this fix, core registered event callbacks correctly, then obtained each
callback's source with `callback.toString()` to execute it in the current scoped context.
Hermes can return a bytecode placeholder instead of executable source. The user's
physical Android/Expo Go test consequently reports `Property 'bytecode' doesn't
exist`, and `SETVALUE('note', 'divisor changed')` never reaches the host.

The same device failure occurs with both the issue #100 working tree and original
core `c9f6f75`. All 83 original source files were checked against that commit.
At divisor 4, both produce quotient/dependent/independent values 3/4/24 while note
does not update. The user clarified that bytecode warnings occur during edits,
not continuously while idle. The require cycle also exists in original core.
Full native event verification is unsuccessful, despite passing calculations.

Read-only Node probes compared original and modified core for inline and named
callbacks, aliases, current field reads, initializer helper calls, host callbacks,
local closures, returned alerts, supported arrows, declaration hoisting, duplicate
registrations/OFF, comments, regular expressions, and template literals. Results
matched before and after issue #100. Initializer helpers ran once; current reads
changed from 9 to 11 on successive dispatches. Event-script lexical variables
are not retained when a handler is recompiled. Some single-line declaration forms
already fail expression classification. These limitations are not expanded by
this work package.

The user is unsure whether application-provided or dynamically constructed
callbacks are used. The maintained mobile example inspected uses inline and named
functions in `form.events.code`; this is not an audit of all user schemas.

## Contract and scope

Fix schema-defined callbacks on Hermes through core. Keep `createFormEngine`,
`ON`, `OFF`, schema event code, and `engine.trigger()` interfaces unchanged.
React Native should not need an engine option or callback workaround.

Preserve these behaviors:

- Event initialization runs once per engine; neither the whole event script nor
  its initializer side effects are replayed on dispatch.
- Handlers read values at dispatch, after the host's existing evaluation pass.
  SETVALUE records an operation; it does not mutate those reads during a handler.
- Record and field access restrictions, scope warnings, and SETVALUE target checks
  remain governed by the current ContextResolver and WarningSystem.
- Existing validation/security configuration is applied to original authored
  source, both at initialization and callback execution. SAFE/CUSTOM retain their
  existing validation behavior; this is not a sandbox or security-mode redesign.
- Handler order, wildcard matching, registration/removal identity, duplicate
  registrations, current OFF behavior, returned operations and their ordering,
  partial operations after a caught failure, and failure continuation are kept.
- ON/OFF inside a handler remain initialization-only and have no registry effect.
- EVAL and DATANAMES keep their current execution-context setup and cleanup.
  Calculation diagnostics remain separate from event reporting.
- No new automatic events, dispatches, evaluation passes, validity rules,
  repeatable event behavior, asynchronous event support, or closure semantics.

React #73, repeatable aggregation, Expo/package upgrades, tunnel documentation,
the existing import cycle, and unrelated event/runtime defects remain separate.
This work does not silently complete issue #100's outstanding native gate.

## Recommended implementation

1. Add one internal source-preparation module, owned by each EventManager.
   Parse the original event script once and retain exact function source slices
   using parser offsets. Associate source with the actual function identity in
   an engine-owned WeakMap; do not wrap or replace registered callback objects.
2. Annotate schema-defined function expressions, arrows, and declarations during
   initialization with a private capture helper. Retain raw authored source for
   later execution; do not retain the transformed/instrumented callback body.
   Preserve declaration hoisting, directive prologues, name inference, aliases,
   and callback identity. Avoid collisions with authored identifiers/helpers.
   Instrumentation must not introduce observable user operations or helpers calls.
3. At dispatch, obtain saved source and use the existing scoped callback execution
   and evaluator path. Do not invoke the original closure directly, and do not
   regenerate registrations or replay initializer code to locate a handler.
4. Retain existing source recovery as a compatibility fallback for callbacks that
   originate outside the schema and have executable source on their engine.
   Reject an unavailable native/bytecode source with a clear event warning and
   continue other handlers. Do not invent source, replay factories, invoke an
   unscoped callback, or introduce a public source-annotation interface.
5. Keep original-source validation and expression-versus-block classification
   explicit through a private evaluator option if instrumentation requires it.
   Calculation calls keep their existing path and defaults. Invalid source must
   follow the existing failure/reporting behavior rather than a silent fallback.

Use Acorn as a production dependency for parsing; no code generator or parser
plugins are proposed. Its installed development-tooling version is 8.18.0.
The inspected ESM module is 233,301 bytes unminified (57,355 bytes gzip); this is
not the application bundle increase. Measure actual core/worker/native bundle
impact after implementation and verify Acorn on the device. This changes core
from zero production dependencies to one and is part of the scope approval.

Source preparation must cover nested scopes, escaped strings, comments, regular
expressions and templates with interpolation. Declaration hoisting and directives
need explicit tests. Unsupported/exotic source forms must preserve existing
failure behavior or be surfaced for alignment before widening the contract.

Reference: [Acorn parser interface](https://github.com/acornjs/acorn/blob/master/acorn/README.md).

## Before/after automated verification

Before runtime edits, turn the characterization probes into deterministic Node
fixtures and capture exact operations, state maps, helper counts, initializer
counts, warning behavior and handler order against the current issue #100 tree.
Retain the original-core comparison for the device failure.

Add an independent failing regression for Hermes-style Function.toString output.
Where schema source is retained, also make toString throw to prove it is not used.
Repeat the same assertions after implementation.

Cover:

- Inline/named functions, supported arrow forms, declarations before/after ON,
  aliases, reused handlers, duplicate registrations, OFF callback identity and
  wildcard ordering; initialization-only ON/OFF behavior remains unchanged.
- Current reads on successive dispatches, calculated-field reads after eval,
  event metadata, helpers, successful EVAL and DATANAMES, and restricted/missing
  reads/SETVALUE targets at root, ancestor and nested schema scopes.
- Comments, strings/escapes, regex literals, template interpolation, nested
  declarations, directives, inferred names and private-name collisions.
- Initializer side effects run once; no extra calculations, helper invocations,
  event dispatches or host operations are introduced by source preparation.
- Runtime failures, explicitly thrown SyntaxError, invalid source, validation
  rejection, partial operations, failure continuation and later recovery.
- Distinct engines cannot share captured source or metadata. Characterize nested
  dispatch before asserting behavior; do not silently repair existing collector
  or execution-context limitations outside this fix.
- Host/dynamic callbacks retain legacy behavior where executable source exists;
  opaque callback source gets a useful warning and does not stop other handlers.
- Existing lexical-variable and asynchronous limitations remain unchanged.
- Calculation diagnostics, console policies, evaluation counts, conditions,
  intrinsic validation errors and submission state still match issue #100 tests.

Include the characterization and Hermes regression suites in npm test.
Final automated gates: core release:check; packed local-core CLI, React
main-thread/worker and React Native compatibility checks; Android/iOS bundle
validation where supported; and four-locale documentation parity/tests/lint/build.
Consumers must import the actual changed local package, not the older registry
installation. Report device/platform checks separately from bundle checks.

## Manual verification and completion

Keep the same Android/Expo Go version and temporary form. After implementation,
restart Metro with the fixed local core and clear its cache. First edit divisor
3 to 4: values must be 3/4/24 and note must become `divisor changed`, with no
bytecode error. Then repeat 3 to 0 to 4: values must match the existing fixture,
notice is visible only at zero, and note updates on both changes. Use a manual
note marker between edits to prove the second handler execution.

Also provide a second validated form where the handler reads a current input or
calculated value, so the device check detects stale captured values. Expose an
operation count through a temporary host observer to confirm no duplicate event
operations. Observe idle behavior separately from warnings during edits.

Repeat relevant web/CLI/worker checks to ensure their working event behavior is
preserved. Record actual platform results. An Android result does not count as
an iOS device result; unavailable platforms remain explicitly pending.

Update the core events/operations explanation and relevant React Native guidance
in English, Spanish, French and Italian. Describe the supported callback-source
model and existing limitations accurately. Keep tunnel documentation independent.

Completion requires automated gates and the previously failing physical Android
event test passing. Then reconcile the #100 manual report with the final evidence;
do not mark native event verification passed based on a headless hook alone.

No commit, release, issue publication, deployment or credentials changes are
included in this proposal.

## Implementation and verification record

Before runtime edits, `tests/event-compatibility.characterization.test.js` passed
against original core `c9f6f75` and the issue #100 working tree. The pre-Hermes
issue #100 source snapshot is `/tmp/form0-hermes-before-core-fgaoLT`. The same
preservation assertions pass after this fix. Inline and hoisted declaration
regressions were demonstrated failing under opaque `toString()` before capture
was implemented; name inference, computed-key coercion, insertion boundaries,
and escaped identifier collisions were checked during implementation.

The internal registry retains exact authored function slices in an engine-owned
WeakMap. Initialization parses once with Acorn 8.18.0. Source annotations return
the original callback identity. Dispatch uses the existing scoped evaluator;
validation and expression classification use the original source. Dynamic class
keys, method/accessor syntax and unusual declaration forms retain the legacy
source path instead of changing their semantics. Opaque external sources report
a clear warning and do not prevent subsequent handlers from executing.

Core `release:check`, including both event suites and the issue #100 suites,
passed. The newly packed core's sources and manifest were byte-checked against
the workspace. A separate clean production-only package installation installed
only Acorn, and passed the opaque-source regression. Packed-core consumer tests
passed: CLI 65, React 13 existing tests plus 2 web/native hook checks, and native
19. The React hook harness requires its existing shared-React resolver to avoid
two React instances; the complete 15-test run passes with that configuration.
The built worker message harness and diagnostics/preview harness also passed.

The four-locale documentation check passed: formatting, locale/navigation/page
parity, 19 tests, lint, production build, and all 512 prerendered routes/output
checks. Core event docs and native renderer guidance describe current-value
execution and callback-source limitations in English, Spanish, French and Italian.

Measured with the original temporary app UI held constant, Android Hermes
bytecode grows from 4,081,757 to 4,250,157 bytes (+168,400, about 4.1%). The same
browser worker grows from approximately 142.65 KB to 263.82 KB; the new worker is
65,392 bytes gzip. These measurements include the event fix and Acorn, not just
Acorn's standalone file size. The final core tarball is 112,553 bytes; Acorn is a
separately installed production dependency.

The temporary native app now offers the original diagnostics form and validated
`tests/fixtures/hermes-event-compatibility.schema.json`. The second form uses a
named handler declared after ON and reads current divisor/quotient values. A
separate observer component counts divisor operation batches and SETVALUEs
without rerendering the form, and delegates application to the binding's default
operation handler. The header probes retained callback source with a throwing
`toString()` and verifies the diagnostics API. Maintained CLI, React, native and
template source/manifests remain unchanged. CLI's earlier temporary local-core
link remains available for the final manual regression check.

The user-reported physical Android retest passed after this fix, as recorded
below. Final Android (2679 modules) and iOS exports also passed; these are
automated bundle checks. Final React main-thread/worker manual regressions remain pending;
iOS device testing remains unverified.

Verification logs: `/tmp/form0-hermes-core-release.log`,
`/tmp/form0-hermes-docs-check.log`, `/tmp/form0-hermes-cli-compat.log`,
`/tmp/form0-hermes-react-compat-fixed.log`, `/tmp/form0-hermes-native-compat.log`,
`/tmp/form0-hermes-worker-compat.log`, `/tmp/form0-hermes-production-install.log`,
`/tmp/form0-hermes-diagnostics-harness.log`, `/tmp/form0-hermes-browser-build.log`,
`/tmp/form0-hermes-android-parser.log`, `/tmp/form0-hermes-android-manual.log`, and
`/tmp/form0-hermes-ios-bundle.log`.


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
module-level startup code. Android/iOS exports passed after this correction.
The subsequent physical Android retest passed, as recorded below. No core or
binding runtime changes were needed for the probe correction.


### Physical Android retest: passed (user-reported, 2026-10-04)

The user reported that all requested React Native checks verified successfully
on the physical Android device through Expo Go, and explicitly confirmed that
bytecode errors disappeared. This is a manual device result, separate from the
previously recorded bundle and simulated-Hermes checks.

- Original diagnostics form: divisor 3 → 0 → 4 produced values 4/5/24 →
  empty/1/24 → 3/4/24. The notice was visible only at zero. Both changes updated
  note to divisor changed, including replacement of the manual marker at zero.
- Current-value form: at zero, note became divisor=0; quotient=null; at four,
  divisor=4; quotient=3. The named callback read current input/calculated values.
- Both forms: divisor batch and SETVALUE operation counts remained equal, with
  Last batch: 1. The user reported all the listed behavior matched.
- The previously failing bytecode error disappeared. Intentional division-by-zero
  warnings and the pre-existing require-cycle warning remain expected.

The physical Android gate now passes. Existing automated core, packed-consumer,
worker, production-install and documentation gates pass. CLI/main-thread/worker
manual checks from before the Hermes change remain recorded but need their final
post-fix regression run. iOS has a passing bundle export; device testing has not
been performed. No cleanup of the temporary CLI link/apps has been done while
these remaining manual checks are pending.


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
