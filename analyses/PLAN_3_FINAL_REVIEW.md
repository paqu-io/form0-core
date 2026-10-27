# Plan 3 final review — 26 October 2026

Latest behavior checkpoint: the authorized [broader compatibility audit](CONSUMER_COMPATIBILITY_AUDIT.md)
passes with 115 React tests, 89 Native Node / 50 adapter cases, 188 CLI tests and fresh actual-worker
and CLI browser evidence. It fixes pre-existing Other/media UI gaps without changing executors or
public contracts. Earlier review/security/device evidence below retains its original provenance.

The maintainer selected ending the bounded tuning pass and proceeding with final review, retaining
the explicit Pixel large-record limitation. Implementation and functional verification are reviewed;
this is not authorization for publication, deployment or issue closure. The maintainer subsequently
selected holding CLI publication for its upstream Pi/Undici pin while proceeding with core, React
and Native. See [the security checkpoint](PLAN_3_SECURITY_REVIEW.md) for the compatible fixes,
reported preview defects, fresh audits and coordinated version recommendations.

References: [approved contracts](PLAN_3_CONSUMER_ADOPTION.md),
[alignment](VALIDATION_FRESHNESS_AGGREGATION_ALIGNMENT.md),
[verification history](PLAN_3_VERIFICATION.md),
[accepted viewing](ACCEPTED_VIEW_VERIFICATION.md),
[performance investigation](ANDROID_PREPARATION_INVESTIGATION.md).
Product-specific persistence and rollout checklists are maintained in the host application's repository.

Subsequent older-form interaction testing exposed additional CLI synchronization and binding
choice-operation gaps. See [the corrections and current verification](PLAN_3_PREVIEW_REGRESSIONS.md);
its latest CLI 181-test / 48 browser-case feedback follow-up and the 108 React / 86 Native plus
43 adapter results supersede the earlier counts below.

## Review scope

Two independent read-only reviews covered Standards and Spec. Fixed bases are the parents of the
first approved implementation commits; later opening controls, accepted viewing/event-mode and
bounded performance work are included. Repository histories and unrelated working-tree edits are
preserved. Exact pinned heads, bases and nonempty diff statistics are retained in active-harness
`logs/plan3-final-review-scope.json`. No dependency installation or production docs build was used.

| Repository | Fixed base |
| --- | --- |
| Core | `7a2f235` |
| React | `6278297` |
| Native | `8c66362` |
| CLI | `f8fd25b` |
| Builder | `a9d3dce` |
| Documentation | `205af87` |
| Mobile starter | `118d5cf` |

The CLI corrections described below were reviewed in addition to those pinned diffs. Source bytes
match the independent verified core, React, Native, CLI and installed device candidates; the original
parity report is `logs/plan3-final-source-parity.json`, with the later CLI correction covered by
`logs/cli-security-selected-candidate.json`. Historical test/build evidence retains its original
candidate provenance; it is not presented as a fresh execution of every suite during this review.

## Standards

No hard documented-standard violations were found. The reviewed core additions use JavaScript ESM
and the existing entrypoint/execution boundaries. Builtin metadata remains in the authoritative
catalog. Formatting/lint rules already covered by tooling were not duplicated as review findings.

One non-blocking maintenance concern remains: the attempt/review/acknowledgement state machine is
substantially copied across the React, Native and CLI record coordinators. A future correctness
change needs equivalent coverage across all three. Platform scheduling and worker transport differ,
so an immediate broad extraction is not required. Preserve the cross-consumer conformance matrix;
consider a host-neutral internal module only when a subsequent change demonstrates its useful seam.
This is a duplication heuristic, not a documented-standard breach or performance finding.

## Spec

One correctness defect was found and corrected: CLI new-record storage could use the temporary
session UUID while creation returned a different generated record UUID. The requirement is to load
and save the record plus freshness companion by the same record identity. Reopening by the returned
identity could therefore miss both values and pending status.

CLI commit `f74535a` changes session ownership to `identity: identity ?? id`, preserving generated
identity, explicit identity precedence and zero. Three keyed-adapter regressions exercise create,
retain, persist and reopen, checking payload ID, stored key, retained total 330, child totals
110/220 and restored pending freshness. The generated-ID case fails before the correction; all
three pass afterwards. Existing singleton adapters that ignored the lookup key could not expose it.
No schema, callback, record shape or adapter interface changes.

The independent review identified no other concrete Spec findings. Subsequent maintainer preview
testing exposed a separate CLI choice-setter collision: legacy same-named methods shadowed the
field-instance setters, causing the BooleanField `[object Object]` lookup warning and affecting
MultiChoiceField too. Commit `f0d52d4` corrects this with two red/green instance-isolation regressions
and an actual browser input → managed SETVALUE → control-update check. The default-values endpoint
now uses the existing coordinated-core guard. Its failure with installed core 0.7.0 is a package
capability mismatch; consumers must adopt the new core release. No schema correction is needed for
these two reported failures. Full details and exact evidence are in the security checkpoint.

Review covered selected-scope evaluation,
fresh current values and fallback paths, save-hook-once/revalidation, proposal selection/release,
stale acknowledgements, worker transport/cancellation, findings navigation, Native integration,
server-owned CLI policy and Builder record-aware preview. Source review and the retained tests do
not establish a universal performance bound or substitute for deferred iOS acceptance.

## Verification and remaining gates

