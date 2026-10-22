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

## Work and evidence ledger

| Delivery                                             | Status      |
| ---------------------------------------------------- | ----------- |
| Core evaluateScope and regression tests              | In progress |
| Shared editor/submission coordination and controller | Pending     |
| React and actual worker integration                  | Pending     |
| Native integration and focused Android acceptance    | Pending     |
| CLI preview and host persistence adapter             | Pending     |
| Builder controls and full-preview shortcut           | Pending     |
| Four-locale documentation and package checks         | Pending     |

Use independent dependency trees, sequential heavy checks and existing development branches.
Preserve unrelated work, consumer dependency edits and accepted evidence. Do not run a local production
docs build. Merges, version changes, publication, deployment and issue closure remain maintainer-owned.
Actual Android/Hermes evidence is distinct from adapter tests; iOS acceptance is deferred.
