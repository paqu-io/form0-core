import { BUILDING_PLAN_MEASURES } from '../schema/building-plan-measures.js';

/** Presentation only: canonical schemas, answer labels and metre values are never mutated. */
const TRANSLATIONS = {
  fr: {
    Name: 'Nom',
    Floors: 'Niveaux',
    Rooms: 'Pièces',
    Walls: 'Murs',
    'Physical walls': 'Murs physiques',
    'Wall sides': 'Faces de mur',
    Columns: 'Poteaux',
    Beams: 'Poutres',
    Objects: 'Objets',
    Doors: 'Portes',
    Windows: 'Fenêtres',
    'System fields': 'Champs système',
    'Story elevation': 'Altitude du niveau',
    'Structural clear height': 'Hauteur libre sous structure',
    'Upper floor number': 'Numéro de l’étage',
    'Basement floor number': 'Numéro du sous-sol',
    'Interior predominant wall thickness': 'Épaisseur prédominante des murs intérieurs',
    'Exterior predominant wall thickness': 'Épaisseur prédominante des murs extérieurs',
    'Interior plaster thickness': 'Épaisseur de l’enduit intérieur',
    'Exterior plaster thickness': 'Épaisseur de l’enduit extérieur',
    'Select a default status for interior wall plaster': 'État par défaut de l’enduit intérieur',
    'Select a default status for exterior wall plaster': 'État par défaut de l’enduit extérieur',
    Plaster: 'Enduit',
    'Plaster thickness': 'Épaisseur de l’enduit',
    Plastered: 'Enduit présent',
    'Not plastered': 'Sans enduit',
    'All the interior walls are plastered': 'Toutes les faces intérieures sont enduites',
    'No interior wall is plastered': 'Aucune face intérieure n’est enduite',
    'All the exterior walls are plastered': 'Toutes les faces extérieures sont enduites',
    'No exterior wall is plastered': 'Aucune face extérieure n’est enduite',
    'Land survey': 'Terrain',
    'Basement floor': 'Sous-sol',
    'Ground floor': 'Rez-de-chaussée',
    'Upper floor': 'Étage',
    Roof: 'Toiture',
    Mezzanine: 'Mezzanine',
    Other: 'Autre',
    Bedroom: 'Chambre',
    Kitchen: 'Cuisine',
    'Living Room': 'Séjour',
    Height: 'Hauteur',
    Thickness: 'Épaisseur',
    Length: 'Longueur',
    Width: 'Largeur',
    Depth: 'Profondeur',
    'Measured across the beam, in the direction of the wall thickness.':
      'Mesurée en travers de la poutre, dans le sens de l’épaisseur du mur.',
    'Vertical dimension of the beam.': 'Dimension verticale de la poutre.',
    'Column ID': 'Identifiant du poteau',
    'Beam ID': 'Identifiant de la poutre',
    'Object name': 'Nom de l’objet',
    'Wall label': 'Repère du mur',
    'Door label': 'Repère de la porte',
    'Window label': 'Repère de la fenêtre',
    'Distance from wall start': 'Distance depuis le début du mur',
    'Distance from floor': 'Distance depuis le sol',
    'Split distance': 'Distance de division',
    "Measured from the finished floor of the building's ground floor. Ground floor is 0; levels above are positive and levels below are negative.":
      'Mesurée depuis le sol fini du rez-de-chaussée du bâtiment. Le rez-de-chaussée est à 0 ; les niveaux supérieurs sont positifs et les niveaux inférieurs négatifs.',
    'Measured from the finished floor to the underside of the floor or roof structure above. Ignore any suspended or false ceiling.':
      'Mesurée du sol fini à la sous-face de la structure du plancher ou de la toiture au-dessus. Ne pas tenir compte des faux plafonds.',
    'Room purpose or designation.': 'Usage ou désignation de la pièce.',
    'Identifier displayed on the canvas pin.': 'Identifiant affiché sur le repère du plan.',
    'Identifier linking to the canvas segment.': 'Identifiant du segment sur le plan.',
    'Automatically calculated from endpoints.': 'Calculée automatiquement à partir des extrémités.',
    'Label shown on the canvas when selecting a wall.':
      'Repère affiché sur le plan à la sélection du mur.',
  },
  it: {
    Name: 'Nome',
    Floors: 'Piani',
    Rooms: 'Locali',
    Walls: 'Pareti',
    'Physical walls': 'Pareti fisiche',
    'Wall sides': 'Facce della parete',
    Columns: 'Pilastri',
    Beams: 'Travi',
    Objects: 'Oggetti',
    Doors: 'Porte',
    Windows: 'Finestre',
    'System fields': 'Campi di sistema',
    'Story elevation': 'Quota del piano',
    'Structural clear height': 'Altezza libera strutturale',
    'Upper floor number': 'Numero del piano superiore',
    'Basement floor number': 'Numero del piano interrato',
    'Interior predominant wall thickness': 'Spessore prevalente delle pareti interne',
    'Exterior predominant wall thickness': 'Spessore prevalente delle pareti esterne',
    'Interior plaster thickness': 'Spessore dell’intonaco interno',
    'Exterior plaster thickness': 'Spessore dell’intonaco esterno',
    'Select a default status for interior wall plaster': 'Stato predefinito dell’intonaco interno',
    'Select a default status for exterior wall plaster': 'Stato predefinito dell’intonaco esterno',
    Plaster: 'Intonaco',
    'Plaster thickness': 'Spessore dell’intonaco',
    Plastered: 'Intonacato',
    'Not plastered': 'Non intonacato',
    'All the interior walls are plastered': 'Tutte le facce interne sono intonacate',
    'No interior wall is plastered': 'Nessuna faccia interna è intonacata',
    'All the exterior walls are plastered': 'Tutte le facce esterne sono intonacate',
    'No exterior wall is plastered': 'Nessuna faccia esterna è intonacata',
    'Land survey': 'Rilievo del terreno',
    'Basement floor': 'Piano interrato',
    'Ground floor': 'Piano terra',
    'Upper floor': 'Piano superiore',
    Roof: 'Copertura',
    Mezzanine: 'Soppalco',
    Other: 'Altro',
    Bedroom: 'Camera da letto',
    Kitchen: 'Cucina',
    'Living Room': 'Soggiorno',
    Height: 'Altezza',
    Thickness: 'Spessore',
    Length: 'Lunghezza',
    Width: 'Larghezza',
    Depth: 'Profondità',
    'Measured across the beam, in the direction of the wall thickness.':
      'Misurata trasversalmente alla trave, nella direzione dello spessore del muro.',
    'Vertical dimension of the beam.': 'Dimensione verticale della trave.',
    'Column ID': 'ID pilastro',
    'Beam ID': 'ID trave',
    'Object name': 'Nome oggetto',
    'Wall label': 'Etichetta parete',
    'Door label': 'Etichetta porta',
    'Window label': 'Etichetta finestra',
    'Distance from wall start': 'Distanza dall’inizio della parete',
    'Distance from floor': 'Distanza dal pavimento',
    'Split distance': 'Distanza di divisione',
    "Measured from the finished floor of the building's ground floor. Ground floor is 0; levels above are positive and levels below are negative.":
      'Misurata dal pavimento finito del piano terra dell’edificio. Il piano terra è a 0; i livelli superiori sono positivi e quelli inferiori negativi.',
    'Measured from the finished floor to the underside of the floor or roof structure above. Ignore any suspended or false ceiling.':
      'Misurata dal pavimento finito all’intradosso della struttura del solaio o della copertura sovrastante. Non considerare eventuali controsoffitti.',
    'Room purpose or designation.': 'Destinazione o denominazione del locale.',
    'Identifier displayed on the canvas pin.':
      'Identificativo mostrato sul segnaposto della pianta.',
    'Identifier linking to the canvas segment.': 'Identificativo del segmento sulla pianta.',
    'Automatically calculated from endpoints.': 'Calcolata automaticamente dagli estremi.',
    'Label shown on the canvas when selecting a wall.':
      'Etichetta mostrata sulla pianta selezionando una parete.',
  },
  es: {
    Name: 'Nombre',
    Floors: 'Plantas',
    Rooms: 'Habitaciones',
    Walls: 'Muros',
    'Physical walls': 'Muros físicos',
    'Wall sides': 'Caras del muro',
    Columns: 'Pilares',
    Beams: 'Vigas',
    Objects: 'Objetos',
    Doors: 'Puertas',
    Windows: 'Ventanas',
    'System fields': 'Campos del sistema',
    'Story elevation': 'Cota de la planta',
    'Structural clear height': 'Altura libre estructural',
    'Upper floor number': 'Número de planta superior',
    'Basement floor number': 'Número de sótano',
    'Interior predominant wall thickness': 'Espesor predominante de muros interiores',
    'Exterior predominant wall thickness': 'Espesor predominante de muros exteriores',
    'Interior plaster thickness': 'Espesor del enlucido interior',
    'Exterior plaster thickness': 'Espesor del revestimiento exterior',
    'Select a default status for interior wall plaster':
      'Estado predeterminado del enlucido interior',
    'Select a default status for exterior wall plaster':
      'Estado predeterminado del revestimiento exterior',
    Plaster: 'Enlucido',
    'Plaster thickness': 'Espesor del enlucido',
    Plastered: 'Con enlucido',
    'Not plastered': 'Sin enlucido',
    'All the interior walls are plastered': 'Todas las caras interiores están enlucidas',
    'No interior wall is plastered': 'Ninguna cara interior está enlucida',
    'All the exterior walls are plastered': 'Todas las caras exteriores están revestidas',
    'No exterior wall is plastered': 'Ninguna cara exterior está revestida',
    'Land survey': 'Levantamiento del terreno',
    'Basement floor': 'Sótano',
    'Ground floor': 'Planta baja',
    'Upper floor': 'Planta superior',
    Roof: 'Cubierta',
    Mezzanine: 'Entreplanta',
    Other: 'Otro',
    Bedroom: 'Dormitorio',
    Kitchen: 'Cocina',
    'Living Room': 'Sala de estar',
    Height: 'Altura',
    Thickness: 'Espesor',
    Length: 'Longitud',
    Width: 'Anchura',
    Depth: 'Profundidad',
    'Measured across the beam, in the direction of the wall thickness.':
      'Medida transversalmente a la viga, en la dirección del espesor del muro.',
    'Vertical dimension of the beam.': 'Dimensión vertical de la viga.',
    'Column ID': 'ID del pilar',
    'Beam ID': 'ID de la viga',
    'Object name': 'Nombre del objeto',
    'Wall label': 'Etiqueta del muro',
    'Door label': 'Etiqueta de la puerta',
    'Window label': 'Etiqueta de la ventana',
    'Distance from wall start': 'Distancia desde el inicio del muro',
    'Distance from floor': 'Distancia desde el suelo',
    'Split distance': 'Distancia de división',
    "Measured from the finished floor of the building's ground floor. Ground floor is 0; levels above are positive and levels below are negative.":
      'Medida desde el suelo terminado de la planta baja del edificio. La planta baja está a 0; los niveles superiores son positivos y los inferiores negativos.',
    'Measured from the finished floor to the underside of the floor or roof structure above. Ignore any suspended or false ceiling.':
      'Medida desde el suelo terminado hasta la cara inferior de la estructura del forjado o cubierta superior. No tener en cuenta los falsos techos.',
    'Room purpose or designation.': 'Uso o denominación de la habitación.',
    'Identifier displayed on the canvas pin.': 'Identificador mostrado en el marcador del plano.',
    'Identifier linking to the canvas segment.': 'Identificador del segmento en el plano.',
    'Automatically calculated from endpoints.':
      'Calculada automáticamente a partir de los extremos.',
    'Label shown on the canvas when selecting a wall.':
      'Etiqueta mostrada en el plano al seleccionar un muro.',
  },
};

