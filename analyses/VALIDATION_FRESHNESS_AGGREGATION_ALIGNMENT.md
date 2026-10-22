# Validation, repeatable freshness and aggregation: alignment

Updated: 22 October 2026.

Status: Plan 1 is released in core 0.6.0 and #103 is closed. Plan 2 is implemented as an unpublished
core candidate with automated evidence. Plan 3 remains separate consumer-adoption planning; renderer,
Builder and persistence integration changes are not included in Plan 2. See
[the core contract](RECORD_EVALUATION_CONTRACT.md) and
[verification evidence](RECORD_EVALUATION_VERIFICATION.md).

### Approved delivery sequence

| Plan                       | Delivery                                                                                                                                   | Status                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 1 — Condition scope        | Strict schema rejection and defensive runtime scope checks for #103; localized scope documentation and packed-consumer verification.       | Released in core 0.6.0; #103 closed.                  |
| 2 — Shared core evaluation | #99/#104, nested freshness, REPEATABLEVALUES, REPEATABLESUM and the headless record-tree contract.                                         | Implemented and verified; unpublished core candidate. |
| 3 — Consumer adoption      | React main-thread/worker, Native, CLI preview, automatic/confirmation modes, durable freshness metadata and agreed authoring integrations. | Plan separately against this alignment.               |

All work stays on existing development branches. Preserve repeatable-title rendering already present
in React and Native, including published revisions; no new title feature is part of these plans.

## 1. Objective and scope

The objective is a clean, modern, consistent and developer-friendly implementation across headless
core, React main-thread and actual worker execution, React Native and CLI browser preview.

The maintainer's concern about refactor risk is **not** a request to narrow the feature scope or
preserve every current internal arrangement. Refactor where necessary and reasonable for the agreed
design. Preserve working behavioral contracts; choose internal seams from evidence. Earlier advice
to narrow the architecture in response to that concern was the assistant's interpretation and is
superseded by this clarification.

Design these concerns together, with separately reviewable delivery surfaces:

