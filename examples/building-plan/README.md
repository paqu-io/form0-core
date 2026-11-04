# BuildingPlan record example

This maintained example contains two staggered 5 m × 3 m rooms sharing 2 m of
one continuous 8 m physical wall. That wall hosts one 0.9 m door. A dated 0.19 m
thickness observation is separate from the accepted inherited 0.2 m thickness.

- [schema.json](schema.json): authoring schema, including room-side, physical-wall,
  and observation questions through `node_overrides`.
- [record-output.json](record-output.json): actual canonical submitted record.
- [semantic-output.json](semantic-output.json): decoded semantic snapshot of that record.
- [create-example.js](create-example.js): fixture construction using the shared domain operations.

The files describe a valid collected layout. They are not a snapshot of a running
preview or a record of edits made during a manual walkthrough.

## Editor nesting and canonical ownership

The editor follows floor → room → column/beam/object/wall, with doors/windows under
walls. Shared physical questions are edited through the ordinary room wall row.
Canonical floor collections are internal storage, without separate floor-level editors.
Observation editing is optional; this schema explicitly configures one observation question.

In the submitted record, logical ownership is:

```text
record.form_values
└─ floors[] → floor.form_values
   ├─ floor answers, defaults, and model identity
   ├─ physical_walls[] → wall.form_values
   │  ├─ wall geometry and accepted physical answers
   │  ├─ doors[] → opening.form_values
   │  └─ windows[] → opening.form_values
   ├─ observations[] → observation.form_values
   └─ rooms[] → room.form_values
      ├─ room polygon, answers, and model identity
      ├─ columns[], beams[], objects[]
      └─ walls[] → face.form_values (room-side answers and wall references)
```

These are logical names; actual keys have generated scope suffixes. Room-facing
physical fields and hosted-opening/observation lists are editor projections. Canonical
serialization omits those copies and retains the authoritative physical/floor records once.

## Geometry and readability

Each room's generated `room_vertices` field contains versioned metric polygon vertices.
`wall_geometry` contains physical construction segments. `wall_face_model` contains
the physical-wall reference, covered intervals, segment/edge IDs, direction, and side.
Other `*_model` fields preserve stable subject identities, default/override intent,
and observation context. Door/window dimensions and offsets are numeric answers.

Geometry/model fields use JSON **text** values within the ordinary field contract.
The raw record therefore contains escaped strings and normal repeatable-row metadata.
The decoded semantic snapshot is easier to inspect and process as objects and arrays:

```js
import {
  expandBuildingPlanSchema,
  buildFormRecordSnapshot,
  readBuildingPlanRecord,
} from 'form0-core';

const expanded = expandBuildingPlanSchema(schema);
const runtime = buildFormRecordSnapshot(expanded.schema, savedRecord);
const plan = readBuildingPlanRecord({ meta: expanded.buildingPlanMeta[0], record: runtime });
const roomVertices = plan.floors[0].rooms[0].vertices;
const wallSegments = plan.floors[0].walls[0].segments;
```

The snapshot uses `version: 1`, `unit: 'm'`, and `axes: 'x-right-y-down'`.
Coordinates are floor-local metres. The shared segment runs from `(8, 3.1)` to
`(0, 3.1)`. One room binds interval `[3, 8]`, the other `[0, 5]`; those are metre
distances along the segment. Their intersection `[3, 5]` is the shared 2 m.
The physical wall, its door, and its accepted thickness are each stored once.

The semantic snapshot is reconstructed on demand, not submitted as a second independent
copy. Preserve identities, bindings, override intent, and observation provenance when
writing a modified snapshot back through `writeBuildingPlanRecord`. Row identities and
physical subject identities have different roles. Pan/zoom and unfinished previews are transient.

## Jog edits and editor preferences

Detaching a room reconciles the stationary wall's current segment extents to its surviving faces;
unused automatic tails are removed from the saved geometry. Stationary identities, valid hosted
opening positions, and dated observation source geometry remain intact. Independently authored
free-standing walls and host lengths needed by retained openings are preserved.

A valid shared-face jog exposes six straight wall-facing rows for the second room. By default,
new independent runs receive their own physical subjects; actual compatible contact can reuse an
existing physical wall. A 0.20 m southward jog has nine physical walls, while a 0.60 m jog connects
its vertical return to Room 1's existing right wall and has eight. The active room's face stays
fixed and the opposite face is one effective thickness away: a 0.20 m wall draws one 0.20 m band.
The return row carries its canonical wall's label, so it may be labelled W2 rather than W3.3.
Partial sharing in the unchanged example still uses seven. Pass
`editingPolicy: { preserveWallGrouping: true }` to preserve grouping of new runs, while retaining
the six facing rows. Compatible contact can still join existing construction. `setEditingPolicy()` changes future operations without
rewriting accepted records or adding history. The `separate_wall` operation can explicitly
separate selected construction segments with `wallId` and optional `segmentIds`.

Surviving runs keep their identities. New runs carry lineage, and hosted openings keep their IDs
and widths. A wall observation spanning separated subjects remains one observation; its
`relatedSubjects` list references the resulting physical subjects while the original
`sourceSubject`, coverage, evidence, and captured geometry remain available. Copied answers are
not new measurements. Returning automatic runs to a straight alignment can coalesce redundant
rows when their answers agree; distinct answers, explicit separations, or occupied returns can
require an inline resolution instead.

Snapping and edge auto-pan default on and are independently switchable through the editing
policy. These preferences, alignment guides, and viewport changes are absent from record output.

## Verify or update

From the `form0-core` repository root:

```sh
node examples/building-plan/verify.mjs
```

To update the maintained example after a contract change, edit `create-example.js`, then run:

```sh
node examples/building-plan/generate.mjs
node examples/building-plan/verify.mjs
```

Generation writes only this example's three JSON files. Record timestamps reflect the
generation run; they are ordinary record metadata. Verify the JSON changes together with
the matching implementation and localized documentation before accepting them.

## Confirmed opening removal during a geometry edit

An operation that partly cuts a door/window returns `opening_cut_requires_confirmation`, with
`openingIds`, `openings` (type and label), and `observationIds`. No accepted data changes. After
explicit confirmation, retry the same operation with `removeOpeningIds` containing exactly the
reported IDs. Set `allowObservationDeletion: true` only when the associated observation cascade
was disclosed and confirmed. Stale or unrelated opening IDs are rejected. The entire move/removal
is one history entry and follows its initiating row checkpoint.

`BuildingPlanCanvasController` accepts an optional `confirmOpeningRemoval(issue)` callback returning
a boolean or promise. Its default declines; CLI, React and Native supply their existing confirmation
mechanism. It is called at gesture completion, never on pointer/touch move previews. An opening
fully outside the edited room remains on its surviving wall, without a projection in that room.
These operation options are runtime edit intent, not schema attributes or independent record fields.

The canvas derives physical wall footprints from these segments and effective thicknesses, while
room-facing rows remain selection/editing targets. A shared wall and its hosted opening are drawn
once; the two room faces remain separated by the wall thickness. Derived footprints and viewport
state are not additional fields in either saved JSON example. Unknown thickness stays schematic.