export function normalizeBuildingPlanLocale(locale = 'en') {
  const language = String(locale).toLowerCase().split(/[-_]/)[0];
  return ['en', 'fr', 'it', 'es'].includes(language) ? language : 'en';
}

export function createBuildingPlanPresentation({
  metadata = [],
  measurementSystem = 'si',
  locale = 'en',
} = {}) {
  if (!['si', 'imperial'].includes(measurementSystem))
    throw new TypeError('measurement_system must be si or imperial');
  const language = normalizeBuildingPlanLocale(locale);
  const entries = new Map();
  for (const meta of metadata)
    for (const node of meta.repeatables || []) {
      entries.set(node.preferredKey, { field: { label: node.fieldLabel || node.nodeKey }, node });
      for (const entry of node.fields || [])
        if (entry.binding?.system) entries.set(entry.dataName, entry);
    }
  const t = (text) => TRANSLATIONS[language]?.[text] || text;
  const managed = (field) => entries.get(field.data_name) || entries.get(field.key);
  const unitFor = (kind = 'length') =>
    measurementSystem === 'imperial'
      ? kind === 'thickness'
        ? 'in'
        : 'ft'
      : kind === 'thickness'
        ? 'mm'
        : 'm';
  const factorFor = (kind) => ({ m: 1, mm: 1000, ft: 1 / 0.3048, in: 1 / 0.0254 })[unitFor(kind)];
  const kindFor = (field) => {
    const entry = managed(field);
    if (!entry || field.type !== 'NumericField') return null;
    return BUILDING_PLAN_MEASURES[entry.originalDataName] || null;
  };
  const convert = (value, factor) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Number((value * factor).toPrecision(14))
      : value;
  const toDisplay = (field, value) =>
    kindFor(field) ? convert(value, factorFor(kindFor(field))) : value;
  const fromDisplay = (field, value) => {
    const entry = managed(field);
    if (!entry) return value;
    if (kindFor(field)) return convert(value, 1 / factorFor(kindFor(field)));
    if (value && ['SingleChoiceField', 'MultiChoiceField'].includes(field.type)) {
      const key = field.type === 'SingleChoiceField' ? 'choice' : 'choices';
      return {
        ...value,
        [key]: (value[key] || []).map((selected) => {
          const canonical = entry.field.choices?.find((choice) => choice.value === selected.value);
          return canonical ? { ...selected, label: canonical.label } : selected;
        }),
      };
    }
    return value;
  };
  const present = (field) => {
    const entry = managed(field);
    const systemSection = field.type === 'Section' && /^~bp_.*_system_/.test(field.key || '');
    if (!entry && !systemSection) return field;
    const kind = kindFor(field);
    const label = field.label?.replace(/\s*[[(](?:m|mm)[\])]$/, '') || '';
    return {
      ...field,
      label: kind ? `${t(label)} [${unitFor(kind)}]` : t(field.label),
      description: t(field.description),
      ...(field.choices
        ? { choices: field.choices.map((choice) => ({ ...choice, label: t(choice.label) })) }
        : {}),
    };
  };
  return {
    locale: language,
    measurementSystem,
    field: present,
    toDisplay,
    fromDisplay,
    unitFor,
    toDisplayLength: (value) => convert(value, factorFor('length')),
    fromDisplayLength: (value) => convert(value, 1 / factorFor('length')),
    t,
  };
}
