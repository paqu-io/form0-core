/**
 * The derived core carries everything along a wall in `subject.openings`, wall beams with doors
 * and windows (WB2, 2026-11-24), so every edit that carries an opening carries a beam. Each
 * entry's `width` is how far it reaches along the wall: a beam's length; the beam's own width
 * (across the wall) rides as `crossWidth` and comes back on write-back. Code that treats an
 * opening as a hole in the wall reads the stored doors and windows, never these entries.
 */

/** A stored wall child as the derived core carries it. */
export function alongWall(element) {
  if (element?.type !== 'beam') return element;
  const { length, width, ...rest } = element;
  return { ...rest, width: length, crossWidth: width ?? null };
}

/** A carried entry back as the stored wall child. */
export function fromAlongWall(entry) {
  if (entry?.type !== 'beam') return entry;
  const { width, crossWidth, ...rest } = entry;
  return { ...rest, length: width, width: crossWidth ?? null };
}
