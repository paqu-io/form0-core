import { evaluateConditions } from '../engine/conditions.js';
import { normalizeFieldValue } from '../utilities/field-value-normalization.js';
import { isFieldValueEmpty } from '../utilities/field-value-empty.js';
import { copyEventData as copy } from '../utilities/event-data.js';
import { areJsonValuesEqual } from '../utilities/value-equality.js';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const equal = areJsonValuesEqual;

export function propertySpecification(specifications, property, nodeKey = 'walls', scope = null) {
  return (
    Object.values(specifications).find(
      (spec) =>
        spec.property === property && spec.nodeKey === nodeKey && (!scope || spec.scope === scope)
    ) || specifications[property]
  );
}

export function providerApplies(provider, { floor, room, wall, side }, source) {
  const filter = provider.applies_to || {};
  if (filter.exposure && filter.exposure !== wall?.exposure) return false;
  if (filter.surface && filter.surface !== (side?.roomId ? 'room' : 'outside')) return false;
  if (filter.conditions) {
    const values = {
      ...floor.values,
      ...floor.properties,
      ...room?.values,
      ...room?.properties,
      ...source.values,
      ...source.properties,
    };
    for (const field of Object.values(provider.conditionFields || {})) {
      const property = field.building_plan?.property || field.data_name;
      if (own(source.properties, property)) values[field.data_name] = source.properties[property];
    }
    if (!evaluateConditions(filter.conditions, values, provider.conditionFields || {}))
      return false;
  }
  return true;
}

/**
 * An inherited choice in the words of the field receiving it (2026-11-24): the floor's "Every wall
 * has a lintel band" reads "Yes" on a wall, as "All the interior walls are plastered" reads
 * "Plastered". Values are unchanged.
 */
function inReceivingWords(field, value) {
  if (!Array.isArray(field?.choices) || !Array.isArray(value?.choice)) return value;
  return {
    ...value,
    choice: value.choice.map((entry) => {
      const own = field.choices.find((choice) => choice.value === entry?.value);
      return own ? { ...entry, label: own.label } : entry;
    }),
  };
}

/** Resolve explicit intent without materializing inherited defaults as overrides. */
export function resolveInheritedProperty(context, property, specification = {}) {
  const { floor, subject, room, wall, side } = context;
  if (own(subject.overrides, property))
    return {
      value: copy(subject.overrides[property]),
      source: {
        scope: side ? 'wall_face' : wall && subject === wall ? 'physical_wall' : context.nodeKey,
        id: subject.id,
      },
      mode: 'override',
    };
  // A field can be both a row's own inherited property and a source its descendants inherit
  // (the room's structural clear height: inherited from the floor, passed on to walls and
  // columns). Its row stores the answer as a provider answer of the same name; that answer is
  // the row's own value too, or the room keeps the floor's height and the record loses the typed
  // one (2026-11-16). Any future field routed the same way relies on this.
  if (own(subject.providerOverrides, property))
    return {
      value: copy(subject.providerOverrides[property]),
      source: { scope: context.nodeKey, id: subject.id },
      mode: 'override',
    };
  if (specification.inherit !== false) {
    const rooms = side
      ? side.roomId
        ? floor.rooms.filter((entry) => entry.id === side.roomId)
        : []
      : wall
        ? floor.rooms.filter(
            (entry) =>
              wall.sides?.some((entrySide) => entrySide.roomId === entry.id) ||
              entry.faces.some((face) => face.wallId === wall.id)
          )
        : room
          ? [room]
          : [];
    const levels = [];
    if (wall && subject !== wall && !side) levels.push(['walls', [wall]]);
    if (rooms.length && !rooms.includes(subject)) levels.push(['rooms', rooms]);
    if (floor !== subject) levels.push(['floors', [floor]]);
    for (const [nodeKey, subjects] of levels) {
      const candidates = [];
      for (const source of subjects) {
        if (own(source.defaults, property))
          candidates.push({ value: source.defaults[property], id: source.id });
        for (const provider of specification.providers || []) {
          if (provider.sourceNode !== nodeKey) continue;
          const owners =
            nodeKey === 'walls' && provider.scope === 'wall_face' ? source.sides || [] : [source];
          for (const owner of owners) {
            const providerContext =
              owner === source
                ? context
                : {
                    ...context,
                    side: owner,
                    room: floor.rooms.find((room) => room.id === owner.roomId),
                  };
            if (!providerApplies(provider, providerContext, owner)) continue;
            const name = provider.sourceOriginalDataName;
            const explicit =
              own(owner.providerOverrides, name) ||
              own(owner.overrides, provider.property) ||
              (own(owner.properties, provider.property) &&
                owner.provenance?.[provider.property]?.scope !== 'schema');
            const value = own(owner.providerOverrides, name)
              ? owner.providerOverrides[name]
              : own(owner.overrides, provider.property)
                ? owner.overrides[provider.property]
                : own(owner.properties, provider.property)
                  ? owner.properties[provider.property]
                  : owner.values?.[name];
            const normalizedValue = normalizeFieldValue(provider.field, value);
            if (!explicit && isFieldValueEmpty(provider.field, normalizedValue)) continue;
            candidates.push({
              value: normalizedValue,
              id: owner.id,
              field: name,
              ...(owner !== source ? { scope: 'wall_face' } : {}),
            });
          }
        }
      }
      if (!candidates.length) continue;
      if (candidates.some((candidate) => !equal(candidate.value, candidates[0].value)))
        return {
          conflict: {
            code: 'conflicting_room_defaults',
            message: 'Choose one value for this shared property; applicable defaults disagree.',
            subject: { type: side ? 'wall_face' : context.nodeKey, id: subject.id },
            property,
            candidates: copy(candidates),
          },
        };
      return {
        value: inReceivingWords(specification.field, copy(candidates[0].value)),
        source: {
          scope:
            nodeKey === 'rooms'
              ? 'room'
              : nodeKey === 'floors'
                ? 'floor'
                : candidates.every((candidate) => candidate.scope === 'wall_face')
                  ? 'wall_face'
                  : 'physical_wall',
          ids: [...new Set(candidates.map((entry) => entry.id))],
          providers: candidates
            .filter((entry) => entry.field)
            .map(({ id, field }) => ({ id, field })),
        },
        mode: 'inherit',
      };
    }
  }
  return {
    value: copy(specification.fallback ?? null),
    source: { scope: 'schema' },
    mode: 'inherit',
  };
}

export function nodeSubjects(floor, nodeKey) {
  if (nodeKey === 'floors') return [{ subject: floor, room: null }];
  if (nodeKey === 'rooms') return floor.rooms.map((room) => ({ subject: room, room }));
  if (['columns', 'beams', 'objects'].includes(nodeKey))
    return floor.rooms.flatMap((room) => room[nodeKey].map((subject) => ({ subject, room })));
  if (['doors', 'windows'].includes(nodeKey))
    return floor.walls.flatMap((wall) =>
      wall[nodeKey].map((subject) => ({ subject, wall, room: null }))
    );
  return [];
}
