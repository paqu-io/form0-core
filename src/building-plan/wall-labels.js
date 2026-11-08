const automatic = (value) => typeof value === 'string' && /^W\d+(?:\.\d+)*$/.test(value);
const parents = (wall) =>
  [
    wall.lineage?.dividedFromWallId,
    wall.lineage?.copiedFromWallId,
    wall.lineage?.splitFromWallId,
    wall.lineage?.jogOriginWallId,
  ].filter((id) => id && id !== wall.id);

/** Stable presentation identities; accepted answers and physical ownership remain independent. */
export function reconcileWallLabels(floor, previous = null) {
  if (!Array.isArray(floor?.walls) || floor.walls.some((wall) => !wall || typeof wall !== 'object'))
    return;
  const walls = new Map(floor.walls.map((wall) => [wall.id, wall]));
  const old = new Map((previous?.walls || []).map((wall) => [wall.id, wall]));
  const assigned = new Set();
  const reserved = new Set(floor.walls.map((wall) => wall.values?.wall_label).filter(Boolean));
  const done = new Set();
  const references = new Map();
  for (const wall of floor.walls)
    for (const id of parents(wall)) references.set(id, (references.get(id) || 0) + 1);
  const order = [...floor.walls].sort(
    (a, b) =>
      Number(old.has(b.id)) - Number(old.has(a.id)) ||
      (references.get(b.id) || 0) - (references.get(a.id) || 0)
  );
  for (const wall of order) {
    const retained = old.get(wall.id)?.autoLabel;
    const copied = !old.has(wall.id) && parents(wall).some((id) => old.has(id));
    const label = automatic(retained) ? retained : copied ? null : wall.autoLabel;
    if (!automatic(label) || assigned.has(label)) continue;
    wall.autoLabel = label;
    assigned.add(label);
    done.add(wall.id);
  }
  const visiting = new Set();
  const allocate = (wall) => {
    if (done.has(wall.id)) return wall.autoLabel;
    const parent = parents(wall)
      .map((id) => old.get(id) || walls.get(id))
      .find(Boolean);
    let source = parent?.autoLabel || wall.autoLabel;
    if (parent && !automatic(source) && walls.has(parent.id) && !visiting.has(parent.id)) {
      visiting.add(wall.id);
      source = allocate(walls.get(parent.id));
      visiting.delete(wall.id);
    }
    const base = automatic(source) ? source.match(/^W\d+/)[0] : null;
    let label;
    if (base) {
      let suffix = 1;
      do {
        label = `${base}.${suffix++}`;
      } while (assigned.has(label) || reserved.has(label));
    } else {
      let index =
        Math.max(
          0,
          ...[...assigned, ...reserved].map((value) =>
            Number(String(value).match(/^W(\d+)(?:\.|$)/)?.[1] || 0)
          )
        ) + 1;
      do {
        label = `W${index++}`;
      } while (assigned.has(label) || reserved.has(label));
    }
    wall.autoLabel = label;
    assigned.add(label);
    done.add(wall.id);
    return label;
  };
  for (const wall of floor.walls) allocate(wall);
}
