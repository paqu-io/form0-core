# Shared record evaluation contract — Plan 2

Unreleased implementation after core 0.6.0. Renderer adoption is Plan 3. Existing `createFormEngine`
semantics and saved record shape are preserved. Reference: VALIDATION_FRESHNESS_AGGREGATION_ALIGNMENT.md.

## Interface

```js
const evaluator = createRecordEvaluator({
  schema,
  helpers,
  security,
  warningSystem,
  diagnostics: { console: false },
  onDiagnostics,
});
const evaluation = await evaluator.evaluate(snapshot, {
  mode: 'accepted', // or 'refresh'
  signal,
  budgetMs: 8,
  yieldToHost,
});
const result = await evaluator.prepareSubmission(snapshot, {
  intent: 'submit', // or 'draft'
  mode: 'automatic', // host can require confirm; cannot weaken schema confirm
  allowRetain: false,
  managedEvents: false,
  signal,
  budgetMs: 8,
  yieldToHost,
});
```

Configuration is captured by the factory; recreate it when schema/helpers/security change. Do not
mutate externally captured helper state while a proposal is being reviewed. Re-prepare after external
business inputs change. `onDiagnostics` on `evaluate` is observational and not awaited. Preparation
returns its scoped diagnostics explicitly. Expressions/validation handlers remain synchronous.

Runtime snapshot: root `{ values, repeatable }`. Values use data_names and live choice shapes.
Repeatable object keys use the schema's preferred key (key, then data_name). Rows retain their existing
id/record_id, values, nested repeatable, attachments and unknown metadata. IDs may be zero; absent IDs
use explicit positional paths. Duplicate identities within a collection fail. A positional review is
valid only for the captured row ordering. Immutable Blob/File handles are retained without byte copies.

Successful evaluation returns `{ status: 'evaluated', snapshot, changes, diagnostics, issues: [] }`.
It refreshes conditions and intrinsic errors in each actual record scope. Normal sections retain their
bottom-up visibility behavior; repeatable definitions are collection boundaries whose own conditions
are evaluated in the containing record, not against invented child defaults. Child state maps remain
local; effective ancestor participation is computed separately.

Preparation status is `ready`, `blocked`, `requires_decision`, `failed` or `cancelled`. Check `eligible`,
not diagnostics, before delivering a submission. Blocked results include the selected snapshot for
correction and `validationSummary`. Operational record evaluation failures return no snapshot.
Validation execution failures are in `issues`, never invented field errors, and prevent eligibility.

## Selection and review

`automatic` refreshes all child calculations. `confirm` returns a review only if child calculated
values change. Root-only changes do not require child consent. A required review returns snapshot:null,
proposal (inspection only), changes, diagnostics, preliminary built-in validationSummary and choices.
Custom validation runs after selection; a preliminary summary is not final submission eligibility.

Resume with the same evaluator/current inputs and all the same preparation policy options:

```js
const reviewed = await evaluator.prepareSubmission(snapshot, {
  mode: 'confirm',
  allowRetain: true,
});
const selected = await evaluator.prepareSubmission(snapshot, {
  mode: 'confirm',
  allowRetain: true,
  decision: { reviewId: reviewed.reviewId, action: 'retain' },
});
```

Actions: refresh, retain, cancel. Retention requires host permission on both calls. The evaluator holds
one defensive captured proposal; returned proposal/change objects cannot modify it. New preparation,
changed input or options, another evaluator, and reused decisions invalidate the review. Accepting a
review does not recompute its displayed values. Hosts still enforce their editor/session generations.

Retained child calculations remain fixed; current root calculations/aggregates, conditions, intrinsic
and optional custom validation use those selected values. A retained helper can preserve a different
condition outcome from the fresh proposal: pending freshness must remain visible to the host. Drafts
retain accepted child calculations without confirmation, allow ordinary validation failures and return
pending freshness when the complete refresh differs. Execution/configuration failures still block.

## Validation and freshness

`validateSubmission({ schema, snapshot, validationIssues? })` validates an already evaluated tree;
it neither evaluates nor establishes freshness. `isFieldValueEmpty(field, value)` is also exported.
Summaries contain hasErrors, requiredFieldErrors, generalErrors, scopeIssues and orderedIssues. Field
findings have fieldName, fieldKey, kind, message and the full instancePath. Custom findings have kind
custom and instancePath, without an invented field association. Root precedes descendant records;
field/handler order is deterministic. `state.errors` remains intrinsic only.

Hidden fields/ancestors do not participate; visible required read-only empty fields do. Root custom
INVALID remains root-level and cannot be automatically attributed to a hidden field. Participating
row handlers execute validate-repeatable with current selected ancestors; event.isValid is built-in
validity of the executing scope, while combined tree validity is in validationSummary. Schema handler registration is evaluated per selected scope with shared source analysis and compilation;
transient editor listener state is not reconstructed. Managed
validation prohibits writes/UI operations; legacy opt-out leaves custom validation disabled.

