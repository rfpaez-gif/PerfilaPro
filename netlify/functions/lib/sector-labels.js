'use strict';

// Etiquetas humanas de los sectores que se persisten como `cards.tagline`
// cuando el usuario no rellena descripción libre. Usadas tanto desde
// create-checkout (flujo de pago) como desde register-free (flujo gratuito).
//
// Mantener sincronizadas ambas variantes: las KEYS son slugs de sector
// (contractuales con la BD y el catálogo de archetypes); los VALUES son
// strings user-facing que viajan a la tarjeta pública.

const SECTOR_LABELS_BY_LANG = {
  es: {
    oficios:    'Oficios y servicios del hogar',
    salud:      'Salud y bienestar',
    educacion:  'Educación y formación',
    comercial:  'Comercial y ventas',
    belleza:    'Belleza y estética',
    reforma:    'Reforma y construcción',
    hosteleria: 'Hostelería y restauración',
    tech:       'Tecnología y digital',
    legal:      'Legal y asesoría',
    jardineria: 'Jardinería y paisajismo',
    transporte: 'Transporte y mudanzas',
    fotografia: 'Fotografía y vídeo',
    eventos:    'Eventos y celebraciones',
    automocion: 'Automoción y mecánica',
    seguridad:  'Seguridad y vigilancia',
    cuidados:   'Cuidados y asistencia',
    fitness:    'Fitness y deporte',
    turismo:    'Turismo y viajes',
    comercio:   'Comercio y tiendas',
    otro:       'Otro',
  },
  ca: {
    oficios:    'Oficis i serveis de la llar',
    salud:      'Salut i benestar',
    educacion:  'Educació i formació',
    comercial:  'Comercial i vendes',
    belleza:    'Bellesa i estètica',
    reforma:    'Reforma i construcció',
    hosteleria: 'Hostaleria i restauració',
    tech:       'Tecnologia i digital',
    legal:      'Legal i assessoria',
    jardineria: 'Jardineria i paisatgisme',
    transporte: 'Transport i mudances',
    fotografia: 'Fotografia i vídeo',
    eventos:    'Esdeveniments i celebracions',
    automocion: 'Automoció i mecànica',
    seguridad:  'Seguretat i vigilància',
    cuidados:   'Cures i assistència',
    fitness:    'Fitness i esport',
    turismo:    'Turisme i viatges',
    comercio:   'Comerç i botigues',
    otro:       'Altres',
  },
};

function pickSectorLabel(sector, idioma) {
  const lang = idioma === 'ca' ? 'ca' : 'es';
  const map = SECTOR_LABELS_BY_LANG[lang];
  return map[sector] || sector || '';
}

module.exports = { SECTOR_LABELS_BY_LANG, pickSectorLabel };
