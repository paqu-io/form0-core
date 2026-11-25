import assert from 'node:assert/strict';
import { createBuildingPlanSession, getBuildingPlanProblems } from '../../src/index.js';
import { createBuildingPlanExample } from '../../examples/building-plan/create-example.js';

// The example plan with the floor's bands at hand (bands unit 4a): its answers and values, a
// band row's edit, windows, and the floor's problems listed as "wall code names".

const yes = { choice: [{ value: 'yes', label: 'y' }], other: [] };

export function example() {
  const f = createBuildingPlanExample();
  let serial = 0;
  const session = createBuildingPlanSession({
    snapshot: f.snapshot,
    properties: f.meta.properties,
    createId: () => `c-${++serial}`,
    derivedCommands: true,
  });
  const floor = () => session.getSnapshot().floors[0];
  const apply = (operation) => session.apply({ floorId: f.floorId, ...operation });
  const wall = (label) => floor().walls.find((entry) => entry.autoLabel === label);
  const band = (label, kind) =>
    wall(label).beams.find((beam) => beam.values.wall_beam_band?.choice?.[0]?.value === kind);
  const floorValues = (values) =>
    apply({ type: 'set_values', nodeKey: 'floors', elementId: f.floorId, values });
  const answer = (kind) =>
    apply({
      type: 'set_provider',
      nodeKey: 'floors',
      fieldName: kind === 'ring' ? 'floor_ring_beam' : `floor_${kind}_band`,
      property: kind === 'ring' ? 'wall_ring_beam' : `wall_${kind}_band`,
      value: yes,
    });
  const edit = (label, kind, change) =>
    apply({
      type: 'update_opening',
      wallId: wall(label).id,
      openingId: band(label, kind).id,
      ...change,
    });
  const window = (label, offset, sillHeight, height, name) =>
    apply({
      type: 'create_opening',
      kind: 'window',
      wallId: wall(label).id,
      offset,
      width: 1,
      height,
      sillHeight,
      values: { window_label: name },
    });
  const problems = () => getBuildingPlanProblems(session.getSnapshot(), f.floorId);
  /** Each problem as "wall code names", sorted. */
  const listed = () =>
    problems()
      .map((problem) => {
        const label = floor().walls.find((entry) => entry.id === problem.wallId).autoLabel;
        const names = problem.elements.map((element) => element.name).join(' + ');
        return `${label} ${problem.code} ${names}`;
      })
      .sort();
  return {
    f,
    session,
    floor,
    apply,
    wall,
    band,
    floorValues,
    answer,
    edit,
    window,
    problems,
    listed,
  };
}
export const applied = (result) =>
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