Freshness companion:

```json
{
  "version": 1,
  "status": "pending",
  "schemaRevision": "form0-...",
  "affected": [
    {
      "instancePath": [{ "repeatableKey": "tasks", "instanceId": 0, "index": 0, "identity": "id" }],
      "fields": [{ "fieldName": "total", "fieldKey": "total_key" }]
    }
  ]
}
```

Actual affected paths identify child records. The schema revision is the existing deterministic
schema revision. Each affected entry represents one row; its fields retain both data_name and schema
key identities, in deterministic field order. Complete instance ancestry is stored once per row,
including ID zero and positional identities. Current freshness has an empty affected list. This is
the first published version-1 shape; the earlier flat shape was an unpublished candidate.
Companion metadata contains no old values or executable proposals. Hosts persist it
alongside the record and restore it for their pending-state UI. Every preparation recomputes from
current inputs; a previously persisted current/pending label never replaces evaluation. Clear pending
storage only after persisting a matching current result. No persistence location is prescribed.

## Collections and scheduling

Both builtins require direct calls, a $RepeatableSection data_name and literal owned target data_name.
Dynamic names, aliases and collection calls inside EVAL are diagnosed; unrelated EVAL remains
supported, with dependency-aware scoped reads in the tree evaluator. Root can collect a named deep
section; known ancestor instances anchor nested reads. Unrelated nested branches remain forbidden.
An explicit ancestor-owned collection can include its sibling rows. Scalar reads/writes gain no rights.

Accepted row order is preserved regardless of visibility. Array-valued results remain grouped. Missing
scalar slots are null, empty single choice null, empty multiple/link selection []. Other returns the
entered label text; predefined choices return schema codes. Ambiguous single selections, unknown
choice codes or malformed structures cause a calculation diagnostic and null result. Linked projection
contains only record_id, never fetched contents/defaults/titles. Sum only Numeric/Calculated finite
numbers, skip null/missing, return zero for no rows, reject strings and overflow. These failures follow
existing calculation diagnostics semantics, not a new implicit submission blocker.

Supported value targets: Text, Numeric, SingleChoice, MultiChoice, Boolean, Date, Time, Calculated,
FormLink. Excluded: Section/Repeatable/BuildingPlan containers, Label, Signature/Photo/Video media,
Status and Title. Titles and media serialization remain supported outside collection projection.

Schema ownership/calculation analysis is prepared once. Static instance dependencies are ordered
before execution; dynamic EVAL reads discover actual dependencies. Local cycles keep legacy null plus
diagnostics behavior. Record/collection feedback cycles fail without a partial tree. No per-row engine
is constructed or retained. Scoped compiled expressions are cached without caching values; keys use
canonical parameter ordering. Queries/projections are cached within one evaluation, not across input
revisions. The async coordinator yields between tasks (default scheduling target 8ms); indivisible
expressions, graph setup and GC may exceed that target. Cancellation is checked across scheduling.

## Host lifecycle

Preparation never dispatches save-record/save-repeatable or closed-row load/edit/unload. Hosts retain
the existing validate -> save once -> conditional re-evaluate/revalidate -> serialize contract. A save
hook that changes reviewed inputs invalidates that review; resolve a new proposal without rerunning
the hook. Core does not apply proposals to editor/list state, persist, or generate timestamps/IDs.
Programmatic pending-child protection, dialog presentation, visible list commit timing, persistence
acknowledgements and transport adoption remain Plan 3 responsibilities.

## Scoped editor evaluation

The evaluator also exposes `evaluateScope(snapshot, { instancePath, signal, budgetMs, yieldToHost })`.
Omit `instancePath` or supply `[]` for the root; identified child segments include complete ancestry,
repeatable keys, ID (including zero), index and identity kind. An ID resolves after reordering;
positional segments stay tied to the captured order. Invalid targets fail explicitly.

The method evaluates only that record's calculations, field state and built-in submission findings.
It reads supplied current ancestors and accepted other rows through the existing scope/collection
resolver. It preserves every other record's calculations, runs no lifecycle/custom validation or
persistence, generates no record IDs/timestamps and never mutates its caller. Its reply is
`{ status, instancePath, state, validationSummary, changes, diagnostics, issues }`, without another
complete record tree. Execution failure or cancellation supplies no partial state.

For a project whose accepted task costs are `[10,20]`, editing its surcharge to `5` shows subtotal
`35`. Accepting the project lets its parent aggregate update; cancelling retains the accepted value.
Whole-record refresh/review remains the responsibility of `prepareSubmission()`. Live engines retain
event ownership. These contracts do not alter intrinsic scalar `engine.eval()` behavior.

Consumer preparation identities belong to one session and attempt. Acknowledgement means the exact
selected record and companion were successfully persisted; it does not perform persistence. Selected
values remain unsaved work after validation or persistence failure. Root drafts retain accepted
children. Complete reports/proposals stay private to the coordinator/worker, with bounded change pages.