| Concern                                                                                                                  | Direction                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Core [#99](https://github.com/paqu-io/form0-core/issues/99) and [#104](https://github.com/paqu-io/form0-core/issues/104) | Shared submission-validation rules and field participation.                                               |
| React [#73](https://github.com/paqu-io/form0-react/issues/73) and equivalent Native behavior                             | Current closed-child state before validation and serialization.                                           |
| `REPEATABLEVALUES` and `REPEATABLESUM`                                                                                   | Include aggregation in the next delivery; this expands #73's original non-aggregation scope.              |
| Core [#103](https://github.com/paqu-io/form0-core/issues/103)                                                            | Separately reviewable condition-scope correctness, required before complete nested-validity claims.       |
| Core [#101](https://github.com/paqu-io/form0-core/issues/101)                                                            | Keep setters and input normalization separate unless a concrete dependency emerges.                       |
| Reform Builder                                                                                                           | Identify the authoring integration for portable form settings; implementation scope remains to be agreed. |

Core should own shared domain evaluation and validation rules. Hosts own editor interaction,
settling pending updates, presenting decisions and persistence. This does not settle whether a
particular current engine, adapter or traversal is reused, extracted or replaced.

## 2. Agreed directions

- Support arbitrarily shaped nested RepeatableSections and dependencies spanning multiple levels.
  Values may flow upward and downward when the actual dependency graph is acyclic. Detect real
  feedback cycles explicitly; never rely on repeated tree traversal to conceal them.
- Refresh proposed child calculations as one set: all children or none. No individual calculation
  or row selection in the confirmation.
- Support automatic recalculation on submit and a mode that asks the user before applying changed
  child values. **Automatic is the agreed default when the setting is omitted.**
- The host must explicitly permit submitting retained, potentially stale child values. Selecting a
  confirmation mode does not itself grant that permission.
- Pending freshness must survive persistence and reopening. Recompute the next proposal from the
  current inputs; do not persist a proposal as an instruction to replay old results.
- Include calculation-only `REPEATABLEVALUES($repeatable_section_1, 'fieldA')` and
  `REPEATABLESUM($repeatable_section_1, 'fieldA')`. Both identifiers are `data_name` references.
  `SETVALUE` remains event-only. Events may read an accessible aggregate CalculatedField result.
- Choice collections return selected schema values rather than internal choice objects. A custom
  Other selection such as Teal returns the entered text `'Teal'`. Preserve MultiChoiceField grouping
  by row. Include FormLinkField selected records/references; the selected projection is grouped record_id objects.
- Exclude StatusField and TitleField from these collection functions for now. Repeatable row titles
  already exist, including nested titles; excluding collection access does not remove that behavior.
- Web and mobile performance is part of the design and acceptance criteria, including complex
  nested records, repeated aggregate dependencies, worker transport and Native/Hermes memory.
- Share submission-validation policy rather than maintaining independent copies in each host.
  Keep intrinsic `state.errors`, submission findings and calculation diagnostics distinct.
- Hidden fields, including fields beneath hidden ancestors, do not block ordinary submission.
  Visible required read-only empty input fields continue to block ordinary submission.
- `LabelField` is display-only. Existing schema constraints keep both LabelField and CalculatedField
  `required: false`; this work does not implicitly expand those constraints.
- Preserve the normal React child-modal and Native child-screen workflows. They already prevent
  normal root UI submission while a child editor is active.
- Preserve structured record nesting, existing field keys, IDs including zero, media metadata and
  timestamp conventions. New authored aggregate fields contribute ordinary field values.

The latest alignment accepts the maintainer's root collected-array -> local boolean helper ->
visibility pattern for the inspection/payment example below. A minimum-score field is optional,
not required for that rule. #103 separately enforces scope for accidental invalid references.

## 3. Working concepts

- **Accepted record tree:** root inputs and accepted child records, excluding unaccepted editor work.
- **Evaluation proposal:** calculated values and field state prepared from a captured input version.
- **Selected snapshot:** the values chosen for this submission after automatic refresh or a decision.
- **Freshness:** whether derived values correspond to the current inputs and evaluation rules.
- **Validation:** applicable intrinsic, required and custom findings for the supplied snapshot.
- **Pending freshness:** a durable indication that a permitted submission retained affected values.

Freshness and validity are separate facts. Declining a refresh must not label a stale result as fully
current. It also must not bypass known ordinary validation failures. The retained-values branch validates that selected snapshot and its calculation-dependent rules, as specified in the Plan 2 contract.

## 4. Current behavior and the missing guarantee

Existing calculation ordering, local and ancestor reads, nested record ownership and editor-time
evaluation already work. A child editor is seeded with its root/ancestor values and row inputs.
Closed children are stored snapshots. React and Native submission adapters copy stored child trees;
they do not establish a final current evaluation of every closed descendant.

| Location       | Input or calculation                | Stored value before root change | Desired fresh value after change |
| -------------- | ----------------------------------- | ------------------------------- | -------------------------------- |
| Root           | `multiplier`                        | `2`                             | `3`                              |
| Project row A  | `rate`                              | `50`                            | `50`                             |
| Project row A  | `adjusted_rate = multiplier * rate` | `100`                           | `150`                            |
| Task T under A | `hours`                             | `3`                             | `3`                              |
| Task T under A | `cost = adjusted_rate * hours`      | `300`                           | `450`                            |

Opening the relevant editors with current ancestor inputs can produce 150 and 450 today. Leaving
them closed does not guarantee those values are refreshed for root submission. Opening and then
cancelling an editor must not determine the eventual submitted values.

Existing recursive helpers handle nested structures but evaluate parents before children. Upward
aggregation requires dependency-aware coordination across instances, not simply greater recursion
depth. Example: child amounts 100 and 200 produce root total 300, which then produces child shares
1/3 and 2/3. That graph is acyclic. Root total summing child totals while each child total depends
on root total is a feedback cycle requiring explicit handling.

Instance ancestry determines ownership. A nested aggregate in project A must not collect matching
section instances under project B. Direct local/ancestor field access remains distinct from an
explicit collection read. Cross-scope writes remain forbidden.

## 5. Portable schema setting, host permission and persistence

Use an optional form-level setting, so a schema authored in Reform Builder can carry the same
behavior to supported runtimes. The maintainer notes that many existing form settings are direct
properties of `form`. The current recommendation is a direct attribute; a submission umbrella is
not justified solely by possible future settings. The selected property name is `repeatable_recalculation`.
This JSON is supported by the unpublished Plan 2 record evaluator; published 0.6.0 and existing renderer submission paths do not implement it:

```json
{
  "form": {
    "repeatable_recalculation": "confirm"
  }
}
```

This is a fragment: a complete form still has its existing name, elements and other attributes.
Proposed values are `automatic` and `confirm`; omission means automatic, as agreed. This is an
additive schema setting with a behavior change for closed-child submissions in adopting runtimes.
Older runtimes do not gain the new behavior merely by receiving the property.

| Effective mode                               | Example                                                      | Expected behavior                                                                       |
| -------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Automatic                                    | Child totals would change from `[110, 220]` to `[120, 240]`. | Prepare refreshed values without a confirmation dialog, then apply ordinary validation. |
| Confirm, host forbids retaining stale values | Same proposed changes.                                       | Offer apply-and-continue or return-to-editing.                                          |
| Confirm, host permits retaining stale values | Same proposed changes.                                       | Also offer keep-existing-and-continue, with durable pending freshness.                  |
| Confirm, no relevant value changes           | Proposed child values equal stored values.                   | No recalculation consent dialog is necessary; validation still applies.                 |

The permission to retain stale values is an application policy. A schema cannot enable it against
the host's restriction. Core naming, precedence and headless review transport are implemented; binding interaction is Plan 3.
Confirmation should identify affected records, fields and old/new values. Review the actual final
proposal; invalidate it if relevant inputs change. Parent aggregates must correspond to selected
child values: old totals `[110, 220]` cannot be accompanied by their proposed sum 360.

Reform's current builder document normalization and serialization preserve form-level properties,
and its root inspector already commits form settings. These are useful integration points, not
proof of a completed backend/publish/runtime round trip for this new setting. No Reform runtime
change is authorized by this discussion document.

Pending freshness is record-instance state, not a schema preference. Preferred storage direction:
optional companion submission metadata persisted by the host and supplied again on reopening.
The version-1 core companion shape is specified in the contract; host storage location and consumer wiring are Plan 3. It needs enough attribution to explain affected instances and
avoid applying an old decision to changed inputs. Returning callback metadata alone is not durable.
Clear durable pending state when the corresponding fresh result has actually been persisted.

## 6. Collection functions and all current field types

Current source registers **18** field types. The spelling is `MultiChoiceField`.
The maintainer has accepted selected choice values, inclusion of selected linked records, and
exclusion of title/status targets. The table records the current direction; numeric, empty/malformed-value and linked-reference rules are selected and implemented in the Plan 2 candidate; see section 13 and the contract.

| Field type          | Proposed `REPEATABLEVALUES` treatment                                                                                          | Proposed `REPEATABLESUM` treatment                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| TextField           | Collect strings, preserving per-row positions.                                                                                 | Reject text; no numeric-string coercion.                     |
| NumericField        | Collect numeric values.                                                                                                        | Sum finite numeric values.                                   |
| SingleChoiceField   | Collect selected schema values, or entered Other text; empty returns null; malformed or ambiguous selections fail calculation. | Exclude; convert explicitly in a row CalculatedField.        |
| MultiChoiceField    | Collect one selected-values array per row, without implicit flattening.                                                        | Reject arrays; authors can derive a numeric row value first. |
| BooleanField        | Collect selected schema values; do not assume the runtime value is a JavaScript boolean.                                       | Exclude; convert explicitly in a row CalculatedField.        |
| DateField           | Collect existing date strings.                                                                                                 | Reject date strings.                                         |
| TimeField           | Collect existing time strings.                                                                                                 | Reject time strings.                                         |
| CalculatedField     | Collect evaluated results, preserving types and row grouping.                                                                  | Sum only finite numeric results.                             |
| Section             | Not a value target.                                                                                                            | Not a value target.                                          |
| RepeatableSection   | Collection source in the first argument, not a field-value target in the second.                                               | Same distinction.                                            |
| BuildingPlanSection | Organizational blueprint; use actual expanded repeatable definitions for collections.                                          | Not a numeric value target.                                  |
| LabelField          | Exclude: display-only, with null placeholders.                                                                                 | Exclude.                                                     |
| SignatureField      | Defer collection projection until content versus storage-reference semantics are explicit.                                     | Exclude.                                                     |
| PhotoField          | Defer media collection projection; preserve existing child media unchanged.                                                    | Exclude.                                                     |
| VideoField          | Defer media collection projection; preserve existing child media unchanged.                                                    | Exclude.                                                     |
| FormLinkField       | Include selected record references per row; grouped record_id objects, matching stored references.                             | Exclude record references.                                   |
| StatusField         | Exclude for now, as agreed.                                                                                                    | Exclude.                                                     |
| TitleField          | Exclude for now, including existing derived repeatable titles.                                                                 | Exclude.                                                     |

FormLinkField currently holds selected record references. Collection access must not implicitly
fetch the linked records' contents. For example, preserving each row's reference array might yield
`[[{ record_id: 'R1' }], [{ record_id: 'R2' }, { record_id: 'R3' }]]`; this grouped reference shape is the selected Plan 2 projection. No linked contents are fetched.

Repeatable titles are already implemented through `RepeatableSection.title_field`, dataset-scoped
validation and resolution, nested structured record `@title` values, and React/Native presentation.
They remain supported independently of their agreed exclusion from collection targets.

Example with numeric fields:

```js
SETRESULT(REPEATABLEVALUES($repeatable_section_1, 'fieldA'));
// [100, 200]

SETRESULT(REPEATABLESUM($repeatable_section_1, 'fieldA'));
// 300
```

### Agreed choice examples

| Row | What the user selected             | Existing canonical state                                    | Preferred selected-value result |
| --- | ---------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| A   | Red, whose schema value is `red`   | `{ choice: [{ value: 'red', label: 'Red' }], other: [] }`   | `'red'`                         |
| B   | Blue, whose schema value is `blue` | `{ choice: [{ value: 'blue', label: 'Blue' }], other: [] }` | `'blue'`                        |
| C   | Other: Teal                        | `{ choice: [], other: [{ label: 'Teal' }] }`                | `'Teal'`                        |

The three-row collection is `['red', 'blue', 'Teal']`. Known selections return their schema values,
not display labels or canonical objects; custom Other returns the entered text. Empty single selections return null; empty multiple selections return []. Malformed or ambiguous single selections fail calculation. Multiple choices preserve predefined selection order followed by Other text.

For MultiChoiceField rows selecting Red/Blue and Green, respectively, the proposed result is
`[['red', 'blue'], ['green']]`. Preserving grouping distinguishes two rows from three selections.
For a schema choice value `'001'`, preserve `'001'` as a string; do not silently turn it into 1.

Existing CHOICEVALUE/CHOICEVALUES implementations currently coerce numeric-looking strings and
ignore the separate other selection in their selected-choice return. Reusing them blindly would
not establish the proposed non-lossy collection semantics. Do not change those existing builtins
implicitly as part of this work.

Open numeric/empty policy proposal: empty collection sums to 0; `[100, null, 200]` is collected with
the null position intact and sums to 300; `[100, 'invalid', 200]` does not silently produce a partial
sum. Unknown fields or disallowed targets must be explicit failures, not empty successful results.
Whether hidden retained rows participate is also to be confirmed; the assistant recommends including
accepted records by default, with any filtering explicit and independent of submission visibility.

### What the null RepeatableSection placeholder means

The root engine's flat map can contain `values.repeatable_section_1 = null` because a section is a
container, not one scalar input. The binding separately stores actual instances, conceptually:

```js
{
  values: { repeatable_section_1: null },
  repeatable: {
    repeatable_section_1: [
      { id: 'A', values: { fieldA: 100 } },
      { id: 'B', values: { fieldA: 200 } },
    ],
  },
}
```

This is a simplified runtime snapshot, not the serialized record format. Real storage keys respect
existing preferred-key rules. The null slot does not mean there are no children. The proposed builtin
resolves `$repeatable_section_1` as a section reference and reads the applicable instances. It must
not interpret the ordinary flat-map null as the collection itself or relocate child data into that slot.

## 7. Condition-scope example with every field and value

Business requirement: a payment approval note is required if any inspection for the work order
scored below 80. Two unrelated repeatable collections exist under the root.

For this example, field keys equal data_names. These are the complete current fields and values:

| Location / record | Type              | data_name          | Schema default    | Accepted value          |
| ----------------- | ----------------- | ------------------ | ----------------- | ----------------------- |
| Root              | TextField         | `job_reference`    | `'WO-100'`        | `'WO-100'`              |
| Root              | RepeatableSection | `inspections`      | No scalar default | Records I1 and I2 below |
| Root              | RepeatableSection | `payments`         | No scalar default | Record P1 below         |
| Inspection I1     | NumericField      | `inspection_score` | `50`              | `95`                    |
| Inspection I2     | NumericField      | `inspection_score` | `50`              | `90`                    |
| Payment P1        | NumericField      | `amount`           | `500`             | `500`                   |
| Payment P1        | TextField         | `approval_note`    | `null`            | `''`                    |

The problematic configuration puts this required condition directly on `approval_note`:

```json
{
  "field_id": "inspection_score",
  "operator": "less_than",
  "value": 80
}
```

Before core 0.6.0, payment-row engine creation merged root/current-row inputs and initialized other schema
fields with defaults. It does not receive one identified inspection record as an ancestor. Condition
evaluation then bypassed ownership checks and could read the unrelated score default 50. Core 0.6.0 rejects this configuration.

| Question                                    | Before core 0.6.0                 | Intended business result                       |
| ------------------------------------------- | --------------------------------- | ---------------------------------------------- |
| Which scores were accepted?                 | I1 = 95; I2 = 90.                 | Both are relevant to the all-inspections rule. |
| What score does the payment condition read? | Default 50 in its own engine map. | An explicitly defined collection result.       |
| Is the payment note required?               | `50 < 80` is true.                | Neither 95 nor 90 is below 80, so no.          |

The ambiguity is not solved by choosing the first or last inspection. A direct scalar reference
does not specify a collection operation. The selected #103 policy rejects this schema through
`validateSchema()` and engine construction before the form opens. The error names `approval_note`,
`required_conditions`, `inspection_score` and both ownership paths. It never compares that unrelated
default or an undefined substitute.

### Maintainer's proposed collection/helper/visibility chain

The maintainer's understanding is correct. Add a root CalculatedField, `inspection_scores`, then
read it in each payment's helper CalculatedField, `needs_approval_note`. The note's visibility
condition reads the local helper. This is the primary agreed authoring direction for this example:

```js
// Root CalculatedField: inspection_scores (unpublished Plan 2 builtin).
SETRESULT(REPEATABLEVALUES($inspections, 'inspection_score'));

// CalculatedField inside payments: needs_approval_note.
SETRESULT($inspection_scores.some((score) => typeof score === 'number' && score < 80));
```

These are two separate field calculations. Missing entries retain their positions as null. The
selected expression explicitly ignores non-numeric entries, avoiding JavaScript's `null < 80` result.
Ordinary source-field validation remains separate from this business-rule helper.

The `approval_note` field can then use this existing visibility-condition shape:

```json
{
  "field_id": "needs_approval_note",
  "operator": "equal_to",
  "value": true
}
```

For this example field keys equal data_names; authors normally use the existing condition reference
rules. A CalculatedField can return a JavaScript boolean; this does not require a BooleanField or
its canonical choice object. Set the condition-controlled field's base `visible` to false in the
existing schema convention. A helper can be hidden while its calculation still participates.

| Accepted inspection scores | Root `inspection_scores` | Payment `needs_approval_note` | Note visible? | Empty note blocks if `required: true`? |
| -------------------------- | ------------------------ | ----------------------------- | ------------- | -------------------------------------- |
| I1 = 95, I2 = 90           | `[95, 90]`               | `false`                       | No            | No                                     |
| I1 = 95, I2 = 60           | `[95, 60]`               | `true`                        | Yes           | Yes                                    |

Visibility alone does not require the user to fill the note. To preserve the original business
requirement, set `approval_note.required` to true; shared validation excludes it while hidden and
requires a value when shown. If the author only wants an optional note to appear, leave required
false. The helper itself remains a non-required CalculatedField.

The read chain is explicit: inspection rows -> root collection -> payment helper -> local visibility
condition. It follows existing permitted root/ancestor/local reads. The new tree evaluator must
settle the aggregate and helper before treating visibility/validation as current. No extra minimum
field or special threshold builtin is necessary. A root minimum was an alternative illustration,
not a requirement.

If the threshold and result are identical for every payment, the boolean helper can also live at
root, avoiding the same array scan in every row. A payment-local helper is useful when it uses
that payment's own inputs, for example a per-payment threshold. This authoring choice does not
change scope permissions.

#103 remains necessary as an independent guard. It detects a condition accidentally referencing
the unrelated `inspection_score` directly instead of the permitted root/local result. Adding
REPEATABLEVALUES makes the intended relationship expressible; it does not automatically enforce
scope in all existing condition lookups. The selected strict policy checks every leaf in arrays,
AND and OR rules for visible, required and read-only conditions, before boolean evaluation. Root,
current-row and ancestor-row reads are permitted; descendant and unrelated-branch reads are rejected.
Normal Section and BuildingPlanSection elements inherit their containing record's ownership.
A RepeatableSection's own conditions govern its collection in the containing record, while its
child fields belong to rows. For example, a root collection cannot condition itself on its own row
field; a collection nested in `payments` can read a payment-local field.

Runtime checks reuse the same resolver and throw a configuration error with an existing structured
warning if a violation is encountered defensively. Configuration failures remain outside intrinsic
`state.errors` and calculation-diagnostics snapshots. Existing invalid schemas must be corrected;
no compatibility switch silently accepts those rules. Plan 1 adds no public entrypoint, schema
attribute, record metadata, aggregation, hidden-ancestor submission policy or closed-row refresh.

## 8. Validation participation and one preparation path

Keep a shared submission policy separate from intrinsic evaluation semantics. A convenient headless
preparation interface can evaluate and validate in one operation; callers should not reproduce host
internals. This does not require duplicated validation or change when UI errors become visible.

Effective visibility includes all containing sections. Example: a hidden Business details section
can currently have `visible.business_details = false`, while its locally enabled required VAT field
has `visible.vat_id = true`. The field is inaccessible in the rendered section. Submission should
exclude it without requiring a destructive clear or rewriting the existing visibility maps.

Preserve type-aware emptiness, including numeric zero and legitimate false selections; visible
required read-only empty input fields block ordinary submit. LabelField has no meaningful input and
can retain its current null output entry. CalculatedField remains `required: false` in today's schema.

The selected tree supplies validation, structured output and companion repeatable metadata together.
Do not validate the refreshed proposal and deliver different retained values with its validation claim.
Keep scope-level INVALID findings distinct from field-associated errors and calculation diagnostics.

Preserve the delivered save-once / conditional-revalidation path and operation completion. Plan 2 runs custom validation for participating selected scopes when managed events are enabled,
including retained-value preparation.
Do not replay closed-row load/edit/save/unload lifecycle to refresh calculations. If a pre-save hook
changes inputs, include the resulting values in the final proposal without rerunning the hook.
Core review invalidation is implemented. Applying selected snapshots to editor/list state after
success/failure remains Plan 3 host integration.

## 9. Programmatic controller means host-driven preparation

The existing React/Native controller can already be obtained through
`engineOptions.onEventController`. An application-owned toolbar button can call:

```js
const result = await controller.prepareSave({ intent: 'submit' });
```

This is an existing binding interface, not a newly proposed headless-core method. The call can still
be initiated by React or Native UI; it simply does not have to originate from the renderer's own
Submit button. A purely headless consumer has no renderer controller and needs the shared core
preparation interface. Preparation does not persist, invoke onSubmit or close the editor by itself.

The normal child-modal/screen workflow already protects root UI actions. For an application-owned
toolbar calling root preparation while a child editor has unaccepted work, the maintainer agrees
with explicit pending-editor handling and no silent acceptance of child edits. The exact result
shape is open; this guard is not already delivered. Preserve generation, queue, readonly and
duplicate-save protections.

Automatic mode should prepare without user confirmation in both paths. Confirm mode needs a
host-visible decision state: a custom button cannot silently bypass a required review. The core review/status/decision shapes are implemented; binding callbacks and controller
continuations remain Plan 3 integration. They must bind decisions to the reviewed tree version and
avoid returning a deliverable payload before any required decision. A headless caller must explicitly
resolve required decisions; lack of UI is not automatic consent.

## 10. Selected policies and remaining consumer work

| Choice                  | Selected policy / delivery                                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema setting          | Direct `form.repeatable_recalculation`, automatic by default; host can require confirmation but cannot weaken authored confirmation. Retention requires explicit host permission.                                                |
| Empty/malformed choices | Single null, multiple []; preserve codes/Other text; diagnose malformed or ambiguous values.                                                                                                                                     |
| Linked records          | Grouped `{ record_id }` references, without fetching contents.                                                                                                                                                                   |
| Numeric collections     | Preserve positions; skip missing sum entries; Numeric/Calculated finite numbers only; reject strings and overflow.                                                                                                               |
| Editing                 | Root aggregates read accepted children. Accepted child saves update them; cancelled edits do not. Full refresh is an immutable proposal.                                                                                         |
| Freshness               | Version-1 companion contains status, schema revision and affected instance/field identities. Host storage/wiring remains Plan 3.                                                                                                 |
| Retention               | Validate the selected retained snapshot and its calculation-dependent rules; report pending freshness separately.                                                                                                                |
| Conditions              | Released strict schema rejection in 0.6.0; the record evaluator reuses the global reference index with local condition owners.                                                                                                   |
| Review/failure          | Single-use captured proposals; changed inputs/options or newer preparation invalidate review. No caller mutation or persistence. Host list commit/persistence acknowledgement remains Plan 3.                                    |
| Closed-row validation   | Automatically validate every participating selected row when managed events are enabled. Scope-specific registration shares source analysis/compilation. Genuine input errors block ordinary submit; root drafts remain allowed. |
| Drafts                  | Retain child values without confirmation, allow ordinary validation failures and return pending freshness when appropriate.                                                                                                      |
| Pending editors         | Host guard/continuation integration remains Plan 3. Core consumes accepted record snapshots, excluding unaccepted work.                                                                                                          |
| Performance             | 200/2,000 changed-row fixtures, 22-level nesting, Node and browser/worker evidence are recorded in the verification report. Native/Hermes device and full editor interactions remain Plan 3.                                     |

## 11. Web and mobile performance requirements

Performance is an agreed concern, not a reason to weaken correctness or impose a shallow nesting
model. The eventual design and verification must consider both wide collections and deep/uneven
trees, multiple aggregate consumers, and repeated edits or submissions.

- Measure editor responsiveness and submission-preparation latency, including UI-thread blocking
  on web main-thread execution and Native/Hermes. A Web Worker is not available as a Native fallback.
- Account for worker request/reply sizes, cloning and memory use; moving evaluation to a worker
  does not eliminate record-tree transport cost.
- Identify redundant schema analysis, engine construction, full-tree passes and repeated collection
  scans. Reuse or invalidation should follow actual dependencies and input versions; exact cache or
  engine-lifetime choices are not fixed here.
- Avoid requiring a permanently live engine for every closed record. Compare the costs of the
  actual proposed coordination design rather than assuming existing per-editor performance proves
  whole-record performance.
- Confirm equivalent final values and failure behavior across hosts. Bound evaluation work and
  report explicit failures instead of serializing a partially evaluated tree.

Plan 2 fixes accepted-value aggregate timing and supplies reproducible 200/2,000-row fixtures and
Node/browser/worker metrics. Reference preparation targets are 250 ms / 2 seconds. Actual Hermes
memory/latency and the small set of device/UI checks remain Plan 3; see the verification report for
measured results and limits.

## 12. Initial evidence and operating constraints

This section preserves the original alignment observations; current implementation evidence is in
RECORD_EVALUATION_VERIFICATION.md.

Source inspection on 22 October and a small direct core probe confirmed the 18-type catalog, the
null section placeholder and the payment-condition default-50 result. Earlier probes confirmed
hidden-ancestor validation and LabelField null output. These are targeted observations, not a new
full-suite or browser/device acceptance claim. No feature implementation or dependency install
occurred while gathering those initial observations. A later direct probe of a supplied root score
array, payment-local `.some(...)` helper and boolean visibility condition passed for `[95, 90]`
and `[95, 60]` under both TRUSTED and SAFE configurations. That probe verifies the existing
array-read/helper/condition path, not an implementation of REPEATABLEVALUES or a whole-tree
submission/worker/device guarantee. Repeatable title support is verified in current source and
the existing focused title-field checks.

Relevant sources:

- [Core field catalog](../src/schema/field-specs.js),
  [schema validation](../src/schema/schema-validator.js),
  [engine construction and evaluation](../src/engine/form-engine.js),
  [condition evaluation](../src/engine/conditions.js),
  [scope resolution](../src/engine/context-resolver.js),
  [repeatable title checks](../tests/title-fields.test.js).
- [Calculation dependencies](../src/utilities/calculation-dependencies.js),
  [repeatable ownership metadata](../src/utilities/repeatable-helpers.js),
  [structured record serialization](../src/utilities/record-transformer.js).
- [Delivered event and preparation contract](../EVENT_CONTRACT.md),
  [React renderer](../../form0-react/src/form-renderer.jsx),
  [React preparation](../../form0-react/src/utils/managed-events.js),
  [Native renderer](../../form0-react-native/src/form-renderer.jsx),
  [Native validation](../../form0-react-native/src/utils/repeatable-validation.js).
- [Reform builder form preservation](../../reform-frontend-tanstack/src/components/forms/builder/builder-document.ts),
  [root inspector](../../reform-frontend-tanstack/src/components/forms/builder/builder-inspector.tsx).
- [Complete prior handoff](../../.local-test-harnesses/form0-next-package-handoff-20261021/HANDOFF.md),
  [next-work ledger](../../.local-test-harnesses/form0-issue107-manual/NEXT_STEPS.md),
  [accepted manual evidence ledger](../../.local-test-harnesses/form0-issue107-manual/STABILIZATION_MANUAL_TESTS.md).

Preserve development-to-main history and unrelated work. The maintainer owns merging, version bumps,
publication, deployment and issue closure. Keep legacy lifecycle opt-out, invalid root drafts,
scope-level INVALID, permitted ancestor reads and local-only writes. No implicit linked-record fetch,
asynchronous validation, setter normalization, persistence reconstruction or Reform runtime rollout.
Use independent dependency trees, run heavy checks sequentially, retain four-locale docs parity,
avoid local docs production builds and secret-file reads, and keep device steps small. iOS device
acceptance remains deferred. Separate Native/mobile dependency exceptions expire 7 November 2026.

Plan 1 execution evidence is recorded separately in
[`form0-condition-scope-20261022/CHECKS.md`](../../.local-test-harnesses/form0-condition-scope-20261022/CHECKS.md).
Earlier observations above retain their original provenance and are not retroactively new test runs.

## 13. Plan 2 implementation agreement

Plan 1 is released in core 0.6.0; #103 is closed. Plan 2 is approved: shared core record evaluation,
submission validation (#99/#104), and calculation-only repeatable collections. Consumer adoption is
Plan 3. Existing consumer dependency edits must remain intact.

- Accepted-row edits update root collections after row acceptance; cancelled edits do not. Closed
  calculations remain accepted snapshots during editing. Submission prepares an immutable full-tree
  refresh, with root aggregates corresponding to the selected child values.
- Retained submissions validate the selected retained snapshot, including its calculation-dependent
  condition outcomes. Host permission is mandatory. Freshness is reported separately from validity.
- Automatically run participating closed-row custom validation when managed events are enabled.
  Genuine input failures block ordinary submit, even if many rows require correction. Root drafts
  remain allowed; no row must be opened merely to recalculate or revalidate.
- Root drafts preserve accepted child calculations without confirmation and carry pending freshness.
- Preserve missing collection positions: `[100, null, 200]`; sum finite numeric values to 300 and return
  zero for no rows. Only NumericField and CalculatedField sum targets are supported. Do not coerce
  numeric strings. Choice strings remain strings, including numeric-looking schema codes.
- Empty single choices return null; empty multiple choices return an empty array. Reject malformed
  or ambiguous selections. Preserve multiple-choice grouping, predefined selection order and Other
  text. FormLink collections return grouped `{ record_id }` reference objects without fetching.
- A single nested `tasks` definition may have rows below multiple `projects` records. Root collection
  reads all matching tasks in record order; a calculation in project P1 reads only tasks below P1.
  Reject unrelated nested source branches. Targets must belong to the referenced section's rows.
- Include accepted rows regardless of visibility. Submission validation separately excludes hidden
  ancestors. No implicit flattening of array-valued target fields.
- Use `form.repeatable_recalculation`: automatic (default) or confirm. Host-required confirmation
  cannot weaken authored confirmation. Durable freshness metadata stays outside the record.
- Core returns proposals and selected evaluated snapshots without persistence, ID/timestamp generation,
  or mutation of the caller's tree. Hosts retain save-hook ownership and save-once/revalidation order.
- Test 200/2,000-row and at-least-20-level fixtures; share schema preparation and yield cooperatively.
  Reference-machine warmed preparation targets: 250 ms / 2 seconds respectively. Actual Hermes
  performance acceptance and renderer UI/persistence integration remain Plan 3.

### Large-form follow-up

Assess record count, schema breadth and populated nesting together. The dedicated complex fixture
has 377 schema elements (360 fields, eight RepeatableSections and nine Sections), 90 calculation
definitions, 549 condition leaves and six populated repeatable levels with uneven sibling branches.
Its 200/2,000-row sizes count every row across the tree, rather than rows per level. The larger case
contains 80,040 input/calculated value cells and executes 20,010 calculation tasks during refresh.

Keep original narrow-schema measurements and broader-schema measurements distinct. Factory setup,
cold/warmed preparation, scheduling gaps, complete proposal transport and memory observations need
separate reporting. Shared immutable calculation binding metadata may be cached; instance values
must stay current and must never be retained in that cache. Preserve the complete permitted EVAL
context and existing diagnostics. See [the follow-up evidence](COMPLEX_RECORD_EVALUATION_VERIFICATION.md).

Plan 2 adds core contracts and localized documentation. Plan 3 still owns binding adoption and its
end-to-end parity requirements: keep #99/#104 and React #73 open until that delivery is verified.
Recommend a core minor release after verification and before consumer adoption; the maintainer owns
the actual version edit, promotion and publication. #103 remains the already-released Plan 1 work.

A subsequent payload breakdown distinguishes temporary evaluation from persistence: the 2,000-row
fixture serializes to a 2.46 MB structured record, a 6.63 MB evaluated snapshot and a 5.81 MB change
report. The initial retained-submission format created 5.43 MB of persistable pending-freshness
metadata because 16,000 affected field entries repeated complete row paths.

Selected correction: publish version 1 with one affected entry per row:
`{ instancePath, fields: [{ fieldName, fieldKey }] }`. This lossless grouping preserves complete
ancestry, IDs including zero, positional identities, schema revision and deterministic row/field
order. It reduces the same fixture's pending companion to 1.43 MB while retaining all 16,000 field
identities. Root/child calculation behavior, validation, review selection and saved record shape
remain unchanged. The earlier flat metadata was never published; no maintained consumer has adopted
it. Tests cover serialization/reopening, same-ID rows in different branches, positional rows and
defensive review isolation. Peak memory, confirmation lifetime and worker transport remain explicit
Plan 3 acceptance inputs. See the follow-up verification's payload breakdown.
