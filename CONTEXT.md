# BuildingPlan language

These terms describe collected building geometry and its room-first editing workflow.

## Language

**Physical wall**: A durable construction subject with accepted physical properties and hosted openings.
Several rooms can face different portions of the same physical wall.

**Facing portion**: A room's side of a physical wall over a particular extent, with its own room-side answers.
_Avoid_: Independent physical wall when referring only to a room's view.

**Editing cut**: An intentional division between editable facing portions of a continuous physical wall.
The cut remains until explicitly rejoined, including when its portions are collinear.

**Rejoin**: Removal of a compatible editing cut between contiguous collinear portions.
_Avoid_: Physical wall merge for removal of an editing cut.

**Jog**: A local change of direction where an edited boundary portion meets a stationary portion.
