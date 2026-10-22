# Reform freshness adoption follow-up

Production integration is separate from Plan 3's form0 packages and Builder delivery. This document
records required work; it does not claim production record storage has adopted freshness metadata.

## Existing flows inspected on 22 October 2026

- Authenticated web create/edit flows submit directly to record APIs; they do not provide durable
  record draft storage. Selected calculations can remain unsaved in the open editor after failure.
- Public-share forms have browser autosave/resume flows. Their snapshot normalizers currently retain
  values, repeatables and timestamps, so a new companion must be preserved explicitly.
- Mobile saves snapshots and structured records into local drafts before outbox synchronization.
  A successful durable local save is distinct from successful remote synchronization.
- Web/backend/mobile still require coordinated form0 dependency compatibility updates. Builder's
  dependency update also affects the shared web renderer and needs existing record-flow smoke tests.

## Required production work

1. Choose host-owned storage for the versioned freshness companion outside saved form record values.
   Save record revision and companion together; restore them together. Add any required migrations
   explicitly, without modifying existing record/media/ID/timestamp shapes.
2. Preserve the companion through web record requests/responses, public-share draft normalization,
   media uploads, mobile draft storage, outbox entries, synchronization and server round trips.
3. Supply initialFreshness and explicit retention policy to renderers. Keep pending freshness separate
   from validity and sync status. A previous current label never replaces fresh evaluation.
4. Ensure callbacks finish only after the intended durable write. Propagate cancellations and failures
   instead of swallowing them and returning success. Prepare-only integrations acknowledge the exact
   preparation only after persistence. Older acknowledgements cannot clear newer pending metadata.
5. Review backend schema/record validation against new core contracts, including strict condition scope,
   hidden ancestors, required read-only inputs, aggregate fields and allowed root drafts.
6. Define pending-draft synchronization eligibility and conflict/revision handling as host policies.
   Do not treat an offline draft acknowledgement as remote acceptance or replay a stored proposal.
7. Test save failure/retry, reopening retained values, schema changes, competing saves, attachments,
   public-share resume, offline restart, outbox retry and atomic current-status replacement.

## Rollout

Coordinate core and consumer releases before production application upgrades. Verify web and actual
Android/Hermes behavior with independent package candidates. Keep iOS acceptance explicitly deferred
unless separately performed. Do not infer production adoption from package or Builder tests.
Track Native/mobile dependency exceptions expiring 7 November 2026 as separate remediation work.