| Surface | Current evidence |
| --- | --- |
| Core | Full release checks pass for the current runtime candidate; 55 record-evaluator scenarios, complex and deep scoped matrices retained. |
| React | 100 tests and actual main-thread/worker submission, live-edit, accepted-view and schema/event-reload checks pass. Full release gates pass again after the bounded Vitest security patch. |
| Native | 86 Node tests, prior adapter/declaration checks and actual Pixel walkthroughs/cancellation retained. |
| CLI correction | Fresh formatting, all 174 tests, smoke, package checks and actual browser choice synchronization pass against identical packaged runtime bytes. Earlier browser persistence acceptance remains retained. |
| CLI production audit | Body-parser is patched to 2.4.0. The fresh selected audit still fails: 1 high Undici entry and 1 inherited moderate Pi entry. CLI publication is held by the maintainer's explicit decision. |
| Other package audits | Core, React and Native production audits report zero. Core/Native all-dependency audits report zero; React also reports zero after Vitest 4.1.12. No audit policy or Native exception deadline was changed. |
| Builder | Retained maintained-suite/type/localization and actual wrapper preview evidence; no new Builder source change in this review. |
| Public documentation | Retained EN/ES/FR/IT source/navigation/parity/lint and 23-test evidence; no public API changed by the CLI correction or private performance optimizations. Rendered validation stays CI-owned. |

Earlier CLI identity correction: `final-review/form0-cli-0.7.0.tgz`, 318,455 bytes, SHA256
`a04ff4e174c56df98c8a344afe80c2fd84330d534cd95479b735222ea715b211`.
Candidate labels preserve the old package version and do not claim a registry release.
Reports: `logs/plan3-final-cli-identity-red.log`, `plan3-final-cli-identity-green.log`,
`plan3-final-cli-release.log`, `plan3-final-cli-package.log`,
`plan3-final-cli-gates.json`, `final-review-cli-browser.json` and
`plan3-final-cli-candidate.json`. The release command stops at its production audit, so package
checking was run separately and passed. Earlier clean audits are dated evidence, not current claims.
The later CLI candidate and all fresh security reports are in the security checkpoint. The existing
audit policy was not changed. These production dependency findings are distinct from
the docs informational build-dependency audit and the separate Native/mobile exception.

## Performance acceptance boundary

The measured Pixel revision is `native-literal-registration`: dev:false, Hermes:true, SAFE:false,
200 rows 1,333 ms/gap 90 ms and 2,000 rows 8,454 ms/gap 323 ms, eligible with no issues. Cancellation
is prompt and returns cancelled; earlier nested editing and confirmation/persistence walkthroughs
remain accepted. The maintainer selected this documented result as the basis for final review.

The large fixture contains 377 schema elements, six uneven populated levels, 2,000 rows, 80,040
value cells and 20,010 refreshed calculations. Full submission preparation includes managed
validation, selection and serialization, excluding persistence. Normal edits use scoped evaluation.
The observed improvement from 9,897 ms is 14.6%; these are individual fresh observations, not repeated
medians. Desktop reference preparation targets pass; a two-second phone guarantee and a universal
frame-time bound are not established. The 323 ms observed gap remains an explicit limitation.

Further opportunities are recorded in the investigation as hypotheses with measurement and behavior
gates. No new optimization or device run is required by this final review. Actual compiled-release
performance and iOS acceptance are not claimed from Expo Go production JavaScript.

## Issue acceptance and release order

| Issue | Reviewed implementation / evidence | Maintainer-owned remaining work |
| --- | --- | --- |
| Core #99 | Public submission-validation contract separate from engine.eval, type-aware emptiness, nested findings, closed-row custom validation and drafts. | Implementation acceptance complete; core/documentation delivery and manual issue closure. |
| Core #104 | Hidden required fields and hidden descendants do not block; visible required/read-only empty inputs do block; populated inputs and conditional transitions have cross-consumer coverage. | Implementation acceptance complete; core/documentation delivery and manual issue closure. |
| React #73 | Automatic/confirm/retain freshness, nested acceptance/cancel isolation, exact selected totals, persistence failure/retry, worker parity and Native device acceptance with documented limits. | Publish dependent consumers against the new core capability; manual issue closure. |

The maintainer has now published core 0.8.1 and CLI 0.8.0. The former CLI publication hold was
superseded by the explicitly approved, version-specific Pi/Undici exception, expiring 3 November
2026 at 00:00 UTC. It does not authorize a later CLI release or fix the vulnerable dependency.
React 0.5.0 and Native 0.6.0 remain the recommended next binding releases, requiring core ^0.8.1.
Default-on lifecycle, explicit new/existing classification and supported default interactions are
implemented and verified; see [the adoption evidence](LIFECYCLE_DEFAULTS_ADOPTION.md). Actual host
package ranges and lockfiles must be coordinated with the resulting releases.

The issue acceptance mapping above remains implementation evidence, not a fresh assertion about
GitHub issue state. The maintainer retains issue closure, version bumps, pushes, merges, publication
and deployment. Plan 3 package implementation, review and agreed acceptance are complete with the
documented phone limitation. Production Reform adoption and the next CLI security/release decision
remain separately scoped.

Production Reform record/companion persistence, public-share/autosave, offline drafts/outbox and
backend compatibility remain the documented separate delivery. Native/mobile dependency exceptions
still need their separate targeted remediation before 7 November 2026. No new security exception,
deployment dependency or durable authenticated-web draft system was added.
