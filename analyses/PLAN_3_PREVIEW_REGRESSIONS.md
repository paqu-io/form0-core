# Preview interaction and binding parity corrections — 26 October 2026

This follow-up addresses the maintainer's actual older-form interaction failures after the initial
[final review](PLAN_3_FINAL_REVIEW.md). Earlier startup and basic choice checks did not cover selecting
an empty Other option or validation after signature synchronization. The new checks exercise those
interactions directly. No core runtime, public API, schema shape, saved record shape, dependency range
or security permission changes are included.

## Findings and corrections

| Surface                              | Before                                                                                                                                                                                                         | Corrected behavior                                                                                                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CLI event adapter                    | `SETVALUE('fruit', 'banana')` placed a string in the authoritative engine snapshot, bypassing the existing choice-control conversion.                                                                          | Convert existing choice shorthand before evaluation and submission serialization. Structured choice objects retain their existing shape.                           |
| CLI state synchronization            | The full legacy updater and the managed updater both wrote controls; unchanged empty Other selections were reset. A metadata wrapper also dropped the new conditions-only option, repeating the child updates. | Apply condition maps, synchronize each actual field instance only when its value changes, then validate the displayed value. Preserve options through the wrapper. |
| CLI inline signature validation      | Validation could observe the pad's earlier value before forced synchronization, retaining its required message.                                                                                                | Synchronize before validation. Clearing a signature shows required; drawing it clears that same inline message.                                                    |
| CLI condition transport              | Filtering by scalar field names omitted container conditions. Returning every engine condition instead would leak maps across record scopes.                                                                   | Include each containing record's containers alongside its existing fields, including status, without including child-row maps.                                     |
| React child event adapter            | Choice shorthand was copied raw, unlike React's existing root adapter.                                                                                                                                         | Normalize scalar single/boolean choices and multiple-choice arrays at the child operation boundary.                                                                |
| Native root and child event adapters | Choice shorthand was copied raw, so the controls and dependent calculations could not read the selection.                                                                                                      | Normalize at both operation boundaries using prepared field metadata.                                                                                              |
| Starter age example                  | A root age handler read `$email`, owned by `evaluation_tests` rows.                                                                                                                                            | Read `$age` in that example. Keep the root-to-descendant read rejection.                                                                                           |

The private binding conversion leaves complete objects and unrelated field values alone. Existing
React root normalization is unchanged. Normal calculation execution, current reads, events, accepted
row coordination, managed opt-out, local-only writes and submission preparation keep their contracts.
The broader core setters/normalization proposal (#101) remains separate.

The maintainer's existing `my-form-sexies/form.schema.json` is not edited. Its age handler still needs
the same sample correction: read `$age` in that handler and adjust its message to
`ALERT('Warning!', 'Age changed to ' + $age)`. Age 12 continues to fail its authored minimum of 16.
A real-browser check deliberately retains and verifies the old handler's scope rejection.

## Automated evidence

All environments reuse independent dependency trees. No dependencies were installed, no user server
or connector was started, and no environment/credential files were read. The actual user schema is
served only by an isolated temporary-project server for interaction checks.

| Gate                               | Result                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI full check                     | Formatting, 178 Node tests and CLI smoke pass. Package contents pass separately.                                                                                                                                                                                  |
| CLI actual Chromium controls       | 16 scenarios in TRUSTED and the same 16 in SAFE pass, covering managed lifecycle on/off, root and row SETVALUE, dropdown/radio/checkbox Other selection/typing/clearing, signature clear/draw and container visibility.                                           |
| Actual older user form             | Choice shorthand, editable Other and signature drawing pass. Age minimum and the expected illegal email read are both verified.                                                                                                                                   |
| CLI persistence and schema watcher | Retained total 330, restored pending freshness, failed-persistence recovery to 360 and ID zero pass; watched calculation/addition/event changes produce 12/13/newB without stale handlers.                                                                        |
| React full check                   | Formatting, build, all 108 tests and package contents pass. Eight new renderer cases cover root/child choice operations, structured metadata, live calculations, row acceptance, sibling isolation, ID zero, immutable inputs and opt-out in both security modes. |
| React actual browser               | Eight main-thread/actual-worker × TRUSTED/SAFE × lifecycle-on/off configurations pass. Enabled row handlers update all three choice types and their calculations, Other remains editable, and row acceptance preserves siblings and IDs.                          |
| Native Node and adapter            | All 86 Node tests, package contents and 43 renderer/core adapter cases pass, including the eight new choice cases. This is adapter conformance, not a new physical-device run.                                                                                    |

The active harness is `.local-test-harnesses/form0-plan3-20261022`. Logs with prefix
`preview-interaction-final-` contain full checks, package checks, adapter, persistence and watcher
results. `choice-events-browser.json` records actual workers and zero page errors.
`preview-controls-resume-{trusted,safe}.log` contains the 32 CLI control cases.
`legacy-form-interactions-final.log` records the user's schema reproduction.

`choice-events-red-green.py` restores pre-fix adapter source in the independent trees, runs the same
renderer regressions, then restores and rebuilds the corrected source in a finally block. It never
changes maintained source. React baseline: two failures and six passes; corrected: eight passes. Native baseline: six
failures and two passes; corrected: eight passes. Legacy disabled-row dispatch is asserted as
disabled in both baselines and corrected candidates. The CLI's earlier
`preview-controls-red.log` separately demonstrates the empty Other and stale signature failures.
The opt-in maintained `form0-cli/scripts/verify-preview-controls.mjs` accepts an existing Playwright
module and Chromium executable through `FORM0_PLAYWRIGHT_MODULE` and
`FORM0_CHROMIUM_EXECUTABLE`; `FORM0_PREVIEW_SAFE=1` selects SAFE. It installs nothing.

Packed candidates and source/archive hashes are recorded in
`logs/preview-interaction-final-candidates.json`. Historical candidate evidence keeps its original
provenance. The dependency graph is unchanged by these corrections; the
[CLI Pi/Undici publication hold](PLAN_3_SECURITY_REVIEW.md) remains in force. Earlier Android
functional/performance acceptance is retained, with its documented large-record limit; iOS remains
deferred. Public localized documentation does not need an interface change for these private fixes.

## Local retest

Restart the CLI preview process to reload server modules, then refresh the browser. Verify the city
handler selects banana and pasta/focaccia, Other accepts text, and drawing a required signature clears
its inline message. Correct the existing sample age handler as described above. There is no need to
repeat the large Android performance fixtures for these operation-adapter corrections.

Commits belong on the existing development branches. Package/lockfile edits already present in the
maintained worktrees are left to the maintainer. No publication, version bump, merge, push, deployment
or issue closure is performed by this follow-up.
