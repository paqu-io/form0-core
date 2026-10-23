# Plan 3 execution

Reference: [alignment](VALIDATION_FRESHNESS_AGGREGATION_ALIGNMENT.md). Core 0.7.0 is published.

## Selected contracts

- Add scoped editor evaluation to the shared core evaluator. Closed rows retain accepted calculations;
  only the selected editor evaluates. Normal scalar calculations and intrinsic engine semantics stay intact.
- Ordinary submission defaults to automatic refresh. Authored confirmation cannot be weakened by a host.
  Retention requires explicit host permission; selection applies to all affected children or none.
- Apply selected evaluated values as unsaved editor work even when ordinary validation or persistence
  fails. This introduces no durable web draft system. Cancelled/failed evaluation never applies a proposal.
- Existing host callbacks acknowledge persistence by successful completion. Prepare-only controllers
  acknowledge explicitly after saving the record and matching freshness companion.
- Persisted pending status stays distinct from working freshness. Stale acknowledgements cannot clear
  newer state. Drafts retain accepted children, allow ordinary errors and reject execution failures.
- CLI retention requires a host storage adapter; unchanged connectors only receive structured records.
- Builder collection tests use the full form preview. Apply and preview changes only the unsaved Builder
  document. Scalar quick preview remains available.
- Production Reform web/mobile/backend persistence is excluded; see the dedicated follow-up.

## Work and evidence ledger — 23 October 2026

| Delivery                                             | Status                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Core evaluateScope and regression tests              | Implemented; automated checks pass                                             |
| Shared editor/submission coordination and controller | Implemented; automated checks pass                                             |
| React and actual worker integration                  | Implemented; main-thread/actual-worker checks pass                             |
| Native integration and focused Android acceptance    | Implemented; adapter and Android bundle pass; actual device acceptance pending |
| CLI preview and host persistence adapter             | Implemented; full tests and browser interactions pass                          |
| Builder controls and full-preview shortcut           | Implemented; full suite, types, lint and localization pass                     |
| Four-locale documentation and package checks         | Source gates pass; rendered docs validation remains CI-owned                   |

Use independent dependency trees, sequential heavy checks and existing development branches.
Preserve unrelated work, consumer dependency edits and accepted evidence. Do not run a local production
docs build. Merges, version changes, publication, deployment and issue closure remain maintainer-owned.
Actual Android/Hermes evidence is distinct from adapter tests; iOS acceptance is deferred.

See [the complete verification and acceptance mapping](PLAN_3_VERIFICATION.md) for exact results,
performance/allocation limits, packed-candidate hashes, release ordering and remaining device work.
Android Expo Go is available to the maintainer; the independent harness and three walkthroughs are
ready. Do not mark Plan 3 accepted or close #99/#104/#73 before the remaining acceptance is reviewed.
