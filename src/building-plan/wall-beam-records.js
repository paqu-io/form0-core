import { copyBuildingPlanData as copy } from './model.js';

/**
 * A wall beam in the record (2026-11-24): a row under its physical wall, its place and size in its
 * system fields, its identity and segment in its model. `io`: `records.js`'s row accessors.
 */
const NODE = 'wall_beams';

/** A beam row as the model's beam. */
export function readWallBeam(io, meta, row) {
  const state = io.modelOf(meta, NODE, row);
  const field = (name) => io.read(meta, NODE, row, name);
  // The band kind is internal, so not among the row's plain answers (bands unit 2).
  const band = field('wall_beam_band');
  const values = io.plainValues(meta, NODE, row);
  if (band?.choice?.length) values.wall_beam_band = band;
  return {
    id: state.id,
    type: 'beam',
    segmentId: state.segmentId,
    offset: field('wall_beam_offset'),
    length: field('wall_beam_length'),
    width: field('wall_beam_width'),
    depth: field('wall_beam_depth'),
    underside: field('wall_beam_distance_from_floor'),
    values,
    overrides: io.readOverrides(meta, NODE, row, state),
    providerOverrides: io.readProviders(meta, NODE, row, state),
    repeatable: io.readCustom(meta, NODE, row),
    ...(state.provenance ? { provenance: copy(state.provenance) } : {}),
    // A band row's values set on it rather than the floor's or the wall's (bands unit 3).
    ...(state.ownValues?.length ? { ownValues: [...state.ownValues] } : {}),
  };
}

/** The model's beam into its row (its answers first, then its place and size over them). */
export function writeWallBeam(io, meta, row, beam, wall) {
  io.writePlain(meta, NODE, row, beam.values);
  io.writeProperties(meta, NODE, row, beam);
  io.writeCustom(meta, NODE, row, beam);
  io.writeModel(meta, NODE, row, {
    ...io.intent(beam),
    id: beam.id,
    segmentId: beam.segmentId,
    ...(beam.provenance ? { provenance: beam.provenance } : {}),
    ...(beam.ownValues?.length ? { ownValues: [...beam.ownValues] } : {}),
  });
  for (const [name, value] of [
    ['wall_beam_offset', beam.offset],
    ['wall_beam_length', beam.length],
    ['wall_beam_width', beam.width],
    ['wall_beam_depth', beam.depth],
    ['wall_beam_distance_from_floor', beam.underside],
    ['wall_beam_wall_reference', wall.id],
    ['wall_beam_band', beam.values?.wall_beam_band],
  ])
    io.write(meta, NODE, row, name, value ?? null);
}
