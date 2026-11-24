import { normalizeBuildingPlanLocale } from './presentation.js';
import { BAND_TEXTS } from './presentation-band-texts.js';
import { bandKind, bandOf } from './band-rows.js';

/** Words for automatic names; columns and beams use language-neutral codes (C#1, B#1). */
const WORDS = {
  en: { room: 'Room', door: 'Door', window: 'Window', object: 'Object' },
  it: { room: 'Stanza', door: 'Porta', window: 'Finestra', object: 'Oggetto' },
  fr: { room: 'Pièce', door: 'Porte', window: 'Fenêtre', object: 'Objet' },
  es: { room: 'Habitación', door: 'Puerta', window: 'Ventana', object: 'Objeto' },
};

const textOf = (value) =>
  typeof value === 'string'
    ? value
    : (value?.other?.[0]?.label ?? value?.choice?.[0]?.label ?? value?.choice?.[0]?.value ?? null);
const isEmpty = (value) =>
  value == null ||
  (typeof value === 'string' && !value.trim()) ||
  (typeof value === 'object' && !value.choice?.length && !value.other?.length);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The next "<prefix><separator>N" after the highest number already used in `names`. */
function nextName(names, prefix, separator) {
  const pattern = new RegExp(`^${escape(prefix)}${escape(separator)}(\\d+)$`);
  const used = names.map((name) => pattern.exec(name || '')?.[1]).filter(Boolean);
  return `${prefix}${separator}${Math.max(0, ...used.map(Number)) + 1}`;
}

/**
 * Give every room, door, window, column, beam and object that `candidate` adds without a name an
 * automatic one (decided 2026-11-16): "Room 2" (an Other answer), "Door 1", "Window 1",
 * "Object 1", "C#1", "B#1" (the canvas's style for codes, F#1, R#1, W#1: 2026-11-20), numbered per
 * floor after the highest number in use, in the editor's language. Names are set once, at
 * creation; a person can change them like any answer.
 */
export function assignBuildingPlanDefaultNames(before, candidate, locale = 'en') {
  const words = WORDS[normalizeBuildingPlanLocale(locale)];
  const known = new Set();
  for (const floor of before?.floors || []) {
    for (const room of floor.rooms) {
      known.add(room.id);
      for (const element of [...room.columns, ...room.beams, ...room.objects])
        known.add(element.id);
    }
    for (const wall of floor.walls)
      for (const opening of [...wall.doors, ...wall.windows, ...(wall.beams || [])])
        known.add(opening.id);
  }
  for (const floor of candidate.floors) {
    // `field`: the name's field, or a function giving it per subject (beams: room or wall).
    const name = (subjects, field, prefix, separator, write = (value) => value) => {
      const fieldOf = typeof field === 'function' ? field : () => field;
      const names = subjects.map((subject) => textOf(subject.values?.[fieldOf(subject)]));
      for (const subject of subjects) {
        if (known.has(subject.id) || !isEmpty(subject.values?.[fieldOf(subject)])) continue;
        const value = nextName(names, prefix, separator);
        subject.values = { ...subject.values, [fieldOf(subject)]: write(value) };
        names.push(value);
      }
    };
    name(floor.rooms, 'room_name', words.room, ' ', (label) => ({
      choice: [],
      other: [{ label }],
    }));
    const doors = floor.walls.flatMap((wall) => wall.doors);
    const windows = floor.walls.flatMap((wall) => wall.windows);
    name(doors, 'door_label', words.door, ' ');
    name(windows, 'window_label', words.window, ' ');
    name(
      floor.rooms.flatMap((room) => room.columns),
      'column_identifier',
      'C',
      '#'
    );
    // A band row is named by its band, in the editor's language (bands unit 2, 2026-11-24).
    const language = normalizeBuildingPlanLocale(locale);
    for (const beam of floor.walls.flatMap((w) => w.beams || [])) {
      const band = bandKind(bandOf(beam));
      if (!band || !isEmpty(beam.values?.wall_beam_identifier)) continue;
      const title = BAND_TEXTS[language]?.[band.title] || band.title;
      beam.values = { ...beam.values, wall_beam_identifier: title };
    }
    // Room beams and wall beams share one numbering per floor (wall beams, 2026-11-24).
    name(
      [...floor.rooms.flatMap((room) => room.beams), ...floor.walls.flatMap((w) => w.beams || [])],
      (beam) => (beam.type === 'beam' ? 'wall_beam_identifier' : 'beam_identifier'),
      'B',
      '#'
    );
    name(
      floor.rooms.flatMap((room) => room.objects),
      'object_name',
      words.object,
      ' '
    );
  }
  return candidate;
}
