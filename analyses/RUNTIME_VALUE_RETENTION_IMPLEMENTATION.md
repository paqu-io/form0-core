# Runtime values and hidden-value retention implementation

Local checkpoint: 30 October 2026. These are source-candidate results, not publication or production
adoption. Existing unrelated work was preserved. Package versions and installed dependencies were
not changed. No database migration or production docs build was run.

Core now validates populated text, numeric, date and time values without coercion. Optional scalar
empties remain separate from requiredness. The optional input attribute visible_preserve_value
preserves on omission/true and clears on false during editing/submission, including hidden ancestors
and closed rows. View preserves values. Scalar and record evaluators reuse their existing calculation
executors and settle after bounded clearing batches; only final-round diagnostics are delivered.
Input-only clearing does not remove rows, metadata, media assets or linked records. Explicit rows
in retention-enabled sections survive serialization even when their last value was cleared.

validateHiddenValues includes intrinsic errors in retained hidden scopes for final submission while
leaving hidden requirements/custom handlers and draft policy separate. Reviews capture the option.
clearedFields contains instancePath/fieldName/fieldKey only. Consumers apply the selected state and
cleared descendants, guard replacement trees, and consume worker markers once rather than replaying
them on later READ_STATE calls. Serialization remains transformation-only.

## Verification

- Core: npm run check and package:check; focused scalar-type, date/time boundary, schema compatibility,
  hidden ancestor, choice/media/link, all-empty-row, scope isolation, diagnostic settling, cancellation
  after clearing, retained/refreshed and strict-hidden/custom-handler/review-policy scenarios.
- CLI: npm run check against candidate core; 248 tests, format, smoke, package contents. CSV round-trip
  keeps omitted retention attributes absent and preserves explicit false.
- React: build, format, 215 tests using candidate resolution, package contents. Includes actual Node
  worker transport and marker consumption; browser workers are verified separately below.
- Native: 110 Node tests and package contents; 35 platform-adapted renderer tests, including partial
  date/time typing and closed-row clearing. Diagnostic profiler source matching supports the new
  validation call without changing shipped evaluation logic.
- Docs: formatting, i18n, navigation, parity for 131 substantive pages across four locales, 24 tests,
  lint. No production build. Both guides reflect canonical types and the strict server example.
- Browser: nine scenarios with real pointer interactions, TRUSTED/SAFE, React main/actual workers,
  raw/structured consistency, initial hiding, Edit/View, and Builder adoption gating. No page errors.

Evidence, source hashes, configs and reproducible isolated-resolution scripts are in
[the local harness](../../.local-test-harnesses/form0-value-retention-20261030/results.json).
The harness aliases core rather than installing over maintained dependency trees. Its logs apply to
this checkpoint; rerun the relevant gates after subsequent source changes.

## Reform adoption limits

Builder control and translations are implemented, with the host adoption flag disabled by default.
The backend has an explicit form0:runtime:check command; candidate execution passes, while the current
older installed core fails that readiness gate as expected. Focused web, shared-client and mobile
snapshot/payload probes pass with the candidate core. Frontend/backend typechecks pass.

Reform's rollout decisions and deferred direct-API enforcement are recorded in
[its adoption handoff](../../reform-frontend-tanstack/analyses/FORM0_PRODUCTION_ADOPTION_HANDOFF.md).
All direct/transitive schema readers need compatible releases before enabling the builder control.
No new device acceptance was performed. The existing shared-client adapter generates IDs for
non-string application row IDs; its compatibility probe uses a canonical row UUID. Core and bindings
retain numeric ID zero in their own contract tests; this change does not alter Reform's ID policy.
