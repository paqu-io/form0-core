# Portable events and custom validation

This is the form0 contract for core #98 and #102. It is inspired by Fulcrum, but does not promise
identical behavior. Core's managed execution is implemented in this change. The renderer controller,
expanded lifecycle and save preparation described below are the binding adoption contract; they
require a subsequent binding release after the maintainer publishes the implementing core release.
This document is maintained in the repository and excluded from npm artifacts.

## Core managed execution

`engine.triggerDetailed(eventType, fieldKey?, metadata?)` is synchronous and returns three defensive
arrays:

```js
const result = engine.triggerDetailed('validate-record', undefined, {
  isDraft: false,
  isValid: true,
});
// { operations: [], validationIssues: [{ message, instancePath }], issues: [] }
```

`issues` contain `{ code, message, eventType, instancePath }` (`eventType` is null for a malformed
event-type argument). A result with execution issues has no
applicable operations. Validation findings alone are a completed validation, not an execution
failure. Results never write values, run an evaluation, persist a record or close an editor. The
host must inspect execution issues, apply accepted operations and own validation/save policy.

`engine.trigger()` retains its operation-array compatibility path, including partial synchronous
operations from asynchronous or failing handlers. Managed rejection rules apply to
`triggerDetailed()`. Use detailed execution for custom validation; the compatibility path does not
provide a custom validation summary.

Handlers for the requested `data_name` run in registration order, followed by wildcard handlers.
Record lifecycle dispatch has no field identifier. Repeatable lifecycle dispatch uses the repeatable
definition's `data_name`, and field dispatch uses the field's `data_name`. An owning repeatable
definition may be the target of a membership `change` in its parent scope, but its collection values
are not readable. Synchronous `ON`/`OFF` inside a permitted handler update its engine's listener
registry after the complete dispatch succeeds. They never become host operations. Nested authored
callbacks retain source for Hermes; they do not retain the outer handler's local variables.

`change-status` may identify the enabled configured status field by its `data_name`, even when that
field is outside `form.elements`. Other fields are not valid status targets. Status values supplied
by the host can be read in managed execution. Programmatic writes still emit no automatic event.

The managed dispatcher owns `event.type`, `fieldKey`, `timestamp`, `instancePath`, `scopeId` and `mode`.
Application metadata cannot replace them. The same metadata snapshot is copied independently for
each handler. Plain objects, arrays, dates, scalar values and runtime-native File/Blob media handles are portable
event data; functions,
symbols and other object types are rejected instead of silently serialized. Media handles retain
their immutable binary content and standard file metadata in defensive copies; arbitrary custom
properties on the handles are outside their native serialization contract. Async schema handlers
remain unsupported. This media compatibility correction requires the core patch following 0.5.0.

## Engine-bound ownership

Root engines default to `eventScope: { instancePath: [] }`. A headless row engine must explicitly
supply its complete construction path. This context is fixed for that engine lifetime; per-dispatch
metadata cannot retarget it. Bindings supply this context from their active editor registry.

```js
const rowEngine = createFormEngine({
  schema,
  initialValues: { amount: 2, main_limit: 4 },
  eventScope: {
    scopeId: 'host-row-session-1', // optional for headless engines
    instancePath: [
      { repeatableKey: 'rows_key', instanceId: 'existing-row-id', index: 0, identity: 'id' },
    ],
  },
});
const result = rowEngine.triggerDetailed('save-repeatable', 'rows');
```

Path keys use schema `key`, falling back to `data_name`. Listener identifiers use `data_name`.
Existing IDs may be nonempty strings or finite numbers (including zero). For a missing ID, use
`instanceId: null`, `identity: 'position'` and the observed zero-based `index`.
Core validates complete schema ancestry, identity shape and event ownership; it cannot verify that
a headless host's row still exists. The host owns active-row/generation validation and positional
scope guards. Reporting and dispatch never create or change record IDs.

| Executing scope | Reads                                                          | `SETVALUE()` writes     |
| --------------- | -------------------------------------------------------------- | ----------------------- |
| Root            | Root fields                                                    | Root fields             |
| Row             | Current row, ancestor row and main fields supplied by the host | Current row fields only |

