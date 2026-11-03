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
