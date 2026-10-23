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

## Feasibility inspection — 23 October 2026

This is a source and compatibility assessment, not completed Reform adoption or a verified SDK
migration. No dependency installation, app build, device acceptance or persistence change was
performed for this inspection. Existing work and branches were preserved, including mobile's
`staging` checkout, unrelated frontend/backend edits and shared-client history.

### Package adoption and SDK compatibility

The current Native binding declares React `^18.0.0 || ^19.0.0`, React Native `>=0.72.0`,
safe-area-context `>=4.0.0` and react-native-svg `>=13.0.0`. Reform Mobile currently uses SDK 55,
React 19.2.0 and React Native 0.83.10, which satisfy those declarations. The binding adds no native
module or Expo config plugin of its own. Updating form0 therefore does not itself establish an SDK
58 requirement. Actual SDK 55/Hermes compatibility with the candidate remains to be tested.

The web binding supports React/React DOM 18 or 19; Reform web's React 19.2 range fits. A form0 upgrade
does not require upgrading TanStack or taking the mobile SDK's React 19.3 version on web. Node build
compatibility must also be checked: form0 packages require Node 22+, while the mobile manifest still
allows Node 20.

| Repository           | Current direct form0 dependencies | Adoption boundary                                              |
| -------------------- | --------------------------------- | -------------------------------------------------------------- |
| Reform web           | core `^0.7.0`, React `^0.4.0`     | Coordinated new core/binding release and record flows          |
| Reform Mobile        | core `^0.3.0`, Native `^0.2.1`    | Larger form0 upgrade plus draft/outbox integration             |
| Reform backend       | core `^0.3.0`                     | Schema/value validation compatibility and persistence contract |
| Reform shared client | core `^0.3.0`                     | Shared serialization, snapshots and companion transport        |

Direct and transitive core versions need a coordinated upgrade. The Plan 3 packed candidates still
carry their existing version labels and must not be confused with published capability guarantees.

### Concrete integration findings

- Mobile `record-editor-screen.tsx` catches rejected saves and returns normally. A parent callback
  returning `false` after the user declines a save also becomes a successful resolution. Under the
  new binding's callback acknowledgement contract, both paths could acknowledge an unpersisted
  attempt. Propagate a non-successful outcome through the agreed renderer/controller contract.
  Example: cancelling the app's incomplete-draft confirmation must leave the editor unsaved.
- Mobile `draft-readiness.ts` constructs a context-free scalar engine for the root and each row,
  with separate required/empty/visibility logic. It needs shared record-tree evaluation/validation,
  preserving the distinction between an allowed local draft and a submission eligible for sync.
  Example: task costs `[10,20]` must give total `30` in both the editor and readiness calculation.
- Mobile `FormRendererSnapshot` normalization retains values, repeatables and timestamps only.
  Draft persistence, outbox/sync and server round trips do not yet carry the freshness companion.
- Web's authenticated create/edit handlers await the record API; `runWithOperationToast` rethrows
  failures. Public-share submission uses `mutateAsync`. These established paths already propagate
  actual API failures. Guard paths that return early, callbacks after successful writes, and media
  upload/payload transformations still need conformance checks against the selected snapshot.
- Web record callbacks currently consume the record without persisting the freshness metadata.
  Public-share autosave normalization also drops fields outside its snapshot contract. Before
  enabling retention, persist and restore the companion with its record revision. Example: retained
  totals `[110,220]` must reopen as root `330` with pending freshness, not silently lose that status.
- The backend's core 0.3 schema validator accepted three focused probe schemas: a scalar baseline,
  `REPEATABLESUM($tasks, 'cost')`, and authored confirmation. The Plan 3 candidate accepted the same
  schemas. This rules out assuming automatic schema rejection in these examples; it does not prove
  equivalent record-tree evaluation, strict condition enforcement or submission validation.

### SDK 58 migration feasibility

The starter/harness migration is 57 to 58. Production Reform Mobile is 55 to 58 and needs incremental
55 → 56 → 57 → 58 checks in one independent dependency tree. It already uses a development client;
an installed development build's SDK is separate from the store Expo Go app. A native rebuild is
required when its SDK/native dependencies change.

Concrete production-app migration work includes:

- Replace external `@react-navigation/*` imports used by the tab layout, privacy screen and custom
  pill bar with the supported Router APIs, following both migration guides. The custom bar currently
  calls `navigation.emit()` and `navigation.navigate()`; review its events, navigation and types
  against SDK 58 rather than treating the change as import substitutions alone.
- Align React Native, React, Reanimated/Worklets, Screens, safe areas, SVG and Expo modules together.
  Validate TypeScript and native peer compatibility before declaring the version set accepted.
- Verify SQLite/draft migrations and offline restart, file/media upload/download, notifications and
  background sync, location/camera permissions, auth/deep links and release-build behavior. Several
  media/sync paths use `expo-file-system/legacy`; inspect their compatibility without assuming all
  legacy calls must be rewritten. Check the existing explicit notification handler as well.
- Preserve app identity, build/environment selection, local records and pending media. Inspect
  environment key names/configuration without reading protected environment files. Check Windows
  backing-disk space and temporary dependency/cache growth before installing; keep heavy checks
  sequential and preserve the current acceptance evidence.

No architectural blocker was found in this inspection. Production migration is a moderate task,
with navigation and native/device checks beyond the starter upgrade. Plan SDK modernization and
form0 host adoption together, with independently reviewable changes and a coordinated rollout;
neither requires delaying the web upgrade for an unrelated mobile runtime change.

Primary references:

- [Expo SDK upgrade guidance](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/).
- [Library compatibility](https://docs.expo.dev/workflow/using-libraries/).
- [Router 55 → 56](https://docs.expo.dev/router/migrate/sdk-55-to-56/).
- [Router 57 → 58](https://docs.expo.dev/router/migrate/sdk-57-to-58/).
- [SDK 58 release notes](https://expo.dev/changelog/sdk-58).