Sibling, descendant and unrelated branches are inaccessible. Repeatable collections are outside
this contract. A row cannot dispatch a main-record lifecycle event or a field event belonging to a
different scope. Reading a main field never grants permission to write it. This is an ownership
contract, not a security sandbox against intentionally privileged host helpers.

## Synchronous custom validation and notifications

`createFormEngine({ schema, mode: 'readonly', initialValues })` preserves supplied calculations and
does not apply missing schema defaults. `eval()` still computes conditions and intrinsic field
validation. `mode` defaults to `edit`, retaining normal intrinsic evaluation. `getMode()` reads it;
the host changes it with `setMode('edit' | 'readonly')`, then evaluates. A mode change never reopens
the record, replays load, restores database values or persists work. Missing defaults become eligible
on entering editing; existing supplied values are preserved.

Each handler receives the executing scope's effective `event.mode`, captured at dispatch. A viewed
child receives `readonly` even if its parent is editing. New/existing classification, draft intent
and individual field read-only flags are independent. Metadata or handler assignments cannot grant
write permissions. Headless record-tree custom validation receives `readonly` because it has no
editable scope; this does not reopen closed records. Explicit editor validation retains the editor's
mode but is still findings-only.

View-time load can read accepted values, show ALERT and register/remove engine-lifetime listeners.
Record writes such as SETVALUE fail the entire collected batch, including accompanying alerts and
listener changes, before delegation. `triggerDetailed()` returns execution issues; `trigger()` returns
no operations and uses structured warnings. The view remains readable. Guard existing load setters
with `event.mode` for direct editing, or move initialization to new/edit handlers for View → Edit.

Operation effects are declared in the authoritative builtin catalog. Unknown descriptors and effects
are rejected. Validation and close phases retain stricter restrictions. Editing does not grant an
external persistence capability. Trusted host helper side effects are outside descriptor rollback;
this is not an arbitrary-JavaScript sandbox.

```js
ON('validate-record', function (event) {
  if ($amount < 4) INVALID('Amount must be at least four.');
});
ON('validate-repeatable', 'rows', function (event) {
  if ($row_amount <= 0) INVALID('Enter a positive row amount.');
});
```

`INVALID(message)` requires a nonempty string and is available only in managed `validate-record`
and `validate-repeatable` execution. It creates a scope-level finding, without inventing a field
association. It does not enter intrinsic `state.errors`, calculation diagnostics, values, row
payloads or record/media metadata. Every validation dispatch returns fresh findings. The renderer
adoption replaces stored findings for that scope and clears them on editable-data changes or scope
retirement.

Validation handlers are findings-only. `SETVALUE` and `ALERT` are rejected there. Cancel/unload
handlers are read-only notifications: value operations, `INVALID` and renderer alerts are rejected.
All schema handlers are synchronous. A returned promise/thenable is an execution issue, the managed
operation batch is discarded, rejection is consumed, and late operations are discarded with the
existing event warning route. Handler, initialization, routing and portable-data failures produce
structured issues. Warning failures cannot turn discarded late work into accepted work.

Registered record events are `load-record`, `new-record`, `edit-record`, `validate-record`,
`save-record`, `cancel-record`, `unload-record` and `change-status`. Repeatable equivalents replace
`record` with `repeatable` (without a repeatable status event). Field events are `change`, `focus`,
`blur` and `click`. Registration never makes an event automatic.

## Binding adoption contract

This section specifies the subsequent React main-thread, React worker and React Native/Hermes
adoption. It must not be presented as already available in the currently released bindings.

`engineOptions.events.lifecycle` defaults to `true` in the current bindings. It requires explicit
`events.recordKind: 'new' | 'existing'`. Do not infer classification from populated values.
`events.fieldInteractions` defaults to `['focus', 'blur', 'click']`. Set it to `[]` to disable
automatic interactions; an explicit subset is supported. Built-in text/numeric inputs emit focus
and blur; choices use change. Automatic click is reserved for supported activation fields. There is
currently no HyperlinkField and no built-in control automatically emits click. Explicit host controller
dispatch remains available. Lifecycle configuration is fixed for an editor session; remount to change it.
Callback replacements stay live without engine reconstruction or initialization replay.

