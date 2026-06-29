'use strict';

// Zona de costa de Tarragona — el filtro geográfico, que es el núcleo
// de valor de este vertical. El BOE filtra por PROVINCIA (Tarragona),
// no por "costa", así que la franja litoral la define esta lista blanca
// de municipios + sus localidades/pedanías costeras y variantes de
// nombre (catalán/castellano, con y sin artículo, renombres oficiales).
//
// IMPORTANTE: el matching se hace SOLO contra la localidad del bien
// (no contra un texto que incluya la provincia), porque el token
// "tarragona" como provincia daría falsos positivos en municipios de
// interior (p.ej. "Reus (Tarragona)"). El cliente BOE separa localidad
// de provincia antes de llamar aquí.

// Cada entrada: municipio canónico + términos que, normalizados,
// identifican que el bien está en ese municipio (nombre oficial +
// alias + pedanías de costa).
const MUNICIPIOS_COSTA = [
  { municipio: 'Cunit',                              terminos: ['cunit'] },
  { municipio: 'Calafell',                           terminos: ['calafell', 'segur de calafell'] },
  { municipio: 'El Vendrell',                        terminos: ['el vendrell', 'vendrell', 'coma-ruga', 'comarruga', 'sant salvador', 'el francas'] },
  { municipio: 'Roda de Berà',                       terminos: ['roda de bera', 'roc de sant gaieta'] },
  { municipio: 'Creixell',                           terminos: ['creixell'] },
  { municipio: 'Torredembarra',                      terminos: ['torredembarra'] },
  { municipio: 'Altafulla',                          terminos: ['altafulla'] },
  // 'la mora' (playa de Tarragona) se omite a propósito: normaliza a
  // 'mora' y colisionaría con Móra d'Ebre / Móra la Nova (interior).
  { municipio: 'Tarragona',                          terminos: ['tarragona', 'tamarit', 'platja llarga'] },
  { municipio: 'Vila-seca',                          terminos: ['vila-seca', 'vila seca', 'la pineda'] },
  { municipio: 'Salou',                              terminos: ['salou'] },
  { municipio: 'Cambrils',                           terminos: ['cambrils'] },
  { municipio: 'Mont-roig del Camp',                 terminos: ['mont-roig del camp', 'mont-roig', 'montroig', 'miami platja', 'miami playa'] },
  { municipio: 'Vandellòs i l\'Hospitalet de l\'Infant', terminos: ['vandellos i l hospitalet de l infant', 'vandellos', 'l hospitalet de l infant', 'hospitalet de l infant'] },
  { municipio: 'L\'Ametlla de Mar',                  terminos: ['l ametlla de mar', 'ametlla de mar'] },
  { municipio: 'L\'Ampolla',                         terminos: ['l ampolla', 'ampolla'] },
  { municipio: 'Deltebre',                           terminos: ['deltebre'] },
  { municipio: 'Sant Jaume d\'Enveja',               terminos: ['sant jaume d enveja'] },
  { municipio: 'Amposta',                            terminos: ['amposta', 'els eucaliptus', 'eucaliptus'] },
  { municipio: 'La Ràpita',                          terminos: ['la rapita', 'sant carles de la rapita'] },
  { municipio: 'Alcanar',                            terminos: ['alcanar', 'les cases d alcanar', 'cases d alcanar'] },
];

// Normaliza un topónimo para comparar: minúsculas, sin acentos, sin
// puntuación (apóstrofes/guiones → espacio), sin artículo inicial,
// espacios colapsados. "L'Ametlla de Mar" / "AMETLLA DE MAR (L')" →
// "ametlla de mar".
function normalizeLoc(s) {
  let t = String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')                      // puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim();
  // quita un artículo inicial (el, la, l, els, les, los, las)
  t = t.replace(/^(el|la|l|els|les|los|las)\s+/, '');
  return t;
}

// Índice precomputado: término normalizado → municipio canónico.
const _INDEX = [];
for (const { municipio, terminos } of MUNICIPIOS_COSTA) {
  for (const term of terminos) {
    _INDEX.push({ term: normalizeLoc(term), municipio });
  }
}
// Más largos primero: evita que "amposta" gane antes que un término más
// específico cuando ambos encajan.
_INDEX.sort((a, b) => b.term.length - a.term.length);

// Devuelve el municipio costero canónico si la localidad cae en la
// franja, o null. Match por substring acotado a límites de palabra
// para no confundir "salou" dentro de otra palabra.
function municipioCostero(localidad) {
  const loc = normalizeLoc(localidad);
  if (!loc) return null;
  const padded = ` ${loc} `;
  for (const { term, municipio } of _INDEX) {
    if (padded.includes(` ${term} `)) return municipio;
  }
  return null;
}

// ¿La localidad está en la costa de Tarragona?
function esCostera(localidad) {
  return municipioCostero(localidad) !== null;
}

module.exports = {
  MUNICIPIOS_COSTA,
  normalizeLoc,
  municipioCostero,
  esCostera,
};
