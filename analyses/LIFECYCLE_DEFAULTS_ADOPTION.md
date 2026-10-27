# Default-on lifecycle and host prerequisites — 27 October 2026

The maintainer authorized default-on lifecycle in React/Native, explicit new/existing classification,
and default-on supported focus/blur/click in CLI and bindings. Existing lifecycle:false and explicit
fieldInteractions:[] opt-outs remain supported. Readonly accepted-snapshot behavior, local-only
writes, load-before-new/edit, save-once, conditional revalidation, cancellation and persistence
acknowledgement remain unchanged.

No core runtime or schema/output shape change is required. Core 0.8.1 is already published. Current
binding candidates use that dependency. Binding version bumps/publication remain maintainer-owned;
their unreleased archives still carry development labels 0.4.0/0.5.0 and must not be confused with
registry releases bearing those labels.

## Host changes

- Both starter templates classify their demonstration forms as new. The common wrapper accepts
  explicit recordKind, merges it into existing engine options, and preserves opt-outs/callbacks.
- Starter web logs structured records and connector outcomes; HTTP, full and partial connector
  failures reject after logging. Starter mobile waits for SQLite and propagates its failure before
  invoking the host success callback. No unconditional record logging is added to the bindings.
- Legacy Native callback callers that do not carry preparationId consume rejection locally because
  those released bindings ignore promises and perform no persistence acknowledgement. New prepared
  saves return the rejection to the binding; this bridge is covered for both mobile hosts.
- Reform web classification was already implemented. Its wrapper and Builder scenarios pass with
  the new packed binding. Existing unrelated message/account-deletion work is preserved.
- Reform Mobile's current staging branch receives explicit route classification and truthful save
  callbacks. Declined saves reject without an error alert; failed writes alert and reject. Its SDK
  and dependency versions remain unchanged. Production adoption is still the separate work in
  REFORM_FRESHNESS_ADOPTION_FOLLOWUP.md; passing classification alone is not that complete upgrade.

Fulcrum's reference defines focus/blur for text/numeric inputs and click for hyperlinks. form0
already supports focus/blur and input click/press for its built-in text/numeric controls, plus custom
controller dispatch. This change enables those existing capabilities; it does not add HyperlinkField
or claim identical field support: https://docs.fulcrumapp.com/docs/data-events-reference.

## Automated evidence

Reused the existing Plan 3 React/Native/CLI/browser/Builder/docs trees. A bounded independent copy
of Reform Mobile's existing test dependencies added approximately 948 MB; no dependency installation,
maintained node_modules replacement, SDK change, production docs build or device rerun.

- React full release checks: 117 tests, formatting, both audits and 14 package files pass.
- Native: 90 Node tests and 56 adapter renderer/catalog tests; package and both audit gates pass.
  Focused type checks cover omitted lifecycle with classification and rejection of empty event options.
- CLI: 222 tests, formatting, smoke, package and existing exception-aware CI audit pass.
  Ten real-browser preview cases pass in both TRUSTED and SAFE, including enabled input interactions.
  The new browser regression exposed an unreachable HyperlinkField-only click guard; CLI now
  dispatches actual text/numeric input clicks consistently with the bindings, excluding field buttons. Pi/Undici
  is still accepted risk under the exact existing exception, not fixed or extended by this work.
- Actual Chromium main-thread and browser-worker: 10 default/opt-out scenarios across TRUSTED/SAFE,
  new/existing initialization, live calculations, row-cancel isolation and save-hook execution pass.
- Packed Reform web: 19 classification/wrapper/Builder tests in six files pass.
- Reform Mobile: six committed host tests plus ten harness template tests pass; full app TypeScript
  passes. Template tests execute the actual wrapper callbacks with persistence and renderer doubles;
  they do not claim actual SQLite or database/device persistence acceptance.
- English/Spanish/French/Italian source, localization, navigation, technical/code-example parity,
  docs tests and lint gates pass. Basic examples now supply explicit classification.

Reproducers and complete logs: .local-test-harnesses/form0-plan3-20261022/lifecycle-gates.py,
lifecycle-browser.mjs, logs/lifecycle-final-gates.json, logs/lifecycle-candidates.json,
logs/lifecycle-builder-packed.log and reform-mobile-host/src/template-hosts.test.tsx.
Use lifecycle-gates.py for a fresh sequential run; intermediate resume scripts preserve diagnostic
failures and should not be treated as independent test coverage. Runtime input/output behavior did
not change during the browser-driver navigation and documentation-parity corrections.

## Release boundaries

Commit on existing development branches, with the explicit exception of Reform Mobile staging as
selected by the maintainer. Do not merge, bump, publish, deploy, close issues or widen security policy.
Core needs no new publication for these documentation changes. React/Native should be released only
after their default-on changes are reviewed. Upgrade host package ranges together afterward.

CLI 0.8.0 is already published, so its new default interactions need a later release. The approved
Pi exception is publication-specific to 0.8.0 and is not permission to publish a new version. Resolve
that dependency or review the next release's policy separately; do not change the exception here.
