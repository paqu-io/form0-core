# Fulcrum load events and accepted-snapshot viewing

Research date: 2026-10-23. This is a first-party documentation and public-source comparison for a proposed form0 policy. It does not implement that policy.

The comparison supports firing a load event when a view opens. It does **not** establish that Fulcrum guarantees an immutable accepted snapshot, rejects all value writes while viewing, or preserves previously accepted calculation results when viewing a repeatable. Those remain unverified integration behaviors.

## Evidence and limits

Context7 resolved Fulcrum to `/websites/fulcrumapp`; its relevant results pointed to the official Data Events Reference. The findings below were checked against Fulcrum developer docs, its Help Center, and the public `fulcrumapp/fulcrum-expressions` repository. Source links are pinned to commit `df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983` where applicable.

No authenticated Fulcrum web UI, mobile app, or live record was tested. No dependencies were installed. Documentation and source observations below are not claims about an observed save/reopen result.

## Documented lifecycle

| Question                                      | First-party evidence                                                                                                                                                                                                                    | Limit                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does a view-only record opening trigger load? | `load-record` fires when the editor appears, including new records, existing edits, and view-only openings. Defaults are not applied in view-only mode. [Data Events Reference](https://docs.fulcrumapp.com/docs/data-events-reference) | The page does not specify an exact event count for a view-to-edit transition within the same opening.                                                                                        |
| Where does new-record initialization belong?  | `new-record` follows load and is intended for new-record default logic. `edit-record` follows load for an existing edit. [Data Events Reference](https://docs.fulcrumapp.com/docs/data-events-reference)                                | This does not establish the complete transition sequence when the user presses Edit from an already open view.                                                                               |
| What about repeatables?                       | Load occurs when the repeatable editor appears; new/edit repeatable events follow load. [Introduction to Fulcrum Data Events](https://help.fulcrumapp.com/en/articles/92676-introduction-to-fulcrum-data-events)                        | The repeatable reference does not expressly repeat the record reference's view-only guarantee. [Repeatable Events](https://docs.fulcrumapp.com/docs/data-events-reference#repeatable-events) |
| Is viewing a distinct UI operation?           | Web Quick View displays a record; its Edit button enables editing. [Record Options](https://help.fulcrumapp.com/en/articles/2456023-record-options)                                                                                     | UI documentation does not define the execution or persistence policy for view-time scripts.                                                                                                  |

## Writes and the meaning of read-only

Fulcrum publishes a load handler that clears a field through `SETVALUE`. Therefore a blanket rule that all load handlers are incapable of changing values would conflict with that published example. The example does **not** prove that the write applies or persists in view-only mode. [Comments summary example](https://docs.fulcrumapp.com/docs/create-a-summary-field-of-comments-entered-when-record-is-edited-multiple-times)

The `SETVALUE` reference describes field-value assignment and clearing, without stating a view-mode restriction. This omission establishes no guarantee about view-mode execution. [SETVALUE](https://docs.fulcrumapp.com/docs/data-events-setvalue)

Field-level read-only prevents manual input, while Data Events may still populate that field. Consequently, field read-only and an immutable whole-record view are different policies; one cannot be used as evidence for the other. [Read-only field option](https://help.fulcrumapp.com/en/articles/3130920-read-only)

**Public-source observation:** `SETVALUE` validates field support, converts the value, and appends a `set-value` result. This implementation contains no view-mode check. Applying those returned results is a separate integration boundary: this function does not show whether the web/mobile host accepts, ignores, rejects, displays, or persists a result while viewing. [SETVALUE implementation](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/functions.coffee#L2423-L2462)

Fulcrum also publishes load-time UI behavior using `ALERT` and visibility changes. That is evidence for these uses in a load handler, without a specific guarantee for every view-only platform. [Geofencing example](https://docs.fulcrumapp.com/docs/geofencing-with-loadrecords-and-geometry)

## Mode information

The documented event callback exposes `name`, and applicable `value`/`field` properties; `event.mode` is not listed. This is a documentation gap, rather than proof that no host ever supplies extra properties. [Event object reference](https://docs.fulcrumapp.com/docs/data-events-reference#the-event-object)

**Public-source observation:** `MODE()` returns `$$runtime.mode`; `SETMODE()` assigns it. Repository tests explicitly use `'view'` and `'edit'`. These are real source-level equivalents for mode information, but the inspected material does not establish a supported public API contract for host initialization, repeatable inheritance, mode changes, or a separate `'new'` mode. [MODE implementation](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/functions.coffee#L1847-L1848), [SETMODE implementation](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/functions.coffee#L2358-L2360), [view/edit tests](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/test/test.coffee#L2641-L2648)

The repository README identifies CoffeeScript as its current implementation and describes the TypeScript implementation's editor-type role. The source observations above use CoffeeScript; they do not infer deployed host behavior from TypeScript declarations. [Repository README](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/README.md)

Documented `ISNEW()`/`ISUPDATE()` distinguish new from existing records or repeatable items. Their source uses `featureIsNew` and its negation, so they do not independently identify view versus edit. [ISNEW](https://docs.fulcrumapp.com/docs/calculations-ref-isnew), [ISUPDATE](https://docs.fulcrumapp.com/docs/calculations-ref-isupdate), [source](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/functions.coffee#L931-L932), [source](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/functions.coffee#L987-L988)

## Calculations while viewing

The Help Center documents continuous calculation updates while users type. Another article says hidden calculation fields still run when the record opens in the editor. Neither statement specifically establishes calculation reevaluation in view-only mode, closed-child reevaluation after a parent change, or preservation of accepted child results. [Configuring Data Events](https://help.fulcrumapp.com/en/articles/92971-configuring-data-events-with-javascript), [Hidden fields](https://help.fulcrumapp.com/en/articles/3130841-hidden)

The public expression runtime separately implements event dispatch and calculation evaluation. Its evaluation method runs supplied expressions without checking view/edit mode there. This does not show when a host invokes evaluation or which calculated results it accepts. [Runtime trigger/evaluate implementation](https://github.com/fulcrumapp/fulcrum-expressions/blob/df3ea8bb779c86775b2ecd6e3c3bcb38ecaf1983/runtime.coffee#L227-L285)

## Implications for the proposed form0 contract

These are design conclusions, not claims about Fulcrum behavior:

1. **Keep a load event for each opening in either mode.** Fulcrum provides direct record-level precedent. Defining exactly one load per opening, including the view-to-edit transition, remains an explicit form0 choice.
2. **Keep accepted values separate from edit calculations.** In the requested example, View reads accepted child totals `110` and `220`, with root total `330`. Editing against current parent tax `20%` can compute candidate totals `120` and `240`. Saving only row 1 accepts `120`, leaves row 2 at `220`, and produces root `340`; canceling row 1 retains `110` and root `330`. This is the requested form0 behavior; the research does not establish the same sequence in Fulcrum.
3. **Enforce immutable viewing at the mutation boundary.** Running load handlers while blocking record-value writes is coherent with accepted-snapshot viewing, but should be documented as form0's guarantee. Rejecting data writes must cover programmatic setters and calculation result acceptance, not merely disable controls. Reads, alerts, and presentation changes can remain available under an explicitly defined capability policy.
4. **Use new/edit events for writable initialization.** This gives authors a clear place for defaults or migrations that belong to an edit session. It avoids assuming that every load hook is a writable initialization hook.
5. **Expose mode explicitly if useful.** Proposed `event.mode: 'readonly' | 'edit'` is a form0 API decision. Fulcrum's source-level vocabulary is `'view' | 'edit'`; its documented event shape does not supply this property. Keep creation identity separate from viewing/editing capability.

## Remaining vendor questions

- Whether a view-only `SETVALUE` produces an error, is ignored, changes only presentation, changes an edit candidate, or can be persisted later.
- Whether all calculation fields run in view-only mode, and whether their displayed results can differ from stored results.
- Whether opening a repeatable for viewing reruns its load handler on each supported platform.
- Exact event counts/order and runtime lifetime for View → Edit → Cancel and View → Edit → Save.
- How a host initializes and updates `MODE()`, and whether it is a supported public API.
- The exact accepted-child/parent-tax scenario, including closed children and root aggregates.

These need an explicit vendor statement or controlled authenticated web/mobile tests. No such tests were performed here. Some candidate mode-documentation URLs were inaccessible through the web reader; this was not interpreted as proof of API absence. The Data Events Reference and its Markdown version were successfully retrieved, and source inspection supplied the narrower `MODE()` evidence above.