`engineOptions.onEventController(controller | null)` receives a generation-bound controller after
initialization. Both methods return promises in every execution mode:

- `dispatch({ type, fieldKey?, instancePath?, scopeId?, metadata? })` finishes accepted operation
  processing and returns execution status, validation findings and issues.
- `prepareSave({ intent: 'submit' | 'draft', instancePath?, scopeId? })` returns eligibility, the
  final payload, validation summary and issues. It never persists or closes an editor.

Paths retain existing row IDs. Positional targeting requires the observed active `scopeId`; obsolete
generations, closed editors and deleted rows are rejected. Managed requests are serialized and
duplicate save attempts are prevented. Workers transport cloneable data only; callbacks and operation
presentation remain on the host, and each reply is consumed once.

With explicit `lifecycle: false`, existing automatic root `load-record`, `edit-record` and root-field `change` behavior
continues. With managed lifecycle, evaluate effective values, dispatch load, then the applicable new/edit event
when entering editing. Readonly opening dispatches load only. Row editors use their own actual
classification and `*-repeatable` sequence, never main-record lifecycle events.

User edits dispatch contextual `change` after updates settle. Accepted row addition/edit/removal
emits `change` on the owning repeatable definition with the action and affected path. Defaults,
`SETVALUE` and calculated changes do not create automatic change events. Status integration emits
`change-status` only for user changes of the configured status field; no `SETSTATUS` is introduced.

Confirmed cancellation dispatches cancel, then unload. Supported successful close paths dispatch
unload before releasing the engine. Rerenders, resets, Strict Mode cleanup and forced disposal do not
impersonate closing. A host directly unmounting an editor must explicitly unload first; forced
disposal simply retires its scope.

## One preparation path and host persistence

Built-in actions and application-owned buttons use the same scope preparation:

1. Wait for accepted pending updates and read current values.
2. Run built-in validation and synchronous custom validation.
3. If policy permits saving, run `save-record` or `save-repeatable` once and await accepted operations.
4. If values changed, validate the resulting snapshot again without rerunning the save hook.
5. Build the payload from that same final snapshot, using existing timestamp and transformer rules.

`isDraft` is the current attempted action, and `isValid` is built-in validity for its supplied
snapshot. Combined validity belongs in the validation summary. Root submit and row acceptance
respect validation failures. Root drafts remain allowed with `validationSummary.hasErrors: true`;
row draft acceptance is not added. Execution failure prevents payload delivery even for drafts.
Calculation diagnostics alone never add a save blocker.

Bindings own validation findings and exactly-once renderer alerts. Existing `onOperations` delegation,
ordering, batching and selective `applyDefault` handling are preserved. Delegated promises and default
work finish before dispatch or serialization completes; fallback handlers are bound to their dispatch
lifetime. The application owns asynchronous persistence, success notifications and editor closing.
There are no `saved-record` or `saved-repeatable` schema events. Failed preparation leaves the editor
and its current/prepared values available for correction and retry.

Preparation operates on open editors only, without closed-row evaluation or child-to-parent
aggregation. Closed-row submission freshness remains React #73. Broader validation policy remains
core #99/#104; asynchronous validation #96, setter normalization #101, conditional scope #103 and
styling remain separate.

## Delivery and acceptance

Deliver and publish core first, then adopt the actual released minimum in bindings and CLI tooling.
CLI tooling recognizes the new builtin. The built-in browser preview defaults lifecycle and
supported interactions on, with scoped dispatch and save preparation; standalone CLI commands keep their existing
reporting/outcome contract. Preview connector persistence remains host-owned. Use independent dependency
trees, real engine/worker conformance tests, package/packed-consumer checks and explicit CodeQL
finding review. Fresh browser main-thread, actual browser-worker and Android/Hermes manual acceptance
is required for binding adoption; earlier diagnostic acceptance does not count as event acceptance.
iOS remains deferred. Preserve `development → main`; version bumps, publication, merges, deployment
and issue/card closure remain maintainer steps. Core alone does not make #98/#102 closure-eligible.
