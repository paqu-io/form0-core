# BuildingPlan language

These terms describe collected building geometry and its room-first editing workflow.

## Language

**Physical wall**: One straight wall piece with consistent adjacent-room coverage, its own physical answers, two surfaces and hosted openings. Several rooms can face the same complete piece.

**Geometric span**: The straight reference extent of one physical wall. It carries geometry rather than independent physical answers.
_Avoid_: Construction segment when implying a second property owner inside a physical wall.

**Canonical side**: One of a physical wall’s two durable surfaces, including an uncovered outside surface. Surface answers belong to this side rather than to the room through which it is viewed.

**Facing portion**: A room’s view of a complete physical wall piece and its canonical side.
_Avoid_: Independent physical wall when referring only to a room’s view.

**Editing cut**: An intentional division into independently editable physical pieces. It remains until explicitly rejoined, including when the pieces are collinear.

**Rejoin**: Removal of a compatible editing cut between contiguous collinear physical pieces with matching adjacency and compatible answers.

**Jog**: A local change of direction where an edited boundary portion meets a stationary portion. Its return is the connecting straight piece.

**Automatic wall label**: A stable label for a physical wall, shared by its room views. New related pieces can receive suffixes without changing retained owners’ labels.

**Material profile**: A derived thickness shoulder or junction cap supplied by existing wall bands. Its room geometry references an existing physical wall and canonical side. It owns no separate physical properties, surface answers, openings or repeatable rows. Temporary solver incidence is reconstructed privately; genuine short jog returns remain physical walls.
